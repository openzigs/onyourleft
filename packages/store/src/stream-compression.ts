// SPDX-License-Identifier: Apache-2.0

/**
 * Compression for stream blobs, over the platform's own `CompressionStream`.
 *
 * ## Why compress at all
 *
 * The packed encoding in `stream-codec.ts` is already 4x smaller than eight
 * `Float64` channels, and #27's whole premise is that a device quota is the
 * thing that bites. A per-second channel is slowly varying by construction —
 * consecutive samples of power, heart rate or latitude differ in their low
 * bits and agree in their high ones — so a general-purpose compressor finds a
 * great deal in it. ADR 0011 records the measured figure; it is between three
 * and five times.
 *
 * ## Why `deflate-raw` and not a hand-written delta coder
 *
 * A delta-plus-varint coder would beat deflate on these channels. It is also
 * new code in the file that holds the athlete's only copy of a ride, and its
 * bugs are silent — an off-by-one in a varint reader shifts every subsequent
 * sample rather than failing. `CompressionStream` is the platform's, it is
 * tested by every browser vendor, and `deflate-raw` (RFC 1951, no zlib or gzip
 * wrapper) is the smallest of its three framings. If a later measurement shows
 * the difference matters, the `compression` field stored on every blob row is
 * what makes a second scheme addable without a migration.
 *
 * ## Availability
 *
 * `CompressionStream` is a platform API, and this package is deliberately not
 * platform-isolated (see `tsconfig.json`). The floor is Chrome 103, Safari
 * 16.4, Firefox 113 and Node 18 — all more than three years old, and all older
 * than the floor `docs/adr/0003-platform-support-matrix.md` already sets. There
 * is deliberately **no uncompressed fallback**: a fallback that nothing
 * exercises is a second on-disk format nobody has read back.
 *
 * ## Decompression is bounded, because the compressed bytes are untrusted
 *
 * A deflate stream can expand by roughly a thousand to one, so a few kilobytes
 * on disk can inflate to gigabytes. `CLAUDE.md` section 6 puts resource
 * exhaustion from malformed stored data in scope, and today's blob rows are
 * only as trustworthy as the devtools pane; #51's import and #7's sync will
 * make them genuinely foreign.
 *
 * So `decompressStreamBytes` takes a **limit** and stops reading the moment the
 * output passes it. The caller always knows the answer exactly — a channel's
 * bytes are `sampleCount * bytesPerSample`, and its presence bitmap is
 * `ceil(sampleCount / 8)` — so this is not a heuristic ceiling with a magic
 * number in it. It is "this row says how big it is; anything larger is not that
 * row", checked while inflating rather than after allocating.
 */

/** The one framing this build writes. Stored per blob so a second one can be added later. */
export const STREAM_COMPRESSION = 'deflate-raw';

/** What a blob row's `compression` field may say. */
export type StreamCompression = typeof STREAM_COMPRESSION;

/**
 * Stored bytes inflated past the size their row declares.
 *
 * Its own class rather than a `StoreDecodeError` because this file has no
 * business importing the store's error hierarchy — `activity-store.ts`
 * translates it, along with the platform's own rejection, into the
 * `StoreDecodeError` a consumer catches.
 */
export class StreamSizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StreamSizeError';
  }
}

/**
 * Pushes `bytes` through a `CompressionStream` or `DecompressionStream` and
 * collects the result.
 *
 * Written against the stream reader directly rather than through `Blob` and
 * `Response`. Those two are shorter, and they pull a network type into the
 * storage package for no reason; the reader loop uses nothing but the streams
 * API this transform is already part of.
 */
async function through(
  bytes: Uint8Array,
  transform: GenericTransformStream,
  limit: number,
): Promise<Uint8Array> {
  const writer = (transform.writable as WritableStream<Uint8Array>).getWriter();
  // The chunk is written directly, not copied first. Both transforms copy the
  // bytes into their own buffer rather than transferring them, so the caller's
  // array is not detached — a defensive copy here was written, found to be
  // unfalsifiable by any test, and removed.
  //
  // The write rejection is swallowed and surfaced by the reader below: a write
  // error and a transform error are the same error arriving twice, and an
  // unawaited rejection would be reported as unhandled.
  const written = writer
    .write(bytes)
    .then(async () => writer.close())
    .catch(() => undefined);

  const reader = (transform.readable as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    total += value.byteLength;
    if (total > limit) {
      // Cancelled rather than merely broken out of, so the transform stops
      // producing instead of running to completion into a queue nobody drains.
      await reader.cancel();
      await written;
      throw new StreamSizeError(
        `stored bytes expand to more than the ${String(limit)} bytes this row declares`,
      );
    }
  }
  await written;

  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/**
 * Compresses one channel's bytes.
 *
 * The bound is the input's own length plus deflate's worst case for
 * incompressible input, which is a few bytes of block header per 64 KiB. It is
 * generous on purpose: this side's input is this build's own encoder output, so
 * the bound is a sanity check rather than a defence.
 */
export async function compressStreamBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const worstCase = bytes.byteLength + Math.ceil(bytes.byteLength / 65_536) * 8 + 64;
  return through(bytes, new CompressionStream(STREAM_COMPRESSION), worstCase);
}

/**
 * Decompresses one channel's bytes, refusing to inflate past `limit`.
 *
 * The bytes came off disk and are therefore untrusted: a truncated or corrupted
 * deflate stream makes `DecompressionStream` reject, and the caller in
 * `activity-store.ts` turns that — and a `StreamSizeError` — into a
 * `StoreDecodeError` naming the channel. Neither is swallowed here, because a
 * channel that silently decompresses to nothing is a chart with a gap the
 * athlete's ride did not have.
 *
 * @param limit - the exact number of bytes the row says this array holds. See
 * the note at the top of this file.
 */
export async function decompressStreamBytes(bytes: Uint8Array, limit: number): Promise<Uint8Array> {
  return through(bytes, new DecompressionStream(STREAM_COMPRESSION), limit);
}
