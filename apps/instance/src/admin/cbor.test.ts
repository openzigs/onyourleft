// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The admin passkeys' bounded CBOR reader (#2642, ADR 0069 D-6): what it
 * reads, each thing it refuses by name, and a property test that feeds it
 * random, truncated and nested input and holds it to two promises — it throws
 * nothing but its own refusal, and it never copies out more than it was
 * given or reads more items than its bound, measured from its own counters.
 */

import { describe, expect, it } from 'vitest';

import {
  CBOR_LIMITS,
  CborError,
  readCbor,
  readCborItem,
  type CborCounters,
  type CborRefusal,
} from './cbor.ts';
import { encodeCbor, type CborInput } from './webauthn-testing.ts';

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);

function refusal(input: Uint8Array): CborRefusal | 'read' {
  try {
    readCbor(input);
    return 'read';
  } catch (error) {
    if (error instanceof CborError) return error.reason;
    throw error;
  }
}

describe('what the reader reads (#2642)', () => {
  it('reads an attestation object’s shape: text keys, an empty map, a byte string', () => {
    const value = readCbor(
      encodeCbor(
        new Map<string, CborInput>([
          ['fmt', 'none'],
          ['attStmt', new Map()],
          ['authData', bytes(1, 2, 3)],
        ]),
      ),
    );
    expect(value).toEqual(
      new Map<string, unknown>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', bytes(1, 2, 3)],
      ]),
    );
  });

  it('reads a COSE key’s negative labels and integers of every width, and false, true and null', () => {
    expect(readCbor(bytes(0x20))).toBe(-1);
    expect(readCbor(bytes(0x26))).toBe(-7);
    expect(readCbor(bytes(0x18, 200))).toBe(200);
    expect(readCbor(bytes(0x19, 0x01, 0x00))).toBe(256);
    expect(readCbor(bytes(0x1a, 0x00, 0x01, 0x00, 0x00))).toBe(65_536);
    expect(readCbor(bytes(0x1b, 0, 0, 0, 1, 0, 0, 0, 0))).toBe(2 ** 32);
    expect(readCbor(bytes(0x83, 0xf4, 0xf5, 0xf6))).toEqual([false, true, null]);
  });

  it('reads one item and says where it ended, leaving what follows', () => {
    const read = readCborItem(bytes(0x01, 0x02, 0x03), 1);
    expect(read).toEqual({ value: 2, end: 2 });
  });

  it('reads four levels of nesting, and not five', () => {
    expect(readCbor(bytes(0x81, 0x81, 0x81, 0x81, 0x01))).toEqual([[[[1]]]]);
    expect(refusal(bytes(0x81, 0x81, 0x81, 0x81, 0x81, 0x01))).toBe('too_deep');
  });
});

describe('what the reader refuses, each by name (#2642)', () => {
  it.each<[string, Uint8Array, CborRefusal]>([
    ['an indefinite-length byte string', bytes(0x5f, 0x41, 0x00, 0xff), 'indefinite'],
    ['an indefinite-length array', bytes(0x9f, 0x01, 0xff), 'indefinite'],
    ['an indefinite-length map', bytes(0xbf, 0x01, 0x01, 0xff), 'indefinite'],
    ['a reserved additional information', bytes(0x1c), 'reserved'],
    ['a tag', bytes(0xc0, 0x01), 'tag'],
    ['a float', bytes(0xfb, 0, 0, 0, 0, 0, 0, 0, 0), 'simple'],
    ['undefined', bytes(0xf7), 'simple'],
    ['an integer past the safe range', bytes(0x1b, 0x40, 0, 0, 0, 0, 0, 0, 0), 'integer_range'],
    ['a string past its length cap', bytes(0x59, 0x08, 0x01), 'too_large'],
    ['an array with 33 entries', bytes(0x98, 33), 'too_many'],
    ['a map with 33 pairs', bytes(0xb8, 33), 'too_many'],
    ['a byte string cut short', bytes(0x43, 0x01, 0x02), 'truncated'],
    ['a head cut short', bytes(0x19, 0x01), 'truncated'],
    ['nothing at all', bytes(), 'truncated'],
    ['a key twice', bytes(0xa2, 0x01, 0x01, 0x01, 0x02), 'duplicate_key'],
    ['a byte-string key', bytes(0xa1, 0x41, 0x00, 0x01), 'key_type'],
    ['text that is not UTF-8', bytes(0x62, 0xc3, 0x28), 'utf8'],
    ['a byte after the item', bytes(0x01, 0x02), 'trailing'],
  ])('%s', (_name, input, reason) => {
    expect(refusal(input)).toBe(reason);
  });

  it('refuses an input over the stated bound before reading it', () => {
    const input = new Uint8Array(CBOR_LIMITS.maxInputBytes + 1);
    expect(refusal(input)).toBe('too_large');
    // At the bound, a string as long as allowed is read.
    const atCap = new Uint8Array(3 + CBOR_LIMITS.maxStringBytes);
    atCap.set([0x59, CBOR_LIMITS.maxStringBytes >> 8, CBOR_LIMITS.maxStringBytes & 0xff]);
    expect((readCbor(atCap) as Uint8Array).byteLength).toBe(CBOR_LIMITS.maxStringBytes);
  });

  it('refuses more than 256 items in all, however they are spread', () => {
    // 9 arrays of 31 ones, in an array: 1 + 9 + 279 = 289 items; 8 of 30: 249.
    const ones = (length: number): number[] => Array.from({ length }, () => 1);
    expect(refusal(encodeCbor(Array.from({ length: 9 }, () => ones(31))))).toBe('too_many');
    expect(refusal(encodeCbor(Array.from({ length: 8 }, () => ones(30))))).toBe('read');
  });
});

