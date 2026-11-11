// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The drawn rider eases off for a sharp bend — #1998: the lean it is drawn at,
 * the place it is drawn at and the speed lost and given back, read through
 * the frame a renderer is handed, and that nothing a ride records or a
 * trainer is sent moves. And #2422: a corner an imported course draws at one
 * sample, with the samples either side wandering, is eased as the corner it
 * is rather than as the spike the line makes of it.
 */

import { describe, expect, it } from 'vitest';

import {
  buildGhostTrack,
  gradePercent,
  kilograms,
  metres,
  metresPerSecond,
  seconds,
  watts,
  type RouteProfile,
} from '@onyourleft/domain';
import type { SimulationParameters } from '@onyourleft/sensors/protocol';

import { STANDARD_GRAVITY_METRES_PER_SECOND_SQUARED } from '@onyourleft/physics';

import {
  BRAKING_METRES_PER_SECOND_SQUARED,
  EASED_LEAN_RADIANS,
  EASING_WINDOW_METRES,
  GIVE_BACK_SHARE,
  MAX_LAG_METRES,
  PICK_UP_METRES_PER_SECOND_SQUARED,
  easedPlace,
  type EasedPlace,
} from './bend-easing';
import { combinedLean } from './bicycle';
import { CAMERA_BEHIND_METRES } from './camera';
import {
  GAME_TRAINER_MODULES,
  WIRING_SOURCE,
  plantedOver,
  seamViolations,
  trainerCommandSeam,
} from './cannot-reach-trainer-testing';
import { drawnLine, drawnLineAt } from './drawn-line';
import { createGradientSession } from './gradient';
import type { RiderMarker, SceneFrame } from './port';
import { lineOffsetAt, racingLine, type RacingLine } from './racing-line';
import {
  circuitRoute,
  cornerRoute,
  hairpinRoute,
  jitteredJunctionRoute,
  levelHairpinRoute,
  northRoute,
  plannerCornerRoute,
} from './route-fixtures-testing';
import {
  cameraPose,
  chaseRider,
  drawnPathOf,
  drawnRiderDistance,
  placedRiders,
  sceneFrame,
} from './scene';
import { GameSimulation, atStartLine, type GameState } from './simulation';
import { corridorOrigin, roadCorridor } from './terrain';

const DEGREES = Math.PI / 180;
const hairpin = hairpinRoute(20);
/** The 20 m hairpin's apex: 400 m of straight, then a quarter of the way round. */
const APEX = 400 + (Math.PI * 20) / 2;

/** A state `distance` along the route at `speed`, with a pacer if asked. */
function stateAt(
  profile: RouteProfile,
  distance: number,
  speed: number,
  bot?: { readonly distance: number; readonly speed: number },
  ridden = 0,
): GameState {
  const start = atStartLine(profile);
  return {
    ...start,
    ride: { speed: metresPerSecond(speed), distance: metres(distance) },
    ridden: seconds(ridden),
    ...(bot === undefined
      ? {}
      : {
          bot: {
            state: { speed: metresPerSecond(bot.speed), distance: metres(bot.distance) },
            distanceOnRoute: metres(bot.distance),
            grade: gradePercent(0),
            power: watts(200),
          },
        }),
  };
}

function frameOf(
  profile: RouteProfile,
  state: GameState,
  extra: Partial<Parameters<typeof sceneFrame>[0]> = {},
): SceneFrame {
  return sceneFrame({ profile, origin: corridorOrigin(profile), state, ...extra });
}

function markerOf(frame: SceneFrame, kind: RiderMarker['kind']): RiderMarker {
  const found = frame.markers.find((marker) => marker.kind === kind);
  if (found === undefined) throw new Error(`no ${kind} in the frame`);
  return found;
}

/**
 * Where a marker is from a distance on the frame's own corridor, read from the
 * corridor's points rather than through `scene.ts`: how far along the road's
 * heading there, and how far across it along its normal `(−z, x)`. Along is
 * nought when the marker is drawn at that distance.
 */
