// SPDX-License-Identifier: Apache-2.0

/**
 * The local activity store: athletes, activities, laps and privacy zones in
 * IndexedDB, through Dexie (ADR 0005 section F).
 *
 * ## Referential behaviour is chosen here, because nothing below chooses it
 *
 * IndexedDB has no foreign keys and no `ON DELETE` clause. #26 asks for "an
 * explicitly chosen on-delete behaviour" and for a test proving an athlete's
 * deletion does not orphan activities; on this engine that is not a schema
 * declaration, it is code in this file, and if it is not written here it does
 * not happen at all.
 *
 * **The chosen behaviour is cascade**, for both edges:
 *
 * | Deleting | Also deletes |
 * |---|---|
 * | an athlete | their activities, those activities' laps, their privacy zones |
 * | an activity | that activity's laps |
 *
 * Cascade rather than orphan-and-flag or refuse, for three reasons:
 *
 * 1. **An orphaned activity is unreachable and undeletable.** Every read in
 *    this file is athlete-scoped, so a row whose athlete is gone can never be
 *    listed, opened or removed through the public API. It would sit on the
 *    device forever, holding a GPS trace, invisible to the person who owns the
 *    device. That is a privacy liability dressed as data safety.
 * 2. **Deleting the athlete is the erasure operation.** ADR 0004 and #35 treat
 *    "delete everything about this person" as a first-class function, and a
 *    delete that leaves the rides behind has not done it. Refusing while
 *    activities exist would make erasure a loop the caller has to get right.
 * 3. **The athlete is not an account.** In Phase 1 there is one local identity
 *    per device (owner decision D6); "delete the athlete" is deliberate and
 *    rare, not an administrative side effect of removing a login.
 *
 * The cost is real and is stated so a superseding decision has something to
 * argue with: **this is irreversible and the ride file may be the only copy in
 * existence.** The mitigation is not in this layer — it is #62's named
 * confirmation and #35's export — and `deleteAthlete` returns the counts it
 * removed so a caller can state them before or after the fact.
 *
 * Each cascade runs inside **one** Dexie read-write transaction across every
 * affected store, so a half-deleted athlete is not a state this can produce.
 *
 * ## Cross-athlete exposure
 *
 * CLAUDE.md section 6: "Any query matching on an entity id **without also
 * filtering on the owning athlete**" is the defect, and "this passes every
 * single-athlete test in the suite". Every read below takes the athlete id as
 * its **first** parameter and routes through a compound index that leads with
 * it, so there is no accessor on this class that can answer "the activity with
 * this id" without being told whose it is. The tests use two athletes for the
 * same reason.
 */

import Dexie, { type Table } from 'dexie';
import type { BeatsPerMinute, Seconds, UnixSeconds, Watts } from '@onyourleft/domain';

import {
  StoreDecodeError,
  StoreReferentialError,
  StoreValidationError,
  StoreVersionError,
} from './errors';
import type {
  ActivityId,
  AthleteId,
  LapId,
  PrivacyZoneId,
  RecordingSessionId,
  RouteId,
  WorkoutId,
  SegmentId,
} from './ids';
import {
  fromPersistedActivityRecord,
  fromPersistedDeviceKey,
  toPersistedActivityRecord,
  toPersistedDeviceKey,
  type DeviceKeyRecord,
  type PersistedActivityRecord,
  type PersistedDeviceKey,
  type StoredActivityRecord,
} from './identity';
import {
  fromPersistedActivity,
  fromPersistedAthlete,
  fromPersistedLap,
  fromPersistedPrivacyZone,
  toPersistedActivity,
  toPersistedAthlete,
  toPersistedLap,
  toPersistedPrivacyZone,
  fromPersistedSegment,
  toPersistedSegment,
  fromPersistedRoute,
  fromPersistedWorkout,
  toPersistedRoute,
  toPersistedWorkout,
  type PersistedActivity,
  type PersistedAthlete,
  type PersistedLap,
  type PersistedPrivacyZone,
  type PersistedRoute,
  type PersistedWorkout,
  type PersistedSegment,
} from './persisted';
import type {
  ActivityRecord,
  ActivitySummary,
  AthleteRecord,
  LapRecord,
  NewActivity,
  NewLap,
  MatchCheckpointRecord,
  PrivacyZoneRecord,
  SegmentEffortRecord,
  SegmentRecord,
  RouteRecord,
  WorkoutRecord,
} from './records';
import type { UnitSystem } from './unit-system';
import type {
  NewRecordingChunk,
  NewRecordingSession,
  RecordingFootprint,
  RecordingSessionRecord,
  RecoveredRecording,
} from './recording';
import {
  chunkChannelEncoding,
  decodedChunkChannels,
  fromPersistedRecordingSession,
  persistedChunkBytes,
  toPersistedRecordingSession,
  type PersistedRecordingChannel,
  type PersistedRecordingChunk,
  type PersistedRecordingSession,
} from './recording-persisted';
import {
  DEXIE_IDB_VERSION_MULTIPLIER,
  INDEX,
  SCHEMA_VERSION,
  SCHEMA_VERSIONS,
  TABLE,
} from './schema';
import { channelBytesPerSample, decodeChannel, encodeChannel } from './stream-codec';
import {
  compressStreamBytes,
  decompressStreamBytes,
  MAX_INFLATED_SAMPLES,
  STREAM_COMPRESSION,
  StreamSizeError,
} from './stream-compression';
import {
  fromPersistedStreamBlob,
  fromPersistedStreamSet,
  parseStreamChannel,
  persistedBlobBytes,
  type PersistedStreamBlob,
  type PersistedStreamSet,
} from './stream-persisted';
import {
  STREAM_CHANNELS,
  type NewStreamSet,
  type Samples,
  type StreamChannel,
  type StreamSet,
  type StreamSetSummary,
} from './streams';
import { DEFAULT_VISIBILITY } from './visibility';

/** How `listActivitySummaries` orders its results. */
export type ActivityOrder = 'startedAt' | 'distance';

/** Ascending or descending. Spelled out; `true` for "reverse" reads as nothing. */
export type SortDirection = 'ascending' | 'descending';

/** @see ActivityStore.listActivitySummaries */
export interface ListActivitiesOptions {
  /** Default `'startedAt'` — the newest-first list #62 lands on. */
  readonly orderBy?: ActivityOrder;
  /** Default `'descending'`. */
  readonly direction?: SortDirection;
  /** How many to skip. Default 0. */
  readonly offset?: number;
  /** How many to return. Default: all of them. */
  readonly limit?: number;
  /**
   * Only activities that started strictly after this instant (#66).
   *
   * ⚠️ **A cursor, and it exists because `offset` is not one.** A backfill
   * sweep resumes where it stopped, and an offset shifts under it the moment
   * an older ride is imported mid-sweep — which silently *skips* an activity
   * rather than repeating one. Repeating is harmless here (the write replaces),
   * and skipping leaves a ride with no efforts and nothing to say so.
   *
   * Only meaningful with `orderBy: 'startedAt'`; it is a bound on that index.
   */
  readonly startedAfter?: UnixSeconds;
}

/** What `deleteAthlete` removed, so a caller can report it. */
export interface AthleteDeletionCounts {
  readonly activities: number;
  readonly laps: number;
  readonly privacyZones: number;
  /**
   * Routes removed (#89).
   *
   * A saved route is a line through the places an athlete rides, so it is
   * location data about them in exactly the sense ADR 0004 means, and erasure
   * that left it behind would leave their roads on the device under a row no
   * scoped read can reach.
   */
  readonly routes: number;
  /**
   * Workouts removed (#14).
   *
   * Counted like the rest, though nothing about a workout is sensitive — see
   * the note beside the delete for why it cascades regardless.
   */
  readonly workouts: number;
  /**
   * Segments removed (#64).
   *
   * ⚠️ **Erasing an athlete DOES remove their segments, and deleting one of
   * their activities does not.** Those two are not in tension and the
   * difference is the point: #64's second criterion protects a segment from a
   * rider tidying one ride, while erasure is the athlete asking for everything
   * about them to be gone — and a segment is a stretch of road they chose,
   * named, and recorded from their own trace, which is as much theirs as the
   * ride it came from.
   */
  readonly segments: number;
  /**
   * Segment efforts removed (#66).
   *
   * Counted separately from `segments` because the two answer different
   * questions for #62's confirmation dialogue: how many stretches of road the
   * athlete named, and how many timed traversals of any segment they leave
   * behind. A rider with three segments and four hundred efforts is told both.
   */
  readonly efforts: number;
  /**
   * Stream sets removed. One per activity that had streams, not one per
   * channel: the blob rows go with their set and counting them would report a
   * number eight times larger than the number of rides erased, which is the
   * number #62's confirmation dialogue has to say out loud.
   */
  readonly streamSets: number;
  /**
   * Recordings in progress removed, chunks not counted — for `streamSets`'
   * reason. A ride that was being recorded when erasure ran is erased with the
   * rest; it is the athlete's data and it holds a GPS trace.
   */
  readonly recordings: number;
}

/**
 * `Map`, not an object literal, deliberately.
 *
 * `ORDER_INDEX[orderBy]` on a plain object answers `'__proto__'` with
 * `Object.prototype` and `'constructor'` with a function, and Dexie's `where()`
 * accepts an object as a criteria specification — so an untyped caller could
 * turn a sort order into a query shape nobody wrote. A `Map` has no inherited
 * keys, and `get` on an unknown key is `undefined`, which the check below turns
 * into a stated error.
 */
/**
 * How many previous attempts on a route `listRouteAttempts` returns by default.
 *
 * #93 offers "the rider's previous attempt", singular, so one would serve the
 * shipping screen. It reads a few because the caller picks which attempt to
 * race — the most recent is the obvious default and the *fastest* is the one a
 * rider usually wants — and because a bound that is exactly one is the kind that
 * gets raised to a hundred by a later screen with no thought about the read
 * budget. Every row is a summary, not a stream: #93's ghost is built from the
 * chosen attempt's stream, read once, after the rider has chosen.
 */
const ROUTE_ATTEMPT_LIMIT = 10;

const ORDER_INDEX: ReadonlyMap<ActivityOrder, string> = new Map([
  ['startedAt', INDEX.activityByAthleteAndStartedAt],
  ['distance', INDEX.activityByAthleteAndDistance],
]);

/**
 * Opens (creating if necessary) the local activity store.
 *
 * @param name - the IndexedDB database name. Defaults to the production one.
 * Tests pass a unique name per case so they cannot see each other's rows.
 */
export function openActivityStore(name = 'onyourleft'): ActivityStore {
  return new ActivityStore(name);
}

/** Removes a database entirely. Used by tests; `#35` will use it for erasure. */
export async function deleteActivityStore(name: string): Promise<void> {
  await Dexie.delete(name);
}

export class ActivityStore {
  readonly #db: Dexie;

