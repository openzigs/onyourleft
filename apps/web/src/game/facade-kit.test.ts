// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The downtown kit's pieces, and a footprint wrapped in them — #3334.
 *
 * The committed GLB and atlas are read off disk (`facade-kit-testing.ts`), so
 * `facade-kit.ts`' table is held to the bytes the product draws. The plans a
 * ride makes are `facade-kit-plans.test.ts`; the belt is
 * `mapped-building-belt.test.ts`.
 */

import { statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  bayCount,
  KIT_ATLAS_PIXELS,
  KIT_BAY_METRES,
  KIT_CARD_TRIANGLES,
  KIT_CELLS,
  KIT_GUTTER_PIXELS,
  KIT_PIECES,
  KIT_PIXELS_PER_METRE,
  KIT_RUN_FLOATS,
  KIT_STOREY_METRES,
  KIT_STYLES,
  KIT_URBAN_CLASSES,
  kitCardOf,
  kitCells,
  kitCellUv,
  kitKindOf,
  kitPieceIndex,
  kitPlacedPoint,
  kitProjectedUv,
  wrapFootprint,
  type KitKind,
  type KitPieceId,
  type KitWrap,
  type KitWrapInput,
} from './facade-kit';
import { committedKitPieces, SHIPPED_REALISTIC } from './facade-kit-testing';
import { REALISTIC_DOWNTOWN_KIT } from './realistic-assets';
import {
  DEVICE_BYTES_PER_TEXEL,
  estimatedTextureBytes,
  REALISTIC_DOWNTOWN_KIT_SURFACES,
  REALISTIC_TRIANGLES,
} from './realistic-budget';
import { fileKtx2Facts } from './realistic-bytes-testing';
import type { UrbanClass } from './urban-class';

/** Every urban class a stretch of route may have (`urban-class.ts`). */
const URBAN_CLASSES: readonly UrbanClass[] = ['unknown', 'rural', 'village', 'town', 'city-centre'];

/** Every kind a footprint is wrapped as: the styles' own keys. */
const KIT_KINDS = Object.keys(KIT_STYLES) as readonly KitKind[];

/** A 20 m by 12 m footprint, counter-clockwise in `x, z`, its `z = 0` edge (edge 0) the front. */
const BLOCK = [0, 0, 20, 0, 20, 12, 0, 12];

/** A wrap's input over {@link BLOCK}: three 3 m storeys on a floor 0.4 m above its foot. */
function input(over: Partial<KitWrapInput> = {}): KitWrapInput {
  return {
    kind: 'shop',
    ring: BLOCK,
    base: 10,
    floor: 10.4,
    eaves: 19.4,
    storeys: 3,
    parapet: 0.5,
    frontEdge: 0,
    shared: new Map(),
    budget: REALISTIC_TRIANGLES.structure,
    ...over,
  };
}

/** One run of a wrap, read out of its floats. */
interface Run {
  readonly at: number;
  readonly piece: KitPieceId;
  readonly relief: boolean;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly ax: number;
  readonly az: number;
  readonly stretchX: number;
  readonly stretchY: number;
  readonly bays: number;
}

const millimetres = (metres: number): number => Math.round(metres * 1_000) / 1_000;

function runsOf(wrap: KitWrap): readonly Run[] {
  const runs: Run[] = [];
  for (let at = 0; at < wrap.runs.length; at += KIT_RUN_FLOATS) {
    const piece = KIT_PIECES[wrap.runs[at] as number];
    if (piece === undefined) throw new Error('a run names no piece');
    runs.push({
      at,
      piece: piece.id,
      relief: wrap.runs[at + 1] === 1,
      // The runs are single-precision: read to the millimetre, as the test states them.
      x: millimetres(wrap.runs[at + 2] as number),
      y: millimetres(wrap.runs[at + 3] as number),
      z: millimetres(wrap.runs[at + 4] as number),
      ax: wrap.runs[at + 5] as number,
      az: wrap.runs[at + 6] as number,
      stretchX: wrap.runs[at + 7] as number,
      stretchY: wrap.runs[at + 8] as number,
      bays: wrap.runs[at + 9] as number,
    });
  }
  return runs;
}

