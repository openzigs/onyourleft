// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The instance's own admin pages: the sign-in, the session and the
 * owner's passkeys** (#2641, #2642, ADR 0069 D-1, D-2, D-4, D-8). The Operate
 * pages themselves are #2645's and after.
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
 * name to type: a good one-time code, or an assertion by one of the owner's
 * passkeys, opens a session for that athlete. The deputy has no admin sign-in
 * at all (ADR 0046 D-9 Q9). Every request asks again: a session whose stored
 * owner key is not the current `OYL_INSTANCE_OWNER_KEY`, or whose athlete no
 * longer holds it (`moderation.roleOf`), is ENDED — its row deleted — and the
 * browser is sent to sign in. With no `OYL_INSTANCE_ORIGIN` (no accounts), no
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
 * sign-in, and a cookie already held is never adopted.
 *
 * ## Passkeys (#2642, ADR 0069 D-1, and the owner's answers to Q-A and Q-C)
 *
 * - **A code session can read every page and enrol ONE passkey**, and
 *   nothing else, on either listener (Q-A: no). Enrolling ends it, and the
 *   owner signs in with the new passkey, which proves it works.
 * - **The RP ID is the host of `OYL_INSTANCE_ORIGIN`** and the origin is
 *   checked exactly; a passkey whose stored RP ID is another host stays
 *   listed, marked not usable here, until it is revoked. `userVerification:
 *   'required'`, `attestation: 'none'`, Ed25519 and ES256 only, at most ten.
 *   The verifier is `webauthn.ts`, by hand against WebCrypto (D-6).
 * - **A passkey is bound to the `OYL_INSTANCE_OWNER_KEY` it was enrolled
 *   under**: once the operator names another key, it signs nobody in until
 *   it is revoked, as a session of the old key ends (the epic's owner-only
 *   constraint, read for passkeys).
 * - **A passkey enrolled through the tunnel reads, and changes nothing,
 *   until `operator admin-passkeys confirm <id>` is run on the host** (Q-C,
 *   limit 2): an edge that substituted its own credential at enrolment
 *   cannot confirm it.
 * - **Every change needs a fresh step-up** (D-4, `step-up.ts`): an assertion
 *   by a CONFIRMED passkey, in the same `POST`, over a challenge the instance
 *   issued for this session, for that action and the SHA-256 of its fields,
 *   single use, two minutes. Revoking a passkey is the one change this issue
 *   adds; it ends every session that passkey opened.
 *
 * ## Two listeners (#2643, ADR 0069 D-4, D-5)
 *
 * The main one, through the tunnel: origin `OYL_INSTANCE_ORIGIN`, cookie
 * `__Host-oyl-admin`, RP ID its host, log source `admin_tunnel`. And, when
 * `OYL_INSTANCE_ADMIN_LOOPBACK_PORT` is set, the loopback one: origin
 * `http://localhost:<port>`, cookie {@link LOOPBACK_COOKIE}, RP ID
 * `localhost`, source `admin_loopback`. Which one a request came in on is
 * `ClientInfo.listener`, written by the adapter that owns the listener and
 * never by a header or a peer address; a session or a passkey of one is
 * nothing on the other. ⚠️ The loopback listener grants NOTHING the tunnel
 * does not — a passkey enrolled there needs the host's confirm too — because
 * on Docker Desktop the tunnel container can reach it
 * (docs/operating-an-instance.md, "Admin pages on the server machine").
 * The optional `OYL_INSTANCE_ADMIN_ADDRESSES` refuses a TUNNEL sign-in from
 * any address it does not list, before the code is looked at.
 *
 * ## CSRF: three layers (ADR 0069 D-4)
 *
 * `SameSite=Strict`; a synchronizer token in every form of a session, refused
 * when absent or another session's; and every `POST` refused unless its
 * `Origin` is exactly `OYL_INSTANCE_ORIGIN` and its `Sec-Fetch-Site`, when
 * sent, is `same-origin` (the loopback listener's own origin there). The token is the SHA-256 of `oyl-admin-csrf:` and
 * the session's token — 256 bits nobody without the cookie can compute — so
 * the page can render it while the store keeps only ITS SHA-256 too. A
 * refused `POST` changes nothing. A `GET` changes nothing but the session's
 * own last-seen time.
 *
 * ⚠️ **`Host` is checked on every request** (DNS rebinding): it must be the
 * host of `OYL_INSTANCE_ORIGIN` — `localhost:<port>` on the loopback
 * listener — and any other is told which address to open,
 * with no form and no session read.
 *
 * ## Rate limits and the log
 *
 * Sign-in attempts — a code redeemed, a passkey sign-in begun or finished:
 * at most 10 a minute per client address and 30 a minute in all (ADR 0069
 * D-4); step-up challenges at most 30 a minute per session. Every sign-in is
 * an `admin_sign_in` entry, every enrolment an `admin_passkey_enrolled` and
 * every revocation an `admin_passkey_revoked`, each in the same transaction
 * as its change. Refusals are counted in memory, by kind, and
 * {@link Admin.flushRefusals} writes at most one `admin_refused` entry per
 * kind with the count: `instance.ts` runs it every minute and as the
 * instance stops, so a flood cannot grow the append-only log without bound,
 * and a crash loses at most a minute's counts.
 *
 * Nothing here renders a token, a code, a key or a coordinate.
 */

import { randomHex, randomToken, sha256Hex } from '../auth/crypto.ts';
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
import type {
  AdminPasskeyRecord,
  AdminSessionRecord,
  AdminSource,
  OperatorChange,
  SqlStore,
} from '../store/sql-store.ts';
import { adminCodeSha256 } from './code.ts';
import { adminResponse } from './headers.ts';
import { PASSKEY_SCRIPT } from './passkey-script.ts';
import {
  ADMIN_CHALLENGE_SECONDS,
  ADMIN_CHANGES,
  bindingOf,
  boundFields,
  isAdminChange,
  type AdminChange,
} from './step-up.ts';
import {
  challengeOf,
  COSE_ALGORITHMS,
  fromBase64Url,
  MAX_CREDENTIAL_ID_BYTES,
  verifyAssertion,
  verifyRegistration,
  WebAuthnRefused,
  type AssertionResponse,
} from './webauthn.ts';

/** The session cookie's name on the tunnel listener (ADR 0069 D-4). */
export const ADMIN_COOKIE = '__Host-oyl-admin';

/**
 * The session cookie's name on the loopback listener (#2643, ADR 0069 D-4):
 * no `__Host-` prefix and no `Secure`, because WebKit 26.6 keeps neither on
 * `http://localhost` — measured with `tools/admin-cookie-probe.ts`; Chromium
 * 153, Chrome 157 and Firefox 155 keep both. The server checks the token,
 * never the name.
 */
export const LOOPBACK_COOKIE = 'oyl-admin-loopback';

/** Which listener a request came in on: the main one (through the tunnel), or the loopback one. */
export type AdminListener = 'tunnel' | 'loopback';

/** One listener's admin pages. */
type AdminSeamHandler = (
  request: Request,
  body: Uint8Array | null | 'too-large',
  client: ClientInfo,
  seam: AdminSeam,
) => Promise<Response>;

/** A session not used for this long is over, in seconds. */
export const ADMIN_IDLE_SECONDS = 15 * 60;

/** A session is over this long after it was opened, however it was used, in seconds. */
export const ADMIN_LIFETIME_SECONDS = 2 * 60 * 60;

/**
 * The largest form an `/admin` `POST` may send, in bytes: a code or a token,
 * or a passkey ceremony's response: a credential id of the longest WebAuthn
 * allows, its key and its client data come to about 2.2 KiB as base64url.
 */
export const ADMIN_FORM_LIMIT_BYTES = 4096;

/** The most passkeys the owner may hold (ADR 0069 D-1). */
export const MAX_ADMIN_PASSKEYS = 10;

/** The longest name the owner may give a passkey, in characters. */
export const PASSKEY_LABEL_LIMIT = 60;

export interface AdminLimits {
  /** Sign-in attempts per client address. */
  readonly perAddress: RateLimit;
  /** Sign-in attempts from everybody together. */
  readonly overall: RateLimit;
  /** Step-up challenges per session (#2642); 30 a minute unless a test sets its own. */
  readonly stepUpPerSession?: RateLimit;
}

export const DEFAULT_ADMIN_LIMITS: Required<AdminLimits> = {
  perAddress: { limit: 10, windowMs: 60_000 },
  overall: { limit: 30, windowMs: 60_000 },
  stepUpPerSession: { limit: 30, windowMs: 60_000 },
};

/** What a refusal is counted as, in its `admin_refused` entry. */
export type AdminRefusal =
  'address' | 'code' | 'passkey' | 'step_up' | 'counter' | 'csrf' | 'origin' | 'rate_limited';

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
  /**
   * `OYL_INSTANCE_ADMIN_LOOPBACK_PORT` (#2643, ADR 0069 D-5): the port the
   * loopback listener is on, and so its origin `http://localhost:<port>` —
   * or `undefined`, and there is none.
   */
  readonly loopbackPort?: number;
  /**
   * `OYL_INSTANCE_ADMIN_ADDRESSES` (#2643, ADR 0069 D-5): the only client
   * addresses a TUNNEL sign-in is taken from, read through the trusted
   * proxies; empty or absent, any. Defence in depth for a widened WAF rule,
   * not against the edge.
   */
  readonly addresses?: readonly string[];
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

/** The one script, linked on the pages with a passkey ceremony; never inline. */
const SCRIPT_TAG = '<script src="/admin/passkey.js" defer></script>\n';

/** The admin frame: the stylesheet linked, never inline. `body` is markup the caller escaped. */
function page(title: string, body: string, script = false): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/admin/admin.css">
${script ? SCRIPT_TAG : ''}</head>
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
  script = false,
): Response {
  return adminResponse(page(title, body, script), status, { ...HTML, ...extra });
}

