// SPDX-License-Identifier: Apache-2.0

/**
 * The built-in library's cadence drills — #2302, under the library epic #2295.
 *
 * Four templates: high-cadence spin-ups, a cadence ladder, and two
 * low-cadence strength sets. Structures are training facts; names and
 * summaries are this project's own words (spike 0038 §1, ruling R-1), and
 * none is on the spike's list of other products' names (§3).
 *
 * ## A cue is advice, and the trainer never hears it
 *
 * Every cue here is a `CadenceCue` (`workout.ts`): shown on the ride screen,
 * never written to a trainer. In ERG the trainer holds the power target
 * whatever the cadence, so a low-cadence set is a high-torque set by the
 * rider's own choice of gear.
 *
 * ## ⚠️ Low cadence and the stall rescue
 *
 * `erg-safety.ts` treats a loss of `COLLAPSE_RPM` (15) inside its 8-second
 * window, ending under 65 rpm, as the ERG spiral, and eases the target. A
 * rider asked to drop from 90 to 60 rpm on purpose looks exactly like that.
 * The rescue's numbers are a trainer-safety rule and are NOT changed for a
 * drill (the owner's ruling 5 on #2295, 2026-11-06). So, by that ruling:
 *
 * - no cue in this file is below **60 rpm**;
 * - a low-cadence effort is entered over a **ramp** whose cue sits between the
 *   easy spin and the effort (85–95 → 70–80 → 60–65), so a rider who follows
 *   the cues loses cadence in two smaller steps rather than one large one.
 *
 * Whether the trend rule still fires on these drills is measured, not
 * assumed: `cadence-trend.test.ts` rides each one and records the answer,
 * which is on #137.
 */

import { revolutionsPerMinute, seconds } from '../../quantities';
import type { WorkoutTemplate } from '../template';
import { thresholdShare, type CadenceCue, type WorkoutBlock } from '../workout';

const share = thresholdShare;

/** A cue from `low` to `high` rpm. */
const rpm = (low: number, high: number): CadenceCue => ({
  low: revolutionsPerMinute(low),
  high: revolutionsPerMinute(high),
});

/** The easy spin between efforts: the cadence a rider settles at unasked. */
const EASY_SPIN = rpm(85, 95);

/** The cue a low-cadence effort is entered through, over its ramp. */
const INTO_THE_GEAR = rpm(70, 80);

/**
 * The library's warm-up convention (#2300): ten minutes from 0.45 to 0.70,
 * at whatever cadence the rider chooses.
 */
const WARM_UP: readonly WorkoutBlock[] = [
  { kind: 'ramp', seconds: seconds(600), from: share(0.45), to: share(0.7), label: 'Warm-up' },
];

/** Five minutes down to 0.45, at the rider's own cadence. */
const COOL_DOWN: readonly WorkoutBlock[] = [
  { kind: 'ramp', seconds: seconds(300), from: share(0.6), to: share(0.45), label: 'Cool-down' },
];

/** The global intensity range, −25 % to +10 % (the owner's ruling 2 on #2295). */
const INTENSITY = { intensityPercent: { minimum: -25, maximum: 10 } };

/** One-minute spin-ups at 105–115 rpm, two minutes easy between: 39 minutes as written. */
const spinUps: WorkoutTemplate = {
  id: 'cadence-spin-ups',
  name: 'High-cadence spin-ups',
  summary:
    'One-minute spin-ups at 105 to 115 rpm on a light target, with two minutes of easy ' +
    'pedalling between.',
  category: 'cadence',
  warmUp: WARM_UP,
  mainSet: {
    scaling: 'repeat',
    rep: [
      {
        kind: 'steady',
        seconds: seconds(60),
        target: share(0.65),
        label: 'Spin-up',
        cadence: rpm(105, 115),
      },
    ],
    repeats: { minimum: 3, maximum: 25, default: 8 },
    recovery: {
      block: { kind: 'steady', seconds: seconds(120), target: share(0.55), cadence: EASY_SPIN },
      seconds: { minimum: 60, maximum: 180 },
    },
  },
  coolDown: COOL_DOWN,
  parameters: INTENSITY,
};

