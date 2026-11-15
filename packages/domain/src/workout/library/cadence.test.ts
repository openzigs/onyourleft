// SPDX-License-Identifier: Apache-2.0

/**
 * The cadence drills (#2302) against the catalogue's rules: each tailors,
 * each keeps its cues through tailoring and the file, and none asks for a
 * cadence the stall rescue would read as a spiral (the owner's ruling 5 on
 * #2295). #2300's `catalogue.test.ts` enumerates {@link BUILT_IN_WORKOUTS} for
 * the gates every template passes; this file holds the cadence-only ones.
 */

import { describe, expect, it } from 'vitest';

import { workoutShapeText } from '../describe';
import { decodeWorkoutFile, encodeWorkoutFile, workoutFileVersionFor } from '../format';
import {
  LENGTH_TOLERANCE_SECONDS,
  LENGTH_TOLERANCE_SHARE,
  tailorWorkout,
  TEMPLATE_LENGTHS_MINUTES,
} from '../template';
import { expandWorkout } from '../timeline';

import { CADENCE_WORKOUTS } from './cadence';

import { BUILT_IN_WORKOUTS } from '.';

/** The lowest cue a drill may name: the owner's ruling 5 on #2295. */
const LOWEST_CUE_RPM = 60;
/** Under this a cue is a low-cadence one, and must be entered over a ramp. */
const LOW_CADENCE_RPM = 70;

describe('the cadence drills are in the library', () => {
  it('four of them, every one in BUILT_IN_WORKOUTS, under the cadence category', () => {
    expect(CADENCE_WORKOUTS).toHaveLength(4);
    for (const template of CADENCE_WORKOUTS) {
      expect(BUILT_IN_WORKOUTS).toContain(template);
      expect(template.category).toBe('cadence');
    }
  });

  it('with unique, stable slug ids and unique names', () => {
    const ids = BUILT_IN_WORKOUTS.map((each) => each.id);
    const names = BUILT_IN_WORKOUTS.map((each) => each.name);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});

describe('each drill tailors', () => {
  for (const template of CADENCE_WORKOUTS) {
    it(`${template.id}: with the defaults, and at every length the library offers`, () => {
      expect(workoutShapeText(tailorWorkout(template, {}))).not.toBe('');
      for (const minutes of TEMPLATE_LENGTHS_MINUTES) {
        const total = expandWorkout(
          tailorWorkout(template, { targetMinutes: minutes }),
        ).totalSeconds;
        const tolerance = Math.max(minutes * 60 * LENGTH_TOLERANCE_SHARE, LENGTH_TOLERANCE_SECONDS);
        expect(Math.abs(total - minutes * 60)).toBeLessThanOrEqual(tolerance);
      }
    });
  }
});

describe('each drill keeps its cues, through tailoring and the file', () => {
  for (const template of CADENCE_WORKOUTS) {
    it(`${template.id}: every main-set stretch has a cue, and the file is version 3`, () => {
      const workout = tailorWorkout(template, { intensityPercent: -10 });
      const main = expandWorkout(workout).segments.filter(
        (segment) => segment.label !== 'Warm-up' && segment.label !== 'Cool-down',
      );
      expect(main.length).toBeGreaterThan(0);
      for (const segment of main) expect(segment.cadence).toBeDefined();

      expect(workoutFileVersionFor(workout)).toBe(3);
      expect(decodeWorkoutFile(encodeWorkoutFile(workout))).toStrictEqual(workout);
    });
  }

  it('a one-block rep folded into an intervals block keeps both halves’ cues', () => {
    // `template.ts` §`repeatBlocks` turns a steady rep and its recovery into
    // one intervals block; the cues are the part that step would drop.
    const spinUps = CADENCE_WORKOUTS.find((each) => each.id === 'cadence-spin-ups');
    if (spinUps === undefined) throw new Error('no spin-ups template');
    const block = tailorWorkout(spinUps, {}).blocks[1];
    expect(block).toMatchObject({
      kind: 'intervals',
      repeats: 8,
      hardCadence: { low: 105, high: 115 },
      easyCadence: { low: 85, high: 95 },
    });
  });
});

describe('no drill asks for a cadence the stall rescue reads as a spiral', () => {
  for (const template of CADENCE_WORKOUTS) {
    const segments = expandWorkout(tailorWorkout(template, {})).segments;

    it(`${template.id}: no cue below ${String(LOWEST_CUE_RPM)} rpm`, () => {
      for (const segment of segments) {
        if (segment.cadence !== undefined) {
          expect(segment.cadence.low).toBeGreaterThanOrEqual(LOWEST_CUE_RPM);
        }
      }
    });

    it(`${template.id}: a low-cadence effort is entered over a ramp, never a step`, () => {
      for (const [index, segment] of segments.entries()) {
        if (segment.cadence === undefined || segment.cadence.low >= LOW_CADENCE_RPM) continue;
        const before = segments[index - 1];
        // The stretch before is a ramp (its from and to differ) with a cue
        // between the easy spin and this one, or it is the same effort.
        const sameEffort = before?.block === segment.block;
        const rampedIn =
          before !== undefined &&
          before.from !== before.to &&
          before.cadence !== undefined &&
          before.cadence.low > segment.cadence.low;
        expect(sameEffort || rampedIn).toBe(true);
      }
    });
  }
});
