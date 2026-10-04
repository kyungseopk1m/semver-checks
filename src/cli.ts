import { defineCommand, renderUsage, runCommand, type ArgsDef, type CommandDef } from 'citty';
import pc from 'picocolors';
import { compare } from './index.js';
import { gateFails, parseDeclaredBump } from './declared.js';
import { parseEntryArg } from './entry-arg.js';
import { textReport } from './report/text-reporter.js';
import { jsonReport } from './report/json-reporter.js';
import { markdownReport } from './report/markdown-reporter.js';
import { githubReport } from './report/github-reporter.js';
import { extractAs } from './extract/extractor.js';
import { describeUnusableSnapshot } from './extract/api-snapshot.js';
import { resolvePath } from './resolve/path-resolver.js';
import { resolveGitRef, cleanupTmpDir, cleanupLiveTmpDirs } from './resolve/git-resolver.js';
import { resolveNpmSpec } from './resolve/npm-resolver.js';
import { resolveSourceInput, type SourceInputKind } from './resolve/source-ref.js';
import type { SemverReport } from './types.js';
import { ensureProjectDeps } from './resolve/dependency-installer.js';
import { defaultOldSource, getPackageVersion } from './package-info.js';

const compareCommand = defineCommand({
  meta: {
    name: 'compare',
    description: 'Compare two versions and detect breaking changes',
  },
  args: {
    old: {
      type: 'positional',
      description: 'Old version (git ref, path, or npm spec; defaults to this package\'s latest release)',
      required: false,
    },
    new: {
      type: 'positional',
      description: 'New version (git ref or path, defaults to current directory)',
      required: false,
    },
    entry: {
      type: 'string',
      description: 'Entry file(s), e.g. src/index.ts. Repeat the flag or comma-separate for multiple entries.',
      alias: 'e',
    },
    format: {
      type: 'string',
      description: 'Output format: text (default), json, markdown, or github',
      alias: 'f',
      default: 'text',
    },
    strict: {
      type: 'boolean',
      description: 'Exit with code 1 if a confident (proven) breaking change is found. Safe to gate CI on.',
      alias: 's',
      default: false,
    },
    declared: {
      type: 'string',
      description:
        'Bump this release declares: major, minor, patch, none, or auto to read it from .changeset/*.md and then the package.json versions. Gates on the declaration instead of --strict.',
    },
    // Multi-word flags are named in their documented kebab spelling, which is
    // what --help prints, and carry no `default`: citty seeds a default under the
    // literal name, so with one `--installDeps` would land under its own key while
    // the seeded `install-deps: false` kept winning the lookup. Without it the
    // lookup falls through to the camelCase key, and both spellings work.
    'strict-review': {
      type: 'boolean',
      description: 'Exit with code 1 if any breaking change is found, including review-only (heuristic) ones',
    },
    'install-deps': {
      type: 'boolean',
      description: 'Install dependencies before analysis for local path inputs',
    },
    'old-as': {
      type: 'string',
      description: 'Force the old input to be treated as path, ref, or npm',
    },
    'new-as': {
      type: 'string',
      description: 'Force the new input to be treated as path, ref, or npm',
    },
  },
  async run({ args }) {
    const newRef = args.new ?? '.';

    try {
      // Inside the try so a package.json that cannot answer this reports one
      // line and exit 2, the way every other unusable input does.
      const oldRef = args.old ?? defaultOldSource(process.cwd());

      const report = await compare({
        oldSource: resolveSourceInput(oldRef, parseSourceInputKind(args['old-as'], '--old-as')),
        newSource: resolveSourceInput(newRef, parseSourceInputKind(args['new-as'], '--new-as')),
        entry: parseEntryArg(args.entry as string | string[] | undefined),
        installDeps: !!args['install-deps'],
        declared: parseDeclaredBump(args.declared),
      });

      console.log(renderReport(report, args.format));

      // The rule lives in `gateFails`, so the MCP surface reports the same
      // verdict this exit code carries instead of a second copy of it.
      // process.exitCode, not process.exit(): stdout to a pipe is asynchronous,
      // and exiting here would cut a long report off mid-write.
      if (gateFails(report, { strict: args.strict, strictReview: !!args['strict-review'] })) {
        process.exitCode = 1;
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exitCode = 2;
    }
  },
});

function renderReport(report: SemverReport, format: string): string {
  switch (format) {
    case 'text':
      return textReport(report);
    case 'json':
      return jsonReport(report);
    case 'markdown':
      return markdownReport(report);
    case 'github':
      return githubReport(report);
    default:
      throw new Error(`--format must be one of: text, json, markdown, github`);
  }
}

function parseSourceInputKind(input: string | undefined, flagName: string): SourceInputKind | undefined {
  if (!input) return undefined;
  if (input === 'path') return 'path';
  if (input === 'ref' || input === 'git') return 'git';
  if (input === 'npm') return 'npm';
  throw new Error(`${flagName} must be one of: path, ref (or git), npm`);
}

const snapshotCommand = defineCommand({
  meta: {
    name: 'snapshot',
    description: 'Print the extracted API surface of a project',
  },
  args: {
    path: {
      type: 'positional',
      description: 'Project path (default: current directory)',
      required: false,
    },
    entry: {
      type: 'string',
      description: 'Entry file(s). Repeat the flag or comma-separate for multiple entries.',
      alias: 'e',
    },
    ref: {
      type: 'string',
      description: 'Git ref (instead of path)',
      alias: 'r',
    },
    npm: {
      type: 'string',
      description: 'npm spec (e.g. lodash@4.17.21) to snapshot from the registry',
    },
    'install-deps': {
      type: 'boolean',
      description: 'Install dependencies before analysis for local path inputs',
    },
  },
  async run({ args }) {
    let projectPath: string;
    let tmpDir: string | null = null;
    const shouldInstallDeps = !!args['install-deps'];

    try {
      if (args.npm) {
        const res = resolveNpmSpec(args.npm);
        tmpDir = res.tmpDir;
        projectPath = res.projectPath;
      } else if (args.ref) {
        tmpDir = resolveGitRef(args.ref);
        projectPath = tmpDir;
        await ensureProjectDeps(projectPath);
      } else {
        projectPath = resolvePath(args.path ?? '.');
        if (shouldInstallDeps) {
          await ensureProjectDeps(projectPath);
        }
      }

      const label = args.npm ?? args.ref ?? args.path ?? '.';
      const snapshot = await extractAs({ projectPath, entry: parseEntryArg(args.entry as string | string[] | undefined) }, label);
      // Printing `{"entrypoints":{".":{}}}` and exiting 0 reads as "this package
      // has no public API" when it actually means the extraction found nothing.
      // Same contract as `compare`: a non-answer exits 2.
      const unusable = describeUnusableSnapshot(snapshot);
      if (unusable) {
        throw new Error(
          `Cannot snapshot '${label}': ${unusable}.\n` +
            `  Pass --entry to point at the declaration file explicitly.`,
        );
      }
      console.log(JSON.stringify(snapshot, null, 2));
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exitCode = 2;
    } finally {
      if (tmpDir) cleanupTmpDir(tmpDir);
    }
  },
});

const subCommands: Record<string, CommandDef<any>> = {
  compare: compareCommand,
  snapshot: snapshotCommand,
};

const main = defineCommand({
  meta: {
    name: 'semver-checks',
    description: 'Detect breaking changes in your TypeScript library\'s public API',
    version: getPackageVersion(),
  },
  subCommands,
});

interface Flag {
  type: 'string' | 'boolean';
  /** The spelling handed to citty: the declared name, so every spelling parses the same way. */
  canonical: string;
}

// Every spelling a flag is accepted in: the name, its kebab and camelCase forms,
// the aliases, and `--no-` for booleans. `--flag=value` is split before the
// lookup.
function flagSpellings(args: ArgsDef): Map<string, Flag> {
  const spellings = new Map<string, Flag>([
    ['--help', { type: 'boolean', canonical: '--help' }],
    ['-h', { type: 'boolean', canonical: '-h' }],
    ['--version', { type: 'boolean', canonical: '--version' }],
  ]);
  for (const [name, def] of Object.entries(args)) {
    if (def.type !== 'string' && def.type !== 'boolean') continue;
    const type = def.type;
    const aliases = def.alias === undefined ? [] : Array.isArray(def.alias) ? def.alias : [def.alias];
    for (const word of [name, ...aliases]) {
      if (word.length === 1) {
        spellings.set(`-${word}`, { type, canonical: `-${word}` });
        continue;
      }
      const kebab = word.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      const camel = word.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      for (const long of [word, kebab, camel]) {
        spellings.set(`--${long}`, { type, canonical: `--${name}` });
        if (type === 'boolean') spellings.set(`--no-${long}`, { type, canonical: `--no-${name}` });
      }
    }
  }
  return spellings;
}

class UsageError extends Error {}

// The flags of both commands, used only to find where the subcommand sits.
// No flag is a string in one command and a boolean in the other.
const allArgs = { ...(snapshotCommand.args as ArgsDef), ...(compareCommand.args as ArgsDef) };

/**
 * Checks argv against a command's flags and rewrites each long flag to its
 * declared name. citty only knows a boolean by that name, so `--strictReview`
 * reached it as an unknown flag and swallowed the next word as its value.
 *
 * Returns the index of the first positional argument, skipping the value that
 * follows a string flag (`--format json`), or -1. Throws on a flag the command
 * does not define, which citty would otherwise ignore: a misspelled `--stirct`
 * used to turn a failing CI gate into a silent pass. Nothing after `--` is read.
 */
function scanArgs(argv: string[], args: ArgsDef): { first: number; argv: string[] } {
  const spellings = flagSpellings(args);
  const out = [...argv];
  let first = -1;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') break;
    if (!arg.startsWith('-') || arg === '-') {
      if (first === -1) first = i;
      continue;
    }
    let flag: string;
    let value: string | undefined;
    let spec: Flag | undefined;
    if (arg.startsWith('--')) {
      [flag, value] = arg.split(/=(.*)/s);
      spec = spellings.get(flag);
      if (!spec) throw new UsageError(`Unknown option '${flag}'`);
      out[i] = value === undefined ? spec.canonical : `${spec.canonical}=${value}`;
    } else {
      // `-sf json` or `-f=json`: a run of single-letter flags, the last of which
      // takes the next word unless its value is attached with '='.
      const [letters, attached] = arg.slice(1).split(/=(.*)/s);
      for (const letter of letters) {
        if (!spellings.has(`-${letter}`)) throw new UsageError(`Unknown option '-${letter}'`);
      }
      flag = `-${letters.at(-1)}`;
      value = attached;
      spec = spellings.get(flag);
    }
    if (spec?.type !== 'string' || value !== undefined) continue;
    // citty reads a following word that starts with '-' as another flag and
    // leaves this one empty, so `--entry -x.d.ts` would run with no entry.
    const next = argv[i + 1];
    if (next === undefined || (next.startsWith('-') && next !== '-')) {
      throw new UsageError(`Option '${flag}' needs a value; write one that starts with '-' as ${flag}=<value>`);
    }
    i++;
  }
  return { first, argv: out };
}

