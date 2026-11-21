// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **ADR 0089's camera rules on the rolling route** — #2982: C-1 to C-4
 * through a 90° junction turn chosen at the junction, and C-6, a choice that
 * never moves the camera. C-5 is not here: see "C-5" below.
 *
 * #2989 made C-2, C-4 and C-6's drawn half hold here, where #2982 had pinned
 * them missed: the look-ahead eased onto its full 25 m (`scene.ts`
 * §`easedReach`) and the heading's settle cut to 0.04 s (`camera.ts`
 * §`CAMERA_YAW_SETTLE_SECONDS`) for C-2 and C-4, and a new view's line eased
 * in from the one drawn before it (`line-ease.ts`) for C-6.
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
import { drawnLine, type DrawnLine } from '../drawn-line';
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
import { LINE_EASE_METRES } from './line-ease';
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
 * How near the rolling route's change in the target's step is to a route
 * ride's on the same streets: **3 cm**, over 2.0 cm measured at 30 km/h and
 * 20 fps, where a frame is 0.42 m of road and the two grids a hair apart fall
 * differently on the corner. ⚠️ 2 cm over 1.5 cm until #2989's camera, whose
 * 0.04 s settle follows the two grids' corners more closely.
 */
const SAME_AS_A_ROUTE_STEP_METRES = 0.03;

/**
 * C-6's tolerance, metres: **1 mm**. ADR 0089's amendment of 2026-11-20 reads
 * "by any amount" as "by no more than a stated floating-point tolerance, far
 * below anything drawn". A tablet pixel at the 25 m target is about 2.7 cm
 * (1280 px across a 70° view). ⚠️ **Not the bit**: a swap rebuilds the
 * view, and may move its local frame, which the comparison undoes through a
 * projection. Measured on 2026-11-21, through `road.ts` §`drawnPath`: the
 * drawn eye, target and rider move by nothing over every choice here, and
 * the camera stood on the road by 1.2 nm. (Before #2989's ease, the drawn
 * camera moved by up to 33 µm 300 m out, and by 0.74 m at the lock.)
 */
const C6_TOLERANCE_METRES = 1e-3;

/**
 * C-6's tolerance on the camera's heading: **1e-4**, a unit vector's
 * component — 2.5 mm across at the 25 m target.
 */
const C6_HEADING_TOLERANCE = 1e-4;

/**
 * The least the control's un-eased line moves the camera by, metres: **0.5**,
 * under the 0.74 m measured at the target 101 m before the junction. See
 * "without the ease" below: a fixture whose choice moved the line by less
 * would hold C-6 with no ease at all.
 */
const UNEASED_MOVES_AT_LEAST_METRES = 0.5;

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

/**
 * The scene's input for the rider at ride distance `ride` on `view`, as
 * `GameView` builds it: on an open-world ride with the road's drawn path
 * (`road.ts` §`drawnPath`), and on a route ride with none, so the scene
 * builds the route's own.
 */
function inputOn(
  view: { readonly profile: RouteProfile; readonly origin: number },
  ride: number,
  speed: number,
  drawnPath?: DrawnLine,
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
    drawnPath,
  };
}

/**
 * A road ridden to `ride` the way the ride loop rides one: followed every
 * 10 m on the way, and its path drawn at `ride`, as the frame there draws it.
 */
