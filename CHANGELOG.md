# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

This release is about `--strict` telling the truth. Three things were wrong with it. It exited 0 on packages the tool had failed to read at all, so "green" and "extraction produced nothing" were the same output. It never read `declare module 'pkg' { … }` blocks, which is how a whole class of packages (mongoose among them) declares its entire surface — that was the largest single cause of the above. And `proven`, the grade the gate keys on, was inherited by every one of the 47 major-emitting rules from a single line of defaulting, rather than earned by any of them.

Measured against a `tsc` oracle over 75 adjacent real-world minor/patch release pairs across 17 packages — a consumer program compiled against both sides of each pair, the author's published bump deliberately not used as the answer key — `--strict` precision goes from 36.8% to 84.6% with recall unchanged at 100%, and the worst single pair drops from 22 proven majors to 4. The corpus and the harness ship in `scripts/gate/`, alongside the 45-line baseline they are scored against, which manages 75.0% / 81.8% on the same pairs.

The other half of the release is `--declared`. `--strict` answers whether anything in a diff is breaking, which is the wrong question to put on a release pull request: a release that declares a major is *allowed* to break things. `--declared` asks the question that is actually open, which is whether the bump written down covers what the API surface did, and it reads that bump out of the repository rather than asking for it.

### Breaking

- **`--strict` now fails far less, and `compare`/`snapshot` now exit 2 where they used to exit 0.** Two behaviour changes a CI pipeline will notice: a package whose API surface could not be extracted is now a hard error instead of a silent `patch`, and most rules no longer produce `proven` breaks. Runs that were green because nothing could be read will start failing; runs that were red on a review-only rule will start passing. `--strict-review` keeps the old "any MAJOR fails" behaviour.
- **An extraction that yields nothing is an error, not a `patch`.** When either side of a `compare` extracts zero API symbols, or extracts only opaque (`any`) ones, the run exits 2 with an explanation instead of reporting `{"changes":[],"recommended":"patch"}` and exiting 0 — output that was byte-for-byte identical to a verified-safe release. `snapshot` does the same instead of printing `{"entrypoints":{".":{}}}`. Affected mongoose, yargs, and firebase, among others.

### Added

- **Ambient `declare module 'pkg' { … }` declarations are extracted.** A package that exports nothing from its entry file and declares its surface in ambient module blocks — the legacy CJS / DefinitelyTyped convention — previously extracted as empty. Blocks are gathered across the whole program, not just the entry file, because TypeScript merges them (mongoose splits its `declare module 'mongoose'` across 26 files); when the entry also augments other packages, the block matching the package's own name is the one used. mongoose 9.0.0 goes from 0 extracted symbols to 567, and `compare mongoose@8.24.3 mongoose@9.0.0 --strict` now fails on the removal of `FilterQuery` instead of passing.
- **`--declared <major|minor|patch|none|auto>`: check a release against the bump it declares.** `auto` reads the declaration from `.changeset/*.md` frontmatter (including `.changeset/pre/`, merging several changesets for one package to the highest of them, the way `changeset version` would) and falls back to the `package.json` `version` field on each side when no changeset names the package. Below `1.0` the requirement shifts down a field rather than the declaration shifting up, once per leading zero, because that is where a caret range stops: `^0.5.0` refuses `0.6.0` and `^0.0.5` matches nothing else at all. That is also what a changeset has to say to produce such a release, since `changeset version` runs `semver.inc` and a `major` there would write `1.0.0`. Deciding it on the requirement side is what keeps one release from getting two opposite verdicts depending on which source was read. A version the three numbers cannot describe, a prerelease on either side or a version that went backwards, exits 2 asking for an explicit bump rather than guessing. A changeset is looked for no further up than the workspace root, so an unrelated one outside the repository cannot answer for this release. The verdict keeps the same graded-confidence line the strict flags draw: a declaration that understates a **proven** break exits 1, while an addition to the public surface argues for a higher bump and is reported on a passing run, since every MINOR kind still falls through to `heuristic` and a build that fails on an ungraded rule is a build people stop trusting. `--declared` subsumes `--strict`, whose question it already answers, while `--strict-review` keeps its meaning by promoting the review verdict to a failure. Measured over the same 75 pairs: 12 mismatches fired, 10 of them releases that broke a consumer without saying so, and the 2 remaining are the same hono and zod overreports the accuracy work already documented as deliberate.
- **The action can post the report to the pull request itself.** `comment: 'true'` renders Markdown and posts it through `gh pr comment --edit-last --create-if-none`, so a pull request carries one comment that is edited in place rather than one per push. It needs `permissions: pull-requests: write` on the calling workflow; a pull request from a fork gets a read-only token, and a refusal there is a warning rather than a failed step. No new dependency and no GitHub App: `gh` is already on the runner. New `declared`, `comment`, and `token` inputs.
- **`scripts/gate/phase-c.mjs`**: the declaration gate's own harness, scored separately from the accuracy gate because it answers a different question. A mismatch claims a proven break went undeclared, which is exactly what a consumer that stopped compiling shows, so it scores against the same `tsc` oracle. A review note claims the release added to its public surface, which no consumer written against the old version can detect, so those rows are listed for audit instead of being folded into a precision number they cannot support.
- **`scripts/gate/`**: the accuracy gate. `corpus.json` (75 adjacent minor/patch pairs across 17 packages), one consumer program per package, `run.mjs` (installs each side, compiles the consumer, scores `--strict` against the compile result), and `naive-baseline.mjs` — a 45-line exported-name-and-arity diff kept as the control group. Major-version boundaries are excluded on purpose: there the author already knows the release is breaking, so the tool's verdict carries no decision value.

### Changed

- **`SemverReport` gains an optional `declaration`.** Present only when a bump was declared or detected, so `--format json` is byte-for-byte unchanged for every run that does not pass `--declared`. `CompareOptions` gains a matching optional `declared`.
- **`proven` is now opt-in per rule.** It used to be the default that every rule inherited without deciding. Rules that compute a confidence (the variance analysis on parameter and return types, property type comparison, signature wrappers) keep what they computed; rules that never decided now default to review-only unless their kind is on an explicit allow-list: `export-removed`, `property-removed`, `class-property-removed`, `class-method-removed`, and `required-param-added` — the changes that are their own evidence.
- **A required property added to a *class* is review-only** (`required-class-property-added`, `class-property-became-required`). It breaks only a consumer who re-implements the class structurally; `new Cls(…)` and `class Mine extends Cls` inherit the member and keep compiling. The interface counterparts stay `proven` — interfaces exist to be implemented.
- **A declaration-form change is review-only, not a proven removal.** `type X = …` becoming `interface X { … }` (or back) when the shapes can't be shown equivalent still reports as `export-removed`, because nothing else describes it, but no longer at `proven`: the name still resolves. ky flipped `KyRequest`/`KyResponse` between the two forms in 1.12.0 and back in 1.13.0, failing `--strict` both times.

### Fixed

