// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Ended through the admin page, read the way the riders' sockets read it**
 * (#2649): on the RUNNING instance — the production `startInstance`, its
 * router and TWO real room-worker processes, `OYL_INSTANCE_ADMIN_PAGES=on` —
 * three riders in two rooms on real sockets. The owner ends one room through
 * the Rooms page with its typed code and a fresh passkey: its sockets close
 * `4005 room-closed`, a rejoin is refused, the other room is still listed on
 * a reload, and `room_ended` is read back through `GET /v1/operate/log`. A
 * wrong code first changes nothing, and a power a rider reported is never on
 * any `/admin/rooms*` answer.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_ORIGIN, testDevice, type TestDevice } from '../auth/identity-testing.ts';
import { startInstance, type StartedInstance } from '../instance.ts';
import { testConfig } from '../instance-testing.ts';
import { roomShortCode } from '../operate/operate.ts';
import { until } from '../room/node/node-room-testing.ts';
import { joinRoom, type RoomClient } from '../room/node/router-testing.ts';
import { roomBody } from '../rooms/rooms-testing.ts';
import { sealedAt } from '../sealed/sealed-testing.ts';
import { readServerConfig } from '../server-config.ts';
import { migrateForDeploy } from '../store/serving.ts';
import {
  adminBrowser,
  overHttp,
  passkeySessionOn,
  steppedUpForm,
  type AdminBrowser,
  type PasskeySession,
} from './admin-testing.ts';

/** The bound of a wait inside a case, which has Vitest's 5 s (#2567). */
const WAIT_MS = 3_000;

/** A power nothing else in a body could be by accident. */
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
let race: { readonly roomId: string; readonly code: string };
let ride: { readonly roomId: string };
let annSocket: RoomClient;
let beaSocket: RoomClient;
let calSocket: RoomClient;
let browser: AdminBrowser;
let admin: PasskeySession;
let bea: Session;

async function sealed(who: Session, method: string, path: string, body?: unknown) {
  if (running === undefined) throw new Error('no instance');
  const answer = await sealedAt(running.url, TEST_ORIGIN, {
    method,
    path,
    token: who.token,
    signer: who.device.signingKey,
    ...(body === undefined ? {} : { body }),
  });
  return {
    status: answer.status,
    body: (answer.text === '' ? null : JSON.parse(answer.text)) as unknown,
  };
}

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

async function made(who: Session, overrides: Record<string, unknown>) {
  const answer = await sealed(who, 'POST', '/v1/rooms', roomBody(overrides));
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  return answer.body as { roomId: string; code: string };
}

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

const roomEndedEntries = async () =>
  (
    (await sealed(owner, 'GET', '/v1/operate/log')).body as {
      entries: { action: string; source: string; detail: string | null; outcome: string }[];
    }
  ).entries.filter((entry) => entry.action === 'room_ended');

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'oyl-admin-rooms-'));
  const path = join(directory, 'instance.sqlite');
  await migrateForDeploy(path);
  const server = readServerConfig(
    { database: path, origin: TEST_ORIGIN, roomWorkers: '2', adminPages: 'on' },
    2,
  );
  if (!server.ok) throw new Error(server.problems.join(' '));
  const ownerDevice = await testDevice();
  running = await startInstance({
    config: testConfig({
      bodyLimitBytes: 16_384,
      registration: 'open',
      moderators: { owner: ownerDevice.publicKey },
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
  });
  await running.opened;
  await running.keysMaintained;
  owner = await signIn(ownerDevice, 'Owner', '192.0.2.1');
  const ann = await signIn(await testDevice(), 'Ann', '192.0.2.2');
  bea = await signIn(await testDevice(), 'Bea', '192.0.2.3');
  const cal = await signIn(await testDevice(), 'Cal', '192.0.2.4');
  race = await made(ann, { kind: 'race' });
  // Two workers hold the rooms wherever their ids hash: which worker is #2612's test's concern.
  ride = await made(cal, { kind: 'group' });
  expect((await sealed(bea, 'POST', '/v1/rooms/join', { code: race.code })).status).toBe(200);
  annSocket = await socketInto(ann, race.roomId);
  beaSocket = await socketInto(bea, race.roomId);
  calSocket = await socketInto(cal, ride.roomId);
  // A power reported into the ride's state: never on any admin answer.
  calSocket.report(1, POWER_WATTS);
  await until(
    () => calSocket.messages.some((message) => message.type === 'frame'),
    'the ride’s first frame',
    WAIT_MS,
  );
  browser = adminBrowser(overHttp(running.url));
  admin = await passkeySessionOn(
    browser,
    { database: path, blobs: join(directory, 'blobs') },
    () => new Date(),
  );
});

afterAll(async () => {
  for (const client of clients.splice(0)) client.socket.terminate();
  await running?.stop();
  running = undefined;
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

async function endThrough(fields: Readonly<Record<string, string>>): Promise<Response> {
  const form = await steppedUpForm(browser, admin, 'room_end', fields, { page: '/admin/rooms' });
  return browser.send('POST', '/admin/rooms/end', { cookie: admin.token, form });
}

describe('the Rooms page on the running instance (#2649)', () => {
  it('lists both rooms by name, and a wrong code ends neither — every socket still open, nothing logged', async () => {
    const listed = await browser.send('GET', '/admin/rooms', { cookie: admin.token });
    const html = await listed.text();
    expect(listed.status).toBe(200);
    expect(html).toContain('2 riders: Ann and Bea.');
    expect(html).toContain('1 rider: Cal.');
    expect(html).not.toContain(String(POWER_WATTS));

    const wrong = await endThrough({
      roomId: race.roomId,
      reason: 'other',
      confirm: roomShortCode(ride.roomId),
    });
    expect(wrong.status).toBe(400);
    expect(await wrong.text()).not.toContain(String(POWER_WATTS));
    for (const socket of [annSocket, beaSocket, calSocket]) {
      expect(socket.socket.readyState).toBe(socket.socket.OPEN);
    }
    expect(await roomEndedEntries()).toEqual([]);
  });

  it('ends the race by its typed code: its sockets closed 4005, a rejoin refused, the ride still listed on a reload, and room_ended logged', async () => {
    const ended = await endThrough({
      roomId: race.roomId,
      reason: 'abuse',
      confirm: roomShortCode(race.roomId),
    });
    expect(ended.status, await ended.clone().text()).toBe(200);
    expect(await ended.text()).not.toContain(String(POWER_WATTS));

    const [annClosed, beaClosed] = await Promise.all([annSocket.closed, beaSocket.closed]);
    expect(annClosed).toEqual({ code: 4005, reason: 'room-closed' });
    expect(beaClosed).toEqual({ code: 4005, reason: 'room-closed' });

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

    // The ride is untouched, and a reload of the page still lists it.
    expect(calSocket.socket.readyState).toBe(calSocket.socket.OPEN);
    const reloaded = await (
      await browser.send('GET', '/admin/rooms', { cookie: admin.token })
    ).text();
    expect(reloaded).toContain(ride.roomId);
    expect(reloaded).not.toContain(race.roomId);
    expect(reloaded).not.toContain(String(POWER_WATTS));

    expect(await roomEndedEntries()).toEqual([
      expect.objectContaining({
        source: 'admin_tunnel',
        detail: 'abuse,race,riders=2',
        outcome: 'done',
      }),
    ]);
  });
});
