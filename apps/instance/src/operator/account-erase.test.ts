// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `account-erase` (#1802): one rider's account, erased when the recovery code
 * they emailed matches it — run as an operator runs it, `node
 * src/operator/cli.ts account-erase` in a child process with the code on
 * standard input, beside a RUNNING instance whose files and rooms' routes are
 * on disk where the command finds them.
 *
 * The erasure is read back through the paths a rider's own erasure is tested
 * by: every athlete-scoped table the SCHEMA has (`sync/account.test.ts`), the
 * object store, the session, and a room the rider made — its row closed, its
 * route gone, nobody handed it or let in (`rooms/rooms.test.ts`). The other
 * riders' rows, files and rooms are read back unchanged.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { toHex } from '@onyourleft/domain';

import type { IdentityInstance } from '../auth/identity-testing.ts';
import { sha256Hex } from '../auth/crypto.ts';
import { createDiskBlobStore } from '../blob/disk-blob-store.ts';
import { madeRoom, ROOM_GPX } from '../rooms/rooms-testing.ts';
import { openDatabase } from '../store/node-sqlite.ts';
import { sha256Bytes } from '../sync/sync.ts';
import { authorised, corpusFile, syncWorld, uploadBody } from '../sync/sync-testing.ts';

const INSTANCE = fileURLToPath(new URL('../..', import.meta.url));
const CLI = fileURLToPath(new URL('./cli.ts', import.meta.url));
const FILES = ['nominal-outdoor-ride.fit', 'nominal-ride.gpx', 'nominal-ride.tcx'] as const;

