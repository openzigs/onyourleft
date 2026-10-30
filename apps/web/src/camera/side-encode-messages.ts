// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The two messages between the page and the side camera's encoder worker**
 * — [#1112](https://github.com/openzigs/onyourleft/issues/1112).
 *
 * Their own module, importing nothing, so the worker
 * (`side-picture-encoder-worker.ts`) bundles these two readers and nothing
 * else. `side-picture-encoder.ts` says why the worker exists.
 */

/** What the page sends the worker. */
export interface SideEncodeRequest {
  readonly id: number;
  readonly bitmap: ImageBitmap;
  readonly mediaType: string;
  readonly quality: number;
}

/** What the worker answers: the bytes, or that it could not. */
export type SideEncodeReply =
  | { readonly id: number; readonly bytes: ArrayBuffer }
  | { readonly id: number; readonly failed: true };

/**
 * The worker's answer to request `id`, or `undefined` for anything that is not
 * one — a reply to another request, a shape this build does not know, or no
 * bytes. The worker is ours, but its messages are read like any other.
 */
export function sideEncodeReplyFrom(
  data: unknown,
  id: number,
): { readonly bytes: Uint8Array } | 'failed' | undefined {
  if (typeof data !== 'object' || data === null) {
    return undefined;
  }
  const reply = data as {
    readonly id?: unknown;
    readonly bytes?: unknown;
    readonly failed?: unknown;
  };
  if (reply.id !== id) {
    return undefined;
  }
  if (reply.failed === true) {
    return 'failed';
  }
  if (reply.bytes instanceof ArrayBuffer && reply.bytes.byteLength > 0) {
    return { bytes: new Uint8Array(reply.bytes) };
  }
  return undefined;
}

/** The request a worker was sent, or `undefined` for anything else. */
export function sideEncodeRequestFrom(data: unknown): SideEncodeRequest | undefined {
  if (typeof data !== 'object' || data === null) {
    return undefined;
  }
  const request = data as Partial<Record<keyof SideEncodeRequest, unknown>>;
  if (
    typeof request.id !== 'number' ||
    typeof request.mediaType !== 'string' ||
    typeof request.quality !== 'number' ||
    typeof request.bitmap !== 'object' ||
    request.bitmap === null
  ) {
    return undefined;
  }
  return request as SideEncodeRequest;
}
