// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The route a rider is drawing, as a value — [#71](https://github.com/openzigs/onyourleft/issues/71).
 *
 * ## Why this is a pure core with the canvas on top
 *
 * The same split `segments/create.ts` and `workouts/build.ts` use. #71's two
 * hardest criteria are both about *what happened*, not about what was drawn:
 *
 * - *"Moving one waypoint of a five-waypoint route re-routes **only the two
 *   adjacent legs**, asserted by counting routing-provider calls, not by
 *   looking at it."*
 * - *"Undo and redo cover waypoint add, move, delete, reverse and clear, and a
 *   test performs twenty mixed operations then undoes all of them and asserts
 *   the route is empty."*
 *
 * Neither is answerable through a DOM. So every operation here is a pure
 * function from one draft to the next, the set of legs that consequently need
 * routing is part of the **return value** rather than something a later pass
 * infers, and {@link resolveDraft} is the only thing that ever talks to an
 * engine.
 *
 * ⚠️ **A stale leg is computed at the edit, not diffed afterwards.** The
 * tempting alternative — re-route any leg whose endpoints changed — sounds
 * equivalent and is not: it cannot tell a leg that moved from a leg that was
 * *inserted*, so a mid-route insertion re-routes the whole tail. Counting calls
 * is exactly the assertion that catches that, which is presumably why #71 asks
 * for it in those words.
 *
 * ## Nothing here reads a clock or a random source
 *
 * Waypoint ids come from a counter carried in the draft. `crypto.randomUUID`
 * would make every draft unequal to a re-run of itself, and #71's last
 * criterion round-trips a draft through storage and compares it.
 */

import type {
  GeographicPosition,
  Metres,
  RidingPreferences,
  RoutedLeg,
  RoutingProvider,
  SurfaceKind,
} from '@onyourleft/domain';
import { distanceBetween, metres, RoutingError } from '@onyourleft/domain';

/**
 * How a leg's geometry was arrived at.
 *
 * ⚠️ **Recorded per leg, not per route**, because #71 requires that *"a route
 * may mix freehand and snapped legs; each leg records which mode produced it so
 * distance and surface are not claimed with false confidence."* A freehand leg
 * is a straight line the rider asserted; its length is a lower bound on the
 * distance they will actually ride, and its surface is not merely unknown to
 * the engine — nobody asked.
 */
export type LegMode = 'snapped' | 'freehand';

/** Where a leg's geometry stands. */
export type LegState =
  /** Needs an engine and has not had one yet. */
  | 'pending'
  /** Has geometry. A freehand leg is `routed` the moment it is created. */
  | 'routed'
  /** The engine refused or could not be reached. @see DraftLeg.failure */
  | 'failed';

export interface DraftWaypoint {
  /** Stable for the life of the waypoint, so a list key and a selection survive an edit. */
  readonly id: string;
  readonly position: GeographicPosition;
}

export interface DraftLeg {
  readonly mode: LegMode;
  readonly state: LegState;
  /** Empty until the leg is routed. */
  readonly shape: readonly GeographicPosition[];
  readonly distance: Metres;
  readonly surface: SurfaceKind;
  /**
   * Why this leg has no geometry, in words a rider can act on.
   *
   * ⚠️ **On the leg rather than on the draft.** #71: *"a routing failure
   * between two waypoints (no path, engine down) is shown on **that leg**, with
   * the rest of the route intact and editable."* A single draft-level error
   * field would make the whole route look broken because one leg is.
   */
  readonly failure: LegFailure | undefined;
}

export interface LegFailure {
  readonly message: string;
  /** Whether asking again could work. Straight from {@link RoutingError.retryable}. */
  readonly retryable: boolean;
}

export interface RouteDraft {
  readonly waypoints: readonly DraftWaypoint[];
  /** Always `max(0, waypoints.length - 1)` long. One leg between each adjacent pair. */
  readonly legs: readonly DraftLeg[];
  /** The next waypoint id. Carried so ids are a function of the edits, not of a clock. */
  readonly nextId: number;
}

/** A draft, and which of its legs now need an engine. Leg indices are zero-based. */
export interface DraftEdit {
  readonly draft: RouteDraft;
  readonly stale: readonly number[];
}

