export interface Base<A, B> {
  a: A;
  b: B;
}

export interface Other {
  o: string;
}

// Same clause, only reformatted on the `new` side.
export interface Reformatted extends Base<string,number> {
  r: string;
}

// Independent bases, reordered on the `new` side.
export interface Reordered extends Base<string, number>, Other {
  d: string;
}

// Container type parameter alpha-renamed on the `new` side.
export interface Renamed<T> extends Base<T, number> {
  v: T;
}

// The same base listed twice is the same shape as listing it once.
export interface Duplicated extends Other, Other {
  z: string;
}

// Whitespace inside a string literal type argument IS part of the type.
export interface Quoted extends Base<"a, b", number> {
  q: string;
}

// Interpolation spacing is not part of the type; the printer normalizes it.
export interface Interpolated<T extends string> extends Base<`pre-${ T }-post`, number> {
  i: T;
}

// The three axes the checker normalizes but a syntactic printer does not: union
// member order, the two spellings of an array, and a generic default written out.
export interface Single<T> {
  s: T;
}

export interface Unioned extends Single<string | number> {
  u: string;
}

export interface Arrayed extends Single<string[]> {
  y: string;
}

export interface Defaulted<A, B = number> {
  da: A;
  db: B;
}

export interface Defaulting extends Defaulted<string> {
  f: string;
}
