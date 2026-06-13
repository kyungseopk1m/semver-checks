import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { compare } from './index.js';
import { extract } from './extract/extractor.js';
import { diff } from './compare/differ.js';
import { resolveSourceInput, type SourceInputKind } from './resolve/source-ref.js';
import { resolvePath } from './resolve/path-resolver.js';
import { resolveGitRef, cleanupTmpDir } from './resolve/git-resolver.js';
import { ensureProjectDeps } from './resolve/dependency-installer.js';
import type { ApiSnapshot } from './extract/api-snapshot.js';
import { getPackageVersion } from './package-info.js';

function errorResult(message: string) {
  return {
    content: [{ type: 'text' as const, text: `Error: ${message}` }],
    isError: true,
  };
}

// Allowed values for `ApiSymbol.kind`. Anything else either crashes the
// classifier on `oldSym.kind` switching or silently slips through as "no
// changes" (e.g. an array symbol value `{ x: [] }` survives the shape guard
// and turns into a noisy patch report).
const ALLOWED_SYMBOL_KINDS = new Set([
  'function',
  'interface',
  'enum',
  'class',
  'type-alias',
  'variable',
  'namespace',
]);

// Reject reserved prototype-pollution keys. Even when a hostile snapshot uses
// `__proto__` / `constructor` / `prototype` as a subpath or symbol name, the
// inherited keys (`null` from `Object.prototype` shenanigans) collide with
// classifier loops that assume `Object.keys` returns own enumerable string
// properties. Refusing them up front is the smallest surface for that whole
// class of bug.
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function hasReservedKey(obj: Record<string, unknown>): string | undefined {
  for (const key of Object.keys(obj)) {
    if (RESERVED_KEYS.has(key)) return key;
  }
  return undefined;
}

// A `SerializedType` leaf is `{ text: string }`. The `kind` discriminator alone
// is not enough: a payload like `{ kind: 'variable', type: { text: 5 } }` passes
// the kind check but feeds a non-string `text` into the classifier's text
// comparisons, surfacing as a silent patch instead of a validation error.
function isSerializedType(value: unknown): boolean {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).text === 'string'
  );
}

// A type parameter is `{ name: string; constraint?: { text: string }; ... }`.
// The classifier reads `constraint.text` directly, so a non-string text (or a
// non-object constraint) would feed garbage into a text comparison.
function validateTypeParameters(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    return `${label} must be an array`;
  }
  for (let i = 0; i < value.length; i++) {
    const tp = value[i];
    if (!tp || typeof tp !== 'object' || Array.isArray(tp)) {
      return `${label}[${i}] must be a non-null object`;
    }
    const t = tp as Record<string, unknown>;
    if (typeof t['name'] !== 'string') {
      return `${label}[${i}].name must be a string`;
    }
    if (t['hasDefault'] !== undefined && typeof t['hasDefault'] !== 'boolean') {
      return `${label}[${i}].hasDefault must be a boolean`;
    }
    if (t['constraint'] !== undefined && !isSerializedType(t['constraint'])) {
      return `${label}[${i}].constraint must be a serialized type ({ text: string })`;
    }
    if (t['default'] !== undefined && !isSerializedType(t['default'])) {
      return `${label}[${i}].default must be a serialized type ({ text: string })`;
    }
  }
  return undefined;
}

function isBooleanOrAbsent(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}

function validateSignatures(value: unknown, label: string): string | undefined {
  if (!Array.isArray(value)) {
    return `${label} must be an array of signatures`;
  }
  for (let i = 0; i < value.length; i++) {
    const sig = value[i];
    if (!sig || typeof sig !== 'object' || Array.isArray(sig)) {
      return `${label}[${i}] must be a non-null object`;
    }
    const s = sig as Record<string, unknown>;
    if (!isSerializedType(s['returnType'])) {
      return `${label}[${i}].returnType must be a serialized type ({ text: string })`;
    }
    if (!Array.isArray(s['parameters'])) {
      return `${label}[${i}].parameters must be an array`;
    }
    for (let p = 0; p < s['parameters'].length; p++) {
      const param = (s['parameters'] as unknown[])[p];
      if (!param || typeof param !== 'object') {
        return `${label}[${i}].parameters[${p}] must be a non-null object`;
      }
      const pr = param as Record<string, unknown>;
      if (typeof pr['name'] !== 'string') {
        return `${label}[${i}].parameters[${p}].name must be a string`;
      }
      if (!isSerializedType(pr['type'])) {
        return `${label}[${i}].parameters[${p}].type must be a serialized type ({ text: string })`;
      }
      if (!isBooleanOrAbsent(pr['isOptional'])) {
        return `${label}[${i}].parameters[${p}].isOptional must be a boolean`;
      }
      if (!isBooleanOrAbsent(pr['isRest'])) {
        return `${label}[${i}].parameters[${p}].isRest must be a boolean`;
      }
    }
    const tpErr = validateTypeParameters(s['typeParameters'], `${label}[${i}].typeParameters`);
    if (tpErr) return tpErr;
  }
  return undefined;
}

