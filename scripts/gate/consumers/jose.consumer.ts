// Transcribed from jose's documented quickstart, reached through the subpath
// entrypoints rather than the barrel: signing and verifying a JWT, encrypting
// one, key import/export, a local JWKS, base64url, and the error hierarchy.
import { SignJWT } from 'jose/jwt/sign';
import { jwtVerify } from 'jose/jwt/verify';
import { EncryptJWT } from 'jose/jwt/encrypt';
import { jwtDecrypt } from 'jose/jwt/decrypt';
import { generateKeyPair } from 'jose/key/generate/keypair';
import { generateSecret } from 'jose/key/generate/secret';
import { importJWK, importPKCS8 } from 'jose/key/import';
import { exportJWK, exportPKCS8 } from 'jose/key/export';
import { createLocalJWKSet } from 'jose/jwks/local';
import { decodeProtectedHeader } from 'jose/decode/protected_header';
import { calculateJwkThumbprint } from 'jose/jwk/thumbprint';
import { decode as base64urlDecode, encode as base64urlEncode } from 'jose/base64url';
import { JOSEError, JWTExpired, JWSInvalid, JWKSNoMatchingKey } from 'jose/errors';
import { CompactSign, compactVerify, UnsecuredJWT } from 'jose';
import type {
  JWTPayload,
  JWTHeaderParameters,
  JWTVerifyResult,
  JWK,
  JSONWebKeySet,
  CryptoKey,
  KeyObject,
} from 'jose';
import type { JWTVerifyOptions, JWTVerifyGetKey } from 'jose/jwt/verify';

interface SessionClaims extends JWTPayload {
  role: 'admin' | 'user';
  tenant: string;
}

const header: JWTHeaderParameters = { alg: 'ES256', typ: 'JWT' };

// The builder is a class with a chained `this` return; every link has to keep
// its own name and arity for this to hold.
function build(payload: SessionClaims): SignJWT {
  return new SignJWT(payload)
    .setProtectedHeader(header)
    .setIssuer('urn:example:issuer')
    .setSubject('urn:example:subject')
    .setAudience(['urn:example:audience'])
    .setJti('id-1')
    .setIssuedAt()
    .setNotBefore('-5m')
    .setExpirationTime('2h');
}

async function roundTrip(): Promise<void> {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  const token: string = await build({ role: 'admin', tenant: 'acme' }).sign(privateKey);

  // The type argument is supplied on purpose: the no-argument call falls back to
  // the default and would keep compiling through a change to the parameter list.
  const verified: JWTVerifyResult<SessionClaims> = await jwtVerify<SessionClaims>(token, publicKey, {
    issuer: 'urn:example:issuer',
    audience: 'urn:example:audience',
    clockTolerance: '5s',
  });
  void verified.payload.role;
  void verified.protectedHeader.alg;

  const options: JWTVerifyOptions = { maxTokenAge: '1h' };
  void options.maxTokenAge;

  const jwk: JWK = await exportJWK(publicKey);
  const pem: string = await exportPKCS8(privateKey);
  const reimported = await importJWK(jwk, 'ES256');
  const fromPem = await importPKCS8(pem, 'ES256');
  void reimported;
  void fromPem;

  const thumbprint: string = await calculateJwkThumbprint(jwk, 'sha256');
  void thumbprint;
}

async function encrypted(): Promise<void> {
  const secret = await generateSecret('A256GCM', { extractable: false });
  const jwe: string = await new EncryptJWT({ role: 'user', tenant: 'acme' } satisfies SessionClaims)
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .encrypt(secret);

  const { payload } = await jwtDecrypt<SessionClaims>(jwe, secret);
  void payload.tenant;
}

// A key-resolution function rather than a key: the resolver form is a separate
// overload, and a generic argument pins which one is being asked for.
const jwks: JSONWebKeySet = { keys: [] };
const localSet = createLocalJWKSet(jwks);
const getKey: JWTVerifyGetKey = async (protectedHeader, token) => {
  void protectedHeader.alg;
  void token;
  return await localSet(protectedHeader, token);
};

async function verifyThroughResolver(token: string): Promise<void> {
  const result = await jwtVerify<SessionClaims>(token, getKey);
  void result.payload.tenant;
}

async function detached(): Promise<void> {
  const secret = await generateSecret('HS256');
  const jws: string = await new CompactSign(new TextEncoder().encode('payload'))
    .setProtectedHeader({ alg: 'HS256' })
    .sign(secret);
  const { payload } = await compactVerify(jws, secret);
  void payload.byteLength;
  void decodeProtectedHeader(jws).alg;
}

function unsecured(): JWTPayload {
  const token = new UnsecuredJWT({ role: 'user', tenant: 'acme' }).setIssuedAt().encode();
  return UnsecuredJWT.decode(token).payload;
}

// The error hierarchy is a chain of subclasses, so narrowing has to keep working
// through the base class as well as each leaf.
function classify(err: unknown): string {
  if (err instanceof JWTExpired) return `expired:${err.claim}`;
  if (err instanceof JWKSNoMatchingKey) return 'no-key';
  if (err instanceof JWSInvalid) return 'malformed';
  if (err instanceof JOSEError) return err.code;
  return 'unknown';
}

// Named so a removal of either type export stops this file compiling.
type AnyKey = CryptoKey | KeyObject | Uint8Array;
const keyKinds: ReadonlyArray<string> = (['CryptoKey', 'KeyObject', 'Uint8Array'] as const).map((k) => k);
function widen(key: AnyKey): AnyKey {
  return key;
}

const roundTripped: string = base64urlEncode(base64urlDecode('aGVsbG8'));

export { build, roundTrip, encrypted, verifyThroughResolver, detached, unsecured, classify, localSet, roundTripped, widen, keyKinds };
export type { SessionClaims, AnyKey };
