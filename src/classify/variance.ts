import { Project, DiagnosticCategory, Node, SyntaxKind, type Diagnostic } from 'ts-morph';
import type { ApiSymbol, ApiTypeParameter } from '../extract/api-snapshot.js';
import { renderScopeDeclarations } from './scope.js';
import { computeLiteralSpans, isInsideLiteral, mentionsAny } from './literal-spans.js';

// Type variance analysis for semver classification.
//
// Snapshots only preserve serialized type *text* (SerializedType.text), and the
// old/new snapshots come from two independent extraction contexts (different git
// refs / directories), so their ts-morph Type objects cannot be compared with a
// shared TypeChecker. To recover structural assignability we synthesize both type
// texts into a single in-memory program and let the compiler decide.
//
// This turns naive "text differs => major" into variance-aware classification:
//   - parameter widening  (old assignable to new) is non-breaking  -> minor
//   - return  narrowing   (new assignable to old) is non-breaking  -> minor
//   - semantically equivalent texts (e.g. `readonly T[]` vs `ReadonlyArray<T>`)
//     are no-ops, removing a class of false-positive major bumps.
//
// Type-parameter context (optional). Callers that share a generic scope across
// both type texts (function signatures, type aliases) may pass a `context` of
// type parameters; this lets us pre-declare each parameter inside the synthesis
// — at its constraint when one is declared, otherwise at a fresh `unique symbol`
// nominal — so that probes against `T | string` vs `T | string | number` no
// longer fail to resolve `T` and bail to the conservative major.
//
// Package scope (optional, see `setVarianceScope`). A type text is printed by the
// checker, so it freely names types the package declares — `ClassArray |
// ClassDictionary`, `P.Pattern<T>` — and in a program that holds only the ES libs
// none of those resolve. Installing the two snapshots' own declarations is what
// lets the probe answer about them at all.
//
// When a type text still references symbols that cannot be resolved (types from
// another package, bare generic parameters with no shared scope), synthesis fails
// and we return `null` — callers then fall back to the conservative `major`
// verdict, which is where every one of these started.

let sharedProject: Project | undefined;

function getProject(): Project {
  if (!sharedProject) {
    sharedProject = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        // No DOM. The probe resolves a type by name in a project of its own, so a
        // package that declares its own `Element`, `Node`, `Response` or `Event`
        // would otherwise have the global of that name answered about instead: a
        // confident verdict about a type the package never mentions. Without the
        // DOM lib the package's own declaration is the only one of that name in
        // the program, and a name nothing declares resolves to nothing, which
        // reads as undecidable. The ES libs stay, because `Array`, `Promise`,
        // `Record` and friends appear in almost every type text and dropping them
        // would make every probe bail.
        lib: ['lib.es2022.d.ts'],
      },
    });
  }
  return sharedProject;
}

// The probe program used to hold nothing but the ES libs, so a type text naming
// something the package declares about itself (clsx's `ClassArray |
// ClassDictionary`, ts-pattern's `P.Pattern<T>`) failed to resolve and the whole
// comparison bailed to undecidable. `setVarianceScope` renders the two snapshots'
// own declarations into the program so those names resolve.
//
// The two sides go into separate namespaces because the same name means two
// different things across a version boundary. Reopening a namespace from the
// probe file merges with the block installed here, so a probe text written inside
// `__sc_old` sees the old declarations and nothing else. Only structural
// declarations are rendered (see scope.ts), so duplicating an unchanged interface
// across both namespaces costs nothing: two identical shapes are mutually
// assignable, which is the right answer for a type that did not change.
const SCOPE_FILE = '__variance_scope__.ts';
const SCOPED = { old: '__sc_old', new: '__sc_new' } as const;
// Used when the scope must not be consulted, so the probe's namespaces stay
// empty instead of merging with the installed ones.
const BARE = { old: '__sc_old_bare', new: '__sc_new_bare' } as const;
const PROBE_ALIAS = '__sc_probe';

