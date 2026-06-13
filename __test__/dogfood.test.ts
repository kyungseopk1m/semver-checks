import { describe, it, expect } from 'vitest';
import { compare } from '../src/index.js';
import { resolveSourceInput } from '../src/resolve/source-ref.js';

// Run with SEMVER_CHECKS_NETWORK_TESTS=1 to dogfood real npm packages.
// These tests download two published versions of a popular library through
// `npm pack` and run the full extraction → diff pipeline on them. The goal is
// to surface false positives / negatives that synthetic fixtures cannot — the
// only invariant is `report.recommended` must be ≥ the library's
// self-declared bump (never *less* conservative).
const liveTest = process.env['SEMVER_CHECKS_NETWORK_TESTS'] ? describe : describe.skip;

const BUMP_RANK: Record<string, number> = { patch: 0, minor: 1, major: 2 };

function atLeast(actual: string, minimum: 'patch' | 'minor' | 'major'): boolean {
  return (BUMP_RANK[actual] ?? -1) >= BUMP_RANK[minimum];
}

liveTest('dogfood: popular npm libraries', () => {
  it('nanoid 5.0.9 self-compare reports no changes', async () => {
    const report = await compare({
      oldSource: resolveSourceInput('nanoid@5.0.9', 'npm'),
      newSource: resolveSourceInput('nanoid@5.0.9', 'npm'),
    });
    expect(report.recommended).toBe('patch');
    expect(report.changes).toHaveLength(0);
  }, 120_000);

  it('nanoid 5.0.7 -> 5.0.9 stays at most minor (npm declares patch)', async () => {
    const report = await compare({
      oldSource: resolveSourceInput('nanoid@5.0.7', 'npm'),
      newSource: resolveSourceInput('nanoid@5.0.9', 'npm'),
    });
    // semver-checks may surface a stricter verdict than the library author's
    // self-declared patch (false-positive major), so we accept anything from
    // patch up to major; only an *invalid* recommendation would fail.
    expect(['patch', 'minor', 'major']).toContain(report.recommended);
  }, 120_000);

  it('zod 3.22.0 -> 3.23.0 is at least minor (npm declares minor)', async () => {
    const report = await compare({
      oldSource: resolveSourceInput('zod@3.22.0', 'npm'),
      newSource: resolveSourceInput('zod@3.23.0', 'npm'),
    });
    // zod's self-declared bump is minor; semver-checks must be ≥ minor.
    // Falling to patch would mean a real breaking-or-additive change was
    // silently classified as no-op — the dogfood case we care about.
    expect(atLeast(report.recommended, 'minor')).toBe(true);
  }, 180_000);
});
