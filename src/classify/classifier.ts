import { Project, Node } from 'ts-morph';
import type { ApiSnapshot, ApiSymbol, ApiFunctionSymbol, ApiInterfaceSymbol, ApiInterfaceProperty, ApiInterfaceMethod, ApiEnumSymbol, ApiClassSymbol, ApiTypeAliasSymbol, ApiVariableSymbol, ApiNamespaceSymbol, ApiTypeParameter, ApiFunctionSignature, ApiIndexSignature } from '../extract/api-snapshot.js';
import type { ApiChange, Confidence } from '../types.js';
import { compareTypeText, type TypeRelation } from './variance.js';
import { computeLiteralSpans, isInsideLiteral } from './literal-spans.js';

// Confidence for a MAJOR emitted from a type-text comparison. The position
// records which variance direction is already known safe (and thus excluded
// before this major was emitted):
//   - 'param'     : contravariant — a widening was demoted to minor, so a major
//                   here is a narrowing/unrelated change, a genuine break.
//   - 'return'    : covariant — a narrowing was demoted to minor, so a major here
//                   is a widening/unrelated change, a genuine break.
//   - 'invariant' : type alias / variable / property — no direction is safe, so a
//                   one-directional relation still *could* be safe in practice
//                   (the verified FPs: clsx input-union widening). We can't prove
//                   it, so it is review-only.
// A bailed probe (null) is always review; a fully-resolved "unrelated" relation
// (both directions fail) is always proven — the tool decided the types share no
// assignability, which is structurally confident.
function typeChangeConfidence(relation: TypeRelation | null, position: 'param' | 'return' | 'invariant'): Confidence {
  if (relation === null) return 'heuristic';
  if (!relation.oldToNew && !relation.newToOld) return 'proven';
  return position === 'invariant' ? 'heuristic' : 'proven';
}

// Spread into a change literal: tags 'heuristic' explicitly, leaves 'proven'
// implicit (omitted, normalized to 'proven' by `diff()`). Keeps proven sites a
// zero-diff so confidence reads as the exception, not noise on every push.
function maybeHeuristic(confidence: Confidence): { confidence: 'heuristic' } | Record<string, never> {
  return confidence === 'heuristic' ? { confidence } : {};
}

interface InvariantCompare {
  equivalent: boolean;
  // Confidence of the *change* when not equivalent (meaningless when equivalent).
  confidence: Confidence;
}

// Compare two type texts in an invariant position (interface/class property),
// alpha-renaming the new text onto the container's generic scope first. Returns
// whether they are equivalent and, if not, the confidence of the resulting break.
function invariantTextCompare(
  oldText: string,
  newRaw: string,
  containerRename: Map<string, string> | null,
  ctx?: { typeParameters: ApiTypeParameter[] },
): InvariantCompare {
  const newText = renameTypeText(newRaw, containerRename);
  if (oldText === newText) return { equivalent: true, confidence: 'proven' };
  const relation = compareTypeText(oldText, newText, ctx);
  const equivalent = relation !== null && relation.oldToNew && relation.newToOld;
  return { equivalent, confidence: typeChangeConfidence(relation, 'invariant') };
}

// A property's read and write types are compared separately; the property is a
// proven break only when a *non-equivalent* side resolved to a genuine break.
function propTypeConfidence(read: InvariantCompare, write: InvariantCompare): Confidence {
  const provenBreak =
    (!read.equivalent && read.confidence === 'proven') ||
    (!write.equivalent && write.confidence === 'proven');
  return provenBreak ? 'proven' : 'heuristic';
}

// Spread into a signature/constructor wrapper change. The wrapper is proven when
// at least one of its major sub-changes is itself proven; if every major sub is
// review-only, so is the wrapper (and a non-major wrapper stays proven/omitted).
function maybeWrapper(subChanges: ApiChange[]): { confidence: 'heuristic' } | Record<string, never> {
  const majors = subChanges.filter((c) => c.severity === 'major');
  if (majors.length === 0) return {};
  return majors.some((c) => c.confidence !== 'heuristic') ? {} : { confidence: 'heuristic' };
}

// Build a rename map that lets us treat `<T>(x: T)` and `<S>(x: S)` as the same
// signature. The map projects each new type-parameter identifier onto its
// positional old counterpart so that a downstream textual comparison can
// recognise alpha-equivalent rewrites as no-ops. We bail (`null`) when the
// arities differ — that is a real generic-arity change and the existing
// classifier handles it — or when every name already matches.
function buildTypeParamRenameMap(
  oldTPs: ApiTypeParameter[],
  newTPs: ApiTypeParameter[],
): Map<string, string> | null {
  if (oldTPs.length !== newTPs.length || oldTPs.length === 0) return null;
  const map = new Map<string, string>();
  for (let i = 0; i < oldTPs.length; i++) {
    if (oldTPs[i].name !== newTPs[i].name) map.set(newTPs[i].name, oldTPs[i].name);
  }
  return map.size === 0 ? null : map;
}

// Combine a container-level rename (e.g. `interface Box<T>` vs `interface Box<S>`)
// with a signature-local rename so a single `renameTypeText` pass aligns the new
// text onto the old names across *both* scopes. Container entries whose key is
// shadowed by a signature-local type-parameter name are dropped — TypeScript's
// lexical scope makes the inner name win, so the container rename must not
// reach into a signature body that re-declares the same identifier.
function combineRenames(
  containerRename: Map<string, string> | null,
  sigRename: Map<string, string> | null,
  sigNames: Set<string>,
): Map<string, string> | null {
  const combined = new Map<string, string>();
  if (containerRename) {
    for (const [from, to] of containerRename) {
      if (!sigNames.has(from)) combined.set(from, to);
    }
  }
  if (sigRename) {
    for (const [from, to] of sigRename) {
      combined.set(from, to);
    }
  }
  return combined.size === 0 ? null : combined;
}

// Lexical binders introduce their own scope that a purely textual rename cannot
// reason about. `infer X` (inside a conditional) and a mapped-type key binder
// (`[K in ...]`) both declare names that can *shadow* an outer type parameter.
// Renaming `<S>` to `<T>` in `S extends Array<infer T> ? S : never` yields text
// identical to the structurally *different* `T extends Array<infer T> ? T :
// never` — where the branch `T` binds to the `infer` result, not the parameter
// — which would erase a real breaking change as a fast-path no-op. When a binder
// is present we therefore decline to rename, so the textual fast-path fails and
// the comparison falls through to the conservative variance / conditional-guard
// path (which bails to major for these unresolved generics).
function hasLexicalBinder(text: string): boolean {
  const spans = computeLiteralSpans(text);
  const inferRe = /\binfer\b/gu;
  let m: RegExpExecArray | null;
  while ((m = inferRe.exec(text)) !== null) {
    if (!isInsideLiteral(spans, m.index, m.index + 'infer'.length - 1)) return true;
  }
  // Mapped-type key declaration: `[ K in ... ]`. Indexed access (`T[K]`) has no
  // `in`, and a generic argument list (`Array<T>`) has no brackets, so neither
  // is matched.
  const mappedRe = /\[\s*[\p{ID_Start}$_][\p{ID_Continue}$]*\s+in\b/gu;
  while ((m = mappedRe.exec(text)) !== null) {
    if (!isInsideLiteral(spans, m.index, m.index)) return true;
  }
  return false;
}

// Wrapper so a bare type text parses as a complete statement; the trailing `)`
// and `;` close it. The prefix length is subtracted from node offsets to map
// back onto the original `text`.
const RENAME_PREFIX = 'type __sc_rename__ = (';

let renameProject: Project | undefined;
function getRenameProject(): Project {
  if (!renameProject) {
    renameProject = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: { noEmit: true, skipLibCheck: true },
    });
  }
  return renameProject;
}

// Apply a type-parameter rename to a serialized type text so that `<T>(x: T)`
// and `<S>(x: S)` are recognised as the same signature.
//
// The rename is AST-based: we parse the type and rewrite *only* identifiers in
// type-reference position (a `TypeReferenceNode`'s `typeName`). A purely textual
// substitution cannot tell a type-parameter use apart from an object-type
// property key (`{ T: number }`), a member-access qualifier (`Lib.T`), or a
// string literal type (`'T'`) — rewriting any of those fabricates a false
// equivalence and erases a real breaking change (e.g. a renamed public property
// key). Those positions are never a `TypeReference` type-name, so the AST walk
// skips them for free, which also subsumes the old regex's literal-span,
// member-access, and Unicode-boundary guards.
//
// `hasLexicalBinder` still bails: even a structurally correct rename can make
// the new name collide with an existing `infer` / mapped binder and silently
// shadow it, so we decline and let the conservative variance / guard path run.
function renameTypeText(text: string, mapping: Map<string, string> | null): string {
  if (!mapping || mapping.size === 0) return text;
  if (hasLexicalBinder(text)) return text;

  const project = getRenameProject();
  const sourceFile = project.createSourceFile('__sc_rename__.ts', `${RENAME_PREFIX}${text});`, {
    overwrite: true,
  });
  try {
    const edits: Array<{ start: number; end: number; to: string }> = [];
    sourceFile.forEachDescendant((node) => {
      if (!Node.isTypeReference(node)) return;
      const nameNode = node.getTypeName();
      // A `QualifiedName` (`Lib.T`) is member access, not a type-parameter use.
      if (!Node.isIdentifier(nameNode)) return;
      const to = mapping.get(nameNode.getText());
      if (to === undefined) return;
      edits.push({
        start: nameNode.getStart() - RENAME_PREFIX.length,
        end: nameNode.getEnd() - RENAME_PREFIX.length,
        to,
      });
    });
    if (edits.length === 0) return text;
    // Apply right-to-left so earlier offsets stay valid as we splice.
    edits.sort((a, b) => b.start - a.start);
    let result = text;
    for (const edit of edits) {
      result = result.slice(0, edit.start) + edit.to + result.slice(edit.end);
    }
    return result;
  } finally {
    project.removeSourceFile(sourceFile);
  }
}

