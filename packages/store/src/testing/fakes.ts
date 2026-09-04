// SPDX-License-Identifier: Apache-2.0

/**
 * Deliberately broken stores, for proving the harness can fail.
 *
 * #28: *"The harness is proved to work by deliberately breaking persistence and
 * observing the test go red. A harness that passes against a no-op write is
 * worthless, and this is the only way to know it does not."*
 *
 * There are **two** fakes here, and there are two on purpose: a harness that
 * catches one failure shape is calibrated to that shape. They stand for two of
 * the four causes CLAUDE.md section 5 names, and they fail for different
 * reasons at different points in the read.
 *
 * | Fake | Cause it stands for | How the round trip notices |
 * |---|---|---|
 * | `memoryWriteStoreFactory` | *wrong storage* — the write went to memory | the read finds no set at all |
 * | `misroutedBlobStoreFactory` | *wrong storage* — the right store, a key prefix the reader does not use | the set is there and claims eight channels whose bytes are gone |
 * | `gapFillingStoreFactory` | *wrong layer* — a layer above the store rewrote the data on its way in | the set comes back whole, and a gap has become a zero |
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

import { openActivityStore, deleteActivityStore, type ActivityStore } from '../activity-store';
import type { ActivityId } from '../ids';
import { SCHEMA_VERSIONS, TABLE } from '../schema';
import type { PersistedStreamBlob } from '../stream-persisted';
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
    getAthlete: async (id) => real.getAthlete(id),
    deleteAthlete: async (id) => real.deleteAthlete(id),
    putActivity: async (record) => real.putActivity(record),
    getActivity: async (owner, id) => real.getActivity(owner, id),
    listActivitySummaries: async (owner, options) => real.listActivitySummaries(owner, options),
    findActivityByOriginalFileHash: async (owner, sha256) =>
      real.findActivityByOriginalFileHash(owner, sha256),
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
