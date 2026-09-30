// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ride analysis's step port to the rider's own computer — #802. What it
 * sends, what it refuses to send, how it reads a reply's end, how a cancel
 * reaches the request, and that a pose summary goes only with camera consent.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { kilograms, metres, seconds, watts } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { endpointDecision, type AnalysisEndpoint } from '../camera/analysis-endpoint';
import { MAXIMUM_RESPONSE_BYTES } from '../camera/analysis-response';
import {
  riderModelStepPort,
  type AnalysisSend,
  type NativeAnalysisPost,
  type NativeAnalysisRequest,
} from '../camera/analysis-transport';
import { capturedFrame } from '../camera/frame';
import type { SideSessionSummary } from '../camera/side-session-summary';
import { cleanFrameBytes } from '../camera/testing';
import { stripComments } from '../units/no-inline-units';
import { rideAnalysisInput, type RideAnalysisInput } from './input';
import type { ModelStepPort, StepReply, StepRequest } from './model-step-port';
import {
  finishOf,
  HINT_REFUSED_STATUSES,
  isTextOnlyStep,
  ownComputerStepPort,
  STEP_REQUEST_FIELDS,
  stepRequestBody,
} from './own-computer-step';
import { runAnalysis, type RunnerClock } from './runner';

// --- Fixtures -------------------------------------------------------------------

function endpoint(address = 'http://192.168.1.20:8080', switchedOn = true): AnalysisEndpoint {
  const decision = endpointDecision({ address, model: 'text-7b', switchedOn });
  if (decision.endpoint === undefined) {
    throw new Error(`fixture endpoint refused: ${String(decision.refusal)}`);
  }
  return decision.endpoint;
}

const STEP: StepRequest = {
  kind: 'section',
  system: 'You read a ride’s numbers.',
  user: 'Section 1: 20 minutes, power 190 W.',
  replySchema: { name: 'section_note', schema: { type: 'object', required: ['section'] } },
  maximumTokens: 400,
  temperature: 0.1,
};

const SUMMARY_STEP: StepRequest = {
  kind: 'summary',
  system: 'You write a short summary.',
  user: 'The ride was 62 minutes.',
  maximumTokens: 1024,
  temperature: 0.2,
};

interface Sent {
  readonly url: string;
  readonly init: RequestInit & { readonly targetAddressSpace?: string };
}

/** A model server's reply. `'absent'` leaves `finish_reason` out altogether. */
function reply(content: string, finish: unknown = 'stop', status = 200): Response {
  const choice =
    finish === 'absent'
      ? { message: { content } }
      : { message: { content }, finish_reason: finish };
  return new Response(JSON.stringify({ choices: [choice] }), { status });
}

/** A send that records what it was handed and answers with `answer`. */
function recordingSend(
  answer: (init: RequestInit) => Promise<Response> | Response = () => reply('ok'),
): { readonly send: AnalysisSend; readonly sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    send: async (url, init) => {
      sent.push({ url, init });
      return answer(init);
    },
  };
}

function portWith(send: AnalysisSend): ModelStepPort {
  const port = riderModelStepPort(endpoint(), { send });
  if (port === undefined) {
    throw new Error('no port');
  }
  return port;
}

const live = (): AbortSignal => new AbortController().signal;

/** A clock whose waits never elapse: every step here is settled by the port. */
const STILL_CLOCK: RunnerClock = {
  now: () => 0,
  delay: () => ({ elapsed: new Promise<void>(() => undefined), cancel: () => undefined }),
};

/** A request's body, which this port always sends as a string of JSON. */
function bodyText(init: RequestInit): string {
  return typeof init.body === 'string' ? init.body : '';
}

function bodyOf(sent: Sent): Record<string, unknown> {
  return JSON.parse(bodyText(sent.init)) as Record<string, unknown>;
}

// --- The port exists only when something is switched on -------------------------

