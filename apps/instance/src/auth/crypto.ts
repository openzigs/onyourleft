// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The instance's cryptography, all of it WebCrypto (#772, ADR 0037).
 *
 * `globalThis.crypto` is the same API on Node 24 and on Cloudflare Workers,
 * so nothing here names `node:crypto` and the Durable Object adapter (#781)
 * mounts it unchanged. Node's WebCrypto marks Ed25519 stable since v23.5.0.
 *
 * ⚠️ **The instance holds no long-term private key yet.** It verifies
 * signatures a device made with a key that never left the device (ADR 0014
 * D-3), and the only secrets it keeps — nonces, session tokens, tickets, link,
 * recovery and email-recovery codes — are random bytes, of which it keeps
 * the SHA-256 wherever it keeps anything. {@link instanceHpkePrimitives}
 * (#1188) can generate an X25519 key pair, non-extractable; nothing stores
 * one until #1189 adds the instance's keys (ADR 0047 D-4, D-5), and that pull
 * request rewrites this paragraph.
 */

import {
  fromHex,
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
// deliberate departure from #1179's "`node:crypto` on the instance". The
// client's is `packages/store/src/hpke-web-crypto.ts`; `hpke.test.ts` holds
// both to RFC 9180 Appendix A.1 and runs them against each other.

/** The `CryptoKey` type, spelt so that this DOM-less program can name it. */
type InstanceCryptoKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

const X25519 = { name: 'X25519' } as const;
const HMAC_SHA_256 = { name: 'HMAC', hash: 'SHA-256' } as const;
const AES_GCM = 'AES-GCM';
const AES_128_KEY_BYTES = 16;
const X25519_BYTES = 32;

async function aes128Key(
  key: Uint8Array,
  usage: 'encrypt' | 'decrypt',
): Promise<InstanceCryptoKey> {
  if (key.length !== AES_128_KEY_BYTES) {
    throw new RangeError(`an AES-128-GCM key is ${String(AES_128_KEY_BYTES)} bytes`);
  }
  return crypto.subtle.importKey('raw', new Uint8Array(key), AES_GCM, false, [usage]);
}

/**
 * The instance's six HPKE primitives. A generated X25519 private key is
 * non-extractable, and `x25519` refuses an all-zero output itself (RFC 9180
 * §7.1.4) as well as WebCrypto being specified to.
 */
export const instanceHpkePrimitives: HpkePrimitives<InstanceCryptoKey> = {
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
    const peer = await crypto.subtle.importKey('raw', new Uint8Array(publicKey), X25519, false, []);
    const shared = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: X25519.name, public: peer },
        privateKey,
        8 * X25519_BYTES,
      ),
    );
    if (shared.every((byte) => byte === 0)) {
      throw new RangeError('the X25519 output is all zeros: a small-order public key');
    }
    return shared;
  },

  async hmacSha256(key, data) {
    const hmacKey = await crypto.subtle.importKey('raw', new Uint8Array(key), HMAC_SHA_256, false, [
      'sign',
    ]);
    return new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, new Uint8Array(data)));
  },

  async aes128GcmSeal(key, nonce, aad, plaintext) {
    const sealed = await crypto.subtle.encrypt(
      {
        name: AES_GCM,
        iv: new Uint8Array(nonce),
        additionalData: new Uint8Array(aad),
        tagLength: 128,
      },
      await aes128Key(key, 'encrypt'),
      new Uint8Array(plaintext),
    );
    return new Uint8Array(sealed);
  },

  async aes128GcmOpen(key, nonce, aad, ciphertext) {
    const opened = await crypto.subtle.decrypt(
      {
        name: AES_GCM,
        iv: new Uint8Array(nonce),
        additionalData: new Uint8Array(aad),
        tagLength: 128,
      },
      await aes128Key(key, 'decrypt'),
      new Uint8Array(ciphertext),
    );
    return new Uint8Array(opened);
  },

  randomBytes(count) {
    return randomBytes(count);
  },
};
