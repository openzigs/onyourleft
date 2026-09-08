// SPDX-License-Identifier: Apache-2.0

/**
 * The route profile — #89.
 *
 * ## A route here is not a map
 *
 * For indoor riding a route is a **one-dimensional function of distance**:
 * elevation, and therefore gradient, at every point along it. The renderer
 * needs a path to draw and the physics needs `h'(x)`; nothing here needs
 * turn-by-turn navigation, a road name or a junction. That is why this lives in
 * `packages/domain` next to the units rather than beside a map component — it
 * is arithmetic over distance, and #90 (the trainer's resistance) and #91 (the
 * renderer) must read the same numbers from the same code.
 *
 * ## The three windows, and why a gradient is not a difference of two points
 *
 * Raw route points are irregularly spaced in distance, and elevation from a GPX
 * is often poor: a consumer barometer or an SRTM lookup is worth a couple of
 * metres either way per point. A gradient taken as the difference between two
 * points a few metres apart is therefore **dominated by that noise** — a 3 m
 * error over an 8 m step is a 37 % gradient that is not there. Written to a
 * trainer at 1 Hz, that is the lurching #89 names as the most likely reason a
 * rider abandons their first ride.
 *
 * So the profile is built in three stages, each with one job:
 *
 * | Stage | Window | What it is for |
 * |---|---|---|
 * | Resample | {@link PROFILE_RESOLUTION_METRES} = 10 m | put elevation on a fixed distance grid, so every later stage has a uniform spacing to work with |
 * | Despike | {@link DESPIKE_WINDOW_METRES} = 30 m | a **median** over three samples, which removes an isolated bad reading outright |
 * | Slope | {@link GRADIENT_WINDOW_METRES} = 100 m | a **least-squares** slope over the window, which is the gradient |
 *
 * ⚠️ **The despike stage is a median and not an average, and that is the whole
 * trick.** #89 warns that smoothing has a failure mode at each extreme — *"too
 * little and the trainer oscillates; too much and a real 12 % wall arrives as a
 * gentle 6 %"* — and a single moving average has to trade one against the
 * other. A median does not: it removes a lone outlier completely while leaving
 * a real step exactly where it is, so the despike stage costs nothing in
 * fidelity and the slope window can stay narrow enough that a sustained 12 %
 * still reads 12 %. Both halves are tests, not claims.
 *
 * ⚠️ **What the 100 m slope window does cost**, stated rather than buried: a
 * real feature shorter than about 100 m is flattened towards the terrain around
 * it. A 30 m ramp at 15 % between two flat stretches reads a few percent. That
 * is the deliberate trade — the alternative is a shorter baseline, where a 2 m
 * elevation error is worth 10 % of gradient and the trainer surges on noise.
 *
 * ## Nothing here reads a clock or a random source
 *
 * Same rule as the recording engine: this package may not name a platform API,
 * and a profile built twice from the same points must be identical, because
 * `packages/store` round-trips one and compares.
 */

import type { AltitudeMetres, GeographicPosition, GradePercent, Metres } from '../quantities';
import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  gradePercent,
  metres,
} from '../quantities';
import { distanceBetween } from '../geodesy';
import { RouteError } from './errors';

/**
 * The distance between two samples of the profile: **10 metres**.
 *
 * The same number `segment/frechet.ts` resamples to, and for a related reason —
 * it is about the finest step the source data supports. A rider at 25 km/h
 * covers 7 m in a second, so a 1 Hz recording carries no detail below it, and
 * an SRTM elevation grid is coarser still. Finer would be inventing resolution;
 * coarser would put more than a second between gradient changes at speed, which
 * #90 writes to the trainer at 1 Hz.
 *
 * ⚠️ It is a **target**, not the spacing a profile ends up with. See
 * {@link RouteProfile.resolution}.
 */
export const PROFILE_RESOLUTION_METRES = 10;

/**
 * The despiking window: **30 metres**, three samples at the default resolution.
 *
 * Three is the smallest window a median can act on, and it is enough: an
 * isolated bad elevation reading is a single sample after resampling, and a
 * three-sample median removes exactly that and nothing else. Widening it would
 * start removing real two-sample features for no gain.
 */
export const DESPIKE_WINDOW_METRES = 30;