// The declarations installed for the comparison in progress. `declNames` are the
// names the two namespaces declare, on either side: a probe whose generic context
// reuses one of them cannot use the scope, because the namespace member would
// shadow the synthesized type parameter and the probe would answer about the
// package's type instead of the generic.
interface InstalledScope {
  /** Opaque stand-ins, at file scope so both namespaces resolve the same one. */
  stubs: Map<string, string>;
  declNames: Set<string>;
  /** Names the snapshots declare but the scope leaves out; never stood in for. */
  neverStub: Set<string>;
  /** The rendered namespace blocks, without the stubs. */
  lines: string[];
}
let scope: InstalledScope | null = null;

// How many times to re-render after repairing what the compiler rejected. A
// repair cascades (dropping one declaration invalidates another that referenced
// it, stubbing one name reveals the next), but it converges quickly and a scope
// still broken at the end is simply not installed.
const SCOPE_REPAIR_ROUNDS = 8;

// A name the snapshot never held. Type texts are checker-printed, so they freely
// name types the package does not export (ts-pattern's `SelectionType`, `None`,
// `MergeGuards`); rendering an exported declaration that mentions one leaves it
// unresolved, and dropping every declaration that does empties the scope — on
// ts-pattern's `./types` entry that took 35 declarations down to 3.
//
// The stub is declared once, outside both namespaces, so the two sides resolve
// the same name to the *same* type. That is the model the tool already runs on:
// a type text is the API, so a name spelled identically on both sides denotes
// the same thing, and a change hidden inside a non-exported type is invisible
// either way (the texts come out equal, and equal texts return early). What the
// stub must never do is look like some *other* type, so it carries its own name
// as a literal-typed brand: two different unresolved names stay unrelated, which
// keeps a renamed internal a change rather than a no-op.
//
// The eight defaulted parameters are there because a type text can apply an
// unresolved name to type arguments (`ExtractPreciseValue<T, U>`), and a stub
// with too few parameters is an error of its own.
function renderOpaqueStub(name: string): string {
  const params = Array.from({ length: 8 }, (_, i) => `__sc_a${i} = unknown`).join(', ');
  return `type ${name}<${params}> = { readonly __sc_opaque: '${name}' };`;
}

const MISSING_NAME = /^Cannot find name '([A-Za-z_$][A-Za-z0-9_$]*)'/;

// TypeScript refuses `type bigint = ...` and its siblings, so stubbing one of
// these names leaves an error no repair round can clear, and the scope is thrown
// away whole. valibot lost all 449 of its declarations to three such stubs. A
// name in this set is never missing in the first place, so declining to stub it
// costs nothing: whatever declaration provoked the diagnostic is dropped instead.
const RESERVED_TYPE_NAMES: ReadonlySet<string> = new Set([
  'any', 'unknown', 'never', 'string', 'number', 'bigint', 'boolean',
  'symbol', 'void', 'object', 'undefined', 'null', 'intrinsic',
]);

function diagnosticText(d: Diagnostic): string {
  const m = d.getMessageText();
  return typeof m === 'string' ? m : m.getMessageText();
}

/**
 * Install both snapshots' own declarations into the probe program.
 *
 * A rendered declaration the compiler rejects (a type text referencing something
 * the snapshot never exported, a member name that does not round-trip) is dropped
 * and the scope re-rendered, because a declaration that errors resolves to the
 * error type — and the error type is assignable in both directions, which would
 * turn a real break into a confident "equivalent". Dropping it restores the bail
 * the probe had before this existed. If errors cannot be attributed to a single
 * declaration, no scope is installed at all.
 */
