// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Phase 2 of ADR 0047, from the client (#1210, D-7): on an instance that
 * holds keys, a device with the card reaches the room routes, the account
 * summary and signing out ONLY sealed — every request to them crosses the
 * wire as `POST /v1/sealed` — and each one is read back through the instance
 * as a rider's other device would: the room made here is joined there by its
 * code, its route checked against its digest, its ticket good for a hello,
 * and the session signed out is refused afterwards.
 *
 * And the two devices that cannot seal send nothing for any of it: a copy a
 * website served (D-11), and a device holding a sign-in with no pin (D-14
 * Q1), which reads the instance's public keys and stops there.
 *
 * The instance is `apps/instance`'s own test world, read by a computed
 * `import()` — test code only, as `instance/sealed-routes.test.ts` reads it.
 */

import { unixSeconds } from '@onyourleft/domain';
import { ensureDeviceSigningKey } from '@onyourleft/store';
import { createStoreHarness, type StoreHarness } from '@onyourleft/store/testing';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { LOADED_FROM_A_WEBSITE, LOADED_LOCALLY } from '../instance/testing';
import { WEB_BUILD_TEXT, type LoadedFrom } from '../instance/instance-pin';
import {
  createInstancePort,
  INSTANCE_SESSION_STORAGE_KEY,
  type InstancePortDependencies,
  type InstanceStorage,
} from '../instance/instance-port';
import type { InstanceSend, OpenInstanceSocket } from '../instance/instance-transport';
import { createModerationPort } from '../instance/moderation-port';
import { INSTANCE_ACCOUNT_STORAGE_KEY } from '../instance/sign-in';
import { ensureLocalAthlete, LOCAL_ATHLETE } from '../local-athlete';
import { northProfile } from '../rooms/rooms-testing';
import { createRoomPort } from './room-port';
import { createRoomsPort } from './rooms-port';

interface IdentityInstance {
  readonly instance: { handler(request: Request): Promise<Response> };
  readonly instanceKeys: { show(): Promise<{ readonly card: string }> };
  call(
    method: string,
    path: string,
    options?: { token?: string; signer?: { readonly signingKey: unknown } },
  ): Promise<{ status: number; body: unknown }>;
  close(): Promise<void>;
}

interface IdentityTesting {
  readonly TEST_ORIGIN: string;
  startIdentityInstance(options?: {
    startsAt?: number;
    bodyLimitBytes?: number;
  }): Promise<IdentityInstance>;
}

const ROUTE = { id: 'route-1', profile: northProfile(3_000) };

let testing: IdentityTesting;
const worlds: IdentityInstance[] = [];
const harnesses: StoreHarness[] = [];

beforeAll(async () => {
  testing = (await import(
    /* @vite-ignore */ new URL('../../../instance/src/auth/identity-testing.ts', import.meta.url)
      .href
  )) as IdentityTesting;
});

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
  for (const harness of harnesses.splice(0)) await harness.destroy();
  vi.restoreAllMocks();
});

async function world(): Promise<IdentityInstance> {
  // At the real time: the room ports judge the instance's key statements by
  // the platform's clock, as they do in the app.
  // A route's GPX is larger than the test world's default body limit.
  const started = await testing.startIdentityInstance({
    startsAt: Date.now(),
    bodyLimitBytes: 256 * 1024,
  });
  worlds.push(started);
  return started;
}

/** Every request, handed to the instance's own handler — and counted. */
function wire(w: IdentityInstance): InstanceSend & ReturnType<typeof vi.fn> {
  return vi.fn((url: string, init: RequestInit) => w.instance.handler(new Request(url, init)));
}

const paths = (send: ReturnType<typeof wire>): string[] =>
  (send.mock.calls as [string, RequestInit][]).map(
    ([url, init]) => `${init.method ?? 'GET'} ${new URL(url).pathname}`,
  );

