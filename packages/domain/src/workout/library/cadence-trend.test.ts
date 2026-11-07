// SPDX-License-Identifier: Apache-2.0

/**
 * #2302's measured finding: does the ERG stall rescue's trend rule fire on
 * the cadence drills? The answer goes on #137, where the rule's uncalibrated
 * 15 rpm is open.
 *
 * ⚠️ **This measures; it changes nothing.** `erg-safety.ts` is not touched
 * by #2302 (the owner's ruling 5 on #2295). Each drill is tailored as a rider
 * who chose nothing gets it, and ridden through the real player at 1 Hz in
 * ERG, every write acknowledged, with a modelled rider's cadence fed to the
 * real `assessErgCadence` through the player, as the Ride screen feeds it.
 *
 * ## The rider model, and why it is the part to argue with
 *
 * The rider pedals at an **aim** and moves towards it at a fixed **rate**:
 *
 * - the aim is the segment's cue — its middle, or its bottom for a rider who
 *   takes "60–65" to mean 60 — and 90 rpm where a block names no cue;
 * - the rate is how quickly a rider changes cadence when the cue changes:
 *   2 rpm/s (eases into it), 5 rpm/s (a deliberate change over a few
 *   seconds), or 30 rpm/s (a step: done within a second or two).
 *
 * The #44 simulator in `packages/sensors` is not used, deliberately: its
 * rider's cadence is a value the test sets, so it would carry this same
 * trace through GATT octets to the same `assessErgCadence` and could not
 * change the answer. What would change it is a real rider on a real trainer,
 * which is #137's own breakdown trigger.
 *
 * ⚠️ If a rescue number changes (#137), this table goes red, and that is the
 * point: the finding is re-measured rather than left stale.
 */

import { describe, expect, it } from 'vitest';

import { revolutionsPerMinute, seconds, watts } from '../../quantities';
import { TREND_WINDOW, type CadenceReading } from '../erg-safety';
import { createWorkoutPlayer } from '../player';
import { tailorWorkout } from '../template';
import { expandWorkout, segmentAt, type WorkoutSegment } from '../timeline';
import type { Workout } from '../workout';

import { CADENCE_WORKOUTS } from './cadence';

const THRESHOLD = watts(250);
/** The cadence a rider holds where a block names no cue. */
const UNCUED_RPM = 90;

type Aim = 'middle' | 'bottom';

/**
 * `as-written`, or `stepped`: the CONTROL, the same drill with its entry
 * ramp's cue taken away, so a rider holds 90 rpm through the ramp and steps
 * straight down to the effort's cue — what the ramp is there to prevent.
 */
type Entry = 'as-written' | 'stepped';

function withoutEntryCue(workout: Workout): Workout {
  return {
    ...workout,
    blocks: workout.blocks.map((block) =>
      block.kind === 'ramp' && block.label === 'Into the gear'
        ? { ...block, cadence: undefined }
        : block,
    ),
  };
}

function aimFor(segment: WorkoutSegment | undefined, aim: Aim): number {
  const cue = segment?.cadence;
  if (cue === undefined) return UNCUED_RPM;
  return aim === 'middle' ? (cue.low + cue.high) / 2 : cue.low;
}

/** Where the trend rule fired: the labels of the blocks the rescue began in, in order. */
function ride(templateId: string, aim: Aim, rate: number, entry: Entry = 'as-written'): string[] {
  const template = CADENCE_WORKOUTS.find((each) => each.id === templateId);
  if (template === undefined) throw new Error(`no template ${templateId}`);
  const tailored = tailorWorkout(template, {});
  const timeline = expandWorkout(entry === 'as-written' ? tailored : withoutEntryCue(tailored));
  const player = createWorkoutPlayer({ timeline, thresholdPower: THRESHOLD });
  const history: CadenceReading[] = [];
  let cadence = UNCUED_RPM;
  let rescued = false;
  const fired: string[] = [];
  player.start(seconds(0));
  for (let at = 0; at <= timeline.totalSeconds; at += 1) {
    const goal = aimFor(segmentAt(timeline, seconds(at)), aim);
    cadence += Math.max(-rate, Math.min(rate, goal - cadence));
    history.push({ at: seconds(at), cadence: revolutionsPerMinute(cadence) });
    while ((history[0]?.at ?? at) < at - TREND_WINDOW) history.shift();
    const state = player.tick(seconds(at), { cadence: history });
    if (state.intent.kind === 'write-target') player.acknowledge(state.intent.watts);
    if (state.rescue !== undefined && !rescued) {
      fired.push(state.segment?.label ?? `block ${String(state.segment?.block)}`);
    }
    rescued = state.rescue !== undefined;
  }
  return fired;
}

const RATES = [2, 5, 30] as const;

const QUIET = [[], [], []] as const;
const everyRep = (count: number): readonly (readonly string[])[] =>
  RATES.map(() => Array.from({ length: count }, () => 'Low cadence'));

/**
 * What was measured on 2026-11-07: per drill, entry and aim, at each of
 * {@link RATES}, the blocks a rescue began in, once per rescue. An empty list
 * is a ride the rescue left alone.
 */
const MEASURED: Readonly<
  Record<string, Readonly<Record<Entry, Readonly<Record<Aim, readonly (readonly string[])[]>>>>>
> = {
  // Nothing ends under 65 rpm, so the trend's second clause never holds.
  'cadence-spin-ups': {
    'as-written': { middle: QUIET, bottom: QUIET },
    stepped: { middle: QUIET, bottom: QUIET },
  },
  'cadence-ladder': {
    'as-written': { middle: QUIET, bottom: QUIET },
    stepped: { middle: QUIET, bottom: QUIET },
  },
  // As written: quiet. Stepped from 90 to 60–65: every rep, at every rate.
  'cadence-low-strength-5min': {
    'as-written': { middle: QUIET, bottom: QUIET },
    stepped: { middle: everyRep(5), bottom: everyRep(5) },
  },
  // Stepped to 60–70's middle the fall ends AT 65, not under it; to its bottom, every rep.
  'cadence-low-strength-10min': {
    'as-written': { middle: QUIET, bottom: QUIET },
    stepped: { middle: QUIET, bottom: everyRep(3) },
  },
};

describe('the ERG trend rule on each cadence drill, as measured (#2302, for #137)', () => {
  for (const template of CADENCE_WORKOUTS) {
    for (const entry of ['as-written', 'stepped'] as const) {
      for (const aim of ['middle', 'bottom'] as const) {
        it(`${template.id}, ${entry}, a rider aiming at each cue's ${aim}`, () => {
          const measured = RATES.map((rate) => ride(template.id, aim, rate, entry));
          expect(measured).toEqual(MEASURED[template.id]?.[entry][aim]);
        });
      }
    }
  }

  it('the control is a real one: the rig sees a rescue when a drill steps straight down', () => {
    // Without this a rig that never fed the cadence through would pass every
    // quiet row above. The stepped strength sets fire at every rate.
    expect(ride('cadence-low-strength-5min', 'middle', 30, 'stepped')).toHaveLength(5);
  });
});
