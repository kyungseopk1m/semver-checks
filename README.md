[![npm version](https://img.shields.io/npm/v/semver-checks.svg)](https://www.npmjs.com/package/semver-checks)
[![CI](https://github.com/kyungseopk1m/semver-checks/actions/workflows/ci.yml/badge.svg)](https://github.com/kyungseopk1m/semver-checks/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-green.svg)](https://nodejs.org/)

# semver-checks

Analyze TypeScript library changes and recommend SemVer bumps. Like [cargo-semver-checks](https://github.com/obi1kenobi/cargo-semver-checks) for Rust, but for TypeScript.

Instead of relying on commit messages or manual declarations, **semver-checks inspects actual code and type changes** to recommend whether you need a major, minor, or patch version bump.

## Why?

Existing tools like `semantic-release` and `changesets` depend on developers writing correct commit messages. Real-world experience shows this breaks down:

- Developers forget the conventional commit format
- Commit messages don't always match actual code impact
- No way to verify recommendations against actual API surface

semver-checks **analyzes your TypeScript public API directly** using [ts-morph](https://github.com/dsherret/ts-morph), extracts what changed, and recommends the correct SemVer bump based on 39 breaking/non-breaking change rules.

## Quick Start

### Installation

```bash
npm install --save-dev semver-checks
```

### CLI Usage

Compare two git references:

```bash
npx semver-checks compare v1.0.0 HEAD
```

Compare local directories:

```bash
npx semver-checks compare ./v1.0.0-src ./src
```

Output formatted as JSON:

```bash
npx semver-checks compare v1.0.0 HEAD --format json
```

Strict mode for CI (exit code 1 if breaking changes found):

```bash
npx semver-checks compare v1.0.0 HEAD --strict
```

View API surface snapshot:

```bash
npx semver-checks snapshot
npx semver-checks snapshot --ref v1.0.0
```

## Programmatic API

```typescript
import { compare } from 'semver-checks';

const report = await compare({
  oldSource: { type: 'git', ref: 'v1.0.0' },
  newSource: { type: 'path', path: '.' },
});

console.log(report.recommended); // 'major' | 'minor' | 'patch'
console.log(report.changes);     // ApiChange[]
console.log(report.summary);     // { major: 3, minor: 1, patch: 0 }
```

### Types

```typescript
interface CompareOptions {
  oldSource: SourceRef;
  newSource: SourceRef;
  entry?: string; // Optional: specify entry point (e.g., 'src/index.ts')
}

type SourceRef =
  | { type: 'path'; path: string }
  | { type: 'git'; ref: string; cwd?: string };

interface SemverReport {
  recommended: 'major' | 'minor' | 'patch';
  changes: ApiChange[];
  summary: {
    major: number;  // Count of breaking changes
    minor: number;  // Count of new features
    patch: number;  // Count of safe additions
  };
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

## Supported Change Rules

### Breaking Changes (MAJOR)

| Rule | Description |
|------|---|
| `export-removed` | A public export was removed |
| `required-param-added` | A required parameter was added to a function |
| `param-removed` | A parameter was removed from a function |
| `return-type-changed` | A function's return type changed |
| `param-type-changed` | A parameter type changed |
| `property-removed` | An interface property was removed |
| `required-property-added` | A required property was added to an interface |
| `property-type-changed` | An interface property type changed |
| `enum-member-removed` | An enum member was removed |
| `enum-member-value-changed` | An enum member's value changed |
| `class-method-removed` | A public class method was removed |
| `class-method-signature-changed` | A public class method's signature changed |
| `class-property-removed` | A public class property was removed |
| `class-property-type-changed` | A public class property's type changed |
| `generic-param-required` | A required generic parameter was added |
| `generic-param-removed` | A generic parameter was removed |
| `overload-removed` | A function overload was removed |
| `class-constructor-changed` | A class constructor signature changed |
| `type-alias-changed` | A type alias definition changed |
| `variable-type-changed` | An exported variable's type changed |
| `interface-method-removed` | An interface method was removed |
| `interface-method-signature-changed` | An interface method's signature changed |
| `interface-property-became-required` | An interface property changed from optional to required |
| `class-method-became-static` | A class method changed from instance to static |
| `class-method-became-instance` | A class method changed from static to instance |
| `class-property-became-static` | A class property changed from instance to static |
| `class-property-became-instance` | A class property changed from static to instance |
| `class-property-became-required` | A class property changed from optional to required |

### New Features (MINOR)

| Rule | Description |
|------|---|
| `export-added` | A new export was added |
| `optional-param-added` | An optional parameter was added to a function |
| `optional-property-added` | An optional property was added to an interface |
| `enum-member-added` | An enum member was added |
| `overload-added` | A function overload was added |
| `generic-param-with-default` | A generic parameter with a default was added |
| `class-method-added` | A public class method was added |
| `class-property-added` | A public class property was added |
| `interface-method-added` | An interface method was added |
| `interface-property-became-optional` | An interface property changed from required to optional |
| `class-property-became-optional` | A class property changed from required to optional |

## CLI Options

### compare

```bash
semver-checks compare <old> [new] [options]
```

| Option | Short | Description | Default |
|--------|-------|---|---|
| `--entry <path>` | `-e` | Entry file (e.g., `src/index.ts`) | Auto-detect |
| `--format <type>` | `-f` | Output format: `text` or `json` | `text` |
| `--strict` | `-s` | Exit code 1 if breaking changes found | `false` |

**Arguments:**
- `<old>`: Git reference (tag, branch, commit) or local path to old version
- `[new]`: Git reference or path to new version; defaults to current directory (`.`)

### snapshot

```bash
semver-checks snapshot [path] [options]
```

| Option | Short | Description |
|--------|-------|---|
| `--ref <ref>` | `-r` | Git reference instead of path |
| `--entry <path>` | `-e` | Entry file |

**Arguments:**
- `[path]`: Project path; defaults to current directory (`.`)

## Comparison with Other Tools

| Tool | Input | Detection | Recommendation |
|------|-------|-----------|---|
| **semver-checks** | TypeScript AST analysis | 39 breaking/non-breaking rules | Automatic (major/minor/patch) |
| semantic-release | Commit message parsing | Keyword-based (feat/fix/BREAKING) | Based on message format |
| changesets | Manual YAML declarations | Developer-declared | Manual per change |
| npm-check-updates | package.json comparison | Version range only | Dependency updates only |

semver-checks is **strict and automated**: it analyzes actual code changes, not commit messages or manual declarations. This makes it perfect for:

- **CI/CD gates**: Block releases with breaking changes
- **API design reviews**: Catch unintended breaking changes before merging
- **Version verification**: Confirm the recommended bump matches your changes

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
          fetch-depth: 0  # Required to access git tags

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Check for breaking changes
        run: npx semver-checks compare v$(node -p "require('./package.json').version") HEAD --strict
```

For release workflows, use `--strict` to fail the job if breaking changes are detected without a major version bump.

## How It Works

1. **Extract**: Parse old and new source code using ts-morph
2. **Snapshot**: Build an API surface representation for each version
3. **Diff**: Compare symbols, types, and signatures
4. **Classify**: Apply 39 rules to identify breaking/non-breaking changes
5. **Report**: Return structured change list and recommended bump

## Example Output

```
BREAKING CHANGES (1):
  export-removed: Export 'oldFunction' was removed
  └─ src/index.ts

FEATURES (2):
  export-added: Export 'newFunction' was added
  export-added: Export 'Helper' was added
  └─ src/index.ts

Recommendation: MAJOR (breaking changes detected)
```

## Requirements

- Node.js ≥ 18.0.0
- TypeScript source files with exported public API
- `tsconfig.json` in project root (or specified path)

### Dual Module Support

semver-checks exports both CommonJS and ES modules:

```javascript
// ES module
import { compare } from 'semver-checks';

// CommonJS
const { compare } = require('semver-checks');
```

## Testing

Run the test suite:

```bash
npm test
```

Run tests in watch mode:

```bash
npm run test:watch
```

The package includes 48 tests covering:
- Export additions/removals
- Function parameter changes (add, remove, type, overload)
- Interface property and method changes
- Enum member changes (add, remove, value)
- Class method/property/constructor changes
- Generic parameter changes
- Git reference resolution
- JSON and text output formatting

## Contributing

Contributions are welcome! Please read our [Contributing Guide](.github/CONTRIBUTING.md) before submitting a pull request.

This project follows the [Contributor Covenant Code of Conduct](.github/CODE_OF_CONDUCT.md).

For security vulnerabilities, please see our [Security Policy](SECURITY.md).

## License

MIT License. See [LICENSE](LICENSE) file.

## Author

Kyungseop Kim - [@kyungseopk1m](https://github.com/kyungseopk1m)
