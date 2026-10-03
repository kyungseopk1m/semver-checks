import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultOldSource } from '../src/package-info.js';

// The old side a bare `semver-checks` fills in. Assembling it is a file read
// and three refusals, so it is driven directly here rather than through the
// registry: nothing in this file touches the network.

let root: string;

function project(name: string, packageJson: string | null): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  if (packageJson !== null) fs.writeFileSync(path.join(dir, 'package.json'), packageJson);
  return dir;
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'semver-checks-default-source-'));
});

afterAll(() => {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {}
});

describe('defaultOldSource', () => {
  it('names the package its own latest release', () => {
    const dir = project('plain', JSON.stringify({ name: 'my-lib', version: '1.2.3' }));
    expect(defaultOldSource(dir)).toBe('npm:my-lib@latest');
  });

  it('keeps a scoped name intact', () => {
    const dir = project('scoped', JSON.stringify({ name: '@acme/my-lib', version: '0.1.0' }));
    expect(defaultOldSource(dir)).toBe('npm:@acme/my-lib@latest');
  });

  it('refuses a directory with no package.json', () => {
    const dir = project('empty', null);
    expect(() => defaultOldSource(dir)).toThrow(/No readable package\.json/);
  });

  it('refuses a package.json that is not valid JSON', () => {
    const dir = project('broken', '{ not json');
    expect(() => defaultOldSource(dir)).toThrow(/No readable package\.json/);
  });

  it('refuses a package.json with no name', () => {
    const dir = project('nameless', JSON.stringify({ version: '1.0.0' }));
    expect(() => defaultOldSource(dir)).toThrow(/has no "name"/);
  });

  it('refuses a private package, which has no release to compare against', () => {
    const dir = project('private', JSON.stringify({ name: 'internal-app', version: '1.0.0', private: true }));
    expect(() => defaultOldSource(dir)).toThrow(/marked private/);
  });

  // npm refuses to publish on a truthy `private`, so `"private": "false"` is a
  // package that has never been published either.
  it('reads private the way npm does, not as a boolean', () => {
    const dir = project('private-string', JSON.stringify({ name: 'my-lib', version: '1.0.0', private: 'false' }));
    expect(() => defaultOldSource(dir)).toThrow(/marked private/);
  });

  it('publishes past a falsy private', () => {
    const dir = project('private-false', JSON.stringify({ name: 'my-lib', version: '1.0.0', private: false }));
    expect(defaultOldSource(dir)).toBe('npm:my-lib@latest');
  });

  it('points at the two-argument form in every refusal', () => {
    const dir = project('message', null);
    expect(() => defaultOldSource(dir)).toThrow(/semver-checks compare <old> \[new\]/);
  });
});
