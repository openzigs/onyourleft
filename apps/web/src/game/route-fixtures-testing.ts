// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Routes for the landform, the water and the settlements to be asserted over —
 * #458, #459, #460. Built from arithmetic, as every route in this repository's
 * tests is: nothing here is a real place, and ADR 0009 is not engaged.
 *
 * ⚠️ **A `-testing.ts` file, which `check-wiring.mjs` §`isTestSupport` reads as
 * test support rather than product code.** It is imported by Vitest suites and
 * by the browser harness, and by nothing that ships.
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

/** The latitude every fixture here sits at: temperate, near sea level. */
export const FIXTURE_LATITUDE = 51.5;

const METRES_PER_DEGREE_LATITUDE = 111_320;

/**
 * A straight route running due north, `length` metres long, whose elevation at
 * each metre along it is `elevation(along)`.
 *
 * North rather than east so that local `z` is route distance and `x` is the
 * lateral offset, which is the frame a reader of a failing assertion thinks in.
 */
export function northRoute(
  length: number,
  elevation: (along: number) => number,
  options: { readonly loop?: boolean } = {},
): RouteProfile {
  const points: RoutePoint[] = [];
  for (let along = 0; along <= length + 1e-9; along += 10) {
    points.push({
      position: geographicPosition(
        degreesLatitude(FIXTURE_LATITUDE + along / METRES_PER_DEGREE_LATITUDE),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(elevation(along)),
    });
  }
  return routeProfile(points, { loop: options.loop ?? false });
}

/**
 * #458's own fixture: 300 m level, a **10 % climb** of 500 m, a **10 % descent**
 * of 500 m, and 500 m level again. The climb is from 300 m to 800 m and the
 * descent from 800 m to 1 300 m.
 */
export function hillRoute(): RouteProfile {
  return northRoute(1_800, (along) => {
    if (along <= 300) return 0;
    if (along <= 800) return (along - 300) * 0.1;
    if (along <= 1_300) return 50 - (along - 800) * 0.1;
    return 0;
  });
}

/**
 * #459's own fixture: a road that descends 30 m into a valley and climbs out of
 * it again, the floor at **1 000 m**, on a 3 km route that is level at both
 * ends.
 */
export function valleyRoute(): RouteProfile {
  return northRoute(3_000, (along) => {
    if (along <= 400) return 30;
    if (along <= 1_000) return 30 - ((along - 400) / 600) * 30;
    if (along <= 1_600) return ((along - 1_000) / 600) * 30;
    return 30;
  });
}

/**
 * A valley with a level floor 40 m wide and 12 % walls — #501's review. Its
 * floor meets its walls 20 m either side of the stream, inside a bridge's
 * approach (`waterways.ts` §`BRIDGE_HALF_SPAN_METRES` to
 * §`CHANNEL_BANK_METRES`), which is where an approach piece spans a bend.
 */
export function flatFloorValleyRoute(): RouteProfile {
  return northRoute(2_000, (along) =>
    Math.min(30, Math.max(0, Math.abs(along - 1_000) - 20) * 0.12),
  );
}

/**
 * #459's lake fixture: a road that drops 30 m onto a **kilometre of level
 * valley floor** from 700 m to 1 700 m and climbs out again — a flat, low,
 * enclosed stretch, which is where a lake lies. The descents are too long and
 * gentle, and the floor too wide, for a stream crossing: its lowest point is a
 * kilometre wide rather than a point.
 */
export function lakeValleyRoute(): RouteProfile {
  return northRoute(2_600, (along) => {
    if (along <= 400) return 30;
    if (along <= 700) return 30 - ((along - 400) / 300) * 30;
    if (along <= 1_700) return 0;
    if (along <= 2_000) return ((along - 1_700) / 300) * 30;
    return 30;
  });
}

/**
 * Rolling road: a smooth rise and fall of 12 m every 600 m, so the steepest is
 * about 12.6 % and there is no kink anywhere — the kind of profile a real
 * route's despiked grid actually is, where {@link hillRoute}'s corners are the
 * worst case a grid can hold.
 */
export function rollingRoute(): RouteProfile {
  return northRoute(3_000, (along) => 12 * Math.sin((along / 600) * Math.PI * 2));
}

/** A route that climbs steadily the whole way: no valley floor, nothing flat. */
export function steadyClimb(): RouteProfile {
  return northRoute(3_000, (along) => along * 0.06);
}

/**
 * A closed circuit of a given radius — a route that bends everywhere and
 * wraps — with a gentle rise and fall so that a height is never trivially
 * zero.
 */
export function circuitRoute(radius: number, elevation?: (along: number) => number): RouteProfile {
  const metresPerDegreeLongitude =
    METRES_PER_DEGREE_LATITUDE * Math.cos((FIXTURE_LATITUDE * Math.PI) / 180);
  const circumference = 2 * Math.PI * radius;
  const steps = Math.max(24, Math.round(circumference / 10));
  const height =
    elevation ?? ((along: number) => 8 * Math.sin((along / circumference) * Math.PI * 2));
  const points: RoutePoint[] = [];
  for (let index = 0; index < steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    points.push({
      position: geographicPosition(
        degreesLatitude(FIXTURE_LATITUDE + (radius * Math.sin(angle)) / METRES_PER_DEGREE_LATITUDE),
        degreesLongitude(-0.12 + (radius * (Math.cos(angle) - 1)) / metresPerDegreeLongitude),
      ),
      elevation: altitudeMetres(height((index / steps) * circumference)),
    });
  }
  points.push(points[0] as RoutePoint);
  return routeProfile(points, { loop: true });
}

/**
 * A route of straights and bends — 400 m north, a right-hand bend of `radius`
 * through 180°, 400 m south — climbing 4 % the whole way. A hairpin when the
 * radius is small.
 */
export function hairpinRoute(radius: number): RouteProfile {
  const metresPerDegreeLongitude =
    METRES_PER_DEGREE_LATITUDE * Math.cos((FIXTURE_LATITUDE * Math.PI) / 180);
  const points: RoutePoint[] = [];
  const push = (east: number, north: number, along: number): void => {
    points.push({
      position: geographicPosition(
        degreesLatitude(FIXTURE_LATITUDE + north / METRES_PER_DEGREE_LATITUDE),
        degreesLongitude(-0.12 + east / metresPerDegreeLongitude),
      ),
      elevation: altitudeMetres(along * 0.04),
    });
  };
  let along = 0;
  for (let north = 0; north < 400; north += 10) {
    push(0, north, along);
    along += 10;
  }
  const arc = Math.PI * radius;
  const steps = Math.max(6, Math.round(arc / 5));
  for (let step = 0; step <= steps; step += 1) {
    const angle = (step / steps) * Math.PI;
    push(radius * (1 - Math.cos(angle)), 400 + radius * Math.sin(angle), along);
    along += arc / steps;
  }
  for (let north = 400 - 10; north >= 0; north -= 10) {
    push(2 * radius, north, along);
    along += 10;
  }
  return routeProfile(points);
}

/**
 * An S-bend — #499: 400 m north, a right-hand bend of `radius` through 90°, a
 * left-hand bend of the same radius back through 90°, and 400 m north again,
 * level all the way. The two bends meet with no straight between them, which
 * is the case where a line has to cross the road from one apex to the other.
 */
export function sBendRoute(radius: number): RouteProfile {
  const metresPerDegreeLongitude =
    METRES_PER_DEGREE_LATITUDE * Math.cos((FIXTURE_LATITUDE * Math.PI) / 180);
  const points: RoutePoint[] = [];
  const push = (east: number, north: number): void => {
    points.push({
      position: geographicPosition(
        degreesLatitude(FIXTURE_LATITUDE + north / METRES_PER_DEGREE_LATITUDE),
        degreesLongitude(-0.12 + east / metresPerDegreeLongitude),
      ),
      elevation: altitudeMetres(0),
    });
  };
  for (let north = 0; north < 400; north += 10) {
    push(0, north);
  }
  const steps = Math.max(6, Math.round((Math.PI * radius) / 2 / 5));
  // Right: about a centre `radius` to the east, from its west point to its north.
  for (let step = 0; step < steps; step += 1) {
    const angle = (step / steps) * (Math.PI / 2);
    push(radius * (1 - Math.cos(angle)), 400 + radius * Math.sin(angle));
  }
  // Left: about a centre `radius` north of the first bend's end, from its
  // south point round to its east — heading north again.
  for (let step = 0; step <= steps; step += 1) {
    const angle = (step / steps) * (Math.PI / 2);
    push(radius + radius * Math.sin(angle), 400 + radius + radius * (1 - Math.cos(angle)));
  }
  for (let north = 10; north <= 400; north += 10) {
    push(2 * radius, 400 + 2 * radius + north);
  }
  return routeProfile(points);
}

/**
 * A stadium — #499: 400 m north, a right-hand bend of `radius` through 180°,
 * 400 m south, and a second right-hand 180° bend back to the start, as a LOOP.
 * Level. A loop whose line is not the same everywhere, so a step at the wrap
 * would show — `circuitRoute`'s constant bend puts the line at one offset all
 * the way round.
 */
export function stadiumRoute(radius: number): RouteProfile {
  const metresPerDegreeLongitude =
    METRES_PER_DEGREE_LATITUDE * Math.cos((FIXTURE_LATITUDE * Math.PI) / 180);
  const points: RoutePoint[] = [];
  const push = (east: number, north: number): void => {
    points.push({
      position: geographicPosition(
        degreesLatitude(FIXTURE_LATITUDE + north / METRES_PER_DEGREE_LATITUDE),
        degreesLongitude(-0.12 + east / metresPerDegreeLongitude),
      ),
      elevation: altitudeMetres(0),
    });
  };
  const steps = Math.max(6, Math.round((Math.PI * radius) / 5));
  for (let north = 0; north < 400; north += 10) push(0, north);
  for (let step = 0; step < steps; step += 1) {
    const angle = (step / steps) * Math.PI;
    push(radius * (1 - Math.cos(angle)), 400 + radius * Math.sin(angle));
  }
  for (let north = 400; north > 0; north -= 10) push(2 * radius, north);
  for (let step = 0; step < steps; step += 1) {
    const angle = (step / steps) * Math.PI;
    push(radius * (1 + Math.cos(angle)), -radius * Math.sin(angle));
  }
  push(0, 0);
  return routeProfile(points, { loop: true });
}

/**
 * A road the way a route planner exports it — #543.
 *
 * The road itself is smooth: 300 m north, then bends of 60 m, 30 m, 20 m and
 * 45 m radius through 90°, 120°, 100° and 70°, alternating right and left,
 * with a 150 m straight after each, level. What a planner writes is not the
 * road but a SIMPLIFICATION of it: the fewest points that stay within a few
 * metres of the line (Ramer–Douglas–Peucker, which is the textbook way to do
 * it and was implemented here from that description). At the 3 m tolerance
 * used here a 20 m bend keeps a point about every 20 m and turns about 45° at
 * each, and a straight keeps its two ends — the shape of a GPX from a
 * planner, and of the owner's 29-mile route on 2026-09-25, whose bends drew as
 * straight pieces meeting at sharp corners.
 *
 * ⚠️ **Arithmetic, not a real place** — the whole module's rule. What makes it
 * "real-world-like" is the sampling, which is what #543 is about, not a
 * coordinate anybody rode.
 */
export function plannerRoute(): RouteProfile {
  const metresPerDegreeLongitude =
    METRES_PER_DEGREE_LATITUDE * Math.cos((FIXTURE_LATITUDE * Math.PI) / 180);
  const kept = simplified(plannerRoad().road, PLANNER_TOLERANCE_METRES);
  return routeProfile(
    kept.map(([x, y]) => ({
      position: geographicPosition(
        degreesLatitude(FIXTURE_LATITUDE + y / METRES_PER_DEGREE_LATITUDE),
        degreesLongitude(-0.12 + x / metresPerDegreeLongitude),
      ),
      elevation: altitudeMetres(0),
    })),
  );
}

/** One of {@link plannerRoute}'s bends, as the smooth road it was simplified from has it. */
export interface PlannerBend {
  readonly radiusMetres: number;
  readonly degrees: number;
  /**
   * Route distance from the start to the bend's middle. Approximate by up to a
   * few metres, because simplification shortens a bend to its chords.
   */
  readonly middleMetres: number;
  /** The centre of the bend's circle, in local metres east and north of the start. */
  readonly centreEast: number;
  readonly centreNorth: number;
}

/** {@link plannerRoute}'s four bends, in the order the route rides them. */
export const PLANNER_BENDS: readonly PlannerBend[] = plannerRoad().bends;

/** The smooth road {@link plannerRoute} simplifies: a point every metre, and its bends. */
function plannerRoad(): {
  readonly road: Array<readonly [number, number]>;
  readonly bends: PlannerBend[];
} {
  const road: Array<readonly [number, number]> = [];
  const bends: PlannerBend[] = [];
  let east = 0;
  let north = 0;
  let heading = Math.PI / 2; // north, measured anticlockwise from east
  const straight = (length: number): void => {
    for (let metre = 0; metre < length; metre += 1) {
      road.push([east, north]);
      east += Math.cos(heading);
      north += Math.sin(heading);
    }
  };
  const bend = (radius: number, degrees: number, right: boolean): void => {
    const side = right ? -1 : 1;
    const length = Math.round((radius * degrees * Math.PI) / 180);
    bends.push({
      radiusMetres: radius,
      degrees,
      middleMetres: road.length + length / 2,
      // The left normal is (−sin, cos); a right-hand bend turns about the right.
      centreEast: east - side * radius * Math.sin(heading),
      centreNorth: north + side * radius * Math.cos(heading),
    });
    const turn = ((degrees * Math.PI) / 180 / length) * side;
    for (let metre = 0; metre < length; metre += 1) {
      road.push([east, north]);
      heading += turn / 2;
      east += Math.cos(heading);
      north += Math.sin(heading);
      heading += turn / 2;
    }
  };
  straight(300);
  bend(60, 90, true);
  straight(150);
  bend(30, 120, false);
  straight(150);
  bend(20, 100, true);
  straight(150);
  bend(45, 70, false);
  straight(150);
  road.push([east, north]);
  return { road, bends };
}

/** How far a planner's simplified line may stray from the road, in metres. */
const PLANNER_TOLERANCE_METRES = 3;

/** Ramer–Douglas–Peucker: the fewest points within `tolerance` of the line. */
function simplified(
  points: ReadonlyArray<readonly [number, number]>,
  tolerance: number,
): Array<readonly [number, number]> {
  if (points.length < 3) return [...points];
  const [ax, ay] = points[0] as readonly [number, number];
  const [bx, by] = points[points.length - 1] as readonly [number, number];
  const length = Math.hypot(bx - ax, by - ay);
  let furthest = 0;
  let at = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const [px, py] = points[index] as readonly [number, number];
    const distance =
      length > 0
        ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length
        : Math.hypot(px - ax, py - ay);
    if (distance > furthest) {
      furthest = distance;
      at = index;
    }
  }
  if (furthest <= tolerance) {
    return [
      points[0] as readonly [number, number],
      points[points.length - 1] as readonly [number, number],
    ];
  }
  const left = simplified(points.slice(0, at + 1), tolerance);
  const right = simplified(points.slice(at), tolerance);
  return [...left.slice(0, -1), ...right];
}
