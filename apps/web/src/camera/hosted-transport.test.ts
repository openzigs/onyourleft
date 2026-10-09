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
  hostedFinishOf,
  hostedModelPort,
  hostedRequestBody,
  isBuiltRequest,
  MAXIMUM_HOSTED_ANSWER_TOKENS,
  type HostedSend,
} from './hosted-transport';
import { cleanFrameBytes } from './testing';
import type { StepRequest } from '@onyourleft/analysis';
import type { SealedStep } from '@onyourleft/analysis';
import { sealStep } from '@onyourleft/analysis/testing';
import { PLANTED_GUARD, patternsOnlyGuard } from '@onyourleft/analysis/testing';
import { PATTERNS_ONLY, type MaskingGuard } from '@onyourleft/analysis';

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

function modelReply(content: string, status = 200, finish?: string): Response {
  return new Response(
    JSON.stringify({
      choices: [
        { message: { content }, ...(finish === undefined ? {} : { finish_reason: finish }) },
      ],
    }),
    { status },
  );
}

/** A step as the runner builds one, before it is sealed. */
const STEP: StepRequest = {
  kind: 'section',
  system: 'You describe one section of a bicycle ride from its numbers.',
  user: '{"section":1,"kind":"climb","seconds":600,"power":{"mean":210}}',
  replySchema: { name: 'section_note', schema: { type: 'object' } },
  maximumTokens: 200,
  temperature: 0.1,
};

/** A sealed step — what only the runner makes in production. */
function sealed(overrides: Partial<StepRequest> = {}): SealedStep {
  return sealStep({ ...STEP, ...overrides });
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
    const body = hostedRequestBody('a-model', QUESTION, PATTERNS_ONLY);
    expect(Object.keys(body).sort()).toStrictEqual(['max_tokens', 'messages', 'model', 'stream']);
    expect(body).toStrictEqual({
      model: 'a-model',
      stream: false,
      max_tokens: MAXIMUM_HOSTED_ANSWER_TOKENS,
      messages: [{ role: 'user', content: HOSTED_PROMPTS['connection-check'] }],
    });
  });

  it('carries no image part and no data: URL anywhere in it', () => {
    const strings = stringsIn(hostedRequestBody('a-model', QUESTION, PATTERNS_ONLY));
    for (const text of strings) {
      expect(text).not.toMatch(/^data:/);
      expect(text).not.toMatch(/image/i);
    }
  });

  it('sends the key in the Authorization header and nowhere else', async () => {
    const { send, sent } = recordingSend(() => modelReply('ready'));
    const port = hostedModelPort(saved(), { guard: patternsOnlyGuard, send });
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
    const port = hostedModelPort(saved(), { guard: patternsOnlyGuard, send });
    // The TYPE half. Deleting the excess property turns this directive into
    // `TS2578: Unused '@ts-expect-error'`, which is docs/agents/quality-gate.md §5's mutation.
    // @ts-expect-error — a hosted request is a question name and nothing else.
    const call = port?.sendHostedQuestion({ question: 'connection-check', frame });
    call?.cancel();
  });

  it('refuses one smuggled past the compiler, before anything is sent', async () => {
    const send = vi.fn<HostedSend>();
    const port = hostedModelPort(saved(), { guard: patternsOnlyGuard, send });
    const smuggled = { question: 'connection-check', frame } as unknown as HostedRequest;
    expect(isBuiltRequest(smuggled)).toBe(false);
    expect(await port?.sendHostedQuestion(smuggled).outcome).toStrictEqual({
      kind: 'failed',
      failure: 'not-numbers',
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses a question it does not know', async () => {
    const send = vi.fn<HostedSend>();
    const port = hostedModelPort(saved(), { guard: patternsOnlyGuard, send });
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
    const outcome = await hostedModelPort(saved(), {
      guard: patternsOnlyGuard,
      send,
    })?.sendHostedQuestion(QUESTION).outcome;
    expect(outcome).toStrictEqual({ kind: 'failed', failure });
  });

  it('reads a reply that is not a model’s as malformed', async () => {
    const { send } = recordingSend(() => new Response('{"hello":1}', { status: 200 }));
    const outcome = await hostedModelPort(saved(), {
      guard: patternsOnlyGuard,
      send,
    })?.sendHostedQuestion(QUESTION).outcome;
    expect(outcome).toStrictEqual({ kind: 'failed', failure: 'malformed' });
  });

  it('puts nothing of a rejection in the outcome — its message may quote the key', async () => {
    const send: HostedSend = () => Promise.reject(new Error(`refused Bearer ${KEY}`));
    const outcome = await hostedModelPort(saved(), {
      guard: patternsOnlyGuard,
      send,
    })?.sendHostedQuestion(QUESTION).outcome;
    expect(outcome).toStrictEqual({ kind: 'failed', failure: 'unreachable' });
    expect(JSON.stringify(outcome)).not.toContain(KEY);
  });

  it('is cancelled, and aborts the request', async () => {
    let signal: AbortSignal | undefined;
    const send: HostedSend = (_url, init) => {
      signal = init.signal ?? undefined;
      return new Promise(() => undefined);
    };
    const call = hostedModelPort(saved(), { guard: patternsOnlyGuard, send })?.sendHostedQuestion(
      QUESTION,
    );
    // Sent once the rider's guard has been read (#839).
    await vi.waitFor(() => {
      expect(signal).toBeDefined();
    });
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
    expect(hostedModelPort(undefined, { guard: patternsOnlyGuard })).toBeUndefined();
  });

  it('for a hand-built service that the rules would refuse', () => {
    const send = vi.fn<HostedSend>();
    expect(
      hostedModelPort(
        { address: 'http://models.example.invalid', model: 'm', key: KEY },
        { guard: patternsOnlyGuard, send },
      ),
    ).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });
});

