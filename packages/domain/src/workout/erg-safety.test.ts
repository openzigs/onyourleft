// SPDX-License-Identifier: Apache-2.0

/**
 * #14's first epic acceptance criterion:
 *
 * > *A test using the #44 simulator proves the player detects a cadence
 * > collapse and disengages or reduces target rather than continuing to raise
 * > resistance.*
 *
 * ⚠️ The simulator is `packages/sensors`, which this package cannot import —
 * `packages/domain` depends on no other workspace package and the dependency
 * points the other way. What is asserted here is the **decision**, fed the
 * cadence history a collapsing rider produces; the wiring of a real simulated
 * device into it belongs with the player, in the package that may name one.
 */

import { describe, expect, it } from 'vitest';

import { revolutionsPerMinute, seconds } from '../quantities';

import {
  assessErgCadence,
  COLLAPSE_RPM,
  RELIEF_SHARE,
  STALLING_CADENCE,
  STOPPED_CADENCE,
  TREND_WINDOW,
  type CadenceReading,
} from './erg-safety';

/** A cadence history, one reading per second, ending at `at`. */
const history = (at: number, cadences: readonly number[]): CadenceReading[] =>
  cadences.map((cadence, index) => ({
    at: seconds(at - (cadences.length - 1 - index)),
    cadence: revolutionsPerMinute(cadence),
  }));

describe('an ordinary rider is left alone', () => {
  it('holds while cadence is steady', () => {
    expect(assessErgCadence(history(10, [90, 90, 91, 89, 90]), seconds(10)).kind).toBe('holding');
  });

  it('holds a rider grinding at 60 rpm on purpose', () => {
    // Low cadence is not the signature. A rider who chooses to grind must not
    // have their interval eased out from under them.
    expect(assessErgCadence(history(10, [60, 61, 60, 59, 60]), seconds(10)).kind).toBe('holding');
  });

  it('holds a rider coming DOWN from a fast start', () => {
    // The false positive that would otherwise fire every interval: 120 → 100 is
    // a 20 rpm loss, more than COLLAPSE_RPM, and nowhere near trouble. The
    // second clause — that the rider ends up near the stalling cadence — is
    // what makes this hold.
    expect(assessErgCadence(history(10, [120, 115, 110, 105, 100]), seconds(10)).kind).toBe(
      'holding',
    );
  });

  it('holds when there is only one reading, because one reading is not a trend', () => {
    expect(assessErgCadence(history(10, [45]), seconds(10)).kind).toBe('holding');
  });

  it('holds when the sensor has said nothing at all', () => {
    // Silence is a cadence sensor dropping out, not a spiral. Treating it as a
    // fault would ease the target every time a sensor blipped.
    expect(assessErgCadence([], seconds(10)).kind).toBe('holding');
  });
});

describe('a spiral is caught and the target eased', () => {
  it('detects cadence collapsing toward a stall', () => {
    const verdict = assessErgCadence(history(10, [80, 75, 70, 65, 58]), seconds(10));
    expect(verdict.kind).toBe('spiralling');
    if (verdict.kind !== 'spiralling') throw new Error('unreachable');
    expect(verdict.relief).toBe(RELIEF_SHARE);
    expect(verdict.reason).toContain('spin back up');
  });

  it('eases rather than releasing, so the interval is still the interval', () => {
    // Releasing ERG drops all resistance at once, which throws somebody pushing
    // hard onto a suddenly weightless pedal — and it ends the interval, which
    // is the workout deciding the rider failed.
    const verdict = assessErgCadence(history(10, [80, 74, 68, 62, 56]), seconds(10));
    if (verdict.kind !== 'spiralling') throw new Error('expected a spiral');
    expect(verdict.relief).toBeGreaterThan(0);
    expect(verdict.relief).toBeLessThan(1);
  });

  it('catches a rider already low when the player starts looking', () => {
    // The backstop, for a spiral that began before anybody was watching — which
    // is what a mid-workout reconnection looks like. No trend needed.
    const verdict = assessErgCadence(history(10, [48, 47, 48, 47]), seconds(10));
    expect(verdict.kind).toBe('spiralling');
  });

  it('fires at the collapse threshold and not one rpm below it', () => {
    const ending = STALLING_CADENCE + 5;
    const justUnder = history(10, [ending + COLLAPSE_RPM - 1, ending]);
    const justOver = history(10, [ending + COLLAPSE_RPM, ending]);
    expect(assessErgCadence(justUnder, seconds(10)).kind).toBe('holding');
    expect(assessErgCadence(justOver, seconds(10)).kind).toBe('spiralling');
  });
});

describe('a rider who has stopped is a different answer', () => {
  it('reports stalled rather than easing a target nobody is riding', () => {
    // There is no target low enough to ride at eight rpm, so reducing one would
    // only make the trainer quieter about the same problem.
    const verdict = assessErgCadence(history(10, [30, 20, 12, 8]), seconds(10));
    expect(verdict.kind).toBe('stalled');
    if (verdict.kind !== 'stalled') throw new Error('unreachable');
    expect(verdict.reason).toContain('released');
  });

  it('draws the line at STOPPED_CADENCE, which is not derived from STALLING_CADENCE', () => {
    expect(assessErgCadence(history(10, [30, 20, STOPPED_CADENCE]), seconds(10)).kind).toBe(
      'stalled',
    );
    expect(assessErgCadence(history(10, [30, 25, STOPPED_CADENCE + 1]), seconds(10)).kind).toBe(
      'spiralling',
    );
  });
});

describe('the window', () => {
  it('ignores readings older than the trend window', () => {
    // A collapse that happened a minute ago and recovered is not happening now.
    // ⚠️ Chosen so that IGNORING the window would flip the answer. An earlier
    // version of this case used readings that held either way, so it passed
    // whether or not the filter existed — a test that cannot fail for the
    // reason its name gives. Here the old 95 rpm against the current 58 is a
    // 37 rpm loss ending near the stalling cadence, which is a spiral if the
    // stale reading is counted and nothing at all if it is not.
    const stale: CadenceReading[] = [
      { at: seconds(0), cadence: revolutionsPerMinute(95) },
      { at: seconds(59), cadence: revolutionsPerMinute(58) },
      { at: seconds(60), cadence: revolutionsPerMinute(58) },
    ];
    expect(assessErgCadence(stale, seconds(60)).kind).toBe('holding');
  });

  it('ignores readings from the future', () => {
    const ahead: CadenceReading[] = [
      { at: seconds(10), cadence: revolutionsPerMinute(90) },
      { at: seconds(99), cadence: revolutionsPerMinute(20) },
    ];
    expect(assessErgCadence(ahead, seconds(10)).kind).toBe('holding');
  });

  it('does not need its input sorted', () => {
    // A caller keeping a ring buffer should not have to sort it to ask.
    const ordered = history(10, [80, 74, 68, 62, 56]);
    const shuffled = [ordered[2], ordered[0], ordered[4], ordered[1], ordered[3]].filter(
      (reading): reading is CadenceReading => reading !== undefined,
    );
    expect(assessErgCadence(shuffled, seconds(10))).toEqual(assessErgCadence(ordered, seconds(10)));
  });

  it('reads no clock of its own', () => {
    // `packages/domain` may not read one — the recording engine may not either.
    // The same history judged at two instants gives two answers, which is only
    // possible because `now` is a parameter.
    const readings = history(10, [80, 74, 68, 62, 56]);
    expect(assessErgCadence(readings, seconds(10)).kind).toBe('spiralling');
    expect(assessErgCadence(readings, seconds(10 + TREND_WINDOW + 1)).kind).toBe('holding');
  });
});
