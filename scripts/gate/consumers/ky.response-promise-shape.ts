// Probe for ky 1.8.2 -> 1.9.0. `ResponsePromise` gained a required `bytes`
// member, so a hand-built one, which is what a test double or a wrapper client
// makes, stops satisfying the type. The unchanged half of the intersection is
// taken as a `declare const` and the changed half is written out literally, so
// nothing is inherited from a real instance.
import type { ResponsePromise, KyResponse } from 'ky';

type Payload = { id: number };

declare const base: Promise<KyResponse<Payload>>;
declare const arrayBufferImpl: () => Promise<ArrayBuffer>;
declare const blobImpl: () => Promise<Blob>;
declare const formDataImpl: () => Promise<FormData>;
declare function jsonImpl<J = Payload>(): Promise<J>;
declare const textImpl: () => Promise<string>;

export const fake: ResponsePromise<Payload> = Object.assign(base, {
  arrayBuffer: arrayBufferImpl,
  blob: blobImpl,
  formData: formDataImpl,
  json: jsonImpl,
  text: textImpl,
});
