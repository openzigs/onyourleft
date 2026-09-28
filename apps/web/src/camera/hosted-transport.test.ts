// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The hosted transport: what it sends, where the key goes, what it refuses,
 * and — the owner's ruling, #518 — that a picture cannot reach it, by type, at
 * run time, and by what the modules are able to name.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { stripComments } from '../units/no-inline-units';

import { capturedFrame } from './frame';
import { hostedModelDecision, type HostedModel } from './hosted-model';
import { HOSTED_FAILURE_TEXT, HOSTED_PROMPTS, type HostedRequest } from './hosted-port';
import {
  hostedModelPort,
  hostedRequestBody,
  isQuestionOnly,
  MAXIMUM_HOSTED_ANSWER_TOKENS,
  type HostedSend,
} from './hosted-transport';
import { cleanFrameBytes } from './testing';

const KEY = 'fixture-hosted-key-DO-NOT-LEAK-0123456789';

function saved(address = 'https://models.example.invalid'): HostedModel {
  const model = hostedModelDecision({ address, model: 'a-model', key: KEY }).model;
  if (model === undefined) {
    throw new Error('fixture service refused');
  }
  return model;
}

interface Sent {
  readonly url: string;
  readonly init: RequestInit;
}

function recordingSend(answer: () => Promise<Response> | Response): {
  readonly send: HostedSend;
  readonly sent: Sent[];
} {
  const sent: Sent[] = [];
  return {
    sent,
    send: async (url, init) => {
      sent.push({ url, init });
      return Promise.resolve(answer());
    },
  };
}

function modelReply(content: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });
}

const QUESTION: HostedRequest = { question: 'connection-check' };

/** Every string anywhere inside `value`, and every key. */
function stringsIn(value: unknown, into: string[] = []): string[] {
  if (typeof value === 'string') {
    into.push(value);
  } else if (Array.isArray(value)) {
    for (const each of value) {
      stringsIn(each, into);
    }
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, each] of Object.entries(value)) {
      into.push(key);
      stringsIn(each, into);
    }
  }
  return into;
}

