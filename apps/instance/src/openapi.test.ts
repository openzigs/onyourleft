// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { errorBody, ERROR_CODES } from './errors.ts';
import { LINK_PURPOSE, RECOVER_PURPOSE } from '@onyourleft/domain';

import {
  startIdentityInstance,
  testDevice,
  type IdentityInstance,
  type TestDevice,
} from './auth/identity-testing.ts';
import { startTestInstance, type TestInstance } from './instance-testing.ts';
import { createInstanceKeys } from './keys/instance-keys.ts';
import { secretBytes } from './keys/instance-keys-testing.ts';
import { openSqlStore } from './store/open-sql-store.ts';
import { createStoreHarness, type StoreHarness } from './store/testing/index.ts';
import { SYNC_HAPPY_CALLS } from './sync/sync-testing.ts';
import { frames, openFrames, sealedCall, sealFor, sendEnvelope } from './sealed/sealed-testing.ts';
import { madeRoom, riderIn, roomBody } from './rooms/rooms-testing.ts';
import { jobBody } from './analysis/jobs-testing.ts';
import type { AnalysisEngine } from './analysis/jobs.ts';
import type { ScreenedWriteUp } from '@onyourleft/analysis';
import { openApiDocument, openApiText } from './openapi.ts';
import { assessReadiness } from './readiness.ts';
import { ROUTES, type Schema } from './routes.ts';

/**
 * The specification cannot drift from the implementation (#36): the committed
 * file is what the route table generates, and every route's body is what its
 * entry declares, read through the real listener.
 */

const COMMITTED = new URL('../openapi.json', import.meta.url);
const REGENERATE = 'pnpm --filter @onyourleft/instance run openapi:generate';

/** Problems with `value` against the subset of JSON Schema `routes.ts` allows. */
function violations(value: unknown, schema: Schema, at = '$'): string[] {
  if ('$ref' in schema) {
    const name = schema.$ref.replace('#/components/schemas/', '');
    const components = (openApiDocument(ROUTES).components as { schemas: Record<string, Schema> })
      .schemas;
    const target = components[name];
    return target === undefined
      ? [`${at}: unresolved ${schema.$ref}`]
      : violations(value, target, at);
  }
  if ('enum' in schema) {
    return typeof value === 'string' && schema.enum.includes(value) ? [] : [`${at}: not in enum`];
  }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const actual =
    value === null
      ? 'null'
      : Array.isArray(value)
        ? 'array'
        : Number.isInteger(value)
          ? 'integer'
          : typeof value;
  const accepted = actual === 'integer' && types.includes('number' as never) ? 'number' : actual;
  if (!types.includes(accepted as never)) return [`${at}: ${actual} is not ${types.join('|')}`];
  if (actual === 'string' && 'format' in schema && schema.format === 'uri') {
    return URL.canParse(value as string) ? [] : [`${at}: not a URI`];
  }
  if (schema.type === 'array') {
    return (value as unknown[]).flatMap((item, index) =>
      violations(item, schema.items, `${at}[${String(index)}]`),
    );
  }
  if (schema.type === 'object' && 'properties' in schema) {
    const record = value as Record<string, unknown>;
    const found: string[] = [];
    for (const key of schema.required) if (!(key in record)) found.push(`${at}.${key}: missing`);
    for (const [key, item] of Object.entries(record)) {
      const property = schema.properties[key];
      if (property === undefined) found.push(`${at}.${key}: not declared`);
      else found.push(...violations(item, property, `${at}.${key}`));
    }
    return found;
  }
  return [];
}

describe('the committed specification', () => {
  it(`is what the route table generates — if not, run \`${REGENERATE}\``, () => {
    expect(readFileSync(COMMITTED, 'utf8')).toBe(openApiText(ROUTES));
  });

  it('describes every route the handler dispatches on, and nothing else', () => {
    const paths = openApiDocument(ROUTES).paths as Record<string, Record<string, unknown>>;
    const described = Object.entries(paths).flatMap(([path, item]) =>
      Object.keys(item).map((method) => `${method.toUpperCase()} ${path}`),
    );
    expect(described.sort()).toEqual(ROUTES.map((route) => `${route.method} ${route.path}`).sort());
  });

  it('declares every error code, and the error schema accepts every error body', () => {
    const document = openApiDocument(ROUTES) as {
      components: { schemas: { Error: Schema }; responses: Record<string, unknown> };
    };
    expect(Object.keys(document.components.responses)).toEqual([...ERROR_CODES]);
    for (const code of ERROR_CODES) {
      const body = errorBody(code, [{ field: 'limit', problem: 'must be a whole number' }]);
      expect(violations(body, document.components.schemas.Error)).toEqual([]);
    }
  });
});

