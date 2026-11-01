import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Pins the options the resolvers hand to child processes, which the live npm
// tests cannot: a missing timeout only shows on a stalled registry, and an
// absolute tarball path only breaks under GNU tar on Windows.
const execFileSync = vi.hoisted(() => vi.fn());
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  execFileSync,
}));

const { ensureProjectDeps } = await import('../src/resolve/dependency-installer.js');
const { resolveNpmSpec } = await import('../src/resolve/npm-resolver.js');
const { cleanupTmpDir } = await import('../src/resolve/git-resolver.js');

beforeEach(() => execFileSync.mockReset());

describe('child process options', () => {
  it('gives both dependency installs a timeout', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'semver-checks-install-'));
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), '{}');
      await ensureProjectDeps(dir);
      const installs = execFileSync.mock.calls.filter(([, args]) => (args as string[]).includes('install'));
      expect(installs).toHaveLength(2);
      for (const [, , options] of installs) expect(options.timeout).toBe(10 * 60_000);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('names the tarball relative to the directory tar runs in', () => {
    execFileSync.mockImplementation((file: string, args: string[], options: { cwd: string }) => {
      if (file === 'tar') {
        fs.mkdirSync(path.join(options.cwd, 'package'));
        fs.writeFileSync(path.join(options.cwd, 'package', 'package.json'), '{}');
        return Buffer.from('');
      }
      return Buffer.from(JSON.stringify([{ filename: 'pkg-1.0.0.tgz' }]));
    });
    const { tmpDir } = resolveNpmSpec('pkg@1.0.0');
    try {
      const tar = execFileSync.mock.calls.find(([file]) => file === 'tar')!;
      expect(tar[1]).toEqual(['-xzf', 'pkg-1.0.0.tgz']);
      expect(tar[2].cwd).toBe(tmpDir);
    } finally {
      cleanupTmpDir(tmpDir);
    }
  });
});
