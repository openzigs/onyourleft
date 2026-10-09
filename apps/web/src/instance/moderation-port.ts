// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Moderating an instance from the app** (#955): what the Moderation screen
 * may ask of the instance this device is signed in to, and the one production
 * implementation of it.
 *
 * #891 built the moderators' routes on `apps/instance`; until this module the
 * app had no way to call them, so on an instance whose registration is
 * `approval` a new rider stayed `pending` until somebody made the calls by
 * hand. Every request here goes through `instance-transport.ts`, the ONE
 * module this client sends instance traffic through (#777, ADR 0036 D-3 (a)),
 * over the session `instance-port.ts` keeps, and only to routes the instance
 * already has — no route was added for this screen.
 *
 * A `*-port.ts` on purpose: `scripts/check-wiring.mjs` watches every method
 * of {@link ModerationPort} (WIRE003) and every export of this file (WIRE002),
 * and `main.tsx` is the only production code that names
 * {@link createModerationPort}.
 *
 * ## Who is a moderator, and how the app finds out
 *
 * The instance names its moderator by device key (`OYL_INSTANCE_OWNER_KEY`,
 * and a deputy's if it has one — #905: the project's instance has one). There
 * is no route that says "you are a moderator", and none is needed: a
 * moderators' route answers `not_found` to anybody else — the same bytes as a
 * route that does not exist (#891, `moderation/choke-point.test.ts`). So
 * {@link ModerationPort.standing} asks one of them, `GET
 * /v1/moderation/registrations`, and reads a `200` as "moderator" and the
 * instance's own `not_found` as "not". That tells a rider nothing about
 * anybody but themselves.
 *
 * ⚠️ **The status alone is not the instance's answer** (#957's review). The
 * project's instance sits behind a Cloudflare tunnel with an IP rule, and a
 * proxy answers `404` or `403` with a page of HTML of its own. Read by status
 * alone, that told the real moderator their account was not a moderator. So a
 * `404` means "not" only with `error.code` `not_found`, and a `403` only with
 * `registration_pending` or `account_suspended` — the caller's own account,
 * refused before the route. Any other `404` or `403` is `unreachable`, which
 * says the instance did not answer and nothing about any account.
 *
 * ## Nobody learns whether an id exists — #891, #899
 *
 * The instance answers an action on an account nobody holds with `not_found`,
 * and one it will not apply — a moderator named, a suspension already in
 * place — with `moderation_not_applicable`. This module turns BOTH into ONE
 * outcome with ONE sentence, {@link NOTHING_CHANGED_TEXT}, so the screen
 * cannot tell a moderator which of the two it was, and a typed id that exists
 * reads exactly like one that does not.
 *
 * ## Two lists a page at a time — #961
 *
 * The log and the suspended accounts are read a page at a time
 * ({@link MODERATION_LOG_PAGE}, {@link SUSPENDED_PAGE}), newest first, each
 * with the instance's opaque `next` cursor, which {@link ModerationPort.moreLog}
 * and {@link ModerationPort.moreSuspended} hand back unread. Until #961 the log
 * was one answer of every action ever logged, read under the 2 MiB a room's
 * route may take; a page is read under the ordinary 256 KiB.
 *
 * ## A report about yourself — #905
 *
 * The instance refuses a moderator deciding a report about themselves, and
 * logs the attempt. With one moderator nobody else can decide it, so the
 * screen does not offer to: {@link isConflict} is the one rule, and a report it
 * is true of is shown as a conflict, open, with no control on it.
 */

import {
  heldInstanceSession,
  heldSealedSession,
  type HeldSealedSession,
  type SealingDependencies,
} from './instance-port';
import type { InstanceAnswer } from './instance-transport';
import { cardFromPin, codeWithCard, INSTANCE_KEY_TEXT, sealedRouteGate } from './instance-pin';
import { readInstanceAccount } from './sign-in';

/** An athlete id as the instance mints and accepts one (`moderation.ts` §`ATHLETE_ID`). */
const ATHLETE_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** The longest reason the instance keeps (`moderation.ts` §`MAXIMUM_REASON_LENGTH`). */
export const MAXIMUM_MODERATION_REASON = 1000;

/** The longest display name this screen will show — `@onyourleft/domain`'s bound, with room. */
const MAXIMUM_SHOWN_NAME = 64;

/** One account awaiting a moderator's decision (#775). */
export interface PendingRegistration {
  readonly athleteId: string;
  readonly displayName: string;
  /** Unix seconds. */
  readonly createdAt: number;
  readonly adultConfirmed: boolean;
}

/** One report in the moderators' queue. */
export interface OpenReport {
  readonly reportId: number;
  readonly reporterAthleteId: string;
  readonly targetAthleteId: string;
  readonly reason: string;
  /** Unix seconds. */
  readonly createdAt: number;
}

/** One line of the moderation log — read-only, oldest first as the instance keeps it. */
export interface ModerationLogEntry {
  readonly logId: number;
  readonly action: string;
  readonly actorAthleteId: string;
  readonly targetAthleteId: string | null;
  readonly reportId: number | null;
  readonly reason: string;
  /** Unix seconds. */
  readonly at: number;
}

/** One suspended account (#961). */
export interface SuspendedAccount {
  readonly athleteId: string;
  readonly displayName: string;
  /** Unix seconds. */
  readonly suspendedAt: number;
}

/** One page of a moderators' list, and the instance's cursor for the next — `null` at the end. */
export interface ModerationList<T> {
  readonly items: readonly T[];
  readonly next: string | null;
}

/**
 * How many log entries one page asks for. 25 of the longest the instance keeps
 * — a 1000-character reason, every character escaped — is well under the
 * transport's 256 KiB.
 */
export const MODERATION_LOG_PAGE = 25;

/** How many suspended accounts one page asks for. */
export const SUSPENDED_PAGE = 50;

/** Whether this device's account moderates its instance. */
export type ModerationStanding =
  'moderator' | 'not-moderator' | 'not-connected' | 'signed-out' | 'unreachable';

export type ModerationRead =
  | { readonly kind: Exclude<ModerationStanding, 'moderator'> }
  /**
   * A moderator, on a device that cannot seal now (#1192, ADR 0047 D-7, D-11):
   * a copy of the app loaded from a website, no card, or keys refused. Every
   * moderator route is sealed-only, so nothing is read; `text` says why.
   */
  | { readonly kind: 'sealed-unavailable'; readonly text: string }
  | {
      readonly kind: 'moderator';
      /** This account's id on the instance: what {@link isConflict} compares against. */
      readonly me: string;
      readonly registrations: readonly PendingRegistration[];
      readonly reports: readonly OpenReport[];
      /**
       * The first page of the suspended accounts (#961), or `undefined` when
       * it could not be read while the queues could — read on its own, as the
       * log is.
       */
      readonly suspended: ModerationList<SuspendedAccount> | undefined;
      /**
       * The log's first page, NEWEST first (#961). `undefined` when it could
       * not be read — too large, a row this client does not accept, or no
       * answer — while the two queues could. The log is read on its own so
       * that it cannot take the queues with it.
       */
      readonly log: ModerationList<ModerationLogEntry> | undefined;
    };

/** What a moderator may do to an account, by the instance's own names. */
export type AccountAction = 'suspend' | 'unsuspend' | 'hide_display_name';

/** A decision on an account awaiting approval. */
export type RegistrationDecision = 'approve' | 'refuse';

export type ModerationOutcome =
  { readonly kind: 'done' } | { readonly kind: 'refused'; readonly text: string };

/**
 * What the screen is told when an action changed nothing — ONE sentence for
 * "there is no such account or report" and "that one cannot be acted on".
 * ⚠️ Keeping the two apart would tell a moderator whether an id exists.
 */
export const NOTHING_CHANGED_TEXT =
  'Nothing changed. The instance does not say why: there may be no such account or report, or ' +
  'it may be one no moderator can act on, or it may already be as you asked.';

export const MODERATION_REFUSAL_TEXT = {
  reason: `Give a reason of 1 to ${String(MAXIMUM_MODERATION_REASON)} characters. It is written to the moderation log.`,
  'athlete-id': 'That is not an account id. An account id is letters, digits, “-” and “_”.',
  'signed-out':
    'The instance no longer accepts this device’s sign-in. Connect again from the instance screen.',
  'no-answer': 'The instance did not answer, so nothing was changed.',
  'too-many': 'The instance is refusing requests for a while. Try again in a few minutes.',
} as const;

/** What the Moderation screen may ask. */
export interface ModerationPort {
  /** Whether this device's account moderates its instance — one request, or none. */
  standing(): Promise<ModerationStanding>;
  /**
   * Everything the screen lists: the approval queue, the report queue, and
   * the first page of the suspended accounts and of the log.
   */
  read(): Promise<ModerationRead>;
  /** The log's next page, after `cursor` — `undefined` when it could not be read (#961). */
  moreLog(cursor: string): Promise<ModerationList<ModerationLogEntry> | undefined>;
  /** The suspended accounts' next page, after `cursor` — `undefined` likewise (#961). */
  moreSuspended(cursor: string): Promise<ModerationList<SuspendedAccount> | undefined>;
  /** Approve or refuse an account awaiting approval. */
  decideRegistration(
    athleteId: string,
    decision: RegistrationDecision,
    reason: string,
  ): Promise<ModerationOutcome>;
  /** Dismiss a report. */
  dismissReport(reportId: number, reason: string): Promise<ModerationOutcome>;
  /**
   * Suspend an account, lift a suspension or hide a display name — for a
   * report when `reportId` is given, which the instance then closes.
   */
  actOnAccount(
    athleteId: string,
    action: AccountAction,
    reason: string,
    reportId?: number,
  ): Promise<ModerationOutcome>;
  /**
   * Make an invitation for a new rider (#1190, ADR 0047 D-6 source 3), with
   * THIS device's card beside the code. The card is composed from this
   * device's own pin, never taken from the instance's answer; with no pin there
   * is no invitation (D-14 Q1).
   */
  mintInvite(reason: string): Promise<InviteOutcome>;
}

/** An invitation as the share sheet shows it (#1190). */
export type InviteOutcome =
  | {
      readonly kind: 'minted';
      /** The card and the code as one line: what the QR code carries and the rider is sent. */
      readonly invite: string;
      /** The card, composed from this device's own pin. */
      readonly card: string;
      readonly inviteCode: string;
      /** Unix seconds. */
      readonly expiresAt: number;
    }
  | { readonly kind: 'refused'; readonly text: string };

/**
 * Said on the share sheet, where an invitation leaves this device (ADR 0047
 * D-6): an invitation's card is only as trustworthy as the channel it travels
 * through. ⚠️ **Placeholder draft**: #1194 owns this sentence's wording.
 */
export const INVITE_CARD_CAUTION =
  'This invitation carries the instance’s card. Whoever carries the invitation to the new rider ' +
  'could change the card on the way, so send it by a channel you trust, or show it to them in ' +
  'person.';

/**
 * Every moderator route is sealed and signed by the moderator's device key
 * (#1192, ADR 0047 D-7, D-8), so the port needs what a sealed call needs.
 */
export type ModerationPortDependencies = SealingDependencies;

/**
 * THE rule for #905: a report whose subject is the moderator reading it is a
 * conflict, which that moderator may not decide. The instance refuses it
 * anyway; the screen does not offer the control.
 */
export function isConflict(report: OpenReport, me: string): boolean {
  return report.targetAthleteId === me;
}

const UNSHOWABLE = /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\u2028\u2029]/u;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

