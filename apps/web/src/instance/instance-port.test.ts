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
  ACCOUNT_CHANGES_UNAVAILABLE_TEXT,
  accountChangesFrom,
  CONNECT_REFUSAL_TEXT,
  createInstancePort,
  INSTANCE_AGREEMENT_STORAGE_KEYS,
  instanceEraser,
  TERMS_READ_STORAGE_KEY,
  INSTANCE_SESSION_STORAGE_KEY,
  type InstancePortDependencies,
  type InstanceStorage,
} from './instance-port';
import type { InstanceSend } from './instance-transport';
import { INSTANCE_ACCOUNT_STORAGE_KEY } from './sign-in';
import { LOADED_LOCALLY } from './testing';

interface IdentityInstance {
  readonly instance: { handler(request: Request): Promise<Response> };
  /** The instance's keys (#1189): its card, which a new rider registers with (#1192). */
  readonly instanceKeys: { show(): Promise<{ readonly card: string }> };
  /** The listener's own `http://127.0.0.1:<port>`. */
  readonly url: string;
  call(
    method: string,
    path: string,
    options?: { body?: unknown; token?: string; signer?: { readonly signingKey: unknown } },
  ): Promise<{ status: number; body: unknown }>;
  close(): Promise<void>;
}

interface IdentityTesting {
  readonly TEST_ORIGIN: string;
  startIdentityInstance(options?: {
    config?: {
      name?: string | null;
      /** The terms the instance publishes (#909). */
      terms?: { readonly text: string; readonly version: string } | null;
    };
    registration?: 'open' | 'closed';
    originIsTheListener?: boolean;
    keyless?: boolean;
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

/**
 * The instance's card, as its operator hands it over (#1190): a new key
 * registers only sealed (#1192), and a device seals only with a card.
 */
async function cardOf(world: IdentityInstance): Promise<string> {
  return (await world.instanceKeys.show()).card;
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

/** The bearer token a device holds, read the way the port keeps it: `{ origin, token }`. */
function heldToken(storage: { readonly map: Map<string, string> }): string {
  const kept = JSON.parse(storage.map.get(INSTANCE_SESSION_STORAGE_KEY) ?? 'null') as {
    token?: unknown;
  } | null;
  return typeof kept?.token === 'string' ? kept.token : '';
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
    loadedFrom: LOADED_LOCALLY,
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
    const outcome = await first.port.connect(testing.TEST_ORIGIN, 'Anna', await cardOf(world));
    expect(outcome.kind, JSON.stringify(outcome)).toBe('connected');
    expect(outcome.kind === 'connected' ? outcome.recoveryCodes : []).toHaveLength(10);

    // The reload: a new port over nothing but what the device kept.
    const reloaded = createInstancePort({ ...first.dependencies, storage: first.storage });
    expect(await reloaded.current()).toEqual({
      kind: 'connected',
      origin: testing.TEST_ORIGIN,
      instanceName: NAME,
      displayName: 'Anna',
      sourceUrl: expect.stringContaining('https://github.com/openzigs/onyourleft/tree/') as unknown,
      termsVersion: null,
      termsUnread: false,
    });

    // Renamed on the instance, and the screen says so: it reads the instance,
    // not what the form was given.
    // Sealed and signed by the device's own key (#1210): the token alone renames nobody.
    const token = heldToken(first.storage);
    const renamed = await world.call('POST', '/v1/auth/display-name', {
      body: { displayName: 'Brigid' },
      token,
      signer: { signingKey: await first.dependencies.signingKey() },
    });
    expect(renamed.status).toBe(200);
    expect(await reloaded.current()).toMatchObject({ displayName: 'Brigid' });
  });

  it('says the instance’s terms are unread until this device marks that version read (#909)', async () => {
    const world = await instance({
      config: { terms: { text: '# Terms\n\nRide kindly.', version: '2026-11-01' } },
    });
    const { port, storage } = device(wire(world));
    await port.connect(testing.TEST_ORIGIN, 'Anna', await cardOf(world));
    expect(await port.current()).toMatchObject({
      termsVersion: '2026-11-01',
      termsUnread: true,
    });
    port.markTermsRead('2026-11-01');
    expect(await port.current()).toMatchObject({ termsUnread: false });
    // An older version marked read is not this one: the screen says they changed.
    port.markTermsRead('2026-01-01');
    expect(await port.current()).toMatchObject({ termsUnread: true });
    // Nor is this version read for ANOTHER instance: what was read is read per instance.
    storage.map.set(
      TERMS_READ_STORAGE_KEY,
      JSON.stringify({ origin: 'https://elsewhere.example', version: '2026-11-01' }),
    );
    expect(await port.current()).toMatchObject({ termsUnread: true });
    // Kept with the instance's address, so forgetting the instance forgets it.
    expect(storage.map.has(TERMS_READ_STORAGE_KEY)).toBe(true);
    instanceEraser(storage).forget();
    expect(storage.map.has(TERMS_READ_STORAGE_KEY)).toBe(false);
  });

  it('says the instance has no name rather than inventing one', async () => {
    const world = await instance({ config: { name: null } });
    const { port } = device(wire(world));
    await port.connect(testing.TEST_ORIGIN, '', await cardOf(world));
    expect(await port.current()).toMatchObject({ kind: 'connected', instanceName: null });
  });

  it('lists this athlete’s devices, this one among them (#773)', async () => {
    const world = await instance();
    const { port } = device(wire(world));
    await port.connect(testing.TEST_ORIGIN, 'Anna', await cardOf(world));
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
      expect((await rider.port.connect(testing.TEST_ORIGIN, '', await cardOf(world))).kind).toBe(
        'connected',
      );
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
    const { port, storage, dependencies } = device(wire(world));
    await port.connect(testing.TEST_ORIGIN, 'Anna', await cardOf(world));
    const token = heldToken(storage);
    // Signed out by the device's own key, sealed (#1210), as another of its screens could.
    const signer = { signingKey: await dependencies.signingKey() };
    expect((await world.call('DELETE', '/v1/auth/session', { token, signer })).status).toBe(204);
    expect(await port.current()).toEqual({ kind: 'signed-out', origin: testing.TEST_ORIGIN });
  });

  it('says it cannot read the session when a keyless-looking instance demands a seal — #1210', async () => {
    // A device with no pin, connected to a keyless instance, which then
    // answers the plaintext session read `sealed_required`.
    const world = await instance({ keyless: true });
    const base = wire(world);
    const { port, storage } = device(base);
    await port.connect(testing.TEST_ORIGIN, 'Anna');
    const demanding: InstanceSend = (url, init) =>
      new URL(url).pathname === '/v1/auth/session'
        ? Promise.resolve(
            new Response(JSON.stringify({ error: { code: 'sealed_required' } }), {
              status: 403,
              headers: { 'content-type': 'application/json' },
            }),
          )
        : base(url, init);
    const { port: reading } = device(demanding, storage);
    expect(await reading.current()).toMatchObject({ kind: 'unreadable' });
  });

  it('names the refusal of an instance that is not taking new riders', async () => {
    const world = await instance({ registration: 'closed' });
    const { port, storage } = device(wire(world));
    expect(await port.connect(testing.TEST_ORIGIN, 'Anna', await cardOf(world))).toEqual({
      kind: 'refused',
      text: CONNECT_REFUSAL_TEXT.registration_closed,
    });
    expect(storage.map.has(INSTANCE_SESSION_STORAGE_KEY)).toBe(false);
  });

  it('names the refusal of an instance that answers to another address', async () => {
    // With no keys, so with no card (#1210): an instance holding keys refuses
    // a plaintext sign-in before it reads the statement's address.
    const world = await instance({ keyless: true });
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
    await port.connect(testing.TEST_ORIGIN, 'Anna', await cardOf(world));
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
    await port.connect(testing.TEST_ORIGIN, 'Anna', await cardOf(world));
    expect(await port.current()).toMatchObject({ sourceUrl: null, instanceName: null });
  });
});

describe('what is sent, and what is kept — #892 review', () => {
  it('sends a typed name on EVERY Connect, and the instance keeps it only when it registers', async () => {
    // The policy, the Connect screen and the Data Safety Name row say this
    // exactly: sent whenever one is typed, kept only by an instance that has
    // not seen this device before. They used to say it was SENT only then.
    // An instance with no keys, so the body it was sent is readable here: on
    // one holding keys every sign-in is sealed (#1210).
    const world = await instance({ keyless: true });
    const send = wire(world);
    const { port } = device(send);
    await port.connect(testing.TEST_ORIGIN, 'Anna');
    await port.disconnect();
    send.mockClear();

    await port.connect(testing.TEST_ORIGIN, 'Brigid');
    const sessionBodies = send.mock.calls
      .filter(([url]) => String(url).endsWith('/v1/auth/session'))
      .map(
        ([, init]) => JSON.parse((init as RequestInit).body as string) as Record<string, unknown>,
      );
    expect(sessionBodies).toHaveLength(1);
    expect(sessionBodies[0]?.displayName).toBe('Brigid');
    // …and not kept: the instance had seen this device's key.
    expect(await port.current()).toMatchObject({ kind: 'connected', displayName: 'Anna' });
  });

  it('never sends one instance’s token to another, when the token’s write fails', async () => {
    const first = await instance();
    const second = await instance({ originIsTheListener: true });
    const toFirst = wire(first);
    const toSecond = wire(second);
    const send: InstanceSend = (url, init) =>
      url.startsWith(second.url) ? toSecond(url, init) : toFirst(url, init);
    const storage = deviceStorage();
    const { port } = device(send, storage);
    expect((await port.connect(testing.TEST_ORIGIN, 'Anna', await cardOf(first))).kind).toBe(
      'connected',
    );
    const firstToken = heldToken(storage);
    expect(firstToken).not.toBe('');

    // The device is full: the second sign-in writes the new address, and the
    // token beside it cannot be written.
    const setItem = storage.setItem.bind(storage);
    storage.setItem = (key, value) => {
      if (key === INSTANCE_SESSION_STORAGE_KEY)
        throw new DOMException('full', 'QuotaExceededError');
      setItem(key, value);
    };
    expect((await port.connect(second.url, 'Anna', await cardOf(second))).kind).toBe('refused');
    expect(JSON.parse(storage.map.get(INSTANCE_ACCOUNT_STORAGE_KEY) ?? '{}')).toMatchObject({
      origin: second.url,
    });

    toSecond.mockClear();
    expect(await port.current()).toEqual({ kind: 'not-connected' });
    expect(await port.devices()).toMatchObject({ kind: 'unavailable' });
    const authorised = toSecond.mock.calls.filter(([, init]) =>
      new Headers((init as RequestInit).headers).has('authorization'),
    );
    expect(authorised).toEqual([]);
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

    await port.connect(testing.TEST_ORIGIN, 'Anna', await cardOf(world));
    const token = heldToken(storage);
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

  it('forgets what the rider agreed to send this instance, so the next account starts with none (#1106)', async () => {
    const world = await instance();
    const { port, storage } = device(wire(world));
    await port.connect(testing.TEST_ORIGIN, 'Anna', await cardOf(world));
    for (const key of INSTANCE_AGREEMENT_STORAGE_KEYS) storage.map.set(key, testing.TEST_ORIGIN);
    await port.disconnect();
    for (const key of INSTANCE_AGREEMENT_STORAGE_KEYS) expect(storage.map.has(key)).toBe(false);
  });

  it('forgets the instance even when it does not answer', async () => {
    const world = await instance();
    let up = true;
    const real = wire(world);
    const send: InstanceSend = (url, init) =>
      up ? real(url, init) : Promise.reject(new TypeError('offline'));
    const { port, storage } = device(send);
    await port.connect(testing.TEST_ORIGIN, 'Anna', await cardOf(world));
    up = false;
    await port.disconnect();
    expect(storage.map.size).toBe(0);
  });
});

describe('the account-change notices and a revoke, sealed — #1208', () => {
  /** A rider with two devices: `first` signed in with the card and linked `second`. */
  async function twoDevices() {
    const world = await instance();
    const send = wire(world);
    const first = device(send);
    await first.port.connect(testing.TEST_ORIGIN, 'Anna', await cardOf(world));
    const shown = await first.port.linkCode();
    if (shown.kind !== 'shown') throw new Error('no link code');
    const second = device(send);
    expect(await second.port.link(shown.offer)).toEqual({ kind: 'connected' });
    const listed = await first.port.devices();
    if (listed.kind !== 'listed') throw new Error('no devices');
    const other = listed.devices.find((each) => !each.thisDevice)?.publicKey ?? '';
    return { world, send, first, second, other };
  }

  it('shows a device the changes another key made, and not its own', async () => {
    const { first, second } = await twoDevices();
    // The first device minted the code that added the second: on the SECOND
    // those are another key's changes, so notices; on the first, its own.
    const seen = await second.port.accountChanges();
    expect(seen.kind).toBe('read');
    if (seen.kind !== 'read') return;
    expect(seen.notices.map((entry) => entry.kind)).toEqual(['link_code_minted', 'key_added']);
    expect(seen.acknowledgedThrough).toBe(0);
    const own = await first.port.accountChanges();
    expect(own).toMatchObject({ kind: 'read', notices: [] });
    expect(own.kind === 'read' ? own.changes.length : 0).toBe(2);
  });

  it('moves only this device’s mark when it acknowledges, read back on both devices', async () => {
    const { first, second } = await twoDevices();
    // A change by the second key, so the FIRST device has a notice too.
    expect((await second.port.linkCode()).kind).toBe('shown');
    const before = await first.port.accountChanges();
    expect(before.kind === 'read' ? before.notices.map((entry) => entry.kind) : []).toEqual([
      'link_code_minted',
    ]);
    const seen = await second.port.accountChanges();
    const newest = seen.kind === 'read' ? Math.max(...seen.notices.map((entry) => entry.id)) : 0;
    expect(await second.port.acknowledgeAccountChanges(newest)).toEqual({
      kind: 'acknowledged',
      acknowledgedThrough: newest,
    });
    // Read back through the same call the screen makes: gone on the second…
    expect(await second.port.accountChanges()).toMatchObject({
      kind: 'read',
      notices: [],
      acknowledgedThrough: newest,
    });
    // …and still there, unmoved, on the first.
    expect(await first.port.accountChanges()).toMatchObject({
      kind: 'read',
      acknowledgedThrough: 0,
      notices: [expect.objectContaining({ kind: 'link_code_minted' })],
    });
  });

  it('revokes another key, which the list and the log then say', async () => {
    const { first, second, other } = await twoDevices();
    expect(await first.port.revokeDevice(other)).toEqual({ kind: 'revoked' });
    const listed = await first.port.devices();
    expect(
      listed.kind === 'listed'
        ? listed.devices.find((each) => each.publicKey === other)?.revokedAt
        : null,
    ).toEqual(expect.any(Number));
    const log = await first.port.accountChanges();
    const last = log.kind === 'read' ? log.changes.at(-1) : undefined;
    expect(last).toMatchObject({ kind: 'key_revoked', subjectKey: other });
    expect(typeof last?.subjectAddedAt).toBe('number');
    // The revoked key's own session ended with it.
    expect(await second.port.accountChanges()).toMatchObject({ kind: 'unavailable' });
  });

  it('refuses to revoke the last key without a recovery code, and says why', async () => {
    const world = await instance();
    const { port } = device(wire(world));
    await port.connect(testing.TEST_ORIGIN, 'Anna', await cardOf(world));
    const listed = await port.devices();
    const mine = listed.kind === 'listed' ? (listed.devices[0]?.publicKey ?? '') : '';
    expect(await port.revokeDevice(mine)).toEqual({
      kind: 'unavailable',
      text: ACCOUNT_CHANGES_UNAVAILABLE_TEXT['last-device'],
    });
    expect((await port.devices()).kind).toBe('listed');
  });

  it('sends no revoke for anything but a device key, so no path can be steered', async () => {
    const { send, first } = await twoDevices();
    send.mockClear();
    for (const bad of ['../session', 'a1'.repeat(31), `${'a1'.repeat(32)}?x`, 'A1'.repeat(32)]) {
      expect(await first.port.revokeDevice(bad)).toEqual({
        kind: 'unavailable',
        text: ACCOUNT_CHANGES_UNAVAILABLE_TEXT['not-revoked'],
      });
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('reads no log it cannot trust: one entry of the wrong shape is no answer', () => {
    const good = {
      id: 3,
      at: 1_790_000_000,
      kind: 'address_added',
      actorKey: 'b2'.repeat(32),
      subjectKey: null,
      subjectAddedAt: null,
      via: null,
      address: 'rider@example.org',
    };
    expect(accountChangesFrom([good])).toEqual([good]);
    for (const bad of [
      { kind: 'key_stolen' },
      { id: -1 },
      { id: 1.5 },
      { at: '1790000000' },
      { actorKey: 'not a key' },
      { subjectKey: '../session' },
      { subjectAddedAt: Number.NaN },
      { via: 'carrier_pigeon' },
      { address: 7 },
    ]) {
      expect(accountChangesFrom([good, { ...good, ...bad }])).toBeUndefined();
    }
    expect(accountChangesFrom({ 0: good })).toBeUndefined();
    // An address no screen may be handed is read as none, not shown.
    expect(accountChangesFrom([{ ...good, address: 'a\u202Eb@example.org' }])).toEqual([
      { ...good, address: null },
    ]);
  });

  it('marks no notice read through a mark the instance would refuse, and sends nothing', async () => {
    const { send, first } = await twoDevices();
    send.mockClear();
    for (const bad of [-1, 1.5, Number.NaN]) {
      expect(await first.port.acknowledgeAccountChanges(bad)).toEqual({
        kind: 'unavailable',
        text: ACCOUNT_CHANGES_UNAVAILABLE_TEXT['not-acknowledged'],
      });
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('says the log cannot be shown when the instance does not answer', async () => {
    const { world, first } = await twoDevices();
    const real = wire(world);
    let up = true;
    // The same device — its storage and its key — over a line that drops
    // the sealed call itself, after the instance's keys were read.
    const port = createInstancePort({
      ...first.dependencies,
      send: (url, init) =>
        up || new URL(url).pathname !== '/v1/sealed'
          ? real(url, init)
          : Promise.reject(new TypeError('offline')),
    });
    expect((await port.accountChanges()).kind).toBe('read');
    up = false;
    expect(await port.accountChanges()).toEqual({
      kind: 'unavailable',
      text: ACCOUNT_CHANGES_UNAVAILABLE_TEXT['no-answer'],
    });
    expect(await port.acknowledgeAccountChanges(1)).toEqual({
      kind: 'unavailable',
      text: ACCOUNT_CHANGES_UNAVAILABLE_TEXT['not-acknowledged'],
    });
  });
});
