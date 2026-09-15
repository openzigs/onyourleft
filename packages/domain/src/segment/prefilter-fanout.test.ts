// SPDX-License-Identifier: Apache-2.0

/**
 * The fan-out #291's first acceptance criterion asks to be re-measured.
 *
 * `docs/spikes/0001-segment-matching.md` §3 reported how many candidates stage
 * 1 passes to stage 2, and that measurement **rests on an unpadded cover**.
 * Padding changes it, so the number has to be taken again rather than argued
 * about — and a spike is never edited, so the result is written up as
 * `docs/spikes/0003-segment-prefilter-margin.md` and reproduced here.
 *
 * ## Why this is a test and not a script
 *
 * The spike's `pnpm --filter @onyourleft/matching run spike:measure` went with
 * `packages/matching`, and §3's other column — milliseconds — is a timing
 * measurement that does not belong in a gate. **The fan-out is not a timing
 * measurement.** How many segments' covers meet a ride's is a pure function of
 * the corpus and the ride: no clock, no randomness, the same answer on every
 * machine. So the part of §3 the decision actually rests on is asserted here,
 * where a future change to `CELL_DEGREES` or {@link PREFILTER_MARGIN_METRES}
 * moves it in front of a reviewer instead of moving quietly.
 *
 * ⚠️ **This is a new measurement, not a re-run of the spike's.** The generator
 * below is this file's own and the absolute counts are not comparable with
 * §3's. What carries across is the shape of the result.
 *
 * ⚠️ **The bounds asserted here are deliberately looser than the numbers
 * measured.** The exact counts belong in the write-up, where they are dated;
 * pinning them here would make every future change to this generator read as a
 * regression in the prefilter.
 */

import { describe, expect, it } from 'vitest';

import { degreesLatitude, degreesLongitude, geographicPosition } from '../quantities';

import { cellCover, coversIntersect, paddedCellCover, PREFILTER_MARGIN_METRES } from './cells';

import type { GeographicPosition } from '../quantities';

const METRES_PER_DEGREE_LATITUDE = 111_194.9;
const ORIGIN_LATITUDE = 51.4;
const ORIGIN_LONGITUDE = -0.2;
const METRES_PER_DEGREE_LONGITUDE =
  METRES_PER_DEGREE_LATITUDE * Math.cos((ORIGIN_LATITUDE * Math.PI) / 180);

/** One column of the grid, in metres. Used to size the halo the decision rejected. */
const CELL_METRES = 1_100;

/** A position `north` and `east` metres from the city's south-west corner. */
function at(north: number, east: number): GeographicPosition {
  return geographicPosition(
    degreesLatitude(ORIGIN_LATITUDE + north / METRES_PER_DEGREE_LATITUDE),
    degreesLongitude(ORIGIN_LONGITUDE + east / METRES_PER_DEGREE_LONGITUDE),
  );
}

/**
 * A deterministic offset in [−300, 300] metres, from an integer.
 *
 * ⚠️ **Not a random number, and the difference matters twice.** `Math.random`
 * would make the measurement unreproducible, and `packages/physics` bans it
 * outright for the same reason. It also would not be *needed*: what this is for
 * is knocking the corpus off the lattice, because a corpus laid out on an exact
 * grid is the one arrangement where padding a cover adds **no** candidates at
 * all — every segment already shares a cell with the ride or is a clean cell
 * away from it. Measured on the exact lattice the padding looked free; it is
 * not, and this is what stops the measurement flattering it.
 */
function jitter(seed: number): number {
  return ((seed * 2_654_435_761) % 601) - 300;
}

/**
 * A uniform street grid of `count` northbound 500 m segments, 26 points each.
 *
 * Streets 200 m apart east to west, segments 600 m apart along each, each
 * knocked off the lattice by {@link jitter}. The city grows with the corpus, so
 * density is constant — which is the arrangement the spike's headline is about.
 *
 * Uniform rather than clustered, with the caveat the spike attached to its own:
 * real riding concentrates on a few corridors, so a real corpus is *more*
 * clustered and stage 1 would pass through more. A lower bound on difficulty in
 * every column, which is what makes the ratio between them the honest number.
 */
function cityOf(count: number): GeographicPosition[][] {
  const side = Math.ceil(Math.sqrt(count));
  const segments: GeographicPosition[][] = [];
  for (let street = 0; street < side && segments.length < count; street += 1) {
    for (let along = 0; along < side && segments.length < count; along += 1) {
      const east = street * 200 + jitter(street * 31 + along * 7);
      const south = along * 600 + jitter(street * 97 + along);
      segments.push(Array.from({ length: 26 }, (_unused, index) => at(south + index * 20, east)));
    }
  }
  return segments;
}

/**
 * 14 400 samples — four hours at 1 Hz — walking `legs` in turn, 120 km in all.
 *
 * Each leg is a direction and a length in metres, so a ride's *shape* is a
 * parameter. That is not decoration: stage 1's survivor count is a property of
 * the ride's footprint, so a measurement taken on one shape is a measurement of
 * that shape.
 */
