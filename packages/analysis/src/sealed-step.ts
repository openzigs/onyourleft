// SPDX-License-Identifier: Apache-2.0

/**
 * **A step the runner built, and nothing else** —
 * [#803](https://github.com/openzigs/onyourleft/issues/803), epic #795.
 *
 * The hosted path sends a ride's numbers to a third party the rider chose, on
 * their own key, and the owner's ruling is that it is **never** sent a picture.
 * A {@link StepRequest} is plain text by type already, and
 * `own-computer-step.ts` §`isTextOnlyStep` refuses one that is not at run
 * time. What neither says is WHO wrote the text: a caller holding a picture
 * could base64 it into `user` and the request would still be two strings.
 * This module is what says it: a {@link SealedStep} is a step whose text came
 * out of #810's prompt builders, over #809's input, through the runner — and
 * nothing else can make one.
 *
 * ## Two halves
 *
 * - **The type.** {@link SealedStep} carries a brand keyed by a `unique
 *   symbol` that is declared here and never exported, so no object literal
 *   outside this file satisfies it. `hosted-port.ts` §`HostedRequest` takes a
 *   sealed step, so a frame, a `Blob`, an `ImageBitmap`, an `ImageData` or a
 *   caller's own string does not compile there
 *   (`hosted-transport.test.ts` pins each with a `@ts-expect-error`).
 * - **The run time.** A cast gets round a brand. So {@link sealStep} records
 *   every step it makes in a module-private `WeakSet`, and
 *   {@link isSealedStep} answers from that set alone — an object that looks
 *   exactly like a sealed step and was not made here is refused. The step is
 *   frozen, so its text cannot be changed after it was sealed.
 *
 * ## Who may seal
 *
 * The runner, and only the runner: it is where a template's prompt becomes a
 * request (`runner.ts` §`ask`). `sealed-step.test.ts` reads the tree and
 * fails if any other production module names {@link sealStep} — the same
 * shape as `camera/hosted-key.test.ts`'s scan for the key's storage row.
 */

import type { StepRequest } from './model-step-port';

declare const sealed: unique symbol;

/** A {@link StepRequest} the runner built from a template's prompt. Only {@link sealStep} makes one. */
export type SealedStep = StepRequest & { readonly [sealed]: true };

/** Every step {@link sealStep} has made. Weak, so a finished run's steps are not kept. */
const SEALED = new WeakSet<object>();

/**
 * Seal a step the runner built. ⚠️ **The runner is the one caller** — see the
 * file comment. The copy is frozen; the reply schema, when there is one, is
 * the template's own constant and is not sent on the hosted path at all.
 */
export function sealStep(step: StepRequest): SealedStep {
  const copy: StepRequest = Object.freeze({
    kind: step.kind,
    system: step.system,
    user: step.user,
    ...(step.replySchema === undefined ? {} : { replySchema: step.replySchema }),
    maximumTokens: step.maximumTokens,
    temperature: step.temperature,
  });
  SEALED.add(copy);
  return copy as SealedStep;
}

/** Whether `value` is a step {@link sealStep} made — by identity, never by shape. */
export function isSealedStep(value: unknown): value is SealedStep {
  return typeof value === 'object' && value !== null && SEALED.has(value);
}
