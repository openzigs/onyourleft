// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A rider's own hosted model key and hosted consent (#1199): read them, store
 * or clear the key, record or withdraw the consent. `hosted-settings.ts` says
 * what each holds and the owner's ruling it follows (bring-your-own keys only).
 *
 * Every one is `auth: 'session'` and `reaches: 'own'`: the athlete is the
 * session's, and no body or path names one.
 *
 * ⚠️ **Every one is sealed-only** (ADR 0047 D-7, D-13; #1192's comment on
 * #1199), and listed in `sealed/phase-one.ts`: on an instance that holds keys
 * a plaintext request is `sealed_required` before a session is read or a body
 * parsed. An instance with no `OYL_INSTANCE_SECRET_KEY` seals nothing, and
 * cannot hold a key either: `POST /v1/analysis/hosted/key` answers it
 * `unavailable` before the key is read. So no key ever arrives in plaintext.
 */

import { errorResponse } from '../errors.ts';
import { json, type Route, type RouteContext, type Schema } from '../route-kit.ts';
import type { HostedOutcome } from './hosted-settings.ts';

const status: Schema = {
  type: 'object',
  properties: {
    key: {
      type: ['object', 'null'],
      description:
        'Your hosted model key, or null: its base URL, model and when it was set (Unix seconds) — never the key itself. `setBy` is `app` for a key you stored, `operator-command` for the operator’s own key on the operator’s own account.',
      properties: {
        url: { type: 'string' },
        model: { type: 'string' },
        setAt: { type: 'integer' },
        setBy: { type: 'string', enum: ['app', 'operator-command'] },
      },
      required: ['url', 'model', 'setAt', 'setBy'],
      additionalProperties: false,
    },
    consent: {
      type: ['object', 'null'],
      description:
        'Your recorded hosted consent, or null: the origin it names and when (Unix seconds). A hosted job runs only while it names the origin your key goes to.',
      properties: { origin: { type: 'string' }, recordedAt: { type: 'integer' } },
      required: ['origin', 'recordedAt'],
      additionalProperties: false,
    },
  },
  required: ['key', 'consent'],
  additionalProperties: false,
};

/** The handler answers `unavailable` and `unauthenticated` before such a route is called without either. */
function ready(context: RouteContext) {
  const { hostedSettings, caller } = context;
  return hostedSettings === undefined || caller === undefined
    ? undefined
    : { hostedSettings, caller };
}

function answer(outcome: HostedOutcome): Response {
  if (outcome.ok) return json(outcome.value);
  return errorResponse(outcome.code, {
    ...(outcome.fields === undefined ? {} : { fields: outcome.fields }),
    ...(outcome.message === undefined ? {} : { message: outcome.message }),
  });
}

const COMMON = {
  sealed: 'only',
  reaches: 'own',
  identity: true,
  auth: 'session',
  hostedSettings: true,
  response: { contentType: 'application/json', schema: status },
} as const;

export const HOSTED_ROUTES: readonly Route[] = [
  {
    ...COMMON,
    method: 'GET',
    path: '/v1/analysis/hosted',
    operationId: 'getHostedModelSettings',
    summary:
      'Your own hosted model key (its URL and model, never the key) and your recorded hosted consent (#1199). A hosted job runs on your own key only, and only while your consent names the origin it goes to.',
    errors: ['unauthenticated', 'unavailable'],
    handle: async (context) => {
      const got = ready(context);
      if (got === undefined) return errorResponse('unavailable');
      return json(await got.hostedSettings.status(got.caller));
    },
  },
  {
    ...COMMON,
    method: 'POST',
    path: '/v1/analysis/hosted/key',
    operationId: 'setHostedModelKey',
    summary:
      'Store your own hosted model key, encrypted under the instance’s secret, replacing any you stored. `url` is the service’s `https:` base URL. A key at another origin than your consent names withdraws that consent; one at the same origin keeps it. The operator of this instance could technically read a key you store here. `unavailable` on an instance with no secret to encrypt it under, before the key is read.',
    request: {
      type: 'object',
      properties: { url: { type: 'string' }, model: { type: 'string' }, key: { type: 'string' } },
      required: ['url', 'model', 'key'],
      additionalProperties: false,
    },
    errors: ['unauthenticated', 'validation_failed', 'unavailable'],
    handle: async (context) => {
      const got = ready(context);
      if (got === undefined) return errorResponse('unavailable');
      return answer(await got.hostedSettings.setKey(got.caller, context.json));
    },
  },
  {
    ...COMMON,
    method: 'DELETE',
    path: '/v1/analysis/hosted/key',
    operationId: 'clearHostedModelKey',
    summary:
      'Clear the hosted model key you stored, scrubbed from the database. The operator’s own key is cleared only by `operator model-key clear`.',
    errors: ['unauthenticated', 'unavailable'],
    handle: async (context) => {
      const got = ready(context);
      if (got === undefined) return errorResponse('unavailable');
      return json(await got.hostedSettings.clearKey(got.caller));
    },
  },
  {
    ...COMMON,
    method: 'POST',
    path: '/v1/analysis/hosted/consent',
    operationId: 'recordHostedConsent',
    summary:
      'Record your hosted consent naming `endpoint` (ADR 0046 Q10): an `https:` URL, kept as its origin. Replaces any consent you had.',
    request: {
      type: 'object',
      properties: { endpoint: { type: 'string' } },
      required: ['endpoint'],
      additionalProperties: false,
    },
    errors: ['unauthenticated', 'validation_failed', 'unavailable'],
    handle: async (context) => {
      const got = ready(context);
      if (got === undefined) return errorResponse('unavailable');
      return answer(await got.hostedSettings.recordConsent(got.caller, context.json));
    },
  },
  {
    ...COMMON,
    method: 'DELETE',
    path: '/v1/analysis/hosted/consent',
    operationId: 'withdrawHostedConsent',
    summary:
      'Withdraw your hosted consent. No hosted job of yours runs until you record one again.',
    errors: ['unauthenticated', 'unavailable'],
    handle: async (context) => {
      const got = ready(context);
      if (got === undefined) return errorResponse('unavailable');
      return json(await got.hostedSettings.withdrawConsent(got.caller));
    },
  },
];
