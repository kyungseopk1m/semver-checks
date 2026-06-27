import { Project, Type, Node, SyntaxKind, DiagnosticCategory } from 'ts-morph';
import type { SourceFile, ModuleDeclaration } from 'ts-morph';
import path from 'path';
import fs from 'fs';
import type {
  ApiSnapshot,
  ApiSymbol,
  ApiFunctionSymbol,
  ApiFunctionSignature,
  ApiParameter,
  ApiTypeParameter,
  ApiInterfaceSymbol,
  ApiInterfaceProperty,
  ApiInterfaceMethod,
  ApiIndexSignature,
  ApiTypeAliasSymbol,
  ApiEnumSymbol,
  ApiEnumMember,
  ApiClassSymbol,
  ApiVariableSymbol,
  ApiObjectMembers,
  SerializedType,
} from './api-snapshot.js';

export function extractFromPath(projectPath: string, entry?: string | string[]): ApiSnapshot {
  const project = new Project({
    tsConfigFilePath: path.join(projectPath, 'tsconfig.json'),
    skipAddingFilesFromTsConfig: false,
  });

  // P1: Warn on TypeScript errors so users aren't silently misled by ts-morph's
  // error-recovery mode. Limit to 5 messages to avoid flooding stderr.
  const diagnostics = project.getPreEmitDiagnostics()
    .filter((d) => d.getCategory() === DiagnosticCategory.Error);
  if (diagnostics.length > 0) {
    const msgs = diagnostics.slice(0, 5).map((d) => {
      const file = d.getSourceFile()?.getFilePath() ?? 'unknown';
      const line = d.getLineNumber() ?? '?';
      const msgText = d.getMessageText();
      const msg = typeof msgText === 'string' ? msgText : msgText.getMessageText();
      return `  ${file}:${line} - ${msg}`;
    }).join('\n');
    process.stderr.write(
      `[semver-checks] ${diagnostics.length} TypeScript error(s) in the analyzed project:\n${msgs}\n` +
      `  The API snapshot may be incomplete, so the recommended bump can under-report breaking changes.\n` +
      `  Fix the type errors (or point --entry at a clean entry) for a reliable result.\n`,
    );
  }

  const entryFiles = resolveEntries(project, projectPath, entry);
  const entrypoints: Record<string, Record<string, ApiSymbol>> = {};
  for (const [subpath, file] of Object.entries(entryFiles)) {
    entrypoints[subpath] = collectContainerExports(file);
  }

  return { entrypoints };
}

const DTS_SUFFIXES = ['.d.ts', '.d.mts', '.d.cts'] as const;
const isDtsPath = (p: string): boolean => DTS_SUFFIXES.some((s) => p.endsWith(s));

// Map a declared types path back to its working-tree source: dist→src and
// .d.ts/.d.mts/.d.cts → .ts/.mts/.cts. Published tarballs ship only declarations,
// so the raw path is also tried separately (see resolveRawDecl).
function declToSrc(typesPath: string): string {
  return typesPath
    .replace('/dist/mjs/', '/src/')
    .replace(/\.d\.ts$/, '.ts')
    .replace(/\.d\.mts$/, '.mts')
    .replace(/\.d\.cts$/, '.cts');
}

// First candidate that resolves to a working-tree source file (dist mapped to src).
// Preferred over the declared .d.ts so a stale/unbuilt dist never masks source
// changes (see the resolveEntries fallback ordering).
function resolveMappedSource(
  project: Project,
  projectPath: string,
  candidates: string[],
): SourceFile | undefined {
  for (const tp of candidates) {
    const f = project.getSourceFile(path.join(projectPath, declToSrc(tp)));
    if (f) return f;
  }
  return undefined;
}

// First candidate that resolves to its declared file as-is (the published tarball
// case: .d.ts/.d.mts/.d.cts shipped without source).
function resolveRawDecl(
  project: Project,
  projectPath: string,
  candidates: string[],
): SourceFile | undefined {
  for (const tp of candidates) {
    const f = project.getSourceFile(path.join(projectPath, tp));
    if (f) return f;
  }
  return undefined;
}

// All candidate declaration paths from a package.json "exports" subpath value, in
// preference order. A value is a bare string or a nested conditions object; types
// can live under a `types` key or any condition (`require`/`import`/`node`/
// `browser`/`module`/`default`), arbitrarily nested. `.d.ts` candidates are
// ordered before `.d.mts`/`.d.cts` because the default tsconfig include always
// loads `.d.ts`, whereas mts/cts loading depends on the include globs.
function typesCandidatesFromExportsValue(value: unknown): string[] {
  // `import` before `require` preserves v0.6.0's watched-surface preference (it
  // read `import.types` first): when a package ships separate ESM and CJS
  // declaration files of the *same* extension, the ESM surface stays the one
  // analyzed rather than silently flipping to CJS.
  const PRIORITY_CONDS = ['import', 'require', 'node', 'node-addons', 'browser', 'module', 'default'];
  const out: string[] = [];
  const visit = (v: unknown): void => {
    if (typeof v === 'string') {
      if (isDtsPath(v)) out.push(v);
      return;
    }
    // An `exports` value can be a fallback array (e.g. `[{ types, default }, "./x.js"]`).
    // Walk each alternative; the .d.ts-first ordering below picks the best candidate.
    if (Array.isArray(v)) {
      for (const item of v) visit(item);
      return;
    }
    if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      if (typeof obj['types'] === 'string' && isDtsPath(obj['types'] as string)) out.push(obj['types'] as string);
      for (const cond of PRIORITY_CONDS) if (obj[cond] !== undefined) visit(obj[cond]);
      for (const [k, cv] of Object.entries(obj)) {
        if (k === 'types' || PRIORITY_CONDS.includes(k)) continue;
        visit(cv);
      }
    }
  };
  visit(value);
  const ordered = [...out.filter((p) => p.endsWith('.d.ts')), ...out.filter((p) => !p.endsWith('.d.ts'))];
  const seen = new Set<string>();
  return ordered.filter((p) => (seen.has(p) ? false : (seen.add(p), true)));
}

