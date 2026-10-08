// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **One turn of a model, as the analysis agent sees it** — the port between
 * the agent (`agent.ts`) and the one module that names the AI SDK
 * (`model.ts`), ADR 0046 D-8.
 *
 * The agent is written against this and a clock, never against the SDK, so
 * ADR 0037 D-2's Durable Object adapter is not foreclosed and every test of
 * the loop can script a model without a socket. One call is ONE model step:
 * the agent runs its own loop, so it — not the SDK — counts every step, tool
 * call and token against the budgets, and validates every tool call itself.
 *
 * ⚠️ **A failure is a closed enumeration** ({@link ModelFailure}). The model
 * server's own error text — which can say anything, and can echo what it was
 * sent — never crosses this port: not into a log line, a job event or a
 * response.
 */

/** A tool the model may call, as it is described to the model. */
export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  /** A JSON Schema object for the tool's arguments. */
  readonly parameters: Readonly<Record<string, unknown>>;
}

/** A tool call the model made. `input` is untrusted and unvalidated. */
export type ToolCallRequest =
  | {
      readonly callId: string;
      readonly toolName: string;
      readonly input: unknown;
      readonly invalid?: false;
    }
  /** Arguments that did not parse, or a tool the SDK could not match. */
  | { readonly callId: string; readonly toolName: string; readonly invalid: true };

/** What a tool answered, as the model is shown it. */
export interface ToolResultText {
  readonly callId: string;
  readonly toolName: string;
  readonly text: string;
}

/** One message of the conversation the agent keeps. */
export type AgentMessage =
  | { readonly role: 'user'; readonly text: string }
  | {
      readonly role: 'assistant';
      readonly text: string;
      readonly calls: readonly ToolCallRequest[];
    }
  | { readonly role: 'tool'; readonly results: readonly ToolResultText[] };

/** What one turn is asked. */
export interface ModelTurnRequest {
  readonly system: string;
  readonly messages: readonly AgentMessage[];
  readonly tools: readonly ToolSpec[];
  readonly maxOutputTokens: number;
  /** How long this turn may take before it is given up as `timed-out`. */
  readonly timeoutMilliseconds: number;
  /** The job's signal: an abort here aborts the request on the wire. */
  readonly signal: AbortSignal;
}

/** Why a turn gave no reply. Closed: nothing else ever crosses the port. */
export type ModelFailure =
  /** The configured name resolved outside the local ranges (ADR 0040 D-6). */
  | 'not-local'
  /** The configured name resolved to nothing. */
  | 'unresolved'
  /** No answer: refused, reset, or the connection failed. */
  | 'unreachable'
  /** The turn took longer than it was given. */
  | 'timed-out'
  /** The job's signal aborted the turn. */
  | 'aborted'
  /** The server said this model cannot take tools (#1092 Q5: say so and stop). */
  | 'model-without-tools'
  /** Any other 4xx. */
  | 'refused'
  /** Any 5xx. */
  | 'server-error'
  /** A reply that is not a chat completion this agent can read. */
  | 'malformed';

/** Why a reply ended. `length` is a reply cut off by its token bound. */
export type TurnFinish = 'stop' | 'tool-calls' | 'length' | 'other';

export type ModelTurn =
  | {
      readonly ok: true;
      readonly text: string;
      readonly calls: readonly ToolCallRequest[];
      readonly finish: TurnFinish;
      /** What the server reported, when it did. */
      readonly usage: { readonly inputTokens?: number; readonly outputTokens?: number };
    }
  | { readonly ok: false; readonly failure: ModelFailure };

/** A model, one turn at a time. */
export interface ModelConnection {
  turn(request: ModelTurnRequest): Promise<ModelTurn>;
}
