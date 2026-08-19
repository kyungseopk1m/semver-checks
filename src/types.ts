export type SemverBump = 'major' | 'minor' | 'patch';

// How firmly a change's severity is established.
//   - 'proven'    : the severity follows from a structural fact (a member was
//                   added/removed, an optionality/readonly/static transition, an
//                   enum/overload change) or from a *resolved* type relation
//                   (assignability concluded the types are genuinely unrelated).
//                   Safe to gate CI on — this is what `--strict` fails the build on.
//   - 'heuristic' : the severity is a conservative fallback the analyzer could
//                   not prove — a text comparison that did not resolve, or a
//                   one-directional assignability in an invariant position where a
//                   safe direction exists. Surfaced for review, not the default gate.
export type Confidence = 'proven' | 'heuristic';

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
  | 'entrypoint-removed'
  | 'class-constructor-changed'
  | 'type-alias-changed'
  | 'variable-type-changed'
  | 'generic-param-removed'
  | 'generic-constraint-changed'
  | 'overload-removed'
  | 'class-method-signature-changed'
  | 'class-property-type-changed'
  | 'interface-method-removed'
  | 'required-interface-method-added'
  | 'interface-method-signature-changed'
  | 'enum-member-value-changed'
  | 'interface-property-became-required'
  | 'interface-property-became-readonly'
  | 'class-property-became-static'
  | 'class-property-became-instance'
  | 'class-property-became-required'
  | 'required-class-property-added'
  | 'class-property-became-readonly'
  | 'class-method-became-static'
  | 'class-method-became-instance'
  | 'generic-param-default-changed'
  | 'interface-call-signature-changed'
  | 'interface-construct-signature-changed'
  | 'index-signature-changed'
  | 'interface-heritage-changed'
  | 'class-constructor-visibility-narrowed'
  // MINOR
  | 'entrypoint-added'
  | 'generic-param-default-added'
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
  | 'interface-property-became-mutable'
  | 'class-property-became-optional'
  | 'class-property-became-mutable'
  | 'param-type-widened'
  | 'return-type-narrowed'
  | 'class-constructor-visibility-widened';

export interface ApiChange {
  kind: ChangeKind;
  severity: SemverBump;
  symbolPath: string;
  message: string;
  oldValue?: string;
  newValue?: string;
  // Defaults to 'proven' when omitted; the classifier only sets 'heuristic'
  // explicitly, and `diff()` normalizes the rest to 'proven'.
  confidence?: Confidence;
}

// What a release says about itself. changesets adds a fourth release type to
// the three semver bumps: `none` records a change without moving the version.
export type DeclaredBump = SemverBump | 'none';

// How the bump a release declares lines up with what its API surface did.
//
// The split between `required` and `suggested` is the same graded-confidence
// contract `--strict` and `--strict-review` already draw. `required` counts
// proven breaks only and is the one the gate fails on. `suggested` also counts
// additions, which carry no confidence grade of their own yet: every MINOR kind
// falls through to `heuristic` because the allow-list was written for the major
// gate. Failing a build on an ungraded rule is how a gate gets switched off, so
// an addition is reported and nothing more.
export interface BumpDeclaration {
  declared: DeclaredBump;
  // Where the declaration was read from: a changeset path, or the two versions.
  source: string;
  // What the proven breaks require. `major`, or `patch` when there are none.
  required: SemverBump;
  // What the whole change set argues for, review-only breaks and additions
  // alike. This is the same reading as `recommended`, adjusted for a 0.x
  // package, and it never fails a run.
  suggested: SemverBump;
  // 'mismatch' fails the build, 'review' is a note on a passing run, 'ok' is
  // a declaration that covers everything found.
  verdict: 'ok' | 'review' | 'mismatch';
}

export interface SemverReport {
  recommended: SemverBump;
  changes: ApiChange[];
  summary: {
    major: number;
    minor: number;
    patch: number;
    // Breakdown of the `major` count by confidence. `majorProven + majorReview
    // === major`. `--strict` gates on `majorProven`; `--strict-review` on `major`.
    majorProven: number;
    majorReview: number;
  };
  // Present only when a declared bump was supplied or detected.
  declaration?: BumpDeclaration;
}

export interface CompareOptions {
  oldSource: SourceRef;
  newSource: SourceRef;
  // The bump this release declares, or 'auto' to read it from the new side's
  // changesets and, failing that, from the two package.json versions.
  declared?: DeclaredBump | 'auto';
  entry?: string | string[];
  installDeps?: boolean;
}

export type SourceRef =
  | { type: 'path'; path: string }
  | { type: 'git'; ref: string; cwd?: string }
  | { type: 'npm'; spec: string };
