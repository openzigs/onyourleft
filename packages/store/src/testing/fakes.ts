// SPDX-License-Identifier: Apache-2.0

/**
 * Deliberately broken stores, for proving the harness can fail.
 *
 * #28: *"The harness is proved to work by deliberately breaking persistence and
 * observing the test go red. A harness that passes against a no-op write is
 * worthless, and this is the only way to know it does not."*
 *
 * There are **twenty-one** fakes here, and there are twenty-one on purpose: a harness
 * that catches one failure shape is calibrated to that shape. They stand for the
 * causes CLAUDE.md section 5 names, and they fail for different reasons at
 * different points in the read. The fourth arrived with #46's write path, the
 * fifth with #61's, the sixth with #64's, the seventh with #66's, the eighth
 * with #89's, the ninth with #73's, the tenth with #14's, the eleventh with
 * #93's, the twelfth with #238's, the thirteenth with #325's, the
 * fourteenth with #384's, the fifteenth with #528's, the sixteenth with #530's, the
 * seventeenth with #388's, the eighteenth with #623's — and later ones with #800 and #839 — which is the rule this file exists to enforce: a new
 * path may not ship without a fake proving the harness catches its failure.
 *
 * ⚠️ **The fourteenth breaks a DELETE, and every one before it breaks a write
 * or a read.** That is not a third category for its own sake: #384's payload is
 * a photograph of the inside of somebody's house, and the failure that matters
 * most for it is not a write that never lands — it is *"a frame the rider
 * believes was erased, and was not"*, in that issue's own words. A write-path
 * fake cannot catch that, because the write was perfect.
 *
 * ⚠️ **The eleventh breaks a *read*, and every one before it breaks a write.**
 * That is not a category error, it is #93's fifth acceptance criterion: a ghost
 * lookup that matches on route and forgets the rider returns another athlete's
 * ride, having written everything perfectly. No write-path fake can catch that,
 * because nothing about the write is wrong.
 *
 * | Fake | Cause it stands for | How the round trip notices |
 * |---|---|---|
 * | `memoryWriteStoreFactory` | *wrong storage* — the write went to memory | the read finds no set at all |
 * | `misroutedBlobStoreFactory` | *wrong storage* — the right store, a key prefix the reader does not use | the set is there and claims eight channels whose bytes are gone |
 * | `gapFillingStoreFactory` | *wrong layer* — a layer above the store rewrote the data on its way in | the set comes back whole, and a gap has become a zero |
 * | `droppedFlushStoreFactory` | *wrong layer* — a flush acknowledged at the edge that never reached the database | the recording comes back short, at the first missing flush |
 * | `roundedClaimStoreFactory` | *wrong layer* — a layer above tidied a signed claim on its way in | the record comes back whole and **no longer verifies** |
 * | `thinnedGeometryStoreFactory` | *wrong layer* — a downsampler above the store thinned a segment's geometry on its way in | the segment comes back complete, with the right name, distance and endpoints, and **a shorter path** |
 * | `appendingEffortStoreFactory` | *wrong layer* — the write inserted where it should have replaced | one match is right; the second one doubles every board |
 * | `openedLoopStoreFactory` | *wrong layer* — one boolean lost in a mapping on the way in | the route comes back with every metre and every gradient correct, and **no longer wraps** |
 * | `publishedRouteStoreFactory` | *wrong layer* — a default applied on the way in, in the unsafe direction | the route comes back complete and correct, and **shared with everybody** |
 * | `truncatedWorkoutStoreFactory` | *wrong layer* — a layer above dropped the last block on its way in | the workout comes back with the right name and a valid shape, **ending early** |
 * | `unscopedAttemptStoreFactory` | *cross-athlete exposure* — a **read** that matched on route and forgot the rider | every ride is written and read back correctly, and the ghost list contains a stranger's ride |
 * | `staleUnitsStoreFactory` | *wrong layer* — the narrow write computed the row and returned it without persisting it | the call answers with a row saying `imperial`, and a fresh connection still says metric |
 * | `roundedMassStoreFactory` | *wrong layer* — a layer above tidied a mass to a whole kilogram on its way in | the row comes back with a mass, a plausible one, and a pound reading that is no longer what the rider typed |
 * | `misfiledKitColourStoreFactory` | *wrong storage* — the right table and the right row, under a key the reader does not use | the call answers with the chosen colour, and a fresh connection reads the house kit |
 * | `lastWordDroppedStoreFactory` | *wrong layer* — a layer above dropped the last entry of the rider's masked-word list on its way in | the call answers with the whole list, and a fresh connection reads one word short — the one the rider typed last, which is then sent to a hosted model unmasked |
| `survivingFrameStoreFactory` | *wrong time* — a **delete** that reports how many it removed and removes nothing | the erase says "2 pictures removed", and a fresh connection still has both |
 * | `firstReferenceStoreFactory` | *wrong time* — a put that kept the row already there instead of replacing it | every put succeeds and the reference comes back well-formed — **from the first session**, not the last |
 * | `lastSentenceDroppedReportStoreFactory` | *wrong layer* — a layer above dropped the last sentence of the side camera's report on its way in | the report comes back for the right ride, with the right summary and a plausible list — **one observation short**, and nothing on the page says so |
 * | `verdictlessReferenceStoreFactory` | *wrong layer* — a layer above copied the reference's numbers and dropped whether the framing check passed | every landmark comes back exact, and the session's verdict is **gone**, so no later report may compare it with anything |
 *
 * The second and third are the ones a naive harness misses. Both write to the
 * **real** IndexedDB, inside a **real** transaction that **really commits**, and
 * every write reports success; only a read through the public path on a fresh
 * connection can tell. The third is the reason there are three rather than two:
 * a round trip that only ever checks *whether* something came back would pass
 * against it, and a mutation run found exactly that hole — removing the
 * sample-by-sample comparison from `assertStreamSetRoundTrip` left the whole
 * suite green.
 */

import Dexie from 'dexie';

import { kilograms, type Kilograms } from '@onyourleft/domain';

