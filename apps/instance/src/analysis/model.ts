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
 *
 * ## A picture — #1106
 *
 * {@link createLocalPictureModel} and {@link createHostedPictureModel} show a
 * model ONE side-camera picture and a question fixed when the connection is
 * built (`camera/picture-model.ts`), through the same provider, the same
 * one-host fetch, no retries and no tools. The picture is in the one user
 * message and nowhere else, and nothing here keeps it: it is the argument of
 * one call. A server that says it takes no picture is `model-without-pictures`
 * ({@link pictureFailureOf}); its text is matched and dropped.
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { APICallError, generateText, jsonSchema, tool, type ModelMessage, type ToolSet } from 'ai';

import type {
  PictureConnection,
  PictureFailure,
  PictureLook,
  PictureLookRequest,
  PictureQuestion,
} from '../camera/picture-model.ts';
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
  /** What the operator says a turn may spend reasoning (#1268), when they did. */
  readonly reasoningTokens?: number;
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

/**
 * A 4xx body that says the model, or the service, takes no picture. Read on
 * 2026-10-12: a hosted service that takes no picture refuses the `image_url`
 * part by name, and a server whose model has no vision says "image" or
 * "vision" in its refusal. Matched and dropped, as {@link WITHOUT_TOOLS} is.
 */
const WITHOUT_PICTURES = /image|vision|multi-?modal/i;

/** The statuses a server refuses a request's SHAPE with: the three a picture it cannot take gets. */
const SHAPE_REFUSALS: ReadonlySet<number> = new Set([400, 415, 422]);

/** Which closed failure an error from a look is. Never reads its message into the result. */
export function pictureFailureOf(
  error: unknown,
  timedOut: boolean,
  aborted: boolean,
): PictureFailure {
  if (
    !aborted &&
    !timedOut &&
    APICallError.isInstance(error) &&
    error.statusCode !== undefined &&
    SHAPE_REFUSALS.has(error.statusCode) &&
    WITHOUT_PICTURES.test(error.responseBody ?? '')
  ) {
    return 'model-without-pictures';
  }
  const failure = failureOf(error, timedOut, aborted);
  // No tool is ever sent with a picture, so this cannot be the answer; it is a refusal.
  return failure === 'model-without-tools' ? 'refused' : failure;
}

/**
 * A fetch that sends only under `base`, and never follows a redirect. Exported
 * for `model.test.ts` alone, which hands it a foreign URL directly: the SDK
 * only ever calls `baseURL`, so no run through it can show the guard works.
 */
export function pinnedTo(base: string, send: typeof globalThis.fetch): typeof globalThis.fetch {
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
    ...(settings.reasoningTokens === undefined
      ? {}
      : { reasoningTokens: settings.reasoningTokens }),
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
  /** The rider's standing allowance for reasoning (#1268), when they set one. */
  readonly reasoningTokens?: number;
  /** The platform's `fetch` unless a test hands its own. */
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * A hosted model on a key the instance holds (#1097, ADR 0046 D-9): the
 * second OpenAI-compatible endpoint, with the same guard, the same one-host
 * fetch, no retries and the same closed failures as the local one. It is NOT
 * held to the local-address rule — it is hosted by definition — so what
 * bounds it instead is that `baseUrl` is `https:` and is the only host it can
 * reach.
 *
 * ⚠️ **Built only behind the masking** (#1101): `hosted.ts`
 * §`hostedBehindMasking` is the one module that may call this
 * (`hosted-seam.test.ts`), and only with the athlete's guard. Until a recorded
 * consent naming the endpoint exists (ADR 0046 Q10, the operator's included,
 * #1199) and the job engine calls it (#1095), a job asking for the hosted
 * source fails `hosted_unavailable` and sends nothing.
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
    ...(options.reasoningTokens === undefined ? {} : { reasoningTokens: options.reasoningTokens }),
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
    // Whether the model reasoned, and for how many tokens where the server
    // says (#1268). DeepSeek and OpenAI count them; Ollama sends the reasoning
    // beside the answer and counts nothing apart. The text is read for being
    // there and dropped.
    const reasoningTokens = result.usage.outputTokenDetails.reasoningTokens ?? 0;
    const reasoned = reasoningTokens > 0 || (result.reasoningText ?? '') !== '';
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
      ...(reasoned ? { reasoning: reasoningTokens > 0 ? { tokens: reasoningTokens } : {} } : {}),
    };
  } catch (error) {
    return {
      ok: false,
      failure: failureOf(error, timeout.aborted, request.signal.aborted),
    };
  }
}

/** What a picture connection is built with beyond its model: the fixed question. */
export interface PictureModelExtras {
  readonly question: PictureQuestion;
}

/**
 * The model on the rider's own box that takes pictures (#1106): the local
 * server of {@link createLocalModel}, held to the same address rule on every
 * look, and the model the operator named for pictures.
 */
export function createLocalPictureModel(
  options: LocalModelOptions & PictureModelExtras,
): PictureConnection {
  const { settings, resolve, question } = options;
  const send = options.fetch ?? globalThis.fetch.bind(globalThis);
  return {
    async look(request: PictureLookRequest): Promise<PictureLook> {
      if (request.signal.aborted) return { ok: false, failure: 'aborted' };
      const checked = await localAddressesOnly(settings.baseUrl.hostname, resolve);
      if (!checked.ok) return { ok: false, failure: checked.why };
      const base = atAddress(settings.baseUrl, checked.address);
      const provider = createOpenAICompatible({
        name: 'local',
        baseURL: base,
        fetch: pinnedTo(base, send),
      });
      return oneLook(provider, settings.model, question, settings.reasoningTokens, request);
    },
  };
}

/**
 * A hosted model on the rider's OWN key, shown a picture (#1106, the owner's
 * ruling of 2026-10-12): `https:` only, one host, the same closed failures.
 *
 * ⚠️ **Built in one place** — `camera/hosted-pictures.ts`, which
 * `camera/hosted-pictures-seam.test.ts` holds every other shipped module out
 * of — and only for a rider whose own picture consent names the origin
 * (`camera/side-pose.ts`). What leaves is the picture and
 * {@link PictureModelExtras.question}: no athlete id, no session, no ride.
 */
export function createHostedPictureModel(
  options: HostedModelOptions & PictureModelExtras,
): PictureConnection {
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
    async look(request: PictureLookRequest): Promise<PictureLook> {
      if (request.signal.aborted) return { ok: false, failure: 'aborted' };
      return oneLook(provider, options.model, options.question, options.reasoningTokens, request);
    },
  };
}

/** One picture through `provider`: the fixed question and the picture, in one user message. */
async function oneLook(
  provider: ReturnType<typeof createOpenAICompatible>,
  model: string,
  question: PictureQuestion,
  reasoningTokens: number | undefined,
  request: PictureLookRequest,
): Promise<PictureLook> {
  const timeout = AbortSignal.timeout(Math.max(1, request.timeoutMilliseconds));
  try {
    const result = await generateText({
      model: provider.chatModel(model),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: question.question },
            { type: 'image', image: request.picture, mediaType: 'image/jpeg' },
          ],
        },
      ],
      // A model that reasons spends its allowance before it answers (#1268).
      maxOutputTokens: question.maxOutputTokens + (reasoningTokens ?? 0),
      maxRetries: 0,
      abortSignal: AbortSignal.any([request.signal, timeout]),
    });
    return { ok: true, text: result.text };
  } catch (error) {
    return {
      ok: false,
      failure: pictureFailureOf(error, timeout.aborted, request.signal.aborted),
    };
  }
}
