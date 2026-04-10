import type { SemverReport } from '../types.js';

export function jsonReport(report: SemverReport): string {
  return JSON.stringify(report, null, 2);
}
