import { extract } from './extract/extractor.js';
import { diff } from './compare/differ.js';
import { resolvePath } from './resolve/path-resolver.js';
import { resolveGitRef, cleanupTmpDir } from './resolve/git-resolver.js';
import type { CompareOptions, SemverReport } from './types.js';

export type { CompareOptions, SemverReport, ApiChange, SemverBump, ChangeKind, SourceRef } from './types.js';
export type { ApiSnapshot, ApiEnumMember, ApiInterfaceMethod } from './extract/api-snapshot.js';
export { extract } from './extract/extractor.js';
export { diff } from './compare/differ.js';

export async function compare(options: CompareOptions): Promise<SemverReport> {
  const { oldSource, newSource, entry } = options;

  let oldPath: string;
  let newPath: string;
  let oldTmp: string | null = null;
  let newTmp: string | null = null;

  try {
    if (oldSource.type === 'path') {
      oldPath = resolvePath(oldSource.path);
    } else {
      oldTmp = resolveGitRef(oldSource.ref, oldSource.cwd);
      oldPath = oldTmp;
    }

    if (newSource.type === 'path') {
      newPath = resolvePath(newSource.path);
    } else {
      newTmp = resolveGitRef(newSource.ref, newSource.cwd);
      newPath = newTmp;
    }

    // Install deps in tmp dirs if needed
    await ensureDeps(oldPath);
    await ensureDeps(newPath);

    const [oldSnap, newSnap] = await Promise.all([
      extract({ projectPath: oldPath, entry }),
      extract({ projectPath: newPath, entry }),
    ]);

    return diff(oldSnap, newSnap);
  } finally {
    if (oldTmp) cleanupTmpDir(oldTmp);
    if (newTmp) cleanupTmpDir(newTmp);
  }
}

async function ensureDeps(projectPath: string): Promise<void> {
  const fs = await import('fs');
  const path = await import('path');
  const { execSync } = await import('child_process');
  const nodeModules = path.join(projectPath, 'node_modules');
  if (!fs.existsSync(nodeModules)) {
    execSync('npm install --ignore-scripts', { cwd: projectPath, stdio: 'pipe' });
  }
  // P3: @types/node is a devDependency and won't be installed by default.
  // Without it, Node.js built-in types (Buffer, NodeJS.Timeout, etc.) fall back to any.
  const atTypesNode = path.join(projectPath, 'node_modules', '@types', 'node');
  if (!fs.existsSync(atTypesNode)) {
    try {
      execSync('npm install --no-save --ignore-scripts @types/node', { cwd: projectPath, stdio: 'pipe' });
    } catch {
      if (process.env['SEMVER_CHECKS_VERBOSE']) {
        process.stderr.write('[semver-checks] warning: could not install @types/node\n');
      }
    }
  }
}
