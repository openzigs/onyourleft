// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The rider is a bicycle, and it pedals at the cadence — #349.
 *
 * ## What is checkable here, and why it is nearly all of it
 *
 * `bicycle.ts` names no rendering library, so the whole of the rider's shape
 * and the whole of the pedalling are arithmetic: where every part is, which way
 * round it is, where the knee goes, and how far the cranks have turned after a
 * second of 92 rpm. All of that is asserted below, in jsdom's absence of a GPU.
 *
 * ⚠️ **What is NOT checkable here**, said plainly because this is #240's named
 * defect shape for this epic and it has caught this repository five times: that
 * any of it is **drawn**. A parts list `three-renderer.ts` never reads, or reads
 * once and never re-reads when the crank angle changes, satisfies every
 * assertion in this file. `three-renderer.test.ts` is what says the renderer
 * builds it and turns it; `game.browser.spec.ts` is what says the pixels move
 * when the cranks do, read back off a real drawing buffer; and
 * `GameView.test.tsx` is what says a real cadence reaches it at all.
 */

import { describe, expect, it } from 'vitest';

import {
  advanceCrank,
  BICYCLE_COLOURS,
  CRANK_AXIS_Y,
  CRANK_AXIS_Z,
  CRANK_LENGTH_METRES,
  LEG_BONE_COUNT,
  legBones,
  MAXIMUM_CRANK_STEP_SECONDS,
  RIDER_BODY_PARTS,
  RIDER_CRANK_PARTS,
  RIDER_PALETTE,
  type LimbBone,
  type RiderPart,
} from './bicycle';
import { NO_READING, hudReadings, type HudInput, type SensorReading } from './hud/fields';
import { atStartLine } from './simulation';
import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  type RoutePoint,
} from '@onyourleft/domain';

const TAU = Math.PI * 2;

/**
 * The largest distance any point of a part can be from its centre.
 *
 * A bounding sphere rather than a box, so it is correct whatever the part's
 * three rotations are — which is the point: a test that re-implemented the
 * rotation order would be checking this file's arithmetic against itself.
 */
function reachOf(solid: RiderPart['solid']): number {
  switch (solid.shape) {
    case 'box':
      return Math.hypot(solid.width, solid.height, solid.depth) / 2;
    case 'tube':
      return Math.hypot(solid.radius * 2, solid.length) / 2;
    case 'ring':
      return solid.radius + solid.thickness;
    case 'ball':
      return solid.radius;
  }
}

/** The far end of a bone — the knee of a thigh, the ankle of a shin. */
function farEnd(bone: LimbBone): { readonly y: number; readonly z: number } {
  return {
    y: bone.y + (bone.length / 2) * Math.cos(bone.pitch),
    z: bone.z + (bone.length / 2) * Math.sin(bone.pitch),
  };
}

/** The near end of a bone — the hip of a thigh, the knee of a shin. */
function nearEnd(bone: LimbBone): { readonly y: number; readonly z: number } {
  return {
    y: bone.y - (bone.length / 2) * Math.cos(bone.pitch),
    z: bone.z - (bone.length / 2) * Math.sin(bone.pitch),
  };
}

/** Where the pedal on the `side` crank is, from the crank geometry alone. */
function pedalAt(crankAngle: number, side: 1 | -1): { readonly y: number; readonly z: number } {
  const angle = side === 1 ? crankAngle : crankAngle + Math.PI;
  return {
    y: CRANK_AXIS_Y + CRANK_LENGTH_METRES * Math.cos(angle),
    z: CRANK_AXIS_Z + CRANK_LENGTH_METRES * Math.sin(angle),
  };
}

/** Eight angles round one revolution, so nothing is asserted at one pose. */
const ROUND_THE_STROKE = [0, 1, 2, 3, 4, 5, 6, 7].map((step) => (step * TAU) / 8);

