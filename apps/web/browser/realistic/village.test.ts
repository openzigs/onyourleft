// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { cameraRig, horizontalSpread } from '../../src/game/camera';
import type { SceneFrame } from '../../src/game/port';
import { INITIAL_QUALITY, worldRung } from '../../src/game/quality';
import { corridorOrigin } from '../../src/game/terrain';
import { rideFrame } from './frame';
import { VILLAGE_HOLD_METRES, villageRoute } from './route';
import { frameCensus, inView } from './village';

/** A frame held on the village road, whose camera the cases below look through. */
function held(): SceneFrame {
  const profile = villageRoute();
  return rideFrame({
    profile,
    origin: corridorOrigin(profile),
    distance: VILLAGE_HOLD_METRES,
    elapsed: 0,
    rung: worldRung({ realistic: true, quality: INITIAL_QUALITY }),
  });
}

describe('what the owner’s page counts as in frame — #1559', () => {
  const frame = held();
  const { eye, target } = cameraRig(frame.camera);
  const ahead = { x: target.x - eye.x, z: target.z - eye.z };
  const length = Math.hypot(ahead.x, ahead.z);
  const forward = { x: ahead.x / length, z: ahead.z / length };
  // Square to the view, in the ground plane.
  const side = { x: -forward.z, z: forward.x };
  const at = (depth: number, across: number, up = 0) => ({
    x: eye.x + forward.x * depth + side.x * across,
    y: target.y + up,
    z: eye.z + forward.z * depth + side.z * across,
  });

  it('holds a point up the road and refuses one behind the camera', () => {
    expect(inView(frame, 16 / 10, at(50, 0))).toBe(true);
    expect(inView(frame, 16 / 10, at(-50, 0))).toBe(false);
  });

  it('ends at the lens’s edge, on either side, wider on a wider frame', () => {
    const spread = horizontalSpread(16 / 10);
    expect(inView(frame, 16 / 10, at(100, 0.95 * spread * 100))).toBe(true);
    expect(inView(frame, 16 / 10, at(100, -0.95 * spread * 100))).toBe(true);
    expect(inView(frame, 16 / 10, at(100, 1.05 * spread * 100))).toBe(false);
    expect(inView(frame, 16 / 10, at(100, -1.05 * spread * 100))).toBe(false);
    // The same point, on a frame wide enough to take it in.
    expect(inView(frame, 2.2, at(100, 1.05 * spread * 100))).toBe(true);
  });

  it('ends above the frame’s top as well as at its sides', () => {
    expect(inView(frame, 16 / 10, at(20, 0, 100))).toBe(false);
  });

  it('counts what the frame carries, and only that', () => {
    const census = frameCensus(frame, 16 / 10);
    const churches = frame.scatter.filter((item) => item.kind === 'church').length;
    expect(census.structures.church.carried).toBe(churches);
    expect(census.structures.church.inView).toBeLessThanOrEqual(churches);
    expect(census.streets).toBe(frame.streets.length);
    // The control: a frame emptied of its village counts none of it.
    const empty = frameCensus({ ...frame, scatter: [], streets: [] }, 16 / 10);
    expect(empty.structures.church).toEqual({ carried: 0, inView: 0 });
    expect(empty.streets).toBe(0);
    expect(empty.pavementTriangles).toBe(0);
    expect(empty.furniture['lamp-post']).toEqual({ carried: 0, inView: 0 });
  });
});
