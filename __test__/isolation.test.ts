import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWorker } from '../src/extract/extractor.js';
import { cleanupLiveTmpDirs, trackTmpDir } from '../src/resolve/git-resolver.js';

// The real extraction worker only exists in the compiled build, so these drive
// the same parent-side handling with small stand-in workers.
const workers = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'iso-workers');

describe('extraction worker', () => {
  it('turns heap exhaustion into an error instead of aborting the process', async () => {
    await expect(runWorker(path.join(workers, 'oom.mjs'), null, 'huge-pkg', 16)).rejects.toThrow(
      /ran out of memory extracting 'huge-pkg' \(heap limit about 16 MB\), not an answer/,
    );
  });

  it('passes a thrown error through with its message', async () => {
    await expect(runWorker(path.join(workers, 'throws.mjs'), null, 'pkg')).rejects.toThrow(
      'Entry file not found: nowhere.d.ts',
    );
  });

  it('rejects when the worker exits without answering', async () => {
    await expect(runWorker(path.join(workers, 'silent-exit.mjs'), null, 'pkg')).rejects.toThrow(
      /stopped \(worker exit code 3\) before answering/,
    );
  });

  it('returns the answer intact across the thread boundary', async () => {
    const snapshot = {
      entrypoints: { '.': { a: { kind: 'function', name: 'a', signatures: [], extra: undefined } } },
      order: ['z', 'a'],
    };
    const answer = await runWorker<typeof snapshot>(path.join(workers, 'echo.mjs'), snapshot, 'pkg');
    expect(JSON.stringify(answer)).toBe(JSON.stringify(snapshot));
    expect(Object.keys(answer.entrypoints['.'].a)).toEqual(Object.keys(snapshot.entrypoints['.'].a));
  });
});

describe('temp dir tracking', () => {
  it('removes every resolver temp dir still alive when a signal ends the process', () => {
    const dirs = [1, 2].map(() => trackTmpDir(fs.mkdtempSync(path.join(os.tmpdir(), 'semver-checks-iso-'))));
    cleanupLiveTmpDirs();
    for (const dir of dirs) expect(fs.existsSync(dir)).toBe(false);
  });
});
