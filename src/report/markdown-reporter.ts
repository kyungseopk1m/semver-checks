import type { SemverReport, ApiChange } from '../types.js';

// Renders a SemverReport as GitHub-flavored Markdown, suitable for posting as a
// pull request comment or appending to $GITHUB_STEP_SUMMARY.
export function markdownReport(report: SemverReport): string {
  const lines: string[] = [];

  lines.push(`## semver-checks — recommended bump: \`${report.recommended.toUpperCase()}\``);
  lines.push('');
  lines.push(
    `**major:** ${report.summary.major} (confident: ${report.summary.majorProven}, review: ${report.summary.majorReview}) · **minor:** ${report.summary.minor} · **patch:** ${report.summary.patch}`,
  );
  lines.push('');

  if (report.changes.length === 0) {
    lines.push('✅ No API changes detected.');
    lines.push('');
    return lines.join('\n');
  }

  // A proven major is a confident break; a heuristic major could not be proven
  // safe and is surfaced for human review rather than gated by default.
  const proven = report.changes.filter((c) => c.severity === 'major' && c.confidence !== 'heuristic');
  const review = report.changes.filter((c) => c.severity === 'major' && c.confidence === 'heuristic');
  const minor = report.changes.filter((c) => c.severity === 'minor');

  if (proven.length > 0) {
    lines.push('### 🚨 Breaking changes — confident (MAJOR)');
    lines.push('');
    appendTable(lines, proven);
    lines.push('');
  }

  if (review.length > 0) {
    lines.push("### ⚠️ Needs review — couldn't prove safe (MAJOR)");
    lines.push('');
    appendTable(lines, review);
    lines.push('');
  }

  if (minor.length > 0) {
    lines.push('### ✨ New features (MINOR)');
    lines.push('');
    appendTable(lines, minor);
    lines.push('');
  }

  return lines.join('\n');
}

function appendTable(lines: string[], changes: ApiChange[]): void {
  lines.push('| Symbol | Change |');
  lines.push('| --- | --- |');
  for (const c of changes) {
    lines.push(`| ${codeSpan(escapeCell(c.symbolPath))} | ${escapeCell(c.message)} |`);
  }
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

// Wrap text in a Markdown code span. A code span delimited by N backticks may
// contain runs of up to N-1 backticks, so size the fence to one longer than the
// longest internal run and pad with a space when the content touches a backtick.
function codeSpan(text: string): string {
  const runs = text.match(/`+/g);
  const longest = runs ? Math.max(...runs.map((r) => r.length)) : 0;
  const fence = '`'.repeat(longest + 1);
  const pad = text.includes('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}