function validateTypedMembers(value: unknown, label: string): string | undefined {
  if (!Array.isArray(value)) {
    return `${label} must be an array`;
  }
  for (let i = 0; i < value.length; i++) {
    const member = value[i];
    if (!member || typeof member !== 'object') {
      return `${label}[${i}] must be a non-null object`;
    }
    const m = member as Record<string, unknown>;
    if (typeof m['name'] !== 'string') {
      return `${label}[${i}].name must be a string`;
    }
    if (!isSerializedType(m['type'])) {
      return `${label}[${i}].type must be a serialized type ({ text: string })`;
    }
    if (m['writeType'] !== undefined && !isSerializedType(m['writeType'])) {
      return `${label}[${i}].writeType must be a serialized type ({ text: string })`;
    }
    if (!isBooleanOrAbsent(m['isOptional']) || !isBooleanOrAbsent(m['isReadonly']) || !isBooleanOrAbsent(m['isStatic'])) {
      return `${label}[${i}] flags (isOptional/isReadonly/isStatic) must be booleans`;
    }
  }
  return undefined;
}

// Index signatures are `{ keyType: string; valueType: { text: string }; isReadonly: boolean }`.
function validateIndexSignatures(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    return `${label} must be an array`;
  }
  for (let i = 0; i < value.length; i++) {
    const ix = value[i];
    if (!ix || typeof ix !== 'object') {
      return `${label}[${i}] must be a non-null object`;
    }
    const s = ix as Record<string, unknown>;
    if (typeof s['keyType'] !== 'string') {
      return `${label}[${i}].keyType must be a string`;
    }
    if (!isSerializedType(s['valueType'])) {
      return `${label}[${i}].valueType must be a serialized type ({ text: string })`;
    }
    if (!isBooleanOrAbsent(s['isReadonly'])) {
      return `${label}[${i}].isReadonly must be a boolean`;
    }
  }
  return undefined;
}

