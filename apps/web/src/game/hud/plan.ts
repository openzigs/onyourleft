// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The route in plan, and where on it the rider is — #285.
 *
 * The HUD's elevation strip (`HudPanel.tsx` §`ElevationStrip`) answers *how far
 * is left* along one axis. This is the other axis: the **shape** of the road, as
 * a rider recognises it from any ride log — which way it bends next, whether the
 * climb ahead is the big one, how much of the loop is behind them.
 *
 * ## ⚠️ This is not the basemap, and the distinction is the whole point
 *
 * A map with roads, labels and terrain shading needs tiles. There are none:
 * `VITE_BASEMAP_PMTILES_URL` is empty, #53 has published nothing, and #63's
 * MapLibre seam has never had an archive to point at. That version is blocked,
 * and it would drag ADR 0012's OSM attribution obligation onto a panel a rider
 * looks at for one second.
 *
 * **This needs none of it.** `RouteProfile.positions` is already in memory — the
 * game reads the same profile for its corridor — so every number here is a
 * projection of numbers the screen already holds. No tile request, no network
 * call, no server, no attribution, no new dependency. `plan-no-network.test.ts`
 * is the assertion rather than this paragraph.
 *
 * ## North-up, deliberately
 *
 * Heading-up matches the chase camera, and it is the wrong choice here. The one
 * thing this panel adds over the elevation strip is a shape a rider
 * **recognises**, and a shape that rotates through every corner is a different
 * shape every second — the recognition is exactly what rotation destroys. Every
 * ride log a rider has ever seen is north-up for the same reason.
 *
 * It is also the cheaper claim to keep true: heading-up needs a heading, and
 * there is already one in `scene.ts` §`cameraPose`, taken from the corridor's
 * own centreline. A second one computed here is the "separately-computed value
 * that can drift" #94's third criterion exists to forbid, one panel over.
 *
 * ## The projection, and why it is here rather than in `packages/domain`
 *
 * Equirectangular about the route's own mean latitude: longitudes are scaled by
 * `cos φ₀` so a kilometre east and a kilometre north are the same length on the
 * panel, and the whole thing is then fitted **uniformly** into the viewBox. A
 * non-uniform fit would stretch the route to fill the box, which turns a circuit
 * into an ellipse and a hairpin into a right angle — the shape is the content,
 * so it may not be scaled away.
 *
 * `packages/domain`'s `geodesy.ts` says in its own words that it is *"a distance
 * and a bearing, not a projection … nothing here is suitable for drawing a
 * map"*. This is the drawing, so it lives beside the drawing.
 *
 * ## What a gap is, and what this can and cannot see
 *
 * `TraceChart.tsx`'s rule, not a second one: **one `<path>` per unbroken run**,
 * never one path with the jump left in. A single path skips straight to the next
 * coordinate and draws a line across the hole, and that line is
 * indistinguishable from a real road.
 *
 * ⚠️ **What counts as a break here is a jump the profile's own grid cannot
 * produce.** `routeProfile` resamples onto a fixed distance grid, so two
 * consecutive `positions` are at most `resolution` apart along the ground and,
 * around a corner, less. A separation of several times `resolution` therefore
 * did not come from that code — it came from `packages/store`, which stores a
 * whole computed profile as four parallel arrays and checks their **lengths**
 * against each other and nothing about their geometry. A row a different build
 * wrote, or a hand-edited one, is the path that reaches this screen.
 *
 * ⚠️ **And what it cannot see, stated rather than implied.** A source GPX whose
 * points teleport — a recording paused and resumed two kilometres away — is
 * resampled by `routeProfile` into a dense straight line of grid samples before
 * this file ever sees it. That reads as a straight road and nothing here can
 * tell it from one. Recovering it would need the source points, which this panel
 * deliberately does not have.
 */

import { distanceBetween, distanceOnRoute, positionAt } from '@onyourleft/domain';
import type { GeographicPosition, RouteProfile } from '@onyourleft/domain';

