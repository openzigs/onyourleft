// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Undo and redo over a route draft — [#71](https://github.com/openzigs/onyourleft/issues/71).
 *
 * #71's third criterion: *"undo and redo cover waypoint add, move, delete,
 * reverse and clear, and a test performs twenty mixed operations then undoes
 * all of them and asserts the route is empty."*
 *
 * ⚠️ **Whole drafts, not inverse operations, and that is a deliberate trade.**
 * A command stack storing "the inverse of what you did" is smaller and is the
 * usual answer; it is also where undo bugs live, because every operation needs
 * an inverse that is exactly right including the parts it changed by accident —
 * and `deleteWaypoint` here rejoins two legs into one whose *mode* came from
 * the leg before it, which no inverse recovers without storing the old leg
 * anyway. A draft is a few hundred bytes; {@link HISTORY_LIMIT} bounds how many
 * are kept. Correct and bounded beats small and subtly wrong on the one control
 * whose entire purpose is to rescue somebody.
 *
 * ⚠️ **Geometry is part of the entry.** Undoing a move restores the geometry
 * that move replaced, so undo does not re-route — which matters on a slow
 * connection and matters more when the engine is down: undo has to work when
 * nothing else does.
 */

import type { RouteDraft } from './draft';
import { emptyDraft } from './draft';

/**
 * How many steps back a rider can go: **50**.
 *
 * Deep enough that "undo until it looks right" reaches anything within one
 * session's editing, and bounded because the alternative is a list that grows
 * for as long as the tab is open. Fifty drafts of a 250-waypoint route is a few
 * hundred kilobytes at the very worst.
 */
export const HISTORY_LIMIT = 50;

/**
 * A history of whole values: a planner's drafts, and since #2007 a saved
 * route's line being edited (`route-edit.ts` §`EditedLine`), whose undo
 * follows the same rules for the same reasons.
 */
export interface DraftHistory<T = RouteDraft> {
  /** The draft as it stands. */
  readonly present: T;
  /** Oldest first. The most recent is the one an undo returns to. */
  readonly past: readonly T[];
  /** Nearest first. Emptied by any new edit — see {@link record}. */
  readonly future: readonly T[];
}

export function newHistory(present?: RouteDraft): DraftHistory;
export function newHistory<T>(present: T): DraftHistory<T>;
export function newHistory(present: unknown = emptyDraft()): DraftHistory<unknown> {
  return { present, past: [], future: [] };
}

export function canUndo<T>(history: DraftHistory<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: DraftHistory<T>): boolean {
  return history.future.length > 0;
}

/**
 * Push a new present, keeping the old one to come back to.
 *
 * ⚠️ **A new edit discards the redo stack**, which is the convention every
 * editor follows and is worth stating because the alternative — keeping it —
 * produces a redo that jumps to a route the rider never drew.
 *
 * ⚠️ **An edit that changed nothing is not recorded.** `moveWaypoint` with an
 * unknown id, `clear` on an empty draft and `setLegMode` to the mode a leg
 * already has all return the draft they were given, and recording those would
 * fill the history with steps whose undo does nothing visible — which reads to
 * a rider as undo being broken.
 */
export function record<T>(history: DraftHistory<T>, next: T): DraftHistory<T> {
  if (next === history.present) {
    return history;
  }
  return {
    present: next,
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    future: [],
  };
}

/**
 * Replace the present without making a history step.
 *
 * For the geometry an engine answered with. ⚠️ **A routing answer is not an
 * edit**, and treating it as one is the bug this function exists to prevent:
 * the rider would have to press undo twice for one move — once for the
 * geometry, once for the move — and the first press would appear to do nothing.
 */
export function settle<T>(history: DraftHistory<T>, resolved: T): DraftHistory<T> {
  return { ...history, present: resolved };
}

export function undo<T>(history: DraftHistory<T>): DraftHistory<T> {
  const previous = history.past.at(-1);
  if (previous === undefined) {
    return history;
  }
  return {
    present: previous,
    past: history.past.slice(0, -1),
    future: [history.present, ...history.future],
  };
}

export function redo<T>(history: DraftHistory<T>): DraftHistory<T> {
  const [next, ...rest] = history.future;
  if (next === undefined) {
    return history;
  }
  return { present: next, past: [...history.past, history.present], future: rest };
}
