// The entry argument arrives in three shapes and means the same thing in all
// of them: one path, several (citty yields an array for a repeated `--entry`,
// and an MCP caller sends a JSON array), or one comma-separated string.
// Normalized to undefined, a single string, or a string[].
//
// Shared by the CLI and the MCP server rather than copied, and living here
// rather than in cli.ts because importing that module runs `runMain` and the
// `--mcp` branch.
export function parseEntryArg(input: string | string[] | undefined): string | string[] | undefined {
  if (input === undefined) return undefined;
  const raw = Array.isArray(input) ? input : [input];
  const entries = raw
    .flatMap((e) => e.split(','))
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
  // An argument that was given but names nothing is refused rather than read as
  // absent. `--entry "$FILES"` with an unset variable would otherwise widen the
  // analysis to the whole auto-detected surface without a word about it, which
  // is the same silent broadening `parseDeclaredBump` refuses for an empty
  // `--declared`.
  if (entries.length === 0) {
    throw new Error('entry must name at least one file');
  }
  return entries.length === 1 ? entries[0] : entries;
}