- **An overload added to a symbol no longer misaligns every signature after it.** Overloads were paired by array index, so adding one shifted each remaining signature against an unrelated sibling. Pairing is now a minimum-cost, order-preserving alignment whose substitution cost reflects how different two signatures actually are, so an old signature pairs with the closest new one rather than whichever happens to sit at its index. Ties break toward substitution, which keeps a pure reorder aligned position-by-position and therefore still reported as MAJOR — TypeScript resolves an overloaded call against the first matching signature in declaration order and `ReturnType<T>` against the last. Applies to top-level functions, interface methods, and class methods: a plain `.ts` class merges its overloads during extraction and so cannot exercise this, but an ambient `declare class` keeps them separate, and that is what every published package ships. got 14.6.4 → 14.6.5, a published patch, drops from 22 proven majors to 0 (147 total changes to 1), and axios 1.16.1 → 1.17.0 from 2 to 0.
- **A parameter that became required on one overload is review-only when a sibling overload still accepts the shorter call.** commander 14.0.2 dropped the `?` from the deprecated `outputHelp(cb)` while `outputHelp(context?: HelpContext)` sat ahead of it, so `outputHelp()` still resolves: true of the signature, false of the symbol. A symbol with a single signature is unaffected, since making its parameter required always raises the symbol's minimum argument count.
- **A parameter becoming required is no longer reported twice.** An optional parameter serializes with the `| undefined` its optionality implies, so `T | undefined` becoming `T` was reported once as the optionality transition and again as a narrowed type — two findings for one event, under two different kinds.
- **A static class property added to a class is no longer read as a required instance property.** `static readonly DEFAULT_CODE: string` lives on the constructor object, so no consumer can be obliged to supply it; it now reports as an additive `class-property-added` (MINOR).

## [0.9.0] - 2026-08-13

This release closes another silent-`patch` gap on class declarations: a constructor narrowed to `private` or `protected` breaks every external `new ClassName()` call site, but until now was not extracted at all, let alone compared. A class with no explicit constructor of its own and no `extends` clause is judged as an implicit `public` zero-arg constructor, matching TypeScript's own default; a class with no explicit constructor but an `extends` clause has its constructor comparison skipped instead of guessed, because a declaration node alone can't instantiate a base's type arguments, so a generic base, a class expression, or a mixin can't be resolved reliably enough to judge. Alongside that, a long-standing double-count in ambient (`declare class` / `.d.ts`) constructor overload extraction is fixed, and the package picks up an `mcpName` field for MCP registry listing plus a few npm discoverability tweaks.

### Breaking

- **`ChangeKind` gains `class-constructor-visibility-narrowed` and `class-constructor-visibility-widened`**, growing the union from 56 to 58 members: additive for code that only reads a report, but breaking for code that exhaustively switches over `ChangeKind` or consumes it through a `Record<ChangeKind, ...>`, since neither compiles until the two new members are handled. In 0.x, a breaking change to the public API ships as a minor, hence 0.9.0 rather than 0.8.1.

### Added

- **Class constructor visibility changes are detected**: comparing a constructor's `public`/`protected`/`private` accessibility, a narrowing (e.g. `public` to `private`, or `protected` to `private`) is reported as `class-constructor-visibility-narrowed` (MAJOR), and a widening (e.g. `private` to `public`, or `private` to `protected`) as `class-constructor-visibility-widened` (MINOR). An explicit `public constructor(...)` and a constructor written with no access modifier at all are treated as identical, not as a change. A class with an explicit constructor has it extracted and compared directly. A class with no explicit constructor and no `extends` clause is judged as a fresh implicit `public` zero-arg constructor. A class with no explicit constructor but an `extends` clause skips constructor comparison entirely, whatever shape the base takes (a plain class, a generic instantiation, a class expression, a mixin): a declaration node can't instantiate a base's type arguments, so guessing at the inherited constructor risks both false positives and false negatives, and silence beats a wrong answer there.
- **`mcpName` field** (`package.json`) for listing in the MCP registry. `server.json`, which the separate `mcp-publisher` tool reads to publish that listing, lives in the git repository; it is not part of the npm package (not on the `files` whitelist, so it never ships in the tarball).
- Small npm discoverability pass: `description` now mentions the semver-bump recommendation, and `keywords` gains `types`, `api`, `public-api`, `dts`, and `ci`.

### Fixed

