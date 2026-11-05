// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `chase-camera-testing.ts` is the camera `GameView` draws — #545, since #1994.
 *
 * The near-plane rides take their camera from it, so a stepper that damped
 * the wrong heading, at the wrong pace, or not at all would let every ride
 * there pass on a camera nothing draws. It is held here to an ORACLE that
 * shares none of its shortcuts: a whole `sceneFrame` built for every frame,
 * damped as `GameView.tsx`'s loop damps it (`camera.ts` §`dampedHeading`, then
 * §`turnedPose`), frame by frame.
 */

import { describe, expect, it } from 'vitest';

import { metres, metresPerSecond, type RouteProfile } from '@onyourleft/domain';

import { dampedHeading, turnedPose, type GroundHeading } from './camera';
import { DRAWN_CAMERA_STEPS_PER_METRE, drawnCamera } from './chase-camera-testing';
import type { CameraPose } from './port';
import { hairpinRoute } from './route-fixtures-testing';
import { sceneFrame, type SceneInput } from './scene';
import { atStartLine } from './simulation';
import { corridorOrigin } from './terrain';

/** The rides' speed, metres a second. */
const SPEED = 8;

function inputsOf(profile: RouteProfile): (distance: number) => SceneInput {
  const origin = corridorOrigin(profile);
  const start = atStartLine(profile);
  return (distance) => ({
    profile,
    origin,
    state: { ...start, ride: { speed: metresPerSecond(SPEED), distance: metres(distance) } },
  });
}

/**
 * The oracle: the camera `GameView` draws at each whole metre from `from` to
 * `to`, with a whole `sceneFrame` built for every frame between, damped from
 * the first of them.
 */
function oracle(
  inputAt: (distance: number) => SceneInput,
  from: number,
  to: number,
): Map<number, CameraPose> {
  const frames = DRAWN_CAMERA_STEPS_PER_METRE;
  const seconds = 1 / frames / SPEED;
  const drawn = new Map<number, CameraPose>();
  let held: GroundHeading | undefined;
  for (let frame = from * frames; frame <= to * frames; frame += 1) {
    const camera = sceneFrame(inputAt(frame / frames)).camera;
    held = dampedHeading(held, camera, seconds, false);
    if (frame % frames === 0) drawn.set(frame / frames, turnedPose(camera, held));
  }
  return drawn;
}

/** The farthest apart two cameras' headings are, as a unit vector's components. */
function apart(a: CameraPose, b: CameraPose): number {
  return Math.max(
    Math.abs(a.headingX - b.headingX),
    Math.abs(a.headingZ - b.headingZ),
    Math.abs(a.x - b.x),
    Math.abs(a.z - b.z),
  );
}

describe('the camera GameView draws, over a ride sampled a metre at a time (#545)', () => {
  // A 20 m hairpin climbing at 4 %, the bend from 400 m: the camera turns
  // through half a turn, and the damping lags it all the way round.
  const inputAt = inputsOf(hairpinRoute(20));

  it('is the oracle’s, frame for frame, through a hairpin — and not sceneFrame’s undamped one', () => {
    // The stepper starts its damping 30 m before its first sampled metre.
    const expected = oracle(inputAt, 340, 480);
    const drawn = drawnCamera(inputAt, SPEED);
    let lagged = 0;
    for (let distance = 370; distance <= 480; distance += 1) {
      const built = sceneFrame(inputAt(distance)).camera;
      const camera = drawn(distance, built);
      expect(
        apart(camera, expected.get(distance) as CameraPose),
        `${String(distance)} m`,
      ).toBeLessThan(1e-9);
      lagged = Math.max(lagged, apart(camera, built));
    }
    // The control: the damping is measured. Undamped, the two would be one.
    expect(lagged).toBeGreaterThan(0.01);
  }, 60_000);

  it('meets the first sampled metre already settled, damped from 30 m before it', () => {
    const expected = oracle(inputAt, 380, 420);
    const drawn = drawnCamera(inputAt, SPEED);
    for (const distance of [410, 411, 412]) {
      const camera = drawn(distance, sceneFrame(inputAt(distance)).camera);
      expect(apart(camera, expected.get(distance) as CameraPose)).toBeLessThan(1e-9);
    }
  }, 60_000);

  it('refuses a camera that is not the one sceneFrame built there', () => {
    const drawn = drawnCamera(inputAt, SPEED);
    const built = sceneFrame(inputAt(420)).camera;
    expect(() => drawn(420, { ...built, x: built.x + 0.01 })).toThrow(/rebuilt for the damping/);
  });

  it('refuses to be stepped backwards', () => {
    const drawn = drawnCamera(inputAt, SPEED);
    drawn(420, sceneFrame(inputAt(420)).camera);
    expect(() => drawn(419, sceneFrame(inputAt(419)).camera)).toThrow(/forward only/);
  });
});
