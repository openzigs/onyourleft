// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the local model server offers (#2610), read from a stub Ollama that
 * answers from the committed, hand-made fixtures in `testing/ollama-*.json`.
 * The route over it, as the owner and as everybody else, is
 * `operate/analysis-models-route.test.ts`'s.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { fitOf, readLocalServer, toolsOf, LOCAL_SERVER_BODY_BYTES } from './local-server.ts';
import {
  CURRENT_SERVER,
  OLDER_SERVER,
  startOllamaStub,
  type OllamaStub,
} from './ollama-stub-testing.ts';

let stub: OllamaStub | undefined;
afterEach(async () => {
  await stub?.close();
  stub = undefined;
});

/** The settings' base URL for the stub, by a name that resolves to loopback. */
const baseOf = (port: number): URL => new URL(`http://models-box:${String(port)}/v1`);
const loopback = (): Promise<readonly string[]> => Promise.resolve(['127.0.0.1']);

describe('the models a local Ollama offers, with their tools and GPU fit (#2610)', () => {
  it('lists each model with its size, parameters, quantisation, tools, and all / part / not known for a fully, partly and un-loaded model', async () => {
    stub = await startOllamaStub(CURRENT_SERVER);
    const read = await readLocalServer(baseOf(stub.port), { resolve: loopback });
    expect(read).toEqual({
      state: 'ollama',
      version: '0.12.6',
      models: [
        {
          name: 'alpha:14b',
          sizeBytes: 9_000_000_000,
          parameters: '14.8B',
          quantisation: 'Q4_K_M',
          tools: 'listed',
          gpu: 'all',
          gpuPercent: null,
        },
        {
          name: 'beta:32b',
          sizeBytes: 19_900_000_000,
          parameters: '32.8B',
          quantisation: 'Q4_K_M',
          tools: 'listed',
          gpu: 'part',
          gpuPercent: 62,
        },
        {
          name: 'gamma:26b',
          sizeBytes: 17_000_000_000,
          parameters: '25.8B',
          quantisation: 'Q8_0',
          tools: 'not-listed',
          gpu: 'not-loaded',
          gpuPercent: null,
        },
        // "two words" is not a name the settings would save, so it is not listed.
      ],
    });
    // Ollama's own API, at the origin: never the OpenAI-compatible `/v1/models`.
    expect(stub.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'GET /api/version',
      'GET /api/tags',
      'GET /api/ps',
      'POST /api/show',
      'POST /api/show',
      'POST /api/show',
    ]);
    expect(stub.requests.filter((request) => request.method === 'POST')).toEqual(
      ['alpha:14b', 'beta:32b', 'gamma:26b'].map((model) => ({
        method: 'POST',
        path: '/api/show',
        body: { model },
      })),
    );
  });

  it('reads an older server, with no capabilities and no size_vram, without error, as not reported', async () => {
    stub = await startOllamaStub(OLDER_SERVER);
    const read = await readLocalServer(baseOf(stub.port), { resolve: loopback });
    expect(read.state).toBe('ollama');
    expect(read.models.map((model) => [model.name, model.tools, model.gpu])).toEqual([
      ['alpha:14b', 'not-reported', 'not-reported'],
      ['beta:32b', 'not-reported', 'not-loaded'],
      ['gamma:26b', 'not-reported', 'not-loaded'],
    ]);
  });

  it('asks a server that is not Ollama for its OpenAI-compatible model names, and nothing else', async () => {
    stub = await startOllamaStub({
      ollama: false,
      models: { object: 'list', data: [{ id: 'local-one', object: 'model' }, { id: 'a b' }, 7] },
    });
    const read = await readLocalServer(baseOf(stub.port), { resolve: loopback });
    expect(read).toEqual({
      state: 'openai-compatible',
      version: null,
      models: [
        {
          name: 'local-one',
          sizeBytes: null,
          parameters: null,
          quantisation: null,
          tools: 'not-reported',
          gpu: 'not-known',
          gpuPercent: null,
        },
      ],
    });
    expect(stub.requests.map((request) => request.path)).toEqual(['/api/version', '/v1/models']);
  });

  it('keeps a version, parameters and quantisation only in their documented shape', async () => {
    stub = await startOllamaStub({
      version: { version: 'see <script> here' },
      tags: {
        models: [
          {
            name: 'alpha:14b',
            size: -1,
            details: { parameter_size: 'a very long parameter size', quantization_level: 4 },
          },
        ],
      },
      ps: 'not an object',
      show: {},
    });
    const read = await readLocalServer(baseOf(stub.port), { resolve: loopback });
    expect(read).toEqual({
      state: 'ollama',
      version: null,
      models: [
        {
          name: 'alpha:14b',
          sizeBytes: null,
          parameters: null,
          quantisation: null,
          tools: 'not-reported',
          gpu: 'not-loaded',
          gpuPercent: null,
        },
      ],
    });
  });

  it('reads no answer past its bound: a tags answer too large is the server unreachable', async () => {
    stub = await startOllamaStub({ ...CURRENT_SERVER, tagsBytes: LOCAL_SERVER_BODY_BYTES });
    const read = await readLocalServer(baseOf(stub.port), { resolve: loopback });
    expect(read).toEqual({ state: 'unreachable', version: '0.12.6', models: [] });
  });
});

