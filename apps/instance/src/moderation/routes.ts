// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The moderation routes (#83), as entries in the one route table
 * (`routes.ts`).
 *
 * Two kinds. A rider's own — block, unblock, list their blocks, report — which
 * answer the same whether or not the athlete they name exists, so none of
 * them tells anybody that a block is there (`moderation.ts`). And the
 * moderators' — the report queue, the log, and every action — which declare
 * `reaches: 'moderation'`, so the handler answers `not_found` to anybody who
 * is not a moderator (the owner, or the deputy if one is named) before the
 * route is called.
 */

import { errorResponse } from '../errors.ts';
import { pageResponse } from '../html.ts';
import { json, noContent, type Route, type RouteContext, type Schema } from '../route-kit.ts';
import type { AthleteAction, Moderation, ModerationResult } from './moderation.ts';
import { NOTICE_PAGE_PATH, noticePage } from './notices.ts';
import { statementView as toStatementView } from './statements.ts';
import { stepsOf } from './record.ts';

function moderationOf(context: RouteContext): Moderation {
  // The handler answers `unavailable` before calling a route that declares
  // `identity` without one, so this is never reached with none.
  if (context.identity === undefined) throw new Error('moderation route called without identity');
  return context.identity.moderation;
}

function callerId(context: RouteContext): string {
  if (context.caller === undefined) throw new Error('session route called without a caller');
  return context.caller.athleteId;
}

function answer<T>(result: ModerationResult<T>, body: (value: T) => Response): Response {
  if (result.ok) return body(result.value);
  return errorResponse(result.code, result.fields === undefined ? {} : { fields: result.fields });
}

const string: Schema = { type: 'string' };
const integer: Schema = { type: 'integer' };
const nullableInteger: Schema = { type: ['integer', 'null'] };
const nullableString: Schema = { type: ['string', 'null'] };

function object(
  properties: Readonly<Record<string, Schema>>,
  required: readonly string[] = Object.keys(properties),
): Schema {
  return { type: 'object', properties, required, additionalProperties: false };
}

const reportSchema = object({
  reportId: integer,
  /** `null` for a flag a room filed itself (#789). */
  reporterAthleteId: nullableString,
  targetAthleteId: string,
  reason: string,
  createdAt: integer,
  /** The room it came from, and the room's tick then (#789); `null` from outside a room. */
  roomId: nullableString,
  roomTick: nullableInteger,
  flag: {
    type: ['object', 'null'],
    properties: {
      durationSeconds: integer,
      ceilingWattsPerKilogram: { type: 'number' },
    },
    required: ['durationSeconds', 'ceilingWattsPerKilogram'],
    additionalProperties: false,
  },
});

const logEntrySchema = object({
  logId: integer,
  action: string,
  actorAthleteId: string,
  targetAthleteId: nullableString,
  reportId: nullableInteger,
  reason: string,
  at: integer,
  /** The room the action was taken in (#789), or `null`. */
  roomId: nullableString,
});

/** The steps taken on a notice (#912). */
const noticeSteps = {
  acknowledgedAt: nullableInteger,
  decidedAt: nullableInteger,
  decision: nullableString,
  logId: nullableInteger,
  notifierToldAt: nullableInteger,
};

const noticeSchema = object({
  noticeId: integer,
  receivedAt: integer,
  kind: { type: 'string', enum: ['illegal_content', 'intimate_image'] },
  explanation: string,
  items: { type: 'array', items: string },
  location: nullableString,
  notifierName: nullableString,
  notifierEmail: nullableString,
  bonaFide: { type: 'boolean' },
  ...noticeSteps,
});

/** Why the notice page reaches nobody through the choke point: it is for anybody, signed in or not. */
const NOTICE_PAGE_REACH = {
  exempt:
    'the notice page is for anybody, with or without an account (DSA Art. 16(1), #907); it names items by identifier, shows nobody anything and answers the same whatever they name',
} as const;

const actionResponse: Route['response'] = {
  contentType: 'application/json',
  schema: object({ logId: integer }),
};

const decidedOn: Schema = { type: 'string', enum: ['notice', 'report', 'own_initiative'] };

