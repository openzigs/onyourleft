// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The model connection (#1096, ADR 0046 D-8): the gateway guard, one host,
 * the local-address rule on every turn, closed failures, and an abort that
 * reaches the wire — all against the fake model server, with no network.
 *
 * ⚠️ The one file besides `model.ts` that names `ai`: the guard can only be
 * shown to hold by calling the SDK with a string model id (`eslint.config.js`
 * names both files).
 */

import { generateText } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Resolver } from '../history/address.ts';
import {
  startFakeModelServer,
  WITHOUT_TOOLS_REPLY,
  type FakeModelServer,
  type ScriptedReply,
} from './fake-model-server-testing.ts';
import { createLocalModel, GATEWAY_REFUSED, GatewayRefusedError } from './model.ts';
import type { ModelTurnRequest, ToolSpec } from './model-turn.ts';

const LOOPBACK: Resolver = () => Promise.resolve(['127.0.0.1']);

const RIDE_TOOL: ToolSpec = {
  name: 'ride_sections',
  description: 'The sections of the ride.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
};

function request(overrides: Partial<ModelTurnRequest> = {}): ModelTurnRequest {
  return {
    system: 'You are helping a cyclist.',
    messages: [{ role: 'user', text: 'The ride.' }],
    tools: [RIDE_TOOL],
    maxOutputTokens: 256,
    timeoutMilliseconds: 10_000,
    signal: new AbortController().signal,
    ...overrides,
  };
}

let server: FakeModelServer | undefined;
afterEach(async () => {
  vi.unstubAllGlobals();
  await server?.close();
  server = undefined;
});

async function fake(...script: ScriptedReply[]): Promise<FakeModelServer> {
  server = await startFakeModelServer(script);
  return server;
}

/** A fetch that records every URL and forwards to the real one. */
function recordingFetch() {
  const urls: string[] = [];
  const fetch = ((input: string | URL | Request, init?: RequestInit) => {
    urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    return globalThis.fetch(input, init);
  }) as typeof globalThis.fetch;
  return { urls, fetch };
}

describe('no string model id reaches the gateway (ADR 0046 D-8)', () => {
  it('throws the guard’s error for a bare string id, and nothing is fetched', async () => {
    const model = await fake({ kind: 'text', text: 'never' });
    const fetchSpy = vi.fn(() => Promise.reject(new Error('no network in this test')));
    vi.stubGlobal('fetch', fetchSpy);
    expect(globalThis.AI_SDK_DEFAULT_PROVIDER).toBe(GATEWAY_REFUSED);
    await expect(
      generateText({ model: 'some-vendor/some-model', prompt: 'hello', maxRetries: 0 }),
    ).rejects.toBeInstanceOf(GatewayRefusedError);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(model.requests).toHaveLength(0);
  });
});

describe('one turn through the fake server', () => {
  it('sends one request, to the configured base URL and no other host, and reads the reply', async () => {
    const model = await fake({ kind: 'text', text: 'A steady ride.' });
    const { urls, fetch } = recordingFetch();
    const connection = createLocalModel({
      settings: { baseUrl: model.baseUrl, model: 'scripted' },
      resolve: LOOPBACK,
      fetch,
    });
    const turn = await connection.turn(request());
    expect(turn).toStrictEqual({
      ok: true,
      text: 'A steady ride.',
      calls: [],
      finish: 'stop',
      usage: { inputTokens: 100, outputTokens: 20 },
    });
    expect(urls).toStrictEqual([`${model.baseUrl.href}/chat/completions`]);
    expect(model.paths).toStrictEqual(['/v1/chat/completions']);
    const body = model.requests[0] ?? {};
    expect(body.model).toBe('scripted');
    expect(body.max_tokens).toBe(256);
    expect(JSON.stringify(body.tools)).toContain('ride_sections');
  });

  it('hands back the calls a model made, and marks one whose arguments do not parse', async () => {
    const model = await fake({
      kind: 'tool-calls',
      calls: [
        { name: 'recent_rides', arguments: '{"count":3}' },
        { name: 'goals', arguments: '{not json' },
      ],
    });
    const connection = createLocalModel({
      settings: { baseUrl: model.baseUrl, model: 'scripted' },
      resolve: LOOPBACK,
    });
    const tools: ToolSpec[] = [
      RIDE_TOOL,
      { ...RIDE_TOOL, name: 'recent_rides' },
      { ...RIDE_TOOL, name: 'goals' },
    ];
    const turn = await connection.turn(request({ tools }));
    expect(turn.ok).toBe(true);
    if (!turn.ok) return;
    expect(turn.finish).toBe('tool-calls');
    expect(turn.calls).toStrictEqual([
      { callId: 'call_1_0', toolName: 'recent_rides', input: { count: 3 } },
      { callId: 'call_1_1', toolName: 'goals', invalid: true },
    ]);
  });

  it('says a reply was cut off by its bound', async () => {
    const model = await fake({ kind: 'text', text: 'A steady', finish: 'length' });
    const connection = createLocalModel({
      settings: { baseUrl: model.baseUrl, model: 'scripted' },
      resolve: LOOPBACK,
    });
    const turn = await connection.turn(request());
    expect(turn.ok && turn.finish).toBe('length');
  });
});

