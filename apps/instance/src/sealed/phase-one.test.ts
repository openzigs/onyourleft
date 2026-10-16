// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Phases 1 and 2 of ADR 0047, held route by route (#1192, #1210): the route
 * table IS D-7's two lists, no sealed route keeps a plaintext twin, every key
 * signs in and registers only sealed, and a rider's — or a moderator's —
 * bearer token alone opens none of them. An instance with no keys has no
 * sealed routes at all.
 *
 * "Runs nothing" is read back, not inferred: every table of the database is
 * read before and after each refused request, through a connection the
 * instance never used, and must be byte-for-byte the same — and the four
 * effects #1192 names (a link code, a revoked key, a moderation action, a
 * sync item) are each counted on their own as well.
 */

import { TEST_STATEMENT } from '../moderation/moderation-testing.ts';
import { LINK_PURPOSE, RECOVER_PURPOSE } from '@onyourleft/domain';
import { afterEach, describe, expect, it } from 'vitest';

import { testDevice, type IdentityInstance, type TestDevice } from '../auth/identity-testing.ts';
import {
  startModerationWorld,
  type ModerationWorld,
  type Rider,
} from '../moderation/moderation-testing.ts';
import type { Route } from '../route-kit.ts';
import { ROUTES } from '../routes.ts';
import { openDatabase } from '../store/node-sqlite.ts';
import { corpusFile, uploadBody } from '../sync/sync-testing.ts';
import { PHASE_ONE_SEALED_ROUTES, SEALED_FAMILIES, type PhaseOneRoute } from './phase-one.ts';
import { PHASE_TWO_SEALED_ROUTES } from './phase-two.ts';
import { sealedCall, codeOf as sealedCodeOf } from './sealed-testing.ts';

/**
 * Both committed lists (#1192, #1210): the table is held to their union, and
 * every test below that walks "the sealed routes" walks phase 2's as well.
 */
const SEALED_LISTS: readonly PhaseOneRoute[] = [
  ...PHASE_ONE_SEALED_ROUTES,
  ...PHASE_TWO_SEALED_ROUTES,
];

let world: IdentityInstance | undefined;
afterEach(async () => {
  await world?.close();
  world = undefined;
});

const key = (route: { method: string; path: string }): string => `${route.method} ${route.path}`;

/** Where the table and the committed list disagree; empty when they are one list. */
function listDisagreements(
  table: readonly Pick<Route, 'method' | 'path' | 'sealed' | 'reaches'>[],
  list: readonly PhaseOneRoute[],
): string[] {
  const marked = new Map(
    table.filter((route) => route.sealed !== undefined).map((route) => [key(route), route.sealed]),
  );
  const listed = new Map(list.map((route) => [key(route), route.mark]));
  const problems: string[] = [];
  for (const [name, mark] of listed) {
    if (marked.get(name) !== mark)
      problems.push(`${name}: D-7 lists it ${mark}, the table does not`);
  }
  for (const [name, mark] of marked) {
    if (listed.get(name) !== mark)
      problems.push(`${name}: marked ${String(mark)}, not on D-7's list`);
  }
  for (const route of table) {
    for (const family of SEALED_FAMILIES) {
      if (family.covers(route) && route.sealed !== 'only') {
        problems.push(`${key(route)}: "${family.row}" is sealed-only, and this route is not`);
      }
    }
  }
  return problems.sort();
}

