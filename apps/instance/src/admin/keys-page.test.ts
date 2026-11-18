// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The admin Keys page (#2650, ADR 0047 D-4–D-6, ADR 0069 D-2, D-5), driven
 * through the REAL handler over a real SQLite file, on BOTH listeners. The
 * card and its fingerprint are read on the loopback listener and never on the
 * tunnel's; a rotation through the page is read back the way a device reads
 * keys — `GET /v1/instance/keys`, and a sealed request to the new key — and
 * through the operator log, never through the page's own answer alone.
 */

import { fromHex, toHex, type SealedInstanceKey } from '@onyourleft/domain';
import { ROTATE_BUSY_TEXT, ROTATE_NOT_DONE_TEXT } from '@onyourleft/operate-text';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TEST_ORIGIN } from '../auth/identity-testing.ts';
import { sha256Hex } from '../auth/crypto.ts';
import { escapeHtml } from '../html.ts';
import { privateSpellings, secretBytes } from '../keys/instance-keys-testing.ts';
import { startModerationWorld, type ModerationWorld } from '../moderation/moderation-testing.ts';
import { adminCode } from '../operator/commands.ts';
import { currentKey, sealedCall } from '../sealed/sealed-testing.ts';
import { json, type Route } from '../route-kit.ts';
import { ROUTES } from '../routes.ts';
import { openDatabase } from '../store/node-sqlite.ts';
import {
  adminBrowser,
  handlerOver,
  passkeySessionOn,
  steppedUpForm,
  type AdminBrowser,
  type HandlerOver,
  type PasskeySession,
} from './admin-testing.ts';
import { KEYS_CARD_ON_SERVER_TEXT, KEYS_READS_ONLY_TEXT, ROTATED_TEXT } from './pages.ts';

let worlds: ModerationWorld[] = [];
let restarted: HandlerOver[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(restarted.map((each) => each.close()));
  await Promise.all(worlds.map((each) => each.close()));
  worlds = [];
  restarted = [];
});

const PORT = 8788;

async function world(): Promise<ModerationWorld> {
  const made = await startModerationWorld({ admin: { loopbackPort: PORT } });
  worlds.push(made);
  return made;
}

const paths = (made: ModerationWorld) => ({ database: made.path, blobs: `${made.path}.blobs` });
const clockOf = (made: ModerationWorld) => () => new Date(made.clock.ms);
const tunnel = (made: ModerationWorld): AdminBrowser => adminBrowser(made.instance.handler);
const loopback = (made: ModerationWorld): AdminBrowser =>
  adminBrowser(made.instance.handler, { loopback: PORT });

/** A one-time code's session on `browser`'s listener. */
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

const passkeySession = (made: ModerationWorld, browser: AdminBrowser): Promise<PasskeySession> =>
  passkeySessionOn(browser, paths(made), clockOf(made));

async function page(browser: AdminBrowser, token: string): Promise<string> {
  const answer = await browser.send('GET', '/admin/keys', { cookie: token });
  expect(answer.status).toBe(200);
  return answer.text();
}

/** Rotate as the page's script does: a step-up over the typed word, then the form. */
async function rotateThrough(
  browser: AdminBrowser,
  session: PasskeySession,
  confirm: string,
): Promise<Response> {
  const form = await steppedUpForm(
    browser,
    session,
    'key_rotate',
    { confirm },
    { page: '/admin/keys' },
  );
  return browser.send('POST', '/admin/keys/rotate', { cookie: session.token, form });
}

/** The encryption keys' serials, read from the database file. */
const serials = (made: ModerationWorld): Promise<number[]> =>
  made.freshRead(async (store) =>
    (await store.listInstanceKeys())
      .filter((row) => row.role === 'encryption')
      .map((row) => row.serial ?? 0)
      .sort((a, b) => a - b),
  );

/** What a device reads: `GET /v1/instance/keys`, plaintext. */
async function served(made: ModerationWorld) {
  const answer = await fetch(`${made.url}/v1/instance/keys`);
  expect(answer.status).toBe(200);
  return (await answer.json()) as {
    identityKey: string;
    statements: { statement: { serial: number; keyId: string; encryptionKey: string } }[];
  };
}

interface LogEntry {
  readonly source: string;
  readonly action: string;
  readonly detail: string | null;
  readonly outcome: string;
}

async function rotateLog(made: ModerationWorld): Promise<LogEntry[]> {
  const read = await made.as(made.owner, 'GET', '/v1/operate/log?limit=200');
  expect(read.status).toBe(200);
  return (read.body as { entries: LogEntry[] }).entries
    .filter((entry) => entry.action === 'instance_key_rotate')
    .map(({ source, action, detail, outcome }) => ({ source, action, detail, outcome }))
    .reverse();
}