function offsetFrom(
  frame: SceneFrame,
  marker: RiderMarker,
  distance: number,
): { along: number; across: number } {
  const centre = frame.corridor.centre;
  let index = 0;
  for (let candidate = 0; candidate < centre.length - 1; candidate += 1) {
    if ((centre[candidate] as (typeof centre)[number]).along > distance) break;
    index = candidate;
  }
  const from = centre[index] as (typeof centre)[number];
  const to = centre[index + 1] as (typeof centre)[number];
  const fraction = (distance - from.along) / (to.along - from.along);
  const dx = marker.x - (from.x + (to.x - from.x) * fraction);
  const dz = marker.z - (from.z + (to.z - from.z) * fraction);
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  const headingX = (to.x - from.x) / length;
  const headingZ = (to.z - from.z) / length;
  return { along: dx * headingX + dz * headingZ, across: -dx * headingZ + dz * headingX };
}

/** How far along the road a marker is from a distance. @see offsetFrom */
function alongFrom(frame: SceneFrame, marker: RiderMarker, distance: number): number {
  return offsetFrom(frame, marker, distance).along;
}

/** The rider as `sceneFrame` places it — through `placedRiders`, for #588's reason. */
function riderAt(
  route: RouteProfile,
  at: number,
  speed: number,
  extra: { readonly uneased?: boolean } = {},
): RiderMarker {
  const input = {
    profile: route,
    origin: corridorOrigin(route),
    state: stateAt(route, at, speed),
    ...extra,
  };
  const placed = placedRiders(input, roadCorridor(route, input.origin, at));
  return (placed[0] as (typeof placed)[number]).marker;
}

/** The sharp bends #1998 names, and the stretch of odometer that rides through each. */
const BENDS: readonly (readonly [string, RouteProfile, number, number])[] = [
  ['the 20 m hairpin', hairpin, 300, 650],
  ['a 10 m hairpin', hairpinRoute(10), 300, 650],
  ['a 20 m 90° corner', cornerRoute(20), 300, 600],
  ['a 10 m 90° corner', cornerRoute(10), 300, 600],
];

describe('the lean stays natural — #1998', () => {
  it.each(BENDS)(
    'leans the rider no more than 25° through %s at any speed, where un-eased it leant past 30°',
    (_, route, from, to) => {
      let eased = 0;
      let uneased = 0;
      for (const speed of [8, 11, 14, 18]) {
        for (let at = from; at <= to; at += 0.5) {
          const rider = riderAt(route, at, speed);
          eased = Math.max(eased, Math.abs(combinedLean(rider.lean, rider.bodyLean)));
          const before = riderAt(route, at, speed, { uneased: true });
          uneased = Math.max(uneased, Math.abs(combinedLean(before.lean, before.bodyLean)));
        }
      }
      expect(eased).toBeLessThanOrEqual(EASED_LEAN_RADIANS + 1e-9);
      // It eases a bend down to the 25°; it does not stand the rider up.
      expect(eased).toBeGreaterThan(EASED_LEAN_RADIANS - 2 * DEGREES);
      // The control, today's drawing: the bend asks for far more.
      expect(uneased).toBeGreaterThan(30 * DEGREES);
    },
  );

  it('leaves a bend that asks for less than 25° unslowed: on the drawn path at the odometer itself', () => {
    // A 60 m circuit at 30 km/h leans about 7°: nothing to ease. Since #2422's
    // rework the rider is drawn ON the drawn path (`drawn-line.ts`), so
    // "unslowed" is the path's own place for the odometer, to the bit.
    const circuit = circuitRoute(60);
    const line = drawnLine(circuit);
    for (let at = 0; at < 377; at += 7) {
      const rider = riderAt(circuit, at, 30 / 3.6);
      const on = drawnLineAt(line, at);
      expect(easedPlace(line, at, 30 / 3.6)).toEqual({ distance: at, speed: 30 / 3.6 });
      expect(rider.x).toBeCloseTo(on.x, 9);
      expect(rider.z).toBeCloseTo(on.z, 9);
      expect(Math.abs(combinedLean(rider.lean, rider.bodyLean))).toBeLessThan(10 * DEGREES);
    }
  });
});