import { openActivityStore, deleteActivityStore, type ActivityStore } from '../activity-store';
import {
  segmentEffortId,
  type ActivityId,
  type AthleteId,
  type RouteId,
  type WorkoutId,
  type SegmentId,
} from '../ids';
import type { DeviceKeyRecord, StoredActivityRecord } from '../identity';
import { SCHEMA_VERSIONS, TABLE } from '../schema';
import type { NewRecordingChunk, NewRecordingSession } from '../recording';
import type {
  ActivityRecord,
  FramingReferenceRecord,
  RouteRecord,
  SideCameraReportRecord,
  RideWriteUpRecord,
  SyncBaseRecord,
  RiderTextRecord,
  SegmentEffortRecord,
  SegmentRecord,
  WorkoutRecord,
} from '../records';
import { fromPersistedActivity, type PersistedActivity, type PersistedAthlete } from '../persisted';
import type { PersistedStreamBlob } from '../stream-persisted';
import type { KitColour } from '../kit-colour';
import type { UnitSystem } from '../unit-system';
import {
  STREAM_CHANNELS,
  type NewStreamSet,
  type Samples,
  type StreamChannel,
  type StreamChannels,
} from '../streams';

import type { PersistentStore, StoreFactory } from './store';

/**
 * Every public method of a real store, bound to it.
 *
 * Explicit rather than `Object.create(real)`: `ActivityStore` holds its Dexie
 * handle in a `#private` field, and a method reached through a prototype chain
 * with a different `this` cannot see one. Writing the list out also means a new
 * method on `ActivityStore` fails to compile here until a fake accounts for it,
 * which is how a new write path cannot ship with nothing proving the harness
 * catches its failure.
 */
function bindStore(real: ActivityStore): PersistentStore {
  return {
    schemaVersion: real.schemaVersion,
    open: async () => real.open(),
    close: () => {
      real.close();
    },
    putAthlete: async (record) => real.putAthlete(record),
    ensureAthlete: async (record) => real.ensureAthlete(record),
    setAthleteThresholds: async (id, thresholds) => real.setAthleteThresholds(id, thresholds),
    setAthleteUnits: async (id, units) => real.setAthleteUnits(id, units),
    setAthleteMass: async (id, mass) => real.setAthleteMass(id, mass),
    setAthleteKitColour: async (id, colour) => real.setAthleteKitColour(id, colour),
    setAthleteMaskedWords: async (id, words) => real.setAthleteMaskedWords(id, words),
    setActivityLoadSummary: async (owner, activity, summary) =>
      real.setActivityLoadSummary(owner, activity, summary),
    getAthlete: async (id) => real.getAthlete(id),
    deleteAthlete: async (id) => real.deleteAthlete(id),
    putActivity: async (record) => real.putActivity(record),
    getActivity: async (owner, id) => real.getActivity(owner, id),
    listActivitySummaries: async (owner, options) => real.listActivitySummaries(owner, options),
    findActivityByOriginalFileHash: async (owner, sha256) =>
      real.findActivityByOriginalFileHash(owner, sha256),
    listRouteAttempts: async (owner, route, limit) => real.listRouteAttempts(owner, route, limit),
    deleteActivity: async (owner, id) => real.deleteActivity(owner, id),
    putLap: async (record) => real.putLap(record),
    listLaps: async (owner, activity) => real.listLaps(owner, activity),
    putPrivacyZone: async (record) => real.putPrivacyZone(record),
    listPrivacyZones: async (owner) => real.listPrivacyZones(owner),
    putStreamSet: async (set) => real.putStreamSet(set),
    getStreamSet: async (owner, activity) => real.getStreamSet(owner, activity),
    getStreamSetSummary: async (owner, activity) => real.getStreamSetSummary(owner, activity),
    getStreamChannel: async (owner, activity, channel) =>
      real.getStreamChannel(owner, activity, channel),
    deleteStreamSet: async (owner, activity) => real.deleteStreamSet(owner, activity),
    putRecordingSession: async (record) => real.putRecordingSession(record),
    getRecordingSession: async (owner, id) => real.getRecordingSession(owner, id),
    listRecordingSessions: async (owner) => real.listRecordingSessions(owner),
    appendRecordingChunk: async (chunk) => real.appendRecordingChunk(chunk),
    recoverRecording: async (owner, id) => real.recoverRecording(owner, id),
    getRecordingFootprint: async (owner, id) => real.getRecordingFootprint(owner, id),
    deleteRecordingSession: async (owner, id) => real.deleteRecordingSession(owner, id),
    putDeviceKey: async (record) => real.putDeviceKey(record),
    getDeviceKey: async (owner) => real.getDeviceKey(owner),
    putActivityRecord: async (row) => real.putActivityRecord(row),
    getActivityRecord: async (owner, id) => real.getActivityRecord(owner, id),
    putSegment: async (record) => real.putSegment(record),
    getSegment: async (owner, id) => real.getSegment(owner, id),
    listSegments: async (owner, limit) => real.listSegments(owner, limit),
    deleteSegment: async (owner, id) => real.deleteSegment(owner, id),
    putActivityEfforts: async (owner, activityId, efforts) =>
      real.putActivityEfforts(owner, activityId, efforts),
    listEfforts: async (owner, segment, limit) => real.listEfforts(owner, segment, limit),
    listSharedEfforts: async (owner, segment, limit) =>
      real.listSharedEfforts(owner, segment, limit),
    listActivityEfforts: async (owner, activityId) => real.listActivityEfforts(owner, activityId),
    getMatchCheckpoint: async (owner) => real.getMatchCheckpoint(owner),
    putMatchCheckpoint: async (record) => real.putMatchCheckpoint(record),
    clearMatchCheckpoint: async (owner) => real.clearMatchCheckpoint(owner),
    putRoute: async (record) => real.putRoute(record),
    getRoute: async (owner, id) => real.getRoute(owner, id),
    listRoutes: async (owner, limit) => real.listRoutes(owner, limit),
    deleteRoute: async (owner, id) => real.deleteRoute(owner, id),
    putWorkout: async (record) => real.putWorkout(record),
    getWorkout: async (owner, id) => real.getWorkout(owner, id),
    listWorkouts: async (owner, limit) => real.listWorkouts(owner, limit),
    deleteWorkout: async (owner, id) => real.deleteWorkout(owner, id),
    putCameraFrame: async (record) => real.putCameraFrame(record),
    listCameraFrames: async (owner, limit) => real.listCameraFrames(owner, limit),
    countCameraFrames: async (owner) => real.countCameraFrames(owner),
    deleteCameraFrames: async (owner) => real.deleteCameraFrames(owner),
    putFramingReference: async (record) => real.putFramingReference(record),
    getFramingReference: async (owner) => real.getFramingReference(owner),
    deleteFramingReference: async (owner) => real.deleteFramingReference(owner),
    putSideCameraReport: async (record) => real.putSideCameraReport(record),
    getSideCameraReport: async (owner, activity) => real.getSideCameraReport(owner, activity),
    putRideWriteUp: async (record) => real.putRideWriteUp(record),
    getRideWriteUp: async (owner, activity) => real.getRideWriteUp(owner, activity),
    putSyncBase: async (record) => real.putSyncBase(record),
    listSyncBase: async (owner) => real.listSyncBase(owner),
    deleteSyncBase: async (owner, kind, key) => real.deleteSyncBase(owner, kind, key),
    putRiderText: async (record) => real.putRiderText(record),
    getRiderText: async (owner, kind, key) => real.getRiderText(owner, kind, key),
    listRiderTexts: async (owner, kind) => real.listRiderTexts(owner, kind),
    deleteRiderText: async (owner, kind, key) => real.deleteRiderText(owner, kind, key),
  };
}

