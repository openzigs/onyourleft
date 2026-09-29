// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **One step of the ride analysis, sent to the rider's own computer as text**
 * — [#802](https://github.com/openzigs/onyourleft/issues/802), epic #795.
 *
 * The {@link ModelStepPort} the runner (`runner.ts`) asks one step at a time.
 * It sends a template's prompt (#810) — the ride's numbers, as text — to the
 * address the rider typed and switched on, through the same rule the picture
 * path uses (`camera/analysis-endpoint.ts` §`endpointTarget`), and reads the
 * reply with the same reader (`camera/analysis-response.ts`). **Never a
 * picture**: ADR 0035's owner ruling 2, and three holds keep it so:
 *
 * 1. **By type.** A step is a {@link StepRequest}, which has no field that
 *    could hold a frame; `own-computer-step.test.ts` pins that with a
 *    `@ts-expect-error`.
 * 2. **At run time.** {@link isTextOnlyStep} refuses a step with any field the
 *    type does not declare, any value that is not plain JSON (a byte array, a
 *    blob, a bitmap) and any string holding a `data:` URL — BEFORE anything is
 *    sent, as the named failure `not-numbers` (the hosted path's name for the
 *    same refusal, `camera/hosted-port.ts` §`HostedFailure`).
 * 3. **In the graph.** This module lives here rather than in
 *    `camera/analysis-transport.ts`, which builds pictures into requests by
 *    design, so `camera/no-picture-reachable.test.ts` walks it and every
 *    module it imports, and holds the body it sends to
 *    `no-picture-testing.ts` §`pictureBodyFaults`.
 *
 * ## Where the network is
 *
 * Not here. The client's one `fetch` is in `camera/analysis-transport.ts`
 * (`privacy/no-network.test.ts` counts it), which hands it in as
 * {@link OwnComputerStepOptions.send} through `riderModelStepPort`; inside the
 * Android shell the native request (#553) is handed in instead, and only a
 * private address written as numbers ever reaches it.
 *
 * ## The body
 *
 * {@link stepRequestBody}: the model name the rider typed, the step's system
 * and user prompts as two messages of plain text, `max_tokens`, `temperature`,
 * `stream: false`, and — only on a step whose reply is JSON — a
 * `response_format` hint carrying the step's schema. Nothing else: no ride id,
 * no athlete id, no date, no position. The key set is pinned by a test.
 *
 * ## How a reply ends
 *
 * The reply's `finish_reason` is read and handed to the runner as a
 * {@link StepFinish}: `length` stays `length` — a reply cut off at
 * `max_tokens`, or cut by a server whose context window is too small — and the
 * runner fails that step rather than taking half an answer.
 *
 * ## Cancelling
 *
 * In a browser the runner's signal is the `fetch`'s own, so aborting it closes
 * the connection, which stops generation on the common local servers. ⚠️
 * **Inside the Android shell a native request cannot be aborted from the web
 * side** (spike 0016 §2.1): the step settles `cancelled` at once, the request
 * runs on to its end, and whatever it answers is discarded here.
 * `docs/analysis-on-your-own-computer.md` tells the rider their computer may
 * still be working after a cancel.
 */

import {
  endpointTarget,
  type AddressSpace,
  type AnalysisEndpoint,
} from '../camera/analysis-endpoint';
import { MAXIMUM_RESPONSE_BYTES, readAnalysisReply } from '../camera/analysis-response';
import {
  boundedText,
  type AnalysisSend,
  type NativeAnalysisPost,
  type NativeAnalysisReply,
} from '../camera/http-body';
import type { ModelStepPort, StepFinish, StepReply, StepRequest } from './model-step-port';
import type { AnalysisStepKind } from './template';

/** Every field a {@link StepRequest} may have. Any other is refused. */
export const STEP_REQUEST_FIELDS: readonly (keyof StepRequest)[] = [
  'kind',
  'system',
  'user',
  'replySchema',
  'maximumTokens',
  'temperature',
];

const STEP_KINDS: readonly AnalysisStepKind[] = ['section', 'position', 'summary', 'rewrite'];

/**
 * A `data:` URL anywhere in a string. A prompt is this repository's words and
 * the ride's numbers; it never needs one, and a picture travels as one.
 */
const DATA_URL = /data:[\w.+-]+\/[\w.+-]+[;,]/i;

/** Whether `value` is plain JSON — no byte array, blob, bitmap or class instance — holding no `data:` URL. */
function plainJson(value: unknown, depth = 0): boolean {
  if (depth > 32) {
    return false;
  }
  if (value === null || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value === 'string') {
    return !DATA_URL.test(value);
  }
  if (Array.isArray(value)) {
    return value.every((entry) => plainJson(entry, depth + 1));
  }
  if (typeof value === 'object') {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return false;
    }
    return Object.values(value).every((entry) => plainJson(entry, depth + 1));
  }
  return false;
}

/**
 * Whether `step` is a text-only step and nothing more — the run-time half of
 * "never a picture". A step built by the runner always is; one that carries a
 * field the type does not declare, a value that is not plain JSON or a `data:`
 * URL is refused before a byte is sent.
 */
export function isTextOnlyStep(step: unknown): step is StepRequest {
  if (
    typeof step !== 'object' ||
    step === null ||
    Object.getPrototypeOf(step) !== Object.prototype
  ) {
    return false;
  }
  const fields = step as Record<string, unknown>;
  if (!Object.keys(fields).every((key) => (STEP_REQUEST_FIELDS as string[]).includes(key))) {
    return false;
  }
  const { kind, system, user, replySchema, maximumTokens, temperature } = fields;
  if (
    !STEP_KINDS.includes(kind as AnalysisStepKind) ||
    typeof system !== 'string' ||
    typeof user !== 'string' ||
    !Number.isInteger(maximumTokens) ||
    (maximumTokens as number) <= 0 ||
    typeof temperature !== 'number' ||
    !plainJson(system) ||
    !plainJson(user) ||
    !plainJson(temperature)
  ) {
    return false;
  }
  if (replySchema === undefined) {
    return true;
  }
  if (typeof replySchema !== 'object' || replySchema === null) {
    return false;
  }
  const { name, schema, ...rest } = replySchema as Record<string, unknown>;
  return (
    Object.keys(rest).length === 0 &&
    typeof name === 'string' &&
    typeof schema === 'object' &&
    schema !== null &&
    plainJson(replySchema)
  );
}

/**
 * The JSON body of one step — exported so a test can pin its key set and walk
 * it for a picture. Built only from a step {@link isTextOnlyStep} has passed.
 */
export function stepRequestBody(
  model: string,
  step: StepRequest,
): Readonly<Record<string, unknown>> {
  return {
    model,
    stream: false,
    max_tokens: step.maximumTokens,
    temperature: step.temperature,
    messages: [
      { role: 'system', content: step.system },
      { role: 'user', content: step.user },
    ],
    ...(step.replySchema === undefined
      ? {}
      : {
          response_format: {
            type: 'json_schema',
            json_schema: { name: step.replySchema.name, schema: step.replySchema.schema },
          },
        }),
  };
}

/** How the server said its reply ended: `choices[0].finish_reason`. */
export function finishOf(body: string): StepFinish {
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

/**
 * What a reply means for the runner.
 *
 * `analysis-response.ts` reads it — the one reader of a model's reply — and
 * then the finish is read beside it. ⚠️ Its `picture-too-large` (an HTTP 413)
 * is renamed `failed-on-machine`: nothing here carries a picture, and a server
 * that refuses a prompt's size has failed on the rider's machine.
 */
export function stepReplyFrom(reply: NativeAnalysisReply): StepReply {
  const outcome = readAnalysisReply(reply);
  if (outcome.kind === 'failed') {
    return {
      kind: 'failed',
      failure: outcome.failure === 'picture-too-large' ? 'failed-on-machine' : outcome.failure,
    };
  }
  return { kind: 'answered', text: outcome.description, finish: finishOf(reply.body) };
}

/** @see ownComputerStepPort */
export interface OwnComputerStepOptions {
  /** The platform's `fetch`, handed in by `camera/analysis-transport.ts` §`riderModelStepPort`. */
  readonly send: AnalysisSend;
  /** Inside the Android shell, the native request that replaces `send` (#553). */
  readonly native?: NativeAnalysisPost;
}

const failed = (failure: Extract<StepReply, { kind: 'failed' }>['failure']): StepReply => ({
  kind: 'failed',
  failure,
});

/**
 * A step port to the rider's configured computer — or `undefined` when there
 * is none switched on, for the reason `camera/analysis-transport.ts`
 * §`riderAnalysisPort` gives: no configuration, no object that could send.
 */
export function ownComputerStepPort(
  endpoint: AnalysisEndpoint | undefined,
  options: OwnComputerStepOptions,
): ModelStepPort | undefined {
  const target = endpointTarget(endpoint);
  if (endpoint === undefined || target === undefined) {
    return undefined;
  }
  const { model } = endpoint;
  const { native } = options;
  if (native !== undefined) {
    return nativeStepPort(model, target.url, target.literal, native);
  }
  const { send } = options;
  const { url, space } = target;

  return {
    async runModelStep(step: StepRequest, signal: AbortSignal): Promise<StepReply> {
      if (!isTextOnlyStep(step)) {
        return failed('not-numbers');
      }
      if (signal.aborted) {
        return failed('cancelled');
      }
      // The same settings as the picture path, for the same reasons
      // (`camera/analysis-transport.ts` §"What leaves, exactly"), and the
      // runner's own signal, so a cancel closes the connection.
      const init: RequestInit & { targetAddressSpace: AddressSpace } = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stepRequestBody(model, step)),
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        mode: 'cors',
        signal,
        targetAddressSpace: space,
      };
      let status: number;
      let body: string | undefined;
      try {
        // ⚠️ Nothing of a rejection is read: a network error's message can
        // name the address (ADR 0029 D-8).
        const response = await send(url, init);
        status = response.status;
        body = await boundedText(response, MAXIMUM_RESPONSE_BYTES);
      } catch {
        return failed(signal.aborted ? 'cancelled' : 'unreachable');
      }
      if (body === undefined) {
        return failed('too-large');
      }
      return stepReplyFrom({ status, body });
    },
  };
}