describe('the speed lost in a bend is drawn position only, and given back — #1998', () => {
  it.each(BENDS)(
    'slows the drawn rider into %s and gives the distance back after it',
    (_, route, from, to) => {
      const line = racingLine(route);
      const speed = 14;
      let behind = 0;
      let previous: EasedPlace | undefined;
      let hardest = 0;
      for (let at = from; at <= to + 300; at += 0.5) {
        const place = easedPlace(line, at, speed);
        // Never ahead of the odometer.
        expect(place.distance).toBeLessThanOrEqual(at);
        behind = Math.max(behind, at - place.distance);
        if (previous !== undefined) {
          // Riding on at a steady speed, the drawn rider never goes backwards…
          expect(place.distance).toBeGreaterThanOrEqual(previous.distance);
          // …slows as a rider brakes and picks up as one sprints, never in a
          // jump (`v² = u² + 2·a·s`, to a quarter of a m/s² for the steps)…
          const moved = place.distance - previous.distance;
          if (moved > 0.1) {
            const rate = (place.speed ** 2 - previous.speed ** 2) / (2 * moved);
            hardest = Math.min(hardest, rate);
            expect(rate).toBeGreaterThanOrEqual(-BRAKING_METRES_PER_SECOND_SQUARED - 0.25);
            expect(rate).toBeLessThanOrEqual(PICK_UP_METRES_PER_SECOND_SQUARED + 0.25);
          }
        }
        previous = place;
        // …and is never drawn faster than the give-back allows.
        expect(place.speed).toBeLessThanOrEqual(speed * (1 + GIVE_BACK_SHARE) + 1e-9);
      }
      // It did ease off: the drawn rider fell metres behind its odometer, and
      // braked for the bend to do it.
      expect(behind).toBeGreaterThan(3);
      expect(hardest).toBeLessThan(-BRAKING_METRES_PER_SECOND_SQUARED / 2);
      // And it gave them back: well after the bend it is on the odometer again.
      expect(easedPlace(line, to + 300, speed)).toEqual({ distance: to + 300, speed });
    },
  );

  it.each([8, 14, 18, 22, 25])(
    'never moves the drawn place faster than the give-back allows, nor lets it lag past the bound, at %s m/s — across the window’s edge too',
    (speed) => {
      const route = levelHairpinRoute(10, 2_000);
      const line = racingLine(route);
      let previous = easedPlace(line, 1_700, speed);
      let deepest = 0;
      let worst = 0;
      for (let at = 1_700.5; at <= 3_000; at += 0.5) {
        const place = easedPlace(line, at, speed);
        deepest = Math.max(deepest, at - place.distance);
        worst = Math.max(worst, (place.distance - previous.distance) / 0.5);
        previous = place;
      }
      // It did ease off, and the lag is bounded: pacers and the finish stay comparable.
      expect(deepest).toBeGreaterThan(1);
      expect(deepest).toBeLessThanOrEqual(MAX_LAG_METRES + 1e-9);
      // The drawn place moves at most 15 % faster than the odometer, every half metre.
      expect(worst).toBeLessThanOrEqual(1 + GIVE_BACK_SHARE + 0.02);
      // And the lag is all given back before the bend leaves the window.
      expect(easedPlace(line, 2_031 + EASING_WINDOW_METRES - 100, speed).distance).toBe(
        2_031 + EASING_WINDOW_METRES - 100,
      );
    },
  );

  it('is the odometer at rest, on a straight, and with no bend in the window', () => {
    const line = racingLine(hairpin);
    expect(easedPlace(line, APEX, 0)).toEqual({ distance: APEX, speed: 0 });
    const straight = racingLine(northRoute(2_000, () => 0));
    expect(easedPlace(straight, 1_000, 18)).toEqual({ distance: 1_000, speed: 18 });
    // A speed that is not one — a room's frame is another device's word —
    // is taken as at rest, never as a place nobody can draw.
    expect(easedPlace(line, APEX, Number.NaN).distance).toBe(APEX);
    expect(easedPlace(line, APEX, -14)).toEqual({ distance: APEX, speed: -14 });
    // The hairpin is more than the window back: nothing to give back.
    const far = 650 + EASING_WINDOW_METRES;
    expect(easedPlace(line, far, 14)).toEqual({ distance: far, speed: 14 });
  });

  it('draws the rider at the eased place, with the camera on them', () => {
    const speed = 14;
    // #2422's rework: eased on the drawn path's line, and drawn ON that path.
    const line = drawnLine(hairpin);
    const place = easedPlace(line, APEX, speed);
    expect(place.distance).toBeLessThan(APEX - 1);
    const frame = frameOf(hairpin, stateAt(hairpin, APEX, speed));
    const rider = markerOf(frame, 'rider');
    // Read back through the frame: the rider is at the path's place for the
    // EASED odometer, not for the odometer…
    const eased = drawnLineAt(line, place.distance);
    const unEased = drawnLineAt(line, APEX);
    expect(rider.x).toBeCloseTo(eased.x, 6);
    expect(rider.z).toBeCloseTo(eased.z, 6);
    expect(Math.hypot(rider.x - unEased.x, rider.z - unEased.z)).toBeGreaterThan(1);
    // …facing along the path there…
    expect(rider.headingX).toBeCloseTo(eased.headingX, 6);
    expect(rider.headingZ).toBeCloseTo(eased.headingZ, 6);
    // …leaning at the eased speed…
    expect(Math.abs(combinedLean(rider.lean, rider.bodyLean))).toBeLessThanOrEqual(
      EASED_LEAN_RADIANS + 1e-9,
    );
    // …and the camera stands on them: its eye is ON the path, about the chase
    // distance behind the drawn rider, held no more than half a metre in from
    // the kerb (`scene.ts` §`eyeOnDrawnPath`), and it looks past them. ⚠️ Not
    // the pose's own `x`/`z` since #1994: in a bend that is the point the eye
    // looks through, 4.5 m toward the road ahead.
    const chase = chaseRider(
      frame.corridor,
      place.distance,
      lineOffsetAt(line, place.distance),
      line,
    );
    expect(chase.x).toBeCloseTo(rider.x, 6);
    expect(chase.z).toBeCloseTo(rider.z, 6);
    const eyeX = frame.camera.x - frame.camera.headingX * CAMERA_BEHIND_METRES;
    const eyeZ = frame.camera.z - frame.camera.headingZ * CAMERA_BEHIND_METRES;
    const behind = drawnLineAt(line, place.distance - CAMERA_BEHIND_METRES);
    expect(Math.hypot(eyeX - behind.x, eyeZ - behind.z)).toBeLessThanOrEqual(0.5);
    const toRider = Math.hypot(rider.x - eyeX, rider.z - eyeZ);
    expect(toRider).toBeGreaterThan(CAMERA_BEHIND_METRES - 1);
    expect(toRider).toBeLessThan(CAMERA_BEHIND_METRES + 0.5);
  });

  it('tells a caller with a camera of its own where the frame drew the rider — the demo’s tour', () => {
    const speed = 14;
    const input = {
      profile: hairpin,
      origin: corridorOrigin(hairpin),
      state: stateAt(hairpin, APEX, speed),
    };
    const frame = sceneFrame(input);
    const drawn = drawnRiderDistance(input);
    expect(drawn).toBe(easedPlace(drawnLine(hairpin), APEX, speed).distance);
    expect(drawn).toBeLessThan(APEX - 1);
    // A camera stood on it, on the path the frame drew the rider along, is
    // the frame's own chase camera, to the bit.
    const lateral = (placedRiders(input, frame.corridor)[0] as { lateral: number }).lateral;
    expect(cameraPose(frame.corridor, drawn, lateral, lateral, drawnPathOf(input))).toEqual(
      frame.camera,
    );
  });

  it('draws a pacer, a ghost and a room’s rider level with the rider exactly where the rider is drawn', () => {
    // Comparable: one rule, so the same odometer and speed ease to the same place.
    const route = hairpinRoute(10);
    const line: RacingLine = drawnLine(route);
    const speed = 14;
    const at = 420;
    const ghost = buildGhostTrack({ elapsedSeconds: [0, 1_000], distanceMetres: [0, 14_000] });
    const frame = frameOf(route, stateAt(route, at, speed, { distance: at, speed }, at / speed), {
      botDistance: at,
      ghost,
      remoteRiders: [{ riderId: 7, distanceMetres: at, speedMetresPerSecond: speed }],
    });
    const place = easedPlace(line, at, speed);
    expect(place.distance).toBeLessThan(at - 1);
    // Level on the drawn path at the eased place: each one's distance from
    // the rider is across the path only, the side-by-side spacing (#499).
    const on = drawnLineAt(drawnLine(route), place.distance);
    for (const kind of ['rider', 'bot', 'ghost', 'remote'] as const) {
      const marker = markerOf(frame, kind);
      const along = (marker.x - on.x) * on.headingX + (marker.z - on.z) * on.headingZ;
      expect(along).toBeCloseTo(0, 6);
    }
  });

  it('draws a room’s rider who is on the corridor where they are DRAWN, though their odometer is past it', () => {
    // The rider at rest before a 10 m hairpin, drawn at their odometer; a
    // room's rider descending out of it at 25 m/s, still giving back their lag
    // a few hundred metres on, with their odometer just past the frame's road.
    const route = hairpinRoute(10);
    const at = 380;
    const bare = frameOf(route, stateAt(route, at, 0));
    const far = (bare.corridor.centre[bare.corridor.centre.length - 1] as { along: number }).along;
    const odometer = far + 2;
    const place = easedPlace(drawnLine(route), odometer, 25);
    expect(place.distance).toBeLessThan(far - 5);
    const frame = frameOf(route, stateAt(route, at, 0), {
      remoteRiders: [{ riderId: 3, distanceMetres: odometer, speedMetresPerSecond: 25 }],
    });
    const on = drawnLineAt(drawnLine(route), place.distance);
    const remote = markerOf(frame, 'remote');
    expect(remote.x).toBeCloseTo(on.x, 6);
    expect(remote.z).toBeCloseTo(on.z, 6);
  });

  it('never eases a Delivery round’s rider or a lap race’s, whose drawn place is where the game meets them', () => {
    const speed = 14;
    const offOdometer = (extra: Partial<Parameters<typeof sceneFrame>[0]>): number => {
      const frame = frameOf(hairpin, stateAt(hairpin, APEX, speed), extra);
      return alongFrom(frame, markerOf(frame, 'rider'), APEX);
    };
    expect(offOdometer({ steeredLateral: 0 })).toBeCloseTo(0, 6);
    expect(offOdometer({ raceBots: [] })).toBeCloseTo(0, 6);
    expect(offOdometer({ uneased: true })).toBeCloseTo(0, 6);
    // The control: an ordinary ride IS eased here.
    expect(Math.abs(offOdometer({}))).toBeGreaterThan(1);
  });
});

