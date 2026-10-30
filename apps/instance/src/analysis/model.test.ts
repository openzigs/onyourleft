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
import {
  createHostedModel,
  createHostedPictureModel,
  createLocalModel,
  createLocalPictureModel,
  GATEWAY_REFUSED,
  GatewayRefusedError,
  pinnedTo,
  saysWithoutPictures,
} from './model.ts';
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

  it('carries the allowance said for the model on a local and a hosted connection (#1268)', () => {
    const local = createLocalModel({
      settings: { baseUrl: new URL('http://127.0.0.1:1/v1'), model: 'm', reasoningTokens: 2_048 },
      resolve: LOOPBACK,
    });
    const hosted = createHostedModel({
      baseUrl: new URL('https://models.example/v1'),
      model: 'm',
      apiKey: 'k',
      reasoningTokens: 4_096,
    });
    expect([local.reasoningTokens, hosted.reasoningTokens]).toStrictEqual([2_048, 4_096]);
    const plain = createLocalModel({
      settings: { baseUrl: new URL('http://127.0.0.1:1/v1'), model: 'm' },
      resolve: LOOPBACK,
    });
    expect(plain).not.toHaveProperty('reasoningTokens');
  });

  it('says a turn reasoned, and for how many tokens, and hands on none of the reasoning (#1268)', async () => {
    const model = await fake({
      kind: 'text',
      text: '',
      finish: 'length',
      usage: { prompt: 120, completion: 1_024 },
      reasoning: { field: 'reasoning_content', text: 'PLANTED-REASONING', tokens: 1_024 },
    });
    const connection = createLocalModel({
      settings: { baseUrl: model.baseUrl, model: 'scripted' },
      resolve: LOOPBACK,
    });
    const turn = await connection.turn(request());
    expect(turn).toStrictEqual({
      ok: true,
      text: '',
      calls: [],
      finish: 'length',
      usage: { inputTokens: 120, outputTokens: 1_024 },
      reasoning: { tokens: 1_024 },
    });
    expect(JSON.stringify(turn)).not.toContain('PLANTED-REASONING');
  });

  it('says a turn reasoned when the server sent reasoning and counted none (Ollama)', async () => {
    const model = await fake({
      kind: 'text',
      text: 'A steady ride.',
      reasoning: { field: 'reasoning', text: 'PLANTED-REASONING' },
    });
    const connection = createLocalModel({
      settings: { baseUrl: model.baseUrl, model: 'scripted' },
      resolve: LOOPBACK,
    });
    const turn = await connection.turn(request());
    expect(turn.ok && turn.reasoning).toStrictEqual({});
    expect(JSON.stringify(turn)).not.toContain('PLANTED-REASONING');
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

describe('the one-host fetch both models send through (#1097’s review)', () => {
  const BASE = 'https://models.example/v1';

  it.each([
    ['another host', 'https://attacker.example/v1/chat/completions'],
    ['a host that only starts like the base', 'https://models.example.attacker.example/v1/chat'],
    ['a path that only starts like the base', 'https://models.example/v1evil/chat/completions'],
    ['the base’s parent', 'https://models.example/'],
  ])('refuses %s without sending', async (_what, url) => {
    const send = vi.fn(() => Promise.resolve(new Response('{}')));
    await expect(pinnedTo(BASE, send)(url, {})).rejects.toThrow(
      'A request left for a host it was not given.',
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('sends a request under the base, and never follows a redirect — the control', async () => {
    const send = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(new Response('{}')));
    await pinnedTo(BASE, send)(`${BASE}/chat/completions`, { method: 'POST' });
    await pinnedTo(BASE, send)(new URL(BASE), {});
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]).toBe(`${BASE}/chat/completions`);
    expect(send.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', redirect: 'error' });
    expect(send.mock.calls[1]?.[1]).toMatchObject({ redirect: 'error' });
  });
});

describe('the hosted model on the instance’s key (#1097)', () => {
  const HOSTED = new URL('https://models.example/v1');
  const KEY = 'sk-hosted-test-key';

  /**
   * A fetch standing in for the internet: it records every URL and the
   * authorization it carried, and answers a request under the hosted base
   * from the fake model server, so a run is seen whole on loopback.
   */
  function hostedFetch(model: FakeModelServer) {
    const seen: { url: string; authorization: string | null }[] = [];
    const base = HOSTED.href.replace(/\/+$/, '');
    const fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      seen.push({ url, authorization: new Headers(init?.headers).get('authorization') });
      if (!url.startsWith(`${base}/`)) return Promise.reject(new Error('another host'));
      return globalThis.fetch(`${model.baseUrl.href}${url.slice(base.length)}`, init);
    }) as typeof globalThis.fetch;
    return { seen, fetch };
  }

  it('refuses an http: URL outright', () => {
    expect(() =>
      createHostedModel({ baseUrl: new URL('http://models.example/v1'), model: 'm', apiKey: KEY }),
    ).toThrow(/https/);
  });

  it('reaches the hosted base and no other host over a run, carrying the key as a bearer token there', async () => {
    const model = await fake(
      { kind: 'tool-calls', calls: [{ name: 'ride_sections', arguments: '{}' }] },
      { kind: 'text', text: 'A steady ride.' },
    );
    const { seen, fetch } = hostedFetch(model);
    const connection = createHostedModel({
      baseUrl: HOSTED,
      model: 'hosted-model',
      apiKey: KEY,
      fetch,
    });
    expect((await connection.turn(request())).ok).toBe(true);
    expect(await connection.turn(request())).toMatchObject({ ok: true, text: 'A steady ride.' });
    expect(seen).toStrictEqual([
      { url: 'https://models.example/v1/chat/completions', authorization: `Bearer ${KEY}` },
      { url: 'https://models.example/v1/chat/completions', authorization: `Bearer ${KEY}` },
    ]);
    expect(model.requests.map((body) => body.model)).toStrictEqual([
      'hosted-model',
      'hosted-model',
    ]);
  });

  it('answers in the same closed failures, never the server’s words', async () => {
    const model = await fake({
      kind: 'status',
      status: 401,
      body: JSON.stringify({ error: { message: `bad key ${KEY}` } }),
    });
    const { fetch } = hostedFetch(model);
    const connection = createHostedModel({ baseUrl: HOSTED, model: 'm', apiKey: KEY, fetch });
    expect(await connection.turn(request())).toStrictEqual({ ok: false, failure: 'refused' });
  });
});

describe('the two picture model builders hold what the text ones hold (#1106)', () => {
  const HOSTED = new URL('https://models.example/v1');
  const QUESTION = { question: 'Where is the rider?', maxOutputTokens: 40 };
  const PICTURE = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

  function look(overrides: Partial<{ timeoutMilliseconds: number; signal: AbortSignal }> = {}) {
    return {
      picture: PICTURE,
      timeoutMilliseconds: 10_000,
      signal: new AbortController().signal,
      ...overrides,
    };
  }

  /** A fetch that records the init of every request, and answers a plain reply. */
  function recording() {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, init });
      return Promise.resolve(
        Response.json({
          id: 'x',
          object: 'chat.completion',
          created: 1,
          model: 'm',
          choices: [
            { index: 0, message: { role: 'assistant', content: 'seen' }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    }) as typeof globalThis.fetch;
    return { calls, fetch };
  }

  it('sends a hosted look through the one-host fetch: refusing a redirect', async () => {
    const { calls, fetch } = recording();
    const connection = createHostedPictureModel({
      baseUrl: HOSTED,
      model: 'm',
      apiKey: 'k',
      question: QUESTION,
      fetch,
    });
    expect(await connection.look(look())).toStrictEqual({ ok: true, text: 'seen' });
    expect(calls.map((call) => call.url)).toStrictEqual([
      'https://models.example/v1/chat/completions',
    ]);
    expect(calls[0]?.init).toMatchObject({ redirect: 'error' });
  });

  it('sends a local look through the one-host fetch: refusing a redirect, to the checked address', async () => {
    const { calls, fetch } = recording();
    const connection = createLocalPictureModel({
      settings: { baseUrl: new URL('http://ollama:11434/v1'), model: 'm' },
      resolve: () => Promise.resolve(['172.30.0.9']),
      question: QUESTION,
      fetch,
    });
    expect(await connection.look(look())).toStrictEqual({ ok: true, text: 'seen' });
    expect(calls.map((call) => call.url)).toStrictEqual([
      'http://172.30.0.9:11434/v1/chat/completions',
    ]);
    expect(calls[0]?.init).toMatchObject({ redirect: 'error' });
  });

  it.each([
    ['a public address', ['93.184.216.34'], 'not-local'],
    ['nothing', [], 'unresolved'],
  ])(
    'answers a local name resolving to %s as a failure, sending nothing',
    async (_w, found, why) => {
      const { calls, fetch } = recording();
      const connection = createLocalPictureModel({
        settings: { baseUrl: new URL('http://ollama:11434/v1'), model: 'm' },
        resolve: () => Promise.resolve(found),
        question: QUESTION,
        fetch,
      });
      expect(await connection.look(look())).toStrictEqual({ ok: false, failure: why });
      expect(calls).toStrictEqual([]);
    },
  );

  it('refuses an http: hosted URL outright', () => {
    expect(() =>
      createHostedPictureModel({
        baseUrl: new URL('http://models.example/v1'),
        model: 'm',
        apiKey: 'k',
        question: QUESTION,
      }),
    ).toThrow(/https/);
  });

  it('gives a look up when it takes longer than it was given', async () => {
    const model = await fake({
      kind: 'slow',
      milliseconds: 5_000,
      then: { kind: 'text', text: 'too late' },
    });
    const connection = createLocalPictureModel({
      settings: { baseUrl: model.baseUrl, model: 'm' },
      resolve: LOOPBACK,
      question: QUESTION,
    });
    expect(await connection.look(look({ timeoutMilliseconds: 50 }))).toStrictEqual({
      ok: false,
      failure: 'timed-out',
    });
  });

  /** A model server's own 400, as Ollama and DeepSeek wrap theirs. */
  const refusal = (message: string): ScriptedReply => ({
    kind: 'status',
    status: 400,
    body: JSON.stringify({ error: { message, type: 'invalid_request_error' } }),
  });

  // The words each server really answered on 2026-10-12 (spike 0025 §8).
  const OLLAMA_WITHOUT_PICTURES =
    'Multimodal data provided, but model does not support multimodal requests.';
  const OLLAMA_BAD_PICTURE = 'Failed to load image or audio file';
  const DEEPSEEK_BAD_PICTURE =
    '.messages[0].image[0]: You have uploaded an unsupported image. Please make sure your image is valid and has one of the following formats: webp, png, jpeg, and gif.';

  it('reads a model that takes no picture as that, and a picture a model could not open as one refusal', async () => {
    const model = await fake(
      refusal(OLLAMA_WITHOUT_PICTURES),
      refusal(OLLAMA_BAD_PICTURE),
      refusal(DEEPSEEK_BAD_PICTURE),
    );
    const connection = createLocalPictureModel({
      settings: { baseUrl: model.baseUrl, model: 'm' },
      resolve: LOOPBACK,
      question: QUESTION,
    });
    expect(await connection.look(look())).toStrictEqual({
      ok: false,
      failure: 'model-without-pictures',
    });
    // These two came from models that DO take pictures, about bytes they could not decode.
    expect(await connection.look(look())).toStrictEqual({ ok: false, failure: 'refused' });
    expect(await connection.look(look())).toStrictEqual({ ok: false, failure: 'refused' });
  });

  it('reads the same words on a status that is not a refusal of the request’s shape as that status, never as a model that takes no picture', async () => {
    const said = JSON.stringify({ error: { message: OLLAMA_WITHOUT_PICTURES } });
    const model = await fake(
      { kind: 'status', status: 503, body: said },
      { kind: 'status', status: 429, body: said },
      { kind: 'status', status: 422, body: said },
    );
    const connection = createLocalPictureModel({
      settings: { baseUrl: model.baseUrl, model: 'm' },
      resolve: LOOPBACK,
      question: QUESTION,
    });
    expect(await connection.look(look())).toStrictEqual({ ok: false, failure: 'server-error' });
    expect(await connection.look(look())).toStrictEqual({ ok: false, failure: 'refused' });
    // The control: the same words on a status that IS one of the three.
    expect(await connection.look(look())).toStrictEqual({
      ok: false,
      failure: 'model-without-pictures',
    });
  });

  it.each([
    'This model does not support image input.',
    'The model does not support images.',
    'Model does not support vision.',
    'image input is not supported - hint: provide a projector',
    'Invalid content type. image_url is only supported by certain models.',
    'unknown variant `image_url`, expected `text`',
    'this model is missing data required for image input',
    'This model doesn’t support images',
    "This model doesn't support images",
    'Models of this family do not support images',
    'x is not a multimodal model',
    'Image inputs are not supported by this model',
    'Vision is not supported for this model',
    // As it arrives, inside a server's JSON.
    '{"error":{"message":"Image inputs are not supported by this model","type":"x"}}',
    `{"error":{"message":"{\\"error\\":{\\"message\\":\\"${OLLAMA_WITHOUT_PICTURES}\\"}}"}}`,
  ])('takes %j to say the model takes no picture', (words) => {
    expect(saysWithoutPictures(words)).toBe(true);
  });

  it.each([
    OLLAMA_BAD_PICTURE,
    DEEPSEEK_BAD_PICTURE,
    'image too large',
    'This model does not support images larger than 20 MB.',
    'The model does not support image format image/webp',
    'does not support images in system messages',
    'image_url is only supported with https or data URLs',
    'webp images are not supported',
    'could not process image',
    'invalid image',
    'The vision service is busy.',
    'max_tokens is too large',
    '',
  ])('does not take %j to say so', (words) => {
    expect(saysWithoutPictures(words)).toBe(false);
  });

  it('adds the rider’s reasoning allowance to the answer bound, on the wire', async () => {
    const model = await fake({ kind: 'text', text: 'a' }, { kind: 'text', text: 'b' });
    const local = createLocalPictureModel({
      settings: { baseUrl: model.baseUrl, model: 'm', reasoningTokens: 2_000 },
      resolve: LOOPBACK,
      question: QUESTION,
    });
    const without = createLocalPictureModel({
      settings: { baseUrl: model.baseUrl, model: 'm' },
      resolve: LOOPBACK,
      question: QUESTION,
    });
    await local.look(look());
    await without.look(look());
    const bounds = model.requests.map(
      (body) => (body as { max_tokens?: number; max_completion_tokens?: number }).max_tokens,
    );
    expect(bounds).toStrictEqual([2_040, 40]);
  });
});
