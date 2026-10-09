// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The sync routes (#37, #38, #776, #35), as entries in the one route table
 * (`routes.ts`), under `/v1/` like every route a client calls.
 *
 * Every one needs a signed-in device (`auth: 'session'`) and the instance's
 * sync store (`sync: true`); every one reads `context.caller` for the athlete
 * and nothing from the request. The rules are `sync.ts`'s.
 *
 * Every one declares `reaches: 'own'` (#83's choke point,
 * `moderation/choke-point.test.ts`): none takes an athlete from its path or
 * body, and none reads another athlete's data, so none asks `canSee`. The
 * account export and erasure alone admit an athlete awaiting approval (#775),
 * so a rider can always take their data out and delete it; the rest answer
 * such a caller `registration_pending`, like every other session route. The
 * same two, and no other route anywhere, admit a SUSPENDED athlete's way-out
 * session (#898, `admitsSuspended`). Deleting the account needs a step-up
 * beyond the session token (#898, `identity.ts` §`stepUp`).
 *
 * ⚠️ **Every response here carries `cache-control: no-store`**, and not
 * because a route remembered to: the handler sets it on EVERY response
 * (`handler.ts` §`ALWAYS`). A private activity served with a publicly
 * cacheable header is a disclosure that survives the fix (#38), and
 * `reads.test.ts` ("sends a private ride with no-store…") reads the header
 * off every read route here.
 */

import { errorResponse } from '../errors.ts';
import { json, noContent, type Route, type RouteContext, type Schema } from '../route-kit.ts';
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

const nullableNumber: Schema = { type: ['number', 'null'] };
const series: Schema = { type: 'array', items: nullableNumber };

/** A signed record's claims: `@onyourleft/domain`'s `ActivityClaims`, and no coordinate. */
const claimsSchema: Schema = object(
  {
    activityId: string,
    name: string,
    startedAt: integer,
    startedAtTimeZone: string,
    elapsedTime: { type: 'number' },
    movingTime: { type: 'number' },
    distance: { type: 'number' },
    hasPosition: { type: 'boolean' },
    averagePower: { type: 'number' },
  },
  [
    'activityId',
    'name',
    'startedAt',
    'startedAtTimeZone',
    'elapsedTime',
    'movingTime',
    'distance',
    'hasPosition',
  ],
);

const activityProperties = { contentSha256: string, receivedAt: integer, claims: claimsSchema };

const kindSchema: Schema = {
  type: 'string',
  enum: ['activity', 'write-up', 'ride-summary', 'side-camera-report', 'goal', 'note', 'document'],
};

export const SYNC_ROUTES: readonly Route[] = [
  {
    method: 'GET',
    path: '/v1/account/export',
    sealed: 'only',
    operationId: 'exportAccount',
    reaches: 'own',
    // A rider awaiting approval (#775), or suspended (#898), may still take
    // their data out and erase it (#35).
    admitsPending: true,
    admitsSuspended: true,
    summary:
      'Everything this instance holds about you, machine-readable: every activity’s signed record and the address of its original file — your own true track, unobfuscated — every item as you sent it, your public keys, your names, your results, your blocks, the reports you made and the recovery addresses you gave. Says what it leaves out, and why.',
    ...SESSION,
    errors: ['unauthenticated', 'not_found'],
    response: {
      contentType: 'application/json',
      schema: {
        type: 'object',
        description:
          '`onyourleft.instance-account` version 1: `athlete`, `displayNameChanges`, `deviceKeys` (public only), `recoveryEmail`, `activities` (each with its `record` and its `file` address), `items`, `results`, `blocks`, `reports`, `recoveryEmailConfirmations`, `historyIndex` (which model built the history index, and how many passages — never the passages or vectors), `hostedModelKey` (`a hosted model key is held`, or `null` — never the key) and `notIncluded`.',
      },
    },
    handle: async (context) => answer(await syncOf(context).exportAccount(callerOf(context))),
  },
  {
    method: 'DELETE',
    path: '/v1/account',
    sealed: 'only',
    operationId: 'eraseAccount',
    reaches: 'own',
    // A rider awaiting approval (#775), or suspended (#898), may still take
    // their data out and erase it (#35).
    admitsPending: true,
    admitsSuspended: true,
    summary:
      'Remove your account from THIS instance: every row, and every original file no other rider also sent. It cannot reach a copy anyone already downloaded, or another instance. Safe to repeat after a failure. Needs a step-up beyond the session (#898): one of your recovery codes (checked, not spent), or an `oyl-erase-account-v1` statement signed just now by one of your own live device keys. The moderation log is kept.',
    ...SESSION,
    request: object(
      {
        recoveryCode: string,
        statement: {
          type: 'object',
          description:
            'A signed `oyl-erase-account-v1` device statement: purpose, instanceOrigin, nonce (from `POST /v1/auth/challenge`), publicKey, issuedAt and signature.',
        },
      },
      [],
    ),
    errors: [
      'unauthenticated',
      'validation_failed',
      'step_up_required',
      'code_unknown',
      'wrong_purpose',
      'wrong_instance',
      'challenge_unknown',
      'challenge_used',
      'challenge_expired',
      'bad_signature',
      'key_revoked',
    ],
    response: { contentType: 'none' },
    handle: async (context) => {
      const caller = callerOf(context);
      // A session token alone does not delete an account (#898): the handler
      // declares `identity` on every sync route, so it is here.
      if (context.identity === undefined) throw new Error('sync route called without identity');
      const stepped = await context.identity.stepUp(caller, {
        recoveryCode: context.json.recoveryCode,
        statement: context.json.statement,
      });
      if (!stepped.ok) return answer(stepped);
      // #784: the rooms this rider made are over first — nobody joins them
      // again, and their routes are deleted — while their rows still say
      // which rooms those are. A room whose creator is gone however it
      // happened is ended by the rooms' sweep too (`rooms/rooms.ts`).
      await context.rooms?.closeRoomsMadeBy(caller.athleteId);
      await syncOf(context).eraseAccount(caller.athleteId);
      return noContent();
    },
  },
  {
    method: 'GET',
    path: '/v1/sync/manifest',
    sealed: 'only',
    operationId: 'getSyncManifest',
    reaches: 'own',
    summary:
      'Everything you have synced, tombstones included, in the order it arrived: `?limit=` (1–200) and `?cursor=`, a (receivedAt, id) position — so paging while other devices sync repeats nothing and skips nothing that was there.',
    ...SESSION,
    errors: ['unauthenticated', 'validation_failed'],
    response: {
      contentType: 'application/json',
      schema: object({
        items: {
          type: 'array',
          items: object({
            kind: kindSchema,
            key: string,
            digest: { type: ['string', 'null'] },
            receivedAt: integer,
            deleted: { type: 'boolean' },
            activityId: { type: ['string', 'null'] },
            mayBeRaced: { type: ['boolean', 'null'] },
          }),
        },
        next: { type: ['string', 'null'] },
      }),
    },
    handle: async (context) =>
      answer(await syncOf(context).manifest(callerOf(context), context.url.searchParams)),
  },
  {
    method: 'GET',
    path: '/v1/sync/records/{content}',
    sealed: 'only',
    operationId: 'getSignedRecord',
    reaches: 'own',
    summary:
      'One of your signed records, by the SHA-256 of its file. A device verifies it, and the file, before it writes anything.',
    ...SESSION,
    errors: ['unauthenticated', 'not_found'],
    response: {
      contentType: 'application/json',
      schema: object({ record: recordSchema, recordSha256: string, receivedAt: integer }),
    },
    handle: async (context) =>
      answer(await syncOf(context).record(callerOf(context), context.params.content ?? '')),
  },
  {
    method: 'POST',
    path: '/v1/sync/records/{content}/race-consent',
    sealed: 'only',
    operationId: 'setRaceConsent',
    reaches: 'own',
    summary:
      'Say whether another rider may race a ghost of one of your rides, by the SHA-256 of its file. Off unless you set it, and revocable: a ride set back to false is not served as raceable on the next read. Not part of the signed record, and never inferred from how a ride is shared.',
    ...SESSION,
    request: object({ mayBeRaced: { type: 'boolean' } }),
    errors: ['unauthenticated', 'validation_failed', 'not_found'],
    response: {
      contentType: 'application/json',
      schema: object({ mayBeRaced: { type: 'boolean' } }),
    },
    handle: async (context) =>
      answer(
        await syncOf(context).setRaceConsent(
          callerOf(context),
          context.params.content ?? '',
          context.json,
        ),
      ),
  },
  {
    method: 'POST',
    path: '/v1/sync/items/{kind}/{key}',
    sealed: 'only',
    operationId: 'putSyncItem',
    reaches: 'own',
    summary:
      'Store a write-up, a side-camera report (its pose summary inside), a goal, a note or a reference document, exactly as the device sends it. The device’s copy is canonical: a later put replaces it.',
    ...SESSION,
    request: object({ body: string }),
    errors: ['unauthenticated', 'validation_failed', 'not_found'],
    response: {
      contentType: 'application/json',
      schema: object({ digest: string, receivedAt: integer, unchanged: { type: 'boolean' } }),
    },
    handle: async (context) =>
      answer(
        await syncOf(context).putItem(
          callerOf(context),
          context.params.kind ?? '',
          context.params.key ?? '',
          context.json.body,
        ),
      ),
  },
  {
    method: 'GET',
    path: '/v1/sync/items/{kind}/{key}',
    sealed: 'only',
    operationId: 'getSyncItem',
    reaches: 'own',
    summary: 'One of your items, byte for byte as it was sent.',
    ...SESSION,
    errors: ['unauthenticated', 'not_found'],
    response: {
      contentType: 'application/json',
      schema: object({ body: string, digest: string, receivedAt: integer }),
    },
    handle: async (context) =>
      answer(
        await syncOf(context).getItem(
          callerOf(context),
          context.params.kind ?? '',
          context.params.key ?? '',
        ),
      ),
  },
  {
    method: 'DELETE',
    path: '/v1/sync/items/{kind}/{key}',
    sealed: 'only',
    operationId: 'deleteSyncItem',
    reaches: 'own',
    summary:
      'Delete one of your items — or, as `activity`, a ride by its content hash, its file with it unless another rider sent the same bytes. A tombstone stays in the manifest so your other devices learn of it.',
    ...SESSION,
    errors: ['unauthenticated', 'not_found'],
    response: { contentType: 'none' },
    handle: async (context) => {
      const outcome = await syncOf(context).deleteItem(
        callerOf(context),
        context.params.kind ?? '',
        context.params.key ?? '',
      );
      return outcome.ok ? noContent() : answer(outcome);
    },
  },
  {
    method: 'POST',
    path: '/v1/sync/records',
    sealed: 'only',
    operationId: 'ingestRecord',
    reaches: 'own',
    summary:
      'Send a signed activity record with its original file (base64). Checked in order — the file’s type from its bytes, that it decodes, the record’s signature and content hash, that the key is yours — and, for a key since revoked, that the ride started before it was — and stored only if every check passes. The same file sent again answers the first record.',
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
      'record_key_revoked',
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
    sealed: 'only',
    operationId: 'getOriginalFile',
    reaches: 'own',
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
  {
    method: 'GET',
    path: '/v1/activities',
    sealed: 'only',
    operationId: 'listActivities',
    reaches: 'own',
    summary:
      'Your activities, newest first: `?limit=` (1–200, default 50) and `?cursor=` from the page before. One query a page, and stable while activities are added.',
    ...SESSION,
    errors: ['unauthenticated', 'validation_failed'],
    response: {
      contentType: 'application/json',
      schema: object({
        items: { type: 'array', items: object(activityProperties) },
        next: { type: ['string', 'null'] },
      }),
    },
    handle: async (context) =>
      answer(await syncOf(context).activities(callerOf(context), context.url.searchParams)),
  },
  {
    method: 'GET',
    path: '/v1/activities/{content}',
    sealed: 'only',
    operationId: 'getActivity',
    reaches: 'own',
    summary:
      'One of your activities, by the SHA-256 of its file: what its record claims, and the signed record itself.',
    ...SESSION,
    errors: ['unauthenticated', 'not_found'],
    response: {
      contentType: 'application/json',
      schema: object({ ...activityProperties, recordSha256: string, record: recordSchema }),
    },
    handle: async (context) =>
      answer(await syncOf(context).activity(callerOf(context), context.params.content ?? '')),
  },
  {
    method: 'GET',
    path: '/v1/activities/{content}/streams',
    sealed: 'only',
    operationId: 'getActivityStreams',
    reaches: 'own',
    summary:
      'One of your activities’ samples — power, heart rate, cadence, speed, altitude and distance, never a position — in full, or at `?points=` (2–10 000) for a chart: each point the mean of its share of the ride, a gap left as `null`.',
    ...SESSION,
    errors: ['unauthenticated', 'not_found', 'validation_failed'],
    response: {
      contentType: 'application/json',
      schema: object({
        samples: integer,
        points: integer,
        t: { type: 'array', items: { type: 'number' } },
        channels: object({
          power: series,
          heartRate: series,
          cadence: series,
          speed: series,
          altitude: series,
          distance: series,
        }),
      }),
    },
    handle: async (context) =>
      answer(
        await syncOf(context).streams(
          callerOf(context),
          context.params.content ?? '',
          context.url.searchParams,
        ),
      ),
  },
];