// Resolve one or more entry source files keyed by export subpath ('.' for root).
// Honors an explicit `entry` (single file or list), then a package.json "exports"
// map (multiple subpaths), then falls back to conventional single-entry layouts.
function resolveEntries(
  project: Project,
  projectPath: string,
  entry?: string | string[],
): Record<string, SourceFile> {
  // Explicit entry/entries take precedence. A single string maps to the root '.';
  // a list is keyed by each relative file path so distinct entries stay separate.
  if (entry !== undefined) {
    const entries = Array.isArray(entry) ? entry : [entry];
    const result: Record<string, SourceFile> = {};
    for (const e of entries) {
      const file = project.getSourceFile(path.join(projectPath, e));
      if (!file) throw new Error(`Entry file not found: ${e}`);
      result[entries.length === 1 ? '.' : e] = file;
    }
    return result;
  }

  // Auto-detect from package.json
  let rootCandidates: string[] = [];
  // True when `exports` is a subpath map that deliberately omits a `.` root entry.
  // Such a package has no public root surface, so the conventional-root fallback
  // below must NOT fabricate one from a stray root index.d.ts.
  let exportsSubpathsWithoutRoot = false;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectPath, 'package.json'), 'utf-8'));
    const exportsField = pkg.exports;

    // Multi-entry "exports" map: walk every subpath ('.', './utils', ...) and
    // resolve each to its declared types source. Subpaths without a resolvable
    // declaration entry are skipped (e.g. `default`-only without `types`). A
    // verbose warning helps surface partial-coverage exports maps that would
    // otherwise cause spurious `entrypoint-added` reports the next time a `types`
    // field is added to that subpath.
    if (exportsField && typeof exportsField === 'object' && !Array.isArray(exportsField)) {
      const result: Record<string, SourceFile> = {};
      const skipped: string[] = [];
      for (const [subpath, value] of Object.entries(exportsField)) {
        if (!subpath.startsWith('.')) continue;
        const cands = typesCandidatesFromExportsValue(value);
        if (cands.length === 0) {
          skipped.push(subpath);
          continue;
        }
        const file =
          resolveMappedSource(project, projectPath, cands) ?? resolveRawDecl(project, projectPath, cands);
        if (file) result[subpath] = file;
        else skipped.push(subpath);
      }
      if (Object.keys(result).length > 0) {
        if (skipped.length > 0 && process.env['SEMVER_CHECKS_VERBOSE']) {
          process.stderr.write(
            `[semver-checks] exports map subpaths skipped (no resolvable types entry): ${skipped.join(', ')}\n`,
          );
        }
        return result;
      }
    }

    // Single root entry. Gather every candidate declaration path — from the '.'
    // exports conditions (any nesting), then the top-level `types`/`typings`
    // fields — and try them all. Crucially the top-level fields are appended as
    // fallbacks rather than short-circuited: a package whose `.` export points its
    // `import.types` at a `.d.mts` still resolves via its `.d.ts` `types` field.
    //
    // The root export value is `exports['.']` for a subpath map, but a bare string
    // (`"exports": "./index.js"`) or a flat conditions object
    // (`"exports": { "types": "./index.d.ts", "default": "./index.js" }`) IS itself
    // the '.' value — the common modern-ESM shape (p-limit, execa, ...). Reading
    // only `exports['.']` there is `undefined`, so the `types` condition sitting in
    // that object was never looked at.
    const hasSubpathKeys =
      exportsField !== null && typeof exportsField === 'object' && !Array.isArray(exportsField) &&
      Object.keys(exportsField).some((k) => k.startsWith('.'));
    exportsSubpathsWithoutRoot =
      hasSubpathKeys && !Object.prototype.hasOwnProperty.call(exportsField, '.');
    const main = hasSubpathKeys ? (exportsField as Record<string, unknown>)['.'] : exportsField;
    const gathered = [
      ...(main !== undefined ? typesCandidatesFromExportsValue(main) : []),
      ...(typeof pkg.types === 'string' && isDtsPath(pkg.types) ? [pkg.types] : []),
      ...(typeof pkg.typings === 'string' && isDtsPath(pkg.typings) ? [pkg.typings] : []),
    ].filter((p, i, a) => a.indexOf(p) === i);
    // Prefer `.d.ts` over `.d.mts`/`.d.cts` across the whole candidate set: a
    // package that ships both should be analysed from one consistent declaration
    // file, and `.d.ts` is the one the default tsconfig include always loads.
    rootCandidates = [...gathered.filter((p) => p.endsWith('.d.ts')), ...gathered.filter((p) => !p.endsWith('.d.ts'))];

    // Source layout (working tree): map the declared path back to its source.
    const fromSource = resolveMappedSource(project, projectPath, rootCandidates);
    if (fromSource) return { '.': fromSource };
  } catch {}

  // Fallback to real source before the declared .d.ts: a working tree with a
  // stale or unbuilt dist/ would otherwise be analyzed from its outdated
  // declarations, silently masking source-only API changes. Skipped when `exports`
  // is a subpath map without a `.` root — that package has no public root entry, so
  // an internal `src/index.ts` must not be fabricated into one (it would invent a
  // non-exported surface, and across versions a spurious entrypoint-added/removed).
  const fallback = exportsSubpathsWithoutRoot
    ? undefined
    : project.getSourceFile(path.join(projectPath, 'src', 'index.ts')) ??
      project.getSourceFile(path.join(projectPath, 'index.ts'));
  if (fallback) return { '.': fallback };

  // Last resort: the declared types entry itself. Published npm tarballs ship
  // their declarations but no .ts source, so this is their entry point.
  const fromDecl = resolveRawDecl(project, projectPath, rootCandidates);
  if (fromDecl) return { '.': fromDecl };

  // Conventional root declaration. Packages with no `exports`/`types` fields (older
  // single-file libs like chalk 4.x's `{ "main": "source" }`, or a bare-string
  // `"exports": "./index.js"`) still ship an `index.d.ts` at the root. The
  // synthesized tsconfig already loaded it, so a direct lookup resolves it.
  // Skipped when `exports` is a subpath map without a `.` root: that package has no
  // public root entry, so a root index.d.ts is an internal file, not the surface.
  const fromConventionalDecl = exportsSubpathsWithoutRoot
    ? undefined
    : project.getSourceFile(path.join(projectPath, 'index.d.ts')) ??
      project.getSourceFile(path.join(projectPath, 'index.d.mts')) ??
      project.getSourceFile(path.join(projectPath, 'index.d.cts'));
  if (fromConventionalDecl) return { '.': fromConventionalDecl };

  // Subpath-only `exports` deliberately skipped the root source/declaration
  // fallbacks above, so listing them as "looked for" would misreport what happened.
  // Explain the actual cause (no `.` root) and the two real ways forward instead.
  if (exportsSubpathsWithoutRoot) {
    throw new Error(
      `Could not find an entry file under ${projectPath}.\n` +
        `  package.json "exports" maps subpaths but declares no "." root, so there is no public root entry to analyze.\n` +
        `  Point --entry at the intended source (e.g. --entry src/index.ts), or check that the subpath build output exists.`,
    );
  }

  const looked = [
    'package.json "exports"/"types"',
    'src/index.ts',
    'index.ts',
    'index.d.ts',
    ...(rootCandidates.length ? [`declared types (${rootCandidates.join(', ')})`] : []),
  ];
  throw new Error(
    `Could not find an entry file under ${projectPath}.\n` +
      `  Looked for: ${looked.join(', ')}.\n` +
      `  Pass one explicitly, e.g. --entry src/index.ts`,
  );
}