/** Every 8-character run of `text`: a part of the fingerprint long enough to mean something. */
const runsOf = (text: string): string[] =>
  Array.from({ length: text.length - 7 }, (_, at) => text.slice(at, at + 8));

describe('the card never crosses the tunnel listener (#2650, ADR 0047 D-6, ADR 0069 D-2, D-5)', () => {
  it('through the tunnel: no card, no fingerprint, nor any 8 characters of it, on any Keys answer; on the server machine, both whole', async () => {
    const made = await world();
    const shown = await made.instanceKeys.show();
    const fingerprint = shown.fingerprintBase32;
    expect(fingerprint).toMatch(/^[A-Z2-7]{52}$/);
    expect(shown.card).toBe(`oyl-instance:${TEST_ORIGIN}#${fingerprint}`);

    const through = tunnel(made);
    const session = await passkeySession(made, through);
    const answers = [
      await page(through, await codeSession(made, through)),
      await page(through, session.token),
      await (await rotateThrough(through, session, 'nope')).text(),
      await (await rotateThrough(through, session, 'rotate')).text(),
    ];
    for (const html of answers) {
      expect(html).not.toContain('oyl-instance:');
      expect(html).toContain(escapeHtml(KEYS_CARD_ON_SERVER_TEXT));
      for (const run of runsOf(fingerprint)) expect(html, run).not.toContain(run);
    }
    // The rotation changed the encryption key, never the identity key: the fingerprint is the same.
    expect((await made.instanceKeys.show()).fingerprintBase32).toBe(fingerprint);

    const onServer = loopback(made);
    for (const html of [
      await page(onServer, await codeSession(made, onServer)),
      await page(onServer, (await passkeySession(made, onServer)).token),
    ]) {
      expect(html).toContain(`<code class="card">${escapeHtml(shown.card)}</code>`);
      expect(html).toContain(`<code class="fingerprint">${fingerprint}</code>`);
      expect(html).not.toContain(escapeHtml(KEYS_CARD_ON_SERVER_TEXT));
    }
  });

  it('draws the keys’ state on both: the current serial and the older keys held, and a code session no rotation', async () => {
    const made = await world();
    const [serial] = await serials(made);
    for (const browser of [tunnel(made), loopback(made)]) {
      const html = await page(browser, await codeSession(made, browser));
      expect(html).toContain('<dt>State</dt><dd>ready</dd>');
      expect(html).toContain(`<dt>Encryption key</dt><dd>${String(serial)}, made `);
      expect(html).toContain('<dt>Older keys held</dt><dd>none</dd>');
      expect(html).toContain(escapeHtml(KEYS_READS_ONLY_TEXT));
      expect(html).not.toContain('data-step-up');
    }
  });
});

describe('rotate through the page, then read the way a device reads (#2650, ADR 0047 D-4)', () => {
  it('serves the new key under the same identity key, a sealed request to it is answered, and it is logged under admin_tunnel', async () => {
    const made = await world();
    const before = await served(made);
    const oldKey = await currentKey(made);
    const [oldSerial] = await serials(made);
    const browser = tunnel(made);
    const session = await passkeySession(made, browser);

    const answer = await rotateThrough(browser, session, ' rotate ');
    expect(answer.status, await answer.clone().text()).toBe(200);
    expect(await answer.text()).toContain(ROTATED_TEXT);
    const after = await served(made);
    expect(after.identityKey).toBe(before.identityKey);
    const [, newSerial] = await serials(made);
    expect(newSerial).toBeGreaterThan(oldSerial ?? 0);
    expect(after.statements[0]?.statement.serial).toBe(newSerial);

    // An existing device session, sealed to the NEW key, is answered; the old key still opens one.
    const newest = after.statements[0]?.statement;
    if (newest === undefined) throw new Error('no statement served');
    const newKey: SealedInstanceKey = {
      keyId: newest.keyId,
      publicKey: fromHex(newest.encryptionKey, 'the encryption key', 32),
    };
    expect(newKey.keyId).not.toBe(oldKey.keyId);
    for (const instanceKey of [newKey, oldKey]) {
      const sealed = await sealedCall(made, {
        path: '/v1/operate/status',
        token: made.owner.token,
        signer: made.owner.device.signingKey,
        instanceKey,
      });
      expect(sealed.status).toBe(200);
    }
    // A reload shows the new serial, and the old one held.
    const reloaded = await page(browser, session.token);
    expect(reloaded).toContain(`<dt>Encryption key</dt><dd>${String(newSerial)}, made `);
    expect(reloaded).toContain('<dt>Older keys held</dt><dd>1, each kept 7 days');
    expect(await rotateLog(made)).toEqual([
      { source: 'admin_tunnel', action: 'instance_key_rotate', detail: null, outcome: 'done' },
    ]);
  });

  it('logs a rotation on the server machine under admin_loopback', async () => {
    const made = await world();
    const browser = loopback(made);
    const answer = await rotateThrough(browser, await passkeySession(made, browser), 'rotate');
    expect(answer.status, await answer.clone().text()).toBe(200);
    expect(await serials(made)).toHaveLength(2);
    expect(await rotateLog(made)).toEqual([
      { source: 'admin_loopback', action: 'instance_key_rotate', detail: null, outcome: 'done' },
    ]);
  });

  it('answers the route’s busy while the key lease is held: nothing rotated, read back, and the refusal logged', async () => {
    const made = await world();
    const before = await serials(made);
    const browser = tunnel(made);
    const session = await passkeySession(made, browser);
    const now = Math.floor(made.clock.ms / 1000);
    // The instance's own maintenance pass, on its own connection.
    expect(
      await made.freshRead((store) =>
        store.takeInstanceKeyLease('maintenance-pass', now, now + 60),
      ),
    ).toBe(true);
    const answer = await rotateThrough(browser, session, 'rotate');
    expect(answer.status).toBe(409);
    expect(await answer.text()).toContain(escapeHtml(ROTATE_BUSY_TEXT));
    expect(await serials(made)).toEqual(before);
    expect(await rotateLog(made)).toEqual([
      { source: 'admin_tunnel', action: 'instance_key_rotate', detail: 'busy', outcome: 'refused' },
    ]);
  });
});

