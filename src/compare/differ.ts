import type { ApiSnapshot } from '../extract/api-snapshot.js';
import type { SemverReport, SemverBump } from '../types.js';
import { classifyChanges, resolveConfidence } from '../classify/classifier.js';

export function diff(oldSnap: ApiSnapshot, newSnap: ApiSnapshot): SemverReport {
  const changes = classifyChanges(oldSnap, newSnap);

  const summary = { major: 0, minor: 0, patch: 0, majorProven: 0, majorReview: 0 };
  for (const c of changes) {
    // Proven is earned, not inherited: a rule either computed its own confidence
    // or is on the classifier's proven allow-list. Anything else is review-only.
    if (!c.confidence) c.confidence = resolveConfidence(c);
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
