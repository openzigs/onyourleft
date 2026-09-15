// SPDX-License-Identifier: Apache-2.0

/**
 * #291: the prefilter at a cell **boundary**, which is where it was not
 * conservative.
 *
 * `cells.ts` argued the grid was safe because a cell of the wrong *shape*
 * admits more candidates to stage 2, never fewer. True of the shape; false of
 * the edge. An unpadded cover marks only the cells a path's own points fall in,
 * so two paths a millimetre apart across a grid line share no cell and
 * {@link coversIntersect} rejects a perfect traversal — a false negative
 * produced by the index rather than by a tolerance.
 *
 * ⚠️ **Every case here is arranged so that deleting the padding turns it red.**
 * The pair in the first block is the one `@onyourleft/store/testing`'s
 * `segmentFor` produced in #282, with the literal longitudes that issue
 * recorded rather than a coordinate invented to suit the fix.
 */

import { describe, expect, it } from 'vitest';

import { degreesLatitude, degreesLongitude, geographicPosition } from '../quantities';

import {
  CELL_DEGREES,
  cellCover,
  cellOf,
  coversIntersect,
  paddedCellCover,
  PREFILTER_MARGIN_METRES,
} from './cells';
import { SIMILARITY_METRES } from './match';
import { DEFAULT_ENDPOINT_RADIUS_METRES } from './segment';

import type { GeographicPosition } from '../quantities';

const METRES_PER_DEGREE_LATITUDE = 111_194.9;

function at(latitude: number, longitude: number): GeographicPosition {
  return geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude));
}

/** A due-north path of `points` samples, `spacingMetres` apart, at one longitude. */
function northbound(
  latitude: number,
  longitude: number,
  points = 26,
  spacingMetres = 20,
): GeographicPosition[] {
  return Array.from({ length: points }, (_unused, index) =>
    at(latitude + (index * spacingMetres) / METRES_PER_DEGREE_LATITUDE, longitude),
  );
}

/**
 * The longitude `@onyourleft/store/testing`'s `segmentFor` writes: **exactly**
 * a column line on the 0.01° grid, because `(-0.12 + 180) * 100` is 17 988.
 */
const ON_THE_LINE = -0.12;

/**
 * What a stream set round-trip returns for {@link ON_THE_LINE}: about 1.4 mm
 * west of it, and in the column below.
 *
 * The literal from #291, produced by the semicircle grid `packages/store`
 * encodes positions on. Written out rather than recomputed here, so this test
 * cannot drift into agreeing with a re-derivation of its own.
 */
const A_MILLIMETRE_WEST = -0.12000001966953278;

describe('the cell grid, and the boundary it used to split', () => {
  it('puts two positions a millimetre apart in different cells', () => {
    // Not a defect and not fixed: a grid has lines and a line has two sides.
    // Asserted so the rest of this file is known to be testing the case it
    // claims to, rather than two coordinates that happen to agree.
    expect(cellOf(at(51.5, ON_THE_LINE))).not.toBe(cellOf(at(51.5, A_MILLIMETRE_WEST)));
  });

  it('leaves an unpadded pair across that line sharing no cell at all', () => {
    const segment = cellCover(northbound(51.5, ON_THE_LINE));
    const ride = cellCover(northbound(51.5, A_MILLIMETRE_WEST));

    // The #291 defect, stated as the thing the padding exists to prevent. If
    // this ever goes green the case has stopped being a case.
    expect(coversIntersect(ride, segment)).toBe(false);
  });

  it('brings that pair back together once the corpus side is padded', () => {
    const segment = paddedCellCover(northbound(51.5, ON_THE_LINE));
    const ride = cellCover(northbound(51.5, A_MILLIMETRE_WEST));

    expect(coversIntersect(ride, segment)).toBe(true);
  });

  it('pads far enough to cover the tolerances every later stage applies', () => {
    // Stage 3 accepts a traversal deviating by up to SIMILARITY_METRES, and
    // stage 2's gate is the endpoint radius plus half the ride's sample
    // spacing. A margin below either of those would let stage 1 reject a pair
    // a later stage would still have reported — which is the whole bug.
    expect(PREFILTER_MARGIN_METRES).toBeGreaterThan(SIMILARITY_METRES);
    expect(PREFILTER_MARGIN_METRES).toBeGreaterThan(DEFAULT_ENDPOINT_RADIUS_METRES + 83 / 2);
  });
});

