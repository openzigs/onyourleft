// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A built-in workout ridden in a capture — #3153, epic #3151.
 *
 * A rider's workout runs on the Ride screen's controller and reaches the game
 * through the trainer port (`trainer-port.ts` §`runningWorkout`). A capture
 * has no trainer port (`GameView.tsx` §`useSimulatedRide`), so this is its
 * trainer: the workout the Ride screen's own address names
 * (`workouts/built-in-ride.ts` §`builtInRideFromQuery`), tailored by the
 * Workouts page's own rule (`workouts/tailor.ts` §`tailorFromDraft`) and laid
 * out by the domain's (`expandWorkout`), held at its ERG target on the ride's
 * clock. It writes to nothing: what it holds is read back as the rider's
 * power (`capture-scene.ts` §`CaptureSensors`), as an ERG trainer makes it,
 * and drawn by the HUD's `WorkoutStrip` from {@link CaptureWorkout.graphAt}.
 */

import {
  expandWorkout,
  seconds,
  segmentAt,
  targetAt,
  type WorkoutTimeline,
} from '@onyourleft/domain';

import type { WorkoutGraphInput, WorkoutTraceSample } from '../workout/workout-graph';
import { withTraceSample } from '../workout/workout-graph';
import { builtInRideFromQuery } from '../workouts/built-in-ride';
import { tailorFromDraft } from '../workouts/tailor';

import type { CaptureWorkoutScene } from './capture-scene';

/** A scene's workout, held at its target from {@link CaptureWorkoutScene.fromSeconds} in. */
export class CaptureWorkout {
  readonly timeline: WorkoutTimeline;
  readonly #scene: CaptureWorkoutScene;
  #trace: readonly WorkoutTraceSample[] = [];

  /** @throws {Error} for an address that names no built-in, or a tailoring it refuses. */
  constructor(scene: CaptureWorkoutScene) {
    const ride = builtInRideFromQuery(scene.query);
    if (ride === undefined) throw new Error('capture: the workout names no built-in workout');
    const tailored = tailorFromDraft(ride.template, ride.draft);
    if (tailored.status !== 'tailored') {
      throw new Error(`capture: the workout cannot be tailored: ${tailored.message}`);
    }
    this.timeline = expandWorkout(tailored.workout);
    this.#scene = scene;
  }

  /** The workout's own second at `rideSecond` of the ride. */
  #at(rideSecond: number): number {
    return this.#scene.fromSeconds + Math.max(0, rideSecond);
  }

  /** What the trainer holds at `rideSecond`, in watts, or `undefined` with no target. */
  heldWatts(rideSecond: number): number | undefined {
    const share = targetAt(this.timeline, seconds(this.#at(rideSecond)));
    return share === undefined ? undefined : share * this.#scene.thresholdWatts;
  }

  /** The block ridden at `rideSecond`, or `undefined` past the end. */
  blockAt(rideSecond: number): number | undefined {
    return segmentAt(this.timeline, seconds(this.#at(rideSecond)))?.block;
  }

  /** Keep a whole second's reading for the strip's trace. */
  sample(rideSecond: number, power: number | undefined, heartRate: number | undefined): void {
    const held = this.heldWatts(rideSecond);
    this.#trace = withTraceSample(this.#trace, {
      at: this.#at(rideSecond),
      target: held,
      power,
      heartRate,
      range: undefined,
    });
  }

  /** What `WorkoutStrip` draws at `rideSecond`: control held, and the target confirmed. */
  graphAt(rideSecond: number): WorkoutGraphInput {
    const held = this.heldWatts(rideSecond);
    return {
      elapsedSeconds: this.#at(rideSecond),
      timeline: this.timeline,
      holdingWatts: held === undefined ? undefined : Math.round(held),
      thresholdWatts: this.#scene.thresholdWatts,
      trace: this.#trace,
      status: 'running',
      hasControl: true,
      targetConfirmed: true,
    };
  }
}
