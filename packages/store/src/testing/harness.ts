// SPDX-License-Identifier: Apache-2.0

/**
 * The round-trip persistence harness — #28.
 *
 * ## What it is for
 *
 * The dominant defect in this program's persistence work is **a write that
 * reports success while the read cannot see it**, and it has four causes
 * (CLAUDE.md section 5): *wrong storage*, *wrong layer*, *wrong time* and
 * *wrong harness*. The fourth makes the other three invisible, because the
 * natural way to write the test — assert against the object you just
 * constructed, or read back through the connection that did the writing —
 * passes even when nothing was persisted at all.
 *
 * This module supplies the primitive that closes all four at once:
 *
 * > **write through the public path → close every connection → open a fresh
 * > one → read through the public path → compare.**
 *
 * ## The property that makes it work
 *
 * `read()` **cannot** be served by the writing handle. It closes every handle
 * this harness has opened before it opens another, so there is no code a caller
 * can write that reads through the connection that wrote. A correct pattern
 * that is harder than the wrong one does not get used; here the correct pattern
 * is the only one available.
 *
 * `connectionsOpened` counts the handles, so a test can assert that the harness
 * itself did what it claims rather than taking this comment's word for it.
 *
 * ## Usage
 *
 * ```ts
 * const harness = createStoreHarness();
 * await seedAthletes(harness);                  // three athletes, see fixtures.ts
 * await harness.write(async (store) => store.putActivity(ride));
 * const read = await harness.read(async (store) => store.getActivity(owner, ride.id));
 * await harness.destroy();                      // in afterEach
 * ```
 *
 * or, for the whole round trip in one call:
 *
 * ```ts
 * const read = await harness.roundTrip(
 *   async (store) => store.putStreamSet(set),
 *   async (store) => store.getStreamSet(owner, set.activityId),
 * );
 * ```
 *
 * ## What it deliberately does not do
 *
 * It does not assert. `round-trip.ts` holds the comparisons, as plain functions
 * that throw, so the same assertion body runs green against the real store and
 * red against the fakes in `fakes.ts` — which is the evidence #28 asks for and
 * the only thing that distinguishes a harness from a habit.
 */

import { deleteActivityStore, openActivityStore } from '../activity-store';

import type { PersistentStore, StoreFactory } from './store';

/**
 * The real thing: `ActivityStore` over IndexedDB.
 *
 * The default, so a test that names no factory is testing the engine it ships
 * on. Every fake is opt-in and every one of them lives in `fakes.ts` beside a
 * comment saying which defect it stands for.
 */
export const indexedDbStoreFactory: StoreFactory = {
  open: (name) => openActivityStore(name),
  destroy: async (name) => {
    await deleteActivityStore(name);
  },
};

/** @see createStoreHarness */
export interface StoreHarnessOptions {
  /** Defaults to `indexedDbStoreFactory`. A fake here is how the harness is proved. */
  readonly factory?: StoreFactory;
  /**
   * The database name. Defaults to a fresh unique one per harness, so two
   * tests in the same file cannot see each other's rows.
   */
  readonly databaseName?: string;
}

/** @see createStoreHarness */
export interface StoreHarness {
  readonly databaseName: string;
  /**
   * How many connections this harness has opened.
   *
   * Exposed so a test can assert the round trip really did open a second one.
   * A harness whose own contract is unasserted is the thing #28 exists to
   * prevent, one level up.
   */
  readonly connectionsOpened: number;
  /** Runs `work` against a handle. Opens one if there is none open. */
  write<T>(work: (store: PersistentStore) => Promise<T>): Promise<T>;
  /**
   * Discards every open handle, opens a **fresh** one, and runs `work` against
   * it. This is the primitive: there is no way to read through the writer.
   */
  read<T>(work: (store: PersistentStore) => Promise<T>): Promise<T>;
  /** `write` then `read`, for the common shape. */
  roundTrip<T>(
    write: (store: PersistentStore) => Promise<unknown>,
    read: (store: PersistentStore) => Promise<T>,
  ): Promise<T>;
  /** Closes every handle without deleting anything. What `read` does first. */
  discard(): Promise<void>;
  /** Closes every handle and removes the database. Call this in `afterEach`. */
  destroy(): Promise<void>;
}

let harnessCounter = 0;

/** A database name no other harness will use. */
function uniqueDatabaseName(): string {
  harnessCounter += 1;
  return `oyl-harness-${String(Date.now())}-${String(harnessCounter)}-${String(Math.random()).slice(2)}`;
}

export function createStoreHarness(options: StoreHarnessOptions = {}): StoreHarness {
  const factory = options.factory ?? indexedDbStoreFactory;
  const databaseName = options.databaseName ?? uniqueDatabaseName();

  let handles: PersistentStore[] = [];
  let current: PersistentStore | undefined;
  let connectionsOpened = 0;

  function handle(): PersistentStore {
    if (current === undefined) {
      current = factory.open(databaseName);
      handles.push(current);
      connectionsOpened += 1;
    }
    return current;
  }

  async function discard(): Promise<void> {
    for (const open of handles) {
      open.close();
    }
    handles = [];
    current = undefined;
    // `await` on nothing, so `discard` is a promise even though closing a Dexie
    // handle is synchronous. A caller must be able to write `await
    // harness.discard()` without knowing which it is, and a later factory whose
    // close is asynchronous must not change this signature.
    await Promise.resolve();
  }

  return {
    databaseName,
    get connectionsOpened(): number {
      return connectionsOpened;
    },
    async write<T>(work: (store: PersistentStore) => Promise<T>): Promise<T> {
      return work(handle());
    },
    async read<T>(work: (store: PersistentStore) => Promise<T>): Promise<T> {
      await discard();
      return work(handle());
    },
    async roundTrip<T>(
      write: (store: PersistentStore) => Promise<unknown>,
      read: (store: PersistentStore) => Promise<T>,
    ): Promise<T> {
      await write(handle());
      await discard();
      return read(handle());
    },
    discard,
    async destroy(): Promise<void> {
      await discard();
      await factory.destroy(databaseName);
    },
  };
}
