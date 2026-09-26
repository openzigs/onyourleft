// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The pose model from the page's side** — #530. A scripted worker stands in
 * for `pose-worker.ts`, which only a real engine can run.
 */

import { describe, expect, it } from 'vitest';

import {
  POSE_REPLY_DEADLINE_MILLISECONDS,
  workerPoseEstimator,
  type PoseWorkerLike,
} from './pose-estimator';
import { cleanFrameBytes, virtualTime } from './testing';

interface Posted {
  readonly message: { readonly id: number; readonly picture: ArrayBuffer };
  readonly transfer: readonly Transferable[] | undefined;
}

function scriptedWorker(): PoseWorkerLike & {
  readonly posted: Posted[];
  terminated: number;
  reply(data: unknown): void;
  crash(): void;
} {
  const worker = {
    posted: [] as Posted[],
    terminated: 0,
    onmessage: null as PoseWorkerLike['onmessage'],
    onerror: null as PoseWorkerLike['onerror'],
    postMessage(message: unknown, transfer?: Transferable[]) {
      worker.posted.push({ message: message as Posted['message'], transfer });
    },
    terminate() {
      worker.terminated += 1;
    },
    reply(data: unknown) {
      worker.onmessage?.({ data });
    },
    crash() {
      worker.onerror?.(new Event('error'));
    },
  };
  return worker;
}

async function flush(): Promise<void> {
  for (let round = 0; round < 5; round += 1) {
    await Promise.resolve();
  }
}

describe('one picture to the worker', () => {
  it('makes no worker until there is a picture to look at', () => {
    let made = 0;
    workerPoseEstimator(() => {
      made += 1;
      return scriptedWorker();
    });
    expect(made).toBe(0);
  });

  it('transfers exactly the picture’s bytes, and answers with what the worker found', async () => {
    const worker = scriptedWorker();
    const estimator = workerPoseEstimator(() => worker);
    const whole = cleanFrameBytes(4096);
    // A view into a larger buffer, as a picture sliced off a message would be.
    const picture = whole.subarray(100, 1100);
    const outcome = estimator.estimateSidePose(picture);
    const sent = worker.posted[0];
    expect(sent?.message.picture.byteLength).toBe(1000);
    expect(new Uint8Array(sent?.message.picture ?? new ArrayBuffer(0))[0]).toBe(whole[100]);
    expect(sent?.transfer).toEqual([sent?.message.picture]);
    worker.reply({ id: sent?.message.id, kind: 'landmarks', width: 256, height: 256, values: [] });
    await expect(outcome).resolves.toEqual({ kind: 'no-rider' });
  });

  it('matches each reply to its picture by id', async () => {
    const worker = scriptedWorker();
    const estimator = workerPoseEstimator(() => worker);
    const first = estimator.estimateSidePose(cleanFrameBytes());
    const second = estimator.estimateSidePose(cleanFrameBytes());
    const [a, b] = worker.posted.map((post) => post.message.id);
    worker.reply({ id: b, kind: 'unreadable' });
    worker.reply({ id: a, kind: 'landmarks', width: 1, height: 1, values: [] });
    await expect(first).resolves.toEqual({ kind: 'no-rider' });
    await expect(second).resolves.toEqual({ kind: 'unreadable' });
  });
});

describe('when the worker fails', () => {
  it('answers unavailable for every picture waiting, and never makes another worker', async () => {
    let made = 0;
    const worker = scriptedWorker();
    const estimator = workerPoseEstimator(() => {
      made += 1;
      return worker;
    });
    const waiting = estimator.estimateSidePose(cleanFrameBytes());
    worker.crash();
    await expect(waiting).resolves.toEqual({ kind: 'unavailable' });
    expect(worker.terminated).toBe(1);
    await expect(estimator.estimateSidePose(cleanFrameBytes())).resolves.toEqual({
      kind: 'unavailable',
    });
    expect(made).toBe(1);
  });

  it('treats a reply that is not one as a failed worker', async () => {
    const worker = scriptedWorker();
    const estimator = workerPoseEstimator(() => worker);
    const waiting = estimator.estimateSidePose(cleanFrameBytes());
    worker.reply({ id: 0, kind: 'described', text: 'a person on a bicycle' });
    await expect(waiting).resolves.toEqual({ kind: 'unavailable' });
  });

  it('answers unavailable when the worker never replies, with no error either (#555 review)', async () => {
    let made = 0;
    // A worker that takes every picture and never says anything: stuck in its
    // model load, with no `error` event.
    const worker = scriptedWorker();
    const time = virtualTime();
    const estimator = workerPoseEstimator(() => {
      made += 1;
      return worker;
    }, time);
    let outcome: unknown;
    void estimator.estimateSidePose(cleanFrameBytes()).then((answer) => {
      outcome = answer;
    });
    time.advance(POSE_REPLY_DEADLINE_MILLISECONDS - 1);
    await flush();
    expect(outcome).toBeUndefined();
    time.advance(1);
    await flush();
    expect(outcome).toEqual({ kind: 'unavailable' });
    expect(worker.terminated).toBe(1);
    // Dead, as after an error: nothing more is sent and no new worker is made.
    await expect(estimator.estimateSidePose(cleanFrameBytes())).resolves.toEqual({
      kind: 'unavailable',
    });
    expect(worker.posted).toHaveLength(1);
    expect(made).toBe(1);
  });

  it('cancels a picture’s deadline when it is answered, so a slow session is not cut off', async () => {
    const worker = scriptedWorker();
    const time = virtualTime();
    const estimator = workerPoseEstimator(() => worker, time);
    const first = estimator.estimateSidePose(cleanFrameBytes());
    worker.reply({ id: 0, kind: 'unreadable' });
    await expect(first).resolves.toEqual({ kind: 'unreadable' });
    expect(time.active()).toBe(0);
    time.advance(POSE_REPLY_DEADLINE_MILLISECONDS * 2);
    expect(worker.terminated).toBe(0);
  });

  it('answers unavailable when no worker can be made', async () => {
    const estimator = workerPoseEstimator(() => {
      throw new Error('no workers here');
    });
    await expect(estimator.estimateSidePose(cleanFrameBytes())).resolves.toEqual({
      kind: 'unavailable',
    });
  });
});

describe('letting it go', () => {
  it('terminates the worker, settles what was waiting, and refuses anything after', async () => {
    const worker = scriptedWorker();
    const estimator = workerPoseEstimator(() => worker);
    const waiting = estimator.estimateSidePose(cleanFrameBytes());
    estimator.closeSidePoseModel();
    estimator.closeSidePoseModel();
    expect(worker.terminated).toBe(1);
    await expect(waiting).resolves.toEqual({ kind: 'unavailable' });
    await expect(estimator.estimateSidePose(cleanFrameBytes())).resolves.toEqual({
      kind: 'unavailable',
    });
    expect(worker.posted).toHaveLength(1);
  });
});
