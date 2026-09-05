// SPDX-License-Identifier: Apache-2.0

import { unixSeconds } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { formatIsoInstant, parseIsoInstant } from './iso-time';

/** 2024-06-15T09:00:00Z — the instant the #29 fixture corpus starts at. */
const RIDE_START = 1_718_442_000;

describe('parsing an ISO 8601 instant', () => {
  it('reads the form both formats actually write', () => {
    expect(parseIsoInstant('2024-06-15T09:00:00Z')).toBe(RIDE_START);
  });

  it.each([
    ['a lower-case designator', '2024-06-15t09:00:00z'],
    ['a space separator', '2024-06-15 09:00:00Z'],
    ['fractional seconds', '2024-06-15T09:00:00.000Z'],
    ['surrounding whitespace', '  2024-06-15T09:00:00Z\n'],
    ['seconds omitted', '2024-06-15T09:00Z'],
  ])('accepts %s', (_what, text) => {
    expect(parseIsoInstant(text)).toBe(RIDE_START);
  });

  it.each([
    ['a positive offset', '2024-06-15T10:00:00+01:00'],
    ['a negative offset', '2024-06-15T04:00:00-05:00'],
    ['an offset with no colon', '2024-06-15T10:00:00+0100'],
    ['an hours-only offset', '2024-06-15T10:00:00+01'],
  ])('resolves %s to the same absolute instant', (_what, text) => {
    expect(parseIsoInstant(text)).toBe(RIDE_START);
  });

  it('truncates fractional seconds toward the past rather than rounding', () => {
    // Rounding 09:00:00.6 up to 09:00:01 moves a sample past the next one, and
    // a track whose samples are out of order is a track with a negative speed
    // in it.
    expect(parseIsoInstant('2024-06-15T09:00:00.600Z')).toBe(RIDE_START);
    expect(parseIsoInstant('2024-06-15T09:00:00.999999Z')).toBe(RIDE_START);
  });

  it('refuses a timestamp with no zone, rather than guessing the reader’s', () => {
    // The whole reason this file exists instead of `new Date(text)`. A guess
    // here makes the same file import as a different ride in every time zone.
    expect(parseIsoInstant('2024-06-15T09:00:00')).toBeUndefined();
    expect(parseIsoInstant('2024-06-15')).toBeUndefined();
  });

  it('refuses a date that does not exist rather than rolling it forward', () => {
    // `Date.UTC(2024, 1, 31)` is 2024-03-02, silently.
    expect(parseIsoInstant('2024-02-31T00:00:00Z')).toBeUndefined();
    expect(parseIsoInstant('2023-02-29T00:00:00Z')).toBeUndefined();
    expect(parseIsoInstant('2024-13-01T00:00:00Z')).toBeUndefined();
    expect(parseIsoInstant('2024-06-15T24:00:00Z')).toBeUndefined();
    expect(parseIsoInstant('2024-06-15T09:60:00Z')).toBeUndefined();
  });

  it('accepts a leap day that does exist', () => {
    expect(parseIsoInstant('2024-02-29T00:00:00Z')).toBe(1_709_164_800);
  });

  it('refuses text that is not a timestamp at all', () => {
    for (const text of ['', '   ', 'yesterday', '1718442000', '2024/06/15T09:00:00Z']) {
      expect(parseIsoInstant(text), text).toBeUndefined();
    }
  });
});

describe('writing an ISO 8601 instant', () => {
  it('always writes UTC with a Z, whatever zone the ride was ridden in', () => {
    // Not a local time with an offset: an offset is the rider's approximate
    // longitude, and a file exported to be shared should not carry it.
    expect(formatIsoInstant(unixSeconds(RIDE_START))).toBe('2024-06-15T09:00:00Z');
  });

  it('round-trips every instant it writes', () => {
    for (const offset of [0, 1, 59, 3600, 86_399, 86_400, 1_000_000_000]) {
      const instant = unixSeconds(RIDE_START + offset);
      expect(parseIsoInstant(formatIsoInstant(instant))).toBe(instant);
    }
  });
});

describe('an instant no ISO 8601 timestamp of this shape can carry', () => {
  /**
   * ⚠️ `Date.prototype.toISOString` spells a year outside 0000–9999 as
   * `+010000-01-01T00:00:00.000Z`, and the nineteen-character slice this
   * formatter takes turned that into `+010000-01-01T00:00Z` — a timestamp that
   * looks well formed, parses, and means a different moment. A refusal is the
   * lesser outcome.
   */
  it.each([
    ['the year after 9999', 253_402_300_800],
    ['a year long before 0000', -62_167_219_201],
    ['past the range Date itself holds', 8.64e12 + 1],
  ])('refuses %s rather than writing a truncated one', (_what, seconds) => {
    expect(() => formatIsoInstant(unixSeconds(seconds))).toThrow(RangeError);
  });

  it('writes the last instant it can, and the first', () => {
    expect(formatIsoInstant(unixSeconds(253_402_300_799))).toBe('9999-12-31T23:59:59Z');
    expect(formatIsoInstant(unixSeconds(-62_167_219_200))).toBe('0000-01-01T00:00:00Z');
  });

  it('never names the instant in the message', () => {
    // An exception from an export is the string most likely to be pasted into a
    // public issue, and a ride's timestamps are metadata about a rider.
    try {
      formatIsoInstant(unixSeconds(253_402_300_800));
    } catch (cause) {
      expect((cause as Error).message).not.toContain('253402300800');
      expect((cause as Error).message).not.toContain('10000');
    }
  });
});
