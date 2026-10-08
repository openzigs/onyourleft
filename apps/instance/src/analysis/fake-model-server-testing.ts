// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A fake OpenAI-compatible model server**, for tests only (#1096). Never
 * shipped, and it listens on loopback and nowhere else, on a port the
 * operating system chooses.
 *
 * It serves `POST /v1/chat/completions` (non-streaming, which is what one
 * agent turn asks for) from a SCRIPT: each request takes the next
 * {@link ScriptedReply}. When the script runs out, every further request is
 * answered 500, so a test that asked more than it scripted goes red rather
 * than hanging. It records every request's parsed body and the sockets a
 * client closed before it answered, which is how a test sees an abort reach
 * the wire.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** One tool call the fake model makes. `arguments` is sent exactly as given, JSON or not. */
export interface ScriptedCall {
  readonly name: string;
  readonly arguments: string;
}

export type ScriptedReply =
  /** A plain reply. `finish: 'length'` is a reply cut off by its token bound. */
  | {
      readonly kind: 'text';
      readonly text: string;
      readonly finish?: 'stop' | 'length';
      readonly usage?: { readonly prompt: number; readonly completion: number };
    }
  | { readonly kind: 'tool-calls'; readonly calls: readonly ScriptedCall[] }
  /** An HTTP error with this body, as a server would send it. */
  | { readonly kind: 'status'; readonly status: number; readonly body: string }
  /** Wait, then answer with `then` — unless the client goes first. */
  | { readonly kind: 'slow'; readonly milliseconds: number; readonly then: ScriptedReply };

/** The 400 Ollama answers for a model with no tool support (its message, as #795's research read it). */
export const WITHOUT_TOOLS_REPLY: ScriptedReply = {
  kind: 'status',
  status: 400,
  body: JSON.stringify({
    error: {
      message: 'registry.ollama.ai/library/scripted:latest does not support tools',
      type: 'api_error',
    },
  }),
};

export interface FakeModelServer {
  /** The OpenAI-compatible base URL: `http://127.0.0.1:<port>/v1`. */
  readonly baseUrl: URL;
  /** Every request's parsed body, in order. */
  readonly requests: Record<string, unknown>[];
  /** Every request's path, in order. */
  readonly paths: string[];
  /** How many requests the client abandoned before an answer. */
  closedEarly: number;
  /** Replies still to give. */
  readonly script: ScriptedReply[];
  readonly close: () => Promise<void>;
}

function completion(reply: Extract<ScriptedReply, { kind: 'text' | 'tool-calls' }>, n: number) {
  const message =
    reply.kind === 'text'
      ? { role: 'assistant', content: reply.text }
      : {
          role: 'assistant',
          content: null,
          tool_calls: reply.calls.map((call, index) => ({
            id: `call_${String(n)}_${String(index)}`,
            type: 'function',
            function: { name: call.name, arguments: call.arguments },
          })),
        };
  const usage =
    reply.kind === 'text' && reply.usage !== undefined
      ? reply.usage
      : { prompt: 100, completion: 20 };
  return {
    id: `chatcmpl-${String(n)}`,
    object: 'chat.completion',
    created: 1_790_000_000,
    model: 'scripted',
    choices: [
      {
        index: 0,
        message,
        finish_reason:
          reply.kind === 'tool-calls'
            ? 'tool_calls'
            : reply.finish === 'length'
              ? 'length'
              : 'stop',
      },
    ],
    usage: {
      prompt_tokens: usage.prompt,
      completion_tokens: usage.completion,
      total_tokens: usage.prompt + usage.completion,
    },
  };
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

/** Start a fake model server on loopback with this script. */
export async function startFakeModelServer(
  script: readonly ScriptedReply[] = [],
): Promise<FakeModelServer> {
  const remaining = [...script];
  const timers = new Set<NodeJS.Timeout>();
  let answered = 0;
  const fake: FakeModelServer = {
    baseUrl: new URL('http://127.0.0.1/v1'),
    requests: [],
    paths: [],
    closedEarly: 0,
    script: remaining,
    close: () => Promise.resolve(),
  };

  const answer = (response: ServerResponse, reply: ScriptedReply | undefined): void => {
    if (reply === undefined) {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end('{"error":{"message":"the fake model server ran out of script"}}');
      return;
    }
    switch (reply.kind) {
      case 'status':
        response.writeHead(reply.status, { 'content-type': 'application/json' });
        response.end(reply.body);
        return;
      case 'slow': {
        const timer = setTimeout(() => {
          timers.delete(timer);
          if (!response.destroyed) answer(response, reply.then);
        }, reply.milliseconds);
        timers.add(timer);
        return;
      }
      default:
        answered += 1;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(completion(reply, answered)));
    }
  };

  const server: Server = createServer((request, response) => {
    let done = false;
    response.on('finish', () => {
      done = true;
    });
    response.on('close', () => {
      if (!done) fake.closedEarly += 1;
    });
    void readBody(request).then((text) => {
      fake.paths.push(request.url ?? '');
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(text) as Record<string, unknown>;
      } catch {
        // Recorded empty: a test reads what was asked, and this was not JSON.
      }
      fake.requests.push(body);
      if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
        response.writeHead(404);
        response.end();
        return;
      }
      answer(response, remaining.shift());
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const opened = fake as { baseUrl: URL; close: () => Promise<void> };
  opened.baseUrl = new URL(`http://127.0.0.1:${String(port)}/v1`);
  opened.close = () =>
    new Promise<void>((resolve) => {
      for (const timer of timers) clearTimeout(timer);
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return fake;
}
