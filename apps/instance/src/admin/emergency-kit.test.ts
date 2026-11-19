// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The emergency kit (#2781, ADR 0080 D-4) through the REAL handler over a
 * real SQLite file: downloaded on the loopback listener only, by a signed-in
 * owner with a passkey and a fresh step-up made for it, once per assertion,
 * and logged as `emergency_kit_downloaded` — read back through the owner's
 * own log route, never through the answer alone. Through the tunnel the kit
 * is not on the Keys page, and its route is a path with no route
 * (`pages.test.ts` holds that for every loopback-only route).
 */

import { afterEach, describe, expect, it } from 'vitest';

import { secretText } from '../analysis/hosted-key-testing.ts';
import { TEST_ORIGIN } from '../auth/identity-testing.ts';
import { escapeHtml } from '../html.ts';
import { startModerationWorld, type ModerationWorld } from '../moderation/moderation-testing.ts';
import { adminCode } from '../operator/commands.ts';
import { EMERGENCY_KIT_FILE_NAME } from '../setup/emergency-kit.ts';
import type { SecretFromFile } from '../setup/secrets.ts';
import {
  adminBrowser,
  passkeySessionOn,
  steppedUpForm,
  type AdminBrowser,
  type PasskeySession,
} from './admin-testing.ts';
import { KIT_BUTTON, KIT_NONE_TEXT, KIT_READS_ONLY_TEXT, KIT_TEXT } from './pages.ts';

let worlds: ModerationWorld[] = [];
afterEach(async () => {
  await Promise.all(worlds.map((each) => each.close()));
  worlds = [];
});

const PORT = 8788;
const SECRET = secretText(42);
const TOKEN = 'b'.repeat(64);
const KIT: readonly SecretFromFile[] = [
  {
    variable: 'OYL_INSTANCE_SECRET_KEY',
    file: 'instance-secret-key',
    text: SECRET,
    generated: true,
  },
  { variable: 'OYL_INSTANCE_METRICS_TOKEN', file: 'metrics-token', text: TOKEN, generated: false },
];

async function world(kitSecrets: readonly SecretFromFile[] = KIT): Promise<ModerationWorld> {
  const made = await startModerationWorld({ admin: { loopbackPort: PORT, kitSecrets } });
  worlds.push(made);
  return made;
}

const paths = (made: ModerationWorld) => ({ database: made.path, blobs: `${made.path}.blobs` });
const clockOf = (made: ModerationWorld) => () => new Date(made.clock.ms);
const loopback = (made: ModerationWorld): AdminBrowser =>
  adminBrowser(made.instance.handler, { loopback: PORT });
const tunnel = (made: ModerationWorld): AdminBrowser => adminBrowser(made.instance.handler);

const passkeySession = (made: ModerationWorld, browser: AdminBrowser): Promise<PasskeySession> =>
  passkeySessionOn(browser, paths(made), clockOf(made));

async function codeSession(made: ModerationWorld, browser: AdminBrowser): Promise<string> {
  const { code } = await adminCode(paths(made), clockOf(made));
  const answer = await browser.send('POST', '/admin/sign-in', { form: { code } });
  const token = new RegExp(`^${browser.cookieName}=([^;]*)`).exec(
    answer.headers.get('set-cookie') ?? '',
  )?.[1];
  if (token === undefined) throw new Error('no session cookie');
  return token;
}

async function keysPage(browser: AdminBrowser, token: string): Promise<string> {
  const answer = await browser.send('GET', '/admin/keys', { cookie: token });
  expect(answer.status).toBe(200);
  return answer.text();
}

/** The kit's form, as the page's script makes it: a step-up for `emergency_kit`, then the form. */
const kitForm = (browser: AdminBrowser, session: PasskeySession) =>
  steppedUpForm(browser, session, 'emergency_kit', {}, { page: '/admin/keys' });

interface LogEntry {
  readonly source: string;
  readonly action: string;
  readonly detail: string | null;
  readonly outcome: string;
}

/** The operator log as the owner reads it, through the real route. */
async function ownersLog(made: ModerationWorld): Promise<{ text: string; entries: LogEntry[] }> {
  const read = await made.as(made.owner, 'GET', '/v1/operate/log?limit=200');
  expect(read.status).toBe(200);
  const entries = (read.body as { entries: LogEntry[] }).entries;
  return { text: JSON.stringify(read.body), entries };
}

const kitEntries = async (made: ModerationWorld) =>
  (await ownersLog(made)).entries
    .filter((entry) => entry.action === 'emergency_kit_downloaded')
    .map(({ source, action, detail, outcome }) => ({ source, action, detail, outcome }));

