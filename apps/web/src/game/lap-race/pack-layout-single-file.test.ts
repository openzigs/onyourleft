// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The pack layout in single file — #3304: a group ride's line, a row to each
 * racer, with the one who has pulled off beside it. `pack-layout.test.ts`
 * holds a race's pack, which this flag must leave exactly as it was;
 * `group-ride/line-drawing.test.ts` reads the line through a whole rotation.
 */

import { describe, expect, it } from 'vitest';

import {
  BIKE_LENGTH_METRES,
  LINE_CLEAR_METRES,
  LINE_PASS_METRES,
  NO_PACK_LAYOUT,
  PACK_ABREAST_METRES,
  stepPackLayout,
  type PackLayout,
  type PackRacer,
} from './pack-layout';

const RIDER = 'rider';
const SPEED = 8;

const racer = (id: string, along: number, more: Partial<PackRacer> = {}): PackRacer => ({
  id,
  along,
  lateral: 0,
  speed: SPEED,
  ...more,
});

/** The layout a field goes straight to, in single file. */
const laid = (field: readonly PackRacer[], previous: PackLayout = NO_PACK_LAYOUT): PackLayout =>
  stepPackLayout(field, RIDER, previous, 0, undefined, true);

/** How far ahead of the rider's row each bot was laid out, by id. */
const rowsOf = (layout: PackLayout): Record<string, number> =>
  Object.fromEntries([...layout].map(([id, place]) => [id, place.rowShift]));

/** A line on held wheels: two bots ahead of the rider and one behind. */
const HELD = [racer('a', 101.3), racer('b', 100.65), racer(RIDER, 100), racer('c', 99.35)];

describe('a line in single file', () => {
  it('lays a row to each racer, a bike length a row, all in their own lane', () => {
    const layout = laid(HELD);
    expect(rowsOf(layout)).toStrictEqual({
      a: 2 * BIKE_LENGTH_METRES,
      b: BIKE_LENGTH_METRES,
      c: -BIKE_LENGTH_METRES,
    });
    for (const place of layout.values()) {
      expect(place.shift).toBe(place.rowShift);
      expect(place.lateral).toBe(0);
    }
  });

  it('is a race’s pack, abreast in the rider’s row, without the flag', () => {
    const pack = rowsOf(stepPackLayout(HELD, RIDER, NO_PACK_LAYOUT, 0));
    expect(pack['a']).toBe(0);
    expect(pack['b']).toBe(0);
  });

  it('leaves a race’s layout as it was for a racer marked beside: only a line reads the mark', () => {
    const marked = HELD.map((each) => (each.id === 'a' ? { ...each, beside: true } : each));
    let plain: PackLayout = NO_PACK_LAYOUT;
    let withMark: PackLayout = NO_PACK_LAYOUT;
    for (let tick = 0; tick < 20; tick += 1) {
      plain = stepPackLayout(HELD, RIDER, plain, 0.05);
      withMark = stepPackLayout(marked, RIDER, withMark, 0.05);
    }
    expect([...withMark]).toStrictEqual([...plain]);
  });

  it('keeps two in the order they were drawn until one is a wheel gap past the other', () => {
    const before = laid(HELD);
    const justOver = HELD.map((each) =>
      each.id === RIDER ? racer(RIDER, 100.65 + LINE_PASS_METRES - 0.01) : each,
    );
    expect(rowsOf(laid(justOver, before))['b']).toBe(BIKE_LENGTH_METRES);
    const past = HELD.map((each) =>
      each.id === RIDER ? racer(RIDER, 100.65 + LINE_PASS_METRES + 0.01) : each,
    );
    expect(rowsOf(laid(past, before))).toStrictEqual({
      a: BIKE_LENGTH_METRES,
      b: -BIKE_LENGTH_METRES,
      c: -2 * BIKE_LENGTH_METRES,
    });
    // With no drawing before, the road's order is all there is.
    expect(rowsOf(laid(justOver))['b']).toBe(-BIKE_LENGTH_METRES);
  });

  it('puts the rider behind a bot they are level with', () => {
    expect(rowsOf(laid([racer(RIDER, 100), racer('a', 100)]))).toStrictEqual({
      a: BIKE_LENGTH_METRES,
    });
  });

  it('lays a bot the rider has ridden over a place beside them, and back in line once they are clear', () => {
    const before = laid(HELD);
    const over = HELD.map((each) => (each.id === RIDER ? racer(RIDER, 100.9) : each));
    const beside = laid(over, before).get('b');
    expect(Math.abs(beside?.aim ?? 0)).toBe(PACK_ABREAST_METRES);
    expect(laid(HELD, before).get('b')?.aim).toBe(0);
  });

  it('moves a bot of a line that is barely moving, where a race’s grid holds its places', () => {
    // The front pulls off while the line waits for its rider, at walking pace.
    const slow = HELD.map((each) => ({ ...each, speed: 1 }));
    const pulled = slow.map((each) =>
      each.id === 'a' ? { ...each, lateral: -1.75, beside: true } : each,
    );
    const line = stepPackLayout(pulled, RIDER, laid(slow), 0.5, undefined, true);
    expect(line.get('a')?.lateral).toBeLessThan(0);
    const grid = stepPackLayout(slow, RIDER, NO_PACK_LAYOUT, 0);
    expect(stepPackLayout(pulled, RIDER, grid, 0.5).get('a')?.lateral).toBe(grid.get('a')?.lateral);
  });
});

