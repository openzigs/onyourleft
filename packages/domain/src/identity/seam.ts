// SPDX-License-Identifier: Apache-2.0

/**
 * The seam between the signing *algorithm*, which lives here, and the signing
 * *primitive*, which cannot.
 *
 * ## Why there is a seam at all
 *
 * CLAUDE.md section 2 puts signing and verification in this package "because
 * those must run identically on the device and on an instance". Section 2 also
 * forbids this package **any platform API at all**. Both hold, and together
 * they decide the shape:
 *
 * ```
 * $ cat packages/domain/src/probe-crypto.ts
 * export const k = (): unknown => crypto.subtle;
 * $ pnpm --filter @onyourleft/domain run typecheck
 * src/probe-crypto.ts(2,33): error TS2304: Cannot find name 'crypto'.
 * ```
 *
 * There is no WebCrypto here, and there is no acceptable way to get one: an
 * Ed25519 implementation written in this package would be hand-rolled crypto in
 * the one file that must never be wrong, and a third-party one would be a
 * dependency whose licence has to clear CLAUDE.md section 3 for a package that
 * is Apache-2.0 without exception.
 *
 * So this package owns:
 *
 * - **what is signed** — `canonical.ts`, RFC 8785 over a fixed member set;
 * - **the record format** — `record.ts`;
 * - **the verification logic** — the order of the checks, and what each failure
 *   means;
 * - **the identity lifecycle** — {@link ensureSigningKey}, which is the whole
 *   of "generated on first run, reused on the second".
 *
 * and the caller injects:
 *
 * - **the key material** — a {@link SigningKey} that can sign and knows its own
 *   public half, and never exposes the private half in any form;
 * - **the primitive** — {@link SignatureVerifier} and {@link Sha256}.
 *
 * This is the same shape #45 met, where the recording engine may not read a
 * clock and time therefore arrives as a parameter.
 *
 * ## What the two implementations must agree on
 *
 * `apps/web` satisfies this from `crypto.subtle` in a browser and #7's instance
 * will satisfy it from Node. **They must agree byte for byte**, which is why
 * the message handed to `sign` is bytes and not an object: the canonicalisation
 * happens on this side of the seam, once, and neither implementation gets a
 * chance to serialise anything.
 *
 * `packages/store` carries the reference implementation over WebCrypto, and its
 * tests are where real Ed25519 signatures are produced and verified. The tests
 * in *this* package use a deterministic non-cryptographic stand-in, because the
 * thing under test here is the plumbing — the canonical bytes, the check order
 * and the outcome type — and a package that cannot name `crypto` cannot test
 * anything else.
 */

import { IdentityError } from './errors';

/**
 * The signature scheme, decided in ADR 0014: **Ed25519** (RFC 8032).
 *
 * A single-member union rather than a `string`, so a record naming any other
 * scheme is a compile error on the way in and an `unsupported-algorithm`
 * outcome on the way out. Adding a second scheme is a deliberate edit here and
 * a record-format version bump, which is the point: a signature format is
 * effectively permanent once records exist.
 */
export const SIGNATURE_ALGORITHM = 'Ed25519';

/** @see SIGNATURE_ALGORITHM */
export type SignatureAlgorithm = typeof SIGNATURE_ALGORITHM;

/** An Ed25519 public key is 32 bytes (RFC 8032 §5.1). */
export const PUBLIC_KEY_BYTES = 32;

/** An Ed25519 signature is 64 bytes (RFC 8032 §5.1). */
export const SIGNATURE_BYTES = 64;

/** A SHA-256 digest is 32 bytes (FIPS 180-4). */
export const DIGEST_BYTES = 32;

/**
 * A key that can sign, and knows its own public half.
 *
 * **There is deliberately no member that returns the private half**, in any
 * encoding. That is not politeness: it is the type-level half of #61's second
 * acceptance criterion. The WebCrypto implementation in `packages/store` backs
 * this with a `CryptoKey` created with `extractable: false`, so the private
 * half cannot be obtained even by a caller willing to ignore this interface —
 * `crypto.subtle.exportKey` on it rejects.
 */
