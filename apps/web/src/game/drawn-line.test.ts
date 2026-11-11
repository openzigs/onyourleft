// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The drawn path through a junction — #2422's rework, after the owner's
 * tablet ride of 2026-11-10: the rider slowed too much, leant too far,
 * snapped round the corner on the wrong line, and the camera jerked round.
 *
 * Each of those four is read here frame by frame, the way `GameView` draws a
 * ride: `scene.ts` §`drawnRiderDistance`, §`placedRiders` and §`cameraPose`
 * (with the path `sceneFrame` hands it, §`drawnPathOf`) for each frame, and
 * `camera.ts` §`dampedHeading` between frames, at 60 frames a second and a
 * held speed. Through `jitteredJunctionRoute` — a 90° junction an imported,
 * recorded course draws at one or two vertices, sampled every 10 m, with the
 * samples either side wandering 1 to 5 m (40 seeds at each, 200 in all) — and
 * through `plannerCornerRoute(90)`, at 25, 30, 35 and 45 km/h:
 *
 * 1. **The drawn speed** — how fast the rider's marker moves over the ground —
 *    never falls below a floor of the un-jittered junction's own drawn speed;
 * 2. **the lean** is never more than `EASED_LEAN_RADIANS`, 25°;
 * 3. **the rider's heading** turns no faster than a rider leaning 25° turns,
 *    and its turn rate changes smoothly from frame to frame;
 * 4. **the camera's heading** likewise; and
 * 5. **the rider is on the road**: the handlebar end inside the carriageway.
 *
 * Each bound's note gives what #2445's head measured; the mutations that
 * turn each red again are listed in the PR body.
 */

import { describe, expect, it } from 'vitest';

import { metres, metresPerSecond, type RouteProfile } from '@onyourleft/domain';

import { EASED_LEAN_RADIANS } from './bend-easing';
import { RIDER_HALF_WIDTH_METRES, combinedLean } from './bicycle';
import { dampedHeading, type GroundHeading } from './camera';
import { DRAWN_PACE_WINDOW_METRES, drawnLine, drawnLineAt } from './drawn-line';
import { LINE_LIMIT_METRES, racingLine } from './racing-line';
import { distanceToDrawnRoad } from './road-grid';
import { circuitRoute, jitteredJunctionRoute, plannerCornerRoute } from './route-fixtures-testing';
import {
  cameraPose,
  drawnPathOf,
  drawnRiderDistance,
  placedRiders,
  sceneFrame,
  type SceneInput,
} from './scene';
import { atStartLine } from './simulation';
import { ROAD_WIDTH_METRES, corridorOrigin, roadCorridor } from './terrain';

const DEGREES = Math.PI / 180;

/** `GameView`'s frame rate. */
const FRAMES_PER_SECOND = 60;

/** The corner of every junction and planner fixture is 1 500 m along it. */
const CORNER = 1_500;

/** What a ride through a junction did to the drawn rider and the camera. */
interface Ridden {
  /** The slowest the rider's marker moved over the ground, metres a second. */
  readonly slowest: number;
  /** The most the rider leant, rider and bicycle together, radians. */
  readonly lean: number;
  /** The fastest the rider's heading turned, radians a second. */
  readonly riderTurn: number;
  /** The most the rider's turn rate changed from one frame to the next, radians a second squared. */
  readonly riderJerk: number;
  readonly cameraTurn: number;
  readonly cameraJerk: number;
  /** How far the handlebar end was past the road's edge at most, metres: negative is inside it. */
  readonly pastTheEdge: number;
  /** How far the rider's heading turned in all, radians — so a ride that never turned cannot pass. */
  readonly turned: number;
}

