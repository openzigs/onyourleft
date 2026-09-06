// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { IdentityError } from './errors';
import { utf8Encode } from './utf8';

describe('utf8Encode', () => {
  it('encodes ASCII one byte per character', () => {
    expect([...utf8Encode('abc')]).toEqual([0x61, 0x62, 0x63]);
  });

  it('encodes a two-byte code point', () => {
    expect([...utf8Encode('é')]).toEqual([0xc3, 0xa9]);
  });

  it('encodes a three-byte code point', () => {
    expect([...utf8Encode('日')]).toEqual([0xe6, 0x97, 0xa5]);
  });

  it('encodes a surrogate pair as one four-byte code point', () => {
    // U+1F6B4 BICYCLIST. Two UTF-16 code units, four UTF-8 bytes — the case a
    // per-code-unit encoder gets wrong by emitting two three-byte sequences.
    expect([...utf8Encode('🚴')]).toEqual([0xf0, 0x9f, 0x9a, 0xb4]);
  });

  it('refuses an unpaired high surrogate', () => {
    // `TextEncoder` substitutes U+FFFD here, which maps two different strings
    // onto the same bytes. A canonical serialisation that is not injective is
    // not canonical — RFC 8785 §3.2.3 forbids it for the same reason.
    expect(() => utf8Encode('\ud800')).toThrow(IdentityError);
  });

  it('refuses an unpaired low surrogate', () => {
    expect(() => utf8Encode('\udc00abc')).toThrow(IdentityError);
  });

  it('refuses a high surrogate followed by something that is not a low one', () => {
    expect(() => utf8Encode('\ud800a')).toThrow(/index 0/);
  });

  it('names the index and never the text', () => {
    expect(() => utf8Encode('secret-value\ud800')).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('secret-value') as unknown }),
    );
  });

  it('is empty for the empty string', () => {
    expect([...utf8Encode('')]).toEqual([]);
  });
});
