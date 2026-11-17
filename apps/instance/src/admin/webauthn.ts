// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The admin pages' WebAuthn verifier** (#2642, ADR 0069 D-1, D-6), written
 * against WebCrypto and {@link readCbor} alone — no library, no Node builtin,
 * so the core stays `workerd`-portable (ADR 0037 D-2).
 *
 * `attestation: 'none'` makes the job a fixed layout (W3C Web Authentication
 * Level 3 §7.1 and §7.2, read for what `none` leaves):
 *
 * - **`clientDataJSON`**: its `type` (`webauthn.create` or `webauthn.get`),
 *   its `challenge` (exactly the one the instance issued), its `origin`
 *   (exactly the listener's), and `crossOrigin` not `true`;
 * - **the authenticator data**: the SHA-256 of the RP ID, the user-present
 *   AND user-verified flags (UV is checked, not only asked for), the
 *   signature counter, and at enrolment the attested credential: its id (at
 *   most 1023 bytes) and ONE COSE key;
 * - **the COSE key**: Ed25519 (`-8`, OKP, curve 6) or ES256 (`-7`, EC2,
 *   P-256) and nothing else (RFC 9053), imported into WebCrypto before it is
 *   accepted, so a point that is not on its curve is refused at enrolment;
 * - **the signature**, over `authenticatorData ‖ SHA-256(clientDataJSON)`. ⚠️
 *   **An ES256 signature arrives DER-encoded** and WebCrypto verifies the raw
 *   `r ‖ s`: {@link derToRaw} converts it, strictly, and the fixtures name the
 *   trap;
 * - **the counter**: one that is non-zero and does not increase is refused
 *   (a cloned authenticator); one that stays zero, as a synced passkey's
 *   does, is accepted.
 *
 * Every refusal is a {@link WebAuthnRefused} naming its check; nothing else
 * is thrown for anything the browser sent.
 */

import { fromHex, toHex } from '@onyourleft/domain';

import { CborError, readCbor, readCborItem, type CborKey, type CborValue } from './cbor.ts';

/** A CBOR map, typed as the reader makes it; `undefined` for anything else. */
function mapOf(value: CborValue | undefined): ReadonlyMap<CborKey, CborValue> | undefined {
  return value instanceof Map ? (value as ReadonlyMap<CborKey, CborValue>) : undefined;
}

/** Why a ceremony's response was refused: one name per check. */
export type WebAuthnRefusal =
  | 'malformed'
  | 'type'
  | 'challenge'
  | 'origin'
  | 'cross_origin'
  | 'rp_id'
  | 'user_present'
  | 'user_verified'
  | 'attestation'
  | 'algorithm'
  | 'credential'
  | 'public_key'
  | 'counter'
  | 'signature';

export class WebAuthnRefused extends Error {
  override readonly name = 'WebAuthnRefused';
  readonly reason: WebAuthnRefusal;
  constructor(reason: WebAuthnRefusal) {
    super(`WebAuthn response refused: ${reason}`);
    this.reason = reason;
  }
}

/** The two algorithms ADR 0069 D-1 admits, by the name the operator log writes. */
export type PasskeyAlgorithm = 'ed25519' | 'es256';

/** COSE algorithm identifiers (RFC 9053): what the creation options offer, in this order. */
export const COSE_ALGORITHMS: Readonly<Record<PasskeyAlgorithm, number>> = {
  ed25519: -8,
  es256: -7,
};

/** The longest credential id WebAuthn allows, in bytes (§5.8.3 of Level 3). */
export const MAX_CREDENTIAL_ID_BYTES = 1023;

/** The largest `clientDataJSON` the verifier reads, in bytes. */
export const MAX_CLIENT_DATA_BYTES = 2048;

/** What the instance expects of a response. */
export interface Expected {
  readonly rpId: string;
  /** Exactly: scheme, host and port. */
  readonly origin: string;
  /** The challenge the instance issued, base64url. */
  readonly challenge: string;
}

/** A passkey as the instance keeps it, for verifying an assertion. */
export interface StoredCredential {
  readonly algorithm: PasskeyAlgorithm;
  /** Ed25519's 32 bytes, or P-256's uncompressed point, as lowercase hex. */
  readonly publicKey: string;
  readonly signCount: number;
}

/** What an enrolment's response proves. */
export interface Registration {
  /** base64url. */
  readonly credentialId: string;
  readonly algorithm: PasskeyAlgorithm;
  readonly publicKey: string;
  readonly signCount: number;
}

export interface RegistrationResponse {
  readonly clientDataJSON: Uint8Array;
  readonly attestationObject: Uint8Array;
}

export interface AssertionResponse {
  readonly clientDataJSON: Uint8Array;
  readonly authenticatorData: Uint8Array;
  readonly signature: Uint8Array;
}

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;
const FLAG_ED = 0x80;

const BASE64URL = /^[A-Za-z0-9_-]*$/;

/** Unpadded base64url of `bytes`. */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The bytes of unpadded base64url `text`, or `undefined` when it is not that. */
export function fromBase64Url(text: string): Uint8Array | undefined {
  if (!BASE64URL.test(text) || text.length % 4 === 1) return undefined;
  const padded =
    text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  // Only the canonical spelling: no stray bits in the last character.
  return toBase64Url(bytes) === text ? bytes : undefined;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < a.byteLength; index += 1) {
    difference |= (a[index] as number) ^ (b[index] as number);
  }
  return difference === 0;
}