/**
 * The most waypoints one route may carry: **250**.
 *
 * A bound rather than a guess, and the reason is the engine rather than the
 * screen: every waypoint is a leg, and a rider who pastes or click-holds their
 * way to a thousand pins turns one gesture into a thousand HTTP requests. Two
 * hundred and fifty is far past any route drawn by hand — the longest routes in
 * `packages/fit`'s own export tests are a few dozen waypoints — and it is a
 * refusal a rider can see rather than a tab that stops responding. The same
 * argument `MAXIMUM_LEG_POINTS` makes one layer down.
 */
export const MAXIMUM_WAYPOINTS = 250;

const NO_GEOMETRY = {
  shape: [] as readonly GeographicPosition[],
  distance: metres(0),
  surface: 'unknown' as SurfaceKind,
  failure: undefined,
} as const;

export function emptyDraft(): RouteDraft {
  return { waypoints: [], legs: [], nextId: 1 };
}

export function isEmpty(draft: RouteDraft): boolean {
  return draft.waypoints.length === 0;
}

/** The legs whose geometry a rider is still waiting for or has lost. */
export function unresolvedLegs(draft: RouteDraft): readonly number[] {
  return draft.legs.flatMap((leg, index) => (leg.state === 'routed' ? [] : [index]));
}

/**
 * Total distance over the legs that have geometry.
 *
 * ⚠️ **Legs without geometry contribute nothing rather than an estimate.** A
 * pending or failed leg has no length this program knows, and a straight-line
 * stand-in would be a number a rider reads as the route's distance. The screen
 * says how many legs are missing instead.
 */
export function draftDistance(draft: RouteDraft): Metres {
  let total = 0;
  for (const leg of draft.legs) {
    // ⚠️ **The second of two guards, and it is the weaker one.** The first is
    // that {@link resolveDraft} clears a failed leg's geometry — including its
    // distance — so a leg that had a length and then lost its route reports
    // zero here anyway. This check is what keeps that from being the only
    // thing standing between a rider and a total that includes a stretch
    // nobody can ride. Both halves are tests: a mutation of this line alone
    // stays green *because* of the other, which is why the test names the
    // invariant rather than only the sum.
    if (leg.state === 'routed') total += leg.distance;
  }
  return metres(total);
}

/** Add a waypoint at the end. The new last leg is stale unless it is freehand. */
export function addWaypoint(
  draft: RouteDraft,
  position: GeographicPosition,
  mode: LegMode = 'snapped',
): DraftEdit {
  if (draft.waypoints.length >= MAXIMUM_WAYPOINTS) {
    return { draft, stale: [] };
  }
  const waypoints = [...draft.waypoints, { id: idFor(draft), position }];
  if (draft.waypoints.length === 0) {
    return { draft: { ...draft, waypoints, nextId: draft.nextId + 1 }, stale: [] };
  }
  const index = draft.legs.length;
  const legs = [...draft.legs, legFor(mode, waypoints[index]!, waypoints[index + 1]!)];
  return {
    draft: { waypoints, legs, nextId: draft.nextId + 1 },
    stale: mode === 'snapped' ? [index] : [],
  };
}

/**
 * Insert a waypoint into an existing leg, splitting it in two.
 *
 * ⚠️ **Both halves are stale and nothing else is**, which is the case a
 * change-detecting implementation gets wrong: the second half's endpoints are
 * the same two places the old leg ran between at one end and a new point at the
 * other, so "did the endpoints change" answers *yes* for every leg after it
 * once the indices shift.
 */
export function insertWaypoint(
  draft: RouteDraft,
  legIndex: number,
  position: GeographicPosition,
): DraftEdit {
  if (
    legIndex < 0 ||
    legIndex >= draft.legs.length ||
    draft.waypoints.length >= MAXIMUM_WAYPOINTS
  ) {
    return { draft, stale: [] };
  }
  const inserted = { id: idFor(draft), position };
  const waypoints = [
    ...draft.waypoints.slice(0, legIndex + 1),
    inserted,
    ...draft.waypoints.slice(legIndex + 1),
  ];
  const mode = draft.legs[legIndex]!.mode;
  const legs = [
    ...draft.legs.slice(0, legIndex),
    legFor(mode, waypoints[legIndex]!, inserted),
    legFor(mode, inserted, waypoints[legIndex + 2]!),
    ...draft.legs.slice(legIndex + 1),
  ];
  return {
    draft: { waypoints, legs, nextId: draft.nextId + 1 },
    stale: mode === 'snapped' ? [legIndex, legIndex + 1] : [],
  };
}