describe('the emergency kit, downloaded on the server machine (#2781, ADR 0080 D-4)', () => {
  it('in a passkey session, behind a fresh step-up: the secrets, the origin they are bound to and the card, as a file, logged under admin_loopback', async () => {
    const made = await world();
    const browser = loopback(made);
    const session = await passkeySession(made, browser);
    const page = await keysPage(browser, session.token);
    expect(page).toContain(escapeHtml(KIT_TEXT));
    expect(page).toContain('action="/admin/keys/emergency-kit" data-step-up="emergency_kit"');
    expect(page).toContain(escapeHtml(KIT_BUTTON));
    // The page itself never carries a secret: only the downloaded file does.
    expect(page).not.toContain(SECRET);
    expect(page).not.toContain(TOKEN);

    const answer = await browser.send('POST', '/admin/keys/emergency-kit', {
      cookie: session.token,
      form: await kitForm(browser, session),
    });
    expect(answer.status).toBe(200);
    expect(answer.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(answer.headers.get('content-disposition')).toBe(
      `attachment; filename="${EMERGENCY_KIT_FILE_NAME}"`,
    );
    expect(answer.headers.get('cache-control')).toBe('no-store');
    const kit = await answer.text();
    const card = (await made.instanceKeys.show()).card;
    expect(kit.split('\n')).toEqual(
      expect.arrayContaining([
        `OYL_INSTANCE_ORIGIN=${TEST_ORIGIN}`,
        `OYL_INSTANCE_SECRET_KEY=${SECRET}`,
        `OYL_INSTANCE_METRICS_TOKEN=${TOKEN}`,
        card,
      ]),
    );
    // The listener's own address is not what the keys are bound to.
    expect(kit).not.toContain(`localhost:${String(PORT)}`);

    expect(await kitEntries(made)).toEqual([
      {
        source: 'admin_loopback',
        action: 'emergency_kit_downloaded',
        detail: null,
        outcome: 'done',
      },
    ]);
    const log = await ownersLog(made);
    expect(log.text).not.toContain(SECRET);
    expect(log.text).not.toContain(TOKEN);
  });

  it('downloads once per passkey check: the same form sent again is refused, and logged once', async () => {
    const made = await world();
    const browser = loopback(made);
    const session = await passkeySession(made, browser);
    const form = await kitForm(browser, session);
    const first = await browser.send('POST', '/admin/keys/emergency-kit', {
      cookie: session.token,
      form,
    });
    expect(first.status).toBe(200);
    const again = await browser.send('POST', '/admin/keys/emergency-kit', {
      cookie: session.token,
      form,
    });
    expect(again.status).toBe(403);
    expect(await again.text()).not.toContain(SECRET);
    expect(await kitEntries(made)).toHaveLength(1);
  });
});

describe('no kit without a passkey session and a step-up made for it (#2781, ADR 0069 D-4)', () => {
  it('a code session is shown no button, and its POST downloads nothing', async () => {
    const made = await world();
    const browser = loopback(made);
    const token = await codeSession(made, browser);
    const page = await keysPage(browser, token);
    expect(page).toContain(escapeHtml(KIT_READS_ONLY_TEXT));
    expect(page).not.toContain('data-step-up="emergency_kit"');
    const csrf = /name="csrf" value="([0-9a-f]{64})"/.exec(page)?.[1] ?? '';
    const refused = await browser.send('POST', '/admin/keys/emergency-kit', {
      cookie: token,
      form: { csrf },
    });
    expect(refused.status).toBe(403);
    const said = await refused.text();
    expect(said).not.toContain(SECRET);
    // Said for what it is: a code session, not a failed passkey check.
    expect(said).toContain('needs a passkey sign-in');
    expect(await kitEntries(made)).toEqual([]);
  });

  it('a passkey session with no assertion, a step-up for another change, or a field the kit does not take downloads nothing', async () => {
    const made = await world();
    const browser = loopback(made);
    const session = await passkeySession(made, browser);
    const kitPost = (form: Record<string, string>) =>
      browser.send('POST', '/admin/keys/emergency-kit', { cookie: session.token, form });
    const unproved = await kitForm(browser, session);
    const noAssertion = await kitPost({ csrf: unproved.csrf ?? '' });
    const otherChange = await kitPost(
      await steppedUpForm(
        browser,
        session,
        'key_rotate',
        { confirm: 'rotate' },
        { page: '/admin/keys' },
      ),
    );
    const extraField = await kitPost({ ...(await kitForm(browser, session)), confirm: 'rotate' });
    for (const refused of [noAssertion, otherChange, extraField]) {
      expect([400, 403]).toContain(refused.status);
      expect(await refused.text()).not.toContain(SECRET);
    }
    expect(await kitEntries(made)).toEqual([]);
  });
});

describe('with every secret in .env there is no kit (#2781)', () => {
  it('says so on the server machine, and a stepped-up POST downloads nothing and logs nothing', async () => {
    const made = await world([]);
    const browser = loopback(made);
    const session = await passkeySession(made, browser);
    const page = await keysPage(browser, session.token);
    expect(page).toContain(escapeHtml(KIT_NONE_TEXT));
    expect(page).not.toContain('data-step-up="emergency_kit"');
    const answer = await browser.send('POST', '/admin/keys/emergency-kit', {
      cookie: session.token,
      form: await kitForm(browser, session),
    });
    expect(answer.status).toBe(409);
    expect(answer.headers.get('content-disposition')).toBeNull();
    expect(await kitEntries(made)).toEqual([]);
  });
});

describe('through the tunnel the kit is not offered (#2781, ADR 0080 D-4)', () => {
  it('the Keys page names no kit, in a passkey session, and the kit’s route answers not found with nothing logged', async () => {
    const made = await world();
    const browser = tunnel(made);
    const session = await passkeySession(made, browser);
    const page = await keysPage(browser, session.token);
    for (const text of [KIT_TEXT, KIT_BUTTON, KIT_NONE_TEXT, KIT_READS_ONLY_TEXT]) {
      expect(page).not.toContain(escapeHtml(text));
    }
    expect(page).not.toContain('emergency-kit');
    // A step-up the tunnel's session could get still reaches no kit.
    const answer = await browser.send('POST', '/admin/keys/emergency-kit', {
      cookie: session.token,
      form: await kitForm(browser, session),
    });
    expect(answer.status).toBe(404);
    expect(await answer.text()).not.toContain(SECRET);
    expect(await kitEntries(made)).toEqual([]);
  });
});
