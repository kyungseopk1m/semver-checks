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

  it('detects return type changed as MAJOR', () => {
    const report = compareFixture('return-type-narrowed');
    const change = report.changes.find((c) => c.kind === 'return-type-changed');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('major');
    expect(report.recommended).toBe('major');
  });

  it('detects param type changed as MAJOR', () => {
    const report = compareFixture('param-type-widened');
    const change = report.changes.find((c) => c.kind === 'param-type-changed');
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