describe('the rider is a bicycle with somebody on it', () => {
  it('is built out of enough parts to read as one', () => {
    // A cheap guard against the whole list being emptied or filtered to nothing,
    // which would make every geometric assertion below pass over no parts at
    // all — the vacuous-pass shape `three-seam.test.ts` opens with.
    expect(RIDER_BODY_PARTS.length).toBeGreaterThan(12);
    expect(RIDER_CRANK_PARTS.length).toBeGreaterThan(4);
  });

  it('stands on the road rather than floating above it or sinking into it', () => {
    // The renderer places the rider at the marker's own `y`, unlike the bot and
    // the ghost which are lifted by a radius — so the model has to have its
    // wheels on zero itself.
    const lowest = Math.min(...RIDER_BODY_PARTS.map((each) => each.y - reachOf(each.solid)));
    expect(lowest).toBeGreaterThan(-0.005);
    expect(lowest).toBeLessThan(0.005);
  });

  it('is the size of a bicycle and a person, not of a lorry or a toy', () => {
    const highest = Math.max(...RIDER_BODY_PARTS.map((each) => each.y + reachOf(each.solid)));
    const furthestBack = Math.min(...RIDER_BODY_PARTS.map((each) => each.z - reachOf(each.solid)));
    const furthestForward = Math.max(
      ...RIDER_BODY_PARTS.map((each) => each.z + reachOf(each.solid)),
    );
    const widest = Math.max(
      ...RIDER_BODY_PARTS.map((each) => Math.abs(each.x) + reachOf(each.solid)),
    );

    // A cyclist on a road bike: about 1.5 m tall at the helmet, a wheelbase and
    // a bit under two metres long, and narrower than half the lane.
    expect(highest).toBeGreaterThan(1.3);
    expect(highest).toBeLessThan(1.8);
    expect(furthestForward - furthestBack).toBeGreaterThan(1.4);
    expect(furthestForward - furthestBack).toBeLessThan(2.1);
    expect(widest).toBeLessThan(0.6);
  });

  it('has two wheels of the same size, one at each end', () => {
    const wheels = RIDER_BODY_PARTS.filter((each) => each.solid.shape === 'ring');
    expect(wheels).toHaveLength(2);
    const [first, second] = wheels as [RiderPart, RiderPart];
    expect(reachOf(first.solid)).toBeCloseTo(reachOf(second.solid), 6);
    // Both on the bicycle's own plane, both on the ground, one behind the rider
    // and one in front of them.
    expect(first.x).toBe(0);
    expect(second.x).toBe(0);
    expect(first.y).toBeCloseTo(second.y, 6);
    expect(Math.min(first.z, second.z)).toBeLessThan(-0.3);
    expect(Math.max(first.z, second.z)).toBeGreaterThan(0.3);
  });

  it('turns both wheels so their axles run across the bicycle, not along it', () => {
    // ⚠️ The single most visible thing that can be wrong about a low-poly
    // bicycle: a torus left in its own plane is a hoop lying flat in the road.
    // A quarter turn about `+Y` is what stands it up, and nothing else here
    // would notice if it were dropped.
    for (const wheel of RIDER_BODY_PARTS.filter((each) => each.solid.shape === 'ring')) {
      expect(Math.abs(Math.cos(wheel.yaw))).toBeLessThan(1e-9);
      expect(wheel.pitch).toBe(0);
      expect(wheel.roll).toBe(0);
    }
  });

  it('draws every part in a colour the light budget knows about', () => {
    const palette = new Set<number>(BICYCLE_COLOURS);
    for (const each of [...RIDER_BODY_PARTS, ...RIDER_CRANK_PARTS]) {
      expect(palette.has(each.colour)).toBe(true);
    }
    // No duplicates, because `three-renderer.ts` folds this list into
    // `LIT_COLOURS` and that file's own test requires it to be a set.
    expect(new Set(BICYCLE_COLOURS).size).toBe(BICYCLE_COLOURS.length);
    expect(BICYCLE_COLOURS).toContain(RIDER_PALETTE.jersey);
  });

  it("keeps the sphere's own blue, because #93 is about telling three apart", () => {
    // The shape changed; the hue deliberately did not. A rider who has ridden
    // this before finds themselves by colour before they find themselves by
    // silhouette.
    expect(RIDER_PALETTE.jersey).toBe(0x2f6fed);
  });

  it('gives every part a solid something can actually be built from', () => {
    for (const each of [...RIDER_BODY_PARTS, ...RIDER_CRANK_PARTS]) {
      const sizes =
        each.solid.shape === 'box'
          ? [each.solid.width, each.solid.height, each.solid.depth]
          : each.solid.shape === 'tube'
            ? [each.solid.radius, each.solid.length]
            : each.solid.shape === 'ring'
              ? [each.solid.radius, each.solid.thickness]
              : [each.solid.radius];
      for (const size of sizes) {
        expect(size).toBeGreaterThan(0);
      }
      for (const number of [each.x, each.y, each.z, each.pitch, each.yaw, each.roll]) {
        expect(Number.isFinite(number)).toBe(true);
      }
    }
  });

  it('puts the crank parts around the axis rather than around the road', () => {
    // ⚠️ The crank list is in the bottom bracket's own frame, and a part of it
    // written in road coordinates would be a metre out — invisible in jsdom,
    // and a chainring hovering over the rider's shoulder on screen.
    for (const each of RIDER_CRANK_PARTS) {
      expect(Math.hypot(each.y, each.z)).toBeLessThan(CRANK_LENGTH_METRES * 1.5);
    }
  });

  it('hangs its two pedals half a turn apart, which is what a crankset is', () => {
    const pedals = RIDER_CRANK_PARTS.filter((each) => each.name.startsWith('pedal'));
    expect(pedals).toHaveLength(2);
    const [first, second] = pedals as [RiderPart, RiderPart];
    expect(first.y).toBeCloseTo(-second.y, 9);
    expect(first.x).toBeCloseTo(-second.x, 9);
    expect(Math.abs(first.y)).toBeCloseTo(CRANK_LENGTH_METRES, 9);
  });
});

