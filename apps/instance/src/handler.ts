// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Config } from './config.ts';
import { errorResponse } from './errors.ts';
import { logRequest, logUnhandled, type LogSink } from './log.ts';
import { openApiDocument } from './openapi.ts';
import { ROUTES, type Route } from './routes.ts';

/**
 * The instance, as ONE fetch-style function: `Request → Response` (#767,
 * ADR 0037 D-2).
 *
 * Nothing here names Node. `node-listener.ts` is the thin adapter that turns a
 * Node HTTP request into a `Request` and a `Response` back into bytes, and a
 * Durable Object (#781) or any other runtime that speaks WHATWG fetch mounts
 * this same function unchanged. `handler.test.ts` runs a request through each
 * adapter that exists.
 *
 * ## The order a request is answered in
 *
 * 1. **The body's size**, before anything else reads it. A request that
 *    declares more than the limit is refused on its `content-length`; one that
 *    declares nothing is read up to the limit and refused at the first byte
 *    past it — never buffered whole first. So a stranger cannot make the
 *    instance hold an unbounded upload in memory by leaving the header off.
 * 2. **The route**, by path: none is `not_found`; a path with no route for the
 *    method is `method_not_allowed` with an `Allow` header.
 * 3. **The route's own answer**, and anything it throws is `internal` in the
 *    one error shape — no message, no stack, no path (#36, ADR 0004 D) — while
 *    the log gets the error's name alone (`log.ts`).
 */

export type Handler = (request: Request) => Promise<Response>;

export interface HandlerOptions {
  readonly config: Config;
  readonly version: string;
  readonly notices: string;
  readonly log: LogSink;
  /** The route table. The production one unless a test hands its own. */
  readonly routes?: readonly Route[];
  /** Milliseconds, for the log's duration. */
  readonly now?: () => number;
}

/** Headers every response carries, whatever produced it. */
const ALWAYS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

/** Past the limit: the request is refused rather than read further. */
const TOO_LARGE = Symbol('too large');

/**
 * The body's bytes, reading at most `limit + 1` of them, or {@link TOO_LARGE}.
 * `null` when the request has no body.
 */
async function boundedBody(
  request: Request,
  limit: number,
): Promise<Uint8Array | null | typeof TOO_LARGE> {
  const declared = request.headers.get('content-length');
  if (declared !== null && /^[0-9]+$/.test(declared) && Number(declared) > limit) return TOO_LARGE;
  if (request.body === null) return null;
  // `@types/node` types a request body as `ReadableStream<any>`; a WHATWG body is bytes.
  const reader = (request.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let read = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      read += value.byteLength;
      if (read > limit) return TOO_LARGE;
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const body = new Uint8Array(read);
  let at = 0;
  for (const chunk of chunks) {
    body.set(chunk, at);
    at += chunk.byteLength;
  }
  return body;
}

function withHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(ALWAYS)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function createHandler(options: HandlerOptions): Handler {
  const routes = options.routes ?? ROUTES;
  const now = options.now ?? (() => performance.now());
  const specification = openApiDocument(routes);

  return async (request) => {
    const started = now();
    let route: Route | undefined;
    let response: Response;
    try {
      const url = new URL(request.url);
      const body = await boundedBody(request, options.config.bodyLimitBytes);
      if (body === TOO_LARGE) {
        response = errorResponse('payload_too_large');
      } else {
        const atPath = routes.filter((candidate) => candidate.path === url.pathname);
        route = atPath.find((candidate) => candidate.method === request.method);
        if (route !== undefined) {
          response = await route.handle({
            request,
            url,
            body,
            config: options.config,
            version: options.version,
            notices: options.notices,
            specification,
          });
        } else if (atPath.length > 0) {
          response = errorResponse('method_not_allowed', {
            headers: { allow: atPath.map((candidate) => candidate.method).join(', ') },
          });
        } else {
          response = errorResponse('not_found');
        }
      }
    } catch (error) {
      logUnhandled(options.log, route?.path ?? null, error);
      response = errorResponse('internal');
    }
    logRequest(options.log, {
      method: request.method,
      route: route?.path ?? null,
      status: response.status,
      ms: now() - started,
    });
    return withHeaders(response);
  };
}
