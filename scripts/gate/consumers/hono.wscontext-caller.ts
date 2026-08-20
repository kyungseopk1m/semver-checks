// Probe for hono 4.12.29 -> 4.12.30, the caller half of the WSContextInit change.
// The sibling probe holds the implementer position, which stays safe because a
// narrowed parameter is contravariant. A consumer that *calls* `send` on a
// WSContextInit, which is what a relay or adapter does, is the other half, and
// nothing compiled it until now. Node's Buffer and a plain Uint8Array both stop
// being accepted.
import type { WSContextInit } from 'hono/ws';

declare const init: WSContextInit<unknown>;
declare const buf: Buffer;
declare const bytes: Uint8Array;

export function relayBuffer(): void {
  init.send(buf, {} as never);
}

export function relayBytes(): void {
  init.send(bytes, {} as never);
}