describe('with nothing switched on there is no port', () => {
  it('builds none from no endpoint, one switched off, or a hand-built public one', () => {
    const { send, sent } = recordingSend();
    expect(riderModelStepPort(undefined, { send })).toBeUndefined();
    expect(riderModelStepPort(endpoint('http://192.168.1.20', false), { send })).toBeUndefined();
    const forged: AnalysisEndpoint = {
      address: 'https://api.example.com',
      model: 'm',
      switchedOn: true,
    };
    expect(riderModelStepPort(forged, { send })).toBeUndefined();
    expect(sent).toStrictEqual([]);
  });
});

// --- What is sent ---------------------------------------------------------------

describe('the body (#802)', () => {
  it('is pinned by its key set, with the schema hint only on a JSON step', () => {
    expect(Object.keys(stepRequestBody('m', STEP)).sort()).toStrictEqual(
      ['max_tokens', 'messages', 'model', 'response_format', 'stream', 'temperature'].sort(),
    );
    expect(Object.keys(stepRequestBody('m', SUMMARY_STEP)).sort()).toStrictEqual(
      ['max_tokens', 'messages', 'model', 'stream', 'temperature'].sort(),
    );
  });

  it('carries the prompts as text, the step’s own bounds, and the schema as a hint', () => {
    expect(stepRequestBody('text-7b', STEP)).toStrictEqual({
      model: 'text-7b',
      stream: false,
      max_tokens: 400,
      temperature: 0.1,
      messages: [
        { role: 'system', content: STEP.system },
        { role: 'user', content: STEP.user },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'section_note', schema: STEP.replySchema?.schema },
      },
    });
  });

  it('goes to the address the rider typed, by POST, and says as little as the platform allows', async () => {
    const { send, sent } = recordingSend();
    await portWith(send).runModelStep(STEP, live());
    expect(sent).toHaveLength(1);
    const [only] = sent;
    expect(only?.url).toBe('http://192.168.1.20:8080/v1/chat/completions');
    expect(only?.init).toMatchObject({
      method: 'POST',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      targetAddressSpace: 'local',
    });
    expect(bodyOf(only as Sent)).toStrictEqual(stepRequestBody('text-7b', STEP));
  });
});

// --- Never a frame --------------------------------------------------------------

describe('a step cannot carry a frame (#802)', () => {
  const frame = capturedFrame({
    bytes: cleanFrameBytes(),
    mediaType: 'image/jpeg',
    width: 640,
    height: 480,
  });

  it('by type', () => {
    const smuggled: StepRequest = {
      ...STEP,
      // @ts-expect-error — a step request has no field that can hold a picture.
      frame,
    };
    expect(isTextOnlyStep(smuggled)).toBe(false);
  });

  it('declares exactly the fields the refusal allows', () => {
    expect([...STEP_REQUEST_FIELDS].sort()).toStrictEqual(
      ['kind', 'maximumTokens', 'replySchema', 'system', 'temperature', 'user'].sort(),
    );
  });

  it.each([
    ['a frame field', { ...STEP, frame }],
    ['a byte array under another name', { ...STEP, attachment: cleanFrameBytes() }],
    ['a data URL in the prompt', { ...STEP, user: 'The ride: data:image/jpeg;base64,/9j/4AAQ' }],
    [
      'a byte array inside the schema hint',
      { ...STEP, replySchema: { name: 'x', schema: { pixels: cleanFrameBytes() } } },
    ],
    ['a frame inside the schema hint', { ...STEP, replySchema: { name: 'x', schema: { frame } } }],
    ['a field beside the schema', { ...STEP, replySchema: { name: 'x', schema: {}, frame } }],
    ['a step kind it does not know', { ...STEP, kind: 'side-pose' }],
    ['no prompt', { ...STEP, user: undefined }],
    ['a token bound that is not a whole number', { ...STEP, maximumTokens: 1.5 }],
    ['a schema hint that is not an object', { ...STEP, replySchema: 'a picture' }],
    ['a step that is not a plain object', Object.assign(new (class Step {})(), STEP)],
    [
      'a schema hint nested past any schema’s depth',
      {
        ...STEP,
        replySchema: {
          name: 'x',
          schema: Array.from({ length: 40 }).reduce<object>((inner) => ({ inner }), {}),
        },
      },
    ],
  ])('refuses %s before anything is sent, as not-numbers', async (_what, step) => {
    const { send, sent } = recordingSend();
    const nativeCalls: NativeAnalysisRequest[] = [];
    const native: NativeAnalysisPost = async (request) => {
      nativeCalls.push(request);
      return Promise.resolve({ status: 200, body: '' });
    };
    const shell = riderModelStepPort(endpoint(), { send, native });
    for (const port of [portWith(send), shell]) {
      expect(await port?.runModelStep(step as unknown as StepRequest, live())).toStrictEqual({
        kind: 'failed',
        failure: 'not-numbers',
      });
    }
    expect(sent).toStrictEqual([]);
    expect(nativeCalls).toStrictEqual([]);
  });

  it('passes a step the runner really builds', () => {
    expect(isTextOnlyStep(STEP)).toBe(true);
    expect(isTextOnlyStep(SUMMARY_STEP)).toBe(true);
  });
});