describe('a racer beside the line', () => {
  const beside = (along: number): PackRacer => racer('d', along, { lateral: -1.75, beside: true });
  const rowOf = (along: number): number => rowsOf(laid([...HELD, beside(along)]))['d'] as number;

  it('is no row: the line is laid out as it is without them', () => {
    const line = rowsOf(laid([...HELD, beside(100.3)]));
    expect(line).toStrictEqual({ ...rowsOf(laid(HELD)), d: line['d'] });
  });

  it('is drawn level with the racer it is level with, and between two as far as it is between them', () => {
    expect(rowOf(100.65)).toBeCloseTo(BIKE_LENGTH_METRES, 9);
    expect(rowOf(100)).toBeCloseTo(0, 9);
    // Half-way between b and the rider on the road: half a row behind b.
    expect(rowOf(100.325)).toBeCloseTo(BIKE_LENGTH_METRES / 2, 9);
    // A quarter of the way from the rider to c.
    expect(rowOf(100 - 0.65 / 4)).toBeCloseTo(-BIKE_LENGTH_METRES / 4, 9);
  });

  it('is a whole row clear of the front, and of the last wheel, once it is clear of it on the road', () => {
    const front = 2 * BIKE_LENGTH_METRES;
    expect(rowOf(101.3 + LINE_CLEAR_METRES)).toBeCloseTo(front + BIKE_LENGTH_METRES, 9);
    expect(rowOf(101.3 + 5)).toBeCloseTo(front + BIKE_LENGTH_METRES, 9);
    expect(rowOf(101.3 + LINE_CLEAR_METRES / 2)).toBeCloseTo(front + BIKE_LENGTH_METRES / 2, 9);
    const last = -BIKE_LENGTH_METRES;
    expect(rowOf(99.35 - LINE_CLEAR_METRES)).toBeCloseTo(last - BIKE_LENGTH_METRES, 9);
    expect(rowOf(99.35 - 5)).toBeCloseTo(last - BIKE_LENGTH_METRES, 9);
    expect(rowOf(99.35 - LINE_CLEAR_METRES / 2)).toBeCloseTo(last - BIKE_LENGTH_METRES / 2, 9);
  });

  it('keeps the place across it was handed', () => {
    expect(laid([...HELD, beside(100.3)]).get('d')?.lateral).toBe(-1.75);
  });

  it('when it is the rider, lays the line out about them and never gives the rider a place', () => {
    const bots = [racer('a', 101.3), racer('b', 100.65), racer('c', 100)];
    const aside = (along: number): Record<string, number> => {
      const layout = laid([...bots, racer(RIDER, along, { lateral: -1.75, beside: true })]);
      expect(layout.has(RIDER)).toBe(false);
      return rowsOf(layout);
    };
    // Level with b: b in the rider's row, a a row ahead, c a row behind.
    const level = aside(100.65);
    expect(level['a']).toBeCloseTo(BIKE_LENGTH_METRES, 9);
    expect(level['b']).toBeCloseTo(0, 9);
    expect(level['c']).toBeCloseTo(-BIKE_LENGTH_METRES, 9);
    // Half-way back to c: the whole line half a row further on.
    const half = aside(100.325);
    expect(half['a']).toBeCloseTo(1.5 * BIKE_LENGTH_METRES, 9);
    expect(half['b']).toBeCloseTo(0.5 * BIKE_LENGTH_METRES, 9);
    expect(half['c']).toBeCloseTo(-0.5 * BIKE_LENGTH_METRES, 9);
    // Clear behind the last wheel: the line a whole row ahead of them, as when they rejoin it.
    const clear = aside(100 - LINE_CLEAR_METRES);
    expect(clear['c']).toBeCloseTo(BIKE_LENGTH_METRES, 9);
    const rejoined = rowsOf(laid([...bots, racer(RIDER, 100 - LINE_CLEAR_METRES)]));
    for (const id of ['a', 'b', 'c']) expect(clear[id]).toBeCloseTo(rejoined[id] as number, 9);
  });
});