  constructor(name: string) {
    this.#db = new Dexie(name);
    // Every version is declared, in order, on every open. Dexie needs the whole
    // history to know how to upgrade a database that is behind — declaring only
    // the newest would leave a version-1 database on disk with no path forward.
    SCHEMA_VERSIONS.forEach((stores, index) => {
      this.#db.version(index + 1).stores(stores);
    });
    // Fires on every open, including the lazy one the first query triggers, and
    // throwing here rejects that open. See `#assertNotDowngraded`.
    this.#db.on('ready', () => {
      this.#assertNotDowngraded();
    });
  }

  /**
   * Opens the database eagerly.
   *
   * Optional in the sense that every method below opens it lazily — but worth
   * calling at startup, because the two paths do not report failure the same
   * way. On this path a `StoreVersionError` arrives unwrapped. On the lazy
   * path Dexie reports its own `DatabaseClosedError` and hangs the original on
   * `.inner` rather than on the standard `cause`, so a consumer catching by
   * class sees a Dexie error instead of this package's. Both paths refuse to
   * operate, which is the safety property; only this one is legible.
   */
  async open(): Promise<void> {
    await this.#db.open();
  }

  /** The schema version this instance opened at. */
  get schemaVersion(): number {
    return SCHEMA_VERSION;
  }

  /**
   * Closes the underlying database.
   *
   * Every persistence test in this package closes and reopens before asserting.
   * A write that reports success while the read cannot see it is this
   * program's dominant defect shape (CLAUDE.md section 5), and reading through
   * a still-open handle cannot distinguish "persisted" from "still in the
   * connection's transaction queue".
   */
  close(): void {
    this.#db.close();
  }

  get #athletes(): Table<PersistedAthlete, string> {
    return this.#db.table<PersistedAthlete, string>(TABLE.athletes);
  }

  get #activities(): Table<PersistedActivity, string> {
    return this.#db.table<PersistedActivity, string>(TABLE.activities);
  }

  get #laps(): Table<PersistedLap, string> {
    return this.#db.table<PersistedLap, string>(TABLE.laps);
  }

  get #privacyZones(): Table<PersistedPrivacyZone, string> {
    return this.#db.table<PersistedPrivacyZone, string>(TABLE.privacyZones);
  }

  get #streamSets(): Table<PersistedStreamSet, string> {
    return this.#db.table<PersistedStreamSet, string>(TABLE.streamSets);
  }

  get #streamBlobs(): Table<PersistedStreamBlob, [string, string]> {
    return this.#db.table<PersistedStreamBlob, [string, string]>(TABLE.streamBlobs);
  }

  get #recordingSessions(): Table<PersistedRecordingSession, string> {
    return this.#db.table<PersistedRecordingSession, string>(TABLE.recordingSessions);
  }

  get #recordingChunks(): Table<PersistedRecordingChunk, [string, number]> {
    return this.#db.table<PersistedRecordingChunk, [string, number]>(TABLE.recordingChunks);
  }

  get #deviceKeys(): Table<PersistedDeviceKey, string> {
    return this.#db.table<PersistedDeviceKey, string>(TABLE.deviceKeys);
  }

  get #activityRecords(): Table<PersistedActivityRecord, string> {
    return this.#db.table<PersistedActivityRecord, string>(TABLE.activityRecords);
  }

  get #segments(): Table<PersistedSegment, string> {
    return this.#db.table<PersistedSegment, string>(TABLE.segments);
  }

  get #segmentEfforts(): Table<SegmentEffortRecord, string> {
    return this.#db.table<SegmentEffortRecord, string>(TABLE.segmentEfforts);
  }

  get #matchCheckpoints(): Table<MatchCheckpointRecord, string> {
    return this.#db.table<MatchCheckpointRecord, string>(TABLE.matchCheckpoints);
  }

  get #routes(): Table<PersistedRoute, string> {
    return this.#db.table<PersistedRoute, string>(TABLE.routes);
  }

  get #workouts(): Table<PersistedWorkout, string> {
    return this.#db.table<PersistedWorkout, string>(TABLE.workouts);
  }

  // --- Athletes -------------------------------------------------------------

  async putAthlete(record: AthleteRecord): Promise<AthleteId> {
    await this.#athletes.put(toPersistedAthlete(record));
    return record.id;
  }

  async getAthlete(id: AthleteId): Promise<AthleteRecord | undefined> {
    const row = await this.#athletes.get(id);
    return row === undefined ? undefined : fromPersistedAthlete(row);
  }

  /**
   * The athlete with this id, creating them **only if there is none**.
   *
   * Returns whatever is on disk afterwards, which is the *existing* row when
   * one was already there — never `record`. That is the whole difference from
   * {@link putAthlete} and the reason this method exists rather than a caller
   * writing the two-line version (#184).
   *
   * ⚠️ **`putAthlete` is a `put`.** A client calling it at start-up to make
   * sure its athlete exists would overwrite `displayName`, `createdAt` and —
   * since #78 — `thresholdPower` and `thresholdHeartRate` on **every page
   * load**, silently discarding a threshold the rider had set. That is not a
   * hypothetical: `apps/web` names one fixed local athlete and has to
   * establish the row before its first write, so this is exactly the call it
   * needs to make, and `putAthlete` is exactly the wrong one.
   *
   * ⚠️ **The read and the write are in one transaction**, for the reason
   * {@link putActivity} states for its own: a read-then-write outside one lets
   * a concurrent write land in between. Two tabs of this client open at the
   * same moment would both see the row absent, and the loser of a
   * `getAthlete`-then-`putAthlete` race would erase the winner's row. Inside a
   * Dexie `rw` transaction the second one sees the first's insert.
   *
   * Idempotent, so a caller retrying after a crash — or simply reloading the
   * page — is not told the retry failed.
   */
  async ensureAthlete(record: AthleteRecord): Promise<AthleteRecord> {
    return this.#db.transaction('rw', [this.#athletes], async () => {
      const existing = await this.#athletes.get(record.id);
      if (existing !== undefined) {
        return fromPersistedAthlete(existing);
      }
      await this.#athletes.put(toPersistedAthlete(record));
      return record;
    });
  }

  /**
   * Replaces the athlete's thresholds, leaving every other field alone.
   *
   * The write half of #78's setting. `putAthlete` cannot do this job for the
   * reason {@link ensureAthlete} exists (#184): it is a `put`, so a caller
   * saving a threshold would have to reconstruct `displayName` and `createdAt`
   * correctly or silently destroy them.
   *
   * ⚠️ **It replaces both, and `undefined` means "not set" rather than "leave
   * alone".** That is the only unambiguous reading of a partial pair, and the
   * ambiguity is worth closing here rather than in each caller: with
   * "leave alone" semantics there would be no way to clear a threshold at all,
   * and a rider who set one by mistake could never get back to the default. A
   * caller changing one of the two passes the other back unchanged, which it
   * has already read in order to render the form.
   *
   * Read and write in one transaction, for {@link ensureAthlete}'s reason.
   *
   * @returns the stored record, or `undefined` if there is no such athlete —
   * which is not an error: a device whose athlete row has not been created yet
   * has no thresholds to set, and {@link ensureAthlete} is what creates it.
   */
  async setAthleteThresholds(
    id: AthleteId,
    thresholds: {
      readonly thresholdPower?: Watts | undefined;
      readonly thresholdHeartRate?: BeatsPerMinute | undefined;
    },
  ): Promise<AthleteRecord | undefined> {
    return this.#db.transaction('rw', [this.#athletes], async () => {
      const row = await this.#athletes.get(id);
      if (row === undefined) {
        return undefined;
      }
      const existing = fromPersistedAthlete(row);
      // ⚠️ **Built from `existing`, not from a hand-written list of the fields
      // this method happens to know about.** Until #238 this rebuilt the record
      // from `id`, `displayName` and `createdAt` alone, so saving a threshold
      // silently erased every *other* optional field on the row — `mass` then,
      // and `units` now. That is the "a write that reports success while the
      // read cannot see it" shape CLAUDE.md §5 names, in its quietest form: the
      // write this method is *about* lands, the read for it succeeds, and a
      // neighbouring field is gone. Spreading the decoded record and then
      // overriding is what makes a field added to `AthleteRecord` survive a
      // threshold save without anyone remembering to edit this line.
      const updated: AthleteRecord = {
        ...withoutThresholds(existing),
        ...(thresholds.thresholdPower === undefined
          ? {}
          : { thresholdPower: thresholds.thresholdPower }),
        ...(thresholds.thresholdHeartRate === undefined
          ? {}
          : { thresholdHeartRate: thresholds.thresholdHeartRate }),
      };
      await this.#athletes.put(toPersistedAthlete(updated));
      return updated;
    });
  }

  /**
   * Replaces the athlete's unit preference, leaving every other field alone.
   *
   * The write half of #238's setting, and narrow for
   * {@link setAthleteThresholds}' reason: a caller saving a display preference
   * must not have to reconstruct `displayName`, `createdAt` or a threshold
   * correctly, and `putAthlete` would make that its problem.
   *
   * ⚠️ **Nothing else on this row, and nothing in any other table, changes.**
   * That is #238's fourth acceptance criterion stated as a property of this
   * method rather than as an intention, and
   * `activity-store.units.test.ts` reads a ride back either side of a call to
   * prove it.
   *
   * Unlike {@link setAthleteThresholds} there is no "clear it" case: the
   * setting is one of two values and a rider returning to the default is
   * choosing `metric`, not unsetting anything. So this takes a
   * {@link UnitSystem} rather than an optional one, and an athlete row whose
   * field is absent is one nobody has chosen for yet.
   *
   * Read and write in one transaction, for {@link ensureAthlete}'s reason.
   *
   * @returns the stored record, or `undefined` if there is no such athlete —
   * which is not an error, for {@link setAthleteThresholds}' reason.
   */
  async setAthleteUnits(id: AthleteId, units: UnitSystem): Promise<AthleteRecord | undefined> {
    return this.#db.transaction('rw', [this.#athletes], async () => {
      const row = await this.#athletes.get(id);
      if (row === undefined) {
        return undefined;
      }
      const updated: AthleteRecord = { ...fromPersistedAthlete(row), units };
      await this.#athletes.put(toPersistedAthlete(updated));
      return updated;
    });
  }

  /**
   * Writes a ride's load summary, leaving every other field alone (#77).
   *
   * Narrow for `setAthleteThresholds`' reason: a caller saving a derived
   * summary must not have to reconstruct the ride's name, its visibility or its
   * original-file reference correctly, and `putActivity` would make that its
   * problem. Read and write in one transaction, so a concurrent edit to the
   * ride is not lost between them.
   *
   * ⚠️ **Athlete-scoped, like every other write.** A ride id alone must never
   * be enough to modify a row — CLAUDE.md §6 names an unscoped match as the
   * cross-athlete defect that passes every single-athlete test in the suite.
   *
   * @returns `false` when this athlete has no such ride, rather than throwing:
   * a ride deleted while a backfill was running is an ordinary race, not an
   * error the rider needs to see.
   */
  async setActivityLoadSummary(
    owner: AthleteId,
    activity: ActivityId,
    summary: {
      readonly effortWeightedPower?: Watts | undefined;
      readonly effortWeightedHeartRate?: BeatsPerMinute | undefined;
      readonly loadCoveredTime: Seconds;
    },
  ): Promise<boolean> {
    return this.#db.transaction('rw', [this.#activities], async () => {
      const row = await this.#activities.get(activity);
      if (row === undefined || row.athleteId !== owner) {
        return false;
      }
      const existing = fromPersistedActivity(row);
      await this.#activities.put(
        toPersistedActivity({
          ...existing,
          ...(summary.effortWeightedPower === undefined
            ? {}
            : { effortWeightedPower: summary.effortWeightedPower }),
          ...(summary.effortWeightedHeartRate === undefined
            ? {}
            : { effortWeightedHeartRate: summary.effortWeightedHeartRate }),
          loadCoveredTime: summary.loadCoveredTime,
        }),
      );
      return true;
    });
  }

  /**
   * Deletes an athlete and everything that belongs to them. See the cascade
   * note at the top of this file.
   *
   * Deleting an athlete who does not exist removes nothing and returns zeroes
   * rather than throwing: erasure is idempotent, and a caller retrying after a
   * crash must not be told the retry failed.
   */
  async deleteAthlete(id: AthleteId): Promise<AthleteDeletionCounts> {
    return this.#db.transaction(
      'rw',
      [
        this.#athletes,
        this.#activities,
        this.#laps,
        this.#privacyZones,
        this.#streamSets,
        this.#streamBlobs,
        this.#recordingSessions,
        this.#recordingChunks,
        this.#deviceKeys,
        this.#activityRecords,
        this.#segments,
        this.#segmentEfforts,
        this.#matchCheckpoints,
        this.#routes,
        this.#workouts,
      ],
      async () => {
        // The signed records and the device key go with the athlete. The key is
        // the point: erasure that left it behind would leave the private half
        // of the athlete's identity on the device after they asked for
        // everything about them to be removed — and it is the one value here
        // that can still *act* on their behalf.
        await this.#activityRecords.where(INDEX.activityRecordByAthlete).equals(id).delete();
        await this.#deviceKeys.delete(id);
        await this.#streamBlobs.where(INDEX.streamBlobByAthlete).equals(id).delete();
        const streamSets = await this.#streamSets
          .where(INDEX.streamSetByAthlete)
          .equals(id)
          .delete();
        // A half-recorded ride is a GPS trace like any other. Erasure that left
        // it behind would leave the athlete's route on the device under a row
        // no scoped read can reach — the orphan-as-privacy-liability case the
        // note at the top of this file argues cascade for.
        await this.#recordingChunks.where(INDEX.recordingChunkByAthlete).equals(id).delete();
        const recordings = await this.#recordingSessions
          .where(INDEX.recordingSessionByAthlete)
          .equals(id)
          .delete();
        const laps = await this.#laps.where(INDEX.lapByAthlete).equals(id).delete();
        const activities = await this.#activities
          .where(INDEX.activityByAthlete)
          .equals(id)
          .delete();
        const privacyZones = await this.#privacyZones
          .where(INDEX.privacyZoneByAthlete)
          .equals(id)
          .delete();
        const segments = await this.#segments.where(INDEX.segmentByCreator).equals(id).delete();
        // Efforts go with the athlete for the reason everything else does: an
        // effort names a segment, an activity and an instant, and left behind
        // it is a row about a person who asked to be erased that no scoped read
        // can reach. The checkpoint is a cursor into a library that no longer
        // exists.
        const efforts = await this.#segmentEfforts.where(INDEX.effortByAthlete).equals(id).delete();
        await this.#matchCheckpoints.delete(id);
        const routes = await this.#routes.where(INDEX.routeByOwner).equals(id).delete();
        // A workout carries no coordinates and no measurements, so the privacy
        // argument the rest of this cascade rests on does not apply to it. It
        // goes anyway: an erasure that left rows behind under an athlete id
        // that no longer exists is an erasure that did not happen, and the next
        // athlete to be created with a recycled id would inherit them.
        const workouts = await this.#workouts.where(INDEX.workoutByOwner).equals(id).delete();
        await this.#athletes.delete(id);
        return {
          activities,
          laps,
          privacyZones,
          streamSets,
          recordings,
          segments,
          efforts,
          routes,
          workouts,
        };
      },
    );
  }

  // --- Activities -----------------------------------------------------------

  /**
   * Inserts or replaces an activity.
   *
   * **Refuses an activity whose athlete does not exist.** In a relational store
   * the database refuses this; here there is no constraint to lean on, so the
   * check is the code below, inside the same transaction as the write. Written
   * any other way — read the athlete, then write outside the transaction — a
   * concurrent `deleteAthlete` between the two steps produces exactly the
   * orphan the check exists to prevent.
   *
   * `visibility` defaults to `private` (ADR 0004 decision A) and is written to
   * disk explicitly. It is never left absent: "the default is private" must
   * remain true of the stored record, not only of the code path that created
   * it.
   *
   * @throws {StoreReferentialError} if `record.athleteId` names no athlete.
   */
  async putActivity(record: NewActivity): Promise<ActivityId> {
    const row = toPersistedActivity({
      ...record,
      visibility: record.visibility ?? DEFAULT_VISIBILITY,
    });
    await this.#db.transaction('rw', [this.#athletes, this.#activities], async () => {
      await this.#requireAthlete(record.athleteId);
      // Inside the transaction, like the athlete check and for the same reason:
      // read-then-write outside one lets a concurrent write land in between.
      this.#requireNotOwnedByAnother(
        await this.#activities.get(record.id),
        record.athleteId,
        `activity ${record.id}`,
      );
      await this.#activities.put(row);
    });
    return record.id;
  }

  /** The athlete-scoped point lookup. There is deliberately no unscoped one. */
  async getActivity(owner: AthleteId, id: ActivityId): Promise<ActivityRecord | undefined> {
    const row = await this.#activities
      .where(INDEX.activityByAthleteAndId)
      .equals([owner, id])
      .first();
    return row === undefined ? undefined : fromPersistedActivity(row);
  }

  /**
   * The list read #62 renders from: **summaries only**, never stream data.
   *
   * Goes through `[athleteId+startedAt]` or `[athleteId+distance]` — an index
   * range scoped to the athlete, not `toArray()` followed by a filter.
   * `activity-store.index-path.test.ts` asserts that mechanically, by spying on
   * `IDBIndex` and `IDBObjectStore`, because IndexedDB has no `EXPLAIN` and a
   * declared index that nothing routes through is decoration.
   *
   * Ties are broken deterministically: IndexedDB orders index entries with
   * equal keys by primary key, so two activities with the same start time come
   * back in a stable order (#62 asks for exactly that).
   */
  async listActivitySummaries(
    owner: AthleteId,
    options: ListActivitiesOptions = {},
  ): Promise<ActivitySummary[]> {
    const {
      orderBy = 'startedAt',
      direction = 'descending',
      offset = 0,
      limit,
      startedAfter,
    } = options;
    const index = ORDER_INDEX.get(orderBy);
    if (index === undefined) {
      throw new StoreValidationError(
        `orderBy must be one of ${[...ORDER_INDEX.keys()].join(', ')}, received ${String(orderBy)}`,
      );
    }
    if (offset < 0 || !Number.isInteger(offset)) {
      throw new StoreValidationError(`offset must be a non-negative integer, received ${offset}`);
    }
    if (limit !== undefined && (limit < 0 || !Number.isInteger(limit))) {
      throw new StoreValidationError(`limit must be a non-negative integer, received ${limit}`);
    }

    if (startedAfter !== undefined && orderBy !== 'startedAt') {
      throw new StoreValidationError(
        `startedAfter is a bound on the startedAt index and cannot be combined with orderBy ${orderBy}`,
      );
    }

    // `false` on the lower bound is what makes the cursor *strictly* after: a
    // resumed sweep must not re-read the activity it stopped on as though it
    // were the next one, or a library whose last page is one ride never ends.
    const lower = startedAfter === undefined ? Dexie.minKey : startedAfter;
    let collection = this.#activities
      .where(index)
      .between([owner, lower], [owner, Dexie.maxKey], startedAfter === undefined, true);
    if (direction === 'descending') {
      collection = collection.reverse();
    }
    if (offset > 0) {
      collection = collection.offset(offset);
    }
    if (limit !== undefined) {
      collection = collection.limit(limit);
    }
    const rows = await collection.toArray();
    return rows.map((row) => summaryOf(fromPersistedActivity(row)));
  }

  /**
   * Finds this athlete's activity carrying a given original-file hash — the
   * lookup #37 deduplicates on.
   *
   * Athlete-scoped like everything else: two athletes on one device who
   * imported the same group ride each own their own copy, and neither read
   * returns the other's.
   */
  async findActivityByOriginalFileHash(
    owner: AthleteId,
    sha256: string,
  ): Promise<ActivityRecord | undefined> {
    const row = await this.#activities
      .where(INDEX.activityByAthleteAndFileHash)
      .equals([owner, sha256])
      .first();
    return row === undefined ? undefined : fromPersistedActivity(row);
  }

  /**
   * This athlete's completed rides on one saved route, newest first — #93's
   * ghost candidates.
   *
   * ⚠️ **The `owner` parameter is the whole point of this method, not
   * boilerplate.** The query it replaces — "rides on route R" — is one index
   * component shorter, returns every athlete's rides, and passes every test in
   * a suite with one athlete in it. #93's fifth acceptance criterion names that
   * failure specifically, and `activity-store.ghost-scope.test.ts` is the test
   * that would catch it: it seeds a second athlete's ride on the *same* route
   * and asserts it is absent. Deleting `owner` from the `.equals([...])` below
   * turns that test red and nothing else.
   *
   * Ordered by `startedAt` descending by walking the index in reverse rather
   * than sorting in memory, because "the previous attempt" is almost always the
   * first row and a rider with a hundred laps of a loop should not pay for the
   * other ninety-nine. `limit` bounds it regardless.
   *
   * A route id that no longer resolves — the route was deleted — is not an
   * error here: it simply matches no rows. `records.ts` §`routeId` records why
   * nothing cascades.
   */
  async listRouteAttempts(
    owner: AthleteId,
    route: RouteId,
    limit: number = ROUTE_ATTEMPT_LIMIT,
  ): Promise<readonly ActivityRecord[]> {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new StoreValidationError(`limit must be a positive integer, received ${limit}`);
    }
    const rows = await this.#activities
      .where(INDEX.activityByAthleteAndRoute)
      .equals([owner, route])
      .reverse()
      .limit(limit)
      .toArray();
    return rows.map(fromPersistedActivity);
  }

  /**
   * Deletes one of this athlete's activities and its laps.
   *
   * Scoped: passing another athlete's activity id deletes nothing and returns
   * `false`, rather than deleting it.
   */
  async deleteActivity(owner: AthleteId, id: ActivityId): Promise<boolean> {
    return this.#db.transaction(
      'rw',
      [
        this.#activities,
        this.#laps,
        this.#streamSets,
        this.#streamBlobs,
        this.#activityRecords,
        this.#segmentEfforts,
      ],
      async () => {
        const existing = await this.#activities
          .where(INDEX.activityByAthleteAndId)
          .equals([owner, id])
          .first();
        if (existing === undefined) {
          return false;
        }
        await this.#laps.where(INDEX.lapByActivity).equals(id).delete();
        // The signed record goes with the ride it vouches for. Left behind it
        // would be a row no scoped read can reach — every read of it is scoped
        // to an activity that no longer exists — and it carries the ride's
        // distance, duration and start time, which is a summary of a deleted
        // activity sitting on the device after the athlete deleted it.
        await this.#activityRecords.delete(id);
        // The streams go with the activity, for the reason the laps do: every
        // read of them is scoped to an activity that no longer exists, so
        // leaving them behind holds a GPS trace on the device that nothing can
        // reach and nothing can remove. On a per-second stream set that is also
        // the largest thing this store ever orphans.
        await this.#streamBlobs.where(INDEX.streamBlobByActivity).equals(id).delete();
        await this.#streamSets.delete(id);
        // The efforts go with the ride they were found in. An effort is two
        // indices' worth of information *about* an activity, so one whose
        // activity is gone can no longer be explained, re-derived or shown a
        // trace for — and it would still be ranking on a board.
        //
        // ⚠️ This is deliberately unlike #64's segments, which survive their
        // source activity by design (`records.ts` says why). A segment is a
        // copy that stands alone; an effort is a claim about a specific ride.
        await this.#segmentEfforts.where(INDEX.effortByActivity).equals(id).delete();
        await this.#activities.delete(id);
        return true;
      },
    );
  }

  // --- Laps -----------------------------------------------------------------

  /**
   * Inserts or replaces a lap.
   *
   * The lap's `athleteId` is **copied from the owning activity**, not taken
   * from the caller — `NewLap` has no such field. A caller who could supply it
   * could file a lap under one athlete and point it at another's activity, and
   * every athlete-scoped lap read would then be wrong in the direction that
   * discloses.
   *
   * @throws {StoreReferentialError} if `record.activityId` names no activity.
   */
  async putLap(record: NewLap): Promise<LapId> {
    return this.#db.transaction('rw', [this.#activities, this.#laps], async () => {
      const parent = await this.#activities.get(record.activityId);
      if (parent === undefined) {
        throw new StoreReferentialError(
          `cannot store lap ${record.id}: no activity ${record.activityId} exists`,
        );
      }
      this.#requireNotOwnedByAnother(
        await this.#laps.get(record.id),
        parent.athleteId as AthleteId,
        `lap ${record.id}`,
      );
      const lap: LapRecord = { ...record, athleteId: parent.athleteId as AthleteId };
      await this.#laps.put(toPersistedLap(lap));
      return record.id;
    });
  }

  /** This athlete's laps for this activity, in `ordinal` order. */
  async listLaps(owner: AthleteId, activity: ActivityId): Promise<LapRecord[]> {
    const rows = await this.#laps
      .where(INDEX.lapByAthleteAndActivityAndOrdinal)
      .between([owner, activity, Dexie.minKey], [owner, activity, Dexie.maxKey], true, true)
      .toArray();
    return rows.map(fromPersistedLap);
  }

  // --- Privacy zones --------------------------------------------------------

  /**
   * Stores a local-only privacy zone (ADR 0004 decision B).
   *
   * @throws {StoreReferentialError} if `record.athleteId` names no athlete.
   */
  async putPrivacyZone(record: PrivacyZoneRecord): Promise<PrivacyZoneId> {
    await this.#db.transaction('rw', [this.#athletes, this.#privacyZones], async () => {
      await this.#requireAthlete(record.athleteId);
      this.#requireNotOwnedByAnother(
        await this.#privacyZones.get(record.id),
        record.athleteId,
        `privacy zone ${record.id}`,
      );
      await this.#privacyZones.put(toPersistedPrivacyZone(record));
    });
    return record.id;
  }

  /** This athlete's zones. Never another athlete's, and never exported. */
  async listPrivacyZones(owner: AthleteId): Promise<PrivacyZoneRecord[]> {
    const rows = await this.#privacyZones.where(INDEX.privacyZoneByAthlete).equals(owner).toArray();
    return rows.map(fromPersistedPrivacyZone);
  }

  // --- Segments (#64) -------------------------------------------------------

  /**
   * Inserts or replaces a segment.
   *
   * **Refuses a segment whose creating athlete does not exist**, and refuses to
   * overwrite one that belongs to somebody else — both inside the same
   * transaction as the write, for the reason `putActivity` states: a check
   * outside the transaction lets a concurrent `deleteAthlete` produce exactly
   * the orphan it exists to prevent.
   *
   * ⚠️ **The overwrite guard is not decoration.** A segment id that arrives
   * from outside — a shared segment in Phase 4 (#7), an imported one — reaching
   * a `put` with no guard would let one athlete replace another's segment, and
   * every athlete-scoped read afterwards would return the replacement while
   * still reporting the original owner.
   *
   * @throws {StoreReferentialError} if `record.createdBy` names no athlete, or
   * if a segment with this id already exists under a different athlete.
   */
  async putSegment(record: SegmentRecord): Promise<SegmentId> {
    await this.#db.transaction('rw', [this.#athletes, this.#segments], async () => {
      await this.#requireAthlete(record.createdBy);
      const existing = await this.#segments.get(record.id);
      if (existing !== undefined && existing.createdBy !== record.createdBy) {
        throw new StoreReferentialError(
          `cannot overwrite segment ${record.id}: it belongs to a different athlete`,
        );
      }
      await this.#segments.put(toPersistedSegment(record));
    });
    return record.id;
  }

  /**
   * One of this athlete's segments.
   *
   * Both arguments, always. There is no `getSegment(id)` and there is no index
   * that would answer one — see `schema.ts`, and CLAUDE.md section 6 for what a
   * lookup on an entity id alone costs.
   */
  async getSegment(owner: AthleteId, id: SegmentId): Promise<SegmentRecord | undefined> {
    const row = await this.#segments.where(INDEX.segmentByCreatorAndId).equals([owner, id]).first();
    return row === undefined ? undefined : fromPersistedSegment(row);
  }

  /**
   * This athlete's segments, **newest first**.
   *
   * Newest first because the caller that matters is #64's duplicate detection,
   * which compares a candidate against what the athlete already has, and a
   * rider's recent segments are the ones a new one is most likely to duplicate.
   *
   * ⚠️ **Bounded by `limit`, and the bound is the caller's** — an athlete with
   * a decade of segments would otherwise decode every one of them, geometry
   * included, to check one candidate. `apps/web` states its own budget in one
   * named constant rather than leaving it implicit here.
   */
  async listSegments(owner: AthleteId, limit?: number): Promise<SegmentRecord[]> {
    let query = this.#segments
      .where(INDEX.segmentByCreatorAndCreatedAt)
      .between([owner, Dexie.minKey], [owner, Dexie.maxKey], true, true)
      .reverse();
    if (limit !== undefined) {
      query = query.limit(limit);
    }
    const rows = await query.toArray();
    return rows.map(fromPersistedSegment);
  }

  /**
   * Deletes one of this athlete's segments.
   *
   * @returns whether a segment was removed. `false` for one that does not exist
   * **and** for one that belongs to somebody else, which are deliberately
   * indistinguishable: reporting them differently would answer "does athlete B
   * have a segment with this id" to athlete A.
   */
  async deleteSegment(owner: AthleteId, id: SegmentId): Promise<boolean> {
    return this.#db.transaction('rw', [this.#segments], async () => {
      const existing = await this.#segments
        .where(INDEX.segmentByCreatorAndId)
        .equals([owner, id])
        .first();
      if (existing === undefined) {
        return false;
      }
      await this.#segments.delete(id);
      return true;
    });
  }

  // --- Routes (#89) ---------------------------------------------------------

  /**
   * Inserts or replaces a saved route.
   *
   * **Refuses a route whose athlete does not exist**, and refuses to overwrite
   * one belonging to somebody else — both inside the same transaction as the
   * write, for `putActivity`'s reason: checked outside it, a concurrent
   * `deleteAthlete` between the check and the write produces exactly the orphan
   * the check exists to prevent.
   *
   * @throws {StoreReferentialError} if `record.createdBy` names no athlete, or
   * if a route with this id already belongs to a different athlete.
   */
  async putRoute(record: RouteRecord): Promise<RouteId> {
    await this.#db.transaction('rw', [this.#athletes, this.#routes], async () => {
      await this.#requireAthlete(record.createdBy);
      const existing = await this.#routes.get(record.id);
      if (existing !== undefined && existing.createdBy !== record.createdBy) {
        throw new StoreReferentialError(
          `cannot overwrite route ${record.id}: it belongs to a different athlete`,
        );
      }
      await this.#routes.put(toPersistedRoute(record));
    });
    return record.id;
  }

  /**
   * One of this athlete's routes.
   *
   * Both arguments, always. There is no `getRoute(id)` and there is no index
   * that would answer one — see `schema.ts`, and CLAUDE.md section 6 for what a
   * lookup on an entity id alone costs.
   */
  async getRoute(owner: AthleteId, id: RouteId): Promise<RouteRecord | undefined> {
    const row = await this.#routes.where(INDEX.routeByOwnerAndId).equals([owner, id]).first();
    return row === undefined ? undefined : fromPersistedRoute(row);
  }

  /**
   * This athlete's routes, **newest first**.
   *
   * ⚠️ **Bounded by `limit`, and the bound is the caller's**, for
   * `listSegments`' reason and more sharply: a route row carries its whole
   * profile — four numbers per ten metres — so a rider with fifty saved routes
   * decodes several megabytes to render a list of names. A caller that only
   * wants the names states its own budget in one named constant rather than
   * leaving it implicit here.
   */
  async listRoutes(owner: AthleteId, limit?: number): Promise<RouteRecord[]> {
    let query = this.#routes
      .where(INDEX.routeByOwnerAndCreatedAt)
      .between([owner, Dexie.minKey], [owner, Dexie.maxKey], true, true)
      .reverse();
    if (limit !== undefined) {
      query = query.limit(limit);
    }
    const rows = await query.toArray();
    return rows.map(fromPersistedRoute);
  }

  /**
   * Deletes one of this athlete's routes.
   *
   * @returns whether a route was removed. `false` for one that does not exist
   * **and** for one that belongs to somebody else, which are deliberately
   * indistinguishable: reporting them differently would answer "does athlete B
   * have a route with this id" to athlete A.
   */
  async deleteRoute(owner: AthleteId, id: RouteId): Promise<boolean> {
    return this.#db.transaction('rw', [this.#routes], async () => {
      const existing = await this.#routes
        .where(INDEX.routeByOwnerAndId)
        .equals([owner, id])
        .first();
      if (existing === undefined) {
        return false;
      }
      await this.#routes.delete(id);
      return true;
    });
  }

  // --- Workouts (#14) -------------------------------------------------------

  /**
   * Inserts or replaces a saved workout.
   *
   * **Refuses a workout whose athlete does not exist**, and refuses to
   * overwrite one belonging to somebody else — both inside the same transaction
   * as the write, for `putRoute`'s reason.
   *
   * @throws {StoreReferentialError} if `record.createdBy` names no athlete, or
   * if a workout with this id already belongs to a different athlete.
   */
  async putWorkout(record: WorkoutRecord): Promise<WorkoutId> {
    await this.#db.transaction('rw', [this.#athletes, this.#workouts], async () => {
      await this.#requireAthlete(record.createdBy);
      const existing = await this.#workouts.get(record.id);
      if (existing !== undefined && existing.createdBy !== record.createdBy) {
        throw new StoreReferentialError(
          `cannot overwrite workout ${record.id}: it belongs to a different athlete`,
        );
      }
      await this.#workouts.put(toPersistedWorkout(record));
    });
    return record.id;
  }

  /**
   * One of this athlete's workouts.
   *
   * Both arguments, always, for `getRoute`'s reason and CLAUDE.md section 6's.
   */
  async getWorkout(owner: AthleteId, id: WorkoutId): Promise<WorkoutRecord | undefined> {
    const row = await this.#workouts.where(INDEX.workoutByOwnerAndId).equals([owner, id]).first();
    return row === undefined ? undefined : fromPersistedWorkout(row);
  }

  /**
   * This athlete's workouts, **newest first**.
   *
   * ⚠️ Bounded by `limit`, the caller's, as every list in this class is — but
   * the pressure is far lower than `listRoutes`': a workout row is a handful of
   * blocks, not a profile grid. The bound is here for consistency and because
   * "the list is small today" is the assumption every unbounded read started
   * from.
   */
  async listWorkouts(owner: AthleteId, limit?: number): Promise<WorkoutRecord[]> {
    let query = this.#workouts
      .where(INDEX.workoutByOwnerAndCreatedAt)
      .between([owner, Dexie.minKey], [owner, Dexie.maxKey], true, true)
      .reverse();
    if (limit !== undefined) {
      query = query.limit(limit);
    }
    const rows = await query.toArray();
    return rows.map(fromPersistedWorkout);
  }

  /**
   * Deletes one of this athlete's workouts.
   *
   * @returns whether one was removed. `false` for one that does not exist
   * **and** for one that belongs to somebody else, deliberately
   * indistinguishable — see `deleteRoute`.
   */
  async deleteWorkout(owner: AthleteId, id: WorkoutId): Promise<boolean> {
    return this.#db.transaction('rw', [this.#workouts], async () => {
      const existing = await this.#workouts
        .where(INDEX.workoutByOwnerAndId)
        .equals([owner, id])
        .first();
      if (existing === undefined) {
        return false;
      }
      await this.#workouts.delete(id);
      return true;
    });
  }

  // --- Segment efforts (#66) ------------------------------------------------

  /**
   * Replaces every effort this activity has on record with the ones given.
   *
   * ## Why "replace what this activity has", and not "insert these"
   *
   * #66's sixth criterion is that re-running the matcher over an already-
   * matched activity is idempotent — *"without this, every app restart inflates
   * every leaderboard"*. Two mechanisms together give that, and both are
   * needed:
   *
   * 1. **The ids are derived** (`@onyourleft/domain`'s `effortId`), so the same
   *    traversal computes the same key and `bulkPut` rewrites its row.
   * 2. **Efforts this activity no longer produces are deleted**, so a re-match
   *    after the tolerances changed — or after a segment was deleted — leaves
   *    no effort behind that the matcher would no longer find. Without this
   *    half, (1) alone makes re-matching *additive*: the count never goes down,
   *    and a stale effort on a deleted segment keeps ranking.
   *
   * Both inside one transaction, so a failure leaves the activity's efforts as
   * they were rather than half-replaced.
   *
   * ⚠️ **Scoped to one activity, never to one segment.** Replacing "this
   * segment's efforts" would delete every other activity's efforts on it the
   * moment one ride was re-matched, which is the shape a backfill would take if
   * it were written the obvious way round.
   *
   * @throws {StoreReferentialError} if `owner` names no athlete, or if any
   * effort names a different athlete than the one sweeping — an effort filed
   * under the wrong athlete is the cross-athlete exposure CLAUDE.md section 6
   * names, arriving through a write rather than a read.
   */
  async putActivityEfforts(
    owner: AthleteId,
    activityId: ActivityId,
    efforts: readonly SegmentEffortRecord[],
  ): Promise<number> {
    return this.#db.transaction(
      'rw',
      [this.#athletes, this.#activities, this.#segmentEfforts],
      async () => {
        await this.#requireAthlete(owner);
        for (const effort of efforts) {
          if (effort.athleteId !== owner) {
            throw new StoreReferentialError(
              `cannot file effort ${effort.id} under athlete ${owner}: it names a different athlete`,
            );
          }
          if (effort.activityId !== activityId) {
            throw new StoreReferentialError(
              `cannot file effort ${effort.id} under activity ${activityId}: it names a different activity`,
            );
          }
        }
        const keep = new Set(efforts.map((effort) => effort.id));
        const existing = await this.#segmentEfforts
          .where(INDEX.effortByAthleteAndActivity)
          .equals([owner, activityId])
          .toArray();
        const stale = existing.filter((row) => !keep.has(row.id)).map((row) => row.id);
        if (stale.length > 0) {
          await this.#segmentEfforts.bulkDelete(stale);
        }
        if (efforts.length > 0) {
          await this.#segmentEfforts.bulkPut([...efforts]);
        }
        return efforts.length;
      },
    );
  }

  /**
   * This athlete's efforts on one segment, **fastest first**.
   *
   * Fastest first because the caller that matters is a personal best, and
   * `[athleteId+segmentId+elapsed]` orders by its last component — so the best
   * time is the first row of an index lookup rather than a sort of every
   * traversal the athlete has ever made.
   *
   * ⚠️ **Returns `private-match` efforts.** That is the athlete's own history
   * and #66's seventh criterion requires it; {@link listSharedEfforts} is the
   * read that does not. An `excluded` effort is returned by neither.
   */
  async listEfforts(
    owner: AthleteId,
    segment: SegmentId,
    limit?: number,
  ): Promise<SegmentEffortRecord[]> {
    let query = this.#segmentEfforts
      .where(INDEX.effortByAthleteAndSegment)
      .between([owner, segment, Dexie.minKey], [owner, segment, Dexie.maxKey], true, true);
    if (limit !== undefined) {
      query = query.limit(limit);
    }
    const rows = await query.toArray();
    return rows.filter((row) => row.visibility !== 'excluded');
  }

  /**
   * The efforts on one segment that may be shown to **somebody else**.
   *
   * `public` only. A `private-match` effort has an endpoint inside one of the
   * athlete's privacy zones, and publishing it publishes an address — which is
   * the failure ADR 0004 exists to prevent and the reason the visibility field
   * has three values rather than two.
   *
   * ⚠️ **Still athlete-scoped, even though it is the "shared" read.** Phase 1
   * has no server (owner decision D6), so the only caller is the athlete
   * looking at what *would* be shared. When #68 serves a real cross-athlete
   * board it will fan this out per athlete rather than dropping the scope, and
   * a query here that matched on `segmentId` alone is exactly the shape
   * CLAUDE.md section 6 names.
   */
  async listSharedEfforts(
    owner: AthleteId,
    segment: SegmentId,
    limit?: number,
  ): Promise<SegmentEffortRecord[]> {
    const rows = await this.#segmentEfforts
      .where(INDEX.effortByAthleteAndSegmentAndVisibility)
      .equals([owner, segment, 'public'])
      .toArray();
    rows.sort((a, b) => a.elapsed - b.elapsed);
    return limit === undefined ? rows : rows.slice(0, limit);
  }

  /** Every effort this athlete has in one activity. What a re-match compares against. */
  async listActivityEfforts(
    owner: AthleteId,
    activityId: ActivityId,
  ): Promise<SegmentEffortRecord[]> {
    return this.#segmentEfforts
      .where(INDEX.effortByAthleteAndActivity)
      .equals([owner, activityId])
      .toArray();
  }

  /** How far this athlete's backfill sweep has got, if one is in progress. */
  async getMatchCheckpoint(owner: AthleteId): Promise<MatchCheckpointRecord | undefined> {
    return this.#matchCheckpoints.get(owner);
  }

  /**
   * Records how far a backfill sweep has got.
   *
   * ⚠️ **Not the correctness mechanism** — the derived effort id is. This only
   * stops a resumed sweep redoing work it has already done. A lost checkpoint
   * costs time and cannot corrupt anything, and `records.ts` asks whoever
   * changes this to keep that property.
   */
  async putMatchCheckpoint(record: MatchCheckpointRecord): Promise<void> {
    await this.#db.transaction('rw', [this.#athletes, this.#matchCheckpoints], async () => {
      await this.#requireAthlete(record.athleteId);
      await this.#matchCheckpoints.put(record);
    });
  }

  /** Clears the sweep cursor, which is what finishing one looks like. */
  async clearMatchCheckpoint(owner: AthleteId): Promise<void> {
    await this.#matchCheckpoints.delete(owner);
  }

  // --- Streams (#27) --------------------------------------------------------

  /**
   * Stores an activity's whole stream set, replacing any set already there.
   *
   * ## The write is one transaction across both stores
   *
   * #27 asks for a test proving that "a failed stream write does not leave a
   * partial object referenced by a committed database row". On a SQL server
   * plus an object store that is a genuinely hard two-phase problem. Here it
   * is a property of one Dexie read-write transaction spanning `activities`,
   * `streamSets` and `streamBlobs`: if any blob put throws, the transaction
   * aborts and neither the metadata row nor any blob lands.
   * `stream-store.test.ts` proves it by making `IDBObjectStore.put` fail
   * part-way through the eight channels, then reopening on a fresh connection
   * and finding nothing.
   *
   * ## Encoding happens outside the transaction, deliberately
   *
   * Compression is asynchronous, and awaiting a promise Dexie did not create
   * inside a transaction lets the underlying IndexedDB transaction commit out
   * from under the code still using it. So every channel is encoded and
   * compressed first and the transaction does nothing but write bytes it
   * already holds. That also means a channel that cannot be encoded — a power
   * value outside `uint16`, a latitude the domain rejects — fails before any
   * write is attempted rather than half way through one.
   *
   * @throws {StoreReferentialError} if this athlete has no such activity.
   * @throws {StoreValidationError} if a channel's length disagrees with
   * `sampleCount`, or a sample is outside what its channel can encode.
   */
  async putStreamSet(set: NewStreamSet): Promise<ActivityId> {
    const { summary, blobs } = await this.#encodeStreamSet(set);

    await this.#db.transaction(
      'rw',
      [this.#activities, this.#streamSets, this.#streamBlobs],
      async () => {
        // Scoped, and inside the transaction: this is both the foreign key the
        // engine does not have and the write-path ownership check. There is no
        // way to attach streams to an activity by id alone, so streams cannot
        // be filed against another athlete's ride.
        const activity = await this.#activities
          .where(INDEX.activityByAthleteAndId)
          .equals([set.athleteId, set.activityId])
          .first();
        if (activity === undefined) {
          throw new StoreReferentialError(
            `cannot store streams for activity ${set.activityId}: this athlete has no such activity`,
          );
        }
        // The second guard, for the reason `putActivity` has one: `put` is
        // keyed on the primary key alone, and `activityId` is that key. A
        // stream set already on disk under another athlete must not be
        // overwritten and thereby taken over. Found on the activity write path
        // in review of PR #109; the same hole is reachable here the moment an
        // id arrives from an imported file (#51).
        this.#requireNotOwnedByAnother(
          await this.#streamSets.get(set.activityId),
          set.athleteId,
          `the stream set for activity ${set.activityId}`,
        );
        // Replace rather than merge: the new set's channel list may be shorter
        // than the old one's, and a stale blob left behind would be decoded as
        // part of the next read and disagree with the summary.
        await this.#streamBlobs.where(INDEX.streamBlobByActivity).equals(set.activityId).delete();
        await this.#streamSets.put(summary);
        await this.#streamBlobs.bulkPut(blobs);
      },
    );
    return set.activityId;
  }

  /**
   * Reads an activity's whole stream set back, gaps included.
   *
   * The public retrieval path #27's round-trip criterion names. Athlete-scoped
   * like every other read here, through `[athleteId+activityId]`.
   *
   * @throws {StoreDecodeError} if the stored bytes do not decode, or if a
   * channel the summary claims has no blob row. The second case is the
   * half-written set this store is built not to produce, and failing on it is
   * the point: a chart silently missing its heart-rate trace is indistinguish-
   * able from a ride recorded without a strap.
   */
  async getStreamSet(owner: AthleteId, activity: ActivityId): Promise<StreamSet | undefined> {
    const stored = await this.#readStreamRows(owner, activity);
    if (stored === undefined) {
      return undefined;
    }
    const summary = fromPersistedStreamSet(stored.set);
    const channels: MutableStreamChannels = {};
    for (const row of stored.blobs) {
      const channel = parseStreamChannel(row.channel);
      // The channel name is only known at run time, so the mapped type's
      // per-channel index signature cannot be satisfied statically here. The
      // cast is sound because `decodeChannel` dispatches on the same validated
      // name: the samples it returns are that channel's own quantity, and the
      // brands erase at run time. This and the one at the end of
      // `decodeChannel` are the only two casts in the stream path.
      (channels as Record<StreamChannel, Samples<StreamChannel>>)[channel] =
        await this.#decodeBlob(row);
    }
    for (const channel of summary.channels) {
      if (channels[channel] === undefined) {
        throw new StoreDecodeError(
          `stream set for activity ${activity}: the stored set claims a ${channel} channel and ` +
            `no bytes for it were found`,
        );
      }
    }
    return {
      activityId: summary.activityId,
      athleteId: summary.athleteId,
      startedAt: summary.startedAt,
      sampleInterval: summary.sampleInterval,
      sampleCount: summary.sampleCount,
      channels,
    };
  }

  /**
   * What is known about a stored set **without decoding a single sample**.
   *
   * This is the read #62's activity list and #35's export manifest can afford,
   * and it is the reason the metadata and the bytes are two object stores
   * rather than one row: answering "does this ride have a power trace, and how
   * many bytes does it cost" must not mean inflating a quarter of a megabyte.
   */
  async getStreamSetSummary(
    owner: AthleteId,
    activity: ActivityId,
  ): Promise<StreamSetSummary | undefined> {
    const row = await this.#streamSets
      .where(INDEX.streamSetByAthleteAndActivity)
      .equals([owner, activity])
      .first();
    return row === undefined ? undefined : fromPersistedStreamSet(row);
  }

  /**
   * Reads **one** channel.
   *
   * The read that justifies a blob per channel rather than one blob per set: a
   * chart of power alone inflates and decodes 29 KB instead of 239 KB. Routed
   * through `[athleteId+activityId+channel]`, so it is an exact index lookup
   * rather than the whole set followed by a filter.
   *
   * @throws {StoreDecodeError}
   */
  async getStreamChannel<C extends StreamChannel>(
    owner: AthleteId,
    activity: ActivityId,
    channel: C,
  ): Promise<Samples<C> | undefined> {
    const row = await this.#streamBlobs
      .where(INDEX.streamBlobByAthleteAndActivityAndChannel)
      .equals([owner, activity, channel])
      .first();
    if (row === undefined) {
      return undefined;
    }
    return (await this.#decodeBlob(row)) as Samples<C>;
  }

  /**
   * Deletes an activity's stream set and every one of its channel blobs.
   *
   * Scoped: another athlete's activity id deletes nothing and returns `false`.
   * Deleting a set that is not there is a no-op, for `deleteAthlete`'s reason —
   * a caller retrying after a crash must not be told the retry failed.
   */
  async deleteStreamSet(owner: AthleteId, activity: ActivityId): Promise<boolean> {
    return this.#db.transaction('rw', [this.#streamSets, this.#streamBlobs], async () => {
      const existing = await this.#streamSets
        .where(INDEX.streamSetByAthleteAndActivity)
        .equals([owner, activity])
        .first();
      if (existing === undefined) {
        return false;
      }
      await this.#streamBlobs.where(INDEX.streamBlobByActivity).equals(activity).delete();
      await this.#streamSets.delete(activity);
      return true;
    });
  }

  // --- Recording checkpoints (#46) ------------------------------------------

  /**
   * Inserts or replaces a recording's header row.
   *
   * Written once when the recording starts and rewritten on every checkpoint,
   * because `state`, `updatedAt` and `pauses` all move. The chunks are the
   * expensive part and they are appended, never rewritten — see `recording.ts`.
   *
   * @throws {StoreReferentialError} if `record.athleteId` names no athlete, or
   * if a recording with this id already belongs to a different athlete.
   * @throws {StoreValidationError} if the sample interval is not positive.
   */
  async putRecordingSession(record: NewRecordingSession): Promise<RecordingSessionId> {
    if (!Number.isFinite(record.sampleInterval) || record.sampleInterval <= 0) {
      throw new StoreValidationError(
        `recording sampleInterval must be greater than zero, received ` +
          `${String(record.sampleInterval)}`,
      );
    }
    const row = toPersistedRecordingSession(record);
    await this.#db.transaction('rw', [this.#athletes, this.#recordingSessions], async () => {
      await this.#requireAthlete(record.athleteId);
      this.#requireNotOwnedByAnother(
        await this.#recordingSessions.get(record.id),
        record.athleteId,
        `recording session ${record.id}`,
      );
      await this.#recordingSessions.put(row);
    });
    return record.id;
  }

  /** The athlete-scoped point lookup. There is deliberately no unscoped one. */
  async getRecordingSession(
    owner: AthleteId,
    id: RecordingSessionId,
  ): Promise<RecordingSessionRecord | undefined> {
    const row = await this.#recordingSessions
      .where(INDEX.recordingSessionByAthleteAndId)
      .equals([owner, id])
      .first();
    return row === undefined ? undefined : fromPersistedRecordingSession(row);
  }

  /**
   * Every recording this athlete has on the device, most recently checkpointed
   * first.
   *
   * This is what a client reads on start-up to answer "was a ride interrupted".
   * Headers only — never a chunk — for the reason `listActivitySummaries` never
   * reads a stream blob: deciding whether to *offer* a recovery must not cost
   * the price of performing one.
   */
  async listRecordingSessions(owner: AthleteId): Promise<RecordingSessionRecord[]> {
    const rows = await this.#recordingSessions
      .where(INDEX.recordingSessionByAthleteAndUpdatedAt)
      .between([owner, Dexie.minKey], [owner, Dexie.maxKey], true, true)
      .reverse()
      .toArray();
    return rows.map(fromPersistedRecordingSession);
  }

  /**
   * Appends one flush.
   *
   * The whole point of #46 lives in this method's cost: it must be cheap enough
   * to run every few seconds for four hours, because the gap between two of its
   * calls **is** the data-loss bound. So it encodes (packs, does not compress —
   * see `recording.ts`) outside the transaction and writes a single row inside
   * one, and it never reads or rewrites a chunk already on disk.
   *
   * `put` rather than `add`, so retrying a flush whose outcome is unknown
   * replaces the row instead of failing on a duplicate key. A recorder that
   * could not safely retry would have to choose between losing the window and
   * storing it twice.
   *
   * @throws {StoreReferentialError} if this athlete has no such recording.
   * @throws {StoreValidationError} if `seq`, `fromIndex` or `sampleCount` is
   * not a non-negative integer, or a channel's length disagrees with
   * `sampleCount`.
   */
  async appendRecordingChunk(chunk: NewRecordingChunk): Promise<number> {
    const row = this.#encodeRecordingChunk(chunk);
    await this.#db.transaction('rw', [this.#recordingSessions, this.#recordingChunks], async () => {
      // Scoped, and inside the transaction: this is both the foreign key the
      // engine does not have and the write-path ownership check. There is no
      // way to append to a recording by id alone, so a chunk cannot be filed
      // against another athlete's ride.
      const session = await this.#recordingSessions
        .where(INDEX.recordingSessionByAthleteAndId)
        .equals([chunk.athleteId, chunk.sessionId])
        .first();
      if (session === undefined) {
        throw new StoreReferentialError(
          `cannot append to recording ${chunk.sessionId}: this athlete has no such recording`,
        );
      }
      // The second guard, for the reason `putActivity` and `putStreamSet`
      // have one: `put` is keyed on `[sessionId+seq]` alone. The session
      // lookup above already makes this unreachable while ids are opaque, and
      // it stays because "unreachable through today's callers" is not the
      // same statement as "cannot happen".
      this.#requireNotOwnedByAnother(
        await this.#recordingChunks.get([chunk.sessionId, chunk.seq]),
        chunk.athleteId,
        `chunk ${String(chunk.seq)} of recording ${chunk.sessionId}`,
      );
      await this.#recordingChunks.put(row);
    });
    return chunk.seq;
  }

  /**
   * Reassembles a recording from its chunks — the read #46's recovery path uses.
   *
   * **Stops at the first hole.** A chunk whose `seq` or `fromIndex` does not
   * continue the prefix ends the recovery, and every row beyond it is counted
   * in `chunksAfterGap` rather than concatenated. That is the whole difference
   * between recovering a ride and recovering a plausible-looking fiction: rows
   * either side of a lost flush are both real, and joining them would shift
   * every later sample onto the wrong second with nothing to show for it.
   *
   * @throws {StoreDecodeError} if a stored chunk is not a shape this build can
   * read. A corrupt chunk fails loudly rather than being skipped, for the
   * reason `getStreamSet` refuses a set with a missing blob.
   */
  async recoverRecording(
    owner: AthleteId,
    id: RecordingSessionId,
  ): Promise<RecoveredRecording | undefined> {
    const stored = await this.#readRecordingRows(owner, id);
    if (stored === undefined) {
      return undefined;
    }
    const header = fromPersistedRecordingSession(stored.session);
    const prefix = contiguousChunkPrefix(stored.chunks);

    const channels: MutableStreamChannels = {};
    for (const row of prefix.rows) {
      for (const stream of decodedChunkChannels(row)) {
        const channel = parseStreamChannel(stream.channel);
        const samples = decodeChannel(channel, {
          channel,
          encoding: chunkChannelEncoding(stream),
          sampleCount: stream.sampleCount,
          values: stream.values,
          ...(stream.present === undefined ? {} : { present: stream.present }),
        });
        if (samples.length !== row.sampleCount) {
          throw new StoreDecodeError(
            `recording ${id} chunk ${String(row.seq)}: channel ${channel} holds ` +
              `${String(samples.length)} samples but the chunk declares ${String(row.sampleCount)}`,
          );
        }
        // Allocated at the full recovered length on first sight of the channel,
        // so a channel that only appears half way through the ride — a strap
        // paired late — is absent for the earlier slots rather than shifted
        // into them.
        const target = ((channels as Record<StreamChannel, unknown[]>)[channel] ??=
          new Array<unknown>(prefix.sampleCount));
        for (let index = 0; index < samples.length; index += 1) {
          target[row.fromIndex + index] = samples[index];
        }
      }
    }

    return {
      id: header.id,
      athleteId: header.athleteId,
      startedAt: header.startedAt,
      sampleInterval: header.sampleInterval,
      sampleCount: prefix.sampleCount,
      channels,
      pauses: header.pauses,
      state: header.state,
      chunks: prefix.rows.length,
      chunksAfterGap: stored.chunks.length - prefix.rows.length,
    };
  }

  /**
   * What a stored recording costs, **without decoding a sample**.
   *
   * #46 asks for the four-hour figure to be measured and its headroom recorded.
   * Measuring it by recovering the ride would measure the recovery instead.
   */
  async getRecordingFootprint(
    owner: AthleteId,
    id: RecordingSessionId,
  ): Promise<RecordingFootprint | undefined> {
    const stored = await this.#readRecordingRows(owner, id);
    if (stored === undefined) {
      return undefined;
    }
    let encodedBytes = 0;
    for (const row of stored.chunks) {
      encodedBytes += persistedChunkBytes(row);
    }
    return {
      sessionId: id,
      athleteId: owner,
      chunks: stored.chunks.length,
      sampleCount: contiguousChunkPrefix(stored.chunks).sampleCount,
      encodedBytes,
    };
  }

  /**
   * Deletes a recording and every one of its chunks.
   *
   * Called when a ride is finalised into an activity, and when the athlete
   * declines to recover one. Scoped: another athlete's recording id deletes
   * nothing and returns `false`. Deleting one that is not there is a no-op, for
   * `deleteAthlete`'s reason.
   */
  async deleteRecordingSession(owner: AthleteId, id: RecordingSessionId): Promise<boolean> {
    return this.#db.transaction(
      'rw',
      [this.#recordingSessions, this.#recordingChunks],
      async () => {
        const existing = await this.#recordingSessions
          .where(INDEX.recordingSessionByAthleteAndId)
          .equals([owner, id])
          .first();
        if (existing === undefined) {
          return false;
        }
        await this.#recordingChunks.where(INDEX.recordingChunkBySession).equals(id).delete();
        await this.#recordingSessions.delete(id);
        return true;
      },
    );
  }

  // --- Identity and signed records (#61) ------------------------------------

  /**
   * Stores this device's keypair for an athlete. **Write-once.**
   *
   * A second key for the same athlete is refused unless it is the same public
   * key, in which case the write is idempotent. That refusal is the store half
   * of #61's first acceptance criterion: an identity replaced silently splits
   * the athlete's history in two, and every record signed before the
   * replacement becomes unverifiable against the key that signs everything
   * after it. `createWebCryptoKeystore` in `web-crypto.ts` is written against
   * this refusal — on losing the race it re-reads and adopts the winner.
   *
   * The check and the write are in **one transaction**, for `putActivity`'s
   * reason: read-then-write outside one lets a concurrent creator land in
   * between, which is precisely the two-tab case this is guarding.
   *
   * @throws {StoreReferentialError} if `record.athleteId` names no athlete.
   * @throws {StoreValidationError} if a different key is already stored.
   */
  async putDeviceKey(record: DeviceKeyRecord): Promise<AthleteId> {
    const row = toPersistedDeviceKey(record);
    await this.#db.transaction('rw', [this.#athletes, this.#deviceKeys], async () => {
      await this.#requireAthlete(record.athleteId);
      const existing = await this.#deviceKeys.get(record.athleteId);
      if (existing !== undefined && existing.publicKey !== record.publicKey) {
        // The message names neither key. The public half would be harmless and
        // the private half is not in scope here at all, but a message that
        // prints one invites the next author to print the other.
        throw new StoreValidationError(
          `athlete ${record.athleteId} already has a device key; an identity is write-once, ` +
            `because replacing one splits the athlete's signed history in two`,
        );
      }
      await this.#deviceKeys.put(row);
    });
    return record.athleteId;
  }

  /**
   * This device's keypair for an athlete.
   *
   * Scoped by construction: `athleteId` is the primary key, so there is no
   * accessor here that finds a key without being told whose it is.
   */
  async getDeviceKey(owner: AthleteId): Promise<DeviceKeyRecord | undefined> {
    const row = await this.#deviceKeys.get(owner);
    return row === undefined ? undefined : fromPersistedDeviceKey(row);
  }

  /**
   * Files a signed record against the ride it vouches for.
   *
   * Three refusals:
   *
   * 1. the activity must exist **and belong to this athlete** — a record filed
   *    against somebody else's ride is the cross-athlete shape;
   * 2. the record's own `claims.activityId` must be the ride it is being filed
   *    against. Without this a valid, correctly signed record for ride A could
   *    be stored as the record for ride B and would verify perfectly, which is
   *    a forgery this store would have performed itself;
   * 3. if this athlete has a device key, the record must be signed by **that**
   *    key. `putDeviceKey` makes an identity write-once and ADR 0014 rules out
   *    rotation in Phase 1, so an athlete has exactly one public key and a
   *    record bearing another one is not theirs. Nothing in this build reaches
   *    it today — every record is signed by the key `ensureSigningKey`
   *    returned — but [#37](https://github.com/openzigs/onyourleft/issues/37)'s
   *    import is a path from a file into this method, and ADR 0014 names it as
   *    constrained by this. A record stored here is re-served and re-exported
   *    as the athlete's own, so accepting a foreign-signed one would make the
   *    store the thing that vouched for it.
   *
   *    **An athlete with *no* device key is allowed**, deliberately: that is
   *    the state after the export → downgrade → re-import rollback, where the
   *    non-extractable private key cannot come back and the records must. If a
   *    later ADR adds the additive rotation ADR 0014 describes, this widens to
   *    "any key in the athlete's key history" — it does not get deleted.
   *
   * The last two are inside one transaction with the read they depend on.
   *
   * There is deliberately **no** `#requireNotOwnedByAnother` here, unlike on
   * every other write path. It would be unreachable: an activity id belongs to
   * exactly one athlete — `putActivity` enforces that with its own copy of the
   * guard — so the scoped activity lookup above has already established that
   * this athlete owns the ride, and a record row exists only for a ride that
   * does. An unreachable branch cannot be mutation-tested and reads as though
   * it were guarding something.
   *
   * @throws {StoreReferentialError}
   * @throws {StoreValidationError}
   */
  async putActivityRecord(row: StoredActivityRecord): Promise<ActivityId> {
    if (row.record.claims.activityId !== row.activityId) {
      throw new StoreValidationError(
        `the record claims activity ${row.record.claims.activityId} and is being filed ` +
          `against ${row.activityId}`,
      );
    }
    const persisted = toPersistedActivityRecord(row);
    await this.#db.transaction(
      'rw',
      [this.#activities, this.#activityRecords, this.#deviceKeys],
      async () => {
        const activity = await this.#activities
          .where(INDEX.activityByAthleteAndId)
          .equals([row.athleteId, row.activityId])
          .first();
        if (activity === undefined) {
          throw new StoreReferentialError(
            `no activity ${row.activityId} belongs to athlete ${row.athleteId}`,
          );
        }
        const deviceKey = await this.#deviceKeys.get(row.athleteId);
        if (deviceKey !== undefined && deviceKey.publicKey !== row.record.publicKey) {
          throw new StoreValidationError(
            `the record filed against activity ${row.activityId} is signed by a key that is ` +
              `not athlete ${row.athleteId}'s`,
          );
        }
        await this.#activityRecords.put(persisted);
      },
    );
    return row.activityId;
  }

  /** The athlete-scoped point lookup. There is deliberately no unscoped one. */
  async getActivityRecord(
    owner: AthleteId,
    id: ActivityId,
  ): Promise<StoredActivityRecord | undefined> {
    const row = await this.#activityRecords
      .where(INDEX.activityRecordByAthleteAndActivity)
      .equals([owner, id])
      .first();
    return row === undefined ? undefined : fromPersistedActivityRecord(row);
  }

  // --- Internal -------------------------------------------------------------

  /**
   * Refuses to run against a database written by a newer build.
   *
   * IndexedDB raises `VersionError` for a downgrade; **Dexie 4.4.5 does not
   * pass that on** — declaring version 1 against a database Dexie left at
   * version 2 opens cleanly, reports `verno === 1`, and then reads version-2
   * records with version-1 code. Verified against Dexie 4.4.5 and asserted in
   * `activity-store.version-guard.test.ts`.
   *
   * Checked at the backing `IDBDatabase`, which is the only place that still
   * holds the truth after Dexie has decided the open succeeded.
   *
   * @throws {StoreVersionError}
   */
  #assertNotDowngraded(): void {
    const onDisk = this.#db.backendDB()?.version;
    const expected = SCHEMA_VERSION * DEXIE_IDB_VERSION_MULTIPLIER;
    if (onDisk !== undefined && onDisk > expected) {
      throw new StoreVersionError(
        `this database was written by a newer build (on-disk version ${String(onDisk)}, ` +
          `this build understands ${String(expected)}). Downgrading in place is not possible on ` +
          `IndexedDB; export with the newer build, then re-import.`,
      );
    }
  }

  /**
   * The foreign key this engine does not have.
   *
   * @throws {StoreReferentialError}
   */
  /**
   * Refuse to overwrite a row that belongs to a different athlete.
   *
   * `Table.put` is keyed on the primary key alone, so without this a second
   * athlete writing the same id silently **destroys** the first athlete's row —
   * and then owns it, which chains: the new owner can `deleteActivity` it and
   * take its laps with it.
   *
   * Found in review of PR #109. The read paths were already scoped and had
   * two-athlete fixtures proving it; the write paths had neither, and a
   * two-athlete *read* fixture is blind to this entirely. CLAUDE.md §6's
   * scoped-query rule says "any query" — a `put` is one.
   *
   * Not exploitable while ids are opaque and device-generated and there is one
   * local athlete. It becomes reachable the moment an id arrives from a user
   * file, which is #51's import and #37's dedup.
   */
  // Synchronous: the caller awaits the row and passes it in, so the guard runs
  // inside the caller's transaction without adding another suspension point.
  #requireNotOwnedByAnother(
    existing: { readonly athleteId: string } | undefined,
    owner: AthleteId,
    what: string,
  ): void {
    if (existing !== undefined && existing.athleteId !== owner) {
      throw new StoreReferentialError(
        `cannot overwrite ${what}: it belongs to a different athlete`,
      );
    }
  }

  async #requireAthlete(owner: AthleteId): Promise<void> {
    const athlete = await this.#athletes.get(owner);
    if (athlete === undefined) {
      throw new StoreReferentialError(`no athlete ${owner} exists`);
    }
  }

  // --- Streams: internal ----------------------------------------------------

  /**
   * Encodes and compresses every channel, and computes the row the summary
   * store holds. Runs entirely outside any transaction — see `putStreamSet`.
   */
  async #encodeStreamSet(
    set: NewStreamSet,
  ): Promise<{ summary: PersistedStreamSet; blobs: PersistedStreamBlob[] }> {
    if (!Number.isInteger(set.sampleCount) || set.sampleCount < 0) {
      throw new StoreValidationError(
        `sampleCount must be a non-negative integer, received ${String(set.sampleCount)}`,
      );
    }
    if (set.sampleInterval <= 0) {
      throw new StoreValidationError(
        `sampleInterval must be greater than zero, received ${String(set.sampleInterval)}`,
      );
    }

    const blobs: PersistedStreamBlob[] = [];
    const channels: StreamChannel[] = [];
    let encodedBytes = 0;

    // Iterating `STREAM_CHANNELS` rather than `Object.keys(set.channels)` fixes
    // the stored order and ignores any key that is not a channel, so a caller
    // handing over an object with an extra property stores eight channels at
    // most and always in the same order.
    for (const channel of STREAM_CHANNELS) {
      const samples = set.channels[channel];
      if (samples === undefined) {
        continue;
      }
      if (samples.length !== set.sampleCount) {
        throw new StoreValidationError(
          `stream channel ${channel}: has ${String(samples.length)} samples but the set declares ` +
            `${String(set.sampleCount)}. Every channel shares one time base, so sample i of one ` +
            `channel is the same instant as sample i of another`,
        );
      }
      const encoded = encodeChannel(channel, samples);
      const values = await compressStreamBytes(encoded.values);
      const present =
        encoded.present === undefined ? undefined : await compressStreamBytes(encoded.present);
      const row: PersistedStreamBlob = {
        activityId: set.activityId,
        channel,
        athleteId: set.athleteId,
        encoding: encoded.encoding,
        compression: STREAM_COMPRESSION,
        sampleCount: encoded.sampleCount,
        values,
        ...(present === undefined ? {} : { present }),
      };
      blobs.push(row);
      channels.push(channel);
      encodedBytes += persistedBlobBytes(row);
    }

    return {
      summary: {
        activityId: set.activityId,
        athleteId: set.athleteId,
        startedAt: set.startedAt,
        sampleIntervalSeconds: set.sampleInterval,
        sampleCount: set.sampleCount,
        channels,
        encodedBytes,
      },
      blobs,
    };
  }

  /**
   * Reads the summary row and every blob row in **one** read transaction, so
   * the two cannot come from either side of a concurrent write.
   *
   * Returns the rows still compressed. Inflating them here would mean awaiting
   * a promise Dexie did not create while a transaction is open.
   */
  async #readStreamRows(
    owner: AthleteId,
    activity: ActivityId,
  ): Promise<{ set: PersistedStreamSet; blobs: PersistedStreamBlob[] } | undefined> {
    return this.#db.transaction('r', [this.#streamSets, this.#streamBlobs], async () => {
      const set = await this.#streamSets
        .where(INDEX.streamSetByAthleteAndActivity)
        .equals([owner, activity])
        .first();
      if (set === undefined) {
        return undefined;
      }
      const blobs = await this.#streamBlobs
        .where(INDEX.streamBlobByAthleteAndActivityAndChannel)
        .between([owner, activity, Dexie.minKey], [owner, activity, Dexie.maxKey], true, true)
        .toArray();
      return { set, blobs };
    });
  }

  /**
   * Inflates and decodes one blob row.
   *
   * @throws {StoreDecodeError} — including for a compression framing this build
   * does not write and for bytes that are not a valid stream. A corrupt channel
   * must fail loudly: silently yielding an empty series would draw a chart with
   * a gap the athlete's ride did not have.
   */
  async #decodeBlob(row: PersistedStreamBlob): Promise<Samples<StreamChannel>> {
    const channel = parseStreamChannel(row.channel);
    if (row.compression !== STREAM_COMPRESSION) {
      throw new StoreDecodeError(
        `stream channel ${channel}: stored compression ${String(row.compression)} is not the ` +
          `${STREAM_COMPRESSION} this build writes`,
      );
    }
    // The declared sample count bounds the inflation, so it is validated before a
    // single byte is decompressed rather than after.
    const declared = fromPersistedStreamBlob(row, EMPTY_BYTES, undefined).sampleCount;
    // ...and the declaration is itself bounded, because it comes from the same
    // untrusted row as the bytes it is supposed to bound. Without this the
    // attacker sets the limit: review of PR #124 reproduced a 24,464-byte row
    // declaring 12,582,912 samples inflating to +170 MiB.
    if (declared > MAX_INFLATED_SAMPLES) {
      throw new StoreDecodeError(
        `stream channel ${channel}: declares ${declared} samples, above the ` +
          `${MAX_INFLATED_SAMPLES} this build will inflate`,
      );
    }
    const values = await inflate(
      channel,
      'values',
      row.values,
      declared * channelBytesPerSample(channel),
    );
    const present =
      row.present === undefined
        ? undefined
        : await inflate(channel, 'present', row.present, Math.ceil(declared / 8));
    return decodeChannel(channel, fromPersistedStreamBlob(row, values, present));
  }

  // --- Recording checkpoints: internal --------------------------------------

  /**
   * Packs one chunk's channels. Synchronous, and that is the point.
   *
   * `#encodeStreamSet` is asynchronous because it compresses; this is not,
   * because it does not (see `recording.ts`). A flush is the operation racing
   * the tab's death, and every `await` in it is another place the tab can die
   * between the caller believing the write started and the transaction opening.
   *
   * @throws {StoreValidationError}
   */
  #encodeRecordingChunk(chunk: NewRecordingChunk): PersistedRecordingChunk {
    requireCount('recording chunk seq', chunk.seq);
    requireCount('recording chunk fromIndex', chunk.fromIndex);
    requireCount('recording chunk sampleCount', chunk.sampleCount);

    const channels: PersistedRecordingChannel[] = [];
    // `STREAM_CHANNELS` rather than `Object.keys`, for `#encodeStreamSet`'s
    // reason: it fixes the stored order and ignores any key that is not a
    // channel.
    for (const channel of STREAM_CHANNELS) {
      const samples = chunk.channels[channel];
      if (samples === undefined) {
        continue;
      }
      if (samples.length !== chunk.sampleCount) {
        throw new StoreValidationError(
          `recording chunk channel ${channel}: has ${String(samples.length)} samples but the ` +
            `chunk declares ${String(chunk.sampleCount)}. Every channel shares one time base`,
        );
      }
      const encoded = encodeChannel(channel, samples);
      channels.push({
        channel,
        encoding: encoded.encoding,
        sampleCount: encoded.sampleCount,
        values: encoded.values,
        ...(encoded.present === undefined ? {} : { present: encoded.present }),
      });
    }

    return {
      sessionId: chunk.sessionId,
      seq: chunk.seq,
      athleteId: chunk.athleteId,
      fromIndex: chunk.fromIndex,
      sampleCount: chunk.sampleCount,
      channels,
    };
  }

  /**
   * Reads the header and every chunk row in **one** read transaction, so the
   * two cannot come from either side of a concurrent flush.
   *
   * Ordered by the `[athleteId+sessionId+seq]` index rather than sorted after
   * the fact, so the append order is the storage engine's answer and not this
   * process's.
   */
  async #readRecordingRows(
    owner: AthleteId,
    id: RecordingSessionId,
  ): Promise<
    { session: PersistedRecordingSession; chunks: PersistedRecordingChunk[] } | undefined
  > {
    return this.#db.transaction('r', [this.#recordingSessions, this.#recordingChunks], async () => {
      const session = await this.#recordingSessions
        .where(INDEX.recordingSessionByAthleteAndId)
        .equals([owner, id])
        .first();
      if (session === undefined) {
        return undefined;
      }
      const chunks = await this.#recordingChunks
        .where(INDEX.recordingChunkByAthleteAndSessionAndSeq)
        .between([owner, id, Dexie.minKey], [owner, id, Dexie.maxKey], true, true)
        .toArray();
      return { session, chunks };
    });
  }
}

