// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The load run's throwaway accounts (#1383): `load-accounts add` and
 * `load-accounts erase`, run as an operator runs them — `node
 * src/operator/cli.ts …` in a child process, the public keys on standard
 * input — against a real database that riders' accounts are already in.
 *
 * The accounts are proved by their real consumer: `tools/race-load.ts`'s own
 * riders race a room on an instance whose registration is `approval`, and a
 * key the command did not add is still held for approval there. After the
 * erase, every athlete-scoped table the schema has is read for the erased
 * ids, and the riders' accounts are read back unchanged.
 */

import { spawnSync } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { newRiderKeys, raceLoad } from '../../tools/race-load-run.ts';
import { signIn, ticketFor } from '../../tools/tunnel-soak-run.ts';
import { startInstance, type StartedInstance } from '../instance.ts';
import { freeLoopbackPort, testConfig } from '../instance-testing.ts';
import { ROUTES } from '../routes.ts';
import { readServerConfig } from '../server-config.ts';
import { openDatabase } from '../store/node-sqlite.ts';
import { migrateForDeploy, openServingStore } from '../store/serving.ts';
import { ATHLETES, seedWorld } from '../store/testing/index.ts';

const INSTANCE = fileURLToPath(new URL('../..', import.meta.url));
const CLI = fileURLToPath(new URL('./cli.ts', import.meta.url));

let running: StartedInstance | undefined;
let directory: string | undefined;
afterEach(async () => {
  await running?.stop();
  running = undefined;
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

interface Data {
  readonly database: string;
  readonly blobs: string;
}

function run(data: Data, input: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: INSTANCE,
    encoding: 'utf8',
    input,
    env: { ...process.env, OYL_INSTANCE_DATABASE: data.database, OYL_INSTANCE_BLOBS: data.blobs },
    timeout: 30_000,
  });
  const report =
    result.status === 0
      ? (JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}') as Record<string, unknown>)
      : {};
  return { status: result.status, stderr: result.stderr, report };
}

/** A migrated database holding the three fixture riders' accounts and a race room. */
async function populated(): Promise<Data> {
  directory = await mkdtemp(join(tmpdir(), 'oyl-instance-load-accounts-'));
  const data = { database: join(directory, 'instance.sqlite'), blobs: join(directory, 'blobs') };
  await migrateForDeploy(data.database);
  const store = openServingStore(data.database);
  try {
    await seedWorld(store);
  } finally {
    await store.close();
  }
  const opened = run(data, '', 'room-open', 'race', '--kind', 'race', '--length', '20');
  expect(opened.status, opened.stderr).toBe(0);
  return data;
}

async function serve(data: Data): Promise<string> {
  const port = await freeLoopbackPort();
  const origin = `http://127.0.0.1:${String(port)}`;
  const server = readServerConfig(
    { database: data.database, blobs: data.blobs, origin, roomWorkers: '1' },
    1,
  );
  if (!server.ok) throw new Error(server.problems.join(' '));
  running = await startInstance({
    // The owner's instance: riders are held for approval, and stay so.
    config: testConfig({ port, bodyLimitBytes: 16_384, registration: 'approval' }),
    server: server.config,
    version: '0',
    notices: '',
    log: () => undefined,
  });
  return origin;
}

/** Every table with a foreign key to `athlete`, read from the database itself. */
function athleteScopedTables(path: string): string[] {
  const database = openDatabase(path);
  try {
    return (
      database
        .prepare(
          `SELECT DISTINCT m.name AS name FROM sqlite_schema AS m, pragma_foreign_key_list(m.name) AS f
           WHERE m.type = 'table' AND f."table" = 'athlete' ORDER BY m.name`,
        )
        .all() as { name: string }[]
    ).map((row) => row.name);
  } finally {
    database.close();
  }
}

