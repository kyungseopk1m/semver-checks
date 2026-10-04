import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFromPath } from '../src/extract/ts-morph-backend.js';
import { diff } from '../src/compare/differ.js';
import { resolveConfidence } from '../src/classify/classifier.js';

// A declaration the TypeScript checker throws on while it is being converted.
// type-fest 5.7.0 `IntRange` was the live case: the name stayed exported with an
// identical declaration, but the conversion threw, the symbol was dropped, and
// the drop read as a proven `export-removed`.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, 'fixtures', 'unanalyzable-checker-crash');

describe('a symbol the checker cannot analyze', () => {
  it('is never reported as a proven change', () => {
    const report = diff(extractFromPath(path.join(DIR, 'old')), extractFromPath(path.join(DIR, 'new')));
    expect(report.changes.filter((c) => resolveConfidence(c) === 'proven')).toEqual([]);
    expect(report.changes.find((c) => c.kind === 'export-removed')).toBeUndefined();
    const huge = report.changes.find((c) => c.symbolPath === 'Huge');
    expect(huge?.newValue).toContain('& any /* semver-checks: type too large to print, not compared */');
  });

  it('compares equal to itself when the declaration is unchanged', () => {
    const snap = extractFromPath(path.join(DIR, 'new'));
    expect(Object.keys(snap.entrypoints['.']).sort()).toEqual(['Huge', 'Kept']);
    expect(diff(snap, extractFromPath(path.join(DIR, 'new'))).changes).toEqual([]);
  });
});
