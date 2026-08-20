// Probe for ky 1.14.1 -> 1.14.2. The `isKyError` type predicate widened to include
// `ForceRetryError`, so a handler that narrows through it and treats the result as
// the old two-member union stops compiling.
//
// Worth noting against the tool's output: it reports nothing about this predicate
// for this pair, and the one finding it does report (`RetryOptions.methods` going
// from `string[]` to `HttpMethod[]`) is inert, because `HttpMethod` is a
// `LiteralUnion` over `string`. So this pair is a detection gap, not a grading one.
import { isKyError, HTTPError, TimeoutError } from 'ky';

declare const error: unknown;

export function describe(): string {
  if (!isKyError(error)) return 'unknown';
  const kyError: HTTPError | TimeoutError = error;
  return kyError instanceof HTTPError ? `http ${kyError.response.status}` : 'timeout';
}
