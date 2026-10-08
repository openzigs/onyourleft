// SPDX-License-Identifier: Apache-2.0

/**
 * **The one seam between the analysis runner and a model** —
 * [#811](https://github.com/openzigs/onyourleft/issues/811), epic #795.
 *
 * The runner (`runner.ts`) asks for one step at a time and never learns how the
 * step reached a model: the rider's own computer in a browser, the same through
 * the Android shell's native HTTP, or a hosted service (#802, #803). Each of
 * those implements this port. The rider's own computer's is
 * `own-computer-step.ts` (#802); the hosted one is #803's, and #804 wires the
 * first press.
 *
 * ⚠️ **Called since #804.** The ride page's press (`RideWriteUpControl.tsx`)
 * asks `ride-analysis.ts` §`createRideAnalysis`, which runs the runner over
 * the step port `main.tsx` builds, so the two `@unwired` tags #802 left here
 * came off with it.
 *
 * ## Why a `*-port.ts`
 *
 * docs/agents/wiring-gate.md §4j: `check:wiring` watches every `*-port.ts`, so a method here
 * that no production declaration calls is a red `WIRE003`. The runner calls
 * {@link ModelStepPort.runModelStep}; a runner that stopped calling it — and so
 * wrote every write-up from nothing — would go red there as well as in its own
 * tests.
 *
 * ## What a step carries, and what it does not
 *
 * A step request is built from a template's prompt (#810) and the step's own
 * bounds, and nothing else: no picture (`no-picture-reachable.test.ts` walks
 * this file), no address, no model name and no key. Where a model is and what
 * it is called are the transport's, which reads them from the device.
 *
 * ## Never rejects
 *
 * Every way a step can go wrong is a {@link StepReply} of kind `failed`, so the
 * runner's policy for a weak model is the only place a failure is decided on.
 * A port that threw would be a second policy, written by accident.
 */

import type { UntrustedText } from './screen/model-answer';
import type { AnalysisStepKind, ReplySchema } from './template/template';

/** One step, as it is sent. */
export interface StepRequest {
  /** Which step of the template this is — for a transport's own bookkeeping, never sent. */
  readonly kind: AnalysisStepKind;
  readonly system: string;
  readonly user: string;
  /** Sent as a `response_format` hint on a step whose reply is JSON; the runner validates regardless. */
  readonly replySchema?: ReplySchema;
  /** Sent as `max_tokens`: the step's own bound (#810). */
  readonly maximumTokens: number;
  /** Sent as `temperature`. */
  readonly temperature: number;
}

/**
 * How a model's reply ended, as its server reported it. `length` is a reply
 * cut off at `max_tokens` — or, on a server with a small context window, one
 * whose prompt was cut — and the runner treats it as a failed step, not a
 * short answer (#811).
 */
export type StepFinish = 'stop' | 'length' | 'other';

/**
 * Why a step failed, in its transport's own words: an `AnalysisFailure`
 * from the rider's own computer, or the hosted transport's `HostedFailure`
 * (`apps/web/src/camera/hosted-port.ts`), which stays with the transport that
 * names it. A string here, because this package names no transport (ADR 0046
 * D-5, #1094) and the runner reads none of them: a failed step is a failed
 * step, whatever its transport called it.
 */
export type StepFailure = string;

/** What came back for one step. */
export type StepReply =
  | { readonly kind: 'answered'; readonly text: UntrustedText; readonly finish: StepFinish }
  | { readonly kind: 'failed'; readonly failure: StepFailure };

/** What the runner asks of whatever reaches a model. */
export interface ModelStepPort {
  /**
   * Send one step and read its reply. Settles; never rejects. When `signal`
   * aborts, the transport stops the request if it can — in a browser it can;
   * inside the Android shell it cannot (spike 0016 §2.1), and the runner
   * discards whatever arrives late either way.
   */
  runModelStep(step: StepRequest, signal: AbortSignal): Promise<StepReply>;
}