/**
 * How to call each identity route so that it SUCCEEDS, by operation id. A
 * route with no entry here fails the test below, so a new route cannot ship
 * without its success body being checked against its declared schema.
 */
type HappyCall = (world: IdentityInstance) => Promise<Response>;

async function signedIn(world: IdentityInstance): Promise<{ device: TestDevice; token: string }> {
  const device = await testDevice();
  const session = await world.signIn(device);
  return { device, token: session.body.sessionToken as string };
}

function send(
  world: IdentityInstance,
  method: string,
  path: string,
  token?: string,
  body?: unknown,
) {
  // A sealed route (#1192) is called sealed, and its INNER answer is what the
  // route's entry declares: `IdentityInstance.request` seals and opens it.
  return world.request(method, path, {
    ...(token === undefined ? {} : { token }),
    ...(body === undefined ? {} : { body }),
  });
}

/** The owner's device, named to the world as a moderator (#83). */
let moderator: TestDevice;

async function moderatorToken(world: IdentityInstance): Promise<string> {
  return (await world.signIn(moderator)).body.sessionToken as string;
}

/** Another rider, signed in: their id. */
async function anotherAthlete(world: IdentityInstance): Promise<string> {
  return (await world.signIn(await testDevice())).body.athleteId as string;
}

async function moderatorAction(world: IdentityInstance, path: string): Promise<Response> {
  const target = await anotherAthlete(world);
  return send(
    world,
    'POST',
    `/v1/moderation/athletes/${target}/${path}`,
    await moderatorToken(world),
    {
      reason: 'Checked against the rules',
    },
  );
}

/** A rider awaiting approval (#775), written beneath the routes: this world registers openly. */
async function pendingAthlete(world: IdentityInstance): Promise<string> {
  const device = await testDevice();
  const athleteId = `pending-${device.publicKey.slice(0, 16)}`;
  await world.freshRead((store) =>
    store.registerAthlete({
      athlete: {
        id: athleteId,
        displayName: 'Pending',
        createdAt: 1,
        registrationState: 'pending',
      },
      key: { publicKey: device.publicKey, athleteId, addedAt: 1, revokedAt: null },
      recoveryCodeSha256s: [],
    }),
  );
  return athleteId;
}

/**
 * A sealed-only route's call (#1191): sealed, signed by the session's key, and
 * the INNER answer handed back as a plain response, so its body is checked
 * against the route's own schema rather than the envelope's.
 */
async function sealedSend(
  world: IdentityInstance,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const { device, token } = await signedIn(world);
  const answer = await sealedCall(world, {
    method,
    path,
    token,
    signer: device.signingKey,
    ...(body === undefined ? {} : { body }),
  });
  if (answer.reply === undefined) throw new Error(`not sealed: ${answer.raw}`);
  return new Response(JSON.stringify(answer.body), {
    status: answer.reply.status,
    headers: { 'content-type': answer.reply.contentType },
  });
}

/** An engine that writes every ride up at once (#1095): the routes' shapes, not the agent's, are checked here. */
const INSTANT_ENGINE: AnalysisEngine = {
  run: (_job, _signal, emit) => {
    emit({ type: 'progress', step: 1 });
    return Promise.resolve({ kind: 'written', writeUp: 'A steady ride.' as ScreenedWriteUp });
  },
};

/** A rider with a job that has run to its end: their session and the job's id. */
async function finishedJob(
  world: IdentityInstance,
): Promise<{ device: TestDevice; token: string; jobId: string }> {
  const rider = await signedIn(world);
  const answer = await world.call('POST', '/v1/analysis/jobs', {
    token: rider.token,
    body: jobBody(),
  });
  await world.analysis?.idle();
  return { ...rider, jobId: (answer.body as { jobId: string }).jobId };
}

