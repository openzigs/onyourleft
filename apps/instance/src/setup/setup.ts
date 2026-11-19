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
 * the registration mode (D-6), mint ONE rider invite (D-7), and finish. Since
 * #2792 (ADR 0080's amendment of 2026-11-18) also the optional AI step: ask
 * the Ollama found on this machine to download a model whose name the owner
 * types, and choose one it lists as the local model (`analysis/settings.ts`,
 * the row a job reads). Every change writes the operator log in the same
 * transaction, from the source `setup`, naming no athlete. The step the setup is on is kept in the database,
 * so leaving and coming back — after a restart, with a new code — resumes it.
 *
 * The tailnet step (#2817, ADR 0079 D-2, D-8) changes nothing: it reads the
 * address back from the running server's card, says how riders join and what
 * an address change costs, and how to make one in `.env` (ADR 0080's table).
 *
 * Nothing here renders the setup code, a secret, a token or a coordinate (see
 * `pages.ts` for ADR 0080's own exceptions).
 */

import type { SetupSummary } from '@onyourleft/operate-text';

import { randomToken, sha256Hex } from '../auth/crypto.ts';
import {
  createModelPull,
  findOllama,
  loadModel,
  OLLAMA_ADDRESSES,
  type FoundOllama,
} from '../analysis/ollama-setup.ts';
import {
  effectiveAnalysisSettings,
  localServerOf,
  saveAnalysisSettings,
  type AnalysisEnvironment,
  type EffectiveAnalysisSettings,
} from '../analysis/settings.ts';
import { adminCodeSha256 } from '../admin/code.ts';
import { ADMIN_CONTENT_SECURITY_POLICY, adminResponse } from '../admin/headers.ts';
import { INVITE_LIFETIME_SECONDS, readableCode } from '../auth/identity.ts';
import type { OwnerClaim } from '../auth/owner-claim.ts';
import {
  addressKey,
  createRateLimiter,
  sweepPeriodMs,
  type RateLimit,
} from '../auth/rate-limit.ts';
import {
  analysisModelNameProblem,
  REGISTRATION_MODES,
  type RegistrationMode,
  type RemotePath,
} from '../config.ts';
import type { Resolver } from '../history/address.ts';
import { type InstanceKeys, InstanceKeysUnavailable } from '../keys/instance-keys.ts';
import { keysView } from '../operate/operate.ts';
import type { ClientInfo } from '../route-kit.ts';
import type {
  BackupRequestOutcome,
  OperatorAction,
  OperatorChange,
  SetupSessionRecord,
  SqlStore,
} from '../store/sql-store.ts';
import { emergencyKitText, EMERGENCY_KIT_FILE_NAME } from './emergency-kit.ts';
import {
  aiBody,
  backupsBody,
  claimBody,
  finishBody,
  FINISHED_PAGE_STYLE,
  finishedPage,
  formRefusedPage,
  inviteBody,
  lockedPage,
  messagePage,
  passkeyBody,
  registrationBody,
  secretsBody,
  stepPage,
  tailnetBody,
  wrongAddressPage,
  type ClaimView,
  type InviteView,
  type SetupFrame,
} from './pages.ts';
import type { SecretFromFile } from './secrets.ts';
import { removeSetupCodeFile, setupAddress } from './setup-code.ts';
import { SETUP_ROUTES, SETUP_STEPS, stepPath, type SetupStep } from './setup-routes.ts';
import { SETUP_STYLE } from './style.ts';

/** The origin an instance card names: `oyl-instance:<origin>#<fingerprint>` (#2817). */
export function cardOrigin(card: string): string {
  return card.slice('oyl-instance:'.length, card.lastIndexOf('#'));
}

/**
 * Whether `origin` is a Tailscale name, `https://<machine>.<tailnet>.ts.net`
 * (#2817): what the tailnet path's address must be (ADR 0079 D-2).
 */
export function isTailscaleName(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' && /^[^.]+\.[^.]+\.ts\.net$/.test(url.hostname.replace(/\.$/, ''))
  );
}

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

/** What the optional AI step finds Ollama through, and reads and writes the local model with (#2792). */
export interface SetupAnalysisSources {
  /** `.env`'s analysis lines, which the operator's row is read over (`analysis/settings.ts`). */
  readonly environment: AnalysisEnvironment;
  readonly resolve: Resolver;
  /** Where Ollama is looked for after the address already set: {@link OLLAMA_ADDRESSES} unless a test's. */
  readonly addresses?: readonly string[];
  /** Told the settings after a save, as the Operate area's save tells them. */
  readonly changed?: (settings: EffectiveAnalysisSettings) => void;
  /** Aborted when the instance stops: a download that is running ends. */
  readonly stopped?: AbortSignal;
}

export interface SetupOptions {
  readonly store: SqlStore;
  /** Unix milliseconds. */
  readonly now: () => number;
  /** `OYL_INSTANCE_ADMIN_LOOPBACK_PORT`: the loopback listener's port, and so its origin. */
  readonly port: number;
  /** `OYL_INSTANCE_ORIGIN`: what the emergency kit and the card are bound to. */
  readonly origin: string;
  /** `OYL_INSTANCE_REMOTE_PATH` (#2817): which way in the tailnet step checks, or `null`. */
  readonly remotePath: RemotePath | null;
  /** What the operator calls the instance, or `null`. */
  readonly name: string | null;
  /** `OYL_INSTANCE_OWNER_KEY` is set: the setup is done from the first start (ADR 0080 D-3, D-7). */
  readonly ownerKeyFromEnvironment: boolean;
  /** The owner's claim (#2782): minted, confirmed and discarded from the setup source. */
  readonly ownerClaim: OwnerClaim;
  /**
   * The instance's own keys, for the card the claim and the invite carry, and
   * — `served`, what a device fetches — whether they open at this address (#2817).
   */
  readonly instanceKeys?: Pick<InstanceKeys, 'show' | 'served'>;
  /** The secrets read from the secrets folder: what the emergency kit holds. */
  readonly kitSecrets: readonly SecretFromFile[];
  /** `OYL_INSTANCE_REGISTRATION`, which the database's mode wins over (ADR 0080 D-6). */
  readonly environmentRegistration: RegistrationMode;
  /** `OYL_INSTANCE_SECRETS_DIR`: where the setup code's file is removed from. */
  readonly secretsDirectory: string | undefined;
  /** The AI step's (#2792). */
  readonly analysis: SetupAnalysisSources;
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
  ['/setup/ai/pull', 'ai'],
  ['/setup/ai/use', 'ai'],
  ['/setup/finish/done', 'finish'],
]);

const iso = (seconds: number): string => new Date(seconds * 1000).toISOString();

/**
 * The finished page's Content-Security-Policy: the admin pages' own, with
 * `style-src` allowing exactly the stylesheet that page carries inline, by
 * its SHA-256 — `/setup/setup.css` is gone by the time it is read (D-7).
 */
async function finishedPagePolicy(): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(FINISHED_PAGE_STYLE),
  );
  const hash = btoa(String.fromCharCode(...new Uint8Array(digest)));
  return ADMIN_CONTENT_SECURITY_POLICY.replace("style-src 'self'", `style-src 'sha256-${hash}'`);
}

