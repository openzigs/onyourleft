// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The first-run setup wizard** (#2784, ADR 0080 D-1, D-2, D-6, D-7): the
 * pages at `/setup` on the loopback listener that take a non-technical owner
 * from a fresh install to a claimed, backed-up instance with no `.env` edit.
 *
 * ## Where, and until when (D-1)
 *
 * - **On the loopback listener only.** `handler.ts` hands a `/setup` path here
 *   only when the ADAPTER marked the request `loopback` (`ClientInfo.listener`,
 *   never a header). Through the tunnel every `/setup` path falls through to
 *   the route table, which has no such route: `not_found`, as any path with no
 *   route is.
 * - **Only while the setup is open.** {@link Setup.handle} answers `undefined`
 *   — and so the same `not_found` — once the setup is **done**, read from the
 *   database on EVERY request (`setup_state`), so a restart never reopens it;
 *   and from the first start when `OYL_INSTANCE_OWNER_KEY` is set (D-3: the
 *   environment wins, and an existing install is done).
 * - **At `http://localhost:<port>` only**: a passkey's RP ID cannot be an IP
 *   address, and the `Host` check is exact (DNS rebinding), so any other host
 *   — `127.0.0.1:<port>` among them — is told which address to open.
 *
 * ## The setup session (D-2)
 *
 * A setup code (`setup-code.ts`), typed on the locked page, opens a session:
 * the cookie {@link SETUP_COOKIE} (`HttpOnly; SameSite=Strict; Path=/setup`,
 * no `Secure`, which WebKit drops on `http://localhost` — `admin.ts`
 * §`LOOPBACK_COOKIE`), its token's SHA-256 alone in `setup_session`, 15
 * minutes idle and 2 hours at most, enforced from the row. ADR 0069 D-4's
 * three CSRF layers: `SameSite=Strict`, a synchronizer token in every form,
 * and every `POST` refused unless its `Origin` is exactly the loopback
 * origin. Code attempts are counted per address and in all BEFORE anything is
 * looked up (ADR 0069 D-4's 10 and 30 a minute), so the Nth attempt is refused
 * even with the right code. A refused code gets ONE sentence, whichever way it
 * failed, and never what was typed. Refusals are counted in memory and
 * {@link Setup.flushRefusals} writes one `setup_refused` entry per kind.
 *
 * ## What a setup session may do (D-7, Q-7)
 *
 * Only while the setup is open, and without a passkey: mint the claim code and
 * confirm or discard a pending claim (D-3, D-5), download the emergency kit
 * ONCE (D-4), ask for a backup and show what the backup folders did (D-6), set
 * the registration mode (D-6), mint ONE rider invite (D-7), and finish. Every
 * change writes the operator log in the same transaction, from the source
 * `setup`, naming no athlete. The step the setup is on is kept in the database,
 * so leaving and coming back — after a restart, with a new code — resumes it.
 *
 * Nothing here renders the setup code, a secret, a token or a coordinate (see
 * `pages.ts` for ADR 0080's own exceptions).
 */

import { randomToken, sha256Hex } from '../auth/crypto.ts';
import { adminCodeSha256 } from '../admin/code.ts';
import { adminResponse } from '../admin/headers.ts';
import { ACTION_LABEL } from '../admin/pages.ts';
import { ADMIN_STYLE } from '../admin/style.ts';
import { INVITE_LIFETIME_SECONDS, readableCode } from '../auth/identity.ts';
import type { OwnerClaim } from '../auth/owner-claim.ts';
import {
  addressKey,
  createRateLimiter,
  sweepPeriodMs,
  type RateLimit,
} from '../auth/rate-limit.ts';
import { REGISTRATION_MODES, type RegistrationMode } from '../config.ts';
import type { InstanceKeys } from '../keys/instance-keys.ts';
import { keysView } from '../operate/operate.ts';
import type { ClientInfo } from '../route-kit.ts';
import type {
  BackupRequestOutcome,
  OperatorChange,
  SetupSessionRecord,
  SqlStore,
} from '../store/sql-store.ts';
import { emergencyKitText, EMERGENCY_KIT_FILE_NAME } from './emergency-kit.ts';
import {
  backupsBody,
  claimBody,
  finishBody,
  finishedPage,
  formRefusedPage,
  inviteBody,
  lockedPage,
  messagePage,
  passkeyBody,
  registrationBody,
  secretsBody,
  stepPage,
  wrongAddressPage,
  type ClaimView,
  type InviteView,
  type SetupFrame,
} from './pages.ts';
import type { SecretFromFile } from './secrets.ts';
import { removeSetupCodeFile, setupAddress } from './setup-code.ts';
import { SETUP_ROUTES, SETUP_STEPS, stepPath, type SetupStep } from './setup-routes.ts';

/** The setup session's cookie. */
export const SETUP_COOKIE = 'oyl-setup';

/** A session not used for this long is over, in seconds (ADR 0069 D-4). */
export const SETUP_IDLE_SECONDS = 15 * 60;

/** A session is over this long after it opened, in seconds. */
export const SETUP_LIFETIME_SECONDS = 2 * 60 * 60;

export interface SetupLimits {
  /** Code attempts per client address. */
  readonly perAddress: RateLimit;
  /** Code attempts from everybody together. */
  readonly overall: RateLimit;
}

/** ADR 0069 D-4's sign-in limits, which ADR 0080 D-2 applies to a setup code. */
export const DEFAULT_SETUP_LIMITS: SetupLimits = {
  perAddress: { limit: 10, windowMs: 60_000 },
  overall: { limit: 30, windowMs: 60_000 },
};

/** What a refusal is counted as, in its `setup_refused` entry. */
export type SetupRefusal = 'code' | 'csrf' | 'origin' | 'rate_limited';

export interface SetupOptions {
  readonly store: SqlStore;
  /** Unix milliseconds. */
  readonly now: () => number;
  /** `OYL_INSTANCE_ADMIN_LOOPBACK_PORT`: the loopback listener's port, and so its origin. */
  readonly port: number;
  /** `OYL_INSTANCE_ORIGIN`: what the emergency kit and the card are bound to. */
  readonly origin: string;
  /** What the operator calls the instance, or `null`. */
  readonly name: string | null;
  /** `OYL_INSTANCE_OWNER_KEY` is set: the setup is done from the first start (ADR 0080 D-3, D-7). */
  readonly ownerKeyFromEnvironment: boolean;
  /** The owner's claim (#2782): minted, confirmed and discarded from the setup source. */
  readonly ownerClaim: OwnerClaim;
  /** The instance's own keys, for the card the claim and the invite carry. */
  readonly instanceKeys?: Pick<InstanceKeys, 'show'>;
  /** The secrets read from the secrets folder: what the emergency kit holds. */
  readonly kitSecrets: readonly SecretFromFile[];
  /** `OYL_INSTANCE_REGISTRATION`, which the database's mode wins over (ADR 0080 D-6). */
  readonly environmentRegistration: RegistrationMode;
  /** `OYL_INSTANCE_SECRETS_DIR`: where the setup code's file is removed from. */
  readonly secretsDirectory: string | undefined;
  readonly limits?: SetupLimits;
}

export interface Setup {
  /**
   * Answer a `/setup` request on the loopback listener — or `undefined` once
   * the setup is done, having read nothing of it, and the handler answers it
   * as a path with no route. `body` reads a `POST`'s, within the admin pages'
   * form limit, and is called only once the setup is known to be open.
   */
  handle(
    request: Request,
    body: () => Promise<Uint8Array | null | 'too-large'>,
    client: ClientInfo,
  ): Promise<Response | undefined>;
  /** Write one `setup_refused` entry per kind refused since the last flush. */
  flushRefusals(): Promise<void>;
  /** Forget every rate-limit key whose window has ended. */
  sweepRateLimits(): void;
  readonly rateLimitSweepPeriodMs: number;
}

const HTML = { 'content-type': 'text/html; charset=utf-8' } as const;

const page = (html: string, status: number, extra: Readonly<Record<string, string>> = {}) =>
  adminResponse(html, status, { ...HTML, ...extra });

const seeOther = (location: string, extra: Readonly<Record<string, string>> = {}): Response =>
  adminResponse(null, 303, { location, ...extra });

/** A session token as {@link randomToken} writes 32 bytes. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** A claim's comparison number (ADR 0080 D-5). */
const SIX_DIGITS = /^[0-9]{6}$/;

function cookieValue(header: string | null, name: string): string | undefined {
  if (header === null) return undefined;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return undefined;
}

/** Two strings compared in time that depends on their length alone. */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

/** The session's synchronizer token, from its cookie's token: 256 bits nobody without the cookie can compute. */
const csrfOf = (token: string): Promise<string> => sha256Hex(`oyl-setup-csrf:${token}`);

function formOf(body: Uint8Array | null): URLSearchParams {
  return new URLSearchParams(body === null ? '' : new TextDecoder().decode(body));
}

function single(form: URLSearchParams, name: string): string | undefined {
  const values = form.getAll(name);
  return values.length === 1 ? values[0] : undefined;
}

const isStep = (value: string | undefined): value is SetupStep =>
  value !== undefined && (SETUP_STEPS as readonly string[]).includes(value);

const isMode = (value: string | undefined): value is RegistrationMode =>
  value !== undefined && (REGISTRATION_MODES as readonly string[]).includes(value);

const ROUTES: ReadonlyMap<string, readonly string[]> = new Map(
  SETUP_ROUTES.map((route) => [route.path, route.methods]),
);

/** The step each change belongs to: refused, as a redirect, before the setup has reached it. */
const ACTION_STEP: ReadonlyMap<string, SetupStep> = new Map([
  ['/setup/claim/code', 'claim'],
  ['/setup/claim/confirm', 'claim'],
  ['/setup/claim/discard', 'claim'],
  ['/setup/secrets/kit', 'secrets'],
  ['/setup/backups/now', 'backups'],
  ['/setup/registration/mode', 'registration'],
  ['/setup/invite/code', 'invite'],
  ['/setup/finish/done', 'finish'],
]);

const iso = (seconds: number): string => new Date(seconds * 1000).toISOString();

export function createSetup(options: SetupOptions): Setup {
  const { store } = options;
  const limits = options.limits ?? DEFAULT_SETUP_LIMITS;
  const perAddress = createRateLimiter(limits.perAddress, options.now);
  const overall = createRateLimiter(limits.overall, options.now);
  const seconds = (): number => Math.floor(options.now() / 1000);
  const origin = `http://localhost:${String(options.port)}`;
  const host = `localhost:${String(options.port)}`;
  const attributes = 'HttpOnly; SameSite=Strict; Path=/setup';
  const cookieFor = (token: string): string => `${SETUP_COOKIE}=${token}; ${attributes}`;
  const CLEARED = `${SETUP_COOKIE}=; ${attributes}; Max-Age=0`;
  const refused = new Map<SetupRefusal, number>();
  const refuse = (kind: SetupRefusal): void => {
    refused.set(kind, (refused.get(kind) ?? 0) + 1);
  };

  /** Whether the setup is open: read from the database on every request (D-1, D-7). */
  async function open(): Promise<boolean> {
    if (options.ownerKeyFromEnvironment) return false;
    return ((await store.setupState())?.doneAt ?? null) === null;
  }

  /** The furthest step the setup has reached: the claim until there is an owner. */
  async function reached(): Promise<SetupStep> {
    if ((await store.claimedOwnerKey()) === undefined) return 'claim';
    const state = await store.setupState();
    return state === undefined || state.step === 'claim' ? 'passkey' : state.step;
  }

  /** The instance card, whole, or `null` when the keys cannot be read. */
  async function cardOf(): Promise<string | null> {
    if (options.instanceKeys === undefined) return null;
    const shown = await keysView(options.instanceKeys);
    return shown.card ?? null;
  }

  /** The owner's athlete, by the claimed key, or `undefined` before that device signs in. */
  async function ownerAthlete(): Promise<string | undefined> {
    const key = await store.claimedOwnerKey();
    if (key === undefined) return undefined;
    const held = await store.findDeviceKey(key);
    return held === undefined || held.revokedAt !== null ? undefined : held.athleteId;
  }

  interface Session {
    readonly record: SetupSessionRecord;
    readonly token: string;
  }

  async function presented(request: Request): Promise<{ token: string; sha: string } | undefined> {
    const token = cookieValue(request.headers.get('cookie'), SETUP_COOKIE);
    if (token === undefined || !TOKEN.test(token)) return undefined;
    return { token, sha: await sha256Hex(token) };
  }

  /** The live session the request carries, its idle clock restarted; a session that is over is ended. */
  async function sessionOf(request: Request): Promise<Session | undefined> {
    const cookie = await presented(request);
    if (cookie === undefined) return undefined;
    const record = await store.findSetupSession(cookie.sha);
    if (record === undefined) return undefined;
    const at = seconds();
    if (record.expiresAt <= at || record.lastSeenAt + SETUP_IDLE_SECONDS <= at) {
      await store.endSetupSession(cookie.sha);
      return undefined;
    }
    await store.touchSetupSession(cookie.sha, at);
    return { record, token: cookie.token };
  }

  /** Layer 3: the request came from this origin's own page. */
  function fromOurPage(request: Request): boolean {
    if (request.headers.get('origin') !== origin) return false;
    const site = request.headers.get('sec-fetch-site');
    return site === null || site === 'same-origin';
  }

  /** A signed-in `POST`: from our page, in a live session, carrying its token — or its refusal. */
  async function signedInPost(
    request: Request,
    form: URLSearchParams,
  ): Promise<Session | Response> {
    if (!fromOurPage(request)) {
      refuse('origin');
      return page(formRefusedPage(), 403);
    }
    const session = await sessionOf(request);
    if (session === undefined) return seeOther('/setup', { 'set-cookie': CLEARED });
    const sent = single(form, 'csrf');
    if (sent === undefined || !sameText(await sha256Hex(sent), session.record.csrfSha256)) {
      refuse('csrf');
      return page(formRefusedPage(), 403);
    }
    return session;
  }

  async function frameOf(step: SetupStep, session: Session): Promise<SetupFrame> {
    return {
      name: options.name,
      step,
      reached: await reached(),
      csrf: await csrfOf(session.token),
    };
  }

  async function signIn(request: Request, body: Uint8Array | null, client: ClientInfo) {
    if (!fromOurPage(request)) {
      refuse('origin');
      return page(formRefusedPage(), 403);
    }
    // Counted before any code is looked at, so the Nth attempt is refused even with the right code.
    const addressAllowed = perAddress.allow(addressKey(client.address ?? 'unknown'));
    if (!addressAllowed || !overall.allow('all')) {
      refuse('rate_limited');
      return page(lockedPage(options.name, 'too-many'), 429, { 'retry-after': '60' });
    }
    const codeSha256 = await adminCodeSha256(single(formOf(body), 'code') ?? '');
    const at = seconds();
    const token = randomToken(32);
    const opened =
      codeSha256 === undefined
        ? 'refused'
        : await store.openSetupSessionWithCode({
            codeSha256,
            idleSeconds: SETUP_IDLE_SECONDS,
            session: {
              tokenSha256: await sha256Hex(token),
              csrfSha256: await sha256Hex(await csrfOf(token)),
              createdAt: at,
              lastSeenAt: at,
              expiresAt: at + SETUP_LIFETIME_SECONDS,
              kitDownloadedAt: null,
            },
          });
    if (opened === 'refused') {
      refuse('code');
      return page(lockedPage(options.name, 'code-refused'), 400);
    }
    // A session this browser held before is never carried on (no fixation).
    const before = await presented(request);
    if (before !== undefined) await store.endSetupSession(before.sha);
    // The code is used: its file goes (D-2).
    await removeSetupCodeFile(options.secretsDirectory);
    return seeOther('/setup', { 'set-cookie': cookieFor(token) });
  }

  /** A step's page, drawn from the database on every load. */
  async function stepAnswer(step: SetupStep, url: URL, session: Session): Promise<Response> {
    const frame = await frameOf(step, session);
    const csrf = frame.csrf;
    switch (step) {
      case 'claim': {
        if ((await store.claimedOwnerKey()) !== undefined) {
          return page(stepPage(frame, claimBody({ kind: 'claimed' }, csrf), true), 200);
        }
        const pending = await options.ownerClaim.pending();
        const view: ClaimView =
          pending === undefined
            ? {
                kind: 'open',
                card: (await cardOf()) !== null,
                notConfirmed: url.searchParams.has('unconfirmed'),
              }
            : { kind: 'pending', comparisonCode: pending.comparisonCode };
        return page(stepPage(frame, claimBody(view, csrf), false), 200);
      }
      case 'passkey':
        return page(stepPage(frame, passkeyBody(`${origin}/admin`), true), 200);
      case 'secrets': {
        const kit =
          options.kitSecrets.length === 0
            ? 'none'
            : session.record.kitDownloadedAt === null
              ? 'offer'
              : 'taken';
        return page(stepPage(frame, secretsBody(kit, csrf), true), 200);
      }
      case 'backups': {
        const [records, pending] = await Promise.all([
          store.listBackupRecords(1),
          store.pendingBackupRequest(),
        ]);
        const newest = records[0];
        const body = backupsBody(
          {
            last:
              newest === undefined
                ? null
                : { at: iso(newest.at), outcome: newest.outcome, offBox: newest.offBox },
            waiting: pending !== undefined,
            notice: url.searchParams.has('too-soon')
              ? 'too-soon'
              : url.searchParams.has('asked')
                ? 'asked'
                : null,
          },
          csrf,
        );
        return page(stepPage(frame, body, true), 200);
      }
      case 'registration': {
        const held = await store.registrationSetting();
        const body = registrationBody(
          {
            mode: held ?? options.environmentRegistration,
            from: held === undefined ? 'env' : 'setup',
            saved: url.searchParams.has('saved'),
          },
          csrf,
        );
        return page(stepPage(frame, body, true), 200);
      }
      case 'invite':
        return page(stepPage(frame, inviteBody(await inviteView(), csrf), true), 200);
      case 'finish':
        return page(stepPage(frame, finishBody(await changesOf(), csrf), false), 200);
    }
  }

  async function modeNow(): Promise<RegistrationMode> {
    return (await store.registrationSetting()) ?? options.environmentRegistration;
  }

  async function inviteView(): Promise<InviteView> {
    if (((await store.setupState())?.inviteMintedAt ?? null) !== null) return { kind: 'taken' };
    if ((await ownerAthlete()) === undefined) return { kind: 'no-owner' };
    if ((await cardOf()) === null) return { kind: 'no-card' };
    return { kind: 'offer', inviteMode: (await modeNow()) === 'invite' };
  }

  /**
   * What this setup changed, oldest first, in the operator log's own words:
   * every `done` entry from the `setup` source since the setup last began —
   * across the sessions and restarts a resumed setup took (D-7's summary is
   * of the wizard's changes, and a resumed setup is one wizard) — stopping
   * at the newest `owner_claim_reset`, which reopened the setup and began a
   * new one.
   */
  async function changesOf(): Promise<readonly string[]> {
    const changes: string[] = [];
    for (const entry of await store.listOperatorLogPage(undefined, 200)) {
      if (entry.action === 'owner_claim_reset') break;
      if (entry.source !== 'setup' || entry.outcome !== 'done') continue;
      if (entry.action === 'setup_sign_in') continue;
      changes.push(
        entry.detail === null
          ? ACTION_LABEL[entry.action]
          : `${ACTION_LABEL[entry.action]}: ${entry.detail.replaceAll('_', ' ')}`,
      );
    }
    return changes.reverse();
  }

  /** One change, by its form's target, in a session the origin and token checks admitted. */
  async function change(route: string, form: URLSearchParams, session: Session): Promise<Response> {
    const at = seconds();
    const actor = { source: 'setup' } as const;
    const now = await reached();
    if (route === '/setup/next') {
      const from = single(form, 'from');
      const index = SETUP_STEPS.indexOf(now);
      if (isStep(from) && from === now && now !== 'claim' && now !== 'finish') {
        const next = SETUP_STEPS[index + 1] as SetupStep;
        await store.setSetupStep(next, at);
        return seeOther(stepPath(next));
      }
      return seeOther(stepPath(now));
    }
    const step = ACTION_STEP.get(route);
    if (step === undefined || SETUP_STEPS.indexOf(step) > SETUP_STEPS.indexOf(now)) {
      return seeOther(stepPath(now));
    }
    switch (route) {
      case '/setup/claim/code': {
        const card = await cardOf();
        if (card === null) return seeOther('/setup/claim');
        const minted = await options.ownerClaim.mint('setup');
        if (minted === 'claimed') return seeOther('/setup/claim');
        const frame = await frameOf('claim', session);
        const body = claimBody(
          { kind: 'code', card, code: minted.code, expiresAt: iso(minted.expiresAt) },
          frame.csrf,
        );
        return page(stepPage(frame, body, false), 200);
      }
      case '/setup/claim/confirm': {
        const comparison = single(form, 'comparison');
        const confirmed =
          comparison !== undefined && SIX_DIGITS.test(comparison)
            ? await options.ownerClaim.confirm(comparison, 'setup')
            : 'none';
        if (confirmed !== 'confirmed') return seeOther('/setup/claim?unconfirmed');
        await store.setSetupStep('passkey', at);
        return seeOther('/setup/passkey');
      }
      case '/setup/claim/discard':
        await options.ownerClaim.discard('setup');
        return seeOther('/setup/claim');
      case '/setup/secrets/kit': {
        if (options.kitSecrets.length === 0) return seeOther('/setup/secrets');
        const { value: taken } = await store.recordOperatorAction(
          { actor, action: 'emergency_kit_downloaded', at },
          async (inside): Promise<OperatorChange<boolean>> =>
            (await inside.takeSetupKit(session.record.tokenSha256, at))
              ? { outcome: 'done', value: true }
              : { outcome: 'refused', value: false },
        );
        if (!taken) return seeOther('/setup/secrets');
        return adminResponse(
          emergencyKitText({
            origin: options.origin,
            card: await cardOf(),
            secrets: options.kitSecrets,
            madeAt: new Date(options.now()),
          }),
          200,
          {
            'content-type': 'text/plain; charset=utf-8',
            'content-disposition': `attachment; filename="${EMERGENCY_KIT_FILE_NAME}"`,
          },
        );
      }
      case '/setup/backups/now': {
        const { value } = await store.recordOperatorAction<BackupRequestOutcome>(
          { actor, action: 'backup_requested', at },
          async (inside) => {
            const asked = await inside.requestBackup(at);
            return asked.outcome === 'requested'
              ? { outcome: 'done', value: asked }
              : { outcome: 'refused', detail: asked.outcome, value: asked };
          },
        );
        return seeOther(
          value.outcome === 'requested' ? '/setup/backups?asked' : '/setup/backups?too-soon',
        );
      }
      case '/setup/registration/mode': {
        const mode = single(form, 'mode');
        if (!isMode(mode)) {
          return page(
            messagePage('Nothing changed', 'That form did not name a registration mode.'),
            400,
          );
        }
        await store.recordOperatorAction(
          { actor, action: 'registration_mode_set', at },
          async (inside) => {
            await inside.putRegistrationSetting(mode, at, 'setup');
            return { outcome: 'done', detail: mode, value: undefined };
          },
        );
        return seeOther('/setup/registration?saved');
      }
      case '/setup/invite/code': {
        const athleteId = await ownerAthlete();
        const card = await cardOf();
        if (athleteId === undefined || card === null) return seeOther('/setup/invite');
        const code = readableCode(16);
        const codeSha256 = await adminCodeSha256(code);
        if (codeSha256 === undefined) throw new Error('a drawn invite code did not read back');
        const expiresAt = at + INVITE_LIFETIME_SECONDS;
        const { value: minted } = await store.recordOperatorAction(
          { actor, action: 'invite_minted', at },
          async (inside): Promise<OperatorChange<boolean>> => {
            if (!(await inside.takeSetupInvite(at))) return { outcome: 'refused', value: false };
            await inside.mintInviteCode(
              { codeSha256, athleteId, expiresAt },
              { reason: 'Invited from the setup page on the server machine', at },
            );
            return { outcome: 'done', value: true };
          },
        );
        if (!minted) return seeOther('/setup/invite');
        const frame = await frameOf('invite', session);
        const view: InviteView = {
          kind: 'code',
          card,
          code,
          expiresAt: iso(expiresAt),
          inviteMode: (await modeNow()) === 'invite',
        };
        return page(stepPage(frame, inviteBody(view, frame.csrf), true), 200);
      }
      default: {
        // '/setup/finish/done' (D-7): the setup done, every code and session gone, and the file.
        const { value: finished } = await store.recordOperatorAction(
          { actor, action: 'setup_done', at },
          async (inside): Promise<OperatorChange<boolean>> =>
            (await inside.finishSetup(at))
              ? { outcome: 'done', value: true }
              : { outcome: 'refused', value: false },
        );
        await removeSetupCodeFile(options.secretsDirectory);
        if (!finished) return seeOther('/setup');
        return page(finishedPage(options.name), 200, { 'set-cookie': CLEARED });
      }
    }
  }

  return {
    async handle(request, readBody, client) {
      if (!(await open())) return undefined;
      // Against DNS rebinding, and the one address a passkey could use (D-1).
      if (request.headers.get('host') !== host) {
        return page(wrongAddressPage(setupAddress(options.port)), 421);
      }
      const url = new URL(request.url);
      const route = url.pathname;
      const methods = ROUTES.get(route);
      if (methods === undefined) {
        return page(messagePage('Not found', 'There is no setup page at this address.'), 404);
      }
      if (!methods.includes(request.method)) {
        return page(
          messagePage('Not allowed', 'This setup page does not take that request.'),
          405,
          {
            allow: methods.join(', '),
          },
        );
      }
      if (route === '/setup/setup.css') {
        return adminResponse(ADMIN_STYLE, 200, { 'content-type': 'text/css; charset=utf-8' });
      }
      const body = request.method === 'POST' ? await readBody() : null;
      if (body === 'too-large') {
        return page(messagePage('Too large', 'That form was too large. Nothing was changed.'), 413);
      }
      if (request.method === 'POST') {
        if (route === '/setup/sign-in') return signIn(request, body, client);
        const form = formOf(body);
        const session = await signedInPost(request, form);
        if (session instanceof Response) return session;
        return change(route, form, session);
      }
      const session = await sessionOf(request);
      if (route === '/setup') {
        if (session === undefined) return page(lockedPage(options.name, null), 200);
        return seeOther(stepPath(await reached()));
      }
      // Every step is a page of the session: nothing of the setup without one.
      if (session === undefined) return seeOther('/setup');
      const step = route.slice('/setup/'.length) as SetupStep;
      const now = await reached();
      if (SETUP_STEPS.indexOf(step) > SETUP_STEPS.indexOf(now)) return seeOther(stepPath(now));
      return stepAnswer(step, url, session);
    },

    async flushRefusals() {
      const held = [...refused];
      refused.clear();
      for (const [kind, count] of held) {
        try {
          await store.recordOperatorAction(
            { actor: { source: 'setup' }, action: 'setup_refused', at: seconds() },
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
