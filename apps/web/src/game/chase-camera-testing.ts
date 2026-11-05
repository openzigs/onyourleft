// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The chase camera as `GameView` draws it, over a ride sampled a metre at a
 * time — #545, since #1994. Test support, never shipped.
 *
 * `sceneFrame` builds an UNDAMPED camera: a function of one frame. `GameView`
 * turns it to `camera.ts` §`dampedHeading` before the renderer sees it
 * (§`turnedPose`), and while the heading lags the eye stands off the line
 * `scene.ts` §`cameraPose` keeps it on by `CAMERA_BEHIND_METRES` times the sine
 * of the lag. The near-plane rides (`near-field.test.ts`,
 * `near-field-street.test.ts`, `near-tree-fade.test.ts`) sample a frame a
 * metre at a time, and a damping stepped a metre at a time is not the one a
 * screen sees: this steps it at {@link DRAWN_CAMERA_STEPS_PER_METRE} frames a
 * metre between the sampled metres, as `GameView`'s loop does, and hands each
 * sampled frame its camera turned to the heading held there.
 *
 * ⚠️ **Between two sampled metres the camera `sceneFrame` would build is
 * rebuilt here** from the same three calls (`scene.ts` §`drawnRiderDistance`,
 * §`placedRiders`, §`cameraPose`), because a whole `sceneFrame` a 60 fps
 * frame would cost a ride its scenery eight times over. That is a second
 * copy of `sceneFrame`'s camera, so it is held to the first on every sampled
 * metre: if the two ever disagree there, the stepper throws, rather than damp
 * toward a camera nothing draws.
 */

import { dampedHeading, turnedPose, type GroundHeading } from './camera';
import type { CameraPose } from './port';
import { cameraPose, drawnRiderDistance, placedRiders, type SceneInput } from './scene';
import { roadCorridor } from './terrain';

/**
 * Frames the damping is stepped at for each metre ridden: **8**, so at the
 * rides' 8 m/s the camera is turned 64 times a second — `GameView`'s 60 fps,
 * on a step that divides a metre exactly.
 */
export const DRAWN_CAMERA_STEPS_PER_METRE = 8;

/**
 * How far back before the first sampled metre the damping starts, metres:
 * **30**, so a ride sampled from the middle of a route meets its first bend
 * with the heading already settled, as a rider who rode there would. A ride
 * from the start of a route starts where it starts.
 */
const WARM_UP_METRES = 30;

/** How far the rebuilt camera may stand from `sceneFrame`'s before the stepper says so. */
const SAME_CAMERA = 1e-9;

/** The camera `sceneFrame` builds for `input`, undamped, rebuilt from its own three calls. */
export function undampedCamera(input: SceneInput): CameraPose {
  const riderDistance = drawnRiderDistance(input);
  const corridor = roadCorridor(input.profile, input.origin, riderDistance);
  const lateral = placedRiders(input, corridor)[0]?.lateral ?? 0;
  return cameraPose(corridor, riderDistance, lateral);
}

/**
 * A stepper for one ride: hand it each sampled metre in order, with the
 * camera `sceneFrame` built there, and it returns the camera `GameView` draws
 * there — damped from the last sampled metre through the frames between them.
 *
 * `inputAt(distance)` is the ride's scene input at an odometer reading, the
 * same one the ride hands `sceneFrame`; `speed` is the rides' own, in metres a
 * second, and sets the time between two frames.
 */
export function drawnCamera(
  inputAt: (distance: number) => SceneInput,
  speed: number,
  reducedMotion = false,
): (distance: number, built: CameraPose) => CameraPose {
  let held: GroundHeading | undefined;
  let last: number | undefined;
  const step = 1 / DRAWN_CAMERA_STEPS_PER_METRE;
  const seconds = step / speed;
  return (distance, built) => {
    const rebuilt = undampedCamera(inputAt(distance));
    const apart = Math.max(
      Math.abs(rebuilt.x - built.x),
      Math.abs(rebuilt.z - built.z),
      Math.abs(rebuilt.headingX - built.headingX),
      Math.abs(rebuilt.headingZ - built.headingZ),
    );
    if (!(apart <= SAME_CAMERA)) {
      throw new Error(
        `at ${String(distance)} m the camera rebuilt for the damping is ${String(apart)} off sceneFrame's`,
      );
    }
    if (last === undefined) {
      const from = Math.max(0, distance - WARM_UP_METRES);
      held = dampedHeading(undefined, undampedCamera(inputAt(from)), seconds, reducedMotion);
      last = from;
    }
    if (distance < last) throw new Error('the drawn camera is stepped forward only');
    const steps = Math.round((distance - last) * DRAWN_CAMERA_STEPS_PER_METRE);
    for (let index = 1; index < steps; index += 1) {
      const wanted = undampedCamera(inputAt(last + index * step));
      held = dampedHeading(held, wanted, seconds, reducedMotion);
    }
    if (steps > 0) held = dampedHeading(held, built, seconds, reducedMotion);
    last = distance;
    return turnedPose(built, held ?? built);
  };
}
