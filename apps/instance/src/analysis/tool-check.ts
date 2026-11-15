// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Does this local model call tools?** — #2610, the owner's check before a
 * model is saved (#2611). ADR 0046 D-7 requires tool calling with no
 * fallback, so a model that cannot is no model for a write-up.
 *
 * ## What is sent, in full
 *
 * {@link TOOL_CHECK_SYSTEM}, {@link TOOL_CHECK_QUESTION} and ONE tool,
 * {@link TOOL_CHECK_TOOL}, which takes nothing and answers
 * {@link TOOL_CHECK_ANSWER}: constants of this repository. Then, if the model
 * called it, the same conversation with the call and its answer. **No ride,
 * no rider text and no history**: nothing of any athlete's, the owner's
 * included. It goes through `model.ts` §`createLocalModel` — the one module
 * that names the SDK — so the address is checked on every turn, the request
 * goes to the checked address, and the server's own words never cross back.
 * The connection is HANDED in ({@link ToolCheckOptions.connect}, built in
 * `instance.ts`), so this module, and the Operate area that holds it, import
 * no SDK and nothing `model.ts` reaches (`agent-safety.test.ts`,
 * `history/no-picture.test.ts`).
 *
 * It passes, `tools-ok`, only if the model called the tool and then
 * answered. Only the LOCAL source is checked: a hosted service has its own
 * test question per rider (`hosted-test.ts`, `POST /v1/analysis/hosted/test`).
 *
 * ## Bounds
 *
 * - **One at a time for the instance**: a second, while one is out, is
 *   `busy` and sends nothing.
 * - **Time**: the clock is read before each turn, and the check is
 *   `out-of-time` once {@link TOOL_CHECK_MILLISECONDS} has passed; each turn
 *   is given what is left of it.
 * - **Tokens**: each turn may answer {@link TOOL_CHECK_OUTPUT_TOKENS}, and
 *   the operator's reasoning allowance on top, as a job's turn is.
 * - **Stopping the instance** aborts a check that is out: `stopped`.
 *
 * ⚠️ Asking Ollama for a model loads it, which may unload the model a
 * rider's job is using: the route's summary and the panel say so.
 */

import { TOOL_CHECK_MILLISECONDS, TOOL_CHECK_OUTPUT_TOKENS } from './agent.ts';
import type { AgentMessage, ModelConnection, ModelFailure, ToolSpec } from './model-turn.ts';

/** The check's system prompt: a constant, with nothing of anybody's in it. */
export const TOOL_CHECK_SYSTEM =
  'This is a check that a model can call tools, sent by a cycling app’s server. No ride and no personal data is included. When asked for the number, call the tool, then reply with one short sentence that says it.';

/** The check's one question: a constant. */
export const TOOL_CHECK_QUESTION =
  'What number does the fixed_number tool give? Call it to find out.';

/** The check's one tool: it takes nothing and does nothing but answer {@link TOOL_CHECK_ANSWER}. */
export const TOOL_CHECK_TOOL: ToolSpec = {
  name: 'fixed_number',
  description: 'Gives a fixed number. Takes no arguments.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
};

/** What {@link TOOL_CHECK_TOOL} answers. */
export const TOOL_CHECK_ANSWER = '42';

/** How a check went. Closed: no word of the server's is in it. */
export type ToolCheckOutcome =
  /** The model called the tool, then answered. */
  | 'tools-ok'
  /** The model answered without calling the tool, or called it and then said nothing. */
  | 'no-tool-call'
  /** The server said this model does not support tools. */
  | 'does-not-support-tools'
  /** The server refused, failed, gave no answer, or one that is not a chat completion. */
  | 'server-error'
  /** The address, or what its name resolves to now, is outside the local ranges. */
  | 'not-local'
  /** Longer than {@link TOOL_CHECK_MILLISECONDS}. */
  | 'out-of-time'
  /** The instance stopped while the check was out. */
  | 'stopped'
  /** No address is set, or the one set fails `.env`'s rule: nothing was sent. */
  | 'no-address'
  /** Another check was out: nothing was sent. */
  | 'busy';

/** Every {@link ToolCheckOutcome}, for the specification and the operator log. */
export const TOOL_CHECK_OUTCOMES: readonly ToolCheckOutcome[] = [
  'tools-ok',
  'no-tool-call',
  'does-not-support-tools',
  'server-error',
  'not-local',
  'out-of-time',
  'stopped',
  'no-address',
  'busy',
];

/**
 * The local model to check: its server, its name, and the operator's
 * reasoning allowance — `model.ts` §`AnalysisModelSettings`'s shape.
 */
export interface ToolCheckTarget {
  readonly baseUrl: URL;
  readonly model: string;
  readonly reasoningTokens?: number;
}

export interface ToolCheckOptions {
  /**
   * The connection to `target`: `model.ts` §`createLocalModel`, which checks
   * the address on every turn.
   */
  readonly connect: (target: ToolCheckTarget) => ModelConnection;
  /** Unix milliseconds: what the check's time is read from. */
  readonly now: () => number;
  /** Aborted when the instance stops: a check that is out ends `stopped`. */
  readonly stopped?: AbortSignal;
  /** {@link TOOL_CHECK_MILLISECONDS} unless a test's. */
  readonly budgetMs?: number;
}

export interface ToolCheck {
  /** Check `target`, or `busy` while another check is out. */
  run(target: ToolCheckTarget): Promise<ToolCheckOutcome>;
}

function outcomeOf(failure: ModelFailure): ToolCheckOutcome {
  switch (failure) {
    case 'model-without-tools':
      return 'does-not-support-tools';
    case 'not-local':
      return 'not-local';
    case 'timed-out':
      return 'out-of-time';
    case 'aborted':
      return 'stopped';
    case 'unresolved':
    case 'unreachable':
    case 'refused':
    case 'server-error':
    case 'malformed':
      return 'server-error';
  }
}

/** The instance's one tool check. @see the file comment. */
export function createToolCheck(options: ToolCheckOptions): ToolCheck {
  const budget = options.budgetMs ?? TOOL_CHECK_MILLISECONDS;
  const signal = options.stopped ?? new AbortController().signal;
  let out = false;

  async function check(target: ToolCheckTarget): Promise<ToolCheckOutcome> {
    const model = options.connect(target);
    const maxOutputTokens = TOOL_CHECK_OUTPUT_TOKENS + (target.reasoningTokens ?? 0);
    const started = options.now();
    const left = (): number => budget - (options.now() - started);
    const messages: AgentMessage[] = [{ role: 'user', text: TOOL_CHECK_QUESTION }];
    const turn = (history: readonly AgentMessage[]) =>
      model.turn({
        system: TOOL_CHECK_SYSTEM,
        messages: history,
        tools: [TOOL_CHECK_TOOL],
        maxOutputTokens,
        timeoutMilliseconds: left(),
        signal,
      });

    const first = await turn(messages);
    if (!first.ok) return outcomeOf(first.failure);
    const calls = first.calls.filter(
      (call) => call.toolName === TOOL_CHECK_TOOL.name && call.invalid !== true,
    );
    if (calls.length === 0) return 'no-tool-call';
    if (signal.aborted) return 'stopped';
    if (left() <= 0) return 'out-of-time';
    const second = await turn([
      ...messages,
      { role: 'assistant', text: first.text, calls },
      {
        role: 'tool',
        results: calls.map((call) => ({
          callId: call.callId,
          toolName: call.toolName,
          text: TOOL_CHECK_ANSWER,
        })),
      },
    ]);
    if (!second.ok) return outcomeOf(second.failure);
    return second.text.trim() === '' ? 'no-tool-call' : 'tools-ok';
  }

  return {
    async run(target) {
      if (out) return 'busy';
      if (signal.aborted) return 'stopped';
      out = true;
      try {
        return await check(target);
      } finally {
        out = false;
      }
    },
  };
}
