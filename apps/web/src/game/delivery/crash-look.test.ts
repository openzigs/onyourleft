// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2454: a crash in a Delivery round is drawn — the rider goes down where
 * they are and gets back up on the bike — and under reduced motion is a still
 * crash pose. The first half reads `crash-look.ts`' own timeline; the second
 * draws it through `scene.ts` §`sceneFrame` and reads the rider's marker back.
 */

import { describe, expect, it } from 'vitest';

import { metres, metresPerSecond, seconds } from '@onyourleft/domain';

import type { RiderMarker } from '../port';
import { northRoute } from '../route-fixtures-testing';
import { sceneFrame, type SceneInput } from '../scene';
import { atStartLine } from '../simulation';
import { corridorOrigin } from '../terrain';
import {
  CRASH_FALL_SECONDS,
  CRASH_LEAN_RADIANS,
  CRASH_RISE_AT_SECONDS,
  CRASH_SECONDS,
  crashFrom,
  crashShare,
  crashSideFor,
  crashedRoll,
} from './crash-look';

const FPS = 60;

/** The share at every 60 Hz frame from the crash to past its end. */
function timeline(reducedMotion: boolean): (number | undefined)[] {
  const out: (number | undefined)[] = [];
  for (let frame = 0; frame <= (CRASH_SECONDS + 0.2) * FPS; frame += 1) {
    out.push(crashShare(frame / FPS, reducedMotion));
  }
  return out;
}

