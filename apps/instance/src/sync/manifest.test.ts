// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Two-way sync on the instance (#776): the manifest a device pages through,
 * the signed record it pulls, and the items #776's 2026-09-29 addition names —
 * write-ups, side-camera reports with their pose summaries, goals, notes and
 * reference documents — each scoped to its athlete, each stored exactly as
 * sent, and each deleted with a tombstone the athlete's other devices can see.
 */

import { toHex } from '@onyourleft/domain';
import { afterEach, describe, expect, it } from 'vitest';

import type { IdentityInstance } from '../auth/identity-testing.ts';
import { ITEM_KINDS, sha256Bytes } from './sync.ts';
import { authorised, corpusFile, syncWorld, uploadBody } from './sync-testing.ts';

let world: IdentityInstance | undefined;
afterEach(async () => {
  await world?.close();
  world = undefined;
});

type Rider = Awaited<ReturnType<typeof syncWorld>>['riders'][number];

interface Entry {
  kind: string;
  key: string;
  digest: string | null;
  deleted: boolean;
  activityId: string | null;
  receivedAt: number;
}

async function readJson<T>(response: Response): Promise<T> {
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as T;
}

async function manifestOf(instance: IdentityInstance, rider: Rider): Promise<Entry[]> {
  const entries: Entry[] = [];
  let cursor: string | null = null;
  do {
    const query: string = cursor === null ? '' : `&cursor=${cursor}`;
    const page: { items: Entry[]; next: string | null } = await readJson(
      await authorised(instance, rider.token, 'GET', `/v1/sync/manifest?limit=2${query}`),
    );
    entries.push(...page.items);
    cursor = page.next;
  } while (cursor !== null);
  return entries;
}

const put = (instance: IdentityInstance, rider: Rider, kind: string, key: string, body: string) =>
  authorised(instance, rider.token, 'POST', `/v1/sync/items/${kind}/${key}`, { body });