// Collect exported declarations from a source file OR a namespace/module body.
// Both expose getExportedDeclarations(), so namespace bodies are handled by the
// same logic recursively (see the namespace-side branch below).
function collectContainerExports(container: SourceFile | ModuleDeclaration): Record<string, ApiSymbol> {
  const result: Record<string, ApiSymbol> = {};

  const exportedDeclarations = container.getExportedDeclarations();

  for (const [name, declarations] of exportedDeclarations) {
    if (declarations.length === 0) continue;

    // A single name can resolve to multiple declarations (declaration merging) —
    // e.g. a function or class merged with a same-named namespace. Process the
    // value side and the namespace side separately so neither is dropped.
    const moduleDecls = declarations.filter((d) => Node.isModuleDeclaration(d));
    const valueDecls = declarations.filter((d) => !Node.isModuleDeclaration(d));

    // Value side: overloaded functions produce multiple FunctionDeclaration nodes.
    const fnDecls = valueDecls.filter((d) => Node.isFunctionDeclaration(d));
    if (fnDecls.length > 1) {
      const overloads = fnDecls.filter((d) => (d as any).isOverload?.());
      const sigDecls = overloads.length > 0 ? overloads : fnDecls.slice(0, 1);
      const signatures = sigDecls.flatMap((d) => convertFunctionSignatures(d));
      result[name] = { kind: 'function', name, signatures };
    } else if (valueDecls.length > 0) {
      try {
        const symbol = convertDeclaration(name, valueDecls[0]);
        if (symbol) result[name] = symbol;
      } catch (err) {
        if (process.env['SEMVER_CHECKS_VERBOSE']) {
          process.stderr.write(`[semver-checks] warning: could not analyze '${name}': ${err}\n`);
        }
      }
    }

    // Namespace side: recurse into each namespace body.
    if (moduleDecls.length > 0) {
      const nsSymbols: Record<string, ApiSymbol> = {};
      for (const md of moduleDecls) {
        Object.assign(nsSymbols, collectContainerExports(md));
      }
      if (name in result) {
        // Merged with a value (function/class/...): flatten namespace members as
        // `name.child` so they aren't shadowed by the value symbol.
        for (const [childName, childSym] of Object.entries(nsSymbols)) {
          result[`${name}.${childName}`] = childSym;
        }
      } else {
        result[name] = { kind: 'namespace', name, symbols: nsSymbols };
      }
    }
  }

  return result;
}