/**
 * A repository that **stores every write to memory instead of the database**,
 * and reads from the database.
 *
 * The literal fake #28's criterion names. Its memory belongs to the handle, so
 * a fresh connection — which is the only kind the harness's `read` hands out —
 * starts empty, and every write that reported success is invisible.
 *
 * Every write path is diverted rather than only the one under test, so this
 * fake is usable by #26's records, #27's streams and #61's signed records
 * without being edited for each.
 */
export function memoryWriteStoreFactory(): StoreFactory {
  return {
    open(name: string): PersistentStore {
      const real = openActivityStore(name);
      const memory = new Map<string, unknown>();
      return {
        ...bindStore(real),
        putAthlete: (record) => {
          memory.set(`athlete:${record.id}`, record);
          return Promise.resolve(record.id);
        },
        // Diverted like every other write path, and it is the one whose
        // failure is quietest: `ensureAthlete` answers with the record it was
        // handed, so a caller that never re-reads sees a plausible athlete and
        // every later write fails referentially instead (#184).
        ensureAthlete: (record) => {
          memory.set(`athlete:${record.id}`, record);
          return Promise.resolve(record);
        },
        // Diverted like the rest. This one answers with a plausible record
        // built from what it was handed, so a caller that trusts the return
        // value sees its threshold "saved" and the next read has the old one.
        setAthleteThresholds: (id, thresholds) => {
          memory.set(`athlete:${id}`, thresholds);
          return Promise.resolve(undefined);
        },
        // Diverted like the rest. It answers `true`, so a backfill reports
        // every ride computed and the next read finds none of them written —
        // which is what makes the read-back the only thing that notices.
        setActivityLoadSummary: (_owner, activity, summary) => {
          memory.set(`load:${activity}`, summary);
          return Promise.resolve(true);
        },
        putActivity: (record) => {
          memory.set(`activity:${record.id}`, record);
          return Promise.resolve(record.id);
        },
        putLap: (record) => {
          memory.set(`lap:${record.id}`, record);
          return Promise.resolve(record.id);
        },
        putPrivacyZone: (record) => {
          memory.set(`zone:${record.id}`, record);
          return Promise.resolve(record.id);
        },
        putStreamSet: (set: NewStreamSet) => {
          memory.set(`streams:${set.activityId}`, set);
          return Promise.resolve(set.activityId);
        },
        putRecordingSession: (record: NewRecordingSession) => {
          memory.set(`recording:${record.id}`, record);
          return Promise.resolve(record.id);
        },
        appendRecordingChunk: (chunk: NewRecordingChunk) => {
          memory.set(`chunk:${chunk.sessionId}:${String(chunk.seq)}`, chunk);
          return Promise.resolve(chunk.seq);
        },
        putDeviceKey: (record: DeviceKeyRecord) => {
          memory.set(`key:${record.athleteId}`, record);
          return Promise.resolve(record.athleteId);
        },
        putSegment: (record: SegmentRecord) => {
          memory.set(`segment:${record.id}`, record);
          return Promise.resolve(record.id);
        },
        putWorkout: (record: WorkoutRecord) => {
          memory.set(`workout:${record.id}`, record);
          return Promise.resolve(record.id);
        },
        putRoute: (record: RouteRecord) => {
          memory.set(`route:${record.id}`, record);
          return Promise.resolve(record.id);
        },
        putActivityRecord: (row: StoredActivityRecord) => {
          memory.set(`record:${row.activityId}`, row);
          return Promise.resolve(row.activityId);
        },
        putSideCameraReport: (record: SideCameraReportRecord) => {
          memory.set(`side-report:${record.activityId}`, record);
          return Promise.resolve();
        },
        putRideWriteUp: (record: RideWriteUpRecord) => {
          memory.set(`write-up:${record.activityId}`, record);
          return Promise.resolve();
        },
        putSyncBase: (record: SyncBaseRecord) => {
          memory.set(`sync-base:${record.kind}:${record.key}`, record);
          return Promise.resolve();
        },
        // #836. Answers with the record it was handed, as the real write
        // answers with the record it wrote — so only the read-back notices.
        putRiderText: (record: RiderTextRecord) => {
          memory.set(`rider-text:${record.kind}:${record.key}`, record);
          return Promise.resolve(record);
        },
      };
    },
    destroy: async (name) => {
      await deleteActivityStore(name);
    },
  };
}

/** The prefix the misrouting fake files stream blobs under. Nothing reads it. */
const MISROUTED_PREFIX = 'cache:';

/**
 * A repository whose stream write lands in the **right object store under a key
 * prefix the read path does not use**.
 *
 * This is the interesting one. It writes through the real store, so the bytes
 * are real, the transaction is real, and it commits. Then it moves the blob
 * rows to a key nothing queries — CLAUDE.md section 5's *wrong storage*, in the
 * "different key prefix" variant, which is the variant a `expect(write).resolves`
 * test and a same-connection read both pass over in silence.
 *
 * The metadata row is deliberately **left correct**, because that is what makes
 * it realistic: a summary that says the ride has eight channels and a blob store
 * that has none is precisely the half-written state #27's atomicity criterion
 * is about, arrived at from the other direction.
 */
export function misroutedBlobStoreFactory(): StoreFactory {
  return {
    open(name: string): PersistentStore {
      const real = openActivityStore(name);
      const raw = new Dexie(name);
      SCHEMA_VERSIONS.forEach((stores, index) => {
        raw.version(index + 1).stores(stores);
      });
      const blobs = raw.table<PersistedStreamBlob, [string, string]>(TABLE.streamBlobs);
      return {
        ...bindStore(real),
        close: () => {
          real.close();
          raw.close();
        },
        putStreamSet: async (set: NewStreamSet): Promise<ActivityId> => {
          const id = await real.putStreamSet(set);
          await raw.transaction('rw', blobs, async () => {
            const written = await blobs.where('activityId').equals(set.activityId).toArray();
            await blobs.where('activityId').equals(set.activityId).delete();
            await blobs.bulkPut(
              written.map((row) => ({
                ...row,
                activityId: `${MISROUTED_PREFIX}${row.activityId}`,
              })),
            );
          });
          return id;
        },
      };
    },
    destroy: async (name) => {
      await deleteActivityStore(name);
    },
  };
}

