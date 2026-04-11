import { describe, expect, it, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveSourceInput } from '../src/resolve/source-ref.js';

const tmpDirs: string[] = [];

afterAll(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

describe('resolveSourceInput', () => {
  it('treats an existing bare relative path as a path source', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'semver-checks-source-ref-'));
    tmpDirs.push(tmpDir);
    const relativePath = path.relative(process.cwd(), tmpDir);

    expect(resolveSourceInput(relativePath)).toEqual({
      type: 'path',
      path: path.resolve(relativePath),
    });
  });

  it('treats a non-existent input as a git ref', () => {
    const ref = `missing-ref-${Date.now()}`;
    expect(resolveSourceInput(ref)).toEqual({ type: 'git', ref });
  });

  it('can force an existing path-like input to be treated as a git ref', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'semver-checks-source-ref-'));
    tmpDirs.push(tmpDir);
    const relativePath = path.relative(process.cwd(), tmpDir);

    expect(resolveSourceInput(relativePath, 'git')).toEqual({
      type: 'git',
      ref: relativePath,
    });
  });

  it('can force path resolution explicitly', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'semver-checks-source-ref-'));
    tmpDirs.push(tmpDir);
    const relativePath = path.relative(process.cwd(), tmpDir);

    expect(resolveSourceInput(relativePath, 'path')).toEqual({
      type: 'path',
      path: path.resolve(relativePath),
    });
  });
});
