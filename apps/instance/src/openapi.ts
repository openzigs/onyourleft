// SPDX-License-Identifier: AGPL-3.0-or-later

import { ERROR_CODES, ERROR_STATUS, type ErrorCode } from './errors.ts';
import type { Route, Schema } from './routes.ts';

/**
 * The machine-readable specification, GENERATED from the route table (#36).
 *
 * A hand-maintained specification drifts from the code within weeks, and a
 * client trusts it anyway. So this document is never written by hand: it is
 * `openApiDocument(ROUTES)`, committed as `apps/instance/openapi.json` so a
 * third party can read it without running anything, and served at
 * `GET /openapi.json`. `openapi.test.ts` fails when the committed file is not
 * what this writes — regenerate with
 * `pnpm --filter @onyourleft/instance run openapi:generate` and read the diff.
 *
 * Every route may answer with the error shape (`errors.ts`), and the document
 * says which codes, by status, rather than leaving a client to discover them.
 */

/** The version of the API this document describes. Not the package version. */
export const API_VERSION = '1';

/** The codes any route can answer with, whatever it does. */
const EVERY_ROUTE: readonly ErrorCode[] = [
  'not_found',
  'method_not_allowed',
  'payload_too_large',
  'rate_limited',
  'internal',
];

const errorSchema: Schema = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string', enum: ERROR_CODES },
        message: { type: 'string' },
        fields: {
          type: 'array',
          items: {
            type: 'object',
            properties: { field: { type: 'string' }, problem: { type: 'string' } },
            required: ['field', 'problem'],
            additionalProperties: false,
          },
        },
      },
      required: ['code', 'message'],
      additionalProperties: false,
    },
  },
  required: ['error'],
  additionalProperties: false,
};

function operation(route: Route): Record<string, unknown> {
  const responses: Record<string, unknown> = {};
  if (route.response.contentType === 'none') {
    responses['204'] = { description: 'No content' };
  } else {
    const success =
      route.response.contentType === 'application/json'
        ? { 'application/json': { schema: route.response.schema } }
        : route.response.contentType === 'sealed'
          ? {
              'application/json': { schema: route.response.schema },
              'text/event-stream': {
                schema: {
                  type: 'string',
                  description:
                    'When the inner route streams: frames of one `data:` line each — the first `{ "v": 1, "nonce", "ct" }`, then `{ "ct" }` — never an `event:` or `id:` field, ending with a sealed `end` event.',
                },
              },
            }
          : route.response.contentType === 'application/octet-stream'
            ? { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } }
            : { 'text/plain': { schema: { type: 'string' } } };
    responses['200'] = { description: 'OK', content: success };
  }
  const codes = new Set<ErrorCode>([...EVERY_ROUTE, ...(route.errors ?? [])]);
  if (route.identity === true || route.sync === true) codes.add('unavailable');
  // Several codes share a status, so a status names every code it may carry.
  const byStatus = new Map<number, ErrorCode[]>();
  for (const code of ERROR_CODES) {
    if (!codes.has(code)) continue;
    const status = ERROR_STATUS[code];
    byStatus.set(status, [...(byStatus.get(status) ?? []), code]);
  }
  for (const [status, sharing] of [...byStatus].sort(([left], [right]) => left - right)) {
    responses[String(status)] =
      sharing.length === 1
        ? { $ref: `#/components/responses/${sharing[0] as string}` }
        : {
            description: `One of ${sharing.map((code) => `\`${code}\``).join(', ')}, in the one error shape.`,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          };
  }
  const parameters = [...route.path.matchAll(/\{([A-Za-z]+)\}/g)].map((match) => ({
    name: match[1],
    in: 'path',
    required: true,
    schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,128}$' },
  }));
  return {
    operationId: route.operationId,
    summary: route.summary,
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(route.auth === 'session' ? { security: [{ session: [] }] } : {}),
    // #1191: reachable only inside `POST /v1/sealed`; a plaintext request is `not_found`.
    ...(route.sealed === 'only' ? { 'x-oyl-sealed': 'only' } : {}),
    ...(route.request === undefined
      ? {}
      : {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: route.request } },
          },
        }),
    responses,
  };
}

/** The OpenAPI 3.1 document for a route table. Deterministic: same table, same bytes. */
export function openApiDocument(routes: readonly Route[]): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of [...routes].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  )) {
    const item = (paths[route.path] ??= {});
    item[route.method.toLowerCase()] = operation(route);
  }
  const responses: Record<string, unknown> = {};
  for (const code of ERROR_CODES) {
    responses[code] = {
      description: `\`${code}\` (${String(ERROR_STATUS[code])}), in the one error shape.`,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'On Your Left instance',
      version: API_VERSION,
      license: {
        name: 'AGPL-3.0-or-later',
        identifier: 'AGPL-3.0-or-later',
      },
    },
    paths,
    components: {
      schemas: { Error: errorSchema },
      responses,
      securitySchemes: {
        session: {
          type: 'http',
          scheme: 'bearer',
          description:
            'A session token from `POST /v1/auth/session`. Never a WebSocket credential: a room takes a ticket.',
        },
      },
    },
  };
}

/** The document as the committed file holds it. */
export function openApiText(routes: readonly Route[]): string {
  return `${JSON.stringify(openApiDocument(routes), null, 2)}\n`;
}
