import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { compare } from './index.js';
import { gateFails, parseDeclaredBump } from './declared.js';
import { parseEntryArg } from './entry-arg.js';
import { extract } from './extract/extractor.js';
import { describeUnusableSnapshot } from './extract/api-snapshot.js';
import { InvalidSourceInput, resolveSourceInput, type SourceInputKind } from './resolve/source-ref.js';
import { resolvePath } from './resolve/path-resolver.js';
import { resolveNpmSpec } from './resolve/npm-resolver.js';
import { resolveGitRef, cleanupTmpDir } from './resolve/git-resolver.js';
import { ensureProjectDeps } from './resolve/dependency-installer.js';
import { getPackageVersion } from './package-info.js';
import type { ApiChange, SemverReport } from './types.js';
import type { ApiSnapshot } from './extract/api-snapshot.js';

// A caller that cannot re-read its own request has to tell two failures apart
// from one string: one it can fix by sending different arguments, and one where
// the arguments were fine and the project could not be analyzed. Retrying the
// second is wasted work, and rewriting arguments for the first is the only thing
// that helps, so the distinction is carried as a code rather than left in prose.
class InvalidArgument extends Error {}

type ErrorCode = 'invalid_argument' | 'analysis_failed';

function errorResult(message: string, code: ErrorCode = 'analysis_failed') {
  return {
    content: [{ type: 'text' as const, text: `Error: [${code}] ${message}` }],
    isError: true,
    // Alongside the text, because a client that only renders content still shows
    // the message while one that reads the result can branch on the code.
    error: { code, message },
  };
}

function getOptionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new InvalidArgument(`"${key}" argument must be a string`);
  }
  return value;
}

function getRequiredString(args: Record<string, unknown>, key: string): string {
  const value = getOptionalString(args, key);
  if (value === undefined) {
    throw new InvalidArgument(`"${key}" argument is required and must be a string`);
  }
  return value;
}

function getOptionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new InvalidArgument(`"${key}" argument must be a boolean`);
  }
  return value;
}

function getOptionalSourceInputKind(
  args: Record<string, unknown>,
  key: string,
): SourceInputKind | undefined {
  const value = getOptionalString(args, key);
  // An empty string is how a template or a shell wrapper spells "I did not set
  // this", and `parseSourceInputKind` on the CLI already reads it that way.
  // Refusing it here made the same call succeed on one surface and fail on the
  // other.
  if (value === undefined || value === '') return undefined;
  // `ref` is the CLI's spelling for the same thing, and the README uses it in
  // the monorepo-tag advice, so a caller that read either lands on it.
  if (value === 'ref') return 'git';
  if (value === 'path' || value === 'git' || value === 'npm') {
    return value;
  }
  throw new InvalidArgument(`"${key}" argument must be one of: path, ref (or git), npm`);
}

// `entry` arrives as one path, several, or a comma-separated string, the same
// three shapes the CLI accepts. A plain string check would turn "a.ts,b.ts"
// into a filename with a comma in it, which reads as a missing file rather
// than as the two entries that were asked for.
function getOptionalEntry(args: Record<string, unknown>, key: string): string | string[] | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value === 'string') return asArgumentError(() => parseEntryArg(value));
  if (Array.isArray(value) && value.every((e) => typeof e === 'string')) {
    return asArgumentError(() => parseEntryArg(value as string[]));
  }
  throw new InvalidArgument(`"${key}" argument must be a string or an array of strings`);
}

// `parseEntryArg` and `parseDeclaredBump` are shared with the CLI, where every
// error is the same kind, so they throw a plain Error. Reaching them means the
// caller sent a value, which makes the failure a fixable one either way.
function asArgumentError<T>(read: () => T): T {
  try {
    return read();
  } catch (err: any) {
    throw new InvalidArgument(err.message);
  }
}

