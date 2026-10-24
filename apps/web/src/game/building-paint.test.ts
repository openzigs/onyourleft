// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1581: what a realistic building is painted — `building-paint.ts`' lists
 * held to their bounds, and the lots' colouring held to "unlike the lots a
 * rider sees beside it" for every plot and seed, with its control.
 */

import { describe, expect, it } from 'vitest';

import {
  AWNING_PAINTS,
  DOOR_PAINTS,
  linearFromSrgb,
  LOT_CLAD_STEP,
  LOT_PAINTS,
  lotClad,
  lotPaint,
  lotPaintChannel,
  lotPaintEntry,
  lotSidingPaints,
  MODEL_PAINT_STRENGTH,
  modelPaint,
  PAINT_LIMITS,
  paintChannelOf,
  paintsOf,
  ROOF_PAINTS,
  roofPaintsOf,
  SHINGLE_PAINTS,
  SHINGLE_SHARE,
  SIDING_SHARE,
  SIGN_PAINTS,
  TRIM_PAINTS,
  WALL_PAINTS,
  type Rgb,
} from './building-paint';
import { FOOTPRINT_SURFACES } from './footprint-buildings';
import { REALISTIC_BUILDING_SURFACES } from './realistic-assets';

const lists = (record: Readonly<Partial<Record<string, readonly Rgb[]>>>): (readonly Rgb[])[] =>
  Object.values(record).filter((list): list is readonly Rgb[] => list !== undefined);

describe('the paints — #1581', () => {
  it('starts every multiplier list at the photograph as it was, and holds every entry to its bound', () => {
    for (const list of [...lists(WALL_PAINTS), ...lists(ROOF_PAINTS)]) {
      // Render's first is white paint, which is its photograph near enough.
      if (list !== WALL_PAINTS.render) expect(list[0]).toStrictEqual([1, 1, 1]);
      expect(list.length).toBeGreaterThanOrEqual(LOT_PAINTS);
      for (const rgb of list) {
        for (const channel of rgb) {
          expect(channel).toBeGreaterThan(0);
          expect(channel).toBeLessThanOrEqual(PAINT_LIMITS.multiplier);
        }
      }
      // No two entries of one list alike: a list of one paint is no variety.
      expect(new Set(list.map((rgb) => rgb.join())).size).toBe(list.length);
    }
    // #1590: and a sign band's and an awning's.
    for (const list of [TRIM_PAINTS, DOOR_PAINTS, SIGN_PAINTS, AWNING_PAINTS]) {
      expect(new Set(list.map((rgb) => rgb.join())).size).toBe(list.length);
      for (const rgb of list) {
        for (const channel of rgb) {
          expect(channel).toBeGreaterThanOrEqual(PAINT_LIMITS.albedoLowest);
          expect(channel).toBeLessThanOrEqual(PAINT_LIMITS.albedoHighest);
        }
      }
    }
  });

  it('paints render — the white plaster that read flat grey — in colours, not only in white', () => {
    const render = WALL_PAINTS.render ?? [];
    expect(render.length).toBeGreaterThanOrEqual(8);
    // A paint is coloured where its channels differ: saturation, which #621's tint cannot add.
    const coloured = render.filter((rgb) => Math.max(...rgb) - Math.min(...rgb) > 0.2);
    expect(coloured.length).toBeGreaterThanOrEqual(5);
  });

  it('has a list for every surface a mapped building or a lot can wear, and reads the right channel', () => {
    for (const surface of FOOTPRINT_SURFACES) expect(paintsOf(surface), surface).toBeDefined();
    for (const kind of ['building', 'shop-row'] as const) {
      expect(paintChannelOf(REALISTIC_BUILDING_SURFACES[kind].wall)).toBe('wall');
      expect(paintChannelOf(REALISTIC_BUILDING_SURFACES[kind].roof)).toBe('roof');
    }
    // A pane, a pole and a hedge are never painted.
    for (const surface of ['glass', 'painted', 'hedge', 'paving'] as const) {
      expect(paintChannelOf(surface), surface).toBeUndefined();
      expect(paintsOf(surface), surface).toBeUndefined();
    }
  });

  it('converts sRGB as IEC 61966-2-1 does', () => {
    expect(linearFromSrgb(0)).toBe(0);
    expect(linearFromSrgb(1)).toBeCloseTo(1, 12);
    expect(linearFromSrgb(0.5)).toBeCloseTo(0.214_041, 5);
    expect(linearFromSrgb(0.04)).toBeCloseTo(0.04 / 12.92, 12);
  });
});

