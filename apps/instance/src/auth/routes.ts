// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The identity routes (#772, #773, #774), as entries in the one route table
 * (`routes.ts`), so the specification describes them and the handler is the
 * only thing that dispatches to them.
 *
 * They live under `/v1/`: `docs/architecture.md` §"The instance" puts every
 * route a client calls there from the first, so a breaking change is `/v2/`
 * beside it rather than an edit. #772's diagram names `/auth/…` and
 * `/rooms/{id}/ticket`; these are those paths, versioned.
 *
 * Every route here reads `context.identity` and nothing of the store: the
 * rules are `identity.ts`'s, and a route turns an {@link Outcome} into a
 * response and does nothing else.
 */

import { errorResponse } from '../errors.ts';
import { json, noContent, type Route, type RouteContext, type Schema } from '../route-kit.ts';
import type { Identity, Outcome } from './identity.ts';

function identityOf(context: RouteContext): Identity {
  // The handler answers `unavailable` before calling a route that declares
  // `identity` without one, so this is never reached with none.
  if (context.identity === undefined) throw new Error('identity route called without identity');
  return context.identity;
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
const nullableInteger: Schema = { type: ['integer', 'null'] };

function object(
  properties: Readonly<Record<string, Schema>>,
  required: readonly string[] = Object.keys(properties),
): Schema {
  return { type: 'object', properties, required, additionalProperties: false };
}

/** The five members of `@onyourleft/domain`'s device statement, and the signature over them. */
const STATEMENT_PROPERTIES: Readonly<Record<string, Schema>> = {
  purpose: string,
  instanceOrigin: string,
  nonce: string,
  publicKey: string,
  issuedAt: integer,
  signature: string,
};

const publicAthleteSchema = object({ athleteId: string, displayName: string });

const accountSchema = object({
  athleteId: string,
  displayName: string,
  registrationState: { type: 'string', enum: ['active', 'pending'] },
  adultConfirmedAt: nullableInteger,
  moderatorRole: { type: ['string', 'null'] },
  publicRooms: object({
    eligible: { type: 'boolean' },
    reasons: { type: 'array', items: string },
  }),
});

const STATEMENT_ERRORS = [
  'validation_failed',
  'wrong_purpose',
  'wrong_instance',
  'challenge_unknown',
  'challenge_used',
  'challenge_expired',
  'bad_signature',
] as const;

export const IDENTITY_ROUTES: readonly Route[] = [
  {
    method: 'POST',
    path: '/v1/auth/challenge',
    operationId: 'createChallenge',
    reaches: 'own',
    summary:
      'A single-use nonce, good for 60 seconds, for a device to sign with its key. Rate-limited per key and per address.',
    identity: true,
    request: object({ publicKey: string }),
    errors: ['validation_failed'],
    response: {
      contentType: 'application/json',
      schema: object({ nonce: string, expiresAt: integer }),
    },
    handle: async (context) =>
      answer(await identityOf(context).challenge(context.json.publicKey, context.client.address)),
  },
  {
    method: 'POST',
    path: '/v1/auth/session',
    operationId: 'createSession',
    reaches: 'own',
    summary:
      'Sign in with a signed `oyl-auth-v1` statement. A key the instance has not seen registers a new athlete as the registration mode allows — awaiting approval by default — and only then are the recovery codes in the answer. New registrations are rate-limited per client address.',
    identity: true,
    request: object(
      {
        ...STATEMENT_PROPERTIES,
        displayName: string,
        recoveryEmail: string,
        inviteCode: string,
        confirmsAdult: { type: 'boolean' },
      },
      Object.keys(STATEMENT_PROPERTIES),
    ),
    errors: [
      ...STATEMENT_ERRORS,
      'key_revoked',
      'registration_closed',
      'registration_refused',
      'account_suspended',
      'code_unknown',
      'code_used',
      'code_expired',
      'rate_limited',
    ],
    response: {
      contentType: 'application/json',
      schema: object(
        {
          sessionToken: string,
          expiresAt: integer,
          athleteId: string,
          displayName: string,
          registered: { type: 'boolean' },
          registrationState: { type: 'string', enum: ['active', 'pending'] },
          recoveryCodes: { type: 'array', items: string },
        },
        [
          'sessionToken',
          'expiresAt',
          'athleteId',
          'displayName',
          'registered',
          'registrationState',
        ],
      ),
    },
    handle: async (context) =>
      answer(
        await identityOf(context).signIn(
          context.json,
          {
            displayName: context.json.displayName,
            recoveryEmail: context.json.recoveryEmail,
            inviteCode: context.json.inviteCode,
            confirmsAdult: context.json.confirmsAdult,
          },
          context.client.address,
        ),
      ),
  },
  {
    method: 'GET',
    path: '/v1/auth/session',
    operationId: 'getSession',
    reaches: 'own',
    admitsPending: true,
    summary: 'Who this session is: the athlete, as other riders see them.',
    identity: true,
    auth: 'session',
    errors: ['unauthenticated'],
    response: { contentType: 'application/json', schema: publicAthleteSchema },
    handle: async (context) => answer(await identityOf(context).me(callerOf(context))),
  },
  {
    method: 'DELETE',
    path: '/v1/auth/session',
    operationId: 'deleteSession',
    reaches: 'own',
    admitsPending: true,
    summary: 'Sign out: the session is revoked on the instance, not only forgotten by the device.',
    identity: true,
    auth: 'session',
    errors: ['unauthenticated'],
    response: { contentType: 'none' },
    handle: async (context) => {
      await identityOf(context).signOut(callerOf(context));
      return noContent();
    },
  },
  {
    method: 'POST',
    path: '/v1/auth/display-name',
    operationId: 'setDisplayName',
    reaches: 'own',
    admitsPending: true,
    summary:
      'Change the display name: 1–32 characters, no control, bidirectional or invisible character. Rate-limited, and the old name is kept for moderation.',
    identity: true,
    auth: 'session',
    request: object({ displayName: string }),
    errors: ['unauthenticated', 'validation_failed'],
    response: { contentType: 'application/json', schema: publicAthleteSchema },
    handle: async (context) =>
      answer(await identityOf(context).rename(callerOf(context), context.json.displayName)),
  },
  {
    method: 'GET',
    path: '/v1/athletes/{athleteId}',
    operationId: 'getAthlete',
    reaches: { athlete: 'athleteId' },
    summary: 'What another rider may see of an athlete: the display name, and nothing else.',
    identity: true,
    auth: 'session',
    errors: ['unauthenticated'],
    response: { contentType: 'application/json', schema: publicAthleteSchema },
    handle: async (context) =>
      answer(await identityOf(context).profile(context.params.athleteId ?? '')),
  },
  {
    method: 'POST',
    path: '/v1/rooms/{roomId}/ticket',
    operationId: 'createRoomTicket',
    reaches: {
      exempt:
        'a room’s riders see each other: blocking inside a room is room moderation, #789’s (ADR 0028 D-6.4)',
    },
    summary:
      'A ticket for one room’s WebSocket hello: single use, 30 seconds. The socket never carries the session token. A public room needs an eligible account (`GET /v1/auth/account`); a room a rider made needs its creator or a rider who joined it by its code, while it is open (#784).',
    identity: true,
    auth: 'session',
    request: object({ declaredMassKilograms: { type: 'number' } }),
    errors: ['unauthenticated', 'validation_failed', 'not_eligible', 'not_found'],
    response: {
      contentType: 'application/json',
      schema: object({ ticket: string, expiresAt: integer }),
    },
    handle: async (context) =>
      answer(
        await identityOf(context).ticket(
          callerOf(context),
          context.params.roomId ?? '',
          context.json.declaredMassKilograms,
        ),
        // Unix seconds, like every other expiresAt here; rounded down, so a
        // client never believes a ticket outlives the book that holds it.
        (minted) => ({ ticket: minted.ticket, expiresAt: Math.floor(minted.expiresAtMs / 1000) }),
      ),
  },
  {
    method: 'GET',
    path: '/v1/auth/devices',
    operationId: 'listDevices',
    reaches: 'own',
    admitsPending: true,
    summary: 'This athlete’s device keys: when each was added and last used, and which is asking.',
    identity: true,
    auth: 'session',
    errors: ['unauthenticated'],
    response: {
      contentType: 'application/json',
      schema: object({
        devices: {
          type: 'array',
          items: object({
            publicKey: string,
            addedAt: integer,
            lastUsedAt: nullableInteger,
            revokedAt: nullableInteger,
            thisDevice: { type: 'boolean' },
          }),
        },
      }),
    },
    handle: async (context) =>
      json({ devices: await identityOf(context).devices(callerOf(context)) }),
  },
  {
    method: 'POST',
    path: '/v1/auth/devices/{publicKey}/revoke',
    operationId: 'revokeDevice',
    reaches: 'own',
    admitsPending: true,
    summary:
      'Revoke one of this athlete’s device keys and its sessions. The last key needs one of the athlete’s recovery codes, which is checked and not spent.',
    identity: true,
    auth: 'session',
    request: object({ recoveryCode: string }, []),
    errors: ['unauthenticated', 'last_device'],
    response: { contentType: 'none' },
    handle: async (context) => {
      const outcome = await identityOf(context).revokeDevice(
        callerOf(context),
        context.params.publicKey ?? '',
        context.json.recoveryCode,
      );
      return outcome.ok ? noContent() : answer(outcome);
    },
  },
  {
    method: 'POST',
    path: '/v1/auth/link-codes',
    operationId: 'createLinkCode',
    reaches: 'own',
    admitsPending: true,
    summary:
      'A single-use code, good for 5 minutes, that adds another device’s own key to this athlete.',
    identity: true,
    auth: 'session',
    errors: ['unauthenticated'],
    response: {
      contentType: 'application/json',
      schema: object({ linkCode: string, expiresAt: integer }),
    },
    handle: async (context) => answer(await identityOf(context).mintLinkCode(callerOf(context))),
  },
  {
    method: 'POST',
    path: '/v1/auth/link',
    operationId: 'linkDevice',
    reaches: 'own',
    summary:
      'Add this device’s key to the athlete whose other device minted the code, with a signed `oyl-link-v1` statement.',
    identity: true,
    request: object({ ...STATEMENT_PROPERTIES, linkCode: string }),
    errors: [...STATEMENT_ERRORS, 'code_unknown', 'code_used', 'code_expired', 'key_in_use'],
    response: { contentType: 'application/json', schema: object({ athleteId: string }) },
    handle: async (context) =>
      answer(await identityOf(context).link(context.json, context.json.linkCode)),
  },
  {
    method: 'POST',
    path: '/v1/auth/recover',
    operationId: 'recoverAccount',
    reaches: 'own',
    summary:
      'Add this device’s key to an athlete with a recovery code, or with an emailed token where the operator enabled email recovery, and a signed `oyl-recover-v1` statement.',
    identity: true,
    request: object(
      { ...STATEMENT_PROPERTIES, recoveryCode: string, emailToken: string },
      Object.keys(STATEMENT_PROPERTIES),
    ),
    errors: [...STATEMENT_ERRORS, 'code_unknown', 'code_used', 'code_expired', 'key_in_use'],
    response: { contentType: 'application/json', schema: object({ athleteId: string }) },
    handle: async (context) =>
      answer(
        await identityOf(context).recover(context.json, {
          recoveryCode: context.json.recoveryCode,
          emailToken: context.json.emailToken,
        }),
      ),
  },
  {
    method: 'POST',
    path: '/v1/auth/recover/email',
    operationId: 'requestEmailRecovery',
    reaches: 'own',
    summary:
      'Email a single-use recovery link to an address, if an athlete registered it. The same answer either way. `not_found` where the operator has not enabled email recovery.',
    identity: true,
    request: object({ address: string }),
    errors: ['validation_failed'],
    response: { contentType: 'none' },
    handle: async (context) => {
      const outcome = await identityOf(context).requestEmailRecovery(
        context.json.address,
        context.client.address,
      );
      return outcome.ok ? noContent() : answer(outcome);
    },
  },
  {
    method: 'GET',
    path: '/v1/auth/account',
    operationId: 'getAccount',
    reaches: 'own',
    admitsPending: true,
    summary:
      'This athlete’s own account: whether it is approved, when they confirmed they are 18 or over, any moderator role, and whether they may join a public room — and if not, every reason why.',
    identity: true,
    auth: 'session',
    errors: ['unauthenticated'],
    response: { contentType: 'application/json', schema: accountSchema },
    handle: async (context) => answer(await identityOf(context).account(callerOf(context))),
  },
  {
    method: 'POST',
    path: '/v1/auth/adult',
    operationId: 'confirmAdult',
    reaches: 'own',
    admitsPending: true,
    summary:
      'Confirm that the rider is 18 or over, which public rooms require (ruling Q5). Only the confirmation and its date are kept: no date of birth is asked for or stored.',
    identity: true,
    auth: 'session',
    request: object({ confirmed: { type: 'boolean' } }),
    errors: ['unauthenticated', 'validation_failed'],
    response: { contentType: 'application/json', schema: accountSchema },
    handle: async (context) =>
      answer(await identityOf(context).confirmAdult(callerOf(context), context.json.confirmed)),
  },
  {
    method: 'POST',
    path: '/v1/auth/recovery-email',
    operationId: 'setRecoveryEmail',
    reaches: 'own',
    admitsPending: true,
    summary:
      'Give an address for email recovery: a single-use link, good for 24 hours, is mailed to it, and the address recovers nothing until that link is followed. The same answer whether or not the address is already held. `rate_limited` when this athlete has given addresses too often this hour; `internal` when the mail could not be sent, and then nothing is stored. `not_found` where the operator has not enabled email recovery.',
    identity: true,
    auth: 'session',
    request: object({ address: string }),
    errors: ['unauthenticated', 'validation_failed'],
    response: { contentType: 'none' },
    handle: async (context) => {
      const outcome = await identityOf(context).setRecoveryEmail(
        callerOf(context),
        context.json.address,
      );
      return outcome.ok ? noContent() : answer(outcome);
    },
  },
  {
    method: 'POST',
    path: '/v1/auth/recovery-email/confirm',
    operationId: 'confirmRecoveryEmail',
    reaches: 'own',
    admitsPending: true,
    summary:
      'Follow the link mailed to a recovery address, signed in as the athlete who gave it: the address is bound, replacing any earlier one. `address_in_use` when it is already another account’s.',
    identity: true,
    auth: 'session',
    request: object({ token: string }),
    errors: [
      'unauthenticated',
      'validation_failed',
      'code_unknown',
      'code_used',
      'code_expired',
      'address_in_use',
    ],
    response: { contentType: 'none' },
    handle: async (context) => {
      const outcome = await identityOf(context).confirmRecoveryEmail(
        callerOf(context),
        context.json.token,
      );
      return outcome.ok ? noContent() : answer(outcome);
    },
  },
];
