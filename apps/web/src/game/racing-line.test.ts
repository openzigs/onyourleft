// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The racing line and the lean — #499.
 *
 * Every curvature here is measured by this file's own arithmetic from the
 * profile's positions, not read back from `RacingLine.curvatures`, so a line
 * that was wrong and a curvature table that agreed with it could not pass
 * together.
 */

import { describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  type RoutePoint,
  type RouteProfile,
} from '@onyourleft/domain';

import {
  LINE_LIMIT_METRES,
  MAXIMUM_LEAN_RADIANS,
  MAXIMUM_ROLL_RADIANS_PER_METRE,
  leanAt,
  lineOffsetAt,
  racingLine,
  solvedLine,
  steadyTurnLean,
} from './racing-line';
import {
  circuitRoute,
  hairpinRoute,
  hillRoute,
  northRoute,
  sBendRoute,
  stadiumRoute,
  valleyRoute,
} from './route-fixtures-testing';
import { ROAD_WIDTH_METRES, corridorOrigin, localGroundPosition } from './terrain';

const DEGREES = Math.PI / 180;

/** The hairpin every "it is a racing line" case rides: 20 m, a hairpin a road has. */
const HAIRPIN_RADIUS = 20;
const hairpin = hairpinRoute(HAIRPIN_RADIUS);
/** Where the hairpin's bend starts, and how long it is. @see hairpinRoute */
const BEND_START = 400;
const BEND_LENGTH = Math.PI * HAIRPIN_RADIUS;

/** The S-bend: 30 m each way. Its first bend is right-handed, its second left. */
const S_RADIUS = 30;
const sBend = sBendRoute(S_RADIUS);
const QUARTER = (Math.PI * S_RADIUS) / 2;

/**
 * The signed curvature of a path through the profile's samples, each moved
 * `offsets[i]` along the centreline's own left normal — this test's own
 * reading of what `racing-line.ts` computes, so the two are independent.
 */
function curvaturesOf(profile: RouteProfile, offsets: ArrayLike<number>): number[] {
  const origin = corridorOrigin(profile);
  const centre = profile.positions.map((position) => localGroundPosition(origin, position));
  const count = centre.length;
  const points = centre.map((here, index) => {
    const before = centre[Math.max(0, index - 1)] ?? here;
    const after = centre[Math.min(count - 1, index + 1)] ?? here;
    const dx = after.x - before.x;
    const dz = after.z - before.z;
    const length = Math.hypot(dx, dz);
    const offset = offsets[index] ?? 0;
    return { x: here.x + (offset * -dz) / length, z: here.z + (offset * dx) / length };
  });
  const found: number[] = [];
  for (let index = 1; index < count - 1; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const c = points[index + 1];
    if (a === undefined || b === undefined || c === undefined) continue;
    const ax = b.x - a.x;
    const az = b.z - a.z;
    const bx = c.x - b.x;
    const bz = c.z - b.z;
    const turn = Math.atan2(ax * bz - az * bx, ax * bx + az * bz);
    found.push(turn / ((Math.hypot(ax, az) + Math.hypot(bx, bz)) / 2));
  }
  return found;
}

const peak = (values: readonly number[]): number => Math.max(...values.map(Math.abs));

describe('the line stays on the road — #499 criterion 2', () => {
  const routes: readonly (readonly [string, RouteProfile])[] = [
    ['a 10 m hairpin', hairpinRoute(10)],
    ['a 20 m hairpin', hairpin],
    ['a 60 m circuit', circuitRoute(60)],
    ['the stadium', stadiumRoute(30)],
    ['the S-bend', sBend],
    ['the valley', valleyRoute()],
    ['the hill', hillRoute()],
    ['a straight', northRoute(1_000, () => 0)],
  ];

  it.each(routes)('keeps %s inside the margin at every sample and between them', (_, route) => {
    const line = racingLine(route);
    for (const offset of line.offsets) {
      expect(Math.abs(offset)).toBeLessThanOrEqual(LINE_LIMIT_METRES + 1e-9);
    }
    // Between samples too: a cubic through a sample pinned at the edge
    // overshoots it, which is why `lineOffsetAt` clamps.
    for (let at = 0; at <= route.totalDistance; at += 0.5) {
      expect(Math.abs(lineOffsetAt(line, at))).toBeLessThanOrEqual(LINE_LIMIT_METRES + 1e-9);
    }
  });

  it('states the margin as half a handlebar and clearance inside a 7 m road', () => {
    expect(ROAD_WIDTH_METRES / 2 - LINE_LIMIT_METRES).toBeCloseTo(0.6, 9);
  });
});

