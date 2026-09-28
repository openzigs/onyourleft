// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What this client may ask the rider's own computer about a picture, and the
 * named ways it can fail** ([#387](https://github.com/openzigs/onyourleft/issues/387),
 * [ADR 0029](../../../../docs/adr/0029-camera-imagery-as-a-data-class.md) D-6,
 * D-7, D-8).
 *
 * Given a capture and a question, the port returns a description or a named
 * failure. That is the whole seam, and everything that makes it safe lives on
 * one side of it or the other:
 *
 * - **behind it**, `analysis-transport.ts` — the ONE module in this client
 *   permitted a network primitive (`privacy/no-network.test.ts` is the gate),
 *   and `analysis-response.ts`, which reads what came back as untrusted input;
 * - **in front of it**, `session.ts` §`CameraController.askAboutPicture`, which
 *   refuses before capturing anything when nothing is configured, and
 *   `useAnalysis.ts`, which owns the deadline.
 *
 * ## The rider's computer, not ours, and not #7's
 *
 * ⚠️ **The machine at the other end of this port is the RIDER's** — a process
 * in their own house that this project never sees, never operates and never
 * pays for. It is not [#7](https://github.com/openzigs/onyourleft/issues/7)'s
 * instance, which is ours and does not exist in Phase 1 (owner decision D6),
 * and a reader who conflates the two will conclude this client started
 * uploading rides. It did not: it sends one picture, on a press, to an address
 * the rider typed, which `analysis-endpoint.ts` refuses unless it is on the
 * rider's own network.
 *
 * The owner's words for what this permits, from ADR 0029's 2026-09-23
 * amendment: *"No network except a local endpoint the rider configured and
 * switched on."* **Configured** and **switched on** are separate conditions and
 * `analysis-endpoint.ts` keeps them separate.
 *
 * ## Why this is a `*-port.ts`, and the half of the wiring the gate cannot see
 *
 * CLAUDE.md §4j: `check:wiring` watches every `*-port.ts` under `apps/`, and
 * `WIRE003` reports a method declared here that no production declaration
 * calls. `camera/` is in no watched directory, so without the suffix a correct,
 * tested transport that nothing called would be invisible — #278's defect.
 *
 * ⚠️ **{@link AnalysisPort.askAboutFrame} carries a distinctive name for the
 * reason `camera-port.ts` records**: names are matched as names, and a method
 * called `analyse` or `describe` would be kept alive by some unrelated call of
 * the same name. Measured both ways in #387's pull request — deleting the one
 * call in `session.ts` §`askAboutPicture` is a red `WIRE003` naming this
 * method (and a `WIRE002` on {@link ANALYSIS_PROMPTS}, which only the
 * transport reads), and restoring it is green.
 *
 * ⚠️ **What the gate cannot see, measured rather than assumed — two holes, both
 * GREEN under mutation:**
 *
 * 1. `main.tsx` building the `CameraController` **without** its `analysis`
 *    option. An optional option nobody supplies is well typed and the call
 *    inside the controller is still there — `check-wiring.mjs` §Limits' third
 *    entry, the shape `camera-port.ts` and `support/shell-support-port.ts`
 *    record.
 * 2. `CameraView` **never pressing** — the button's `ask('connection-check')`
 *    deleted. `useAnalysis.ts` still names `askAboutPicture` inside the
 *    callback it returns, and the gate cannot tell a callback that is handed
 *    back from one that is ever invoked.
 *
 * `CameraView.test.tsx` §"#387" §"sends one picture to the address the rider
 * typed, through the controller main.tsx builds" goes red for the second, and
 * this paragraph is what stands for the first.
 *
 * ## No transport type crosses this file
 *
 * Nothing here names a `Response`, a `RequestInit`, a `Headers` or an
 * `AbortSignal`. Cancellation is a method on {@link AnalysisCall} rather than a
 * signal passed in, so a second transport — a native plugin, a worker — can
 * satisfy this interface without the interface changing under it.
 * `analysis-boundary.test.ts` asserts it, the way `camera/boundary.test.ts`
 * asserts no `MediaStream` leaves `camera/`.
 */

import type { CapturedFrame } from './camera-port';

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
 * The words sent for each question, verbatim.
 *
 * The connection check asks the model **not** to describe the picture, and the
 * reason is ADR 0030 rather than politeness: nothing on the screen that asks it
 * shows what came back (see `useAnalysis.ts`), so a description would be a
 * statement about a body that nobody reads and somebody's disk might hold.
 */
export const ANALYSIS_PROMPTS: Readonly<Record<AnalysisQuestion, string>> = {
  'connection-check':
    'This is a test of the connection between an app and this computer. Do not describe the ' +
    'picture. Reply with the single word: ready',
  // #553. ⚠️ **The answer's shape is this repository's own**, and
  // `computer-pose.ts` §`sidePoseFromAnswer` is its only reader: a key it does
  // not know is refused rather than ignored (ADR 0017 D-4's rule), and a
  // number outside the picture is refused rather than clamped. The landmark
  // names are `side-analysis-port.ts` §`SIDE_POSE_LANDMARKS`, in that order;
  // `computer-pose.test.ts` holds this text to that list, so a tenth landmark
  // there is a red test here rather than a question nobody asks.
  //
  // ⚠️ **#761: the question does not say a rider is there.** It used to open
  // "This picture shows a person riding a bicycle…", which presupposes the
  // answer, and on spike 0016 §5.4's twelve pictures of nobody not one answer
  // said `{"rider":false}`. It now asks first, and says what to answer when
  // unsure. `computer-pose.test.ts` holds the opening to that.
  'side-pose':
    'First decide whether this picture shows a person riding a bicycle, filmed from the side. ' +
    'It may show nobody at all: an empty room, a blank picture or noise. If it does not clearly ' +
    'show a person on a bicycle, or you are not sure, reply with JSON only: {"rider":false} ' +
    'Only if it clearly does, find the side of their body nearest the camera and reply with ' +
    'JSON only, with no other text, ' +
    'in exactly this form: {"rider":true,"nearSide":"left","landmarks":{"ear":[x,y],' +
    '"shoulder":[x,y],"elbow":[x,y],"wrist":[x,y],"hip":[x,y],"knee":[x,y],"ankle":[x,y],' +
    '"heel":[x,y],"toe":[x,y]}} where x and y are the point as fractions of the picture from its ' +
    'top-left corner, each between 0 and 1, "toe" is the tip of the shoe, "nearSide" is the ' +
    'person’s own left or right, and a point you cannot see is null.',
};

/** One picture and one question, which is everything the port is given. */
export interface AnalysisRequest {
  readonly frame: CapturedFrame;
  readonly question: AnalysisQuestion;
}

/**
 * Why a picture was not described.
 *
 * Every member has a sentence in {@link ANALYSIS_FAILURE_TEXT}, and every one
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

/** The one seam between this client and the rider's own computer. */
export interface AnalysisPort {
  /**
   * Send one picture and one fixed question, and read the answer.
   *
   * ⚠️ **Unbounded in time, deliberately**, for the reason
   * `support/useShellSupport.ts` gives: a deadline in the port would abandon an
   * answer at the moment it arrived. A small model on a laptop takes tens of
   * seconds over a picture, and a late answer is still the answer — so the
   * deadline is in `useAnalysis.ts`, and a late answer replaces its message.
   */
  askAboutFrame(request: AnalysisRequest): AnalysisCall;
}

/**
 * What the rider is told about each failure.
 *
 * ⚠️ **A fixed table, and no sentence here carries the picture, a part of it,
 * the address, or anything the machine said** — ADR 0029 D-8, which binds
 * harder than the coordinate rule because *"nothing about an image is diagnosed
 * by having the image in the log"*. A server's own error text is discarded at
 * `analysis-response.ts` for the same reason: it is written by a program this
 * project does not control, and it may quote what it was sent.
 */
export const ANALYSIS_FAILURE_TEXT: Readonly<Record<AnalysisFailure, string>> = {
  'not-configured':
    'No computer is set up to look at your pictures. Enter its address below and switch it on first.',
  'no-picture':
    'No picture was taken, so nothing was sent. Turn the camera on above and try again.',
  'picture-too-large': 'The picture was too large to send, so nothing was sent.',
  unreachable:
    'Your computer could not be reached. Check that it is on, that the address is right, that ' +
    'this device is on the same network, and that its model server allows this app to connect.',
  'no-answer':
    'Your computer has not answered yet. A small model can take a minute over a picture; if it ' +
    'answers, this will change by itself.',
  refused:
    'Your computer refused the request. Its model server is asking for a key, and this app ' +
    'does not send one.',
  'not-a-model-server':
    'Something answered at that address, but it is not a model server this app can talk to. ' +
    'Check the port number.',
  'failed-on-machine':
    'The model server on your computer reported an error. Check that the model name is right ' +
    'and that the model can read pictures.',
  malformed: 'Your computer answered, but not in a form this app can read.',
  'too-large': 'Your computer answered with more than this app will read, so it was ignored.',
  cancelled: 'Cancelled.',
  'address-not-numeric':
    'In this app on Android, your computer’s address has to be its private address written as ' +
    'numbers, such as http://192.168.1.20:8080. A name is not accepted here, and nothing was sent.',
};
