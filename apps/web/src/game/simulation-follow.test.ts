// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The simulation on an open-world ride's road — #2982: `followRoad` hands it
 * a new view of the rolling route, and the rider's grade is read from that
 * view at ride distance minus its origin. Read back from the simulation's own
 * state, which is what the HUD, the scene and the recording read.
 */

import { describe, expect, it } from 'vitest';

import {
  RollingRoute,
  altitudeMetres,
  botPacerPlan,
  degreesCelsius,
  gradeAt,
  kilograms,
  metres,
  watts,
  type RollingEdge,
} from '@onyourleft/domain';
import { airDensityKilogramsPerCubicMetre } from '@onyourleft/physics';
import { graphOf, streetThrough } from '@onyourleft/domain/rolling-testing';

import { OpenWorldRoad } from './open-world/road';
import { GameSimulation, type RiderInput } from './simulation';

const PEDALLING: RiderInput = { power: watts(250), live: true };

/** A street climbing at 3 % for 1.2 km, then at 7 %, then flat: each stretch its own grade. */
function stepped(): RollingRoute {
  const street: RollingEdge = {
    id: 'street',
    from: 'w',
    to: 'e',
    points: streetThrough(
      [
        [0, 0],
        [1_200, 0],
        [2_600, 0],
        [9_000, 0],
      ],
      (east) => (east <= 1_200 ? east * 0.03 : east <= 2_600 ? 36 + (east - 1_200) * 0.07 : 134),
    ),
    roadClass: 1,
  };
  return new RollingRoute(graphOf([street]), street);
}

function conditions() {
  return {
    totalMass: kilograms(80),
    airDensityKilogramsPerCubicMetre: airDensityKilogramsPerCubicMetre(
      altitudeMetres(0),
      degreesCelsius(15),
    ),
  };
}

describe('the simulation follows the road it is handed — #2982', () => {
  it('reads the grade from each new view at ride distance minus its origin, past the first view', () => {
    const road = new OpenWorldRoad(stepped());
    const simulation = new GameSimulation({ profile: road.view.profile, conditions: conditions() });
    let followed = 0;
    let movedAndClimbing = 0;
    for (let ms = 0; ms <= 900_000; ms += 250) {
      simulation.advanceTo(ms, PEDALLING);
      // Every frame: the grade is the road's, read on the view at the view's distance.
      const { profile, origin } = road.view;
      const along = simulation.state.ride.distance - origin;
      expect(simulation.state.grade, `at ${ms} ms`).toBe(gradeAt(profile, metres(along)));
      if (origin > 0 && (gradeAt(profile, metres(along)) as number) > 5) movedAndClimbing += 1;
      const next = road.follow(simulation.state.ride.distance);
      if (next !== undefined) {
        simulation.followRoad(next.profile, next.origin);
        followed += 1;
      }
    }
    const { profile, origin } = road.view;
    const ridden = simulation.state.ride.distance;
    // Past the first view's 2 km, the origin moved, and the road was handed on.
    expect(ridden).toBeGreaterThan(3_000);
    expect(origin).toBeGreaterThan(1_000);
    expect(followed).toBeGreaterThan(0);
    // And the 7 % stretch was ridden on a view whose origin had moved, where
    // reading the ride distance itself would have read the 3 % below it.
    expect(movedAndClimbing).toBeGreaterThan(100);
    // The odometer is the ride's: it never jumped back to the view's distance.
    expect(ridden).toBeGreaterThan(profile.totalDistance - 2_000 + origin - 1_000);
    simulation.advanceTo(900_250, PEDALLING);
    expect(simulation.state.grade).toBe(
      gradeAt(profile, metres(simulation.state.ride.distance - origin)),
    );
  });

  it('refuses to follow a road on a ride with a pacer, whose course was built once', () => {
    const road = new OpenWorldRoad(stepped());
    const simulation = new GameSimulation({
      profile: road.view.profile,
      conditions: conditions(),
      pacer: botPacerPlan(2.5),
    });
    expect(() => {
      simulation.followRoad(road.view.profile, 0);
    }).toThrow(/pacer/);
  });

  it('is the ride it always was until a road is followed', () => {
    const road = new OpenWorldRoad(stepped());
    const simulation = new GameSimulation({ profile: road.view.profile, conditions: conditions() });
    simulation.advanceTo(0, PEDALLING);
    simulation.advanceTo(60_000, PEDALLING);
    expect(simulation.state.grade).toBe(
      gradeAt(road.view.profile, metres(simulation.state.ride.distance)),
    );
  });
});
