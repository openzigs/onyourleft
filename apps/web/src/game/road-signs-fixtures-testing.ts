// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The route #3279's road signs are asserted over: built from arithmetic, as
 * every route in this repository's tests is — nothing here is a real place.
 *
 * ⚠️ **A `-testing.ts` file**, which `check-wiring.mjs` reads as test support.
 */

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  type RoutePoint,
  type RouteProfile,
} from '@onyourleft/domain';

import { FIXTURE_LATITUDE } from './route-fixtures-testing';

const METRES_PER_DEGREE_LATITUDE = 111_320;

/** Where {@link climbBendRoute}'s climb starts, and ends: an 8 % climb of 600 m, 48 m up. */
export const CLIMB_FOOT_METRES = 500;
export const CLIMB_TOP_METRES = 1_100;
export const CLIMB_GRADE = 0.08;

/** Where its bend starts: a 90° bend to the right of {@link BEND_RADIUS_METRES}. */
export const BEND_START_METRES = 1_700;
export const BEND_RADIUS_METRES = 30;

/**
 * #3279's acceptance fixture: 500 m level, an **8 % climb** of 600 m, then
 * level on the top — the flat stretch — and at 1 700 m one **tight bend**, 90°
 * to the right at a 30 m radius, then 1 000 m on, still level. Sampled every
 * 10 m, as a course is. `turn: 'left'` mirrors the bend.
 */
export function climbBendRoute(options: { readonly turn?: 'right' | 'left' } = {}): RouteProfile {
  const metresPerDegreeLongitude =
    METRES_PER_DEGREE_LATITUDE * Math.cos((FIXTURE_LATITUDE * Math.PI) / 180);
  const mirror = options.turn === 'left' ? -1 : 1;
  const heightAt = (along: number): number =>
    along <= CLIMB_FOOT_METRES
      ? 0
      : Math.min(along, CLIMB_TOP_METRES) * CLIMB_GRADE - CLIMB_FOOT_METRES * CLIMB_GRADE;
  const points: RoutePoint[] = [];
  let along = 0;
  let lastEast = 0;
  let lastNorth = 0;
  const push = (east: number, north: number): void => {
    along += Math.hypot(east - lastEast, north - lastNorth);
    lastEast = east;
    lastNorth = north;
    points.push({
      position: geographicPosition(
        degreesLatitude(FIXTURE_LATITUDE + north / METRES_PER_DEGREE_LATITUDE),
        degreesLongitude(-0.12 + (mirror * east) / metresPerDegreeLongitude),
      ),
      elevation: altitudeMetres(heightAt(along)),
    });
  };
  for (let north = 0; north < BEND_START_METRES; north += 10) push(0, north);
  const turn = Math.PI / 2;
  const steps = Math.max(1, Math.round((turn * BEND_RADIUS_METRES) / 10));
  for (let step = 0; step <= steps; step += 1) {
    const angle = (step / steps) * turn;
    push(
      BEND_RADIUS_METRES * (1 - Math.cos(angle)),
      BEND_START_METRES + BEND_RADIUS_METRES * Math.sin(angle),
    );
  }
  const endNorth = BEND_START_METRES + BEND_RADIUS_METRES;
  for (let leg = 10; leg <= 1_000; leg += 10) push(BEND_RADIUS_METRES + leg, endNorth);
  return routeProfile(points, { loop: false });
}

/** A route through local points `[east, north]`, metres from the fixtures' start; `height` of the distance along. */
function localRoute(
  path: readonly (readonly [number, number])[],
  height: (along: number) => number,
  loop = false,
): RouteProfile {
  const metresPerDegreeLongitude =
    METRES_PER_DEGREE_LATITUDE * Math.cos((FIXTURE_LATITUDE * Math.PI) / 180);
  let along = 0;
  let last = path[0] ?? [0, 0];
  const points: RoutePoint[] = path.map(([east, north]) => {
    along += Math.hypot(east - last[0], north - last[1]);
    last = [east, north];
    return {
      position: geographicPosition(
        degreesLatitude(FIXTURE_LATITUDE + north / METRES_PER_DEGREE_LATITUDE),
        degreesLongitude(-0.12 + east / metresPerDegreeLongitude),
      ),
      elevation: altitudeMetres(height(along)),
    };
  });
  return routeProfile(points, { loop });
}

/**
 * A mountain road of switchbacks: eight legs of 150 m east and west, joined
 * by half-circles of 20 m radius, climbing at 6 % all the way.
 */
export function switchbacks(): RouteProfile {
  const radius = 20;
  const leg = 150;
  const path: [number, number][] = [];
  let north = 0;
  for (let index = 0; index < 8; index += 1) {
    const east = index % 2 === 0;
    for (let step = 0; step < leg; step += 10) path.push([east ? step : leg - step, north]);
    const turnAt = east ? leg : 0;
    for (let k = 0; k < 6; k += 1) {
      const angle = (k / 6) * Math.PI;
      path.push([
        turnAt + (east ? 1 : -1) * radius * Math.sin(angle),
        north + radius - radius * Math.cos(angle),
      ]);
    }
    north += 2 * radius;
  }
  return localRoute(path, (along) => along * 0.06);
}

/**
 * A loop: 600 m north climbing 8 % from 100 m to 500 m, a hairpin of 30 m
 * radius, 600 m back south on the level, and a hairpin home.
 */
export function climbLoop(): RouteProfile {
  const path: [number, number][] = [];
  for (let north = 0; north < 600; north += 10) path.push([0, north]);
  for (let k = 0; k <= 12; k += 1) {
    const angle = (k / 12) * Math.PI;
    path.push([30 - 30 * Math.cos(angle), 600 + 30 * Math.sin(angle)]);
  }
  for (let north = 590; north >= 0; north -= 10) path.push([60, north]);
  for (let k = 1; k < 12; k += 1) {
    const angle = (k / 12) * Math.PI;
    path.push([30 + 30 * Math.cos(angle), -30 * Math.sin(angle)]);
  }
  path.push([0, 0]);
  return localRoute(
    path,
    (along) => (along < 100 ? 0 : along < 500 ? (along - 100) * 0.08 : 32),
    true,
  );
}

/**
 * An out-and-back up a hill: 800 m north, climbing 8 % from 300 m, a hairpin
 * of 4 m radius to the right, and back down the other way 8 m east of the
 * way up — so the verge on the right of the way up is the other leg's
 * carriageway.
 */
export function narrowHairpin(): RouteProfile {
  const path: [number, number][] = [];
  for (let north = 0; north <= 800; north += 10) path.push([0, north]);
  for (let k = 1; k < 6; k += 1) {
    const angle = (k / 6) * Math.PI;
    path.push([4 - 4 * Math.cos(angle), 800 + 4 * Math.sin(angle)]);
  }
  for (let north = 800; north >= 0; north -= 10) path.push([8, north]);
  return localRoute(path, (along) =>
    along < 300 ? 0 : along < 800 ? (along - 300) * 0.08 : Math.max(0, 40 - (along - 813) * 0.08),
  );
}

/**
 * A valley whose floor is the foot of a climb: level, down 5 % into it — too
 * gentle to sign — and straight up the other side at 9 %, so the climb's
 * sign would stand where the stream along the floor crosses the road.
 */
export function streamAtTheFoot(): RouteProfile {
  const path: [number, number][] = [];
  for (let north = 0; north <= 3_000; north += 10) path.push([0, north]);
  return localRoute(path, (along) =>
    along <= 400
      ? 30
      : along <= 1_000
        ? 30 - (along - 400) * 0.05
        : Math.min(54, (along - 1_000) * 0.09),
  );
}