describe('the legs follow the cranks', () => {
  it('is two legs of two bones each', () => {
    expect(legBones(0)).toHaveLength(LEG_BONE_COUNT);
  });

  it('keeps every foot on its own pedal, at every angle of the stroke', () => {
    // ⚠️ **The assertion the whole animation rests on.** The pedal position is
    // recomputed here from the crank geometry rather than read out of the
    // result, so a leg solved against the wrong angle, the wrong side or a
    // crank of the wrong length is a red test rather than a rider whose feet
    // orbit somewhere near their bicycle.
    for (const angle of ROUND_THE_STROKE) {
      const bones = legBones(angle);
      for (const [index, side] of ([1, -1] as const).entries()) {
        const shin = bones[index * 2 + 1] as LimbBone;
        const foot = farEnd(shin);
        const pedal = pedalAt(angle, side);
        expect(foot.y).toBeCloseTo(pedal.y, 9);
        expect(foot.z).toBeCloseTo(pedal.z, 9);
      }
    }
  });

  it('joins the thigh to the shin at one knee rather than at two', () => {
    for (const angle of ROUND_THE_STROKE) {
      const bones = legBones(angle);
      for (const index of [0, 1]) {
        const thigh = bones[index * 2] as LimbBone;
        const shin = bones[index * 2 + 1] as LimbBone;
        const knee = farEnd(thigh);
        const other = nearEnd(shin);
        expect(knee.y).toBeCloseTo(other.y, 9);
        expect(knee.z).toBeCloseTo(other.z, 9);
        // Both bones of a leg are on the same side of the bicycle.
        expect(thigh.x).toBeCloseTo(shin.x, 9);
      }
    }
  });

  it('bends the knee forward, never backward', () => {
    // ⚠️ The cosine rule gives an angle and not a side, so the mirror solution
    // is exactly as valid arithmetically and is a leg bending the wrong way —
    // the most obviously broken thing this function could draw, and the one a
    // jsdom test can still see.
    for (const angle of ROUND_THE_STROKE) {
      const bones = legBones(angle);
      for (const index of [0, 1]) {
        const thigh = bones[index * 2] as LimbBone;
        const hip = nearEnd(thigh);
        const foot = farEnd(bones[index * 2 + 1] as LimbBone);
        const knee = farEnd(thigh);
        // Twice the signed area of the triangle hip → foot → knee, read in the
        // side plane with `y` first. ⚠️ **The sign convention is worth deriving
        // rather than remembering**: the foot is below the hip, so
        // `foot.y − hip.y` is negative; a knee ahead of the line therefore has
        // `knee.z − hip.z` positive against it, and the product — and so the
        // cross — is **negative**. A knee bending backwards flips it.
        const cross = (foot.y - hip.y) * (knee.z - hip.z) - (foot.z - hip.z) * (knee.y - hip.y);
        expect(foot.y).toBeLessThan(hip.y);
        expect(cross).toBeLessThan(-0.02);
        // The same claim said a second way, and without a cross product: a knee
        // that bent backwards would be behind the hip rather than ahead of it.
        expect(knee.z).toBeGreaterThan(hip.z);
      }
    }
  });

  it('does not stretch a leg to reach the pedal', () => {
    // ⚠️ **Within 1 %, not exact, and the 1 % is the clamp.** The leg is fitted
    // 3 mm short of the furthest point of the stroke — `bicycle.ts` §`legBones`
    // says why — so the shin spans a little over its own length there. What
    // this rules out is the naive alternative: a knee put at the midpoint,
    // which makes both bones as long as the reach and varies them by 60 %
    // across a revolution.
    const lengths: number[] = [];
    for (let step = 0; step <= 720; step += 1) {
      for (const bone of legBones((step * TAU) / 720)) {
        lengths.push(bone.length);
      }
    }
    const shortest = Math.min(...lengths);
    const longest = Math.max(...lengths);
    expect(longest / shortest).toBeLessThan(1.01);
    expect(shortest).toBeGreaterThan(0.4);
    expect(longest).toBeLessThan(0.5);
  });

  it('keeps the pedal well clear of the hip, at every angle', () => {
    // ⚠️ **The invariant `kneeBetween` divides by, checked rather than
    // guarded.** If the hip and the pedal ever met there would be no direction
    // to resolve the knee against and the whole rider would leave the screen as
    // a `NaN`. They are both fixed numbers, so this is a property of the
    // geometry — and moving the saddle onto the bottom bracket turns it red,
    // which a branch nothing can reach would not.
    for (let step = 0; step <= 720; step += 1) {
      for (const index of [0, 1]) {
        const bones = legBones((step * TAU) / 720);
        const hip = nearEnd(bones[index * 2] as LimbBone);
        const foot = farEnd(bones[index * 2 + 1] as LimbBone);
        expect(Math.hypot(foot.y - hip.y, foot.z - hip.z)).toBeGreaterThan(0.5);
      }
    }
  });

  it('never produces a number a matrix cannot hold', () => {
    // A `NaN` from `Math.acos` out of range does not take one leg off the
    // screen: it propagates through the instance matrix and takes the whole
    // mesh with it. Swept finely, because the reach is nearest its limit over
    // a narrow arc at the bottom of the stroke.
    for (let step = 0; step <= 720; step += 1) {
      for (const bone of legBones((step * TAU) / 720)) {
        for (const number of [bone.x, bone.y, bone.z, bone.length, bone.pitch]) {
          expect(Number.isFinite(number)).toBe(true);
        }
      }
    }
  });

  it('moves the legs when the cranks move', () => {
    // The whole claim in one line: a different crank angle is a different pose.
    const top = legBones(0);
    const quarter = legBones(Math.PI / 2);
    expect(quarter.map((bone) => bone.pitch)).not.toEqual(top.map((bone) => bone.pitch));
  });

  it('is unchanged by a whole revolution, so the stroke is a cycle', () => {
    const pose = (angle: number) => legBones(angle).map((bone) => bone.pitch.toFixed(9));
    expect(pose(TAU + 0.3)).toEqual(pose(0.3));
  });
});