describe('a rotation the route answered and the keys read back do not show is not said to be done (#2650)', () => {
  it('says the key was not rotated when the route answered rotated and the serial read back is the old one', async () => {
    const forgetful: readonly Route[] = ROUTES.map((route) =>
      route.path === '/v1/operate/keys/rotate'
        ? { ...route, handle: () => Promise.resolve(json({ outcome: 'rotated', serial: 1 })) }
        : route,
    );
    const made = await startModerationWorld({ admin: { loopbackPort: PORT }, routes: forgetful });
    worlds.push(made);
    const browser = tunnel(made);
    const answer = await rotateThrough(browser, await passkeySession(made, browser), 'rotate');
    const html = await answer.text();
    expect(html).not.toContain(ROTATED_TEXT);
    expect(html).toContain(escapeHtml(ROTATE_NOT_DONE_TEXT));
  });
});

describe('no rotation without the typed word and a fresh passkey check made for it (#2650, ADR 0069 D-4)', () => {
  it('another word, the word in capitals, no word, a step-up for another change and a code session rotate nothing', async () => {
    const made = await world();
    const before = await serials(made);
    const browser = tunnel(made);
    const session = await passkeySession(made, browser);
    const csrf = /name="csrf" value="([0-9a-f]{64})"/.exec(await page(browser, session.token))?.[1];

    for (const word of ['yes', 'ROTATE']) {
      const refused = await rotateThrough(browser, session, word);
      expect(refused.status, word).toBe(400);
      expect(await refused.text()).toContain(escapeHtml(ROTATE_NOT_DONE_TEXT));
    }
    const missing = await browser.send('POST', '/admin/keys/rotate', {
      cookie: session.token,
      form: { csrf: csrf as string },
    });
    expect(missing.status).toBe(400);
    const other = await steppedUpForm(browser, session, 'backup_now', {}, { page: '/admin/keys' });
    const elsewhere = await browser.send('POST', '/admin/keys/rotate', {
      cookie: session.token,
      form: { ...other, confirm: 'rotate' },
    });
    expect(elsewhere.status).toBe(403);
    const code = await codeSession(made, browser);
    const codeCsrf = /name="csrf" value="([0-9a-f]{64})"/.exec(await page(browser, code))?.[1];
    const fromCode = await browser.send('POST', '/admin/keys/rotate', {
      cookie: code,
      form: { csrf: codeCsrf as string, confirm: 'rotate' },
    });
    expect(fromCode.status).toBe(403);

    expect(await serials(made)).toEqual(before);
    expect(await rotateLog(made)).toEqual([]);
  });
});

