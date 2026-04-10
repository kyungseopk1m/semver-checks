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
  lines.push(`  ${pc.dim(`major: ${report.summary.major}  minor: ${report.summary.minor}  patch: ${report.summary.patch}`)}`);

  if (report.changes.length === 0) {
    lines.push('');
    lines.push(pc.green('  ✓ No API changes detected'));
    lines.push('');
    return lines.join('\n');
  }

  const major = report.changes.filter((c) => c.severity === 'major');
  const minor = report.changes.filter((c) => c.severity === 'minor');

  if (major.length > 0) {
    lines.push('');
    lines.push(pc.red(pc.bold('  Breaking Changes (MAJOR)')));
    for (const c of major) {
      lines.push(`  ${pc.red('✗')} ${c.message}`);
      if (c.oldValue && c.newValue) {
        lines.push(`      ${pc.dim('before:')} ${pc.strikethrough(c.oldValue)}`);
        lines.push(`      ${pc.dim('after: ')} ${c.newValue}`);
      } else if (c.oldValue) {
        lines.push(`      ${pc.dim('was:')} ${c.oldValue}`);
      } else if (c.newValue) {
        lines.push(`      ${pc.dim('now:')} ${c.newValue}`);
      }
    }
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
