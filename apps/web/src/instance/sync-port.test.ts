// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The sync port (#1195) against the REAL instance: what it offers, that every
 * request it makes is sealed, what a sync that fails part-way reports and
 * leaves, and what admitting a key writes. The shell half — the screen, the
 * press, the device staying canonical — is `sync-shell.test.tsx`.
 */

import { readFileSync } from 'node:fs';

import { toHex, unixSeconds } from '@onyourleft/domain';
import {
  activityId as toActivityId,
  ensureDeviceSigningKey,
  webCryptoSha256,
  type ActivityId,
} from '@onyourleft/store';
import {
  createStoreHarness,
  type PersistentStore,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ensureLocalAthlete, LOCAL_ATHLETE } from '../local-athlete';
import { rideSummaryOf } from '../ride-analysis/ride-summary';
import { importActivityFiles } from '../transfer/import-batch';
import { WEB_BUILD_TEXT, type LoadedFrom } from './instance-pin';
import {
  createInstancePort,
  INSTANCE_SESSION_STORAGE_KEY,
  type InstanceStorage,
} from './instance-port';
import type { InstanceSend } from './instance-transport';
import { answeringTransport, createSyncPort, SYNC_REFUSAL_TEXT } from './sync-port';
import { INSTANCE_ACCOUNT_STORAGE_KEY } from './sign-in';
import { LOADED_FROM_A_WEBSITE, LOADED_LOCALLY } from './testing';

interface IdentityInstance {
  readonly instance: { handler(request: Request): Promise<Response> };
  readonly instanceKeys: { show(): Promise<{ readonly card: string }> };
  close(): Promise<void>;
}

interface IdentityTesting {
  readonly TEST_ORIGIN: string;
  startIdentityInstance(options?: { bodyLimitBytes?: number }): Promise<IdentityInstance>;
}

const INSTANCE = (path: string): string =>
  new URL(`../../../instance/src/${path}`, import.meta.url).href;
const CORPUS = new URL('../../../../packages/fit/fixtures/corpus/', import.meta.url);
const NOW = unixSeconds(1_790_000_000);

let testing: IdentityTesting;
const worlds: IdentityInstance[] = [];
const harnesses: StoreHarness[] = [];

beforeAll(async () => {
  testing = (await import(
    /* @vite-ignore */ INSTANCE('auth/identity-testing.ts')
  )) as IdentityTesting;
});

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
  for (const harness of harnesses.splice(0)) await harness.destroy();
});

async function world(): Promise<IdentityInstance> {
  const started = await testing.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
  worlds.push(started);
  return started;
}

/** Every request, handed to the instance's own handler, counted — and dropped where told. */
function wire(on: IdentityInstance) {
  const seen: string[] = [];
  /** The ordinals of SEALED requests to drop, unsent, as a network that lost them would. */
  const drop = new Set<number>();
  let sealedCount = 0;
  const send: InstanceSend = async (url, init) => {
    const path = `${init.method ?? 'GET'} ${new URL(url).pathname}`;
    seen.push(path);
    if (path === 'POST /v1/sealed') {
      sealedCount += 1;
      if (drop.has(sealedCount)) throw new TypeError('the network went away');
    }
    return on.instance.handler(new Request(url, init));
  };
  return {
    send,
    seen,
    drop,
    resetCount: () => {
      sealedCount = 0;
    },
  };
}

function mapStorage(): InstanceStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