/**
 * A reading, as it arrives from `game/sensors.ts`.
 *
 * The four shapes that file produces: nothing paired at all, paired and live,
 * paired and quiet, and the reading of a channel whose value is missing.
 */
const READINGS: ReadonlyArray<{ readonly what: string; readonly reading: SensorReading }> = [
  { what: 'a live cadence sensor', reading: { value: 92, live: true, paired: true } },
  { what: 'no cadence sensor at all', reading: { value: undefined, live: false, paired: false } },
  {
    what: 'a sensor that has gone quiet',
    reading: { value: undefined, live: false, paired: true },
  },
  {
    what: 'a trainer that has not notified yet',
    reading: { value: undefined, live: false, paired: true },
  },
  {
    what: 'a live reading with no number in it',
    reading: { value: undefined, live: true, paired: true },
  },
  {
    what: 'a live reading that is not a number',
    reading: { value: Number.NaN, live: true, paired: true },
  },
  { what: 'a rider freewheeling', reading: { value: 0, live: true, paired: true } },
  // ⚠️ **The case that makes `live` load-bearing rather than redundant.**
  // `game/sensors.ts` clears the value of a channel that has gone quiet, so
  // every other reading here would behave identically if `advanceCrank` read
  // only the number — and the cranks would then go on turning at the last rate
  // a dropped sensor reported, which is the exact claim #349 forbids. A
  // producer that kept the last number is one change away.
  { what: 'a stale number from a dropped link', reading: { value: 88, live: false, paired: true } },
];

function route(): ReturnType<typeof routeProfile> {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 100; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(index * 0.4),
    });
  }
  return routeProfile(points);
}

function hudCadence(reading: SensorReading): string {
  const profile = route();
  const input: HudInput = {
    profile,
    state: atStartLine(profile),
    cadence: reading,
    heartRate: { value: undefined, live: false, paired: false },
  };
  const found = hudReadings(input).find((each) => each.key === 'cadence');
  expect(found).toBeDefined();
  return (found as { readonly value: string }).value;
}