const isId = (value: unknown): value is string =>
  typeof value === 'string' && ATHLETE_ID.test(value);
const isTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;

/** Text a rider typed somewhere, as a screen may be handed it — or `undefined`. */
function text(value: unknown, maximum: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return [...trimmed].length > maximum ? undefined : trimmed;
}

function registrationFrom(value: unknown): PendingRegistration | undefined {
  const row = record(value);
  const name = text(row?.displayName, MAXIMUM_SHOWN_NAME);
  if (
    row === undefined ||
    !isId(row.athleteId) ||
    name === undefined ||
    UNSHOWABLE.test(name) ||
    !isTime(row.createdAt) ||
    typeof row.adultConfirmed !== 'boolean'
  ) {
    return undefined;
  }
  return {
    athleteId: row.athleteId,
    displayName: name,
    createdAt: row.createdAt,
    adultConfirmed: row.adultConfirmed,
  };
}

function reportFrom(value: unknown): OpenReport | undefined {
  const row = record(value);
  const reason = text(row?.reason, MAXIMUM_MODERATION_REASON);
  if (
    row === undefined ||
    !isCount(row.reportId) ||
    !isId(row.reporterAthleteId) ||
    !isId(row.targetAthleteId) ||
    reason === undefined ||
    !isTime(row.createdAt)
  ) {
    return undefined;
  }
  return {
    reportId: row.reportId,
    reporterAthleteId: row.reporterAthleteId,
    targetAthleteId: row.targetAthleteId,
    reason,
    createdAt: row.createdAt,
  };
}