// --- The reply ------------------------------------------------------------------

describe('how a reply ended (#802)', () => {
  it.each([
    ['stop', 'stop'],
    ['length', 'length'],
    ['tool_calls', 'other'],
    [null, 'other'],
    ['absent', 'other'],
  ] as const)('reads finish_reason %s as %s', async (finish, expected) => {
    const { send } = recordingSend(() => reply('A steady ride.', finish));
    expect(await portWith(send).runModelStep(SUMMARY_STEP, live())).toStrictEqual({
      kind: 'answered',
      text: 'A steady ride.',
      finish: expected,
    });
  });

  it('does not report a length finish as stop, and the runner keeps nothing from it', async () => {
    // Every reply is cut off. A port that reported `stop` would let the
    // runner write a summary from half an answer.
    const { send } = recordingSend(() => reply('A steady ride, evenly', 'length'));
    const outcome = await runAnalysis(rideWithNoSections(), {
      port: portWith(send),
      clock: STILL_CLOCK,
      signal: live(),
    });
    expect(outcome).toStrictEqual({ kind: 'failed', why: 'no-summary' });
  });

  it('reads nothing of a body that is not JSON', () => {
    expect(finishOf('not json')).toBe('other');
    expect(finishOf('{"choices":[]}')).toBe('other');
  });

  it.each([
    [
      '413, a prompt too large for the server',
      () => new Response('', { status: 413 }),
      'failed-on-machine',
    ],
    ['401', () => new Response('', { status: 401 }), 'refused'],
    [
      'a rejected request',
      () => Promise.reject(new Error('http://192.168.1.20 down')),
      'unreachable',
    ],
    [
      'a body past the limit',
      () => new Response('x'.repeat(MAXIMUM_RESPONSE_BYTES + 1), { status: 200 }),
      'too-large',
    ],
  ] as const)('names %s as a failure', async (_what, answer, failure) => {
    const { send } = recordingSend(answer);
    expect(await portWith(send).runModelStep(SUMMARY_STEP, live())).toStrictEqual({
      kind: 'failed',
      failure,
    });
  });
});

// --- Cancelling -----------------------------------------------------------------

/** A send that never answers until its signal aborts, then rejects as `fetch` does. */
function hangingSend(): { readonly send: AnalysisSend; readonly sent: Sent[] } {
  return recordingSend(
    async (init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      }),
  );
}

