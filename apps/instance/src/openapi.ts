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
  const success =
    route.response.contentType === 'application/json'
      ? { 'application/json': { schema: route.response.schema } }
      : { 'text/plain': { schema: { type: 'string' } } };
  const responses: Record<string, unknown> = {
    '200': { description: 'OK', content: success },
  };
  for (const code of EVERY_ROUTE) {
    responses[String(ERROR_STATUS[code])] = { $ref: `#/components/responses/${code}` };
  }
  return { operationId: route.operationId, summary: route.summary, responses };
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
    components: { schemas: { Error: errorSchema }, responses },
  };
}

/** The document as the committed file holds it. */
export function openApiText(routes: readonly Route[]): string {
  return `${JSON.stringify(openApiDocument(routes), null, 2)}\n`;
}
