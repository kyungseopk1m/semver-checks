import { defineCommand, runMain } from 'citty';
import { createRequire } from 'module';
import { compare } from './index.js';
import { textReport } from './report/text-reporter.js';
import { jsonReport } from './report/json-reporter.js';
import { extract } from './extract/extractor.js';
import { resolvePath } from './resolve/path-resolver.js';
import { resolveGitRef, cleanupTmpDir } from './resolve/git-resolver.js';

const _require = createRequire(import.meta.url);
const pkg = _require('../../package.json') as { version: string };

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
      description: 'Entry file (e.g. src/index.ts)',
      alias: 'e',
    },
    format: {
      type: 'string',
      description: 'Output format: text (default) or json',
      alias: 'f',
      default: 'text',
    },
    strict: {
      type: 'boolean',
      description: 'Exit with code 1 if breaking changes are found',
      alias: 's',
      default: false,
    },
  },
  async run({ args }) {
    const oldRef = args.old;
    const newRef = args.new ?? '.';
    const isOldPath = oldRef.startsWith('.') || oldRef.startsWith('/');
    const isNewPath = newRef.startsWith('.') || newRef.startsWith('/');

    try {
      const report = await compare({
        oldSource: isOldPath ? { type: 'path', path: oldRef } : { type: 'git', ref: oldRef },
        newSource: isNewPath ? { type: 'path', path: newRef } : { type: 'git', ref: newRef },
        entry: args.entry,
      });

      if (args.format === 'json') {
        console.log(jsonReport(report));
      } else {
        console.log(textReport(report));
      }

      if (args.strict && report.recommended === 'major') {
        process.exit(1);
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(2);
    }
  },
});

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
      description: 'Entry file',
      alias: 'e',
    },
    ref: {
      type: 'string',
      description: 'Git ref (instead of path)',
      alias: 'r',
    },
  },
  async run({ args }) {
    let projectPath: string;
    let tmpDir: string | null = null;

    try {
      if (args.ref) {
        tmpDir = resolveGitRef(args.ref);
        projectPath = tmpDir;
      } else {
        projectPath = resolvePath(args.path ?? '.');
      }

      const snapshot = await extract({ projectPath, entry: args.entry });
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
    version: pkg.version,
  },
  subCommands: {
    compare: compareCommand,
    snapshot: snapshotCommand,
  },
});

runMain(main);
