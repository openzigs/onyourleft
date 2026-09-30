// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A ride's **"may be raced"** consent on the instance (#793, ADR 0021 D-5.1,
 * ADR 0039 D-2.5): off unless its rider sets it, set only by its rider,
 * revocable, carried in the manifest and the account export, and what the
 * instance would serve as raceable read on a FRESH store after every change.
 *
 * Three riders who all sent the SAME file, so a consent keyed on the content
 * alone — which every one of them shares — would show here.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { IdentityInstance } from '../auth/identity-testing.ts';
import { openSqlStore } from '../store/open-sql-store.ts';
import { authorised, corpusFile, syncWorld, uploadBody } from './sync-testing.ts';

let world: IdentityInstance | undefined;
afterEach(async () => {
  await world?.close();
  world = undefined;
});

type Rider = Awaited<ReturnType<typeof syncWorld>>['riders'][number];

async function send(instance: IdentityInstance, rider: Rider): Promise<string> {
  const answer = await authorised(
    instance,
    rider.token,
    'POST',
    '/v1/sync/records',
    await uploadBody(rider.device, corpusFile('nominal-ride.gpx')),
  );
  expect(answer.status, await answer.clone().text()).toBe(200);
  return ((await answer.json()) as { contentSha256: string }).contentSha256;
}

const consent = (instance: IdentityInstance, rider: Rider, content: string, body: unknown) =>
  authorised(instance, rider.token, 'POST', `/v1/sync/records/${content}/race-consent`, body);

/** What the instance would serve as raceable to `requester`, on a store opened for this read. */
async function raceableFor(instance: IdentityInstance, requester: Rider): Promise<string[]> {
  const fresh = await openSqlStore(instance.path);
  try {
    return (await fresh.listRaceableActivities(requester.athleteId, 100)).map(
      (record) => record.athleteId,
    );
  } finally {
    await fresh.close();
  }
}

async function threeRidersOneFile() {
  const setup = await syncWorld(3);
  world = setup.world;
  const [a, b, c] = setup.riders as [Rider, Rider, Rider];
  const content = await send(world, a);
  expect(await send(world, b)).toBe(content);
  expect(await send(world, c)).toBe(content);
  return { instance: world, a, b, c, content };
}

describe('the consent on the instance (#793)', () => {
  it('is off for every ride that arrives, so nothing is raceable', async () => {
    const { instance, a } = await threeRidersOneFile();
    expect(await raceableFor(instance, a)).toStrictEqual([]);
  });

  it('serves another rider’s ride only once its rider consents, and never the requester’s own', async () => {
    const { instance, a, b, c, content } = await threeRidersOneFile();

    const set = await consent(instance, b, content, { mayBeRaced: true });
    expect(set.status, await set.clone().text()).toBe(200);
    expect(await set.json()).toStrictEqual({ mayBeRaced: true });
    await consent(instance, a, content, { mayBeRaced: true });

    // A sees B's ride and not their own; C sees both A's and B's.
    expect(await raceableFor(instance, a)).toStrictEqual([b.athleteId]);
    expect((await raceableFor(instance, c)).sort()).toStrictEqual(
      [a.athleteId, b.athleteId].sort(),
    );
    // And B's consent is B's alone, though the file is the same for all three.
    expect(await raceableFor(instance, b)).toStrictEqual([a.athleteId]);
  });

  it('takes a revoked ride out of what it serves, on the next read', async () => {
    const { instance, a, b, content } = await threeRidersOneFile();
    await consent(instance, b, content, { mayBeRaced: true });
    expect(await raceableFor(instance, a)).toStrictEqual([b.athleteId]);

    const revoked = await consent(instance, b, content, { mayBeRaced: false });
    expect(revoked.status).toBe(200);

    expect(await raceableFor(instance, a)).toStrictEqual([]);
  });

  it('will not let one rider consent for another’s ride', async () => {
    const setup = await syncWorld(2);
    world = setup.world;
    const [a, b] = setup.riders as [Rider, Rider];
    const content = await send(world, a);

    // B holds no record of this file: not_found, the same as a ride that does not exist.
    const refused = await consent(world, b, content, { mayBeRaced: true });
    expect(refused.status).toBe(404);
    expect(await raceableFor(world, b)).toStrictEqual([]);
  });

  it('refuses a consent that is not true or false, and a key that is not a content hash', async () => {
    const { instance, a, content } = await threeRidersOneFile();
    const unclear = await consent(instance, a, content, { mayBeRaced: 'yes' });
    expect(unclear.status).toBe(400);
    const nothing = await consent(instance, a, content, {});
    expect(nothing.status).toBe(400);
    const notAHash = await consent(instance, a, 'ride-1', { mayBeRaced: true });
    expect(notAHash.status).toBe(404);
  });

  it('carries the consent in the manifest and the account export', async () => {
    const { instance, a, content } = await threeRidersOneFile();
    await consent(instance, a, content, { mayBeRaced: true });

    const manifest = (await (
      await authorised(instance, a.token, 'GET', '/v1/sync/manifest')
    ).json()) as { items: { kind: string; key: string; mayBeRaced: boolean | null }[] };
    expect(
      manifest.items.find((item) => item.kind === 'activity' && item.key === content)?.mayBeRaced,
    ).toBe(true);

    await authorised(instance, a.token, 'POST', '/v1/sync/items/note/note-1', { body: 'a note' });
    const withNote = (await (
      await authorised(instance, a.token, 'GET', '/v1/sync/manifest')
    ).json()) as { items: { kind: string; mayBeRaced: boolean | null }[] };
    expect(withNote.items.find((item) => item.kind === 'note')?.mayBeRaced).toBeNull();

    const exported = (await (
      await authorised(instance, a.token, 'GET', '/v1/account/export')
    ).json()) as { activities: { contentSha256: string; mayBeRaced: boolean }[] };
    expect(exported.activities.map((activity) => activity.mayBeRaced)).toStrictEqual([true]);
  });
});
