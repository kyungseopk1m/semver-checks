# Changelog

All notable changes to this project will be documented in this file.

## [0.5.0] - 2026-06-12

### Added

- **npm 레지스트리 직접 비교**: `compare <package>@<version>` 형태로 배포된 npm 버전을 old 소스로 받아 현재 working tree(또는 다른 버전)와 비교합니다. `npm pack`으로 tarball을 내려받아 추출하고 동봉된 `.d.ts` 선언을 분석합니다. 버전·범위·dist-tag 모두 지원하며(`pkg@1.2.3`, `pkg@^1`, `pkg@latest`), `npm:` 스킴으로 명시할 수 있습니다. `--old-as npm` / `--new-as npm`으로 강제 지정도 가능합니다. `snapshot --npm <spec>`도 추가되었습니다.
- **출력 포맷 `markdown`·`github` 추가**: `--format markdown`은 PR 코멘트나 `$GITHUB_STEP_SUMMARY`에 적합한 Markdown 요약을, `--format github`은 PR diff에 인라인으로 표시되는 GitHub Actions 워크플로 커맨드(`::error::` / `::warning::`)를 출력합니다. 기존 `text`·`json`은 그대로 유지됩니다.
- **재사용 가능한 GitHub Action**: `kyungseopk1m/semver-checks@<version>` composite action으로 PR마다 자동 semver 체크를 실행할 수 있습니다(inputs: `old`/`new`/`entry`/`format`/`strict`/`version`). Markdown PR 코멘트까지 포함한 전체 예시는 `examples/github-actions.yml`에 있습니다.

### Changed

- **entry 자동 감지가 `.d.ts` 진입점을 지원**: `package.json`의 `types` 경로를 src(`*.ts`)로 매핑하지 못하면 선언 파일(`*.d.ts`) 원본을 그대로 entry로 사용합니다. 배포된 npm 패키지(소스 미동봉) 분석을 가능하게 하며, 기존 소스 레이아웃 동작에는 영향이 없습니다(폴백만 추가).

### Tests

- npm spec 감지(`source-ref`), Markdown/GitHub 포맷 출력·이스케이프(`report`), `.d.ts` entry 해소 및 실제 `npm pack` 경로(`npm-resolve`) 테스트 추가
- 실 레지스트리 접속 테스트는 `SEMVER_CHECKS_NETWORK_TESTS=1`로만 동작(오프라인 CI green 유지)
- Total: 97 → **127 tests** (네트워크 게이트 테스트 별도)

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

| Kind | Severity | Description |
|------|----------|-------------|
| `param-type-widened` | MINOR | A parameter's type was widened (existing callers still type-check) |
| `return-type-narrowed` | MINOR | A function's return type was narrowed (existing consumers still type-check) |

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

| Kind | Severity | Description |
|------|----------|-------------|
| `required-interface-method-added` | MAJOR | A required (non-optional) method was added to an interface |
| `required-class-property-added` | MAJOR | A required (non-optional) property was added to a class |

### Tests

- 7 new fixture sets cover all new rules and edge cases
- Total: 78 → **85 tests**

## [0.3.1] - 2026-04-12

### Added

- **MCP server support**: semver-checks now runs as a [Model Context Protocol](https://modelcontextprotocol.io) server via `semver-checks --mcp`. AI agents (Claude Code, Codex, Cursor, etc.) can call it as a tool without any custom integration.
  - `semver_compare` — compare two versions and get a SemVer recommendation
  - `semver_snapshot` — extract the public API surface as a JSON snapshot
  - `semver_diff` — diff two previously extracted snapshots
- Setup: `claude mcp add semver-checks -- npx -y semver-checks --mcp`

### Changed

- **MCP argument validation is now strict**: invalid string/boolean/enum inputs now return explicit tool errors instead of silently falling back to default behavior.
- **Publish flow now runs tests automatically** via `prepublishOnly`, so `npm publish` cannot skip `vitest`, build, or `publint`.
- **`attw` now runs in explicit release/CI steps instead of inside `prepublishOnly`**. This avoids an `ENOENT semver-checks-0.3.1.tgz` failure caused by nested `npm pack` during the `npm publish` lifecycle, while keeping package-type validation in `npm run check`, `npm run deploy`, and the GitHub publish workflow.
- README MCP setup now documents the non-interactive `npx -y` form and clarifies that relative paths/git refs are resolved from the server process working directory.

### Tests

- 15 MCP server tests cover tool listing, compare/snapshot/diff flows, runtime validation errors, unknown tools, and stdio transport
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

| Kind | Severity | Description |
|------|----------|---|
| `interface-property-became-readonly` | MAJOR | An interface property changed from mutable to readonly |
| `class-property-became-readonly` | MAJOR | A class property changed from mutable to readonly |
| `interface-property-became-mutable` | MINOR | An interface property changed from readonly to mutable |
| `class-property-became-mutable` | MINOR | A class property changed from readonly to mutable |

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

| Kind | Severity | Description |
|------|----------|---|
| `generic-constraint-changed` | MAJOR | A generic type parameter's constraint changed |

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

| Kind | Severity |
|------|----------|
| `generic-param-removed` | major |
| `overload-removed` | major |
| `class-method-signature-changed` | major |
| `class-property-type-changed` | major |
| `interface-method-removed` | major |
| `interface-method-signature-changed` | major |
| `enum-member-value-changed` | major |
| `interface-property-became-required` | major |
| `class-property-became-static` | major |
| `class-property-became-instance` | major |
| `class-property-became-required` | major |
| `class-method-became-static` | major |
| `class-method-became-instance` | major |
| `interface-method-added` | minor |
| `interface-property-became-optional` | minor |
| `class-property-became-optional` | minor |

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

[Unreleased]: https://github.com/kyungseopk1m/semver-checks/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/kyungseopk1m/semver-checks/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/kyungseopk1m/semver-checks/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/kyungseopk1m/semver-checks/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/kyungseopk1m/semver-checks/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/kyungseopk1m/semver-checks/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/kyungseopk1m/semver-checks/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/kyungseopk1m/semver-checks/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/kyungseopk1m/semver-checks/releases/tag/v0.1.0
