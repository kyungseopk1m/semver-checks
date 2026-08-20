// Probe for jose 6.2.4 -> 6.2.5. `JWK` and `JWKParameters` changed from
// interfaces to object type aliases. Reading them is unaffected, but a consumer
// that augments the module to add its own field is declaring a duplicate
// identifier once the target is no longer an interface.
import type { JWK } from 'jose';

declare module 'jose' {
  interface JWK {
    tenant?: string;
  }
}

export const merged: JWK = { kty: 'oct' };