describe('what the padding costs, which is the reason it is a margin and not a halo', () => {
  it('adds nothing at all for a path nowhere near a grid line', () => {
    // A margin, not a halo: a one-cell halo would make this nine cells and
    // dilate stage 1's corridor by 1.1 km to fix a millimetre. #291 proposed
    // exactly that and this assertion is what says it was not taken.
    const middle = northbound(51.505, -0.125, 2, 1);

    expect(paddedCellCover(middle)).toEqual(cellCover(middle));
    expect(paddedCellCover(middle).size).toBe(1);
  });

  it('adds at most the cells the margin actually reaches', () => {
    // A single position on a corner touches four cells and never more, because
    // the margin is smaller than a cell in both axes.
    const corner = paddedCellCover([at(51.5, ON_THE_LINE)]);

    expect(corner.size).toBe(4);
  });

  it('reaches across a line 50 m away and not one 200 m away', () => {
    // The margin is a distance, so it has to be testable as one. A row line
    // runs along 51.50; the cell south of it is the one a point just north of
    // the line must still claim, and a point 200 m north must not.
    const southOfTheLine = cellOf(at(51.5 - CELL_DEGREES / 2, -0.125));
    const fiftyMetresNorth = at(51.5 + 50 / METRES_PER_DEGREE_LATITUDE, -0.125);
    const twoHundredNorth = at(51.5 + 200 / METRES_PER_DEGREE_LATITUDE, -0.125);

    expect(paddedCellCover([fiftyMetresNorth]).has(southOfTheLine)).toBe(true);
    expect(paddedCellCover([twoHundredNorth]).has(southOfTheLine)).toBe(false);
  });

  it('widens the longitude margin towards the pole, where a degree is shorter', () => {
    // 100 m is 0.0009° of longitude at the equator and 0.0018° at 60°. A single
    // constant converted once at the equator would under-reach everywhere north
    // of it — by half, at 60° — and the under-reach is invisible: the cover is
    // well-formed and simply narrower than the margin claims.
    const justEastOfTheLine = -0.13 + 0.0012;

    expect(paddedCellCover([at(0.005, justEastOfTheLine)]).size).toBe(1);
    expect(paddedCellCover([at(60.005, justEastOfTheLine)]).size).toBe(2);
  });
});

describe('the grid itself, unchanged by #291', () => {
  it('assigns the row a multiplication gives and not the one a division gives', () => {
    // `cells.ts` §CELLS_PER_DEGREE: (51.51 + 90) / 0.01 floors to 14150 and
    // * 100 floors to 14151. Pinned here because #291 rewrote `cellOf` through
    // `rowOf`, and doing that arithmetic the other way would be invisible.
    expect(cellOf(at(51.51, 0))).not.toBe(cellOf(at(51.5, 0)));
    expect(cellOf(at(51.51, 0))).toBe(cellOf(at(51.519, 0)));
  });

  it('keeps the extremes of the grid inside it', () => {
    // The clamp #291 added to `rowOf`/`columnOf` must not move a real position.
    expect(cellOf(at(90, 180))).toBe(18_000 * 36_001 + 36_000);
    expect(cellOf(at(-90, -180))).toBe(0);
  });

  it('does not let a margin off the west edge pack into the row below', () => {
    // A cell id is `row * COLUMNS + column`, so an unclamped column of −1 is
    // arithmetically identical to column 36 000 one row south — a cell a
    // hundred metres of padding has no business claiming, on the far side of
    // the world. The clamp in `columnOf` is what stops it, and nothing else
    // would: the id is well-formed and the match it produces is a false
    // positive nobody would trace back to here.
    const antimeridian = paddedCellCover([at(51.5, -180)]);

    expect(antimeridian.has(cellOf(at(51.49, 180)))).toBe(false);
    expect(antimeridian.has(cellOf(at(51.5, -180)))).toBe(true);
  });

  it('caps the longitude margin at one cell where a degree of it vanishes', () => {
    // `Math.cos(90°)` is 6.1e-17, not 0. Without the cap the margin at a pole
    // is 1.5e13 degrees, every column in the grid is probed, and one position
    // produces a 72 002-cell cover — which is not a wrong answer so much as a
    // loop that should never have been entered.
    expect(paddedCellCover([at(90, -0.125)]).size).toBe(6);
  });

  it('covers the cells between two positions a kilometre apart', () => {
    // The interpolation `cellCover` documents as fatal to leave out, asserted
    // again because #291 moved it into a shared walk that both covers use.
    const sparse = [at(51.5, -0.12), at(51.53, -0.12)];

    expect(cellCover(sparse).size).toBeGreaterThanOrEqual(4);
    expect(paddedCellCover(sparse).size).toBeGreaterThanOrEqual(cellCover(sparse).size);
  });

  it('answers an empty path with an empty cover', () => {
    expect(cellCover([]).size).toBe(0);
    expect(paddedCellCover([]).size).toBe(0);
  });
});