/**
 * The side of the drawing's square coordinate space.
 *
 * A `viewBox` rather than pixels, as `TraceChart.tsx` uses: the SVG scales to
 * whatever width the stylesheet gives it and nothing here has to measure a DOM
 * node, which jsdom could not answer anyway. Square because the fit is uniform
 * — a route that is wider than it is tall is centred in the box rather than
 * stretched to fill it.
 */
export const PLAN_SIZE = 100;

/**
 * The margin the route is fitted inside, in the same units.
 *
 * Large enough that {@link RIDER_MARK_RADIUS} at the extreme edge of the route
 * — the start of a point-to-point climb, the westernmost point of a loop — is
 * drawn whole rather than half outside the viewBox.
 */
export const PLAN_PADDING = 6;

/** The rider's mark, as a radius in the same units. @see PLAN_PADDING */
export const RIDER_MARK_RADIUS = 4;

/**
 * How many grid steps apart two consecutive positions must be to be a break: 4.
 *
 * The grid puts consecutive samples exactly `resolution` apart along the route,
 * and a corner between them makes the straight-line separation **shorter** than
 * that — so in a profile this program built, the separation never exceeds
 * `resolution`. Four times it is far enough above that to swallow the difference
 * between a geodesic distance and the linear interpolation in degrees
 * `routeProfile` places the samples with, and far below any jump worth drawing
 * as a break: the case this exists for is a teleport of hundreds of metres or
 * more.
 */
export const PLAN_BREAK_FACTOR = 4;

/**
 * How many points of the route reach the DOM: **400**.
 *
 * `detail/series.ts` §`CHART_POINTS` is the precedent and states the rule — *"a
 * declared width the stylesheet and the chart agree on is checkable"*, where a
 * measured `clientWidth` is 0 in every test in this repository because jsdom
 * performs no layout. So this is a declared bound rather than a measurement.
 *
 * The viewBox is 100 units on a side and the stylesheet gives the panel 8 rem,
 * so 400 points is about three per rendered pixel even for a route that ran
 * dead straight across the panel — and a real route folds, which puts more of
 * them in less of it. Against that, the thing being bounded is large: a 47 km
 * import on the profile's 10 m grid is 4 753 samples.
 *
 * ⚠️ **The bound is about the DOM and about the frame, not about memory.**
 * `HudPanel` re-renders on every tick of the ride, so an unbounded version
 * hands React a path string of several thousand commands sixty times a second
 * on the one screen in this app where the phone is already thermally
 * constrained (`quality.ts`). {@link routePlan} is memoised in `PlanTrace.tsx`
 * as the other half of that; neither alone is enough, because the memo would
 * still produce one enormous attribute and the bound alone would still
 * recompute it every frame.
 */
export const PLAN_MAX_POINTS = 400;

/** A point in the drawing's coordinate space. */
export interface PlanPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * The fit: what to subtract and what to multiply by.
 *
 * Carried as data rather than as a closure so that the route's line and the
 * rider's mark are placed by the **same** transform by construction. Two
 * projections computed from the same profile would agree until one of them
 * changed, and the symptom would be a rider drawn off their own road.
 */
export interface PlanProjection {
  /** The longitude at the centre of the drawing. */
  readonly centreLongitude: number;
  /** The latitude at the centre of the drawing. */
  readonly centreLatitude: number;
  /** `cos φ₀`, which makes a degree of longitude the right width. */
  readonly longitudeScale: number;
  /** ViewBox units per degree of latitude. Zero for a route with no extent. */
  readonly scale: number;
}

/** One unbroken run of the route, and where in `positions` it started. */
export interface PlanRun {
  readonly from: number;
  readonly points: readonly PlanPoint[];
}

/** A route ready to draw: one transform, and the runs it placed. */
export interface RoutePlan {
  readonly projection: PlanProjection;
  readonly runs: readonly PlanRun[];
}

