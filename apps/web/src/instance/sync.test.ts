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

import {
  beatsPerMinute,
  encodeWorkoutFile,
  fromHex,
  readWorkoutGoals,
  thresholdShare,
  kilograms,
  toHex,
  unixSeconds,
  type ActivityClaims,
  type SigningKey,
  type WorkoutGoals,
} from '@onyourleft/domain';
import {
  activityId as toActivityId,
  ensureDeviceSigningKey,
  webCryptoHpkePrimitives,
  webCryptoSha256,
  webCryptoVerifier,
  type ActivityId,
  type WorkoutGoalsRecord,
  type WorkoutRecord,
} from '@onyourleft/store';
import {
  createStoreHarness,
  rideWriteUpFor,
  riderTextFor,
  sideCameraReportFor,
  workoutFor,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { orderedRows, PAGE_SIZE } from '../library/rows';
import { rideSummaryOf, type RideSummaryStore } from '../ride-analysis/ride-summary';
import { ensureLocalAthlete, LOCAL_ATHLETE } from '../local-athlete';
import { importActivityFiles } from '../transfer/import-batch';
import { workoutRow } from '../workouts/library';
import {
  createInstanceClock,
  sealedInstance,
  type InstanceSend,
  type SealedInstance,
} from './instance-transport';
import { linkThisDevice, signInToInstance, type InstanceTransport } from './sign-in';
import {
  admitDeviceKey,
  athleteKeysFrom,
  sealedSyncTransport,
  syncWithInstance,
  type SyncDependencies,
  type SyncTransport,
} from './sync';

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
    /** The agent's read port (`analysis/tools/reads.ts` §`AnalysisReads`), as `SqlStore` serves it. */
    listLiveSyncItems(
      athleteId: string,
      kind: string,
      limit: number,
    ): Promise<readonly { readonly key: string; readonly body: Uint8Array | null }[]>;
    close(): Promise<void>;
  }>;
}

/** The instance agent's `workouts` tool (#1100), run over the reads it is handed. */
interface InstanceToolsModule {
  readonly WORKOUTS: {
    run(
      context: { readonly athleteId: string; readonly input: unknown; readonly reads: unknown },
      args: Readonly<Record<string, never>>,
    ): Promise<string>;
  };
}

const INSTANCE = (path: string): string =>
  fileURLToPath(new URL(`../../../instance/src/${path}`, import.meta.url));

