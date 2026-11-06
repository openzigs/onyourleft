// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The chase camera through a bend — #1994.
 *
 * The owner rode a GPX course in the realistic world and the camera looked off
 * the road in tight bends, into fields and junctions, and swung sharply as the
 * road turned: it aimed 25 m straight on along the tangent of the corridor
 * piece under the rider. These ride the camera through a 90° corner, a
 * hairpin and a turnaround, frame by frame, the way `GameView` does —
 * `scene.ts` §`cameraPose` for each frame, `camera.ts` §`dampedHeading` and
 * §`turnedPose` between frames, `camera.ts` §`cameraRig` for where it looks —
 * and ask three things of every frame:
 *
 * - **the target is on the road**: within half the road's width of the drawn
 *   road's centreline (`road-grid.ts` §`distanceToDrawnRoad`);
 * - **the turn rate is bounded**: the heading turns no faster than
 *   `CAMERA_MAXIMUM_YAW_RATE`, or the reduced-motion cap;
 * - **the rider is still in the frame**, near its middle — the cost of looking
 *   through a bend from an eye that stays behind the rider
 *   (`scene.ts` §`cameraPose` says why it stays).
 *
 * Each fixture also carries a CONTROL: the camera as it was, aimed along the
 * tangent, measured on the same frames, has to land in the field. A fixture
 * that did not bend enough for that would pass the assertions above for the
 * wrong reason.
 */

import { describe, expect, it } from 'vitest';

import type { RouteProfile } from '@onyourleft/domain';

import {
  CAMERA_MAXIMUM_YAW_RATE,
  CAMERA_TARGET_AHEAD_METRES,
  REDUCED_MOTION_MAXIMUM_YAW_RATE,
  cameraRig,
  dampedHeading,
  projectToFrame,
  turnedPose,
  type GroundHeading,
} from './camera';
import { RIDER_HEIGHT_METRES } from './bicycle';
import { distanceToDrawnRoad } from './road-grid';
import { hairpinRoute, plannerCornerRoute } from './route-fixtures-testing';
import { cameraPose } from './scene';
import { ROAD_WIDTH_METRES, corridorOrigin, drawnRoadFrame, roadCorridor } from './terrain';

/** The owner's tablet, 16 : 10. */
const OWNERS_TABLET = 16 / 10;

/** 30 km/h, in metres a second. */
const THIRTY_KMH = 30 / 3.6;

/** What a ride through a stretch of road did to the camera. */
interface Ridden {
  /** The farthest the camera's target was from the drawn road's centreline, metres. */
  readonly offRoad: number;
  /** The fastest the camera's heading turned between two frames, radians a second. */
  readonly turnRate: number;
  /** How far the heading turned in all, radians — so a camera that never turned cannot pass. */
  readonly turned: number;
  /** The control: the farthest a target 25 m along the TANGENT was from the road. */
  readonly tangentOffRoad: number;
  /**
   * The farthest the rider was from the middle of a 16 : 10 frame — the
   * owner's tablet — across, as a share of the frame's width: 0 in the middle,
   * 0.5 at its edge.
   */
  readonly riderOffCentre: number;
  /**
   * The biggest change in how far the target `cameraPose` asked for moved from
   * one frame to the next, metres, before the damping. The target legitimately
   * travels several times the rider's speed (25 m of lever), so it is the
   * CHANGE in that step that tells a slide from a jump (`scene.ts`
   * §`roadTarget` bisects between its one-metre steps for the slide).
   */
  readonly targetStep: number;
}

