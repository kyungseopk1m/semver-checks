import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  caretDepth,
  detectDeclaredBump,
  judgeDeclaration,
  parseDeclaredBump,
  requiredBump,
  resolveDeclaration,
  suggestedBump,
} from '../src/declared.js';
import type { SemverReport } from '../src/types.js';

let root: string;

function project(name: string, files: Record<string, string>): string {
  const dir = path.join(root, name);
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return dir;
}

function pkg(name: string, version: string): string {
  return JSON.stringify({ name, version });
}

function summary(over: Partial<SemverReport['summary']> = {}): SemverReport['summary'] {
  return { major: 0, minor: 0, patch: 0, majorProven: 0, majorReview: 0, ...over };
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'semver-checks-declared-'));
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('requiredBump and suggestedBump', () => {
  it('demands a major only for a proven break, and never a minor', () => {
    // The gate keys on requiredBump, so a minor must not reach it: every MINOR
    // kind falls through to 'heuristic', and failing a build on an ungraded
    // rule is how a gate gets switched off.
    expect(requiredBump(summary({ major: 3, majorProven: 1, majorReview: 2 }))).toBe('major');
    expect(requiredBump(summary({ major: 3, majorProven: 0, majorReview: 3, minor: 1 }))).toBe('patch');
    expect(requiredBump(summary({ minor: 9 }))).toBe('patch');
  });

  it('lets both additions and review-only breaks into the suggestion', () => {
    expect(suggestedBump(summary({ minor: 1 }))).toBe('minor');
    // A review-only major has to reach the suggestion, or the report's own
    // "Needs review" section would never drive a verdict.
    expect(suggestedBump(summary({ major: 3, majorProven: 0, majorReview: 3 }))).toBe('major');
    expect(suggestedBump(summary({ majorProven: 1, major: 1, minor: 4 }))).toBe('major');
    expect(suggestedBump(summary())).toBe('patch');
  });

  it('shifts a break down one field below 1.0', () => {
    expect(requiredBump(summary({ majorProven: 1, major: 1 }), 0)).toBe('major');
    expect(requiredBump(summary({ majorProven: 1, major: 1 }), 1)).toBe('minor');
    expect(requiredBump(summary({ minor: 3 }), 1)).toBe('patch');
    expect(suggestedBump(summary({ major: 1, majorReview: 1 }), 1)).toBe('minor');
  });

  it('stops shifting at one field, so the gate can still fail below 1.0', () => {
    // Shifting again at 0.0.x would floor the requirement at `patch`, and a
    // requirement of `patch` is one every declaration covers, so no summary at
    // all could produce a failing verdict. `~0.0.5` and `0.0.x` accept `0.0.6`
    // anyway, so a patch is not where a 0.0.x break can be announced.
    expect(caretDepth('1.2.3')).toBe(0);
    expect(caretDepth('0.5.0')).toBe(1);
    expect(caretDepth('0.0.5')).toBe(1);
    expect(caretDepth(null)).toBe(0);
    expect(caretDepth('not a version')).toBe(0);

    const verdicts = new Set(
      (['none', 'patch', 'minor', 'major'] as const).map(
        (d) => judgeDeclaration(d, 'test', summary({ majorProven: 2, major: 2, minor: 1 }), 1).verdict,
      ),
    );
    expect(verdicts.has('mismatch')).toBe(true);
  });
});

describe('judgeDeclaration', () => {
  const verdicts: Array<[Parameters<typeof judgeDeclaration>[0], SemverReport['summary'], 'ok' | 'review' | 'mismatch']> = [
    // A proven break is the only thing that fails a run.
    ['major', summary({ majorProven: 1, major: 1 }), 'ok'],
    ['minor', summary({ majorProven: 1, major: 1 }), 'mismatch'],
    ['patch', summary({ majorProven: 1, major: 1 }), 'mismatch'],
    ['none', summary({ majorProven: 1, major: 1 }), 'mismatch'],
    // An addition argues for a minor without failing anything.
    ['patch', summary({ minor: 4 }), 'review'],
    ['none', summary({ minor: 4 }), 'review'],
    ['minor', summary({ minor: 4 }), 'ok'],
    ['major', summary({ minor: 4 }), 'ok'],
    // Nothing moved: every declaration covers that, `none` included.
    ['none', summary({ patch: 2 }), 'ok'],
    ['patch', summary(), 'ok'],
    // A review-only major never fails a run, but it does have to reach the
    // reader: the report's own "Needs review" section would otherwise be
    // contradicted by a verdict that says the declaration covers everything.
    ['patch', summary({ major: 9, majorReview: 9 }), 'review'],
    ['major', summary({ major: 9, majorReview: 9 }), 'ok'],
    // A proven break outranks the addition it ships alongside.
    ['minor', summary({ majorProven: 2, major: 2, minor: 5 }), 'mismatch'],
  ];

  for (const [declared, s, verdict] of verdicts) {
    it(`${declared} against ${s.majorProven} proven / ${s.minor} minor is ${verdict}`, () => {
      expect(judgeDeclaration(declared, 'test', s).verdict).toBe(verdict);
    });
  }

  it('reports both bumps it compared against', () => {
    expect(judgeDeclaration('minor', '.changeset/wild-pans-shake.md', summary({ majorProven: 2, major: 2, minor: 1 }))).toEqual({
      declared: 'minor',
      source: '.changeset/wild-pans-shake.md',
      required: 'major',
      suggested: 'major',
      verdict: 'mismatch',
    });
  });
});