/** How many rows name each athlete: the athlete row and every athlete-scoped table's. */
function rowsNaming(path: string, athleteIds: readonly string[]): Record<string, number> {
  const tables = athleteScopedTables(path);
  const database = openDatabase(path);
  try {
    const count = (query: string, id: string) =>
      (database.prepare(query).get(id) as { n: number }).n;
    const rows: Record<string, number> = {};
    for (const id of athleteIds) {
      rows[`athlete ${id}`] = count('SELECT count(*) AS n FROM athlete WHERE id = ?', id);
      for (const table of tables) {
        rows[`${table} ${id}`] = count(
          `SELECT count(*) AS n FROM "${table}" WHERE athlete_id = ?`,
          id,
        );
      }
    }
    return rows;
  } finally {
    database.close();
  }
}

function deviceKeysHeld(path: string, publicKeys: readonly string[]): number {
  const database = openDatabase(path);
  try {
    return publicKeys.filter(
      (key) =>
        (
          database
            .prepare('SELECT count(*) AS n FROM device_key WHERE public_key = ?')
            .get(key) as {
            n: number;
          }
        ).n > 0,
    ).length;
  } finally {
    database.close();
  }
}

async function loadAthletes(data: Data) {
  const store = openServingStore(data.database);
  try {
    const ids = await store.listLoadAthletes();
    return Promise.all(
      ids.map(async (id) => {
        const athlete = await store.getAthlete(id);
        return { id, name: athlete?.displayName, state: athlete?.registrationState };
      }),
    );
  } finally {
    await store.close();
  }
}

