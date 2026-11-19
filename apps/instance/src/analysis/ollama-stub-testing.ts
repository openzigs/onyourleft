// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A stub Ollama server**, for the tests of what the local server offers
 * (#2610). Never shipped, and it listens on loopback alone, on a port the
 * operating system chooses.
 *
 * It answers `GET /api/version`, `GET /api/tags`, `GET /api/ps` and
 * `POST /api/show` (and, given `chat`, `POST /api/chat`) from the committed fixtures in `testing/ollama-*.json` —
 * made by hand from Ollama's API reference, never captured from a real
 * server — and, with `ollama: false`, answers none of those and serves
 * `GET /v1/models` as an OpenAI-compatible server does. It records every
 * request's method, path and body.
 *
 * Since #2792 it can also download and load, as the setup's AI step asks:
 * given `pull`, `POST /api/pull` streams the lines scripted for it, and a
 * download that ends in `success` adds the model to `/api/tags`; given
 * `load`, `POST /api/generate` adds the model to `/api/ps`; and given
 * `completions`, it answers `POST /v1/chat/completions`, which is what a job
 * on the chosen model sends.
 */

import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** A committed fixture, parsed. */
export function ollamaFixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./testing/${name}`, import.meta.url), 'utf8')) as unknown;
}

export interface OllamaStubOptions {
  /** `false`: a server that is not Ollama, answering `/v1/models` alone. */
  readonly ollama?: boolean;
  readonly version?: unknown;
  readonly tags?: unknown;
  readonly ps?: unknown;
  /** `/api/show`'s answer for each model, by name. */
  readonly show?: Readonly<Record<string, unknown>>;
  /** `/v1/models`'s answer, for `ollama: false`. */
  readonly models?: unknown;
  /** An answer of this many bytes to `/api/tags`, for the bound on what is read. */
  readonly tagsBytes?: number;
  /** `POST /api/chat`'s answer to each body it is sent (#2709's tactics calls). Absent, a 404. */
  readonly chat?: (body: unknown) => unknown;
  /** `POST /api/pull`'s answer to each body it is sent (#2792). Absent, a 404. */
  readonly pull?: (body: unknown) => ScriptedPull;
  /** `POST /api/generate`: the `/api/ps` entry `model` is listed with once loaded (#2792). Absent, a 404. */
  readonly load?: (model: string) => unknown;
  /** `POST /v1/chat/completions`'s answer to each body it is sent (#2792). Absent, a 404. */
  readonly completions?: (body: unknown) => unknown;
}

/** One scripted download: the lines streamed, a wait in the middle, and what `/api/tags` then lists. */
export interface ScriptedPull {
  /** The HTTP status: 200 unless given. */
  readonly status?: number;
  /** Each a JSON line — or, a string, written as it is. */
  readonly lines: readonly unknown[];
  /** Waited for after `lines`, before `then`: how a test sees a download that is running. */
  readonly hold?: Promise<void>;
  readonly then?: readonly unknown[];
  /** The `/api/tags` entry added once every line is written. */
  readonly adds?: unknown;
}

export interface OllamaStub {
  /** The loopback port it listens on: the settings hold `http://<name>:<port>/v1`. */
  readonly port: number;
  readonly requests: { method: string; path: string; body: unknown }[];
  readonly close: () => Promise<void>;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

/** The fixtures of a current server: three models, one loaded whole, one in part, one not at all. */
export const CURRENT_SERVER: OllamaStubOptions = {
  version: ollamaFixture('ollama-version.json'),
  tags: ollamaFixture('ollama-tags.json'),
  ps: ollamaFixture('ollama-ps.json'),
  show: ollamaFixture('ollama-show.json') as Record<string, unknown>,
};

/** The fixtures of an older server: no `capabilities`, no `size_vram`. */
export const OLDER_SERVER: OllamaStubOptions = {
  version: ollamaFixture('ollama-version.json'),
  tags: ollamaFixture('ollama-tags.json'),
  ps: ollamaFixture('ollama-ps-older.json'),
  show: ollamaFixture('ollama-show-older.json') as Record<string, unknown>,
};

export async function startOllamaStub(options: OllamaStubOptions): Promise<OllamaStub> {
  const requests: OllamaStub['requests'] = [];
  const isOllama = options.ollama !== false;
  // What a download and a load added since the stub started.
  const pulled: unknown[] = [];
  const loaded: unknown[] = [];
  const withAdded = (listed: unknown, added: readonly unknown[]): unknown =>
    added.length === 0
      ? listed
      : { models: [...((listed as { models?: unknown[] } | undefined)?.models ?? []), ...added] };
  const server: Server = createServer((request, response) => {
    void readBody(request).then((text) => {
      let body: unknown;
      try {
        body = text === '' ? null : (JSON.parse(text) as unknown);
      } catch {
        body = text;
      }
      const path = request.url ?? '';
      requests.push({ method: request.method ?? '', path, body });
      const send = (status: number, value: unknown): void => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(value));
      };
      const key = `${request.method ?? ''} ${path}`;
      if (isOllama && key === 'GET /api/version') return send(200, options.version);
      if (isOllama && key === 'GET /api/tags') {
        if (options.tagsBytes !== undefined) {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(`{"models":[],"pad":"${'x'.repeat(options.tagsBytes)}"}`);
          return;
        }
        return send(200, withAdded(options.tags, pulled));
      }
      if (isOllama && key === 'GET /api/ps') return send(200, withAdded(options.ps, loaded));
      if (isOllama && key === 'POST /api/pull' && options.pull !== undefined) {
        const scripted = options.pull(body);
        const line = (each: unknown): string =>
          typeof each === 'string' ? each : `${JSON.stringify(each)}\n`;
        response.writeHead(scripted.status ?? 200, { 'content-type': 'application/x-ndjson' });
        for (const each of scripted.lines) response.write(line(each));
        void (scripted.hold ?? Promise.resolve()).then(() => {
          for (const each of scripted.then ?? []) response.write(line(each));
          if (scripted.adds !== undefined) pulled.push(scripted.adds);
          response.end();
        });
        return;
      }
      if (isOllama && key === 'POST /api/generate' && options.load !== undefined) {
        const name = (body as { model?: unknown } | null)?.model;
        if (typeof name === 'string') loaded.push(options.load(name));
        return send(200, { model: name, response: '', done: true });
      }
      if (key === 'POST /v1/chat/completions' && options.completions !== undefined) {
        return send(200, options.completions(body));
      }
      if (isOllama && key === 'POST /api/chat' && options.chat !== undefined) {
        return send(200, options.chat(body));
      }
      if (isOllama && key === 'POST /api/show') {
        const name = (body as { model?: unknown } | null)?.model;
        const shown = typeof name === 'string' ? options.show?.[name] : undefined;
        return shown === undefined
          ? send(404, { error: `model '${String(name)}' not found` })
          : send(200, shown);
      }
      if (!isOllama && key === 'GET /v1/models') return send(200, options.models);
      return send(404, { error: 'not found' });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    port,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
