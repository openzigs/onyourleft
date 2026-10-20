// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The instance's cryptography, all of it WebCrypto (#772, ADR 0037).
 *
 * `globalThis.crypto` is the same API on Node 24 and on Cloudflare Workers,
 * so nothing here names `node:crypto` and the Durable Object adapter (#781)
 * mounts it unchanged. Node's WebCrypto marks Ed25519 stable since v23.5.0.
 *
 * ## The instance's own private keys (#1189, ADR 0047 D-4, D-5)
 *
 * ⚠️ **The instance holds long-term private keys**, and this paragraph used
 * to say it never did — a reviewer who remembers *"the instance never holds
 * a private key"* is reading the old file. Since #1189 it holds two: an
 * Ed25519 **identity** key that devices pin and that signs, and a rotating
 * X25519 **encryption** key, the HPKE recipient. Both live in `instance_key`,
 * wrapped with AES-256-GCM under a key derived from the operator's secret
 * (`keys/wrap.ts`), and are unwrapped only into memory as non-extractable
 * `CryptoKey`s (`keys/instance-keys.ts`); no secret, no keys.
 *
 * Beyond those, it verifies signatures a device made with a key that never
 * left the device (ADR 0014 D-3), and the other secrets it keeps — nonces,
 * session tokens, tickets, link, recovery and email-recovery codes — are
 * random bytes, of which it keeps the SHA-256 wherever it keeps anything.
 * {@link instanceHpkePrimitives} (#1188) is the HPKE port `/v1/sealed`
 * (#1191) opens requests with.
 */

import {
  fromHex,
  HpkeError,
  isHexOfLength,
  PUBLIC_KEY_BYTES,
  SIGNATURE_BYTES,
  toHex,
  type HpkePrimitives,
} from '@onyourleft/domain';

const ED25519 = { name: 'Ed25519' } as const;

/** `count` random bytes. */
export function randomBytes(count: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(count));
}

/** `count` random bytes as lowercase hex. */
export function randomHex(count: number): string {
  return toHex(randomBytes(count));
}

/** `count` random bytes as unpadded base64url — the spelling of a bearer token. */
export function randomToken(count: number): string {
  let binary = '';
  for (const byte of randomBytes(count)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** SHA-256 of a string's UTF-8 bytes, lowercase hex: how every secret is stored. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return toHex(new Uint8Array(digest));
}

/** Whether `value` is an Ed25519 public key in ADR 0014's spelling: 64 lowercase hex. */
export function isPublicKey(value: unknown): value is string {
  return (
    typeof value === 'string' && /^[0-9a-f]+$/.test(value) && isHexOfLength(value, PUBLIC_KEY_BYTES)
  );
}

/** Whether `value` is an Ed25519 signature as lowercase hex. */
export function isSignature(value: unknown): value is string {
  return (
    typeof value === 'string' && /^[0-9a-f]+$/.test(value) && isHexOfLength(value, SIGNATURE_BYTES)
  );
}

/**
 * Whether `signature` is `publicKey`'s over `message`. `false`, never a throw,
 * for a key that is not a point on the curve: the key came from a stranger.
 */
export async function verifyEd25519(
  publicKey: string,
  message: Uint8Array,
  signature: string,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(fromHex(publicKey, 'the public key', PUBLIC_KEY_BYTES)),
      ED25519,
      false,
      ['verify'],
    );
    return await crypto.subtle.verify(
      ED25519,
      key,
      new Uint8Array(fromHex(signature, 'the signature', SIGNATURE_BYTES)),
      new Uint8Array(message),
    );
  } catch {
    return false;
  }
}

// --- HPKE's six primitives (#1188, ADR 0047 D-3) ----------------------------
//
// The instance's implementation of `@onyourleft/domain`'s HPKE port, all
// `crypto.subtle`, so it mounts under `workerd` unchanged (ADR 0037 D-2) — a
// deliberate departure from #1179's "`node:crypto` on the instance".
//
// ⚠️ The text between the two `hpke-primitives` markers is byte-for-byte
// the client's, `packages/store/src/hpke-web-crypto.ts` (#1198), whose header
// says why it is two copies and not one module. `hpke.test.ts` fails on any
// difference between them, holds both to RFC 9180 Appendix A.1 and runs them
// against each other. **Edit both, identically.**

// <hpke-primitives> ----------------------------------------------------------

/** The `CryptoKey` type, spelt so that a DOM-less program can name it too. */
type WebCryptoKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

const X25519 = { name: 'X25519' } as const;
const HMAC_SHA_256 = { name: 'HMAC', hash: 'SHA-256' } as const;
const AES_GCM = 'AES-GCM';
const AES_128_KEY_BYTES = 16;
const X25519_BYTES = 32;

/** A copy over a fresh `ArrayBuffer`, which every `subtle` call accepts. */
function bytes(view: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(view);
}

async function aesKey(key: Uint8Array, usage: 'encrypt' | 'decrypt'): Promise<WebCryptoKey> {
  if (key.length !== AES_128_KEY_BYTES) {
    throw new RangeError(`an AES-128-GCM key is ${String(AES_128_KEY_BYTES)} bytes`);
  }
  return crypto.subtle.importKey('raw', bytes(key), AES_GCM, false, [usage]);
}

/** The port's refusal of a small-order public key, which the HPKE module passes on. */
function lowOrderPoint(): HpkeError {
  return new HpkeError(
    'low-order-point',
    'the X25519 output is all zeros: the public key is a small-order point (RFC 9180 §7.1.4)',
  );
}

/** How X25519 `deriveBits` refuses an all-zero output (WebCrypto, Secure Curves). */
function isOperationError(error: unknown): boolean {
  return error instanceof Error && error.name === 'OperationError';
}

/** The six HPKE primitives over `crypto.subtle`. */
const hpkePrimitives: HpkePrimitives<WebCryptoKey> = {
  async generateX25519KeyPair() {
    const pair = await crypto.subtle.generateKey(X25519, false, ['deriveBits']);
    if (!('privateKey' in pair)) {
      throw new TypeError('X25519 key generation returned one key, not a key pair');
    }
    const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    return { publicKey, privateKey: pair.privateKey };
  },

  async x25519(privateKey, publicKey) {
    if (publicKey.length !== X25519_BYTES) {
      throw new RangeError(`an X25519 public key is ${String(X25519_BYTES)} bytes`);
    }
    const peer = await crypto.subtle.importKey('raw', bytes(publicKey), X25519, false, []);
    let derived: ArrayBuffer;
    try {
      derived = await crypto.subtle.deriveBits(
        { name: X25519.name, public: peer },
        privateKey,
        8 * X25519_BYTES,
      );
    } catch (error) {
      if (isOperationError(error)) throw lowOrderPoint();
      throw error;
    }
    const shared = new Uint8Array(derived);
    if (shared.every((byte) => byte === 0)) throw lowOrderPoint();
    return shared;
  },

  async hmacSha256(key, data) {
    const hmacKey = await crypto.subtle.importKey('raw', bytes(key), HMAC_SHA_256, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, bytes(data)));
  },

  async aes128GcmSeal(key, nonce, aad, plaintext) {
    const sealed = await crypto.subtle.encrypt(
      { name: AES_GCM, iv: bytes(nonce), additionalData: bytes(aad), tagLength: 128 },
      await aesKey(key, 'encrypt'),
      bytes(plaintext),
    );
    return new Uint8Array(sealed);
  },

  async aes128GcmOpen(key, nonce, aad, ciphertext) {
    const opened = await crypto.subtle.decrypt(
      { name: AES_GCM, iv: bytes(nonce), additionalData: bytes(aad), tagLength: 128 },
      await aesKey(key, 'decrypt'),
      bytes(ciphertext),
    );
    return new Uint8Array(opened);
  },

  randomBytes(count) {
    return crypto.getRandomValues(new Uint8Array(count));
  },
};

// </hpke-primitives> ---------------------------------------------------------

/** The instance's six HPKE primitives: the region above, under the instance's name. */
export const instanceHpkePrimitives: HpkePrimitives<WebCryptoKey> = hpkePrimitives;
