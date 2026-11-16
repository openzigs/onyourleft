// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A software authenticator** for the admin passkey tests (#2642): it makes
 * a WebAuthn registration and assertions as a browser hands them over —
 * `clientDataJSON`, the CBOR attestation object with `fmt: 'none'`, the
 * authenticator data and, for ES256, a DER-encoded signature — from a key it
 * generates in WebCrypto. No real device's output, nothing from one machine:
 * `fixtures/generate.ts` writes the committed fixtures with it, and the tests
 * enrol and sign in with it through the real handler.
 *
 * Test support, never shipped: nothing under `src/` but a test imports it.
 */

import { toHex } from '@onyourleft/domain';

import { COSE_ALGORITHMS, toBase64Url, type PasskeyAlgorithm } from './webauthn.ts';

/** A CBOR value the encoder writes: what an attestation object and a COSE key hold. */
export type CborInput =
  | number
  | string
  | boolean
  | null
  | Uint8Array
  | readonly CborInput[]
  | ReadonlyMap<number | string, CborInput>;

function head(major: number, value: number): number[] {
  if (value < 24) return [(major << 5) | value];
  if (value < 0x100) return [(major << 5) | 24, value];
  if (value < 0x10000) return [(major << 5) | 25, value >> 8, value & 0xff];
  return [
    (major << 5) | 26,
    (value >>> 24) & 0xff,
    (value >> 16) & 0xff,
    (value >> 8) & 0xff,
    value & 0xff,
  ];
}

/** Definite-length CBOR, as an authenticator writes it. */
export function encodeCbor(value: CborInput): Uint8Array {
  const out: number[] = [];
  const write = (item: CborInput): void => {
    if (typeof item === 'number') {
      out.push(...(item >= 0 ? head(0, item) : head(1, -1 - item)));
    } else if (typeof item === 'string') {
      const bytes = new TextEncoder().encode(item);
      out.push(...head(3, bytes.byteLength), ...bytes);
    } else if (typeof item === 'boolean') {
      out.push(item ? 0xf5 : 0xf4);
    } else if (item === null) {
      out.push(0xf6);
    } else if (item instanceof Uint8Array) {
      out.push(...head(2, item.byteLength), ...item);
    } else if (Array.isArray(item)) {
      out.push(...head(4, item.length));
      for (const entry of item as readonly CborInput[]) write(entry);
    } else {
      const map = item as ReadonlyMap<number | string, CborInput>;
      out.push(...head(5, map.size));
      for (const [key, entry] of map) {
        write(key);
        write(entry);
      }
    }
  };
  write(value);
  return new Uint8Array(out);
}

const sha256 = async (bytes: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));

/** WebCrypto's raw `r ‖ s` as the DER an authenticator sends. */
export function rawToDer(raw: Uint8Array): Uint8Array {
  const integer = (bytes: Uint8Array): number[] => {
    let start = 0;
    while (start < bytes.byteLength - 1 && bytes[start] === 0) start += 1;
    const trimmed = [...bytes.subarray(start)];
    if (((trimmed[0] as number) & 0x80) !== 0) trimmed.unshift(0);
    return [0x02, trimmed.length, ...trimmed];
  };
  const body = [...integer(raw.subarray(0, 32)), ...integer(raw.subarray(32))];
  return new Uint8Array([0x30, body.length, ...body]);
}

export interface Ceremony {
  readonly rpId: string;
  readonly origin: string;
  /** base64url. */
  readonly challenge: string;
}

/** What a test bends in a response, to see the verifier refuse it. */
export interface Bend {
  /** `webauthn.create` / `webauthn.get` unless a test says otherwise. */
  readonly type?: string;
  /** The RP ID the authenticator hashes, when not the ceremony's. */
  readonly rpIdHashed?: string;
  /** The flags byte: UP | UV (| AT at enrolment) unless a test says otherwise. */
  readonly flags?: number;
  /** The counter the authenticator reports, when not its own next. */
  readonly signCount?: number;
  readonly crossOrigin?: boolean;
}

export interface SoftwareRegistration {
  readonly credentialId: string;
  readonly clientDataJSON: string;
  readonly attestationObject: string;
}

export interface SoftwareAssertion {
  readonly credentialId: string;
  readonly clientDataJSON: string;
  readonly authenticatorData: string;
  readonly signature: string;
}

export interface SoftwareAuthenticator {
  readonly algorithm: PasskeyAlgorithm;
  /** base64url. */
  readonly credentialId: string;
  /** The public key as the verifier keeps it: hex. */
  readonly publicKey: string;
  /** The counter it last reported. */
  readonly signCount: number;
  register(ceremony: Ceremony, bend?: Bend): Promise<SoftwareRegistration>;
  assert(ceremony: Ceremony, bend?: Bend): Promise<SoftwareAssertion>;
}

