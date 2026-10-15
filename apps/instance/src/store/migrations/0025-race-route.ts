// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0025 (#331): **which route a consented ride may be raced on** —
 * `activity_record.race_route_sha256`.
 *
 * It is the SHA-256 of the route's canonical GPX (`apps/web/src/detail/
 * race-consent.ts` §`raceRouteText`: the route writer's text with no name and
 * no times, the same bytes a room's `routeRef` is taken over). Another rider
 * racing the same route computes the same digest from their own copy of it,
 * and that is the ONLY way they find a ghost: the instance never lists routes,
 * and a rider who does not already hold the route cannot name it.
 *
 * It is set only by the device that SIGNED the ride, and only when that
 * device's privacy zones, at their widest trim, do not touch the route (ADR
 * 0021 D-5.2, ADR 0039 D-2.2). Zones never leave the device (ADR 0004), so
 * this column is how their answer reaches the instance: `NULL` is "not
 * offered", whether because the rider never consented, because a zone touches
 * the route, or because the ride has no route at all. A revocation clears it
 * (`sql-store.ts` §`setActivityMayBeRaced`).
 *
 * `activity_record_race_route` is a PARTIAL index over consented, offered rows
 * alone, keyed by the route and the arrival time — the cross-rider read
 * (`listRaceableOnRoute`) asks one route, newest first.
 *
 * `down` drops the index and the column. Every offer is lost with it, which is
 * the safe direction: an instance that cannot read the column serves no ghost.
 */

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('activity_record')
    .addColumn('race_route_sha256', 'text', (column) =>
      column.check(sql`race_route_sha256 is null or length(race_route_sha256) = 64`),
    )
    .execute();
  await db.schema
    .createIndex('activity_record_race_route')
    .on('activity_record')
    .columns(['race_route_sha256', 'received_at'])
    .where(sql.ref('may_be_raced'), '=', 1)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('activity_record_race_route').execute();
  await db.schema.alterTable('activity_record').dropColumn('race_route_sha256').execute();
}
