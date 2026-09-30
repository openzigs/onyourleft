// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Two-way sync end to end (#776): the REAL instance — its handler behind its
 * Node listener, its identity, its SQLite file and its blob store — and two
 * devices, each with its own IndexedDB through the real `packages/store`.
 *
 * Device A imports three rides and a model write-up, signs in and syncs. A
 * fresh device B — a new database, added to A's athlete with a link code
 * (#773) — syncs, and then, after a RELOAD (every connection to its database
 * closed and a new one opened), reads the rides through the ride library's own
 * read: the arguments `ActivitiesView` passes, and `library/rows.ts`. That is
 * "a write that reports success while the read cannot see it", closed from
 * both ends.
 *
 * The instance is imported by a computed path, as `browser/identity.browser.
 * spec.ts` does: `apps/instance` is written for Node's type stripping (`.ts`
 * specifiers), which `apps/web`'s typecheck does not follow, so the shape it
 * is used through is written down here.
 */

import { fileURLToPath } from 'node:url';

import { kilograms, toHex, unixSeconds, type ActivityClaims } from '@onyourleft/domain';
import {
  activityId as toActivityId,
  ensureDeviceSigningKey,
  webCryptoSha256,
  webCryptoVerifier,
  type ActivityId,
} from '@onyourleft/store';
import {
  createStoreHarness,
  rideWriteUpFor,
  sideCameraReportFor,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { orderedRows, PAGE_SIZE } from '../library/rows';
import type { RideInputStore } from '../ride-analysis/read-input';
import { rideSummaryOf } from '../ride-analysis/ride-summary';
import { ensureLocalAthlete, LOCAL_ATHLETE } from '../local-athlete';
import { importActivityFiles } from '../transfer/import-batch';
import { linkThisDevice, signInToInstance, type InstanceTransport } from './sign-in';
import { syncWithInstance, type SyncDependencies, type SyncTransport } from './sync';

interface TestDevice {
  readonly publicKey: string;
}

interface IdentityInstance {
  readonly url: string;
  /** The instance's database file, for a read on a store the instance never touched. */
  readonly path: string;
  readonly blobs: Map<string, Uint8Array>;
  close(): Promise<void>;
}

interface InstanceTesting {
  readonly TEST_ORIGIN: string;
  startIdentityInstance(options?: { bodyLimitBytes?: number }): Promise<IdentityInstance>;
  testDevice(): Promise<TestDevice>;
}

interface SyncTesting {
  corpusFile(name: string): Uint8Array;
}

/** The part of the instance's store #793's test reads: what it would serve as raceable. */
interface InstanceStoreModule {
  openSqlStore(path: string): Promise<{
    listRaceableActivities(
      requester: string,
      limit: number,
    ): Promise<readonly { readonly athleteId: string; readonly contentSha256: string }[]>;
    close(): Promise<void>;
  }>;
}

const INSTANCE = (path: string): string =>
  fileURLToPath(new URL(`../../../instance/src/${path}`, import.meta.url));

let instanceTesting: InstanceTesting;
let syncTesting: SyncTesting;
let instanceStore: InstanceStoreModule;
beforeAll(async () => {
  instanceTesting = (await import(INSTANCE('auth/identity-testing.ts'))) as InstanceTesting;
  syncTesting = (await import(INSTANCE('sync/sync-testing.ts'))) as SyncTesting;
  instanceStore = (await import(INSTANCE('store/open-sql-store.ts'))) as InstanceStoreModule;
});

/**
 * What the instance would serve as raceable to a rider who is not A — read on
 * a store opened for this read alone, so nothing the instance holds in memory
 * can answer it (#793).
 */
async function raceableOnInstance(path: string): Promise<string[]> {
  const fresh = await instanceStore.openSqlStore(path);
  try {
    return (await fresh.listRaceableActivities('a-stranger', 100)).map(
      (record) => record.contentSha256,
    );
  } finally {
    await fresh.close();
  }
}

let world: IdentityInstance | undefined;
let harnesses: StoreHarness[] = [];
afterEach(async () => {
  await world?.close();
  world = undefined;
  for (const harness of harnesses) await harness.destroy();
  harnesses = [];
});

const NOW = unixSeconds(1_790_000_000);

/** `fetch` against the instance, with this device's session once it has one. */
function transports(url: string) {
  let token: string | undefined;
  const headers = (json: boolean): Record<string, string> => ({
    ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    ...(json ? { 'content-type': 'application/json' } : {}),
  });
  const auth: InstanceTransport = {
    post: async (path, body) => {
      const response = await fetch(`${url}${path}`, {
        method: 'POST',
        headers: headers(true),
        body: JSON.stringify(body),
      });
      return { status: response.status, body: (await response.json()) as unknown };
    },
  };
  const sync: SyncTransport = {
    json: async (method, path, body) => {
      const response = await fetch(`${url}${path}`, {
        method,
        headers: headers(body !== undefined),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      return { status: response.status, body: text === '' ? null : (JSON.parse(text) as unknown) };
    },
    bytes: async (path) => {
      const response = await fetch(`${url}${path}`, { headers: headers(false) });
      return { status: response.status, bytes: new Uint8Array(await response.arrayBuffer()) };
    },
  };
  return {
    auth,
    sync,
    setToken: (value: string) => {
      token = value;
    },
  };
}

interface Device {
  readonly harness: StoreHarness;
  readonly transport: ReturnType<typeof transports>;
  readonly account: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
  };
}

function device(url: string): Device {
  const harness = createStoreHarness();
  harnesses.push(harness);
  const map = new Map<string, string>();
  return {
    harness,
    transport: transports(url),
    account: {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => void map.set(key, value),
    },
  };
}

function signInDependencies(origin: string, on: Device) {
  return {
    origin,
    transport: on.transport.auth,
    storage: on.account,
    ensureLocalAthlete: () => on.harness.write((store) => ensureLocalAthlete(store, NOW)),
    signingKey: () =>
      on.harness.write((store) => ensureDeviceSigningKey(store, LOCAL_ATHLETE, { now: () => NOW })),
    now: () => NOW * 1000,
  };
}

function syncDependencies(on: Device, store: SyncDependencies['store']): SyncDependencies {
  return {
    transport: on.transport.sync,
    store,
    athleteId: LOCAL_ATHLETE,
    signingKey: () => ensureDeviceSigningKey(store as never, LOCAL_ATHLETE, { now: () => NOW }),
    sha256: webCryptoSha256,
    verifier: webCryptoVerifier,
    now: () => NOW,
    timeZone: 'Europe/London',
    // The harness hands the whole ActivityStore, which reads a ride's input.
    rideSummary: rideSummaryOf(store as unknown as RideInputStore, LOCAL_ATHLETE),
  };
}

async function importRides(on: Device, names: readonly string[]): Promise<ActivityId[]> {
  let next = 0;
  await on.harness.write((store) => ensureLocalAthlete(store, NOW));
  const report = await on.harness.write((store) =>
    importActivityFiles({
      sources: names.map((name) => ({
        fileName: name,
        bytes: () => Promise.resolve(syncTesting.corpusFile(name)),
      })),
      store,
      athleteId: LOCAL_ATHLETE,
      newActivityId: () => toActivityId(`ride-${String((next += 1))}`),
      now: () => NOW,
      digest: async (bytes) => toHex(await webCryptoSha256(bytes)),
      timeZone: 'Europe/London',
    }),
  );
  expect(report.imported, JSON.stringify(report.outcomes)).toBe(names.length);
  return report.outcomes.map((outcome) => outcome.activityId as ActivityId);
}

/** The library's own read: the arguments `ActivitiesView` passes, and its row model. */
function libraryRows(harness: StoreHarness) {
  return harness.read(async (store) =>
    orderedRows(
      await store.listActivitySummaries(LOCAL_ATHLETE, {
        orderBy: 'startedAt',
        direction: 'descending',
        limit: PAGE_SIZE,
      }),
      'startedAt',
      'descending',
      'metric',
    ),
  );
}

const RIDES = ['nominal-outdoor-ride.fit', 'paused-laps.fit', 'indoor-trainer-no-position.fit'];

/** A device signed in to the instance, and the sync it runs. */
async function signedInDevice(url: string, origin: string, names: readonly string[]) {
  const on = device(url);
  const ids = await importRides(on, names);
  const signedIn = await signInToInstance(signInDependencies(origin, on));
  on.transport.setToken(signedIn.sessionToken);
  const sync = () => on.harness.write((store) => syncWithInstance(syncDependencies(on, store)));
  return { on, ids, sync };
}

/** A second device, linked to the first's athlete with a code the first minted. */
async function linkedDevice(url: string, origin: string, first: Device) {
  const code = await first.transport.sync.json('POST', '/v1/auth/link-codes');
  const on = device(url);
  const linked = await linkThisDevice(
    signInDependencies(origin, on),
    (code.body as { linkCode: string }).linkCode,
  );
  on.transport.setToken(linked.sessionToken);
  const sync = () => on.harness.write((store) => syncWithInstance(syncDependencies(on, store)));
  return { on, sync };
}

/** The instance's whole manifest, as the device it is asked through sees it. */
async function manifestOf(on: Device) {
  const answer = await on.transport.sync.json('GET', '/v1/sync/manifest?limit=200');
  return (
    answer.body as {
      items: { kind: string; key: string; deleted: boolean; activityId: string | null }[];
    }
  ).items;
}

/** One item as the instance holds it, parsed — or `undefined` where it holds none. */
async function instanceItem(on: Device, kind: string, key: string) {
  const answer = await on.transport.sync.json('GET', `/v1/sync/items/${kind}/${key}`);
  if (answer.status !== 200) return undefined;
  return JSON.parse((answer.body as { body: string }).body) as Record<string, unknown>;
}

describe('two-way sync through the real instance (#776)', () => {
  it('device A pushes three rides and a write-up; a new device B pulls them and reads them in its library after a reload', async () => {
    world = await instanceTesting.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
    const origin = instanceTesting.TEST_ORIGIN;

    const a = device(world.url);
    const ids = await importRides(a, RIDES);
    await a.harness.write((store) => store.putRideWriteUp(rideWriteUpFor(LOCAL_ATHLETE, ids[0]!)));
    await a.harness.write((store) =>
      store.putSideCameraReport(sideCameraReportFor(LOCAL_ATHLETE, ids[1]!)),
    );
    const signedInA = await signInToInstance(signInDependencies(origin, a));
    a.transport.setToken(signedInA.sessionToken);
    const pushed = await a.harness.write((store) => syncWithInstance(syncDependencies(a, store)));
    expect(pushed).toMatchObject({
      pushed: 3,
      itemsPushed: 2,
      summariesPushed: 3,
      pulled: 0,
      failures: [],
    });

    // #835: every ride's summary is on the instance for the rider's history —
    // passages the device built, and nothing that names or places the ride.
    for (const id of ids) {
      const summary = await instanceItem(a, 'ride-summary', id);
      expect(summary?.format).toBe('onyourleft.ride-summary');
      const passages = summary?.passages as string[] | undefined;
      expect(passages?.[0]).toMatch(
        /^A ride of [0-9.]+ minutes of riding over [0-9.]+ kilometres\./,
      );
      const rows = await libraryRows(a.harness);
      for (const row of rows) expect(JSON.stringify(summary)).not.toContain(row.name);
      expect(JSON.stringify(summary)).not.toContain(id);
    }

    // Nothing the second time: every push is answered from the manifest.
    const again = await a.harness.write((store) => syncWithInstance(syncDependencies(a, store)));
    expect(again).toMatchObject({
      pushed: 0,
      itemsPushed: 0,
      summariesPushed: 0,
      pulled: 0,
      failures: [],
    });

    // A fresh device B, linked to A's athlete with a code A minted.
    const code = await a.transport.sync.json('POST', '/v1/auth/link-codes');
    const b = device(world.url);
    const signedInB = await linkThisDevice(
      signInDependencies(origin, b),
      (code.body as { linkCode: string }).linkCode,
    );
    expect(signedInB.instanceAthleteId).toBe(signedInA.instanceAthleteId);
    b.transport.setToken(signedInB.sessionToken);
    const pulled = await b.harness.write((store) => syncWithInstance(syncDependencies(b, store)));
    expect(pulled).toMatchObject({ pulled: 3, itemsPulled: 2, pushed: 0, failures: [] });

    // The reload, and the library's own read.
    const rowsOnA = await libraryRows(a.harness);
    const rowsOnB = await libraryRows(b.harness);
    expect(rowsOnB).toHaveLength(3);
    expect(rowsOnB.map((row) => [row.id, row.name])).toEqual(
      rowsOnA.map((row) => [row.id, row.name]),
    );
    const writeUp = await b.harness.read((store) => store.getRideWriteUp(LOCAL_ATHLETE, ids[0]!));
    expect(writeUp).toEqual(rideWriteUpFor(LOCAL_ATHLETE, ids[0]!));
    const report = await b.harness.read((store) =>
      store.getSideCameraReport(LOCAL_ATHLETE, ids[1]!),
    );
    expect(report).toEqual(sideCameraReportFor(LOCAL_ATHLETE, ids[1]!));

    // And B pushes nothing back: it pulled these, it did not ride them — not
    // even its own reading of their summaries, which is A's to describe
    // (#835), though B's reads differently once B knows the rider's weight.
    expect(pulled).toMatchObject({ summariesPushed: 0 });
    await b.harness.write((store) => store.setAthleteMass(LOCAL_ATHLETE, kilograms(70)));
    const onB = await b.harness.read((store) =>
      rideSummaryOf(store as unknown as RideInputStore, LOCAL_ATHLETE)(ids[0]!),
    );
    expect(onB).not.toBe(JSON.stringify(await instanceItem(a, 'ride-summary', ids[0]!)));
    const bAgain = await b.harness.write((store) => syncWithInstance(syncDependencies(b, store)));
    expect(bAgain).toMatchObject({
      pushed: 0,
      itemsPushed: 0,
      summariesPushed: 0,
      pulled: 0,
      failures: [],
    });
    // …and never signs them: a ride B pulled is not a ride B vouches for.
    for (const id of ids) {
      expect(await b.harness.read((store) => store.getActivityRecord(LOCAL_ATHLETE, id))).toBe(
        undefined,
      );
    }
  }, 60_000);

  it('does not write a pulled ride whose record does not verify, and names the answer it got', async () => {
    world = await instanceTesting.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
    const origin = instanceTesting.TEST_ORIGIN;
    const a = device(world.url);
    await importRides(a, ['nominal-outdoor-ride.fit']);
    const signedIn = await signInToInstance(signInDependencies(origin, a));
    a.transport.setToken(signedIn.sessionToken);
    await a.harness.write((store) => syncWithInstance(syncDependencies(a, store)));

    const code = await a.transport.sync.json('POST', '/v1/auth/link-codes');
    const b = device(world.url);
    const linked = await linkThisDevice(
      signInDependencies(origin, b),
      (code.body as { linkCode: string }).linkCode,
    );
    b.transport.setToken(linked.sessionToken);
    // The instance — or anything between it and the device — alters a claim.
    const honest = b.transport.sync;
    const tampering: SyncTransport = {
      ...honest,
      json: async (method, path, body) => {
        const answer = await honest.json(method, path, body);
        if (!path.startsWith('/v1/sync/records/')) return answer;
        const pulled = answer.body as { record: { claims: ActivityClaims } };
        return {
          ...answer,
          body: {
            ...pulled,
            record: { ...pulled.record, claims: { ...pulled.record.claims, distance: 1 } },
          },
        };
      },
    };
    const report = await b.harness.write((store) =>
      syncWithInstance({ ...syncDependencies(b, store), transport: tampering }),
    );
    expect(report.pulled).toBe(0);
    expect(report.failures).toEqual([
      expect.objectContaining({ kind: 'activity', reason: 'signature-mismatch' }),
    ]);
    expect(await libraryRows(b.harness)).toEqual([]);

    // And a file swapped for another is `content-mismatch`, not a forgery.
    const swapping: SyncTransport = {
      ...honest,
      bytes: () =>
        Promise.resolve({ status: 200, bytes: syncTesting.corpusFile('paused-laps.fit') }),
    };
    const swapped = await b.harness.write((store) =>
      syncWithInstance({ ...syncDependencies(b, store), transport: swapping }),
    );
    expect(swapped.failures).toEqual([
      expect.objectContaining({ kind: 'activity', reason: 'content-mismatch' }),
    ]);
    expect(await libraryRows(b.harness)).toEqual([]);
  }, 60_000);

  it('deletes on this device a ride another device deleted, with its write-up', async () => {
    world = await instanceTesting.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
    const origin = instanceTesting.TEST_ORIGIN;
    const a = device(world.url);
    const [id] = await importRides(a, ['nominal-outdoor-ride.fit']);
    const signedIn = await signInToInstance(signInDependencies(origin, a));
    a.transport.setToken(signedIn.sessionToken);
    await a.harness.write((store) => syncWithInstance(syncDependencies(a, store)));

    const code = await a.transport.sync.json('POST', '/v1/auth/link-codes');
    const b = device(world.url);
    const linked = await linkThisDevice(
      signInDependencies(origin, b),
      (code.body as { linkCode: string }).linkCode,
    );
    b.transport.setToken(linked.sessionToken);
    await b.harness.write((store) => syncWithInstance(syncDependencies(b, store)));
    expect(await libraryRows(b.harness)).toHaveLength(1);

    const record = await a.harness.read((store) => store.getActivityRecord(LOCAL_ATHLETE, id!));
    const content = record!.record.contentHash.slice('sha256:'.length);
    const removed = await a.transport.sync.json('DELETE', `/v1/sync/items/activity/${content}`);
    expect(removed.status).toBe(204);
    const report = await b.harness.write((store) => syncWithInstance(syncDependencies(b, store)));
    expect(report.deleted).toBe(1);
    expect(await libraryRows(b.harness)).toEqual([]);
  }, 60_000);

  // #893's review, B1: the device is canonical (ADR 0036 D-3), so a ride the
  // rider deleted HERE is deleted there — and never pulled back.
  it('does not pull back a ride deleted on this device, and deletes it on the instance with its write-up', async () => {
    world = await instanceTesting.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
    const origin = instanceTesting.TEST_ORIGIN;
    const a = await signedInDevice(world.url, origin, [
      'nominal-outdoor-ride.fit',
      'paused-laps.fit',
    ]);
    const [gone, kept] = a.ids;
    await a.on.harness.write((store) => store.putRideWriteUp(rideWriteUpFor(LOCAL_ATHLETE, gone!)));
    expect(await a.sync()).toMatchObject({ pushed: 2, itemsPushed: 1, failures: [] });

    // The Activities screen's delete (`ActivitiesView.tsx`), and a re-sync of
    // the SAME device.
    await a.on.harness.write((store) => store.deleteActivity(LOCAL_ATHLETE, gone!));
    const report = await a.sync();
    expect(report).toMatchObject({ pulled: 0, deletedOnInstance: 1, failures: [] });
    expect((await libraryRows(a.on.harness)).map((row) => row.id)).toEqual([kept]);

    // The instance holds a tombstone for the ride and its write-up, and the
    // other ride untouched.
    const manifest = await manifestOf(a.on);
    const ride = manifest.find((entry) => entry.kind === 'activity' && entry.activityId === null);
    expect(ride?.deleted).toBe(true);
    expect(manifest.find((entry) => entry.kind === 'write-up' && entry.key === gone)?.deleted).toBe(
      true,
    );
    // #835: its summary too, so the history index keeps nothing of it (ADR 0040 D-10).
    expect(
      manifest.find((entry) => entry.kind === 'ride-summary' && entry.key === gone)?.deleted,
    ).toBe(true);
    expect(
      manifest.find((entry) => entry.kind === 'ride-summary' && entry.key === kept)?.deleted,
    ).toBe(false);
    expect(
      manifest
        .filter((entry) => entry.kind === 'activity' && !entry.deleted)
        .map((e) => e.activityId),
    ).toEqual([kept]);

    // Again: nothing to do, and nothing comes back.
    expect(await a.sync()).toMatchObject({
      pulled: 0,
      pushed: 0,
      deletedOnInstance: 0,
      failures: [],
    });
    expect(await libraryRows(a.on.harness)).toHaveLength(1);

    // And a fresh device pulls only the ride the rider kept.
    const b = await linkedDevice(world.url, origin, a.on);
    expect(await b.sync()).toMatchObject({ pulled: 1, failures: [] });
    expect((await libraryRows(b.on.harness)).map((row) => row.id)).toEqual([kept]);
  }, 60_000);

  // #893's review, B2: a write-up or report replaced HERE is what the instance
  // ends with, and the instance's older copy does not come back over it.
  it('keeps a write-up and a side-camera report replaced on this device, and the instance ends with them', async () => {
    world = await instanceTesting.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
    const origin = instanceTesting.TEST_ORIGIN;
    const a = await signedInDevice(world.url, origin, ['nominal-outdoor-ride.fit']);
    const [id] = a.ids;
    await a.on.harness.write(async (store) => {
      await store.putRideWriteUp(rideWriteUpFor(LOCAL_ATHLETE, id!, 1));
      await store.putSideCameraReport(sideCameraReportFor(LOCAL_ATHLETE, id!, 1));
    });
    expect(await a.sync()).toMatchObject({ itemsPushed: 2, failures: [] });

    // A new write-up (#805 replaces on every ask) and a new report, here.
    await a.on.harness.write(async (store) => {
      await store.putRideWriteUp(rideWriteUpFor(LOCAL_ATHLETE, id!, 2));
      await store.putSideCameraReport(sideCameraReportFor(LOCAL_ATHLETE, id!, 2));
    });
    const report = await a.sync();
    expect(report).toMatchObject({ itemsPulled: 0, itemsPushed: 2, failures: [] });

    // The device still holds what the rider made, read after a reload…
    expect(await a.on.harness.read((store) => store.getRideWriteUp(LOCAL_ATHLETE, id!))).toEqual(
      rideWriteUpFor(LOCAL_ATHLETE, id!, 2),
    );
    expect(
      await a.on.harness.read((store) => store.getSideCameraReport(LOCAL_ATHLETE, id!)),
    ).toEqual(sideCameraReportFor(LOCAL_ATHLETE, id!, 2));
    // …and so does the instance.
    expect((await instanceItem(a.on, 'write-up', id!))?.templateVersion).toBe('1.2');
    expect((await instanceItem(a.on, 'side-camera-report', id!))?.summary).toBe(
      sideCameraReportFor(LOCAL_ATHLETE, id!, 2).summary,
    );
    // The other direction still works: another device replaces the write-up,
    // and this device — unchanged since its push, with no sync in between —
    // takes it rather than pushing its own copy back over it.
    const b = await linkedDevice(world.url, origin, a.on);
    expect(await b.sync()).toMatchObject({ pulled: 1, itemsPulled: 2, failures: [] });
    await b.on.harness.write((store) =>
      store.putRideWriteUp(rideWriteUpFor(LOCAL_ATHLETE, id!, 3)),
    );
    expect(await b.sync()).toMatchObject({ itemsPushed: 1, itemsPulled: 0, failures: [] });
    expect(await a.sync()).toMatchObject({ itemsPulled: 1, itemsPushed: 0, failures: [] });
    expect(await a.on.harness.read((store) => store.getRideWriteUp(LOCAL_ATHLETE, id!))).toEqual(
      rideWriteUpFor(LOCAL_ATHLETE, id!, 3),
    );
    // Nothing moves on the next sync.
    expect(await a.sync()).toMatchObject({ itemsPulled: 0, itemsPushed: 0, failures: [] });
  }, 60_000);
  // #893's re-review, N1: the device that RECORDED and pushed a ride finds it
  // by the base, since the tombstone names no ride and the ride's own
  // `originalFile` is not the hash of the FIT it exported.
  it('deletes a ride another device deleted on the device that pushed it, with its write-up', async () => {
    world = await instanceTesting.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
    const origin = instanceTesting.TEST_ORIGIN;
    const a = await signedInDevice(world.url, origin, [
      'nominal-outdoor-ride.fit',
      'paused-laps.fit',
    ]);
    const [gone, kept] = a.ids;
    await a.on.harness.write((store) => store.putRideWriteUp(rideWriteUpFor(LOCAL_ATHLETE, gone!)));
    expect(await a.sync()).toMatchObject({ pushed: 2, itemsPushed: 1, failures: [] });

    const b = await linkedDevice(world.url, origin, a.on);
    expect(await b.sync()).toMatchObject({ pulled: 2, itemsPulled: 1, failures: [] });
    await b.on.harness.write((store) => store.deleteActivity(LOCAL_ATHLETE, gone!));
    expect(await b.sync()).toMatchObject({ deletedOnInstance: 1, failures: [] });

    expect(await a.sync()).toMatchObject({ deleted: 1, pushed: 0, failures: [] });
    expect((await libraryRows(a.on.harness)).map((row) => row.id)).toEqual([kept]);
    expect(await a.on.harness.read((store) => store.getRideWriteUp(LOCAL_ATHLETE, gone!))).toBe(
      undefined,
    );
    // …and it stays deleted: A does not push it back.
    expect(await a.sync()).toMatchObject({ pushed: 0, pulled: 0, deleted: 0, failures: [] });
    expect(await libraryRows(a.on.harness)).toHaveLength(1);
  }, 60_000);

  // #893's re-review, N3: an item PULLED is remembered as synced, so when
  // another device later replaces it, this device takes the new copy rather
  // than pushing the one it pulled back over it.
  it('remembers a pulled write-up, so a later change on another device is pulled rather than overwritten', async () => {
    world = await instanceTesting.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
    const origin = instanceTesting.TEST_ORIGIN;
    const a = await signedInDevice(world.url, origin, ['nominal-outdoor-ride.fit']);
    const [id] = a.ids;
    await a.on.harness.write((store) =>
      store.putRideWriteUp(rideWriteUpFor(LOCAL_ATHLETE, id!, 1)),
    );
    expect(await a.sync()).toMatchObject({ itemsPushed: 1, failures: [] });

    const b = await linkedDevice(world.url, origin, a.on);
    expect(await b.sync()).toMatchObject({ pulled: 1, itemsPulled: 1, failures: [] });

    await a.on.harness.write((store) =>
      store.putRideWriteUp(rideWriteUpFor(LOCAL_ATHLETE, id!, 2)),
    );
    expect(await a.sync()).toMatchObject({ itemsPushed: 1, failures: [] });

    expect(await b.sync()).toMatchObject({ itemsPulled: 1, itemsPushed: 0, failures: [] });
    expect(await b.on.harness.read((store) => store.getRideWriteUp(LOCAL_ATHLETE, id!))).toEqual(
      rideWriteUpFor(LOCAL_ATHLETE, id!, 2),
    );
    expect((await instanceItem(a.on, 'write-up', id!))?.templateVersion).toBe('1.2');
  }, 60_000);

  it('carries a ride’s “may be raced” consent to the instance, and a revocation on device A takes it out of what the instance serves within one sync (#793)', async () => {
    world = await instanceTesting.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
    const origin = instanceTesting.TEST_ORIGIN;
    const a = await signedInDevice(world.url, origin, ['nominal-outdoor-ride.fit']);
    const ride = a.ids[0]!;

    // Off by default: the first sync sends the ride and no consent.
    const first = await a.sync();
    expect(first).toMatchObject({ pushed: 1, consentsPushed: 0, failures: [] });
    expect(await raceableOnInstance(world.path)).toStrictEqual([]);

    // The rider allows it on A: one sync, and the instance serves it.
    await a.on.harness.write((store) => store.setActivityMayBeRaced(LOCAL_ATHLETE, ride, true));
    expect(await a.sync()).toMatchObject({ consentsPushed: 1, failures: [] });
    const served = await raceableOnInstance(world.path);
    expect(served).toHaveLength(1);

    // A second device of the same rider pulls the ride — and its consent with it.
    const b = await linkedDevice(world.url, origin, a.on);
    expect(await b.sync()).toMatchObject({ pulled: 1, consentsPushed: 0, failures: [] });
    const onB = await b.on.harness.read((store) => store.getActivity(LOCAL_ATHLETE, ride));
    expect(onB?.mayBeRaced).toBe(true);

    // The rider revokes it on A: within ONE sync the instance no longer serves it.
    await a.on.harness.write((store) => store.setActivityMayBeRaced(LOCAL_ATHLETE, ride, false));
    expect(await a.sync()).toMatchObject({ consentsPushed: 1, failures: [] });
    expect(await raceableOnInstance(world.path)).toStrictEqual([]);

    // B, which still says "yes", takes the revocation rather than putting the
    // consent back — the three-way rule, not "the device wins".
    expect(await b.sync()).toMatchObject({ consentsPulled: 1, consentsPushed: 0, failures: [] });
    const revokedOnB = await b.on.harness.read((store) => store.getActivity(LOCAL_ATHLETE, ride));
    expect(revokedOnB?.mayBeRaced).toBe(false);
    expect(await b.sync()).toMatchObject({ consentsPulled: 0, consentsPushed: 0, failures: [] });
    expect(await raceableOnInstance(world.path)).toStrictEqual([]);
  }, 60_000);

  // #915's review: with NO race-consent base — every ride synced before store
  // v15, or against an instance before migration 0011 — a device still saying
  // "yes" pushed it over a revocation made on another device. Off wins.
  it('lets "off" win when a device has no consent base, so a device still saying yes cannot re-grant a revoked consent (#793)', async () => {
    world = await instanceTesting.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
    const origin = instanceTesting.TEST_ORIGIN;
    const a = await signedInDevice(world.url, origin, ['nominal-outdoor-ride.fit']);
    const ride = a.ids[0]!;
    expect(await a.sync()).toMatchObject({ pushed: 1, failures: [] });
    await a.on.harness.write((store) => store.setActivityMayBeRaced(LOCAL_ATHLETE, ride, true));
    expect(await a.sync()).toMatchObject({ consentsPushed: 1, failures: [] });

    const b = await linkedDevice(world.url, origin, a.on);
    expect(await b.sync()).toMatchObject({ pulled: 1, failures: [] });
    expect(
      (await b.on.harness.read((store) => store.getActivity(LOCAL_ATHLETE, ride)))?.mayBeRaced,
    ).toBe(true);

    await a.on.harness.write((store) => store.setActivityMayBeRaced(LOCAL_ATHLETE, ride, false));
    expect(await a.sync()).toMatchObject({ consentsPushed: 1, failures: [] });
    expect(await raceableOnInstance(world.path)).toStrictEqual([]);

    // B loses its base, as a ride synced before the consent existed has none.
    expect(
      await b.on.harness.write((store) =>
        store.deleteSyncBase(LOCAL_ATHLETE, 'race-consent', ride),
      ),
    ).toBe(true);

    expect(await b.sync()).toMatchObject({ consentsPulled: 1, consentsPushed: 0, failures: [] });
    expect(
      (await b.on.harness.read((store) => store.getActivity(LOCAL_ATHLETE, ride)))?.mayBeRaced,
    ).toBe(false);
    expect(await raceableOnInstance(world.path)).toStrictEqual([]);
  }, 60_000);

  // The other half of "off wins": with no base, a device saying "no" sends it,
  // rather than taking a "yes" it cannot tell was given after its own "no".
  it('sends a device’s "off" over the instance’s "yes" when there is no consent base (#793)', async () => {
    world = await instanceTesting.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
    const origin = instanceTesting.TEST_ORIGIN;
    const a = await signedInDevice(world.url, origin, ['nominal-outdoor-ride.fit']);
    const ride = a.ids[0]!;
    expect(await a.sync()).toMatchObject({ pushed: 1, failures: [] });
    await a.on.harness.write((store) => store.setActivityMayBeRaced(LOCAL_ATHLETE, ride, true));
    expect(await a.sync()).toMatchObject({ consentsPushed: 1, failures: [] });
    const b = await linkedDevice(world.url, origin, a.on);
    expect(await b.sync()).toMatchObject({ pulled: 1, failures: [] });

    await b.on.harness.write(async (store) => {
      await store.setActivityMayBeRaced(LOCAL_ATHLETE, ride, false);
      await store.deleteSyncBase(LOCAL_ATHLETE, 'race-consent', ride);
    });
    expect(await b.sync()).toMatchObject({ consentsPushed: 1, consentsPulled: 0, failures: [] });
    expect(await raceableOnInstance(world.path)).toStrictEqual([]);
  }, 60_000);

  // The converse, which "off wins" must not cost: a "yes" given before the
  // ride's FIRST sync has a base (the instance's "off" at push), so it is sent.
  it('sends a consent given before the ride’s first sync on the next one, rather than taking the instance’s default "off" (#793)', async () => {
    world = await instanceTesting.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
    const origin = instanceTesting.TEST_ORIGIN;
    const a = await signedInDevice(world.url, origin, ['nominal-outdoor-ride.fit']);
    const ride = a.ids[0]!;
    await a.on.harness.write((store) => store.setActivityMayBeRaced(LOCAL_ATHLETE, ride, true));
    expect(await a.sync()).toMatchObject({ pushed: 1, failures: [] });
    expect(await a.sync()).toMatchObject({ consentsPushed: 1, consentsPulled: 0, failures: [] });
    expect(
      (await a.on.harness.read((store) => store.getActivity(LOCAL_ATHLETE, ride)))?.mayBeRaced,
    ).toBe(true);
    expect(await raceableOnInstance(world.path)).toHaveLength(1);
  }, 60_000);

  // And a ride PULLED while its consent was off keeps that "off" as its base,
  // so a "yes" later given on the other device reaches this one rather than
  // being revoked by it under "off wins".
  it('takes a consent granted on another device after this device pulled the ride with it off (#793)', async () => {
    world = await instanceTesting.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
    const origin = instanceTesting.TEST_ORIGIN;
    const a = await signedInDevice(world.url, origin, ['nominal-outdoor-ride.fit']);
    const ride = a.ids[0]!;
    expect(await a.sync()).toMatchObject({ pushed: 1, failures: [] });
    const b = await linkedDevice(world.url, origin, a.on);
    expect(await b.sync()).toMatchObject({ pulled: 1, failures: [] });

    await a.on.harness.write((store) => store.setActivityMayBeRaced(LOCAL_ATHLETE, ride, true));
    expect(await a.sync()).toMatchObject({ consentsPushed: 1, failures: [] });

    expect(await b.sync()).toMatchObject({ consentsPulled: 1, consentsPushed: 0, failures: [] });
    expect(
      (await b.on.harness.read((store) => store.getActivity(LOCAL_ATHLETE, ride)))?.mayBeRaced,
    ).toBe(true);
    expect(await raceableOnInstance(world.path)).toHaveLength(1);
  }, 60_000);
});
