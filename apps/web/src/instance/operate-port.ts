// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Operate** (#2603, epic #2601): what the owner-only Operate area may ask of
 * the instance this device is signed in to, and the one production
 * implementation of it.
 *
 * Every request here goes through `instance-transport.ts`, the ONE module this
 * client sends instance traffic through (#777, ADR 0036 D-3 (a)), SEALED over
 * the session `instance-port.ts` keeps (ADR 0047 D-7): every Operate route on
 * the instance is `sealed: 'only'` (#2602), so a device that cannot seal asks
 * nothing and is told why. No new network module was added for this area.
 *
 * A `*-port.ts` on purpose: `scripts/check-wiring.mjs` watches every method of
 * {@link OperatePort} (WIRE003) and every export of this file (WIRE002), and
 * `main.tsx` is the only production code that names {@link createOperatePort}.
 *
 * ## Who is the owner, and how the app finds out
 *
 * The instance names its owner by device key (`OYL_INSTANCE_OWNER_KEY`), and
 * its session read, `GET /v1/auth/account`, says `moderatorRole: 'owner'` to
 * that athlete alone (#775). The deputy is a moderator and NOT the operator
 * (ADR 0046 D-9 Q9, the owner's ruling of 2026-11-14 on #2601), so
 * {@link OperatePort.standing} is `owner` for `'owner'` and nothing else.
 * That is only what the app DRAWS: the instance checks every Operate route
 * itself and answers anybody else `not_found`, as though it were not there.
 *
 * ⚠️ As for Moderation (#957's review), a status alone is not the instance's
 * answer: a proxy's own `404` or `403` is `unreachable`, never "not the owner".
 *
 * ## Nothing secret, nothing that could be a place
 *
 * The log's `detail` is checked here against the instance's own closed grammar
 * (`apps/instance` §`OPERATOR_DETAIL`: words, each optionally `=` a whole
 * number) before it can reach the screen, so a row carrying free text — a key,
 * a token, a coordinate — is not shown at all: the page reads as unreadable.
 * A backup record (#2606) is held the same way: its error is a name or Node's
 * code, its snapshot a `snapshot-<time>` directory NAME, every other field a
 * count or a closed word. The one sentence of the instance's that reaches the
 * screen, a refused "back up now", is held to plain prose with no decimal and
 * no long unbroken word ({@link SENTENCE}), or replaced with the app's own.
 *
 * ## Restore is not here
 *
 * The port can read the backups and ask for one. It has no restore, because
 * the instance has none to call: restore is destructive, stops the instance,
 * and stays on the operator's CLI (#2607). The Operate area shows its steps.
 */

import {
  heldSealedSession,
  type HeldSealedSession,
  type SealingDependencies,
} from './instance-port';
import type { InstanceAnswer } from './instance-transport';

/**
 * Whether this device's account is its instance's owner (#2603).
 *
 * - `owner`: the instance says `moderatorRole: 'owner'` over a sealed session.
 * - `not-owner`: any other account the instance answered for, the deputy
 *   included, or one refused before any route (pending, suspended).
 * - `signed-out`: no sign-in on this device, or the instance refused it.
 * - `unreachable`: nothing that was the instance's own answer came back.
 * - `no-keys`: this device cannot seal now — no instance card, a copy of the
 *   app loaded from a website (ADR 0047 D-11), keys refused — or the instance
 *   holds no keys and so offers no Operate area at all (#2602).
 */
export type OperateStanding = 'owner' | 'not-owner' | 'signed-out' | 'unreachable' | 'no-keys';

/** One entry of the operator log, as the instance pages it (#2602). */
export interface OperatorLogEntry {
  readonly id: number;
  /** When, as ISO 8601 in UTC. */
  readonly at: string;
  /** Taken in the app's Operate area, or with the operator's CLI on the host. */
  readonly source: 'app' | 'cli';
  /** The instance's own name for the action — `backup`, `room_open`, … */
  readonly action: string;
  /** Closed words, each optionally `=` a whole number — or `null`. */
  readonly detail: string | null;
  readonly outcome: 'done' | 'refused' | 'failed';
}

/** One page of the operator log, NEWEST first, and the cursor for the next — `null` at the end. */
export interface OperatorLogPage {
  readonly kind: 'page';
  readonly entries: readonly OperatorLogEntry[];
  readonly next: string | null;
}

/** A page of the log, or why there is none: a standing other than `owner`. */
export type OperatorLogRead =
  OperatorLogPage | { readonly kind: Exclude<OperateStanding, 'owner'> };

/** How many entries one page asks for: a short page, well under the transport's 256 KiB. */
export const OPERATOR_LOG_PAGE = 25;

/** One disk the instance's data is on (#2604). */
export interface OperateDisk {
  readonly holds: 'database' | 'blobs' | 'database_and_blobs';
  readonly freeBytes: number;
  readonly totalBytes: number;
  /** Under a tenth free, as the instance judged it. */
  readonly low: boolean;
}

/** The newest backup's record (#2606): `null` until one is recorded. */
export interface OperateLastBackup {
  /** ISO 8601, UTC. */
  readonly at: string;
  readonly offBox: 'copied' | 'failed' | 'not-configured';
  /** The backup service's interval, in seconds. */
  readonly intervalSeconds: number;
}

/** The instance keys' state, by the instance's own name for it. */
export type OperateKeysState =
  'ready' | 'no-secret' | 'no-origin' | 'no-keys' | 'unreadable' | 'busy';

/** What `GET /v1/operate/status` says (#2604): counts and names, nothing secret. */
export interface OperateStatus {
  readonly kind: 'status';
  /** Whether `GET /ready` would say ready, and each of its checks. */
  readonly ready: boolean;
  readonly checks: {
    readonly database: boolean;
    readonly migrations: 'at-head' | 'migrating' | 'behind' | 'ahead' | 'unknown';
    readonly rooms: boolean;
  };
  readonly version: string;
  /** The deployed commit, 40 lower-case hex, or `null` when the operator named none. */
  readonly commit: string | null;
  /** The instance runs this repository's own source, so its commit may be compared with `main`. */
  readonly upstream: boolean;
  readonly registration: 'open' | 'approval' | 'invite' | 'closed';
  readonly uptimeSeconds: number;
  readonly disk: readonly OperateDisk[];
  readonly lastBackup: OperateLastBackup | null;
  readonly tunnel:
    | { readonly state: 'unknown' | 'not_ready' }
    | { readonly state: 'ready'; readonly connections: number };
  readonly counts: {
    readonly athletes: {
      readonly active: number;
      readonly pending: number;
      readonly suspended: number;
    };
    readonly roomsOpen: number;
    readonly analysis: { readonly queued: number; readonly running: number };
  };
  readonly keys: OperateKeysState;
}

/** The instance's status, or why there is none: a standing other than `owner`. */
export type OperateStatusRead =
  OperateStatus | { readonly kind: Exclude<OperateStanding, 'owner'> };

/** One backup run's record (#2606), as `GET /v1/operate/backups` writes it. */
export type OperateBackup =
  | {
      readonly outcome: 'done';
      readonly id: number;
      /** When the run started, ISO 8601, UTC. */
      readonly at: string;
      /** Whole seconds since then, by the instance's clock. */
      readonly ageSeconds: number;
      /** The snapshot directory's NAME, `snapshot-<time>`: never the folder it is in. */
      readonly snapshot: string;
      readonly rows: number;
      readonly blobs: number;
      readonly sizeBytes: number;
      readonly offBox: 'copied' | 'failed' | 'not-configured';
      /** The backup service's interval, or `null` for a one-off such as the pre-deploy snapshot. */
      readonly intervalSeconds: number | null;
      /** Made because the owner asked for it. */
      readonly requested: boolean;
    }
  | {
      readonly outcome: 'failed';
      readonly id: number;
      readonly at: string;
      readonly ageSeconds: number;
      /** The error's name or Node's code (`ENOSPC`), never its message. */
      readonly error: string;
      readonly intervalSeconds: number | null;
      readonly requested: boolean;
    };

/** The backups, NEWEST first, and the "back up now" still waiting, if any. */
export interface OperateBackups {
  readonly kind: 'backups';
  readonly records: readonly OperateBackup[];
  /** When the waiting "back up now" was asked, ISO 8601 — or `null`. */
  readonly pendingSince: string | null;
}

/** The backups, or why there are none: a standing other than `owner`. */
export type OperateBackupsRead =
  OperateBackups | { readonly kind: Exclude<OperateStanding, 'owner'> };

/** What "back up now" did (#2606). */
export type OperateBackUpNow =
  | { readonly kind: 'requested'; readonly requestedAt: string }
  /** `too_many`: one already waits, or one was made in the last 15 minutes. The instance's sentence. */
  | { readonly kind: 'refused'; readonly sentence: string }
  | { readonly kind: Exclude<OperateStanding, 'owner'> };

/** What the Operate area may ask. */
export interface OperatePort {
  /** The instance's status, read-only (#2604): one sealed request. */
  status(): Promise<OperateStatusRead>;
  /** Whether this device's account is the instance's owner — one sealed request, or none. */
  standing(): Promise<OperateStanding>;
  /** One page of the operator log, newest first: the first, or the one after `cursor`. */
  log(cursor?: string): Promise<OperatorLogRead>;
  /** The backups the `backup` service recorded, newest first (#2606): read-only. */
  backups(): Promise<OperateBackupsRead>;
  /** Ask the `backup` service for a snapshot now (#2606): it takes it within 30 seconds. */
  backUpNow(): Promise<OperateBackUpNow>;
}

/** Every Operate route is sealed and signed by the owner's device key, so the port needs what a sealed call needs. */
export type OperatePortDependencies = SealingDependencies;

/** A cursor as the instance's `pagination.ts` writes one: base64url, and short. */
const CURSOR = /^[A-Za-z0-9_-]{1,1024}$/;

/** An action's name as the instance writes it: a newer instance may add one this build does not know. */
const ACTION = /^[a-z][a-z0-9_]{0,63}$/;

/** `apps/instance` §`OPERATOR_DETAIL`, the same grammar: no space, no sign, no decimal point. */
const DETAIL = /^[a-z][a-z0-9_]{0,31}(=[0-9]{1,9})?(,[a-z][a-z0-9_]{0,31}(=[0-9]{1,9})?){0,5}$/;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function errorCode(answer: InstanceAnswer): unknown {
  return record(record(answer.body)?.error)?.code;
}

/** `value` as an ISO 8601 moment in UTC, as `Date` writes one — or `undefined`. */
function isoMoment(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 32) return undefined;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return undefined;
  const written = new Date(ms).toISOString();
  return written === value ? written : undefined;
}

function entryFrom(value: unknown): OperatorLogEntry | undefined {
  const row = record(value);
  const at = isoMoment(row?.at);
  if (
    row === undefined ||
    typeof row.id !== 'number' ||
    !Number.isSafeInteger(row.id) ||
    row.id < 1 ||
    at === undefined ||
    (row.source !== 'app' && row.source !== 'cli') ||
    typeof row.action !== 'string' ||
    !ACTION.test(row.action) ||
    !(row.detail === null || (typeof row.detail === 'string' && DETAIL.test(row.detail))) ||
    (row.outcome !== 'done' && row.outcome !== 'refused' && row.outcome !== 'failed')
  ) {
    return undefined;
  }
  return {
    id: row.id,
    at,
    source: row.source,
    action: row.action,
    detail: row.detail,
    outcome: row.outcome,
  };
}

/** A page as the instance writes one, or `undefined` when any part of it is not. */
function pageFrom(answer: InstanceAnswer): OperatorLogPage | undefined {
  const body = record(answer.body);
  const list = body?.entries;
  const next = body?.cursor;
  if (!Array.isArray(list)) return undefined;
  if (!(next === null || (typeof next === 'string' && CURSOR.test(next)))) return undefined;
  const entries = list.map(entryFrom);
  if (entries.some((entry) => entry === undefined)) return undefined;
  return { kind: 'page', entries: entries as OperatorLogEntry[], next };
}

/** A whole number no smaller than zero. */
function whole(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

const COMMIT = /^[0-9a-f]{40}$/;
/** A version as `package.json` writes one. */
const VERSION = /^[0-9A-Za-z.+-]{1,64}$/;

function diskFrom(value: unknown): OperateDisk | undefined {
  const row = record(value);
  if (
    row === undefined ||
    !oneOf(row.holds, ['database', 'blobs', 'database_and_blobs'] as const) ||
    !whole(row.freeBytes) ||
    !whole(row.totalBytes) ||
    typeof row.low !== 'boolean'
  ) {
    return undefined;
  }
  return { holds: row.holds, freeBytes: row.freeBytes, totalBytes: row.totalBytes, low: row.low };
}

/** `null`, a backup record, or `undefined` when it is neither. */
function lastBackupFrom(value: unknown): OperateLastBackup | null | undefined {
  if (value === null) return null;
  const row = record(value);
  const at = isoMoment(row?.at);
  if (
    row === undefined ||
    at === undefined ||
    !oneOf(row.offBox, ['copied', 'failed', 'not-configured'] as const) ||
    !whole(row.intervalSeconds)
  ) {
    return undefined;
  }
  return { at, offBox: row.offBox, intervalSeconds: row.intervalSeconds };
}

/** A run's error as the instance records it: a name or Node's code, never a message. */
const ERROR_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** A snapshot directory's name as `backup` makes one: `snapshot-` and the time, `:` and `.` as `-`. */
const SNAPSHOT = /^snapshot-[0-9A-Za-z-]{1,40}$/;

/** A whole number no smaller than zero, or `null`. */
function wholeOrNull(value: unknown): value is number | null {
  return value === null || whole(value);
}

function backupFrom(value: unknown): OperateBackup | undefined {
  const row = record(value);
  const at = isoMoment(row?.at);
  if (
    row === undefined ||
    at === undefined ||
    !whole(row.id) ||
    row.id < 1 ||
    !whole(row.ageSeconds) ||
    !wholeOrNull(row.intervalSeconds) ||
    typeof row.requested !== 'boolean'
  ) {
    return undefined;
  }
  const common = {
    id: row.id,
    at,
    ageSeconds: row.ageSeconds,
    intervalSeconds: row.intervalSeconds,
    requested: row.requested,
  };
  if (row.outcome === 'failed') {
    if (typeof row.error !== 'string' || !ERROR_NAME.test(row.error)) return undefined;
    return { outcome: 'failed', ...common, error: row.error };
  }
  if (
    row.outcome !== 'done' ||
    typeof row.snapshot !== 'string' ||
    !SNAPSHOT.test(row.snapshot) ||
    !whole(row.rows) ||
    !whole(row.blobs) ||
    !whole(row.sizeBytes) ||
    !oneOf(row.offBox, ['copied', 'failed', 'not-configured'] as const)
  ) {
    return undefined;
  }
  return {
    outcome: 'done',
    ...common,
    snapshot: row.snapshot,
    rows: row.rows,
    blobs: row.blobs,
    sizeBytes: row.sizeBytes,
    offBox: row.offBox,
  };
}

/** The backups as the instance writes them, or `undefined` when any part is not. */
function backupsFrom(answer: InstanceAnswer): OperateBackups | undefined {
  const body = record(answer.body);
  if (body === undefined || !Array.isArray(body.backups)) return undefined;
  let pendingSince: string | null = null;
  if (body.pending !== null) {
    const asked = isoMoment(record(body.pending)?.requestedAt);
    if (asked === undefined) return undefined;
    pendingSince = asked;
  }
  const records = body.backups.map(backupFrom);
  if (records.some((each) => each === undefined)) return undefined;
  return { kind: 'backups', records: records as OperateBackup[], pendingSince };
}

/**
 * A sentence of the instance's that may be shown as it is: plain prose, no
 * decimal number (a coordinate is one) and no word longer than 24 characters
 * (a key or a token is one).
 */
const SENTENCE = /^[A-Za-z0-9 .,:;’'()-]{1,300}$/;

function sentenceFrom(answer: InstanceAnswer): string | undefined {
  const message = record(record(answer.body)?.error)?.message;
  if (typeof message !== 'string' || !SENTENCE.test(message)) return undefined;
  if (/[0-9][.,][0-9]/.test(message)) return undefined;
  if (message.split(' ').some((word) => word.length > 24)) return undefined;
  return message;
}

/** Said for a refused "back up now" when the instance's own sentence may not be shown. */
const BACK_UP_REFUSED_TEXT =
  'The instance refused: a backup is already waiting, or one was made a short while ago.';

/**
 * The status as the instance writes it, or `undefined` when any part is not —
 * so nothing but closed names, numbers and the commit's hex reaches the screen.
 */
function statusFrom(answer: InstanceAnswer): OperateStatus | undefined {
  const body = record(answer.body);
  const checks = record(body?.checks);
  const tunnel = record(body?.tunnel);
  const counts = record(body?.counts);
  const athletes = record(counts?.athletes);
  const analysis = record(counts?.analysis);
  if (
    body === undefined ||
    checks === undefined ||
    tunnel === undefined ||
    counts === undefined ||
    athletes === undefined ||
    analysis === undefined ||
    !Array.isArray(body.disk)
  ) {
    return undefined;
  }
  const disk = body.disk.map(diskFrom);
  const lastBackup = lastBackupFrom(body.lastBackup);
  if (
    typeof body.ready !== 'boolean' ||
    typeof checks.database !== 'boolean' ||
    !oneOf(checks.migrations, ['at-head', 'migrating', 'behind', 'ahead', 'unknown'] as const) ||
    typeof checks.rooms !== 'boolean' ||
    typeof body.version !== 'string' ||
    !VERSION.test(body.version) ||
    !(body.commit === null || (typeof body.commit === 'string' && COMMIT.test(body.commit))) ||
    typeof body.upstream !== 'boolean' ||
    !oneOf(body.registration, ['open', 'approval', 'invite', 'closed'] as const) ||
    !whole(body.uptimeSeconds) ||
    disk.some((each) => each === undefined) ||
    lastBackup === undefined ||
    !oneOf(tunnel.state, ['unknown', 'ready', 'not_ready'] as const) ||
    !whole(athletes.active) ||
    !whole(athletes.pending) ||
    !whole(athletes.suspended) ||
    !whole(counts.roomsOpen) ||
    !whole(analysis.queued) ||
    !whole(analysis.running) ||
    !oneOf(body.keys, ['ready', 'no-secret', 'no-origin', 'no-keys', 'unreadable', 'busy'] as const)
  ) {
    return undefined;
  }
  let shownTunnel: OperateStatus['tunnel'];
  if (tunnel.state === 'ready') {
    if (!whole(tunnel.connections)) return undefined;
    shownTunnel = { state: 'ready', connections: tunnel.connections };
  } else {
    shownTunnel = { state: tunnel.state };
  }
  return {
    kind: 'status',
    ready: body.ready,
    checks: { database: checks.database, migrations: checks.migrations, rooms: checks.rooms },
    version: body.version,
    commit: body.commit,
    upstream: body.upstream,
    registration: body.registration,
    uptimeSeconds: body.uptimeSeconds,
    disk: disk as OperateDisk[],
    lastBackup,
    tunnel: shownTunnel,
    counts: {
      athletes: {
        active: athletes.active,
        pending: athletes.pending,
        suspended: athletes.suspended,
      },
      roomsOpen: counts.roomsOpen,
      analysis: { queued: analysis.queued, running: analysis.running },
    },
    keys: body.keys,
  };
}

/**
 * Whether an answer is the INSTANCE saying this account is not its owner — the
 * status AND its own code. An Operate route answers anybody but the owner as a
 * route that does not exist; an account pending approval or suspended is
 * refused about itself before any route.
 */
function isNotTheOwner(answer: InstanceAnswer): boolean {
  const code = errorCode(answer);
  if (answer.status === 404) return code === 'not_found';
  if (answer.status === 403) return code === 'registration_pending' || code === 'account_suspended';
  return false;
}

/** What a closed sealed session means here. */
function closedStanding(
  closed: Extract<HeldSealedSession, { kind: 'closed' }>,
): Exclude<OperateStanding, 'owner' | 'not-owner' | 'unreachable'> {
  return closed.why === 'signed-out' ? 'signed-out' : 'no-keys';
}

/** The production {@link OperatePort}: `main.tsx` builds it, and nothing else in the client. */
export function createOperatePort(dependencies: OperatePortDependencies): OperatePort {
  const sealedSession = heldSealedSession(dependencies);

  return {
    standing: async () => {
      try {
        const session = await sealedSession();
        if (session.kind === 'closed') return closedStanding(session);
        const answer = await session.sealed.call('GET', '/v1/auth/account', {
          token: session.token,
        });
        if (answer.status === 401) return 'signed-out';
        if (answer.status === 200) {
          return record(answer.body)?.moderatorRole === 'owner' ? 'owner' : 'not-owner';
        }
        return isNotTheOwner(answer) ? 'not-owner' : 'unreachable';
      } catch {
        return 'unreachable';
      }
    },

    status: async () => {
      try {
        const session = await sealedSession();
        if (session.kind === 'closed') return { kind: closedStanding(session) };
        const answer = await session.sealed.call('GET', '/v1/operate/status', {
          token: session.token,
        });
        if (answer.status === 401) return { kind: 'signed-out' };
        if (answer.status === 200) return statusFrom(answer) ?? { kind: 'unreachable' };
        if (isNotTheOwner(answer)) return { kind: 'not-owner' };
        // #2602: an instance with no OYL_INSTANCE_SECRET_KEY offers no Operate area.
        if (errorCode(answer) === 'unavailable') return { kind: 'no-keys' };
        return { kind: 'unreachable' };
      } catch {
        return { kind: 'unreachable' };
      }
    },

    log: async (cursor) => {
      // A cursor the instance could not have written is sent nowhere.
      if (cursor !== undefined && !CURSOR.test(cursor)) return { kind: 'unreachable' };
      try {
        const session = await sealedSession();
        if (session.kind === 'closed') return { kind: closedStanding(session) };
        const answer = await session.sealed.call('GET', '/v1/operate/log', {
          token: session.token,
          query: {
            limit: String(OPERATOR_LOG_PAGE),
            ...(cursor === undefined ? {} : { cursor }),
          },
        });
        if (answer.status === 401) return { kind: 'signed-out' };
        if (answer.status === 200) return pageFrom(answer) ?? { kind: 'unreachable' };
        if (isNotTheOwner(answer)) return { kind: 'not-owner' };
        // #2602: an instance with no OYL_INSTANCE_SECRET_KEY offers no Operate area.
        if (errorCode(answer) === 'unavailable') return { kind: 'no-keys' };
        return { kind: 'unreachable' };
      } catch {
        return { kind: 'unreachable' };
      }
    },

    backups: async () => {
      try {
        const session = await sealedSession();
        if (session.kind === 'closed') return { kind: closedStanding(session) };
        const answer = await session.sealed.call('GET', '/v1/operate/backups', {
          token: session.token,
        });
        if (answer.status === 401) return { kind: 'signed-out' };
        if (answer.status === 200) return backupsFrom(answer) ?? { kind: 'unreachable' };
        if (isNotTheOwner(answer)) return { kind: 'not-owner' };
        // #2602: an instance with no OYL_INSTANCE_SECRET_KEY offers no Operate area.
        if (errorCode(answer) === 'unavailable') return { kind: 'no-keys' };
        return { kind: 'unreachable' };
      } catch {
        return { kind: 'unreachable' };
      }
    },

    backUpNow: async () => {
      try {
        const session = await sealedSession();
        if (session.kind === 'closed') return { kind: closedStanding(session) };
        const answer = await session.sealed.call('POST', '/v1/operate/backups', {
          token: session.token,
        });
        if (answer.status === 401) return { kind: 'signed-out' };
        if (answer.status === 202) {
          const requestedAt = isoMoment(record(answer.body)?.requestedAt);
          return requestedAt === undefined
            ? { kind: 'unreachable' }
            : { kind: 'requested', requestedAt };
        }
        if (answer.status === 429 && errorCode(answer) === 'too_many') {
          return { kind: 'refused', sentence: sentenceFrom(answer) ?? BACK_UP_REFUSED_TEXT };
        }
        if (isNotTheOwner(answer)) return { kind: 'not-owner' };
        if (errorCode(answer) === 'unavailable') return { kind: 'no-keys' };
        return { kind: 'unreachable' };
      } catch {
        return { kind: 'unreachable' };
      }
    },
  };
}
