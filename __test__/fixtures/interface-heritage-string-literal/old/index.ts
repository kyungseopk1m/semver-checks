export interface Base<A, B> {
  a: A;
  b: B;
}

// Spacing inside a string literal type IS part of the type: `"a, b"` and `"a,b"` are
// different. The compiler printer that canonicalizes the clause must leave it alone.
export interface Tagged extends Base<"a, b", number> {
  t: string;
}

// The escape and the mixed inner quote are the cases a naive quote-splitting
// normalizer gets wrong in the other direction.
export interface Escaped extends Base<"a\", b", number> {
  e: string;
}

export interface Backtick extends Base<`a", b`, number> {
  k: string;
}
