// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';

import manifest from '../package.json' with { type: 'json' };
import { ERROR_CODES, ERROR_STATUS, errorResponse } from './errors.ts';
import { createHandler, matchPath } from './handler.ts';
import {
  startTestInstance,
  TEST_COMMIT,
  testConfig,
  type TestInstance,
} from './instance-testing.ts';
import { REQUEST_ORIGIN } from './node-listener.ts';
import { ROUTES, type Route } from './routes.ts';

let running: TestInstance | undefined;
afterEach(async () => {
  await running?.listening.close();
  running = undefined;
});

async function start(options: Parameters<typeof startTestInstance>[0] = {}): Promise<TestInstance> {
  running = await startTestInstance(options);
  return running;
}

/** Every error body is `{ error: { code, message[, fields] } }` and nothing else. */
function expectErrorShape(body: unknown, code: string): void {
  expect(body).toEqual({
    error: {
      code,
      message: expect.any(String) as unknown,
      ...(code === 'validation_failed' ? { fields: expect.any(Array) as unknown } : {}),
    },
  });
}

describe('GET /health, through the real listener', () => {
  it('answers 200 with the build’s version and commit', async () => {
    const instance = await start();
    const response = await fetch(`${instance.url}/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await response.json()).toEqual({ status: 'ok', version: '9.8.7', commit: TEST_COMMIT });
  });

  it('reports the package’s own version when main.ts builds it', () => {
    // main.ts hands `manifest.version` over; this pins that there is one to hand.
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('one request through each adapter', () => {
  it('the fetch-style handler and the Node listener answer the same', async () => {
    const instance = await start();
    const direct = await instance.handler(new Request(`${REQUEST_ORIGIN}/source`));
    const overTheWire = await fetch(`${instance.url}/source`);
    expect(direct.status).toBe(200);
    expect(overTheWire.status).toBe(200);
    expect(await overTheWire.json()).toEqual(await direct.json());
  });
});

describe('GET /source — AGPL-3.0 §13 (ADR 0036 D-6)', () => {
  it('answers with a URL that carries the build’s commit', async () => {
    const instance = await start();
    const body = (await (await fetch(`${instance.url}/source`)).json()) as { url: string };
    expect(body.url).toContain(TEST_COMMIT);
    expect(body).toEqual({
      url: `https://github.com/openzigs/onyourleft/tree/${TEST_COMMIT}`,
      commit: TEST_COMMIT,
      licence: 'AGPL-3.0-or-later',
    });
  });

  it('answers with what the operator configured, for a modified build', async () => {
    const instance = await start({ config: { sourceUrl: 'https://example.org/my-fork.tar.gz' } });
    const body = (await (await fetch(`${instance.url}/source`)).json()) as { url: string };
    expect(body.url).toBe('https://example.org/my-fork.tar.gz');
  });
});

