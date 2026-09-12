// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The route fixtures the game's tests share.
 *
 * ⚠️ **The loop is here rather than inside one test file, and that is the whole
 * point of #253.** Every route fixture the pacer work built was
 * point-to-point — `routeProfile` defaults `loop` to `false` — so the case the
 * unwrapped odometer exists for, a rider or a bot going round more than once,
 * was exercised nowhere and a placement bug survived a green suite. A fixture
 * that lives in one file is a fixture the next test file writes again as a
 * straight line, which is how that happened.
 *
 * Nothing here is a test double: these are real {@link routeProfile}s built
 * from real coordinates, so a test that uses one is testing the same profile
 * maths a rider's imported GPX produces.
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

/** Where the fixtures are placed on the globe. Arbitrary, and the same for all of them. */
const HOME_LATITUDE = 51.5;
const HOME_LONGITUDE = -0.12;
const METRES_PER_DEGREE_LATITUDE = 111_320;
const METRES_PER_DEGREE_LONGITUDE =
  METRES_PER_DEGREE_LATITUDE * Math.cos((HOME_LATITUDE * Math.PI) / 180);

/** A position this many metres north and east of the fixtures' shared origin. */
function at(northMetres: number, eastMetres: number): RoutePoint['position'] {
  return geographicPosition(
    degreesLatitude(HOME_LATITUDE + northMetres / METRES_PER_DEGREE_LATITUDE),
    degreesLongitude(HOME_LONGITUDE + eastMetres / METRES_PER_DEGREE_LONGITUDE),
  );
}

/** How long each side of {@link squareLoopProfile} is, in metres. */
export const LOOP_SIDE_METRES = 400;

/**
 * A closed square loop: four 400 m sides, flat, ending where it started.
 *
 * Square rather than circular so a projection bug that dropped an axis leaves a
 * straight road rather than a plausible curve, and closed so
 * `routeProfile(…, { loop: true })` accepts it — a route whose ends are more
 * than `LOOP_CLOSURE_METRES` apart is refused as not a loop, which is the first
 * thing a hand-built loop fixture gets wrong.
 */
export function squareLoopProfile(): RouteProfile {
  const spacing = 10;
  const corners: readonly (readonly [number, number])[] = [
    [0, 0],
    [0, LOOP_SIDE_METRES],
    [LOOP_SIDE_METRES, LOOP_SIDE_METRES],
    [LOOP_SIDE_METRES, 0],
  ];
  const points: RoutePoint[] = [];
  for (let leg = 0; leg < corners.length; leg += 1) {
    const from = corners[leg] as readonly [number, number];
    const to = corners[(leg + 1) % corners.length] as readonly [number, number];
    const steps = LOOP_SIDE_METRES / spacing;
    for (let step = 0; step < steps; step += 1) {
      points.push({
        position: at(
          from[0] + ((to[0] - from[0]) * step) / steps,
          from[1] + ((to[1] - from[1]) * step) / steps,
        ),
        elevation: altitudeMetres(0),
      });
    }
  }
  // The closing point, so the loop's two ends are in the same place rather than
  // one spacing apart.
  points.push({ position: at(0, 0), elevation: altitudeMetres(0) });
  return routeProfile(points, { loop: true });
}
