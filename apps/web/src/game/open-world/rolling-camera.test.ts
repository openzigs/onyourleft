// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **ADR 0089's camera rules on the rolling route** — #2982: C-1 to C-4
 * through a 90° junction turn chosen at the junction, and C-6, a choice that
 * never moves the camera. C-2 is held as a route ride holds it, and both miss
 * it at a hard junction: see "C-2 at a hard junction". C-5 is not here: see
 * "C-5" below.
 *
 * The camera is the one `GameView` draws: `chase-camera-testing.ts`
 * §`undampedCamera` (the three `scene.ts` calls `sceneFrame` makes for it,
 * with the drawn path and the bend easing), turned to `camera.ts`
 * §`dampedHeading` between frames by §`turnedPose`. Each frame reads the
 * road the way the ride loop does (`open-world/road.ts`): the view handed on
 * for the rider's ride distance, read at that distance minus its origin, in
 * that view's own local frame (`terrain.ts` §`corridorOrigin`).
 *
 * ⚠️ **A view's local frame is its first sample's**, so a new view moves the
 * frame, and a place's local metres with it. Everything compared across two
 * frames here (the target's step, C-6's eye and target) is first put in ONE
 * frame, the ride's start's, through the same projection `terrain.ts` uses.
 *
 * The streets are synthetic (`@onyourleft/domain/rolling-testing`), on flat
 * ground, so the bend is the junction's and nothing else's.
 */

import { describe, expect, it } from 'vitest';

import {
  JUNCTION_LOCK_METRES,
  RollingRoute,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  metresPerSecond,
  routeProfile,
  type GeographicPosition,
  type RollingEdge,
  type RouteProfile,
} from '@onyourleft/domain';
import { graphOf, streetThrough } from '@onyourleft/domain/rolling-testing';

import { RIDER_HEIGHT_METRES } from '../bicycle';
import {
  CAMERA_MAXIMUM_YAW_RATE,
  CAMERA_TARGET_AHEAD_METRES,
  REDUCED_MOTION_MAXIMUM_YAW_RATE,
  cameraRig,
  dampedHeading,
  projectToFrame,
  turnedPose,
  type GroundHeading,
} from '../camera';
import { undampedCamera } from '../chase-camera-testing';
import type { CameraPose } from '../port';
import { distanceToDrawnRoad } from '../road-grid';
import { cameraPose, drawnRiderDistance, placedRiders, type SceneInput } from '../scene';
import { atStartLine } from '../simulation';
import {
  ROAD_WIDTH_METRES,
  corridorOrigin,
  localGroundPosition,
  roadCorridor,
  type CorridorOrigin,
} from '../terrain';
import { alongView, OpenWorldRoad } from './road';

/** The owner's tablet, 16 : 10. */
const OWNERS_TABLET = 16 / 10;

/** C-2: half the road. `chase-camera-bend.test.ts` §`ON_THE_ROAD`. */
const ON_THE_ROAD = ROAD_WIDTH_METRES / 2;
/** C-3: the rider within 0.2 of the frame's middle. `chase-camera-bend.test.ts` §`RIDER_IN_THE_MIDDLE`. */
const RIDER_IN_THE_MIDDLE = 0.2;
/** C-4: the change in the target's step from one 60 fps frame to the next. §`TARGET_STEP_METRES`. */
const TARGET_STEP_METRES = 0.25;
/** A tolerance on a rate measured over one frame, radians a second. */
const RATE_ROUNDING = 1e-6;

/**
 * How near the rolling route's camera is to a route ride's on the same
 * streets: **1 cm**. ADR 0089 D-1: the same functions, on the same road. The
 * two profiles are sampled from the same street on grids a hair apart, which
 * is all the difference is.
 */
const SAME_AS_A_ROUTE_METRES = 0.01;

/**
 * How far past C-2's 3.5 m the target goes at a hard junction, at most:
 * **0.8 m**, over 4.26 m measured at 40 km/h. See "C-2 at a hard junction".
 */
