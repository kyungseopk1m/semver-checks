// Probe for ky 1.9.1 -> 1.10.0. `SearchParamsOption`'s record values gained
// `| undefined`. Building the options object still checks out; narrowing the value
// back out of `Options` and passing it somewhere typed the old way does not.
import type { Options } from 'ky';

declare const options: Options;
declare function logParams(params: Record<string, string | number | boolean>): void;

const { searchParams } = options;
if (
  searchParams !== undefined &&
  typeof searchParams === 'object' &&
  !Array.isArray(searchParams) &&
  !(searchParams instanceof URLSearchParams)
) {
  logParams(searchParams);
}
export {};