const HAPPY_CALLS: Readonly<Record<string, HappyCall>> = {
  startAnalysisJob: async (world) =>
    send(world, 'POST', '/v1/analysis/jobs', (await signedIn(world)).token, jobBody()),
  getAnalysisJob: async (world) => {
    const { token, jobId } = await finishedJob(world);
    return send(world, 'GET', `/v1/analysis/jobs/${jobId}`, token);
  },
  streamAnalysisJob: async (world) => {
    const { device, token, jobId } = await finishedJob(world);
    const sealed = await sealFor(world, {
      path: `/v1/analysis/jobs/${jobId}/events`,
      token,
      signer: device.signingKey,
    });
    const response = await sendEnvelope(world.url, sealed.envelope, token);
    const opened = await openFrames(sealed, frames(await response.text()));
    return new Response(opened.events.map((each) => each.kind).join('\n'), {
      status: response.status,
      headers: { 'content-type': response.headers.get('content-type') ?? '' },
    });
  },
  cancelAnalysisJob: async (world) => {
    const { token, jobId } = await finishedJob(world);
    return send(world, 'POST', `/v1/analysis/jobs/${jobId}/cancel`, token, {});
  },
  acknowledgeAnalysisJob: async (world) => {
    const { token, jobId } = await finishedJob(world);
    return send(world, 'POST', `/v1/analysis/jobs/${jobId}/ack`, token, {});
  },
  listAccountChanges: (world) => sealedSend(world, 'GET', '/v1/auth/account-changes'),
  acknowledgeAccountChanges: (world) =>
    sealedSend(world, 'POST', '/v1/auth/account-changes/acknowledge', { through: 0 }),
  getAccount: async (world) =>
    send(world, 'GET', '/v1/auth/account', (await signedIn(world)).token),
  confirmAdult: async (world) =>
    send(world, 'POST', '/v1/auth/adult', (await signedIn(world)).token, { confirmed: true }),
  listPendingRegistrations: async (world) => {
    await pendingAthlete(world);
    return send(world, 'GET', '/v1/moderation/registrations', await moderatorToken(world));
  },
  approveRegistration: async (world) =>
    send(
      world,
      'POST',
      `/v1/moderation/registrations/${await pendingAthlete(world)}/approve`,
      await moderatorToken(world),
      { reason: 'Known to the club' },
    ),
  refuseRegistration: async (world) =>
    send(
      world,
      'POST',
      `/v1/moderation/registrations/${await pendingAthlete(world)}/refuse`,
      await moderatorToken(world),
      { reason: 'Spam account' },
    ),
  createInvite: async (world) =>
    send(world, 'POST', '/v1/moderation/invites', await moderatorToken(world), {
      reason: 'For the Tuesday group',
    }),
  listBlocks: async (world) => send(world, 'GET', '/v1/blocks', (await signedIn(world)).token),
  blockAthlete: async (world) =>
    send(world, 'POST', `/v1/blocks/${await anotherAthlete(world)}`, (await signedIn(world)).token),
  unblockAthlete: async (world) =>
    send(
      world,
      'DELETE',
      `/v1/blocks/${await anotherAthlete(world)}`,
      (await signedIn(world)).token,
    ),
  reportAthlete: async (world) =>
    send(world, 'POST', '/v1/reports', (await signedIn(world)).token, {
      athleteId: await anotherAthlete(world),
      reason: 'Abusive display name',
    }),
  listOpenReports: async (world) =>
    send(world, 'GET', '/v1/moderation/reports', await moderatorToken(world)),
  dismissReport: async (world) => {
    const target = await anotherAthlete(world);
    await send(world, 'POST', '/v1/reports', (await signedIn(world)).token, {
      athleteId: target,
      reason: 'Abusive display name',
    });
    const token = await moderatorToken(world);
    const queue = (await (await send(world, 'GET', '/v1/moderation/reports', token)).json()) as {
      reports: { reportId: number; targetAthleteId: string }[];
    };
    const report = queue.reports.find((each) => each.targetAthleteId === target);
    return send(
      world,
      'POST',
      `/v1/moderation/reports/${String(report?.reportId)}/dismiss`,
      token,
      {
        reason: 'Not against the rules',
      },
    );
  },
  suspendAthlete: (world) => moderatorAction(world, 'suspend'),
  unsuspendAthlete: async (world) => {
    const target = await anotherAthlete(world);
    const token = await moderatorToken(world);
    await send(world, 'POST', `/v1/moderation/athletes/${target}/suspend`, token, {
      reason: 'Cheating',
    });
    return send(world, 'POST', `/v1/moderation/athletes/${target}/unsuspend`, token, {
      reason: 'Appeal upheld',
    });
  },
  hideDisplayName: (world) => moderatorAction(world, 'hide-display-name'),
  listSuspendedAthletes: async (world) => {
    const target = await anotherAthlete(world);
    const token = await moderatorToken(world);
    await send(world, 'POST', `/v1/moderation/athletes/${target}/suspend`, token, {
      reason: 'Cheating',
    });
    return send(world, 'GET', '/v1/moderation/suspended', token);
  },
  getModerationLog: async (world) =>
    send(world, 'GET', '/v1/moderation/log', await moderatorToken(world)),

  createChallenge: async (world) =>
    send(world, 'POST', '/v1/auth/challenge', undefined, {
      publicKey: (await testDevice()).publicKey,
    }),
  createSession: async (world) => {
    const device = await testDevice();
    return send(world, 'POST', '/v1/auth/session', undefined, {
      ...(await device.statement(await world.nonceFor(device))),
      displayName: 'Anna',
    });
  },
  createLeaveSession: async (world) => {
    // A suspended rider's way out (#898).
    const device = await testDevice();
    const athleteId = (await world.signIn(device)).body.athleteId as string;
    await send(
      world,
      'POST',
      `/v1/moderation/athletes/${athleteId}/suspend`,
      await moderatorToken(world),
      { reason: 'Checked against the rules' },
    );
    world.clock.ms += 60_000;
    return send(
      world,
      'POST',
      '/v1/auth/leave-session',
      undefined,
      await device.statement(await world.nonceFor(device)),
    );
  },
  getSession: async (world) =>
    send(world, 'GET', '/v1/auth/session', (await signedIn(world)).token),
  deleteSession: async (world) =>
    send(world, 'DELETE', '/v1/auth/session', (await signedIn(world)).token),
  setDisplayName: async (world) =>
    send(world, 'POST', '/v1/auth/display-name', (await signedIn(world)).token, {
      displayName: 'Bea',
    }),
  getAthlete: async (world) => {
    const other = await world.signIn(await testDevice());
    const { token } = await signedIn(world);
    return send(world, 'GET', `/v1/athletes/${other.body.athleteId as string}`, token);
  },
  createRoomTicket: async (world) => {
    await world.freshRead((store) =>
      store.putRoom({
        id: 'room-1',
        kind: 'race',
        visibility: 'private',
        routeSha256: 'a'.repeat(64),
        physicsVersion: 1,
      }),
    );
    return send(world, 'POST', '/v1/rooms/room-1/ticket', (await signedIn(world)).token, {
      declaredMassKilograms: 72,
    });
  },
  listDevices: async (world) =>
    send(world, 'GET', '/v1/auth/devices', (await signedIn(world)).token),
  revokeDevice: async (world) => {
    const { token } = await signedIn(world);
    const code = await world.call('POST', '/v1/auth/link-codes', { token });
    const second = await testDevice();
    await world.call('POST', '/v1/auth/link', {
      body: {
        ...(await second.statement(await world.nonceFor(second), { purpose: LINK_PURPOSE })),
        linkCode: (code.body as { linkCode: string }).linkCode,
      },
    });
    return send(world, 'POST', `/v1/auth/devices/${second.publicKey}/revoke`, token, {});
  },
  sealedRequest: async (world) => {
    const { device, token } = await signedIn(world);
    const sealed = await sealFor(world, {
      path: '/v1/auth/session',
      token,
      signer: device.signingKey,
    });
    return sendEnvelope(world.url, sealed.envelope, token);
  },
  createLinkCode: async (world) =>
    send(world, 'POST', '/v1/auth/link-codes', (await signedIn(world)).token),
  linkDevice: async (world) => {
    const { token } = await signedIn(world);
    const code = await world.call('POST', '/v1/auth/link-codes', { token });
    const second = await testDevice();
    return send(world, 'POST', '/v1/auth/link', undefined, {
      ...(await second.statement(await world.nonceFor(second), { purpose: LINK_PURPOSE })),
      linkCode: (code.body as { linkCode: string }).linkCode,
    });
  },
  recoverAccount: async (world) => {
    const session = await world.signIn(await testDevice());
    const [code] = session.body.recoveryCodes as string[];
    const replacement = await testDevice();
    return send(world, 'POST', '/v1/auth/recover', undefined, {
      ...(await replacement.statement(await world.nonceFor(replacement), {
        purpose: RECOVER_PURPOSE,
      })),
      recoveryCode: code,
    });
  },
  startRoom: async (world) =>
    send(world, 'POST', '/v1/rooms/room-1/start', (await signedIn(world)).token),
  createRoom: async (world) =>
    send(world, 'POST', '/v1/rooms', (await signedIn(world)).token, roomBody()),
  joinRoom: async (world) => {
    const room = await madeRoom(world, (await signedIn(world)).token);
    return send(world, 'POST', '/v1/rooms/join', (await signedIn(world)).token, {
      code: room.code,
    });
  },
  getRoomRoute: async (world) => {
    const { token } = await signedIn(world);
    const room = await madeRoom(world, token);
    return send(world, 'GET', `/v1/rooms/${room.roomId}/route`, token);
  },
  getRoomResults: async (world) => {
    const rider = await riderIn(world, await testDevice());
    const room = await madeRoom(world, rider.token);
    await world.freshRead((store) =>
      store.putResult({
        roomId: room.roomId,
        athleteId: rider.athleteId,
        finishMs: 61_000,
        flags: 1,
        place: 1,
        wattsPerKilogram: 7.21,
        flaggedDurationsSeconds: [60],
      }),
    );
    // Read once the race is over, and not before (#785, ADR 0028 D-7.7).
    await world.freshRead((store) => store.markRaceFinished(room.roomId, 1_790_000_100));
    return send(world, 'GET', `/v1/rooms/${room.roomId}/results`, rider.token);
  },
  requestEmailRecovery: (world) =>
    send(world, 'POST', '/v1/auth/recover/email', undefined, { address: 'anna@example.org' }),
  setRecoveryEmail: async (world) =>
    send(world, 'POST', '/v1/auth/recovery-email', (await signedIn(world)).token, {
      address: 'bea@example.org',
    }),
  confirmRecoveryEmail: async (world) => {
    const { token } = await signedIn(world);
    await world.call('POST', '/v1/auth/recovery-email', {
      token,
      body: { address: 'cat@example.org' },
    });
    const mailed = world.confirmations.at(-1)?.token;
    return send(world, 'POST', '/v1/auth/recovery-email/confirm', token, { token: mailed });
  },
  ...SYNC_HAPPY_CALLS,
  searchHistory: async (world) => {
    const { token } = await signedIn(world);
    await send(world, 'POST', '/v1/sync/items/note/note-1', token, {
      body: JSON.stringify({ text: 'Hill repeats on Thursday felt strong.' }),
    });
    await world.history.idle();
    return send(world, 'POST', '/v1/history/search', token, {
      query: 'hill repeats',
      limit: 6,
      characters: 5_400,
    });
  },
};