const HARD_JUNCTION_OVERSHOOT_METRES = 0.8;

/**
 * How far past C-4's 0.25 m the target's step changes at a hard junction, at
 * most: **0.25 m**, over 0.45 m measured at 40 km/h.
 */
const HARD_JUNCTION_STEP_OVER_METRES = 0.25;

/**
 * How near the rolling route's change in the target's step is to a route
 * ride's on the same streets: **2 cm**, over 1.5 cm measured at 40 km/h and
 * 20 fps, where a frame is 0.56 m of road and the two grids a hair apart fall
 * differently on the corner.
 */
const SAME_AS_A_ROUTE_STEP_METRES = 0.02;

/**
 * C-6's tolerance, metres: **1 mm**. ADR 0089's amendment of 2026-11-20 reads
 * "by any amount" as "by no more than a stated floating-point tolerance, far
 * below anything drawn". A tablet pixel at the 25 m target is about 2.7 cm
 * (1280 px across a 70° view). ⚠️ **Not the bit**: measured, a swap moves the
 * eye by up to 33 µm and the target by up to 79 µm, because the drawn path
 * (`drawn-line.ts`) is solved over the whole view, the tail included, and a
 * tail 100 m and more ahead moves its line at the rider by micrometres.
 */
const C6_TOLERANCE_METRES = 1e-3;

/**
 * C-6's tolerance on the camera's heading: **1e-4**, a unit vector's
 * component — 2.5 mm across at the 25 m target.
 */
const C6_HEADING_TOLERANCE = 1e-4;

/**
 * The most a choice moves the camera as drawn, metres: **1**, over the 0.74 m
 * measured. See "moves the camera as drawn" below.
 */
const DRAWN_PATH_MOVES_AT_MOST_METRES = 1;

/**
 * C-6's margin, metres: **75**. The tail swaps no later than the 100 m lock,
 * and the target is at most 25 m ahead of the odometer (the drawn rider only
 * ever lags it), so the camera looks at least 75 m short of the changed road
 * (ADR 0089, the amendment of 2026-11-20).
 */
const C6_MARGIN_METRES = JUNCTION_LOCK_METRES - CAMERA_TARGET_AHEAD_METRES;

/** `terrain.ts` §`localGroundPosition`'s metres per degree of latitude. */
const METRES_PER_DEGREE_LATITUDE = 111_320;

/** `localGroundPosition` inverted: the place at local `x` (metres WEST) and `z` (north) of `origin`. */
function placeOf(origin: CorridorOrigin, x: number, z: number): GeographicPosition {
  const perDegreeLongitude =
    METRES_PER_DEGREE_LATITUDE * Math.cos((origin.latitude * Math.PI) / 180);
  return geographicPosition(
    degreesLatitude(origin.latitude + z / METRES_PER_DEGREE_LATITUDE),
    degreesLongitude(origin.longitude - x / perDegreeLongitude),
  );
}

/** Local metres in `from`'s frame, in `to`'s frame. */
function reframed(
  from: CorridorOrigin,
  to: CorridorOrigin,
  point: { readonly x: number; readonly z: number },
): { readonly x: number; readonly z: number } {
  return localGroundPosition(to, placeOf(from, point.x, point.z));
}

/** Where the junction is from the start: 2.6 km east, so the origin has moved by the time it is reached. */
const JUNCTION_EAST = 2_600;

/**
 * A street ridden east into a junction where one way goes on east, one turns
 * 90° left (north) and one 90° right (south). The way on east is the default.
 */
function junctionRoute(): RollingRoute {
  const flat = () => 0;
  const street = (
    id: string,
    from: string,
    to: string,
    stops: [number, number][],
  ): RollingEdge => ({
    id,
    from,
    to,
    points: streetThrough(stops, flat),
    roadClass: 1,
  });
  const into = street('in', 'w', 'j', [
    [0, 0],
    [JUNCTION_EAST, 0],
  ]);
  return new RollingRoute(
    graphOf([
      into,
      street('north', 'j', 'n', [
        [JUNCTION_EAST, 0],
        [JUNCTION_EAST, 3_000],
      ]),
      street('east', 'j', 'e', [
        [JUNCTION_EAST, 0],
        [JUNCTION_EAST + 3_000, 0],
      ]),
      street('south', 'j', 's', [
        [JUNCTION_EAST, 0],
        [JUNCTION_EAST, -3_000],
      ]),
    ]),
    into,
  );
}

