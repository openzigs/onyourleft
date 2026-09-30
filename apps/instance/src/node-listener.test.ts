// SPDX-License-Identifier: AGPL-3.0-or-later

import { connect } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import type { Handler } from './handler.ts';
import {
  clientAddress,
  listen,
  REQUEST_ORIGIN,
  requestUrl,
  type Listening,
} from './node-listener.ts';

/**
 * The Node adapter's own two promises (#841): a request-target cannot move the
 * URL's origin, and a response is pulled no faster than the client reads it.
 * Both are about bytes on the wire that `fetch` will not send — it normalises
 * a target and reads every response — so these speak HTTP over a raw socket.
 */

let running: Listening | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

/** A listener whose one answer is the URL the handler was handed. */
async function echoUrl(): Promise<Listening> {
  const handler: Handler = (request) => {
    const url = new URL(request.url);
    return Promise.resolve(
      Response.json({ host: url.host, path: url.pathname, query: url.search }),
    );
  };
  running = await listen(handler, { host: '127.0.0.1', port: 0 });
  return running;
}

/** Send one raw request line, and read the whole response as text. */
function raw(listening: Listening, target: string): Promise<string> {
  const { hostname, port } = new URL(listening.url);
  return new Promise((resolve, reject) => {
    const socket = connect(Number(port), hostname, () => {
      socket.write(`GET ${target} HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n`);
    });
    let text = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => (text += chunk));
    socket.on('end', () => resolve(text));
    socket.on('error', reject);
  });
}

/** The body of a raw response, with any chunked framing taken off. */
function bodyOf(response: string): unknown {
  const split = response.indexOf('\r\n\r\n');
  let body = response.slice(split + 4);
  if (/^transfer-encoding: chunked$/im.test(response.slice(0, split))) {
    let text = '';
    for (;;) {
      const lineEnd = body.indexOf('\r\n');
      const size = Number.parseInt(body.slice(0, lineEnd), 16);
      if (size === 0) break;
      text += body.slice(lineEnd + 2, lineEnd + 2 + size);
      body = body.slice(lineEnd + 2 + size + 2);
    }
    body = text;
  }
  return JSON.parse(body) as unknown;
}

describe('the request-target cannot move the origin (#841)', () => {
  it('reads `//evil.example/…` as a path on the constant origin, not as a host', async () => {
    const response = await raw(await echoUrl(), '//evil.example/health');
    expect(bodyOf(response)).toEqual({
      host: 'instance.invalid',
      path: '//evil.example/health',
      query: '',
    });
  });

  it('keeps only the path and query of an absolute-form target', async () => {
    const response = await raw(await echoUrl(), 'http://evil.example/health?x=1');
    expect(bodyOf(response)).toEqual({ host: 'instance.invalid', path: '/health', query: '?x=1' });
  });

  it('ignores the Host header, as it always did', async () => {
    const response = await raw(await echoUrl(), '/health');
    expect(bodyOf(response)).toEqual({ host: 'instance.invalid', path: '/health', query: '' });
  });

  it('refuses a target in neither form as validation_failed', async () => {
    const response = await raw(await echoUrl(), '*');
    expect(response.startsWith('HTTP/1.1 400 ')).toBe(true);
    expect(bodyOf(response)).toMatchObject({ error: { code: 'validation_failed' } });
  });

  it('builds every URL on REQUEST_ORIGIN', () => {
    for (const target of [
      '/',
      '//a.example/b',
      'https://a.example/b?c',
      '/@a.example',
      undefined,
    ]) {
      expect(requestUrl(target).origin).toBe(REQUEST_ORIGIN);
    }
    expect(() => requestUrl('ftp://a.example/b')).toThrow();
  });
});

describe('a response is pulled no faster than the client reads it (#841)', () => {
  it('ends a response that has no body', async () => {
    running = await listen(() => Promise.resolve(new Response(null, { status: 204 })), {
      host: '127.0.0.1',
      port: 0,
    });
    const response = await raw(running, '/');
    expect(response.startsWith('HTTP/1.1 204 ')).toBe(true);
  });

  it('stops pulling a long body while the client is not reading', async () => {
    const CHUNK_BYTES = 16 * 1024;
    const CHUNKS = 4096; // 64 MiB, far past any socket buffer
    let pulls = 0;
    const handler: Handler = () =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              pulls += 1;
              if (pulls > CHUNKS) controller.close();
              else controller.enqueue(new Uint8Array(CHUNK_BYTES));
            },
          }),
        ),
      );
    running = await listen(handler, { host: '127.0.0.1', port: 0 });
    const { hostname, port } = new URL(running.url);
    const socket = connect(Number(port), hostname, () => {
      socket.write('GET / HTTP/1.1\r\nHost: x\r\n\r\n');
    });
    // Read nothing: a paused socket leaves the kernel buffers to fill, and then
    // the server's writes stop draining.
    socket.pause();
    await new Promise((resolve) => setTimeout(resolve, 500));
    const pulledWhileStalled = pulls;
    socket.destroy();
    // Loopback socket buffers hold a few MiB; unbounded buffering pulls all 64.
    expect(pulledWhileStalled).toBeGreaterThan(0);
    expect(pulledWhileStalled).toBeLessThan(CHUNKS / 2);
  });
});

describe('the client address behind a proxy — #895 review B3', () => {
  const behindTheTunnel = (headers: Record<string, string | string[]>) => ({
    headers,
    socket: { remoteAddress: '172.18.0.3' } as never,
  });

  it('is the peer unless the operator named a header', () => {
    expect(clientAddress(behindTheTunnel({ 'cf-connecting-ip': '203.0.113.9' }), undefined)).toBe(
      '172.18.0.3',
    );
  });

  it('is the named header’s address when the operator named one', () => {
    expect(
      clientAddress(behindTheTunnel({ 'cf-connecting-ip': ' 203.0.113.9 ' }), 'cf-connecting-ip'),
    ).toBe('203.0.113.9');
  });

  it('falls back to the peer for a header that is missing, empty, repeated or a list', () => {
    const cases: Record<string, string | string[]>[] = [
      {},
      { 'cf-connecting-ip': '' },
      { 'cf-connecting-ip': ['203.0.113.9', '198.51.100.1'] },
      { 'cf-connecting-ip': '203.0.113.9, 198.51.100.1' },
    ];
    for (const headers of cases) {
      expect(clientAddress(behindTheTunnel(headers), 'cf-connecting-ip')).toBe('172.18.0.3');
    }
  });

  it('gives two riders behind one proxy two rate-limit buckets, through the real listener', async () => {
    const seen: (string | null)[] = [];
    const listening = await listen(
      (_request, client) => {
        seen.push(client?.address ?? null);
        return Promise.resolve(new Response('ok'));
      },
      { host: '127.0.0.1', port: 0, clientAddressHeader: 'cf-connecting-ip' },
    );
    try {
      for (const address of ['203.0.113.9', '198.51.100.1']) {
        await fetch(`${listening.url}/health`, { headers: { 'cf-connecting-ip': address } });
      }
    } finally {
      await listening.close();
    }
    expect(seen).toEqual(['203.0.113.9', '198.51.100.1']);
  });
});
