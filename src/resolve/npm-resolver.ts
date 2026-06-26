import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

// npm specs are passed to execFile (no shell is spawned), so command injection is
// not possible. We still validate to reject obviously malformed input early and to
// produce a clean error instead of a confusing npm failure. The version character
// class must cover everything a valid version/range/dist-tag can contain — notably
// `+` for semver build metadata (e.g. 1.0.0+build.5) and a space for ranges
// (e.g. ">=1 <2") — so a spec that source-ref already accepted never trips here.
export const SAFE_SPEC_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*@[a-zA-Z0-9-._~^><=|*+. ]+$/;

export interface NpmResolution {
  /** Directory containing the extracted package (the tarball's `package/` root). */
  projectPath: string;
  /** Temp root to clean up via cleanupTmpDir() — removes the whole download dir. */
  tmpDir: string;
}

export function resolveNpmSpec(spec: string): NpmResolution {
  if (!SAFE_SPEC_RE.test(spec)) {
    throw new Error(`Invalid npm spec: '${spec}'`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'semver-checks-npm-'));

  try {
    // `npm pack <spec>` downloads the published tarball for a remote registry spec.
    // No lifecycle scripts run for a remote spec; --ignore-scripts is belt-and-braces.
    const out = execFileSync(
      'npm',
      ['pack', spec, '--pack-destination', tmpDir, '--json', '--ignore-scripts'],
      { cwd: tmpDir, maxBuffer: 100 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 },
    ).toString();

    const filename = parsePackFilename(out, tmpDir);
    const tgzPath = path.join(tmpDir, filename);

    execFileSync('tar', ['-xzf', tgzPath, '-C', tmpDir]);

    const pkgDir = locatePackageRoot(tmpDir, spec);

    // Published packages frequently ship without a tsconfig.json. Synthesize a
    // permissive one so the ts-morph extractor can load the bundled .d.ts files.
    ensureTsconfig(pkgDir);

    return { projectPath: pkgDir, tmpDir };
  } catch (err: any) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw new Error(`Failed to resolve npm package '${spec}': ${explainNpmError(spec, err)}`);
  }
}

// Turn an opaque `npm pack` failure into one actionable line. The raw npm output
// (E404 walls, network stack traces) is otherwise dumped verbatim, leaving the
// user unable to tell a typo from a registry outage from a missing npm binary.
export function explainNpmError(spec: string, err: any): string {
  if (err?.code === 'ENOENT') return 'npm was not found on your PATH. Install Node.js/npm and try again.';
  const out = `${err?.stderr?.toString?.() ?? ''}${err?.stdout?.toString?.() ?? ''}`;
  if (/E404|404 Not Found/i.test(out))
    return `'${spec}' was not found in the npm registry. Check the package name and that the version/tag is published.`;
  if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|network/i.test(out))
    return 'could not reach the npm registry (network issue). Check your connection or proxy and retry.';
  const tail = out.trim().split('\n').filter(Boolean).slice(-3).join(' ');
  return tail || err?.message || 'unknown npm error';
}

// npm tarballs are standardized to a `package/` root, but some legacy and
// @types/* packages extract to a differently-named directory (e.g. `is-number/`).
// Prefer the standard root, then fall back to the single extracted directory that
// actually holds a package.json.
function locatePackageRoot(tmpDir: string, spec: string): string {
  const standard = path.join(tmpDir, 'package');
  if (fs.existsSync(path.join(standard, 'package.json'))) return standard;

  const dirs = fs
    .readdirSync(tmpDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(tmpDir, e.name))
    .filter((dir) => fs.existsSync(path.join(dir, 'package.json')));

  if (dirs.length === 1) return dirs[0];
  throw new Error(`unexpected tarball layout (no package.json root) for '${spec}'`);
}

function parsePackFilename(stdout: string, tmpDir: string): string {
  // `npm pack --json` prints an array: [{ filename, ... }].
  try {
    const parsed = JSON.parse(stdout);
    if (Array.isArray(parsed) && parsed[0]?.filename) {
      // npm reports the on-disk basename here; basename() guards older layouts.
      return path.basename(parsed[0].filename);
    }
  } catch {}
  // Fallback: pick the single .tgz that landed in the destination directory.
  const tgz = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.tgz'));
  if (tgz.length === 1) return tgz[0];
  throw new Error('could not determine packed tarball filename');
}

function ensureTsconfig(pkgDir: string): void {
  const tsconfigPath = path.join(pkgDir, 'tsconfig.json');
  if (fs.existsSync(tsconfigPath)) return;
  fs.writeFileSync(
    tsconfigPath,
    JSON.stringify({
      compilerOptions: {
        target: 'ES2020',
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
        skipLibCheck: true,
        declaration: true,
      },
      include: ['**/*.ts', '**/*.d.ts', '**/*.d.mts', '**/*.d.cts'],
    }),
  );
}
