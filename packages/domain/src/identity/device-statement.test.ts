// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { canonicalJson } from './canonical';
import {
  AUTH_PURPOSE,
  deviceStatementBytes,
  LINK_PURPOSE,
  RECOVER_PURPOSE,
  type DeviceStatement,
} from './device-statement';
import { utf8Encode } from './utf8';

const STATEMENT: DeviceStatement = {
  purpose: AUTH_PURPOSE,
  instanceOrigin: 'https://ride.example',
  nonce: 'ab'.repeat(32),
  publicKey: 'cd'.repeat(32),
  issuedAt: 1_790_000_000,
};

describe('the statement a device signs for an instance (#772)', () => {
  it('is the RFC 8785 form of its five members, written out here so a verifier can be written from it', () => {
    expect(deviceStatementBytes(STATEMENT)).toEqual(
      utf8Encode(
        `{"instanceOrigin":"https://ride.example","issuedAt":1790000000,"nonce":"${'ab'.repeat(32)}","publicKey":"${'cd'.repeat(32)}","purpose":"oyl-auth-v1"}`,
      ),
    );
  });

  it('signs only the five members, whatever else the object carries', () => {
    const extra = { ...STATEMENT, signature: 'ff' } as DeviceStatement;
    expect(deviceStatementBytes(extra)).toEqual(deviceStatementBytes(STATEMENT));
  });

  it.each([
    ['purpose', { purpose: LINK_PURPOSE }],
    ['instanceOrigin', { instanceOrigin: 'https://other.example' }],
    ['nonce', { nonce: 'ac'.repeat(32) }],
    ['publicKey', { publicKey: 'ce'.repeat(32) }],
    ['issuedAt', { issuedAt: 1_790_000_001 }],
  ] as const)('changes when %s changes', (_, change) => {
    expect(deviceStatementBytes({ ...STATEMENT, ...change })).not.toEqual(
      deviceStatementBytes(STATEMENT),
    );
  });

  it('has three purposes, all distinct', () => {
    expect(new Set([AUTH_PURPOSE, LINK_PURPOSE, RECOVER_PURPOSE]).size).toBe(3);
  });

  it('is not the canonical form of anything that lacks a purpose — an activity record has none', () => {
    const withoutPurpose = {
      instanceOrigin: STATEMENT.instanceOrigin,
      nonce: STATEMENT.nonce,
      publicKey: STATEMENT.publicKey,
      issuedAt: STATEMENT.issuedAt,
    };
    expect(deviceStatementBytes(STATEMENT)).not.toEqual(utf8Encode(canonicalJson(withoutPurpose)));
  });
});
