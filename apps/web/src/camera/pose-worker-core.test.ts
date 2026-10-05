// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The pose worker's rules about the picture — #1061, from #1123's review (B2).
 * `pose-worker.ts` runs only in a real engine; what it does with a decoded
 * picture is `pose-worker-core.ts`, run here against a fake model.
 */

import { describe, expect, it } from 'vitest';

import {
  answerPoseRequest,
  poseReplyTransfer,
  respondToPoseRequest,
  type PoseWorkerDependencies,
} from './pose-worker-core';
import type { PoseReply } from './pose-runtime';

/** A decoded picture that counts its closes. */
function decoded() {
  let closes = 0;
  const bitmap = {
    width: 640,
    height: 360,
    close: () => {
      closes += 1;
    },
  } as unknown as ImageBitmap;
  return { bitmap, closes: () => closes };
}

const POINT = { x: 0.25, y: 0.5, visibility: 0.9 };

function dependencies(
  bitmap: ImageBitmap,
  look: (picture: ImageBitmap) => readonly (typeof POINT)[] = () => [POINT],
): PoseWorkerDependencies {
  return {
    look: async () => Promise.resolve(look),
    decode: async () => Promise.resolve(bitmap),
  };
}

const PICTURE = new ArrayBuffer(8);

describe('the pose worker’s answer to one picture', () => {
  it('closes a picture nobody asked to see, and hands back no pixels', async () => {
    const picture = decoded();
    const reply = await answerPoseRequest(
      { id: 3, picture: PICTURE },
      dependencies(picture.bitmap),
    );
    expect(reply).toStrictEqual({
      id: 3,
      kind: 'landmarks',
      width: 640,
      height: 360,
      values: [0.25, 0.5, 0.9],
    });
    expect(picture.closes()).toBe(1);
    expect(poseReplyTransfer(reply)).toStrictEqual([]);
  });

  it('closes it when `show` is false, as it always did', async () => {
    const picture = decoded();
    const reply = await answerPoseRequest(
      { id: 3, picture: PICTURE, show: false },
      dependencies(picture.bitmap),
    );
    expect('pixels' in reply).toBe(false);
    expect(picture.closes()).toBe(1);
  });

  // Closed before the post, a bitmap throws `DataCloneError` in a real engine: no reply would go,
  // and the analysis would go `unavailable` whenever the live view is watched.
  it('does NOT close a picture the page asked to see, and hands that very picture back', async () => {
    const picture = decoded();
    const reply = await answerPoseRequest(
      { id: 4, picture: PICTURE, show: true },
      dependencies(picture.bitmap),
    );
    expect(reply.kind).toBe('landmarks');
    expect(reply.kind === 'landmarks' ? reply.pixels : undefined).toBe(picture.bitmap);
    expect(picture.closes()).toBe(0);
  });

  // Not transferred, the post is a clone and the worker keeps a copy nothing closes (D-1).
  it('transfers a handed-back picture, so the worker keeps no copy', async () => {
    const picture = decoded();
    const reply = await answerPoseRequest(
      { id: 4, picture: PICTURE, show: true },
      dependencies(picture.bitmap),
    );
    expect(poseReplyTransfer(reply)).toStrictEqual([picture.bitmap]);
  });

  it('posts the reply with that transfer list — the worker’s whole handling of a request', async () => {
    const shown = decoded();
    const posts: { reply: PoseReply; transfer: Transferable[] }[] = [];
    await respondToPoseRequest(
      { id: 8, picture: PICTURE, show: true },
      dependencies(shown.bitmap),
      (reply, transfer) => posts.push({ reply, transfer }),
    );
    const unshown = decoded();
    await respondToPoseRequest(
      { id: 9, picture: PICTURE },
      dependencies(unshown.bitmap),
      (reply, transfer) => posts.push({ reply, transfer }),
    );
    expect(posts.map(({ reply }) => reply.id)).toStrictEqual([8, 9]);
    expect(posts[0]?.transfer).toStrictEqual([shown.bitmap]);
    expect(posts[1]?.transfer).toStrictEqual([]);
    expect(shown.closes()).toBe(0);
    expect(unshown.closes()).toBe(1);
  });

  it('closes the picture when the model fails on it, even one asked to be shown', async () => {
    const picture = decoded();
    const reply = await answerPoseRequest(
      { id: 5, picture: PICTURE, show: true },
      dependencies(picture.bitmap, () => {
        throw new Error('model fault');
      }),
    );
    expect(reply).toStrictEqual({ id: 5, kind: 'unreadable' });
    expect(picture.closes()).toBe(1);
    expect(poseReplyTransfer(reply)).toStrictEqual([]);
  });

  it('answers `unreadable` for a picture that will not decode, and `unavailable` with no model', async () => {
    const failing: PoseWorkerDependencies = {
      look: async () => Promise.resolve(() => [POINT]),
      decode: async () => Promise.reject(new Error('not a JPEG')),
    };
    expect(await answerPoseRequest({ id: 6, picture: PICTURE, show: true }, failing)).toStrictEqual(
      { id: 6, kind: 'unreadable' },
    );
    const picture = decoded();
    const noModel: PoseWorkerDependencies = {
      look: async () => Promise.resolve(undefined),
      decode: async () => Promise.resolve(picture.bitmap),
    };
    const reply: PoseReply = await answerPoseRequest({ id: 7, picture: PICTURE }, noModel);
    expect(reply).toStrictEqual({ id: 7, kind: 'unavailable' });
  });
});