/**
 * The same port over a native request (#553). Only a private address written
 * as numbers is sent to; a native request cannot be aborted from here, so a
 * cancel settles the step at once and the late answer is discarded.
 */
function nativeStepPort(
  model: string,
  url: string,
  literal: boolean,
  native: NativeAnalysisPost,
): ModelStepPort {
  return {
    async runModelStep(step: StepRequest, signal: AbortSignal): Promise<StepReply> {
      if (!isTextOnlyStep(step)) {
        return failed('not-numbers');
      }
      if (!literal) {
        return failed('address-not-numeric');
      }
      if (signal.aborted) {
        return failed('cancelled');
      }
      let onAbort: () => void = () => undefined;
      const abandoned = new Promise<StepReply>((resolve) => {
        onAbort = () => {
          resolve(failed('cancelled'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      });
      const answered = (async (): Promise<StepReply> => {
        try {
          const reply = await native({
            url,
            headers: { 'Content-Type': 'application/json' },
            json: stepRequestBody(model, step),
          });
          return signal.aborted ? failed('cancelled') : stepReplyFrom(reply);
        } catch {
          return failed(signal.aborted ? 'cancelled' : 'unreachable');
        }
      })();
      try {
        return await Promise.race([answered, abandoned]);
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
    },
  };
}
