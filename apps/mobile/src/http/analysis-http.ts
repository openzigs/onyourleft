// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The one native HTTP request this shell makes: a picture to the rider's
 * own computer** — [#553](https://github.com/openzigs/onyourleft/issues/553),
 * the owner's 2026-09-26 ruling.
 *
 * Validation 0002 Part AF measured the shell's WebView blocking #387's
 * plain-`http:` request to the rider's computer as **mixed content**: the page
 * is `https://localhost`, `capacitor.config.ts` sets `allowMixedContent:
 * false`, and the request never left the tablet. The owner ruled that the
 * request goes through Capacitor's native HTTP instead, and that the WebView's
 * setting stays as it is for everything else.
 *
 * ## What limits it
 *
 * Not this file. Android's cleartext policy has to permit plain `http:` for the
 * whole application (`AndroidManifest.xml` §`usesCleartextTraffic`), because a
 * network security config cannot list a rider's LAN address in advance. So
 * the address rule lives in the web client's transport, which is the only
 * caller: `apps/web/src/camera/analysis-transport.ts` §`nativeAnalysisPort`
 * refuses anything that is not a private address written as numbers **before**
 * this function is ever called, and `analysis-transport.test.ts` asserts it
 * was not called.
 *
 * `apps/web/src/privacy/no-network.test.ts` §"the Android shell's own source"
 * permits `CapacitorHttp` in this file and nowhere else in `apps/mobile/src`,
 * which is what keeps this the ONE native request.
 *
 * ## What is set, and why
 *
 * | Option | Why |
 * |---|---|
 * | `method: 'POST'` | the web transport's reason: a picture is never in a cacheable request |
 * | `disableRedirects: true` | a redirect would re-send the picture wherever it pointed. A `3xx` comes back as a status, which the web client reads as "not a model server" |
 * | `responseType: 'text'` | the body is read as text and parsed by the web client's own reader. When the server says JSON the native layer parses it anyway, and {@link bodyText} turns it back |
 * | `connectTimeout`, `readTimeout` | a native request has no abort from here; these are what stop a dead address holding a socket for ever |
 *
 * ⚠️ **Not verified here**: this runs only on a device, so what is tested is
 * the mapping against a scripted `http`, the limit `thermal/thermal.ts` states.
 * Validation 0002 Part AF is where the tablet runs it.
 */

import { CapacitorHttp } from '@capacitor/core';

/** How long to wait for the rider's computer to accept the connection. */
export const ANALYSIS_CONNECT_TIMEOUT_MILLISECONDS = 10_000;

/**
 * How long to wait between pieces of the answer. A small model on a laptop
 * takes tens of seconds over a picture before it writes anything, so this is
 * generous; the web client's own deadlines are what a rider waits on.
 */
export const ANALYSIS_READ_TIMEOUT_MILLISECONDS = 120_000;

/** One request, as the web client's transport hands it over. */
export interface AnalysisPostRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly json: Readonly<Record<string, unknown>>;
}

/** What came back. */
export interface AnalysisPostReply {
  readonly status: number;
  readonly body: string;
}

/** The slice of `CapacitorHttp` this uses, so a test can supply one. */
export interface NativeHttp {
  request(options: {
    readonly url: string;
    readonly method: string;
    readonly headers: Record<string, string>;
    readonly data: unknown;
    readonly responseType: 'text';
    readonly disableRedirects: boolean;
    readonly connectTimeout: number;
    readonly readTimeout: number;
  }): Promise<{ readonly status: number; readonly data: unknown }>;
}

/**
 * The body as text: a string as it is, anything the native layer parsed as
 * JSON serialised back, and nothing else at all.
 */
export function bodyText(data: unknown): string {
  if (typeof data === 'string') {
    return data;
  }
  if (data === undefined || data === null) {
    return '';
  }
  try {
    return JSON.stringify(data);
  } catch {
    return '';
  }
}

/**
 * The native request, over `http` — Capacitor's own `CapacitorHttp` in
 * production. Rejects when the native layer does, and the web client reads a
 * rejection as "unreachable" without reading its message.
 */
export function capacitorAnalysisPost(
  http: NativeHttp = CapacitorHttp,
): (request: AnalysisPostRequest) => Promise<AnalysisPostReply> {
  return async (request) => {
    const reply = await http.request({
      url: request.url,
      method: 'POST',
      headers: { ...request.headers },
      data: request.json,
      responseType: 'text',
      disableRedirects: true,
      connectTimeout: ANALYSIS_CONNECT_TIMEOUT_MILLISECONDS,
      readTimeout: ANALYSIS_READ_TIMEOUT_MILLISECONDS,
    });
    return { status: reply.status, body: bodyText(reply.data) };
  };
}