/** Two minutes each at 80, 90, 100 and 110 rpm, two minutes easy: 45 minutes as written. */
const ladder: WorkoutTemplate = {
  id: 'cadence-ladder',
  name: 'Cadence ladder',
  summary:
    'Two minutes each at 80, 90, 100 and 110 rpm on a steady endurance target, then two ' +
    'minutes easy, and climb it again.',
  category: 'cadence',
  warmUp: WARM_UP,
  mainSet: {
    scaling: 'repeat',
    rep: [
      { kind: 'steady', seconds: seconds(120), target: share(0.68), cadence: rpm(78, 82) },
      { kind: 'steady', seconds: seconds(120), target: share(0.68), cadence: rpm(88, 92) },
      { kind: 'steady', seconds: seconds(120), target: share(0.68), cadence: rpm(98, 102) },
      { kind: 'steady', seconds: seconds(120), target: share(0.68), cadence: rpm(108, 112) },
    ],
    repeats: { minimum: 1, maximum: 8, default: 3 },
    recovery: {
      block: { kind: 'steady', seconds: seconds(120), target: share(0.55), cadence: EASY_SPIN },
    },
  },
  coolDown: COOL_DOWN,
  parameters: INTENSITY,
};

/**
 * A minute's ramp into the gear, five minutes at 60–65 rpm, three minutes
 * easy: 60 minutes as written.
 */
const strengthFives: WorkoutTemplate = {
  id: 'cadence-low-strength-5min',
  name: 'Low-cadence strength, five-minute efforts',
  summary:
    'Five-minute efforts at 60 to 65 rpm and 85% of threshold, eased into over a minute, ' +
    'with easy spinning between.',
  category: 'cadence',
  warmUp: WARM_UP,
  mainSet: {
    scaling: 'repeat',
    rep: [
      {
        kind: 'ramp',
        seconds: seconds(60),
        from: share(0.6),
        to: share(0.85),
        label: 'Into the gear',
        cadence: INTO_THE_GEAR,
      },
      {
        kind: 'steady',
        seconds: seconds(300),
        target: share(0.85),
        label: 'Low cadence',
        cadence: rpm(60, 65),
      },
    ],
    repeats: { minimum: 2, maximum: 8, default: 5 },
    recovery: {
      block: { kind: 'steady', seconds: seconds(180), target: share(0.55), cadence: EASY_SPIN },
    },
  },
  coolDown: COOL_DOWN,
  parameters: INTENSITY,
};

/**
 * A minute's ramp into the gear, ten minutes at 60–70 rpm, four minutes
 * easy: 60 minutes as written.
 */
const strengthTens: WorkoutTemplate = {
  id: 'cadence-low-strength-10min',
  name: 'Low-cadence strength, ten-minute efforts',
  summary:
    'Ten-minute efforts at 60 to 70 rpm and 80% of threshold, eased into over a minute, ' +
    'with easy spinning between.',
  category: 'cadence',
  warmUp: WARM_UP,
  mainSet: {
    scaling: 'repeat',
    rep: [
      {
        kind: 'ramp',
        seconds: seconds(60),
        from: share(0.6),
        to: share(0.8),
        label: 'Into the gear',
        cadence: INTO_THE_GEAR,
      },
      {
        kind: 'steady',
        seconds: seconds(600),
        target: share(0.8),
        label: 'Low cadence',
        cadence: rpm(60, 70),
      },
    ],
    repeats: { minimum: 1, maximum: 5, default: 3 },
    recovery: {
      block: { kind: 'steady', seconds: seconds(240), target: share(0.55), cadence: EASY_SPIN },
    },
  },
  coolDown: COOL_DOWN,
  parameters: INTENSITY,
};

/** The cadence drills, in the order a browser lists them. */
export const CADENCE_WORKOUTS: readonly WorkoutTemplate[] = [
  spinUps,
  ladder,
  strengthFives,
  strengthTens,
];
