// SPDX-License-Identifier: Apache-2.0

/**
 * The far side of `@onyourleft/domain`'s signing seam, over WebCrypto.
 *
 * `packages/domain` owns the record format, the canonical bytes and the
 * verification logic, and cannot name `crypto` — its `tsconfig.json` narrows
 * `lib` to `ES2024` with `types: []`, so `crypto`, `SubtleCrypto` and
 * `CryptoKey` are not declared there at all. This package **can**: it already
 * carries the DOM lib for `indexedDB` and `CompressionStream`. So the primitive
 * lives here, and this file is the only place in Phase 1 that generates a key.
 *
 * ## Why Ed25519, and why WebCrypto rather than a library
 *
 * ADR 0014 records the decision in full. The short version, because it changes
 * how this file reads: `crypto.subtle` implements **Ed25519** natively in all
 * three browser engines — Safari 17, Firefox 129 and Chrome 137 — and in Node,
 * so there is **no third-party cryptography dependency anywhere in this
 * program**. That is a licensing fact as much as a security one: CLAUDE.md
 * section 3 makes every dependency under `packages/` an Apache-2.0 compatibility
 * question, and the dependency that is never added never has to clear it.
 *
 * ## The private key is a handle, never bytes
 *
 * `generateKey` is called with `extractable: false`. The `CryptoKey` it returns
 * can sign and **cannot be exported** — `crypto.subtle.exportKey` on it rejects
 * with `InvalidAccessError`. Nothing in this file, this package or any consumer
 * can turn it back into key material, which is what makes #61's "the private
 * key never leaves the device" a property of the platform rather than a promise
 * about our own code. A `CryptoKey` survives the structured clone algorithm, so
 * it goes into IndexedDB as a handle and comes back as one.
 *
 * The **public** half is extractable regardless of that flag — the Web
 * Cryptography specification says so, and it has to be: the public key is the
 * identity and it is in every record.
 */

import {
  ensureSigningKey,
  fromHex,
  PUBLIC_KEY_BYTES,
  SIGNATURE_ALGORITHM,
  toHex,
  unixSeconds,
  type Keystore,
  type Sha256,
  type SignatureVerifier,
  type SigningKey,
  type UnixSeconds,
} from '@onyourleft/domain';

import { StoreValidationError } from './errors';
import type { AthleteId } from './ids';
import type { DeviceKeyRecord } from './identity';

/** The algorithm identifier both `subtle.sign` and `subtle.generateKey` take. */
const ED25519 = { name: SIGNATURE_ALGORITHM } as const;

/** SHA-256 over bytes, for an activity file's content hash. */
export const webCryptoSha256: Sha256 = async (bytes) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));

/**
 * Verification, for records that may have come from anywhere.
 *
 * Returns `false` rather than throwing on a malformed key or signature, which
 * is what `SignatureVerifier` requires: a hostile record is untrusted input
 * (CLAUDE.md section 6), and "this did not verify" is the honest answer for a
 * key that is not a point on the curve as much as for a wrong signature. A
 * thrown `DataError` here would become an unhandled rejection in a list view
 * rendering somebody else's rides.
 */
export const webCryptoVerifier: SignatureVerifier = {
  algorithm: SIGNATURE_ALGORITHM,
  verify: async ({ publicKey, message, signature }) => {
    try {
      const key = await crypto.subtle.importKey('raw', publicKey as BufferSource, ED25519, false, [
        'verify',
      ]);
      return await crypto.subtle.verify(
        ED25519,
        key,
        signature as BufferSource,
        message as BufferSource,
      );
    } catch {
      return false;
    }
  },
};

/**
 * The two store methods a keystore needs.
 *
 * Named as an interface rather than taking `ActivityStore` so that the harness's
 * `PersistentStore` satisfies it too — which is what lets the keystore be
 * exercised through the round-trip harness, on a connection that did not write.
 */
