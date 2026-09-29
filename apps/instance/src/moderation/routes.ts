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
import { json, noContent, type Route, type RouteContext, type Schema } from '../route-kit.ts';
import type { Moderation, ModerationResult } from './moderation.ts';

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

const actionResponse: Route['response'] = {
  contentType: 'application/json',
  schema: object({ logId: integer }),
};

/** One moderator action on an athlete. */
function athleteAction(
  path: string,
  operationId: string,
  action: 'suspend' | 'unsuspend' | 'hide_display_name',
  summary: string,
): Route {
  return {
    method: 'POST',
    path: `/v1/moderation/athletes/{athleteId}/${path}`,
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
      'Block an athlete: neither of you sees or reaches the other, whoever blocked whom. Answers the same whether or not the athlete exists.',
    identity: true,
    auth: 'session',
    errors: ['unauthenticated'],
    response: { contentType: 'none' },
    handle: async (context) => {
      await moderationOf(context).block(callerId(context), context.params.athleteId ?? '');
      return noContent();
    },
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
    'suspend',
    'suspendAthlete',
    'suspend',
    'Suspend an account: every one of its keys is refused, its sessions end, and other riders stop seeing it. Nothing it owns is deleted. Written to the moderation log.',
  ),
  athleteAction(
    'unsuspend',
    'unsuspendAthlete',
    'unsuspend',
    'Lift a suspension. Written to the moderation log.',
  ),
  athleteAction(
    'hide-display-name',
    'hideDisplayName',
    'hide_display_name',
    'Hide an athlete’s display name from other riders until they choose another. Written to the moderation log.',
  ),
  {
    method: 'GET',
    path: '/v1/moderation/log',
    operationId: 'getModerationLog',
    reaches: 'moderation',
    summary: 'Every moderator action, oldest first. Append-only.',
    identity: true,
    auth: 'session',
    errors: ['unauthenticated'],
    response: {
      contentType: 'application/json',
      schema: object({ entries: { type: 'array', items: logEntrySchema } }),
    },
    handle: async (context) =>
      json({
        entries: (await moderationOf(context).log()).map((entry) => ({
          logId: entry.id,
          action: entry.action,
          actorAthleteId: entry.actorAthleteId,
          targetAthleteId: entry.targetAthleteId,
          reportId: entry.reportId,
          reason: entry.reason,
          at: entry.at,
        })),
      }),
  },
];
