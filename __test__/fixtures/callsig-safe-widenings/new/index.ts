export interface Limiter {
  // Parameter renamed. Names play no part in structural assignability.
  <A extends unknown[], R>(function_: (...args: A) => R, ...args: A): R;
}
export interface Formatter {
  // Optional trailing parameter added. Every existing implementer still
  // satisfies the interface and every existing call site still type-checks.
  (value: string, locale?: string): string;
}
