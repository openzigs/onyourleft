// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { checkDisplayName, MAXIMUM_DISPLAY_NAME_SCALARS } from './display-name';

/** A character by code point, so no invisible character is ever typed into this file. */
const at = (codePoint: number): string => String.fromCodePoint(codePoint);

describe('a display name (#774)', () => {
  it('keeps an ordinary name, trimmed', () => {
    expect(checkDisplayName('  Anna K  ')).toEqual({ ok: true, name: 'Anna K' });
  });

  it('stores the NFC form, so two keyboards give the same bytes', () => {
    const decomposed = `Zo${at(0x65)}${at(0x308)}`; // e + combining diaeresis
    const checked = checkDisplayName(decomposed);
    expect(checked).toEqual({ ok: true, name: `Zo${at(0xeb)}` });
  });

  it(`counts ${String(MAXIMUM_DISPLAY_NAME_SCALARS)} scalar values, not UTF-16 units`, () => {
    const bike = at(0x1f6b2); // two UTF-16 code units, one scalar value
    expect(checkDisplayName(bike.repeat(MAXIMUM_DISPLAY_NAME_SCALARS)).ok).toBe(true);
    expect(checkDisplayName(bike.repeat(MAXIMUM_DISPLAY_NAME_SCALARS + 1))).toEqual({
      ok: false,
      problem: 'too-long',
    });
    expect(checkDisplayName('a'.repeat(MAXIMUM_DISPLAY_NAME_SCALARS)).ok).toBe(true);
  });

  it('refuses a name with nothing in it', () => {
    expect(checkDisplayName('')).toEqual({ ok: false, problem: 'empty' });
    expect(checkDisplayName('   ')).toEqual({ ok: false, problem: 'empty' });
  });

  it.each([
    ['a newline', 0x0a],
    ['a bell', 0x07],
    ['a C1 control', 0x85],
    ['DEL', 0x7f],
  ])('refuses %s as a control character', (_, codePoint) => {
    expect(checkDisplayName(`An${at(codePoint)}na`)).toEqual({ ok: false, problem: 'control' });
  });

  it.each([
    ['a right-to-left override', 0x202e],
    ['a left-to-right embedding', 0x202a],
    ['a first-strong isolate', 0x2068],
    ['a pop directional isolate', 0x2069],
    ['a right-to-left mark', 0x200f],
    ['an Arabic letter mark', 0x061c],
  ])('refuses %s as bidi', (_, codePoint) => {
    expect(checkDisplayName(`An${at(codePoint)}na`)).toEqual({ ok: false, problem: 'bidi' });
  });

  it.each([
    ['a zero-width space', 0x200b],
    ['a zero-width joiner', 0x200d],
    ['a zero-width non-joiner', 0x200c],
    ['a word joiner', 0x2060],
    ['a soft hyphen', 0x00ad],
    ['a byte-order mark', 0xfeff],
  ])('refuses %s as invisible', (_, codePoint) => {
    expect(checkDisplayName(`An${at(codePoint)}na`)).toEqual({ ok: false, problem: 'invisible' });
  });

  it('refuses a lone surrogate as not text', () => {
    expect(checkDisplayName(`An${String.fromCharCode(0xd800)}na`)).toEqual({
      ok: false,
      problem: 'not-text',
    });
  });
});
