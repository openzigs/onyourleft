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

import { StoreReferentialError, StoreValidationError, StoreVersionError } from './errors';
import type { ActivityId, AthleteId, LapId, PrivacyZoneId } from './ids';
import {
  fromPersistedActivity,
  fromPersistedAthlete,
  fromPersistedLap,
  fromPersistedPrivacyZone,
  toPersistedActivity,
  toPersistedAthlete,
  toPersistedLap,
  toPersistedPrivacyZone,
  type PersistedActivity,
  type PersistedAthlete,
  type PersistedLap,
  type PersistedPrivacyZone,
} from './persisted';
import type {
  ActivityRecord,
  ActivitySummary,
  AthleteRecord,
  LapRecord,
  NewActivity,
  NewLap,
  PrivacyZoneRecord,
} from './records';
import { DEXIE_IDB_VERSION_MULTIPLIER, INDEX, SCHEMA_VERSION, STORES_V1, TABLE } from './schema';
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
}

/** What `deleteAthlete` removed, so a caller can report it. */
export interface AthleteDeletionCounts {
  readonly activities: number;
  readonly laps: number;
  readonly privacyZones: number;
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
    this.#db.version(SCHEMA_VERSION).stores(STORES_V1);
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
      [this.#athletes, this.#activities, this.#laps, this.#privacyZones],
      async () => {
        const laps = await this.#laps.where(INDEX.lapByAthlete).equals(id).delete();
        const activities = await this.#activities
          .where(INDEX.activityByAthlete)
          .equals(id)
          .delete();
        const privacyZones = await this.#privacyZones
          .where(INDEX.privacyZoneByAthlete)
          .equals(id)
          .delete();
        await this.#athletes.delete(id);
        return { activities, laps, privacyZones };
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
      await this.#requireNotOwnedByAnother(
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
    const { orderBy = 'startedAt', direction = 'descending', offset = 0, limit } = options;
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

    let collection = this.#activities
      .where(index)
      .between([owner, Dexie.minKey], [owner, Dexie.maxKey], true, true);
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
   * Deletes one of this athlete's activities and its laps.
   *
   * Scoped: passing another athlete's activity id deletes nothing and returns
   * `false`, rather than deleting it.
   */
  async deleteActivity(owner: AthleteId, id: ActivityId): Promise<boolean> {
    return this.#db.transaction('rw', [this.#activities, this.#laps], async () => {
      const existing = await this.#activities
        .where(INDEX.activityByAthleteAndId)
        .equals([owner, id])
        .first();
      if (existing === undefined) {
        return false;
      }
      await this.#laps.where(INDEX.lapByActivity).equals(id).delete();
      await this.#activities.delete(id);
      return true;
    });
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
      await this.#requireNotOwnedByAnother(
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
      await this.#requireNotOwnedByAnother(
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
  async #requireNotOwnedByAnother(
    existing: { readonly athleteId: string } | undefined,
    owner: AthleteId,
    what: string,
  ): Promise<void> {
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