let instanceTesting: InstanceTesting;
let syncTesting: SyncTesting;
let instanceStore: InstanceStoreModule;
let instanceTools: InstanceToolsModule;
beforeAll(async () => {
  instanceTools = (await import(INSTANCE('analysis/tools/tools.ts'))) as InstanceToolsModule;
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

/**
 * `fetch` against the instance, with this device's session once it has one.
 * The challenge and a known key's sign-in go in plaintext (`auth`); a new
 * key's registration, a link (`sealed`) and every sync route (`sync`) go
 * SEALED (#1192): through the client's own `sealedInstance`, to the newest
 * key the instance serves, signed by this device's key.
 */
function transports(url: string, signingKey: () => Promise<SigningKey>) {
  let token: string | undefined;
  const origin = instanceTesting.TEST_ORIGIN;
  const clock = createInstanceClock();
  const headers = (json: boolean): Record<string, string> => ({
    ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    ...(json ? { 'content-type': 'application/json' } : {}),
  });
  // The instance answers at `url`; it states, and is sealed to, `origin`.
  const send: InstanceSend = (target, init) => fetch(target.replace(origin, url), init);
  const instance = async (): Promise<SealedInstance> => {
    const served = (await (await fetch(`${url}/v1/instance/keys`)).json()) as {
      statements: { statement: { keyId: string; encryptionKey: string } }[];
    };
    const newest = served.statements.at(-1)?.statement;
    if (newest === undefined) throw new Error('the instance serves no encryption key');
    return sealedInstance(
      origin,
      {
        instanceKey: {
          keyId: newest.keyId,
          publicKey: fromHex(newest.encryptionKey, 'the encryption key', 32),
        },
        signingKey: await signingKey(),
        primitives: webCryptoHpkePrimitives,
        sha256: webCryptoSha256,
        clock,
        now: () => NOW * 1000,
      },
      send,
    );
  };
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
  const sealed: InstanceTransport = {
    post: async (path, body) => (await instance()).call('POST', path, { body }),
  };
  const held = (): string => {
    if (token === undefined) throw new Error('this device holds no session yet');
    return token;
  };
  const sync: SyncTransport = {
    json: async (method, path, body) =>
      sealedSyncTransport(await instance(), held()).json(method, path, body),
    bytes: async (path) => sealedSyncTransport(await instance(), held()).bytes(path),
  };
  return {
    auth,
    sealed,
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
    transport: transports(url, () =>
      harness.write((store) => ensureDeviceSigningKey(store, LOCAL_ATHLETE, { now: () => NOW })),
    ),
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
    // A new key registers, and a device links, only sealed (#1192).
    sealed: on.transport.sealed,
    storage: on.account,
    ensureLocalAthlete: () => on.harness.write((store) => ensureLocalAthlete(store, NOW)),
    signingKey: () =>
      on.harness.write((store) => ensureDeviceSigningKey(store, LOCAL_ATHLETE, { now: () => NOW })),
    now: () => NOW * 1000,
  };
}

function syncDependencies(on: Device, store: SyncDependencies['store']): SyncDependencies {
  return {
    sealed: on.transport.sync,
    store,
    athleteId: LOCAL_ATHLETE,
    signingKey: () => ensureDeviceSigningKey(store as never, LOCAL_ATHLETE, { now: () => NOW }),
    sha256: webCryptoSha256,
    verifier: webCryptoVerifier,
    now: () => NOW,
    timeZone: 'Europe/London',
    // The harness hands the whole ActivityStore, which reads a ride's input.
    rideSummary: rideSummaryOf(store as unknown as RideSummaryStore, LOCAL_ATHLETE),
    // The athlete's keys, from the instance's device list (#898).
    athleteKeys: () => athleteKeysFrom(on.transport.sync),
    newDocumentId: () => crypto.randomUUID(),
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
  return { on, ids, sync, athleteId: signedIn.instanceAthleteId };
}

/** A device's own public key, lowercase hex, as a signed record carries it. */
function publicKeyOf(on: Device): Promise<string> {
  return on.harness.write(async (store) =>
    toHex((await ensureDeviceSigningKey(store, LOCAL_ATHLETE, { now: () => NOW })).publicKey),
  );
}

/**
 * The rider confirms, on each of the two devices, that the other is theirs
 * (#898): what the screen that will call {@link admitDeviceKey} does. Until
 * then neither takes a ride the other signed.
 */
async function admitEachOther(first: Device, second: Device): Promise<void> {
  const [one, two] = [await publicKeyOf(first), await publicKeyOf(second)];
  await first.harness.write((store) => admitDeviceKey(store, LOCAL_ATHLETE, two, NOW));
  await second.harness.write((store) => admitDeviceKey(store, LOCAL_ATHLETE, one, NOW));
}

/** A second device, linked to the first's athlete with a code the first minted. */
async function linkedDevice(
  url: string,
  origin: string,
  first: Device,
  { admit = true }: { readonly admit?: boolean } = {},
) {
  const code = await first.transport.sync.json('POST', '/v1/auth/link-codes');
  const on = device(url);
  const linked = await linkThisDevice(
    signInDependencies(origin, on),
    (code.body as { linkCode: string }).linkCode,
  );
  on.transport.setToken(linked.sessionToken);
  if (admit) await admitEachOther(first, on);
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
    // The rider confirms on each device that the other is theirs (#898).
    await admitEachOther(a, b);
    const pulled = await b.harness.write((store) => syncWithInstance(syncDependencies(b, store)));
    expect(pulled).toMatchObject({ pulled: 3, itemsPulled: 2, pushed: 0, failures: [] });
    expect(pulled.keysToConfirm).toStrictEqual([]);

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
      rideSummaryOf(store as unknown as RideSummaryStore, LOCAL_ATHLETE)(ids[0]!),
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
      syncWithInstance({ ...syncDependencies(b, store), sealed: tampering }),
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
      syncWithInstance({ ...syncDependencies(b, store), sealed: swapping }),
    );
    expect(swapped.failures).toEqual([
      expect.objectContaining({ kind: 'activity', reason: 'content-mismatch' }),
    ]);
    expect(await libraryRows(b.harness)).toEqual([]);
  }, 60_000);

  // #898 rule 1: a tombstone is unsigned and the device is canonical (ADR 0036
  // D-3), so a ride another device deleted is KEPT here, and hidden there.
  it('keeps on this device a ride another device deleted, and sends nothing of it back', async () => {
    world = await instanceTesting.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
    const origin = instanceTesting.TEST_ORIGIN;
    const a = device(world.url);
    const [id] = await importRides(a, ['nominal-outdoor-ride.fit']);
    await a.harness.write((store) => store.putRideWriteUp(rideWriteUpFor(LOCAL_ATHLETE, id!)));
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
    await admitEachOther(a, b);
    await b.harness.write((store) => syncWithInstance(syncDependencies(b, store)));
    expect(await libraryRows(b.harness)).toHaveLength(1);

    const record = await a.harness.read((store) => store.getActivityRecord(LOCAL_ATHLETE, id!));
    const content = record!.record.contentHash.slice('sha256:'.length);
    for (const [kind, key] of [
      ['write-up', id!],
      ['ride-summary', id!],
      ['activity', content],
    ] as const) {
      const removed = await a.transport.sync.json('DELETE', `/v1/sync/items/${kind}/${key}`);
      expect(removed.status).toBe(204);
    }
    const report = await b.harness.write((store) => syncWithInstance(syncDependencies(b, store)));
    expect(report).toMatchObject({
      hiddenOnInstance: 1,
      pushed: 0,
      itemsPushed: 0,
      summariesPushed: 0,
      failures: [],
    });
    // B's copy is B's: the ride and its write-up, read after a reload.
    expect(await libraryRows(b.harness)).toHaveLength(1);
    expect(await b.harness.read((store) => store.getRideWriteUp(LOCAL_ATHLETE, id!))).toEqual(
      rideWriteUpFor(LOCAL_ATHLETE, id!),
    );
    // And the instance still hides it: nothing of it was sent back.
    const manifest = await manifestOf(b);
    for (const entry of manifest) expect(entry.deleted, `${entry.kind} ${entry.key}`).toBe(true);
    // Nor on the next sync.
    const again = await b.harness.write((store) => syncWithInstance(syncDependencies(b, store)));
    expect(again).toMatchObject({ pushed: 0, itemsPushed: 0, summariesPushed: 0, failures: [] });
    expect(await libraryRows(b.harness)).toHaveLength(1);
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
  // `originalFile` is not the hash of the FIT it exported — and since #898 it
  // KEEPS it, and sends none of it back.
  it('keeps a ride another device deleted on the device that pushed it, with its write-up', async () => {
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

    expect(await a.sync()).toMatchObject({
      hiddenOnInstance: 1,
      pushed: 0,
      itemsPushed: 0,
      summariesPushed: 0,
      failures: [],
    });
    expect((await libraryRows(a.on.harness)).map((row) => row.id).sort()).toEqual(
      [gone, kept].sort(),
    );
    expect(await a.on.harness.read((store) => store.getRideWriteUp(LOCAL_ATHLETE, gone!))).toEqual(
      rideWriteUpFor(LOCAL_ATHLETE, gone!),
    );
    // …and it stays hidden on the instance: A pushes none of it back.
    expect(await a.sync()).toMatchObject({ pushed: 0, pulled: 0, itemsPushed: 0, failures: [] });
    const manifest = await manifestOf(a.on);
    expect(
      manifest.filter((entry) => !entry.deleted && entry.key === gone).map((entry) => entry.kind),
    ).toEqual([]);
    expect(
      manifest
        .filter((entry) => entry.kind === 'activity' && !entry.deleted)
        .map((e) => e.activityId),
    ).toEqual([kept]);
    // Deleted HERE later, it is simply gone, and nothing is asked of the instance.
    await a.on.harness.write((store) => store.deleteActivity(LOCAL_ATHLETE, gone!));
    expect(await a.sync()).toMatchObject({
      hiddenOnInstance: 0,
      deletedOnInstance: 0,
      failures: [],
    });
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

describe('what a device will not take from an instance (#898)', () => {
  /** A ride on A, pushed; B linked to A's athlete. */
  async function twoDevices() {
    world = await instanceTesting.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
    const origin = instanceTesting.TEST_ORIGIN;
    const a = await signedInDevice(world.url, origin, ['nominal-outdoor-ride.fit']);
    expect(await a.sync()).toMatchObject({ pushed: 1, failures: [] });
    const b = await linkedDevice(world.url, origin, a.on);
    const record = await a.on.harness.read((store) =>
      store.getActivityRecord(LOCAL_ATHLETE, a.ids[0]!),
    );
    return { a, b, record: record!.record };
  }

  const syncB = (
    b: Awaited<ReturnType<typeof twoDevices>>['b'],
    athleteKeys: SyncDependencies['athleteKeys'],
  ) =>
    b.on.harness.write((store) =>
      syncWithInstance({ ...syncDependencies(b.on, store), athleteKeys }),
    );

  it('refuses a record whose key the instance lists and this device never admitted, until the rider admits it (#926’s review, B1)', async () => {
    world = await instanceTesting.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
    const origin = instanceTesting.TEST_ORIGIN;
    const a = await signedInDevice(world.url, origin, ['nominal-outdoor-ride.fit']);
    expect(await a.sync()).toMatchObject({ pushed: 1, failures: [] });
    const b = await linkedDevice(world.url, origin, a.on, { admit: false });
    const keyOfA = await publicKeyOf(a.on);

    // The instance lists A's key as the athlete's; B has not been told so.
    const refused = await b.sync();
    expect(refused.pulled).toBe(0);
    expect(refused.failures).toEqual([
      expect.objectContaining({ kind: 'activity', reason: 'key-not-admitted' }),
    ]);
    expect(refused.keysToConfirm).toStrictEqual([keyOfA]);
    expect(await libraryRows(b.on.harness)).toEqual([]);

    // The rider says yes on B, and the same ride is pulled — the refusal was
    // not remembered as synced.
    await b.on.harness.write((store) => admitDeviceKey(store, LOCAL_ATHLETE, keyOfA, NOW));
    const taken = await b.sync();
    expect(taken).toMatchObject({ pulled: 1, failures: [], keysToConfirm: [] });
    expect(await libraryRows(b.on.harness)).toHaveLength(1);
  }, 60_000);

  it('refuses a stranger’s record even when a lying instance lists the stranger’s key as the athlete’s (#926’s review, B1)', async () => {
    const { b } = await twoDevices();
    const stranger = await instanceTesting.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
    try {
      const c = await signedInDevice(stranger.url, instanceTesting.TEST_ORIGIN, [
        'nominal-outdoor-ride.fit',
      ]);
      expect(await c.sync()).toMatchObject({ pushed: 1, failures: [] });
      const theirs = await c.on.harness.read((store) =>
        store.getActivityRecord(LOCAL_ATHLETE, c.ids[0]!),
      );
      // The instance serves the forged record AND lists its key on both
      // routes it controls — the attack the instance's own list cannot stop.
      const honest = b.on.transport.sync;
      const lying: SyncTransport = {
        ...honest,
        json: async (method, path, body) => {
          const answer = await honest.json(method, path, body);
          if (path === '/v1/auth/devices') {
            const listed = (answer.body as { devices: object[] }).devices;
            return {
              ...answer,
              body: {
                devices: [...listed, { publicKey: theirs!.record.publicKey, revokedAt: null }],
              },
            };
          }
          if (!path.startsWith('/v1/sync/records/')) return answer;
          return { ...answer, body: { ...(answer.body as object), record: theirs!.record } };
        },
      };
      const report = await b.on.harness.write((store) =>
        syncWithInstance({
          ...syncDependencies(b.on, store),
          sealed: lying,
          athleteKeys: () => athleteKeysFrom(lying),
        }),
      );
      expect(report.failures).toEqual([
        expect.objectContaining({ kind: 'activity', reason: 'key-not-admitted' }),
      ]);
      expect(report.keysToConfirm).toStrictEqual([theirs!.record.publicKey]);
      expect(await libraryRows(b.on.harness)).toEqual([]);
    } finally {
      await stranger.close();
    }
  }, 60_000);

  it('takes a record signed by this device’s own key with nothing admitted', async () => {
    world = await instanceTesting.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
    const a = await signedInDevice(world.url, instanceTesting.TEST_ORIGIN, [
      'nominal-outdoor-ride.fit',
    ]);
    const [id] = a.ids;
    expect(await a.sync()).toMatchObject({ pushed: 1, failures: [] });
    // The ride and every memory of syncing it are gone from A, so A pulls it:
    // the record is A's own, and A has admitted no key at all.
    await a.on.harness.write(async (store) => {
      await store.deleteActivity(LOCAL_ATHLETE, id!);
      for (const row of await store.listSyncBase(LOCAL_ATHLETE)) {
        await store.deleteSyncBase(LOCAL_ATHLETE, row.kind, row.key);
      }
    });
    await expect(
      a.on.harness.read((store) => store.listTrustedDeviceKeys(LOCAL_ATHLETE)),
    ).resolves.toStrictEqual([]);
    expect(await a.sync()).toMatchObject({ pulled: 1, failures: [], keysToConfirm: [] });
    expect(await libraryRows(a.on.harness)).toHaveLength(1);
  }, 60_000);

  it('refuses a pulled record whose key is not one of the athlete’s, and writes nothing', async () => {
    const { b } = await twoDevices();
    // An instance that names only a stranger's key as the athlete's.
    const report = await syncB(b, () =>
      Promise.resolve([{ publicKey: 'a'.repeat(64), revokedAt: null }]),
    );
    expect(report.pulled).toBe(0);
    expect(report.failures).toEqual([
      expect.objectContaining({ kind: 'activity', reason: 'not-your-key' }),
    ]);
    expect(await libraryRows(b.on.harness)).toEqual([]);
    // The control: the athlete's own list, and the same ride is pulled.
    expect(await b.sync()).toMatchObject({ pulled: 1, failures: [] });
  }, 60_000);

  it('refuses a record another rider signed, served as this athlete’s — a good signature is not enough', async () => {
    const { b } = await twoDevices();
    const stranger = await instanceTesting.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
    try {
      // A stranger's device, on its own instance, signs the SAME file.
      const c = await signedInDevice(stranger.url, instanceTesting.TEST_ORIGIN, [
        'nominal-outdoor-ride.fit',
      ]);
      expect(await c.sync()).toMatchObject({ pushed: 1, failures: [] });
      const theirs = await c.on.harness.read((store) =>
        store.getActivityRecord(LOCAL_ATHLETE, c.ids[0]!),
      );
      // The instance hands B the stranger's record: it verifies against the file.
      const honest = b.on.transport.sync;
      const lying: SyncTransport = {
        ...honest,
        json: async (method, path, body) => {
          const answer = await honest.json(method, path, body);
          if (!path.startsWith('/v1/sync/records/')) return answer;
          return { ...answer, body: { ...(answer.body as object), record: theirs!.record } };
        },
      };
      const report = await b.on.harness.write((store) =>
        syncWithInstance({ ...syncDependencies(b.on, store), sealed: lying }),
      );
      expect(report.failures).toEqual([
        expect.objectContaining({ kind: 'activity', reason: 'not-your-key' }),
      ]);
      expect(await libraryRows(b.on.harness)).toEqual([]);
    } finally {
      await stranger.close();
    }
  }, 60_000);

  it('takes a revoked key’s record only for a ride that started before the revocation', async () => {
    const { b, record } = await twoDevices();
    const startedAt = record.claims.startedAt;
    const revokedAt = (at: number) => () =>
      Promise.resolve([{ publicKey: record.publicKey, revokedAt: at }]);
    const refused = await syncB(b, revokedAt(startedAt));
    expect(refused.failures).toEqual([
      expect.objectContaining({ kind: 'activity', reason: 'key-revoked' }),
    ]);
    expect(await libraryRows(b.on.harness)).toEqual([]);
    expect(await syncB(b, revokedAt(startedAt + 1))).toMatchObject({ pulled: 1, failures: [] });
  }, 60_000);

  it('pulls nothing when the athlete’s keys cannot be read', async () => {
    const { b } = await twoDevices();
    const report = await syncB(b, () => Promise.reject(new Error('no answer')));
    expect(report.failures).toEqual([
      expect.objectContaining({ kind: 'activity', reason: 'keys-unavailable' }),
    ]);
    expect(await libraryRows(b.on.harness)).toEqual([]);
  }, 60_000);
});

describe('reading the athlete’s keys from the instance (#898)', () => {
  const answering = (status: number, body: unknown): SyncTransport => ({
    json: () => Promise.resolve({ status, body }),
    bytes: () => Promise.reject(new Error('not asked')),
  });

  it('refuses an answer that is not a list, naming the instance’s own code', async () => {
    await expect(
      athleteKeysFrom(answering(401, { error: { code: 'unauthenticated' } })),
    ).rejects.toMatchObject({ name: 'InstanceSyncError', code: 'unauthenticated' });
    await expect(athleteKeysFrom(answering(200, { devices: 'none' }))).rejects.toMatchObject({
      name: 'InstanceSyncError',
      code: 'unknown',
    });
  });

  it('refuses a list with a row that is not a key, rather than trusting the rest', async () => {
    for (const row of [
      { publicKey: 7, revokedAt: null },
      { publicKey: 'a'.repeat(64), revokedAt: 'yesterday' },
      { publicKey: 'a'.repeat(64), revokedAt: Number.NaN },
      null,
    ]) {
      await expect(
        athleteKeysFrom(
          answering(200, { devices: [{ publicKey: 'b'.repeat(64), revokedAt: null }, row] }),
        ),
      ).rejects.toMatchObject({ name: 'InstanceSyncError', code: 'malformed-devices' });
    }
  });
});

describe('a push whose answer was lost (#901)', () => {
  it('is deleted on the instance, not pulled back, when the rider deletes the ride before the next sync', async () => {
    world = await instanceTesting.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
    const a = await signedInDevice(world.url, instanceTesting.TEST_ORIGIN, [
      'nominal-outdoor-ride.fit',
    ]);
    const [id] = a.ids;
    // The instance stores the ride; the answer never reaches the device.
    const honest = a.on.transport.sync;
    const losing: SyncTransport = {
      ...honest,
      json: async (method, path, body) => {
        const answer = await honest.json(method, path, body);
        if (method === 'POST' && path === '/v1/sync/records') {
          expect(answer.status).toBe(200);
          throw new Error('the connection dropped before the answer arrived');
        }
        return answer;
      },
    };
    await expect(
      a.on.harness.write((store) =>
        syncWithInstance({ ...syncDependencies(a.on, store), sealed: losing }),
      ),
    ).rejects.toThrow(/dropped/);
    expect(
      (await manifestOf(a.on)).filter((entry) => entry.kind === 'activity' && !entry.deleted),
    ).toHaveLength(1);

    await a.on.harness.write((store) => store.deleteActivity(LOCAL_ATHLETE, id!));
    expect(await a.sync()).toMatchObject({ pulled: 0, deletedOnInstance: 1, failures: [] });
    expect(await libraryRows(a.on.harness)).toEqual([]);
    expect(
      (await manifestOf(a.on)).filter((entry) => entry.kind === 'activity' && !entry.deleted),
    ).toEqual([]);
    // And the next sync leaves it so.
    expect(await a.sync()).toMatchObject({ pulled: 0, failures: [] });
    expect(await libraryRows(a.on.harness)).toEqual([]);
  }, 60_000);

  it('is pushed again, and settles, when the push did not arrive at all — the pending row does not mistake it for synced', async () => {
    world = await instanceTesting.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
    const a = await signedInDevice(world.url, instanceTesting.TEST_ORIGIN, [
      'nominal-outdoor-ride.fit',
    ]);
    const honest = a.on.transport.sync;
    const refusing: SyncTransport = {
      ...honest,
      json: (method, path, body) =>
        method === 'POST' && path === '/v1/sync/records'
          ? Promise.resolve({ status: 503, body: { error: { code: 'unavailable' } } })
          : honest.json(method, path, body),
    };
    const first = await a.on.harness.write((store) =>
      syncWithInstance({ ...syncDependencies(a.on, store), sealed: refusing }),
    );
    expect(first).toMatchObject({
      pushed: 0,
      failures: [expect.objectContaining({ reason: 'unavailable' })],
    });
    expect(await a.sync()).toMatchObject({ pushed: 1, failures: [] });
    expect(await libraryRows(a.on.harness)).toHaveLength(1);
  }, 60_000);
});

describe('the rider’s goals, ride notes and documents (#836)', () => {
  it('pushes all three from A, and a linked device B pulls them and reads them after a reload', async () => {
    world = await instanceTesting.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
    const origin = instanceTesting.TEST_ORIGIN;
    const a = await signedInDevice(world.url, origin, ['nominal-outdoor-ride.fit']);
    const [ride] = a.ids;
    const goal = riderTextFor(LOCAL_ATHLETE, 'goal');
    const note = riderTextFor(LOCAL_ATHLETE, 'note', ride);
    const plan = riderTextFor(LOCAL_ATHLETE, 'document');
    await a.on.harness.write(async (store) => {
      await store.putRiderText(goal);
      await store.putRiderText(note);
      await store.putRiderText(plan);
    });
    expect(await a.sync()).toMatchObject({ textsPushed: 3, textsPulled: 0, failures: [] });
    // The instance keeps exactly the body the history index cuts: the text,
    // and a document's name — no athlete id and no time.
    expect(await instanceItem(a.on, 'goal', 'goals')).toStrictEqual({ text: goal.text });
    expect(await instanceItem(a.on, 'note', ride!)).toStrictEqual({ text: note.text });
    expect(await instanceItem(a.on, 'document', plan.key)).toStrictEqual({
      name: plan.name,
      text: plan.text,
    });
    // Nothing moves the second time.
    expect(await a.sync()).toMatchObject({ textsPushed: 0, textsPulled: 0, failures: [] });

    const b = await linkedDevice(world.url, origin, a.on);
    expect(await b.sync()).toMatchObject({ pulled: 1, textsPulled: 3, failures: [] });
    const [goalOnB, noteOnB, plansOnB] = await b.on.harness.read((store) =>
      Promise.all([
        store.getRiderText(LOCAL_ATHLETE, 'goal', 'goals'),
        store.getRiderText(LOCAL_ATHLETE, 'note', ride!),
        store.listRiderTexts(LOCAL_ATHLETE, 'document'),
      ]),
    );
    expect(goalOnB?.text).toBe(goal.text);
    expect(noteOnB?.text).toBe(note.text);
    expect(plansOnB.map((row) => [row.key, row.name, row.text])).toStrictEqual([
      [plan.key, plan.name, plan.text],
    ]);
    // …and B pushes nothing back.
    expect(await b.sync()).toMatchObject({ textsPushed: 0, textsPulled: 0, failures: [] });
  }, 60_000);

  it('deletes on the instance a document the rider deleted here, and KEEPS the other device’s copy (#924, N3)', async () => {
    world = await instanceTesting.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
    const origin = instanceTesting.TEST_ORIGIN;
    const a = await signedInDevice(world.url, origin, ['nominal-outdoor-ride.fit']);
    const plan = riderTextFor(LOCAL_ATHLETE, 'document');
    await a.on.harness.write((store) => store.putRiderText(plan));
    expect(await a.sync()).toMatchObject({ textsPushed: 1, failures: [] });
    const b = await linkedDevice(world.url, origin, a.on);
    expect(await b.sync()).toMatchObject({ textsPulled: 1, failures: [] });

    await a.on.harness.write((store) => store.deleteRiderText(LOCAL_ATHLETE, 'document', plan.key));
    expect(await a.sync()).toMatchObject({ textsDeletedOnInstance: 1, failures: [] });
    expect(await instanceItem(a.on, 'document', plan.key)).toBeUndefined();
    const entry = (await manifestOf(a.on)).find((item) => item.kind === 'document');
    expect(entry?.deleted).toBe(true);

    // B held it unchanged. The delete is unsigned, so, as for a ride (#898
    // rule 1), B KEEPS its copy — and does not push it back (#924, the
    // owner's ruling on #926's review, N3).
    const heldOnB = () =>
      b.on.harness.read((store) => store.listRiderTexts(LOCAL_ATHLETE, 'document'));
    expect(await b.sync()).toMatchObject({
      textsHiddenOnInstance: 1,
      textsPushed: 0,
      textsPulled: 0,
      failures: [],
    });
    expect((await heldOnB()).map((row) => [row.key, row.name, row.text])).toStrictEqual([
      [plan.key, plan.name, plan.text],
    ]);
    expect(await instanceItem(a.on, 'document', plan.key)).toBeUndefined();
    // The base row stays, so the next sync finds it kept again, not new.
    expect(await b.sync()).toMatchObject({
      textsHiddenOnInstance: 1,
      textsPushed: 0,
      failures: [],
    });
    expect(await instanceItem(a.on, 'document', plan.key)).toBeUndefined();
    // And A, which deleted it, does not pull it back from anywhere.
    expect(await a.sync()).toMatchObject({ textsPulled: 0, textsPushed: 0, failures: [] });
    expect(
      await a.on.harness.read((store) => store.listRiderTexts(LOCAL_ATHLETE, 'document')),
    ).toStrictEqual([]);

    // The rider removes it on B by hand: gone there, and nothing is asked of
    // the instance again.
    await b.on.harness.write((store) => store.deleteRiderText(LOCAL_ATHLETE, 'document', plan.key));
    expect(await b.sync()).toMatchObject({
      textsHiddenOnInstance: 0,
      textsDeletedOnInstance: 0,
      textsPushed: 0,
      textsPulled: 0,
      failures: [],
    });
    expect(await heldOnB()).toStrictEqual([]);
  }, 60_000);

  it('keeps a goal another device deleted, and pushes it again only once it is changed here (#924, N3)', async () => {
    world = await instanceTesting.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
    const origin = instanceTesting.TEST_ORIGIN;
    const a = await signedInDevice(world.url, origin, ['nominal-outdoor-ride.fit']);
    const goal = riderTextFor(LOCAL_ATHLETE, 'goal');
    await a.on.harness.write((store) => store.putRiderText(goal));
    expect(await a.sync()).toMatchObject({ textsPushed: 1, failures: [] });
    const b = await linkedDevice(world.url, origin, a.on);
    expect(await b.sync()).toMatchObject({ textsPulled: 1, failures: [] });

    await a.on.harness.write((store) => store.deleteRiderText(LOCAL_ATHLETE, 'goal', 'goals'));
    expect(await a.sync()).toMatchObject({ textsDeletedOnInstance: 1, failures: [] });
    expect(await b.sync()).toMatchObject({
      textsHiddenOnInstance: 1,
      textsPushed: 0,
      failures: [],
    });
    const goalOnB = () =>
      b.on.harness.read((store) => store.getRiderText(LOCAL_ATHLETE, 'goal', 'goals'));
    expect((await goalOnB())?.text).toBe(goal.text);

    // New words typed on B are the rider's, and go out like any change.
    await b.on.harness.write((store) => store.putRiderText({ ...goal, text: 'A faster century.' }));
    expect(await b.sync()).toMatchObject({
      textsHiddenOnInstance: 0,
      textsPushed: 1,
      failures: [],
    });
    expect(await instanceItem(a.on, 'goal', 'goals')).toStrictEqual({ text: 'A faster century.' });

    // And A, which deleted it, takes the new words back on its next sync: A
    // holds no copy and forgot its base, so the instance's goal is new to it.
    // This goes further than "never pushed back" — the owner is asked to
    // confirm it on #934 — and this pins what A holds, so a change is seen.
    const goalOnA = () =>
      a.on.harness.read((store) => store.getRiderText(LOCAL_ATHLETE, 'goal', 'goals'));
    expect(await goalOnA()).toBeUndefined();
    expect(await a.sync()).toMatchObject({ textsPulled: 1, textsPushed: 0, failures: [] });
    expect((await goalOnA())?.text).toBe('A faster century.');
  }, 60_000);

  it('takes a goal another device changed, and pushes one changed here', async () => {
    world = await instanceTesting.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
    const origin = instanceTesting.TEST_ORIGIN;
    const a = await signedInDevice(world.url, origin, ['nominal-outdoor-ride.fit']);
    const goal = riderTextFor(LOCAL_ATHLETE, 'goal');
    await a.on.harness.write((store) => store.putRiderText(goal));
    expect(await a.sync()).toMatchObject({ textsPushed: 1, failures: [] });
    const b = await linkedDevice(world.url, origin, a.on);
    expect(await b.sync()).toMatchObject({ textsPulled: 1, failures: [] });

    await b.on.harness.write((store) => store.putRiderText({ ...goal, text: 'A faster century.' }));
    expect(await b.sync()).toMatchObject({ textsPushed: 1, textsPulled: 0, failures: [] });
    // A is unchanged since its push, so it takes B's rather than pushing its own.
    expect(await a.sync()).toMatchObject({ textsPulled: 1, textsPushed: 0, failures: [] });
    expect(
      (await a.on.harness.read((store) => store.getRiderText(LOCAL_ATHLETE, 'goal', 'goals')))
        ?.text,
    ).toBe('A faster century.');
    expect(await a.sync()).toMatchObject({ textsPulled: 0, textsPushed: 0, failures: [] });
  }, 60_000);

  it('deletes a ride’s note on the instance with the ride, and forgets it', async () => {
    world = await instanceTesting.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
    const origin = instanceTesting.TEST_ORIGIN;
    const a = await signedInDevice(world.url, origin, ['nominal-outdoor-ride.fit']);
    const [ride] = a.ids;
    await a.on.harness.write((store) =>
      store.putRiderText(riderTextFor(LOCAL_ATHLETE, 'note', ride)),
    );
    expect(await a.sync()).toMatchObject({ textsPushed: 1, failures: [] });
    await a.on.harness.write((store) => store.deleteActivity(LOCAL_ATHLETE, ride!));
    expect(await a.sync()).toMatchObject({ deletedOnInstance: 1, failures: [] });
    expect(await instanceItem(a.on, 'note', ride!)).toBeUndefined();
    expect(
      (await a.on.harness.read((store) => store.listSyncBase(LOCAL_ATHLETE))).filter(
        (row) => row.kind === 'note',
      ),
    ).toStrictEqual([]);
  }, 60_000);
});

describe('two devices’ words, and a delete over a newer edit (#924)', () => {
  async function twoWriters() {
    world = await instanceTesting.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
    const origin = instanceTesting.TEST_ORIGIN;
    const a = await signedInDevice(world.url, origin, ['nominal-outdoor-ride.fit']);
    expect(await a.sync()).toMatchObject({ pushed: 1, failures: [] });
    const b = await linkedDevice(world.url, origin, a.on);
    expect(await b.sync()).toMatchObject({ pulled: 1, failures: [] });
    return { a, b, ride: a.ids[0]! };
  }

  const documents = (on: Device) =>
    on.harness.read((store) => store.listRiderTexts(LOCAL_ATHLETE, 'document'));

  it('keeps both goals written on two devices before either synced — the other’s as a copy to merge', async () => {
    const { a, b } = await twoWriters();
    const goal = riderTextFor(LOCAL_ATHLETE, 'goal');
    await a.on.harness.write((store) => store.putRiderText({ ...goal, text: 'Ride a century.' }));
    await b.on.harness.write((store) => store.putRiderText({ ...goal, text: 'Climb Ventoux.' }));
    expect(await a.sync()).toMatchObject({ textsPushed: 1, textConflicts: 0, failures: [] });

    // B has no base for the goals and different words: both are kept.
    expect(await b.sync()).toMatchObject({ textConflicts: 1, failures: [] });
    const onB = await b.on.harness.read((store) =>
      store.getRiderText(LOCAL_ATHLETE, 'goal', 'goals'),
    );
    expect(onB?.text).toBe('Climb Ventoux.');
    const copies = await documents(b.on);
    expect(copies.map((row) => [row.name, row.text])).toStrictEqual([
      ['Goals (from another device)', 'Ride a century.'],
    ]);
    // …and the copy reaches A too, with B's goals: nothing either rider typed is gone.
    expect(await a.sync()).toMatchObject({ textsPulled: 2, failures: [] });
    expect(
      (await a.on.harness.read((store) => store.getRiderText(LOCAL_ATHLETE, 'goal', 'goals')))
        ?.text,
    ).toBe('Climb Ventoux.');
    expect((await documents(a.on)).map((row) => row.text)).toStrictEqual(['Ride a century.']);
    // And it settles.
    expect(await b.sync()).toMatchObject({ textsPushed: 0, textConflicts: 0, failures: [] });
  }, 60_000);

  it('keeps one copy, not one a sync, when the push after a conflict copy fails (#926’s review, N4)', async () => {
    const { a, b } = await twoWriters();
    const goal = riderTextFor(LOCAL_ATHLETE, 'goal');
    await a.on.harness.write((store) => store.putRiderText({ ...goal, text: 'Ride a century.' }));
    await b.on.harness.write((store) => store.putRiderText({ ...goal, text: 'Climb Ventoux.' }));
    expect(await a.sync()).toMatchObject({ textsPushed: 1, failures: [] });

    // B's push of its goals fails once, AFTER the copy of A's was kept.
    const honest = b.on.transport.sync;
    let refusals = 1;
    const failingOnce: SyncTransport = {
      ...honest,
      json: async (method, path, body) => {
        if (method === 'POST' && path === '/v1/sync/items/goal/goals' && refusals > 0) {
          refusals -= 1;
          return { status: 503, body: { error: { code: 'internal' } } };
        }
        return honest.json(method, path, body);
      },
    };
    const failed = await b.on.harness.write((store) =>
      syncWithInstance({ ...syncDependencies(b.on, store), sealed: failingOnce }),
    );
    expect(failed.failures).toEqual([
      expect.objectContaining({ kind: 'goal', reason: 'internal' }),
    ]);
    expect((await documents(b.on)).map((row) => row.text)).toStrictEqual(['Ride a century.']);

    // The next sync meets the same conflict, and keeps no second copy.
    expect(await b.sync()).toMatchObject({ failures: [] });
    expect((await documents(b.on)).map((row) => row.text)).toStrictEqual(['Ride a century.']);
    expect(await instanceItem(a.on, 'goal', 'goals')).toStrictEqual({ text: 'Climb Ventoux.' });
  }, 60_000);

  it('pushes nothing over the other device’s words when their copy cannot be fetched to keep', async () => {
    const { a, b } = await twoWriters();
    const goal = riderTextFor(LOCAL_ATHLETE, 'goal');
    await a.on.harness.write((store) => store.putRiderText({ ...goal, text: 'Ride a century.' }));
    await b.on.harness.write((store) => store.putRiderText({ ...goal, text: 'Climb Ventoux.' }));
    expect(await a.sync()).toMatchObject({ textsPushed: 1, failures: [] });
    const honest = b.on.transport.sync;
    const unreadable: SyncTransport = {
      ...honest,
      json: async (method, path, body) =>
        method === 'GET' && path === '/v1/sync/items/goal/goals'
          ? { status: 503, body: { error: { code: 'internal' } } }
          : honest.json(method, path, body),
    };
    const report = await b.on.harness.write((store) =>
      syncWithInstance({ ...syncDependencies(b.on, store), sealed: unreadable }),
    );
    expect(report.failures).toEqual([
      expect.objectContaining({ kind: 'goal', reason: 'internal' }),
    ]);
    expect(await documents(b.on)).toStrictEqual([]);
    expect(await instanceItem(a.on, 'goal', 'goals')).toStrictEqual({ text: 'Ride a century.' });
  }, 60_000);

  it('keeps both notes on a ride changed on two devices since they last agreed', async () => {
    const { a, b, ride } = await twoWriters();
    const note = riderTextFor(LOCAL_ATHLETE, 'note', ride);
    await a.on.harness.write((store) => store.putRiderText(note));
    expect(await a.sync()).toMatchObject({ textsPushed: 1, failures: [] });
    expect(await b.sync()).toMatchObject({ textsPulled: 1, failures: [] });

    await a.on.harness.write((store) => store.putRiderText({ ...note, text: 'Legs heavy.' }));
    await b.on.harness.write((store) => store.putRiderText({ ...note, text: 'Windy at the top.' }));
    expect(await a.sync()).toMatchObject({ textsPushed: 1, textConflicts: 0, failures: [] });
    expect(await b.sync()).toMatchObject({ textConflicts: 1, failures: [] });
    const rideName = (await libraryRows(b.on.harness))[0]!.name;
    expect((await documents(b.on)).map((row) => [row.name, row.text])).toStrictEqual([
      [`Ride note on ${rideName} (from another device)`, 'Legs heavy.'],
    ]);
    expect(
      (await b.on.harness.read((store) => store.getRiderText(LOCAL_ATHLETE, 'note', ride)))?.text,
    ).toBe('Windy at the top.');
  }, 60_000);

  it('does not push over the other device’s words when the copy cannot be kept', async () => {
    const { a, b } = await twoWriters();
    const goal = riderTextFor(LOCAL_ATHLETE, 'goal');
    await a.on.harness.write((store) => store.putRiderText({ ...goal, text: 'Ride a century.' }));
    await b.on.harness.write((store) => store.putRiderText({ ...goal, text: 'Climb Ventoux.' }));
    expect(await a.sync()).toMatchObject({ textsPushed: 1, failures: [] });
    // B cannot make a new document: its id is not one the store accepts.
    const report = await b.on.harness.write((store) =>
      syncWithInstance({ ...syncDependencies(b.on, store), newDocumentId: () => 'not/an/id' }),
    );
    expect(report.failures).toEqual([
      expect.objectContaining({ kind: 'goal', reason: 'conflict-not-kept' }),
    ]);
    expect(await instanceItem(a.on, 'goal', 'goals')).toStrictEqual({ text: 'Ride a century.' });
  }, 60_000);

  it('does not send a delete over a newer edit made on another device, and pulls that edit', async () => {
    const { a, b } = await twoWriters();
    const plan = riderTextFor(LOCAL_ATHLETE, 'document');
    await a.on.harness.write((store) => store.putRiderText(plan));
    expect(await a.sync()).toMatchObject({ textsPushed: 1, failures: [] });
    expect(await b.sync()).toMatchObject({ textsPulled: 1, failures: [] });

    // B edits it, and A — not having seen that — deletes it.
    await b.on.harness.write((store) => store.putRiderText({ ...plan, text: 'Week 2: tempo.' }));
    expect(await b.sync()).toMatchObject({ textsPushed: 1, failures: [] });
    await a.on.harness.write((store) => store.deleteRiderText(LOCAL_ATHLETE, 'document', plan.key));
    expect(await a.sync()).toMatchObject({
      textsDeletedOnInstance: 0,
      textsPulled: 1,
      failures: [],
    });
    expect((await documents(a.on)).map((row) => row.text)).toStrictEqual(['Week 2: tempo.']);
    expect(await instanceItem(a.on, 'document', plan.key)).toMatchObject({
      text: 'Week 2: tempo.',
    });
    // Deleted again, now over the copy it knows, the delete goes.
    await a.on.harness.write((store) => store.deleteRiderText(LOCAL_ATHLETE, 'document', plan.key));
    expect(await a.sync()).toMatchObject({ textsDeletedOnInstance: 1, failures: [] });
  }, 60_000);
});

describe('the rider’s saved workouts, through to the agent’s tool (#1100)', () => {
  /** The `workouts` tool's answer for an athlete, on a store opened for this read alone. */
  async function workoutsOnInstance(path: string, athleteId: string): Promise<string> {
    const fresh = await instanceStore.openSqlStore(path);
    try {
      return await instanceTools.WORKOUTS.run({ athleteId, input: {}, reads: fresh }, {});
    } finally {
      await fresh.close();
    }
  }

  /** What the tool should say of a workout: the Workouts screen's own row, in one line. */
  const toolLine = (record: WorkoutRecord): string => {
    const row = workoutRow(record);
    return `Workout: ${row.name} — ${row.duration}: ${row.shape}`;
  };

  const workoutsOn = (on: Device) => on.harness.read((store) => store.listWorkouts(LOCAL_ATHLETE));

  const idsOf = (records: readonly { readonly id: string }[]): string[] =>
    records.map((row) => row.id).sort();

  /** Workout bodies a hand-edited instance could hold, each one this program refuses. */
  const INVALID_WORKOUT_BODIES: readonly (readonly [string, string])[] = [
    // ADR 0017 D-4: an unknown key is refused, not ignored.
    [
      'workout-unknown-key',
      JSON.stringify({
        onYourLeftWorkout: 1,
        name: 'Extra',
        blocks: [{ kind: 'steady', seconds: 60, target: 0.5 }],
        resistanceOverride: 400,
      }),
    ],
    // ADR 0017 D-6: 51 interval blocks of 100 repeats expand past 10 000 segments.
    [
      'workout-over-the-bound',
      JSON.stringify({
        onYourLeftWorkout: 1,
        name: 'Too long',
        blocks: Array.from({ length: 51 }, () => ({
          kind: 'intervals',
          repeats: 100,
          hardSeconds: 1,
          hardTarget: 1,
          easySeconds: 1,
          easyTarget: 0.5,
        })),
      }),
    ],
  ];

  const renamed = (record: WorkoutRecord, name: string): WorkoutRecord => ({
    ...record,
    name,
    workout: { ...record.workout, name },
    updatedAt: unixSeconds(record.updatedAt + 1),
  });

  it('sends a saved workout, and the tool reads it back on a fresh store — for its athlete only', async () => {
    world = await instanceTesting.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
    const origin = instanceTesting.TEST_ORIGIN;
    const a = await signedInDevice(world.url, origin, ['nominal-outdoor-ride.fit']);
    const workout = workoutFor(LOCAL_ATHLETE, { name: 'Over-unders' });
    await a.on.harness.write((store) => store.putWorkout(workout));
    expect(await a.sync()).toMatchObject({ workoutsPushed: 1, failures: [] });

    expect(await workoutsOnInstance(world.path, a.athleteId)).toBe(toolLine(workout));
    // Nothing moves the second time.
    expect(await a.sync()).toMatchObject({ workoutsPushed: 0, failures: [] });

    // Another athlete on the same instance reads none of it.
    const stranger = await signedInDevice(world.url, origin, ['paused-laps.fit']);
    expect(stranger.athleteId).not.toBe(a.athleteId);
    expect(await workoutsOnInstance(world.path, stranger.athleteId)).toBe(
      'The cyclist has no saved workouts synced.',
    );

    // A change here is sent again.
    const changed = renamed(workout, 'Threshold');
    await a.on.harness.write((store) => store.putWorkout(changed));
    expect(await a.sync()).toMatchObject({ workoutsPushed: 1, failures: [] });
    expect(await workoutsOnInstance(world.path, a.athleteId)).toBe(toolLine(changed));
  }, 60_000);

  it('deletes on the instance a workout deleted here, and the tool no longer returns it; another device that brought it back keeps it', async () => {
    world = await instanceTesting.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
    const origin = instanceTesting.TEST_ORIGIN;
    const a = await signedInDevice(world.url, origin, ['nominal-outdoor-ride.fit']);
    const kept = workoutFor(LOCAL_ATHLETE, { name: 'Kept' });
    const gone = workoutFor(LOCAL_ATHLETE, { name: 'Gone' });
    await a.on.harness.write(async (store) => {
      await store.putWorkout(kept);
      await store.putWorkout(gone);
    });
    expect(await a.sync()).toMatchObject({ workoutsPushed: 2, failures: [] });

    // A linked device brings both back (the owner's ruling of 2026-10-10).
    const b = await linkedDevice(world.url, origin, a.on);
    await b.on.harness.write((store) => ensureLocalAthlete(store, NOW));
    expect(await b.sync()).toMatchObject({
      workoutsPulled: 2,
      workoutsPushed: 0,
      workoutsDeletedOnInstance: 0,
      failures: [],
    });
    expect(idsOf(await workoutsOn(b.on))).toStrictEqual(idsOf([kept, gone]));
    expect((await workoutsOn(b.on)).find((row) => row.id === gone.id)?.workout).toStrictEqual(
      gone.workout,
    );

    await a.on.harness.write((store) => store.deleteWorkout(LOCAL_ATHLETE, gone.id));
    expect(await a.sync()).toMatchObject({ workoutsDeletedOnInstance: 1, failures: [] });
    const entry = (await manifestOf(a.on)).find(
      (item) => item.kind === 'workout' && item.key === gone.id,
    );
    expect(entry?.deleted).toBe(true);
    expect(await workoutsOnInstance(world.path, a.athleteId)).toBe(toolLine(kept));
    // Forgotten, so nothing more is asked of the instance, and nothing comes back.
    expect(await a.sync()).toMatchObject({
      workoutsDeletedOnInstance: 0,
      workoutsPushed: 0,
      workoutsPulled: 0,
      failures: [],
    });
    expect(idsOf(await workoutsOn(a.on))).toStrictEqual([kept.id]);

    // Another device's deletion of a workout still here leaves it here.
    expect(await b.sync()).toMatchObject({
      workoutsHiddenOnInstance: 1,
      workoutsDeletedOnInstance: 0,
      workoutsPushed: 0,
      failures: [],
    });
    expect(idsOf(await workoutsOn(b.on))).toStrictEqual(idsOf([kept, gone]));
  }, 60_000);

  it('deletes a workout deleted here even over a change another device made since, and never brings it back', async () => {
    world = await instanceTesting.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
    const origin = instanceTesting.TEST_ORIGIN;
    const a = await signedInDevice(world.url, origin, ['nominal-outdoor-ride.fit']);
    const workout = workoutFor(LOCAL_ATHLETE, { name: 'Contested' });
    await a.on.harness.write((store) => store.putWorkout(workout));
    expect(await a.sync()).toMatchObject({ workoutsPushed: 1, failures: [] });
    const b = await linkedDevice(world.url, origin, a.on);
    await b.on.harness.write((store) => ensureLocalAthlete(store, NOW));
    expect(await b.sync()).toMatchObject({ workoutsPulled: 1, failures: [] });

    // B changes it there; A deletes it here. A's change wins.
    await b.on.harness.write((store) => store.putWorkout(renamed(workout, 'Changed on B')));
    expect(await b.sync()).toMatchObject({ workoutsPushed: 1, failures: [] });
    await a.on.harness.write((store) => store.deleteWorkout(LOCAL_ATHLETE, workout.id));
    expect(await a.sync()).toMatchObject({
      workoutsDeletedOnInstance: 1,
      workoutsPulled: 0,
      failures: [],
    });
    expect(await a.sync()).toMatchObject({ workoutsPulled: 0, failures: [] });
    expect(await workoutsOn(a.on)).toStrictEqual([]);
    expect(
      (await manifestOf(a.on)).find((item) => item.kind === 'workout' && item.key === workout.id)
        ?.deleted,
    ).toBe(true);
  }, 60_000);

  it('brings back a change made on another device, and sends this device’s over one made there too', async () => {
    world = await instanceTesting.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
    const origin = instanceTesting.TEST_ORIGIN;
    const a = await signedInDevice(world.url, origin, ['nominal-outdoor-ride.fit']);
    const workout = workoutFor(LOCAL_ATHLETE, { name: 'Both' });
    await a.on.harness.write((store) => store.putWorkout(workout));
    expect(await a.sync()).toMatchObject({ workoutsPushed: 1, failures: [] });
    const b = await linkedDevice(world.url, origin, a.on);
    await b.on.harness.write((store) => ensureLocalAthlete(store, NOW));
    expect(await b.sync()).toMatchObject({ workoutsPulled: 1, failures: [] });

    // Changed on B only: A, unchanged since, brings it back.
    await b.on.harness.write((store) => store.putWorkout(renamed(workout, 'From B')));
    expect(await b.sync()).toMatchObject({ workoutsPushed: 1, failures: [] });
    expect(await a.sync()).toMatchObject({ workoutsPulled: 1, workoutsPushed: 0, failures: [] });
    expect((await workoutsOn(a.on)).map((row) => row.name)).toStrictEqual(['From B']);

    // Changed on both: each device's own change wins on it, and is sent.
    await b.on.harness.write(async (store) =>
      store.putWorkout(renamed((await store.getWorkout(LOCAL_ATHLETE, workout.id))!, 'B again')),
    );
    expect(await b.sync()).toMatchObject({ workoutsPushed: 1, failures: [] });
    await a.on.harness.write(async (store) =>
      store.putWorkout(renamed((await store.getWorkout(LOCAL_ATHLETE, workout.id))!, 'A wins')),
    );
    expect(await a.sync()).toMatchObject({ workoutsPushed: 1, workoutsPulled: 0, failures: [] });
    expect((await workoutsOn(a.on)).map((row) => row.name)).toStrictEqual(['A wins']);
    expect(await instanceItem(a.on, 'workout', workout.id)).toMatchObject({ name: 'A wins' });
    // B, unchanged since its own push, now brings A's back.
    expect(await b.sync()).toMatchObject({ workoutsPulled: 1, workoutsPushed: 0, failures: [] });
    expect((await workoutsOn(b.on)).map((row) => row.name)).toStrictEqual(['A wins']);
  }, 60_000);

  it('writes nothing, and remembers nothing, for a workout on the instance this program would not read', async () => {
    world = await instanceTesting.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
    const origin = instanceTesting.TEST_ORIGIN;
    const a = await signedInDevice(world.url, origin, ['nominal-outdoor-ride.fit']);
    const good = workoutFor(LOCAL_ATHLETE, { name: 'Good' });
    for (const [key, body] of [
      ['workout-good', encodeWorkoutFile(good.workout)],
      ...INVALID_WORKOUT_BODIES,
    ] as const) {
      const put = await a.on.transport.sync.json(
        'POST',
        `/v1/sync/items/workout/${encodeURIComponent(key)}`,
        { body },
      );
      expect(put.status, key).toBe(200);
    }
    const report = await a.sync();
    expect(report).toMatchObject({ workoutsPulled: 1, workoutsPushed: 0 });
    expect(report.failures).toStrictEqual(
      INVALID_WORKOUT_BODIES.map(([key]) => ({
        kind: 'workout',
        key,
        reason: 'not-a-workout',
      })).sort((one, other) => one.key.localeCompare(other.key)),
    );
    expect(idsOf(await workoutsOn(a.on))).toStrictEqual(['workout-good']);
    const baseKeys = await a.on.harness.read(async (store) =>
      (await store.listSyncBase(LOCAL_ATHLETE))
        .filter((row) => row.kind === 'workout')
        .map((row) => row.key),
    );
    expect(baseKeys).toStrictEqual(['workout-good']);
    // Asked again next time, and refused again.
    expect((await a.sync()).failures).toHaveLength(INVALID_WORKOUT_BODIES.length);
  }, 60_000);

  it('keeps a workout the instance deleted, and sends it again only once it is changed here', async () => {
    world = await instanceTesting.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
    const origin = instanceTesting.TEST_ORIGIN;
    const a = await signedInDevice(world.url, origin, ['nominal-outdoor-ride.fit']);
    const workout = workoutFor(LOCAL_ATHLETE, { name: 'Sweet spot' });
    await a.on.harness.write((store) => store.putWorkout(workout));
    expect(await a.sync()).toMatchObject({ workoutsPushed: 1, failures: [] });

    const deleted = await a.on.transport.sync.json(
      'DELETE',
      `/v1/sync/items/workout/${encodeURIComponent(workout.id)}`,
    );
    expect(deleted.status).toBeLessThan(300);
    expect(await a.sync()).toMatchObject({
      workoutsHiddenOnInstance: 1,
      workoutsPushed: 0,
      failures: [],
    });
    expect((await workoutsOn(a.on)).map((row) => row.id)).toStrictEqual([workout.id]);

    await a.on.harness.write((store) => store.putWorkout(renamed(workout, 'Sweet spot 2')));
    expect(await a.sync()).toMatchObject({ workoutsPushed: 1, failures: [] });
  }, 60_000);

  it('sends and deletes nothing of the workouts when their list cannot be read', async () => {
    world = await instanceTesting.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
    const origin = instanceTesting.TEST_ORIGIN;
    const a = await signedInDevice(world.url, origin, ['nominal-outdoor-ride.fit']);
    const workout = workoutFor(LOCAL_ATHLETE, { name: 'Kept on the instance' });
    await a.on.harness.write((store) => store.putWorkout(workout));
    expect(await a.sync()).toMatchObject({ workoutsPushed: 1, failures: [] });

    const report = await a.on.harness.write((store) =>
      syncWithInstance(
        syncDependencies(
          a.on,
          // The store's methods read private fields, so each is bound to it.
          new Proxy(store, {
            get: (target, property) => {
              if (property === 'listWorkouts') return () => Promise.reject(new Error('unreadable'));
              const value = Reflect.get(target, property) as unknown;
              return typeof value === 'function'
                ? (value as (...args: unknown[]) => unknown).bind(target)
                : value;
            },
          }),
        ),
      ),
    );
    expect(report).toMatchObject({ workoutsDeletedOnInstance: 0, workoutsPushed: 0 });
    expect(report.failures).toStrictEqual([{ kind: 'workout', key: '', reason: 'not-read' }]);
    expect(await workoutsOnInstance(world.path, a.athleteId)).toBe(toolLine(workout));
  }, 60_000);
});

describe('the rider’s typed workout goals, through to the agent’s read port (#1237)', () => {
  /**
   * The typed goals as the agent's read port serves them (`AnalysisReads`),
   * on a store opened for this read alone — each body read back WHOLE by
   * `readWorkoutGoals`, or `null` where it is not goals.
   */
  async function goalsOnInstance(
    path: string,
    athleteId: string,
    kind = 'workout-goal',
  ): Promise<readonly (WorkoutGoals | null)[]> {
    const fresh = await instanceStore.openSqlStore(path);
    try {
      const items = await fresh.listLiveSyncItems(athleteId, kind, 10);
      return items.map((item) => {
        try {
          const reading = readWorkoutGoals(
            JSON.parse(new TextDecoder().decode(item.body ?? new Uint8Array())),
          );
          return reading.ok ? reading.goals : null;
        } catch {
          return null;
        }
      });
    } finally {
      await fresh.close();
    }
  }

  const GOALS: WorkoutGoals = {
    sessionType: 'endurance',
    durationMinutes: 90,
    holdRange: { low: beatsPerMinute(128), high: beatsPerMinute(138) },
    heartRateAbove: beatsPerMinute(150),
    powerCeiling: thresholdShare(0.75),
    timeInRangeMinutes: 60,
    effortCheckIns: true,
  };

  const saved = (goals: WorkoutGoals): WorkoutGoalsRecord => ({
    athleteId: LOCAL_ATHLETE,
    goals,
    savedAt: NOW,
  });

  const goalsOn = (on: Device) => on.harness.read((store) => store.getWorkoutGoals(LOCAL_ATHLETE));

  it('sends the goals, and the agent’s read port reads them back on a fresh store — that kind and that athlete only', async () => {
    world = await instanceTesting.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
    const origin = instanceTesting.TEST_ORIGIN;
    const a = await signedInDevice(world.url, origin, ['nominal-outdoor-ride.fit']);
    await a.on.harness.write((store) => store.putWorkoutGoals(saved(GOALS)));
    expect(await a.sync()).toMatchObject({ workoutGoalsPushed: 1, failures: [] });

    expect(await goalsOnInstance(world.path, a.athleteId)).toStrictEqual([GOALS]);
    // Not under #836's free-text kind, which never sets a bound.
    expect(await goalsOnInstance(world.path, a.athleteId, 'goal')).toStrictEqual([]);
    // Nothing moves the second time.
    expect(await a.sync()).toMatchObject({ workoutGoalsPushed: 0, failures: [] });

    // Another athlete on the same instance reads none of it.
    const stranger = await signedInDevice(world.url, origin, ['paused-laps.fit']);
    expect(stranger.athleteId).not.toBe(a.athleteId);
    expect(await goalsOnInstance(world.path, stranger.athleteId)).toStrictEqual([]);

    // A change here is sent again.
    const changed: WorkoutGoals = { ...GOALS, powerCeiling: thresholdShare(0.7) };
    await a.on.harness.write((store) => store.putWorkoutGoals(saved(changed)));
    expect(await a.sync()).toMatchObject({ workoutGoalsPushed: 1, failures: [] });
    expect(await goalsOnInstance(world.path, a.athleteId)).toStrictEqual([changed]);
  }, 60_000);

  it('removes the goals from the instance at the next sync once they are cleared here, and never brings them back', async () => {
    world = await instanceTesting.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
    const origin = instanceTesting.TEST_ORIGIN;
    const a = await signedInDevice(world.url, origin, ['nominal-outdoor-ride.fit']);
    await a.on.harness.write((store) => store.putWorkoutGoals(saved(GOALS)));
    expect(await a.sync()).toMatchObject({ workoutGoalsPushed: 1, failures: [] });

    await a.on.harness.write((store) => store.deleteWorkoutGoals(LOCAL_ATHLETE));
    expect(await a.sync()).toMatchObject({ workoutGoalsDeletedOnInstance: 1, failures: [] });
    const entry = (await manifestOf(a.on)).find(
      (item) => item.kind === 'workout-goal' && item.key === 'goals',
    );
    expect(entry?.deleted).toBe(true);
    expect(await goalsOnInstance(world.path, a.athleteId)).toStrictEqual([]);
    // Forgotten: nothing more is asked, and nothing comes back.
    expect(await a.sync()).toMatchObject({
      workoutGoalsDeletedOnInstance: 0,
      workoutGoalsPushed: 0,
      workoutGoalsPulled: 0,
      failures: [],
    });
    expect(await goalsOn(a.on)).toStrictEqual({ status: 'none' });
  }, 60_000);

  it('brings the goals to a linked device, takes a change made on another device, and keeps them there when another device clears them', async () => {
    world = await instanceTesting.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
    const origin = instanceTesting.TEST_ORIGIN;
    const a = await signedInDevice(world.url, origin, ['nominal-outdoor-ride.fit']);
    await a.on.harness.write((store) => store.putWorkoutGoals(saved(GOALS)));
    expect(await a.sync()).toMatchObject({ workoutGoalsPushed: 1, failures: [] });

    const b = await linkedDevice(world.url, origin, a.on);
    await b.on.harness.write((store) => ensureLocalAthlete(store, NOW));
    expect(await b.sync()).toMatchObject({ workoutGoalsPulled: 1, failures: [] });
    expect(await goalsOn(b.on)).toStrictEqual({ status: 'kept', record: saved(GOALS) });

    // Changed on A: B, unchanged since, takes it.
    const changed: WorkoutGoals = { sessionType: 'recovery', durationMinutes: 45 };
    await a.on.harness.write((store) => store.putWorkoutGoals(saved(changed)));
    expect(await a.sync()).toMatchObject({ workoutGoalsPushed: 1, failures: [] });
    expect(await b.sync()).toMatchObject({ workoutGoalsPulled: 1, workoutGoalsPushed: 0 });
    expect(await goalsOn(b.on)).toStrictEqual({ status: 'kept', record: saved(changed) });

    // Cleared on A: B, unchanged since, keeps them and does not send them back.
    await a.on.harness.write((store) => store.deleteWorkoutGoals(LOCAL_ATHLETE));
    expect(await a.sync()).toMatchObject({ workoutGoalsDeletedOnInstance: 1 });
    expect(await b.sync()).toMatchObject({
      workoutGoalsHiddenOnInstance: 1,
      workoutGoalsPushed: 0,
      failures: [],
    });
    expect(await goalsOn(b.on)).toStrictEqual({ status: 'kept', record: saved(changed) });
  }, 60_000);

  it('writes nothing, and remembers nothing, for goals on the instance this program would not read', async () => {
    world = await instanceTesting.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
    const origin = instanceTesting.TEST_ORIGIN;
    const a = await signedInDevice(world.url, origin, ['nominal-outdoor-ride.fit']);
    // A ceiling over ADR 0048 H3's 0.85, as a hand-edited instance could hold.
    const answer = await a.on.transport.sync.json('POST', '/v1/sync/items/workout-goal/goals', {
      body: JSON.stringify({ powerCeiling: 0.95 }),
    });
    expect(answer.status).toBe(200);

    const b = await linkedDevice(world.url, origin, a.on);
    await b.on.harness.write((store) => ensureLocalAthlete(store, NOW));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const report = await b.sync();
      expect(report.workoutGoalsPulled).toBe(0);
      expect(report.failures).toContainEqual({
        kind: 'workout-goal',
        key: 'goals',
        reason: 'not-workout-goals',
      });
    }
    expect(await goalsOn(b.on)).toStrictEqual({ status: 'none' });
    const bases = await b.on.harness.read((store) => store.listSyncBase(LOCAL_ATHLETE));
    expect(bases.filter((row) => row.kind === 'workout-goal')).toStrictEqual([]);
  }, 60_000);

  it('sends and deletes nothing of the goals when they cannot be read here', async () => {
    world = await instanceTesting.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
    const origin = instanceTesting.TEST_ORIGIN;
    const a = await signedInDevice(world.url, origin, ['nominal-outdoor-ride.fit']);
    await a.on.harness.write((store) => store.putWorkoutGoals(saved(GOALS)));
    expect(await a.sync()).toMatchObject({ workoutGoalsPushed: 1, failures: [] });

    const report = await a.on.harness.write((store) =>
      syncWithInstance(
        syncDependencies(
          a.on,
          new Proxy(store, {
            get: (target, property) => {
              if (property === 'getWorkoutGoals') {
                return () => Promise.resolve({ status: 'fault', fault: 'workoutGoals: bad' });
              }
              const value = Reflect.get(target, property) as unknown;
              return typeof value === 'function'
                ? (value as (...args: unknown[]) => unknown).bind(target)
                : value;
            },
          }),
        ),
      ),
    );
    expect(report).toMatchObject({ workoutGoalsDeletedOnInstance: 0, workoutGoalsPushed: 0 });
    expect(report.failures).toStrictEqual([
      { kind: 'workout-goal', key: 'goals', reason: 'not-read' },
    ]);
    expect(await goalsOnInstance(world.path, a.athleteId)).toStrictEqual([GOALS]);
  }, 60_000);
});
