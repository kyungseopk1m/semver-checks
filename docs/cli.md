# CLI Reference

### compare

```
semver-checks compare [old] [new] [options]
```

With no subcommand, `semver-checks` runs `compare`, so `npx semver-checks` alone compares the package's last published release against the working tree.

| Option            | Short | Description                                                                           | Default     |
| ----------------- | ----- | ------------------------------------------------------------------------------------- | ----------- |
| `--entry <path>`  | `-e`  | Entry file path (e.g., `src/index.ts`); repeat or comma-separate for multiple entries | Auto-detect |
| `--format <type>` | `-f`  | `text`, `json`, `markdown`, or `github`                                               | `text`      |
| `--strict`        | `-s`  | Exit 1 if a **confident (proven)** breaking change is found — safe to gate CI on      | `false`     |
| `--strict-review` |       | Exit 1 if **any** breaking change is found, including review-only (heuristic) ones    | `false`     |
| `--declared <bump>` |     | The bump this release declares: `major`, `minor`, `patch`, `none`, or `auto`. Exit 1 when it understates a **proven** break | _(off)_ |
| `--install-deps`  |       | Install dependencies on both sides before analysis, whatever their source kind        | `false`     |
| `--old-as <kind>` |       | Force `[old]` to be interpreted as `path`, `ref` (or `git`), or `npm`                 | Auto-detect |
| `--new-as <kind>` |       | Force `[new]` to be interpreted as `path`, `ref` (or `git`), or `npm`                 | Auto-detect |

**Arguments:**

- `[old]`: an npm spec (`pkg@version`), a git ref (tag, branch, commit SHA), or a local directory path for the old version; defaults to `npm:<name>@latest`, read from the `package.json` in the current directory (exit 2 when it has no `name` or is `private`)
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
> Use `--old-as ref` / `--new-as ref` (or `--old-as npm`) when auto-detection guesses wrong. The action takes the same two as `old-as` / `new-as`.

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
| `--npm <spec>`   |       | Snapshot a published npm package (e.g. `p-limit@6.1.0`)        |
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