/**
 * The longest run of chunks from `seq` 0 whose windows join end to end.
 *
 * A recording is only as long as its **contiguous** prefix. `seq` must run
 * 0, 1, 2… and each window must start exactly where the previous one ended;
 * the first row that breaks either rule ends the prefix, and everything after
 * it is reported rather than used.
 *
 * Both conditions are needed and neither implies the other. A missing `seq`
 * is a flush that never committed. A `fromIndex` that does not continue is a
 * row written by a different recorder, or one whose window was recomputed
 * against a series this one does not have — and joining those two would shift
 * every later sample onto the wrong second while producing an array of exactly
 * the length a caller expects.
 */
function contiguousChunkPrefix(chunks: readonly PersistedRecordingChunk[]): {
  rows: PersistedRecordingChunk[];
  sampleCount: number;
} {
  const rows: PersistedRecordingChunk[] = [];
  let sampleCount = 0;
  for (const [index, row] of chunks.entries()) {
    if (row.seq !== index || row.fromIndex !== sampleCount) {
      break;
    }
    if (!Number.isInteger(row.sampleCount) || row.sampleCount < 0) {
      break;
    }
    rows.push(row);
    sampleCount += row.sampleCount;
  }
  return { rows, sampleCount };
}

/** @throws {StoreValidationError} */
function requireCount(what: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new StoreValidationError(
      `${what} must be a non-negative integer, received ${String(value)}`,
    );
  }
}

