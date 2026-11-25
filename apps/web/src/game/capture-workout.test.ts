// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3153: a capture's workout is the Ride screen's own — the address's
 * built-in, tailored by the Workouts page's rule and laid out by the
 * domain's — held at its target on the ride's clock. The screen is
 * `capture-wiring.test.tsx`'s.
 */

import { describe, expect, it } from 'vitest';

import { expandWorkout, seconds, targetAt } from '@onyourleft/domain';

import { builtInRideFromQuery } from '../workouts/built-in-ride';
import { tailorFromDraft } from '../workouts/tailor';

import { CAPTURE_SCENES, type CaptureWorkoutScene } from './capture-scene';
import { CaptureWorkout } from './capture-workout';

const SCENE: CaptureWorkoutScene = {
  query: 'workout=built-in:sweet-spot-3x12&length=45&intensity=5',
  fromSeconds: 590,
  thresholdWatts: 250,
};

/** The timeline the Ride screen would ride for the same address. */
function ridden(query: string) {
  const ride = builtInRideFromQuery(query);
  if (ride === undefined) throw new Error('no built-in');
  const tailored = tailorFromDraft(ride.template, ride.draft);
  if (tailored.status !== 'tailored') throw new Error(tailored.message);
  return expandWorkout(tailored.workout);
}

describe('a capture’s workout — #3153', () => {
  it('is the workout the Ride screen’s address names, tailored as the Workouts page tailors it', () => {
    expect(new CaptureWorkout(SCENE).timeline).toEqual(ridden(SCENE.query));
    // Tailored: not the template's own plan.
    expect(new CaptureWorkout(SCENE).timeline).not.toEqual(
      ridden('workout=built-in:sweet-spot-3x12'),
    );
  });

  it('holds the target at the ride’s second, from the scene’s start in, in watts', () => {
    const workout = new CaptureWorkout(SCENE);
    const share = (at: number) => targetAt(workout.timeline, seconds(at)) ?? Number.NaN;
    expect(workout.heldWatts(0)).toBeCloseTo(share(590) * 250, 9);
    expect(workout.heldWatts(20)).toBeCloseTo(share(610) * 250, 9);
    // Ten seconds in, the warm-up gives way to the first block.
    expect(workout.blockAt(9)).toBe(0);
    expect(workout.blockAt(11)).toBe(1);
    expect(workout.heldWatts(20)).toBeGreaterThan(workout.heldWatts(0) ?? Infinity);
  });

  it('draws as a workout the trainer holds: the plan, the second, the held watts, the trace', () => {
    const workout = new CaptureWorkout(SCENE);
    workout.sample(1, 180, 130);
    workout.sample(2, 182, undefined);
    const graph = workout.graphAt(2.5);
    expect(graph.elapsedSeconds).toBe(592.5);
    expect(graph.timeline).toBe(workout.timeline);
    expect(graph.holdingWatts).toBe(Math.round(workout.heldWatts(2.5) ?? 0));
    expect(graph.thresholdWatts).toBe(250);
    expect(graph.hasControl).toBe(true);
    expect(graph.trace?.map((sample) => [sample.at, sample.power, sample.heartRate])).toEqual([
      [591, 180, 130],
      [592, 182, undefined],
    ]);
  });

  it('refuses an address that names no built-in, and a tailoring the page refuses', () => {
    expect(() => new CaptureWorkout({ ...SCENE, query: 'workout=built-in:no-such' })).toThrow(
      /names no built-in/u,
    );
    expect(
      () =>
        new CaptureWorkout({ ...SCENE, query: `${SCENE.query.split('&')[0] ?? ''}&intensity=x` }),
    ).toThrow(/cannot be tailored/u);
  });

  it('is the shipped scene’s', () => {
    expect(CAPTURE_SCENES['workout']?.workout).toEqual(SCENE);
  });
});