/**
 * The baseline the gradient is measured over: **100 metres**.
 *
 * The number trades noise against fidelity and both directions are asserted.
 * Against noise: a 2 m elevation error over a 100 m baseline is 2 % of gradient,
 * where over a 10 m baseline it is 20 %. Against fidelity: a constant grade
 * longer than the window reads at its true value in the middle, so a sustained
 * 12 % wall is still 12 % — which is the failure #89 names in the other
 * direction.
 */
export const GRADIENT_WINDOW_METRES = 100;

/**
 * How near a route's two ends must be for `loop: true` to be honest: **25 m**.
 *
 * A loop's start and finish are the same place, so this is a claim about the
 * geometry and not a display preference — {@link routeProfile} refuses a route
 * whose ends are further apart than this rather than wrapping a rider from a
 * hilltop back to a valley floor. 25 m is one recording sample at 90 km/h and
 * comfortably inside the width of a road junction.
 */
export const LOOP_CLOSURE_METRES = 25;

/**
 * The smallest rise counted as a climb: **3 metres**.
 *
 * Total ascent is the number a rider compares between two versions of the same
 * route, and it is the one most easily inflated: summing every positive step of
 * a noisy elevation series counts the noise. The despike stage above cannot fix
 * that, and the reason is worth stating because it is the standard trap — **a
 * median removes an ISOLATED bad sample and leaves an alternating one alone**.
 * A road wobbling ±1 m every 10 m has no spike for the median to find and still
 * reports about 50 m of climbing per flat kilometre.
 *
 * So ascent is accumulated by run rather than by step: a climb is counted only
 * once it has risen more than this above the last turning point, and then at its
 * **full** height rather than at its height above the threshold. A real 50 m
 * climb is 50 m; ±1 m of wobble is nothing. 3 m is about the vertical accuracy
 * of the elevation sources a route arrives with — an SRTM lookup or a consumer
 * barometer — so below it a rise is not distinguishable from the noise.
 */
export const ASCENT_THRESHOLD_METRES = 3;

/** One point of a route as a file carries it: where it is, and how high. */
export interface RoutePoint {
  readonly position: GeographicPosition;
  /**
   * Absent when the source point carries no elevation.
   *
   * Absent points are **interpolated across**, not dropped: dropping one would
   * shorten the measured distance and move the geometry, which is a worse
   * answer than assuming the ground between two known heights is a ramp. A
   * route where *no* point has an elevation is a {@link RouteError}, because
   * there is no profile to build.
   */
  readonly elevation: AltitudeMetres | undefined;
}

/** How to build a profile. Every field has a default; see the constants above. */
export interface RouteProfileOptions {
  /**
   * Whether riding past the end wraps to the start.
   *
   * @throws {RouteError} `not-a-loop` when the two ends are more than
   * {@link LOOP_CLOSURE_METRES} apart.
   */
  readonly loop?: boolean | undefined;
  readonly resolutionMetres?: number | undefined;
  readonly despikeWindowMetres?: number | undefined;
  readonly gradientWindowMetres?: number | undefined;
}

/**
 * Elevation and gradient as a function of distance, on a fixed grid.
 *
 * The three arrays are the same length and are indexed together: entry `i`
 * describes the point `i * resolution` metres along the route.
 */
export interface RouteProfile {
  /** Whether riding past the end wraps to the start. */
  readonly loop: boolean;
  /**
   * The **actual** spacing between samples, which is at most half a metre from
   * {@link PROFILE_RESOLUTION_METRES}.
   *
   * The grid is stretched to land its last sample exactly on the route's end
   * rather than wherever the last whole 10 m fell. That is what makes
   * {@link totalDistance} the route's real length and makes a loop's wrap exact
   * — with a grid that stopped short, `elevationAt(totalDistance)` would not be
   * `elevationAt(0)` and every lap of a loop would lose up to 10 m.
   */
  readonly resolution: Metres;
  /** The route's length, along the ground. */
  readonly totalDistance: Metres;
  /** Summed over the despiked grid — see {@link routeProfile}. */
  readonly totalAscent: Metres;
  /** Summed over the despiked grid, as a positive magnitude. */
  readonly totalDescent: Metres;
  /** Despiked elevation at each grid point. */
  readonly elevations: readonly AltitudeMetres[];
  /** The least-squares slope at each grid point, in percent. Signed. */
  readonly grades: readonly GradePercent[];
  /** The path to draw, at the same grid points. */
  readonly positions: readonly GeographicPosition[];
}

