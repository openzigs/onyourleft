// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The one module that names the AI SDK** — #1096, ADR 0046 D-8.
 *
 * `ai` and `@ai-sdk/openai-compatible` are imported HERE and nowhere else in
 * the repository (`eslint.config.js` §`AI_SDK_IMPORT_PATTERNS`; its own test is
 * the one other file allowed, because the guard below can only be tested by
 * calling the SDK). It implements `model-turn.ts`'s {@link ModelConnection}
 * for an OpenAI-compatible server on the box — Ollama — at a local address,
 * and (#1097, {@link createHostedModel}) for the hosted service the instance
 * holds a key for, at an `https:` address and no other host.
 *
 * ## What every turn does, and why
 *
 * - **The gateway is unreachable** (#1092 comment ruling 2). A bare string
 *   model id resolves through the SDK's global default provider, which is the
 *   Vercel AI Gateway, a vendor default ADR 0031 D-4 forbids. So at this
 *   module's load the global default is set to {@link GATEWAY_REFUSED}, a
 *   provider that THROWS, and every call here passes a provider instance.
 *   `model.test.ts` calls the SDK with a string id and requires the throw with
 *   no request made.
 * - **The address is checked on every turn** (ADR 0040 D-6, built for the
 *   embedder in `history/address.ts`, reused, not copied): the configured name
 *   is resolved, every address must be local, and the request goes to the
 *   checked address — never the name, which a second lookup could send
 *   elsewhere. `redirect: 'error'`, so an answer cannot move it either.
 * - **One host.** The fetch handed to the provider refuses any URL that is not
 *   under the configured base URL, so nothing — telemetry, a gateway, a
 *   retry somewhere else — can leave for another host through it. Telemetry
 *   is never enabled, and warnings are not logged (`AI_SDK_LOG_WARNINGS`).
 * - **No retries** (`maxRetries: 0`): a failed turn is the agent's to count.
 * - **Errors are a closed enumeration** ({@link ModelFailure}). The server's
 *   error text never leaves this file: an `APICallError` is read for its
 *   status, and — for the one 400 that names a cause the agent acts on, "does
 *   not support tools" — matched, and then dropped.
 * - **The job's signal reaches the wire**: it is the request's abort signal,
 *   so a cancelled job closes the socket.
 * - **Tools are described, never executed by the SDK**: no tool has an
 *   `execute`, so one turn returns the calls the model made and the agent
 *   (`agent.ts`) validates and runs them, counting each against its budgets.
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { APICallError, generateText, jsonSchema, tool, type ModelMessage, type ToolSet } from 'ai';

import { localAddressesOnly, type Resolver } from '../history/address.ts';
import type {
  AgentMessage,
  ModelConnection,
  ModelFailure,
  ModelTurn,
  ModelTurnRequest,
  ToolCallRequest,
  TurnFinish,
} from './model-turn.ts';

/** Thrown by the guard: a string model id reached the SDK's default provider. */
export class GatewayRefusedError extends Error {
  constructor() {
    super('A model was named by a string id; this instance never uses a default provider.');
    this.name = 'GatewayRefusedError';
  }
}

const refuse = (): never => {
  throw new GatewayRefusedError();
};

/**
 * The global default provider, set at load: every model kind throws. No
 * request is ever made through it.
 */
export const GATEWAY_REFUSED = {
  specificationVersion: 'v4',
  languageModel: refuse,
  embeddingModel: refuse,
  imageModel: refuse,
  transcriptionModel: refuse,
  speechModel: refuse,
  rerankingModel: refuse,
  videoModel: refuse,
} as unknown as NonNullable<typeof globalThis.AI_SDK_DEFAULT_PROVIDER>;

globalThis.AI_SDK_DEFAULT_PROVIDER = GATEWAY_REFUSED;
// A warning can quote a request; this instance logs only through `log.ts`.
globalThis.AI_SDK_LOG_WARNINGS = false;

/** What the agent's model is, and where. Built by `config.ts` §`readAnalysisModelSettings`. */
export interface AnalysisModelSettings {
  /** The OpenAI-compatible base URL: `http://ollama:11434/v1`. */
  readonly baseUrl: URL;
  readonly model: string;
}

export interface LocalModelOptions {
  readonly settings: AnalysisModelSettings;
  readonly resolve: Resolver;
  /** The platform's `fetch` unless a test hands its own. */
  readonly fetch?: typeof globalThis.fetch;
}

/** The base URL with its host replaced by a checked address. */
function atAddress(base: URL, address: string): string {
  const pinned = new URL(base.href);
  pinned.hostname = address.includes(':') ? `[${address}]` : address;
  return pinned.href.replace(/\/+$/, '');
}

/** The request's URL as text, whatever the SDK handed `fetch`. */
function urlOf(input: Parameters<typeof globalThis.fetch>[0]): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

/** The agent's conversation as the SDK's messages. */
function sdkMessages(messages: readonly AgentMessage[]): ModelMessage[] {
  return messages.map((message): ModelMessage => {
    switch (message.role) {
      case 'user':
        return { role: 'user', content: message.text };
      case 'assistant':
        return {
          role: 'assistant',
          content: [
            ...(message.text === '' ? [] : [{ type: 'text' as const, text: message.text }]),
            ...message.calls.map((call) => ({
              type: 'tool-call' as const,
              toolCallId: call.callId,
              toolName: call.toolName,
              input: call.invalid === true ? {} : call.input,
            })),
          ],
        };
      case 'tool':
        return {
          role: 'tool',
          content: message.results.map((result) => ({
            type: 'tool-result' as const,
            toolCallId: result.callId,
            toolName: result.toolName,
            output: { type: 'text' as const, value: result.text },
          })),
        };
    }
  });
}

function finishOf(reason: string): TurnFinish {
  return reason === 'stop' || reason === 'tool-calls' || reason === 'length' ? reason : 'other';
}

/** The 400 Ollama answers for a model with no tool support, matched and dropped. */
const WITHOUT_TOOLS = /does not support tools/i;

/** Names of the SDK's errors for a reply it could not read. */
const UNREADABLE = new Set([
  'AI_JSONParseError',
  'AI_TypeValidationError',
  'AI_InvalidResponseDataError',
  'AI_NoContentGeneratedError',
  'AI_EmptyResponseBodyError',
]);

/** Which closed failure an error from the SDK is. Never reads its message into the result. */
export function failureOf(error: unknown, timedOut: boolean, aborted: boolean): ModelFailure {
  if (aborted) return 'aborted';
  if (timedOut) return 'timed-out';
  if (APICallError.isInstance(error)) {
    const status = error.statusCode;
    if (status === undefined) return 'unreachable';
    // An answer the SDK could not read as a completion.
    if (status < 300) return 'malformed';
    if (status === 400 && WITHOUT_TOOLS.test(error.responseBody ?? '')) {
      return 'model-without-tools';
    }
    if (status >= 500) return 'server-error';
    return 'refused';
  }
  const name = (error as { name?: unknown } | null)?.name;
  if (typeof name === 'string' && UNREADABLE.has(name)) return 'malformed';
  return 'unreachable';
}

/** A fetch that sends only under `base`, and never follows a redirect. */
function pinnedTo(base: string, send: typeof globalThis.fetch): typeof globalThis.fetch {
  return (input, init) => {
    const url = urlOf(input);
    if (url !== base && !url.startsWith(`${base}/`)) {
      return Promise.reject(new TypeError('A request left for a host it was not given.'));
    }
    return send(url, { ...init, redirect: 'error' });
  };
}

/** A model on the rider's own box, one turn at a time. @see the file comment. */
export function createLocalModel(options: LocalModelOptions): ModelConnection {
  const { settings, resolve } = options;
  const send = options.fetch ?? globalThis.fetch.bind(globalThis);
  return {
    async turn(request: ModelTurnRequest): Promise<ModelTurn> {
      if (request.signal.aborted) return { ok: false, failure: 'aborted' };
      const checked = await localAddressesOnly(settings.baseUrl.hostname, resolve);
      if (!checked.ok) return { ok: false, failure: checked.why };
      const base = atAddress(settings.baseUrl, checked.address);
      const provider = createOpenAICompatible({
        name: 'local',
        baseURL: base,
        fetch: pinnedTo(base, send),
      });
      return oneTurn(provider, settings.model, request);
    },
  };
}

/** The hosted service the instance holds a key for (#1097): `analysis/hosted-key.ts`. */
export interface HostedModelOptions {
  /** The service's OpenAI-compatible base URL. **`https:` only**: anything else throws. */
  readonly baseUrl: URL;
  readonly model: string;
  /** The opened key. Sent as a bearer token to `baseUrl` and nowhere else. */
  readonly apiKey: string;
  /** The platform's `fetch` unless a test hands its own. */
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * A hosted model on the rider's own key (#1097, ADR 0046's ruling 3): the
 * second OpenAI-compatible endpoint, with the same guard, the same one-host
 * fetch, no retries and the same closed failures as the local one. It is NOT
 * held to the local-address rule — it is hosted by definition — so what
 * bounds it instead is that `baseUrl` is `https:` and is the only host it can
 * reach.
 *
 * ⚠️ **No production caller yet, on purpose.** A hosted request must be
 * masked first (#1101), so this is constructed only behind that seam
 * (`source.ts` §`modelForSource`); until #1101 lands a job asking for the
 * hosted source fails `hosted_unavailable` and sends nothing.
 */
export function createHostedModel(options: HostedModelOptions): ModelConnection {
  if (options.baseUrl.protocol !== 'https:') {
    throw new TypeError('A hosted model is reached over https: only.');
  }
  const send = options.fetch ?? globalThis.fetch.bind(globalThis);
  const base = options.baseUrl.href.replace(/\/+$/, '');
  const provider = createOpenAICompatible({
    name: 'hosted',
    baseURL: base,
    apiKey: options.apiKey,
    fetch: pinnedTo(base, send),
  });
  return {
    async turn(request: ModelTurnRequest): Promise<ModelTurn> {
      if (request.signal.aborted) return { ok: false, failure: 'aborted' };
      return oneTurn(provider, options.model, request);
    },
  };
}

/** One model step through `provider`, with every rule the file comment states. */
async function oneTurn(
  provider: ReturnType<typeof createOpenAICompatible>,
  model: string,
  request: ModelTurnRequest,
): Promise<ModelTurn> {
  const tools: ToolSet = Object.fromEntries(
    request.tools.map((spec) => [
      spec.name,
      tool({
        description: spec.description,
        inputSchema: jsonSchema(spec.parameters as Parameters<typeof jsonSchema>[0]),
      }),
    ]),
  );
  const timeout = AbortSignal.timeout(Math.max(1, request.timeoutMilliseconds));
  try {
    const result = await generateText({
      model: provider.chatModel(model),
      system: request.system,
      messages: sdkMessages(request.messages),
      ...(request.tools.length === 0 ? {} : { tools }),
      maxOutputTokens: request.maxOutputTokens,
      maxRetries: 0,
      abortSignal: AbortSignal.any([request.signal, timeout]),
    });
    const calls: ToolCallRequest[] = result.toolCalls.map((call) =>
      call.dynamic === true && call.invalid === true
        ? { callId: call.toolCallId, toolName: call.toolName, invalid: true }
        : {
            callId: call.toolCallId,
            toolName: call.toolName,
            // Untrusted and unvalidated: the agent checks it against the tool's schema.
            input: call.input as unknown,
          },
    );
    return {
      ok: true,
      text: result.text,
      calls,
      finish: finishOf(result.finishReason),
      usage: {
        ...(result.usage.inputTokens === undefined
          ? {}
          : { inputTokens: result.usage.inputTokens }),
        ...(result.usage.outputTokens === undefined
          ? {}
          : { outputTokens: result.usage.outputTokens }),
      },
    };
  } catch (error) {
    return {
      ok: false,
      failure: failureOf(error, timeout.aborted, request.signal.aborted),
    };
  }
}
