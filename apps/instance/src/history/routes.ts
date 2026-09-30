// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The history index's one route (#835, ADR 0040 D-8): a device asks for the
 * passages of its rider's history that best match a query, within the passage
 * count and character budget its template states.
 *
 * `auth: 'session'` (the device-key session, #772) and `reaches: 'own'`: the
 * athlete is the session's (`context.caller`), and the body has no athlete in
 * it to get wrong (ADR 0040 D-3). The rules are `history.ts`'s.
 */

import { errorResponse } from '../errors.ts';
import { json, type Route, type Schema } from '../route-kit.ts';
import {
  MAXIMUM_QUERY_CHARACTERS,
  MAXIMUM_SEARCH_CHARACTERS,
  MAXIMUM_SEARCH_PASSAGES,
} from './history.ts';

const string: Schema = { type: 'string' };
const integer: Schema = { type: 'integer' };

export const HISTORY_ROUTES: readonly Route[] = [
  {
    method: 'POST',
    path: '/v1/history/search',
    operationId: 'searchHistory',
    reaches: 'own',
    summary: `The passages of YOUR history — past write-ups, ride summaries, goals, notes and documents you synced — that best match \`query\`, at most \`limit\` of them (1–${String(MAXIMUM_SEARCH_PASSAGES)}) and \`characters\` in all (1–${String(MAXIMUM_SEARCH_CHARACTERS)}); a passage is never cut to fit. \`rideId\`, the synced id of the ride being written about, leaves that ride out and dates the others against it in whole weeks. \`query\` is at most ${String(MAXIMUM_QUERY_CHARACTERS)} characters. \`unavailable\` when this instance has no embedding model, or cannot reach it.`,
    identity: true,
    auth: 'session',
    history: true,
    request: {
      type: 'object',
      properties: { query: string, limit: integer, characters: integer, rideId: string },
      required: ['query', 'limit', 'characters'],
      additionalProperties: false,
    },
    errors: ['unauthenticated', 'validation_failed', 'unavailable'],
    response: {
      contentType: 'application/json',
      schema: {
        type: 'object',
        properties: {
          passages: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                kind: {
                  type: 'string',
                  enum: ['write-up', 'ride-summary', 'goal', 'note', 'document'],
                },
                label: string,
                text: string,
              },
              required: ['kind', 'label', 'text'],
              additionalProperties: false,
            },
          },
        },
        required: ['passages'],
        additionalProperties: false,
      },
    },
    handle: async ({ history, caller, json: body }) => {
      // The handler answers `unavailable` and `unauthenticated` before a
      // `history` session route is called without either.
      if (history === undefined || caller === undefined) return errorResponse('unavailable');
      const outcome = await history.search(caller, body);
      if (outcome.ok) return json(outcome.value);
      return errorResponse(
        outcome.code,
        outcome.fields === undefined ? {} : { fields: outcome.fields },
      );
    },
  },
];
