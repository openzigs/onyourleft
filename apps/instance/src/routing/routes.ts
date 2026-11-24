// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The route planner's two routes (#2008): roads between a rider's waypoints,
 * and the heights along a line. `routing/routing.ts` says what they keep
 * (nothing) and how often a rider may ask; `routing/valhalla.ts` says how the
 * engine is asked.
 *
 * `auth: 'session'` and `reaches: 'own'`: a signed-in rider's own question,
 * naming no athlete.
 *
 * ⚠️ **Sealed, on every instance**, as the side camera's picture route is
 * (`camera/routes.ts`): a request carries the places a rider means to ride,
 * which may be where they live. Each is marked `sealed: 'only'` and listed in
 * `sealed/phase-one.ts`, and the handler below answers `sealed_required` to
 * anything that did not arrive inside `POST /v1/sealed` — on an instance with
 * no keys too, which therefore offers no routing at all. Whatever stands
 * between the rider and the instance reads none of it.
 */

import { errorResponse } from '../errors.ts';
import { json, type Route, type Schema } from '../route-kit.ts';
import { MAXIMUM_HEIGHT_POINTS, MAXIMUM_WAYPOINTS } from './routing.ts';

export const ROUTING_ROUTE_PATH = '/v1/routing/route';
export const ROUTING_HEIGHTS_PATH = '/v1/routing/heights';

/** A request's points: `{ latitude, longitude }`, which the app's privacy walk can see. */
const POINTS: Schema = {
  type: 'array',
  items: {
    type: 'object',
    properties: { latitude: { type: 'number' }, longitude: { type: 'number' } },
    required: ['latitude', 'longitude'],
    additionalProperties: false,
  },
};

/** An answer's shape: [latitude, longitude] pairs, half the size, back to the rider's own device. */
const PAIRS: Schema = { type: 'array', items: { type: 'array', items: { type: 'number' } } };

const ROUTING_ERRORS = [
  'unauthenticated',
  'validation_failed',
  'sealed_required',
  'rate_limited',
  'routing_off',
  'routing_failed',
  'unavailable',
] as const;

export const ROUTING_ROUTES: readonly Route[] = [
  {
    method: 'POST',
    path: ROUTING_ROUTE_PATH,
    sealed: 'only',
    operationId: 'routeBetweenWaypoints',
    reaches: 'own',
    summary: `Roads between your waypoints, by bicycle (#2008). \`waypoints\` is a list of 2 to ${String(MAXIMUM_WAYPOINTS)} \`{ latitude, longitude }\` points in degrees; \`preferences\` names a \`bicycle\` (road, hybrid, city, cross, mountain), \`hills\` (avoid, neutral, seek) and \`surface\` (paved-only, prefer-paved, any). Answers one leg per adjacent pair: its shape as [latitude, longitude] pairs, its length in metres, and its surface (paved, unpaved, or unknown when the map does not say). **Nothing is kept**: not the waypoints, the shape or the answer, in a table, a file or a log. Reached only sealed, on every instance: one that holds no keys answers \`sealed_required\`. \`routing_off\` when the operator has set up no routing engine; \`no_route\` when no road joins two waypoints; \`unpaved_endpoint\` when \`paved-only\` strands a waypoint on a bad surface; \`routing_failed\` when the engine gave no usable answer; \`rate_limited\` past your allowance a minute.`,
    identity: true,
    auth: 'session',
    routing: true,
    request: {
      type: 'object',
      properties: {
        waypoints: POINTS,
        preferences: {
          type: 'object',
          properties: {
            bicycle: { type: 'string', enum: ['road', 'hybrid', 'city', 'cross', 'mountain'] },
            hills: { type: 'string', enum: ['avoid', 'neutral', 'seek'] },
            surface: { type: 'string', enum: ['paved-only', 'prefer-paved', 'any'] },
          },
          required: ['bicycle', 'hills', 'surface'],
          additionalProperties: false,
        },
      },
      required: ['waypoints', 'preferences'],
      additionalProperties: false,
    },
    errors: [...ROUTING_ERRORS, 'no_route', 'unpaved_endpoint'],
    response: {
      contentType: 'application/json',
      schema: {
        type: 'object',
        properties: {
          legs: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                shape: PAIRS,
                distanceMetres: { type: 'number' },
                surface: { type: 'string', enum: ['paved', 'unpaved', 'unknown'] },
              },
              required: ['shape', 'distanceMetres', 'surface'],
              additionalProperties: false,
            },
          },
        },
        required: ['legs'],
        additionalProperties: false,
      },
    },
    handle: async (context) => {
      // Never unsealed: on an instance with no keys too (the file comment).
      if (!context.sealedRequest) return errorResponse('sealed_required');
      const { routing, caller } = context;
      if (routing === undefined || caller === undefined) return errorResponse('unavailable');
      const outcome = await routing.route(caller, context.json, context.request.signal);
      if (outcome.ok) return json(outcome.value);
      return errorResponse(
        outcome.code,
        outcome.fields === undefined ? {} : { fields: outcome.fields },
      );
    },
  },
  {
    method: 'POST',
    path: ROUTING_HEIGHTS_PATH,
    sealed: 'only',
    operationId: 'heightsAlongLine',
    reaches: 'own',
    summary: `The heights along a line (#2008). \`shape\` is a list of 2 to ${String(MAXIMUM_HEIGHT_POINTS)} \`{ latitude, longitude }\` points in degrees and \`interval\` the metres between samples. Answers \`samples\` as [metres along, metres high] pairs, high \`null\` where the terrain data has a hole, and \`source\`, the elevation dataset and its grid in metres, for a route to record. **Nothing is kept.** Reached only sealed, on every instance. \`routing_off\`, \`routing_failed\` and \`rate_limited\` as for a route.`,
    identity: true,
    auth: 'session',
    routing: true,
    request: {
      type: 'object',
      properties: { shape: POINTS, interval: { type: 'number' } },
      required: ['shape', 'interval'],
      additionalProperties: false,
    },
    errors: [...ROUTING_ERRORS],
    response: {
      contentType: 'application/json',
      schema: {
        type: 'object',
        properties: {
          source: {
            type: 'object',
            properties: { name: { type: 'string' }, resolutionMetres: { type: 'number' } },
            required: ['name', 'resolutionMetres'],
            additionalProperties: false,
          },
          samples: { type: 'array', items: { type: 'array', items: { type: ['number', 'null'] } } },
        },
        required: ['source', 'samples'],
        additionalProperties: false,
      },
    },
    handle: async (context) => {
      if (!context.sealedRequest) return errorResponse('sealed_required');
      const { routing, caller } = context;
      if (routing === undefined || caller === undefined) return errorResponse('unavailable');
      const outcome = await routing.heights(caller, context.json, context.request.signal);
      if (outcome.ok) return json(outcome.value);
      return errorResponse(
        outcome.code,
        outcome.fields === undefined ? {} : { fields: outcome.fields },
      );
    },
  },
];
