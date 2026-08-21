import type { AlphaShape } from './internal';

export interface Handle {
  shape: AlphaShape;
  tags: readonly string[];
}
