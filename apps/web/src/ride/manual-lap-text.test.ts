// SPDX-License-Identifier: AGPL-3.0-or-later

import { beatsPerMinute, metres, seconds, unixSeconds, watts } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import type { LapFigures } from '../recording/laps';

import { manualLapSummary } from './manual-lap-text';

const LAP: LapFigures = {
  startedAt: unixSeconds(1_800_000_000),
  elapsedTime: seconds(3_800),
  movingTime: seconds(3_723),
  distance: metres(30_500),
  averagePower: watts(185),
  maxPower: watts(600),
  averageHeartRate: beatsPerMinute(141),
  maxHeartRate: beatsPerMinute(170),
};

describe('manualLapSummary — #1318', () => {
  it('states the moving time, the distance, average power and average heart rate, shown and said', () => {
    expect(manualLapSummary(3, LAP, 'metric')).toEqual({
      label: 'Lap 3',
      text: '1:02:03 · 30.5 km · 185 W · 141 bpm.',
      sentence:
        'Lap 3: 1 hour 2 minutes 3 seconds, 30.5 km, average power 185 watts, average heart rate 141.',
    });
  });

  it('in the rider’s own units', () => {
    expect(manualLapSummary(3, LAP, 'imperial').text).toBe('1:02:03 · 19.0 mi · 185 W · 141 bpm.');
  });

  it('leaves out what the lap has no figure for, and a distance nobody measured, rather than saying nought', () => {
    const bare: LapFigures = {
      startedAt: LAP.startedAt,
      elapsedTime: seconds(65),
      movingTime: seconds(65),
      // A ride with no speed channel: no known distance, as the ride has none.
      distance: metres(0),
    };
    expect(manualLapSummary(1, bare, 'metric')).toEqual({
      label: 'Lap 1',
      text: '1:05.',
      sentence: 'Lap 1: 1 minute 5 seconds.',
    });
  });

  it('says a lap ridden wholly while paused as that, and not as a lap of no time', () => {
    const paused = { ...LAP, movingTime: seconds(0.6) };
    expect(manualLapSummary(2, paused, 'metric')).toEqual({
      label: 'Lap 2',
      text: 'Ridden while the recording was paused.',
      sentence: 'Lap 2: ridden while the recording was paused.',
    });
  });
});