function getOptionalCount(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new InvalidArgument(`"${key}" argument must be a non-negative integer`);
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
// What each CLI gate would do with this report. The CLI answers it with an exit
// code; a caller here would otherwise have to rebuild a two-branch rule out of
// `summary` and `declaration`, which is a place to be subtly wrong about the one
// thing the tool exists to say.
function gateFor(report: SemverReport) {
  const verdict = (flags: { strict?: boolean; strictReview?: boolean }) =>
    gateFails(report, flags) ? 'fail' : 'pass';
  return { strict: verdict({ strict: true }), strictReview: verdict({ strictReview: true }) };
}

function forAgent(report: SemverReport, maxChanges: number): unknown {
  const ordered = [...report.changes].sort((a, b) => changeRank(a) - changeRank(b));
  const gate = gateFor(report);
  if (ordered.length <= maxChanges) return { ...report, gate, changes: ordered };
  const shown = ordered.slice(0, maxChanges);
  return {
    ...report,
    gate,
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

const TOOLS = [
  {
    name: 'semver_compare',
    description:
      'Compare two versions of a TypeScript library and detect breaking API changes. Either side can be a filesystem path, a git ref, or an npm spec, so a working tree can be compared against the published release without checking anything out. Returns the recommended SemVer bump (major/minor/patch) and a list of changes. Each change carries a confidence: "proven" (a structurally confident break — gate on these) or "heuristic" (a conservative major the tool could not prove safe — surface for review). summary.majorProven / majorReview split the major count accordingly. Pass "declared" to have the tool grade the bump the release writes down instead of just recommending one. The "gate" field answers what each CLI gate would do with this report, which is what its exit code carries: "strict" fails only on a proven break and is the one safe to leave on every build, while "strictReview" also fails on a major the analyzer could not prove. They are not two strengths of the same check. A passing "strict" is not a clean bill of health, because a real break it could not prove stays review-only; "green means safe" is a claim only "strictReview" can make. Report both rather than reading "strict": "pass" as "nothing broke". Passing "declared" changes the question both gates answer: the release is then graded against the bump it writes down, so a major it already declares passes both.',
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
          enum: ['path', 'git', 'ref', 'npm'],
          description: 'Force "old" to be treated as a filesystem path, a git ref, or an npm spec. "ref" is an accepted spelling of "git". Only needed when auto-detection would read the input as the wrong kind, which is what a monorepo tag shaped like "pkg@1.2.3" needs.',
        },
        newAs: {
          type: 'string',
          enum: ['path', 'git', 'ref', 'npm'],
          description: 'Force "new" to be treated as a filesystem path, a git ref, or an npm spec. "ref" is an accepted spelling of "git".',
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
      // A `tools/call` carries the tool's own schema as its arguments, so a
      // field that is not in it is a mistake — most often a caller reaching
      // for a name the CLI uses. Refusing it says so; accepting it runs the
      // analysis with the flag silently dropped and hands back a confident
      // answer to a question nobody asked. That trade is worse when the
      // caller is a model that will not notice its argument went missing.
      additionalProperties: false,
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
          enum: ['path', 'git', 'ref', 'npm'],
          description: 'Force "path" to be treated as a filesystem path, a git ref, or an npm spec. "ref" is an accepted spelling of "git". Only needed when auto-detection would read the input as the wrong kind.',
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
      additionalProperties: false,
    },
  },
];

// `additionalProperties: false` on the schemas above is a statement to the
// caller, not a check: the SDK hands `tools/call` arguments through untouched,
// so an argument that is not in the schema reaches the handler and is dropped by
// the `get*` readers without a word. A caller reaching for a CLI flag name would
// get an analysis that ignored it and no sign that anything went wrong, which is
// the worst shape for a caller that cannot re-read its own request.
// An argument that was renamed rather than merely mistyped, answered with what
// replaced it. `asGitRef` was `pathAs` until 0.12.0, and ignoring it would
// resolve a git ref as a filesystem path and answer confidently about the wrong
// project.
const RENAMED_ARGUMENTS: Record<string, string> = {
  asGitRef: '"asGitRef" was replaced by "pathAs". Pass pathAs: "git" instead.',
};

function rejectUnknownArguments(name: string, args: Record<string, unknown>): void {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return;
  const allowed = Object.keys(tool.inputSchema.properties);
  const unknown = Object.keys(args).filter((key) => !allowed.includes(key));
  for (const key of unknown) {
    if (RENAMED_ARGUMENTS[key]) throw new InvalidArgument(RENAMED_ARGUMENTS[key]);
  }
  if (unknown.length > 0) {
    throw new InvalidArgument(
      `Unknown argument${unknown.length > 1 ? 's' : ''} for ${name}: ${unknown.join(', ')}. ` +
        `Accepted: ${allowed.join(', ')}.`,
    );
  }
}

export function createMcpServer(): Server {
  const server = new Server(
    { name: 'semver-checks', version: getPackageVersion() },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs = {} } = request.params;
    const args = rawArgs as Record<string, unknown>;
    try {
      rejectUnknownArguments(name, args);
      switch (name) {
        case 'semver_compare': {
          const oldInput = getRequiredString(args, 'old');
          const newInput = getOptionalString(args, 'new') ?? '.';
          const entry = getOptionalEntry(args, 'entry');
          const oldAs = getOptionalSourceInputKind(args, 'oldAs');
          const newAs = getOptionalSourceInputKind(args, 'newAs');
          const installDeps = getOptionalBoolean(args, 'installDeps') ?? false;
          const declared = asArgumentError(() => parseDeclaredBump(getOptionalString(args, 'declared')));
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
          return errorResult(`Unknown tool: ${name}`, 'invalid_argument');
      }
    } catch (err: any) {
      // `InvalidSourceInput` is thrown for a source that is malformed rather than
      // missing, which is the same kind of mistake a misspelled argument is.
      const fixable = err instanceof InvalidArgument || err instanceof InvalidSourceInput;
      return errorResult(err.message, fixable ? 'invalid_argument' : 'analysis_failed');
    }
  });

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
