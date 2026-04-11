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
  | 'generic-param-removed'
  | 'generic-constraint-changed'
  | 'overload-removed'
  | 'class-method-signature-changed'
  | 'class-property-type-changed'
  | 'interface-method-removed'
  | 'interface-method-signature-changed'
  | 'enum-member-value-changed'
  | 'interface-property-became-required'
  | 'class-property-became-static'
  | 'class-property-became-instance'
  | 'class-property-became-required'
  | 'class-method-became-static'
  | 'class-method-became-instance'
  // MINOR
  | 'export-added'
  | 'optional-param-added'
  | 'optional-property-added'
  | 'enum-member-added'
  | 'overload-added'
  | 'generic-param-with-default'
  | 'class-method-added'
  | 'class-property-added'
  | 'interface-method-added'
  | 'interface-property-became-optional'
  | 'class-property-became-optional';

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

export interface CompareOptions {
  oldSource: SourceRef;
  newSource: SourceRef;
  entry?: string;
}

export type SourceRef =
  | { type: 'path'; path: string }
  | { type: 'git'; ref: string; cwd?: string };