export function setVarianceScope(
  oldSymbols: Record<string, ApiSymbol>,
  newSymbols: Record<string, ApiSymbol>,
): void {
  clearVarianceScope();
  const rendered = [renderScopeDeclarations(oldSymbols), renderScopeDeclarations(newSymbols)];
  scope = {
    stubs: new Map(),
    declNames: new Set(),
    neverStub: new Set(rendered.flatMap((r) => [...r.omitted])),
    lines: [],
  };
  const sides = [
    { ns: SCOPED.old, decls: rendered[0].declarations },
    { ns: SCOPED.new, decls: rendered[1].declarations },
  ];
  if (sides.every((side) => side.decls.size === 0)) {
    clearVarianceScope();
    return;
  }

  const project = getProject();
  for (let round = 0; round <= SCOPE_REPAIR_ROUNDS; round++) {
    scope.declNames = new Set(sides.flatMap((side) => [...side.decls.keys()]));
    // One declaration per line, so a diagnostic's line number names the
    // declaration that produced it.
    const lines: string[] = [];
    const owner = new Map<number, { side: (typeof sides)[number]; name: string }>();
    const stubCount = scope.stubs.size;
    for (const side of sides) {
      lines.push(`declare namespace ${side.ns} {`);
      for (const [name, text] of side.decls) {
        lines.push(text);
        owner.set(stubCount + lines.length, { side, name });
      }
      lines.push('}');
    }
    scope.lines = lines;
    writeScopeFile();
    const errors = project
      .getSourceFileOrThrow(SCOPE_FILE)
      .getPreEmitDiagnostics()
      .filter((d) => d.getCategory() === DiagnosticCategory.Error);
    if (errors.length === 0) return;
    // Stub first, drop second. A name that is merely absent can be supplied;
    // only a declaration still broken once every name it uses exists has to go.
    if (stubMissingNames(errors)) continue;
    let dropped = false;
    for (const d of errors) {
      const line = d.getLineNumber();
      const entry = line === undefined ? undefined : owner.get(line);
      if (!entry) continue;
      entry.side.decls.delete(entry.name);
      dropped = true;
    }
    if (!dropped) break;
  }
  // The declarations could not be made to compile, so none of them are installed:
  // a declaration that errors resolves to the error type, and the error type is
  // assignable in both directions, which would turn a real break into a confident
  // "equivalent".
  clearVarianceScope();
}

/** Drop the installed scope. Callers must do this when a comparison ends. */
export function clearVarianceScope(): void {
  scope = null;
  const existing = getProject().getSourceFile(SCOPE_FILE);
  if (existing) getProject().removeSourceFile(existing);
}

// The scope is consulted unless one of the shared generics would be shadowed by a
// declaration of the same name.
function namespacesFor(typeParameters: ApiTypeParameter[]): typeof SCOPED | typeof BARE {
  if (scope === null) return BARE;
  return typeParameters.some((tp) => scope!.declNames.has(tp.name)) ? BARE : SCOPED;
}

function writeScopeFile(): void {
  const s = scope;
  if (!s) return;
  getProject().createSourceFile(SCOPE_FILE, [...s.stubs.values(), ...s.lines].join('\n') + '\n', {
    overwrite: true,
  });
}

// Supply an opaque stand-in for every name a diagnostic reports as absent, and
// report whether anything was added. A name one side actually declares is left
// alone: stubbing it would give that side the real declaration and the other side
// the stub, and the two would compare as unrelated types for no reason. The
// declaration that named it is dropped instead.
function stubMissingNames(errors: Diagnostic[]): boolean {
  const s = scope;
  if (!s) return false;
  let added = false;
  for (const d of errors) {
    const hit = MISSING_NAME.exec(diagnosticText(d));
    if (!hit) continue;
    const name = hit[1];
    if (s.stubs.has(name) || s.declNames.has(name) || s.neverStub.has(name)) continue;
    if (RESERVED_TYPE_NAMES.has(name)) continue;
    s.stubs.set(name, renderOpaqueStub(name));
    added = true;
  }
  if (added) writeScopeFile();
  return added;
}

