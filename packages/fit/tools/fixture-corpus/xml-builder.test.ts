// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { decimal, degrees, document, isoInstant, xmlText } from './xml-builder';

describe('decimal', () => {
  it('pins the digit count, so the bytes cannot move with a refactor', () => {
    expect(decimal(1, 7)).toBe('1.0000000');
    expect(decimal(0.1 + 0.2, 7)).toBe('0.3000000');
    expect(decimal(-48.5, 7)).toBe('-48.5000000');
  });

  it('renders negative zero as zero, so a sign cannot appear from nowhere', () => {
    expect(decimal(-0, 7)).toBe('0.0000000');
    expect(decimal(0, 7)).toBe('0.0000000');
  });

  it('renders a negative magnitude that rounds away to zero without its sign', () => {
    // This is the case `toFixed` does not handle on its own: it keeps the sign
    // of a value that is genuinely below zero even when every digit it prints
    // is a zero. "-0.0000000" and "0.0000000" are the same point.
    expect(decimal(-1e-9, 7)).toBe('0.0000000');
    expect(decimal(-4.9e-8, 7)).toBe('0.0000000');
    expect(decimal(-0.4, 0)).toBe('0');
  });

  it('keeps the sign of a magnitude that does survive the rounding', () => {
    expect(decimal(-1e-7, 7)).toBe('-0.0000001');
    expect(decimal(-0.6, 0)).toBe('-1');
  });

  it('refuses a value that has no fixed-point rendering', () => {
    expect(() => decimal(Number.NaN, 7)).toThrow(RangeError);
    expect(() => decimal(Number.POSITIVE_INFINITY, 7)).toThrow(RangeError);
  });
});

describe('degrees', () => {
  it('renders coordinates at 1e-7, which is finer than any GNSS fix', () => {
    expect(degrees(-0.018)).toBe('-0.0180000');
    expect(degrees(179.9999999)).toBe('179.9999999');
  });
});

describe('isoInstant', () => {
  it('renders whole seconds in UTC with no fractional part', () => {
    expect(isoInstant(1718442000)).toBe('2024-06-15T09:00:00Z');
    expect(isoInstant(0)).toBe('1970-01-01T00:00:00Z');
  });

  it('refuses a fractional instant rather than rounding one silently', () => {
    expect(() => isoInstant(1718442000.5)).toThrow(RangeError);
  });
});

describe('xmlText', () => {
  it('escapes every character that cannot appear literally', () => {
    expect(xmlText(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&apos;');
  });

  it('escapes the ampersand first, so an escape is not escaped twice', () => {
    expect(xmlText('&lt;')).toBe('&amp;lt;');
  });
});

describe('document', () => {
  it('joins with a newline and ends with exactly one', () => {
    expect(document(['a', 'b'])).toBe('a\nb\n');
  });
});
