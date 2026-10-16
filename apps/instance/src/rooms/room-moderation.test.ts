// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Moderation in a room — #789**, on the RUNNING instance: the production
 * `startInstance`, its router and a real room worker, riders on real sockets.
 * Everything the instance keeps is read back from the database file through a
 * second connection, the path a moderator's queue reads.
 *
 * - a block keeps two riders' names from each other in a race, both ways;
 * - a rider reports another from the ride, by their seat, with a reason from
 *   the fixed list: the report carries the room and its tick;
 * - a plausibility flag files exactly one report per breached ceiling;
 * - the host removes a rider from their room, a moderator removes one from
 *   any room, hides a name and suspends: each is in the log, a removed
 *   rider's socket is closed and their ticket refused;
 * - nobody else may do any of it.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RoomMessage } from '@onyourleft/protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { TEST_ORIGIN, testDevice, type TestDevice } from '../auth/identity-testing.ts';
import { testConfig } from '../instance-testing.ts';
import { startInstance, type StartedInstance } from '../instance.ts';
import { flagReason, ROOM_REPORT_REASONS } from '../moderation/moderation.ts';
import { TEST_STATEMENT } from '../moderation/moderation-testing.ts';
import { joinRoom, type RoomClient } from '../room/node/router-testing.ts';
import { until } from '../room/node/node-room-testing.ts';
import { readServerConfig } from '../server-config.ts';
import { migrateForDeploy } from '../store/serving.ts';
import { openSqlStore } from '../store/open-sql-store.ts';
import type { SqlStore } from '../store/sql-store.ts';
import { roomBody } from './rooms-testing.ts';
import { wholeModerationLog } from '../store/testing/index.ts';

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

async function world(moderator: TestDevice) {
  directory = await mkdtemp(join(tmpdir(), 'oyl-room-moderation-'));
  const path = join(directory, 'instance.sqlite');
  await migrateForDeploy(path);
  const server = readServerConfig({ database: path, origin: TEST_ORIGIN, roomWorkers: '1' }, 1);
  if (!server.ok) throw new Error(server.problems.join(' '));
  running = await startInstance({
    config: testConfig({
      bodyLimitBytes: 16_384,
      registration: 'open',
      moderators: { owner: moderator.publicKey },
      // Five riders from one loopback address is past the registration limit
      // (3 an hour): each signs in from an address of their own, through a
      // header believed from loopback alone.
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
  const signIn = async (displayName: string, device?: TestDevice): Promise<Rider> => {
    const key = device ?? (await testDevice());
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
        body: JSON.stringify({ ...(await key.statement(challenge.nonce)), displayName }),
      })
    ).json()) as { sessionToken: string; athleteId: string };
    return { token: session.sessionToken, athleteId: session.athleteId };
  };
  const ticket = async (rider: Rider, roomId: string) =>
    call('POST', `/v1/rooms/${roomId}/ticket`, rider.token, { declaredMassKilograms: 72 });
  const seat = async (rider: Rider, roomId: string): Promise<RoomClient> => {
    const answer = await ticket(rider, roomId);
    if (answer.status !== 200) throw new Error(`no ticket: ${JSON.stringify(answer)}`);
    const client = await joinRoom(
      url.replace('http://', 'ws://'),
      roomId,
      (answer.body as { ticket: string }).ticket,
    );
    clients.push(client);
    await until(() => client.messages.some((m) => m.type === 'welcome'), 'a welcome');
    return client;
  };
  /** A fresh connection to the instance's own file: what a moderator's queue reads. */
  const read = async <T>(run: (store: SqlStore) => Promise<T>): Promise<T> => {
    const store = await openSqlStore(path);
    try {
      return await run(store);
    } finally {
      await store.close();
    }
  };
  return { url, call, signIn, ticket, seat, read };
}

const riderIdOf = (client: RoomClient): number => {
  const welcome = client.messages.find((m) => m.type === 'welcome');
  if (welcome?.type !== 'welcome') throw new Error('no welcome');
  return welcome.riderId;
};

