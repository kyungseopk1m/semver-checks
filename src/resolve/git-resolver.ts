import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { InvalidSourceInput } from './source-ref.js';

// No leading '-': `git archive` would read it as an option, and `-o<path>`
// opens that path for writing (truncating it) before failing for want of a tree.
// Such a ref never worked here anyway, since git took it as an option. A ref
// created as refs/heads/-x (git branch refuses the name; update-ref does not)
// is still reachable as heads/-x.
const SAFE_REF_RE = /^(?!-)[a-zA-Z0-9._\-\/^~@{}:]+$/;

export function resolveGitRef(ref: string, cwd?: string): string {
  if (!SAFE_REF_RE.test(ref)) {
    // Shape, not existence: this ref could never name anything.
    throw new InvalidSourceInput(`Invalid git ref: '${ref}'`);
  }

  const workingDir = cwd ?? process.cwd();
  const tmpDir = trackTmpDir(fs.mkdtempSync(path.join(os.tmpdir(), 'semver-checks-')));

  try {
    // Capture stderr (pipe) instead of letting git leak `fatal:` lines to the
    // user's terminal — explainGitError reformats it into one actionable line.
    const archive = execFileSync('git', ['archive', ref], {
      cwd: workingDir,
      maxBuffer: 100 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    });
    execFileSync('tar', ['-x', '-C', tmpDir], { input: archive });
  } catch (err: any) {
    cleanupTmpDir(tmpDir);
    throw new Error(`Failed to resolve git ref '${ref}': ${explainGitError(ref, err)}`);
  }

  return tmpDir;
}

// Disambiguate the three failures that otherwise share one cryptic message:
// git missing, not inside a repo, and a ref that doesn't exist.
export function explainGitError(ref: string, err: any): string {
  if (err?.code === 'ENOENT') return 'git was not found on your PATH.';
  const out = `${err?.stderr?.toString?.() ?? ''}${err?.stdout?.toString?.() ?? ''}`;
  if (/not a git repository/i.test(out))
    return 'not inside a git repository. Run from your repo root, or pass a directory path instead of a ref.';
  if (/unknown revision|not a valid object name|bad revision|did not match any/i.test(out))
    return `ref '${ref}' was not found. Check it exists (git tag / git branch / git log).`;
  const tail = out.trim().split('\n').filter(Boolean).slice(-2).join(' ');
  return tail || err?.message || 'unknown git error';
}

// Every temp dir a resolver has created and nobody has removed yet, so a
// process ended by a signal (where no `finally` runs) can still remove them.
const liveTmpDirs = new Set<string>();

export function trackTmpDir(tmpDir: string): string {
  liveTmpDirs.add(tmpDir);
  return tmpDir;
}

export function cleanupTmpDir(tmpDir: string): void {
  const expectedPrefix = path.join(os.tmpdir(), 'semver-checks-');
  if (!tmpDir.startsWith(expectedPrefix)) {
    throw new Error(`Refusing to delete directory outside of tmp: '${tmpDir}'`);
  }
  liveTmpDirs.delete(tmpDir);
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
}

// Synchronous so it can run from a signal handler right before process.exit().
export function cleanupLiveTmpDirs(): void {
  for (const tmpDir of liveTmpDirs) cleanupTmpDir(tmpDir);
}
