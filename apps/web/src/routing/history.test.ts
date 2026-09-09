// SPDX-License-Identifier: AGPL-3.0-or-later

import { degreesLatitude, degreesLongitude, geographicPosition } from '@onyourleft/domain';
import type { GeographicPosition } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import {
  addWaypoint,
  clear,
  deleteWaypoint,
  emptyDraft,
  isEmpty,
  moveWaypoint,
  resolveDraft,
  reverse,
  type RouteDraft,
} from './draft';
import {
  canRedo,
  canUndo,
  HISTORY_LIMIT,
  newHistory,
  record,
  redo,
  settle,
  undo,
  type DraftHistory,
} from './history';
import { RIDING_DEFAULTS } from './preferences';
import { scriptedProvider } from './testing';

function at(index: number): GeographicPosition {
  return geographicPosition(degreesLatitude(51.5 + index * 0.005), degreesLongitude(-0.12));
}

function add(history: DraftHistory, index: number): DraftHistory {
  return record(history, addWaypoint(history.present, at(index)).draft);
}

describe('undo and redo cover every operation', () => {
  it('undoes twenty mixed operations back to an empty route', () => {
    // ⚠️ #71's third criterion, word for word: "a test performs twenty mixed
    // operations then undoes all of them and asserts the route is empty".
    let history = newHistory();
    let steps = 0;
    const step = (next: RouteDraft): void => {
      history = record(history, next);
      steps += 1;
    };

    for (let index = 0; index < 8; index += 1) step(addWaypoint(history.present, at(index)).draft);
    step(moveWaypoint(history.present, history.present.waypoints[3]!.id, at(20)).draft);
    step(reverse(history.present).draft);
    step(deleteWaypoint(history.present, history.present.waypoints[2]!.id).draft);
    step(moveWaypoint(history.present, history.present.waypoints[0]!.id, at(21)).draft);
    for (let index = 0; index < 4; index += 1)
      step(addWaypoint(history.present, at(30 + index)).draft);
    step(reverse(history.present).draft);
    step(deleteWaypoint(history.present, history.present.waypoints[1]!.id).draft);
    step(moveWaypoint(history.present, history.present.waypoints[4]!.id, at(22)).draft);
    step(clear(history.present).draft);

    expect(steps).toBe(20);
    expect(isEmpty(history.present)).toBe(true); // the clear
    for (let index = 0; index < steps; index += 1) history = undo(history);
    expect(isEmpty(history.present)).toBe(true); // back to the beginning
    expect(canUndo(history)).toBe(false);
  });

  it('redoes back to where it was', () => {
    let history = add(add(add(newHistory(), 0), 1), 2);
    const drawn = history.present;
    history = undo(undo(history));
    expect(history.present.waypoints).toHaveLength(1);
    history = redo(redo(history));
    expect(history.present).toBe(drawn);
  });

  it('covers a clear, which is the one nobody can redraw from memory', () => {
    const history = record(
      add(add(newHistory(), 0), 1),
      clear(add(add(newHistory(), 0), 1).present).draft,
    );
    expect(isEmpty(history.present)).toBe(true);
    expect(isEmpty(undo(history).present)).toBe(false);
  });
});

describe('what does and does not become a history step', () => {
  it('discards the redo stack on a new edit', () => {
    // The convention every editor follows. Keeping it would produce a redo that
    // jumps to a route the rider never drew.
    let history = add(add(newHistory(), 0), 1);
    history = undo(history);
    expect(canRedo(history)).toBe(true);
    history = add(history, 5);
    expect(canRedo(history)).toBe(false);
  });

  it('does not record an edit that changed nothing', () => {
    // ⚠️ A no-op step reads to a rider as undo being broken: they press it and
    // nothing moves.
    const history = add(newHistory(), 0);
    const unchanged = record(history, moveWaypoint(history.present, 'not-a-waypoint', at(9)).draft);
    expect(unchanged).toBe(history);
    expect(unchanged.past).toHaveLength(1);
  });

  it('does not record the geometry an engine answered with', async () => {
    // ⚠️ A routing answer is not an edit. Recording it would make a rider press
    // undo twice for one move, and the first press would appear to do nothing.
    const provider = scriptedProvider();
    let history = add(add(newHistory(), 0), 1);
    const depth = history.past.length;
    history = settle(history, await resolveDraft(history.present, [0], provider, RIDING_DEFAULTS));
    expect(history.past).toHaveLength(depth);
    expect(history.present.legs[0]?.state).toBe('routed');
  });

  it('restores the geometry an undone move replaced, without re-routing', async () => {
    // Undo has to work when the engine is down, which is exactly when a rider
    // most wants it.
    const provider = scriptedProvider();
    let history = newHistory(addWaypoint(addWaypoint(emptyDraft(), at(0)).draft, at(1)).draft);
    history = settle(history, await resolveDraft(history.present, [0], provider, RIDING_DEFAULTS));
    const withGeometry = history.present;
    history = record(
      history,
      moveWaypoint(history.present, history.present.waypoints[1]!.id, at(9)).draft,
    );
    expect(history.present.legs[0]?.state).toBe('pending');

    const callsBefore = provider.routeCalls.length;
    history = undo(history);
    expect(history.present).toBe(withGeometry);
    expect(history.present.legs[0]?.state).toBe('routed');
    expect(provider.routeCalls).toHaveLength(callsBefore);
  });
});

describe('the bounds', () => {
  it('undoes and redoes nothing when there is nothing to undo or redo', () => {
    const history = newHistory();
    expect(undo(history)).toBe(history);
    expect(redo(history)).toBe(history);
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
  });

  it('keeps the most recent steps and drops the oldest', () => {
    let history = newHistory();
    for (let index = 0; index < HISTORY_LIMIT + 10; index += 1) history = add(history, index);
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    // Undoing everything it kept leaves a route rather than an empty one — the
    // honest consequence of a bounded history, and the reason the limit is
    // large enough to cover a session's editing.
    for (let index = 0; index < HISTORY_LIMIT; index += 1) history = undo(history);
    expect(history.present.waypoints).toHaveLength(10);
    expect(canUndo(history)).toBe(false);
  });
});