describe('it is a racing line — #499 criterion 3', () => {
  it('enters a hairpin wide, apexes on the inside and exits wide', () => {
    // `hairpinRoute` bends RIGHT, and right is the normal's negative side: the
    // inside is negative and the outside positive.
    const line = racingLine(hairpin);
    const entry = lineOffsetAt(line, BEND_START - 0.2 * BEND_LENGTH);
    const apex = lineOffsetAt(line, BEND_START + 0.5 * BEND_LENGTH);
    const exit = lineOffsetAt(line, BEND_START + 1.2 * BEND_LENGTH);
    expect(entry).toBeGreaterThan(2);
    expect(apex).toBeLessThan(-2);
    expect(exit).toBeGreaterThan(2);
  });

  it('crosses an S-bend from one apex to the other, wide in and wide out', () => {
    const line = racingLine(sBend);
    // Before the right-hander: wide, on its left.
    expect(lineOffsetAt(line, BEND_START - 20)).toBeGreaterThan(2);
    // The right-hander's apex: on its inside, the right.
    expect(lineOffsetAt(line, BEND_START + 0.5 * QUARTER)).toBeLessThan(-2);
    // The left-hander's apex: on ITS inside, the left.
    expect(lineOffsetAt(line, BEND_START + 1.5 * QUARTER)).toBeGreaterThan(2);
    // After it: wide of the left-hander, on its right.
    expect(lineOffsetAt(line, BEND_START + 2 * QUARTER + 20)).toBeLessThan(-2);
  });

  it.each([
    ['the hairpin', hairpin],
    ['the S-bend', sBend],
    ['a 10 m hairpin', hairpinRoute(10)],
  ] as const)('bends %s less sharply at its tightest than the centreline does', (_, route) => {
    const centre = peak(curvaturesOf(route, new Float64Array(route.positions.length)));
    const line = peak(curvaturesOf(route, racingLine(route).offsets));
    expect(line).toBeLessThan(centre);
  });

  it('rides a straight down the middle', () => {
    const line = racingLine(northRoute(1_000, () => 0));
    for (const offset of line.offsets) {
      expect(offset).toBe(0);
    }
  });

  it('settles back to the middle on a long straight away from a bend', () => {
    // 350 m before the hairpin, which is six settle lengths.
    const line = racingLine(hairpin);
    expect(Math.abs(lineOffsetAt(line, 50))).toBeLessThan(0.01);
  });

  it('has stopped moving by the last step', () => {
    for (const route of [hairpin, sBend, hairpinRoute(10), stadiumRoute(30)]) {
      const settled = racingLine(route).offsets;
      const oneMore = solvedLine(route, 31).offsets;
      for (let index = 0; index < settled.length; index += 1) {
        expect(Math.abs((oneMore[index] ?? 0) - (settled[index] ?? 0))).toBeLessThan(1e-3);
      }
    }
  });

  it('is computed once per route and handed back after', () => {
    expect(racingLine(hairpin)).toBe(racingLine(hairpin));
  });
});

describe('a loop — #499 criterion 4', () => {
  it('has no step in the line where a lap wraps', () => {
    const route = stadiumRoute(30);
    const offsets = racingLine(route).offsets;
    const last = offsets.length - 1;
    // The last sample IS the first place (`LOOP_CLOSURE_METRES`)…
    expect(offsets[last]).toBe(offsets[0]);
    // …and the change across the wrap, from the last sample of the lap to the
    // first, is no bigger than the change across its neighbours either side.
    // Solved as a point-to-point route instead, each end is free of the other
    // and the step measured here was 5.5 m, where its neighbours moved 2.6 and 0.6.
    const across = Math.abs((offsets[last - 1] ?? 0) - (offsets[0] ?? 0));
    const before = Math.abs((offsets[last - 2] ?? 0) - (offsets[last - 1] ?? 0));
    const after = Math.abs((offsets[0] ?? 0) - (offsets[1] ?? 0));
    expect(across).toBeLessThanOrEqual(Math.max(before, after) * 1.5 + 0.05);
  });

  it('reads the same place on lap two as on lap one', () => {
    const route = stadiumRoute(30);
    const line = racingLine(route);
    for (const at of [3, 250, 480, 900]) {
      expect(lineOffsetAt(line, at + route.totalDistance)).toBeCloseTo(lineOffsetAt(line, at), 12);
    }
  });
});

