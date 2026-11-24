// SPDX-License-Identifier: Apache-2.0

/**
 * The rolling route — #2895, under ADR 0087 D-4.1 and D-6 and ADR 0088 D-1.
 *
 * An open-world ride (#2880) has no route in advance: the road ahead is
 * whichever street the rider takes at the next junction. Almost everything in
 * the game reads "distance along a {@link RouteProfile}", so the open-world
 * ride keeps that and gives the game a profile that **grows**: the street being
 * ridden, plus the default way on at each junction appended far enough ahead
 * for the view and the HUD's look-ahead, with the tail past a junction replaced
 * when the rider chooses another way.
 *
 * ## What `routeProfile` would not do, and what this does instead
 *
 * The spike #2882 (`docs/spikes/0041-rolling-route-and-a-turning-ride.md`,
 * "What `RouteProfile` / `routeProfile` had to change") listed them:
 *
 * 1. **The grid is stretched** to land on the route's end, so a road whose
 *    length changes moves every sample. Here sample `k` is exactly
 *    `k × ROLLING_RESOLUTION_METRES` from the ride's start, and a sample once
 *    taken never moves (ADR 0087 D-4.1).
 * 2. **The windows are counted, not derived from a spacing**: a median over
 *    {@link ROLLING_DESPIKE_SAMPLES} and a least-squares slope over
 *    {@link ROLLING_SLOPE_SAMPLES}, the counts `routeProfile` gives a 10 m
 *    spacing. The filters themselves are `routeProfile`'s, and
 *    `rolling.test.ts` holds that the two agree on the same road.
 * 3. **The arrays are fixed.** A consumer may hold a profile's arrays, so
 *    {@link RollingRoute.view} hands out a NEW `RouteProfile` after every change
 *    and the same object otherwise; a holder of an old one is never changed
 *    under it.
 * 4. **The grade near the end is provisional**, because its window runs past
 *    the road known so far. Every change fits again the samples whose windows
 *    reach it, and no others, so a change at distance `d` touches no grade
 *    before `d − 70 m` (two samples of median, five of slope).
 * 5. **The ridden road is trimmed**, to {@link ROLLING_BEHIND_METRES} behind
 *    the rider, so an hour's ride does not grow without limit
 *    ({@link ROLLING_MOST_SAMPLES}). That moves the first sample, so a view's
 *    distance zero is the route's {@link RollingRoute.origin}, not the ride's
 *    start: a consumer reads ride distance `d` at `d − origin`.
 *
 * ## Grade safety
 *
 * ADR 0087 D-6.1: on this grid the grade sent at `s` reads the road up to
 * `s + 80 m` and no further. So a junction's choice is final
 * {@link JUNCTION_LOCK_METRES} before it ({@link RollingRoute.choose} refuses
 * one after that), and the route always reaches {@link ROLLING_AHEAD_METRES}
 * ahead, past D-6.3's 180 m. A U-turn and a dead end's turn-round change the
 * road under the rider at once; those are tail replacements here, and the grade
 * path walks them at 1 % a second (D-6.4), which is the app's job, not this
 * module's.
 *
 * ## Real heights (#2899, ADR 0087 D-3, D-4, D-7)
 *
 * A route may be given a {@link RollingHeights}: the ground's height at a
 * place, read from height tiles the rider did not choose. Each sample then
 * takes its height from it, at the sample's own place on the 10 m grid, and an
 * edge's own `elevation`s are not read. Three things follow, and none applies
 * to a route with no such source:
 *
 * 1. **A height may be unknown.** Where the source has none (no tile held yet,
 *    outside the archive, a tile that was refused) the sample is no-data. It
 *    holds the height before it, so the road is drawn level there, and **a
 *    grade whose median or slope window holds any no-data sample is itself
 *    unavailable** (ADR 0087's amendment of 2026-11-20): its grade reads 0 %
 *    and {@link RollingRoute.gradeKnownAt} says so, and the app walks the
 *    grade it sends there to 0 % at 1 % a second (D-7).
 * 2. **Two neighbouring samples more than {@link ROLLING_MOST_STEP_METRES}
 *    apart are both no-data** (D-3's last row): the ±40 % a trainer is ever
 *    sent. A hostile tile whose heights all sit inside the valid range could
 *    otherwise take the grade to the clamp from one second to the next.
 * 3. **A bridge or a tunnel is level between its ends** (D-4.3). A run of
 *    {@link RollingEdge.span} streets takes the straight line between the
 *    ground where it starts and the ground where it ends, never the valley
 *    under it. Until the road past the run is known, its samples are no-data.
 *
 * {@link RollingRoute.refill} asks again for every sample that had no height,
 * for a tile that arrived late. That changes heights the rider may be on, so
 * it is one of the changes the app walks at 1 % a second (D-6.4).
 *
 * ## What it knows of the street graph
 *
 * Only {@link RollingStreetGraph}: the edges that leave a node. The graph is
 * #2894's; this module walks it and never builds it. Which way is the default
 * at a junction is ADR 0088 D-1.4's rule, {@link waysOn}.
 *
 * Nothing here reads a clock or a random source, and no message names a
 * position or a node (ADR 0004 D).
 */