// Synthesize one nominal `type T = Constraint & { [brand]: 'nominal' };` per
// shared generic. The intersection with a fresh `unique symbol` brand makes `T`
// a *distinct* subtype of its constraint (or of `unknown` when no constraint is
// declared), so probes like `T` vs `string` no longer collapse to a no-op when
// the constraint is `string` — the brand is missing on the right-hand side, so
// variance correctly returns `oldToNew=true, newToOld=false` (wider) instead of
// erasing a real breaking change. Forward references between aliases are legal
// in TypeScript, so the brand pass and the alias pass can be split without
// caring about declaration order between mutually-referencing parameters.
function buildTypeParamPrefix(typeParameters: ApiTypeParameter[]): { text: string; lines: number } {
  if (typeParameters.length === 0) return { text: '', lines: 0 };
  const lines: string[] = [];
  typeParameters.forEach((_tp, i) => {
    lines.push(`declare const __sc_brand_${i}: unique symbol;`);
  });
  // Each constraint is aliased on its own line *before* the brand intersection
  // is applied. A naked `string | number & { brand }` would bind `&` tighter
  // than `|` and brand only the last union branch, leaving the rest as a
  // bidirectionally assignable `number` and producing a false MINOR. Aliasing
  // first forces the whole constraint to act as a single token so the brand
  // applies to every branch.
  typeParameters.forEach((tp, i) => {
    const base = tp.constraint ? tp.constraint.text : 'unknown';
    lines.push(`type __sc_constraint_${i} = ${base};`);
    lines.push(`type ${tp.name} = __sc_constraint_${i} & { readonly [__sc_brand_${i}]: 'nominal' };`);
  });
  return { text: lines.join('\n') + '\n', lines: lines.length };
}

/**
 * Returns whether one side's type is assignable to the other's, in `direction`.
 * `null` means the relation is undecidable (a type text could not be resolved
 * in isolation) and the caller should treat the change conservatively.
 *
 * When `typeParameters` is supplied, the probe is widened with same-named
 * declarations for each parameter so bare generics resolve standalone.
 */
function isAssignable(
  oldText: string,
  newText: string,
  direction: 'oldToNew' | 'newToOld',
  typeParameters: ApiTypeParameter[] = [],
): boolean | null {
  const project = getProject();
  const prefix = buildTypeParamPrefix(typeParameters);
  const ns = namespacesFor(typeParameters);
  // Each side's text is declared inside its own version's namespace, so a name
  // the package declares resolves to that version's declaration. The type
  // parameter brands stay at file scope, where both namespaces can see them.
  const from = direction === 'oldToNew' ? ns.old : ns.new;
  const to = direction === 'oldToNew' ? ns.new : ns.old;
  // Probe line: 2 namespace defs + 1 declare + assignment = +4 from prefix.
  const assignLine = prefix.lines + 4;
  const content =
    prefix.text +
    `declare namespace ${ns.old} { type ${PROBE_ALIAS} = ${oldText}; }\n` +
    `declare namespace ${ns.new} { type ${PROBE_ALIAS} = ${newText}; }\n` +
    `declare const __from: ${from}.${PROBE_ALIAS};\n` +
    `const __to: ${to}.${PROBE_ALIAS} = __from;\n`;

  const sourceFile = project.createSourceFile('__variance_probe__.ts', content, { overwrite: true });
  try {
    const errors = sourceFile
      .getPreEmitDiagnostics()
      .filter((d) => d.getCategory() === DiagnosticCategory.Error);

    if (errors.length === 0) {
      return true;
    }

    // An error on either namespace definition (or the declaration) means the
    // type text could not be resolved standalone -> undecidable.
    const hasDefinitionError = errors.some((d) => {
      const line = d.getLineNumber();
      return line === undefined || line < assignLine;
    });
    if (hasDefinitionError) {
      return null;
    }

    // Errors confined to the assignment line: the value is not assignable.
    return false;
  } finally {
    project.removeSourceFile(sourceFile);
  }
}

export interface TypeRelation {
  /** old value is assignable to new type (new type is wider or equal). */
  oldToNew: boolean;
  /** new value is assignable to old type (new type is narrower or equal). */
  newToOld: boolean;
}

