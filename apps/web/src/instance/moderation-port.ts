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
 * ## A report about yourself — #905
 *
 * The instance refuses a moderator deciding a report about themselves, and
 * logs the attempt. With one moderator nobody else can decide it, so the
 * screen does not offer to: {@link isConflict} is the one rule, and a report it
 * is true of is shown as a conflict, open, with no control on it.
 */

import { heldInstanceSession, type InstanceStorage } from './instance-port';
import type { InstanceAnswer, InstanceSend } from './instance-transport';
import { MAXIMUM_ROOM_ROUTE_ANSWER_BYTES } from './instance-transport';
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

/** Whether this device's account moderates its instance. */
export type ModerationStanding =
  'moderator' | 'not-moderator' | 'not-connected' | 'signed-out' | 'unreachable';

export type ModerationRead =
  | { readonly kind: Exclude<ModerationStanding, 'moderator'> }
  | {
      readonly kind: 'moderator';
      /** This account's id on the instance: what {@link isConflict} compares against. */
      readonly me: string;
      readonly registrations: readonly PendingRegistration[];
      readonly reports: readonly OpenReport[];
      /**
       * `undefined` when the log could not be read — too large, a row this
       * client does not accept, or no answer — while the two queues could.
       * The log is read on its own so that it cannot take the queues with it.
       */
      readonly log: readonly ModerationLogEntry[] | undefined;
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
  /** Everything the screen lists: the approval queue, the report queue and the log. */
  read(): Promise<ModerationRead>;
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
}

export interface ModerationPortDependencies {
  readonly storage: InstanceStorage;
  /** Injected so a test needs no network. Defaults to the platform's `fetch`. */
  readonly send?: InstanceSend | undefined;
}

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

/** The production {@link ModerationPort}: `main.tsx` builds it, and nothing else in the client. */
export function createModerationPort(dependencies: ModerationPortDependencies): ModerationPort {
  const held = () => heldInstanceSession(dependencies.storage, dependencies.send);

  /** One moderators' request and its answer, or the standing that stopped it. */
  async function probe(): Promise<
    | { readonly kind: 'answer'; readonly answer: InstanceAnswer }
    | { readonly kind: Exclude<ModerationStanding, 'moderator'> }
  > {
    const connection = held();
    if (connection === undefined) return { kind: 'not-connected' };
    try {
      const answer = await connection.http.call('GET', '/v1/moderation/registrations', {
        token: connection.token,
      });
      if (answer.status === 401) return { kind: 'signed-out' };
      if (answer.status === 200) return { kind: 'answer', answer };
      return isNotAModerator(answer) ? { kind: 'not-moderator' } : { kind: 'unreachable' };
    } catch {
      return { kind: 'unreachable' };
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
    const connection = held();
    if (connection === undefined) {
      return { kind: 'refused', text: MODERATION_REFUSAL_TEXT['signed-out'] };
    }
    try {
      return outcomeOf(
        await connection.http.call('POST', path, {
          token: connection.token,
          body: { reason: accepted, ...extra },
        }),
      );
    } catch {
      return { kind: 'refused', text: MODERATION_REFUSAL_TEXT['no-answer'] };
    }
  }

  return {
    standing: async () => {
      const probed = await probe();
      return probed.kind === 'answer' ? 'moderator' : probed.kind;
    },

    read: async () => {
      const probed = await probe();
      if (probed.kind !== 'answer') return { kind: probed.kind };
      const me = readInstanceAccount(dependencies.storage)?.instanceAthleteId;
      const connection = held();
      if (me === undefined || connection === undefined) return { kind: 'not-connected' };
      try {
        const [reports, log] = await Promise.all([
          connection.http.call('GET', '/v1/moderation/reports', { token: connection.token }),
          // The log is every action the instance ever logged, in one answer:
          // the largest this module reads (`instance-transport.ts`). It is
          // read as a section of its own (#957's review): a log past that
          // bound, or with one row this client does not accept, is `undefined`
          // and the queues are still shown.
          connection.http
            .call('GET', '/v1/moderation/log', {
              token: connection.token,
              maximumAnswerBytes: MAXIMUM_ROOM_ROUTE_ANSWER_BYTES,
            })
            .catch(() => undefined),
        ]);
        if (reports.status === 401 || log?.status === 401) return { kind: 'signed-out' };
        const registrationRows = rows(probed.answer, 'registrations', registrationFrom);
        const reportRows = rows(reports, 'reports', reportFrom);
        const logRows = log === undefined ? undefined : rows(log, 'entries', logEntryFrom);
        if (registrationRows === undefined || reportRows === undefined) {
          return { kind: 'unreachable' };
        }
        return {
          kind: 'moderator',
          me,
          registrations: registrationRows,
          reports: reportRows,
          log: logRows,
        };
      } catch {
        return { kind: 'unreachable' };
      }
    },

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
  };
}