describe('nothing a ride records or a trainer is sent moves — #1998', () => {
  it('rides the same distance at the same speed, and sends the same grades, eased or not', async () => {
    const ride = async (
      uneased: boolean,
    ): Promise<{ trace: number[]; written: SimulationParameters[]; drawn: number[] }> => {
      // A fresh LEVEL 10 m hairpin per ride, taken on 400 W at a speed the
      // easing slows the drawn rider for.
      const route = levelHairpinRoute(10, 400);
      const written: SimulationParameters[] = [];
      const session = createGradientSession({
        profile: route,
        control: {
          setSimulationParameters: async (parameters) => {
            written.push(parameters);
            return Promise.resolve();
          },
          letGo: async () => Promise.resolve({ kind: 'stopped' }),
        },
      });
      const simulation = new GameSimulation({
        profile: route,
        conditions: { totalMass: kilograms(80), airDensityKilogramsPerCubicMetre: 1.2 },
      });
      const origin = corridorOrigin(route);
      const trace: number[] = [];
      const drawn: number[] = [];
      // Advanced and drawn in the order `GameView`'s loop does it, a frame every 200 ms.
      for (let now = 0; now <= 75_000; now += 200) {
        simulation.advanceTo(now, { power: watts(400), live: true });
        session.sample(simulation.state.elapsed, simulation.state.ride.distance);
        const frame = sceneFrame({ profile: route, origin, state: simulation.state, uneased });
        drawn.push(frame.camera.x, frame.camera.z);
        trace.push(
          simulation.state.ride.distance,
          simulation.state.ride.speed,
          simulation.state.elapsed,
        );
        await session.settled();
      }
      // Through the bend and well out of it.
      expect(simulation.state.ride.distance).toBeGreaterThan(400 + 10 * Math.PI + 100);
      session.stop();
      return { trace, written, drawn };
    };
    const eased = await ride(false);
    const before = await ride(true);
    // What the ride records and what the trainer is sent are the same, to the bit.
    expect(eased.trace).toEqual(before.trace);
    expect(eased.written).toEqual(before.written);
    expect(eased.written.length).toBeGreaterThan(0);
    // Non-vacuity: the two rides were DRAWN differently, so the easing ran.
    expect(eased.drawn).not.toEqual(before.drawn);
  }, 30_000);
});