describe('a server that refuses the response_format hint (#804, from #828’s review)', () => {
  it.each([400, 422])(
    'asks once more without the hint after a %i, and reads that reply',
    async (status) => {
      const { send, sent } = recordingSend((init) =>
        bodyText(init).includes('response_format')
          ? new Response('{"error":"unknown field"}', { status })
          : reply('{"section":1,"notes":"Steady."}'),
      );
      const answer = await portWith(send).runModelStep(STEP, live());
      expect(answer).toStrictEqual({
        kind: 'answered',
        text: '{"section":1,"notes":"Steady."}',
        finish: 'stop',
      });
      expect(sent).toHaveLength(2);
      expect(bodyOf(sent[0] as Sent)).toHaveProperty('response_format');
      const retried = bodyOf(sent[1] as Sent);
      expect(retried).not.toHaveProperty('response_format');
      // Otherwise the same request.
      const first = bodyOf(sent[0] as Sent);
      delete first.response_format;
      expect(retried).toStrictEqual(first);
    },
  );

  it('asks only once more, and reads a second refusal as the failure it is', async () => {
    const { send, sent } = recordingSend(() => new Response('', { status: 400 }));
    const answer = await portWith(send).runModelStep(STEP, live());
    expect(sent).toHaveLength(2);
    expect(answer.kind).toBe('failed');
  });

  it('does not retry a step that carried no hint, or a status that is not a refusal of it', async () => {
    const refused = recordingSend(() => new Response('', { status: 400 }));
    await portWith(refused.send).runModelStep(SUMMARY_STEP, live());
    expect(refused.sent).toHaveLength(1);
    const broken = recordingSend(() => new Response('', { status: 500 }));
    await portWith(broken.send).runModelStep(STEP, live());
    expect(broken.sent).toHaveLength(1);
    expect(HINT_REFUSED_STATUSES).toStrictEqual([400, 422]);
  });

  it('does the same inside the Android shell', async () => {
    const requests: NativeAnalysisRequest[] = [];
    const native: NativeAnalysisPost = async (request) => {
      requests.push(request);
      return Promise.resolve(
        'response_format' in request.json
          ? { status: 422, body: '' }
          : {
              status: 200,
              body: JSON.stringify({
                choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
              }),
            },
      );
    };
    const answer = await riderModelStepPort(endpoint(), { native })?.runModelStep(STEP, live());
    expect(answer).toStrictEqual({ kind: 'answered', text: 'ok', finish: 'stop' });
    expect(requests).toHaveLength(2);
    expect(requests[1]?.json).not.toHaveProperty('response_format');
  });

  it('remembers a refusal: the next structured step on the same port goes without the hint (#805)', async () => {
    const { send, sent } = recordingSend((init) =>
      bodyText(init).includes('response_format')
        ? new Response('{"error":"unknown field response_format"}', { status: 400 })
        : reply('{"section":1,"notes":"Steady."}'),
    );
    const port = portWith(send);
    await port.runModelStep(STEP, live());
    expect(sent).toHaveLength(2);
    const answer = await port.runModelStep(STEP, live());
    expect(answer.kind).toBe('answered');
    // One request, not two: the hint is not offered again.
    expect(sent).toHaveLength(3);
    expect(bodyOf(sent[2] as Sent)).not.toHaveProperty('response_format');
    // A different port has not been refused, and still offers it.
    const fresh = recordingSend(() => reply('{"section":1,"notes":"Steady."}'));
    await portWith(fresh.send).runModelStep(STEP, live());
    expect(bodyOf(fresh.sent[0] as Sent)).toHaveProperty('response_format');
  });

  it('retries, and does NOT remember, a 400 whose body does not name the hint (#816)', async () => {
    // A 400 for another reason that clears on the retry says nothing about
    // the hint; remembering it would drop the hint for the port's whole life.
    let calls = 0;
    const { send, sent } = recordingSend(() => {
      calls += 1;
      return calls === 1
        ? new Response('{"error":"model is loading"}', { status: 400 })
        : reply('{"section":1,"notes":"Steady."}');
    });
    const port = portWith(send);
    expect((await port.runModelStep(STEP, live())).kind).toBe('answered');
    expect(sent).toHaveLength(2);
    await port.runModelStep(STEP, live());
    expect(sent).toHaveLength(3);
    expect(bodyOf(sent[2] as Sent)).toHaveProperty('response_format');
  });

  it.each(['response_format', 'JSON_SCHEMA'])(
    'remembers a refusal whose body names the hint as %s',
    async (named) => {
      const { send, sent } = recordingSend((init) =>
        bodyText(init).includes('response_format')
          ? new Response(`{"error":"unsupported: ${named}"}`, { status: 422 })
          : reply('{"section":1,"notes":"Steady."}'),
      );
      const port = portWith(send);
      await port.runModelStep(STEP, live());
      await port.runModelStep(STEP, live());
      expect(sent).toHaveLength(3);
    },
  );

  it('does not remember a refusal when the unhinted request failed as well', async () => {
    const { send, sent } = recordingSend(() => new Response('', { status: 400 }));
    const port = portWith(send);
    await port.runModelStep(STEP, live());
    await port.runModelStep(STEP, live());
    expect(sent).toHaveLength(4);
    expect(bodyOf(sent[2] as Sent)).toHaveProperty('response_format');
  });

  it('remembers a refusal inside the Android shell too', async () => {
    const requests: NativeAnalysisRequest[] = [];
    const native: NativeAnalysisPost = async (request) => {
      requests.push(request);
      return Promise.resolve(
        'response_format' in request.json
          ? { status: 422, body: '{"detail":"response_format is not supported"}' }
          : {
              status: 200,
              body: JSON.stringify({
                choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
              }),
            },
      );
    };
    const port = riderModelStepPort(endpoint(), { native });
    await port?.runModelStep(STEP, live());
    await port?.runModelStep(STEP, live());
    expect(requests).toHaveLength(3);
    expect(requests[2]?.json).not.toHaveProperty('response_format');
  });

  it('does not retry once the step was cancelled', async () => {
    const cancel = new AbortController();
    const { send, sent } = recordingSend(() => {
      cancel.abort();
      return new Response('', { status: 400 });
    });
    await portWith(send).runModelStep(STEP, cancel.signal);
    expect(sent).toHaveLength(1);
  });
});

