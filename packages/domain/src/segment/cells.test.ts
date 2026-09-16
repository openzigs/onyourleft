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

import {
  degreesBearing,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  unixSeconds,
} from '../quantities';

import {
  CELL_DEGREES,
  cellCover,
  cellOf,
  coversIntersect,
  paddedCellCover,
  PREFILTER_MARGIN_METRES,
} from './cells';
import { GAP_SECONDS, SIMILARITY_METRES } from './match';
import {
  createSegment,
  DEFAULT_ENDPOINT_RADIUS_METRES,
  endpointReachRadius,
  MAXIMUM_ENDPOINT_REACH_METRES,
} from './segment';

import type { GeographicPosition } from '../quantities';

/**
 * Metres per degree of latitude, as a literal.
 *
 * `cells.ts` deliberately derives the same quantity from
 * `EARTH_MEAN_RADIUS_METRES` so the margin cannot come to disagree with the
 * distances `geodesy.ts` reports. This file deliberately does **not**, for the
 * reason {@link A_MILLIMETRE_WEST} is written out rather than recomputed: a
 * test that derives its expectation from the constant under test can only ever
 * agree with it. The two figures agree today — 6 371 008.8 × π/180 is
 * 111 194.93 — and the day `EARTH_MEAN_RADIUS_METRES` is revised this is the
 * number that says by how much.
 */
const METRES_PER_DEGREE_LATITUDE = 111_194.9;

/**
 * Metres between samples at the slowest smart-recording interval in common use:
 * 10 s at 30 km/h. Half of it is what `endpointReachRadius` adds to a segment's
 * own radius, which is the wider of the two gates the margin has to clear.
 */
const WIDEST_SAMPLE_SPACING_METRES = 83;

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
    expect(PREFILTER_MARGIN_METRES).toBeGreaterThan(
      DEFAULT_ENDPOINT_RADIUS_METRES + WIDEST_SAMPLE_SPACING_METRES / 2,
    );
  });

  it('pads far enough to cover the WIDEST gate stage 2 can apply, not only the default one', () => {
    // #304. The assertion above is about the two tolerances at their defaults,
    // which is the one configuration the problem is defined by not being: the
    // endpoint radius is a per-segment field and the spacing term is a property
    // of the recording, so neither is the default in general. This is the same
    // relationship stated over the whole range instead — every gate
    // `endpointReachRadius` can now return is at most this margin, so stage 1
    // cannot reject a pair stage 2 would have reported, for ANY segment and ANY
    // ride.
    expect(PREFILTER_MARGIN_METRES).toBeGreaterThanOrEqual(MAXIMUM_ENDPOINT_REACH_METRES);
  });

  it('leaves the ceiling room for the coarsest recording the matcher calls recording', () => {
    // #304's other direction, and the reason `MAXIMUM_ENDPOINT_REACH_METRES` is
    // 100 rather than whatever the margin happens to be. A sample interval up
    // to GAP_SECONDS is recording rather than a hole, so the ceiling has to
    // cover the default radius plus half the spacing such an interval produces
    // at the 30 km/h this package derives its other segment constants at. That
    // makes GAP_SECONDS an input to this file: raising it past the point where
    // the ceiling stops covering it is a red test here, which is where somebody
    // tuning it finds out.
    const referenceSpeedMetresPerSecond = 30_000 / 3600;
    expect(MAXIMUM_ENDPOINT_REACH_METRES).toBeGreaterThanOrEqual(
      DEFAULT_ENDPOINT_RADIUS_METRES + (GAP_SECONDS * referenceSpeedMetresPerSecond) / 2,
    );
  });
});