/**
 * One power trace, 400 W, ridden through the simulation and the gradient
 * session with a frame drawn every 200 ms in the order `GameView`'s loop does
 * it — #2422. `route` is called once per ride, so each ride has a fresh line.
 */
async function rideThrough(
  route: () => RouteProfile,
  uneased: boolean,
  untilMs: number,
): Promise<{
  trace: number[];
  written: SimulationParameters[];
  writtenAt: number[];
  drawn: number[];
  distance: number;
}> {
  const profile = route();
  const written: SimulationParameters[] = [];
  const writtenAt: number[] = [];
  let now = 0;
  const session = createGradientSession({
    profile,
    control: {
      setSimulationParameters: async (parameters) => {
        written.push(parameters);
        writtenAt.push(now);
        return Promise.resolve();
      },
      letGo: async () => Promise.resolve({ kind: 'stopped' }),
    },
  });
  const simulation = new GameSimulation({
    profile,
    conditions: { totalMass: kilograms(80), airDensityKilogramsPerCubicMetre: 1.2 },
  });
  const origin = corridorOrigin(profile);
  const trace: number[] = [];
  const drawn: number[] = [];
  for (; now <= untilMs; now += 200) {
    simulation.advanceTo(now, { power: watts(400), live: true });
    session.sample(simulation.state.elapsed, simulation.state.ride.distance);
    const frame = sceneFrame({ profile, origin, state: simulation.state, uneased });
    drawn.push(frame.camera.x, frame.camera.z);
    // The recorded distance, the HUD's speed and the clock.
    trace.push(
      simulation.state.ride.distance,
      simulation.state.ride.speed,
      simulation.state.elapsed,
    );
    await session.settled();
  }
  session.stop();
  return { trace, written, writtenAt, drawn, distance: simulation.state.ride.distance };
}