/**
 * A claim code this setup showed and no tablet has scanned yet, held in
 * memory only, so its step can show the SAME QR while it waits (ADR 0080
 * D-3: the database keeps only the code's hash). Shown only to the session
 * that asked for it, and only until it runs out.
 */
interface ShownClaim {
  readonly sessionSha256: string;
  readonly card: string;
  readonly code: string;
  /** Unix seconds. */
  readonly expiresAt: number;
}

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
  let shownClaim: ShownClaim | undefined;
  const { analysis } = options;
  const localServer = { resolve: analysis.resolve };
  // #2792: the instance's one download, in memory: lost at a restart, as the model it left is not.
  const modelPull = createModelPull({
    ...localServer,
    ...(analysis.stopped === undefined ? {} : { stopped: analysis.stopped }),
  });
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
    // The step after the claim (#2817: the tailnet's, before the passkey bound to the address).
    return state === undefined || state.step === 'claim' ? 'tailnet' : state.step;
  }

  /** The instance card, whole, or `null` when the keys cannot be read. */
  async function cardOf(): Promise<string | null> {
    if (options.instanceKeys === undefined) return null;
    const shown = await keysView(options.instanceKeys);
    return shown.card ?? null;
  }

  /**
   * Whether a device's `GET /v1/instance/keys` would be served now (#2817): `unreadable`
   * when this secret and origin cannot unwrap the keys held — what a changed origin leaves.
   */
  async function servedKeys(): Promise<'ready' | 'none' | 'unreadable'> {
    if (options.instanceKeys === undefined) return 'none';
    try {
      await options.instanceKeys.served();
      return 'ready';
    } catch (error) {
      return error instanceof InstanceKeysUnavailable && error.code === 'unreadable'
        ? 'unreadable'
        : 'none';
    }
  }

  /** The owner's athlete, by the claimed key, or `undefined` before that device signs in. */
  async function ownerAthlete(): Promise<string | undefined> {
    const key = await store.claimedOwnerKey();
    if (key === undefined) return undefined;
    const held = await store.findDeviceKey(key);
    return held === undefined || held.revokedAt !== null ? undefined : held.athleteId;
  }

  /** The Ollama on this machine: at the address the settings name, then where one is usually found. */
  async function ollama(): Promise<FoundOllama | undefined> {
    const set = localServerOf(await store.getAnalysisSetting(), analysis.environment.analysisEnv);
    return findOllama(
      [...(set.ok ? [set.baseUrl.href] : []), ...(analysis.addresses ?? OLLAMA_ADDRESSES)],
      localServer,
    );
  }

  /** The settings a job would run under now: the row over `.env`, as the job engine reads them. */
  async function analysisNow(): Promise<EffectiveAnalysisSettings> {
    return effectiveAnalysisSettings(await store.getAnalysisSetting(), analysis.environment);
  }

  /** The local model a write-up would run on now, or `null`: none, or the local source is off. */
  async function writeUpModel(): Promise<string | null> {
    const now = await analysisNow();
    return now.offerLocal && now.local.kind === 'on' ? now.local.model : null;
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
          shownClaim = undefined;
          return page(stepPage(frame, claimBody({ kind: 'claimed' }, csrf), { next: true }), 200);
        }
        const view = await claimView(url, session);
        return page(stepPage(frame, claimBody(view, csrf), { next: false }), 200);
      }
      case 'tailnet': {
        // #2817: the address as the RUNNING server's card names it — what every device pins —
        // read back on every load, so "Check now" after a restart shows the address it came up with.
        // The card is drawn from the public key alone, so it is no proof the keys open: what a
        // device fetches first (`GET /v1/instance/keys`) is, and a changed origin fails it.
        const [card, keys] = await Promise.all([cardOf(), servedKeys()]);
        const address = card === null ? options.origin : cardOrigin(card);
        const body = tailnetBody({
          path: options.remotePath,
          origin: address,
          tailscaleName: isTailscaleName(address),
          keys: card === null ? 'none' : keys,
        });
        return page(stepPage(frame, body, { next: true }), 200);
      }
      case 'passkey':
        return page(stepPage(frame, passkeyBody(`${origin}/admin`), { next: true }), 200);
      case 'secrets': {
        const kit =
          options.kitSecrets.length === 0
            ? 'none'
            : session.record.kitDownloadedAt === null
              ? 'offer'
              : 'taken';
        return page(stepPage(frame, secretsBody(kit, csrf), { next: true }), 200);
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
                : {
                    at: iso(newest.at),
                    secondsAgo: seconds() - newest.at,
                    outcome: newest.outcome,
                    offBox: newest.offBox,
                  },
            waiting: pending !== undefined,
            notice: url.searchParams.has('too-soon')
              ? 'too-soon'
              : url.searchParams.has('asked')
                ? 'asked'
                : null,
          },
          csrf,
        );
        return page(stepPage(frame, body, { next: true }), 200);
      }
      case 'registration': {
        // One button saves the choice and moves on: no "Next step" to leave a choice unsaved.
        const body = registrationBody({ mode: await modeNow() }, csrf);
        return page(stepPage(frame, body, { next: false }), 200);
      }
      case 'invite':
        return page(stepPage(frame, inviteBody(await inviteView(), csrf), { next: true }), 200);
      case 'ai': {
        const [found, model] = await Promise.all([ollama(), writeUpModel()]);
        const body = aiBody(
          {
            model,
            server: found === undefined ? null : { models: found.read.models },
            pull: modelPull.state(),
            notice: url.searchParams.has('bad-name')
              ? 'bad-name'
              : url.searchParams.has('refused')
                ? 'refused'
                : null,
          },
          csrf,
        );
        // Optional: "Next step" is there whatever this page found.
        return page(stepPage(frame, body, { next: true }), 200);
      }
      case 'finish':
        return page(stepPage(frame, finishBody(await summaryOf(), csrf), { next: false }), 200);
    }
  }

  /**
   * The claim step with no owner: a claim to compare, the code still waiting
   * for a scan, or the start — which says so when the code it showed ran out.
   */
  async function claimView(url: URL, session: Session): Promise<ClaimView> {
    const pending = await options.ownerClaim.pending();
    if (pending !== undefined) {
      shownClaim = undefined;
      return { kind: 'pending', comparisonCode: pending.comparisonCode };
    }
    const at = seconds();
    const shown = shownClaim;
    const ours = shown !== undefined && shown.sessionSha256 === session.record.tokenSha256;
    // A code past its ten minutes is dead on the server: dropped where it is found, so memory
    // holds only a live one, and the session that was shown it is told why the QR went (#2825).
    const ranOut = shown !== undefined && shown.expiresAt <= at;
    if (ranOut) shownClaim = undefined;
    if (shown !== undefined && ours && !ranOut) {
      return {
        kind: 'code',
        card: shown.card,
        code: shown.code,
        expiresAt: iso(shown.expiresAt),
        secondsLeft: shown.expiresAt - at,
      };
    }
    return {
      kind: 'open',
      card: (await cardOf()) !== null,
      notConfirmed: url.searchParams.has('unconfirmed'),
      expired: ours && ranOut,
    };
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
   * Whether this setup did `action`: a `done` entry from the `setup` source
   * since the setup last began — across the sessions and restarts a resumed
   * setup took — stopping at the newest `owner_claim_reset`, which reopened
   * the setup and began a new one.
   */
  async function setupDid(action: OperatorAction): Promise<boolean> {
    for (const entry of await store.listOperatorLogPage(undefined, 200)) {
      if (entry.action === 'owner_claim_reset') return false;
      if (entry.source === 'setup' && entry.outcome === 'done' && entry.action === action) {
        return true;
      }
    }
    return false;
  }

  /** Where the server stands at the finish (D-7's summary), each read from where it is kept. */
  async function summaryOf(): Promise<SetupSummary> {
    const [owner, records, state, mode, model] = await Promise.all([
      store.claimedOwnerKey(),
      store.listBackupRecords(1),
      store.setupState(),
      modeNow(),
      writeUpModel(),
    ]);
    const newest = records[0];
    return {
      ownerClaimed: owner !== undefined,
      kit:
        options.kitSecrets.length === 0
          ? 'none'
          : (await setupDid('emergency_kit_downloaded'))
            ? 'downloaded'
            : 'not-downloaded',
      backups:
        newest === undefined
          ? 'none-yet'
          : newest.outcome === 'failed'
            ? 'failed'
            : newest.offBox === 'copied'
              ? 'working'
              : 'this-computer-only',
      mode,
      invites: (state?.inviteMintedAt ?? null) === null ? 0 : 1,
      ai: model === null ? 'off' : 'on',
    };
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
        // Held for the claim step's page, which shows it — the same QR — until a tablet scans it.
        shownClaim = {
          sessionSha256: session.record.tokenSha256,
          card,
          code: minted.code,
          expiresAt: minted.expiresAt,
        };
        return seeOther('/setup/claim');
      }
      case '/setup/claim/confirm': {
        const comparison = single(form, 'comparison');
        const confirmed =
          comparison !== undefined && SIX_DIGITS.test(comparison)
            ? await options.ownerClaim.confirm(comparison, 'setup')
            : 'none';
        if (confirmed !== 'confirmed') return seeOther('/setup/claim?unconfirmed');
        // The step after the claim: the tailnet's (#2817).
        await store.setSetupStep('tailnet', at);
        // The claim step, now saying the tablet owns the server, before the next step.
        return seeOther('/setup/claim');
      }
      case '/setup/claim/discard':
        shownClaim = undefined;
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
        // Saved, and on: the step's one button does both. Reached again from a
        // later step, it goes back to where the setup is, not to the invite.
        if (now !== 'registration') return seeOther(stepPath(now));
        await store.setSetupStep('invite', at);
        return seeOther(stepPath('invite'));
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
          secondsLeft: expiresAt - at,
          inviteMode: (await modeNow()) === 'invite',
        };
        return page(stepPage(frame, inviteBody(view, frame.csrf), { next: true }), 200);
      }
      case '/setup/ai/pull': {
        const model = (single(form, 'model') ?? '').trim();
        const named = analysisModelNameProblem(model) === undefined;
        const found = named ? await ollama() : undefined;
        const refusal = !named
          ? 'bad_model'
          : found === undefined
            ? 'no_server'
            : modelPull.state().kind === 'running'
              ? 'busy'
              : null;
        // Logged before the download starts: never the model's name.
        await store.recordOperatorAction({ actor, action: 'analysis_model_pull', at }, () =>
          refusal === null
            ? { outcome: 'done', value: undefined }
            : { outcome: 'refused', detail: refusal, value: undefined },
        );
        if (refusal === null && found !== undefined) modelPull.start(found.baseUrl, model);
        return seeOther(refusal === 'bad_model' ? '/setup/ai?bad-name' : '/setup/ai');
      }
      case '/setup/ai/use': {
        const model = (single(form, 'model') ?? '').trim();
        const found = await ollama();
        // Only a model the Ollama found lists NOW — so only a name the settings accept
        // (`local-server.ts` §`nameOf`) — and not one it says cannot call tools.
        const listed = found?.read.models.find((each) => each.name === model);
        if (found === undefined || listed === undefined || listed.tools === 'not-listed') {
          return seeOther('/setup/ai?refused');
        }
        const saved = await saveAnalysisSettings(
          store,
          actor,
          { localUrl: found.baseUrl.href, localModel: model, offerLocal: true },
          { resolve: analysis.resolve, now: options.now },
        );
        if (!saved.ok) return seeOther('/setup/ai?refused');
        analysis.changed?.(await analysisNow());
        // Loaded once, so the step can say how much of it is in the graphics
        // card's memory: Ollama reports that of a loaded model only.
        await loadModel(found.baseUrl, model, localServer);
        return seeOther('/setup/ai');
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
        shownClaim = undefined;
        return page(finishedPage(options.name), 200, {
          'set-cookie': CLEARED,
          'content-security-policy': await finishedPagePolicy(),
        });
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
        return adminResponse(SETUP_STYLE, 200, { 'content-type': 'text/css; charset=utf-8' });
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
