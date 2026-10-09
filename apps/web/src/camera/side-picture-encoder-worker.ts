// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The side camera's JPEG encode, in a worker** —
 * [#1112](https://github.com/openzigs/onyourleft/issues/1112).
 *
 * `side-picture-encoder.ts` says why: a main-thread encode waits for the page
 * to go idle, up to 4 s on Android. Here it does not wait. One request in, one
 * reply out: the page's pixels (an `ImageBitmap` of the canvas it drew the
 * video into) drawn into an `OffscreenCanvas` and encoded as a JPEG from
 * pixels — ADR 0029 D-9's re-encode — and the bytes handed back and let go.
 * Nothing is fetched, kept or logged; the only import is the message readers.
 */

import { sideEncodeRequestFrom, type SideEncodeReply } from './side-encode-messages';

/** The slice of a dedicated worker's scope this file uses. */
interface EncoderWorkerScope {
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  postMessage(message: SideEncodeReply, transfer?: Transferable[]): void;
}

const scope = globalThis as unknown as EncoderWorkerScope;

async function encode(data: unknown): Promise<void> {
  const request = sideEncodeRequestFrom(data);
  if (request === undefined) {
    return;
  }
  const { bitmap } = request;
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (context === null) {
      scope.postMessage({ id: request.id, failed: true });
      return;
    }
    context.drawImage(bitmap, 0, 0);
    const blob = await canvas.convertToBlob({ type: request.mediaType, quality: request.quality });
    const bytes = await blob.arrayBuffer();
    scope.postMessage({ id: request.id, bytes }, [bytes]);
  } catch {
    scope.postMessage({ id: request.id, failed: true });
  } finally {
    bitmap.close();
  }
}

scope.onmessage = (event) => {
  void encode(event.data);
};