/** Whether `(x, z)` is inside `ring`, by the even-odd rule. */
function inside(ring: readonly number[], x: number, z: number): boolean {
  let within = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const xi = ring[i * 2] as number;
    const zi = ring[i * 2 + 1] as number;
    const xj = ring[j * 2] as number;
    const zj = ring[j * 2 + 1] as number;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) within = !within;
  }
  return within;
}

/** What a wrap's runs and roof add up to, by `facade-kit.ts`' own table. */
function trianglesOf(wrap: KitWrap): number {
  return (
    runsOf(wrap).reduce(
      (sum, run) =>
        sum +
        run.bays *
          (run.relief
            ? (KIT_PIECES[kitPieceIndex(run.piece)]?.triangles ?? NaN)
            : KIT_CARD_TRIANGLES),
      0,
    ) +
    wrap.roof.length / 9
  );
}

function wrapped(over: Partial<KitWrapInput> = {}): KitWrap {
  const wrap = wrapFootprint(input(over));
  if (wrap === undefined) throw new Error('the footprint was not wrapped');
  return wrap;
}

describe('the committed downtown kit — #3334', () => {
  const pieces = committedKitPieces();

  it('holds every piece of the table to the committed GLB: its triangles, and geometry and texture coordinates alone', () => {
    expect(pieces.length).toBe(KIT_PIECES.length);
    KIT_PIECES.forEach((piece, index) => {
      const committed = pieces[index];
      expect(committed?.triangles, piece.id).toBe(piece.triangles);
      expect(committed?.attributes, piece.id).toEqual(['NORMAL', 'POSITION', 'TEXCOORD_0']);
    });
    // No piece in relief costs more than the whole of one wrapped building.
    for (const piece of KIT_PIECES) {
      expect(piece.triangles, piece.id).toBeLessThan(REALISTIC_TRIANGLES.structure);
    }
  });

  it('stands every piece on its bay: its foot on the ground, its face on the wall’s plane, its relief within 40 cm of it', () => {
    KIT_PIECES.forEach((piece, index) => {
      const { position } = pieces[index] as (typeof pieces)[number];
      let lowest = Infinity;
      let highest = -Infinity;
      let widest = 0;
      let before = -Infinity;
      let behind = Infinity;
      for (let at = 0; at < position.length; at += 3) {
        widest = Math.max(widest, Math.abs(position[at] as number));
        lowest = Math.min(lowest, position[at + 1] as number);
        highest = Math.max(highest, position[at + 1] as number);
        before = Math.max(before, position[at + 2] as number);
        behind = Math.min(behind, position[at + 2] as number);
      }
      expect(lowest, piece.id).toBeCloseTo(0, 1);
      expect(highest, piece.id).toBeCloseTo(piece.height, 1);
      expect(widest, piece.id).toBeCloseTo(piece.width / 2, 1);
      // +Z is out of the building: nothing stands far before the wall, or deep behind it.
      expect(before, piece.id).toBeLessThanOrEqual(0.11);
      expect(behind, piece.id).toBeGreaterThanOrEqual(-0.41);
    });
  });

  it('maps every vertex of every piece into its own cell by the projection its card wears', () => {
    let checked = 0;
    KIT_PIECES.forEach((piece, index) => {
      const { position, uv } = pieces[index] as (typeof pieces)[number];
      const cell = kitCellUv(index);
      for (let vertex = 0; vertex * 3 < position.length; vertex += 1) {
        const [u, v] = kitProjectedUv(
          index,
          position[vertex * 3] as number,
          position[vertex * 3 + 1] as number,
        );
        expect(uv[vertex * 2], `${piece.id} ${String(vertex)}`).toBeCloseTo(u, 4);
        expect(uv[vertex * 2 + 1], `${piece.id} ${String(vertex)}`).toBeCloseTo(v, 4);
        expect(u).toBeGreaterThanOrEqual(cell.u0);
        expect(u).toBeLessThanOrEqual(cell.u1);
        expect(v).toBeGreaterThanOrEqual(cell.v0);
        expect(v).toBeLessThanOrEqual(cell.v1);
        checked += 1;
      }
    });
    expect(checked).toBe(KIT_PIECES.reduce((sum, piece) => sum + piece.triangles * 3, 0));
  });

  it('ships the atlas as one 1024 px KTX2 colour picture with its mipmaps', () => {
    const facts = fileKtx2Facts(join(SHIPPED_REALISTIC, REALISTIC_DOWNTOWN_KIT.atlas));
    expect(facts.width).toBe(KIT_ATLAS_PIXELS);
    expect(facts.height).toBe(KIT_ATLAS_PIXELS);
    expect(facts.levels).toBe(Math.log2(KIT_ATLAS_PIXELS) + 1);
    expect(REALISTIC_DOWNTOWN_KIT.atlas).toContain(String(KIT_ATLAS_PIXELS));
    expect(facts.scheme).toBe('etc1s');
    expect(facts.alpha).toBe(false);
    expect(facts.transfer).toBe('srgb');
  });

  it('stays inside its own byte ceilings, on the tablet and in the build', () => {
    const atlas = fileKtx2Facts(join(SHIPPED_REALISTIC, REALISTIC_DOWNTOWN_KIT.atlas));
    const memory = estimatedTextureBytes({
      ...atlas,
      bytesPerTexel: DEVICE_BYTES_PER_TEXEL.etc1s,
      mipmapped: true,
    });
    const sizes = [REALISTIC_DOWNTOWN_KIT.model, REALISTIC_DOWNTOWN_KIT.atlas].map(
      (file) => statSync(join(SHIPPED_REALISTIC, file)).size,
    );
    const build = sizes.reduce((sum, size) => sum + size, 0);
    console.log(
      `#3334: the downtown kit is ${(memory / 2 ** 20).toFixed(2)} MiB estimated on the tablet and ${String(build)} bytes in the build (${sizes.join(' and ')})`,
    );
    expect(memory).toBeLessThanOrEqual(REALISTIC_DOWNTOWN_KIT_SURFACES.textureBytes);
    expect(build).toBeLessThanOrEqual(REALISTIC_DOWNTOWN_KIT_SURFACES.buildBytes);
    // The figures `realistic-budget.ts` states of the committed files.
    expect(sizes).toEqual([73_900, 80_052]);
    // No side over 2048 px, whatever the source publishes (ADR 0026 D-6); its own 1024.
    expect(atlas.width).toBeLessThanOrEqual(2_048);
    // The pieces' triangles, in relief, as that file states them: 1 133 between the twelve.
    expect(KIT_PIECES.reduce((sum, piece) => sum + piece.triangles, 0)).toBe(1_133);
  });
});

