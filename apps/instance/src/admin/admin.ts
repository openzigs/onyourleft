// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The instance's own admin pages: the sign-in and the session** (#2641,
 * ADR 0069 D-1, D-2, D-4, D-8). The pages themselves are #2645's; passkeys
 * #2642's; the loopback listener #2643's.
 *
 * Mounted only when the operator sets `OYL_INSTANCE_ADMIN_PAGES=on`
 * (`instance.ts`); otherwise `/admin` is `not_found`, as any path with no
 * route is. Never on the Durable Object adapter, which has no operator CLI to
 * mint a code (ADR 0069 D-2). `handler.ts` sends every `/admin` path here
 * before its route table, and an `/admin` response carries
 * `headers.ts` §`ADMIN_HEADERS` and never the handler's CORS `*`.
 *
 * ## Who may sign in
 *
 * Only **the athlete holding `OYL_INSTANCE_OWNER_KEY`**, and there is no
 * name to type: a good one-time code opens a session for that athlete. The
 * deputy has no admin sign-in at all (ADR 0046 D-9 Q9). Every request asks
 * again: a session whose stored owner key is not the current
 * `OYL_INSTANCE_OWNER_KEY`, or whose athlete no longer holds it
 * (`moderation.roleOf`), is ENDED — its row deleted — and the browser is sent
 * to sign in. With no `OYL_INSTANCE_ORIGIN` (no accounts), no
 * `OYL_INSTANCE_SECRET_KEY` (as every Operate route), no
 * `OYL_INSTANCE_OWNER_KEY`, or no account holding it, the pages say they are
 * unavailable and why, naming the variable and never its value.
 *
 * ## The session
 *
 * A cookie, `__Host-oyl-admin`, `Secure; HttpOnly; SameSite=Strict; Path=/`
 * with no `Max-Age`, carrying 32 random bytes; the store keeps only its
 * SHA-256 (`admin_session`). **15 minutes idle and 2 hours absolute,
 * enforced here from the row**, never by the cookie. A new token at every
 * sign-in, and a cookie already held is never adopted. A code session can
 * read; it changes nothing (ADR 0069 D-1, the owner's Q-A answer), and
 * this issue adds no change for it to make.
 *
 * ## CSRF: three layers (ADR 0069 D-4)
 *
 * `SameSite=Strict`; a synchronizer token in every form of a session, refused
 * when absent or another session's; and every `POST` refused unless its
 * `Origin` is exactly `OYL_INSTANCE_ORIGIN` and its `Sec-Fetch-Site`, when
 * sent, is `same-origin`. The token is the SHA-256 of `oyl-admin-csrf:` and
 * the session's token — 256 bits nobody without the cookie can compute — so
 * the page can render it while the store keeps only ITS SHA-256 too. A
 * refused `POST` changes nothing. A `GET` changes nothing but the session's
 * own last-seen time.
 *
 * ⚠️ **`Host` is checked on every request** (DNS rebinding): it must be the
 * host of `OYL_INSTANCE_ORIGIN`, and any other is told which address to open,
 * with no form and no session read.
 *
 * ## Rate limits and the log
 *
 * Sign-in attempts: at most 10 a minute per client address (the address the
 * Node listener read through `OYL_INSTANCE_CLIENT_ADDRESS_HEADER` from a
 * trusted proxy) and 30 a minute in all (ADR 0069 D-4, which sets these over
 * the issue's 5 a minute and 20 an hour), counted before any code is looked
 * up. Every sign-in is an `admin_sign_in` entry in the operator log, in the
 * same transaction as the code and the session. Refusals are counted in
 * memory, by kind, and {@link Admin.flushRefusals} writes at most one
 * `admin_refused` entry per kind with the count: `instance.ts` runs it every
 * minute and as the instance stops, so a flood cannot grow the append-only
 * log without bound, and a crash loses at most a minute's counts.
 *
 * Nothing here renders a token, a code, a key or a coordinate.
 */

import { randomToken, sha256Hex } from '../auth/crypto.ts';
import type { Caller } from '../auth/identity.ts';
import {
  addressKey,
  createRateLimiter,
  sweepPeriodMs,
  type RateLimit,
} from '../auth/rate-limit.ts';
import { escapeHtml, STYLE } from '../html.ts';
import type { ModeratorRole } from '../moderation/moderation.ts';
import type { ClientInfo } from '../route-kit.ts';
import type { AdminSessionRecord, SqlStore } from '../store/sql-store.ts';
import { adminCodeSha256 } from './code.ts';
import { adminResponse } from './headers.ts';

/** The session cookie's name on the tunnel listener (ADR 0069 D-4). */
export const ADMIN_COOKIE = '__Host-oyl-admin';

/** A session not used for this long is over, in seconds. */
export const ADMIN_IDLE_SECONDS = 15 * 60;

/** A session is over this long after it was opened, however it was used, in seconds. */
export const ADMIN_LIFETIME_SECONDS = 2 * 60 * 60;

/** The largest form an `/admin` `POST` may send, in bytes: a code or a token, and nothing more. */
export const ADMIN_FORM_LIMIT_BYTES = 4096;

export interface AdminLimits {
  /** Sign-in attempts per client address. */
  readonly perAddress: RateLimit;
  /** Sign-in attempts from everybody together. */
  readonly overall: RateLimit;
}

export const DEFAULT_ADMIN_LIMITS: AdminLimits = {
  perAddress: { limit: 10, windowMs: 60_000 },
  overall: { limit: 30, windowMs: 60_000 },
};

/** What a refusal is counted as, in its `admin_refused` entry. */
export type AdminRefusal = 'code' | 'csrf' | 'origin' | 'rate_limited';

/**
 * The seam ADR 0069 D-2 decides: a route of the table called IN-PROCESS, as
 * the owner, through every check the route declares — never a method, path
 * or query from the browser. `handler.ts` builds it; a route whose `admin`
 * is not `read` or `change` is `not_found` there before it is called.
 */
export interface AdminSeam {
  dispatch(method: 'GET', path: string, owner: Caller, client: ClientInfo): Promise<Response>;
}

export interface AdminOptions {
  readonly store: SqlStore;
  /** `OYL_INSTANCE_ORIGIN`, or `null`: no accounts, so no owner. */
  readonly origin: string | null;
  /** `OYL_INSTANCE_OWNER_KEY`, or `undefined`. */
  readonly ownerKey: string | undefined;
  /** Whether `OYL_INSTANCE_SECRET_KEY` is set. */
  readonly secretKeySet: boolean;
  /** The accounts' `moderation.roleOf`, or `undefined` with no accounts. */
  readonly roleOf: ((athleteId: string) => Promise<ModeratorRole | undefined>) | undefined;
  /** Unix milliseconds. */
  readonly now: () => number;
  /** What the operator calls the instance, or `null`. */
  readonly name: string | null;
  readonly limits?: AdminLimits;
}

export interface Admin {
  /** Answer a request whose path is `/admin` or under it. `body` is a `POST`'s, read within {@link ADMIN_FORM_LIMIT_BYTES}. */
  handle(
    request: Request,
    body: Uint8Array | null | 'too-large',
    client: ClientInfo,
    seam: AdminSeam,
  ): Promise<Response>;
  /** Write one `admin_refused` entry per kind refused since the last flush, and forget the counts. */
  flushRefusals(): Promise<void>;
  /** Forget every rate-limit key whose window has ended (#892's promise: an address for at most its window). */
  sweepRateLimits(): void;
  readonly rateLimitSweepPeriodMs: number;
}

/** Whether `pathname` is the admin pages'. */
export function isAdminPath(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

/** The admin frame: the stylesheet linked, never inline. `body` is markup the caller escaped. */
function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/admin/admin.css">
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}

const HTML = { 'content-type': 'text/html; charset=utf-8' } as const;

function htmlAnswer(
  title: string,
  body: string,
  status: number,
  extra: Readonly<Record<string, string>> = {},
): Response {
  return adminResponse(page(title, body), status, { ...HTML, ...extra });
}

const seeOther = (location: string, extra: Readonly<Record<string, string>> = {}): Response =>
  adminResponse(null, 303, { location, ...extra });

/** The page an `/admin` request that threw is answered with: no message, no stack. */
export function adminInternalError(): Response {
  return htmlAnswer(
    'Something went wrong',
    '<h1>Something went wrong</h1>\n<p>The instance could not answer this page. Nothing was changed. Try again.</p>',
    500,
  );
}

/** Why the admin pages are unavailable, naming the variable and never its value. */
type Unavailable = 'origin' | 'secret' | 'owner-key' | 'no-owner';

const UNAVAILABLE: Readonly<Record<Unavailable, string>> = {
  origin:
    'OYL_INSTANCE_ORIGIN is not set, so this instance has no accounts, and no owner to sign in.',
  secret:
    'OYL_INSTANCE_SECRET_KEY is not set: the admin pages are served only on an instance that holds keys, as the app’s Operate area is.',
  'owner-key': 'OYL_INSTANCE_OWNER_KEY is not set, so this instance has no owner to sign in.',
  'no-owner':
    'No account holds the device key OYL_INSTANCE_OWNER_KEY names. Sign in to this instance once from the app on that device, then come back.',
};

/** The owner, as the seam calls a route for them. */
interface Owner {
  readonly athleteId: string;
  readonly ownerKey: string;
  readonly standing: Caller['standing'];
}

/** A cookie's value from a `Cookie` header, or `undefined`. */
function cookieValue(header: string | null, name: string): string | undefined {
  if (header === null) return undefined;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return undefined;
}

/** A session token as {@link randomToken} writes 32 bytes: 43 base64url characters. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Two strings compared in time that depends on their length alone. */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

/** The session's synchronizer token, from its cookie's token (see the header). */
const csrfOf = (token: string): Promise<string> => sha256Hex(`oyl-admin-csrf:${token}`);

const cookieFor = (token: string): string =>
  `${ADMIN_COOKIE}=${token}; Secure; HttpOnly; SameSite=Strict; Path=/`;
const CLEARED_COOKIE = `${ADMIN_COOKIE}=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;

/** The form fields of a `POST`, or none. */
function formOf(body: Uint8Array | null): URLSearchParams {
  return new URLSearchParams(body === null ? '' : new TextDecoder().decode(body));
}

/** The paths the admin layer answers, and the methods each takes. */
const METHODS: Readonly<Record<string, readonly string[]>> = {
  '/admin': ['GET'],
  '/admin/sign-in': ['GET', 'POST'],
  '/admin/sign-out': ['POST'],
  '/admin/admin.css': ['GET'],
};

export function createAdmin(options: AdminOptions): Admin {
  const { store } = options;
  const limits = options.limits ?? DEFAULT_ADMIN_LIMITS;
  const perAddress = createRateLimiter(limits.perAddress, options.now);
  const overall = createRateLimiter(limits.overall, options.now);
  const seconds = (): number => Math.floor(options.now() / 1000);
  const expected = options.origin === null ? null : new URL(options.origin);
  const refused = new Map<AdminRefusal, number>();
  const refuse = (kind: AdminRefusal): void => {
    refused.set(kind, (refused.get(kind) ?? 0) + 1);
  };
  const title = options.name === null ? 'this instance' : options.name;

  async function ownerNow(): Promise<Owner | Unavailable> {
    if (expected === null || options.roleOf === undefined) return 'origin';
    if (!options.secretKeySet) return 'secret';
    const ownerKey = options.ownerKey;
    if (ownerKey === undefined) return 'owner-key';
    const key = await store.findDeviceKey(ownerKey);
    if (key === undefined) return 'no-owner';
    // The accounts' own rule (#2602): the athlete holds the key, unrevoked.
    if ((await options.roleOf(key.athleteId)) !== 'owner') return 'no-owner';
    const athlete = await store.getAthlete(key.athleteId);
    if (athlete === undefined) return 'no-owner';
    return {
      athleteId: key.athleteId,
      ownerKey,
      standing:
        athlete.suspendedAt !== null
          ? 'suspended'
          : athlete.registrationState === 'pending'
            ? 'pending'
            : 'active',
    };
  }

  /** The presented cookie's token and its hash, when it is the shape of one. */
  async function presented(request: Request): Promise<{ token: string; sha: string } | undefined> {
    const token = cookieValue(request.headers.get('cookie'), ADMIN_COOKIE);
    if (token === undefined || !TOKEN.test(token)) return undefined;
    return { token, sha: await sha256Hex(token) };
  }

  /**
   * The live session the request carries, its idle clock restarted; or
   * `undefined`, and a session that is over — idle, too old, or no longer
   * the current owner's — is ended on the way.
   */
  async function sessionOf(
    request: Request,
    owner: Owner,
  ): Promise<{ readonly record: AdminSessionRecord; readonly token: string } | undefined> {
    const cookie = await presented(request);
    if (cookie === undefined) return undefined;
    const record = await store.findAdminSession(cookie.sha);
    if (record === undefined) return undefined;
    const at = seconds();
    const live =
      record.expiresAt > at &&
      record.lastSeenAt + ADMIN_IDLE_SECONDS > at &&
      record.listener === 'tunnel' &&
      record.ownerKey === owner.ownerKey &&
      record.athleteId === owner.athleteId;
    if (!live) {
      await store.endAdminSession(cookie.sha);
      return undefined;
    }
    await store.touchAdminSession(cookie.sha, at);
    return { record, token: cookie.token };
  }

  /** Layer 3: the request came from this origin's own page. */
  function fromOurPage(request: Request): boolean {
    if (expected === null || request.headers.get('origin') !== expected.origin) return false;
    const site = request.headers.get('sec-fetch-site');
    return site === null || site === 'same-origin';
  }

  function signInPage(problem: boolean, status: number): Response {
    const described = problem ? ' aria-describedby="code-problem"' : '';
    return htmlAnswer(
      'Sign in',
      `<h1>Sign in to the admin pages of ${escapeHtml(title)}</h1>
<p>Only the instance’s owner can sign in. On the server machine, run <code>node src/operator/cli.ts admin-code</code> (in the home deployment, <code>docker compose exec instance node src/operator/cli.ts admin-code</code>) and type the code it prints. A code works once, for 10 minutes.</p>
<form method="post" action="/admin/sign-in">
<label for="code">One-time code</label>
${problem ? '<p class="problem" id="code-problem">That code was not accepted. A code works once, for 10 minutes: mint a new one on the server machine.</p>\n' : ''}<input type="text" id="code" name="code" autocomplete="one-time-code" autocapitalize="none" spellcheck="false" required${described}>
<button type="submit">Sign in</button>
</form>`,
      status,
    );
  }

  const refusedForm = (): Response =>
    htmlAnswer(
      'Not accepted',
      '<h1>That form was not accepted</h1>\n<p>It did not come from this instance’s own admin page, so nothing was changed. <a href="/admin">Go back to the admin pages</a> and try again.</p>',
      403,
    );

  async function landing(
    owner: Owner,
    session: AdminSessionRecord,
    token: string,
    client: ClientInfo,
    seam: AdminSeam,
  ): Promise<Response> {
    // ADR 0069 D-2's seam, round trip: the version from GET /v1/operate/status.
    const status = await seam.dispatch(
      'GET',
      '/v1/operate/status',
      {
        athleteId: owner.athleteId,
        deviceKey: owner.ownerKey,
        tokenSha256: session.tokenSha256,
        standing: owner.standing,
      },
      client,
    );
    let version: string | undefined;
    if (status.status === 200) {
      const read = (await status.json()) as { version?: unknown };
      if (typeof read.version === 'string') version = read.version;
    }
    const csrf = await csrfOf(token);
    return htmlAnswer(
      'Admin',
      `<h1>Admin pages of ${escapeHtml(title)}</h1>
<p>You are signed in as the instance’s owner, with a one-time code.</p>
<p>${version === undefined ? 'The instance’s status could not be read.' : `Version ${escapeHtml(version)}, read from the instance’s status.`}</p>
<p class="hint">This session ends after 15 minutes without use, and 2 hours after you signed in.</p>
<form method="post" action="/admin/sign-out">
<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
<button type="submit">Sign out</button>
</form>`,
      200,
    );
  }

  async function signIn(
    request: Request,
    body: Uint8Array | null,
    owner: Owner,
    client: ClientInfo,
  ): Promise<Response> {
    if (!fromOurPage(request)) {
      refuse('origin');
      return refusedForm();
    }
    // Counted before any code is looked at, so a flood never reaches the store.
    const addressAllowed = perAddress.allow(addressKey(client.address ?? 'unknown'));
    if (!addressAllowed || !overall.allow('all')) {
      refuse('rate_limited');
      return htmlAnswer(
        'Too many attempts',
        '<h1>Too many sign-in attempts</h1>\n<p>Wait a minute, then <a href="/admin/sign-in">try again</a>.</p>',
        429,
        { 'retry-after': '60' },
      );
    }
    const codeSha256 = await adminCodeSha256(formOf(body).get('code') ?? '');
    const at = seconds();
    const token = randomToken(32);
    const opened =
      codeSha256 === undefined
        ? 'refused'
        : await store.openAdminSessionWithCode({
            codeSha256,
            source: 'admin_tunnel',
            idleSeconds: ADMIN_IDLE_SECONDS,
            session: {
              tokenSha256: await sha256Hex(token),
              athleteId: owner.athleteId,
              ownerKey: owner.ownerKey,
              listener: 'tunnel',
              strength: 'code',
              csrfSha256: await sha256Hex(await csrfOf(token)),
              createdAt: at,
              lastSeenAt: at,
              expiresAt: at + ADMIN_LIFETIME_SECONDS,
            },
          });
    if (opened === 'refused') {
      refuse('code');
      return signInPage(true, 400);
    }
    // A session this browser held before is never carried on (no fixation).
    const before = await presented(request);
    if (before !== undefined) await store.endAdminSession(before.sha);
    return seeOther('/admin', { 'set-cookie': cookieFor(token) });
  }

  async function signOut(
    request: Request,
    body: Uint8Array | null,
    owner: Owner,
  ): Promise<Response> {
    if (!fromOurPage(request)) {
      refuse('origin');
      return refusedForm();
    }
    const session = await sessionOf(request, owner);
    if (session === undefined) return seeOther('/admin/sign-in', { 'set-cookie': CLEARED_COOKIE });
    const sent = formOf(body).get('csrf');
    if (sent === null || !sameText(await sha256Hex(sent), session.record.csrfSha256)) {
      refuse('csrf');
      return refusedForm();
    }
    await store.endAdminSession(session.record.tokenSha256);
    return seeOther('/admin/sign-in', { 'set-cookie': CLEARED_COOKIE });
  }

  return {
    async handle(request, body, client, seam) {
      if (expected === null) {
        return htmlAnswer(
          'Unavailable',
          `<h1>The admin pages are unavailable</h1>\n<p>${escapeHtml(UNAVAILABLE.origin)}</p>`,
          503,
        );
      }
      // Against DNS rebinding: the page is this origin's, or it is not served.
      if (request.headers.get('host') !== expected.host) {
        return htmlAnswer(
          'Wrong address',
          `<h1>Open the admin pages at their own address</h1>\n<p>They are served at <a href="${escapeHtml(expected.origin)}/admin">${escapeHtml(expected.origin)}/admin</a> only.</p>`,
          421,
        );
      }
      const path = new URL(request.url).pathname;
      const methods = METHODS[path];
      if (methods === undefined) {
        return htmlAnswer(
          'Not found',
          '<h1>Not found</h1>\n<p>There is no admin page at this address. <a href="/admin">Go to the admin pages</a>.</p>',
          404,
        );
      }
      if (!methods.includes(request.method)) {
        return htmlAnswer(
          'Not allowed',
          '<h1>Not allowed</h1>\n<p>This admin page does not take that request.</p>',
          405,
          { allow: methods.join(', ') },
        );
      }
      if (path === '/admin/admin.css') {
        return adminResponse(STYLE, 200, { 'content-type': 'text/css; charset=utf-8' });
      }
      if (body === 'too-large') {
        return htmlAnswer(
          'Too large',
          '<h1>That form was too large</h1>\n<p>Nothing was changed.</p>',
          413,
        );
      }
      const owner = await ownerNow();
      if (typeof owner === 'string') {
        // A session of an owner who is no longer one goes now, not at its end.
        if (owner === 'owner-key' || owner === 'no-owner') {
          const cookie = await presented(request);
          if (cookie !== undefined) await store.endAdminSession(cookie.sha);
        }
        return htmlAnswer(
          'Unavailable',
          `<h1>The admin pages are unavailable</h1>\n<p>${escapeHtml(UNAVAILABLE[owner])}</p>`,
          503,
        );
      }
      if (request.method === 'POST') {
        return path === '/admin/sign-in'
          ? signIn(request, body, owner, client)
          : signOut(request, body, owner);
      }
      const session = await sessionOf(request, owner);
      if (path === '/admin/sign-in') {
        return session === undefined ? signInPage(false, 200) : seeOther('/admin');
      }
      if (session === undefined) return seeOther('/admin/sign-in');
      return landing(owner, session.record, session.token, client, seam);
    },

    async flushRefusals() {
      const held = [...refused];
      refused.clear();
      for (const [kind, count] of held) {
        try {
          await store.recordOperatorAction(
            {
              actor: { source: 'admin_tunnel', athleteId: null },
              action: 'admin_refused',
              at: seconds(),
            },
            () => ({
              outcome: 'refused',
              detail: `${kind},refused=${String(Math.min(count, 999_999_999))}`,
              value: undefined,
            }),
          );
        } catch {
          // A count the log cannot take is lost, as a crash loses a minute's.
        }
      }
    },

    sweepRateLimits() {
      perAddress.sweep();
      overall.sweep();
    },
    rateLimitSweepPeriodMs: sweepPeriodMs([limits.perAddress, limits.overall]),
  };
}
