import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extract, runWorker } from '../src/extract/extractor.js';
import { cleanupTmpDir, resolveGitRef } from '../src/resolve/git-resolver.js';
import { resolveNpmSpec } from '../src/resolve/npm-resolver.js';

const workers = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'iso-workers');
const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

function mkScratch(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-limits-'));
  scratch.push(dir);
  return dir;
}

// A file outside every temp dir the resolvers create, holding a declaration that
// must never show up in a snapshot.
function outsideFile(): string {
  const file = path.join(mkScratch(), 'secret.d.ts');
  fs.writeFileSync(file, 'export declare const secret: string;\n');
  return file;
}

// A package whose entry re-exports `./leak`, a symlink to a file outside the
// package, next to `./own`, a symlink to a file of its own.
function writePackage(dir: string, outside: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'pkg', version: '1.0.0', types: './index.d.ts' }));
  fs.writeFileSync(path.join(dir, 'index.d.ts'), "export * from './leak';\nexport * from './own';\nexport declare const ok: number;\n");
  fs.writeFileSync(
    path.join(dir, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true, skipLibCheck: true }, include: ['**/*.d.ts'] }),
  );
  fs.writeFileSync(path.join(dir, 'real.d.ts'), 'export declare const mine: number;\n');
  fs.symlinkSync(outside, path.join(dir, 'leak.d.ts'));
  fs.symlinkSync('real.d.ts', path.join(dir, 'own.d.ts'));
}

function expectNoEscape(pkgDir: string): void {
  expect(fs.existsSync(path.join(pkgDir, 'leak.d.ts'))).toBe(false);
  expect(fs.lstatSync(path.join(pkgDir, 'own.d.ts')).isSymbolicLink()).toBe(true);
}

describe('extracted archives', () => {
  it('drops a symlink out of a git archive and keeps one inside it', async () => {
    const repo = mkScratch();
    writePackage(repo, outsideFile());
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
    git('init', '-q');
    git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'x');

    const tmpDir = resolveGitRef('HEAD', repo);
    try {
      expectNoEscape(tmpDir);
      const names = Object.keys((await extract({ projectPath: tmpDir })).entrypoints['.']);
      expect(names).not.toContain('secret');
      expect(names).toEqual(expect.arrayContaining(['ok', 'mine']));
    } finally {
      cleanupTmpDir(tmpDir);
    }
  });

  it('accepts a git archive that tar stops reading before its end', () => {
    // tar quits at the end-of-archive marker; trailing bytes it never reads used
    // to fail the write with EPIPE and the whole ref with it. A stand-in `git`
    // pads the real archive so that happens every time, not only under load.
    const repo = mkScratch();
    fs.writeFileSync(path.join(repo, 'index.d.ts'), 'export declare const ok: number;\n');
    const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
    const git = (...args: string[]) => execFileSync(realGit, args, { cwd: repo, stdio: 'ignore' });
    git('init', '-q');
    git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'x');
    const bin = mkScratch();
    fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\n'${realGit}' "$@" && head -c 8388608 /dev/zero\n`, { mode: 0o755 });

    const savedPath = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${savedPath}`;
    try {
      const tmpDir = resolveGitRef('HEAD', repo);
      try {
        expect(fs.readFileSync(path.join(tmpDir, 'index.d.ts'), 'utf8')).toContain('ok');
      } finally {
        cleanupTmpDir(tmpDir);
      }
    } finally {
      process.env.PATH = savedPath;
    }
  });

  it('drops a symlink out of an npm tarball', () => {
    // A stand-in `npm` on PATH that "downloads" a tarball built here, so the
    // real resolver runs end to end without the registry.
    const work = mkScratch();
    writePackage(path.join(work, 'package'), outsideFile());
    const tgz = path.join(work, 'pkg-1.0.0.tgz');
    execFileSync('tar', ['-czf', tgz, '-C', work, 'package']);
    const bin = mkScratch();
    fs.writeFileSync(
      path.join(bin, 'npm'),
      `#!/bin/sh\ncp '${tgz}' "$4/"\necho '[{"filename":"pkg-1.0.0.tgz"}]'\n`,
      { mode: 0o755 },
    );

    const savedPath = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${savedPath}`;
    try {
      const res = resolveNpmSpec('pkg@1.0.0');
      try {
        expectNoEscape(res.projectPath);
      } finally {
        cleanupTmpDir(res.tmpDir);
      }
    } finally {
      process.env.PATH = savedPath;
    }
  });
});

describe('extraction time limit', () => {
  it('terminates a worker that runs past the limit and names the package', async () => {
    const started = Date.now();
    await expect(runWorker(path.join(workers, 'hang.mjs'), null, 'slow-pkg@1.0.0', undefined, 200)).rejects.toThrow(
      /extracting 'slow-pkg@1\.0\.0' did not finish within 0\.2 s, not an answer/,
    );
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('runs one worker at a time, and a failed one does not block the next', async () => {
    // Parallel MCP calls each started a worker with the full heap limit.
    const order: string[] = [];
    const slow = runWorker(path.join(workers, 'hang.mjs'), null, 'slow', undefined, 300).catch(() => void order.push('hang'));
    const fast = runWorker(path.join(workers, 'echo.mjs'), 1, 'fast', undefined, 10_000).then(() => void order.push('echo'));
    await Promise.all([slow, fast]);
    expect(order).toEqual(['hang', 'echo']);
  });

  it('leaves a worker that answers in time alone', async () => {
    await expect(runWorker(path.join(workers, 'echo.mjs'), { a: 1 }, 'pkg', undefined, 10_000)).resolves.toEqual({ a: 1 });
  });

  it('caps a limit too large for setTimeout instead of firing at once', async () => {
    process.env.SEMVER_CHECKS_EXTRACT_TIMEOUT = '1e9';
    try {
      await expect(runWorker(path.join(workers, 'echo.mjs'), { a: 1 }, 'pkg')).resolves.toEqual({ a: 1 });
    } finally {
      delete process.env.SEMVER_CHECKS_EXTRACT_TIMEOUT;
    }
  });
});
