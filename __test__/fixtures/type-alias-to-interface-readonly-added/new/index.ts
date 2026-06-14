// Converted to an interface AND made readonly. Structural assignability treats
// `{ a: string }` and `{ readonly a: string }` as mutually assignable, so an
// assignability-based equivalence check would wrongly suppress this — but writing
// `t.a = ...` breaks (TS2540), so it must stay a breaking change.
export interface T {
  readonly a: string;
}
