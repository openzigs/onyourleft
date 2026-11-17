// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The instance's own admin pages: the sign-in, the session and the
 * owner's passkeys** (#2641, #2642, ADR 0069 D-1, D-2, D-4, D-8), and since
 * #2645 the pages: the shell, Status and the operator log (`pages.ts`),
 * answered from the admin route table (`admin-routes.ts`). The loopback
 * listener is #2643's.
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
 * ## The pages read the routes, never the store (#2645, ADR 0069 D-2)
 *
 * Status is `GET /v1/operate/status` and the log `GET /v1/operate/log`, each
 * called through {@link AdminSeam} as the owner: what a page shows is the
 * route's answer. Accounts (#2646) is `GET /v1/operate/status` and, by ADR
 * 0069 D-9, the moderation routes' queue, approved or refused through the
 * two moderation routes D-9 admits. The log's one query, `cursor`, is the route's own cursor
 * handed back: it is held to the shape the route writes
 * ({@link LOG_CURSOR}) before it is put into the path the seam is called
 * with, and the route checks it again. No other part of the browser's request
 * reaches the seam. The Passkeys page is the one page drawn from the store:
 * the passkeys are the admin layer's own (#2642), no route's.
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
import {
  analysisHolds,
  type OperateAnalysisAnswer,
  type OperateAnalysisChange,
  type OperateJobsAnswer,
  type OperateLocalModelsAnswer,
  type OperateStatusAnswer,
  type OperateToolCheckOutcome,
} from '@onyourleft/operate-text';

