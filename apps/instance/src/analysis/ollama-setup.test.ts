// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Finding Ollama, and asking it to download and to load a model (#2792),
 * against the stub Ollama over real loopback HTTP. The step that uses them,
 * as the running instance serves it, is `setup/setup-instance.test.ts`'s.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  createModelPull,
  findOllama,
  loadModel,
  PULL_LAYERS,
  PULL_LINE_BYTES,
  type ModelPullState,
} from './ollama-setup.ts';
import {
  CURRENT_SERVER,
  startOllamaStub,
  type OllamaStub,
  type ScriptedPull,
} from './ollama-stub-testing.ts';

const stubs: OllamaStub[] = [];
afterEach(async () => {
  for (const stub of stubs.splice(0)) await stub.close();
});

async function stubOf(options: Parameters<typeof startOllamaStub>[0]): Promise<OllamaStub> {
  const stub = await startOllamaStub(options);
  stubs.push(stub);
  return stub;
}

/** `*-box` names are loopback; `public-box` is somewhere else; anything else is no name at all. */
const resolve = (name: string): Promise<readonly string[]> =>
  name === 'public-box'
    ? Promise.resolve(['8.8.8.8'])
    : name.endsWith('-box')
      ? Promise.resolve(['127.0.0.1'])
      : Promise.reject(new Error('no such name'));

const at = (name: string, port: number): string => `http://${name}:${String(port)}/v1`;

/** A host's user name, as Ollama's own words about a download can carry it. */
const HOST_USER = 'MARKER-hostuser-2792';

/** A download, run to its end: how it ended, and every state seen on the way. */
async function pullOf(scripted: ScriptedPull): Promise<ModelPullState> {
  const stub = await stubOf({ ...CURRENT_SERVER, pull: () => scripted });
  const pull = createModelPull({ resolve });
  expect(pull.start(new URL(at('models-box', stub.port)), 'delta:8b')).toBe(true);
  await pull.idle();
  return pull.state();
}

describe('finding the Ollama on this machine (#2792)', () => {
  it('finds the first address, in order, that answers as Ollama, and reads what it offers', async () => {
    const first = await stubOf(CURRENT_SERVER);
    const second = await stubOf({ ...CURRENT_SERVER, tags: { models: [] } });
    const found = await findOllama(
      [at('no-such-name', 1), at('first-box', first.port), at('second-box', second.port)],
      { resolve },
    );
    expect(found?.baseUrl.href).toBe(at('first-box', first.port));
    expect(found?.read.state).toBe('ollama');
    expect(found?.read.models.map((model) => [model.name, model.gpu, model.tools])).toEqual([
      ['alpha:14b', 'all', 'listed'],
      ['beta:32b', 'part', 'listed'],
      ['gamma:26b', 'not-loaded', 'not-listed'],
    ]);
    // The other way round, the other one: the order is the caller's.
    const other = await findOllama([at('second-box', second.port), at('first-box', first.port)], {
      resolve,
    });
    expect(other?.baseUrl.href).toBe(at('second-box', second.port));
    expect(other?.read.models).toEqual([]);
  });

  it('finds none where nothing answers as Ollama: no name, nothing listening, or another kind of server', async () => {
    const closed = await startOllamaStub(CURRENT_SERVER);
    await closed.close();
    const other = await stubOf({ ollama: false, models: { data: [{ id: 'served-model' }] } });
    expect(
      await findOllama(
        [at('no-such-name', 1), at('closed-box', closed.port), at('other-box', other.port)],
        { resolve },
      ),
    ).toBeUndefined();
    expect(await findOllama([], { resolve })).toBeUndefined();
    // And one that says its version, then cannot list its models, is not one to offer.
    const listless = await stubOf({ ...CURRENT_SERVER, tags: undefined });
    expect(await findOllama([at('listless-box', listless.port)], { resolve })).toBeUndefined();
  });

  it('never asks an address the settings would refuse: one that is not local, or not a base URL', async () => {
    const stub = await stubOf(CURRENT_SERVER);
    let asked = 0;
    const fetch: typeof globalThis.fetch = (input, init) => {
      asked += 1;
      return globalThis.fetch(input, init);
    };
    const found = await findOllama(
      [
        'http://8.8.8.8:11434/v1',
        at('public-box', stub.port),
        `http://models-box:${String(stub.port)}/v1?x=1`,
        'not a url',
      ],
      { resolve, fetch },
    );
    expect(found).toBeUndefined();
    expect(asked).toBe(0);
    expect(stub.requests).toEqual([]);
  });

  it('gives an address that does not answer its wait and no longer, and still finds the one that does', async () => {
    const stub = await stubOf(CURRENT_SERVER);
    // A lookup that never settles: neither a signal nor a socket ends it.
    const hangs = (name: string): Promise<readonly string[]> =>
      name === 'hung-box' ? new Promise(() => undefined) : resolve(name);
    const found = await findOllama([at('hung-box', 1), at('models-box', stub.port)], {
      resolve: hangs,
      findMs: 50,
    });
    expect(found?.baseUrl.href).toBe(at('models-box', stub.port));
  });
});

