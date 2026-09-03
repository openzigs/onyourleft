// SPDX-License-Identifier: Apache-2.0

/**
 * A defect found while implementing #26, and the guard against it.
 *
 * ADR 0005 section F rests on a fact about the engine: *IndexedDB has no
 * downgrade event.* `onupgradeneeded` fires only when the version increases,
 * and opening at a lower version raises `VersionError`. The first test here
 * verifies that against the real engine rather than repeating it.
 *
 * The second test is the finding. **Dexie 4.4.5 does not pass that refusal
 * on.** A `Dexie` instance declaring version 1, opened against a database Dexie
 * itself left at version 2, opens successfully and reports `verno === 1` while
 * the backing `IDBDatabase` is still at the newer version. Nothing throws,
 * nothing warns, and the old build then reads the new build's records.
 *
 * That is this program's dominant defect shape wearing the other face: the
 * operation reports success while what is read is not what the caller thinks.
 * On a device where the ride file may be the only copy in existence it is worth
 * failing loudly, so `ActivityStore` checks the backing database's version on
 * open and throws `StoreVersionError`.
 *
 * The third test pins the assumption the guard is built on — Dexie's ×10
 * version encoding — so a future Dexie that changes it makes this file red
 * rather than making the guard silently unreachable.
 */

import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { deleteActivityStore, openActivityStore } from './index';
import { StoreVersionError } from './errors';
import { DEXIE_IDB_VERSION_MULTIPLIER, SCHEMA_VERSION, STORES_V1 } from './schema';

let databaseName: string;

beforeEach(() => {
  databaseName = `oyl-version-${String(Date.now())}-${String(Math.random()).slice(2)}`;
});

afterEach(async () => {
  await deleteActivityStore(databaseName);
});

/** Leaves a database on disk one schema version ahead of this build. */
async function writeFutureDatabase(): Promise<void> {
  const future = new Dexie(databaseName);
  future.version(SCHEMA_VERSION).stores(STORES_V1);
  future.version(SCHEMA_VERSION + 1).stores(STORES_V1);
  await future.open();
  future.close();
}

describe('the engine', () => {
  it('refuses a raw downgrade with VersionError', async () => {
    await writeFutureDatabase();

    const outcome = await new Promise<string>((resolve) => {
      const request = indexedDB.open(databaseName, SCHEMA_VERSION * DEXIE_IDB_VERSION_MULTIPLIER);
      request.onsuccess = (): void => {
        request.result.close();
        resolve('opened');
      };
      request.onerror = (): void => {
        resolve(request.error?.name ?? 'unknown error');
      };
    });

    expect(outcome).toBe('VersionError');
  });
});

describe('Dexie 4.4.5 does not pass that refusal on', () => {
  it('opens a newer database at an older declared version, reporting the older one', async () => {
    await writeFutureDatabase();

    const unguarded = new Dexie(databaseName);
    unguarded.version(SCHEMA_VERSION).stores(STORES_V1);
    await unguarded.open();

    // Both assertions matter. The first is the silent success; the second is
    // what makes it dangerous — the schema on disk is not the one this handle
    // believes it opened.
    expect(unguarded.verno).toBe(SCHEMA_VERSION);
    expect(unguarded.backendDB().version).toBe((SCHEMA_VERSION + 1) * DEXIE_IDB_VERSION_MULTIPLIER);
    unguarded.close();
  });
});

describe('ActivityStore guards against it', () => {
  it('refuses to open a database written by a newer build', async () => {
    await writeFutureDatabase();
    const store = openActivityStore(databaseName);

    await expect(store.open()).rejects.toBeInstanceOf(StoreVersionError);
    store.close();
  });

  it('refuses on a lazy open too, not only an explicit one', async () => {
    await writeFutureDatabase();
    const store = openActivityStore(databaseName);

    // No `open()` call: the first query is what triggers the open, and an
    // application that never calls `open()` must not slip past the guard.
    //
    // The rejection arrives wrapped. Dexie reports a failed lazy open as its
    // own `DatabaseClosedError` and hangs the cause on `.inner` rather than on
    // the standard `cause`, so a consumer that catches by class sees a Dexie
    // error. That is the reason `open()` is documented as the entry point to
    // call at startup: on the explicit path the `StoreVersionError` arrives
    // unwrapped, where an application can explain it.
    const rejection: unknown = await store.getAthlete('anyone' as never).catch((e: unknown) => e);
    const wrapped = rejection as { name?: string; inner?: unknown };

    expect(wrapped.name).toBe('DatabaseClosedError');
    expect(wrapped.inner).toBeInstanceOf(StoreVersionError);
    store.close();
  });

  it('opens a database at its own version without complaint', async () => {
    const store = openActivityStore(databaseName);
    await expect(store.open()).resolves.toBeUndefined();
    store.close();
  });
});

describe('the assumption the guard rests on', () => {
  it('Dexie writes an IndexedDB version of ten times its schema version', async () => {
    const store = openActivityStore(databaseName);
    await store.open();
    store.close();

    const raw = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onsuccess = (): void => {
        resolve(request.result);
      };
      request.onerror = (): void => {
        reject(request.error ?? new Error('open failed'));
      };
    });
    const version = raw.version;
    raw.close();

    expect(version).toBe(SCHEMA_VERSION * DEXIE_IDB_VERSION_MULTIPLIER);
  });
});
