// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the routes screen needs from the local store, and nothing more.
 *
 * The same shape as `segments/store-port.ts` and `detail/store-port.ts`, for
 * the same reason: the view is rendered by the accessibility suite on a machine
 * with no IndexedDB worth the name, so it cannot open a database itself.
 * `main.tsx` is the one caller that reaches the real store.
 *
 * ⚠️ **Every method takes the owner**, and there is no `getRoute(id)` to reach
 * for. That is not defensive style — `packages/store` declares no index that
 * could answer one, and CLAUDE.md §6 names the shape this closes: a query
 * matching an entity id without also filtering on the owning athlete "passes
 * every single-athlete test in the suite".
 */

import type { AthleteId, PrivacyZoneRecord, RouteId, RouteRecord } from '@onyourleft/store';

export interface RouteStore {
  /**
   * The athlete's saved routes, newest first.
   *
   * ⚠️ **Bounded by the caller**, and the bound matters more here than on the
   * segment list: a route row carries its whole profile — four numbers per ten
   * metres — so an unbounded read decodes megabytes to render a list of names.
   * {@link ROUTE_LIST_LIMIT} is where this screen states its budget.
   */
  listRoutes(owner: AthleteId, limit?: number): Promise<RouteRecord[]>;
  getRoute(owner: AthleteId, id: RouteId): Promise<RouteRecord | undefined>;
  putRoute(record: RouteRecord): Promise<RouteId>;
  deleteRoute(owner: AthleteId, id: RouteId): Promise<boolean>;
  /**
   * The athlete's own zones.
   *
   * Read for the *share* decision rather than for rendering: `share.ts` applies
   * them to the payload, and the screen refuses to publish a route whose ends
   * they would remove. A rider's own view of their own route is never trimmed
   * — ADR 0004 decision E — which is why nothing else on this screen consults
   * them.
   */
  listPrivacyZones(owner: AthleteId): Promise<PrivacyZoneRecord[]>;
}

export interface RoutePort {
  readonly athleteId: AthleteId;
  readonly store: RouteStore;
}

/**
 * How many saved routes the list decodes: **50**.
 *
 * A budget rather than a guess. Fifty 5 km routes is about 25 000 grid samples
 * — four numbers each — which is a read a phone can do without stalling the
 * frame that renders it. A rider with more than fifty saved routes sees their
 * fifty newest, which is the same rule `BESTS_ACTIVITY_LIMIT` and
 * `HISTORY_ACTIVITY_LIMIT` follow, and for the same reason: an unbounded read
 * on a growing library is a screen that gets slower every month until somebody
 * notices.
 */
export const ROUTE_LIST_LIMIT = 50;