describe('the lean — #499 criterion 5', () => {
  it('follows tan φ = v² / (g·R) at #499’s two worked points', () => {
    // 9 m/s on a 30 m bend is 15°, and 12 m/s on 20 m is 36°.
    expect(steadyTurnLean(9, 1 / 30) / DEGREES).toBeCloseTo(15.4, 1);
    expect(steadyTurnLean(12, 1 / 20) / DEGREES).toBeCloseTo(36.3, 1);
  });

  it('stops at the cap a road tyre holds, either way', () => {
    // 12 m/s on 10 m asks for 55.7°.
    expect(steadyTurnLean(12, 1 / 10)).toBe(MAXIMUM_LEAN_RADIANS);
    expect(steadyTurnLean(12, -1 / 10)).toBe(-MAXIMUM_LEAN_RADIANS);
    expect(MAXIMUM_LEAN_RADIANS / DEGREES).toBeCloseTo(38.66, 2);
  });

  it('is nought at rest and on a straight', () => {
    expect(steadyTurnLean(0, 1 / 20)).toBe(0);
    expect(steadyTurnLean(12, 0)).toBe(0);
    const straight = racingLine(northRoute(1_000, () => 0));
    expect(leanAt(straight, 500, 12)).toBe(0);
    expect(leanAt(racingLine(hairpin), BEND_START + 0.5 * BEND_LENGTH, 0)).toBe(0);
  });

  it('leans INTO the bend: right on the right-hander, left on the left-hander', () => {
    // Right is the normal's negative side, and so is a lean to the right.
    expect(leanAt(racingLine(hairpin), BEND_START + 0.5 * BEND_LENGTH, 8)).toBeLessThan(
      -10 * DEGREES,
    );
    const s = racingLine(sBend);
    expect(leanAt(s, BEND_START + 0.5 * QUARTER, 8)).toBeLessThan(-5 * DEGREES);
    expect(leanAt(s, BEND_START + 1.5 * QUARTER, 8)).toBeGreaterThan(5 * DEGREES);
  });

  it('is read from the LINE’s curvature, which is gentler than the centreline’s', () => {
    // At the apex of a 20 m hairpin at 8 m/s the centreline asks for
    // atan(64 / (9.80665·20)) = 18.1°; the line is a wider arc and asks less.
    const lean = -leanAt(racingLine(hairpin), BEND_START + 0.5 * BEND_LENGTH, 8);
    expect(lean).toBeGreaterThan(10 * DEGREES);
    expect(lean).toBeLessThan(steadyTurnLean(8, 1 / HAIRPIN_RADIUS));
  });

  it('reaches the cap at full speed through the hairpin, and no further', () => {
    const line = racingLine(hairpinRoute(10));
    let most = 0;
    for (let at = 350; at <= 500; at += 0.25) {
      most = Math.max(most, Math.abs(leanAt(line, at, 14)));
    }
    expect(most).toBeCloseTo(MAXIMUM_LEAN_RADIANS, 9);
  });
});

describe('the lean is smoothed over distance — #499 criterion 6', () => {
  it('is already leaning before the line itself asks for it', () => {
    const line = racingLine(hairpin);
    // The first place on the way in where the line's own curvature asks for a
    // degree of lean at 8 m/s.
    // `curvaturesOf` starts at sample 1.
    const curvatures = curvaturesOf(hairpin, line.offsets);
    const first = curvatures.findIndex(
      (curvature) => Math.abs(steadyTurnLean(8, curvature)) > DEGREES,
    );
    const asks = (first + 1) * hairpin.resolution;
    expect(asks).toBeGreaterThan(0);
    expect(Math.abs(leanAt(line, asks - 3, 8))).toBeGreaterThan(0);
  });

  it('never rolls faster than the stated rate on one bend, even where the cap bites', () => {
    for (const speed of [6, 10, 14]) {
      const line = racingLine(hairpin);
      const step = 0.05;
      let previous = leanAt(line, 300, speed);
      for (let at = 300 + step; at <= 520; at += step) {
        const here = leanAt(line, at, speed);
        expect(Math.abs(here - previous) / step).toBeLessThanOrEqual(
          MAXIMUM_ROLL_RADIANS_PER_METRE * (1 + 1e-9),
        );
        previous = here;
      }
    }
  });

  it('rolls at no more than twice that through an S-bend, where one lean unwinds as the other builds', () => {
    const line = racingLine(sBend);
    const step = 0.05;
    let previous = leanAt(line, 350, 12);
    for (let at = 350 + step; at <= 550; at += step) {
      const here = leanAt(line, at, 12);
      expect(Math.abs(here - previous) / step).toBeLessThanOrEqual(
        2 * MAXIMUM_ROLL_RADIANS_PER_METRE * (1 + 1e-9),
      );
      previous = here;
    }
  });
});

describe('its cost — #499', () => {
  /** A thousand kilometres of winding road: nothing in the store bounds a route's length. */
  function longWindingRoute(): RouteProfile {
    const points: RoutePoint[] = [];
    let x = 0;
    let z = 0;
    let heading = 0;
    for (let index = 0; index < 100_000; index += 1) {
      heading += 0.3 * Math.sin(index / 7) * Math.sin(index / 53);
      x += 10 * Math.sin(heading);
      z += 10 * Math.cos(heading);
      points.push({
        position: geographicPosition(
          degreesLatitude(45 + z / 111_320),
          degreesLongitude(5 + x / 78_700),
        ),
        elevation: altitudeMetres(100),
      });
    }
    return routeProfile(points);
  }

  it('solves a 1 000 km route once, in bounded time, and keeps it on the road', () => {
    const route = longWindingRoute();
    const started = performance.now();
    const line = solvedLine(route, 30);
    const took = performance.now() - started;
    // Printed, because it is the figure #499 asks to be recorded: about 0.8 s
    // on the machine this was written on, and several times that under the
    // coverage run. The bound is a hang detector, not a performance claim.
    console.info(`racing line: ${String(route.positions.length)} samples in ${took.toFixed(0)} ms`);
    expect(took).toBeLessThan(30_000);
    expect(peak(Array.from(line.offsets))).toBeLessThanOrEqual(LINE_LIMIT_METRES);
  }, 60_000);
});
