// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Operate routes (#2601, #2602), as entries in the one route table
 * (`routes.ts`). Every one is `sealed: 'only'` and `reaches: 'owner'`: the
 * handler answers anybody but the owner `not_found` before the route is
 * called, and every one answers `unavailable` on an instance with no keys
 * (`operate.ts`). `moderation/choke-point.test.ts` holds the table to both.
 */

import { errorResponse } from '../errors.ts';
import { OPERATOR_ACTIONS } from '../store/sql-store.ts';
import { json, type Route, type RouteContext, type Schema } from '../route-kit.ts';
import type { Operate } from './operate.ts';

function operateOf(context: RouteContext): Operate {
  // The handler answers `unavailable` before calling a route that declares
  // `operate` without one, so this is never reached with none.
  if (context.operate === undefined) throw new Error('operate route called without operate');
  return context.operate;
}

const entrySchema: Schema = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    /** ISO 8601, UTC. */
    at: { type: 'string' },
    /** Where it was taken: the app's Operate area, or the operator's CLI on the host. */
    source: { type: 'string', enum: ['app', 'cli'] },
    action: { type: 'string', enum: OPERATOR_ACTIONS },
    detail: { type: ['string', 'null'] },
    outcome: { type: 'string', enum: ['done', 'refused', 'failed'] },
  },
  required: ['id', 'at', 'source', 'action', 'detail', 'outcome'],
  additionalProperties: false,
};

export const OPERATE_ROUTES: readonly Route[] = [
  {
    method: 'GET',
    path: '/v1/operate/log',
    sealed: 'only',
    operationId: 'getOperatorLog',
    reaches: 'owner',
    summary:
      'The operator log (#2602): every action taken as the instance’s operator, from the app or the CLI on the host, NEWEST first, a page at a time — `?limit=` (1–200, default 50) and `?cursor=` from the page before. Append-only. The owner’s alone: anybody else, the deputy included, is answered as though there were no such route. `unavailable` on an instance with no `OYL_INSTANCE_SECRET_KEY`.',
    identity: true,
    operate: true,
    auth: 'session',
    errors: ['unauthenticated', 'validation_failed'],
    response: {
      contentType: 'application/json',
      schema: {
        type: 'object',
        properties: {
          entries: { type: 'array', items: entrySchema },
          cursor: { type: ['string', 'null'] },
        },
        required: ['entries', 'cursor'],
        additionalProperties: false,
      },
    },
    handle: async (context) => {
      const page = await operateOf(context).logPage(context.url.searchParams);
      if (!page.ok) {
        return errorResponse(page.code, page.fields === undefined ? {} : { fields: page.fields });
      }
      return json({
        entries: page.value.items.map((entry) => ({
          id: entry.id,
          at: new Date(entry.at * 1000).toISOString(),
          source: entry.source,
          action: entry.action,
          detail: entry.detail,
          outcome: entry.outcome,
        })),
        cursor: page.value.next,
      });
    },
  },
];
