import type { Missing, MissingA, MissingB } from 'no-such-package-anywhere';

export interface Node
  extends Missing<
    string,
    number
  > {
  label: string;
}

export interface Swapped extends MissingB {
  label: string;
}
