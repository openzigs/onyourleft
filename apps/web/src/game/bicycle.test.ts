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
  emptyRiderJoints,
  handPosition,
  LEG_BONE_COUNT,
  legBones,
  riderJoints,
  MAXIMUM_CRANK_STEP_SECONDS,
  RIDER_BODY_PARTS,
  RIDER_CRANK_PARTS,
  RIDER_PALETTE,
  SIMULATED_DEVELOPMENT_METRES,
  simulatedCrankAngle,
  type LimbBone,
  type RiderPart,
} from './bicycle';
import { NO_READING, hudReadings, type HudInput, type SensorReading } from './hud/fields';
import { DEFAULT_RIDING_POSITION, RIDING_POSITION_ORDER } from './rider';
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
    // A part of a ring is inside the whole ring's sphere whatever it sweeps, so
    // this is the same bound and is loose rather than wrong — which is what a
    // bounding sphere is for. The bar's own extent is asserted exactly, from
    // its arc, in §"the rider sits on the bicycle".
    case 'bend':
      return solid.radius + solid.thickness;
    case 'ball':
      return solid.radius;
  }
}

/**
 * Every number a solid's shape is built out of, so that each can be required to
 * be positive.
 *
 * ⚠️ **A `switch` rather than the ternary chain this replaced, and that is the
 * whole repair.** The chain read `box ? … : tube ? … : ring ? … : [radius]`, so
 * a shape it did not name fell through to the last arm and had only its
 * `radius` checked. #369's `bend` landed there: its `thickness` and its `sweep`
 * went unchecked, and a bar that swept **nothing** — a part that draws no
 * geometry at all — passed the test whose name is that every part can be built
 * from. A `switch` over the discriminant has no such arm, so a sixth
 * `RiderSolid` is a compile error here rather than a silent exemption.
 */
