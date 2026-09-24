// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The one module permitted a network primitive: what it sends, to where, how,
 * and what it does when the other end misbehaves — #387.
 */

import { describe, expect, it } from 'vitest';

import { coordinatesIn } from '../privacy/boundaries';

import { ANALYSIS_PROMPTS, type AnalysisRequest } from './analysis-port';
import { endpointDecision, type AnalysisEndpoint } from './analysis-endpoint';
import { MAXIMUM_RESPONSE_BYTES } from './analysis-response';
import {
  analysisRequestBody,
  MAXIMUM_PICTURE_BYTES,
  riderAnalysisPort,
  type AnalysisSend,
} from './analysis-transport';
import { capturedFrame } from './frame';
import { cleanFrameBytes } from './testing';

function endpoint(address = 'http://192.168.1.20:8080', switchedOn = true): AnalysisEndpoint {
  const decision = endpointDecision({ address, model: 'vision-4b', switchedOn });
  if (decision.endpoint === undefined) {
    throw new Error(`fixture endpoint refused: ${String(decision.refusal)}`);
  }
  return decision.endpoint;
}

function request(bytes: Uint8Array = cleanFrameBytes()): AnalysisRequest {
  return {
    frame: capturedFrame({ bytes, mediaType: 'image/jpeg', width: 640, height: 480 }),
    question: 'connection-check',
  };
}

interface Sent {
  readonly url: string;
  readonly init: RequestInit & { readonly targetAddressSpace?: string };
}