export interface DeviceKeyStorage {
  getDeviceKey(owner: AthleteId): Promise<DeviceKeyRecord | undefined>;
  putDeviceKey(record: DeviceKeyRecord): Promise<AthleteId>;
}

/** @see createWebCryptoKeystore */
export interface WebCryptoKeystoreOptions {
  /**
   * When a newly created key was made. Defaults to the system clock.
   *
   * Injectable because every other time in this program is (#45), and because
   * a test that pins it can assert the stored `createdAt` rather than assert
   * that it is a number.
   */
  readonly now?: () => UnixSeconds;
}

/**
 * The device's keystore: an Ed25519 keypair in IndexedDB, one per athlete.
 *
 * Pair it with `ensureSigningKey` from `@onyourleft/domain`, which is where the
 * "generate on first run, reuse on the second" rule lives:
 *
 * ```ts
 * const key = await ensureSigningKey(createWebCryptoKeystore(store, ATHLETE_A));
 * ```
 *
 * ### The two-tab race, and why `create` re-reads
 *
 * Two tabs opening the app for the first time at the same moment both see
 * `load()` return `undefined` and both call `create()`. `putDeviceKey` is
 * write-once — it refuses to replace an existing key with a different one — so
 * the second write is **refused**, and `create` then returns the identity that
 * won rather than propagating the refusal. Returning the winner is the outcome
 * that preserves the athlete's history; propagating would leave one tab unable
 * to sign, and *succeeding* would split the history in two, which is the
 * failure #61's first acceptance criterion is about.
 */
export function createWebCryptoKeystore(
  storage: DeviceKeyStorage,
  owner: AthleteId,
  options: WebCryptoKeystoreOptions = {},
): Keystore {
  const now = options.now ?? (() => unixSeconds(Math.floor(Date.now() / 1000)));

  return {
    load: async () => {
      const stored = await storage.getDeviceKey(owner);
      return stored === undefined ? undefined : signingKeyFor(stored);
    },
    create: async () => {
      const record = await generateDeviceKey(owner, now());
      try {
        await storage.putDeviceKey(record);
      } catch (error) {
        if (!(error instanceof StoreValidationError)) {
          throw error;
        }
        const winner = await storage.getDeviceKey(owner);
        if (winner === undefined) {
          throw error;
        }
        return signingKeyFor(winner);
      }
      return signingKeyFor(record);
    },
  };
}

/** A brand-new, non-extractable Ed25519 identity. */
export async function generateDeviceKey(
  owner: AthleteId,
  createdAt: UnixSeconds,
): Promise<DeviceKeyRecord> {
  const pair = await crypto.subtle.generateKey(ED25519, false, ['sign', 'verify']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return {
    athleteId: owner,
    algorithm: SIGNATURE_ALGORITHM,
    publicKey: toHex(raw),
    privateKey: pair.privateKey,
    createdAt,
  };
}

/**
 * The `SigningKey` a stored row backs.
 *
 * Note what this returns and what it does not: a `sign` function and the public
 * half. The `CryptoKey` is captured in the closure and is not a member, so a
 * consumer holding this value has no route to the handle either.
 */
export function signingKeyFor(record: DeviceKeyRecord): SigningKey {
  const publicKey = fromHex(record.publicKey, 'the stored public key', PUBLIC_KEY_BYTES);
  return {
    algorithm: record.algorithm,
    publicKey,
    sign: async (message) =>
      new Uint8Array(await crypto.subtle.sign(ED25519, record.privateKey, message as BufferSource)),
  };
}

/** `ensureSigningKey` over this device's keystore, for the common call. */
export async function ensureDeviceSigningKey(
  storage: DeviceKeyStorage,
  owner: AthleteId,
  options: WebCryptoKeystoreOptions = {},
): Promise<SigningKey> {
  return ensureSigningKey(createWebCryptoKeystore(storage, owner, options));
}
