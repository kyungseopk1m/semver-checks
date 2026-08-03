export interface Base<A, B> {
  a: A;
  b: B;
}

export interface Other {
  o: string;
}

export interface Reformatted
  extends Base<
    string,
    number
  > {
  r: string;
}

export interface Reordered extends Other, Base<string, number> {
  d: string;
}

export interface Renamed<S> extends Base<S, number> {
  v: S;
}

export interface Duplicated extends Other {
  z: string;
}

export interface Quoted
  extends Base<"a, b",
    number
  > {
  q: string;
}

export interface Interpolated<S extends string> extends Base<`pre-${S}-post`, number> {
  i: S;
}

export interface Single<T> {
  s: T;
}

export interface Unioned extends Single<number | string> {
  u: string;
}

export interface Arrayed extends Single<Array<string>> {
  y: string;
}

export interface Defaulted<A, B = number> {
  da: A;
  db: B;
}

export interface Defaulting extends Defaulted<string, number> {
  f: string;
}
