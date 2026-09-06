// SPDX-License-Identifier: Apache-2.0

/**
 * Lowercase hexadecimal, both directions, in ES2024 and nothing else.
 *
 * `Uint8Array.prototype.toHex` and `Uint8Array.fromHex` are Stage 3 at the time
 * of writing and are not in the ES2024 library this package is narrowed to, so
 * they cannot be named here. `Buffer` and `atob` are platform APIs and are
 * forbidden outright. Twenty lines is the price of the isolation, and the
 * isolation is what lets the same verification code run in a browser, in a
 * native shell and on an instance.
 *
 * **Lowercase only, in both directions.** A signed record is a canonical
 * document: `A1` and `a1` are the same bytes and different strings, so
 * accepting both would give one record two canonical serialisations and two
 * signatures. `fromHex` therefore rejects uppercase rather than folding it,
 * which is a decode error a caller can see rather than a signature that fails
 * later for no stated reason.
 */

import { IdentityError } from './errors';

const HEX_DIGITS = '0123456789abcdef';

/** Lowercase hex, two characters per byte. */
export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += HEX_DIGITS[byte >> 4];
    out += HEX_DIGITS[byte & 0x0f];
  }
  return out;
}

function digit(code: number): number {
  // '0'..'9'
  if (code >= 0x30 && code <= 0x39) {
    return code - 0x30;
  }
  // 'a'..'f'
  if (code >= 0x61 && code <= 0x66) {
    return code - 0x61 + 10;
  }
  return -1;
}

/**
 * Decodes lowercase hex to bytes.
 *
 * @param what - the field being decoded, for the message. **The value is never
 * in the message** — see `errors.ts`; this function is one of the two that
 * touch private key material in some deployments.
 * @param expectedBytes - if given, the exact length required.
 * @throws {IdentityError} on an odd length, a non-lowercase-hex character, or a
 * length other than `expectedBytes`.
 */
export function fromHex(hex: string, what: string, expectedBytes?: number): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new IdentityError(`${what} must have an even number of hexadecimal characters`);
  }
  const length = hex.length / 2;
  if (expectedBytes !== undefined && length !== expectedBytes) {
    throw new IdentityError(`${what} must be ${String(expectedBytes)} bytes`);
  }
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    const high = digit(hex.charCodeAt(index * 2));
    const low = digit(hex.charCodeAt(index * 2 + 1));
    if (high < 0 || low < 0) {
      throw new IdentityError(`${what} must be lowercase hexadecimal`);
    }
    bytes[index] = (high << 4) | low;
  }
  return bytes;
}

/** Is this string lowercase hex of exactly `expectedBytes` bytes? */
export function isHexOfLength(value: string, expectedBytes: number): boolean {
  if (value.length !== expectedBytes * 2) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    if (digit(value.charCodeAt(index)) < 0) {
      return false;
    }
  }
  return true;
}

/**
 * Constant-time-ish equality over two byte arrays.
 *
 * ⚠️ **Not** used for the content-hash comparison, despite what this comment
 * said until #167: `verifyActivityRecord` compares content hashes as strings
 * (`actual !== record.contentHash`), and the only non-test consumer is the stub
 * verifier in `identity/testing.ts`. Which of the two the comparison should go
 * through is a real question — a constant-time compare over bytes and a `!==`
 * over hex strings are not the same operation — and it is left open here rather
 * than answered by a comment. A digest comparison is not a secret
 * comparison — both sides are public — so this is not load-bearing against a
 * timing attack; it is here because a plain `every` short-circuits and the
 * habit of short-circuiting on a comparison of cryptographic material is the
 * one worth not forming. It also refuses to call two arrays of different
 * lengths equal, which `every` on the shorter one would.
 */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}
