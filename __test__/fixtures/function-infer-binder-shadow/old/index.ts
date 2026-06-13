export function f<T>(x: T): T extends Array<infer T> ? T : never {
  return x as never;
}
