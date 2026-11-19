// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The write-up measurement's runner (#2840) — `write-up-measure.ts` is the
 * command. Apart from it so `write-up-measure.test.ts` can run the same code
 * against a scripted server.
 *
 * It runs **the shipped agent** (`src/analysis/agent.ts`) through **the
 * shipped connection** (`src/analysis/model.ts` §`createLocalModel`) over the
 * scored set (`write-up-set.ts`), and reads beside it what the agent does
 * not keep: each turn's `usage` as the server reported it, and the context
 * the model was loaded with (`/api/ps`'s `context_length`). Nothing it
 * writes holds the model's text, a prompt or a tool result: numbers and
 * closed names only.
 *
 * The model is Ollama on this machine's loopback, or on the loopback of a
 * machine reached over SSH, as #2838's harness reaches it
 * (`apps/web/tools/model-tactics-spike/harness/model-call.ts`): `curl` there,
 * the body on standard input. Ollama is never exposed. The time booked per
 * ride is the wall time HERE, so over SSH it includes one SSH leg a turn.
 */

import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

import { ANALYSIS_AGENT_TEMPLATE_V1, type AgentTemplate } from '@onyourleft/analysis';

import { runAnalysisAgent, type AgentEvent } from '../src/analysis/agent.ts';
import { createLocalModel } from '../src/analysis/model.ts';

import {
  figuresIn,
  scoreRide,
  SET_READS,
  setShortfalls,
  type RideScore,
  type SetRide,
  type TurnMeasure,
} from './write-up-set.ts';

/** Where the model is. */
export type MeasureTarget =
  | { readonly kind: 'loopback'; readonly origin: string }
  | { readonly kind: 'ssh'; readonly host: string };

/** Sends one request to the model's server and answers with its response. */
export type Send = (url: string, init: { method: string; body?: string }) => Promise<Response>;

/** Ollama's own loopback address, on whichever machine has it. */
export const OLLAMA_LOOPBACK = 'http://127.0.0.1:11434';

/** How long one request may take, ms: a cold load of the model and a whole turn fit. */
const REQUEST_WAIT_MS = 180_000;

/** Characters a URL handed to the remote shell may hold: nothing it could read as syntax. */
const PLAIN_URL = /^http:\/\/127\.0\.0\.1:11434\/[A-Za-z0-9/._-]*$/;

/** One request on a machine reached over SSH: `curl` there, the body on standard input. */
function overSsh(host: string): Send {
  if (host === '' || host.startsWith('-')) throw new Error('--host takes an SSH host name');
  return (url, init) => {
    if (!PLAIN_URL.test(url)) return Promise.reject(new TypeError('Only Ollama on loopback.'));
    return new Promise((resolve, reject) => {
      const child = spawn(
        'ssh',
        [
          '-o',
          'BatchMode=yes',
          host,
          `curl.exe -s -X ${init.method === 'GET' ? 'GET' : 'POST'} ${url} -H 'Content-Type: application/json' ${init.body === undefined ? '' : "--data-binary '@-'"} -w '\\n%{http_code}'`,
        ],
        { stdio: ['pipe', 'pipe', 'ignore'], timeout: REQUEST_WAIT_MS },
      );
      let out = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        out += chunk;
      });
      child.on('error', reject);
      child.on('close', () => {
        const cut = out.lastIndexOf('\n');
        const status = Number(out.slice(cut + 1).trim());
        if (cut < 0 || !Number.isInteger(status) || status < 200) {
          reject(new TypeError('No answer over SSH.'));
          return;
        }
        resolve(
          new Response(out.slice(0, cut), {
            status,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      });
      child.stdin.end(init.body ?? '');
    });
  };
}

/** How requests reach `target`. @throws {Error} for a loopback origin that is not loopback. */
export function sendTo(target: MeasureTarget): Send {
  if (target.kind === 'ssh') return overSsh(target.host);
  const { hostname } = new URL(target.origin);
  if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '[::1]') {
    throw new Error('--url takes a loopback address; use --host for another machine');
  }
  return (url, init) =>
    fetch(url.replace(OLLAMA_LOOPBACK, target.origin), {
      method: init.method,
      headers: { 'Content-Type': 'application/json' },
      ...(init.body === undefined ? {} : { body: init.body }),
      signal: AbortSignal.timeout(REQUEST_WAIT_MS),
    });
}

const wholeOrNone = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;

/** The text of every message a chat-completions body sends: what the model was given. */
function sentText(body: unknown): string {
  const messages = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(messages)) return '';
  return messages
    .map((message: unknown) => {
      const content = (message as { content?: unknown } | null)?.content;
      return typeof content === 'string' ? content : JSON.stringify(content ?? '');
    })
    .join('\n');
}

/**
 * A fetch for the SDK that sends through `send` and keeps, for each
 * chat-completions turn, what the server reported: tokens read and written,
 * the allowance asked for and the time. And the text sent last, which holds
 * every figure the model was given (it is read for figures and dropped).
 */
