// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1660: L-, T-, U- and Z-shaped mapped houses pitched over 2 or 3
 * rectangles, and no roof hanging over an empty notch. `rectanglesOf` is
 * property-tested; the roofs are asserted on what `footprintPlans` — the call
 * the press makes — hands back, each against its control: the same corridor
 * planned with `splitRoofs: false`, which is `main`'s rule.
 */

import { describe, expect, it } from 'vitest';

import type { BuildingFeature, Ring } from '@onyourleft/map-features';

import {
  DORMER,
  EAVES_OVERHANG_METRES,
  FOOTPRINT_MAX_FAR_TRIANGLES,
  FOOTPRINT_MAX_TRIANGLES,
  FOOTPRINT_MAX_VERTICES,
  FOOTPRINT_ROLES,
  FOOTPRINT_VERTEX_FLOATS,
  footprintPlans,
  GUTTER,
  STYLE_EAVES,
  STYLE_OFFSET,
  FACADE_OFFSET,
  type FootprintPlan,
  type FootprintRole,
} from './footprint-buildings';
import {
  buildingBeside,
  landBeside,
  mixedTownFixture,
  ROOF_SHAPES,
  sawToothYou,
  shapeBeside,
  type RoofShapeName,
  type ShapeCorners,
} from './footprint-fixtures-testing';
import { landClassMask } from './land-class';
import { rectanglesOf, RECTANGLES_MAX, type Rectangle } from './rectilinear-roofs';
import { northRoute } from './route-fixtures-testing';
import { corridorOrigin } from './terrain';
import type { WorldCorridor } from './world-data/corridor';

const profile = northRoute(3_000, () => 10);
const origin = corridorOrigin(profile);

/** `corners` turned by `turn` radians about the origin, as a flat ring. */
function ringOf(corners: ShapeCorners, turn = 0): Ring {
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  return Float32Array.from(corners.flatMap(([x, y]) => [x * cos - y * sin, x * sin + y * cos]));
}

/** A ring's area, by the shoelace. */
function areaOf(ring: Ring): number {
  let twice = 0;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    twice +=
      (ring[j * 2] as number) * (ring[i * 2 + 1] as number) -
      (ring[i * 2] as number) * (ring[j * 2 + 1] as number);
  }
  return Math.abs(twice) / 2;
}

/** Whether `(x, z)` is inside `ring`, or within a millimetre of its edge. */
function inside(ring: Ring, x: number, z: number): boolean {
  const n = ring.length / 2;
  let odd = false;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const xi = ring[i * 2] as number;
    const zi = ring[i * 2 + 1] as number;
    const xj = ring[j * 2] as number;
    const zj = ring[j * 2 + 1] as number;
    const length = Math.hypot(xj - xi, zj - zi);
    const t = Math.max(0, Math.min(1, ((x - xi) * (xj - xi) + (z - zi) * (zj - zi)) / length ** 2));
    if (Math.hypot(xi + (xj - xi) * t - x, zi + (zj - zi) * t - z) < 1e-3) return true;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) odd = !odd;
  }
  return odd;
}

/** A rectangle as intervals along and across the first's axis. */
function intervalsOf(each: Rectangle, ux: number, uz: number): [number, number, number, number] {
  const a = each.cx * ux + each.cz * uz;
  const c = -each.cx * uz + each.cz * ux;
  const parallel = Math.abs(each.ux * ux + each.uz * uz) > 0.5;
  const halfA = parallel ? each.halfLong : each.halfShort;
  const halfC = parallel ? each.halfShort : each.halfLong;
  return [a - halfA, a + halfA, c - halfC, c + halfC];
}