/**
 * A restriction's statement of reasons, as a moderator sends it (#910):
 * required of a suspension and of hiding a display name.
 */
const statementInput = object(
  {
    facts: string,
    decidedOn,
    legalGround: nullableString,
    termsGround: nullableString,
    notifierNamed: nullableString,
    moderatorConflict: { type: 'boolean' },
    endsAt: nullableInteger,
  },
  ['facts', 'decidedOn'],
);

/** A statement as the affected rider reads it (#910): every Art. 17(3) part. */
const statementView = object({
  statementId: integer,
  at: integer,
  restriction: string,
  endsAt: nullableInteger,
  facts: string,
  decidedOn,
  legalGround: nullableString,
  termsGround: nullableString,
  notifierNamed: nullableString,
  moderatorConflict: { type: 'boolean' },
  automated: { type: 'boolean' },
  appeal: {
    type: ['object', 'null'],
    properties: {
      appealId: integer,
      filedAt: integer,
      grounds: string,
      outcome: nullableString,
      decision: nullableString,
      moderatorConflict: { type: ['boolean', 'null'] },
      decidedAt: nullableInteger,
    },
    required: [
      'appealId',
      'filedAt',
      'grounds',
      'outcome',
      'decision',
      'moderatorConflict',
      'decidedAt',
    ],
    additionalProperties: false,
  },
  redress: object({
    appeal: { type: 'boolean' },
    contactEmail: nullableString,
    outOfCourt: { type: 'boolean' },
    court: { type: 'boolean' },
  }),
});

/** One moderator action on an athlete. */
function athleteAction(
  path: string,
  operationId: string,
  action: AthleteAction,
  summary: string,
): Route {
  return {
    method: 'POST',
    path: `/v1/moderation/${path}`,
    // ADR 0047 D-7: every moderator route is sealed and signed (#1192).
    sealed: 'only',
    operationId,
    reaches: 'moderation',
    summary,
    identity: true,
    auth: 'session',
    request: object({ reason: string, reportId: integer, statement: statementInput }, ['reason']),
    errors: ['unauthenticated', 'validation_failed', 'moderation_not_applicable'],
    response: actionResponse,
    handle: async (context) =>
      answer(
        await moderationOf(context).act(callerId(context), action, context.params.athleteId ?? '', {
          reason: context.json.reason,
          reportId: context.json.reportId,
          statement: context.json.statement,
        }),
        (value) => json(value),
      ),
  };
}

