// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The analysis agent on the instance** — #1098, ADR 0046 D-7, D-11.
 *
 * A tool-calling loop in which **the model chooses its own tools**, inside
 * walls it cannot move:
 *
 * - **The tools** are `tools/tools.ts`' four, read-only and scoped to the
 *   job's athlete, offered on either source: what a hosted model is sent is
 *   masked by the connection it is handed (`hosted.ts`, #1101). A call to any other name — a `set_resistance`, say — is a
 *   tool error the model is shown; nothing a reply says adds a tool, widens a
 *   bound, moves the model's address or reaches a network path (the set is a
 *   constant, and `agent-safety.test.ts` walks the imports).
 * - **The budgets** ({@link AGENT_MODEL_CALLS}, {@link AGENT_TOOL_CALLS},
 *   {@link AGENT_RUN_MILLISECONDS}, {@link AGENT_TOKEN_BUDGET}): ADR 0046 D-7's
 *   figures, which the owner ruled stand until measurements replace them
 *   (Q4). Each limit ends the run `failed`, with its own closed reason, and
 *   keeps nothing.
 * - **The screen** (`@onyourleft/analysis` §`screenWriteUp`, ADR 0035 D-4's one
 *   set of matchers) runs before a word is streamed or kept, with ONE rewrite.
 *   A second failure ends the run `withheld`, keeping nothing.
 * - **Streaming without unscreened text** (#1092 comment ruling 3): a reply is
 *   cut into its sections (paragraphs), each screened ALONE and streamed as a
 *   `section` event only once it passes; then the whole is screened (a rule
 *   such as the body moving across the bicycle can span two). If a later
 *   section, or the whole, fails, a `withdrawn` event retracts every section
 *   already streamed. No event ever carries text that failed the screen.
 * - **A model that cannot take tools** (#1092 comment ruling 4, *"say so and
 *   stop. There is no fixed-chain fallback"*) fails `model-without-tools`.
 * - **Cancel**: the job's signal is checked before every model turn and every
 *   tool call, and is the turn's abort signal, so a cancel lands within one
 *   step and closes the socket of a turn in flight.
 *
 * It names no SDK and no socket: the model is a `ModelConnection`
 * (`model-turn.ts`), time is a clock, and the tools read through
 * `AnalysisReads`. Nothing here saves anything: the outcome is returned, and
 * the job engine (#1095) keeps a `written` write-up and nothing else.
 */

import {
  ANALYSIS_AGENT_TEMPLATE_V1,
  fenceData,
  passedScreen,
  RUN_BUDGET_MILLISECONDS,
  screenWriteUp,
  type AgentTemplate,
  type RideAnalysisInput,
  type ScreenedWriteUp,
  type ScreenReason,
  type UntrustedText,
} from '@onyourleft/analysis';

import type {
  AgentMessage,
  ModelConnection,
  ModelFailure,
  ToolCallRequest,
  ToolResultText,
} from './model-turn.ts';
import type { AnalysisHistory, AnalysisReads } from './tools/reads.ts';
import { AGENT_TOOLS, type AnyAgentTool, type ToolContext } from './tools/tools.ts';

/** The most model turns one run may take (ADR 0046 D-7). */
export const AGENT_MODEL_CALLS = 24;

/** The most tool calls one run may make, malformed ones included (ADR 0046 D-7). */
export const AGENT_TOOL_CALLS = 16;

/** How long one run may take: the runner's ten minutes (ADR 0046 D-7). */
export const AGENT_RUN_MILLISECONDS = RUN_BUDGET_MILLISECONDS;

/**
 * The most tokens one run may spend (ADR 0046 D-7's 40 000, *"four times the
 * runner's budget, for tool results and history"*). ⚠️ **Read as what is SENT
 * as well as what is answered**, where the chain's `RUN_TOKEN_BUDGET` counts
 * only the `max_tokens` it asks for: every turn of a tool-calling run re-sends
 * the whole conversation, tool results included, and that — not the answers —
 * is what grows. So before a turn the run checks that what it has spent, the
 * pessimistic estimate of what it is about to send ({@link estimatedTokens})
 * and every token the turn may answer fit; after it, the turn is counted at
 * what the server reports (input and output), or, where it reports nothing,
 * at the estimate and the whole of `max_tokens`.
 */
export const AGENT_TOKEN_BUDGET = 40_000;

/** What one turn may answer: the chain's summary bound. */
export const AGENT_TURN_OUTPUT_TOKENS = 1_024;

/** The longest one turn may take, inside what is left of the run. */
export const AGENT_TURN_MILLISECONDS = 120_000;

/** How many times a write-up the screen withheld is sent back (ADR 0035 D-4). */
export const AGENT_REWRITES = 1;

/** Why a run kept nothing. Closed: no model text, address, model name or key. */
export type AgentFailure =
  | 'out-of-steps'
  | 'out-of-tool-calls'
  | 'out-of-time'
  | 'out-of-tokens'
  | 'model-without-tools'
  | 'model-not-local'
  | 'model-unreachable'
  | 'model-refused'
  | 'model-error'
  | 'model-cut-off'
  | 'model-malformed';

/**
 * What a rider is told for each {@link AgentFailure} (#1102 shows it). Each
 * says nothing was kept, and none carries anything the model or its server
 * wrote.
 */
export const AGENT_FAILURE_TEXT: Readonly<Record<AgentFailure, string>> = {
  'out-of-steps':
    'The model took more steps than this app allows, so the write-up was stopped and nothing was kept.',
  'out-of-tool-calls':
    'The model asked for the rider’s records more times than this app allows, so the write-up was stopped and nothing was kept.',
  'out-of-time':
    'The model took too long, so the write-up was stopped and nothing was kept. A smaller or faster model may finish in time.',
  'out-of-tokens':
    'The write-up would have sent the model more text than this app allows, so it was stopped and nothing was kept.',
  'model-without-tools':
    'The model on your instance cannot use tools, which this write-up needs, so nothing was written. Choose a model that supports tool calling.',
  'model-not-local':
    'The instance’s model address did not lead to this machine or its private network, so nothing was sent and nothing was kept.',
  'model-unreachable':
    'The instance could not reach its model, so nothing was kept. Check that the model server is running, then try again.',
  'model-refused': 'The model server refused the request, so nothing was kept.',
  'model-error': 'The model server had an error, so nothing was kept. Try again later.',
  'model-cut-off':
    'The model’s answer was cut off before it finished, so nothing was kept. A model with a larger context may do better.',
  'model-malformed': 'The model server sent an answer this app cannot read, so nothing was kept.',
};

/** What the job engine is told as the run goes. Never a raw token. */
export type AgentEvent =
  /** A model turn, or a tool call by its name — and nothing else of it. */
  | { readonly type: 'progress'; readonly step: number; readonly tool?: string }
  /** A section that passed the screen, 1-based in the write-up's order. */
  | { readonly type: 'section'; readonly index: number; readonly text: ScreenedWriteUp }
  /** Every `section` streamed so far is retracted. */
  | { readonly type: 'withdrawn' };

/** How a run ended. Only `written` carries text, and only screened text. */
export type AgentOutcome =
  | {
      readonly kind: 'written';
      readonly writeUp: ScreenedWriteUp;
      readonly sections: readonly ScreenedWriteUp[];
      readonly template: { readonly id: string; readonly version: string };
    }
  | { readonly kind: 'withheld'; readonly reasons: readonly ScreenReason[] }
  | { readonly kind: 'failed'; readonly why: AgentFailure }
  | { readonly kind: 'cancelled' };

/** The job, as the agent runs it: the athlete from the job's session, and the device-built input. */
export interface AgentJob {
  readonly athleteId: string;
  readonly input: RideAnalysisInput;
  /** The synced activity id of the asked-about ride, when the job names one (#1099). */
  readonly rideId?: string;
}

/** Milliseconds on a clock that only moves forward. */
export interface AgentClock {
  now(): number;
}

export interface AgentOptions {
  readonly job: AgentJob;
  readonly model: ModelConnection;
  readonly reads: AnalysisReads;
  /** The history index (#1099), or `undefined` when the instance has none. */
  readonly history?: AnalysisHistory | undefined;
  readonly clock: AgentClock;
  /** The job's: aborting it cancels the run. */
  readonly signal: AbortSignal;
  readonly emit: (event: AgentEvent) => void;
  /** {@link ANALYSIS_AGENT_TEMPLATE_V1} unless a test says otherwise. */
  readonly template?: AgentTemplate;
  /**
   * ADR 0046 D-7's figures ({@link AGENT_BUDGETS}) unless a test lowers one —
   * which is how the step budget is shown to fire: with the shipped figures
   * the tool-call budget binds first (see {@link AGENT_BUDGETS}).
   */
  readonly budgets?: Partial<AgentBudgets>;
}

/** A run's walls. */
export interface AgentBudgets {
  readonly modelCalls: number;
  readonly toolCalls: number;
  readonly milliseconds: number;
  readonly tokens: number;
}

/**
 * The shipped budgets. ⚠️ **The step budget is a backstop under these
 * figures**: every turn but the last calls at least one tool, so 16 tool calls
 * allow at most 16 tool turns, the write-up and its one rewrite — 18 turns,
 * inside 24. It binds only if a later issue adds a turn that calls no tool.
 */
export const AGENT_BUDGETS: AgentBudgets = {
  modelCalls: AGENT_MODEL_CALLS,
  toolCalls: AGENT_TOOL_CALLS,
  milliseconds: AGENT_RUN_MILLISECONDS,
  tokens: AGENT_TOKEN_BUDGET,
};

/** A pessimistic count: three characters a token, as the chain's bounds are set (template-v2). */
export function estimatedTokens(characters: number): number {
  return Math.ceil(characters / 3);
}

function messageCharacters(message: AgentMessage): number {
  switch (message.role) {
    case 'user':
      return message.text.length;
    case 'assistant':
      return (
        message.text.length +
        message.calls.reduce(
          (sum, call) =>
            sum +
            call.toolName.length +
            (call.invalid === true ? 0 : JSON.stringify(call.input ?? null).length),
          0,
        )
      );
    case 'tool':
      return message.results.reduce((sum, result) => sum + result.text.length, 0);
  }
}

/** Which failure a turn that gave no reply is. */
function turnFailure(failure: ModelFailure): AgentFailure | 'cancelled' {
  switch (failure) {
    case 'aborted':
      return 'cancelled';
    case 'timed-out':
      return 'out-of-time';
    case 'model-without-tools':
      return 'model-without-tools';
    case 'not-local':
      return 'model-not-local';
    case 'unresolved':
    case 'unreachable':
      return 'model-unreachable';
    case 'refused':
      return 'model-refused';
    case 'server-error':
      return 'model-error';
    case 'malformed':
      return 'model-malformed';
  }
}

/** A reply's sections: its paragraphs, in order. */
function sectionsOf(text: string): readonly string[] {
  return text
    .split(/\r?\n[ \t]*\r?\n/)
    .map((section) => section.trim())
    .filter((section) => section !== '');
}

/** The result a tool call gets: its fenced data, or an error the model is shown. */
async function runCall(
  call: ToolCallRequest,
  tools: ReadonlyMap<string, AnyAgentTool>,
  context: ToolContext,
  called: Map<string, number>,
): Promise<{ readonly text: string; readonly known: AnyAgentTool | undefined }> {
  const known = tools.get(call.toolName);
  const names = [...tools.keys()].join(', ');
  if (known === undefined) {
    return { text: `Error: there is no such tool. The tools are ${names}.`, known: undefined };
  }
  const times = (called.get(known.spec.name) ?? 0) + 1;
  called.set(known.spec.name, times);
  if (known.maximumCalls !== undefined && times > known.maximumCalls) {
    return {
      text: `Error: ${known.spec.name} may be called at most ${String(known.maximumCalls)} times in one write-up.`,
      known,
    };
  }
  if (call.invalid === true) {
    return { text: 'Error: the arguments were not one JSON object.', known };
  }
  const checked = known.validate(call.input ?? {});
  if (!checked.ok) return { text: `Error: ${checked.error}`, known };
  return { text: fenceData(await known.run(context, checked.args)), known };
}

/** Run the agent over one job. Every way it can end is an {@link AgentOutcome}; it never throws for a model's doing. */
export async function runAnalysisAgent(options: AgentOptions): Promise<AgentOutcome> {
  const { job, model, reads, history, clock, signal, emit } = options;
  const template = options.template ?? ANALYSIS_AGENT_TEMPLATE_V1;
  const budgets: AgentBudgets = { ...AGENT_BUDGETS, ...options.budgets };
  const tools = new Map(AGENT_TOOLS.map((tool) => [tool.spec.name, tool] as const));
  const specs = AGENT_TOOLS.map((tool) => tool.spec);
  const context: ToolContext = {
    athleteId: job.athleteId,
    input: job.input,
    reads,
    history,
    rideId: job.rideId,
  };
  const called = new Map<string, number>();
  const started = clock.now();
  const messages: AgentMessage[] = [{ role: 'user', text: template.firstMessage(job.input) }];
  const fixedCharacters = template.system.length + JSON.stringify(specs).length;

  let modelCalls = 0;
  let toolCalls = 0;
  let tokens = 0;
  let rewritesLeft = AGENT_REWRITES;

  const failed = (why: AgentFailure): AgentOutcome => ({ kind: 'failed', why });

  for (;;) {
    if (signal.aborted) return { kind: 'cancelled' };
    const left = budgets.milliseconds - (clock.now() - started);
    if (left <= 0) return failed('out-of-time');
    if (modelCalls >= budgets.modelCalls) return failed('out-of-steps');
    const sent = estimatedTokens(
      fixedCharacters + messages.reduce((sum, message) => sum + messageCharacters(message), 0),
    );
    if (tokens + sent + AGENT_TURN_OUTPUT_TOKENS > budgets.tokens) return failed('out-of-tokens');

    modelCalls += 1;
    emit({ type: 'progress', step: modelCalls });
    const turn = await model.turn({
      system: template.system,
      messages: [...messages],
      tools: specs,
      maxOutputTokens: AGENT_TURN_OUTPUT_TOKENS,
      timeoutMilliseconds: Math.min(AGENT_TURN_MILLISECONDS, left),
      signal,
    });
    if (!turn.ok) {
      const why = turnFailure(turn.failure);
      return why === 'cancelled' || signal.aborted ? { kind: 'cancelled' } : failed(why);
    }
    if (signal.aborted) return { kind: 'cancelled' };
    // What the turn cost, as the server reports it; where it reports nothing,
    // the estimate of what was sent and every token the turn could answer.
    tokens +=
      (turn.usage.inputTokens ?? sent) + (turn.usage.outputTokens ?? AGENT_TURN_OUTPUT_TOKENS);

    // A turn that called tools: run each, in order, inside the budgets. Any
    // text beside the calls is neither screened nor shown, so it is not kept.
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

    // The write-up: each section screened alone and streamed once it passes,
    // then the whole; any failure withdraws what was streamed.
    const streamed: ScreenedWriteUp[] = [];
    let reasons: readonly ScreenReason[] = [];
    const sections = sectionsOf(turn.text);
    for (const section of sections) {
      const screened = screenWriteUp(section as UntrustedText);
      if (!passedScreen(screened)) {
        reasons = screened.withheld;
        break;
      }
      streamed.push(screened);
      emit({ type: 'section', index: streamed.length, text: screened });
    }
    if (sections.length === 0) reasons = ['empty'];
    if (reasons.length === 0) {
      const whole = screenWriteUp(sections.join('\n\n') as UntrustedText);
      if (passedScreen(whole)) {
        return {
          kind: 'written',
          writeUp: whole,
          sections: streamed,
          template: { id: template.id, version: template.version },
        };
      }
      reasons = whole.withheld;
    }
    if (streamed.length > 0) emit({ type: 'withdrawn' });
    if (rewritesLeft === 0) return { kind: 'withheld', reasons };
    rewritesLeft -= 1;
    messages.push({ role: 'assistant', text: turn.text, calls: [] });
    messages.push({ role: 'user', text: template.rewrite(reasons) });
  }
}
