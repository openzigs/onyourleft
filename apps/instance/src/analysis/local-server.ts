// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What the local model server offers** — #2610, for the Operate area's
 * "Pick a local model" (#2611). Read-only, the owner's alone, and asked only
 * when the owner opens the list.
 *
 * ## What is asked, and of whom
 *
 * The server is the configured local address (the operator's row over `.env`,
 * `settings.ts` §`localServerOf`), and every request goes through
 * {@link askLocal}: the name is resolved, EVERY address must be local, and
 * the request goes to the checked address with `redirect: 'error'` — on
 * every request, not once per read (ADR 0040 D-6, `history/address.ts`). A
 * name that resolves private for one request and public for the next stops
 * the read at that request, `not-local`, and nothing more is asked.
 *
 * - `GET {origin}/api/version` — answered with a version, the server is
 *   Ollama, and the version is shown.
 * - `GET {origin}/api/tags` — each model's name, size, parameters and
 *   quantisation.
 * - `GET {origin}/api/ps` — for each LOADED model, `size` and `size_vram`:
 *   how much of it is in GPU memory ({@link GpuFit}). A model that is not
 *   loaded is `not-loaded`: Ollama does not report the card's memory, so the
 *   instance never guesses a fit from the file's size.
 * - `POST {origin}/api/show` per model — its `capabilities`: `tools` listed,
 *   or not, or not reported at all (an older server lists none).
 * - A server that does not answer `/api/version` is not Ollama, and is asked
 *   `GET {base}/models` (OpenAI-compatible) for names alone.
 *
 * Source: Ollama's API reference, `docs/api.md` in github.com/ollama/ollama,
 * read 2026-11-14. The field names are Ollama's and may change between
 * versions, so every one is optional here: a field missing or of the wrong
 * type is "not reported", never an error.
 *
 * ## What comes back
 *
 * The server's answers are untrusted: each body is read up to
 * {@link LOCAL_SERVER_BODY_BYTES} and no further, a model whose name the
 * settings would refuse is left out, and each other string is kept only in
 * the shape it is documented in (a version, `7.6B`, `Q4_K_M`). Nothing the
 * server says is echoed as an error: a failure is one of
 * {@link LocalServerState}'s words. No address the name resolved to is in it.
 */

import { analysisModelNameProblem } from '../config.ts';
import { localAddressesOnly, type Resolver } from '../history/address.ts';

/** How much of a loaded model is in GPU memory. */
export type GpuFit =
  /** All of it. */
  | 'all'
  /** Some: the rest runs on the CPU. {@link LocalModel.gpuPercent} says how much. */
  | 'part'
  /** None: it runs on the CPU alone. */
  | 'none'
  /** Not loaded, so not known until it is: Ollama does not say how much memory the card has. */
  | 'not-loaded'
  /** Loaded, and the server did not say how much of it is in GPU memory (an older server). */
  | 'not-reported'
  /** Not an Ollama server: nothing is known. */
  | 'not-known';

/** Whether the server lists `tools` among a model's capabilities. */
export type ToolSupport = 'listed' | 'not-listed' | 'not-reported';

/** One model the local server offers. */
export interface LocalModel {
  readonly name: string;
  /** The model's size on disk, in bytes, as `/api/tags` says. */
  readonly sizeBytes: number | null;
  /** `7.6B`, as the server writes it. */
  readonly parameters: string | null;
  /** `Q4_K_M`, as the server writes it. */
  readonly quantisation: string | null;
  readonly tools: ToolSupport;
  readonly gpu: GpuFit;
  /** For `part`, the whole percent in GPU memory, 1–99; `null` otherwise. */
  readonly gpuPercent: number | null;
}

/** What the server is, or why it could not be read. */
export type LocalServerState =
  /** Ollama: `/api/version` answered. */
  | 'ollama'
  /** Not Ollama: `/models` answered, with names alone. */
  | 'openai-compatible'
  /** No address is set, or the one set fails `.env`'s rule — `GET /v1/operate/analysis` says which. */
  | 'no-address'
  /** The address, or what its name resolves to now, is outside the local ranges. */
  | 'not-local'
  /** The name resolves to nothing. */
  | 'unresolved'
  /** No usable answer: refused, reset, out of time, or not what either API answers. */
  | 'unreachable';

export interface LocalServerRead {
  readonly state: LocalServerState;
  /** Ollama's version, when it said one. */
  readonly version: string | null;
  readonly models: readonly LocalModel[];
}

/**
 * The longest one read may take, lookups and every request included: 15 s.
 * A model being loaded makes Ollama slow to answer `/api/show`.
 *
 * ## Provenance — ⚠️ the author's choice, not a measurement
 */
export const LOCAL_SERVER_READ_MS = 15_000;

/** The most of any one answer that is read: 4 MiB. `/api/show` carries a model's template and licence. */
export const LOCAL_SERVER_BODY_BYTES = 4 * 1024 * 1024;

/** The most models listed: more than a box with one card has room for. */
export const LOCAL_MODELS_LISTED = 100;

/** Thrown by {@link askLocal} for a name that is no longer local: the read stops there. */
class AddressRefused extends Error {
  readonly why: 'not-local' | 'unresolved';
  constructor(why: 'not-local' | 'unresolved') {
    super('The local model server’s address was refused.');
    this.name = 'AddressRefused';
    this.why = why;
  }
}

export interface LocalServerOptions {
  readonly resolve: Resolver;
  /** The platform's `fetch` unless a test hands its own. */
  readonly fetch?: typeof globalThis.fetch;
  /** {@link LOCAL_SERVER_READ_MS} unless a test's. */
  readonly waitMs?: number;
}

/** A body read up to {@link LOCAL_SERVER_BODY_BYTES}, parsed as JSON, or `undefined`. */
async function cappedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader() as ReadableStreamDefaultReader<Uint8Array> | undefined;
  if (reader === undefined) return undefined;
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > LOCAL_SERVER_BODY_BYTES) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * One request to the local server: `path` under `base`, sent to the address
 * its name resolves to NOW, every address of it local, or {@link AddressRefused}.
 * Answers the parsed body of a 2xx, or `undefined` for any other answer; a
 * network failure throws.
 */
