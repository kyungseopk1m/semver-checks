export function f<A>(x: A): A extends "Z" ? 1 : 0 {
  return (x as never);
}
