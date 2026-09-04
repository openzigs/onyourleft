// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { decodeFitString, decodeUtf8, REPLACEMENT_CHARACTER } from './utf8';

function encode(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

describe('decodeUtf8', () => {
  it('decodes ASCII', () => {
    expect(decodeUtf8(encode(0x62, 0x69, 0x6b, 0x65))).toBe('bike');
  });

  it('decodes two, three and four byte sequences', () => {
    // U+00E9 é, U+20AC €, U+1F6B2 bicycle.
    expect(decodeUtf8(encode(0xc3, 0xa9))).toBe('é');
    expect(decodeUtf8(encode(0xe2, 0x82, 0xac))).toBe('€');
    expect(decodeUtf8(encode(0xf0, 0x9f, 0x9a, 0xb2))).toBe('🚲');
  });

  it('decodes a range rather than the whole array', () => {
    expect(decodeUtf8(encode(0xff, 0x62, 0x69, 0xff), 1, 3)).toBe('bi');
  });

  it('replaces a stray continuation byte and keeps going', () => {
    expect(decodeUtf8(encode(0x61, 0x80, 0x62))).toBe(`a${REPLACEMENT_CHARACTER}b`);
  });

  it('replaces a truncated sequence at the end of the field', () => {
    expect(decodeUtf8(encode(0x61, 0xe2, 0x82))).toBe(`a${REPLACEMENT_CHARACTER}`);
  });

  it('resumes at a byte that broke a sequence rather than swallowing it', () => {
    // 0xE2 wants two continuations; 0x61 is not one. The `a` must survive.
    expect(decodeUtf8(encode(0xe2, 0x61, 0x62))).toBe(`${REPLACEMENT_CHARACTER}ab`);
  });

  it('rejects overlong encodings', () => {
    // C0 80 and C1 BF are overlong forms of U+0000 and U+007F; E0 80 AF is an
    // overlong solidus, the classic path-traversal smuggle.
    expect(decodeUtf8(encode(0xc0, 0x80))).toBe(REPLACEMENT_CHARACTER.repeat(2));
    expect(decodeUtf8(encode(0xc1, 0xbf))).toBe(REPLACEMENT_CHARACTER.repeat(2));
    expect(decodeUtf8(encode(0xe0, 0x80, 0xaf))).not.toContain('/');
    expect(decodeUtf8(encode(0xf0, 0x80, 0x80, 0xaf))).not.toContain('/');
  });

  it('rejects surrogate code points, which have no UTF-8 encoding', () => {
    // ED A0 80 would be U+D800.
    expect(decodeUtf8(encode(0xed, 0xa0, 0x80))).toBe(REPLACEMENT_CHARACTER);
  });

  it('rejects code points above U+10FFFF', () => {
    // F4 90 80 80 would be U+110000; F5.. can only ever be out of range.
    expect(decodeUtf8(encode(0xf4, 0x90, 0x80, 0x80))).toBe(REPLACEMENT_CHARACTER);
    expect(decodeUtf8(encode(0xf5, 0x80, 0x80, 0x80))).toBe(REPLACEMENT_CHARACTER.repeat(4));
  });

  it('never throws, whatever the bytes are', () => {
    for (let byte = 0; byte <= 0xff; byte += 1) {
      expect(() => decodeUtf8(encode(byte))).not.toThrow();
      expect(() => decodeUtf8(encode(byte, byte, byte, byte, byte))).not.toThrow();
    }
  });
});

describe('decodeFitString', () => {
  it('stops at the first NUL and ignores the padding', () => {
    const field = encode(0x62, 0x69, 0x6b, 0x65, 0x00, 0x00, 0x00, 0x00);
    expect(decodeFitString(field, 0, 8)).toBe('bike');
  });

  it('reads a field that fills its declared width with no terminator', () => {
    expect(decodeFitString(encode(0x61, 0x62, 0x63), 0, 3)).toBe('abc');
  });

  it('is empty for an all-NUL field, which is the string invalid marker', () => {
    expect(decodeFitString(encode(0x00, 0x00, 0x00), 0, 3)).toBe('');
  });

  it('reads from an offset inside a larger buffer', () => {
    const buffer = encode(0xff, 0xff, 0x68, 0x72, 0x00, 0xff);
    expect(decodeFitString(buffer, 2, 3)).toBe('hr');
  });

  it('does not read past its declared width', () => {
    const buffer = encode(0x61, 0x62, 0x63, 0x64);
    expect(decodeFitString(buffer, 0, 2)).toBe('ab');
  });
});
