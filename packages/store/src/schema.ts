// SPDX-License-Identifier: Apache-2.0

/**
 * The Dexie schema, version by version.
 *
 * ADR 0005 section F: **the migration tool is Dexie's own versioning**, and
 * that is a decision rather than an omission — a standalone migrator would be a
 * second source of truth for the schema version alongside the one IndexedDB
 * already maintains.
 *
 * There are three versions. Version 1 (#26) is athletes, activities, laps and
 * privacy zones. Version 2 (#27) **adds** `streamSets` and `streamBlobs`.
 * Version 3 (#46) **adds** `recordingSessions` and `recordingChunks`. Each of
 * the two later versions touches nothing that already exists, so neither needs
 * a record migration — `migrations.ts` holds the `up`/`down` contract the first
 * record-shape change will use, and its registry is still empty and says why.
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

/**
 * The current schema version.
 *
 * **5** since #64. Version 2 added `streamSets` and `streamBlobs`; version 3
 * added `recordingSessions` and `recordingChunks`; version 4 added `deviceKeys`
 * and `activityRecords`; version 5 adds `segments`. All four are purely additive
 * and change **no existing record's shape**. That is why `SCHEMA_MIGRATIONS` in
 * `migrations.ts` is still empty: the registry holds *record* migrations, and
 * there is no record to transform. The version bumps themselves are real and
 * are tested — `migrations.test.ts` opens a version-1 database, writes rows
 * into it, reopens at the current version, and asserts every row came through
 * and the new stores are usable.
 *
 * Bumping this for a change that *does* alter a record's shape means adding a
 * migration pair.
 */
export const SCHEMA_VERSION = 5;

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
  /** #27: one small indexed row per activity — the time base and the channel list. */
  streamSets: 'streamSets',
  /** #27: one row per channel per activity, holding the packed, compressed bytes. */
  streamBlobs: 'streamBlobs',
  /** #46: one small indexed row per recording in progress — the time base and the pauses. */
  recordingSessions: 'recordingSessions',
  /** #46: one append-only row per flush, holding that window's packed bytes. */
  recordingChunks: 'recordingChunks',
  /** #61: one row per athlete — the device's Ed25519 keypair. Write-once. */
  deviceKeys: 'deviceKeys',
  /** #61: one row per activity — the signed, content-addressed record. */
  activityRecords: 'activityRecords',
  /** #64: one row per segment — a named stretch of road with a direction. */
  segments: 'segments',
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
  /** `getStreamSet` and `getStreamSetSummary` — the athlete-scoped point lookup. */
  streamSetByAthleteAndActivity: '[athleteId+activityId]',
  /** `deleteAthlete`'s cascade over stream sets. */
  streamSetByAthlete: 'athleteId',
  /**
   * `getStreamSet`'s whole-set fetch and `getStreamChannel`'s single-channel
   * one. Three components rather than two so the single-channel read is an
   * exact index lookup rather than a scan of the set followed by a filter —
   * which is the same reason `listLaps` has `[athleteId+activityId+ordinal]`.
   */
  streamBlobByAthleteAndActivityAndChannel: '[athleteId+activityId+channel]',
  /** `deleteActivity`'s cascade over blobs. */
  streamBlobByActivity: 'activityId',
  /** `deleteAthlete`'s cascade over blobs. */
  streamBlobByAthlete: 'athleteId',
  /** `getRecordingSession` — the athlete-scoped point lookup. */
  recordingSessionByAthleteAndId: '[athleteId+id]',
  /** `listRecordingSessions`, newest checkpoint first — what #46's recovery prompt reads. */
  recordingSessionByAthleteAndUpdatedAt: '[athleteId+updatedAt]',
  /** `deleteAthlete`'s cascade over recordings. */
  recordingSessionByAthlete: 'athleteId',
  /**
   * `readRecordingChunks` and `getRecordingFootprint` — the athlete-scoped
   * range read, in append order.
   *
   * Three components rather than two so recovery walks the chunks of one
   * recording in `seq` order through the index, rather than reading every chunk
   * on the device and sorting. A recovery path that scanned would get slower
   * with every ride the athlete has ever half-recorded.
   */
  recordingChunkByAthleteAndSessionAndSeq: '[athleteId+sessionId+seq]',
  /** `deleteRecordingSession`'s cascade. */
  recordingChunkBySession: 'sessionId',
  /** `deleteAthlete`'s cascade over chunks. */
  recordingChunkByAthlete: 'athleteId',
  /**
   * `getActivityRecord` — the athlete-scoped point lookup for a signed record.
   *
   * `deviceKeys` gets no entry here on purpose: its **primary key** is
   * `athleteId`, so the only lookup it admits is already scoped and there is no
   * index that could answer "the key with this id" without being told whose.
   */
  activityRecordByAthleteAndActivity: '[athleteId+activityId]',
  /** `deleteAthlete`'s cascade over signed records. */
  activityRecordByAthlete: 'athleteId',
  /**
   * `getSegment` — the athlete-scoped point lookup.
   *
   * ⚠️ **`createdBy`, not `athleteId`**, because that is what the record calls
   * its owning column and an index names a key path literally. It is the same
   * scoping column under a different name, and it leads every segment index for
   * the reason every other index in this file leads with the owner.
   */
  segmentByCreatorAndId: '[createdBy+id]',
  /** `listSegments`, newest first — and `deleteAthlete`'s cascade. */
  segmentByCreatorAndCreatedAt: '[createdBy+createdAt]',
  segmentByCreator: 'createdBy',
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