/** A ceremony's options, or its refusal, for the page's own script. */
const jsonAnswer = (value: unknown, status: number): Response =>
  adminResponse(JSON.stringify(value), status, { 'content-type': 'application/json' });

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

/** The form fields of a `POST`, or none. */
function formOf(body: Uint8Array | null): URLSearchParams {
  return new URLSearchParams(body === null ? '' : new TextDecoder().decode(body));
}

/** A field sent once, or `undefined`. */
function single(form: URLSearchParams, name: string): string | undefined {
  const values = form.getAll(name);
  return values.length === 1 ? values[0] : undefined;
}

/** The base64url of the longest credential id. */
const MAX_CREDENTIAL_ID_TEXT = Math.ceil((MAX_CREDENTIAL_ID_BYTES * 4) / 3);

/** An assertion as the page's script submits it, decoded; `undefined` when it is not one. */
function assertionFrom(
  form: URLSearchParams,
): { readonly credentialId: string; readonly response: AssertionResponse } | undefined {
  const credentialId = single(form, 'credential');
  const parts = ['clientDataJSON', 'authenticatorData', 'signature'].map((name) => {
    const text = single(form, name);
    return text === undefined ? undefined : fromBase64Url(text);
  });
  const [clientDataJSON, authenticatorData, signature] = parts;
  if (
    credentialId === undefined ||
    credentialId.length === 0 ||
    credentialId.length > MAX_CREDENTIAL_ID_TEXT ||
    fromBase64Url(credentialId) === undefined ||
    clientDataJSON === undefined ||
    authenticatorData === undefined ||
    signature === undefined
  ) {
    return undefined;
  }
  return { credentialId, response: { clientDataJSON, authenticatorData, signature } };
}

/** A passkey's name as the owner typed it: trimmed, 1 to 60 characters, no control character. */
function labelFrom(form: URLSearchParams): string | undefined {
  const label = single(form, 'label')?.trim();
  if (label === undefined || label.length === 0 || [...label].length > PASSKEY_LABEL_LIMIT) {
    return undefined;
  }
  // eslint-disable-next-line no-control-regex -- the control characters are what is refused
  return /[\u0000-\u001f\u007f]/.test(label) ? undefined : label;
}

