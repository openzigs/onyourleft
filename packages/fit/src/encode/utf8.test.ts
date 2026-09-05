// SPDX-License-Identifier: Apache-2.0

/**
 * The UTF-8 encoder, against the decoder that has to read it back.
 *
 * The two are written out separately — `decode/utf8.ts` and `encode/utf8.ts` —
 * because `packages/fit/src` has no `TextDecoder` or `TextEncoder` to delegate
 * to. That makes "they agree" a property to assert rather than one the platform
 * supplies.
 */

import { describe, expect, it } from 'vitest';

import { decodeUtf8, REPLACEMENT_CHARACTER } from '../decode/utf8';
import { encodeFitString, encodeUtf8, fitStringSize } from './utf8';

describe('encoding', () => {
  it.each([
    ['ASCII', 'Morning ride', [77]],
    ['two-byte', 'Café', [0x43, 0x61, 0x66, 0xc3, 0xa9]],
    ['three-byte', '朝のライド', [0xe6, 0x9c, 0x9d]],
    ['four-byte, from a surrogate pair', '🚲', [0xf0, 0x9f, 0x9a, 0xb2]],
  ])('encodes %s', (_what, text, firstBytes) => {
    const bytes = encodeUtf8(text);
    expect([...bytes.subarray(0, firstBytes.length)]).toEqual(firstBytes);
    expect(decodeUtf8(bytes)).toBe(text);
  });

  it('round-trips every code point range through the decoder', () => {
    const text = 'a߿ࠀ￿\u{10000}\u{10ffff}';
    expect(decodeUtf8(encodeUtf8(text))).toBe(text);
  });

  it('replaces a lone surrogate rather than emitting bytes that cannot come back', () => {
    // `decode/utf8.ts` rejects surrogate code points on the way in, so emitting
    // one would let a value cross the codec that cannot return.
    const highOnly = encodeUtf8('a\ud83dz');
    expect(decodeUtf8(highOnly)).toBe(`a${REPLACEMENT_CHARACTER}z`);

    const lowOnly = encodeUtf8('a\ude00z');
    expect(decodeUtf8(lowOnly)).toBe(`a${REPLACEMENT_CHARACTER}z`);

    // A high surrogate at the very end of the string, with no low one after it.
    expect(decodeUtf8(encodeUtf8('a\ud83d'))).toBe(`a${REPLACEMENT_CHARACTER}`);
  });

  it('encodes the empty string as no bytes at all', () => {
    expect(encodeUtf8('')).toHaveLength(0);
  });
});

describe('a fixed-width FIT string field', () => {
  it('is NUL-terminated and NUL-padded', () => {
    expect([...encodeFitString('ab', 5)]).toEqual([0x61, 0x62, 0x00, 0x00, 0x00]);
  });

  it('needs one byte more than its encoding, for the terminator', () => {
    expect(fitStringSize('ab')).toBe(3);
    expect(fitStringSize('é')).toBe(3);
    expect(fitStringSize('')).toBe(1);
  });

  it('truncates on a character boundary, not a byte one', () => {
    // 'é' is two bytes. A field with room for two bytes plus a terminator holds
    // it; one with room for one byte must drop it whole rather than emit the
    // lead byte, which would decode to U+FFFD.
    expect(decodeUtf8(encodeFitString('é', 3)).replace(/\0+$/, '')).toBe('é');
    expect([...encodeFitString('é', 2)]).toEqual([0x00, 0x00]);
    expect(decodeUtf8(encodeFitString('aé', 3)).replace(/\0+$/, '')).toBe('a');
  });

  it('is all zeroes for a zero-width field, rather than reading off the end', () => {
    expect(encodeFitString('anything', 0)).toHaveLength(0);
  });
});
