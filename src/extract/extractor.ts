import type { ApiSnapshot } from './api-snapshot.js';
import { extractFromPath } from './ts-morph-backend.js';

export interface ExtractOptions {
  projectPath: string;
  entry?: string;
}

export async function extract(options: ExtractOptions): Promise<ApiSnapshot> {
  return extractFromPath(options.projectPath, options.entry);
}