/** Where a position lands in the drawing. North is up, so latitude is flipped. */
export function planPoint(projection: PlanProjection, position: GeographicPosition): PlanPoint {
  const east = (position.longitude - projection.centreLongitude) * projection.longitudeScale;
  const north = position.latitude - projection.centreLatitude;
  return {
    x: PLAN_SIZE / 2 + east * projection.scale,
    y: PLAN_SIZE / 2 - north * projection.scale,
  };
}

/** The uniform fit of a route's positions into the viewBox. */
function projectionFor(positions: readonly GeographicPosition[]): PlanProjection {
  if (positions.length === 0) {
    return { centreLongitude: 0, centreLatitude: 0, longitudeScale: 1, scale: 0 };
  }
  let lowLatitude = Number.POSITIVE_INFINITY;
  let highLatitude = Number.NEGATIVE_INFINITY;
  let lowLongitude = Number.POSITIVE_INFINITY;
  let highLongitude = Number.NEGATIVE_INFINITY;
  for (const position of positions) {
    lowLatitude = Math.min(lowLatitude, position.latitude);
    highLatitude = Math.max(highLatitude, position.latitude);
    lowLongitude = Math.min(lowLongitude, position.longitude);
    highLongitude = Math.max(highLongitude, position.longitude);
  }
  const centreLatitude = (lowLatitude + highLatitude) / 2;
  const centreLongitude = (lowLongitude + highLongitude) / 2;
  const longitudeScale = Math.cos((centreLatitude * Math.PI) / 180);
  const width = (highLongitude - lowLongitude) * longitudeScale;
  const height = highLatitude - lowLatitude;
  const span = Math.max(width, height);
  // ⚠️ ONE scale for both axes. `Math.max` of the two spans is what makes the
  // fit uniform: taking each axis's own span would stretch the route to fill
  // the box and turn a circuit into an ellipse.
  //
  // A route with no extent at all — every sample in the same place, which only
  // a hand-edited row produces — has no span to divide by. Scale zero draws it
  // as a dot in the middle, which is honest; dividing by zero is not.
  const scale = span > 0 ? (PLAN_SIZE - 2 * PLAN_PADDING) / span : 0;
  return { centreLongitude, centreLatitude, longitudeScale, scale };
}

/**
 * The route, projected and split at its breaks.
 *
 * @see PLAN_BREAK_FACTOR for what counts as a break and why.
 */
export function routePlan(profile: RouteProfile): RoutePlan {
  const positions = profile.positions;
  const projection = projectionFor(positions);
  const breakAbove = PLAN_BREAK_FACTOR * profile.resolution;
  // ⚠️ **Decided over the WHOLE route and applied inside each run**, so a
  // break is found before anything is dropped. Deciding it per run would give a
  // two-point fragment the same budget as the ten kilometres beside it, and
  // deciding it after decimation would let the decimation step straight over a
  // jump — which is the one thing this function exists to preserve.
  const stride = Math.max(1, Math.ceil(positions.length / PLAN_MAX_POINTS));
  const runs: PlanRun[] = [];
  let points: PlanPoint[] = [];
  let from = 0;
  const closeRun = (endsAt: number): void => {
    if (points.length === 0) {
      return;
    }
    // The run's last position, always. Dropping it would shorten the drawn road
    // by up to a stride at every break and at the finish — visible as a route
    // that stops before its own end on exactly the long routes the bound
    // exists for.
    const last = positions[endsAt] as GeographicPosition;
    const tail = planPoint(projection, last);
    const previous = points[points.length - 1] as PlanPoint;
    if (previous.x !== tail.x || previous.y !== tail.y) {
      points.push(tail);
    }
    runs.push({ from, points });
    points = [];
  };
  for (let index = 0; index < positions.length; index += 1) {
    const position = positions[index] as GeographicPosition;
    if (index > 0) {
      const previous = positions[index - 1] as GeographicPosition;
      if (distanceBetween(previous, position) > breakAbove) {
        closeRun(index - 1);
        from = index;
      }
    }
    // The first point of a run is always kept — `index === from` — so a run is
    // never empty and its start is never a stride late.
    if (index === from || (index - from) % stride === 0) {
      points.push(planPoint(projection, position));
    }
  }
  closeRun(positions.length - 1);
  return { projection, runs };
}

