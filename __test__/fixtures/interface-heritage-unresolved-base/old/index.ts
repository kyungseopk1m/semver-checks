// The base cannot be resolved, so the checker has no type text to give and extraction
// falls back to the clause's own text. Reformatting it must still be a no-op, and two
// different unresolvable bases must still be told apart.
import type { Missing, MissingA, MissingB } from 'no-such-package-anywhere';

export interface Node extends Missing<string,number> {
  label: string;
}

export interface Swapped extends MissingA {
  label: string;
}
