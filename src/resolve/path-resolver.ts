import path from 'path';
import fs from 'fs';

export function resolvePath(inputPath: string): string {
  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Path does not exist: ${resolved}`);
  }
  return resolved;
}
