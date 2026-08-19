// Probe for hono 4.12.29 -> 4.12.30, where `WSContextInit.send`'s `data` parameter
// narrowed from `Uint8Array<ArrayBufferLike>` to `Uint8Array<ArrayBuffer>`.
//
// `WSContextInit` is the object a consumer supplies when constructing a WSContext,
// so implementing it is the natural usage. Parameter position is contravariant:
// an implementation that accepts the wider type still satisfies the narrower
// contract, so this probe is expected to stay clean. It is here to establish that,
// not to manufacture an error.
import type { WSContextInit, SendOptions } from 'hono/ws';

export const init: WSContextInit<undefined> = {
  send(data: string | ArrayBuffer | Uint8Array, options: SendOptions): void {
    void data;
    void options;
  },
  close(code?: number, reason?: string): void {
    void code;
    void reason;
  },
  readyState: 1,
};
