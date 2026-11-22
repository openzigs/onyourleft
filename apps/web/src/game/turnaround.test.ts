// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A turnaround at ONE recorded point, ridden frame by frame — #3045.
 *
 * The owner rode an out-and-back on the tablet whose far end turns 172° in one
 * 10 m step, and the turn was not smooth. `route-fixtures-testing.ts`
 * §`reversalRoute` is that turn, from arithmetic. These ride it the way
 * `GameView` draws it — `scene.ts` §`sceneFrame` for each frame, `camera.ts`
 * §`dampedHeading` and §`dampedLookAhead` between frames, §`turnedPose` and
 * §`cameraRig` for where the camera looks — and read, every frame, the drawn
 * rider's heading and place, and the camera's heading and pitch.
 *
 * Measured before #3045 on these frames at 60 fps: the drawn rider swung round
 * at 137°/s at 172° and 240°/s at 180°, on a loop 1.2 m and 0.65 m in radius
 * at its tightest whose tip stood 3 m past the end of the drawn road — faster
 * than the camera ever turns, so the camera trailed and then caught up — and
 * coming out, the camera's gaze pitched up by 5° in one frame as its
 * look-ahead jumped from 9 m to 23 m. `drawn-line.ts` §`uTurnSamples` and
 * `camera.ts` §`dampedLookAhead` are the two changes.
 */

import { describe, expect, it } from 'vitest';

import { metres, type RouteProfile } from '@onyourleft/domain';

import {
  CAMERA_MAXIMUM_YAW_RATE,
  cameraRig,
  dampedHeading,
  dampedLookAhead,
  turnedPose,
  type GroundHeading,
} from './camera';
import { drawnLine, uTurnSamples } from './drawn-line';
import {
  REVERSAL_AT_METRES,
  hairpinRoute,
  outAndBackRoute,
  plannerCornerRoute,
  reversalRoute,
} from './route-fixtures-testing';
import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import { corridorOrigin, drawnRoadPosition } from './terrain';

/** What riding through the turnaround did, frame by frame. */
interface Ridden {
  /** The fastest the drawn rider's heading turned between two frames, radians a second. */
  readonly riderTurnRate: number;
  /** How far the drawn rider's heading turned in all, radians. */
  readonly riderTurned: number;
  /** The fastest the camera's heading turned, radians a second. */
  readonly cameraTurnRate: number;
  /** How far the camera's heading turned in all, radians. */
  readonly cameraTurned: number;
  /** The fastest the camera's pitch changed, radians a second, as drawn. */
  readonly pitchRate: number;
  /** The same, of the pitch each frame asked for before the damping: the control. */
  readonly askedPitchRate: number;
  /** The largest change in the drawn rider's step from one frame to the next, metres. */
  readonly riderJerk: number;
  /**
   * How far the drawn rider went past the drawn road's turning point along
   * the way out, metres: below nought is short of it, on the tarmac.
   */
  readonly pastTheTurn: number;
}

