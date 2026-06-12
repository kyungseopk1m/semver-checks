import { describe, expect, it, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveSourceInput, parseNpmSpec } from '../src/resolve/source-ref.js';

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

  it('auto-detects a "pkg@version" input as an npm source', () => {
    expect(resolveSourceInput('lodash@4.17.21')).toEqual({ type: 'npm', spec: 'lodash@4.17.21' });
  });

  it('auto-detects a scoped package spec', () => {
    expect(resolveSourceInput('@scope/pkg@1.0.0')).toEqual({ type: 'npm', spec: '@scope/pkg@1.0.0' });
  });

  it('auto-detects a dist-tag version', () => {
    expect(resolveSourceInput('react@latest')).toEqual({ type: 'npm', spec: 'react@latest' });
  });

  it('auto-detects a version with semver build metadata', () => {
    expect(resolveSourceInput('lodash@1.0.0+build.5')).toEqual({ type: 'npm', spec: 'lodash@1.0.0+build.5' });
  });

  it('supports the explicit "npm:" scheme', () => {
    expect(resolveSourceInput('npm:lodash@^4')).toEqual({ type: 'npm', spec: 'lodash@^4' });
  });

  it('can force an input to be treated as an npm spec', () => {
    expect(resolveSourceInput('lodash@4.17.21', 'npm')).toEqual({ type: 'npm', spec: 'lodash@4.17.21' });
  });

  it('does not treat a plain git tag as an npm spec', () => {
    expect(resolveSourceInput('v1.2.3')).toEqual({ type: 'git', ref: 'v1.2.3' });
  });

  it('does not treat a branch name as an npm spec', () => {
    expect(resolveSourceInput('main')).toEqual({ type: 'git', ref: 'main' });
  });

  it('leaves a scoped name without a version as a git ref', () => {
    expect(resolveSourceInput('@scope/pkg')).toEqual({ type: 'git', ref: '@scope/pkg' });
  });

  it('throws when an invalid spec is forced to npm', () => {
    expect(() => resolveSourceInput('not a spec', 'npm')).toThrow(/Invalid npm spec/);
  });

  it('accepts an uncommon dist-tag when npm is forced', () => {
    expect(resolveSourceInput('mypkg@my-tag', 'npm')).toEqual({ type: 'npm', spec: 'mypkg@my-tag' });
  });

  it('accepts an uncommon dist-tag via the npm: scheme', () => {
    expect(resolveSourceInput('npm:mypkg@my-tag')).toEqual({ type: 'npm', spec: 'mypkg@my-tag' });
  });

  it('does not auto-detect an uncommon dist-tag (stays a git ref)', () => {
    expect(resolveSourceInput('mypkg@my-tag')).toEqual({ type: 'git', ref: 'mypkg@my-tag' });
  });
});

describe('parseNpmSpec', () => {
  it('parses scoped and unscoped specs', () => {
    expect(parseNpmSpec('lodash@4.17.21')).toEqual({ name: 'lodash', version: '4.17.21' });
    expect(parseNpmSpec('@a/b@1.0.0')).toEqual({ name: '@a/b', version: '1.0.0' });
  });

  it('strips an optional "npm:" scheme prefix', () => {
    expect(parseNpmSpec('npm:typescript@5.4.0')).toEqual({ name: 'typescript', version: '5.4.0' });
  });

  it('returns null for inputs that are not npm specs', () => {
    expect(parseNpmSpec('main')).toBeNull();
    expect(parseNpmSpec('v1.2.3')).toBeNull();
    expect(parseNpmSpec('@scope/pkg')).toBeNull();
    expect(parseNpmSpec('pkg@not-a-version')).toBeNull();
  });

  it('accepts any non-empty version when explicit, but stays strict otherwise', () => {
    expect(parseNpmSpec('pkg@my-tag', { explicit: true })).toEqual({ name: 'pkg', version: 'my-tag' });
    expect(parseNpmSpec('pkg@my-tag')).toBeNull();
    // Even when explicit, a name without a version is still not a spec.
    expect(parseNpmSpec('@scope/pkg', { explicit: true })).toBeNull();
  });
});