function memoryStorage(): InstanceStorage & { readonly map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

/** A rider's device, signed in to `w` with its card: what `main.tsx` builds, over a test store. */
async function rider(w: IdentityInstance, send: InstanceSend, name: string) {
  const store = createStoreHarness();
  harnesses.push(store);
  const storage = memoryStorage();
  const dependencies: InstancePortDependencies = {
    storage,
    loadedFrom: LOADED_LOCALLY,
    ensureLocalAthlete: () =>
      store.write(async (open) =>
        ensureLocalAthlete(open, unixSeconds(Math.floor(Date.now() / 1000))),
      ),
    signingKey: () => store.write(async (open) => ensureDeviceSigningKey(open, LOCAL_ATHLETE)),
    send,
  };
  const port = createInstancePort(dependencies);
  const card = (await w.instanceKeys.show()).card;
  expect(await port.connect(testing.TEST_ORIGIN, name, card)).toMatchObject({
    kind: 'connected',
  });
  const rooms = (loadedFrom: LoadedFrom = LOADED_LOCALLY) =>
    createRoomsPort({
      storage,
      loadedFrom,
      signingKey: dependencies.signingKey,
      send,
      zones: () => Promise.resolve([]),
    });
  return { storage, dependencies, port, rooms };
}

/** Requests to a phase-2 route that went in plaintext: there must be none. */
const plaintextPhaseTwo = (send: ReturnType<typeof wire>): string[] =>
  paths(send).filter((path) =>
    / \/v1\/(rooms|auth\/session|auth\/account|blocks|reports)/.test(path),
  );

describe('a device with the card reaches phase 2 sealed (#1210, ADR 0047 D-7)', () => {
  it('makes a room, and another rider joins it by its code, rides its route and holds a ticket', async () => {
    const w = await world();
    const send = wire(w);
    const anna = await rider(w, send, 'Anna');
    const bea = await rider(w, send, 'Bea');
    send.mockClear();

    const made = await anna.rooms().create({
      kind: 'group',
      ridingPosition: 'hoods',
      drafting: true,
      route: ROUTE,
    });
    expect(made.kind, JSON.stringify(made)).toBe('created');
    const code = made.kind === 'created' ? (made.room.code ?? '') : '';

    // Read back through the instance by the other rider, as a real one would.
    const joined = await bea.rooms().join(code);
    expect(joined.kind, JSON.stringify(joined)).toBe('joined');
    const roomId = joined.kind === 'joined' ? joined.room.roomId : '';
    expect(made.kind === 'created' ? made.room.roomId : '').toBe(roomId);
    // The route was fetched and checked against the room's own digest.
    expect(joined.kind === 'joined' ? joined.room.routeSha256 : '').toBe(
      made.kind === 'created' ? made.room.routeSha256 : 'none',
    );

    // A ticket, sealed, and good for the room's hello on the socket.
    const sent: string[] = [];
    const opened: { onOpen(): void }[] = [];
    const openSocket: OpenInstanceSocket = (_url, events) => {
      opened.push(events);
      return { send: (text) => sent.push(text), close: () => undefined };
    };
    const connection = createRoomPort({
      storage: bea.storage,
      loadedFrom: LOADED_LOCALLY,
      signingKey: bea.dependencies.signingKey,
      send,
      openSocket,
    }).join({ roomId, declaredMassKilograms: 70, sample: () => ({ powerWatts: 0 }) });
    await vi.waitFor(() => expect(opened.length).toBe(1));
    opened[0]?.onOpen();
    await vi.waitFor(() => expect(sent.length).toBeGreaterThan(0));
    const hello = JSON.parse(sent[0] ?? '{}') as { type?: string; ticket?: unknown };
    expect(hello.type).toBe('hello');
    expect(typeof hello.ticket).toBe('string');
    connection.leave();

    // Every one of those crossed the wire sealed, and none in plaintext.
    expect(plaintextPhaseTwo(send)).toEqual([]);
    expect(paths(send).filter((path) => path === 'POST /v1/sealed').length).toBeGreaterThanOrEqual(
      4,
    );
  });

  it('reads the account summary sealed, and signs out sealed so the session is ended', async () => {
    const w = await world();
    const send = wire(w);
    const anna = await rider(w, send, 'Anna');
    const token = JSON.parse(anna.storage.map.get(INSTANCE_SESSION_STORAGE_KEY) ?? '{}') as {
      token: string;
    };
    const signer = { signingKey: await anna.dependencies.signingKey() };
    send.mockClear();
    expect(await createModerationPort(anna.dependencies).standing()).toBe('not-moderator');
    expect(await anna.port.current()).toMatchObject({ kind: 'connected', displayName: 'Anna' });
    await anna.port.disconnect();
    expect(plaintextPhaseTwo(send)).toEqual([]);
    // Read back on the instance: the session the device held is over.
    expect((await w.call('GET', '/v1/auth/session', { token: token.token, signer })).status).toBe(
      401,
    );
  });
});

describe('a device that cannot seal sends nothing for phase 2 (#1210, D-11, D-14 Q1)', () => {
  it('a copy a website served: refused, and nothing is sent about the room', async () => {
    const w = await world();
    const send = wire(w);
    const anna = await rider(w, send, 'Anna');
    send.mockClear();
    expect(await anna.rooms(LOADED_FROM_A_WEBSITE).join('ABCDE-FGHJK-MNPQR')).toEqual({
      kind: 'refused',
      reason: 'cannot-seal',
    });
    // Nor the account summary: the moderators' screen says why it is empty.
    const website = { ...anna.dependencies, loadedFrom: LOADED_FROM_A_WEBSITE };
    expect(await createModerationPort(website).read()).toEqual({
      kind: 'sealed-unavailable',
      text: WEB_BUILD_TEXT,
    });
    expect(await createInstancePort(website).current()).toEqual({
      kind: 'unreadable',
      origin: testing.TEST_ORIGIN,
      text: WEB_BUILD_TEXT,
    });
    expect(paths(send)).toEqual([]);
  });

  it('a sign-in with no pin: the keys are read, and the code is never sent', async () => {
    const w = await world();
    const send = wire(w);
    const anna = await rider(w, send, 'Anna');
    // A sign-in kept from before phase 2: the account holds no pin.
    const kept = JSON.parse(anna.storage.map.get(INSTANCE_ACCOUNT_STORAGE_KEY) ?? '{}') as {
      origin: string;
      instanceAthleteId: string;
    };
    anna.storage.map.set(
      INSTANCE_ACCOUNT_STORAGE_KEY,
      JSON.stringify({ origin: kept.origin, instanceAthleteId: kept.instanceAthleteId }),
    );
    send.mockClear();
    expect(await anna.rooms().join('ABCDE-FGHJK-MNPQR')).toEqual({
      kind: 'refused',
      reason: 'cannot-seal',
    });
    expect(paths(send)).toEqual(['GET /v1/instance/keys']);
    const bodies = (send.mock.calls as [string, RequestInit][]).map(([, init]) => init.body);
    expect(JSON.stringify(bodies)).not.toContain('ABCDE');
  });
});
