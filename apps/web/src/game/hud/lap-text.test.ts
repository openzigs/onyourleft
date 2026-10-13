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
    // And the best is the best of THIS course. Lap 2 was quicker and faster
    // (1 km at 36 km/h), and it was another road — so the notice says which
    // course it means, and does not say "lap 1 is your best" of the ride.
    expect(summary?.text).toContain('Best on this course: lap 1, 10:00.');
    expect(summary?.sentence).toContain('Your best on this course is lap 1, 10 minutes.');
    expect(summary?.text).not.toMatch(/(^|\. )Best: lap/);
  });

  it('calls a lap the best of this COURSE, not of the ride, when another course was ridden too', () => {
    const laps = [lap(100, { distance: metres(1_000) }), lap(600), lap(590)];

    const summary = lapSummary(laps, 'metric');

    // Lap 1 was the faster ride (36 km/h against 30.5), on another road: the
    // ride's page marks IT the best lap of the ride.
    expect(summary?.text).toContain('10 s faster than lap 2. Your best lap of this course.');
    expect(summary?.sentence).toContain('Your best lap of this course.');
    expect(summary?.text).not.toContain('of this ride');
    expect(summary?.sentence).not.toContain('of this ride');
  });

  it('still says "of this ride" when the only other road was a part lap', () => {
    const laps = [lap(600), lap(30, { distance: metres(400), partial: true }), lap(590)];

    expect(lapSummary(laps, 'metric')?.text).toContain('Your best lap of this ride.');
  });

  it('says nothing about a best lap with one whole lap of this course, whatever else was ridden', () => {
    const summary = lapSummary(
      [lap(100, { distance: metres(1_000) }), lap(90, { distance: metres(1_000) }), lap(600)],
      'metric',
    );

    expect(summary?.text).toBe('10:00 · 201 W · 30.0 km/h · 148 bpm.');
  });

  it('takes the difference of the two times as they are shown', () => {
    // 592.9 s is shown as 9:52 and 590.2 s as 9:50: two seconds apart on the
    // HUD. The unrounded difference is 2.7 s, which rounds to 3.
    const summary = lapSummary([lap(590.2), lap(592.9)], 'metric');

    expect(summary?.text).toBe(
      '9:52 · 201 W · 30.4 km/h · 148 bpm. 2 s slower than lap 1. Best: lap 1, 9:50.',
    );
    expect(summary?.sentence).toContain('2 seconds slower than lap 1.');
  });

  it('never calls a lap the best beside saying it took the same time as another', () => {
    // 592.1 s against 592.8 s: quicker by a fraction, and both shown as 9:52.
    const summary = lapSummary([lap(592.8), lap(592.1)], 'metric');

    expect(summary?.text).toContain('Same time as lap 1.');
    expect(summary?.text).toContain('Best: lap 1, 9:52.');
    expect(summary?.text).not.toContain('Your best lap of this ride');
    expect(summary?.sentence).not.toContain('Your best lap of this ride');
  });

  it('calls a lap the best when it is quicker by a second that is shown', () => {
    const summary = lapSummary([lap(600), lap(592.8), lap(591.9)], 'metric');

    expect(summary?.text).toContain('1 s faster than lap 2.');
    expect(summary?.text).toContain('Your best lap of this ride.');
  });

  it('says a lap with no moving time was ridden while paused, with no time and no comparison', () => {
    // The whole course ridden with the recording paused: 6 s on the clock,
    // none of it moving, no reading taken.
    const paused: LapFigures = {
      startedAt: unixSeconds(1_700_000_000),
      elapsedTime: seconds(6),
      movingTime: seconds(0),
      distance: metres(5_000),
    };

    expect(lapSummary([lap(600), paused], 'metric')).toEqual({
      label: 'Lap 2',
      text: 'Ridden while the recording was paused.',
      sentence: 'Lap 2: ridden while the recording was paused.',
    });
  });

  it('never calls a lap with no moving time the best, nor compares a later lap with it', () => {
    const paused = lap(0, { elapsedTime: seconds(6) });

    // Lap 3 follows the paused one: it is compared with lap 1, and the best
    // is the quicker of the two that have a time.
    const summary = lapSummary([lap(600), paused, lap(590)], 'metric');
    expect(summary?.text).toBe(
      '9:50 · 201 W · 30.5 km/h · 148 bpm. 10 s faster than lap 1. Your best lap of this ride.',
    );

    // And with only one timed lap there is no best to speak of.
    expect(lapSummary([paused, lap(600)], 'metric')?.text).toBe(
      '10:00 · 201 W · 30.0 km/h · 148 bpm.',
    );
  });

  it('has nothing to show for a part lap, or for no laps', () => {
    expect(lapSummary([lap(600), lap(30, { partial: true })], 'metric')).toBeUndefined();
    expect(lapSummary([], 'metric')).toBeUndefined();
  });
});