/** The short way round from `from` to `to`, radians, in (−π, π]. */
function turnBetween(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/** The camera's pitch below level, radians. */
function pitchOf(rig: ReturnType<typeof cameraRig>): number {
  return Math.atan2(
    rig.eye.y - rig.target.y,
    Math.hypot(rig.target.x - rig.eye.x, rig.target.z - rig.eye.z),
  );
}

/** Rides `profile` through its turnaround at `kmh`, drawing `fps` frames a second, as `GameView` does. */
function rideThrough(profile: RouteProfile, kmh: number, fps: number): Ridden {
  const origin = corridorOrigin(profile);
  const start = atStartLine(profile);
  // Where the drawn road turns back. The way out runs due north, along +z.
  const turningPoint = drawnRoadPosition(profile, origin, REVERSAL_AT_METRES).z;
  const speed = kmh / 3.6;
  const seconds = 1 / fps;
  let heading: GroundHeading | undefined;
  let lookAhead: number | undefined;
  let last:
    | {
        readonly riderYaw: number;
        readonly cameraYaw: number;
        readonly pitch: number;
        readonly askedPitch: number;
        readonly x: number;
        readonly z: number;
      }
    | undefined;
  let lastStep: { readonly x: number; readonly z: number } | undefined;
  const ridden = {
    riderTurnRate: 0,
    riderTurned: 0,
    cameraTurnRate: 0,
    cameraTurned: 0,
    pitchRate: 0,
    askedPitchRate: 0,
    riderJerk: 0,
    pastTheTurn: Number.NEGATIVE_INFINITY,
  };
  for (
    let along = REVERSAL_AT_METRES - 40;
    along <= REVERSAL_AT_METRES + 50;
    along += speed * seconds
  ) {
    const frame = sceneFrame({
      profile,
      origin,
      state: { ...start, ride: { ...start.ride, distance: metres(along), speed: speed as never } },
    });
    heading = dampedHeading(heading, frame.camera, seconds, false);
    lookAhead = dampedLookAhead(lookAhead, frame.camera.targetAheadMetres, seconds);
    const rider = frame.markers[0] as {
      readonly x: number;
      readonly z: number;
      readonly headingX: number;
      readonly headingZ: number;
    };
    const now = {
      riderYaw: Math.atan2(rider.headingX, rider.headingZ),
      cameraYaw: Math.atan2(heading.headingX, heading.headingZ),
      pitch: pitchOf(cameraRig(turnedPose(frame.camera, heading, lookAhead))),
      askedPitch: pitchOf(cameraRig(turnedPose(frame.camera, heading))),
      x: rider.x,
      z: rider.z,
    };
    ridden.pastTheTurn = Math.max(ridden.pastTheTurn, rider.z - turningPoint);
    if (last !== undefined) {
      const riderTurn = Math.abs(turnBetween(last.riderYaw, now.riderYaw));
      const cameraTurn = Math.abs(turnBetween(last.cameraYaw, now.cameraYaw));
      ridden.riderTurnRate = Math.max(ridden.riderTurnRate, riderTurn / seconds);
      ridden.riderTurned += riderTurn;
      ridden.cameraTurnRate = Math.max(ridden.cameraTurnRate, cameraTurn / seconds);
      ridden.cameraTurned += cameraTurn;
      ridden.pitchRate = Math.max(ridden.pitchRate, Math.abs(now.pitch - last.pitch) / seconds);
      ridden.askedPitchRate = Math.max(
        ridden.askedPitchRate,
        Math.abs(now.askedPitch - last.askedPitch) / seconds,
      );
      const step = { x: now.x - last.x, z: now.z - last.z };
      if (lastStep !== undefined) {
        ridden.riderJerk = Math.max(
          ridden.riderJerk,
          Math.hypot(step.x - lastStep.x, step.z - lastStep.z),
        );
      }
      lastStep = step;
    }
    last = now;
  }
  return ridden;
}

/** A tolerance on a rate measured over one frame, radians a second. */
const RATE_ROUNDING = 1e-6;

/**
 * The fastest the camera's pitch may change through a turnaround: **20°/s**.
 * `camera.ts` §`CAMERA_LOOK_AHEAD_RATE` holds it to about 15°/s on these
 * frames; undamped it is several hundred.
 */
const MOST_PITCH_RATE = (20 * Math.PI) / 180;

/**
 * The largest change in the drawn rider's step from one frame to the next,
 * metres: **2 cm**. A jump in place would be tens of centimetres; measured
 * through these turns at 60 fps, under 1 cm.
 */
const MOST_RIDER_JERK_METRES = 0.02;

const TURNAROUNDS = [
  ['172° to the right, as the owner’s', reversalRoute(172, 'right')],
  ['172° to the left', reversalRoute(172, 'left')],
  ['180°, straight back', reversalRoute(180)],
] as const;

const rides = new Map<string, Ridden>();

/** {@link rideThrough}, once a case: several assertions read one ride. */
function ride(name: string, profile: RouteProfile, kmh: number, fps: number): Ridden {
  const key = [name, String(kmh), String(fps)].join(' ');
  const known = rides.get(key);
  if (known !== undefined) return known;
  const ridden = rideThrough(profile, kmh, fps);
  rides.set(key, ridden);
  return ridden;
}

describe('a turnaround at one recorded point — #3045', () => {
  for (const [name, turnaround] of TURNAROUNDS) {
    for (const kmh of [20, 40]) {
      it(`turns the drawn rider round no faster than the camera can follow: ${name}, ${String(kmh)} km/h`, () => {
        const ridden = ride(name, turnaround, kmh, 60);
        // It did turn round: a rider who never turned would pass the bound.
        expect(ridden.riderTurned).toBeGreaterThan((160 * Math.PI) / 180);
        expect(ridden.riderTurnRate).toBeLessThanOrEqual(CAMERA_MAXIMUM_YAW_RATE);
        expect(ridden.riderJerk).toBeLessThan(MOST_RIDER_JERK_METRES);
      });
    }

    it(`turns the drawn rider round short of the end of the drawn road: ${name}`, () => {
      expect(ride(name, turnaround, 20, 60).pastTheTurn).toBeLessThan(0);
    });

    for (const [kmh, fps] of [
      [20, 60],
      [40, 20],
    ] as const) {
      it(`turns the camera round with no jump in heading or pitch: ${name}, ${String(fps)} fps`, () => {
        const ridden = ride(name, turnaround, kmh, fps);
        expect(ridden.cameraTurned).toBeGreaterThan((160 * Math.PI) / 180);
        expect(ridden.cameraTurnRate).toBeLessThanOrEqual(CAMERA_MAXIMUM_YAW_RATE + RATE_ROUNDING);
        // The control: the pitch the frames ask for jumps coming out.
        expect(ridden.askedPitchRate).toBeGreaterThan(MOST_PITCH_RATE * 2);
        expect(ridden.pitchRate).toBeLessThan(MOST_PITCH_RATE);
      });
    }
  }

  it('draws a U-turn only where the path turns back at one point', () => {
    const resolution: number = reversalRoute().resolution;
    expect(drawnLine(reversalRoute()).uTurns).toEqual([
      Math.round(REVERSAL_AT_METRES / resolution),
    ]);
    // A bend ridden round over several samples is the spline's, as before.
    for (const bend of [hairpinRoute(10), plannerCornerRoute(143), outAndBackRoute()]) {
      expect(drawnLine(bend).uTurns).toEqual([]);
    }
  });

  it('draws no U-turn too narrow to be rounder than the loop, nor two at once', () => {
    // Out 10 m apart and back 2 m across: a half-turn through those would be tighter.
    const narrow = uTurnSamples(new Float64Array([0, 0, 2]), new Float64Array([0, 10, 0]));
    expect(narrow).toEqual([]);
    // The same, 4 m across, is one.
    expect(uTurnSamples(new Float64Array([0, 0, 4]), new Float64Array([0, 10, 0]))).toEqual([1]);
    // Back and forth twice in a row: the first is drawn, and its neighbour is its own.
    const twice = uTurnSamples(new Float64Array([0, 0, 4, 4]), new Float64Array([0, 10, 0, 10]));
    expect(twice).toEqual([1]);
  });
});
