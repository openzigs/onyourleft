// SPDX-License-Identifier: Apache-2.0

/**
 * The seam between HPKE, which lives here, and the primitives it is built
 * from, which cannot (#1188, ADR 0047 D-3).
 *
 * This is `identity/seam.ts`'s shape again: this package owns the algorithm —
 * RFC 9180's key schedule, `Seal`, `Open`, `Export`, the sequence counter and
 * the reply derivation of ADR 0047 D-2 — and cannot name `crypto`, so the
 * caller injects the primitive. The port has **exactly six members** and must
 * not grow a seventh: each member is a place two platforms can disagree, and
 * RFC 9180 Appendix A.1 is what proves they do not.
 *
 * HKDF is not a member. WebCrypto's HKDF fuses Extract and Expand, and RFC
 * 9180's `LabeledExtract` and `LabeledExpand` are called separately with a PRK
 * carried between them, so both are built here on {@link HpkePrimitives.hmacSha256}
 * (RFC 5869 §2.2, §2.3).
 *
 * The two implementations are `packages/store/src/hpke-web-crypto.ts` (the
 * client) and `apps/instance/src/auth/crypto.ts` (the instance). Both are
 * `crypto.subtle`; neither names `node:crypto` (ADR 0037 D-2, `workerd`).
 *
 * @typeParam PrivateKey - the implementation's private-key handle. This
 * package never looks inside it, so a WebCrypto implementation hands back a
 * non-extractable `CryptoKey` and the private half never exists as bytes.
 */

/** An X25519 key pair: the raw 32-byte public key, and an opaque private half. */
export interface X25519KeyPair<PrivateKey> {
  /** The raw 32-byte public key (RFC 7748 §5). Safe to publish. */
  readonly publicKey: Uint8Array;
  /** The implementation's handle. Never bytes this package can read. */
  readonly privateKey: PrivateKey;
}

/** The six primitives HPKE is assembled from. See the file header. */
export interface HpkePrimitives<PrivateKey> {
  /** 1. A fresh X25519 key pair, from the platform's own randomness. */
  generateX25519KeyPair(): Promise<X25519KeyPair<PrivateKey>>;

  /**
   * 2. X25519 (RFC 7748 §5): the 32-byte shared secret of `privateKey` and the
   * raw `publicKey`.
   *
   * **Contract: it must throw rather than return an all-zero output** (RFC
   * 9180 §7.1.4), which is what a low-order public key produces. WebCrypto's
   * Secure Curves `deriveBits` is specified to throw there; an implementation
   * checks the bytes as well, and the HPKE module checks them a third time, so
   * the rule does not rest on any one platform implementing one line.
   */
  x25519(privateKey: PrivateKey, publicKey: Uint8Array): Promise<Uint8Array>;

  /** 3. HMAC-SHA-256 (RFC 2104). `key` is never empty: the module never asks. */
  hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array>;

  /**
   * 4. AES-128-GCM encryption with a 16-byte tag: the ciphertext followed by
   * the tag. Must refuse a key that is not 16 bytes, rather than quietly
   * running AES-256.
   */
  aes128GcmSeal(
    key: Uint8Array,
    nonce: Uint8Array,
    aad: Uint8Array,
    plaintext: Uint8Array,
  ): Promise<Uint8Array>;

  /** 5. AES-128-GCM decryption. **Throws** when the tag does not verify. */
  aes128GcmOpen(
    key: Uint8Array,
    nonce: Uint8Array,
    aad: Uint8Array,
    ciphertext: Uint8Array,
  ): Promise<Uint8Array>;

  /** 6. `count` bytes from a cryptographically secure generator. */
  randomBytes(count: number): Uint8Array;
}