describe('the sync manifest (#776)', () => {
  it('pages with a (receivedAt, id) cursor: while items land between pages, none twice and none missed — even when the clock steps back', async () => {
    const setup = await syncWorld(1);
    world = setup.world;
    const [rider] = setup.riders;
    for (let index = 0; index < 5; index += 1) {
      await put(world, rider!, 'note', `note-${String(index)}`, `note ${String(index)}`);
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let added = 5;
    do {
      const query: string = cursor === null ? '' : `&cursor=${cursor}`;
      const page: { items: Entry[]; next: string | null } = await readJson(
        await authorised(world, rider!.token, 'GET', `/v1/sync/manifest?limit=2${query}`),
      );
      seen.push(...page.items.map((item) => item.key));
      cursor = page.next;
      if (added < 11) {
        // A device elsewhere syncs two more — and this instance's clock has
        // just been set back an hour.
        world.clock.ms -= 3_600_000;
        await put(world, rider!, 'note', `note-${String(added)}`, 'later');
        await put(world, rider!, 'goal', `goal-${String(added)}`, 'later');
        added += 1;
      }
    } while (cursor !== null);
    expect(new Set(seen).size, 'no entry twice').toBe(seen.length);
    const everything = (await manifestOf(world, rider!)).map((entry) => entry.key);
    expect(seen.sort(), 'no entry missed').toEqual(everything.sort());
    expect(everything).toHaveLength(5 + 2 * 6);
  });

  it('says which ride an activity is, and refuses a cursor it did not write', async () => {
    const setup = await syncWorld(1);
    world = setup.world;
    const [rider] = setup.riders;
    const body = await uploadBody(rider!.device, corpusFile('nominal-ride.gpx'), 'morning-loop');
    await readJson(await authorised(world, rider!.token, 'POST', '/v1/sync/records', body));
    const [entry] = await manifestOf(world, rider!);
    expect(entry).toMatchObject({ kind: 'activity', activityId: 'morning-loop', deleted: false });
    const refused = await authorised(
      world,
      rider!.token,
      'GET',
      '/v1/sync/manifest?cursor=WzEsMl0',
    );
    expect(refused.status).toBe(400);
  });
});

/**
 * Three athletes' rides and items, each read back through the real listener.
 * Under coverage on the CI runner this case took 2 944 ms (run 38048816433,
 * EPYC 9V74) and 4 001 ms (run 38051571333, `main`, EPYC 7763) — 80 % of
 * Vitest's 5 s default — and ran past 5 s on run 38052735064 (EPYC 9V74), with
 * nothing hung; 968 ms locally without coverage. About three times the slowest
 * green figure (docs/agents/ci.md §4c); nothing it drives is trimmed.
 */
const THREE_ATHLETES_CASE_MS = 15_000;

describe('three athletes, the same keys, the same file (#776)', () => {
  it(
    'answers each athlete their own manifest, record and items, and nothing of the other two',
    async () => {
      const setup = await syncWorld(3);
      world = setup.world;
      const riders = setup.riders;
      const bytes = corpusFile('nominal-outdoor-ride.fit');
      const shared = toHex(await sha256Bytes(bytes));
      for (const rider of riders) {
        await readJson(
          await authorised(
            world,
            rider.token,
            'POST',
            '/v1/sync/records',
            await uploadBody(rider.device, bytes, `ride-of-${rider.athleteId}`),
          ),
        );
        for (const kind of ITEM_KINDS) {
          // The SAME key for all three, and a body each can tell apart.
          await readJson(
            await put(world, rider, kind, 'same-key', `${kind} of ${rider.athleteId}`),
          );
          await readJson(await put(world, rider, kind, `only-${rider.athleteId}`, 'mine'));
        }
      }

      for (const rider of riders) {
        const manifest = await manifestOf(world, rider);
        expect(manifest).toHaveLength(1 + ITEM_KINDS.length * 2);
        const others = riders.filter((other) => other !== rider).map((other) => other.athleteId);
        for (const entry of manifest) {
          for (const other of others) expect(entry.key).not.toContain(other);
        }
        expect(manifest.find((entry) => entry.kind === 'activity')?.activityId).toBe(
          `ride-of-${rider.athleteId}`,
        );

        const pulled: { record: { publicKey: string } } = await readJson(
          await authorised(world, rider.token, 'GET', `/v1/sync/records/${shared}`),
        );
        expect(pulled.record.publicKey, 'the same file, but this athlete’s record').toBe(
          rider.device.publicKey,
        );

        for (const kind of ITEM_KINDS) {
          const mine: { body: string } = await readJson(
            await authorised(world, rider.token, 'GET', `/v1/sync/items/${kind}/same-key`),
          );
          expect(mine.body).toBe(`${kind} of ${rider.athleteId}`);
          for (const other of others) {
            const theirs = await authorised(
              world,
              rider.token,
              'GET',
              `/v1/sync/items/${kind}/only-${other}`,
            );
            expect(theirs.status, `${kind} of ${other}`).toBe(404);
            expect(
              (
                await authorised(
                  world,
                  rider.token,
                  'DELETE',
                  `/v1/sync/items/${kind}/only-${other}`,
                )
              ).status,
            ).toBe(404);
          }
        }
      }
      // Nobody's delete reached anybody else's item.
      for (const rider of riders) {
        expect(await manifestOf(world, rider)).toHaveLength(1 + ITEM_KINDS.length * 2);
      }
    },
    THREE_ATHLETES_CASE_MS,
  );
});

describe('items (#776)', () => {
  it('keeps a write-up exactly as the device sent it — every byte, and its digest', async () => {
    const setup = await syncWorld(1);
    world = setup.world;
    const [rider] = setup.riders;
    // A screened copy with the characters a re-serialisation would change.
    const body = '{"text":"Held 250 W — then “eased”.\\n  Trailing  ","z":1,"a":2}  ';
    const stored: { digest: string } = await readJson(
      await put(world, rider!, 'write-up', 'ride-1', body),
    );
    expect(stored.digest).toBe(toHex(await sha256Bytes(new TextEncoder().encode(body))));
    const read: { body: string } = await readJson(
      await authorised(world, rider!.token, 'GET', '/v1/sync/items/write-up/ride-1'),
    );
    expect(read.body).toBe(body);
    const raw = await world.freshRead((store) =>
      store.getSyncItem(rider!.athleteId, 'write-up', 'ride-1'),
    );
    expect(new TextDecoder().decode(raw?.body ?? new Uint8Array())).toBe(body);
  });

  it('answers the same bytes again as unchanged, and a change as a new manifest entry', async () => {
    const setup = await syncWorld(1);
    world = setup.world;
    const [rider] = setup.riders;
    await readJson(await put(world, rider!, 'side-camera-report', 'ride-1', '{"pose":null}'));
    await readJson(await put(world, rider!, 'note', 'n', 'after'));
    const again: { unchanged: boolean } = await readJson(
      await put(world, rider!, 'side-camera-report', 'ride-1', '{"pose":null}'),
    );
    expect(again.unchanged).toBe(true);
    expect((await manifestOf(world, rider!)).map((entry) => entry.kind)).toEqual([
      'side-camera-report',
      'note',
    ]);
    await readJson(await put(world, rider!, 'side-camera-report', 'ride-1', '{"pose":{"a":1}}'));
    expect((await manifestOf(world, rider!)).map((entry) => entry.kind)).toEqual([
      'note',
      'side-camera-report',
    ]);
  });

  it('leaves a tombstone for a deleted item, and takes a deleted ride’s file unless another rider holds it', async () => {
    const setup = await syncWorld(2);
    world = setup.world;
    const [anna, ben] = setup.riders;
    await readJson(await put(world, anna!, 'document', 'plan', 'a training plan'));
    expect(
      (await authorised(world, anna!.token, 'DELETE', '/v1/sync/items/document/plan')).status,
    ).toBe(204);
    expect(
      (await authorised(world, anna!.token, 'GET', '/v1/sync/items/document/plan')).status,
    ).toBe(404);
    expect((await manifestOf(world, anna!))[0]).toMatchObject({
      kind: 'document',
      key: 'plan',
      deleted: true,
      digest: null,
    });

    const solo = corpusFile('nominal-ride.tcx');
    const both = corpusFile('nominal-outdoor-ride.fit');
    const soloSha = toHex(await sha256Bytes(solo));
    const bothSha = toHex(await sha256Bytes(both));
    for (const [rider, bytes] of [
      [anna!, solo],
      [anna!, both],
      [ben!, both],
    ] as const) {
      await readJson(
        await authorised(
          world,
          rider.token,
          'POST',
          '/v1/sync/records',
          await uploadBody(rider.device, bytes),
        ),
      );
    }
    for (const sha of [soloSha, bothSha]) {
      expect(
        (await authorised(world, anna!.token, 'DELETE', `/v1/sync/items/activity/${sha}`)).status,
      ).toBe(204);
    }
    expect(world.blobs.has(soloSha), 'nobody else held it').toBe(false);
    expect(world.blobs.has(bothSha), 'Ben still holds it').toBe(true);
    expect(
      (await authorised(world, anna!.token, 'GET', `/v1/sync/records/${bothSha}`)).status,
    ).toBe(404);
    expect((await authorised(world, ben!.token, 'GET', `/v1/sync/files/${bothSha}`)).status).toBe(
      200,
    );
    const annas = await manifestOf(world, anna!);
    expect(annas.filter((entry) => entry.kind === 'activity' && entry.deleted)).toHaveLength(2);
  });

  it('refuses a kind it does not carry', async () => {
    const setup = await syncWorld(1);
    world = setup.world;
    const [rider] = setup.riders;
    expect((await put(world, rider!, 'activity', 'x', 'a ride without a signature')).status).toBe(
      404,
    );
    expect((await put(world, rider!, 'password', 'x', 'no')).status).toBe(404);
  });
});
