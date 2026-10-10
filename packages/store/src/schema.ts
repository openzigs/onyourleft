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
 * **18** since #1236; 17 since #898; 16 since #836; 15 since #793; 14 since #776 (#893's review); 13 since #800, 12 since #388. Version 2 added `streamSets` and `streamBlobs`; version 3
 * added `recordingSessions` and `recordingChunks`; version 4 added `deviceKeys`
 * and `activityRecords`; version 5 added `segments`; version 6 added
 * `segmentEfforts` and `matchCheckpoints`; version 7 added `routes`; version 8
 * added `workouts`. All of those are purely additive **new stores** and change
 * no existing record's shape.
 *
 * ⚠️ **Version 9 is the first bump that re-declares an existing store.** It adds
 * `[athleteId+routeId]` to `activities`, so #93's ghost lookup can ask "this
 * athlete's rides on this route" as one index hit. It is still not a *record*
 * migration: `ActivityRecord.routeId` is **optional**, so every row written
 * before it is already valid after it and there is nothing to transform. Dexie
 * rebuilds the index for existing rows on upgrade; a row with no `routeId` is
 * simply absent from a compound index that names it, which is the behaviour the
 * lookup wants anyway — a ride that was not ridden on a route is not a ghost
 * candidate for one.
 *
 * That is why `SCHEMA_MIGRATIONS` in `migrations.ts` is still empty: the
 * registry holds *record* migrations, and there is still no record to
 * transform. The version bumps themselves are real and are tested —
 * `migrations.test.ts` opens a version-1 database, writes rows into it, reopens
 * at the current version, and asserts every row came through and the new stores
 * are usable.
 *
 * ⚠️ **Version 10 is #384's `cameraFrames`, and it is additive like versions 2
 * to 8 rather than a record migration like the one `migrations.ts` is waiting
 * for.** No existing record's shape changes, so `SCHEMA_MIGRATIONS` stays
 * empty — and that is the same call `migrations.ts` argues for at length:
 * *"writing a speculative one to have something to demonstrate would put a
 * schema change into the athlete's upgrade path that no issue asked for."* An
 * `up`/`down` pair over a shape that does not change is two identity functions
 * and a test that they are identities.
 *
 * ⚠️ **So what stands in for #384's rollback criterion is the one this storage
 * engine can actually have**, and `migrations.ts` states it: IndexedDB has no
 * downgrade event, so the runtime rollback is **export → downgrade →
 * re-import**. #384 is the issue that makes that real for a frame rather than
 * aspirational — the account export carries every kept picture as its own file
 * (ADR 0029 D-3), so a rider who downgrades has them. `migrations.test.ts`
 * opens a version-1 database, writes rows into it, reopens at the current
 * version and asserts every row came through **and** that the new store is
 * usable, which is the forward half executed rather than described.
 *
 * ⚠️ **Version 11 is #528's `framingReferences`, and it is additive for the
 * same reason.** A new store, no existing shape touched, `SCHEMA_MIGRATIONS`
 * still empty. Its rollback is the same export → downgrade → re-import: the
 * account export carries the reference in the manifest (ADR 0004 E).
 *
 * ⚠️ **Version 12 is #388's `sideCameraReports`, and it is additive for the
 * same reason again.** A new store, no existing shape touched,
 * `SCHEMA_MIGRATIONS` still empty. Its rollback is export → downgrade →
 * re-import: the account export carries each ride's report in the manifest
 * entry for that ride (ADR 0004 E).
 *
 * ⚠️ **Version 13 is #800, and it is the first bump that IS a record
 * migration.** It adds `rideWriteUps` — one model write-up per ride — and it
 * changes the shape of every existing `sideCameraReports` row: each gains a
 * required `pose`, the side-camera session's pose summary (differences only),
 * `null` where none was kept. So `SCHEMA_MIGRATIONS` holds its first entry,
 * `migrations.ts` §`SIDE_REPORT_POSE_SUMMARY`, and `ActivityStore` hands it to
 * Dexie as version 13's `.upgrade()`. Its rollback is tested as a pure `up` /
 * `down` pair on a fixture and executed against a real version-12 database in
 * `migrations.test.ts`.
 *
 * ⚠️ **Version 14 is the sync base (#776, after #893's review)**, additive
 * again: a new store, `syncBases`, and no existing record's shape changes.
 *
 * ⚠️ **Version 15 is #793, the second record migration**: every activity
 * gains a required `mayBeRaced`, `false` for every ride written before
 * (`migrations.ts` §`ACTIVITY_MAY_BE_RACED`). No store and no index changes
 * — see {@link STORES_V15} for why the cross-rider read needs no new index.
 *
 * ⚠️ **Version 16 is #836's `riderTexts`** — the rider's goals, ride notes and
 * documents — additive: a new store, and no existing record's shape changes
 * (a sync base row may now carry a `null` ride, for a goal or a document,
 * which no row written at 15 does).
 *
 * ⚠️ **Version 17 is #898's `trustedDeviceKeys`** — the athlete's other
 * devices' public keys, admitted on THIS device, which a sync checks a pulled
 * record's key against rather than trusting the instance's device list.
 * Additive: a new store, and no existing record's shape changes.
 *
 * ⚠️ **Version 18 is #1236's `workoutGoals`** — the rider's typed workout
 * goals, one row per athlete, which bound a heart-rate hold or a re-plan during
 * the ride (ADR 0048 D-10). Additive: a new store, and no existing record's
 * shape changes.
 *
 * Bumping this for a change that *does* alter a record's shape means adding a
 * migration pair.
 */
export const SCHEMA_VERSION = 18;

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
  /** #66: one row per timed traversal, keyed so a re-match rewrites rather than adds. */
  segmentEfforts: 'segmentEfforts',
  /** #66: one row per backfill in progress — how far it got, so it can resume. */
  matchCheckpoints: 'matchCheckpoints',
  /** #89: one row per saved route — a line to ride, and the profile built from it. */
  routes: 'routes',
  /** #14: one row per saved workout — the blocks, not a rendering of them. */
  workouts: 'workouts',
  /**
   * #384: one row per still picture the rider chose to keep from a ride.
   *
   * ⚠️ **Empty on an ordinary device.** ADR 0029 D-2 discards a frame after it
   * has been looked at unless the rider turns on this ride's keep, and the
   * switch is off every time. A device with rows here is one whose owner asked
   * for them.
   */
  cameraFrames: 'cameraFrames',
  /**
   * #528: at most one row per athlete — where the rider was in the side
   * camera's picture the last time the framing check passed. Numbers, never a
   * picture (ADR 0033 D-7). Keyed by the athlete.
   */
  framingReferences: 'framingReferences',
  /**
   * #388: at most one row per ride — the side camera's post-ride report, as
   * the sentences it rendered. Words only: no picture, no pose point, no
   * number. Keyed by the activity, read by the athlete and the activity.
   */
  sideCameraReports: 'sideCameraReports',
  /**
   * #800: at most one row per ride — a model's write-up of it, as it passed
   * the runtime screen (#798). Plain text and the template it followed; no
   * model name, address, key or raw reply. Keyed by the activity, so a new
   * analysis replaces the saved one; read by the athlete and the activity.
   */
  rideWriteUps: 'rideWriteUps',
  /**
   * #776, after #893's review: what this device and its instance agreed on at
   * the last sync, one row per ride and per item of a ride — two digests, no
   * body. Keyed by the athlete, the kind and the key together, and outliving
   * the ride it names on purpose (`records.ts` §`SyncBaseRecord`).
   */
  syncBases: 'syncBases',
  /**
   * #836: what the rider wrote or added for the analysis agent's history —
   * their goals, a note per ride and their documents — plain text, kept here
   * first and synced (ADR 0040 D-1). Keyed by the athlete, the kind and the
   * key together, like the sync base, so no row can be named without naming
   * whose it is.
   */
  riderTexts: 'riderTexts',
  /**
   * #898: the public keys of the athlete's OTHER devices that were admitted on
   * this device — the keys a sync takes a pulled record from
   * (`records.ts` §`TrustedDeviceKeyRecord`). Keyed by the athlete and the key
   * together, so no row can be named without naming whose it is.
   */
  trustedDeviceKeys: 'trustedDeviceKeys',
  /**
   * #1236: the rider's typed workout goals (`records.ts`
   * §`WorkoutGoalsRecord`). One row per athlete, keyed BY the athlete, so no
   * row can be named without naming whose it is.
   */
  workoutGoals: 'workoutGoals',
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
  /**
   * `listRouteAttempts` — #93's ghost lookup, and the reason it is a *compound*
   * index rather than a plain `routeId` one.
   *
   * ⚠️ An index on `routeId` alone would serve the same screen and would return
   * **every athlete's** rides on that route. #93's fifth acceptance criterion
   * names exactly that failure, and notes that it passes every single-athlete
   * test in the suite — because with one athlete in the fixture the two queries
   * are indistinguishable. The athlete component is first so the index cannot be
   * used without it.
   */
  activityByAthleteAndRoute: '[athleteId+routeId]',
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
  /** #66: `listEfforts` — the athlete's efforts on one segment, fastest first. */
  effortByAthleteAndSegment: '[athleteId+segmentId+elapsed]',
  /** #66: the athlete-scoped point lookup, and the shared-board read. */
  effortByAthleteAndSegmentAndVisibility: '[athleteId+segmentId+visibility]',
  /** #66: re-matching one activity, and `deleteActivity`'s cascade. */
  effortByAthleteAndActivity: '[athleteId+activityId]',
  effortByActivity: 'activityId',
  /** #66: `deleteAthlete`'s cascade, and `deleteSegment`'s. */
  effortByAthlete: 'athleteId',
  effortBySegment: 'segmentId',
  /** #66: a backfill's own row, scoped to the athlete who started it. */
  checkpointByAthlete: 'athleteId',
  /**
   * #89: `getRoute` — the athlete-scoped point lookup.
   *
   * ⚠️ **`createdBy`, not `athleteId`**, for `segmentByCreatorAndId`'s reason:
   * an index names a key path literally and that is what the record calls its
   * owning column. Same scoping column, different name.
   */
  routeByOwnerAndId: '[createdBy+id]',
  /** #89: `listRoutes`, newest first — and `deleteAthlete`'s cascade. */
  routeByOwnerAndCreatedAt: '[createdBy+createdAt]',
  routeByOwner: 'createdBy',
  /**
   * #14: `getWorkout` — the athlete-scoped point lookup.
   *
   * ⚠️ The three workout indexes are **string-identical** to the three route
   * ones and are still named separately. Dexie resolves an index by its key
   * path per table, so sharing the constant would work today and would read as
   * a claim that the two stores are the same shape — which is how a query
   * against the wrong table gets written. `segments` and `routes` are already
   * separate for the same reason; this is the third.
   */
  workoutByOwnerAndId: '[createdBy+id]',
  /** #14: `listWorkouts`, newest first — and `deleteAthlete`'s cascade. */
  workoutByOwnerAndCreatedAt: '[createdBy+createdAt]',
  workoutByOwner: 'createdBy',
  /**
   * #384: `listCameraFrames`, newest first — the account export's read.
   *
   * ⚠️ **`athleteId`, not `createdBy`.** The three stores above call their
   * owning column `createdBy` because that is what their records call it; this
   * one calls it `athleteId` because that is what *its* record calls it, and an
   * index names a key path literally. Same scoping column, third spelling in
   * this file — `segmentByCreatorAndId` records the same point.
   */
  cameraFrameByAthleteAndCapturedAt: '[athleteId+capturedAt]',
  /** #384: `deleteCameraFrames`, and `deleteAthlete`'s cascade. */
  cameraFrameByAthlete: 'athleteId',
  /**
   * #388: `getSideCameraReport` — the athlete-scoped point lookup, so there is
   * no read of a report that is not also told whose ride it is.
   */
  sideCameraReportByAthleteAndActivity: '[athleteId+activityId]',
  /** #388: `deleteAthlete`'s cascade. */
  sideCameraReportByAthlete: 'athleteId',
  /**
   * #800: `getRideWriteUp` — the athlete-scoped point lookup, so there is no
   * read of a write-up that is not also told whose ride it is.
   */
  rideWriteUpByAthleteAndActivity: '[athleteId+activityId]',
  /** #800: `deleteAthlete`'s cascade. */
  rideWriteUpByAthlete: 'athleteId',
  /**
   * `listSyncBase` and `deleteAthlete`'s cascade. The primary key is
   * `[athleteId+kind+key]`, so `deleteSyncBase` is scoped by construction:
   * there is no key that names a row without naming whose it is.
   */
  syncBaseByAthlete: 'athleteId',
  /** #836: `deleteAthlete`'s cascade. */
  riderTextByAthlete: 'athleteId',
  /** #836: `listRiderTexts` — one athlete's texts of one kind, as one index range. */
  riderTextByAthleteAndKind: '[athleteId+kind]',
  /** #898: `listTrustedDeviceKeys` and `deleteAthlete`'s cascade. */
  trustedDeviceKeyByAthlete: 'athleteId',
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

/**
 * Version 6 — #66's efforts, and the checkpoint that makes a backfill resumable.
 *
 * ## `segmentEfforts` is keyed on a DERIVED id — and that is not what makes
 * re-matching idempotent
 *
 * #66's sixth criterion is that re-running the matcher over an already-matched
 * activity is idempotent — *"without this, every app restart inflates every
 * leaderboard"*. **What delivers that is `putActivityEfforts` replacing the
 * activity's whole effort set**, deleting the ones the matcher no longer finds.
 * The derived id (`segmentId::activityId::startedAt`, from
 * `@onyourleft/domain`'s `effortId`) buys something else: an effort keeps the
 * same identity across a re-match, so anything holding a reference to one —
 * a link the rider shared, a Phase 4 signed record — still points at it.
 *
 * ⚠️ **This paragraph said the opposite first, and the fake proved it wrong.**
 * `testing/fakes.ts` originally modelled a store that minted a fresh id per
 * write, on the theory that the id was the mechanism; it stayed **green**,
 * because replacing the set absorbs a changed id. The fake that goes red is one
 * that *appends*. Two properties, two mechanisms, two tests — recorded here
 * because the plausible-sounding version is the wrong one.
 *
 * Every index leads with `athleteId`, like every other index in this file:
 * there is no query that finds an effort without being told whose it is, which
 * is the cross-athlete shape CLAUDE.md section 6 names. `effortByActivity` and
 * `effortBySegment` are the two exceptions and exist **only** for the delete
 * cascades, which are already inside an athlete-scoped call.
 *
 * `[athleteId+segmentId+elapsed]` puts a personal best one index lookup away —
 * Dexie orders a compound index by its last component, so "the athlete's
 * fastest time on this segment" is the first row rather than a sort of all of
 * them.
 *
 * ## `matchCheckpoints` is keyed on the athlete, one row
 *
 * A backfill is a background job over the whole library (#66: the incumbent
 * warns its own users this "may take several hours"), and killing the tab
 * mid-run must not double-count. One row per athlete holds how far the sweep
 * got; a resumed run starts from there. It is deliberately *not* keyed on the
 * segment being backfilled: two concurrent backfills over one library would
 * both be walking the same activities, and the honest model is one sweep at a
 * time per athlete.
 *
 * ⚠️ **The checkpoint is an optimisation, not the correctness mechanism.** The
 * derived effort id is what makes a resumed run produce the same count as a
 * clean one; the checkpoint only stops it redoing work. A checkpoint that was
 * lost costs time and cannot corrupt anything, which is the property to keep if
 * anyone changes this.
 */
export const STORES_V6: Readonly<Record<string, string>> = {
  // The nine stores of versions 1 to 5 are inherited unchanged.
  [TABLE.segmentEfforts]: [
    'id',
    INDEX.effortByAthlete,
    INDEX.effortByActivity,
    INDEX.effortBySegment,
    INDEX.effortByAthleteAndActivity,
    INDEX.effortByAthleteAndSegment,
    INDEX.effortByAthleteAndSegmentAndVisibility,
  ].join(', '),
  [TABLE.matchCheckpoints]: 'athleteId',
};

/**
 * Version 7 — #89's saved routes, added beside the eleven stores that exist.
 *
 * Keyed on `id`, with every index leading with `createdBy`, so there is no
 * index that answers "the route with this id" without also being told whose it
 * is. That is the shape CLAUDE.md section 6 asks for and the reason every other
 * index in this file has it.
 *
 * ⚠️ **The index strings are the same three as `segments`, and the two stores
 * are deliberately separate rather than one "saved line" store.** A segment is
 * a stretch a rider is *ranked* on and carries endpoints, bearings and a
 * visibility; a route is a line they intend to *ride* and carries a profile. A
 * shared store would need every one of those columns to be optional, and the
 * first query to forget which kind of row it was reading would rank a route.
 *
 * ⚠️ **No index on anything OSM-derived, because no such field exists**
 * (ADR 0012 D-1) — `records.ts` says why a way id on a route would be an ODbL
 * problem rather than a rendering optimisation.
 */
export const STORES_V7: Readonly<Record<string, string>> = {
  // The eleven stores of versions 1 to 6 are inherited unchanged.
  [TABLE.routes]: [
    'id',
    INDEX.routeByOwner,
    INDEX.routeByOwnerAndId,
    INDEX.routeByOwnerAndCreatedAt,
  ].join(', '),
};

/**
 * Version 8 — #14's saved workouts, added beside the twelve stores that exist.
 *
 * The same shape as `routes`, and for the same reason: keyed on `id`, with
 * every index leading with `createdBy`, so no index answers "the workout with
 * this id" without also being told whose it is.
 *
 * ⚠️ **No `visibility` column, and that is a decision rather than an
 * omission.** ADR 0004's default exists because a route or a ride carries
 * *coordinates* — a route's endpoints are usually the athlete's front door. A
 * workout carries none: it is durations and fractions of a threshold, and the
 * threshold itself is not stored on it. So the privacy machinery would be
 * ceremony around a record with nothing private in it. If a later issue shares
 * workouts between athletes it adds the column and the migration; adding it now
 * would be a field every read has to interpret and no read can act on.
 */
export const STORES_V8: Readonly<Record<string, string>> = {
  // The twelve stores of versions 1 to 7 are inherited unchanged.
  [TABLE.workouts]: [
    'id',
    INDEX.workoutByOwner,
    INDEX.workoutByOwnerAndId,
    INDEX.workoutByOwnerAndCreatedAt,
  ].join(', '),
};

/**
 * #93 — the ghost lookup's index.
 *
 * ⚠️ Unlike every version above it, this one **re-declares an existing store**
 * rather than adding a new one. Dexie's `version(n).stores({...})` replaces a
 * named table's whole index declaration, so `activities` is restated in full
 * here: dropping any line below would silently remove that index from the
 * upgraded database, and the queries using it would fall back to a full scan
 * that still returns correct answers. A performance regression with correct
 * results is the kind that reaches production.
 */
export const STORES_V9: Readonly<Record<string, string>> = {
  [TABLE.activities]: [
    'id',
    INDEX.activityByAthlete,
    INDEX.activityByAthleteAndId,
    INDEX.activityByAthleteAndStartedAt,
    INDEX.activityByAthleteAndDistance,
    INDEX.activityByAthleteAndFileHash,
    INDEX.activityByAthleteAndRoute,
  ].join(', '),
};

/**
 * Version 10 — #384's kept camera frames, added beside the fourteen stores that
 * exist.
 *
 * Keyed on `id`, with every index leading with `athleteId`, so there is no
 * index that answers "the picture with this id" without also being told whose
 * it is. That is the shape CLAUDE.md §6 asks for, and it matters more here than
 * anywhere else in this file: the payload is a photograph of the inside of
 * somebody's house.
 *
 * ⚠️ **There is deliberately no index on an activity, because there is no such
 * column** — `records.ts` §`CameraFrameRecord` says why at length, and names
 * the issue that adds one.
 *
 * ⚠️ **And no index on `capturedAt` alone.** A "every picture on this device,
 * newest first" query is exactly the list ADR 0029 D-11 forbids: *"No frame,
 * thumbnail, crop or filmstrip appears on the activity library row … or in any
 * list."* An index that answered it would be a query somebody writes a screen
 * against.
 */
export const STORES_V10: Readonly<Record<string, string>> = {
  // The fourteen stores of versions 1 to 9 are inherited unchanged.
  [TABLE.cameraFrames]: [
    'id',
    INDEX.cameraFrameByAthlete,
    INDEX.cameraFrameByAthleteAndCapturedAt,
  ].join(', '),
};

/**
 * Version 11 — #528's framing reference, added beside the fifteen stores that
 * exist.
 *
 * ⚠️ **Keyed on `athleteId` and on nothing else**, so the only question the
 * table can answer is *"this athlete's reference"* — there is no id to look a
 * row up by without saying whose it is, and a second put for the same athlete
 * replaces the first rather than adding a row. That is the owner's *"a stored
 * reference from the rider's last session"* expressed as a key rather than as
 * a rule a writer has to remember.
 */
export const STORES_V11: Readonly<Record<string, string>> = {
  // The fifteen stores of versions 1 to 10 are inherited unchanged.
  [TABLE.framingReferences]: 'athleteId',
};

/**
 * Version 12 — #388's side-camera reports, added beside the sixteen stores
 * that exist.
 *
 * Keyed on `activityId`, so a second report for one ride replaces the first,
 * and every read goes through {@link INDEX.sideCameraReportByAthleteAndActivity}
 * — there is no method that answers "the report for this ride" without also
 * being told whose ride it is (CLAUDE.md §6).
 */
export const STORES_V12: Readonly<Record<string, string>> = {
  // The sixteen stores of versions 1 to 11 are inherited unchanged.
  [TABLE.sideCameraReports]: [
    'activityId',
    INDEX.sideCameraReportByAthlete,
    INDEX.sideCameraReportByAthleteAndActivity,
  ].join(', '),
};

/**
 * Version 13 — #800's ride write-ups, added beside the seventeen stores that
 * exist, and the version whose `.upgrade()` gives every side-camera report its
 * pose summary field (`migrations.ts` §`SIDE_REPORT_POSE_SUMMARY`).
 *
 * `sideCameraReports` is **not** re-declared: the new field is not indexed, so
 * its key path and indexes are unchanged. What changes is every row's shape,
 * and that is the migration's job rather than the schema string's.
 *
 * Keyed on `activityId`, for {@link STORES_V12}'s reason: a second write-up
 * for one ride replaces the first, and every read goes through
 * {@link INDEX.rideWriteUpByAthleteAndActivity}.
 */
export const STORES_V13: Readonly<Record<string, string>> = {
  // The seventeen stores of versions 1 to 12 are inherited unchanged.
  [TABLE.rideWriteUps]: [
    'activityId',
    INDEX.rideWriteUpByAthlete,
    INDEX.rideWriteUpByAthleteAndActivity,
  ].join(', '),
};

/**
 * Version 14 — the sync base (#776, after #893's review), added beside the
 * eighteen stores that exist. Additive: a new store, no existing shape
 * touched, so `SCHEMA_MIGRATIONS` gains nothing. Its rollback is export →
 * downgrade → re-import like every additive version's, and it loses nothing
 * that matters: a device with no base syncs as a device that never synced.
 *
 * ⚠️ The primary key is compound and leads with the athlete, so no row can be
 * named — read, replaced or deleted — without naming whose it is.
 */
export const STORES_V14: Readonly<Record<string, string>> = {
  // The eighteen stores of versions 1 to 13 are inherited unchanged.
  [TABLE.syncBases]: ['[athleteId+kind+key]', INDEX.syncBaseByAthlete].join(', '),
};

/**
 * Version 15 — #793's "may be raced" consent. **No store and no index
 * changes**: the version exists for its `.upgrade()`, which writes
 * `mayBeRaced: false` onto every activity (`migrations.ts`
 * §`ACTIVITY_MAY_BE_RACED`).
 *
 * ⚠️ **There is deliberately no index on `routeId` alone, or leading with it**,
 * though the cross-rider read `listRaceableAttempts` asks about one route over
 * every athlete. Such an index is exactly what
 * `activity-store.ghost-scope.test.ts` warns about — the two-character change
 * that turns #93's own-ghost lookup into "every rider's rides on this route".
 * The read walks the athletes on the device instead (a handful) and asks each
 * one's `[athleteId+routeId]` index, so the only index that answers "rides on
 * this route" still cannot be asked without an athlete. And a boolean is not a
 * valid IndexedDB key, so an index over the consent would hold no rows at all.
 */
export const STORES_V15: Readonly<Record<string, string>> = {
  // The nineteen stores of versions 1 to 14 are inherited unchanged.
};

/**
 * Version 16 — #836's rider texts, added beside the nineteen stores that
 * exist. Additive: a new store, no existing shape touched, so
 * `SCHEMA_MIGRATIONS` gains nothing. Its rollback is export → downgrade →
 * re-import: the account export carries every goal, note and document as the
 * rider's own data (ADR 0040 D-10).
 *
 * The primary key is compound and leads with the athlete, for
 * {@link STORES_V14}'s reason.
 */
export const STORES_V16: Readonly<Record<string, string>> = {
  // The nineteen stores of versions 1 to 15 are inherited unchanged.
  [TABLE.riderTexts]: [
    '[athleteId+kind+key]',
    INDEX.riderTextByAthlete,
    INDEX.riderTextByAthleteAndKind,
  ].join(', '),
};

/**
 * Version 17 — #898's trusted device keys, added beside the twenty stores that
 * exist. Additive: a new store, no existing shape touched, so
 * `SCHEMA_MIGRATIONS` gains nothing. Its rollback is export → downgrade →
 * re-import like every additive version's; what a downgrade loses is the set
 * of keys admitted here, so a sync after it pulls nothing signed by another
 * device until each is admitted again — the safe direction.
 *
 * The primary key is compound and leads with the athlete, for
 * {@link STORES_V14}'s reason.
 */
export const STORES_V17: Readonly<Record<string, string>> = {
  // The twenty stores of versions 1 to 16 are inherited unchanged.
  [TABLE.trustedDeviceKeys]: ['[athleteId+publicKey]', INDEX.trustedDeviceKeyByAthlete].join(', '),
};

/**
 * Version 18 — #1236's typed workout goals, added beside the twenty-one stores
 * that exist. Additive: a new store, no existing shape touched, so
 * `SCHEMA_MIGRATIONS` gains nothing — there is no record to transform, and a
 * `down` over one would be the identity (`migrations.ts` §"The registry").
 * Its rollback is export → downgrade → re-import, executed by
 * `workout-goals-store.test.ts` §"rolls back": what a downgrade loses is the
 * goals themselves, which the rider's own read gives back to be saved again.
 *
 * The primary key IS the athlete: one row each, and no row can be named
 * without naming whose it is.
 */
export const STORES_V18: Readonly<Record<string, string>> = {
  // The twenty-one stores of versions 1 to 17 are inherited unchanged.
  [TABLE.workoutGoals]: 'athleteId',
};

export const SCHEMA_VERSIONS: readonly Readonly<Record<string, string>>[] = [
  STORES_V1,
  STORES_V2,
  STORES_V3,
  STORES_V4,
  STORES_V5,
  STORES_V6,
  STORES_V7,
  STORES_V8,
  STORES_V9,
  STORES_V10,
  STORES_V11,
  STORES_V12,
  STORES_V13,
  STORES_V14,
  STORES_V15,
  STORES_V16,
  STORES_V17,
  STORES_V18,
];