/** mulberry32: a seeded generator, so a failure names a case that can be run again. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function randomValue(next: () => number, depth: number): CborInput {
  const pick = Math.floor(next() * (depth > 5 ? 5 : 8));
  switch (pick) {
    case 0:
      return Math.floor(next() * 2 ** 32);
    case 1:
      return -Math.floor(next() * 2 ** 20) - 1;
    case 2:
      return crypto.getRandomValues(new Uint8Array(Math.floor(next() * 40)));
    case 3:
      return 'x'.repeat(Math.floor(next() * 20));
    case 4:
      return next() < 0.5;
    case 5:
    case 6:
      return Array.from({ length: Math.floor(next() * 5) }, () => randomValue(next, depth + 1));
    default:
      return new Map(
        Array.from({ length: Math.floor(next() * 5) }, (_, index) => [
          index,
          randomValue(next, depth + 1),
        ]),
      );
  }
}

/** Read `input`, holding the reader to its two promises; answer whether it read. */
function holdsItsPromises(input: Uint8Array, label: string): boolean {
  const counters: CborCounters = { items: 0, copiedBytes: 0 };
  try {
    readCbor(input, counters);
    return true;
  } catch (error) {
    expect(error, label).toBeInstanceOf(CborError);
    return false;
  } finally {
    expect(counters.items, label).toBeLessThanOrEqual(CBOR_LIMITS.maxItems + 1);
    expect(counters.copiedBytes, label).toBeLessThanOrEqual(input.byteLength);
    expect(counters.copiedBytes, label).toBeLessThanOrEqual(CBOR_LIMITS.maxInputBytes);
  }
}

describe('the reader under random input (#2642, a property test)', () => {
  it('throws nothing but its own refusal and stays within its bounds, on random bytes', () => {
    const next = generator(2642);
    for (let run = 0; run < 4000; run += 1) {
      const input = new Uint8Array(Math.floor(next() * 64));
      for (let index = 0; index < input.length; index += 1) input[index] = Math.floor(next() * 256);
      holdsItsPromises(input, `random bytes, run ${String(run)}`);
    }
  });

  it('reads every nested structure it is given whole, and refuses every truncation of one', () => {
    const next = generator(0x2642);
    let read = 0;
    for (let run = 0; run < 400; run += 1) {
      const encoded = encodeCbor(randomValue(next, 0));
      if (holdsItsPromises(encoded, `structure ${String(run)}`)) read += 1;
      for (let cut = 0; cut < encoded.byteLength; cut += 1) {
        expect(
          holdsItsPromises(
            encoded.subarray(0, cut),
            `structure ${String(run)} cut at ${String(cut)}`,
          ),
        ).toBe(false);
      }
    }
    // Most are within the bounds and read; the rest were refused by name.
    expect(read).toBeGreaterThan(200);
  });

  it('stays within its bounds on structures with one byte changed', () => {
    const next = generator(42);
    for (let run = 0; run < 400; run += 1) {
      const encoded = encodeCbor(randomValue(next, 0));
      if (encoded.byteLength === 0) continue;
      const changed = encoded.slice();
      const at = Math.floor(next() * changed.length);
      changed[at] = Math.floor(next() * 256);
      holdsItsPromises(changed, `changed structure ${String(run)}`);
    }
  });

  it('refuses a deep nesting and a huge declared length without allocating for them', () => {
    const deep = new Uint8Array(4096).fill(0x81);
    const counters: CborCounters = { items: 0, copiedBytes: 0 };
    expect(() => readCbor(deep, counters)).toThrow(CborError);
    expect(counters.items).toBe(CBOR_LIMITS.maxDepth + 1);
    // A byte string that declares 2^53 - 1 bytes: refused, nothing copied.
    const huge = bytes(0x5b, 0x00, 0x1f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff);
    const hugeCounters: CborCounters = { items: 0, copiedBytes: 0 };
    expect(() => readCbor(huge, hugeCounters)).toThrow(CborError);
    expect(hugeCounters.copiedBytes).toBe(0);
  });
});