/**
 * Puts the subcommand first, defaulting to `compare`. citty takes the first
 * argument without a leading '-' as the subcommand, so `--format json` read as a
 * command named `json`, and `--strict compare a b` only worked because `--strict`
 * takes no value. Flags are checked against the command they belong to.
 */
function normalizeArgv(argv: string[]): string[] {
  const { first } = scanArgs(argv, allArgs);
  const name = first === -1 ? 'compare' : argv[first];
  if (!Object.hasOwn(subCommands, name)) throw new UsageError(`Unknown command '${name}'`);
  const rest = first === -1 ? argv : [...argv.slice(0, first), ...argv.slice(first + 1)];
  return [name, ...scanArgs(rest, subCommands[name].args as ArgsDef).argv];
}

// Only what comes before `--` can be an option; after it every word is an
// argument, even `--help` (a source named `--help` must not pass a CI gate).
function optionsPart(argv: string[]): string[] {
  const end = argv.indexOf('--');
  return end === -1 ? argv : argv.slice(0, end);
}

async function runCli(argv: string[]): Promise<void> {
  try {
    // Checked first, so a misspelled flag next to --help or --version is still
    // reported rather than answered around.
    const rawArgs = normalizeArgv(argv);
    const options = optionsPart(rawArgs);
    if (options.includes('--help') || options.includes('-h')) {
      // `--help` with no subcommand answers for the top level, where both are listed.
      const named = scanArgs(argv, allArgs).first !== -1;
      // What citty's showUsage prints, through console.log rather than consola,
      // whose level hides it under test runners.
      const usage = await (named ? renderUsage(subCommands[rawArgs[0]], main) : renderUsage(main));
      console.log(usage.replace(/`([^`]+)`/g, (_, text: string) => pc.cyan(text)));
      return;
    }
    if (options.includes('--version')) {
      console.log(getPackageVersion());
      return;
    }
    // Errors from a command's own work are handled inside its run(); anything
    // reaching this catch is the command line itself being wrong.
    await runCommand(main, { rawArgs });
  } catch (err: any) {
    console.error(`Error: ${err.message}\n  Run 'semver-checks --help' for usage.`);
    process.exitCode = 2;
  }
}

// A signal ends the process without running any `finally`, so the temp dirs the
// resolvers created are removed here. The codes are the shell's 128 + signal number.
for (const [signal, code] of [['SIGHUP', 129], ['SIGINT', 130], ['SIGTERM', 143]] as const) {
  process.once(signal, () => {
    cleanupLiveTmpDirs();
    process.exit(code);
  });
}

/** Settles once the command has finished (the MCP server: once it has started). */
export const cliDone: Promise<void> = optionsPart(process.argv.slice(2)).includes('--mcp')
  ? import('./mcp.js')
      .then((m) => m.startMcpServer())
      .catch((err: any) => {
        console.error(`Error: ${err.message}`);
        process.exitCode = 2;
      })
  : runCli(process.argv.slice(2));
