// SPDX-License-Identifier: AGPL-3.0-or-later

import { degreesLatitude, degreesLongitude, geographicPosition } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { addWaypoint, emptyDraft, setLegMode, type RouteDraft } from './draft';
import {
  browserDraftStorage,
  deserialiseDraft,
  DRAFT_STORAGE_KEY,
  serialiseDraft,
} from './draft-storage';

function drawn(count: number): RouteDraft {
  let draft = emptyDraft();
  for (let index = 0; index < count; index += 1) {
    draft = addWaypoint(
      draft,
      geographicPosition(degreesLatitude(51.5 + index * 0.005), degreesLongitude(-0.12)),
    ).draft;
  }
  return draft;
}

/** A `Storage` that lives in a Map, so the round trip is not jsdom's to get right. */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  const storage: Storage = {
    get length(): number {
      return map.size;
    },
    clear(): void {
      map.clear();
    },
    getItem(key: string): string | null {
      return map.get(key) ?? null;
    },
    key(index: number): string | null {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string): void {
      map.delete(key);
    },
    setItem(key: string, value: string): void {
      map.set(key, value);
    },
  };
  return storage;
}

/** `JSON.parse` of a serialised draft, typed, so a mutation test is not `any`. */
function rowOf(draft: RouteDraft): Record<string, unknown> {
  return JSON.parse(serialiseDraft(draft)) as Record<string, unknown>;
}

describe('a half-drawn route survives a reload', () => {
  it('brings back every waypoint, in order, where the rider put them', () => {
    const before = drawn(4);
    const after = deserialiseDraft(serialiseDraft(before));
    expect(after?.waypoints).toStrictEqual(before.waypoints);
  });

  it('brings back each leg’s mode, so a freehand stretch stays freehand', () => {
    const before = setLegMode(drawn(4), 1, 'freehand').draft;
    expect(deserialiseDraft(serialiseDraft(before))?.legs.map((leg) => leg.mode)).toStrictEqual([
      'snapped',
      'freehand',
      'snapped',
    ]);
  });

  it('brings a freehand leg back WHOLE, because there is no engine to ask', () => {
    // ⚠️ **Found by review.** Every restored leg used to come back `pending`,
    // and the screen's restore resolves only `snapped` ones — so a reloaded
    // freehand leg read "Being routed" for ever, was left out of the total
    // distance, and truncated `plannedShape`, which stops at the first leg with
    // no geometry. That last one is the expensive part: the whole elevation
    // profile ended at the reloaded freehand leg.
    const before = setLegMode(drawn(3), 0, 'freehand').draft;
    const after = deserialiseDraft(serialiseDraft(before));
    expect(after?.legs[0]?.state).toBe('routed');
    expect(after?.legs[0]?.shape).toHaveLength(2);
    expect(after?.legs[0]?.distance).toBeGreaterThan(0);
    // And the snapped one beside it still needs an engine.
    expect(after?.legs[1]?.state).toBe('pending');
  });

  it('brings a snapped leg back unrouted, so the screen asks the engine again', () => {
    // ⚠️ Geometry is dropped on purpose — it is the large part and the part an
    // engine hands back for free. What cannot be recovered by asking again is
    // where the pins are.
    const after = deserialiseDraft(serialiseDraft(drawn(3)));
    expect(after?.legs.map((leg) => leg.state)).toStrictEqual(['pending', 'pending']);
    expect(after?.legs.every((leg) => leg.shape.length === 0)).toBe(true);
  });

  it('does not reuse an id after a restore', () => {
    const before = drawn(3);
    const after = deserialiseDraft(serialiseDraft(before));
    expect(after?.nextId).toBe(before.nextId);
  });

  it('round-trips through a real Storage', () => {
    const storage = browserDraftStorage(memoryStorage());
    const before = drawn(3);
    storage.write(before);
    expect(storage.read()?.waypoints).toStrictEqual(before.waypoints);
    storage.forget();
    expect(storage.read()).toBeUndefined();
  });
});

describe('anything this build does not recognise is refused, not half-read', () => {
  it('refuses a missing or empty value', () => {
    expect(deserialiseDraft(null)).toBeUndefined();
    expect(deserialiseDraft('')).toBeUndefined();
  });

  it('refuses text that is not JSON', () => {
    expect(deserialiseDraft('{not json')).toBeUndefined();
  });

  it('refuses a version this build does not know', () => {
    // ⚠️ ADR 0017 D-4's posture, applied to a draft: doing one's best with an
    // unrecognised shape produces a route the rider then saves.
    const row = rowOf(drawn(2));
    expect(deserialiseDraft(JSON.stringify({ ...row, onYourLeftRouteDraft: 2 }))).toBeUndefined();
  });

  it('refuses a coordinate that is not a position on Earth', () => {
    // ⚠️ **One waypoint, deliberately.** With two, dropping the bad one leaves
    // a waypoint count the stored mode list no longer matches, so the LENGTH
    // check refuses it and this test passes without the coordinate check
    // existing at all — which is what it did until a mutation showed it. With
    // one waypoint there are no modes either way, so nothing else can catch it.
    const row = rowOf(drawn(1));
    const waypoints = row['waypoints'] as Record<string, unknown>[];
    waypoints[0]!['latitude'] = 91;
    expect(deserialiseDraft(JSON.stringify(row))).toBeUndefined();
  });

  it('refuses a waypoint that is missing a coordinate outright', () => {
    const row = rowOf(drawn(1));
    const waypoints = row['waypoints'] as Record<string, unknown>[];
    delete waypoints[0]!['longitude'];
    expect(deserialiseDraft(JSON.stringify(row))).toBeUndefined();
  });

  it('refuses a mode list that does not match the waypoints', () => {
    const row = rowOf(drawn(4));
    expect(deserialiseDraft(JSON.stringify({ ...row, modes: ['snapped'] }))).toBeUndefined();
  });

  it('refuses an unrecognised leg mode', () => {
    const row = rowOf(drawn(2));
    expect(deserialiseDraft(JSON.stringify({ ...row, modes: ['teleport'] }))).toBeUndefined();
  });

  it('refuses a next id that could collide with an existing waypoint', () => {
    const row = rowOf(drawn(2));
    expect(deserialiseDraft(JSON.stringify({ ...row, nextId: 0 }))).toBeUndefined();
    expect(deserialiseDraft(JSON.stringify({ ...row, nextId: 'three' }))).toBeUndefined();
  });
});

describe('a storage that refuses to work takes nothing down with it', () => {
  it('reads undefined rather than throwing', () => {
    const throwing = {
      getItem: () => {
        throw new Error('the user has disabled site data');
      },
      setItem: () => {
        throw new Error('quota exceeded');
      },
      removeItem: () => {
        throw new Error('no');
      },
    } as unknown as Storage;
    const storage = browserDraftStorage(throwing);
    expect(storage.read()).toBeUndefined();
    expect(() => {
      storage.write(drawn(2));
    }).not.toThrow();
    expect(() => {
      storage.forget();
    }).not.toThrow();
  });

  it('works when there is no storage at all', () => {
    const storage = browserDraftStorage(undefined);
    expect(storage.read()).toBeUndefined();
    expect(() => {
      storage.write(drawn(2));
    }).not.toThrow();
  });

  it('namespaces its key, because the origin is shared', () => {
    expect(DRAFT_STORAGE_KEY.startsWith('oyl.')).toBe(true);
  });
});