export async function askLocal(
  base: URL,
  path: string,
  init: { readonly method: 'GET' | 'POST'; readonly body?: unknown },
  options: LocalServerOptions,
  signal: AbortSignal,
): Promise<unknown> {
  const checked = await localAddressesOnly(base.hostname, options.resolve);
  if (!checked.ok) throw new AddressRefused(checked.why);
  const target = new URL(`${base.href.replace(/\/+$/, '')}${path}`);
  target.hostname = checked.address.includes(':') ? `[${checked.address}]` : checked.address;
  const send = options.fetch ?? globalThis.fetch.bind(globalThis);
  const response = await send(target.href, {
    method: init.method,
    ...(init.body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) }),
    redirect: 'error',
    signal,
  });
  if (!response.ok) {
    await response.body?.cancel();
    return undefined;
  }
  return cappedJson(response);
}

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const asList = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

const wholeBytes = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

/** A string kept only in the shape it is documented in, or `null`. */
const shaped = (value: unknown, shape: RegExp): string | null =>
  typeof value === 'string' && shape.test(value) ? value : null;

/** `0.5.1`, `0.12.0-rc1`. */
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$/;
/** `7.6B`, `14.8B`, `494.03M`. */
const PARAMETERS = /^[0-9A-Za-z][0-9A-Za-z.]{0,15}$/;
/** `Q4_K_M`, `F16`, `MXFP4`. */
const QUANTISATION = /^[0-9A-Za-z][0-9A-Za-z_.-]{0,23}$/;

/** A model's name as a listing gives it, kept only if the settings would accept it. */
function nameOf(entry: Readonly<Record<string, unknown>>): string | undefined {
  const name = entry.name ?? entry.model;
  return typeof name === 'string' && analysisModelNameProblem(name) === undefined
    ? name.trim()
    : undefined;
}

/**
 * How much of a loaded model is in GPU memory, from `/api/ps`'s `size` (what
 * it takes loaded) and `size_vram` (the part of that in GPU memory).
 */
export function fitOf(loaded: Readonly<Record<string, unknown>> | undefined): {
  readonly gpu: GpuFit;
  readonly gpuPercent: number | null;
} {
  if (loaded === undefined) return { gpu: 'not-loaded', gpuPercent: null };
  const size = wholeBytes(loaded.size);
  const vram = wholeBytes(loaded.size_vram);
  if (size === undefined || size === 0 || vram === undefined) {
    return { gpu: 'not-reported', gpuPercent: null };
  }
  if (vram >= size) return { gpu: 'all', gpuPercent: null };
  if (vram === 0) return { gpu: 'none', gpuPercent: null };
  // Never 0 or 100 for a part: those would read as none and all.
  return {
    gpu: 'part',
    gpuPercent: Math.min(99, Math.max(1, Math.round((vram / size) * 100))),
  };
}

