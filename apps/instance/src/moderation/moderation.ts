// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Blocking, reporting and the moderators' tools (#83), and the ONE question
 * every route that reaches another athlete asks: {@link Moderation.canSee}.
 *
 * ## The choke point
 *
 * #83: *"A block enforced in the feed but not in comments … is not a block;
 * it is a list of places the blocked athlete has not tried yet."* So no route
 * checks a block itself. A route that names another athlete DECLARES it in the
 * route table (`route-kit.ts` §`Reach`), and the handler asks `canSee` before
 * the route is called, answering `not_found` — the same bytes as an athlete
 * who does not exist — when the answer is no. `moderation/choke-point.test.ts`
 * walks the route table and holds every such route to that.
 *
 * `canSee(viewer, subject)` is true only when the subject exists, is an
 * active account (not awaiting approval, not refused, #775), is not suspended,
 * and neither athlete blocks the other. **Either** way round: a block is
 * symmetric in effect, whoever made it.
 *
 * ## What a blocked athlete is told: nothing
 *
 * A request about somebody who blocked you gets exactly what a request about
 * nobody gets. That holds for the routes that write as well: blocking,
 * unblocking and reporting answer `204` whether or not the athlete named
 * exists, so none of them can be used to find out that a block is there.
 *
 * ⚠️ **And so does everything those writes leave behind** (#891's review).
 * A block is stored for ANY well-formed id, so `GET /v1/blocks` echoes back
 * what the caller asked for and says nothing about who exists; and a report
 * about nobody is stored too — closed as it is made, so it never reaches the
 * moderators' queue — so it counts toward the reporter's hourly allowance
 * exactly as a report about a rider who blocked them does. Before that review
 * the list and the rate limit each told a rider that an athlete they could
 * not see existed. `choke-point.test.ts` holds both with ONE caller.
 *
 * ## The moderators
 *
 * The instance's operator names two DEVICE KEYS, the owner's and a deputy's
 * (ruling Q13, 2026-09-28). The athlete who holds one, unrevoked, has that
 * role. A key rather than an athlete id, so the operator can name a moderator
 * before they have registered — which approval-required registration (#775)
 * needs, or nobody could ever approve anybody. A moderator's every action goes
 * through {@link SqlStore.moderate}, which applies it and appends it to the
 * append-only log in one transaction; a moderator may not act on a moderator,
 * and may not dismiss a report about themselves. Such an attempt changes
 * nothing and IS logged, as `refused_<action>`, so the owner can see a deputy
 * who tried to act on them.
 *
 * A pending account whose key the operator names later — the owner signed in
 * before `OYL_INSTANCE_OWNER_KEY` was set — is activated at its next sign-in,
 * logged as `activate_moderator_key` (`auth/identity.ts`), because nobody
 * could approve a moderator otherwise.
 */

import type { ErrorCode, FieldProblem } from '../errors.ts';
import { encodeCursor, parsePageRequest } from '../pagination.ts';
import type {
  AthleteRecord,
  ModerationActionKind,
  ModerationLogEntry,
  Notice,
  Report,
  SqlStore,
  Statement,
  StatementFields,
  Appeal,
  NoticeStep,
} from '../store/sql-store.ts';
import { exportRecord, type ModerationRecord } from './record.ts';
import { parseModerationItem } from '@onyourleft/domain';
import { publishedOrder } from '../rooms/publication.ts';
import { readAppealGrounds, readStatementFields, RESTRICTIONS } from './statements.ts';
import { readNoticeForm, type NoticeProblem, type NoticeValues } from './notices.ts';

/** The two moderator roles (ruling Q13). */
export type ModeratorRole = 'owner' | 'deputy';

/** The device keys the operator named, lowercase hex. */
export interface Moderators {
  readonly owner?: string;
  readonly deputy?: string;
}

export interface ModerationLimits {
  /** How many reports one athlete may make in {@link reportWindowSeconds}. */
  readonly reportsPerWindow: number;
  readonly reportWindowSeconds: number;
}

export const DEFAULT_MODERATION_LIMITS: ModerationLimits = {
  reportsPerWindow: 5,
  reportWindowSeconds: 60 * 60,
};

/** The longest reason a report or a moderator action may give, in characters. */
export const MAXIMUM_REASON_LENGTH = 1000;

/**
 * How many blocks one athlete may hold. A block is stored for any well-formed
 * id, whether or not anybody holds it, so without a bound one account could
 * fill the database. Counted over the caller's own rows, so reaching it says
 * nothing about anybody else.
 */
export const MAXIMUM_BLOCKS = 1000;

/** What a report about an id nobody holds is closed as, the moment it is made. */
export const NO_SUCH_ATHLETE_OUTCOME = 'no_such_athlete';

export type ModerationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ErrorCode; readonly fields?: readonly FieldProblem[] };

/**
 * The actions a moderator takes on an athlete. A report is dismissed by its
 * own route, and `activate_moderator_key` is the instance's, not a moderator's.
 */
export type AthleteAction = Exclude<
  ModerationActionKind,
  'dismiss_report' | 'activate_moderator_key'
>;

/** One page of a moderators' list (#961), in `pagination.ts`'s wire form. */
export interface ModerationPage<T> {
  readonly items: readonly T[];
  readonly next: string | null;
}

/** What a cursor this instance did not write is refused with, by name and never by value. */
const NOT_OUR_CURSOR: readonly FieldProblem[] = [
  { field: 'cursor', problem: 'must be a cursor this instance returned' },
];

export interface Moderation {
  /** THE choke point: may `viewerId` see, or act on, `subjectId`? */
  canSee(viewerId: string, subjectId: string): Promise<boolean>;
  /** The role the athlete holds, if any. */
  roleOf(athleteId: string): Promise<ModeratorRole | undefined>;

  block(athleteId: string, target: string): Promise<ModerationResult<null>>;
  unblock(athleteId: string, target: string): Promise<void>;
  blocks(athleteId: string): Promise<readonly string[]>;
  report(athleteId: string, target: unknown, reason: unknown): Promise<ModerationResult<null>>;

  openReports(): Promise<readonly Report[]>;
  /**
   * A notice of illegal content from anybody (#907), from the notice page's
   * form and the client's address — counted against that address in memory,
   * and against the instance's cap from the store, and never stored.
   */
  submitNotice(form: URLSearchParams, address: string | null): Promise<NoticeSubmission>;
  /** Every notice received, oldest first: the moderators' queue of notices (#907). */
  notices(): Promise<readonly Notice[]>;
  /** The statements of reasons about this athlete, newest first (#910): their own, and nobody else's. */
  statements(athleteId: string): Promise<readonly Statement[]>;
  /** The appeals this athlete filed (#911). */
  appeals(athleteId: string): Promise<readonly Appeal[]>;
  /**
   * Appeal the statement `statementId` (#911): only one about the caller,
   * once. A statement that is somebody else's is `not_found`, as one that does
   * not exist is.
   */
  appeal(
    athleteId: string,
    statementId: string,
    grounds: unknown,
  ): Promise<ModerationResult<{ appealId: number }>>;
  /**
   * Hide one item (#913): a room's listing (`room:`), the route shown in a
   * room (`route:`) or one row of a race's result (`result:<room>:<row>`),
   * by the identifier a notice names it by — with a reason and a statement of
   * reasons its owner is shown, all in one transaction with the log entry.
   * A display name (`rider:`) is hidden by `hide-display-name`. An item of
   * a moderator's is refused, and the attempt logged, as `act` refuses.
   */
  hideItem(
    moderatorId: string,
    item: unknown,
    fields: { readonly reason?: unknown; readonly statement?: unknown },
  ): Promise<ModerationResult<{ logId: number }>>;
  /** Every step taken on every notice (#912). */
  noticeSteps(): Promise<readonly NoticeStep[]>;
  /**
   * Record a step taken on a notice (#912): `acknowledged`, `decided` (with
   * the decision, and the log entry of any action it took) or
   * `notifier_told`. Each once, in that sense of order, and never for a
   * notifier who gave no address but the decision.
   */
  recordNoticeStep(
    moderatorId: string,
    noticeId: string,
    step: unknown,
    decision: unknown,
    logId: unknown,
  ): Promise<ModerationResult<null>>;
  /** The record of every notice and appeal, with no personal detail of a notifier (#912). */
  record(): Promise<ModerationRecord>;
  /** The moderators' queue of appeals, oldest first, each with the statement it appeals (#911). */
  openAppeals(): Promise<readonly OpenAppeal[]>;
  /**
   * Decide an appeal (#911): `upheld` leaves the restriction, `reversed` lifts
   * it, in one transaction with the log entry. A moderator who took the
   * decision appealed decides it all the same — the owner's ruling of
   * 2026-09-30 — and the conflict is declared to the rider and recorded.
   */
  decideAppeal(
    moderatorId: string,
    appealId: string,
    outcome: unknown,
    decision: unknown,
  ): Promise<ModerationResult<{ logId: number; moderatorConflict: boolean }>>;
  /** The approval queue (#775): every athlete awaiting a moderator's decision. */
  pendingRegistrations(): Promise<readonly AthleteRecord[]>;
  /**
   * The log a page at a time, NEWEST first (#961): `?limit=` and `?cursor=`,
   * `pagination.ts`'s. A moderator reads the latest first and asks for older.
   */
  logPage(query: URLSearchParams): Promise<ModerationResult<ModerationPage<ModerationLogEntry>>>;
  /**
   * Every suspended account, most recently suspended first, a page at a time
   * (#961) — so a moderator lifting a suspension does not have to find the id
   * in the log.
   */
  suspended(query: URLSearchParams): Promise<ModerationResult<ModerationPage<AthleteRecord>>>;
  act(
    moderatorId: string,
    action: AthleteAction,
    target: string,
    fields: {
      readonly reason?: unknown;
      readonly reportId?: unknown;
      /** The statement of reasons (#910): required of a restriction ({@link RESTRICTIONS}). */
      readonly statement?: unknown;
    },
  ): Promise<ModerationResult<{ logId: number }>>;
  dismiss(
    moderatorId: string,
    reportId: string,
    reason: unknown,
  ): Promise<ModerationResult<{ logId: number }>>;
}

/** An open appeal, with what it appeals (#911). */
export interface OpenAppeal {
  readonly appeal: Appeal;
  readonly statement: Statement;
}

export interface ModerationOptions {
  readonly store: SqlStore;
  /** Unix milliseconds. */
  readonly now: () => number;
  readonly moderators?: Moderators;
  readonly limits?: ModerationLimits;
  /**
   * Count one notice against a client's address and say whether it is within
   * the limit (#907) — `auth/identity.ts`'s limiter, in memory, so no address
   * is stored. Absent: no per-address limit, only the instance's cap.
   */
  readonly allowNoticeFrom?: (address: string | null) => boolean;
}

/**
 * How many notices the whole instance takes in an hour, from everybody
 * (#907): counted from the notices' own times, so a restart hands nobody a
 * fresh allowance and a crowd of addresses cannot fill the database.
 */
export const NOTICES_PER_HOUR = 100;

/** What sending the notice page's form did. */
export type NoticeSubmission =
  | {
      readonly kind: 'received';
      readonly reference: number;
      readonly receivedAt: number;
      readonly emailGiven: boolean;
    }
  | {
      readonly kind: 'invalid';
      readonly problems: readonly NoticeProblem[];
      readonly values: NoticeValues;
    }
  | { readonly kind: 'too-many' };

const refuse = (code: ErrorCode, fields?: readonly FieldProblem[]): ModerationResult<never> =>
  fields === undefined ? { ok: false, code } : { ok: false, code, fields };

/** A reason, trimmed, or the problem with it. */
export function checkReason(
  value: unknown,
): { ok: true; reason: string } | { ok: false; problem: string } {
  if (typeof value !== 'string') return { ok: false, problem: 'must be a string' };
  const reason = value.trim();
  if (reason.length === 0) return { ok: false, problem: 'must not be empty' };
  if ([...reason].length > MAXIMUM_REASON_LENGTH) {
    return { ok: false, problem: `must be at most ${String(MAXIMUM_REASON_LENGTH)} characters` };
  }
  return { ok: true, reason };
}

const ATHLETE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function createModeration(options: ModerationOptions): Moderation {
  const { store, now } = options;
  const seconds = (): number => Math.floor(now() / 1000);
  const moderators = options.moderators ?? {};
  const limits = options.limits ?? DEFAULT_MODERATION_LIMITS;

  async function roleOf(athleteId: string): Promise<ModeratorRole | undefined> {
    const live = (await store.listDeviceKeys(athleteId))
      .filter((key) => key.revokedAt === null)
      .map((key) => key.publicKey);
    if (moderators.owner !== undefined && live.includes(moderators.owner)) return 'owner';
    if (moderators.deputy !== undefined && live.includes(moderators.deputy)) return 'deputy';
    return undefined;
  }

  /** A moderator tried to act on a moderator: refused, changed nothing, and logged. */
  async function refusedOnModerator(
    action: ModerationActionKind,
    moderatorId: string,
    target: string | null,
    reportId: number | null,
    reason: string,
  ): Promise<ModerationResult<never>> {
    await store.logRefusedAction({
      action,
      actorAthleteId: moderatorId,
      targetAthleteId: target,
      reportId,
      reason,
      at: seconds(),
    });
    return refuse('moderation_not_applicable');
  }

  function logged(
    outcome: Awaited<ReturnType<SqlStore['moderate']>>,
  ): ModerationResult<{ logId: number }> {
    if (outcome.outcome === 'applied') return { ok: true, value: { logId: outcome.logId } };
    return refuse(outcome.outcome === 'not_found' ? 'not_found' : 'moderation_not_applicable');
  }

  return {
    async canSee(viewerId, subjectId) {
      // ONE query whatever the answer (#891's review): nobody, suspended and
      // blocked cost the same, so the time an answer takes does not say which.
      const sight = await store.sight(viewerId, subjectId);
      if (sight === undefined) return false;
      if (viewerId === subjectId) return true;
      return sight.registrationState === 'active' && sight.suspendedAt === null && !sight.blocked;
    },

    roleOf,

    async block(athleteId, target) {
      // Stored for ANY well-formed id, whether or not anybody holds it, and
      // never asked whether they do: `GET /v1/blocks` then lists exactly what
      // the caller asked for, and tells them nothing about who is here.
      if (target === athleteId || !ATHLETE_ID.test(target)) return { ok: true, value: null };
      const held = await store.listBlocks(athleteId);
      if (held.some((each) => each.blockedAthleteId === target)) return { ok: true, value: null };
      if (held.length >= MAXIMUM_BLOCKS) {
        return refuse('validation_failed', [
          {
            field: 'athleteId',
            problem: `this account already blocks ${String(MAXIMUM_BLOCKS)} athletes, the most one may`,
          },
        ]);
      }
      await store.putBlock(athleteId, target, seconds());
      return { ok: true, value: null };
    },

    async unblock(athleteId, target) {
      await store.deleteBlock(athleteId, target);
    },

    async blocks(athleteId) {
      return (await store.listBlocks(athleteId)).map((block) => block.blockedAthleteId);
    },

    async report(athleteId, target, reason) {
      if (typeof target !== 'string' || !ATHLETE_ID.test(target)) {
        return refuse('validation_failed', [
          { field: 'athleteId', problem: 'must be an athlete id' },
        ]);
      }
      if (target === athleteId) {
        return refuse('validation_failed', [
          { field: 'athleteId', problem: 'must be another athlete' },
        ]);
      }
      const checked = checkReason(reason);
      if (!checked.ok) {
        return refuse('validation_failed', [{ field: 'reason', problem: checked.problem }]);
      }
      const at = seconds();
      // Counted from the store, so a restart does not hand anybody a fresh
      // allowance — and counting EVERY report, whoever it names (#891's review).
      const recent = (await store.listReports(athleteId)).filter(
        (each) => each.createdAt > at - limits.reportWindowSeconds,
      );
      if (recent.length >= limits.reportsPerWindow) return refuse('rate_limited');
      // A report about nobody is stored too, so it spends the allowance as any
      // other does; it is closed as it is made, so no moderator ever sees it.
      const exists = (await store.getAthlete(target)) !== undefined;
      await store.putReport({
        athleteId,
        targetAthleteId: target,
        reason: checked.reason,
        createdAt: at,
        ...(exists ? {} : { closedAs: NO_SUCH_ATHLETE_OUTCOME }),
      });
      return { ok: true, value: null };
    },

    openReports: () => store.listOpenReports(),

    async submitNotice(form, address) {
      const read = readNoticeForm(form);
      if (!read.ok) return { kind: 'invalid', problems: read.problems, values: read.values };
      // Only a notice that would be kept is counted, so correcting a typo
      // costs nothing; the address first, so it is counted even past the cap.
      if (options.allowNoticeFrom?.(address) === false) return { kind: 'too-many' };
      const receivedAt = seconds();
      // An intimate image report is never turned away by the instance-wide cap
      // (OSA s.20A's 48-hour duty): a crowd of addresses could otherwise fill
      // it and lock the one notifier who cannot wait out an hour. The
      // per-address limit above still bounds it.
      if (
        read.notice.kind !== 'intimate_image' &&
        (await store.countNoticesSince(receivedAt - 60 * 60)) >= NOTICES_PER_HOUR
      ) {
        return { kind: 'too-many' };
      }
      const reference = await store.putNotice({ ...read.notice, receivedAt });
      return {
        kind: 'received',
        reference,
        receivedAt,
        emailGiven: read.notice.notifierEmail !== null,
      };
    },

    notices: () => store.listNotices(),
    pendingRegistrations: () => store.listPendingAthletes(),
    async logPage(query) {
      const request = parsePageRequest(query);
      if (!request.ok) return refuse('validation_failed', request.fields);
      const { limit, after } = request.request;
      let beforeId: number | undefined;
      if (after !== undefined) {
        beforeId = Number(after.id);
        if (after.key !== 'log' || !/^[1-9][0-9]{0,15}$/.test(after.id)) {
          return refuse('validation_failed', NOT_OUR_CURSOR);
        }
      }
      // One row more than the page says whether there is a next one.
      const rows = await store.listModerationLogPage(beforeId, limit + 1);
      const items = rows.slice(0, limit);
      const last = items.at(-1);
      return {
        ok: true,
        value: {
          items,
          next:
            rows.length > limit && last !== undefined
              ? encodeCursor({ key: 'log', id: String(last.id) })
              : null,
        },
      };
    },

    async suspended(query) {
      const request = parsePageRequest(query);
      if (!request.ok) return refuse('validation_failed', request.fields);
      const { limit, after } = request.request;
      let position: { suspendedAt: number; id: string } | undefined;
      if (after !== undefined) {
        if (!/^(0|[1-9][0-9]{0,15})$/.test(after.key) || !ATHLETE_ID.test(after.id)) {
          return refuse('validation_failed', NOT_OUR_CURSOR);
        }
        position = { suspendedAt: Number(after.key), id: after.id };
      }
      const rows = await store.listSuspendedAthletes(position, limit + 1);
      const items = rows.slice(0, limit);
      const last = items.at(-1);
      return {
        ok: true,
        value: {
          items,
          next:
            rows.length > limit && last !== undefined && last.suspendedAt !== null
              ? encodeCursor({ key: String(last.suspendedAt), id: last.id })
              : null,
        },
      };
    },

    async act(moderatorId, action, target, fields) {
      const checked = checkReason(fields.reason);
      if (!checked.ok) {
        return refuse('validation_failed', [{ field: 'reason', problem: checked.problem }]);
      }
      let reportId: number | null = null;
      if (fields.reportId !== undefined) {
        if (!Number.isSafeInteger(fields.reportId) || (fields.reportId as number) < 1) {
          return refuse('validation_failed', [
            { field: 'reportId', problem: 'must be a report’s id' },
          ]);
        }
        reportId = fields.reportId as number;
      }
      // #910: a restriction is refused without its statement of reasons, so
      // no rider is ever restricted without being able to read why.
      let statement: StatementFields | undefined;
      if (RESTRICTIONS.has(action)) {
        const read = readStatementFields(fields.statement, now());
        if (!read.ok) return refuse('validation_failed', read.fields);
        statement = read.fields;
      }
      // Nobody moderates a moderator, themselves included: the owner and the
      // deputy cannot suspend each other, or hide each other's name. The
      // attempt is logged, and changes nothing.
      if ((await roleOf(target)) !== undefined) {
        return refusedOnModerator(action, moderatorId, target, reportId, checked.reason);
      }
      return logged(
        await store.moderate({
          action,
          actorAthleteId: moderatorId,
          targetAthleteId: target,
          reportId,
          reason: checked.reason,
          at: seconds(),
          ...(statement === undefined ? {} : { statement }),
        }),
      );
    },

    statements: (athleteId) => store.listStatements(athleteId),

    appeals: (athleteId) => store.listAppeals(athleteId),

    noticeSteps: () => store.listNoticeSteps(),

    async hideItem(moderatorId, item, fields) {
      const parsed = typeof item === 'string' ? parseModerationItem(item) : undefined;
      if (parsed === undefined) {
        return refuse('validation_failed', [
          { field: 'item', problem: 'must be an item’s identifier, as the app shows it' },
        ]);
      }
      if (parsed.kind === 'rider') {
        return refuse('validation_failed', [
          { field: 'item', problem: 'a display name is hidden with hide-display-name' },
        ]);
      }
      const checked = checkReason(fields.reason);
      if (!checked.ok) {
        return refuse('validation_failed', [{ field: 'reason', problem: checked.problem }]);
      }
      const statement = readStatementFields(fields.statement, now());
      if (!statement.ok) return refuse('validation_failed', statement.fields);
      // Whose the item is: the room's maker for its listing and its route,
      // the rider in that row for a row of a result. Nobody's is `not_found`.
      let owner: string | undefined;
      if (parsed.kind === 'room' || parsed.kind === 'route') {
        owner = await store.getRoomCreator(parsed.roomId);
      } else {
        const course = await store.getRoomCourse(parsed.roomId);
        if (course?.raceFinishedAt !== undefined) {
          const order = publishedOrder(
            await store.listRoomResults(parsed.roomId),
            course.finishers ?? 0,
          );
          owner = order[parsed.row - 1]?.athleteId;
        }
      }
      if (owner === undefined) return refuse('not_found');
      if ((await roleOf(owner)) !== undefined) {
        return refusedOnModerator('hide_item', moderatorId, owner, null, checked.reason);
      }
      const hidden = await store.hideItem({
        item: (item as string).trim(),
        ownerAthleteId: owner,
        actorAthleteId: moderatorId,
        reason: checked.reason,
        statement: statement.fields,
        at: seconds(),
      });
      return hidden.outcome === 'applied'
        ? { ok: true, value: { logId: hidden.logId } }
        : refuse('moderation_not_applicable');
    },

    async recordNoticeStep(moderatorId, noticeId, step, decision, logId) {
      if (!/^[1-9][0-9]{0,15}$/.test(noticeId)) return refuse('not_found');
      if (step !== 'acknowledged' && step !== 'decided' && step !== 'notifier_told') {
        return refuse('validation_failed', [
          { field: 'step', problem: 'must be acknowledged, decided or notifier_told' },
        ]);
      }
      let decided: string | null = null;
      let entry: number | null = null;
      if (step === 'decided') {
        // The decision is what the notifier is told: held to an appeal's rules.
        const checked = readAppealGrounds(decision);
        if (!checked.ok) {
          return refuse('validation_failed', [{ field: 'decision', problem: checked.problem }]);
        }
        decided = checked.grounds;
        if (logId !== undefined && logId !== null) {
          if (!Number.isSafeInteger(logId) || (logId as number) < 1) {
            return refuse('validation_failed', [
              { field: 'logId', problem: 'must be a moderation log entry’s id' },
            ]);
          }
          entry = logId as number;
        }
      } else if (
        (decision !== undefined && decision !== null) ||
        (logId !== undefined && logId !== null)
      ) {
        return refuse('validation_failed', [
          { field: 'decision', problem: 'only a decided step carries a decision' },
        ]);
      }
      const recorded = await store.putNoticeStep({
        noticeId: Number(noticeId),
        step,
        actorAthleteId: moderatorId,
        decision: decided,
        logId: entry,
        at: seconds(),
      });
      switch (recorded) {
        case 'recorded':
          return { ok: true, value: null };
        case 'not_found':
          return refuse('not_found');
        case 'no_such_log_entry':
          return refuse('validation_failed', [
            { field: 'logId', problem: 'must be a moderation log entry’s id' },
          ]);
        default:
          return refuse('moderation_not_applicable');
      }
    },

    async record() {
      const [notices, steps, appeals] = await Promise.all([
        store.listNotices(),
        store.listNoticeSteps(),
        store.listEveryAppeal(),
      ]);
      return exportRecord(notices, steps, appeals);
    },

    async appeal(athleteId, statementId, grounds) {
      if (!/^[1-9][0-9]{0,15}$/.test(statementId)) return refuse('not_found');
      const checked = readAppealGrounds(grounds);
      if (!checked.ok) {
        return refuse('validation_failed', [{ field: 'grounds', problem: checked.problem }]);
      }
      const filed = await store.putAppeal({
        statementLogId: Number(statementId),
        appellantAthleteId: athleteId,
        grounds: checked.grounds,
        filedAt: seconds(),
      });
      if (filed.outcome === 'filed') return { ok: true, value: { appealId: filed.appealId } };
      return refuse(filed.outcome === 'not_found' ? 'not_found' : 'already_appealed');
    },

    async openAppeals() {
      const open = await store.listOpenAppeals();
      const result: OpenAppeal[] = [];
      for (const appeal of open) {
        const statement = (await store.listStatements(appeal.appellantAthleteId)).find(
          (each) => each.logId === appeal.statementLogId,
        );
        if (statement !== undefined) result.push({ appeal, statement });
      }
      return result;
    },

    async decideAppeal(moderatorId, appealId, outcome, decision) {
      if (!/^[1-9][0-9]{0,15}$/.test(appealId)) return refuse('not_found');
      if (outcome !== 'upheld' && outcome !== 'reversed') {
        return refuse('validation_failed', [
          { field: 'outcome', problem: 'must be upheld or reversed' },
        ]);
      }
      // The decision is what the rider reads, so it is held to the appeal's rules.
      const checked = readAppealGrounds(decision);
      if (!checked.ok) {
        return refuse('validation_failed', [{ field: 'decision', problem: checked.problem }]);
      }
      const decided = await store.decideAppeal({
        appealId: Number(appealId),
        actorAthleteId: moderatorId,
        outcome,
        decision: checked.grounds,
        at: seconds(),
      });
      if (decided.outcome === 'applied') {
        return {
          ok: true,
          value: { logId: decided.logId, moderatorConflict: decided.moderatorConflict },
        };
      }
      return refuse(decided.outcome === 'not_found' ? 'not_found' : 'moderation_not_applicable');
    },

    async dismiss(moderatorId, reportId, reason) {
      const checked = checkReason(reason);
      if (!checked.ok) {
        return refuse('validation_failed', [{ field: 'reason', problem: checked.problem }]);
      }
      if (!/^[1-9][0-9]{0,15}$/.test(reportId)) return refuse('not_found');
      // A moderator does not decide a report about themselves (#891's review):
      // the other moderator may. Refused, and logged, as `act` refuses.
      const report = (await store.listOpenReports()).find((each) => each.id === Number(reportId));
      if (report?.targetAthleteId === moderatorId) {
        return refusedOnModerator(
          'dismiss_report',
          moderatorId,
          moderatorId,
          report.id,
          checked.reason,
        );
      }
      return logged(
        await store.moderate({
          action: 'dismiss_report',
          actorAthleteId: moderatorId,
          targetAthleteId: null,
          reportId: Number(reportId),
          reason: checked.reason,
          at: seconds(),
        }),
      );
    },
  };
}