describe('the cranks turn at the cadence, and only at the cadence', () => {
  it('advances by exactly the revolutions the reading claims', () => {
    // 92 rpm for a fifth of a second is 92/60 × 0.2 revolutions. The angle *is*
    // the integral of the number on the HUD, which is the whole of #349's
    // second criterion.
    const after = advanceCrank(0, { value: 92, live: true }, 0.2);
    expect(after).toBeCloseTo(((92 * TAU) / 60) * 0.2, 9);
  });

  it('turns twice as far in twice the time, and twice as fast at twice the rate', () => {
    // ⚠️ Both steps stay under {@link MAXIMUM_CRANK_STEP_SECONDS}, or the
    // doubling would be measuring the stall bound rather than the rate.
    const slow = advanceCrank(0, { value: 45, live: true }, 0.1);
    const fast = advanceCrank(0, { value: 90, live: true }, 0.1);
    const longer = advanceCrank(0, { value: 45, live: true }, 0.2);
    expect(fast).toBeCloseTo(slow * 2, 9);
    expect(longer).toBeCloseTo(slow * 2, 9);
  });

  it('accumulates across frames rather than restarting from where it began', () => {
    let angle = 0;
    for (let frame = 0; frame < 60; frame += 1) {
      angle = advanceCrank(angle, { value: 60, live: true }, 1 / 60);
    }
    // 60 rpm for one second is exactly one revolution, which wraps to zero.
    expect(Math.min(angle, TAU - angle)).toBeLessThan(1e-9);
  });

  it('keeps the angle small however long the ride runs', () => {
    let angle = 0;
    for (let frame = 0; frame < 5000; frame += 1) {
      angle = advanceCrank(angle, { value: 95, live: true }, 1 / 60);
    }
    expect(angle).toBeGreaterThanOrEqual(0);
    expect(angle).toBeLessThan(TAU);
  });

  it('leaves the cranks exactly where they were when there is no cadence', () => {
    for (const { what, reading } of READINGS) {
      const moved = advanceCrank(1.234, reading, 0.2) !== 1.234;
      // The `what` rides along in the comparison so that a failure names the
      // reading that broke rather than reporting `true !== false`.
      expect({ what, moved }).toEqual({ what, moved: reading.live && (reading.value ?? 0) > 0 });
    }
  });

  it('turns exactly when the HUD shows a cadence number', () => {
    // ⚠️ **The agreement, asserted against `hud/fields.ts` itself rather than
    // against a restatement of its rule.** #349's own words are that *"a rider
    // pedalling at a fixed rate while the HUD reads 92 rpm is worse than a
    // sphere, because it claims something false"* — so the two have to be the
    // same condition, and a change to either side that broke the agreement
    // would be caught here rather than on a phone.
    for (const { what, reading } of READINGS) {
      const shown = hudCadence(reading) !== NO_READING;
      const turning = advanceCrank(1.234, reading, 0.2) !== 1.234;
      // ⚠️ A rider freewheeling is the one case where the HUD shows a number
      // and the cranks do not turn — because the number is zero, and zero
      // revolutions a minute *is* still cranks.
      expect({ what, turning }).toEqual({
        what,
        turning: shown && (reading.value ?? 0) > 0,
      });
    }
  });

  it('does not spin through a backgrounded minute on the frame it comes back', () => {
    // `simulation.ts` bounds its own catch-up for the same reason; this is that
    // rule for the one thing on screen that integrates a rate.
    const afterAStall = advanceCrank(0, { value: 90, live: true }, 300);
    const afterTheBound = advanceCrank(0, { value: 90, live: true }, MAXIMUM_CRANK_STEP_SECONDS);
    expect(afterAStall).toBeCloseTo(afterTheBound, 9);
  });

  it('survives a clock that went backwards, and an angle that arrived broken', () => {
    expect(advanceCrank(1.5, { value: 90, live: true }, -1)).toBeCloseTo(1.5, 9);
    expect(advanceCrank(1.5, { value: 90, live: true }, Number.NaN)).toBeCloseTo(1.5, 9);
    expect(advanceCrank(Number.NaN, { value: 90, live: true }, 0.1)).toBe(0);
    expect(advanceCrank(-1, { value: undefined, live: false }, 0.1)).toBeCloseTo(TAU - 1, 9);
  });
});
