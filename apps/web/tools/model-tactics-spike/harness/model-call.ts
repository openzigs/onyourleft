// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2838's scoring harness: one call to a local model, and what it came to.
 *
 * The body sent is the instance's own (`production.ts`), with one thing
 * added: a **fixed seed** ({@link seeded}). Ollama then answers the same
 * question the same way, so two runs of the harness differ only where the
 * prompt, the schema or the model did. **The seed is the harness's alone**:
 * the instance's request carries none, `harness.test.ts` holds that, and a
 * real race or ride is never seeded.
 *
 * Ollama has no authentication and listens on loopback only, so it is never
 * exposed: {@link ollamaAsk} either calls it on this machine, or runs `curl`
 * on the machine that has it over SSH, the body on standard input, as spike
 * 0039's `live.ts` did. The latency booked is the **server's** own
 * `total_duration`, what an instance calling Ollama on its own loopback
 * waits; the SSH leg is left out.
 */

import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

/** What one model call came to. */
export interface ModelCall {
  /** The model's answer, or `undefined` when the call gave none. */
  readonly text: string | undefined;
  /** How long the answer took, ms: the server's own time where it gave one. */
  readonly latencyMs: number;
  /** Tokens read, or `undefined` when the server did not say. */
  readonly promptTokens?: number | undefined;
  /** Tokens written. */
  readonly outputTokens?: number | undefined;
}

/** A model: asked with an `/api/chat` body. Never rejects. */
export type Ask = (body: Readonly<Record<string, unknown>>) => Promise<ModelCall>;

/** `body` with `seed` in its options, and everything else as the instance wrote it. */
export function seeded(
  body: Readonly<Record<string, unknown>>,
  seed: number,
): Readonly<Record<string, unknown>> {
  const options = body.options;
  return {
    ...body,
    options: { ...(typeof options === 'object' && options !== null ? options : {}), seed },
  };
}

const wholeOrNone = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

/**
 * What Ollama's `/api/chat` answer came to. `wallMs` is the time the caller
 * waited, used only when the server gives no `total_duration`. An answer with
 * an `error`, or with no message content, is no answer.
 */
export function callFromChat(answer: unknown, wallMs: number): ModelCall {
  if (typeof answer !== 'object' || answer === null) return { text: undefined, latencyMs: wallMs };
  const {
    message,
    error,
    total_duration: total,
    prompt_eval_count: read,
    eval_count: written,
  } = answer as Record<string, unknown>;
  const nanoseconds = wholeOrNone(total);
  const latencyMs = nanoseconds === undefined ? wallMs : Math.round(nanoseconds / 1e6);
  const content =
    typeof message === 'object' && message !== null
      ? (message as { content?: unknown }).content
      : undefined;
  if (error !== undefined || typeof content !== 'string') return { text: undefined, latencyMs };
  return {
    text: content,
    latencyMs,
    promptTokens: wholeOrNone(read),
    outputTokens: wholeOrNone(written),
  };
}

/** Where the model is: on this machine's loopback, or on the loopback of a machine reached over SSH. */
export type ModelTarget =
  | { readonly kind: 'loopback'; readonly origin: string }
  | { readonly kind: 'ssh'; readonly host: string };

/** How long one call may take before it is given up, ms: a cold load of the model fits. */
const CALL_WAIT_MS = 120_000;

/** One `/api/chat` call on a machine reached over SSH, the body on standard input. */
function overSsh(host: string, body: string): Promise<unknown> {
  return new Promise((resolve) => {
    const child = spawn(
      'ssh',
      [
        '-o',
        'BatchMode=yes',
        host,
        "curl.exe -s http://127.0.0.1:11434/api/chat -H 'Content-Type: application/json' --data-binary '@-'",
      ],
      { stdio: ['pipe', 'pipe', 'ignore'], timeout: CALL_WAIT_MS },
    );
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      out += chunk;
    });
    child.on('error', () => {
      resolve(undefined);
    });
    child.on('close', () => {
      try {
        resolve(JSON.parse(out) as unknown);
      } catch {
        resolve(undefined);
      }
    });
    child.stdin.end(body);
  });
}

/** One `/api/chat` call on this machine's loopback. */
async function onLoopback(origin: string, body: string): Promise<unknown> {
  try {
    const answered = await fetch(new URL('/api/chat', origin), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(CALL_WAIT_MS),
    });
    return (await answered.json()) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * The model at `target`.
 *
 * @throws {Error} for an SSH host that is empty or starts with `-`, which
 * `ssh` would read as an option, and for a loopback origin that is not
 * loopback: the harness never sends a prompt off the machine that has the model.
 */
export function ollamaAsk(target: ModelTarget): Ask {
  if (target.kind === 'ssh') {
    if (target.host === '' || target.host.startsWith('-')) {
      throw new Error('--host takes an SSH host name');
    }
  } else {
    const { hostname } = new URL(target.origin);
    if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '[::1]') {
      throw new Error('--url takes a loopback address; use --host for another machine');
    }
  }
  return async (body) => {
    const text = JSON.stringify(body);
    const started = performance.now();
    const answer =
      target.kind === 'ssh'
        ? await overSsh(target.host, text)
        : await onLoopback(target.origin, text);
    return callFromChat(answer, Math.round(performance.now() - started));
  };
}

/**
 * A model that answers from `calls`, in order, whatever it is asked: a run
 * the harness recorded (`--record`), ridden again with no model. Past the
 * last, it gives no answer.
 */
export function recordedAsk(calls: readonly ModelCall[]): Ask {
  let next = 0;
  return () => {
    const call = calls[next];
    next += 1;
    return Promise.resolve(call ?? { text: undefined, latencyMs: 0 });
  };
}

/** `ask`, with every call it makes kept in `calls`, oldest first. */
export function recording(ask: Ask): { readonly ask: Ask; readonly calls: ModelCall[] } {
  const calls: ModelCall[] = [];
  return {
    calls,
    ask: async (body) => {
      const call = await ask(body);
      calls.push(call);
      return call;
    },
  };
}

/** The middle, the ninth decile and the most of some numbers. All nought with none. */
export interface Spread {
  readonly median: number;
  readonly p90: number;
  readonly most: number;
}

/** The spread of `values`, each by the nearest-rank rule: a value that was measured, never one between two. */
export function spread(values: readonly number[]): Spread {
  if (values.length === 0) return { median: 0, p90: 0, most: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (share: number): number =>
    sorted[
      Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1))
    ] as number;
  return { median: rank(0.5), p90: rank(0.9), most: sorted.at(-1) as number };
}
