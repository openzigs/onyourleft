// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The one module in this client permitted a network primitive**
 * ([#387](https://github.com/openzigs/onyourleft/issues/387)).
 *
 * `privacy/no-network.test.ts` scans every source file under `apps/web/src`
 * for `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` and `sendBeacon`,
 * and since this pull request it permits exactly one `fetch` — here — and
 * fails on any other, anywhere. This file is the first byte `apps/web` has ever
 * sent, and it lands in the same pull request as the privacy policy and the
 * Play Data Safety answers that describe it, because ADR 0029's amendment says
 * the three *"move together or not at all"*.
 *
 * ## What leaves, exactly
 *
 * {@link analysisRequestBody} is the whole of it, and ADR 0029 D-7's list is
 * what it is held to: *"the frame, and a fixed prompt this repository's source
 * contains. Nothing else — no athlete id, no activity id, no device key, no
 * signed record, no position, no heart rate, no serial, and no filename."* The
 * body carries four keys — the model name the rider typed, the prompt from
 * `analysis-port.ts` §`ANALYSIS_PROMPTS`, the picture, and two limits — and
 * `analysis-transport.test.ts` pins the key set rather than reading one field
 * at a time, so a fifth key is a red test rather than a quiet addition.
 *
 * The request itself says as little as the platform allows:
 *
 * | Setting | Why |
 * |---|---|
 * | `method: 'POST'` | ADR 0029 D-10 — a `GET` is cacheable by every layer between here and there, and a request carrying a picture must never be cached. It also keeps the service worker out: `offline/worker-core.ts` §`decideFetch` leaves every non-`GET` untouched |
 * | `cache: 'no-store'` | the same rule, said to the browser's own HTTP cache |
 * | `credentials: 'omit'` | no cookie and no HTTP authentication of this origin's ever rides along |
 * | `redirect: 'error'` | ⚠️ **a redirect would re-send the picture to wherever it pointed**, and a `307` re-sends the body. The address the rider typed is the only place it may go, so a redirect is a failure rather than a hop |
 * | `referrerPolicy: 'no-referrer'` | the rider's machine learns nothing about the page that asked |
 * | `targetAddressSpace` | Chromium's Local Network Access annotation: it tells the browser before resolution that this is a request to the local network or loopback, which is what lets a plain-`http:` model server be reached from a secure page once the rider grants the permission — `analysis-endpoint.ts` §"Why `http:` is allowed" |
 *
 * ## Transports this does NOT use, by decision
 *
 * ADR 0029 D-6, restated here because a module header is where somebody
 * proposing a change will read it, and the ADR is where they might not:
 *
 * - ⚠️ **Cloudflare Tunnel is REJECTED for this payload, by name.** Cloudflare
 *   terminates TLS at its edge — that is how the proxy works, not a
 *   misconfiguration — so a photograph of the rider in their home would exist
 *   in plaintext on a third party's infrastructure on every single capture,
 *   on the path proposed as *"the rider's own machine"*. Read 2026-09-19 from
 *   five independent sources, recorded in #377. `analysis-endpoint.ts` refuses
 *   a public name, which is what such a tunnel's address is, so this is a
 *   property of the code as well as a sentence. Reversing it needs a
 *   superseding ADR arguing that the operator cannot read the payload.
 * - **WebRTC is out**: it needs signalling infrastructure, which is a server
 *   this project does not have (owner decision D6).
 * - **Permitted and not built here**: a WireGuard-class overlay for the remote
 *   case, where the relay forwards ciphertext only. It needs nothing from this
 *   module — the rider's overlay gives their machine an address in
 *   `100.64.0.0/10`, which `analysis-endpoint.ts` accepts.
 *
 * ## What it cannot promise
 *
 * Plain `http:` on a home network is plain text on that network. That is the
 * transport ADR 0029 D-6 adopts as the default, on the ground that the phone
 * and the machine are in the same room, and `docs/analysis-on-your-own-computer.md`
 * says so to the rider rather than implying the link is encrypted.
 */

import type {
  AnalysisCall,
  AnalysisFailure,
  AnalysisOutcome,
  AnalysisPort,
  AnalysisRequest,
} from './analysis-port';
import { ANALYSIS_PROMPTS } from './analysis-port';
import {
  addressSpaceOf,
  completionsUrl,
  type AddressSpace,
  type AnalysisEndpoint,
} from './analysis-endpoint';
import { MAXIMUM_RESPONSE_BYTES, readAnalysisReply } from './analysis-response';

/**
 * The largest picture this client will send, in bytes.
 *
 * A frame is a canvas-encoded JPEG at the camera's own resolution — hundreds
 * of kilobytes at 1080p. Eight megabytes is far above that and far below what
 * a phone would struggle to base64 in memory.
 */
export const MAXIMUM_PICTURE_BYTES = 8 * 1024 * 1024;

/**
 * The most a model may write back, in tokens — asked for, not trusted.
 * `analysis-response.ts` bounds what actually arrives.
 */
export const MAXIMUM_ANSWER_TOKENS = 400;

/** How a request is sent. The platform's own `fetch` in production. */
export type AnalysisSend = (url: string, init: RequestInit) => Promise<Response>;

/** @see riderAnalysisPort */
export interface AnalysisTransportOptions {
  /** Injected so a test needs no network. Defaults to the platform's `fetch`. */
  readonly send?: AnalysisSend | undefined;
}

/**
 * The JSON body of one request — exported so a test can walk it for anything
 * that should not be there.
 *
 * ⚠️ **The picture is a `data:` URL inside the body, and that string is the
 * frame.** It is built here, sent, and dropped with the request. It is never
 * logged, never put in an error and never cached — ADR 0029 D-8 and D-10.
 */
export function analysisRequestBody(
  model: string,
  request: AnalysisRequest,
): Readonly<Record<string, unknown>> {
  return {
    model,
    stream: false,
    max_tokens: MAXIMUM_ANSWER_TOKENS,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: ANALYSIS_PROMPTS[request.question] },
          {
            type: 'image_url',
            image_url: {
              url: `data:${request.frame.mediaType};base64,${base64Of(request.frame.bytes)}`,
            },
          },
        ],
      },
    ],
  };
}