/** An odd sample count covering `windowMetres` at `resolution`, never below 3. */
function windowSamples(windowMetres: number, resolution: number): number {
  const half = Math.max(1, Math.round(windowMetres / resolution / 2));
  return half * 2 + 1;
}

/** `values[index]`, with the ends replicated rather than reflected or wrapped. */
function clamped(values: readonly number[], index: number): number {
  const last = values.length - 1;
  const at = index < 0 ? 0 : index > last ? last : index;
  return values[at] as number;
}

/**
 * A median filter: each sample replaced by the median of its window.
 *
 * Edge-preserving, which is the property being bought — see the header. The
 * window is small and the arrays are short enough that sorting a copy per
 * sample is the honest implementation rather than a worthwhile optimisation
 * target: a 200 km route at 10 m is 20 000 samples of a three-element sort.
 */
function medianFilter(values: readonly number[], samples: number): readonly number[] {
  const half = (samples - 1) / 2;
  return values.map((_, index) => {
    const window: number[] = [];
    for (let offset = -half; offset <= half; offset += 1) {
      window.push(clamped(values, index + offset));
    }
    window.sort((first, second) => first - second);
    return window[half] as number;
  });
}

/**
 * The least-squares slope through each window, as a fraction (rise over run).
 *
 * With a uniform spacing the normal equations collapse to `Σ t·y / (r · Σ t²)`,
 * where `t` is the offset from the window's centre in samples — the mean of `y`
 * drops out because `Σ t` is zero over a symmetric window.
 *
 * ⚠️ **At the two ends the window is replicated, not truncated**, which biases
 * the slope towards zero over the first and last half-window. That is the safe
 * direction for a device that applies resistance to a person: a route that
 * starts on a 10 % ramp eases into it over 50 m rather than hitting the rider
 * with it before they have turned a pedal.
 */
function slopes(elevations: readonly number[], samples: number, resolution: number): number[] {
  const half = (samples - 1) / 2;
  // Σ t² over t = -half..half, in closed form so the loop below does not carry it.
  const squares = (half * (half + 1) * (2 * half + 1)) / 3;
  return elevations.map((_, index) => {
    let weighted = 0;
    for (let offset = -half; offset <= half; offset += 1) {
      weighted += offset * clamped(elevations, index + offset);
    }
    return weighted / (resolution * squares);
  });
}

/** Fill `undefined` elevations by interpolating between the readings that exist. */
function filledElevations(points: readonly RoutePoint[], cumulative: readonly number[]): number[] {
  const known: number[] = [];
  for (const [index, point] of points.entries()) {
    if (point.elevation !== undefined) known.push(index);
  }
  if (known.length === 0) {
    throw new RouteError(
      'no-elevation',
      'no point in this route carries an elevation, so there is no profile to build from it',
    );
  }
  const filled: number[] = [];
  let ahead = 0;
  for (const [index, point] of points.entries()) {
    if (point.elevation !== undefined) {
      filled.push(point.elevation);
      continue;
    }
    while (ahead < known.length && (known[ahead] as number) < index) ahead += 1;
    const after = known[ahead];
    const before = known[ahead - 1];
    if (after === undefined) {
      // Past the last reading: hold it flat rather than extrapolate a trend.
      filled.push(points[before as number]?.elevation as number);
    } else if (before === undefined) {
      filled.push(points[after]?.elevation as number);
    } else {
      const span = (cumulative[after] as number) - (cumulative[before] as number);
      const fraction =
        span === 0 ? 0 : ((cumulative[index] as number) - (cumulative[before] as number)) / span;
      const low = points[before]?.elevation as number;
      const high = points[after]?.elevation as number;
      filled.push(low + (high - low) * fraction);
    }
  }
  return filled;
}

/** The index of the last source point at or before `distance`. */
function segmentIndexAt(cumulative: readonly number[], distance: number): number {
  let low = 0;
  let high = cumulative.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((cumulative[middle] as number) <= distance) low = middle;
    else high = middle - 1;
  }
  return Math.min(low, cumulative.length - 2);
}

