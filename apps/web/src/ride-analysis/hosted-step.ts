// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **One step of the ride analysis, sent to the hosted model on the rider's
 * own key** — [#803](https://github.com/openzigs/onyourleft/issues/803), epic
 * #795.
 *
 * The {@link ModelStepPort} the runner asks one step at a time when the rider
 * chose their hosted model. It sends nothing itself: every step goes through
 * `camera/session.ts` §`CameraController.askHostedModel`, which checks
 * `consent.hosted` — off whenever the app is opened — and the saved service
 * **on every step**, and then through `camera/hosted-transport.ts`, the one
 * module with the hosted path's `fetch`, where the key is read and put in one
 * header.
 *
 * ## Never a picture
 *
 * The owner's ruling 2 on #795, three ways:
 *
 * 1. **By type.** The controller takes a `SealedStep`, which only
 *    `sealed-step.ts` §`sealStep` makes, and only the runner calls that.
 * 2. **At run time.** A step that was not sealed by the runner is refused here
 *    as `not-numbers` before the controller is asked, and again in the
 *    transport (`hosted-transport.ts` §`isBuiltRequest`), which also applies
 *    `own-computer-step.ts` §`isTextOnlyStep`'s rules.
 * 3. **In the graph.** This module is under `ride-analysis/`, so
 *    `camera/no-picture-reachable.test.ts` walks it and everything it imports.
 *    It names the controller by a structural interface,
 *    {@link HostedStepAsker}, rather than importing `camera/session.ts`,
 *    which holds pictures by design.
 *
 * ## What a step is told
 *
 * The service's words, as untrusted text, and how the reply ended; the runner
 * validates them and hands them only to the template's acceptors and the
 * screen (#798). A failure is the hosted path's own named failure, from its
 * fixed table — never the key, the address or anything the service said.
 *
 * ## Cancelling
 *
 * The runner's signal cancels the call, and the call aborts its `fetch`
 * (`hosted-transport.ts` §"Cancelling"), so the connection is closed. The
 * ride's numbers were sent when the step began; `ride-analysis.ts`
 * §`CANCELLED_TEXT` says so.
 */

import type { HostedCall, HostedQuestion } from '../camera/hosted-port';
import type { ModelStepPort, StepReply, StepRequest } from '@onyourleft/analysis';
import { isSealedStep, type SealedStep } from '@onyourleft/analysis';

/**
 * What this port asks of the camera controller — the one method that checks
 * the hosted consent, and the consent it reads. `CameraController` satisfies
 * it as it stands.
 */
export interface HostedStepAsker {
  state(): { readonly consent: { readonly hosted: boolean } };
  askHostedModel(asked: HostedQuestion | SealedStep): HostedCall;
}

/**
 * A step port to the rider's hosted model — or `undefined` when it is not
 * turned on since the app was opened, or no service is saved, which is no
 * port at all rather than one that refuses. Built afresh on every look-up, so
 * the ride page offers the hosted model only while both hold.
 *
 * ⚠️ **`undefined` here is an offer withheld, not the gate.** The gate is
 * `askHostedModel`'s own check, made again on every step.
 */
export function hostedStepPort(
  asker: HostedStepAsker,
  configured: () => boolean,
): ModelStepPort | undefined {
  if (!asker.state().consent.hosted || !configured()) {
    return undefined;
  }
  return {
    async runModelStep(step: StepRequest, signal: AbortSignal): Promise<StepReply> {
      if (!isSealedStep(step)) {
        return { kind: 'failed', failure: 'not-numbers' };
      }
      // ADR 0040 D-9: the rider's history — their own notes and documents —
      // goes to a hosted model only once the consent, the privacy policy and
      // Play Data Safety say so, and they do not yet. The ask never sends one
      // on this path (`ride-analysis.ts`); this refuses it if anything did (#835).
      if (step.kind === 'history') {
        return { kind: 'failed', failure: 'not-numbers' };
      }
      if (signal.aborted) {
        return { kind: 'failed', failure: 'cancelled' };
      }
      const call = asker.askHostedModel(step);
      const onAbort = (): void => {
        call.cancel();
      };
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        const outcome = await call.outcome;
        return outcome.kind === 'described'
          ? { kind: 'answered', text: outcome.description, finish: outcome.finish }
          : { kind: 'failed', failure: outcome.failure };
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
    },
  };
}