/**
 * Narrows a full record to the list projection.
 *
 * Written as an explicit destructure rather than a spread-and-delete so that a
 * field added to `ActivityRecord` in a later version does **not** silently
 * appear in every list row. When #27 adds a stream reference, this function
 * fails to compile until someone decides which side of the projection it is on
 * — which is the decision #62's "never loads stream data for a list row"
 * criterion actually needs made.
 */
function summaryOf(record: ActivityRecord): ActivitySummary {
  const {
    id,
    athleteId: owner,
    name,
    startedAt,
    startedAtTimeZone,
    elapsedTime,
    movingTime,
    distance,
    visibility,
    hasPosition,
    averagePower,
    createdAt,
  } = record;
  return {
    id,
    athleteId: owner,
    name,
    startedAt,
    startedAtTimeZone,
    elapsedTime,
    movingTime,
    distance,
    visibility,
    hasPosition,
    createdAt,
    ...(averagePower === undefined ? {} : { averagePower }),
  };
}

/** Stands in for a blob's bytes while only its declared sample count is being read. */
const EMPTY_BYTES = new Uint8Array(0);

/** A `StreamChannels` under construction. The public type is deeply readonly. */
type MutableStreamChannels = { -readonly [C in StreamChannel]?: Samples<C> };

/**
 * Decompresses one of a blob row's two byte arrays.
 *
 * The bytes came off disk and are untrusted, so a `DecompressionStream`
 * rejection — or a `StreamSizeError` from inflating past what the row declares
 * — becomes a `StoreDecodeError` naming the channel and which array, `values`
 * or `present`, rather than the platform's own message, which says only that a
 * stream was corrupt.
 */
