// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What this client may ask a hosted model on the rider's own key, and the
 * named ways it can fail** ([#518](https://github.com/openzigs/onyourleft/issues/518),
 * ADR 0029's 2026-09-28 amendment).
 *
 * The owner's ruling is *"NUMBERS ONLY and never a picture"*, and this seam is
 * where that is made a property of the types rather than of a caller's
 * manners:
 *
 * - **A {@link HostedRequest} is a question name, or a step the analysis
 *   runner sealed, and nothing else** (#803). No `frame`, no bytes, no string
 *   of the caller's choosing. A caller holding a `CapturedFrame`, a `Blob`, an
 *   `ImageBitmap` or an `ImageData` has nowhere to put it: an object literal
 *   carrying one is a compile error, and so is a step the caller wrote
 *   themselves, because only `ride-analysis/sealed-step.ts` §`sealStep` makes
 *   a `SealedStep` (`hosted-transport.test.ts` pins each with a
 *   `@ts-expect-error`). A request smuggled past the compiler — extra members,
 *   or a step that looks sealed and was not — is refused at run time as
 *   `not-numbers` before anything is sent (`hosted-transport.ts`
 *   §`isBuiltRequest`).
 * - **This file imports nothing that names a picture**, and neither does the
 *   transport behind it. `hosted-transport.test.ts` §"cannot name a picture"
 *   reads both and fails on an import of the camera's frame types or on the
 *   request shape that carries an image. ⚠️ **That scan reads each file and
 *   not what it imports**, and until #799 this file reached `CapturedFrame`
 *   in two steps, through `analysis-port.ts`, for `UntrustedText`.
 *   `no-picture-reachable.test.ts` walks the whole graph from here now.
 *
 * ## What is sent
 *
 * Two kinds of request. The **connection check** (#518) is a fixed question
 * with no numbers. A **step** (#803) is one step of the ride analysis: a
 * prompt #810's template built from #809's input — the ride's numbers, as
 * text, and never a coordinate, a date or a name — sealed by the runner. The
 * owner's ruling 4 on #795 permits it: *"the full ride data (health and
 * fitness data shared with a third party the rider chose)"*. The words the
 * rider reads before any of it is sent are ADR 0035 D-9 C, quoted by
 * ADR 0029's 2026-09-29 amendment and by `hosted-model.ts` §`HOSTED_CONSENT`.
 *
 * ## Why a `*-port.ts`
 *
 * CLAUDE.md §4j: `check:wiring` reports a method declared here that no
 * production declaration calls. {@link HostedPort.sendHostedQuestion} has a
 * name nothing else in the client uses, for the reason `analysis-port.ts`
 * gives — the controller's own method is `askHostedModel`, so the hook calling
 * the controller cannot keep this one alive by name.
 */

import type { SealedStep } from '../ride-analysis/sealed-step';
import type { UntrustedText } from './model-answer';

/** What this client may ask, as a closed set. */
export type HostedQuestion = 'connection-check';

/**
 * The words sent for each question, verbatim — the only text in a request
 * that this repository did not get from the rider.
 */
export const HOSTED_PROMPTS: Readonly<Record<HostedQuestion, string>> = {
  'connection-check':
    'This is a test of the connection between an app and this service. Reply with the single ' +
    'word: ready',
};

/**
 * One question, or one sealed step of the ride analysis, and nothing else.
 * @see this file's header
 */
export type HostedRequest = { readonly question: HostedQuestion } | { readonly step: SealedStep };

/**
 * How the service said its reply ended — `choices[0].finish_reason`. The
 * runner fails a step whose reply was cut off (`length`) rather than taking
 * half an answer; the connection check ignores it.
 */
export type HostedFinish = 'stop' | 'length' | 'other';

/** Why a question was not answered. Every member has a sentence below. */
export type HostedFailure =
  /** The rider has not turned the hosted model on since the app was opened. */
  | 'not-consented'
  /** No service is saved on this device. */
  | 'not-configured'
  /**
   * The request was not a question name or a step the runner sealed — the
   * run-time half of "never a picture". Reached without a request being made.
   */
  | 'not-numbers'
  /**
   * The rider's masking list or privacy zones could not be read on this
   * device, so the request could not be masked and was not sent (#839).
   */
  | 'not-masked'
  /** The request never reached an answer. A browser says nothing more to a page. */
  | 'unreachable'
  /** The deadline passed with no answer. Set by `useHostedCheck.ts`, never by a port. */
  | 'no-answer'
  /** The service refused the key. */
  | 'key-refused'
  /**
   * The service said too many requests, or the account is over its limit —
   * an HTTP 429. On a paid service this is among the likeliest failures, and
   * the address is right, so it is not `not-a-model-service` (#760 review).
   */
  | 'over-limit'
  /**
   * The service turned the question down — an HTTP 400, 404 or 422. From an
   * OpenAI-compatible service at the one path this client uses, that is most
   * often a model name it does not know or the account cannot use.
   */
  | 'request-refused'
  /** Something answered, and it is not a model service this client can talk to. */
  | 'not-a-model-service'
  /** The service answered with an error of its own. */
  | 'failed-on-service'
  /** The answer was not in the shape a model service gives. */
  | 'malformed'
  /** The answer was larger than this client will read. */
  | 'too-large'
  /** The rider, or a newer request, cancelled this one. */
  | 'cancelled';

/**
 * What the rider is told about each failure.
 *
 * ⚠️ **A fixed table, and no sentence carries the key, the address or
 * anything the service said** — ADR 0029 D-8's rule, and the owner's *"never
 * reaches … an error"* for the key.
 */
export const HOSTED_FAILURE_TEXT: Readonly<Record<HostedFailure, string>> = {
  'not-consented': 'The hosted model is off. Turn it on above first. Nothing was sent.',
  'not-configured': 'No service is saved. Enter its address, model and your key above first.',
  'not-numbers':
    'This app only sends a hosted model a question and numbers, and this request carried something else, so nothing was sent.',
  'not-masked':
    'Your list of words to mask, or your privacy zones, could not be read on this device, so nothing could be masked and nothing was sent.',
  unreachable:
    'The service could not be reached. Check the address, that this device is online, and that the service accepts requests from an app like this one.',
  'no-answer': 'The service has not answered yet. If it answers, this will change by itself.',
  'key-refused': 'The service refused your key. Check that it is right and still valid.',
  'over-limit':
    'The service said there have been too many requests, or that your account is over its limit. Try again later, or check your account with the service.',
  'request-refused':
    'The service turned the question down. Check the model name, that your account can use that model, and the address.',
  'not-a-model-service':
    'Something answered at that address, but it is not a model service this app can talk to. Check the address.',
  'failed-on-service':
    'The service reported an error. Check that the model name is right and that your account can use it.',
  malformed: 'The service answered, but not in a form this app can read.',
  'too-large': 'The service answered with more than this app will read, so it was ignored.',
  cancelled: 'Cancelled.',
};

/**
 * What came back. `description` is untrusted input for the reason
 * `model-answer.ts` §`AnalysisOutcome` gives. For the connection check it goes
 * no further than `useHostedCheck.ts`, which reduces it to "understood" and a
 * length; for a step, no further than the analysis runner, through
 * `ride-analysis/hosted-step.ts` (#803).
 */
export type HostedOutcome =
  | {
      readonly kind: 'described';
      readonly description: UntrustedText;
      readonly finish: HostedFinish;
    }
  | { readonly kind: 'failed'; readonly failure: HostedFailure };

/** A request in flight. */
export interface HostedCall {
  /** Settles with an outcome; never rejects. */
  readonly outcome: Promise<HostedOutcome>;
  /** Stop waiting, and stop the request. The outcome settles as `cancelled`. Idempotent. */
  cancel(): void;
}

/** The one seam between this client and a hosted model. */
export interface HostedPort {
  /** Send one question or one sealed step — and nothing else — and read the answer. */
  sendHostedQuestion(request: HostedRequest): HostedCall;
}