/** A send that records what it was handed and answers with `answer`. */
function recordingSend(answer: () => Promise<Response> | Response): {
  readonly send: AnalysisSend;
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

function modelReply(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

describe('with nothing configured there is no port at all', () => {
  it('builds none from no endpoint', () => {
    expect(riderAnalysisPort(undefined)).toBeUndefined();
  });

  it('builds none from an endpoint that is switched off', () => {
    expect(riderAnalysisPort(endpoint('http://192.168.1.20', false))).toBeUndefined();
  });

  it('builds none from a hand-built endpoint naming a public address', () => {
    // An endpoint is a plain object; one that did not come through
    // `endpointDecision` must not be the way round the rule.
    const forged: AnalysisEndpoint = {
      address: 'https://api.example.com',
      model: 'x',
      switchedOn: true,
    };
    expect(riderAnalysisPort(forged)).toBeUndefined();
    expect(riderAnalysisPort({ ...forged, address: 'not a url' })).toBeUndefined();
  });
});

describe('what leaves, exactly', () => {
  it('posts to the completions path of the address the rider typed, and only there', async () => {
    const { send, sent } = recordingSend(() => modelReply('ready'));
    const port = riderAnalysisPort(endpoint(), { send });
    await port?.askAboutFrame(request()).outcome;
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe('http://192.168.1.20:8080/v1/chat/completions');
  });

  it('asks the browser to cache nothing, send no credential, follow no redirect and name no referrer', async () => {
    const { send, sent } = recordingSend(() => modelReply('ready'));
    await riderAnalysisPort(endpoint(), { send })?.askAboutFrame(request()).outcome;
    const init = sent[0]?.init;
    expect(init?.method).toBe('POST');
    expect(init?.cache).toBe('no-store');
    expect(init?.credentials).toBe('omit');
    // ⚠️ The one that matters most: a redirect would re-send the picture.
    expect(init?.redirect).toBe('error');
    expect(init?.referrerPolicy).toBe('no-referrer');
    expect(init?.targetAddressSpace).toBe('local');
  });

  it('annotates a loopback address as loopback', async () => {
    const { send, sent } = recordingSend(() => modelReply('ready'));
    await riderAnalysisPort(endpoint('http://127.0.0.1:8080'), { send })?.askAboutFrame(request())
      .outcome;
    expect(sent[0]?.init.targetAddressSpace).toBe('loopback');
  });

  it('sends four keys and a fixed prompt, and nothing else — ADR 0029 D-7', async () => {
    const { send, sent } = recordingSend(() => modelReply('ready'));
    await riderAnalysisPort(endpoint(), { send })?.askAboutFrame(request()).outcome;
    const body = JSON.parse(sent[0]?.init.body as string) as Record<string, unknown>;
    // The key set is pinned, so a fifth key — an athlete id, a ride id, a
    // position — is a red test rather than a quiet addition.
    expect(Object.keys(body).sort()).toStrictEqual(['max_tokens', 'messages', 'model', 'stream']);
    expect(body['model']).toBe('vision-4b');
    const messages = body['messages'] as { role: string; content: Record<string, unknown>[] }[];
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content.map((part) => part['type'])).toStrictEqual(['text', 'image_url']);
    expect(messages[0]?.content[0]?.['text']).toBe(ANALYSIS_PROMPTS['connection-check']);
  });

  it('carries the picture as the bytes the camera produced, and no coordinate anywhere', () => {
    const bytes = cleanFrameBytes(3000);
    const body = analysisRequestBody('m', request(bytes));
    // ADR 0029 D-9's other half: the walk cannot see inside the picture, which
    // is why the picture was re-encoded at capture. What it CAN see is every
    // field around it, and there is no position in any of them.
    expect(coordinatesIn(body)).toStrictEqual([]);
    const image = JSON.stringify(body).match(/data:image\/jpeg;base64,([A-Za-z0-9+/=]+)/)?.[1];
    expect(image).toBeDefined();
    expect(Uint8Array.from(atob(image ?? ''), (c) => c.charCodeAt(0))).toStrictEqual(bytes);
  });

  it('refuses a picture larger than it will send, without sending', async () => {
    const { send, sent } = recordingSend(() => modelReply('ready'));
    const big = new Uint8Array(MAXIMUM_PICTURE_BYTES + 1);
    big.set(cleanFrameBytes(64));
    const outcome = await riderAnalysisPort(endpoint(), { send })?.askAboutFrame(request(big))
      .outcome;
    expect(outcome).toStrictEqual({ kind: 'failed', failure: 'picture-too-large' });
    expect(sent).toHaveLength(0);
  });
});

describe('what comes back', () => {
  it('is described when the model answers', async () => {
    const { send } = recordingSend(() => modelReply('Ready.'));
    const outcome = await riderAnalysisPort(endpoint(), { send })?.askAboutFrame(request()).outcome;
    expect(outcome).toStrictEqual({ kind: 'described', description: 'Ready.' });
  });

  it('is unreachable when the network refuses, and carries nothing of the error', async () => {
    const send: AnalysisSend = async () =>
      Promise.reject(
        new TypeError('Failed to fetch http://192.168.1.20:8080 data:image/jpeg;base64,/9j/'),
      );
    const outcome = await riderAnalysisPort(endpoint(), { send })?.askAboutFrame(request()).outcome;
    expect(outcome).toStrictEqual({ kind: 'failed', failure: 'unreachable' });
  });

  it('reads a reply with no body as something that is not a model server', async () => {
    const { send } = recordingSend(() => new Response(null, { status: 200 }));
    const outcome = await riderAnalysisPort(endpoint(), { send })?.askAboutFrame(request()).outcome;
    expect(outcome).toStrictEqual({ kind: 'failed', failure: 'not-a-model-server' });
  });

  it('stops reading a body that runs past the bound, and cancels it', async () => {
    let pulled = 0;
    let cancelled = false;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(16 * 1024).fill(0x20));
      },
      cancel() {
        cancelled = true;
      },
    });
    const { send } = recordingSend(() => new Response(endless, { status: 200 }));
    const outcome = await riderAnalysisPort(endpoint(), { send })?.askAboutFrame(request()).outcome;
    expect(outcome).toStrictEqual({ kind: 'failed', failure: 'too-large' });
    expect(cancelled).toBe(true);
    // Bounded: a handful of chunks past the limit, not the whole stream.
    expect(pulled * 16 * 1024).toBeLessThan(MAXIMUM_RESPONSE_BYTES * 2);
  });
});

describe('cancelling', () => {
  it('settles as cancelled at once, and aborts the request', async () => {
    let signal: AbortSignal | undefined;
    const send: AnalysisSend = async (_url, init) => {
      signal = init.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    };
    const call = riderAnalysisPort(endpoint(), { send })?.askAboutFrame(request());
    await Promise.resolve();
    call?.cancel();
    call?.cancel();
    expect(await call?.outcome).toStrictEqual({ kind: 'failed', failure: 'cancelled' });
    expect(signal?.aborted).toBe(true);
  });
});
