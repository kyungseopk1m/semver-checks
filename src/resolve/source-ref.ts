import type { SourceRef } from '../types.js';
import { pathExists, resolvePath } from './path-resolver.js';

export type SourceInputKind = 'path' | 'git' | 'npm';

// npm package name (optionally scoped). Mirrors the published-name validation rules.
const NPM_NAME_RE = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

// Common dist-tags that follow a package name after '@'.
const DIST_TAGS = new Set([
  'latest', 'next', 'beta', 'alpha', 'canary', 'rc',
  'experimental', 'stable', 'nightly', 'edge', 'dev',
]);

function looksLikeVersion(v: string): boolean {
  if (!v) return false;
  if (DIST_TAGS.has(v.toLowerCase())) return true;
  // A concrete version (`1.2.3`, `v1.2`), a range (`^1`, `~2`, `>=1.0`), or a wildcard.
  return /^v?\d/.test(v) || /^[\^~><=]/.test(v) || v === '*' || v === 'x';
}

/**
 * Parse a `<package>@<version>` npm spec, with an optional `npm:` scheme prefix.
 * Returns null when the input is not unambiguously an npm spec (so callers can
 * fall back to git ref resolution).
 *
 * When `explicit` is true (the `npm:` scheme or `--old-as npm`), the version is
 * not required to look like a recognized version/range/dist-tag — the user has
 * already declared intent — so any non-empty version (e.g. an uncommon dist-tag
 * like `legacy`) is accepted. Auto-detection keeps the strict check to avoid
 * misreading a `name@branch`-shaped git ref as an npm spec.
 */
/**
 * A source argument that is malformed, as opposed to one that is well-formed and
 * could not be found. The first is fixed by sending something else; retrying the
 * second unchanged is the wasted work, and a caller that cannot re-read its own
 * request has only the error to tell them apart.
 */
export class InvalidSourceInput extends Error {}

export function parseNpmSpec(
  input: string,
  opts?: { explicit?: boolean },
): { name: string; version: string } | null {
  const hasScheme = input.startsWith('npm:');
  const body = hasScheme ? input.slice(4) : input;
  const explicit = opts?.explicit || hasScheme;
  const at = body.lastIndexOf('@');
  if (at <= 0) return null; // no '@', or only a leading scope '@' (a name without a version)
  const name = body.slice(0, at);
  const version = body.slice(at + 1);
  if (!NPM_NAME_RE.test(name)) return null;
  if (!version) return null;
  if (!explicit && !looksLikeVersion(version)) return null;
  return { name, version };
}

export function resolveSourceInput(input: string, preferredKind?: SourceInputKind): SourceRef {
  // An empty source is not a source. Left alone it falls through to the path
  // branch, where `resolvePath('')` is the working directory, so `compare "" x`
  // quietly analyzed the current tree and answered about a version nobody named.
  // On a gate that is the worst possible failure: a green run on a question that
  // was never asked. Both surfaces reach resolution through here.
  if (input.trim() === '') {
    throw new InvalidSourceInput('Source is empty. Pass a path, a git ref, or an npm spec.');
  }

  if (preferredKind === 'npm') {
    const spec = parseNpmSpec(input, { explicit: true });
    if (!spec) throw new InvalidSourceInput(`Invalid npm spec: '${input}'. Expected '<package>@<version>'.`);
    return { type: 'npm', spec: `${spec.name}@${spec.version}` };
  }

  if (preferredKind === 'git') {
    return { type: 'git', ref: input };
  }

  if (preferredKind === 'path') {
    return { type: 'path', path: resolvePath(input) };
  }

  // Explicit `npm:` scheme always wins over path/git auto-detection.
  if (input.startsWith('npm:')) {
    const spec = parseNpmSpec(input);
    if (!spec) throw new InvalidSourceInput(`Invalid npm spec: '${input}'. Expected '<package>@<version>'.`);
    return { type: 'npm', spec: `${spec.name}@${spec.version}` };
  }

  if (pathExists(input)) {
    return { type: 'path', path: resolvePath(input) };
  }

  // A `name@version` shape that is not an existing path is treated as an npm spec
  // (registry comparison). A plain ref like `v1.2.3` or `main` has no '@' and stays git.
  const spec = parseNpmSpec(input);
  if (spec) {
    return { type: 'npm', spec: `${spec.name}@${spec.version}` };
  }

  return { type: 'git', ref: input };
}
