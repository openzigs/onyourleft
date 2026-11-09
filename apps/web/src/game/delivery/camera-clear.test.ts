// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { CAMERA_BEHIND_METRES, NEAR_PLANE_METRES } from '../camera';

import {
  CAMERA_BEHIND_RIDER_METRES,
  CAMERA_CAR_CLEARANCE_METRES,
  CAMERA_CAR_EASE_METRES,
  CAMERA_NEAR_PLANE_METRES,
  eyeLateralBesideParkedCars,
} from './camera-clear';
import { LANE_OFFSETS_METRES } from './steer';
import { OBSTACLE_KINDS, parkedCarStands, type Obstacle } from './obstacles';

const CAR = OBSTACLE_KINDS['parked-car'];
const AT = 200;
const RIGHT_LANE = LANE_OFFSETS_METRES.at(-1) as number;
const LEFT_LANE = LANE_OFFSETS_METRES[0] as number;

/** The rider's distance along the route, every 5 cm from 20 m before the car to 20 m past it. */
const SWEEP: readonly number[] = Array.from({ length: 801 }, (_, index) => AT - 20 + index * 0.05);

/** The eye is level with the car, or near enough that its near plane reaches it. */
function eyeBeside(riderAlong: number): boolean {
  const eye = riderAlong - CAMERA_BEHIND_RIDER_METRES;
  return eye + CAMERA_NEAR_PLANE_METRES >= AT - CAR.halfLength && eye <= AT + CAR.halfLength;
}

describe('the chase camera’s eye beside a parked car — #2396', () => {
  it('restates the camera’s distance behind and its near plane, which camera.ts owns', () => {
    expect(CAMERA_BEHIND_RIDER_METRES).toBe(CAMERA_BEHIND_METRES);
    expect(CAMERA_NEAR_PLANE_METRES).toBe(NEAR_PLANE_METRES);
  });

  it('stands behind the rider with no parked car, and with a bin, a trolley or a cone in their lane', () => {
    const small: Obstacle[] = (['bin', 'trolley', 'cone'] as const).map((kind, index) => ({
      kind,
      along: AT + index,
      stands: RIGHT_LANE,
    }));
    for (const along of SWEEP) {
      expect(eyeLateralBesideParkedCars([], along, RIGHT_LANE)).toBe(RIGHT_LANE);
      expect(eyeLateralBesideParkedCars(small, along, RIGHT_LANE)).toBe(RIGHT_LANE);
    }
  });

  for (const side of ['right', 'left'] as const) {
    it(`keeps the eye ${String(CAMERA_CAR_CLEARANCE_METRES)} m off a car at the ${side}-hand kerb all the while it is beside it, a rider in the car’s lane`, () => {
      const stands = parkedCarStands(side);
      const car: Obstacle[] = [{ kind: 'parked-car', along: AT, stands }];
      const lane = side === 'right' ? RIGHT_LANE : LEFT_LANE;
      let beside = 0;
      for (const along of SWEEP) {
        const eye = eyeLateralBesideParkedCars(car, along, lane);
        if (!eyeBeside(along)) continue;
        beside += 1;
        // Its road side, and the eye at least the clearance inside it.
        expect(Math.abs(stands - eye) - CAR.halfWidth).toBeGreaterThanOrEqual(
          CAMERA_CAR_CLEARANCE_METRES - 1e-9,
        );
      }
      expect(beside).toBeGreaterThan(50);
    });
  }

  it('leaves the eye behind the rider before and after the car, and a rider a lane away from it', () => {
    const car: Obstacle[] = [{ kind: 'parked-car', along: AT, stands: parkedCarStands('right') }];
    const reach = CAR.halfLength + CAMERA_NEAR_PLANE_METRES + CAMERA_CAR_EASE_METRES;
    for (const along of SWEEP) {
      const eye = along - CAMERA_BEHIND_RIDER_METRES;
      if (eye < AT - reach || eye > AT + CAR.halfLength + CAMERA_CAR_EASE_METRES) {
        expect(eyeLateralBesideParkedCars(car, along, RIGHT_LANE)).toBe(RIGHT_LANE);
      }
      // The middle of the road is already the clearance off a kerb car.
      expect(eyeLateralBesideParkedCars(car, along, 0)).toBe(0);
    }
  });

  it('never jumps: from one 5 cm step of the ride to the next the eye moves under 7 cm across', () => {
    const car: Obstacle[] = [{ kind: 'parked-car', along: AT, stands: parkedCarStands('right') }];
    let last = eyeLateralBesideParkedCars(car, SWEEP[0] as number, RIGHT_LANE);
    let most = 0;
    for (const along of SWEEP) {
      const eye = eyeLateralBesideParkedCars(car, along, RIGHT_LANE);
      most = Math.max(most, Math.abs(eye - last));
      last = eye;
    }
    expect(most).toBeGreaterThan(0);
    expect(most).toBeLessThan(0.07);
  });
});