/**
 * Total ascent and descent, accumulated by run rather than by step.
 *
 * A climb is counted only once it has risen more than `threshold` above the last
 * turning point, and it is then counted at its **full** height — the threshold
 * decides whether a run is real, it does not shave anything off a run that is.
 * See {@link ASCENT_THRESHOLD_METRES} for why a step-wise sum is the wrong
 * number and why the median filter above does not rescue it.
 */
function accumulated(
  values: readonly number[],
  threshold: number,
): { ascent: number; descent: number } {
  let ascent = 0;
  let descent = 0;
  // Before the first confirmed run there is no direction yet, so both the
  // lowest and the highest point so far are candidate pivots.
  let low = values[0] as number;
  let high = values[0] as number;
  let direction = 0;
  let pivot = values[0] as number;
  let extreme = values[0] as number;
  for (const value of values) {
    if (direction === 0) {
      if (value < low) low = value;
      if (value > high) high = value;
      if (value - low > threshold) {
        direction = 1;
        pivot = low;
        extreme = value;
      } else if (high - value > threshold) {
        direction = -1;
        pivot = high;
        extreme = value;
      }
    } else if (direction === 1) {
      if (value > extreme) extreme = value;
      else if (extreme - value > threshold) {
        ascent += extreme - pivot;
        direction = -1;
        pivot = extreme;
        extreme = value;
      }
    } else {
      if (value < extreme) extreme = value;
      else if (value - extreme > threshold) {
        descent += pivot - extreme;
        direction = 1;
        pivot = extreme;
        extreme = value;
      }
    }
  }
  // The run in progress when the route ended is a real one; closing it is not
  // rounding up. Without this every route loses its final climb.
  if (direction === 1) ascent += extreme - pivot;
  if (direction === -1) descent += pivot - extreme;
  return { ascent, descent };
}

/**
 * Build a route profile from a route's points.
 *
 * @throws {RouteError} for every way a route can fail to be one — see
 * {@link RouteErrorCode}. Each message names the problem and the constraint,
 * because a route is a file a rider chose rather than a call a programmer made.
 */
export function routeProfile(
  points: readonly RoutePoint[],
  options: RouteProfileOptions = {},
): RouteProfile {
  const resolutionTarget = options.resolutionMetres ?? PROFILE_RESOLUTION_METRES;
  const despikeWindow = options.despikeWindowMetres ?? DESPIKE_WINDOW_METRES;
  const gradientWindow = options.gradientWindowMetres ?? GRADIENT_WINDOW_METRES;
  for (const [label, value] of [
    ['resolutionMetres', resolutionTarget],
    ['despikeWindowMetres', despikeWindow],
    ['gradientWindowMetres', gradientWindow],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RouteError(
        'invalid-option',
        `${label} must be a positive, finite number of metres`,
      );
    }
  }

  if (points.length < 2) {
    throw new RouteError(
      'too-few-points',
      `a route needs at least two points with a position to have a length; this one has ${points.length}`,
    );
  }

  const cumulative: number[] = [0];
  for (let index = 1; index < points.length; index += 1) {
    const step = distanceBetween(
      (points[index - 1] as RoutePoint).position,
      (points[index] as RoutePoint).position,
    );
    cumulative.push((cumulative[index - 1] as number) + step);
  }
  const total = cumulative[cumulative.length - 1] as number;
  if (total <= 0) {
    throw new RouteError(
      'no-distance',
      'every point of this route is in the same place, so the route has no length',
    );
  }

  const loop = options.loop ?? false;
  if (loop) {
    const gap = distanceBetween(
      (points[0] as RoutePoint).position,
      (points[points.length - 1] as RoutePoint).position,
    );
    if (gap > LOOP_CLOSURE_METRES) {
      // ⚠️ ADR 0004 decision D: the gap is a distance and is the diagnostic;
      // where the two ends ARE is a coordinate and is never in this message.
      throw new RouteError(
        'not-a-loop',
        `this route was marked as a loop, but its two ends are ${gap.toFixed(0)} m apart and a ` +
          `loop's ends must be within ${LOOP_CLOSURE_METRES} m of each other`,
      );
    }
  }

  // The grid is stretched to land exactly on the end — see RouteProfile.resolution.
  const count = Math.max(2, Math.round(total / resolutionTarget) + 1);
  const resolution = total / (count - 1);

  const sourceElevations = filledElevations(points, cumulative);
  const sampled: number[] = [];
  const positions: GeographicPosition[] = [];
  for (let index = 0; index < count; index += 1) {
    const distance = index === count - 1 ? total : index * resolution;
    const at = segmentIndexAt(cumulative, distance);
    const spanStart = cumulative[at] as number;
    const span = (cumulative[at + 1] as number) - spanStart;
    const fraction = span === 0 ? 0 : (distance - spanStart) / span;
    const low = sourceElevations[at] as number;
    const high = sourceElevations[at + 1] as number;
    sampled.push(low + (high - low) * fraction);
    const from = (points[at] as RoutePoint).position;
    const to = (points[at + 1] as RoutePoint).position;
    positions.push(
      geographicPosition(
        degreesLatitude(from.latitude + (to.latitude - from.latitude) * fraction),
        degreesLongitude(from.longitude + (to.longitude - from.longitude) * fraction),
      ),
    );
  }

  const despiked = medianFilter(sampled, windowSamples(despikeWindow, resolution));
  const grades = slopes(despiked, windowSamples(gradientWindow, resolution), resolution);

  const { ascent, descent } = accumulated(despiked, ASCENT_THRESHOLD_METRES);

  return {
    loop,
    resolution: metres(resolution),
    totalDistance: metres(total),
    totalAscent: metres(ascent),
    totalDescent: metres(descent),
    elevations: despiked.map((value) => altitudeMetres(value)),
    grades: grades.map((value) => gradePercent(value * 100)),
    positions,
  };
}

