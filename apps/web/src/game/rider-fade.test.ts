// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2596 — another rider between the chase camera and the rider fades out, the
 * rider's own avatar never does, and nothing pops. The rule is
 * `rider-fade.ts`; what the renderer does with it is held by
 * `three-renderer.test.ts` §"#2596" and the browser gate
 * (`lap-race.browser.spec.ts` §"#2596").
 */

import { metres } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { CAMERA_BEHIND_METRES, cameraRig } from './camera';
import { BIKE_LENGTH_METRES, PACK_ABREAST_METRES } from './lap-race/pack-layout';
import type { CameraPose, RiderMarker } from './port';
import {
  RIDER_FADE_METRES,
  emptyRiderFadeLine,
  riderFadeLine,
  riderFaded,
  type RiderFadeLine,
} from './rider-fade';
import { northRoute } from './route-fixtures-testing';
import { sceneFrame, type SceneInput } from './scene';
import { atStartLine } from './simulation';
import { corridorOrigin } from './terrain';

/** A camera on a straight north-going road, the rider at the origin. */
const POSE: CameraPose = {
  x: 0,
  y: 0,
  z: 0,
  headingX: 0,
  headingZ: 1,
  targetAheadMetres: 25,
  eyeRoadY: 0,
  targetRoadY: 0,
};

function marker(kind: RiderMarker['kind'], x: number, z: number): RiderMarker {
  return {
    kind,
    x,
    y: 0,
    z,
    headingX: 0,
    headingZ: 1,
    lean: 0,
    bodyLean: 0,
    pedalling: 1,
    rideSeconds: 0,
  };
}

const RIDER = marker('rider', 0, 0);

function lineFor(pose: CameraPose = POSE, rider: RiderMarker = RIDER): RiderFadeLine {
  return riderFadeLine(pose, [rider], emptyRiderFadeLine());
}

/** In line behind the rider: a bike length and #2542's shortest wheel gap, 0.3 m, back, as `pack-layout.ts` draws it. */
const HELD_BEHIND = BIKE_LENGTH_METRES + 0.3;

