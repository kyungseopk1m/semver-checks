import { extract } from './extract/extractor.js';
import { diff } from './compare/differ.js';
import { resolvePath } from './resolve/path-resolver.js';
import { resolveGitRef, cleanupTmpDir } from './resolve/git-resolver.js';
import { ensureProjectDeps } from './resolve/dependency-installer.js';
import type { CompareOptions, SemverReport } from './types.js';

export type { CompareOptions, SemverReport, ApiChange, SemverBump, ChangeKind, SourceRef } from './types.js';
export type { ApiSnapshot, ApiEnumMember, ApiInterfaceMethod } from './extract/api-snapshot.js';
export { extract } from './extract/extractor.js';
export { diff } from './compare/differ.js';

export async function compare(options: CompareOptions): Promise<SemverReport> {
  const { oldSource, newSource, entry, installDeps = false } = options;

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

    if (oldSource.type === 'git' || installDeps) {
      await ensureProjectDeps(oldPath);
    }
    if (newSource.type === 'git' || installDeps) {
      await ensureProjectDeps(newPath);
    }

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