describe('a step of the ride analysis (#803)', () => {
  it('sends the step’s two prompts, its own limits and nothing else — no response_format hint', () => {
    const step = sealed();
    const body = hostedRequestBody('a-model', { step }, PATTERNS_ONLY);
    expect(Object.keys(body).sort()).toStrictEqual([
      'max_tokens',
      'messages',
      'model',
      'stream',
      'temperature',
    ]);
    expect(body).toStrictEqual({
      model: 'a-model',
      stream: false,
      max_tokens: 200,
      temperature: 0.1,
      messages: [
        { role: 'system', content: STEP.system },
        { role: 'user', content: STEP.user },
      ],
    });
  });

  it('sends one request per step, with the key in the header and the step in the body', async () => {
    const { send, sent } = recordingSend(() => modelReply('{"section":1}', 200, 'stop'));
    const outcome = await hostedModelPort(saved(), {
      guard: patternsOnlyGuard,
      send,
    })?.sendHostedQuestion({
      step: sealed(),
    }).outcome;
    expect(outcome).toStrictEqual({
      kind: 'described',
      description: '{"section":1}',
      finish: 'stop',
    });
    expect(sent).toHaveLength(1);
    const [{ init }] = sent as [Sent];
    expect(JSON.parse(init.body as string)).toStrictEqual(
      hostedRequestBody('a-model', { step: sealed() }, PATTERNS_ONLY),
    );
    expect(init.body as string).not.toContain(KEY);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(init).toMatchObject({ redirect: 'error', credentials: 'omit', cache: 'no-store' });
  });

  it.each([
    ['stop', 'stop'],
    ['length', 'length'],
    ['content_filter', 'other'],
  ] as const)('reads a finish_reason of %s as %s', async (reason, finish) => {
    const { send } = recordingSend(() => modelReply('A steady ride.', 200, reason));
    const outcome = await hostedModelPort(saved(), {
      guard: patternsOnlyGuard,
      send,
    })?.sendHostedQuestion({
      step: sealed(),
    }).outcome;
    expect(outcome).toMatchObject({ kind: 'described', finish });
  });

  it('reads no finish_reason, or a body that is not JSON, as other', () => {
    expect(hostedFinishOf('{"choices":[{"message":{"content":"x"}}]}')).toBe('other');
    expect(hostedFinishOf('not json')).toBe('other');
    expect(hostedFinishOf('null')).toBe('other');
  });

  it('aborts the fetch itself when a step is cancelled', async () => {
    let signal: AbortSignal | undefined;
    const send: HostedSend = (_url, init) => {
      signal = init.signal ?? undefined;
      return new Promise(() => undefined);
    };
    const call = hostedModelPort(saved(), { guard: patternsOnlyGuard, send })?.sendHostedQuestion({
      step: sealed(),
    });
    await vi.waitFor(() => {
      expect(signal).toBeDefined();
    });
    expect(signal?.aborted).toBe(false);
    call?.cancel();
    expect(await call?.outcome).toStrictEqual({ kind: 'failed', failure: 'cancelled' });
    expect(signal?.aborted).toBe(true);
  });
});

