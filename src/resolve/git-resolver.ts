import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SAFE_REF_RE = /^[a-zA-Z0-9._\-\/^~@{}:]+$/;

export function resolveGitRef(ref: string, cwd?: string): string {
  if (!SAFE_REF_RE.test(ref)) {
    throw new Error(`Invalid git ref: '${ref}'`);
  }

  const workingDir = cwd ?? process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'semver-checks-'));

  try {
    // Capture stderr (pipe) instead of letting git leak `fatal:` lines to the
    // user's terminal — explainGitError reformats it into one actionable line.
    const archive = execFileSync('git', ['archive', ref], {
      cwd: workingDir,
      maxBuffer: 100 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    execFileSync('tar', ['-x', '-C', tmpDir], { input: archive });
  } catch (err: any) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
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

export function cleanupTmpDir(tmpDir: string): void {
  const expectedPrefix = path.join(os.tmpdir(), 'semver-checks-');
  if (!tmpDir.startsWith(expectedPrefix)) {
    throw new Error(`Refusing to delete directory outside of tmp: '${tmpDir}'`);
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
}
