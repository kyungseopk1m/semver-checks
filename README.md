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
- [MCP Server](#mcp-server)
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
  major: 2  minor: 1  patch: 0

  Breaking Changes (MAJOR)
  ✗ Required property 'timeout' was added to interface 'Config'
      now: number
  ✗ Type alias 'UserId' changed
      before: string | number
      after:  string

  New Features (MINOR)
  + Export 'createConfig' was added
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
  | { type: 'git'; ref: string; cwd?: string }
  | { type: 'npm'; spec: string }; // e.g. { type: 'npm', spec: 'lodash@4.17.21' }

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
// Snapshots are keyed by export subpath ('.' is the root entry; additional
// subpaths come from the package.json "exports" map).
console.log(Object.keys(snapshot.entrypoints['.'])); // root entry's symbol names
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
| `required-interface-method-added` | A required interface method was added |
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
| `required-class-property-added` | A required class property was added |
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
| `interface-method-added` | An optional interface method was added |
| `interface-property-became-optional` | A required interface property became optional |
| `interface-property-became-mutable` | An interface property changed from readonly to mutable |
| `enum-member-added` | An enum member was added |
| `overload-added` | A function overload was added |
| `generic-param-with-default` | A generic parameter with a default was added |
| `class-method-added` | A public class method was added |
| `class-property-added` | An optional public class property was added |
| `class-property-became-optional` | A required class property became optional |
| `class-property-became-mutable` | A public class property changed from readonly to mutable |
| `param-type-widened` | A parameter's type was widened — existing callers still type-check (contravariant) |
| `return-type-narrowed` | A function's return type was narrowed — existing consumers still type-check (covariant) |

## CLI Reference

### compare

```
semver-checks compare <old> [new] [options]
```

| Option | Short | Description | Default |
|--------|-------|---|---|
| `--entry <path>` | `-e` | Entry file path (e.g., `src/index.ts`); repeat or comma-separate for multiple entries | Auto-detect |
| `--format <type>` | `-f` | `text`, `json`, `markdown`, or `github` | `text` |
| `--strict` | `-s` | Exit 1 if breaking changes are found | `false` |
| `--install-deps` |  | Install dependencies before analyzing local path inputs | `false` |
| `--old-as <kind>` |  | Force `<old>` to be interpreted as `path`, `ref` (or `git`), or `npm` | Auto-detect |
| `--new-as <kind>` |  | Force `[new]` to be interpreted as `path`, `ref` (or `git`), or `npm` | Auto-detect |

**Arguments:**
- `<old>`: an npm spec (`pkg@version`), a git ref (tag, branch, commit SHA), or a local directory path for the old version
- `[new]`: npm spec, git ref, or path for the new version; defaults to `.` (current directory)

**Output formats:**
- `text` — colored human-readable summary (default)
- `json` — the structured `SemverReport`
- `markdown` — a Markdown summary suitable for a PR comment or `$GITHUB_STEP_SUMMARY`
- `github` — [GitHub Actions workflow commands](https://docs.github.com/actions/using-workflows/workflow-commands-for-github-actions) (`::error::` / `::warning::`) that surface inline on the PR

> If an argument matches an existing filesystem path, semver-checks treats it as a path source even without a `./` prefix.
> A `<package>@<version>` shape that is not an existing path is resolved from the npm registry.
> A plain ref (`v1.2.3`, `main`) has no `@version` and is resolved as a git ref.
> A git ref that happens to share the `name@version` shape (e.g. a lerna/monorepo tag like `pkg@1.0.0`) would be auto-detected as an npm spec — force git resolution with `--old-as ref` in that case.
> Use `--old-as ref` / `--new-as ref` (or `--old-as npm`) when auto-detection guesses wrong.

> When using git refs, the command must run inside a git repository. The ref is resolved
> against the working directory's repo.

### snapshot

```
semver-checks snapshot [path] [options]
```

| Option | Short | Description |
|--------|-------|---|
| `--ref <ref>` | `-r` | Use a git ref instead of a local path |
| `--npm <spec>` |  | Snapshot a published npm package (e.g. `lodash@4.17.21`) |
| `--entry <path>` | `-e` | Entry file path; repeat or comma-separate for multiple entries |
| `--install-deps` |  | Install dependencies before analyzing a local path |

**Arguments:**
- `[path]`: project path; defaults to `.` (current directory)

### Global options

| Option | Description |
|--------|-------------|
| `--mcp` | Start semver-checks as an MCP server over stdio |

### Environment variables

| Variable | Description |
|----------|---|
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

| Tool | Description |
|------|-------------|
| `semver_compare` | Compare two versions and get a SemVer recommendation + change list |
| `semver_snapshot` | Extract the public API surface of a project as a JSON snapshot |
| `semver_diff` | Diff two previously extracted snapshots |

#### `semver_compare`

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `old` | string | Yes | Filesystem path or git ref (tag, branch, SHA) |
| `new` | string | | Filesystem path or git ref. Defaults to `.` |
| `entry` | string | | Entry file (e.g. `src/index.ts`). Auto-detected if omitted |
| `oldAs` | `"path"` \| `"git"` | | Force interpretation of `old` |
| `newAs` | `"path"` \| `"git"` | | Force interpretation of `new` |
| `installDeps` | boolean | | Install dependencies before analysis |

`oldAs` and `newAs` accept only `"path"` or `"git"` in MCP mode.

#### `semver_snapshot`

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `path` | string | | Filesystem path or git ref. Defaults to `.` |
| `entry` | string | | Entry file |
| `asGitRef` | boolean | | Treat `path` as a git ref |
| `installDeps` | boolean | | Install dependencies before analysis |

#### `semver_diff`

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `oldSnapshot` | object | Yes | Snapshot JSON from `semver_snapshot` |
| `newSnapshot` | object | Yes | Snapshot JSON from `semver_snapshot` |

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
          node-version: '20'
      - run: npm ci

      - uses: kyungseopk1m/semver-checks@v0.5.0
        with:
          old: 'your-package@latest'   # the published version to compare against
          format: 'github'             # inline ::error:: / ::warning:: annotations
          strict: 'true'               # fail the PR on a breaking change
```

| Input | Description | Default |
|-------|-------------|---------|
| `old` | Old version — an npm spec (`pkg@latest`), git ref, or path | _(required)_ |
| `new` | New version — git ref or path | `.` |
| `entry` | Entry file (auto-detected from `package.json` when omitted) | _(auto)_ |
| `format` | `text`, `json`, `markdown`, or `github` | `github` |
| `strict` | Fail the step (exit 1) on a breaking change | `false` |
| `version` | semver-checks version to run via `npx` | _(matches the action ref)_ |

A full example that also posts a Markdown summary as a sticky PR comment lives in [`examples/github-actions.yml`](examples/github-actions.yml).

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
| Detection | 48 typed rules | Keyword matching | Developer-declared | Version range only |
| Recommendation | Automatic | Based on message format | Manual per change | Dependency updates only |

semver-checks is **not** a replacement for release tooling — it's a verification layer. Use it alongside `semantic-release` or `changesets` to ensure the declared bump actually matches the code changes.

## How It Works

1. **Extract**: Parse old and new TypeScript source files using ts-morph, building a typed API snapshot (functions, interfaces, enums, classes, type aliases, variables, namespaces)
2. **Diff**: Compare the two snapshots symbol by symbol — detect additions, removals, and signature changes
3. **Classify**: Apply the 48 classification rules to each diff, assigning `major`, `minor`, or `patch` severity
4. **Report**: Return a structured `SemverReport` with the recommended bump and per-change details

For git ref comparisons, the ref is extracted to a temporary directory via `git archive`, dependencies are installed there if needed, and the directory is cleaned up after extraction. For npm specs, the published tarball is downloaded with `npm pack` and extracted to a temporary directory (no dependency install — the tarball already bundles its build output), then cleaned up. Local path comparisons do not install dependencies unless you opt in with `--install-deps` or `installDeps: true`.

## FAQ

### Will semver-checks catch every semver violation?

No. The tool catches API surface changes that are mechanically detectable from TypeScript's static type system: removed exports, signature changes, type changes, optionality changes, and so on. It does not detect behavioral changes, documentation changes, or changes hidden behind conditional compilation.

### Does it have false positives?

Occasionally, but less than before. Parameter and return type changes now go through a structural assignability check — a synthesized TypeScript program decides whether a change is a widening or a narrowing — so a widened parameter or a narrowed return type is classified as minor instead of a false major, and structurally equivalent rewrites like `readonly T[]` vs `ReadonlyArray<T>` are treated as no-ops. Other positions (type aliases, variables) are still compared as normalized serialized text: top-level union and intersection member reordering is normalized, so `string | number` and `number | string` no longer differ, but grouped expressions and deeper equivalent rewrites in those positions can still produce diffs. When a type can't be resolved in isolation (imported types, bare generics, or anything involving `any`), the tool falls back to the conservative major verdict.

### Does it support default exports?

Not currently. Only named exports are analyzed.

### Can I compare against a published npm version?

Yes. Pass a `<package>@<version>` spec and semver-checks downloads that release from the registry with `npm pack`, extracts the tarball, and analyzes its bundled `.d.ts` declarations:

```bash
npx semver-checks compare your-package@latest          # published latest vs working tree
npx semver-checks compare your-package@1.0.0 your-package@2.0.0  # two published releases
```

Because a published tarball ships compiled `.d.ts` files while your working tree ships `.ts` source, type *representation* can differ slightly between the two sides (TypeScript materializes some inferred types in declarations). Removals, additions, and signature changes are detected reliably; a handful of equivalent-but-reworded types may show up as a noisy diff. Comparing two published releases (`.d.ts` vs `.d.ts`) avoids that asymmetry.

### Can I use it without a tsconfig.json?

For local path and git-ref inputs, yes — `tsconfig.json` must exist at the project root (or at the path inferred from the `exports` field in `package.json`). For npm specs, a permissive `tsconfig.json` is synthesized automatically when the published package does not ship one.

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
- For local path / git-ref inputs: a `tsconfig.json` and TypeScript source files (`.ts`/`.tsx`) in the analyzed project
- For npm specs: nothing extra — the tarball's bundled `.d.ts` declarations are analyzed, and a `tsconfig.json` is synthesized if absent

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
