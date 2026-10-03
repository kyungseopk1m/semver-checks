# MCP Server

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

| Argument      | Type                                                       | Required | Description                                                                            |
| ------------- | ---------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------- |
| `old`         | string                                                     | Yes      | Filesystem path, git ref (tag, branch, SHA), or npm spec (`p-limit@6.1.0`)              |
| `new`         | string                                                     |          | Same three forms. Defaults to `.`                                                       |
| `entry`       | string \| string[]                                         |          | Entry file(s) (e.g. `src/index.ts`). Comma-separated or an array. Auto-detected if omitted; an empty value is refused |
| `oldAs`       | `"path"` \| `"git"` (or `"ref"`) \| `"npm"`                  |          | Force interpretation of `old`                                                           |
| `newAs`       | `"path"` \| `"git"` (or `"ref"`) \| `"npm"`                  |          | Force interpretation of `new`                                                           |
| `declared`    | `"major"` \| `"minor"` \| `"patch"` \| `"none"` \| `"auto"` |          | Grade the bump the release declares, the same gate `--declared` applies on the CLI      |
| `maxChanges`  | integer                                                    |          | How many changes to include. Defaults to 50                                             |
| `installDeps` | boolean                                                    |          | Install dependencies before analysis                                                    |

A `name@version` that is not an existing path resolves to npm on its own, so comparing a working tree against the published release needs no checkout:

```json
{ "old": "your-lib@latest", "new": ".", "declared": "auto" }
```

`declared` adds a `declaration` object to the report with the same verdicts the CLI prints: `mismatch` when a proven break outranks what the release wrote down, `review` when the changes argue for more than that, `ok` otherwise. `"auto"` reads the declaration from `.changeset/*.md` and then the two `package.json` versions, and errors when it finds neither rather than reporting a pass.

Every report carries a `gate` object saying what each CLI gate would do with it, which is what the exit code carries on the command line: `{ "strict": "pass" | "fail", "strictReview": "pass" | "fail" }`. The two are different contracts, not two strengths of one check, and [Which gate to run](accuracy.md#which-gate-to-run) has the numbers: a passing `strict` is not a clean bill of health, because a real break the analyzer could not prove stays review-only. Passing `declared` changes the question both gates answer, exactly as it does on the CLI: the release is graded against the bump it writes down, so a proven break it already declares passes both, and `strictReview` promotes the ⚠️ review verdict rather than firing on every major.

Failures come back with a code the caller can branch on, in the message text and in an `error` field: `invalid_argument` for something a different call would fix (a misspelled argument, a value outside an enum, a wrong type, a source that is empty or malformed) and `analysis_failed` for a call that was well-formed and could not be answered (a ref or a package that does not exist, a project that would not compile). Retrying the second with the same arguments is wasted work.

The message text reads `Error: [code] message`. The `Error: ` prefix is what it has always been, but the code sits inside it, so a consumer that took the message as everything past a fixed offset needs the `error` field or a parse rather than a slice.

`maxChanges` bounds the response. A large major release runs to hundreds of findings, which is more than a tool result can carry, so changes come back ordered proven breaks first, then additions, then review-only ones, and the list stops at the cap. `summary` always counts every change, and an `omitted` field reports the number left out along with the `maxChanges` value that would return all of them.

#### `semver_snapshot`

| Argument      | Type                            | Required | Description                                                          |
| ------------- | ------------------------------- | -------- | -------------------------------------------------------------------- |
| `path`        | string                          |          | Filesystem path, git ref, or npm spec. Defaults to `.`                |
| `entry`       | string \| string[]              |          | Entry file(s). Comma-separated or an array                           |
| `pathAs`      | `"path"` \| `"git"` (or `"ref"`) \| `"npm"` |          | Force interpretation of `path`                          |
| `detail`      | boolean                         |          | Return each symbol's full type shape instead of its kind             |
| `maxBytes`    | integer                         |          | Byte budget for the returned symbols. Defaults to 40000              |
| `installDeps` | boolean                         |          | Install dependencies before analysis                                 |

The three source forms are the same ones `semver_compare` takes, so `zod@4.4.0` snapshots from the registry without a checkout.

By default each symbol comes back as its kind, because the full shapes are what make a snapshot large: for a package the size of `zod` they run more than an order of magnitude past the names and kinds that describe the same surface. `detail` asks for the shapes, and `maxBytes` bounds either form, with an `omitted` field reporting the count left out and the total. A response that drops nothing carries no such field.

The budget covers the symbols, and no symbol is exempt from it. A wide interface under `detail` can cost tens of kilobytes on its own, so a budget smaller than that returns no symbols and says so in `omitted`, rather than overshooting the number you passed. Only the entrypoint keys and the `omitted` field sit on top of the budget. Snapshots are serialized without indentation, which is what makes the budget a count rather than an estimate.