/**
 * A repository that **fills every gap with a zero** on its way into the store.
 *
 * The third failure shape, and the one that is invisible to a round trip
 * asking only whether something came back: the write succeeds, the read finds a
 * complete stream set of exactly the right length, and a heart-rate strap that
 * dropped for thirty seconds has become thirty seconds at 0 bpm. #27 names this
 * as the thing that "corrupts every downstream metric in #11", and a layer
 * above the store quietly normalising `undefined` to `0` is how it happens for
 * real — CLAUDE.md section 5's *wrong layer*.
 *
 * It exists because a mutation run found the hole it closes: deleting the
 * sample-by-sample comparison from `assertStreamSetRoundTrip` left every test
 * in this package green.
 */
export function gapFillingStoreFactory(): StoreFactory {
  return {
    open(name: string): PersistentStore {
      const real = openActivityStore(name);
      return {
        ...bindStore(real),
        putStreamSet: async (set: NewStreamSet): Promise<ActivityId> =>
          real.putStreamSet({ ...set, channels: withGapsFilled(set.channels) }),
        // The same normalisation on the recording path, because #46's recovery
        // is where it would do the most damage: a ride recovered after a crash
        // with every dropout turned into zeroes reads as a complete ride and is
        // not one, and nothing downstream can tell.
        appendRecordingChunk: async (chunk: NewRecordingChunk): Promise<number> =>
          real.appendRecordingChunk({ ...chunk, channels: withGapsFilled(chunk.channels) }),
      };
    },
    destroy: async (name) => {
      await deleteActivityStore(name);
    },
  };
}

/**
 * A repository whose **every second flush is acknowledged and never written**.
 *
 * The fourth failure shape, and the one that belongs to #46 specifically:
 * CLAUDE.md section 5's *wrong layer* — "acknowledged at the edge, nothing
 * below persisted". `appendRecordingChunk` resolves with the sequence number
 * the caller expects, the recorder advances its flush cursor, and the row is
 * simply not there.
 *
 * It is the most realistic of the four, because it is what a queued write, a
 * swallowed rejection or a transaction abandoned by a dying tab all look like
 * from the caller's side. A recovery that concatenated whatever rows survived
 * would return a series of *almost* the right length with every sample after
 * the first hole shifted onto the wrong second; `contiguousChunkPrefix` in
 * `activity-store.ts` is what makes it come back short and honest instead, and
 * this fake is what proves that assertion can fail.
 */
export function droppedFlushStoreFactory(): StoreFactory {
  return {
    open(name: string): PersistentStore {
      const real = openActivityStore(name);
      let flushes = 0;
      return {
        ...bindStore(real),
        appendRecordingChunk: async (chunk: NewRecordingChunk): Promise<number> => {
          flushes += 1;
          if (flushes % 2 === 0) {
            // Reported success. Nothing written. No error anywhere.
            return chunk.seq;
          }
          return real.appendRecordingChunk(chunk);
        },
      };
    },
    destroy: async (name) => {
      await deleteActivityStore(name);
    },
  };
}

/**
 * A repository that **tidies a record's claims on the way in**.
 *
 * The fifth failure shape, and #61's: CLAUDE.md section 5's *wrong layer*. A
 * layer above the store rounds the ride's distance to a whole metre — a change
 * so plausible that it survives review, and one that a naive round trip cannot
 * see. The write succeeds. The row is real, in a real transaction that really
 * commits. A fresh connection reads back a complete, well-formed, parseable
 * signed record with every member present.
 *
 * And its signature no longer verifies, because the claims are no longer the
 * bytes that were signed. **That is the only thing that can detect it**, which
 * is why `assertSignedRecordRoundTrip` verifies rather than compares: a round
 * trip that asked only whether a record came back would pass against this fake,
 * and a record that came back and cannot be verified is worse than one that did
 * not come back at all — it looks like evidence and is not.
 */
export function roundedClaimStoreFactory(): StoreFactory {
  return {
    open(name: string): PersistentStore {
      const real = openActivityStore(name);
      return {
        ...bindStore(real),
        putActivityRecord: async (row: StoredActivityRecord): Promise<ActivityId> =>
          real.putActivityRecord({
            ...row,
            record: {
              ...row.record,
              claims: { ...row.record.claims, distance: Math.round(row.record.claims.distance) },
            },
          }),
      };
    },
    destroy: async (name) => {
      await deleteActivityStore(name);
    },
  };
}

/**
 * A repository that **thins a segment's geometry on its way in**, keeping every
 * other position.
 *
 * The sixth fake, and #64's. It stands for *wrong layer*, like the third and
 * the fifth: a downsampler sitting above the store — the sort of thing added to
 * keep a chart's point count bounded, which `apps/web/src/detail/series.ts`
 * legitimately does for a ride trace — applied to the write path instead of the
 * read path.
 *
 * ⚠️ **Everything a summary comparison would look at survives it.** The write
 * succeeds. The row is real, in a real transaction that really commits. A fresh
 * connection reads back a segment with the right id, the right owner, the right
 * name, the right sport, the right visibility, the right `createdAt`, the right
 * `distance` — because the distance is a stored field and is not recomputed —
 * and the right start and end endpoints, because those are stored separately
 * from the geometry and the first and last positions survive any every-other-one
 * thinning.
 *
 * The only thing wrong with it is the shape of the road, and #64's eighth
 * criterion names exactly that risk: a round trip must assert equality
 * *"including the geometry, which is the field most likely to survive as a
 * stale in-memory object"*. A round trip that compared the summary fields would
 * pass against this fake and certify a corpus of segments whose paths no longer
 * follow the roads they were cut from.
 */
export function thinnedGeometryStoreFactory(): StoreFactory {
  return {
    open(name: string): PersistentStore {
      const real = openActivityStore(name);
      return {
        ...bindStore(real),
        putSegment: async (record: SegmentRecord): Promise<SegmentId> =>
          real.putSegment({
            ...record,
            // Keeps the first and the last, so both endpoints still agree with
            // the geometry and nothing structural looks wrong.
            geometry: record.geometry.filter(
              (_position, index) => index % 2 === 0 || index === record.geometry.length - 1,
            ),
          }),
      };
    },
    destroy: async (name) => {
      await deleteActivityStore(name);
    },
  };
}

