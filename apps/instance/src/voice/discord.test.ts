// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The instance's one way to Discord (#874): rate limits honoured as a term of
 * the licence (spike 0018 §5.2), a refused token turning the client off for
 * good, and an error reduced to its name before anything can log it.
 */

import { describe, expect, it } from 'vitest';

import {
  createDiscordClient,
  DISCORD_API,
  errorName,
  MAXIMUM_ATTEMPTS,
  MAXIMUM_WAIT_MS,
  type DiscordClient,
} from './discord.ts';
import { TEST_BOT_TOKEN, TEST_GUILD_ID } from './discord-testing.ts';

interface Scripted {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

/** A client over a `fetch` that answers from `script` in turn, on a clock the sleeps move. */
function scripted(script: (Scripted | Error)[]) {
  const clock = { ms: 1_000_000 };
  const sent: { url: string; init: RequestInit | undefined; at: number }[] = [];
  const slept: number[] = [];
  const fetch = ((input: string | URL, init?: RequestInit) => {
    sent.push({ url: input.toString(), init, at: clock.ms });
    const next = script.shift();
    if (next === undefined) return Promise.reject(new Error('the script ran out'));
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(
      new Response(next.body === undefined ? null : JSON.stringify(next.body), {
        status: next.status,
        headers: next.headers ?? {},
      }),
    );
  }) as typeof globalThis.fetch;
  const client: DiscordClient = createDiscordClient({
    settings: { botToken: TEST_BOT_TOKEN, guildId: TEST_GUILD_ID },
    version: '9.9.9',
    fetch,
    now: () => clock.ms,
    sleep: (ms) => {
      slept.push(ms);
      clock.ms += ms;
      return Promise.resolve();
    },
  });
  return { client, sent, slept, clock };
}

describe('a request to Discord (#874)', () => {
  it('carries the bot token in its Authorization header, a DiscordBot User-Agent, and refuses redirects', async () => {
    const { client, sent } = scripted([{ status: 200, body: { id: TEST_GUILD_ID } }]);
    const answer = await client.request('GET /guilds/:id', 'GET', `/guilds/${TEST_GUILD_ID}`);
    expect(answer).toEqual({ kind: 'ok', status: 200, body: { id: TEST_GUILD_ID } });
    const [only] = sent;
    expect(only?.url).toBe(`${DISCORD_API}/guilds/${TEST_GUILD_ID}`);
    const headers = new Headers(only?.init?.headers);
    expect(headers.get('authorization')).toBe(`Bot ${TEST_BOT_TOKEN}`);
    expect(headers.get('user-agent')).toBe(
      'DiscordBot (https://github.com/openzigs/onyourleft, 9.9.9)',
    );
    // No body, no Content-Type; and no audit-log reason ever (spike 0018 §7 item 8).
    expect(headers.get('content-type')).toBeNull();
    expect(headers.get('x-audit-log-reason')).toBeNull();
    expect(only?.init?.redirect).toBe('error');
  });

  it('sends a body as JSON, and answers a 204 with no body', async () => {
    const { client, sent } = scripted([{ status: 204 }]);
    expect(await client.request('PATCH /x', 'PATCH', '/x', { a: 1 })).toEqual({
      kind: 'ok',
      status: 204,
      body: undefined,
    });
    expect(new Headers(sent[0]?.init?.headers).get('content-type')).toBe('application/json');
    expect(sent[0]?.init?.body).toBe('{"a":1}');
  });

  it('waits out a 429 by its retry_after and tries again', async () => {
    const { client, sent, slept } = scripted([
      { status: 429, body: { retry_after: 1.5, global: false } },
      { status: 200, body: { ok: 1 } },
    ]);
    expect(await client.request('POST /r', 'POST', '/r', {})).toMatchObject({ kind: 'ok' });
    expect(slept).toEqual([1500]);
    expect(sent).toHaveLength(2);
  });

  it('reads Retry-After when the body says nothing, and a global 429 holds back every route', async () => {
    const { client, slept } = scripted([
      { status: 429, headers: { 'Retry-After': '2', 'X-RateLimit-Global': 'true' } },
      { status: 200, body: {} },
      { status: 200, body: {} },
    ]);
    await client.request('GET /a', 'GET', '/a');
    expect(slept).toEqual([2000]);
    // The global wait is over by now: another route goes at once.
    await client.request('GET /b', 'GET', '/b');
    expect(slept).toEqual([2000]);
  });

  it('a global 429 delays a request on ANOTHER route that is sent before it is over', async () => {
    const { client, slept, clock } = scripted([
      { status: 429, body: { retry_after: 5, global: true } },
      { status: 429, body: { retry_after: 5, global: true } },
      { status: 429, body: { retry_after: 5, global: true } },
      { status: 200, body: {} },
    ]);
    expect(await client.request('GET /a', 'GET', '/a')).toEqual({ kind: 'refused', status: 429 });
    const before = clock.ms;
    await client.request('GET /b', 'GET', '/b');
    expect(slept.at(-1)).toBe(5000);
    expect(clock.ms - before).toBe(5000);
  });

  it(`gives up after ${String(MAXIMUM_ATTEMPTS)} attempts, and never waits longer than ${String(MAXIMUM_WAIT_MS)} ms`, async () => {
    const many = scripted([
      { status: 429, body: { retry_after: 0.1 } },
      { status: 429, body: { retry_after: 0.1 } },
      { status: 429, body: { retry_after: 0.1 } },
      { status: 200, body: {} },
    ]);
    expect(await many.client.request('GET /a', 'GET', '/a')).toEqual({
      kind: 'refused',
      status: 429,
    });
    expect(many.sent).toHaveLength(MAXIMUM_ATTEMPTS);

    const long = scripted([{ status: 429, body: { retry_after: 3600 } }, { status: 200 }]);
    expect(await long.client.request('GET /a', 'GET', '/a')).toEqual({
      kind: 'refused',
      status: 429,
    });
    expect(long.sent).toHaveLength(1);
    expect(long.slept).toEqual([]);
    // And the route's next request is refused without being sent: the bucket is still out.
    expect(await long.client.request('GET /a', 'GET', '/a')).toEqual({
      kind: 'refused',
      status: 429,
    });
    expect(long.sent).toHaveLength(1);
  });

  it('waits out a bucket that said it had none left, on that route only', async () => {
    const { client, slept, sent } = scripted([
      {
        status: 200,
        body: {},
        headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset-After': '0.75' },
      },
      { status: 200, body: {} },
      { status: 200, body: {} },
    ]);
    await client.request('POST /channels', 'POST', '/one', {});
    await client.request('GET /other', 'GET', '/other');
    expect(slept).toEqual([]);
    await client.request('POST /channels', 'POST', '/two', {});
    expect(slept).toEqual([750]);
    expect(sent).toHaveLength(3);
  });

  it('turns off for good on a 401, and sends nothing after it', async () => {
    const { client, sent } = scripted([{ status: 401, body: { message: '401: Unauthorized' } }]);
    expect(client.off).toBe(false);
    expect(await client.request('GET /a', 'GET', '/a')).toEqual({ kind: 'off' });
    expect(client.off).toBe(true);
    expect(await client.request('GET /b', 'GET', '/b')).toEqual({ kind: 'off' });
    expect(sent).toHaveLength(1);
  });

  it('never retries a 403, a 404 or a 5xx', async () => {
    for (const status of [403, 404, 500, 502]) {
      const { client, sent } = scripted([{ status }, { status: 200, body: {} }]);
      expect(await client.request('GET /a', 'GET', '/a')).toEqual({ kind: 'refused', status });
      expect(sent, String(status)).toHaveLength(1);
    }
  });

  it('a request that throws is `failed` with the error’s NAME, never its message', async () => {
    const thrown = new TypeError(`fetch failed for Bot ${TEST_BOT_TOKEN}`);
    const { client } = scripted([thrown]);
    const answer = await client.request('GET /a', 'GET', '/a');
    expect(answer).toEqual({ kind: 'failed', error: 'TypeError' });
    expect(JSON.stringify(answer)).not.toContain(TEST_BOT_TOKEN);
  });

  it('a 2xx whose body will not parse is `failed`, by name', async () => {
    const fetch = (() =>
      Promise.resolve(new Response('<html>', { status: 200 }))) as typeof globalThis.fetch;
    const client = createDiscordClient({
      settings: { botToken: TEST_BOT_TOKEN, guildId: TEST_GUILD_ID },
      version: '1',
      fetch,
    });
    expect(await client.request('GET /a', 'GET', '/a')).toEqual({
      kind: 'failed',
      error: 'SyntaxError',
    });
  });
});

describe('errorName', () => {
  it('is a plain word or `unknown`: an error named by its token is not logged by it', () => {
    expect(errorName(new RangeError('x'))).toBe('RangeError');
    const named = new Error('x');
    named.name = TEST_BOT_TOKEN;
    expect(errorName(named)).toBe('unknown');
    expect(errorName('a string')).toBe('unknown');
  });
});
