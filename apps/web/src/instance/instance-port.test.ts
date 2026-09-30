// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Connect screen's port (#777) against the REAL instance: `apps/instance`'s
 * own handler, identity routes and a real SQLite file, reached through
 * {@link InstancePortDependencies.send} with no network — the transport hands
 * each request to the handler exactly as `fetch` would have sent it. The
 * device key is the store's real non-extractable WebCrypto key in IndexedDB.
 *
 * `apps/instance` is imported by a computed path, as
 * `browser/identity.browser.spec.ts` does, because it is written for Node's type
 * stripping (`.ts` specifiers) and this program's typecheck does not follow
 * those; the shape it is used through is written down here.
 */

import { unixSeconds } from '@onyourleft/domain';
import { ensureDeviceSigningKey } from '@onyourleft/store';
import { createStoreHarness, seedRide, type StoreHarness } from '@onyourleft/store/testing';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ensureLocalAthlete, LOCAL_ATHLETE } from '../local-athlete';
import { ADDRESS_REFUSAL_TEXT } from './address';
import {
  CONNECT_REFUSAL_TEXT,
  createInstancePort,
  INSTANCE_SESSION_STORAGE_KEY,
  type InstancePortDependencies,
  type InstanceStorage,
} from './instance-port';
import type { InstanceSend } from './instance-transport';
import { INSTANCE_ACCOUNT_STORAGE_KEY } from './sign-in';

interface IdentityInstance {
  readonly instance: { handler(request: Request): Promise<Response> };
  call(
    method: string,
    path: string,
    options?: { body?: unknown; token?: string },
  ): Promise<{ status: number; body: unknown }>;
  close(): Promise<void>;
}

interface IdentityTesting {
  readonly TEST_ORIGIN: string;
  startIdentityInstance(options?: {
    config?: { name?: string | null };
    registration?: 'open' | 'closed';
  }): Promise<IdentityInstance>;
}

const INSTANCE_TESTING = new URL('../../../instance/src/auth/identity-testing.ts', import.meta.url)
  .href;
const NAME = 'Lanes of the Weald';
const NOW = unixSeconds(1_790_000_000);

let testing: IdentityTesting;
const worlds: IdentityInstance[] = [];
const harnesses: StoreHarness[] = [];

beforeAll(async () => {
  testing = (await import(/* @vite-ignore */ INSTANCE_TESTING)) as IdentityTesting;
});

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
  for (const harness of harnesses.splice(0)) await harness.destroy();
  vi.restoreAllMocks();
});

async function instance(options: Parameters<IdentityTesting['startIdentityInstance']>[0] = {}) {
  const world = await testing.startIdentityInstance({ config: { name: NAME }, ...options });
  worlds.push(world);
  return world;
}