function convertDeclaration(name: string, node: Node): ApiSymbol | null {
  if (Node.isFunctionDeclaration(node) || Node.isFunctionExpression(node) || Node.isArrowFunction(node)) {
    return convertFunction(name, node);
  }

  if (Node.isInterfaceDeclaration(node)) {
    return convertInterface(name, node);
  }

  if (Node.isTypeAliasDeclaration(node)) {
    return convertTypeAlias(name, node);
  }

  if (Node.isEnumDeclaration(node)) {
    return convertEnum(name, node);
  }

  if (Node.isClassDeclaration(node)) {
    return convertClass(name, node);
  }

  if (Node.isVariableDeclaration(node)) {
    const type = node.getType();
    // If variable holds a function type, treat as function
    if (type.getCallSignatures().length > 0) {
      return convertFunctionType(name, type, node);
    }
    return convertVariable(name, node);
  }

  return null;
}

// Strip import("..."). prefixes emitted by ts-morph when a type originates from
// another file. Two snapshots extracted from different directories produce
// different absolute paths inside import("..."), causing false positive diffs.
function normalizeTypeText(text: string): string {
  return canonicalizeTypeText(
    text
      .replace(/import\("[^"]*"\)\./g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function canonicalizeTypeText(text: string): string {
  const trimmed = stripOuterParens(text);

  const unionParts = splitTopLevel(trimmed, '|');
  if (unionParts.length > 1 && canNormalizeBinaryParts(unionParts)) {
    return unionParts.map(canonicalizeBinaryMember).sort().join(' | ');
  }

  const intersectionParts = splitTopLevel(trimmed, '&');
  if (intersectionParts.length > 1 && canNormalizeBinaryParts(intersectionParts)) {
    return intersectionParts.map(canonicalizeBinaryMember).sort().join(' & ');
  }

  return trimmed;
}

// Canonicalize one member of a union/intersection. A function or constructor type
// member MUST keep its parentheses: `=>` binds looser than `|`/`&` on its right, so
// an unparenthesized `((a) => X) & ((b) => Y)` would re-serialize to
// `(a) => X & (b) => Y`, which re-parses as `(a) => (X & (b) => Y)` — a single
// function returning an intersection, a different type. `stripOuterParens` (inside
// the recursive call) drops those parens, so re-add them for arrow-typed members.
function canonicalizeBinaryMember(part: string): string {
  const canonical = canonicalizeTypeText(part);
  return hasTopLevelArrow(canonical) ? `(${canonical})` : canonical;
}

// True when `text` has a `=>` at bracket depth 0 — i.e. it is itself a function or
// constructor type, not one that merely contains an arrow nested inside `{}`/`<>`/`()`.
function hasTopLevelArrow(text: string): boolean {
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;
  let depthAngle = 0;
  let inString: '"' | '\'' | '`' | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const prev = i > 0 ? text[i - 1] : '';
    if (inString) {
      if (ch === inString && prev !== '\\') inString = null;
      continue;
    }
    if (ch === '"' || ch === '\'' || ch === '`') {
      inString = ch;
      continue;
    }
    // The `>` of an arrow follows `=` and closes no `<`, so check it before
    // treating `>` as a generic close.
    if (ch === '>' && prev === '=') {
      if (depthParen === 0 && depthBrace === 0 && depthBracket === 0 && depthAngle === 0) return true;
      continue;
    }
    if (ch === '(') depthParen++;
    else if (ch === ')') depthParen--;
    else if (ch === '{') depthBrace++;
    else if (ch === '}') depthBrace--;
    else if (ch === '[') depthBracket++;
    else if (ch === ']') depthBracket--;
    else if (ch === '<') depthAngle++;
    else if (ch === '>') depthAngle = Math.max(0, depthAngle - 1);
  }
  return false;
}

function canNormalizeBinaryParts(parts: string[]): boolean {
  return parts.every((part) => isAtomicTypePart(stripOuterParens(part)));
}

function isAtomicTypePart(text: string): boolean {
  return splitTopLevel(text, '|').length === 1 && splitTopLevel(text, '&').length === 1;
}

function stripOuterParens(text: string): string {
  let current = text.trim();

  while (current.startsWith('(') && current.endsWith(')') && hasWrappingParens(current)) {
    current = current.slice(1, -1).trim();
  }

  return current;
}

function hasWrappingParens(text: string): boolean {
  let depth = 0;
  let inString: '"' | '\'' | '`' | null = null;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const prev = i > 0 ? text[i - 1] : '';

    if (inString) {
      if (ch === inString && prev !== '\\') inString = null;
      continue;
    }

    if (ch === '"' || ch === '\'' || ch === '`') {
      inString = ch;
      continue;
    }

    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth === 0 && i < text.length - 1) return false;
  }

  return depth === 0;
}

