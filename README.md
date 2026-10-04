[![npm version](https://img.shields.io/npm/v/semver-checks.svg)](https://www.npmjs.com/package/semver-checks)
[![CI](https://github.com/kyungseopk1m/semver-checks/actions/workflows/ci.yml/badge.svg)](https://github.com/kyungseopk1m/semver-checks/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%5E20.0.0%20%7C%7C%20%3E%3D22.0.0-green.svg)](https://nodejs.org/)

# semver-checks

`pino` 10.4.0, a minor release, added `export { pino as default, pino }` inside its `pino` namespace. That turns off implicit export for 9 members of the namespace, so `const t: pino.TimeFn = () => ''` compiles against 10.3.1 and fails against 10.4.0 with TS2694, "Namespace 'pino' has no exported member 'TimeFn'".

```bash
npx semver-checks compare pino@10.3.1 pino@10.4.0
```

Run with no arguments in a publishable package directory, `npx semver-checks` compares `<name>@latest` against `.`. This default is CLI-only: the GitHub Action and the MCP `semver_compare` tool need `old` explicitly.

```
semver-checks — Recommended bump: MAJOR
  major: 20 (confident: 11, review: 9)  minor: 88  patch: 0

  Breaking Changes — confident (MAJOR)
  ✗ Export 'TimeFn' was removed
      was: type-alias
  ✗ Export 'MixinFn' was removed
      was: type-alias
  ✗ Export 'MixinMergeStrategyFn' was removed
      was: type-alias
  ...
```

The output is trimmed to the bump counts and three of the 9 removed exports (`...` marks the cut, and stderr warnings are omitted); the full run also lists the other six, plus review-only findings and the added exports.

semver-checks compares the TypeScript declarations on both sides and recommends the bump the type changes require, so the answer comes from the API rather than from the commit message. Neither side needs a checkout: each can be an npm spec, a git ref, or the working tree.

```bash
npx semver-checks compare your-package@latest .
```

The same check as a pull request gate, which annotates the changed lines and fails on a proven break:

```yaml
# .github/workflows/semver-check.yml
on: pull_request
jobs:
  semver-checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - run: npm ci
      - uses: kyungseopk1m/semver-checks@v0.14.0
        with:
          old: "your-package@latest"
          strict: "true"
```

Every input, and the release-pull-request variant that grades the declared bump and posts the verdict as a comment, are under [GitHub Action](#github-action).

- [Why semver-checks?](#why-semver-checks)
- [Quick Start](#quick-start)
- [CI Integration](#ci-integration)
- [Accuracy](#accuracy)
- [Programmatic API](#programmatic-api)
- [Reference](#reference)
- [FAQ](#faq)

## Why semver-checks?

A bump is a claim about what a release did to its public API, and it is usually written by hand, from memory, at the end of the work. A refactor that drops a required export reads as a patch to the person who wrote it and as a broken build to everyone downstream.

Release tooling can only act on the evidence it is given. `semantic-release` derives the release type from commit conventions, and `changesets` records an author-written release note with the bump declared in its frontmatter. Both inherit whatever the author believed at the time.

semver-checks **reads the public API directly** using [ts-morph](https://github.com/dsherret/ts-morph) and decides the bump from what the type signatures did.

The example above is not constructed. Run the tool across real releases and it finds breaking type changes that shipped as minors and patches. It is most dependable on **structural changes**, which is to say removed or renamed exports, narrowed signatures, and added required parameters and properties. Equivalence-preserving type rewrites are a known weak spot it can over-report, and [docs/accuracy.md](docs/accuracy.md) says exactly where to trust it and where not to.

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
export function findUser(id: string): User;

// Developer writes: "fix: findUser can come up empty"
// Published as minor — but no existing consumer is written to handle null:
export function findUser(id: string): User | null;
//                                    ^^^^^^^^^^^ return-type-changed (MAJOR)
```

The reverse of that change is not a break: narrowing `User | null` down to `User` hands every consumer a value they were already prepared for, and semver-checks reports it as `return-type-narrowed`, a MINOR.

semver-checks is complementary to your existing release workflow. Use it as a **verification step** before publishing — it tells you whether your intended bump is safe, or whether you're about to ship a breaking change by accident.

## Quick Start

```bash
npm install --save-dev semver-checks
```

Compare a git tag to the latest commit:

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
npx semver-checks snapshot --npm p-limit@6.1.0
```

Every flag is in [docs/cli.md](docs/cli.md).

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
  ? Call signatures of interface 'Middleware' changed
      before: (req: string) => void
      after:  (request: string, next?: (() => void) | undefined) => void

  New Features (MINOR)
  + Export 'createConfig' was added
```

The second finding is a renamed parameter and an added optional one, which oblige nobody — but call signatures are compared as printed text, so the tool cannot prove that and says so instead of guessing. `--strict` exits 1 on the confident break only; the review-only item passes the gate unless you opt into `--strict-review`.

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
          node-version: "22"
      - run: npm ci

      - uses: kyungseopk1m/semver-checks@v0.14.0
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
| `old-as`        | Force `old` to be read as `path`, `git`, or `npm`. What a monorepo tag like `pkg@1.2.3` needs, since auto-detection reads that shape as an npm spec | _(auto-detect)_ |
| `new-as`        | Force `new` to be read as `path`, `git`, or `npm`                                         | _(auto-detect)_            |
| `install-deps`  | Install dependencies on both sides before analysis, whatever their source kind. Needed for a local path; a git ref already installs on its own | `false` |
| `format`        | `text`, `json`, `markdown`, or `github`                                                   | `github`                   |
| `strict`        | Fail the step (exit 1) on a **confident (proven)** breaking change                        | `false`                    |
| `strict-review` | Fail the step (exit 1) on **any** breaking change, including review-only (heuristic) ones | `false`                    |
| `declared`      | The bump this release declares: `major`, `minor`, `patch`, `none`, or `auto`. Fails the step when it understates a **proven** break, and takes over from `strict` | _(off)_ |
| `comment`       | Post the report to the PR as a comment, updated on later pushes (forces `format: markdown`) | `false` |
| `token`         | Token used to post the comment. A composite action cannot read the `secrets` context, so it has to be passed in | `${{ github.token }}` |
| `version`       | semver-checks version to run via `npx`                                                    | _(matches the action ref)_ |

A full example lives in [`examples/github-actions.yml`](examples/github-actions.yml).

#### On a release pull request

Does the bump this release declares cover what its API surface did? `@clerk/break-check` and `semvet` also score the declared bump from the two `package.json` versions; reading it from `.changeset` files is what is specific here. `declared: auto` reads the bump from `.changeset/*.md` and falls back to the two `package.json` versions, and `comment: true` puts the verdict on the pull request instead of leaving it in the log.

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
          node-version: "22"
      - run: npm ci

      - uses: kyungseopk1m/semver-checks@v0.14.0
        with:
          old: "your-package@latest"
          declared: "auto"
          comment: "true"
```

The step fails when the declaration understates a proven break, and passes with a note when it only understates an addition. `token` defaults to `github.token`; pass it explicitly if your setup needs a different one. A pull request from a fork gets a read-only token, so the comment is skipped with a warning there rather than failing the step.

The comment is posted with `gh pr comment --edit-last --create-if-none`, which updates the token owner's most recent comment on the pull request. It does not look for a marker of its own, so if the same token posts other comments from other workflows, run this one under its own token or leave `comment` off.

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

## Accuracy

Every breaking change carries a **confidence**. `proven` means the change is its own evidence, or a type relation the analyzer resolved and found genuinely unrelated; `--strict` fails on those and only those. `heuristic` means a conservative MAJOR it could not prove — surfaced for review, off the default gate, unless you opt into `--strict-review`.

The scorecard uses `tsc` as its oracle rather than the author's published bump, because the tool exists on the premise that authors get that bump wrong. 111 adjacent minor/patch release pairs across 24 packages, each with a consumer program compiled against both sides:

| Flag | Fails on | Result on 111 pairs (43 real breaks) | The contract it can hold |
|---|---|---|---|
| `--strict` | `proven` MAJORs only | fires on 37 pairs, 36 of them real: **precision 97.3%, recall 83.7%** | A failure is a strong signal. A pass is not a clean bill of health |
| `--strict-review` | every MAJOR | fires on all 43 real breaks and 10 pairs holding none: **recall 100%, precision 81.1%** | Green means the analysis reported nothing breaking anywhere |

A name-and-arity baseline with no type resolution scores 87.5% / 32.6% on the same corpus. Leave `--strict` on for every push, and run `--strict-review` where a person reads the output before it ships.

**[docs/accuracy.md](docs/accuracy.md)** has the rest: how the corpus was built, the 7 pairs `--strict` stays quiet on and why each one, the single remaining false positive, what the variance probe refuses to answer, and the ten known limitations.

## Programmatic API

```typescript
import { compare, extract } from "semver-checks";

const report = await compare({
  oldSource: { type: "git", ref: "v1.0.0" },
  newSource: { type: "path", path: "." },
});

console.log(report.recommended); // 'major' | 'minor' | 'patch'
console.log(report.changes); // ApiChange[]
console.log(report.summary); // { major: 2, minor: 1, patch: 0, ... }
```

```typescript
interface CompareOptions {
  oldSource: SourceRef;
  newSource: SourceRef;
  entry?: string | string[]; // Optional: specify one or more entry points
  installDeps?: boolean; // Optional: install deps on both sides before analyzing
  declared?: DeclaredBump | "auto"; // Optional: grade the bump this release declares
}

type DeclaredBump = "major" | "minor" | "patch" | "none";

type SourceRef =
  | { type: "path"; path: string }
  | { type: "git"; ref: string; cwd?: string }
  | { type: "npm"; spec: string }; // e.g. { type: 'npm', spec: 'p-limit@6.1.0' }

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
  // Present only when a declared bump was supplied or detected.
  declaration?: BumpDeclaration;
}

interface BumpDeclaration {
  declared: DeclaredBump;
  source: string; // where it was read from: a changeset path, or the two versions
  required: "major" | "minor" | "patch"; // what the proven breaks require
  suggested: "major" | "minor" | "patch"; // what the whole change set argues for
  verdict: "ok" | "review" | "mismatch";
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

## Reference

| Document | What's in it |
| --- | --- |
| [docs/cli.md](docs/cli.md) | Every `compare` and `snapshot` flag, exit codes, output formats, and the `--declared` verdict table |
| [docs/change-rules.md](docs/change-rules.md) | All `ChangeKind` values, MAJOR and MINOR |
| [docs/mcp.md](docs/mcp.md) | MCP server setup and both tool schemas |
| [docs/accuracy.md](docs/accuracy.md) | The corpus, the confidence grades, and the known limitations |

### MCP server

semver-checks ships as a [Model Context Protocol](https://modelcontextprotocol.io) server, so an agent can call it as a tool:

```bash
claude mcp add semver-checks -- npx -y semver-checks --mcp
```

Two tools: `semver_compare` and `semver_snapshot`. Setup for other clients and the full argument schemas are in [docs/mcp.md](docs/mcp.md).

## Comparison with Other Tools

|                | semver-checks   | semantic-release        | changesets                  | npm-check-updates       |
| -------------- | --------------- | ----------------------- | --------------------------- | ----------------------- |
| Input          | TypeScript API  | Commit messages         | Author-written changeset    | package.json            |
| Detection      | Typed API rules | Keyword matching        | Developer-declared          | Version range only      |
| Recommendation | Automatic       | Based on message format | Manual per change           | Dependency updates only |

semver-checks is a verification layer, not a release tool. Use it alongside `semantic-release` or `changesets` to check whether the declared bump matches the API changes.

### How it differs

[`ts-semver-checks`](https://www.npmjs.com/package/ts-semver-checks), [`@clerk/break-check`](https://www.npmjs.com/package/@clerk/break-check) and [`semvet`](https://github.com/Nithinfgs/semvet) each compare a local build against a baseline. `ts-semver-checks` and `semvet` use compiler assignability; `ts-semver-checks` takes the bump you expect through `--expect` and has no Action or MCP server, while `semvet` scores the declared bump from `package.json`. `@clerk/break-check` diffs API Extractor snapshots, adds an LLM review pass, scores the declared bump from `package.json`, and handles multi-package monorepos.

semver-checks can compare two published npm releases directly (`compare pkg@x pkg@y`), reads the declared bump from `.changeset` files, ships an MCP server, and publishes its accuracy numbers in [docs/accuracy.md](docs/accuracy.md).

## How It Works

1. **Extract**: Parse old and new TypeScript source files using ts-morph, building a typed API snapshot (functions, interfaces, enums, classes, type aliases, variables, namespaces)
2. **Diff**: Compare the two snapshots symbol by symbol — detect additions, removals, and signature changes
3. **Classify**: Assign each diff a `major`, `minor`, or `patch` severity
4. **Report**: Return a structured `SemverReport` with the recommended bump and per-change details

For git ref comparisons, the ref is extracted to a temporary directory via `git archive`, dependencies are installed there, and the directory is cleaned up afterwards. For npm specs, the published tarball is downloaded with `npm pack` and extracted to a temporary directory, with no dependency install, because the tarball already bundles its build output. Local path comparisons install nothing by default. `--install-deps` (or `installDeps: true`) overrides that and runs the install on both sides whatever their source kind — it is there for the local-path case, which is the only one that needs it.

## FAQ

### Will semver-checks catch every semver violation?

No. It catches API surface changes that are mechanically detectable from TypeScript's static type system: removed exports, signature changes, type changes, optionality changes, and similar structural changes. It does not detect behavioral changes, documentation changes, or changes hidden behind conditional compilation. When a package ships _distinct_ ESM and CJS declaration files for the same entry point (for example, divergent `import.types` and `require.types`), only one surface is analyzed, so a break confined to the other surface can be missed. See [docs/accuracy.md](docs/accuracy.md).

### Does it have false positives?

Yes. It errs toward over-reporting MAJOR rather than missing a break, but the default CI gate only fails on `proven` breaks. Parameter and return type changes go through a structural assignability check, so widened parameters, narrowed returns, and equivalent rewrites such as `readonly T[]` vs `ReadonlyArray<T>` avoid false majors. Type aliases and variables still have conservative cases because they are compared as normalized serialized text first, and the probe upgrades that to a resolved relation only where it can. The concrete patterns are listed under [Known limitations](docs/accuracy.md#known-limitations).

### Does it support default exports?

Yes. A default export is extracted under the symbol name `default` and compared like the corresponding function, class, or value declaration.

### Can I compare against a published npm version?

Yes. Pass a `<package>@<version>` spec and semver-checks downloads that release from the registry with `npm pack`, extracts the tarball, and analyzes its bundled `.d.ts` declarations:

```bash
npx semver-checks compare your-package@latest          # published latest vs working tree
npx semver-checks compare your-package@1.0.0 your-package@2.0.0  # two published releases
```

Because a published tarball ships compiled `.d.ts` files while your working tree ships `.ts` source, type _representation_ can differ slightly between the two sides (TypeScript materializes some inferred types in declarations). Removals, additions, and signature changes are detected reliably; a handful of equivalent-but-reworded types may show up as a noisy diff. Comparing two published releases (`.d.ts` vs `.d.ts`) avoids that asymmetry.

### Can I use it without a tsconfig.json?

Not for local-path or git-ref inputs: those are opened as a TypeScript project and need a `tsconfig.json` at the project root, or at the root inferred from the `exports` field in `package.json`. Published npm inputs are different — a permissive config is synthesized when the tarball does not ship one.

### What happens if the analyzed project has TypeScript errors?

semver-checks will print a warning to stderr listing up to 5 errors and continue. Results may be incomplete if type errors affect the API surface. Set `SEMVER_CHECKS_VERBOSE=1` for full diagnostics.

### How is the entry point determined?

semver-checks looks for the entry file in this order:

1. The `--entry` flag if provided
2. The declaration under `exports['.']` in `package.json` — every condition is walked (`types`, `require`/`import`/`node`/`browser`/`module`/`default`, nested, and fallback arrays), and `.d.ts`/`.d.mts`/`.d.cts` are all accepted. A bare-string `"exports": "./index.js"` or a flat conditions object `"exports": { "types": "./index.d.ts", "default": "./index.js" }` (no `.` subpath key) is treated as the `.` entry, so its `types` condition is read; for a published package, a `.js` target is also checked for a sibling declaration of the same name. A subpath-only map with no `.` key is left without a root entry (no fabricated root)
3. The top-level `types` or `typings` field in `package.json`
4. `src/index.ts`, then `index.ts`, then a conventional root `index.d.ts`/`.d.mts`/`.d.cts` as fallbacks

If none of these resolve, pass `--entry` explicitly.

When a project ships an `"exports"` map with several subpaths, each subpath is resolved and compared independently (see [Multiple entry points](#multiple-entry-points)).

### Does it work with monorepos?

Yes. Point `--entry` at the package's entry file, or run the CLI from that package's directory. A monorepo tag shaped like `pkg@1.2.3` reads as an npm spec to auto-detection, so pass `--old-as ref` for those.

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
