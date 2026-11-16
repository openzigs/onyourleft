// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { bytesText, countText, durationText, momentText } from './words';

const HOUR = 3600;

/**
 * The largest count `GET /v1/operate/status` and `/backups` may send: the
 * route's schema says a whole number of at least zero, and the app's port
 * admits a safe integer and nothing larger (`operate-port.ts` §`isCount`).
 */
const LARGEST = Number.MAX_SAFE_INTEGER;

describe('durationText — a length of time in its two largest units (#2604)', () => {
  it('says less than a minute for zero and for anything under sixty seconds', () => {
    expect(durationText(0)).toBe('less than a minute');
    expect(durationText(59)).toBe('less than a minute');
  });

  it('names one unit when the next one down is zero, and two when it is not', () => {
    expect(durationText(60)).toBe('1 minute');
    expect(durationText(3599)).toBe('59 minutes');
    expect(durationText(2 * HOUR)).toBe('2 hours');
    expect(durationText(HOUR + 17 * 60)).toBe('1 hour 17 minutes');
    expect(durationText(24 * HOUR)).toBe('1 day');
    expect(durationText(24 * HOUR - 1)).toBe('23 hours 59 minutes');
    expect(durationText((3 * 24 + 4) * HOUR + 59)).toBe('3 days 4 hours');
  });

  it('holds at the largest count the route may send', () => {
    expect(durationText(LARGEST)).toBe('104249991374 days 7 hours');
  });
});

describe('bytesText — bytes in decimal units (#2604)', () => {
  it('says zero bytes, and bytes below a kilobyte, as bytes', () => {
    expect(bytesText(0)).toBe('0 bytes');
    expect(bytesText(512)).toBe('512 bytes');
    expect(bytesText(999)).toBe('999 bytes');
  });

  it('keeps one decimal under ten of a unit, and none from ten up', () => {
    expect(bytesText(1_000)).toBe('1.0 kB');
    expect(bytesText(1_500)).toBe('1.5 kB');
    expect(bytesText(20_000_000)).toBe('20 MB');
    expect(bytesText(412_000_000_000)).toBe('412 GB');
    expect(bytesText(1_500_000_000_000)).toBe('1.5 TB');
  });

  it('stops at terabytes, at the largest count the route may send', () => {
    expect(bytesText(LARGEST)).toBe('9007 TB');
  });
});

describe('countText and momentText', () => {
  it('reads one as the singular and every other count, zero included, as the plural', () => {
    expect(countText(0, 'row', 'rows')).toBe('0 rows');
    expect(countText(1, 'row', 'rows')).toBe('1 row');
    expect(countText(LARGEST, 'blob', 'blobs')).toBe('9007199254740991 blobs');
  });

  it('says a moment to the minute, in UTC, from the text the route sent', () => {
    expect(momentText('2026-11-14T08:00:59.999Z')).toBe('2026-11-14 08:00 UTC');
  });
});