export function classifyChanges(oldSnap: ApiSnapshot, newSnap: ApiSnapshot): ApiChange[] {
  const changes: ApiChange[] = [];

  const oldEntries = oldSnap.entrypoints;
  const newEntries = newSnap.entrypoints;

  // Removed entrypoints: dropping a published subpath breaks any consumer that
  // imports from it.
  for (const subpath of Object.keys(oldEntries)) {
    if (!newEntries[subpath]) {
      changes.push({
        kind: 'entrypoint-removed',
        severity: 'major',
        symbolPath: subpath,
        message: `Entry point '${subpath}' was removed`,
      });
    }
  }

  // Added entrypoints: a brand-new subpath is additive.
  for (const subpath of Object.keys(newEntries)) {
    if (!oldEntries[subpath]) {
      changes.push({
        kind: 'entrypoint-added',
        severity: 'minor',
        symbolPath: subpath,
        message: `Entry point '${subpath}' was added`,
      });
    }
  }

  // Common entrypoints: diff their symbols with the existing per-symbol logic.
  // The root '.' keeps bare symbol paths; subpaths prefix their symbols
  // (e.g. './utils#foo') so reports stay unambiguous across entry points. `#`
  // is chosen over `:` because GitHub Actions `::error::` property escaping
  // turns `:` into `%3A`, which would surface as `./utils%3Afoo` in annotations.
  for (const subpath of Object.keys(oldEntries)) {
    const newSymbols = newEntries[subpath];
    if (!newSymbols) continue;
    const prefix = subpath === '.' ? '' : `${subpath}#`;
    changes.push(...classifySymbolMap(oldEntries[subpath], newSymbols, prefix));
  }

  return changes;
}

// Compares two maps of exported symbols. `prefix` namespaces the symbol paths so
// the same logic can be reused for namespace bodies (prefix `Foo.`) recursively.
function classifySymbolMap(
  oldSymbols: Record<string, ApiSymbol>,
  newSymbols: Record<string, ApiSymbol>,
  prefix: string,
): ApiChange[] {
  const changes: ApiChange[] = [];

  // Removed exports
  for (const name of Object.keys(oldSymbols)) {
    if (!newSymbols[name]) {
      changes.push({
        kind: 'export-removed',
        severity: 'major',
        symbolPath: prefix + name,
        message: `Export '${prefix + name}' was removed`,
        oldValue: oldSymbols[name].kind,
      });
    }
  }

  // Added exports
  for (const name of Object.keys(newSymbols)) {
    if (!oldSymbols[name]) {
      changes.push({
        kind: 'export-added',
        severity: 'minor',
        symbolPath: prefix + name,
        message: `Export '${prefix + name}' was added`,
        newValue: newSymbols[name].kind,
      });
    }
  }

  // Changed exports
  for (const name of Object.keys(oldSymbols)) {
    const oldSym = oldSymbols[name];
    const newSym = newSymbols[name];
    if (!newSym) continue;

    changes.push(...classifySymbolChanges(prefix + name, oldSym, newSym));
  }

  return changes;
}

// Render one function signature as object-type-member syntax (no leading name):
// `<T>(x: string): number`. Used to reconstruct an interface's structural text.
function signatureMemberText(sig: ApiFunctionSignature): string {
  const tps = sig.typeParameters.length
    ? `<${sig.typeParameters
        .map(
          (tp) =>
            `${tp.name}${tp.constraint ? ` extends ${tp.constraint.text}` : ''}${tp.default ? ` = ${tp.default.text}` : ''}`,
        )
        .join(', ')}>`
    : '';
  const params = sig.parameters
    .map((p) => `${p.isRest ? '...' : ''}${p.name}${p.isOptional ? '?' : ''}: ${p.type.text}`)
    .join(', ');
  return `${tps}(${params}): ${sig.returnType.text}`;
}

// Render a method's signatures as a callable object type — `{ (a: string): void }`,
// or an overload set as `{ (a: string): void; (a: number): void }`. This is the
// type a method *member* would have if written as a function-typed property, so a
// shorthand-vs-property refactor (`f(): void` <-> `f: () => void`, which TypeScript
// treats as mutually assignable) can be compared as types rather than read as a
// remove-and-re-add of two different member kinds.
function methodAsPropertyText(m: ApiInterfaceMethod): string {
  return `{ ${m.signatures.map(signatureMemberText).join('; ')} }`;
}

// Reconstruct an interface as the equivalent object-type text so it can be
// compared structurally against a type alias. The output need not be byte-perfect
// TypeScript: if it fails to parse, the variance probe yields an undecidable
// relation and the caller keeps the conservative major verdict.
function interfaceToTypeText(iface: ApiInterfaceSymbol): string {
  const members: string[] = [];
  for (const p of iface.properties) {
    members.push(`${p.isReadonly ? 'readonly ' : ''}${p.name}${p.isOptional ? '?' : ''}: ${p.type.text}`);
    // A get/set accessor whose setter type differs from the getter (write-side
    // narrowing) is breaking even though the read type is unchanged. A type-alias
    // property cannot express a divergent write type, so emitting it as an extra
    // synthetic member guarantees the canonical shapes differ — the comparison can
    // never silently equate a narrowed setter with a plain property.
    if (p.writeType) members.push(`${p.name} [[write]]: ${p.writeType.text}`);
  }
  for (const m of iface.methods) {
    for (const sig of m.signatures) {
      members.push(`${m.name}${m.isOptional ? '?' : ''}${signatureMemberText(sig)}`);
    }
  }
  for (const sig of iface.callSignatures ?? []) members.push(signatureMemberText(sig));
  for (const sig of iface.constructSignatures ?? []) members.push(`new ${signatureMemberText(sig)}`);
  for (const ix of iface.indexSignatures ?? []) {
    members.push(`${ix.isReadonly ? 'readonly ' : ''}[__key: ${ix.keyType}]: ${ix.valueType.text}`);
  }
  return `{ ${members.join('; ')} }`;
}