describe('only a step the runner sealed is sent (#803)', () => {
  const frame = capturedFrame({
    bytes: cleanFrameBytes(),
    mediaType: 'image/jpeg',
    width: 640,
    height: 480,
  });

  it('does not compile a step the caller wrote, or a picture of any kind in its place', () => {
    const { send } = recordingSend(() => modelReply('ready'));
    const port = hostedModelPort(saved(), { guard: patternsOnlyGuard, send });
    const pictures = {
      bytes: new Uint8Array(4),
      blob: new globalThis.Blob([new Uint8Array(4)]),
      bitmap: undefined as unknown as ImageBitmap,
      data: undefined as unknown as ImageData,
    };
    // The TYPE half. Each directive goes `TS2578: Unused '@ts-expect-error'`
    // if `HostedRequest` stops taking only a sealed step (docs/agents/quality-gate.md §5).
    // @ts-expect-error — a step the caller wrote is not a sealed step.
    port?.sendHostedQuestion({ step: STEP }).cancel();
    // @ts-expect-error — nor is a caller's own string.
    port?.sendHostedQuestion({ step: 'describe the rider in this picture' }).cancel();
    // @ts-expect-error — a frame has nowhere to go.
    port?.sendHostedQuestion({ step: frame }).cancel();
    // @ts-expect-error — nor a Blob.
    port?.sendHostedQuestion({ step: pictures.blob }).cancel();
    // @ts-expect-error — nor an ImageBitmap.
    port?.sendHostedQuestion({ step: pictures.bitmap }).cancel();
    // @ts-expect-error — nor an ImageData.
    port?.sendHostedQuestion({ step: pictures.data }).cancel();
    // @ts-expect-error — nor a frame beside a sealed step.
    port?.sendHostedQuestion({ step: sealed(), frame }).cancel();
    expect(pictures.bytes).toHaveLength(4);
  });

  it.each([
    ['a look-alike step nobody sealed', () => ({ step: { ...STEP } })],
    ['a copy of a sealed step', () => ({ step: { ...sealed() } })],
    ['a sealed step with a frame beside it', () => ({ step: sealed(), frame })],
    ['a frame in place of the step', () => ({ step: frame })],
    ['a question and a step together', () => ({ question: 'connection-check', step: sealed() })],
    ['nothing at all', () => ({})],
    [
      'a sealed step whose text carries a data: URL',
      () => ({
        step: sealed({ user: 'data:image/jpeg;base64,/9j/4AAQ' }),
      }),
    ],
    [
      'a sealed step whose reply schema carries bytes',
      () => ({
        step: sealed({
          replySchema: { name: 'x', schema: { bytes: new Uint8Array(4) } },
        }),
      }),
    ],
  ] as const)('refuses %s before anything is sent', async (_name, build) => {
    const send = vi.fn<HostedSend>();
    const port = hostedModelPort(saved(), { guard: patternsOnlyGuard, send });
    const smuggled = build() as unknown as HostedRequest;
    expect(isBuiltRequest(smuggled)).toBe(false);
    expect(await port?.sendHostedQuestion(smuggled).outcome).toStrictEqual({
      kind: 'failed',
      failure: 'not-numbers',
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('accepts a sealed step, and the connection check, and nothing it has not been shown', () => {
    expect(isBuiltRequest({ step: sealed() })).toBe(true);
    expect(isBuiltRequest({ question: 'connection-check' })).toBe(true);
    expect(isBuiltRequest(null as unknown as HostedRequest)).toBe(false);
  });

  it('cannot change a sealed step’s text after it was sealed', () => {
    const step = sealed();
    expect(() => {
      (step as { user: string }).user = 'data:image/png;base64,AAAA';
    }).toThrow(TypeError);
    expect(step.user).toBe(STEP.user);
  });
});

describe('every hosted body is masked with the rider’s guard (#839)', () => {
  it('masks a step’s two prompts, and a real guard’s words and zones with them', () => {
    const step = sealed({
      system: 'Write to priya@example.com about Kestrel Farm.',
      user: 'Rode from Oakbrook past 12 Acacia Avenue.',
    });
    const body = hostedRequestBody('a-model', { step }, PLANTED_GUARD);
    expect(body.messages).toStrictEqual([
      { role: 'system', content: 'Write to [email] about [masked].' },
      { role: 'user', content: 'Rode from [place] past [address].' },
    ]);
    // The model name is the rider's own setting and is sent as typed.
    expect(hostedRequestBody('Kestrel Farm', { step }, PLANTED_GUARD).model).toBe('Kestrel Farm');
  });

  it('sends the masked body it built, read with the guard for that request', async () => {
    const { send, sent } = recordingSend(() => modelReply('ok', 200, 'stop'));
    const guard = vi.fn(async () => Promise.resolve(PLANTED_GUARD));
    const step = sealed({ user: 'Home is Kestrel Farm.' });
    await hostedModelPort(saved(), { guard, send })?.sendHostedQuestion({ step }).outcome;
    expect(guard).toHaveBeenCalledTimes(1);
    const [{ init }] = sent as [Sent];
    expect(init.body as string).not.toContain('Kestrel');
    expect(JSON.parse(init.body as string)).toStrictEqual(
      hostedRequestBody('a-model', { step }, PLANTED_GUARD),
    );
  });

  it('sends nothing when the guard cannot be read, and says so', async () => {
    const send = vi.fn<HostedSend>();
    const outcome = await hostedModelPort(saved(), {
      guard: async () => Promise.reject(new Error('the store is blocked')),
      send,
    })?.sendHostedQuestion({ step: sealed() }).outcome;
    expect(outcome).toStrictEqual({ kind: 'failed', failure: 'not-masked' });
    expect(send).not.toHaveBeenCalled();
    expect(HOSTED_FAILURE_TEXT['not-masked']).toContain('nothing was sent');
  });

  it('sends nothing when cancelled while the guard is being read', async () => {
    const send = vi.fn<HostedSend>();
    let release: (guard: MaskingGuard) => void = () => undefined;
    const call = hostedModelPort(saved(), {
      guard: async () =>
        new Promise<MaskingGuard>((resolve) => {
          release = resolve;
        }),
      send,
    })?.sendHostedQuestion({ step: sealed() });
    call?.cancel();
    release(PATTERNS_ONLY);
    expect(await call?.outcome).toStrictEqual({ kind: 'failed', failure: 'cancelled' });
    await Promise.resolve();
    expect(send).not.toHaveBeenCalled();
  });
});
