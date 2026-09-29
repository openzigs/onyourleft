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
import { openApiDocument, openApiText } from './openapi.ts';
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
  return fetch(`${world.url}${path}`, {
    method,
    headers: {
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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

const HAPPY_CALLS: Readonly<Record<string, HappyCall>> = {
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
  requestEmailRecovery: (world) =>
    send(world, 'POST', '/v1/auth/recover/email', undefined, { address: 'anna@example.org' }),
};

describe('every route answers with the shape its entry declares', () => {
  let instance: TestInstance;
  let world: IdentityInstance;
  beforeAll(async () => {
    instance = await startTestInstance();
    moderator = await testDevice();
    world = await startIdentityInstance({
      emailRecovery: true,
      moderators: { owner: moderator.publicKey },
    });
  });
  afterAll(async () => {
    await instance.listening.close();
    await world.close();
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
      } else if (route.response.contentType === 'application/json') {
        const body: unknown = await response.json();
        expect(response.status, JSON.stringify(body)).toBe(200);
        expect(violations(body, route.response.schema)).toEqual([]);
      } else {
        throw new Error('an identity route answers JSON or nothing');
      }
    },
  );

  it('answers `unavailable` from every identity route on an instance with no accounts', async () => {
    for (const route of identity) {
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