/**
 * Version 2 — #27's stream storage, added beside version 1 rather than over it.
 *
 * Dexie merges a version's `stores()` with the previous version's, so only the
 * two new entries are needed. They are declared beside a comment naming the
 * unchanged four rather than repeated, because repeating them invites the two
 * copies to drift and a re-declared store with a changed index string is a
 * silent index rebuild.
 *
 * `streamBlobs` has a **compound primary key**, `[activityId+channel]`. That is
 * the identity of the row — a channel of an activity — and making it the key
 * rather than a synthesised id means a re-encode of one channel replaces its
 * row rather than accumulating a second copy of the same bytes. It is also why
 * there is no `id` field on the row: there is nothing an id would say that the
 * pair does not.
 *
 * Every stream index leads with `athleteId`, for the reason every activity and
 * lap index does: there is no index that answers "the stream set for this
 * activity" without also being told whose it is.
 */
export const STORES_V2: Readonly<Record<string, string>> = {
  // athletes, activities, laps and privacyZones are inherited from version 1
  // unchanged. Dexie carries forward any store a version does not mention.
  [TABLE.streamSets]: [
    'activityId',
    INDEX.streamSetByAthlete,
    INDEX.streamSetByAthleteAndActivity,
  ].join(', '),
  [TABLE.streamBlobs]: [
    '[activityId+channel]',
    INDEX.streamBlobByActivity,
    INDEX.streamBlobByAthlete,
    INDEX.streamBlobByAthleteAndActivityAndChannel,
  ].join(', '),
};

/**
 * Version 3 — #46's recording checkpoints, added beside versions 1 and 2.
 *
 * `recordingChunks` has a **compound primary key**, `[sessionId+seq]`, for the
 * reason `streamBlobs` has `[activityId+channel]`: that pair *is* the row's
 * identity, so re-writing a chunk after a failed flush replaces it rather than
 * accumulating a second copy of the same window. It is also what makes the
 * append order a key rather than a convention — recovery reads a contiguous
 * prefix, and a prefix is only meaningful if `seq` is part of the key.
 *
 * Every index leads with `athleteId`, for the reason every other index in this
 * file does: there is no index that answers "the chunks of this recording"
 * without also being told whose recording it is.
 */
