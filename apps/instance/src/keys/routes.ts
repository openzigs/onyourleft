// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `GET /v1/instance/keys` (#1189, ADR 0047 D-4): the instance's identity key,
 * every in-date statement the identity key signed for an encryption key it
 * still holds, and — after a planned identity rotation — the old key's
 * endorsement. **Plaintext, on purpose**: every byte is public, and what makes
 * it trustworthy is the signature under the key a device pinned from a card
 * (D-6), not the transport.
 *
 * With no operator secret, no origin, or a secret that does not open the keys
 * held, it answers `unavailable` with the sentence that names the cause
 * (`instance-keys.ts`), and nothing else.
 */

import { errorResponse } from '../errors.ts';
import { json, type Route, type Schema } from '../route-kit.ts';
import { InstanceKeysUnavailable } from './instance-keys.ts';

/** Before the store is open there is nothing to serve yet. */
export const KEYS_NOT_OPEN_SENTENCE = 'This instance is starting: its keys are not open yet.';

const hex: Schema = { type: 'string' };
const seconds: Schema = { type: 'integer' };

const STATEMENT: Schema = {
  type: 'object',
  properties: {
    purpose: { type: 'string', enum: ['oyl-instance-key-v1'] },
    instanceOrigin: { type: 'string' },
    keyId: hex,
    encryptionKey: hex,
    serial: seconds,
    notBefore: seconds,
    issuedAt: seconds,
    notAfter: seconds,
  },
  required: [
    'purpose',
    'instanceOrigin',
    'keyId',
    'encryptionKey',
    'serial',
    'notBefore',
    'issuedAt',
    'notAfter',
  ],
  additionalProperties: false,
};

const ENDORSEMENT: Schema = {
  type: 'object',
  properties: {
    purpose: { type: 'string', enum: ['oyl-instance-identity-rotation-v1'] },
    instanceOrigin: { type: 'string' },
    previousIdentityKey: hex,
    identityKey: hex,
    fingerprint: { type: 'string' },
    issuedAt: seconds,
  },
  required: [
    'purpose',
    'instanceOrigin',
    'previousIdentityKey',
    'identityKey',
    'fingerprint',
    'issuedAt',
  ],
  additionalProperties: false,
};

const signed = (statement: Schema): Schema => ({
  type: 'object',
  properties: { statement, signature: hex },
  required: ['statement', 'signature'],
  additionalProperties: false,
});

export const INSTANCE_KEY_ROUTES: readonly Route[] = [
  {
    method: 'GET',
    path: '/v1/instance/keys',
    operationId: 'getInstanceKeys',
    reaches: 'own',
    summary:
      'The instance’s Ed25519 identity key, and each in-date `oyl-instance-key-v1` statement it signed for an X25519 encryption key still held, highest `serial` first, with its signature over the statement’s RFC 8785 bytes (ADR 0047 D-4, D-5). After a planned identity rotation, the old key’s `oyl-instance-identity-rotation-v1` endorsement. Plaintext: a device trusts it by the identity key it pinned from a card (D-6). `unavailable`, naming the variable, on an instance with no `OYL_INSTANCE_SECRET_KEY`.',
    errors: ['unavailable'],
    response: {
      contentType: 'application/json',
      schema: {
        type: 'object',
        properties: {
          identityKey: hex,
          statements: { type: 'array', items: signed(STATEMENT) },
          endorsements: { type: 'array', items: signed(ENDORSEMENT) },
        },
        required: ['identityKey', 'statements', 'endorsements'],
        additionalProperties: false,
      },
    },
    handle: async ({ instanceKeys }) => {
      if (instanceKeys === undefined) {
        return errorResponse('unavailable', { message: KEYS_NOT_OPEN_SENTENCE });
      }
      try {
        return json(await instanceKeys.served());
      } catch (error) {
        if (error instanceof InstanceKeysUnavailable) {
          return errorResponse('unavailable', { message: error.message });
        }
        throw error;
      }
    },
  },
];
