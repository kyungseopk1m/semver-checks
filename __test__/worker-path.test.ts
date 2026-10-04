import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

// Both builds of worker-path (the CommonJS one compiled from src, and the ESM one
// fixup.sh writes) must resolve to null when no extract-worker.js sits beside
// them, as in a bundle, so extract() runs in-process instead of failing.

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function scratch(): string {
  // Real path: on macOS tmpdir() is a symlink the loaders resolve.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'worker-path-')));
  dirs.push(dir);
  return dir;
}

function writeCjs(dir: string): string {
  const src = fs.readFileSync(path.join(root, 'src/extract/worker-path.ts'), 'utf8');
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"commonjs"}');
  fs.writeFileSync(path.join(dir, 'worker-path.js'), outputText);
  return path.join(dir, 'worker-path.js');
}

function writeEsm(dir: string): string {
  const fixup = fs.readFileSync(path.join(root, 'fixup.sh'), 'utf8');
  const block = fixup.match(/worker-path\.js <<'!EOF'\n([\s\S]*?)\n!EOF/)![1];
  fs.writeFileSync(path.join(dir, 'worker-path.mjs'), block);
  return path.join(dir, 'worker-path.mjs');
}

describe('extractWorkerPath', () => {
  it('is null in the CommonJS build when extract-worker.js is missing', () => {
    const dir = scratch();
    expect(createRequire(import.meta.url)(writeCjs(dir)).extractWorkerPath).toBeNull();
  });

  it('points at extract-worker.js in the CommonJS build when it exists', () => {
    const dir = scratch();
    fs.writeFileSync(path.join(dir, 'extract-worker.js'), '');
    expect(createRequire(import.meta.url)(writeCjs(dir)).extractWorkerPath).toBe(path.join(dir, 'extract-worker.js'));
  });

  it('is null in the ESM build when extract-worker.js is missing', async () => {
    const dir = scratch();
    expect((await import(pathToFileURL(writeEsm(dir)).href)).extractWorkerPath).toBeNull();
  });

  it('points at extract-worker.js in the ESM build when it exists', async () => {
    const dir = scratch();
    fs.writeFileSync(path.join(dir, 'extract-worker.js'), '');
    expect((await import(pathToFileURL(writeEsm(dir)).href)).extractWorkerPath).toBe(path.join(dir, 'extract-worker.js'));
  });
});
