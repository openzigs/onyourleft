// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Finding Ollama, and asking it to download and to load a model** — #2792,
 * for the first-run setup's optional AI step (`setup/setup.ts`). What Ollama
 * then offers is `local-server.ts`'s read (#2610), unchanged.
 *
 * ## Where Ollama is looked for
 *
 * At the address the operator's settings already name, then at
 * {@link OLLAMA_ADDRESSES}: the home deployment's `ollama` service, and an
 * Ollama installed on the host, as a container and as the host itself reach
 * it. Constants of this repository, never anything a request carries. Each is
 * held to `.env`'s rule for a local model address first, and every request to
 * one goes through `local-server.ts` §`sendLocal`: its name resolved, EVERY
 * address local, sent to the checked address, no redirect followed (ADR 0040
 * D-6). The first, in that order, that answers `GET /api/version` with a
 * version is the Ollama.
 *
 * ## What is asked of it
 *
 * - `POST {origin}/api/pull` `{model, stream: true}` — the download. Its
 *   answer is a stream of JSON lines: `{status, digest, total, completed}`
 *   while a layer downloads, `{status: "success"}` at the end, and `{error}`
 *   when it fails.
 * - `POST {origin}/api/generate` `{model, stream: false}` — with no prompt,
 *   Ollama loads the model and answers. Loaded, `/api/ps` says how much of it
 *   is in GPU memory: the one place a fit is read from.
 *
 * Source: Ollama's API reference, `docs/api.md` in github.com/ollama/ollama,
 * "Pull a Model" and "Generate a completion", read 2026-11-18. The `error`
 * line is not in that reference: it is what the server writes when a pull
 * fails, so any line carrying an `error` key, any line that is not a JSON
 * object, any answer but a 2xx, and a stream that ends with no `success` are
 * each a failed download.
 *
 * ## What comes back
 *
 * ⚠️ **Nothing Ollama says of a download is kept or shown** but its byte
 * counts and whether it ended in `success`. A status line names a digest, and
 * an error names the model and, for a disk error, a path under the home of
 * the user Ollama runs as. {@link ModelPullState} holds numbers and one of
 * four words, so no page or log line can carry either. No model is named in
 * this file (ADR 0046's amendment of 2026-11-14, point 8): the name is the
 * owner's.
 */

import { analysisModelUrlProblem } from '../config.ts';
import {
  askLocal,
  readLocalServer,
  sendLocal,
  type LocalServerOptions,
  type LocalServerRead,
} from './local-server.ts';

/**
 * Where Ollama is looked for, in order, as the OpenAI-compatible base URL the
 * settings hold: the Compose `ollama` service, the host's Ollama from inside
 * a container, and the host's Ollama from the host.
 */
export const OLLAMA_ADDRESSES: readonly string[] = [
  'http://ollama:11434/v1',
  'http://host.docker.internal:11434/v1',
  'http://127.0.0.1:11434/v1',
];

/**
 * How long each address is given to answer `/api/version`: 3 s. They are
 * asked together, so a page waits this long at most to learn there is none.
 *
 * ## Provenance — ⚠️ the author's choice, not a measurement
 */
export const OLLAMA_FIND_MS = 3_000;

/**
 * The longest one download may take: 6 hours. A model is several gigabytes,
 * and a home connection may be slow.
 *
 * ## Provenance — ⚠️ the author's choice, not a measurement
 */
export const MODEL_PULL_MS = 6 * 60 * 60 * 1000;

/**
 * How long a load is waited for: 50 s, `agent.ts` §`TOOL_CHECK_MILLISECONDS`'s
 * figure for the same wait, a model being loaded while the owner's page waits.
 *
 * ## Provenance — ⚠️ the author's choice, not a measurement
 */
export const MODEL_LOAD_MS = 50_000;

/** The most of one line of a download's answer that is read: 64 KiB. A longer line ends it. */
export const PULL_LINE_BYTES = 64 * 1024;

/** The most layers one download's bytes are counted over. A model has a handful. */
export const PULL_LAYERS = 256;

/** The Ollama found: its address as the settings would hold it, and what it offers. */
export interface FoundOllama {
  readonly baseUrl: URL;
  readonly read: LocalServerRead;
}

/** `promise`, or `late` once `signal` aborts: a lookup that hangs is not held by a signal. */
function within<T>(signal: AbortSignal, promise: Promise<T>, late: T): Promise<T> {
  const expired = new Promise<T>((settle) => {
    signal.addEventListener('abort', () => settle(late), { once: true });
  });
  return Promise.race([promise, expired]);
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const wholeBytes = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

/** Whether `base`'s server answers `/api/version` with a version, within `waitMs`. */
async function answersAsOllama(
  base: URL,
  options: LocalServerOptions,
  waitMs: number,
): Promise<boolean> {
  const deadline = AbortSignal.timeout(waitMs);
  const asked = askLocal(new URL(base.origin), '/api/version', { method: 'GET' }, options, deadline)
    .then((said) => isRecord(said) && typeof said.version === 'string')
    .catch(() => false);
  return within(deadline, asked, false);
}

/**
 * The first of `addresses`, in order, that is Ollama, and what it offers —
 * or `undefined` when none answers. An address `.env`'s rule would refuse is
 * never asked.
 */
export async function findOllama(
  addresses: readonly string[],
  options: LocalServerOptions & {
    /** {@link OLLAMA_FIND_MS} unless a test's. */
    readonly findMs?: number;
  },
): Promise<FoundOllama | undefined> {
  const bases = [...new Set(addresses.map((address) => address.trim()))]
    .filter((address) => analysisModelUrlProblem(address) === undefined)
    .map((address) => new URL(address));
  const waitMs = options.findMs ?? OLLAMA_FIND_MS;
  const answers = await Promise.all(bases.map((base) => answersAsOllama(base, options, waitMs)));
  const baseUrl = bases[answers.indexOf(true)];
  if (baseUrl === undefined) return undefined;
  const read = await readLocalServer(baseUrl, options);
  return read.state === 'ollama' ? { baseUrl, read } : undefined;
}

/**
 * Ask Ollama to load `model`, and wait up to {@link MODEL_LOAD_MS} for it.
 * It answers nothing: whether the model is loaded, and how much of it is in
 * GPU memory, is what `/api/ps` says afterwards.
 */
export async function loadModel(
  base: URL,
  model: string,
  options: LocalServerOptions & {
    /** {@link MODEL_LOAD_MS} unless a test's. */
    readonly loadMs?: number;
  },
): Promise<void> {
  const deadline = AbortSignal.timeout(options.loadMs ?? MODEL_LOAD_MS);
  const asked = askLocal(
    new URL(base.origin),
    '/api/generate',
    { method: 'POST', body: { model, stream: false } },
    options,
    deadline,
  ).then(
    () => undefined,
    () => undefined,
  );
  await within(deadline, asked, undefined);
}

/** A download, as the instance holds it: numbers, and one of four words. */
export type ModelPullState =
  /** None was asked for since the instance started. */
  | { readonly kind: 'idle' }
  /** One is running: the bytes Ollama has counted, over every layer it has named so far. */
  | { readonly kind: 'running'; readonly completedBytes: number; readonly totalBytes: number }
  /** The last one ended in `success`. */
  | { readonly kind: 'done' }
  /** The last one did not: refused, failed, cut short, out of time, or the instance stopped. */
  | { readonly kind: 'failed' };

export interface ModelPull {
  /** The download now, or how the last one ended. */
  state(): ModelPullState;
  /** Start downloading `model` from the Ollama at `base` — or `false` while one is running. */
  start(base: URL, model: string): boolean;
  /** Resolves once no download is running. */
  idle(): Promise<void>;
}

/** Each line of `body`, decoded, or `undefined` once for a line over {@link PULL_LINE_BYTES}. */
async function* linesOf(body: ReadableStream<Uint8Array>): AsyncGenerator<string | undefined> {
  const decoder = new TextDecoder();
  let held = '';
  for await (const chunk of body) {
    held += decoder.decode(chunk, { stream: true });
    for (;;) {
      const end = held.indexOf('\n');
      // Bounded whether or not its end has arrived yet.
      if ((end < 0 ? held.length : end) > PULL_LINE_BYTES) {
        yield undefined;
        return;
      }
      if (end < 0) break;
      yield held.slice(0, end);
      held = held.slice(end + 1);
    }
  }
  if (held.trim() !== '') yield held;
}

/**
 * The instance's one download: a second, while one is running, is not
 * started. It runs after the request that asked for it has been answered, and
 * ends when the instance stops.
 */
export function createModelPull(
  options: LocalServerOptions & {
    /** Aborted when the instance stops. */
    readonly stopped?: AbortSignal;
    /** {@link MODEL_PULL_MS} unless a test's. */
    readonly pullMs?: number;
  },
): ModelPull {
  let state: ModelPullState = { kind: 'idle' };
  let running: Promise<void> = Promise.resolve();

  /** Whether the download ended in `success`. */
  async function pull(base: URL, model: string): Promise<boolean> {
    const deadline = AbortSignal.timeout(options.pullMs ?? MODEL_PULL_MS);
    const signal =
      options.stopped === undefined ? deadline : AbortSignal.any([deadline, options.stopped]);
    const response = await sendLocal(
      new URL(base.origin),
      '/api/pull',
      { method: 'POST', body: { model, stream: true } },
      options,
      signal,
    );
    if (!response.ok || response.body === null) {
      await response.body?.cancel();
      return false;
    }
    const layers = new Map<string, { readonly total: number; readonly completed: number }>();
    for await (const line of linesOf(response.body)) {
      if (line === undefined) return false;
      if (line.trim() === '') continue;
      let said: unknown;
      try {
        said = JSON.parse(line) as unknown;
      } catch {
        return false;
      }
      // Its words are never read: an error names the model, and may name a path.
      if (!isRecord(said) || 'error' in said) return false;
      if (said.status === 'success') return true;
      const total = wholeBytes(said.total);
      if (typeof said.digest !== 'string' || total === undefined) continue;
      if (!layers.has(said.digest) && layers.size >= PULL_LAYERS) continue;
      layers.set(said.digest, {
        total,
        completed: Math.min(total, wholeBytes(said.completed) ?? 0),
      });
      let completedBytes = 0;
      let totalBytes = 0;
      for (const layer of layers.values()) {
        completedBytes += layer.completed;
        totalBytes += layer.total;
      }
      state = { kind: 'running', completedBytes, totalBytes };
    }
    return false;
  }

  return {
    state: () => state,
    start(base, model) {
      if (state.kind === 'running') return false;
      state = { kind: 'running', completedBytes: 0, totalBytes: 0 };
      running = pull(base, model).then(
        (succeeded) => {
          state = { kind: succeeded ? 'done' : 'failed' };
        },
        () => {
          state = { kind: 'failed' };
        },
      );
      return true;
    },
    idle: () => running,
  };
}
