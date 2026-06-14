// Default rewritten to a structurally equivalent form (mutually assignable).
// An omitting consumer (`Box`) gets the identical type, so this is a no-op.
export interface Box<T = readonly string[]> {
  value: T;
}
