import fs from 'node:fs';
import path from 'node:path';
import type { BumpDeclaration, DeclaredBump, SemverBump, SemverReport } from './types.js';

// changesets ranks its four release types this way when it merges several
// changesets for the same package, and the same order decides which of them a
// release ends up declaring.
const ORDER: Record<DeclaredBump, number> = { none: 0, patch: 1, minor: 2, major: 3 };

// Whether a break lands one field lower than it does after 1.0. `^1.2.3`
// refuses a new major, `^0.5.0` refuses a new minor, so below 1.0 the minor
// field is where a break has to go.
//
// It stops there rather than shifting again at 0.0.x. `^0.0.5` does refuse
// `0.0.6`, but `~0.0.5` and `0.0.x` both accept it, so a patch is not where a
// 0.0.x break can be announced: the only bump that puts it out of every range
// is 0.1.0, which is a minor. Shifting twice would also floor the requirement
// at `patch`, and a requirement of `patch` is one every declaration covers,
// which would leave the gate unable to fail for a whole class of package.
export function caretDepth(version: string | null): number {
  const v = version === null ? null : parseVersion(version);
  return v !== null && v.major === 0 ? 1 : 0;
}

// Shifts a bump down by that many fields. This belongs on the requirement side
// rather than the reading side, because a declaration arrives in two forms that
// would otherwise disagree: `0.5.0 -> 0.6.0` says minor in version fields, and
// the changeset that produced it says minor too, since `changeset version` runs
// `semver.inc(version, type)` and a `major` there would have written 1.0.0.
function forPackageAge(bump: SemverBump, depth: number): SemverBump {
  const rank = Math.max(ORDER.patch, ORDER[bump] - depth);
  return rank === ORDER.major ? 'major' : rank === ORDER.minor ? 'minor' : 'patch';
}

// The bump the proven breaks alone demand. A review-only major is a guess, and
// a gate that fails on a guess is a gate people turn off.
export function requiredBump(summary: SemverReport['summary'], depth = 0): SemverBump {
  return forPackageAge(summary.majorProven > 0 ? 'major' : 'patch', depth);
}

// What the whole change set points at: the review-only breaks the gate will not
// fail on, and the additions, neither of which carries a confidence grade of
// its own. This informs a reader rather than a build.
export function suggestedBump(summary: SemverReport['summary'], depth = 0): SemverBump {
  const bump = summary.major > 0 ? 'major' : summary.minor > 0 ? 'minor' : 'patch';
  return forPackageAge(bump, depth);
}

export function judgeDeclaration(
  declared: DeclaredBump,
  source: string,
  summary: SemverReport['summary'],
  depth = 0,
): BumpDeclaration {
  const required = requiredBump(summary, depth);
  const suggested = suggestedBump(summary, depth);
  const verdict = shortOf(declared, required) ? 'mismatch' : shortOf(declared, suggested) ? 'review' : 'ok';
  return { declared, source, required, suggested, verdict };
}

// A target of `patch` means nothing on the public surface moved, which every
// declaration covers: `none` and `patch` both assert exactly that, and a
// release is always free to declare more than it needs to.
function shortOf(declared: DeclaredBump, target: SemverBump): boolean {
  return target !== 'patch' && ORDER[declared] < ORDER[target];
}

// The one entry point a caller needs: work out what the release declares, then
// grade it. Returns null when `auto` found nothing to read, which is a
// non-answer rather than a pass and is reported as such upstream.
export function resolveDeclaration(
  oldPath: string,
  newPath: string,
  declared: DeclaredBump | 'auto',
  summary: SemverReport['summary'],
  ascend = false,
): BumpDeclaration | null {
  const found =
    declared === 'auto'
      ? detectDeclaredBump(oldPath, newPath, ascend)
      : { bump: declared, source: 'the declared bump passed in' };
  if (!found) return null;

  // Read the leading zero off the old side, since that is the version consumers
  // are on and their range is what a bump has to clear. Whichever side actually
  // parses is used, not merely whichever is present: a version field holding
  // `1.0` is readable and useless, and dead-ending on it would throw away a
  // declaration the caller stated outright and answer with an error whose
  // remedy is the thing they already did.
  const version =
    [readPackageField(oldPath, 'version'), readPackageField(newPath, 'version')].find(
      (v) => v !== null && parseVersion(v) !== null,
    ) ?? null;

  return judgeDeclaration(found.bump, found.source, summary, caretDepth(version));
}