function splitTopLevel(text: string, delimiter: '|' | '&'): string[] {
  const parts: string[] = [];
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;
  let depthAngle = 0;
  let inString: '"' | '\'' | '`' | null = null;
  let current = '';

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const prev = i > 0 ? text[i - 1] : '';

    if (inString) {
      current += ch;
      if (ch === inString && prev !== '\\') {
        inString = null;
      }
      continue;
    }

    if (ch === '"' || ch === '\'' || ch === '`') {
      inString = ch;
      current += ch;
      continue;
    }

    if (ch === '(') depthParen++;
    else if (ch === ')') depthParen--;
    else if (ch === '{') depthBrace++;
    else if (ch === '}') depthBrace--;
    else if (ch === '[') depthBracket++;
    else if (ch === ']') depthBracket--;
    else if (ch === '<') depthAngle++;
    else if (ch === '>') depthAngle = Math.max(0, depthAngle - 1);

    if (
      ch === delimiter &&
      depthParen === 0 &&
      depthBrace === 0 &&
      depthBracket === 0 &&
      depthAngle === 0
    ) {
      parts.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  if (current.length > 0) {
    parts.push(current.trim());
  }

  return parts;
}

// EDGE-4: Pass contextNode to getText() so types are resolved relative to the
// declaration's file, not an absolute tmp path. This prevents false positives
// when comparing git-ref snapshots (in /tmp) vs local paths.
//
// Unresolved symbols (a missing import, an undeclared name) make TypeScript
// collapse the type to the intrinsic `error` type, which `getText()` renders as
// `any`. Two structurally different unresolved types (`M | string` vs
// `M | number`) would then both serialize to a text containing `any` and
// compare as a no-op, silently hiding a breaking change. This happens both at
// the top level (`intrinsicName === 'error'`) and *nested* inside a wrapper
// (`Array<M | string>`, `{ a: M | string }`, `<T extends M | string>`) where the
// outer type is a normal array/object/function but the collapsed `any` still
// leaks into the text. In either case we fall back to the *source* annotation
// text so the two stay distinguishable (conservative: a real change surfaces as
// major; an identical unresolved type stays a no-op). A genuine `any` is present
// in the source too, so explicit-`any` types are untouched. Inferred positions
// have no annotation node, so an unresolved inferred type still degrades to
// `any` — a separate, narrower gap tracked for a follow-up.
// In-memory project for cheap structural probes of a serialized type text.
let probeProject: Project | undefined;
function getProbeProject(): Project {
  if (!probeProject) {
    probeProject = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: { noEmit: true, skipLibCheck: true },
    });
  }
  return probeProject;
}

// Counts `any` *type* keyword nodes in a serialized type text. Parsing (rather
// than a text scan) is required so that an object-type property *named* `any`
// (`{ any: M | string }`) is not counted — only an `AnyKeyword` type node is.
// `serializeType` compares the count in the computed text against the source:
// an unresolved symbol only ever *adds* `any` (it collapses `M | string` to
// `any` but leaves genuine `any`s in place), so a higher count in the computed
// text signals a collapse. A plain boolean "mentions any" check is not enough —
// it is suppressed when the source already has an unrelated genuine `any` field
// (`{ ok: any; x: M | string }`), letting the collapsed field slip through.
function countAnyKeywords(text: string): number {
  const sourceFile = getProbeProject().createSourceFile('__sc_any_probe__.ts', `type __sc_a = (${text});`, {
    overwrite: true,
  });
  try {
    return sourceFile.getDescendantsOfKind(SyntaxKind.AnyKeyword).length;
  } finally {
    getProbeProject().removeSourceFile(sourceFile);
  }
}

function serializeType(type: Type, contextNode: Node, annotationNode?: Node): SerializedType {
  const computed = normalizeTypeText(type.getText(contextNode));
  if (annotationNode) {
    const intrinsic = (type.compilerType as { intrinsicName?: string }).intrinsicName;
    const source = normalizeTypeText(annotationNode.getText());
    // `error` intrinsic catches the top-level case; a higher `any` count in the
    // computed text catches a collapsed `any` that leaked in from a nested
    // unresolved symbol, even when the source already has a genuine `any` field.
    if (intrinsic === 'error' || countAnyKeywords(computed) > countAnyKeywords(source)) {
      return { text: source };
    }
  }
  return { text: computed };
}

function convertTypeParams(node: Node): ApiTypeParameter[] {
  const params = (node as any).getTypeParameters?.() ?? [];
  return params.map((tp: any) => {
    // tp.getConstraint()/getDefault() return TypeNodes (AST nodes); getText() is
    // literal source text. normalizeTypeText() applied for consistency in case
    // the constraint/default references an imported type.
    const c = tp.getConstraint();
    const d = tp.getDefault();
    return {
      name: tp.getName(),
      constraint: c ? { text: normalizeTypeText(c.getText()) } : undefined,
      hasDefault: d != null,
      default: d ? { text: normalizeTypeText(d.getText()) } : undefined,
    };
  });
}

// Build an ApiFunctionSignature from a call/construct signature declaration.
// These nodes expose the same parameter / return / type-parameter accessors as
// function declarations but are not covered by convertFunctionSignatures' node
// guards (and must not force the constructor's `void` return).
function convertSignatureFromNode(node: Node): ApiFunctionSignature {
  const n = node as any;
  const params: ApiParameter[] = (n.getParameters?.() ?? []).map((p: any) => ({
    name: p.getName(),
    type: serializeType(p.getType(), node, p.getTypeNode?.()),
    isOptional: p.isOptional?.() ?? false,
    isRest: p.isRestParameter?.() ?? false,
  }));
  const returnNode = n.getReturnTypeNode?.();
  const returnType: SerializedType = n.getReturnType
    ? serializeType(n.getReturnType(), node, returnNode)
    : { text: 'unknown' };
  return { parameters: params, returnType, typeParameters: convertTypeParams(node) };
}