/** The area of the union of `rectangles`, which share one frame, by inclusion and exclusion. */
function unionArea(rectangles: readonly Rectangle[]): number {
  const { ux, uz } = rectangles[0] as Rectangle;
  const boxes = rectangles.map((each) => intervalsOf(each, ux, uz));
  const meet = (
    p: readonly number[],
    q: readonly number[],
  ): [number, number, number, number] | undefined => {
    const box: [number, number, number, number] = [
      Math.max(p[0] as number, q[0] as number),
      Math.min(p[1] as number, q[1] as number),
      Math.max(p[2] as number, q[2] as number),
      Math.min(p[3] as number, q[3] as number),
    ];
    return box[1] > box[0] && box[3] > box[2] ? box : undefined;
  };
  const area = (box: readonly number[] | undefined): number =>
    box === undefined
      ? 0
      : ((box[1] as number) - (box[0] as number)) * ((box[3] as number) - (box[2] as number));
  let total = boxes.reduce((sum, box) => sum + area(box), 0);
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      total -= area(meet(boxes[i] as number[], boxes[j] as number[]));
      for (let k = j + 1; k < boxes.length; k += 1) {
        const ij = meet(boxes[i] as number[], boxes[j] as number[]);
        total += ij === undefined ? 0 : area(meet(ij, boxes[k] as number[]));
      }
    }
  }
  return total;
}

/** Points through a rectangle — a 5 × 5 lattice, its edges included. */
function latticeOf(each: Rectangle): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= 4; i += 1) {
    for (let j = 0; j <= 4; j += 1) {
      const a = each.halfLong * (i / 2 - 1);
      const c = each.halfShort * (j / 2 - 1);
      out.push([each.cx + each.ux * a - each.uz * c, each.cz + each.uz * a + each.ux * c]);
    }
  }
  return out;
}

const SHAPES_OF_TWO_OR_THREE: readonly RoofShapeName[] = ['ell', 'tee', 'you', 'zed'];