/**
 * Compares two serialized type texts and reports their assignability relation.
 * Returns `null` when the relation cannot be decided (unresolvable types),
 * signalling callers to fall back to the conservative classification.
 *
 * Interpretation:
 *   - both true  -> structurally equivalent (no-op)
 *   - oldToNew only -> new type is wider  (parameter-safe widening)
 *   - newToOld only -> new type is narrower (return/read-safe narrowing)
 *   - both false -> unrelated change (breaking)
 */
// Conditional types over a *branded* type parameter are unsafe to compare via
// the brand synthesis. `buildTypeParamPrefix` declares each shared generic as a
// concrete nominal (`type A = unknown & { brand }`); a concrete type makes the
// compiler *eagerly* evaluate any conditional whose check/extends operand is `A`
// (instead of deferring it as a distributive conditional), collapsing it to one
// branch. Two distinct conditionals (`A extends "B" ? 1 : 0` vs `A extends "Z"
// ? 1 : 0`) then both collapse to the same constant and look equivalent — a
// real breaking change silently classified as patch. `infer` is only legal
// inside a conditional, so this guard also covers `A extends Array<infer E> ?`.
//
// We detect the hazard syntactically (ts-morph parse, no resolution needed) and
// let the caller fall back to a conservative textual comparison.
function referencesTypeParamInConditional(text: string, tpNames: Set<string>): boolean {
  if (tpNames.size === 0) return false;
  const project = getProject();
  const sourceFile = project.createSourceFile('__cond_probe__.ts', `type __c = ${text};\n`, {
    overwrite: true,
  });
  try {
    let found = false;
    const operandReferencesTp = (operand: Node): boolean => {
      if (Node.isIdentifier(operand) && tpNames.has(operand.getText())) return true;
      return operand
        .getDescendantsOfKind(SyntaxKind.Identifier)
        .some((id) => tpNames.has(id.getText()));
    };
    sourceFile.forEachDescendant((node) => {
      if (found) return;
      if (Node.isConditionalTypeNode(node)) {
        if (operandReferencesTp(node.getCheckType()) || operandReferencesTp(node.getExtendsType())) {
          found = true;
        }
      }
    });
    return found;
  } finally {
    project.removeSourceFile(sourceFile);
  }
}

// Conservative textual equality used only when the conditional guard fires:
// strip balanced outer parens so that a pure no-op rewrite (e.g. wrapping the
// whole type in parentheses) is still treated as equivalent, while any other
// textual difference is left to the conservative major verdict. Snapshot type
// texts are already whitespace-collapsed by the extractor, so only `trim` is
// needed here. Parens inside string/template literal bodies are ignored via the
// shared literal-span tracker, matching the extractor's string-aware strip — a
// `)` inside a literal must not desync the depth counter.
function normalizeForCompare(text: string): string {
  let s = text.trim();
  while (s.length >= 2 && s.startsWith('(') && s.endsWith(')')) {
    const spans = computeLiteralSpans(s);
    let depth = 0;
    let wrapsWhole = true;
    for (let i = 0; i < s.length; i++) {
      if (isInsideLiteral(spans, i, i + 1)) continue;
      if (s[i] === '(') depth++;
      else if (s[i] === ')') {
        depth--;
        if (depth === 0 && i < s.length - 1) {
          wrapsWhole = false;
          break;
        }
      }
    }
    if (!wrapsWhole) break;
    s = s.slice(1, -1).trim();
  }
  return s;
}

export interface VarianceContext {
  /**
   * Type parameters that both texts share. Names must already be aligned
   * across the two snapshots (callers alpha-rename ahead of time). Passing an
   * empty array is equivalent to omitting the context.
   */
  typeParameters: ApiTypeParameter[];
}

// Which of a set of scope names a type text mentions. Matches inside a string or
// template literal body are not identifiers, so the shared literal-span tracker
// skips them.
function namesMentionedIn(text: string, holds: (name: string) => boolean): Set<string> {
  const named = new Set<string>();
  const spans = computeLiteralSpans(text);
  const re = /[A-Za-z_$][A-Za-z0-9_$]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (isInsideLiteral(spans, m.index, m.index + m[0].length)) continue;
    if (holds(m[0])) named.add(m[0]);
  }
  return named;
}