describe('cancelling (#802)', () => {
  it('in a browser, hands the runner’s signal to the request itself', async () => {
    const { send, sent } = hangingSend();
    const abort = new AbortController();
    const step = portWith(send).runModelStep(SUMMARY_STEP, abort.signal);
    await Promise.resolve();
    expect(sent[0]?.init.signal).toBe(abort.signal);
    abort.abort();
    expect(await step).toStrictEqual({ kind: 'failed', failure: 'cancelled' });
  });

  it('aborts the request when the RUN is cancelled, through the runner', async () => {
    const { send, sent } = hangingSend();
    const run = new AbortController();
    const outcome = runAnalysis(rideWithNoSections(), {
      port: portWith(send),
      clock: STILL_CLOCK,
      signal: run.signal,
    });
    await Promise.resolve();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.init.signal?.aborted).toBe(false);
    run.abort();
    expect(await outcome).toStrictEqual({ kind: 'failed', why: 'cancelled' });
    expect(sent[0]?.init.signal?.aborted).toBe(true);
  });

  it('sends nothing for a step whose signal has already aborted', async () => {
    const { send, sent } = recordingSend();
    expect(await portWith(send).runModelStep(SUMMARY_STEP, AbortSignal.abort())).toStrictEqual({
      kind: 'failed',
      failure: 'cancelled',
    });
    expect(sent).toStrictEqual([]);
  });

  it('in the shell, abandons the step at once and discards the late answer', async () => {
    let answer: (reply: { status: number; body: string }) => void = () => undefined;
    const requests: NativeAnalysisRequest[] = [];
    const native: NativeAnalysisPost = async (request) => {
      requests.push(request);
      return new Promise((resolve) => {
        answer = resolve;
      });
    };
    const port = riderModelStepPort(endpoint(), { send: recordingSend().send, native });
    const abort = new AbortController();
    const step = port?.runModelStep(SUMMARY_STEP, abort.signal);
    await Promise.resolve();
    expect(requests).toHaveLength(1);
    abort.abort();
    const settled = await step;
    answer({
      status: 200,
      body: JSON.stringify({ choices: [{ message: { content: 'late' }, finish_reason: 'stop' }] }),
    });
    expect(settled).toStrictEqual({ kind: 'failed', failure: 'cancelled' });
  });
});