/** Whether `/api/show`'s answer lists `tools`. */
export function toolsOf(shown: unknown): ToolSupport {
  const capabilities = asRecord(shown)?.capabilities;
  if (!Array.isArray(capabilities)) return 'not-reported';
  return capabilities.includes('tools') ? 'listed' : 'not-listed';
}

/** The Ollama half: tags, what is loaded, and each model's capabilities. */
async function readOllama(
  base: URL,
  version: string | null,
  options: LocalServerOptions,
  signal: AbortSignal,
): Promise<LocalServerRead> {
  const origin = new URL(base.origin);
  const ask = (path: string, body?: unknown): Promise<unknown> =>
    askLocal(
      origin,
      path,
      body === undefined ? { method: 'GET' } : { method: 'POST', body },
      options,
      signal,
    );
  const tags = asRecord(await ask('/api/tags'));
  if (tags === undefined) return { state: 'unreachable', version, models: [] };
  // What is loaded is the one thing a fit is read from; a server that cannot
  // say is every model `not-loaded`, never a guess.
  const loaded = new Map<string, Readonly<Record<string, unknown>>>();
  for (const entry of asList(asRecord(await ask('/api/ps'))?.models)) {
    const record = asRecord(entry);
    const name = record === undefined ? undefined : nameOf(record);
    if (record !== undefined && name !== undefined) loaded.set(name, record);
  }
  const models: LocalModel[] = [];
  for (const entry of asList(tags.models)) {
    if (models.length >= LOCAL_MODELS_LISTED) break;
    const record = asRecord(entry);
    const name = record === undefined ? undefined : nameOf(record);
    if (record === undefined || name === undefined) continue;
    const details = asRecord(record.details);
    models.push({
      name,
      sizeBytes: wholeBytes(record.size) ?? null,
      parameters: shaped(details?.parameter_size, PARAMETERS),
      quantisation: shaped(details?.quantization_level, QUANTISATION),
      tools: toolsOf(await ask('/api/show', { model: name })),
      ...fitOf(loaded.get(name)),
    });
  }
  return { state: 'ollama', version, models };
}

/** The OpenAI-compatible fallback: `GET {base}/models`, names alone. */
async function readOpenAiCompatible(
  base: URL,
  options: LocalServerOptions,
  signal: AbortSignal,
): Promise<LocalServerRead> {
  const listed = asRecord(await askLocal(base, '/models', { method: 'GET' }, options, signal));
  if (listed === undefined || !Array.isArray(listed.data)) {
    return { state: 'unreachable', version: null, models: [] };
  }
  const models: LocalModel[] = [];
  for (const entry of listed.data) {
    if (models.length >= LOCAL_MODELS_LISTED) break;
    const id = asRecord(entry)?.id;
    if (typeof id !== 'string' || analysisModelNameProblem(id) !== undefined) continue;
    models.push({
      name: id.trim(),
      sizeBytes: null,
      parameters: null,
      quantisation: null,
      tools: 'not-reported',
      gpu: 'not-known',
      gpuPercent: null,
    });
  }
  return { state: 'openai-compatible', version: null, models };
}

/**
 * What the local server at `base` offers, read within one deadline. `base`
 * is the OpenAI-compatible base URL the settings hold (`http://ollama:11434/v1`);
 * Ollama's own API is at its origin.
 */
export async function readLocalServer(
  base: URL,
  options: LocalServerOptions,
): Promise<LocalServerRead> {
  const deadline = AbortSignal.timeout(options.waitMs ?? LOCAL_SERVER_READ_MS);
  // A lookup that hangs is not held by the signal, so the deadline is raced too.
  const expired = new Promise<LocalServerRead>((settle) => {
    deadline.addEventListener(
      'abort',
      () => settle({ state: 'unreachable', version: null, models: [] }),
      { once: true },
    );
  });
  const read = async (): Promise<LocalServerRead> => {
    try {
      const said = asRecord(
        await askLocal(new URL(base.origin), '/api/version', { method: 'GET' }, options, deadline),
      );
      if (said !== undefined && typeof said.version === 'string') {
        return await readOllama(base, shaped(said.version, VERSION), options, deadline);
      }
      return await readOpenAiCompatible(base, options, deadline);
    } catch (error) {
      if (error instanceof AddressRefused) return { state: error.why, version: null, models: [] };
      return { state: 'unreachable', version: null, models: [] };
    }
  };
  return Promise.race([read(), expired]);
}
