// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The re-plan agent on the instance** — #1243, ADR 0048 D-4, D-11.
 *
 * A device sends the plan, the rider's typed goals and per-block summaries
 * (`replan-input.ts`); this runs the ADR 0046 tool-calling loop over them
 * with the re-plan template and answers **one `Proposal`** from
 * `@onyourleft/domain`'s closed lists, or none.
 *
 * ## It proposes, and that is all
 *
 * - **It writes no number to anything.** A proposal carries no watt, no share
 *   and no sentence, and this module holds no store and no socket: the model
 *   is the connection it is handed, the tools read (`tools/replan-tools.ts`),
 *   and the outcome is returned. The instance has no path to a trainer
 *   (`agent-safety.test.ts` walks the imports).
 * - **An answer is a proposal whole, or it is nothing** ({@link readAnswer}):
 *   exactly `{ "move", "reason" }`, read by the device's own decoder
 *   (`decodeProposal`). Free text, an unknown move, an extra field anywhere, a
 *   number off its list — each ends the run `not-a-proposal`. There is no
 *   rewrite and no partial move.
 * - **A model writes neither `revision` nor `summarySeq`**: they are copied
 *   from the job's input into the proposal, so a proposal always names what
 *   the device sent (P5).
 * - **Held to a schema on the rider's own box** (#2841): every turn sends
 *   `replanAnswerSchema` (`replan-template.ts`), the closed lists as JSON
 *   Schema, and a local server admits no other answer; a tool is called by
 *   answering `{"look":"<its name>"}` (`model.ts`). Low temperature, no
 *   reasoning. The schema is the first check, never the only one.
 * - **The device validates again** (ADR 0048 D-5). Decoding here is a
 *   courtesy that saves a round trip; nothing on the device trusts it.
 *
 * ## Budgets
 *
 * ADR 0048 D-11 leaves a re-plan's budget to this issue: *"well inside D-7's
 * ten minutes, because P2 needs an answer 30 s before a boundary"*. They are
 * {@link REPLAN_BUDGETS}: 4 model turns, 3 tool calls, 45 s and 16 000 tokens,
 * and 128 tokens an answer.
 *
 * **Measured (#2841)** on the owner's instance, gemma4:12b on Ollama 0.40.16,
 * 2026-11-19, the device's two golden requests 20 times each
 * (`tools/replan-measure.ts`; the pull request for #2841 has the figures):
 * one turn each, 2.3 s and 3.3 s at the median with the model loaded and
 * 14.6 s for the first after it was unloaded; answers of 6 to 52 tokens;
 * 2 448 tokens read for the longer request, and 3 211 for it once all three
 * tools' results were in it. So: 4 turns and 3 tool calls stay (the tools
 * are three); 45 s stays, three times the cold run and inside P5's 60; 128
 * tokens is more than twice the longest answer, and a swap's id with it; and
 * 16 000 holds the longer request reading every tool, each turn re-sending
 * the whole, where 6 000 (#1243's proposal) did not hold it reading one.
 *
 * ⚠️ **The 45 s counts from when the device asked**, not from when a worker
 * took the job: {@link ReplanOptions.waitedMilliseconds} is what the job
 * spent queued. One worker serves every athlete (`jobs.ts`), so a re-plan
 * queued behind a write-up can use up its whole budget waiting and end
 * `out-of-time` without a model being asked — which is right, because the
 * device drops an answer older than 60 s (P5).
 *
 * A spent budget is **no proposal**, never a guess. Each limit has its own
 * closed reason ({@link ReplanFailure}).
 *
 * ⚠️ **The step budget is a backstop**, as it is for a write-up: every turn
 * but the last calls at least one tool, so 3 tool calls allow 3 tool turns
 * and the answer, and a fourth tool turn is stopped by the tool-call budget.
 *
 * ⚠️ **The token budget is tightest where a server reports no usage.** The
 * system prompt, the tool specs and the plan are sent again on every turn.
 * On a server that reports what it used, the longer golden request reads all
 * three tools and answers inside it. On one that reports nothing every turn
 * is counted at the pessimistic three characters a token plus the whole of
 * its answer's bound (`replan-agent.test.ts` holds both).
 *
 * ⚠️ **A model that reasons before it answers** gets
 * {@link REPLAN_TURN_OUTPUT_TOKENS} plus whatever its rider or operator said
 * it needs (`ModelConnection.reasoningTokens`, #1268), checked against the
 * run's 16 000 before every turn. One that reasons and was not said to ends
 * `model-cut-off`: a re-plan has no turn to spare for finding out.
 */

import { decodeProposal, type Proposal } from '@onyourleft/domain';

import {
  estimatedTokens,
  messageCharacters,
  runCall,
  turnFailure,
  type AgentBudgets,
  type AgentClock,
  type AgentEvent,
  type AgentFailure,
} from './agent.ts';
import {
  CLOSED_LIST_TURN,
  type AgentMessage,
  type ModelConnection,
  type ToolResultText,
} from './model-turn.ts';
import { readReplanInput, type ReplanInput } from './replan-input.ts';
import { replanAnswerSchema, REPLAN_TEMPLATE } from './replan-template.ts';
import type { AnalysisReads } from './tools/reads.ts';
import { REPLAN_TOOLS, type ReplanToolContext } from './tools/replan-tools.ts';

/** The most model turns one re-plan may take. */
export const REPLAN_MODEL_CALLS = 4;

/** The most tool calls one re-plan may make, malformed ones included. */
export const REPLAN_TOOL_CALLS = 3;

/** How long one re-plan may take, from when the device asked: 45 s, inside P5's 60. */
export const REPLAN_RUN_MILLISECONDS = 45_000;

/** The most tokens one re-plan may spend, sent and answered (`agent.ts` §`AGENT_TOKEN_BUDGET`). */
export const REPLAN_TOKEN_BUDGET = 16_000;

/** What one turn may answer: a move and a reason are under a hundred tokens. */
export const REPLAN_TURN_OUTPUT_TOKENS = 128;

/** A re-plan's walls. */
export const REPLAN_BUDGETS: AgentBudgets = {
  modelCalls: REPLAN_MODEL_CALLS,
  toolCalls: REPLAN_TOOL_CALLS,
  milliseconds: REPLAN_RUN_MILLISECONDS,
  tokens: REPLAN_TOKEN_BUDGET,
};

/** Why a re-plan gave no proposal. Closed: no model text, address, model name or key. */
export type ReplanFailure = AgentFailure | 'not-a-proposal';

/**
 * How a re-plan ended. ⚠️ **This type is the whole of what a re-plan can
 * hand back**: a `Proposal`, or no proposal. Nothing here has a field a
 * model's sentence or a number of its own could travel in.
 */
export type ReplanOutcome =
  | { readonly kind: 'proposed'; readonly proposal: Proposal }
  /** The model answered that the workout should stay as it is. */
  | { readonly kind: 'kept' }
  | { readonly kind: 'failed'; readonly why: ReplanFailure }
  | { readonly kind: 'cancelled' };

/** The job, as the agent runs it: the athlete from the job's session, and the device-built input. */
export interface ReplanJob {
  readonly athleteId: string;
  readonly input: ReplanInput;
}

export interface ReplanOptions {
  readonly job: ReplanJob;
  readonly model: ModelConnection;
  readonly reads: AnalysisReads;
  readonly clock: AgentClock;
  /** The job's: aborting it cancels the run. */
  readonly signal: AbortSignal;
  /** Progress only: a turn, or a tool by its name. A re-plan streams no text. */
  readonly emit: (event: Extract<AgentEvent, { readonly type: 'progress' }>) => void;
  /** How long the job waited before this run, which its 45 s include. 0 when absent. */
  readonly waitedMilliseconds?: number;
  /** {@link REPLAN_BUDGETS} unless a test lowers one. */
  readonly budgets?: Partial<AgentBudgets>;
}

/** One fenced code block and nothing around it, which a small model often wraps JSON in. */
const FENCED = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/;

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactly(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/**
 * A model's answer as a proposal for `input`'s revision and summary, as
 * `'kept'` for exactly `{ "keep": true }`, or as nothing. The reply must be
 * one JSON object and no other text; the move and the reason are read by
 * `decodeProposal`, whole or not at all.
 */
export function readAnswer(text: string, input: ReplanInput): Proposal | 'kept' | undefined {
  const trimmed = text.trim();
  let answer: unknown;
  try {
    answer = JSON.parse(FENCED.exec(trimmed)?.[1] ?? trimmed) as unknown;
  } catch {
    return undefined;
  }
  if (!isObject(answer)) return undefined;
  if (hasExactly(answer, ['keep'])) return answer.keep === true ? 'kept' : undefined;
  if (!hasExactly(answer, ['move', 'reason'])) return undefined;
  return decodeProposal({
    revision: input.revision,
    summarySeq: input.summarySeq,
    move: answer.move,
    reason: answer.reason,
  });
}

/**
 * A re-plan nobody rode (#2841): three blocks, the first ridden, no goal and
 * nothing of any rider's, so the one call that warms the model sends nothing
 * of the rider who asked for it. Read as a device's request is read.
 */
const WARM_REPLAN_INPUT: ReplanInput = (() => {
  const read = readReplanInput({
    revision: 0,
    summarySeq: 0,
    currentBlock: 0,
    goals: {},
    blocks: [
      { kind: 'steady', seconds: 600, target: 0.6 },
      { kind: 'steady', seconds: 600, target: 0.65 },
      { kind: 'steady', seconds: 300, target: 0.5 },
    ],
    summaries: [{ block: 0, seconds: 600, meanPowerShare: 0.6, rescues: 0 }],
  });
  if (!read.ok) throw new Error('the warm-up re-plan is not one this instance reads');
  return read.value;
})();

/** How long the warm-up may take: a cold load of the model and one short answer. */
export const REPLAN_WARM_MILLISECONDS = 60_000;

/**
 * Load the model a re-plan will ask, before the ride's first re-plan does
 * (#2841): ONE turn shaped as a re-plan's first — the same system prompt, the
 * same answer schema and settings — over {@link WARM_REPLAN_INPUT}, its
 * answer read by nothing. A model that has to be loaded first takes most of
 * a re-plan's 45 s doing it. No tool is run, nothing is kept, and the
 * request is whole: a warm-up the model answers or not is the same warm-up.
 */
export async function warmReplanModel(model: ModelConnection, signal: AbortSignal): Promise<void> {
  await model.turn({
    system: REPLAN_TEMPLATE.system,
    messages: [{ role: 'user', text: REPLAN_TEMPLATE.firstMessage(WARM_REPLAN_INPUT) }],
    tools: REPLAN_TOOLS.map((tool) => tool.spec),
    maxOutputTokens: REPLAN_TURN_OUTPUT_TOKENS,
    ...CLOSED_LIST_TURN,
    answerSchema: replanAnswerSchema(WARM_REPLAN_INPUT),
    timeoutMilliseconds: REPLAN_WARM_MILLISECONDS,
    signal,
  });
}

/**
 * Run the re-plan agent over one job. Every way it can end is a
 * {@link ReplanOutcome}; it never throws for a model's doing. ⚠️ It rejects
 * for the instance's doing — a tool's read that rejects — exactly as
 * `runAnalysisAgent` does, and the job engine ends that job `engine-error`.
 */
export async function runReplanAgent(options: ReplanOptions): Promise<ReplanOutcome> {
  const { job, model, reads, clock, signal, emit } = options;
  const budgets: AgentBudgets = { ...REPLAN_BUDGETS, ...options.budgets };
  const tools = new Map(REPLAN_TOOLS.map((tool) => [tool.spec.name, tool] as const));
  const specs = REPLAN_TOOLS.map((tool) => tool.spec);
  const context: ReplanToolContext = { athleteId: job.athleteId, input: job.input, reads };
  const called = new Map<string, number>();
  const started = clock.now() - (options.waitedMilliseconds ?? 0);
  const messages: AgentMessage[] = [
    { role: 'user', text: REPLAN_TEMPLATE.firstMessage(job.input) },
  ];
  const fixedCharacters = REPLAN_TEMPLATE.system.length + JSON.stringify(specs).length;
  const allowance = REPLAN_TURN_OUTPUT_TOKENS + (model.reasoningTokens ?? 0);
  const answerSchema = replanAnswerSchema(job.input);

  let modelCalls = 0;
  let toolCalls = 0;
  let tokens = 0;

  const failed = (why: ReplanFailure): ReplanOutcome => ({ kind: 'failed', why });

  for (;;) {
    if (signal.aborted) return { kind: 'cancelled' };
    const left = budgets.milliseconds - (clock.now() - started);
    if (left <= 0) return failed('out-of-time');
    if (modelCalls >= budgets.modelCalls) return failed('out-of-steps');
    const sent = estimatedTokens(
      fixedCharacters + messages.reduce((sum, message) => sum + messageCharacters(message), 0),
    );
    if (tokens + sent + allowance > budgets.tokens) return failed('out-of-tokens');

    modelCalls += 1;
    emit({ type: 'progress', step: modelCalls });
    const turn = await model.turn({
      system: REPLAN_TEMPLATE.system,
      messages: [...messages],
      tools: specs,
      maxOutputTokens: allowance,
      // Sampled low, and with no reasoning first on a model on the rider's own
      // box (#2841): measured, gemma4:12b reasoning spent all 256 tokens (the bound then) and
      // answered nothing on 40 of 40 runs of the device's two golden requests.
      ...CLOSED_LIST_TURN,
      // Held to the closed lists by a local server (#2841); read again below either way.
      answerSchema,
      timeoutMilliseconds: left,
      signal,
    });
    if (!turn.ok) {
      const why = turnFailure(turn.failure);
      return why === 'cancelled' || signal.aborted ? { kind: 'cancelled' } : failed(why);
    }
    if (signal.aborted) return { kind: 'cancelled' };
    tokens += (turn.usage.inputTokens ?? sent) + (turn.usage.outputTokens ?? allowance);

    // A turn that called tools: run each, in order, inside the budgets. Any
    // text beside the calls is read by nothing, so it is not kept.
    if (turn.calls.length > 0) {
      messages.push({ role: 'assistant', text: '', calls: turn.calls });
      const results: ToolResultText[] = [];
      for (const call of turn.calls) {
        if (signal.aborted) return { kind: 'cancelled' };
        if (clock.now() - started >= budgets.milliseconds) return failed('out-of-time');
        if (toolCalls >= budgets.toolCalls) return failed('out-of-tool-calls');
        toolCalls += 1;
        const { text, known } = await runCall(call, tools, context, called);
        emit(
          known === undefined
            ? { type: 'progress', step: modelCalls }
            : { type: 'progress', step: modelCalls, tool: known.spec.name },
        );
        results.push({ callId: call.callId, toolName: call.toolName, text });
      }
      messages.push({ role: 'tool', results });
      continue;
    }

    if (turn.finish === 'length') return failed('model-cut-off');
    const answer = readAnswer(turn.text, job.input);
    if (answer === undefined) return failed('not-a-proposal');
    return answer === 'kept' ? { kind: 'kept' } : { kind: 'proposed', proposal: answer };
  }
}
