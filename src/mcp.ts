import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { compare } from './index.js';
import { parseDeclaredBump } from './declared.js';
import { parseEntryArg } from './entry-arg.js';
import { extract } from './extract/extractor.js';
import { describeUnusableSnapshot } from './extract/api-snapshot.js';
import { resolveSourceInput, type SourceInputKind } from './resolve/source-ref.js';
import { resolvePath } from './resolve/path-resolver.js';
import { resolveNpmSpec } from './resolve/npm-resolver.js';
import { resolveGitRef, cleanupTmpDir } from './resolve/git-resolver.js';
import { ensureProjectDeps } from './resolve/dependency-installer.js';
import { getPackageVersion } from './package-info.js';
import type { ApiChange, SemverReport } from './types.js';
import type { ApiSnapshot } from './extract/api-snapshot.js';

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
  if (value === 'path' || value === 'git' || value === 'npm') {
    return value;
  }
  throw new Error(`"${key}" argument must be one of: path, git, npm`);
}

// `entry` arrives as one path, several, or a comma-separated string, the same
// three shapes the CLI accepts. A plain string check would turn "a.ts,b.ts"
// into a filename with a comma in it, which reads as a missing file rather
// than as the two entries that were asked for.
function getOptionalEntry(args: Record<string, unknown>, key: string): string | string[] | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value === 'string') return parseEntryArg(value);
  if (Array.isArray(value) && value.every((e) => typeof e === 'string')) {
    return parseEntryArg(value as string[]);
  }
  throw new Error(`"${key}" argument must be a string or an array of strings`);
}

function getOptionalCount(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`"${key}" argument must be a non-negative integer`);
  }
  return value;
}

// How much of a report an agent can actually be handed. A large major release
// serializes past what a tool result is allowed to carry: jose 5.9.6 -> 6.0.0
// is 401 changes and 137KB, and a client that truncates at its own limit hands
// the agent JSON that no longer parses, which is worse than a short answer.
//
// 50 is read off that same release: 33 proven breaks plus 12 additions is 45,
// so even there the cap only reaches the review-only pile.
const DEFAULT_MAX_CHANGES = 50;

// Proven breaks first, then additions, then the review-only majors the tool
// could not prove. Sorting rather than filtering by confidence is what makes
// one knob enough: a package with more proven breaks than the cap still gets
// its most actionable end, which a `confidence` filter would not bound at all.
function changeRank(change: ApiChange): number {
  if (change.severity !== 'major') return 1;
  return change.confidence === 'heuristic' ? 2 : 0;
}

// Truncation lives here rather than in `SemverReport`, because a field on that
// type is public library surface and this is a property of one transport.
function forAgent(report: SemverReport, maxChanges: number): unknown {
  const ordered = [...report.changes].sort((a, b) => changeRank(a) - changeRank(b));
  if (ordered.length <= maxChanges) return { ...report, changes: ordered };
  const shown = ordered.slice(0, maxChanges);
  return {
    ...report,
    changes: shown,
    omitted: {
      count: ordered.length - shown.length,
      total: ordered.length,
      note:
        `Showing ${shown.length} of ${ordered.length} changes, proven breaks first, then additions, ` +
        `then review-only ones. "summary" still counts every change. ` +
        `Pass maxChanges: ${ordered.length} for the full list.`,
    },
  };
}

// A snapshot is serialized compactly rather than indented, which the budget
// below depends on: indentation adds 32% to a map of names and kinds and
// doubles one of full shapes, and counting it would mean guessing at nesting
// depth instead of measuring. A report stays indented, since it is short and
// gets read as prose.
//
// A snapshot is far larger than a report: zod 4.4.0 is 2,323 symbols and 1.3MB
// of serialized detail, twenty times what the fattest comparison produces. Two
// separate things make it fit, because measuring six real packages showed one
// knob cannot do both jobs. Names and kinds alone run a steady ~35 bytes per
// symbol, while a full type shape runs a median of 371 across those packages
// and as much as 66KB for one wide interface, so dropping detail is what makes
// the useful part small, and a budget is what actually bounds it. A symbol
// count would have to be set per mode to do the same work; bytes are
// mode-independent and are the constraint being described anyway.
const DEFAULT_MAX_BYTES = 40_000;

