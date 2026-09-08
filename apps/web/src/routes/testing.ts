// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * An in-memory {@link RouteStore} for the routes screen's tests.
 *
 * The same shape as `segments/testing.ts`: enough store to render the screen,
 * and one lever per failure the screen is supposed to handle.
 *
 * ⚠️ **This is not a substitute for the round-trip harness.** Persistence is
 * asserted in `packages/store/src/route-store.test.ts` against a real
 * IndexedDB, where a write that reports success and cannot be read back goes
 * red. What this stub is for is the *screen's* decisions — what it refuses,
 * what it says, and what it writes — which a real database would only make
 * slower to assert.
 */

import type { AthleteId, PrivacyZoneRecord, RouteId, RouteRecord } from '@onyourleft/store';

import type { RoutePort, RouteStore } from './store-port';

export interface RouteStub extends RoutePort {
  readonly store: RouteStore;
  /** Every route currently held, in insertion order. */
  rows(): readonly RouteRecord[];
  /** Make the next `listRoutes` throw, for the offline case. */
  failNextList(): void;
  /**
   * Replace a stored route without going through `putRoute`.
   *
   * This is how a second tab is modelled: the row moves under an editor that
   * is still holding the old `updatedAt`.
   */
  writeBehind(record: RouteRecord): void;
  setZones(zones: readonly PrivacyZoneRecord[]): void;
}

export function routeStub(owner: AthleteId, seed: readonly RouteRecord[] = []): RouteStub {
  const rows = new Map<string, RouteRecord>(seed.map((route) => [route.id, route]));
  let zones: readonly PrivacyZoneRecord[] = [];
  let failList = false;

  const store: RouteStore = {
    listRoutes: (requester, limit) => {
      if (failList) {
        failList = false;
        return Promise.reject(new Error('the local store is unavailable'));
      }
      // Scoped on the way out, like the real one: a stub that ignored the owner
      // would make a cross-athlete bug in the screen invisible here.
      const mine = [...rows.values()].filter((route) => route.createdBy === requester).reverse();
      return Promise.resolve(limit === undefined ? mine : mine.slice(0, limit));
    },
    getRoute: (requester, id) => {
      const found = rows.get(id);
      return Promise.resolve(found?.createdBy === requester ? found : undefined);
    },
    putRoute: (record) => {
      rows.set(record.id, record);
      return Promise.resolve(record.id);
    },
    deleteRoute: (requester, id) => {
      const found = rows.get(id);
      if (found?.createdBy !== requester) return Promise.resolve(false);
      rows.delete(id);
      return Promise.resolve(true);
    },
    listPrivacyZones: () => Promise.resolve([...zones]),
  };

  return {
    athleteId: owner,
    store,
    rows: () => [...rows.values()],
    failNextList: () => {
      failList = true;
    },
    writeBehind: (record) => {
      rows.set(record.id, record);
    },
    setZones: (next) => {
      zones = next;
    },
  };
}

/** A route id the stub will accept. */
export function stubRouteId(value: string): RouteId {
  return value as RouteId;
}