// Validates what a caller passed for the declared bump. An empty string has to
// be rejected rather than treated as absent: `--declared "$BUMP"` with an unset
// variable would otherwise drop the gate without a word about it.
//
// The message names the value rather than the CLI flag, because the MCP server
// takes the same argument under the name `declared` and an agent that passed it
// should not get back the name of a flag it never used.
export function parseDeclaredBump(input: unknown): DeclaredBump | 'auto' | undefined {
  if (input === undefined) return undefined;
  if (input === 'auto' || input === 'major' || input === 'minor' || input === 'patch' || input === 'none') {
    return input;
  }
  throw new Error(`declared must be one of: major, minor, patch, none, auto`);
}

export interface FoundDeclaration {
  bump: DeclaredBump;
  source: string;
}

// Reads what the release under comparison declares. A changeset is the explicit
// statement and wins; the version fields are the fallback for repositories that
// do not use changesets, where the bump is only ever implied by the numbers.
export function detectDeclaredBump(oldPath: string, newPath: string, ascend = false): FoundDeclaration | null {
  const pkgName = readPackageField(newPath, 'name');
  const fromChangeset = pkgName ? readChangesetBump(newPath, pkgName, ascend) : null;
  return fromChangeset ?? readVersionBump(oldPath, newPath);
}

// ---------------------------------------------------------------- changesets

// changesets skips these by name. README is matched without regard to case,
// the other three exactly, which is what `@changesets/read` does.
const IGNORED_CHANGESET_FILES = new Set(['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']);

const FRONTMATTER = /^\s*---\r?\n([\s\S]*?)\r?\n\s*---/;

// One frontmatter entry, split at the first colon. A scoped name has to be
// quoted for the YAML to parse at all, so both quoted forms are accepted.
const ENTRY = /^\s*(?:"([^"]*)"|'([^']*)'|([^'"#\s][^:]*?))\s*:\s*(.+?)\s*$/;

function readChangesetBump(projectPath: string, pkgName: string, ascend: boolean): FoundDeclaration | null {
  const root = changesetRoot(projectPath, ascend);
  if (!root) return null;

  let bump: DeclaredBump | null = null;
  let source: string | null = null;
  let count = 0;

  for (const dir of [root, path.join(root, 'pre')]) {
    for (const file of listChangesets(dir)) {
      const declared = bumpForPackage(readFile(file), pkgName);
      if (!declared) continue;
      count += 1;
      // Several changesets for one package merge to the highest of them, which
      // is what `changeset version` would apply.
      if (bump === null || ORDER[declared] > ORDER[bump]) {
        bump = declared;
        source = describeChangeset(projectPath, file);
      }
    }
  }

  if (bump === null || source === null) return null;
  return { bump, source: count > 1 ? `${source} (highest of ${count} changesets)` : source };
}

