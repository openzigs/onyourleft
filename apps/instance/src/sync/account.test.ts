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

import { AUTH_PURPOSE, ERASE_ACCOUNT_PURPOSE, LINK_PURPOSE, toHex } from '@onyourleft/domain';
import { decodeFitActivity, decodeGpx, decodeTcx, trackPointsOf } from '@onyourleft/fit';
import { afterEach, describe, expect, it } from 'vitest';

import { testDevice, type IdentityInstance, type TestDevice } from '../auth/identity-testing.ts';
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

/** The step-up deleting an account needs (#898): one of the rider's recovery codes. */
const stepUp = (rider: Rider): { recoveryCode: string } => ({
  recoveryCode: rider.recoveryCodes[0] as string,
});

const FILES = ['nominal-outdoor-ride.fit', 'nominal-ride.gpx', 'nominal-ride.tcx'] as const;

async function readJson<T>(response: Response): Promise<T> {
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as T;
}

/**
 * A second device of `rider`'s, linked with a code the rider minted, and then
 * REVOKED from the rider's own session — a lost phone, say (#926's review).
 */
async function revokedSecondDevice(instance: IdentityInstance, rider: Rider): Promise<TestDevice> {
  const lost = await testDevice();
  const code = await instance.call('POST', '/v1/auth/link-codes', { token: rider.token });
  const linked = await instance.call('POST', '/v1/auth/link', {
    body: {
      ...(await lost.statement(await instance.nonceFor(lost), { purpose: LINK_PURPOSE })),
      linkCode: (code.body as { linkCode: string }).linkCode,
    },
  });
  expect(linked.status, JSON.stringify(linked.body)).toBe(200);
  const revoked = await instance.call('POST', `/v1/auth/devices/${lost.publicKey}/revoke`, {
    token: rider.token,
    body: {},
  });
  expect(revoked.status, JSON.stringify(revoked.body)).toBe(204);
  return lost;
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

  it('exports the blocks and the reports the athlete made (#83), and not how a report was decided', async () => {
    const setup = await syncWorld(2);
    world = setup.world;
    const [anna, ben] = setup.riders;
    const nobody = 'f'.repeat(32);
    expect((await authorised(world, anna!.token, 'POST', `/v1/blocks/${nobody}`)).status).toBe(204);
    expect(
      (
        await authorised(world, anna!.token, 'POST', '/v1/reports', {
          athleteId: ben!.athleteId,
          reason: 'Abusive display name',
        })
      ).status,
    ).toBe(204);

    const exported: AccountExport = await readJson(
      await authorised(world, anna!.token, 'GET', '/v1/account/export'),
    );
    expect(exported.blocks.map(({ createdAt, ...rest }) => [typeof createdAt, rest])).toEqual([
      ['number', { blockedAthleteId: nobody }],
    ]);
    expect(exported.reports.map(({ createdAt, ...rest }) => [typeof createdAt, rest])).toEqual([
      ['number', { targetAthleteId: ben!.athleteId, reason: 'Abusive display name' }],
    ]);
    expect(exported.athlete).toMatchObject({ suspendedAt: null, displayNameHiddenAt: null });
    expect(typeof exported.athlete.activatedAt, 'activatedAt, #893 review F4').toBe('number');
    // Ben's own export says nothing of the report about him: it is Anna's.
    const bens: AccountExport = await readJson(
      await authorised(world, ben!.token, 'GET', '/v1/account/export'),
    );
    expect(bens.reports).toEqual([]);
    expect(JSON.stringify(bens)).not.toContain(anna!.athleteId);
  });

  it('exports a report about an id nobody holds exactly as one about a rider (#893 review F1)', async () => {
    const setup = await syncWorld(2);
    world = setup.world;
    const [anna, ben] = setup.riders;
    const nobody = 'f'.repeat(32);
    for (const target of [ben!.athleteId, nobody]) {
      const answer = await authorised(world, anna!.token, 'POST', '/v1/reports', {
        athleteId: target,
        reason: 'Abusive display name',
      });
      expect(answer.status).toBe(204);
    }
    // The control: the instance DID store the two differently.
    const stored = await world.freshRead((store) => store.listReports(anna!.athleteId));
    expect(new Set(stored.map((report) => report.outcome)).size).toBe(2);

    const exported: AccountExport = await readJson(
      await authorised(world, anna!.token, 'GET', '/v1/account/export'),
    );
    const byTarget = new Map(
      exported.reports.map(({ targetAthleteId, ...rest }) => [targetAthleteId, rest]),
    );
    expect([...byTarget.keys()].sort()).toEqual([ben!.athleteId, nobody].sort());
    expect(byTarget.get(nobody)).toEqual(byTarget.get(ben!.athleteId));
  });

  it('exports a recovery address waiting to be confirmed, and never its token (#893 review F2)', async () => {
    const setup = await syncWorld(1, { emailRecovery: true });
    world = setup.world;
    const [anna] = setup.riders;
    const address = 'waiting@example.org';
    expect(
      (await authorised(world, anna!.token, 'POST', '/v1/auth/recovery-email', { address })).status,
    ).toBeLessThan(300);
    const text = await (await authorised(world, anna!.token, 'GET', '/v1/account/export')).text();
    const exported = JSON.parse(text) as AccountExport;
    expect(exported.recoveryEmail).toBeNull();
    expect(exported.recoveryEmailConfirmations.map((each) => [each.address, each.usedAt])).toEqual([
      [address, null],
    ]);
    const tokens = await world.freshRead((store) => store.listEmailConfirmations(anna!.athleteId));
    expect(tokens.length).toBe(1);
    for (const token of tokens) expect(text).not.toContain(token.tokenSha256);
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

    const erased = await authorised(world, anna!.token, 'DELETE', '/v1/account', stepUp(anna!));
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

    expect(
      (await authorised(world, anna!.token, 'DELETE', '/v1/account', stepUp(anna!))).status,
    ).toBe(204);

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
    const answer = await authorised(world, rider!.token, 'DELETE', '/v1/account', stepUp(rider!));
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

describe('deleting an account needs a step-up beyond the session (#898)', () => {
  const erase = (instance: IdentityInstance, token: string, body?: unknown) =>
    authorised(instance, token, 'DELETE', '/v1/account', body);

  async function codeOf(response: Response): Promise<unknown> {
    return ((await response.json()) as { error?: { code?: unknown } }).error?.code;
  }

  /** A statement to erase the account, signed by `device` for a fresh nonce. */
  async function eraseStatement(instance: IdentityInstance, device: TestDevice, purpose?: string) {
    const signed = await device.statement(await instance.nonceFor(device), {
      purpose: purpose ?? ERASE_ACCOUNT_PURPOSE,
    });
    return { statement: signed };
  }

  it.each([
    ['nothing but the session', undefined, 'step_up_required', 403],
    ['an empty body', {}, 'step_up_required', 403],
    ['a code that is nobody’s', { recoveryCode: 'aaaa-bbbb-cccc-dddd' }, 'code_unknown', 401],
    ['a code that is not text', { recoveryCode: 7 }, 'validation_failed', 400],
  ])('refuses %s, and deletes nothing', async (_, body, code, status) => {
    const setup = await syncWorld(1);
    world = setup.world;
    const [anna] = setup.riders;
    await syncEverything(world, anna!);
    const before = athleteRows(world.path, anna!.athleteId);
    const answer = await erase(world, anna!.token, body);
    expect(answer.status).toBe(status);
    expect(await codeOf(answer)).toBe(code);
    expect(athleteRows(world.path, anna!.athleteId)).toEqual(before);
  });

  it('refuses another rider’s recovery code', async () => {
    const setup = await syncWorld(2);
    world = setup.world;
    const [anna, ben] = setup.riders;
    const answer = await erase(world, anna!.token, stepUp(ben!));
    expect(await codeOf(answer)).toBe('code_unknown');
    expect(athleteRows(world.path, anna!.athleteId).device_key).toBe(1);
  });

  it('accepts one of the rider’s own codes', async () => {
    const setup = await syncWorld(1);
    world = setup.world;
    const [anna] = setup.riders;
    expect((await erase(world, anna!.token, stepUp(anna!))).status).toBe(204);
    expect(await world.freshRead((store) => store.getAthlete(anna!.athleteId))).toBeUndefined();
  });

  it('accepts a fresh erase statement signed by one of the rider’s own keys', async () => {
    const setup = await syncWorld(1);
    world = setup.world;
    const [anna] = setup.riders;
    const answer = await erase(world, anna!.token, await eraseStatement(world, anna!.device));
    expect(answer.status, await answer.clone().text()).toBe(204);
    expect(await world.freshRead((store) => store.getAthlete(anna!.athleteId))).toBeUndefined();
  });

  it('refuses an erase statement signed by a key the rider revoked, and deletes nothing (#926’s review, B2)', async () => {
    const setup = await syncWorld(1);
    world = setup.world;
    const [anna] = setup.riders;
    // Keys A (Anna's device) and B (a phone she lost, revoked from A's session).
    const lost = await revokedSecondDevice(world, anna!);
    // Whoever holds B signs an erase statement, and it is sent in A's session.
    const answer = await erase(world, anna!.token, await eraseStatement(world, lost));
    expect(await codeOf(answer)).toBe('key_revoked');
    expect(await world.freshRead((store) => store.getAthlete(anna!.athleteId))).toBeDefined();
    // The control: the same session with A's own key erases.
    const own = await erase(world, anna!.token, await eraseStatement(world, anna!.device));
    expect(own.status, await own.clone().text()).toBe(204);
  });

  it('refuses a recovery code and a statement sent together, rather than ignoring one', async () => {
    const setup = await syncWorld(1);
    world = setup.world;
    const [anna] = setup.riders;
    const answer = await erase(world, anna!.token, {
      ...stepUp(anna!),
      ...(await eraseStatement(world, anna!.device)),
    });
    expect(answer.status).toBe(400);
    expect(await codeOf(answer)).toBe('validation_failed');
    expect(await world.freshRead((store) => store.getAthlete(anna!.athleteId))).toBeDefined();
  });

  it('refuses a signed-in statement, another rider’s key, and a spent nonce', async () => {
    const setup = await syncWorld(2);
    world = setup.world;
    const [anna, ben] = setup.riders;
    const signIn = await erase(
      world,
      anna!.token,
      await eraseStatement(world, anna!.device, AUTH_PURPOSE),
    );
    expect(await codeOf(signIn)).toBe('wrong_purpose');
    const bens = await erase(world, anna!.token, await eraseStatement(world, ben!.device));
    expect(await codeOf(bens)).toBe('step_up_required');
    const once = await eraseStatement(world, anna!.device);
    // Ben's session cannot spend Anna's statement to erase Ben, either.
    expect(await codeOf(await erase(world, ben!.token, once))).toBe('step_up_required');
    expect(await codeOf(await erase(world, anna!.token, once))).toBe('challenge_used');
    for (const rider of [anna!, ben!]) {
      expect(await world.freshRead((store) => store.getAthlete(rider.athleteId))).toBeDefined();
    }
  });
});

describe('a suspended rider may take their data out and delete their account, and nothing else (#898)', () => {
  async function suspendedWorld(before?: (rider: Rider) => Promise<void>) {
    const owner = await testDevice();
    const setup = await syncWorld(1, { moderators: { owner: owner.publicKey } });
    world = setup.world;
    const [bea] = setup.riders;
    await syncEverything(world, bea!);
    await before?.(bea!);
    world.clock.ms += 60_000;
    const ownerSession = await world.signIn(owner);
    const suspended = await world.call(
      'POST',
      `/v1/moderation/athletes/${bea!.athleteId}/suspend`,
      { token: ownerSession.body.sessionToken as string, body: { reason: 'Repeated abuse' } },
    );
    expect(suspended.status, JSON.stringify(suspended.body)).toBe(200);
    return { bea: bea!, instance: world };
  }

  async function leaveSession(instance: IdentityInstance, device: TestDevice) {
    return instance.call('POST', '/v1/auth/leave-session', {
      body: await device.statement(await instance.nonceFor(device)),
    });
  }

  const codeIn = (body: unknown): unknown =>
    (body as { error?: { code?: unknown } } | null)?.error?.code;

  it('opens a way-out session that exports and erases, keeping the moderation log', async () => {
    const { bea, instance } = await suspendedWorld();
    // Signing in is still refused, as before.
    const signIn = await instance.signIn(bea.device);
    expect(codeIn(signIn.body)).toBe('account_suspended');

    const opened = await leaveSession(instance, bea.device);
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    const token = (opened.body as { sessionToken: string }).sessionToken;
    expect((opened.body as { athleteId: string }).athleteId).toBe(bea.athleteId);

    const exported = await authorised(instance, token, 'GET', '/v1/account/export');
    expect(exported.status).toBe(200);
    const body = (await exported.json()) as AccountExport;
    expect(body.athlete.suspendedAt).not.toBeNull();
    expect(body.activities).toHaveLength(FILES.length);

    // Every other route: `account_suspended`. The full walk is choke-point.test.ts's.
    const manifest = await authorised(instance, token, 'GET', '/v1/sync/manifest');
    expect(manifest.status).toBe(403);

    const logBefore = await instance.freshRead((store) => store.listModerationLog());
    expect(logBefore.map((entry) => entry.targetAthleteId)).toContain(bea.athleteId);
    const erased = await authorised(instance, token, 'DELETE', '/v1/account', stepUp(bea));
    expect(erased.status, await erased.clone().text()).toBe(204);
    expect(await instance.freshRead((store) => store.getAthlete(bea.athleteId))).toBeUndefined();
    // The moderation log is the instance's audit trail and outlives the account.
    expect(await instance.freshRead((store) => store.listModerationLog())).toEqual(logBefore);
  });

  it('refuses a way-out session to a key nobody holds: it is a way out, not in', async () => {
    const { instance } = await suspendedWorld();
    const stranger = await testDevice();
    const opened = await leaveSession(instance, stranger);
    expect(opened.status).toBe(401);
    expect(codeIn(opened.body)).toBe('unauthenticated');
    expect(await instance.freshRead((store) => store.findDeviceKey(stranger.publicKey))).toBe(
      undefined,
    );
  });

  it('refuses a way-out session to a revoked key, and opens no session for it (#926’s review, N1)', async () => {
    let lost: TestDevice | undefined;
    const { bea, instance } = await suspendedWorld(async (rider) => {
      lost = await revokedSecondDevice(world!, rider);
    });
    const opened = await leaveSession(instance, lost!);
    expect(codeIn(opened.body)).toBe('key_revoked');
    const sessions = await instance.freshRead((store) => store.listSessions(bea.athleteId));
    // The link opened a full session for the lost key, revoked with it; no
    // way-out session was written for it.
    expect(sessions.filter((session) => session.scope === 'leave')).toEqual([]);
    // The control: Bea's own, live key opens one.
    expect((await leaveSession(instance, bea.device)).status).toBe(200);
  });

  it('still needs the step-up to erase from a way-out session', async () => {
    const { bea, instance } = await suspendedWorld();
    const opened = await leaveSession(instance, bea.device);
    const token = (opened.body as { sessionToken: string }).sessionToken;
    const erased = await authorised(instance, token, 'DELETE', '/v1/account');
    expect(erased.status).toBe(403);
    expect(await instance.freshRead((store) => store.getAthlete(bea.athleteId))).toBeDefined();
  });

  it('refuses a way-out session to an account that is not suspended — the control', async () => {
    const setup = await syncWorld(1);
    world = setup.world;
    const [anna] = setup.riders;
    const opened = await leaveSession(world, anna!.device);
    expect(opened.status).toBe(409);
    expect(codeIn(opened.body)).toBe('not_suspended');
  });

  it('ends the way-out session when the suspension is lifted: it is never a full session', async () => {
    const owner = await testDevice();
    const setup = await syncWorld(1, { moderators: { owner: owner.publicKey } });
    world = setup.world;
    const [bea] = setup.riders;
    world.clock.ms += 60_000;
    const ownerToken = (await world.signIn(owner)).body.sessionToken as string;
    const act = (action: string) =>
      world!.call('POST', `/v1/moderation/athletes/${bea!.athleteId}/${action}`, {
        token: ownerToken,
        body: { reason: 'Checked' },
      });
    expect((await act('suspend')).status).toBe(200);
    const opened = await leaveSession(world, bea!.device);
    const token = (opened.body as { sessionToken: string }).sessionToken;
    expect((await authorised(world, token, 'GET', '/v1/account/export')).status).toBe(200);
    expect((await act('unsuspend')).status).toBe(200);
    expect((await authorised(world, token, 'GET', '/v1/account/export')).status).toBe(401);
    expect((await authorised(world, token, 'GET', '/v1/sync/manifest')).status).toBe(401);
  });

  it('lasts an hour, not a month', async () => {
    const { bea, instance } = await suspendedWorld();
    const opened = await leaveSession(instance, bea.device);
    const { sessionToken, expiresAt } = opened.body as { sessionToken: string; expiresAt: number };
    expect(expiresAt - Math.floor(instance.clock.ms / 1000)).toBe(60 * 60);
    instance.clock.ms += 60 * 60 * 1000;
    expect((await authorised(instance, sessionToken, 'GET', '/v1/account/export')).status).toBe(
      401,
    );
  });
});
