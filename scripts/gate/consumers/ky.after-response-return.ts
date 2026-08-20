// Probe for ky 1.13.0 -> 1.14.0. `AfterResponseHook`'s return union gained
// `RetryMarker`, so code that runs the configured hooks and keeps the `Response`
// they produce no longer type-checks.
import type { AfterResponseHook, KyRequest, KyResponse, NormalizedOptions, AfterResponseState } from 'ky';

declare const hooks: AfterResponseHook[];
declare const request: KyRequest;
declare const options: NormalizedOptions;
declare const response: KyResponse;
declare const state: AfterResponseState;

export async function runAfterResponse(): Promise<Response> {
  let current: Response = response;
  for (const hook of hooks) {
    const result: Response | void = await hook(request, options, response, state);
    if (result) current = result;
  }
  return current;
}