/**
 * Where `distance` lands on this route: wrapped for a loop, clamped otherwise.
 *
 * This is #89's fifth criterion in one function — *"riding past the end wraps to
 * the start with continuous distance accumulation rather than resetting or
 * stopping"*. The rider's own odometer keeps counting; it is only the position
 * **on the route** that wraps, so a second lap of a 5 km loop is distance 5 000
 * to 10 000 for the rider and 0 to 5 000 here.
 *
 * A negative distance wraps the same way, so a ghost or a bot pacer (#92, #93)
 * behind the rider at the start of a loop is on the far side of it rather than
 * pinned to zero.
 */
export function distanceOnRoute(profile: RouteProfile, distance: number): number {
  if (!Number.isFinite(distance)) return 0;
  const total = profile.totalDistance;
  if (!profile.loop) return distance < 0 ? 0 : distance > total ? total : distance;
  return ((distance % total) + total) % total;
}

/** The grid index below `distance`, and how far between it and the next one. */
function gridAt(profile: RouteProfile, distance: number): { index: number; fraction: number } {
  const on = distanceOnRoute(profile, distance);
  const last = profile.elevations.length - 1;
  const raw = on / profile.resolution;
  const index = Math.min(Math.floor(raw), last - 1);
  return { index: Math.max(0, index), fraction: Math.max(0, Math.min(1, raw - index)) };
}

/** Elevation at a distance along the route, interpolated between grid points. */
export function elevationAt(profile: RouteProfile, distance: number): AltitudeMetres {
  const { index, fraction } = gridAt(profile, distance);
  const low = profile.elevations[index] as number;
  const high = profile.elevations[index + 1] as number;
  return altitudeMetres(low + (high - low) * fraction);
}

/**
 * Gradient at a distance along the route, interpolated between grid points.
 *
 * Interpolated rather than held at the nearest sample, because #90 writes this
 * to a trainer at 1 Hz: a held value steps by the whole difference between two
 * grid points every time the rider crosses one, and a step in commanded
 * resistance is felt.
 */
export function gradeAt(profile: RouteProfile, distance: number): GradePercent {
  const { index, fraction } = gridAt(profile, distance);
  const low = profile.grades[index] as number;
  const high = profile.grades[index + 1] as number;
  return gradePercent(low + (high - low) * fraction);
}

/** The position at a distance along the route, for the renderer's camera. */
export function positionAt(profile: RouteProfile, distance: number): GeographicPosition {
  const { index, fraction } = gridAt(profile, distance);
  const from = profile.positions[index] as GeographicPosition;
  const to = profile.positions[index + 1] as GeographicPosition;
  return geographicPosition(
    degreesLatitude(from.latitude + (to.latitude - from.latitude) * fraction),
    degreesLongitude(from.longitude + (to.longitude - from.longitude) * fraction),
  );
}