describe('riderFaded — the rule (#2596)', () => {
  it('fades out a bot held in line behind the rider, and the one beside it in the row behind', () => {
    const line = lineFor();
    expect(riderFaded(marker('bot', 0, -HELD_BEHIND), line)).toBe(1);
    expect(riderFaded(marker('bot', PACK_ABREAST_METRES, -HELD_BEHIND), line)).toBe(1);
    expect(riderFaded(marker('bot', -PACK_ABREAST_METRES, -HELD_BEHIND), line)).toBe(1);
  });

  it('fades out a rider beside the camera’s eye, which the near plane would cut', () => {
    const eye = -CAMERA_BEHIND_METRES;
    const line = lineFor();
    expect(riderFaded(marker('bot', 0.5, eye), line)).toBe(1);
    expect(riderFaded(marker('remote', -0.3, eye - 0.3), line)).toBe(1);
  });

  it('never fades the rider’s own avatar, wherever it stands', () => {
    const line = lineFor();
    for (const z of [0, -1, -HELD_BEHIND, -CAMERA_BEHIND_METRES]) {
      expect(riderFaded(marker('rider', 0, z), line)).toBe(0);
    }
  });

  it('fades the pacer, the ghost and a room’s rider by the same rule as a race’s bot', () => {
    const line = lineFor();
    for (const kind of ['bot', 'ghost', 'remote'] as const) {
      expect(riderFaded(marker(kind, 0, -HELD_BEHIND), line)).toBe(1);
      expect(riderFaded(marker(kind, 0, 6), line)).toBe(0);
    }
  });

  it('draws whole a rider level with the rider, ahead, or two places across', () => {
    const line = lineFor();
    expect(riderFaded(marker('bot', PACK_ABREAST_METRES, 0), line)).toBe(0);
    expect(riderFaded(marker('bot', 0, 3), line)).toBe(0);
    expect(riderFaded(marker('bot', RIDER_FADE_METRES.whole, -HELD_BEHIND), line)).toBe(0);
    // Two places across keeps 3/8 of itself; three places across is whole.
    expect(riderFaded(marker('bot', 2 * PACK_ABREAST_METRES, -HELD_BEHIND), line)).toBeCloseTo(
      5 / 8,
      6,
    );
    expect(riderFaded(marker('bot', 3 * PACK_ABREAST_METRES, -HELD_BEHIND), line)).toBe(0);
  });

  it('falls evenly between `gone` and `whole`', () => {
    const line = lineFor();
    const { gone, whole } = RIDER_FADE_METRES;
    expect(riderFaded(marker('bot', (gone + whole) / 2, -HELD_BEHIND), line)).toBeCloseTo(0.5, 9);
    expect(riderFaded(marker('bot', gone + (whole - gone) / 4, -HELD_BEHIND), line)).toBeCloseTo(
      0.75,
      9,
    );
  });

  it('fades back in as a bot comes up the side past the rider, with no step bigger than its 5 cm moves', () => {
    const line = lineFor();
    let before = riderFaded(marker('bot', PACK_ABREAST_METRES, -HELD_BEHIND), line);
    expect(before).toBe(1);
    let largest = 0;
    for (let z = -HELD_BEHIND; z <= 0.5; z += 0.05) {
      const now = riderFaded(marker('bot', PACK_ABREAST_METRES, z), line);
      // Never darker again as it moves forward, and never a jump.
      expect(now).toBeLessThanOrEqual(before);
      largest = Math.max(largest, before - now);
      before = now;
    }
    expect(before).toBe(0);
    // 5 cm over the 0.8 m between `whole` and `gone` is at most a sixteenth.
    expect(largest).toBeLessThanOrEqual(
      0.05 / (RIDER_FADE_METRES.whole - RIDER_FADE_METRES.gone) + 1e-9,
    );
    expect(largest).toBeGreaterThan(0);
  });

  it('measures toward the rider, not along the camera’s heading, in a bend', () => {
    // The camera looks through the bend: its heading is turned 30° off the
    // line to the rider, who stands to the side of the pose's point.
    const turned = { ...POSE, headingX: Math.sin(Math.PI / 6), headingZ: Math.cos(Math.PI / 6) };
    const eyeX = -turned.headingX * CAMERA_BEHIND_METRES;
    const eyeZ = -turned.headingZ * CAMERA_BEHIND_METRES;
    const rider = marker('rider', 0.4, 0.2);
    const line = lineFor(turned, rider);
    // A bot half way from the eye to the rider is on the line to the rider.
    const half = marker('bot', (eyeX + rider.x) / 2, (eyeZ + rider.z) / 2);
    expect(riderFaded(half, line)).toBe(1);
    // With no rider on the frame the line runs to the pose's own point.
    const none = riderFadeLine(turned, [], emptyRiderFadeLine());
    expect(none.eyeX).toBeCloseTo(eyeX, 9);
    expect(Math.hypot(none.endX - eyeX, none.endZ - eyeZ)).toBeCloseTo(
      CAMERA_BEHIND_METRES - RIDER_FADE_METRES.clear,
      9,
    );
  });

  it('measures from the eye `cameraRig` places, through bends and on climbs', () => {
    // Review of #2620: the line's eye is the camera's own, so a later change
    // to where `cameraRig` stands the camera moves the fade with it.
    for (const degrees of [0, 17, 90, 143, -60, 180]) {
      for (const [eyeRoadY, targetRoadY] of [
        [0, 0],
        [-1.2, 3.5],
        [4, -2],
      ] as const) {
        const radians = (degrees * Math.PI) / 180;
        const pose: CameraPose = {
          ...POSE,
          x: 12.5,
          y: eyeRoadY + 0.3,
          z: -40,
          headingX: Math.sin(radians),
          headingZ: Math.cos(radians),
          eyeRoadY,
          targetRoadY,
        };
        const rider = marker('rider', pose.x + 0.4, pose.z - 0.2);
        const line = riderFadeLine(pose, [rider], emptyRiderFadeLine());
        const { eye } = cameraRig(pose);
        expect(line.eyeX).toBe(eye.x);
        expect(line.eyeZ).toBe(eye.z);
      }
    }
  });

  it('leaves the line its eye alone when the rider stands nearer the eye than `clear`', () => {
    const near = marker('rider', 0, -CAMERA_BEHIND_METRES + 1);
    const line = lineFor(POSE, near);
    expect(line.endX).toBe(line.eyeX);
    expect(line.endZ).toBe(line.eyeZ);
    expect(riderFaded(marker('bot', 0, -CAMERA_BEHIND_METRES), line)).toBe(1);
    expect(riderFaded(marker('bot', 0, -CAMERA_BEHIND_METRES + 2), line)).toBe(0);
  });

  it('draws every rider whole with no line — the control', () => {
    expect(riderFaded(marker('bot', 0, -HELD_BEHIND), undefined)).toBe(0);
  });
});

