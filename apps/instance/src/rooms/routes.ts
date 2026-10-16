// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The rooms routes (#784, #785), as entries in the one route table
 * (`routes.ts`). The rules are `rooms.ts`'s; a route turns an outcome into a
 * response and does nothing else.
 *
 * ⚠️ **A room code travels in a POST body and nowhere else** — never a path or
 * a query, which a proxy or a browser's history may keep — and the request
 * log names the route's PATTERN, never a body (`log.ts`). `rooms.test.ts`
 * reads every line for it.
 */

import { errorResponse } from '../errors.ts';
import { json, type Route, type RouteContext, type Schema } from '../route-kit.ts';
import type { Outcome } from '../auth/identity.ts';
import { ROOM_REPORT_REASONS, type ModerationResult } from '../moderation/moderation.ts';
import type { Rooms } from './rooms.ts';

function roomsOf(context: RouteContext): Rooms {
  // The handler answers `unavailable` before calling a `rooms` route without one.
  if (context.rooms === undefined) throw new Error('rooms route called without rooms');
  return context.rooms;
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
const number: Schema = { type: 'number' };
const nullableNumber: Schema = { type: ['number', 'null'] };
const nullableInteger: Schema = { type: ['integer', 'null'] };
const kind: Schema = { type: 'string', enum: ['group', 'race'] };
const position: Schema = { type: 'string', enum: ['upright', 'hoods', 'drops'] };

function object(
  properties: Readonly<Record<string, Schema>>,
  required: readonly string[] = Object.keys(properties),
): Schema {
  return { type: 'object', properties, required, additionalProperties: false };
}

function moderationAnswer<T>(result: ModerationResult<T>, ok: (value: T) => Response): Response {
  if (result.ok) return ok(result.value);
  return errorResponse(result.code, result.fields === undefined ? {} : { fields: result.fields });
}

/** A seat number as a room's frames carry it. */
function riderIdOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/**
 * The room's own answer to who sits in `riderId`'s seat, for a caller who
 * may be told (#789): `undefined` — `not_found` — for a room they are not in,
 * one no worker holds, or an empty seat.
 */
async function seatFor(context: RouteContext, riderId: unknown) {
  const roomId = context.params.roomId ?? '';
  const standing = await roomsOf(context).standing(callerOf(context), roomId);
  const seat = riderIdOf(riderId);
  if (standing === undefined || seat === undefined || context.probes?.seatOf === undefined) {
    return undefined;
  }
  const found = await context.probes.seatOf(roomId, seat);
  return found === undefined ? undefined : { roomId, standing, seat: found };
}

const EXEMPT_ROOM =
  'a private room’s own members, by its code (ADR 0028 D-6.3); blocking inside a room is room moderation, #789’s (D-6.4)';

export const ROOM_ROUTES: readonly Route[] = [
  {
    method: 'POST',
    path: '/v1/rooms',
    // #1210: phase 2 of ADR 0047 D-7.
    sealed: 'only',
    operationId: 'createRoom',
    reaches: 'own',
    summary:
      'Make a room — a group ride or a race — on the caller’s own route (#784). PRIVATE unless `visibility` is `public`: a private room answers its code, to share; a public one (#788) has a `startsAt` within the next 12 hours, no code, and is listed for eligible athletes — only where the operator turned public rooms on, by an eligible athlete, at most 3 a day. The route is the creator’s own GPX, relayed to the members for the room’s lifetime and deleted once it is over.',
    identity: true,
    rooms: true,
    auth: 'session',
    // #787: `drafting` is the one optional field — absent is on, the
    // owner's ruling of 2026-09-30, and it is fixed for the room's life.
    request: object(
      {
        kind,
        ridingPosition: position,
        drafting: { type: 'boolean' },
        loop: { type: 'boolean' },
        lengthMetres: number,
        grades: { type: 'array', items: { type: 'array', items: number } },
        gpx: string,
        visibility: { type: 'string', enum: ['private', 'public'] },
        startsAt: { type: 'integer' },
      },
      ['kind', 'ridingPosition', 'loop', 'lengthMetres', 'grades', 'gpx'],
    ),
    errors: ['unauthenticated', 'validation_failed', 'not_eligible', 'rate_limited'],
    response: {
      contentType: 'application/json',
      schema: object({ roomId: string, code: string, routeSha256: string }, [
        'roomId',
        'routeSha256',
      ]),
    },
    handle: async (context) =>
      answer(await roomsOf(context).create(callerOf(context), context.json)),
  },
  {
    method: 'POST',
    path: '/v1/rooms/join',
    // #1210: phase 2 of ADR 0047 D-7.
    sealed: 'only',
    operationId: 'joinRoom',
    reaches: { exempt: EXEMPT_ROOM },
    summary:
      'Join a private room by its code (#784). Rate-limited per athlete and per address, right or wrong; a code that is wrong, unknown or for a room that is over is `not_found`, the same answer every time.',
    identity: true,
    rooms: true,
    auth: 'session',
    request: object({ code: string }),
    errors: ['unauthenticated', 'not_found', 'rate_limited'],
    response: {
      contentType: 'application/json',
      schema: object({
        roomId: string,
        kind,
        ridingPosition: position,
        drafting: { type: 'boolean' },
        loop: { type: 'boolean' },
        routeSha256: string,
      }),
    },
    handle: async (context) =>
      answer(await roomsOf(context).join(callerOf(context), context.json, context.client)),
  },
  {
    method: 'GET',
    path: '/v1/rooms/public',
    sealed: 'only',
    operationId: 'listPublicRooms',
    reaches: {
      exempt:
        'lists rooms riders made public, naming no athlete; a room holding anybody the caller blocks, or who blocks them, is left out (#788)',
    },
    summary:
      'The open public rooms (#788), for an eligible athlete only — `not_eligible` otherwise, and `not_found` where the operator has not turned public rooms on. Ordered by the start each creator gave, then when it was made, then its id, and by nothing else: nothing is featured, recommended or pinned (ADR 0028 D-7.1). Each says its course’s length and climb, never its route.',
    identity: true,
    rooms: true,
    auth: 'session',
    errors: ['unauthenticated', 'not_found', 'not_eligible'],
    response: {
      contentType: 'application/json',
      schema: object({
        rooms: {
          type: 'array',
          items: object({
            roomId: string,
            kind,
            ridingPosition: position,
            drafting: { type: 'boolean' },
            loop: { type: 'boolean' },
            startsAt: { type: 'integer' },
            lengthMetres: number,
            climbMetres: number,
          }),
        },
      }),
    },
    handle: async (context) => answer(await roomsOf(context).listPublic(callerOf(context))),
  },
  {
    method: 'POST',
    path: '/v1/rooms/{roomId}/join',
    sealed: 'only',
    operationId: 'joinPublicRoom',
    reaches: {
      exempt:
        'joins a public room an eligible athlete was listed, by its id; refused as `not_found` where anybody in it blocks the caller or is blocked by them (#788)',
    },
    summary:
      'Join a public room from the listing (#788), for an eligible athlete only — `not_eligible` otherwise, `not_found` where the operator has not turned public rooms on, and `not_found` for a room that is not an open public one, a race that has started, a hidden room, or one holding anybody the caller blocks or who blocks them.',
    identity: true,
    rooms: true,
    auth: 'session',
    errors: ['unauthenticated', 'not_found', 'not_eligible'],
    response: {
      contentType: 'application/json',
      schema: object({
        roomId: string,
        kind,
        ridingPosition: position,
        drafting: { type: 'boolean' },
        loop: { type: 'boolean' },
        routeSha256: string,
      }),
    },
    handle: async (context) =>
      answer(await roomsOf(context).joinPublic(callerOf(context), context.params.roomId ?? '')),
  },
  {
    method: 'GET',
    path: '/v1/rooms/{roomId}/route',
    // #1210: phase 2 of ADR 0047 D-7.
    sealed: 'only',
    operationId: 'getRoomRoute',
    reaches: { exempt: EXEMPT_ROOM },
    summary:
      'A private room’s route, exactly as its creator’s app sent it, for its members while it is open (#784). The client checks the bytes against the room’s `routeRef`.',
    identity: true,
    rooms: true,
    auth: 'session',
    errors: ['unauthenticated', 'not_found'],
    response: { contentType: 'application/json', schema: object({ sha256: string, gpx: string }) },
    handle: async (context) =>
      answer(await roomsOf(context).route(callerOf(context), context.params.roomId ?? '')),
  },
  {
    method: 'GET',
    path: '/v1/rooms/{roomId}/results',
    // #1210: phase 2 of ADR 0047 D-7.
    sealed: 'only',
    operationId: 'getRoomResults',
    reaches: { exempt: EXEMPT_ROOM },
    summary:
      'A race’s result, for its riders only (#785, ruling Q2), and only once the room has said the race is over — `not_found` while it runs (ADR 0028 D-7.7): finishers by place, then those who did not finish. Per rider, a display name — or none, for a rider who erased their account or whom the caller may not see — a time, and power-to-weight: never watts (ADR 0028’s 2026-09-22 amendment). Every plausibility flag is shown to every rider, by the duration it was raised for.',
    identity: true,
    rooms: true,
    auth: 'session',
    errors: ['unauthenticated', 'not_found'],
    response: {
      contentType: 'application/json',
      schema: object({
        rows: {
          type: 'array',
          items: object({
            place: nullableInteger,
            displayName: { type: ['string', 'null'] },
            you: { type: 'boolean' },
            finishMs: nullableNumber,
            wattsPerKilogram: nullableNumber,
            flags: {
              type: 'array',
              items: object({ durationSeconds: { type: 'integer' }, overWattsPerKilogram: number }),
            },
          }),
        },
      }),
    },
    handle: async (context) =>
      answer(await roomsOf(context).results(callerOf(context), context.params.roomId ?? '')),
  },
  {
    method: 'POST',
    path: '/v1/rooms/{roomId}/reports',
    sealed: 'only',
    operationId: 'reportInRoom',
    reaches: {
      exempt:
        'names a SEAT in a room the caller is in, never an athlete; the room says who sits there, and the report goes to the moderators, never to the rider (#789)',
    },
    summary:
      'Report another rider from inside a room, by their seat, with one of a short fixed list of reasons (#789). Filed for the moderators with the room and its tick; never a screenshot, never a position. Counted against the same hourly allowance as any report.',
    identity: true,
    rooms: true,
    auth: 'session',
    request: object({
      riderId: { type: 'integer' },
      reason: { type: 'string', enum: Object.keys(ROOM_REPORT_REASONS) },
    }),
    errors: ['unauthenticated', 'validation_failed', 'not_found', 'rate_limited'],
    response: { contentType: 'none' },
    handle: async (context) => {
      const found = await seatFor(context, context.json.riderId);
      if (found === undefined) return errorResponse('not_found');
      const moderation = context.identity?.moderation;
      if (moderation === undefined) return errorResponse('unavailable');
      return moderationAnswer(
        await moderation.reportInRoom(
          callerOf(context).athleteId,
          found.roomId,
          found.seat,
          context.json.reason,
        ),
        () => new Response(null, { status: 204 }),
      );
    },
  },
  {
    method: 'POST',
    path: '/v1/rooms/{roomId}/remove',
    sealed: 'only',
    operationId: 'removeFromMyRoom',
    reaches: {
      exempt:
        'names a SEAT in the caller’s OWN private room, never an athlete; only the room’s host may, and the room says who sits there (#789)',
    },
    summary:
      'The host of a private room removes a rider from it, by their seat, with a reason (#789): their socket is closed, they are refused a ticket for it from then on, and the removal is written to the moderation log. `not_found` for anybody but the room’s host.',
    identity: true,
    rooms: true,
    auth: 'session',
    request: object({ riderId: { type: 'integer' }, reason: string }),
    errors: ['unauthenticated', 'validation_failed', 'not_found', 'moderation_not_applicable'],
    response: {
      contentType: 'application/json',
      schema: object({ logId: { type: 'integer' } }),
    },
    handle: async (context) => {
      const found = await seatFor(context, context.json.riderId);
      if (found === undefined || found.standing !== 'host') return errorResponse('not_found');
      const caller = callerOf(context);
      if (found.seat.athleteId === caller.athleteId) {
        return errorResponse('validation_failed', {
          fields: [{ field: 'riderId', problem: 'must be another rider' }],
        });
      }
      const moderation = context.identity?.moderation;
      if (moderation === undefined) return errorResponse('unavailable');
      const removed = await moderation.removeFromRoom(
        caller.athleteId,
        'host',
        found.roomId,
        found.seat.athleteId,
        { reason: context.json.reason },
      );
      if (removed.ok) await context.probes?.removeFromRoom?.(found.roomId, found.seat.athleteId);
      return moderationAnswer(removed, (value) => json(value));
    },
  },
];