const UP = 0x01;
const UV = 0x04;
const AT = 0x40;

type Key = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

/** A fresh extractable key pair of `algorithm`. */
export async function keyPair(
  algorithm: PasskeyAlgorithm,
): Promise<{ readonly publicKey: Key; readonly privateKey: Key }> {
  const made =
    algorithm === 'ed25519'
      ? await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
      : await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
          'sign',
          'verify',
        ]);
  if (!('privateKey' in made)) throw new TypeError('key generation made one key, not a pair');
  return made;
}

/**
 * A new authenticator holding one credential of `algorithm`. Its counter
 * starts at `counts === 'zero'` → always 0 (a synced passkey), else 1 and
 * rising with every assertion.
 */
export async function softwareAuthenticator(
  algorithm: PasskeyAlgorithm,
  counts: 'rising' | 'zero' = 'rising',
): Promise<SoftwareAuthenticator> {
  const pair = await keyPair(algorithm);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const credentialBytes = crypto.getRandomValues(new Uint8Array(32));
  const credentialId = toBase64Url(credentialBytes);
  let signCount = counts === 'zero' ? 0 : 1;

  const cose =
    algorithm === 'ed25519'
      ? new Map<number, CborInput>([
          [1, 1],
          [3, COSE_ALGORITHMS.ed25519],
          [-1, 6],
          [-2, raw],
        ])
      : new Map<number, CborInput>([
          [1, 2],
          [3, COSE_ALGORITHMS.es256],
          [-1, 1],
          [-2, raw.slice(1, 33)],
          [-3, raw.slice(33, 65)],
        ]);

  const clientData = (type: string, ceremony: Ceremony, bend: Bend): Uint8Array =>
    new TextEncoder().encode(
      JSON.stringify({
        type: bend.type ?? type,
        challenge: ceremony.challenge,
        origin: ceremony.origin,
        crossOrigin: bend.crossOrigin ?? false,
      }),
    );

  const authenticatorData = async (
    ceremony: Ceremony,
    bend: Bend,
    flags: number,
    count: number,
    attested: Uint8Array | null,
  ): Promise<Uint8Array> => {
    const rpIdHash = await sha256(new TextEncoder().encode(bend.rpIdHashed ?? ceremony.rpId));
    const counter = new Uint8Array([
      (count >>> 24) & 0xff,
      (count >> 16) & 0xff,
      (count >> 8) & 0xff,
      count & 0xff,
    ]);
    const parts = [rpIdHash, new Uint8Array([bend.flags ?? flags]), counter];
    if (attested !== null) parts.push(attested);
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.byteLength;
    }
    return out;
  };

  return {
    algorithm,
    credentialId,
    publicKey: toHex(raw),
    get signCount() {
      return signCount;
    },
    async register(ceremony, bend = {}) {
      const key = encodeCbor(cose);
      const attested = new Uint8Array(16 + 2 + credentialBytes.byteLength + key.byteLength);
      attested.set(new Uint8Array(16), 0);
      attested[16] = credentialBytes.byteLength >> 8;
      attested[17] = credentialBytes.byteLength & 0xff;
      attested.set(credentialBytes, 18);
      attested.set(key, 18 + credentialBytes.byteLength);
      const authData = await authenticatorData(
        ceremony,
        bend,
        UP | UV | AT,
        bend.signCount ?? 0,
        attested,
      );
      const attestationObject = encodeCbor(
        new Map<string, CborInput>([
          ['fmt', 'none'],
          ['attStmt', new Map()],
          ['authData', authData],
        ]),
      );
      return {
        credentialId,
        clientDataJSON: toBase64Url(clientData('webauthn.create', ceremony, bend)),
        attestationObject: toBase64Url(attestationObject),
      };
    },
    async assert(ceremony, bend = {}) {
      const count = bend.signCount ?? (counts === 'zero' ? 0 : signCount++);
      const data = clientData('webauthn.get', ceremony, bend);
      const authData = await authenticatorData(ceremony, bend, UP | UV, count, null);
      const signed = new Uint8Array(authData.byteLength + 32);
      signed.set(authData, 0);
      signed.set(await sha256(data), authData.byteLength);
      const signature = new Uint8Array(
        await crypto.subtle.sign(
          algorithm === 'ed25519' ? { name: 'Ed25519' } : { name: 'ECDSA', hash: 'SHA-256' },
          pair.privateKey,
          signed,
        ),
      );
      return {
        credentialId,
        clientDataJSON: toBase64Url(data),
        authenticatorData: toBase64Url(authData),
        signature: toBase64Url(algorithm === 'es256' ? rawToDer(signature) : signature),
      };
    },
  };
}