/**
 * A repository that **appends efforts instead of replacing an activity's set**.
 *
 * ⚠️ This is the fake for #66's sixth criterion, and it models the failure the
 * criterion names in its own words: *"without this, every app restart inflates
 * every leaderboard"*. Everything else is correct — the efforts are stored,
 * scoped to the right athlete, with the right segment, activity and time, and a
 * round trip that read one effort back and compared its fields would pass.
 * What breaks is only visible when the matcher runs **twice**.
 *
 * ⚠️ **It skips the stale-delete, not the id.** The first version of this fake
 * minted a fresh id per write, on the theory that the derived id was what made
 * re-matching idempotent — and it stayed **green**, because replacing the
 * activity's whole effort set absorbs a changed id: the previous row is deleted
 * for not being in the new set. That was worth finding. The derived id buys
 * *stable identity* across a re-match, which is a different property with its
 * own test; the replace is what buys idempotence. `records.ts` and `schema.ts`
 * now say so, having said the other thing first.
 */
export function appendingEffortStoreFactory(): StoreFactory {
  return {
    open(name: string): PersistentStore {
      const real = openActivityStore(name);
      return {
        ...bindStore(real),
        putActivityEfforts: async (
          owner: AthleteId,
          activityId: ActivityId,
          efforts: readonly SegmentEffortRecord[],
        ): Promise<number> => {
          // Keep what is already there, and add these beside it — which is what
          // "insert the efforts we just found" looks like when written the
          // obvious way round.
          const existing = await real.listActivityEfforts(owner, activityId);
          const merged = [
            ...existing,
            ...efforts.map((effort, index) => ({
              ...effort,
              id: segmentEffortId(`${effort.id}::again-${String(existing.length + index)}`),
            })),
          ];
          return real.putActivityEfforts(owner, activityId, merged);
        },
      };
    },
    destroy: async (name) => {
      await deleteActivityStore(name);
    },
  };
}

function withGapsFilled(channels: StreamChannels): StreamChannels {
  const filled: { -readonly [C in StreamChannel]?: Samples<C> } = {};
  for (const channel of STREAM_CHANNELS) {
    const samples = channels[channel];
    if (samples === undefined) {
      continue;
    }
    // Zero is a value every one of the eight channels admits, which is exactly
    // why substituting it for absent is undetectable downstream.
    (filled as Record<StreamChannel, readonly (number | undefined)[]>)[channel] = samples.map(
      (sample) => sample ?? 0,
    );
  }
  return filled;
}

/**
 * A repository that **loses a route's `loop` flag** on its way in.
 *
 * ⚠️ This is the fake for #89's sixth criterion, and the failure it models is
 * the least structural of the eight: one boolean, in a mapping between a record
 * and a row, written as `false` instead of what the caller passed. Nothing
 * about the stored route is corrupt. Every coordinate, every elevation and
 * every gradient comes back to the last bit; the distance is right; the name is
 * right; the record decodes without a complaint.
 *
 * What breaks is what the rider *does* with it. #89's fifth criterion is that
 * riding past the end of a loop wraps to the start "rather than resetting or
 * stopping" — and a profile whose `loop` is `false` clamps instead, so the ride
 * simply stops accumulating at the end of the first lap with no error anywhere.
 *
 * It is here because a round trip that compared the *arrays* would pass against
 * it: the point of the eighth fake is that a route's most important field is a
 * one-bit one, and a harness calibrated to catch a mangled thousand-point path
 * is not automatically calibrated to catch that.
 */
export function openedLoopStoreFactory(): StoreFactory {
  return {
    open(name: string): PersistentStore {
      const real = openActivityStore(name);
      return {
        ...bindStore(real),
        putRoute: async (record: RouteRecord): Promise<RouteId> =>
          real.putRoute({ ...record, profile: { ...record.profile, loop: false } }),
      };
    },
    destroy: async (name) => {
      await deleteActivityStore(name);
    },
  };
}

/**
 * A repository that **widens a route's visibility to `public`** on its way in.
 *
 * ⚠️ This is the fake for #73's fourth criterion, and it is the most dangerous
 * of the nine because it is the least visible. It is the shape of a real bug:
 * a mapping layer that fills in a field it thinks is missing, and picks the
 * open value because that is the one that makes the feature look like it works.
 *
 * Everything else is right. The name, the profile, the loop flag, every
 * coordinate and every gradient come back exactly as written; the record
 * decodes without a complaint; the list renders. The only difference is a
 * three-character string, and what it means is that a route whose start is the
 * athlete's front door is readable by anyone — which #73 says is not
 * recoverable the way an over-shared activity is, because a route cannot be
 * truncated at the ends and remain a route.
 *
 * `assertRouteRoundTrip` compares `visibility` on its own line for that reason,
 * and deleting that line turns a test red rather than leaving the suite green.
 */
export function publishedRouteStoreFactory(): StoreFactory {
  return {
    open(name: string): PersistentStore {
      const real = openActivityStore(name);
      return {
        ...bindStore(real),
        putRoute: async (record: RouteRecord): Promise<RouteId> =>
          real.putRoute({ ...record, visibility: 'public' }),
      };
    },
    destroy: async (name) => {
      await deleteActivityStore(name);
    },
  };
}

/**
 * A repository that **drops a workout's last block on its way in**.
 *
 * The shape this one models is the same as `thinnedGeometryStoreFactory`'s and
 * the reason it is a separate fake is that nothing about a workout is
 * geometry: what is lost is a *block*, and a workout is short enough that
 * losing one is not a rounding error. It survives every check a careless round
 * trip makes. The record decodes — a workout missing its last block is still a
 * valid workout, so `validateWorkout` passes it. The name, the id, the owner
 * and the timestamps are all correct. The list renders. A rider opens their
 * hour-long session and it is fifty-three minutes long.
 *
 * ⚠️ **The failure it stands in for is the reason `PersistedWorkout` stores
 * blocks rather than a timeline.** A store that persisted an expansion would
 * have exactly this bug available to it in a form nothing could see: a
 * timeline that lost a segment is still a timeline, and there is no second
 * copy to disagree with. Blocks in the row and expansion on the way out means
 * the round trip compares what was written.
 *
 * `assertWorkoutRoundTrip` compares the block count on its own line for that
 * reason, and deleting that line turns a test red rather than leaving the
 * suite green.
 */