function logEntryFrom(value: unknown): ModerationLogEntry | undefined {
  const row = record(value);
  const reason = text(row?.reason, MAXIMUM_MODERATION_REASON);
  if (
    row === undefined ||
    !isCount(row.logId) ||
    typeof row.action !== 'string' ||
    !/^[a-z_]{1,64}$/.test(row.action) ||
    !isId(row.actorAthleteId) ||
    !(row.targetAthleteId === null || isId(row.targetAthleteId)) ||
    !(row.reportId === null || isCount(row.reportId)) ||
    reason === undefined ||
    !isTime(row.at)
  ) {
    return undefined;
  }
  return {
    logId: row.logId,
    action: row.action,
    actorAthleteId: row.actorAthleteId,
    targetAthleteId: row.targetAthleteId,
    reportId: row.reportId,
    reason,
    at: row.at,
  };
}

function suspendedFrom(value: unknown): SuspendedAccount | undefined {
  const row = record(value);
  const name = text(row?.displayName, MAXIMUM_SHOWN_NAME);
  if (
    row === undefined ||
    !isId(row.athleteId) ||
    name === undefined ||
    UNSHOWABLE.test(name) ||
    !isTime(row.suspendedAt)
  ) {
    return undefined;
  }
  return { athleteId: row.athleteId, displayName: name, suspendedAt: row.suspendedAt };
}