// ponytail: no per-symbol lookup. `detail: true` is the only way to read a
// type, so a package too large for the budget in detail mode cannot be drilled
// into. Add a `symbol` argument if that turns out to matter.
function snapshotForAgent(
  snapshot: ApiSnapshot,
  detail: boolean,
  maxBytes: number,
): unknown {
  const entrypoints: Record<string, Record<string, unknown>> = {};
  let used = 0;
  let kept = 0;
  let total = 0;

  for (const [entry, symbols] of Object.entries(snapshot.entrypoints)) {
    for (const [name, symbol] of Object.entries(symbols)) {
      total += 1;
      const value = detail ? symbol : symbol.kind;
      // `"name":value,` is what this symbol costs in the compact JSON below,
      // measured in UTF-8 bytes rather than UTF-16 code units. A budget named
      // in bytes has to be counted in them: an identifier written in Hangul or
      // Han costs three bytes a character and `String.length` reports one, so
      // the non-ASCII fixture spent 929 bytes of a 400 byte budget.
      const cost = Buffer.byteLength(name, 'utf8') + Buffer.byteLength(JSON.stringify(value), 'utf8') + 4;
      // Checked before the symbol goes in rather than after, because one wide
      // interface under `detail` runs to tens of kilobytes on its own and would
      // otherwise carry the total well past the number the caller asked for.
      // Nothing is exempt, the first symbol included: a bound that one symbol
      // can blow by an arbitrary amount is not a bound, and returning none of
      // them still describes the surface, since `omitted` carries the total.
      if (used + cost > maxBytes) continue;
      used += cost;
      (entrypoints[entry] ??= {})[name] = value;
      kept += 1;
    }
  }

  const omitted = total - kept;
  if (omitted === 0) return { entrypoints };
  return {
    entrypoints,
    omitted: {
      count: omitted,
      total,
      note:
        `Showing ${kept} of ${total} symbols, stopped at the ${maxBytes} byte budget` +
        (kept === 0 ? ', which was too small for even one of them. ' : '. ') +
        `Raise maxBytes, narrow the surface with "entry", ` +
        (detail ? 'or drop "detail" for names and kinds only.' : 'or ask for one entrypoint at a time.'),
    },
  };
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
          'Compare two versions of a TypeScript library and detect breaking API changes. Either side can be a filesystem path, a git ref, or an npm spec, so a working tree can be compared against the published release without checking anything out. Returns the recommended SemVer bump (major/minor/patch) and a list of changes. Each change carries a confidence: "proven" (a structurally confident break — gate on these) or "heuristic" (a conservative major the tool could not prove safe — surface for review). summary.majorProven / majorReview split the major count accordingly. Pass "declared" to have the tool grade the bump the release writes down instead of just recommending one.',
        inputSchema: {
          type: 'object',
          properties: {
            old: {
              type: 'string',
              description: 'Old version: a filesystem path, a git ref (tag, branch, commit SHA), or an npm spec. A "name@version" that is not an existing path is read as npm (e.g. "lodash@4.17.21", "lodash@latest"); prefix with "npm:" to say so outright.',
            },
            new: {
              type: 'string',
              description: 'New version: a filesystem path, a git ref, or an npm spec. Defaults to current directory.',
              default: '.',
            },
            entry: {
              anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
              description: 'Entry file relative to project root (e.g. "src/index.ts"). Pass an array or a comma-separated string for a package with several entry points. Auto-detected from package.json if omitted.',
            },
            oldAs: {
              type: 'string',
              enum: ['path', 'git', 'npm'],
              description: 'Force "old" to be treated as a filesystem path, a git ref, or an npm spec. Only needed when auto-detection would read the input as the wrong kind.',
            },
            newAs: {
              type: 'string',
              enum: ['path', 'git', 'npm'],
              description: 'Force "new" to be treated as a filesystem path, a git ref, or an npm spec.',
            },
            declared: {
              type: 'string',
              enum: ['major', 'minor', 'patch', 'none', 'auto'],
              description: 'The bump this release declares, or "auto" to read it from .changeset/*.md and then the two package.json versions. Adds a "declaration" verdict to the report: "mismatch" when a proven break outranks the declaration, "review" when the changes argue for more than was declared, "ok" otherwise. Errors when "auto" finds nothing to read, rather than reporting a pass.',
            },
            maxChanges: {
              type: 'integer',
              minimum: 0,
              description: 'How many changes to include (default 50). They are ordered proven breaks first, then additions, then review-only ones, so the cap drops the least actionable end. "summary" always counts every change, and an "omitted" field reports what was left out and the number to pass to get all of it.',
              default: 50,
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
          'Extract the public API surface of a TypeScript project as a structured JSON snapshot, keyed by export subpath. Useful for inspecting what a library exports. The source can be a filesystem path, a git ref, or an npm spec, the same three forms semver_compare takes. Returns each symbol\'s name and kind by default; pass "detail" for full type shapes, which is far larger.',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Project source: a filesystem path, a git ref, or an npm spec such as "lodash@4.17.21". Defaults to current directory.',
              default: '.',
            },
            entry: {
              anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
              description: 'Entry file relative to project root (e.g. "src/index.ts"). Pass an array or a comma-separated string for a package with several entry points.',
            },
            pathAs: {
              type: 'string',
              enum: ['path', 'git', 'npm'],
              description: 'Force "path" to be treated as a filesystem path, a git ref, or an npm spec. Only needed when auto-detection would read the input as the wrong kind.',
            },
            detail: {
              type: 'boolean',
              description: 'Include each symbol\'s full type shape instead of just its kind. A shape runs a median of about 370 bytes and a wide interface tens of kilobytes, against about 35 for a name and a kind, so a large package will hit the byte budget after a few dozen symbols.',
              default: false,
            },
            maxBytes: {
              type: 'integer',
              minimum: 0,
              description: 'Byte budget for the symbols in the response (default 40000). Symbols are included while it lasts, and an "omitted" field then reports how many were left out along with the total. No symbol is exempt: under "detail" a single wide interface can cost tens of kilobytes, so a budget smaller than that returns no symbols and says so rather than overshooting. Only the entrypoint keys and the "omitted" field sit outside the budget, a few hundred bytes.',
              default: 40000,
            },
            installDeps: {
              type: 'boolean',
              description: 'Install dependencies before analysis',
              default: false,
            },
          },
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
          const entry = getOptionalEntry(args, 'entry');
          const oldAs = getOptionalSourceInputKind(args, 'oldAs');
          const newAs = getOptionalSourceInputKind(args, 'newAs');
          const installDeps = getOptionalBoolean(args, 'installDeps') ?? false;
          const declared = parseDeclaredBump(getOptionalString(args, 'declared'));
          const maxChanges = getOptionalCount(args, 'maxChanges') ?? DEFAULT_MAX_CHANGES;

          const report = await compare({
            oldSource: resolveSourceInput(oldInput, oldAs),
            newSource: resolveSourceInput(newInput, newAs),
            entry,
            installDeps,
            declared,
          });

          return {
            content: [{ type: 'text', text: JSON.stringify(forAgent(report, maxChanges), null, 2) }],
          };
        }

        case 'semver_snapshot': {
          const pathInput = getOptionalString(args, 'path') ?? '.';
          const entry = getOptionalEntry(args, 'entry');
          // `asGitRef` was this argument until 0.12.0. Ignoring it would resolve
          // a git ref as a filesystem path and answer with the wrong project
          // rather than an error, so it is refused by name.
          if (args.asGitRef !== undefined) {
            throw new Error('"asGitRef" was replaced by "pathAs". Pass pathAs: "git" instead.');
          }
          const pathAs = getOptionalSourceInputKind(args, 'pathAs');
          const detail = getOptionalBoolean(args, 'detail') ?? false;
          const maxBytes = getOptionalCount(args, 'maxBytes') ?? DEFAULT_MAX_BYTES;
          const installDeps = getOptionalBoolean(args, 'installDeps') ?? false;

          // The same resolver `semver_compare` uses, so the three source forms
          // and their auto-detection behave identically across the two tools.
          const source = resolveSourceInput(pathInput, pathAs);
          let projectPath: string;
          let tmpDir: string | null = null;

          try {
            if (source.type === 'npm') {
              const res = resolveNpmSpec(source.spec);
              tmpDir = res.tmpDir;
              projectPath = res.projectPath;
            } else if (source.type === 'git') {
              tmpDir = resolveGitRef(source.ref);
              projectPath = tmpDir;
              await ensureProjectDeps(projectPath);
            } else {
              projectPath = resolvePath(source.path);
              if (installDeps) {
                await ensureProjectDeps(projectPath);
              }
            }

            const snapshot = await extract({ projectPath, entry });
            // An empty surface is an extraction failure, not a package with no
            // API, and reporting it as a successful `{}` is the same wrong
            // answer `compare` and the CLI both refuse to give. Checked on what
            // was extracted rather than on what the budget kept, so a budget too
            // small to fit a symbol is not mistaken for an empty package.
            const unusable = describeUnusableSnapshot(snapshot);
            if (unusable) {
              throw new Error(
                `Cannot snapshot '${pathInput}': ${unusable}.\n` +
                  `  Pass "entry" to point at the declaration file explicitly.`,
              );
            }
            return {
              content: [
                { type: 'text', text: JSON.stringify(snapshotForAgent(snapshot, detail, maxBytes)) },
              ],
            };
          } finally {
            if (tmpDir) cleanupTmpDir(tmpDir);
          }
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
