// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The owner's Rooms (#2612) on the RUNNING instance: the production
 * `startInstance`, its router and TWO real room-worker processes, riders on
 * real sockets, every call sealed as a keyed instance requires. What the
 * owner is shown comes from the workers over their IPC; ending a room closes
 * its sockets on its worker. Everything kept is read back through the routes
 * a client uses, and through a second connection to the database file.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_ORIGIN, testDevice, type TestDevice } from '../auth/identity-testing.ts';
import { startInstance, type StartedInstance } from '../instance.ts';
import { testConfig } from '../instance-testing.ts';
import { joinRoom, type RoomClient } from '../room/node/router-testing.ts';
import { roomHash } from '../room/node/router.ts';
import { until } from '../room/node/node-room-testing.ts';
import { roomBody } from '../rooms/rooms-testing.ts';
import { sealedAt } from '../sealed/sealed-testing.ts';
import { readServerConfig } from '../server-config.ts';
import { openSqlStore } from '../store/open-sql-store.ts';
import type { SqlStore } from '../store/sql-store.ts';
import { migrateForDeploy } from '../store/serving.ts';
import { roomShortCode } from './operate.ts';

/** The bound of a wait inside a case, which has Vitest's 5 s (#2567). */
const WAIT_MS = 3_000;

/** The power Cal reports, which the owner is never shown (#2726: looked for field by field). */
const POWER_WATTS = 317;

interface Session {
  readonly device: TestDevice;
  readonly token: string;
  readonly athleteId: string;
}

let directory: string | undefined;
let running: StartedInstance | undefined;
const clients: RoomClient[] = [];

let owner: Session;
let ann: Session;
let bea: Session;
let cal: Session;
/** Ann's race, which Bea joined, and Cal's group ride: on two different workers. */
let race: { readonly roomId: string; readonly code: string };
let ride: { readonly roomId: string };
/**
 * The ids the instance gives the rooms this file makes, in order (#2702). A
 * room is placed by `roomHash` of its id over the live workers, so the ride's
 * id is chosen to hash to the other worker from the race's: drawn at random,
 * the two shared a worker one run in two, and five tries all missed one run
 * in 32.
 */
const roomIds: string[] = [];

/** The first id after `roomId`, in counting order, that two workers place apart from it. */
function placedApartFrom(roomId: string): string {
  for (let n = Number.parseInt(roomId, 16) + 1; n < Number.MAX_SAFE_INTEGER; n += 1) {
    const candidate = n.toString(16).padStart(32, '0');
    if (roomHash(candidate) % 2 !== roomHash(roomId) % 2) return candidate;
  }
  throw new Error('no id is placed apart');
}

let annSocket: RoomClient;
let beaSocket: RoomClient;
let calSocket: RoomClient;

async function sealed(
  who: Session,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ readonly status: number; readonly body: unknown }> {
  if (running === undefined) throw new Error('no instance');
  const answer = await sealedAt(running.url, TEST_ORIGIN, {
    method,
    path,
    token: who.token,
    signer: who.device.signingKey,
    ...(body === undefined ? {} : { body }),
  });
  return { status: answer.status, body: answer.text === '' ? null : JSON.parse(answer.text) };
}

/** Signs `device` in, sealed, from an address of its own (`address`). */
async function signIn(device: TestDevice, displayName: string, address: string): Promise<Session> {
  if (running === undefined) throw new Error('no instance');
  const headers = { 'x-test-address': address };
  const challenge = (await (
    await fetch(`${running.url}/v1/auth/challenge`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ publicKey: device.publicKey }),
    })
  ).json()) as { nonce: string };
  const session = await sealedAt(running.url, TEST_ORIGIN, {
    method: 'POST',
    path: '/v1/auth/session',
    body: { ...(await device.statement(challenge.nonce)), displayName },
    signer: device.signingKey,
    headers,
  });
  expect(session.status, session.text).toBe(200);
  const body = JSON.parse(session.text) as { sessionToken: string; athleteId: string };
  return { device, token: body.sessionToken, athleteId: body.athleteId };
}

/** Every room id the instance answered this file's `made` with, in order. */
const madeRoomIds: string[] = [];

async function made(who: Session, overrides: Record<string, unknown>) {
  const answer = await sealed(who, 'POST', '/v1/rooms', roomBody(overrides));
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  const room = answer.body as { roomId: string; code: string };
  madeRoomIds.push(room.roomId);
  return room;
}