function validateSymbol(value: unknown, label: string): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return `${label} must be a non-null object`;
  }
  const sym = value as Record<string, unknown>;
  const reserved = hasReservedKey(sym);
  if (reserved) {
    return `${label} contains a reserved key '${reserved}'`;
  }
  // Every ApiSymbol carries `name: string`; the classifier uses it as a map key
  // and in messages, so a non-string name would otherwise slip through as a
  // silent patch.
  if (typeof sym['name'] !== 'string') {
    return `${label}.name must be a string`;
  }
  if (typeof sym['kind'] !== 'string') {
    return `${label}.kind must be a string`;
  }
  if (!ALLOWED_SYMBOL_KINDS.has(sym['kind'] as string)) {
    return `${label}.kind '${sym['kind']}' is not a recognised ApiSymbol kind`;
  }

  // Per-kind leaf validation: the classifier reads `type.text`, `returnType.text`,
  // signature/member arrays etc. without re-checking them, so a malformed leaf
  // that survives the kind check turns a real diff into a silent patch.
  const kind = sym['kind'] as string;
  switch (kind) {
    case 'variable':
    case 'type-alias': {
      if (!isSerializedType(sym['type'])) {
        return `${label}.type must be a serialized type ({ text: string })`;
      }
      // `variable` has no type parameters (the field is absent → no-op).
      const tpErr = validateTypeParameters(sym['typeParameters'], `${label}.typeParameters`);
      if (tpErr) return tpErr;
      break;
    }
    case 'function': {
      const err = validateSignatures(sym['signatures'], `${label}.signatures`);
      if (err) return err;
      break;
    }
    case 'interface': {
      const propErr = validateTypedMembers(sym['properties'], `${label}.properties`);
      if (propErr) return propErr;
      if (!Array.isArray(sym['methods'])) {
        return `${label}.methods must be an array`;
      }
      for (let i = 0; i < sym['methods'].length; i++) {
        const method = (sym['methods'] as unknown[])[i];
        if (!method || typeof method !== 'object') {
          return `${label}.methods[${i}] must be a non-null object`;
        }
        if (typeof (method as Record<string, unknown>)['name'] !== 'string') {
          return `${label}.methods[${i}].name must be a string`;
        }
        if (!isBooleanOrAbsent((method as Record<string, unknown>)['isOptional'])) {
          return `${label}.methods[${i}].isOptional must be a boolean`;
        }
        const sigErr = validateSignatures(
          (method as Record<string, unknown>)['signatures'],
          `${label}.methods[${i}].signatures`,
        );
        if (sigErr) return sigErr;
      }
      // Optional pre-0.6.0-compatible fields: call/construct/index signatures.
      const callErr = sym['callSignatures'] === undefined
        ? undefined
        : validateSignatures(sym['callSignatures'], `${label}.callSignatures`);
      if (callErr) return callErr;
      const ctorSigErr = sym['constructSignatures'] === undefined
        ? undefined
        : validateSignatures(sym['constructSignatures'], `${label}.constructSignatures`);
      if (ctorSigErr) return ctorSigErr;
      const idxErr = validateIndexSignatures(sym['indexSignatures'], `${label}.indexSignatures`);
      if (idxErr) return idxErr;
      const tpErr = validateTypeParameters(sym['typeParameters'], `${label}.typeParameters`);
      if (tpErr) return tpErr;
      break;
    }
    case 'class': {
      const propErr = validateTypedMembers(sym['properties'], `${label}.properties`);
      if (propErr) return propErr;
      if (!Array.isArray(sym['methods'])) {
        return `${label}.methods must be an array`;
      }
      for (let i = 0; i < sym['methods'].length; i++) {
        const method = (sym['methods'] as unknown[])[i];
        if (!method || typeof method !== 'object') {
          return `${label}.methods[${i}] must be a non-null object`;
        }
        if (typeof (method as Record<string, unknown>)['name'] !== 'string') {
          return `${label}.methods[${i}].name must be a string`;
        }
        if (!isBooleanOrAbsent((method as Record<string, unknown>)['isStatic'])) {
          return `${label}.methods[${i}].isStatic must be a boolean`;
        }
        const sigErr = validateSignatures(
          (method as Record<string, unknown>)['signatures'],
          `${label}.methods[${i}].signatures`,
        );
        if (sigErr) return sigErr;
      }
      const ctorErr = validateSignatures(sym['constructorSignatures'], `${label}.constructorSignatures`);
      if (ctorErr) return ctorErr;
      const tpErr = validateTypeParameters(sym['typeParameters'], `${label}.typeParameters`);
      if (tpErr) return tpErr;
      break;
    }
    case 'enum': {
      if (!Array.isArray(sym['members'])) {
        return `${label}.members must be an array`;
      }
      for (let i = 0; i < sym['members'].length; i++) {
        const member = (sym['members'] as unknown[])[i];
        if (!member || typeof member !== 'object') {
          return `${label}.members[${i}] must be a non-null object`;
        }
        if (typeof (member as Record<string, unknown>)['name'] !== 'string') {
          return `${label}.members[${i}].name must be a string`;
        }
        const v = (member as Record<string, unknown>)['value'];
        if (v !== undefined && typeof v !== 'string' && typeof v !== 'number') {
          return `${label}.members[${i}].value must be a string, number, or absent`;
        }
      }
      break;
    }
  }

  // Namespaces are recursive: their `symbols` field is another symbol map.
  if (sym['kind'] === 'namespace') {
    const inner = sym['symbols'];
    if (!inner || typeof inner !== 'object' || Array.isArray(inner)) {
      return `${label}.symbols must be a non-null object for kind 'namespace'`;
    }
    const innerMap = inner as Record<string, unknown>;
    const innerReserved = hasReservedKey(innerMap);
    if (innerReserved) {
      return `${label}.symbols contains a reserved key '${innerReserved}'`;
    }
    for (const [innerName, innerSym] of Object.entries(innerMap)) {
      const err = validateSymbol(innerSym, `${label}.symbols[${JSON.stringify(innerName)}]`);
      if (err) return err;
    }
  }
  return undefined;
}

