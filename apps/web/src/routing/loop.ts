// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A short loop drawn on the planner, for a lap race — [#2102](https://github.com/openzigs/onyourleft/issues/2102)
 * phase 1.
 *
 * An online lap race's course is a loop its host saved themselves (ADR 0060
 * D-11.1), and most saved routes are long rides. So the planner offers a
 * **target length** and a **Close the loop** action, and says how the drawn
 * loop compares with the target. Pure, like the rest of `routing/`.
 *
 * ## A loop is the geometry, and the planner says so
 *
 * A drawn route is a loop when its line **ends where it starts**, within
 * `LOOP_CLOSURE_METRES` — the same test `routeProfile` applies to a route
 * marked as a loop, and so the test a lap race's course passes. `import-form.ts`
 * declares an imported loop with a tick box rather than inferring it, because
 * inferring would change what an existing import means with nothing on screen
 * to say so. The planner is the other case that file leaves open: a rider who
 * draws back to their start has said it with the geometry, and the planner
 * says, before the save, that the route will be saved as a loop
 * ({@link draftIsLoop}). A route that does not close is saved as a line, as
 * before.
 *
 * ⚠️ **No coordinate appears in anything this module says** (ADR 0004
 * decision D): lengths only.
 */

import { distanceBetween, LOOP_CLOSURE_METRES, metres, type Metres } from '@onyourleft/domain';
import type { UnitSystem } from '@onyourleft/store';

import { formatDistance, formatSmallDistance, measurementText } from '../units/format';
import {
  addWaypoint,
  draftDistance,
  unresolvedLegs,
  type DraftEdit,
  type LegMode,
  type RouteDraft,
} from './draft';

/** The target lengths a rider may choose, in kilometres — #2102's list. */
export const LOOP_TARGETS_KM = [1, 2, 3, 5, 8] as const;

export type LoopTargetKm = (typeof LOOP_TARGETS_KM)[number];

/** The target a planner opens with: the shortest but one, a lap race's circuit rather than a ride. */
export const DEFAULT_LOOP_TARGET_KM: LoopTargetKm = 2;

/**
 * How far from the target a loop may be and still be "about" it: **15 %**.
 *
 * #2102's own figure for a generated loop (phase 2), used here for a drawn one
 * so both phases mean the same thing by "near the target".
 */
export const LOOP_TARGET_TOLERANCE = 0.15;

/**
 * The fewest waypoints a loop is drawn with: **three**. Two would be an
 * out-and-back along one line, which encloses nothing and turns a lap race
 * round on the spot.
 */
export const LOOP_LEAST_WAYPOINTS = 3;

/**
 * Whether **Close the loop** can act: three waypoints or more, and the last one
 * not already back at the first.
 */
export function canCloseLoop(draft: RouteDraft): boolean {
  const first = draft.waypoints[0];
  const last = draft.waypoints.at(-1);
  if (first === undefined || last === undefined) return false;
  if (draft.waypoints.length < LOOP_LEAST_WAYPOINTS) return false;
  return distanceBetween(first.position, last.position) > LOOP_CLOSURE_METRES;
}

/**
 * Join the last waypoint back to the first: a new last waypoint where the first
 * one is, so the line ends where it starts.
 *
 * ⚠️ **A waypoint, not a flag.** The leg back is an ordinary leg — routed,
 * undone, stored across a reload and shown on the map like any other — so
 * nothing else in `routing/` has to learn about loops. Moving the first
 * waypoint afterwards opens the loop again, and the planner says so and offers
 * the action again.
 */
export function closeLoop(draft: RouteDraft, mode: LegMode): DraftEdit {
  if (!canCloseLoop(draft)) return { draft, stale: [] };
  return addWaypoint(draft, draft.waypoints[0]!.position, mode);
}

/**
 * Whether the drawn route is a loop: three waypoints or more, every leg with a
 * line, and the line's two ends within `LOOP_CLOSURE_METRES`.
 *
 * The ends are the LINE's, not the waypoints': a routing engine starts and ends
 * a leg on the road nearest each waypoint, and it is the line that is saved and
 * that `routeProfile` checks. A leg still being routed has no line, so a draft
 * waiting on one is not yet a loop.
 */
export function draftIsLoop(draft: RouteDraft): boolean {
  if (draft.waypoints.length < LOOP_LEAST_WAYPOINTS) return false;
  if (unresolvedLegs(draft).length > 0) return false;
  const start = draft.legs[0]?.shape[0];
  const end = draft.legs.at(-1)?.shape.at(-1);
  if (start === undefined || end === undefined) return false;
  return distanceBetween(start, end) <= LOOP_CLOSURE_METRES;
}