/** A cursor as `pagination.ts` writes one: base64url, and short. */
const CURSOR = /^[A-Za-z0-9_-]{1,1024}$/;

/** Every row of `field` in an answer, or `undefined` when any row is not one. */
function rows<T>(
  answer: InstanceAnswer,
  field: string,
  each: (value: unknown) => T | undefined,
): readonly T[] | undefined {
  const list = record(answer.body)?.[field];
  if (answer.status !== 200 || !Array.isArray(list)) return undefined;
  const read = list.map(each);
  return read.some((row) => row === undefined) ? undefined : (read as T[]);
}

/** A page of `field` and its `next` cursor, or `undefined` when either is not as the instance writes them. */
function page<T>(
  answer: InstanceAnswer,
  field: string,
  each: (value: unknown) => T | undefined,
): ModerationList<T> | undefined {
  const items = rows(answer, field, each);
  const next = record(answer.body)?.next;
  if (items === undefined) return undefined;
  if (next === null) return { items, next: null };
  return typeof next === 'string' && CURSOR.test(next) ? { items, next } : undefined;
}

function errorCode(answer: InstanceAnswer): unknown {
  return record(record(answer.body)?.error)?.code;
}

/**
 * Whether the probe's answer is the INSTANCE saying this account is not a
 * moderator — its status AND its own error code, never the status alone (see
 * the module header: a proxy's bare `404` or `403` is no answer at all).
 *
 * A moderators' route answers anybody else exactly as a route that does not
 * exist: #891's choke point, `not_found`. An account still waiting for
 * approval, or suspended, is refused before the route is reached
 * (`registration_pending`, `account_suspended`: 403s about the caller's OWN
 * account) — and is not a moderator either.
 */
function isNotAModerator(answer: InstanceAnswer): boolean {
  const code = errorCode(answer);
  if (answer.status === 404) return code === 'not_found';
  if (answer.status === 403) return code === 'registration_pending' || code === 'account_suspended';
  return false;
}

/** What one action's answer means to the screen. */
function outcomeOf(answer: InstanceAnswer): ModerationOutcome {
  if (answer.status >= 200 && answer.status < 300) return { kind: 'done' };
  if (answer.status === 401) {
    return { kind: 'refused', text: MODERATION_REFUSAL_TEXT['signed-out'] };
  }
  switch (errorCode(answer)) {
    case 'validation_failed':
      return { kind: 'refused', text: MODERATION_REFUSAL_TEXT.reason };
    case 'rate_limited':
      return { kind: 'refused', text: MODERATION_REFUSAL_TEXT['too-many'] };
    // ⚠️ One outcome, one sentence — see the module header. The last two are
    // refused about the caller's OWN account, before any route was reached.
    case 'not_found':
    case 'moderation_not_applicable':
    case 'registration_pending':
    case 'account_suspended':
      return { kind: 'refused', text: NOTHING_CHANGED_TEXT };
    default:
      return { kind: 'refused', text: MODERATION_REFUSAL_TEXT['no-answer'] };
  }
}

/** A reason the instance would accept, trimmed — or `undefined`. */
function acceptedReason(reason: string): string | undefined {
  const trimmed = reason.trim();
  return trimmed === '' || [...trimmed].length > MAXIMUM_MODERATION_REASON ? undefined : trimmed;
}