describe('rectanglesOf — the decomposition, property-tested (#1660)', () => {
  it('splits an L, a T, a U and a Z into 2 or 3 rectangles whose union is the ring, at any turn', () => {
    for (const name of SHAPES_OF_TWO_OR_THREE) {
      for (const turn of [0, 0.3, 1.1, 2.9, -0.7]) {
        const ring = ringOf(ROOF_SHAPES[name], turn);
        const rectangles = rectanglesOf(ring);
        expect(rectangles, name).toBeDefined();
        const parts = rectangles as readonly Rectangle[];
        expect(parts.length, name).toBeGreaterThanOrEqual(2);
        expect(parts.length, name).toBeLessThanOrEqual(3);
        expect(Math.abs(unionArea(parts) - areaOf(ring)), name).toBeLessThan(0.05);
        // Every rectangle, and so every overlap, inside the ring.
        for (const each of parts) {
          for (const [x, z] of latticeOf(each)) expect(inside(ring, x, z), name).toBe(true);
        }
        // The largest first.
        const areas = parts.map((each) => each.halfLong * each.halfShort);
        expect(areas).toStrictEqual([...areas].sort((p, q) => q - p));
      }
    }
  });

  it('snaps a ring whose walls are a few degrees off square', () => {
    // The L with its far corner pushed 0.5 m out: its walls within 3° of the axis.
    const corners = ROOF_SHAPES.ell.map(([x, y]) =>
      x === 14 && y === 5 ? ([14.3, 5.5] as const) : ([x, y] as const),
    );
    expect(rectanglesOf(ringOf(corners, 0.4))?.length).toBe(2);
    // A 0.9-rectangularity box with a notch is an L.
    expect(rectanglesOf(ringOf(ROOF_SHAPES.notched))?.length).toBe(2);
    // A rectangle is one.
    const box: ShapeCorners = [
      [0, 0],
      [14, 0],
      [14, 10],
      [0, 10],
    ];
    expect(rectanglesOf(ringOf(box, 0.2))).toHaveLength(1);
  });

  it('refuses a 12-gon, an edge 20° off the axis, and a zig-zag', () => {
    expect(rectanglesOf(ringOf(ROOF_SHAPES.dodecagon))).toBeUndefined();
    expect(rectanglesOf(ringOf(ROOF_SHAPES.skewed))).toBeUndefined();
    // A box whose back wall zig-zags in walls 5.7° off square: each within the snap, but turning
    // back on itself, so not one wall.
    // Between two short walls along the axis, so that only the turning back refuses it.
    const zig: [number, number][] = [
      [0, 0],
      [12, 0],
      [12, 10],
    ];
    for (let k = 0; k <= 12; k += 1) zig.push([11 - (10 * k) / 12, k % 2 === 1 ? 18 : 10]);
    zig.push([0, 10]);
    expect(rectanglesOf(ringOf(zig))).toBeUndefined();
  });

  it('refuses a shape that needs more than 3 rectangles: an E', () => {
    const e: ShapeCorners = [
      [0, 0],
      [10, 0],
      [10, 2],
      [3, 2],
      [3, 4],
      [10, 4],
      [10, 6],
      [3, 6],
      [3, 8],
      [10, 8],
      [10, 10],
      [0, 10],
    ];
    expect(rectanglesOf(ringOf(e))).toBeUndefined();
  });

  it('never returns more than 3, never throws, and is quick over seeded random rectilinear rings', () => {
    let state = 0x16_60;
    const next = (): number => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 0x1_0000_0000;
    };
    const started = performance.now();
    let found = 0;
    for (let trial = 0; trial < 2_000; trial += 1) {
      // 2 to 6 corners each way: a rectilinear ring of 4 to 12 vertices, simple or not.
      const half = 2 + Math.floor(next() * 5);
      const as = Array.from({ length: half }, () => Math.round(next() * 40) / 2);
      const cs = Array.from({ length: half }, () => Math.round(next() * 40) / 2);
      const corners: [number, number][] = [];
      for (let k = 0; k < half; k += 1) {
        corners.push([as[k] as number, cs[k] as number]);
        corners.push([as[(k + 1) % half] as number, cs[k] as number]);
      }
      const rectangles = rectanglesOf(ringOf(corners, next() * Math.PI));
      if (rectangles === undefined) continue;
      found += 1;
      expect(rectangles.length).toBeGreaterThanOrEqual(1);
      expect(rectangles.length).toBeLessThanOrEqual(RECTANGLES_MAX);
    }
    expect(found).toBeGreaterThan(100);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

/** `shapes` (each its corners, its origin's along and lateral, and a height) planned on residential land. */
function plansOf(
  shapes: readonly (readonly [ShapeCorners, number, number, number | null])[],
  splitRoofs = true,
  maxVertices = FOOTPRINT_MAX_VERTICES,
): readonly FootprintPlan[] {
  const buildings: BuildingFeature[] = shapes.map(([corners, along, lateral, height]) =>
    buildingBeside(profile, origin, [shapeBeside(corners, along, lateral)], height),
  );
  const corridor: WorldCorridor = {
    routeId: 'split-roofs',
    origin,
    covered: () => true,
    coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
    landUse: [landBeside(profile, origin, 'landuse', 'residential', 10, 2_990, -150, 150)],
    buildings,
    paths: [],
    streets: [],
  };
  const { plans, verdicts } = footprintPlans(
    corridor,
    landClassMask(corridor),
    profile,
    origin,
    maxVertices,
    undefined,
    { splitRoofs },
  );
  expect(verdicts.kept).toBe(shapes.length);
  return plans;
}

/** One vertex of a role's triangles. */
interface Vertex {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly normalY: number;
  readonly top: number;
  readonly flags: number;
}

function verticesOf(plan: FootprintPlan, role: FootprintRole): Vertex[] {
  const floats = plan.triangles[role];
  const out: Vertex[] = [];
  for (let at = 0; at < floats.length; at += FOOTPRINT_VERTEX_FLOATS) {
    out.push({
      x: floats[at] as number,
      y: floats[at + 1] as number,
      z: floats[at + 2] as number,
      normalY: floats[at + 4] as number,
      top: floats[at + FACADE_OFFSET + 2] as number,
      flags: floats[at + STYLE_OFFSET + 1] as number,
    });
  }
  return out;
}

/** The 14 × 10 m L with a 6 × 5 m notch, `count` of them along the road, 9 m tall. */
const ells = (count: number): readonly (readonly [ShapeCorners, number, number, number])[] =>
  Array.from({ length: count }, (_, index) => [ROOF_SHAPES.ell, 300 + 40 * index, 30, 6] as const);

/**
 * How far `(x, z)` is outside `rectangles` — the footprint's own — along
 * either of their axes: 0 inside. The overhang is a reach along an axis, so a
 * roof's corner, out by both, is out by the overhang and not its diagonal.
 */
function outsideBy(rectangles: readonly Rectangle[], x: number, z: number): number {
  let least = Number.POSITIVE_INFINITY;
  for (const each of rectangles) {
    const a = (x - each.cx) * each.ux + (z - each.cz) * each.uz;
    const c = -(x - each.cx) * each.uz + (z - each.cz) * each.ux;
    least = Math.min(least, Math.max(0, Math.abs(a) - each.halfLong, Math.abs(c) - each.halfShort));
  }
  return least;
}

describe('the read path — an L through footprintPlans (#1660)', () => {
  it('pitches a 14 × 10 m residential L with a 6 × 5 m notch, where main put it flat', () => {
    const [split] = plansOf([[ROOF_SHAPES.ell, 300, 30, 6]]) as [FootprintPlan];
    expect(['gable', 'hip']).toContain(split.roof);
    const [control] = plansOf([[ROOF_SHAPES.ell, 300, 30, 6]], false) as [FootprintPlan];
    expect(control.roof).toBe('flat');
  });

  it('pitches the T, the U and the Z too; the 12-gon and the skewed box keep main’s rule', () => {
    const plans = plansOf([
      [ROOF_SHAPES.tee, 300, 30, 6],
      [ROOF_SHAPES.you, 340, 30, 6],
      [ROOF_SHAPES.zed, 380, 30, 6],
      [ROOF_SHAPES.dodecagon, 420, 30, 6],
      [ROOF_SHAPES.skewed, 460, 30, 6],
    ]);
    const control = plansOf(
      [
        [ROOF_SHAPES.tee, 300, 30, 6],
        [ROOF_SHAPES.you, 340, 30, 6],
        [ROOF_SHAPES.zed, 380, 30, 6],
        [ROOF_SHAPES.dodecagon, 420, 30, 6],
        [ROOF_SHAPES.skewed, 460, 30, 6],
      ],
      false,
    );
    for (const plan of plans.slice(0, 3)) expect(plan.roof).not.toBe('flat');
    for (const plan of control.slice(0, 3)) expect(plan.roof).toBe('flat');
    // Not rectilinear: exactly as with the split off, which is main's rule.
    for (const index of [3, 4]) {
      const ours = plans[index] as FootprintPlan;
      const theirs = control[index] as FootprintPlan;
      expect(ours.roof).toBe(theirs.roof);
      for (const role of FOOTPRINT_ROLES) {
        expect(Array.from(ours.triangles[role])).toStrictEqual(Array.from(theirs.triangles[role]));
      }
    }
  });
});

describe('the notch fix — #1660', () => {
  it('hangs no roof or soffit over the notch of the L or of the 0.9 box', () => {
    for (const name of ['ell', 'notched'] as const) {
      const plans = plansOf(
        Array.from(
          { length: 8 },
          (_, index) => [ROOF_SHAPES[name], 300 + 40 * index, 30, 6] as const,
        ),
      );
      for (const plan of plans) {
        expect(plan.roof).not.toBe('flat');
        const own = rectanglesOf(plan.footprint) as readonly Rectangle[];
        expect(own.length).toBe(2);
        // The roof, and its soffits: the trim facing down at the roof's own pitch.
        const cos = Math.cos((plan.pitchDegrees * Math.PI) / 180);
        const soffits = verticesOf(plan, 'trim').filter(
          (vertex) => Math.abs(vertex.normalY + cos) < 1e-4,
        );
        expect(soffits.length).toBeGreaterThan(0);
        for (const vertex of [...verticesOf(plan, 'roof'), ...soffits]) {
          expect(outsideBy(own, vertex.x, vertex.z)).toBeLessThanOrEqual(
            EAVES_OVERHANG_METRES + 0.01,
          );
        }
      }
    }
  });

  it('control: with the split off, the 0.9 box is roofed over its minimum-area rectangle and its notch', () => {
    const [box] = plansOf([[ROOF_SHAPES.notched, 300, 30, 6]], false) as [FootprintPlan];
    expect(box.roof).not.toBe('flat');
    const own = rectanglesOf(box.footprint) as readonly Rectangle[];
    const worst = Math.max(
      ...verticesOf(box, 'roof').map((vertex) => outsideBy(own, vertex.x, vertex.z)),
    );
    expect(worst).toBeGreaterThan(3);
  });
});

describe('one roof, not three — #1660', () => {
  it('pitches every part of an L at one pitch from one eaves', () => {
    for (const plan of plansOf(ells(12))) {
      expect(plan.roof).not.toBe('flat');
      const roof = verticesOf(plan, 'roof');
      // One pitch: every slope's normal leans the same, or is a hip end's at the same pitch.
      const cos = Math.cos((plan.pitchDegrees * Math.PI) / 180);
      for (const vertex of roof) expect(vertex.normalY).toBeCloseTo(cos, 4);
      // One eaves: the lowest corner of every roof triangle is at one height.
      const lows = new Set<number>();
      for (let at = 0; at + 2 < roof.length; at += 3) {
        const low = Math.min(...roof.slice(at, at + 3).map((vertex) => vertex.y));
        lows.add(Math.round(low * 1_000));
      }
      expect(lows.size).toBe(1);
    }
  });

  it('hangs the gutters, and stands the dormers, on the largest rectangle only', () => {
    let withDormers = 0;
    let withGutters = 0;
    for (const plan of plansOf(ells(24))) {
      const [largest, other] = rectanglesOf(plan.footprint) as [Rectangle, Rectangle];
      const reachOf = (each: Rectangle, vertex: Vertex): number =>
        Math.abs(-(vertex.x - each.cx) * each.uz + (vertex.z - each.cz) * each.ux) -
        (each.halfShort + EAVES_OVERHANG_METRES + GUTTER.width);
      const trim = verticesOf(plan, 'trim');
      const onLargest = trim.filter((vertex) => Math.abs(reachOf(largest, vertex)) < 1e-3);
      if (onLargest.length > 0) {
        withGutters += 1;
        // Both of its gutters' fronts, as #1588 hangs them: six, three and three and three each.
        expect(onLargest.length).toBeGreaterThanOrEqual(2 * (6 + 3 + 3 + 3));
        // And none on the other rectangle's eaves.
        expect(trim.filter((vertex) => Math.abs(reachOf(other, vertex)) < 1e-3)).toStrictEqual([]);
      }
      if (plan.dormers > 0) {
        withDormers += 1;
        for (const vertex of verticesOf(plan, 'dormer')) {
          const a = (vertex.x - largest.cx) * largest.ux + (vertex.z - largest.cz) * largest.uz;
          const c = -(vertex.x - largest.cx) * largest.uz + (vertex.z - largest.cz) * largest.ux;
          expect(Math.abs(a)).toBeLessThanOrEqual(largest.halfLong);
          expect(Math.abs(c)).toBeLessThanOrEqual(largest.halfShort - DORMER.setBack + 1e-3);
        }
      }
    }
    expect(withGutters).toBeGreaterThan(5);
    expect(withDormers).toBeGreaterThan(0);
  });

  it('reads each wall’s eaves flag against the rectangles: a wing’s gable end unmarked, every side marked', () => {
    let ends = 0;
    let sides = 0;
    for (const plan of plansOf(ells(24))) {
      if (plan.roof !== 'gable') continue;
      const parts = rectanglesOf(plan.footprint) as readonly Rectangle[];
      const walls = verticesOf(plan, 'wall');
      for (let at = 0; at + 6 <= walls.length; at += 6) {
        const quad = walls.slice(at, at + 6);
        if ((quad[0] as Vertex).top <= 0) continue;
        const xs = quad.map((vertex) => vertex.x);
        const zs = quad.map((vertex) => vertex.z);
        const dx = Math.max(...xs) - Math.min(...xs);
        const dz = Math.max(...zs) - Math.min(...zs);
        const length = Math.hypot(dx, dz);
        const mx = (Math.max(...xs) + Math.min(...xs)) / 2;
        const mz = (Math.max(...zs) + Math.min(...zs)) / 2;
        // Along a rectangle's long side, under its eaves; otherwise a wing's gable end.
        const underEaves = parts.some((each) => {
          const a = (mx - each.cx) * each.ux + (mz - each.cz) * each.uz;
          const c = -(mx - each.cx) * each.uz + (mz - each.cz) * each.ux;
          const along = Math.abs((dx * each.ux + dz * each.uz) / length);
          return (
            along > Math.SQRT1_2 &&
            Math.abs(Math.abs(c) - each.halfShort) < 1e-2 &&
            Math.abs(a) <= each.halfLong + 1e-2
          );
        });
        if (underEaves) {
          sides += 1;
          expect((quad[0] as Vertex).flags & STYLE_EAVES).toBe(STYLE_EAVES);
        } else {
          ends += 1;
          expect((quad[0] as Vertex).flags & STYLE_EAVES).toBe(0);
        }
      }
    }
    expect(ends).toBeGreaterThan(0);
    expect(sides).toBeGreaterThan(0);
  });
});

describe('unchanged elsewhere — #1660', () => {
  it('plans every mixed-town footprint that is not split exactly as with the split off', () => {
    const town = mixedTownFixture();
    const land = landClassMask(town.corridor);
    const plan = (splitRoofs: boolean): readonly FootprintPlan[] =>
      footprintPlans(
        town.corridor,
        land,
        town.profile,
        town.origin,
        FOOTPRINT_MAX_VERTICES,
        undefined,
        { splitRoofs },
      ).plans;
    const on = plan(true);
    const off = plan(false);
    expect(on).toHaveLength(off.length);
    let split = 0;
    for (const [index, ours] of on.entries()) {
      const theirs = off[index] as FootprintPlan;
      if (ours.roof !== theirs.roof) {
        // The L's that are now pitched, and only those.
        expect((rectanglesOf(ours.footprint) ?? []).length).toBeGreaterThan(1);
        split += 1;
        continue;
      }
      for (const role of FOOTPRINT_ROLES) {
        expect(Array.from(ours.triangles[role])).toStrictEqual(Array.from(theirs.triangles[role]));
      }
    }
    expect(split).toBeGreaterThan(0);
  });
});

describe('the caps — #1660', () => {
  it('keeps every split plan within 640 near and 200 far', () => {
    const plans = plansOf(
      (['ell', 'tee', 'you', 'zed', 'notched'] as const).flatMap((name, row) =>
        Array.from(
          { length: 10 },
          (_, index) => [ROOF_SHAPES[name], 200 + 40 * index, 30 + 25 * row, 6] as const,
        ),
      ),
    );
    for (const plan of plans) {
      expect(plan.roof).not.toBe('flat');
      expect(plan.triangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_TRIANGLES);
      expect(plan.farTriangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_FAR_TRIANGLES);
    }
  });

  it('falls back to the flat roof, never a truncated one, for a U whose split roof is past the far cap', () => {
    // Its saw-toothed walls kept, which only a raised vertex cap does.
    const [toothed] = plansOf([[sawToothYou(), 1_000, 40, 4]], true, 400) as [FootprintPlan];
    expect(rectanglesOf(toothed.footprint)).toHaveLength(3);
    expect(toothed.roof).toBe('flat');
    // Not truncated: a wall for every edge of the ring as drawn.
    expect(verticesOf(toothed, 'wall').length / 6).toBe(toothed.footprint.length / 2);
    // Control: the same U at the default vertex cap, its teeth simplified away, is pitched.
    const [straight] = plansOf([[sawToothYou(), 1_000, 40, 4]]) as [FootprintPlan];
    expect(rectanglesOf(straight.footprint)).toHaveLength(3);
    expect(straight.roof).not.toBe('flat');
    expect(straight.farTriangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_FAR_TRIANGLES);
  });
});