/** `v` in km/h as metres a second. */
const KMH = 1 / 3.6;

/** The steady-turn speed at {@link EASED_LEAN_RADIANS} on a radius: `√(g·tan 25°·R)`. */
function steadyTurnSpeed(radius: number): number {
  return Math.sqrt(
    STANDARD_GRAVITY_METRES_PER_SECOND_SQUARED * Math.tan(EASED_LEAN_RADIANS) * radius,
  );
}

/**
 * A line's tightest radius between two distances, from its own samples: the
 * line the scene eases on (`drawn-line.ts`, #2422's rework) unless `solved`
 * asks for `racingLine`'s.
 */
function tightestRadius(route: RouteProfile, from: number, to: number, solved = false): number {
  const line = solved ? racingLine(route) : drawnLine(route);
  let peak = 0;
  line.curvatures.forEach((curvature, index) => {
    const at = index * route.resolution;
    if (at >= from && at <= to) peak = Math.max(peak, Math.abs(curvature));
  });
  return 1 / peak;
}

/** The slowest a rider holding `speed` is drawn between two odometer readings, on the line the scene eases on. */
function slowestDrawn(route: RouteProfile, speed: number, from: number, to: number): number {
  const line = drawnLine(route);
  let slowest = Number.POSITIVE_INFINITY;
  for (let at = from; at <= to; at += 0.5) {
    slowest = Math.min(slowest, easedPlace(line, at, speed).speed);
  }
  return slowest;
}

/**
 * The corners #2422 is about: each, the stretch of odometer that rides
 * through it, and the same corner un-jittered, whose line's radius is the bound.
 */
const JUNCTIONS: readonly (readonly [string, RouteProfile, number, number, RouteProfile])[] = [
  [
    'a 90° junction drawn at one sample, the samples either side wandering 3 m',
    jitteredJunctionRoute(),
    1_200,
    1_900,
    jitteredJunctionRoute(90, 'right', 0),
  ],
  [
    'plannerCornerRoute(90), a 90° turn at one sample of a 25 m course',
    plannerCornerRoute(90),
    1_200,
    1_900,
    plannerCornerRoute(90),
  ],
];

