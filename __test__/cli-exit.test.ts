import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The CLI runs on import, so each case sets argv, re-imports src/cli.ts, and
// waits for it. Everything here reads local fixtures: no network.

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, 'fixtures', 'class-accessor-removed');
const OLD = path.join(fixture, 'old');
const NEW = path.join(fixture, 'new');

interface CliRun {
  code: number | undefined;
  stdout: string;
  stderr: string;
}

const SIGNALS = ['SIGHUP', 'SIGINT', 'SIGTERM'] as const;

async function runCli(...args: string[]): Promise<CliRun> {
  const argv = process.argv;
  // Each import registers the CLI's signal handlers; drop them again afterwards.
  const listeners = SIGNALS.map((signal) => process.listeners(signal));
  let stdout = '';
  let stderr = '';
  vi.spyOn(console, 'log').mockImplementation((...a) => void (stdout += a.join(' ') + '\n'));
  vi.spyOn(console, 'error').mockImplementation((...a) => void (stderr += a.join(' ') + '\n'));
  // A process.exit() here would end the test run; the CLI must only set exitCode.
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`process.exit(${code}) called`);
  });
  process.argv = ['node', 'semver-checks', ...args];
  try {
    vi.resetModules();
    const { cliDone } = await import('../src/cli.js');
    await cliDone;
    return { code: process.exitCode === undefined ? undefined : Number(process.exitCode), stdout, stderr };
  } finally {
    process.argv = argv;
    process.exitCode = undefined;
    vi.restoreAllMocks();
    SIGNALS.forEach((signal, i) => {
      for (const l of process.listeners(signal)) if (!listeners[i].includes(l)) process.removeListener(signal, l);
    });
  }
}

afterEach(() => {
  process.exitCode = undefined;
});

describe('CLI exit codes', () => {
  it('exits 1 when --strict finds a proven break', async () => {
    expect((await runCli('compare', OLD, NEW, '--strict')).code).toBe(1);
  });

  it('accepts the kebab and camelCase spellings of --strict-review', async () => {
    expect((await runCli('compare', OLD, NEW, '--strict-review')).code).toBe(1);
    expect((await runCli('compare', OLD, NEW, '--strictReview')).code).toBe(1);
  });

  it('exits 2 on an unknown flag instead of ignoring it', async () => {
    // A misspelled --strict used to be dropped, so a proven break passed the gate.
    const run = await runCli('compare', OLD, NEW, '--stirct');
    expect(run.code).toBe(2);
    expect(run.stderr).toContain("Unknown option '--stirct'");
  });

  it('exits 2 on an unknown single-letter flag', async () => {
    expect((await runCli('compare', OLD, NEW, '-sz')).code).toBe(2);
  });

  it('exits 2 on an unknown command', async () => {
    const run = await runCli('comapre', OLD, NEW);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain("Unknown command 'comapre'");
  });

  it('exits 2 on an unknown flag next to --version', async () => {
    expect((await runCli('--strict-reveiw', '--version')).code).toBe(2);
  });

  it('answers --version after a subcommand', async () => {
    const run = await runCli('compare', '--version');
    expect(run.code).toBeUndefined();
    expect(run.stdout).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('reads a camelCase boolean before the positionals as a flag, not as taking a value', async () => {
    // --strictReview used to swallow OLD as its value and compare NEW against the cwd.
    expect((await runCli('compare', '--strictReview', OLD, NEW)).code).toBe(1);
    const run = await runCli('snapshot', '--installDeps', NEW);
    expect(run.code).toBeUndefined();
    expect(Object.keys(JSON.parse(run.stdout).entrypoints['.'])).toEqual(['C']);
  });

  it('treats everything after -- as arguments, --help included', async () => {
    // A source named `--help` must not answer with usage and exit 0.
    const run = await runCli('compare', '--strict', '--', '--help', '.');
    expect(run.code).toBe(2);
    expect(run.stdout).not.toContain('USAGE');
  });

  it('exits 2 when a string flag would take a word starting with -', async () => {
    const run = await runCli('compare', OLD, NEW, '--entry', '-x.d.ts');
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('--entry=<value>');
  });

  it('does not take a source named like a subcommand for the subcommand', async () => {
    const run = await runCli('compare', '--format', 'json', OLD, 'snapshot');
    expect(run.code).toBe(2);
    expect(run.stderr).not.toContain('Unknown option');
  });

  it('runs compare when only flags are given', async () => {
    // The default old side is read from the cwd's package.json, which here has
    // no name: that error can only come from compare running.
    vi.spyOn(process, 'cwd').mockReturnValue(path.join(here, 'fixtures', 'iso-cli-noname'));
    const run = await runCli('--format', 'json');
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('has no "name"');
  });

  it('accepts a value attached to a short flag with =', async () => {
    const run = await runCli('compare', OLD, NEW, '-f=json', '-s');
    expect(run.code).toBe(1);
    expect(JSON.parse(run.stdout).summary.majorProven).toBe(1);
  });

  it('exits 2 on an unknown snapshot flag', async () => {
    expect((await runCli('snapshot', NEW, '--bogus')).code).toBe(2);
  });

  it('reads the value of a flag before the subcommand as a value, not a command', async () => {
    const run = await runCli('--format', 'json', 'compare', OLD, NEW);
    expect(run.code).toBeUndefined();
    expect(JSON.parse(run.stdout).summary.majorProven).toBe(1);
  });

  it('prints the kebab spellings in compare --help', async () => {
    const run = await runCli('compare', '--help');
    expect(run.code).toBeUndefined();
    for (const flag of ['--strict-review', '--install-deps', '--old-as', '--new-as']) {
      expect(run.stdout).toContain(flag);
    }
    expect(run.stdout).not.toMatch(/--oldAs|--newAs|--strictReview|--installDeps|[^-]-strict-review/);
  });
});