describe('the atlas’s cells — #3334', () => {
  it('gives every piece a cell of its own size, inside the atlas, a gutter from every other', () => {
    expect(KIT_CELLS.length).toBe(KIT_PIECES.length);
    KIT_CELLS.forEach((cell, index) => {
      const piece = KIT_PIECES[index] as (typeof KIT_PIECES)[number];
      expect(cell.width).toBe(piece.width * KIT_PIXELS_PER_METRE);
      expect(cell.height).toBe(piece.height * KIT_PIXELS_PER_METRE);
      expect(cell.x).toBeGreaterThanOrEqual(KIT_GUTTER_PIXELS);
      expect(cell.y).toBeGreaterThanOrEqual(KIT_GUTTER_PIXELS);
      expect(cell.x + cell.width + KIT_GUTTER_PIXELS).toBeLessThanOrEqual(KIT_ATLAS_PIXELS);
      expect(cell.y + cell.height + KIT_GUTTER_PIXELS).toBeLessThanOrEqual(KIT_ATLAS_PIXELS);
      KIT_CELLS.forEach((other, otherIndex) => {
        if (otherIndex <= index) return;
        const apartX =
          other.x >= cell.x + cell.width + 2 * KIT_GUTTER_PIXELS ||
          cell.x >= other.x + other.width + 2 * KIT_GUTTER_PIXELS;
        const apartY =
          other.y >= cell.y + cell.height + 2 * KIT_GUTTER_PIXELS ||
          cell.y >= other.y + other.height + 2 * KIT_GUTTER_PIXELS;
        expect(apartX || apartY, `${piece.id} and ${String(otherIndex)}`).toBe(true);
      });
    });
  });

  it('refuses a set that does not fit the atlas', () => {
    const tall = { id: 'tall', source: 'Tall', width: 2, height: 3, triangles: 2 };
    expect(() => kitCells(Array.from({ length: 21 }, () => tall))).toThrow(RangeError);
    expect(() => kitCells(Array.from({ length: 15 }, () => tall))).not.toThrow();
  });

  it('makes a card of two triangles facing out, wearing the whole cell the right way up', () => {
    KIT_PIECES.forEach((piece, index) => {
      const card = kitCardOf(index);
      const cell = kitCellUv(index);
      expect(card.triangles).toBe(KIT_CARD_TRIANGLES);
      expect(card.position.length).toBe(KIT_CARD_TRIANGLES * 9);
      for (let vertex = 0; vertex < 6; vertex += 1) {
        const x = card.position[vertex * 3] as number;
        const y = card.position[vertex * 3 + 1] as number;
        expect(card.position[vertex * 3 + 2]).toBe(0);
        expect([...card.normal.subarray(vertex * 3, vertex * 3 + 3)]).toEqual([0, 0, 1]);
        // The piece's left edge is the cell's left, and its top the cell's top.
        expect(card.uv[vertex * 2], piece.id).toBeCloseTo(x < 0 ? cell.u0 : cell.u1, 6);
        expect(card.uv[vertex * 2 + 1], piece.id).toBeCloseTo(y > 0 ? cell.v0 : cell.v1, 6);
      }
      // Wound counter-clockwise seen from outside (+Z): each triangle's z-normal is positive.
      for (let triangle = 0; triangle < 2; triangle += 1) {
        const p = (corner: number, axis: number): number =>
          card.position[(triangle * 3 + corner) * 3 + axis] as number;
        const cross =
          (p(1, 0) - p(0, 0)) * (p(2, 1) - p(0, 1)) - (p(1, 1) - p(0, 1)) * (p(2, 0) - p(0, 0));
        expect(cross, piece.id).toBeGreaterThan(0);
      }
    });
    expect(() => kitCardOf(KIT_PIECES.length)).toThrow(RangeError);
    expect(() => kitCellUv(-1)).toThrow(RangeError);
    expect(() => kitProjectedUv(KIT_PIECES.length, 0, 0)).toThrow(RangeError);
  });
});

