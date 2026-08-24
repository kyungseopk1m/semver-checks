import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extractFromPath } from '../src/extract/ts-morph-backend.js';
import { diff } from '../src/compare/differ.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures');

function fixtureDir(name: string, side: 'old' | 'new'): string {
  return path.join(FIXTURES, name, side);
}

function ensureFixtureTsConfig(dir: string): void {
  const tsconfigPath = path.join(dir, 'tsconfig.json');
  if (!fs.existsSync(tsconfigPath)) {
    const template = path.join(FIXTURES, 'tsconfig.fixture.json');
    fs.copyFileSync(template, tsconfigPath);
  }
}

function compareFixture(fixtureName: string) {
  const oldDir = fixtureDir(fixtureName, 'old');
  const newDir = fixtureDir(fixtureName, 'new');
  ensureFixtureTsConfig(oldDir);
  ensureFixtureTsConfig(newDir);

  const oldSnap = extractFromPath(oldDir, 'index.ts');
  const newSnap = extractFromPath(newDir, 'index.ts');
  return diff(oldSnap, newSnap);
}

// Multi-entry fixtures rely on package.json "exports" auto-detection, so the
// entry is left unspecified (no explicit 'index.ts' override).
function compareExportsFixture(fixtureName: string) {
  const oldDir = fixtureDir(fixtureName, 'old');
  const newDir = fixtureDir(fixtureName, 'new');
  ensureFixtureTsConfig(oldDir);
  ensureFixtureTsConfig(newDir);
  const oldSnap = extractFromPath(oldDir);
  const newSnap = extractFromPath(newDir);
  return { report: diff(oldSnap, newSnap), oldSnap, newSnap };
}