/** `who` on a real socket into `roomId`, with a ticket the instance issued them. */
async function socketInto(who: Session, roomId: string): Promise<RoomClient> {
  if (running === undefined) throw new Error('no instance');
  const ticket = await sealed(who, 'POST', `/v1/rooms/${roomId}/ticket`, {
    declaredMassKilograms: 70,
  });
  expect(ticket.status, JSON.stringify(ticket.body)).toBe(200);
  const client = await joinRoom(
    running.url.replace(/^http/, 'ws'),
    roomId,
    (ticket.body as { ticket: string }).ticket,
  );
  clients.push(client);
  await until(() => client.messages.some((message) => message.type === 'welcome'), 'a welcome');
  return client;
}

/** Every leaf of a JSON `value` — a string, number, boolean or `null` — with where it is. */
function leavesOf(value: unknown, path = '$'): [string, unknown][] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => leavesOf(item, `${path}[${String(index)}]`));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, item]) => leavesOf(item, `${path}.${key}`));
  }
  return [[path, value]];
}

async function freshRead<T>(read: (store: SqlStore) => Promise<T>): Promise<T> {
  if (directory === undefined) throw new Error('no instance');
  const store = await openSqlStore(join(directory, 'instance.sqlite'));
  try {
    return await read(store);
  } finally {
    await store.close();
  }
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'oyl-operate-rooms-'));
  const path = join(directory, 'instance.sqlite');
  await migrateForDeploy(path);
  const server = readServerConfig({ database: path, origin: TEST_ORIGIN, roomWorkers: '2' }, 2);
  if (!server.ok) throw new Error(server.problems.join(' '));
  const ownerDevice = await testDevice();
  const deputyDevice = await testDevice();
  running = await startInstance({
    config: testConfig({
      bodyLimitBytes: 16_384,
      registration: 'open',
      moderators: { owner: ownerDevice.publicKey, deputy: deputyDevice.publicKey },
      // Four riders from one loopback address is past the registration limit
      // (3 an hour): each signs in from an address of their own.
      clientAddressHeader: 'x-test-address',
      trustedProxies: ['127.0.0.1', '::1', '::ffff:127.0.0.1'],
    }),
    server: {
      ...server.config,
      blobsPath: join(directory, 'blobs'),
      secretKey: new Uint8Array(32).fill(7),
    },
    version: '0',
    notices: '',
    log: () => undefined,
    defaultCountdownMs: 0,
    roomId: () => {
      const next = roomIds.shift();
      if (next === undefined) throw new Error('no room id left for this file');
      return next;
    },
  });
  await running.opened;
  await running.keysMaintained;
  owner = await signIn(ownerDevice, 'Owner', '192.0.2.1');
  ann = await signIn(await testDevice(), 'Ann', '192.0.2.2');
  bea = await signIn(await testDevice(), 'Bea', '192.0.2.3');
  cal = await signIn(await testDevice(), 'Cal', '192.0.2.4');

  // A room is placed by a hash of its id over the live workers: Cal's group
  // ride is given an id that lands on the other worker from Ann's race.
  const raceId = '1'.padStart(32, '0');
  const rideId = placedApartFrom(raceId);
  roomIds.push(raceId, rideId);
  race = await made(ann, { kind: 'race' });
  ride = await made(cal, { kind: 'group' });
  expect([race.roomId, ride.roomId]).toEqual([raceId, rideId]);
  expect((await sealed(bea, 'POST', '/v1/rooms/join', { code: race.code })).status).toBe(200);
  annSocket = await socketInto(ann, race.roomId);
  beaSocket = await socketInto(bea, race.roomId);
  calSocket = await socketInto(cal, ride.roomId);
  calSocket.report(1, POWER_WATTS);
  // The ride starts on its first rider, and is under way from its first frame.
  await until(
    () => calSocket.messages.some((message) => message.type === 'frame'),
    'the ride’s first frame',
    WAIT_MS,
  );
});

