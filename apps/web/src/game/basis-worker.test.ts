// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1683 §3: the installed `three`'s own Basis worker, run as `KTX2Loader`
 * writes it — the body of `KTX2Loader.BasisWorker`, after the transcoder's
 * script — in a scope of its own, with the transcoder replaced by one that
 * fails to start in each way it can, and one that starts.
 *
 * The control is three's worker as it ships: given a transcoder that cannot
 * start, it answers nothing, ever — the hang #1683 found.
 *
 * ⚠️ **Read off the installed file, not imported**: `three-seam.test.ts`
 * allows one importer of three, `three-renderer.ts`. The function is sliced
 * out of `KTX2Loader.js`'s text, which is the text `toString` would give.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { settlingBasisWorker } from './basis-worker';

const KTX2_LOADER = readFileSync(
  createRequire(import.meta.url).resolve('three/examples/jsm/loaders/KTX2Loader.js'),
  'utf8',
);
const WORKER_STARTS = 'KTX2Loader.BasisWorker = function () {';

/** `KTX2Loader.BasisWorker`, as the installed `three` declares it. */
function shippedWorker(): () => void {
  const start = KTX2_LOADER.indexOf(WORKER_STARTS);
  const end = KTX2_LOADER.indexOf('\n};', start);
  if (start === -1 || end === -1) {
    throw new Error('KTX2Loader.js no longer declares BasisWorker as this test reads it');
  }
  const text = KTX2_LOADER.slice(start + 'KTX2Loader.BasisWorker = '.length, end + 2);
  return runInNewContext(`(${text})`) as () => void;
}

/** Emscripten's module object, as three's worker hands it to `BASIS`. */
interface BasisModule {
  onRuntimeInitialized: () => void;
  initializeBasis?: () => void;
  KTX2File?: new (bytes: Uint8Array) => unknown;
}

interface Running {
  /** A message from the page, as `WorkerPool` posts it. */
  send(data: unknown): void;
  /** An event on the worker's global scope, as the browser dispatches it. */
  emit(type: 'error' | 'unhandledrejection', event: object): void;
  readonly posted: { type: string; id?: number; error?: string }[];
}

