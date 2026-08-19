// Probe for ky 1.11.0 -> 1.12.0 and 1.13.0, where `KyRequest`/`KyResponse` flipped
// between a type alias and an interface and back. Nothing was removed, so this
// records whether the declaration-form change is observable to a consumer using
// the types the ordinary way: as hook parameter and return annotations.
import type { KyRequest, KyResponse, BeforeRequestHook, AfterResponseHook } from 'ky';

const before: BeforeRequestHook = (request: KyRequest) => {
  void request.url;
  return undefined;
};

const after: AfterResponseHook = (_request: KyRequest, _options, response: KyResponse) => {
  void response.status;
  return response;
};

// Structural reuse of the types outside the hook signatures, the other ordinary way
// a consumer depends on them.
interface Traced {
  request: KyRequest;
  response: KyResponse;
}

export { before, after };
export type { Traced };