describe('the route table is the list (#1192, ADR 0047 D-7)', () => {
  it('marks exactly the routes D-7 lists, each the way it lists it', () => {
    expect(listDisagreements(ROUTES, SEALED_LISTS)).toEqual([]);
    // Every listed route exists: a typo in the list would otherwise be a route nobody serves.
    for (const listed of SEALED_LISTS) {
      expect(
        ROUTES.some((route) => key(route) === key(listed)),
        key(listed),
      ).toBe(true);
    }
  });

  it('the comparison goes red both ways — the control', () => {
    const unmarked = ROUTES.map((route) =>
      route.path === '/v1/moderation/log' ? { ...route, sealed: undefined } : route,
    );
    expect(listDisagreements(unmarked, SEALED_LISTS)).toEqual([
      'GET /v1/moderation/log: "Every moderator route" is sealed-only, and this route is not',
      'GET /v1/moderation/log: D-7 lists it only, the table does not',
    ]);
    const extra = ROUTES.map((route) =>
      route.path === '/v1/auth/challenge' ? { ...route, sealed: 'only' as const } : route,
    );
    expect(listDisagreements(extra, SEALED_LISTS)).toEqual([
      "POST /v1/auth/challenge: marked only, not on D-7's list",
    ]);
    // Phase 2's list is held as phase 1's is (#1210): a route on it left
    // unmarked is red, and so is one marked and left off it.
    const phaseTwoUnmarked = ROUTES.map((route) =>
      route.path === '/v1/auth/session' && route.method === 'GET'
        ? { ...route, sealed: undefined }
        : route,
    );
    expect(listDisagreements(phaseTwoUnmarked, SEALED_LISTS)).toEqual([
      'GET /v1/auth/session: D-7 lists it only, the table does not',
    ]);
    expect(
      listDisagreements(
        ROUTES,
        SEALED_LISTS.filter((route) => route.path !== '/v1/rooms/{roomId}/ticket'),
      ),
    ).toEqual(["POST /v1/rooms/{roomId}/ticket: marked only, not on D-7's list"]);
    // A route `sync/routes.ts` declares, unmarked AND unlisted, is still caught by
    // its family — even under `/v1/account`, outside `/v1/sync/` and
    // `/v1/activities`, which a path-prefix rule let escape (#1211's review).
    const accountUnmarked = ROUTES.map((route) =>
      route.method === 'DELETE' && route.path === '/v1/account'
        ? { ...route, sealed: undefined }
        : route,
    );
    const accountUnlisted = SEALED_LISTS.filter(
      (route) => !(route.method === 'DELETE' && route.path === '/v1/account'),
    );
    expect(listDisagreements(accountUnmarked, accountUnlisted)).toEqual([
      'DELETE /v1/account: "The synced history" is sealed-only, and this route is not',
    ]);
  });
});

/** Every row of every table, read on a connection the instance never used. */
function everyRow(path: string): string {
  const database = openDatabase(path);
  try {
    const tables = (
      database
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as { name: string }[]
    ).map((row) => row.name);
    return JSON.stringify(
      tables.map((table) => [table, database.prepare(`SELECT * FROM "${table}"`).all()]),
      (_, value: unknown) =>
        value instanceof Uint8Array ? Buffer.from(value).toString('hex') : value,
    );
  } finally {
    database.close();
  }
}

/** The four effects #1192 names, counted on their own. */
function namedEffects(path: string, keyOf: string) {
  const database = openDatabase(path);
  try {
    const count = (sql: string, ...values: string[]): number =>
      (database.prepare(sql).get(...values) as { n: number }).n;
    return {
      linkCodes: count('SELECT count(*) AS n FROM link_code'),
      revoked: count(
        'SELECT count(*) AS n FROM device_key WHERE public_key = ? AND revoked_at IS NOT NULL',
        keyOf,
      ),
      moderationActions: count('SELECT count(*) AS n FROM moderation_log'),
      syncItems: count('SELECT count(*) AS n FROM sync_item'),
    };
  } finally {
    database.close();
  }
}

interface Fixture {
  readonly w: ModerationWorld;
  readonly bea: Rider;
  readonly second: TestDevice;
  readonly carl: Rider;
  readonly content: string;
  readonly reportId: number;
}

