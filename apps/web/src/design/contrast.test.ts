// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  AA_LARGE_TEXT_OR_NON_TEXT,
  AA_TEXT,
  ColourFormatError,
  contrastRatio,
  parseHexColour,
  relativeLuminance,
} from './contrast';

describe('relativeLuminance', () => {
  // The two fixed points WCAG defines exactly. If the linearisation were
  // dropped — a plausible "simplification", since the numbers look close —
  // these two would still pass and every mid-tone would be wrong, which is why
  // the mid-tone case below is here as well.
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBe(1);
  });

  it('applies the sRGB transfer function rather than treating the channel as linear', () => {
    // Mid grey is 0.5 of the channel range and 0.2159 of the luminance range.
    // A linear reading would give 0.5.
    expect(relativeLuminance('#808080')).toBeCloseTo(0.2159, 4);
  });

  it('weights green far above blue, as the formula does', () => {
    expect(relativeLuminance('#00ff00')).toBeCloseTo(0.7152, 4);
    expect(relativeLuminance('#0000ff')).toBeCloseTo(0.0722, 4);
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white, which is the maximum the scale reaches', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });

  it('is 1 for a colour against itself', () => {
    expect(contrastRatio('#0b5c55', '#0b5c55')).toBeCloseTo(1, 10);
  });

  it('does not depend on which argument is the foreground', () => {
    expect(contrastRatio('#0b5c55', '#ffffff')).toBeCloseTo(
      contrastRatio('#ffffff', '#0b5c55'),
      10,
    );
  });

  it('agrees with a known published value', () => {
    // 4.5:1 is the AA text threshold, so a pair right at it is the one worth
    // pinning: #767676 on white is the canonical example of exactly-passing.
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });
});

describe('parseHexColour', () => {
  it('reads the three channels', () => {
    expect(parseHexColour('#0b5c55')).toEqual([0x0b, 0x5c, 0x55]);
  });

  it('accepts upper case', () => {
    expect(parseHexColour('#0B5C55')).toEqual([0x0b, 0x5c, 0x55]);
  });

  it.each([
    ['#fff', 'three-digit shorthand'],
    ['#0b5c55ff', 'an alpha channel, which has no defined ratio without a backdrop'],
    ['rgb(11, 92, 85)', 'a functional notation'],
    ['teal', 'a keyword'],
    ['', 'nothing at all'],
  ])('refuses %s (%s) rather than skipping it', (value) => {
    // Refusing matters more than it looks: a checker that returned `undefined`
    // for an unreadable colour would report a palette as compliant without
    // having looked at that pair.
    expect(() => parseHexColour(value)).toThrow(ColourFormatError);
  });
});

describe('the thresholds are the WCAG 2.2 AA ones', () => {
  it('names 4.5 for text and 3 for large text and component boundaries', () => {
    expect(AA_TEXT).toBe(4.5);
    expect(AA_LARGE_TEXT_OR_NON_TEXT).toBe(3);
  });
});