/** One run as an SVG `d`. */
export function planPath(run: PlanRun): string {
  return run.points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');
}

/**
 * Where the rider's mark goes, for an odometer reading.
 *
 * ⚠️ **Through `positionAt`, which wraps a loop — #285's fourth criterion and
 * #253's trap one screen over.** Every distance in this game is an *unwrapped*
 * odometer: on lap two of a 5 km loop the rider's own distance is 7 500, and
 * the geometry only has 5 000 metres of it. `positionAt` composes
 * `distanceOnRoute`, which wraps for a loop and clamps for a point-to-point
 * route, so the mark is where the rider actually is on both.
 *
 * Reusing that function rather than wrapping the odometer here is the same call
 * `scene.ts` §`nearestPoint` makes and for the same reason: wrapping the
 * odometer would place this mark correctly and break every gap in the HUD,
 * because `pacer/gap.ts` is right that a bot a lap ahead must read as a lap
 * ahead.
 */
export function riderMark(plan: RoutePlan, profile: RouteProfile, distance: number): PlanPoint {
  return planPoint(plan.projection, positionAt(profile, distance));
}

/**
 * How far round the route the rider is, as a fraction in `[0, 1)`.
 *
 * ⚠️ **Wrapped, where `fields.ts` §`profilePosition` is clamped**, and the
 * difference is the whole of this panel's fourth criterion. That function feeds
 * the elevation strip, which is a picture of the route's *profile* and stops at
 * its end; this one feeds a mark on the route's *geometry*, which a rider on lap
 * two is still moving along. A clamped fraction here would pin the mark to the
 * finish line for the rest of the ride.
 */
export function planProgress(profile: RouteProfile, distance: number): number {
  const total = profile.totalDistance as number;
  if (!(total > 0)) {
    return 0;
  }
  return distanceOnRoute(profile, distance) / total;
}

/**
 * Which lap of a loop the rider is on, counting from one.
 *
 * `undefined` for a route that is not a loop, because there is no second lap to
 * be on and "lap 1" of a point-to-point climb is noise in a sentence read at
 * arm's length.
 */
export function planLap(profile: RouteProfile, distance: number): number | undefined {
  const total = profile.totalDistance as number;
  if (!profile.loop || !(total > 0) || !Number.isFinite(distance) || distance < 0) {
    return undefined;
  }
  return Math.floor(distance / total) + 1;
}

/**
 * The drawing in one sentence, for a rider who is not looking at it.
 *
 * The same half `TraceChart.tsx` §`describeTrace` provides, and for the same
 * reason: `role="img"` with a description rather than a bare `<svg>`, because
 * without one a screen reader announces a group full of unlabelled paths and
 * the audit is satisfied by that while the reader gets nothing.
 *
 * Exported so `plan.test.ts` asserts the sentence rather than a rendered
 * attribute — a description that stops mentioning the breaks should fail a test
 * that reads it, not one that greps the DOM.
 */
export function describePlan(
  profile: RouteProfile,
  distance: number,
  plan: RoutePlan = routePlan(profile),
): string {
  if (plan.runs.length === 0) {
    return 'Route in plan: this route has no points to draw.';
  }
  const percent = Math.round(planProgress(profile, distance) * 100);
  const lap = planLap(profile, distance);
  const where = profile.loop
    ? `${String(percent)} per cent of the way round the loop` +
      (lap === undefined ? '' : `, on lap ${String(lap)}`)
    : `${String(percent)} per cent of the way along the route`;
  const broken =
    plan.runs.length === 1
      ? ''
      : ` The route is drawn in ${String(plan.runs.length)} parts, where its points jump.`;
  return `Route in plan, north up. You are ${where}.${broken}`;
}