function convertFunction(name: string, node: Node): ApiFunctionSymbol {
  const signatures = convertFunctionSignatures(node);
  return { kind: 'function', name, signatures };
}

// EDGE-2: isRest fixed — check actual ParameterDeclaration instead of hardcoding false
// EDGE-3: typeParameters fixed — extract from Signature instead of hardcoding []
// EDGE-4: getText(contextNode) for path-independent type serialization
function convertFunctionType(name: string, type: Type, contextNode: Node): ApiFunctionSymbol {
  const signatures = type.getCallSignatures().map((sig) => ({
    parameters: sig.getParameters().map((p) => {
      const valueDecl = p.getValueDeclaration();
      const paramType = valueDecl ? p.getTypeAtLocation(valueDecl) : p.getDeclaredType();
      // ParameterDeclaration has isRestParameter(); use duck-typing since ts-morph
      // does not export a stable Node.isParameterDeclaration guard in all versions
      const isRest = !!(valueDecl as any)?.isRestParameter?.();
      return {
        name: p.getName(),
        type: serializeType(paramType, contextNode, (valueDecl as { getTypeNode?: () => Node | undefined } | undefined)?.getTypeNode?.()),
        isOptional: p.isOptional(),
        isRest,
      };
    }),
    returnType: serializeType(
      sig.getReturnType(),
      contextNode,
      (sig.getDeclaration() as { getReturnTypeNode?: () => Node | undefined } | undefined)?.getReturnTypeNode?.(),
    ),
    // EDGE-3: extract type parameters from the call signature.
    // The constraint comes from a `Type` here (not an AST node), so an
    // unresolved symbol collapses it to `any`. Route it through `serializeType`
    // with the declaration's constraint node so the source text is preserved
    // (`<T extends M | string>` must not read as `<T extends any>`).
    typeParameters: sig.getTypeParameters().map((tp) => {
      const constraintType = tp.getConstraint();
      const decl = tp.getSymbol()?.getDeclarations()?.[0];
      const constraintNode = (decl as { getConstraint?: () => Node | undefined } | undefined)?.getConstraint?.();
      const defaultType = tp.getDefault();
      const defaultNode = (decl as { getDefault?: () => Node | undefined } | undefined)?.getDefault?.();
      return {
        name: tp.getSymbol()?.getName() ?? '?',
        constraint: constraintType ? serializeType(constraintType, contextNode, constraintNode) : undefined,
        hasDefault: defaultType != null,
        default: defaultType ? serializeType(defaultType, contextNode, defaultNode) : undefined,
      };
    }),
  }));
  return { kind: 'function', name, signatures };
}

function convertFunctionSignatures(node: Node): ApiFunctionSignature[] {
  if (
    !Node.isFunctionDeclaration(node) &&
    !Node.isMethodDeclaration(node) &&
    !Node.isMethodSignature(node) &&
    !Node.isConstructorDeclaration(node)
  ) {
    return [];
  }

  // EDGE-4: use node as context for getText() to avoid absolute path leakage
  const params: ApiParameter[] = node.getParameters().map((p) => ({
    name: p.getName(),
    type: serializeType(p.getType(), node, p.getTypeNode()),
    isOptional: p.isOptional(),
    isRest: p.isRestParameter(),
  }));

  const rawReturnType = (node as any).getReturnType?.();
  const returnTypeNode = (node as { getReturnTypeNode?: () => Node | undefined }).getReturnTypeNode?.();
  const returnType: SerializedType = Node.isConstructorDeclaration(node)
    ? { text: 'void' }
    : rawReturnType ? serializeType(rawReturnType, node, returnTypeNode) : { text: 'unknown' };

  return [{
    parameters: params,
    returnType,
    typeParameters: convertTypeParams(node),
  }];
}