// Validates that an `entrypoints` field is a non-null plain object keyed by
// subpath, that every value is itself a non-null plain object (the per-subpath
// symbol map), and that every symbol value inside has the `kind` discriminator
// the classifier downstream switches on. Top-level-only checks let payloads
// like `{ ".": null }` or `{ ".": { x: [] } }` slip through and surface as
// fake patches / runtime crashes.
function validateEntrypoints(value: unknown, label: string): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return `"${label}.entrypoints" must be an object keyed by export subpath`;
  }
  const entryMap = value as Record<string, unknown>;
  const reservedSubpath = hasReservedKey(entryMap);
  if (reservedSubpath) {
    return `"${label}.entrypoints" contains a reserved key '${reservedSubpath}'`;
  }
  for (const [subpath, symbols] of Object.entries(entryMap)) {
    if (!symbols || typeof symbols !== 'object' || Array.isArray(symbols)) {
      return `"${label}.entrypoints[${JSON.stringify(subpath)}]" must be a non-null object of symbols`;
    }
    const symMap = symbols as Record<string, unknown>;
    const reservedSym = hasReservedKey(symMap);
    if (reservedSym) {
      return `"${label}.entrypoints[${JSON.stringify(subpath)}]" contains a reserved key '${reservedSym}'`;
    }
    for (const [symName, sym] of Object.entries(symMap)) {
      const err = validateSymbol(sym, `"${label}.entrypoints[${JSON.stringify(subpath)}][${JSON.stringify(symName)}]"`);
      if (err) return err;
    }
  }
  return undefined;
}

function getOptionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`"${key}" argument must be a string`);
  }
  return value;
}

function getRequiredString(args: Record<string, unknown>, key: string): string {
  const value = getOptionalString(args, key);
  if (value === undefined) {
    throw new Error(`"${key}" argument is required and must be a string`);
  }
  return value;
}

function getOptionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new Error(`"${key}" argument must be a boolean`);
  }
  return value;
}

function getOptionalSourceInputKind(
  args: Record<string, unknown>,
  key: string,
): SourceInputKind | undefined {
  const value = getOptionalString(args, key);
  if (value === undefined) return undefined;
  if (value === 'path' || value === 'git') {
    return value;
  }
  throw new Error(`"${key}" argument must be either "path" or "git"`);
}

