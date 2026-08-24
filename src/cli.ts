import { defineCommand, runMain } from 'citty';
import { compare } from './index.js';
import { parseDeclaredBump } from './declared.js';
import { parseEntryArg } from './entry-arg.js';
import { textReport } from './report/text-reporter.js';
import { jsonReport } from './report/json-reporter.js';
import { markdownReport } from './report/markdown-reporter.js';
import { githubReport } from './report/github-reporter.js';
import { extract } from './extract/extractor.js';
import { describeUnusableSnapshot } from './extract/api-snapshot.js';
import { resolvePath } from './resolve/path-resolver.js';
import { resolveGitRef, cleanupTmpDir } from './resolve/git-resolver.js';
import { resolveNpmSpec } from './resolve/npm-resolver.js';
import { resolveSourceInput, type SourceInputKind } from './resolve/source-ref.js';
import type { SemverReport } from './types.js';
import { ensureProjectDeps } from './resolve/dependency-installer.js';
import { getPackageVersion } from './package-info.js';

const compareCommand = defineCommand({
  meta: {
    name: 'compare',
    description: 'Compare two versions and detect breaking changes',
  },
  args: {
    old: {
      type: 'positional',
      description: 'Old version (git ref or path)',
      required: true,
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
    strictReview: {
      type: 'boolean',
      description: 'Exit with code 1 if any breaking change is found, including review-only (heuristic) ones',
      alias: 'strict-review',
      default: false,
    },
    installDeps: {
      type: 'boolean',
      description: 'Install dependencies before analysis for local path inputs',
      default: false,
    },
    oldAs: {
      type: 'string',
      description: 'Force the old input to be treated as path, ref, or npm',
    },
    newAs: {
      type: 'string',
      description: 'Force the new input to be treated as path, ref, or npm',
    },
  },
  async run({ args }) {
    const oldRef = args.old;
    const newRef = args.new ?? '.';

    try {
      const report = await compare({
        oldSource: resolveSourceInput(oldRef, parseSourceInputKind(args.oldAs, '--old-as')),
        newSource: resolveSourceInput(newRef, parseSourceInputKind(args.newAs, '--new-as')),
        entry: parseEntryArg(args.entry as string | string[] | undefined),
        installDeps: args.installDeps,
        declared: parseDeclaredBump(args.declared),
      });

      console.log(renderReport(report, args.format));

      // A declared bump replaces the strict flags as the gate. The question stops
      // being "is anything breaking here" and becomes "does the release admit to
      // it", so a proven break the release already declares is not a failure.
      // The verdict keeps the same graded-confidence line the strict flags draw:
      // only a proven break fails the run, and an addition that argues for a
      // higher bump is a note on a passing one.
      //
      // Without it, `--strict` gates on confident (proven) breaks only, and
      // review-only majors do not fail CI unless `--strict-review` opts into the
      // prior "any major fails" behaviour.
      // `--strict-review` keeps its meaning under a declaration rather than
      // being cancelled by it: it promotes the review note to a failure, so a
      // release that understates a review-only finding fails for whoever asked
      // for that. `--strict` is the one the declaration subsumes, since its
      // question is the half the declaration already answers.
      const failBuild = report.declaration
        ? report.declaration.verdict === 'mismatch' ||
          (args.strictReview && report.declaration.verdict === 'review')
        : (args.strictReview && report.summary.major > 0) ||
          (args.strict && report.summary.majorProven > 0);
      if (failBuild) {
        process.exit(1);
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(2);
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
    installDeps: {
      type: 'boolean',
      description: 'Install dependencies before analysis for local path inputs',
      default: false,
    },
  },
  async run({ args }) {
    let projectPath: string;
    let tmpDir: string | null = null;
    const shouldInstallDeps = !!args.installDeps;

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

      const snapshot = await extract({ projectPath, entry: parseEntryArg(args.entry as string | string[] | undefined) });
      // Printing `{"entrypoints":{".":{}}}` and exiting 0 reads as "this package
      // has no public API" when it actually means the extraction found nothing.
      // Same contract as `compare`: a non-answer exits 2.
      const unusable = describeUnusableSnapshot(snapshot);
      if (unusable) {
        throw new Error(
          `Cannot snapshot '${args.npm ?? args.ref ?? args.path ?? '.'}': ${unusable}.\n` +
            `  Pass --entry to point at the declaration file explicitly.`,
        );
      }
      console.log(JSON.stringify(snapshot, null, 2));
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(2);
    } finally {
      if (tmpDir) cleanupTmpDir(tmpDir);
    }
  },
});

const main = defineCommand({
  meta: {
    name: 'semver-checks',
    description: 'Detect breaking changes in your TypeScript library\'s public API',
    version: getPackageVersion(),
  },
  subCommands: {
    compare: compareCommand,
    snapshot: snapshotCommand,
  },
});

if (process.argv.includes('--mcp')) {
  import('./mcp.js')
    .then((m) => m.startMcpServer())
    .catch((err: any) => {
      console.error(`Error: ${err.message}`);
      process.exit(2);
    });
} else {
  runMain(main);
}