describe('errors are a closed enumeration, never the server’s words', () => {
  const MARKER = 'PLANTED-SERVER-TEXT-7f3a';
  it.each([
    [WITHOUT_TOOLS_REPLY, 'model-without-tools'],
    [{ kind: 'status', status: 400, body: `{"error":{"message":"${MARKER}"}}` }, 'refused'],
    [{ kind: 'status', status: 404, body: `{"error":"${MARKER}"}` }, 'refused'],
    [{ kind: 'status', status: 503, body: `{"error":{"message":"${MARKER}"}}` }, 'server-error'],
    [{ kind: 'status', status: 200, body: `${MARKER} is not JSON` }, 'malformed'],
  ] as const)('%#: answers %s as a closed failure', async (reply, expected) => {
    const model = await fake(reply);
    const connection = createLocalModel({
      settings: { baseUrl: model.baseUrl, model: 'scripted' },
      resolve: LOOPBACK,
    });
    const turn = await connection.turn(request());
    expect(turn).toStrictEqual({ ok: false, failure: expected });
    expect(JSON.stringify(turn)).not.toContain(MARKER);
  });

  it('is unreachable when nothing listens', async () => {
    const model = await fake();
    const baseUrl = model.baseUrl;
    await model.close();
    server = undefined;
    const connection = createLocalModel({
      settings: { baseUrl, model: 'scripted' },
      resolve: LOOPBACK,
    });
    expect(await connection.turn(request())).toStrictEqual({ ok: false, failure: 'unreachable' });
  });
});

describe('the job’s signal reaches the wire', () => {
  it('aborts the in-flight request, and the server sees its socket close', async () => {
    const model = await fake({
      kind: 'slow',
      milliseconds: 5_000,
      then: { kind: 'text', text: 'too late' },
    });
    const connection = createLocalModel({
      settings: { baseUrl: model.baseUrl, model: 'scripted' },
      resolve: LOOPBACK,
    });
    const controller = new AbortController();
    const pending = connection.turn(request({ signal: controller.signal }));
    await vi.waitFor(() => expect(model.requests).toHaveLength(1));
    controller.abort();
    expect(await pending).toStrictEqual({ ok: false, failure: 'aborted' });
    await vi.waitFor(() => expect(model.closedEarly).toBe(1));
  });

  it('gives a turn up when it takes longer than it was given', async () => {
    const model = await fake({
      kind: 'slow',
      milliseconds: 5_000,
      then: { kind: 'text', text: 'too late' },
    });
    const connection = createLocalModel({
      settings: { baseUrl: model.baseUrl, model: 'scripted' },
      resolve: LOOPBACK,
    });
    expect(await connection.turn(request({ timeoutMilliseconds: 50 }))).toStrictEqual({
      ok: false,
      failure: 'timed-out',
    });
    await vi.waitFor(() => expect(model.closedEarly).toBe(1));
  });
});

describe('local only, on every turn (ADR 0040 D-6, reused from history/address.ts)', () => {
  const OLLAMA = new URL('http://ollama:11434/v1');

  /** A fetch that answers every request with a plain reply, recording where it went. */
  function answeringFetch() {
    const urls: string[] = [];
    const fetch = ((input: string | URL | Request) => {
      urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      return Promise.resolve(
        Response.json({
          id: 'x',
          object: 'chat.completion',
          created: 1,
          model: 'scripted',
          choices: [
            { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    }) as typeof globalThis.fetch;
    return { urls, fetch };
  }

  it('refuses a single-label name that resolves to a public address, sending nothing', async () => {
    const { urls, fetch } = answeringFetch();
    const connection = createLocalModel({
      settings: { baseUrl: OLLAMA, model: 'scripted' },
      resolve: () => Promise.resolve(['93.184.216.34']),
      fetch,
    });
    expect(await connection.turn(request())).toStrictEqual({ ok: false, failure: 'not-local' });
    expect(urls).toStrictEqual([]);
  });

  it('accepts the same name resolving to a private address — the control — and connects to that address', async () => {
    const { urls, fetch } = answeringFetch();
    const connection = createLocalModel({
      settings: { baseUrl: OLLAMA, model: 'scripted' },
      resolve: () => Promise.resolve(['172.30.0.9']),
      fetch,
    });
    const turn = await connection.turn(request());
    expect(turn.ok).toBe(true);
    expect(urls).toStrictEqual(['http://172.30.0.9:11434/v1/chat/completions']);
  });

  it('refuses a name that resolves to nothing', async () => {
    const { urls, fetch } = answeringFetch();
    const connection = createLocalModel({
      settings: { baseUrl: OLLAMA, model: 'scripted' },
      resolve: () => Promise.resolve([]),
      fetch,
    });
    expect(await connection.turn(request())).toStrictEqual({ ok: false, failure: 'unresolved' });
    expect(urls).toStrictEqual([]);
  });
});
