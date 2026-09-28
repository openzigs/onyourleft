// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Reading a response body with a ceiling** — moved out of
 * `analysis-transport.ts` by [#518](https://github.com/openzigs/onyourleft/issues/518),
 * unchanged, so that the hosted transport reads its answer the same way
 * without importing the module that builds a picture into a request.
 *
 * One of the three modules `analysis-boundary.test.ts` lets name a `Response`:
 * the two transports and this.
 */

/**
 * The body as text, stopping at `limit` bytes — `undefined` when it ran past.
 *
 * ⚠️ **Reads the stream rather than calling `text()`**, because `text()`
 * buffers whatever arrives — a hostile or broken server streaming for ever
 * would have this tab allocate until it died. Past the limit the stream is
 * cancelled and the answer is `too-large`.
 */
export async function boundedText(response: Response, limit: number): Promise<string | undefined> {
  const stream = response.body;
  if (stream === null) {
    const text = await response.text();
    return text.length > limit ? undefined : text;
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}
