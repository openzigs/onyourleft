// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { IdentityError } from './errors';
import { bytesEqual, fromHex, isHexOfLength, toHex } from './hex';

describe('toHex', () => {
  it('emits two lowercase characters per byte, leading zeroes included', () => {
    expect(toHex(new Uint8Array([0x00, 0x0f, 0xa9, 0xff]))).toBe('000fa9ff');
  });

  it('is empty for no bytes', () => {
    expect(toHex(new Uint8Array())).toBe('');
  });
});

describe('fromHex', () => {
  it('round-trips every byte value', () => {
    const all = new Uint8Array(256);
    for (let value = 0; value < 256; value += 1) {
      all[value] = value;
    }

    expect([...fromHex(toHex(all), 'a probe')]).toEqual([...all]);
  });

  it('refuses uppercase, because a record has one canonical spelling', () => {
    // `A1` and `a1` are the same bytes and different strings. Folding them would
    // give one record two serialisations and therefore two signatures.
    expect(() => fromHex('A1', 'a public key')).toThrow(IdentityError);
  });

  it('refuses an odd number of characters', () => {
    expect(() => fromHex('abc', 'a signature')).toThrow(/even number/);
  });

  it('refuses a character that is not a hexadecimal digit', () => {
    expect(() => fromHex('zz', 'a signature')).toThrow(/lowercase hexadecimal/);
  });

  it('refuses a length other than the one asked for', () => {
    expect(() => fromHex('aabb', 'a public key', 32)).toThrow(/must be 32 bytes/);
  });

  it('never puts the rejected value in the message', () => {
    // The one place this package touches material that may be private. A
    // message naming the value would carry it into a console and a crash report
    // — #61's second acceptance criterion, and the reason `errors.ts` exists.
    const secret = 'deadbeefZZ';

    expect(() => fromHex(secret, 'a private key')).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('deadbeef') as unknown }),
    );
  });
});

describe('isHexOfLength', () => {
  it('accepts exactly the right length of lowercase hex', () => {
    expect(isHexOfLength('aabb', 2)).toBe(true);
  });

  it('rejects the right characters at the wrong length', () => {
    expect(isHexOfLength('aabb', 3)).toBe(false);
  });

  it('rejects uppercase at the right length', () => {
    expect(isHexOfLength('AABB', 2)).toBe(false);
  });
});

describe('bytesEqual', () => {
  it('is true for the same bytes', () => {
    expect(bytesEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
  });

  it('is false for a difference in the last byte', () => {
    // The case a short-circuiting comparison written the naive way still gets
    // right, and the case a length-blind one gets wrong is the next test.
    expect(bytesEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
  });

  it('is false when one is a prefix of the other', () => {
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });
});