describe('a download, as the instance holds it (#2792)', () => {
  it('counts the bytes over every layer while it runs, and is done once Ollama says success', async () => {
    let release: () => void = () => undefined;
    const hold = new Promise<void>((settle) => {
      release = settle;
    });
    const stub = await stubOf({
      ...CURRENT_SERVER,
      pull: () => ({
        lines: [
          { status: 'pulling manifest' },
          { status: 'pulling aaa', digest: 'sha256:aaa', total: 3_000_000_000 },
          { status: 'pulling aaa', digest: 'sha256:aaa', total: 3_000_000_000, completed: 500 },
          {
            status: 'pulling aaa',
            digest: 'sha256:aaa',
            total: 3_000_000_000,
            completed: 1_000_000_000,
          },
          { status: 'pulling bbb', digest: 'sha256:bbb', total: 1_000_000_000, completed: 0 },
        ],
        hold,
        then: [
          { status: 'verifying sha256 digest' },
          { status: 'writing manifest' },
          { status: 'success' },
        ],
      }),
    });
    const pull = createModelPull({ resolve });
    expect(pull.state()).toEqual({ kind: 'idle' });
    expect(pull.start(new URL(at('models-box', stub.port)), 'delta:8b')).toBe(true);
    // A second, while one runs, is not started and asks Ollama nothing.
    expect(pull.start(new URL(at('models-box', stub.port)), 'other:1b')).toBe(false);
    await expect
      .poll(() => pull.state())
      .toEqual({ kind: 'running', completedBytes: 1_000_000_000, totalBytes: 4_000_000_000 });
    release();
    await pull.idle();
    expect(pull.state()).toEqual({ kind: 'done' });
    // To Ollama's own API at the server's origin, with the name asked for and nothing else.
    expect(stub.requests).toEqual([
      { method: 'POST', path: '/api/pull', body: { model: 'delta:8b', stream: true } },
    ]);
    // And another may then be started.
    expect(pull.start(new URL(at('models-box', stub.port)), 'other:1b')).toBe(true);
    await pull.idle();
  });

  it.each<[string, ScriptedPull]>([
    [
      'an error line, whose words name the model and a path under the host user’s home',
      {
        lines: [
          { status: 'pulling manifest' },
          { error: `open /Users/${HOST_USER}/.ollama/models/blobs/sha256-aaa: no space left` },
          { status: 'success' },
        ],
      },
    ],
    ['an answer that is not a 2xx', { status: 500, lines: [{ status: 'success' }] }],
    ['a stream that ends with no success', { lines: [{ status: 'pulling manifest' }] }],
    ['a line that is not JSON', { lines: ['<html>not found</html>\n', { status: 'success' }] }],
    ['a line that is not an object', { lines: ['["success"]\n', { status: 'success' }] }],
    [
      'a line longer than its bound',
      { lines: [`{"status":"${'x'.repeat(PULL_LINE_BYTES + 1)}"}`, '\n', { status: 'success' }] },
    ],
  ])('is failed, in that one word, for %s', async (_what, scripted) => {
    const ended = await pullOf(scripted);
    expect(ended).toEqual({ kind: 'failed' });
    expect(JSON.stringify(ended)).not.toContain(HOST_USER);
  });

  it('is failed for an address that is not local, having sent nothing, and for a server that is gone', async () => {
    const stub = await stubOf({ ...CURRENT_SERVER, pull: () => ({ lines: [] }) });
    const elsewhere = createModelPull({ resolve });
    elsewhere.start(new URL(at('public-box', stub.port)), 'delta:8b');
    await elsewhere.idle();
    expect(elsewhere.state()).toEqual({ kind: 'failed' });
    expect(stub.requests).toEqual([]);

    const closed = await startOllamaStub(CURRENT_SERVER);
    await closed.close();
    const gone = createModelPull({ resolve });
    gone.start(new URL(at('closed-box', closed.port)), 'delta:8b');
    await gone.idle();
    expect(gone.state()).toEqual({ kind: 'failed' });
  });

  it('ends, failed, when the instance stops or its time runs out while Ollama is still sending', async () => {
    const never = new Promise<void>(() => undefined);
    const stub = await stubOf({
      ...CURRENT_SERVER,
      pull: () => ({ lines: [{ status: 'pulling manifest' }], hold: never }),
    });
    const stopped = new AbortController();
    const pull = createModelPull({ resolve, stopped: stopped.signal });
    pull.start(new URL(at('models-box', stub.port)), 'delta:8b');
    await expect.poll(() => stub.requests.length).toBe(1);
    stopped.abort();
    await pull.idle();
    expect(pull.state()).toEqual({ kind: 'failed' });

    const timed = createModelPull({ resolve, pullMs: 50 });
    timed.start(new URL(at('models-box', stub.port)), 'delta:8b');
    await timed.idle();
    expect(timed.state()).toEqual({ kind: 'failed' });
  });

  it('counts a layer once however often it is named, never more of it than its size, and no more layers than its bound', async () => {
    let release: () => void = () => undefined;
    const hold = new Promise<void>((settle) => {
      release = settle;
    });
    const many = Array.from({ length: PULL_LAYERS + 5 }, (_, index) => ({
      status: 'pulling',
      digest: `sha256:${String(index)}`,
      total: 10,
      completed: 25,
    }));
    const stub = await stubOf({
      ...CURRENT_SERVER,
      pull: () => ({ lines: [...many, ...many], hold, then: [{ status: 'success' }] }),
    });
    const pull = createModelPull({ resolve });
    pull.start(new URL(at('models-box', stub.port)), 'delta:8b');
    await expect
      .poll(() => pull.state())
      .toEqual({
        kind: 'running',
        completedBytes: PULL_LAYERS * 10,
        totalBytes: PULL_LAYERS * 10,
      });
    release();
    await pull.idle();
  });
});

