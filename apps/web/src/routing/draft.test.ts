// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  RoutingError,
} from '@onyourleft/domain';
import type { GeographicPosition } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import {
  addWaypoint,
  clear,
  deleteWaypoint,
  draftDistance,
  emptyDraft,
  insertWaypoint,
  isEmpty,
  MAXIMUM_WAYPOINTS,
  moveWaypoint,
  resolveDraft,
  reverse,
  setLegMode,
  unresolvedLegs,
  type DraftEdit,
  type RouteDraft,
} from './draft';
import { scriptedProvider } from './testing';
import { RIDING_DEFAULTS } from './preferences';

function at(index: number): GeographicPosition {
  // A line of points a few hundred metres apart, north of the Thames.
  return geographicPosition(degreesLatitude(51.5 + index * 0.005), degreesLongitude(-0.12));
}

/** A draft of `count` waypoints, every leg snapped and unrouted. */
function drawn(count: number): RouteDraft {
  let draft = emptyDraft();
  for (let index = 0; index < count; index += 1) {
    draft = addWaypoint(draft, at(index)).draft;
  }
  return draft;
}

async function routed(
  count: number,
): Promise<{ draft: RouteDraft; provider: ReturnType<typeof scriptedProvider> }> {
  const provider = scriptedProvider();
  const draft = drawn(count);
  const settled = await resolveDraft(
    draft,
    draft.legs.map((_, index) => index),
    provider,
    RIDING_DEFAULTS,
  );
  provider.routeCalls.length = 0;
  return { draft: settled, provider };
}

describe('the shape of a draft', () => {
  it('has one leg between each adjacent pair of waypoints', () => {
    expect(drawn(5).legs).toHaveLength(4);
    expect(drawn(1).legs).toHaveLength(0);
    expect(drawn(0).legs).toHaveLength(0);
  });

  it('starts empty', () => {
    expect(isEmpty(emptyDraft())).toBe(true);
    expect(isEmpty(drawn(1))).toBe(false);
  });

  it('gives every waypoint an id that does not change when another is added', () => {
    const one = drawn(1);
    const two = addWaypoint(one, at(1)).draft;
    expect(two.waypoints[0]?.id).toBe(one.waypoints[0]?.id);
    expect(two.waypoints[1]?.id).not.toBe(one.waypoints[0]?.id);
  });

  it('refuses to grow past the waypoint bound', () => {
    let draft = drawn(MAXIMUM_WAYPOINTS);
    const before = draft.waypoints.length;
    draft = addWaypoint(draft, at(999)).draft;
    expect(draft.waypoints).toHaveLength(before);
  });
});

describe('only the legs that changed are re-routed', () => {
  it('re-routes exactly the two legs beside a moved middle waypoint', async () => {
    // ⚠️ #71's second criterion, in its own words: "moving one waypoint of a
    // five-waypoint route re-routes ONLY the two adjacent legs, asserted by
    // counting routing-provider calls, not by looking at it".
    const { draft, provider } = await routed(5);
    const moved = moveWaypoint(draft, draft.waypoints[2]!.id, at(9));
    expect(moved.stale).toStrictEqual([1, 2]);
    await resolveDraft(moved.draft, moved.stale, provider, RIDING_DEFAULTS);
    expect(provider.routeCalls).toHaveLength(2);
  });

  it('re-routes one leg when an end waypoint moves', async () => {
    const { draft, provider } = await routed(5);
    const moved = moveWaypoint(draft, draft.waypoints[0]!.id, at(9));
    expect(moved.stale).toStrictEqual([0]);
    await resolveDraft(moved.draft, moved.stale, provider, RIDING_DEFAULTS);
    expect(provider.routeCalls).toHaveLength(1);
  });

  it('re-routes only the new last leg when a waypoint is appended', async () => {
    const { draft, provider } = await routed(5);
    const added = addWaypoint(draft, at(9));
    expect(added.stale).toStrictEqual([4]);
    await resolveDraft(added.draft, added.stale, provider, RIDING_DEFAULTS);
    expect(provider.routeCalls).toHaveLength(1);
  });

  it('re-routes both halves of a split leg and nothing after it', async () => {
    // The case a change-detecting implementation gets wrong: the indices after
    // an insertion all shift, so "did the endpoints change" answers yes for
    // every leg in the tail.
    const { draft, provider } = await routed(5);
    const inserted = insertWaypoint(draft, 1, at(9));
    expect(inserted.stale).toStrictEqual([1, 2]);
    await resolveDraft(inserted.draft, inserted.stale, provider, RIDING_DEFAULTS);
    expect(provider.routeCalls).toHaveLength(2);
  });

  it('re-routes the one rejoined leg when a middle waypoint is deleted', async () => {
    const { draft, provider } = await routed(5);
    const deleted = deleteWaypoint(draft, draft.waypoints[2]!.id);
    expect(deleted.draft.legs).toHaveLength(3);
    expect(deleted.stale).toStrictEqual([1]);
    await resolveDraft(deleted.draft, deleted.stale, provider, RIDING_DEFAULTS);
    expect(provider.routeCalls).toHaveLength(1);
  });

  it('re-routes nothing when an end waypoint is deleted', async () => {
    const { draft } = await routed(5);
    expect(deleteWaypoint(draft, draft.waypoints[0]!.id).stale).toStrictEqual([]);
    expect(deleteWaypoint(draft, draft.waypoints[4]!.id).stale).toStrictEqual([]);
  });

  it('leaves the untouched legs byte-for-byte alone', async () => {
    // Not merely "not re-routed" — the same object, so a React key or a
    // memoised map layer is not invalidated by an edit somewhere else.
    const { draft } = await routed(5);
    const moved = moveWaypoint(draft, draft.waypoints[2]!.id, at(9));
    expect(moved.draft.legs[0]).toBe(draft.legs[0]);
    expect(moved.draft.legs[3]).toBe(draft.legs[3]);
    expect(moved.draft.legs[1]).not.toBe(draft.legs[1]);
  });

  it('does nothing at all for an unknown waypoint', () => {
    const draft = drawn(3);
    const moved = moveWaypoint(draft, 'not-a-waypoint', at(9));
    expect(moved.draft).toBe(draft);
    expect(moved.stale).toStrictEqual([]);
  });
});

