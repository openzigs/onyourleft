// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The admin Accounts page (#2646, ADR 0069 D-2, D-8, D-9), driven through the
 * REAL handler over a real SQLite file. What it shows is held to what `GET
 * /v1/operate/status` and `GET /v1/moderation/registrations` answer the
 * owner's SEALED request in the same test, on every load; every decision is
 * read back through the moderation routes the app's Moderation screen reads,
 * the moderation log and the operator log — never through the page's own
 * answer alone.
 */

import { accountStandingLines } from '@onyourleft/operate-text';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sha256Hex } from '../auth/crypto.ts';
import { escapeHtml } from '../html.ts';
import { secretBytes } from '../keys/instance-keys-testing.ts';
import {
  startModerationWorld,
  type ModerationWorld,
  type Rider,
} from '../moderation/moderation-testing.ts';
import { adminCode } from '../operator/commands.ts';
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
import {
  ACCOUNTS_READS_ONLY_TEXT,
  DECISION_NOT_SHOWN_TEXT,
  NO_REGISTRATIONS_TEXT,
  REGISTRATIONS_UNREADABLE_TEXT,
} from './pages.ts';

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

async function world(
  options: { readonly loopbackPort?: number; readonly routes?: readonly Route[] } = {},
): Promise<ModerationWorld> {
  const made = await startModerationWorld({
    admin: options.loopbackPort === undefined ? {} : { loopbackPort: options.loopbackPort },
    registration: 'approval',
    config: { registration: 'approval' },
    ...(options.routes === undefined ? {} : { routes: options.routes }),
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

async function page(browser: AdminBrowser, token: string): Promise<string> {
  const answer = await browser.send('GET', '/admin/accounts', { cookie: token });
  expect(answer.status).toBe(200);
  return answer.text();
}

/** A rider approved through the app's own route, as the Moderation screen approves one. */
async function approvedInApp(made: ModerationWorld, rider: Rider): Promise<void> {
  const answer = await made.as(
    made.owner,
    'POST',
    `/v1/moderation/registrations/${rider.athleteId}/approve`,
    { reason: 'Known to the club' },
  );
  expect(answer.status).toBe(200);
}

/** The standings as the page lists them. */
function standingsOf(html: string): string[] {
  const list = /<ul class="counts">\n([\s\S]*?)\n<\/ul>/.exec(html)?.[1] ?? '';
  return [...list.matchAll(/<li>([^<]*)<\/li>/g)].map(([, line]) => line ?? '');
}

/** The account ids the page lists as waiting. */
function queuedOf(html: string): string[] {
  const list = /<ul class="registrations">([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? '';
  return [...list.matchAll(/Account <code>([^<]*)<\/code>/g)].map(([, id]) => id ?? '');
}

interface StatusCounts {
  readonly counts: { readonly athletes: { active: number; pending: number; suspended: number } };
}

async function counts(made: ModerationWorld) {
  const read = await made.as(made.owner, 'GET', '/v1/operate/status');
  expect(read.status).toBe(200);
  return (read.body as StatusCounts).counts.athletes;
}

/** The queue as the app's Moderation screen reads it: sealed, through the real route. */
async function queue(made: ModerationWorld): Promise<string[]> {
  const read = await made.as(made.owner, 'GET', '/v1/moderation/registrations');
  expect(read.status).toBe(200);
  return (read.body as { registrations: { athleteId: string }[] }).registrations.map(
    (each) => each.athleteId,
  );
}

interface LogEntry {
  readonly source: string;
  readonly action: string;
  readonly detail: string | null;
  readonly outcome: string;
}

/** The operator log's `registration_decided` entries, oldest first, as the owner reads them. */
async function decisionLog(made: ModerationWorld): Promise<LogEntry[]> {
  const read = await made.as(made.owner, 'GET', '/v1/operate/log?limit=200');
  expect(read.status).toBe(200);
  return (read.body as { entries: LogEntry[] }).entries
    .filter((entry) => entry.action === 'registration_decided')
    .map(({ source, action, detail, outcome }) => ({ source, action, detail, outcome }))
    .reverse();
}

interface ModerationEntry {
  readonly action: string;
  readonly targetAthleteId: string | null;
  readonly reason: string | null;
}

/** The moderation log as the app's Moderation screen reads it. */
async function moderationLog(made: ModerationWorld): Promise<ModerationEntry[]> {
  const read = await made.as(made.owner, 'GET', '/v1/moderation/log');
  expect(read.status).toBe(200);
  return (read.body as { items: ModerationEntry[] }).items.map(
    ({ action, targetAthleteId, reason }) => ({ action, targetAthleteId, reason }),
  );
}

/** A decision made as the page's script makes it: a step-up for it, then the form posted. */
async function decide(
  browser: AdminBrowser,
  session: PasskeySession,
  decision: 'approve' | 'refuse',
  fields: { readonly athleteId: string; readonly reason: string },
): Promise<Response> {
  const form = await steppedUpForm(browser, session, `registration_${decision}`, fields, {
    page: '/admin/accounts',
  });
  return browser.send('POST', `/admin/accounts/${decision}`, { cookie: session.token, form });
}

describe('the Accounts page is the routes’ answers, read again on every load (#2646)', () => {
  it('shows the standings GET /v1/operate/status answers, and after an approval elsewhere a reload shows them moved', async () => {
    const made = await world();
    const first = await made.rider('Pending One');
    const second = await made.rider('Pending Two');
    const approved = await made.rider('Approved Rider');
    await approvedInApp(made, approved);
    const browser = tunnel(made);
    const token = await codeSession(made);

    const before = await counts(made);
    // The owner and the deputy are active from their first sign-in.
    expect(before).toEqual({ active: 3, pending: 2, suspended: 0 });
    const html = await page(browser, token);
    expect(standingsOf(html)).toEqual(accountStandingLines(before));
    expect(queuedOf(html)).toEqual(await queue(made));
    expect(queuedOf(html).sort()).toEqual([first.athleteId, second.athleteId].sort());

    // Approved through the moderation route, as the app's Moderation screen does.
    await approvedInApp(made, first);
    const after = await counts(made);
    expect(after).toEqual({ active: 4, pending: 1, suspended: 0 });
    const reloaded = await page(browser, token);
    expect(standingsOf(reloaded)).toEqual(accountStandingLines(after));
    expect(queuedOf(reloaded)).toEqual([second.athleteId]);
    // An approval from the app is the moderation log's alone: no admin entry.
    expect(await decisionLog(made)).toEqual([]);
  });

  it('draws a reads-only session no decision, and an empty queue as nobody waiting', async () => {
    const made = await world();
    const waiting = await made.rider('Waiting');
    const token = await codeSession(made);
    const html = await page(tunnel(made), token);
    expect(html).toContain(escapeHtml(ACCOUNTS_READS_ONLY_TEXT));
    expect(html).not.toContain('data-step-up');
    expect(queuedOf(html)).toEqual([waiting.athleteId]);
    await approvedInApp(made, waiting);
    expect(await page(tunnel(made), token)).toContain(NO_REGISTRATIONS_TEXT);
  });
});

describe('only the four details of a rider waiting, and nobody else’s (#2646, ADR 0069 D-9)', () => {
  it('shows a waiting rider’s name, id, when and age confirmation — no approved or suspended rider’s name, and no extra field the route might carry', async () => {
    const wrapped: readonly Route[] = ROUTES.map((route) =>
      route.path === '/v1/moderation/registrations' && route.method === 'GET'
        ? {
            ...route,
            handle: async (context) => {
              const real = (await (await route.handle(context)).json()) as {
                registrations: Record<string, unknown>[];
              };
              return json({
                registrations: real.registrations.map((each) => ({
                  ...each,
                  email: 'MARKER-email@example.com',
                })),
              });
            },
          }
        : route,
    );
    const made = await world({ routes: wrapped });
    const waiting = await made.rider('MARKER Waiting Name');
    const approved = await made.rider('MARKER Approved Name');
    await approvedInApp(made, approved);
    const html = await page(tunnel(made), (await passkeySession(made)).token);
    expect(html).toContain('<h3>MARKER Waiting Name</h3>');
    expect(html).toContain(`Account <code>${waiting.athleteId}</code>, asked `);
    expect(html).toContain('They have not confirmed they are 18 or over.');
    expect(html).not.toContain('MARKER Approved Name');
    expect(html).not.toContain(approved.athleteId);
    expect(html).not.toContain('MARKER-email');
    // The owner and the deputy, active, are not on the page either.
    for (const id of [made.owner.athleteId, made.deputy.athleteId]) {
      expect(html).not.toContain(id);
    }
  });

  it('says the queue could not be read when the route’s answer is not in its shape', async () => {
    const wrapped: readonly Route[] = ROUTES.map((route) =>
      route.path === '/v1/moderation/registrations' && route.method === 'GET'
        ? { ...route, handle: () => Promise.resolve(json({ registrations: [{ athleteId: 1 }] })) }
        : route,
    );
    const made = await world({ routes: wrapped });
    const html = await page(tunnel(made), await codeSession(made));
    expect(html).toContain(escapeHtml(REGISTRATIONS_UNREADABLE_TEXT));
  });
});

describe('a decision through the page, with a fresh passkey, is the moderation route’s own (#2646, ADR 0069 D-8, D-9)', () => {
  it('approves and refuses, read back through the queue, the moderation log and the operator log', async () => {
    const made = await world();
    const first = await made.rider('First');
    const second = await made.rider('Second');
    const browser = tunnel(made);
    const session = await passkeySession(made);

    const approved = await decide(browser, session, 'approve', {
      athleteId: first.athleteId,
      reason: 'A club member',
    });
    expect(approved.status).toBe(200);
    const approvedPage = await approved.text();
    expect(approvedPage).toContain('<p class="notice" role="status">Approved.</p>');
    expect(queuedOf(approvedPage)).toEqual([second.athleteId]);

    const refused = await decide(browser, session, 'refuse', {
      athleteId: second.athleteId,
      reason: 'Unknown to the club',
    });
    expect(refused.status).toBe(200);
    expect(await refused.text()).toContain('<p class="notice" role="status">Refused.</p>');

    // Read back the way the app's Moderation screen and the owner's log read it.
    expect(await queue(made)).toEqual([]);
    expect(await counts(made)).toEqual({ active: 3, pending: 0, suspended: 0 });
    expect(queuedOf(await page(browser, session.token))).toEqual([]);
    expect(
      (await moderationLog(made)).filter((entry) => entry.action.endsWith('_registration')),
    ).toEqual([
      {
        action: 'refuse_registration',
        targetAthleteId: second.athleteId,
        reason: 'Unknown to the club',
      },
      { action: 'approve_registration', targetAthleteId: first.athleteId, reason: 'A club member' },
    ]);
    expect(await decisionLog(made)).toEqual([
      {
        source: 'admin_tunnel',
        action: 'registration_decided',
        detail: 'approved',
        outcome: 'done',
      },
      {
        source: 'admin_tunnel',
        action: 'registration_decided',
        detail: 'refused',
        outcome: 'done',
      },
    ]);
  });

  it('logs a decision made on the server machine under admin_loopback', async () => {
    const made = await world({ loopbackPort: PORT });
    const rider = await made.rider('Local');
    const browser = adminBrowser(made.instance.handler, { loopback: PORT });
    const session = await passkeySession(made, browser);
    const answer = await decide(browser, session, 'approve', {
      athleteId: rider.athleteId,
      reason: 'Seen in person',
    });
    expect(answer.status, await answer.clone().text()).toBe(200);
    expect(await queue(made)).toEqual([]);
    expect(await decisionLog(made)).toEqual([
      {
        source: 'admin_loopback',
        action: 'registration_decided',
        detail: 'approved',
        outcome: 'done',
      },
    ]);
  });

  it('refuses an empty reason with the route’s rule, and a rider no longer waiting, changing nothing', async () => {
    const made = await world();
    const rider = await made.rider('Waiting');
    const other = await made.rider('Already');
    await approvedInApp(made, other);
    const browser = tunnel(made);
    const session = await passkeySession(made);
    const log = await moderationLog(made);

    const empty = await decide(browser, session, 'approve', {
      athleteId: rider.athleteId,
      reason: '   ',
    });
    expect(empty.status).toBe(400);
    expect(await empty.text()).toContain('a decision needs a reason');

    const again = await decide(browser, session, 'refuse', {
      athleteId: other.athleteId,
      reason: 'Too late',
    });
    expect(again.status).toBe(409);
    expect(await again.text()).toContain('that rider is not waiting for approval any more');

    expect(await queue(made)).toEqual([rider.athleteId]);
    expect(await counts(made)).toEqual({ active: 3, pending: 1, suspended: 0 });
    expect(await moderationLog(made)).toEqual(log);
    // The route's refusal of a rider no longer waiting is the decision's: logged refused.
    expect(await decisionLog(made)).toEqual([
      {
        source: 'admin_tunnel',
        action: 'registration_decided',
        detail: 'refused',
        outcome: 'refused',
      },
    ]);
  });
});

describe('a decision the route answered and the queue read back does not show is not said to be made (#2646)', () => {
  it('does not say Approved when the route answered 200 and the rider still waits', async () => {
    // A route that answers as an approval does and changes nothing: the write that reports success while the read cannot see it.
    const forgetful: readonly Route[] = ROUTES.map((route) =>
      route.path === '/v1/moderation/registrations/{athleteId}/approve'
        ? { ...route, handle: () => Promise.resolve(json({ logId: 1 })) }
        : route,
    );
    const made = await world({ routes: forgetful });
    const rider = await made.rider('Waiting');
    const answer = await decide(tunnel(made), await passkeySession(made), 'approve', {
      athleteId: rider.athleteId,
      reason: 'Fine',
    });
    const html = await answer.text();
    expect(html).not.toContain('Approved.');
    expect(html).toContain(escapeHtml(DECISION_NOT_SHOWN_TEXT));
    expect(queuedOf(html)).toEqual([rider.athleteId]);
  });
});

describe('no decision without a fresh passkey check made for it (#2646, ADR 0069 D-4)', () => {
  it('no assertion, a code session, a step-up for another rider, another reason or the other decision, and one used twice change nothing', async () => {
    const made = await world();
    const rider = await made.rider('Waiting');
    const other = await made.rider('Other');
    const browser = tunnel(made);
    const session = await passkeySession(made);
    const csrf = /name="csrf" value="([0-9a-f]{64})"/.exec(await page(browser, session.token))?.[1];
    const fields = { athleteId: rider.athleteId, reason: 'Fine' };

    const bare = await browser.send('POST', '/admin/accounts/approve', {
      cookie: session.token,
      form: { csrf: csrf as string, ...fields },
    });
    expect(bare.status).toBe(403);

    const code = await codeSession(made);
    const codeCsrf = /name="csrf" value="([0-9a-f]{64})"/.exec(await page(browser, code))?.[1];
    const fromCode = await browser.send('POST', '/admin/accounts/approve', {
      cookie: code,
      form: { csrf: codeCsrf as string, ...fields },
    });
    expect(fromCode.status).toBe(403);
    expect(await fromCode.text()).toContain('A change needs a passkey sign-in');

    const forRider = await steppedUpForm(browser, session, 'registration_approve', fields, {
      page: '/admin/accounts',
    });
    for (const [path, form] of [
      ['/admin/accounts/approve', { ...forRider, athleteId: other.athleteId }],
      ['/admin/accounts/approve', { ...forRider, reason: 'Something else' }],
      ['/admin/accounts/refuse', forRider],
    ] as const) {
      const swapped = await browser.send('POST', path, { cookie: session.token, form });
      expect(swapped.status, path).toBe(403);
      // Each attempt took the pending challenge: ask again for the next.
    }

    // A form naming no well-formed account is refused before any step-up is taken.
    const malformed = await browser.send('POST', '/admin/accounts/approve', {
      cookie: session.token,
      form: { ...forRider, athleteId: '../log' },
    });
    expect(malformed.status).toBe(400);

    const once = await steppedUpForm(browser, session, 'registration_approve', fields, {
      page: '/admin/accounts',
    });
    expect(
      (await browser.send('POST', '/admin/accounts/approve', { cookie: session.token, form: once }))
        .status,
    ).toBe(200);
    const replay = await browser.send('POST', '/admin/accounts/refuse', {
      cookie: session.token,
      form: { ...once },
    });
    expect(replay.status).toBe(403);

    // Only the one decision that had its own step-up was made.
    expect(await queue(made)).toEqual([other.athleteId]);
    expect(await decisionLog(made)).toEqual([
      {
        source: 'admin_tunnel',
        action: 'registration_decided',
        detail: 'approved',
        outcome: 'done',
      },
    ]);
  });
});

describe('owner-only, checked on the instance (#2646, the epic’s constraint)', () => {
  it.each(['approve', 'refuse'] as const)(
    '%s: with no session, sent to sign in; once the owner key names another athlete, refused and the session ended — nothing changed, read back',
    async (decision) => {
      const made = await world();
      const rider = await made.rider('Waiting');
      const browser = tunnel(made);
      const session = await passkeySession(made);
      const form = await steppedUpForm(
        browser,
        session,
        `registration_${decision}`,
        { athleteId: rider.athleteId, reason: 'Fine' },
        { page: '/admin/accounts' },
      );
      const log = await moderationLog(made);

      const none = await browser.send('POST', `/admin/accounts/${decision}`, { form });
      expect(none.status).toBe(303);
      expect(none.headers.get('location')).toBe('/admin/sign-in');

      const moved = await handlerOver(made.path, made.clock, {
        owner: made.deputy.device.publicKey,
      });
      restarted.push(moved);
      const refused = await adminBrowser(moved.handler).send(
        'POST',
        `/admin/accounts/${decision}`,
        {
          cookie: session.token,
          form,
        },
      );
      expect(refused.status).toBe(303);
      expect(refused.headers.get('location')).toBe('/admin/sign-in');
      // Read back through the store and the routes: still waiting, the session gone, both logs unchanged.
      expect(
        await made.freshRead(
          async (store) => (await store.getAthlete(rider.athleteId))?.registrationState,
        ),
      ).toBe('pending');
      expect(await queue(made)).toEqual([rider.athleteId]);
      expect(
        await made.freshRead(async (store) =>
          store.findAdminSession(await sha256Hex(session.token)),
        ),
      ).toBeUndefined();
      expect(await moderationLog(made)).toEqual(log);
      expect(await decisionLog(made)).toEqual([]);
    },
  );
});

describe('the operator log entry is the decision’s: a log that cannot be written leaves it unmade (#2646, ADR 0069 D-9)', () => {
  it('answers that something went wrong, the rider still waits, and the moderation log has no row of it', async () => {
    const made = await world();
    const rider = await made.rider('Waiting');
    const browser = tunnel(made);
    const session = await passkeySession(made);
    const form = await steppedUpForm(
      browser,
      session,
      'registration_approve',
      { athleteId: rider.athleteId, reason: 'Fine' },
      { page: '/admin/accounts' },
    );
    const log = await moderationLog(made);
    const database = openDatabase(made.path);
    try {
      database.exec(
        "create trigger refuse_decision_log before insert on operator_log when new.action = 'registration_decided' and new.outcome = 'done' begin select raise(abort, 'the log is down'); end",
      );
    } finally {
      database.close();
    }
    const answer = await browser.send('POST', '/admin/accounts/approve', {
      cookie: session.token,
      form,
    });
    expect(answer.status).toBe(500);
    expect(await answer.text()).toContain('Nothing was changed.');
    expect(await queue(made)).toEqual([rider.athleteId]);
    expect(
      await made.freshRead(
        async (store) => (await store.getAthlete(rider.athleteId))?.registrationState,
      ),
    ).toBe('pending');
    expect(await moderationLog(made)).toEqual(log);
    // The attempt is kept, as failed.
    expect(await decisionLog(made)).toEqual([
      { source: 'admin_tunnel', action: 'registration_decided', detail: null, outcome: 'failed' },
    ]);
  });
});

describe('no secret and no coordinate on any Accounts answer (#2646, CLAUDE.md §6)', () => {
  it('says none of the instance’s secrets, tokens or codes, on the page, its decisions and its refusals, nor in a log line', async () => {
    vi.stubEnv('OYL_INSTANCE_METRICS_TOKEN', 'MARKER-metrics-token-2646-0123456789abcdef');
    vi.stubEnv('CLOUDFLARE_TUNNEL_TOKEN', 'MARKER-tunnel-token-2646');
    const made = await world();
    const first = await made.rider('First');
    const second = await made.rider('Second');
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
    await keep(await browser.send('GET', '/admin/accounts', { cookie: codeToken }));
    await keep(await browser.send('GET', '/admin/accounts', { cookie: session.token }));
    await keep(
      await decide(browser, session, 'approve', { athleteId: first.athleteId, reason: 'Fine' }),
    );
    await keep(
      await decide(browser, session, 'refuse', { athleteId: second.athleteId, reason: 'No' }),
    );
    await keep(
      await browser.send('POST', '/admin/accounts/approve', { cookie: codeToken, form: {} }),
    );
    await keep(
      await browser.send('POST', '/admin/accounts/refuse', { cookie: session.token, form: {} }),
    );
    said.push(...made.instance.lines, JSON.stringify(await decisionLog(made)));
    const everything = said.join('\n');
    for (const marker of [
      secret,
      'MARKER-metrics-token-2646',
      'MARKER-tunnel-token-2646',
      made.owner.token,
      first.token,
      session.token,
      codeToken,
      code,
      code.replaceAll('-', ''),
      made.owner.device.publicKey,
    ]) {
      expect(everything, marker).not.toContain(marker);
    }
    // Nothing on the page is a coordinate: no number with a decimal point at all.
    expect(everything).not.toMatch(/-?\d{1,3}\.\d{4,}/);
  });
});
