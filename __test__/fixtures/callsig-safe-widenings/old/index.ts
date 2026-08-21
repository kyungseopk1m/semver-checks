export interface Limiter {
  <A extends unknown[], R>(fn: (...args: A) => R, ...args: A): R;
}
export interface Formatter {
  (value: string): string;
}
