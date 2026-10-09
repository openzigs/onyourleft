// SPDX-License-Identifier: AGPL-3.0-or-later

import { IDENTITY_ROUTES } from './auth/routes.ts';
import { INSTANCE_KEY_ROUTES } from './keys/routes.ts';
import { errorResponse } from './errors.ts';
import { MODERATION_ROUTES } from './moderation/routes.ts';
import { assessReadiness } from './readiness.ts';
import { json, type Route, type Schema } from './route-kit.ts';
import { HISTORY_ROUTES } from './history/routes.ts';
import { ROOM_ROUTES } from './rooms/routes.ts';
import { SEALED_ROUTES } from './sealed/routes.ts';
import { SYNC_ROUTES } from './sync/routes.ts';

/**
 * The instance's routes, as ONE table the handler dispatches on and the
 * specification is generated from (#36).
 *
 * That is what keeps the specification from drifting: a route cannot be served
 * without an entry here, and an entry here cannot be left out of
 * `openapi.json`, because `openapi.ts` writes the document from this list and
 * `openapi.test.ts` fails when the committed file is not what it writes. What a
 * shared table cannot hold on its own — that a route's body is the shape its
 * entry declares — `openapi.test.ts` holds by calling every route through the
 * real listener and checking the body against the declared schema.
 *
 * The identity routes (#772, #773, #774) are `auth/routes.ts`'s, the
 * moderation routes (#83, #775) `moderation/routes.ts`'s and the sync routes
 * (#37, #38, #776, #35) `sync/routes.ts`'s, appended here, so there is still
 * one table.
 *
 * ## Versioning
 *
 * The five below are the instance's own **metadata** and are not versioned: what
 * is running, what it is called (#777), where its source is, what its API is,
 * and what third-party software it includes. They only ever gain fields. The API a client syncs
 * through lives under `/v1/` from its first route (#776), and a breaking change
 * to it is `/v2/` served beside `/v1/`, never an edit — `docs/architecture.md`
 * §"The instance" records the rule.
 */

export type { Route, RouteContext, Schema } from './route-kit.ts';
export { json } from './route-kit.ts';

const commitSchema: Schema = { type: ['string', 'null'] };

