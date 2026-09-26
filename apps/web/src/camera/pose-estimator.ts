// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The tablet's pose model, from the page's side: a worker, one picture at a
 * time** — [#530](https://github.com/openzigs/onyourleft/issues/530).
 *
 * {@link workerPoseEstimator} is the production `SidePoseEstimator`. It makes
 * the worker (`pose-worker.ts`) on the first picture rather than at pairing,
 * so a pairing that never films never loads 17 MB of model and runtime; and
 * it **transfers** each picture's bytes to the worker, so the page holds no
 * copy of a picture it has handed over (ADR 0033 D-6).
 *
 * ## What a failure is
 *
 * A worker that errors, or a reply that is not one, makes every picture
 * waiting on it `unavailable` and the estimator dead: nothing more is sent to
 * a worker that has failed once, and the screen says the model is
 * unavailable rather than counting pictures as unreadable for ever.
 */

import type { SidePoseEstimator, SidePoseOutcome } from './side-analysis-port';
import { poseOutcomeOf, poseReplyFrom } from './pose-runtime';

/** The slice of a `Worker` the estimator uses, so a test can supply one. */
export interface PoseWorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

/**
 * The real worker.
 *
 * ⚠️ **This exact expression is what Vite looks for** — `new Worker(new
 * URL(…, import.meta.url), …)` — to bundle `pose-worker.ts` and everything it
 * imports into a worker script. Rewritten as anything else it still
 * typechecks, and the build ships a URL to a `.ts` file that does not exist.
 */
export function poseWorker(): PoseWorkerLike {
  return new Worker(new URL('./pose-worker.ts', import.meta.url), {
    type: 'module',
    name: 'oyl-pose',
  }) as unknown as PoseWorkerLike;
}

/** A pose estimator over a worker made by `makeWorker` — {@link poseWorker} in production. */
export function workerPoseEstimator(
  makeWorker: () => PoseWorkerLike = poseWorker,
): SidePoseEstimator {
  let worker: PoseWorkerLike | undefined;
  let dead = false;
  let next = 0;
  const waiting = new Map<number, (outcome: SidePoseOutcome) => void>();

  const fail = (): void => {
    dead = true;
    worker?.terminate();
    worker = undefined;
    for (const settle of waiting.values()) {
      settle({ kind: 'unavailable' });
    }
    waiting.clear();
  };

  const started = (): PoseWorkerLike | undefined => {
    if (dead) {
      return undefined;
    }
    if (worker === undefined) {
      try {
        worker = makeWorker();
      } catch {
        fail();
        return undefined;
      }
      worker.onmessage = (event) => {
        const reply = poseReplyFrom(event.data);
        if (reply === undefined) {
          fail();
          return;
        }
        const settle = waiting.get(reply.id);
        waiting.delete(reply.id);
        settle?.(poseOutcomeOf(reply));
      };
      worker.onerror = () => {
        fail();
      };
    }
    return worker;
  };

  return {
    async estimateSidePose(picture: Uint8Array): Promise<SidePoseOutcome> {
      const target = started();
      if (target === undefined) {
        return { kind: 'unavailable' };
      }
      // Exactly the picture's bytes, in a buffer of their own, so the transfer
      // moves nothing else and leaves the caller nothing to read.
      const buffer =
        picture.byteOffset === 0 && picture.byteLength === picture.buffer.byteLength
          ? (picture.buffer as ArrayBuffer)
          : picture.slice().buffer;
      const id = next;
      next += 1;
      return new Promise<SidePoseOutcome>((resolve) => {
        waiting.set(id, resolve);
        try {
          target.postMessage({ id, picture: buffer }, [buffer]);
        } catch {
          fail();
        }
      });
    },
    closeSidePoseModel(): void {
      if (dead) {
        return;
      }
      // Terminated, not asked to close: a closed task flushes MediaPipe's
      // usage log, which the fence would refuse anyway, and a terminated
      // worker has nothing left to flush.
      dead = true;
      worker?.terminate();
      worker = undefined;
      for (const settle of waiting.values()) {
        settle({ kind: 'unavailable' });
      }
      waiting.clear();
    },
  };
}
