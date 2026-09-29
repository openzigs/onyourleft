// SPDX-License-Identifier: AGPL-3.0-or-later

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

import { errorResponse } from './errors.ts';
import type { Handler } from './handler.ts';

/**
 * The Node adapter: a `node:http` server in front of the fetch-style handler,
 * and nothing else (#767, ADR 0037 D-2).
 *
 * It translates and decides nothing. Every rule — the body limit, the routes,
 * the error shape, the log — is the handler's, so a second adapter (#781)
 * cannot disagree with this one about any of them.
 *
 * ⚠️ **The request URL's origin is a constant, not the `Host` header.** The
 * handler routes on the path alone, and a `Host` a client typed has no business
 * in anything the instance builds; `instance.invalid` (RFC 2606) is a name that
 * resolves nowhere, so a URL built from it that leaked into a response would be
 * visibly wrong rather than plausibly someone's.
 *
 * ⚠️ **And the request-target cannot move it** (#841). Until then the target
 * was RESOLVED against the constant, so `//evil.example/health` and the
 * absolute form `http://evil.example/health` both came out with the host
 * `evil.example` — harmless while nothing builds a link from the URL, host
 * injection the day something does. {@link requestUrl} appends an origin-form
 * target to the origin as text, so `//evil.example/health` is a PATH; keeps
 * only the path and query of an absolute-form one, which RFC 9112 §3.2.2 says a
 * server must accept; and refuses anything else (`*`) as `validation_failed`.
 *
 * ⚠️ **The body is streamed to the handler, not buffered here**, so the
 * handler's size limit is the only one and it bounds what is read. **And the
 * response is streamed to the client with backpressure** (#841): a client that
 * stops reading stops the response being pulled, rather than Node buffering
 * the whole of it.
 */

/** The origin every request URL is built on. */
export const REQUEST_ORIGIN = 'http://instance.invalid';

/** The URL a request-target names, on {@link REQUEST_ORIGIN} whatever the target says. Throws on any other form. */
export function requestUrl(target: string | undefined): URL {
  const text = target ?? '/';
  if (text.startsWith('/')) return new URL(`${REQUEST_ORIGIN}${text}`);
  const absolute = new URL(text);
  if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') {
    throw new TypeError('not an http request-target');
  }
  return new URL(`${REQUEST_ORIGIN}${absolute.pathname}${absolute.search}`);
}

function requestFrom(incoming: IncomingMessage): Request {
  const method = incoming.method ?? 'GET';
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (value === undefined) continue;
    for (const one of Array.isArray(value) ? value : [value]) headers.append(name, one);
  }
  const hasBody = method !== 'GET' && method !== 'HEAD';
  return new Request(requestUrl(incoming.url), {
    method,
    headers,
    ...(hasBody
      ? { body: Readable.toWeb(incoming) as ReadableStream<Uint8Array>, duplex: 'half' }
      : {}),
  });
}

async function send(response: Response, outgoing: ServerResponse): Promise<void> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  outgoing.writeHead(response.status, headers);
  if (response.body === null) {
    outgoing.end();
    return;
  }
  // `pipeline` waits on `drain`, so the body is pulled no faster than the client reads.
  await pipeline(Readable.fromWeb(response.body as WebReadableStream<Uint8Array>), outgoing);
}

/** A running listener: where it is, and how to stop it. */
export interface Listening {
  readonly server: Server;
  /** `http://host:port`, with the port the operating system chose when asked for 0. */
  readonly url: string;
  readonly close: () => Promise<void>;
}

/** Start listening. Port 0 asks the operating system for a free one, which is what the tests do. */
export function listen(
  handler: Handler,
  { host, port }: { readonly host: string; readonly port: number },
): Promise<Listening> {
  const server = createServer((incoming, outgoing) => {
    let request: Request;
    try {
      request = requestFrom(incoming);
    } catch {
      send(errorResponse('validation_failed'), outgoing).catch(() => outgoing.destroy());
      return;
    }
    handler(request)
      .catch(() => errorResponse('internal'))
      .then((response) => send(response, outgoing))
      .catch(() => outgoing.destroy());
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      const address = server.address() as AddressInfo;
      const shown = address.family === 'IPv6' ? `[${address.address}]` : address.address;
      resolve({
        server,
        url: `http://${shown}:${String(address.port)}`,
        close: () =>
          new Promise<void>((done, failed) => {
            server.close((error) => (error === undefined ? done() : failed(error)));
            server.closeAllConnections();
          }),
      });
    });
  });
}