import { bearingDifference, distanceBetween, initialBearing } from '../geodesy';
import type { AltitudeMetres, DegreesBearing, GeographicPosition } from '../quantities';
import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  gradePercent,
  metres,
} from '../quantities';
import { RouteError } from './errors';
import {
  DESPIKE_WINDOW_METRES,
  GRADIENT_WINDOW_METRES,
  PROFILE_RESOLUTION_METRES,
  recordedAscent,
  type RouteProfile,
} from './profile';

/**
 * The steepest grade a trainer is ever sent, in percent: **40**. The same
 * number as `trainer/simulation.ts` §`MAX_SIMULATED_GRADE_PERCENT`, written
 * again here because that module imports this directory;
 * `rolling.heights.test.ts` holds the two equal.
 */
const MOST_GRADE_PERCENT = 40;

/** The spacing, exactly: `routeProfile`'s target, never stretched (ADR 0087 D-4.1). */
export const ROLLING_RESOLUTION_METRES = PROFILE_RESOLUTION_METRES;

/**
 * The median's window, in samples: **5**, the count `routeProfile` gives
 * {@link DESPIKE_WINDOW_METRES} at a 10 m spacing (`round(30 / 10 / 2) = 2`
 * either side). Fixed, never derived from a spacing (ADR 0087 D-4.1).
 */
export const ROLLING_DESPIKE_SAMPLES =
  2 * Math.round(DESPIKE_WINDOW_METRES / ROLLING_RESOLUTION_METRES / 2) + 1;

/** The slope's window, in samples: **11**, as {@link ROLLING_DESPIKE_SAMPLES} is 5. */
export const ROLLING_SLOPE_SAMPLES =
  2 * Math.round(GRADIENT_WINDOW_METRES / ROLLING_RESOLUTION_METRES / 2) + 1;

/**
 * The most two neighbouring samples of a height source may differ by:
 * **4 m**, the ±40 % grade a trainer is ever sent over one 10 m sample
 * (ADR 0087 D-3's last row). A bigger step makes both samples no-data.
 */
export const ROLLING_MOST_STEP_METRES = (MOST_GRADE_PERCENT / 100) * ROLLING_RESOLUTION_METRES;

/**
 * The ground's height at a place, in metres, or `undefined` where it is not
 * known: no height tile is held there yet, the place is outside the archive,
 * or its tile was refused. Read from untrusted tiles, so the route holds what
 * it answers to {@link ROLLING_MOST_STEP_METRES}.
 */
export type RollingHeights = (position: GeographicPosition) => number | undefined;

/** What a {@link RollingRoute} may be given beside its graph and its start. */
export interface RollingRouteOptions {
  /** Where the road's heights come from. Absent: each edge's own `elevation`s. */
  readonly heights?: RollingHeights | undefined;
}

/**
 * A junction's choice is final when the rider is this close to it: **100 m**
 * (ADR 0087 D-6.2, ADR 0088 D-1.5). 80 m of the grade's reach and two samples
 * of margin.
 */
export const JUNCTION_LOCK_METRES = 100;

/**
 * How far ahead of the rider the route always reaches: **2 km**, the HUD's
 * look-ahead (`apps/web/src/game/hud/look-ahead.ts`), which is further than the
 * view's 400 m and ADR 0087 D-6.3's 180 m. *#2895's choice.*
 */
export const ROLLING_AHEAD_METRES = 2_000;

/**
 * How much ridden road is kept behind the rider: **1 km**. Well past the
 * 140 m a U-turn's refit reads back, and past anything drawn behind the chase
 * camera. *#2895's choice.*
 */
export const ROLLING_BEHIND_METRES = 1_000;

/**
 * The most samples a route ever holds after {@link RollingRoute.advance}:
 * the road behind and ahead, plus the sample either end that straddles a
 * bound. At 10 m, 302 samples, whatever the ride's length.
 */
export const ROLLING_MOST_SAMPLES =
  (ROLLING_BEHIND_METRES + ROLLING_AHEAD_METRES) / ROLLING_RESOLUTION_METRES + 2;

/**
 * A way shorter than this is not a way on: **1 m**. The graph comes from map
 * tiles, which are untrusted input (#2880's hard rules); a cycle of edges a
 * hair long would otherwise let the route walk them without end while it tries
 * to reach {@link ROLLING_AHEAD_METRES}.
 */
export const ROLLING_LEAST_WAY_METRES = 1;

/** A point of a street: where it is, and how high. */
export interface RollingPoint {
  readonly position: GeographicPosition;
  readonly elevation: AltitudeMetres;
}

/** One street between two nodes of the graph, oriented away from `from`. */
export interface RollingEdge {
  /**
   * The way's id: the street's, the same whichever way it is ridden — except a
   * loop's (`from === to`), whose two ways leave the same node and must be
   * told apart by a choice (#2990), so they carry two ids and one
   * {@link street}.
   */
  readonly id: string;
  /**
   * The street the way is, when that is not {@link id}: a loop's two ways
   * name it. The way back from a node is any way of the street arrived on.
   */
  readonly street?: string | undefined;
  readonly from: string;
  readonly to: string;
  /** From `from` to `to`. At least two, and longer than {@link ROLLING_LEAST_WAY_METRES}. */
  readonly points: readonly RollingPoint[];
  /** Higher is the bigger road. Breaks a tie in ADR 0088 D-1.4's default. */
  readonly roadClass: number;
  /**
   * That the street is on a bridge or in a tunnel (the map's `is_bridge` and
   * `is_tunnel`). With a {@link RollingHeights}, its height is the straight
   * line between the ground at the two ends of the run of such streets it is
   * part of (ADR 0087 D-4.3).
   */
  readonly span?: boolean | undefined;
}

