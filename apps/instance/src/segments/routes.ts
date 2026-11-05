// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The segment and leaderboard routes (#68), as entries in the one route table
 * (`routes.ts`). The rules are `segments.ts`'s.
 *
 * Every one needs a signed-in device and the instance's segments; every one is
 * **sealed-only from the first** (ADR 0047 D-7, its amendment of 2026-11-05):
 * a segment's path is a stretch of somebody's ride, and a board names riders.
 * `sealed/phase-two.ts` lists them.
 *
 * ## Whom each reaches (#83's choke point)
 *
 * Publishing, withdrawing and sharing efforts are the caller's own: `own`. The
 * list, one segment and a board reach OTHER athletes — the segments they
 * published and the efforts they shared — and declare `exempt`, because no
 * athlete is in their path: the choke point's rule is applied INSIDE the read,
 * set-wise (`sql-store.ts` §`seenBy`), so a rider the caller may not see is
 * left out rather than refused. `moderation/choke-point.test.ts` says what
 * holds each, and `segments/leaderboard.test.ts` holds it.
 *
 * ⚠️ **Every response carries `cache-control: no-store`**, for `sync/routes.ts`'s
 * reason: the handler sets it on every response (`handler.ts` §`ALWAYS`).
 */

import { errorResponse } from '../errors.ts';
import { json, noContent, type Route, type RouteContext, type Schema } from '../route-kit.ts';
import type { Outcome } from '../auth/identity.ts';
import { BOARD_PERIODS, BOARD_SCOPES, type Segments } from './segments.ts';

function segmentsOf(context: RouteContext): Segments {
  // The handler answers `unavailable` before calling a `segments` route without them.
  if (context.segments === undefined) throw new Error('segments route called without segments');
  return context.segments;
}

function callerOf(context: RouteContext): NonNullable<RouteContext['caller']> {
  // The handler answers `unauthenticated` before calling an `auth` route without one.
  if (context.caller === undefined) throw new Error('session route called without a caller');
  return context.caller;
}

function answer<T>(outcome: Outcome<T>): Response {
  if (outcome.ok) return json(outcome.value);
  return errorResponse(
    outcome.code,
    outcome.fields === undefined ? {} : { fields: outcome.fields },
  );
}

const string: Schema = { type: 'string' };
const integer: Schema = { type: 'integer' };
const number: Schema = { type: 'number' };
const boolean: Schema = { type: 'boolean' };

function object(
  properties: Readonly<Record<string, Schema>>,
  required: readonly string[] = Object.keys(properties),
): Schema {
  return { type: 'object', properties, required, additionalProperties: false };
}

const SESSION = { identity: true, auth: 'session', segments: true, sealed: 'only' } as const;

const sport: Schema = { type: 'string', enum: ['ride', 'run'] };

/** `@onyourleft/domain` §`PublishedSegmentDefinition`. */
const definitionSchema: Schema = object({
  name: string,
  sport,
  geometry: { type: 'array', items: { type: 'array', items: number } },
  endpointRadiusMetres: number,
  bearingToleranceDegrees: number,
});

const summaryProperties = {
  segmentId: string,
  name: string,
  sport,
  distanceMetres: number,
  createdAt: integer,
  yours: boolean,
};

const LISTED =
  'segments are published to every rider on the instance; the choke point’s rule is applied to their publishers inside the read (`sql-store.ts` §`seenBy`), so one published by a rider the caller may not see is left out';

