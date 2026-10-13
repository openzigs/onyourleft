// SPDX-License-Identifier: AGPL-3.0-or-later

import { beatsPerMinute, metres, seconds, unixSeconds, watts } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import type { LapFigures } from '../../recording/laps';

import { lapSummary } from './lap-text';

/** A whole 5 km lap ridden in `moving` seconds. */
function lap(moving: number, overrides: Partial<LapFigures> = {}): LapFigures {
  return {
    startedAt: unixSeconds(1_700_000_000),
    elapsedTime: seconds(moving + 20),
    movingTime: seconds(moving),
    distance: metres(5_000),
    averagePower: watts(201),
    averageHeartRate: beatsPerMinute(148),
    ...overrides,
  };
}

describe('lapSummary — #1312', () => {
  it('states the first lap’s time and averages, and compares it with nothing', () => {
    expect(lapSummary([lap(600)], 'metric')).toEqual({
      label: 'Lap 1',
      // 5 km in 600 s of MOVING time is 30.0 km/h; the 20 s paused are not in it.
      text: '10:00 · 201 W · 30.0 km/h · 148 bpm.',
      sentence:
        'Lap 1: 10 minutes, average power 201 watts, average speed 30.0 km/h, average heart rate 148.',
    });
  });

  it('says a quicker lap is faster than the one before, by how much, and that it is the best', () => {
    const summary = lapSummary([lap(600), lap(592)], 'metric');

    expect(summary?.label).toBe('Lap 2');
    expect(summary?.text).toBe(
      '9:52 · 201 W · 30.4 km/h · 148 bpm. 8 s faster than lap 1. Your best lap of this ride.',
    );
    expect(summary?.sentence).toBe(
      'Lap 2: 9 minutes 52 seconds, average power 201 watts, average speed 30.4 km/h, ' +
        'average heart rate 148. 8 seconds faster than lap 1. Your best lap of this ride.',
    );
  });

  it('says a slower lap is slower, and which lap is still the best', () => {
    const summary = lapSummary([lap(590), lap(600), lap(661)], 'metric');

    expect(summary?.text).toBe(
      '11:01 · 201 W · 27.2 km/h · 148 bpm. 61 s slower than lap 2. Best: lap 1, 9:50.',
    );
    expect(summary?.sentence).toContain('1 minute 1 second slower than lap 2.');
    expect(summary?.sentence).toContain('Your best is lap 1, 9 minutes 50 seconds.');
  });

  it('says a lap in the same time is the same time', () => {
    const summary = lapSummary([lap(600), lap(600)], 'metric');

    expect(summary?.text).toContain('Same time as lap 1.');
    // The earlier of two equal laps stays the best.
    expect(summary?.text).toContain('Best: lap 1, 10:00.');
  });

  it('leaves out a figure nothing measured, rather than stating a nought', () => {
    const bare: LapFigures = {
      startedAt: unixSeconds(1_700_000_000),
      elapsedTime: seconds(600),
      movingTime: seconds(600),
      distance: metres(5_000),
    };

    expect(lapSummary([bare], 'metric')).toEqual({
      label: 'Lap 1',
      text: '10:00 · 30.0 km/h.',
      sentence: 'Lap 1: 10 minutes, average speed 30.0 km/h.',
    });
  });

  it('states the speed in the rider’s own unit', () => {
    expect(lapSummary([lap(600)], 'imperial')?.text).toContain('18.6 mph');
  });

  it('compares with the last WHOLE lap of the same course, never a part lap or another road', () => {
    const laps = [
      lap(600),
      // Another course ridden in between, and a ride abandoned part-way round.
      lap(100, { distance: metres(1_000) }),
      lap(30, { distance: metres(400), partial: true }),
      lap(610),
    ];

    const summary = lapSummary(laps, 'metric');

    expect(summary?.label).toBe('Lap 4');
    expect(summary?.text).toContain('10 s slower than lap 1.');
  });

  it('has nothing to show for a part lap, or for no laps', () => {
    expect(lapSummary([lap(600), lap(30, { partial: true })], 'metric')).toBeUndefined();
    expect(lapSummary([], 'metric')).toBeUndefined();
  });
});
