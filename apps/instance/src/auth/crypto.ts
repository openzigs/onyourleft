// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The instance's cryptography, all of it WebCrypto (#772, ADR 0037).
 *
 * `globalThis.crypto` is the same API on Node 24 and on Cloudflare Workers,
 * so nothing here names `node:crypto` and the Durable Object adapter (#781)
 * mounts it unchanged. Node's WebCrypto marks Ed25519 stable since v23.5.0.
 *
 * ⚠️ **The instance never holds a private key.** It verifies signatures a
 * device made with a key that never left the device (ADR 0014 D-3), and the
 * only secrets it makes itself — nonces, session tokens, tickets, link,
 * recovery and email-recovery codes — are random bytes, of which it keeps
 * the SHA-256 wherever it keeps anything.
 */

import {
  fromHex,
  isHexOfLength,
  PUBLIC_KEY_BYTES,
  SIGNATURE_BYTES,
  toHex,
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
