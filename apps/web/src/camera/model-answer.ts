// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What a model answers, with no picture in reach** — the question names, the
 * failures, the outcome and the untrusted text a model writes.
 *
 * ⚠️ **Split out of `analysis-port.ts` by #799**, and a reviewer who remembers
 * these types there is reading the old file. That port declares
 * `AnalysisRequest`, which carries a `CapturedFrame`, so every module that
 * imported `UntrustedText` from it — `hosted-port.ts`, `analysis-response.ts`
 * and through them the whole hosted path — reached a picture type in two
 * imports, while #760's per-file scan read each file and reported clean.
 * `no-picture-reachable.test.ts` walks the graph and goes red on that.
 *
 * **This file imports nothing**, and must name no picture: it is on the path
 * of every model request, the ride analysis's included.
 */

/**
 * What this client may ask, as a closed set.
 *
 * ⚠️ **A name rather than a string of the caller's choosing**, because ADR 0029
 * D-7 says the bytes that leave are *"the frame, and a fixed prompt this
 * repository's source contains. Nothing else"*. A free-text question would let
 * any caller put anything at all beside the picture — an athlete id, a ride
 * name — and the body would still look like "a prompt".
 *
 * Two members. ⚠️ This said *"one member today"* until
 * [#553](https://github.com/openzigs/onyourleft/issues/553) added
 * `side-pose`: the side camera's pictures, sent on to the rider's computer
 * when the rider has switched that on (ADR 0033 D-11), each asking for the
 * near side's landmarks as numbers. Each question is bound by
 * [ADR 0030](../../../../docs/adr/0030-what-the-app-may-say-about-a-body.md):
 * neither asks for an angle, a length or anything about a body beyond where
 * a point is in the picture.
 */
export type AnalysisQuestion = 'connection-check' | 'side-pose';

/**
 * Why a picture was not described.
 *
 * Every member has a sentence in `analysis-port.ts` §`ANALYSIS_FAILURE_TEXT`, and every one
 * of those sentences says what the rider can do about it.
 */
export type AnalysisFailure =
  /**
   * No address, or an address the rider has not switched on.
   *
   * ⚠️ **The ordinary state of every install, and it is reached WITHOUT a
   * picture being taken or a request being made.** `session.ts` checks it
   * before the camera; `analysis-session.test.ts` asserts, through the real
   * transport over an empty device, that the send was never called.
   */
  | 'not-configured'
  /** The camera is off, not agreed to, throttled, or could not take a picture. */
  | 'no-picture'
  /** The picture is larger than this client will send. */
  | 'picture-too-large'
  /**
   * The request never reached an answer: the machine is off, the address is
   * wrong, the browser refused the connection, or its server does not allow
   * this app's address. A browser reports all of these as one failure and says
   * nothing more to a page, deliberately, so this cannot either.
   */
  | 'unreachable'
  /** The deadline passed with no answer. Set by `useAnalysis.ts`, never by a port. */
  | 'no-answer'
  /** The machine answered and said no — it wants a key this client does not send. */
  | 'refused'
  /** Something answered, and it is not a model server this client can talk to. */
  | 'not-a-model-server'
  /** The model server answered with an error of its own. */
  | 'failed-on-machine'
  /** The answer was not in the shape a model server gives. */
  | 'malformed'
  /** The answer was larger than this client will read. */
  | 'too-large'
  /** The rider, or a newer request, cancelled this one. */
  | 'cancelled'
  /**
   * Inside the Android shell, the address is not a private address written as
   * numbers — #553. Reached **without** a request being made: the native path
   * is held to `analysis-endpoint.ts` §`isPrivateAddressLiteral`, and a name or
   * this device's own address is refused before anything is sent.
   */
  | 'address-not-numeric';

/**
 * What came back.
 *
 * ⚠️ **`description` is untrusted input and is typed as such.** A vision model's
 * output is attacker-influenceable *through the image* — a sign held up behind
 * the rider is a prompt — and ADR 0029 D-8 says it is never interpolated into a
 * path, a URL, a command, or anything that reaches a trainer control point.
 * {@link UntrustedText} is a brand so that no string becomes one except in
 * `analysis-response.ts`, which is the one place it is cleaned and bounded —
 * and so that every holder of one can be found by its type. ⚠️ **A brand does
 * NOT stop it being used as a `string`**; what holds the rest is
 * `analysis-safety.test.ts`.
 */
export type AnalysisOutcome =
  | { readonly kind: 'described'; readonly description: UntrustedText }
  | { readonly kind: 'failed'; readonly failure: AnalysisFailure };

declare const untrusted: unique symbol;

/** Text a model wrote. Bounded, stripped of control characters, and believed by nothing. */
export type UntrustedText = string & { readonly [untrusted]: true };

/** A request in flight. */
export interface AnalysisCall {
  /** Settles with an outcome; never rejects. */
  readonly outcome: Promise<AnalysisOutcome>;
  /**
   * Stop waiting, and stop the request if it has not finished. The outcome then
   * settles as `cancelled`. Idempotent.
   */
  cancel(): void;
}