describe('a snapped leg follows the road; a freehand leg does not pretend to', () => {
  it('comes back with substantially more vertices than the waypoints that asked for it', async () => {
    // ⚠️ #71's first criterion. A straight line between two pins is the
    // regression: two waypoints in, two points out.
    const { draft } = await routed(3);
    for (const leg of draft.legs) {
      expect(leg.shape.length).toBeGreaterThan(2);
    }
  });

  it('makes no engine call for a freehand leg', async () => {
    const provider = scriptedProvider();
    let draft = drawn(1);
    const added = addWaypoint(draft, at(1), 'freehand');
    draft = added.draft;
    expect(added.stale).toStrictEqual([]);
    await resolveDraft(draft, added.stale, provider, RIDING_DEFAULTS);
    expect(provider.routeCalls).toHaveLength(0);
    expect(draft.legs[0]?.state).toBe('routed');
  });

  it('mixes freehand and snapped legs in one route, each remembering which it is', async () => {
    const provider = scriptedProvider();
    let draft = drawn(1);
    let edit: DraftEdit = addWaypoint(draft, at(1), 'snapped');
    draft = await resolveDraft(edit.draft, edit.stale, provider, RIDING_DEFAULTS);
    edit = addWaypoint(draft, at(2), 'freehand');
    draft = edit.draft;
    expect(draft.legs.map((leg) => leg.mode)).toStrictEqual(['snapped', 'freehand']);
  });

  it('never calls a freehand leg paved', () => {
    // #72's rule, applied where nobody even asked an engine: a freehand leg's
    // surface is not unknown to the engine, it is unknown to everybody.
    const draft = addWaypoint(drawn(1), at(1), 'freehand').draft;
    expect(draft.legs[0]?.surface).toBe('unknown');
  });

  it('measures a freehand leg as the geodesic between its ends', () => {
    const draft = addWaypoint(drawn(1), at(1), 'freehand').draft;
    // 0.005 degrees of latitude is about 556 m.
    expect(draft.legs[0]?.distance).toBeGreaterThan(500);
    expect(draft.legs[0]?.distance).toBeLessThan(600);
  });

  it('re-routes a leg switched back to snapped, and not one switched to freehand', async () => {
    const { draft, provider } = await routed(3);
    expect(setLegMode(draft, 0, 'freehand').stale).toStrictEqual([]);
    const back = setLegMode(setLegMode(draft, 0, 'freehand').draft, 0, 'snapped');
    expect(back.stale).toStrictEqual([0]);
    await resolveDraft(back.draft, back.stale, provider, RIDING_DEFAULTS);
    expect(provider.routeCalls).toHaveLength(1);
  });
});