interface ClientData {
  readonly type: unknown;
  readonly challenge: unknown;
  readonly origin: unknown;
  readonly crossOrigin?: unknown;
}

function clientDataOf(bytes: Uint8Array): ClientData {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_CLIENT_DATA_BYTES) {
    throw new WebAuthnRefused('malformed');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new WebAuthnRefused('malformed');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new WebAuthnRefused('malformed');
  }
  return parsed as ClientData;
}

/**
 * The challenge a response's `clientDataJSON` names, base64url — read BEFORE
 * it is verified, to find which issued challenge it answers. Nothing is
 * trusted from it until {@link verifyAssertion} or {@link verifyRegistration}
 * holds it to that challenge.
 */
export function challengeOf(clientDataJSON: Uint8Array): string {
  const challenge = clientDataOf(clientDataJSON).challenge;
  if (typeof challenge !== 'string' || fromBase64Url(challenge) === undefined) {
    throw new WebAuthnRefused('malformed');
  }
  return challenge;
}

function checkClientData(
  bytes: Uint8Array,
  type: 'webauthn.create' | 'webauthn.get',
  expected: Expected,
): void {
  const data = clientDataOf(bytes);
  if (data.type !== type) throw new WebAuthnRefused('type');
  if (data.challenge !== expected.challenge) throw new WebAuthnRefused('challenge');
  if (data.origin !== expected.origin) throw new WebAuthnRefused('origin');
  if (data.crossOrigin !== undefined && data.crossOrigin !== false) {
    throw new WebAuthnRefused('cross_origin');
  }
}

interface AuthenticatorData {
  readonly rpIdHash: Uint8Array;
  readonly flags: number;
  readonly signCount: number;
  /** At enrolment: the attested credential. */
  readonly attested?: { readonly credentialId: Uint8Array; readonly coseKey: CborValue };
}

function authenticatorDataOf(bytes: Uint8Array): AuthenticatorData {
  if (bytes.byteLength < 37) throw new WebAuthnRefused('malformed');
  const rpIdHash = bytes.slice(0, 32);
  const flags = bytes[32] as number;
  const signCount =
    (bytes[33] as number) * 0x1000000 +
    ((bytes[34] as number) << 16) +
    ((bytes[35] as number) << 8) +
    (bytes[36] as number);
  let at = 37;
  let attested: AuthenticatorData['attested'];
  try {
    if ((flags & FLAG_AT) !== 0) {
      // The AAGUID (16 bytes, which `none` leaves meaningless), then the id.
      if (bytes.byteLength < at + 18) throw new WebAuthnRefused('malformed');
      at += 16;
      const length = ((bytes[at] as number) << 8) + (bytes[at + 1] as number);
      at += 2;
      if (length === 0 || length > MAX_CREDENTIAL_ID_BYTES) {
        throw new WebAuthnRefused('credential');
      }
      if (bytes.byteLength < at + length) throw new WebAuthnRefused('malformed');
      const credentialId = bytes.slice(at, at + length);
      at += length;
      const key = readCborItem(bytes, at);
      at = key.end;
      attested = { credentialId, coseKey: key.value };
    }
    if ((flags & FLAG_ED) !== 0) at = readCborItem(bytes, at).end;
  } catch (error) {
    if (error instanceof CborError) throw new WebAuthnRefused('malformed');
    throw error;
  }
  if (at !== bytes.byteLength) throw new WebAuthnRefused('malformed');
  return attested === undefined
    ? { rpIdHash, flags, signCount }
    : { rpIdHash, flags, signCount, attested };
}