describe('a lot is painted unlike the lots a rider sees beside it — #1581', () => {
  // Since #1588 a channel also carries the cladding: the entry is what the rule is about.
  const wall = (packed: number): number => lotPaintEntry(packed, 'wall');
  const roof = (packed: number): number => lotPaintEntry(packed, 'roof');

  it('differs in wall and roof from the next lot either side, across the road, and diagonally across', () => {
    let pairs = 0;
    for (const seed of [0, 1, 7, 0x7fff_ffff, 0xdead_beef]) {
      for (let plot = -50; plot < 200; plot += 1) {
        for (const side of [1, -1] as const) {
          const here = lotPaint(seed, plot, side, true);
          expect(wall(here)).toBeGreaterThanOrEqual(0);
          expect(wall(here)).toBeLessThan(LOT_PAINTS);
          expect(roof(here)).toBeGreaterThanOrEqual(0);
          expect(roof(here)).toBeLessThan(LOT_PAINTS);
          const other = side === 1 ? -1 : 1;
          for (const [nextPlot, nextSide] of [
            [plot + 1, side],
            [plot, other],
            [plot + 1, other],
            [plot - 1, other],
          ] as const) {
            const there = lotPaint(seed, nextPlot, nextSide, true);
            expect(wall(there)).not.toBe(wall(here));
            expect(roof(there)).not.toBe(roof(here));
            pairs += 1;
          }
        }
      }
    }
    expect(pairs).toBe(5 * 250 * 2 * 4);
  });

  it('control: two plots apart on one side the colouring does not claim to differ, and does not always', () => {
    // The rule is about the five lots beside one, not every lot: two along on
    // the same side differ in wall by 2 mod 5 — a difference, by arithmetic,
    // but the roof by 4 — and two along ACROSS the road come back to the same wall.
    expect(wall(lotPaint(3, 10, 1))).toBe(wall(lotPaint(3, 8, -1)));
  });

  it('carries nought — no paint — for an item no lot rule painted', () => {
    expect(lotPaintChannel(undefined, 'wall')).toBe(0);
    expect(lotPaintChannel(undefined, 'roof')).toBe(0);
    expect(lotPaintChannel(lotPaint(0, 0, 1), 'wall')).toBeGreaterThan(0);
  });
});

