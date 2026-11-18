// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A card-and-code QR is a loopback thing, and the tunnel serves none**
 * (#2783, ADR 0080 D-1, D-3, D-7, ADR 0069 D-2, D-5), through the REAL
 * handler over a real SQLite file.
 *
 * - Every path a claim or an invite QR is served at in ADR 0080 — `/setup`
 *   and anything under it — is `not_found` on the tunnel listener, as a path
 *   with no route is, by every method a browser sends.
 * - No page the tunnel serves, signed in by a code or a passkey, holds the
 *   card, any eight characters of its fingerprint, or a QR drawing. The pages
 *   are DERIVED from `admin-routes.ts` §`ADMIN_ROUTES`, so a page added there
 *   is held to it without an edit here.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { startModerationWorld, type ModerationWorld } from '../moderation/moderation-testing.ts';
import { adminCode } from '../operator/commands.ts';
import { ADMIN_ROUTES } from './admin-routes.ts';
import { adminBrowser, passkeySessionOn, type AdminBrowser } from './admin-testing.ts';

let worlds: ModerationWorld[] = [];
afterEach(async () => {
  await Promise.all(worlds.map((each) => each.close()));
  worlds = [];
});

const PORT = 8788;

async function world(): Promise<ModerationWorld> {
  const made = await startModerationWorld({ admin: { loopbackPort: PORT } });
  worlds.push(made);
  return made;
}

const paths = (made: ModerationWorld) => ({ database: made.path, blobs: `${made.path}.blobs` });
const clockOf = (made: ModerationWorld) => () => new Date(made.clock.ms);

/** A one-time code's session on the tunnel listener. */
async function codeSession(made: ModerationWorld, browser: AdminBrowser): Promise<string> {
  const { code } = await adminCode(paths(made), clockOf(made));
  const answer = await browser.send('POST', '/admin/sign-in', { form: { code } });
  expect(answer.status).toBe(303);
  const token = new RegExp(`^${browser.cookieName}=([^;]*)`).exec(
    answer.headers.get('set-cookie') ?? '',
  )?.[1];
  if (token === undefined) throw new Error('no session cookie');
  return token;
}

/** Every 8-character run of `text`. */
const runsOf = (text: string): string[] =>
  Array.from({ length: text.length - 7 }, (_, at) => text.slice(at, at + 8));

/** The paths ADR 0080 serves its QR codes at, and a few a later page might take. */
const SETUP_PATHS = [
  '/setup',
  '/setup/',
  '/setup/claim',
  '/setup/invite',
  '/setup/qr',
  '/setup.svg',
];

describe('a card-and-code QR never crosses the tunnel listener (#2783)', () => {
  it('every /setup path is not_found on the tunnel, by GET and by POST, signed in or not', async () => {
    const made = await world();
    const through = adminBrowser(made.instance.handler);
    const token = await codeSession(made, through);
    for (const path of SETUP_PATHS) {
      for (const method of ['GET', 'POST'] as const) {
        for (const cookie of [undefined, token]) {
          const answer = await through.send(method, path, cookie === undefined ? {} : { cookie });
          expect(answer.status, `${method} ${path}`).toBe(404);
          const body = (await answer.json()) as { error?: { code?: string } };
          expect(body.error?.code, `${method} ${path}`).toBe('not_found');
        }
      }
    }
  });

  it('no page the tunnel serves holds the card, any 8 characters of its fingerprint, or a QR', async () => {
    const made = await world();
    const shown = await made.instanceKeys.show();
    const fingerprint = shown.fingerprintBase32;
    expect(fingerprint).toMatch(/^[A-Z2-7]{52}$/);
    const pages = ADMIN_ROUTES.filter((route) => route.kind === 'page').map((route) => route.path);
    expect(pages).toContain('/admin/keys');

    const through = adminBrowser(made.instance.handler);
    const tokens = [
      await codeSession(made, through),
      (await passkeySessionOn(through, paths(made), clockOf(made))).token,
    ];
    for (const token of tokens) {
      for (const path of pages) {
        const answer = await through.send('GET', path, { cookie: token });
        expect(answer.status, path).toBe(200);
        const html = await answer.text();
        expect(html, path).not.toContain('oyl-instance:');
        expect(html, path).not.toContain('data-oyl-qr');
        expect(html, path).not.toContain('<svg class="qr"');
        for (const run of runsOf(fingerprint)) expect(html, `${path} ${run}`).not.toContain(run);
      }
    }

    // The same session's pages on the server machine do carry the card: the check above can see one.
    const onServer = adminBrowser(made.instance.handler, { loopback: PORT });
    const keys = await onServer.send('GET', '/admin/keys', {
      cookie: (await passkeySessionOn(onServer, paths(made), clockOf(made))).token,
    });
    expect(await keys.text()).toContain(shown.card);
  });
});