export const MODERATION_ROUTES: readonly Route[] = [
  {
    method: 'GET',
    path: '/v1/statements',
    sealed: 'only',
    operationId: 'listStatements',
    reaches: 'own',
    // #910: a SUSPENDED rider reads why, through the way-out session
    // (`POST /v1/auth/leave-session`), and nothing more.
    admitsSuspended: true,
    summary:
      'The statements of reasons about this athlete (#910), newest first: for every restriction a moderator imposed on them, what was done and for how long, the facts, what it was decided on, the law or terms relied on, that no automated means were used, and how to ask for it to be looked at again. A suspended rider reads them through the way-out session. Nobody else’s, and never a notifier the moderator did not name.',
    identity: true,
    auth: 'session',
    errors: ['unauthenticated'],
    response: {
      contentType: 'application/json',
      schema: object({ statements: { type: 'array', items: statementView } }),
    },
    handle: async (context) => {
      const moderation = moderationOf(context);
      const caller = callerId(context);
      const appeals = await moderation.appeals(caller);
      return json({
        statements: (await moderation.statements(caller)).map((each) =>
          toStatementView(
            each,
            context.config.legal,
            appeals.find((appeal) => appeal.statementLogId === each.logId),
          ),
        ),
      });
    },
  },
  {
    method: 'POST',
    path: '/v1/statements/{statementId}/appeal',
    sealed: 'only',
    operationId: 'appealStatement',
    reaches: 'own',
    // #911: a SUSPENDED rider appeals through the way-out session, and that
    // grants nothing else.
    admitsSuspended: true,
    summary:
      'Appeal a decision about this athlete (#911): the statement of reasons it explains, with the grounds (at most 2000 characters, no coordinate). One appeal per decision. A suspended rider appeals through the way-out session. A statement that is not about the caller is `not_found`, as one that does not exist is.',
    identity: true,
    auth: 'session',
    request: object({ grounds: string }),
    errors: ['unauthenticated', 'validation_failed', 'not_found', 'already_appealed'],
    response: { contentType: 'application/json', schema: object({ appealId: integer }) },
    handle: async (context) =>
      answer(
        await moderationOf(context).appeal(
          callerId(context),
          context.params.statementId ?? '',
          context.json.grounds,
        ),
        (value) => json(value),
      ),
  },
  {
    method: 'POST',
    path: '/v1/moderation/items/hide',
    sealed: 'only',
    operationId: 'hideItem',
    reaches: 'moderation',
    summary:
      'Hide one item (#913) — a room’s listing (`room:<room id>`), the route shown in a room (`route:<room id>`) or one row of a race’s result (`result:<room id>:<row>`) — by the identifier a notice names it by, with a reason and a statement of reasons its owner is shown, written to the log in one transaction. Nothing is deleted: every read a rider makes of the room leaves the item out, and its owner still sees it.',
    identity: true,
    auth: 'session',
    request: object({ item: string, reason: string, statement: statementInput }, [
      'item',
      'reason',
      'statement',
    ]),
    errors: ['unauthenticated', 'validation_failed', 'moderation_not_applicable'],
    response: actionResponse,
    handle: async (context) =>
      answer(
        await moderationOf(context).hideItem(callerId(context), context.json.item, {
          reason: context.json.reason,
          statement: context.json.statement,
        }),
        (value) => json(value),
      ),
  },
  {
    method: 'GET',
    path: '/v1/moderation/appeals',
    sealed: 'only',
    operationId: 'listOpenAppeals',
    reaches: 'moderation',
    summary:
      'The moderators’ queue of appeals (#911): every appeal not yet decided, oldest first, with the decision it appeals.',
    identity: true,
    auth: 'session',
    errors: ['unauthenticated'],
    response: {
      contentType: 'application/json',
      schema: object({
        appeals: {
          type: 'array',
          items: object({
            appealId: integer,
            filedAt: integer,
            grounds: string,
            appellantAthleteId: string,
            statementId: integer,
            restriction: string,
            facts: string,
            decidedBy: string,
          }),
        },
      }),
    },
    handle: async (context) =>
      json({
        appeals: (await moderationOf(context).openAppeals()).map(({ appeal, statement }) => ({
          appealId: appeal.id,
          filedAt: appeal.filedAt,
          grounds: appeal.grounds,
          appellantAthleteId: appeal.appellantAthleteId,
          statementId: statement.logId,
          restriction: statement.restriction,
          facts: statement.facts,
          decidedBy: statement.actorAthleteId,
        })),
      }),
  },
  {
    method: 'POST',
    path: '/v1/moderation/appeals/{appealId}/decide',
    sealed: 'only',
    operationId: 'decideAppeal',
    reaches: 'moderation',
    summary:
      'Decide an appeal (#911): `upheld` leaves the restriction; `reversed` lifts the suspension or restores the display name, in one transaction with the log entry. `decision` is what the rider is told. A moderator who took the decision appealed may decide it; the conflict is declared to the rider and recorded (the owner’s ruling of 2026-09-30).',
    identity: true,
    auth: 'session',
    request: object({
      outcome: { type: 'string', enum: ['upheld', 'reversed'] },
      decision: string,
    }),
    errors: ['unauthenticated', 'validation_failed', 'not_found', 'moderation_not_applicable'],
    response: {
      contentType: 'application/json',
      schema: object({ logId: integer, moderatorConflict: { type: 'boolean' } }),
    },
    handle: async (context) =>
      answer(
        await moderationOf(context).decideAppeal(
          callerId(context),
          context.params.appealId ?? '',
          context.json.outcome,
          context.json.decision,
        ),
        (value) => json(value),
      ),
  },
  {
    method: 'GET',
    path: NOTICE_PAGE_PATH,
    operationId: 'getNoticePage',
    reaches: NOTICE_PAGE_REACH,
    summary:
      'The notice page (#907): a form, for anybody with or without an account, to report content on this instance they think is illegal (DSA Art. 16) or to make an intimate image content report (OSA s.20A). HTML, with no script.',
    identity: true,
    response: { contentType: 'text/html' },
    handle: ({ config }) => pageResponse(noticePage({ kind: 'form' }, config.name)),
  },
  {
    method: 'POST',
    path: NOTICE_PAGE_PATH,
    operationId: 'submitNotice',
    reaches: NOTICE_PAGE_REACH,
    summary:
      'Send the notice page’s form (#907). 200 and a page with the notice’s reference when it is received; 400 and the form again, saying what to correct, when it is not; 429 when this client address or the whole instance has sent too many in the last hour (an intimate image report is not counted against the whole instance); 403 when a browser says the post came from another site. No client address is stored, and nothing typed is logged.',
    identity: true,
    form: object(
      {
        kind: { type: 'string', enum: ['illegal_content', 'intimate_image'] },
        explanation: string,
        items: string,
        location: string,
        name: string,
        email: string,
        bona_fide: string,
        declare_intimate: string,
        declare_subject: string,
        declare_true: string,
      },
      ['kind', 'explanation'],
    ),
    response: { contentType: 'text/html' },
    handle: async (context) => {
      // A form on another site could post real visitors' notices from their
      // own addresses; a browser says so, and the page's own form never is.
      if (context.request.headers.get('sec-fetch-site') === 'cross-site') {
        return pageResponse(noticePage({ kind: 'form' }, context.config.name), 403);
      }
      const form = new URLSearchParams(
        new TextDecoder('utf-8').decode(context.body ?? new Uint8Array()),
      );
      const outcome = await moderationOf(context).submitNotice(form, context.client.address);
      const name = context.config.name;
      switch (outcome.kind) {
        case 'received':
          return pageResponse(noticePage(outcome, name));
        case 'invalid':
          return pageResponse(
            noticePage({ kind: 'form', values: outcome.values, problems: outcome.problems }, name),
            400,
          );
        case 'too-many':
          return pageResponse(noticePage({ kind: 'too-many' }, name), 429);
      }
    },
  },
  {
    method: 'GET',
    path: '/v1/moderation/notices',
    sealed: 'only',
    operationId: 'listNotices',
    reaches: 'moderation',
    summary:
      'The moderators’ queue of notices (#907): every notice the notice page received, oldest first, with the time it arrived and the notifier’s name and email when they gave them.',
    identity: true,
    auth: 'session',
    errors: ['unauthenticated'],
    response: {
      contentType: 'application/json',
      schema: object({ notices: { type: 'array', items: noticeSchema } }),
    },
    handle: async (context) => {
      const moderation = moderationOf(context);
      const steps = await moderation.noticeSteps();
      return json({
        notices: (await moderation.notices()).map((notice) => ({
          noticeId: notice.id,
          receivedAt: notice.receivedAt,
          kind: notice.kind,
          explanation: notice.explanation,
          items: notice.items,
          location: notice.location,
          notifierName: notice.notifierName,
          notifierEmail: notice.notifierEmail,
          bonaFide: notice.bonaFide,
          ...stepsOf(notice.id, steps),
        })),
      });
    },
  },
  {
    method: 'POST',
    path: '/v1/moderation/notices/{noticeId}/steps',
    sealed: 'only',
    operationId: 'recordNoticeStep',
    reaches: 'moderation',
    summary:
      'Record a step taken on a notice (#912): `acknowledged` (receipt confirmed to the notifier’s address, by hand), `decided` (with the decision and, if an action was taken, its moderation log entry) or `notifier_told`. Each once; never acknowledged or told for a notifier who gave no address; told only once decided. Append-only.',
    identity: true,
    auth: 'session',
    request: object(
      {
        step: { type: 'string', enum: ['acknowledged', 'decided', 'notifier_told'] },
        decision: string,
        logId: integer,
      },
      ['step'],
    ),
    errors: ['unauthenticated', 'validation_failed', 'moderation_not_applicable'],
    response: { contentType: 'none' },
    handle: async (context) =>
      answer(
        await moderationOf(context).recordNoticeStep(
          callerId(context),
          context.params.noticeId ?? '',
          context.json.step,
          context.json.decision,
          context.json.logId,
        ),
        () => noContent(),
      ),
  },
  {
    method: 'GET',
    path: '/v1/moderation/record',
    sealed: 'only',
    operationId: 'getModerationRecord',
    reaches: 'moderation',
    summary:
      'The record of every notice and appeal (#912): received, acknowledged, decided, notifier told, the decision and the log entry of any action. It carries no personal detail of a notifier — only whether they gave a name and an address — and no appellant’s grounds.',
    identity: true,
    auth: 'session',
    errors: ['unauthenticated'],
    response: {
      contentType: 'application/json',
      schema: object({
        notices: {
          type: 'array',
          items: object({
            noticeId: integer,
            receivedAt: integer,
            kind: { type: 'string', enum: ['illegal_content', 'intimate_image'] },
            items: { type: 'array', items: string },
            notifierGaveName: { type: 'boolean' },
            notifierGaveEmail: { type: 'boolean' },
            ...noticeSteps,
          }),
        },
        appeals: {
          type: 'array',
          items: object({
            appealId: integer,
            appellantAthleteId: string,
            statementId: integer,
            filedAt: integer,
            decidedAt: nullableInteger,
            outcome: nullableString,
            decision: nullableString,
            logId: nullableInteger,
            moderatorConflict: { type: ['boolean', 'null'] },
            appellantToldAt: nullableInteger,
          }),
        },
      }),
    },
    handle: async (context) => json(await moderationOf(context).record()),
  },
  {
    method: 'GET',
    path: '/v1/blocks',
    // #1210: phase 2 of ADR 0047 D-7.
    sealed: 'only',
    operationId: 'listBlocks',
    reaches: 'own',
    summary: 'The athletes this athlete has blocked.',
    identity: true,
    auth: 'session',
    errors: ['unauthenticated'],
    response: {
      contentType: 'application/json',
      schema: object({ athleteIds: { type: 'array', items: string } }),
    },
    handle: async (context) =>
      json({ athleteIds: await moderationOf(context).blocks(callerId(context)) }),
  },
  {
    method: 'POST',
    path: '/v1/blocks/{athleteId}',
    // #1210: phase 2 of ADR 0047 D-7.
    sealed: 'only',
    operationId: 'blockAthlete',
    reaches: {
      exempt:
        'blocking must work against anybody, a rider who already blocked you included; it answers 204 whether or not the athlete exists, so it tells nobody about a block',
    },
    summary:
      'Block an athlete: neither of you sees or reaches the other, whoever blocked whom. Answers the same whether or not the athlete exists, and is kept for any well-formed id. An account may hold 1000 blocks.',
    identity: true,
    auth: 'session',
    errors: ['unauthenticated', 'validation_failed'],
    response: { contentType: 'none' },
    handle: async (context) =>
      answer(
        await moderationOf(context).block(callerId(context), context.params.athleteId ?? ''),
        () => noContent(),
      ),
  },
  {
    method: 'DELETE',
    path: '/v1/blocks/{athleteId}',
    // #1210: phase 2 of ADR 0047 D-7.
    sealed: 'only',
    operationId: 'unblockAthlete',
    reaches: {
      exempt:
        'deletes only the caller’s own block row, and answers 204 whether or not there was one',
    },
    summary: 'Remove a block this athlete made. Answers the same whether or not there was one.',
    identity: true,
    auth: 'session',
    errors: ['unauthenticated'],
    response: { contentType: 'none' },
    handle: async (context) => {
      await moderationOf(context).unblock(callerId(context), context.params.athleteId ?? '');
      return noContent();
    },
  },
  {
    method: 'POST',
    path: '/v1/reports',
    // #1210: phase 2 of ADR 0047 D-7.
    sealed: 'only',
    operationId: 'reportAthlete',
    reaches: {
      exempt:
        'a report goes to the moderators, not to the athlete named; a rider may report somebody they blocked, and it answers 204 whether or not the athlete exists',
    },
    summary:
      'Report an athlete to this instance’s moderators, with a reason. Rate-limited per reporter. Answers the same whether or not the athlete exists.',
    identity: true,
    auth: 'session',
    request: object({ athleteId: string, reason: string }),
    errors: ['unauthenticated', 'validation_failed'],
    response: { contentType: 'none' },
    handle: async (context) =>
      answer(
        await moderationOf(context).report(
          callerId(context),
          context.json.athleteId,
          context.json.reason,
        ),
        () => noContent(),
      ),
  },
  {
    method: 'GET',
    path: '/v1/moderation/reports',
    sealed: 'only',
    operationId: 'listOpenReports',
    reaches: 'moderation',
    summary:
      'The moderators’ queue: every report not yet decided, oldest first, and whether this instance names one moderator only, who then decides a report about themselves, declared as their own (#905).',
    identity: true,
    auth: 'session',
    errors: ['unauthenticated'],
    response: {
      contentType: 'application/json',
      schema: object({
        soleModerator: { type: 'boolean' },
        reports: { type: 'array', items: reportSchema },
      }),
    },
    handle: async (context) =>
      json({
        soleModerator: moderationOf(context).soleModerator,
        reports: (await moderationOf(context).openReports()).map((report) => ({
          reportId: report.id,
          reporterAthleteId: report.athleteId,
          targetAthleteId: report.targetAthleteId,
          reason: report.reason,
          createdAt: report.createdAt,
          roomId: report.roomId,
          roomTick: report.roomTick,
          flag: report.flag,
        })),
      }),
  },
  {
    method: 'POST',
    path: '/v1/moderation/reports/{reportId}/dismiss',
    sealed: 'only',
    operationId: 'dismissReport',
    reaches: 'moderation',
    summary:
      'Dismiss a report, with a reason. Written to the moderation log. A report about the caller is refused while another moderator is named, and otherwise logged as `dismiss_own_report`, the reason being their declaration of the conflict (#905).',
    identity: true,
    auth: 'session',
    request: object({ reason: string }),
    errors: ['unauthenticated', 'validation_failed', 'moderation_not_applicable'],
    response: actionResponse,
    handle: async (context) =>
      answer(
        await moderationOf(context).dismiss(
          callerId(context),
          context.params.reportId ?? '',
          context.json.reason,
        ),
        (value) => json(value),
      ),
  },
  {
    method: 'POST',
    path: '/v1/moderation/rooms/{roomId}/athletes/{athleteId}/remove',
    sealed: 'only',
    operationId: 'removeFromRoom',
    reaches: 'moderation',
    summary:
      'Remove an athlete from a room, any room, with a reason, optionally deciding a report (#789): their socket is closed if a worker holds the room, they are refused a ticket for it from then on, and the removal is written to the moderation log with the room.',
    identity: true,
    auth: 'session',
    request: object({ reason: string, reportId: integer }, ['reason']),
    errors: ['unauthenticated', 'validation_failed', 'not_found', 'moderation_not_applicable'],
    response: actionResponse,
    handle: async (context) => {
      const roomId = context.params.roomId ?? '';
      const athleteId = context.params.athleteId ?? '';
      const removed = await moderationOf(context).removeFromRoom(
        callerId(context),
        'moderator',
        roomId,
        athleteId,
        { reason: context.json.reason, reportId: context.json.reportId },
      );
      if (removed.ok) await context.probes?.removeFromRoom?.(roomId, athleteId);
      return answer(removed, (value) => json(value));
    },
  },
  athleteAction(
    'athletes/{athleteId}/suspend',
    'suspendAthlete',
    'suspend',
    'Suspend an account: every one of its keys is refused, its sessions end, and other riders stop seeing it. Nothing it owns is deleted. Written to the moderation log.',
  ),
  athleteAction(
    'athletes/{athleteId}/unsuspend',
    'unsuspendAthlete',
    'unsuspend',
    'Lift a suspension. Written to the moderation log.',
  ),
  athleteAction(
    'athletes/{athleteId}/hide-display-name',
    'hideDisplayName',
    'hide_display_name',
    'Hide an athlete’s display name from other riders until they choose another. Written to the moderation log.',
  ),
  {
    method: 'GET',
    path: '/v1/moderation/registrations',
    sealed: 'only',
    operationId: 'listPendingRegistrations',
    reaches: 'moderation',
    summary:
      'The approval queue (#775): every athlete awaiting a moderator’s decision, oldest first, and whether each has confirmed they are 18 or over.',
    identity: true,
    auth: 'session',
    errors: ['unauthenticated'],
    response: {
      contentType: 'application/json',
      schema: object({
        registrations: {
          type: 'array',
          items: object({
            athleteId: string,
            displayName: string,
            createdAt: integer,
            adultConfirmed: { type: 'boolean' },
          }),
        },
      }),
    },
    handle: async (context) =>
      json({
        registrations: (await moderationOf(context).pendingRegistrations()).map((athlete) => ({
          athleteId: athlete.id,
          displayName: athlete.displayName,
          createdAt: athlete.createdAt,
          adultConfirmed: athlete.adultConfirmedAt !== null,
        })),
      }),
  },
  athleteAction(
    'registrations/{athleteId}/approve',
    'approveRegistration',
    'approve_registration',
    'Approve an account awaiting approval. Written to the moderation log.',
  ),
  athleteAction(
    'registrations/{athleteId}/refuse',
    'refuseRegistration',
    'refuse_registration',
    'Refuse an account awaiting approval: its every key is refused at sign-in from then on. Written to the moderation log.',
  ),
  {
    method: 'POST',
    path: '/v1/moderation/invites',
    sealed: 'only',
    operationId: 'createInvite',
    reaches: 'moderation',
    summary:
      'A single-use invitation, good for seven days, for an instance whose registration is invite-only. Written to the moderation log.',
    identity: true,
    auth: 'session',
    request: object({ reason: string }),
    errors: ['unauthenticated', 'validation_failed'],
    response: {
      contentType: 'application/json',
      schema: object({ inviteCode: string, expiresAt: integer }),
    },
    handle: async (context) => {
      if (context.identity === undefined || context.caller === undefined) {
        throw new Error('moderation route called without identity or caller');
      }
      const outcome = await context.identity.mintInvite(context.caller, context.json.reason);
      return outcome.ok
        ? json(outcome.value)
        : errorResponse(
            outcome.code,
            outcome.fields === undefined ? {} : { fields: outcome.fields },
          );
    },
  },
  {
    method: 'GET',
    path: '/v1/moderation/suspended',
    sealed: 'only',
    operationId: 'listSuspendedAthletes',
    reaches: 'moderation',
    summary:
      'Every suspended account, most recently suspended first (#961): `?limit=` (1–200, default 50) and `?cursor=` from the page before.',
    identity: true,
    auth: 'session',
    errors: ['unauthenticated', 'validation_failed'],
    response: {
      contentType: 'application/json',
      schema: object({
        items: {
          type: 'array',
          items: object({ athleteId: string, displayName: string, suspendedAt: integer }),
        },
        next: nullableString,
      }),
    },
    handle: async (context) =>
      answer(await moderationOf(context).suspended(context.url.searchParams), (page) =>
        json({
          items: page.items.map((athlete) => ({
            athleteId: athlete.id,
            displayName: athlete.displayName,
            suspendedAt: athlete.suspendedAt ?? 0,
          })),
          next: page.next,
        }),
      ),
  },
  {
    method: 'GET',
    path: '/v1/moderation/log',
    sealed: 'only',
    operationId: 'getModerationLog',
    reaches: 'moderation',
    summary:
      'Every moderator action, NEWEST first, a page at a time (#961): `?limit=` (1–200, default 50) and `?cursor=` from the page before, which reaches further back. Append-only.',
    identity: true,
    auth: 'session',
    errors: ['unauthenticated', 'validation_failed'],
    response: {
      contentType: 'application/json',
      schema: object({ entries: { type: 'array', items: logEntrySchema }, next: nullableString }),
    },
    handle: async (context) =>
      answer(await moderationOf(context).logPage(context.url.searchParams), (page) =>
        json({
          entries: page.items.map((entry) => ({
            logId: entry.id,
            action: entry.action,
            actorAthleteId: entry.actorAthleteId,
            targetAthleteId: entry.targetAthleteId,
            reportId: entry.reportId,
            reason: entry.reason,
            at: entry.at,
            roomId: entry.roomId,
          })),
          next: page.next,
        }),
      ),
  },
];
