import pc from 'picocolors';
import type { SemverReport } from '../types.js';

export function textReport(report: SemverReport): string {
  const lines: string[] = [];

  const bumpColor =
    report.recommended === 'major'
      ? pc.red(pc.bold('MAJOR'))
      : report.recommended === 'minor'
        ? pc.yellow(pc.bold('MINOR'))
        : pc.green(pc.bold('PATCH'));

  lines.push('');
  lines.push(`${pc.bold('semver-checks')} — Recommended bump: ${bumpColor}`);
  lines.push(`  ${pc.dim(`major: ${report.summary.major} (confident: ${report.summary.majorProven}, review: ${report.summary.majorReview})  minor: ${report.summary.minor}  patch: ${report.summary.patch}`)}`);

  if (report.changes.length === 0) {
    lines.push('');
    lines.push(pc.green('  ✓ No API changes detected'));
    lines.push('');
    return lines.join('\n');
  }

  // A proven major is a confident break (safe to gate on); a heuristic major is
  // one the analyzer could not prove safe and surfaces for human review.
  const proven = report.changes.filter((c) => c.severity === 'major' && c.confidence !== 'heuristic');
  const review = report.changes.filter((c) => c.severity === 'major' && c.confidence === 'heuristic');
  const minor = report.changes.filter((c) => c.severity === 'minor');

  const renderChange = (c: (typeof report.changes)[number], mark: string) => {
    lines.push(`  ${mark} ${c.message}`);
    if (c.oldValue && c.newValue) {
      lines.push(`      ${pc.dim('before:')} ${pc.strikethrough(c.oldValue)}`);
      lines.push(`      ${pc.dim('after: ')} ${c.newValue}`);
    } else if (c.oldValue) {
      lines.push(`      ${pc.dim('was:')} ${c.oldValue}`);
    } else if (c.newValue) {
      lines.push(`      ${pc.dim('now:')} ${c.newValue}`);
    }
  };

  if (proven.length > 0) {
    lines.push('');
    lines.push(pc.red(pc.bold('  Breaking Changes — confident (MAJOR)')));
    for (const c of proven) renderChange(c, pc.red('✗'));
  }

  if (review.length > 0) {
    lines.push('');
    lines.push(pc.yellow(pc.bold("  Needs review — couldn't prove safe (MAJOR)")));
    for (const c of review) renderChange(c, pc.yellow('?'));
  }

  if (minor.length > 0) {
    lines.push('');
    lines.push(pc.yellow(pc.bold('  New Features (MINOR)')));
    for (const c of minor) {
      lines.push(`  ${pc.yellow('+')} ${c.message}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}