// --- The shell ------------------------------------------------------------------

describe('inside the Android shell (#553)', () => {
  it('sends the same body through the native request, and never through fetch', async () => {
    const { send, sent } = recordingSend();
    const requests: NativeAnalysisRequest[] = [];
    const native: NativeAnalysisPost = async (request) => {
      requests.push(request);
      return Promise.resolve({
        status: 200,
        body: JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }),
      });
    };
    const reply: StepReply | undefined = await riderModelStepPort(endpoint(), {
      send,
      native,
    })?.runModelStep(STEP, live());
    expect(reply).toStrictEqual({ kind: 'answered', text: 'ok', finish: 'stop' });
    expect(sent).toStrictEqual([]);
    expect(requests).toStrictEqual([
      {
        url: 'http://192.168.1.20:8080/v1/chat/completions',
        headers: { 'Content-Type': 'application/json' },
        json: stepRequestBody('text-7b', STEP),
      },
    ]);
  });

  it('refuses a name before any native request exists', async () => {
    const requests: NativeAnalysisRequest[] = [];
    const native: NativeAnalysisPost = async (request) => {
      requests.push(request);
      return Promise.resolve({ status: 200, body: '' });
    };
    const port = ownComputerStepPort(endpoint('http://my-pc.local:8080'), {
      send: recordingSend().send,
      native,
    });
    expect(await port?.runModelStep(STEP, live())).toStrictEqual({
      kind: 'failed',
      failure: 'address-not-numeric',
    });
    expect(requests).toStrictEqual([]);
  });

  it('sends nothing for a step whose signal has already aborted', async () => {
    const requests: NativeAnalysisRequest[] = [];
    const native: NativeAnalysisPost = async (request) => {
      requests.push(request);
      return Promise.resolve({ status: 200, body: '' });
    };
    const port = riderModelStepPort(endpoint(), { native });
    expect(await port?.runModelStep(STEP, AbortSignal.abort())).toStrictEqual({
      kind: 'failed',
      failure: 'cancelled',
    });
    expect(requests).toStrictEqual([]);
  });

  it('names a rejected native request unreachable', async () => {
    const native: NativeAnalysisPost = async () => Promise.reject(new Error('192.168.1.20'));
    const port = riderModelStepPort(endpoint(), { native });
    expect(await port?.runModelStep(STEP, live())).toStrictEqual({
      kind: 'failed',
      failure: 'unreachable',
    });
  });
});

// --- Camera consent, through this path -------------------------------------------

const POSE: SideSessionSummary = {
  source: 'tablet',
  differences: { knee: -3.25, torso: 1.5 },
  posed: 1840,
  noRider: 12,
  unreadable: 3,
};

function rideWithNoSections(
  options: { pose?: SideSessionSummary; consented?: boolean } = {},
): RideAnalysisInput {
  return rideAnalysisInput(
    { movingTime: seconds(3720), distance: metres(31_400), routeId: undefined },
    undefined,
    {
      mass: kilograms(72),
      thresholdPower: watts(250),
    },
    {
      templateVersion: '1',
      cameraConsented: options.consented ?? false,
      ...(options.pose === undefined ? {} : { pose: options.pose }),
    },
  );
}