describe('the widest gate stage 2 can now reach, against stage 1 (#304)', () => {
  /**
   * The widest reach the pipeline can produce, taken from the function that
   * produces it rather than written down: the widest radius `createSegment`
   * will build, against a ride sampled far more sparsely than any recorder
   * makes.
   *
   * ⚠️ **Derived on purpose.** Every probe below is placed at this distance, so
   * raising the ceiling — or deleting the cap inside `endpointReachRadius` —
   * moves the probes rather than leaving them where the fix put them.
   */
  const WIDEST_REACH = endpointReachRadius(
    {
      position: at(51.5, -0.12),
      bearing: degreesBearing(0),
      radius: metres(MAXIMUM_ENDPOINT_REACH_METRES),
    },
    metres(40_000),
  );

  /**
   * How far past the margin a cell line is placed: **one metre**.
   *
   * The cells are 1.1 km and the margin is 100 m, so a probe only leaves the
   * padded cover when a cell line falls between the margin and the probe. This
   * band is what puts one there. A mutation smaller than the band — a ceiling
   * of 101 — slips through this case and is caught by the constants assertion
   * above instead; the two are complementary and neither is the other's
   * superset.
   */
  const BAND_METRES = 1;

  /** A degree of longitude at 51.5°, in metres. */
  const METRES_PER_DEGREE_LONGITUDE = METRES_PER_DEGREE_LATITUDE * Math.cos((51.5 * Math.PI) / 180);

  /**
   * A segment whose start sits `PREFILTER_MARGIN_METRES + BAND_METRES` north of
   * a row line and the same distance east of a column line, built at the widest
   * endpoint radius `createSegment` admits, running due north away from both.
   */
  function segmentAboveTheLines(): ReturnType<typeof createSegment> {
    const latitude = 51.5 + (PREFILTER_MARGIN_METRES + BAND_METRES) / METRES_PER_DEGREE_LATITUDE;
    const longitude = -0.12 + (PREFILTER_MARGIN_METRES + BAND_METRES) / METRES_PER_DEGREE_LONGITUDE;
    return createSegment({
      id: 'segment-widest',
      createdBy: 'athlete-a',
      name: 'The long drag',
      sport: 'ride',
      geometry: Array.from({ length: 26 }, (_unused, index) =>
        at(latitude + (index * 20) / METRES_PER_DEGREE_LATITUDE, longitude),
      ),
      elevationSource: 'none',
      visibility: 'private',
      createdAt: unixSeconds(1_760_000_000),
      endpointRadiusMetres: MAXIMUM_ENDPOINT_REACH_METRES,
    });
  }

  it('admits a ride sample at the widest reach south of the start endpoint', () => {
    // The #304 case, constructed: a segment at the widest radius the model
    // admits, and a ride sample as far from its start endpoint as stage 2 can
    // now reach. Stage 2 would consider that sample, so stage 1 must hand it
    // over — and a row line one metre past the margin is what makes this a real
    // question rather than an artefact of a 1.1 km cell.
    const segment = segmentAboveTheLines();
    const corpus = paddedCellCover(segment.geometry);
    const atTheReach = at(
      segment.start.position.latitude - WIDEST_REACH / METRES_PER_DEGREE_LATITUDE,
      segment.start.position.longitude,
    );

    expect(coversIntersect(cellCover([atTheReach]), corpus)).toBe(true);
  });

  it('admits a ride sample at the widest reach west of the start endpoint', () => {
    // The same case on the other axis, because the two are separate arithmetic
    // — `marginDegreesLongitude` divides by a cosine and the latitude margin
    // does not, so a test of one says nothing about the other.
    const segment = segmentAboveTheLines();
    const corpus = paddedCellCover(segment.geometry);
    const atTheReach = at(
      segment.start.position.latitude,
      segment.start.position.longitude - WIDEST_REACH / METRES_PER_DEGREE_LONGITUDE,
    );

    expect(coversIntersect(cellCover([atTheReach]), corpus)).toBe(true);
  });

  it('stops just past the margin, which is what makes the two cases above cases', () => {
    // The control. Without it a cover that reached a kilometre in every
    // direction — or a probe placed nowhere near a line — would satisfy both
    // assertions above while saying nothing, which is the shape this file's own
    // header warns about. Two metres past the margin is over the line and out.
    const segment = segmentAboveTheLines();
    const corpus = paddedCellCover(segment.geometry);
    const pastTheMargin = at(
      segment.start.position.latitude -
        (PREFILTER_MARGIN_METRES + 2 * BAND_METRES) / METRES_PER_DEGREE_LATITUDE,
      segment.start.position.longitude,
    );
    const pastTheMarginWest = at(
      segment.start.position.latitude,
      segment.start.position.longitude -
        (PREFILTER_MARGIN_METRES + 2 * BAND_METRES) / METRES_PER_DEGREE_LONGITUDE,
    );

    expect(coversIntersect(cellCover([pastTheMargin]), corpus)).toBe(false);
    expect(coversIntersect(cellCover([pastTheMarginWest]), corpus)).toBe(false);
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

  it('reaches across a line 50 m away and not one 200 m away, in both directions', () => {
    // The margin is a distance, so it has to be testable as one. A row line
    // runs along 51.50; the cell south of it is the one a point just north of
    // the line must still claim, and a point 200 m north must not.
    //
    // ⚠️ **Both directions, and the second half is not decoration.** A padded
    // cover probes a margin either side of a position and the two sides are
    // separate arithmetic, so a test of one says nothing about the other. The
    // northward half shipped unpinned in the first round of this change:
    // `highRow` could be flattened to `rowOf(position.latitude)` with the whole
    // 5 036-test suite still green, because every other case that looks like it
    // covers the latitude axis either probes north for the cell south, or sits
    // exactly on 51.5 where the padded row and the bare row are the same row.
    // The failure that would let back in is the #291 one with the axes swapped:
    // a segment point just south of a row line, a ride sample just north of it,
    // covers disjoint, nothing downstream ever runs.
    const southOfTheLine = cellOf(at(51.5 - CELL_DEGREES / 2, -0.125));
    const fiftyMetresNorth = at(51.5 + 50 / METRES_PER_DEGREE_LATITUDE, -0.125);
    const twoHundredNorth = at(51.5 + 200 / METRES_PER_DEGREE_LATITUDE, -0.125);

    expect(paddedCellCover([fiftyMetresNorth]).has(southOfTheLine)).toBe(true);
    expect(paddedCellCover([twoHundredNorth]).has(southOfTheLine)).toBe(false);

    const northOfTheLine = cellOf(at(51.5 + CELL_DEGREES / 2, -0.125));
    const fiftyMetresSouth = at(51.5 - 50 / METRES_PER_DEGREE_LATITUDE, -0.125);
    const twoHundredSouth = at(51.5 - 200 / METRES_PER_DEGREE_LATITUDE, -0.125);

    expect(paddedCellCover([fiftyMetresSouth]).has(northOfTheLine)).toBe(true);
    expect(paddedCellCover([twoHundredSouth]).has(northOfTheLine)).toBe(false);
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

  it('does not let a margin off the east edge pack into the row above', () => {
    // The mirror of the case above, and it was unpinned in the first round of
    // this change: `columnOf`'s upper clamp could be deleted with the whole
    // domain segment suite still green. The two edges are separate arithmetic
    // and a test of one says nothing about the other — the same shape as the
    // latitude margin's two directions.
    //
    // It binds only where the longitude margin is a whole cell, which is above
    // about 84.8° — `(180 + 0.01 + 180) * 100` is 36 001, one past the last
    // column. Unclamped that id is `row * COLUMNS + COLUMNS`, which is column 0
    // of the row above: latitude 85.01 at longitude −180, a real cell on the
    // far side of the world that a hundred metres of padding has no business
    // claiming.
    const eastEdge = paddedCellCover([at(85, 180)]);

    expect(eastEdge.has(cellOf(at(85.01, -180)))).toBe(false);
    expect(eastEdge.has(cellOf(at(85, 180)))).toBe(true);
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
