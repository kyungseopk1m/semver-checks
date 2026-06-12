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
  ApiTypeAliasSymbol,
  ApiEnumSymbol,
  ApiEnumMember,
  ApiClassSymbol,
  ApiVariableSymbol,
  SerializedType,
} from './api-snapshot.js';

export function extractFromPath(projectPath: string, entry?: string): ApiSnapshot {
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
    process.stderr.write(`[semver-checks] ${diagnostics.length} TypeScript error(s) found:\n${msgs}\n`);
  }

  const entryFile = resolveEntry(project, projectPath, entry);
  const symbols = collectContainerExports(entryFile);

  return { symbols };
}

function resolveEntry(project: Project, projectPath: string, entry?: string): SourceFile {
  if (entry) {
    const file = project.getSourceFile(path.join(projectPath, entry));
    if (!file) throw new Error(`Entry file not found: ${entry}`);
    return file;
  }

  // Auto-detect from package.json
  let typesPath: string | undefined;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectPath, 'package.json'), 'utf-8'));
    const main = pkg.exports?.['.'];
    typesPath = (typeof main === 'object' ? main?.import?.types ?? main?.types : null) ?? pkg.types ?? pkg.typings;
    if (typesPath) {
      // Source layout (working tree): map the published .d.ts back to its .ts source.
      const srcMapped = path.join(projectPath, typesPath.replace('/dist/mjs/', '/src/').replace('.d.ts', '.ts'));
      const file = project.getSourceFile(srcMapped);
      if (file) return file;
    }
  } catch {}

  // Fallback to real source before the declared .d.ts: a working tree with a
  // stale or unbuilt dist/ would otherwise be analyzed from its outdated
  // declarations, silently masking source-only API changes.
  const fallback =
    project.getSourceFile(path.join(projectPath, 'src', 'index.ts')) ??
    project.getSourceFile(path.join(projectPath, 'index.ts'));
  if (fallback) return fallback;

  // Last resort: the declared types entry itself. Published npm tarballs ship
  // their .d.ts declarations but no .ts source, so this is their entry point.
  if (typesPath) {
    const rawTypes = project.getSourceFile(path.join(projectPath, typesPath));
    if (rawTypes) return rawTypes;
  }

  throw new Error(`Could not find entry file. Use --entry to specify.`);
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
    return unionParts
      .map((part) => canonicalizeTypeText(part))
      .sort()
      .join(' | ');
  }

  const intersectionParts = splitTopLevel(trimmed, '&');
  if (intersectionParts.length > 1 && canNormalizeBinaryParts(intersectionParts)) {
    return intersectionParts
      .map((part) => canonicalizeTypeText(part))
      .sort()
      .join(' & ');
  }

  return trimmed;
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
function serializeType(type: Type, contextNode: Node): SerializedType {
  return { text: normalizeTypeText(type.getText(contextNode)) };
}

function convertTypeParams(node: Node): ApiTypeParameter[] {
  const params = (node as any).getTypeParameters?.() ?? [];
  return params.map((tp: any) => {
    // tp.getConstraint() returns a TypeNode (AST node); getText() is literal source text.
    // normalizeTypeText() applied for consistency in case the constraint references an imported type.
    const c = tp.getConstraint();
    return {
      name: tp.getName(),
      constraint: c ? { text: normalizeTypeText(c.getText()) } : undefined,
      hasDefault: tp.getDefault() != null,
    };
  });
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
        type: serializeType(paramType, contextNode),
        isOptional: p.isOptional(),
        isRest,
      };
    }),
    returnType: serializeType(sig.getReturnType(), contextNode),
    // EDGE-3: extract type parameters from the call signature
    typeParameters: sig.getTypeParameters().map((tp) => ({
      name: tp.getSymbol()?.getName() ?? '?',
      constraint: tp.getConstraint() ? { text: normalizeTypeText(tp.getConstraint()!.getText(contextNode)) } : undefined,
      hasDefault: tp.getDefault() != null,
    })),
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
    type: serializeType(p.getType(), node),
    isOptional: p.isOptional(),
    isRest: p.isRestParameter(),
  }));

  const rawReturnType = (node as any).getReturnType?.();
  const returnType: SerializedType = Node.isConstructorDeclaration(node)
    ? { text: 'void' }
    : rawReturnType ? serializeType(rawReturnType, node) : { text: 'unknown' };

  return [{
    parameters: params,
    returnType,
    typeParameters: convertTypeParams(node),
  }];
}

function convertInterface(name: string, node: Node): ApiInterfaceSymbol {
  if (!Node.isInterfaceDeclaration(node)) return { kind: 'interface', name, properties: [], methods: [], typeParameters: [] };

  // EDGE-4: use node as context for getText()
  const properties: ApiInterfaceProperty[] = node.getProperties().map((p) => ({
    name: p.getName(),
    type: serializeType(p.getType(), node),
    isOptional: p.hasQuestionToken(),
    isReadonly: p.isReadonly(),
  }));

  // Group methods by name to merge overload signatures (getMethods() returns one node per overload)
  const methodMap = new Map<string, ApiInterfaceMethod>();
  for (const m of node.getMethods()) {
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

  return {
    kind: 'interface',
    name,
    properties,
    methods,
    typeParameters: convertTypeParams(node),
  };
}

function convertTypeAlias(name: string, node: Node): ApiTypeAliasSymbol {
  if (!Node.isTypeAliasDeclaration(node)) return { kind: 'type-alias', name, type: { text: 'unknown' }, typeParameters: [] };

  return {
    kind: 'type-alias',
    name,
    // EDGE-4: use node as context for getText()
    type: serializeType(node.getType(), node),
    typeParameters: convertTypeParams(node),
  };
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
      type: serializeType(p.getType(), node),
      isOptional: p.hasQuestionToken(),
      isReadonly: p.isReadonly(),
      isStatic: p.isStatic(),
    }));

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
    type: serializeType(node.getType(), node),
  };
}
