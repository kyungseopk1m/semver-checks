[![npm version](https://img.shields.io/npm/v/semver-checks.svg)](https://www.npmjs.com/package/semver-checks)
[![CI](https://github.com/kyungseopk1m/semver-checks/actions/workflows/ci.yml/badge.svg)](https://github.com/kyungseopk1m/semver-checks/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-green.svg)](https://nodejs.org/)

# semver-checks

Lint your TypeScript library's public API for semver violations.

```bash
npx semver-checks compare v1.0.0 HEAD
```

- [Why semver-checks?](#why-semver-checks)
- [Quick Start](#quick-start)
- [Programmatic API](#programmatic-api)
- [Change Rules](#change-rules)
- [CLI Reference](#cli-reference)
- [CI Integration](#ci-integration)
- [Comparison with Other Tools](#comparison-with-other-tools)
- [How It Works](#how-it-works)
- [FAQ](#faq)

## Why semver-checks?

Tools like `semantic-release` and `changesets` rely on developers writing correct commit messages. In practice, commit messages don't always reflect actual API impact — a "small refactor" that removes a required export gets published as a patch, and downstream consumers' builds break.

semver-checks **analyzes your TypeScript public API directly** using [ts-morph](https://github.com/dsherret/ts-morph) and recommends the correct SemVer bump based on what actually changed in the type signatures — not what the commit message says.

```typescript
// v1.0.0
export interface Config { host: string; port: number; }

// Developer writes: "fix: add missing timeout config"
// Published as patch — but this is a MAJOR change:
export interface Config { host: string; port: number; timeout: number; }
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

## Quick Start

```bash
npm install --save-dev semver-checks
```

Compare a git tag to the current working tree:

```bash
npx semver-checks compare v1.0.0 HEAD
```

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

Output as JSON:

```bash
npx semver-checks compare v1.0.0 HEAD --format json
```

Fail in CI if breaking changes are detected (`exit 1`):

```bash
npx semver-checks compare v1.0.0 HEAD --strict
```

Inspect the API surface of the current or a past version:

```bash
npx semver-checks snapshot
npx semver-checks snapshot --ref v1.0.0
```

### Example output

```
BREAKING CHANGES (2):
  required-property-added: Required property 'timeout' was added to 'Config'
  return-type-changed: Return type of 'findUser' changed from 'User | null' to 'User'

FEATURES (1):
  export-added: Export 'createConfig' was added

Recommendation: MAJOR (breaking changes detected)
```

## Programmatic API

```typescript
import { compare, extract } from 'semver-checks';

const report = await compare({
  oldSource: { type: 'git', ref: 'v1.0.0' },
  newSource: { type: 'path', path: '.' },
});

console.log(report.recommended); // 'major' | 'minor' | 'patch'
console.log(report.changes);     // ApiChange[]
console.log(report.summary);     // { major: 2, minor: 1, patch: 0 }
```

```typescript
interface CompareOptions {
  oldSource: SourceRef;
  newSource: SourceRef;
  entry?: string; // Optional: specify entry point (e.g., 'src/index.ts')
  installDeps?: boolean; // Optional: install deps before analyzing local path sources
}

type SourceRef =
  | { type: 'path'; path: string }
  | { type: 'git'; ref: string; cwd?: string };

interface SemverReport {
  recommended: 'major' | 'minor' | 'patch';
  changes: ApiChange[];
  summary: { major: number; minor: number; patch: number };
}

interface ApiChange {
  kind: ChangeKind;
  severity: 'major' | 'minor' | 'patch';
  symbolPath: string;
  message: string;
  oldValue?: string;
  newValue?: string;
}
```

You can also extract a snapshot independently:

```typescript
import { extract } from 'semver-checks';

const snapshot = await extract({ projectPath: '.' });
console.log(Object.keys(snapshot.symbols)); // all exported symbol names
```

## Change Rules

### Breaking changes (MAJOR)

| Rule | Description |
|------|---|
| `export-removed` | A public export was removed |
| `required-param-added` | A required parameter was added to a function |
| `param-removed` | A parameter was removed |
| `param-type-changed` | A parameter's type changed |
| `return-type-changed` | A function's return type changed |
| `property-removed` | An interface property was removed |
| `required-property-added` | A required property was added to an interface |
| `property-type-changed` | An interface property's type changed |
| `interface-property-became-required` | An optional interface property became required |
| `interface-property-became-readonly` | An interface property changed from mutable to readonly |
| `interface-method-removed` | An interface method was removed |
| `interface-method-signature-changed` | An interface method's signature changed |
| `enum-member-removed` | An enum member was removed |
| `enum-member-value-changed` | An enum member's value changed |
| `class-constructor-changed` | A class constructor's signature changed |
| `class-method-removed` | A public class method was removed |
| `class-method-signature-changed` | A public class method's signature changed |
| `class-method-became-static` | A class method changed from instance to static |
| `class-method-became-instance` | A class method changed from static to instance |
| `class-property-removed` | A public class property was removed |
| `class-property-type-changed` | A public class property's type changed |
| `class-property-became-static` | A class property changed from instance to static |
| `class-property-became-instance` | A class property changed from static to instance |
| `class-property-became-required` | An optional class property became required |
| `class-property-became-readonly` | A public class property changed from mutable to readonly |
| `generic-param-required` | A required generic parameter was added |
| `generic-param-removed` | A generic parameter was removed |
| `generic-constraint-changed` | A generic parameter's constraint changed |
| `overload-removed` | A function overload was removed |
| `type-alias-changed` | A type alias definition changed |
| `variable-type-changed` | An exported variable's type changed |

### New features (MINOR)

| Rule | Description |
|------|---|
| `export-added` | A new public export was added |
| `optional-param-added` | An optional parameter was added |
| `optional-property-added` | An optional property was added to an interface |
| `interface-method-added` | An interface method was added |
| `interface-property-became-optional` | A required interface property became optional |
| `interface-property-became-mutable` | An interface property changed from readonly to mutable |
| `enum-member-added` | An enum member was added |
| `overload-added` | A function overload was added |
| `generic-param-with-default` | A generic parameter with a default was added |
| `class-method-added` | A public class method was added |
| `class-property-added` | A public class property was added |
| `class-property-became-optional` | A required class property became optional |
| `class-property-became-mutable` | A public class property changed from readonly to mutable |

## CLI Reference

### compare

```
semver-checks compare <old> [new] [options]
```

| Option | Short | Description | Default |
|--------|-------|---|---|
| `--entry <path>` | `-e` | Entry file path (e.g., `src/index.ts`) | Auto-detect |
| `--format <type>` | `-f` | `text` or `json` | `text` |
| `--strict` | `-s` | Exit 1 if breaking changes are found | `false` |
| `--install-deps` |  | Install dependencies before analyzing local path inputs | `false` |
| `--old-as <kind>` |  | Force `<old>` to be interpreted as `path` or `ref` | Auto-detect |
| `--new-as <kind>` |  | Force `[new]` to be interpreted as `path` or `ref` | Auto-detect |

**Arguments:**
- `<old>`: git ref (tag, branch, commit SHA) or local directory path to the old version
- `[new]`: git ref or path to the new version; defaults to `.` (current directory)

> If an argument matches an existing filesystem path, semver-checks treats it as a path source even without a `./` prefix.
> Git refs are only used when no matching path exists.
> Use `--old-as ref` or `--new-as ref` when a git ref name collides with a real path.

> When using git refs, the command must run inside a git repository. The ref is resolved
> against the working directory's repo.

### snapshot

```
semver-checks snapshot [path] [options]
```

| Option | Short | Description |
|--------|-------|---|
| `--ref <ref>` | `-r` | Use a git ref instead of a local path |
| `--entry <path>` | `-e` | Entry file path |
| `--install-deps` |  | Install dependencies before analyzing a local path |

**Arguments:**
- `[path]`: project path; defaults to `.` (current directory)

### Environment variables

| Variable | Description |
|----------|---|
| `SEMVER_CHECKS_VERBOSE=1` | Print warnings for skipped symbols, type resolution failures, and dependency install issues |

## CI Integration

Add semver-checks to your GitHub Actions workflow to automatically catch breaking changes on every PR:

```yaml
name: Check SemVer

on:
  pull_request:
    branches: [main]

jobs:
  semver:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Required to access git history

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Check for breaking changes
        run: npx semver-checks compare v$(node -p "require('./package.json').version") HEAD --strict
```

### With snapshot caching

To avoid re-extracting the baseline on every run, cache the snapshot file:

```yaml
- name: Restore baseline snapshot
  id: cache
  uses: actions/cache@v4
  with:
    path: .semver-baseline.json
    key: semver-${{ github.event.pull_request.base.sha }}

- name: Generate baseline snapshot
  if: steps.cache.outputs.cache-hit != 'true'
  run: npx semver-checks snapshot --ref ${{ github.event.pull_request.base.sha }} > .semver-baseline.json
```

## Comparison with Other Tools

| | semver-checks | semantic-release | changesets | npm-check-updates |
|---|---|---|---|---|
| Input | TypeScript AST | Commit messages | Manual YAML | package.json |
| Detection | 44 typed rules | Keyword matching | Developer-declared | Version range only |
| Recommendation | Automatic | Based on message format | Manual per change | Dependency updates only |

semver-checks is **not** a replacement for release tooling — it's a verification layer. Use it alongside `semantic-release` or `changesets` to ensure the declared bump actually matches the code changes.

## How It Works

1. **Extract**: Parse old and new TypeScript source files using ts-morph, building a typed API snapshot (functions, interfaces, enums, classes, type aliases, variables)
2. **Diff**: Compare the two snapshots symbol by symbol — detect additions, removals, and signature changes
3. **Classify**: Apply the 44 classification rules to each diff, assigning `major`, `minor`, or `patch` severity
4. **Report**: Return a structured `SemverReport` with the recommended bump and per-change details

For git ref comparisons, the ref is extracted to a temporary directory via `git archive`, dependencies are installed there if needed, and the directory is cleaned up after extraction. Local path comparisons do not install dependencies unless you opt in with `--install-deps` or `installDeps: true`.

## FAQ

### Will semver-checks catch every semver violation?

No. The tool catches API surface changes that are mechanically detectable from TypeScript's static type system: removed exports, signature changes, type changes, optionality changes, and so on. It does not detect behavioral changes, documentation changes, or changes hidden behind conditional compilation.

### Does it have false positives?

Occasionally. Types are still compared mostly as normalized serialized text rather than full semantic assignability. Safe top-level union and intersection member reordering is normalized, so `string | number` and `number | string` no longer differ, but grouped expressions keep their original structure and deeper semantically equivalent rewrites can still produce diffs.

### Does it support default exports?

Not currently. Only named exports are analyzed.

### Can I use it without a tsconfig.json?

No. `tsconfig.json` must exist at the project root (or at the path inferred from the `exports` field in `package.json`).

### What happens if the analyzed project has TypeScript errors?

semver-checks will print a warning to stderr listing up to 5 errors and continue. Results may be incomplete if type errors affect the API surface. Set `SEMVER_CHECKS_VERBOSE=1` for full diagnostics.

### How is the entry point determined?

semver-checks looks for the entry file in this order:
1. The `--entry` flag if provided
2. The `types` field under `exports['.']` in `package.json`
3. The top-level `types` or `typings` field in `package.json`
4. `src/index.ts`, then `index.ts` as fallbacks

### Does it work with monorepos?

Yes. Point `--entry` at the package's specific entry file, or run the CLI from the package's subdirectory.

## Requirements

- Node.js ≥ 18.0.0
- `tsconfig.json` present in the analyzed project
- TypeScript source files (`.ts`/`.tsx`) — not compiled `.d.ts` files

### Dual module support

semver-checks ships both CommonJS and ES module builds:

```javascript
// ESM
import { compare } from 'semver-checks';

// CJS
const { compare } = require('semver-checks');
```

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](.github/CONTRIBUTING.md) before submitting a pull request.


## License

MIT. See [LICENSE](LICENSE).

## Author

Kyungseop Kim — [@kyungseopk1m](https://github.com/kyungseopk1m)
