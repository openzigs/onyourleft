// SPDX-License-Identifier: Apache-2.0

/**
 * Stage 1 of the matcher: a **cell-cover prefilter**, as an integer set
 * intersection.
 *
 * A cell cover turns "is this segment anywhere near this ride" into set
 * membership on integers, which is what makes a corpus of a hundred thousand
 * segments affordable at all. `docs/spikes/0001-segment-matching.md` §3
 * measured the fan-out this produces: a corpus a hundred times larger put
 * roughly twice as many candidates into stage 2, because **the survivor count
 * is bounded by the ride's own footprint rather than by the corpus size**.
 *
 * ⚠️ **A plain equirectangular grid, and no dependency.** #65 names H3 v4.5.0
 * and S2 v0.14.0 (both Apache-2.0) as the production choices, and the spike's
 * §10 says to take that dependency *deliberately*, with the issue that needs
 * it. This is not yet that issue: what a cell library would change is the
 * constant in front of stage 1, not the number of survivors stage 2 examines,
 * and `packages/domain` takes no runtime dependency at all today. Swapping the
 * index later is a change to this file and to nothing else — `cellOf` and
 * `cellCover` are the whole surface.
 *
 * ⚠️ **This grid is not equal-area and H3 is.** Cells are `CELL_DEGREES` on a
 * side in latitude and longitude both, so a cell is a rectangle that narrows
 * towards the poles — at 60° N it is half as wide as at the equator. That is
 * harmless here, because the prefilter only ever has to be *conservative*: a
 * cell of the wrong shape admits more candidates to stage 2, never fewer. It
 * is recorded so that nobody reads the fan-out as a claim about a hex grid.
 */

import type { GeographicPosition } from '../quantities';

/**
 * The cell edge, in degrees: **0.01°**, about 1.1 km north–south.
 *
 * ⚠️ **Our own tunable, and #65 requires it to be labelled as one.** No product
 * publishes a cell size and nothing here is parity with anything. The reasoning
 * is a two-sided bound:
 *
 * - **Not smaller.** A cell much under a kilometre makes a 400 m segment's
 *   cover several cells wide, so stage 1 does more set work per segment while
 *   removing candidates that stage 2 would have rejected in one distance
 *   comparison anyway.
 * - **Not larger.** A 10 km cell in a city puts most of a corpus in one cell,
 *   and the prefilter stops filtering — which is the failure mode the fan-out
 *   measurement exists to detect.
 *
 * `docs/spikes/0001-segment-matching.md` §3 reports the survivor count this
 * produces, so the number is measured rather than asserted.
 */
export const CELL_DEGREES = 0.01;

/**
 * A cell id, as a single integer.
 *
 * Packed rather than a `lat,lon` string: the whole point of the stage is an
 * integer set intersection, and a `Set<string>` of `"512,-13"` measures string
 * hashing rather than the index. Latitude is offset by 90 and longitude by 180
 * so both are non-negative before packing, and longitude gets the low bits.
 */
export type CellId = number;

/** Longitude spans 360°, so at 0.01° there are 36 000 columns. One more than that. */
const COLUMNS = 36_001;

/**
 * Cells per degree — the **exact reciprocal** of {@link CELL_DEGREES}.
 *
 * ⚠️ **Multiply by this; never divide by `CELL_DEGREES`.** They are the same
 * arithmetic in real numbers and not in IEEE 754, and the difference is a bug
 * that a grid test caught here:
 *
 * ```
 * (51.51 + 90) / 0.01  === 14150.999999999998  → floor 14150
 * (51.51 + 90) * 100   === 14151               → floor 14151
 * ```
 *
 * `0.01` is not representable, so dividing by it lands a hair under the
 * boundary and floors to the row below. The consequence is not a rounding
 * detail: **row 14151 is never assigned at all**, so two positions a full cell
 * apart share a cell and that row of the grid is silently twice as tall.
 *
 * It is *safe* rather than *correct* — a coarser cell admits more candidates
 * to stage 2, never fewer, so nothing is missed — which is exactly why it would
 * have survived: the fan-out would have been a little worse than it should be
 * and every test of matching behaviour would still pass.
 */
const CELLS_PER_DEGREE = 1 / CELL_DEGREES;

/** The cell containing a position. */
export function cellOf(position: GeographicPosition): CellId {
  const row = Math.floor((position.latitude + 90) * CELLS_PER_DEGREE);
  const column = Math.floor((position.longitude + 180) * CELLS_PER_DEGREE);
  return row * COLUMNS + column;
}

/**
 * Every cell a path passes through, **including the cells between two
 * consecutive positions**.
 *
 * The second half is the part that is easy to leave out and fatal when it is.
 * A ride sampled every 10 s at 30 km/h steps 83 m, but a segment's stored
 * geometry may be far coarser, and two positions a kilometre apart skip every
 * cell between them. A cover that only marked the cells the *vertices* fall in
 * would miss a segment whose middle crosses a cell the ride never sampled
 * inside — a false negative produced by the index rather than by the tolerance,
 * which is the worst kind because no tolerance change fixes it.
 *
 * The interpolation here is **between two recorded positions of the same
 * path, for indexing only**. It produces no coordinate that is stored, timed or
 * reported: ADR 0007 D-2.2 forbids synthesising a point *to decide a crossing*,
 * and nothing here decides anything — stage 2 sees only recorded samples.
 */
export function cellCover(path: readonly GeographicPosition[]): Set<CellId> {
  const cells = new Set<CellId>();
  for (const [index, position] of path.entries()) {
    cells.add(cellOf(position));
    const next = path[index + 1];
    if (next === undefined) {
      continue;
    }
    // How many cells the step could span, in either axis. One sample per
    // half-cell is enough to leave no gap.
    const latitudeSpan = Math.abs(next.latitude - position.latitude) / CELL_DEGREES;
    const longitudeSpan = Math.abs(next.longitude - position.longitude) / CELL_DEGREES;
    const steps = Math.ceil(Math.max(latitudeSpan, longitudeSpan) * 2);
    for (let step = 1; step < steps; step += 1) {
      const fraction = step / steps;
      cells.add(
        cellOf({
          latitude: (position.latitude +
            (next.latitude - position.latitude) * fraction) as GeographicPosition['latitude'],
          longitude: (position.longitude +
            (next.longitude - position.longitude) * fraction) as GeographicPosition['longitude'],
        }),
      );
    }
  }
  return cells;
}

/** Whether two covers share a cell. The stage-1 test, as one set lookup per cell. */
export function coversIntersect(ride: ReadonlySet<CellId>, segment: ReadonlySet<CellId>): boolean {
  // Iterate the SMALLER set. A segment's cover is a handful of cells and a
  // four-hour ride's is thousands, so iterating the ride would do a thousand
  // lookups to answer what two do — and stage 1 runs once per segment in the
  // corpus, which is the loop the whole measurement is about.
  const [small, large] =
    ride.size < segment.size ? ([ride, segment] as const) : ([segment, ride] as const);
  for (const cell of small) {
    if (large.has(cell)) {
      return true;
    }
  }
  return false;
}