async function freshPair(): Promise<webcrypto.CryptoKeyPair> {
  return (await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as unknown as webcrypto.CryptoKeyPair;
}

describe('load-accounts add and erase — #1383', () => {
  it('adds approved accounts the load run can race on an `approval` instance, and erases every row of them and nothing else', async () => {
    const data = await populated();
    const keys = await newRiderKeys(2);
    const publicKeys = keys.map((key) => key.publicKey);

    const added = run(data, `${publicKeys.join('\n')}\n`, 'load-accounts', 'add');
    expect(added.status, added.stderr).toBe(0);
    expect(added.report).toEqual({ command: 'load-accounts add', added: 2, held: 2 });
    const made = await loadAthletes(data);
    expect(
      made
        .map(({ name, state }) => ({ name, state }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name))),
    ).toEqual([
      { name: 'Load 1', state: 'active' },
      { name: 'Load 2', state: 'active' },
    ]);

    // The real consumer: the load run's riders take tickets and race to the line.
    const url = await serve(data);
    const report = await raceLoad({
      url,
      roomId: 'race',
      keys,
      namePrefix: 'Load',
      maximumMs: 45_000,
    });
    expect(report.abortReason).toBeNull();
    expect(report.raceOver).toBe(true);
    expect(report.finishers).toBe(2);
    // Registration is still `approval`: a key the command did not add is held,
    // and refused a ticket — even one calling itself a load rider.
    const strangerPair = await freshPair();
    const strangerKey = Buffer.from(
      await webcrypto.subtle.exportKey('raw', strangerPair.publicKey),
    ).toString('hex');
    const stranger = await signIn(url, 'Load 9', strangerPair);
    await expect(ticketFor(stranger, 'race')).rejects.toThrow(/refused: 403/);
    await running?.stop();
    running = undefined;

    // Read with the instance stopped: it prunes some rows of its own as it runs.
    const riders = rowsNaming(data.database, ATHLETES);
    expect(Object.values(riders).filter((n) => n > 0).length).toBeGreaterThan(ATHLETES.length);
    const ids = made.map((each) => each.id);
    expect(Object.values(rowsNaming(data.database, ids)).some((n) => n > 0)).toBe(true);
    const erased = run(data, '', 'load-accounts', 'erase');
    expect(erased.status, erased.stderr).toBe(0);
    expect(erased.report).toEqual({ command: 'load-accounts erase', erased: 2, remaining: 0 });

    const after = rowsNaming(data.database, ids);
    expect(Object.keys(after).length).toBeGreaterThan(ids.length);
    expect(Object.entries(after).filter(([, n]) => n > 0)).toEqual([]);
    expect(deviceKeysHeld(data.database, publicKeys)).toBe(0);
    // The riders' accounts, every row of them, and the stranger's are untouched.
    expect(rowsNaming(data.database, ATHLETES)).toEqual(riders);
    const store = openServingStore(data.database);
    try {
      const held = await store.findDeviceKey(strangerKey);
      expect(held).toBeDefined();
      expect((await store.getAthlete(held!.athleteId))?.registrationState).toBe('pending');
    } finally {
      await store.close();
    }

    const again = run(data, '', 'load-accounts', 'erase');
    expect(again.report).toEqual({ command: 'load-accounts erase', erased: 0, remaining: 0 });
  }, 90_000);

  it('refuses a key an account it did not make already holds, and writes nothing', async () => {
    const data = await populated();
    const [fresh] = await newRiderKeys(1);
    // A rider's account with a real key, named like a load rider.
    const store = openServingStore(data.database);
    const riderKey = 'ab'.repeat(32);
    try {
      await store.registerAthlete({
        athlete: {
          id: 'rider-d',
          displayName: 'Load 1',
          createdAt: 1,
          registrationState: 'active',
        },
        key: { publicKey: riderKey, athleteId: 'rider-d', addedAt: 1, revokedAt: null },
        recoveryCodeSha256s: [],
      });
    } finally {
      await store.close();
    }
    const refused = run(data, `${fresh!.publicKey}\n${riderKey}\n`, 'load-accounts', 'add');
    expect(refused.status).toBe(1);
    expect(refused.stderr).toMatch(/1 of these keys already belong to an account/);
    expect(await loadAthletes(data)).toEqual([]);
    expect(deviceKeysHeld(data.database, [fresh!.publicKey])).toBe(0);

    // An account named like a load rider is still not one: erase leaves it.
    const erased = run(data, '', 'load-accounts', 'erase');
    expect(erased.report).toEqual({ command: 'load-accounts erase', erased: 0, remaining: 0 });
    expect(rowsNaming(data.database, ['rider-d'])['athlete rider-d']).toBe(1);

    // Nor does a second add take a key an earlier run already holds.
    expect(run(data, `${fresh!.publicKey}\n`, 'load-accounts', 'add').status).toBe(0);
    const twice = run(data, `${fresh!.publicKey}\n`, 'load-accounts', 'add');
    expect(twice.status).toBe(1);
    expect(await loadAthletes(data)).toHaveLength(1);
  }, 30_000);

  it.each([
    ['nothing', '', /holds no public keys/],
    ['a line that is not a key', `${'ab'.repeat(32)}\nnot-a-key\n`, /Line 2 of standard input/],
    ['an upper-case key', `${'AB'.repeat(32)}\n`, /Line 1 of standard input/],
    ['a key twice', `${'ab'.repeat(32)}\n${'ab'.repeat(32)}\n`, /names a public key twice/],
  ])('refuses %s on standard input, and writes nothing', async (_, input, problem) => {
    const data = await populated();
    const refused = run(data, input, 'load-accounts', 'add');
    expect(refused.status).toBe(1);
    expect(refused.stderr).toMatch(problem);
    expect(await loadAthletes(data)).toEqual([]);
  });

  it('takes nothing on the command line', async () => {
    const data = await populated();
    expect(run(data, '', 'load-accounts', 'add', 'ab'.repeat(32)).status).toBe(1);
    expect(run(data, '', 'load-accounts', 'erase', '--all').status).toBe(1);
    expect(run(data, '', 'load-accounts').status).toBe(1);
  });

  it('is reachable over no route: nothing the instance serves makes or erases a load account', () => {
    for (const route of ROUTES) {
      expect(`${route.path} ${route.operationId}`).not.toMatch(/load/i);
    }
  });
});