describe('detectDeclaredBump from changesets', () => {
  it('reads the release type declared for this package', () => {
    const dir = project('cs-basic', {
      'package.json': pkg('my-pkg', '1.2.3'),
      '.changeset/wild-pans-shake.md': '---\n"my-pkg": minor\n---\n\nAdd a thing.\n',
    });
    expect(detectDeclaredBump(dir, dir)).toEqual({
      bump: 'minor',
      source: path.join('.changeset', 'wild-pans-shake.md'),
    });
  });

  it('reads a scoped name and ignores the other packages in the file', () => {
    const dir = project('cs-scoped', {
      'package.json': pkg('@scope/core', '1.0.0'),
      '.changeset/many.md': '---\n"@scope/cli": major\n"@scope/core": minor\n---\n\nChange all the things\n',
    });
    expect(detectDeclaredBump(dir, dir)?.bump).toBe('minor');
  });

  it('takes the highest of several changesets, the way changeset version would', () => {
    const dir = project('cs-max', {
      'package.json': pkg('my-pkg', '1.0.0'),
      '.changeset/a.md': '---\n"my-pkg": patch\n---\n\nFix.\n',
      '.changeset/b.md': '---\n"my-pkg": major\n---\n\nBreak.\n',
      '.changeset/c.md': '---\n"my-pkg": minor\n---\n\nAdd.\n',
    });
    const found = detectDeclaredBump(dir, dir);
    expect(found?.bump).toBe('major');
    expect(found?.source).toContain('highest of 3');
  });

  it('reads bare and single-quoted keys', () => {
    const bare = project('cs-bare', {
      'package.json': pkg('my-pkg', '1.0.0'),
      '.changeset/a.md': '---\nmy-pkg: major\n---\n\nBreak.\n',
    });
    expect(detectDeclaredBump(bare, bare)?.bump).toBe('major');

    const quoted = project('cs-single', {
      'package.json': pkg('my-pkg', '1.0.0'),
      '.changeset/a.md': "---\n'my-pkg': minor\n---\n\nAdd.\n",
    });
    expect(detectDeclaredBump(quoted, quoted)?.bump).toBe('minor');
  });

  it('scans .changeset/pre as well', () => {
    const dir = project('cs-pre', {
      'package.json': pkg('my-pkg', '1.0.0'),
      '.changeset/pre.json': '{"mode":"pre","tag":"next"}',
      '.changeset/pre/a.md': '---\n"my-pkg": major\n---\n\nBreak.\n',
    });
    expect(detectDeclaredBump(dir, dir)?.bump).toBe('major');
  });

  it('skips the files changesets itself skips', () => {
    // Every one of these names a bump for the package and must not be read:
    // README/AGENTS/CLAUDE/GEMINI are on changesets' ignore list, config.json is
    // not markdown, and a dot file is hidden. Falling through to the versions is
    // the proof that none of them was picked up.
    const dir = project('cs-ignored', {
      'package.json': pkg('my-pkg', '1.2.3'),
      '.changeset/README.md': '---\n"my-pkg": major\n---\n\nDocs.\n',
      '.changeset/CLAUDE.md': '---\n"my-pkg": major\n---\n\nDocs.\n',
      '.changeset/AGENTS.md': '---\n"my-pkg": major\n---\n\nDocs.\n',
      '.changeset/GEMINI.md': '---\n"my-pkg": major\n---\n\nDocs.\n',
      '.changeset/config.json': '{"changelog":"@changesets/cli/changelog"}',
      '.changeset/.hidden.md': '---\n"my-pkg": major\n---\n\nHidden.\n',
    });
    const old = project('cs-ignored-old', { 'package.json': pkg('my-pkg', '1.2.2') });
    expect(detectDeclaredBump(old, dir)).toEqual({
      bump: 'patch',
      source: 'package.json version 1.2.2 -> 1.2.3',
    });
  });

  it('falls through to the versions when no changeset names this package', () => {
    const dir = project('cs-other', {
      'package.json': pkg('my-pkg', '2.0.0'),
      '.changeset/a.md': '---\n"other-pkg": major\n---\n\nNot us.\n',
    });
    const old = project('cs-other-old', { 'package.json': pkg('my-pkg', '1.9.0') });
    expect(detectDeclaredBump(old, dir)?.bump).toBe('major');
  });
});