export function truncatedWorkoutStoreFactory(): StoreFactory {
  return {
    open(name: string): PersistentStore {
      const real = openActivityStore(name);
      return {
        ...bindStore(real),
        putWorkout: async (record: WorkoutRecord): Promise<WorkoutId> =>
          real.putWorkout({
            ...record,
            workout: {
              ...record.workout,
              // `slice(0, -1)` on a one-block workout would leave an empty one,
              // which `validateWorkout` refuses — so the fake would be caught by
              // the decoder rather than by the comparison, which is a weaker
              // proof. Keeping at least one block means it is the assertion that
              // has to notice.
              blocks:
                record.workout.blocks.length > 1
                  ? record.workout.blocks.slice(0, -1)
                  : record.workout.blocks,
            },
          }),
      };
    },
    destroy: async (name) => {
      await deleteActivityStore(name);
    },
  };
}

/**
 * A repository whose **ghost lookup matches on the route and ignores the
 * rider**.
 *
 * The eleventh fake, and the first that breaks a *read*. Every write path is the
 * real one, every row lands in the real database, every round trip over a ride,
 * a stream or a route passes — because nothing about the write is wrong. What is
 * wrong is one missing component in one query, and the only thing that can see
 * it is an assertion that puts a **second athlete's** ride on the same route and
 * checks it is absent.
 *
 * #93's fifth acceptance criterion states the failure this stands for:
 *
 * > *"a lookup matching on route alone would happily return someone else's ride,
 * > and it would pass every single-rider test in the suite."*
 *
 * That last clause is why this fake exists rather than a comment. With one
 * athlete in the fixture the correct query and this one return identical
 * results, so a suite that seeds one athlete certifies the bug. The harness
 * fixtures carry three athletes for exactly this shape of reason — see
 * CLAUDE.md section 5 — and `activity-store.ghost-scope.test.ts` is where the
 * red/green pair lives.
 *
 * ⚠️ It reproduces the bug by **filtering the real result less**, not by
 * fabricating rows: it asks the real store for each athlete's attempts and
 * concatenates them, which is what an index on `routeId` alone would have
 * returned. A fake that invented a row would prove the assertion can see an
 * invented row, which is not the claim.
 */
export function unscopedAttemptStoreFactory(): StoreFactory {
  return {
    open(name: string): PersistentStore {
      const real = openActivityStore(name);
      const raw = new Dexie(name);
      SCHEMA_VERSIONS.forEach((stores, index) => {
        raw.version(index + 1).stores(stores);
      });
      const activities = raw.table<PersistedActivity, string>(TABLE.activities);
      return {
        ...bindStore(real),
        close: () => {
          real.close();
          raw.close();
        },
        listRouteAttempts: async (
          _owner: AthleteId,
          route: RouteId,
          limit: number = 10,
        ): Promise<readonly ActivityRecord[]> => {
          // The bug, written out: `routeId` and no athlete. This is what the
          // shipping query would do if `INDEX.activityByAthleteAndRoute` were
          // declared as `'routeId'` and `.equals([owner, route])` became
          // `.equals(route)` — a two-character change in `activity-store.ts`.
          const rows = await activities
            .filter((row) => row.routeId === route)
            .reverse()
            .limit(limit)
            .toArray();
          return rows.map(fromPersistedActivity);
        },
      };
    },
    destroy: async (name) => {
      await deleteActivityStore(name);
    },
  };
}

/**
 * A repository whose **unit preference is computed, returned, and never
 * written**.
 *
 * The twelfth fake, for #238's narrow athlete write. It is the purest form of
 * the shape CLAUDE.md section 5 names: `setAthleteUnits` answers with exactly
 * the row a correct implementation would have answered with — same id, same
 * name, same `createdAt`, `units` set to what was asked for — and the database
 * is untouched. Every caller that trusts the return value is satisfied. Only a
 * read on a connection that did not write can tell, which is the whole of what
 * the #28 harness is for.
 *
 * ⚠️ **The return is not `undefined`.** That matters: `undefined` is this
 * method's honest answer for *"there is no such athlete"*, and a fake returning
 * it would be caught by any caller branching on the return — which
 * `apps/web/src/views/SettingsView.tsx` now does. The interesting failure is
 * the one that looks exactly like success, so this one hands back a record.
 *
 * The red/green pair is in `activity-store.units.test.ts` rather than in
 * `harness.test.ts`, for the reason `roundedClaimStoreFactory`'s lives in
 * `identity-store.test.ts`: the assertion belongs beside the property it is
 * about.
 */
export function staleUnitsStoreFactory(): StoreFactory {
  return {
    open(name: string): PersistentStore {
      const real = openActivityStore(name);
      return {
        ...bindStore(real),
        setAthleteUnits: async (id: AthleteId, units: UnitSystem) => {
          // Reads the real row, so a missing athlete is still reported as one —
          // the fake breaks the write, not the lookup.
          const existing = await real.getAthlete(id);
          return existing === undefined ? undefined : { ...existing, units };
        },
      };
    },
    destroy: async (name) => {
      await deleteActivityStore(name);
    },
  };
}

/**
 * A repository that **rounds the athlete's mass to a whole kilogram** on its
 * way in, and persists it.
 *
 * The thirteenth fake, for #325's narrow athlete write, and it is deliberately
 * **not** another `staleUnitsStoreFactory`. That one stands for a write that
 * never lands; this one lands. The row is really written, a fresh connection
 * really reads it back, `getAthlete` really answers with a mass — and it is not
 * the mass the rider entered.
 *
 * ⚠️ **Which is why the assertion it calibrates has to be about the value and
 * not about presence.** A rider who typed 154 lb has 69.853 kg stored; rounded
 * to 70 it reads back as 154.3 lb, which is plausible, is beside the box they
 * typed into, and is wrong. `toBeDefined()` would pass against this store, and
 * so would any assertion that compared the read to the *rounded* figure — which
 * is what a test written after the fact, against the rounding, would do.
 *
 * A whole kilogram is chosen over a coarser tidy for the same reason: the
 * failure this stands for is a formatter or a form reaching one layer too far
 * down, and those round to something that still looks like an answer.
 *
 * The red/green pair is in `activity-store.mass.test.ts`, beside the property
 * it is about, for `staleUnitsStoreFactory`'s reason.
 */
