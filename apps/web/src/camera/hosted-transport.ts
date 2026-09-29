// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The second module in this client permitted a `fetch`: a question, and
 * never a picture, to a hosted model on the rider's own key**
 * ([#518](https://github.com/openzigs/onyourleft/issues/518)).
 *
 * `privacy/no-network.test.ts` pins one `fetch` here, beside the one in
 * `analysis-transport.ts`, and `docs/privacy-policy.md` names this path as an
 * exception, worded as the owner ruled it: numbers only, and since #803 a
 * ride's numbers when the rider asks for an analysis.
 *
 * ## What leaves, exactly
 *
 * {@link hostedRequestBody} is the whole body, and it is one of two shapes:
 *
 * - **The connection check** (#518): the model name the rider typed, the
 *   fixed prompt from `hosted-port.ts` §`HOSTED_PROMPTS`, `stream: false` and
 *   a token limit.
 * - **A step of the ride analysis** (#803): the model name, the step's system
 *   and user prompts as two messages of plain text, the step's own
 *   `max_tokens` and `temperature`, and `stream: false`. The text is a prompt
 *   #810's template built from #809's input and the runner sealed
 *   (`ride-analysis/sealed-step.ts`) — the ride's numbers, and never a
 *   coordinate, a date, a name or an identifier. ⚠️ **No `response_format`
 *   hint**, unlike the rider's own computer: it is OpenAI's own extension and
 *   ADR 0031 D-4 condition 3 asks for the vendor-neutral request, a service
 *   that refused it would be sent every structured step twice on the rider's
 *   account, and the prompt spells the form out while the runner validates
 *   the reply either way.
 *
 * `hosted-transport.test.ts` pins both key sets and walks both bodies: their
 * only strings are those, and nothing in either is an image part or a `data:`
 * URL; `no-picture-reachable.test.ts` holds every body a real run sends to
 * `no-picture-testing.ts` §`pictureBodyFaults`. The one other thing that
 * leaves is the rider's key, in the `Authorization` header the
 * OpenAI-compatible shape uses — which is the vendor-neutral request ADR 0031
 * D-4 condition 3 asks for, not any one service's.
 *
 * ## Why a separate module from the picture transport
 *
 * So that "never a picture" can be read off the imports. This file names no
 * frame type and imports nothing that builds a picture into a request; the
 * test says so by reading the file. A shared module would have made the
 * boundary a matter of which function was called.
 *
 * ## Cancelling
 *
 * {@link HostedCall.cancel} aborts the `fetch` itself, so a cancelled step
 * closes the connection. ⚠️ **What a service does with a request it has
 * already been sent is the service's**: the ride's numbers have left by then,
 * and `ride-analysis.ts` §`CANCELLED_TEXT` says so to the rider.
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
  type HostedFinish,
  type HostedOutcome,
  type HostedPort,
  type HostedRequest,
} from './hosted-port';
import { boundedText } from './http-body';
import { isTextOnlyStep } from '../ride-analysis/own-computer-step';
import { isSealedStep } from '../ride-analysis/sealed-step';

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
 * Whether `request` is one this client built, and nothing more — the run-time
 * half of "never a picture" (#803; `isQuestionOnly` until then). The type
 * already forbids anything else; this is what holds when something is passed
 * past the type:
 *
 * - a **question** is exactly one member, naming a question
 *   {@link HOSTED_PROMPTS} knows;
 * - a **step** is exactly one member, holding a step the analysis runner
 *   sealed — by identity, so a look-alike built anywhere else is refused
 *   (`ride-analysis/sealed-step.ts` §`isSealedStep`) — which is also plain
 *   text by `own-computer-step.ts` §`isTextOnlyStep`'s rules: no field the
 *   type does not declare, no value that is not plain JSON, no `data:` URL.
 */
export function isBuiltRequest(request: HostedRequest): boolean {
  if (typeof request !== 'object' || (request as unknown) === null) {
    return false;
  }
  const keys = Object.keys(request);
  if (keys.length !== 1) {
    return false;
  }
  if ('question' in request && keys[0] === 'question') {
    return Object.prototype.hasOwnProperty.call(HOSTED_PROMPTS, request.question);
  }
  if ('step' in request && keys[0] === 'step') {
    return isSealedStep(request.step) && isTextOnlyStep(request.step);
  }
  return false;
}

/**
 * The JSON body of one request — exported so a test can walk it for anything
 * that should not be there.
 *
 * Built from the question's NAME, or from the step's named fields, never from
 * the request object, so a member that was smuggled onto a request has no
 * path into the body even before {@link isBuiltRequest} refuses it.
 */
export function hostedRequestBody(
  model: string,
  request: HostedRequest,
): Readonly<Record<string, unknown>> {
  if ('step' in request) {
    const { step } = request;
    return {
      model,
      stream: false,
      max_tokens: step.maximumTokens,
      temperature: step.temperature,
      messages: [
        { role: 'system', content: step.system },
        { role: 'user', content: step.user },
      ],
    };
  }
  return {
    model,
    stream: false,
    max_tokens: MAXIMUM_HOSTED_ANSWER_TOKENS,
    messages: [{ role: 'user', content: HOSTED_PROMPTS[request.question] }],
  };
}

/** How the service said its reply ended: `choices[0].finish_reason`. */
export function hostedFinishOf(body: string): HostedFinish {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return 'other';
  }
  const choices = (parsed as { choices?: unknown } | null)?.choices;
  const first: unknown = Array.isArray(choices) ? choices[0] : undefined;
  const reason =
    typeof first === 'object' && first !== null
      ? (first as { finish_reason?: unknown }).finish_reason
      : undefined;
  return reason === 'stop' ? 'stop' : reason === 'length' ? 'length' : 'other';
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
    return { kind: 'described', description: read.description, finish: hostedFinishOf(body) };
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
      if (!isBuiltRequest(request)) {
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
