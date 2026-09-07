// SPDX-License-Identifier: AGPL-3.0-or-later

import { fitnessSeries, type DailyLoad, type FitnessPoint } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import {
  sampledPoints,
  STEADY_WITHIN,
  TREND_TABLE_ROWS,
  TREND_WINDOW_DAYS,
  trendReadings,
  trendSentence,
} from './trend';

/**
 * A series of `days` consecutive days at a constant daily load.
 *
 * ⚠️ Built by stepping a real date rather than by formatting an index into a
 * month field. The first version of this helper did the latter and produced
 * `2026-15-08` — which is how the infinite loop in `fitnessSeries` was found.
 */
function steady(days: number, load: number): readonly FitnessPoint[] {
  const start = Date.parse('2026-01-01T00:00:00Z');
  const daily: DailyLoad[] = Array.from({ length: days }, (_unused, index) => ({
    day: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
    load,
  }));
  return fitnessSeries(daily);
}

describe('trendReadings', () => {
  it('reports three readings for a real series', () => {
    const readings = trendReadings(steady(60, 80));

    expect(readings.map((reading) => reading.label)).toEqual(['Fitness', 'Fatigue', 'Freshness']);
  });

  it('has no readings at all for an empty series', () => {
    // Not three zeros: "0, steady" is a claim about training that did not
    // happen, and a rider with no rides has no fitness to report.
    expect(trendReadings([])).toEqual([]);
  });

  it('calls a climbing average rising', () => {
    const readings = trendReadings(steady(30, 100));

    expect(readings[0]?.direction).toBe('rising');
    expect(readings[0]?.change).toBeGreaterThan(0);
  });

  it('calls a falling average falling', () => {
    // Train, then stop. Fitness decays.
    const trained: DailyLoad[] = Array.from({ length: 28 }, (_unused, index) => ({
      day: `2026-01-${String(index + 1).padStart(2, '0')}`,
      load: 100,
    }));
    const thenRested = fitnessSeries([...trained, { day: '2026-04-01', load: 0 }]);

    expect(trendReadings(thenRested)[0]?.direction).toBe('falling');
  });

  it('calls a drift smaller than the threshold steady', () => {
    // Without this, every reading is "rising" or "falling", because an
    // exponential average almost never lands on exactly its previous value.
    const long = steady(400, 50);
    const fitness = trendReadings(long)[0];

    expect(Math.abs(fitness?.change ?? 1)).toBeLessThan(STEADY_WITHIN);
    expect(fitness?.direction).toBe('steady');
  });

  it('compares against a week ago', () => {
    expect(TREND_WINDOW_DAYS).toBe(7);
  });

  it('compares against its own first day when the history is shorter than a week', () => {
    // Clamped rather than wrapped — the most that can honestly be said about
    // three days of history is what changed across those three days.
    const readings = trendReadings(steady(3, 100));

    expect(readings).toHaveLength(3);
    expect(readings[0]?.change).toBeGreaterThan(0);
  });
});

describe('trendSentence', () => {
  it('says the value, the direction and the size of the change', () => {
    expect(trendSentence({ label: 'Fitness', value: 62.4, direction: 'rising', change: 4.2 })).toBe(
      'Fitness 62, rising — up 4 over the last week.',
    );
  });

  it('says “down” for a fall rather than a minus sign', () => {
    // A screen reader announcing "minus four" is worse than one saying "down
    // four", and the sign is the thing most easily missed either way.
    expect(
      trendSentence({ label: 'Freshness', value: -9.2, direction: 'falling', change: -6.1 }),
    ).toBe('Freshness -9, falling — down 6 over the last week.');
  });

  it('says steady without inventing a direction', () => {
    expect(trendSentence({ label: 'Fatigue', value: 40.1, direction: 'steady', change: 0.2 })).toBe(
      'Fatigue 40, steady over the last week.',
    );
  });

  it('never says whether a reading is good or bad', () => {
    // ⚠️ Fatigue rises because the athlete trained, which is the point of
    // training. A chart that called that bad news on the strength of three
    // numbers would be making a claim it cannot support.
    const sentences = trendReadings(steady(60, 90)).map((reading) => trendSentence(reading));

    for (const sentence of sentences) {
      expect(sentence).not.toMatch(/good|bad|overtrain|warning|too (much|hard)|risk/i);
    }
  });
});

describe('sampledPoints', () => {
  it('leaves a short series alone', () => {
    const points = steady(10, 50);
    expect(sampledPoints(points, 26)).toEqual(points);
  });

  it('cuts a long series to the row budget', () => {
    // A decade at one row per day is 3 650 rows to arrow through with a screen
    // reader, which is not an equivalent of anything.
    const sampled = sampledPoints(steady(400, 50), 26);

    expect(sampled.length).toBeLessThanOrEqual(26);
    expect(sampled.length).toBeGreaterThan(0);
  });

  it('always ends on the most recent day', () => {
    // A naive stride from the start drops the last point whenever the length
    // is not a multiple of the stride — and the last point is the one a reader
    // actually wants.
    const points = steady(365, 50);

    expect(sampledPoints(points, 26).at(-1)).toEqual(points.at(-1));
  });

  it('is ascending, like the series it samples', () => {
    const sampled = sampledPoints(steady(365, 50), 26);
    const days = sampled.map((point) => point.day);

    expect([...days].sort()).toEqual(days);
  });

  it('has a stated row budget', () => {
    expect(TREND_TABLE_ROWS).toBe(26);
  });
});
