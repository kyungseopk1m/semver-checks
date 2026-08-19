import { describe, it, expect } from 'vitest';
import { markdownReport } from '../src/report/markdown-reporter.js';
import { githubReport } from '../src/report/github-reporter.js';
import type { SemverReport } from '../src/types.js';

const report: SemverReport = {
  recommended: 'major',
  summary: { major: 1, minor: 1, patch: 0, majorProven: 1, majorReview: 0 },
  changes: [
    { kind: 'property-removed', severity: 'major', symbolPath: 'Config.host', message: "Property 'host' was removed", confidence: 'proven' },
    { kind: 'export-added', severity: 'minor', symbolPath: 'helper', message: "Export 'helper' was added", confidence: 'proven' },
  ],
};

const empty: SemverReport = {
  recommended: 'patch',
  summary: { major: 0, minor: 0, patch: 0, majorProven: 0, majorReview: 0 },
  changes: [],
};

// A review-only (heuristic) major: surfaces as ⚠️ / ::warning::, not ::error::.
const reviewOnly: SemverReport = {
  recommended: 'major',
  summary: { major: 1, minor: 0, patch: 0, majorProven: 0, majorReview: 1 },
  changes: [
    { kind: 'type-alias-changed', severity: 'major', symbolPath: 'ClassValue', message: "Type alias 'ClassValue' changed", confidence: 'heuristic' },
  ],
};

describe('markdownReport', () => {
  it('renders the bump, summary, and per-severity tables', () => {
    const md = markdownReport(report);
    expect(md).toContain('recommended bump: `MAJOR`');
    expect(md).toContain('**major:** 1 (confident: 1, review: 0) · **minor:** 1 · **patch:** 0');
    expect(md).toContain('### 🚨 Breaking changes — confident (MAJOR)');
    expect(md).toContain('| `Config.host` | Property \'host\' was removed |');
    expect(md).toContain('### ✨ New features (MINOR)');
    expect(md).toContain('| `helper` | Export \'helper\' was added |');
  });

  it('renders a heuristic major under the review section, not the confident one', () => {
    const md = markdownReport(reviewOnly);
    expect(md).toContain("### ⚠️ Needs review — couldn't prove safe (MAJOR)");
    expect(md).not.toContain('### 🚨 Breaking changes — confident (MAJOR)');
    expect(md).toContain('**major:** 1 (confident: 0, review: 1)');
  });

  it('escapes pipe characters inside table cells', () => {
    const md = markdownReport({
      ...report,
      changes: [{ kind: 'type-alias-changed', severity: 'major', symbolPath: 'T', message: 'string | number' }],
    });
    expect(md).toContain('string \\| number');
  });

  it('reports cleanly when there are no changes', () => {
    expect(markdownReport(empty)).toContain('✅ No API changes detected.');
  });

  it('renders a valid code span even when the symbol path contains a backtick', () => {
    const md = markdownReport({
      ...report,
      changes: [{ kind: 'export-removed', severity: 'major', symbolPath: 'A`B', message: 'removed' }],
    });
    // Fence is longer than the internal backtick run and padded with a space (GFM).
    expect(md).toContain('| `` A`B `` | removed |');
  });

  it('escapes a pipe and fences a backtick when both appear in the symbol path', () => {
    const md = markdownReport({
      ...report,
      changes: [{ kind: 'export-removed', severity: 'major', symbolPath: 'A`B|C', message: 'removed' }],
    });
    // GFM: the pipe is backslash-escaped (so the table cell isn't split) and the
    // whole symbol is wrapped in a `` fence (so the backtick stays literal).
    expect(md).toContain('| `` A`B\\|C `` | removed |');
  });
});