export const SEGMENT_ROUTES: readonly Route[] = [
  {
    method: 'POST',
    path: '/v1/segments',
    operationId: 'publishSegment',
    reaches: 'own',
    summary:
      'Publish one of your segments to every rider on this instance: its name, sport, path, endpoint radius and bearing tolerance (#68). Its id is a digest of that definition, so the same one sent again is the same segment. The instance measures the distance itself. Your device publishes only a segment none of your privacy zones touches at either end.',
    ...SESSION,
    request: object({ segment: definitionSchema }),
    errors: ['unauthenticated', 'validation_failed'],
    response: {
      contentType: 'application/json',
      schema: object({ segmentId: string, createdAt: integer, published: boolean }),
    },
    handle: async (context) =>
      answer(await segmentsOf(context).publish(callerOf(context), context.json)),
  },
  {
    method: 'GET',
    path: '/v1/segments',
    operationId: 'listSegments',
    reaches: { exempt: LISTED },
    summary:
      'The segments published on this instance, newest first: `?limit=` (1–200, default 50) and `?cursor=` from the page before. A name, sport, distance and when it was published — never its path or who published it.',
    ...SESSION,
    errors: ['unauthenticated', 'validation_failed'],
    response: {
      contentType: 'application/json',
      schema: object({
        items: { type: 'array', items: object(summaryProperties) },
        next: { type: ['string', 'null'] },
      }),
    },
    handle: async (context) =>
      answer(await segmentsOf(context).list(callerOf(context), context.url.searchParams)),
  },
  {
    method: 'GET',
    path: '/v1/segments/{segmentId}',
    operationId: 'getSegment',
    reaches: { exempt: LISTED },
    summary:
      'One published segment with its definition, path included, for your device to match your own rides against. Never who published it.',
    ...SESSION,
    errors: ['unauthenticated', 'not_found'],
    response: {
      contentType: 'application/json',
      schema: object({ ...summaryProperties, definition: definitionSchema }),
    },
    handle: async (context) =>
      answer(await segmentsOf(context).get(callerOf(context), context.params.segmentId ?? '')),
  },
  {
    method: 'DELETE',
    path: '/v1/segments/{segmentId}',
    operationId: 'withdrawSegment',
    reaches: 'own',
    summary:
      'Withdraw a segment you published, and every effort any rider shared on it. Their own copies stay on their devices. `not_found` for one you did not publish.',
    ...SESSION,
    errors: ['unauthenticated', 'not_found'],
    response: { contentType: 'none' },
    handle: async (context) => {
      const outcome = await segmentsOf(context).withdraw(
        callerOf(context),
        context.params.segmentId ?? '',
      );
      return outcome.ok ? noContent() : answer(outcome);
    },
  },
  {
    method: 'POST',
    path: '/v1/segments/{segmentId}/efforts/{content}',
    operationId: 'shareSegmentEfforts',
    reaches: 'own',
    summary:
      'Share your efforts on a published segment from one of your synced rides, by the SHA-256 of its file, replacing what you shared from that ride before; none withdraws them. Each is its start, its elapsed time and its visibility as your device decided it: `private-match` — an end in one of your privacy zones — is kept for your own board and never ranked on anybody else’s. Each must lie within the ride’s recorded time.',
    ...SESSION,
    request: object({
      efforts: {
        type: 'array',
        items: object({
          startedAt: integer,
          elapsedSeconds: number,
          visibility: { type: 'string', enum: ['public', 'private-match'] },
        }),
      },
    }),
    errors: ['unauthenticated', 'validation_failed', 'not_found'],
    response: { contentType: 'application/json', schema: object({ efforts: integer }) },
    handle: async (context) =>
      answer(
        await segmentsOf(context).shareEfforts(
          callerOf(context),
          context.params.segmentId ?? '',
          context.params.content ?? '',
          context.json,
        ),
      ),
  },
  {
    method: 'GET',
    path: '/v1/segments/{segmentId}/leaderboard',
    operationId: 'getSegmentLeaderboard',
    reaches: {
      exempt:
        'a board ranks other riders’ shared efforts: each row’s athlete is held to the choke point’s rule inside the one read (`sql-store.ts` §`seenBy`), with the ride and the effort both public, so a rider the caller may not see is left out rather than refused',
    },
    summary: `A board on a published segment: ?scope= (${BOARD_SCOPES.join(', ')}; default instance) and ?period= (${BOARD_PERIODS.join(', ')}; default all-time). THIS instance only — never every instance. One row per rider, their best, fastest first by elapsed time, at most 50: a rank, a display name, whether it is yours, and the time. Never a position, a date or a ride. A rolling window starts no earlier than the segment’s publication here.`,
    ...SESSION,
    errors: ['unauthenticated', 'validation_failed', 'not_found'],
    response: {
      contentType: 'application/json',
      schema: object({
        segment: object(summaryProperties),
        scope: { type: 'string', enum: [...BOARD_SCOPES] },
        period: { type: 'string', enum: [...BOARD_PERIODS] },
        rankedBy: { type: 'string', enum: ['elapsed'] },
        rows: {
          type: 'array',
          items: object({ rank: integer, rider: string, yours: boolean, elapsedSeconds: number }),
        },
      }),
    },
    handle: async (context) =>
      answer(
        await segmentsOf(context).board(
          callerOf(context),
          context.params.segmentId ?? '',
          context.url.searchParams,
        ),
      ),
  },
];
