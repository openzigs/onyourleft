// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The side camera's encoder — #1112. The worker's own encode needs a real
 * engine and is `browser/sidecamera.browser.spec.ts` §"#1112"'s; this holds
 * the page's half: the message readers, which picture an answer belongs to,
 * and that every way the worker can fail falls back to the main thread.
 */

import { describe, expect, it } from 'vitest';

import { sideEncodeReplyFrom, sideEncodeRequestFrom } from './side-encode-messages';
import {
  SIDE_ENCODE_DEADLINE_MILLISECONDS,
  sidePictureEncoder,
  workerJpegEncoder,
  type EncoderWorkerLike,
  type JpegEncoder,
} from './side-picture-encoder';

const CANVAS = {} as HTMLCanvasElement;
const BITMAP = { width: 4, height: 3, close: () => undefined } as unknown as ImageBitmap;

/** A worker the test answers by hand. */
function fakeWorker(): EncoderWorkerLike & {
  readonly posted: unknown[];
  terminated: number;
  answer(data: unknown): void;
} {
  const worker = {
    posted: [] as unknown[],
    terminated: 0,
    onmessage: null as ((event: { readonly data: unknown }) => void) | null,
    onerror: null as ((event: unknown) => void) | null,
    postMessage(message: unknown): void {
      worker.posted.push(message);
    },
    terminate(): void {
      worker.terminated += 1;
    },
    answer(data: unknown): void {
      worker.onmessage?.({ data });
    },
  };
  return worker;
}

/** A fallback that counts its calls. */
function countingFallback(): JpegEncoder & { calls: number; released: number } {
  const fallback = {
    calls: 0,
    released: 0,
    encode: () => {
      fallback.calls += 1;
      return Promise.resolve({ bytes: new Uint8Array([1]), encoder: 'main-thread' as const });
    },
    release: () => {
      fallback.released += 1;
    },
  };
  return fallback;
}

/** A hand-run one-shot timer. */
function manualAfter(): {
  after: (task: () => void, milliseconds: number) => () => void;
  fire: () => void;
  delays: number[];
} {
  let pending: (() => void) | undefined;
  const delays: number[] = [];
  return {
    delays,
    after: (task, milliseconds) => {
      pending = task;
      delays.push(milliseconds);
      return () => {
        pending = undefined;
      };
    },
    fire: () => {
      pending?.();
    },
  };
}

async function settle(): Promise<void> {
  for (let round = 0; round < 10; round += 1) {
    await Promise.resolve();
  }
}

/** The id of the newest request a worker was posted. */
function lastId(worker: ReturnType<typeof fakeWorker>): number {
  return (worker.posted.at(-1) as { id: number }).id;
}

describe('the messages', () => {
  it('reads a reply only for the picture it was asked for', () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer;
    expect(sideEncodeReplyFrom({ id: 2, bytes }, 2)).toEqual({ bytes: new Uint8Array(bytes) });
    expect(sideEncodeReplyFrom({ id: 1, bytes }, 2)).toBeUndefined();
    expect(sideEncodeReplyFrom({ id: 2, failed: true }, 2)).toBe('failed');
    expect(sideEncodeReplyFrom({ id: 2, bytes: new ArrayBuffer(0) }, 2)).toBeUndefined();
    expect(sideEncodeReplyFrom({ id: 2, bytes: 'ffd8' }, 2)).toBeUndefined();
    expect(sideEncodeReplyFrom(null, 2)).toBeUndefined();
    expect(sideEncodeReplyFrom('picture', 2)).toBeUndefined();
  });

  it('reads a request only with every field', () => {
    const request = { id: 1, bitmap: BITMAP, mediaType: 'image/jpeg', quality: 0.8 };
    expect(sideEncodeRequestFrom(request)).toBe(request);
    expect(sideEncodeRequestFrom({ ...request, bitmap: null })).toBeUndefined();
    expect(sideEncodeRequestFrom({ ...request, id: '1' })).toBeUndefined();
    expect(sideEncodeRequestFrom({ ...request, quality: undefined })).toBeUndefined();
    expect(sideEncodeRequestFrom({ ...request, mediaType: 7 })).toBeUndefined();
    expect(sideEncodeRequestFrom(undefined)).toBeUndefined();
  });
});

