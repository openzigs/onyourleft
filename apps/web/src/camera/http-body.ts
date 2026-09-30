// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Reading a response body with a ceiling** — moved out of
 * `analysis-transport.ts` by [#518](https://github.com/openzigs/onyourleft/issues/518),
 * unchanged, so that the hosted transport reads its answer the same way
 * without importing the module that builds a picture into a request.
 *
 * One of the modules `analysis-boundary.test.ts` lets name a `Response`: the
 * two transports, the ride analysis's step port (#802) and this.
 *
 * ## How a request leaves, as types
 *
 * The send and native-request types below were declared in
 * `analysis-transport.ts` until [#802](https://github.com/openzigs/onyourleft/issues/802),
 * which moved them here unchanged: that module builds a picture into a request
 * by design, so the ride analysis's step port — which must reach no picture
 * type (`no-picture-reachable.test.ts`) — could not import them from it.
 * `analysis-transport.ts` re-exports them.
 */

/** How a request is sent. The platform's own `fetch` in production. */
export type AnalysisSend = (url: string, init: RequestInit) => Promise<Response>;

/**
 * One request made OUTSIDE the WebView — [#553](https://github.com/openzigs/onyourleft/issues/553).
 *
 * The body is handed over as the JSON value it is, not as text, because the
 * native layer serialises a JSON body itself and a string it was handed would
 * be sent as a string.
 */
export interface NativeAnalysisRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly json: Readonly<Record<string, unknown>>;
}

/** What a native request came back with: its status, and its body as text. */
export interface NativeAnalysisReply {
  readonly status: number;
  readonly body: string;
}

/**
 * How a request is sent inside the Android shell: Capacitor's native HTTP,
 * which `apps/mobile/src/http/analysis-http.ts` is the one caller of.
 *
 * ⚠️ **Why a second way out at all**: validation 0002 Part AF measured the
 * shell's WebView blocking a plain-`http:` request to the rider's computer as
 * mixed content, before it left the device — so #387's path did not work in
 * the APK at all. The owner ruled on 2026-09-26 (#553): send it through native
 * HTTP, **only to the private-network address the rider saved**, and keep the
 * WebView's `allowMixedContent: false` for everything else. Android's
 * cleartext policy then has to allow plain `http:` for the whole app, because
 * a network security config cannot list a rider's address in advance — so
 * what limits it is this module: with `native` given, an address that is not
 * `analysis-endpoint.ts` §`isPrivateAddressLiteral` is answered
 * `address-not-numeric` and **`native` is never called**.
 */
export type NativeAnalysisPost = (request: NativeAnalysisRequest) => Promise<NativeAnalysisReply>;

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
