import fs from 'fs';
import path from 'path';

// Where the compiled extraction worker sits, or null when it is not there: this
// module running from TypeScript source (vitest), or bundled into one file by
// ncc/esbuild, which leaves no extract-worker.js beside it. `extract()` then
// runs in-process.
//
// This is the CommonJS form. The ESM build has no `__filename`, and `import.meta`
// cannot appear in a file the CommonJS build compiles, so fixup.sh overwrites
// dist/mjs/extract/worker-path.js with the `import.meta.url` form of these lines.
const compiled =
  typeof __filename === 'string' && __filename.endsWith('.js') ? path.join(__dirname, 'extract-worker.js') : null;
export const extractWorkerPath: string | null = compiled && fs.existsSync(compiled) ? compiled : null;