export interface SigningKey {
  readonly algorithm: SignatureAlgorithm;
  /** The raw 32-byte public key. Safe to publish; it *is* the identity. */
  readonly publicKey: Uint8Array;
  /** Signs exactly these bytes. No serialisation happens on the far side. */
  sign(message: Uint8Array): Promise<Uint8Array>;
}

/**
 * The verification primitive.
 *
 * Separate from {@link SigningKey} because verifying is what a **stranger**
 * does: a verifier holds no key, takes the public key from the record it is
 * checking, and is the half an instance in Phase 3 needs without ever holding
 * an athlete's key.
 */
export interface SignatureVerifier {
  readonly algorithm: SignatureAlgorithm;
  /**
   * @returns `true` if `signature` is a valid signature over `message` by
   * `publicKey`. **Must return `false` rather than throwing** for a malformed
   * key or signature: a hostile record is untrusted input (CLAUDE.md section
   * 6), and "this did not verify" is the answer for all of it.
   */
  verify(input: {
    readonly publicKey: Uint8Array;
    readonly message: Uint8Array;
    readonly signature: Uint8Array;
  }): Promise<boolean>;
}

/** SHA-256 over bytes. The content hash of an activity file goes through this. */
export type Sha256 = (bytes: Uint8Array) => Promise<Uint8Array>;

/**
 * Where a device's keypair lives, from this package's point of view.
 *
 * `load` answers "is there already an identity on this device", and `create`
 * makes one. Splitting them rather than offering a single `getOrCreate` is what
 * makes {@link ensureSigningKey} — and therefore the first-run behaviour — a
 * thing this package tests, instead of a thing each platform adapter
 * reimplements and one of them gets wrong.
 */
export interface Keystore {
  /** The identity already on this device, or `undefined` on a first run. */
  load(): Promise<SigningKey | undefined>;
  /**
   * Creates and persists a new identity.
   *
   * **Must be safe against a concurrent creator.** Two browser tabs opening for
   * the first time at the same moment both see `load()` return `undefined`; if
   * both then persist, the athlete's history splits across two identities,
   * which is exactly the failure #61's first acceptance criterion names. An
   * implementation that cannot make the write conditional must re-read after a
   * refused write and return the identity that won.
   */
  create(): Promise<SigningKey>;
}

/**
 * The identity lifecycle: **reuse the key on this device, or make one**.
 *
 * This is the whole of "a keypair is generated on first run and persisted
 * locally; a second launch reuses it rather than generating a new identity".
 * It is four lines and it is in this package on purpose — the failure it
 * prevents is an athlete's whole history silently splitting in two, and a
 * four-line rule copied into a browser adapter and a Node adapter is a rule
 * that holds in one of them.
 *
 * @throws {IdentityError} if the keystore produces a key for another scheme, or
 * one whose public half is not a 32-byte Ed25519 key. A keystore that returns a
 * key this build cannot use must fail loudly here rather than produce records
 * nothing can verify.
 */
export async function ensureSigningKey(keystore: Keystore): Promise<SigningKey> {
  const existing = await keystore.load();
  if (existing !== undefined) {
    return assertUsableKey(existing);
  }
  return assertUsableKey(await keystore.create());
}

/** @throws {IdentityError} */
function assertUsableKey(key: SigningKey): SigningKey {
  // The comparison is made on a widened alias rather than on `key.algorithm`.
  // `SignatureAlgorithm` is a single-member union, so a check against the
  // property itself narrows it to `never` inside the branch — which is correct,
  // and means a *typed* caller cannot reach here. An untyped one can, which is
  // the case this guard is for, and a `never` cannot be put in a message.
  const offered: string = key.algorithm;
  if (offered !== SIGNATURE_ALGORITHM) {
    throw new IdentityError(
      `the keystore returned a ${offered} key; this build signs with ${SIGNATURE_ALGORITHM}`,
    );
  }
  if (key.publicKey.length !== PUBLIC_KEY_BYTES) {
    throw new IdentityError(
      `an ${SIGNATURE_ALGORITHM} public key is ${String(PUBLIC_KEY_BYTES)} bytes, and the keystore returned ${String(key.publicKey.length)}`,
    );
  }
  return key;
}