/** A moderator (the owner), Bea with a ride, a note and a second device, and a report about Carl. */
async function fixture(): Promise<Fixture> {
  const w = await startModerationWorld({ bodyLimitBytes: 256 * 1024 });
  world = w;
  const bea = await w.rider('Bea');
  const carl = await w.rider('Carl');
  const ride = await w.call('POST', '/v1/sync/records', {
    token: bea.token,
    body: await uploadBody(bea.device, corpusFile('nominal-ride.gpx')),
  });
  expect(ride.status, JSON.stringify(ride.body)).toBe(200);
  const content = (ride.body as { contentSha256: string }).contentSha256;
  expect(
    (await w.call('POST', '/v1/sync/items/note/n1', { token: bea.token, body: { body: 'a note' } }))
      .status,
  ).toBe(200);
  const second = await testDevice();
  const code = await w.call('POST', '/v1/auth/link-codes', { token: bea.token, body: {} });
  w.clock.ms += 60_000;
  const linked = await w.call('POST', '/v1/auth/link', {
    body: {
      ...(await second.statement(await w.nonceFor(second), { purpose: LINK_PURPOSE })),
      linkCode: (code.body as { linkCode: string }).linkCode,
    },
  });
  expect(linked.status, JSON.stringify(linked.body)).toBe(200);
  await w.call('POST', '/v1/reports', {
    token: bea.token,
    body: { athleteId: carl.athleteId, reason: 'Abusive display name' },
  });
  const queue = await w.call('GET', '/v1/moderation/reports', { token: w.owner.token });
  const reportId = (queue.body as { reports: { reportId: number }[] }).reports[0]?.reportId ?? 0;
  await w.history.idle();
  return { w, bea, second, carl, content, reportId };
}

/** A path with its `{name}` segments filled from the fixture, and a body that would DO something. */
function requestFor(route: PhaseOneRoute, f: Fixture): { path: string; body?: unknown } {
  const path = route.path
    .replace('{athleteId}', f.carl.athleteId)
    .replace('{reportId}', String(f.reportId))
    .replace('{appealId}', '1')
    .replace('{noticeId}', '1')
    .replace('{publicKey}', f.second.publicKey)
    .replace('{content}', f.content)
    .replace('{kind}', 'note')
    .replace('{key}', 'n1')
    .replace('{jobId}', 'job-1')
    .replace('{route}', 'a'.repeat(64))
    .replace('{roomId}', 'room-1');
  const reason = { reason: 'Checked against the rules' };
  const bodies: Record<string, unknown> = {
    'POST /v1/auth/link-codes': {},
    'POST /v1/auth/recovery-email': { address: 'bea@example.org' },
    'POST /v1/auth/devices/{publicKey}/revoke': {},
    'DELETE /v1/account': { recoveryCode: 'not-needed-to-be-refused' },
    'POST /v1/sync/items/{kind}/{key}': { body: 'an edge’s note' },
    'POST /v1/sync/records/{content}/race-consent': { mayBeRaced: true },
    'POST /v1/sync/records/{content}/race-route': { routeSha256: 'a'.repeat(64) },
    'POST /v1/history/search': { query: 'hills', limit: 6, characters: 4000 },
    'POST /v1/moderation/invites': reason,
    'POST /v1/analysis/jobs': { input: {}, templateVersion: '1', source: 'instance-local' },
    'POST /v1/analysis/replans': {
      input: {},
      templateVersion: 're-plan-1',
      source: 'instance-local',
    },
    // Phase 2 (#1210): each a body that would change something.
    'POST /v1/auth/display-name': { displayName: 'Edge' },
    'POST /v1/auth/adult': { confirmed: true },
    'POST /v1/reports': { athleteId: f.carl.athleteId, reason: 'An edge’s report' },
    'POST /v1/rooms/join': { code: 'abcd-efgh' },
    'POST /v1/rooms/{roomId}/ticket': { declaredMassKilograms: 70 },
  };
  const body =
    bodies[key(route)] ?? (route.path.startsWith('/v1/moderation/') ? reason : undefined);
  return { path, ...(route.method === 'GET' || body === undefined ? {} : { body }) };
}

