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
  CRASH_CLIP_RISE_SECONDS,
  CRASH_CLIP_SECONDS,
  CRASH_FALL_SECONDS,
  CRASH_LEAN_RADIANS,
  CRASH_REBOUND_BOUNCE_SECONDS,
  CRASH_REBOUND_BOUNCES,
  CRASH_REBOUND_RADIANS,
  CRASH_RISE_AT_SECONDS,
  CRASH_RISE_SECONDS,
  CRASH_SECONDS,
  CRASH_THROWN_SECONDS,
  crashBodyShare,
  crashClipSeconds,
  crashFrom,
  crashRebound,
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

describe('getting back up is seen, and the clip is played across it — crashClipSeconds', () => {
  it('takes the rider at least half a second to get back up: thirty frames, not nine', () => {
    const rising = timeline(false).filter(
      (share) => share !== undefined && share > 0.02 && share < 0.98,
    );
    const falling = Math.round(CRASH_FALL_SECONDS * FPS);
    // The frames part of the way up, less the fall's own.
    expect(rising.length - falling).toBeGreaterThanOrEqual(24);
    expect(CRASH_SECONDS).toBeCloseTo(CRASH_RISE_AT_SECONDS + CRASH_RISE_SECONDS, 12);
  });

  it('is the time since the crash until the rise, and the clip’s rise spread over the drawn one', () => {
    for (const seconds of [0, 0.1, CRASH_THROWN_SECONDS, CRASH_FALL_SECONDS, 0.8]) {
      expect(crashClipSeconds(seconds)).toBe(seconds);
    }
    expect(crashClipSeconds(CRASH_RISE_AT_SECONDS)).toBe(CRASH_RISE_AT_SECONDS);
    expect(crashClipSeconds(CRASH_RISE_AT_SECONDS + CRASH_RISE_SECONDS / 2)).toBeCloseTo(
      CRASH_RISE_AT_SECONDS + CRASH_CLIP_RISE_SECONDS / 2,
      12,
    );
    expect(crashClipSeconds(CRASH_SECONDS)).toBeCloseTo(CRASH_CLIP_SECONDS, 12);
    // The two rises differ, or this test holds nothing.
    expect(CRASH_RISE_SECONDS).toBeGreaterThan(CRASH_CLIP_RISE_SECONDS);
    // Held to the clip's span, and never backwards.
    expect(crashClipSeconds(CRASH_SECONDS + 5)).toBeCloseTo(CRASH_CLIP_SECONDS, 12);
    expect(crashClipSeconds(-1)).toBe(0);
    expect(crashClipSeconds(Number.NaN)).toBe(0);
    let last = 0;
    for (let frame = 0; frame <= CRASH_SECONDS * FPS; frame += 1) {
      const now = crashClipSeconds(frame / FPS);
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
  });
});

describe('the body’s share of the clip is not the roll’s — crashBodyShare', () => {
  it('is wholly the clip’s from the moment it is thrown until it is back over the saddle', () => {
    expect(crashBodyShare(0)).toBe(0);
    expect(crashBodyShare(CRASH_THROWN_SECONDS)).toBe(1);
    expect(crashBodyShare(CRASH_FALL_SECONDS)).toBe(1);
    expect(crashBodyShare(CRASH_RISE_AT_SECONDS)).toBe(1);
    expect(crashBodyShare(CRASH_RISE_AT_SECONDS + CRASH_RISE_SECONDS / 2)).toBe(1);
    // Thrown, the bicycle is not a third of the way down: the roll's share would leave the
    // body two thirds on the saddle while the clip has it leaving.
    expect(crashShare(CRASH_THROWN_SECONDS, false)).toBeLessThan(0.31);
    // Eased back onto the ride's pose over the second half of the rise.
    expect(crashBodyShare(CRASH_RISE_AT_SECONDS + 0.75 * CRASH_RISE_SECONDS)).toBeCloseTo(0.5, 12);
    expect(crashBodyShare(CRASH_SECONDS - 1e-9)).toBeCloseTo(0, 6);
  });

  it('leaves the bicycle before the bicycle is down, moves by a bounded amount a frame, and ends with the crash', () => {
    let largest = 0;
    let last = 0;
    for (let frame = 0; frame <= (CRASH_SECONDS + 0.2) * FPS; frame += 1) {
      const seconds = frame / FPS;
      const body = crashBodyShare(seconds);
      const roll = crashShare(seconds, false);
      // Drawn exactly as long as the crash is.
      expect(body === undefined).toBe(roll === undefined);
      if (seconds <= CRASH_FALL_SECONDS) expect(body ?? 0).toBeGreaterThanOrEqual(roll ?? 0);
      largest = Math.max(largest, Math.abs((body ?? 0) - last));
      last = body ?? 0;
    }
    expect(largest).toBeGreaterThan(0);
    expect(largest).toBeLessThan(0.15);
    for (const time of [-0.01, Number.NaN, Number.POSITIVE_INFINITY, CRASH_SECONDS]) {
      expect(crashBodyShare(time)).toBeUndefined();
    }
  });
});

describe('the bicycle lands with weight — crashRebound', () => {
  it('lifts a little way back off the road as it lands, and lies still well before the rise', () => {
    expect(crashRebound(0)).toBe(0);
    expect(crashRebound(CRASH_FALL_SECONDS / 2)).toBe(0);
    expect(crashRebound(CRASH_FALL_SECONDS)).toBe(0);
    const DEGREE = Math.PI / 180;
    let highest = 0;
    let largest = 0;
    let last = 0;
    for (let frame = 0; frame <= CRASH_SECONDS * FPS; frame += 1) {
      const lift = crashRebound(frame / FPS);
      // Off the road, never into it.
      expect(lift).toBeGreaterThanOrEqual(0);
      highest = Math.max(highest, lift);
      largest = Math.max(largest, Math.abs(lift - last));
      last = lift;
    }
    // A bicycle on tarmac, not a ball: between two and four degrees at its highest.
    expect(highest).toBeGreaterThan(2 * DEGREE);
    expect(highest).toBeLessThan(4 * DEGREE);
    expect(highest).toBeLessThan(CRASH_REBOUND_RADIANS);
    // No jump: under two degrees a frame, coming to rest included.
    expect(largest).toBeLessThan(2 * DEGREE);
    // The second bounce is lower than the first, and the third lower again.
    const top = (bounce: number): number =>
      crashRebound(CRASH_FALL_SECONDS + (bounce + 0.5) * CRASH_REBOUND_BOUNCE_SECONDS);
    expect(top(1)).toBeLessThan(top(0) / 3);
    expect(top(2)).toBeLessThan(top(1) / 3);
    expect(top(2)).toBeGreaterThan(0);
    // Still from there on, with a third of a second to spare before the rider starts up.
    const still = CRASH_FALL_SECONDS + CRASH_REBOUND_BOUNCES * CRASH_REBOUND_BOUNCE_SECONDS;
    expect(crashRebound(still)).toBe(0);
    expect(crashRebound(CRASH_RISE_AT_SECONDS)).toBe(0);
    expect(CRASH_RISE_AT_SECONDS - still).toBeGreaterThan(0.2);
    expect(crashRebound(Number.NaN)).toBe(0);
  });

  it('is taken off the lean, on whichever side the bicycle fell', () => {
    const ride = { bicycle: 0, body: 0 };
    const lift = 0.05;
    expect(crashedRoll(ride, 1, 1, lift).bicycle).toBeCloseTo(CRASH_LEAN_RADIANS - lift, 12);
    expect(crashedRoll(ride, 1, -1, lift).bicycle).toBeCloseTo(-(CRASH_LEAN_RADIANS - lift), 12);
    // None unless given: #2475's roll, to the bit.
    expect(crashedRoll(ride, 1, 1)).toEqual({ bicycle: CRASH_LEAN_RADIANS, body: 0 });
  });
});

describe('a crash while one is drawn — crashFrom', () => {
  it('keeps the crash being drawn, so a rider already down does not jump up to fall again', () => {
    const first = crashFrom(undefined, 1_000, 1, false);
    expect(first).toEqual({ atMs: 1_000, side: 1 });
    expect(crashFrom(first, 1_000 + 500, -1, false)).toBe(first);
    expect(crashFrom(first, 1_000 + CRASH_SECONDS * 1000 - 1, -1, false)).toBe(first);
    // Once it is over, the next is drawn from its own start.
    expect(crashFrom(first, 1_000 + CRASH_SECONDS * 1000, -1, false)).toEqual({
      atMs: 1_000 + CRASH_SECONDS * 1000,
      side: -1,
    });
  });

  it('ends a crash under reduced motion where its pose ends, so the next one just after is drawn', () => {
    const first = crashFrom(undefined, 1_000, 1, true);
    const justAfter = 1_000 + CRASH_RISE_AT_SECONDS * 1000 + 1;
    // The pose is over by then…
    expect(crashShare((justAfter - first.atMs) / 1000, true)).toBeUndefined();
    // …and so the crash: the next is drawn from its own start, not swallowed by the first.
    expect(crashFrom(first, justAfter, -1, true)).toEqual({ atMs: justAfter, side: -1 });
    expect(crashFrom(first, justAfter - 2, -1, true)).toBe(first);
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

  it('#2493: carries the crash on the rider’s marker for the clip, only when told how long ago, and on nobody else', () => {
    const played = markers({ riderCrash: { share: 1, side: -1, seconds: 1.1 } });
    expect(of(played, 'rider').crash).toEqual({ seconds: 1.1, side: -1, share: 1 });
    expect(of(played, 'bot').crash).toBeUndefined();
    // With no time — reduced motion — the marker is #2475's still pose, exactly.
    const still = markers({ riderCrash: { share: 1, side: -1 } });
    expect(of(still, 'rider').crash).toBeUndefined();
    expect({ ...of(played, 'rider'), crash: undefined }).toEqual({
      ...of(still, 'rider'),
      crash: undefined,
    });
  });

  it('lands the bicycle with weight when told how long ago, and never in the still pose', () => {
    const landing = CRASH_FALL_SECONDS + CRASH_REBOUND_BOUNCE_SECONDS / 2;
    const lift = crashRebound(landing);
    expect(lift).toBeGreaterThan(0.03);
    const bounced = of(markers({ riderCrash: { share: 1, side: -1, seconds: landing } }), 'rider');
    expect(bounced.lean).toBeCloseTo(-(CRASH_LEAN_RADIANS - lift), 12);
    // Reduced motion hands no time: the pose is still, on the road.
    const still = of(markers({ riderCrash: { share: 1, side: -1 } }), 'rider');
    expect(still.lean).toBeCloseTo(-CRASH_LEAN_RADIANS, 12);
  });

  it('hands the realistic rider the clip’s own time and the body’s own share, not the roll’s', () => {
    // Thrown: the bicycle under a third of the way down, the body wholly the clip's.
    const thrown = of(
      markers({
        riderCrash: {
          share: crashShare(CRASH_THROWN_SECONDS, false) ?? Number.NaN,
          side: 1,
          seconds: CRASH_THROWN_SECONDS,
        },
      }),
      'rider',
    );
    expect(thrown.crash).toEqual({ seconds: CRASH_THROWN_SECONDS, side: 1, share: 1 });
    expect(thrown.lean).toBeLessThan(CRASH_LEAN_RADIANS / 3);
    // Half way up: the bicycle half way, the body still the clip's, at the clip's own half-rise.
    const halfUp = CRASH_RISE_AT_SECONDS + CRASH_RISE_SECONDS / 2;
    const rising = of(
      markers({
        riderCrash: { share: crashShare(halfUp, false) ?? Number.NaN, side: 1, seconds: halfUp },
      }),
      'rider',
    );
    expect(rising.crash?.share).toBe(1);
    expect(rising.crash?.seconds).toBeCloseTo(
      CRASH_RISE_AT_SECONDS + CRASH_CLIP_RISE_SECONDS / 2,
      12,
    );
    expect(rising.lean).toBeCloseTo(CRASH_LEAN_RADIANS / 2, 9);
  });

  it('#2493: straightens the bars of a steered rider as they fall, and lays the crash over the steered pose', () => {
    // Mid lane change: the sway building, so the bars are turned into the move.
    const steering = { steeredSway: 0.5, steeredSwayRate: 2 } as const;
    const riding = of(markers(steering), 'rider');
    const turned = riding.steer ?? 0;
    expect(Math.abs(turned)).toBeGreaterThan(Math.PI / 180);
    // Halfway down, the bars are halfway back to straight, and the clip is carried beside them.
    const half = of(
      markers({ ...steering, riderCrash: { share: 0.5, side: 1, seconds: 0.4 } }),
      'rider',
    );
    expect(half.steer).toBeCloseTo(turned / 2, 12);
    // The body's share is its own: wholly the clip's since it was thrown.
    expect(half.crash).toEqual({ seconds: 0.4, side: 1, share: 1 });
    // The clip's marker is the steered still pose with the crash laid on it, nothing dropped.
    const still = of(markers({ ...steering, riderCrash: { share: 0.5, side: 1 } }), 'rider');
    expect({ ...half, crash: undefined }).toEqual({ ...still, crash: undefined });
    // On the ground the bars point straight; getting up, they come back.
    const down = of(
      markers({ ...steering, riderCrash: { share: 1, side: 1, seconds: 0.8 } }),
      'rider',
    );
    expect(down.steer).toBeUndefined();
    const rising = of(
      markers({ ...steering, riderCrash: { share: 0.25, side: 1, seconds: 2 } }),
      'rider',
    );
    expect(rising.steer).toBeCloseTo(turned * 0.75, 12);
  });

  it('draws the ride as it was with no crash, or a crash at nought', () => {
    expect(markers({ riderCrash: { share: 0, side: 1 } })).toEqual(markers({}));
    expect(markers({ riderCrash: undefined })).toEqual(markers({}));
  });
});
