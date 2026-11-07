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
  realisticReportText,
  writeRealisticReport,
  type RealisticSettlingReading,
  type RealisticStepReading,
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

  it('says in one plain line that it switched, with the figures behind it — 2026-11-07', () => {
    expect(realisticReportText(LEFT)).toEqual({
      summary:
        'Your last ride in the realistic world switched to the standard world after 47 s because its frames were too slow.',
      details: [
        'While the world loaded, its first 30 frames were not counted: 4 took longer than 45 ms, the longest 312 ms.',
        'After 42 s it stepped down to fewer details: 30 of the last 30 frames took longer than 45 ms (median 61 ms, longest 89 ms).',
        'After 47 s it switched to the standard world: 12 of the last 30 frames took longer than 45 ms (median 41 ms, longest 52 ms).',
      ],
    });
  });

  it('says when it stepped down and stayed, in minutes and seconds', () => {
    const stepped: RealisticWorldReport = {
      frameMsLimit: 45,
      steps: [{ ...(LEFT.steps[0] as RealisticStepReading), rideSeconds: 91.6 }],
    };
    expect(realisticReportText(stepped)).toEqual({
      summary:
        'Your last ride in the realistic world stepped down to fewer details after 1 min 32 s because its frames were too slow.',
      details: [
        'After 1 min 32 s it stepped down to fewer details: 30 of the last 30 frames took longer than 45 ms (median 61 ms, longest 89 ms).',
      ],
    });
    const onTheMinute = { ...stepped, steps: [{ ...stepped.steps[0], rideSeconds: 120 }] };
    expect(realisticReportText(onTheMinute as RealisticWorldReport).summary).toContain(
      'after 2 min because',
    );
  });

  it('says when the ride stayed, and never names a thermal forecast — #2289', () => {
    const stayed: RealisticWorldReport = { frameMsLimit: 45, steps: [] };
    expect(realisticReportText(stayed)).toEqual({
      summary: 'Your last ride in the realistic world stayed in it.',
      details: [],
    });
    const { summary, details } = realisticReportText(LEFT);
    expect([summary, ...details].join(' ')).not.toMatch(/thermal|forecast/i);
  });

  it('keeps every figure out of the main line and in the details, for each kind of record', () => {
    const settling = LEFT.settling as RealisticSettlingReading;
    const kinds: readonly RealisticWorldReport[] = [
      { frameMsLimit: 45, settling, steps: [] },
      { frameMsLimit: 45, settling, steps: [LEFT.steps[0] as RealisticStepReading] },
      LEFT,
    ];
    for (const kind of kinds) {
      const { summary, details } = realisticReportText(kind);
      // "its frames were too slow" is the owner's wording: no frame COUNT, no millisecond.
      expect(summary).not.toMatch(/\bms\b|\d+\s+frames?\b|\d+ of\b|rung|median|longest/i);
      const all = details.join(' ');
      expect(all).toContain(`first ${String(settling.frames)} frames`);
      expect(all).toContain('the longest 312 ms');
      for (const step of kind.steps) {
        expect(all).toContain(
          `${String(step.overFrameMs)} of the last ${String(step.frames)} frames took longer than 45 ms (median ${String(Math.round(step.medianMs))} ms, longest ${String(Math.round(step.worstMs))} ms)`,
        );
      }
    }
  });
});