function roadAt(ride: number): OpenWorldRoad {
  const road = new OpenWorldRoad(junctionRoute());
  for (let at = 0; at <= ride; at += 10) road.follow(at);
  road.follow(ride);
  road.drawnPath(ride);
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
  /** How many frames drew a path eased in from an earlier view's, rather than the view's own line. */
  readonly eased: number;
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
  let eased = 0;
  for (let ride = before; ride <= end; ride += options.speed * seconds) {
    if (route === undefined && !chosen && ride >= choiceAt) {
      expect(road.route.choose(junction.distance, north, ride)).toBe('swapped');
      chosen = true;
    }
    road.follow(ride);
    const path = route === undefined ? road.drawnPath(ride) : undefined;
    if (path !== undefined && path !== drawnLine(road.view.profile)) eased += 1;
    const input = inputOn(route ?? road.view, ride, options.speed, path);
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
  return { offRoad, turnRate, turned, riderOffCentre, targetStep, views: views.size, eased };
}

describe('ADR 0089 C-1 to C-4 through a 90° junction turn on the rolling route — #2982', () => {
  for (const kmh of [30, 40]) {
    for (const fps of [60, 20]) {
      it(`turns left at the junction at ${kmh} km/h and ${fps} fps: capped, on the road, the rider in the middle, as a route ride`, () => {
        const ridden = rideThroughJunction({ speed: kmh / 3.6, fps, reducedMotion: false });
        // The ride was drawn on more than one view: the choice handed on a
        // new one, and its line was eased in on the way to the junction.
        expect(ridden.views).toBeGreaterThan(1);
        expect(ridden.eased).toBeGreaterThan(0);
        // C-1: never faster than the cap, and the camera turned the whole 90°.
        expect(ridden.turnRate).toBeLessThanOrEqual(CAMERA_MAXIMUM_YAW_RATE + RATE_ROUNDING);
        expect(ridden.turned).toBeGreaterThan(Math.PI / 2 - 0.05);
        // C-2: the target on the road all the way round (#2989).
        expect(ridden.offRoad).toBeLessThan(ON_THE_ROAD);
        // C-3: the rider within 0.2 of the frame's middle.
        expect(ridden.riderOffCentre).toBeLessThan(RIDER_IN_THE_MIDDLE);
        // C-4 is stated at 60 fps (#2989).
        if (fps === 60) expect(ridden.targetStep).toBeLessThan(TARGET_STEP_METRES);
        // And as a route ride over the same streets has them (D-1): the same
        // camera on the same road.
        const asRoute = rideThroughJunction({
          speed: kmh / 3.6,
          fps,
          reducedMotion: false,
          asRoute: true,
        });
        expect(asRoute.offRoad).toBeLessThan(ON_THE_ROAD);
        if (fps === 60) expect(asRoute.targetStep).toBeLessThan(TARGET_STEP_METRES);
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

  it('turns more gently for a rider who asked for reduced motion, and still looks at the road: C-2 at 40 km/h', () => {
    // The 60° a second cap, and the hard junction at 40 km/h never asks for
    // more: the camera still looks at the road (C-2) and its target slides (C-4).
    const ridden = rideThroughJunction({ speed: 40 / 3.6, fps: 60, reducedMotion: true });
    expect(ridden.turnRate).toBeLessThanOrEqual(REDUCED_MOTION_MAXIMUM_YAW_RATE + RATE_ROUNDING);
    expect(ridden.offRoad).toBeLessThan(ON_THE_ROAD);
    expect(ridden.targetStep).toBeLessThan(TARGET_STEP_METRES);
  });
});

/** How far a choice moved the camera's eye, its target and its heading, and the drawn rider. */
interface Apart {
  readonly eye: number;
  readonly target: number;
  readonly heading: number;
  readonly rider: number;
}

/** What a choice made `short` metres before the junction moved: the camera on the road, and as drawn. */
interface Moved {
  readonly short: number;
  /** The camera stood on the road's corridor, on its centreline: `scene.ts` §`cameraPose` alone. */
  readonly road: Apart;
  /** The camera and rider `GameView` draws, on the road's drawn path (`road.ts` §`drawnPath`). */
  readonly drawn: Apart;
  /** The control: the same, had the new view's own line been drawn at once, un-eased. */
  readonly uneased: Apart;
  /** How far short of the junction the camera looked. */
  readonly margin: number;
  /** Whether the choice moved the view's local frame, which the eased path is put in. */
  readonly reframed: boolean;
}

/** The drawn rider's place on the road, for `input`. */
function riderOf(input: SceneInput): { readonly x: number; readonly z: number } {
  const corridor = roadCorridor(input.profile, input.origin, drawnRiderDistance(input));
  const marker = placedRiders(input, corridor)[0]?.marker;
  if (marker === undefined) throw new Error('no rider drawn');
  return marker;
}

/** Every choice of another way at the junction, from 400 m before it to just outside the lock. */
function choicesMoved(): readonly Moved[] {
  const speed = 30 / 3.6;
  const moved: Moved[] = [];
  for (let short = 400; short > JUNCTION_LOCK_METRES; short -= 23) {
    const ride = JUNCTION_EAST - short;
    const ways = junctionAhead(roadAt(ride), ride);
    for (const way of ways.ways) {
      if (way.edge.id === ways.taken) continue;
      // A road ridden here and drawn here, as the frame before the press drew it.
      const road = roadAt(ride);
      const junction = junctionAhead(road, ride);
      const common = corridorOrigin(road.view.profile);
      const beforeInput = inputOn(road.view, ride, speed, road.drawnPath(ride));
      const before = undampedCamera(beforeInput);
      const corridorBefore = cameraPose(
        roadCorridor(beforeInput.profile, beforeInput.origin, alongView(road.view, ride)),
        alongView(road.view, ride),
        0,
      );
      // The press, and the frame after it, as `GameView` draws it: the road
      // followed, and its path drawn, at the same ride distance.
      expect(road.route.choose(junction.distance, way.edge.id, ride)).toBe('swapped');
      expect(road.follow(ride)).toBeDefined();
      const afterInput = inputOn(road.view, ride, speed, road.drawnPath(ride));
      const after = undampedCamera(afterInput);
      const uneasedInput = inputOn(road.view, ride, speed, drawnLine(road.view.profile));
      const uneased = undampedCamera(uneasedInput);
      const corridorAfter = cameraPose(
        roadCorridor(afterInput.profile, afterInput.origin, alongView(road.view, ride)),
        alongView(road.view, ride),
        0,
      );
      const apart = (
        a: CameraPose,
        aInput: SceneInput,
        b: CameraPose,
        bInput: SceneInput,
      ): Apart => {
        const at = (input: SceneInput, point: { readonly x: number; readonly z: number }) =>
          reframed(input.origin, common, point);
        const eyeA = at(aInput, a);
        const eyeB = at(bInput, b);
        const targetA = at(aInput, cameraRig(a).target);
        const targetB = at(bInput, cameraRig(b).target);
        const riderA = at(aInput, riderOf(aInput));
        const riderB = at(bInput, riderOf(bInput));
        return {
          eye: Math.hypot(eyeB.x - eyeA.x, eyeB.z - eyeA.z),
          target: Math.hypot(targetB.x - targetA.x, targetB.z - targetA.z),
          heading: Math.hypot(b.headingX - a.headingX, b.headingZ - a.headingZ),
          rider: Math.hypot(riderB.x - riderA.x, riderB.z - riderA.z),
        };
      };
      moved.push({
        short,
        road: apart(corridorBefore, beforeInput, corridorAfter, afterInput),
        drawn: apart(before, beforeInput, after, afterInput),
        uneased: apart(before, beforeInput, uneased, uneasedInput),
        margin: junction.distance - (ride + before.targetAheadMetres),
        reframed:
          beforeInput.origin.latitude !== afterInput.origin.latitude ||
          beforeInput.origin.longitude !== afterInput.origin.longitude,
      });
    }
  }
  return moved;
}

describe('ADR 0089 C-6: a choice never moves the camera — #2982, #2989', () => {
  const moved = choicesMoved();

  it('compares a choice of each other way, at every distance one can be made from', () => {
    expect(moved.length).toBeGreaterThan(20);
    expect(Math.min(...moved.map((each) => each.short))).toBeLessThan(JUNCTION_LOCK_METRES + 5);
    // Some choices trim the road behind, which moves the view's local frame:
    // the eased path is compared in the start's frame across that move too.
    expect(moved.some((each) => each.reframed)).toBe(true);
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

  it('never moves the camera or the rider as drawn either: the new line is eased in from the one drawn', () => {
    for (const each of moved) {
      expect(each.drawn.eye, `${each.short} m before`).toBeLessThan(C6_TOLERANCE_METRES);
      expect(each.drawn.target, `${each.short} m before`).toBeLessThan(C6_TOLERANCE_METRES);
      expect(each.drawn.heading, `${each.short} m before`).toBeLessThan(C6_HEADING_TOLERANCE);
      expect(each.drawn.rider, `${each.short} m before`).toBeLessThan(C6_TOLERANCE_METRES);
    }
  });

  it('without the ease, the new view’s own line would move the camera as drawn by up to three-quarters of a metre', () => {
    // The control, and the defect #2989 was filed on: the drawn path is
    // solved over the whole view (`racing-line.ts`), so its line sets up for
    // the junction's turn more than 100 m before it, and a swapped tail moves
    // the rider and the camera behind them, most at the lock: 0.31 m (eye)
    // and 0.74 m (target) at 101 m, falling about 2.5 times every 23 m.
    const worst = Math.max(...moved.map((each) => each.uneased.target));
    expect(worst).toBeGreaterThan(UNEASED_MOVES_AT_LEAST_METRES);
    expect(worst).toBeLessThan(1);
  });

  it('reaches the new view’s own line once the ease is ridden, from the latest choice there is', () => {
    const ride = JUNCTION_EAST - JUNCTION_LOCK_METRES - 1;
    const road = roadAt(ride);
    const junction = junctionAhead(road, ride);
    const way = junction.ways.find((each) => each.edge.id !== junction.taken)?.edge.id as string;
    expect(road.route.choose(junction.distance, way, ride)).toBe('swapped');
    road.follow(ride);
    const own = drawnLine(road.view.profile);
    expect(road.drawnPath(ride)).not.toBe(own);
    expect(road.drawnPath(ride + LINE_EASE_METRES / 2)).not.toBe(own);
    expect(road.drawnPath(ride + LINE_EASE_METRES)).toBe(own);
    // Done 49 m and more before the junction, before the camera turns for it.
    expect(junction.distance - (ride + LINE_EASE_METRES)).toBeGreaterThanOrEqual(49);
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