function fourHours(legs: readonly (readonly [number, number, number])[]): GeographicPosition[] {
  const samples: GeographicPosition[] = [];
  const step = 120_000 / 14_400;
  let north = 0;
  let east = 0;
  let leg = 0;
  let along = 0;
  for (let sample = 0; sample < 14_400; sample += 1) {
    samples.push(at(north, east));
    const [northward, eastward, length] = legs[leg % legs.length] ?? [0, 0, 1];
    north += northward * step;
    east += eastward * step;
    along += step;
    if (along >= length) {
      along = 0;
      leg += 1;
    }
  }
  return samples;
}

/** Up and down one 12 km road: about the smallest footprint 120 km can have. */
function hillRepeats(): GeographicPosition[] {
  return fourHours([
    [1, 0, 12_000],
    [0, 1, 200],
    [-1, 0, 12_000],
    [0, 1, 200],
  ]);
}

/** A 30 km-sided circuit: a four-hour ride that covers ground instead. */
function bigLoop(): GeographicPosition[] {
  return fourHours([
    [1, 0, 30_000],
    [0, 1, 30_000],
    [-1, 0, 30_000],
    [0, -1, 30_000],
  ]);
}

/** How many segments of `city` reach stage 2, with each kind of cover. */
function fanOut(city: readonly GeographicPosition[][], ride: ReadonlySet<number>) {
  return {
    corpus: city.length,
    unpadded: city.filter((segment) => coversIntersect(ride, cellCover(segment))).length,
    padded: city.filter((segment) => coversIntersect(ride, paddedCellCover(segment))).length,
  };
}

describe('the fan-out the padding changes (#291)', () => {
  it('is still bounded by the ride’s footprint rather than by the corpus size', () => {
    // Spike 0001 §3's headline, re-established on the padded index: a corpus a
    // hundred times larger puts the same candidates into stage 2, because the
    // prefilter is limited by how much ground the ride covers. A padding that
    // broke this is the one result that would change the decision, because it
    // is what makes 100 000 segments viable at all.
    const ride = cellCover(hillRepeats());
    const small = fanOut(cityOf(1_000), ride);
    const large = fanOut(cityOf(100_000), ride);

    expect(large.corpus).toBe(100 * small.corpus);
    expect(large.padded).toBeLessThanOrEqual(small.padded * 1.1);
  });

  it('adds well under a quarter to what reaches stage 2', () => {
    // The number the decision rests on, and the reason this is a margin rather
    // than the halo #291 proposed: 100 m of dilation buys the correctness for
    // a small, bounded share of the candidates.
    const ride = cellCover(bigLoop());
    const { unpadded, padded } = fanOut(cityOf(10_000), ride);

    expect(padded).toBeGreaterThan(unpadded);
    expect(padded).toBeLessThan(unpadded * 1.25);
  });

  it('adds far less than haloing the cover by a whole cell would', () => {
    // The counterfactual, measured rather than asserted — otherwise "a halo
    // costs much more" is a claim this repository has no evidence for, and a
    // halo is what #291 proposed.
    const ride = cellCover(bigLoop());
    const city = cityOf(10_000);
    const { unpadded, padded } = fanOut(city, ride);
    const haloed = city.filter((segment) =>
      coversIntersect(ride, haloed9Of(cellCover(segment))),
    ).length;

    expect(haloed).toBeGreaterThan(unpadded * 1.5);
    expect(padded - unpadded).toBeLessThan((haloed - unpadded) / 3);
  });

  it('keeps a segment’s index small enough to hold a hundred thousand of them', () => {
    // The cost paid at segment creation rather than per ride. A halo multiplies
    // a cover by nine; the margin takes a 500 m segment from about one and a
    // half cells to about two.
    const city = cityOf(1_000);
    const unpadded = city.reduce((total, segment) => total + cellCover(segment).size, 0);
    const padded = city.reduce((total, segment) => total + paddedCellCover(segment).size, 0);

    expect(padded / unpadded).toBeLessThan(2);
    // And the margin is what sets that ratio: a wider one would not fit here.
    expect(PREFILTER_MARGIN_METRES).toBeLessThan(CELL_METRES / 4);
  });
});

/**
 * Every cell of a cover plus its eight neighbours — the halo #291 proposed, for
 * the comparison above and nowhere else.
 *
 * Deliberately here rather than as a margin parameter on `cells.ts`: the
 * production surface has exactly one margin and #291's decision is that it
 * stays that way. A test reaching for a knob the product does not have is
 * measuring something the product cannot do.
 */
function haloed9Of(cover: ReadonlySet<number>): Set<number> {
  const columns = 36_001;
  const haloed = new Set<number>();
  for (const cell of cover) {
    const row = Math.floor(cell / columns);
    const column = cell % columns;
    for (let rowStep = -1; rowStep <= 1; rowStep += 1) {
      for (let columnStep = -1; columnStep <= 1; columnStep += 1) {
        haloed.add((row + rowStep) * columns + (column + columnStep));
      }
    }
  }
  return haloed;
}