/**
 * Move one waypoint. **Only the legs on either side of it become stale.**
 *
 * This is #71's second criterion, and the whole reason the stale set is
 * returned rather than derived: a five-waypoint route has four legs, and moving
 * the middle waypoint must produce exactly two engine calls. On a slow
 * connection the difference between two and four is whether the builder feels
 * usable.
 */
export function moveWaypoint(
  draft: RouteDraft,
  id: string,
  position: GeographicPosition,
): DraftEdit {
  const index = draft.waypoints.findIndex((waypoint) => waypoint.id === id);
  if (index === -1) {
    return { draft, stale: [] };
  }
  const waypoints = draft.waypoints.map((waypoint, at) =>
    at === index ? { ...waypoint, position } : waypoint,
  );
  const touched = [index - 1, index].filter((leg) => leg >= 0 && leg < draft.legs.length);
  const legs = draft.legs.map((leg, at) =>
    touched.includes(at) ? legFor(leg.mode, waypoints[at]!, waypoints[at + 1]!) : leg,
  );
  return { draft: { ...draft, waypoints, legs }, stale: staleAmong(legs, touched) };
}

/**
 * Delete one waypoint. The two legs that met at it become one, which is stale.
 *
 * Deleting an end waypoint drops its single leg and makes nothing stale — there
 * is nothing to rejoin.
 */
export function deleteWaypoint(draft: RouteDraft, id: string): DraftEdit {
  const index = draft.waypoints.findIndex((waypoint) => waypoint.id === id);
  if (index === -1) {
    return { draft, stale: [] };
  }
  const waypoints = draft.waypoints.filter((_, at) => at !== index);
  if (waypoints.length < 2) {
    return { draft: { ...draft, waypoints, legs: [] }, stale: [] };
  }
  if (index === 0) {
    return { draft: { ...draft, waypoints, legs: draft.legs.slice(1) }, stale: [] };
  }
  if (index === draft.waypoints.length - 1) {
    return { draft: { ...draft, waypoints, legs: draft.legs.slice(0, -1) }, stale: [] };
  }
  // ⚠️ The rejoined leg inherits the mode of the leg BEFORE the deleted point.
  // Either choice loses something when the two differed; this one keeps the
  // rider's most recent decision about the stretch they are standing on, and it
  // is recorded here so the next person does not read it as arbitrary.
  const mode = draft.legs[index - 1]!.mode;
  const legs = [
    ...draft.legs.slice(0, index - 1),
    legFor(mode, waypoints[index - 1]!, waypoints[index]!),
    ...draft.legs.slice(index + 1),
  ];
  return {
    draft: { ...draft, waypoints, legs },
    stale: mode === 'snapped' ? [index - 1] : [],
  };
}

/**
 * Turn the route around.
 *
 * ⚠️ **Nothing becomes stale, and each leg's own geometry is reversed in
 * place.** Re-routing a reversed route would be both wasteful and *wrong*: a
 * one-way street means the engine can legitimately return a different path in
 * the other direction, and a rider who pressed Reverse asked to ride the line
 * they drew backwards, not to be given a different line.
 */
export function reverse(draft: RouteDraft): DraftEdit {
  return {
    draft: {
      ...draft,
      waypoints: [...draft.waypoints].reverse(),
      legs: [...draft.legs].reverse().map((leg) => ({ ...leg, shape: [...leg.shape].reverse() })),
    },
    stale: [],
  };
}

/** Throw the whole thing away. The screen is what asks first — see `RouteBuilder`. */
export function clear(draft: RouteDraft): DraftEdit {
  // ⚠️ `nextId` survives, so an id is never reused within one session. A reused
  // id would let a stale selection or a pending engine answer land on a
  // different waypoint than the one it was about.
  return { draft: { waypoints: [], legs: [], nextId: draft.nextId }, stale: [] };
}

