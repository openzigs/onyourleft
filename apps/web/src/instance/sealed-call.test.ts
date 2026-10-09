// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The client half of a sealed call (#1191, ADR 0047 D-8, D-9), against an
 * instance played here by `@onyourleft/domain`'s own opening half over real
 * WebCrypto — the client cannot import `apps/instance`, and the instance's own
 * order of checks is `apps/instance/src/sealed/sealed.test.ts`'s. What is held
 * here: the clock offset (re-signed once, kept, never taken from plaintext,
 * and the two notices), streams finished or cut, the pasted key's padding, and
 * that no ephemeral secret is written anywhere.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  decodeFrame,
  openSealedRequest,
  parseSealedEnvelope,
  sealedReplyWriter,
  sessionTokenSha256,
  SEALED_END_KIND,
  unpad,
  utf8Encode,
  type SigningKey,
} from '@onyourleft/domain';
import { webCryptoHpkePrimitives, webCryptoSha256 } from '@onyourleft/store';

import {
  clockOffsetNotice,
  createInstanceClock,
  INSTANCE_CLOCK_WRONG_NOTICE,
  InstanceUnreachableError,
  sealedInstance,
  type InstanceSend,
} from './instance-transport';

const ORIGIN = 'https://ride.example';
const KEY_ID = '0123456789abcdef';
const T0_SECONDS = 1_790_000_000;

/** A device key that signs with WebCrypto and is never exported. */
async function deviceKey(): Promise<SigningKey> {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return {
    algorithm: 'Ed25519',
    publicKey,
    sign: async (message) =>
      new Uint8Array(await crypto.subtle.sign('Ed25519', pair.privateKey, new Uint8Array(message))),
  };
}

interface Played {
  readonly send: InstanceSend & ReturnType<typeof vi.fn>;
  /** The instance's clock, Unix seconds. */
  clock: number;
  /** What each request's inner header said. */
  readonly seen: { method: string; path: string; issuedAt: number; lastEventId?: string }[];
  readonly instanceKey: { keyId: string; publicKey: Uint8Array };
}

/**
 * An instance played by the domain's opening half: it opens, refuses a stale
 * `issuedAt` sealed with its time, and otherwise answers `{ path }` — or, for
 * `/v1/stream`, a stream shaped by `streamFrames`.
 */
