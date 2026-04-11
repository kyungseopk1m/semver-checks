import { describe, it, expect, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compare } from '../../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, '..', 'fixtures');

const tmpDirs: string[] = [];

function makeTmpRepo(oldSrc: string, newSrc: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'semver-checks-e2e-'));
  tmpDirs.push(dir);

  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@semver-checks.test"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "semver-checks test"', { cwd: dir, stdio: 'pipe' });

  fs.writeFileSync(
    path.join(dir, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true, module: 'ESNext', target: 'ES2020', moduleResolution: 'bundler' } }),
  );
  // No dependencies — npm install will be instant
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'e2e-pkg', version: '0.1.0', type: 'module' }));

  // v0.1.0: old API
  fs.writeFileSync(path.join(dir, 'index.ts'), oldSrc);
  execSync('git add .', { cwd: dir, stdio: 'pipe' });
  execSync('git commit -m "v0.1.0"', { cwd: dir, stdio: 'pipe' });
  execSync('git tag v0.1.0', { cwd: dir, stdio: 'pipe' });

  // HEAD: new API
  fs.writeFileSync(path.join(dir, 'index.ts'), newSrc);
  execSync('git add .', { cwd: dir, stdio: 'pipe' });
  execSync('git commit -m "v0.2.0"', { cwd: dir, stdio: 'pipe' });

  return dir;
}

afterAll(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

// ── Path-to-path E2E ────────────────────────────────────────────────────────

describe('path-to-path compare (full pipeline)', () => {
  it('reports major for removed export', async () => {
    const report = await compare({
      oldSource: { type: 'path', path: path.join(FIXTURES, 'export-removed', 'old') },
      newSource: { type: 'path', path: path.join(FIXTURES, 'export-removed', 'new') },
      entry: 'index.ts',
    });
    expect(report.recommended).toBe('major');
    expect(report.summary.major).toBeGreaterThan(0);
  }, 10_000);

  it('reports minor for added export', async () => {
    const report = await compare({
      oldSource: { type: 'path', path: path.join(FIXTURES, 'export-added', 'old') },
      newSource: { type: 'path', path: path.join(FIXTURES, 'export-added', 'new') },
      entry: 'index.ts',
    });
    expect(report.recommended).toBe('minor');
    expect(report.summary.minor).toBeGreaterThan(0);
  }, 10_000);

  it('reports patch when API is unchanged', async () => {
    const sameDir = path.join(FIXTURES, 'export-added', 'old');
    const report = await compare({
      oldSource: { type: 'path', path: sameDir },
      newSource: { type: 'path', path: sameDir },
      entry: 'index.ts',
    });
    expect(report.recommended).toBe('patch');
    expect(report.summary.major).toBe(0);
    expect(report.summary.minor).toBe(0);
  }, 10_000);

  it('returns structured JSON report', async () => {
    const report = await compare({
      oldSource: { type: 'path', path: path.join(FIXTURES, 'property-removed', 'old') },
      newSource: { type: 'path', path: path.join(FIXTURES, 'property-removed', 'new') },
      entry: 'index.ts',
    });
    expect(report).toMatchObject({
      recommended: 'major',
      changes: expect.arrayContaining([
        expect.objectContaining({ kind: 'property-removed', severity: 'major' }),
      ]),
      summary: expect.objectContaining({ major: expect.any(Number) }),
    });
  }, 10_000);
});

// ── Git ref E2E ─────────────────────────────────────────────────────────────

describe('git ref compare (full pipeline)', () => {
  it('detects breaking change between git tags', async () => {
    const repo = makeTmpRepo(
      'export function greet(name: string): string { return name; }\n',
      'export function greet(name: string, greeting: string): string { return greeting + name; }\n',
    );

    const report = await compare({
      oldSource: { type: 'git', ref: 'v0.1.0', cwd: repo },
      newSource: { type: 'git', ref: 'HEAD', cwd: repo },
      entry: 'index.ts',
    });

    expect(report.recommended).toBe('major');
    expect(report.changes.some((c) => c.kind === 'required-param-added')).toBe(true);
  }, 30_000);

  it('detects non-breaking addition between git tags', async () => {
    const repo = makeTmpRepo(
      'export function greet(name: string): string { return name; }\n',
      'export function greet(name: string): string { return name; }\nexport function bye(name: string): string { return name; }\n',
    );

    const report = await compare({
      oldSource: { type: 'git', ref: 'v0.1.0', cwd: repo },
      newSource: { type: 'git', ref: 'HEAD', cwd: repo },
      entry: 'index.ts',
    });

    expect(report.recommended).toBe('minor');
    expect(report.changes.some((c) => c.kind === 'export-added')).toBe(true);
  }, 30_000);
});
