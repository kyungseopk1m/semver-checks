import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFromPath } from '../src/extract/ts-morph-backend.js';
import { diff } from '../src/compare/differ.js';
import { resolveConfidence } from '../src/classify/classifier.js';

// Inputs that used to take the whole process down rather than produce a verdict.
// Each fixture is a trimmed copy of the published declarations that crashed it.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures');

describe('extraction does not crash', () => {
  it('terminates on a namespace that re-exports its own merged function', () => {
    // `export { foo as default, foo }` inside `namespace foo` lists the namespace
    // itself among its exports, so walking the namespace body re-entered the same
    // declaration until the stack overflowed.
    const snap = extractFromPath(path.join(FIXTURES, 'crash-selfns-namespace', 'old'));
    expect(snap.entrypoints['.']).toHaveProperty('foo');
  });

  it('walks a self-exporting namespace merged across blocks only once', () => {
    // Each `declare namespace foo` block is its own declaration of the same
    // namespace. Guarding only the block being walked let the walk re-enter
    // through the other block, listing `foo.foo.foo` and `foo.default.default`.
    const snap = extractFromPath(path.join(FIXTURES, 'crash-selfns-merged-namespace', 'old'));
    expect(Object.keys(snap.entrypoints['.']).sort()).toEqual([
      'Opts',
      'default',
      'default.Opts',
      'default.default',
      'default.foo',
      'default.version',
      'foo',
      'foo.Opts',
      'foo.default',
      'foo.foo',
      'foo.version',
      'version',
    ]);
  });

  it('compares pino 10.3.1 to 10.4.0 without exhausting the heap', () => {
    // 10.4.0 added `export { pino as default, pino }` to the namespace, which drops
    // the implicit export of every other member, and made `ParseLogFnArgs` (a
    // recursive template-literal parser) non-exported. Printing it inline used to
    // expand it until the heap ran out.
    const dir = path.join(FIXTURES, 'crash-pino-namespace-export');
    const report = diff(extractFromPath(path.join(dir, 'old')), extractFromPath(path.join(dir, 'new')));
    expect(report.recommended).toBe('major');
    // A consumer writing `pino.TimeFn` stops compiling on 10.4.0 (TS2694).
    const timeFn = report.changes.find((c) => c.kind === 'export-removed' && c.symbolPath === 'TimeFn');
    expect(timeFn?.severity).toBe('major');
    expect(resolveConfidence(timeFn!)).toBe('proven');
    // `...args: ParseLogFnArgs<TMsg>` is too large to print on 10.4.0. It is
    // reported as not compared, never as a confident verdict either way.
    const logFn = report.changes.find((c) => c.symbolPath === 'LogFn');
    expect(logFn?.newValue).toContain('ParseLogFnArgs<TMsg> & any /* semver-checks: type too large to print');
    expect(resolveConfidence(logFn!)).toBe('heuristic');
  }, 120_000);

  it('reports an inferred type too large to print as not compared', () => {
    // The same recursive parser, reached through an inferred return type, so there
    // is no annotation to read instead. Both sides are identical, and still the
    // tool must not call them equal: it never saw either type.
    const dir = path.join(FIXTURES, 'crash-unprintable-inferred');
    const report = diff(extractFromPath(path.join(dir, 'old')), extractFromPath(path.join(dir, 'new')));
    const log = report.changes.find((c) => c.symbolPath === 'log');
    expect(log?.newValue).toContain('type too large to print, not compared');
    expect(resolveConfidence(log!)).toBe('heuristic');
  });

  it('never grades a heritage clause it could not print as a proven change', () => {
    // `J` extends `Base<ReturnType<typeof log<T>>>` and then `typeof log2<T>`, two
    // spellings of the same type that is too large to print. The clause texts
    // differ while the base name stays, which otherwise reads as a proven
    // re-parameterization of the base.
    const dir = path.join(FIXTURES, 'crash-heritage-unprintable');
    const report = diff(extractFromPath(path.join(dir, 'old')), extractFromPath(path.join(dir, 'new')));
    const j = report.changes.find((c) => c.kind === 'interface-heritage-changed' && c.symbolPath === 'J');
    expect(j).toBeDefined();
    expect(resolveConfidence(j!)).toBe('heuristic');
    expect(report.summary.majorProven).toBe(0);
  });

  it('picks a satisfied versioned types condition written before plain `types`', () => {
    // jotai 3 lists `types@>=5.5` first and points plain `types` at an empty
    // "upgrade TypeScript" stub. The compiler takes the first matching condition
    // in written order, so the versioned one is the surface it reads.
    const snap = extractFromPath(path.join(FIXTURES, 'crash-versioned-types-first', 'old'));
    expect(Object.keys(snap.entrypoints['.'])).toEqual(['realSurface']);
  });

  it('keeps that versioned condition ahead when it names a .d.mts', () => {
    // Candidates are otherwise sorted `.d.ts` first, which would put the stub
    // plain `types` back in front of a `types@>=5.5` written before it.
    const snap = extractFromPath(path.join(FIXTURES, 'crash-versioned-types-mts', 'old'));
    expect(Object.keys(snap.entrypoints['.'])).toEqual(['realSurface']);
  });
});