describe('the worker encoder', () => {
  it('hands the pixels to the worker and returns its bytes', async () => {
    const worker = fakeWorker();
    const fallback = countingFallback();
    const encoder = workerJpegEncoder({
      worker: () => worker,
      bitmap: () => Promise.resolve(BITMAP),
      fallback,
      after: manualAfter().after,
    });
    const encoding = encoder.encode(CANVAS);
    await settle();
    expect(worker.posted).toEqual([
      { id: 1, bitmap: BITMAP, mediaType: 'image/jpeg', quality: 0.8 },
    ]);
    worker.answer({ id: 1, bytes: new Uint8Array([9, 8]).buffer });
    expect(await encoding).toEqual({ bytes: new Uint8Array([9, 8]), encoder: 'worker' });
    expect(fallback.calls).toBe(0);
  });

  it('ignores an answer for another picture', async () => {
    const worker = fakeWorker();
    const timer = manualAfter();
    const encoder = workerJpegEncoder({
      worker: () => worker,
      bitmap: () => Promise.resolve(BITMAP),
      fallback: countingFallback(),
      after: timer.after,
    });
    const encoding = encoder.encode(CANVAS);
    await settle();
    worker.answer({ id: 99, bytes: new Uint8Array([1]).buffer });
    worker.answer({ id: lastId(worker), bytes: new Uint8Array([2]).buffer });
    expect((await encoding).bytes).toEqual(new Uint8Array([2]));
  });

  it('falls back to the main thread, for good, when the worker says it could not', async () => {
    const worker = fakeWorker();
    const fallback = countingFallback();
    const encoder = workerJpegEncoder({
      worker: () => worker,
      bitmap: () => Promise.resolve(BITMAP),
      fallback,
      after: manualAfter().after,
    });
    const encoding = encoder.encode(CANVAS);
    await settle();
    worker.answer({ id: lastId(worker), failed: true });
    expect((await encoding).encoder).toBe('main-thread');
    expect(worker.terminated).toBe(1);
    expect((await encoder.encode(CANVAS)).encoder).toBe('main-thread');
    expect(worker.posted).toHaveLength(1);
    expect(fallback.calls).toBe(2);
  });

  it('falls back when the worker does not answer inside the deadline', async () => {
    const worker = fakeWorker();
    const timer = manualAfter();
    const encoder = workerJpegEncoder({
      worker: () => worker,
      bitmap: () => Promise.resolve(BITMAP),
      fallback: countingFallback(),
      after: timer.after,
    });
    const encoding = encoder.encode(CANVAS);
    await settle();
    expect(timer.delays).toEqual([SIDE_ENCODE_DEADLINE_MILLISECONDS]);
    timer.fire();
    expect((await encoding).encoder).toBe('main-thread');
    expect(worker.terminated).toBe(1);
  });

  it('falls back when the worker errors', async () => {
    const worker = fakeWorker();
    const encoder = workerJpegEncoder({
      worker: () => worker,
      bitmap: () => Promise.resolve(BITMAP),
      fallback: countingFallback(),
      after: manualAfter().after,
    });
    const encoding = encoder.encode(CANVAS);
    await settle();
    worker.onerror?.(new Event('error'));
    expect((await encoding).encoder).toBe('main-thread');
  });

  it('falls back when no worker can be made, or the pixels cannot be taken', async () => {
    const unbuildable = workerJpegEncoder({
      worker: () => {
        throw new Error('no workers here');
      },
      bitmap: () => Promise.resolve(BITMAP),
      fallback: countingFallback(),
    });
    expect((await unbuildable.encode(CANVAS)).encoder).toBe('main-thread');

    const worker = fakeWorker();
    const unreadable = workerJpegEncoder({
      worker: () => worker,
      bitmap: () => Promise.reject(new Error('no bitmap')),
      fallback: countingFallback(),
    });
    expect((await unreadable.encode(CANVAS)).encoder).toBe('main-thread');
    expect(worker.posted).toEqual([]);
  });

  it('lets the worker go when released', async () => {
    const worker = fakeWorker();
    const fallback = countingFallback();
    const encoder = workerJpegEncoder({
      worker: () => worker,
      bitmap: () => Promise.resolve(BITMAP),
      fallback,
      after: manualAfter().after,
    });
    const encoding = encoder.encode(CANVAS);
    await settle();
    encoder.release();
    expect(worker.terminated).toBe(1);
    expect(fallback.released).toBe(1);
    // The picture in flight is not left hanging: it falls back like a failure.
    await expect(encoding).resolves.toMatchObject({ encoder: 'main-thread' });
  });
});

describe('which encoder a page gets', () => {
  it('is the main thread where the engine has no OffscreenCanvas — jsdom has none', () => {
    expect(typeof OffscreenCanvas).toBe('undefined');
    expect(sidePictureEncoder()).toMatchObject({ encode: expect.any(Function) as unknown });
  });
});
