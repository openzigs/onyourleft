// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The elevation profile of a route being drawn —
 * [#72](https://github.com/openzigs/onyourleft/issues/72).
 *
 * ## Elevation gain is a computed opinion, so this records whose
 *
 * #72 opens by saying so, and even names the incumbent conceding it. Any number
 * this program produces will disagree with any other product's number for the
 * same road. What it must not do is disagree with **itself**, and the two ways
 * that happens are both closed here:
 *
 * 1. **A different DEM.** {@link PlannedElevation.dataset} carries the source's
 *    name and its grid resolution, and a route stores them. Two routes computed
 *    from different datasets must never be compared as if they were comparable,
 *    and without the field nobody can tell that they were. ADR 0010 D-5 makes
 *    this a *licence* requirement as well: the Copernicus notice travels with
 *    adapted data, and a name that stops here never reaches the export.
 * 2. **An irregular sample spacing.** #72 calls this *"the single largest source
 *    of 'why does this say 1,200 m and that say 800 m'"*, because summing every
 *    positive step of a denser series counts more noise as climbing. So the
 *    shape is resampled onto a uniform grid **before** anything is summed, the
 *    interval is a stated number, and it is carried on the result.
 *
 * ## What is reused rather than rewritten
 *
 * The ascent, the despiking and the least-squares gradient are
 * `@onyourleft/domain`'s `routeProfile` — the same three windows #89 built for
 * an imported route, unchanged. That is deliberate beyond saving code: #73 asks
 * that *"a route imported from a GPX file and a route drawn in the builder
 * appear in the same list and behave identically"*, and two implementations of
 * total ascent is exactly how that stops being true.
 *
 * ⚠️ **What is NOT reused is the void handling, and the two disagree on
 * purpose.** `routeProfile` interpolates across a point with no elevation,
 * because for an imported ride assuming a ramp between two known heights is
 * better than moving the geometry. #72 requires the opposite for a *planned*
 * route: *"a route crossing a data void or a withheld DEM tile renders the gap
 * as a gap, and total ascent reports as incomplete rather than silently summing
 * across it."* Both are right for their case, so the interpolation still
 * happens — the numbers have to come from somewhere — and {@link
 * ElevationCoverage} records exactly where it happened so the screen can say
 * the total is a floor rather than a measurement, and draw the hole.
 */

import {
  altitudeMetres,
  distanceBetween,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  routeProfile,
  RoutingError,
  type AltitudeMetres,
  type ElevationDataset,
  type GeographicPosition,
  type HeightProfile,
  type Metres,
  type RoutePoint,
  type RouteProfile,
  type RoutingProvider,
} from '@onyourleft/domain';

import type { RouteDraft } from './draft';

/**
 * The distance between elevation samples: **30 metres**.
 *
 * ⚠️ **Matched to the source, not to the screen.** ADR 0010 D-5's dataset is
 * Copernicus DEM GLO-30, whose grid is 30 m. Asking for samples closer together
 * than the DEM's own posts does not produce more information — it produces
 * interpolation, sampled several times, which then *looks* like terrain to
 * anything summing positive steps. Asking for them further apart throws away
 * data that is there.
 *
 * The profile's own grid is finer ({@link PROFILE_RESOLUTION_METRES}, 10 m) and
 * that is fine: it is resampling a series that is already uniform, which adds
 * no bias, where resampling an irregular one does.
 */
export const ELEVATION_INTERVAL_METRES = 30;

/**
 * The steepest gradient a genuinely flat road may show: **1 %**.
 *
 * #72's third criterion asks for a test on a deliberately flat fixture that
 * *"asserts the profile contains no stair-step artefact exceeding a stated
 * threshold"*, and this is the stated threshold. The artefact it is about is
 * real and has a named cause: ADR 0010 D-5 records that the engine's `/height`
 * takes a `height_precision` of 0, 1 or 2, and that **the engine's own docs
 * warn integer precision causes "stair step" artefacts on flat roads**. A
 * one-metre quantisation over a 30 m sample is a 3.3 % step out of nowhere, and
 * at 1 Hz on a trainer that is a lurch.
 *
 * ⚠️ **So this is an assertion about the request as much as about the
 * arithmetic**, and the adapter that eventually sends one must not ask for
 * integer heights. `elevation.test.ts` has the pair: a fractional series stays
 * inside this bound and the same series rounded to whole metres does not.
 */
export const FLAT_GRADE_TOLERANCE_PERCENT = 1;

export interface ElevationGap {
  /** Distance along the route where the hole starts. */
  readonly from: Metres;
  /** Where it ends. */
  readonly to: Metres;
}

export interface ElevationCoverage {
  /** True when every sample came back with a height. */
  readonly complete: boolean;
  /** How much of the route the dataset had no height for. */
  readonly missing: Metres;
  /** Where the holes are, in order, so the chart can break its line. */
  readonly gaps: readonly ElevationGap[];
}

export interface PlannedElevation {
  /** Which DEM said so, and at what grid spacing. Stored with the route. */
  readonly dataset: ElevationDataset;
  /** The uniform spacing the heights were sampled at. See {@link ELEVATION_INTERVAL_METRES}. */
  readonly interval: Metres;
  /** Ascent, descent, grade and the drawable path — `@onyourleft/domain`'s, unchanged. */
  readonly profile: RouteProfile;
  /**
   * ⚠️ Read this before quoting {@link RouteProfile.totalAscent}. When
   * `complete` is false the total is a figure computed across interpolated
   * ground, and the screen must say so.
   */
  readonly coverage: ElevationCoverage;
}

/**
 * The route's geometry, end to end, from the legs that have some.
 *
 * ⚠️ **Stops at the first leg without geometry rather than jumping over it.**
 * A pending or failed leg has no path, and concatenating the legs on either
 * side of it would draw a straight line across the hole and then measure it as
 * ridden distance. A rider gets the profile of the part that is actually
 * planned, and the screen says how many legs are missing.
 */
export function plannedShape(draft: RouteDraft): readonly GeographicPosition[] {
  const shape: GeographicPosition[] = [];
  for (const leg of draft.legs) {
    if (leg.state !== 'routed') break;
    // The legs meet at a waypoint, so every leg after the first repeats the
    // previous leg's last point. Keeping it would put a zero-length step in the
    // series, which `checkedHeights` refuses and a gradient would divide by.
    shape.push(...(shape.length === 0 ? leg.shape : leg.shape.slice(1)));
  }
  return shape;
}

/**
 * Ask the engine for heights along a drawn route, and build its profile.
 *
 * @throws {RoutingError} from the provider. Unlike {@link resolveDraft} this
 * does **not** swallow it: a failed elevation lookup is one thing about the
 * whole route rather than something about one leg, and the screen has one place
 * to say so.
 */
export async function planElevation(
  draft: RouteDraft,
  provider: RoutingProvider,
  interval: Metres = metres(ELEVATION_INTERVAL_METRES),
): Promise<PlannedElevation | undefined> {
  const shape = plannedShape(draft);
  if (shape.length < 2) {
    return undefined;
  }
  // ⚠️ **The provider is handed the RESAMPLED grid, not the raw shape**, and
  // that was the defect review found: this used to send the raw geometry while
  // `elevationFrom` resampled it independently and then matched heights to
  // positions by array index. Two resamplings that disagree by one sample
  // produce a silently shifted profile, or a phantom DEM void at the end, with
  // nothing detecting it — and `resampleShape`'s own comment claimed the
  // provider got the grid it answers on, which is now true.
  const grid = resampleShape(shape, interval);
  if (grid.length < 2) {
    return undefined;
  }
  const heights = await provider.heights({ shape: grid, interval });
  return elevationFrom(grid, heights, interval, { resampled: true });
}

/**
 * The pure half: a shape and its heights become a profile and a coverage report.
 *
 * Separate from {@link planElevation} so the arithmetic is testable without a
 * provider at all, which is the same split `analysis/present.ts` uses.
 */
export function elevationFrom(
  shape: readonly GeographicPosition[],
  heights: HeightProfile,
  interval: Metres,
  options: { readonly resampled?: boolean } = {},
): PlannedElevation | undefined {
  const positions = options.resampled === true ? shape : resampleShape(shape, interval);
  if (positions.length < 2) {
    return undefined;
  }
  const elevations = heightsAlong(heights, interval, positions.length);
  // ⚠️ **A route the dataset has no height for ANYWHERE is its own case**, and
  // it is reachable: ADR 0010 D-5 records that the chosen DEM withholds a
  // subset of country tiles and has no tiles over ocean at all, and an adapter
  // that answers entirely off-grid lands here too. `routeProfile` raises
  // `RouteError('no-elevation')` for it — correctly, there is no profile — and
  // letting that escape put a domain error's wording in front of a rider. This
  // is the same fact as a gap, at the size of the whole route, so it is said
  // the same way.
  if (elevations.every((elevation) => elevation === undefined)) {
    throw new RoutingError(
      'malformed-response',
      'The elevation dataset has no height anywhere along this route, so there is no profile to draw.',
    );
  }
  const points: RoutePoint[] = positions.map((position, index) => ({
    position,
    elevation: elevations[index],
  }));
  return {
    dataset: heights.source,
    interval,
    profile: routeProfile(points),
    coverage: coverageOf(points, interval),
  };
}

/**
 * Heights indexed by grid position, matched on `along` rather than on order.
 *
 * ⚠️ **The provider's own distances decide where each height lands**, which is
 * the half of review's finding that survives even now the provider is handed
 * the grid: `HeightSample.along` exists, and reading the array positionally
 * threw it away. An adapter that returns one sample too few, or starts at the
 * first whole interval rather than at zero, now produces holes at the places it
 * actually left holes instead of shifting every height along the route.
 *
 * A sample that does not sit on the grid is dropped rather than snapped: the
 * grid is what ascent is summed over, and moving a height to a distance the
 * source did not report it at is inventing terrain.
 */
function heightsAlong(
  heights: HeightProfile,
  interval: Metres,
  gridLength: number,
): readonly (AltitudeMetres | undefined)[] {
  const byIndex = new Map<number, AltitudeMetres | undefined>();
  for (const sample of heights.samples) {
    const index = sample.along / interval;
    if (Number.isInteger(index) && index >= 0 && index < gridLength) {
      byIndex.set(index, sample.elevation);
    }
  }
  return Array.from({ length: gridLength }, (_, index) => byIndex.get(index));
}

/**
 * Positions at `0, interval, 2 × interval, …`, ending on the route's last point.
 *
 * ⚠️ This is the step that makes total ascent mean anything, and it is done
 * **before** the heights are asked for rather than after they arrive: the
 * provider is handed the same uniform grid it answers on, so sample *i* of the
 * response is position *i* of this array and nothing has to match them up by
 * distance afterwards.
 */
export function resampleShape(
  shape: readonly GeographicPosition[],
  interval: Metres,
): readonly GeographicPosition[] {
  const first = shape[0];
  if (first === undefined || interval <= 0) {
    return [];
  }
  const out: GeographicPosition[] = [first];
  let carried = 0;
  for (let index = 0; index + 1 < shape.length; index += 1) {
    const from = shape[index]!;
    const to = shape[index + 1]!;
    const span = distanceBetween(from, to);
    if (span === 0) continue;
    let along = interval - carried;
    while (along <= span) {
      out.push(interpolate(from, to, along / span));
      along += interval;
    }
    carried = span - (along - interval);
  }
  const last = shape.at(-1)!;
  // The grid's last point is the route's end rather than the last whole
  // interval, so the profile's own total distance is the route's real length.
  // `routeProfile` makes the same choice and says why.
  if (carried > 0) out.push(last);
  return out;
}

function coverageOf(points: readonly RoutePoint[], interval: Metres): ElevationCoverage {
  const gaps: ElevationGap[] = [];
  let openedAt: number | undefined;
  for (const [index, point] of points.entries()) {
    const along = index * interval;
    if (point.elevation === undefined) {
      openedAt ??= along;
    } else if (openedAt !== undefined) {
      gaps.push({ from: metres(openedAt), to: metres(along) });
      openedAt = undefined;
    }
  }
  if (openedAt !== undefined) {
    gaps.push({ from: metres(openedAt), to: metres((points.length - 1) * interval) });
  }
  // ⚠️ **Summed from the gaps rather than counted per sample.** The two agree
  // for a hole in the middle of a route — a run of n missing samples spans
  // n × interval either way — and they differ in exactly one place: a hole
  // that runs to **the end**. There the last sample is the route's end, so the
  // gap stops there, where counting one interval per sample carries on past
  // it. A 120 m route at this grid is five samples; with every height missing
  // the per-sample count reports **150 m missing on a 120 m route**, in the
  // sentence a rider reads. Found by review, and the mutation that catches it
  // is the one with a gap at the end — an interior-gap fixture cannot.
  //
  // What `missing` measures, so nobody re-derives it: the first sample with no
  // height, to the first sample that has one again (or to the route's end).
  const missing = gaps.reduce((total, gap) => total + (gap.to - gap.from), 0);
  return { complete: gaps.length === 0, missing: metres(missing), gaps };
}

function interpolate(
  from: GeographicPosition,
  to: GeographicPosition,
  fraction: number,
): GeographicPosition {
  return geographicPosition(
    degreesLatitude(from.latitude + (to.latitude - from.latitude) * fraction),
    degreesLongitude(from.longitude + (to.longitude - from.longitude) * fraction),
  );
}

/** A height that came back as a whole number of metres, for the stair-step fixture. */
export function quantised(elevation: number): ReturnType<typeof altitudeMetres> {
  return altitudeMetres(Math.round(elevation));
}
