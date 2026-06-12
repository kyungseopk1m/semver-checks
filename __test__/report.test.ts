import { describe, it, expect } from 'vitest';
import { markdownReport } from '../src/report/markdown-reporter.js';
import { githubReport } from '../src/report/github-reporter.js';
import type { SemverReport } from '../src/types.js';

const report: SemverReport = {
  recommended: 'major',
  summary: { major: 1, minor: 1, patch: 0 },
  changes: [
    { kind: 'property-removed', severity: 'major', symbolPath: 'Config.host', message: "Property 'host' was removed" },
    { kind: 'export-added', severity: 'minor', symbolPath: 'helper', message: "Export 'helper' was added" },
  ],
};

const empty: SemverReport = {
  recommended: 'patch',
  summary: { major: 0, minor: 0, patch: 0 },
  changes: [],
};

describe('markdownReport', () => {
  it('renders the bump, summary, and per-severity tables', () => {
    const md = markdownReport(report);
    expect(md).toContain('recommended bump: `MAJOR`');
    expect(md).toContain('**major:** 1 · **minor:** 1 · **patch:** 0');
    expect(md).toContain('### 🚨 Breaking changes (MAJOR)');
    expect(md).toContain('| `Config.host` | Property \'host\' was removed |');
    expect(md).toContain('### ✨ New features (MINOR)');
    expect(md).toContain('| `helper` | Export \'helper\' was added |');
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
    expect(out).toContain('::notice title=semver-checks::Recommended bump: MAJOR (major: 1, minor: 1, patch: 0)');
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
