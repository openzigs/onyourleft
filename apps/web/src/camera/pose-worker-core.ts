// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What the pose worker does with one picture**, without the worker — #1061,
 * from #1123's review.
 *
 * `pose-worker.ts` runs in a Web Worker beside MediaPipe, and Vitest never
 * loads it. So its rules about the PICTURE live here, where they are tested
 * with a fake model and a fake decoded picture:
 *
 * - a picture nobody asked to see is closed as soon as the model has answered
 *   (ADR 0029 D-6);
 * - a picture the page asked to see (`show`, ADR 0044 D-1) is NOT closed here
 *   — posting a closed `ImageBitmap` throws `DataCloneError`, so the reply
 *   would never go and the analysis would fail whenever the live view is
 *   watched;
 * - a picture handed back is in the post's TRANSFER list, so the worker keeps
 *   no copy of it that nothing would close.
 *
 * ⚠️ The model is reached through {@link PoseWorkerDependencies.look}, never
 * called here: `model-in-worker.test.ts` holds every call of the model to
 * `pose-worker.ts` alone.
 */

import type { PoseReply, PoseRequest } from './pose-runtime';

/** One point the model found, as MediaPipe reports it. */
export interface PoseWorkerPoint {
  readonly x: number;
  readonly y: number;
  readonly visibility: number;
}

/** What answering a picture needs from the worker. */
export interface PoseWorkerDependencies {
  /**
   * The model's look at a decoded picture — its first person's points, or
   * none — or `undefined` when the model would not load.
   */
  readonly look: () => Promise<((picture: ImageBitmap) => readonly PoseWorkerPoint[]) | undefined>;
  /** Decode a JPEG. Rejects on a picture that will not decode. */
  readonly decode: (picture: ArrayBuffer) => Promise<ImageBitmap>;
}

/**
 * One picture: decode it, look at it, and drop it — or, when the page asked to
 * show it, hand the decoded picture back with the landmarks instead of closing
 * it. The page then holds the one picture it shows and closes it when the next
 * replaces it.
 */
export async function answerPoseRequest(
  request: PoseRequest,
  dependencies: PoseWorkerDependencies,
): Promise<PoseReply> {
  const look = await dependencies.look();
  if (look === undefined) {
    return { id: request.id, kind: 'unavailable' };
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await dependencies.decode(request.picture);
  } catch {
    return { id: request.id, kind: 'unreadable' };
  }
  let handedBack = false;
  try {
    const found = look(bitmap);
    const reply = {
      id: request.id,
      kind: 'landmarks' as const,
      width: bitmap.width,
      height: bitmap.height,
      values: found.flatMap((point) => [point.x, point.y, point.visibility]),
    };
    if (request.show === true) {
      handedBack = true;
      return { ...reply, pixels: bitmap };
    }
    return reply;
  } catch {
    return { id: request.id, kind: 'unreadable' };
  } finally {
    // The decoded picture goes now, not when the collector gets to it (D-6) —
    // unless it is on its way back to the page to be shown.
    if (!handedBack) {
      bitmap.close();
    }
  }
}

/**
 * What a reply is posted with: a picture handed back is TRANSFERRED, so the
 * worker keeps no copy of it.
 */
export function poseReplyTransfer(reply: PoseReply): Transferable[] {
  const pixels = 'pixels' in reply ? reply.pixels : undefined;
  return pixels === undefined ? [] : [pixels];
}

/**
 * Answer one picture and post the reply with {@link poseReplyTransfer}'s
 * list — the whole of what the worker does with a request, so its own code is
 * one call and nothing about the picture is left there untested.
 */
export async function respondToPoseRequest(
  request: PoseRequest,
  dependencies: PoseWorkerDependencies,
  post: (reply: PoseReply, transfer: Transferable[]) => void,
): Promise<void> {
  const reply = await answerPoseRequest(request, dependencies);
  post(reply, poseReplyTransfer(reply));
}
