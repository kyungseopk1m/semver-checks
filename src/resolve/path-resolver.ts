import path from 'path';
import fs from 'fs';
import os from 'os';

function expandHome(inputPath: string): string {
  if (inputPath === '~' || inputPath.startsWith('~/')) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

export function pathExists(inputPath: string): boolean {
  return fs.existsSync(path.resolve(expandHome(inputPath)));
}

export function resolvePath(inputPath: string): string {
  const resolved = path.resolve(expandHome(inputPath));
  if (!fs.existsSync(resolved)) {
    throw new Error(`Path does not exist: ${resolved}`);
  }
  return resolved;
}