describe('detectDeclaredBump from package.json versions', () => {
  const bump = (from: string, to: string) => {
    const suffix = `${from}-${to}`.replace(/[^\w.-]/g, '_');
    const old = project(`v-old-${suffix}`, { 'package.json': pkg('my-pkg', from) });
    const nw = project(`v-new-${suffix}`, { 'package.json': pkg('my-pkg', to) });
    return detectDeclaredBump(old, nw)?.bump;
  };

  it('reads the field that moved', () => {
    expect(bump('1.2.3', '2.0.0')).toBe('major');
    expect(bump('1.2.3', '1.3.0')).toBe('minor');
    expect(bump('1.2.3', '1.2.4')).toBe('patch');
    expect(bump('1.2.3', '1.2.3')).toBe('none');
  });

  it('reads a 0.x version as written, leaving what it has to cover to requiredBump', () => {
    // The 0.x adjustment used to live here, which made the version path and the
    // changeset path disagree about the same release. It now lives in
    // requiredBump, so both sources report the field that actually moved.
    expect(bump('0.1.4', '0.2.0')).toBe('minor');
    expect(bump('0.1.4', '0.1.5')).toBe('patch');
    expect(bump('0.9.0', '1.0.0')).toBe('major');
  });

  it('ignores a prerelease suffix', () => {
    expect(bump('1.2.3', '2.0.0-beta.1')).toBe('major');
  });

  it('returns nothing when a version cannot be read', () => {
    const old = project('v-broken-old', { 'package.json': '{ not json' });
    const nw = project('v-broken-new', { 'package.json': pkg('my-pkg', '1.0.0') });
    expect(detectDeclaredBump(old, nw)).toBeNull();
  });
});

describe('0.x, where the two declaration sources would otherwise disagree', () => {
  // changeset `major` on 0.5.0 writes 1.0.0, so `minor` is the only way a 0.x
  // release can declare a break. The version fields say minor for the very same
  // release. Both have to reach the same verdict.
  const broke = summary({ majorProven: 1, major: 1 });

  it('accepts a 0.x minor as the break it announces, from either source', () => {
    const oldSide = project('zerox-old', { 'package.json': pkg('my-pkg', '0.5.0') });
    const viaVersions = project('zerox-new', { 'package.json': pkg('my-pkg', '0.6.0') });
    const viaChangeset = project('zerox-cs', {
      'package.json': pkg('my-pkg', '0.5.0'),
      '.changeset/wild.md': '---\n"my-pkg": minor\n---\n\nBreak.\n',
    });

    expect(resolveDeclaration(oldSide, viaVersions, 'auto', broke)?.verdict).toBe('ok');
    expect(resolveDeclaration(oldSide, viaChangeset, 'auto', broke)?.verdict).toBe('ok');
  });

  it('still catches a 0.x patch that hides a break', () => {
    const oldSide = project('zerox-p-old', { 'package.json': pkg('my-pkg', '0.5.0') });
    const newSide = project('zerox-p-new', { 'package.json': pkg('my-pkg', '0.5.1') });
    const d = resolveDeclaration(oldSide, newSide, 'auto', broke);
    expect(d?.verdict).toBe('mismatch');
    expect(d?.required).toBe('minor');
  });

  it('keeps demanding a major once the package is past 1.0', () => {
    const oldSide = project('onex-old', { 'package.json': pkg('my-pkg', '1.5.0') });
    const newSide = project('onex-new', { 'package.json': pkg('my-pkg', '1.6.0') });
    expect(resolveDeclaration(oldSide, newSide, 'auto', broke)?.verdict).toBe('mismatch');
  });
});