export const ROUTES: readonly Route[] = [
  {
    method: 'GET',
    path: '/health',
    operationId: 'getHealth',
    reaches: 'own',
    summary: 'Whether the instance is answering, and which build it is.',
    response: {
      contentType: 'application/json',
      schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ok'] },
          version: { type: 'string' },
          commit: commitSchema,
        },
        required: ['status', 'version', 'commit'],
        additionalProperties: false,
      },
    },
    handle: ({ version, config }) => json({ status: 'ok', version, commit: config.commit }),
  },
  {
    method: 'GET',
    path: '/instance',
    operationId: 'getInstance',
    reaches: 'own',
    summary:
      'What the operator calls this instance, or null — the name a rider’s app shows once connected (#777).',
    response: {
      contentType: 'application/json',
      schema: {
        type: 'object',
        properties: { name: { type: ['string', 'null'] } },
        required: ['name'],
        additionalProperties: false,
      },
    },
    handle: ({ config }) => json({ name: config.name }),
  },
  {
    method: 'GET',
    path: '/source',
    operationId: 'getSource',
    reaches: 'own',
    summary:
      'Where the exact source of the running build is — the offer AGPL-3.0 §13 requires (ADR 0036 D-6).',
    response: {
      contentType: 'application/json',
      schema: {
        type: 'object',
        properties: {
          url: { type: 'string', format: 'uri' },
          commit: commitSchema,
          licence: { type: 'string', enum: ['AGPL-3.0-or-later'] },
        },
        required: ['url', 'commit', 'licence'],
        additionalProperties: false,
      },
    },
    handle: ({ config }) =>
      json({ url: config.sourceUrl, commit: config.commit, licence: 'AGPL-3.0-or-later' }),
  },
  {
    method: 'GET',
    path: '/openapi.json',
    operationId: 'getSpecification',
    reaches: 'own',
    summary: 'This specification.',
    response: {
      contentType: 'application/json',
      schema: { type: 'object', description: 'An OpenAPI 3.1 document.' },
    },
    handle: ({ specification }) => json(specification),
  },
  {
    method: 'GET',
    path: '/licences/third-party.txt',
    operationId: 'getThirdPartyNotices',
    reaches: 'own',
    summary:
      'The licence and notice of every third-party package this instance includes, generated and gated by `check:notices`.',
    response: { contentType: 'text/plain' },
    handle: ({ notices }) =>
      new Response(notices, { headers: { 'content-type': 'text/plain; charset=utf-8' } }),
  },
  {
    method: 'GET',
    path: '/ready',
    operationId: 'getReadiness',
    reaches: 'own',
    summary:
      'Whether riders may be sent here yet: the database answers, its migrations are at head, and every room worker is alive (#791). 503 with the same body when not.',
    response: {
      contentType: 'application/json',
      schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ready', 'not_ready'] },
          checks: {
            type: 'object',
            properties: {
              database: { type: 'boolean' },
              migrations: {
                type: 'string',
                enum: ['at-head', 'migrating', 'behind', 'ahead', 'unknown'],
              },
              rooms: { type: 'boolean' },
            },
            required: ['database', 'migrations', 'rooms'],
            additionalProperties: false,
          },
        },
        required: ['status', 'checks'],
        additionalProperties: false,
      },
    },
    handle: async ({ probes }) => {
      const readiness =
        probes === undefined
          ? await assessReadiness({
              database: () => Promise.resolve(false),
              migrations: () => Promise.reject(new Error('no instance')),
              rooms: () => false,
            })
          : await probes.ready();
      return json(
        { status: readiness.ready ? 'ready' : 'not_ready', checks: readiness.checks },
        readiness.ready ? 200 : 503,
      );
    },
  },
  {
    method: 'GET',
    path: '/metrics',
    operationId: 'getMetrics',
    reaches: 'own',
    summary:
      'Rooms, riders, tick lateness and refusals in the Prometheus text format — only when the operator turned it on (OYL_INSTANCE_METRICS), and only for a request carrying the operator’s token as `Authorization: Bearer`; `not_found` otherwise. No label is an athlete, a name, a room or a coordinate.',
    errors: ['not_found'],
    response: { contentType: 'text/plain' },
    handle: async ({ probes, request }) => {
      if (probes?.metrics === undefined) return errorResponse('not_found');
      // A request without the token is told nothing, not even that there is
      // an endpoint: `not_found`, as when the operator has it switched off.
      const document = await probes.metrics(request.headers.get('authorization'));
      if (document === undefined) return errorResponse('not_found');
      return new Response(document, {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    },
  },
  ...INSTANCE_KEY_ROUTES,
  ...SEALED_ROUTES,
  ...IDENTITY_ROUTES,
  ...MODERATION_ROUTES,
  ...SYNC_ROUTES,
  ...HISTORY_ROUTES,
  ...ROOM_ROUTES,
  {
    method: 'POST',
    path: '/v1/rooms/{roomId}/start',
    operationId: 'startRoom',
    reaches: {
      exempt:
        'a race’s riders share its countdown, and blocking inside a room is #789’s (ADR 0028 D-6.4)',
    },
    summary:
      'Starts a race’s countdown, for the athlete who made the room, seated and connected in it — the owner’s ruling of 2026-09-30 (a room an operator opened has no creator, and any athlete seated and connected in it may start it). `not_found` for anybody else, and for a race that is not waiting.',
    identity: true,
    auth: 'session',
    errors: ['unauthenticated', 'not_found', 'unavailable'],
    response: {
      contentType: 'application/json',
      schema: {
        type: 'object',
        properties: { status: { type: 'string', enum: ['started'] } },
        required: ['status'],
        additionalProperties: false,
      },
    },
    handle: async ({ probes, params, caller }) => {
      if (probes?.startRoom === undefined || caller === undefined) {
        return errorResponse('unavailable');
      }
      const outcome = await probes.startRoom(params.roomId ?? '', caller.athleteId);
      return outcome === 'started' ? json({ status: 'started' }) : errorResponse('not_found');
    },
  },
];
