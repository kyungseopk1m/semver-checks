import { Project, SourceFile, Symbol, Type, Node, SyntaxKind } from 'ts-morph';
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
  ApiTypeAliasSymbol,
  ApiEnumSymbol,
  ApiClassSymbol,
  ApiVariableSymbol,
  SerializedType,
} from './api-snapshot.js';

export function extractFromPath(projectPath: string, entry?: string): ApiSnapshot {
  const project = new Project({
    tsConfigFilePath: path.join(projectPath, 'tsconfig.json'),
    skipAddingFilesFromTsConfig: false,
  });

  const entryFile = resolveEntry(project, projectPath, entry);
  const symbols = collectExports(project, entryFile);

  return { symbols };
}

function resolveEntry(project: Project, projectPath: string, entry?: string): SourceFile {
  if (entry) {
    const file = project.getSourceFile(path.join(projectPath, entry));
    if (!file) throw new Error(`Entry file not found: ${entry}`);
    return file;
  }

  // Auto-detect from package.json
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectPath, 'package.json'), 'utf-8'));
    const main = pkg.exports?.['.'];
    const typesPath = (typeof main === 'object' ? main?.import?.types ?? main?.types : null) ?? pkg.types ?? pkg.typings;
    if (typesPath) {
      const resolved = path.join(projectPath, typesPath.replace('/dist/mjs/', '/src/').replace('.d.ts', '.ts'));
      const file = project.getSourceFile(resolved);
      if (file) return file;
    }
  } catch {}

  // Fallback: src/index.ts
  const fallback =
    project.getSourceFile(path.join(projectPath, 'src', 'index.ts')) ??
    project.getSourceFile(path.join(projectPath, 'index.ts'));

  if (!fallback) throw new Error(`Could not find entry file. Use --entry to specify.`);
  return fallback;
}

function collectExports(project: Project, entryFile: SourceFile): Record<string, ApiSymbol> {
  const checker = project.getTypeChecker();
  const result: Record<string, ApiSymbol> = {};

  const exportedDeclarations = entryFile.getExportedDeclarations();

  for (const [name, declarations] of exportedDeclarations) {
    if (declarations.length === 0) continue;

    // Handle overloaded functions: multiple FunctionDeclaration nodes for same name
    const fnDecls = declarations.filter((d) => Node.isFunctionDeclaration(d));
    if (fnDecls.length > 1) {
      const overloads = fnDecls.filter((d) => (d as any).isOverload?.());
      const sigDecls = overloads.length > 0 ? overloads : fnDecls.slice(0, 1);
      const signatures = sigDecls.flatMap((d) => convertFunctionSignatures(d));
      result[name] = { kind: 'function', name, signatures };
      continue;
    }

    const decl = declarations[0];
    try {
      const symbol = convertDeclaration(name, decl, checker);
      if (symbol) result[name] = symbol;
    } catch {
      // Skip symbols that can't be analyzed
    }
  }

  return result;
}

function convertDeclaration(name: string, node: Node, checker: ReturnType<Project['getTypeChecker']>): ApiSymbol | null {
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
      return convertFunctionType(name, type);
    }
    return convertVariable(name, node);
  }

  return null;
}

function serializeType(type: Type): SerializedType {
  return { text: type.getText() };
}

function convertTypeParams(node: { getTypeParameters?(): any[] }): ApiTypeParameter[] {
  const params = node.getTypeParameters?.() ?? [];
  return params.map((tp: any) => ({
    name: tp.getName(),
    constraint: tp.getConstraint() ? { text: tp.getConstraint().getText() } : undefined,
    hasDefault: tp.getDefault() != null,
  }));
}

function convertFunction(name: string, node: Node): ApiFunctionSymbol {
  const signatures = convertFunctionSignatures(node);
  return { kind: 'function', name, signatures };
}

function convertFunctionType(name: string, type: Type): ApiFunctionSymbol {
  const signatures = type.getCallSignatures().map((sig) => ({
    parameters: sig.getParameters().map((p) => {
      const paramType = p.getTypeAtLocation(p.getValueDeclaration()!);
      return {
        name: p.getName(),
        type: { text: paramType.getText() },
        isOptional: p.isOptional(),
        isRest: false,
      };
    }),
    returnType: { text: sig.getReturnType().getText() },
    typeParameters: [],
  }));
  return { kind: 'function', name, signatures };
}

function convertFunctionSignatures(node: Node): ApiFunctionSignature[] {
  if (!Node.isFunctionDeclaration(node) && !Node.isMethodDeclaration(node) && !Node.isConstructorDeclaration(node)) {
    return [];
  }

  const params: ApiParameter[] = node.getParameters().map((p) => ({
    name: p.getName(),
    type: { text: p.getType().getText() },
    isOptional: p.isOptional(),
    isRest: p.isRestParameter(),
  }));

  const returnType: SerializedType = Node.isConstructorDeclaration(node)
    ? { text: 'void' }
    : { text: (node as any).getReturnType?.().getText() ?? 'unknown' };

  return [{
    parameters: params,
    returnType,
    typeParameters: convertTypeParams(node as any),
  }];
}

function convertInterface(name: string, node: Node): ApiInterfaceSymbol {
  if (!Node.isInterfaceDeclaration(node)) return { kind: 'interface', name, properties: [], typeParameters: [] };

  const properties: ApiInterfaceProperty[] = node.getProperties().map((p) => ({
    name: p.getName(),
    type: { text: p.getType().getText() },
    isOptional: p.hasQuestionToken(),
    isReadonly: p.isReadonly(),
  }));

  return {
    kind: 'interface',
    name,
    properties,
    typeParameters: convertTypeParams(node),
  };
}

function convertTypeAlias(name: string, node: Node): ApiTypeAliasSymbol {
  if (!Node.isTypeAliasDeclaration(node)) return { kind: 'type-alias', name, type: { text: 'unknown' }, typeParameters: [] };

  return {
    kind: 'type-alias',
    name,
    type: { text: node.getType().getText() },
    typeParameters: convertTypeParams(node),
  };
}

function convertEnum(name: string, node: Node): ApiEnumSymbol {
  if (!Node.isEnumDeclaration(node)) return { kind: 'enum', name, members: [] };
  return {
    kind: 'enum',
    name,
    members: node.getMembers().map((m) => m.getName()),
  };
}

function convertClass(name: string, node: Node): ApiClassSymbol {
  if (!Node.isClassDeclaration(node)) return { kind: 'class', name, constructorSignatures: [], methods: [], properties: [], typeParameters: [] };

  const ctors = node.getConstructors().map((c) => convertFunctionSignatures(c)[0] ?? { parameters: [], returnType: { text: 'void' }, typeParameters: [] });

  const methods = node.getMethods()
    .filter((m) => !m.hasModifier(SyntaxKind.PrivateKeyword) && !m.hasModifier(SyntaxKind.ProtectedKeyword))
    .map((m) => ({
      name: m.getName(),
      signatures: convertFunctionSignatures(m),
      isStatic: m.isStatic(),
    }));

  const properties = node.getProperties()
    .filter((p) => !p.hasModifier(SyntaxKind.PrivateKeyword) && !p.hasModifier(SyntaxKind.ProtectedKeyword))
    .map((p) => ({
      name: p.getName(),
      type: { text: p.getType().getText() },
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
    type: { text: node.getType().getText() },
  };
}