export function roundedMassStoreFactory(): StoreFactory {
  return {
    open(name: string): PersistentStore {
      const real = openActivityStore(name);
      return {
        ...bindStore(real),
        setAthleteMass: async (id: AthleteId, mass: Kilograms | undefined) =>
          // Clearing is left alone: the defect this stands for is a tidy
          // applied to a number, and there is no number to tidy.
          real.setAthleteMass(id, mass === undefined ? undefined : kilograms(Math.round(mass))),
      };
    },
    destroy: async (name) => {
      await deleteActivityStore(name);
    },
  };
}

/**
 * A repository that **writes the kit colour where the reader does not look**.
 *
 * The eighteenth fake, for #623's narrow athlete write, and it is
 * `misroutedBlobStoreFactory`'s shape rather than `staleUnitsStoreFactory`'s:
 * the write really happens, to the real athlete row, inside a real
 * transaction that really commits — under `kitColor`, a key
 * `fromPersistedAthlete` never reads. A spelling is exactly how that happens
 * to a field named in two dialects. The call answers with the record a correct
 * implementation would have answered with, so every caller trusting the return
 * is satisfied; a fresh connection reads a row with no choice on it, which the
 * client draws as the house kit.
 *
 * ⚠️ **Which is why the assertion it calibrates must not accept the house
 * colour as a pass.** The round trip that reads it back has to choose an entry
 * that is NOT the default, or the misfiled write and a correct one read alike.
 *
 * The red/green pair is in `activity-store.kit-colour.test.ts`, beside the
 * property it is about, for `staleUnitsStoreFactory`'s reason.
 */
export function misfiledKitColourStoreFactory(): StoreFactory {
  return {
    open(name: string): PersistentStore {
      const real = openActivityStore(name);
      const raw = new Dexie(name);
      SCHEMA_VERSIONS.forEach((stores, index) => {
        raw.version(index + 1).stores(stores);
      });
      const athletes = raw.table<PersistedAthlete & { kitColor?: string }, string>(TABLE.athletes);
      return {
        ...bindStore(real),
        close: () => {
          real.close();
          raw.close();
        },
        setAthleteKitColour: async (id: AthleteId, kitColour: KitColour) => {
          const existing = await real.getAthlete(id);
          if (existing === undefined) {
            return undefined;
          }
          await raw.transaction('rw', athletes, async () => {
            const row = await athletes.get(id);
            if (row !== undefined) {
              await athletes.put({ ...row, kitColor: kitColour });
            }
          });
          return { ...existing, kitColour };
        },
      };
    },
    destroy: async (name) => {
      await deleteActivityStore(name);
    },
  };
}

/**
 * A repository whose masked-word write **drops the last entry on its way in**
 * — the twenty-first fake, for #839.
 *
 * *Wrong layer*: the write is real, to the real row, in a transaction that
 * commits, and the call answers with the list the rider saved — so the screen
 * says "Saved" and shows every word. What lands is one short, and the word
 * missing is the one the rider added last: exactly the entry they were
 * thinking about, now sent to a hosted model in the clear.
 *
 * ⚠️ **Why the round trip must compare the whole list.** A read that checked
 * only that a list came back, or only its first entry, passes against this.
 * The red/green pair is in `activity-store.masked-words.test.ts`.
 */
export function lastWordDroppedStoreFactory(): StoreFactory {
  return {
    open(name: string): PersistentStore {
      const real = openActivityStore(name);
      return {
        ...bindStore(real),
        setAthleteMaskedWords: async (id: AthleteId, words: readonly string[]) => {
          const written = await real.setAthleteMaskedWords(id, words.slice(0, -1));
          return written === undefined ? undefined : { ...written, maskedWords: [...words] };
        },
      };
    },
    destroy: async (name) => {
      await deleteActivityStore(name);
    },
  };
}

/**
 * A repository that **reports an erase as complete and leaves the rows behind**.
 *
 * The fourteenth fake, for #384's kept camera frames, and it is the one whose
 * failure mode this repository has never modelled before: `deleteCameraFrames`
 * returns a **true** count — it really counts what it would have removed — and
 * removes nothing. Every signal a caller has says it worked.
 *
 * ⚠️ **What it stands for is the worst version of this bug the app could
 * ship.** #384: *"The counterpart here is worse than a lost setting: a frame
 * the rider believes was erased, and was not."* And every cheap assertion
 * passes against it:
 *
 * - the return value is right, so `expect(removed).toBe(2)` passes;
 * - `eraseSentence` says "Removed 2 pictures", so a UI test passes;
 * - a read **through the same handle** inside the same transaction scope would
 *   be tempting to write and would still find the rows, so even a naive
 *   read-back would fail *loudly* rather than silently — which is why the
 *   assertion that catches it has to discard every connection first.
 *
 * Only a round trip that closes the writer, opens a fresh connection and reads
 * through the public path notices. That is CLAUDE.md §5's *wrong time* and
 * *wrong layer* causes in one store, and `camera-frame-store.test.ts` is the
 * red/green pair — beside the property it is about, for
 * `roundedClaimStoreFactory`'s reason.
 */
export function survivingFrameStoreFactory(): StoreFactory {
  return {
    open(name: string): PersistentStore {
      const real = openActivityStore(name);
      return {
        ...bindStore(real),
        deleteCameraFrames: async (owner: AthleteId): Promise<number> =>
          // The count is honest and the delete never happens. A fake that
          // returned zero would be caught by the return value alone, which is
          // a weaker proof: what is being calibrated is the *round trip*, not
          // the arithmetic.
          real.countCameraFrames(owner),
      };
    },
    destroy: async (name) => {
      await deleteActivityStore(name);
    },
  };
}

/**
 * A repository whose framing-reference put **keeps the row already there**.
 *
 * The fifteenth fake, for #528. The owner's ruling is a reference *"from the
 * rider's last session"*, and this store answers every put with success and
 * goes on holding the FIRST reference it was ever given — so the framing check
 * compares every later session with a placement the rider abandoned long ago,
 * and says so with complete confidence.
 *
 * Every cheap assertion passes against it: the put resolves, a read returns a
 * well-formed reference with the right athlete and the right number of
 * landmarks, and a single-session test is indistinguishable from the real
 * store. Only a round trip that writes TWO references and compares the one that
 * comes back with the second notices — which is what
 * `assertFramingReferenceRoundTrip` does when it is handed a store that already
 * holds one. `framing-reference-store.test.ts` is the red/green pair.
 */