// changesets lives at the workspace root and a package in a monorepo sits under
// it, so the directory being compared is where the walk starts. It is not where
// the walk may end, but it does have to end: an unrelated `.changeset` further
// up would otherwise be read as this release's declaration and pass a gate that
// should have failed.
//
// Two ceilings. The walk only happens at all for a local path, which is the one
// case where the directory under comparison can be a package inside a larger
// workspace; an npm tarball does not ship `.changeset`, and a git ref is
// extracted whole so its own root is the first thing checked. And within a
// path, the walk does not leave the workspace or repository the package belongs
// to, so a `.changeset` above that boundary is never reached. One inside it
// still is, which is the point: that is where a monorepo keeps them.
function changesetRoot(projectPath: string, ascend: boolean): string | null {
  let dir = path.resolve(projectPath);
  for (;;) {
    const candidate = path.join(dir, '.changeset');
    if (isDirectory(candidate)) return candidate;
    if (!ascend || isWorkspaceRoot(dir)) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function isWorkspaceRoot(dir: string): boolean {
  // `.git` is a file, not a directory, in a worktree and in a submodule.
  if (exists(path.join(dir, '.git')) || readFile(path.join(dir, 'pnpm-workspace.yaml')) !== null) return true;
  const text = readFile(path.join(dir, 'package.json'));
  if (text === null) return false;
  try {
    return 'workspaces' in (JSON.parse(text) as Record<string, unknown>);
  } catch {
    return false;
  }
}

// A changeset in the package's own directory reads as `.changeset/x.md`, and one
// at a workspace root above it as `../../.changeset/x.md`, so a reader can tell
// the two apart. Relative on purpose: this string is posted to pull requests,
// and an absolute path would publish the layout and the account name of
// whatever machine the run happened on.
function describeChangeset(projectPath: string, file: string): string {
  return path.relative(path.resolve(projectPath), file);
}

function listChangesets(dir: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter(
      (n) =>
        !n.startsWith('.') &&
        n.endsWith('.md') &&
        n.toLowerCase() !== 'readme.md' &&
        !IGNORED_CHANGESET_FILES.has(n),
    )
    .sort()
    .map((n) => path.join(dir, n));
}

// The frontmatter of a changeset is a flat map of package name to release type,
// so a line scan reads it without a YAML dependency.
// ponytail: line scan, swap in a YAML parser if flow-style maps or anchors ever
// turn up in real changesets.
function bumpForPackage(text: string | null, pkgName: string): DeclaredBump | null {
  if (text === null) return null;
  const block = FRONTMATTER.exec(text);
  if (!block) return null;

  let bump: DeclaredBump | null = null;
  for (const line of block[1].split(/\r?\n/)) {
    const entry = ENTRY.exec(line);
    if (!entry) continue;
    // No trim: `\s*:` has already eaten the padding around a bare key, and a
    // quoted key keeps the spaces inside its quotes the way YAML reads them.
    const name = entry[1] ?? entry[2] ?? entry[3] ?? '';
    if (name !== pkgName) continue;
    const declared = releaseType(entry[4]);
    if (declared !== null && (bump === null || ORDER[declared] > ORDER[bump])) bump = declared;
  }
  return bump;
}

// A release type as YAML would hand it back: an inline comment removed, and one
// layer of quotes stripped. `patch#why` keeps its suffix on purpose, because
// YAML needs whitespace ahead of a comment and so reads that as one scalar.
function releaseType(raw: string): DeclaredBump | null {
  const value = raw
    .replace(/\s+#.*$/, '')
    .trim()
    .replace(/^(["'])([\s\S]*)\1$/, '$2');
  return value === 'major' || value === 'minor' || value === 'patch' || value === 'none' ? value : null;
}

// ---------------------------------------------------------------- versions

function readVersionBump(oldPath: string, newPath: string): FoundDeclaration | null {
  const oldVersion = readPackageField(oldPath, 'version');
  const newVersion = readPackageField(newPath, 'version');
  if (!oldVersion || !newVersion) return null;

  const bump = bumpBetween(oldVersion, newVersion);
  if (bump === null) return null;
  return { bump, source: `package.json version ${oldVersion} -> ${newVersion}` };
}

// The bump the version numbers themselves declare, read as written. What that
// bump then has to cover is decided in requiredBump, which is where the 0.x
// adjustment lives so that the changeset path gets it too.
function bumpBetween(oldVersion: string, newVersion: string): DeclaredBump | null {
  const a = parseVersion(oldVersion);
  const b = parseVersion(newVersion);
  if (!a || !b) return null;
  // A version that went backwards is not a bump at all, and reading `2.0.0 ->
  // 1.0.0` as a declared major would pass any break. The usual way to get here
  // is swapping the two arguments.
  if (b.major < a.major || (b.major === a.major && (b.minor < a.minor || (b.minor === a.minor && b.patch < a.patch)))) {
    return null;
  }
  if (a.major !== b.major) return 'major';
  if (a.minor !== b.minor) return 'minor';
  if (a.patch !== b.patch) return 'patch';
  // The three numbers match and a prerelease tag is in play, so the release
  // moved somewhere these fields cannot describe: an rc promoted to stable, or
  // one beta to the next. `none` would be a confident wrong answer, and the
  // caller asks for `--declared` explicitly instead.
  if (a.pre !== null || b.pre !== null) return null;
  return 'none';
}

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  pre: string | null;
}

// Anchored at both ends: `1.2.3.4` is not a version, and reading it as `1.2.3`
// would silently compare the wrong thing. Build metadata is ignored, as semver
// says it must be for precedence.
const VERSION = /^\s*v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?\s*$/;

function parseVersion(version: string): ParsedVersion | null {
  const m = VERSION.exec(version);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ?? null };
}

// ---------------------------------------------------------------- files

function readPackageField(projectPath: string, field: 'name' | 'version'): string | null {
  const text = readFile(path.join(projectPath, 'package.json'));
  if (text === null) return null;
  try {
    const value = (JSON.parse(text) as Record<string, unknown>)[field];
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function readFile(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function exists(entry: string): boolean {
  try {
    fs.statSync(entry);
    return true;
  } catch {
    return false;
  }
}