describe('loading a model, so Ollama can say how it fits (#2792)', () => {
  it('asks Ollama to generate with no prompt, which loads the model, and /api/ps then lists it', async () => {
    const stub = await stubOf({
      ...CURRENT_SERVER,
      load: (model) => ({ name: model, model, size: 2000, size_vram: 500 }),
    });
    const base = new URL(at('models-box', stub.port));
    await loadModel(base, 'gamma:26b', { resolve });
    expect(stub.requests).toEqual([
      { method: 'POST', path: '/api/generate', body: { model: 'gamma:26b', stream: false } },
    ]);
    const found = await findOllama([base.href], { resolve });
    expect(found?.read.models.find((model) => model.name === 'gamma:26b')).toMatchObject({
      gpu: 'part',
      gpuPercent: 25,
    });
  });

  it('comes back, having said nothing, when Ollama refuses, is gone, or does not answer in time', async () => {
    // No `load` scripted: a 404.
    const stub = await stubOf(CURRENT_SERVER);
    await expect(
      loadModel(new URL(at('models-box', stub.port)), 'gamma:26b', { resolve }),
    ).resolves.toBeUndefined();
    const closed = await startOllamaStub(CURRENT_SERVER);
    await closed.close();
    await expect(
      loadModel(new URL(at('closed-box', closed.port)), 'gamma:26b', { resolve }),
    ).resolves.toBeUndefined();
    const hangs = (): Promise<readonly string[]> => new Promise(() => undefined);
    await expect(
      loadModel(new URL(at('hung-box', 1)), 'gamma:26b', { resolve: hangs, loadMs: 50 }),
    ).resolves.toBeUndefined();
  });
});
