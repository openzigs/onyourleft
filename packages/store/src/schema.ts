// SPDX-License-Identifier: Apache-2.0

/**
 * The Dexie schema, version by version.
 *
 * ADR 0005 section F: **the migration tool is Dexie's own versioning**, and
 * that is a decision rather than an omission — a standalone migrator would be a
 * second source of truth for the schema version alongside the one IndexedDB
 * already maintains.
 *
 * There is exactly one version today, because this is a new store: a database
 * that has never shipped has nothing to migrate from. `migrations.ts` holds the
 * `up`/`down` contract the first schema change will use, and its registry is
 * empty and says so.
 *
 * ## What is indexed, and which query each index is for
 *
 * IndexedDB has no query planner, no `EXPLAIN` and no statistics — so an index
 * is used when the code asks for it by name and not otherwise. Declaring an
 * index is therefore only half the job; `activity-store.ts` has to route the
 * query through it, and `activity-store.index-path.test.ts` asserts that it
 * does by spying on `IDBIndex` and `IDBObjectStore`.
 *
 * Every activity and lap index is **compound and leads with `athleteId`**. That
 * is not for speed. It is the shape that makes the athlete-scoped query the
 * natural one to write: there is no index that answers "the activity with this
 * id" without also being told whose it is, so the cross-athlete lookup
 * CLAUDE.md section 6 warns about is awkward to write by accident.
 */

/** The current schema version. Bumping it means adding a migration pair. */
export const SCHEMA_VERSION = 1;

/**
 * Dexie stores its schema version in IndexedDB multiplied by ten, leaving room
 * for the intermediate versions its own upgrade machinery needs.
 *
 * Named here because `ActivityStore` compares the on-disk version against the
 * declared one to catch a downgrade Dexie would otherwise let through silently
 * (see `StoreVersionError`), and that comparison needs the factor. It is an
 * implementation detail of a dependency, so it is **asserted** by
 * `activity-store.version-guard.test.ts` rather than trusted: if a future Dexie
 * changes it, that test goes red instead of the guard going quiet.
 */
export const DEXIE_IDB_VERSION_MULTIPLIER = 10;

/** The object store names, so a typo is a compile error rather than a new table. */
export const TABLE = {
  athletes: 'athletes',
  activities: 'activities',
  laps: 'laps',
  privacyZones: 'privacyZones',
} as const;

/**
 * The index names, spelled once.
 *
 * Dexie names a compound index by its bracketed key path, and getting one
 * character wrong turns `where(...)` into a runtime `SchemaError` rather than a
 * silent scan — but only on the code path that runs it. Naming them here means
 * the typechecker catches it instead.
 */
export const INDEX = {
  /** `getActivity` — the athlete-scoped point lookup. */
  activityByAthleteAndId: '[athleteId+id]',
  /** `listActivitySummaries` ordered by date, the #62 default. */
  activityByAthleteAndStartedAt: '[athleteId+startedAt]',
  /** `listActivitySummaries` ordered by distance, #62's second sort. */
  activityByAthleteAndDistance: '[athleteId+distance]',
  /** `findActivityByOriginalFileHash` — what #37 deduplicates on. */
  activityByAthleteAndFileHash: '[athleteId+originalFileSha256]',
  /** `deleteAthlete`'s cascade, and any future athlete-wide sweep. */
  activityByAthlete: 'athleteId',
  /** `listLaps` — athlete-scoped, ordered by position within the activity. */
  lapByAthleteAndActivityAndOrdinal: '[athleteId+activityId+ordinal]',
  /** `deleteActivity`'s and `deleteAthlete`'s cascades. */
  lapByActivity: 'activityId',
  lapByAthlete: 'athleteId',
  /** `listPrivacyZones`. */
  privacyZoneByAthlete: 'athleteId',
} as const;

/**
 * Version 1 — the initial schema.
 *
 * The leading entry of each string is the primary key; the rest are indexes.
 * No `++` anywhere: keys are opaque strings generated on the device, not
 * auto-incrementing integers. There is no server to allocate a sequence (owner
 * decision D6) and a monotonic integer collides the moment two devices sync in
 * Phase 3.
 *
 * `[athleteId+originalFileSha256]` is deliberately **not** unique. #37 owns the
 * deduplication *policy* — whether a re-import is refused, merged or allowed —
 * and a unique index would decide it here, in the schema, where changing it
 * later is a migration. This index makes the lookup cheap; the decision stays
 * with the issue that owns it.
 */
export const STORES_V1: Readonly<Record<string, string>> = {
  [TABLE.athletes]: 'id, createdAt',
  [TABLE.activities]: [
    'id',
    INDEX.activityByAthlete,
    INDEX.activityByAthleteAndId,
    INDEX.activityByAthleteAndStartedAt,
    INDEX.activityByAthleteAndDistance,
    INDEX.activityByAthleteAndFileHash,
  ].join(', '),
  [TABLE.laps]: [
    'id',
    INDEX.lapByActivity,
    INDEX.lapByAthlete,
    INDEX.lapByAthleteAndActivityAndOrdinal,
  ].join(', '),
  [TABLE.privacyZones]: ['id', INDEX.privacyZoneByAthlete].join(', '),
};
