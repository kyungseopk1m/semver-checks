import { Project, DiagnosticCategory } from 'ts-morph';

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
// When a type text references symbols that cannot be resolved in isolation
// (imported types, bare generic parameters like `T`), synthesis fails and we
// return `null` — callers then fall back to the conservative `major` verdict,
// preserving the previous behaviour with zero regression risk.

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

// Line of the assignment probe in the synthesized source (1-based). Type texts
// are pre-normalized to a single line by normalizeTypeText(), so the two
// type-alias definitions occupy lines 1-2 and the assignment lands on line 4;
// any error before this line means a type text failed to resolve standalone.
const ASSIGN_LINE = 4;

/**
 * Returns whether a value of `fromText` is assignable to `toText`.
 * `null` means the relation is undecidable (a type text could not be resolved
 * in isolation) and the caller should treat the change conservatively.
 */
function isAssignable(fromText: string, toText: string): boolean | null {
  const project = getProject();
  const content =
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
      return line === undefined || line < ASSIGN_LINE;
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
function mentionsAny(text: string): boolean {
  return /\bany\b/.test(text);
}

export function compareTypeText(oldText: string, newText: string): TypeRelation | null {
  if (oldText === newText) {
    return { oldToNew: true, newToOld: true };
  }

  if (mentionsAny(oldText) || mentionsAny(newText)) {
    return null;
  }

  const oldToNew = isAssignable(oldText, newText);
  if (oldToNew === null) {
    return null;
  }

  const newToOld = isAssignable(newText, oldText);
  if (newToOld === null) {
    return null;
  }

  return { oldToNew, newToOld };
}
