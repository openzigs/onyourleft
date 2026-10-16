// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Public rooms on the running instance** (#788): `startInstance` as
 * `serve.ts` starts it, so what is held is `instance.ts`'s own wiring — the
 * operator's `OYL_INSTANCE_PUBLIC_ROOMS` reaching the rooms, and #775's
 * predicate read through the identity — not a test harness's. A public room
 * made, listed, joined, and a rider seated in it by its real room worker; and
 * the same instance left at its default offering none.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { TEST_ORIGIN, testDevice } from '../auth/identity-testing.ts';
import { testConfig } from '../instance-testing.ts';
import { startInstance, type StartedInstance } from '../instance.ts';
import { NO_LEGAL_SETTINGS } from '../legal.ts';
import { joinRoom, type RoomClient } from '../room/node/router-testing.ts';
import { until } from '../room/node/node-room-testing.ts';
import { readServerConfig } from '../server-config.ts';
import { migrateForDeploy } from '../store/serving.ts';
import { roomBody } from './rooms-testing.ts';

let directory: string | undefined;
let running: StartedInstance | undefined;
const clients: RoomClient[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) client.socket.terminate();
  await running?.stop();
  running = undefined;
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

interface Rider {
  readonly token: string;
  readonly athleteId: string;
}

async function world(publicRooms: boolean | undefined) {
  directory = await mkdtemp(join(tmpdir(), 'oyl-public-rooms-'));
  const path = join(directory, 'instance.sqlite');
  await migrateForDeploy(path);
  const server = readServerConfig({ database: path, origin: TEST_ORIGIN, roomWorkers: '1' }, 1);
  if (!server.ok) throw new Error(server.problems.join(' '));
  running = await startInstance({
    config: testConfig({
      bodyLimitBytes: 16_384,
      registration: 'open',
      // #775's thresholds at nothing: eligibility here is the 18+ confirmation.
      publicRooms: { minimumAccountDays: 0, minimumCompletedRides: 0 },
      // `undefined`: the product's own reading of an environment that sets nothing.
      legal: publicRooms === undefined ? NO_LEGAL_SETTINGS : { ...NO_LEGAL_SETTINGS, publicRooms },
      clientAddressHeader: 'x-test-address',
      trustedProxies: ['127.0.0.1', '::1', '::ffff:127.0.0.1'],
    }),
    server: { ...server.config, blobsPath: join(directory, 'blobs') },
    version: '9.8.7',
    notices: 'notices',
    log: () => undefined,
    defaultCountdownMs: 0,
  });
  await running.opened;
  const url = running.url;
  const call = async (method: string, route: string, token: string, body?: unknown) => {
    const response = await fetch(`${url}${route}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: (text === '' ? null : JSON.parse(text)) as unknown };
  };
  let riders = 0;
  const signIn = async (confirmsAdult: boolean): Promise<Rider> => {
    const key = await testDevice();
    riders += 1;
    const address = { 'x-test-address': `192.0.2.${String(riders)}` };
    const challenge = (await (
      await fetch(`${url}/v1/auth/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...address },
        body: JSON.stringify({ publicKey: key.publicKey }),
      })
    ).json()) as { nonce: string };
    const session = (await (
      await fetch(`${url}/v1/auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...address },
        body: JSON.stringify({ ...(await key.statement(challenge.nonce)), confirmsAdult }),
      })
    ).json()) as { sessionToken: string; athleteId: string };
    return { token: session.sessionToken, athleteId: session.athleteId };
  };
  return { url, call, signIn };
}

const startsSoon = (): number => Math.floor(Date.now() / 1000) + 30 * 60;

describe('public rooms on the running instance — #788', () => {
  it('turned on: an adult makes one, another lists it, joins it and is seated in it; one who has not declared is refused', async () => {
    const w = await world(true);
    const ann = await w.signIn(true);
    const bob = await w.signIn(true);
    const kid = await w.signIn(false);
    const made = await w.call(
      'POST',
      '/v1/rooms',
      ann.token,
      roomBody({ kind: 'group', visibility: 'public', startsAt: startsSoon() }),
    );
    expect(made.status).toBe(200);
    const { roomId } = made.body as { roomId: string };

    const listing = await w.call('GET', '/v1/rooms/public', bob.token);
    expect(listing.status).toBe(200);
    expect(
      (listing.body as { rooms: { roomId: string }[] }).rooms.map((each) => each.roomId),
    ).toEqual([roomId]);
    expect((await w.call('GET', '/v1/rooms/public', kid.token)).status).toBe(403);
    expect((await w.call('POST', `/v1/rooms/${roomId}/join`, kid.token)).status).toBe(403);

    expect((await w.call('POST', `/v1/rooms/${roomId}/join`, bob.token)).status).toBe(200);
    const ticket = await w.call('POST', `/v1/rooms/${roomId}/ticket`, bob.token, {
      declaredMassKilograms: 72,
    });
    expect(ticket.status).toBe(200);
    const client = await joinRoom(
      w.url.replace('http://', 'ws://'),
      roomId,
      (ticket.body as { ticket: string }).ticket,
    );
    clients.push(client);
    await until(() => client.messages.some((m) => m.type === 'welcome'), 'a welcome');
  });

  it('left at its default: no public room is made or listed, and a private one is made as ever', async () => {
    const w = await world(undefined);
    const ann = await w.signIn(true);
    const made = await w.call(
      'POST',
      '/v1/rooms',
      ann.token,
      roomBody({ visibility: 'public', startsAt: startsSoon() }),
    );
    expect(made.status).toBe(400);
    expect((await w.call('GET', '/v1/rooms/public', ann.token)).status).toBe(404);
    expect((await w.call('POST', '/v1/rooms', ann.token, roomBody())).status).toBe(200);
  });
});