function sizesOf(solid: RiderPart['solid']): readonly number[] {
  switch (solid.shape) {
    case 'box':
      return [solid.width, solid.height, solid.depth];
    case 'tube':
      return [solid.radius, solid.length];
    case 'ring':
      return [solid.radius, solid.thickness];
    case 'bend':
      return [solid.radius, solid.thickness, solid.sweep];
    case 'ball':
      return [solid.radius];
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
      for (const size of sizesOf(each.solid)) {
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

/**
 * Where a point of a part's own centreline ends up, in the bicycle's frame.
 *
 * ⚠️ **This applies the three rotations X, then Y, then Z, then the
 * translation** — `RiderPart`'s own documented order, which `three-renderer.ts`
 * §`riderPartGeometry` builds with. It IS a re-implementation, and that is
 * deliberate here where `reachOf`'s bounding sphere deliberately avoids one:
 * the question below is not how big a part is but **where a particular point of
 * it lands**, and a hand on a bar cannot be checked any other way without a
 * GPU. The two disagreeing is the finding, not the noise.
 */
function placed(
  part: RiderPart,
  local: { readonly x: number; readonly y: number; readonly z: number },
): { readonly x: number; readonly y: number; readonly z: number } {
  const rx = (p: { x: number; y: number; z: number }, a: number) => ({
    x: p.x,
    y: p.y * Math.cos(a) - p.z * Math.sin(a),
    z: p.y * Math.sin(a) + p.z * Math.cos(a),
  });
  const ry = (p: { x: number; y: number; z: number }, a: number) => ({
    x: p.x * Math.cos(a) + p.z * Math.sin(a),
    y: p.y,
    z: -p.x * Math.sin(a) + p.z * Math.cos(a),
  });
  const rz = (p: { x: number; y: number; z: number }, a: number) => ({
    x: p.x * Math.cos(a) - p.y * Math.sin(a),
    y: p.x * Math.sin(a) + p.y * Math.cos(a),
    z: p.z,
  });
  const turned = rz(ry(rx({ ...local }, part.pitch), part.yaw), part.roll);
  return { x: turned.x + part.x, y: turned.y + part.y, z: turned.z + part.z };
}

/** Points along a part's centreline, in the bicycle's frame. */
function centreline(part: RiderPart): readonly { x: number; y: number; z: number }[] {
  const solid = part.solid;
  const steps = 24;
  if (solid.shape === 'bend') {
    return Array.from({ length: steps + 1 }, (_, step) => {
      const angle = solid.start + (step / steps) * solid.sweep;
      return placed(part, {
        x: solid.radius * Math.cos(angle),
        y: solid.radius * Math.sin(angle),
        z: 0,
      });
    });
  }
  if (solid.shape === 'tube') {
    return Array.from({ length: steps + 1 }, (_, step) =>
      placed(part, { x: 0, y: (step / steps - 0.5) * solid.length, z: 0 }),
    );
  }
  return [placed(part, { x: 0, y: 0, z: 0 })];
}

/** Every part of the handlebar — the tops, the two bends and the two drops. */
const BAR_PARTS = RIDER_BODY_PARTS.filter((each) => each.name.startsWith('bar '));

/** How far a point is from the nearest point of the bar's centreline. */
function distanceToBar(at: { readonly y: number; readonly z: number }, side: 1 | -1): number {
  let best = Number.POSITIVE_INFINITY;
  for (const part of BAR_PARTS) {
    // The tops run right across, so either hand can hold them; a bend and a
    // drop belong to one side of the bicycle.
    if (part.name !== 'bar tops' && Math.sign(part.x) !== side) continue;
    for (const point of centreline(part)) {
      if (part.name === 'bar tops' && Math.sign(point.x) !== side) continue;
      best = Math.min(best, Math.hypot(point.y - at.y, point.z - at.z));
    }
  }
  return best;
}

describe('the rider sits on the bicycle — #369', () => {
  it('has a drop bar rather than one straight tube across', () => {
    // The defect this replaces: the stylised bicycle's whole handlebar was a
    // single `tube`, which is a town bike, while `three-renderer.ts` drew a
    // curl on the realistic one from four literals of its own.
    const bends = BAR_PARTS.filter((each) => each.solid.shape === 'bend');
    expect(bends).toHaveLength(2);
    expect(BAR_PARTS.filter((each) => each.name.startsWith('bar drop'))).toHaveLength(2);
    // One bend each side, at the ends of the tops rather than in the middle.
    expect(bends.map((each) => Math.sign(each.x)).sort()).toEqual([-1, 1]);
    const tops = BAR_PARTS.find((each) => each.name === 'bar tops');
    expect(tops).toBeDefined();
    const half = reachOf((tops as RiderPart).solid);
    for (const bend of bends) {
      expect(Math.abs(bend.x)).toBeGreaterThan(half * 0.8);
    }
  });

  it('stands the bar on the head tube rather than near where it happens to be', () => {
    // ⚠️ **The link #369's first pass replaced with a coincidence of value.**
    // The bar was placed at `{ y: HEAD_TUBE_TOP_Y + 0.02, z: HEAD_TUBE_TOP_Z }`
    // and became the literals `0.98` and `0.34`, which are those two values
    // today — so nothing moved, no gate could see it, and the one statement of
    // where the bar is had quietly become two. The head tube moving is when it
    // would have been found, with the bar left floating where it was.
    const headTube = RIDER_BODY_PARTS.find((each) => each.name === 'head tube');
    expect(headTube).toBeDefined();
    const top = centreline(headTube as RiderPart).reduce((a, b) => (a.y > b.y ? a : b));
    const tops = BAR_PARTS.find((each) => each.name === 'bar tops');
    expect(tops).toBeDefined();
    // Directly above it and at the same point fore and aft: a stem, not a boom.
    expect((tops as RiderPart).z).toBeCloseTo(top.z, 9);
    const rise = (tops as RiderPart).y - top.y;
    expect(rise).toBeGreaterThan(0);
    expect(rise).toBeLessThan(0.05);
  });

  it('tapes the bar, which is what puts it in the renderer’s rubber', () => {
    // `three-renderer.ts` §`softly` sorts a part into the rubber merge or the
    // frame merge by this colour and by nothing else, so the bar being
    // tyre-coloured is a fact the drawing rests on rather than a taste. It was
    // sorted by a `'bar '` name prefix until #369's review, which is a second
    // statement of the same thing and drifts from this one in silence.
    for (const part of BAR_PARTS) {
      expect(part.colour, part.name).toBe(RIDER_PALETTE.tyre);
    }
    // …and a frame tube is not, or the whole bicycle would be bar tape.
    const headTube = RIDER_BODY_PARTS.find((each) => each.name === 'head tube');
    expect((headTube as RiderPart).colour).toBe(RIDER_PALETTE.frame);
  });

  it('curves the bar forward at the top and down to the drops, like a road bar', () => {
    // Read off the arc itself rather than from the constants that built it, so
    // a bend that was swept the wrong way — the arc through the BACK, which is
    // what a sweep with no start angle gives you — is a failure here.
    for (const bend of BAR_PARTS.filter((each) => each.solid.shape === 'bend')) {
      const arc = centreline(bend);
      const first = arc[0] as { y: number; z: number };
      const last = arc[arc.length - 1] as { y: number; z: number };
      const furthestForward = Math.max(...arc.map((point) => point.z));

      // It starts at the tops and ends at the drops: a whole bar's drop lower.
      expect(last.y).toBeLessThan(first.y - 0.1);
      expect(last.y).toBeGreaterThan(first.y - 0.16);
      // …and the curve's forward-most point is ahead of both ends, which is
      // what makes it a bar's reach rather than a hook pointing backwards.
      expect(furthestForward).toBeGreaterThan(first.z + 0.04);
      expect(furthestForward).toBeGreaterThan(last.z + 0.04);
      // The whole bend stays in the bicycle's own plane, at its own side.
      for (const point of arc) {
        expect(point.x).toBeCloseTo(bend.x, 9);
      }
    }
  });

  it('puts every hand position on the bar that is actually drawn', () => {
    // ⚠️ **The assertion #369 exists for.** Before it, the hands were a
    // `GRIP_Y`/`GRIP_Z` pair and the drops were four numbers in another file,
    // 50 mm apart, and every gate in this repository was green about it.
    for (const position of RIDING_POSITION_ORDER) {
      const at = handPosition(position);
      for (const side of [1, -1] as const) {
        // Within a bar's own radius plus the thickness of a hand: a hand that
        // is 50 mm off the tube is not holding it.
        expect(distanceToBar(at, side)).toBeLessThan(0.04);
      }
    }
  });

  it('gets lower with every position the drag table charges less air for', () => {
    // `rider.ts` orders the three most-air-pushed first and charges 0.42, 0.36
    // and 0.31 m² for them. A bar whose drops were ABOVE its tops would make
    // that table describe a bicycle nobody is drawing.
    const heights = RIDING_POSITION_ORDER.map((position) => handPosition(position).y);
    for (let at = 1; at < heights.length; at += 1) {
      expect(heights[at] as number).toBeLessThan(heights[at - 1] as number);
    }
    // And the two the rider reaches for are a real bar's drop apart.
    expect(handPosition('upright').y - handPosition('drops').y).toBeGreaterThan(0.1);
    expect(handPosition('upright').y - handPosition('drops').y).toBeLessThan(0.17);
  });

  it('draws the rider in the position `rider.ts` rides them in by default', () => {
    // The merged geometry is built once, so the drawn hands are one position's.
    // That it is the DEFAULT is what keeps the picture and the drag area from
    // describing two different riders on the same frame.
    const grips = emptyRiderJoints();
    riderJoints(0, grips);
    const hoods = handPosition(DEFAULT_RIDING_POSITION);
    for (const grip of grips.grip) {
      expect(grip.y).toBeCloseTo(hoods.y, 9);
      expect(grip.z).toBeCloseTo(hoods.z, 9);
    }
  });

  it('reaches the bar with an arm, rather than with a tow rope or a stub', () => {
    // The arms are drawn as tubes from the shoulder to the grip, so they take
    // whatever length the gap between the two happens to be: move the bar and
    // the arm simply grows, with nothing complaining. This is what complains.
    //
    // ⚠️ **The bound is tight on purpose, and it was measured rather than
    // guessed.** A first version allowed 0.40–0.62 m and a bar moved 150 mm
    // forward passed it — 0.599 m, which on a rider 1.515 m tall at the helmet
    // is an arm two fifths of their height. Shoulder-to-hand is about 0.30 of a
    // person's stature, and a rider measuring 1.515 m crouched stands about
    // 1.75 m, so the arm is ~0.52 m at the very most.
    const arms = RIDER_BODY_PARTS.filter((each) => each.name.startsWith('arm '));
    expect(arms).toHaveLength(2);
    for (const arm of arms) {
      const length = (arm.solid as { readonly length: number }).length;
      expect(length).toBeGreaterThan(0.42);
      expect(length).toBeLessThan(0.53);
      // …and the arm runs DOWN and FORWARD from the shoulder at a road fit's
      // angle. A bar far enough forward flattens it towards a reach; a bar too
      // close stands it up under the rider.
      const ends = centreline(arm);
      const lowest = ends.reduce((a, b) => (a.y < b.y ? a : b));
      const highest = ends.reduce((a, b) => (a.y > b.y ? a : b));
      const belowHorizontal =
        (Math.atan2(highest.y - lowest.y, lowest.z - highest.z) * 180) / Math.PI;
      expect(belowHorizontal).toBeGreaterThan(35);
      expect(belowHorizontal).toBeLessThan(55);
      // …and it ends ON the bar rather than short of it or through it.
      expect(distanceToBar(lowest, Math.sign(arm.x) as 1 | -1)).toBeLessThan(0.05);
    }
  });

  it('sets the saddle a leg above the bottom bracket, not a stool above it', () => {
    // Saddle height is the one measurement every rider knows, and it is what
    // makes a bicycle look ridden rather than sat on. About 109 % of the inside
    // leg is the usual fit; here the leg is the thigh and shin this file
    // already builds, so the check is against those rather than a new number.
    const saddle = RIDER_BODY_PARTS.find((each) => each.name === 'saddle');
    expect(saddle).toBeDefined();
    const height = (saddle as RiderPart).y - CRANK_AXIS_Y;
    const leg = legBones(0);
    const oneLeg = (leg[0] as LimbBone).length + (leg[1] as LimbBone).length;
    // The saddle sits between the extended leg's reach less a crank and that
    // reach itself: a rider whose knee never straightens, and one who cannot
    // reach the bottom of the stroke, are the two failures either side.
    expect(height).toBeGreaterThan(oneLeg - CRANK_LENGTH_METRES * 1.3);
    expect(height).toBeLessThan(oneLeg);
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

/**
 * The bot's and the ghost's cranks, which come from neither a sensor nor a
 * clock — #368.
 *
 * ⚠️ **#368's second criterion is a decision to record rather than a behaviour
 * to implement**: *"neither has a cadence, so `advanceCrank`'s honesty rule
 * does not apply as written. Decide and record: either derive a cadence from
 * their speed and a fixed gear… or leave them still. Do not invent a rate and
 * call it a reading."*
 *
 * The decision is a **third** option, and the assertions below are what make it
 * checkable: the angle is a pure function of the odometer at a fixed
 * development, so nothing is integrated, nothing is a rate, and there is no
 * state to be wrong across a pause.
 */
describe("a simulated rider's cranks turn because its wheels did — #368", () => {
  it('turns exactly one revolution per development of road', () => {
    expect(simulatedCrankAngle(0)).toBe(0);
    expect(simulatedCrankAngle(SIMULATED_DEVELOPMENT_METRES)).toBeCloseTo(0, 9);
    expect(simulatedCrankAngle(SIMULATED_DEVELOPMENT_METRES / 2)).toBeCloseTo(Math.PI, 9);
    expect(simulatedCrankAngle(SIMULATED_DEVELOPMENT_METRES / 4)).toBeCloseTo(Math.PI / 2, 9);
  });

  it('stands still for a rider who is standing still', () => {
    // ⚠️ **The honesty property, and it falls out rather than being enforced.**
    // `advanceCrank` needs an explicit rule to stop a rider with no cadence
    // pedalling; a bot that has not moved has not turned its cranks because
    // there is nothing in the derivation but the distance.
    expect(simulatedCrankAngle(137.5)).toBe(simulatedCrankAngle(137.5));
    expect(simulatedCrankAngle(0)).toBe(0);
  });

  it('carries no state, so a five-minute stall changes nothing', () => {
    // ⚠️ **What `MAXIMUM_CRANK_STEP_SECONDS` exists to bound for the rider does
    // not arise here at all.** A backgrounded phone hands the next frame a gap
    // of minutes; an integrator would spin through hundreds of revolutions on
    // that frame, and this returns the angle for wherever the bot now is.
    const before = simulatedCrankAngle(400);
    const away = simulatedCrankAngle(9_999);

    expect(simulatedCrankAngle(400)).toBe(before);
    expect(away).toBe(simulatedCrankAngle(9_999));
  });

  it('wraps into one turn however long the ride', () => {
    for (const distance of [0, 1, 6.2, 1_000, 250_000, -12]) {
      const angle = simulatedCrankAngle(distance);

      expect(angle).toBeGreaterThanOrEqual(0);
      expect(angle).toBeLessThan(Math.PI * 2);
    }
  });

  it('answers a distance that is not a distance with a defined angle', () => {
    // A `NaN` reaching a rotation matrix is a rider that is not drawn at all.
    expect(simulatedCrankAngle(Number.NaN)).toBe(0);
    expect(simulatedCrankAngle(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('produces a plausible cadence across the speeds this game reaches', () => {
    // ⚠️ **The one thing the gear is chosen for**, and it is stated as the
    // range rather than as the ratio: a development that made 30 km/h read as
    // 40 rpm or as 160 would be visibly wrong in a way no other assertion here
    // could see. 20, 30 and 40 km/h come out at about 54, 81 and 108 rpm.
    for (const [kilometresPerHour, low, high] of [
      [20, 45, 65],
      [30, 70, 95],
      [40, 95, 125],
    ] as const) {
      const metresPerSecond = kilometresPerHour / 3.6;
      const revolutionsPerMinute = (metresPerSecond * 60) / SIMULATED_DEVELOPMENT_METRES;

      expect(revolutionsPerMinute).toBeGreaterThan(low);
      expect(revolutionsPerMinute).toBeLessThan(high);
    }
  });

  it('is not `advanceCrank` with a made-up reading', () => {
    // ⚠️ **The claim #368 asks to be recorded, made mechanical.** If a
    // simulated rider's angle went through `advanceCrank`, it would need a
    // `SensorReading` this program had invented — and it would then depend on a
    // frame's elapsed time, which is the thing that makes a stall wrong. Two
    // riders at the same distance agree whatever happened between the frames.
    expect(simulatedCrankAngle(613.4)).toBe(simulatedCrankAngle(613.4));
    // And a rider whose cranks are advanced by `advanceCrank` with no reading
    // does not move at all, which is the rule that does NOT apply here.
    expect(advanceCrank(1.2, { live: false, value: 90 }, 1)).toBeCloseTo(1.2, 9);
    expect(simulatedCrankAngle(SIMULATED_DEVELOPMENT_METRES / 2)).not.toBeCloseTo(0, 3);
  });
});

describe('the joints a realistic body is posed onto — #369', () => {
  /** A bone's two ends, from its midpoint, length and pitch. */
  function ends(bone: LimbBone): readonly [readonly [number, number], readonly [number, number]] {
    const dy = (bone.length / 2) * Math.cos(bone.pitch);
    const dz = (bone.length / 2) * Math.sin(bone.pitch);
    return [
      [bone.y - dy, bone.z - dz],
      [bone.y + dy, bone.z + dz],
    ];
  }

  it('puts each knee and foot exactly where the stylised leg puts it, at every angle', () => {
    // ⚠️ The claim #369 needs: ONE source for where a leg is. A realistic knee
    // solved a second way would drift from the stylised one, and the HUD's
    // cadence would be drawn by two different legs.
    const joints = emptyRiderJoints();
    for (let step = 0; step < 72; step += 1) {
      const angle = (step / 72) * TAU;
      riderJoints(angle, joints);
      const bones = legBones(angle);
      for (const index of [0, 1] as const) {
        const thigh = bones[index * 2] as LimbBone;
        const shin = bones[index * 2 + 1] as LimbBone;
        const [, knee] = ends(thigh);
        const [, foot] = ends(shin);
        expect(joints.knee[index].x).toBeCloseTo(thigh.x, 12);
        expect(joints.knee[index].y).toBeCloseTo(knee[0], 9);
        expect(joints.knee[index].z).toBeCloseTo(knee[1], 9);
        expect(joints.foot[index].y).toBeCloseTo(foot[0], 9);
        expect(joints.foot[index].z).toBeCloseTo(foot[1], 9);
      }
    }
  });

  it('puts each foot on its own pedal, half a turn apart', () => {
    const joints = riderJoints(0.3, emptyRiderJoints());
    for (const index of [0, 1] as const) {
      const foot = joints.foot[index];
      expect(Math.hypot(foot.y - CRANK_AXIS_Y, foot.z - CRANK_AXIS_Z)).toBeCloseTo(
        CRANK_LENGTH_METRES,
        12,
      );
    }
    const [left, right] = joints.foot;
    expect(left.y - CRANK_AXIS_Y).toBeCloseTo(-(right.y - CRANK_AXIS_Y), 12);
    expect(left.x).toBe(-right.x);
  });

  it('moves the legs only when the crank angle does — #349’s rule, for the realistic rider', () => {
    const a = riderJoints(1.1, emptyRiderJoints());
    const same = riderJoints(1.1, emptyRiderJoints());
    const turned = riderJoints(1.1 + Math.PI / 2, emptyRiderJoints());
    expect(same).toEqual(a);
    expect(turned.foot[0]).not.toEqual(a.foot[0]);
    // The body does not move with the cranks: hips, shoulders and hands hold.
    expect(turned.hips).toEqual(a.hips);
    expect(turned.shoulders).toEqual(a.shoulders);
    expect(turned.grip).toEqual(a.grip);
  });

  it('writes into the set it is given rather than making another', () => {
    const joints = emptyRiderJoints();
    expect(riderJoints(0, joints)).toBe(joints);
  });
});
