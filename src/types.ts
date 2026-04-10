export type SemverBump = 'major' | 'minor' | 'patch';

export type ChangeKind =
  // MAJOR
  | 'export-removed'
  | 'required-param-added'
  | 'param-removed'
  | 'return-type-changed'
  | 'param-type-changed'
  | 'property-removed'
  | 'required-property-added'
  | 'property-type-changed'
  | 'enum-member-removed'
  | 'class-method-removed'
  | 'class-property-removed'
  | 'generic-param-required'
  | 'class-constructor-changed'
  | 'type-alias-changed'
  | 'variable-type-changed'
  // MINOR
  | 'export-added'
  | 'optional-param-added'
  | 'optional-property-added'
  | 'enum-member-added'
  | 'overload-added'
  | 'generic-param-with-default'
  | 'class-method-added'
  | 'class-property-added';

export interface ApiChange {
  kind: ChangeKind;
  severity: SemverBump;
  symbolPath: string;
  message: string;
  oldValue?: string;
  newValue?: string;
}

export interface SemverReport {
  recommended: SemverBump;
  changes: ApiChange[];
  summary: {
    major: number;
    minor: number;
    patch: number;
  };
}

export type SymbolKind =
  | 'function'
  | 'interface'
  | 'type-alias'
  | 'enum'
  | 'class'
  | 'variable';

export interface CompareOptions {
  oldSource: SourceRef;
  newSource: SourceRef;
  entry?: string;
}

export type SourceRef =
  | { type: 'path'; path: string }
  | { type: 'git'; ref: string; cwd?: string };
