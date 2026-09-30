// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The stretch of road the owner's realistic page rides — #457's, kept for #430.
 *
 * Not a recorded ride: there is none in this repository, and a GPX of
 * somebody's own road is location data (SECURITY.md). It is a route drawn
 * through the product's OWN world generators — `landform.ts`, `waterways.ts`
 * and `settlements.ts`, which #468 added — so the realistic world sits in exactly
 * the world the product draws: a valley the road descends into, a level floor
 * long and low enough that `waterways.ts` DOES put a lake beside it, a climb
 * out of it gentle enough to be farmed and steep enough that `settlements.ts`
 * walls its fields in stone, and level stretches to build on. It meanders, because a straight
 * road seen from the chase camera is lit from one side for the whole run and
 * hides what an environment map does.
 *
 * Latitude 51.5°, the fixtures' latitude, for the same sun.
 *
 * ## Which way it faces — #702
 *
 * The sun stands at one azimuth in every world (`world.ts`
 * §`SUN_AZIMUTH_DEGREES`, 225°, the south-west), and this route meanders
 * ±25° about due north — so every frame it holds looks **110° to 160° away
 * from the sun**, and the sun's side of the sky, of the fog and of every lit
 * tree is behind the rider for the whole soak. {@link Facing} turns the WHOLE
 * route about its first point, which is what `?facing=` on the page asks for:
 * `sun` so it meanders about the sun's own azimuth, `away` so it meanders
 * about the opposite one. Absent, it is not turned at all and not one
 * coordinate moves — `route.test.ts` pins its digest, because the Part Z steps
 * and the Part AH triangle and draw-call rows were all taken on it.
 *
 * ⚠️ **The route turns, not the sun**: the renderer, the sun and the product
 * are untouched, and a turned route is the same road — the same elevations,
 * the same seed (`scatter.ts` §`scatterSeed` reads the first point and the
 * length, which a turn about the first point keeps), and so the same valley,
 * lake, bridge and walls, which `route.test.ts` holds for each facing.
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

import { SUN_AZIMUTH_DEGREES } from '../../src/game/world';

const LATITUDE = 51.5;
const METRES_PER_DEGREE = 111_320;

/** How long the route is. Long enough for a 30 s run at 9 m/s never to reach its end. */
export const ROUTE_METRES = 4_000;

/**
 * The route's elevation: down 30 m into a valley with a level floor, up again
 * at 5 %, and then a 12 m V-shaped dip — a stream crossing, which is what
 * makes `waterways.ts` build a bridge.
 *
 * ⚠️ **Every one of those is a Part Z step, and `route.test.ts` holds the route
 * to all of them** — #501. Until then this comment said the floor was where
 * `waterways.ts` *"may lay a lake"*, and it laid none: a lake is seeded per
 * stretch at `LAKE_CHANCE`, and both of this floor's stretches said no, so
 * Z10's lake could not be judged on the page Part Z sends the owner to. Nor
 * could Z9's stone walls: `settlements.ts` walls a field in stone on ground
 * steeper than `WALL_GRADE_PERCENT` (4 %) but still farmed (no steeper than
 * `FIELD_GRADE_PERCENT`, 6 %), and the climb out was 7.5 %. So the climb is
 * 5 % over 600 m, and the descent ends at 780 m rather than 800 m, which is
 * where this route’s seed lays one. Both
 * are this route's own arithmetic, not a measurement of anywhere.
 */
export function realisticElevation(along: number): number {
  if (along <= 500) return 30;
  if (along <= 780) return 30 - ((along - 500) / 280) * 30;
  if (along <= 1_900) return 0;
  if (along <= 2_500) return ((along - 1_900) / 600) * 30;
  if (along <= 2_700) return 30;
  if (along <= 2_850) return 30 - ((along - 2_700) / 150) * 12;
  if (along <= 3_000) return 18 + ((along - 2_850) / 150) * 12;
  return 30;
}

/**
 * The heading, radians east of north, at a distance: a gentle meander of
 * ±25° over about 700 m, so bends are sweeping rather than hairpins.
 */