// Extract the object-type member set shared by interfaces and object-literal
// type aliases. `node` is any TypeElementMemberedNode (InterfaceDeclaration or
// TypeLiteralNode); both expose the same getProperties()/getMethods()/
// getCall|Construct|IndexSignatures() accessors. Get/set accessors only exist on
// interfaces (type literals cannot declare them), so those calls are guarded.
function extractObjectMembers(node: Node): ApiObjectMembers {
  const memberNode = node as any;
  // EDGE-4: use node as context for getText()
  const properties: ApiInterfaceProperty[] = memberNode.getProperties().map((p: any) => ({
    name: p.getName(),
    type: serializeType(p.getType(), node, p.getTypeNode()),
    isOptional: p.hasQuestionToken(),
    isReadonly: p.isReadonly(),
  }));

  // Interfaces may declare get/set accessors too (since TS 4.3). Model them as
  // properties, mirroring the class extraction: get-only is readonly, get+set is
  // mutable, and a distinct write (setter) type is preserved so a set-only
  // narrowing surfaces even when the getter is unchanged. Object-literal type
  // aliases cannot have accessors, so these accessors are simply empty there.
  const ifaceAccessors = new Map<string, ApiInterfaceProperty>();
  for (const g of memberNode.getGetAccessors?.() ?? []) {
    ifaceAccessors.set(g.getName(), {
      name: g.getName(),
      type: serializeType(g.getReturnType(), node, g.getReturnTypeNode()),
      isOptional: false,
      isReadonly: true,
    });
  }
  for (const s of memberNode.getSetAccessors?.() ?? []) {
    const param = s.getParameters()[0];
    const setterType: SerializedType = param
      ? serializeType(param.getType(), node, param.getTypeNode())
      : { text: 'unknown' };
    const existing = ifaceAccessors.get(s.getName());
    if (existing) {
      existing.isReadonly = false;
      if (setterType.text !== existing.type.text) existing.writeType = setterType;
    } else {
      ifaceAccessors.set(s.getName(), {
        name: s.getName(),
        type: setterType,
        isOptional: false,
        isReadonly: false,
      });
    }
  }
  for (const accessor of ifaceAccessors.values()) properties.push(accessor);

  // Group methods by name to merge overload signatures (getMethods() returns one node per overload)
  const methodMap = new Map<string, ApiInterfaceMethod>();
  for (const m of memberNode.getMethods()) {
    const methodName = m.getName();
    const existing = methodMap.get(methodName);
    if (existing) {
      existing.signatures.push(...convertFunctionSignatures(m));
      // TypeScript requires all overload signatures of a method to share the same
      // optionality ("Overload signatures must all be optional or required"), so
      // every `hasQuestionToken()` here agrees and the merge operator is immaterial.
      existing.isOptional = existing.isOptional && m.hasQuestionToken();
    } else {
      methodMap.set(methodName, {
        name: methodName,
        signatures: convertFunctionSignatures(m),
        isOptional: m.hasQuestionToken(),
      });
    }
  }
  const methods: ApiInterfaceMethod[] = [...methodMap.values()];

  // Call / construct / index signatures are part of the object's public shape;
  // getProperties()/getMethods() do not surface them, so removing or changing one
  // would otherwise be invisible (a silent patch).
  const callSignatures = memberNode.getCallSignatures().map((s: Node) => convertSignatureFromNode(s));
  const constructSignatures = memberNode.getConstructSignatures().map((s: Node) => convertSignatureFromNode(s));
  const indexSignatures: ApiIndexSignature[] = memberNode.getIndexSignatures().map((ix: any) => ({
    keyType: ix.getKeyTypeNode()?.getText() ?? normalizeTypeText(ix.getKeyType().getText()),
    valueType: serializeType(ix.getReturnType(), node, ix.getReturnTypeNode()),
    isReadonly: ix.isReadonly(),
  }));

  return { properties, methods, callSignatures, constructSignatures, indexSignatures };
}

function convertInterface(name: string, node: Node): ApiInterfaceSymbol {
  if (!Node.isInterfaceDeclaration(node)) return { kind: 'interface', name, properties: [], methods: [], typeParameters: [] };

  const { properties, methods, callSignatures, constructSignatures, indexSignatures } =
    extractObjectMembers(node);

  // Heritage (`extends Base, Other`): inherited members are NOT flattened into
  // `properties`/`methods`, so record the clause text. A type-alias <-> interface
  // conversion can't be proven shape-equal from own members alone when the
  // interface inherits a base (the base may add required members).
  const heritage = node.getExtends().map((e) => e.getText());

  return {
    kind: 'interface',
    name,
    properties,
    methods,
    typeParameters: convertTypeParams(node),
    callSignatures,
    constructSignatures,
    indexSignatures,
    heritage,
  };
}

function convertTypeAlias(name: string, node: Node): ApiTypeAliasSymbol {
  if (!Node.isTypeAliasDeclaration(node)) return { kind: 'type-alias', name, type: { text: 'unknown' }, typeParameters: [] };

  const result: ApiTypeAliasSymbol = {
    kind: 'type-alias',
    name,
    // EDGE-4: use node as context for getText()
    type: serializeType(node.getType(), node, node.getTypeNode()),
    typeParameters: convertTypeParams(node),
  };

  // A bare object-literal alias (`type X = { ... }`) is structurally an
  // interface. Capture its members so the classifier can diff it member-by-member
  // — an added required property then surfaces as a proven `required-property-added`
  // instead of an opaque whole-text `type-alias-changed`. Only a direct
  // TypeLiteral qualifies: unions, intersections, conditionals, mapped types, and
  // function-type aliases are NOT decomposed and keep their text comparison.
  const typeNode = node.getTypeNode();
  if (typeNode && Node.isTypeLiteral(typeNode)) {
    result.objectMembers = extractObjectMembers(typeNode);
  }

  return result;
}

function convertEnum(name: string, node: Node): ApiEnumSymbol {
  if (!Node.isEnumDeclaration(node)) return { kind: 'enum', name, members: [] };
  const members: ApiEnumMember[] = node.getMembers().map((m) => {
    const rawValue = m.getValue();
    return {
      name: m.getName(),
      value: rawValue !== undefined ? rawValue : undefined,
    };
  });
  return { kind: 'enum', name, members };
}

