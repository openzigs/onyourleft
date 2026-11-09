// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where the chase camera's eye stands across the road beside a parked car —
 * #2396, the owner's comment of 2026-11-09 on #2378's round-5 screenshots:
 * "the camera must not clip into an obstacle".
 *
 * The chase camera stands {@link CAMERA_BEHIND_RIDER_METRES} behind the rider
 * and follows them across the road (`scene.ts` §`cameraPose`, #499). A rider
 * who passes a parked car in the next lane, or who is drawn clear of one they
 * rode into (`obstacles.ts` §`clearOfParkedCars`), eases back into the car's
 * lane as soon as their own bicycle is past its front — and the camera, 4.5 m
 * behind, is then still beside the car, so it moves into the car's body: a
 * block of car colour fills the bottom of the frame. The rider has done
 * nothing wrong, so the RIDER is not moved: only the eye is.
 *
 * {@link eyeLateralBesideParkedCars} keeps the eye at least
 * {@link CAMERA_CAR_CLEARANCE_METRES} inside the road side of every parked car
 * it is alongside, eased in and out over {@link CAMERA_CAR_EASE_METRES} of the
 * eye's own travel, so it never jumps. Everywhere else it is the rider's own
 * lateral, which is exactly what the camera did before. The camera still
 * looks at the road on the rider's line (`scene.ts` §`cameraPose`), so the
 * rider stays in the frame, a little to one side, for the moment it takes the
 * eye to pass the car.
 *
 * ## A drawing, and nothing else
 *
 * The eye's place decides nothing: no crash, no score, no grade. This module
 * imports only `obstacles.ts`' types and footprints, and
 * `delivery-cannot-reach-trainer.test.ts` holds that for the whole folder
 * (ADR 0059 D-2). The camera's distance behind is written here, not imported,
 * and the test pins it to `camera.ts`, for `obstacles.ts`' reason: that module
 * imports `bicycle.ts`, and this one may reach nothing it does not need.
 *
 * Nothing here formats a position into a string (CLAUDE.md §6, ADR 0004 D).
 */

import { OBSTACLE_KINDS, type Obstacle } from './obstacles';

/** How far behind the rider the chase camera's eye stands, metres: `camera.ts` §`CAMERA_BEHIND_METRES`, pinned by the test. */
export const CAMERA_BEHIND_RIDER_METRES = 4.5;

/**
 * How far in front of the eye nothing is drawn, metres: `camera.ts`
 * §`NEAR_PLANE_METRES`, pinned by the test. The eye is held clear from this
 * far behind a car's back, so the near plane never reaches into it.
 */
export const CAMERA_NEAR_PLANE_METRES = 0.5;

/**
 * The least distance from the eye to a parked car's road side, metres:
 * **1**, this project's own number. Past the near plane's half width at every
 * frame a device draws up to 21 : 9 (0.82 m), and enough that the car's side
 * stands at the edge of the frame rather than across its bottom.
 */
export const CAMERA_CAR_CLEARANCE_METRES = 1;

/**
 * How far the eye travels while it moves aside for a car, and back after it,
 * metres: **3**, a third of a second at 9 m/s. This project's own number.
 */
export const CAMERA_CAR_EASE_METRES = 3;

/** 0 below `from`, 1 above `to`, smooth between. */
function smoothStep(from: number, to: number, at: number): number {
  const share = Math.min(1, Math.max(0, (at - from) / (to - from)));
  return share * share * (3 - 2 * share);
}

/**
 * The eye's lateral offset, in metres right of the centre line, for a rider
 * `riderAlong` metres along the route drawn `riderLateral` metres right of it:
 * the rider's own, moved off any parked car the eye is alongside. @see the header
 */
export function eyeLateralBesideParkedCars(
  obstacles: readonly Obstacle[],
  riderAlong: number,
  riderLateral: number,
): number {
  const eyeAlong = riderAlong - CAMERA_BEHIND_RIDER_METRES;
  let lateral = riderLateral;
  for (const obstacle of obstacles) {
    if (obstacle.kind !== 'parked-car' || obstacle.stands === undefined) continue;
    const { halfLength, halfWidth } = OBSTACLE_KINDS[obstacle.kind];
    const back = obstacle.along - halfLength - CAMERA_NEAR_PLANE_METRES;
    const front = obstacle.along + halfLength;
    const beside =
      smoothStep(back - CAMERA_CAR_EASE_METRES, back, eyeAlong) *
      (1 - smoothStep(front, front + CAMERA_CAR_EASE_METRES, eyeAlong));
    if (beside === 0) continue;
    // The car's road side, and the eye's limit that far inside it.
    const onTheRight = obstacle.stands > 0;
    const limit = onTheRight
      ? obstacle.stands - halfWidth - CAMERA_CAR_CLEARANCE_METRES
      : obstacle.stands + halfWidth + CAMERA_CAR_CLEARANCE_METRES;
    const over = onTheRight ? Math.max(0, lateral - limit) : Math.min(0, lateral - limit);
    lateral -= beside * over;
  }
  return lateral;
}