const namesIn = (client: RoomClient): string[] =>
  client.messages.flatMap((m: RoomMessage) => (m.type === 'name' ? [m.displayName] : []));

describe('moderation in a room on the running instance — #789', () => {
  it('hides blocked names both ways, files a rider’s report and the room’s flags, and lets the host and the moderator remove a rider', async () => {
    const moderatorDevice = await testDevice();
    const w = await world(moderatorDevice);
    const moderator = await w.signIn('Mod', moderatorDevice);
    const ann = await w.signIn('Ann');
    const bob = await w.signIn('Bob');
    const cat = await w.signIn('Cat');
    const dee = await w.signIn('Dee');
    // Bob blocks Cat before the race: neither is named to the other.
    expect((await w.call('POST', `/v1/blocks/${cat.athleteId}`, bob.token)).status).toBe(204);

    const made = await w.call('POST', '/v1/rooms', ann.token, roomBody({ lengthMetres: 2_000 }));
    expect(made.status).toBe(200);
    const room = made.body as { roomId: string; code: string };
    for (const rider of [bob, cat, dee]) {
      expect(
        (await w.call('POST', '/v1/rooms/join', rider.token, { code: room.code })).status,
      ).toBe(200);
    }
    const annSocket = await w.seat(ann, room.roomId);
    const bobSocket = await w.seat(bob, room.roomId);
    const catSocket = await w.seat(cat, room.roomId);
    const deeSocket = await w.seat(dee, room.roomId);
    await until(() => namesIn(annSocket).length === 4, 'Ann told all four names');
    await until(() => namesIn(deeSocket).length === 4, 'Dee told all four names');
    await until(() => namesIn(bobSocket).length === 3, 'Bob told three names');
    await until(() => namesIn(catSocket).length === 3, 'Cat told three names');
    expect(namesIn(bobSocket).sort()).toEqual(['Ann', 'Bob', 'Dee']);
    expect(namesIn(catSocket).sort()).toEqual(['Ann', 'Cat', 'Dee']);
    expect(namesIn(annSocket).sort()).toEqual(['Ann', 'Bob', 'Cat', 'Dee']);

    expect((await w.call('POST', `/v1/rooms/${room.roomId}/start`, ann.token)).status).toBe(200);
    let sequence = 0;
    const pedal = setInterval(() => {
      sequence += 1;
      annSocket.report(sequence, 200);
      bobSocket.report(sequence, 200);
      deeSocket.report(sequence, 200);
      // Cat rides at 2 000 W: past the 5 s ceiling of 18 W/kg at 72 kg.
      catSocket.report(sequence, 2_000);
    }, 250);
    try {
      // The flag is a report the room files: one, for the ceiling breached.
      await until(
        () => catSocket.messages.some((m) => m.type === 'frame' && m.tick >= 8),
        'eight seconds of racing',
        20_000,
      );
      await until(() => false, 'a beat for the write', 300).catch(() => undefined);
      const flagged = (await w.read((store) => store.listOpenReports())).filter(
        (report) => report.flag !== null,
      );
      expect(flagged).toEqual([
        expect.objectContaining({
          athleteId: null,
          targetAthleteId: cat.athleteId,
          roomId: room.roomId,
          flag: { durationSeconds: 5, ceilingWattsPerKilogram: 18 },
          reason: flagReason({ durationSeconds: 5, ceilingWattsPerKilogram: 18 }),
        }),
      ]);
      expect(flagged[0]?.roomTick).toBeGreaterThan(0);

      // Bob reports Cat from the ride: by the seat, with a reason from the list.
      const reported = await w.call('POST', `/v1/rooms/${room.roomId}/reports`, bob.token, {
        riderId: riderIdOf(catSocket),
        reason: 'cheating',
      });
      expect(reported.status).toBe(204);
      const byBob = await w.read((store) => store.listReports(bob.athleteId));
      expect(byBob).toEqual([
        expect.objectContaining({
          athleteId: bob.athleteId,
          targetAthleteId: cat.athleteId,
          reason: ROOM_REPORT_REASONS.cheating,
          roomId: room.roomId,
          flag: null,
        }),
      ]);
      expect(byBob[0]?.roomTick).toBeGreaterThan(0);
      // Not a reason off the list, not their own seat, not a room they are not in.
      expect(
        (
          await w.call('POST', `/v1/rooms/${room.roomId}/reports`, bob.token, {
            riderId: riderIdOf(catSocket),
            reason: 'free text',
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await w.call('POST', `/v1/rooms/${room.roomId}/reports`, moderator.token, {
            riderId: riderIdOf(catSocket),
            reason: 'cheating',
          })
        ).status,
      ).toBe(404);

      // Only the host removes from their room: Bob is refused, and nothing is logged.
      expect(
        (
          await w.call('POST', `/v1/rooms/${room.roomId}/remove`, bob.token, {
            riderId: riderIdOf(deeSocket),
            reason: 'Because',
          })
        ).status,
      ).toBe(404);
      expect(await w.read((store) => wholeModerationLog(store))).toEqual([]);
      // Ann, the host, removes Dee.
      const hostRemoved = await w.call('POST', `/v1/rooms/${room.roomId}/remove`, ann.token, {
        riderId: riderIdOf(deeSocket),
        reason: 'Abusive in the lobby',
      });
      expect(hostRemoved.status).toBe(200);
      expect((await deeSocket.closed).code).toBe(4003);

      // A non-moderator is refused the moderators' removal as if it were not there.
      const path = `/v1/moderation/rooms/${room.roomId}/athletes/${cat.athleteId}/remove`;
      expect((await w.call('POST', path, ann.token, { reason: 'Because' })).status).toBe(404);
      // The moderator removes Cat, deciding the flag's report.
      const modRemoved = await w.call('POST', path, moderator.token, {
        reason: 'Over the 5 s ceiling',
        reportId: flagged[0]?.id,
        // #1384: a moderator's removal carries its statement of reasons.
        statement: TEST_STATEMENT,
      });
      expect(modRemoved.status).toBe(200);
      expect((await catSocket.closed).code).toBe(4003);
    } finally {
      clearInterval(pedal);
    }

    // Neither is let back in.
    expect((await w.ticket(dee, room.roomId)).status).toBe(404);
    expect((await w.ticket(cat, room.roomId)).status).toBe(404);
    expect((await w.ticket(bob, room.roomId)).status).toBe(200);

    // The moderator's other actions, in the room's wake.
    const hidden = await w.call(
      'POST',
      `/v1/moderation/athletes/${bob.athleteId}/hide-display-name`,
      moderator.token,
      { reason: 'Name reported in the room', statement: TEST_STATEMENT },
    );
    expect(hidden.status).toBe(200);
    const suspended = await w.call(
      'POST',
      `/v1/moderation/athletes/${cat.athleteId}/suspend`,
      moderator.token,
      { reason: 'Cheating in a race', statement: TEST_STATEMENT },
    );
    expect(suspended.status).toBe(200);

    expect(await w.read((store) => wholeModerationLog(store))).toEqual([
      expect.objectContaining({
        action: 'host_remove_from_room',
        actorAthleteId: ann.athleteId,
        targetAthleteId: dee.athleteId,
        reason: 'Abusive in the lobby',
        roomId: room.roomId,
      }),
      expect.objectContaining({
        action: 'remove_from_room',
        actorAthleteId: moderator.athleteId,
        targetAthleteId: cat.athleteId,
        reason: 'Over the 5 s ceiling',
        reportId: expect.any(Number) as unknown,
        roomId: room.roomId,
      }),
      expect.objectContaining({
        action: 'hide_display_name',
        actorAthleteId: moderator.athleteId,
        targetAthleteId: bob.athleteId,
        roomId: null,
      }),
      expect.objectContaining({
        action: 'suspend',
        actorAthleteId: moderator.athleteId,
        targetAthleteId: cat.athleteId,
        roomId: null,
      }),
    ]);
    // The flag's report is decided by the removal.
    expect(
      (await w.read((store) => store.listOpenReports())).filter((r) => r.flag !== null),
    ).toEqual([]);
  }, 60_000);
});
