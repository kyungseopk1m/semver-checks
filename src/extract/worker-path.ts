import path from 'path';

// Where the compiled extraction worker sits, or null when this module is running
// from TypeScript source (vitest), where no compiled worker exists and
// `extract()` falls back to running in-process.
//
// This is the CommonJS form. The ESM build has no `__filename`, and `import.meta`
// cannot appear in a file the CommonJS build compiles, so fixup.sh overwrites
// dist/mjs/extract/worker-path.js with the `import.meta.url` form of this line.
export const extractWorkerPath: string | null =
  typeof __filename === 'string' && __filename.endsWith('.js') ? path.join(__dirname, 'extract-worker.js') : null;