function convertClass(name: string, node: Node): ApiClassSymbol {
  if (!Node.isClassDeclaration(node)) return { kind: 'class', name, constructorSignatures: [], methods: [], properties: [], typeParameters: [] };

  // getConstructors() returns only the implementation signature; overload
  // signatures live on getOverloads(). Extract each overload separately (as we do
  // for function overloads) so callers see the real public arities — otherwise an
  // overload's required params look optional via the merged implementation sig.
  const ctors = node.getConstructors().flatMap((c) => {
    const overloads = c.getOverloads();
    const sigNodes = overloads.length > 0 ? overloads : [c];
    return sigNodes.map((s) => convertFunctionSignatures(s)[0] ?? { parameters: [], returnType: { text: 'void' }, typeParameters: [] });
  });

  // Group methods by name to merge overload signatures (getMethods() returns one node per overload)
  const classMethodMap = new Map<string, { name: string; signatures: ApiFunctionSignature[]; isStatic: boolean }>();
  for (const m of node.getMethods()) {
    if (
      m.hasModifier(SyntaxKind.PrivateKeyword) ||
      m.hasModifier(SyntaxKind.ProtectedKeyword) ||
      m.getName().startsWith('#')
    ) continue;
    const methodName = m.getName();
    const methodKey = `${m.isStatic() ? 'static' : 'instance'}:${methodName}`;
    const existing = classMethodMap.get(methodKey);
    if (existing) {
      existing.signatures.push(...convertFunctionSignatures(m));
    } else {
      classMethodMap.set(methodKey, {
        name: methodName,
        signatures: convertFunctionSignatures(m),
        isStatic: m.isStatic(),
      });
    }
  }
  const methods = [...classMethodMap.values()];

  const properties = node.getProperties()
    .filter((p) =>
      !p.hasModifier(SyntaxKind.PrivateKeyword) &&
      !p.hasModifier(SyntaxKind.ProtectedKeyword) &&
      !p.getName().startsWith('#'),
    )
    .map((p) => ({
      name: p.getName(),
      // EDGE-4: use node as context for getText()
      type: serializeType(p.getType(), node, p.getTypeNode()),
      isOptional: p.hasQuestionToken(),
      isReadonly: p.isReadonly(),
      isStatic: p.isStatic(),
    }));

  // Constructor parameter properties (`constructor(public x: string)`) declare
  // public instance members that getProperties() does not surface. Only public
  // ones reach the API surface; private/protected are excluded like fields are.
  for (const ctor of node.getConstructors()) {
    for (const p of ctor.getParameters()) {
      const isParamProperty =
        p.hasModifier(SyntaxKind.PublicKeyword) ||
        p.hasModifier(SyntaxKind.PrivateKeyword) ||
        p.hasModifier(SyntaxKind.ProtectedKeyword) ||
        p.hasModifier(SyntaxKind.ReadonlyKeyword);
      if (!isParamProperty) continue;
      if (p.hasModifier(SyntaxKind.PrivateKeyword) || p.hasModifier(SyntaxKind.ProtectedKeyword)) continue;
      properties.push({
        name: p.getName(),
        type: serializeType(p.getType(), node, p.getTypeNode()),
        isOptional: p.hasQuestionToken(),
        isReadonly: p.isReadonly(),
        isStatic: false,
      });
    }
  }

  // Get/set accessors define public members too. Model each name once: a
  // get-only accessor is readonly, a get+set pair is mutable, and a set-only
  // accessor takes its type from the setter parameter. Private/protected/`#`
  // accessors are not part of the public surface.
  const accessors = new Map<string, { name: string; type: SerializedType; writeType?: SerializedType; isOptional: boolean; isReadonly: boolean; isStatic: boolean }>();
  for (const g of node.getGetAccessors()) {
    if (
      g.hasModifier(SyntaxKind.PrivateKeyword) ||
      g.hasModifier(SyntaxKind.ProtectedKeyword) ||
      g.getName().startsWith('#')
    ) continue;
    accessors.set(`${g.isStatic() ? 'static' : 'instance'}:${g.getName()}`, {
      name: g.getName(),
      type: serializeType(g.getReturnType(), node, g.getReturnTypeNode()),
      isOptional: false,
      isReadonly: true,
      isStatic: g.isStatic(),
    });
  }
  for (const s of node.getSetAccessors()) {
    if (
      s.hasModifier(SyntaxKind.PrivateKeyword) ||
      s.hasModifier(SyntaxKind.ProtectedKeyword) ||
      s.getName().startsWith('#')
    ) continue;
    const key = `${s.isStatic() ? 'static' : 'instance'}:${s.getName()}`;
    const param = s.getParameters()[0];
    const setterType: SerializedType = param
      ? serializeType(param.getType(), node, param.getTypeNode())
      : { text: 'unknown' };
    const existing = accessors.get(key);
    if (existing) {
      existing.isReadonly = false;
      // A get/set pair can have distinct read/write types. Record the write
      // (setter) type only when it differs, so a set-only narrowing surfaces
      // even though the getter type is unchanged.
      if (setterType.text !== existing.type.text) existing.writeType = setterType;
    } else {
      accessors.set(key, {
        name: s.getName(),
        type: setterType,
        isOptional: false,
        isReadonly: false,
        isStatic: s.isStatic(),
      });
    }
  }
  for (const accessor of accessors.values()) properties.push(accessor);

  return {
    kind: 'class',
    name,
    constructorSignatures: ctors,
    methods,
    properties,
    typeParameters: convertTypeParams(node),
  };
}

function convertVariable(name: string, node: Node): ApiVariableSymbol {
  return {
    kind: 'variable',
    name,
    // EDGE-4: use node as context for getText()
    type: serializeType(node.getType(), node, (node as { getTypeNode?: () => Node | undefined }).getTypeNode?.()),
  };
}
