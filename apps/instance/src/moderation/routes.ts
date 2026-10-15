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
 * is not the owner or the deputy before the route is called.
 */

import { errorResponse } from '../errors.ts';
import { pageResponse } from '../html.ts';
import { json, noContent, type Route, type RouteContext, type Schema } from '../route-kit.ts';
import type { AthleteAction, Moderation, ModerationResult } from './moderation.ts';
import { NOTICE_PAGE_PATH, noticePage } from './notices.ts';

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
  reporterAthleteId: string,
  targetAthleteId: string,
  reason: string,
  createdAt: integer,
});

const logEntrySchema = object({
  logId: integer,
  action: string,
  actorAthleteId: string,
  targetAthleteId: nullableString,
  reportId: nullableInteger,
  reason: string,
  at: integer,
});

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
    request: object({ reason: string, reportId: integer }, ['reason']),
    errors: ['unauthenticated', 'validation_failed', 'moderation_not_applicable'],
    response: actionResponse,
    handle: async (context) =>
      answer(
        await moderationOf(context).act(callerId(context), action, context.params.athleteId ?? '', {
          reason: context.json.reason,
          reportId: context.json.reportId,
        }),
        (value) => json(value),
      ),
  };
}

export const MODERATION_ROUTES: readonly Route[] = [
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
    handle: async (context) =>
      json({
        notices: (await moderationOf(context).notices()).map((notice) => ({
          noticeId: notice.id,
          receivedAt: notice.receivedAt,
          kind: notice.kind,
          explanation: notice.explanation,
          items: notice.items,
          location: notice.location,
          notifierName: notice.notifierName,
          notifierEmail: notice.notifierEmail,
          bonaFide: notice.bonaFide,
        })),
      }),
  },
  {
    method: 'GET',
    path: '/v1/blocks',
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
    summary: 'The moderators’ queue: every report not yet decided, oldest first.',
    identity: true,
    auth: 'session',
    errors: ['unauthenticated'],
    response: {
      contentType: 'application/json',
      schema: object({ reports: { type: 'array', items: reportSchema } }),
    },
    handle: async (context) =>
      json({
        reports: (await moderationOf(context).openReports()).map((report) => ({
          reportId: report.id,
          reporterAthleteId: report.athleteId,
          targetAthleteId: report.targetAthleteId,
          reason: report.reason,
          createdAt: report.createdAt,
        })),
      }),
  },
  {
    method: 'POST',
    path: '/v1/moderation/reports/{reportId}/dismiss',
    sealed: 'only',
    operationId: 'dismissReport',
    reaches: 'moderation',
    summary: 'Dismiss a report, with a reason. Written to the moderation log.',
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
          })),
          next: page.next,
        }),
      ),
  },
];