describe('the one error shape (#36)', () => {
  it.each(ERROR_CODES)('%s has the documented shape and status', async (code) => {
    const response = errorResponse(code, { fields: [{ field: 'limit', problem: 'x' }] });
    expect(response.status).toBe(ERROR_STATUS[code]);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expectErrorShape(await response.json(), code);
  });

  it('answers an unknown path with not_found', async () => {
    const instance = await start();
    const response = await fetch(`${instance.url}/nothing-here`);
    expect(response.status).toBe(404);
    expectErrorShape(await response.json(), 'not_found');
  });

  it('answers a known path with the wrong method with method_not_allowed and Allow', async () => {
    const instance = await start();
    const response = await fetch(`${instance.url}/health`, { method: 'DELETE' });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
    expectErrorShape(await response.json(), 'method_not_allowed');
  });

  it('refuses a body larger than the limit that declares its length', async () => {
    const instance = await start();
    const response = await fetch(`${instance.url}/health`, {
      method: 'POST',
      body: 'x'.repeat(4096),
    });
    expect(response.status).toBe(413);
    expectErrorShape(await response.json(), 'payload_too_large');
  });

  it('refuses a body larger than the limit that declares NO length, without reading it all', async () => {
    const instance = await start();
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 1000) controller.close();
        else controller.enqueue(new Uint8Array(512));
      },
    });
    const response = await instance.handler(
      new Request(`${REQUEST_ORIGIN}/health`, { method: 'POST', body, duplex: 'half' }),
    );
    expect(response.status).toBe(413);
    expectErrorShape(await response.json(), 'payload_too_large');
    // The limit is 1024 bytes: three chunks of 512 cross it. A handler that
    // buffered the whole body first would have pulled every one of the thousand.
    expect(pulled).toBeLessThan(10);
  });

  it('hands a route a body within the limit, already read', async () => {
    const seen: (Uint8Array | null)[] = [];
    const echo: Route = {
      method: 'GET',
      path: '/echo',
      operationId: 'echo',
      summary: 'test',
      response: { contentType: 'text/plain' },
      handle: ({ body }) => {
        seen.push(body);
        return new Response('ok');
      },
    };
    const posting: Route = { ...echo, method: 'POST' };
    const handler = createHandler({
      config: testConfig(),
      version: '1',
      notices: '',
      log: () => undefined,
      routes: [echo, posting],
    });
    await handler(new Request(`${REQUEST_ORIGIN}/echo`, { method: 'POST', body: 'hello' }));
    await handler(new Request(`${REQUEST_ORIGIN}/echo`));
    expect(seen[0] === null ? null : new TextDecoder().decode(seen[0])).toBe('hello');
    expect(seen[1]).toBeNull();
  });

  it('answers an unhandled exception with internal, leaking no message, stack or path', async () => {
    const secret = 'at /Users/someone/instance/src/secret.ts:12:3 near 51.501364,-0.141890';
    const throwing: Route = {
      method: 'GET',
      path: '/throws',
      operationId: 'throws',
      summary: 'test',
      response: { contentType: 'text/plain' },
      handle: () => {
        const error = new TypeError(secret);
        error.stack = `TypeError: ${secret}\n    at handle (/Users/someone/instance/src/routes.ts:1:1)`;
        throw error;
      },
    };
    const instance = await start({ routes: [...ROUTES, throwing] });
    const response = await fetch(`${instance.url}/throws`);
    const text = await response.text();
    expect(response.status).toBe(500);
    expectErrorShape(JSON.parse(text), 'internal');
    for (const leak of ['/Users', 'secret', '51.50', 'routes.ts', ' at ', 'TypeError']) {
      expect(text).not.toContain(leak);
    }
    expect(instance.lines).toContain(
      JSON.stringify({ event: 'unhandled', route: '/throws', error: 'TypeError' }),
    );
    expect(instance.lines.join('\n')).not.toContain('/Users');
  });

  it('puts no-store and nosniff on every response, errors included', async () => {
    const instance = await start();
    for (const path of ['/health', '/nothing-here']) {
      const response = await fetch(`${instance.url}${path}`);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    }
  });
});

describe('GET /licences/third-party.txt', () => {
  it('serves the notices the instance was handed, as text', async () => {
    const instance = await start({ notices: 'Name: something\n' });
    const response = await fetch(`${instance.url}/licences/third-party.txt`);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await response.text()).toBe('Name: something\n');
  });
});

describe('a route’s `{name}` segments (#772)', () => {
  it('match one segment of letters, digits, `_` and `-`, and nothing else', () => {
    expect(matchPath('/v1/rooms/{roomId}/ticket', '/v1/rooms/room-1_A/ticket')).toEqual({
      roomId: 'room-1_A',
    });
    for (const refused of [
      '/v1/rooms/../ticket',
      '/v1/rooms/a.b/ticket',
      '/v1/rooms/a%2Fb/ticket',
      '/v1/rooms//ticket',
      '/v1/rooms/a/b/ticket',
      `/v1/rooms/${'a'.repeat(129)}/ticket`,
    ]) {
      expect(matchPath('/v1/rooms/{roomId}/ticket', refused), refused).toBeUndefined();
    }
    expect(matchPath('/health', '/health')).toEqual({});
    expect(matchPath('/health', '/healthz')).toBeUndefined();
  });
});
