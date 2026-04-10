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

describe('enum changes', () => {
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

  it('detects class method added as MINOR', () => {
    const report = compareFixture('class-method-added');
    const change = report.changes.find((c) => c.kind === 'class-method-added');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('minor');
    expect(report.recommended).toBe('minor');
  });

  it('detects class property added as MINOR', () => {
    const report = compareFixture('class-property-added');
    const change = report.changes.find((c) => c.kind === 'class-property-added');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('minor');
    expect(report.recommended).toBe('minor');
  });
});

describe('generic parameter changes', () => {
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
});
