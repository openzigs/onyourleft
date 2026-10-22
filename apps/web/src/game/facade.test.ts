// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1581: the windows and the front door of a mapped building — the layout
 * (`facade.ts` §`facadePartAt`, the shader's numbers) held to its rules, and
 * the plans' facade floats (`footprint-buildings.ts` §`FACADE_FLOATS`) held
 * to what the layout needs of them: whole bays, the eaves as the top, and no
 * window behind the door. Over #1581's mixed town, whose walls have odd and
 * even counts of bays.
 */

import { describe, expect, it } from 'vitest';

import {
  DOOR_IN_FACE,
  facadePartAt,
  WINDOW_IN_BAY,
  WINDOW_SILL_METRES,
  type FacadePart,
} from './facade';
import {
  BAY_METRES,
  baysOf,
  DOOR_FACE,
  FACADE_DOOR,
  FACADE_PAINT,
  FACADE_PLAIN,
  FOOTPRINT_VERTEX_FLOATS,
  footprintPlans,
  STOREY_METRES,
  type FootprintPlan,
} from './footprint-buildings';
import { mixedTownFixture } from './footprint-fixtures-testing';
import { landClassMask } from './land-class';

const town = mixedTownFixture();
const { plans } = footprintPlans(
  town.corridor,
  landClassMask(town.corridor),
  town.profile,
  town.origin,
);

/** One vertex of a role: its position and its four facade floats. */
interface FacadeVertex {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly u: number;
  readonly v: number;
  readonly top: number;
  readonly skip: number;
}

function verticesOf(plan: FootprintPlan, role: keyof FootprintPlan['triangles']): FacadeVertex[] {
  const floats = plan.triangles[role];
  const out: FacadeVertex[] = [];
  for (let at = 0; at < floats.length; at += FOOTPRINT_VERTEX_FLOATS) {
    const f = (k: number): number => floats[at + k] as number;
    out.push({ x: f(0), y: f(1), z: f(2), u: f(8), v: f(9), top: f(10), skip: f(11) });
  }
  return out;
}

/** The windowed quads of a plan's walls: two triangles each, consecutive. */
function windowedWalls(plan: FootprintPlan): FacadeVertex[][] {
  const vertices = verticesOf(plan, 'wall');
  const walls: FacadeVertex[][] = [];
  for (let at = 0; at + 6 <= vertices.length; at += 6) {
    const quad = vertices.slice(at, at + 6);
    if ((quad[0] as FacadeVertex).top > 0) walls.push(quad);
  }
  return walls;
}

describe('the layout in a bay — #1581', () => {
  it('puts one window in each bay of a storey, framed, barred and on a sill, and nothing else in the bay', () => {
    const at = (x: number, y: number): FacadePart => facadePartAt(3 + x, 1 + y, 3, -1);
    const w = WINDOW_IN_BAY;
    expect(at(0.42, 0.5)).toBe('glass');
    expect(at(0.58, 0.45)).toBe('glass');
    // The mullion, the transom and the frame.
    expect(at(0.5, 0.45)).toBe('frame');
    expect(at(0.42, w.transom)).toBe('frame');
    expect(at(w.left + w.frameAcross / 2, 0.5)).toBe('frame');
    // The sill, under it and a little wider.
    expect(at(w.left - w.sillAcross / 2, w.bottom - w.sillUp / 2)).toBe('sill');
    // The wall round it.
    expect(at(0.1, 0.5)).toBe('wall');
    expect(at(0.42, 0.9)).toBe('wall');
    expect(at(0.42, 0.1)).toBe('wall');
    // The window is buildings.ts' size at a 3.6 m bay, its sill 0.9 m up.
    expect((w.right - w.left) * BAY_METRES).toBeCloseTo(1, 9);
    expect(w.bottom * STOREY_METRES).toBeCloseTo(WINDOW_SILL_METRES, 9);
    expect((w.top - w.bottom) * STOREY_METRES).toBeCloseTo(1.3, 9);
  });

  it('cuts no window the eaves would cut: a storey whose window top passes `top` has none', () => {
    // Eaves at 2.5 storeys: the third storey's window would reach 2.77.
    expect(facadePartAt(0.42, 1.5, 2.5, -1)).toBe('glass');
    expect(facadePartAt(0.42, 2.5, 2.5, -1)).toBe('wall');
    // Eaves at 2.8 storeys: it fits.
    expect(facadePartAt(0.42, 2.5, 2.8, -1)).toBe('glass');
    // Below the floor — a plinth's course — none.
    expect(facadePartAt(0.42, -0.5, 2.8, -1)).toBe('wall');
  });

  it('leaves the skipped bay blank on the ground storey only', () => {
    expect(facadePartAt(1.42, 0.5, 2, 1)).toBe('wall');
    expect(facadePartAt(1.42, 1.5, 2, 1)).toBe('glass');
    expect(facadePartAt(0.42, 0.5, 2, 1)).toBe('glass');
    // Control: with no bay skipped, the ground storey's has its window.
    expect(facadePartAt(1.42, 0.5, 2, -1)).toBe('glass');
  });

  it('draws a door in its surround with a fanlight, paint as paint, and a plain face plain', () => {
    expect(facadePartAt(0.5, 0.3, FACADE_DOOR, -1)).toBe('leaf');
    expect(facadePartAt(DOOR_IN_FACE.surroundAcross / 2, 0.3, FACADE_DOOR, -1)).toBe('surround');
    expect(facadePartAt(0.5, 1 - DOOR_IN_FACE.surroundUp / 2, FACADE_DOOR, -1)).toBe('surround');
    expect(
      facadePartAt(0.5, (DOOR_IN_FACE.fanlight + 1 - DOOR_IN_FACE.surroundUp) / 2, FACADE_DOOR, -1),
    ).toBe('fanlight');
    expect(facadePartAt(0.3, 0.3, FACADE_PAINT, -1)).toBe('paint');
    expect(facadePartAt(0.42, 0.5, FACADE_PLAIN, -1)).toBe('wall');
  });
});

describe('the plans’ facades — #1581, over the mixed town', () => {
  it('plans the mixed town, near its whole', () => {
    expect(plans.length).toBeGreaterThan(150);
  });

  it('lays every windowed wall in its own whole bays, from the floor to the eaves', () => {
    let walls = 0;
    const counts = new Set<number>();
    for (const plan of plans) {
      for (const quad of windowedWalls(plan)) {
        const us = quad.map((vertex) => vertex.u);
        const bays = Math.max(...us);
        expect(Math.min(...us)).toBe(0);
        expect(Number.isInteger(bays)).toBe(true);
        // The bays are the wall's length's: its bottom corners are its two ends.
        const bottom = quad.filter(
          (vertex) => vertex.v === Math.min(...quad.map((each) => each.v)),
        );
        const ends = bottom.filter((vertex) => vertex.u === 0 || vertex.u === bays);
        const [a, b] = [
          ends.find((vertex) => vertex.u === 0),
          ends.find((vertex) => vertex.u === bays),
        ];
        if (a === undefined || b === undefined) throw new Error('a wall lacks an end');
        expect(bays).toBe(baysOf(Math.hypot(b.x - a.x, b.z - a.z)));
        // From the floor to the eaves: the top is the eaves, in storeys.
        expect(Math.min(...quad.map((vertex) => vertex.v))).toBeCloseTo(0, 5);
        expect(Math.max(...quad.map((vertex) => vertex.v))).toBeCloseTo(
          (quad[0] as FacadeVertex).top,
          5,
        );
        counts.add(bays % 2);
        walls += 1;
      }
    }
    expect(walls).toBeGreaterThan(500);
    // Both an odd and an even count, so both of the door's cases are below.
    expect(counts).toStrictEqual(new Set([0, 1]));
  });

  it('puts no window behind the front door, on an odd wall and on an even one', () => {
    const seen = new Set<number>();
    let doors = 0;
    for (const plan of plans) {
      // Since #1588 a garage's door is a `door` too: the front door is the one in its surround.
      const door = verticesOf(plan, 'door').filter((vertex) => vertex.top === FACADE_DOOR);
      if (door.length === 0) continue;
      expect(door).toHaveLength(6);
      const cx = door.reduce((sum, vertex) => sum + vertex.x, 0) / door.length;
      const cz = door.reduce((sum, vertex) => sum + vertex.z, 0) / door.length;
      // The wall the door stands on: its bottom edge passes under the door's middle.
      const wall = windowedWalls(plan).find((quad) => {
        const low = Math.min(...quad.map((vertex) => vertex.v));
        const ends = quad.filter((vertex) => vertex.v === low);
        const a = ends[0] as FacadeVertex;
        const b = ends.find((vertex) => Math.hypot(vertex.x - a.x, vertex.z - a.z) > 0.1);
        if (b === undefined) return false;
        const lx = b.x - a.x;
        const lz = b.z - a.z;
        const length = Math.hypot(lx, lz);
        const t = ((cx - a.x) * lx + (cz - a.z) * lz) / (length * length);
        const off = Math.abs(((cx - a.x) * lz - (cz - a.z) * lx) / length);
        return t > 0 && t < 1 && off < 0.1;
      });
      if (wall === undefined) continue;
      const bays = Math.max(...wall.map((vertex) => vertex.u));
      const top = (wall[0] as FacadeVertex).top;
      const skip = (wall[0] as FacadeVertex).skip;
      const low = Math.min(...wall.map((vertex) => vertex.v));
      const ends = wall.filter((vertex) => vertex.v === low);
      const a = ends.find((vertex) => vertex.u === 0) as FacadeVertex;
      const b = ends.find((vertex) => vertex.u === bays) as FacadeVertex;
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      const middle = (Math.hypot(cx - a.x, cz - a.z) / length) * bays;
      const half = (DOOR_FACE.width / 2 / length) * bays;
      for (let step = 0; step <= 20; step += 1) {
        const u = middle - half + (2 * half * step) / 20;
        for (let up = 0; up <= 10; up += 1) {
          const v = (DOOR_FACE.height / STOREY_METRES) * (up / 10);
          expect(facadePartAt(u, v, top, skip), `${String(bays)} bays`).toBe('wall');
        }
      }
      seen.add(bays % 2);
      doors += 1;
    }
    expect(doors).toBeGreaterThan(100);
    expect(seen).toStrictEqual(new Set([0, 1]));
  });

  it('control: with the door’s bay not skipped, an odd wall has a window behind its door', () => {
    // The middle bay of three, its ground storey, where the door stands.
    expect(facadePartAt(1.42, 0.5, 2, -1)).toBe('glass');
    expect(facadePartAt(1.42, 0.5, 2, 1)).toBe('wall');
  });

  it('marks every other role plain or painted, never windowed', () => {
    for (const plan of plans) {
      for (const role of ['plinth', 'roof', 'parapet', 'chimney'] as const) {
        for (const vertex of verticesOf(plan, role)) expect(vertex.top, role).toBe(FACADE_PLAIN);
      }
      for (const vertex of verticesOf(plan, 'trim')) expect(vertex.top).toBe(FACADE_PAINT);
    }
  });
});