async function playInstance(
  options: {
    advancePerRequest?: number;
    plaintextStale?: boolean;
    streamFrames?: (events: readonly string[]) => readonly string[];
  } = {},
): Promise<Played> {
  const pair = await webCryptoHpkePrimitives.generateX25519KeyPair();
  const played: Played = {
    clock: T0_SECONDS,
    seen: [],
    instanceKey: { keyId: KEY_ID, publicKey: pair.publicKey },
    send: vi.fn(async (_url: string, init: RequestInit) => {
      const envelope = parseSealedEnvelope(
        JSON.parse(init.body as string) as Record<string, unknown>,
      );
      if (envelope === undefined) throw new Error('not an envelope');
      const authorization = new Headers(init.headers).get('authorization');
      const token = authorization?.replace(/^Bearer /, '') ?? null;
      const binding = {
        instanceOrigin: ORIGIN,
        keyId: KEY_ID,
        tokenSha256: token === null ? null : await sessionTokenSha256(webCryptoSha256, token),
      };
      const opened = await openSealedRequest(webCryptoHpkePrimitives, pair, envelope, binding);
      const { header } = decodeFrame(unpad(opened.padded));
      played.seen.push(header as Played['seen'][number]);
      const now = played.clock;
      played.clock += options.advancePerRequest ?? 0;
      const writer = await sealedReplyWriter(webCryptoHpkePrimitives, opened.context, binding);
      const reply = async (status: number, body: unknown) =>
        new Response(
          JSON.stringify(
            await writer.reply(status, 'application/json', utf8Encode(JSON.stringify(body))),
          ),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      if (Math.abs(now - (header.issuedAt as number)) > 120) {
        const stale = { error: { code: 'stale_request', message: '' }, instanceTime: now };
        if (options.plaintextStale === true) {
          return new Response(JSON.stringify(stale), { status: 401 });
        }
        return reply(401, stale);
      }
      if (header.path === '/v1/stream') {
        const after = Number(header.lastEventId ?? '0');
        const events: string[] = [];
        for (let id = after + 1; id <= 3; id += 1) {
          events.push(await writer.event(String(id), 'section', utf8Encode(`part ${String(id)}`)));
        }
        events.push(await writer.event(String(3), SEALED_END_KIND, new Uint8Array(0)));
        const shaped = options.streamFrames?.(events) ?? events;
        return new Response(shaped.map((data) => `data: ${data}\n\n`).join(''), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      return reply(200, { path: header.path });
    }) as InstanceSend & ReturnType<typeof vi.fn>,
  };
  return played;
}

async function client(played: Played, deviceSecondsBehind = 0) {
  const clock = createInstanceClock();
  const signingKey = await deviceKey();
  const http = sealedInstance(
    ORIGIN,
    {
      instanceKey: played.instanceKey,
      signingKey,
      primitives: webCryptoHpkePrimitives,
      sha256: webCryptoSha256,
      clock,
      now: () => (T0_SECONDS - deviceSecondsBehind) * 1000,
    },
    played.send,
  );
  return { http, clock };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a sealed call — #1191', () => {
  it('seals, sends through the one transport, and opens the answer', async () => {
    const played = await playInstance();
    const { http } = await client(played);
    const answer = await http.call('POST', '/v1/auth/session', { token: 'tok', body: { a: 1 } });
    expect(answer).toEqual({ status: 200, body: { path: '/v1/auth/session' } });
    const [url, init] = played.send.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${ORIGIN}/v1/sealed`);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.body as string).not.toContain('auth/session');
  });

  it('refuses a path it would not send in plaintext, having sent nothing', async () => {
    const played = await playInstance();
    const { http } = await client(played);
    await expect(http.call('GET', '/v1/../auth')).rejects.toThrow(InstanceUnreachableError);
    expect(played.send).not.toHaveBeenCalled();
  });

  it('pads a pasted key’s request to at least 1 KiB', async () => {
    const played = await playInstance();
    const { http } = await client(played);
    await http.call('POST', '/v1/x', { token: 't', body: { k: 'sk-1' } });
    await http.call('POST', '/v1/x', { token: 't', body: { k: 'sk-1' }, pastedKey: true });
    const lengths = played.send.mock.calls.map(
      ([, init]) => (JSON.parse((init as RequestInit).body as string) as { ct: string }).ct.length,
    );
    expect(lengths[0]).toBe(Math.ceil(((512 + 16) * 4) / 3));
    expect(lengths[1]).toBe(Math.ceil(((1024 + 16) * 4) / 3));
  });
});

describe('the clock offset (D-9)', () => {
  it('re-signs once with the instance’s time, keeps the offset, and pays no second round trip after', async () => {
    const played = await playInstance();
    const { http, clock } = await client(played, 600);
    const first = await http.call('GET', '/v1/x', { token: 't' });
    expect(first.status).toBe(200);
    expect(played.send).toHaveBeenCalledTimes(2);
    expect(played.seen[1]?.issuedAt).toBe(T0_SECONDS);
    expect(clock.offsetSeconds(ORIGIN)).toBe(600);
    expect(first.notice).toEqual({
      kind: 'clock-offset',
      minutes: 10,
      text: clockOffsetNotice(10),
    });
    const second = await http.call('GET', '/v1/y', { token: 't' });
    expect(second.status).toBe(200);
    expect(second.notice).toBeUndefined();
    expect(played.send).toHaveBeenCalledTimes(3);
  });

  it('keeps an offset under five minutes without telling the rider', async () => {
    const played = await playInstance();
    const { http, clock } = await client(played, 180);
    const answer = await http.call('GET', '/v1/x', { token: 't' });
    expect(answer.status).toBe(200);
    expect(answer.notice).toBeUndefined();
    expect(clock.offsetSeconds(ORIGIN)).toBe(180);
  });

  it('says the instance’s clock looks wrong on a second `stale_request`', async () => {
    const played = await playInstance({ advancePerRequest: 1_000 });
    const { http } = await client(played, 600);
    const answer = await http.call('GET', '/v1/x', { token: 't' });
    expect(played.send).toHaveBeenCalledTimes(2);
    expect(answer.notice).toEqual({
      kind: 'instance-clock-wrong',
      text: INSTANCE_CLOCK_WRONG_NOTICE,
    });
  });

  it('never takes the offset from a plaintext answer, which the edge could write', async () => {
    const played = await playInstance({ plaintextStale: true });
    const { http, clock } = await client(played, 600);
    const answer = await http.call('GET', '/v1/x', { token: 't' });
    expect(answer.status).toBe(401);
    expect(played.send).toHaveBeenCalledTimes(1);
    expect(clock.offsetSeconds(ORIGIN)).toBe(0);
    expect(answer.notice).toBeUndefined();
  });
});

describe('a plaintext 200 is never an answer (#1205 review)', () => {
  async function forging(response: () => Response) {
    const played = await playInstance();
    const forged = {
      ...played,
      send: vi.fn(() => Promise.resolve(response())) as unknown as Played['send'],
    };
    return client(forged);
  }

  it('fails a call whose 200 is not a sealed reply', async () => {
    const { http } = await forging(
      () => new Response(JSON.stringify({ forged: true }), { status: 200 }),
    );
    await expect(http.call('POST', '/v1/sync/records', { token: 't' })).rejects.toBeInstanceOf(
      InstanceUnreachableError,
    );
  });

  it('fails a stream whose 200 is a plaintext body', async () => {
    const { http } = await forging(
      () =>
        new Response(JSON.stringify({ forged: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await expect(
      http.stream('/v1/stream', { token: 't', onEvent: () => undefined }),
    ).rejects.toBeInstanceOf(InstanceUnreachableError);
  });

  it('fails, as unreachable, a sealed-looking reply that does not open', async () => {
    const played = await playInstance();
    const real = played.send;
    const tampered = {
      ...played,
      send: vi.fn(async (url: string, init: RequestInit) => {
        const response = await real(url, init);
        const reply = JSON.parse(await response.text()) as Record<string, string>;
        const ct = String(reply.ct);
        reply.ct = `${ct[0] === 'A' ? 'B' : 'A'}${ct.slice(1)}`;
        return new Response(JSON.stringify(reply), { status: 200 });
      }) as unknown as Played['send'],
    };
    const { http } = await client(tampered);
    await expect(http.call('GET', '/v1/x', { token: 't' })).rejects.toBeInstanceOf(
      InstanceUnreachableError,
    );
  });

  it('still returns a plaintext non-200 refusal as it is', async () => {
    const { http } = await forging(
      () => new Response(JSON.stringify({ error: { code: 'x' } }), { status: 429 }),
    );
    expect((await http.call('GET', '/v1/x', { token: 't' })).status).toBe(429);
  });
});

describe('a sealed stream (D-9)', () => {
  it('is finished only on its sealed `end` event', async () => {
    const played = await playInstance();
    const { http } = await client(played);
    const events: string[] = [];
    const result = await http.stream('/v1/stream', {
      token: 't',
      onEvent: (event) => events.push(`${event.id}:${event.kind}:${event.data}`),
    });
    expect(result).toEqual({ outcome: 'finished', lastEventId: '3' });
    expect(events).toEqual(['1:section:part 1', '2:section:part 2', '3:section:part 3']);
  });

  it('is cut when the `end` event never comes, and names the last event opened', async () => {
    const played = await playInstance({ streamFrames: (events) => events.slice(0, 2) });
    const { http } = await client(played);
    const result = await http.stream('/v1/stream', { token: 't', onEvent: () => undefined });
    expect(result).toEqual({ outcome: 'cut', lastEventId: '2' });
  });

  it('is cut at a dropped, duplicated or reordered event', async () => {
    for (const shape of [
      (events: readonly string[]) => [events[0]!, events[2]!, events[3]!],
      (events: readonly string[]) => [events[0]!, events[0]!, ...events.slice(1)],
      (events: readonly string[]) => [events[1]!, events[0]!, ...events.slice(2)],
    ]) {
      const played = await playInstance({ streamFrames: shape });
      const { http } = await client(played);
      const result = await http.stream('/v1/stream', { token: 't', onEvent: () => undefined });
      expect(result.outcome).toBe('cut');
    }
  });

  it('resumes with a new sealed request naming the last event id', async () => {
    const played = await playInstance();
    const { http } = await client(played);
    const ids: string[] = [];
    const result = await http.stream('/v1/stream', {
      token: 't',
      lastEventId: '2',
      onEvent: (event) => ids.push(event.id),
    });
    expect(played.seen[0]?.lastEventId).toBe('2');
    expect(ids).toEqual(['3']);
    expect(result.outcome).toBe('finished');
  });
});

describe('no device secret is kept (D-2)', () => {
  it('writes nothing to IndexedDB or localStorage, logs nothing, and exports no private key', async () => {
    const databases = async () => (await indexedDB.databases()).map((each) => each.name).sort();
    const before = { databases: await databases(), stored: localStorage.length };
    const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    const exported = vi.spyOn(crypto.subtle, 'exportKey');
    const played = await playInstance();
    const { http } = await client(played, 600);
    exported.mockClear();
    await http.call('POST', '/v1/x', { token: 't', body: { key: 'sk-pasted' }, pastedKey: true });
    await http.stream('/v1/stream', { token: 't', onEvent: () => undefined });
    expect(await databases()).toEqual(before.databases);
    expect(localStorage.length).toBe(before.stored);
    for (const spy of logs) expect(spy).not.toHaveBeenCalled();
    for (const [, key] of exported.mock.calls) expect(key.type).toBe('public');
    // The ephemeral keys the client generated are not extractable at all.
    const generated = await webCryptoHpkePrimitives.generateX25519KeyPair();
    expect(generated.privateKey.extractable).toBe(false);
  });
});