async function inflate(
  channel: StreamChannel,
  what: 'values' | 'present',
  bytes: Uint8Array,
  limit: number,
): Promise<Uint8Array> {
  try {
    return await decompressStreamBytes(bytes, limit);
  } catch (cause) {
    // The two failures are reported apart because they mean different things to
    // whoever reads the message: one is a corrupt stream, the other is a stream
    // that is not corrupt at all and is claiming to be a row it is not.
    if (cause instanceof StreamSizeError) {
      throw new StoreDecodeError(`stream channel ${channel}: the stored ${what} ${cause.message}`);
    }
    throw new StoreDecodeError(
      `stream channel ${channel}: the stored ${what} are not a valid ${STREAM_COMPRESSION} stream`,
    );
  }
}

/**
 * The athlete row with both threshold fields removed.
 *
 * `delete` on a copy rather than a rest destructure, because
 * `exactOptionalPropertyTypes` makes `{ ...record, thresholdPower: undefined }`
 * a type error and a rest destructure leaves two bindings nothing reads. The
 * point is the same either way: {@link ActivityStore.setAthleteThresholds}
 * builds its result from **whatever is on the row**, so a field added to
 * `AthleteRecord` survives a threshold save without anyone editing that method.
 */
function withoutThresholds(record: AthleteRecord): AthleteRecord {
  const copy: { -readonly [K in keyof AthleteRecord]?: AthleteRecord[K] } = { ...record };
  delete copy.thresholdPower;
  delete copy.thresholdHeartRate;
  return copy as AthleteRecord;
}
