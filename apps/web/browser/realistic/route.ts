// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The stretch of road the owner's realistic page rides — #457's, kept for #430.
 *
 * Not a recorded ride: there is none in this repository, and a GPX of
 * somebody's own road is location data (SECURITY.md). It is a route drawn
 * through the product's OWN world generators — `landform.ts`, `waterways.ts`
 * and `settlements.ts`, which #468 added — so the realistic world sits in exactly
 * the world the product draws: a valley the road descends into, a level floor
 * long and low enough for `waterways.ts` to put a lake beside it, and level
 * stretches for `settlements.ts` to build on. It meanders, because a straight
 * road seen from the chase camera is lit from one side for the whole run and
 * hides what an environment map does.
 *
 * Latitude 51.5°, the fixtures' latitude, for the same sun.
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

const LATITUDE = 51.5;
const METRES_PER_DEGREE = 111_320;

/** How long the route is. Long enough for a 30 s run at 9 m/s never to reach its end. */
export const ROUTE_METRES = 4_000;

/**
 * The route's elevation: down 30 m into a valley with a level floor (where
 * `waterways.ts` may lay a lake and `settlements.ts` a farmstead), up again,
 * and then a 12 m V-shaped dip — a stream crossing, which is what makes
 * `waterways.ts` build a bridge.
 */
export function realisticElevation(along: number): number {
  if (along <= 500) return 30;
  if (along <= 800) return 30 - ((along - 500) / 300) * 30;
  if (along <= 1_900) return 0;
  if (along <= 2_300) return ((along - 1_900) / 400) * 30;
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

/** The route, as the product profiles it. */
export function realisticRoute(): RouteProfile {
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
  return routeProfile(points);
}