describe('the US house’s paints — #1588', () => {
  it('sells asphalt shingles in greys, browns and greens, as dark as asphalt granules are', () => {
    let greys = 0;
    let browns = 0;
    let greens = 0;
    for (const [r, g, b] of SHINGLE_PAINTS) {
      for (const channel of [r, g, b]) {
        expect(channel).toBeGreaterThanOrEqual(PAINT_LIMITS.albedoLowest);
        expect(channel).toBeLessThan(0.2);
      }
      if (Math.max(r, g, b) - Math.min(r, g, b) < 0.012) greys += 1;
      else if (r > g && g > b) browns += 1;
      else if (g > r && g > b) greens += 1;
    }
    expect(greys).toBeGreaterThanOrEqual(2);
    expect(browns).toBeGreaterThanOrEqual(2);
    expect(greens).toBeGreaterThanOrEqual(2);
    expect(SHINGLE_PAINTS.length).toBeGreaterThanOrEqual(LOT_PAINTS);
  });

  it('gives a shingled roof the shingles’ list, and any other its surface’s', () => {
    expect(roofPaintsOf('slate', true)).toBe(SHINGLE_PAINTS);
    expect(roofPaintsOf('slate', false)).toBe(ROOF_PAINTS.slate);
    expect(roofPaintsOf('roof-tiles', false)).toBe(ROOF_PAINTS['roof-tiles']);
  });

  it('sides a lot in the house paints, the first five of render’s', () => {
    expect(lotSidingPaints()).toStrictEqual((WALL_PAINTS.render ?? []).slice(0, LOT_PAINTS));
  });

  it('clads most house lots in clapboard and under shingles, and never a shop', () => {
    let houses = 0;
    let clapboard = 0;
    let shingled = 0;
    for (const seed of [0, 7, 0xdead_beef]) {
      for (let plot = 0; plot < 300; plot += 1) {
        for (const side of [1, -1] as const) {
          const house = lotPaint(seed, plot, side, true);
          houses += 1;
          if (lotClad(house, 'wall')) clapboard += 1;
          if (lotClad(house, 'roof')) shingled += 1;
          // The entry is still the colouring's, under the cladding.
          expect(lotPaintEntry(house, 'wall')).toBe(
            lotPaintEntry(lotPaint(seed, plot, side), 'wall'),
          );
          expect(lotPaintEntry(house, 'wall')).toBeLessThan(LOT_PAINTS);
          expect(lotPaintChannel(house, 'wall')).toBeLessThanOrEqual(LOT_PAINTS + LOT_CLAD_STEP);
          // A shop is never clad.
          const shop = lotPaint(seed, plot, side, false);
          expect(lotClad(shop, 'wall')).toBe(false);
          expect(lotClad(shop, 'roof')).toBe(false);
        }
      }
    }
    expect(clapboard / houses).toBeGreaterThan(SIDING_SHARE - 0.05);
    expect(clapboard / houses).toBeLessThan(SIDING_SHARE + 0.05);
    expect(shingled / houses).toBeGreaterThan(SHINGLE_SHARE - 0.05);
    expect(shingled / houses).toBeLessThan(SHINGLE_SHARE + 0.05);
    expect(lotClad(undefined, 'wall')).toBe(false);
    expect(lotPaintEntry(undefined, 'roof')).toBe(-1);
  });
});

describe('a paint as a house model wears it — #1585', () => {
  const luma = ([r, g, b]: readonly [number, number, number]): number =>
    0.2126 * r + 0.7152 * g + 0.0722 * b;

  it('leaves the photograph alone where the paint is the photograph', () => {
    expect(modelPaint([1, 1, 1])).toEqual([1, 1, 1]);
  });

  it('moves a third of the way, the strength the owner is shown', () => {
    expect(MODEL_PAINT_STRENGTH).toBe(0.35);
    // Sage, worn: greener than the photograph, never sage itself.
    const [red, green] = modelPaint([0.55, 0.65, 0.47]);
    expect(green).toBeGreaterThan(red);
    expect(green).toBeLessThan(1.1);
  });

  it('keeps the picture’s brightness and moves only its hue, by MODEL_PAINT_STRENGTH', () => {
    for (const paint of WALL_PAINTS.render ?? []) {
      const worn = modelPaint(paint);
      expect(luma(worn)).toBeCloseTo(1, 6);
      // A third of the way from white to the paint's own hue at that brightness.
      const hue = paint.map((channel) => channel / luma(paint));
      worn.forEach((channel, at) => {
        expect(channel).toBeCloseTo(1 + ((hue[at] as number) - 1) * MODEL_PAINT_STRENGTH, 9);
      });
    }
  });

  it('keeps two neighbours `paintTown` painted apart apart, as a model wears them', () => {
    const worn = (WALL_PAINTS.render ?? []).map((paint) => modelPaint(paint).join());
    expect(new Set(worn).size).toBe(worn.length);
  });
});
