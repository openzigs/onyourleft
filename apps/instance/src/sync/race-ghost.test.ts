// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Another rider's ghost, served (#331, ADR 0039): ONE consented, offered ride
 * of somebody else's on the route asked for, or none.
 *
 * Every rider here sent the SAME file, so a read keyed on the content alone —
 * which all of them share — would show, and every refusal is checked against a
 * world where a ghost IS available to somebody else, so "none" is never the
 * trivial answer of an empty instance.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { testDevice, type IdentityInstance } from '../auth/identity-testing.ts';
import { openDatabase } from '../store/node-sqlite.ts';
import { openSqlStore } from '../store/open-sql-store.ts';
import { ghostSpeed, MAXIMUM_GHOST_SLOTS } from './race-ghost.ts';
import { authorised, corpusFile, longGpx, uploadBody } from './sync-testing.ts';
import { startIdentityInstance } from '../auth/identity-testing.ts';

let world: IdentityInstance | undefined;
afterEach(async () => {
  await world?.close();
  world = undefined;
});

interface Rider {
  readonly name: string;
  readonly token: string;
  readonly athleteId: string;
  readonly device: Awaited<ReturnType<typeof testDevice>>;
}

const ROUTE = 'a'.repeat(64);
const OTHER_ROUTE = 'b'.repeat(64);
const FILE = 'nominal-outdoor-ride.fit';

async function riders(...names: string[]): Promise<{ instance: IdentityInstance; all: Rider[] }> {
  const instance = await startIdentityInstance({ bodyLimitBytes: 256 * 1024 });
  world = instance;
  const all: Rider[] = [];
  for (const name of names) {
    const device = await testDevice();
    const session = await instance.signIn(device, { displayName: name });
    expect(session.status, JSON.stringify(session.body)).toBe(200);
    all.push({
      name,
      device,
      token: session.body.sessionToken as string,
      athleteId: session.body.athleteId as string,
    });
  }
  return { instance, all };
}

async function send(instance: IdentityInstance, rider: Rider, file = FILE): Promise<string> {
  const answer = await authorised(
    instance,
    rider.token,
    'POST',
    '/v1/sync/records',
    await uploadBody(rider.device, corpusFile(file)),
  );
  expect(answer.status, await answer.clone().text()).toBe(200);
  return ((await answer.json()) as { contentSha256: string }).contentSha256;
}

const consent = (instance: IdentityInstance, rider: Rider, content: string, mayBeRaced: boolean) =>
  authorised(instance, rider.token, 'POST', `/v1/sync/records/${content}/race-consent`, {
    mayBeRaced,
  });

const offer = (instance: IdentityInstance, rider: Rider, content: string, routeSha256: unknown) =>
  authorised(instance, rider.token, 'POST', `/v1/sync/records/${content}/race-route`, {
    routeSha256,
  });

/** Consent, then offer: what the device that signed the ride sends. */
async function offered(instance: IdentityInstance, rider: Rider, route = ROUTE): Promise<string> {
  const content = await send(instance, rider);
  expect((await consent(instance, rider, content, true)).status).toBe(200);
  const answer = await offer(instance, rider, content, route);
  expect(answer.status, await answer.clone().text()).toBe(200);
  return content;
}

interface Ghost {
  readonly rider: string;
  readonly sampleInterval: number;
  readonly speed: readonly (number | null)[];
}

async function ghostFor(
  instance: IdentityInstance,
  rider: Rider,
  route = ROUTE,
): Promise<Ghost | null> {
  const answer = await authorised(instance, rider.token, 'GET', `/v1/ghosts/${route}`);
  expect(answer.status, await answer.clone().text()).toBe(200);
  return ((await answer.json()) as { ghost: Ghost | null }).ghost;
}