async function device(send: InstanceSend, loadedFrom: LoadedFrom = LOADED_LOCALLY) {
  const harness = createStoreHarness();
  harnesses.push(harness);
  let open: PersistentStore | undefined;
  await harness.write((store) => {
    open = store;
    return Promise.resolve();
  });
  const store = (): PersistentStore => open as PersistentStore;
  const storage = mapStorage();
  const signingKey = () => ensureDeviceSigningKey(store(), LOCAL_ATHLETE, { now: () => NOW });
  const sealing = { storage, loadedFrom, signingKey, send, now: () => NOW * 1000 };
  const instance = createInstancePort({
    ...sealing,
    ensureLocalAthlete: () => ensureLocalAthlete(store(), NOW),
  });
  const sync = createSyncPort({
    ...sealing,
    store,
    athleteId: LOCAL_ATHLETE,
    timeZone: 'Europe/London',
    rideSummary: (id) => rideSummaryOf(store(), LOCAL_ATHLETE)(id),
    newDocumentId: () => crypto.randomUUID(),
  });
  return { harness, storage, store, instance, sync };
}

let rideCounter = 0;
async function importRides(harness: StoreHarness, names: readonly string[]): Promise<ActivityId[]> {
  await harness.write((store) => ensureLocalAthlete(store, NOW));
  const report = await harness.write((store) =>
    importActivityFiles({
      sources: names.map((name) => ({
        fileName: name,
        bytes: () => Promise.resolve(new Uint8Array(readFileSync(new URL(name, CORPUS)))),
      })),
      store,
      athleteId: LOCAL_ATHLETE,
      newActivityId: () => toActivityId(`port-ride-${String((rideCounter += 1))}`),
      now: () => NOW,
      digest: async (bytes) => toHex(await webCryptoSha256(bytes)),
      timeZone: 'Europe/London',
    }),
  );
  expect(report.imported).toBe(names.length);
  return report.outcomes.map((outcome) => outcome.activityId as ActivityId);
}

/** Every ride row on the device, whole. */
const rideRows = (on: Awaited<ReturnType<typeof device>>) =>
  on.harness.write(async (store) =>
    JSON.stringify(
      await store.listActivitySummaries(LOCAL_ATHLETE, {
        orderBy: 'startedAt',
        direction: 'ascending',
        limit: 50,
      }),
    ),
  );

describe('what the sync port offers (#1195)', () => {
  it('offers nothing and sends nothing on a device with no instance', async () => {
    const w = await world();
    const net = wire(w);
    const on = await device(net.send);
    expect(on.sync.availability()).toEqual({ kind: 'none' });
    expect((await on.sync.sync()).kind).toBe('refused');
    expect(net.seen).toEqual([]);
  });

  it('is closed with the web-build sentence in a copy a website served, and sends nothing', async () => {
    const w = await world();
    const net = wire(w);
    const local = await device(net.send);
    await importRides(local.harness, []);
    const card = (await w.instanceKeys.show()).card;
    expect(await local.instance.connect(testing.TEST_ORIGIN, 'Anna', card)).toMatchObject({
      kind: 'connected',
    });
    const website = await device(net.send, LOADED_FROM_A_WEBSITE);
    for (const key of [INSTANCE_ACCOUNT_STORAGE_KEY, INSTANCE_SESSION_STORAGE_KEY]) {
      const value = local.storage.getItem(key);
      if (value !== null) website.storage.setItem(key, value);
    }
    net.seen.length = 0;
    expect(website.sync.availability()).toEqual({ kind: 'closed', text: WEB_BUILD_TEXT });
    expect(await website.sync.sync()).toEqual({ kind: 'refused', text: WEB_BUILD_TEXT });
    expect(net.seen).toEqual([]);
  });
});

describe('every request a sync makes is sealed (#1195, ADR 0047 D-7)', () => {
  it('reaches the instance only through POST /v1/sealed, after reading its keys', async () => {
    const w = await world();
    const net = wire(w);
    const on = await device(net.send);
    await importRides(on.harness, ['nominal-outdoor-ride.fit', 'paused-laps.fit']);
    const card = (await w.instanceKeys.show()).card;
    await on.instance.connect(testing.TEST_ORIGIN, 'Anna', card);
    expect(on.sync.availability()).toEqual({ kind: 'offered' });
    net.seen.length = 0;
    const outcome = await on.sync.sync();
    expect(outcome).toMatchObject({ kind: 'synced', report: { pushed: 2, failures: [] } });
    expect(new Set(net.seen)).toEqual(new Set(['GET /v1/instance/keys', 'POST /v1/sealed']));
  });

  it('joins a sync already running rather than starting a second', async () => {
    const w = await world();
    const net = wire(w);
    const on = await device(net.send);
    await importRides(on.harness, ['paused-laps.fit']);
    await on.instance.connect(testing.TEST_ORIGIN, 'Anna', (await w.instanceKeys.show()).card);
    const first = on.sync.sync();
    expect(on.sync.sync()).toBe(first);
    expect(await first).toMatchObject({ kind: 'synced', report: { pushed: 1 } });
  });
});