/** `worker`'s body, run as `KTX2Loader.init` writes it, over `basis` for the transcoder. */
function run(worker: () => void, basis: (module: BasisModule) => unknown): Running {
  const listeners = new Map<string, ((event: object) => void)[]>();
  const posted: Running['posted'] = [];
  const self = {
    addEventListener(type: string, listener: (event: object) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    postMessage(message: Running['posted'][number]) {
      posted.push(message);
    },
  };
  const fn = worker.toString();
  runInNewContext(fn.substring(fn.indexOf('{') + 1, fn.lastIndexOf('}')), {
    self,
    BASIS: basis,
    // What `KTX2Loader.init` writes ahead of the body; no case here transcodes far enough to read them.
    _EngineFormat: {},
    _EngineType: {},
    _TranscoderFormat: {},
    _BasisFormat: {},
    console: { error: () => undefined, warn: () => undefined },
  });
  const dispatch = (type: string, event: object): void => {
    for (const listener of listeners.get(type) ?? []) listener(event);
  };
  return {
    send: (data) => {
      dispatch('message', { data });
    },
    emit: dispatch,
    posted,
  };
}

const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const init = { type: 'init', config: {}, transcoderBinary: new ArrayBuffer(0) };
const transcode = (id: number) => ({ type: 'transcode', id, buffer: new ArrayBuffer(0) });

/** A transcoder that never calls `onRuntimeInitialized` and says nothing: only an event tells. */
const neverStarts = (): void => undefined;

/** Emscripten's start failing: its ready promise rejects, and nobody else holds it. */
const rejects = (reason: Error) => (): Promise<never> => Promise.reject(reason);

const SHIPPED = shippedWorker();
const SETTLING = settlingBasisWorker(SHIPPED);
const EVAL_REFUSED = new EvalError("'unsafe-eval' is not an allowed source of script");

describe('a transcoder that cannot start — #1683', () => {
  it('control: three’s worker as it ships never answers, which is the hang', async () => {
    const worker = run(SHIPPED, () => {
      // Handled here only so that this test does not leak it: three never reads it.
      const ready = rejects(EVAL_REFUSED)();
      ready.catch(() => undefined);
      return ready;
    });
    worker.send(init);
    worker.send(transcode(1));
    worker.emit('unhandledrejection', { reason: EVAL_REFUSED });
    await settled();
    expect(worker.posted).toEqual([]);
  });

  it('answers the transcode it was waiting on when the start rejects', async () => {
    let fail: (reason: Error) => void = () => undefined;
    const worker = run(SETTLING, () => new Promise((_, reject) => (fail = reject)));
    worker.send(init);
    worker.send(transcode(1));
    await settled();
    expect(worker.posted).toEqual([]);
    fail(EVAL_REFUSED);
    await settled();
    expect(worker.posted).toEqual([
      {
        type: 'error',
        id: 1,
        error:
          "The texture transcoder could not start: 'unsafe-eval' is not an allowed source of script",
        data: {},
      },
    ]);
  });

  it('answers every transcode sent after the start has failed, at once', async () => {
    const worker = run(SETTLING, rejects(EVAL_REFUSED));
    worker.send(init);
    await settled();
    worker.send(transcode(7));
    worker.send(transcode(8));
    expect(worker.posted.map(({ type, id }) => ({ type, id }))).toEqual([
      { type: 'error', id: 7 },
      { type: 'error', id: 8 },
    ]);
  });

  it('answers when the transcoder throws as it is started', async () => {
    const worker = run(SETTLING, () => {
      throw new Error('no wasm');
    });
    worker.send(init);
    worker.send(transcode(3));
    await settled();
    expect(worker.posted).toMatchObject([
      { type: 'error', id: 3, error: 'The texture transcoder could not start: no wasm' },
    ]);
  });

  it('answers when an error or a rejection reaches the worker before the start', () => {
    for (const [type, event, said] of [
      ['unhandledrejection', { reason: EVAL_REFUSED }, EVAL_REFUSED.message],
      ['error', { message: 'Uncaught RuntimeError: Aborted' }, 'Uncaught RuntimeError: Aborted'],
    ] as const) {
      const worker = run(SETTLING, neverStarts);
      worker.send(init);
      worker.send(transcode(5));
      worker.emit(type, event);
      expect(worker.posted).toMatchObject([
        { type: 'error', id: 5, error: `The texture transcoder could not start: ${said}` },
      ]);
    }
  });

  it('says nothing once the transcoder has started: three answers, once', async () => {
    const worker = run(SETTLING, (module) => {
      module.initializeBasis = () => undefined;
      module.KTX2File = class {
        isValid = () => false;
        close = () => undefined;
        delete = () => undefined;
      };
      queueMicrotask(module.onRuntimeInitialized);
      return Promise.resolve();
    });
    worker.send(init);
    worker.send(transcode(4));
    await settled();
    // A later error is not a start that failed.
    worker.emit('unhandledrejection', { reason: new Error('later') });
    worker.send(transcode(5));
    await settled();
    expect(worker.posted.map(({ id, error }) => ({ id, error }))).toEqual([
      { id: 4, error: 'THREE.KTX2Loader:\tInvalid or unsupported .ktx2 file' },
      { id: 5, error: 'THREE.KTX2Loader:\tInvalid or unsupported .ktx2 file' },
    ]);
  });
});

describe('the worker source it gives KTX2Loader', () => {
  it('is three’s own, with the answer appended inside the body', () => {
    const source = SETTLING.toString();
    expect(
      source.startsWith(SHIPPED.toString().slice(0, SHIPPED.toString().lastIndexOf('}'))),
    ).toBe(true);
    expect(source.trimEnd().endsWith('}')).toBe(true);
    expect(source).toContain('#1683');
  });

  it('is wrapped once however often it is asked, and is never called', () => {
    expect(settlingBasisWorker(SETTLING)).toBe(SETTLING);
    expect(() => {
      SETTLING();
    }).toThrow(/never called/);
  });
});
