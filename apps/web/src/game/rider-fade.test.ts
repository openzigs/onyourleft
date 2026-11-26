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
import { nearPyramid } from './near-field';
import type { CameraPose, RiderMarker } from './port';
import {
  RIDER_FADE_METRES,
  emptyRiderFadeLine,
  riderFadeLine,
  riderFaded,
  type RiderFadeLine,
} from './rider-fade';
import { riderBoxCut } from './rider-box-testing';
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
  it('fades out a bot held in line behind the rider, and not the one beside it in the row behind', () => {
    const line = lineFor();
    expect(riderFaded(marker('bot', 0, -HELD_BEHIND), line)).toBe(1);
    expect(riderFaded(marker('bot', PACK_ABREAST_METRES, -HELD_BEHIND), line)).toBe(0);
    expect(riderFaded(marker('bot', -PACK_ABREAST_METRES, -HELD_BEHIND), line)).toBe(0);
  });

  it('fades out a rider at the camera’s eye, in the lane or beside it — #3198', () => {
    const eye = -CAMERA_BEHIND_METRES;
    const line = lineFor();
    expect(riderFaded(marker('bot', 0, eye), line)).toBe(1);
    expect(riderFaded(marker('remote', -0.05, eye - 0.3), line)).toBe(1);
    // Until #3198 the ruling's "beside is whole" held here too, and the near
    // plane cut the bot passing the lens.
    expect(riderFaded(marker('bot', PACK_ABREAST_METRES, eye), line)).toBe(1);
    expect(riderFaded(marker('bot', -PACK_ABREAST_METRES, eye + 0.6), line)).toBe(1);
  });

  it('never fades a bot one place across, at any place from 3 m behind the rider to level — the owner’s ruling of 2026-11-15', () => {
    const line = lineFor();
    for (const side of [PACK_ABREAST_METRES, -PACK_ABREAST_METRES]) {
      for (let back = 0; back <= 3 + 1e-9; back += 0.05) {
        expect(
          riderFaded(marker('bot', side, -back), line),
          `${String(side)} across, ${String(back)} back`,
        ).toBe(0);
      }
    }
  });

  it('still fades out a bot directly behind the rider in their lane, near the camera', () => {
    const line = lineFor();
    for (const back of [HELD_BEHIND, 2.5, 3, 3.5, 4]) {
      expect(riderFaded(marker('bot', 0, -back), line), `${String(back)} back`).toBe(1);
    }
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

  it('draws whole a rider level with the rider, ahead, beside the rider’s back wheel, or two places across', () => {
    const line = lineFor();
    const { behind, aside } = RIDER_FADE_METRES;
    expect(riderFaded(marker('bot', 0, 0), line)).toBe(0);
    expect(riderFaded(marker('bot', PACK_ABREAST_METRES, 0), line)).toBe(0);
    expect(riderFaded(marker('bot', 0, 3), line)).toBe(0);
    // Behind, but no further than the back of the rider's bicycle.
    expect(riderFaded(marker('bot', 0, -behind.whole), line)).toBe(0);
    expect(riderFaded(marker('bot', aside.whole, -HELD_BEHIND), line)).toBe(0);
    expect(riderFaded(marker('bot', 2 * PACK_ABREAST_METRES, -HELD_BEHIND), line)).toBe(0);
  });

  it('falls evenly along each ramp, and by the two together', () => {
    const line = lineFor();
    const { behind, aside } = RIDER_FADE_METRES;
    const middleBack = (behind.whole + behind.gone) / 2;
    const middleAside = (aside.whole + aside.gone) / 2;
    expect(riderFaded(marker('bot', 0, -middleBack), line)).toBeCloseTo(0.5, 9);
    expect(riderFaded(marker('bot', middleAside, -HELD_BEHIND), line)).toBeCloseTo(0.5, 9);
    expect(
      riderFaded(marker('bot', aside.gone + (aside.whole - aside.gone) / 4, -HELD_BEHIND), line),
    ).toBeCloseTo(0.75, 9);
    expect(riderFaded(marker('bot', -middleAside, -middleBack), line)).toBeCloseTo(0.25, 9);
  });

  it('fades back in as a bot comes up the lane behind the rider, and as it moves out of the lane, with no step bigger than its 5 cm moves', () => {
    const line = lineFor();
    const { behind, aside } = RIDER_FADE_METRES;
    let before = riderFaded(marker('bot', 0, -HELD_BEHIND), line);
    expect(before).toBe(1);
    let largest = 0;
    for (let z = -HELD_BEHIND; z <= 0.5; z += 0.05) {
      const now = riderFaded(marker('bot', 0, z), line);
      // Never darker again as it moves forward, and never a jump.
      expect(now).toBeLessThanOrEqual(before);
      largest = Math.max(largest, before - now);
      before = now;
    }
    expect(before).toBe(0);
    // 5 cm over the 0.8 m `behind` ramp is at most a sixteenth.
    expect(largest).toBeLessThanOrEqual(0.05 / (behind.gone - behind.whole) + 1e-9);
    expect(largest).toBeGreaterThan(0);
    // Out of the lane to one side, 5 cm at a time.
    before = 1;
    largest = 0;
    for (let x = 0; x <= PACK_ABREAST_METRES + 1e-9; x += 0.05) {
      const now = riderFaded(marker('bot', x, -HELD_BEHIND), line);
      expect(now).toBeLessThanOrEqual(before);
      largest = Math.max(largest, before - now);
      before = now;
    }
    expect(before).toBe(0);
    expect(largest).toBeLessThanOrEqual(0.05 / (aside.whole - aside.gone) + 1e-9);
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
    // A bot one place across from that line, behind the rider, is whole.
    const length = Math.hypot(rider.x - eyeX, rider.z - eyeZ);
    const [alongX, alongZ] = [(rider.x - eyeX) / length, (rider.z - eyeZ) / length];
    const across = marker(
      'bot',
      half.x + alongZ * PACK_ABREAST_METRES,
      half.z - alongX * PACK_ABREAST_METRES,
    );
    expect(riderFaded(across, line)).toBe(0);
    // With no rider on the frame the line runs to the pose's own point.
    const none = riderFadeLine(turned, [], emptyRiderFadeLine());
    expect(none.eyeX).toBeCloseTo(eyeX, 9);
    expect(none.riderX).toBe(turned.x);
    expect(none.riderZ).toBe(turned.z);
    expect(none.alongX).toBeCloseTo(turned.headingX, 9);
    expect(none.alongZ).toBeCloseTo(turned.headingZ, 9);
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

  it('runs the line along the pose’s heading when the rider stands at the eye', () => {
    const eye = marker('rider', 0, -CAMERA_BEHIND_METRES);
    const line = lineFor(POSE, eye);
    expect([line.alongX, line.alongZ]).toEqual([POSE.headingX, POSE.headingZ]);
    expect(riderFaded(marker('bot', 0, -CAMERA_BEHIND_METRES - 2), line)).toBe(1);
    expect(riderFaded(marker('bot', 0, -CAMERA_BEHIND_METRES + 2), line)).toBe(0);
  });

  it('draws every rider whole with no line — the control', () => {
    expect(riderFaded(marker('bot', 0, -HELD_BEHIND), undefined)).toBe(0);
  });
});

describe('a rider the near plane would cut is faded out — #3198', () => {
  /**
   * The frames a device draws: an upright phone, the owner's 16 : 10 tablet,
   * the demo video's 16 : 9 and a landscape phone. Not 6 : 1, a desktop window
   * no device draws (`camera.ts` §`WORST_CASE_ASPECT`), whose 4.2 m-wide
   * near plane reaches a bot a place across 3 m behind the rider, which the
   * owner's ruling of 2026-11-15 keeps whole.
   */
  const ASPECTS = [9 / 19.5, 16 / 10, 16 / 9, 19.5 / 9] as const;
  /** Level, onto a climb, and onto a descent, which pitches the near plane down. */
  const ROADS = [
    [0, 0],
    [0, 2.5],
    [0, -2.5],
  ] as const;

  it('fades out every rider whose box meets the solid between the eye and the near plane, wherever it is about the eye', () => {
    let cut = 0;
    for (const aspect of ASPECTS) {
      for (const [eyeRoadY, targetRoadY] of ROADS) {
        const pose: CameraPose = { ...POSE, eyeRoadY, targetRoadY };
        const line = lineFor(pose);
        const pyramid = nearPyramid(cameraRig(pose), aspect);
        for (let across = -2; across <= 2 + 1e-9; across += 0.05) {
          for (let along = -3; along <= 3 + 1e-9; along += 0.05) {
            const bot = marker('bot', across, -CAMERA_BEHIND_METRES + along);
            if (!riderBoxCut(bot, pyramid)) continue;
            cut += 1;
            expect(
              riderFaded(bot, line),
              `${aspect.toFixed(2)}, road ${String(targetRoadY)}: ${across.toFixed(2)} across, ${along.toFixed(2)} past the eye`,
            ).toBe(1);
          }
        }
      }
    }
    // Not vacuous: the sweep found riders the plane cuts.
    expect(cut).toBeGreaterThan(100);
  });

  it('fades it in and out over its ramp, never in one step, as it passes the eye beside the rider', () => {
    const line = lineFor();
    let before = riderFaded(marker('bot', PACK_ABREAST_METRES, 0), line);
    expect(before).toBe(0);
    for (let back = 0.05; back <= 2 * CAMERA_BEHIND_METRES + 1e-9; back += 0.05) {
      const now = riderFaded(marker('bot', PACK_ABREAST_METRES, -back), line);
      expect(Math.abs(now - before), `${back.toFixed(2)} back`).toBeLessThanOrEqual(
        0.05 / (RIDER_FADE_METRES.eye.whole - RIDER_FADE_METRES.eye.gone) + 1e-9,
      );
      before = now;
    }
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

  it('fades the solo pacer out only once the rider has dropped it into their lane behind them, and never in one step', () => {
    // The pacer as `scene.ts` draws it, from level with the rider to behind the
    // camera: aside while level (#499) and while it drifts back across, then
    // onto the rider's line, through the space between the eye and the rider.
    const fadedAt = (back: number): number => {
      const drawn = frame({ botDistance: RIDER_AT - back });
      const line = riderFadeLine(drawn.camera, drawn.markers, emptyRiderFadeLine());
      const pacer = drawn.markers.find((each) => each.kind === 'bot');
      if (pacer === undefined) throw new Error(`no pacer ${String(back)} m back`);
      expect(riderFaded(drawn.markers[0] as RiderMarker, line)).toBe(0);
      return riderFaded(pacer, line);
    };
    // Level, and still beside the rider as it drifts back across: whole.
    for (const back of [0, 1, 2, 3]) expect(fadedAt(back)).toBe(0);
    // In the lane between the eye and the rider, and behind the eye: gone.
    for (const back of [4, CAMERA_BEHIND_METRES, 8]) expect(fadedAt(back)).toBe(1);
    let before = fadedAt(0);
    let largest = 0;
    for (let back = 0.05; back <= 8; back += 0.05) {
      const now = fadedAt(back);
      largest = Math.max(largest, Math.abs(now - before));
      before = now;
    }
    // It drifts 0.9 m across a metre it drops back, so 5 cm back is 4.5 cm
    // across the 0.3 m `aside` ramp: under a fifth of the fade a step.
    expect(largest).toBeLessThan(0.2);
    expect(largest).toBeGreaterThan(0);
  });
});