/** Switch one leg between snapped and freehand. A leg turned snapped is stale. */
export function setLegMode(draft: RouteDraft, legIndex: number, mode: LegMode): DraftEdit {
  const existing = draft.legs[legIndex];
  if (existing === undefined || existing.mode === mode) {
    return { draft, stale: [] };
  }
  const legs = draft.legs.map((leg, at) =>
    at === legIndex ? legFor(mode, draft.waypoints[at]!, draft.waypoints[at + 1]!) : leg,
  );
  return { draft: { ...draft, legs }, stale: mode === 'snapped' ? [legIndex] : [] };
}

/**
 * Ask the engine for the stale legs, and **only** those.
 *
 * One call per stale leg rather than one call for the whole route, which is
 * what makes #71's call-counting assertion mean anything. A leg that fails
 * keeps its place and its failure; every other leg is untouched.
 *
 * ⚠️ **Never throws.** A `RoutingError` becomes a {@link LegFailure} on its own
 * leg, because the rest of the route is still editable and a rejection here
 * would take the whole draft down with one bad leg.
 */
export async function resolveDraft(
  draft: RouteDraft,
  stale: readonly number[],
  provider: RoutingProvider,
  preferences: RidingPreferences,
): Promise<RouteDraft> {
  const legs = [...draft.legs];
  for (const index of stale) {
    const from = draft.waypoints[index];
    const to = draft.waypoints[index + 1];
    const existing = legs[index];
    if (from === undefined || to === undefined || existing === undefined) {
      continue;
    }
    try {
      const [routed] = await provider.route({
        waypoints: [{ position: from.position }, { position: to.position }],
        preferences,
      });
      legs[index] =
        routed === undefined
          ? { ...existing, state: 'failed', failure: NO_LEG_RETURNED }
          : { ...existing, state: 'routed', ...geometryOf(routed), failure: undefined };
    } catch (error) {
      legs[index] = { ...existing, ...NO_GEOMETRY, state: 'failed', failure: failureFrom(error) };
    }
  }
  return { ...draft, legs };
}

const NO_LEG_RETURNED: LegFailure = {
  message: 'The routing service answered without a route for this leg.',
  retryable: true,
};

function geometryOf(routed: RoutedLeg): Pick<DraftLeg, 'shape' | 'distance' | 'surface'> {
  return { shape: routed.shape, distance: routed.distance, surface: routed.surface };
}

function failureFrom(error: unknown): LegFailure {
  if (error instanceof RoutingError) {
    return { message: error.message, retryable: error.retryable };
  }
  // ⚠️ Anything that is not a RoutingError is a broken provider rather than a
  // routing failure, and it is reported as retryable because this program
  // cannot tell whether it will happen again. The message is generic on
  // purpose: an arbitrary thrown value's own message could carry anything,
  // including a URL with coordinates in it.
  return { message: 'The routing service could not be reached.', retryable: true };
}

/**
 * The leg between two waypoints, in the state its mode implies.
 *
 * Exported because `draft-storage.ts` restores legs and must draw the same
 * distinction: a snapped leg comes back `pending` and needs an engine, a
 * freehand one comes back `routed` because there was never an engine to ask.
 * Two implementations of that rule is exactly how a restored freehand leg ended
 * up unroutable — see that file's `deserialiseDraft`.
 */
export function legFor(mode: LegMode, from: DraftWaypoint, to: DraftWaypoint): DraftLeg {
  if (mode === 'freehand') {
    // ⚠️ A freehand leg makes NO engine call — #71's fifth criterion — so it is
    // routed the moment it exists, and its distance is the geodesic between its
    // two ends. That figure is a **lower bound** on what the rider will ride,
    // and `surface` stays `'unknown'` rather than becoming a guess: nobody
    // asked an engine, so nothing is known. #71 asks for exactly that — a
    // freehand leg must not claim distance or surface "with false confidence".
    return {
      mode,
      state: 'routed',
      shape: [from.position, to.position],
      distance: distanceBetween(from.position, to.position),
      surface: 'unknown',
      failure: undefined,
    };
  }
  return { mode, state: 'pending', ...NO_GEOMETRY };
}

function staleAmong(legs: readonly DraftLeg[], indices: readonly number[]): readonly number[] {
  return indices.filter((index) => legs[index]?.mode === 'snapped');
}

function idFor(draft: RouteDraft): string {
  return `w${String(draft.nextId)}`;
}
