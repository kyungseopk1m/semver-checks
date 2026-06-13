import { Project, DiagnosticCategory, Node, SyntaxKind } from 'ts-morph';
import type { ApiTypeParameter } from '../extract/api-snapshot.js';
import { computeLiteralSpans, isInsideLiteral } from './literal-spans.js';

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
// When a type text references symbols that cannot be resolved in isolation
// (imported types, bare generic parameters with no shared scope), synthesis
// still fails and we return `null` — callers then fall back to the conservative
// `major` verdict, preserving the previous behaviour with zero regression risk.

let sharedProject: Project | undefined;

function getProject(): Project {
  if (!sharedProject) {
    sharedProject = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        strict: true,
        noEmit: true,
        skipLibCheck: true,
      },
    });
  }
  return sharedProject;
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
 * Returns whether a value of `fromText` is assignable to `toText`.
 * `null` means the relation is undecidable (a type text could not be resolved
 * in isolation) and the caller should treat the change conservatively.
 *
 * When `typeParameters` is supplied, the probe is widened with same-named
 * declarations for each parameter so bare generics resolve standalone.
 */
function isAssignable(fromText: string, toText: string, typeParameters: ApiTypeParameter[] = []): boolean | null {
  const project = getProject();
  const prefix = buildTypeParamPrefix(typeParameters);
  // Probe line: 2 type-alias defs + 1 declare + assignment = +4 from prefix.
  const assignLine = prefix.lines + 4;
  const content =
    prefix.text +
    `type __From = ${fromText};\n` +
    `type __To = ${toText};\n` +
    `declare const __from: __From;\n` +
    `const __to: __To = __from;\n`;

  const sourceFile = project.createSourceFile('__variance_probe__.ts', content, { overwrite: true });
  try {
    const errors = sourceFile
      .getPreEmitDiagnostics()
      .filter((d) => d.getCategory() === DiagnosticCategory.Error);

    if (errors.length === 0) {
      return true;
    }

    // An error on either type-alias definition (or the declaration) means the
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
// `any` is bidirectionally assignable to every type, so the assignability probe
// reports `any` <-> T as "equivalent" — which would erase a real breaking change
// (e.g. `type T = any` -> `type T = string` lets `let x: T = 1` break). When
// either side mentions `any` and the texts differ, the relation is untrustworthy,
// so we bail to the conservative `null` (caller keeps the major verdict).
//
// Matches inside string / template literal bodies are *not* the `any` keyword —
// they are string literal types whose textual value happens to be (or contain)
// the word "any". The shared literal-span tracker handles single quotes, double
// quotes, backticks, escape sequences, and template-literal placeholders.
function mentionsAny(text: string): boolean {
  const spans = computeLiteralSpans(text);
  const re = /\bany\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (isInsideLiteral(spans, m.index, m.index + 2)) continue;
    return true;
  }
  return false;
}

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

  const oldToNew = isAssignable(oldText, newText, typeParameters);
  if (oldToNew === null) {
    return null;
  }

  const newToOld = isAssignable(newText, oldText, typeParameters);
  if (newToOld === null) {
    return null;
  }

  return { oldToNew, newToOld };
}
