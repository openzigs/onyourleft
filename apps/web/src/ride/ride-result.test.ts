// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { beatsPerMinute, metres, seconds, watts, type BeatsPerMinute } from '@onyourleft/domain';
import { activityId } from '@onyourleft/store';

import { CHART_POINTS, downsample, gapSamples, seriesFor } from '../detail/series';
import { describeTrace } from '../detail/TraceChart';
import {
  GAME_OUTCOME_TEXT,
  rideResultOf,
  statedAverageHeartRate,
  type SavedRide,
} from './ride-result';

const RIDE: SavedRide = {
  activityId: activityId('a'),
  elapsedTime: seconds(60),
  distance: metres(500),
  averagePower: watts(150),
  averageHeartRate: undefined,
  gameOutcome: undefined,
};

const SAVED = {
  phase: 'stopped',
  stopping: false,
  storage: 'ok',
  saveState: 'saved',
  savedRide: RIDE,
} as const;

describe('rideResultOf — when there is a card at all (#1042)', () => {
  it('is the saved ride once it is stopped, settled, written and saved', () => {
    expect(rideResultOf(SAVED)).toBe(RIDE);
  });

  it.each([
    { phase: 'recording' },
    { phase: 'paused' },
    { phase: 'idle' },
    { stopping: true },
    { storage: 'failed' },
    { storage: 'quota-exceeded' },
    { saveState: 'saving' },
    { saveState: 'failed' },
    { saveState: 'empty' },
    { saveState: 'unavailable' },
    { savedRide: undefined },
  ])('is nothing when %o', (change) => {
    expect(rideResultOf({ ...SAVED, ...change })).toBeUndefined();
  });
});

describe('GAME_OUTCOME_TEXT', () => {
  it('reads three different ways, each about the rider’s best', () => {
    const sentences = Object.values(GAME_OUTCOME_TEXT);
    expect(new Set(sentences).size).toBe(3);
    for (const sentence of sentences) {
      expect(sentence).toContain('your best');
      // #1049's review: which game ride is said, since a recording can hold several.
      expect(sentence).toContain('your last trainer game ride');
    }
  });
});

describe('statedAverageHeartRate — the figure the ride’s page states (#1049’s review)', () => {
  /**
   * A 1 200-second ride whose strap dropped every other reading for the first
   * ten minutes: 300 readings of 100, then 600 of 200. The plain mean of the
   * readings is 166.7; the page reduces to 600 buckets of two seconds, half of
   * them 100 and half 200, and states 150.
   */
  const GAPPED: readonly (BeatsPerMinute | undefined)[] = [
    ...Array.from({ length: 600 }, (_, index) =>
      index % 2 === 0 ? beatsPerMinute(100) : undefined,
    ),
    ...Array.from({ length: 600 }, () => beatsPerMinute(200)),
  ];

  it('states what the ride’s page states, for a gapped ride over 600 seconds', () => {
    const heartRate = seriesFor('heartRate', 'metric');
    const page = describeTrace({
      label: heartRate.label,
      unit: heartRate.unit,
      points: downsample(GAPPED, CHART_POINTS),
      secondsPerPoint: GAPPED.length / CHART_POINTS,
      format: heartRate.format,
      missingSamples: gapSamples(GAPPED),
    });
    const card = statedAverageHeartRate(GAPPED);
    expect(card).toBe(150);
    expect(page).toContain(`Average ${String(card)} bpm`);
  });

  it('is not the plain mean of the readings, which the page does not state', () => {
    const readings = GAPPED.filter((sample) => sample !== undefined);
    const plain = Math.round(readings.reduce((sum, each) => sum + each, 0) / readings.length);
    expect(plain).toBe(167);
    expect(statedAverageHeartRate(GAPPED)).not.toBe(plain);
  });

  it('is nothing for a ride with no strap, or a strap that never reported', () => {
    expect(statedAverageHeartRate(undefined)).toBeUndefined();
    expect(statedAverageHeartRate([undefined, undefined])).toBeUndefined();
  });

  it('rounds to a whole beat, leaving a short ride’s dropout out', () => {
    expect(statedAverageHeartRate([beatsPerMinute(140), undefined, beatsPerMinute(151)])).toBe(146);
  });
});
