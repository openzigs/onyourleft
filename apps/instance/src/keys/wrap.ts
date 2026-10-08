// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * How the instance's own private keys are made, wrapped and unwrapped (#1189,
 * ADR 0047 D-5). All WebCrypto (`crypto.subtle`), so nothing here names
 * `node:crypto` and the Durable Object adapter could mount it unchanged.
 *
 * ## The wrapping key
 *
 * Derived with **HKDF-SHA-256** from the operator's secret,
 * `OYL_INSTANCE_SECRET_KEY` (#1097's, never a second one), with an `info`
 * label of its own per role ({@link WRAP_INFO}) and an empty salt, into a
 * non-extractable AES-256-GCM key. The hosted model key (#1097) uses the
 * secret's bytes as its AES key directly; a derived key under a label is a
 * different key, so the two uses cannot open each other's ciphertext.
 *
 * ## A wrap
 *
 * A private half is generated EXTRACTABLE, exported once as PKCS #8, sealed
 * with AES-256-GCM under a **fresh 12-byte nonce** and the additional data
 * `packages/domain` §`instanceKeyWrapAad` builds — `{purpose, role, keyId,
 * instanceOrigin}` — and imported again NON-extractable for use; the PKCS #8
 * buffer is zeroed. So a row moved to another role, copied onto another key's
 * row, or copied to another instance sharing the secret fails to unwrap
 * ({@link unwrapPrivateKey} answers `undefined`) rather than importing as the
 * wrong key. A private key is never anything but a non-extractable
 * `CryptoKey` in memory and ciphertext on disk.
 */

import { instanceKeyId, instanceKeyWrapAad, type InstanceKeyRole } from '@onyourleft/domain';

/** WebCrypto's key type, named without a DOM library or Node's own types. */
export type InstanceCryptoKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

/** GCM's nonce: 96 bits. */
export const WRAP_IV_BYTES = 12;

/** The HKDF `info` each role's wrapping key is derived under. */
export const WRAP_INFO: Readonly<Record<InstanceKeyRole, string>> = {
  identity: 'oyl-instance-key-wrap-v1 identity',
  encryption: 'oyl-instance-key-wrap-v1 encryption',
};

const ALGORITHM = {
  identity: { name: 'Ed25519' },
  encryption: { name: 'X25519' },
} as const;

/** What a role's private half is for, once imported. */
const PRIVATE_USAGES = {
  identity: ['sign'],
  encryption: ['deriveBits'],
} as const satisfies Readonly<Record<InstanceKeyRole, readonly string[]>>;

/** The two roles' wrapping keys, derived from the operator secret. */
export type WrappingKeys = Readonly<Record<InstanceKeyRole, InstanceCryptoKey>>;

/** SHA-256, through WebCrypto. */
export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
}

/** Both wrapping keys, non-extractable, derived from the operator secret's 32 bytes. */
export async function wrappingKeys(secret: Uint8Array): Promise<WrappingKeys> {
  const base = await crypto.subtle.importKey('raw', new Uint8Array(secret), 'HKDF', false, [
    'deriveKey',
  ]);
  const derive = (role: InstanceKeyRole) =>
    crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(0),
        info: new TextEncoder().encode(WRAP_INFO[role]),
      },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  return { identity: await derive('identity'), encryption: await derive('encryption') };
}

/** A key just made: its public half, its wrapped private half, and the private key in memory. */
export interface MadeKey {
  readonly role: InstanceKeyRole;
  readonly keyId: string;
  /** The raw 32-byte public key. */
  readonly publicKey: Uint8Array;
  readonly iv: Uint8Array;
  readonly wrapped: Uint8Array;
  /** Non-extractable. */
  readonly privateKey: InstanceCryptoKey;
}

function pairOf(generated: unknown): {
  publicKey: InstanceCryptoKey;
  privateKey: InstanceCryptoKey;
} {
  if (typeof generated !== 'object' || generated === null || !('privateKey' in generated)) {
    throw new TypeError('key generation returned one key, not a key pair');
  }
  return generated as { publicKey: InstanceCryptoKey; privateKey: InstanceCryptoKey };
}

/**
 * Seal a PKCS #8 private half under a FRESH nonce, bound to its role, key id
 * and origin.
 */
export async function wrapPrivateKey(
  wrapping: WrappingKeys,
  binding: {
    readonly role: InstanceKeyRole;
    readonly keyId: string;
    readonly instanceOrigin: string;
  },
  pkcs8: Uint8Array,
): Promise<{ readonly iv: Uint8Array; readonly wrapped: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(WRAP_IV_BYTES));
  const wrapped = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new Uint8Array(instanceKeyWrapAad(binding)) },
    wrapping[binding.role],
    new Uint8Array(pkcs8),
  );
  return { iv, wrapped: new Uint8Array(wrapped) };
}

/** Make a new key for `role`, wrapped for `instanceOrigin`. */
export async function makeKey(
  wrapping: WrappingKeys,
  role: InstanceKeyRole,
  instanceOrigin: string,
): Promise<MadeKey> {
  const algorithm = ALGORITHM[role];
  const usages: readonly KeyUsageName[] = role === 'identity' ? ['sign', 'verify'] : ['deriveBits'];
  const pair = pairOf(await crypto.subtle.generateKey(algorithm, true, [...usages]));
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const keyId = await instanceKeyId(sha256, publicKey);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  try {
    const { iv, wrapped } = await wrapPrivateKey(wrapping, { role, keyId, instanceOrigin }, pkcs8);
    const privateKey = await crypto.subtle.importKey('pkcs8', pkcs8, algorithm, false, [
      ...PRIVATE_USAGES[role],
    ]);
    return { role, keyId, publicKey, iv, wrapped, privateKey };
  } finally {
    pkcs8.fill(0);
  }
}

type KeyUsageName = 'sign' | 'verify' | 'deriveBits';

/**
 * A wrapped private half, unwrapped into a NON-extractable key — or
 * `undefined` when this wrapping key, role, key id and origin do not open it.
 * Never throws for a row it cannot open.
 */
export async function unwrapPrivateKey(
  wrapping: WrappingKeys,
  binding: {
    readonly role: InstanceKeyRole;
    readonly keyId: string;
    readonly instanceOrigin: string;
  },
  sealed: { readonly iv: Uint8Array; readonly wrapped: Uint8Array },
): Promise<InstanceCryptoKey | undefined> {
  let pkcs8: Uint8Array | undefined;
  try {
    pkcs8 = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: new Uint8Array(sealed.iv),
          additionalData: new Uint8Array(instanceKeyWrapAad(binding)),
        },
        wrapping[binding.role],
        new Uint8Array(sealed.wrapped),
      ),
    );
    return await crypto.subtle.importKey('pkcs8', pkcs8, ALGORITHM[binding.role], false, [
      ...PRIVATE_USAGES[binding.role],
    ]);
  } catch {
    return undefined;
  } finally {
    pkcs8?.fill(0);
  }
}

/** An Ed25519 signature by the identity key over `message`. */
export async function signWith(
  identity: InstanceCryptoKey,
  message: Uint8Array,
): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.sign({ name: 'Ed25519' }, identity, new Uint8Array(message)),
  );
}
