import { createRequire } from 'module';
import { readPackageJson } from './declared.js';

const _require = createRequire(import.meta.url);

export function getPackageVersion(): string {
  // dist/mjs/package-info.js -> ../package.json (one level up)
  // dist/cjs/package-info.js -> ../package.json (one level up)
  // Fallback for any deeper nesting or unexpected publish layout
  try {
    return (_require('../package.json') as { version: string }).version;
  } catch {
    try {
      return (_require('../../package.json') as { version: string }).version;
    } catch {
      return 'unknown';
    }
  }
}

// The old side a bare `semver-checks` compares against: the package's own last
// published release, against the working tree. Reading it from package.json is
// what `--declared auto` already does, so the answer needs no arguments.
//
// Returns the argument a user would have typed, not a SourceRef, so the default
// goes through the same `resolveSourceInput` parsing every typed source does.
export function defaultOldSource(projectPath: string): string {
  const pkg = readPackageJson(projectPath);
  if (pkg === null) {
    throw new Error(
      `No readable package.json in '${projectPath}', so there is nothing to compare against.\n` +
        `  Run this from a package root, or name the two versions: semver-checks compare <old> [new]`,
    );
  }

  const name = pkg.name;
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(
      `package.json in '${projectPath}' has no "name", so its published releases cannot be looked up.\n` +
        `  Name the two versions instead: semver-checks compare <old> [new]`,
    );
  }

  // A private package has no registry entry, so the default would resolve to a
  // 404 and blame the registry for a package that was never meant to be there.
  //
  // Truthy rather than `=== true`, matching what npm itself refuses to publish
  // (`if (manifest.private)` in libnpmpublish). A `"private": "false"` string is
  // private to npm, so it has to be private here too.
  if (pkg.private) {
    throw new Error(
      `'${name}' is marked private, so it has no published release to compare against.\n` +
        `  Name the two versions instead: semver-checks compare <old> [new]`,
    );
  }

  // The `npm:` scheme is explicit rather than inferred: a package whose name
  // happens to match a local directory would otherwise resolve to that path.
  return `npm:${name}@latest`;
}
