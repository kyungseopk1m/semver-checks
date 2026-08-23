[![npm version](https://img.shields.io/npm/v/semver-checks.svg)](https://www.npmjs.com/package/semver-checks)
[![CI](https://github.com/kyungseopk1m/semver-checks/actions/workflows/ci.yml/badge.svg)](https://github.com/kyungseopk1m/semver-checks/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%5E20.0.0%20%7C%7C%20%3E%3D22.0.0-green.svg)](https://nodejs.org/)

# semver-checks

Catch the breaking changes your commit messages miss. semver-checks analyzes what actually changed in your TypeScript public API and recommends the correct semver bump.

```bash
npx semver-checks compare v1.0.0 HEAD
```

- [Why semver-checks?](#why-semver-checks)
- [Accuracy & Limitations](#accuracy--limitations)
- [Quick Start](#quick-start)
- [Programmatic API](#programmatic-api)
- [Change Rules](#change-rules)
- [CLI Reference](#cli-reference)
- [MCP Server](#mcp-server)
- [CI Integration](#ci-integration)
- [Comparison with Other Tools](#comparison-with-other-tools)
- [How It Works](#how-it-works)
- [FAQ](#faq)

## Why semver-checks?

Tools like `semantic-release` and `changesets` rely on developers writing correct commit messages. In practice, commit messages don't always reflect actual API impact — a "small refactor" that removes a required export gets published as a patch, and downstream consumers' builds break.

semver-checks **analyzes your TypeScript public API directly** using [ts-morph](https://github.com/dsherret/ts-morph) and recommends the correct SemVer bump based on what actually changed in the type signatures — not what the commit message says.

This is not hypothetical. Run it across real releases and it flags breaking type changes that shipped as minors or patches — for example, `p-limit` 6.1.0 added a required property to its exported `LimitFunction` type and was published as a _minor_; semver-checks flags it MAJOR. It is most dependable on **structural changes** — removed or renamed exports, narrowed signatures, added required parameters and properties — which it detects reliably. Equivalence-preserving type rewrites are a known weak spot it can over-report; see [Accuracy & Limitations](#accuracy--limitations) for exactly where to trust it and where not to.

```typescript
// v1.0.0
export interface Config {
  host: string;
  port: number;
}

// Developer writes: "fix: add missing timeout config"
// Published as patch — but this is a MAJOR change:
export interface Config {
  host: string;
  port: number;
  timeout: number;
}
//                                                    ^^^^^^^^^^^^^^^^ required-property-added
```

```typescript
// v1.0.0
export function findUser(id: string): User | null;

// Developer writes: "refactor: simplify findUser return"
// Published as minor — but consumers checking `result === null` silently break at runtime:
export function findUser(id: string): User;
//                                    ^^^^ return-type-changed (MAJOR)
```

semver-checks is complementary to your existing release workflow. Use it as a **verification step** before publishing — it tells you whether your intended bump is safe, or whether you're about to ship a breaking change by accident.

## Accuracy & Limitations

semver-checks grades every breaking change by **confidence**, so the CI gate stays trustworthy:

- **proven** — the change is its own evidence (a removed export, property, interface method, class property or class method; a newly required parameter, interface method or interface property), a _resolved_ type relation the analyzer decided is genuinely unrelated, or a rule that computed the answer itself (a dropped base that carried something; a required property added to a class anyone could have implemented by hand). `--strict` exits 1 on these, and only these — safe to leave on in CI. Proven is earned per rule, not inherited: a rule either computes its own confidence or is on that short list, and everything else is review-only. The list is short because it is empirical — see [Measured](#accuracy--limitations) below.
- **heuristic** — a conservative MAJOR the analyzer could _not_ prove (a type-text difference it couldn't resolve, or a one-directional change in an invariant position where a safe reading exists). These surface for human review but do **not** fail `--strict`; opt in with `--strict-review` if you want every MAJOR to gate.

This is the design's center of gravity: the equivalence-preserving rewrites and input-union widenings that make text-based type-semver tools cry wolf land in _heuristic_, off the default gate, while real under-bumps stay _proven_ and on it. It is neither _sound_ (zero false positives) nor _complete_ (catches everything), so a `proven` MAJOR is a strong signal, not a theorem. That isolation only covers the over-reporting surfaces in [Known limitations](#known-limitations); the under-report and structural rows in the same table are a different axis, a silent `patch` or an outright failure, not a confidence question.

It is most reliable on **conventional, single-entry packages with an explicitly-typed public surface**: added / removed / renamed exports, function and method signature changes, added required parameters and properties, and removed members are detected dependably and reported as `proven`.

**Measured, against a compiler.** The scorecard that decides which rules are `proven` uses `tsc` as its oracle, not the author's published bump - the tool exists because authors get the bump wrong, so scoring it against that bump would be circular. Each of 111 adjacent minor/patch release pairs, across 24 packages, has a consumer program compiled against both sides; the pair is a real break iff the new side produces errors the old side did not. Major-version boundaries are excluded: there the author already knows the release is breaking, so the tool's verdict carries no decision value.

On that corpus `--strict` fires on 36 of 111 pairs. 35 of those 36 are real breaks, so precision is 97.2%. **Recall is 81.4%: the corpus holds 43 real breaks and `--strict` stays quiet on 8 of them.**

Read the recall, not the precision. An earlier revision of this file reported 100% recall on a 75-pair corpus, and that was a fact about which shapes the corpus contained rather than about the tool: widening a corpus to 111 pairs, and re-examining every pair it had scored safe by reading the shipped `.d.ts` and writing a consumer that uses the changed symbol the way the package's own README does, took the same number to 37.8%. Grading recovered it to 67.4%, giving the variance probe the package's own declarations to read took it to 79.1%, and reading a class the way an interface was already read took it from there. Nothing was suppressed to get the precision figure; the one remaining false positive is described below.

`any confidence` still fires on all 43 pairs, so nothing here is a detection gap in the sense of the tool not noticing. What kept `--strict` quiet on most of the 14 that used to remain was that the variance probe had no verdict to give: a serialized type text is printed by the checker, so it names the types the package declares about itself, and the probe resolved those names in a program that held nothing but the ES libs. `ClassArray | ClassDictionary` in `clsx`, `P.Pattern<T> & UnknownProperties` in `ts-pattern` and `core.$ZodTypeDiscriminable<Disc>` in `zod` all sent it home empty. The probe now reads both snapshots' own declarations (see [What the probe will and will not answer about](#what-the-probe-will-and-will-not-answer-about)), which is what closes five of them.

Of the 8 left, three are not a probe question at all: on `hono` 4.12.18 -> 4.12.19, `hono` 4.12.19 -> 4.12.20 and `ky` 1.14.1 -> 1.14.2 the reported findings are provably inert while the change that actually breaks a consumer is reported nowhere, so even the `any confidence` figure is a per-pair coincidence on those three. Of the rest, `got` 14.6.4 -> 14.6.5 needs signature-level variance, `ts-pattern` 5.6.0 -> 5.6.1 is a `generic-constraint-changed`, which fires on a loosened constraint as readily as on a tightened one, and `bullmq` 5.80.11 -> 5.80.12 replaces a callback type with one that mentions `any`, where the probe bails on purpose. The last two are the probe declining to guess: `hono` 4.12.28 -> 4.12.29 widens a return type with a second `aws-lambda` type the old text never named, so the verdict would rest on two stand-ins being unrelated, and `valibot` 1.3.1 -> 1.4.0 turns a tuple parameter `readonly` through an alias the scope could not resolve.

Two shapes account for most of what the grading now catches, and both were invisible on the narrower corpus:

- **A widening that breaks readers, not writers.** An optional property gains `| null`, a union gains a member, a return type gains an alternative. Passing a value in still compiles; reading one back out into the old type does not. It appears in `ioredis`, `bullmq`, `ky`, `commander`, `hono`, `got` and `clsx`.
- **An interface gaining or losing members.** Losing one breaks callers, gaining a required one breaks implementers, and subclassing hides both because a subclass inherits whatever was added. The interface rules are `proven` for that reason. On a class the added-member rule is `proven` only where a hand-written implementation was possible in the first place: a class declaring a private or protected instance member is compared nominally, so no object literal satisfies it and there is no implementer to break.

The control group is [`scripts/gate/naive-baseline.mjs`](scripts/gate/naive-baseline.mjs), a 45-line exported-name-and-arity diff with no type resolution at all, kept to answer the obvious question: does the type analysis buy anything a much dumber tool does not already get? It scores 87.5% precision and 32.6% recall on the same corpus, against 97.2% and 81.4%. They overlap on 14 breaks, 21 belong to the type analysis alone, none to the baseline alone, and 8 defeat both.

The 21 are the answer to the question, and they are the shapes a name-and-arity diff cannot reach. Among them:

- `commander` 11.0.0 -> 11.1.0 widened `Command#executableDir()`'s return type from `string` to `string | null` in a minor. No name moved, no parameter count changed.
- `@sinclair/typebox` 0.34.51 -> 0.34.52 dropped the `StringUtil` namespace from its `./compiler` entry, which takes resolving the surface of that subpath to see.
- `hono` 4.12.29 -> 4.12.30 narrowed a parameter of `WSContextInit#send`.
- `ioredis` 5.8.1 -> 5.8.2 added two members to the `Command.FLAGS` object, which breaks a consumer keying a lookup table off `keyof typeof Command.FLAGS`.
- `p-limit` 6.0.0 -> 6.1.0 added a required property to the `LimitFunction` object alias, which breaks a hand-written test stub.

The baseline's own false positives point the other way: removals inside `internal/` files or underscore-prefixed members, which no consumer could import in the first place. Reading declarations rather than files is what separates the public surface from the implementation.

One false positive remains, and it is a deliberate over-report rather than a defect. On `zod` 4.3.6 -> 4.4.0 the literal type of the exported `version` constant changed from `{ minor: 3 }` to `{ minor: 4 }`. That breaks a consumer who writes the literal down - either pinning it or comparing against it, since `version.minor === 3` becomes a no-overlap error - and nothing else. Suppressing it would take a heuristic that guesses which exported constants are version stamps by name.

**The same rule cuts the other way, and a grading pass learned it the hard way.** A finding called breaking is also a hypothesis. Every promotion was checked against the corpus, which agreed, and then checked again by constructing the release that ought to have been harmless and compiling it. Eleven shapes came back where no consumer breaks and the gate failed anyway, none of them in the corpus:

- **A parameter renamed in a call signature**, and **an optional trailing parameter added to one**. Names play no part in structural assignability and an optional parameter obliges nobody, but the signature set is compared as printed text. `interface-call-signature-changed` is review-only for that reason, which also costs a real break: `got` 14.6.4 to 14.6.5 added a leading overload, and separating that from adding an optional parameter takes signature-level variance the text comparison does not do.
- **A member moving between an interface and one of its bases**, in either direction, and **a base inlined into the interface that extended it**. Inherited members are deliberately not flattened, so a move reads as a removal on one side and an addition on the other. The bases are resolved now, and a member still reachable through one is not reported at all.
- **A base dropped that declared nothing**, the marker-interface case, and **a base whose members the interface now declares itself**. A dropped base is proven only when something it carried is no longer on the surface. A base still listed under the same name with different type arguments is not a drop at all and stays proven, since re-parameterizing moves the types of everything it contributes.
- **A base added whose members are all optional**, which is how shared knobs get factored out in a minor.
- **A package that declares its own `Element`, `Node`, `Response` or `Event`.** The variance probe resolves a type by name in a project of its own, which carried the DOM lib, so it answered about the global of that name instead. It carries only the ES libs now, and a name it cannot resolve reads as undecidable rather than as a verdict.

Each shape is pinned by a fixture, because the corpus contains none of them and its numbers did not move when they were fixed. That is the same blindness the recall figure above is about, seen from the other side.

### What the probe will and will not answer about

The variance probe decides whether one serialized type text is assignable to the other by synthesizing both into one in-memory program and asking the compiler. That program is given the two snapshots' own declarations, rendered back into ambient form, the old side under one namespace and the new side under another. Without them a text naming anything the package declares about itself resolves to nothing and the probe reports undecidable, which is what kept `--strict` quiet on releases it had already noticed.

Three limits are deliberate, and each one is a place the probe answers "I cannot tell" rather than guessing:

- **Enums and classes are not rendered.** The two sides go into separate namespaces, and those two constructs are nominal, so the same unchanged enum would appear as two unrelated types and every text mentioning it would probe as an unrelated change. A name left out this way is left unresolved, not stood in for, because a stand-in is an object type carrying a brand and an interface extending an omitted class would inherit a member the class never had.
- **A declaration mentioning `any` is not installed.** `any` is assignable in both directions, so one member typed `any` makes its whole containing type bidirectionally assignable, and `Sink` compares equivalent to `Sink & { write(chunk: Uint8Array): void }`. The probe already bails when either *compared* text mentions `any`; installing a declaration that mentions one routes around that guard, because neither compared text has to say the word. The name is left to a stand-in instead, which is assignable to nothing it is not.
- **A name no declaration covers gets an opaque stand-in**, shared by both sides so that the same spelling means the same type — the model the whole tool already runs on. Type texts routinely name types a package does not export (`ts-pattern` reaches for `SelectionType`, `MergeGuards` and eight more from the entry point that declares none of them), and without stand-ins every declaration mentioning one has to be dropped, which took that entry from 35 declarations to 3.
- **A verdict that rests on the stand-ins being distinct is thrown away.** Two different unresolved names probe as unrelated types by construction, so a package that renamed an internal shape no consumer can even name would fail the gate. When the two texts name different stand-ins the relation goes back to undecidable and the finding stays review-only.
- **"These two are the same type" is not a claim assignability can support across a change of name.** TypeScript ignores `readonly` on a property, compares a method bivariantly where it compares a function-typed property strictly, drops `this` parameters, and applies the excess-property check only to a fresh object literal, so two declarations can be mutually assignable while swapping one for the other stops a consumer compiling. When the probe answers "equivalent" and the two texts name different declarations, the finding is reported review-only rather than dropped. A pure textual rewrite (`readonly T[]` against `ReadonlyArray<T>`) names the same declarations on both sides and is still a no-op.

A rendered declaration the compiler rejects is dropped and the scope re-rendered until what is left compiles; if it cannot be made to compile at all, none of it is installed. A declaration that errors resolves to the error type, and the error type is assignable in both directions, which would turn a real break into a confident "equivalent".

**A finding called safe is a hypothesis until it is compiled.** Over two passes, eight findings recorded here or in the test suite as deliberate over-reports were re-examined by writing a consumer for the flagged symbol, and eight of them were real breaks: `hono` 4.12.29 -> 4.12.30 (the existing probe tested only the contravariant implementer position and nobody had compiled a caller), `jose` 6.2.4 -> 6.2.5, `kysely` 0.29.2 -> 0.29.3, `lru-cache` 11.5.0 -> 11.5.1, `highlight.js` 11.9.0 -> 11.10.0, `ioredis` 5.8.1 -> 5.8.2, `axios` 1.18.1 -> 1.19.0, and the `clsx` input-union widening this file used to cite as the archetypal safe change. Each is in the corpus now.

Reproduce with `node scripts/gate/run.mjs`; the corpus, the consumers, and the per-pair results are checked in.

**Measured, against published bumps.** A second, older scorecard uses the author's published bump as its oracle rather than a compiler, across 44 adjacent real-world npm release pairs (`.d.ts` ↔ `.d.ts`, seven API shapes). 32 are analyzable. Of those, 16 match the published bump exactly, 10 are _stricter_ than it, and 6 are _looser_. The graded gate splits the 10 stricter rows: `--strict` fires on 6 — real breaks the author shipped under-bumped, including `p-limit` 6.1.0 and `ky` 1.14.0, which each added a required property to an exported type yet released as a minor (`tsc` confirms a `TS2741` for implementers), `commander` 12.1.0, which removed a public method, and `clsx` 2.1.1, whose input-union widening this file used to cite as the archetypal false positive — while the other 4 demote to review-only and pass the gate. Most of the looser results are releases bumped for runtime-only reasons with no public _type_ change.

The 12 unanalyzable rows are the honest part of this table: 3 exhaust memory on `type-fest`, and 9 are packages this tool refuses to guess about because it could extract no surface at all — `picocolors` and `escape-string-regexp` ship no bundled declarations, `yargs` and `ts-toolbelt` resolve to something empty. That count went up rather than down when extraction improved, because a failure that used to be reported as a clean `patch` is now an exit 2. Reproduce the scorecard with [`scripts/accuracy-probe.mjs`](scripts/accuracy-probe.mjs) (after `npm run build`), or spot-check your own dependencies:

```bash
npx semver-checks compare <pkg>@<previous> <pkg>@<latest>
```

### Known limitations

Ten known gaps, grouped by direction: three over-report as review-only `heuristic` MAJORs that never fail `--strict` (equivalence-preserving type rewrites, input-position union widening, return-only generics); four under-report as a silent `patch` (shallow class reads, non-ambient class method overload reordering, skipped constructor comparison on generic/mixin subclasses, a handful of declaration-level distinctions); and three are structural rather than a grading question (multi-subpath double counting, memory limits on deeply recursive types, non-standard entry layouts). Full table below.

<details>
<summary>Full breakdown of all 10 known limitations</summary>

| Area                                            | What happens                                                                                                                                                                                                                                                  | Why                                                                                                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Equivalence-preserving refactors**            | Replacing a type with an equivalent one — an alias swap like `Exclude<…>` → `SetDifference<…>`, or `{ [P in K]: T }` → `Pick<T, K>` — is reported as a `type-alias-changed`, but as a **review-only (heuristic)** MAJOR, off the `--strict` gate.             | Type aliases and variables are compared as normalized text, not by resolving both types and checking assignability; an unresolved comparison is graded `heuristic`.                         |
| **Input-position widening in aliases**          | Widening a union used as an _input_ (e.g. adding `bigint` to a parameter-only union) is reported MAJOR, though it accepts strictly more — graded **heuristic** (the relation is one-directional in an invariant position), so `--strict` does not gate on it. | Variance is analyzed for function parameters and returns, but not inside a `type` alias body.                                                                                               |
| **Type parameters added to functions**          | Adding a return-only type parameter (`fn(): string` → `fn<T extends string>(): T`) is reported MAJOR, though existing call sites still infer the same result — graded **heuristic** (a generic added to a callable), off the gate.                            | The "required generic added" rule treats a callable-context addition as review-only; in a type/interface/class context, where the argument is always written explicitly, it stays `proven`. |
| **Dual-format / multi-subpath double counting** | A package exposing the same symbols under several `exports` subpaths (`.` plus a JS wrapper like `./esm.mjs`, or `.` plus `./lite`) reports each change once per subpath.                                                                                     | Each `.`-prefixed subpath is analyzed independently; identical changes across subpaths are not yet de-duplicated.                                                                           |
| **Deeply recursive conditional types**          | Extremely type-heavy libraries (e.g. `type-fest`) can exhaust memory during extraction. Raising the heap — `NODE_OPTIONS=--max-old-space-size=8192 npx semver-checks …` — gets some through; there is no in-process guard, so a hard OOM still aborts.        | Declaration extraction has no depth/size bound on deeply recursive conditional / mapped types.                                                                                              |
| **Non-standard entry layouts**                  | A few packages whose types live only beside a JS target — no `types` condition, no top-level `types`, no root `index.d.ts` — can't be auto-resolved; pass `--entry`.                                                                                          | Sibling-`.d.ts`-of-JS-target resolution is not implemented.                                                                                                                                 |
| **Class declarations are read shallowly**       | Changing a class's `extends` base, making a class or one of its members `abstract`, or making a class method required (`m?(): void` → `m(): void`) is reported as **no change at all** — a `patch`. The interface equivalent of the last one _is_ detected. | Only the class's own members, their types, and their static/optional/readonly flags are compared. The `extends` clause is now extracted, but it is read only to resolve a base when *something else* asks what it carried (an interface extending a class, a member hoisted onto one); no rule diffs a class's own heritage, and `abstract` is not extracted at all. |
| **Class method overload reordering is undetected**  | In a plain `.ts` source (not an ambient `.d.ts`/`declare class`), reordering a class method's overload signatures is reported as **no change at all** (a `patch`), even though TypeScript resolves an overloaded call against the first matching signature in declaration order, so the reorder is a real break. Disjoint overloads (where call resolution never actually changes) still break, too: `ReturnType<typeof method>` always resolves to the last signature, so reordering swaps what that utility type produces. | `getMethods()` on a non-ambient class returns one implementation node per method, so overloads are merged into a single signature (e.g. `bar(x: number): void; bar(x: string): void` extracts as one `x: number \| string` signature) before comparison, losing declaration order. Ambient declarations, which have no implementation node, extract each overload separately and detect the reorder. |
| **Constructor comparison is skipped on generic/mixin subclasses** | A class with no explicit constructor of its own and an `extends` clause has its constructor comparison skipped entirely, rather than judged against the constructor it inherits, whatever shape the base takes (a plain class, a generic instantiation like `extends Base<string>`, a class expression, or a mixin factory). | Declaration nodes alone can't instantiate a base's type arguments, so the inherited constructor can't be resolved reliably for generics, class expressions, or mixins. Rather than risk a wrong answer, the comparison is skipped whenever a class both lacks an explicit constructor and extends something; a class with no `extends` at all still defaults to an implicit `public` zero-arg constructor. |
| **Some declaration-level distinctions are invisible** | A value export narrowed to a type-only one (`export declare class C` → `declare class C; export type { C }`), an `enum` becoming a `const enum`, and a second interface declaration merged into the first are all reported as no change.                | Exports are resolved to their declarations without recording whether the export itself was type-only, and only the first declaration of a merged symbol is read.                            |

</details>

When a type can't be resolved in isolation (imported types, bare generics, anything involving `any`), semver-checks falls back to the conservative MAJOR verdict by design — see [Does it have false positives?](#does-it-have-false-positives).

## Quick Start

```bash
npm install --save-dev semver-checks
```

Compare a git tag to the current working tree:

```bash
npx semver-checks compare v1.0.0 HEAD
```

Compare the **published npm release** against your working tree — answers "is my current change a breaking release?" without needing git tags:

```bash
npx semver-checks compare your-package@latest
```

A `<package>@<version>` argument is fetched from the npm registry (via `npm pack`) and used as the old version. Concrete versions, ranges, and common dist-tags are auto-detected (`your-package@1.2.3`, `your-package@^1`, `your-package@next`). For an uncommon dist-tag, make the intent explicit with the `npm:` prefix or `--old-as npm` (`npm:your-package@my-custom-tag`) so it isn't mistaken for a git ref.

Compare two local directories:

```bash
npx semver-checks compare ./old ./new
```

Existing relative paths without a `./` prefix are also treated as local directories:

```bash
npx semver-checks compare packages/core packages/core-next
```

If a git ref collides with an existing path name, force ref interpretation explicitly:

```bash
npx semver-checks compare main HEAD --old-as ref
```

Output as JSON, Markdown (for PR comments), or GitHub Actions annotations:

```bash
npx semver-checks compare v1.0.0 HEAD --format json
npx semver-checks compare v1.0.0 HEAD --format markdown
npx semver-checks compare v1.0.0 HEAD --format github
```

Fail in CI if breaking changes are detected (`exit 1`):

```bash
npx semver-checks compare v1.0.0 HEAD --strict
```

Inspect the API surface of the current or a past version:

```bash
npx semver-checks snapshot
npx semver-checks snapshot --ref v1.0.0
npx semver-checks snapshot --npm lodash@4.17.21
```

### Multiple entry points

When `package.json` declares an `"exports"` map with several subpaths, every
subpath with a declared `.d.ts` entry is extracted and compared independently.
Adding a subpath is a MINOR change and removing one is MAJOR; a change inside a
subpath is reported with a `#` separator (e.g. `./utils#helper`). No flags are
needed — the map is auto-detected.

For projects without an `"exports"` map, pass multiple entries explicitly by
repeating `--entry` or comma-separating them:

```bash
npx semver-checks compare v1.0.0 HEAD --entry src/index.ts --entry src/utils.ts
npx semver-checks compare v1.0.0 HEAD --entry src/index.ts,src/utils.ts
```

### Example output

```
semver-checks — Recommended bump: MAJOR
  major: 2 (confident: 1, review: 1)  minor: 1  patch: 0

  Breaking Changes — confident (MAJOR)
  ✗ Required property 'timeout' was added to interface 'Config'
      now: number

  Needs review — couldn't prove safe (MAJOR)
  ? Type alias 'UserId' changed
      before: string | number
      after:  string

  New Features (MINOR)
  + Export 'createConfig' was added
```

`--strict` exits 1 on the confident break only; the review-only item passes the gate unless you opt into `--strict-review`.

## Programmatic API

```typescript
import { compare, extract } from "semver-checks";

const report = await compare({
  oldSource: { type: "git", ref: "v1.0.0" },
  newSource: { type: "path", path: "." },
});

console.log(report.recommended); // 'major' | 'minor' | 'patch'
console.log(report.changes); // ApiChange[]
console.log(report.summary); // { major: 2, minor: 1, patch: 0 }
```

```typescript
interface CompareOptions {
  oldSource: SourceRef;
  newSource: SourceRef;
  entry?: string | string[]; // Optional: specify one or more entry points
  installDeps?: boolean; // Optional: install deps before analyzing local path sources
}

type SourceRef =
  | { type: "path"; path: string }
  | { type: "git"; ref: string; cwd?: string }
  | { type: "npm"; spec: string }; // e.g. { type: 'npm', spec: 'lodash@4.17.21' }

interface SemverReport {
  recommended: "major" | "minor" | "patch";
  changes: ApiChange[];
  summary: {
    major: number;
    minor: number;
    patch: number;
    majorProven: number;
    majorReview: number;
  };
}

interface ApiChange {
  kind: ChangeKind;
  severity: "major" | "minor" | "patch";
  symbolPath: string;
  message: string;
  oldValue?: string;
  newValue?: string;
  confidence?: "proven" | "heuristic";
}
```

You can also extract a snapshot independently:

```typescript
import { extract } from "semver-checks";

const snapshot = await extract({ projectPath: "." });
// Snapshots are keyed by export subpath ('.' is the root entry; additional
// subpaths come from the package.json "exports" map).
console.log(Object.keys(snapshot.entrypoints["."])); // root entry's symbol names
```

## Change Rules

### Breaking changes (MAJOR)

| Rule                                    | Description                                               |
| --------------------------------------- | --------------------------------------------------------- |
| `export-removed`                        | A public export was removed                               |
| `entrypoint-removed`                    | A public export subpath was removed                       |
| `required-param-added`                  | A required parameter was added to a function              |
| `param-removed`                         | A parameter was removed                                   |
| `param-type-changed`                    | A parameter's type changed                                |
| `return-type-changed`                   | A function's return type changed                          |
| `property-removed`                      | An interface property was removed                         |
| `required-property-added`               | A required property was added to an interface             |
| `property-type-changed`                 | An interface property's type changed                      |
| `interface-property-became-required`    | An optional interface property or method became required  |
| `interface-property-became-readonly`    | An interface property changed from mutable to readonly    |
| `interface-method-removed`              | An interface method was removed                           |
| `required-interface-method-added`       | A required interface method was added                     |
| `interface-method-signature-changed`    | An interface method's signature changed                   |
| `enum-member-removed`                   | An enum member was removed                                |
| `enum-member-value-changed`             | An enum member's value changed                            |
| `class-constructor-changed`             | A class constructor's signature changed                   |
| `class-constructor-visibility-narrowed` | A class constructor's visibility was narrowed (e.g. `public` → `private`) |
| `class-method-removed`                  | A public class method was removed                         |
| `class-method-signature-changed`        | A public class method's signature changed                 |
| `class-method-became-static`            | A class method changed from instance to static            |
| `class-method-became-instance`          | A class method changed from static to instance            |
| `class-property-removed`                | A public class property was removed                       |
| `class-property-type-changed`           | A public class property's type changed                    |
| `class-property-became-static`          | A class property changed from instance to static          |
| `class-property-became-instance`        | A class property changed from static to instance          |
| `class-property-became-required`        | An optional class property became required (review-only)  |
| `required-class-property-added`         | A required instance class property was added (proven when the class was structurally implementable) |
| `class-property-became-readonly`        | A public class property changed from mutable to readonly  |
| `generic-param-required`                | A required generic parameter was added                    |
| `generic-param-removed`                 | A generic parameter was removed                           |
| `generic-constraint-changed`            | A generic parameter's constraint changed                  |
| `generic-param-default-changed`         | A generic parameter's default type changed or was removed |
| `overload-removed`                      | A function overload was removed                           |
| `interface-call-signature-changed`      | An interface's call signatures changed                    |
| `interface-construct-signature-changed` | An interface's construct signatures changed               |
| `index-signature-changed`               | An interface's index signatures changed                   |
| `interface-heritage-changed`            | An interface's `extends` clause changed                   |
| `type-alias-changed`                    | A type alias definition changed                           |
| `variable-type-changed`                 | An exported variable's type changed                       |

### New features (MINOR)

| Rule                                 | Description                                                                             |
| ------------------------------------ | --------------------------------------------------------------------------------------- |
| `export-added`                       | A new public export was added                                                           |
| `entrypoint-added`                   | A new public export subpath was added                                                   |
| `optional-param-added`               | An optional parameter was added                                                         |
| `optional-property-added`            | An optional property was added to an interface                                          |
| `interface-method-added`             | An optional interface method was added                                                  |
| `interface-property-became-optional` | A required interface property or method became optional                                 |
| `interface-property-became-mutable`  | An interface property changed from readonly to mutable                                  |
| `enum-member-added`                  | An enum member was added                                                                |
| `overload-added`                     | A function overload was added                                                           |
| `class-constructor-visibility-widened` | A class constructor's visibility was widened (e.g. `private` → `public`)              |
| `generic-param-with-default`         | A generic parameter with a default was added                                            |
| `generic-param-default-added`        | A default was added to an existing generic parameter                                    |
| `class-method-added`                 | A public class method was added                                                         |
| `class-property-added`               | An optional or static public class property was added                                   |
| `class-property-became-optional`     | A required class property became optional                                               |
| `class-property-became-mutable`      | A public class property changed from readonly to mutable                                |
| `param-type-widened`                 | A parameter's type was widened — existing callers still type-check (contravariant)      |
| `return-type-narrowed`               | A function's return type was narrowed — existing consumers still type-check (covariant) |

## CLI Reference

### compare

```
semver-checks compare <old> [new] [options]
```

| Option            | Short | Description                                                                           | Default     |
| ----------------- | ----- | ------------------------------------------------------------------------------------- | ----------- |
| `--entry <path>`  | `-e`  | Entry file path (e.g., `src/index.ts`); repeat or comma-separate for multiple entries | Auto-detect |
| `--format <type>` | `-f`  | `text`, `json`, `markdown`, or `github`                                               | `text`      |
| `--strict`        | `-s`  | Exit 1 if a **confident (proven)** breaking change is found — safe to gate CI on      | `false`     |
| `--strict-review` |       | Exit 1 if **any** breaking change is found, including review-only (heuristic) ones    | `false`     |
| `--declared <bump>` |     | The bump this release declares: `major`, `minor`, `patch`, `none`, or `auto`. Exit 1 when it understates a **proven** break | _(off)_ |
| `--install-deps`  |       | Install dependencies before analyzing local path inputs                               | `false`     |
| `--old-as <kind>` |       | Force `<old>` to be interpreted as `path`, `ref` (or `git`), or `npm`                 | Auto-detect |
| `--new-as <kind>` |       | Force `[new]` to be interpreted as `path`, `ref` (or `git`), or `npm`                 | Auto-detect |

**Arguments:**

- `<old>`: an npm spec (`pkg@version`), a git ref (tag, branch, commit SHA), or a local directory path for the old version
- `[new]`: npm spec, git ref, or path for the new version; defaults to `.` (current directory)

**Exit codes:**

| Code | Meaning                                                                                       |
| ---- | --------------------------------------------------------------------------------------------- |
| `0`  | Analyzed; the gate you asked for passed                                                       |
| `1`  | Analyzed; the gate failed (`--declared` on a declaration that understates a proven break, `--strict` on a proven break, `--strict-review` on any) |
| `2`  | Could not answer — an input didn't resolve, or a side's API surface could not be extracted    |

Exit 2 covers the case where extraction produced nothing usable: no API symbols at all, or only opaque (`any`) ones. That is reported as a failure rather than a clean `patch`, because a comparison of two empty surfaces is indistinguishable from a release that genuinely changed nothing. Pass `--entry` to point at the declaration file when a package's entry point can't be auto-resolved.

**Output formats:**

- `text` — colored human-readable summary (default)
- `json` — the structured `SemverReport`
- `markdown` — a Markdown summary suitable for a PR comment or `$GITHUB_STEP_SUMMARY`
- `github` — [GitHub Actions workflow commands](https://docs.github.com/actions/using-workflows/workflow-commands-for-github-actions) (`::error::` / `::warning::`) that surface inline on the PR

All four carry the `--declared` verdict when one was asked for.

> If an argument matches an existing filesystem path, semver-checks treats it as a path source even without a `./` prefix.
> A `<package>@<version>` shape that is not an existing path is resolved from the npm registry.
> A plain ref (`v1.2.3`, `main`) has no `@version` and is resolved as a git ref.
> A git ref that happens to share the `name@version` shape (e.g. a lerna/monorepo tag like `pkg@1.0.0`) would be auto-detected as an npm spec — force git resolution with `--old-as ref` in that case.
> Use `--old-as ref` / `--new-as ref` (or `--old-as npm`) when auto-detection guesses wrong.

> When using git refs, the command must run inside a git repository. The ref is resolved
> against the working directory's repo.

### `--declared`: does the bump this release announces hold?

`--strict` answers "is anything here breaking". On a release pull request that is the wrong question, because a release that declares a major *is allowed* to break things. `--declared` asks the question that is actually open: **does the bump written down cover what the API surface did?**

```bash
# Read the declaration from the repository, compare it against the analysis
semver-checks compare your-package@latest . --declared auto --format markdown
```

`auto` looks in two places, in order:

1. **`.changeset/*.md` frontmatter** (and `.changeset/pre/*.md`) for a release type declared for this package. The name is taken from the new side's `package.json`. Several changesets for one package merge to the highest of them, the way `changeset version` would. The files changesets itself skips are skipped here too: dot files, anything that is not Markdown, and `README.md` / `AGENTS.md` / `CLAUDE.md` / `GEMINI.md`.
2. **The `package.json` `version` field on each side**, when no changeset names the package. The field that moved is read as written; a prerelease on either side (`1.0.0-rc.1` to `1.0.0`) moves none of the three numbers, so the run exits 2 asking for an explicit `--declared` rather than calling it `none`.

Or state it yourself: `--declared minor`.

Below `1.0` the requirement shifts down a field rather than the declaration shifting up, because that is where a caret range stops: `^0.5.0` refuses `0.6.0`, so a break there needs a **minor**, not a major. It shifts once and no further. `^0.0.5` does refuse `0.0.6`, but `~0.0.5` and `0.0.x` both accept it, so on a `0.0.x` package the only bump that puts a break out of every range is still `0.1.0`.

That has to be decided on the requirement side, because a `0.x` release announces its break as `0.5.0 -> 0.6.0` in version fields *and* as `minor` in a changeset (`changeset version` runs `semver.inc`, so a `major` there would have written `1.0.0`). Reading the two sources differently would give one release two opposite verdicts.

The verdict draws the same graded-confidence line `--strict` and `--strict-review` already do. **Only a proven break fails the run.** Everything else the analysis found, an addition to the public surface or a major it could not prove, argues for a higher bump and is reported as a ⚠️ on a passing run. That second reading is the same one `recommended bump` already shows, and it stays out of the gate because a build that fails on a finding the analyzer could not prove is a build people stop trusting.

| Declared | What was found | Verdict | Exit |
| --- | --- | --- | --- |
| `major` | a proven break | ✅ ok, the release admits to it | `0` |
| `minor` | a proven break | ❌ mismatch | `1` |
| `patch` | a proven break | ❌ mismatch | `1` |
| `patch` | a new export, no proven break | ⚠️ review, argues for `minor` | `0` |
| `minor` | a new export | ✅ ok | `0` |
| `patch` | a review-only (heuristic) major | ⚠️ review, argues for `major` | `0` |
| `major` | a review-only (heuristic) major | ✅ ok | `0` |
| `none` | nothing on the public surface moved | ✅ ok | `0` |

The table is for a package past `1.0`; below that a required `major` reads as a required `minor`, as described above. The exit codes are the defaults. `--strict-review` promotes ⚠️ review to `1` as well, which is what it is for; the report itself does not repeat the exit code, because it is written before the flags are read.

`--declared` subsumes `--strict`, whose question it already answers. `--strict-review` keeps its meaning instead of being cancelled: it promotes the ⚠️ review verdict to a failure, so a release that understates a review-only finding fails for whoever asked for that.

If `auto` cannot read a declaration at all, the run exits 2 rather than passing quietly.

### snapshot

```
semver-checks snapshot [path] [options]
```

| Option           | Short | Description                                                    |
| ---------------- | ----- | -------------------------------------------------------------- |
| `--ref <ref>`    | `-r`  | Use a git ref instead of a local path                          |
| `--npm <spec>`   |       | Snapshot a published npm package (e.g. `lodash@4.17.21`)       |
| `--entry <path>` | `-e`  | Entry file path; repeat or comma-separate for multiple entries |
| `--install-deps` |       | Install dependencies before analyzing a local path             |

**Arguments:**

- `[path]`: project path; defaults to `.` (current directory)

Exits 2 when nothing usable could be extracted, rather than printing an empty surface — same reasoning as `compare` above.

### Global options

| Option  | Description                                     |
| ------- | ----------------------------------------------- |
| `--mcp` | Start semver-checks as an MCP server over stdio |

### Environment variables

| Variable                  | Description                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `SEMVER_CHECKS_VERBOSE=1` | Print warnings for skipped symbols, type resolution failures, and dependency install issues |

## MCP Server

semver-checks ships as a [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server, letting AI agents (Claude Code, Codex, Cursor, etc.) call it as a tool directly.

### Setup

```bash
# Claude Code
claude mcp add semver-checks -- npx -y semver-checks --mcp
```

Use `npx -y` for global-on-demand installs so the MCP server does not block on an interactive "install this package?" prompt.

Or add it to your `.claude/settings.json`:

```json
{
  "mcpServers": {
    "semver-checks": {
      "command": "npx",
      "args": ["-y", "semver-checks", "--mcp"]
    }
  }
}
```

For a locally installed version:

```json
{
  "mcpServers": {
    "semver-checks": {
      "command": "/path/to/node_modules/.bin/semver-checks",
      "args": ["--mcp"]
    }
  }
}
```

Relative paths and git refs are resolved from the MCP server process's current working directory. For reliable results, launch the server from the repository you want to inspect, or pass absolute filesystem paths for local sources.

### Available Tools

| Tool              | Description                                                        |
| ----------------- | ------------------------------------------------------------------ |
| `semver_compare`  | Compare two versions and get a SemVer recommendation + change list |
| `semver_snapshot` | Extract the public API surface of a project as a JSON snapshot     |

#### `semver_compare`

| Argument      | Type                | Required | Description                                                |
| ------------- | ------------------- | -------- | ---------------------------------------------------------- |
| `old`         | string              | Yes      | Filesystem path or git ref (tag, branch, SHA)              |
| `new`         | string              |          | Filesystem path or git ref. Defaults to `.`                |
| `entry`       | string              |          | Entry file (e.g. `src/index.ts`). Auto-detected if omitted |
| `oldAs`       | `"path"` \| `"git"` |          | Force interpretation of `old`                              |
| `newAs`       | `"path"` \| `"git"` |          | Force interpretation of `new`                              |
| `installDeps` | boolean             |          | Install dependencies before analysis                       |

`oldAs` and `newAs` accept only `"path"` or `"git"` in MCP mode.

#### `semver_snapshot`

| Argument      | Type    | Required | Description                                 |
| ------------- | ------- | -------- | ------------------------------------------- |
| `path`        | string  |          | Filesystem path or git ref. Defaults to `.` |
| `entry`       | string  |          | Entry file                                  |
| `asGitRef`    | boolean |          | Treat `path` as a git ref                   |
| `installDeps` | boolean |          | Install dependencies before analysis        |

## CI Integration

### GitHub Action

semver-checks ships a reusable composite action. The most ergonomic setup compares the **published `latest` release** against the PR's working tree, so it needs no git tags and posts inline annotations on the diff:

```yaml
name: SemVer Check

on:
  pull_request:
    branches: [main]

jobs:
  semver-checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm ci

      - uses: kyungseopk1m/semver-checks@v0.11.0
        with:
          old: "your-package@latest" # the published version to compare against
          format: "github" # inline ::error:: / ::warning:: annotations
          strict: "true" # fail the PR on a confident (proven) breaking change
```

| Input           | Description                                                                               | Default                    |
| --------------- | ----------------------------------------------------------------------------------------- | -------------------------- |
| `old`           | Old version — an npm spec (`pkg@latest`), git ref, or path                                | _(required)_               |
| `new`           | New version — git ref or path                                                             | `.`                        |
| `entry`         | Entry file (auto-detected from `package.json` when omitted)                               | _(auto)_                   |
| `format`        | `text`, `json`, `markdown`, or `github`                                                   | `github`                   |
| `strict`        | Fail the step (exit 1) on a **confident (proven)** breaking change                        | `false`                    |
| `strict-review` | Fail the step (exit 1) on **any** breaking change, including review-only (heuristic) ones | `false`                    |
| `declared`      | The bump this release declares: `major`, `minor`, `patch`, `none`, or `auto`. Fails the step when it understates a **proven** break, and takes over from `strict` | _(off)_ |
| `comment`       | Post the report to the PR as a single comment, edited in place on later pushes (forces `format: markdown`) | `false` |
| `token`         | Token used to post the comment. A composite action cannot read the `secrets` context, so it has to be passed in | `${{ github.token }}` |
| `version`       | semver-checks version to run via `npx`                                                    | _(matches the action ref)_ |

A full example lives in [`examples/github-actions.yml`](examples/github-actions.yml).

#### On a release pull request

The check that has no equivalent elsewhere: does the bump this release declares cover what its API surface did? `declared: auto` reads the bump from `.changeset/*.md` and falls back to the two `package.json` versions, and `comment: true` puts the verdict on the pull request as one comment that is edited in place rather than one per push.

```yaml
permissions:
  contents: read
  pull-requests: write # required for `comment`

jobs:
  semver-checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm ci

      - uses: kyungseopk1m/semver-checks@v0.11.0
        with:
          old: "your-package@latest"
          declared: "auto"
          comment: "true"
```

The step fails when the declaration understates a proven break, and passes with a note when it only understates an addition. `token` defaults to `github.token`; pass it explicitly if your setup needs a different one. A pull request from a fork gets a read-only token, so the comment is skipped with a warning there rather than failing the step.

### Without the action

Run the CLI directly — for example, compare the published release to the working tree:

```yaml
- name: Check for breaking changes
  run: npx semver-checks compare your-package@latest --format github --strict
```

Or compare against a git tag:

```yaml
- name: Check for breaking changes
  run: npx semver-checks compare v$(node -p "require('./package.json').version") HEAD --strict
```

## Comparison with Other Tools

|                | semver-checks   | semantic-release        | changesets         | npm-check-updates       |
| -------------- | --------------- | ----------------------- | ------------------ | ----------------------- |
| Input          | TypeScript AST  | Commit messages         | Manual YAML        | package.json            |
| Detection      | Typed API rules | Keyword matching        | Developer-declared | Version range only      |
| Recommendation | Automatic       | Based on message format | Manual per change  | Dependency updates only |

semver-checks is a verification layer, not a release tool. Use it alongside `semantic-release` or `changesets` to check whether the declared bump matches the API changes.

## How It Works

1. **Extract**: Parse old and new TypeScript source files using ts-morph, building a typed API snapshot (functions, interfaces, enums, classes, type aliases, variables, namespaces)
2. **Diff**: Compare the two snapshots symbol by symbol — detect additions, removals, and signature changes
3. **Classify**: Assign each diff a `major`, `minor`, or `patch` severity
4. **Report**: Return a structured `SemverReport` with the recommended bump and per-change details

For git ref comparisons, the ref is extracted to a temporary directory via `git archive`, dependencies are installed there if needed, and the directory is cleaned up after extraction. For npm specs, the published tarball is downloaded with `npm pack` and extracted to a temporary directory (no dependency install — the tarball already bundles its build output), then cleaned up. Local path comparisons do not install dependencies unless you opt in with `--install-deps` or `installDeps: true`.

## FAQ

### Will semver-checks catch every semver violation?

No. It catches API surface changes that are mechanically detectable from TypeScript's static type system: removed exports, signature changes, type changes, optionality changes, and similar structural changes. It does not detect behavioral changes, documentation changes, or changes hidden behind conditional compilation. When a package ships _distinct_ ESM and CJS declaration files for the same entry point (for example, divergent `import.types` and `require.types`), only one surface is analyzed, so a break confined to the other surface can be missed. See [Accuracy & Limitations](#accuracy--limitations).

### Does it have false positives?

Yes. It errs toward over-reporting MAJOR rather than missing a break, but the default CI gate only fails on `proven` breaks. Parameter and return type changes go through a structural assignability check, so widened parameters, narrowed returns, and equivalent rewrites such as `readonly T[]` vs `ReadonlyArray<T>` avoid false majors. Type aliases and variables still have conservative cases because they are compared as normalized serialized text, not fully resolved types. The concrete patterns are listed under [Known limitations](#known-limitations).

### Does it support default exports?

Not currently. Only named exports are analyzed.

### Can I compare against a published npm version?

Yes. Pass a `<package>@<version>` spec and semver-checks downloads that release from the registry with `npm pack`, extracts the tarball, and analyzes its bundled `.d.ts` declarations:

```bash
npx semver-checks compare your-package@latest          # published latest vs working tree
npx semver-checks compare your-package@1.0.0 your-package@2.0.0  # two published releases
```

Because a published tarball ships compiled `.d.ts` files while your working tree ships `.ts` source, type _representation_ can differ slightly between the two sides (TypeScript materializes some inferred types in declarations). Removals, additions, and signature changes are detected reliably; a handful of equivalent-but-reworded types may show up as a noisy diff. Comparing two published releases (`.d.ts` vs `.d.ts`) avoids that asymmetry.

### Can I use it without a tsconfig.json?

For local path and git-ref inputs, yes — `tsconfig.json` must exist at the project root (or at the path inferred from the `exports` field in `package.json`). For npm specs, a permissive `tsconfig.json` is synthesized automatically when the published package does not ship one.

### What happens if the analyzed project has TypeScript errors?

semver-checks will print a warning to stderr listing up to 5 errors and continue. Results may be incomplete if type errors affect the API surface. Set `SEMVER_CHECKS_VERBOSE=1` for full diagnostics.

### How is the entry point determined?

semver-checks looks for the entry file in this order:

1. The `--entry` flag if provided
2. The declaration under `exports['.']` in `package.json` — every condition is walked (`types`, `require`/`import`/`node`/`browser`/`module`/`default`, nested, and fallback arrays), and `.d.ts`/`.d.mts`/`.d.cts` are all accepted. A bare-string `"exports": "./index.js"` or a flat conditions object `"exports": { "types": "./index.d.ts", "default": "./index.js" }` (no `.` subpath key) is treated as the `.` entry, so its `types` condition is read. A subpath-only map with no `.` key is left without a root entry (no fabricated root)
3. The top-level `types` or `typings` field in `package.json`
4. `src/index.ts`, then `index.ts`, then a conventional root `index.d.ts`/`.d.mts`/`.d.cts` as fallbacks

If none of these resolve (e.g. a package whose declarations sit beside a JS target with no `types` condition and no root `index.d.ts`), pass `--entry` explicitly.

When a project ships an `"exports"` map with several subpaths, each subpath is resolved and compared independently (see [Multiple entry points](#multiple-entry-points)).

### Does it work with monorepos?

Yes. Point `--entry` at the package's entry file, or run the CLI from that package's directory.

## Requirements

- Node.js `^20.0.0 || >=22.0.0` (Node 21 is excluded by a transitive dependency and is itself end of life)
- For local path / git-ref inputs: a `tsconfig.json` and TypeScript source files (`.ts`/`.tsx`) in the analyzed project
- For npm specs: nothing extra — the tarball's bundled `.d.ts` declarations are analyzed, and a `tsconfig.json` is synthesized if absent

### Dual module support

semver-checks ships both CommonJS and ES module builds:

```javascript
// ESM
import { compare } from "semver-checks";

// CJS
const { compare } = require("semver-checks");
```

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](.github/CONTRIBUTING.md) before submitting a pull request.

## License

MIT. See [LICENSE](LICENSE).

## Author

Kyungseop Kim — [@kyungseopk1m](https://github.com/kyungseopk1m)
