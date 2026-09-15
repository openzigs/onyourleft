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
 * index later is a change to this file and to nothing else — `cellOf`,
 * `cellCover` and `paddedCellCover` are the whole surface.
 *
 * ⚠️ **This grid is not equal-area and H3 is.** Cells are `CELL_DEGREES` on a
 * side in latitude and longitude both, so a cell is a rectangle that narrows
 * towards the poles — at 60° N it is half as wide as at the equator. That is
 * harmless here, because the prefilter only ever has to be *conservative*: a
 * cell of the wrong shape admits more candidates to stage 2, never fewer. It
 * is recorded so that nobody reads the fan-out as a claim about a hex grid.
 *
 * ## ⚠️ The cell *shape* was conservative and the cell *boundary* was not (#291)
 *
 * The paragraph above is true of the shape and was **false of the edge**. An
 * unpadded cover marks only the cells a path's own points fall in, so two paths
 * a **millimetre** apart on opposite sides of a cell line share no cell, and
 * {@link coversIntersect} rejects a perfect traversal before stage 2 ever sees
 * it. That is a false negative produced by the index rather than by a
 * tolerance, which is the case {@link cellCover} below calls the worst kind
 * because no tolerance change fixes it — and it was reachable from
 * `@onyourleft/store/testing`'s own segment fixture, whose longitude of
 * `-0.12` is *exactly* a column line on this grid.
 *
 * **The decision (#291): the corpus side of the intersection pads its cover by
 * {@link PREFILTER_MARGIN_METRES}, and the ride side does not.** Set
 * intersection is symmetric, so padding one side is enough, and the corpus side
 * is the cheaper one to pad — a segment's cover is a handful of cells where a
 * four-hour ride's is thousands. `match.ts`'s `indexCorpus` is the only caller
 * that builds a corpus cover, and the only caller of {@link paddedCellCover}.
 *
 * **What was rejected, and why.** #291 proposed a one-cell halo — every cell of
 * the cover plus its eight neighbours. It is simpler, and it dilates the
 * corridor stage 1 admits by a *whole cell*, 1.1 km, to fix a failure measured
 * in millimetres. Measured on 2026-09-15: the halo adds **57–123%** to the
 * candidates reaching stage 2 and takes a 500 m segment's index from 1.45 cells
 * to 10.35; the 100 m margin adds **10–16%** and takes it to 2.11. Roughly a
 * seventh of the cost, for the same correctness.
 *
 * `docs/spikes/0003-segment-prefilter-margin.md` is that measurement written
 * up, because padding changes how many candidates reach stage 2 and spike
 * 0001 §3's number rests on an unpadded cover — and a spike is never edited.
 * `prefilter-fanout.test.ts` is the reproduction, and it is a test rather than
 * a script because a fan-out has no clock in it.
 */

import { EARTH_MEAN_RADIUS_METRES } from '../geodesy';

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

/**
 * How far outside its own footprint a **corpus** cover reaches: **100 metres**.
 *
 * ⚠️ **Our own tunable, and the one that makes stage 1 conservative at a cell
 * line rather than only at a cell's shape.** Nothing publishes a figure to copy
 * and this is not parity with anything; the reasoning is the two-sided bound
 * this file uses for {@link CELL_DEGREES}.
 *
 * - **Not smaller.** The prefilter must not reject a pair a later stage could
 *   still report, so the margin has to clear every tolerance downstream of it.
 *   Stage 3 accepts a traversal deviating by up to `SIMILARITY_METRES` (25 m).
 *   Stage 2's gate is `endpointReachRadius` — the segment's own endpoint radius
 *   plus half the ride's median sample spacing — which at the default 15 m
 *   radius and the slowest smart-recording interval in common use (10 s, about
 *   83 m at 30 km/h) is 56 m. 100 m clears both, with room for a segment whose
 *   creator widened its endpoint radius. `cells.test.ts` asserts that
 *   relationship against the constants themselves, so tuning
 *   `SIMILARITY_METRES` or `DEFAULT_ENDPOINT_RADIUS_METRES` past this number
 *   is a red test rather than a silent reintroduction of the bug.
 * - **Not larger.** The margin is exactly the amount stage 1's admitted
 *   corridor is dilated by, and every metre of it hands stage 2 — the expensive
 *   stage — candidates it must then examine. At 100 m, under a tenth of a cell,
 *   the measured fan-out grows by 10–16%; at a whole cell it grows by 57–123%.
 *   `docs/spikes/0003-segment-prefilter-margin.md` has both tables.
 *
 * ⚠️ **It is a margin in metres applied to a grid in degrees, so above about
 * 89° of latitude it stops being 100 m.** A degree of longitude shrinks towards
 * the pole and {@link marginDegreesLongitude} caps the longitude margin at one
 * whole cell so the probe loop stays bounded; past that latitude a cell is
 * itself narrower than this margin and the cap binds. Stated rather than fixed:
 * there is no rideable road there, and the honest record is worth more than an
 * unbounded loop.
 */
export const PREFILTER_MARGIN_METRES = 100;

/** Longitude spans 360°, so at 0.01° there are 36 000 columns. One more than that. */
const COLUMNS = 36_001;

/** Latitude spans 180°, so at 0.01° there are 18 000 rows. One more than that. */
const ROWS = 18_001;

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

/** Degrees to radians. Named so the multiplication below is not a bare literal. */
const RADIANS_PER_DEGREE = Math.PI / 180;

/**
 * Metres per degree of latitude on the sphere this package measures with.
 *
 * Derived from {@link EARTH_MEAN_RADIUS_METRES} rather than written down as
 * 111 194.9, so the margin below cannot come to disagree with the distances
 * `geodesy.ts` reports and the endpoint gate compares against.
 */
const METRES_PER_DEGREE_LATITUDE = EARTH_MEAN_RADIUS_METRES * RADIANS_PER_DEGREE;

/** {@link PREFILTER_MARGIN_METRES} as degrees of latitude. Exact at every latitude. */
const MARGIN_DEGREES_LATITUDE = PREFILTER_MARGIN_METRES / METRES_PER_DEGREE_LATITUDE;

/**
 * The row a latitude falls in, clamped into the grid.
 *
 * ⚠️ **The clamp changes nothing for a real position** — a
 * `GeographicPosition` is validated into [−90, 90], which maps to rows 0…18000
 * exactly. It is here for the *probes* {@link paddedCellCover} makes a margin
 * either side of a position, which can step outside the grid at a pole and
 * would otherwise pack into a cell id belonging to some other row.
 */
function rowOf(latitude: number): number {
  return Math.min(ROWS - 1, Math.max(0, Math.floor((latitude + 90) * CELLS_PER_DEGREE)));
}

/**
 * The column a longitude falls in, clamped into the grid.
 *
 * ⚠️ **The antimeridian is not wrapped, and was not before #291.** A path
 * crossing ±180° gets columns at both ends of the grid and no cells between
 * them. Both covers are built the same way from the same coordinates, so a
 * ride and a segment on the same road still meet; what is lost is the
 * interpolation across the seam. Left alone deliberately — changing it is a
 * different decision from this one, and clamping keeps the probes from
 * manufacturing a cell id in the row below.
 */
function columnOf(longitude: number): number {
  return Math.min(COLUMNS - 1, Math.max(0, Math.floor((longitude + 180) * CELLS_PER_DEGREE)));
}

/**
 * {@link PREFILTER_MARGIN_METRES} as degrees of longitude, at a latitude.
 *
 * A degree of longitude is `cos(latitude)` as long as a degree of latitude, so
 * the same distance is more degrees the closer to a pole you are. A margin
 * converted once and reused would under-reach by half at 60°, and the
 * under-reach is invisible: the cover is well-formed and simply narrower than
 * the margin claims.
 *
 * ⚠️ **Capped at one whole cell, which is what bounds the probe loop in
 * {@link addMarginCells}.** `Math.cos` of 90° is 6.1 × 10⁻¹⁷ rather than zero,
 * so without the cap a position at a pole would ask for every column in the
 * grid. Above about 89° the cap binds and the margin stops being 100 m — see
 * the warning on {@link PREFILTER_MARGIN_METRES}.
 *
 * The cosine is taken at the position's own latitude rather than at the
 * pole-most edge of the margin band. Strictly the band's pole-most edge is the
 * wider one, but the difference is a part in 10⁵ — two millimetres in a hundred
 * metres at 51° — against 44 m of slack over the widest gate downstream. A
 * branch no test can distinguish is worth less than the arithmetic it saves.
 */
function marginDegreesLongitude(latitude: number): number {
  const shrink = Math.cos(latitude * RADIANS_PER_DEGREE);
  return Math.min(MARGIN_DEGREES_LATITUDE / shrink, CELL_DEGREES);
}

/** The cell containing a position. */
export function cellOf(position: GeographicPosition): CellId {
  return rowOf(position.latitude) * COLUMNS + columnOf(position.longitude);
}

/**
 * Every cell within {@link PREFILTER_MARGIN_METRES} of a position, added to
 * `cells`.
 *
 * Usually one cell, and two or four only where the margin crosses a grid line —
 * which is the whole of what #291 fixes and the whole of what it costs. The
 * latitude margin is always a tenth of a cell, so it crosses at most one row
 * line; the longitude margin is capped at one whole cell, so at a pole, where
 * the cap binds, it can cross two column lines and the answer is six.
 */
function addMarginCells(cells: Set<CellId>, position: GeographicPosition): void {
  const longitudeMargin = marginDegreesLongitude(position.latitude);
  const lowRow = rowOf(position.latitude - MARGIN_DEGREES_LATITUDE);
  const highRow = rowOf(position.latitude + MARGIN_DEGREES_LATITUDE);
  const lowColumn = columnOf(position.longitude - longitudeMargin);
  const highColumn = columnOf(position.longitude + longitudeMargin);
  for (let row = lowRow; row <= highRow; row += 1) {
    for (let column = lowColumn; column <= highColumn; column += 1) {
      cells.add(row * COLUMNS + column);
    }
  }
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
  walkPath(path, (position) => cells.add(cellOf(position)));
  return cells;
}

/**
 * The same cover, reaching {@link PREFILTER_MARGIN_METRES} outside the path.
 *
 * ⚠️ **This is the corpus side of the intersection, and only the corpus side.**
 * `match.ts`'s `indexCorpus` uses it; `matchRide` builds the *ride's* cover with
 * {@link cellCover}. Padding both sides would dilate the corridor twice over
 * for nothing, because a set intersection is symmetric: if a ride sample is
 * within the margin of a segment point, the segment point's padded box already
 * contains the ride sample's cell.
 *
 * ⚠️ **Calling {@link cellCover} for a corpus instead is the #291 bug, and it
 * fails silently** — the covers are well-formed, the match simply reports
 * nothing and the funnel says `afterPrefilter: 0` for a ride that traversed the
 * segment exactly. `cells.test.ts` pins that pair by asserting the unpadded
 * cover of a boundary-straddling pair does *not* intersect while the padded one
 * does, so the distinction cannot be flattened by accident.
 */
export function paddedCellCover(path: readonly GeographicPosition[]): Set<CellId> {
  const cells = new Set<CellId>();
  walkPath(path, (position) => {
    addMarginCells(cells, position);
  });
  return cells;
}

/**
 * Visit every position of a path **and the interpolants between consecutive
 * ones**, which is the half {@link cellCover} documents as fatal to leave out.
 *
 * Extracted so the padded and unpadded covers walk the path identically and
 * differ only in what they record at each point. Two copies of this loop is how
 * one of them would come to interpolate at a different density from the other,
 * and the symptom would be a prefilter that is conservative for a ride and not
 * for a segment.
 */
function walkPath(
  path: readonly GeographicPosition[],
  visit: (position: GeographicPosition) => void,
): void {
  for (const [index, position] of path.entries()) {
    visit(position);
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
      visit({
        latitude: (position.latitude +
          (next.latitude - position.latitude) * fraction) as GeographicPosition['latitude'],
        longitude: (position.longitude +
          (next.longitude - position.longitude) * fraction) as GeographicPosition['longitude'],
      });
    }
  }
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