describe('export changes', () => {
  it('detects removed export as MAJOR', () => {
    const report = compareFixture('export-removed');
    const removed = report.changes.find((c) => c.kind === 'export-removed' && c.symbolPath === 'foo');
    expect(removed).toBeDefined();
    expect(removed?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('detects added export as MINOR', () => {
    const report = compareFixture('export-added');
    const added = report.changes.find((c) => c.kind === 'export-added' && c.symbolPath === 'bar');
    expect(added).toBeDefined();
    expect(added?.severity).toBe('minor');
    expect(report.recommended).toBe('minor');
  });
});

describe('function parameter changes', () => {
  it('detects required param added as MAJOR', () => {
    const report = compareFixture('required-param-added');
    const change = report.changes.find((c) => c.kind === 'required-param-added');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('detects optional param added as MINOR', () => {
    const report = compareFixture('optional-param-added');
    const change = report.changes.find((c) => c.kind === 'optional-param-added');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('minor');
    expect(report.recommended).toBe('minor');
  });

  it('detects return type narrowed as MINOR (covariant, non-breaking)', () => {
    const report = compareFixture('return-type-narrowed');
    const change = report.changes.find((c) => c.kind === 'return-type-narrowed');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('minor');
    expect(report.changes.some((c) => c.kind === 'return-type-changed')).toBe(false);
    expect(report.recommended).toBe('minor');
  });

  it('detects return type widened as MAJOR (covariant break)', () => {
    const report = compareFixture('return-type-widened');
    const change = report.changes.find((c) => c.kind === 'return-type-changed');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('detects param type widened as MINOR (contravariant, non-breaking)', () => {
    const report = compareFixture('param-type-widened');
    const change = report.changes.find((c) => c.kind === 'param-type-widened');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('minor');
    expect(report.changes.some((c) => c.kind === 'param-type-changed')).toBe(false);
    expect(report.recommended).toBe('minor');
  });

  it('detects param type narrowed as MAJOR (contravariant break)', () => {
    const report = compareFixture('param-type-narrowed');
    const change = report.changes.find((c) => c.kind === 'param-type-changed');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('treats structurally equivalent param type as NO CHANGE (readonly T[] vs ReadonlyArray<T>)', () => {
    const report = compareFixture('param-type-equivalent');
    expect(report.changes.some((c) => c.kind === 'param-type-widened')).toBe(false);
    expect(report.changes.some((c) => c.kind === 'param-type-changed')).toBe(false);
    expect(report.recommended).toBe('patch');
  });

  it('keeps exported variable type narrowing as MAJOR (const/let unknown, may break consumers)', () => {
    const report = compareFixture('variable-type-narrowed');
    const change = report.changes.find((c) => c.kind === 'variable-type-changed');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('detects param removed as MAJOR', () => {
    const report = compareFixture('param-removed');
    const change = report.changes.find((c) => c.kind === 'param-removed');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });
});

describe('interface property changes', () => {
  it('detects property removed as MAJOR', () => {
    const report = compareFixture('property-removed');
    const change = report.changes.find((c) => c.kind === 'property-removed');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('detects required property added as MAJOR', () => {
    const report = compareFixture('required-property-added');
    const change = report.changes.find((c) => c.kind === 'required-property-added');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('detects optional property added as MINOR', () => {
    const report = compareFixture('optional-property-added');
    const change = report.changes.find((c) => c.kind === 'optional-property-added');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('minor');
    expect(report.recommended).toBe('minor');
  });

  it('detects property type changed as MAJOR', () => {
    const report = compareFixture('property-type-changed');
    const change = report.changes.find((c) => c.kind === 'property-type-changed');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });
});

describe('interface method changes', () => {
  it('detects interface method removed as MAJOR', () => {
    const report = compareFixture('interface-method-removed');
    const change = report.changes.find((c) => c.kind === 'interface-method-removed');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('detects required interface method added as MAJOR', () => {
    const report = compareFixture('interface-method-added');
    const change = report.changes.find((c) => c.kind === 'required-interface-method-added');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('detects optional interface method added as MINOR', () => {
    const report = compareFixture('interface-method-optional-added');
    const change = report.changes.find((c) => c.kind === 'interface-method-added');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('minor');
    expect(report.recommended).toBe('minor');
  });

  it('detects interface method signature changed as MAJOR', () => {
    const report = compareFixture('interface-method-changed');
    const change = report.changes.find((c) => c.kind === 'interface-method-signature-changed');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });
});

describe('enum changes', () => {
  it('detects enum member value changed as MAJOR', () => {
    const report = compareFixture('enum-member-value-changed');
    const change = report.changes.find((c) => c.kind === 'enum-member-value-changed');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('detects enum member removed as MAJOR', () => {
    const report = compareFixture('enum-member-removed');
    const change = report.changes.find((c) => c.kind === 'enum-member-removed');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('detects enum member added as MINOR', () => {
    const report = compareFixture('enum-member-added');
    const change = report.changes.find((c) => c.kind === 'enum-member-added');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('minor');
    expect(report.recommended).toBe('minor');
  });
});

describe('class changes', () => {
  it('detects class method signature changed as MAJOR', () => {
    const report = compareFixture('class-method-signature-changed');
    const change = report.changes.find((c) => c.kind === 'class-method-signature-changed');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('detects class property type changed as MAJOR', () => {
    const report = compareFixture('class-property-type-changed');
    const change = report.changes.find((c) => c.kind === 'class-property-type-changed');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('detects class method removed as MAJOR', () => {
    const report = compareFixture('class-method-removed');
    const change = report.changes.find((c) => c.kind === 'class-method-removed');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('detects class property removed as MAJOR', () => {
    const report = compareFixture('class-property-removed');
    const change = report.changes.find((c) => c.kind === 'class-property-removed');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('detects class constructor changed as MAJOR', () => {
    const report = compareFixture('class-constructor-changed');
    const change = report.changes.find((c) => c.kind === 'class-constructor-changed');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('detects class constructor optional→required param as MAJOR', () => {
    const report = compareFixture('class-constructor-optional-to-required');
    expect(report.changes.some((c) => c.kind === 'class-constructor-changed')).toBe(true);
    expect(report.changes.some((c) => c.kind === 'required-param-added')).toBe(true);
    expect(report.recommended).toBe('major');
  });

  it('detects class method added as MINOR', () => {
    const report = compareFixture('class-method-added');
    const change = report.changes.find((c) => c.kind === 'class-method-added');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('minor');
    expect(report.recommended).toBe('minor');
  });

  it('detects required class property added as MAJOR, review-only', () => {
    const report = compareFixture('class-property-added');
    const change = report.changes.find((c) => c.kind === 'required-class-property-added');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    // `Config` declares no private or protected member, so an object literal is a
    // legal `Config` and this addition breaks anyone holding one: compiling a
    // consumer that assigns `{ name: 'x' }` is clean on the old side and `TS2741`
    // on the new. The oracle used to score every instance of this kind a false
    // positive because the classes it met were nominal; grading on that is what
    // separates the two, and the nominal case is pinned under `graded confidence`.
    expect(change?.confidence).toBe('proven');
    expect(report.recommended).toBe('major');
  });

  it('treats an added static class property as an additive MINOR', () => {
    const report = compareFixture('class-static-property-added');
    const change = report.changes.find((c) => c.symbolPath === 'HttpError.DEFAULT_CODE');
    expect(change?.kind).toBe('class-property-added');
    expect(change?.severity).toBe('minor');
    expect(report.changes.some((c) => c.kind === 'required-class-property-added')).toBe(false);
    expect(report.recommended).toBe('minor');
  });

  it('detects optional class property added as MINOR', () => {
    const report = compareFixture('class-property-optional-added');
    const change = report.changes.find((c) => c.kind === 'class-property-added');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('minor');
    expect(report.recommended).toBe('minor');
  });
});

describe('generic parameter changes', () => {
  it('detects generic param removed as MAJOR', () => {
    const report = compareFixture('generic-param-removed');
    const change = report.changes.find((c) => c.kind === 'generic-param-removed');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('detects required generic param added as MAJOR', () => {
    const report = compareFixture('generic-param-required');
    const change = report.changes.find((c) => c.kind === 'generic-param-required');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('detects generic param with default added as MINOR', () => {
    const report = compareFixture('generic-param-with-default');
    const change = report.changes.find((c) => c.kind === 'generic-param-with-default');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('minor');
    expect(report.recommended).toBe('minor');
  });
});

describe('overload changes', () => {
  it('detects overload added as MINOR', () => {
    const report = compareFixture('overload-added');
    const change = report.changes.find((c) => c.kind === 'overload-added');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('minor');
    expect(report.recommended).toBe('minor');
  });

  it('detects overload removed as MAJOR', () => {
    const report = compareFixture('overload-removed');
    const change = report.changes.find((c) => c.kind === 'overload-removed');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('detects overload signature changed as MAJOR', () => {
    const report = compareFixture('overload-signature-changed');
    const change = report.changes.find((c) => c.kind === 'required-param-added' || c.kind === 'param-removed');
    expect(change).toBeDefined();
    expect(report.recommended).toBe('major');
  });

  // TypeScript resolves an overloaded call against the FIRST matching
  // signature in declaration order, and ReturnType<T> resolves against the
  // LAST signature, so reordering overloads is a breaking change even though
  // each signature's text is unchanged. Do not "fix" this to a no-op again;
  // see semver-checks history for the disjoint-overload consumer repro.
  it('detects a pure overload reorder as MAJOR (declaration order changes call resolution)', () => {
    const report = compareFixture('overload-reorder-is-major');
    // A pure reorder is compared position-by-position, so each overload is
    // diffed against the swapped-in sibling at its old slot: both surface as a
    // param type change plus its matching return type change.
    expect(report.changes.filter((c) => c.kind === 'param-type-changed' && c.symbolPath === 'parse.input')).toHaveLength(2);
    expect(report.changes.filter((c) => c.kind === 'return-type-changed' && c.symbolPath === 'parse')).toHaveLength(2);
    expect(report.changes).toHaveLength(4);
    expect(report.recommended).toBe('major');
  });

  // The other half of the overload story, and the reason index pairing had to
  // go: inserting an overload ahead of the existing ones shifts every later
  // signature into the wrong slot, so each gets diffed against a sibling it has
  // nothing to do with. Measured cost of that: 1251 proven majors on
  // ioredis 5.11.1 -> 6.0.0, and 22 on got 14.6.4 -> 14.6.5, a published patch.
  // Adding an overload is additive; the only change here is the addition.
  it('treats an overload inserted ahead of the existing ones as an additive MINOR', () => {
    const report = compareFixture('overload-inserted-at-front');
    expect(report.changes.filter((c) => c.kind === 'overload-added')).toHaveLength(1);
    expect(report.changes.filter((c) => c.severity === 'major')).toHaveLength(0);
    expect(report.recommended).toBe('minor');
  });

  // Measured on axios 1.16.1 -> 1.17.0: `toJSON(asStrings?: boolean)` gained two
  // narrower overloads ahead of it and stayed put as the last one. Charging a flat
  // cost for any mismatch ties all three candidates, so the alignment took the
  // first and reported a narrowed, newly-required parameter nobody ever saw.
  // Grading the substitution cost makes it pair with the sibling it actually
  // matches.
  it('aligns an old signature with the closest new overload, not merely the first', () => {
    const report = compareFixture('overload-added-aligns-to-closest');
    expect(report.changes.filter((c) => c.kind === 'overload-added')).toHaveLength(1);
    // The signature it should have paired with differs only in its return type.
    expect(report.changes.filter((c) => c.kind === 'return-type-narrowed')).toHaveLength(1);
    // The parameter is untouched in that pairing; pairing with the first overload
    // instead would report both of these.
    expect(report.changes.some((c) => c.kind === 'required-param-added')).toBe(false);
    expect(report.changes.some((c) => c.kind === 'param-type-changed')).toBe(false);
    expect(report.changes.filter((c) => c.severity === 'major')).toHaveLength(0);
    expect(report.recommended).toBe('minor');
  });

  it('treats an interface method overload inserted ahead of the existing ones as an additive MINOR', () => {
    const report = compareFixture('interface-method-overload-inserted-at-front');
    expect(report.changes.filter((c) => c.kind === 'overload-added')).toHaveLength(1);
    expect(report.changes.filter((c) => c.severity === 'major')).toHaveLength(0);
    expect(report.recommended).toBe('minor');
  });

  it('detects a pure interface method overload reorder as MAJOR (declaration order changes call resolution)', () => {
    const report = compareFixture('interface-method-overload-reorder-is-major');
    expect(report.changes.filter((c) => c.kind === 'interface-method-signature-changed' && c.symbolPath === 'Parser.parse')).toHaveLength(1);
    expect(report.changes.filter((c) => c.kind === 'param-type-changed' && c.symbolPath === 'Parser.parse.input')).toHaveLength(2);
    expect(report.changes.filter((c) => c.kind === 'return-type-changed' && c.symbolPath === 'Parser.parse')).toHaveLength(2);
    expect(report.changes).toHaveLength(5);
    expect(report.recommended).toBe('major');
  });

  // The disjoint case above (string/number) only changes ReturnType<T>: a call
  // with a concrete argument still matches the same overload regardless of
  // order. Here the parameter types overlap ('string' is assignable to
  // 'unknown'), so a string argument resolves against whichever overload
  // comes first, TypeScript's first-match rule actually picks a different
  // overload (and a different return type) after the swap, not just its
  // declared ReturnType<T>.
  it('detects an overlapping-signature overload reorder as MAJOR (a concrete call resolves to a different overload)', () => {
    const report = compareFixture('overload-reorder-overlapping-is-major');
    expect(report.changes.filter((c) => c.kind === 'param-type-widened' && c.symbolPath === 'overlap.x')).toHaveLength(1);
    expect(report.changes.filter((c) => c.kind === 'param-type-changed' && c.symbolPath === 'overlap.x')).toHaveLength(1);
    expect(report.changes.filter((c) => c.kind === 'return-type-changed' && c.symbolPath === 'overlap')).toHaveLength(2);
    expect(report.changes).toHaveLength(4);
    expect(report.recommended).toBe('major');
  });

  // Regular .ts class methods can't exercise this: getMethods() returns only
  // the merged implementation node, collapsing overloads to one signature (see
  // "ambient constructor overload extraction" above for the same ts-morph
  // quirk on constructors). An ambient `declare class` has no implementation
  // node, so each overload stays its own node and a reorder is observable.
  it('detects a class method overload reorder as MAJOR (ambient declaration, declaration order changes call resolution)', () => {
    const report = compareFixture('class-method-overload-reorder-is-major');
    expect(report.changes.filter((c) => c.kind === 'class-method-signature-changed' && c.symbolPath === 'Parser.parse')).toHaveLength(1);
    expect(report.changes.filter((c) => c.kind === 'param-type-widened' && c.symbolPath === 'Parser.parse.x')).toHaveLength(1);
    expect(report.changes.filter((c) => c.kind === 'param-type-changed' && c.symbolPath === 'Parser.parse.x')).toHaveLength(1);
    expect(report.changes.filter((c) => c.kind === 'return-type-changed' && c.symbolPath === 'Parser.parse')).toHaveLength(2);
    expect(report.changes).toHaveLength(5);
    expect(report.recommended).toBe('major');
  });

  it('detects a constructor overload reorder as MAJOR (declaration order changes call resolution)', () => {
    const report = compareFixture('class-constructor-overload-reorder-is-major');
    expect(report.changes.filter((c) => c.kind === 'class-constructor-changed' && c.symbolPath === 'Widget.constructor')).toHaveLength(2);
    expect(report.changes.filter((c) => c.kind === 'param-type-widened' && c.symbolPath === 'Widget.constructor.x')).toHaveLength(1);
    expect(report.changes.filter((c) => c.kind === 'param-type-changed' && c.symbolPath === 'Widget.constructor.x')).toHaveLength(1);
    expect(report.changes).toHaveLength(4);
    expect(report.recommended).toBe('major');
  });
});

describe('function-type variable edge cases', () => {
  it('detects rest param type changed as MAJOR (not misclassified as required-param-added)', () => {
    const report = compareFixture('function-type-rest-changed');
    // isRest=true means it should NOT be required-param-added; type change is MAJOR
    expect(report.changes.some((c) => c.kind === 'param-type-changed')).toBe(true);
    expect(report.changes.some((c) => c.kind === 'required-param-added')).toBe(false);
    expect(report.recommended).toBe('major');
  });

  it('detects generic removed from function-type variable as MAJOR', () => {
    const report = compareFixture('function-type-generic-changed');
    // return type changed (T → unknown) triggers major
    expect(report.recommended).toBe('major');
  });
});

describe('rest modifier changes', () => {
  it('detects rest modifier removed as MAJOR', () => {
    const report = compareFixture('rest-param-modifier-removed');
    const change = report.changes.find((c) => c.kind === 'param-type-changed' && c.message.includes('rest modifier'));
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.changes.some((c) => c.kind === 'optional-param-added')).toBe(false);
    expect(report.changes.some((c) => c.kind === 'required-param-added')).toBe(false);
    expect(report.recommended).toBe('major');
  });

  it('detects rest modifier added as MAJOR', () => {
    const report = compareFixture('rest-param-modifier-added');
    const change = report.changes.find((c) => c.kind === 'param-type-changed' && c.message.includes('rest modifier'));
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.changes.some((c) => c.kind === 'optional-param-added')).toBe(false);
    expect(report.changes.some((c) => c.kind === 'required-param-added')).toBe(false);
    expect(report.recommended).toBe('major');
  });

  it('does not double-report rest+type changes as optionality changes', () => {
    const report = compareFixture('rest-param-modifier-and-type-changed');
    const paramTypeChanges = report.changes.filter((c) => c.kind === 'param-type-changed' && c.symbolPath === 'join.parts');
    expect(paramTypeChanges).toHaveLength(1);
    expect(report.changes.some((c) => c.kind === 'optional-param-added')).toBe(false);
    expect(report.changes.some((c) => c.kind === 'required-param-added')).toBe(false);
    expect(report.recommended).toBe('major');
  });
});

describe('interface method optionality changes', () => {
  // A method-shaped member never reaches the property loop or the cross-form
  // reconciliation, so without an explicit optionality comparison in the method
  // loop this transition was a silent patch.
  it('detects optional-to-required method as MAJOR', () => {
    const report = compareFixture('interface-method-became-required');
    // Exactly one: a method-shaped member must not also be picked up by the property
    // or cross-form loop and reported twice.
    const matches = report.changes.filter(
      (c) => c.kind === 'interface-property-became-required' && c.symbolPath === 'Handler.onEvent',
    );
    expect(matches).toHaveLength(1);
    const change = matches[0];
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('detects required-to-optional method as MINOR', () => {
    const report = compareFixture('interface-method-became-optional');
    const matches = report.changes.filter(
      (c) => c.kind === 'interface-property-became-optional' && c.symbolPath === 'Handler.onEvent',
    );
    expect(matches).toHaveLength(1);
    const change = matches[0];
    expect(change?.severity).toBe('minor');
    expect(report.recommended).toBe('minor');
  });
});

describe('interface heritage changes', () => {
  // Inherited members are not flattened into properties/methods, so a dropped
  // `extends` clause moves no own-member and would otherwise report nothing.
  it('detects a removed extends clause as MAJOR (proven)', () => {
    // Proven without resolving the direction, because every direction has a
    // broken role: dropping a base breaks consumers who read the inherited
    // members, adding one breaks implementers, and a swap does both. An
    // interface exists to be implemented as well as consumed, which is the same
    // reason its member rules are proven and the class counterparts are not.
    const report = compareFixture('interface-heritage-removed');
    const change = report.changes.find(
      (c) => c.kind === 'interface-heritage-changed' && c.symbolPath === 'Node',
    );
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(change?.confidence).toBe('proven');
    expect(change?.oldValue).toBe('Base');
    expect(change?.newValue).toBe('(none)');
    expect(report.recommended).toBe('major');
  });

  it('does not fire on an interface that never had a heritage clause', () => {
    const report = compareFixture('interface-heritage-removed');
    expect(report.changes.some((c) => c.kind === 'interface-heritage-changed' && c.symbolPath === 'Base')).toBe(false);
  });

  // Canonicalization is the whole reason this classification is safe to ship, and it
  // runs on two axes. The syntactic one bites in practice: `compare pkg@latest .` puts
  // compiler-printed `.d.ts` on one side and hand-written source on the other, so a
  // reformat is all it takes. The semantic one is what makes heritage behave like
  // every other type position instead of like a text field: `Unioned`, `Arrayed` and
  // `Defaulting` are the spellings a syntactic printer alone still reads as a swapped
  // base.
  it('does not fire on formatting, ordering, alpha-renaming, a duplicated base, or an equivalent spelling', () => {
    const report = compareFixture('interface-heritage-noop');
    // Assert the premise. An empty `changes` filter is also what a fixture that lost
    // its `extends` clauses would produce, and the assertion would then be inert.
    const oldSnap = extractFromPath(fixtureDir('interface-heritage-noop', 'old'), 'index.ts');
    const withBases = Object.entries(oldSnap.entrypoints['.'])
      .filter(([, symbol]) => ((symbol as { heritage?: string[] }).heritage?.length ?? 0) > 0)
      .map(([symbolName]) => symbolName);
    expect(withBases).toEqual([
      'Reformatted',
      'Reordered',
      'Renamed',
      'Duplicated',
      'Quoted',
      'Interpolated',
      'Unioned',
      'Arrayed',
      'Defaulting',
    ]);
    expect(report.changes.filter((c) => c.kind === 'interface-heritage-changed')).toEqual([]);
  });

  // The other edge of the same canonicalization: spacing inside a string literal type
  // is part of the type. These three are what a naive quote-splitting normalizer
  // swallows — a plain literal, one with an escaped quote, and a backtick holding a
  // bare `"`. The distinction survives only as far as it does anywhere else in a
  // snapshot: a run of whitespace inside the literal is squeezed by
  // `normalizeTypeText`, so `"a,  b"` and `"a, b"` compare equal here exactly as they
  // do in a property annotation.
  it('fires when only the whitespace inside a string literal type argument differs', () => {
    const report = compareFixture('interface-heritage-string-literal');
    const fired = report.changes
      .filter((c) => c.kind === 'interface-heritage-changed')
      .map((c) => c.symbolPath)
      .sort();
    expect(fired).toEqual(['Backtick', 'Escaped', 'Tagged']);
    expect(report.recommended).toBe('major');
  });

  // An unresolvable base is the one path where the snapshot holds text the checker did
  // not produce, and it is reachable in ordinary use: `compare pkg@latest .` analyzes a
  // published tarball whose peer/optional types are simply not installed. The fallback
  // has to print the clause rather than slice it, or the formatting axis this
  // classification depends on reopens for exactly the packages hardest to analyze. It
  // also still has to tell two different unresolvable bases apart, which is why the
  // fallback exists at all rather than letting both collapse to `any`.
  it('separates reformatting from a real swap when the base is unresolvable', () => {
    const report = compareFixture('interface-heritage-unresolved-base');
    const fired = report.changes.filter((c) => c.kind === 'interface-heritage-changed');
    expect(fired.map((c) => c.symbolPath)).toEqual(['Swapped']);
    expect(fired[0]?.oldValue).toBe('MissingA');
    expect(fired[0]?.newValue).toBe('MissingB');

    // Assert the premise: the bases really are unresolvable, so the fallback ran. If
    // the fixture ever resolves, this test silently stops covering the fallback.
    const snap = extractFromPath(fixtureDir('interface-heritage-unresolved-base', 'old'), 'index.ts');
    expect((snap.entrypoints['.']['Node'] as { heritage?: string[] }).heritage).toEqual([
      'Missing<string, number>',
    ]);
  });

  // A class is a legal base for an interface, and until the snapshot carried a class's
  // own members the lookup could not read one. The two callers of that lookup fail in
  // opposite directions on a base they cannot resolve — a dropped base counts as a
  // loss, a member found on no base counts as gone — so a class base turned both of
  // these harmless refactors into a proven break.
  it('reads a class base when a clause drops it', () => {
    const report = compareFixture('class-base-empty-dropped-noop');
    const fired = report.changes.filter((c) => c.kind === 'interface-heritage-changed');
    expect(fired.map((c) => c.symbolPath)).toEqual(['Thing']);
    // The clause did change, so it is still reported; what the class base decides is
    // that nothing left with it, which is the difference between review-only and a
    // gate failure.
    expect(fired[0]?.confidence).toBe('heuristic');
  });

  // Reading a class base has to stop where the snapshot stops. A class can declare an
  // index signature, an interface extending it inherits one, and dropping that base
  // takes it away: compiled, a consumer reading an arbitrary key is clean on the old
  // side and `TS2339` on the new. `getMembers()` reports no index signature on a
  // class, so its existence is carried as its own flag and a base that has one is
  // still a loss.
  it('counts an index signature a class base carried', () => {
    const report = compareFixture('class-base-index-signature-dropped');
    const fired = report.changes.filter((c) => c.kind === 'interface-heritage-changed');
    expect(fired.map((c) => c.symbolPath)).toEqual(['Store']);
    expect(fired[0]?.confidence).toBe('proven');
  });

  it('reads a class base when a member is hoisted onto it', () => {
    const report = compareFixture('class-base-member-hoisted-noop');
    expect(report.changes.filter((c) => c.kind === 'property-removed')).toEqual([]);
    expect(report.changes.filter((c) => c.confidence === 'proven')).toEqual([]);
  });

  // `heritage` is optional for backward compatibility and `diff` is a public export
  // fed by persisted `semver_snapshot` output, so one side can genuinely lack the
  // field. Reading absent as "no bases" would report a removed clause for every
  // interface that has one. No fixture can reach this state, because the extractor
  // always writes the array, so the snapshot is edited directly.
  describe('against a snapshot that predates the field', () => {
    function snapshot(strip: boolean) {
      const dir = fixtureDir('interface-heritage-removed', 'old');
      ensureFixtureTsConfig(dir);
      const snap = extractFromPath(dir, 'index.ts');
      if (strip) {
        for (const symbol of Object.values(snap.entrypoints['.'])) {
          delete (symbol as { heritage?: string[] }).heritage;
        }
      }
      return snap;
    }

    it('stays silent when the old side has no heritage field', () => {
      const report = diff(snapshot(true), snapshot(false));
      expect(report.changes.filter((c) => c.kind === 'interface-heritage-changed')).toEqual([]);
    });

    it('stays silent when the new side has no heritage field', () => {
      const report = diff(snapshot(false), snapshot(true));
      expect(report.changes.filter((c) => c.kind === 'interface-heritage-changed')).toEqual([]);
    });

    it('has a live comparison to suppress in the first place', () => {
      // The premise of both: `Node extends Base` is present, so dropping the field on
      // either side is a difference the classifier would otherwise report.
      const snap = snapshot(false);
      expect((snap.entrypoints['.']['Node'] as { heritage?: string[] }).heritage).toEqual(['Base']);
      expect(diff(snapshot(true), snapshot(true)).changes).toEqual([]);
    });
  });
});

describe('interface property optionality changes', () => {
  it('detects optional-to-required property as MAJOR', () => {
    const report = compareFixture('interface-property-optional-to-required');
    const change = report.changes.find((c) => c.kind === 'interface-property-became-required');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('detects mutable-to-readonly property as MAJOR', () => {
    const report = compareFixture('interface-property-readonly-added');
    const change = report.changes.find((c) => c.kind === 'interface-property-became-readonly');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('detects readonly-to-mutable property as MINOR', () => {
    const report = compareFixture('interface-property-readonly-removed');
    const change = report.changes.find((c) => c.kind === 'interface-property-became-mutable');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('minor');
    expect(report.recommended).toBe('minor');
  });
});

describe('enum value implicit/explicit changes', () => {
  it('detects explicit-to-implicit enum value change as MAJOR', () => {
    const report = compareFixture('enum-member-value-explicit-to-implicit');
    const change = report.changes.find((c) => c.kind === 'enum-member-value-changed');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });
});

describe('class static/optional changes', () => {
  it('detects method instance-to-static as MAJOR', () => {
    const report = compareFixture('class-method-static-changed');
    const change = report.changes.find((c) => c.kind === 'class-method-became-static');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('detects property instance-to-static as MAJOR', () => {
    const report = compareFixture('class-property-static-changed');
    const change = report.changes.find((c) => c.kind === 'class-property-became-static');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('detects class property optional-to-required as MAJOR, review-only', () => {
    const report = compareFixture('class-property-optional-to-required');
    const change = report.changes.find((c) => c.kind === 'class-property-became-required');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    // Same asymmetry as required-class-property-added: classes are instantiated
    // and extended, not structurally re-implemented. The interface counterpart
    // stays proven.
    expect(change?.confidence).toBe('heuristic');
    // The narrowed write type IS proven, and it is a different break from this
    // transition: `w.label = undefined` stops compiling whether or not anyone
    // re-implements the class. So the fixture has a proven major, just not this
    // one. Asserting that keeps the asymmetry pinned without claiming the whole
    // fixture is review-only.
    expect(report.changes.filter((c) => c.confidence === 'proven').map((c) => c.kind)).toEqual([
      'class-property-type-changed',
    ]);
    expect(report.recommended).toBe('major');
  });

  it('detects class property mutable-to-readonly as MAJOR', () => {
    const report = compareFixture('class-property-readonly-added');
    const change = report.changes.find((c) => c.kind === 'class-property-became-readonly');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('detects class property readonly-to-mutable as MINOR', () => {
    const report = compareFixture('class-property-readonly-removed');
    const change = report.changes.find((c) => c.kind === 'class-property-became-mutable');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('minor');
    expect(report.recommended).toBe('minor');
  });
});

describe('constructor overload changes', () => {
  it('detects constructor overload signature changed as MAJOR', () => {
    const report = compareFixture('class-constructor-overload-changed');
    const change = report.changes.find((c) => c.kind === 'class-constructor-changed' || c.kind === 'required-param-added');
    expect(change).toBeDefined();
    expect(report.recommended).toBe('major');
  });
});

describe('constructor visibility changes', () => {
  it('detects a constructor narrowed to private as MAJOR', () => {
    const report = compareFixture('class-constructor-became-private');
    const change = report.changes.find((c) => c.kind === 'class-constructor-visibility-narrowed' && c.symbolPath === 'Singleton.constructor');
    expect(change).toBeDefined();
    expect(change?.oldValue).toBe('public');
    expect(change?.newValue).toBe('private');
    expect(report.recommended).toBe('major');
  });

  it('detects a constructor narrowed to protected as MAJOR', () => {
    const report = compareFixture('class-constructor-became-protected');
    const change = report.changes.find((c) => c.kind === 'class-constructor-visibility-narrowed');
    expect(change).toBeDefined();
    expect(change?.newValue).toBe('protected');
    expect(report.recommended).toBe('major');
  });

  it('detects a private constructor widened to public as MINOR, not breaking', () => {
    const report = compareFixture('class-constructor-private-to-public');
    const change = report.changes.find((c) => c.kind === 'class-constructor-visibility-widened');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('minor');
    expect(report.recommended).not.toBe('major');
  });

  it('detects a protected constructor widened to public as MINOR, not breaking', () => {
    const report = compareFixture('class-constructor-protected-to-public');
    const change = report.changes.find((c) => c.kind === 'class-constructor-visibility-widened');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('minor');
    expect(report.recommended).not.toBe('major');
  });

  it('treats private-to-protected as a widening (MINOR): protected is reachable from subclasses', () => {
    const report = compareFixture('class-constructor-private-to-protected');
    const change = report.changes.find((c) => c.kind === 'class-constructor-visibility-widened');
    expect(change).toBeDefined();
    expect(change?.oldValue).toBe('private');
    expect(change?.newValue).toBe('protected');
    expect(report.recommended).not.toBe('major');
  });

  it('treats protected-to-private as a narrowing (MAJOR): subclass call sites break', () => {
    const report = compareFixture('class-constructor-protected-to-private');
    const change = report.changes.find((c) => c.kind === 'class-constructor-visibility-narrowed');
    expect(change).toBeDefined();
    expect(change?.oldValue).toBe('protected');
    expect(change?.newValue).toBe('private');
    expect(report.recommended).toBe('major');
  });

  it('treats explicit `public constructor` and unmodified `constructor` as equivalent (no changes)', () => {
    const report = compareFixture('class-constructor-explicit-public-noop');
    expect(report.changes).toHaveLength(0);
  });

  it('detects the private-constructor-plus-static-factory pattern as MAJOR (previously under-reported as MINOR)', () => {
    const report = compareFixture('class-constructor-private-with-static-create');
    const change = report.changes.find((c) => c.kind === 'class-constructor-visibility-narrowed');
    expect(change).toBeDefined();
    expect(report.recommended).toBe('major');
  });

  it('detects an implicit (public) constructor replaced by an explicit private one as MAJOR', () => {
    const report = compareFixture('class-constructor-implicit-to-private');
    const change = report.changes.find((c) => c.kind === 'class-constructor-visibility-narrowed');
    expect(change).toBeDefined();
    expect(change?.oldValue).toBe('public');
    expect(change?.newValue).toBe('private');
    expect(report.recommended).toBe('major');
  });

  // A class with no explicit constructor AND a heritage clause (`extends`, in
  // any form) has its real constructor inherited from a base we deliberately
  // do not resolve (see hasHeritageClause / constructorUnknown in the
  // extractor): reading the ancestor's declaration node directly can't account
  // for the derived class's actual type arguments and has no node to read at
  // all for a class-expression or mixin base. So `Derived` here is UNKNOWN on
  // the old side (no explicit constructor, extends ProtectedBase) and known on
  // the new side (explicit constructor) — an asymmetric pair, which the
  // classifier skips outright rather than emit a one-sided diff. `no changes`
  // is the same expectation the old inheritance-resolving code produced, but
  // for a different reason: this used to be a *proven* no-op (Derived's
  // effective constructor really does match ProtectedBase's), it's now a
  // silence born of not knowing, not of having checked.
  it('skips the comparison when one side has no explicit constructor and a heritage clause (no changes)', () => {
    const report = compareFixture('class-constructor-inherited-visibility-noop');
    expect(report.changes).toHaveLength(0);
  });

  // An implicit constructor and an explicit `public constructor() {}` are
  // identical from every external call site (`new Foo()` compiles either way),
  // so neither direction should register as an overload added/removed. Neither
  // fixture class has a heritage clause, so this is the *proven* no-op case
  // (constructorUnknown is never set), unlike the inherited-* fixtures below.
  it('treats no explicit constructor and an explicit public zero-arg constructor as equivalent (no changes)', () => {
    const report = compareFixture('class-constructor-implicit-public-noop');
    expect(report.changes).toHaveLength(0);
  });

  it('treats an explicit public zero-arg constructor and no explicit constructor as equivalent (no changes)', () => {
    const report = compareFixture('class-constructor-explicit-to-implicit-noop');
    expect(report.changes).toHaveLength(0);
  });

  // Same asymmetric-UNKNOWN shape as the visibility-noop case above, this time
  // over the constructor signature: Derived has no explicit constructor on
  // either side but Base's does differ (constructor 1 vs constructor 2 has a
  // parameter). Old Derived is UNKNOWN either way (it extends Base with no
  // explicit constructor on both sides), so this one is symmetric-UNKNOWN, not
  // asymmetric — included here because it exercises the same "no explicit
  // constructor + extends" skip path from the signature-comparison side.
  it('skips the comparison when one side has no explicit constructor and a heritage clause matching the base signature (no changes)', () => {
    const report = compareFixture('class-constructor-inherited-signature-noop');
    expect(report.changes).toHaveLength(0);
  });

  // Base's own constructor changes (value: string -> number); Derived has no
  // explicit constructor on either side, so Derived is UNKNOWN both before and
  // after and the classifier skips its comparison — it does NOT walk up to
  // Base to re-check Derived's effective signature (that inheritance-tracking
  // is exactly what this release removed, see hasHeritageClause). Base itself
  // has no heritage clause, so Base's own constructor is fully known and its
  // change still surfaces normally.
  it('reports the base class constructor change directly, without propagating it to a derived class with no explicit constructor', () => {
    const report = compareFixture('class-constructor-inherited-signature-changed');
    const baseChange = report.changes.find((c) => c.kind === 'class-constructor-changed' && c.symbolPath === 'Base.constructor');
    expect(baseChange).toBeDefined();
    expect(baseChange?.oldValue).toBe('value: string');
    expect(baseChange?.newValue).toBe('value: number');
    expect(report.changes.some((c) => c.symbolPath === 'Derived.constructor')).toBe(false);
    expect(report.changes).toHaveLength(2); // class-constructor-changed + its param-type-changed sub-change
    expect(report.recommended).toBe('major');
  });

  // Same shape through an extra layer: Root has no constructor and no
  // heritage clause (known, implicit public); Mid has an explicit constructor
  // and extends Root, so Mid is fully known and its own signature change
  // (value: string -> number) surfaces directly; Leaf has no explicit
  // constructor and extends Mid, so Leaf is UNKNOWN on both sides and its
  // comparison is skipped — it is not resolved through Mid.
  it('reports the intermediate class constructor change directly, without propagating it to a derived class with no explicit constructor', () => {
    const report = compareFixture('class-constructor-multi-level-inherited-signature-changed');
    const midChange = report.changes.find((c) => c.kind === 'class-constructor-changed' && c.symbolPath === 'Mid.constructor');
    expect(midChange).toBeDefined();
    expect(midChange?.oldValue).toBe('value: string');
    expect(midChange?.newValue).toBe('value: number');
    expect(report.changes.some((c) => c.symbolPath === 'Leaf.constructor')).toBe(false);
    expect(report.changes).toHaveLength(2); // class-constructor-changed + its param-type-changed sub-change
    expect(report.recommended).toBe('major');
  });

  // Both visibility and signature together, same asymmetric-UNKNOWN shape as
  // the visibility-noop case: old Derived has no explicit constructor
  // (UNKNOWN, extends Base), new Derived has a matching explicit one (known).
  it('skips the comparison when one side has no explicit constructor and a heritage clause matching both the base visibility and signature (no changes)', () => {
    const report = compareFixture('class-constructor-inherited-visibility-and-signature-noop');
    expect(report.changes).toHaveLength(0);
  });

  // Overload set changes on Base (a: number -> a: boolean); Derived has no
  // explicit constructor on either side (UNKNOWN both sides, extends Base) so
  // its comparison is skipped — Derived's effective overload set is not
  // resolved through Base. Base has no heritage clause, so its own overload
  // change is fully known and surfaces normally.
  it('reports the base class constructor overload change directly, without propagating it to a derived class with no explicit constructor', () => {
    const report = compareFixture('class-constructor-inherited-overload-changed');
    const baseChange = report.changes.find((c) => c.kind === 'class-constructor-changed' && c.symbolPath === 'Base.constructor');
    expect(baseChange).toBeDefined();
    expect(report.changes.some((c) => c.symbolPath === 'Derived.constructor')).toBe(false);
    expect(report.changes).toHaveLength(2); // class-constructor-changed + its param-type-changed sub-change
    expect(report.recommended).toBe('major');
  });

  // A generic base's constructor can't be read off its declaration node without
  // instantiating it at the derived class's actual type argument (`Base<T>`'s
  // node only ever says `x: T`, never `x: string` or `x: number`), so Derived
  // is UNKNOWN here regardless of which type argument it supplies. Base's own
  // constructor is unchanged (still `x: T` on both sides), so this is silent
  // end to end. Confirmed with tsc below: `new Derived("s")` compiles against
  // old, fails TS2345 against new — this is a real breaking change we choose
  // not to report rather than risk a wrong one.
  it('skips a generic base whose type argument changes (no changes; a real break goes unreported by design)', () => {
    const report = compareFixture('class-constructor-generic-base-typearg-changed');
    expect(report.changes).toHaveLength(0);
  });

  // Companion case: the type ARGUMENT is unchanged (`Base<string>` both sides),
  // only the base's type PARAMETER name changes (T -> U). Derived is UNKNOWN
  // either way (no explicit constructor, extends Base), so this is silent for
  // the same "can't resolve" reason as the case above — not because the
  // classifier proved the rename harmless. Before this release, the recursive
  // resolver copied Base's `x: T` text onto Derived and compared it against
  // `x: U` using Derived's own (empty) type parameter scope, which can't
  // recognize the T->U rename, producing a false MAJOR.
  it('skips a generic base whose type parameter is merely renamed (no changes; previously a false MAJOR)', () => {
    const report = compareFixture('class-constructor-generic-base-typeparam-renamed');
    expect(report.changes).toHaveLength(0);
  });

  // A class-expression base has no ClassDeclaration node to read a
  // constructor off at all. Derived (no explicit constructor, extends Base)
  // is UNKNOWN regardless of what Base's own constructor looks like.
  it('skips a class-expression base (no changes)', () => {
    const report = compareFixture('class-constructor-class-expression-base');
    expect(report.changes).toHaveLength(0);
  });

  // Same reasoning through a mixin: `extends Mixin(Root)` is a call
  // expression, not a name, so there is no declaration node to walk to.
  // Derived (no explicit constructor) is UNKNOWN even though `Root`, the
  // mixin's actual base, is fully resolvable on its own.
  it('skips a mixin (call-expression) base (no changes)', () => {
    const report = compareFixture('class-constructor-mixin-base');
    expect(report.changes).toHaveLength(0);
  });

  // Asymmetric UNKNOWN, general case (not tied to a specific matching
  // visibility/signature like the noop fixtures above): old Derived has an
  // explicit constructor (known), new Derived has none and only extends Base
  // (UNKNOWN). Comparing them would read as the constructor overload/signature
  // vanishing. The guard must check EITHER side, so Derived produces nothing;
  // Base has no heritage clause of its own, so its real constructor change
  // still surfaces normally.
  it('skips when the old side has an explicit constructor and the new side has only a heritage clause (no changes on Derived)', () => {
    const report = compareFixture('class-constructor-asymmetric-explicit-to-heritage-only');
    const baseChange = report.changes.find((c) => c.kind === 'class-constructor-changed' && c.symbolPath === 'Base.constructor');
    expect(baseChange).toBeDefined();
    expect(report.changes.some((c) => c.symbolPath === 'Derived.constructor')).toBe(false);
    expect(report.changes).toHaveLength(2); // class-constructor-changed + its param-type-changed sub-change
    expect(report.recommended).toBe('major');
  });

  // Mirror image: old Derived has only a heritage clause (UNKNOWN), new
  // Derived has an explicit constructor (known). Proves the guard is
  // symmetric — it is not enough to check only oldCls or only newCls.
  it('skips when the old side has only a heritage clause and the new side has an explicit constructor (no changes on Derived)', () => {
    const report = compareFixture('class-constructor-asymmetric-heritage-only-to-explicit');
    const baseChange = report.changes.find((c) => c.kind === 'class-constructor-changed' && c.symbolPath === 'Base.constructor');
    expect(baseChange).toBeDefined();
    expect(report.changes.some((c) => c.symbolPath === 'Derived.constructor')).toBe(false);
    expect(report.changes).toHaveLength(2); // class-constructor-changed + its param-type-changed sub-change
    expect(report.recommended).toBe('major');
  });

  // A heritage clause does not, by itself, make a constructor unknown — only
  // the ABSENCE of an explicit constructor does. Derived here has an explicit
  // constructor on both sides (and extends Base), so it's fully known and a
  // real visibility narrowing is still caught, same as the extends-less case
  // above (class-constructor-implicit-to-private).
  it('detects a visibility narrowing on a derived class that has an explicit constructor on both sides as MAJOR', () => {
    const report = compareFixture('class-constructor-heritage-both-explicit-narrowed');
    const change = report.changes.find((c) => c.kind === 'class-constructor-visibility-narrowed' && c.symbolPath === 'Derived.constructor');
    expect(change).toBeDefined();
    expect(change?.oldValue).toBe('public');
    expect(change?.newValue).toBe('private');
    expect(report.changes).toHaveLength(1);
    expect(report.recommended).toBe('major');
  });

  // `implements` is not `extends`: it says nothing about the constructor
  // (interfaces have no runtime construct behavior to inherit), so a class
  // with only an `implements` clause and no explicit constructor is exactly
  // as determinable as one with no heritage clause at all — known, implicit,
  // public, zero-arg. If `implements` were mistaken for heritage here, this
  // would wrongly go UNKNOWN and stay silent instead of catching the
  // narrowing.
  it('does not treat an implements-only clause as a heritage clause (still detects the narrowing)', () => {
    const report = compareFixture('class-constructor-implements-only-narrowed');
    const change = report.changes.find((c) => c.kind === 'class-constructor-visibility-narrowed' && c.symbolPath === 'Widget.constructor');
    expect(change).toBeDefined();
    expect(change?.oldValue).toBe('public');
    expect(change?.newValue).toBe('private');
    expect(report.changes).toHaveLength(1);
    expect(report.recommended).toBe('major');
  });
});

describe('ambient constructor overload extraction', () => {
  // Ambient declarations (`declare class`, .d.ts) have no constructor
  // implementation node, so ts-morph's getConstructors() already returns one
  // node per overload. Calling getOverloads() on each of those nodes again
  // (as done for the implemented case, where getConstructors() collapses to a
  // single implementation node) re-returns the whole overload group each time
  // and silently doubles the extracted signature count.
  it('extracts each ambient constructor overload exactly once (no duplication)', () => {
    const dir = fixtureDir('class-constructor-ambient-overloads', 'old');
    ensureFixtureTsConfig(dir);
    const snap = extractFromPath(dir, 'index.ts');
    const foo = snap.entrypoints['.']['Foo'] as { constructorSignatures: Array<{ parameters: Array<{ type: { text: string } }> }> };
    expect(foo.constructorSignatures).toHaveLength(2);
    expect(foo.constructorSignatures.map((s) => s.parameters[0]?.type.text)).toEqual(['string', 'number']);
  });
});

describe('interface method overload extraction', () => {
  it('detects interface method overload removed as MAJOR', () => {
    const report = compareFixture('interface-method-overload-removed');
    const change = report.changes.find((c) => c.kind === 'overload-removed' || c.kind === 'param-removed');
    expect(change).toBeDefined();
    expect(report.recommended).toBe('major');
  });

  it('detects interface method generic param added as MAJOR', () => {
    const report = compareFixture('interface-method-generic-param-added');
    const change = report.changes.find((c) => c.kind === 'generic-param-required');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });
});

describe('import type normalization', () => {
  it('does not false-positive on re-exported types from another file', () => {
    const report = compareFixture('import-type-reexport');
    expect(report.changes).toHaveLength(0);
    expect(report.recommended).toBe('patch');
  });
});

describe('generic constraint changes', () => {
  it('detects generic constraint changed as MAJOR', () => {
    const report = compareFixture('generic-constraint-changed');
    const change = report.changes.find((c) => c.kind === 'generic-constraint-changed');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('detects class method generic constraint changed as MAJOR', () => {
    const report = compareFixture('class-method-generic-constraint-changed');
    const change = report.changes.find((c) => c.kind === 'generic-constraint-changed');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });
});

describe('type alias and variable changes', () => {
  it('detects type alias changed as MAJOR', () => {
    const report = compareFixture('type-alias-changed');
    const change = report.changes.find((c) => c.kind === 'type-alias-changed');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('detects variable type changed as MAJOR', () => {
    const report = compareFixture('variable-type-changed');
    const change = report.changes.find((c) => c.kind === 'variable-type-changed');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('does not flag equivalent union member reordering', () => {
    const report = compareFixture('type-alias-union-reordered');
    expect(report.changes).toHaveLength(0);
    expect(report.recommended).toBe('patch');
  });

  it('still detects grouped type alias changes when parentheses matter', () => {
    const report = compareFixture('type-alias-grouping-changed');
    const change = report.changes.find((c) => c.kind === 'type-alias-changed');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });
});

// False-positive reductions that make the tool usable on real-world libraries
// without crying wolf on routine, non-breaking refactors. Each retains the
// breaking-case counterpart so the relaxation stays sound (no new false negative).
describe('false-positive reduction (real-world refactors)', () => {
  it('treats type-alias -> interface with the same shape as NO CHANGE', () => {
    const report = compareFixture('type-alias-to-interface-noop');
    // Was reported as export-removed (changed kind) — a clear false positive on a
    // routine refactor. Member types reference a package-internal type that does
    // not resolve standalone, so this exercises the canonical member-set path.
    expect(report.changes.some((c) => c.symbolPath === 'RefinementCtx')).toBe(false);
    expect(report.recommended).toBe('patch');
  });

  it('keeps type-alias -> interface MAJOR when the shape is incompatible', () => {
    const report = compareFixture('type-alias-to-interface-incompatible');
    const change = report.changes.find((c) => c.kind === 'export-removed' && c.symbolPath === 'Cfg');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  // Write-side guard: structural assignability is blind to readonly, so an
  // assignability-only equivalence check would erase this. The canonical member
  // set keeps `readonly` visible, so the conversion stays breaking.
  it('keeps type-alias -> interface MAJOR when a property becomes readonly', () => {
    const report = compareFixture('type-alias-to-interface-readonly-added');
    expect(report.changes.some((c) => c.symbolPath === 'T')).toBe(true);
    expect(report.recommended).toBe('major');
  });

  it('treats a type-alias -> interface with the same index signature as NO CHANGE', () => {
    const report = compareFixture('type-alias-to-interface-index-sig-noop');
    // The index key name is arbitrary (`[k: string]` vs `[key: string]`), so this
    // is a no-op refactor.
    expect(report.changes.some((c) => c.symbolPath === 'Dict')).toBe(false);
    expect(report.recommended).toBe('patch');
  });

  it('keeps type-alias -> interface MAJOR when the interface extends a base', () => {
    // Inherited members aren't captured, so own-member equality ({} vs {}) cannot
    // prove shape equivalence — the extends clause forces a conservative major.
    const report = compareFixture('type-alias-to-interface-heritage');
    const change = report.changes.find((c) => c.kind === 'export-removed' && c.symbolPath === 'Options');
    expect(change).toBeDefined();
    expect(report.recommended).toBe('major');
  });

  it('keeps type-alias -> interface MAJOR when a type-parameter constraint narrows', () => {
    // Same member shape, but `<T extends string>` -> `<T extends number>` is a real
    // break (`Box<"a">` no longer type-checks). The kind-change shortcut must still
    // run the type-parameter diff instead of returning no changes.
    const report = compareFixture('type-alias-to-interface-constraint-narrowed');
    const change = report.changes.find((c) => c.kind === 'generic-constraint-changed' && c.symbolPath === 'Box');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('treats a structurally equivalent generic default rewrite as NO CHANGE', () => {
    const report = compareFixture('generic-default-equivalent-rewrite');
    // ReadonlyArray<string> <-> readonly string[] are mutually assignable.
    expect(report.changes.some((c) => c.kind === 'generic-param-default-changed')).toBe(false);
    expect(report.recommended).toBe('patch');
  });

  it('keeps a generic default changed to any MAJOR (no unsound any-widening shortcut)', () => {
    // unknown -> any inside a conditional type can widen the omitting consumer's
    // resolved output; there is no `any`-widening relaxation, so this stays major.
    const report = compareFixture('generic-default-any-conditional');
    const change = report.changes.find((c) => c.kind === 'generic-param-default-changed');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('still flags a concrete generic default narrowing (string -> number) as MAJOR', () => {
    // Companion to the widening case: the 13th-cycle tsc-proven breaking change
    // must survive the relaxation.
    const report = compareFixture('generic-param-default-changed');
    const change = report.changes.find((c) => c.kind === 'generic-param-default-changed');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });
});

describe('static and instance same-name coexistence', () => {
  it('detects class method changes without collapsing static and instance methods', () => {
    const report = compareFixture('class-method-static-instance-coexistence');
    // Only the instance `parse` changed; the static `parse` overload is
    // untouched in the fixture, so pinning symbolPath (not just kind) proves
    // the two same-named members weren't merged into one comparison.
    expect(report.changes.filter((c) => c.kind === 'class-method-signature-changed' && c.symbolPath === 'Parser.parse')).toHaveLength(1);
    expect(report.changes.filter((c) => c.kind === 'param-type-changed' && c.symbolPath === 'Parser.parse.input')).toHaveLength(1);
    expect(report.changes.some((c) => c.kind === 'class-method-added')).toBe(false);
    expect(report.changes.some((c) => c.kind === 'class-method-removed')).toBe(false);
    expect(report.changes).toHaveLength(2);
    expect(report.recommended).toBe('major');
  });

  it('detects class property changes without collapsing static and instance properties', () => {
    const report = compareFixture('class-property-static-instance-coexistence');
    expect(report.changes.some((c) => c.kind === 'class-property-type-changed')).toBe(true);
    expect(report.changes.some((c) => c.kind === 'class-property-added')).toBe(false);
    expect(report.changes.some((c) => c.kind === 'required-class-property-added')).toBe(false);
    expect(report.changes.some((c) => c.kind === 'class-property-removed')).toBe(false);
    expect(report.recommended).toBe('major');
  });
});

// The legacy CJS / DefinitelyTyped shape: the package exports nothing from its
// entry file and declares its whole surface in `declare module 'pkg' { ... }`
// instead. Extraction used to return `{}` for these, which meant every such
// package compared as a clean `patch` — mongoose 8 -> 9 (a real major) passed
// `--strict` silently.
describe('ambient declare module', () => {
  it('extracts the package surface from ambient module blocks across files', () => {
    const snap = extractFromPath(fixtureDir('ambient-module-member-removed', 'old'), 'index.ts');
    const symbols = snap.entrypoints['.'];
    expect(Object.keys(symbols).sort()).toEqual(['fromOtherFile', 'goes', 'stay']);
  });

  it('does not leak an augmentation of another package into the surface', () => {
    const snap = extractFromPath(fixtureDir('ambient-module-member-removed', 'old'), 'index.ts');
    expect(snap.entrypoints['.']['unrelated']).toBeUndefined();
  });

  it('detects a member removed from an ambient module as MAJOR', () => {
    const report = compareFixture('ambient-module-member-removed');
    const change = report.changes.find((c) => c.kind === 'export-removed' && c.symbolPath === 'goes');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });
});

describe('namespace and enum accuracy', () => {
  it('detects changes inside an exported namespace (no false negative)', () => {
    const report = compareFixture('namespace-member-removed');
    const removed = report.changes.find(
      (c) => c.kind === 'interface-method-removed' && c.symbolPath.includes('Foo.Bar'),
    );
    expect(removed).toBeDefined();
    expect(removed?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('detects string enum member value change as MAJOR', () => {
    const report = compareFixture('enum-member-string-value-changed');
    const change = report.changes.find((c) => c.kind === 'enum-member-value-changed');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('treats structurally equivalent type alias as NO CHANGE (readonly T[] vs ReadonlyArray<T>)', () => {
    const report = compareFixture('type-alias-equivalent');
    expect(report.changes.some((c) => c.kind === 'type-alias-changed')).toBe(false);
    expect(report.recommended).toBe('patch');
  });
});

describe('variance false-negative regressions (independent verification)', () => {
  // P0-A: `any` is bidirectionally assignable, must NOT be treated as equivalent.
  it('keeps type alias any -> concrete as MAJOR (not erased as equivalent)', () => {
    const report = compareFixture('type-alias-any-to-concrete');
    const change = report.changes.find((c) => c.kind === 'type-alias-changed');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('keeps return type any -> concrete as MAJOR (not narrowed to minor)', () => {
    const report = compareFixture('return-type-any-to-concrete');
    const change = report.changes.find((c) => c.kind === 'return-type-changed');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.changes.some((c) => c.kind === 'return-type-narrowed')).toBe(false);
    expect(report.recommended).toBe('major');
  });

  // P0-B: rest <-> non-rest is an arity-contract break, even when the type widens.
  it('keeps rest -> non-rest array as MAJOR even when the element type widens', () => {
    const report = compareFixture('rest-param-widened-to-array');
    const change = report.changes.find(
      (c) => c.kind === 'param-type-changed' && c.message.includes('rest modifier'),
    );
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.changes.some((c) => c.kind === 'param-type-widened')).toBe(false);
    expect(report.recommended).toBe('major');
  });

  // P0-C: function + namespace declaration merging must not drop namespace members.
  it('detects changes in a namespace merged with a function (no false negative)', () => {
    const report = compareFixture('namespace-merged-function');
    const removed = report.changes.find(
      (c) => c.kind === 'interface-method-removed' && c.symbolPath.includes('F.Options'),
    );
    expect(removed).toBeDefined();
    expect(removed?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  // P2-E: a safe return narrowing inside an interface method must stay MINOR.
  it('reports interface method return narrowing as MINOR (wrapper not forced to major)', () => {
    const report = compareFixture('interface-method-return-narrowed');
    expect(report.changes.some((c) => c.kind === 'return-type-narrowed')).toBe(true);
    expect(report.changes.some((c) => c.severity === 'major')).toBe(false);
    expect(report.recommended).toBe('minor');
  });
});

describe('advanced type structure comparison (regression + alpha-rename)', () => {
  // Regression guard: ts-morph already normalises trailing separators / outer
  // parens / object-literal whitespace at extraction time, so semantically
  // equivalent rewrites must stay patch-level no-ops without any extra logic.
  it('treats object trailing semicolon as a no-op', () => {
    const report = compareFixture('type-alias-trailing-separator');
    expect(report.changes).toHaveLength(0);
    expect(report.recommended).toBe('patch');
  });

  it('treats mapped-type trailing semicolon as a no-op', () => {
    const report = compareFixture('type-alias-mapped-trailing-semi');
    expect(report.changes).toHaveLength(0);
    expect(report.recommended).toBe('patch');
  });

  it('treats conditional-type outer parens as a no-op', () => {
    const report = compareFixture('type-alias-conditional-outer-parens');
    expect(report.changes).toHaveLength(0);
    expect(report.recommended).toBe('patch');
  });

  // Regression guard: the brand synthesis eagerly evaluates a conditional whose
  // check operand is a branded type parameter, collapsing distinct conditionals
  // to the same constant. Changing a generic conditional is a real breaking
  // change and must surface as major, not a silent patch.
  it('treats a generic conditional check-operand change as breaking', () => {
    const report = compareFixture('type-alias-conditional-checktype-changed');
    expect(report.recommended).toBe('major');
  });

  it('treats a generic conditional infer-branch change as breaking', () => {
    const report = compareFixture('type-alias-conditional-infer-changed');
    expect(report.recommended).toBe('major');
  });

  it('treats a generic conditional return-type change in a function as breaking', () => {
    const report = compareFixture('function-generic-conditional-return-changed');
    const change = report.changes.find((c) => c.kind === 'return-type-changed' && c.symbolPath === 'f');
    expect(change).toBeDefined();
    expect(change?.oldValue).toBe('A extends "B" ? 1 : 0');
    expect(change?.newValue).toBe('A extends "Z" ? 1 : 0');
    expect(report.recommended).toBe('major');
  });

  // Regression guard: an `infer` binder shadows the outer type parameter, so a
  // purely textual alpha-rename (`<S>` → `<T>`) makes the new text identical to
  // a structurally different old type. The rename must be declined when a
  // lexical binder is present, so the fast-path no-op is not reported and the
  // real breaking change surfaces as major. `X<string[]>` resolves to `string`
  // before and `string[]` after (proven independently with tsc).
  it('treats an infer-binder-shadowing type alias change as breaking', () => {
    const report = compareFixture('type-alias-infer-binder-shadow');
    expect(report.recommended).toBe('major');
  });

  it('treats an infer-binder-shadowing function return change as breaking', () => {
    const report = compareFixture('function-infer-binder-shadow');
    expect(report.recommended).toBe('major');
  });

  // Regression guard: an unresolved symbol inside a union/intersection collapses
  // the whole type to the intrinsic `error` type, which renders as `any`. Two
  // structurally different unresolved types (`M | string` vs `M | number`) would
  // both serialize to `any` and compare as a no-op, hiding a breaking change.
  // The extractor falls back to the source annotation text for `error` types so
  // the change stays visible, while an identical unresolved type stays a no-op.
  it('treats a changed unresolved union type as breaking', () => {
    const report = compareFixture('unresolved-union-type-changed');
    expect(report.recommended).toBe('major');
  });

  it('treats an identical unresolved type as a no-op', () => {
    const report = compareFixture('unresolved-type-unchanged');
    expect(report.changes).toHaveLength(0);
    expect(report.recommended).toBe('patch');
  });

  // Regression guard: alpha-rename must only rewrite type-reference identifiers,
  // not object-type property keys. `{ T: number }` → `{ S: number }` is a real
  // public property rename; a textual substitution used to turn it into a no-op.
  it('treats an object-type property-key rename as breaking', () => {
    const report = compareFixture('alpha-rename-property-key-changed');
    expect(report.recommended).toBe('major');
  });

  // ...while a genuine type-parameter rename inside an object type stays a no-op.
  it('treats a generic object-type parameter rename as a no-op', () => {
    const report = compareFixture('alpha-rename-object-property-noop');
    expect(report.changes).toHaveLength(0);
    expect(report.recommended).toBe('patch');
  });

  // Regression guard: an unresolved symbol nested inside a wrapper (`Array<...>`,
  // a nested object) collapses to `any` at serialization. The extractor falls
  // back to the source text so `Array<M | string>` → `Array<M | number>` stays
  // visible as a breaking change instead of both reading as `any[]`.
  it('treats a changed unresolved type inside a wrapper as breaking', () => {
    const report = compareFixture('unresolved-wrapper-type-changed');
    expect(report.recommended).toBe('major');
  });

  // Regression guard: a function-type call signature's generic constraint is
  // serialized from a `Type` (not an AST node), so an unresolved symbol collapses
  // it to `any`. It must route through the source-text fallback so
  // `<T extends M | string>` → `<T extends M | number>` surfaces as breaking.
  it('treats a changed unresolved generic constraint on a function type as breaking', () => {
    const report = compareFixture('unresolved-fn-constraint-changed');
    expect(report.recommended).toBe('major');
  });

  // Regression guard: the unresolved-`any` fallback detects the `any` *type*
  // keyword by parsing, so an object-type property literally named `any`
  // (`{ any: M | string }`) does not suppress the fallback.
  it('treats a changed unresolved type behind an "any" property key as breaking', () => {
    const report = compareFixture('unresolved-any-property-key-changed');
    expect(report.recommended).toBe('major');
  });

  // Regression guard: the fallback compares the `any` *count*, not just its
  // presence, so a genuine `any` field alongside an unresolved one
  // (`{ ok: any; x: M | string }`) does not mask the collapsed field.
  it('treats a changed unresolved type beside a genuine any field as breaking', () => {
    const report = compareFixture('unresolved-mixed-with-explicit-any-changed');
    expect(report.recommended).toBe('major');
  });

  // Improvement: a pure generic-parameter rename used to surface as a major
  // false-positive because variance synthesis cannot resolve bare type
  // parameters. Alpha-renaming the new text onto the old parameter names lets
  // the textual guard recognise the equivalence before variance probing runs.
  it('treats a generic parameter rename in a function signature as a no-op', () => {
    const report = compareFixture('function-generic-param-rename');
    expect(report.changes).toHaveLength(0);
    expect(report.recommended).toBe('patch');
  });

  it('treats a generic parameter rename in a type alias as a no-op', () => {
    const report = compareFixture('type-alias-generic-param-rename');
    expect(report.changes).toHaveLength(0);
    expect(report.recommended).toBe('patch');
  });

  // Variance synthesis used to bail to a conservative major whenever a bare
  // generic appeared in either type text. With the shared type-parameter
  // scope, the probe instantiates the parameter (constraint or unique-symbol
  // nominal) and recognises true widening/narrowing.
  it('classifies generic parameter widening (T -> T | undefined) as MINOR', () => {
    const report = compareFixture('function-generic-param-widened');
    const widened = report.changes.find((c) => c.kind === 'param-type-widened');
    expect(widened).toBeDefined();
    expect(widened?.severity).toBe('minor');
    expect(report.recommended).toBe('minor');
  });

  it('classifies generic return narrowing (T | undefined -> T) as MINOR', () => {
    const report = compareFixture('function-generic-return-narrowed');
    const narrowed = report.changes.find((c) => c.kind === 'return-type-narrowed');
    expect(narrowed).toBeDefined();
    expect(narrowed?.severity).toBe('minor');
    expect(report.recommended).toBe('minor');
  });

  // Regression guards for the conservatism boundary: the type-parameter
  // synthesis MUST NOT collapse `T` into its constraint and silently classify
  // a real breaking change as a no-op. The nominal brand on each parameter
  // keeps `T` distinct from its constraint so the probes still surface MAJOR.
  it('keeps a generic return collapsing to its constraint as MAJOR', () => {
    const report = compareFixture('function-generic-return-collapses-to-constraint');
    const change = report.changes.find((c) => c.kind === 'return-type-changed');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  // Regression guard for the `mentionsAny` constraint hole: an `any`
  // constraint must trigger the conservative bail-out, otherwise every
  // probe through the parameter becomes bidirectionally assignable and
  // erases breaking changes.
  it('keeps a widening under <T extends any> conservatively as MAJOR', () => {
    const report = compareFixture('function-generic-any-constraint-widened');
    const change = report.changes.find((c) => c.kind === 'param-type-changed');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  // Regression guard for the union-constraint operator-precedence hole: a raw
  // `string | number & { brand }` would bind `&` tighter than `|` and brand
  // only one branch, leaving the other side bidirectionally assignable. The
  // constraint must be aliased before the brand intersection so every branch
  // carries the nominal mark.
  it('keeps return-type collapse under a union constraint as MAJOR', () => {
    const report = compareFixture('function-generic-union-constraint-collapse');
    const change = report.changes.find((c) => c.kind === 'return-type-changed');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  // Regression guard for the ASCII-only identifier boundary hole: a Unicode
  // identifier continuation (`α` in `Tα` / `Sα`) must not let the
  // rename leak across symbol borders, or a real return-type change would be
  // silently collapsed via the textual fast-path.
  it('does not rewrite Unicode identifiers across symbol boundaries', () => {
    const report = compareFixture('function-generic-unicode-rename-collision');
    // The two referenced aliases differ structurally and are unrelated, so the
    // change must surface — never patch-no-op via a false rename collision.
    expect(report.recommended).not.toBe('patch');
  });

  // Alpha-rename now also applies inside type-parameter constraints, so a
  // self-referential constraint that only swaps the parameter name is treated
  // as a no-op rather than surfacing as `generic-constraint-changed` MAJOR.
  it('treats a self-referential constraint rename as a no-op', () => {
    const report = compareFixture('function-generic-constraint-self-reference-rename');
    expect(report.changes.some((c) => c.kind === 'generic-constraint-changed')).toBe(false);
    expect(report.recommended).toBe('patch');
  });

  // Interface/class property invariance respected: an equivalent rewrite
  // under the container generic scope (`ReadonlyArray<T>` vs `readonly T[]`)
  // is a no-op, but a real structural change stays MAJOR.
  it('treats an interface property equivalent rewrite as a no-op (under container <T>)', () => {
    const report = compareFixture('interface-property-generic-no-op-rewrite');
    expect(report.changes).toHaveLength(0);
    expect(report.recommended).toBe('patch');
  });

  it('treats a class property equivalent rewrite as a no-op (under container <T>)', () => {
    const report = compareFixture('class-property-generic-no-op-rewrite');
    expect(report.changes).toHaveLength(0);
    expect(report.recommended).toBe('patch');
  });

  it('keeps an actual interface property change under <T> conservatively as MAJOR', () => {
    const report = compareFixture('interface-property-generic-actual-change');
    const change = report.changes.find((c) => c.kind === 'property-type-changed');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  // `mentionsAny` must skip the `any` token when it is bounded by matching
  // quotes — `'any'` is a string-literal type, not the any keyword.
  it('does not bail to MAJOR when widening a string-literal \'any\' parameter', () => {
    const report = compareFixture('function-string-literal-any-no-bail');
    const widened = report.changes.find((c) => c.kind === 'param-type-widened');
    expect(widened).toBeDefined();
    expect(widened?.severity).toBe('minor');
    expect(report.recommended).toBe('minor');
  });

  // A constraint whose body still contains the any keyword (e.g.
  // `Record<string, any>`) must keep the conservative MAJOR — the bidirectional
  // assignability hazard `mentionsAny` exists to prevent.
  it('keeps a widening under <T extends Record<string, any>> conservatively as MAJOR', () => {
    const report = compareFixture('function-record-any-constraint-bail');
    const change = report.changes.find((c) => c.kind === 'param-type-changed');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  // Alpha-rename must not rewrite identifiers inside string literal types.
  // `'T'` and `'S'` are distinct literal types: rewriting the new constraint
  // `'S' | number` to `'T' | number` would silently equate the two and erase
  // a real breaking change (the constraint literal domain shifted).
  it('keeps a string-literal rename inside the constraint as MAJOR', () => {
    const report = compareFixture('function-generic-string-literal-rename-bail');
    expect(report.recommended).toBe('major');
    // Either `generic-constraint-changed` (constraint diff) or a param/return
    // major from the variance probe is acceptable — the absolute boundary is
    // that the report is NOT patch.
    expect(report.changes.some((c) => c.severity === 'major')).toBe(true);
  });

  // Container-level generic rename must propagate into every nested member
  // comparison. Without it, a pure `interface Box<T>` → `interface Box<S>`
  // rewrite surfaces as a noisy MAJOR even though no caller-visible change
  // happened.
  it('treats an interface container generic rename as a no-op across nested members', () => {
    const report = compareFixture('interface-container-generic-rename-nested');
    expect(report.changes).toHaveLength(0);
    expect(report.recommended).toBe('patch');
  });

  it('treats a class container generic rename as a no-op across nested members', () => {
    const report = compareFixture('class-container-generic-rename-nested');
    expect(report.changes).toHaveLength(0);
    expect(report.recommended).toBe('patch');
  });

  // Template-literal placeholders are *type position*. An `any` keyword
  // inside `${...}` must still trip the conservative bail — otherwise the
  // variance probe would erase a breaking change involving the placeholder.
  it('keeps a template-placeholder `any` bail conservatively as MAJOR', () => {
    const report = compareFixture('function-template-placeholder-any-bail');
    expect(report.recommended).toBe('major');
  });
});

describe('exports map / multiple entrypoints', () => {
  it('extracts every subpath from a package.json exports map', () => {
    const { newSnap } = compareExportsFixture('exports-subpath-added');
    expect(Object.keys(newSnap.entrypoints).sort()).toEqual(['.', './utils']);
    expect(newSnap.entrypoints['./utils']).toHaveProperty('helper');
  });

  it('detects an added entry point as MINOR', () => {
    const { report } = compareExportsFixture('exports-subpath-added');
    const added = report.changes.find((c) => c.kind === 'entrypoint-added');
    expect(added).toBeDefined();
    expect(added?.severity).toBe('minor');
    expect(added?.symbolPath).toBe('./utils');
    expect(report.recommended).toBe('minor');
  });

  it('detects a removed entry point as MAJOR', () => {
    const { report } = compareExportsFixture('exports-subpath-removed');
    const removed = report.changes.find((c) => c.kind === 'entrypoint-removed');
    expect(removed).toBeDefined();
    expect(removed?.severity).toBe('major');
    expect(removed?.symbolPath).toBe('./utils');
    expect(report.recommended).toBe('major');
  });

  it('detects a breaking symbol change inside a subpath entry point', () => {
    const { report } = compareExportsFixture('exports-subpath-changed');
    // No entry point was added or removed — both sides expose '.' and './utils'.
    expect(report.changes.some((c) => c.kind === 'entrypoint-added')).toBe(false);
    expect(report.changes.some((c) => c.kind === 'entrypoint-removed')).toBe(false);
    const change = report.changes.find((c) => c.kind === 'required-param-added');
    expect(change).toBeDefined();
    // The symbol path is namespaced by its entry point subpath.
    expect(change?.symbolPath).toContain('./utils#helper');
    expect(report.recommended).toBe('major');
  });

  it('analyzes the .d.ts surface when a package ships both .d.ts and .d.mts', () => {
    // Which declaration file wins decides the whole analysis for a dual-format
    // package: the other surface is not analyzed at all, so a break confined to it
    // is missed (see the FAQ). The `.d.ts`-first ordering is deliberate — the
    // default tsconfig include always loads `.d.ts`, whereas `.d.mts` loading
    // depends on the include globs — and nothing else pins it.
    const snap = extractFromPath(fixtureDir('dual-surface-prefers-dts', 'old'));
    expect(Object.keys(snap.entrypoints)).toEqual(['.']);
    expect(Object.keys(snap.entrypoints['.'])).toEqual(['fromCjsSurface']);
  });

  it('ignores a types condition the running compiler does not satisfy', () => {
    // `types@{selector}` matches only when the analyzing TypeScript satisfies the
    // selector. Taking it unconditionally is how a package that points `types@<5.4`
    // at an "upgrade your TypeScript" stub got analyzed as having a three-symbol
    // surface that never changes between releases, so every comparison came back
    // clean and exited 0.
    const snap = extractFromPath(fixtureDir('exports-versioned-types-stub', 'old'));
    expect(Object.keys(snap.entrypoints).sort()).toEqual(['.', './sub']);
    expect(Object.keys(snap.entrypoints['.'])).toEqual(['realSurface']);
    expect(Object.keys(snap.entrypoints['./sub'])).toEqual(['subSurface']);
  });

  it('honors a types condition the running compiler does satisfy', () => {
    // The other direction of the same rule, and the one a hand-rolled comparator
    // gets wrong: `*`, `^6.0` and `~6.0` all match, and skipping them would turn a
    // package that resolves today into a hard error.
    const snap = extractFromPath(fixtureDir('exports-versioned-types-current', 'old'));
    expect(Object.keys(snap.entrypoints)).toEqual(['.']);
    expect(Object.keys(snap.entrypoints['.'])).toEqual(['fromVersionedCondition']);
  });

  it('prefers a declared .d.cts over a declaration substituted from a .js target', () => {
    // An exports target that names only its runtime file resolves to the
    // declaration beside it, which is what makes a subpath shipping no `types`
    // condition analyzable at all. That substitution ranks below every declared
    // types path, including through the root path's `.d.ts`-first sort, or a
    // package that declares a `.d.cts` would silently flip onto the `.d.ts` sitting
    // next to its ESM entry.
    const snap = extractFromPath(fixtureDir('exports-flat-declared-cts', 'old'));
    expect(Object.keys(snap.entrypoints)).toEqual(['.']);
    expect(Object.keys(snap.entrypoints['.'])).toEqual(['fromDeclaredCts']);
  });

  it('keeps single-entry fixtures working through entrypoints[\'.\']', () => {
    // Regression guard: a fixture with no exports map still resolves to '.'.
    const oldSnap = extractFromPath(fixtureDir('export-added', 'old'), 'index.ts');
    expect(Object.keys(oldSnap.entrypoints)).toEqual(['.']);
    expect(oldSnap.entrypoints['.']).toHaveProperty('foo');
  });
});

describe('generic parameter defaults', () => {
  it('detects a changed default type as MAJOR', () => {
    const report = compareFixture('generic-param-default-changed');
    const change = report.changes.find((c) => c.kind === 'generic-param-default-changed');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('detects an added default as MINOR', () => {
    const report = compareFixture('generic-param-default-added');
    const change = report.changes.find((c) => c.kind === 'generic-param-default-added');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('minor');
    expect(report.changes.some((c) => c.severity === 'major')).toBe(false);
    expect(report.recommended).toBe('minor');
  });
});

describe('class constructor parameter properties and accessors', () => {
  it('detects a removed constructor parameter property as MAJOR', () => {
    const report = compareFixture('class-ctor-param-property-removed');
    const change = report.changes.find((c) => c.kind === 'class-property-removed' && c.symbolPath === 'C.x');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('detects a removed accessor as MAJOR', () => {
    const report = compareFixture('class-accessor-removed');
    const change = report.changes.find((c) => c.kind === 'class-property-removed' && c.symbolPath === 'C.x');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('detects an accessor return-type change as MAJOR', () => {
    const report = compareFixture('class-accessor-type-changed');
    const change = report.changes.find((c) => c.kind === 'class-property-type-changed' && c.symbolPath === 'C.x');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('detects a set-only (write-side) narrowing of a get/set accessor as MAJOR', () => {
    const report = compareFixture('class-accessor-setter-narrowed');
    const change = report.changes.find((c) => c.kind === 'class-property-type-changed' && c.symbolPath === 'C.x');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('treats an unchanged accessor with distinct read/write types as a no-op (PATCH)', () => {
    const report = compareFixture('class-accessor-distinct-noop');
    expect(report.changes.some((c) => c.kind === 'class-property-type-changed')).toBe(false);
    expect(report.recommended).toBe('patch');
  });
});

describe('interface call and index signatures', () => {
  it('detects a removed call signature as MAJOR', () => {
    const report = compareFixture('interface-call-signature-removed');
    const change = report.changes.find((c) => c.kind === 'interface-call-signature-changed');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('detects an index-signature value change as MAJOR', () => {
    const report = compareFixture('interface-index-signature-changed');
    const change = report.changes.find((c) => c.kind === 'index-signature-changed');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('treats a pure generic rename over an index signature as a no-op (PATCH)', () => {
    const report = compareFixture('interface-index-signature-generic-rename');
    expect(report.changes.some((c) => c.kind === 'index-signature-changed')).toBe(false);
    expect(report.recommended).toBe('patch');
  });
});

describe('interface accessors', () => {
  it('detects a removed interface accessor as MAJOR', () => {
    const report = compareFixture('interface-accessor-removed');
    const change = report.changes.find((c) => c.kind === 'property-removed' && c.symbolPath === 'I.x');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('detects a set-only (write-side) narrowing of an interface get/set accessor as MAJOR', () => {
    const report = compareFixture('interface-accessor-setter-narrowed');
    const change = report.changes.find((c) => c.kind === 'property-type-changed' && c.symbolPath === 'I.x');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });
});

describe('graded confidence', () => {
  // `proven` is opt-in per rule. It used to be the default every major-emitting
  // rule inherited without deciding, which is what `--strict`'s whole promise
  // rested on. These two pin the direction of that default in both directions.
  it('grades a removal as PROVEN (the change is its own evidence)', () => {
    const report = compareFixture('export-removed');
    const removed = report.changes.find((c) => c.kind === 'export-removed');
    expect(removed?.confidence).toBe('proven');
    expect(report.summary.majorProven).toBeGreaterThan(0);
  });

  // A required property added to a class breaks whoever implements the class by
  // hand, and only them: `new Cls(...)` and `class Mine extends Cls` inherit it.
  // Whether such a consumer can exist is decided by the class, not by the property
  // — a private or protected instance member makes TypeScript compare the class
  // nominally, so no object literal satisfies it and there is nobody to break.
  // Both fixtures were compiled to confirm the verdicts: the implementable one goes
  // from clean to `TS2741` on a consumer assigning an object literal, and the
  // nominal one is clean on both sides because that same consumer already fails on
  // the old side over the private field it cannot supply.
  it('grades a required class property added to an implementable class as PROVEN', () => {
    const report = compareFixture('class-required-property-added-implementable');
    const change = report.changes.find((c) => c.kind === 'required-class-property-added');
    expect(change?.confidence).toBe('proven');
  });

  it('leaves the same addition review-only on a class nobody can implement', () => {
    const report = compareFixture('class-required-property-added-nominal');
    const change = report.changes.find((c) => c.kind === 'required-class-property-added');
    expect(change?.severity).toBe('major');
    expect(change?.confidence).toBe('heuristic');
    expect(report.summary.majorProven).toBe(0);
  });

  // Grading reads the OLD side, because the consumer this rule claims to break is one
  // that already wrote the class down by hand — impossible while the class carried a
  // private member, whatever the new side looks like. Compiled both ways: a reader is
  // clean on both sides, and the object literal that would have to break fails on the
  // old side over the private field.
  it('leaves the addition review-only when the class only became implementable now', () => {
    const report = compareFixture('class-required-property-added-was-nominal');
    const change = report.changes.find((c) => c.kind === 'required-class-property-added');
    expect(change?.severity).toBe('major');
    expect(change?.confidence).toBe('heuristic');
  });

  // The flag is optional for backward compatibility, and `diff` is a public export
  // fed by persisted `semver_snapshot` output. Absent has to read as "unknown"
  // rather than "implementable", or every such addition grades proven against a
  // snapshot written before the field existed.
  it('stays review-only against a snapshot that predates the flag', () => {
    const oldDir = fixtureDir('class-required-property-added-implementable', 'old');
    const newDir = fixtureDir('class-required-property-added-implementable', 'new');
    ensureFixtureTsConfig(oldDir);
    ensureFixtureTsConfig(newDir);
    const oldSnap = extractFromPath(oldDir, 'index.ts');
    const newSnap = extractFromPath(newDir, 'index.ts');
    for (const snap of [oldSnap, newSnap]) {
      for (const symbol of Object.values(snap.entrypoints['.'])) {
        delete (symbol as { hasNonPublicMembers?: boolean }).hasNonPublicMembers;
      }
    }
    const report = diff(oldSnap, newSnap);
    const change = report.changes.find((c) => c.kind === 'required-class-property-added');
    expect(change?.confidence).toBe('heuristic');
  });

  it('grades a major rule that never decided as review-only, not proven', () => {
    // `class-property-became-readonly` is a real major, but nothing in the rule
    // establishes that a consumer is affected, and it is not on the proven
    // allow-list. It must not reach `--strict` by inheritance.
    const report = compareFixture('class-property-readonly-added');
    const change = report.changes.find((c) => c.kind === 'class-property-became-readonly');
    expect(change?.severity).toBe('major');
    expect(change?.confidence).toBe('heuristic');
    // The guard is that THIS rule did not inherit `proven`, not that the fixture
    // is free of proven majors: losing the write type is separately reported as
    // `class-property-type-changed`, which did decide and did earn it.
    expect(report.changes.some((c) => c.kind === 'class-property-became-readonly' && c.confidence === 'proven')).toBe(false);
    expect(report.summary.majorReview).toBeGreaterThan(0);
  });

  it('propagates a sub-change grade to its wrapper through the kind default', () => {
    // `param-removed` never computes a confidence and is not on the proven
    // allow-list, so it resolves to review-only — and the
    // `class-method-signature-changed` wrapper above it has to say the same.
    // Reading the sub's raw `confidence` here sees `undefined` (the default is
    // applied later, in `diff`) and would read that as "not heuristic, so
    // proven", handing the wrapper a confidence its parts never had.
    const report = compareFixture('class-method-param-removed-wrapper');
    const wrapper = report.changes.find((c) => c.kind === 'class-method-signature-changed');
    const sub = report.changes.find((c) => c.kind === 'param-removed');
    expect(wrapper?.severity).toBe('major');
    expect(sub?.confidence).toBe('heuristic');
    expect(wrapper?.confidence).toBe('heuristic');
    expect(report.summary.majorProven).toBe(0);
  });

  // Measured on commander 14.0.1 -> 14.0.2: the deprecated `outputHelp(cb)`
  // overload lost its `?` while `outputHelp(context?)` stayed ahead of it, so
  // `outputHelp()` still compiles (verified against tsc). The finding is true of
  // the signature and false of the symbol, and `--strict` must not fail on it.
  it('grades a required parameter as review-only when a sibling overload still takes the shorter call', () => {
    const report = compareFixture('overload-required-param-shadowed');
    const added = report.changes.find((c) => c.kind === 'required-param-added');
    expect(added).toBeDefined();
    expect(added?.confidence).toBe('heuristic');
    expect(report.summary.majorProven).toBe(0);
  });

  it('keeps a required parameter PROVEN when every overload demands the argument', () => {
    const report = compareFixture('overload-required-param-not-shadowed');
    const added = report.changes.filter((c) => c.kind === 'required-param-added');
    expect(added.length).toBeGreaterThan(0);
    expect(added.some((c) => c.confidence !== 'heuristic')).toBe(true);
    expect(report.summary.majorProven).toBeGreaterThan(0);
  });

  it('grades an undecidable declaration-form change as review-only, not as a removal', () => {
    // Nothing was removed: `Handler` still resolves, as an interface now rather
    // than an alias. The change reuses the `export-removed` kind, so without an
    // explicit grade it would inherit that rule's proven confidence and fail
    // `--strict` on a refactor. ky flipped KyRequest/KyResponse between the two
    // forms in 1.12.0 and back in 1.13.0; no consumer noticed either way.
    const report = compareFixture('export-kind-changed-alias-to-interface');
    const change = report.changes.find((c) => c.kind === 'export-removed' && c.symbolPath === 'Handler');
    expect(change?.severity).toBe('major');
    expect(change?.confidence).toBe('heuristic');
    expect(report.summary.majorProven).toBe(0);
  });

  it('decomposes an object-literal alias so an added required property is named, not opaque', () => {
    // The p-limit `LimitFunction.concurrency` case: `type X = { ... }` gains a
    // required property. Without decomposition this is an opaque
    // `type-alias-changed`; decomposed it is a structural required-property-added
    // that names the member responsible.
    //
    // Proven. This used to be review-only on the grounds that only a consumer
    // who builds the object themselves is obliged, which the earlier corpus
    // scored at 33%. Building one is ordinary: p-limit 6.0.0 to 6.1.0 is the
    // real release this fixture models, and a consumer-owned function taking a
    // `LimitFunction` called with a hand-written test stub stops compiling
    // across it. That pair is in the accuracy corpus now, so the grade rests on
    // a compiled break rather than on an argument about how the object is
    // "meant" to be obtained.
    const report = compareFixture('object-alias-required-prop-added');
    const added = report.changes.find((c) => c.kind === 'required-property-added' && c.symbolPath === 'LimitFunction.concurrency');
    expect(added).toBeDefined();
    expect(added?.severity).toBe('major');
    expect(added?.confidence).toBe('proven');
    expect(report.changes.some((c) => c.kind === 'type-alias-changed')).toBe(false);
    expect(report.recommended).toBe('major');
  });

  it('decomposes an object-literal alias so an added optional property demotes to MINOR', () => {
    // The additive-property case (ideal ky-style demote): an optional property is
    // backward compatible, so the whole-alias major disappears entirely.
    const report = compareFixture('object-alias-optional-prop-added');
    const added = report.changes.find((c) => c.kind === 'optional-property-added' && c.symbolPath === 'Opts.retry');
    expect(added).toBeDefined();
    expect(added?.severity).toBe('minor');
    expect(report.summary.major).toBe(0);
    expect(report.recommended).toBe('minor');
  });

  it('tags a non-object union widening as a PROVEN major once variance resolves it', () => {
    // The clsx `ClassValue` case, and it is not the safe one it was written up
    // as. "Widening an input union is safe" holds only while the alias stays
    // inside the library: a consumer that re-declares the accepted union in its
    // own public prop type and assigns a `ClassValue` into it stops compiling
    // when the union gains a member, which is what clsx 2.1.0 to 2.1.1 does with
    // `bigint`. An alias sits in an invariant position and has both roles, so a
    // resolved non-equivalence has a broken one.
    //
    // Only a resolved probe earns this. The real clsx release is still missed,
    // because `ClassArray | ClassDictionary` sends the variance probe home
    // without a verdict and a bail proves nothing either way.
    const report = compareFixture('type-alias-union-widened-heuristic');
    const change = report.changes.find((c) => c.kind === 'type-alias-changed' && c.symbolPath === 'ClassValue');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(change?.confidence).toBe('proven');
    expect(report.summary.majorProven).toBeGreaterThan(0);
  });

  // The three shapes that a promotion pass graded `proven` while no consumer
  // broke. Each was found by compiling old and new: both sides exit 0. They are
  // pinned here because the gate corpus contains none of them, so nothing else
  // would notice them coming back.
  it('does not claim a renamed or optionally-widened call signature is proven', () => {
    const report = compareFixture('callsig-safe-widenings');
    const changes = report.changes.filter((c) => c.kind === 'interface-call-signature-changed');
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.every((c) => c.confidence !== 'proven')).toBe(true);
    expect(report.summary.majorProven).toBe(0);
  });

  it('does not claim an added all-optional base is proven', () => {
    // Factoring shared optional knobs into a base is how a library ships them in
    // a minor. Readers inherit the members, and nothing is obliged to supply one.
    const report = compareFixture('heritage-added-all-optional');
    const change = report.changes.find((c) => c.kind === 'interface-heritage-changed');
    expect(change?.confidence).toBe('heuristic');
    expect(report.summary.majorProven).toBe(0);
  });

  it('reports nothing when a member moves up into a base it already extended', () => {
    // `close()` is still on the surface, one level up. Inherited members are not
    // flattened, so without resolving the base this reads as a removal.
    const report = compareFixture('heritage-member-moved-to-base');
    expect(report.changes.some((c) => c.kind === 'interface-method-removed')).toBe(false);
    expect(report.summary.majorProven).toBe(0);
  });

  it('does not claim an inlined base lost anything', () => {
    // The base is gone from the clause and every member it carried is declared
    // directly now. The clause moved; the surface did not.
    const report = compareFixture('heritage-base-inlined');
    expect(report.changes.some((c) => c.kind === 'required-property-added')).toBe(false);
    expect(report.summary.majorProven).toBe(0);
  });

  it('does not claim a dropped empty base is proven', () => {
    // A marker interface carries nothing, so dropping it is invisible.
    const report = compareFixture('heritage-empty-base-dropped');
    const change = report.changes.find((c) => c.kind === 'interface-heritage-changed');
    expect(change?.confidence).toBe('heuristic');
    expect(report.summary.majorProven).toBe(0);
  });

  it('does not answer about a DOM global a package shadows with its own name', () => {
    // `Element | Text` is `Element` here, because this package's `Text` extends
    // its `Element`. The DOM types of those names are unrelated to either. The
    // variance probe resolves names in a project of its own, so it must not carry
    // a lib that defines them, and it now carries the package's own declarations
    // instead. It reports the pair review-only rather than silently: the new text
    // names a declaration the old one does not, and mutual assignability is not
    // strong enough to call that a no-op.
    const report = compareFixture('dom-shadowed-name-widened');
    const change = report.changes.find((c) => c.kind === 'property-type-changed' && c.symbolPath === 'Options.target');
    expect(change?.confidence).not.toBe('proven');
    expect(report.summary.majorProven).toBe(0);
  });

  it('resolves a union alias through the package types it names', () => {
    // The clsx shape. `ClassValue` gains `bigint`, and the members that decide
    // whether that is a widening are `ClassArray` and `ClassDictionary`, which
    // the package declares itself. With nothing but the ES libs in the probe
    // program the comparison used to bail and the finding stayed review-only,
    // which is why `--strict` was silent on a release that breaks any consumer
    // redeclaring the union it receives.
    const report = compareFixture('scope-alias-union-widened');
    const change = report.changes.find((c) => c.kind === 'type-alias-changed' && c.symbolPath === 'ClassValue');
    expect(change?.confidence).toBe('proven');
  });

  it('reads a namespace-qualified package type', () => {
    // `P.Pattern<T> & { tag: string }` reordered to `{ tag: string } & P.Pattern<T>`
    // is the same type. Resolving it takes the namespace the package exports, so
    // namespaces are rendered into the scope alongside interfaces and aliases.
    const report = compareFixture('scope-namespace-qualified-noop');
    expect(report.changes.filter((c) => c.severity === 'major')).toEqual([]);
  });

  it('treats a spelled-out `| undefined` on an optional property as a no-op', () => {
    // `tls?: T` and `tls?: T | undefined` accept the same writes and read the
    // same, and even under `exactOptionalPropertyTypes` the second is the more
    // permissive. ioredis 5.9.2 -> 5.9.3 wrote it out on two Sentinel options;
    // the texts differ, so the probe called it a widening and the gate failed on
    // a release that broke nobody.
    const report = compareFixture('scope-optional-undefined-spelled');
    expect(report.changes.filter((c) => c.severity === 'major')).toEqual([]);
  });

  it('does not render an enum into the scope, where it would be two types', () => {
    // The two sides go into separate namespaces, so a rendered enum would be
    // `__sc_old.Color` on one side and `__sc_new.Color` on the other. Enums are
    // nominal, so those are unrelated types, and every text mentioning one would
    // probe as an unrelated change: a confident major on an unchanged enum. The
    // rewrite here is `readonly string[]` to `ReadonlyArray<string>`, a no-op.
    const report = compareFixture('scope-enum-member-in-noop-rewrite');
    expect(report.summary.majorProven).toBe(0);
  });

  it('does not decide a comparison its stand-ins decided for it', () => {
    // Both sides name a shape the entry point does not export, so the probe has
    // nothing to resolve them to and stands each one in as an opaque brand. Two
    // brands are unrelated by construction, which would make an internal rename
    // no consumer can even name into a confident break. The rewrite from
    // `readonly string[]` to `ReadonlyArray<string>` alongside it is a no-op, and
    // both sides of the pair compile against the same consumer.
    const report = compareFixture('scope-unexported-internal-swapped');
    const change = report.changes.find((c) => c.kind === 'property-type-changed' && c.symbolPath === 'Handle.shape');
    expect(change?.confidence).toBe('heuristic');
    expect(report.summary.majorProven).toBe(0);
  });

  // jose 6.2.10 shipped this in a patch and came back with 42 `proven` breaks
  // against a consumer that compiles on both sides. Inherited members are not
  // flattened into `methods`/`properties`, so a member hoisted onto a base reads
  // as removed unless the bases are resolved — which the interface path had been
  // doing all along and the class path was not.
  it('reads a class member hoisted onto a mixin base as still there', () => {
    // `declare const X_base: new () => Iface` is what TypeScript emits for
    // `class X extends Mixin(Base)`. The checker resolves it to the interface
    // name like any other base, so nothing here is special-cased for mixins.
    const report = compareFixture('class-member-hoisted-to-mixin-base');
    expect(report.summary.majorProven).toBe(0);
    expect(report.changes.filter((c) => c.kind === 'class-method-removed')).toEqual([]);
  });

  it('reads a class member hoisted onto a plain base as still there', () => {
    const report = compareFixture('class-member-hoisted-to-base');
    expect(report.summary.majorProven).toBe(0);
    expect(report.changes.filter((c) => c.kind === 'class-method-removed')).toEqual([]);
  });

  it('will not call a class member removed when it cannot see the base', () => {
    // The base is named but lives outside the snapshot, so whether the member is
    // still inherited is unknowable. It stays a MAJOR for review; what it must
    // not be is `proven`, which is a claim that the member is gone.
    const report = compareFixture('class-member-lost-with-unresolved-base');
    const change = report.changes.find((c) => c.kind === 'class-method-removed');
    expect(change?.confidence).toBe('heuristic');
    expect(report.summary.majorProven).toBe(0);
  });

  it('does not let a scope stub shadow a generic of the same name', () => {
    // The stubs sit at file scope, and so do the synthesized type parameters, so
    // a generic named after one is a duplicate identifier and the whole probe
    // errors out. That made a scope actively harmful: the same comparison
    // answers fine with no scope installed at all. Widening a parameter union is
    // a minor, and it stays one whether or not `Hidden` needed a stub. Only the
    // colliding stub is withheld, so a probe whose generic collides with one
    // still reads the rest of the scope.
    const report = compareFixture('scope-stub-shadows-type-param');
    expect(report.summary.major).toBe(0);
    expect(report.changes.map((c) => c.kind)).toContain('param-type-widened');
  });

  it('round-trips a quoted member name through the scope', () => {
    // A rendered declaration that does not parse is dropped, and a dropped
    // declaration takes the probe back to bailing. `'content-type'` has to come
    // back out quoted for the interface to survive that pass.
    const report = compareFixture('scope-quoted-member-noop');
    expect(report.changes.filter((c) => c.severity === 'major')).toEqual([]);
  });

  it('tags a function return-only generic addition as HEURISTIC majors', () => {
    // The nanoid case: a return-only `<Type extends string>` is inferred at call
    // sites and stays compatible, so both the generic-param-required and the
    // return-type change are review-only.
    const report = compareFixture('fn-return-only-generic-heuristic');
    const majors = report.changes.filter((c) => c.severity === 'major');
    expect(majors.length).toBeGreaterThan(0);
    expect(majors.every((c) => c.confidence === 'heuristic')).toBe(true);
    expect(report.summary.majorProven).toBe(0);
  });

  it('keeps a genuinely unrelated non-object alias change PROVEN', () => {
    // `type ID = string` -> `type ID = number`: variance resolves the two as
    // unrelated, so the major is confident (proven), not review-only.
    const report = compareFixture('type-alias-changed');
    const change = report.changes.find((c) => c.kind === 'type-alias-changed' && c.symbolPath === 'ID');
    expect(change).toBeDefined();
    expect(change?.confidence).toBe('proven');
    expect(report.summary.majorProven).toBeGreaterThan(0);
  });

  it('normalizes every change to a concrete confidence and splits the major summary', () => {
    const report = compareFixture('object-alias-required-prop-added');
    expect(report.changes.every((c) => c.confidence === 'proven' || c.confidence === 'heuristic')).toBe(true);
    expect(report.summary.majorProven + report.summary.majorReview).toBe(report.summary.major);
  });

  it('treats a function-property <-> method shorthand switch as NO CHANGE', () => {
    // `{ onClick: () => void }` and `{ onClick(): void }` are mutually assignable —
    // a no-op refactor. The disjoint property/method maps would otherwise read it as
    // property-removed + required-method-added (two PROVEN majors), the worst kind
    // of false confidence: `--strict` failing CI on a non-breaking change. The
    // object-literal alias decomposition routes every `type X = { ... }` through
    // this path, so the reconciliation must hold for aliases too.
    const report = compareFixture('method-property-shorthand-noop');
    expect(report.changes).toHaveLength(0);
    expect(report.recommended).toBe('patch');
  });

  it('still reports a property <-> method switch MAJOR when the signatures are incompatible', () => {
    // The reconciliation must not become a blanket false negative: a param narrowed
    // across the form switch (`(id: string) => void` -> `(id: number): void`) is a
    // genuine break and stays a proven major.
    const report = compareFixture('method-property-shorthand-incompatible');
    const change = report.changes.find((c) => c.kind === 'property-type-changed' && c.symbolPath === 'Handlers.run');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(change?.confidence).toBe('proven');
    expect(report.recommended).toBe('major');
  });

  it('treats an overloaded method rewritten as an intersection-of-functions property as NO CHANGE', () => {
    // An overloaded method and the equivalent intersection-of-call-signatures
    // property are mutually assignable. This only resolves if the serialized
    // intersection keeps its per-function parentheses — without them the text
    // re-parses as one function returning an intersection and the variance probe
    // bails to a conservative (heuristic) major.
    const report = compareFixture('method-overload-to-intersection-property-noop');
    expect(report.changes).toHaveLength(0);
    expect(report.recommended).toBe('patch');
  });
});

describe('TypeScript diagnostic reporting', () => {
  // ts-morph analyzes in error-recovery mode, so a project that does not type-check
  // still yields a snapshot — just a possibly incomplete one. The stderr warning is
  // the only thing standing between that and a silent under-report (it is what
  // surfaces an unparseable `.d.ts`, e.g. `import defer` on an older parser).
  function stderrDuringExtract(fixture: string, side: 'old' | 'new', entry?: string): string {
    const dir = fixtureDir(fixture, side);
    ensureFixtureTsConfig(dir);
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      extractFromPath(dir, entry);
      return spy.mock.calls.map((c) => String(c[0])).join('');
    } finally {
      spy.mockRestore();
    }
  }

  it('warns on stderr when the analyzed project has TypeScript errors', () => {
    const written = stderrDuringExtract('unresolved-type-unchanged', 'old', 'index.ts');
    expect(written).toContain('TypeScript error(s) in the analyzed project');
    expect(written).toContain('can under-report breaking changes');
  });

  it('stays silent on a clean project', () => {
    // Guards the deprecated-compiler-option filter: the fixture tsconfig uses
    // `moduleResolution: node`, which TypeScript >= 6.0 reports as an *Error*
    // (TS5107) even though nothing about the declarations is wrong. Without the
    // filter this fires the "snapshot may be incomplete" alarm on every ordinary
    // package that still carries a node10 tsconfig.
    //
    // Assert the precondition rather than trusting it: this test goes quietly
    // vacuous the moment someone modernizes the shared fixture template, and the
    // template is shared by every fixture in this suite.
    const template = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'tsconfig.fixture.json'), 'utf8'));
    expect(template.compilerOptions.moduleResolution).toBe('node');

    const written = stderrDuringExtract('export-added', 'old', 'index.ts');
    expect(written).toBe('');
  });
});
