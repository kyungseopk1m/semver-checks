export function f<A>(x: A): A extends "B" ? 1 : 0 {
  return (x as never);
}
