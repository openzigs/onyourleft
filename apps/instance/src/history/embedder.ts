// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The embedding model, on the rider's own machine** — ADR 0040 D-5 to D-7
 * (#835).
 *
 * One request shape: Ollama's `POST /api/embed`, `{ model, input, truncate }`,
 * answered `{ embeddings }`. Plain `fetch`, no npm client (the research's §5:
 * the client package adds nothing a request this small needs).
 *
 * ## What every request does, and why
 *
 * - **`truncate: false`, always.** Ollama's default cuts an over-long input
 *   silently, which is #795's silent-truncation defect on the embedding side.
 *   An over-long passage is `too-long`, never a vector of part of it.
 * - **The prefixes** (`search_document: `, `search_query: ` for the default
 *   model) are added here, by purpose, and are part of the
 *   {@link Embedder.convention} every row records (D-7): a vector made with one
 *   convention is never compared with one made with another.
 * - **Every vector is made unit length here**, whatever the server says it
 *   did, so ranking is a dot product (D-4) and a server that stops normalising
 *   cannot skew it.
 * - **The address is checked on every request** (`address.ts`
 *   §`localAddressesOnly`): the configured name is resolved here, every address
 *   it resolves to must be local, and the request goes to the address that was
 *   checked — never the name, which a second lookup could send elsewhere.
 *   `redirect: 'error'`, so an answer cannot move the request either.
 * - **It fails closed.** Anything but a well-formed answer is a failure, and
 *   nothing is embedded anywhere else instead (D-6's last bullet).
 *
 * Naming nothing of Node: the resolver and `fetch` are parameters.
 */

import { localAddressesOnly, type Resolver } from './address.ts';

/** The model the instance defaults to (the owner's ruling, ADR 0040 D-5): Apache-2.0, 768 dimensions. */
export const DEFAULT_EMBEDDING_MODEL = 'nomic-embed-text';

/** The default model's own prefixes (its model card, read 2026-09-29). */
export const DEFAULT_DOCUMENT_PREFIX = 'search_document: ';
export const DEFAULT_QUERY_PREFIX = 'search_query: ';

/** The longest the instance waits for one embedding request. */
export const EMBEDDING_TIMEOUT_MILLISECONDS = 60_000;

/** The widest vector the instance keeps; a larger answer is `malformed`. */
export const MAXIMUM_DIMENSION = 8_192;

/** What the embedding model is, and where. Built by `config.ts` §`readConfig`, already checked. */
export interface EmbeddingSettings {
  /** The origin of the model server: `http://ollama:11434`. */
  readonly endpoint: URL;
  readonly model: string;
  /** Put before every passage. */
  readonly documentPrefix: string;
  /** Put before every query. */
  readonly queryPrefix: string;
}

/** What a text is embedded as. */
export type EmbedPurpose = 'document' | 'query';

/** Why an embedding request gave no vectors. */
export type EmbedFailure =
  /** The configured name resolved to an address outside the local ranges. */
  | 'not-local'
  /** The configured name resolved to nothing. */
  | 'unresolved'
  /** No answer: refused, timed out, or the connection failed. */
  | 'unreachable'
  /** The server said an input was longer than the model's context. */
  | 'too-long'
  /** Any other refusal. */
  | 'refused'
  /** An answer that is not one vector per input, all of one finite, non-zero dimension. */
  | 'malformed';

export type EmbedOutcome =
  | { readonly ok: true; readonly vectors: readonly Float32Array[] }
  | { readonly ok: false; readonly why: EmbedFailure };

export interface Embedder {
  readonly model: string;
  /** The prefix convention, as every row records it (ADR 0040 D-7). */
  readonly convention: string;
  embed(texts: readonly string[], purpose: EmbedPurpose): Promise<EmbedOutcome>;
}

/** The convention string a row records for a pair of prefixes. Stable: it is compared. */
export function conventionOf(settings: Pick<EmbeddingSettings, 'documentPrefix' | 'queryPrefix'>) {
  return JSON.stringify({ document: settings.documentPrefix, query: settings.queryPrefix });
}

/** A vector scaled to length one, or `undefined` when it has no length or holds a non-number. */
export function unitLength(values: readonly unknown[]): Float32Array | undefined {
  if (values.length === 0 || values.length > MAXIMUM_DIMENSION) return undefined;
  let sum = 0;
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    sum += value * value;
  }
  const norm = Math.sqrt(sum);
  if (!(norm > 0)) return undefined;
  return Float32Array.from(values as number[], (value) => value / norm);
}

export interface OllamaEmbedderOptions {
  readonly settings: EmbeddingSettings;
  readonly resolve: Resolver;
  /** The platform's `fetch` unless a test hands its own. */
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMilliseconds?: number;
}

/** The URL of `/api/embed` at a checked address, on the configured port and scheme. */
function embedUrl(endpoint: URL, address: string): string {
  const host = address.includes(':') ? `[${address}]` : address;
  const port = endpoint.port === '' ? '' : `:${endpoint.port}`;
  return `${endpoint.protocol}//${host}${port}/api/embed`;
}

/** A local Ollama, called over HTTP. @see the file comment. */
export function createOllamaEmbedder(options: OllamaEmbedderOptions): Embedder {
  const { settings, resolve } = options;
  const request = options.fetch ?? globalThis.fetch.bind(globalThis);
  const timeout = options.timeoutMilliseconds ?? EMBEDDING_TIMEOUT_MILLISECONDS;
  return {
    model: settings.model,
    convention: conventionOf(settings),
    async embed(texts, purpose) {
      if (texts.length === 0) return { ok: true, vectors: [] };
      const checked = await localAddressesOnly(settings.endpoint.hostname, resolve);
      if (!checked.ok) return { ok: false, why: checked.why };
      const prefix = purpose === 'document' ? settings.documentPrefix : settings.queryPrefix;
      let response: Response;
      try {
        response = await request(embedUrl(settings.endpoint, checked.address), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: settings.model,
            input: texts.map((text) => `${prefix}${text}`),
            truncate: false,
          }),
          redirect: 'error',
          signal: AbortSignal.timeout(timeout),
        });
      } catch {
        return { ok: false, why: 'unreachable' };
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return { ok: false, why: response.ok ? 'malformed' : 'refused' };
      }
      if (!response.ok) {
        const message = (body as { error?: unknown } | null)?.error;
        return {
          ok: false,
          why:
            response.status === 400 &&
            typeof message === 'string' &&
            /context length/i.test(message)
              ? 'too-long'
              : 'refused',
        };
      }
      const embeddings = (body as { embeddings?: unknown } | null)?.embeddings;
      if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
        return { ok: false, why: 'malformed' };
      }
      const vectors: Float32Array[] = [];
      for (const values of embeddings) {
        const vector = Array.isArray(values) ? unitLength(values) : undefined;
        if (vector === undefined || vector.length !== (vectors[0]?.length ?? vector.length)) {
          return { ok: false, why: 'malformed' };
        }
        vectors.push(vector);
      }
      return { ok: true, vectors };
    },
  };
}