export function realisticHeading(along: number): number {
  return 0.45 * Math.sin((along / 700) * Math.PI * 2);
}

/** Which way `?facing=` holds the route: towards the sun, or directly away from it — #702. */
export type Facing = 'sun' | 'away';

/**
 * How far the whole route is turned for a facing, radians clockwise from
 * north: the sun's azimuth for `sun`, the opposite one for `away`, so the
 * route's mean heading — due north, unturned — points there.
 */
export function facingTurn(facing: Facing): number {
  const degrees = facing === 'sun' ? SUN_AZIMUTH_DEGREES : SUN_AZIMUTH_DEGREES - 180;
  return (degrees * Math.PI) / 180;
}

/**
 * The route, as the product profiles it — turned to `facing` if one is given,
 * and otherwise exactly the route every Part Z and Part AH row was taken on.
 */
export function realisticRoute(facing?: Facing): RouteProfile {
  const points: RoutePoint[] = [];
  let east = 0;
  let north = 0;
  const step = 10;
  const perLongitude = METRES_PER_DEGREE * Math.cos((LATITUDE * Math.PI) / 180);
  for (let along = 0; along <= ROUTE_METRES; along += step) {
    points.push({
      position: geographicPosition(
        degreesLatitude(LATITUDE + north / METRES_PER_DEGREE),
        degreesLongitude(-0.12 + east / perLongitude),
      ),
      elevation: altitudeMetres(realisticElevation(along)),
    });
    const heading = realisticHeading(along + step / 2);
    east += Math.sin(heading) * step;
    north += Math.cos(heading) * step;
  }
  return routeProfile(facing === undefined ? points : turned(points, facingTurn(facing)));
}

/**
 * `points` turned clockwise, seen from above, by `radians` about the first of
 * them — a rotation of the SPHERE about the axis through that point and the
 * Earth's centre, which moves no point's distance from any other.
 *
 * ⚠️ Not the meander's heading plus a turn, which was tried first: this
 * route's steps are laid out with one metres-per-degree of longitude, so the
 * same steps pointed another way are a few metres longer or shorter over
 * 4 km, the length rounds to another metre, `scatter.ts` §`scatterSeed` is
 * another seed, and the lake moved 150 m and its wet shore left the frames
 * Part Z holds — `route.test.ts` caught it. A rotation of the sphere keeps
 * every distance, so the profile, the seed and the world beside the road are
 * the unturned route's, turned.
 */
function turned(points: readonly RoutePoint[], radians: number): RoutePoint[] {
  const first = points[0];
  if (first === undefined) return [];
  const axis = unit(first.position.latitude, first.position.longitude);
  // Clockwise seen from outside the sphere is a negative right-handed turn.
  const cos = Math.cos(-radians);
  const sin = Math.sin(-radians);
  return points.map((point) => {
    const v = unit(point.position.latitude, point.position.longitude);
    const dot = axis[0] * v[0] + axis[1] * v[1] + axis[2] * v[2];
    const cross = [
      axis[1] * v[2] - axis[2] * v[1],
      axis[2] * v[0] - axis[0] * v[2],
      axis[0] * v[1] - axis[1] * v[0],
    ] as const;
    // Rodrigues' rotation formula.
    const r = [0, 1, 2].map(
      (i) =>
        (v[i] as number) * cos + (cross[i] as number) * sin + (axis[i] as number) * dot * (1 - cos),
    ) as [number, number, number];
    return {
      position: geographicPosition(
        degreesLatitude((Math.asin(Math.max(-1, Math.min(1, r[2]))) * 180) / Math.PI),
        degreesLongitude((Math.atan2(r[1], r[0]) * 180) / Math.PI),
      ),
      elevation: point.elevation,
    };
  });
}

/** The unit vector to a latitude and longitude, in degrees. */
function unit(latitude: number, longitude: number): readonly [number, number, number] {
  const phi = (latitude * Math.PI) / 180;
  const lambda = (longitude * Math.PI) / 180;
  return [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
}
