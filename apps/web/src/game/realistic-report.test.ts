// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The record the last realistic ride kept, and what Settings › Game world
 * says from it — #2289.
 *
 * ⚠️ The sentences are pinned as literals, not built from the module's own
 * strings: a test that rendered the module's output and looked for it would
 * pass any wording at all (`AboutView.test.tsx` §"duplicated on purpose").
 */

import { describe, expect, it } from 'vitest';

import type { PreferenceStorage } from './hud/announce-preference';
import {
  REALISTIC_REPORT_STORAGE_KEY,
  readRealisticReport,
  realisticReportLines,
  writeRealisticReport,
  type RealisticWorldReport,
} from './realistic-report';

function disk(): PreferenceStorage & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

const LEFT: RealisticWorldReport = {
  frameMsLimit: 45,
  settling: { frames: 30, slow: 4, worstMs: 312.4 },
  steps: [
    {
      rung: 0,
      left: false,
      rideSeconds: 41.6,
      frames: 30,
      overFrameMs: 30,
      medianMs: 61.2,
      worstMs: 88.7,
    },
    {
      rung: 1,
      left: true,
      rideSeconds: 47.2,
      frames: 30,
      overFrameMs: 12,
      medianMs: 41,
      worstMs: 52,
    },
  ],
};

describe('the last realistic ride’s record — #2289', () => {
  it('reads back what was written, through the device’s storage', () => {
    const store = disk();
    expect(readRealisticReport(store)).toBeUndefined();
    expect(writeRealisticReport(store, LEFT)).toBe(true);
    expect(store.values.has(REALISTIC_REPORT_STORAGE_KEY)).toBe(true);
    expect(readRealisticReport(store)).toEqual(LEFT);
    // A record with no settling window and no step reads back as itself too.
    const bare: RealisticWorldReport = { frameMsLimit: 45, steps: [] };
    writeRealisticReport(store, bare);
    expect(readRealisticReport(store)).toEqual(bare);
  });

  it('reads nothing rather than a half-record from anything malformed, and never throws', () => {
    const store = disk();
    const malformed = [
      'not json',
      'null',
      '[]',
      JSON.stringify({ ...LEFT, frameMsLimit: 'x' }),
      JSON.stringify({ ...LEFT, steps: 'x' }),
      JSON.stringify({ ...LEFT, settling: { frames: 30, slow: 4 } }),
      JSON.stringify({ ...LEFT, settling: 3 }),
      JSON.stringify({ ...LEFT, steps: [{ ...LEFT.steps[0], left: 'yes' }] }),
      JSON.stringify({ ...LEFT, steps: [{ ...LEFT.steps[0], medianMs: null }] }),
      JSON.stringify({ ...LEFT, steps: [7] }),
    ];
    for (const text of malformed) {
      store.values.set(REALISTIC_REPORT_STORAGE_KEY, text);
      expect(readRealisticReport(store), text).toBeUndefined();
    }
    const throwing: PreferenceStorage = {
      getItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
    };
    expect(readRealisticReport(throwing)).toBeUndefined();
    expect(readRealisticReport(undefined)).toBeUndefined();
    expect(writeRealisticReport(throwing, LEFT)).toBe(false);
    expect(writeRealisticReport(undefined, LEFT)).toBe(false);
  });

  it('says the reason, the readings and the rung, rounded as a person reads them', () => {
    expect(realisticReportLines(LEFT)).toEqual([
      'Its first 30 realistic frames were not counted while the world was handed over: 4 took longer than 45 ms, the longest 312 ms.',
      'It stepped down within the realistic world 42 s into the ride, from realistic rung 1, on frame time: of the last 30 frames 30 took longer than 45 ms (median 61 ms, longest 89 ms).',
      'It left the realistic world 47 s into the ride, from realistic rung 2, on frame time: of the last 30 frames 12 took longer than 45 ms (median 41 ms, longest 52 ms).',
    ]);
  });

  it('says when the ride stayed, and never names a thermal forecast — #2289', () => {
    const stayed: RealisticWorldReport = { frameMsLimit: 45, steps: [] };
    expect(realisticReportLines(stayed)).toEqual(['It did not leave the realistic world.']);
    expect(realisticReportLines(LEFT).join(' ')).not.toMatch(/thermal|forecast/i);
  });
});
