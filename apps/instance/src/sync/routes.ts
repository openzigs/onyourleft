// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The sync routes (#37, #38, #776, #35), as entries in the one route table
 * (`routes.ts`), under `/v1/` like every route a client calls.
 *
 * Every one needs a signed-in device (`auth: 'session'`) and the instance's
 * sync store (`sync: true`); every one reads `context.caller` for the athlete
 * and nothing from the request. The rules are `sync.ts`'s.
 *
 * ⚠️ **Every response here carries `cache-control: no-store`**, and not
 * because a route remembered to: the handler sets it on EVERY response
 * (`handler.ts` §`ALWAYS`). A private activity served with a publicly
 * cacheable header is a disclosure that survives the fix (#38), and
 * `sync-routes.test.ts` reads the header off every read route here.
 */

import { errorResponse } from '../errors.ts';
import { json, type Route, type RouteContext, type Schema } from '../route-kit.ts';
import type { Outcome } from '../auth/identity.ts';
import type { Sync } from './sync.ts';

function syncOf(context: RouteContext): Sync {
  // The handler answers `unavailable` before calling a `sync` route without one.
  if (context.sync === undefined) throw new Error('sync route called without sync');
  return context.sync;
}

function callerOf(context: RouteContext): NonNullable<RouteContext['caller']> {
  // The handler answers `unauthenticated` before calling an `auth` route without one.
  if (context.caller === undefined) throw new Error('session route called without a caller');
  return context.caller;
}

function answer<T>(outcome: Outcome<T>, body: (value: T) => unknown = (value) => value): Response {
  if (outcome.ok) return json(body(outcome.value));
  return errorResponse(
    outcome.code,
    outcome.fields === undefined ? {} : { fields: outcome.fields },
  );
}

const string: Schema = { type: 'string' };
const integer: Schema = { type: 'integer' };

function object(
  properties: Readonly<Record<string, Schema>>,
  required: readonly string[] = Object.keys(properties),
): Schema {
  return { type: 'object', properties, required, additionalProperties: false };
}

const recordSchema: Schema = {
  type: 'object',
  description:
    'A signed activity record, ADR 0014’s format: seven members, the signature over the RFC 8785 canonical form of the other six.',
};

const SESSION = { identity: true, auth: 'session', sync: true } as const;

export const SYNC_ROUTES: readonly Route[] = [
  {
    method: 'POST',
    path: '/v1/sync/records',
    operationId: 'ingestRecord',
    summary:
      'Send a signed activity record with its original file (base64). Checked in order — the file’s type from its bytes, that it decodes, the record’s signature and content hash, that the key is yours — and stored only if every check passes. The same file sent again answers the first record.',
    ...SESSION,
    request: object({ record: recordSchema, file: string }),
    errors: [
      'unauthenticated',
      'validation_failed',
      'file_type_unsupported',
      'file_undecodable',
      'record_malformed',
      'record_unsupported',
      'record_signature_mismatch',
      'record_content_mismatch',
      'record_not_your_key',
    ],
    response: {
      contentType: 'application/json',
      schema: object({
        contentSha256: string,
        recordSha256: string,
        receivedAt: integer,
        duplicate: { type: 'boolean' },
      }),
    },
    handle: async (context) =>
      answer(await syncOf(context).ingest(callerOf(context), context.json)),
  },
  {
    method: 'GET',
    path: '/v1/sync/files/{content}',
    operationId: 'getOriginalFile',
    summary:
      'The original activity file, byte for byte, as it was sent: the rider’s own true track, unobfuscated. Only to an athlete who holds a record of it.',
    ...SESSION,
    errors: ['unauthenticated', 'not_found'],
    response: { contentType: 'application/octet-stream' },
    handle: async (context) => {
      const outcome = await syncOf(context).file(callerOf(context), context.params.content ?? '');
      if (!outcome.ok) return answer(outcome);
      return new Response(outcome.value.slice(), {
        headers: { 'content-type': 'application/octet-stream' },
      });
    },
  },
];