describe('what leaves', () => {
  it('is the model, the fixed prompt, and two limits — and nothing else', () => {
    const body = hostedRequestBody('a-model', QUESTION);
    expect(Object.keys(body).sort()).toStrictEqual(['max_tokens', 'messages', 'model', 'stream']);
    expect(body).toStrictEqual({
      model: 'a-model',
      stream: false,
      max_tokens: MAXIMUM_HOSTED_ANSWER_TOKENS,
      messages: [{ role: 'user', content: HOSTED_PROMPTS['connection-check'] }],
    });
  });

  it('carries no image part and no data: URL anywhere in it', () => {
    const strings = stringsIn(hostedRequestBody('a-model', QUESTION));
    for (const text of strings) {
      expect(text).not.toMatch(/^data:/);
      expect(text).not.toMatch(/image/i);
    }
  });

  it('sends the key in the Authorization header and nowhere else', async () => {
    const { send, sent } = recordingSend(() => modelReply('ready'));
    const port = hostedModelPort(saved(), { send });
    const outcome = await port?.sendHostedQuestion(QUESTION).outcome;
    expect(outcome?.kind).toBe('described');
    expect(sent).toHaveLength(1);
    const [{ url, init }] = sent as [Sent];
    expect(url).toBe('https://models.example.invalid/v1/chat/completions');
    expect(url).not.toContain(KEY);
    expect(init.body as string).not.toContain(KEY);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(init).toMatchObject({
      method: 'POST',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
  });
});

describe('a picture cannot reach it', () => {
  const frame = capturedFrame({
    bytes: cleanFrameBytes(),
    mediaType: 'image/jpeg',
    width: 640,
    height: 480,
  });

  it('does not compile a request that carries a frame', () => {
    const { send } = recordingSend(() => modelReply('ready'));
    const port = hostedModelPort(saved(), { send });
    // The TYPE half. Deleting the excess property turns this directive into
    // `TS2578: Unused '@ts-expect-error'`, which is CLAUDE.md §5's mutation.
    // @ts-expect-error — a hosted request is a question name and nothing else.
    const call = port?.sendHostedQuestion({ question: 'connection-check', frame });
    call?.cancel();
  });

  it('refuses one smuggled past the compiler, before anything is sent', async () => {
    const send = vi.fn<HostedSend>();
    const port = hostedModelPort(saved(), { send });
    const smuggled = { question: 'connection-check', frame } as unknown as HostedRequest;
    expect(isQuestionOnly(smuggled)).toBe(false);
    expect(await port?.sendHostedQuestion(smuggled).outcome).toStrictEqual({
      kind: 'failed',
      failure: 'not-numbers',
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses a question it does not know', async () => {
    const send = vi.fn<HostedSend>();
    const port = hostedModelPort(saved(), { send });
    const unknown = { question: 'describe-the-rider' } as unknown as HostedRequest;
    expect((await port?.sendHostedQuestion(unknown).outcome)?.kind).toBe('failed');
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    'hosted-port.ts',
    'hosted-transport.ts',
    'hosted-model.ts',
    'useHostedCheck.ts',
  ] as const)('%s cannot name a picture', (file) => {
    const source = readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), 'utf8');
    const code = stripComments(source);
    // The imports that would put a frame type or a picture request in reach.
    expect(code).not.toMatch(/from '\.\/(camera-port|frame|analysis-transport|keep)'/);
    expect(code).not.toMatch(/side-link-pictures|side-analysis|pose-/);
    // And the names themselves, whatever they were imported through.
    for (const name of ['CapturedFrame', 'AnalysisRequest', 'askAboutFrame', 'image_url', 'Blob']) {
      expect(code, `${file} names ${name}`).not.toContain(name);
    }
  });
});

describe('when the other end misbehaves', () => {
  it.each([
    [401, 'key-refused'],
    [403, 'key-refused'],
    [400, 'request-refused'],
    [404, 'request-refused'],
    [422, 'request-refused'],
    [405, 'not-a-model-service'],
    [429, 'over-limit'],
    [500, 'failed-on-service'],
    [413, 'failed-on-service'],
  ] as const)('reads a %i as %s', async (status, failure) => {
    const { send } = recordingSend(() => modelReply('ready', status));
    const outcome = await hostedModelPort(saved(), { send })?.sendHostedQuestion(QUESTION).outcome;
    expect(outcome).toStrictEqual({ kind: 'failed', failure });
  });

  it('reads a reply that is not a model’s as malformed', async () => {
    const { send } = recordingSend(() => new Response('{"hello":1}', { status: 200 }));
    const outcome = await hostedModelPort(saved(), { send })?.sendHostedQuestion(QUESTION).outcome;
    expect(outcome).toStrictEqual({ kind: 'failed', failure: 'malformed' });
  });

  it('puts nothing of a rejection in the outcome — its message may quote the key', async () => {
    const send: HostedSend = () => Promise.reject(new Error(`refused Bearer ${KEY}`));
    const outcome = await hostedModelPort(saved(), { send })?.sendHostedQuestion(QUESTION).outcome;
    expect(outcome).toStrictEqual({ kind: 'failed', failure: 'unreachable' });
    expect(JSON.stringify(outcome)).not.toContain(KEY);
  });

  it('is cancelled, and aborts the request', async () => {
    let signal: AbortSignal | undefined;
    const send: HostedSend = (_url, init) => {
      signal = init.signal ?? undefined;
      return new Promise(() => undefined);
    };
    const call = hostedModelPort(saved(), { send })?.sendHostedQuestion(QUESTION);
    call?.cancel();
    call?.cancel();
    expect(await call?.outcome).toStrictEqual({ kind: 'failed', failure: 'cancelled' });
    expect(signal?.aborted).toBe(true);
  });

  it('never carries a key, an address or the service’s words in a failure sentence', () => {
    for (const text of Object.values(HOSTED_FAILURE_TEXT)) {
      expect(text).not.toContain(KEY);
      expect(text).not.toContain('example.invalid');
    }
  });
});

describe('no port', () => {
  it('for nothing saved', () => {
    expect(hostedModelPort(undefined)).toBeUndefined();
  });

  it('for a hand-built service that the rules would refuse', () => {
    const send = vi.fn<HostedSend>();
    expect(
      hostedModelPort({ address: 'http://models.example.invalid', model: 'm', key: KEY }, { send }),
    ).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });
});