describe('a ghost is served only from a ride its rider offered (#331)', () => {
  it('serves another rider’s offered ride: their name and their speed, and nothing else', async () => {
    const { instance, all } = await riders('Ada', 'Bea');
    const [ada, bea] = all as [Rider, Rider];
    await offered(instance, bea);

    const ghost = await ghostFor(instance, ada);

    expect(ghost).not.toBeNull();
    // Exactly these three members: no position, date, power, ride id or content hash.
    expect(Object.keys(ghost ?? {}).sort()).toStrictEqual(['rider', 'sampleInterval', 'speed']);
    expect(ghost?.rider).toBe('Bea');
    expect(ghost?.sampleInterval).toBe(1);
    expect(ghost?.speed.some((value) => typeof value === 'number' && value > 0)).toBe(true);
  });

  it('serves nothing for a consent with no offer, and refuses an offer with no consent', async () => {
    const { instance, all } = await riders('Ada', 'Bea');
    const [ada, bea] = all as [Rider, Rider];
    const content = await send(instance, bea);

    // No consent: the offer is refused, and nothing is served.
    expect((await offer(instance, bea, content, ROUTE)).status).toBe(404);
    expect(await ghostFor(instance, ada)).toBeNull();

    // A consent alone is not an offer: the signing device has not checked its zones.
    await consent(instance, bea, content, true);
    expect(await ghostFor(instance, ada)).toBeNull();

    expect((await offer(instance, bea, content, ROUTE)).status).toBe(200);
    expect((await ghostFor(instance, ada))?.rider).toBe('Bea');
  });

  it('serves nothing on another route, and never the requester’s own ride', async () => {
    const { instance, all } = await riders('Ada', 'Bea');
    const [ada, bea] = all as [Rider, Rider];
    await offered(instance, ada);
    await offered(instance, bea, OTHER_ROUTE);

    // Ada's own ride is on ROUTE, Bea's on OTHER_ROUTE.
    expect(await ghostFor(instance, ada, ROUTE)).toBeNull();
    expect((await ghostFor(instance, ada, OTHER_ROUTE))?.rider).toBe('Bea');
    expect((await ghostFor(instance, bea, ROUTE))?.rider).toBe('Ada');
  });

  it('stops serving a revoked ride on the next read, and a fresh consent is not an offer', async () => {
    const { instance, all } = await riders('Ada', 'Bea');
    const [ada, bea] = all as [Rider, Rider];
    const content = await offered(instance, bea);
    expect((await ghostFor(instance, ada))?.rider).toBe('Bea');

    await consent(instance, bea, content, false);
    expect(await ghostFor(instance, ada)).toBeNull();

    // Consenting again does not bring the old offer back: the device must
    // re-check its zones and send it again.
    await consent(instance, bea, content, true);
    expect(await ghostFor(instance, ada)).toBeNull();
  });

  it('reads the consent itself, not only the offer it stands on', async () => {
    const { instance, all } = await riders('Ada', 'Bea');
    const [ada, bea] = all as [Rider, Rider];
    await offered(instance, bea);
    // A row whose consent is off but whose offer was left behind — no route
    // writes one (a revocation clears it), so the read must not trust that.
    const db = openDatabase(instance.path);
    try {
      db.prepare('UPDATE activity_record SET may_be_raced = 0').run();
    } finally {
      db.close();
    }

    expect(await ghostFor(instance, ada)).toBeNull();
  });

  it('serves nothing once the offer is withdrawn', async () => {
    const { instance, all } = await riders('Ada', 'Bea');
    const [ada, bea] = all as [Rider, Rider];
    const content = await offered(instance, bea);

    const withdrawn = await offer(instance, bea, content, null);
    expect(withdrawn.status).toBe(200);
    expect(await withdrawn.json()).toStrictEqual({ routeSha256: null });

    expect(await ghostFor(instance, ada)).toBeNull();
  });

  it('will not let one rider offer another’s ride', async () => {
    const { instance, all } = await riders('Ada', 'Bea');
    const [ada, bea] = all as [Rider, Rider];
    const content = await send(instance, bea);
    await consent(instance, bea, content, true);

    // Ada holds no record of Bea's file: not_found, as for a ride that does not exist.
    expect((await offer(instance, ada, content, ROUTE)).status).toBe(404);
    expect(await ghostFor(instance, ada)).toBeNull();
  });

  it('passes over a rider the requester may not see, either way round, to the next', async () => {
    const { instance, all } = await riders('Ada', 'Bea', 'Cal');
    const [ada, bea, cal] = all as [Rider, Rider, Rider];
    await offered(instance, cal);
    instance.clock.ms += 60_000;
    await offered(instance, bea);
    // Bea's arrived later, so it is the one served.
    expect((await ghostFor(instance, ada))?.rider).toBe('Bea');

    const blocked = await authorised(instance, bea.token, 'POST', `/v1/blocks/${ada.athleteId}`);
    expect(blocked.status).toBe(204);
    // Bea blocked Ada: Ada is given Cal's, and never told why.
    expect((await ghostFor(instance, ada))?.rider).toBe('Cal');

    await authorised(instance, ada.token, 'POST', `/v1/blocks/${cal.athleteId}`);
    expect(await ghostFor(instance, ada)).toBeNull();
  });

  it('refuses an offer that is not a route digest, and serves nothing for a path that is not one', async () => {
    const { instance, all } = await riders('Ada', 'Bea');
    const [ada, bea] = all as [Rider, Rider];
    const content = await send(instance, bea);
    await consent(instance, bea, content, true);

    expect((await offer(instance, bea, content, 'A'.repeat(64))).status).toBe(400);
    expect((await offer(instance, bea, content, 'route')).status).toBe(400);
    expect((await offer(instance, bea, content, undefined)).status).toBe(400);
    expect((await offer(instance, bea, 'ride-1', ROUTE)).status).toBe(404);
    expect(await ghostFor(instance, ada, 'not-a-route')).toBeNull();
  });

  it('carries the offer in the manifest and the account export, read on a fresh store', async () => {
    const { instance, all } = await riders('Ada');
    const [ada] = all as [Rider];
    const content = await offered(instance, ada);

    const manifest = (await (
      await authorised(instance, ada.token, 'GET', '/v1/sync/manifest')
    ).json()) as { items: { kind: string; key: string; raceRouteSha256: string | null }[] };
    expect(manifest.items.find((item) => item.key === content)?.raceRouteSha256).toBe(ROUTE);

    const exported = (await (
      await authorised(instance, ada.token, 'GET', '/v1/account/export')
    ).json()) as { activities: { raceRouteSha256: string | null }[] };
    expect(exported.activities.map((activity) => activity.raceRouteSha256)).toStrictEqual([ROUTE]);

    const fresh = await openSqlStore(instance.path);
    try {
      expect(
        (await fresh.listRaceableOnRoute('somebody-else', ROUTE, 10)).map((row) => row.athleteId),
      ).toStrictEqual([ada.athleteId]);
    } finally {
      await fresh.close();
    }
  });
});

