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
          if (!('symbols' in (args['oldSnapshot'] as object))) {
            return errorResult('"oldSnapshot" must contain a "symbols" object');
          }
          if (!('symbols' in (args['newSnapshot'] as object))) {
            return errorResult('"newSnapshot" must contain a "symbols" object');
          }
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
