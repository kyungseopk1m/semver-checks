// Smoke test of the BUILT package (run `npm run build` first). The e2e harness
// calls the source `compare`, so nothing else exercises the compiled worker,
// bin/semver-checks.js, or the signal handlers. Offline: fixtures only.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const fx = (name) => join(root, '__test__', 'fixtures', 'export-removed', name);
const cli = (...args) => spawnSync(process.execPath, [join(root, 'bin/semver-checks.js'), ...args], { encoding: 'utf8' });
// Removed on every exit, the failing ones included.
const scratch = [];
let child;
const fail = (msg) => {
  console.error(`FAIL ${msg}`);
  child?.kill('SIGKILL');
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  process.exit(1);
};
const check = (ok, msg) => (ok ? console.log(`ok   ${msg}`) : fail(msg));

// 1. CLI. exit 1 only with --strict on a proven break; 0 when nothing changed.
let r = cli('compare', fx('old'), fx('new'), '--strict');
check(r.status === 1 && r.stdout.includes("Export 'foo' was removed"), `cli --strict on a break: exit 1 (got ${r.status})`);
r = cli('compare', fx('old'), fx('old'), '--strict');
check(r.status === 0 && r.stdout.includes('No API changes'), `cli --strict, no change: exit 0 (got ${r.status})`);

// 2. Library through both module systems. compare() silently falls back to
// in-process extraction when worker-path resolves to null (which is exactly what
// a missing fixup.sh rewrite does in ESM), so assert the worker is really found.
const opts = { oldSource: { type: 'path', path: fx('old') }, newSource: { type: 'path', path: fx('new') } };
const esm = await import(pathToFileURL(join(root, 'dist/mjs/index.js')));
const cjs = createRequire(import.meta.url)(join(root, 'dist/cjs/index.js'));
for (const [name, lib, dir] of [['mjs', esm, 'mjs'], ['cjs', cjs, 'cjs']]) {
  const wp = (await import(pathToFileURL(join(root, 'dist', dir, 'extract/worker-path.js')))).extractWorkerPath;
  check(wp && existsSync(wp), `${name}: extractWorkerPath points at an existing worker (${wp})`);
  const report = await lib.compare(opts);
  check(report.recommended === 'major', `${name}: compare() returns major (got ${report.recommended})`);
}

// 3. SIGTERM leaves no temp dirs. The source is a throwaway git repo with no
// package.json, so no `npm install` runs (it would be network and minutes, and
// the signal would land after it). Its index.ts is large enough that extraction
// takes seconds, and the git ref source creates its semver-checks-* dir right
// before extraction starts, so: wait until that dir exists (observed, not slept
// for), then signal. If the run finished first the exit code is not 143 and this
// fails loudly.
const repo = mkdtempSync(join(tmpdir(), 'smoke-repo-'));
const tmp = mkdtempSync(join(tmpdir(), 'smoke-'));
scratch.push(repo, tmp);
const decls = Array.from({ length: 4000 }, (_, i) => `export interface I${i} { a${i}: string; b${i}(x: I${(i + 1) % 4000}): number }`);
writeFileSync(join(repo, 'index.ts'), decls.join('\n') + '\n');
writeFileSync(join(repo, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}\n');
const git = (...args) =>
  spawnSync('git', ['-c', 'user.name=smoke', '-c', 'user.email=smoke@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: repo, encoding: 'utf8' });
for (const args of [['init', '-q'], ['add', '.'], ['commit', '-q', '-m', 'smoke']]) {
  const g = git(...args);
  if (g.status !== 0) fail(`git ${args[0]} in the smoke repo: ${g.stderr}`);
}
const leftovers = () => readdirSync(tmp).filter((f) => f.startsWith('semver-checks-'));
child = spawn(process.execPath, [join(root, 'bin/semver-checks.js'), 'compare', 'HEAD', 'HEAD', '--entry', 'index.ts'], {
  cwd: repo,
  env: { ...process.env, TMPDIR: tmp },
  stdio: 'ignore',
});
const exited = new Promise((res) => child.once('exit', (code, signal) => res(signal ?? code)));
const deadline = Date.now() + 30_000;
while (leftovers().length === 0 && child.exitCode === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
check(leftovers().length > 0, 'git ref run created a semver-checks-* temp dir before the signal');
child.kill('SIGTERM');
const code = await exited;
check(code === 143, `SIGTERM: exit 143 (got ${code})`);
check(leftovers().length === 0, `SIGTERM: 0 semver-checks-* dirs left (got ${leftovers().length})`);
for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