describe('every route answers with the shape its entry declares', () => {
  let instance: TestInstance;
  let world: IdentityInstance;
  let keysStore: StoreHarness;
  let keysClose: () => Promise<void> = () => Promise.resolve();
  beforeAll(async () => {
    // Probes that answer as a healthy instance with metrics on, so /ready and
    // /metrics answer their success; a probe-less instance is the other half.
    const probes = {
      ready: () =>
        assessReadiness({
          database: () => Promise.resolve(true),
          migrations: () => Promise.resolve('at-head' as const),
          rooms: () => true,
        }),
      metrics: (authorization: string | null) =>
        Promise.resolve(authorization === null ? 'oyl_rooms{worker="0"} 0\n' : undefined),
      startRoom: () => Promise.resolve('started' as const),
    };
    // The instance's own keys (#1189), over a store of their own, so
    // `/v1/instance/keys` answers its success.
    keysStore = await createStoreHarness();
    const store = await openSqlStore(keysStore.path);
    keysClose = () => store.close();
    instance = await startTestInstance({
      probes,
      instanceKeys: createInstanceKeys({
        store,
        secret: secretBytes(3),
        origin: 'https://ride.example',
        now: () => 1_790_000_000,
      }),
    });
    moderator = await testDevice();
    world = await startIdentityInstance({
      emailRecovery: true,
      probes,
      moderators: { owner: moderator.publicKey },
      analysis: { engine: INSTANT_ENGINE, available: () => true },
    });
  });
  afterAll(async () => {
    await instance.listening.close();
    await world.close();
    await keysClose();
    await keysStore.destroy();
  });

  const metadata = ROUTES.filter((route) => route.identity !== true);
  const identity = ROUTES.filter((route) => route.identity === true);

  it('has a successful call for every identity route, and no other', () => {
    expect(identity.length).toBeGreaterThan(0);
    expect(Object.keys(HAPPY_CALLS).sort()).toEqual(
      identity.map((route) => route.operationId).sort(),
    );
  });

  it.each(metadata.map((route) => [`${route.method} ${route.path}`, route] as const))(
    '%s',
    async (_, route) => {
      const response = await fetch(`${instance.url}${route.path}`, { method: route.method });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe(
        `${route.response.contentType}; charset=utf-8`,
      );
      if (route.response.contentType === 'application/json') {
        expect(violations(await response.json(), route.response.schema)).toEqual([]);
      } else {
        expect(typeof (await response.text())).toBe('string');
      }
    },
  );

  it.each(identity.map((route) => [`${route.method} ${route.path}`, route] as const))(
    '%s',
    async (_, route) => {
      const call = HAPPY_CALLS[route.operationId];
      if (call === undefined) throw new Error(`no happy call for ${route.operationId}`);
      // A minute on, so every call has the per-address challenge allowance to itself.
      world.clock.ms += 60_000;
      const response = await call(world);
      if (route.response.contentType === 'none') {
        expect(response.status, await response.clone().text()).toBe(204);
        expect(await response.text()).toBe('');
      } else if (
        route.response.contentType === 'application/json' ||
        route.response.contentType === 'sealed'
      ) {
        const body: unknown = await response.json();
        expect(response.status, JSON.stringify(body)).toBe(route.accepted === true ? 202 : 200);
        expect(violations(body, route.response.schema)).toEqual([]);
      } else if (route.response.contentType === 'application/octet-stream') {
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('application/octet-stream');
        expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
      } else if (route.response.contentType === 'text/event-stream') {
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('text/event-stream');
        // The opened events' kinds, in order: the stream ran to its result.
        expect((await response.text()).split('\n')).toEqual(['progress', 'result', 'end']);
      } else {
        throw new Error('an identity route answers JSON, bytes, a stream or nothing');
      }
    },
  );

  it('answers `unavailable` from every identity route on an instance with no accounts', async () => {
    // A sealed-only route is not reachable in plaintext at all (#1191): on an
    // instance with no accounts it is `/v1/sealed` that answers `unavailable`.
    for (const route of identity.filter((each) => each.sealed !== 'only')) {
      const response = await fetch(`${instance.url}${route.path.replace(/\{[A-Za-z]+\}/g, 'x')}`, {
        method: route.method,
        headers: { 'content-type': 'application/json' },
        ...(route.method === 'GET' ? {} : { body: '{}' }),
      });
      expect(response.status, `${route.method} ${route.path}`).toBe(503);
    }
  });

  it('the checker itself rejects a body that does not match — the control', () => {
    const health = ROUTES.find((route) => route.path === '/health');
    if (health?.response.contentType !== 'application/json') throw new Error('no /health');
    expect(violations({ status: 'ok', version: '1' }, health.response.schema)).toEqual([
      '$.commit: missing',
    ]);
    expect(violations({ status: 'ok', version: 1, commit: null }, health.response.schema)).toEqual([
      '$.version: integer is not string',
    ]);
    expect(
      violations({ status: 'ok', version: '1', commit: null, extra: true }, health.response.schema),
    ).toEqual(['$.extra: not declared']);
  });
});
