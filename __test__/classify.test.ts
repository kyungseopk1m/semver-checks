import { describe, it, expect } from 'vitest';
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

  it('detects required class property added as MAJOR', () => {
    const report = compareFixture('class-property-added');
    const change = report.changes.find((c) => c.kind === 'required-class-property-added');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
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

  it('detects class property optional-to-required as MAJOR', () => {
    const report = compareFixture('class-property-optional-to-required');
    const change = report.changes.find((c) => c.kind === 'class-property-became-required');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
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
    expect(report.changes.some((c) => c.kind === 'class-method-signature-changed')).toBe(true);
    expect(report.changes.some((c) => c.kind === 'param-type-changed')).toBe(true);
    expect(report.changes.some((c) => c.kind === 'class-method-added')).toBe(false);
    expect(report.changes.some((c) => c.kind === 'class-method-removed')).toBe(false);
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
  it('decomposes an object-literal alias so an added required property is a PROVEN major', () => {
    // The p-limit `LimitFunction.concurrency` case: `type X = { ... }` gains a
    // required property. Without decomposition this is an opaque, review-only
    // `type-alias-changed`; decomposed it is a structural required-property-added.
    const report = compareFixture('object-alias-required-prop-added');
    const added = report.changes.find((c) => c.kind === 'required-property-added' && c.symbolPath === 'LimitFunction.concurrency');
    expect(added).toBeDefined();
    expect(added?.severity).toBe('major');
    expect(added?.confidence).toBe('proven');
    expect(report.changes.some((c) => c.kind === 'type-alias-changed')).toBe(false);
    expect(report.summary.majorProven).toBeGreaterThan(0);
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

  it('tags a non-object union widening as a HEURISTIC (review-only) major', () => {
    // The clsx `ClassValue` case: a union alias gains a member. Widening an input
    // union is safe in practice but unprovable from the declaration alone, so it
    // stays major but review-only — `--strict` does not gate on it.
    const report = compareFixture('type-alias-union-widened-heuristic');
    const change = report.changes.find((c) => c.kind === 'type-alias-changed' && c.symbolPath === 'ClassValue');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(change?.confidence).toBe('heuristic');
    expect(report.summary.majorProven).toBe(0);
    expect(report.summary.majorReview).toBeGreaterThan(0);
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
});
