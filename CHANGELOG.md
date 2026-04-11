# Changelog

All notable changes to this project will be documented in this file.

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