describe('changeset frontmatter the real parser accepts', () => {
  const read = (name: string, changeset: string) => {
    const dir = project(name, { 'package.json': pkg('my-pkg', '1.0.0'), '.changeset/wild.md': changeset });
    return detectDeclaredBump(dir, dir)?.bump;
  };

  it('reads a value with a trailing YAML comment', () => {
    expect(read('cs-comment', '---\n"my-pkg": major # dropped the legacy export\n---\n\nBreak.\n')).toBe('major');
  });

  it('reads a quoted value', () => {
    expect(read('cs-qv-double', '---\n"my-pkg": "major"\n---\n\nBreak.\n')).toBe('major');
    expect(read('cs-qv-single', "---\n'my-pkg': 'minor'\n---\n\nAdd.\n")).toBe('minor');
  });

  it('keeps a scalar that only looks like a comment, the way YAML does', () => {
    // No whitespace before the #, so YAML reads one scalar `major#why`, which is
    // not a release type. The changeset yields nothing and the versions answer
    // instead, which is how a reader can tell the frontmatter was not understood.
    const dir = project('cs-nohash', {
      'package.json': pkg('my-pkg', '1.0.0'),
      '.changeset/wild.md': '---\n"my-pkg": major#why\n---\n\nBreak.\n',
    });
    expect(detectDeclaredBump(dir, dir)).toEqual({
      bump: 'none',
      source: 'package.json version 1.0.0 -> 1.0.0',
    });
  });

  it('reads CRLF frontmatter', () => {
    expect(read('cs-crlf', '---\r\n"my-pkg": major\r\n---\r\n\r\nBreak.\r\n')).toBe('major');
  });

  it('stops at the first fence rather than swallowing a later one', () => {
    // The decoy sits inside a second fenced block, which a greedy frontmatter
    // match would swallow along with everything between the two.
    expect(
      read('cs-greedy', '---\n"my-pkg": patch\n---\n\nBefore.\n\n---\n"my-pkg": major\n---\n'),
    ).toBe('patch');
  });

  it('reads a file that opens with a byte order mark', () => {
    expect(read('cs-bom', '\ufeff---\n"my-pkg": major\n---\n\nBreak.\n')).toBe('major');
  });

  it('keeps a quoted key exactly as written', () => {
    // A trim here would make `" my-pkg "` match `my-pkg`, which YAML does not.
    const dir = project('cs-quoted-pad', {
      'package.json': pkg('my-pkg', '1.0.0'),
      '.changeset/a.md': '---\n" my-pkg ": major\n---\n\nNot this package.\n',
    });
    expect(detectDeclaredBump(dir, dir)?.bump).toBe('none');
  });

  it('takes the highest of two entries for one package in one file', () => {
    // Real changesets would reject a duplicate key outright; this only pins
    // which way the line scan falls so the choice is not accidental.
    expect(read('cs-dup', '---\n"my-pkg": patch\n"my-pkg": major\n---\n\nBreak.\n')).toBe('major');
  });

  it('ignores an entry outside the frontmatter', () => {
    expect(read('cs-body', '---\n"my-pkg": patch\n---\n\nSee `"my-pkg": major` for why not.\n')).toBe('patch');
  });

  it('trims a padded key', () => {
    expect(read('cs-pad', '---\n  my-pkg  : major\n---\n\nBreak.\n')).toBe('major');
  });

  it('follows changesets on which documentation names are skipped', () => {
    // AGENTS/CLAUDE/GEMINI are exact-match upstream, so a lowercase claude.md is
    // a real changeset and has to be read.
    const dir = project('cs-case', {
      'package.json': pkg('my-pkg', '1.0.0'),
      '.changeset/claude.md': '---\n"my-pkg": major\n---\n\nBreak.\n',
    });
    expect(detectDeclaredBump(dir, dir)?.bump).toBe('major');
  });

  it('names a stable file when several changesets tie', () => {
    // Same bump in both, so the reported source must not depend on readdir order.
    const dir = project('cs-tie', {
      'package.json': pkg('my-pkg', '1.0.0'),
      '.changeset/b-second.md': '---\n"my-pkg": minor\n---\n\nB.\n',
      '.changeset/a-first.md': '---\n"my-pkg": minor\n---\n\nA.\n',
    });
    expect(detectDeclaredBump(dir, dir)?.source).toContain('a-first.md');
  });
});