async function checkAuthenticatorData(data: AuthenticatorData, expected: Expected): Promise<void> {
  if (!sameBytes(data.rpIdHash, await sha256(new TextEncoder().encode(expected.rpId)))) {
    throw new WebAuthnRefused('rp_id');
  }
  if ((data.flags & FLAG_UP) === 0) throw new WebAuthnRefused('user_present');
  if ((data.flags & FLAG_UV) === 0) throw new WebAuthnRefused('user_verified');
}

/** The COSE key, as the raw public key WebCrypto imports, or a refusal. */
function publicKeyOf(cose: CborValue): { algorithm: PasskeyAlgorithm; raw: Uint8Array } {
  const map = mapOf(cose);
  if (map === undefined) throw new WebAuthnRefused('public_key');
  const field = (label: number): CborValue | undefined => map.get(label);
  const kty = field(1);
  const alg = field(3);
  const crv = field(-1);
  const x = field(-2);
  if (alg === COSE_ALGORITHMS.ed25519) {
    if (kty !== 1 || crv !== 6 || !(x instanceof Uint8Array) || x.byteLength !== 32) {
      throw new WebAuthnRefused('public_key');
    }
    return { algorithm: 'ed25519', raw: x };
  }
  if (alg === COSE_ALGORITHMS.es256) {
    const y = field(-3);
    if (
      kty !== 2 ||
      crv !== 1 ||
      !(x instanceof Uint8Array) ||
      x.byteLength !== 32 ||
      !(y instanceof Uint8Array) ||
      y.byteLength !== 32
    ) {
      throw new WebAuthnRefused('public_key');
    }
    const raw = new Uint8Array(65);
    raw[0] = 0x04;
    raw.set(x, 1);
    raw.set(y, 33);
    return { algorithm: 'es256', raw };
  }
  throw new WebAuthnRefused('algorithm');
}

const IMPORT: Readonly<Record<PasskeyAlgorithm, Parameters<typeof crypto.subtle.importKey>[2]>> = {
  ed25519: { name: 'Ed25519' },
  es256: { name: 'ECDSA', namedCurve: 'P-256' },
};

const VERIFY: Readonly<Record<PasskeyAlgorithm, Parameters<typeof crypto.subtle.verify>[0]>> = {
  ed25519: { name: 'Ed25519' },
  es256: { name: 'ECDSA', hash: 'SHA-256' },
};

async function importKey(algorithm: PasskeyAlgorithm, raw: Uint8Array): Promise<CryptoKey> {
  try {
    return await crypto.subtle.importKey('raw', new Uint8Array(raw), IMPORT[algorithm], false, [
      'verify',
    ]);
  } catch {
    throw new WebAuthnRefused('public_key');
  }
}

/**
 * An ES256 signature's DER `SEQUENCE { INTEGER r, INTEGER s }` as the 64 raw
 * bytes WebCrypto verifies, or `undefined` for anything else: a long-form
 * length, a negative or over-long integer, a needless leading zero, or a byte
 * after the sequence.
 */
