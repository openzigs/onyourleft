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
  KIT_BRICK_SHADES,
  KIT_CARD_TRIANGLES,
  KIT_CELLS,
  KIT_ESCAPE_STOREYS,
  KIT_GUTTER_PIXELS,
  KIT_HOUSE_DOORS,
  KIT_HUNG,
  KIT_NEUTRAL_LEVEL,
  KIT_PIECES,
  KIT_PIXELS_PER_METRE,
  KIT_RUN_FLOATS,
  KIT_SHOPFRONTS,
  KIT_SKINS,
  KIT_STOREY_METRES,
  KIT_TINT_CLASSES,
  KIT_URBAN_CLASSES,
  kitCardOf,
  kitCells,
  kitCellUv,
  kitKindOf,
  kitMeshIndex,
  kitPaletteOf,
  kitPieceIndex,
  kitWallCount,
  kitWallEntryOf,
  kitWallShadeOf,
  KIT_METAL_SHADES,
  kitPlacedPoint,
  kitProjectedUv,
  kitStyleOf,
  wrapFootprint,
  type KitKind,
  type KitPiece,
  type KitPieceId,
  type KitSkin,
  type KitStyle,
  type KitWrap,
  type KitWrapInput,
} from './facade-kit';
import { SIGN_PAINTS, WALL_PAINTS } from './building-paint';
import { committedKitPieces, SHIPPED_REALISTIC } from './facade-kit-testing';
import { REALISTIC_DOWNTOWN_KIT } from './realistic-assets';
import {
  DEVICE_BYTES_PER_TEXEL,
  estimatedTextureBytes,
  REALISTIC_DOWNTOWN_KIT_SURFACES,
  REALISTIC_KIT_WRAP_TRIANGLES,
} from './realistic-budget';
import { fileKtx2Facts } from './realistic-bytes-testing';
import type { UrbanClass } from './urban-class';

/** The committed files' sizes, which `realistic-budget.ts` states. */
const GLB_BYTES = 560_112;
const ATLAS_BYTES = 326_898;

/** Every urban class a stretch of route may have (`urban-class.ts`). */
const URBAN_CLASSES: readonly UrbanClass[] = ['unknown', 'rural', 'village', 'town', 'city-centre'];

/** Every kind a footprint is wrapped as. */
const KIT_KINDS: readonly KitKind[] = ['retail', 'shop', 'office', 'townhouse'];

