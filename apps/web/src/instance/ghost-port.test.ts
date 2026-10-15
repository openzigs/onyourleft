// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Another rider's ghost (#331, ADR 0039), end to end against the REAL
 * instance: Bea rides a route, says it may be raced, and syncs; Anna, a
 * different athlete who imported the same route file, asks for a ghost on it
 * and is given ONE — Bea's — through the sealed session, built into a track by
 * the same integrator her own ghost uses. And everything that must give no
 * ghost: no consent, a zone on the route, Anna's own ride, no instance, a
 * website's copy, and an answer that is not a ghost.
 */

import { readFileSync } from 'node:fs';

import { toHex, unixSeconds, type RouteProfile } from '@onyourleft/domain';
import { decodeGpxRoute } from '@onyourleft/fit';
import {
  activityId as toActivityId,
  ensureDeviceSigningKey,
  routeId as toRouteId,
  webCryptoSha256,
  type ActivityId,
} from '@onyourleft/store';
import {
  createStoreHarness,
  type PersistentStore,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { raceRouteOf } from '../detail/race-consent';
import { ghostFromSpeed } from '../game/ghost-source';
import { ensureLocalAthlete, LOCAL_ATHLETE } from '../local-athlete';
import { rideSummaryOf } from '../ride-analysis/ride-summary';
import { importActivityFiles } from '../transfer/import-batch';
import { createGhostPort, parseRiderGhost } from './ghost-port';
import type { LoadedFrom } from './instance-pin';
import {
  createInstancePort,
  INSTANCE_SESSION_STORAGE_KEY,
  type InstanceStorage,
} from './instance-port';
import type { InstanceSend } from './instance-transport';
import { INSTANCE_ACCOUNT_STORAGE_KEY } from './sign-in';
import { createSyncPort } from './sync-port';
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

async function world(): Promise<{ w: IdentityInstance; send: InstanceSend; seen: string[] }> {
  const w = await testing.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
  worlds.push(w);
  const seen: string[] = [];
  const send: InstanceSend = async (url, init) => {
    seen.push(`${init.method ?? 'GET'} ${new URL(url).pathname}`);
    return w.instance.handler(new Request(url, init));
  };
  return { w, send, seen };
}

function mapStorage(): InstanceStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

/** The route file both riders imported, decoded on each device as an import does. */
function importedRoute(): RouteProfile {
  return decodeGpxRoute(readFileSync(new URL('planned-loop-route.gpx', CORPUS), 'utf8'), {
    loop: true,
  }).profile;
}

let counter = 0;
async function device(send: InstanceSend, loadedFrom: LoadedFrom = LOADED_LOCALLY) {
  const harness = createStoreHarness();
  harnesses.push(harness);
  let open: PersistentStore | undefined;
  await harness.write((store) => {
    open = store;
    return ensureLocalAthlete(store, NOW);
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
    raceRoute: (id) => raceRouteOf(store(), LOCAL_ATHLETE, webCryptoSha256)(id),
  });
  const ghosts = createGhostPort(sealing);
  const route = { id: toRouteId(`route-${String((counter += 1))}`), profile: importedRoute() };
  await harness.write((store) =>
    store.putRoute({
      id: route.id,
      createdBy: LOCAL_ATHLETE,
      name: 'The loop',
      profile: route.profile,
      visibility: 'private',
      createdAt: NOW,
      updatedAt: NOW,
    }),
  );
  return { harness, storage, instance, sync, ghosts, route };
}

type Device = Awaited<ReturnType<typeof device>>;

/** A ride on the device's saved route, imported from the corpus. */
async function rideOnRoute(on: Device, mayBeRaced: boolean): Promise<ActivityId> {
  const report = await on.harness.write((store) =>
    importActivityFiles({
      sources: [
        {
          fileName: 'nominal-outdoor-ride.fit',
          bytes: () =>
            Promise.resolve(
              new Uint8Array(readFileSync(new URL('nominal-outdoor-ride.fit', CORPUS))),
            ),
        },
      ],
      store,
      athleteId: LOCAL_ATHLETE,
      newActivityId: () => toActivityId(`ghost-ride-${String((counter += 1))}`),
      now: () => NOW,
      digest: async (bytes) => toHex(await webCryptoSha256(bytes)),
      timeZone: 'Europe/London',
    }),
  );
  const id = report.outcomes[0]?.activityId as ActivityId;
  await on.harness.write(async (store) => {
    const ride = await store.getActivity(LOCAL_ATHLETE, id);
    await store.putActivity({ ...ride!, routeId: on.route.id, mayBeRaced });
  });
  return id;
}

/** Sync twice: the ride goes in the first, its consent and offer in the second. */
async function syncFully(on: Device): Promise<void> {
  expect(await on.sync.sync()).toMatchObject({ kind: 'synced', report: { failures: [] } });
  expect(await on.sync.sync()).toMatchObject({ kind: 'synced', report: { failures: [] } });
}

async function connected(send: InstanceSend, w: IdentityInstance, name: string): Promise<Device> {
  const on = await device(send);
  const card = (await w.instanceKeys.show()).card;
  expect(await on.instance.connect(testing.TEST_ORIGIN, name, card)).toMatchObject({
    kind: 'connected',
  });
  return on;
}

describe('another rider’s ghost, from the instance (#331)', () => {
  it('gives Anna ONE ghost on the route she holds — Bea’s, by name — and it replays', async () => {
    const { w, send, seen } = await world();
    const bea = await connected(send, w, 'Bea');
    await rideOnRoute(bea, true);
    await syncFully(bea);
    const anna = await connected(send, w, 'Anna');

    seen.length = 0;
    const answer = await anna.ghosts.riderGhost(anna.route.profile);

    expect(answer.kind).toBe('ghost');
    if (answer.kind !== 'ghost') return;
    expect(answer.ghost.rider).toBe('Bea');
    // Sealed, like every instance call: the route's digest never leaves in the clear.
    expect(new Set(seen)).toEqual(new Set(['GET /v1/instance/keys', 'POST /v1/sealed']));
    // What `main.tsx` does with it: the same integrator as the rider's own ghost.
    const track = ghostFromSpeed(answer.ghost);
    expect(track.totalDistance).toBeGreaterThan(0);
  }, 20_000);

  it('gives no ghost of a ride its rider did not say may be raced', async () => {
    const { w, send } = await world();
    const bea = await connected(send, w, 'Bea');
    await rideOnRoute(bea, false);
    await syncFully(bea);
    const anna = await connected(send, w, 'Anna');

    expect(await anna.ghosts.riderGhost(anna.route.profile)).toEqual({ kind: 'none' });
  }, 20_000);

  it('gives no ghost of a ride whose rider’s privacy zone touches the route', async () => {
    const { w, send } = await world();
    const bea = await connected(send, w, 'Bea');
    await rideOnRoute(bea, true);
    await bea.harness.write((store) =>
      store.putPrivacyZone({
        id: 'zone-home' as never,
        athleteId: LOCAL_ATHLETE,
        centre: bea.route.profile.positions[0]!,
        radius: 100 as never,
        label: 'Home',
        createdAt: NOW,
      }),
    );
    await syncFully(bea);
    const anna = await connected(send, w, 'Anna');

    expect(await anna.ghosts.riderGhost(anna.route.profile)).toEqual({ kind: 'none' });
  }, 20_000);

  it('never gives a rider a ghost of their own ride', async () => {
    const { w, send } = await world();
    const bea = await connected(send, w, 'Bea');
    await rideOnRoute(bea, true);
    await syncFully(bea);

    expect(await bea.ghosts.riderGhost(bea.route.profile)).toEqual({ kind: 'none' });
  }, 20_000);
});

describe('who is offered the choice (#331)', () => {
  it('is not offered, and sends nothing, on a device with no instance', async () => {
    const { send, seen } = await world();
    const alone = await device(send);
    expect(alone.ghosts.offered()).toBe(false);
    expect(await alone.ghosts.riderGhost(alone.route.profile)).toEqual({ kind: 'unavailable' });
    expect(seen).toEqual([]);
  });

  it('is offered once connected, and not in a copy a website served', async () => {
    const { w, send, seen } = await world();
    const anna = await connected(send, w, 'Anna');
    expect(anna.ghosts.offered()).toBe(true);

    const website = await device(send, LOADED_FROM_A_WEBSITE);
    for (const key of [INSTANCE_ACCOUNT_STORAGE_KEY, INSTANCE_SESSION_STORAGE_KEY]) {
      const value = anna.storage.getItem(key);
      if (value !== null) website.storage.setItem(key, value);
    }
    seen.length = 0;
    expect(website.ghosts.offered()).toBe(false);
    expect(await website.ghosts.riderGhost(website.route.profile)).toEqual({
      kind: 'unavailable',
    });
    expect(seen).toEqual([]);
  });
});

describe('what is taken as a ghost (#331)', () => {
  const good = { rider: 'Bea', sampleInterval: 1, speed: [5, null, 6] };

  it('takes one ghost, or none', () => {
    expect(parseRiderGhost({ ghost: good })).toEqual({
      rider: 'Bea',
      sampleIntervalSeconds: 1,
      speed: [5, undefined, 6],
    });
    expect(parseRiderGhost({ ghost: null })).toBeNull();
  });

  it('refuses anything that is not exactly one ghost', () => {
    for (const body of [
      null,
      [],
      { ghosts: [good] },
      { ghost: [good] },
      { ghost: good, next: good },
      { ghost: { ...good, latitude: 51.5 } },
      { ghost: { ...good, rider: 'Bea‮' } },
      { ghost: { ...good, rider: '' } },
      { ghost: { ...good, sampleInterval: 0 } },
      { ghost: { ...good, sampleInterval: 1.5 } },
      { ghost: { ...good, speed: [5] } },
      { ghost: { ...good, speed: [5, -1] } },
      { ghost: { ...good, speed: [5, 'fast'] } },
      { ghost: { ...good, speed: [5, Number.POSITIVE_INFINITY] } },
      { ghost: { ...good, speed: new Array<number>(7201).fill(5) } },
    ]) {
      expect(parseRiderGhost(body), JSON.stringify(body)).toBeUndefined();
    }
  });
});