export function createMcpServer(): Server {
  const server = new Server(
    { name: 'semver-checks', version: getPackageVersion() },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      {
        name: 'semver_compare',
        description:
          'Compare two versions of a TypeScript library and detect breaking API changes. Returns the recommended SemVer bump (major/minor/patch) and a detailed list of all changes.',
        inputSchema: {
          type: 'object',
          properties: {
            old: {
              type: 'string',
              description: 'Old version: a filesystem path or a git ref (tag, branch, commit SHA)',
            },
            new: {
              type: 'string',
              description: 'New version: a filesystem path or a git ref. Defaults to current directory.',
              default: '.',
            },
            entry: {
              type: 'string',
              description: 'Entry file relative to project root (e.g. "src/index.ts"). Auto-detected from package.json if omitted.',
            },
            oldAs: {
              type: 'string',
              enum: ['path', 'git'],
              description: 'Force "old" to be treated as a filesystem path or git ref',
            },
            newAs: {
              type: 'string',
              enum: ['path', 'git'],
              description: 'Force "new" to be treated as a filesystem path or git ref',
            },
            installDeps: {
              type: 'boolean',
              description: 'Install dependencies before analysis (needed for local paths without node_modules)',
              default: false,
            },
          },
          required: ['old'],
        },
      },
      {
        name: 'semver_snapshot',
        description:
          'Extract the public API surface of a TypeScript project as a structured JSON snapshot. Useful for inspecting what a library exports or caching a snapshot for later diffing.',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Project path (filesystem path or git ref). Defaults to current directory.',
              default: '.',
            },
            entry: {
              type: 'string',
              description: 'Entry file relative to project root (e.g. "src/index.ts")',
            },
            asGitRef: {
              type: 'boolean',
              description: 'Treat "path" as a git ref instead of a filesystem path',
              default: false,
            },
            installDeps: {
              type: 'boolean',
              description: 'Install dependencies before analysis',
              default: false,
            },
          },
        },
      },
      {
        name: 'semver_diff',
        description:
          'Compare two previously extracted API snapshots and return the SemVer analysis. Use this when you already have snapshots from semver_snapshot to avoid re-extracting.',
        inputSchema: {
          type: 'object',
          properties: {
            oldSnapshot: {
              type: 'object',
              description: 'The old API snapshot (JSON object from semver_snapshot)',
            },
            newSnapshot: {
              type: 'object',
              description: 'The new API snapshot (JSON object from semver_snapshot)',
            },
          },
          required: ['oldSnapshot', 'newSnapshot'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs = {} } = request.params;
    const args = rawArgs as Record<string, unknown>;

    try {
      switch (name) {
        case 'semver_compare': {
          const oldInput = getRequiredString(args, 'old');
          const newInput = getOptionalString(args, 'new') ?? '.';
          const entry = getOptionalString(args, 'entry');
          const oldAs = getOptionalSourceInputKind(args, 'oldAs');
          const newAs = getOptionalSourceInputKind(args, 'newAs');
          const installDeps = getOptionalBoolean(args, 'installDeps') ?? false;

          const report = await compare({
            oldSource: resolveSourceInput(oldInput, oldAs),
            newSource: resolveSourceInput(newInput, newAs),
            entry,
            installDeps,
          });

          return {
            content: [{ type: 'text', text: JSON.stringify(report, null, 2) }],
          };
        }

        case 'semver_snapshot': {
          const pathInput = getOptionalString(args, 'path') ?? '.';
          const entry = getOptionalString(args, 'entry');
          const asGitRef = getOptionalBoolean(args, 'asGitRef') ?? false;
          const installDeps = getOptionalBoolean(args, 'installDeps') ?? false;

          let projectPath: string;
          let tmpDir: string | null = null;

          try {
            if (asGitRef) {
              tmpDir = resolveGitRef(pathInput);
              projectPath = tmpDir;
              await ensureProjectDeps(projectPath);
            } else {
              projectPath = resolvePath(pathInput);
              if (installDeps) {
                await ensureProjectDeps(projectPath);
              }
            }

            const snapshot = await extract({ projectPath, entry });
            return {
              content: [{ type: 'text', text: JSON.stringify(snapshot, null, 2) }],
            };
          } finally {
            if (tmpDir) cleanupTmpDir(tmpDir);
          }
        }

        case 'semver_diff': {
          if (typeof args['oldSnapshot'] !== 'object' || args['oldSnapshot'] === null) {
            return errorResult('"oldSnapshot" argument is required and must be an object');
          }
          if (typeof args['newSnapshot'] !== 'object' || args['newSnapshot'] === null) {
            return errorResult('"newSnapshot" argument is required and must be an object');
          }
          const oldEntries = (args['oldSnapshot'] as { entrypoints?: unknown }).entrypoints;
          const oldEntriesError = validateEntrypoints(oldEntries, 'oldSnapshot');
          if (oldEntriesError) return errorResult(oldEntriesError);
          const newEntries = (args['newSnapshot'] as { entrypoints?: unknown }).entrypoints;
          const newEntriesError = validateEntrypoints(newEntries, 'newSnapshot');
          if (newEntriesError) return errorResult(newEntriesError);
          const oldSnapshot = args['oldSnapshot'] as ApiSnapshot;
          const newSnapshot = args['newSnapshot'] as ApiSnapshot;

          const report = diff(oldSnapshot, newSnapshot);
          return {
            content: [{ type: 'text', text: JSON.stringify(report, null, 2) }],
          };
        }

        default:
          return errorResult(`Unknown tool: ${name}`);
      }
    } catch (err: any) {
      return errorResult(err.message);
    }
  });

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
