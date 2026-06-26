import type { ApiSnapshot } from '../extract/api-snapshot.js';
import type { SemverReport, SemverBump } from '../types.js';
import { classifyChanges } from '../classify/classifier.js';

export function diff(oldSnap: ApiSnapshot, newSnap: ApiSnapshot): SemverReport {
  const changes = classifyChanges(oldSnap, newSnap);

  const summary = { major: 0, minor: 0, patch: 0, majorProven: 0, majorReview: 0 };
  for (const c of changes) {
    // The classifier only sets 'heuristic' explicitly; everything else is proven.
    if (!c.confidence) c.confidence = 'proven';
    summary[c.severity]++;
    if (c.severity === 'major') {
      if (c.confidence === 'heuristic') summary.majorReview++;
      else summary.majorProven++;
    }
  }

  // The recommendation stays conservative — any major (proven or review) still
  // recommends a major bump. The gate, not the recommendation, is what graded
  // confidence makes precise: `--strict` fails only on `majorProven`.
  const recommended: SemverBump =
    summary.major > 0 ? 'major' : summary.minor > 0 ? 'minor' : 'patch';

  return { changes, recommended, summary };
}
