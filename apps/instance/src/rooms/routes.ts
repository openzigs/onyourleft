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

const EXEMPT_ROOM =
  'a private room’s own members, by its code (ADR 0028 D-6.3); blocking inside a room is room moderation, #789’s (D-6.4)';

export const ROOM_ROUTES: readonly Route[] = [
  {
    method: 'POST',
    path: '/v1/rooms',
    operationId: 'createRoom',
    reaches: 'own',
    summary:
      'Make a PRIVATE room — a group ride or a race — on the caller’s own route, and get its code (#784). The route is the creator’s own GPX, relayed to the members for the room’s lifetime and deleted once it is over. No field makes a room public.',
    identity: true,
    rooms: true,
    auth: 'session',
    request: object({
      kind,
      ridingPosition: position,
      loop: { type: 'boolean' },
      lengthMetres: number,
      grades: { type: 'array', items: { type: 'array', items: number } },
      gpx: string,
    }),
    errors: ['unauthenticated', 'validation_failed', 'rate_limited'],
    response: {
      contentType: 'application/json',
      schema: object({ roomId: string, code: string, routeSha256: string }),
    },
    handle: async (context) =>
      answer(await roomsOf(context).create(callerOf(context), context.json)),
  },
  {
    method: 'POST',
    path: '/v1/rooms/join',
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
        loop: { type: 'boolean' },
        routeSha256: string,
      }),
    },
    handle: async (context) =>
      answer(await roomsOf(context).join(callerOf(context), context.json, context.client)),
  },
  {
    method: 'GET',
    path: '/v1/rooms/{roomId}/route',
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
];