/**
 * Standard base64, in chunks so a large picture does not blow the argument
 * limit of `String.fromCharCode`.
 */
function base64Of(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let start = 0; start < bytes.length; start += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(start, start + CHUNK));
  }
  return btoa(binary);
}

/**
 * The body as text, stopping at `limit` bytes — `undefined` when it ran past.
 *
 * ⚠️ **Reads the stream rather than calling `text()`**, because `text()`
 * buffers whatever arrives — a hostile or broken server streaming for ever
 * would have this tab allocate until it died. Past the limit the stream is
 * cancelled and the answer is `too-large`.
 */
async function boundedText(response: Response, limit: number): Promise<string | undefined> {
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

function failed(failure: AnalysisFailure): AnalysisOutcome {
  return { kind: 'failed', failure };
}

/**
 * A port to the rider's configured computer — or `undefined`, which is what
 * nothing configured, and something configured but switched off, both mean.
 *
 * ⚠️ **`undefined` is not a port that refuses; it is no port at all**, and the
 * difference is the criterion: with no configuration there is no object in the
 * program that could send anything. `session.ts` §`askAboutPicture` reads
 * `undefined` as `not-configured` before it takes a picture.
 */
export function riderAnalysisPort(
  endpoint: AnalysisEndpoint | undefined,
  options: AnalysisTransportOptions = {},
): AnalysisPort | undefined {
  if (endpoint?.switchedOn !== true) {
    return undefined;
  }
  // Re-checked here as well as where the endpoint was made: an endpoint is a
  // plain object, and one built by hand rather than by `endpointDecision`
  // must not be the way round the rule.
  let space: AddressSpace | undefined;
  try {
    space = addressSpaceOf(new URL(endpoint.address).hostname);
  } catch {
    space = undefined;
  }
  if (space === undefined) {
    return undefined;
  }
  const send: AnalysisSend = options.send ?? (async (url, init) => fetch(url, init));
  const url = completionsUrl(endpoint);
  const targetAddressSpace = space;

  return {
    askAboutFrame(request: AnalysisRequest): AnalysisCall {
      const abort = new AbortController();
      let cancelled = false;
      let settleCancelled: (outcome: AnalysisOutcome) => void = () => undefined;
      const whenCancelled = new Promise<AnalysisOutcome>((resolve) => {
        settleCancelled = resolve;
      });

      const work = async (): Promise<AnalysisOutcome> => {
        if (request.frame.bytes.length > MAXIMUM_PICTURE_BYTES) {
          return failed('picture-too-large');
        }
        const init: RequestInit & { targetAddressSpace: AddressSpace } = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(analysisRequestBody(endpoint.model, request)),
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          mode: 'cors',
          signal: abort.signal,
          targetAddressSpace,
        };
        let body: string | undefined;
        let status: number;
        try {
          // ⚠️ Nothing of a rejection is read. A network error's message can
          // name the address, and a platform that echoed the request would
          // carry the picture — ADR 0029 D-8.
          const response = await send(url, init);
          status = response.status;
          body = await boundedText(response, MAXIMUM_RESPONSE_BYTES);
        } catch {
          return failed(cancelled ? 'cancelled' : 'unreachable');
        }
        if (body === undefined) {
          return failed('too-large');
        }
        return readAnalysisReply({ status, body });
      };

      return {
        outcome: Promise.race([work(), whenCancelled]),
        cancel: () => {
          if (cancelled) {
            return;
          }
          cancelled = true;
          abort.abort();
          settleCancelled(failed('cancelled'));
        },
      };
    },
  };
}