/** What the rolling route reads of the street graph (#2894). */
export interface RollingStreetGraph {
  /** Every edge that leaves `node`, each oriented away from it. */
  edgesFrom(node: string): readonly RollingEdge[];
}

/** One way on from a junction, with how far it turns. */
export interface RollingWay {
  readonly edge: RollingEdge;
  /** The change of bearing onto it: negative is left, positive right. */
  readonly turnDegrees: number;
}

/** How a leg came to be on the route. */
export type RollingLegKind = 'start' | 'default' | 'chosen' | 'turn-round' | 'u-turn';

/** One stretch of one street on the route, between two ride distances. */
export interface RollingLeg {
  readonly edge: RollingEdge;
  readonly kind: RollingLegKind;
  /** The ride distance where the leg starts. */
  readonly start: number;
  /** The ride distance where it ends: at `edge.to`, unless a U-turn cut it. */
  readonly end: number;
}

/** A junction on the route, with the ways on from it. */
export interface RollingJunction {
  /** The ride distance of the junction. */
  readonly distance: number;
  /** Every way on, from the furthest left to the furthest right. Never the way back. */
  readonly ways: readonly RollingWay[];
  /** The edge id of ADR 0088 D-1.4's default. */
  readonly defaultWay: string;
  /** The edge id the route follows past it now. */
  readonly taken: string;
}

/** What {@link RollingRoute.choose} did. */
export type RollingChoice =
  /** The tail past the junction now follows the chosen way. */
  | 'swapped'
  /** The route already took that way. */
  | 'unchanged'
  /** The rider is within {@link JUNCTION_LOCK_METRES} of the junction, or past it. */
  | 'locked'
  /** No junction of the route is at that distance. */
  | 'no-junction'
  /** That edge is not a way on from that junction. */
  | 'no-such-way';

interface Leg extends RollingLeg {
  /** Cumulative distance along `edge.points`. */
  readonly along: readonly number[];
  /** The offset along the edge where the leg starts. */
  readonly enter: number;
  /** Whether it reaches `edge.to`: false once a U-turn cut it. */
  readonly atNode: boolean;
}

/** Cumulative distance along `points`, from 0. */
function cumulative(points: readonly RollingPoint[]): number[] {
  const along = [0];
  for (let index = 1; index < points.length; index += 1) {
    const step = distanceBetween(
      (points[index - 1] as RollingPoint).position,
      (points[index] as RollingPoint).position,
    );
    along.push((along[index - 1] as number) + step);
  }
  return along;
}

function lengthOf(edge: RollingEdge): number {
  const along = cumulative(edge.points);
  return along[along.length - 1] as number;
}

function reversed(edge: RollingEdge): RollingEdge {
  return {
    id: edge.id,
    ...(edge.street === undefined ? {} : { street: edge.street }),
    from: edge.to,
    to: edge.from,
    points: [...edge.points].reverse(),
    roadClass: edge.roadClass,
    ...(edge.span === true ? { span: true } : {}),
  };
}

/** The bearing of the first stretch of `points` with a length, or `undefined`. */
function firstBearing(points: readonly RollingPoint[]): DegreesBearing | undefined {
  for (let index = 1; index < points.length; index += 1) {
    const bearing = initialBearing(
      (points[0] as RollingPoint).position,
      (points[index] as RollingPoint).position,
    );
    if (bearing !== undefined) return bearing;
  }
  return undefined;
}

/** The bearing of the last stretch of `points` with a length, or `undefined`. */
function lastBearing(points: readonly RollingPoint[]): DegreesBearing | undefined {
  const last = points[points.length - 1] as RollingPoint;
  for (let index = points.length - 2; index >= 0; index -= 1) {
    const bearing = initialBearing((points[index] as RollingPoint).position, last.position);
    if (bearing !== undefined) return bearing;
  }
  return undefined;
}

/** The signed turn from `from` to `to`, in `(-180, 180]`: negative is left. */
function signedTurn(from: DegreesBearing, to: DegreesBearing): number {
  const size = bearingDifference(from, to);
  const clockwise = (((to - from) % 360) + 360) % 360;
  return clockwise <= 180 ? size : -size;
}

/** The street a way is: its {@link RollingEdge.street}, else its id. */
function streetOf(edge: RollingEdge): string {
  return edge.street ?? edge.id;
}

/**
 * The ways on from the node `arriving` ends at, ordered from the furthest left
 * to the furthest right, with ADR 0088 D-1.4's default.
 *
 * The way back (a way of the street `arriving` is, by {@link streetOf}) is
 * never a way on, and nor is a way shorter than {@link ROLLING_LEAST_WAY_METRES}. **The default** is the way
 * with the smallest change of bearing, counted in whole degrees; on a tie, the
 * one of the higher road class; then the right-hand one.
 */
