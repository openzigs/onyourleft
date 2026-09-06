// SPDX-License-Identifier: Apache-2.0

/**
 * A deterministic stand-in for a signature scheme, for this package's own tests.
 *
 * ## ⚠️ This is not cryptography and must never leave a test
 *
 * The "signature" is a keyed hash whose key is the **public** key, so anybody
 * holding a record can forge another one. That is not a shortcut taken to save
 * effort: this package cannot name `crypto` (see `seam.ts`), so there is no
 * real primitive available to it, and inventing one here would be hand-rolled
 * cryptography in the file that must never be wrong.
 *
 * What it is for is exactly what this package owns: the **plumbing**. It is
 * sensitive to every byte of the message and of the key, which is all the
 * record-format tests need in order to show that a tampered claim, a swapped
 * key or a re-ordered member changes the signing input. Real Ed25519 signatures
 * are produced and verified in `packages/store`, where WebCrypto exists, and
 * `identity-verifier.test.ts` there is what proves the format end to end — it
 * verifies with `crypto.subtle` directly, from `docs/architecture.md`'s prose
 * and RFC 8785, and imports nothing from this package.
 *
 * It is not exported from `src/index.ts`. Nothing outside this package's tests
 * can reach it.
 */

import { bytesEqual } from './hex';
import {
  PUBLIC_KEY_BYTES,
  SIGNATURE_ALGORITHM,
  SIGNATURE_BYTES,
  type SignatureVerifier,
  type Sha256,
  type SigningKey,
} from './seam';
import { utf8Encode } from './utf8';

/** FNV-1a over 32 bits. Deterministic, tiny, and not a cryptographic hash. */
function fnv1a(seed: number, bytes: Uint8Array): number {
  let hash = seed >>> 0;
  for (const byte of bytes) {
    hash = (hash ^ byte) >>> 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** A 64-byte tag over a key and a message. Changes if either changes. */
function tag(publicKey: Uint8Array, message: Uint8Array): Uint8Array {
  const out = new Uint8Array(SIGNATURE_BYTES);
  for (let block = 0; block < SIGNATURE_BYTES / 4; block += 1) {
    const word = fnv1a(fnv1a(0x811c9dc5 + block, publicKey), message);
    out[block * 4] = (word >>> 24) & 0xff;
    out[block * 4 + 1] = (word >>> 16) & 0xff;
    out[block * 4 + 2] = (word >>> 8) & 0xff;
    out[block * 4 + 3] = word & 0xff;
  }
  return out;
}

/** A 32-byte "public key" derived from a label, so a test can name its athlete. */
export function stubPublicKey(label: string): Uint8Array {
  const out = new Uint8Array(PUBLIC_KEY_BYTES);
  const bytes = utf8Encode(label);
  for (let index = 0; index < PUBLIC_KEY_BYTES; index += 1) {
    out[index] = fnv1a(0x811c9dc5 + index, bytes) & 0xff;
  }
  return out;
}

/** @see the warning at the top of this file. */
export function stubSigningKey(label = 'athlete-a'): SigningKey {
  const publicKey = stubPublicKey(label);
  return {
    algorithm: SIGNATURE_ALGORITHM,
    publicKey,
    sign: (message) => Promise.resolve(tag(publicKey, message)),
  };
}

/** @see the warning at the top of this file. */
export const stubVerifier: SignatureVerifier = {
  algorithm: SIGNATURE_ALGORITHM,
  verify: ({ publicKey, message, signature }) =>
    Promise.resolve(bytesEqual(signature, tag(publicKey, message))),
};

/**
 * A "digest" that is 32 bytes and depends on every input byte.
 *
 * Enough to show that one changed byte of an activity file changes the content
 * hash, which is the property #61's fifth criterion is about. It is not SHA-256
 * and is not collision resistant.
 */
export const stubSha256: Sha256 = (bytes) => {
  const out = new Uint8Array(32);
  for (let block = 0; block < 8; block += 1) {
    const word = fnv1a(0x811c9dc5 + block * 0x9e3779b9, bytes);
    out[block * 4] = (word >>> 24) & 0xff;
    out[block * 4 + 1] = (word >>> 16) & 0xff;
    out[block * 4 + 2] = (word >>> 8) & 0xff;
    out[block * 4 + 3] = word & 0xff;
  }
  return Promise.resolve(out);
};
