// SPDX-License-Identifier: Apache-2.0

/**
 * The client's implementation of `@onyourleft/domain`'s HPKE primitives port,
 * over `crypto.subtle` (#1188, ADR 0047 D-3). `web-crypto.ts` re-exports it
 * beside the Ed25519 primitive.
 *
 * ## Why a file of its own
 *
 * #1188's interop criterion runs this implementation and the instance's in
 * one Node test, so `apps/instance`'s program compiles this file — and that
 * program has no DOM lib. `web-crypto.ts` names DOM-only types (`BufferSource`,
 * a `CryptoKey` used as a type), so the port lives here, written against what
 * both lib sets declare: `crypto.subtle`'s own signatures, and byte arrays
 * copied into fresh `ArrayBuffer`s.
 *
 * ## One implementation in two files (#1198)
 *
 * `apps/instance/src/auth/crypto.ts` carries the same port, and the text
 * between the two `hpke-primitives` markers below is **byte-for-byte the
 * same** in both files: `apps/instance/src/auth/hpke.test.ts` reads both and
 * fails on any difference, so a fix made to one copy cannot miss the other.
 * It is two copies rather than one module because the instance does not
 * depend on `@onyourleft/store` — its image carries five packages and this is
 * not one of them (`apps/instance/Dockerfile`) — and `@onyourleft/domain`
 * cannot name `crypto` at all. **Edit both, identically.**
 *
 * ## What it guarantees beyond WebCrypto
 *
 * - The X25519 private key is generated **non-extractable**; the private half
 *   never exists as bytes in this program.
 * - `x25519` refuses a small-order public key as `low-order-point` (#1198):
 *   WebCrypto's Secure Curves `deriveBits` throws an `OperationError` there,
 *   and the port turns that, and an all-zero output it checks for itself
 *   (RFC 9180 §7.1.4), into the `HpkeError` the HPKE module passes on.
 * - The AES-GCM members refuse a key that is not 16 bytes, rather than run
 *   AES-256 because a 32-byte key was handed in.
 */

import { HpkeError, type HpkePrimitives } from '@onyourleft/domain';

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

/** The client's six HPKE primitives. */
export const webCryptoHpkePrimitives: HpkePrimitives<WebCryptoKey> = hpkePrimitives;