describe('a corner an imported course draws at one sample — #2422', () => {
  it('is the case: the wandering samples pin the line solved on the route, and it turns the whole corner at one sample', () => {
    // Non-vacuity for everything below: `racingLine`'s line through the
    // jittered junction is far tighter than the same junction un-jittered —
    // the spike #1998 slowed for.
    expect(tightestRadius(jitteredJunctionRoute(), 1_400, 1_600, true)).toBeLessThan(7);
    expect(
      tightestRadius(jitteredJunctionRoute(90, 'right', 0), 1_400, 1_600, true),
    ).toBeGreaterThan(17);
    // The line the scene eases on, solved on the road as it is drawn and
    // paced by its own length, is not.
    expect(tightestRadius(jitteredJunctionRoute(), 1_400, 1_600)).toBeGreaterThan(15);
  });

  it.each(JUNCTIONS)(
    'draws a rider at 30–45 km/h through %s no slower than 90 % of the un-jittered line’s steady-turn speed at 25°',
    (_, route, from, to, clean) => {
      const floor = steadyTurnSpeed(tightestRadius(clean, 1_400, 1_600));
      for (const kmh of [30, 35, 40, 45]) {
        const speed = kmh * KMH;
        // Jitter may not deepen the slow-down by more than a tenth.
        expect(slowestDrawn(route, speed, from, to)).toBeGreaterThanOrEqual(
          0.9 * Math.min(speed, floor),
        );
      }
    },
  );

  it('still eases the junction itself: a rider faster than its steady-turn speed is drawn slower', () => {
    const floor = steadyTurnSpeed(
      tightestRadius(jitteredJunctionRoute(90, 'right', 0), 1_400, 1_600),
    );
    const slowest = slowestDrawn(jitteredJunctionRoute(), 45 * KMH, 1_200, 1_900);
    expect(slowest).toBeLessThan(45 * KMH - 1);
    expect(slowest).toBeLessThan(1.2 * floor);
  });

  it.each([
    ...JUNCTIONS,
    ...BENDS.map(([name, route, from, to]) => [name, route, from, to, route] as const),
  ])(
    'never surges through %s: no faster than the give-back, and never backwards between frames 50 ms apart',
    (_, route, from, to) => {
      const line = drawnLine(route);
      for (const kmh of [30, 35, 40, 45]) {
        const speed = kmh * KMH;
        // A frame every 50 ms at a held speed: the odometer moves speed × 0.05.
        const step = speed * 0.05;
        let previous = easedPlace(line, from, speed);
        for (let at = from + step; at <= to + 300; at += step) {
          const place = easedPlace(line, at, speed);
          expect(place.speed).toBeLessThanOrEqual(speed * (1 + GIVE_BACK_SHARE) + 1e-9);
          expect(place.distance).toBeGreaterThanOrEqual(previous.distance);
          previous = place;
        }
      }
    },
  );

  // Each DESCENDS 4 % to the corner and is level after it, so the grade a
  // trainer is sent changes at the corner: a write read at any place but the
  // odometer — the eased place is metres behind it there — is a different one.
  it.each([
    ['the jittered junction', () => jitteredJunctionRoute(90, 'right', 3, 12_345, -0.04)],
    ['plannerCornerRoute(90)', () => plannerCornerRoute(90, 'right', -0.04, 0)],
  ] as const)(
    'sends the same simulation-parameter writes at the same times through %s, and records the same ride, eased or not',
    async (_, route) => {
      const eased = await rideThrough(route, false, 150_000);
      const before = await rideThrough(route, true, 150_000);
      // Through the corner and well out of it.
      expect(eased.distance).toBeGreaterThan(1_700);
      expect(eased.written.length).toBeGreaterThan(0);
      expect(eased.written).toEqual(before.written);
      expect(eased.writtenAt).toEqual(before.writtenAt);
      expect(eased.trace).toEqual(before.trace);
      // Non-vacuity: the two rides were DRAWN differently, so the easing ran.
      expect(eased.drawn).not.toEqual(before.drawn);
    },
    60_000,
  );
});

describe('no trainer-path module can see the easing — #2422', () => {
  const easing = 'apps/web/src/game/bend-easing.ts';
  // #2422's rework: and the drawn path the easing reads.
  const path = 'apps/web/src/game/drawn-line.ts';
  const trainerPath = [...trainerCommandSeam(WIRING_SOURCE), ...GAME_TRAINER_MODULES];

  it('reaches bend-easing.ts from none of the trainer-command seam, gradient.ts, trainer-port.ts or ride/trainer.ts', () => {
    expect(trainerPath).toEqual(expect.arrayContaining([...GAME_TRAINER_MODULES]));
    expect(trainerPath.length).toBeGreaterThan(GAME_TRAINER_MODULES.length);
    expect(seamViolations(trainerPath, [easing, path])).toEqual([]);
  });

  it('is a walk that can fail: a planted import of the easing in gradient.ts is caught', () => {
    const gradient = 'apps/web/src/game/gradient.ts';
    const found = seamViolations(
      [gradient],
      [easing],
      plantedOver({
        [gradient]: "import { easedPlace } from './bend-easing';\nvoid easedPlace;\n",
      }),
    );
    expect(found).not.toEqual([]);
  });
});
