export function f<S>(x: S): S extends Array<infer T> ? S : never {
  return x as never;
}