/** The short way round from `from` to `to`, radians, in (−π, π]. */
function turnBetween(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/**
 * Rides `profile` from 80 m before its corner to 120 m after it at `kmh`, as
 * `GameView` draws a frame; the camera's damping is warmed up over the 30 m
 * before.
 */
function ride(profile: RouteProfile, kmh: number): Ridden {
  const origin = corridorOrigin(profile);
  const start = atStartLine(profile);
  const speed = kmh / 3.6;
  const seconds = 1 / FRAMES_PER_SECOND;
  let held: GroundHeading | undefined;
  let last:
    | {
        readonly x: number;
        readonly z: number;
        readonly rider: number;
        readonly camera: number;
        readonly riderRate?: number;
        readonly cameraRate?: number;
      }
    | undefined;
  const found = {
    slowest: Number.POSITIVE_INFINITY,
    lean: 0,
    riderTurn: 0,
    riderJerk: 0,
    cameraTurn: 0,
    cameraJerk: 0,
    pastTheEdge: Number.NEGATIVE_INFINITY,
    turned: 0,
  };
  const from = CORNER - 80;
  for (let odometer = from - 30; odometer <= CORNER + 120; odometer += speed * seconds) {
    const input: SceneInput = {
      profile,
      origin,
      state: { ...start, ride: { speed: metresPerSecond(speed), distance: metres(odometer) } },
    };
    const drawnAt = drawnRiderDistance(input);
    // The frame's own corridor, cut short: the markers and the camera read
    // only its heights and its end from it, and the full one costs the 1 600
    // rides here a minute.
    const corridor = roadCorridor(profile, origin, drawnAt, { aheadMetres: 40, behindMetres: 10 });
    const rider = placedRiders(input, corridor)[0];
    if (rider === undefined) throw new Error('no rider in the frame');
    const pose = cameraPose(corridor, drawnAt, rider.lateral, rider.lateral, drawnPathOf(input));
    held = dampedHeading(held, pose, seconds, false);
    if (odometer < from) continue;
    const marker = rider.marker;
    const riderHeading = Math.atan2(marker.headingX, marker.headingZ);
    const cameraHeading = Math.atan2(held.headingX, held.headingZ);
    found.lean = Math.max(found.lean, Math.abs(combinedLean(marker.lean, marker.bodyLean)));
    found.pastTheEdge = Math.max(
      found.pastTheEdge,
      distanceToDrawnRoad(profile, origin, marker.x, marker.z, 40) +
        RIDER_HALF_WIDTH_METRES -
        ROAD_WIDTH_METRES / 2,
    );
    let riderRate: number | undefined;
    let cameraRate: number | undefined;
    if (last !== undefined) {
      found.slowest = Math.min(
        found.slowest,
        Math.hypot(marker.x - last.x, marker.z - last.z) / seconds,
      );
      const riderStep = turnBetween(last.rider, riderHeading);
      found.turned += riderStep;
      riderRate = Math.abs(riderStep) / seconds;
      cameraRate = Math.abs(turnBetween(last.camera, cameraHeading)) / seconds;
      found.riderTurn = Math.max(found.riderTurn, riderRate);
      found.cameraTurn = Math.max(found.cameraTurn, cameraRate);
      if (last.riderRate !== undefined && last.cameraRate !== undefined) {
        found.riderJerk = Math.max(found.riderJerk, Math.abs(riderRate - last.riderRate) / seconds);
        found.cameraJerk = Math.max(
          found.cameraJerk,
          Math.abs(cameraRate - last.cameraRate) / seconds,
        );
      }
    }
    last = {
      x: marker.x,
      z: marker.z,
      rider: riderHeading,
      camera: cameraHeading,
      ...(riderRate === undefined ? {} : { riderRate }),
      ...(cameraRate === undefined ? {} : { cameraRate }),
    };
  }
  return { ...found, turned: Math.abs(found.turned) };
}

/** The four speeds #2422's rework is held at, km/h. */
const SPEEDS = [25, 30, 35, 45] as const;

/** The seeds each jitter is ridden with: 40, so 200 junctions over 1 to 5 m. */
const SEEDS = Array.from({ length: 40 }, (_, index) => (index + 1) * 7_919);

/**
 * The floor under the drawn speed, as a share of the UN-JITTERED junction's
 * own slowest drawn speed at the same odometer speed: **0.8** for a track that
 * wanders up to 3 m, **0.65** for 4 and 5 m. Chosen from a measurement on
 * 2026-11-10: the worst of the 200 seeds at any of the four speeds was 0.84
 * and 0.72 of it. A track that wanders 5 m draws a road that itself bends
 * round about 12 m either side of the corner, and a rider held to a 25° lean
 * rides that slower. On #2445's head the slowest over the ground was 5–33 %
 * of the ODOMETER's speed through these junctions, and 30–42 % through the
 * planner's corner.
 */
function floorShare(jitter: number): number {
  return jitter <= 3 ? 0.8 : 0.65;
}

/**
 * The fastest the rider's heading may turn through a junction, **45°/s**, and
 * the camera's, **65°/s**. A rider leaning 25° turns at `g·tan 25° / v`, 38°/s
 * at 25 km/h and less the faster they go. Measured on 2026-11-10, the worst of
 * the 200 seeds: the rider 35°/s, the camera 60°/s (its eye held in from the
 * kerb, `scene.ts` §`eyeOnDrawnPath`, turns it a little more than the rider).
 * On #2445's head: the rider 86–171°/s, the camera 44–83°/s.
 */
const MOST_TURN = 45 * DEGREES;
const MOST_CAMERA_TURN = 65 * DEGREES;

/**
 * How much the turn rate may change from one 60 fps frame to the next, as a
 * rate of change: **150°/s²** for the rider and **500°/s²** for the camera,
 * whose damping catches up with a bend as it starts. Measured at most 71 and
 * 436. On #2445's head the rider's was 2 900–6 500°/s², the rider stepping
 * round the corner, and the camera's 456–1 559.
 */
const MOST_RIDER_JERK = 150 * DEGREES;
const MOST_CAMERA_JERK = 500 * DEGREES;

/**
 * The lean's tolerance: **0.01°**, a rounding, not a margin. The easing lays
 * its limit out on a half-metre grid and the lean reads its own; through a
 * jittered junction the two meet within 0.002° of 25°.
 */
const LEAN_ROUNDING = 0.01 * DEGREES;

/** Asserts every bound on one ride against the un-jittered junction's slowest. */
function expectSmooth(ridden: Ridden, floor: number, label: string): void {
  expect(ridden.turned, `${label}: turned through the corner`).toBeGreaterThan(80 * DEGREES);
  expect(ridden.slowest, `${label}: the slowest the rider is drawn moving`).toBeGreaterThanOrEqual(
    floor,
  );
  expect(ridden.lean, `${label}: the most it leans`).toBeLessThanOrEqual(
    EASED_LEAN_RADIANS + LEAN_ROUNDING,
  );
  expect(ridden.riderTurn, `${label}: the rider's turn rate`).toBeLessThanOrEqual(MOST_TURN);
  expect(ridden.cameraTurn, `${label}: the camera’s turn rate`).toBeLessThanOrEqual(
    MOST_CAMERA_TURN,
  );
  expect(ridden.riderJerk, `${label}: the rider's turn rate's change`).toBeLessThanOrEqual(
    MOST_RIDER_JERK,
  );
  expect(ridden.cameraJerk, `${label}: the camera's turn rate's change`).toBeLessThanOrEqual(
    MOST_CAMERA_JERK,
  );
  expect(ridden.pastTheEdge, `${label}: the handlebar end past the edge`).toBeLessThanOrEqual(0);
}

describe('a 90° junction an imported course draws, ridden frame by frame — #2422', () => {
  const clean = jitteredJunctionRoute(90, 'right', 0);

  for (const kmh of SPEEDS) {
    it(`at ${kmh} km/h: the un-jittered junction and a planner's corner, all five bounds`, () => {
      const own = ride(clean, kmh);
      // The un-jittered junction is eased only where 25° asks it to be: never
      // below 90 % of the odometer's speed or of the speed a 25° lean takes it
      // round its own tightest radius, whichever is less.
      expectSmooth(own, 0.8 * (kmh / 3.6), `un-jittered at ${kmh}`);
      expectSmooth(ride(plannerCornerRoute(90), kmh), 0.9 * own.slowest, `planner at ${kmh}`);
    });

    for (let jitter = 1; jitter <= 5; jitter += 1) {
      it(
        `at ${kmh} km/h through 40 junctions wandering ${jitter} m, each at one vertex or two`,
        {
          timeout: 120_000,
        },
        () => {
          const floor = floorShare(jitter) * ride(clean, kmh).slowest;
          for (const [index, seed] of SEEDS.entries()) {
            const hand = index % 2 === 0 ? 'right' : 'left';
            const vertices = index % 4 < 2 ? 1 : 2;
            const ridden = ride(jitteredJunctionRoute(90, hand, jitter, seed, 0, vertices), kmh);
            expectSmooth(
              ridden,
              floor,
              `jitter ${jitter} m, seed ${seed}, ${hand}, ${vertices} vertex`,
            );
          }
        },
      );
    }
  }
});

describe('the drawn line itself — #2422', () => {
  it('is paced by its own length: no corner is drawn more than a few metres from the odometer', () => {
    // Where the window's mean puts the rider along the path, against where
    // the path's own point for that odometer is: the corner's shortfall in
    // length, spread over the window, and never more than half of it.
    const line = drawnLine(jitteredJunctionRoute(90, 'right', 3));
    const resolution: number = line.profile.resolution;
    const solved = racingLine(line.profile);
    expect(solved).not.toBe(line);
    let furthest = 0;
    for (let odometer = 1_300; odometer <= 1_700; odometer += resolution) {
      const index = Math.round(odometer / resolution);
      const here = drawnLineAt(line, index * resolution);
      const ahead = drawnLineAt(line, (index + 1) * resolution);
      // Consecutive samples a little under a sample apart on the path: paced,
      // not squeezed into the corner's shorter length.
      const apart = Math.hypot(ahead.x - here.x, ahead.z - here.z);
      expect(apart).toBeGreaterThan(0.85 * resolution);
      furthest = Math.max(furthest, Math.abs(apart - resolution));
    }
    expect(furthest).toBeGreaterThan(0.1);
    expect(DRAWN_PACE_WINDOW_METRES).toBeGreaterThan(resolution);
  });

  it('keeps its offsets inside the carriageway the line is held to', () => {
    for (const profile of [
      jitteredJunctionRoute(90, 'left', 5, 35 * 7_919),
      plannerCornerRoute(90),
    ]) {
      for (const offset of drawnLine(profile).offsets) {
        expect(Math.abs(offset)).toBeLessThanOrEqual(LINE_LIMIT_METRES + 1e-6);
      }
    }
  });

  it('closes a circuit on itself, with no step where the lap starts again', () => {
    const profile = circuitRoute(60);
    const line = drawnLine(profile);
    const total: number = profile.totalDistance;
    const start = drawnLineAt(line, 0);
    const end = drawnLineAt(line, total);
    expect(Math.hypot(start.x - end.x, start.z - end.z)).toBeLessThan(1e-6);
    // Across the seam the path moves on smoothly: two half-metre steps in a
    // row turn by about the same amount.
    const before = drawnLineAt(line, total - 0.5);
    const after = drawnLineAt(line, total + 0.5);
    const turnIn = turnBetween(
      Math.atan2(before.headingX, before.headingZ),
      Math.atan2(start.headingX, start.headingZ),
    );
    const turnOut = turnBetween(
      Math.atan2(start.headingX, start.headingZ),
      Math.atan2(after.headingX, after.headingZ),
    );
    expect(Math.abs(turnIn - turnOut)).toBeLessThan(0.002);
  });
});

describe('a lap race on a built-in circuit is drawn as it was — #2422', () => {
  // The owner, 2026-11-10: a lap race's 90° turns "look correct". A lap race
  // is not eased (`scene.ts` §`easingLine`), so its riders are drawn on
  // `racingLine` beside the road, as before this rework — the same frame as
  // `uneased: true`, which is the drawing before #1998 and #2422.
  const profile = circuitRoute(60);
  const origin = corridorOrigin(profile);
  const start = atStartLine(profile);
  for (const along of [10, 95, 190, 280]) {
    it(`draws the rider ${along} m round the lap where the un-eased drawing does`, () => {
      const state = { ...start, ride: { speed: metresPerSecond(9), distance: metres(along) } };
      const raced = sceneFrame({ profile, origin, state, raceBots: [] }).markers[0];
      const before = sceneFrame({ profile, origin, state, uneased: true }).markers[0];
      expect(raced).toEqual(before);
      // And a solo ride on the same circuit is drawn on the drawn path, which
      // is a different drawing.
      const solo = sceneFrame({ profile, origin, state }).markers[0];
      expect(solo).not.toEqual(before);
    });
  }
});
