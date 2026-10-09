// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The side camera's encoder — #1112. The worker's own encode needs a real
 * engine and is `browser/sidecamera.browser.spec.ts` §"#1112"'s; this holds
 * the page's half: the message readers, which picture an answer belongs to,
 * and that every way the worker can fail falls back to the main thread.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { CameraCaptureError } from './camera-port';

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

/**
 * Hand-run timers that keep every task, so an EARLIER picture's deadline can
 * be fired while a later one waits. `fire` runs a task whether or not it was
 * cancelled — a timer the platform had already queued — and `cancelled` says
 * whether the encoder tried to stop it.
 */
function manualTimers(): {
  after: (task: () => void, milliseconds: number) => () => void;
  fire: (index: number) => void;
  cancelled: (index: number) => boolean;
} {
  const timers: { task: () => void; cancelled: boolean }[] = [];
  return {
    after: (task) => {
      const timer = { task, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    fire: (index) => {
      timers[index]?.task();
    },
    cancelled: (index) => timers[index]?.cancelled ?? false,
  };
}

/** A bitmap that counts how often it is closed. */
function countedBitmap(): ImageBitmap & { closed: number } {
  const bitmap = {
    width: 4,
    height: 3,
    closed: 0,
    close: () => {
      bitmap.closed += 1;
    },
  };
  return bitmap;
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
    await settle();
    encoder.release();
    expect(fallback.released).toBe(1);
    encoder.release();
    expect(fallback.released).toBe(2);
  });

  it('makes no picture of one in flight at release, and never hands it to the main thread — ADR 0033 D-5', async () => {
    const worker = fakeWorker();
    const fallback = countingFallback();
    let made = 0;
    const encoder = workerJpegEncoder({
      worker: () => {
        made += 1;
        return worker;
      },
      bitmap: () => Promise.resolve(BITMAP),
      fallback,
      after: manualAfter().after,
    });
    const encoding = encoder.encode(CANVAS);
    await settle();
    encoder.release();
    expect(worker.terminated).toBe(1);
    await expect(encoding).rejects.toBeInstanceOf(CameraCaptureError);
    // An answer the worker had already sent changes nothing.
    worker.answer({ id: lastId(worker), bytes: new Uint8Array([1]).buffer });
    // And a picture asked for afterwards is refused too, with no worker made.
    await expect(encoder.encode(CANVAS)).rejects.toBeInstanceOf(CameraCaptureError);
    expect(made).toBe(1);
    expect(fallback.calls).toBe(0);
    expect(worker.posted).toHaveLength(1);
  });

  it('closes the pixels and posts nothing when released while they were being taken', async () => {
    const worker = fakeWorker();
    const fallback = countingFallback();
    const bitmap = countedBitmap();
    let hand: (made: ImageBitmap) => void = () => undefined;
    const encoder = workerJpegEncoder({
      worker: () => worker,
      bitmap: () =>
        new Promise<ImageBitmap>((resolve) => {
          hand = resolve;
        }),
      fallback,
      after: manualAfter().after,
    });
    const encoding = encoder.encode(CANVAS);
    await settle();
    encoder.release();
    hand(bitmap);
    await expect(encoding).rejects.toBeInstanceOf(CameraCaptureError);
    expect(bitmap.closed).toBe(1);
    expect(worker.posted).toEqual([]);
    expect(fallback.calls).toBe(0);
  });

  it('closes the pixels when they cannot be posted, and falls back', async () => {
    const worker = fakeWorker();
    worker.postMessage = () => {
      throw new DOMException('could not clone', 'DataCloneError');
    };
    const bitmap = countedBitmap();
    const encoder = workerJpegEncoder({
      worker: () => worker,
      bitmap: () => Promise.resolve(bitmap),
      fallback: countingFallback(),
      after: manualAfter().after,
    });
    expect((await encoder.encode(CANVAS)).encoder).toBe('main-thread');
    expect(bitmap.closed).toBe(1);
  });

  it('does not let an earlier picture’s deadline fail the picture waiting now', async () => {
    const worker = fakeWorker();
    const fallback = countingFallback();
    const timers = manualTimers();
    const encoder = workerJpegEncoder({
      worker: () => worker,
      bitmap: () => Promise.resolve(BITMAP),
      fallback,
      after: timers.after,
    });
    const first = encoder.encode(CANVAS);
    await settle();
    worker.answer({ id: lastId(worker), bytes: new Uint8Array([1]).buffer });
    expect((await first).encoder).toBe('worker');
    // Picture 1's deadline was stopped once it was answered…
    expect(timers.cancelled(0)).toBe(true);

    let second: { readonly encoder: string } | undefined;
    void encoder.encode(CANVAS).then((made) => {
      second = made;
    });
    await settle();
    // …and if it goes off anyway, while picture 2 waits, picture 2 is untouched.
    timers.fire(0);
    worker.answer({ id: lastId(worker), bytes: new Uint8Array([2]).buffer });
    await settle();
    expect(second).toEqual({ bytes: new Uint8Array([2]), encoder: 'worker' });
    expect(worker.terminated).toBe(0);
    expect(fallback.calls).toBe(0);
  });
});

describe('which encoder a page gets', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** A canvas whose `toBlob` is counted and never answers. */
  function countedCanvas(): HTMLCanvasElement & { toBlobs: number } {
    const canvas = {
      toBlobs: 0,
      toBlob: () => {
        canvas.toBlobs += 1;
      },
    };
    return canvas as unknown as HTMLCanvasElement & { toBlobs: number };
  }

  /** Every platform piece the worker encoder needs, with the workers made counted. */
  function stubTheEngine(): { workers: unknown[] } {
    const workers: unknown[] = [];
    vi.stubGlobal(
      'Worker',
      class {
        onmessage = null;
        onerror = null;
        constructor() {
          workers.push(this);
        }
        postMessage(): void {
          // Never answers; the test releases the encoder instead.
        }
        terminate(): void {
          // Nothing held.
        }
      },
    );
    vi.stubGlobal('OffscreenCanvas', class {});
    vi.stubGlobal('createImageBitmap', () => Promise.resolve(BITMAP));
    return { workers };
  }

  it('is the worker where the engine has Worker, OffscreenCanvas and createImageBitmap', async () => {
    const { workers } = stubTheEngine();
    const encoder = sidePictureEncoder();
    const canvas = countedCanvas();
    const encoding = encoder.encode(canvas).catch(() => undefined);
    await settle();
    expect(workers).toHaveLength(1);
    expect(canvas.toBlobs).toBe(0);
    encoder.release();
    await encoding;
  });

  it.each(['Worker', 'OffscreenCanvas', 'createImageBitmap'])(
    'is the main thread where the engine has no %s',
    async (missing) => {
      const { workers } = stubTheEngine();
      vi.stubGlobal(missing, undefined);
      const canvas = countedCanvas();
      void sidePictureEncoder().encode(canvas);
      await settle();
      expect(canvas.toBlobs).toBe(1);
      expect(workers).toEqual([]);
    },
  );
});
