// SPDX-License-Identifier: Apache-2.0

/**
 * Why an HPKE operation refused (#1188).
 *
 * - `invalid-public-key` — a recipient key or an `enc` that is not 32 bytes,
 *   or that the platform's X25519 refused.
 * - `low-order-point` — the Diffie–Hellman output was all zeros (RFC 9180
 *   §7.1.4): the public key is a small-order point.
 * - `open-failed` — the ciphertext, the AAD or the sequence number is not the
 *   one it was sealed with. Deliberately one reason for all three: the AEAD
 *   cannot tell them apart and neither should a caller.
 * - `message-limit` — the context's sequence number is at its limit (RFC 9180
 *   §5.2). It never wraps.
 * - `invalid-length` — an export, a nonce or another length the suite fixes
 *   was asked for at a size it does not have.
 *
 * **No message carries a key, a secret or a plaintext byte**, for the reason
 * `identity/errors.ts` gives.
 */
export type HpkeRefusal =
  'invalid-public-key' | 'low-order-point' | 'open-failed' | 'message-limit' | 'invalid-length';

/** Raised by every HPKE operation that refuses. */
export class HpkeError extends Error {
  readonly reason: HpkeRefusal;

  constructor(reason: HpkeRefusal, message: string) {
    super(message);
    this.name = 'HpkeError';
    this.reason = reason;
  }
}
