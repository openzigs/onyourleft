// SPDX-License-Identifier: Apache-2.0

/**
 * A cadence cue never changes what a trainer is told (#2302): the player's
 * intents for a workout are the same, tick for tick, with its cues and
 * without them. The cue is for a screen; the player reads none.
 */

import { describe, expect, it } from 'vitest';

import { revolutionsPerMinute, seconds, watts } from '../quantities';

import { workoutCadenceText } from './describe';
import { TREND_WINDOW, type CadenceReading } from './erg-safety';
import { CADENCE_WORKOUTS } from './library';
import { createWorkoutPlayer, type PlayerIntent, type WorkoutRescue } from './player';
import { tailorWorkout } from './template';
import { expandWorkout, segmentAt, type WorkoutTimeline } from './timeline';
import type { Workout, WorkoutBlock } from './workout';

const THRESHOLD = watts(250);

const CUE_KEYS: ReadonlySet<string> = new Set(['cadence', 'hardCadence', 'easyCadence']);

/** The same workout with every cue taken off: the keys are gone, not left undefined. */
function withoutCues(workout: Workout): Workout {
  return {
    ...workout,
    blocks: workout.blocks.map(
      (block) =>
        Object.fromEntries(
          Object.entries(block).filter(([key]) => !CUE_KEYS.has(key)),
        ) as unknown as WorkoutBlock,
    ),
  };
}

interface Tick {
  readonly intent: PlayerIntent;
  readonly rescue: WorkoutRescue | undefined;
  readonly pending: number | undefined;
}

/**
 * Ride a timeline at 1 Hz, every write acknowledged, with a rider whose
 * cadence `cadenceAt` gives — the SAME rider for both runs, so any
 * difference is the player's.
 */
function ride(timeline: WorkoutTimeline, cadenceAt: (at: number) => number): Tick[] {
  const player = createWorkoutPlayer({ timeline, thresholdPower: THRESHOLD });
  const history: CadenceReading[] = [];
  const ticks: Tick[] = [];
  player.start(seconds(0));
  for (let at = 0; at <= timeline.totalSeconds + 1; at += 1) {
    history.push({ at: seconds(at), cadence: revolutionsPerMinute(cadenceAt(at)) });
    while ((history[0]?.at ?? at) < at - TREND_WINDOW) history.shift();
    const state = player.tick(seconds(at), { cadence: history });
    if (state.intent.kind === 'write-target') player.acknowledge(state.intent.watts);
    ticks.push({ intent: state.intent, rescue: state.rescue, pending: state.pending });
  }
  return ticks;
}

describe('the player writes the same with cues and without them', () => {
  for (const template of CADENCE_WORKOUTS) {
    it(`${template.id}: identical intents, tick for tick — rescues included`, () => {
      const workout = tailorWorkout(template, { intensityPercent: 5 });
      const cuedTimeline = expandWorkout(workout);
      const bareTimeline = expandWorkout(withoutCues(workout));
      // The two really differ: one has cues to ignore, the other none.
      expect(cuedTimeline.segments.some((segment) => segment.cadence !== undefined)).toBe(true);
      expect(bareTimeline.segments.every((segment) => segment.cadence === undefined)).toBe(true);

      // A rider who steps straight to each cue's bottom, so that a rescue —
      // where one happens — is part of what must match.
      const cadenceAt = (at: number) => segmentAt(cuedTimeline, seconds(at))?.cadence?.low ?? 90;
      const cued = ride(cuedTimeline, cadenceAt);
      const bare = ride(bareTimeline, cadenceAt);
      expect(cued.filter((tick) => tick.intent.kind === 'write-target').length).toBeGreaterThan(0);
      expect(cued).toStrictEqual(bare);
    });
  }

  it('and a rider who sinks below every cue meets a rescue, which also matches', () => {
    // Without this, "rescues included" could be a claim about nothing.
    const template = CADENCE_WORKOUTS.find((each) => each.id === 'cadence-low-strength-5min');
    if (template === undefined) throw new Error('no strength template');
    const workout = tailorWorkout(template, {});
    const timeline = expandWorkout(workout);
    const sinking = (at: number) => (segmentAt(timeline, seconds(at))?.cadence?.low ?? 90) - 25;
    const cued = ride(timeline, sinking);
    expect(cued.some((tick) => tick.rescue !== undefined)).toBe(true);
    expect(ride(expandWorkout(withoutCues(workout)), sinking)).toStrictEqual(cued);
  });
});

describe('a cue in words', () => {
  it('is a range, or one cadence when its ends agree', () => {
    expect(
      workoutCadenceText({ low: revolutionsPerMinute(85), high: revolutionsPerMinute(95) }),
    ).toBe('85–95 rpm');
    expect(
      workoutCadenceText({ low: revolutionsPerMinute(90), high: revolutionsPerMinute(90) }),
    ).toBe('90 rpm');
  });
});
