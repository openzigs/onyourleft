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
 * ⚠️ **Since [#802](https://github.com/openzigs/onyourleft/issues/802) the same
 * call also carries the ride analysis's text steps** — a ride's numbers, never
 * a picture — to the same address, through {@link riderModelStepPort}. Their
 * body is not built here, because this module builds pictures into requests by
 * design and the ride analysis must reach no picture type: it is
 * `ride-analysis/own-computer-step.ts` §`stepRequestBody`, and the section
 * below describes the picture request only.
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
 * - **WebRTC is out FOR THIS PATH** — the rider's computer is not a browser
 *   peer. ⚠️ The reason given here until #529 was that WebRTC *"needs
 *   signalling infrastructure, which is a server"*, and that is not true of
 *   two devices in one room: [ADR 0033](../../../../docs/adr/0033-side-camera-link.md)
 *   permits a WebRTC data channel signalled by two QR codes for the SIDE
 *   CAMERA, and `side-link-transport.ts` is it (ADR 0033 D-10).
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

import type { AnalysisPort, AnalysisRequest } from './analysis-port';
import type { AnalysisCall, AnalysisFailure, AnalysisOutcome } from './model-answer';
import { ANALYSIS_PROMPTS } from './analysis-port';
import { endpointTarget, type AddressSpace, type AnalysisEndpoint } from './analysis-endpoint';
import { MAXIMUM_RESPONSE_BYTES, readAnalysisReply } from './analysis-response';
import {
  boundedText,
  type AnalysisSend,
  type NativeAnalysisPost,
  type NativeAnalysisReply,
} from './http-body';
import type { ModelStepPort } from '../ride-analysis/model-step-port';
import { ownComputerStepPort } from '../ride-analysis/own-computer-step';

export type {
  AnalysisSend,
  NativeAnalysisPost,
  NativeAnalysisReply,
  NativeAnalysisRequest,
} from './http-body';

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

/**
 * The platform's own `fetch` — **the one call this client makes to it**, which
 * `privacy/no-network.test.ts` counts. The picture port and, since #802, the
 * ride analysis's step port both default to it; neither names `fetch` itself.
 */
const platformSend: AnalysisSend = async (url, init) => fetch(url, init);

/** @see riderAnalysisPort */
export interface AnalysisTransportOptions {
  /** Injected so a test needs no network. Defaults to the platform's `fetch`. */
  readonly send?: AnalysisSend | undefined;
  /**
   * Inside the Android shell, the native request that replaces `send` (#553).
   * When given, `send` is not used at all, and only a private address written
   * as numbers is ever passed to it.
   */
  readonly native?: NativeAnalysisPost | undefined;
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
  // Re-checked here as well as where the endpoint was made: an endpoint is a
  // plain object, and one built by hand rather than by `endpointDecision`
  // must not be the way round the rule (`analysis-endpoint.ts` §`endpointTarget`).
  const target = endpointTarget(endpoint);
  if (endpoint === undefined || target === undefined) {
    return undefined;
  }
  const { url } = target;
  if (options.native !== undefined) {
    return nativeAnalysisPort(endpoint, url, options.native, target.literal);
  }
  const send: AnalysisSend = options.send ?? platformSend;
  const targetAddressSpace = target.space;

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

/**
 * The same port over a native request — #553, the owner's 2026-09-26 ruling.
 *
 * Everything that makes the `fetch` path safe holds here too, and each by a
 * different means, which is why it is written out:
 *
 * | The `fetch` path | Here |
 * |---|---|
 * | `redirect: 'error'` | the native layer is told not to follow one (`apps/mobile`), and a `3xx` that comes back is read by `analysis-response.ts` as not a model server |
 * | the address rule | `analysis-endpoint.ts` §`isPrivateAddressLiteral`, which is STRICTER: no name and no loopback, because the native request is outside every rule the WebView applies |
 * | the body | {@link analysisRequestBody}, the same four keys |
 * | `boundedText` | ⚠️ **weaker**: the native layer hands back the whole body, so the bound is applied after it has arrived rather than while it streams. `analysis-response.ts` still refuses anything over its limit |
 * | cancellation | the wait is abandoned and the outcome is `cancelled`; a native request cannot be aborted from here and runs to its end, its answer discarded |
 */
function nativeAnalysisPort(
  endpoint: AnalysisEndpoint,
  url: string,
  native: NativeAnalysisPost,
  literal: boolean,
): AnalysisPort {
  return {
    askAboutFrame(request: AnalysisRequest): AnalysisCall {
      if (!literal) {
        // Refused before any request exists — the owner's "a public or
        // hostname address is refused BEFORE any native request".
        return { outcome: Promise.resolve(failed('address-not-numeric')), cancel: () => undefined };
      }
      let cancelled = false;
      let settleCancelled: (outcome: AnalysisOutcome) => void = () => undefined;
      const whenCancelled = new Promise<AnalysisOutcome>((resolve) => {
        settleCancelled = resolve;
      });
      const work = async (): Promise<AnalysisOutcome> => {
        if (request.frame.bytes.length > MAXIMUM_PICTURE_BYTES) {
          return failed('picture-too-large');
        }
        let reply: NativeAnalysisReply;
        try {
          // ⚠️ Nothing of a rejection is read, for the reason the `fetch`
          // path gives: a native error's message can name the address.
          reply = await native({
            url,
            headers: { 'Content-Type': 'application/json' },
            json: analysisRequestBody(endpoint.model, request),
          });
        } catch {
          return failed(cancelled ? 'cancelled' : 'unreachable');
        }
        return readAnalysisReply({ status: reply.status, body: reply.body });
      };
      return {
        outcome: Promise.race([work(), whenCancelled]),
        cancel: () => {
          if (cancelled) {
            return;
          }
          cancelled = true;
          settleCancelled(failed('cancelled'));
        },
      };
    },
  };
}

/**
 * **Which way a picture leaves this device**: the WebView's `fetch` in a
 * browser, Capacitor's native HTTP inside the Android shell (#553). The
 * returned function looks the endpoint up again on every call, as #387's
 * button does.
 *
 * ⚠️ **This is here, not inline in `main.tsx`, so that it can go red.**
 * `AnalysisTransportOptions.native` is optional because a browser has none. So
 * a `main.tsx` that stopped passing it inside the shell would still typecheck
 * and pass every gate. The shell would then fall back to the WebView's
 * `fetch`, and validation 0002 Part AF measured that being blocked as mixed
 * content. Nothing would be sent, but the feature would stop working on
 * Android without anyone noticing. `analysis-transport.test.ts` §"which way a
 * picture leaves" drives both branches of this function.
 *
 * @param nativeShell `support/capacitor.ts` §`isNativeShell`, read by the caller.
 * @param loadNative the native request, loaded only inside the shell, so a
 *   browser downloads no line of Capacitor.
 * @param endpoint `analysis-endpoint.ts` §`readAnalysisEndpoint`.
 */
export async function riderAnalysisSource(
  nativeShell: boolean,
  loadNative: () => Promise<NativeAnalysisPost>,
  endpoint: () => AnalysisEndpoint | undefined,
  send?: AnalysisSend,
): Promise<() => AnalysisPort | undefined> {
  if (!nativeShell) {
    return () => riderAnalysisPort(endpoint(), { send });
  }
  const native = await loadNative();
  return () => riderAnalysisPort(endpoint(), { send, native });
}

/**
 * **The ride analysis's step port to the rider's own computer, with the
 * platform's `fetch` behind it** — [#802](https://github.com/openzigs/onyourleft/issues/802).
 *
 * The port itself is `ride-analysis/own-computer-step.ts`, which carries text
 * and never a picture and so has to live apart from this module; what it
 * cannot do on its own is reach the network, because this module holds the
 * client's ONE `fetch` (`privacy/no-network.test.ts`). So this hands it that
 * `fetch` — or, inside the Android shell, the native request, exactly as
 * {@link riderAnalysisPort} is handed one — and nothing else.
 *
 * `undefined` for the reason {@link riderAnalysisPort} gives: with nothing
 * configured and switched on there is no object that could send anything.
 *
 * ⚠️ **Nothing in the client calls it yet**: the post-ride ask that does is
 * #804's, and until then "nothing is sent without a press" rests on there
 * being no caller at all — `own-computer-step.test.ts` §"sends nothing
 * without a press" holds that, and #804 has to name its press there.
 */
export function riderModelStepPort(
  endpoint: AnalysisEndpoint | undefined,
  options: AnalysisTransportOptions = {},
): ModelStepPort | undefined {
  return ownComputerStepPort(endpoint, {
    send: options.send ?? platformSend,
    ...(options.native === undefined ? {} : { native: options.native }),
  });
}
