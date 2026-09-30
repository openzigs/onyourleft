// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The embedding client (#835, ADR 0040 D-5 to D-7): what it sends, where it
 * sends it, and what it refuses to believe.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import type { Resolver } from './address.ts';
import {
  conventionOf,
  createOllamaEmbedder,
  DEFAULT_DOCUMENT_PREFIX,
  DEFAULT_QUERY_PREFIX,
  type EmbeddingSettings,
} from './embedder.ts';

interface Sent {
  readonly url: string;
  readonly init: RequestInit;
  readonly body: Record<string, unknown>;
}

function recordingFetch(answer: (body: Record<string, unknown>) => Response) {
  const sent: Sent[] = [];
  const fetch = ((url: string, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    sent.push({ url, init: init ?? {}, body });
    return Promise.resolve(answer(body));
  }) as typeof globalThis.fetch;
  return { sent, fetch };
}

const vectorsFor = (body: Record<string, unknown>): Response =>
  Response.json({
    embeddings: (body.input as string[]).map((_, index) => [3, 4 + index, 0]),
  });

const SETTINGS: EmbeddingSettings = {
  endpoint: new URL('http://ollama:11434'),
  model: 'nomic-embed-text',
  documentPrefix: DEFAULT_DOCUMENT_PREFIX,
  queryPrefix: DEFAULT_QUERY_PREFIX,
};

const PRIVATE: Resolver = () => Promise.resolve(['172.30.87.20']);
const PUBLIC: Resolver = () => Promise.resolve(['93.184.216.34']);

describe('what an embedding request sends', () => {
  it('asks for every input untruncated, with the prefix of its purpose, to the address that was checked', async () => {
    const { sent, fetch } = recordingFetch(vectorsFor);
    const embedder = createOllamaEmbedder({ settings: SETTINGS, resolve: PRIVATE, fetch });
    await embedder.embed(['A steady hour.', 'Then a climb.'], 'document');
    await embedder.embed(['hills'], 'query');
    expect(sent).toHaveLength(2);
    expect(sent[0]?.url).toBe('http://172.30.87.20:11434/api/embed');
    expect(sent[0]?.body).toStrictEqual({
      model: 'nomic-embed-text',
      input: ['search_document: A steady hour.', 'search_document: Then a climb.'],
      truncate: false,
    });
    expect(sent[1]?.body.input).toStrictEqual(['search_query: hills']);
    // A redirect cannot move the request somewhere nobody checked.
    expect(sent[0]?.init.redirect).toBe('error');
    expect(sent[0]?.init.method).toBe('POST');
  });

  it('brackets an IPv6 address, and keeps the configured scheme and port', async () => {
    const { sent, fetch } = recordingFetch(vectorsFor);
    const embedder = createOllamaEmbedder({
      settings: { ...SETTINGS, endpoint: new URL('https://embeddings:8443') },
      resolve: () => Promise.resolve(['fd00::7']),
      fetch,
    });
    await embedder.embed(['x'], 'query');
    expect(sent[0]?.url).toBe('https://[fd00::7]:8443/api/embed');
  });

  it('sends nothing at all to a name that resolves anywhere public', async () => {
    const { sent, fetch } = recordingFetch(vectorsFor);
    const embedder = createOllamaEmbedder({ settings: SETTINGS, resolve: PUBLIC, fetch });
    expect(await embedder.embed(['x'], 'document')).toEqual({ ok: false, why: 'not-local' });
    expect(sent).toHaveLength(0);
  });

  it('records the model and the prefix convention every row carries', () => {
    const embedder = createOllamaEmbedder({ settings: SETTINGS, resolve: PRIVATE });
    expect(embedder.model).toBe('nomic-embed-text');
    expect(embedder.convention).toBe(conventionOf(SETTINGS));
    expect(conventionOf({ documentPrefix: '', queryPrefix: '' })).not.toBe(embedder.convention);
  });

  it('asks nothing for nothing', async () => {
    const { sent, fetch } = recordingFetch(vectorsFor);
    const embedder = createOllamaEmbedder({ settings: SETTINGS, resolve: PRIVATE, fetch });
    expect(await embedder.embed([], 'document')).toEqual({ ok: true, vectors: [] });
    expect(sent).toHaveLength(0);
  });
});

