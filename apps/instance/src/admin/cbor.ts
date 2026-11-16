// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A bounded CBOR reader** (RFC 8949) for the two things a WebAuthn
 * ceremony with `attestation: 'none'` asks the instance to read (#2642, ADR
 * 0069 D-6): the attestation object (`{ fmt, attStmt, authData }`) and the
 * one COSE public key inside its authenticator data. It reads nothing else,
 * so it reads a strict subset and refuses the rest:
 *
 * - **definite lengths only**: an indefinite-length string, array or map
 *   (additional information 31) is refused, as are the reserved 28–30;
 * - **no tags** (major type 6) and no floating point or `undefined`: of the
 *   simple values only `false`, `true` and `null`, which an authenticator's
 *   extension output may carry;
 * - **at most {@link CBOR_LIMITS}**: nesting deeper than 4, a string longer
 *   than 2048 bytes, a container with more than 32 entries, more than 256
 *   items in all, or an input over 4096 bytes;
 * - integers within JavaScript's safe range, map keys that are integers or
 *   text, no key twice, and text that is well-formed UTF-8.
 *
 * Every refusal is a {@link CborError} naming why; the reader throws nothing
 * else (`cbor.test.ts` fuzzes it). Its {@link CborCounters} say how many items
 * it read and how many bytes of strings it copied out, so the bound on what it
 * allocates is measured, not assumed. WebCrypto-only and builtin-free, like
 * the rest of the portable core (ADR 0037 D-2).
 */

/** What the reader refuses beyond. */
export const CBOR_LIMITS = {
  /** The whole input, in bytes. */
  maxInputBytes: 4096,
  /** How deep arrays and maps may nest: the top-level item is depth 1. */
  maxDepth: 4,
  /** One byte or text string, in bytes. */
  maxStringBytes: 2048,
  /** Entries in one array, or pairs in one map. */
  maxEntries: 32,
  /** Items read in all, every key and value counted. */
  maxItems: 256,
} as const;

export type CborKey = number | string;

export type CborValue =
  | number
  | string
  | boolean
  | null
  | Uint8Array
  | readonly CborValue[]
  | ReadonlyMap<CborKey, CborValue>;

/** Why the reader refused. */
export type CborRefusal =
  | 'truncated'
  | 'too_large'
  | 'too_deep'
  | 'too_many'
  | 'indefinite'
  | 'reserved'
  | 'tag'
  | 'simple'
  | 'integer_range'
  | 'key_type'
  | 'duplicate_key'
  | 'utf8'
  | 'trailing';

export class CborError extends Error {
  override readonly name = 'CborError';
  readonly reason: CborRefusal;
  constructor(reason: CborRefusal) {
    super(`CBOR refused: ${reason}`);
    this.reason = reason;
  }
}

/** What one read did: items read, and bytes of strings copied out of the input. */
export interface CborCounters {
  items: number;
  copiedBytes: number;
}

const UTF8 = new TextDecoder('utf-8', { fatal: true });

/**
 * One CBOR item from `bytes` at `offset`: its value, and where it ended. The
 * rest of `bytes` is not read — the COSE key sits inside the authenticator
 * data with the extensions after it.
 */
export function readCborItem(
  bytes: Uint8Array,
  offset = 0,
  counters: CborCounters = { items: 0, copiedBytes: 0 },
): { readonly value: CborValue; readonly end: number } {
  if (bytes.byteLength > CBOR_LIMITS.maxInputBytes) throw new CborError('too_large');
  let at = offset;

  const byte = (): number => {
    if (at >= bytes.byteLength) throw new CborError('truncated');
    const value = bytes[at] as number;
    at += 1;
    return value;
  };

  /** The argument of an item's head; `indefinite` is refused, as are 28–30. */
  const argument = (info: number): number => {
    if (info < 24) return info;
    if (info === 31) throw new CborError('indefinite');
    if (info > 27) throw new CborError('reserved');
    const length = 1 << (info - 24);
    if (at + length > bytes.byteLength) throw new CborError('truncated');
    let value = 0;
    for (let index = 0; index < length; index += 1) {
      // Multiplication, not a shift: a shift is 32-bit in JavaScript.
      value = value * 256 + (bytes[at + index] as number);
    }
    at += length;
    if (!Number.isSafeInteger(value)) throw new CborError('integer_range');
    return value;
  };

  const take = (length: number): Uint8Array => {
    if (length > CBOR_LIMITS.maxStringBytes) throw new CborError('too_large');
    if (at + length > bytes.byteLength) throw new CborError('truncated');
    const copied = bytes.slice(at, at + length);
    at += length;
    counters.copiedBytes += length;
    return copied;
  };

  const item = (depth: number): CborValue => {
    counters.items += 1;
    if (counters.items > CBOR_LIMITS.maxItems) throw new CborError('too_many');
    const head = byte();
    const major = head >> 5;
    const info = head & 0x1f;
    switch (major) {
      case 0:
        return argument(info);
      case 1: {
        const value = -1 - argument(info);
        if (!Number.isSafeInteger(value)) throw new CborError('integer_range');
        return value;
      }
      case 2:
        return take(argument(info));
      case 3: {
        const raw = take(argument(info));
        try {
          return UTF8.decode(raw);
        } catch {
          throw new CborError('utf8');
        }
      }
      case 4: {
        if (depth >= CBOR_LIMITS.maxDepth) throw new CborError('too_deep');
        const count = argument(info);
        if (count > CBOR_LIMITS.maxEntries) throw new CborError('too_many');
        const entries: CborValue[] = [];
        for (let index = 0; index < count; index += 1) entries.push(item(depth + 1));
        return entries;
      }
      case 5: {
        if (depth >= CBOR_LIMITS.maxDepth) throw new CborError('too_deep');
        const count = argument(info);
        if (count > CBOR_LIMITS.maxEntries) throw new CborError('too_many');
        const map = new Map<CborKey, CborValue>();
        for (let index = 0; index < count; index += 1) {
          const key = item(depth + 1);
          if (typeof key !== 'number' && typeof key !== 'string') {
            throw new CborError('key_type');
          }
          if (map.has(key)) throw new CborError('duplicate_key');
          map.set(key, item(depth + 1));
        }
        return map;
      }
      case 6:
        throw new CborError('tag');
      default: {
        // Major type 7: `false`, `true` and `null`, and nothing else.
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        throw new CborError('simple');
      }
    }
  };

  const value = item(0);
  return { value, end: at };
}

/** The ONE CBOR item `bytes` holds, and nothing after it. */
export function readCbor(
  bytes: Uint8Array,
  counters: CborCounters = { items: 0, copiedBytes: 0 },
): CborValue {
  const { value, end } = readCborItem(bytes, 0, counters);
  if (end !== bytes.byteLength) throw new CborError('trailing');
  return value;
}
