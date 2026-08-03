export interface Base<A, B> {
  a: A;
  b: B;
}

export interface Tagged extends Base<"a,b", number> {
  t: string;
}

export interface Escaped extends Base<"a\",b", number> {
  e: string;
}

export interface Backtick extends Base<`a",b`, number> {
  k: string;
}
