// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Account export and deletion on the instance (#35) — the instance-side half.
 * The local half (the device's own export and erase) is #219 and #220's.
 *
 * What deletion MEANS here, and what it cannot reach, is said by the route
 * itself (`routes.ts` §`eraseAccount`): every row of the athlete's on THIS
 * instance and every original file no other rider also sent; not a copy
 * anybody already downloaded, and not another instance.
 */

import { toHex } from '@onyourleft/domain';
import { decodeFitActivity, decodeGpx, decodeTcx, trackPointsOf } from '@onyourleft/fit';
import { afterEach, describe, expect, it } from 'vitest';

import type { IdentityInstance } from '../auth/identity-testing.ts';
import type { BlobStore } from '../blob/blob-store.ts';
import { openDatabase } from '../store/node-sqlite.ts';
import { ITEM_KINDS, sha256Bytes, type AccountExport } from './sync.ts';
import { authorised, corpusFile, signedRecordOf, syncWorld, uploadBody } from './sync-testing.ts';

let world: IdentityInstance | undefined;
afterEach(async () => {
  await world?.close();
  world = undefined;
});

type Rider = Awaited<ReturnType<typeof syncWorld>>['riders'][number];

const FILES = ['nominal-outdoor-ride.fit', 'nominal-ride.gpx', 'nominal-ride.tcx'] as const;

async function readJson<T>(response: Response): Promise<T> {
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as T;
}

async function syncEverything(instance: IdentityInstance, rider: Rider): Promise<string[]> {
  const keys: string[] = [];
  for (const [index, name] of FILES.entries()) {
    const sent: { contentSha256: string } = await readJson(
      await authorised(
        instance,
        rider.token,
        'POST',
        '/v1/sync/records',
        await uploadBody(rider.device, corpusFile(name), `ride-${String(index)}`),
      ),
    );
    keys.push(sent.contentSha256);
  }
  for (const kind of ITEM_KINDS) {
    await readJson(
      await authorised(instance, rider.token, 'POST', `/v1/sync/items/${kind}/ride-0`, {
        body: `${kind} for ${rider.athleteId}`,
      }),
    );
  }
  return keys;
}

/** Every table with a foreign key to `athlete`, read from the database itself. */
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
    return Object.fromEntries(
      tables.map((table) => [
        table,
        (
          database
            .prepare(`SELECT count(*) AS n FROM "${table}" WHERE athlete_id = ?`)
            .get(athleteId) as { n: number }
        ).n,
      ]),
    );
  } finally {
    database.close();
  }
}

describe('exporting an account (#35)', () => {
  it('gives every activity as its ORIGINAL file, which decodes, and a manifest of the rest', async () => {
    const setup = await syncWorld(1);
    world = setup.world;
    const [rider] = setup.riders;
    const keys = await syncEverything(world, rider!);

    const exported: AccountExport = await readJson(
      await authorised(world, rider!.token, 'GET', '/v1/account/export'),
    );
    expect(exported).toMatchObject({ format: 'onyourleft.instance-account', version: 1 });
    expect(exported.athlete.id).toBe(rider!.athleteId);
    expect(exported.deviceKeys.map((key) => key.publicKey)).toEqual([rider!.device.publicKey]);
    expect(exported.activities.map((activity) => activity.contentSha256).sort()).toEqual(
      [...keys].sort(),
    );
    expect(exported.items.map((item) => item.kind).sort()).toEqual([...ITEM_KINDS].sort());
    expect(exported.items.find((item) => item.kind === 'write-up')?.body).toBe(
      `write-up for ${rider!.athleteId}`,
    );
    expect(exported.notIncluded.length).toBeGreaterThan(0);

    for (const activity of exported.activities) {
      const answer = await authorised(world, rider!.token, 'GET', activity.file);
      expect(answer.status).toBe(200);
      const bytes = new Uint8Array(await answer.arrayBuffer());
      expect(toHex(await sha256Bytes(bytes)), 'the original bytes').toBe(activity.contentSha256);
      const name = FILES.find((file) => toHex(corpusFile(file)) === toHex(bytes));
      expect(name, 'byte for byte one of the files sent').toBeDefined();
      if (name!.endsWith('.fit')) {
        // #30's decoder reads it, positions and all: the rider's true track.
        const decoded = decodeFitActivity(bytes).activity.records;
        const sent = decodeFitActivity(corpusFile(name!)).activity.records;
        expect(decoded.length).toBeGreaterThan(0);
        expect(decoded.map((record) => record.position)).toEqual(
          sent.map((record) => record.position),
        );
        expect(decoded.some((record) => record.position !== undefined)).toBe(true);
      } else {
        const text = new TextDecoder().decode(bytes);
        const points = trackPointsOf(
          (name!.endsWith('.gpx') ? decodeGpx(text) : decodeTcx(text)).activity,
        );
        expect(points.some((point) => point.position !== undefined)).toBe(true);
      }
    }
  });

  it('exports nothing of another athlete’s', async () => {
    const setup = await syncWorld(3);
    world = setup.world;
    for (const rider of setup.riders) await syncEverything(world, rider);
    for (const rider of setup.riders) {
      const exported: AccountExport = await readJson(
        await authorised(world, rider.token, 'GET', '/v1/account/export'),
      );
      const others = setup.riders.filter((other) => other !== rider);
      const text = JSON.stringify(exported);
      for (const other of others) {
        expect(text).not.toContain(other.athleteId);
        expect(text).not.toContain(other.device.publicKey);
      }
      for (const activity of exported.activities) {
        expect(activity.record.publicKey).toBe(rider.device.publicKey);
      }
    }
  });
});

