// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The second module in this client permitted a `fetch`: a question, and
 * never a picture, to a hosted model on the rider's own key**
 * ([#518](https://github.com/openzigs/onyourleft/issues/518)).
 *
 * `privacy/no-network.test.ts` pins one `fetch` here, beside the one in
 * `analysis-transport.ts`, and `docs/privacy-policy.md` names this path as its
 * second exception in the same pull request, worded as the owner ruled it:
 * numbers only.
 *
 * ## What leaves, exactly
 *
 * {@link hostedRequestBody} is the whole body: the model name the rider typed,
 * the fixed prompt from `hosted-port.ts` §`HOSTED_PROMPTS`, `stream: false`
 * and a token limit. `hosted-transport.test.ts` pins the key set and walks the
 * body: its only strings are those, and nothing in it is an image part or a
 * `data:` URL. The one other thing that leaves is the rider's key, in the
 * `Authorization` header the OpenAI-compatible shape uses — which is the
 * vendor-neutral request ADR 0031 D-4 condition 3 asks for, not any one
 * service's.
 *
 * ## Why a separate module from the picture transport
 *
 * So that "never a picture" can be read off the imports. This file names no
 * frame type and imports nothing that builds a picture into a request; the
 * test says so by reading the file. A shared module would have made the
 * boundary a matter of which function was called.
 *
 * The request settings are `analysis-transport.ts`'s and for its reasons —
 * `POST`, `no-store`, credentials omitted, no referrer — with one difference:
 * `redirect: 'error'` matters MORE here, because a redirect would carry the
 * key's request somewhere the rider did not type. There is no
 * `targetAddressSpace` annotation, because the address is a public one.
 */

import { MAXIMUM_RESPONSE_BYTES, readAnalysisReply } from './analysis-response';
import { hostedCompletionsUrl, hostedModelDecision, type HostedModel } from './hosted-model';
import {
  HOSTED_PROMPTS,
  type HostedCall,
  type HostedFailure,
  type HostedOutcome,
  type HostedPort,
  type HostedRequest,
} from './hosted-port';
import { boundedText } from './http-body';

/** The most a model may write back, in tokens — asked for, not trusted. */
export const MAXIMUM_HOSTED_ANSWER_TOKENS = 64;

/** How a request is sent. The platform's own `fetch` in production. */
export type HostedSend = (url: string, init: RequestInit) => Promise<Response>;

/** @see hostedModelPort */
export interface HostedTransportOptions {
  /** Injected so a test needs no network. Defaults to the platform's `fetch`. */
  readonly send?: HostedSend | undefined;
}

/**
 * Whether `request` is a question name and nothing else — the run-time half
 * of "never a picture". The type already forbids anything more; this is what
 * holds when something is passed past the type.
 */
export function isQuestionOnly(request: HostedRequest): boolean {
  const keys = Object.keys(request);
  return (
    keys.length === 1 &&
    keys[0] === 'question' &&
    Object.prototype.hasOwnProperty.call(HOSTED_PROMPTS, request.question)
  );
}

/**
 * The JSON body of one request — exported so a test can walk it for anything
 * that should not be there.
 *
 * Built from the question's NAME, never from the request object, so a member
 * that was smuggled onto a request has no path into the body even before
 * {@link isQuestionOnly} refuses it.
 */
export function hostedRequestBody(
  model: string,
  request: HostedRequest,
): Readonly<Record<string, unknown>> {
  return {
    model,
    stream: false,
    max_tokens: MAXIMUM_HOSTED_ANSWER_TOKENS,
    messages: [{ role: 'user', content: HOSTED_PROMPTS[request.question] }],
  };
}

function failed(failure: HostedFailure): HostedOutcome {
  return { kind: 'failed', failure };
}

/**
 * What a model server's reply means on this path. `readAnalysisReply` is the
 * one reader of an OpenAI-compatible answer, and its failures are worded for
 * the rider's own computer; these are the same facts about a service.
 */
function hostedOutcomeOf(status: number, body: string): HostedOutcome {
  // Read before `readAnalysisReply`, whose wording is for the rider's own
  // computer: there a 404 or a 429 means the address is wrong, and on a paid
  // hosted service they are the quota and the model name (#760 review).
  if (status === 429) {
    return failed('over-limit');
  }
  if (status === 400 || status === 404 || status === 422) {
    return failed('request-refused');
  }
  const read = readAnalysisReply({ status, body });
  if (read.kind === 'described') {
    return read;
  }
  switch (read.failure) {
    case 'refused':
      return failed('key-refused');
    case 'not-a-model-server':
      return failed('not-a-model-service');
    case 'too-large':
      return failed('too-large');
    case 'failed-on-machine':
    case 'picture-too-large':
      return failed('failed-on-service');
    default:
      return failed('malformed');
  }
}

/**
 * A port to the rider's hosted service — or `undefined` when none is saved,
 * which is no port at all rather than one that refuses.
 *
 * ⚠️ **This does not check consent.** `session.ts`
 * §`CameraController.askHostedModel` does, before it asks for a port, because
 * consent is the controller's and lasts until the app is closed. A port is
 * only ever built after that check has passed.
 */
export function hostedModelPort(
  saved: HostedModel | undefined,
  options: HostedTransportOptions = {},
): HostedPort | undefined {
  if (saved === undefined) {
    return undefined;
  }
  // Re-decided rather than trusted: a hand-built object must not be the way
  // round the `https:` rule, which is what keeps the key off the wire in the
  // clear.
  const model = hostedModelDecision(saved).model;
  if (model === undefined) {
    return undefined;
  }
  const send: HostedSend = options.send ?? (async (url, init) => fetch(url, init));
  const url = hostedCompletionsUrl(model);

  return {
    sendHostedQuestion(request: HostedRequest): HostedCall {
      if (!isQuestionOnly(request)) {
        return { outcome: Promise.resolve(failed('not-numbers')), cancel: () => undefined };
      }
      const abort = new AbortController();
      let cancelled = false;
      let settleCancelled: (outcome: HostedOutcome) => void = () => undefined;
      const whenCancelled = new Promise<HostedOutcome>((resolve) => {
        settleCancelled = resolve;
      });

      const work = async (): Promise<HostedOutcome> => {
        let status: number;
        let body: string | undefined;
        try {
          // ⚠️ Nothing of a rejection is read: a platform error can quote the
          // request, and the request carries the key.
          const response = await send(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${model.key}`,
            },
            body: JSON.stringify(hostedRequestBody(model.model, request)),
            cache: 'no-store',
            credentials: 'omit',
            redirect: 'error',
            referrerPolicy: 'no-referrer',
            mode: 'cors',
            signal: abort.signal,
          });
          status = response.status;
          body = await boundedText(response, MAXIMUM_RESPONSE_BYTES);
        } catch {
          return failed(cancelled ? 'cancelled' : 'unreachable');
        }
        if (body === undefined) {
          return failed('too-large');
        }
        return hostedOutcomeOf(status, body);
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
