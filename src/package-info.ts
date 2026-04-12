import { createRequire } from 'module';

const _require = createRequire(import.meta.url);

export function getPackageVersion(): string {
  // dist/mjs/package-info.js -> ../package.json (one level up)
  // dist/cjs/package-info.js -> ../package.json (one level up)
  // Fallback for any deeper nesting or unexpected publish layout
  try {
    return (_require('../package.json') as { version: string }).version;
  } catch {
    try {
      return (_require('../../package.json') as { version: string }).version;
    } catch {
      return 'unknown';
    }
  }
}