/** The short way round from `from` to `to`, radians, in (−π, π]. */
function turnBetween(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/**
 * Rides `profile` from `from` to `to` metres at `speed`, drawing `fps` frames
 * a second, as `GameView`'s loop does.
 */
function ride(
  profile: RouteProfile,
  from: number,
  to: number,
  options: { readonly speed: number; readonly fps: number; readonly reducedMotion: boolean },
): Ridden {
  const origin = corridorOrigin(profile);
  const seconds = 1 / options.fps;
  const roadAt = (x: number, z: number): number => distanceToDrawnRoad(profile, origin, x, z, 80);
  let held: GroundHeading | undefined;
  let yaw: number | undefined;
  let offRoad = 0;
  let turnRate = 0;
  let turned = 0;
  let tangentOffRoad = 0;
  let riderOffCentre = 0;
  let targetStep = 0;
  let previous: { readonly x: number; readonly z: number } | undefined;
  let previousStep: { readonly x: number; readonly z: number } | undefined;
  for (let along = from; along <= to; along += options.speed * seconds) {
    const corridor = roadCorridor(profile, origin, along);
    const pose = cameraPose(corridor, along, 0);
    held = dampedHeading(held, pose, seconds, options.reducedMotion);
    const rig = cameraRig(turnedPose(pose, held));
    offRoad = Math.max(offRoad, roadAt(rig.target.x, rig.target.z));
    // The target `cameraPose` asked for, before the damping smooths it.
    const asked = cameraRig(pose).target;
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
    const now = Math.atan2(held.headingX, held.headingZ);
    if (yaw !== undefined) {
      const turn = Math.abs(turnBetween(yaw, now));
      turnRate = Math.max(turnRate, turn / seconds);
      turned += turn;
    }
    yaw = now;
    // The rider, on the drawn road (this ride's line is its middle), and the
    // road's tangent there — the right-hand normal turned back a quarter.
    const road = drawnRoadFrame(profile, origin, along);
    if (road === undefined) throw new Error('the drawn road has no direction here');
    const riderAt = projectToFrame(rig, OWNERS_TABLET, {
      x: road.x,
      y: pose.y + RIDER_HEIGHT_METRES / 2,
      z: road.z,
    });
    riderOffCentre = Math.max(riderOffCentre, Math.abs((riderAt?.left ?? Infinity) - 0.5));
    // The control: a target 25 m straight on along that tangent.
    tangentOffRoad = Math.max(
      tangentOffRoad,
      roadAt(
        road.x + road.normalZ * CAMERA_TARGET_AHEAD_METRES,
        road.z - road.normalX * CAMERA_TARGET_AHEAD_METRES,
      ),
    );
  }
  return { offRoad, turnRate, turned, tangentOffRoad, riderOffCentre, targetStep };
}

/** Half the road: a target nearer the centreline than this is on the tarmac. */
const ON_THE_ROAD = ROAD_WIDTH_METRES / 2;

/**
 * How far from the middle of the owner's tablet's frame the rider may be
 * drawn in a bend, as a share of its width: **0.2**, the middle 40 %.
 * `scene.ts` §`cameraPose` keeps the eye where it was and holds the rider
 * within 20° of the axis, measured at 0.16 of a 16 : 10 frame in the corner and
 * 0.18 in the hairpin; looking at the road 25 m on regardless put the rider
 * 0.36 off in the corner and OUT of the frame (0.63) in the hairpin.
 */
const RIDER_IN_THE_MIDDLE = 0.2;

/** The farthest the target may move in a 60 fps frame, metres: a few centimetres. */
const TARGET_STEP_METRES = 0.25;

/** A tolerance on a rate measured over one frame, radians a second. */
const RATE_ROUNDING = 1e-6;

describe('the chase camera through a 90° corner — #1994', () => {
  // `plannerCornerRoute`'s corner is at 1 500 m, sampled every 25 m the way a
  // planner exports a road and smoothed the way the road is drawn.
  const corner = plannerCornerRoute(90);

  for (const fps of [60, 20]) {
    it(`looks at the road all the way round, and turns no faster than the cap, at ${fps} fps`, () => {
      const ridden = ride(corner, 1_400, 1_600, { speed: THIRTY_KMH, fps, reducedMotion: false });
      expect(ridden.tangentOffRoad).toBeGreaterThan(10);
      expect(ridden.offRoad).toBeLessThan(ON_THE_ROAD);
      expect(ridden.turnRate).toBeLessThanOrEqual(CAMERA_MAXIMUM_YAW_RATE + RATE_ROUNDING);
      expect(ridden.turned).toBeGreaterThan(Math.PI / 2 - 0.05);
      expect(ridden.riderOffCentre).toBeLessThan(RIDER_IN_THE_MIDDLE);
    });
  }

  it('and the same, more gently, for a rider who asked for reduced motion', () => {
    const ridden = ride(corner, 1_400, 1_600, { speed: THIRTY_KMH, fps: 60, reducedMotion: true });
    expect(ridden.offRoad).toBeLessThan(ON_THE_ROAD);
    expect(ridden.turnRate).toBeLessThanOrEqual(REDUCED_MOTION_MAXIMUM_YAW_RATE + RATE_ROUNDING);
  });
});

describe('the chase camera through a hairpin — #1994', () => {
  // 400 m north, 180° round a 10 m radius at 400 m, and back south.
  const hairpin = hairpinRoute(10);

  for (const fps of [60, 20]) {
    it(`looks at the road all the way round, and turns no faster than the cap, at ${fps} fps`, () => {
      const ridden = ride(hairpin, 330, 500, { speed: THIRTY_KMH, fps, reducedMotion: false });
      expect(ridden.tangentOffRoad).toBeGreaterThan(10);
      expect(ridden.offRoad).toBeLessThan(ON_THE_ROAD);
      expect(ridden.turnRate).toBeLessThanOrEqual(CAMERA_MAXIMUM_YAW_RATE + RATE_ROUNDING);
      expect(ridden.turned).toBeGreaterThan(Math.PI - 0.05);
      expect(ridden.riderOffCentre).toBeLessThan(RIDER_IN_THE_MIDDLE);
    });
  }

  it('and the same, more gently, for a rider who asked for reduced motion', () => {
    const ridden = ride(hairpin, 330, 500, { speed: THIRTY_KMH, fps: 60, reducedMotion: true });
    expect(ridden.offRoad).toBeLessThan(ON_THE_ROAD);
    expect(ridden.turnRate).toBeLessThanOrEqual(REDUCED_MOTION_MAXIMUM_YAW_RATE + RATE_ROUNDING);
  });
});

describe('the chase camera target slides along the road — #1994', () => {
  it('speeds up and slows down by decimetres a frame, not by a metre, through the hairpin', () => {
    // Without the bisection in `scene.ts` §`roadTarget` the target steps a
    // whole metre of road at once as the farthest point that keeps the rider
    // in the frame changes: 0.81 m here against 0.16 m with it. Ridden to
    // 420 m, short of the exit: at 428 m, as the rider comes out, a reach
    // that was out of bounds comes back in and the target jumps 1.2 m to it
    // (a second feasible stretch opening, which bisecting cannot smooth);
    // the damping in `camera.ts` §`dampedHeading` takes that one.
    const ridden = ride(hairpinRoute(10), 330, 420, {
      speed: THIRTY_KMH,
      fps: 60,
      reducedMotion: false,
    });
    expect(ridden.targetStep).toBeLessThan(TARGET_STEP_METRES);
  });
});

describe('the chase camera at the end of a point-to-point route — #1994', () => {
  it('never puts its target nearer than 10 m, where the road 25 m on is not there', () => {
    // The corridor clamps on the route's last point, so 3 m from the end the
    // road "25 m further along" is 3 m away. Aimed there, the camera would tip
    // down at its own rider's front wheel.
    const route = plannerCornerRoute(90);
    const origin = corridorOrigin(route);
    const end = route.totalDistance as number;
    for (const short of [20, 8, 3]) {
      const along = end - short;
      const pose = cameraPose(roadCorridor(route, origin, along), along, 0);
      const target = cameraRig(pose).target;
      const out = Math.hypot(target.x - pose.x, target.z - pose.z);
      expect(out).toBeGreaterThanOrEqual(Math.max(short, 10) - 0.05);
      expect(out).toBeLessThanOrEqual(Math.max(short, 10) + 0.05);
    }
  });
});

describe('the chase camera at a turnaround — #1994', () => {
  // U-turns across the road: 180° round a 2 m and a 0.5 m radius, the two
  // legs 4 m and 1 m apart — what an out-and-back GPX course does at its far
  // end.
  const turnarounds = { '4 m': hairpinRoute(2), '1 m': hairpinRoute(0.5) };

  it('turns round with the rider, at no more than the cap, and keeps them in the frame', () => {
    // Where the road comes back past the rider, the heading toward the road
    // ahead goes through half a turn in a few metres; the damping makes a
    // turn of it, about the rider (`camera.ts` §`turnedPose`).
    // ⚠️ The target leaves the road while it turns, which a turnaround cannot
    // avoid, so this asks for the rate and for the rider.
    for (const reducedMotion of [false, true]) {
      for (const [apart, turnaround] of Object.entries(turnarounds)) {
        const ridden = ride(turnaround, 330, 470, { speed: THIRTY_KMH, fps: 60, reducedMotion });
        const cap = reducedMotion ? REDUCED_MOTION_MAXIMUM_YAW_RATE : CAMERA_MAXIMUM_YAW_RATE;
        expect(ridden.turnRate, apart).toBeLessThanOrEqual(cap + RATE_ROUNDING);
        expect(ridden.turned, apart).toBeGreaterThan(Math.PI - 0.05);
        expect(ridden.riderOffCentre, apart).toBeLessThan(0.5);
      }
    }
  });
});