describe('the pose summary goes only with camera consent — #809’s four cases, through this path', () => {
  it.each([
    { present: true, consented: true, sent: true },
    { present: true, consented: false, sent: false },
    { present: false, consented: true, sent: false },
    { present: false, consented: false, sent: false },
  ])(
    'present $present, consented $consented: pose sent $sent, and the run goes ahead',
    async ({ present, consented, sent: poseSent }) => {
      const { send, sent } = recordingSend((init) => {
        // With no sections, the one step that asks for JSON is the position
        // step, which answers `notes`; the summary is prose.
        const body = JSON.parse(bodyText(init)) as { response_format?: unknown };
        return reply(
          body.response_format === undefined
            ? 'A steady ride.'
            : JSON.stringify({ notes: 'Posture held.' }),
        );
      });
      const outcome = await runAnalysis(
        rideWithNoSections({ ...(present ? { pose: POSE } : {}), consented }),
        { port: portWith(send), clock: STILL_CLOCK, signal: live() },
      );
      // Not refused for want of consent: a rider with no camera still gets one.
      expect(outcome.kind).toBe('written');
      const all = sent.map((each) => bodyText(each.init)).join('\n');
      if (poseSent) {
        expect(all).toContain('1840');
        expect(sent.some((each) => bodyOf(each).response_format !== undefined)).toBe(true);
      } else {
        expect(all).not.toContain('1840');
        expect(all).not.toContain('noRider');
        expect(sent).toHaveLength(1);
      }
    },
  );
});

// --- Nothing without a press ------------------------------------------------------

const SOURCE_ROOT = fileURLToPath(new URL('..', import.meta.url));

function productionSources(): readonly string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (
        /\.tsx?$/.test(entry.name) &&
        !/\.test\.tsx?$/.test(entry.name) &&
        !entry.name.endsWith('.d.ts') &&
        !/-testing\.tsx?$|(?:^|\/)testing\.tsx?$/.test(path)
      ) {
        found.push(relative(SOURCE_ROOT, path));
      }
    }
  };
  walk(SOURCE_ROOT);
  return found;
}

/** The names that start a ride analysis or build the thing that sends it. */
const SENDS_A_RIDE = /(?<![\w$])(?:runAnalysis|riderModelStepPort|ownComputerStepPort)\s*\(/;

/**
 * The modules that may call {@link SENDS_A_RIDE}, and why: the modules that
 * define them, and — since #804 — the one ask, `ride-analysis.ts`, whose only
 * caller is the ride page's press (`RideWriteUpControl.tsx`, which names
 * `askForRideWriteUp` and none of these). Ending a ride, saving it and
 * opening its page must stay out of this list.
 */
const MAY_START_A_RUN: readonly string[] = [
  join('ride-analysis', 'runner.ts'),
  join('ride-analysis', 'own-computer-step.ts'),
  join('ride-analysis', 'ride-analysis.ts'),
  join('camera', 'analysis-transport.ts'),
];

function startersIn(paths: readonly string[], read: (path: string) => string): string[] {
  return paths
    .filter((path) => !MAY_START_A_RUN.includes(path))
    .filter((path) => SENDS_A_RIDE.test(stripComments(read(path))));
}

describe('sends nothing without a press (#802)', () => {
  it('sends nothing when a port is built, or when nothing asks it anything', () => {
    const { send, sent } = recordingSend();
    riderModelStepPort(endpoint(), { send });
    expect(sent).toHaveLength(0);
  });

  it('has no production caller that ends, saves or opens a ride and starts a run', () => {
    const read = (path: string): string => readFileSync(join(SOURCE_ROOT, path), 'utf8');
    const sources = productionSources();
    // The scan reads the tree: the modules it exempts are there.
    for (const path of MAY_START_A_RUN) {
      expect(sources, path).toContain(path);
    }
    expect(startersIn(sources, read)).toStrictEqual([]);
  });

  it('goes red on a planted caller in the ride controller or the ride page', () => {
    const planted = (path: string): string =>
      path === join('ride', 'controller.ts')
        ? 'void runAnalysis(input, options);'
        : path === join('views', 'ActivityDetailView.tsx')
          ? 'const port = riderModelStepPort(endpoint);'
          : '';
    expect(
      startersIn([join('ride', 'controller.ts'), join('views', 'ActivityDetailView.tsx')], planted),
    ).toStrictEqual([join('ride', 'controller.ts'), join('views', 'ActivityDetailView.tsx')]);
  });
});