describe('githubReport', () => {
  it('emits ::error for major, ::warning for minor, and a ::notice summary', () => {
    const out = githubReport(report);
    expect(out).toContain('::error title=Breaking change (Config.host)::Property \'host\' was removed');
    expect(out).toContain('::warning title=New feature (helper)::Export \'helper\' was added');
    expect(out).toContain('::notice title=semver-checks::Recommended bump: MAJOR (major: 1 [confident: 1, review: 0], minor: 1, patch: 0)');
  });

  it('emits ::warning (not ::error) for a review-only heuristic major', () => {
    const out = githubReport(reviewOnly);
    expect(out).toContain('::warning title=Needs review (ClassValue)::');
    expect(out).not.toContain('::error');
  });

  it('escapes workflow-command metacharacters in data and properties', () => {
    const out = githubReport({
      ...report,
      changes: [{ kind: 'type-alias-changed', severity: 'major', symbolPath: 'A,B:C', message: '100% changed' }],
    });
    expect(out).toContain('100%25 changed'); // '%' escaped in the message (data)
    expect(out).toContain('A%2CB%3AC'); // ',' and ':' escaped in the title (property)
  });

  it('emits only the notice summary when there are no changes', () => {
    const out = githubReport(empty);
    expect(out).toContain('::notice title=semver-checks::Recommended bump: PATCH');
    expect(out).not.toContain('::error');
    expect(out).not.toContain('::warning');
  });
});

describe('the declaration verdict', () => {
  const withDeclaration = (over: Record<string, unknown>): SemverReport => ({
    ...report,
    declaration: {
      declared: 'minor',
      source: '.changeset/wild-pans-shake.md',
      required: 'major',
      suggested: 'major',
      verdict: 'mismatch',
      ...over,
    } as SemverReport['declaration'],
  });

  it('names the bump, the requirement, and where the declaration came from', () => {
    const md = markdownReport(withDeclaration({}));
    expect(md).toContain('❌ This release declares `minor`, but a proven breaking change requires `major`.');
    expect(md).toContain('Read from `.changeset/wild-pans-shake.md`.');
  });

  it('says so when the declaration covers what happened', () => {
    const md = markdownReport(withDeclaration({ declared: 'major', verdict: 'ok' }));
    expect(md).toContain('✅ This release declares `major`, which covers the `major` its API surface requires.');
    expect(md).not.toContain('❌');
  });

  it('marks an addition as review-only rather than a failure', () => {
    const md = markdownReport(withDeclaration({ declared: 'patch', required: 'patch', suggested: 'minor', verdict: 'review' }));
    expect(md).toContain('⚠️ This release declares `patch`, and the changes below argue for `minor`.');
    expect(md).toContain('Review only: no proven break behind it.');
    expect(md).not.toContain('❌');
  });

  it('renders on a report with no changes at all, where the tables would not', () => {
    const md = markdownReport({
      ...empty,
      declaration: {
        declared: 'none',
        source: 'package.json version 1.0.0 -> 1.0.0',
        required: 'patch',
        suggested: 'patch',
        verdict: 'ok',
      },
    });
    expect(md).toContain('✅ This release declares `none`');
    expect(md).toContain('✅ No API changes detected.');
  });

  it('stays out of the report when nothing was declared', () => {
    expect(markdownReport(report)).not.toContain('This release declares');
  });
});

describe('the declaration verdict in the github format', () => {
  // This is the format the action defaults to, so a gate that exits 1 here with
  // nothing but a bump recommendation would fail a build without saying why.
  const withDeclaration = (over: Record<string, unknown>): SemverReport => ({
    ...report,
    declaration: {
      declared: 'minor',
      source: '.changeset/wild-pans-shake.md',
      required: 'major',
      suggested: 'major',
      verdict: 'mismatch',
      ...over,
    } as SemverReport['declaration'],
  });

  it('raises a mismatch as an error annotation', () => {
    const out = githubReport(withDeclaration({}));
    expect(out).toContain('::error title=Declared bump::');
    expect(out).toContain('declares minor, but a proven breaking change requires major');
  });

  it('raises a review note as a warning, not an error', () => {
    const out = githubReport(withDeclaration({ declared: 'patch', required: 'patch', suggested: 'minor', verdict: 'review' }));
    expect(out).toContain('::warning title=Declared bump::');
    expect(out).not.toContain('::error title=Declared bump::');
  });

  it('says nothing when nothing was declared', () => {
    expect(githubReport(report)).not.toContain('Declared bump');
  });
});