export function waysOn(
  arriving: RollingEdge,
  edges: readonly RollingEdge[],
): { readonly ways: readonly RollingWay[]; readonly defaultWay: RollingWay | undefined } {
  const heading = lastBearing(arriving.points);
  const arrivingStreet = streetOf(arriving);
  const ways: RollingWay[] = [];
  for (const edge of edges) {
    if (streetOf(edge) === arrivingStreet || !(lengthOf(edge) >= ROLLING_LEAST_WAY_METRES)) {
      continue;
    }
    const leaving = firstBearing(edge.points);
    const turnDegrees =
      heading === undefined || leaving === undefined ? 0 : signedTurn(heading, leaving);
    ways.push({ edge, turnDegrees });
  }
  ways.sort((a, b) => a.turnDegrees - b.turnDegrees);
  let defaultWay: RollingWay | undefined;
  for (const way of ways) {
    if (defaultWay === undefined) {
      defaultWay = way;
      continue;
    }
    const size = Math.round(Math.abs(way.turnDegrees));
    const best = Math.round(Math.abs(defaultWay.turnDegrees));
    if (
      size < best ||
      (size === best && way.edge.roadClass > defaultWay.edge.roadClass) ||
      (size === best &&
        way.edge.roadClass === defaultWay.edge.roadClass &&
        way.turnDegrees > defaultWay.turnDegrees)
    ) {
      defaultWay = way;
    }
  }
  return { ways, defaultWay };
}

/** `values[index]`, with the ends replicated, as `routeProfile`'s windows do. */
function clamped(values: readonly number[], index: number): number {
  const last = values.length - 1;
  return values[index < 0 ? 0 : index > last ? last : index] as number;
}

const DESPIKE_HALF = (ROLLING_DESPIKE_SAMPLES - 1) / 2;
const SLOPE_HALF = (ROLLING_SLOPE_SAMPLES - 1) / 2;
// Σ t² over t = -half..half, as `routeProfile`'s `slopes` takes it.
const SLOPE_SQUARES = (SLOPE_HALF * (SLOPE_HALF + 1) * (2 * SLOPE_HALF + 1)) / 3;

/** How many samples either side of a grade's own its height samples lie: 7, 70 m. */
const GRADE_REACH_SAMPLES = DESPIKE_HALF + SLOPE_HALF;

/** A sample's height: read; not known yet, and asked for again; or refused by the step rule, for good. */
const HEIGHT_KNOWN = 0;
const HEIGHT_UNKNOWN = 1;
const HEIGHT_REFUSED = 2;

/**
 * A street-following profile that grows ahead of the rider, swaps its tail at
 * a junction, and drops the road far behind. See the file's header.
 *
 * Mutable, and the web app owns when each method is called; every
 * `RouteProfile` it hands out is immutable.
 */
export class RollingRoute {
  readonly #graph: RollingStreetGraph;
  readonly #legs: Leg[] = [];
  /** The ride-distance index of the first sample held. */
  #first = 0;
  readonly #positions: GeographicPosition[] = [];
  readonly #heights: number[] = [];
  readonly #despiked: number[] = [];
  readonly #grades: number[] = [];
  /** Each sample's {@link HEIGHT_KNOWN}, {@link HEIGHT_UNKNOWN} or {@link HEIGHT_REFUSED}. */
  readonly #state: number[] = [];
  /** Whether each grade's windows hold only known heights. */
  readonly #available: boolean[] = [];
  readonly #source: RollingHeights | undefined;
  #view: RouteProfile | undefined;
  #uTurns = 0;