describe('which footprints are wrapped, by setting — #3334', () => {
  const setting = (
    urban: UrbanClass,
    use: string,
    storeys: number,
    terraced = false,
    farmland = false,
  ): KitKind | undefined => kitKindOf({ urban, farmland, use, storeys, terraced });

  it('wraps a footprint beside a town’s or a city centre’s stretch, and beside no other', () => {
    expect([...KIT_URBAN_CLASSES].sort()).toEqual(['city-centre', 'town']);
    for (const urban of URBAN_CLASSES) {
      const modern = urban === 'town' || urban === 'city-centre';
      expect(setting(urban, 'commercial', 1), urban).toBe(modern ? 'retail' : undefined);
      expect(setting(urban, 'commercial', 2), urban).toBe(modern ? 'shop' : undefined);
      expect(setting(urban, 'commercial', 3), urban).toBe(modern ? 'shop' : undefined);
      expect(setting(urban, 'commercial', 4), urban).toBe(modern ? 'office' : undefined);
      expect(setting(urban, 'commercial', 9), urban).toBe(modern ? 'office' : undefined);
      expect(setting(urban, 'residential', 3, true), urban).toBe(modern ? 'townhouse' : undefined);
    }
  });

  it('never wraps a footprint on farmland, whatever its street', () => {
    for (const urban of URBAN_CLASSES) {
      expect(setting(urban, 'commercial', 2, false, true), urban).toBeUndefined();
      expect(setting(urban, 'residential', 3, true, true), urban).toBeUndefined();
    }
  });

  it('keeps a detached house, a block of flats and every other use as they are drawn today', () => {
    // A house that shares no wall.
    expect(setting('town', 'residential', 2, false)).toBeUndefined();
    // A terrace's house of one storey, or of five: a bungalow row and a block.
    expect(setting('town', 'residential', 1, true)).toBeUndefined();
    expect(setting('town', 'residential', 2, true)).toBe('townhouse');
    expect(setting('town', 'residential', 4, true)).toBe('townhouse');
    expect(setting('town', 'residential', 5, true)).toBeUndefined();
    for (const use of ['industrial', 'civic', 'farmland']) {
      expect(setting('city-centre', use, 3, true), use).toBeUndefined();
    }
  });

  it('names a piece of the kit for every part of every kind', () => {
    expect([...KIT_KINDS].sort()).toEqual(['office', 'retail', 'shop', 'townhouse']);
    for (const kind of KIT_KINDS) {
      const style = KIT_STYLES[kind];
      for (const id of [
        style.front,
        style.door,
        style.ground,
        style.upper,
        style.plain,
        style.cornice,
      ]) {
        expect(kitPieceIndex(id), `${kind} ${id}`).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('a footprint wrapped — #3334', () => {
  it('cuts an edge into bays of about two metres, and never none', () => {
    expect(bayCount(20)).toBe(10);
    expect(bayCount(12.9)).toBe(6);
    expect(bayCount(13.1)).toBe(7);
    expect(bayCount(0.4)).toBe(1);
    expect(KIT_BAY_METRES).toBe(2);
  });

  it('covers every edge exactly, storey by storey, from the plan’s foot to its parapet’s top', () => {
    const wrap = wrapped();
    const runs = runsOf(wrap);
    // Each level of each edge: the plinth, three storeys and the cornice.
    const levels = new Map<string, number>();
    for (const run of runs) {
      const edge = `${run.ax.toFixed(3)},${run.az.toFixed(3)}`;
      const key = `${edge}@${run.y.toFixed(3)}`;
      const piece = KIT_PIECES[kitPieceIndex(run.piece)] as (typeof KIT_PIECES)[number];
      levels.set(key, (levels.get(key) ?? 0) + run.bays * piece.width * run.stretchX);
    }
    // Four edges, five levels each.
    expect(levels.size).toBe(20);
    for (const [key, covered] of levels) {
      const along = key.startsWith('1.000,0.000') || key.startsWith('-1.000,0.000') ? 20 : 12;
      expect(covered, key).toBeCloseTo(along, 4);
    }
    const feet = [...new Set(runs.map((run) => Number(run.y.toFixed(3))))].sort((a, b) => a - b);
    expect(feet).toEqual([10, 10.4, 13.4, 16.4, 19.4]);
    // The plinth reaches the floor, a storey the next, and the cornice the parapet's top.
    for (const run of runs) {
      const piece = KIT_PIECES[kitPieceIndex(run.piece)] as (typeof KIT_PIECES)[number];
      const top = run.y + piece.height * run.stretchY;
      const expected = run.y === 10 ? 10.4 : run.y > 19 ? 19.9 : run.y + KIT_STOREY_METRES;
      expect(top, `${run.piece} at ${String(run.y)}`).toBeCloseTo(expected, 4);
    }
  });

  it('stretches each storey to the plan’s own, so the storeys reach the eaves whatever a storey’s height', () => {
    // Three storeys of 3.6 m, as a mapped height of 10.8 m over three levels gives.
    const wrap = wrapped({ eaves: 10.4 + 3 * 3.6 });
    const runs = runsOf(wrap);
    const feet = [...new Set(runs.map((run) => run.y))].sort((a, b) => a - b);
    expect(feet).toEqual([10, 10.4, 14, 17.6, 21.2]);
    for (const run of runs.filter((each) => each.y >= 10.4 && each.y < 21)) {
      expect(run.stretchY).toBeCloseTo(1.2, 6);
      expect(run.y + KIT_STOREY_METRES * run.stretchY).toBeCloseTo(run.y + 3.6, 5);
    }
    // The cornice stands on the eaves, as tall as the parapet whatever the storeys are.
    for (const run of runs.filter((each) => each.y > 21)) expect(run.stretchY).toBeCloseTo(0.5, 6);
  });

  it('stands every bay on the footprint’s own outline, facing out of it, whichever way the ring runs', () => {
    const clockwise = [0, 0, 0, 12, 20, 12, 20, 0];
    for (const [ring, frontEdge] of [
      [BLOCK, 0],
      [clockwise, 3],
    ] as const) {
      const wrap = wrapped({ ring, frontEdge });
      let bays = 0;
      for (const run of runsOf(wrap)) {
        for (let bay = 0; bay < run.bays; bay += 1) {
          // The bay's middle is on the outline: a step in is inside, a step out is not.
          const [inX, , inZ] = kitPlacedPoint(wrap.runs, run.at, bay, 0, 0, -0.05);
          const [outX, , outZ] = kitPlacedPoint(wrap.runs, run.at, bay, 0, 0, 0.05);
          expect(inside(BLOCK, inX, inZ), `${run.piece} ${String(bay)}`).toBe(true);
          expect(inside(BLOCK, outX, outZ), `${run.piece} ${String(bay)}`).toBe(false);
          // And its two ends are on the outline too: inside by a hair's step in.
          for (const end of [-0.999, 0.999]) {
            const [x, , z] = kitPlacedPoint(wrap.runs, run.at, bay, end, 0, -0.01);
            expect(inside(BLOCK, x, z)).toBe(true);
          }
          bays += 1;
        }
      }
      // (10 + 6 + 10 + 6) bays, five levels each.
      expect(bays).toBe(32 * 5);
    }
  });

  it('puts the shop front and the door on the edge that faces the street, and solid ground floors elsewhere', () => {
    const wrap = wrapped();
    const ground = runsOf(wrap).filter((run) => run.y === 10.4);
    // Edge 0 runs along z = 0, facing -z: its wall runs toward -x.
    const front = ground.filter((run) => run.z === 0);
    expect(front.map((run) => run.piece).sort()).toEqual(
      ['metal-door', 'stone-storefront', 'stone-storefront'].sort(),
    );
    expect(front.reduce((sum, run) => sum + run.bays, 0)).toBe(10);
    const door = front.find((run) => run.piece === 'metal-door');
    // The middle bay of ten: the fifth, 8 to 10 m along the 20 m edge.
    expect(door?.bays).toBe(1);
    expect(door?.x).toBeCloseTo(11, 4);
    for (const run of ground.filter((each) => each.z !== 0)) {
      expect(run.piece).toBe('stone-pier');
    }
    // Every upper storey, on every edge, is the style's window.
    for (const run of runsOf(wrap).filter((each) => each.y > 10.4 && each.y < 19)) {
      expect(run.piece).toBe('brick-window');
    }
    for (const run of runsOf(wrap).filter((each) => each.y > 19)) {
      expect(run.piece).toBe('brick-cornice');
    }
  });

  it('leaves a party wall plain, and draws the plain piece where a bay is squeezed out of shape', () => {
    // Edge 1 (x = 20) wholly shared, edge 3 (x = 0) shared for a third.
    const wrap = wrapped({
      shared: new Map([
        [1, 12],
        [3, 4],
      ]),
    });
    const storeys = runsOf(wrap).filter((run) => run.y >= 10.4 && run.y < 19);
    for (const run of storeys.filter((each) => each.x === 20))
      expect(run.piece).toBe('brick-plain');
    expect(storeys.filter((each) => each.x === 0).some((run) => run.piece !== 'brick-plain')).toBe(
      true,
    );
    // A 1 m return in an outline: one bay at half its width, too narrow for a window.
    const notched = [0, 0, 20, 0, 20, 12, 10, 12, 10, 11, 0, 11];
    const narrow = runsOf(wrapped({ ring: notched })).filter(
      (run) => run.x === 10 && run.y >= 10.4 && run.y < 19,
    );
    expect(narrow.length).toBeGreaterThan(0);
    for (const run of narrow) {
      expect(run.stretchX).toBeCloseTo(0.5, 6);
      expect(run.piece).toBe('brick-plain');
    }
  });

  it('counts its triangles as its runs and roof add up, and never passes its budget', () => {
    for (const kind of KIT_KINDS) {
      for (const budget of [200, 400, REALISTIC_TRIANGLES.structure, 3_000]) {
        const wrap = wrapFootprint(input({ kind, budget }));
        if (wrap === undefined) continue;
        expect(wrap.triangles, `${kind} ${String(budget)}`).toBe(trianglesOf(wrap));
        expect(wrap.triangles, `${kind} ${String(budget)}`).toBeLessThanOrEqual(budget);
        expect(wrap.relief).toBe(
          runsOf(wrap).reduce((sum, run) => sum + (run.relief ? run.bays : 0), 0),
        );
      }
    }
    // The cards alone: 32 bays on five levels, and the roof's two triangles.
    expect(wrapped({ budget: 322 }).triangles).toBe(322);
    expect(wrapped({ budget: 322 }).relief).toBe(0);
    expect(wrapFootprint(input({ budget: 321 }))).toBeUndefined();
  });

  it('raises the door first, then the street front’s ground floor outward from it, while the budget allows', () => {
    const cards = 322;
    const door = KIT_PIECES[kitPieceIndex('metal-door')]?.triangles ?? NaN;
    const front = KIT_PIECES[kitPieceIndex('stone-storefront')]?.triangles ?? NaN;
    const reliefOf = (budget: number): readonly Run[] =>
      runsOf(wrapped({ budget })).filter((run) => run.relief);
    // One triangle short of the door in relief: nothing is raised but the cheap cornice.
    expect(reliefOf(cards + door - 3).every((run) => run.piece !== 'metal-door')).toBe(true);
    const withDoor = reliefOf(cards + door - 2);
    expect(withDoor.map((run) => run.piece)).toEqual(['metal-door']);
    // Then the shop fronts beside the door, nearest first.
    const withOne = reliefOf(cards + door - 2 + front - 2);
    expect(withOne.map((run) => run.piece).sort()).toEqual(['metal-door', 'stone-storefront']);
    const beside = withOne.find((run) => run.piece === 'stone-storefront');
    expect(Math.abs((beside?.x ?? NaN) - 11)).toBeCloseTo(2, 4);
    // With room for everything, every bay of the street front is in relief and no other is.
    const all = runsOf(wrapped({ budget: 100_000 }));
    for (const run of all) {
      const piece = KIT_PIECES[kitPieceIndex(run.piece)] as (typeof KIT_PIECES)[number];
      const onFront = run.z === 0 && run.y >= 10.4;
      expect(run.relief, `${run.piece} at ${String(run.y)}`).toBe(
        onFront && piece.triangles > KIT_CARD_TRIANGLES,
      );
    }
  });

  it('lays a flat roof over the whole outline at the eaves, facing up', () => {
    const notched = [0, 0, 20, 0, 20, 12, 10, 12, 10, 6, 0, 6];
    for (const ring of [
      BLOCK,
      notched,
      [...notched]
        .reverse()
        .flatMap((_, i, all) => (i % 2 === 0 ? [all[i + 1] as number, all[i] as number] : [])),
    ]) {
      const wrap = wrapped({ ring });
      let area = 0;
      for (let at = 0; at < wrap.roof.length; at += 9) {
        const [ax, ay, az, bx, by, bz, cx, cy, cz] = wrap.roof.subarray(at, at + 9);
        expect([ay, by, cy]).toEqual([19.4, 19.4, 19.4].map((y) => Math.fround(y)));
        // (b - a) × (c - a), its y: positive, so the triangle faces up.
        const up =
          ((bz as number) - (az as number)) * ((cx as number) - (ax as number)) -
          ((bx as number) - (ax as number)) * ((cz as number) - (az as number));
        expect(up).toBeGreaterThan(0);
        area += up / 2;
      }
      expect(area).toBeCloseTo(ring === BLOCK ? 240 : 180, 3);
      expect(wrap.roofBounds).toEqual([0, 0, 20, 12]);
    }
  });

  it('refuses a footprint it cannot wrap: storeys stretched out of shape, no door edge, no outline', () => {
    // Three storeys in 5 m, and in 15 m: 0.56 and 1.67 times a storey.
    expect(wrapFootprint(input({ eaves: 15.4 }))).toBeUndefined();
    expect(wrapFootprint(input({ eaves: 25.4 }))).toBeUndefined();
    // Just inside 0.7 and 1.5 times, it is wrapped.
    expect(wrapFootprint(input({ eaves: 10.4 + 9 * 0.71 }))).toBeDefined();
    expect(wrapFootprint(input({ eaves: 10.4 + 9 * 1.49 }))).toBeDefined();
    expect(wrapFootprint(input({ frontEdge: 4 }))).toBeUndefined();
    expect(wrapFootprint(input({ frontEdge: -1 }))).toBeUndefined();
    expect(wrapFootprint(input({ ring: [0, 0, 1, 1] }))).toBeUndefined();
    expect(wrapFootprint(input({ storeys: 0 }))).toBeUndefined();
  });

  it('draws no plinth where the floor is the foot', () => {
    const wrap = wrapped({ base: 10.4 });
    expect(runsOf(wrap).every((run) => run.y >= 10.4)).toBe(true);
    // Its cards alone are a level fewer: 32 bays on four levels, and the roof.
    expect(wrapped({ base: 10.4, budget: 258 }).triangles).toBe(258);
    expect(wrapFootprint(input({ base: 10.4, budget: 257 }))).toBeUndefined();
  });
});