describe('deleting an account (#35)', () => {
  it('takes every object the athlete alone held out of the object store, and keeps one another rider holds', async () => {
    const setup = await syncWorld(2);
    world = setup.world;
    const [anna, ben] = setup.riders;
    const keys = await syncEverything(world, anna!);
    // Ben sent one of the same files.
    await readJson(
      await authorised(
        world,
        ben!.token,
        'POST',
        '/v1/sync/records',
        await uploadBody(ben!.device, corpusFile(FILES[0])),
      ),
    );
    const shared = toHex(await sha256Bytes(corpusFile(FILES[0])));
    for (const key of keys) expect(world.blobs.has(key), 'captured before').toBe(true);

    const erased = await authorised(world, anna!.token, 'DELETE', '/v1/account');
    expect(erased.status).toBe(204);

    for (const key of keys.filter((each) => each !== shared)) {
      // The object store's own read: a memory store's `get` is its 404.
      expect(world.blobs.get(key), key).toBeUndefined();
    }
    expect(world.blobs.has(shared), 'Ben still holds it').toBe(true);
    const bens = await authorised(world, ben!.token, 'GET', `/v1/sync/files/${shared}`);
    expect(bens.status).toBe(200);
  });

  it('empties every athlete-scoped table the SCHEMA has of that athlete — the #776 items included — and no one else’s', async () => {
    const setup = await syncWorld(3);
    world = setup.world;
    for (const rider of setup.riders) await syncEverything(world, rider);
    const [anna, ben, cara] = setup.riders;
    const before = athleteRows(world.path, anna!.athleteId);
    expect(Object.keys(before)).toContain('sync_item');
    // Seeded, or "empty afterwards" proves nothing. Not every identity table
    // has a row for a rider who only signed in; the ones that do are checked.
    expect(before.sync_item).toBeGreaterThan(ITEM_KINDS.length);
    expect(before.activity_record).toBe(FILES.length);

    expect((await authorised(world, anna!.token, 'DELETE', '/v1/account')).status).toBe(204);

    for (const [table, count] of Object.entries(athleteRows(world.path, anna!.athleteId))) {
      expect(count, `${table} emptied`).toBe(0);
    }
    for (const other of [ben!, cara!]) {
      expect(athleteRows(world.path, other.athleteId)).toEqual(before);
    }
    // The session went with the account: the device is signed out, not erroring.
    expect((await authorised(world, anna!.token, 'GET', '/v1/sync/manifest')).status).toBe(401);
  });

  it('can be retried after it failed part way, and is harmless to repeat', async () => {
    let failures = 1;
    const setup = await syncWorld(1, {
      blobStoreSeenBy: (blobs): BlobStore => ({
        ...blobs,
        delete: async (key) => {
          if (failures > 0) {
            failures -= 1;
            // One file goes, then the object store fails.
            await blobs.delete(key);
            throw new Error('the object store is unreachable');
          }
          await blobs.delete(key);
        },
      }),
    });
    world = setup.world;
    const [rider] = setup.riders;
    const keys = await syncEverything(world, rider!);

    await expect(world.sync.eraseAccount(rider!.athleteId)).rejects.toThrow(/unreachable/);
    expect(
      athleteRows(world.path, rider!.athleteId).activity_record,
      'the rows that name the files are still there to be found',
    ).toBe(FILES.length);

    await world.sync.eraseAccount(rider!.athleteId);
    for (const key of keys) expect(world.blobs.has(key), key).toBe(false);
    for (const count of Object.values(athleteRows(world.path, rider!.athleteId))) {
      expect(count).toBe(0);
    }
    await expect(world.sync.eraseAccount(rider!.athleteId)).resolves.toBeUndefined();
  });

  it('erases a large account in one request — 500 rides, measured, and printed', async () => {
    const setup = await syncWorld(1);
    world = setup.world;
    const [rider] = setup.riders;
    await world.freshRead(async (store) => {
      for (let index = 0; index < 500; index += 1) {
        const bytes = new TextEncoder().encode(`ride ${String(index)}`);
        const record = await signedRecordOf(rider!.device, bytes, `ride-${String(index)}`);
        const signedRecord = new TextEncoder().encode(JSON.stringify(record));
        const content = toHex(await sha256Bytes(bytes));
        world!.blobs.set(content, bytes);
        await store.ingestActivity({
          athleteId: rider!.athleteId,
          contentSha256: content,
          signedRecord,
          recordSha256: toHex(await sha256Bytes(signedRecord)),
          now: 1_790_000_000,
        });
      }
    });
    const started = performance.now();
    const answer = await authorised(world, rider!.token, 'DELETE', '/v1/account');
    const took = performance.now() - started;
    expect(answer.status).toBe(204);
    expect(world.blobs.size).toBe(0);
    console.log(`#35 erase: 500 rides and their files in ${took.toFixed(0)} ms, in one request`);
    expect(took).toBeLessThan(ERASE_BUDGET_MS);
  }, 60_000);
});

/**
 * 500 rides erased within one request. Deletion is synchronous — there is no
 * queue on a single self-hosted process — so this is the figure that says it
 * does not need one yet; each run prints what it measured.
 */
const ERASE_BUDGET_MS = 5_000;