export function derToRaw(der: Uint8Array): Uint8Array | undefined {
  if (der.byteLength < 8 || der[0] !== 0x30 || der[1] !== der.byteLength - 2) return undefined;
  const raw = new Uint8Array(64);
  let at = 2;
  for (const offset of [0, 32]) {
    if (der[at] !== 0x02) return undefined;
    const length = der[at + 1] as number;
    at += 2;
    if (length === 0 || length > 33 || at + length > der.byteLength) return undefined;
    const integer = der.subarray(at, at + length);
    at += length;
    if (((integer[0] as number) & 0x80) !== 0) return undefined;
    if (integer[0] === 0 && (length === 1 || ((integer[1] as number) & 0x80) === 0)) {
      return undefined;
    }
    const value = integer[0] === 0 ? integer.subarray(1) : integer;
    if (value.byteLength > 32) return undefined;
    raw.set(value, offset + 32 - value.byteLength);
  }
  return at === der.byteLength ? raw : undefined;
}

/**
 * An enrolment's response verified (§7.1): the client data, the attestation
 * object (`fmt: 'none'` and an empty statement), the authenticator data and
 * its one COSE key. Answers the passkey to keep.
 */
export async function verifyRegistration(
  response: RegistrationResponse,
  expected: Expected,
): Promise<Registration> {
  checkClientData(response.clientDataJSON, 'webauthn.create', expected);
  let attestation: CborValue;
  try {
    attestation = readCbor(response.attestationObject);
  } catch (error) {
    if (error instanceof CborError) throw new WebAuthnRefused('malformed');
    throw error;
  }
  const object = mapOf(attestation);
  if (object === undefined) throw new WebAuthnRefused('malformed');
  const statement = mapOf(object.get('attStmt'));
  if (
    object.get('fmt') !== 'none' ||
    statement === undefined ||
    statement.size !== 0 ||
    object.size !== 3
  ) {
    throw new WebAuthnRefused('attestation');
  }
  const authData = object.get('authData');
  if (!(authData instanceof Uint8Array)) throw new WebAuthnRefused('malformed');
  const data = authenticatorDataOf(authData);
  await checkAuthenticatorData(data, expected);
  if (data.attested === undefined) throw new WebAuthnRefused('credential');
  const key = publicKeyOf(data.attested.coseKey);
  await importKey(key.algorithm, key.raw);
  return {
    credentialId: toBase64Url(data.attested.credentialId),
    algorithm: key.algorithm,
    publicKey: toHex(key.raw),
    signCount: data.signCount,
  };
}

/** Whether a counter of `next` may follow `stored`: it rises, or both are zero. */
export function counterMayFollow(stored: number, next: number): boolean {
  return next > stored || (stored === 0 && next === 0);
}

/**
 * An assertion verified (§7.2) against the passkey it names: the client
 * data, the authenticator data, the counter and the signature. Answers the
 * counter to keep.
 */
export async function verifyAssertion(
  response: AssertionResponse,
  credential: StoredCredential,
  expected: Expected,
): Promise<{ readonly signCount: number }> {
  checkClientData(response.clientDataJSON, 'webauthn.get', expected);
  const data = authenticatorDataOf(response.authenticatorData);
  if ((data.flags & FLAG_AT) !== 0) throw new WebAuthnRefused('malformed');
  await checkAuthenticatorData(data, expected);
  if (!counterMayFollow(credential.signCount, data.signCount)) {
    throw new WebAuthnRefused('counter');
  }
  const signature =
    credential.algorithm === 'es256'
      ? derToRaw(response.signature)
      : response.signature.byteLength === 64
        ? response.signature
        : undefined;
  if (signature === undefined) throw new WebAuthnRefused('signature');
  let raw: Uint8Array;
  try {
    raw = new Uint8Array(fromHex(credential.publicKey, 'the passkey', undefined));
  } catch {
    throw new WebAuthnRefused('public_key');
  }
  const key = await importKey(credential.algorithm, raw);
  const signed = new Uint8Array(response.authenticatorData.byteLength + 32);
  signed.set(response.authenticatorData, 0);
  signed.set(await sha256(response.clientDataJSON), response.authenticatorData.byteLength);
  let good: boolean;
  try {
    good = await crypto.subtle.verify(
      VERIFY[credential.algorithm],
      key,
      new Uint8Array(signature),
      signed,
    );
  } catch {
    good = false;
  }
  if (!good) throw new WebAuthnRefused('signature');
  return { signCount: data.signCount };
}
