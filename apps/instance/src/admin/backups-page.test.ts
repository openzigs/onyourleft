// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The admin Backups page (#2647, ADR 0069 D-2, D-4, D-8), driven through the
 * REAL handler over a real SQLite file, with a real snapshot taken by the
 * operator CLI's `backup`. What the page shows is held to what `GET
 * /v1/operate/backups` answers the owner's SEALED request in the same test;
 * "back up now" is read back through that route, the store and the operator
 * log — never through the page's own answer alone.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BACKUP_WAITING_TEXT, backupLine, type OperateBackupLine } from '@onyourleft/operate-text';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sha256Hex } from '../auth/crypto.ts';
import { escapeHtml } from '../html.ts';
import { secretBytes } from '../keys/instance-keys-testing.ts';
import { startModerationWorld, type ModerationWorld } from '../moderation/moderation-testing.ts';
import { adminCode } from '../operator/commands.ts';
import { runCommand } from '../operator/run.ts';
import { json, type Route } from '../route-kit.ts';
import { ROUTES } from '../routes.ts';
import { openDatabase } from '../store/node-sqlite.ts';
import {
  adminBrowser,
  handlerOver,
  passkeySessionOn,
  signInWith,
  steppedUpForm,
  type AdminBrowser,
  type HandlerOver,
  type PasskeySession,
} from './admin-testing.ts';
import { BACKUPS_READS_ONLY_TEXT } from './pages.ts';

let worlds: ModerationWorld[] = [];
let restarted: HandlerOver[] = [];
let directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(restarted.map((each) => each.close()));
  await Promise.all(worlds.map((each) => each.close()));
  await Promise.all(directories.map((each) => rm(each, { recursive: true, force: true })));
  worlds = [];
  restarted = [];
  directories = [];
});

const PORT = 8788;

/** The route's own sentence for a second "back up now" (`errors.ts` §`too_many`). */
const TOO_MANY =
  'A backup is already waiting, or one was made in the last 15 minutes. Nothing was asked for: each extra backup removes an older one.';

async function world(
  options: {
    readonly loopbackPort?: number;
    readonly routes?: readonly Route[];
    readonly startsAt?: number;
  } = {},
): Promise<ModerationWorld> {
  const made = await startModerationWorld({
    admin: options.loopbackPort === undefined ? {} : { loopbackPort: options.loopbackPort },
    ...(options.routes === undefined ? {} : { routes: options.routes }),
    ...(options.startsAt === undefined ? {} : { startsAt: options.startsAt }),
  });
  worlds.push(made);
  return made;
}

const paths = (made: ModerationWorld) => ({ database: made.path, blobs: `${made.path}.blobs` });
const clockOf = (made: ModerationWorld) => () => new Date(made.clock.ms);
const tunnel = (made: ModerationWorld): AdminBrowser => adminBrowser(made.instance.handler);
const passkeySession = (made: ModerationWorld, browser = tunnel(made)): Promise<PasskeySession> =>
  passkeySessionOn(browser, paths(made), clockOf(made));

async function codeSession(made: ModerationWorld): Promise<string> {
  const { code } = await adminCode(paths(made), clockOf(made));
  return signInWith(made.instance.handler, code);
}

/** Where the snapshots and their off-box copies go: host paths a page must never name. */
interface Folders {
  readonly backups: string;
  readonly offBox: string;
}

/** A real snapshot, with an off-box copy, taken by the operator CLI as the `backup` service does. */
async function snapshot(made: ModerationWorld): Promise<Folders> {
  const root = await mkdtemp(join(tmpdir(), 'oyl-admin-backups-'));
  directories.push(root);
  const folders = {
    backups: join(root, 'MARKER-backup-dir-2647'),
    offBox: join(root, 'MARKER-offbox-dir-2647'),
  };
  const quiet = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const quieter = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    const code = await runCommand(['backup', folders.backups, '--copy-to', folders.offBox], {
      ...paths(made),
      secret: undefined,
      ownerKey: undefined,
      readStandardInput: () => Promise.resolve(''),
    });
    expect(code).toBe(0);
  } finally {
    quiet.mockRestore();
    quieter.mockRestore();
  }
  return folders;
}

interface BackupsAnswer {
  readonly backups: (OperateBackupLine & { readonly databaseSha256: string | null })[];
  readonly pending: { readonly requestedAt: string } | null;
}

/** The backups as the app's Backups panel reads them: sealed, through the real route. */
async function backups(made: ModerationWorld): Promise<BackupsAnswer> {
  const read = await made.as(made.owner, 'GET', '/v1/operate/backups');
  expect(read.status).toBe(200);
  return read.body as BackupsAnswer;
}

/** The waiting request, read back through the store on a connection of its own. */
const waiting = (made: ModerationWorld) => made.freshRead((store) => store.pendingBackupRequest());

interface LogEntry {
  readonly source: string;
  readonly action: string;
  readonly detail: string | null;
  readonly outcome: string;
}

async function requestLog(made: ModerationWorld): Promise<LogEntry[]> {
  const read = await made.as(made.owner, 'GET', '/v1/operate/log?limit=200');
  expect(read.status).toBe(200);
  return (read.body as { entries: LogEntry[] }).entries
    .filter((entry) => entry.action === 'backup_requested')
    .map(({ source, action, detail, outcome }) => ({ source, action, detail, outcome }))
    .reverse();
}

async function page(browser: AdminBrowser, token: string): Promise<string> {
  const answer = await browser.send('GET', '/admin/backups', { cookie: token });
  expect(answer.status).toBe(200);
  return answer.text();
}

/** "Back up now" as the page's script presses it: a step-up for it, then the form. */
async function backUpNow(browser: AdminBrowser, session: PasskeySession): Promise<Response> {
  const form = await steppedUpForm(browser, session, 'backup_now', {}, { page: '/admin/backups' });
  return browser.send('POST', '/admin/backups', { cookie: session.token, form });
}

/**
 * A record's line as the page draws it, from the package's words: in the
 * table's Backup column (#2771), after the When column has taken its moment.
 */
function lineHtml(record: OperateBackupLine): string {
  const { rest } = backupLine(record);
  return `<td><p>${rest
    .map((part, index) =>
      typeof part === 'string'
        ? escapeHtml(index === 0 ? part.replace(/^, /, '') : part)
        : `<code>${escapeHtml(part.code)}</code>`,
    )
    .join('')}</p>`;
}

describe('the Backups page is the route’s answer, and back up now is read back (#2647)', () => {
  it('draws each record as GET /v1/operate/backups answers it; a press waits, shown on a reload, in the route and in the log', async () => {
    // The CLI dates its record by the wall clock: the world starts past its 15 minutes.
    const made = await world({ startsAt: Date.now() + 30 * 60_000 });
    await snapshot(made);
    const browser = tunnel(made);
    const session = await passkeySession(made);
    const before = await backups(made);
    expect(before.backups).toHaveLength(1);
    const [record] = before.backups;
    const html = await page(browser, session.token);
    expect(html).toContain(lineHtml(record as OperateBackupLine));
    expect(html).toContain(`<time datetime="${record?.at ?? 'none'}">`);
    // One record: nothing older to link to.
    expect(html).not.toContain('Show older backups');
    expect(html).toContain(`<code>${record?.databaseSha256 ?? 'none'}</code>`);
    expect(html).not.toContain(escapeHtml(BACKUP_WAITING_TEXT));

    const pressed = await backUpNow(browser, session);
    expect(pressed.status, await pressed.clone().text()).toBe(200);
    // Read back the way the app's panel reads it, and the way the backup service is asked.
    const after = await backups(made);
    expect(after.pending).not.toBeNull();
    const held = await waiting(made);
    expect(held).toBeDefined();
    expect(after.pending?.requestedAt).toBe(
      new Date((held?.requestedAt ?? 0) * 1000).toISOString(),
    );
    // A reload shows it waiting, and offers no second press.
    const reloaded = await page(browser, session.token);
    expect(reloaded).toContain(escapeHtml(BACKUP_WAITING_TEXT));
    expect(reloaded).not.toContain('data-step-up="backup_now"');
    expect(await requestLog(made)).toEqual([
      { source: 'admin_tunnel', action: 'backup_requested', detail: null, outcome: 'done' },
    ]);
  });

  it('refuses a second press with the route’s sentence: nothing new waits, and the refusal is logged', async () => {
    const made = await world();
    const browser = tunnel(made);
    const session = await passkeySession(made);
    expect((await backUpNow(browser, session)).status).toBe(200);
    const first = await waiting(made);
    made.clock.ms += 60_000;
    // The press as a page drawn before the first one would make it.
    const again = await backUpNow(browser, session);
    expect(again.status).toBe(429);
    expect(await again.text()).toContain(escapeHtml(TOO_MANY));
    expect(await waiting(made)).toEqual(first);
    expect(await requestLog(made)).toEqual([
      { source: 'admin_tunnel', action: 'backup_requested', detail: null, outcome: 'done' },
      { source: 'admin_tunnel', action: 'backup_requested', detail: 'pending', outcome: 'refused' },
    ]);
  });

  it('logs a press on the server machine under admin_loopback', async () => {
    const made = await world({ loopbackPort: PORT });
    const browser = adminBrowser(made.instance.handler, { loopback: PORT });
    const session = await passkeySession(made, browser);
    const pressed = await backUpNow(browser, session);
    expect(pressed.status, await pressed.clone().text()).toBe(200);
    expect(await waiting(made)).toBeDefined();
    expect(await requestLog(made)).toEqual([
      { source: 'admin_loopback', action: 'backup_requested', detail: null, outcome: 'done' },
    ]);
  });

  it('lists the newest 20 with a link to every record, and every record at ?all=1 with a link back (#2771)', async () => {
    const at = (index: number): string =>
      new Date(Date.UTC(2026, 10, 14, 23 - index)).toISOString();
    const records = Array.from({ length: 25 }, (_, index) => ({
      outcome: 'done',
      id: 25 - index,
      at: at(index),
      ageSeconds: 3600 * (index + 1),
      snapshot: `snapshot-number-${String(25 - index)}-end`,
      rows: 10,
      blobs: 1,
      sizeBytes: 1000,
      offBox: 'copied',
      intervalSeconds: 3600,
      requested: false,
      databaseSha256: null,
      removed: null,
      freeBytes: { backups: null, offBox: null },
    }));
    const routes: readonly Route[] = ROUTES.map((route) =>
      route.path === '/v1/operate/backups' && route.method === 'GET'
        ? { ...route, handle: () => Promise.resolve(json({ backups: records, pending: null })) }
        : route,
    );
    const made = await world({ routes });
    const browser = tunnel(made);
    const token = await codeSession(made);
    const listed = (html: string): string[] =>
      [...html.matchAll(/<td><p>[^<]*<code>snapshot-number-(\d+)-end<\/code><\/p>/g)].map(
        ([, n]) => n ?? '',
      );
    const newest = await page(browser, token);
    expect(listed(newest)).toEqual(records.slice(0, 20).map((each) => String(each.id)));
    expect(newest).toContain('<a href="/admin/backups?all=1">Show older backups (5 more)</a>');
    expect(newest).toContain(`<time datetime="${at(0)}">14 Nov 2026, 23:00 UTC</time>`);

    const answer = await browser.send('GET', '/admin/backups?all=1', { cookie: token });
    expect(answer.status).toBe(200);
    const every = await answer.text();
    expect(listed(every)).toEqual(records.map((each) => String(each.id)));
    expect(every).toContain('<a href="/admin/backups">Show the newest 20 only</a>');
    expect(every).not.toContain('Show older backups');
  });

  it('says the list could not be read when the route’s answer is not in its shape', async () => {
    const routes: readonly Route[] = ROUTES.map((route) =>
      route.path === '/v1/operate/backups' && route.method === 'GET'
        ? {
            ...route,
            handle: () => Promise.resolve(json({ backups: [{ id: 'x' }], pending: null })),
          }
        : route,
    );
    const made = await world({ routes });
    const html = await page(tunnel(made), await codeSession(made));
    expect(html).toContain('The backups could not be read from the instance');
  });

  it('does not take a 202 the list read back does not show waiting as asked', async () => {
    const routes: readonly Route[] = ROUTES.map((route) =>
      route.path === '/v1/operate/backups' && route.method === 'POST'
        ? {
            ...route,
            handle: () => Promise.resolve(json({ requestedAt: '2026-09-21T00:00:00.000Z' }, 202)),
          }
        : route,
    );
    const made = await world({ routes });
    const browser = tunnel(made);
    const answer = await backUpNow(browser, await passkeySession(made));
    const html = await answer.text();
    expect(html).toContain('did not show the request waiting');
    expect(html).not.toContain(escapeHtml(BACKUP_WAITING_TEXT));
  });
});

describe('no request without a fresh passkey check made for it, on either listener (#2647, ADR 0069 D-4, Q-A)', () => {
  it.each([
    ['through the tunnel', undefined],
    ['on the server machine', PORT],
  ] as const)(
    '%s: no assertion, a code session and a step-up over another action’s challenge change nothing — no request row',
    async (_where, loopback) => {
      const made = await world(loopback === undefined ? {} : { loopbackPort: loopback });
      const browser = adminBrowser(
        made.instance.handler,
        loopback === undefined ? {} : { loopback },
      );
      const session = await passkeySession(made, browser);
      const csrfOf = async (token: string) =>
        /name="csrf" value="([0-9a-f]{64})"/.exec(await page(browser, token))?.[1] as string;

      const bare = await browser.send('POST', '/admin/backups', {
        cookie: session.token,
        form: { csrf: await csrfOf(session.token) },
      });
      expect(bare.status).toBe(403);

      const { code } = await adminCode(paths(made), clockOf(made));
      const signedIn = await browser.send('POST', '/admin/sign-in', { form: { code } });
      const codeToken = /=([^;]*)/.exec(signedIn.headers.get('set-cookie') ?? '')?.[1] as string;
      expect(await page(browser, codeToken)).toContain(escapeHtml(BACKUPS_READS_ONLY_TEXT));
      const fromCode = await browser.send('POST', '/admin/backups', {
        cookie: codeToken,
        form: { csrf: await csrfOf(codeToken) },
      });
      expect(fromCode.status).toBe(403);

      const other = await steppedUpForm(
        browser,
        session,
        'analysis_clear',
        {},
        {
          page: '/admin/backups',
        },
      );
      const elsewhere = await browser.send('POST', '/admin/backups', {
        cookie: session.token,
        form: other,
      });
      expect(elsewhere.status).toBe(403);

      // Read back through the store: nothing waits, nothing was logged.
      expect(await waiting(made)).toBeUndefined();
      expect(await requestLog(made)).toEqual([]);
    },
  );
});

describe('owner-only, checked on the instance (#2647, the epic’s constraint)', () => {
  it('with no session, sent to sign in; once the owner key names another athlete, refused and the session ended — nothing waits, read back', async () => {
    const made = await world();
    const browser = tunnel(made);
    const session = await passkeySession(made);
    const form = await steppedUpForm(
      browser,
      session,
      'backup_now',
      {},
      { page: '/admin/backups' },
    );

    const none = await browser.send('POST', '/admin/backups', { form });
    expect(none.status).toBe(303);
    expect(none.headers.get('location')).toBe('/admin/sign-in');

    const moved = await handlerOver(made.path, made.clock, {
      owner: made.deputy.device.publicKey,
    });
    restarted.push(moved);
    const refused = await adminBrowser(moved.handler).send('POST', '/admin/backups', {
      cookie: session.token,
      form,
    });
    expect(refused.status).toBe(303);
    expect(refused.headers.get('location')).toBe('/admin/sign-in');
    expect(await waiting(made)).toBeUndefined();
    expect(
      await made.freshRead(async (store) => store.findAdminSession(await sha256Hex(session.token))),
    ).toBeUndefined();
    expect(await requestLog(made)).toEqual([]);
  });
});

describe('the operator log entry is the request’s: a log that cannot be written leaves nothing waiting (#2647)', () => {
  it('answers that something went wrong, and no request row is there, read back', async () => {
    const made = await world();
    const browser = tunnel(made);
    const session = await passkeySession(made);
    const form = await steppedUpForm(
      browser,
      session,
      'backup_now',
      {},
      { page: '/admin/backups' },
    );
    const database = openDatabase(made.path);
    try {
      database.exec(
        "create trigger refuse_backup_log before insert on operator_log when new.action = 'backup_requested' and new.outcome = 'done' begin select raise(abort, 'the log is down'); end",
      );
    } finally {
      database.close();
    }
    const answer = await browser.send('POST', '/admin/backups', { cookie: session.token, form });
    expect(answer.status).toBe(500);
    expect(await answer.text()).toContain('Nothing was changed.');
    expect(await waiting(made)).toBeUndefined();
    expect((await backups(made)).pending).toBeNull();
    expect(await requestLog(made)).toEqual([
      { source: 'admin_tunnel', action: 'backup_requested', detail: null, outcome: 'failed' },
    ]);
  });
});

describe('no host path, no secret and no coordinate on any Backups answer (#2647, CLAUDE.md §6)', () => {
  it('names neither backup folder, and says none of the instance’s secrets, tokens or codes', async () => {
    vi.stubEnv('OYL_INSTANCE_METRICS_TOKEN', 'MARKER-metrics-token-2647-0123456789abcdef');
    vi.stubEnv('CLOUDFLARE_TUNNEL_TOKEN', 'MARKER-tunnel-token-2647');
    const made = await world();
    const folders = await snapshot(made);
    vi.stubEnv('OYL_BACKUP_DIR', folders.backups);
    vi.stubEnv('OYL_OFFBOX_DIR', folders.offBox);
    const browser = tunnel(made);
    const secret = btoa(String.fromCharCode(...secretBytes(7)));
    const { code } = await adminCode(paths(made), clockOf(made));
    const codeToken = await signInWith(made.instance.handler, code);
    const session = await passkeySession(made);
    const said: string[] = [];
    const keep = async (answer: Response): Promise<void> => {
      for (const [name, value] of answer.headers.entries()) {
        if (name !== 'set-cookie') said.push(`${name}: ${value}`);
      }
      said.push(await answer.text());
    };
    await keep(await browser.send('GET', '/admin/backups', { cookie: codeToken }));
    await keep(await browser.send('GET', '/admin/backups', { cookie: session.token }));
    await keep(await backUpNow(browser, session));
    await keep(await backUpNow(browser, session));
    await keep(await browser.send('POST', '/admin/backups', { cookie: codeToken, form: {} }));
    said.push(...made.instance.lines, JSON.stringify(await requestLog(made)));
    const everything = said.join('\n');
    // The snapshot is named by its directory alone; /backups is the service's own folder.
    expect(everything).toMatch(/\/backups\/(pre-deploy\/)?snapshot-/);
    for (const marker of [
      'MARKER-backup-dir-2647',
      'MARKER-offbox-dir-2647',
      tmpdir(),
      secret,
      'MARKER-metrics-token-2647',
      'MARKER-tunnel-token-2647',
      made.owner.token,
      session.token,
      codeToken,
      code,
      code.replaceAll('-', ''),
      made.owner.device.publicKey,
    ]) {
      expect(everything, marker).not.toContain(marker);
    }
    expect(everything).not.toMatch(/-?\d{1,3}\.\d{4,}/);
  });
});