  /**
   * Starts a ride at the first point of `start`, and reaches
   * {@link ROLLING_AHEAD_METRES} along the default ways.
   *
   * @throws {RouteError} `too-few-points` or `no-distance` for a start street
   * with no length.
   */
  constructor(graph: RollingStreetGraph, start: RollingEdge, options: RollingRouteOptions = {}) {
    if (start.points.length < 2) {
      throw new RouteError(
        'too-few-points',
        `a street needs at least two points to have a length; this one has ${start.points.length}`,
      );
    }
    const along = cumulative(start.points);
    const length = along[along.length - 1] as number;
    if (!(length >= ROLLING_LEAST_WAY_METRES)) {
      throw new RouteError(
        'no-distance',
        `the start street must be at least ${ROLLING_LEAST_WAY_METRES} m long`,
      );
    }
    this.#graph = graph;
    this.#source = options.heights;
    this.#legs.push({
      edge: start,
      kind: 'start',
      start: 0,
      end: length,
      along,
      enter: 0,
      atNode: true,
    });
    this.#settle(0);
  }

  /** The ride distance of the first sample held: a view's distance zero. */
  get origin(): number {
    return this.#first * ROLLING_RESOLUTION_METRES;
  }

  /** The ride distance of the last sample held. */
  get end(): number {
    return (this.#first + this.#positions.length - 1) * ROLLING_RESOLUTION_METRES;
  }

  /**
   * How many U-turns {@link uTurn} has made: a caller that hands the grade on
   * reads it to tell a U-turn, which changes the road under the rider at once
   * (ADR 0087 D-6.4), from every other change, which does not (#2982).
   */
  get uTurns(): number {
    return this.#uTurns;
  }

  /** The legs held, in ride order. */
  get legs(): readonly RollingLeg[] {
    return this.#legs.map(({ edge, kind, start, end }) => ({ edge, kind, start, end }));
  }

  /**
   * Extends the route to {@link ROLLING_AHEAD_METRES} past `rider` along the
   * default ways, and drops what lies more than {@link ROLLING_BEHIND_METRES}
   * behind. Neither moves a sample, a height or a grade the rider has passed.
   * A rider distance that is not a finite number changes nothing: no reach
   * past it is ever met, so extending to it would never end.
   *
   * ⚠️ **A rider more than a reach past the road held is read as a reach
   * past its {@link end}** (#2982, from the review of #2962). The route always
   * reaches {@link ROLLING_AHEAD_METRES} past the last rider it was given, so
   * a rider that far past its end has jumped further than any ride moves
   * between two calls; a 1e9 m slip would otherwise sample a billion metres of
   * street in one call. So one call extends the route by at most twice its
   * reach, and the next goes on from there.
   */
  advance(rider: number): void {
    if (!Number.isFinite(rider)) return;
    this.#settle(Math.min(rider, this.end + ROLLING_AHEAD_METRES));
  }

  /** Every junction with two or more ways on whose way past it is known, after `rider`. */
  junctionsAfter(rider: number): readonly RollingJunction[] {
    const found: RollingJunction[] = [];
    for (let index = 0; index < this.#legs.length - 1; index += 1) {
      const junction = this.#junctionAfterLeg(index, rider);
      if (junction !== undefined) found.push(junction);
    }
    return found;
  }

  /**
   * The first of {@link junctionsAfter}, found without building the others —
   * #2898: the HUD's junction prompt asks for it every frame, and the 2 km
   * ahead can hold a dozen junctions, each of which costs a walk of the graph
   * and a bearing for every way on. The legs are in ride order and each ends
   * where the next starts, so the first leg that ends past the rider is found
   * by halving, and the ways on are worked out only for the legs from there
   * to the first junction.
   */
  nextJunctionAfter(rider: number): RollingJunction | undefined {
    const last = this.#legs.length - 1;
    // The first index in [0, last) whose leg does not end at or before the
    // rider: `junctionsAfter`'s own test, negated, so a rider that is not a
    // number finds what that finds.
    let low = 0;
    let high = last;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((this.#legs[middle] as Leg).end <= rider) low = middle + 1;
      else high = middle;
    }
    for (let index = low; index < last; index += 1) {
      const junction = this.#junctionAfterLeg(index, rider);
      if (junction !== undefined) return junction;
    }
    return undefined;
  }

  /**
   * Takes `edgeId` at the junction at ride distance `junction`, replacing the
   * route past it, unless the rider at `rider` is within
   * {@link JUNCTION_LOCK_METRES} of it (ADR 0087 D-6.2). Nothing before the
   * junction changes, and no grade the rider can have been sent does. A rider
   * distance that is not a finite number is `'locked'`: the lock fails closed.
   */
  choose(junction: number, edgeId: string, rider: number): RollingChoice {
    const index = this.#legs.findIndex((leg) => leg.atNode && leg.end === junction);
    if (index < 0) return 'no-junction';
    if (!Number.isFinite(rider) || junction - rider <= JUNCTION_LOCK_METRES) return 'locked';
    const leg = this.#legs[index] as Leg;
    const way = this.#waysAfter(leg).ways.find((candidate) => candidate.edge.id === edgeId);
    if (way === undefined) return 'no-such-way';
    if (this.#legs[index + 1]?.edge.id === edgeId) return 'unchanged';
    this.#cutAfter(index, junction);
    this.#push(way.edge, 'chosen', junction, 0);
    this.#settle(rider);
    return 'swapped';
  }

  /**
   * Turns the rider round on the street they are on, at the first sample at or
   * after ride distance `rider`: the route past it becomes that street ridden
   * back, and the default ways on from there. Turning on a sample, never
   * between two, is what keeps the position at every distance the rider has
   * reached where it was, so ride distance runs on with no jump. The grade
   * ahead changes at once, which the grade path walks (ADR 0087 D-6.4). A
   * rider distance that is not a finite number turns nothing round, and nor
   * does one outside the road held, behind {@link origin} or past
   * {@link end} (#2982): there is no street there to turn on.
   *
   * A second U-turn on the same sample turns the rider back the way they were
   * going (#2982): the sample is held by the leg the first one cut and the
   * U-turn leg that starts on it, and it is the U-turn leg, the way the rider
   * now faces, that is turned. On a sample where one street meets the next at
   * a node, it is the street ridden in on that is turned, as before.
   */
  uTurn(rider: number): void {
    if (!Number.isFinite(rider)) return;
    const turn = Math.ceil(rider / ROLLING_RESOLUTION_METRES) * ROLLING_RESOLUTION_METRES;
    if (turn < this.origin || turn > this.end) return;
    // The road held runs from the origin to the end without a gap, so a leg
    // holds `turn`. A leg that only starts there holds it for a U-turn made on
    // this sample, and for no other: elsewhere the leg that ends there does.
    const holds = (leg: Leg): boolean =>
      leg.start <= turn && turn <= leg.end && (leg.start < turn || leg.kind === 'u-turn');
    let index = this.#legs.length - 1;
    while (index > 0 && !holds(this.#legs[index] as Leg)) index -= 1;
    const leg = this.#legs[index] as Leg;
    const cut = leg.enter + (turn - leg.start);
    this.#legs[index] = { ...leg, end: turn, atNode: false };
    this.#cutAfter(index, turn);
    const length = leg.along[leg.along.length - 1] as number;
    this.#push(reversed(leg.edge), 'u-turn', turn, length - cut);
    this.#uTurns += 1;
    this.#settle(rider);
  }

  /**
   * Takes a way on, along the default ways, where the route turned round at a
   * dead end that is one no longer (#2990): an open-world ride's graph grows as
   * the map round the rider is read, and a street that ended at the edge of
   * the map held goes on once the next block is. The first such turn-round
   * more than {@link JUNCTION_LOCK_METRES} ahead of `rider` is replaced, as
   * {@link choose} replaces a tail, so no grade the rider can have been sent
   * changes (ADR 0087 D-6.1); one nearer is ridden as it is. Returns whether
   * the route changed. A rider distance that is not a finite number changes
   * nothing: the lock fails closed.
   */
  reopen(rider: number): boolean {
    if (!Number.isFinite(rider)) return false;
    for (let index = 1; index < this.#legs.length; index += 1) {
      const leg = this.#legs[index] as Leg;
      if (leg.kind !== 'turn-round' || leg.start - rider <= JUNCTION_LOCK_METRES) continue;
      const before = this.#legs[index - 1] as Leg;
      const { defaultWay } = this.#waysAfter(before);
      if (defaultWay === undefined) continue;
      this.#cutAfter(index - 1, before.end);
      this.#push(defaultWay.edge, 'default', before.end, 0);
      this.#settle(rider);
      return true;
    }
    return false;
  }

  /**
   * Whether the grade at ride distance `rider` rests on known heights: false
   * where the median or the slope window of either grid sample round it holds
   * a no-data sample, and false off the road held. Always true on it for a
   * route with no height source.
   *
   * Where it is false the view's grade reads 0 %, and the app sends 0 %,
   * walked to at 1 % a second (ADR 0087 D-7).
   */
  gradeKnownAt(rider: number): boolean {
    const at = (rider - this.origin) / ROLLING_RESOLUTION_METRES;
    const last = this.#available.length - 1;
    if (!(at >= 0 && at <= last)) return false;
    const before = Math.floor(at);
    return this.#available[before] === true && this.#available[Math.min(last, before + 1)] === true;
  }

  /**
   * Ask the height source again for every sample that had no height, and fit
   * the grades they reach. True when any was filled, which is a new view.
   *
   * For a height tile that arrived after its road was sampled. ⚠️ It may
   * change the heights under the rider, so the app walks the grade it sends
   * to the new one at 1 % a second (ADR 0087 D-6.4).
   */
  refill(): boolean {
    const first = this.#fill();
    if (first === undefined) return false;
    this.#refit(Math.max(0, first - 1));
    return true;
  }

  /**
   * The route as the game reads a profile: a new object after every change,
   * the same one otherwise. Its distance zero is {@link origin}.
   */
  view(): RouteProfile {
    if (this.#view !== undefined) return this.#view;
    const count = this.#positions.length;
    const ascent = recordedAscent(this.#despiked) ?? 0;
    // A descent is an ascent ridden the other way: the same run rule.
    const descent = recordedAscent(this.#despiked.map((value) => -value)) ?? 0;
    this.#view = {
      loop: false,
      resolution: metres(ROLLING_RESOLUTION_METRES),
      totalDistance: metres((count - 1) * ROLLING_RESOLUTION_METRES),
      totalAscent: metres(ascent),
      totalDescent: metres(descent),
      elevations: this.#despiked.map((value) => altitudeMetres(value)),
      grades: this.#grades.map((value) => gradePercent(value)),
      positions: this.#positions.slice(),
    };
    return this.#view;
  }

  /** The junction at the end of leg `index`, if it is one after `rider` with two or more ways on. */
  #junctionAfterLeg(index: number, rider: number): RollingJunction | undefined {
    const leg = this.#legs[index] as Leg;
    if (leg.end <= rider || !leg.atNode) return undefined;
    const { ways, defaultWay } = this.#waysAfter(leg);
    if (ways.length < 2 || defaultWay === undefined) return undefined;
    return {
      distance: leg.end,
      ways,
      defaultWay: defaultWay.edge.id,
      taken: (this.#legs[index + 1] as Leg).edge.id,
    };
  }

  #waysAfter(leg: Leg): ReturnType<typeof waysOn> {
    return waysOn(leg.edge, this.#graph.edgesFrom(leg.edge.to));
  }

  #push(edge: RollingEdge, kind: RollingLegKind, start: number, enter: number): void {
    const along = cumulative(edge.points);
    const length = along[along.length - 1] as number;
    this.#legs.push({ edge, kind, start, end: start + length - enter, along, enter, atNode: true });
  }

  /** Drops every leg after `index` and every sample past ride distance `distance`. */
  #cutAfter(index: number, distance: number): void {
    this.#legs.length = index + 1;
    const keep = Math.floor(distance / ROLLING_RESOLUTION_METRES) - this.#first + 1;
    if (keep < this.#positions.length) {
      this.#positions.length = keep;
      this.#heights.length = keep;
      this.#state.length = keep;
      this.#despiked.length = keep;
      this.#grades.length = keep;
      this.#available.length = keep;
      this.#view = undefined;
    }
  }

  /** Extends to `rider` + the reach ahead, then trims to the reach behind. */
  #settle(rider: number): void {
    const firstNew = this.#positions.length;
    const target = rider + ROLLING_AHEAD_METRES;
    let legIndex = 0;
    for (;;) {
      const distance = (this.#first + this.#positions.length) * ROLLING_RESOLUTION_METRES;
      if (this.#positions.length > 0 && distance - ROLLING_RESOLUTION_METRES >= target) break;
      while (legIndex < this.#legs.length && (this.#legs[legIndex] as Leg).end < distance) {
        legIndex += 1;
      }
      if (legIndex === this.#legs.length) {
        this.#extendFrom(this.#legs[legIndex - 1] as Leg);
        continue;
      }
      const leg = this.#legs[legIndex] as Leg;
      const { position, elevation } = pointAlong(leg, leg.enter + (distance - leg.start));
      this.#positions.push(position);
      this.#take(legIndex, distance, position, elevation);
    }
    // A run of bridge streets is sampled before the road past it is known:
    // its samples, and any other with no height yet, are asked for again.
    const filled = this.#fill();
    const taken = this.#positions.length > firstNew ? firstNew : undefined;
    const from = Math.min(taken ?? Infinity, filled ?? Infinity);
    // With a height source the step rule may have made the sample before the
    // first new one no-data, so the fit starts one sample earlier.
    if (Number.isFinite(from))
      this.#refit(this.#source === undefined ? from : Math.max(0, from - 1));
    this.#trim(rider);
  }

  /** One new sample's height: the edge's own, or the height source's. */
  #take(legIndex: number, distance: number, position: GeographicPosition, elevation: number): void {
    const index = this.#heights.length;
    const ground =
      this.#source === undefined ? elevation : this.#ground(legIndex, distance, position);
    if (ground === undefined) {
      // No-data: level with the height before it, so the road is drawn flat there.
      this.#heights.push(index > 0 ? (this.#heights[index - 1] as number) : 0);
      this.#state.push(HEIGHT_UNKNOWN);
      return;
    }
    this.#heights.push(ground);
    this.#state.push(HEIGHT_KNOWN);
    if (this.#source !== undefined) this.#holdStep(index);
  }

  /**
   * ADR 0087 D-3's last row: sample `index` and the one before it, both read
   * from the height source, may differ by {@link ROLLING_MOST_STEP_METRES} at
   * most. Further apart, both are no-data, for good.
   */
  #holdStep(index: number): void {
    if (index < 1) return;
    if (this.#state[index] !== HEIGHT_KNOWN || this.#state[index - 1] !== HEIGHT_KNOWN) return;
    const here = this.#heights[index] as number;
    const before = this.#heights[index - 1] as number;
    if (Math.abs(here - before) <= ROLLING_MOST_STEP_METRES) return;
    this.#state[index - 1] = HEIGHT_REFUSED;
    this.#state[index] = HEIGHT_REFUSED;
  }

  /**
   * The height source's answer for the sample at `distance` on leg
   * `legIndex`: the ground there, or, on a bridge or in a tunnel, the straight
   * line between the ground at the two ends of its run of span legs.
   * `undefined` where it is not known.
   */
  #ground(legIndex: number, distance: number, position: GeographicPosition): number | undefined {
    const source = this.#source as RollingHeights;
    const at = (place: GeographicPosition): number | undefined => {
      const height = source(place);
      return height !== undefined && Number.isFinite(height) ? height : undefined;
    };
    const legs = this.#legs;
    if ((legs[legIndex] as Leg).edge.span !== true) return at(position);
    let first = legIndex;
    while (first > 0 && (legs[first - 1] as Leg).edge.span === true) first -= 1;
    let last = legIndex;
    while (last + 1 < legs.length && (legs[last + 1] as Leg).edge.span === true) last += 1;
    // The run may go on past the road held: its far end is not known yet.
    if (last === legs.length - 1) return undefined;
    const from = legs[first] as Leg;
    const to = legs[last] as Leg;
    const start = at(pointAlong(from, from.enter).position);
    const end = at(pointAlong(to, to.enter + (to.end - to.start)).position);
    if (start === undefined || end === undefined) return undefined;
    const length = to.end - from.start;
    return length > 0 ? start + ((end - start) * (distance - from.start)) / length : start;
  }

  /**
   * Ask the height source again for every sample still unknown. The index of
   * the first one filled, or `undefined` when none was.
   */
  #fill(): number | undefined {
    if (this.#source === undefined) return undefined;
    let first: number | undefined;
    let legIndex = 0;
    const legs = this.#legs;
    for (let index = 0; index < this.#heights.length; index += 1) {
      if (this.#state[index] !== HEIGHT_UNKNOWN) continue;
      const distance = (this.#first + index) * ROLLING_RESOLUTION_METRES;
      while (legIndex < legs.length - 1 && (legs[legIndex] as Leg).end < distance) legIndex += 1;
      const ground = this.#ground(legIndex, distance, this.#positions[index] as GeographicPosition);
      if (ground === undefined) continue;
      this.#heights[index] = ground;
      this.#state[index] = HEIGHT_KNOWN;
      first ??= index;
    }
    if (first === undefined) return undefined;
    // A sample still unknown holds the height before it, which may have changed.
    for (let index = Math.max(1, first); index < this.#heights.length; index += 1) {
      if (this.#state[index] === HEIGHT_UNKNOWN) {
        this.#heights[index] = this.#heights[index - 1] as number;
      }
    }
    for (let index = Math.max(1, first); index < this.#heights.length; index += 1) {
      this.#holdStep(index);
    }
    return first;
  }

  /** Whether every height sample grade `index` reads is known. */
  #knownAround(index: number): boolean {
    const last = this.#state.length - 1;
    for (let offset = -GRADE_REACH_SAMPLES; offset <= GRADE_REACH_SAMPLES; offset += 1) {
      const at = Math.min(last, Math.max(0, index + offset));
      if (this.#state[at] !== HEIGHT_KNOWN) return false;
    }
    return true;
  }

  /** Appends the default way on from `last`'s end, or turns round at a dead end. */
  #extendFrom(last: Leg): void {
    const { defaultWay } = this.#waysAfter(last);
    if (defaultWay === undefined) {
      this.#push(reversed(last.edge), 'turn-round', last.end, 0);
    } else {
      this.#push(defaultWay.edge, 'default', last.end, 0);
    }
  }

  /** Fits again every sample whose windows reach the local index `firstNew`. */
  #refit(firstNew: number): void {
    this.#view = undefined;
    const count = this.#heights.length;
    const despikeFrom = Math.max(0, firstNew - DESPIKE_HALF);
    this.#despiked.length = Math.min(this.#despiked.length, despikeFrom);
    for (let index = despikeFrom; index < count; index += 1) {
      const window: number[] = [];
      for (let offset = -DESPIKE_HALF; offset <= DESPIKE_HALF; offset += 1) {
        window.push(clamped(this.#heights, index + offset));
      }
      window.sort((a, b) => a - b);
      this.#despiked.push(window[DESPIKE_HALF] as number);
    }
    const slopeFrom = Math.max(0, despikeFrom - SLOPE_HALF);
    this.#grades.length = Math.min(this.#grades.length, slopeFrom);
    this.#available.length = Math.min(this.#available.length, slopeFrom);
    for (let index = slopeFrom; index < count; index += 1) {
      let weighted = 0;
      for (let offset = -SLOPE_HALF; offset <= SLOPE_HALF; offset += 1) {
        weighted += offset * clamped(this.#despiked, index + offset);
      }
      // A grade that reads a no-data height is unavailable, and reads 0 %.
      const known = this.#knownAround(index);
      this.#available.push(known);
      this.#grades.push(known ? (weighted / (ROLLING_RESOLUTION_METRES * SLOPE_SQUARES)) * 100 : 0);
    }
  }

  /** Drops the samples and legs more than the reach behind `rider`. */
  #trim(rider: number): void {
    const first = Math.floor((rider - ROLLING_BEHIND_METRES) / ROLLING_RESOLUTION_METRES);
    const drop = first - this.#first;
    if (drop <= 0) return;
    this.#positions.splice(0, drop);
    this.#heights.splice(0, drop);
    this.#state.splice(0, drop);
    this.#despiked.splice(0, drop);
    this.#grades.splice(0, drop);
    this.#available.splice(0, drop);
    this.#first = first;
    this.#view = undefined;
    const origin = this.origin;
    let gone = 0;
    while (gone < this.#legs.length - 1 && (this.#legs[gone] as Leg).end < origin) gone += 1;
    this.#legs.splice(0, gone);
  }
}

/** The point `offset` metres along `leg`'s edge, by linear interpolation. */
function pointAlong(leg: Leg, offset: number): { position: GeographicPosition; elevation: number } {
  const { along } = leg;
  const points = leg.edge.points;
  let low = 0;
  let high = along.length - 1;
  while (low < high - 1) {
    const middle = Math.floor((low + high) / 2);
    if ((along[middle] as number) <= offset) low = middle;
    else high = middle;
  }
  const span = (along[high] as number) - (along[low] as number);
  const share = span > 0 ? Math.min(1, Math.max(0, (offset - (along[low] as number)) / span)) : 0;
  const from = points[low] as RollingPoint;
  const to = points[high] as RollingPoint;
  return {
    position: geographicPosition(
      degreesLatitude(
        from.position.latitude + (to.position.latitude - from.position.latitude) * share,
      ),
      degreesLongitude(
        from.position.longitude + (to.position.longitude - from.position.longitude) * share,
      ),
    ),
    elevation: from.elevation + (to.elevation - from.elevation) * share,
  };
}