function differs(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return true;
  for (const name of a) if (!b.has(name)) return true;
  return false;
}

// A stand-in is an assumption, not knowledge: it says the two sides mean the same
// unknown by the same name, and nothing about what that unknown is. When both
// texts name the same stand-ins the assumption cancels out — `Handle` against
// `Handle | null` is a widening whatever `Handle` turns out to be. When the sets
// differ it does not: `AlphaShape` against `BetaShape` probes as two unrelated
// types because their stand-ins are unrelated by construction, and the package
// may simply have renamed an internal shape no consumer can name.
function restsOnDifferentStubs(oldText: string, newText: string): boolean {
  const s = scope;
  if (!s || s.stubs.size === 0) return false;
  const holds = (name: string): boolean => s.stubs.has(name);
  return differs(namesMentionedIn(oldText, holds), namesMentionedIn(newText, holds));
}

// Whether the two texts reach the scope through different declarations.
function namesDifferentDeclarations(oldText: string, newText: string): boolean {
  const s = scope;
  if (!s || s.declNames.size === 0) return false;
  const holds = (name: string): boolean => s.declNames.has(name);
  return differs(namesMentionedIn(oldText, holds), namesMentionedIn(newText, holds));
}

export function compareTypeText(
  oldText: string,
  newText: string,
  context?: VarianceContext,
): TypeRelation | null {
  if (oldText === newText) {
    return { oldToNew: true, newToOld: true };
  }

  if (mentionsAny(oldText) || mentionsAny(newText)) {
    return null;
  }

  // A constraint of `any` would re-introduce the bidirectional-assignability
  // hazard the textual `mentionsAny` guard exists to prevent: once we declare
  // `type T = any & { brand }`, `T` becomes assignable to *anything* in the
  // probe and equivalence becomes meaningless. Bail to the conservative major.
  const typeParameters = context?.typeParameters ?? [];
  if (typeParameters.some((tp) => tp.constraint && mentionsAny(tp.constraint.text))) {
    return null;
  }

  // Conditional types whose check/extends operand is one of the shared type
  // parameters cannot be trusted through the brand synthesis (see
  // `referencesTypeParamInConditional`). Fall back to a conservative textual
  // comparison: a pure no-op rewrite stays equivalent, anything else is major.
  const tpNames = new Set(typeParameters.map((tp) => tp.name));
  if (
    referencesTypeParamInConditional(oldText, tpNames) ||
    referencesTypeParamInConditional(newText, tpNames)
  ) {
    return normalizeForCompare(oldText) === normalizeForCompare(newText)
      ? { oldToNew: true, newToOld: true }
      : null;
  }

  const oldToNew = isAssignable(oldText, newText, 'oldToNew', typeParameters);
  if (oldToNew === null) {
    return null;
  }

  const newToOld = isAssignable(oldText, newText, 'newToOld', typeParameters);
  if (newToOld === null) {
    return null;
  }

  // The probe answered, but check what it answered about first.
  if (restsOnDifferentStubs(oldText, newText)) {
    return null;
  }

  // Mutual assignability is not identity. TypeScript ignores `readonly` on a
  // property, compares a method bivariantly where it compares a function-typed
  // property strictly, drops `this` parameters, and applies the excess-property
  // check only to a fresh object literal. Two declarations can therefore be
  // mutually assignable while a consumer stops compiling when one is swapped for
  // the other. That does not matter while both texts name the same declarations
  // — the difference between them is then something the probe did look at — but
  // "these two are the same type" is the strongest claim available here and it
  // is not one assignability can support across a change of name.
  if (oldToNew && newToOld && namesDifferentDeclarations(oldText, newText)) {
    return null;
  }

  return { oldToNew, newToOld };
}
