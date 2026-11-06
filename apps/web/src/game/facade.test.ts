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
  glassWeightsAt,
  INTERIOR,
  INTERIOR_PALETTES,
  interiorAt,
  litRoomAt,
  roomPaintOf,
  roomSeedAt,
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
import { unpackInstanceTint } from './instance-tint';
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

/** A plan's seeded tint as the shader decodes it (`vOylTint`): hue in radians, saturation, brightness. */
function tintOf(plan: FootprintPlan): readonly [number, number, number] {
  const tint = unpackInstanceTint(plan.tint);
  return [(tint.hueDegrees * Math.PI) / 180, tint.saturation, tint.brightness];
}

/** Every windowed wall of `of`'s plans: its bays, its whole storeys and its building's tint. */
function windowCells(of: readonly FootprintPlan[]): {
  readonly bays: number;
  readonly storeys: number;
  readonly tint: readonly [number, number, number];
}[] {
  return of.flatMap((plan) =>
    windowedWalls(plan).map((quad) => ({
      bays: Math.round(Math.max(...quad.map((vertex) => vertex.u))),
      storeys: Math.floor((quad[0] as FacadeVertex).top),
      tint: tintOf(plan),
    })),
  );
}

describe('the room behind the glass — #1662', () => {
  const HALF = Math.SQRT1_2;
  /** A sash's glass, metres, and the point at its middle. */
  const size: readonly [number, number] = [0.71, 1.31];
  const middle: readonly [number, number] = [0, 0];
  const seed = 0.42;

  it('meets the back wall 3.5 m behind the glass, head-on through the pane’s middle', () => {
    const hit = interiorAt(middle, size, [0, 0, 1], seed, 'home', false);
    expect(hit.surface).toBe('back');
    expect(hit.deep).toBeCloseTo(INTERIOR.depth, 9);
    expect(INTERIOR.depth).toBe(3.5);
  });

  it('meets the floor on a ray 45° downward, and the ceiling on one 45° upward', () => {
    // The eye above the pane looks down into the room, and below it, up.
    const down = interiorAt(middle, size, [0, HALF, HALF], seed, 'home', false);
    expect(down.surface).toBe('floor');
    // The floor is `below` under the pane's foot: as deep behind the glass as it is under the eye's point.
    expect(down.deep).toBeCloseTo(size[1] / 2 + INTERIOR.below, 9);
    expect(interiorAt(middle, size, [0, -HALF, HALF], seed, 'home', false).surface).toBe('ceiling');
  });

  it('meets the right-hand wall on a ray 45° to the left, and the left-hand wall on one to the right', () => {
    // The eye 45° to the face's left (toward −u) looks in toward +u: the right-hand wall.
    const fromLeft = interiorAt(middle, size, [-HALF, 0, HALF], seed, 'home', false);
    expect(fromLeft.surface).toBe('right');
    expect(fromLeft.deep).toBeCloseTo(size[0] / 2 + INTERIOR.side, 9);
    expect(interiorAt(middle, size, [HALF, 0, HALF], seed, 'home', false).surface).toBe('left');
  });

  it('paints the floor darker than the ceiling, and the deeper a plane the darker', () => {
    const luminance = (rgb: readonly number[]): number =>
      0.2126 * (rgb[0] ?? 0) + 0.7152 * (rgb[1] ?? 0) + 0.0722 * (rgb[2] ?? 0);
    for (let k = 0; k < 40; k += 1) {
      const s = (k + 0.5) / 40;
      const floor = interiorAt([0, -0.6], size, [0, HALF, HALF], s, 'home', false);
      const ceiling = interiorAt([0, -0.6], size, [0, -HALF, HALF], s, 'home', false);
      if (floor.surface === 'floor' && ceiling.surface === 'ceiling') {
        expect(luminance(floor.colour), String(s)).toBeLessThan(luminance(ceiling.colour));
      }
    }
    // One side wall, met near the glass and deep in: the same paint, fainter deeper.
    const near = interiorAt([0.3, 0], size, [-0.9, 0, Math.sqrt(1 - 0.81)], seed, 'home', false);
    const deep = interiorAt([-0.3, 0], size, [-0.5, 0, Math.sqrt(1 - 0.25)], seed, 'home', false);
    expect(near.surface).toBe('right');
    expect(deep.surface).toBe('right');
    expect(deep.deep).toBeGreaterThan(near.deep + 1);
    expect(luminance(deep.colour)).toBeLessThan(luminance(near.colour));
  });

  it('lights a lit room warm, brighter than an unlit one, and below every paint it is painted with', () => {
    const unlit = interiorAt(middle, size, [0, 0, 1], seed, 'home', false).colour;
    const lit = interiorAt(middle, size, [0, 0, 1], seed, 'home', true).colour;
    expect(lit[0]).toBeGreaterThan(unlit[0]);
    // Warm: more red than blue.
    expect(lit[0] / lit[2]).toBeGreaterThan(1.5);
    for (const channel of [...INTERIOR.lit, ...INTERIOR.unlit]) expect(channel).toBeLessThan(1);
  });

  it('draws a blind across the top of the glass of a seeded share of rooms, and never across its middle', () => {
    let blinds = 0;
    const rooms = 1000;
    for (let k = 0; k < rooms; k += 1) {
      const s = (k + 0.5) / rooms;
      const top = interiorAt([0, size[1] / 2 - 0.01], size, [0, 0, 1], s, 'home', false);
      if (top.surface === 'blind') blinds += 1;
      expect(interiorAt(middle, size, [0, 0, 1], s, 'home', false).surface).not.toBe('blind');
    }
    expect(blinds / rooms).toBeGreaterThan(INTERIOR.blind.share - 0.06);
    expect(blinds / rooms).toBeLessThan(INTERIOR.blind.share + 0.06);
  });

  it('gives two cells on one wall different room paints in at least 3 of 4 neighbouring pairs', () => {
    const walls = windowCells(plans);
    let pairs = 0;
    let differ = 0;
    for (const wall of walls) {
      for (let storey = 0; storey < wall.storeys; storey += 1) {
        for (let k = 0; k + 1 < wall.bays; k += 1) {
          const a = roomPaintOf(roomSeedAt([k, storey], wall.tint));
          const b = roomPaintOf(roomSeedAt([k + 1, storey], wall.tint));
          pairs += 1;
          if (a !== b) differ += 1;
        }
      }
    }
    expect(pairs).toBeGreaterThan(500);
    // The issue asks 3 in 4; the seed's parity makes it every pair.
    expect(differ / pairs).toBeGreaterThanOrEqual(0.75);
    expect(differ).toBe(pairs);
    // And the paints still vary from wall to wall: every one of the palette's six is used.
    const used = new Set(
      walls.flatMap((wall) =>
        Array.from({ length: wall.bays }, (_, k) => roomPaintOf(roomSeedAt([k, 1], wall.tint))),
      ),
    );
    expect(used.size).toBe(INTERIOR_PALETTES.home.walls.length);
  });

  it('gives the same cell the same paint across two builds of the plans', () => {
    const again = footprintPlans(
      town.corridor,
      landClassMask(town.corridor),
      town.profile,
      town.origin,
    ).plans;
    const first = windowCells(plans);
    const second = windowCells(again);
    expect(second.length).toBe(first.length);
    first.forEach((wall, at) => {
      const other = second[at];
      expect(other?.tint).toEqual(wall.tint);
      for (let k = 0; k < wall.bays; k += 1) {
        expect(roomPaintOf(roomSeedAt([k, 1], other?.tint ?? [0, 0, 0]))).toBe(
          roomPaintOf(roomSeedAt([k, 1], wall.tint)),
        );
      }
    });
  });

  it('keeps #1581’s one lit room in five over 2 000 window cells, and seeds the room apart from it', () => {
    let cells = 0;
    let lit = 0;
    let litAndPale = 0;
    for (const wall of windowCells(plans)) {
      for (let storey = 0; storey < wall.storeys; storey += 1) {
        for (let k = 0; k < wall.bays; k += 1) {
          cells += 1;
          if (litRoomAt([k, storey], wall.tint)) {
            lit += 1;
            if (roomSeedAt([k, storey], wall.tint) < 0.5) litAndPale += 1;
          }
        }
      }
    }
    expect(cells).toBeGreaterThanOrEqual(2000);
    expect(Math.abs(lit / cells - 0.2)).toBeLessThanOrEqual(0.03);
    // The room's seed is not the lit hash: a lit room is any paint.
    expect(litAndPale / lit).toBeGreaterThan(0.35);
    expect(litAndPale / lit).toBeLessThan(0.65);
  });

  it('weights the environment by Schlick’s Fresnel with F0 0.04: a pane is its room head-on and the sky at a graze', () => {
    const radians = (degrees: number): number => (degrees * Math.PI) / 180;
    expect(INTERIOR.fresnel).toBe(0.04);
    const headOn = glassWeightsAt(1);
    expect(headOn.environment).toBeCloseTo(0.04, 9);
    expect(headOn.environment).toBeLessThanOrEqual(0.1);
    expect(headOn.room).toBeCloseTo(0.96, 9);
    // 80° off the normal: 0.04 + 0.96 (1 − cos 80°)⁵ = 0.41. The issue's
    // "at least 0.6" is Schlick's at 85°, not at 80°; both are held.
    const eighty = glassWeightsAt(Math.cos(radians(80)));
    expect(eighty.environment).toBeCloseTo(0.04 + 0.96 * (1 - Math.cos(radians(80))) ** 5, 9);
    expect(eighty.environment).toBeGreaterThan(0.4);
    expect(glassWeightsAt(Math.cos(radians(85))).environment).toBeGreaterThanOrEqual(0.6);
    expect(glassWeightsAt(0).environment).toBe(1);
    for (let degrees = 0; degrees < 90; degrees += 5) {
      const { environment, room } = glassWeightsAt(Math.cos(radians(degrees)));
      expect(environment + room).toBeCloseTo(1, 12);
      expect(environment).toBeLessThan(glassWeightsAt(Math.cos(radians(degrees + 5))).environment);
    }
  });
});