describe('no plaintext twin (#1192, ADR 0047 D-7)', () => {
  it('refuses every sealed-only route in plaintext, `sealed_required`, and runs nothing', async () => {
    const f = await fixture();
    const before = everyRow(f.w.path);
    const effects = namedEffects(f.w.path, f.second.publicKey);
    expect(effects.revoked).toBe(0);
    // The owner is a rider AND a moderator, so the token is good for every route here.
    for (const route of SEALED_LISTS.filter((each) => each.mark === 'only')) {
      const { path, body } = requestFor(route, f);
      const answer = await f.w.call(route.method, path, {
        token: route.path.startsWith('/v1/moderation/') ? f.w.owner.token : f.bea.token,
        plain: true,
        ...(body === undefined ? {} : { body }),
      });
      expect(answer.status, key(route)).toBe(403);
      expect((answer.body as { error: { code: string } }).error.code, key(route)).toBe(
        'sealed_required',
      );
      expect(namedEffects(f.w.path, f.second.publicKey), key(route)).toEqual(effects);
      expect(everyRow(f.w.path) === before, key(route)).toBe(true);
    }
  });

  it('runs the same requests sealed — the control: they DO change something', async () => {
    const f = await fixture();
    const effects = namedEffects(f.w.path, f.second.publicKey);
    expect(
      (await f.w.call('POST', '/v1/auth/link-codes', { token: f.bea.token, body: {} })).status,
    ).toBe(200);
    expect(
      (
        await f.w.call('POST', `/v1/auth/devices/${f.second.publicKey}/revoke`, {
          token: f.bea.token,
          body: {},
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await f.w.call('POST', `/v1/moderation/athletes/${f.carl.athleteId}/suspend`, {
          token: f.w.owner.token,
          body: { reason: 'Checked against the rules', statement: TEST_STATEMENT },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await f.w.call('POST', '/v1/sync/items/note/n2', {
          token: f.bea.token,
          body: { body: 'another note' },
        })
      ).status,
    ).toBe(200);
    expect(namedEffects(f.w.path, f.second.publicKey)).toEqual({
      linkCodes: effects.linkCodes + 1,
      revoked: 1,
      moderationActions: effects.moderationActions + 1,
      syncItems: effects.syncItems + 1,
    });
  });

  it('gives the typed workout goals (#1237) no plaintext route: sealed or nothing', async () => {
    const f = await fixture();
    const path = '/v1/sync/items/workout-goal/goals';
    const body = { body: JSON.stringify({ powerCeiling: 0.7 }) };
    const before = everyRow(f.w.path);
    for (const [method, request] of [
      ['POST', { body }],
      ['GET', {}],
      ['DELETE', {}],
    ] as const) {
      const answer = await f.w.call(method, path, { token: f.bea.token, plain: true, ...request });
      expect(answer.status, method).toBe(403);
      expect((answer.body as { error: { code: string } }).error.code, method).toBe(
        'sealed_required',
      );
    }
    expect(everyRow(f.w.path) === before).toBe(true);
    // The control: the same put, sealed, is stored and read back.
    expect((await f.w.call('POST', path, { token: f.bea.token, body })).status).toBe(200);
    const read = await f.w.call('GET', path, { token: f.bea.token });
    expect(read.status).toBe(200);
    expect((read.body as { body: string }).body).toBe(body.body);
  });
});

describe('registration (#1192, ADR 0047 D-7)', () => {
  const athletes = (path: string): number => {
    const database = openDatabase(path);
    try {
      return (database.prepare('SELECT count(*) AS n FROM athlete').get() as { n: number }).n;
    } finally {
      database.close();
    }
  };

  it('refuses a new key in plaintext, `sealed_required`, and creates no athlete', async () => {
    const w = await startModerationWorld();
    world = w;
    const before = everyRow(w.path);
    const count = athletes(w.path);
    const device = await testDevice();
    const plain = await w.call('POST', '/v1/auth/session', {
      body: await device.statement(await w.nonceFor(device)),
      plain: true,
    });
    expect(plain.status).toBe(403);
    expect((plain.body as { error: { code: string } }).error.code).toBe('sealed_required');
    expect(athletes(w.path)).toBe(count);
    expect(await w.freshRead((store) => store.findDeviceKey(device.publicKey))).toBeUndefined();
    // The challenge it asked for is new; nothing else was written.
    const after = JSON.parse(everyRow(w.path)) as [string, unknown[]][];
    const was = JSON.parse(before) as [string, unknown[]][];
    expect(after.filter(([table]) => table !== 'auth_challenge')).toEqual(
      was.filter(([table]) => table !== 'auth_challenge'),
    );
  });

  it('registers the same key sealed, with the recovery codes only inside the sealed reply', async () => {
    const w = await startModerationWorld();
    world = w;
    const device = await testDevice();
    const answer = await sealedCall(w, {
      method: 'POST',
      path: '/v1/auth/session',
      body: await device.statement(await w.nonceFor(device)),
      signer: device.signingKey,
    });
    expect(answer.reply?.status).toBe(200);
    const body = answer.body as { registered: boolean; recoveryCodes: string[] };
    expect(body.registered).toBe(true);
    expect(body.recoveryCodes.length).toBeGreaterThan(0);
    for (const code of body.recoveryCodes) expect(answer.raw).not.toContain(code);
  });

  it('refuses a key it holds in plaintext too, `sealed_required`, and opens no session (#1210)', async () => {
    const w = await startModerationWorld();
    world = w;
    w.clock.ms += 60_000;
    const statement = await w.owner.device.statement(await w.nonceFor(w.owner.device));
    const before = everyRow(w.path);
    const plain = await w.call('POST', '/v1/auth/session', { body: statement, plain: true });
    expect(plain.status).toBe(403);
    expect((plain.body as { error: { code: string } }).error.code).toBe('sealed_required');
    expect(plain.body).not.toHaveProperty('sessionToken');
    // Refused before the body is read: not even the challenge is spent.
    expect(everyRow(w.path) === before).toBe(true);
    // The control: the same statement, sealed and signed by the key it names, signs in.
    const sealed = await sealedCall(w, {
      method: 'POST',
      path: '/v1/auth/session',
      body: statement,
      signer: w.owner.device.signingKey,
    });
    expect(sealed.reply?.status).toBe(200);
    const body = sealed.body as { registered: boolean; sessionToken: string };
    expect(body.registered).toBe(false);
    expect(body).not.toHaveProperty('recoveryCodes');
    // The token is only inside the sealed reply.
    expect(sealed.raw).not.toContain(body.sessionToken);
  });
});

describe('the edge’s token opens nothing (#1192, ADR 0047 D-8)', () => {
  /** A route as the edge would try it: with the token, sealed under the edge's own key. */
  const asTheEdge = async (
    f: Fixture,
    edge: TestDevice,
    token: string,
    method: string,
    path: string,
    body?: unknown,
  ) => {
    const sealed = await sealedCall(f.w, {
      method,
      path,
      token,
      signer: edge.signingKey,
      ...(body === undefined ? {} : { body }),
    });
    const plain = await f.w.call(method, path, {
      token,
      plain: true,
      ...(body === undefined ? {} : { body }),
    });
    return {
      sealed: sealedCodeOf(sealed),
      plain: (plain.body as { error?: { code?: string } }).error?.code,
    };
  };

  it('holding only a rider’s token, cannot read, mint, add, recover, revoke, rebind or delete', async () => {
    const f = await fixture();
    const edge = await testDevice();
    const before = everyRow(f.w.path);
    const recovery = await edge.statement(await f.w.nonceFor(edge), { purpose: RECOVER_PURPOSE });
    const link = await edge.statement(await f.w.nonceFor(edge), { purpose: LINK_PURPOSE });
    const attempts: [string, string, unknown?][] = [
      ['GET', '/v1/account/export'],
      ['GET', '/v1/sync/manifest'],
      ['GET', '/v1/sync/items/note/n1'],
      ['GET', `/v1/sync/files/${f.content}`],
      ['GET', '/v1/activities'],
      ['POST', '/v1/history/search', { query: 'hills', limit: 6, characters: 4000 }],
      ['POST', '/v1/auth/link-codes', {}],
      ['POST', '/v1/auth/link', { ...link, linkCode: 'abcd-efgh-jkmn-pqrs' }],
      ['POST', '/v1/auth/recover', { ...recovery, recoveryCode: 'not-a-code' }],
      ['POST', `/v1/auth/devices/${f.second.publicKey}/revoke`, {}],
      ['POST', '/v1/auth/recovery-email', { address: 'edge@example.org' }],
      ['DELETE', '/v1/account', { recoveryCode: 'not-a-code' }],
    ];
    for (const [method, path, body] of attempts) {
      const tried = await asTheEdge(f, edge, f.bea.token, method, path, body);
      expect(tried, `${method} ${path}`).toEqual({
        sealed: 'bad_signature',
        plain: 'sealed_required',
      });
    }
    // The challenges the edge asked for are its own; nothing else moved.
    const without = (rows: string) =>
      (JSON.parse(rows) as [string, unknown[]][]).filter(
        ([table]) => table !== 'auth_challenge' && table !== 'sealed_replay',
      );
    expect(without(everyRow(f.w.path))).toEqual(without(before));
  });

  it('holding only a rider’s token, opens no phase-2 route: not the account, a block, a room or the session (#1210)', async () => {
    const f = await fixture();
    const edge = await testDevice();
    const before = everyRow(f.w.path);
    expect(PHASE_TWO_SEALED_ROUTES.length).toBe(18);
    for (const route of PHASE_TWO_SEALED_ROUTES) {
      const { path, body } = requestFor(route, f);
      const tried = await asTheEdge(f, edge, f.bea.token, route.method, path, body);
      expect(tried, key(route)).toEqual({ sealed: 'bad_signature', plain: 'sealed_required' });
    }
    // Nothing moved: no name, block, report, room or ended session; only the
    // replay record of the edge's own envelopes.
    const without = (rows: string) =>
      (JSON.parse(rows) as [string, unknown[]][]).filter(([table]) => table !== 'sealed_replay');
    expect(without(everyRow(f.w.path))).toEqual(without(before));
    // The control: Bea's own device, sealed and signed, does what the edge could not.
    const renamed = await f.w.call('POST', '/v1/auth/display-name', {
      token: f.bea.token,
      body: { displayName: 'Bea B' },
    });
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
    expect((await f.w.freshRead((store) => store.getAthlete(f.bea.athleteId)))?.displayName).toBe(
      'Bea B',
    );
    expect((await f.w.call('DELETE', '/v1/auth/session', { token: f.bea.token })).status).toBe(204);
    expect((await f.w.call('GET', '/v1/auth/session', { token: f.bea.token })).status).toBe(401);
  });

  it('holding only a moderator’s token, cannot suspend, approve or read the queues', async () => {
    const f = await fixture();
    const edge = await testDevice();
    const before = namedEffects(f.w.path, f.second.publicKey);
    const reason = { reason: 'Checked against the rules' };
    const attempts: [string, string, unknown?][] = [
      ['POST', `/v1/moderation/athletes/${f.carl.athleteId}/suspend`, reason],
      ['POST', `/v1/moderation/registrations/${f.carl.athleteId}/approve`, reason],
      ['POST', '/v1/moderation/invites', reason],
      ['GET', '/v1/moderation/reports'],
      ['GET', '/v1/moderation/registrations'],
      ['GET', '/v1/moderation/suspended'],
      ['GET', '/v1/moderation/log'],
    ];
    for (const [method, path, body] of attempts) {
      const tried = await asTheEdge(f, edge, f.w.owner.token, method, path, body);
      expect(tried, `${method} ${path}`).toEqual({
        sealed: 'bad_signature',
        plain: 'sealed_required',
      });
    }
    expect(namedEffects(f.w.path, f.second.publicKey)).toEqual(before);
    expect(
      await f.w.freshRead(async (store) => (await store.getAthlete(f.carl.athleteId))?.suspendedAt),
    ).toBeNull();
  });
});

describe('an instance with no keys has no sealed routes (#1192, ADR 0047 D-7)', () => {
  it('registers, lists devices and mints a link code in plaintext, as before', async () => {
    const w = await startModerationWorld({ keyless: true });
    world = w;
    expect(w.instanceKeys.configured).toBe(false);
    const device = await testDevice();
    const registered = await w.call('POST', '/v1/auth/session', {
      body: await device.statement(await w.nonceFor(device)),
      plain: true,
    });
    expect(registered.status, JSON.stringify(registered.body)).toBe(200);
    const token = (registered.body as { sessionToken: string }).sessionToken;
    expect((await w.call('GET', '/v1/auth/devices', { token, plain: true })).status).toBe(200);
    expect(
      (await w.call('POST', '/v1/auth/link-codes', { token, plain: true, body: {} })).status,
    ).toBe(200);
  });
});
