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
    const archive = execFileSync('git', ['archive', ref], {
      cwd: workingDir,
      maxBuffer: 100 * 1024 * 1024,
    });
    execFileSync('tar', ['-x', '-C', tmpDir], { input: archive });
  } catch (err: any) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw new Error(`Failed to resolve git ref '${ref}': ${err.message}`);
  }

  return tmpDir;
}

export function cleanupTmpDir(tmpDir: string): void {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
}
