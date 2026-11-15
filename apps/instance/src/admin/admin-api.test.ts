// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The API never reads the admin cookie** (#2641, ADR 0069 D-4), and the
 * admin seam reaches a route only as its `admin` mark allows, through every
 * check the route declares (ADR 0069 D-2).
 *
 * The routes are ENUMERATED from the production table, never listed here, so
 * a route added tomorrow is sent the cookie too.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Caller } from '../auth/identity.ts';
import { createHandler } from '../handler.ts';
import { testConfig } from '../instance-testing.ts';
import {
  codeOf,
  startModerationWorld,
  type ModerationWorld,
} from '../moderation/moderation-testing.ts';
import { adminCode } from '../operator/commands.ts';
import { json, type Route } from '../route-kit.ts';
import { ROUTES } from '../routes.ts';
import { ADMIN_COOKIE, type Admin, type AdminSeam } from './admin.ts';
import { adminRequest, signInWith, TEST_HOST } from './admin-testing.ts';

/** A route's path with every `{name}` filled with a value the matcher takes. */
const pathOf = (route: Route): string => route.path.replace(/\{[A-Za-z]+\}/g, 'x0');

/** A response as bytes: its status, every header and its body. */
async function bytesOf(response: Response): Promise<unknown> {
  return {
    status: response.status,
    headers: [...response.headers.entries()],
    body: [...new Uint8Array(await response.arrayBuffer())],
  };
}

describe('the API ignores the admin cookie (#2641)', () => {
  let world: ModerationWorld;
  let token: string;
  beforeAll(async () => {
    world = await startModerationWorld({ admin: {} });
    const { code } = await adminCode(
      { database: world.path, blobs: `${world.path}.blobs` },
      () => new Date(world.clock.ms),
    );
    token = await signInWith(world.instance.handler, code);
  });
  afterAll(() => world.close());

  it(`answers each of the ${String(ROUTES.length)} routes of the production table byte for byte as it does without the cookie`, async () => {
    const send = (route: Route, cookie: boolean): Promise<Response> =>
      world.instance.handler(
        new Request(`http://instance.invalid${pathOf(route)}`, {
          method: route.method,
          headers: {
            host: TEST_HOST,
            ...(cookie ? { cookie: `${ADMIN_COOKIE}=${token}` } : {}),
            ...(route.method === 'GET' ? {} : { 'content-type': 'application/json' }),
          },
          ...(route.method === 'GET' ? {} : { body: '{}' }),
        }),
        { address: '203.0.113.30' },
      );
    expect(ROUTES.length).toBeGreaterThan(50);
    for (const route of ROUTES) {
      const without = await bytesOf(await send(route, false));
      const withCookie = await bytesOf(await send(route, true));
      expect(withCookie, `${route.method} ${route.path}`).toEqual(without);
    }
  });

  it('still refuses a plaintext GET /v1/operate/status sealed_required with the cookie, on an instance with keys', async () => {
    const answer = await world.instance.handler(
      new Request('http://instance.invalid/v1/operate/status', {
        headers: { host: TEST_HOST, cookie: `${ADMIN_COOKIE}=${token}` },
      }),
    );
    expect(answer.status).toBe(403);
    expect(codeOf(await answer.json())).toBe('sealed_required');
    // The cookie was the admin layer's all along: the page still reads.
    expect(
      (await world.instance.handler(adminRequest('GET', '/admin/status', { cookie: token })))
        .status,
    ).toBe(200);
  });
});

describe('the admin seam reaches a route only as its `admin` mark says (#2641, ADR 0069 D-2)', () => {
  let world: ModerationWorld;
  beforeAll(async () => {
    world = await startModerationWorld();
  });
  afterAll(() => world.close());

  /** An admin layer that dispatches `path` through the seam, as the caller given. */
  const dispatching = (path: string, caller: () => Caller): Admin => ({
    handle: (_request, _body, client, seam: AdminSeam) =>
      seam.dispatch('GET', path, caller(), client),
    flushRefusals: () => Promise.resolve(),
    sweepRateLimits: () => undefined,
    rateLimitSweepPeriodMs: 60_000,
  });
  const asCaller = (rider: ModerationWorld['owner']): Caller => ({
    athleteId: rider.athleteId,
    deviceKey: rider.device.publicKey,
    tokenSha256: 'admin',
    standing: 'active',
  });
  let called = 0;
  const marked = (admin: Route['admin'], path: string): Route => ({
    method: 'GET',
    path,
    operationId: `probe${path.replaceAll('/', '')}`,
    summary: 'A probe.',
    reaches: 'owner',
    identity: true,
    auth: 'session',
    ...(admin === undefined ? {} : { admin }),
    response: { contentType: 'application/json', schema: { type: 'object', description: 'x' } },
    handle: () => {
      called += 1;
      return json({ ok: true });
    },
  });
  const PROBES: readonly Route[] = [
    marked('read', '/v1/probe/read'),
    marked('never', '/v1/probe/never'),
    marked(undefined, '/v1/probe/unmarked'),
  ];

  async function through(path: string, caller: () => Caller): Promise<Response> {
    const handler = createHandler({
      config: testConfig({ moderators: { owner: world.owner.device.publicKey } }),
      version: '9.8.7',
      notices: 'n',
      log: () => undefined,
      routes: [...ROUTES, ...PROBES],
      identity: world.identity,
      instanceKeys: world.instanceKeys,
      sealed: world.sealed,
      admin: dispatching(path, caller),
    });
    return handler(adminRequest('GET', '/admin'));
  }

  it('calls a `read` route as the owner, and refuses `never` and an unmarked one before calling them', async () => {
    called = 0;
    expect((await through('/v1/probe/read', () => asCaller(world.owner))).status).toBe(200);
    expect(called).toBe(1);
    for (const path of ['/v1/probe/never', '/v1/probe/unmarked']) {
      const answer = await through(path, () => asCaller(world.owner));
      expect(answer.status, path).toBe(404);
      expect(codeOf(await answer.json())).toBe('not_found');
    }
    expect(called).toBe(1);
  });

  it('runs the route’s own reaches check on the seam’s caller: the deputy is answered as no route', async () => {
    called = 0;
    const answer = await through('/v1/probe/read', () => asCaller(world.deputy));
    expect(answer.status).toBe(404);
    expect(called).toBe(0);
  });
});