/** How a length compares with a target. `by` is how far off, and is zero when `near`. */
export interface LoopFit {
  readonly kind: 'near' | 'under' | 'over';
  readonly by: Metres;
}

/**
 * How `length` sits against `targetKm`: within {@link LOOP_TARGET_TOLERANCE}
 * of it either way is `near`, and otherwise it is `under` or `over` by the
 * difference.
 */
export function loopFit(length: Metres, targetKm: LoopTargetKm): LoopFit {
  const target = targetKm * 1000;
  const difference = length - target;
  if (Math.abs(difference) <= target * LOOP_TARGET_TOLERANCE) {
    return { kind: 'near', by: metres(0) };
  }
  return difference < 0
    ? { kind: 'under', by: metres(-difference) }
    : { kind: 'over', by: metres(difference) };
}

/** A target as the chooser names it, in the rider's units. */
export function loopTargetText(targetKm: LoopTargetKm, units: UnitSystem): string {
  // Whole kilometres say themselves; a mile needs its tenth (1 km is 0.6 mi).
  return measurementText(
    formatDistance(metres(targetKm * 1000), units, units === 'imperial' ? 1 : 0),
  );
}

/** What the planner says about a short loop: one line on its state, and the length against the target. */
export interface LoopReadout {
  /** Whether the route is a loop, or what it still needs to be one. */
  readonly state: string;
  /** The length against the target, once there is a leg. */
  readonly length: string | undefined;
  /** Near, under or over the target: said only of a loop, since a line still being drawn is short of any. */
  readonly note: string | undefined;
  readonly fit: LoopFit | undefined;
}

/** What the planner says while there are not yet enough waypoints for a loop. */
export const LOOP_START_TEXT =
  'Place your start and at least two more waypoints round from it, then close the loop.';

/** What the planner says of a loop. */
export const IS_A_LOOP_TEXT =
  'It ends where it starts, so it is saved as a loop, the kind of route a lap race is ridden on.';

/** What the planner says of a route with enough waypoints that does not close yet. */
export const NOT_YET_A_LOOP_TEXT =
  'It does not end where it starts yet. Close the loop to join the last waypoint back to the first.';

/**
 * The planner's words about the loop being drawn — #2102.
 *
 * ⚠️ Lengths only, never a place (ADR 0004 decision D). The length is
 * {@link draftDistance}, the same total the planner's distance line reads,
 * which on a saved loop is the saved route's length.
 */
export function loopReadout(
  draft: RouteDraft,
  targetKm: LoopTargetKm,
  units: UnitSystem,
): LoopReadout {
  const target = loopTargetText(targetKm, units);
  const length = draftDistance(draft);
  const lengthText = measurementText(formatDistance(length, units));
  const loop = draftIsLoop(draft);
  const state =
    draft.waypoints.length < LOOP_LEAST_WAYPOINTS
      ? LOOP_START_TEXT
      : loop
        ? IS_A_LOOP_TEXT
        : canCloseLoop(draft)
          ? NOT_YET_A_LOOP_TEXT
          : unresolvedLegs(draft).length > 0
            ? 'It becomes a loop once every leg has a line.'
            : `Its line does not end within ${measurementText(formatSmallDistance(LOOP_CLOSURE_METRES, units))} of where it starts, so it would be saved as a line.`;
  if (draft.legs.length === 0) {
    return { state, length: undefined, note: undefined, fit: undefined };
  }
  if (!loop) {
    return {
      state,
      length: `${lengthText} so far, against a target of ${target}.`,
      note: undefined,
      fit: undefined,
    };
  }
  const fit = loopFit(length, targetKm);
  const by = measurementText(formatDistance(fit.by, units));
  const percent = String(Math.round(LOOP_TARGET_TOLERANCE * 100));
  return {
    state,
    length: `Loop length ${lengthText}, against a target of ${target}.`,
    note:
      fit.kind === 'near'
        ? `It is within ${percent}% of the target.`
        : fit.kind === 'under'
          ? `It is ${by} under the target, more than ${percent}% short. Move a waypoint further out, or choose a shorter target.`
          : `It is ${by} over the target, more than ${percent}% long. Bring a waypoint in, or choose a longer target.`,
    fit,
  };
}