let world: IdentityInstance | undefined;
let directory: string | undefined;
afterEach(async () => {
  await world?.close();
  world = undefined;
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

interface Data {
  readonly database: string;
  readonly blobs: string;
}

/**
 * The command in a child process, the code on its standard input. Not
 * `spawnSync`: the instance it runs beside is in THIS process, and must go on
 * serving while the command writes.
 */
function run(data: Data, input: string, ...args: string[]) {
  return new Promise<{
    status: number | null;
    stdout: string;
    stderr: string;
    report: Record<string, unknown>;
  }>((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: INSTANCE,
      env: {
        ...process.env,
        OYL_INSTANCE_DATABASE: data.database,
        OYL_INSTANCE_BLOBS: data.blobs,
      },
      timeout: 30_000,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (status) => {
      const report =
        status === 0
          ? (JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}') as Record<string, unknown>)
          : {};
      resolve({ status, stdout, stderr, report });
    });
    child.stdin.end(input);
  });
}

/** Every table with a foreign key to `athlete`, and the athlete row: how many name `athleteId`. */
function athleteRows(path: string, athleteId: string): Record<string, number> {
  const database = openDatabase(path);
  try {
    const tables = (
      database
        .prepare(
          `SELECT DISTINCT m.name AS name FROM sqlite_schema AS m, pragma_foreign_key_list(m.name) AS f
           WHERE m.type = 'table' AND f."table" = 'athlete' ORDER BY m.name`,
        )
        .all() as { name: string }[]
    ).map((row) => row.name);
    const count = (query: string) => (database.prepare(query).get(athleteId) as { n: number }).n;
    return {
      athlete: count('SELECT count(*) AS n FROM athlete WHERE id = ?'),
      ...Object.fromEntries(
        tables.map((table) => [
          table,
          count(`SELECT count(*) AS n FROM "${table}" WHERE athlete_id = ?`),
        ]),
      ),
    };
  } finally {
    database.close();
  }
}

/**
 * Three riders on an instance whose synced files and rooms' routes are on
 * disk, under the blob directory the command is pointed at, as a running
 * instance keeps them (`instance.ts`). Anna syncs every corpus file and Ben
 * the first of them, the same bytes; Anna and Cara each make a room, which
 * Ben joins.
 */
async function populated() {
  directory = await mkdtemp(join(tmpdir(), 'oyl-instance-account-erase-'));
  const blobs = join(directory, 'blobs');
  const setup = await syncWorld(3, {
    blobStoreSeenBy: () => createDiskBlobStore(blobs),
    roomRoutesSeenBy: () => createDiskBlobStore(join(blobs, 'rooms')),
  });
  world = setup.world;
  const w = setup.world;
  const [anna, ben, cara] = setup.riders as [
    (typeof setup.riders)[number],
    (typeof setup.riders)[number],
    (typeof setup.riders)[number],
  ];
  const files: Record<string, string[]> = {};
  for (const [rider, names] of [
    [anna, FILES],
    [ben, FILES.slice(0, 1)],
  ] as const) {
    files[rider.athleteId] = [];
    for (const [index, name] of names.entries()) {
      const sent = await authorised(
        w,
        rider.token,
        'POST',
        '/v1/sync/records',
        await uploadBody(rider.device, corpusFile(name), `ride-${String(index)}`),
      );
      expect(sent.status, await sent.clone().text()).toBe(200);
      files[rider.athleteId]?.push(
        ((await sent.json()) as { contentSha256: string }).contentSha256,
      );
    }
  }
  const annasRoom = await madeRoom(w, anna.token, {
    kind: 'group',
    gpx: ROOM_GPX.replace('51.502000', '51.503000'),
  });
  const carasRoom = await madeRoom(w, cara.token);
  for (const code of [annasRoom.code, carasRoom.code]) {
    const joined = await w.call('POST', '/v1/rooms/join', { token: ben.token, body: { code } });
    expect(joined.status).toBe(200);
  }
  return {
    w,
    data: { database: w.path, blobs } satisfies Data,
    blobs: createDiskBlobStore(blobs),
    routes: createDiskBlobStore(join(blobs, 'rooms')),
    anna,
    ben,
    cara,
    annasFiles: files[anna.athleteId] ?? [],
    annasRoom,
    carasRoom,
  };
}

/** Every form of a code a report or a refusal could leak it in. */
function leaks(output: string, code: string): boolean {
  const bare = code.replace(/-/g, '');
  return [code, bare, code.toUpperCase(), bare.toUpperCase()].some((form) => output.includes(form));
}

describe('account-erase — one rider’s account, by the recovery code they emailed (#1802)', () => {
  it('says what it would erase and erases nothing without --confirm; with it, erases that account as the rider’s own erasure does, rooms included, and no one else’s', async () => {
    const { w, data, blobs, routes, anna, ben, cara, annasFiles, annasRoom, carasRoom } =
      await populated();
    const code = anna.recoveryCodes[3] as string;
    // As a rider might copy it into an email: upper case, spaces for hyphens.
    const typed = `  ${code.toUpperCase().replace(/-/g, ' ')}\n`;
    const shared = toHex(await sha256Bytes(corpusFile(FILES[0])));
    const before = Object.fromEntries(
      [anna, ben, cara].map((rider) => [rider.athleteId, athleteRows(w.path, rider.athleteId)]),
    );
    expect(before[anna.athleteId]?.activity_record).toBe(FILES.length);
    expect(before[anna.athleteId]?.athlete).toBe(1);
    // On disk where the command looks, or "gone afterwards" proves nothing.
    const annasAlone = annasFiles.filter((each) => each !== shared);
    expect(annasAlone).toHaveLength(FILES.length - 1);
    for (const key of [...annasAlone, shared]) expect(await blobs.has(key), key).toBe(true);
    expect(await routes.has(annasRoom.routeSha256)).toBe(true);

    const dry = await run(data, typed, 'account-erase');
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.report).toEqual({
      command: 'account-erase',
      athleteId: anna.athleteId,
      deviceKeys: 1,
      activities: FILES.length,
      openRoomsMade: 1,
      results: 0,
      erased: false,
      next: expect.stringMatching(/--confirm/) as unknown,
    });
    expect(leaks(dry.stdout + dry.stderr, code)).toBe(false);
    for (const rider of [anna, ben, cara]) {
      expect(athleteRows(w.path, rider.athleteId)).toEqual(before[rider.athleteId]);
    }
    expect((await authorised(w, anna.token, 'GET', '/v1/sync/manifest')).status).toBe(200);

    const erased = await run(data, typed, 'account-erase', '--confirm');
    expect(erased.status, erased.stderr).toBe(0);
    expect(erased.report).toEqual({
      command: 'account-erase',
      athleteId: anna.athleteId,
      deviceKeys: 1,
      activities: FILES.length,
      openRoomsMade: 1,
      results: 0,
      erased: true,
    });
    expect(leaks(erased.stdout + erased.stderr, code)).toBe(false);

    // Every athlete-scoped table the schema has is empty of Anna…
    const after = athleteRows(w.path, anna.athleteId);
    expect(Object.keys(after)).toContain('sync_item');
    expect(Object.entries(after).filter(([, n]) => n > 0)).toEqual([]);
    // …and the others' rows are as they were.
    for (const rider of [ben, cara]) {
      expect(athleteRows(w.path, rider.athleteId)).toEqual(before[rider.athleteId]);
    }
    // Her files are out of the object store, but one Ben also sent stays his.
    for (const key of annasAlone) {
      expect(await blobs.has(key), key).toBe(false);
    }
    expect(await blobs.has(shared)).toBe(true);
    expect((await authorised(w, ben.token, 'GET', `/v1/sync/files/${shared}`)).status).toBe(200);
    // Her session went with the account: the running instance signs her out.
    expect((await authorised(w, anna.token, 'GET', '/v1/sync/manifest')).status).toBe(401);

    // Her room is over: its route deleted, its member not handed it, nobody let in.
    expect(await routes.has(annasRoom.routeSha256)).toBe(false);
    await w.freshRead(async (store) => {
      expect((await store.getPrivateRoom(annasRoom.roomId))?.closedAt).not.toBeNull();
      expect((await store.getPrivateRoom(carasRoom.roomId))?.closedAt).toBeNull();
    });
    expect(
      (await w.call('GET', `/v1/rooms/${annasRoom.roomId}/route`, { token: ben.token })).status,
    ).toBe(404);
    expect(
      (
        await w.call('POST', '/v1/rooms/join', {
          token: cara.token,
          body: { code: annasRoom.code },
        })
      ).status,
    ).toBe(404);
    // Cara's room is untouched.
    expect(await routes.has(carasRoom.routeSha256)).toBe(true);
    expect(
      (await w.call('GET', `/v1/rooms/${carasRoom.roomId}/route`, { token: ben.token })).status,
    ).toBe(200);

    // The code went with the account: run again, it matches nothing.
    const again = await run(data, typed, 'account-erase', '--confirm');
    expect(again.status).toBe(1);
    expect(again.stderr).toMatch(/No account on this instance holds that recovery code/);
    expect(leaks(again.stdout + again.stderr, code)).toBe(false);
  }, 90_000);

  it('erases nothing, and says why, for a code that is malformed, matches no account, or was used — and never prints it', async () => {
    const { w, data, anna, ben, cara } = await populated();
    const used = anna.recoveryCodes[0] as string;
    // Spent, as a recovery spends it: by its hash, read as the identity reads one.
    await w.freshRead((store) =>
      sha256Hex(used.replace(/-/g, '')).then((sha) => store.takeRecoveryCode(sha, 1)),
    );
    const before = [anna, ben, cara].map((rider) => athleteRows(w.path, rider.athleteId));

    const cases: [string, string, RegExp][] = [
      ['nothing', '', /does not hold a recovery code/],
      ['words', 'please delete my account\n', /does not hold a recovery code/],
      ['a letter no code has', 'abcd-efgh-jkmn-pqr0\n', /does not hold a recovery code/],
      ['too short', 'abcd-efgh-jkmn\n', /does not hold a recovery code/],
      [
        'two codes',
        `${anna.recoveryCodes[1] ?? ''}\n${ben.recoveryCodes[1] ?? ''}\n`,
        /does not hold a recovery code/,
      ],
      ['nobody’s code', 'abcd-efgh-jkmn-pqrs\n', /No account on this instance holds/],
      ['a used code', `${used}\n`, /already used/],
    ];
    for (const [what, input, problem] of cases) {
      for (const confirm of [[], ['--confirm']]) {
        const refused = await run(data, input, 'account-erase', ...confirm);
        expect(refused.status, what).toBe(1);
        expect(refused.stderr, what).toMatch(problem);
        expect(refused.stderr, what).toMatch(/Nothing was erased/);
        for (const line of input.split('\n').filter((each) => each.trim() !== '')) {
          expect(leaks(refused.stdout + refused.stderr, line.trim()), what).toBe(false);
        }
      }
    }
    expect([anna, ben, cara].map((rider) => athleteRows(w.path, rider.athleteId))).toEqual(before);
  }, 90_000);

  it('takes the code from standard input only: one on the command line is refused, never echoed, and erases nothing', async () => {
    const { w, data, anna } = await populated();
    const code = anna.recoveryCodes[2] as string;
    const before = athleteRows(w.path, anna.athleteId);
    for (const args of [[code], ['--confirm', code], [code, '--confirm']]) {
      const refused = await run(data, `${code}\n`, 'account-erase', ...args);
      expect(refused.status).toBe(1);
      expect(refused.stderr).toMatch(/standard input, never from the command line/);
      expect(leaks(refused.stdout + refused.stderr, code)).toBe(false);
    }
    expect(athleteRows(w.path, anna.athleteId)).toEqual(before);
  }, 60_000);

  it('refuses where there is no database, and creates none', async () => {
    directory = await mkdtemp(join(tmpdir(), 'oyl-instance-account-erase-'));
    const data = { database: join(directory, 'instance.sqlite'), blobs: join(directory, 'blobs') };
    const refused = await run(data, 'abcd-efgh-jkmn-pqrs\n', 'account-erase', '--confirm');
    expect(refused.status).toBe(1);
    expect(refused.stderr).toMatch(/There is no database here/);
    expect(existsSync(data.database)).toBe(false);
  }, 30_000);
});