/** The first seed from `from` whose style `wanted` accepts: a building of that look. */
function seedFor(
  over: Partial<KitWrapInput>,
  wanted: (style: KitStyle) => boolean,
  from = 0,
): number {
  for (let seed = from; seed < from + 5_000; seed += 1) {
    if (wanted(kitStyleOf({ ...input(over), seed }))) return seed;
  }
  throw new Error('no seed in five thousand makes that building');
}

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
    budget: REALISTIC_KIT_WRAP_TRIANGLES,
    surface: 'brick',
    seed: 1,
    awning: false,
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
  /** How far along the wall each repeat is from the last, metres. */
  readonly pitch: number;
  /** Whether it hangs on the wall and is no bay of it. */
  readonly hung: boolean;
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
      pitch: wrap.runs[at + 10] as number,
      hung: KIT_HUNG.has(piece.id),
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
            ? ((KIT_PIECES[kitPieceIndex(run.piece)] as KitPiece | undefined)?.triangles ?? NaN)
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

  it('holds every piece of the table to the committed GLB: its triangles, its colour classes, and geometry and texture coordinates alone', () => {
    expect(pieces.length).toBe(KIT_PIECES.length);
    KIT_PIECES.forEach((piece: KitPiece, index) => {
      const committed = pieces[index];
      expect(committed?.triangles, piece.id).toBe(piece.triangles);
      expect(committed?.attributes, piece.id).toEqual([
        'NORMAL',
        'POSITION',
        'TEXCOORD_0',
        'TEXCOORD_1',
      ]);
      // A piece that wears another's mesh has none of its own in the file, and every other has.
      expect(committed?.own, piece.id).toBe(piece.mesh === undefined);
      expect(kitMeshIndex(index) === index, piece.id).toBe(piece.mesh === undefined);
      // Every vertex is one of the four classes, and the piece's own class is among them.
      const classes = new Set(committed?.tint);
      for (const each of classes) expect(KIT_TINT_CLASSES[each], piece.id).toBeDefined();
      expect(classes.has(KIT_TINT_CLASSES.indexOf(piece.tint)), piece.id).toBe(true);
    });
    // No piece in relief costs more than a third of one wrapped building.
    for (const piece of KIT_PIECES) {
      expect(piece.triangles, piece.id).toBeLessThanOrEqual(REALISTIC_KIT_WRAP_TRIANGLES / 3);
    }
    // 31 meshes for the 39 pieces: the render skin is the brick's geometry again.
    expect(pieces.filter((each) => each.own).length).toBe(31);
  });

  it('classes what a building colours: brick and render walls, stone trim, a shop front’s timber, and never glass', () => {
    const classesOf = (id: KitPieceId): readonly string[] =>
      [...new Set(pieces[kitPieceIndex(id)]?.tint)]
        .map((each) => KIT_TINT_CLASSES[each] as string)
        .sort();
    expect(classesOf('brick-plain')).toEqual(['wall']);
    expect(classesOf('brick-lintel')).toEqual(['fixed', 'trim', 'wall']);
    expect(classesOf('render-lintel')).toEqual(['fixed', 'trim', 'wall']);
    expect(classesOf('stone-cornice')).toEqual(['trim']);
    expect(classesOf('timber-storefront')).toEqual(['accent', 'fixed']);
    expect(classesOf('awning')).toEqual(['accent']);
    expect(classesOf('fascia')).toEqual(['accent', 'trim']);
    expect(classesOf('metal-storefront')).toEqual(['fixed']);
    expect(classesOf('balcony')).toEqual(['fixed']);
    expect(classesOf('roof')).toEqual(['fixed']);
  });

  it('stands every piece on its bay: its foot on the ground, its face on the wall’s plane, its relief within 40 cm of it, and what hangs within its metre', () => {
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
      // Within the pipeline's overhang of its bay (a sill, a cornice's return, a door's hood).
      expect(lowest, piece.id).toBeGreaterThanOrEqual(-0.2);
      expect(lowest, piece.id).toBeLessThanOrEqual(piece.height / 2);
      expect(highest, piece.id).toBeLessThanOrEqual(piece.height + 0.2);
      expect(widest, piece.id).toBeLessThanOrEqual(piece.width / 2 + 0.2);
      // +Z is out of the building: a bay's relief stands at most 54 cm before the wall (the
      // moulded cornice) and what hangs on it a metre (an awning, a landing); none deep behind.
      expect(before, piece.id).toBeLessThanOrEqual(KIT_HUNG.has(piece.id) ? 1.01 : 0.54);
      expect(behind, piece.id).toBeGreaterThanOrEqual(-0.41);
      // And real depth: a window, a door or a shop front is set at least 20 cm into its wall.
      if ('glass' in piece && piece.id !== 'metal-door') {
        expect(behind, piece.id).toBeLessThanOrEqual(-0.2);
      }
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

  it('ships the atlas as one 2048 px KTX2 colour picture with its mipmaps', () => {
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
    expect(sizes).toEqual([GLB_BYTES, ATLAS_BYTES]);
    // No side over 2048 px, whatever the source publishes (ADR 0026 D-6).
    expect(atlas.width).toBeLessThanOrEqual(2_048);
    // The pieces' triangles, in relief, as that file states them.
    expect(KIT_PIECES.length).toBe(39);
    expect(KIT_PIECES.reduce((sum, piece) => sum + piece.triangles, 0)).toBe(9_407);
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
    const tall: KitPiece = {
      id: 'tall',
      source: 'Tall',
      width: 2,
      height: 3,
      triangles: 2,
      tint: 'wall',
    };
    // 2048 px holds nine such cells across and six shelves down.
    expect(() => kitCells(Array.from({ length: 55 }, () => tall))).toThrow(RangeError);
    expect(() => kitCells(Array.from({ length: 54 }, () => tall))).not.toThrow();
  });

  it('makes a card of two triangles facing out, wearing the whole cell the right way up', () => {
    KIT_PIECES.forEach((piece, index) => {
      const card = kitCardOf(index);
      const cell = kitCellUv(index);
      expect(card.triangles).toBe(KIT_CARD_TRIANGLES);
      expect(card.position.length).toBe(KIT_CARD_TRIANGLES * 9);
      // One class across it: the piece's own.
      expect([...card.tint]).toEqual(Array(6).fill(KIT_TINT_CLASSES.indexOf(piece.tint)));
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

  it('names a piece of the kit for every part of every skin and shop front', () => {
    expect([...KIT_KINDS].sort()).toEqual(['office', 'retail', 'shop', 'townhouse']);
    for (const [skin, pieces] of Object.entries(KIT_SKINS)) {
      for (const id of [
        pieces.plain,
        pieces.pier,
        ...pieces.cornices,
        ...pieces.windows.map((window) => window.piece),
        ...(pieces.pilaster === undefined ? [] : [pieces.pilaster]),
      ]) {
        expect(kitPieceIndex(id), `${skin} ${id}`).toBeGreaterThanOrEqual(0);
      }
      // A window as wide as it says, and the first one bay across: what fills an odd bay.
      for (const window of pieces.windows) {
        expect(KIT_PIECES[kitPieceIndex(window.piece)]?.width).toBe(window.span * KIT_BAY_METRES);
      }
      expect(pieces.windows[0]?.span).toBe(1);
    }
    for (const front of [
      ...KIT_SHOPFRONTS.flatMap((each) => [each.front, each.door]),
      ...KIT_HOUSE_DOORS,
    ]) {
      expect(kitPieceIndex(front), front).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('what one building looks like — #3334, the look check on PR #3343', () => {
  const styleOf = (over: Partial<KitWrapInput>): KitStyle => kitStyleOf(input(over));

  it('walls a wrap in what its extrusion is walled in, and an office of no brick in metal or stone', () => {
    const skins = (kind: KitKind, surface: string): readonly KitSkin[] =>
      [
        ...new Set(Array.from({ length: 200 }, (_, seed) => styleOf({ kind, surface, seed }).skin)),
      ].sort();
    for (const kind of ['retail', 'shop', 'townhouse'] as const) {
      expect(skins(kind, 'brick')).toEqual(['brick']);
      expect(skins(kind, 'render')).toEqual(['render']);
      expect(skins(kind, 'painted')).toEqual(['render']);
      expect(skins(kind, 'stone')).toEqual(['stone']);
      expect(skins(kind, 'concrete')).toEqual(['stone']);
    }
    expect(skins('office', 'brick')).toEqual(['brick']);
    expect(skins('office', 'render')).toEqual(['metal', 'stone']);
  });

  it('gives two hundred brick shops every window, cornice, shop front and sign the kit has, each chosen apart', () => {
    const styles = Array.from({ length: 200 }, (_, seed) => styleOf({ seed, storeys: 3 }));
    const seen = <T>(of: (style: KitStyle) => T): number => new Set(styles.map(of)).size;
    expect(seen((style) => style.window)).toBe(KIT_SKINS.brick.windows.length);
    expect(seen((style) => style.cornice)).toBe(KIT_SKINS.brick.cornices.length);
    expect(seen((style) => style.shopfront)).toBe(KIT_SHOPFRONTS.length);
    expect(seen((style) => style.sign)).toBe(2);
    expect(seen((style) => style.pilasters)).toBe(2);
    expect(seen((style) => style.escape)).toBe(2);
    // Each on its own stream (`seeded.ts` §`uniformFrom`): every window is seen under every
    // cornice, and every shop front under either sign. One stream for two of them would
    // give every arched window the same cornice.
    expect(seen((style) => `${String(style.window)} ${style.cornice}`)).toBe(
      KIT_SKINS.brick.windows.length * KIT_SKINS.brick.cornices.length,
    );
    expect(seen((style) => `${String(style.shopfront?.front)} ${style.sign}`)).toBe(
      KIT_SHOPFRONTS.length * 2,
    );
    expect(seen((style) => `${String(style.pilasters)} ${String(style.escape)}`)).toBe(4);
    // Each on its own stream: far more distinct buildings than any one choice has entries.
    const whole = new Set(styles.map((style) => JSON.stringify(style)));
    expect(whole.size).toBeGreaterThan(60);
    // And the same building on every load.
    expect(styleOf({ seed: 77 })).toEqual(styleOf({ seed: 77 }));
  });

  it('hangs an awning where the extrusion has one, a sign band on some other shops, and neither on a house or an office', () => {
    for (let seed = 0; seed < 100; seed += 1) {
      expect(styleOf({ seed, awning: true }).sign).toBe('awning');
      expect(styleOf({ seed, kind: 'retail', awning: true }).sign).toBe('awning');
      expect(styleOf({ seed }).sign).not.toBe('awning');
      expect(styleOf({ seed, kind: 'townhouse', awning: true }).sign).toBe('none');
      expect(styleOf({ seed, kind: 'office', awning: true }).sign).toBe('none');
    }
  });

  it('hangs a fire escape only on a brick shop or house of three storeys or more', () => {
    expect(KIT_ESCAPE_STOREYS).toBe(3);
    const some = (over: Partial<KitWrapInput>): boolean =>
      Array.from({ length: 200 }, (_, seed) => styleOf({ ...over, seed })).some(
        (style) => style.escape,
      );
    expect(some({ storeys: 3 })).toBe(true);
    expect(some({ storeys: 3, kind: 'townhouse' })).toBe(true);
    expect(some({ storeys: 2 })).toBe(false);
    expect(some({ storeys: 3, surface: 'render' })).toBe(false);
    expect(some({ storeys: 5, kind: 'office' })).toBe(false);
  });

  it('gives a townhouse a door of its own and no shop front, and an office a metal one', () => {
    const doors = new Set<KitPieceId>();
    for (let seed = 0; seed < 100; seed += 1) {
      const house = styleOf({ seed, kind: 'townhouse' });
      expect(house.shopfront).toBeUndefined();
      doors.add(house.door);
      expect(styleOf({ seed, kind: 'office' }).shopfront?.front).not.toBe('timber-storefront');
      expect(styleOf({ seed }).door).toBe(styleOf({ seed }).shopfront?.door);
    }
    expect([...doors].sort()).toEqual([...KIT_HOUSE_DOORS].sort());
  });

  it('colours a wrap from its plan’s own paints: the render’s house paint itself, a shade of brick, a sign paint', () => {
    const paint = { wall: 3, trim: 1, door: 2 };
    // Render: the very house paint (sage), over the neutral grey the atlas is baked at.
    const sage = (WALL_PAINTS.render ?? [])[3] as readonly number[];
    const render = kitPaletteOf('render', paint);
    render.wall.forEach((channel, at) => {
      expect(channel * KIT_NEUTRAL_LEVEL).toBeCloseTo((sage[at] as number) * 0.89, 6);
    });
    // Brick: a shade, a multiplier over the kit's own brick.
    expect(kitPaletteOf('brick', paint).wall).toEqual(KIT_BRICK_SHADES[3]);
    // Every shade is a brick: red over green over blue or near it, and no more than twice the kit's own.
    for (const [red, green, blue] of KIT_BRICK_SHADES) {
      expect(red).toBeGreaterThanOrEqual(green);
      expect(Math.max(red, green, blue)).toBeLessThanOrEqual(2);
      expect(Math.min(red, green, blue)).toBeGreaterThanOrEqual(0.9);
    }
    // The accent: the main street's sign paint, by the door's entry.
    const navy = SIGN_PAINTS[2] as readonly number[];
    render.accent.forEach((channel, at) => {
      expect(channel * KIT_NEUTRAL_LEVEL).toBeCloseTo(navy[at] as number, 6);
    });
    // Two neighbours `paintTown` kept apart are apart as wraps, in every skin.
    for (const skin of ['brick', 'render', 'stone', 'metal'] as const) {
      expect(kitPaletteOf(skin, paint).wall).not.toEqual(
        kitPaletteOf(skin, { ...paint, wall: 2 }).wall,
      );
    }
    // No trim is a dark timber's: a lintel is stone.
    for (let trim = 0; trim < 12; trim += 1) {
      const [red, green, blue] = kitPaletteOf('brick', { ...paint, trim }).trim;
      expect(Math.min(red, green, blue) * KIT_NEUTRAL_LEVEL).toBeGreaterThan(0.25);
    }
  });

  it('walls a wrap in the shade it carries over its plan’s entry, and a mapped colour in its skin’s nearest — #3352', () => {
    const paint = { wall: 3, trim: 1, door: 2 };
    // A shade carried wins over the entry, in every skin; the trim and accent are the paint's.
    for (const skin of ['brick', 'render', 'stone', 'metal'] as const) {
      const carried = kitPaletteOf(skin, paint, 0);
      expect(carried.wall).toEqual(kitPaletteOf(skin, { ...paint, wall: 0 }).wall);
      expect(carried.wall).not.toEqual(kitPaletteOf(skin, paint).wall);
      expect(carried.trim).toEqual(kitPaletteOf(skin, paint).trim);
      expect(kitWallShadeOf({ style: { skin }, wallShade: 0 }, 3)).toBe(0);
      expect(kitWallShadeOf({ style: { skin } }, 3 + kitWallCount(skin))).toBe(3);
    }
    // Metal: its shades compared as written, as `building-paint.ts` compares a photograph's
    // shift whose albedo is not written down. White is the pale shade, blue the dark one.
    expect(kitWallEntryOf('metal', [0.9, 0.9, 0.86])).toBe(0);
    expect(kitWallEntryOf('metal', [1.4, 1.4, 1.4])).toBe(3);
    expect(kitWallEntryOf('metal', [0.07, 0.16, 0.39])).toBe(4);
    for (const [entry, shade] of KIT_METAL_SHADES.entries()) {
      expect(kitWallEntryOf('metal', shade)).toBe(entry);
    }
    // Render: the house paint the extrusion's own mapped entry is, over the same white.
    for (const [entry, house] of (WALL_PAINTS.render ?? []).entries()) {
      expect(kitWallEntryOf('render', house.map((each) => each * 0.89) as never)).toBe(entry);
    }
  });
});

describe('a footprint wrapped — #3334', () => {
  /** A seed whose brick shop has a window one bay across, so its bays are the outline's own. */
  const PLAIN = seedFor({}, (style) => KIT_SKINS.brick.windows[style.window]?.span === 1);
  /** An 8 m front: four bays, which 3 000 triangles put in relief whole. */
  const NARROW = [0, 0, 8, 0, 8, 12, 0, 12];
  const bayRuns = (wrap: KitWrap): readonly Run[] => runsOf(wrap).filter((run) => !run.hung);
  const hungRuns = (wrap: KitWrap, piece: KitPieceId): readonly Run[] =>
    runsOf(wrap).filter((run) => run.piece === piece);
  const widthOf = (run: Run): number =>
    (KIT_PIECES[kitPieceIndex(run.piece)] as KitPiece).width * run.stretchX;

  it('cuts an edge into bays of about two metres, and never none', () => {
    expect(bayCount(20)).toBe(10);
    expect(bayCount(12.9)).toBe(6);
    expect(bayCount(13.1)).toBe(7);
    expect(bayCount(0.4)).toBe(1);
    expect(KIT_BAY_METRES).toBe(2);
  });

  it('covers every edge exactly, storey by storey, from the plan’s foot to its parapet’s top, whatever it is built of', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const wrap = wrapped({ seed });
      const runs = bayRuns(wrap);
      // Each level of each edge: the plinth, three storeys and the cornice.
      const levels = new Map<string, number>();
      for (const run of runs) {
        const key = `${run.ax.toFixed(3)},${run.az.toFixed(3)}@${run.y.toFixed(3)}`;
        levels.set(key, (levels.get(key) ?? 0) + run.bays * widthOf(run));
        // A run's repeats stand a piece's width apart: no gap in it and no overlap.
        if (run.bays > 1) expect(run.pitch, run.piece).toBeCloseTo(widthOf(run), 5);
      }
      // Four edges, five levels each.
      expect(levels.size, String(seed)).toBe(20);
      for (const [key, covered] of levels) {
        const along = key.startsWith('1.000,0.000') || key.startsWith('-1.000,0.000') ? 20 : 12;
        expect(covered, `${String(seed)} ${key}`).toBeCloseTo(along, 4);
      }
      const feet = [...new Set(runs.map((run) => Number(run.y.toFixed(3))))].sort((a, b) => a - b);
      expect(feet).toEqual([10, 10.4, 13.4, 16.4, 19.4]);
      // The plinth reaches the floor, a storey the next, and the cornice the parapet's top.
      for (const run of runs) {
        const piece = KIT_PIECES[kitPieceIndex(run.piece)] as KitPiece;
        const top = run.y + piece.height * run.stretchY;
        const expected = run.y === 10 ? 10.4 : run.y > 19 ? 19.9 : run.y + KIT_STOREY_METRES;
        expect(top, `${run.piece} at ${String(run.y)}`).toBeCloseTo(expected, 4);
      }
    }
  });

  it('stretches each storey to the plan’s own, so the storeys reach the eaves whatever a storey’s height', () => {
    // Three storeys of 3.6 m, as a mapped height of 10.8 m over three levels gives.
    const wrap = wrapped({ eaves: 10.4 + 3 * 3.6 });
    const runs = bayRuns(wrap);
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
      for (const seed of [PLAIN, PLAIN + 1, PLAIN + 2, PLAIN + 3]) {
        const wrap = wrapped({ ring, frontEdge, seed });
        let metres = 0;
        for (const run of bayRuns(wrap)) {
          const half = (KIT_PIECES[kitPieceIndex(run.piece)] as KitPiece).width / 2;
          for (let bay = 0; bay < run.bays; bay += 1) {
            // The bay's middle is on the outline: a step in is inside, a step out is not.
            const [inX, , inZ] = kitPlacedPoint(wrap.runs, run.at, bay, 0, 0, -0.05);
            const [outX, , outZ] = kitPlacedPoint(wrap.runs, run.at, bay, 0, 0, 0.05);
            expect(inside(BLOCK, inX, inZ), `${run.piece} ${String(bay)}`).toBe(true);
            expect(inside(BLOCK, outX, outZ), `${run.piece} ${String(bay)}`).toBe(false);
            // And its two ends are on the outline too: inside by a hair's step in.
            for (const end of [-0.999 * half, 0.999 * half]) {
              const [x, , z] = kitPlacedPoint(wrap.runs, run.at, bay, end, 0, -0.01);
              expect(inside(BLOCK, x, z), `${run.piece} ${String(bay)}`).toBe(true);
            }
            metres += widthOf(run);
          }
        }
        // (20 + 12 + 20 + 12) metres of wall, on five levels.
        expect(metres).toBeCloseTo(64 * 5, 3);
      }
    }
  });

  it('puts the style’s shop front and door on the edge that faces the street, and the skin’s own pieces elsewhere', () => {
    for (let seed = 0; seed < 30; seed += 1) {
      const wrap = wrapped({ seed });
      const { style } = wrap;
      const skin = KIT_SKINS[style.skin];
      const ground = bayRuns(wrap).filter((run) => run.y === 10.4);
      // Edge 0 runs along z = 0, facing -z: its wall runs toward -x.
      const front = ground.filter((run) => run.z === 0);
      expect([...new Set(front.map((run) => run.piece))].sort()).toEqual(
        [wrap.door, style.shopfront?.front].sort(),
      );
      expect(front.reduce((sum, run) => sum + run.bays, 0)).toBe(10);
      const door = front.find((run) => run.piece === wrap.door);
      // The middle bay of ten: the fifth, 8 to 10 m along the 20 m edge.
      expect(door?.bays).toBe(1);
      expect(door?.x).toBeCloseTo(11, 4);
      for (const run of ground.filter((each) => each.z !== 0)) expect(run.piece).toBe(skin.pier);
      // An upper storey of the street front is the wrap's window, and of any other wall the skin's first.
      for (const run of bayRuns(wrap).filter((each) => each.y > 10.4 && each.y < 19)) {
        expect(run.piece).toBe(run.z === 0 ? wrap.window : skin.windows[0]?.piece);
      }
      for (const run of bayRuns(wrap).filter((each) => each.y > 19)) {
        expect(run.piece).toBe(run.z === 0 ? wrap.cornice : skin.cornices[0]);
      }
    }
  });

  it('takes a window two bays wide in pairs, and fills an odd bay with the skin’s first', () => {
    // A 10 m front: five bays, so two pairs and one bay over, on each of two upper storeys.
    const ring = [0, 0, 10, 0, 10, 12, 0, 12];
    const spanOf = (id: KitPieceId): number | undefined =>
      KIT_SKINS.brick.windows.find((each) => each.piece === id)?.span;
    const seed = seedFor({}, (style) => KIT_SKINS.brick.windows[style.window]?.span === 2);
    const wrap = wrapped({ seed, ring, budget: 100_000 });
    expect(spanOf(wrap.window)).toBe(2);
    const upper = bayRuns(wrap).filter((run) => run.z === 0 && run.y > 10.4 && run.y < 19);
    const wide = upper.filter((run) => run.piece === wrap.window);
    const odd = upper.filter((run) => run.piece === 'brick-window');
    expect(KIT_SKINS.brick.windows.find((each) => each.piece === wrap.window)?.span).toBe(2);
    expect(wide.reduce((sum, run) => sum + run.bays, 0)).toBe(4);
    expect(odd.reduce((sum, run) => sum + run.bays, 0)).toBe(2);
    for (const run of wide) expect(widthOf(run)).toBeCloseTo(4, 5);
    for (const run of odd) expect(widthOf(run)).toBeCloseTo(2, 5);
  });

  it('leaves a party wall plain, and draws the plain piece where a bay is squeezed out of shape', () => {
    // Edge 1 (x = 20) wholly shared, edge 3 (x = 0) shared for a third.
    const wrap = wrapped({
      shared: new Map([
        [1, 12],
        [3, 4],
      ]),
    });
    const storeys = bayRuns(wrap).filter((run) => run.y >= 10.4 && run.y < 19);
    for (const run of storeys.filter((each) => each.x === 20))
      expect(run.piece).toBe('brick-plain');
    expect(storeys.filter((each) => each.x === 0).some((run) => run.piece !== 'brick-plain')).toBe(
      true,
    );
    // A 1 m return in an outline: one bay at half its width, too narrow for a window.
    const notched = [0, 0, 20, 0, 20, 12, 10, 12, 10, 11, 0, 11];
    const narrow = bayRuns(wrapped({ ring: notched })).filter(
      (run) => run.x === 10 && run.y >= 10.4 && run.y < 19,
    );
    expect(narrow.length).toBeGreaterThan(0);
    for (const run of narrow) {
      expect(run.stretchX).toBeCloseTo(0.5, 6);
      expect(run.piece).toBe('brick-plain');
    }
  });

  it('counts its triangles as its runs and roof add up, and never passes its budget', () => {
    let wraps = 0;
    for (const kind of KIT_KINDS) {
      for (const surface of ['brick', 'render', 'stone']) {
        for (const budget of [200, 400, 640, REALISTIC_KIT_WRAP_TRIANGLES, 100_000]) {
          for (let seed = 0; seed < 12; seed += 1) {
            const wrap = wrapFootprint(
              input({ kind, surface, budget, seed, awning: seed % 2 === 0 }),
            );
            if (wrap === undefined) continue;
            wraps += 1;
            const label = `${kind} ${surface} ${String(budget)} ${String(seed)}`;
            expect(wrap.triangles, label).toBe(trianglesOf(wrap));
            expect(wrap.triangles, label).toBeLessThanOrEqual(budget);
            expect(wrap.relief, label).toBe(
              bayRuns(wrap).reduce((sum, run) => sum + (run.relief ? run.bays : 0), 0),
            );
          }
        }
      }
    }
    expect(wraps).toBeGreaterThan(300);
    // The cards alone: 32 bays on five levels, and the roof's two triangles.
    expect(wrapped({ seed: PLAIN, budget: 322 }).triangles).toBe(322);
    // Nothing in relief there costs a triangle more than its card: the plain wall is its card.
    for (const run of runsOf(wrapped({ seed: PLAIN, budget: 322 })).filter((each) => each.relief)) {
      expect(KIT_PIECES[kitPieceIndex(run.piece)]?.triangles, run.piece).toBe(KIT_CARD_TRIANGLES);
    }
    expect(wrapFootprint(input({ seed: PLAIN, budget: 321 }))).toBeUndefined();
  });

  it('puts the whole street front in relief at 3 000 triangles, where 640 left most of it flat cards', () => {
    expect(REALISTIC_KIT_WRAP_TRIANGLES).toBe(3_000);
    const windows = new Set<KitPieceId>();
    const cornices = new Set<KitPieceId>();
    const doors = new Set<KitPieceId>();
    for (const kind of ['shop', 'townhouse'] as const) {
      for (const surface of ['brick', 'render']) {
        for (const storeys of [2, 3]) {
          for (let seed = 0; seed < 60; seed += 1) {
            const label = `${kind} ${surface} ${String(storeys)} ${String(seed)}`;
            const over = { kind, surface, seed, storeys, eaves: 10.4 + storeys * 3, ring: NARROW };
            const wrap = wrapped(over);
            // Four bays on every level, every one its real geometry.
            expect(wrap.front.bays, label).toBeGreaterThanOrEqual(12);
            expect(wrap.front.relief, label).toBe(wrap.front.bays);
            windows.add(wrap.window);
            cornices.add(wrap.cornice);
            doors.add(wrap.door);
            // The same building under the structure class's ceiling: most of its front is cards.
            const before = wrapped({ ...over, budget: 640 });
            expect(before.front.relief, label).toBeLessThan(before.front.bays / 2);
          }
        }
      }
    }
    // And not by giving every building the cheapest of everything: eight or more of the two
    // skins' ten windows are seen, every cornice and every door.
    expect(windows.size).toBeGreaterThanOrEqual(8);
    expect([...cornices].sort()).toEqual(['brick-cornice', 'render-cornice', 'stone-cornice']);
    expect([...doors].sort()).toEqual(['arch-door', 'metal-door', 'wood-door']);
  });

  it('keeps the seeded window where the front can pay for it, and takes the richest it can where not', () => {
    const costOf = (id: KitPieceId): number => {
      const window = KIT_SKINS.brick.windows.find((each) => each.piece === id);
      return (KIT_PIECES[kitPieceIndex(id)] as KitPiece).triangles / (window?.span ?? 1);
    };
    let kept = 0;
    let traded = 0;
    for (let seed = 0; seed < 200; seed += 1) {
      // A 12 m front of three storeys: six bays, which no window fills at 3 000. The cheapest
      // of everything, as far as the budget goes.
      const long = wrapped({ seed, ring: [0, 0, 12, 0, 12, 12, 0, 12] });
      expect(long.front.relief).toBeLessThan(long.front.bays);
      expect([long.window, long.door, long.cornice]).toEqual([
        'brick-window',
        'metal-door',
        'brick-cornice',
      ]);
      // An 8 m one: four bays, which the square sash, the wide and the arched window fill.
      const wrap = wrapped({ seed, ring: NARROW });
      expect(wrap.front.relief).toBe(wrap.front.bays);
      const seeded = KIT_SKINS.brick.windows[wrap.style.window]?.piece as KitPieceId;
      if (wrap.window === seeded) kept += 1;
      else {
        traded += 1;
        // Never a dearer window than the one chosen for it, and never a card for it.
        expect(costOf(wrap.window)).toBeLessThan(costOf(seeded));
      }
    }
    expect(kept).toBeGreaterThan(20);
    expect(traded).toBeGreaterThan(20);
  });

  it('settles a front no window can fill in one attempt, and searches only where the cheapest front is whole', () => {
    // PR #3343's review: a long block laid twenty-eight fronts to learn that none fits.
    let most = 0;
    for (let seed = 0; seed < 60; seed += 1) {
      for (const kind of KIT_KINDS) {
        for (const surface of ['brick', 'render', 'stone']) {
          const long = wrapped({ seed, kind, surface });
          if (long.front.relief < long.front.bays) expect(long.attempts).toBe(1);
        }
      }
      // An 8 m front is whole: the search runs, and never past every door, cornice and window.
      const whole = wrapped({ seed, ring: NARROW });
      expect(whole.front.relief).toBe(whole.front.bays);
      expect(whole.attempts).toBeLessThanOrEqual(1 + 2 * 2 * 7);
      most = Math.max(most, whole.attempts);
    }
    expect(most).toBeGreaterThan(2);
    // The 20 m block is never whole, whatever it is built of.
    expect(wrapped({}).attempts).toBe(1);
  });

  it('pays for a front too long for any window a whole row at a time, the door and the ground floor first', () => {
    // The 20 m block: ten bays on three storeys, more than 3 000 triangles in any window.
    for (let seed = 0; seed < 30; seed += 1) {
      const wrap = wrapped({ seed });
      expect(wrap.front.relief).toBeLessThan(wrap.front.bays);
      expect([wrap.window, wrap.door, wrap.cornice]).toEqual([
        'brick-window',
        'metal-door',
        'brick-cornice',
      ]);
      const front = bayRuns(wrap).filter((run) => run.z === 0);
      const reliefAt = (y: number): readonly boolean[] => [
        ...new Set(
          front
            .filter((run) => run.y === y && run.piece !== wrap.door && run.piece !== 'brick-plain')
            .map((run) => run.relief),
        ),
      ];
      // The door and the shop fronts beside it are real geometry on every one of them.
      expect(front.find((run) => run.piece === wrap.door)?.relief, String(seed)).toBe(true);
      expect(reliefAt(10.4), String(seed)).toEqual([true]);
      // A row is in relief whole or not at all, and an upper storey never before the one under it.
      expect(reliefAt(13.4).length).toBe(1);
      expect(reliefAt(16.4).length).toBe(1);
      if (reliefAt(16.4)[0] === true) expect(reliefAt(13.4)).toEqual([true]);
    }
    // With room for everything, every bay of the wrap is in relief.
    const all = wrapped({ budget: 100_000 });
    expect(all.front.relief).toBe(all.front.bays);
    for (const run of runsOf(all)) expect(run.relief, run.piece).toBe(true);
  });

  it('hangs an awning or a sign band over every bay of the shop front, under the first floor', () => {
    const awning = wrapped({ ring: NARROW, awning: true });
    const canvas = hungRuns(awning, 'awning');
    expect(canvas.reduce((sum, run) => sum + run.bays, 0)).toBe(4);
    for (const run of canvas) {
      expect(run.z).toBe(0);
      expect(run.relief).toBe(true);
      // Its top 5 cm under the first floor, 3 m over the ground floor's 10.4.
      expect(run.y + 1).toBeCloseTo(13.35, 3);
      expect(widthOf(run)).toBeCloseTo(2, 5);
    }
    expect(hungRuns(awning, 'fascia')).toEqual([]);
    const seed = seedFor({}, (style) => style.sign === 'fascia');
    const band = hungRuns(wrapped({ ring: NARROW, seed }), 'fascia');
    expect(band.reduce((sum, run) => sum + run.bays, 0)).toBe(4);
    for (const run of band) expect(run.y + 0.5).toBeCloseTo(13.35, 3);
    // A house has neither.
    const house = wrapped({ ring: NARROW, kind: 'townhouse', awning: true });
    expect([...hungRuns(house, 'awning'), ...hungRuns(house, 'fascia')]).toEqual([]);
  });

  it('stands pilasters between the bays of some fronts, a fire escape on some brick ones, and columns before a timber shop front', () => {
    const NONE = { sign: 'none' } as const;
    const pilastered = seedFor({}, (style) => style.pilasters && style.sign === NONE.sign);
    const piers = hungRuns(wrapped({ ring: NARROW, seed: pilastered }), 'brick-pilaster');
    // Up the two upper storeys of a shop (its ground floor is the shop front's), five a storey.
    expect([...new Set(piers.map((run) => run.y))].sort()).toEqual([13.4, 16.4]);
    expect(piers.reduce((sum, run) => sum + run.bays, 0)).toBe(10);
    for (const run of piers) {
      expect(run.z).toBe(0);
      expect(run.stretchX).toBe(1);
    }
    // The corners' stand 25 cm in, so two neighbours' are not in one place.
    const along = piers.flatMap((run) =>
      Array.from({ length: run.bays }, (_, bay) => millimetres(run.x - bay * run.pitch)),
    );
    expect([...new Set(along)].sort((a, b) => a - b)).toEqual([0.25, 2, 4, 6, 7.75]);
    // A house's stand from its ground floor.
    const house = hungRuns(
      wrapped({
        ring: NARROW,
        kind: 'townhouse',
        budget: 100_000,
        seed: seedFor({ kind: 'townhouse' }, (style) => style.pilasters),
      }),
      'brick-pilaster',
    );
    expect([...new Set(house.map((run) => run.y))].sort()).toEqual([10.4, 13.4, 16.4]);

    const escaping = seedFor({}, (style) => style.escape);
    const escape = wrapped({ ring: NARROW, seed: escaping });
    const landings = hungRuns(escape, 'balcony');
    const ladders = hungRuns(escape, 'ladder');
    // A landing at each upper floor, and a ladder between the two.
    expect(landings.map((run) => run.y).sort()).toEqual([13.4, 16.4]);
    expect(ladders.map((run) => run.y)).toEqual([13.4]);
    // On the bay beside the door's, not over it: the wall runs toward -x from x = 8, the
    // door's bay is its second (x from 4 to 6) and the landing's its third, about x = 3.
    for (const run of landings) expect(run.x).toBeCloseTo(3, 4);
    expect(hungRuns(wrapped({ ring: NARROW, seed: pilastered }), 'balcony')).toEqual([]);

    const timber = seedFor({}, (style) => style.shopfront?.columns !== undefined);
    const columns = hungRuns(wrapped({ ring: NARROW, seed: timber }), 'timber-columns');
    // One before each shop-front bay, and none before the door.
    expect(columns.reduce((sum, run) => sum + run.bays, 0)).toBe(3);
    for (const run of columns) expect(run.y).toBe(10.4);
  });

  it('never draws what hangs on a wall as a card: in relief, or not at all', () => {
    for (let seed = 0; seed < 60; seed += 1) {
      for (const budget of [322, 640, 1_500, REALISTIC_KIT_WRAP_TRIANGLES]) {
        const wrap = wrapFootprint(input({ seed, budget, awning: seed % 3 === 0 }));
        if (wrap === undefined) continue;
        for (const run of runsOf(wrap).filter((each) => each.hung)) {
          expect(run.relief, `${run.piece} ${String(seed)} ${String(budget)}`).toBe(true);
        }
      }
    }
    // With the cards alone, nothing hangs.
    expect(
      runsOf(wrapped({ seed: PLAIN, budget: 322, awning: true })).some((run) => run.hung),
    ).toBe(false);
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
    // Forty storeys are wrapped where the budget allows, and forty-one never.
    expect(wrapFootprint(input({ storeys: 40, eaves: 130.4, budget: 100_000 }))).toBeDefined();
    expect(wrapFootprint(input({ storeys: 41, eaves: 133.4, budget: 100_000 }))).toBeUndefined();
  });

  it('draws no plinth where the floor is the foot', () => {
    const wrap = wrapped({ base: 10.4 });
    expect(runsOf(wrap).every((run) => run.y >= 10.4)).toBe(true);
    // Its cards alone are a level fewer: 32 bays on four levels, and the roof.
    expect(wrapped({ seed: PLAIN, base: 10.4, budget: 258 }).triangles).toBe(258);
    expect(wrapFootprint(input({ seed: PLAIN, base: 10.4, budget: 257 }))).toBeUndefined();
  });
});