- **Ambient constructor overloads were double-counted**: a `declare class` (or a `.ts` file's own `.d.ts`) has no constructor implementation node, so `getConstructors()` already returns one node per overload. Extraction was unconditionally calling `getOverloads()` on top of that, which re-returns the whole overload group (the node it was called on included) and inflated the extracted signature count. `getOverloads()` is now only consulted when there is exactly one constructor node, i.e. the one case where it might be an implementation collapsing real overloads worth expanding.

### New `ChangeKind` values

| Kind                                     | Severity | Description                                                        |
| ----------------------------------------- | -------- | -------------------------------------------------------------------- |
| `class-constructor-visibility-narrowed`   | MAJOR    | A class constructor's visibility was narrowed (e.g. `public` to `private`) |
| `class-constructor-visibility-widened`    | MINOR    | A class constructor's visibility was widened (e.g. `private` to `public`)  |

### Changed

- **`.github/CONTRIBUTING.md`**: the stated Node requirement now matches `package.json`'s `engines` field (`^20.0.0 || >=22.0.0`) instead of the stale `>= 18`.
- **`.github/workflows/publish.yml`**: a new step verifies the pushed tag (`refs/tags/vX.Y.Z`) matches `package.json`'s `version` before publishing, failing the workflow on a mismatch instead of publishing the wrong version.
- **`action.yml`**: the `version` input's description now uses a generic `@vX.Y.Z` example instead of a version number that goes stale every release.

## [0.8.0] - 2026-08-04

This release closes what the analyzer was silently missing on interface declarations, and stops a formatting-only difference from reading as a break. A method whose optionality flips and an `extends` clause that gains, loses or swaps a base were each reported as no change at all; both are classified now, and both resolve their types through the checker rather than through source text, which is what keeps a reformat from counting as a swapped base. The same correction reaches the unresolved-type fallback 0.7.0 shipped, where slicing the annotation out of the file made `M<string,number>` and `M< string, number >` compare as different types. `engines.node` moves with ts-morph 28 and now states the installed tree's real constraint rather than a range that had stopped being true. The accuracy scorecard is unchanged row for row and the regression battery stays green.

### Added

- **Interface method optionality is classified**: a method that goes from `m?(): void` to `m(): void` is now an `interface-property-became-required` MAJOR (every implementer must supply it, `TS2739`), and the reverse is an `interface-property-became-optional` MINOR. The property loop and the property/method cross-form reconciliation both compared optionality already; a member that reached only the method loop was a silent `patch`. Both kinds are reused as-is, so the change adds no new `ChangeKind`. **Interfaces only** — a class method's optionality is not extracted, so `declare class C { m?(): void }` becoming `m(): void` remains undetected.
- **`interface-heritage-changed`**: a dropped, added, or swapped `extends` base is reported as a review-only (`heuristic`) MAJOR. Inherited members are not flattened into the interface's own members, so `interface C extends B {}` becoming `interface C {}` changes the real shape without moving a single own-member and was previously reported as no change at all. Graded `heuristic` because the clause text alone does not resolve the direction: removing a base breaks consumers, adding one breaks implementers. A base is resolved through the compiler like every other type in a snapshot, so reformatting, reordering independent bases, alpha-renaming the container's type parameters, listing the same base twice, and rewriting a base's type arguments into an equivalent spelling (`Base<string[]>` vs `Base<Array<string>>`, a reordered union, a generic default written out) are all no-ops. **Interfaces only** — a class's `extends` clause is still not extracted, so changing one remains undetected.
- **Deprecated-compiler-option diagnostics no longer raise the incomplete-snapshot alarm**: TypeScript grades a deprecated compiler *option* as an Error (5101, 5107), and since TypeScript 6.0 that fires on the perfectly ordinary `"moduleResolution": "node"`, `target: es5`, and `module: umd` that thousands of published tsconfigs still carry. Those two codes are filtered out; every diagnostic that says something about whether the declarations actually parsed still surfaces the warning.

### Breaking

- **`ChangeKind` gains `interface-heritage-changed`**: additive for code that reads a report, breaking for code that exhaustively switches over the union or narrows it in a type position.
- **`engines.node` is `^20.0.0 || >=22.0.0`** (was `>=18.0.0`): the declared range was not true of the installed tree. `ts-morph` 28 pulls in `brace-expansion@5.0.8`, whose own `engines.node` is `20 || >=22`, so an install on Node 18, 19, or 21 warned `EBADENGINE` and failed outright under `engine-strict`. The new range is that constraint exactly, not a rounded-off `>=20`: Node 21 really is excluded, and a declared range that is nearly true is the thing this release is fixing. Node 18 reached end of life in April 2025 and Node 21 in June 2024, so no supported runtime is dropped.

### Fixed

- **ts-morph 24 to 28** (bundled TypeScript 5.6.2 to 6.0.2): no source change was required and the accuracy scorecard is unchanged row for row. The parser now understands the syntax added through TypeScript 6.0.
- **Reformatting an unresolved type is no longer a change**: when a type can't be resolved, extraction falls back to the source annotation (0.7.0) so two different unresolved types stay distinguishable. That fallback sliced the characters out of the file, which put author formatting into the comparison — `M<string,number>` and `M< string, number >` are the same unresolvable type but compared as different, and whitespace normalization only squeezes runs, so the space after a comma survived. The annotation is printed through the compiler now. Two different unresolved types still compare as different; only the formatting axis is removed. This is most visible on `compare pkg@latest .`, where a published tarball's peer or optional types are simply not installed.

### New `ChangeKind` values

| Kind                         | Severity | Description                             |
| ---------------------------- | -------- | --------------------------------------- |
| `interface-heritage-changed` | MAJOR    | An interface's `extends` clause changed |

### Changed

- **The dogfood CI step no longer swallows its own failures**: `continue-on-error: true` is removed from the self-check. It deliberately runs without `--strict` — this repo does ship majors, and gating on them would block every pull request on a major-prep branch — so the only non-zero exit it can produce is a crash, an unresolvable entry, or a registry failure. The step is a real canary on the tool's own public API now rather than an unread log line.

## [0.7.0] - 2026-06-27

This release makes the gate trustworthy enough to leave on in CI. Every breaking change now carries a **confidence** — `proven` (a structural fact or a resolved type relation) or `heuristic` (a conservative MAJOR the analyzer could not prove safe) — and `--strict` gates on `proven` only. The equivalence-preserving rewrites and input-union widenings that made text-based type-semver tools cry wolf now land in `heuristic`, off the default gate, while real under-bumps stay `proven` and on it. It also lands the entry-resolution and diagnostics work accumulated since 0.6.1, plus a reproducible accuracy probe. The full regression battery stays green; no breaking-change detection was weakened.

### Added

- **Graded confidence on every change**: `ApiChange.confidence` is `'proven'` or `'heuristic'`. A break is `proven` when it follows from a structural fact (member added/removed, optionality/readonly/static transition, enum/overload change, removed export) or from a type comparison the analyzer resolved as genuinely unrelated; it is `heuristic` when the severity is a conservative fallback — an unresolved type-text comparison, a one-directional relation in an invariant position (e.g. input-union widening), a constraint/default text difference, a call/construct/index-signature change, or a return-only generic added to a function. `SemverReport.summary` gains `majorProven` and `majorReview` (`majorProven + majorReview === major`).
- **`--strict-review` flag**: exits 1 on _any_ breaking change, including review-only (`heuristic`) ones — the previous `--strict` behaviour, now opt-in.
- **Object-literal type-alias decomposition**: a bare `type X = { ... }` alias is now diffed member-by-member like an interface, so an added required property is a `proven` `required-property-added` (e.g. `p-limit` `LimitFunction.concurrency`, `ky` `KyInstance.retry`) instead of an opaque, review-only `type-alias-changed`. Non-object aliases (union / conditional / mapped / intersection / function type) keep their whole-text comparison.
- **Confidence in every reporter**: `text` and `markdown` split MAJOR into a confident section and a "needs review — couldn't prove safe" section; `github` emits `::error::` for `proven` and `::warning::` for `heuristic`; `json` and the MCP tools include `confidence` on each change and the `majorProven`/`majorReview` summary fields.
- **Reproducible accuracy probe** (`scripts/accuracy-probe.mjs`): runs the built CLI against 44 frozen real-world npm release pairs and prints the shape × outcome matrix plus the proven/review split behind the README's "Accuracy & Limitations" numbers. Zero dependencies; not shipped in the published package.
- **Actionable resolution errors**: an opaque `npm pack` / `git archive` / entry-detection failure is now reformatted into one line — a missing `npm`/`git` binary, an unpublished spec (`E404`), a registry network issue, a ref that doesn't exist, or a "looked here, pass `--entry`" hint — instead of dumping raw tool output. When the analyzed project has TypeScript errors, the snapshot warning now spells out that the result may under-report breaking changes.

### Changed

- **`--strict` now gates on confident breaks only** (BREAKING): it exits 1 when a `proven` MAJOR is present, not on every MAJOR. A release whose only breaking changes are `heuristic` (the surfaces in the README's Known limitations) now passes `--strict`; use `--strict-review` for the prior "any MAJOR fails" behaviour.
- **`SemverReport.summary` gains required `majorProven` / `majorReview` fields** (BREAKING for code that constructs a `SemverReport`; additive for code that reads one).

### Removed

- **Snapshot-pair diffing in MCP** — the `semver_diff` tool (BREAKING for MCP clients that called it): `semver_compare` already extracts both sides and diffs them in a single call, so `semver_diff` only added a second path that required an agent to round-trip two full JSON snapshots through its context. Diff a pair of versions with `semver_compare`; use `semver_snapshot` on its own to inspect a single API surface.

### Fixed

- **Flat-conditions and bare-string `exports` entry resolution**: a package whose `exports` has no `.` subpath key — a flat conditions object (`{ "types": "./index.d.ts", "default": "./index.js" }`) or a bare string (`"exports": "./index.js"`) — now resolves its entry. Previously the resolver read `exports['.']`, found `undefined`, and never looked at the `types` condition, so trivial packages like `p-limit`, `execa`, and `escape-string-regexp` failed with "Could not find an entry file."
- **Conventional root declaration fallback**: packages with no `exports`/`types` fields (older single-file libs such as `chalk` 4.x's `{ "main": "source" }`) now fall back to a root `index.d.ts` / `.d.mts` / `.d.cts`.
- **`exports` fallback arrays** (`[{ types, default }, "./index.js"]`) are walked when resolving the entry.
- **Subpath-only `exports` no longer fabricate a root surface**: a package whose `exports` is a subpath map with no `.` root is not analyzed from a stray root `index.d.ts` _or_ an internal `src/index.ts` (neither is a public entry), so a subpath-only package with an unbuilt `dist/` fails loudly instead of reporting a non-exported surface — which across versions would also produce a spurious `entrypoint-added`/`entrypoint-removed`.
- **Property/method shorthand is no longer a breaking change**: a member written as a function-typed property on one side and a method on the other — `{ f: () => void }` vs `{ f(): void }`, which TypeScript treats as mutually assignable — is reconciled as a single member instead of a `property-removed` plus a `required-method-added` (two false `proven` MAJORs that failed `--strict`). A genuine signature incompatibility across the switch still reports `property-type-changed`. This covers object-literal type aliases too, which are diffed through the interface path.
- **Type-parameter constraint/default changes survive a `type` ⇆ `interface` conversion**: converting `type Box<T extends string> = { v: T }` to `interface Box<T extends number> { v: T }` now reports the `generic-constraint-changed` break instead of treating the same-shape conversion as no change.
- **Function types in a union or intersection keep their parentheses**: serializing `((a: string) => void) & ((a: number) => void)` no longer drops the inner parentheses (which re-parsed as a single function returning an intersection). Such members now round-trip correctly, so the variance probe can resolve them instead of bailing to a conservative major — a reordered or restructured function union/intersection that is genuinely equivalent is recognised as a no-op, while a real change is still reported.

## [0.6.1] - 2026-06-15

This release is a real-world usability pass: it lets the tool analyze popular packages it previously could not even load, and stops it from crying wolf on routine, non-breaking refactors. None of these relaxations weaken breaking-change detection — each keeps its breaking-case counterpart, and the full regression battery (including the cycle 7–13 false-negative guards) stays green.

### Fixed

- **Conditional `exports` entry resolution**: the entry auto-detector now walks every condition in a `package.json` `exports["."]` map (`types`, `require`/`import`/`node`/`browser`/`module`/`default`, nested arbitrarily) and accepts `.d.ts`, `.d.mts`, and `.d.cts` declarations. Previously it read only `import.types ?? types`, and a non-`.d.ts` value there (e.g. an `import.types` pointing at a `.d.mts`) short-circuited the fallback to the top-level `types`/`typings` field — so packages like `commander` (`require.types`), `zustand` (`default.types`), and `ofetch` (nested `node` condition) failed with "Could not find entry file." `.d.ts` is preferred when a package ships several declaration flavors so the analysis runs from one consistent file.
- **Synthesized tsconfig loads `.d.mts`/`.d.cts`**: the permissive tsconfig generated for published npm tarballs now includes `**/*.d.mts` and `**/*.d.cts`, so ESM-only packages whose sole declarations are `.d.mts` resolve.
- **`type X = {...}` → `interface X {...}` is no longer a false breaking change**: converting a type alias to an interface (or vice versa) with the same shape was reported as `export-removed` because the symbol's `kind` changed. The two are now compared by an order-independent canonical member-set comparison that preserves `readonly`, optionality, member types, and a synthetic write-type marker — so any of those differing keeps the breaking verdict, and the comparison needs no type resolution (it tolerates the package-internal member types real interfaces reference). An interface with an `extends` heritage clause is conservatively treated as not shape-equal (inherited members aren't captured). An incompatible shape still surfaces as a breaking change.
- **Structurally equivalent generic-parameter default rewrites are no-ops**: a default change whose old and new types are mutually assignable (e.g. `<T = ReadonlyArray<string>>` → `<T = readonly string[]>`) no longer reports `generic-param-default-changed`. A concrete narrowing such as `<T = string>` → `<T = number>`, a default removal, or any change involving `any` (where assignability can't be trusted) all remain breaking.

## [0.6.0] - 2026-06-13

### Added

- **Multiple entry points via the `package.json` "exports" map**: every subpath listed under `exports` (e.g. `"."`, `"./utils"`) is now extracted and compared independently, and a new entry point appearing or disappearing emits a dedicated change. Subpaths without a declared `.d.ts` entry are skipped — set `SEMVER_CHECKS_VERBOSE=1` to log which ones. The CLI accepts repeated `--entry` flags or a comma-separated list (`--entry src/index.ts,src/utils.ts`) for multi-entry projects without an `exports` map.
- **Generic-parameter alpha-rename for function signatures and type aliases**: a pure parameter rename (`<T>(x: T) => T` vs `<S>(x: S) => S`, or `type Box<T> = { value: T }` vs `type Box<S> = { value: S }`) is now recognised as a no-op instead of surfacing as a false MAJOR. The rewrite is applied position by position with word-boundary anchored substitution that also excludes member-access positions (`Lib.T` stays intact).
- **Type-parameter context in variance synthesis**: when both sides share a generic scope, each parameter is pre-declared inside the probe as a nominal intersection (`type T = Constraint & { readonly [brand]: 'nominal' }`) so that bare-generic types like `T | undefined` vs `T` resolve standalone. `T` stays a _distinct_ subtype of its constraint, so a real breaking change such as `<T extends string>(x: T): T` → `(x: T): string` continues to surface as MAJOR. A constraint of `any` triggers the same conservative bail-out as a textual `any` to preserve the bidirectional-assignability guard.

### Breaking

- **`ApiSnapshot.symbols` → `ApiSnapshot.entrypoints: Record<string, Record<string, ApiSymbol>>`**: the snapshot is now keyed by export subpath (the root entry is `'.'`). A single-entry package is represented as `{ '.': { ...symbols } }`. The MCP snapshot-diff path was updated accordingly and now also rejects snapshots whose `entrypoints` is missing, `null`, or an array.
- **`CompareOptions.entry` accepts `string | string[]`** to support multi-entry comparisons through the programmatic API.

### Fixed

- **Entry-point symbol paths use `#` as the subpath separator**: a change inside `./utils` is now reported as `./utils#helper` instead of `./utils:helper`. The earlier `:` separator was URL-escaped to `%3A` by GitHub Actions property escaping, surfacing as `./utils%3Ahelper` in annotations.
- **Union-type constraints under a shared generic scope no longer collapse to a false MINOR**: the type-parameter prefix now aliases each constraint on its own line before applying the nominal brand intersection, so `<T extends string | number>` retains the brand on _every_ union branch. Previously a naked `string | number & { brand }` parsed as `string | (number & { brand })`, leaving the `number` side bidirectionally assignable and producing a narrowed-return MINOR for a genuine breaking change (`f<T extends string | number>(): T` → `(): number`).
- **Identifier boundary for generic alpha-rename is Unicode-aware**: `renameTypeText` now uses `\p{ID_Continue}` lookbehind/lookahead with the `u` flag. ASCII `\w` boundaries would let a parameter rename leak across Unicode identifier borders (e.g. `S` inside `Sα` was rewritten to `Tα`, causing the textual fast-path to silently classify a real return-type change as a no-op).
- **Generic alpha-rename now skips string and template literal bodies**: a rewrite like `'S' | number` → `'T' | number` under a `S → T` rename used to equate two distinct string literal types and collapse a real breaking change to patch. A shared `literal-spans` scanner now tracks `'…'`, `"…"`, and `` `…` `` bodies (escape sequences and template placeholders included) so identifier matches inside literal text are preserved verbatim.
- **`mentionsAny` skips the `any` keyword inside any literal body**: the previous quote-bounded heuristic missed `'foo any bar'` and `` `prefix any suffix` ``, yielding spurious MAJOR for harmless rewrites of string-literal-type unions. The keyword guard now consumes the same `literal-spans` data the rename pass uses.
- **MCP snapshot-diff validation deep-validates each entrypoint value**: a payload like `{ entrypoints: { ".": null } }` previously slipped past the top-level guard and was misreported as `entrypoint-removed` (or crashed inside the classifier on the matching null). Each per-subpath value is now required to be a non-null plain object, returning a clear validation error otherwise.
- **MCP snapshot-diff validation checks per-symbol shape and refuses reserved prototype keys**: a malformed value such as `{ entrypoints: { ".": { x: [] } } }` previously slipped through as a noisy "patch" report because the classifier walked the array as a symbol map; and `__proto__` / `constructor` / `prototype` keys could poison the maps the classifier iterates. Each symbol is now required to be a non-null object with a recognised `kind`, `namespace` symbols are validated recursively, and the three reserved keys are rejected at every level.
- **Container-level generic rename now propagates into every nested member comparison**: a rewrite like `interface Box<T>` → `interface Box<S>` (with matching `T → S` substitutions in every property and method) used to surface as a noisy MAJOR because only signature-local type parameters were alpha-renamed. The container's rename is now combined with the signature-local rename (with proper TypeScript lexical-scope shadowing) so the entire interface/class collapses to a no-op when the only change is the parameter name.
- **Template-literal placeholder bodies are correctly tracked as type position**: the shared `literal-spans` scanner previously treated everything between matching backticks — including `${...}` bodies — as literal text, so `mentionsAny` skipped the `any` keyword inside `` `${any}` `` and the alpha-rename pass left identifiers inside placeholders un-renamed. Placeholder bodies are now stored as a separate span list, and `isInsideLiteral` returns true only when the offset is inside the outer literal **and not** inside a placeholder.
- **Generic alpha-rename declines to rewrite types that contain a lexical binder**: `infer X` (inside a conditional) and a mapped-type key (`[K in ...]`) introduce their own scope, which a purely textual rename cannot reason about. A rewrite like `type X<S> = S extends Array<infer T> ? S : never` renamed onto `type X<T> = T extends Array<infer T> ? T : never` produced text identical to a structurally _different_ type (where the branch `T` binds to the `infer` result, not the parameter), erasing a real breaking change as a fast-path no-op (`X<string[]>` resolves to `string` before and `string[]` after). When a binder is present the rename is now skipped, so the comparison falls through to the conservative variance / conditional-guard path and the change surfaces as MAJOR.
- **MCP snapshot-diff validation checks per-symbol leaf shape**: the previous guard only checked the `kind` discriminator, so a payload like `{ kind: "variable", type: { text: 5 } }` passed validation and fed a non-string serialized type into the classifier, surfacing as a silent patch. Each symbol's leaf shape is now validated per kind — `SerializedType` leaves must carry a string `text`, and function/method `signatures`, interface/class members, and enum `members` must be the arrays the classifier iterates.
- **Unresolved types no longer collapse to `any` and hide a change**: an unresolved symbol (a missing import or undeclared name) makes TypeScript reduce a type to the intrinsic `error` type, which serializes as `any` — at the top level (`M | string`), nested inside a wrapper (`Array<M | string>`, `{ a: M | string }`), and in a function-type call signature's generic constraint (`<T extends M | string>`). Two different unresolved types then both became `any` and compared as a no-op, hiding a real change. The extractor now falls back to the source annotation text whenever the computed text has _more_ `any` type keywords than the source (an unresolved symbol only ever adds `any`), so the change stays visible while an identical unresolved type remains a no-op. The check parses the text and counts `AnyKeyword` nodes, so an object property literally named `any` (`{ any: M | string }`) does not suppress the fallback, and a genuine `any` field next to an unresolved one (`{ ok: any; x: M | string }`) no longer masks it.
- **Generic alpha-rename no longer rewrites object-type property keys**: the rename is now AST-based and only rewrites identifiers in type-reference position. A textual substitution used to also rename a property key, so `type Box<T> = { T: number; value: T }` → `type Box<S> = { S: number; value: S }` compared as a no-op even though the public property was renamed `T` → `S`. Property keys, member-access qualifiers (`Lib.T`), and string literal types are no longer touched, while a genuine type-parameter rename (`{ value: T }` → `{ value: S }`) still collapses to a no-op.
- **Generic-parameter default types are now tracked**: only `hasDefault` was recorded, so changing or removing a default (`<T = string>` → `<T = number>` or `<T>`) silently compared as a patch even though `Box` resolves to a different type for consumers that rely on the default. The default's serialized text is now captured and compared (alpha-renamed alongside the parameter), so a changed/removed default is MAJOR and an added default is a backward-compatible MINOR.
- **Constructor parameter properties are now part of the class surface**: `constructor(public x: string)` declares a public instance member that the extractor did not surface, so removing the modifier (or the parameter) compared as a patch even though `instance.x` disappears. Public (and bare-`readonly`) parameter properties are now extracted as class properties; `private`/`protected` ones stay internal.
- **Class and interface get/set accessors are now extracted**: a `get x()` / `set x()` member was invisible, so removing an accessor or changing its type compared as a patch even though the member is part of the public shape. Accessors (on classes and on interfaces) are now modelled as properties (get-only is readonly, get+set is mutable), with `private`/`protected`/`#` class accessors excluded. When a get/set pair has distinct read/write types, the write (setter) type is tracked separately so a set-only narrowing (`set x(v: string | number)` → `set x(v: string)`) surfaces as MAJOR even though the getter is unchanged.
- **Interface call, construct, and index signatures are now compared**: `interface F { (x: string): string }` → `interface F {}` (or an index signature `[k: string]: string` → `number`) used to compare as a patch because only `properties` and `methods` were extracted. These signatures are now captured and compared as canonical-text sets — any real change is MAJOR, an identical set is a no-op, and a pure container generic rename collapses to a no-op.
- **MCP snapshot-diff validation checks every leaf field**: per-symbol validation now also checks the symbol `name`, type-parameter `name`/`hasDefault`/`default`, parameter `name`/`isOptional`/`isRest`, property/member `name` and flags, enum member `name`/`value`, interface method `name`/`isOptional`, and the new call/construct/index signature fields — so a malformed snapshot can no longer slip a non-string `name` or flag past validation and surface as a silent patch. Well-formed `extract()` snapshots are unaffected.

### Improved

- **Generic-parameter context now reaches interface and class member comparisons**: interface properties, class properties, class methods, and constructors share their container's `<T>` scope with the variance probe, so structurally equivalent rewrites inside that scope (e.g. `interface Box<T> { items: ReadonlyArray<T> }` vs `readonly T[]`) collapse to a no-op instead of surfacing as MAJOR. Properties remain invariant: only true equivalence is relaxed, never widening or narrowing alone.
- **Type-parameter constraint comparison is alpha-renamed**: `<T extends Box<T>>` and `<S extends Box<S>>` are now recognised as the same constraint instead of producing a spurious `generic-constraint-changed` MAJOR.

### New `ChangeKind` values

| Kind                                    | Severity | Description                                                       |
| --------------------------------------- | -------- | ----------------------------------------------------------------- |
| `entrypoint-added`                      | MINOR    | A new subpath was added to the `exports` map                      |
| `entrypoint-removed`                    | MAJOR    | A previously published subpath was removed from the `exports` map |
| `generic-param-default-added`           | MINOR    | A default was added to an existing generic parameter              |
| `generic-param-default-changed`         | MAJOR    | A generic parameter's default type changed or was removed         |
| `interface-call-signature-changed`      | MAJOR    | An interface's call signatures changed                            |
| `interface-construct-signature-changed` | MAJOR    | An interface's construct signatures changed                       |
| `index-signature-changed`               | MAJOR    | An interface's index signatures changed                           |

### Tests

- New fixtures cover multi-entry detection (added / removed / changed-inside), generic-parameter alpha-rename (function + type alias), generic widening / narrowing under shared type-parameter context, and conservatism guards (`<T extends string>` return collapse, `<T extends any>` widening, mapped/conditional/object-literal regression baselines).
- Independent verification cycle added regression guards for the union-constraint collapse, Unicode-identifier rename leak, and MCP nested-entrypoint validation.
- Code-reviewer follow-up added regression guards for the string-literal rename collapse, interface/class property invariance under generic scope, and constraint-side alpha-rename.
- Sixth verification cycle added regression guards for container-level generic rename propagation, MCP per-symbol validation, prototype-key rejection, and template-placeholder `any` handling.
- Seventh verification cycle added regression guards for generic conditional types: a changed check operand (`A extends "B" ? 1 : 0` → `… "Z" …`), an `infer`-branch rewrite, and a function return conditional now all surface as major, while a pure outer-paren rewrite stays a no-op. These collapsed to a silent patch before, because the brand synthesis eagerly evaluates a conditional whose operand is a branded type parameter.
- Independent-session verification added regression guards for `infer`-binder shadowing (type alias + function return, where alpha-rename used to erase a real breaking change), MCP per-symbol leaf validation (non-string serialized type, missing signatures array), and unresolved union/intersection types (changed vs identical, where an `any` collapse used to hide a real change).
- A further independent session added regression guards for AST-based alpha-rename (object-type property-key rename is breaking; a true type-parameter rename inside an object stays a no-op), unresolved types nested inside a wrapper, and MCP validation of `constructorSignatures` and type-parameter constraints.
- A further session added regression guards for an unresolved generic constraint on a function type, an unresolved type behind an object property literally named `any`, and an unresolved type beside a genuine `any` field (all previously collapsed to `any` and read as a no-op).
- A further session added regression guards for extractor-level surfaces that previously compared as a silent patch: a changed/added generic-parameter default, a removed constructor parameter property, a removed/changed/distinct-write-type accessor, a removed call signature, and a changed index signature (plus a pure generic rename over an index signature staying a no-op), and MCP rejection of malformed enum/parameter/index-signature leaves.
- New live-network integration suite (`SEMVER_CHECKS_NETWORK_TESTS=1`) exercises `nanoid@5.0.9` self-compare, `nanoid@5.0.7` → `5.0.9`, and `zod@3.22.0` → `3.23.0` against published tarballs.
- Total: 127 → **197 tests** (191 run by default + 6 network-gated: 3 dogfood + 3 npm-resolve, run with `SEMVER_CHECKS_NETWORK_TESTS=1`).

## [0.5.0] - 2026-06-12

### Added

- **Direct npm registry comparison**: pass a published npm version as the old source with `compare <package>@<version>` and diff it against the current working tree (or another version). The tarball is downloaded and extracted via `npm pack`, and its bundled `.d.ts` declarations are analyzed. Versions, ranges, and dist-tags are all supported (`pkg@1.2.3`, `pkg@^1`, `pkg@latest`), and the `npm:` scheme can be used to make it explicit. `--old-as npm` / `--new-as npm` force the interpretation. `snapshot --npm <spec>` was added as well.
- **New `markdown` and `github` output formats**: `--format markdown` produces a Markdown summary suited to PR comments or `$GITHUB_STEP_SUMMARY`, and `--format github` emits GitHub Actions workflow commands (`::error::` / `::warning::`) that render inline on the PR diff. The existing `text` and `json` formats are unchanged.
- **Reusable GitHub Action**: the `kyungseopk1m/semver-checks@<version>` composite action runs an automatic semver check on every PR (inputs: `old`/`new`/`entry`/`format`/`strict`/`version`). A full example including a Markdown PR comment lives in `examples/github-actions.yml`.

### Changed

- **Entry auto-detection now supports `.d.ts` entry points**: when the `types` path in `package.json` cannot be mapped to a source file (`*.ts`), the declaration file (`*.d.ts`) itself is used as the entry. This makes published npm packages (which ship without source) analyzable, with no effect on existing source-layout behavior — only a fallback is added.

### Tests

- Added tests for npm spec detection (`source-ref`), Markdown/GitHub format output and escaping (`report`), and `.d.ts` entry resolution plus the real `npm pack` path (`npm-resolve`)
- Live registry tests run only with `SEMVER_CHECKS_NETWORK_TESTS=1` (offline CI stays green)
- Total: 97 → **127 tests** (network-gated tests counted separately)

## [0.4.0] - 2026-06-08

### Added

- **Structural type variance analysis**: parameter and return type changes are now checked for assignability via a synthesized TypeScript program instead of raw text comparison. A widened parameter (`param-type-widened`) and a narrowed return type (`return-type-narrowed`) are classified as MINOR, and structurally equivalent rewrites (e.g. `readonly T[]` vs `ReadonlyArray<T>`) are treated as no-ops. Undecidable relations (imported types, bare generics, anything involving `any`) fall back to the conservative MAJOR verdict.
- **Namespace export support**: members of `export namespace` declarations are now extracted and compared recursively (symbol paths like `Foo.Bar`), including a namespace merged with a same-named function or class.

### Fixed

- **`any` was treated as equivalent to any concrete type**: because `any` is bidirectionally assignable, changes like `type T = any` → `type T = string` were silently erased. The variance check now bails to MAJOR whenever `any` is involved.
- **Rest modifier change masked by a concurrent type widening**: `(...parts: string[])` → `(parts: unknown[])` is now MAJOR (the call-site arity contract changes) instead of being reported as a parameter widening.
- **Constructor overload signatures were not extracted**: only the implementation signature was read, so an overload's required parameters appeared optional. Overload signatures are now extracted via `getOverloads()`, matching how function overloads are handled.
- **Safe variance inside methods/constructors was forced to MAJOR**: the signature-changed wrapper for interface methods, class methods, and constructors now mirrors the severity of its sub-changes, so a method whose only change is a safe widening/narrowing is reported as MINOR.

### New `ChangeKind` values

| Kind                   | Severity | Description                                                                 |
| ---------------------- | -------- | --------------------------------------------------------------------------- |
| `param-type-widened`   | MINOR    | A parameter's type was widened (existing callers still type-check)          |
| `return-type-narrowed` | MINOR    | A function's return type was narrowed (existing consumers still type-check) |

### Tests

- New fixtures cover variance (widen/narrow/equivalent), namespace recursion + declaration merging, string enum value changes, and the `any` / rest-modifier / constructor-overload regressions
- Total: 85 → **97 tests**

## [0.3.2] - 2026-04-16

### Fixed

- **Required interface method addition was classified as minor**: adding a non-optional method to an interface now emits `required-interface-method-added` as MAJOR instead of `interface-method-added` (MINOR).
- **Required class property addition was classified as minor**: adding a non-optional property to a class now emits `required-class-property-added` as MAJOR instead of `class-property-added` (MINOR).
- **Rest parameter modifier changes were undetected**: changing `...args: T[]` to `args: T[]` (or vice versa) now emits `param-type-changed` as MAJOR.
- **Static and instance members with the same name were collapsed**: class method and property grouping now uses `static:name` / `instance:name` composite keys, preventing a static member from being matched against an instance member of the same name.
- **Interface method overload merge used OR for optionality**: when merging overload declarations for the same method name, optionality was set if any overload had `?`. Now uses AND — if any overload is required, the merged method is treated as required (conservative).
- **Simultaneous rest modifier and type change emitted duplicate `param-type-changed`**: when both `isRest` and the type text differed for the same parameter, two `param-type-changed` entries were emitted. The `isRest` check is now an `else if`, so the type change takes precedence and only one entry is emitted.

### New `ChangeKind` values

| Kind                              | Severity | Description                                                |
| --------------------------------- | -------- | ---------------------------------------------------------- |
| `required-interface-method-added` | MAJOR    | A required (non-optional) method was added to an interface |
| `required-class-property-added`   | MAJOR    | A required (non-optional) property was added to a class    |

### Tests

- 7 new fixture sets cover all new rules and edge cases
- Total: 78 → **85 tests**

## [0.3.1] - 2026-04-12

### Added

- **MCP server support**: semver-checks now runs as a [Model Context Protocol](https://modelcontextprotocol.io) server via `semver-checks --mcp`. AI agents (Claude Code, Codex, Cursor, etc.) can call it as a tool without any custom integration.
  - `semver_compare` — compare two versions and get a SemVer recommendation
  - `semver_snapshot` — extract the public API surface as a JSON snapshot
  - Snapshot-diff tool — diff two previously extracted snapshots (removed in 0.7.0)
- Setup: `claude mcp add semver-checks -- npx -y semver-checks --mcp`

### Changed

- **MCP argument validation is now strict**: invalid string/boolean/enum inputs now return explicit tool errors instead of silently falling back to default behavior.
- **Publish flow now runs tests automatically** via `prepublishOnly`, so `npm publish` cannot skip `vitest`, build, or `publint`.
- **`attw` now runs in explicit release/CI steps instead of inside `prepublishOnly`**. This avoids an `ENOENT semver-checks-0.3.1.tgz` failure caused by nested `npm pack` during the `npm publish` lifecycle, while keeping package-type validation in `npm run check`, `npm run deploy`, and the GitHub publish workflow.
- README MCP setup now documents the non-interactive `npx -y` form and clarifies that relative paths/git refs are resolved from the server process working directory.

### Tests

- 15 MCP server tests cover tool listing, compare/snapshot/snapshot-diff flows, runtime validation errors, unknown tools, and stdio transport
- Total: 62 -> **78 tests**

## [0.3.0] - 2026-04-12

### Fixed

- **`readonly` property changes were invisible**: interface and class property snapshots already captured `isReadonly`, but the classifier ignored it. Mutable -> readonly now emits `interface-property-became-readonly` / `class-property-became-readonly` as MAJOR. Readonly -> mutable now emits `interface-property-became-mutable` / `class-property-became-mutable` as MINOR.
- **Interface/class method generic changes were missed**: method signature comparison only checked parameters and return types. Method-level type parameter additions, removals, and constraint changes are now classified through the same `classifyTypeParamChanges()` path used by top-level functions.
- **Bare relative path inputs were misclassified as git refs**: `semver-checks compare packages/core packages/next` would previously try `git archive` unless the path started with `./`, `/`, or `~`. CLI source resolution now checks filesystem existence first, so existing paths are treated as local sources without requiring a prefix.
- **Path-vs-ref name collisions now have an escape hatch**: when a git ref has the same name as an existing path, `--old-as ref` / `--new-as ref` can force git interpretation.
- **Local path comparisons mutated analyzed projects**: `compare()` always ran `npm install`, which could create `node_modules` or `package-lock.json` inside user directories. Dependency installation now happens automatically only for temporary git-ref snapshots. Local paths remain untouched unless `--install-deps` / `installDeps: true` is explicitly set.
- **Equivalent union/intersection type reordering caused false positives**: serialized type text is now normalized so safe top-level union/intersection members are compared in a stable order. This removes diffs like `string | number` -> `number | string` without collapsing grouped expressions such as `A & (B | C)`.
- **`~` path inputs were not expanded correctly**: path resolution now expands the home directory before resolving and existence checks.
- **TypeScript config warning in self-analysis**: the repo's old `moduleResolution: "node"` plus `ignoreDeprecations: "6.0"` combination produced noisy self-analysis warnings on TypeScript 6. The invalid override was removed and the project build config now uses `moduleResolution: "bundler"` instead.

### New `ChangeKind` values

| Kind                                 | Severity | Description                                            |
| ------------------------------------ | -------- | ------------------------------------------------------ |
| `interface-property-became-readonly` | MAJOR    | An interface property changed from mutable to readonly |
| `class-property-became-readonly`     | MAJOR    | A class property changed from mutable to readonly      |
| `interface-property-became-mutable`  | MINOR    | An interface property changed from readonly to mutable |
| `class-property-became-mutable`      | MINOR    | A class property changed from readonly to mutable      |

### Tests

- 12 new tests added
- Total: 50 -> **62 tests**

### README

- Added `--install-deps` / `installDeps` documentation
- Documented bare relative path detection and local-path non-mutation behavior
- Added `--old-as` / `--new-as` docs for ref/path collisions
- Updated rule count: 40 -> 44
- Updated false-positive notes to reflect union/intersection normalization

## [0.2.1] - 2026-04-11

### Fixed

- **import() type reference false positives**: Re-exported types (e.g., `export { User } from './types'`) could produce false positive diffs because ts-morph serialized their types as `import("/absolute/path/types").User`, with different absolute paths between old and new snapshots. A `normalizeTypeText()` function now strips these `import("...")` prefixes before comparison.
- **Syntax errors silently ignored**: TypeScript errors in analyzed projects were silently recovered by ts-morph, potentially producing misleading snapshots. `extractFromPath()` now calls `getPreEmitDiagnostics()` and prints a warning to stderr listing up to 5 errors when TypeScript errors are found.
- **Generic constraint changes not detected**: `classifyTypeParamChanges()` only checked type parameter count; it never compared constraint text. `<T extends { id: string }>` → `<T extends { id: string; version: number }>` is now detected as a MAJOR change.
- **`@types/node` not installed in git archive temp dirs**: `ensureDeps()` now checks for `@types/node` after `npm install` and installs it with `--no-save` if missing, preventing Node.js built-in types (`Buffer`, `NodeJS.Timeout`, etc.) from falling back to `any`.

### New `ChangeKind` values

| Kind                         | Severity | Description                                   |
| ---------------------------- | -------- | --------------------------------------------- |
| `generic-constraint-changed` | MAJOR    | A generic type parameter's constraint changed |

### README

- Added "Why semver-checks?" section with real-world breaking change scenarios
- Added per-category before/after code examples for common rules
- Added Known Limitations section
- Added `SEMVER_CHECKS_VERBOSE=1` environment variable documentation
- Added git ref cwd requirement note to CLI reference
- Added snapshot CI caching workflow example
- Updated rule count: 39 → 40, test count: 48 → 50

## [0.2.0] - 2026-04-11

### Fixed (false negatives)

- **Generic parameter removed** was not detected as a breaking change (`generic-param-removed`)
- **Overload removed** was not detected as a breaking change (`overload-removed`)
- **Multi-overload signature comparison**: only the first signature pair was compared; now all matching pairs are compared
- **Class method signature changes** (parameter add/remove/type change) were not detected (`class-method-signature-changed`)
- **Class property type changes** were not detected (`class-property-type-changed`)
- **Interface methods** were not extracted at all — `getMethods()` output was missing from snapshots
- **Interface method removed/added/changed** now detected (`interface-method-removed`, `interface-method-added`, `interface-method-signature-changed`)
- **Enum member value changes** were not detected (`enum-member-value-changed`)
- **Interface property `isOptional` change not detected**: `foo?: string` → `foo: string` (optional→required) now emits `interface-property-became-required` (major); reverse emits `interface-property-became-optional` (minor)
- **Class/interface method overloads lost during extraction**: `getMethods()` returns one node per overload; extractor now groups by name and merges signatures (same pattern as top-level function overload handling)
- **Class property `isStatic`/`isOptional` changes not detected**: now emits `class-property-became-static`, `class-property-became-instance`, `class-property-became-required` (major) or `class-property-became-optional` (minor)
- **Class method `isStatic` change not detected**: instance→static now emits `class-method-became-static`; reverse emits `class-method-became-instance` (both major)
- **Enum explicit→implicit value change not detected**: `A = 1` → `A` (auto-increment 0) was missed due to `!== undefined && !== undefined` guard; condition simplified to `oldMember.value !== newMember.value`
- **Constructor overload `[0]`-only comparison**: all constructor overload pairs now compared; overload count changes emitted
- **Method signature `break` dropped later overload sub-changes**: both interface and class method loops now collect changes from all pairs before emitting the summary change

### Security / Robustness

- `cleanupTmpDir` now validates the path starts with `os.tmpdir()/semver-checks-` before deleting
- `getValueDeclaration()!` non-null assertion replaced with null-safe fallback (`getDeclaredType()`)
- Silent `catch {}` in `collectExports` now logs a warning to stderr when `SEMVER_CHECKS_VERBOSE=1`
- `convertFunctionSignatures` now handles `MethodSignature` nodes (interface methods) in addition to `MethodDeclaration`

### Types

- `ApiEnumSymbol.members`: `string[]` → `ApiEnumMember[]` (`{ name, value? }`)
- `ApiInterfaceSymbol` gains a `methods: ApiInterfaceMethod[]` field
- New exports: `ApiEnumMember`, `ApiInterfaceMethod`

### New `ChangeKind` values

| Kind                                 | Severity |
| ------------------------------------ | -------- |
| `generic-param-removed`              | major    |
| `overload-removed`                   | major    |
| `class-method-signature-changed`     | major    |
| `class-property-type-changed`        | major    |
| `interface-method-removed`           | major    |
| `interface-method-signature-changed` | major    |
| `enum-member-value-changed`          | major    |
| `interface-property-became-required` | major    |
| `class-property-became-static`       | major    |
| `class-property-became-instance`     | major    |
| `class-property-became-required`     | major    |
| `class-method-became-static`         | major    |
| `class-method-became-instance`       | major    |
| `interface-method-added`             | minor    |
| `interface-property-became-optional` | minor    |
| `class-property-became-optional`     | minor    |

Total ChangeKind values: 23 → **39**

### Additional Fixes

- **Constructor comparison** now uses `compareFunctionSignature` — optional→required parameter changes in constructors are correctly detected as MAJOR
- **Class/interface method signature changes** now emit both a summary `*-signature-changed` change and the granular sub-changes (param added/removed/type-changed, return-type-changed), so text output includes full before/after detail
- **Class/interface method overload comparison** now checks all matching signature pairs, not just the first one
- **`#private` field filtering** — ECMAScript `#name` private fields are excluded from API snapshots alongside `private`-keyword fields
- **`ChangeKind`, `ApiEnumMember`, `ApiInterfaceMethod`** are now exported from the package entry point
- **`convertFunctionType` (function-type variables)**: `isRest` is now correctly derived from the parameter declaration; `typeParameters` are now extracted from the call signature instead of hardcoded to `[]`
- **`getText()` context node** — all type serialization now passes the enclosing declaration node to `getText()`, preventing path-dependent strings like `import("/tmp/semver-checks-…").Config` when comparing git-ref snapshots against local paths

### Tests

- 19 new fixture test cases added
- Total: 29 → **48 tests**

---

## [0.1.0] - 2026-04-10

Initial release.

### Features

- TypeScript public API analysis based SemVer bump recommendation
- 23 breaking/non-breaking change detection rules (15 major, 8 minor)
- CLI with `compare` and `snapshot` subcommands
- Programmatic API (`compare`, `extract`, `diff`)
- Git ref comparison via `git archive`
- Dual CJS/ESM package with full type declarations
- npm provenance support

---

[0.9.0]: https://github.com/kyungseopk1m/semver-checks/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/kyungseopk1m/semver-checks/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/kyungseopk1m/semver-checks/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/kyungseopk1m/semver-checks/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/kyungseopk1m/semver-checks/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/kyungseopk1m/semver-checks/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/kyungseopk1m/semver-checks/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/kyungseopk1m/semver-checks/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/kyungseopk1m/semver-checks/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/kyungseopk1m/semver-checks/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/kyungseopk1m/semver-checks/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/kyungseopk1m/semver-checks/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/kyungseopk1m/semver-checks/releases/tag/v0.1.0