/** A moment, in UTC: the same on every screen. */
const when = (seconds: number): string =>
  `${new Date(seconds * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/** A passkey id as {@link randomHex} writes 8 bytes. */
const PASSKEY_ID = /^[0-9a-f]{16}$/;
const REVOKE_PATH = /^\/admin\/passkeys\/([^/]+)\/revoke$/;

/** The paths the admin layer answers, and the methods each takes. */
const METHODS: Readonly<Record<string, readonly string[]>> = {
  '/admin': ['GET'],
  '/admin/sign-in': ['GET', 'POST'],
  '/admin/sign-in/passkey-options': ['POST'],
  '/admin/sign-in/passkey': ['POST'],
  '/admin/sign-out': ['POST'],
  '/admin/passkeys': ['GET'],
  '/admin/passkeys/options': ['POST'],
  '/admin/passkeys/add': ['POST'],
  '/admin/passkeys/{id}/revoke': ['POST'],
  '/admin/step-up': ['POST'],
  '/admin/admin.css': ['GET'],
  '/admin/passkey.js': ['GET'],
};

/** What the sign-in page says above its forms. */
type SignInNotice = 'code-refused' | 'passkey-refused' | 'enrolled' | null;

export function createAdmin(options: AdminOptions): Admin {
  const { store } = options;
  const limits = { ...DEFAULT_ADMIN_LIMITS, ...options.limits };
  const perAddress = createRateLimiter(limits.perAddress, options.now);
  const overall = createRateLimiter(limits.overall, options.now);
  const stepUps = createRateLimiter(limits.stepUpPerSession, options.now);
  const seconds = (): number => Math.floor(options.now() / 1000);
  const expected = options.origin === null ? null : new URL(options.origin);
  /** Refusals since the last flush, by listener's source and kind. */
  const refused = new Map<`${AdminSource}:${AdminRefusal}`, number>();
  const title = options.name === null ? 'this instance' : options.name;
  const allowed = new Set((options.addresses ?? []).map((address) => addressKey(address)));

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

  /**
   * The admin pages as one listener serves them (#2643, ADR 0069 D-4, D-5):
   * its origin, `Host`, RP ID, cookie and operator log source. A session or
   * a passkey of one listener is nothing on the other. `origin` is the
   * tunnel's `OYL_INSTANCE_ORIGIN`, set: {@link Admin.handle} says the pages
   * are unavailable without it before it gets here.
   */
  function placeFor(listener: AdminListener, origin: URL): AdminSeamHandler {
    const loopbackPort = options.loopbackPort;
    const place =
      listener === 'loopback' && loopbackPort !== undefined
        ? {
            origin: `http://localhost:${String(loopbackPort)}`,
            host: `localhost:${String(loopbackPort)}`,
            rpId: 'localhost',
          }
        : { origin: origin.origin, host: origin.host, rpId: origin.hostname };
    const source: AdminSource = listener === 'loopback' ? 'admin_loopback' : 'admin_tunnel';
    const cookieName = listener === 'loopback' ? LOOPBACK_COOKIE : ADMIN_COOKIE;
    // The tunnel's is `__Host-` and `Secure`; the loopback's neither, because
    // WebKit keeps neither on `http://localhost` (#2643's probe).
    const attributes =
      listener === 'loopback'
        ? 'HttpOnly; SameSite=Strict; Path=/'
        : 'Secure; HttpOnly; SameSite=Strict; Path=/';
    const cookieFor = (token: string): string => `${cookieName}=${token}; ${attributes}`;
    const CLEARED_COOKIE = `${cookieName}=; ${attributes}; Max-Age=0`;
    const refuse = (kind: AdminRefusal): void => {
      const key = `${source}:${kind}` as const;
      refused.set(key, (refused.get(key) ?? 0) + 1);
    };

    /** The presented cookie's token and its hash, when it is the shape of one. */
    async function presented(
      request: Request,
    ): Promise<{ token: string; sha: string } | undefined> {
      const token = cookieValue(request.headers.get('cookie'), cookieName);
      if (token === undefined || !TOKEN.test(token)) return undefined;
      return { token, sha: await sha256Hex(token) };
    }

    interface Session {
      readonly record: AdminSessionRecord;
      readonly token: string;
    }

    /**
     * The live session the request carries, its idle clock restarted; or
     * `undefined`, and a session that is over — idle, too old, or no longer
     * the current owner's — is ended on the way.
     */
    async function sessionOf(request: Request, owner: Owner): Promise<Session | undefined> {
      const cookie = await presented(request);
      if (cookie === undefined) return undefined;
      const record = await store.findAdminSession(cookie.sha);
      if (record === undefined) return undefined;
      const at = seconds();
      const live =
        record.expiresAt > at &&
        record.lastSeenAt + ADMIN_IDLE_SECONDS > at &&
        record.listener === listener &&
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
      if (request.headers.get('origin') !== place.origin) return false;
      const site = request.headers.get('sec-fetch-site');
      return site === null || site === 'same-origin';
    }

    /** The WebAuthn RP ID and origin of this listener (ADR 0069 D-1). */
    function relyingParty(): { readonly rpId: string; readonly origin: string } {
      return { rpId: place.rpId, origin: place.origin };
    }

    /** A sign-in attempt counted, per address and in all, BEFORE anything is looked up. */
    function attemptAllowed(client: ClientInfo): boolean {
      const addressAllowed = perAddress.allow(addressKey(client.address ?? 'unknown'));
      return addressAllowed && overall.allow('all');
    }

    /**
     * The optional allowlist (ADR 0069 D-5): a TUNNEL sign-in only from an
     * address `OYL_INSTANCE_ADMIN_ADDRESSES` names, read through the trusted
     * proxies; the loopback listener is not asked. Checked before any code or
     * passkey is looked at.
     */
    function addressListed(client: ClientInfo): boolean {
      if (listener === 'loopback' || allowed.size === 0) return true;
      return client.address !== null && allowed.has(addressKey(client.address));
    }

    const notListed = (): Response =>
      htmlAnswer(
        'Not from here',
        '<h1>Not signed in</h1>\n<p>This instance takes an admin sign-in through the tunnel only from the addresses its operator listed. Sign in on the server machine instead.</p>',
        403,
      );

    const tooMany = (): Response =>
      htmlAnswer(
        'Too many attempts',
        '<h1>Too many sign-in attempts</h1>\n<p>Wait a minute, then <a href="/admin/sign-in">try again</a>.</p>',
        429,
        { 'retry-after': '60' },
      );

    function signInPage(notice: SignInNotice, status: number): Response {
      const codeProblem = notice === 'code-refused';
      const described = codeProblem ? ' aria-describedby="code-problem"' : '';
      const top =
        notice === 'enrolled'
          ? '<p class="notice" role="status">Your passkey was added, and the one-time code’s session has ended. Sign in with the passkey now. A new passkey can read every page and changes nothing until you confirm it on the server machine: <code>operator admin-passkeys confirm &lt;id&gt;</code>, with the id <code>operator admin-passkeys list</code> shows.</p>\n'
          : notice === 'passkey-refused'
            ? '<p class="problem" role="alert">That passkey was not accepted, so you are not signed in. Try again, or sign in with a one-time code.</p>\n'
            : '';
      return htmlAnswer(
        'Sign in',
        `<h1>Sign in to the admin pages of ${escapeHtml(title)}</h1>
${top}<p>Only the instance’s owner can sign in.</p>
<h2>With a passkey</h2>
<form method="post" action="/admin/sign-in/passkey" data-passkey="sign-in" data-passkey-supported hidden>
<button type="submit">Sign in with a passkey</button>
<p data-passkey-status role="status"></p>
</form>
<p data-passkey-unsupported>This browser cannot use a passkey on this page, or the page’s script is blocked. Sign in with a one-time code instead.</p>
<h2>With a one-time code</h2>
<p>On the server machine, run <code>node src/operator/cli.ts admin-code</code> (in the home deployment, <code>docker compose exec instance node src/operator/cli.ts admin-code</code>) and type the code it prints. A code works once, for 10 minutes. A code session can read every page and add one passkey; it changes nothing else.</p>
<form method="post" action="/admin/sign-in">
<label for="code">One-time code</label>
${codeProblem ? '<p class="problem" id="code-problem">That code was not accepted. A code works once, for 10 minutes: mint a new one on the server machine.</p>\n' : ''}<input type="text" id="code" name="code" autocomplete="one-time-code" autocapitalize="none" spellcheck="false" required${described}>
<button type="submit">Sign in</button>
</form>`,
        status,
        {},
        true,
      );
    }

    const refusedForm = (): Response =>
      htmlAnswer(
        'Not accepted',
        '<h1>That form was not accepted</h1>\n<p>It did not come from this instance’s own admin page, so nothing was changed. <a href="/admin">Go back to the admin pages</a> and try again.</p>',
        403,
      );

    const nothingChanged = (status: number, why: string): Response =>
      htmlAnswer(
        'Nothing changed',
        `<h1>Nothing was changed</h1>\n<p>${escapeHtml(why)}</p>\n<p><a href="/admin/passkeys">Go back to the passkeys</a>.</p>`,
        status,
      );

    /**
     * A `POST` of a signed-in page: from this origin's page, in a live session,
     * carrying that session's CSRF token — or the answer that refuses it, having
     * changed nothing.
     */
    async function signedInPost(
      request: Request,
      form: URLSearchParams,
      owner: Owner,
    ): Promise<Session | Response> {
      if (!fromOurPage(request)) {
        refuse('origin');
        return refusedForm();
      }
      const session = await sessionOf(request, owner);
      if (session === undefined)
        return seeOther('/admin/sign-in', { 'set-cookie': CLEARED_COOKIE });
      const sent = single(form, 'csrf');
      if (sent === undefined || !sameText(await sha256Hex(sent), session.record.csrfSha256)) {
        refuse('csrf');
        return refusedForm();
      }
      return session;
    }

    async function landing(
      owner: Owner,
      session: Session,
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
          tokenSha256: session.record.tokenSha256,
          standing: owner.standing,
        },
        client,
      );
      let version: string | undefined;
      if (status.status === 200) {
        const read = (await status.json()) as { version?: unknown };
        if (typeof read.version === 'string') version = read.version;
      }
      const csrf = await csrfOf(session.token);
      const how =
        session.record.strength === 'passkey'
          ? 'with a passkey'
          : 'with a one-time code, which can read every page and add one passkey';
      return htmlAnswer(
        'Admin',
        `<h1>Admin pages of ${escapeHtml(title)}</h1>
<p>You are signed in as the instance’s owner, ${how}.</p>
<p>${version === undefined ? 'The instance’s status could not be read.' : `Version ${escapeHtml(version)}, read from the instance’s status.`}</p>
<p><a href="/admin/passkeys">Passkeys</a></p>
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
      if (!addressListed(client)) {
        refuse('address');
        return notListed();
      }
      // Counted before any code is looked at, so a flood never reaches the store.
      if (!attemptAllowed(client)) {
        refuse('rate_limited');
        return tooMany();
      }
      const codeSha256 = await adminCodeSha256(formOf(body).get('code') ?? '');
      const at = seconds();
      const token = randomToken(32);
      const opened =
        codeSha256 === undefined
          ? 'refused'
          : await store.openAdminSessionWithCode({
              codeSha256,
              source,
              idleSeconds: ADMIN_IDLE_SECONDS,
              session: await newSession(owner, token, 'code', at),
            });
      if (opened === 'refused') {
        refuse('code');
        return signInPage('code-refused', 400);
      }
      return signedIn(request, token);
    }

    async function newSession(
      owner: Owner,
      token: string,
      strength: AdminSessionRecord['strength'],
      at: number,
    ): Promise<AdminSessionRecord> {
      return {
        tokenSha256: await sha256Hex(token),
        athleteId: owner.athleteId,
        ownerKey: owner.ownerKey,
        listener,
        strength,
        csrfSha256: await sha256Hex(await csrfOf(token)),
        createdAt: at,
        lastSeenAt: at,
        expiresAt: at + ADMIN_LIFETIME_SECONDS,
      };
    }

    /** The browser sent to the landing page with its new cookie; a session it held before is ended. */
    async function signedIn(request: Request, token: string): Promise<Response> {
      // A session this browser held before is never carried on (no fixation).
      const before = await presented(request);
      if (before !== undefined) await store.endAdminSession(before.sha);
      return seeOther('/admin', { 'set-cookie': cookieFor(token) });
    }

    /** A new challenge: what the browser signs, and the SHA-256 the store keeps. */
    async function newChallenge(): Promise<{ readonly challenge: string; readonly sha: string }> {
      const challenge = randomToken(32);
      return { challenge, sha: await sha256Hex(challenge) };
    }

    /**
     * Whether `passkey` may make an assertion here: enrolled for this RP ID by
     * the owner key that is the owner now, and for a change, confirmed.
     */
    function usableHere(passkey: AdminPasskeyRecord, owner: Owner, forChange: boolean): boolean {
      return (
        passkey.rpId === relyingParty().rpId &&
        passkey.ownerKey === owner.ownerKey &&
        (!forChange || passkey.confirmedAt !== null)
      );
    }

    /** The passkeys an assertion may be made with here. */
    async function usable(
      owner: Owner,
      forChange: boolean,
    ): Promise<readonly AdminPasskeyRecord[]> {
      return (await store.listAdminPasskeys()).filter((passkey) =>
        usableHere(passkey, owner, forChange),
      );
    }

    async function passkeySignInOptions(
      request: Request,
      owner: Owner,
      client: ClientInfo,
    ): Promise<Response> {
      if (!fromOurPage(request)) {
        refuse('origin');
        return jsonAnswer({ error: 'refused' }, 403);
      }
      if (!addressListed(client)) {
        refuse('address');
        return jsonAnswer({ error: 'address' }, 403);
      }
      if (!attemptAllowed(client)) {
        refuse('rate_limited');
        return jsonAnswer({ error: 'rate_limited' }, 429);
      }
      const at = seconds();
      const { challenge, sha } = await newChallenge();
      await store.issueAdminChallenge(
        {
          challengeSha256: sha,
          purpose: 'sign_in',
          sessionSha256: null,
          action: null,
          fieldsSha256: null,
          userHandle: null,
          expiresAt: at + ADMIN_CHALLENGE_SECONDS,
        },
        at,
      );
      return jsonAnswer(
        {
          challenge,
          rpId: relyingParty().rpId,
          allowCredentials: (await usable(owner, false)).map((passkey) => passkey.credentialId),
          timeout: ADMIN_CHALLENGE_SECONDS * 1000,
        },
        200,
      );
    }

    /**
     * An assertion verified against the passkey it names, for `challenge`
     * (base64url) — or the refusal's kind. Every check is the verifier's; this
     * finds the passkey, here, at this RP ID.
     */
    async function verified(
      assertion: { readonly credentialId: string; readonly response: AssertionResponse },
      challenge: string,
      owner: Owner,
      forChange: boolean,
    ): Promise<
      { readonly passkey: AdminPasskeyRecord; readonly signCount: number } | AdminRefusal
    > {
      const party = relyingParty();
      const passkey = await store.findAdminPasskeyByCredential(assertion.credentialId);
      if (passkey === undefined || !usableHere(passkey, owner, false)) return 'passkey';
      // ADR 0069 Q-C: a tunnel passkey changes nothing until the host confirmed it.
      if (forChange && !usableHere(passkey, owner, true)) return 'step_up';
      try {
        const { signCount } = await verifyAssertion(assertion.response, passkey, {
          ...party,
          challenge,
        });
        return { passkey, signCount };
      } catch (error) {
        if (error instanceof WebAuthnRefused)
          return error.reason === 'counter' ? 'counter' : 'passkey';
        throw error;
      }
    }

    /** The challenge a response names, or `undefined` when it names none. */
    function namedChallenge(clientDataJSON: Uint8Array): string | undefined {
      try {
        return challengeOf(clientDataJSON);
      } catch (error) {
        if (error instanceof WebAuthnRefused) return undefined;
        throw error;
      }
    }

    async function passkeySignIn(
      request: Request,
      body: Uint8Array | null,
      owner: Owner,
      client: ClientInfo,
    ): Promise<Response> {
      if (!fromOurPage(request)) {
        refuse('origin');
        return refusedForm();
      }
      if (!addressListed(client)) {
        refuse('address');
        return notListed();
      }
      if (!attemptAllowed(client)) {
        refuse('rate_limited');
        return tooMany();
      }
      const at = seconds();
      const assertion = assertionFrom(formOf(body));
      const challenge =
        assertion === undefined ? undefined : namedChallenge(assertion.response.clientDataJSON);
      // Taken, once, whatever the rest of the answer is.
      const issued =
        challenge === undefined
          ? undefined
          : await store.takeAdminChallenge(
              'sign_in',
              { challengeSha256: await sha256Hex(challenge) },
              at,
            );
      if (assertion === undefined || challenge === undefined || issued === undefined) {
        refuse('passkey');
        return signInPage('passkey-refused', 400);
      }
      const proved = await verified(assertion, challenge, owner, false);
      if (typeof proved === 'string') {
        refuse(proved);
        return signInPage('passkey-refused', 400);
      }
      const token = randomToken(32);
      const opened = await store.openAdminSessionWithPasskey({
        passkeyId: proved.passkey.id,
        signCountWas: proved.passkey.signCount,
        signCount: proved.signCount,
        source,
        idleSeconds: ADMIN_IDLE_SECONDS,
        session: await newSession(owner, token, 'passkey', at),
      });
      if (opened === 'refused') {
        refuse('counter');
        return signInPage('passkey-refused', 400);
      }
      return signedIn(request, token);
    }

    async function signOut(
      request: Request,
      body: Uint8Array | null,
      owner: Owner,
    ): Promise<Response> {
      const session = await signedInPost(request, formOf(body), owner);
      if (session instanceof Response) return session;
      await store.endAdminSession(session.record.tokenSha256);
      return seeOther('/admin/sign-in', { 'set-cookie': CLEARED_COOKIE });
    }

    async function passkeysPage(owner: Owner, session: Session): Promise<Response> {
      const { rpId } = relyingParty();
      const passkeys = await store.listAdminPasskeys();
      const csrf = escapeHtml(await csrfOf(session.token));
      const byPasskey = session.record.strength === 'passkey';
      const items = passkeys.map((passkey) => {
        const label = escapeHtml(passkey.label);
        const standing =
          passkey.ownerKey !== owner.ownerKey
            ? 'Not usable: it was added under another owner key than OYL_INSTANCE_OWNER_KEY names now. Revoke it.'
            : passkey.rpId !== rpId
              ? `Not usable at this address: it was added for ${escapeHtml(passkey.rpId)}. Revoke it, and add one here.`
              : passkey.confirmedAt === null
                ? `Can read, and change nothing until it is confirmed on the server machine: <code>operator admin-passkeys confirm ${escapeHtml(passkey.id)}</code>.`
                : 'Can read and make changes, with a fresh check each time.';
        const revoke = byPasskey
          ? `<form method="post" action="/admin/passkeys/${escapeHtml(passkey.id)}/revoke" data-step-up="passkey_revoke">
<input type="hidden" name="csrf" value="${csrf}">
<input type="hidden" name="id" value="${escapeHtml(passkey.id)}">
<button type="submit">Revoke ${label}</button>
<p data-passkey-status role="status"></p>
</form>`
          : '';
        return `<li>
<h3>${label}</h3>
<dl>
<dt>Id</dt><dd><code>${escapeHtml(passkey.id)}</code></dd>
<dt>Added</dt><dd>${when(passkey.enrolledAt)}</dd>
<dt>Last used</dt><dd>${passkey.lastUsedAt === null ? 'Never' : when(passkey.lastUsedAt)}</dd>
<dt>For</dt><dd>${escapeHtml(passkey.rpId)}</dd>
</dl>
<p>${standing}</p>
${revoke}
</li>`;
      });
      const list =
        items.length === 0
          ? '<p>There are no passkeys yet.</p>'
          : `<ul class="passkeys">\n${items.join('\n')}\n</ul>`;
      const add = byPasskey
        ? '<p>To add another passkey, sign in with a one-time code from the server machine: a code session can add one.</p>'
        : passkeys.length >= MAX_ADMIN_PASSKEYS
          ? `<p>You hold ${String(MAX_ADMIN_PASSKEYS)} passkeys, the most there may be. Revoke one before adding another.</p>`
          : `<h2>Add a passkey</h2>
<p>This adds one passkey for ${escapeHtml(rpId)}, then signs you out so you can sign in with it. Revoking a passkey needs a passkey sign-in.</p>
<form method="post" action="/admin/passkeys/add" data-passkey="enrol" data-passkey-supported hidden>
<input type="hidden" name="csrf" value="${csrf}">
<label for="label">A name for this passkey</label>
<input type="text" id="label" name="label" maxlength="${String(PASSKEY_LABEL_LIMIT)}" autocomplete="off" required>
<button type="submit">Add a passkey</button>
<p data-passkey-status role="status"></p>
</form>
<p data-passkey-unsupported>This browser cannot use a passkey on this page, or the page’s script is blocked. You can keep using the admin pages with a one-time code, which reads every page and changes nothing.</p>`;
      return htmlAnswer(
        'Passkeys',
        `<h1>Passkeys</h1>
<p><a href="/admin">Back to the admin pages</a></p>
${list}
${add}`,
        200,
        {},
        true,
      );
    }

    async function enrolOptions(
      request: Request,
      body: Uint8Array | null,
      owner: Owner,
    ): Promise<Response> {
      const session = await signedInPost(request, formOf(body), owner);
      if (session instanceof Response) return session;
      if (session.record.strength !== 'code') {
        refuse('passkey');
        return jsonAnswer({ error: 'not_a_code_session' }, 403);
      }
      const held = await store.listAdminPasskeys();
      if (held.length >= MAX_ADMIN_PASSKEYS) return jsonAnswer({ error: 'full' }, 409);
      const at = seconds();
      const { challenge, sha } = await newChallenge();
      // One random handle for the instance's owner, never an athlete id (ADR 0069 D-1).
      const userHandle = held[0]?.userHandle ?? randomToken(16);
      await store.issueAdminChallenge(
        {
          challengeSha256: sha,
          purpose: 'enrol',
          sessionSha256: session.record.tokenSha256,
          action: null,
          fieldsSha256: null,
          userHandle,
          expiresAt: at + ADMIN_CHALLENGE_SECONDS,
        },
        at,
      );
      const { rpId } = relyingParty();
      return jsonAnswer(
        {
          challenge,
          rpId,
          rpName: title,
          userHandle,
          algorithms: [COSE_ALGORITHMS.ed25519, COSE_ALGORITHMS.es256],
          excludeCredentials: held
            .filter((passkey) => passkey.rpId === rpId)
            .map((passkey) => passkey.credentialId),
          timeout: ADMIN_CHALLENGE_SECONDS * 1000,
        },
        200,
      );
    }

    async function enrol(
      request: Request,
      body: Uint8Array | null,
      owner: Owner,
    ): Promise<Response> {
      const form = formOf(body);
      const session = await signedInPost(request, form, owner);
      if (session instanceof Response) return session;
      if (session.record.strength !== 'code') {
        refuse('passkey');
        return nothingChanged(403, 'A passkey is added from a one-time code’s session.');
      }
      const label = labelFrom(form);
      if (label === undefined) {
        return nothingChanged(400, 'A passkey’s name is 1 to 60 characters.');
      }
      const at = seconds();
      // Taken, once, whatever the rest of the answer is.
      const issued = await store.takeAdminChallenge(
        'enrol',
        { sessionSha256: session.record.tokenSha256 },
        at,
      );
      const clientDataJSON = fromBase64Url(single(form, 'clientDataJSON') ?? '');
      const attestationObject = fromBase64Url(single(form, 'attestationObject') ?? '');
      const challenge = clientDataJSON === undefined ? undefined : namedChallenge(clientDataJSON);
      if (
        issued === undefined ||
        issued.userHandle === null ||
        clientDataJSON === undefined ||
        attestationObject === undefined ||
        challenge === undefined ||
        (await sha256Hex(challenge)) !== issued.challengeSha256
      ) {
        refuse('passkey');
        return nothingChanged(
          400,
          'The passkey was not added: the browser’s answer was not accepted.',
        );
      }
      let registration: Awaited<ReturnType<typeof verifyRegistration>>;
      try {
        registration = await verifyRegistration(
          { clientDataJSON, attestationObject },
          { ...relyingParty(), challenge },
        );
      } catch (error) {
        if (!(error instanceof WebAuthnRefused)) throw error;
        refuse('passkey');
        return nothingChanged(
          400,
          'The passkey was not added: the browser’s answer was not accepted.',
        );
      }
      const userHandle = issued.userHandle;
      const { value } = await store.recordOperatorAction(
        {
          actor: { source, athleteId: owner.athleteId },
          action: 'admin_passkey_enrolled',
          at,
        },
        async (inside): Promise<OperatorChange<'enrolled' | 'refused'>> => {
          const held = await inside.listAdminPasskeys();
          const live = await inside.findAdminSession(session.record.tokenSha256);
          if (
            held.length >= MAX_ADMIN_PASSKEYS ||
            held.some((passkey) => passkey.credentialId === registration.credentialId) ||
            live === undefined
          ) {
            return { outcome: 'refused', detail: null, value: 'refused' };
          }
          await inside.addAdminPasskey({
            id: randomHex(8),
            credentialId: registration.credentialId,
            rpId: relyingParty().rpId,
            algorithm: registration.algorithm,
            publicKey: registration.publicKey,
            signCount: registration.signCount,
            userHandle,
            ownerKey: owner.ownerKey,
            label,
            listener,
            enrolledAt: at,
            lastUsedAt: null,
            // ADR 0069 Q-C: through the tunnel, unconfirmed until the host confirms it.
            confirmedAt: null,
          });
          // A code session enrols once, and ends (ADR 0069 D-1).
          await inside.endAdminSession(session.record.tokenSha256);
          return { outcome: 'done', detail: registration.algorithm, value: 'enrolled' };
        },
      );
      if (value === 'refused') {
        return nothingChanged(
          409,
          'The passkey was not added: it is held already, or there are ten.',
        );
      }
      return seeOther('/admin/sign-in?enrolled', { 'set-cookie': CLEARED_COOKIE });
    }

    async function stepUpOptions(
      request: Request,
      body: Uint8Array | null,
      owner: Owner,
    ): Promise<Response> {
      const form = formOf(body);
      const session = await signedInPost(request, form, owner);
      if (session instanceof Response) return session;
      // A code session changes nothing (ADR 0069 Q-A), so it is issued no step-up.
      if (session.record.strength !== 'passkey') {
        refuse('step_up');
        return jsonAnswer({ error: 'not_a_passkey_session' }, 403);
      }
      if (!stepUps.allow(session.record.tokenSha256)) {
        refuse('rate_limited');
        return jsonAnswer({ error: 'rate_limited' }, 429);
      }
      const action = single(form, 'action');
      const fields =
        action === undefined || !isAdminChange(action)
          ? undefined
          : boundFields(ADMIN_CHANGES[action].fields, form);
      if (action === undefined || fields === undefined) {
        refuse('step_up');
        return jsonAnswer({ error: 'not_a_change' }, 400);
      }
      const at = seconds();
      const { challenge, sha } = await newChallenge();
      await store.issueAdminChallenge(
        {
          challengeSha256: sha,
          purpose: 'step_up',
          sessionSha256: session.record.tokenSha256,
          action,
          fieldsSha256: await bindingOf(action, fields),
          userHandle: null,
          expiresAt: at + ADMIN_CHALLENGE_SECONDS,
        },
        at,
      );
      return jsonAnswer(
        {
          challenge,
          rpId: relyingParty().rpId,
          allowCredentials: (await usable(owner, true)).map((passkey) => passkey.credentialId),
          timeout: ADMIN_CHALLENGE_SECONDS * 1000,
        },
        200,
      );
    }

    /**
     * The step-up a change's `POST` carries, verified (ADR 0069 D-4): the
     * session's pending challenge TAKEN — so it answers once, whatever the
     * outcome — and held to this action and these fields, then the assertion
     * verified by a confirmed passkey here. Answers the passkey and its new
     * counter, or `undefined` with the refusal counted.
     */
    async function steppedUp(
      owner: Owner,
      session: Session,
      action: AdminChange,
      fields: Readonly<Record<string, string>>,
      form: URLSearchParams,
    ): Promise<{ readonly passkey: AdminPasskeyRecord; readonly signCount: number } | undefined> {
      const pending = await store.takeAdminChallenge(
        'step_up',
        { sessionSha256: session.record.tokenSha256 },
        seconds(),
      );
      const assertion = assertionFrom(form);
      const challenge =
        assertion === undefined ? undefined : namedChallenge(assertion.response.clientDataJSON);
      if (
        pending === undefined ||
        assertion === undefined ||
        challenge === undefined ||
        (await sha256Hex(challenge)) !== pending.challengeSha256 ||
        pending.action !== action ||
        pending.fieldsSha256 !== (await bindingOf(action, fields))
      ) {
        refuse('step_up');
        return undefined;
      }
      const proved = await verified(assertion, challenge, owner, true);
      if (typeof proved === 'string') {
        refuse(proved === 'counter' ? 'counter' : 'step_up');
        return undefined;
      }
      return proved;
    }

    async function revoke(
      request: Request,
      body: Uint8Array | null,
      owner: Owner,
      pathId: string,
    ): Promise<Response> {
      const form = formOf(body);
      const session = await signedInPost(request, form, owner);
      if (session instanceof Response) return session;
      if (session.record.strength !== 'passkey') {
        refuse('step_up');
        return nothingChanged(
          403,
          'Revoking a passkey needs a passkey sign-in: a one-time code’s session changes nothing.',
        );
      }
      const fields = boundFields(ADMIN_CHANGES.passkey_revoke.fields, form);
      if (fields === undefined || fields.id !== pathId || !PASSKEY_ID.test(pathId)) {
        refuse('step_up');
        return nothingChanged(400, 'That form did not name one passkey.');
      }
      const stepped = await steppedUp(owner, session, 'passkey_revoke', fields, form);
      if (stepped === undefined) {
        return nothingChanged(
          403,
          'The passkey check did not pass: a change needs a fresh check by a confirmed passkey, made for this change.',
        );
      }
      const at = seconds();
      const { value } = await store.recordOperatorAction(
        {
          actor: { source, athleteId: owner.athleteId },
          action: 'admin_passkey_revoked',
          at,
        },
        async (inside): Promise<OperatorChange<boolean>> => {
          const used = await inside.recordAdminPasskeyUse(
            stepped.passkey.id,
            stepped.passkey.signCount,
            stepped.signCount,
            at,
          );
          if (!used) return { outcome: 'refused', detail: null, value: false };
          const removed = await inside.removeAdminPasskey(pathId);
          if (!removed.removed) return { outcome: 'refused', detail: null, value: false };
          return {
            outcome: 'done',
            detail: `sessions_ended=${String(Math.min(removed.sessionsEnded, 999_999_999))}`,
            value: true,
          };
        },
      );
      if (!value)
        return nothingChanged(409, 'There is no such passkey, or it was just used elsewhere.');
      // The passkey this session was opened with ends it.
      if ((await store.findAdminSession(session.record.tokenSha256)) === undefined) {
        return seeOther('/admin/sign-in', { 'set-cookie': CLEARED_COOKIE });
      }
      return seeOther('/admin/passkeys');
    }

    return async (request, body, client, seam) => {
      // Against DNS rebinding: the page is this listener's, or it is not served.
      if (request.headers.get('host') !== place.host) {
        return htmlAnswer(
          'Wrong address',
          `<h1>Open the admin pages at their own address</h1>\n<p>They are served at <a href="${escapeHtml(place.origin)}/admin">${escapeHtml(place.origin)}/admin</a> only.</p>`,
          421,
        );
      }
      const path = new URL(request.url).pathname;
      const revokeId = REVOKE_PATH.exec(path)?.[1];
      const route = revokeId === undefined ? path : '/admin/passkeys/{id}/revoke';
      const methods = METHODS[route];
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
      if (route === '/admin/admin.css') {
        return adminResponse(STYLE, 200, { 'content-type': 'text/css; charset=utf-8' });
      }
      if (route === '/admin/passkey.js') {
        return adminResponse(PASSKEY_SCRIPT, 200, {
          'content-type': 'text/javascript; charset=utf-8',
        });
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
        switch (route) {
          case '/admin/sign-in':
            return signIn(request, body, owner, client);
          case '/admin/sign-in/passkey-options':
            return passkeySignInOptions(request, owner, client);
          case '/admin/sign-in/passkey':
            return passkeySignIn(request, body, owner, client);
          case '/admin/passkeys/options':
            return enrolOptions(request, body, owner);
          case '/admin/passkeys/add':
            return enrol(request, body, owner);
          case '/admin/step-up':
            return stepUpOptions(request, body, owner);
          case '/admin/passkeys/{id}/revoke':
            return revoke(request, body, owner, revokeId as string);
          default:
            return signOut(request, body, owner);
        }
      }
      const session = await sessionOf(request, owner);
      if (path === '/admin/sign-in') {
        if (session !== undefined) return seeOther('/admin');
        const enrolled = new URL(request.url).searchParams.has('enrolled');
        return signInPage(enrolled ? 'enrolled' : null, 200);
      }
      if (session === undefined) return seeOther('/admin/sign-in');
      if (path === '/admin/passkeys') return passkeysPage(owner, session);
      return landing(owner, session, client, seam);
    };
  }

  const tunnel = expected === null ? undefined : placeFor('tunnel', expected);
  const loopback =
    expected === null || options.loopbackPort === undefined
      ? undefined
      : placeFor('loopback', expected);

  return {
    async handle(request, body, client, seam) {
      if (expected === null) {
        return htmlAnswer(
          'Unavailable',
          `<h1>The admin pages are unavailable</h1>\n<p>${escapeHtml(UNAVAILABLE.origin)}</p>`,
          503,
        );
      }
      // The listener is the ADAPTER's word (`ClientInfo.listener`), never a
      // header's or a peer address's (ADR 0069 D-5).
      const place = client.listener === 'loopback' ? loopback : tunnel;
      if (place === undefined) {
        return htmlAnswer('Not found', '<h1>Not found</h1>', 404);
      }
      return place(request, body, client, seam);
    },

    async flushRefusals() {
      const held = [...refused];
      refused.clear();
      for (const [key, count] of held) {
        const [source, kind] = key.split(':') as [AdminSource, AdminRefusal];
        try {
          await store.recordOperatorAction(
            {
              actor: { source, athleteId: null },
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
      stepUps.sweep();
    },
    rateLimitSweepPeriodMs: sweepPeriodMs([
      limits.perAddress,
      limits.overall,
      limits.stepUpPerSession,
    ]),
  };
}