describe('the address is checked on every request to the local server (#2610, ADR 0040 D-6)', () => {
  it('refuses the second request when the name resolves private for the first and public for the second, and asks nothing more', async () => {
    stub = await startOllamaStub(CURRENT_SERVER);
    const answers: (readonly string[])[] = [['127.0.0.1'], ['8.8.8.8']];
    const looked: string[] = [];
    const flipping = (name: string): Promise<readonly string[]> => {
      looked.push(name);
      return Promise.resolve(answers.shift() ?? ['8.8.8.8']);
    };
    const read = await readLocalServer(baseOf(stub.port), { resolve: flipping });
    expect(read).toEqual({ state: 'not-local', version: null, models: [] });
    expect(looked).toEqual(['models-box', 'models-box']);
    expect(stub.requests.map((request) => request.path)).toEqual(['/api/version']);
  });

  it('is unresolved for a name that resolves to nothing, and sends nothing', async () => {
    stub = await startOllamaStub(CURRENT_SERVER);
    const read = await readLocalServer(baseOf(stub.port), {
      resolve: () => Promise.reject(new Error('no such name')),
    });
    expect(read.state).toBe('unresolved');
    expect(stub.requests).toEqual([]);
  });

  it('is unreachable for a server that answers nothing, and within its deadline for a lookup that hangs', async () => {
    const closed = await startOllamaStub(CURRENT_SERVER);
    const port = closed.port;
    await closed.close();
    expect((await readLocalServer(baseOf(port), { resolve: loopback })).state).toBe('unreachable');
    const hanging = await readLocalServer(baseOf(port), {
      resolve: () => new Promise<readonly string[]>(() => undefined),
      waitMs: 1,
    });
    expect(hanging).toEqual({ state: 'unreachable', version: null, models: [] });
  });
});

describe('the GPU fit is read from what is loaded, never guessed (#2610)', () => {
  it.each([
    ['not loaded', undefined, 'not-loaded', null],
    ['no size_vram', { size: 100 }, 'not-reported', null],
    ['a size of 0', { size: 0, size_vram: 0 }, 'not-reported', null],
    ['all of it', { size: 100, size_vram: 100 }, 'all', null],
    ['more than all of it', { size: 100, size_vram: 101 }, 'all', null],
    ['none of it', { size: 100, size_vram: 0 }, 'none', null],
    ['62 %', { size: 100, size_vram: 62 }, 'part', 62],
    ['nearly all, never 100 %', { size: 1000, size_vram: 999 }, 'part', 99],
    ['nearly none, never 0 %', { size: 1000, size_vram: 1 }, 'part', 1],
  ] as const)('%s', (_name, loaded, gpu, gpuPercent) => {
    expect(fitOf(loaded)).toEqual({ gpu, gpuPercent });
  });

  it('says tools are listed, not listed, or not reported', () => {
    expect(toolsOf({ capabilities: ['completion', 'tools'] })).toBe('listed');
    expect(toolsOf({ capabilities: ['completion'] })).toBe('not-listed');
    expect(toolsOf({ capabilities: 'tools' })).toBe('not-reported');
    expect(toolsOf(undefined)).toBe('not-reported');
  });
});