export function firstReferenceStoreFactory(): StoreFactory {
  return {
    open(name: string): PersistentStore {
      const real = openActivityStore(name);
      return {
        ...bindStore(real),
        putFramingReference: async (record: FramingReferenceRecord): Promise<void> => {
          if ((await real.getFramingReference(record.athleteId)) !== undefined) {
            // Reported as success, and nothing is written.
            return;
          }
          await real.putFramingReference(record);
        },
      };
    },
    destroy: async (name) => {
      await deleteActivityStore(name);
    },
  };
}

/**
 * A repository whose framing-reference put **drops whether the check passed**.
 *
 * The sixteenth fake, for #530 and ADR 0033 D-7's *"whether the check passed
 * is stored with the session's numbers"*. It stands for a layer above the
 * store that rebuilt the record from the fields it knew about — `athleteId`,
 * `aspect` and `landmarks` — which is exactly how `setAthleteThresholds` once
 * erased `mass` (README §"A narrow write must be built from the row it read").
 *
 * Every number comes back exact, the put resolves, and the row is there: a
 * round trip that compares only the placement is green against it. What is
 * lost is the one field that decides whether a report may compare this
 * session with another, and its absence reads as "not recorded" — which fails
 * closed, so the rider is silently denied every cross-session sentence.
 * `assertFramingReferenceRoundTrip` compares `check` on its own line for that
 * reason; `framing-reference-store.test.ts` is the red/green pair.
 */
export function verdictlessReferenceStoreFactory(): StoreFactory {
  return {
    open(name: string): PersistentStore {
      const real = openActivityStore(name);
      return {
        ...bindStore(real),
        putFramingReference: async (record: FramingReferenceRecord): Promise<void> =>
          real.putFramingReference({
            athleteId: record.athleteId,
            aspect: record.aspect,
            landmarks: record.landmarks,
          }),
      };
    },
    destroy: async (name) => {
      await deleteActivityStore(name);
    },
  };
}

/**
 * A repository whose side-camera report put **drops the last observation**.
 *
 * The seventeenth fake, for #388's write path. It stands for a layer above
 * the store that trimmed a list on its way in — a `slice(0, -1)` meant to drop
 * a trailing blank, a bound applied one short. Every write succeeds, the row
 * is there, the summary is exact and the list is well-formed: a round trip
 * that checked only that a report came back for the ride is green against it.
 * What the rider loses is a sentence about their own ride, silently.
 * `assertSideCameraReportRoundTrip` compares the observations one by one and
 * their count; `side-camera-report-store.test.ts` is the red/green pair.
 */
export function lastSentenceDroppedReportStoreFactory(): StoreFactory {
  return {
    open(name: string): PersistentStore {
      const real = openActivityStore(name);
      return {
        ...bindStore(real),
        putSideCameraReport: async (record: SideCameraReportRecord): Promise<void> =>
          real.putSideCameraReport({
            ...record,
            observations: record.observations.slice(0, -1),
          }),
      };
    },
    destroy: async (name) => {
      await deleteActivityStore(name);
    },
  };
}

/**
 * A repository whose side-camera report put **drops the pose summary**.
 *
 * The eighteenth fake, for #800's pose summary. It stands for a layer above
 * the store that rebuilt the report from the fields it knew before version 13
 * — `summary` and `observations` — and answered the new required field with
 * `null`, the value every report written before version 13 legitimately has.
 * Every write succeeds, every sentence comes back exact, and the row reads as
 * "no pose summary kept", which is a real state: only a round trip that
 * compares the summary itself notices the rider's numbers are gone.
 * `assertSideCameraReportRoundTrip` compares `pose` field by field;
 * `ride-write-up-store.test.ts` is the red/green pair.
 */
export function poselessReportStoreFactory(): StoreFactory {
  return {
    open(name: string): PersistentStore {
      const real = openActivityStore(name);
      return {
        ...bindStore(real),
        putSideCameraReport: async (record: SideCameraReportRecord): Promise<void> =>
          real.putSideCameraReport({
            athleteId: record.athleteId,
            activityId: record.activityId,
            summary: record.summary,
            observations: record.observations,
            pose: null,
          }),
      };
    },
    destroy: async (name) => {
      await deleteActivityStore(name);
    },
  };
}

/**
 * A repository whose write-up put **acknowledges a second write-up and keeps
 * the first**.
 *
 * The nineteenth fake, for #800's write path and CLAUDE.md §5's *wrong time*:
 * the owner's ruling 7 on #795 is that a new analysis replaces the saved one,
 * and this store answers the new one with success and goes on holding the old
 * — so the ride page shows last week's words under today's press, with the
 * right ride, the right athlete and well-formed text. A single-write test is
 * indistinguishable from the real store. Only a round trip that writes TWO
 * write-ups and compares what comes back with the second notices, which is
 * what `assertRideWriteUpRoundTrip` does on a harness that already holds one.
 * `ride-write-up-store.test.ts` is the red/green pair.
 */
export function firstWriteUpStoreFactory(): StoreFactory {
  return {
    open(name: string): PersistentStore {
      const real = openActivityStore(name);
      return {
        ...bindStore(real),
        putRideWriteUp: async (record: RideWriteUpRecord): Promise<void> => {
          if ((await real.getRideWriteUp(record.athleteId, record.activityId)) !== undefined) {
            // Reported as success, and nothing is written.
            return;
          }
          await real.putRideWriteUp(record);
        },
      };
    },
    destroy: async (name) => {
      await deleteActivityStore(name);
    },
  };
}

/**
 * A repository whose ride delete **takes the ride's sync base with it**.
 *
 * The twentieth fake, for #776's sync base and #893's review (B1). It stands
 * for the tidy-minded cascade a reader of `deleteActivity` would add: "a row
 * about a ride that is gone is an orphan, delete it too". Every write
 * succeeds, every base row reads back while its ride exists — and the one
 * thing the base is FOR, remembering that this device deleted a synced ride,
 * is gone at the moment it matters, so the next sync pulls the ride back.
 * `assertSyncBaseRoundTrip` deletes the ride between the write and the read;
 * `sync-base-store.test.ts` is the red/green pair.
 */
export function cascadingSyncBaseStoreFactory(): StoreFactory {
  return {
    open(name: string): PersistentStore {
      const real = openActivityStore(name);
      return {
        ...bindStore(real),
        deleteActivity: async (owner, id) => {
          for (const row of await real.listSyncBase(owner)) {
            if (row.activityId === id) await real.deleteSyncBase(owner, row.kind, row.key);
          }
          return real.deleteActivity(owner, id);
        },
      };
    },
    destroy: async (name) => {
      await deleteActivityStore(name);
    },
  };
}
