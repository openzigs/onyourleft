// SPDX-License-Identifier: AGPL-3.0-or-later

import { IDENTITY_ROUTES } from './auth/routes.ts';
import { json, type Route, type Schema } from './route-kit.ts';

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
 * The identity routes (#772, #773, #774) are `auth/routes.ts`'s, appended
 * here, so there is still one table.
 *
 * ## Versioning
 *
 * The four below are the instance's own **metadata** and are not versioned: what
 * is running, where its source is, what its API is, and what third-party
 * software it includes. They only ever gain fields. The API a client syncs
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
    path: '/source',
    operationId: 'getSource',
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
    summary:
      'The licence and notice of every third-party package this instance includes, generated and gated by `check:notices`.',
    response: { contentType: 'text/plain' },
    handle: ({ notices }) =>
      new Response(notices, { headers: { 'content-type': 'text/plain; charset=utf-8' } }),
  },
  ...IDENTITY_ROUTES,
];