/** An invite code as `apps/instance` mints them: four groups of four. */
const INVITE_CODE = /^[a-z2-9]{4}(?:-[a-z2-9]{4}){3}$/;

/** The production {@link ModerationPort}: `main.tsx` builds it, and nothing else in the client. */
export function createModerationPort(dependencies: ModerationPortDependencies): ModerationPort {
  const held = () => heldInstanceSession(dependencies.storage, dependencies.send);
  const sealedSession = heldSealedSession(dependencies);

  /** The session sealed, or the refusal the screen says instead (#1192). */
  async function sealedOr(
    refusal: (closed: Extract<HeldSealedSession, { kind: 'closed' }>) => {
      readonly kind: 'refused';
      readonly text: string;
    },
  ): Promise<
    | Extract<HeldSealedSession, { kind: 'open' }>
    | { readonly kind: 'refused'; readonly text: string }
  > {
    const session = await sealedSession();
    return session.kind === 'open' ? session : refusal(session);
  }

  const closedRefusal = (closed: Extract<HeldSealedSession, { kind: 'closed' }>) =>
    ({
      kind: 'refused',
      text: closed.why === 'signed-out' ? MODERATION_REFUSAL_TEXT['signed-out'] : closed.text,
    }) as const;

  /**
   * Whether this account moderates its instance, from `GET /v1/auth/account`
   * (#775's `moderatorRole`) — a phase-2 route, so it is read in plaintext
   * and a moderator on a device that cannot seal is still told why the
   * screen is empty (#1192).
   */
  async function standingOf(): Promise<ModerationStanding> {
    const connection = held();
    if (connection === undefined) return 'not-connected';
    try {
      const answer = await connection.http.call('GET', '/v1/auth/account', {
        token: connection.token,
      });
      if (answer.status === 401) return 'signed-out';
      if (answer.status === 200) {
        const role = record(answer.body)?.moderatorRole;
        return typeof role === 'string' && role !== '' ? 'moderator' : 'not-moderator';
      }
      return isNotAModerator(answer) ? 'not-moderator' : 'unreachable';
    } catch {
      return 'unreachable';
    }
  }

  /** Send one action, having refused a bad reason or id before anything is sent. */
  async function send(
    path: string,
    reason: string,
    extra: Readonly<Record<string, unknown>> = {},
  ): Promise<ModerationOutcome> {
    const accepted = acceptedReason(reason);
    if (accepted === undefined) return { kind: 'refused', text: MODERATION_REFUSAL_TEXT.reason };
    try {
      // Sealed-only (#1192): every moderator action is signed by this device.
      const session = await sealedOr(closedRefusal);
      if (!('sealed' in session)) return session;
      return outcomeOf(
        await session.sealed.call('POST', path, {
          token: session.token,
          body: { reason: accepted, ...extra },
        }),
      );
    } catch {
      return { kind: 'refused', text: MODERATION_REFUSAL_TEXT['no-answer'] };
    }
  }

  /** One page of a moderators' list: `undefined` on any answer but a page, signed-out included. */
  async function readPage<T>(
    path: string,
    limit: number,
    cursor: string | undefined,
    field: string,
    each: (value: unknown) => T | undefined,
  ): Promise<ModerationList<T> | undefined> {
    if (cursor !== undefined && !CURSOR.test(cursor)) return undefined;
    try {
      const session = await sealedSession();
      if (session.kind === 'closed') return undefined;
      return page(
        await session.sealed.call('GET', path, {
          token: session.token,
          query: { limit: String(limit), ...(cursor === undefined ? {} : { cursor }) },
        }),
        field,
        each,
      );
    } catch {
      return undefined;
    }
  }

  const logPage = (cursor?: string) =>
    readPage('/v1/moderation/log', MODERATION_LOG_PAGE, cursor, 'entries', logEntryFrom);
  const suspendedPage = (cursor?: string) =>
    readPage('/v1/moderation/suspended', SUSPENDED_PAGE, cursor, 'items', suspendedFrom);

  return {
    standing: async () => standingOf(),

    read: async () => {
      const standing = await standingOf();
      if (standing !== 'moderator') return { kind: standing };
      const me = readInstanceAccount(dependencies.storage)?.instanceAthleteId;
      if (me === undefined) return { kind: 'not-connected' };
      try {
        // Every moderator read is sealed-only (#1192, ADR 0047 D-7).
        const session = await sealedSession();
        if (session.kind === 'closed') {
          return session.why === 'signed-out'
            ? { kind: 'signed-out' }
            : { kind: 'sealed-unavailable', text: session.text };
        }
        // The log and the suspended accounts are each read as a section of
        // their own (#957's review): one that cannot be read, or holds a row
        // this client does not accept, is `undefined`, and the queues are
        // still shown.
        const [registrations, reports, suspended, log] = await Promise.all([
          session.sealed.call('GET', '/v1/moderation/registrations', { token: session.token }),
          session.sealed.call('GET', '/v1/moderation/reports', { token: session.token }),
          suspendedPage(),
          logPage(),
        ]);
        if (registrations.status === 401 || reports.status === 401) return { kind: 'signed-out' };
        if (registrations.status !== 200 && isNotAModerator(registrations)) {
          return { kind: 'not-moderator' };
        }
        const registrationRows = rows(registrations, 'registrations', registrationFrom);
        const reportRows = rows(reports, 'reports', reportFrom);
        if (registrationRows === undefined || reportRows === undefined) {
          return { kind: 'unreachable' };
        }
        return {
          kind: 'moderator',
          me,
          registrations: registrationRows,
          reports: reportRows,
          suspended,
          log,
        };
      } catch {
        return { kind: 'unreachable' };
      }
    },

    moreLog: async (cursor) => logPage(cursor),
    moreSuspended: async (cursor) => suspendedPage(cursor),

    decideRegistration: async (athleteId, decision, reason) => {
      const typed = athleteId.trim();
      if (!ATHLETE_ID.test(typed)) {
        return { kind: 'refused', text: MODERATION_REFUSAL_TEXT['athlete-id'] };
      }
      return send(`/v1/moderation/registrations/${typed}/${decision}`, reason);
    },

    dismissReport: async (reportId, reason) => {
      if (!Number.isSafeInteger(reportId) || reportId < 1) {
        return { kind: 'refused', text: NOTHING_CHANGED_TEXT };
      }
      return send(`/v1/moderation/reports/${String(reportId)}/dismiss`, reason);
    },

    actOnAccount: async (athleteId, action, reason, reportId) => {
      const typed = athleteId.trim();
      if (!ATHLETE_ID.test(typed)) {
        return { kind: 'refused', text: MODERATION_REFUSAL_TEXT['athlete-id'] };
      }
      const path = {
        suspend: 'suspend',
        unsuspend: 'unsuspend',
        hide_display_name: 'hide-display-name',
      }[action];
      return send(
        `/v1/moderation/athletes/${typed}/${path}`,
        reason,
        reportId === undefined ? {} : { reportId },
      );
    },

    mintInvite: async (reason) => {
      // ⚠️ The card is composed HERE, from this device's own pin (D-6
      // source 3): never from anything the instance answers below.
      const account = readInstanceAccount(dependencies.storage);
      const gate = sealedRouteGate(account, dependencies.loadedFrom);
      const card = cardFromPin(account);
      if (gate.kind !== 'open' || card === undefined) {
        return {
          kind: 'refused',
          text: gate.kind === 'open' ? INSTANCE_KEY_TEXT['needs-card'] : gate.text,
        };
      }
      const accepted = acceptedReason(reason);
      if (accepted === undefined) return { kind: 'refused', text: MODERATION_REFUSAL_TEXT.reason };
      try {
        // Sealed-only (#1192): the code is in the reply, as ciphertext.
        const session = await sealedOr(closedRefusal);
        if (!('sealed' in session)) return session;
        const answer = await session.sealed.call('POST', '/v1/moderation/invites', {
          token: session.token,
          body: { reason: accepted },
        });
        const refused = outcomeOf(answer);
        if (refused.kind === 'refused') return refused;
        const body = record(answer.body);
        const inviteCode =
          typeof body?.inviteCode === 'string' ? body.inviteCode.toLowerCase() : '';
        if (!INVITE_CODE.test(inviteCode) || !isTime(body?.expiresAt)) {
          return { kind: 'refused', text: MODERATION_REFUSAL_TEXT['no-answer'] };
        }
        return {
          kind: 'minted',
          invite: codeWithCard(card, inviteCode),
          card,
          inviteCode,
          expiresAt: body.expiresAt,
        };
      } catch {
        return { kind: 'refused', text: MODERATION_REFUSAL_TEXT['no-answer'] };
      }
    },
  };
}