export const STORES_V3: Readonly<Record<string, string>> = {
  // The four stores of version 1 and the two of version 2 are inherited
  // unchanged. Dexie carries forward any store a version does not mention.
  [TABLE.recordingSessions]: [
    'id',
    INDEX.recordingSessionByAthlete,
    INDEX.recordingSessionByAthleteAndId,
    INDEX.recordingSessionByAthleteAndUpdatedAt,
  ].join(', '),
  [TABLE.recordingChunks]: [
    '[sessionId+seq]',
    INDEX.recordingChunkBySession,
    INDEX.recordingChunkByAthlete,
    INDEX.recordingChunkByAthleteAndSessionAndSeq,
  ].join(', '),
};

/**
 * Every schema version this build knows, in ascending order.
 *
 * `ActivityStore` declares all of them on every open, because Dexie needs the
 * whole history to upgrade a database that is behind — declaring only the
 * newest leaves a version-1 database on disk with no path forward. Driving that
 * from one array rather than from a list of hand-written `version(n)` calls is
 * what keeps `SCHEMA_VERSION` and the declarations from drifting apart;
 * `migrations.test.ts` asserts they agree.
 */
/**
 * Version 4 — #61's device key and signed activity records, added beside the
 * six stores that already exist.
 *
 * `deviceKeys` is keyed on `athleteId` and has **no secondary index**, which is
 * the strongest statement this schema can make about it: the row *is* the
 * athlete's identity, there is at most one, and every access is a point lookup
 * on the scoping column. A secondary index — by `publicKey`, say — would create
 * a query that finds a key without being told whose it is, and that is exactly
 * the shape CLAUDE.md section 6 names.
 *
 * `activityRecords` is keyed on `activityId`, for `streamSets`' reason: a ride
 * has at most one current record, so re-signing replaces the row rather than
 * accumulating a second one. Its indexes lead with `athleteId` like every other
 * index in this file.
 *
 * ⚠️ **`deviceKeys` holds a `CryptoKey`, not bytes.** It is created with
 * `extractable: false` (see `web-crypto.ts`), so it survives the structured
 * clone algorithm into IndexedDB and comes back able to sign and unable to be
 * exported. Do not "simplify" it to a stored byte array: the non-extractability
 * is the whole of #61's "the private key never leaves the device".
 */
export const STORES_V4: Readonly<Record<string, string>> = {
  // The six stores of versions 1 to 3 are inherited unchanged.
  [TABLE.deviceKeys]: 'athleteId',
  [TABLE.activityRecords]: [
    'activityId',
    INDEX.activityRecordByAthlete,
    INDEX.activityRecordByAthleteAndActivity,
  ].join(', '),
};

/**
 * Version 5 — #64's segments, added beside the eight stores that already exist.
 *
 * Keyed on `id`, with every index leading with `createdBy` — the owning
 * athlete, under the name #64's field table gives it. There is no index that
 * answers "the segment with this id" without also being told whose it is, which
 * is the shape CLAUDE.md section 6 asks for and the reason every other index in
 * this file has it.
 *
 * ⚠️ **There is deliberately no index on a source activity, because there is no
 * such column.** #64's second criterion is that deleting the source activity
 * leaves the segment intact, and `records.ts` explains why the reference is
 * absent rather than present-and-not-cascaded: `deleteActivity` already
 * cascades laps, streams and signed records, and a foreign key sitting there is
 * an invitation to add a fourth cascade that would delete the athlete's
 * segments when they tidied their history.
 *
 * ⚠️ **And no index on anything OSM-derived, because no such field exists**
 * (ADR 0012 D-1). A `wayId` column here would convert the segment corpus into
 * an ODbL Derivative Database; D-3 puts that data in its own store instead.
 */
export const STORES_V5: Readonly<Record<string, string>> = {
  // The eight stores of versions 1 to 4 are inherited unchanged.
  [TABLE.segments]: [
    'id',
    INDEX.segmentByCreator,
    INDEX.segmentByCreatorAndId,
    INDEX.segmentByCreatorAndCreatedAt,
  ].join(', '),
};

export const SCHEMA_VERSIONS: readonly Readonly<Record<string, string>>[] = [
  STORES_V1,
  STORES_V2,
  STORES_V3,
  STORES_V4,
  STORES_V5,
];
