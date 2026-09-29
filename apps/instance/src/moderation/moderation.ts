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
 * ## The moderators
 *
 * The instance's operator names two DEVICE KEYS, the owner's and a deputy's
 * (ruling Q13, 2026-09-28). The athlete who holds one, unrevoked, has that
 * role. A key rather than an athlete id, so the operator can name a moderator
 * before they have registered — which approval-required registration (#775)
 * needs, or nobody could ever approve anybody. A moderator's every action goes
 * through {@link SqlStore.moderate}, which applies it and appends it to the
 * append-only log in one transaction; a moderator may not act on a moderator.
 */

import type { ErrorCode, FieldProblem } from '../errors.ts';
import type {
  ModerationActionKind,
  ModerationLogEntry,
  Report,
  SqlStore,
} from '../store/sql-store.ts';

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

export type ModerationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ErrorCode; readonly fields?: readonly FieldProblem[] };

/** The actions a moderator takes on an athlete (a report is dismissed by its own route). */
export type AthleteAction = Exclude<ModerationActionKind, 'dismiss_report'>;

export interface Moderation {
  /** THE choke point: may `viewerId` see, or act on, `subjectId`? */
  canSee(viewerId: string, subjectId: string): Promise<boolean>;
  /** The role the athlete holds, if any. */
  roleOf(athleteId: string): Promise<ModeratorRole | undefined>;

  block(athleteId: string, target: string): Promise<void>;
  unblock(athleteId: string, target: string): Promise<void>;
  blocks(athleteId: string): Promise<readonly string[]>;
  report(athleteId: string, target: unknown, reason: unknown): Promise<ModerationResult<null>>;

  openReports(): Promise<readonly Report[]>;
  log(): Promise<readonly ModerationLogEntry[]>;
  act(
    moderatorId: string,
    action: AthleteAction,
    target: string,
    fields: { readonly reason?: unknown; readonly reportId?: unknown },
  ): Promise<ModerationResult<{ logId: number }>>;
  dismiss(
    moderatorId: string,
    reportId: string,
    reason: unknown,
  ): Promise<ModerationResult<{ logId: number }>>;
}

export interface ModerationOptions {
  readonly store: SqlStore;
  /** Unix milliseconds. */
  readonly now: () => number;
  readonly moderators?: Moderators;
  readonly limits?: ModerationLimits;
}

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

  function logged(
    outcome: Awaited<ReturnType<SqlStore['moderate']>>,
  ): ModerationResult<{ logId: number }> {
    if (outcome.outcome === 'applied') return { ok: true, value: { logId: outcome.logId } };
    return refuse(outcome.outcome === 'not_found' ? 'not_found' : 'moderation_not_applicable');
  }

  return {
    async canSee(viewerId, subjectId) {
      const subject = await store.getAthlete(subjectId);
      if (subject === undefined) return false;
      if (viewerId === subjectId) return true;
      if (subject.registrationState !== 'active' || subject.suspendedAt !== null) return false;
      return !(await store.blockedEitherWay(viewerId, subjectId));
    },

    roleOf,

    async block(athleteId, target) {
      // Stored only for an athlete that exists, and answered the same either
      // way: the caller learns nothing about who is here.
      if (target === athleteId || !ATHLETE_ID.test(target)) return;
      if ((await store.getAthlete(target)) === undefined) return;
      await store.putBlock(athleteId, target, seconds());
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
      // Counted from the store, so a restart does not hand anybody a fresh allowance.
      const recent = (await store.listReports(athleteId)).filter(
        (each) => each.createdAt > at - limits.reportWindowSeconds,
      );
      if (recent.length >= limits.reportsPerWindow) return refuse('rate_limited');
      // A report about nobody is not stored, and is answered the same.
      if ((await store.getAthlete(target)) !== undefined) {
        await store.putReport({
          athleteId,
          targetAthleteId: target,
          reason: checked.reason,
          createdAt: at,
        });
      }
      return { ok: true, value: null };
    },

    openReports: () => store.listOpenReports(),
    log: () => store.listModerationLog(),

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
      // Nobody moderates a moderator, themselves included: the owner and the
      // deputy cannot suspend each other, or hide each other's name.
      if ((await roleOf(target)) !== undefined) return refuse('moderation_not_applicable');
      return logged(
        await store.moderate({
          action,
          actorAthleteId: moderatorId,
          targetAthleteId: target,
          reportId,
          reason: checked.reason,
          at: seconds(),
        }),
      );
    },

    async dismiss(moderatorId, reportId, reason) {
      const checked = checkReason(reason);
      if (!checked.ok) {
        return refuse('validation_failed', [{ field: 'reason', problem: checked.problem }]);
      }
      if (!/^[1-9][0-9]{0,15}$/.test(reportId)) return refuse('not_found');
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