describe('changesets in a monorepo', () => {
  it('finds the workspace root changeset from a package directory', () => {
    const root = project('mono', {
      'package.json': JSON.stringify({ name: 'root', private: true, workspaces: ['packages/*'] }),
      '.changeset/wild.md': '---\n"@scope/core": major\n---\n\nBreak.\n',
      'packages/core/package.json': pkg('@scope/core', '1.4.0'),
    });
    const corePath = path.join(root, 'packages', 'core');
    const found = detectDeclaredBump(corePath, corePath, true);
    expect(found?.bump).toBe('major');
    expect(found?.source).toContain('wild.md');
    // Without the opt-in the walk never leaves the package directory, and the
    // versions answer instead. An npm tarball ships no changesets and a git ref
    // is extracted whole, so neither has anything above it to find.
    expect(detectDeclaredBump(corePath, corePath)?.source).toBe('package.json version 1.4.0 -> 1.4.0');
  });
});

describe('prerelease versions', () => {
  const bump = (from: string, to: string) => {
    const suffix = `${from}-${to}`.replace(/[^\w.-]/g, '_');
    const old = project(`pre-old-${suffix}`, { 'package.json': pkg('my-pkg', from) });
    const nw = project(`pre-new-${suffix}`, { 'package.json': pkg('my-pkg', to) });
    return detectDeclaredBump(old, nw);
  };

  it('refuses to grade a move the three numbers cannot describe', () => {
    // Calling any of these `none` would be a confident wrong answer, and the
    // caller is told to pass --declared instead.
    expect(bump('1.0.0-rc.1', '1.0.0')).toBeNull();
    expect(bump('2.0.0-beta.1', '2.0.0-beta.5')).toBeNull();
    expect(bump('1.2.3', '1.2.3-beta.1')).toBeNull();
  });

  it('still grades a move the numbers do describe', () => {
    expect(bump('1.2.3', '2.0.0-beta.1')?.bump).toBe('major');
    expect(bump('1.2.3', '1.3.0-rc.1')?.bump).toBe('minor');
  });

  it('ignores build metadata, which semver excludes from precedence', () => {
    expect(bump('1.2.3+build.1', '1.2.3+build.2')?.bump).toBe('none');
  });

  it('rejects a version string that is not one', () => {
    // Reading 1.2.3.4 as 1.2.3 would silently compare the wrong thing.
    expect(bump('1.2.3.4', '1.2.3.9')).toBeNull();
  });

  it('accepts a v prefix', () => {
    expect(bump('v1.2.3', 'v1.3.0')?.bump).toBe('minor');
  });
});

describe('parseDeclaredBump', () => {
  it('accepts the five values and nothing else', () => {
    for (const v of ['auto', 'major', 'minor', 'patch', 'none']) expect(parseDeclaredBump(v)).toBe(v);
    expect(parseDeclaredBump(undefined)).toBeUndefined();
  });

  it('rejects an empty value rather than dropping the gate', () => {
    // `--declared "$BUMP"` with an unset variable would otherwise run as though
    // no gate had been asked for, and exit 0 without a word about it.
    expect(() => parseDeclaredBump('')).toThrow(/--declared must be one of/);
    expect(() => parseDeclaredBump(true)).toThrow(/--declared must be one of/);
    expect(() => parseDeclaredBump('MAJOR')).toThrow(/--declared must be one of/);
  });
});

describe('the walk for a workspace changeset stops somewhere', () => {
  const broke = summary({ majorProven: 1, major: 1 });

  it('does not read a changeset from outside the repository', () => {
    // Without a ceiling this climbs to the filesystem root, and a stray
    // .changeset several levels up would pass a gate that should have failed.
    const outer = project('ceiling', {
      '.changeset/far.md': '---\n"my-pkg": major\n---\n\nNot this repository.\n',
      // A worktree and a submodule both write `.git` as a file, not a
      // directory, so the ceiling has to look for either.
      'repo/.git': 'gitdir: /elsewhere/.git/worktrees/repo\n',
      'repo/pkg/package.json': pkg('my-pkg', '1.2.3'),
    });
    const inner = path.join(outer, 'repo', 'pkg');
    const found = detectDeclaredBump(inner, inner, true);
    expect(found?.source).toBe('package.json version 1.2.3 -> 1.2.3');
    expect(resolveDeclaration(inner, inner, 'auto', broke, true)?.verdict).toBe('mismatch');
  });

  it('still reads the workspace root it belongs to', () => {
    const root = project('ceiling-ok', {
      'package.json': JSON.stringify({ name: 'root', private: true, workspaces: ['packages/*'] }),
      '.changeset/near.md': '---\n"@scope/core": major\n---\n\nBreak.\n',
      'packages/core/package.json': pkg('@scope/core', '1.4.0'),
    });
    const corePath = path.join(root, 'packages', 'core');
    const found = detectDeclaredBump(corePath, corePath, true);
    expect(found?.bump).toBe('major');
    // Named with the directory it came from, so a workspace root's changeset is
    // not mistaken for this package's own.
    expect(found?.source).toContain('near.md');
    // Relative, because this string is posted to pull requests and an absolute
    // path would publish the layout and account name of the machine that ran.
    expect(found?.source).toBe(path.join('..', '..', '.changeset', 'near.md'));
  });
});