describe('what it believes of an answer', () => {
  it('makes every vector unit length, whatever the server sent', async () => {
    const { fetch } = recordingFetch(vectorsFor);
    const embedder = createOllamaEmbedder({ settings: SETTINGS, resolve: PRIVATE, fetch });
    const answer = await embedder.embed(['a'], 'document');
    expect(answer.ok).toBe(true);
    const [vector] = answer.ok ? answer.vectors : [];
    expect([...(vector ?? [])]).toStrictEqual([0.6000000238418579, 0.800000011920929, 0]);
  });

  it('calls an over-long input too-long, never a vector of part of it', async () => {
    const { fetch } = recordingFetch(() =>
      Response.json({ error: 'the input length exceeds the context length' }, { status: 400 }),
    );
    const embedder = createOllamaEmbedder({ settings: SETTINGS, resolve: PRIVATE, fetch });
    expect(await embedder.embed(['long'], 'document')).toEqual({ ok: false, why: 'too-long' });
  });

  it.each([
    ['another refusal', () => Response.json({ error: 'model not found' }, { status: 404 })],
    ['a 400 that is not about length', () => Response.json({ error: 'bad' }, { status: 400 })],
    ['an error page', () => new Response('<html>', { status: 502 })],
  ])('calls %s refused', async (_case, answer) => {
    const { fetch } = recordingFetch(answer);
    const embedder = createOllamaEmbedder({ settings: SETTINGS, resolve: PRIVATE, fetch });
    expect(await embedder.embed(['x'], 'document')).toEqual({ ok: false, why: 'refused' });
  });

  it.each([
    ['not JSON', () => new Response('ok')],
    ['no embeddings', () => Response.json({})],
    ['one vector too few', () => Response.json({ embeddings: [[1, 0]] })],
    ['a vector of nothing', () => Response.json({ embeddings: [[], []] })],
    [
      'a zero vector',
      () =>
        Response.json({
          embeddings: [
            [0, 0],
            [1, 0],
          ],
        }),
    ],
    [
      'a number that is not one',
      () =>
        Response.json({
          embeddings: [
            [1, 'x'],
            [1, 0],
          ],
        }),
    ],
    [
      'two dimensions',
      () =>
        Response.json({
          embeddings: [
            [1, 0],
            [1, 0, 0],
          ],
        }),
    ],
  ])('calls an answer with %s malformed', async (_case, answer) => {
    const { fetch } = recordingFetch(answer);
    const embedder = createOllamaEmbedder({ settings: SETTINGS, resolve: PRIVATE, fetch });
    expect(await embedder.embed(['a', 'b'].slice(0, 2), 'document')).toEqual({
      ok: false,
      why: 'malformed',
    });
  });

  it('calls a connection that fails unreachable', async () => {
    const fetch = (() => Promise.reject(new TypeError('fetch failed'))) as typeof globalThis.fetch;
    const embedder = createOllamaEmbedder({ settings: SETTINGS, resolve: PRIVATE, fetch });
    expect(await embedder.embed(['x'], 'document')).toEqual({ ok: false, why: 'unreachable' });
  });
});

describe('against a model server on this machine, over real HTTP', () => {
  let server: Server | undefined;
  afterEach(async () => {
    await new Promise<void>((done) => {
      if (server === undefined) done();
      else server.close(() => done());
    });
    server = undefined;
  });

  it('reaches it by a name that resolves to loopback, and gives up at its deadline', async () => {
    const bodies: unknown[] = [];
    let stall = false;
    server = createServer((request, response) => {
      let text = '';
      request.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
      request.on('end', () => {
        bodies.push(JSON.parse(text));
        if (stall) return;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ embeddings: [[1, 1]] }));
      });
    });
    await new Promise<void>((done) => server?.listen(0, '127.0.0.1', done));
    const port = (server.address() as AddressInfo).port;
    const embedder = createOllamaEmbedder({
      settings: { ...SETTINGS, endpoint: new URL(`http://ollama:${String(port)}`) },
      resolve: () => Promise.resolve(['127.0.0.1']),
      timeoutMilliseconds: 300,
    });
    const answer = await embedder.embed(['a'], 'query');
    expect(answer.ok).toBe(true);
    expect(bodies).toStrictEqual([
      { model: 'nomic-embed-text', input: ['search_query: a'], truncate: false },
    ]);
    stall = true;
    expect(await embedder.embed(['b'], 'query')).toEqual({ ok: false, why: 'unreachable' });
    server.closeAllConnections();
  });
});