/** The scene's input for the rider at ride distance `ride` on `view`, as `GameView` builds it. */
function inputOn(
  view: { readonly profile: RouteProfile; readonly origin: number },
  ride: number,
  speed: number,
): SceneInput {
  const { profile } = view;
  const along = alongView(view, ride);
  return {
    profile,
    origin: corridorOrigin(profile),
    state: {
      ...atStartLine(profile),
      ride: { speed: metresPerSecond(speed), distance: metres(along) },
    },
    riderDistance: along,
  };
}

/** A road ridden to `ride` the way the ride loop rides one: followed every 10 m on the way. */
function roadAt(ride: number): OpenWorldRoad {
  const road = new OpenWorldRoad(junctionRoute());
  for (let at = 0; at <= ride; at += 10) road.follow(at);
  road.follow(ride);
  return road;
}

/** The junction on `road` ahead of `ride`. */
function junctionAhead(road: OpenWorldRoad, ride: number) {
  const junction = road.route.junctionsAfter(ride)[0];
  if (junction === undefined) throw new Error('no junction ahead');
  return junction;
}

/** What a ride through the junction did to the camera. */
interface Ridden {
  readonly offRoad: number;
  readonly turnRate: number;
  readonly turned: number;
  readonly riderOffCentre: number;
  readonly targetStep: number;
  /** How many views the ride was drawn on. */
  readonly views: number;
}

