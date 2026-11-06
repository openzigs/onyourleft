// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Segments published to this instance, and the boards ranked on them**
 * (#68): the first feature here that needs a server, and why — a leaderboard
 * is a total order over a set somebody must first enumerate (#57). The routes
 * in `routes.ts` turn each {@link Outcome} into a response; the rules are here.
 *
 * ## What a board is, and is not
 *
 * **Instance-scoped**, and every answer says so: `scope` is `instance` — every
 * rider on THIS instance whom the caller may see — or `personal`, the caller's
 * own efforts. There is no global, all-instance board (#56's aggregator), and
 * no follows or club board yet: there is no follow (#79) and no club (#82) on
 * an instance to scope one by. The UI states the scope in words.
 *
 * One row per athlete — their best — fastest first by ELAPSED time
 * (`@onyourleft/domain` §`RANKING_BASIS`), ties broken by the earlier start and
 * then the effort's id (§`rankOrder`'s rule), at most {@link BOARD_ROWS}.
 *
 * ## Who may be on it — the four conditions, each its own test
 *
 * A row on a SHARED board (`sql-store.ts` §`listSegmentBoard`) needs all four:
 *
 * 1. the athlete is one the caller may see — the choke point's rule
 *    (`moderation.ts` §`canSee`), applied in the same SQL statement
 *    (`sql-store.ts` §`seenBy`), so blocking, suspension and approval hold
 *    here as on every other path, with no query per row;
 * 2. the ride it came from is `public` on this instance — the device sends
 *    the ride's ADR 0004 visibility (`POST /v1/sync/records/{content}/visibility`)
 *    and `private` is the default for every ride;
 * 3. the effort itself is `public`: a `private-match` effort — an endpoint in
 *    one of the rider's privacy zones — is their own personal best and never a
 *    row anybody else sees (`@onyourleft/domain` §`EffortVisibility`);
 * 4. on a ROLLING window, it started at or after the segment was published
 *    here: backfilled history must not change what "the last 90 days" means
 *    (#64's note). An all-time board ranks every shared effort.
 *
 * ## What a row says: a name and a time
 *
 * The rider's display name through the one public projection
 * (`auth/public-athlete.ts`, a hidden name shown as "Rider"), whether it is the
 * caller's own, the rank and the elapsed time. **No coordinate, no date, no
 * athlete id, no ride**: a board says who was fastest, not where anybody lives
 * or when they ride. `leaderboard.test.ts` reads the raw body for it.
 *
 * ## Whose efforts they are
 *
 * The device matched the ride and decided each effort's visibility from the
 * rider's privacy zones — which the instance never holds. So an effort is
 * shared by its own rider, about one of their own synced rides, and the
 * instance checks what it can: the ride is theirs, holds a position, and the
 * effort lies within its recorded time. That it is PLAUSIBLE is #69's rule,
 * applied here as on the device (`@onyourleft/domain` §`implausibleEffort`).
 *
 * ## Integrity (#69)
 *
 * An effort whose implied speed is impossible for its sport is stored with
 * its reason and kept off every shared board; a rider with an effort of their
 * own on the segment may flag another rider's (off every shared board at
 * once) or the segment as hazardous (nothing on it ranked), from a closed list
 * of reasons and at most {@link FLAG_LIMIT} a day. Every exclusion and flag is
 * in the append-only integrity log the moderators read.
 * `docs/leaderboard-integrity.md` states the rule, its thresholds and what it
 * catches, and `integrity.test.ts` holds that page to this code.
 *
 * ## An erased account (#35)
 *
 * Its rows go with it: every effort it shared, every segment it published,
 * and every effort anybody shared on those (`sql-store.ts` §`eraseAthlete`).
 * The other riders' own copies stay on their devices (ADR 0036 D-3), and a
 * device that still holds such a segment finds it gone from the instance.
 */

import {
  canonicalDefinition,
  EFFORT_FLAG_REASONS,
  HAZARD_REASONS,
  implausibleEffort,
  metres,
  parsePublishedDefinition,
  PUBLISHED_SEGMENT_ID,
  publishedSegmentId,
  RANKING_BASIS,
  seconds,
  toHex,
  type PublishedSegmentDefinition,
} from '@onyourleft/domain';

import { publicAthlete } from '../auth/public-athlete.ts';
import type { Caller, Outcome } from '../auth/identity.ts';
import { BLOB_KEY } from '../blob/blob-store.ts';
import type { ErrorCode, FieldProblem } from '../errors.ts';
import { encodeCursor, parsePageRequest, type Page } from '../pagination.ts';
import type { PublishedSegment, SqlStore } from '../store/sql-store.ts';
import { sha256Bytes, storedRecord } from '../sync/sync.ts';

/** The most rows one board answers. */
export const BOARD_ROWS = 50;

/** The most efforts one ride may share on one segment: a rider who rode a loop of it. */
export const MAXIMUM_EFFORTS_PER_RIDE = 20;

/** The longest effort an instance takes, in seconds: a day. */
export const MAXIMUM_EFFORT_SECONDS = 86_400;

/**
 * How far an effort may run past its ride's recorded end, in seconds: the
 * record rounds its elapsed time to a whole second, and an effort ending on
 * the last sample may land just beyond it.
 */
export const EFFORT_SLACK_SECONDS = 2;

/** Who a board ranks. */
export type BoardScope = 'instance' | 'personal';

/** Over what time. A rolling window starts no earlier than the segment's publication here. */
export type BoardPeriod = 'all-time' | 'last-90-days' | 'last-30-days';

export const BOARD_SCOPES: readonly BoardScope[] = ['instance', 'personal'];
export const BOARD_PERIODS: readonly BoardPeriod[] = ['all-time', 'last-90-days', 'last-30-days'];

const PERIOD_DAYS: Readonly<Record<Exclude<BoardPeriod, 'all-time'>, number>> = {
  'last-90-days': 90,
  'last-30-days': 30,
};

/** A published segment as a list shows it: never its path, never its publisher. */
export interface SegmentSummary {
  readonly segmentId: string;
  readonly name: string;
  readonly sport: 'ride' | 'run';
  readonly distanceMetres: number;
  /** Unix seconds: when it was published here. */
  readonly createdAt: number;
  /** Whether the caller published it. */
  readonly yours: boolean;
}

/** One published segment, its path included, for a device to add. */
export interface SegmentDetail extends SegmentSummary {
  readonly definition: PublishedSegmentDefinition;
}

/** One row of a board. */
export interface BoardRowView {
  /** 1 for the fastest; `null` for an effort of the caller's own that is not counted (#69). */
  readonly rank: number | null;
  /** The rider's display name, through the one public projection. */
  readonly rider: string;
  /** Whether it is the caller's own effort. */
  readonly yours: boolean;
  readonly elapsedSeconds: number;
  /** The effort's opaque id, which a flag names (#69). Never an athlete's id. */
  readonly effortId: string;
  /**
   * Why it is not counted, in words, or `null` (#69): only ever on the
   * caller's own board — a shared board leaves such an effort out.
   */
  readonly excluded: string | null;
}

/** A board, saying what it is a board of. */
export interface Board {
  readonly segment: SegmentSummary;
  readonly scope: BoardScope;
  readonly period: BoardPeriod;
  readonly rankedBy: typeof RANKING_BASIS;
  /** A rider flagged the segment hazardous (#69): nothing on it is ranked. */
  readonly hazardous: boolean;
  readonly rows: readonly BoardRowView[];
}

/** A flag's reasons, `@onyourleft/domain`'s closed lists (#69), re-exported for the routes. */
export { EFFORT_FLAG_REASONS, HAZARD_REASONS };

/**
 * How many flags one rider may raise in a day (#69): an unlimited flag button
 * is a harassment tool. Counted from the flags themselves, so a restart does
 * not reset it.
 */
export const FLAG_LIMIT = { limit: 10, windowSeconds: 86_400 } as const;

/** What the rider's own board says of an effort another rider flagged. */
export const FLAGGED_SENTENCE =
  'Flagged by another rider, so it is on no shared board. The ride itself is unchanged.';

/** What the rider's own board says on a segment flagged hazardous. */
export const HAZARDOUS_SENTENCE =
  'This segment was flagged hazardous, so nothing on it is ranked and no personal best is awarded.';

/** One entry of the integrity log, as the moderators read it. */
export interface IntegrityLogView {
  readonly id: number;
  readonly at: number;
  readonly action: 'excluded' | 'flagged_effort' | 'flagged_hazardous';
  /** The flagger, or `null` for the instance's own rule or a flagger who erased their account. */
  readonly actorAthleteId: string | null;
  readonly subjectAthleteId: string | null;
  readonly segmentId: string;
  readonly effortId: string | null;
  readonly reason: string;
}

export interface Segments {
  /** Publish a segment: its id, and whether this call published it. */
  publish(
    caller: Caller,
    body: Readonly<Record<string, unknown>>,
  ): Promise<
    Outcome<{ readonly segmentId: string; readonly createdAt: number; readonly published: boolean }>
  >;
  /** Published segments the caller may see, newest first, a page at a time. */
  list(caller: Caller, query: URLSearchParams): Promise<Outcome<Page<SegmentSummary>>>;
  /** One, with its path. */
  get(caller: Caller, segmentId: string): Promise<Outcome<SegmentDetail>>;
  /** Withdraw one the caller published, with every effort on it. */
  withdraw(caller: Caller, segmentId: string): Promise<Outcome<null>>;
  /** Replace the caller's efforts on a segment from one of their synced rides. */
  shareEfforts(
    caller: Caller,
    segmentId: string,
    contentSha256: string,
    body: Readonly<Record<string, unknown>>,
  ): Promise<Outcome<{ readonly efforts: number }>>;
  /** A board. */
  board(caller: Caller, segmentId: string, query: URLSearchParams): Promise<Outcome<Board>>;
  /** Flag another rider's effort on a segment the caller has an effort on (#69). */
  flagEffort(
    caller: Caller,
    segmentId: string,
    effortId: string,
    body: Readonly<Record<string, unknown>>,
  ): Promise<Outcome<{ readonly flagged: boolean }>>;
  /** Flag a segment the caller has an effort on as hazardous (#69). */
  flagHazard(
    caller: Caller,
    segmentId: string,
    body: Readonly<Record<string, unknown>>,
  ): Promise<Outcome<{ readonly flagged: boolean }>>;
  /** The integrity log, a page at a time, for the moderators (#69). */
  integrityLog(
    query: URLSearchParams,
  ): Promise<
    Outcome<{ readonly items: readonly IntegrityLogView[]; readonly next: string | null }>
  >;
}

/** An automatic exclusion, in the words the log and the rider's own board carry. */
export function exclusionReason(
  sport: 'ride' | 'run',
  distanceMetres: number,
  elapsedSeconds: number,
): string | null {
  const found = implausibleEffort(sport, metres(distanceMetres), seconds(elapsedSeconds));
  if (found === undefined) return null;
  return `Excluded automatically: ${found.impliedSpeedMetresPerSecond.toFixed(1)} m/s averaged over the segment, faster than the ${String(found.ceilingMetresPerSecond)} m/s a ${sport} can go.`;
}

export interface SegmentsOptions {
  readonly store: SqlStore;
  /** Unix milliseconds. */
  readonly now?: () => number;
  /** A fresh effort id; random unless a test needs to know it. */
  readonly effortId?: () => string;
}

const refuse = (code: ErrorCode, fields?: readonly FieldProblem[]): Outcome<never> =>
  fields === undefined ? { ok: false, code } : { ok: false, code, fields };

const invalid = (field: string, problem: string): Outcome<never> =>
  refuse('validation_failed', [{ field, problem }]);

/** 128 random bits, as hex. */
function randomEffortId(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

/** One of a query's parameters, given at most once, from `allowed`; the first is the default. */
function oneOf<T extends string>(
  query: URLSearchParams,
  name: string,
  allowed: readonly T[],
): T | undefined {
  const given = query.getAll(name);
  if (given.length === 0) return allowed[0];
  if (given.length > 1) return undefined;
  return (allowed as readonly string[]).includes(given[0] ?? '') ? (given[0] as T) : undefined;
}

export function createSegments(options: SegmentsOptions): Segments {
  const { store } = options;
  const now = options.now ?? (() => Date.now());
  const nowSeconds = (): number => Math.floor(now() / 1000);
  const mintEffortId = options.effortId ?? randomEffortId;

  const summaryOf = (caller: Caller, segment: PublishedSegment): SegmentSummary => ({
    segmentId: segment.id,
    name: segment.name,
    sport: segment.sport,
    distanceMetres: segment.distanceMetres,
    createdAt: segment.createdAt,
    yours: segment.athleteId === caller.athleteId,
  });

  /** A segment the caller may see, or `undefined` — the same for one that is not there. */
  const visible = (caller: Caller, segmentId: string): Promise<PublishedSegment | undefined> =>
    PUBLISHED_SEGMENT_ID.test(segmentId)
      ? store.getPublishedSegment(caller.athleteId, segmentId)
      : Promise.resolve(undefined);

  return {
    publish: async (caller, body) => {
      const parsed = parsePublishedDefinition(body.segment);
      if (!parsed.ok) return invalid(parsed.field, parsed.problem);
      const segmentId = await publishedSegmentId(parsed.definition, sha256Bytes);
      const createdAt = nowSeconds();
      const outcome = await store.publishSegment(caller.athleteId, {
        id: segmentId,
        name: parsed.definition.name,
        sport: parsed.definition.sport,
        distanceMetres: parsed.distance,
        definition: canonicalDefinition(parsed.definition),
        createdAt,
      });
      if (outcome === 'no-athlete') return refuse('unauthenticated');
      if (outcome === 'published') {
        return { ok: true, value: { segmentId, createdAt, published: true } };
      }
      // Already here: the same definition, by this rider or another. Answered
      // with its id, and its publication time when the caller may see it.
      const held = await store.getPublishedSegment(caller.athleteId, segmentId);
      return {
        ok: true,
        value: { segmentId, createdAt: held?.createdAt ?? createdAt, published: false },
      };
    },

    list: async (caller, query) => {
      const request = parsePageRequest(query);
      if (!request.ok) return refuse('validation_failed', request.fields);
      const { limit, after } = request.request;
      let position;
      if (after !== undefined) {
        position = { createdAt: Number(after.key), id: after.id };
        if (!Number.isSafeInteger(position.createdAt) || !PUBLISHED_SEGMENT_ID.test(position.id)) {
          return invalid('cursor', 'must be a cursor this instance returned');
        }
      }
      const rows = await store.listPublishedSegments(caller.athleteId, position, limit + 1);
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        ok: true,
        value: {
          items: page.map((segment) => summaryOf(caller, segment)),
          next:
            rows.length > limit && last !== undefined
              ? encodeCursor({ key: String(last.createdAt), id: last.id })
              : null,
        },
      };
    },

    get: async (caller, segmentId) => {
      const segment = await visible(caller, segmentId);
      if (segment === undefined) return refuse('not_found');
      return {
        ok: true,
        value: {
          ...summaryOf(caller, segment),
          definition: JSON.parse(segment.definition) as PublishedSegmentDefinition,
        },
      };
    },

    withdraw: async (caller, segmentId) => {
      if (!PUBLISHED_SEGMENT_ID.test(segmentId)) return refuse('not_found');
      const withdrawn = await store.withdrawSegment(caller.athleteId, segmentId);
      return withdrawn ? { ok: true, value: null } : refuse('not_found');
    },

    shareEfforts: async (caller, segmentId, contentSha256, body) => {
      if (!BLOB_KEY.test(contentSha256)) return refuse('not_found');
      const { efforts } = body;
      if (!Array.isArray(efforts) || efforts.length > MAXIMUM_EFFORTS_PER_RIDE) {
        return invalid(
          'efforts',
          `must be a list of at most ${String(MAXIMUM_EFFORTS_PER_RIDE)} efforts`,
        );
      }
      const parsed: {
        startedAt: number;
        elapsedSeconds: number;
        visibility: 'public' | 'private-match';
      }[] = [];
      for (const effort of efforts as unknown[]) {
        if (effort === null || typeof effort !== 'object' || Array.isArray(effort)) {
          return invalid('efforts', 'every effort must be an object');
        }
        const fields = effort as Record<string, unknown>;
        if (Object.keys(fields).sort().join() !== 'elapsedSeconds,startedAt,visibility') {
          return invalid(
            'efforts',
            'every effort must have exactly startedAt, elapsedSeconds and visibility',
          );
        }
        const { startedAt, elapsedSeconds, visibility } = fields;
        if (typeof startedAt !== 'number' || !Number.isSafeInteger(startedAt) || startedAt < 0) {
          return invalid('efforts', 'every startedAt must be whole Unix seconds');
        }
        if (
          typeof elapsedSeconds !== 'number' ||
          !Number.isFinite(elapsedSeconds) ||
          elapsedSeconds <= 0 ||
          elapsedSeconds > MAXIMUM_EFFORT_SECONDS
        ) {
          return invalid(
            'efforts',
            `every elapsedSeconds must be more than 0 and at most ${String(MAXIMUM_EFFORT_SECONDS)}`,
          );
        }
        if (visibility !== 'public' && visibility !== 'private-match') {
          return invalid('efforts', 'every visibility must be public or private-match');
        }
        if (parsed.some((earlier) => earlier.startedAt === startedAt)) {
          return invalid('efforts', 'no two efforts may start at the same instant');
        }
        parsed.push({ startedAt, elapsedSeconds, visibility });
      }
      const segment = await visible(caller, segmentId);
      if (segment === undefined) return refuse('not_found');
      const ride = await store.getActivityRecord(caller.athleteId, contentSha256);
      if (ride === undefined) return refuse('not_found');
      const { claims } = storedRecord(ride);
      if (parsed.length > 0 && !claims.hasPosition) {
        return invalid(
          'efforts',
          'the ride holds no position, so no effort can have been found in it',
        );
      }
      const end = claims.startedAt + claims.elapsedTime + EFFORT_SLACK_SECONDS;
      for (const effort of parsed) {
        if (effort.startedAt < claims.startedAt || effort.startedAt + effort.elapsedSeconds > end) {
          return invalid('efforts', 'every effort must lie within the ride’s recorded time');
        }
      }
      // #69: the rule is applied HERE as well as on the device, against the
      // length this instance measured, because a device is not to be trusted
      // with a board. An excluded effort is kept — its rider sees why — and
      // recorded in the integrity log by the same write.
      const outcome = await store.replaceSegmentEfforts(
        caller.athleteId,
        segmentId,
        contentSha256,
        parsed.map((effort) => ({
          id: mintEffortId(),
          ...effort,
          excludedReason: exclusionReason(
            segment.sport,
            segment.distanceMetres,
            effort.elapsedSeconds,
          ),
        })),
        nowSeconds(),
      );
      return outcome === 'replaced'
        ? { ok: true, value: { efforts: parsed.length } }
        : refuse('not_found');
    },

    board: async (caller, segmentId, query) => {
      const scope = oneOf(query, 'scope', BOARD_SCOPES);
      if (scope === undefined) return invalid('scope', `must be one of ${BOARD_SCOPES.join(', ')}`);
      const period = oneOf(query, 'period', BOARD_PERIODS);
      if (period === undefined) {
        return invalid('period', `must be one of ${BOARD_PERIODS.join(', ')}`);
      }
      const segment = await visible(caller, segmentId);
      if (segment === undefined) return refuse('not_found');
      const hazardous = segment.hazardous === true;
      // A rolling window starts no earlier than the segment's publication
      // here: an effort ridden before it existed is history somebody
      // backfilled, and must not change what "the last 90 days" means.
      const since =
        period === 'all-time'
          ? 0
          : Math.max(nowSeconds() - PERIOD_DAYS[period] * 86_400, segment.createdAt);
      let rows: BoardRowView[];
      if (scope === 'personal') {
        // Every row is the caller's own, `private-match` included: their
        // history. An effort the rule excluded, one a rider flagged, and every
        // effort on a hazardous segment is still here — with the reason, and
        // no rank (#69's second criterion).
        const own = await store.getAthlete(caller.athleteId);
        const rider = own === undefined ? '' : publicAthlete(own).displayName;
        let place = 0;
        rows = (
          await store.listOwnSegmentEfforts(caller.athleteId, segmentId, since, BOARD_ROWS)
        ).map((effort) => {
          const excluded = hazardous
            ? HAZARDOUS_SENTENCE
            : (effort.excludedReason ?? (effort.flagged ? FLAGGED_SENTENCE : null));
          if (excluded === null) place += 1;
          return {
            rank: excluded === null ? place : null,
            rider,
            yours: true,
            elapsedSeconds: effort.elapsedSeconds,
            effortId: effort.id,
            excluded,
          };
        });
      } else {
        // A hazardous segment ranks nobody: no board, no first place (#69).
        rows = hazardous
          ? []
          : (await store.listSegmentBoard(caller.athleteId, segmentId, since, BOARD_ROWS)).map(
              (row, index) => ({
                rank: index + 1,
                // The one public projection, over the columns the board's own join read.
                rider: publicAthlete({
                  id: row.athleteId,
                  displayName: row.displayName,
                  displayNameHiddenAt: row.displayNameHiddenAt,
                  createdAt: 0,
                  registrationState: 'active',
                }).displayName,
                yours: row.athleteId === caller.athleteId,
                elapsedSeconds: row.elapsedSeconds,
                effortId: row.effortId,
                excluded: null,
              }),
            );
      }
      return {
        ok: true,
        value: {
          segment: summaryOf(caller, segment),
          scope,
          period,
          rankedBy: RANKING_BASIS,
          hazardous,
          rows,
        },
      };
    },

    flagEffort: async (caller, segmentId, effortId, body) =>
      flag(caller, segmentId, effortId, body.reason, EFFORT_FLAG_REASONS),

    flagHazard: async (caller, segmentId, body) =>
      flag(caller, segmentId, null, body.reason, HAZARD_REASONS),

    integrityLog: async (query) => {
      const request = parsePageRequest(query);
      if (!request.ok) return refuse('validation_failed', request.fields);
      const { limit, after } = request.request;
      let position: number | undefined;
      if (after !== undefined) {
        position = Number(after.id);
        if (!Number.isSafeInteger(position)) {
          return invalid('cursor', 'must be a cursor this instance returned');
        }
      }
      const rows = await store.listSegmentIntegrityLog(position, limit + 1);
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        ok: true,
        value: {
          items: page,
          next:
            rows.length > limit && last !== undefined
              ? encodeCursor({ key: String(last.at), id: String(last.id) })
              : null,
        },
      };
    },
  };

  /**
   * One flag: the reason held to its closed list, the segment one the caller
   * may see, and then the store's own checks — an effort of the caller's own
   * on the segment, the rate limit, and the effort somebody else's that the
   * caller may see — in one transaction with its log entry.
   */
  async function flag(
    caller: Caller,
    segmentId: string,
    effortId: string | null,
    reason: unknown,
    reasons: readonly string[],
  ): Promise<Outcome<{ readonly flagged: boolean }>> {
    if (typeof reason !== 'string' || !reasons.includes(reason)) {
      return invalid('reason', `must be one of ${reasons.join(', ')}`);
    }
    if ((await visible(caller, segmentId)) === undefined) return refuse('not_found');
    const outcome = await store.flagSegment({
      athleteId: caller.athleteId,
      segmentId,
      effortId,
      reason,
      at: nowSeconds(),
      limit: FLAG_LIMIT.limit,
      windowSeconds: FLAG_LIMIT.windowSeconds,
    });
    switch (outcome) {
      case 'flagged':
        return { ok: true, value: { flagged: true } };
      case 'already':
        return { ok: true, value: { flagged: false } };
      case 'rate_limited':
        return refuse('rate_limited');
      case 'no-effort-of-yours':
        return refuse('validation_failed', [
          {
            field: 'segmentId',
            problem: 'only a rider with an effort of their own on this segment may flag on it',
          },
        ]);
      case 'not-found':
        return refuse('not_found');
    }
  }
}