// Canonical, order-independent rendering of an object-literal type's members:
// split on top-level `;`, normalize whitespace, sort. Returns null when the text
// is not an object literal (`{ ... }`) — e.g. a union or primitive alias, which a
// shape comparison cannot vouch for. Member types are compared as text, so an
// equal result is a *sufficient* (not necessary) proof of structural identity and
// needs no type resolution — unlike the variance probe, which bails on the
// package-internal types that interface members routinely reference.
function canonicalObjectShape(text: string): string | null {
  const t = text.trim();
  if (!t.startsWith('{') || !t.endsWith('}')) return null;
  const inner = t.slice(1, -1);
  const members: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let buf = '';
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote) {
      buf += ch;
      if (ch === quote && inner[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    else if (ch === '}' || ch === ')' || ch === ']') depth--;
    if (ch === ';' && depth === 0) {
      members.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  members.push(buf);
  const norm = members
    .map((m) => m.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    // Normalize an index signature's key *name* (the identifier is arbitrary:
    // `[k: string]` and `[__key: string]` denote the same signature). Only the
    // leading `[ident:` is rewritten — the key *type*, value type, and `readonly`
    // are preserved, so distinct index signatures never collapse. `[K in ...]`
    // mapped types are not matched (they have `in`, not `:`), and a nested index
    // signature inside a member value is left untouched (it is not at offset 0).
    .map((m) => m.replace(/^(readonly )?\[\s*[A-Za-z_$][\w$]*\s*:/, '$1[__key:'))
    .sort();
  return norm.length ? norm.join('; ') : '{empty}';
}

// A type alias and an interface that describe the same shape are interchangeable
// for every consumer (`type X = {...}` <-> `interface X {...}` is a routine,
// non-breaking refactor). Type parameters are aligned by alpha-rename so
// `type X<T> = {...}` and `interface X<S> {...}` still match. Equivalence is
// proven only by an identical canonical member set — deliberately NOT by
// structural assignability, which is blind to write-side breaks: TypeScript
// reports `{ a: T }` and `{ readonly a: T }` (and a narrowed setter) as mutually
// assignable, so an assignability check would erase a real breaking change. The
// canonical text comparison preserves `readonly`, optionality, and a synthetic
// write-type member, so any of those differing leaves the conservative major
// verdict in place. (A purely stylistic member rewrite that text comparison can't
// see through stays conservatively major — sound, never a false negative.)
function typeAliasInterfaceEquivalent(ta: ApiTypeAliasSymbol, iface: ApiInterfaceSymbol): boolean {
  if (ta.typeParameters.length !== iface.typeParameters.length) return false;
  // An `extends` clause pulls in inherited members that are not part of the
  // interface's own captured members, so the canonical shape would understate the
  // real type (a base may add required members). Can't prove equivalence — stay
  // conservatively major.
  if ((iface.heritage?.length ?? 0) > 0) return false;
  const rename = buildTypeParamRenameMap(ta.typeParameters, iface.typeParameters);
  const aliasText = ta.type.text;
  const ifaceText = renameTypeText(interfaceToTypeText(iface), rename);
  if (aliasText.trim() === ifaceText.trim()) return true;
  const aliasShape = canonicalObjectShape(aliasText);
  return aliasShape !== null && aliasShape === canonicalObjectShape(ifaceText);
}

function classifySymbolChanges(name: string, oldSym: ApiSymbol, newSym: ApiSymbol): ApiChange[] {
  if (oldSym.kind !== newSym.kind) {
    // A type-alias <-> interface conversion with a structurally equivalent shape
    // is a non-breaking refactor, not an export removal.
    const taIfacePair =
      oldSym.kind === 'type-alias' && newSym.kind === 'interface'
        ? ([oldSym, newSym] as const)
        : oldSym.kind === 'interface' && newSym.kind === 'type-alias'
          ? ([newSym as ApiTypeAliasSymbol, oldSym as ApiInterfaceSymbol] as const)
          : null;
    if (taIfacePair && typeAliasInterfaceEquivalent(taIfacePair[0], taIfacePair[1])) {
      // The shapes match, but a concurrent type-parameter constraint/default change
      // (`<T extends string>` -> `<T extends number>`) is still breaking and lives
      // only in classifyTypeParamChanges. Read the params straight off old/new so
      // the diff stays old->new regardless of which side is the alias. Generics are
      // written explicitly in both forms, so this is a 'type' context.
      const oldTPs = (oldSym as ApiTypeAliasSymbol | ApiInterfaceSymbol).typeParameters;
      const newTPs = (newSym as ApiTypeAliasSymbol | ApiInterfaceSymbol).typeParameters;
      return classifyTypeParamChanges(name, oldTPs, newTPs, 'type');
    }
    return [{
      kind: 'export-removed',
      severity: 'major',
      symbolPath: name,
      message: `'${name}' changed kind from '${oldSym.kind}' to '${newSym.kind}'`,
      oldValue: oldSym.kind,
      newValue: newSym.kind,
    }];
  }

  switch (oldSym.kind) {
    case 'function':
      return classifyFunctionChanges(name, oldSym, newSym as ApiFunctionSymbol);
    case 'interface':
      return classifyInterfaceChanges(name, oldSym, newSym as ApiInterfaceSymbol);
    case 'enum':
      return classifyEnumChanges(name, oldSym, newSym as ApiEnumSymbol);
    case 'class':
      return classifyClassChanges(name, oldSym, newSym as ApiClassSymbol);
    case 'type-alias':
      return classifyTypeAliasChanges(name, oldSym as ApiTypeAliasSymbol, newSym as ApiTypeAliasSymbol);
    case 'variable':
      return classifyVariableChanges(name, oldSym as ApiVariableSymbol, newSym as ApiVariableSymbol);
    case 'namespace':
      return classifySymbolMap(
        (oldSym as ApiNamespaceSymbol).symbols,
        (newSym as ApiNamespaceSymbol).symbols,
        `${name}.`,
      );
    default:
      return [];
  }
}

// Two generic-parameter defaults are interchangeable when they are mutually
// assignable: a consumer that omits the argument type-checks identically against
// either. Sibling type parameters are supplied as variance context so a default
// that references an earlier parameter (`<T, U = T>`) resolves rather than bailing.
// An undecidable relation (null) is treated as not-equivalent — the caller keeps
// the conservative major verdict.
//
// NOTE: there is deliberately NO `newDefault === 'any'` widening shortcut. It is
// unsound for conditional/distributive defaults — `<T = unknown>` -> `<T = any>`
// inside `T extends U ? ... : ...` can distribute and widen the resolved output
// of an omitting consumer (e.g. a literal-union result broadens), a real break.
// `compareTypeText` already bails (-> null -> major) whenever `any` is mentioned,
// so any default involving `any` stays conservatively major here.
function defaultsAreEquivalent(
  oldDefault: string,
  newDefault: string,
  typeParameters: ApiTypeParameter[],
): boolean {
  if (oldDefault === newDefault) return true;
  const relation = compareTypeText(oldDefault, newDefault, { typeParameters });
  return relation !== null && relation.oldToNew && relation.newToOld;
}

// `genericContext` records where the type parameters live. In a *callable*
// context (a function/method signature) adding a parameter without a default is
// only a break when call sites pass explicit type arguments — and a return-only
// parameter (the verified nanoid FP) is inferred at the constraint and stays
// compatible — so `generic-param-required` is review-only. In a *type* context
// (interface/class/type-alias) the argument is always written explicitly, so the
// addition is a proven break.
function classifyTypeParamChanges(
  symbolPath: string,
  oldTPs: ApiTypeParameter[],
  newTPs: ApiTypeParameter[],
  genericContext: 'callable' | 'type',
): ApiChange[] {
  const changes: ApiChange[] = [];

  // Removed type parameters (breaking)
  for (let i = newTPs.length; i < oldTPs.length; i++) {
    changes.push({
      kind: 'generic-param-removed',
      severity: 'major',
      symbolPath,
      message: `Generic parameter '${oldTPs[i].name}' was removed from '${symbolPath}'`,
      oldValue: oldTPs[i].name,
    });
  }

  // Added type parameters
  for (let i = oldTPs.length; i < newTPs.length; i++) {
    const tp = newTPs[i];
    if (!tp.hasDefault) {
      changes.push({
        kind: 'generic-param-required',
        severity: 'major',
        symbolPath,
        message: `Required generic parameter '${tp.name}' was added to '${symbolPath}'`,
        newValue: tp.name,
        ...(genericContext === 'callable' ? { confidence: 'heuristic' as const } : {}),
      });
    } else {
      changes.push({
        kind: 'generic-param-with-default',
        severity: 'minor',
        symbolPath,
        message: `Generic parameter '${tp.name}' with default was added to '${symbolPath}'`,
        newValue: tp.name,
      });
    }
  }
  // Compare constraints of existing type parameters. Alpha-rename lets us treat
  // `<T extends Box<T>>` and `<S extends Box<S>>` as the same constraint —
  // without it, the rename inside the constraint body would surface as a
  // spurious `generic-constraint-changed` MAJOR even though the constraint is
  // structurally identical.
  const commonCount = Math.min(oldTPs.length, newTPs.length);
  const tpRename = buildTypeParamRenameMap(oldTPs.slice(0, commonCount), newTPs.slice(0, commonCount));
  for (let i = 0; i < commonCount; i++) {
    const oldConstraint = oldTPs[i].constraint?.text ?? null;
    const newConstraintRaw = newTPs[i].constraint?.text ?? null;
    const newConstraintForCompare = newConstraintRaw === null ? null : renameTypeText(newConstraintRaw, tpRename);
    if (oldConstraint !== newConstraintForCompare) {
      changes.push({
        kind: 'generic-constraint-changed',
        severity: 'major',
        symbolPath,
        message: `Generic constraint on '${oldTPs[i].name}' changed in '${symbolPath}'`,
        oldValue: oldConstraint ?? '(none)',
        newValue: newConstraintRaw ?? '(none)',
        // A bare constraint-text difference; whether it actually narrows the
        // accepted arguments is not resolved here.
        confidence: 'heuristic',
      });
    }

    // Default type arguments. Removing or changing a default breaks consumers
    // that rely on it (`X` resolves differently or no longer omits the arg);
    // adding one is a backward-compatible relaxation. Alpha-rename aligns the
    // new default onto the old parameter names so `<T = Box<T>>` and
    // `<S = Box<S>>` are recognised as the same default.
    const oldDefault = oldTPs[i].default?.text ?? null;
    const newDefaultRaw = newTPs[i].default?.text ?? null;
    const newDefaultForCompare = newDefaultRaw === null ? null : renameTypeText(newDefaultRaw, tpRename);
    if (oldDefault !== newDefaultForCompare) {
      if (oldDefault === null) {
        changes.push({
          kind: 'generic-param-default-added',
          severity: 'minor',
          symbolPath,
          message: `Default added to generic parameter '${oldTPs[i].name}' in '${symbolPath}'`,
          newValue: newDefaultRaw ?? '(none)',
        });
      } else if (
        newDefaultForCompare !== null &&
        defaultsAreEquivalent(oldDefault, newDefaultForCompare, oldTPs.slice(0, commonCount))
      ) {
        // A default change only breaks consumers who omit the argument, and only
        // when the type they now receive is incompatible. Mutually-assignable
        // defaults (e.g. `unknown` <-> `any`, or `readonly T[]` <-> `ReadonlyArray<T>`)
        // leave every omitting call site type-checking identically, so this is a
        // no-op. Concrete narrowing such as `string` -> `number` is NOT mutually
        // assignable and still falls through to the major branch below.
      } else {
        changes.push({
          kind: 'generic-param-default-changed',
          severity: 'major',
          symbolPath,
          message: `Default of generic parameter '${oldTPs[i].name}' changed in '${symbolPath}'`,
          oldValue: oldDefault,
          newValue: newDefaultRaw ?? '(none)',
          // The default only matters to consumers that omit the argument, and only
          // when the new default is incompatible. We could not prove that, so the
          // major is review-only.
          confidence: 'heuristic',
        });
      }
    }
  }

  return changes;
}

// `extraTypeParameters` supplies the *container* generic scope when the
// signature is nested inside an interface / class (e.g. `interface Box<T> { f(x: T): T }`).
// The container parameters are merged into the variance context so bare
// generics resolve, with signature-local names shadowing same-named outer
// parameters (TypeScript's lexical scope rule); duplicates are dropped before
// they reach the synthesis to keep the probe declaration-error-free.
// `extraRename` carries the container-level alpha-rename map (e.g. when the
// container itself was renamed from `<T>` to `<S>`); it is combined with the
// signature-local rename so the new text is aligned to the old container *and*
// signature names before textual / variance comparison.
function compareFunctionSignature(
  symbolPath: string,
  oldSig: ApiFunctionSignature,
  newSig: ApiFunctionSignature,
  extraTypeParameters?: { old: ApiTypeParameter[]; new: ApiTypeParameter[] },
  extraRename?: Map<string, string> | null,
): ApiChange[] {
  const changes: ApiChange[] = [];
  const oldParams = oldSig.parameters;
  const newParams = newSig.parameters;
  const sigRename = buildTypeParamRenameMap(oldSig.typeParameters, newSig.typeParameters);
  // Union both sides so the asymmetric case (old uses `<T>`, new uses `<U>`,
  // container also uses `<U>`) cannot accidentally include the container TP
  // *under the new name* and shadow the signature scope of the rewritten text.
  const sigNames = new Set<string>([
    ...oldSig.typeParameters.map((tp) => tp.name),
    ...newSig.typeParameters.map((tp) => tp.name),
  ]);
  const tpRename = combineRenames(extraRename ?? null, sigRename, sigNames);
  const oldContextTPs: ApiTypeParameter[] = [
    ...(extraTypeParameters?.old.filter((tp) => !sigNames.has(tp.name)) ?? []),
    ...oldSig.typeParameters,
  ];

  for (let i = oldParams.length; i < newParams.length; i++) {
    const p = newParams[i];
    if (!p.isOptional && !p.isRest) {
      changes.push({
        kind: 'required-param-added',
        severity: 'major',
        symbolPath,
        message: `Required parameter '${p.name}' was added to '${symbolPath}'`,
        newValue: `${p.name}: ${p.type.text}`,
      });
    } else {
      changes.push({
        kind: 'optional-param-added',
        severity: 'minor',
        symbolPath,
        message: `Optional parameter '${p.name}' was added to '${symbolPath}'`,
        newValue: `${p.name}?: ${p.type.text}`,
      });
    }
  }

  for (let i = newParams.length; i < oldParams.length; i++) {
    changes.push({
      kind: 'param-removed',
      severity: 'major',
      symbolPath,
      message: `Parameter '${oldParams[i].name}' was removed from '${symbolPath}'`,
      oldValue: `${oldParams[i].name}: ${oldParams[i].type.text}`,
    });
  }

  const minLen = Math.min(oldParams.length, newParams.length);
  for (let i = 0; i < minLen; i++) {
    const oldP = oldParams[i];
    const newP = newParams[i];
    // A rest <-> non-rest change rewrites the call-site arity contract (e.g.
    // `f("a", "b")` vs `f(["a", "b"])`), so it is always breaking and takes
    // priority over — and subsumes — any concurrent type change. Only when the
    // rest modifier is unchanged do we apply variance analysis to the type.
    if (oldP.isRest !== newP.isRest) {
      changes.push({
        kind: 'param-type-changed',
        severity: 'major',
        symbolPath: `${symbolPath}.${oldP.name}`,
        message: `Parameter '${oldP.name}' rest modifier changed in '${symbolPath}'`,
        oldValue: oldP.isRest ? `...${oldP.name}: ${oldP.type.text}` : `${oldP.name}: ${oldP.type.text}`,
        newValue: newP.isRest ? `...${newP.name}: ${newP.type.text}` : `${newP.name}: ${newP.type.text}`,
      });
    } else if (oldP.type.text !== renameTypeText(newP.type.text, tpRename)) {
      // Parameters are contravariant: existing callers keep passing the *old*
      // type, so a change is non-breaking only if the old type is still assignable
      // to the new one (widening). Equivalent texts (e.g. `readonly T[]` vs
      // `ReadonlyArray<T>`) are no-ops. Undecidable relations stay conservatively major.
      // The new text is alpha-renamed onto the old type-parameter names so that
      // a pure generic rename (`<T>(x: T)` → `<S>(x: S)`) collapses to a no-op
      // before variance probing runs. The shared type-parameter scope is also
      // handed to variance so bare generics (`T | undefined` vs `T`) resolve
      // against same-named declarations instead of bailing as undecidable.
      const relation = compareTypeText(
        oldP.type.text,
        renameTypeText(newP.type.text, tpRename),
        { typeParameters: oldContextTPs },
      );
      const equivalent = relation !== null && relation.oldToNew && relation.newToOld;
      if (!equivalent) {
        if (relation !== null && relation.oldToNew) {
          changes.push({
            kind: 'param-type-widened',
            severity: 'minor',
            symbolPath: `${symbolPath}.${oldP.name}`,
            message: `Parameter '${oldP.name}' type widened in '${symbolPath}'`,
            oldValue: oldP.type.text,
            newValue: newP.type.text,
          });
        } else {
          changes.push({
            kind: 'param-type-changed',
            severity: 'major',
            symbolPath: `${symbolPath}.${oldP.name}`,
            message: `Parameter '${oldP.name}' type changed in '${symbolPath}'`,
            oldValue: oldP.type.text,
            newValue: newP.type.text,
            ...maybeHeuristic(typeChangeConfidence(relation, 'param')),
          });
        }
      }
    }
    // Rest params are represented as optional in extracted signatures.
    // Do not double-report rest changes as optionality changes.
    if (!oldP.isRest && !newP.isRest && !oldP.isOptional && newP.isOptional) {
      changes.push({
        kind: 'optional-param-added',
        severity: 'minor',
        symbolPath: `${symbolPath}.${oldP.name}`,
        message: `Parameter '${oldP.name}' became optional in '${symbolPath}'`,
      });
    }
    if (!oldP.isRest && !newP.isRest && oldP.isOptional && !newP.isOptional) {
      changes.push({
        kind: 'required-param-added',
        severity: 'major',
        symbolPath: `${symbolPath}.${oldP.name}`,
        message: `Parameter '${oldP.name}' became required in '${symbolPath}'`,
      });
    }
  }

  // Return types are covariant: consumers expect the *old* type, so a change is
  // non-breaking only if the new type is still assignable to the old one
  // (narrowing). Equivalent texts are no-ops; undecidable relations stay major.
  if (oldSig.returnType.text !== renameTypeText(newSig.returnType.text, tpRename)) {
    const relation = compareTypeText(
      oldSig.returnType.text,
      renameTypeText(newSig.returnType.text, tpRename),
      { typeParameters: oldContextTPs },
    );
    const equivalent = relation !== null && relation.oldToNew && relation.newToOld;
    if (!equivalent) {
      if (relation !== null && relation.newToOld) {
        changes.push({
          kind: 'return-type-narrowed',
          severity: 'minor',
          symbolPath,
          message: `Return type of '${symbolPath}' narrowed`,
          oldValue: oldSig.returnType.text,
          newValue: newSig.returnType.text,
        });
      } else {
        changes.push({
          kind: 'return-type-changed',
          severity: 'major',
          symbolPath,
          message: `Return type of '${symbolPath}' changed`,
          oldValue: oldSig.returnType.text,
          newValue: newSig.returnType.text,
          ...maybeHeuristic(typeChangeConfidence(relation, 'return')),
        });
      }
    }
  }

  return changes;
}

function classifyFunctionChanges(name: string, oldFn: ApiFunctionSymbol, newFn: ApiFunctionSymbol): ApiChange[] {
  const changes: ApiChange[] = [];

  // Overload removed (breaking)
  if (newFn.signatures.length < oldFn.signatures.length) {
    changes.push({
      kind: 'overload-removed',
      severity: 'major',
      symbolPath: name,
      message: `Overload was removed from '${name}'`,
      oldValue: String(oldFn.signatures.length),
      newValue: String(newFn.signatures.length),
    });
  }

  // Overload added
  if (newFn.signatures.length > oldFn.signatures.length) {
    changes.push({
      kind: 'overload-added',
      severity: 'minor',
      symbolPath: name,
      message: `Overload was added to '${name}'`,
      oldValue: String(oldFn.signatures.length),
      newValue: String(newFn.signatures.length),
    });
  }

  // Compare all matching signature pairs
  const pairCount = Math.min(oldFn.signatures.length, newFn.signatures.length);
  for (let i = 0; i < pairCount; i++) {
    const oldSig = oldFn.signatures[i];
    const newSig = newFn.signatures[i];
    changes.push(...compareFunctionSignature(name, oldSig, newSig));
    changes.push(...classifyTypeParamChanges(name, oldSig.typeParameters, newSig.typeParameters, 'callable'));
  }

  return changes;
}

// Canonical text of a call/construct signature, used to compare interface
// call/construct signature lists. Two signatures are the same iff their keys
// match. This is a conservative textual comparison (no variance relaxation):
// any real change surfaces as a major, an identical list is a no-op. An
// optional `rename` aligns the new side onto the old container's generic names
// so a pure container rename (`interface F<T> { (x: T): T }` vs `<S>`) collapses
// to a no-op; a rename of the signature's *own* type parameter stays an
// over-conservative major (acceptable under the false-major-is-safe asymmetry).
function signatureKey(sig: ApiFunctionSignature, rename: Map<string, string> | null = null): string {
  const tps = sig.typeParameters
    .map((tp) =>
      tp.name +
      (tp.constraint ? ` extends ${renameTypeText(tp.constraint.text, rename)}` : '') +
      (tp.default ? ` = ${renameTypeText(tp.default.text, rename)}` : ''),
    )
    .join(', ');
  const params = sig.parameters
    .map((p) => `${p.isRest ? '...' : ''}${p.name}${p.isOptional ? '?' : ''}: ${renameTypeText(p.type.text, rename)}`)
    .join(', ');
  return `${tps ? `<${tps}>` : ''}(${params}) => ${renameTypeText(sig.returnType.text, rename)}`;
}

function indexSignatureKey(ix: ApiIndexSignature, rename: Map<string, string> | null = null): string {
  return `${ix.isReadonly ? 'readonly ' : ''}[${ix.keyType}]: ${renameTypeText(ix.valueType.text, rename)}`;
}

function sortedKeys<T>(items: T[] | undefined, toKey: (item: T) => string): string[] {
  return (items ?? []).map(toKey).sort();
}

// The container rename, minus any name shadowed by a signature's own type
// parameters (TypeScript's lexical scope makes the inner name win).
function renameForSignature(
  containerRename: Map<string, string> | null,
  sig: ApiFunctionSignature,
): Map<string, string> | null {
  return combineRenames(containerRename, null, new Set(sig.typeParameters.map((tp) => tp.name)));
}

function classifyInterfaceChanges(name: string, oldIf: ApiInterfaceSymbol, newIf: ApiInterfaceSymbol): ApiChange[] {
  const changes: ApiChange[] = [];
  // Container-level rename so a generic-only rewrite (`interface Box<T>` vs
  // `interface Box<S>`) collapses to a no-op for every nested property /
  // method that mentions the parameter.
  const containerRename = buildTypeParamRenameMap(oldIf.typeParameters, newIf.typeParameters);
  const oldProps = new Map(oldIf.properties.map((p) => [p.name, p]));
  const newProps = new Map(newIf.properties.map((p) => [p.name, p]));
  const oldMethods = new Map(oldIf.methods.map((m) => [m.name, m]));
  const newMethods = new Map(newIf.methods.map((m) => [m.name, m]));

  // A member written as a function-typed property on one side and as a method on
  // the other (`f: () => void` <-> `f(): void`) is the same member in a different
  // syntactic form, not a removal plus an unrelated addition. Collect those names
  // so the four remove/add loops skip them and the reconciliation pass below
  // compares them as types instead of emitting two spurious structural majors.
  const crossForm = new Set<string>();
  for (const n of oldProps.keys()) if (newMethods.has(n)) crossForm.add(n);
  for (const n of oldMethods.keys()) if (newProps.has(n)) crossForm.add(n);

  // Removed properties
  for (const [propName, prop] of oldProps) {
    if (!newProps.has(propName) && !crossForm.has(propName)) {
      changes.push({
        kind: 'property-removed',
        severity: 'major',
        symbolPath: `${name}.${propName}`,
        message: `Property '${propName}' was removed from interface '${name}'`,
        oldValue: prop.type.text,
      });
    }
  }

  // Added properties
  for (const [propName, prop] of newProps) {
    if (!oldProps.has(propName) && !crossForm.has(propName)) {
      if (!prop.isOptional) {
        changes.push({
          kind: 'required-property-added',
          severity: 'major',
          symbolPath: `${name}.${propName}`,
          message: `Required property '${propName}' was added to interface '${name}'`,
          newValue: prop.type.text,
        });
      } else {
        changes.push({
          kind: 'optional-property-added',
          severity: 'minor',
          symbolPath: `${name}.${propName}`,
          message: `Optional property '${propName}' was added to interface '${name}'`,
          newValue: prop.type.text,
        });
      }
    }
  }

  // Changed properties. Properties sit in an invariant position (read + write),
  // so widening/narrowing alone is *not* relaxed to minor — only a structurally
  // equivalent rewrite (e.g. `readonly T[]` vs `ReadonlyArray<T>`) inside the
  // interface's generic scope is a true no-op. The container `typeParameters`
  // are passed as the variance context so bare generics inside the property
  // type resolve against same-named declarations.
  for (const [propName, oldProp] of oldProps) {
    const newProp = newProps.get(propName);
    if (!newProp) continue;
    // Properties are invariant; an accessor pair can carry a distinct write
    // (setter) type, so compare both the read type and the effective write type.
    const ifaceCtx = { typeParameters: oldIf.typeParameters };
    const read = invariantTextCompare(oldProp.type.text, newProp.type.text, containerRename, ifaceCtx);
    const write = invariantTextCompare(
      oldProp.writeType?.text ?? oldProp.type.text,
      newProp.writeType?.text ?? newProp.type.text,
      containerRename,
      ifaceCtx,
    );
    if (!read.equivalent || !write.equivalent) {
      const describe = (p: ApiInterfaceProperty): string =>
        p.writeType ? `${p.type.text} (set: ${p.writeType.text})` : p.type.text;
      changes.push({
        kind: 'property-type-changed',
        severity: 'major',
        symbolPath: `${name}.${propName}`,
        message: `Property '${propName}' type changed in interface '${name}'`,
        oldValue: describe(oldProp),
        newValue: describe(newProp),
        ...maybeHeuristic(propTypeConfidence(read, write)),
      });
    }
    if (oldProp.isOptional && !newProp.isOptional) {
      changes.push({
        kind: 'interface-property-became-required',
        severity: 'major',
        symbolPath: `${name}.${propName}`,
        message: `Property '${propName}' became required in interface '${name}'`,
      });
    }
    if (!oldProp.isOptional && newProp.isOptional) {
      changes.push({
        kind: 'interface-property-became-optional',
        severity: 'minor',
        symbolPath: `${name}.${propName}`,
        message: `Property '${propName}' became optional in interface '${name}'`,
      });
    }
    if (!oldProp.isReadonly && newProp.isReadonly) {
      changes.push({
        kind: 'interface-property-became-readonly',
        severity: 'major',
        symbolPath: `${name}.${propName}`,
        message: `Property '${propName}' became readonly in interface '${name}'`,
      });
    }
    if (oldProp.isReadonly && !newProp.isReadonly) {
      changes.push({
        kind: 'interface-property-became-mutable',
        severity: 'minor',
        symbolPath: `${name}.${propName}`,
        message: `Property '${propName}' became mutable in interface '${name}'`,
      });
    }
  }

  // Reconcile members that switched between property and method form. A method is
  // normalized to its callable-object text so the two forms compare as types: an
  // equivalent pair (the `f: () => void` <-> `f(): void` refactor) is a no-op, and
  // a genuine difference surfaces as a single property-type-changed rather than the
  // remove + re-add the disjoint property/method maps would otherwise produce.
  const viewOf = (p?: ApiInterfaceProperty, m?: ApiInterfaceMethod) =>
    p
      ? { typeText: p.type.text, writeText: p.writeType?.text, isOptional: p.isOptional, isReadonly: p.isReadonly }
      : { typeText: methodAsPropertyText(m!), writeText: undefined as string | undefined, isOptional: m!.isOptional, isReadonly: false };
  for (const memberName of crossForm) {
    const oldView = viewOf(oldProps.get(memberName), oldMethods.get(memberName));
    const newView = viewOf(newProps.get(memberName), newMethods.get(memberName));
    const ifaceCtx = { typeParameters: oldIf.typeParameters };
    const read = invariantTextCompare(oldView.typeText, newView.typeText, containerRename, ifaceCtx);
    const write = invariantTextCompare(
      oldView.writeText ?? oldView.typeText,
      newView.writeText ?? newView.typeText,
      containerRename,
      ifaceCtx,
    );
    if (!read.equivalent || !write.equivalent) {
      changes.push({
        kind: 'property-type-changed',
        severity: 'major',
        symbolPath: `${name}.${memberName}`,
        message: `Member '${memberName}' changed between property and method form in '${name}'`,
        oldValue: oldView.typeText,
        newValue: newView.typeText,
        ...maybeHeuristic(propTypeConfidence(read, write)),
      });
    }
    if (oldView.isOptional && !newView.isOptional) {
      changes.push({
        kind: 'interface-property-became-required',
        severity: 'major',
        symbolPath: `${name}.${memberName}`,
        message: `Member '${memberName}' became required in interface '${name}'`,
      });
    }
    if (!oldView.isOptional && newView.isOptional) {
      changes.push({
        kind: 'interface-property-became-optional',
        severity: 'minor',
        symbolPath: `${name}.${memberName}`,
        message: `Member '${memberName}' became optional in interface '${name}'`,
      });
    }
    if (!oldView.isReadonly && newView.isReadonly) {
      changes.push({
        kind: 'interface-property-became-readonly',
        severity: 'major',
        symbolPath: `${name}.${memberName}`,
        message: `Member '${memberName}' became readonly in interface '${name}'`,
      });
    }
    if (oldView.isReadonly && !newView.isReadonly) {
      changes.push({
        kind: 'interface-property-became-mutable',
        severity: 'minor',
        symbolPath: `${name}.${memberName}`,
        message: `Member '${memberName}' became mutable in interface '${name}'`,
      });
    }
  }

  // Methods (maps built above to compute the cross-form set)
  for (const [methodName] of oldMethods) {
    if (!newMethods.has(methodName) && !crossForm.has(methodName)) {
      changes.push({
        kind: 'interface-method-removed',
        severity: 'major',
        symbolPath: `${name}.${methodName}`,
        message: `Method '${methodName}' was removed from interface '${name}'`,
      });
    }
  }

  for (const [methodName] of newMethods) {
    if (!oldMethods.has(methodName) && !crossForm.has(methodName)) {
      const newMethod = newMethods.get(methodName);
      if (!newMethod) continue;
      changes.push({
        kind: newMethod.isOptional ? 'interface-method-added' : 'required-interface-method-added',
        severity: newMethod.isOptional ? 'minor' : 'major',
        symbolPath: `${name}.${methodName}`,
        message: `${newMethod.isOptional ? 'Optional' : 'Required'} method '${methodName}' was added to interface '${name}'`,
      });
    }
  }

  for (const [methodName, oldMethod] of oldMethods) {
    const newMethod = newMethods.get(methodName);
    if (!newMethod) continue;
    if (newMethod.signatures.length < oldMethod.signatures.length) {
      changes.push({
        kind: 'overload-removed',
        severity: 'major',
        symbolPath: `${name}.${methodName}`,
        message: `Overload was removed from interface method '${methodName}' in '${name}'`,
        oldValue: String(oldMethod.signatures.length),
        newValue: String(newMethod.signatures.length),
      });
    }
    if (newMethod.signatures.length > oldMethod.signatures.length) {
      changes.push({
        kind: 'overload-added',
        severity: 'minor',
        symbolPath: `${name}.${methodName}`,
        message: `Overload was added to interface method '${methodName}' in '${name}'`,
        oldValue: String(oldMethod.signatures.length),
        newValue: String(newMethod.signatures.length),
      });
    }
    const pairCount = Math.min(oldMethod.signatures.length, newMethod.signatures.length);
    const allSigChanges: ApiChange[] = [];
    for (let i = 0; i < pairCount; i++) {
      const oldSig = oldMethod.signatures[i];
      const newSig = newMethod.signatures[i];
      if (!oldSig || !newSig) continue;
      allSigChanges.push(
        ...compareFunctionSignature(
          `${name}.${methodName}`,
          oldSig,
          newSig,
          { old: oldIf.typeParameters, new: newIf.typeParameters },
          containerRename,
        ),
      );
      allSigChanges.push(...classifyTypeParamChanges(`${name}.${methodName}`, oldSig.typeParameters, newSig.typeParameters, 'callable'));
    }
    if (allSigChanges.length > 0) {
      changes.push({
        kind: 'interface-method-signature-changed',
        // Wrapper severity mirrors its sub-changes: a method whose only change is
        // a safe param widening / return narrowing must not be forced to major.
        severity: allSigChanges.some((c) => c.severity === 'major') ? 'major' : 'minor',
        symbolPath: `${name}.${methodName}`,
        message: `Method '${methodName}' signature changed in interface '${name}'`,
        ...maybeWrapper(allSigChanges),
      });
      changes.push(...allSigChanges);
    }
  }

  // Call / construct / index signatures. These are part of the interface's
  // public shape but live outside properties/methods, so a removed or changed
  // signature would otherwise be a silent patch. Compared as canonical-text
  // multisets: a difference is conservatively major, an identical set a no-op.
  const oldCalls = sortedKeys(oldIf.callSignatures, (s) => signatureKey(s));
  const newCalls = sortedKeys(newIf.callSignatures, (s) => signatureKey(s, renameForSignature(containerRename, s)));
  if (oldCalls.join('\n') !== newCalls.join('\n')) {
    changes.push({
      kind: 'interface-call-signature-changed',
      severity: 'major',
      symbolPath: name,
      message: `Call signatures of interface '${name}' changed`,
      oldValue: oldCalls.join(' | ') || '(none)',
      newValue: newCalls.join(' | ') || '(none)',
      // Conservative text-multiset comparison (no variance); a difference could be
      // a safe widening as easily as a break, so it is review-only.
      confidence: 'heuristic',
    });
  }

  const oldCtors = sortedKeys(oldIf.constructSignatures, (s) => signatureKey(s));
  const newCtors = sortedKeys(newIf.constructSignatures, (s) => signatureKey(s, renameForSignature(containerRename, s)));
  if (oldCtors.join('\n') !== newCtors.join('\n')) {
    changes.push({
      kind: 'interface-construct-signature-changed',
      severity: 'major',
      symbolPath: name,
      message: `Construct signatures of interface '${name}' changed`,
      oldValue: oldCtors.join(' | ') || '(none)',
      newValue: newCtors.join(' | ') || '(none)',
      confidence: 'heuristic',
    });
  }

  const oldIndex = sortedKeys(oldIf.indexSignatures, (ix) => indexSignatureKey(ix));
  const newIndex = sortedKeys(newIf.indexSignatures, (ix) => indexSignatureKey(ix, containerRename));
  if (oldIndex.join('\n') !== newIndex.join('\n')) {
    changes.push({
      kind: 'index-signature-changed',
      severity: 'major',
      symbolPath: name,
      message: `Index signatures of interface '${name}' changed`,
      oldValue: oldIndex.join(' | ') || '(none)',
      newValue: newIndex.join(' | ') || '(none)',
      confidence: 'heuristic',
    });
  }

  // Generic param changes
  changes.push(...classifyTypeParamChanges(name, oldIf.typeParameters, newIf.typeParameters, 'type'));

  return changes;
}

type ApiClassMethod = ApiClassSymbol['methods'][number];
type ApiClassProperty = ApiClassSymbol['properties'][number];

function groupByName<T extends { name: string }>(items: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const existing = groups.get(item.name);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(item.name, [item]);
    }
  }
  return groups;
}

function classMethodKey(method: ApiClassMethod): string {
  return `${method.isStatic ? 'static' : 'instance'}:${method.name}`;
}

function classPropertyKey(property: ApiClassProperty): string {
  return `${property.isStatic ? 'static' : 'instance'}:${property.name}`;
}

function classifySingleClassMethodChange(
  className: string,
  oldMethod: ApiClassMethod,
  newMethod: ApiClassMethod,
  classTPs?: { old: ApiTypeParameter[]; new: ApiTypeParameter[] },
  containerRename?: Map<string, string> | null,
): ApiChange[] {
  const changes: ApiChange[] = [];
  const symbolPath = `${className}.${oldMethod.name}`;

  if (newMethod.signatures.length < oldMethod.signatures.length) {
    changes.push({
      kind: 'overload-removed',
      severity: 'major',
      symbolPath,
      message: `Overload was removed from class method '${oldMethod.name}' in '${className}'`,
      oldValue: String(oldMethod.signatures.length),
      newValue: String(newMethod.signatures.length),
    });
  }
  if (newMethod.signatures.length > oldMethod.signatures.length) {
    changes.push({
      kind: 'overload-added',
      severity: 'minor',
      symbolPath,
      message: `Overload was added to class method '${oldMethod.name}' in '${className}'`,
      oldValue: String(oldMethod.signatures.length),
      newValue: String(newMethod.signatures.length),
    });
  }
  // isStatic checks only fire in the 1:1 name-only shortcut path (classifyClassMethodGroupChanges).
  // In the key-matched path, both sides share the same static/instance key, so isStatic is always equal.
  if (oldMethod.isStatic && !newMethod.isStatic) {
    changes.push({
      kind: 'class-method-became-instance',
      severity: 'major',
      symbolPath,
      message: `Method '${oldMethod.name}' changed from static to instance in class '${className}'`,
    });
  }
  if (!oldMethod.isStatic && newMethod.isStatic) {
    changes.push({
      kind: 'class-method-became-static',
      severity: 'major',
      symbolPath,
      message: `Method '${oldMethod.name}' changed from instance to static in class '${className}'`,
    });
  }

  const pairCount = Math.min(oldMethod.signatures.length, newMethod.signatures.length);
  const allSigChanges: ApiChange[] = [];
  for (let i = 0; i < pairCount; i++) {
    const oldSig = oldMethod.signatures[i];
    const newSig = newMethod.signatures[i];
    if (!oldSig || !newSig) continue;
    allSigChanges.push(
      ...compareFunctionSignature(symbolPath, oldSig, newSig, classTPs, containerRename ?? null),
    );
    allSigChanges.push(...classifyTypeParamChanges(symbolPath, oldSig.typeParameters, newSig.typeParameters, 'callable'));
  }
  if (allSigChanges.length > 0) {
    changes.push({
      kind: 'class-method-signature-changed',
      // Wrapper severity mirrors its sub-changes: a method whose only change is
      // a safe param widening / return narrowing must not be forced to major.
      severity: allSigChanges.some((c) => c.severity === 'major') ? 'major' : 'minor',
      symbolPath,
      message: `Method '${oldMethod.name}' signature changed in class '${className}'`,
      ...maybeWrapper(allSigChanges),
    });
    changes.push(...allSigChanges);
  }

  return changes;
}

function classifySingleClassPropertyChange(
  className: string,
  oldProp: ApiClassProperty,
  newProp: ApiClassProperty,
  classTPs?: { old: ApiTypeParameter[]; new: ApiTypeParameter[] },
  containerRename?: Map<string, string> | null,
): ApiChange[] {
  const changes: ApiChange[] = [];
  const symbolPath = `${className}.${oldProp.name}`;

  // Class properties are invariant (read + write), so only a structurally
  // equivalent rewrite inside the class's generic scope is a no-op. A get/set
  // accessor can carry a distinct write (setter) type, so compare both the read
  // type and the effective write type (which falls back to the read type for
  // plain fields and matched accessors).
  const ctx = classTPs ? { typeParameters: classTPs.old } : undefined;
  const read = invariantTextCompare(oldProp.type.text, newProp.type.text, containerRename ?? null, ctx);
  const write = invariantTextCompare(
    oldProp.writeType?.text ?? oldProp.type.text,
    newProp.writeType?.text ?? newProp.type.text,
    containerRename ?? null,
    ctx,
  );
  if (!read.equivalent || !write.equivalent) {
    const describe = (p: ApiClassProperty): string =>
      p.writeType ? `${p.type.text} (set: ${p.writeType.text})` : p.type.text;
    changes.push({
      kind: 'class-property-type-changed',
      severity: 'major',
      symbolPath,
      message: `Property '${oldProp.name}' type changed in class '${className}'`,
      oldValue: describe(oldProp),
      newValue: describe(newProp),
      ...maybeHeuristic(propTypeConfidence(read, write)),
    });
  }
  // isStatic checks only fire in the 1:1 name-only shortcut path (classifyClassPropertyGroupChanges).
  // In the key-matched path, both sides share the same static/instance key, so isStatic is always equal.
  if (oldProp.isStatic && !newProp.isStatic) {
    changes.push({
      kind: 'class-property-became-instance',
      severity: 'major',
      symbolPath,
      message: `Property '${oldProp.name}' changed from static to instance in class '${className}'`,
    });
  }
  if (!oldProp.isStatic && newProp.isStatic) {
    changes.push({
      kind: 'class-property-became-static',
      severity: 'major',
      symbolPath,
      message: `Property '${oldProp.name}' changed from instance to static in class '${className}'`,
    });
  }
  if (oldProp.isOptional && !newProp.isOptional) {
    changes.push({
      kind: 'class-property-became-required',
      severity: 'major',
      symbolPath,
      message: `Property '${oldProp.name}' became required in class '${className}'`,
    });
  }
  if (!oldProp.isOptional && newProp.isOptional) {
    changes.push({
      kind: 'class-property-became-optional',
      severity: 'minor',
      symbolPath,
      message: `Property '${oldProp.name}' became optional in class '${className}'`,
    });
  }
  if (!oldProp.isReadonly && newProp.isReadonly) {
    changes.push({
      kind: 'class-property-became-readonly',
      severity: 'major',
      symbolPath,
      message: `Property '${oldProp.name}' became readonly in class '${className}'`,
    });
  }
  if (oldProp.isReadonly && !newProp.isReadonly) {
    changes.push({
      kind: 'class-property-became-mutable',
      severity: 'minor',
      symbolPath,
      message: `Property '${oldProp.name}' became mutable in class '${className}'`,
    });
  }

  return changes;
}

function classifyClassMethodGroupChanges(
  className: string,
  oldGroup: ApiClassMethod[],
  newGroup: ApiClassMethod[],
  classTPs?: { old: ApiTypeParameter[]; new: ApiTypeParameter[] },
  containerRename?: Map<string, string> | null,
): ApiChange[] {
  const changes: ApiChange[] = [];

  if (oldGroup.length === 0) {
    for (const method of newGroup) {
      changes.push({
        kind: 'class-method-added',
        severity: 'minor',
        symbolPath: `${className}.${method.name}`,
        message: `Method '${method.name}' was added to class '${className}'`,
      });
    }
    return changes;
  }

  if (newGroup.length === 0) {
    for (const method of oldGroup) {
      changes.push({
        kind: 'class-method-removed',
        severity: 'major',
        symbolPath: `${className}.${method.name}`,
        message: `Method '${method.name}' was removed from class '${className}'`,
      });
    }
    return changes;
  }

  if (oldGroup.length === 1 && newGroup.length === 1) {
    return classifySingleClassMethodChange(className, oldGroup[0], newGroup[0], classTPs, containerRename);
  }

  const oldByKey = new Map(oldGroup.map((method) => [classMethodKey(method), method]));
  const newByKey = new Map(newGroup.map((method) => [classMethodKey(method), method]));

  for (const [key, oldMethod] of oldByKey) {
    const newMethod = newByKey.get(key);
    if (!newMethod) {
      changes.push({
        kind: 'class-method-removed',
        severity: 'major',
        symbolPath: `${className}.${oldMethod.name}`,
        message: `Method '${oldMethod.name}' was removed from class '${className}'`,
      });
      continue;
    }
    changes.push(...classifySingleClassMethodChange(className, oldMethod, newMethod, classTPs, containerRename));
  }

  for (const [key, newMethod] of newByKey) {
    if (oldByKey.has(key)) continue;
    changes.push({
      kind: 'class-method-added',
      severity: 'minor',
      symbolPath: `${className}.${newMethod.name}`,
      message: `Method '${newMethod.name}' was added to class '${className}'`,
    });
  }

  return changes;
}

function classifyClassPropertyGroupChanges(
  className: string,
  oldGroup: ApiClassProperty[],
  newGroup: ApiClassProperty[],
  classTPs?: { old: ApiTypeParameter[]; new: ApiTypeParameter[] },
  containerRename?: Map<string, string> | null,
): ApiChange[] {
  const changes: ApiChange[] = [];

  if (oldGroup.length === 0) {
    for (const property of newGroup) {
      changes.push({
        kind: property.isOptional ? 'class-property-added' : 'required-class-property-added',
        severity: property.isOptional ? 'minor' : 'major',
        symbolPath: `${className}.${property.name}`,
        message: `${property.isOptional ? 'Optional' : 'Required'} property '${property.name}' was added to class '${className}'`,
      });
    }
    return changes;
  }

  if (newGroup.length === 0) {
    for (const property of oldGroup) {
      changes.push({
        kind: 'class-property-removed',
        severity: 'major',
        symbolPath: `${className}.${property.name}`,
        message: `Property '${property.name}' was removed from class '${className}'`,
      });
    }
    return changes;
  }

  if (oldGroup.length === 1 && newGroup.length === 1) {
    return classifySingleClassPropertyChange(className, oldGroup[0], newGroup[0], classTPs, containerRename);
  }

  const oldByKey = new Map(oldGroup.map((property) => [classPropertyKey(property), property]));
  const newByKey = new Map(newGroup.map((property) => [classPropertyKey(property), property]));

  for (const [key, oldProperty] of oldByKey) {
    const newProperty = newByKey.get(key);
    if (!newProperty) {
      changes.push({
        kind: 'class-property-removed',
        severity: 'major',
        symbolPath: `${className}.${oldProperty.name}`,
        message: `Property '${oldProperty.name}' was removed from class '${className}'`,
      });
      continue;
    }
    changes.push(...classifySingleClassPropertyChange(className, oldProperty, newProperty, classTPs, containerRename));
  }

  for (const [key, newProperty] of newByKey) {
    if (oldByKey.has(key)) continue;
    changes.push({
      kind: newProperty.isOptional ? 'class-property-added' : 'required-class-property-added',
      severity: newProperty.isOptional ? 'minor' : 'major',
      symbolPath: `${className}.${newProperty.name}`,
      message: `${newProperty.isOptional ? 'Optional' : 'Required'} property '${newProperty.name}' was added to class '${className}'`,
    });
  }

  return changes;
}

function classifyEnumChanges(name: string, oldEnum: ApiEnumSymbol, newEnum: ApiEnumSymbol): ApiChange[] {
  const changes: ApiChange[] = [];
  const oldMembers = new Map(oldEnum.members.map((m) => [m.name, m]));
  const newMembers = new Map(newEnum.members.map((m) => [m.name, m]));

  for (const [memberName] of oldMembers) {
    if (!newMembers.has(memberName)) {
      changes.push({
        kind: 'enum-member-removed',
        severity: 'major',
        symbolPath: `${name}.${memberName}`,
        message: `Enum member '${memberName}' was removed from '${name}'`,
      });
    }
  }

  for (const [memberName] of newMembers) {
    if (!oldMembers.has(memberName)) {
      changes.push({
        kind: 'enum-member-added',
        severity: 'minor',
        symbolPath: `${name}.${memberName}`,
        message: `Enum member '${memberName}' was added to '${name}'`,
      });
    }
  }

  // Value changes (breaking: consumers may compare numeric values)
  for (const [memberName, oldMember] of oldMembers) {
    const newMember = newMembers.get(memberName);
    if (!newMember) continue;
    if (oldMember.value !== newMember.value) {
      changes.push({
        kind: 'enum-member-value-changed',
        severity: 'major',
        symbolPath: `${name}.${memberName}`,
        message: `Enum member '${memberName}' value changed in '${name}'`,
        oldValue: String(oldMember.value),
        newValue: String(newMember.value),
      });
    }
  }

  return changes;
}

function classifyClassChanges(name: string, oldCls: ApiClassSymbol, newCls: ApiClassSymbol): ApiChange[] {
  const changes: ApiChange[] = [];
  // Container generic scope shared by constructor / methods / properties, and
  // the matching alpha-rename so a class-level rename (`class Bag<T>` vs
  // `class Bag<S>`) collapses to a no-op for every nested member that
  // references the parameter.
  const classTPs = { old: oldCls.typeParameters, new: newCls.typeParameters };
  const containerRename = buildTypeParamRenameMap(oldCls.typeParameters, newCls.typeParameters);

  // Constructor changes
  const oldCtors = oldCls.constructorSignatures;
  const newCtors = newCls.constructorSignatures;
  if (newCtors.length < oldCtors.length) {
    changes.push({
      kind: 'overload-removed',
      severity: 'major',
      symbolPath: `${name}.constructor`,
      message: `Constructor overload was removed from '${name}'`,
      oldValue: String(oldCtors.length),
      newValue: String(newCtors.length),
    });
  }
  if (newCtors.length > oldCtors.length) {
    changes.push({
      kind: 'overload-added',
      severity: 'minor',
      symbolPath: `${name}.constructor`,
      message: `Constructor overload was added to '${name}'`,
      oldValue: String(oldCtors.length),
      newValue: String(newCtors.length),
    });
  }
  const ctorPairCount = Math.min(oldCtors.length, newCtors.length);
  for (let i = 0; i < ctorPairCount; i++) {
    const ctorSubChanges = compareFunctionSignature(`${name}.constructor`, oldCtors[i], newCtors[i], classTPs, containerRename);
    if (ctorSubChanges.length > 0) {
      const oldCtorParams = oldCtors[i].parameters.map((p) => `${p.name}: ${p.type.text}`).join(', ');
      const newCtorParams = newCtors[i].parameters.map((p) => `${p.name}: ${p.type.text}`).join(', ');
      changes.push({
        kind: 'class-constructor-changed',
        // Wrapper severity mirrors its sub-changes: a constructor whose only
        // change is a safe param widening must not be forced to major.
        severity: ctorSubChanges.some((c) => c.severity === 'major') ? 'major' : 'minor',
        symbolPath: `${name}.constructor`,
        message: `Constructor of class '${name}' changed`,
        oldValue: oldCtorParams,
        newValue: newCtorParams,
        ...maybeWrapper(ctorSubChanges),
      });
      changes.push(...ctorSubChanges);
    }
  }

  // Methods
  const oldMethodGroups = groupByName(oldCls.methods);
  const newMethodGroups = groupByName(newCls.methods);
  const methodNames = new Set([...oldMethodGroups.keys(), ...newMethodGroups.keys()]);
  for (const methodName of methodNames) {
    changes.push(
      ...classifyClassMethodGroupChanges(
        name,
        oldMethodGroups.get(methodName) ?? [],
        newMethodGroups.get(methodName) ?? [],
        classTPs,
        containerRename,
      ),
    );
  }

  // Properties
  const oldPropertyGroups = groupByName(oldCls.properties);
  const newPropertyGroups = groupByName(newCls.properties);
  const propertyNames = new Set([...oldPropertyGroups.keys(), ...newPropertyGroups.keys()]);
  for (const propertyName of propertyNames) {
    changes.push(
      ...classifyClassPropertyGroupChanges(
        name,
        oldPropertyGroups.get(propertyName) ?? [],
        newPropertyGroups.get(propertyName) ?? [],
        classTPs,
        containerRename,
      ),
    );
  }

  // Generic param changes
  changes.push(...classifyTypeParamChanges(name, oldCls.typeParameters, newCls.typeParameters, 'type'));

  return changes;
}

// Synthesize an interface view of a bare object-literal type alias so its
// members can be diffed by the interface logic. Object literals have no `extends`
// clause, so heritage is empty.
function aliasToInterface(ta: ApiTypeAliasSymbol): ApiInterfaceSymbol {
  const m = ta.objectMembers!;
  return {
    kind: 'interface',
    name: ta.name,
    properties: m.properties,
    methods: m.methods,
    typeParameters: ta.typeParameters,
    callSignatures: m.callSignatures,
    constructSignatures: m.constructSignatures,
    indexSignatures: m.indexSignatures,
    heritage: [],
  };
}

function classifyTypeAliasChanges(name: string, oldTA: ApiTypeAliasSymbol, newTA: ApiTypeAliasSymbol): ApiChange[] {
  // When both versions are bare object-literal aliases (`type X = { ... }`), diff
  // them member-by-member like an interface. An added required property then
  // surfaces as a proven `required-property-added` instead of an opaque,
  // review-only `type-alias-changed` (the p-limit `LimitFunction.concurrency`
  // case). classifyInterfaceChanges also classifies the alias's own type
  // parameters, so the generic scope is covered. A non-object alias on either
  // side (union / conditional / mapped / function type) falls through to the
  // conservative whole-text comparison below.
  if (oldTA.objectMembers && newTA.objectMembers) {
    return classifyInterfaceChanges(name, aliasToInterface(oldTA), aliasToInterface(newTA));
  }

  const changes: ApiChange[] = [];
  const tpRename = buildTypeParamRenameMap(oldTA.typeParameters, newTA.typeParameters);

  if (oldTA.type.text !== renameTypeText(newTA.type.text, tpRename)) {
    // Type aliases can appear in both input and output positions (invariant), so
    // we don't relax widening/narrowing to minor — but structurally equivalent
    // texts (e.g. `readonly T[]` vs `ReadonlyArray<T>`) are genuine no-ops. The
    // alpha-rename also collapses pure generic renames (`type X<T> = T` vs
    // `type X<S> = S`) to a no-op before variance probing. The shared
    // type-parameter scope lets variance instantiate bare generics rather than
    // bailing to the conservative major.
    const relation = compareTypeText(
      oldTA.type.text,
      renameTypeText(newTA.type.text, tpRename),
      { typeParameters: oldTA.typeParameters },
    );
    const equivalent = relation !== null && relation.oldToNew && relation.newToOld;
    if (!equivalent) {
      changes.push({
        kind: 'type-alias-changed',
        severity: 'major',
        symbolPath: name,
        message: `Type alias '${name}' changed`,
        oldValue: oldTA.type.text,
        newValue: newTA.type.text,
        // A non-object alias text difference: proven only when variance resolved
        // the two as genuinely unrelated; a bail or a one-directional (in this
        // invariant position) relation is review-only.
        ...maybeHeuristic(typeChangeConfidence(relation, 'invariant')),
      });
    }
  }

  changes.push(...classifyTypeParamChanges(name, oldTA.typeParameters, newTA.typeParameters, 'type'));

  return changes;
}

function classifyVariableChanges(name: string, oldVar: ApiVariableSymbol, newVar: ApiVariableSymbol): ApiChange[] {
  if (oldVar.type.text === newVar.type.text) {
    return [];
  }

  // Variance is NOT safely relaxed for variables: snapshots don't record
  // const/let/var, `export let` participates in live-binding mutation (an input
  // position), and literal-union narrowing can break consumer comparisons
  // (`x === "busy"` becomes a `never` comparison). Only a structurally equivalent
  // rewrite (e.g. `readonly T[]` vs `ReadonlyArray<T>`) is a true no-op; every
  // other change — including apparent narrowing — stays conservatively major.
  const relation = compareTypeText(oldVar.type.text, newVar.type.text);
  const equivalent = relation !== null && relation.oldToNew && relation.newToOld;
  if (equivalent) {
    return [];
  }
  return [{
    kind: 'variable-type-changed',
    severity: 'major',
    symbolPath: name,
    message: `Variable '${name}' type changed`,
    oldValue: oldVar.type.text,
    newValue: newVar.type.text,
    // Variable types are invariant: a one-directional or unresolved relation can
    // still be safe in practice, so it is review-only; only a genuinely unrelated
    // change is proven.
    ...maybeHeuristic(typeChangeConfidence(relation, 'invariant')),
  }];
}