describe('reversing', () => {
  it('turns the waypoints and every leg around', async () => {
    const { draft } = await routed(4);
    const first = draft.waypoints[0]!.id;
    const last = draft.waypoints[3]!.id;
    const back = reverse(draft).draft;
    expect(back.waypoints[0]?.id).toBe(last);
    expect(back.waypoints[3]?.id).toBe(first);
    expect(back.legs[0]?.shape.at(-1)).toStrictEqual(draft.legs[2]?.shape[0]);
  });

  it('re-routes nothing', async () => {
    // ⚠️ Deliberate. A one-way street means the engine can legitimately return
    // a DIFFERENT path in the other direction, and a rider who pressed Reverse
    // asked to ride the line they drew backwards.
    const { draft, provider } = await routed(4);
    const back = reverse(draft);
    expect(back.stale).toStrictEqual([]);
    await resolveDraft(back.draft, back.stale, provider, RIDING_DEFAULTS);
    expect(provider.routeCalls).toHaveLength(0);
  });

  it('keeps the total distance', async () => {
    const { draft } = await routed(4);
    expect(draftDistance(reverse(draft).draft)).toBe(draftDistance(draft));
  });
});

describe('clearing', () => {
  it('empties the route', () => {
    expect(isEmpty(clear(drawn(6)).draft)).toBe(true);
  });

  it('does not reuse a waypoint id afterwards', () => {
    // A reused id would let a stale selection, or an engine answer still in
    // flight, land on a different waypoint than the one it was about.
    const drawnFirst = drawn(3);
    const after = addWaypoint(clear(drawnFirst).draft, at(0)).draft;
    expect(drawnFirst.waypoints.map((waypoint) => waypoint.id)).not.toContain(
      after.waypoints[0]?.id,
    );
  });
});

describe('a leg that could not be routed', () => {
  it('fails on its own leg and leaves the rest intact and editable', async () => {
    // Re-resolving one already-routed leg, so the only thing that changes is
    // the leg that fails. (Moving a waypoint would stale TWO legs, and a test
    // that resolved one of them would be reading its own omission as the
    // behaviour under test.)
    const { draft, provider } = await routed(4);
    provider.failNextRoute(new RoutingError('no-route', 'no path between these two points', 1));
    const settled = await resolveDraft(draft, [1], provider, RIDING_DEFAULTS);
    expect(settled.legs[1]?.state).toBe('failed');
    expect(settled.legs[1]?.failure?.retryable).toBe(false);
    expect(settled.legs[0]?.state).toBe('routed');
    expect(settled.legs[2]?.state).toBe('routed');
    expect(unresolvedLegs(settled)).toStrictEqual([1]);
  });

  it('marks a rate limit and a timeout as worth asking again', async () => {
    const { draft, provider } = await routed(2);
    provider.failNextRoute(new RoutingError('rate-limited', 'slow down'));
    const settled = await resolveDraft(draft, [0], provider, RIDING_DEFAULTS);
    expect(settled.legs[0]?.failure?.retryable).toBe(true);
  });

  it('never throws out of resolve, whatever the provider does', async () => {
    // A rejection here would take the whole draft down with one bad leg — and
    // a provider that throws a plain string is a broken adapter, not a routing
    // failure, so it still must not escape.
    const { draft, provider } = await routed(2);
    provider.failEveryRoute('not an Error at all' as unknown as RoutingError);
    const settled = await resolveDraft(draft, [0], provider, RIDING_DEFAULTS);
    expect(settled.legs[0]?.state).toBe('failed');
    expect(settled.legs[0]?.failure?.message).not.toContain('not an Error');
  });

  it('leaves a failed leg out of the total distance rather than guessing one', async () => {
    const { draft, provider } = await routed(3);
    provider.failNextRoute(new RoutingError('no-route', 'no path', 0));
    const settled = await resolveDraft(draft, [0], provider, RIDING_DEFAULTS);
    // One routed leg at the scripted 1 000 m, and nothing invented for the other.
    expect(draftDistance(settled)).toBe(1_000);
  });

  it('recovers when the leg is routed again', async () => {
    const { draft, provider } = await routed(2);
    provider.failNextRoute(new RoutingError('unavailable', 'the engine is down'));
    const down = await resolveDraft(draft, [0], provider, RIDING_DEFAULTS);
    const up = await resolveDraft(down, [0], provider, RIDING_DEFAULTS);
    expect(up.legs[0]?.state).toBe('routed');
    expect(up.legs[0]?.failure).toBeUndefined();
  });
});