afterAll(async () => {
  for (const client of clients.splice(0)) client.socket.terminate();
  await running?.stop();
  running = undefined;
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe('the owner’s Rooms on the running instance — #2612', () => {
  it('reads both rooms, on two workers, and all three riders by name — and no power', async () => {
    const placedOn = [race.roomId, ride.roomId].map((roomId) =>
      running?.router.placementOf(roomId),
    );
    expect(placedOn.every((pid) => pid !== undefined)).toBe(true);
    expect(placedOn[0]).not.toBe(placedOn[1]);

    const listed = await sealed(owner, 'GET', '/v1/operate/rooms');
    expect(listed.status).toBe(200);
    const rooms = (listed.body as { rooms: Record<string, unknown>[] }).rooms;
    expect(rooms.find((room) => room.roomId === race.roomId)).toMatchObject({
      kind: 'race',
      phase: 'lobby',
      host: 'Ann',
      riders: ['Ann', 'Bea'],
      riderCount: 2,
    });
    expect(rooms.find((room) => room.roomId === ride.roomId)).toMatchObject({
      kind: 'group',
      phase: 'riding',
      host: 'Cal',
      riders: ['Cal'],
      riderCount: 1,
    });
    const text = JSON.stringify(listed.body);
    for (const absent of [ann.athleteId, bea.athleteId, cal.athleteId]) {
      expect(text).not.toContain(absent);
    }
    // No power (#2726): read field by field, because a room id is random hex
    // and spells `317` by chance about one run in a few hundred. No number is
    // the watt figure, and no string spells it but an id or short code that is
    // exactly that of a room this file made.
    const ids = new Set(madeRoomIds.flatMap((roomId) => [roomId, roomShortCode(roomId)]));
    for (const [path, leaf] of leavesOf(listed.body)) {
      if (typeof leaf === 'number') expect(leaf, path).not.toBe(POWER_WATTS);
      if (typeof leaf === 'string' && !ids.has(leaf)) {
        expect(leaf, path).not.toContain(String(POWER_WATTS));
      }
    }
  });

  it('ends the race: its sockets closed 4005, a rejoin refused, the ride untouched, a result kept, and logged', async () => {
    // A result already final, written as the router's `onResult` writes one,
    // and the race decided, so its riders may read it.
    await freshRead(async (store) => {
      await store.putResult({
        roomId: race.roomId,
        athleteId: ann.athleteId,
        finishMs: 61_000,
        flags: 0,
        place: 1,
        wattsPerKilogram: 4.2,
        flaggedDurationsSeconds: [],
      });
      await store.markRaceStarted(race.roomId, Math.floor(Date.now() / 1000) - 120);
      await store.markRaceFinished(race.roomId, Math.floor(Date.now() / 1000));
    });

    const ended = await sealed(owner, 'POST', `/v1/operate/rooms/${race.roomId}/end`, {
      reason: 'other',
      confirm: roomShortCode(race.roomId),
    });
    expect(ended.status, JSON.stringify(ended.body)).toBe(200);

    const [annClosed, beaClosed] = await Promise.all([annSocket.closed, beaSocket.closed]);
    expect(annClosed).toEqual({ code: 4005, reason: 'room-closed' });
    expect(beaClosed).toEqual({ code: 4005, reason: 'room-closed' });
    expect(annSocket.messages).toContainEqual({ type: 'refuse', reason: 'room-closed' });

    // A rejoin: no ticket is issued, and a socket is refused in words.
    const ticket = await sealed(bea, 'POST', `/v1/rooms/${race.roomId}/ticket`, {
      declaredMassKilograms: 70,
    });
    expect(ticket.status).toBe(404);
    const rejoin = await joinRoom(
      running?.url.replace(/^http/, 'ws') ?? '',
      race.roomId,
      undefined,
    );
    clients.push(rejoin);
    expect(await rejoin.closed).toEqual({ code: 4005, reason: 'room-closed' });

    // The ride on the other worker is untouched: Cal is still in it, and it ticks on.
    const framesBefore = calSocket.messages.filter((message) => message.type === 'frame').length;
    await until(
      () => calSocket.messages.filter((message) => message.type === 'frame').length > framesBefore,
      'another frame of the ride',
      WAIT_MS,
    );
    expect(calSocket.socket.readyState).toBe(calSocket.socket.OPEN);
    const listed = await sealed(owner, 'GET', '/v1/operate/rooms');
    const rooms = (listed.body as { rooms: { roomId: string; riders: unknown }[] }).rooms;
    expect(rooms.some((room) => room.roomId === race.roomId)).toBe(false);
    expect(rooms.find((room) => room.roomId === ride.roomId)?.riders).toEqual(['Cal']);

    // The result already final is still Ann's to read.
    const results = await sealed(ann, 'GET', `/v1/rooms/${race.roomId}/results`);
    expect(results.status, JSON.stringify(results.body)).toBe(200);
    expect(JSON.stringify(results.body)).toContain('61000');

    // And the operator log says so, through its own route.
    const log = (await sealed(owner, 'GET', '/v1/operate/log')).body as {
      entries: { action: string; detail: string | null; outcome: string }[];
    };
    expect(log.entries[0]).toMatchObject({
      action: 'room_ended',
      detail: 'other,race,riders=2',
      outcome: 'done',
    });
  });
});
