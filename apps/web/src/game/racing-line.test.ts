// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The racing line and the lean — #499.
 *
 * Every curvature here is measured by this file's own arithmetic from the
 * profile's positions, not read back from `RacingLine.curvatures`, so a line
 * that was wrong and a curvature table that agreed with it could not pass
 * together.
 */

import { cpus } from 'node:os';

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
  GAUSS_NEWTON_STEPS,
  LINE_HOME_OFFSET_METRES,
  LINE_LIMIT_METRES,
  MAXIMUM_LEAN_RADIANS,
  MAXIMUM_ROLL_RADIANS_PER_METRE,
  MAXIMUM_ROLL_RADIANS_PER_SECOND,
  ROAD_SIDE,
  leanAt,
  lineOffsetAt,
  racingLine,
  rollRatePerMetre,
  solvedLine,
  steadyTurnLean,
  type RacingLine,
} from './racing-line';
import { RIDER_HALF_WIDTH_METRES } from './bicycle';
import {
  circuitRoute,
  cornerRoute,
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

/**
 * The S-bend: 30 m each way. Its first bend is right-handed, its second left —
 * on the map and, since #583, on the screen.
 */
const S_RADIUS = 30;
const sBend = sBendRoute(S_RADIUS);
const QUARTER = (Math.PI * S_RADIUS) / 2;

/**
 * The signed curvature of a path through the profile's samples, each moved
 * `offsets[i]` along the centreline's own normal (its right, since #583) — this test's own
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
    // `hairpinRoute` bends RIGHT, and since #583 right is the normal's
    // POSITIVE side — on the map and on the screen alike. Until #583 the world
    // was a mirror of the map and this case read the other way round, with the
    // inside negative: a reviewer who remembers that is reading the old file.
    const line = racingLine(hairpin);
    const entry = lineOffsetAt(line, BEND_START - 0.2 * BEND_LENGTH);
    const apex = lineOffsetAt(line, BEND_START + 0.5 * BEND_LENGTH);
    const exit = lineOffsetAt(line, BEND_START + 1.2 * BEND_LENGTH);
    expect(entry).toBeLessThan(-2);
    expect(apex).toBeGreaterThan(2);
    expect(exit).toBeLessThan(-2);
  });

  it('crosses an S-bend from one apex to the other, wide in and wide out', () => {
    const line = racingLine(sBend);
    // Right is the normal's positive side since #583.
    // Before the right-hander: wide, on its left.
    expect(lineOffsetAt(line, BEND_START - 20)).toBeLessThan(-2);
    // The right-hander's apex: on its inside, the right.
    expect(lineOffsetAt(line, BEND_START + 0.5 * QUARTER)).toBeGreaterThan(2);
    // The left-hander's apex: on ITS inside, the left.
    expect(lineOffsetAt(line, BEND_START + 1.5 * QUARTER)).toBeLessThan(-2);
    // After it: wide of the left-hander, on its right.
    expect(lineOffsetAt(line, BEND_START + 2 * QUARTER + 20)).toBeGreaterThan(2);
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

  it('rides a straight at home — #546, where #499 rode it on the centre line', () => {
    const line = racingLine(northRoute(1_000, () => 0));
    for (const offset of line.offsets) {
      expect(offset).toBeCloseTo(LINE_HOME_OFFSET_METRES, 9);
    }
  });

  it('settles back home on a long straight away from a bend', () => {
    // 350 m before the hairpin, which is seven settle lengths.
    const line = racingLine(hairpin);
    expect(Math.abs(lineOffsetAt(line, 50) - LINE_HOME_OFFSET_METRES)).toBeLessThan(0.01);
  });

  it('has stopped moving by the last step', () => {
    // Both stadiums since #640. The right-hand one — home on the INSIDE of its
    // bends — cycled at 40 steps rather than settling, and its line moved
    // 1.48 m on the 41st; `racing-line.ts` §`GAUSS_NEWTON_STEPS` has the
    // measurement. The shipped count is read from there, so this is always
    // "the shipped steps and one more".
    for (const route of [
      hairpin,
      sBend,
      hairpinRoute(10),
      stadiumRoute(30),
      stadiumRoute(30, 'left'),
    ]) {
      const settled = racingLine(route).offsets;
      const oneMore = solvedLine(route, GAUSS_NEWTON_STEPS + 1).offsets;
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
  it.each(['right', 'left'] as const)(
    'has no step in the line where a lap wraps — the %s-hand stadium',
    (hand) => {
      // Both hands since #640. The right-hand one failed this at 40 steps —
      // 2.50 m across the wrap where its neighbours moved 1.54 m — because its
      // line had not converged; converged it is 2.10 m against 1.41 m.
      const route = stadiumRoute(30, hand);
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
    },
  );

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
    // Nought to rounding: since #546 a straight is ridden 1.75 m off the
    // centreline, so its three points carry a sum's worth of float error.
    const straight = racingLine(northRoute(1_000, () => 0));
    expect(Math.abs(leanAt(straight, 500, 12))).toBeLessThan(1e-12);
    expect(leanAt(racingLine(hairpin), BEND_START + 0.5 * BEND_LENGTH, 0)).toBe(0);
  });

  it('leans INTO the bend: right on the right-hander, left on the left-hander', () => {
    // Right is the normal's positive side since #583, and so is a lean to the
    // right.
    expect(leanAt(racingLine(hairpin), BEND_START + 0.5 * BEND_LENGTH, 8)).toBeGreaterThan(
      10 * DEGREES,
    );
    const s = racingLine(sBend);
    expect(leanAt(s, BEND_START + 0.5 * QUARTER, 8)).toBeGreaterThan(5 * DEGREES);
    expect(leanAt(s, BEND_START + 1.5 * QUARTER, 8)).toBeLessThan(-5 * DEGREES);
  });

  it('is read from the LINE’s curvature, which is gentler than the centreline’s', () => {
    // At the apex of a 20 m hairpin at 8 m/s the centreline asks for
    // atan(64 / (9.80665·20)) = 18.1°; the line is a wider arc and asks less.
    const lean = leanAt(racingLine(hairpin), BEND_START + 0.5 * BEND_LENGTH, 8);
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

  it('rolls no faster through an S-bend, where one lean unwinds as the other builds — #546', () => {
    // #499 allowed twice the rate here, because its two directions of lean
    // were limited apart and added. Since #546 the sum is limited too.
    const line = racingLine(sBend);
    const step = 0.05;
    let previous = leanAt(line, 350, 12);
    for (let at = 350 + step; at <= 550; at += step) {
      const here = leanAt(line, at, 12);
      expect(Math.abs(here - previous) / step).toBeLessThanOrEqual(
        rollRatePerMetre(12) * (1 + 1e-9),
      );
      previous = here;
    }
  });
});

/** @see the #734 note on the cost case below */
const MAXIMUM_COST_RATIO = 25;

describe('its cost — #499', () => {
  /**
   * `kilometres` of winding road — the same road for every length, so the
   * shorter is the start of the longer. Nothing in the store bounds a route's
   * length.
   */
  function longWindingRoute(kilometres: number): RouteProfile {
    const points: RoutePoint[] = [];
    let x = 0;
    let z = 0;
    let heading = 0;
    for (let index = 0; index < kilometres * 100; index += 1) {
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

  /** One solve, and how long it took in milliseconds. */
  function timedSolve(route: RouteProfile): { readonly line: RacingLine; readonly took: number } {
    const started = performance.now();
    const line = solvedLine(route, GAUSS_NEWTON_STEPS);
    return { line, took: performance.now() - started };
  }

  /**
   * ⚠️ **What this claims, since #734: the solve's cost grows LINEARLY with
   * the route, and a reviewer who remembers "under 30 s" here is reading the
   * old file.** It asserted `took < 30 000` ms and called that a hang
   * detector. Under `test:coverage` on CI it read 12.2 s to 27.2 s over
   * thirteen green `main` runs on 2026-09-28 (36370135206 to 36405580515) —
   * 27.2 s on 36374954481, 91 % of the bound, on the slower of the two
   * runners — so it was measuring the runner and coverage's counters as much
   * as the solver: the same code took 1.3 s run alone on a Mac and 5.6 s under
   * coverage there. And it could not detect a hang at all, because a
   * synchronous case is judged only once it returns (docs/agents/ci.md §4c).
   *
   * #734 did two things, and #751 asked which:
   *
   * 1. **Made the work cheaper.** `racing-line.ts` §`bandedSolve` peels its
   *    edge rows out of the four hottest loops, `linearise` writes its
   *    three-by-three out, and §`solvePinned` visits a LIST of the pinned
   *    samples instead of scanning every sample to skip the free ones — to
   *    the bit, which the digests below hold. Measured on one Mac, median of
   *    three, this case alone: 5.59 s to 3.80 s under coverage (−32 %), and
   *    1.41 s to 1.31 s without it.
   * 2. **Restructured what is timed.** The bound is now a RATIO — a 1 000 km
   *    solve against a 100 km solve of the start of the same road, in the
   *    same process under the same instrumentation — so the runner and the
   *    coverage counters divide out. Linear cost is 10; a solver that went
   *    quadratic in the route's length would read about 100.
   *
   * The 100 km route is solved TWICE and the second is used, so the ratio is
   * not flattered by the smaller solve paying for the JIT's warm-up.
   * `MAXIMUM_COST_RATIO` is 25: two and a half times linear, and at least
   * twice every ratio CI has printed under coverage. Measured on #751's pull
   * request, `test:coverage` on the slower runner (AMD EPYC 7763), run
   * 36467880376: **9.54** on attempt 1 (15 462 ms against 1 621 ms) and
   * **9.13** on attempt 2 (15 601 ms against 1 709 ms) — 38 % and 37 % of the
   * bound. Locally on an Apple M4 Pro: 9.3 to 10.0, with and without coverage.
   * The 1 000 km solve itself took 12.2 s to 27.2 s under coverage on CI
   * before #734 and 15.5 s on both of those runs. The case prints its own
   * figures on every run, with the CPU it ran on.
   *
   * ⚠️ **What it no longer catches: a uniform slow-down.** A change that made
   * every sample three times dearer leaves the ratio at 10. The old bound could
   * catch that only on a fast runner — at 27.2 s it had 10 % left — so nothing
   * reliable was given up, but nothing here is a speed claim in seconds.
   */
  it('solves a 1 000 km route once, at a cost linear in its length, and keeps it on the road', () => {
    const shorter = longWindingRoute(100);
    const route = longWindingRoute(1_000);
    timedSolve(shorter);
    const warm = timedSolve(shorter);
    const { line, took } = timedSolve(route);
    const ratio = took / warm.took;
    const samples = route.positions.length / shorter.positions.length;
    // Printed, because it is the figure #499 asks to be recorded, and #734's
    // ratio beside it with the CPU, because which runner a job lands on is the
    // first thing to know about a timing.
    console.info(
      `racing line: ${String(route.positions.length)} samples in ${took.toFixed(0)} ms; ` +
        `${String(shorter.positions.length)} in ${warm.took.toFixed(0)} ms; ` +
        `ratio ${ratio.toFixed(2)} for ${samples.toFixed(2)} times the samples; ` +
        `${cpus()[0]?.model ?? 'unknown CPU'}`,
    );
    expect(samples).toBeGreaterThan(9.5);
    expect(ratio).toBeLessThan(MAXIMUM_COST_RATIO);
    expect(peak(Array.from(line.offsets))).toBeLessThanOrEqual(LINE_LIMIT_METRES);
  }, 60_000);

  /**
   * #588 made the solve and the lean cheaper by restructuring them — a buffer
   * set made once, a chord's length taken once, the lean's first stage as two
   * running passes — and claims neither moved. That is a claim about a diff, so
   * it is pinned to numbers instead: a digest of the line and of the lean at
   * three speeds on five fixtures, a hairpin each way of tight and a loop among
   * them, **taken on `main` before a line of #588 was written** with the code
   * it replaced. `arrangement-unchanged.test.ts` makes the same argument about
   * the scenery, and fixes the precision for the same reason: a tenth of a
   * millimetre and a millionth of a radian are far finer than anything drawn
   * and far coarser than the last bit of a double.
   *
   * A red digest here means the line or the lean MOVED. If that was the point
   * of the change, re-take these and say so in its pull request; if it was
   * meant to be a speed-up, it was not one.
   *
   * ⚠️ **Since #583 each fixture here is the MIRROR of the one the digest was
   * taken on, and the digests did not move.** Until #583 the world was drawn
   * as a mirror of its map, so the hairpin turning east was drawn turning the
   * way the one turning west is drawn now. The line and the lean are computed
   * from what is drawn, so the mirrored fixture reproduces every digit — which
   * is the evidence that #583 moved the projection and nothing in the solver.
   * The "10 m left-hand corner" is the one #588 took, drawn left-handed then;
   * it is the right-hand fixture now for the same reason.
   *
   * ⚠️ **Re-taken by #640, and every one of them moved — on purpose.** #640
   * took the solve from 40 steps to 80, so each fixture is drawn nearer its
   * converged line. None of these five was the fixture #640 was about (the
   * right-hand stadium, whose line moved 1.25 m and its lean up to 18°), and
   * each moved by far less than anything drawn — measured between 40 and 80
   * steps, as the most any offset, any curvature and any of the three leans
   * moved: the 10 m hairpin 0.005 mm, 6·10⁻⁸ per metre, 0.00005°; the 20 m
   * hairpin 0.04 mm, 4·10⁻⁷, 0.0004°; the S-bend 0.17 mm, 2·10⁻⁶, 0.003°; the
   * 10 m corner 1.5 mm, 2·10⁻⁵, 0.02°; the stadium 0.04 mm, 7·10⁻⁷, 0.0007°.
   * A digest fixed to a tenth of a millimetre and a millionth sees all of them.
   * The case name said "exactly as main did before #588" until then; the
   * argument above about #588 and #583 still holds of the digests it had.
   */
  it.each([
    ['a 10 m hairpin', () => hairpinRoute(10, 'left'), '1bce7fb0', '577f5128'],
    ['the 20 m hairpin', () => hairpinRoute(HAIRPIN_RADIUS, 'left'), '4221e52b', 'b8fdcafb'],
    ['the S-bend', () => sBendRoute(S_RADIUS, 'left'), '2f2e3ed7', '58cf2dd9'],
    ['a 10 m corner drawn left-handed', () => cornerRoute(10, 90, 'right'), '79bcdfa3', '63dfb82e'],
    ['the stadium, a loop', () => stadiumRoute(30, 'left'), '9c23170c', 'f2c0d419'],
  ] as const)(
    'draws the line and the lean on %s exactly as the digest taken for #640',
    (_, make, lineDigest, leanDigest) => {
      // A fresh profile, so the line is solved here rather than read from a cache
      // an earlier case filled.
      const route = make();
      const line = racingLine(route);
      const drawn: string[] = [];
      for (let index = 0; index < line.offsets.length; index += 1) {
        drawn.push(
          `${(line.offsets[index] as number).toFixed(4)} ${(line.curvatures[index] as number).toFixed(6)}`,
        );
      }
      const leaning: string[] = [];
      for (let at = 0; at <= route.totalDistance; at += 0.7) {
        leaning.push([4, 9, 16].map((speed) => leanAt(line, at, speed).toFixed(6)).join(' '));
      }
      // Not an empty line, which would digest to something too.
      expect(drawn.length).toBe(route.positions.length);
      expect(peak(Array.from(line.offsets))).toBeGreaterThan(1);
      expect({ line: digest(drawn), lean: digest(leaning) }).toEqual({
        line: lineDigest,
        lean: leanDigest,
      });
    },
  );
});

/** FNV-1a, 32-bit, as eight hex digits — `arrangement-unchanged.test.ts`'s. */
function digest(lines: readonly string[]): string {
  let hash = 0x811c9dc5;
  for (const line of lines) {
    for (let at = 0; at < line.length; at += 1) {
      hash ^= line.charCodeAt(at);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    hash ^= 0x0a;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// #546 — a racer's line on a closed road, kept to the right, with a late apex
// ---------------------------------------------------------------------------

/** `R = (b − a·cos(θ/2)) / (1 − cos(θ/2))` — #546's closed form for the line's radius. */
function closedFormRadius(radius: number, turn: number): number {
  const inner = radius - LINE_LIMIT_METRES;
  const outer = radius + LINE_LIMIT_METRES;
  return (outer - inner * Math.cos(turn / 2)) / (1 - Math.cos(turn / 2));
}

/** One bend of a fixture: where its arc starts, how long it is, how far it turns, and which way. */
interface Bend {
  readonly name: string;
  readonly route: RouteProfile;
  readonly radius: number;
  readonly turn: number;
  readonly start: number;
  /**
   * +1 for a bend toward the normal's positive side — the right, on the map and
   * on the screen — and −1 for a left-hander. ⚠️ **It was the other way round
   * until #583**, when the world was a mirror of the map and a right-hand map
   * corner was drawn turning left.
   */
  readonly inside: -1 | 1;
}

const BENDS: readonly Bend[] = [
  ...[10, 20, 40].flatMap((radius): Bend[] => [
    {
      name: `a ${String(radius)} m right-hand corner`,
      route: cornerRoute(radius),
      radius,
      turn: Math.PI / 2,
      start: 400,
      inside: 1,
    },
    {
      name: `a ${String(radius)} m left-hand corner`,
      route: cornerRoute(radius, 90, 'left'),
      radius,
      turn: Math.PI / 2,
      start: 400,
      inside: -1,
    },
  ]),
  {
    name: 'the 20 m hairpin',
    route: hairpin,
    radius: HAIRPIN_RADIUS,
    turn: Math.PI,
    start: BEND_START,
    inside: 1,
  },
];

/** Where the line holds the inside: the first and last metre within 0.1 m of its limit. */
function insideRun(bend: Bend): {
  readonly from: number;
  readonly to: number;
  readonly deepest: number;
} {
  const line = racingLine(bend.route);
  const length = bend.radius * bend.turn;
  let deepest = Number.POSITIVE_INFINITY;
  for (let at = bend.start - 60; at <= bend.start + length + 60; at += 0.25) {
    deepest = Math.min(deepest, bend.inside * lineOffsetAt(line, at));
  }
  let from = Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;
  for (let at = bend.start - 60; at <= bend.start + length + 60; at += 0.25) {
    if (bend.inside * lineOffsetAt(line, at) <= -LINE_LIMIT_METRES + 0.1) {
      from = Math.min(from, at);
      to = Math.max(to, at);
    }
  }
  return { from, to, deepest };
}

describe('holds the right-hand side on a straight, not the centre line — #546', () => {
  it('keeps to the right, a lane’s middle from the edge, where #499 rode the centre line', () => {
    expect(ROAD_SIDE).toBe(1);
    // The home is on ROAD_SIDE's side of the centre line…
    expect(Math.sign(LINE_HOME_OFFSET_METRES)).toBe(ROAD_SIDE);
    // …and no point of the bicycle there is within 0.5 m of the centre line:
    // the bar end is the widest point.
    expect(Math.abs(LINE_HOME_OFFSET_METRES) - RIDER_HALF_WIDTH_METRES).toBeGreaterThanOrEqual(0.5);
    // Nor within 0.6 m of the far edge, measured to the bar's middle.
    expect(ROAD_WIDTH_METRES / 2 - Math.abs(LINE_HOME_OFFSET_METRES)).toBeGreaterThanOrEqual(0.6);
  });

  it.each(BENDS)(
    'is within 0.1 m of home more than 150 m from $name',
    ({ route, start, radius, turn }) => {
      const line = racingLine(route);
      const end = start + radius * turn;
      let furthest = 0;
      for (let at = 0; at <= route.totalDistance; at += 1) {
        if (at > start - 150 && at < end + 150) continue;
        furthest = Math.max(furthest, Math.abs(lineOffsetAt(line, at) - LINE_HOME_OFFSET_METRES));
      }
      expect(furthest).toBeLessThan(0.1);
    },
  );
});

describe('a closed road: the whole carriageway through a bend, and a late apex — #546', () => {
  it.each(BENDS)('stays a handlebar and 0.4 m inside the edge through $name', ({ route }) => {
    const line = racingLine(route);
    for (let at = 0; at <= route.totalDistance; at += 0.5) {
      const offset = Math.abs(lineOffsetAt(line, at));
      // The bar end clear of the edge by 0.4 m, and the tyre — in the
      // bicycle's plane — by at least the Highway Code's 0.5 m.
      expect(ROAD_WIDTH_METRES / 2 - offset - RIDER_HALF_WIDTH_METRES).toBeGreaterThanOrEqual(
        0.4 - 1e-9,
      );
      expect(ROAD_WIDTH_METRES / 2 - offset).toBeGreaterThanOrEqual(0.5);
    }
  });

  /**
   * Where the apex lands, as the middle of the stretch the line holds within
   * 0.1 m of the inside, in metres after the bend's bisector — published, as
   * #546 asks, and measured 2026-09-26:
   *
   * | bend | apex after the bisector |
   * |---|--:|
   * | 10 m corner, either hand | +0.1 m |
   * | 20 m corner, either hand | +0.7 m |
   * | 40 m corner, right / left | +3.3 / +3.5 m |
   * | 20 m hairpin | +5.2 m |
   *
   * ⚠️ **Right and left are the other way round from how #546 measured them,
   * and that is #583 rather than a re-measurement.** #546 measured a world
   * that was a mirror of its map, so its "right-hand" corner was the one drawn
   * turning left; the figures belong to what is drawn, and so they moved with
   * the label. The hairpin is the one figure re-taken (2026-09-27): it turns
   * right, which since #583 is toward the home side, and #546 measured it
   * turning the other way, at +5.3 m.
   * ⚠️ **The 10 m corner is where the resolution bites**: its arc is 15.7 m,
   * a sample and a half of a 10 m profile, and it is the case the late-apex
   * gain was raised to 40 for (at 10 its apex was 0.1 m BEFORE the bisector).
   */
  it.each(BENDS)('apexes on the inside, at or after the bisector, on $name', (bend) => {
    const bisector = bend.start + (bend.radius * bend.turn) / 2;
    const run = insideRun(bend);
    const apex = (run.from + run.to) / 2 - bisector;
    expect(run.deepest).toBeLessThanOrEqual(-LINE_LIMIT_METRES + 0.1);
    expect(apex).toBeGreaterThanOrEqual(0);
  });

  /**
   * ⚠️ **The exit is held to the tangent point on a 90° corner and NOT on the
   * hairpin, and that is the late apex rather than a tolerance.** The closed
   * form is the geometric line's, whose apex is on the bisector; a late apex
   * opens the exit out, and on a 180° hairpin that moves the point where the
   * line regains the outside later — measured 2026-09-26 at 2.57 m out (0.33 m
   * short of the edge) at the geometric tangent point, 5.8 m past the bend,
   * and at the edge by 10 m. So the exit is held to twice that reach instead:
   * a line that never went wide again would still fail.
   */
  it.each(BENDS)(
    'enters and leaves $name within 0.3 m of the outside, at the line’s tangent points',
    (bend) => {
      const line = racingLine(bend.route);
      const radius = closedFormRadius(bend.radius, bend.turn);
      // The line's arc leaves each straight's outside edge `(R − a)·sin(θ/2)`
      // before the bend begins and after it ends — the foot of the
      // perpendicular from the line's centre onto that edge.
      const reach = (radius - (bend.radius - LINE_LIMIT_METRES)) * Math.sin(bend.turn / 2);
      const outside = -bend.inside * LINE_LIMIT_METRES;
      const end = bend.start + bend.radius * bend.turn;
      expect(Math.abs(lineOffsetAt(line, bend.start - reach) - outside)).toBeLessThanOrEqual(0.3);
      const exit = bend.turn < Math.PI ? reach : 2 * reach;
      expect(Math.abs(lineOffsetAt(line, end + exit) - outside)).toBeLessThanOrEqual(0.3);
    },
  );

  /**
   * The line's tightest radius, from this file's own curvature of its offsets,
   * against the closed form — measured 2026-09-26, right / left-hand (swapped
   * by #583, for the reason the apex table above gives; the hairpin re-taken
   * 2026-09-27 and unchanged at the precision printed):
   *
   * | bend | tightest | closed form |
   * |---|--:|--:|
   * | 10 m corner | 26.3 / 26.2 m | 26.9 m |
   * | 20 m corner | 34.5 / 34.4 m | 36.9 m |
   * | 40 m corner | 53.3 / 53.2 m | 56.9 m |
   * | 20 m hairpin | 21.0 m | 22.9 m |
   *
   * Tighter than the closed form everywhere, which is the late apex: the way in
   * is bent harder than the geometric line's single arc so that the way out
   * can be opened.
   */
  it.each(BENDS)('is at its tightest within 10 % of the closed-form radius on $name', (bend) => {
    const tightest = 1 / peak(curvaturesOf(bend.route, racingLine(bend.route).offsets));
    const expected = closedFormRadius(bend.radius, bend.turn);
    expect(Math.abs(tightest - expected) / expected).toBeLessThanOrEqual(0.1);
  });

  it('turns in harder than it opens out — which is what makes the apex late', () => {
    // The 40 m corner, on the line's own curvature: over the first half of
    // the bend the line is more curved than over the second.
    const bend = BENDS.find((each) => each.name === 'a 40 m right-hand corner') as Bend;
    const curvatures = curvaturesOf(bend.route, racingLine(bend.route).offsets);
    const sampleAt = (at: number): number => Math.round(at / bend.route.resolution) - 1;
    const bisector = bend.start + (bend.radius * bend.turn) / 2;
    let before = 0;
    let after = 0;
    for (let offset = 0; offset < 60; offset += bend.route.resolution) {
      before += Math.abs(curvatures[sampleAt(bisector - offset)] ?? 0);
      after += Math.abs(curvatures[sampleAt(bisector + offset)] ?? 0);
    }
    expect(before).toBeGreaterThan(after);
  });

  it('crosses an S-bend once between its two apexes, with no second inflection', () => {
    const line = racingLine(sBend);
    const first = BEND_START + 0.5 * QUARTER;
    const second = BEND_START + 1.5 * QUARTER;
    let crossings = 0;
    let previous = Math.sign(lineOffsetAt(line, first));
    for (let at = first; at <= second; at += 0.25) {
      const side = Math.sign(lineOffsetAt(line, at));
      if (side !== 0 && side !== previous) {
        crossings += 1;
        previous = side;
      }
    }
    expect(crossings).toBe(1);
    // The line's own curvature changes sign once between them too.
    const curvatures = curvaturesOf(sBend, line.offsets);
    const from = Math.round(first / sBend.resolution);
    const to = Math.round(second / sBend.resolution);
    let inflections = 0;
    for (let index = from; index < to; index += 1) {
      const here = curvatures[index - 1] ?? 0;
      const next = curvatures[index] ?? 0;
      if (Math.sign(here) !== Math.sign(next) && here !== 0 && next !== 0) inflections += 1;
    }
    expect(inflections).toBe(1);
  });
});

describe('never leans OUT of a bend it is turning into — #546', () => {
  /**
   * What countersteering moves outward is the steer and the contact patches,
   * not the lean (Fajans, *"Steering in bicycles and motorcycles"*, Am. J.
   * Phys. 68, 2000), so a drawn lean away from a bend at turn-in would be
   * wrong. From the line's entry tangent point to the end of the bend the
   * lean never takes the sign away from it.
   *
   * ⚠️ **Before that point it can, and it is physics rather than a
   * countersteer.** Since #546 the line sets a bend up from the side of the
   * road it needs, and a line that moves across the road curves away from the
   * bend to do it; the lean is `tan φ = v²/(g·R)` of THAT curve. Measured
   * 2026-09-26 on the 20 m corners, 30 m before the bend: 0.5° at 8 m/s and
   * 1.8° at 16 m/s where the home is already the outside (left-hand since
   * #583, which swapped the hands), and 1.5° and 5.9° where the line crosses
   * the whole road to get there (right-hand). The owner's "true to physics" is
   * why it is drawn.
   */
  it.each(BENDS)('from the line’s turn-in to the end of $name', (bend) => {
    const line = racingLine(bend.route);
    const radius = closedFormRadius(bend.radius, bend.turn);
    const turnIn =
      bend.start - (radius - (bend.radius - LINE_LIMIT_METRES)) * Math.sin(bend.turn / 2);
    const end = bend.start + bend.radius * bend.turn;
    for (const speed of [4, 8, 12, 16]) {
      for (let at = turnIn; at <= end; at += 0.25) {
        expect(-bend.inside * leanAt(line, at, speed)).toBeLessThanOrEqual(0.5 * DEGREES);
      }
    }
  });
});

describe('rolls in over time, not only over distance — #546', () => {
  it.each(BENDS)(
    'never rolls faster than the stated rate a second, at any speed from 3 to 20 m/s, on $name',
    (bend) => {
      // Sampled at v·Δt, so a step is Δt of riding. A single bend at each. The
      // S-bend's two leans no longer ADD, as they did under #499: since #546 one
      // unwinds as the other builds on ONE shared rate (`racing-line.ts`
      // §`MAXIMUM_ROLL_RADIANS_PER_SECOND`), which "rolls no faster through an
      // S-bend" above asserts on its own.
      //
      // Every step is still compared, but the steepest is asserted once, with
      // where it was: an `expect` a step was 140 000 of them, most of this case's
      // time under the coverage run. And it is one case a bend rather than one
      // for all seven: as one it took 7.4 s on CI for #546's merge and timed out
      // (#588), and still 4.9 s on CI once `leanAt` was made cheaper.
      const seconds = 0.02;
      let steepest = { perMetre: 0, where: 'nowhere' };
      let fastest = { perSecond: 0, where: 'nowhere' };
      const line = racingLine(bend.route);
      const end = bend.start + bend.radius * bend.turn;
      for (let speed = 3; speed <= 20; speed += 1) {
        const step = speed * seconds;
        let previous = leanAt(line, bend.start - 80, speed);
        for (let at = bend.start - 80 + step; at <= end + 80; at += step) {
          const here = leanAt(line, at, speed);
          const change = Math.abs(here - previous);
          if (change / step > steepest.perMetre) {
            steepest = { perMetre: change / step, where: `${String(at)} m, ${String(speed)} m/s` };
          }
          if (change / seconds > fastest.perSecond) {
            fastest = {
              perSecond: change / seconds,
              where: `${String(at)} m, ${String(speed)} m/s`,
            };
          }
          previous = here;
        }
      }
      expect(steepest.perMetre, steepest.where).toBeLessThanOrEqual(
        MAXIMUM_ROLL_RADIANS_PER_METRE * (1 + 1e-9),
      );
      expect(fastest.perSecond, fastest.where).toBeLessThanOrEqual(
        MAXIMUM_ROLL_RADIANS_PER_SECOND * (1 + 1e-9),
      );
      // …and it did roll: a sweep that leaned nobody would pass the two above.
      expect(fastest.perSecond).toBeGreaterThan(0.5 * MAXIMUM_ROLL_RADIANS_PER_SECOND);
    },
  );

  it('keeps its reach bounded at a speed nothing reaches, and still rolls no faster than it', () => {
    // 100 m/s is 360 km/h: the per-metre rate stops falling at whatever rolls
    // the whole cap in 50 m, so the window — and the work — stop growing.
    expect(rollRatePerMetre(100)).toBeCloseTo(MAXIMUM_LEAN_RADIANS / 50, 12);
    expect(rollRatePerMetre(1_000)).toBe(rollRatePerMetre(100));
    const line = racingLine(hairpin);
    const step = 0.25;
    let previous = leanAt(line, 300, 100);
    for (let at = 300 + step; at <= 520; at += step) {
      const here = leanAt(line, at, 100);
      expect(Number.isFinite(here)).toBe(true);
      expect(Math.abs(here - previous) / step).toBeLessThanOrEqual(
        rollRatePerMetre(100) * (1 + 1e-9),
      );
      previous = here;
    }
    // …and at that speed the hairpin still leans the rider well into it:
    // not to the cap, because rolled in over 50 m a 63 m bend is too short to
    // hold it, which is the per-second bound doing its job.
    expect(leanAt(line, BEND_START + BEND_LENGTH / 2, 100)).toBeGreaterThan(
      0.9 * MAXIMUM_LEAN_RADIANS,
    );
  });

  it('states the per-second bound as 60° a second, and the rate it gives as the lesser', () => {
    expect(MAXIMUM_ROLL_RADIANS_PER_SECOND / DEGREES).toBeCloseTo(60, 9);
    expect(rollRatePerMetre(5)).toBe(MAXIMUM_ROLL_RADIANS_PER_METRE);
    expect(rollRatePerMetre(16)).toBeCloseTo(MAXIMUM_ROLL_RADIANS_PER_SECOND / 16, 12);
  });
});
