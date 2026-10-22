// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1581: what a realistic building is painted — `building-paint.ts`' lists
 * held to their bounds, and the lots' colouring held to "unlike the lots a
 * rider sees beside it" for every plot and seed, with its control.
 */

import { describe, expect, it } from 'vitest';

import {
  DOOR_PAINTS,
  linearFromSrgb,
  LOT_PAINTS,
  lotPaint,
  lotPaintChannel,
  PAINT_LIMITS,
  paintChannelOf,
  paintsOf,
  ROOF_PAINTS,
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
    for (const list of [TRIM_PAINTS, DOOR_PAINTS]) {
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
  const wall = (packed: number): number => lotPaintChannel(packed, 'wall') - 1;
  const roof = (packed: number): number => lotPaintChannel(packed, 'roof') - 1;

  it('differs in wall and roof from the next lot either side, across the road, and diagonally across', () => {
    let pairs = 0;
    for (const seed of [0, 1, 7, 0x7fff_ffff, 0xdead_beef]) {
      for (let plot = -50; plot < 200; plot += 1) {
        for (const side of [1, -1] as const) {
          const here = lotPaint(seed, plot, side);
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
            const there = lotPaint(seed, nextPlot, nextSide);
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
