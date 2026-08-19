import { extract } from './extract/extractor.js';
import { diff } from './compare/differ.js';
import { resolvePath } from './resolve/path-resolver.js';
import { resolveGitRef, cleanupTmpDir } from './resolve/git-resolver.js';
import { resolveNpmSpec } from './resolve/npm-resolver.js';
import { ensureProjectDeps } from './resolve/dependency-installer.js';
import { describeUnusableSnapshot, type ApiSnapshot } from './extract/api-snapshot.js';
import { resolveDeclaration } from './declared.js';
import type { CompareOptions, SemverReport, SourceRef } from './types.js';

export type {
  CompareOptions,
  SemverReport,
  ApiChange,
  SemverBump,
  ChangeKind,
  SourceRef,
  DeclaredBump,
  BumpDeclaration,
} from './types.js';
export type { ApiSnapshot, ApiEnumMember, ApiInterfaceMethod } from './extract/api-snapshot.js';
export { extract } from './extract/extractor.js';
export { diff } from './compare/differ.js';

function describeSource(source: SourceRef): string {
  if (source.type === 'path') return source.path;
  if (source.type === 'npm') return source.spec;
  return source.ref;
}

// An unusable side is a non-answer, and a non-answer must never be reported as a
// clean `patch`. Comparing two empty snapshots produces exactly the output of a
// safe release, so the failure has to be raised before `diff()` ever sees them.
function assertUsable(snapshot: ApiSnapshot, source: SourceRef): void {
  const reason = describeUnusableSnapshot(snapshot);
  if (!reason) return;
  throw new Error(
    `Cannot compare '${describeSource(source)}': ${reason}.\n` +
      `  This is an extraction failure, not a clean API - reporting it as 'patch' would be wrong.\n` +
      `  Common causes: the package ships no bundled declarations (types live in a separate @types package),\n` +
      `  its types are only reachable through an ambient 'declare module' block, or the entry point resolved\n` +
      `  to the wrong file. Pass --entry to point at the declaration file explicitly.`,
  );
}

export async function compare(options: CompareOptions): Promise<SemverReport> {
  const { oldSource, newSource, entry, installDeps = false, declared } = options;

  let oldPath: string;
  let newPath: string;
  let oldTmp: string | null = null;
  let newTmp: string | null = null;

  try {
    if (oldSource.type === 'path') {
      oldPath = resolvePath(oldSource.path);
    } else if (oldSource.type === 'npm') {
      const res = resolveNpmSpec(oldSource.spec);
      oldTmp = res.tmpDir;
      oldPath = res.projectPath;
    } else {
      oldTmp = resolveGitRef(oldSource.ref, oldSource.cwd);
      oldPath = oldTmp;
    }

    if (newSource.type === 'path') {
      newPath = resolvePath(newSource.path);
    } else if (newSource.type === 'npm') {
      const res = resolveNpmSpec(newSource.spec);
      newTmp = res.tmpDir;
      newPath = res.projectPath;
    } else {
      newTmp = resolveGitRef(newSource.ref, newSource.cwd);
      newPath = newTmp;
    }

    // npm tarballs already bundle their built artifacts and declarations, so only
    // git refs (raw checkouts) and opt-in local paths need a dependency install.
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

    assertUsable(oldSnap, oldSource);
    assertUsable(newSnap, newSource);

    const report = diff(oldSnap, newSnap);

    if (declared) {
      // Only a local path can be a package sitting inside a larger workspace,
      // so it is the only source whose changesets may live above it.
      const declaration = resolveDeclaration(oldPath, newPath, declared, report.summary, newSource.type === 'path');
      // Asking for the declaration gate and getting no declaration is a
      // non-answer, and a non-answer that exits 0 is indistinguishable from a
      // release that checked out clean. Same contract as an empty snapshot.
      if (!declaration) {
        throw new Error(
          `Cannot read a declared bump from '${describeSource(newSource)}': no changeset declares this package, and the two package.json versions do not describe one.\n` +
            `  A version that is not x.y.z, a version that went backwards, or a prerelease on either side will all land here:\n` +
            `  1.0.0-rc.1 to 1.0.0 moves none of the three numbers, and 2.0.0 to 1.0.0 is not a bump at all.\n` +
            `  Pass --declared major|minor|patch|none to state the bump explicitly.`,
        );
      }
      report.declaration = declaration;
    }

    return report;
  } finally {
    if (oldTmp) cleanupTmpDir(oldTmp);
    if (newTmp) cleanupTmpDir(newTmp);
  }
}
