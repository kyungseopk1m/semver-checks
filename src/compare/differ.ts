import type { ApiSnapshot } from '../extract/api-snapshot.js';
import type { SemverReport, SemverBump } from '../types.js';
import { classifyChanges } from '../classify/classifier.js';

export function diff(oldSnap: ApiSnapshot, newSnap: ApiSnapshot): SemverReport {
  const changes = classifyChanges(oldSnap, newSnap);

  const summary = { major: 0, minor: 0, patch: 0 };
  for (const c of changes) summary[c.severity]++;

  const recommended: SemverBump =
    summary.major > 0 ? 'major' : summary.minor > 0 ? 'minor' : 'patch';

  return { changes, recommended, summary };
}