/** `localStorage` as a map that outlives the port reading it: a reload keeps it. */
function deviceStorage(): InstanceStorage & { readonly map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

/** Every request, handed to the instance's own handler — and counted. */
function wire(world: IdentityInstance): InstanceSend & ReturnType<typeof vi.fn> {
  return vi.fn((url: string, init: RequestInit) => world.instance.handler(new Request(url, init)));
}

function device(send: InstanceSend, storage = deviceStorage()) {
  const store = createStoreHarness();
  harnesses.push(store);
  const log: string[] = [];
  const dependencies: InstancePortDependencies = {
    storage,
    ensureLocalAthlete: () =>
      store.write(async (open) => {
        log.push('ensureLocalAthlete');
        return ensureLocalAthlete(open, NOW);
      }),
    signingKey: () => store.write(async (open) => ensureDeviceSigningKey(open, LOCAL_ATHLETE)),
    send,
    now: () => NOW * 1000,
  };
  return { store, storage, log, dependencies, port: createInstancePort(dependencies) };
}

describe('an address the app will not use sends nothing — #777', () => {
  it('refuses http:// to another machine before any request, and says why', async () => {
    const send = vi.fn() as unknown as InstanceSend;
    const { port, storage, log } = device(send);
    const outcome = await port.connect('http://ride.example', 'Anna');
    expect(outcome).toEqual({ kind: 'refused', text: ADDRESS_REFUSAL_TEXT['not-encrypted'] });
    expect(send).not.toHaveBeenCalled();
    // Not even the local athlete or the key was asked for.
    expect(log).toEqual([]);
    expect(storage.map.size).toBe(0);
  });

  it('refuses a name the instance would refuse, before any request', async () => {
    const send = vi.fn() as unknown as InstanceSend;
    const { port } = device(send);
    expect(await port.connect(testing.TEST_ORIGIN, 'An‮na')).toEqual({
      kind: 'refused',
      text: CONNECT_REFUSAL_TEXT['bad-name'],
    });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('signing in, and what is shown after a reload — #777', () => {
  it('shows the instance’s name and the athlete’s name as the INSTANCE holds them', async () => {
    const world = await instance();
    const send = wire(world);
    const first = device(send);
    const outcome = await first.port.connect(testing.TEST_ORIGIN, 'Anna');
    expect(outcome.kind).toBe('connected');
    expect(outcome.kind === 'connected' ? outcome.recoveryCodes : []).toHaveLength(10);

    // The reload: a new port over nothing but what the device kept.
    const reloaded = createInstancePort({ ...first.dependencies, storage: first.storage });
    expect(await reloaded.current()).toEqual({
      kind: 'connected',
      origin: testing.TEST_ORIGIN,
      instanceName: NAME,
      displayName: 'Anna',
      sourceUrl: expect.stringContaining('https://github.com/openzigs/onyourleft/tree/') as unknown,
    });

    // Renamed on the instance, and the screen says so: it reads the instance,
    // not what the form was given.
    const token = first.storage.map.get(INSTANCE_SESSION_STORAGE_KEY) ?? '';
    const renamed = await world.call('POST', '/v1/auth/display-name', {
      body: { displayName: 'Brigid' },
      token,
    });
    expect(renamed.status).toBe(200);
    expect(await reloaded.current()).toMatchObject({ displayName: 'Brigid' });
  });

  it('says the instance has no name rather than inventing one', async () => {
    const world = await instance({ config: { name: null } });
    const { port } = device(wire(world));
    await port.connect(testing.TEST_ORIGIN, '');
    expect(await port.current()).toMatchObject({ kind: 'connected', instanceName: null });
  });

  it('lists this athlete’s devices, this one among them (#773)', async () => {
    const world = await instance();
    const { port } = device(wire(world));
    await port.connect(testing.TEST_ORIGIN, 'Anna');
    const listed = await port.devices();
    expect(listed.kind).toBe('listed');
    expect(listed.kind === 'listed' ? listed.devices : []).toEqual([
      expect.objectContaining({ thisDevice: true, revokedAt: null }),
    ]);
  });

  it('lists this athlete’s devices and nothing of any other athlete — three athletes (#773)', async () => {
    const world = await instance();
    const send = wire(world);
    // Three devices, each its own key and so its own athlete on the instance.
    const riders = [device(send), device(send), device(send)];
    for (const rider of riders) {
      expect((await rider.port.connect(testing.TEST_ORIGIN, '')).kind).toBe('connected');
    }
    const keys = await Promise.all(
      riders.map(async (rider) => {
        const listed = await rider.port.devices();
        expect(listed.kind).toBe('listed');
        return listed.kind === 'listed' ? listed.devices.map((each) => each.publicKey) : [];
      }),
    );
    for (const own of keys) expect(own).toHaveLength(1);
    // Three different keys: no athlete's list names another's device.
    expect(new Set(keys.flat()).size).toBe(3);
  });

  it('says so when the instance no longer accepts the session', async () => {
    const world = await instance();
    const { port, storage } = device(wire(world));
    await port.connect(testing.TEST_ORIGIN, 'Anna');
    const token = storage.map.get(INSTANCE_SESSION_STORAGE_KEY) ?? '';
    expect((await world.call('DELETE', '/v1/auth/session', { token })).status).toBe(204);
    expect(await port.current()).toEqual({ kind: 'signed-out', origin: testing.TEST_ORIGIN });
  });

  it('names the refusal of an instance that is not taking new riders', async () => {
    const world = await instance({ registration: 'closed' });
    const { port, storage } = device(wire(world));
    expect(await port.connect(testing.TEST_ORIGIN, 'Anna')).toEqual({
      kind: 'refused',
      text: CONNECT_REFUSAL_TEXT.registration_closed,
    });
    expect(storage.map.has(INSTANCE_SESSION_STORAGE_KEY)).toBe(false);
  });

  it('names the refusal of an instance that answers to another address', async () => {
    const world = await instance();
    const { port } = device(wire(world));
    expect(await port.connect('https://other.example', 'Anna')).toEqual({
      kind: 'refused',
      text: CONNECT_REFUSAL_TEXT.wrong_instance,
    });
  });

  it('says nothing answered, and shows an unreachable instance as unreachable', async () => {
    const world = await instance();
    let up = true;
    const real = wire(world);
    const send: InstanceSend = (url, init) =>
      up ? real(url, init) : Promise.reject(new TypeError('offline'));
    const { port } = device(send);
    await port.connect(testing.TEST_ORIGIN, 'Anna');
    up = false;
    expect(await port.current()).toEqual({ kind: 'unreachable', origin: testing.TEST_ORIGIN });
    expect(await port.devices()).toMatchObject({ kind: 'unavailable' });
    const fresh = device(send);
    expect(await fresh.port.connect(testing.TEST_ORIGIN, '')).toEqual({
      kind: 'refused',
      text: CONNECT_REFUSAL_TEXT['no-answer'],
    });
  });

  it('never hands the screen a source link that is not https, or a name it should not show', async () => {
    const world = await instance();
    const real = wire(world);
    const send: InstanceSend = async (url, init) => {
      if (url.endsWith('/source')) return Response.json({ url: 'javascript:alert(1)' });
      if (url.endsWith('/instance')) return Response.json({ name: 'Lanes‮of' });
      return real(url, init);
    };
    const { port } = device(send);
    await port.connect(testing.TEST_ORIGIN, 'Anna');
    expect(await port.current()).toMatchObject({ sourceUrl: null, instanceName: null });
  });
});

describe('disconnecting — #777', () => {
  it('removes the token and the address, ends the session, and leaves every ride', async () => {
    const world = await instance();
    const { port, storage, store } = device(wire(world));
    await store.write(async (open) => ensureLocalAthlete(open, NOW));
    for (let index = 0; index < 3; index += 1) await seedRide(store, LOCAL_ATHLETE);
    const count = (): Promise<number> =>
      store.read(async (open) => (await open.listActivitySummaries(LOCAL_ATHLETE)).length);
    const before = await count();
    expect(before).toBe(3);

    await port.connect(testing.TEST_ORIGIN, 'Anna');
    const token = storage.map.get(INSTANCE_SESSION_STORAGE_KEY) ?? '';
    expect(token).not.toBe('');
    expect(storage.map.has(INSTANCE_ACCOUNT_STORAGE_KEY)).toBe(true);

    await port.disconnect();

    expect(storage.map.has(INSTANCE_SESSION_STORAGE_KEY)).toBe(false);
    expect(storage.map.has(INSTANCE_ACCOUNT_STORAGE_KEY)).toBe(false);
    expect(await port.current()).toEqual({ kind: 'not-connected' });
    // Ended on the instance too, not only forgotten here.
    expect((await world.call('GET', '/v1/auth/session', { token })).status).toBe(401);
    // Read back on a fresh connection: every ride is still on the device.
    expect(await count()).toBe(before);
  });

  it('forgets the instance even when it does not answer', async () => {
    const world = await instance();
    let up = true;
    const real = wire(world);
    const send: InstanceSend = (url, init) =>
      up ? real(url, init) : Promise.reject(new TypeError('offline'));
    const { port, storage } = device(send);
    await port.connect(testing.TEST_ORIGIN, 'Anna');
    up = false;
    await port.disconnect();
    expect(storage.map.size).toBe(0);
  });
});