export function measuringFetch(send: Send): {
  readonly fetch: typeof globalThis.fetch;
  readonly turns: TurnMeasure[];
  lastSent(): string;
} {
  const turns: TurnMeasure[] = [];
  let last = '';
  const fetchThrough: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = typeof init?.body === 'string' ? init.body : undefined;
    const started = performance.now();
    const response = await send(url, {
      method: init?.method ?? 'GET',
      ...(body === undefined ? {} : { body }),
    });
    const milliseconds = Math.round(performance.now() - started);
    if (!url.endsWith('/chat/completions') || body === undefined) return response;
    const asked = JSON.parse(body) as { max_tokens?: unknown };
    last = sentText(asked);
    const text = await response.text();
    let usage: { prompt_tokens?: unknown; completion_tokens?: unknown } | undefined;
    try {
      usage = (JSON.parse(text) as { usage?: typeof usage }).usage;
    } catch {
      usage = undefined;
    }
    turns.push({
      promptTokens: wholeOrNone(usage?.prompt_tokens),
      outputTokens: wholeOrNone(usage?.completion_tokens),
      maxOutputTokens: wholeOrNone(asked.max_tokens) ?? 0,
      milliseconds,
    });
    return new Response(text, { status: response.status, headers: response.headers });
  };
  return { fetch: fetchThrough, turns, lastSent: () => last };
}

/** The context `model` is loaded with, from `/api/ps`, or `undefined` when it is not loaded or not said. */
export async function loadedContext(send: Send, model: string): Promise<number | undefined> {
  try {
    const answer = (await (await send(`${OLLAMA_LOOPBACK}/api/ps`, { method: 'GET' })).json()) as {
      models?: readonly { name?: unknown; model?: unknown; context_length?: unknown }[];
    };
    const loaded = answer.models?.find((each) => each.name === model || each.model === model);
    return wholeOrNone(loaded?.context_length);
  } catch {
    return undefined;
  }
}

/** Ollama's version, from `/api/version`, or `undefined`. */
export async function ollamaVersion(send: Send): Promise<string | undefined> {
  try {
    const answer = (await (
      await send(`${OLLAMA_LOOPBACK}/api/version`, { method: 'GET' })
    ).json()) as {
      version?: unknown;
    };
    return typeof answer.version === 'string' ? answer.version : undefined;
  } catch {
    return undefined;
  }
}

/** What a run of the set came to: a results file's whole content. */
export interface MeasureResult {
  readonly model: string;
  readonly template: { readonly id: string; readonly version: string };
  readonly ollama: string | undefined;
  /** The context the model was loaded with, tokens. */
  readonly contextTokens: number | undefined;
  readonly scores: readonly RideScore[];
  readonly shortfalls: readonly string[];
}

/** Run the agent over `rides`, one at a time, and score each. */
export async function measureWriteUps(options: {
  readonly send: Send;
  readonly model: string;
  readonly rides: readonly SetRide[];
  readonly template?: AgentTemplate;
  readonly log?: (line: string) => void;
}): Promise<MeasureResult> {
  const { send, model, rides } = options;
  const template = options.template ?? ANALYSIS_AGENT_TEMPLATE_V1;
  const scores: RideScore[] = [];
  let contextTokens: number | undefined;
  for (const ride of rides) {
    const measuring = measuringFetch(send);
    const tools: Record<string, number> = {};
    const started = performance.now();
    const outcome = await runAnalysisAgent({
      job: { athleteId: 'set-rider', input: ride.input },
      model: createLocalModel({
        settings: { baseUrl: new URL(`${OLLAMA_LOOPBACK}/v1`), model },
        resolve: () => Promise.resolve(['127.0.0.1']),
        fetch: measuring.fetch,
      }),
      reads: SET_READS,
      clock: { now: () => performance.now() },
      signal: new AbortController().signal,
      emit: (event: AgentEvent) => {
        if (event.type === 'progress' && event.tool !== undefined) {
          tools[event.tool] = (tools[event.tool] ?? 0) + 1;
        }
      },
      template,
    });
    const milliseconds = Math.round(performance.now() - started);
    contextTokens ??= await loadedContext(send, model);
    const score = scoreRide({
      ride: ride.name,
      outcome: outcome.kind === 'failed' ? `failed:${outcome.why}` : outcome.kind,
      turns: measuring.turns,
      tools,
      milliseconds,
      writeUp: outcome.kind === 'written' ? outcome.writeUp : undefined,
      given: figuresIn(measuring.lastSent()),
      contextTokens,
    });
    options.log?.(JSON.stringify(score));
    scores.push(score);
  }
  return {
    model,
    template: { id: template.id, version: template.version },
    ollama: await ollamaVersion(send),
    contextTokens,
    scores,
    shortfalls: setShortfalls(scores),
  };
}