describe('the crash’s timeline — crashShare', () => {
  it('falls from the bike, lies, and gets back up within about one to two seconds', () => {
    expect(CRASH_SECONDS).toBeGreaterThanOrEqual(1);
    expect(CRASH_SECONDS).toBeLessThanOrEqual(2);
    expect(crashShare(0, false)).toBe(0);
    expect(crashShare(CRASH_FALL_SECONDS / 2, false)).toBeCloseTo(0.25, 12);
    expect(crashShare(CRASH_FALL_SECONDS, false)).toBe(1);
    expect(crashShare((CRASH_FALL_SECONDS + CRASH_RISE_AT_SECONDS) / 2, false)).toBe(1);
    expect(crashShare(CRASH_RISE_AT_SECONDS, false)).toBe(1);
    expect(crashShare(CRASH_SECONDS - 1e-9, false)).toBeCloseTo(0, 6);
    // Over: the ride is drawn as it is.
    expect(crashShare(CRASH_SECONDS, false)).toBeUndefined();
    expect(crashShare(10, false)).toBeUndefined();
  });

  it('moves by a bounded amount a frame: no jump going down, or getting back up', () => {
    const shares = timeline(false);
    let largest = 0;
    for (let index = 1; index < shares.length; index += 1) {
      largest = Math.max(largest, Math.abs((shares[index] ?? 0) - (shares[index - 1] ?? 0)));
    }
    // The fall's last frame is its fastest: 2·(1/60)/0.45 ≈ 0.074 of the way.
    expect(largest).toBeLessThan(0.15);
    expect(largest).toBeGreaterThan(0);
  });

  it('is a still crash pose under reduced motion: down or up, never between', () => {
    const shares = timeline(true);
    expect(shares.every((share) => share === undefined || share === 1)).toBe(true);
    expect(crashShare(0, true)).toBe(1);
    expect(crashShare(CRASH_RISE_AT_SECONDS - 1e-6, true)).toBe(1);
    // Over as the rider is up: never an upright pose that the HUD still calls "Crashed".
    expect(crashShare(CRASH_RISE_AT_SECONDS, true)).toBeUndefined();
    expect(crashShare((CRASH_RISE_AT_SECONDS + CRASH_SECONDS) / 2, true)).toBeUndefined();
    expect(crashShare(CRASH_SECONDS, true)).toBeUndefined();
  });

  it('draws nothing before the crash or for a time that is not a number', () => {
    for (const time of [-0.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(crashShare(time, false)).toBeUndefined();
      expect(crashShare(time, true)).toBeUndefined();
    }
  });
});

describe('a crash while one is drawn — crashFrom', () => {
  it('keeps the crash being drawn, so a rider already down does not jump up to fall again', () => {
    const first = crashFrom(undefined, 1_000, 1);
    expect(first).toEqual({ atMs: 1_000, side: 1 });
    expect(crashFrom(first, 1_000 + 500, -1)).toBe(first);
    expect(crashFrom(first, 1_000 + CRASH_SECONDS * 1000 - 1, -1)).toBe(first);
    // Once it is over, the next is drawn from its own start.
    expect(crashFrom(first, 1_000 + CRASH_SECONDS * 1000, -1)).toEqual({
      atMs: 1_000 + CRASH_SECONDS * 1000,
      side: -1,
    });
  });
});

describe('which way, and how far — crashSideFor and crashedRoll', () => {
  it('falls toward the edge of the road the rider’s lane is on, the right from the middle', () => {
    expect(crashSideFor(-1.75)).toBe(-1);
    expect(crashSideFor(0)).toBe(1);
    expect(crashSideFor(1.75)).toBe(1);
  });

  it('is the ride’s own roll at nought, and the bicycle on its side with the body along it at one', () => {
    const ride = { bicycle: 0.2, body: -0.05 };
    expect(crashedRoll(ride, 0, 1)).toEqual(ride);
    expect(crashedRoll(ride, 1, 1)).toEqual({ bicycle: CRASH_LEAN_RADIANS, body: 0 });
    expect(crashedRoll(ride, 1, -1)).toEqual({ bicycle: -CRASH_LEAN_RADIANS, body: 0 });
    const half = crashedRoll(ride, 0.5, -1);
    expect(half.bicycle).toBeCloseTo((0.2 - CRASH_LEAN_RADIANS) / 2, 12);
    expect(half.body).toBeCloseTo(-0.025, 12);
  });
});

describe('a crash drawn on the road — scene.ts §SceneInput.riderCrash', () => {
  const route = northRoute(2_000, () => 0);
  const at = 800;

  function markers(extra: Partial<SceneInput>): readonly RiderMarker[] {
    return sceneFrame({
      profile: route,
      origin: corridorOrigin(route),
      state: {
        ...atStartLine(route),
        ride: { speed: metresPerSecond(8), distance: metres(at) },
        ridden: seconds(100),
        bot: {
          state: { speed: metresPerSecond(8), distance: metres(at + 20) },
          distanceOnRoute: metres(at + 20),
          grade: 0 as never,
          power: 200 as never,
        },
      },
      botDistance: at + 20,
      crankAngle: 1,
      pedalling: true,
      steeredLateral: 1.75,
      ...extra,
    }).markers;
  }
  const of = (all: readonly RiderMarker[], kind: RiderMarker['kind']): RiderMarker => {
    const found = all.find((marker) => marker.kind === kind);
    if (found === undefined) throw new Error(`no ${kind}`);
    return found;
  };

  it('lays the rider’s bicycle on its side, the body with it and the stroke stopped, where they were', () => {
    const riding = markers({});
    const down = markers({ riderCrash: { share: 1, side: 1 } });
    const rider = of(down, 'rider');
    expect(rider.lean).toBeCloseTo(CRASH_LEAN_RADIANS, 12);
    expect(rider.bodyLean).toBe(0);
    expect(rider.pedalling).toBe(0);
    // Where they are drawn, and which way they face, are the ride's: the camera does nothing new.
    const was = of(riding, 'rider');
    expect([rider.x, rider.y, rider.z]).toEqual([was.x, was.y, was.z]);
    expect([rider.headingX, rider.headingZ]).toEqual([was.headingX, was.headingZ]);
    // Riding, they were upright and pedalling.
    expect(Math.abs(was.lean)).toBeLessThan(1e-9);
    expect(was.pedalling).toBe(1);
    // Nobody else falls.
    expect(of(down, 'bot')).toEqual(of(riding, 'bot'));
  });

  it('falls to the side it is told, and part of the way at a share between', () => {
    expect(of(markers({ riderCrash: { share: 1, side: -1 } }), 'rider').lean).toBeCloseTo(
      -CRASH_LEAN_RADIANS,
      12,
    );
    const part = of(markers({ riderCrash: { share: 0.5, side: 1 } }), 'rider');
    expect(part.lean).toBeCloseTo(CRASH_LEAN_RADIANS / 2, 9);
    expect(part.pedalling).toBeLessThanOrEqual(0.5);
  });

  it('draws the ride as it was with no crash, or a crash at nought', () => {
    expect(markers({ riderCrash: { share: 0, side: 1 } })).toEqual(markers({}));
    expect(markers({ riderCrash: undefined })).toEqual(markers({}));
  });
});