describe('a real frame — the bot the pack holds behind the rider is faded (#2596)', () => {
  const route = northRoute(2_000, () => 10);
  const start = atStartLine(route);
  const RIDER_AT = 400;
  function frame(over: Partial<SceneInput>): ReturnType<typeof sceneFrame> {
    return sceneFrame({
      profile: route,
      origin: corridorOrigin(route),
      state: { ...start, ride: { ...start.ride, distance: metres(RIDER_AT) } },
      ...over,
    });
  }

  it('fades a lap-race bot drawn in line behind the rider, and not the rider nor a bot ahead', () => {
    const drawn = frame({
      raceBots: [
        // As `pack-layout.ts` hands them: laid out, so drawn where it says.
        {
          distanceMetres: RIDER_AT - HELD_BEHIND,
          speedMetresPerSecond: 9,
          lateralMetres: 0,
          laidOut: true,
        },
        { distanceMetres: RIDER_AT + 6, speedMetresPerSecond: 9, lateralMetres: 0, laidOut: true },
      ],
      steeredLateral: 0,
    });
    const line = riderFadeLine(drawn.camera, drawn.markers, emptyRiderFadeLine());
    const [rider, behind, ahead] = drawn.markers;
    expect(rider?.kind).toBe('rider');
    expect(riderFaded(rider as RiderMarker, line)).toBe(0);
    expect(behind?.kind).toBe('bot');
    expect(riderFaded(behind as RiderMarker, line)).toBe(1);
    expect(riderFaded(ahead as RiderMarker, line)).toBe(0);
  });

  it('fades the solo pacer out as the rider drops it through the camera’s space, and never in one step', () => {
    // The pacer as `scene.ts` draws it, from level with the rider to behind the
    // camera: aside while level (#499), then onto the rider's line, through the
    // space between the eye and the rider, and out behind the eye.
    const fadedAt = (back: number): number => {
      const drawn = frame({ botDistance: RIDER_AT - back });
      const line = riderFadeLine(drawn.camera, drawn.markers, emptyRiderFadeLine());
      const pacer = drawn.markers.find((each) => each.kind === 'bot');
      if (pacer === undefined) throw new Error(`no pacer ${String(back)} m back`);
      expect(riderFaded(drawn.markers[0] as RiderMarker, line)).toBe(0);
      return riderFaded(pacer, line);
    };
    expect(fadedAt(0)).toBe(0);
    for (const back of [3, 4, CAMERA_BEHIND_METRES]) expect(fadedAt(back)).toBe(1);
    expect(fadedAt(8)).toBe(0);
    let before = fadedAt(0);
    let largest = 0;
    for (let back = 0.05; back <= 8; back += 0.05) {
      const now = fadedAt(back);
      largest = Math.max(largest, Math.abs(now - before));
      before = now;
    }
    expect(largest).toBeLessThan(0.1);
  });
});