import { escapeHtml } from '../html.ts';
import { ATHLETE_ID, MAXIMUM_REASON_LENGTH, type ModeratorRole } from '../moderation/moderation.ts';
import type { ClientInfo } from '../route-kit.ts';
import type {
  AdminPasskeyRecord,
  AdminSessionRecord,
  AdminSource,
  OperatorChange,
  SqlStore,
} from '../store/sql-store.ts';
import { ADMIN_LANDING, ADMIN_ROUTES } from './admin-routes.ts';
import { adminCodeSha256 } from './code.ts';
import { adminResponse } from './headers.ts';
import {
  accountsBody,
  adminPage,
  analysisBody,
  backupsBody,
  roomsBody,
  isSaveProblem,
  logBody,
  passkeysBody,
  shellPage,
  signInPage,
  statusBody,
  type AccountsNotice,
  type BackupRecordAnswer,
  type BackupsNotice,
  type BackupsView,
  type RoomAnswer,
  type AnalysisNotice,
  type AnalysisOffer,
  type LogEntryAnswer,
  type LogView,
  type PasskeyView,
  type RegistrationAnswer,
  type RegistrationDecision,
  type ShellView,
  type SignInNotice,
} from './pages.ts';
import { PASSKEY_SCRIPT } from './passkey-script.ts';
import {
  ADMIN_CHALLENGE_SECONDS,
  ADMIN_CHANGES,
  bindingOf,
  boundFields,
  isAdminChange,
  type AdminChange,
} from './step-up.ts';
import { ADMIN_STYLE } from './style.ts';
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
 * or query from the browser. `handler.ts` builds it; a `GET` reaches only a
 * route marked `admin: 'read'`, a `POST` or `DELETE` only one marked
 * `'change'` (#2648), and any other is `not_found` there before it is called.
 */
export interface AdminSeam {
  /**
   * `path` may carry a query the admin layer built and checked; the handler
   * matches its pathname. `body` is the JSON a change sends, built here from
   * a form this layer checked — never the browser's own.
   */
  dispatch(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    owner: Caller,
    client: ClientInfo,
    body?: Readonly<Record<string, unknown>>,
  ): Promise<Response>;
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

const HTML = { 'content-type': 'text/html; charset=utf-8' } as const;

function htmlAnswer(
  title: string,
  body: string,
  status: number,
  extra: Readonly<Record<string, string>> = {},
): Response {
  return adminResponse(adminPage(title, body), status, { ...HTML, ...extra });
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

/** What a signed-in page calls the seam with. */
interface PageCall {
  readonly caller: Caller;
  readonly client: ClientInfo;
  readonly seam: AdminSeam;
}

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
  // C0, DEL, C1 (the 8-bit CSI among them) and the bidi controls: the CLI prints a label on the host's terminal.
  // eslint-disable-next-line no-control-regex -- the control characters are what is refused
  return /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(label)
    ? undefined
    : label;
}

/** A passkey id as {@link randomHex} writes 8 bytes. */
const PASSKEY_ID = /^[0-9a-f]{16}$/;
const REVOKE_PATH = /^\/admin\/passkeys\/([^/]+)\/revoke$/;

/** The paths the admin layer answers, and the methods each takes: the admin route table's. */
const METHODS: ReadonlyMap<string, readonly string[]> = new Map(
  ADMIN_ROUTES.map((route) => [route.path, route.methods]),
);

/** A page of the operator log, as the app's Operate area reads one. */
export const LOG_PAGE_SIZE = 50;

/**
 * A cursor as the log route writes one (`pagination.ts` §`encodeCursor`:
 * base64url, unpadded) and no longer than any it could write. Anything else
 * is refused here, before the seam is called.
 */
const LOG_CURSOR = /^[A-Za-z0-9_-]{1,128}$/;

/** The AI backend page's change behind each of its form targets (#2648). */
const ANALYSIS_ACTIONS: ReadonlyMap<string, AnalysisAction> = new Map([
  ['/admin/analysis/offer', 'analysis_offer'],
  ['/admin/analysis/check', 'analysis_check'],
  ['/admin/analysis/model', 'analysis_model'],
  ['/admin/analysis/address', 'analysis_address'],
  ['/admin/analysis/clear', 'analysis_clear'],
]);

type AnalysisAction = Extract<AdminChange, `analysis_${string}`>;

/** The Accounts page's decision behind each of its form targets (#2646, ADR 0069 D-9). */
const REGISTRATION_ACTIONS: ReadonlyMap<string, RegistrationDecision> = new Map([
  ['/admin/accounts/approve', 'approve'],
  ['/admin/accounts/refuse', 'refuse'],
]);

/** The moderation routes' queue, which the Accounts page lists (ADR 0069 D-9). */
const REGISTRATIONS_ROUTE = '/v1/moderation/registrations';

/**
 * The queue as the route answered it, each rider held to the four details
 * the route declares — or `undefined` for an answer not in that shape.
 */
function registrationsOf(answer: unknown): readonly RegistrationAnswer[] | undefined {
  const list = (answer as { registrations?: unknown } | undefined)?.registrations;
  if (!Array.isArray(list)) return undefined;
  const shown: RegistrationAnswer[] = [];
  for (const each of list) {
    const row = (typeof each === 'object' && each !== null ? each : {}) as Record<string, unknown>;
    const { athleteId, displayName, createdAt, adultConfirmed } = row;
    if (
      typeof athleteId !== 'string' ||
      typeof displayName !== 'string' ||
      typeof createdAt !== 'number' ||
      !Number.isSafeInteger(createdAt) ||
      typeof adultConfirmed !== 'boolean'
    ) {
      return undefined;
    }
    // Only the four: anything else the answer carried is not drawn.
    shown.push({ athleteId, displayName, createdAt, adultConfirmed });
  }
  return shown;
}

/** The backups' route (#2647): the Backups page reads it, and "back up now" posts to it. */
const BACKUPS_ROUTE = '/v1/operate/backups';

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isCountOrNull = (value: unknown): value is number | null => value === null || isCount(value);
const isTextOrNull = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';
const OFF_BOX: readonly unknown[] = ['copied', 'failed', 'not-configured'];

/**
 * The backups as the route answered them, each record held to the fields the
 * route declares (`operate/routes.ts` §`backupRecordSchema`) — or `undefined`
 * for an answer not in that shape, which the page says it could not read.
 */
function backupsOf(answer: unknown): BackupsView['backups'] {
  const body = (answer ?? {}) as { backups?: unknown; pending?: unknown };
  const pending = body.pending as { requestedAt?: unknown } | null | undefined;
  if (!Array.isArray(body.backups) || pending === undefined) return undefined;
  if (pending !== null && typeof pending.requestedAt !== 'string') return undefined;
  const records: BackupRecordAnswer[] = [];
  for (const each of body.backups) {
    const row = (typeof each === 'object' && each !== null ? each : {}) as Record<string, unknown>;
    const free = (row.freeBytes ?? {}) as Record<string, unknown>;
    const shared =
      isCount(row.id) &&
      typeof row.at === 'string' &&
      isCount(row.ageSeconds) &&
      isCountOrNull(row.intervalSeconds) &&
      typeof row.requested === 'boolean' &&
      isTextOrNull(row.databaseSha256) &&
      isCountOrNull(row.removed) &&
      isCountOrNull(free.backups) &&
      isCountOrNull(free.offBox);
    if (!shared) return undefined;
    const facts = {
      id: row.id as number,
      at: row.at as string,
      ageSeconds: row.ageSeconds as number,
      intervalSeconds: row.intervalSeconds as number | null,
      requested: row.requested as boolean,
      databaseSha256: row.databaseSha256 as string | null,
      removed: row.removed as number | null,
      freeBytes: { backups: free.backups as number | null, offBox: free.offBox as number | null },
    };
    if (row.outcome === 'failed' && typeof row.error === 'string') {
      records.push({ ...facts, outcome: 'failed', error: row.error });
    } else if (
      row.outcome === 'done' &&
      typeof row.snapshot === 'string' &&
      isCount(row.rows) &&
      isCount(row.blobs) &&
      isCount(row.sizeBytes) &&
      OFF_BOX.includes(row.offBox)
    ) {
      records.push({
        ...facts,
        outcome: 'done',
        snapshot: row.snapshot,
        rows: row.rows,
        blobs: row.blobs,
        sizeBytes: row.sizeBytes,
        offBox: row.offBox as 'copied' | 'failed' | 'not-configured',
      });
    } else {
      return undefined;
    }
  }
  return { records, pendingSince: pending === null ? null : (pending.requestedAt as string) };
}

/** The rooms' route (#2649): the Rooms page reads it, and ends a room at `{roomId}/end`. */
const ROOMS_ROUTE = '/v1/operate/rooms';

/** A room's id as the route takes one in `{roomId}`: what `ATHLETE_ID` is for an athlete. */
const ROOM_ID = /^[A-Za-z0-9_-]{1,128}$/;

const ROOM_KINDS: readonly unknown[] = ['group', 'race', 'lap-race'];
const ROOM_PHASES: readonly unknown[] = ['lobby', 'countdown', 'riding', 'finished'];
const ROOM_VISIBILITIES: readonly unknown[] = ['private', 'public'];
const ROOM_END_REASON_WORDS: readonly string[] = ['abuse', 'stuck', 'maintenance', 'other'];

/**
 * The rooms as the route answered them, each held to the fields the route
 * declares and ONLY those — a rider's place, speed or power, were an answer
 * ever to carry one, is not copied — or `undefined` for an answer not in
 * that shape.
 */
function roomsOf(answer: unknown): readonly RoomAnswer[] | undefined {
  const list = (answer as { rooms?: unknown } | undefined)?.rooms;
  if (!Array.isArray(list)) return undefined;
  const rooms: RoomAnswer[] = [];
  for (const each of list) {
    const row = (typeof each === 'object' && each !== null ? each : {}) as Record<string, unknown>;
    const { roomId, shortCode, kind, visibility, phase, openedAt, host, riders } = row;
    if (
      typeof roomId !== 'string' ||
      typeof shortCode !== 'string' ||
      !ROOM_KINDS.includes(kind) ||
      !ROOM_VISIBILITIES.includes(visibility) ||
      !ROOM_PHASES.includes(phase) ||
      typeof openedAt !== 'string' ||
      !isTextOrNull(host) ||
      !Array.isArray(riders) ||
      !riders.every(isTextOrNull)
    ) {
      return undefined;
    }
    rooms.push({
      roomId,
      shortCode,
      kind: kind as RoomAnswer['kind'],
      visibility: visibility as RoomAnswer['visibility'],
      phase: phase as RoomAnswer['phase'],
      openedAt,
      host,
      riders,
    });
  }
  return rooms;
}

/** A refusal's own sentence, as the route wrote it, or `null`. */
async function messageOf(answer: Response): Promise<string | null> {
  try {
    const message = ((await answer.json()) as { error?: { message?: unknown } }).error?.message;
    return typeof message === 'string' ? message : null;
  } catch {
    return null;
  }
}

/** The analysis settings' route: the AI backend page reads and changes them there. */
const ANALYSIS_ROUTE = '/v1/operate/analysis';

/** Which settings field each switch is, as `POST /v1/operate/analysis` takes it. */
const OFFER_FIELD: Readonly<Record<AnalysisOffer, 'offerLocal' | 'othersLocal' | 'offerHosted'>> = {
  local: 'offerLocal',
  others: 'othersLocal',
  hosted: 'offerHosted',
};

/** One change's route call (ADR 0069 D-2): a fixed method and path, and a body built here. */
interface AnalysisCall {
  readonly method: 'POST' | 'DELETE';
  readonly path: string;
  readonly body?: Readonly<Record<string, unknown>>;
  /** What the settings read back after it must hold, for a save. */
  readonly holds?: OperateAnalysisChange;
  /** What the settings read back after it must show, where `holds` has no field for it. */
  readonly readBack?: (after: OperateAnalysisAnswer) => boolean;
}

/**
 * The route call a checked form's fields map to, or `undefined` for a form
 * that names no change: a switch and `on`/`off` from the closed lists, and
 * a model or an address as the owner typed or picked it — the route checks
 * those (the local-address rule, ADR 0040 D-6, among them).
 */
function analysisCall(
  action: AnalysisAction,
  fields: Readonly<Record<string, string>>,
): AnalysisCall | undefined {
  switch (action) {
    case 'analysis_offer': {
      const { offer, on } = fields;
      if (offer === undefined || !Object.hasOwn(OFFER_FIELD, offer)) return undefined;
      if (on !== 'on' && on !== 'off') return undefined;
      const change = { [OFFER_FIELD[offer as AnalysisOffer]]: on === 'on' };
      return { method: 'POST', path: ANALYSIS_ROUTE, body: change, holds: change };
    }
    case 'analysis_check':
      return { method: 'POST', path: `${ANALYSIS_ROUTE}/check`, body: { model: fields.model } };
    case 'analysis_model':
      return {
        method: 'POST',
        path: ANALYSIS_ROUTE,
        body: { localModel: fields.localModel },
        holds: { localModel: fields.localModel?.trim() ?? null },
      };
    case 'analysis_address':
      return {
        method: 'POST',
        path: ANALYSIS_ROUTE,
        body: { localUrl: fields.localUrl },
        // The address is the app's own now, and there is one (the route may write it in its own form).
        readBack: (after) => after.local.setIn === 'app' && after.local.url !== null,
      };
    case 'analysis_clear':
      return {
        method: 'DELETE',
        path: ANALYSIS_ROUTE,
        // Nothing is held in the app any more: the address, model and reasoning are the .env's.
        readBack: (after) => after.local.setIn !== 'app',
      };
  }
}

/** The first field problem a route's `validation_failed` names, when it is one of the routes' own codes. */
async function problemOf(answer: Response): Promise<string | null> {
  try {
    const body = (await answer.json()) as { error?: { fields?: { problem?: unknown }[] } };
    const problem = body.error?.fields?.[0]?.problem;
    return isSaveProblem(problem) ? problem : null;
  } catch {
    return null;
  }
}

/** A tool check's outcome as the route answered it, or `null`. */
async function outcomeOf(answer: Response): Promise<OperateToolCheckOutcome | null> {
  if (answer.status !== 200) return null;
  try {
    const outcome = ((await answer.json()) as { outcome?: unknown }).outcome;
    return typeof outcome === 'string' && TOOL_CHECK_WORDS.includes(outcome)
      ? (outcome as OperateToolCheckOutcome)
      : null;
  } catch {
    return null;
  }
}

const TOOL_CHECK_WORDS: readonly string[] = [
  'tools-ok',
  'no-tool-call',
  'does-not-support-tools',
  'server-error',
  'not-local',
  'out-of-time',
  'stopped',
  'no-address',
  'busy',
];

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

  /** The route's JSON when it answered 200, or `undefined`. */
  async function read(
    seam: AdminSeam,
    path: string,
    caller: Caller,
    client: ClientInfo,
  ): Promise<unknown> {
    return (await readWithStatus(seam, path, caller, client)).body;
  }

  /** {@link read}, with the status the route answered, for a page that tells one refusal from another. */
  async function readWithStatus(
    seam: AdminSeam,
    path: string,
    caller: Caller,
    client: ClientInfo,
  ): Promise<{ readonly status: number; readonly body: unknown }> {
    const answer = await seam.dispatch('GET', path, caller, client);
    if (answer.status !== 200) return { status: answer.status, body: undefined };
    try {
      return { status: 200, body: await answer.json() };
    } catch {
      return { status: 200, body: undefined };
    }
  }

  /**
   * The AI backend (#2648): `GET /v1/operate/analysis`, its models and its
   * jobs, drawn in the app panel's words. `noticeFor` says what the change
   * just made says, given the settings read back after it.
   */
  async function analysisPage(
    view: PageCall,
    shell: ShellView,
    strength: AdminSessionRecord['strength'],
    noticeFor: (after: OperateAnalysisAnswer | undefined) => AnalysisNotice | null,
  ): Promise<string> {
    const objectOr = <T>(answer: unknown): T | undefined =>
      typeof answer === 'object' && answer !== null ? (answer as T) : undefined;
    const [analysis, models, jobs] = await Promise.all([
      read(view.seam, ANALYSIS_ROUTE, view.caller, view.client),
      read(view.seam, `${ANALYSIS_ROUTE}/models`, view.caller, view.client),
      read(view.seam, `${ANALYSIS_ROUTE}/jobs`, view.caller, view.client),
    ]);
    const settings = objectOr<OperateAnalysisAnswer>(analysis);
    const drawn = {
      analysis: settings,
      models: objectOr<OperateLocalModelsAnswer>(models),
      jobs: objectOr<OperateJobsAnswer>(jobs),
      strength,
      csrf: shell.csrf,
      notice: noticeFor(settings),
    };
    let body: string;
    try {
      body = analysisBody(drawn);
    } catch {
      // An answer not in the route's shape is as good as none.
      body = analysisBody({ ...drawn, analysis: undefined, models: undefined, jobs: undefined });
    }
    return shellPage(shell, 'AI backend', body, true);
  }

  /**
   * Accounts (#2646, ADR 0069 D-9): `GET /v1/operate/status`'s counts and
   * mode, and `GET /v1/moderation/registrations`' queue, both read as the
   * owner through the seam on every load — never kept from one to the next.
   */
  async function accountsPage(
    view: PageCall,
    shell: ShellView,
    strength: AdminSessionRecord['strength'],
    noticeFor: (registrations: readonly RegistrationAnswer[] | undefined) => AccountsNotice | null,
  ): Promise<string> {
    const [statusAnswer, queueAnswer] = await Promise.all([
      read(view.seam, '/v1/operate/status', view.caller, view.client),
      read(view.seam, REGISTRATIONS_ROUTE, view.caller, view.client),
    ]);
    const status =
      typeof statusAnswer === 'object' && statusAnswer !== null
        ? (statusAnswer as OperateStatusAnswer)
        : undefined;
    const registrations = registrationsOf(queueAnswer);
    const drawn = {
      status,
      registrations,
      strength,
      csrf: shell.csrf,
      notice: noticeFor(registrations),
      reasonLimit: MAXIMUM_REASON_LENGTH,
    };
    let body: string;
    try {
      body = accountsBody(drawn);
    } catch {
      // An answer not in the route's shape is as good as none.
      body = accountsBody({ ...drawn, status: undefined });
    }
    return shellPage(shell, 'Accounts', body, true);
  }

  /**
   * Backups (#2647): `GET /v1/operate/backups`, read as the owner through
   * the seam on every load. `noticeFor` says what the last "back up now"
   * came to, given the backups read back after it.
   */
  async function backupsPage(
    view: PageCall,
    shell: ShellView,
    strength: AdminSessionRecord['strength'],
    noticeFor: (backups: BackupsView['backups']) => BackupsNotice | null,
  ): Promise<string> {
    const backups = backupsOf(await read(view.seam, BACKUPS_ROUTE, view.caller, view.client));
    const drawn = { backups, strength, csrf: shell.csrf, notice: noticeFor(backups) };
    let body: string;
    try {
      body = backupsBody(drawn);
    } catch {
      body = backupsBody({ ...drawn, backups: undefined });
    }
    return shellPage(shell, 'Backups', body, true);
  }

  /**
   * Rooms (#2649): `GET /v1/operate/rooms`, read as the owner through the
   * seam on every load. `noticeFor` says what the last End room came to,
   * given the rooms read back after it.
   */
  async function roomsPage(
    view: PageCall,
    shell: ShellView,
    strength: AdminSessionRecord['strength'],
    noticeFor: (rooms: readonly RoomAnswer[] | undefined) => { readonly ended: boolean } | null,
  ): Promise<string> {
    const rooms = roomsOf(await read(view.seam, ROOMS_ROUTE, view.caller, view.client));
    const drawn = { rooms, strength, csrf: shell.csrf, notice: noticeFor(rooms) };
    let body: string;
    try {
      body = roomsBody(drawn);
    } catch {
      body = roomsBody({ ...drawn, rooms: undefined });
    }
    return shellPage(shell, 'Rooms', body, true);
  }

  /** Status: `GET /v1/operate/status`'s answer, drawn as operate-text's rows. */
  async function statusPage(view: PageCall, shell: ShellView): Promise<string> {
    const answer = await read(view.seam, '/v1/operate/status', view.caller, view.client);
    const status =
      typeof answer === 'object' && answer !== null ? (answer as OperateStatusAnswer) : undefined;
    let body: string;
    try {
      body = statusBody(status, options.now());
    } catch {
      // An answer not in the route's shape is as good as none.
      body = statusBody(undefined, options.now());
    }
    return shellPage(shell, 'Status', body);
  }

  /** The operator log: one page of `GET /v1/operate/log`, newest first, older by the route's cursor. */
  async function logPage(view: PageCall, shell: ShellView, cursor: string | null): Promise<string> {
    let shown: LogView;
    if (cursor !== null && !LOG_CURSOR.test(cursor)) {
      shown = { kind: 'bad-cursor' };
    } else {
      const query = new URLSearchParams({ limit: String(LOG_PAGE_SIZE) });
      if (cursor !== null) query.set('cursor', cursor);
      const { status, body: answer } = await readWithStatus(
        view.seam,
        `/v1/operate/log?${query.toString()}`,
        view.caller,
        view.client,
      );
      const page = answer as { entries?: unknown; cursor?: unknown } | undefined;
      shown =
        typeof page === 'object' &&
        page !== null &&
        Array.isArray(page.entries) &&
        (page.cursor === null || typeof page.cursor === 'string')
          ? {
              kind: 'page',
              entries: page.entries.map((entry): LogEntryAnswer => {
                const row = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<
                  string,
                  unknown
                >;
                return {
                  id: row.id,
                  at: row.at,
                  source: row.source,
                  action: row.action,
                  detail: row.detail,
                  outcome: row.outcome,
                };
              }),
              older: page.cursor,
              newest: cursor === null,
            }
          : // Only the route's own refusal (400, validation_failed) says the cursor is not ours;
            // any other failed read is an unreadable log, whichever page was asked for.
            cursor !== null && status === 400
            ? { kind: 'bad-cursor' }
            : { kind: 'unreadable' };
    }
    return shellPage(shell, 'Operator log', logBody(shown));
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
    if (listener === 'loopback' && loopbackPort === undefined) {
      // The adapter marks a request loopback only when it owns that listener,
      // which exists only with a port; never mix the tunnel's origin in.
      throw new Error('a loopback admin request arrived with no loopback port configured');
    }
    const place =
      listener === 'loopback'
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

    const signInAnswer = (notice: SignInNotice, status: number): Response =>
      adminResponse(signInPage(options.name, notice), status, HTML);

    const refusedForm = (): Response =>
      htmlAnswer(
        'Not accepted',
        '<h1>That form was not accepted</h1>\n<p>It did not come from this instance’s own admin page, so nothing was changed. <a href="/admin">Go back to the admin pages</a> and try again.</p>',
        403,
      );

    const nothingChanged = (
      status: number,
      why: string,
      back: { readonly path: string; readonly what: string } = {
        path: '/admin/passkeys',
        what: 'the passkeys',
      },
    ): Response =>
      htmlAnswer(
        'Nothing changed',
        `<h1>Nothing was changed</h1>\n<p>${escapeHtml(why)}</p>\n<p><a href="${back.path}">Go back to ${back.what}</a>.</p>`,
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

    /** The shell's view of this session, for the page at `path`. */
    async function shellOf(path: string, session: Session): Promise<ShellView> {
      return {
        name: options.name,
        path,
        strength: session.record.strength,
        listener: session.record.listener,
        csrf: await csrfOf(session.token),
      };
    }

    /** The owner as the seam calls a route for them, in this session. */
    const callerOf = (owner: Owner, session: Session): Caller => ({
      athleteId: owner.athleteId,
      deviceKey: owner.ownerKey,
      tokenSha256: session.record.tokenSha256,
      standing: owner.standing,
    });

    async function signedInPage(
      path: string,
      url: URL,
      owner: Owner,
      session: Session,
      client: ClientInfo,
      seam: AdminSeam,
    ): Promise<Response> {
      if (path === '/admin/passkeys') return passkeysPage(owner, session);
      const shell = await shellOf(path, session);
      const view = { caller: callerOf(owner, session), client, seam };
      if (path === '/admin/status') return adminResponse(await statusPage(view, shell), 200, HTML);
      if (path === '/admin/rooms') {
        return adminResponse(
          await roomsPage(view, shell, session.record.strength, () => null),
          200,
          HTML,
        );
      }
      if (path === '/admin/backups') {
        return adminResponse(
          await backupsPage(view, shell, session.record.strength, () => null),
          200,
          HTML,
        );
      }
      if (path === '/admin/accounts') {
        return adminResponse(
          await accountsPage(view, shell, session.record.strength, () => null),
          200,
          HTML,
        );
      }
      if (path === '/admin/analysis') {
        return adminResponse(
          await analysisPage(view, shell, session.record.strength, () => null),
          200,
          HTML,
        );
      }
      if (path === '/admin/log') {
        return adminResponse(await logPage(view, shell, url.searchParams.get('cursor')), 200, HTML);
      }
      // A page in the route table with no renderer here is a defect, not a page.
      throw new Error('an admin page with no renderer');
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
        return signInAnswer('code-refused', 400);
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
      return seeOther(ADMIN_LANDING, { 'set-cookie': cookieFor(token) });
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
      // Taken, once, whatever the rest of the answer is (past the session and label checks).
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
        return signInAnswer('passkey-refused', 400);
      }
      const proved = await verified(assertion, challenge, owner, false);
      if (typeof proved === 'string') {
        refuse(proved);
        return signInAnswer('passkey-refused', 400);
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
        return signInAnswer('passkey-refused', 400);
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
      const passkeys = (await store.listAdminPasskeys()).map((passkey): PasskeyView => ({
        id: passkey.id,
        label: passkey.label,
        enrolledAt: passkey.enrolledAt,
        lastUsedAt: passkey.lastUsedAt,
        rpId: passkey.rpId,
        standing:
          passkey.ownerKey !== owner.ownerKey
            ? 'other-owner'
            : passkey.rpId !== rpId
              ? 'other-host'
              : passkey.confirmedAt === null
                ? 'unconfirmed'
                : 'confirmed',
      }));
      const shell = await shellOf('/admin/passkeys', session);
      const body = passkeysBody({
        passkeys,
        rpId,
        strength: session.record.strength,
        csrf: shell.csrf,
        max: MAX_ADMIN_PASSKEYS,
        labelLimit: PASSKEY_LABEL_LIMIT,
      });
      return adminResponse(shellPage(shell, 'Passkeys', body, true), 200, HTML);
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
      // Taken, once, whatever the rest of the answer is (past the session and label checks).
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

    /**
     * One change of the AI backend page (#2648, ADR 0069 D-2, D-4): from this
     * origin's page, in a live PASSKEY session carrying its token, with a
     * fresh step-up for exactly this change and these fields — then ONE call
     * of the route, in-process as the owner, whose own checks and operator
     * log entry (in its own transaction, under this listener's source) are
     * the change's. The answer is the page drawn again from the routes'
     * reads AFTER the call, never from the form.
     */
    async function analysisChange(
      request: Request,
      body: Uint8Array | null,
      owner: Owner,
      client: ClientInfo,
      seam: AdminSeam,
      action: AnalysisAction,
    ): Promise<Response> {
      const back = { path: '/admin/analysis', what: 'the AI backend' };
      const form = formOf(body);
      const session = await signedInPost(request, form, owner);
      if (session instanceof Response) return session;
      if (session.record.strength !== 'passkey') {
        refuse('step_up');
        return nothingChanged(
          403,
          'A change needs a passkey sign-in: a one-time code’s session changes nothing.',
          back,
        );
      }
      const fields = boundFields(ADMIN_CHANGES[action].fields, form);
      const call = fields === undefined ? undefined : analysisCall(action, fields);
      if (fields === undefined || call === undefined) {
        refuse('step_up');
        return nothingChanged(400, 'That form did not name one change.', back);
      }
      const stepped = await steppedUp(owner, session, action, fields, form);
      if (stepped === undefined) {
        return nothingChanged(
          403,
          'The passkey check did not pass: a change needs a fresh check by a confirmed passkey, made for this change.',
          back,
        );
      }
      // The counter moves before the change, so the same assertion cannot make a second.
      const at = seconds();
      if (
        !(await store.recordAdminPasskeyUse(
          stepped.passkey.id,
          stepped.passkey.signCount,
          stepped.signCount,
          at,
        ))
      ) {
        refuse('counter');
        return nothingChanged(409, 'That passkey was just used elsewhere. Try again.', back);
      }
      const caller = callerOf(owner, session);
      const answer = await seam.dispatch(call.method, call.path, caller, client, call.body);
      const done = answer.status === 200;
      const problem = done || action !== 'analysis_address' ? null : await problemOf(answer);
      const outcome = action === 'analysis_check' ? await outcomeOf(answer) : null;
      const shell = await shellOf('/admin/analysis', session);
      const page = await analysisPage(
        { caller, client, seam },
        shell,
        session.record.strength,
        (after): AnalysisNotice => {
          const holds =
            done &&
            after !== undefined &&
            (call.holds === undefined || analysisHolds(after, call.holds)) &&
            (call.readBack === undefined || call.readBack(after));
          switch (action) {
            case 'analysis_offer':
              return { about: 'offers', ok: holds };
            case 'analysis_check':
              return { about: 'check', model: fields.model ?? '', outcome };
            case 'analysis_model':
              return { about: 'model', ok: holds };
            case 'analysis_address':
              return { about: 'address', ok: holds, problem };
            case 'analysis_clear':
              return { about: 'return', ok: holds };
          }
        },
      );
      return adminResponse(page, done ? 200 : answer.status === 400 ? 400 : 409, HTML);
    }

    /**
     * The gate every change of a page after #2648 goes through (ADR 0069 D-2,
     * D-4): from this origin's page, in a live PASSKEY session carrying its
     * token, with exactly `action`'s fields — which `valid` checks — and a
     * fresh step-up for this change and these fields, whose passkey counter
     * moves BEFORE the change is made, so the same assertion cannot make a
     * second. Answers the session and the fields, or the answer that refuses,
     * having changed nothing.
     */
    async function gatedChange(
      request: Request,
      form: URLSearchParams,
      owner: Owner,
      action: AdminChange,
      back: { readonly path: string; readonly what: string },
      valid: (fields: Readonly<Record<string, string>>) => boolean,
    ): Promise<
      { readonly session: Session; readonly fields: Readonly<Record<string, string>> } | Response
    > {
      const session = await signedInPost(request, form, owner);
      if (session instanceof Response) return session;
      if (session.record.strength !== 'passkey') {
        refuse('step_up');
        return nothingChanged(
          403,
          'A change needs a passkey sign-in: a one-time code’s session changes nothing.',
          back,
        );
      }
      const fields = boundFields(ADMIN_CHANGES[action].fields, form);
      if (fields === undefined || !valid(fields)) {
        refuse('step_up');
        return nothingChanged(400, 'That form did not name one change.', back);
      }
      const stepped = await steppedUp(owner, session, action, fields, form);
      if (stepped === undefined) {
        return nothingChanged(
          403,
          'The passkey check did not pass: a change needs a fresh check by a confirmed passkey, made for this change.',
          back,
        );
      }
      if (
        !(await store.recordAdminPasskeyUse(
          stepped.passkey.id,
          stepped.passkey.signCount,
          stepped.signCount,
          seconds(),
        ))
      ) {
        refuse('counter');
        return nothingChanged(409, 'That passkey was just used elsewhere. Try again.', back);
      }
      return { session, fields };
    }

    /**
     * A registration approved or refused from the Accounts page (#2646, ADR
     * 0069 D-9): through {@link gatedChange}, then ONE call of the moderation
     * route, in-process as the owner — its moderator check, its reason rule
     * and its moderation log row, written with a `registration_decided`
     * operator log entry under this listener's source in one transaction.
     * The answer is the page drawn again from the routes' reads AFTER the
     * call: the decision is said to be made only when the rider has left the
     * queue read back.
     */
    async function registrationChange(
      request: Request,
      body: Uint8Array | null,
      owner: Owner,
      client: ClientInfo,
      seam: AdminSeam,
      decision: RegistrationDecision,
    ): Promise<Response> {
      const gated = await gatedChange(
        request,
        formOf(body),
        owner,
        `registration_${decision}`,
        { path: '/admin/accounts', what: 'Accounts' },
        (fields) => ATHLETE_ID.test(fields.athleteId ?? ''),
      );
      if (gated instanceof Response) return gated;
      const { session, fields } = gated;
      const athleteId = fields.athleteId as string;
      const caller = callerOf(owner, session);
      const answer = await seam.dispatch(
        'POST',
        `${REGISTRATIONS_ROUTE}/${athleteId}/${decision}`,
        caller,
        client,
        { reason: fields.reason },
      );
      const done = answer.status === 200;
      const shell = await shellOf('/admin/accounts', session);
      const page = await accountsPage(
        { caller, client, seam },
        shell,
        session.record.strength,
        (after): AccountsNotice => ({
          decision,
          ok:
            done &&
            after !== undefined &&
            !after.some((registration) => registration.athleteId === athleteId),
          problem: done ? null : answer.status === 400 ? 'reason' : 'not-waiting',
        }),
      );
      return adminResponse(page, done ? 200 : answer.status === 400 ? 400 : 409, HTML);
    }

    /**
     * "Back up now" from the Backups page (#2647, ADR 0069 D-2): through
     * {@link gatedChange} on BOTH listeners — the owner's answer to Q-A, which
     * the issue's body predates — then ONE call of `POST /v1/operate/backups`
     * in-process as the owner, whose `too_many` rule and `backup_requested`
     * entry, under this listener's source, are the route's own. The answer is
     * the page drawn again from the route's read AFTER the call.
     */
    async function backupChange(
      request: Request,
      body: Uint8Array | null,
      owner: Owner,
      client: ClientInfo,
      seam: AdminSeam,
    ): Promise<Response> {
      const gated = await gatedChange(
        request,
        formOf(body),
        owner,
        'backup_now',
        { path: '/admin/backups', what: 'Backups' },
        () => true,
      );
      if (gated instanceof Response) return gated;
      const { session } = gated;
      const caller = callerOf(owner, session);
      const answer = await seam.dispatch('POST', BACKUPS_ROUTE, caller, client, {});
      const asked = answer.status === 202;
      const sentence = asked || answer.status !== 429 ? null : await messageOf(answer);
      const shell = await shellOf('/admin/backups', session);
      const page = await backupsPage(
        { caller, client, seam },
        shell,
        session.record.strength,
        (after): BackupsNotice =>
          asked
            ? { kind: 'asked', ok: after !== undefined && after.pendingSince !== null }
            : sentence === null
              ? { kind: 'not-asked' }
              : { kind: 'refused', sentence },
      );
      return adminResponse(page, asked ? 200 : answer.status === 429 ? 429 : 409, HTML);
    }

    /**
     * End room from the Rooms page (#2649, ADR 0069 D-2): through
     * {@link gatedChange} — the room's id shape-checked before it is put in
     * the route's `{roomId}`, the reason one of the route's, and the typed
     * code bound to the step-up with them — then ONE call of `POST
     * /v1/operate/rooms/{roomId}/end` in-process as the owner: its typed-code
     * check, its close with `4005 room-closed`, the refused rejoin, the
     * results kept and its `room_ended` entry under this listener's source are
     * the route's own. Nothing is sent to any rider's trainer. The answer is
     * the page drawn again from the route's read AFTER the call.
     */
    async function roomChange(
      request: Request,
      body: Uint8Array | null,
      owner: Owner,
      client: ClientInfo,
      seam: AdminSeam,
    ): Promise<Response> {
      const gated = await gatedChange(
        request,
        formOf(body),
        owner,
        'room_end',
        { path: '/admin/rooms', what: 'Rooms' },
        (fields) =>
          ROOM_ID.test(fields.roomId ?? '') &&
          ROOM_END_REASON_WORDS.includes(fields.reason ?? '') &&
          (fields.confirm ?? '').length <= 64,
      );
      if (gated instanceof Response) return gated;
      const { session, fields } = gated;
      const roomId = fields.roomId as string;
      const caller = callerOf(owner, session);
      const answer = await seam.dispatch('POST', `${ROOMS_ROUTE}/${roomId}/end`, caller, client, {
        reason: fields.reason,
        confirm: fields.confirm,
      });
      const done = answer.status === 200;
      const shell = await shellOf('/admin/rooms', session);
      const page = await roomsPage(
        { caller, client, seam },
        shell,
        session.record.strength,
        // A closed room whose list cannot be read back says nothing: "as it was" would be false.
        (after) =>
          done && after === undefined
            ? null
            : { ended: done && !after?.some((room) => room.roomId === roomId) },
      );
      return adminResponse(page, done ? 200 : answer.status === 400 ? 400 : 409, HTML);
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
      const url = new URL(request.url);
      const path = url.pathname;
      const revokeId = REVOKE_PATH.exec(path)?.[1];
      const route = revokeId === undefined ? path : '/admin/passkeys/{id}/revoke';
      const methods = METHODS.get(route);
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
        return adminResponse(ADMIN_STYLE, 200, { 'content-type': 'text/css; charset=utf-8' });
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
        const analysisAction = ANALYSIS_ACTIONS.get(route);
        if (analysisAction !== undefined) {
          return analysisChange(request, body, owner, client, seam, analysisAction);
        }
        if (route === '/admin/backups') return backupChange(request, body, owner, client, seam);
        if (route === '/admin/rooms/end') return roomChange(request, body, owner, client, seam);
        const decision = REGISTRATION_ACTIONS.get(route);
        if (decision !== undefined) {
          return registrationChange(request, body, owner, client, seam, decision);
        }
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
        if (session !== undefined) return seeOther(ADMIN_LANDING);
        const enrolled = url.searchParams.has('enrolled');
        return signInAnswer(enrolled ? 'enrolled' : null, 200);
      }
      // Every other GET is a signed-in page: nothing of the instance's state without a session.
      if (session === undefined) return seeOther('/admin/sign-in');
      if (path === '/admin') return seeOther(ADMIN_LANDING);
      return signedInPage(path, url, owner, session, client, seam);
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
