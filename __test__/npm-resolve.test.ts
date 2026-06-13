import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compare } from '../src/index.js';
import { extract } from '../src/extract/extractor.js';
import { resolveNpmSpec, SAFE_SPEC_RE } from '../src/resolve/npm-resolver.js';

const tmpDirs: string[] = [];

afterAll(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

// Build a directory shaped like an extracted npm tarball: a package.json whose
// `types` points at a .d.ts, the .d.ts itself, and the permissive tsconfig.json
// that resolveNpmSpec() synthesizes for published packages.
function makePublishedPackage(dts: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'semver-checks-dts-'));
  tmpDirs.push(dir);
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'pub-pkg', version: '1.0.0', types: './index.d.ts' }),
  );
  fs.writeFileSync(path.join(dir, 'index.d.ts'), dts);
  fs.writeFileSync(
    path.join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2020',
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
        skipLibCheck: true,
        declaration: true,
      },
      include: ['**/*.ts', '**/*.d.ts'],
    }),
  );
  return dir;
}

describe('SAFE_SPEC_RE', () => {
  // The resolver's allowlist must accept everything source-ref already routes to
  // the npm path, or a valid spec hard-fails with no git fallback.
  it('accepts valid versions, ranges, prereleases, build metadata, and dist-tags', () => {
    for (const spec of [
      'lodash@4.17.21',
      '@scope/pkg@1.0.0',
      'pkg@^1.2.3',
      'pkg@>=1 <2',
      'pkg@1.0.0-beta.1',
      'pkg@1.0.0+build.5',
      'pkg@1.0.0-rc.1+build.5',
      'pkg@latest',
      'pkg@my-custom-tag',
    ]) {
      expect(SAFE_SPEC_RE.test(spec)).toBe(true);
    }
  });

  it('rejects shell metacharacters and path traversal', () => {
    for (const spec of ['pkg@1.0.0; rm -rf /', 'pkg@$(whoami)', '../etc/passwd', 'pkg@`id`', 'pkg@1.0.0&&x']) {
      expect(SAFE_SPEC_RE.test(spec)).toBe(false);
    }
  });
});

describe('.d.ts entry resolution (published-package layout)', () => {
  it('extracts named exports from a declared .d.ts entry', async () => {
    const dir = makePublishedPackage(
      `export declare function greet(name: string): string;\nexport interface Opts { tone: string; }\n`,
    );
    const snapshot = await extract({ projectPath: dir });
    expect(Object.keys(snapshot.entrypoints['.']).sort()).toEqual(['Opts', 'greet']);
  }, 15_000);

  it('detects a breaking change between two published-style .d.ts versions', async () => {
    const oldDir = makePublishedPackage(`export declare function greet(name: string): string;\n`);
    const newDir = makePublishedPackage(`export declare function greet(name: string, greeting: string): string;\n`);

    const report = await compare({
      oldSource: { type: 'path', path: oldDir },
      newSource: { type: 'path', path: newDir },
    });

    expect(report.recommended).toBe('major');
    expect(report.changes.some((c) => c.kind === 'required-param-added')).toBe(true);
  }, 20_000);

  // Regression: a working tree with a stale/unbuilt dist must be analyzed from its
  // real .ts source, not the outdated declared .d.ts entry (which would silently
  // mask the source-only change as a false-negative `patch`).
  it('prefers real src over a stale declared .d.ts entry', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'semver-checks-stale-'));
    tmpDirs.push(dir);
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'stale-pkg', version: '1.0.0', types: 'dist/index.d.ts' }),
    );
    fs.mkdirSync(path.join(dir, 'dist'));
    fs.writeFileSync(path.join(dir, 'dist', 'index.d.ts'), `export declare function greet(name: string): string;\n`);
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(
      path.join(dir, 'src', 'index.ts'),
      `export function greet(name: string, greeting: string): string { return greeting + name; }\n`,
    );
    fs.writeFileSync(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { target: 'ES2020', module: 'ESNext', moduleResolution: 'bundler', strict: true, skipLibCheck: true },
        include: ['src/**/*.ts', 'dist/**/*.d.ts'],
      }),
    );

    const snapshot = await extract({ projectPath: dir });
    const greet = snapshot.entrypoints['.']['greet'] as { kind: string; signatures: Array<{ parameters: unknown[] }> };
    expect(greet.kind).toBe('function');
    // 2 params come from the current src; the stale dist .d.ts still declares 1.
    expect(greet.signatures[0].parameters).toHaveLength(2);
  }, 15_000);
});

// The live test hits the npm registry, so it is opt-in to keep offline CI green.
// Run with SEMVER_CHECKS_NETWORK_TESTS=1 to exercise the real `npm pack` path.
const liveTest = process.env['SEMVER_CHECKS_NETWORK_TESTS'] ? describe : describe.skip;

liveTest('resolveNpmSpec (live registry)', () => {
  it('downloads and extracts a published package tarball', () => {
    const res = resolveNpmSpec('semver-checks@0.4.0');
    tmpDirs.push(res.tmpDir);
    expect(fs.existsSync(path.join(res.projectPath, 'package.json'))).toBe(true);
    expect(res.projectPath.endsWith(path.join('package'))).toBe(true);
  }, 60_000);

  it('rejects a malformed spec without touching the network', () => {
    expect(() => resolveNpmSpec('not a spec')).toThrow(/Invalid npm spec/);
  });

  // @types/* and some legacy tarballs extract to a non-`package/` root, so this
  // exercises locatePackageRoot's fallback branch specifically — not just that a
  // package.json was found.
  it('handles a tarball whose root directory is not package/', () => {
    const res = resolveNpmSpec('@types/is-number@7.0.0');
    tmpDirs.push(res.tmpDir);
    expect(fs.existsSync(path.join(res.projectPath, 'package.json'))).toBe(true);
    // The fallback was taken: the resolved root is NOT the standard `package/`.
    expect(path.basename(res.projectPath)).not.toBe('package');
    const pkg = JSON.parse(fs.readFileSync(path.join(res.projectPath, 'package.json'), 'utf-8'));
    expect(pkg.name).toBe('@types/is-number');
  }, 60_000);
});
