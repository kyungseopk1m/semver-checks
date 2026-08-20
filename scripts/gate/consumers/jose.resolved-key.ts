// Probe for jose 6.2.4 -> 6.2.5. `ResolvedKey` gained a type parameter and its
// `key` property became that parameter rather than the `CryptoKey | Uint8Array`
// union, so a resolver that returns a narrower key narrows the result too and
// writing to `key` stops compiling. The package's own `createLocalJWKSet` is
// enough to trigger it. The main consumer annotates its resolver with the bare
// `JWTVerifyGetKey`, which keeps the default union and hides the narrowing.
import { jwtVerify, createLocalJWKSet } from 'jose';
import type { JSONWebKeySet } from 'jose';

const jwks: JSONWebKeySet = { keys: [] };
const keyStore = createLocalJWKSet(jwks);

export async function rekey(token: string): Promise<unknown> {
  const resolved = await jwtVerify(token, keyStore);
  resolved.key = new Uint8Array(16);
  return resolved.key;
}
