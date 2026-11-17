// SPDX-License-Identifier: AGPL-3.0-or-later

import { createServer } from 'node:http';

/**
 * **Which cookie a browser keeps on `http://localhost`** (#2643, ADR 0069
 * D-4): the measurement the admin pages' loopback listener chose its cookie
 * name by. It serves `http://localhost:<port>/set`, which sets three cookies
 * as the admin session's would be set —
 *
 * - `__Host-probe`, `Secure; HttpOnly; SameSite=Strict; Path=/`;
 * - `secure-probe`, the same without the prefix;
 * - `plain-probe`, `HttpOnly; SameSite=Strict; Path=/`, no `Secure`;
 *
 * — and `/read`, which answers which of them the browser sent back.
 *
 * `node apps/instance/tools/admin-cookie-probe.ts [port]` (8788 unless told),
 * then open `http://localhost:<port>/set` in the browser to measure, follow
 * the link to `/read`, and write down the browser, its version and the line
 * it shows. The figures measured are in `docs/operating-an-instance.md`
 * §"Admin pages on the server machine". Nothing here is served by the
 * instance.
 */

const port = Number(process.argv[2] ?? '8788');
const NAMES = ['__Host-probe', 'secure-probe', 'plain-probe'] as const;

createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-type', 'text/html; charset=utf-8');
  if (path === '/set') {
    response.setHeader('set-cookie', [
      '__Host-probe=1; Secure; HttpOnly; SameSite=Strict; Path=/',
      'secure-probe=1; Secure; HttpOnly; SameSite=Strict; Path=/',
      'plain-probe=1; HttpOnly; SameSite=Strict; Path=/',
    ]);
    response.end('<!doctype html><title>set</title><a href="/read">Read them back</a>');
    return;
  }
  const sent = new Set(
    (request.headers.cookie ?? '').split(';').map((part) => part.split('=')[0]?.trim()),
  );
  const kept = NAMES.map((name) => `${name}=${sent.has(name) ? 'kept' : 'not kept'}`).join(' ');
  response.end(`<!doctype html><title>read</title><p id="kept">${kept}</p>`);
}).listen(port, '127.0.0.1', () => {
  process.stdout.write(`open http://localhost:${String(port)}/set\n`);
});
