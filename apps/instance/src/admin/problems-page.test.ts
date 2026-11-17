// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The admin Recent problems page (#2651, ADR 0069 D-2), driven through the
 * REAL handler: problems are logged through the instance's REAL log sink —
 * the one whose redaction writes standard output — and the page is held to
 * what `GET /v1/operate/logs` answers the owner's SEALED request in the same
 * test. The page adds no redaction of its own and no second source, so it is
 * held to the route's: a marker logged before redaction must be absent.
 */

import { problemSentence } from '@onyourleft/operate-text';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { escapeHtml } from '../html.ts';
import { logEvent, logRequest, logUnhandled } from '../log.ts';
import { secretBytes } from '../keys/instance-keys-testing.ts';
import { startModerationWorld, type ModerationWorld } from '../moderation/moderation-testing.ts';
import { adminCode } from '../operator/commands.ts';
import { json, type Route } from '../route-kit.ts';
import { ROUTES } from '../routes.ts';
import { signInWith, adminRequest } from './admin-testing.ts';

let worlds: ModerationWorld[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(worlds.map((each) => each.close()));
  worlds = [];
});

async function world(routes?: readonly Route[]): Promise<ModerationWorld> {
  const made = await startModerationWorld({
    admin: {},
    ...(routes === undefined ? {} : { routes }),
  });
  worlds.push(made);
  return made;
}

async function codeSession(made: ModerationWorld): Promise<{ token: string; code: string }> {
  const { code } = await adminCode(
    { database: made.path, blobs: `${made.path}.blobs` },
    () => new Date(made.clock.ms),
  );
  return { token: await signInWith(made.instance.handler, code), code };
}

async function page(made: ModerationWorld, token: string): Promise<string> {
  const answer = await made.instance.handler(
    adminRequest('GET', '/admin/problems', { cookie: token }),
  );
  expect(answer.status).toBe(200);
  return answer.text();
}

interface LogsBody {
  readonly since: string;
  readonly lines: readonly { readonly at: string; readonly line: string }[];
}

/** The problem lines as the app's panel reads them: sealed, through the real route. */
async function logs(made: ModerationWorld): Promise<LogsBody> {
  const read = await made.as(made.owner, 'GET', '/v1/operate/logs');
  expect(read.status).toBe(200);
  return read.body as LogsBody;
}

/** Each line as the page draws it: its sentence, and the line itself, escaped. */
function drawn(html: string): { sentence: string; line: string }[] {
  const list = /<ol class="log problems">([\s\S]*?)<\/ol>/.exec(html)?.[1] ?? '';
  return [
    ...list.matchAll(/<p><strong>[^<]*<\/strong>: ([^<]*)<\/p>[\s\S]*?<code>([^<]*)<\/code>/g),
  ].map(([, sentence, line]) => ({ sentence: sentence ?? '', line: line ?? '' }));
}

const expected = (body: LogsBody) =>
  body.lines.map((each) => ({
    sentence: escapeHtml(problemSentence(JSON.parse(each.line) as Record<string, unknown>)),
    line: escapeHtml(each.line),
  }));

describe('the Recent problems page is the route’s answer, read again on every load (#2651)', () => {
  it('shows three problems logged through the real sink newest first, as the route answers them; a fourth appears on a reload', async () => {
    const made = await world();
    const { token } = await codeSession(made);
    logEvent(made.instance.log, 'room-worker-died', { worker: 0, roomsLost: 2 });
    logRequest(made.instance.log, {
      method: 'GET',
      route: '/v1/rooms',
      status: 503,
      ms: 4,
    });
    logUnhandled(made.instance.log, '/v1/sync', new TypeError('broke'));
    const first = await page(made, token);
    const answered = await logs(made);
    expect(answered.lines).toHaveLength(3);
    expect(drawn(first)).toEqual(expected(answered));
    // Newest first: the unhandled error, then the 503, then the worker.
    expect(drawn(first).map((each) => each.sentence)).toEqual([
      escapeHtml('A request to /v1/sync failed inside the instance (TypeError).'),
      escapeHtml('A request to /v1/rooms was answered 503.'),
      escapeHtml('A room worker stopped, and the 2 rooms on it were lost.'),
    ]);

    logEvent(made.instance.log, 'voice-failed', { code: 'channel' });
    const reloaded = await page(made, token);
    expect(drawn(reloaded)).toEqual(expected(await logs(made)));
    expect(drawn(reloaded)).toHaveLength(4);
    expect(drawn(reloaded)[0]?.sentence).toBe(escapeHtml('A request to Discord failed (channel).'));
  });

  it('says there is no problem since the instance started, and that it could not read them when the answer is not in its shape', async () => {
    const made = await world();
    const { token } = await codeSession(made);
    expect(await page(made, token)).toContain('No problem since the instance last started');
    const broken = await world(
      ROUTES.map((route) =>
        route.path === '/v1/operate/logs'
          ? { ...route, handle: () => Promise.resolve(json({ since: 1, lines: [] })) }
          : route,
      ),
    );
    expect(await page(broken, (await codeSession(broken)).token)).toContain(
      'The recent problems could not be read from the instance',
    );
  });
});

describe('the page is held to the route’s redaction, not trusted to repeat it (#2651, CLAUDE.md §6)', () => {
  it('draws a line carrying a marker secret, a marker token and a coordinate only as the route redacted it', async () => {
    vi.stubEnv('OYL_INSTANCE_METRICS_TOKEN', 'MARKER-metrics-token-2651-0123456789abcdef');
    vi.stubEnv('CLOUDFLARE_TUNNEL_TOKEN', 'MARKER-tunnel-token-2651');
    const made = await world();
    const { token, code } = await codeSession(made);
    const hostedKey = 'sk-MARKER-hosted-key-2651';
    logEvent(made.instance.log, 'voice-failed', {
      code: 'channel',
      token: made.owner.token,
      hostedKey,
      sessionToken: token,
      lat: 51.50735,
      lon: -0.12776,
    });
    logUnhandled(
      made.instance.log,
      '/v1/rooms',
      new Error(`the rider at 51.50735,-0.12776 held ${hostedKey}`),
    );
    const html = await page(made, token);
    expect(drawn(html)).toEqual(expected(await logs(made)));
    expect(html).toContain('[redacted]');
    for (const marker of [
      made.owner.token,
      hostedKey,
      token,
      code,
      'MARKER-metrics-token-2651',
      'MARKER-tunnel-token-2651',
      btoa(String.fromCharCode(...secretBytes(7))),
      '51.50735',
      '0.12776',
    ]) {
      expect(html, marker).not.toContain(marker);
    }
  });

  it('shows a line holding markup as text, escaped', async () => {
    const made = await world();
    const { token } = await codeSession(made);
    logEvent(made.instance.log, 'request', {
      method: 'GET',
      route: '/v1/<script>alert(1)</script>',
      status: 500,
    });
    const answered = await logs(made);
    // The route keeps it as written: the page, not the route, is what escapes it here.
    expect(answered.lines[0]?.line).toContain('<script>');
    const html = await page(made, token);
    expect(html).not.toMatch(/<script>alert/);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    const answer = await made.instance.handler(
      adminRequest('GET', '/admin/problems', { cookie: token }),
    );
    expect(answer.headers.get('content-security-policy')).not.toContain('unsafe-inline');
  });
});