describe('owner-only, checked on the instance (#2650, the epic’s constraint)', () => {
  it('with no session, sent to sign in; once the owner key names another athlete, refused and the session ended — nothing rotated, read back', async () => {
    const made = await world();
    const before = await serials(made);
    const browser = tunnel(made);
    const session = await passkeySession(made, browser);
    const form = await steppedUpForm(
      browser,
      session,
      'key_rotate',
      { confirm: 'rotate' },
      {
        page: '/admin/keys',
      },
    );
    const none = await browser.send('POST', '/admin/keys/rotate', { form });
    expect(none.status).toBe(303);
    expect(none.headers.get('location')).toBe('/admin/sign-in');

    const moved = await handlerOver(made.path, made.clock, {
      owner: made.deputy.device.publicKey,
    });
    restarted.push(moved);
    const refused = await adminBrowser(moved.handler).send('POST', '/admin/keys/rotate', {
      cookie: session.token,
      form,
    });
    expect(refused.status).toBe(303);
    expect(refused.headers.get('location')).toBe('/admin/sign-in');
    expect(await serials(made)).toEqual(before);
    expect(
      await made.freshRead(async (store) => store.findAdminSession(await sha256Hex(session.token))),
    ).toBeUndefined();
    expect(await rotateLog(made)).toEqual([]);
  });
});

describe('the operator log entry is the rotation’s: a log that cannot be written rotates nothing (#2650)', () => {
  it('answers that something went wrong, and the keys are as they were, read back', async () => {
    const made = await world();
    const before = await serials(made);
    const servedBefore = await served(made);
    const browser = tunnel(made);
    const session = await passkeySession(made, browser);
    const form = await steppedUpForm(
      browser,
      session,
      'key_rotate',
      { confirm: 'rotate' },
      {
        page: '/admin/keys',
      },
    );
    const database = openDatabase(made.path);
    try {
      database.exec(
        "create trigger refuse_rotate_log before insert on operator_log when new.action = 'instance_key_rotate' and new.outcome = 'done' begin select raise(abort, 'the log is down'); end",
      );
    } finally {
      database.close();
    }
    const answer = await browser.send('POST', '/admin/keys/rotate', {
      cookie: session.token,
      form,
    });
    expect(answer.status).toBe(500);
    expect(await answer.text()).toContain('Nothing was changed.');
    expect(await serials(made)).toEqual(before);
    expect((await served(made)).statements).toEqual(servedBefore.statements);
    expect(await rotateLog(made)).toEqual([
      { source: 'admin_tunnel', action: 'instance_key_rotate', detail: null, outcome: 'failed' },
    ]);
  });
});

describe('no private key half and no secret on any Keys answer (#2650, CLAUDE.md §6)', () => {
  it('says no private half of any key, nor the secret key, a token or a code, on either listener', async () => {
    vi.stubEnv('OYL_INSTANCE_METRICS_TOKEN', 'MARKER-metrics-token-2650-0123456789abcdef');
    vi.stubEnv('CLOUDFLARE_TUNNEL_TOKEN', 'MARKER-tunnel-token-2650');
    const made = await world();
    const said: string[] = [];
    const keep = async (answer: Response): Promise<void> => {
      for (const [name, value] of answer.headers.entries()) {
        if (name !== 'set-cookie') said.push(`${name}: ${value}`);
      }
      said.push(await answer.text());
    };
    const tokens: string[] = [];
    for (const browser of [tunnel(made), loopback(made)]) {
      const code = await codeSession(made, browser);
      const session = await passkeySession(made, browser);
      tokens.push(code, session.token);
      await keep(await browser.send('GET', '/admin/keys', { cookie: code }));
      await keep(await browser.send('GET', '/admin/keys', { cookie: session.token }));
      await keep(await rotateThrough(browser, session, 'rotate'));
      await keep(await rotateThrough(browser, session, 'no'));
      await keep(await browser.send('POST', '/admin/keys/rotate', { cookie: code, form: {} }));
    }
    said.push(...made.instance.lines, JSON.stringify(await rotateLog(made)));
    const everything = said.join('\n');
    const rows = await made.freshRead((store) => store.listInstanceKeys());
    // The identity key and three encryption keys: every private half held.
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const markers = [
      btoa(String.fromCharCode(...secretBytes(7))),
      toHex(secretBytes(7)),
      'MARKER-metrics-token-2650',
      'MARKER-tunnel-token-2650',
      made.owner.token,
      made.owner.device.publicKey,
      ...tokens,
    ];
    for (const row of rows) {
      markers.push(...(await privateSpellings(row, secretBytes(7), TEST_ORIGIN)));
      markers.push(toHex(row.wrapped), btoa(String.fromCharCode(...row.wrapped)));
    }
    for (const marker of markers) expect(everything, marker.slice(0, 12)).not.toContain(marker);
    expect(everything).not.toMatch(/-?\d{1,3}\.\d{4,}/);
  });
});