describe('a sync that fails part-way (#1195)', () => {
  it('reports what failed, leaves every local row as it was, and sends it again next time', async () => {
    const w = await world();
    const net = wire(w);
    const on = await device(net.send);
    const ids = await importRides(on.harness, ['nominal-outdoor-ride.fit', 'paused-laps.fit']);
    await on.instance.connect(testing.TEST_ORIGIN, 'Anna', (await w.instanceKeys.show()).card);
    const before = await rideRows(on);
    // Sealed request 1 reads the manifest, 2 pushes the first ride, 3 the second: lost.
    net.resetCount();
    net.drop.add(3);
    const first = await on.sync.sync();
    expect(first).toMatchObject({
      kind: 'synced',
      report: { pushed: 1, failures: [{ kind: 'activity', key: ids[1], reason: 'no-answer' }] },
    });
    expect(await rideRows(on)).toBe(before);
    net.drop.clear();
    const second = await on.sync.sync();
    expect(second).toMatchObject({ kind: 'synced', report: { pushed: 1, failures: [] } });
    expect(await rideRows(on)).toBe(before);
  });

  it('stops, and says so, when the manifest itself is not answered', async () => {
    const w = await world();
    const net = wire(w);
    const on = await device(net.send);
    await importRides(on.harness, ['paused-laps.fit']);
    await on.instance.connect(testing.TEST_ORIGIN, 'Anna', (await w.instanceKeys.show()).card);
    net.resetCount();
    net.drop.add(1);
    expect(await on.sync.sync()).toEqual({ kind: 'refused', text: SYNC_REFUSAL_TEXT['no-answer'] });
  });

  it('turns a request that throws into an answer of that one thing, never a thrown sync', async () => {
    const failing = answeringTransport({
      json: () => Promise.reject(new Error('gone')),
      bytes: () => Promise.reject(new Error('gone')),
    });
    expect(await failing.json('GET', '/v1/sync/manifest')).toEqual({
      status: 0,
      body: { error: { code: 'no-answer' } },
    });
    expect((await failing.bytes('/v1/sync/files/x')).status).toBe(0);
  });
});

describe('admitting a key (#1195, #898)', () => {
  it('writes an admitted key, refuses what is not one, and never writes this device’s own', async () => {
    const w = await world();
    const net = wire(w);
    const on = await device(net.send);
    await importRides(on.harness, []);
    const trusted = () => on.store().listTrustedDeviceKeys(LOCAL_ATHLETE);
    const other = 'ab'.repeat(32);
    for (const bad of ['AB'.repeat(32), 'ab'.repeat(31), 'not a key']) {
      expect(await on.sync.admitKey(bad)).toEqual({
        kind: 'refused',
        text: SYNC_REFUSAL_TEXT['not-a-key'],
      });
    }
    const own = toHex((await ensureDeviceSigningKey(on.store(), LOCAL_ATHLETE)).publicKey);
    expect(await on.sync.admitKey(own)).toEqual({ kind: 'admitted' });
    expect(await trusted()).toEqual([]);
    expect(await on.sync.admitKey(other)).toEqual({ kind: 'admitted' });
    expect((await trusted()).map((row) => row.publicKey)).toEqual([other]);
    expect(net.seen).toEqual([]);
  });
});
