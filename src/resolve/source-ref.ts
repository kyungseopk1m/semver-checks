import type { SourceRef } from '../types.js';
import { pathExists, resolvePath } from './path-resolver.js';

export type SourceInputKind = 'path' | 'git';

export function resolveSourceInput(input: string, preferredKind?: SourceInputKind): SourceRef {
  if (preferredKind === 'git') {
    return { type: 'git', ref: input };
  }

  if (preferredKind === 'path') {
    return { type: 'path', path: resolvePath(input) };
  }

  if (pathExists(input)) {
    return { type: 'path', path: resolvePath(input) };
  }

  return { type: 'git', ref: input };
}
