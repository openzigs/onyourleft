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
  riderAnalysisSource,
  type AnalysisSend,
  type NativeAnalysisPost,
  type NativeAnalysisReply,
  type NativeAnalysisRequest,
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

describe('inside the Android shell, the native request — #553', () => {
  function recordingNative(answer: () => Promise<NativeAnalysisReply> | NativeAnalysisReply): {
    readonly native: NativeAnalysisPost;
    readonly sent: NativeAnalysisRequest[];
  } {
    const sent: NativeAnalysisRequest[] = [];
    return {
      sent,
      native: async (sending) => {
        sent.push(sending);
        return Promise.resolve(answer());
      },
    };
  }

  const READY: NativeAnalysisReply = {
    status: 200,
    body: JSON.stringify({ choices: [{ message: { content: 'ready' } }] }),
  };

  it('goes native and never through fetch, with the same body to the same URL', async () => {
    const { native, sent } = recordingNative(() => READY);
    const { send, sent: fetched } = recordingSend(() => modelReply('ready'));
    const port = riderAnalysisPort(endpoint(), { send, native });
    const outcome = await port?.askAboutFrame(request()).outcome;
    expect(outcome).toEqual({ kind: 'described', description: 'ready' });
    expect(fetched).toHaveLength(0);
    expect(sent).toEqual([
      {
        url: 'http://192.168.1.20:8080/v1/chat/completions',
        headers: { 'Content-Type': 'application/json' },
        json: analysisRequestBody('vision-4b', request()),
      },
    ]);
  });

  it.each([
    ['a .local name', 'http://studio.local:8080'],
    ['a .home.arpa name', 'http://pc.home.arpa:8080'],
    ['an .internal name', 'http://pc.internal:8080'],
    ['localhost', 'http://localhost:8080'],
    ['a loopback number', 'http://127.0.0.1:8080'],
    ['an IPv6 loopback', 'http://[::1]:8080'],
  ])('refuses %s BEFORE any native request, and says why', async (_what, address) => {
    const { native, sent } = recordingNative(() => READY);
    const port = riderAnalysisPort(endpoint(address), { native });
    expect(port).toBeDefined();
    const outcome = await port?.askAboutFrame(request()).outcome;
    expect(outcome).toEqual({ kind: 'failed', failure: 'address-not-numeric' });
    expect(sent).toHaveLength(0);
  });

  it.each([
    ['a private IPv4 number', 'http://10.0.0.5:8080'],
    ['a 172.16/12 number', 'http://172.20.1.2:8080'],
    ['an overlay number', 'http://100.101.1.2:8080'],
    ['a unique-local IPv6 number', 'http://[fd12::5]:8080'],
    ['https to a private number', 'https://192.168.1.20:8443'],
  ])('sends to %s', async (_what, address) => {
    const { native, sent } = recordingNative(() => READY);
    await riderAnalysisPort(endpoint(address), { native })?.askAboutFrame(request()).outcome;
    expect(sent).toHaveLength(1);
  });

  it('builds no port at all for a public address, so nothing native can be reached either', () => {
    const { native } = recordingNative(() => READY);
    const forged: AnalysisEndpoint = { address: 'http://8.8.8.8', model: 'x', switchedOn: true };
    expect(riderAnalysisPort(forged, { native })).toBeUndefined();
    expect(riderAnalysisPort(endpoint('http://192.168.1.20', false), { native })).toBeUndefined();
  });

  it('reads a native rejection as unreachable, and nothing of its message', async () => {
    const port = riderAnalysisPort(endpoint(), {
      native: async () => Promise.reject(new Error('failed to connect to /192.168.1.20')),
    });
    expect(await port?.askAboutFrame(request()).outcome).toEqual({
      kind: 'failed',
      failure: 'unreachable',
    });
  });

  it('reads a redirect it was told not to follow as not a model server', async () => {
    const { native } = recordingNative(() => ({ status: 307, body: '' }));
    expect(
      await riderAnalysisPort(endpoint(), { native })?.askAboutFrame(request()).outcome,
    ).toEqual({ kind: 'failed', failure: 'not-a-model-server' });
  });

  it('refuses an answer larger than it will read', async () => {
    const { native } = recordingNative(() => ({
      status: 200,
      body: 'x'.repeat(MAXIMUM_RESPONSE_BYTES + 1),
    }));
    expect(
      await riderAnalysisPort(endpoint(), { native })?.askAboutFrame(request()).outcome,
    ).toEqual({ kind: 'failed', failure: 'too-large' });
  });

  it('sends no picture larger than it will send', async () => {
    const { native, sent } = recordingNative(() => READY);
    const outcome = await riderAnalysisPort(endpoint(), { native })?.askAboutFrame(
      request(cleanFrameBytes(MAXIMUM_PICTURE_BYTES + 16)),
    ).outcome;
    expect(outcome).toEqual({ kind: 'failed', failure: 'picture-too-large' });
    expect(sent).toHaveLength(0);
  });

  it('settles as cancelled when cancelled, and the answer that comes later is dropped', async () => {
    let release: (reply: NativeAnalysisReply) => void = () => undefined;
    const port = riderAnalysisPort(endpoint(), {
      native: async () =>
        new Promise<NativeAnalysisReply>((resolve) => {
          release = resolve;
        }),
    });
    const call = port?.askAboutFrame(request());
    call?.cancel();
    call?.cancel();
    release(READY);
    expect(await call?.outcome).toEqual({ kind: 'failed', failure: 'cancelled' });
  });
});

describe('which way a picture leaves — #553 review', () => {
  const READY: NativeAnalysisReply = {
    status: 200,
    body: JSON.stringify({ choices: [{ message: { content: 'ready' } }] }),
  };

  it('inside the shell, goes through the native request and never through fetch', async () => {
    const natives: NativeAnalysisRequest[] = [];
    const native: NativeAnalysisPost = async (sending) => {
      natives.push(sending);
      return Promise.resolve(READY);
    };
    const { send, sent: fetched } = recordingSend(() => modelReply('ready'));
    const source = await riderAnalysisSource(
      true,
      async () => Promise.resolve(native),
      () => endpoint(),
      send,
    );
    const outcome = await source()?.askAboutFrame(request()).outcome;
    expect(outcome).toEqual({ kind: 'described', description: 'ready' });
    expect(fetched).toHaveLength(0);
    expect(natives.map((sending) => sending.url)).toEqual([
      'http://192.168.1.20:8080/v1/chat/completions',
    ]);
  });

  it('in a browser, never loads the native request and goes through fetch', async () => {
    let loaded = 0;
    const loadNative = async (): Promise<NativeAnalysisPost> => {
      loaded += 1;
      return Promise.reject(new Error('a browser must not load Capacitor'));
    };
    const { send, sent: fetched } = recordingSend(() => modelReply('ready'));
    const source = await riderAnalysisSource(false, loadNative, () => endpoint(), send);
    const outcome = await source()?.askAboutFrame(request()).outcome;
    expect(outcome).toEqual({ kind: 'described', description: 'ready' });
    expect(loaded).toBe(0);
    expect(fetched).toHaveLength(1);
  });

  it('reads the endpoint again on every call', async () => {
    let current: AnalysisEndpoint | undefined = endpoint();
    const source = await riderAnalysisSource(
      true,
      async () => Promise.resolve(async () => Promise.resolve(READY)),
      () => current,
    );
    expect(source()).toBeDefined();
    current = undefined;
    expect(source()).toBeUndefined();
  });
});
