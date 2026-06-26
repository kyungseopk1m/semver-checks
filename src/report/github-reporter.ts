import type { SemverReport } from '../types.js';

// Renders a SemverReport as GitHub Actions workflow commands. A confident
// (proven) breaking change is an `::error::`; a review-only (heuristic) major and
// a new feature are `::warning::` (distinguished by title), so they surface inline
// on the PR "Files changed" view and in the run summary.
export function githubReport(report: SemverReport): string {
  const lines: string[] = [];

  for (const c of report.changes) {
    if (c.severity === 'major' && c.confidence !== 'heuristic') {
      lines.push(`::error title=${escapeProperty(`Breaking change (${c.symbolPath})`)}::${escapeData(c.message)}`);
    } else if (c.severity === 'major') {
      lines.push(`::warning title=${escapeProperty(`Needs review (${c.symbolPath})`)}::${escapeData(c.message)}`);
    } else if (c.severity === 'minor') {
      lines.push(`::warning title=${escapeProperty(`New feature (${c.symbolPath})`)}::${escapeData(c.message)}`);
    }
  }

  lines.push(
    `::notice title=semver-checks::${escapeData(
      `Recommended bump: ${report.recommended.toUpperCase()} ` +
        `(major: ${report.summary.major} [confident: ${report.summary.majorProven}, review: ${report.summary.majorReview}], ` +
        `minor: ${report.summary.minor}, patch: ${report.summary.patch})`,
    )}`,
  );

  return lines.join('\n');
}

// GitHub workflow-command message escaping. Encoding \r and \n is also what
// prevents a change message from injecting a second `::command::` — a workflow
// command must occupy a single physical line, so with newlines encoded any
// literal `::error::` inside the message stays inert data on the same line.
function escapeData(value: string): string {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

// GitHub workflow-command property escaping (stricter: ':' and ',' delimit props).
function escapeProperty(value: string): string {
  return value
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A')
    .replace(/:/g, '%3A')
    .replace(/,/g, '%2C');
}
