// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2882's spike: a route profile that grows ahead of the rider and has its
 * tail replaced at a junction. **Throwaway**: nothing the app ships imports
 * this directory (`spike-boundary.test.ts`), and the write-up is
 * `docs/spikes/0040-rolling-route-and-a-turning-ride.md`.
 *
 * ## What `RouteProfile` / `routeProfile` would not do, and what this does instead
 *
 * Each numbered point is a finding the write-up quotes.
 *
 * 1. **The grid is stretched.** `routeProfile` spaces its samples
 *    `total / (count - 1)` apart so the last one lands on the route's end
 *    (`packages/domain/src/route/profile.ts`, `const resolution = total / (count - 1)`).
 *    A profile that grows would re-space every sample at every extension, and
 *    every odometer reading would move under the rider. Here the spacing is
 *    exactly {@link ROLLING_RESOLUTION_METRES}, and the part of a step left
 *    over at the end waits for the next extension instead of being stretched.
 * 2. **The arrays are fixed.** `RouteProfile`'s three arrays are `readonly`
 *    and every consumer may hold them. Here they are private and growable, and
 *    {@link RollingProfile.view} hands out a NEW `RouteProfile` each time
 *    something changed, so a holder of an old one is never changed under it.
 * 3. **The grade at the end is provisional.** The slope is fitted over a
 *    window; its last half-window has no road beyond it yet. Here the samples
 *    within a window of a change are fitted again after every extension or
 *    swap, and {@link RollingProfile.settledTo} says how far the grade is final.
 * 4. **The head is never dropped.** `terrain.ts` §`corridorOrigin` and
 *    `scatter.ts` §`scatterSeed` both read `positions[0]`, so dropping ridden
 *    road moves the world's origin and the scenery's seed. The arrays grow for
 *    the whole ride instead: 3,000 samples an hour at 30 km/h.
 * 5. **`totalDistance` grows**, which `scatterSeed` also reads; the write-up
 *    says what that does to the scenery.
 *
 * The heights are the points' own (none: the spike has no DEM yet, #2013) and
 * the despike and fit follow the shape of `routeProfile`'s, re-stated here
 * because `profile.ts` exports neither.
 */

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  distanceBetween,
  geographicPosition,
  gradePercent,
  metres,
  type GeographicPosition,
  type RouteProfile,
} from '@onyourleft/domain';

/** The spacing, exactly: `routeProfile`'s target, never stretched. */
export const ROLLING_RESOLUTION_METRES = 10;
/** `routeProfile`'s gradient window, as a half-width in samples. */
const SLOPE_HALF_SAMPLES = 5;
/** `routeProfile`'s despike window, as a half-width in samples. */
const DESPIKE_HALF_SAMPLES = 1;

/** One point handed to the profile: a position and, where known, a height. */
export interface RollingPoint {
  readonly position: GeographicPosition;
  readonly elevation?: number | undefined;
}

export class RollingProfile {
  readonly #positions: GeographicPosition[] = [];
  readonly #heights: number[] = [];
  #grades: number[] = [];
  /** How far along the path from the last sample the next one is owed. */
  #carried = 0;
  /** The last point handed in: where the path continues from. */
  #last: RollingPoint | undefined;
  #view: RouteProfile | undefined;
  /** How many times {@link view} built a new object: one per change. */
  #views = 0;

  /** The ride's first point. Never moved: see this file's finding 4. */
  constructor(start: RollingPoint) {
    this.#positions.push(start.position);
    this.#heights.push(start.elevation ?? 0);
    this.#grades.push(0);
    this.#last = start;
  }

  /** How long the road known so far is, in metres: whole samples only. */
  get totalDistance(): number {
    return (this.#positions.length - 1) * ROLLING_RESOLUTION_METRES;
  }

  /** How many `RouteProfile` objects {@link view} has had to build. */
  get views(): number {
    return this.#views;
  }

  /** Up to where the grade will not be fitted again by more road ahead. */
  get settledTo(): number {
    return Math.max(0, this.totalDistance - SLOPE_HALF_SAMPLES * ROLLING_RESOLUTION_METRES);
  }

  /** Extends the road along `points`, which continue from the last point handed in. */
  append(points: readonly RollingPoint[]): void {
    this.#appendFrom(points, this.#positions.length);
  }

  #appendFrom(points: readonly RollingPoint[], firstChanged: number): void {
    for (const point of points) {
      const from = this.#last as RollingPoint;
      const span = distanceBetween(from.position, point.position);
      if (!(span > 0)) {
        this.#last = point;
        continue;
      }
      let at = ROLLING_RESOLUTION_METRES - this.#carried;
      while (at <= span) {
        const share = at / span;
        this.#positions.push(between(from.position, point.position, share));
        const low = from.elevation ?? 0;
        this.#heights.push(low + ((point.elevation ?? 0) - low) * share);
        at += ROLLING_RESOLUTION_METRES;
      }
      this.#carried = span - (at - ROLLING_RESOLUTION_METRES);
      this.#last = point;
    }
    this.#refit(firstChanged);
  }

