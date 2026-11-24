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
   * #3052, ADR 0096: the street's mapped name, as the map has it, for the
   * junction prompt to name the way by. Absent where the street has none:
   * nothing invents one.
   */
  readonly name?: string | undefined;
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
  /**
   * The id of the way that is the default at `edge.to` in place of D-1.4's:
   * the way back onto the street ridden in on, on the road back of a U-turn
   * made within {@link JUNCTION_LOCK_METRES} of the junction just turned at
   * (#3129, ADR 0088's amendment of 2026-11-24). Absent on every other leg.
   */
  readonly back?: string;
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
    ...(edge.name === undefined ? {} : { name: edge.name }),
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
  #view: RouteProfile | undefined;
  #uTurns = 0;

  /**
   * Starts a ride at the first point of `start`, and reaches
   * {@link ROLLING_AHEAD_METRES} along the default ways.
   *
   * @throws {RouteError} `too-few-points` or `no-distance` for a start street
   * with no length.
   */
  constructor(graph: RollingStreetGraph, start: RollingEdge) {
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
   * The route this one would be were `edgeId` taken at the junction at ride
   * distance `junction`: a NEW route, and this one left exactly as it is —
   * #3051. An open-world ride draws the scenery along every way out of a
   * junction before the rider chooses one, and keeps it after, so a choice
   * replaces nothing the rider can see; and the ways out of the junctions
   * along such a way are read off the route that takes it. Its view holds the
   * samples {@link choose} would give from this route: this road as far as
   * the junction, the way, and the default ways on from there, to within a
   * sample of where this route ends now; the same {@link origin}. No lock
   * applies, because nothing this route holds is taken. `undefined` where
   * there is no such junction on the route or no such way on from it.
   */
  taking(junction: number, edgeId: string): RollingRoute | undefined {
    const index = this.#legs.findIndex((leg) => leg.atNode && leg.end === junction);
    if (index < 0) return undefined;
    const way = this.#waysAfter(this.#legs[index] as Leg).ways.find(
      (candidate) => candidate.edge.id === edgeId,
    );
    if (way === undefined) return undefined;
    // A route of its own, on any street this one holds, then given what this
    // one holds: every leg and sample is a value no method changes in place.
    const other = new RollingRoute(this.#graph, (this.#legs[0] as Leg).edge);
    const put = <T>(into: T[], from: readonly T[]): void => {
      into.length = 0;
      for (const each of from) into.push(each);
    };
    put(other.#legs, this.#legs);
    put(other.#positions, this.#positions);
    put(other.#heights, this.#heights);
    put(other.#despiked, this.#despiked);
    put(other.#grades, this.#grades);
    other.#first = this.#first;
    other.#uTurns = this.#uTurns;
    other.#view = undefined;
    other.#cutAfter(index, junction);
    other.#push(way.edge, 'chosen', junction, 0);
    // A rider a reach and a sample short of the end: the tail is extended to
    // within a sample of the same end, and nothing behind is trimmed, since
    // this route was last settled for a rider further on than that.
    other.#settle(this.end - ROLLING_AHEAD_METRES - ROLLING_RESOLUTION_METRES);
    return other;
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
   *
   * **A U-turn within {@link JUNCTION_LOCK_METRES} past a junction undoes the
   * turn** (#3129, ADR 0088's amendment of 2026-11-24): the road back takes,
   * as its default at that junction, the way back onto the street the rider
   * came along, in place of D-1.4's. That junction is inside the lock as soon
   * as the rider faces it, so no press could choose it; the U-turn sets it,
   * and the U-turn already changes the road under the rider at once (ADR 0087
   * D-6.4). Further past the junction D-1.4's default stands, and a press
   * before the lock chooses there as at any junction.
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
    // The street ridden in on, when the leg turned on began at the junction
    // whose lock the rider is now inside. The `atNode` and `end` checks are
    // defensive: legs are contiguous, so no test can make them false.
    const before = this.#legs[index - 1];
    const back =
      before?.atNode === true &&
      before.end === leg.start &&
      turn - leg.start <= JUNCTION_LOCK_METRES
        ? before.edge.id
        : undefined;
    this.#push(reversed(leg.edge), 'u-turn', turn, length - cut, back);
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

  /** The ways on from `leg`'s end, and its default: D-1.4's, or the way {@link Leg.back} names. */
  #waysAfter(leg: Leg): ReturnType<typeof waysOn> {
    const found = waysOn(leg.edge, this.#graph.edgesFrom(leg.edge.to));
    if (leg.back === undefined) return found;
    const back = found.ways.find((way) => way.edge.id === leg.back);
    return back === undefined ? found : { ways: found.ways, defaultWay: back };
  }

  #push(
    edge: RollingEdge,
    kind: RollingLegKind,
    start: number,
    enter: number,
    back?: string,
  ): void {
    const along = cumulative(edge.points);
    const length = along[along.length - 1] as number;
    const end = start + length - enter;
    this.#legs.push(
      back === undefined
        ? { edge, kind, start, end, along, enter, atNode: true }
        : { edge, kind, start, end, along, enter, atNode: true, back },
    );
  }

  /** Drops every leg after `index` and every sample past ride distance `distance`. */
  #cutAfter(index: number, distance: number): void {
    this.#legs.length = index + 1;
    const keep = Math.floor(distance / ROLLING_RESOLUTION_METRES) - this.#first + 1;
    if (keep < this.#positions.length) {
      this.#positions.length = keep;
      this.#heights.length = keep;
      this.#despiked.length = keep;
      this.#grades.length = keep;
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
      this.#heights.push(elevation);
    }
    if (this.#positions.length > firstNew) this.#refit(firstNew);
    this.#trim(rider);
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
    for (let index = slopeFrom; index < count; index += 1) {
      let weighted = 0;
      for (let offset = -SLOPE_HALF; offset <= SLOPE_HALF; offset += 1) {
        weighted += offset * clamped(this.#despiked, index + offset);
      }
      this.#grades.push((weighted / (ROLLING_RESOLUTION_METRES * SLOPE_SQUARES)) * 100);
    }
  }

  /** Drops the samples and legs more than the reach behind `rider`. */
  #trim(rider: number): void {
    const first = Math.floor((rider - ROLLING_BEHIND_METRES) / ROLLING_RESOLUTION_METRES);
    const drop = first - this.#first;
    if (drop <= 0) return;
    this.#positions.splice(0, drop);
    this.#heights.splice(0, drop);
    this.#despiked.splice(0, drop);
    this.#grades.splice(0, drop);
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