function turnBetween(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/**
 * Rides into the junction from `from` metres before it to `to` metres past
 * it, at `speed` and `fps`, turning left onto the north street: chosen
 * `choiceBefore` metres before the junction, while the camera is riding, as a
 * rider's press would be. The road is followed every frame, as `GameView`
 * follows it, and every frame is drawn on the view handed on for it.
 */
function rideThroughJunction(options: {
  readonly speed: number;
  readonly fps: number;
  readonly reducedMotion: boolean;
  /**
   * Ride the same streets as a ROUTE instead: one profile of the street in and
   * the north street, imported as a route ride's is, never followed. The
   * control for C-2 (below).
   */
  readonly asRoute?: boolean;
}): Ridden {
  const before = JUNCTION_EAST - 150;
  const road = roadAt(before);
  const junction = junctionAhead(road, before);
  const north = junction.ways.find((way) => way.turnDegrees < -45)?.edge.id as string;
  const choiceAt = junction.distance - JUNCTION_LOCK_METRES - 20;
  const end = junction.distance + 150;
  const common = corridorOrigin(road.view.profile);
  const route =
    options.asRoute === true
      ? {
          profile: routeProfile(
            streetThrough(
              [
                [0, 0],
                [JUNCTION_EAST, 0],
                [JUNCTION_EAST, 3_000],
              ],
              () => 0,
            ),
          ),
          origin: 0,
        }
      : undefined;
  const seconds = 1 / options.fps;
  let chosen = false;
  let held: GroundHeading | undefined;
  let yaw: number | undefined;
  let offRoad = 0;
  let turnRate = 0;
  let turned = 0;
  let riderOffCentre = 0;
  let targetStep = 0;
  let previous: { readonly x: number; readonly z: number } | undefined;
  let previousStep: { readonly x: number; readonly z: number } | undefined;
  const views = new Set<RouteProfile>();
  for (let ride = before; ride <= end; ride += options.speed * seconds) {
    if (route === undefined && !chosen && ride >= choiceAt) {
      expect(road.route.choose(junction.distance, north, ride)).toBe('swapped');
      chosen = true;
    }
    road.follow(ride);
    const input = inputOn(route ?? road.view, ride, options.speed);
    views.add(input.profile);
    const pose: CameraPose = undampedCamera(input);
    held = dampedHeading(held, pose, seconds, options.reducedMotion);
    const rig = cameraRig(turnedPose(pose, held));
    // C-2: the target on the drawn road, in this view's own frame.
    offRoad = Math.max(
      offRoad,
      distanceToDrawnRoad(input.profile, input.origin, rig.target.x, rig.target.z, 80),
    );
    // C-4: the change in the target's step, in the start's frame.
    const asked = reframed(input.origin, common, cameraRig(pose).target);
    if (previous !== undefined) {
      const step = { x: asked.x - previous.x, z: asked.z - previous.z };
      if (previousStep !== undefined) {
        targetStep = Math.max(
          targetStep,
          Math.hypot(step.x - previousStep.x, step.z - previousStep.z),
        );
      }
      previousStep = step;
    }
    previous = asked;
    // C-1: the turn rate.
    const now = Math.atan2(held.headingX, held.headingZ);
    if (yaw !== undefined) {
      const turn = Math.abs(turnBetween(yaw, now));
      turnRate = Math.max(turnRate, turn / seconds);
      turned += turn;
    }
    yaw = now;
    // C-3: the drawn rider, half their height up, in the tablet's frame.
    const corridor = roadCorridor(input.profile, input.origin, drawnRiderDistance(input));
    const marker = placedRiders(input, corridor)[0]?.marker;
    if (marker === undefined) throw new Error('no rider drawn');
    const riderAt = projectToFrame(rig, OWNERS_TABLET, {
      x: marker.x,
      y: marker.y + RIDER_HEIGHT_METRES / 2,
      z: marker.z,
    });
    riderOffCentre = Math.max(riderOffCentre, Math.abs((riderAt?.left ?? Infinity) - 0.5));
  }
  return { offRoad, turnRate, turned, riderOffCentre, targetStep, views: views.size };
}

describe('ADR 0089 C-1 to C-4 through a 90° junction turn on the rolling route — #2982', () => {
  for (const kmh of [30, 40]) {
    for (const fps of [60, 20]) {
      it(`turns left at the junction at ${kmh} km/h and ${fps} fps: capped, the rider in the middle, as a route ride`, () => {
        const ridden = rideThroughJunction({ speed: kmh / 3.6, fps, reducedMotion: false });
        // The ride was drawn on more than one view: the choice handed on a new one.
        expect(ridden.views).toBeGreaterThan(1);
        // C-1: never faster than the cap, and the camera turned the whole 90°.
        expect(ridden.turnRate).toBeLessThanOrEqual(CAMERA_MAXIMUM_YAW_RATE + RATE_ROUNDING);
        expect(ridden.turned).toBeGreaterThan(Math.PI / 2 - 0.05);
        // C-3: the rider within 0.2 of the frame's middle.
        expect(ridden.riderOffCentre).toBeLessThan(RIDER_IN_THE_MIDDLE);
        // C-2 and C-4, as a route ride over the same streets has them (D-1):
        // the same camera on the same road. See "C-2 and C-4 at a hard
        // junction" below for how far both are from the rule.
        const asRoute = rideThroughJunction({
          speed: kmh / 3.6,
          fps,
          reducedMotion: false,
          asRoute: true,
        });
        expect(Math.abs(ridden.offRoad - asRoute.offRoad)).toBeLessThan(SAME_AS_A_ROUTE_METRES);
        expect(Math.abs(ridden.targetStep - asRoute.targetStep)).toBeLessThan(
          SAME_AS_A_ROUTE_STEP_METRES,
        );
      });
    }
  }

  it('turns more gently for a rider who asked for reduced motion: the 60° a second cap', () => {
    const ridden = rideThroughJunction({ speed: 30 / 3.6, fps: 60, reducedMotion: true });
    expect(ridden.turnRate).toBeLessThanOrEqual(REDUCED_MOTION_MAXIMUM_YAW_RATE + RATE_ROUNDING);
    expect(ridden.riderOffCentre).toBeLessThan(RIDER_IN_THE_MIDDLE);
  });

  it('C-2 and C-4 at a hard junction: missed, as a route ride misses them, and by how much', () => {
    // ⚠️ **Neither holds at a junction drawn from map streets, on a route ride
    // or on this one**, and this pins the measurement, not the rule.
    //
    // - C-2: the undamped target stays on the tarmac (2.9 m from the
    //   centreline at the corner); `camera.ts` §`CAMERA_YAW_SETTLE_SECONDS`'
    //   0.1 s trail takes the drawn one to 3.95 m at 30 km/h and 4.26 m at 40,
    //   against C-2's 3.5 m.
    // - C-4: the target's step changes by 0.30 m a 60 fps frame at 30 km/h and
    //   0.45 m at 40, against C-4's 0.25 m.
    //
    // `chase-camera-bend.test.ts` holds both through a planner's corner,
    // sampled every 25 m and smoothed, which one node where two streets meet
    // is much sharper than. The fix is the camera's, and #2989's: until it
    // lands, this says by how much, and turns red when it does.
    for (const kmh of [30, 40]) {
      const ridden = rideThroughJunction({ speed: kmh / 3.6, fps: 60, reducedMotion: false });
      expect(ridden.offRoad).toBeGreaterThan(ON_THE_ROAD);
      expect(ridden.offRoad).toBeLessThan(ON_THE_ROAD + HARD_JUNCTION_OVERSHOOT_METRES);
      expect(ridden.targetStep).toBeGreaterThan(TARGET_STEP_METRES);
      expect(ridden.targetStep).toBeLessThan(TARGET_STEP_METRES + HARD_JUNCTION_STEP_OVER_METRES);
    }
  });
});

/** What a choice made `short` metres before the junction moved: the camera on the road, and as drawn. */
interface Moved {
  readonly short: number;
  /** The camera stood on the road's corridor, on its centreline: `scene.ts` §`cameraPose` alone. */
  readonly road: { readonly eye: number; readonly target: number; readonly heading: number };
  /** The camera `GameView` draws, on the drawn path (`drawn-line.ts`). */
  readonly drawn: { readonly eye: number; readonly target: number; readonly heading: number };
  /** How far short of the junction the camera looked. */
  readonly margin: number;
}

/** Every choice of another way at the junction, from 400 m before it to just outside the lock. */
function choicesMoved(): readonly Moved[] {
  const speed = 30 / 3.6;
  const moved: Moved[] = [];
  for (let short = 400; short > JUNCTION_LOCK_METRES; short -= 23) {
    const ride = JUNCTION_EAST - short;
    const road = roadAt(ride);
    const junction = junctionAhead(road, ride);
    const common = corridorOrigin(road.view.profile);
    for (const way of junction.ways) {
      if (way.edge.id === junction.taken) continue;
      const beforeInput = inputOn(road.view, ride, speed);
      const before = { drawn: undampedCamera(beforeInput) };
      const corridorBefore = cameraPose(
        roadCorridor(beforeInput.profile, beforeInput.origin, alongView(road.view, ride)),
        alongView(road.view, ride),
        0,
      );
      expect(road.route.choose(junction.distance, way.edge.id, ride)).toBe('swapped');
      const swapped = new OpenWorldRoad(road.route);
      const afterInput = inputOn(swapped.view, ride, speed);
      const after = { drawn: undampedCamera(afterInput) };
      const corridorAfter = cameraPose(
        roadCorridor(afterInput.profile, afterInput.origin, alongView(swapped.view, ride)),
        alongView(swapped.view, ride),
        0,
      );
      const apart = (
        a: CameraPose,
        aFrom: CorridorOrigin,
        b: CameraPose,
        bFrom: CorridorOrigin,
      ) => {
        const eyeA = reframed(aFrom, common, a);
        const eyeB = reframed(bFrom, common, b);
        const targetA = reframed(aFrom, common, cameraRig(a).target);
        const targetB = reframed(bFrom, common, cameraRig(b).target);
        return {
          eye: Math.hypot(eyeB.x - eyeA.x, eyeB.z - eyeA.z),
          target: Math.hypot(targetB.x - targetA.x, targetB.z - targetA.z),
          heading: Math.hypot(b.headingX - a.headingX, b.headingZ - a.headingZ),
        };
      };
      moved.push({
        short,
        road: apart(corridorBefore, beforeInput.origin, corridorAfter, afterInput.origin),
        drawn: apart(before.drawn, beforeInput.origin, after.drawn, afterInput.origin),
        margin: junction.distance - (ride + before.drawn.targetAheadMetres),
      });
      // Back to the way it was, for the next way.
      road.route.choose(junction.distance, junction.taken, ride);
    }
  }
  return moved;
}

describe('ADR 0089 C-6: a choice never moves the camera — #2982', () => {
  const moved = choicesMoved();

  it('compares a choice of each other way, at every distance one can be made from', () => {
    expect(moved.length).toBeGreaterThan(20);
    expect(Math.min(...moved.map((each) => each.short))).toBeLessThan(JUNCTION_LOCK_METRES + 5);
  });

  it('never moves the camera stood on the road: the 75 m margin holds, and the eye and target stay put', () => {
    for (const each of moved) {
      // The margin the rule rests on: the target is 75 m or more short of the junction.
      expect(each.margin, `${each.short} m before`).toBeGreaterThanOrEqual(C6_MARGIN_METRES);
      expect(each.road.eye, `${each.short} m before`).toBeLessThan(C6_TOLERANCE_METRES);
      expect(each.road.target, `${each.short} m before`).toBeLessThan(C6_TOLERANCE_METRES);
      expect(each.road.heading, `${each.short} m before`).toBeLessThan(C6_HEADING_TOLERANCE);
    }
  });

  it('moves the camera as drawn, on the drawn path, by up to three-quarters of a metre: C-6 is not met there', () => {
    // ⚠️ **A defect this measures, and #2989 fixes.** The drawn path is
    // solved over the whole view (`racing-line.ts`, a least-peak-curvature
    // line over every sample), so the line the rider is drawn on, and the
    // camera stood behind them on it, sets up for the junction's turn more
    // than 100 m before it. A choice that swaps a left turn for a right one
    // moves both: by 0.31 m (eye) and 0.74 m (target) at 101 m before the
    // junction, falling by about 2.5 times every 23 m, under 1 mm only from
    // about 290 m out. ADR 0089's argument for C-6 counts the target's 25 m
    // and the drawn rider's lag, and not this. Pinned here so that the fix is
    // seen to land: the last bound turns red when it does.
    const far = moved.filter((each) => each.short >= 300);
    expect(far.length).toBeGreaterThan(2);
    for (const each of far) {
      expect(each.drawn.eye, `${each.short} m before`).toBeLessThan(C6_TOLERANCE_METRES);
      expect(each.drawn.target, `${each.short} m before`).toBeLessThan(C6_TOLERANCE_METRES);
    }
    const worst = Math.max(...moved.map((each) => each.drawn.target));
    expect(worst).toBeLessThan(DRAWN_PATH_MOVES_AT_MOST_METRES);
    expect(worst).toBeGreaterThan(C6_TOLERANCE_METRES);
  });
});

/*
 * ## C-5 — the eye is never inside a building
 *
 * Not tested here, and not built by #2982: an open-world ride draws no
 * building yet. Its world is read block by block (ADR 0090) and has no
 * corridor (`GameView` §the corridor effect), so `SceneInput.mappedBuildings`
 * is never handed one, and the building volumes C-5 tests the eye against do
 * not exist in the frame. ADR 0089's constraints table puts their footprints
 * and drawn heights in the frame with #2901 and #2902, and the pull-in is
 * built and held to C-5 there, against the buildings it must clear (#2990).
 */