describe('a version that went backwards', () => {
  const broke = summary({ majorProven: 1, major: 1 });

  it('is not read as a declared bump', () => {
    // 2.0.0 -> 1.0.0 used to read as `major`, which passed every break. The
    // usual way to get here is swapping the two arguments.
    const back = (from: string, to: string) => {
      const suffix = `${from}-${to}`.replace(/[^\w.-]/g, '_');
      const old = project(`back-old-${suffix}`, { 'package.json': pkg('my-pkg', from) });
      const nw = project(`back-new-${suffix}`, { 'package.json': pkg('my-pkg', to) });
      return { old, nw, found: detectDeclaredBump(old, nw) };
    };
    expect(back('2.0.0', '1.0.0').found).toBeNull();
    expect(back('1.5.0', '1.4.0').found).toBeNull();
    expect(back('1.0.5', '1.0.2').found).toBeNull();
    const { old, nw } = back('2.0.0', '1.0.0');
    expect(resolveDeclaration(old, nw, 'auto', broke)).toBeNull();
  });
});

describe('when the old package.json cannot be read', () => {
  const broke = summary({ majorProven: 1, major: 1 });

  it('falls back to the new side rather than guessing the package is past 1.0', () => {
    // Guessing 1.x here fails a correct 0.x release and tells its author to
    // declare a major, which writes 1.0.0 and cannot be taken back.
    const newSide = project('oldless-new', {
      'package.json': pkg('my-pkg', '0.5.0'),
      '.changeset/wild.md': '---\n"my-pkg": minor\n---\n\nBreak.\n',
    });
    const noOld = project('oldless-old', {});
    expect(resolveDeclaration(noOld, newSide, 'minor', broke)?.verdict).toBe('ok');

    const brokenOld = project('oldbroken-old', { 'package.json': '{ not json' });
    expect(resolveDeclaration(brokenOld, newSide, 'minor', broke)?.verdict).toBe('ok');
  });

  it('keeps an explicit declaration when no version parses at all', () => {
    // Throwing the declaration away here would answer a caller who stated the
    // bump outright with an error telling them to state the bump outright.
    const a = project('noversion-a', { 'package.json': '{"name":"my-pkg"}' });
    const b = project('noversion-b', { 'package.json': '{"name":"my-pkg"}' });
    expect(resolveDeclaration(a, b, 'minor', broke)?.verdict).toBe('mismatch');
  });

  it('skips a version field that is present but not a version', () => {
    // `1.0` reads back as a non-null string, so picking the first side that is
    // merely readable would dead-end on it.
    const a = project('unparseable-old', { 'package.json': '{"name":"my-pkg","version":"1.0"}' });
    const b = project('unparseable-new', { 'package.json': pkg('my-pkg', '0.5.0') });
    expect(resolveDeclaration(a, b, 'minor', broke)?.required).toBe('minor');
  });
});

describe('0.0.x, where a caret matches nothing else', () => {
  const broke = summary({ majorProven: 1, major: 1 });

  it('still demands a minor, because a patch escapes no range but the caret', () => {
    // `^0.0.5` refuses `0.0.6`, but `~0.0.5` and `0.0.x` both accept it, so the
    // only bump that puts a 0.0.x break out of every range is 0.1.0.
    const old = project('zerozero-old', { 'package.json': pkg('my-pkg', '0.0.5') });
    const nw = project('zerozero-new', { 'package.json': pkg('my-pkg', '0.0.6') });
    const d = resolveDeclaration(old, nw, 'auto', broke);
    expect(d?.required).toBe('minor');
    expect(d?.verdict).toBe('mismatch');
  });
});