describe('the speed a ghost is sent as', () => {
  const sample = (t: number, speed: number | null) => ({
    t,
    speed,
    power: null,
    heartRate: null,
    cadence: null,
    altitude: null,
    distance: null,
  });

  it('is put on a whole-second clock, with a slot the file has no speed for left empty', () => {
    expect(
      ghostSpeed([sample(0, 5), sample(1, 6.004), sample(2, null), sample(4, 7)]),
    ).toStrictEqual({ sampleInterval: 1, speed: [5, 6, null, null, 7] });
  });

  it('is coarsened to whole seconds for a ride longer than the slots allow', () => {
    const long = Array.from({ length: 4 * MAXIMUM_GHOST_SLOTS }, (_, t) => sample(t, 8));
    const sent = ghostSpeed(long);
    expect(sent?.sampleInterval).toBe(5);
    expect(sent?.speed.length).toBeLessThanOrEqual(MAXIMUM_GHOST_SLOTS);
    expect(sent?.speed.every((value) => value === 8)).toBe(true);
  });

  it('is nothing for a ride with no speed, or with no time', () => {
    expect(ghostSpeed([sample(0, null), sample(1, null)])).toBeUndefined();
    expect(ghostSpeed([sample(0, 5)])).toBeUndefined();
  });

  it('is nothing to serve for a ride whose file holds no speed at all', async () => {
    const { instance, all } = await riders('Ada', 'Bea');
    const [ada, bea] = all as [Rider, Rider];
    const answer = await authorised(
      instance,
      bea.token,
      'POST',
      '/v1/sync/records',
      await uploadBody(bea.device, longGpx(30)),
    );
    const { contentSha256 } = (await answer.json()) as { contentSha256: string };
    await consent(instance, bea, contentSha256, true);
    await offer(instance, bea, contentSha256, ROUTE);

    expect(await ghostFor(instance, ada)).toBeNull();
  });
});
