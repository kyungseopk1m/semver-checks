import type { BetaShape } from './internal';

export interface Handle {
  shape: BetaShape;
  tags: ReadonlyArray<string>;
}