  /**
   * Replaces the road past `atDistance` — a junction, where the rider chose
   * another street — with the road along `points`. `points[0]` is the junction.
   * Road already ridden is never replaced: `atDistance` is rounded DOWN to a sample.
   */
  swapTail(atDistance: number, points: readonly RollingPoint[]): void {
    const keep = Math.max(1, Math.floor(atDistance / ROLLING_RESOLUTION_METRES) + 1);
    if (keep < this.#positions.length) {
      this.#positions.length = keep;
      this.#heights.length = keep;
      this.#grades.length = keep;
    }
    const end = this.#positions[keep - 1] as GeographicPosition;
    this.#last = { position: end, elevation: this.#heights[keep - 1] };
    this.#carried = 0;
    this.#view = undefined;
    this.#appendFrom(points, keep);
  }

  /** The profile as the game takes one: a new object after every change, the same one otherwise. */
  view(): RouteProfile {
    if (this.#view !== undefined) return this.#view;
    const heights = this.#heights;
    let ascent = 0;
    let descent = 0;
    for (let index = 1; index < heights.length; index += 1) {
      const step = (heights[index] as number) - (heights[index - 1] as number);
      if (step > 0) ascent += step;
      else descent -= step;
    }
    this.#views += 1;
    this.#view = {
      loop: false,
      resolution: metres(ROLLING_RESOLUTION_METRES),
      totalDistance: metres(this.totalDistance),
      totalAscent: metres(ascent),
      totalDescent: metres(descent),
      elevations: heights.map((value) => altitudeMetres(value)),
      grades: this.#grades.map((value) => gradePercent(value)),
      positions: this.#positions.slice(),
    };
    return this.#view;
  }

  /** Fits the grade again from a window before `firstChanged` to the end. */
  #refit(firstChanged: number): void {
    this.#view = undefined;
    const count = this.#positions.length;
    const from = Math.max(0, firstChanged - SLOPE_HALF_SAMPLES - DESPIKE_HALF_SAMPLES);
    const despiked = this.#heights.map((_, index) => median(this.#heights, index));
    this.#grades.length = count;
    for (let index = from; index < count; index += 1) {
      this.#grades[index] = slopePercent(despiked, index);
    }
  }
}

/** A point `share` of the way from `from` to `to`, on the straight line between. */
function between(
  from: GeographicPosition,
  to: GeographicPosition,
  share: number,
): GeographicPosition {
  return geographicPosition(
    degreesLatitude(from.latitude + (to.latitude - from.latitude) * share),
    degreesLongitude(from.longitude + (to.longitude - from.longitude) * share),
  );
}

/** The median of the despike window about `index`, the ends replicated. */
function median(values: readonly number[], index: number): number {
  const window: number[] = [];
  for (let at = index - DESPIKE_HALF_SAMPLES; at <= index + DESPIKE_HALF_SAMPLES; at += 1) {
    window.push(values[Math.min(values.length - 1, Math.max(0, at))] as number);
  }
  window.sort((a, b) => a - b);
  return window[Math.floor(window.length / 2)] as number;
}

/** The least-squares slope over the window about `index`, in percent, the ends replicated. */
function slopePercent(values: readonly number[], index: number): number {
  let sumTy = 0;
  let sumTt = 0;
  for (let t = -SLOPE_HALF_SAMPLES; t <= SLOPE_HALF_SAMPLES; t += 1) {
    const y = values[Math.min(values.length - 1, Math.max(0, index + t))] as number;
    sumTy += t * y;
    sumTt += t * t;
  }
  return (sumTy / (ROLLING_RESOLUTION_METRES * sumTt)) * 100;
}
