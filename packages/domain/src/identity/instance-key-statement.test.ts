// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { canonicalJson } from './canonical';
import {
  AUTH_PURPOSE,
  ERASE_ACCOUNT_PURPOSE,
  LINK_PURPOSE,
  RECOVER_PURPOSE,
} from './device-statement';
import {
  base32Unpadded,
  INSTANCE_IDENTITY_ROTATION_PURPOSE,
  INSTANCE_KEY_PURPOSE,
  INSTANCE_KEY_WRAP_PURPOSE,
  instanceCard,
  instanceIdentityFingerprint,
  instanceIdentityRotationBytes,
  instanceKeyId,
  instanceKeyStatementBytes,
  instanceKeyWrapAad,
  parseInstanceKeyStatement,
  type InstanceKeyStatement,
} from './instance-key-statement';
import { utf8Encode } from './utf8';

const STATEMENT: InstanceKeyStatement = {
  purpose: INSTANCE_KEY_PURPOSE,
  instanceOrigin: 'https://ride.example',
  keyId: '0123456789abcdef',
  encryptionKey: 'ab'.repeat(32),
  serial: 1_790_000_000,
  notBefore: 1_790_000_000,
  issuedAt: 1_790_086_400,
  notAfter: 1_790_259_200,
};

/** A "hash" that hands its input back, so the input's layout can be read. */
const identityHash = (bytes: Uint8Array): Promise<Uint8Array> => Promise.resolve(bytes.slice());

describe('the statement an instance signs about an encryption key (#1189, ADR 0047 D-4)', () => {
  it('is the RFC 8785 form of its eight members, written out so a verifier can be written from it', () => {
    expect(instanceKeyStatementBytes(STATEMENT)).toEqual(
      utf8Encode(
        `{"encryptionKey":"${'ab'.repeat(32)}","instanceOrigin":"https://ride.example","issuedAt":1790086400,"keyId":"0123456789abcdef","notAfter":1790259200,"notBefore":1790000000,"purpose":"oyl-instance-key-v1","serial":1790000000}`,
      ),
    );
  });

  it('signs only the eight members, whatever else the object carries', () => {
    const extra = { ...STATEMENT, signature: 'ff' } as InstanceKeyStatement;
    expect(instanceKeyStatementBytes(extra)).toEqual(instanceKeyStatementBytes(STATEMENT));
  });

  it.each([
    ['instanceOrigin', { instanceOrigin: 'https://other.example' }],
    ['keyId', { keyId: '0123456789abcdee' }],
    ['encryptionKey', { encryptionKey: 'ac'.repeat(32) }],
    ['serial', { serial: 1_790_000_001 }],
    ['notBefore', { notBefore: 1 }],
    ['issuedAt', { issuedAt: 1 }],
    ['notAfter', { notAfter: 1 }],
  ] as const)('changes when %s changes', (_, change) => {
    expect(instanceKeyStatementBytes({ ...STATEMENT, ...change })).not.toEqual(
      instanceKeyStatementBytes(STATEMENT),
    );
  });

  it('has purposes no device statement carries', () => {
    const device = [AUTH_PURPOSE, LINK_PURPOSE, RECOVER_PURPOSE, ERASE_ACCOUNT_PURPOSE];
    const instance = [
      INSTANCE_KEY_PURPOSE,
      INSTANCE_IDENTITY_ROTATION_PURPOSE,
      INSTANCE_KEY_WRAP_PURPOSE,
    ];
    expect(new Set([...device, ...instance]).size).toBe(device.length + instance.length);
  });
});

describe('parseInstanceKeyStatement', () => {
  const asReceived = JSON.parse(canonicalJson({ ...STATEMENT })) as Record<string, unknown>;

  it('reads a statement back exactly', () => {
    expect(parseInstanceKeyStatement(asReceived)).toEqual(STATEMENT);
  });

  it.each([AUTH_PURPOSE, LINK_PURPOSE, RECOVER_PURPOSE, ERASE_ACCOUNT_PURPOSE])(
    'refuses a device purpose, %s',
    (purpose) => {
      expect(parseInstanceKeyStatement({ ...asReceived, purpose })).toBeUndefined();
    },
  );

  it.each([
    ['a missing member', { serial: undefined }],
    ['an extra member', { extra: 1 }],
    ['an upper-case key', { encryptionKey: 'AB'.repeat(32) }],
    ['a short key id', { keyId: '0123' }],
    ['a fractional serial', { serial: 1.5 }],
    ['a negative time', { notAfter: -1 }],
    ['an empty origin', { instanceOrigin: '' }],
  ])('refuses %s', (_, change) => {
    const changed: Record<string, unknown> = { ...asReceived, ...change };
    for (const [key, value] of Object.entries(changed))
      if (value === undefined) delete changed[key];
    expect(parseInstanceKeyStatement(changed)).toBeUndefined();
  });

  it('refuses what is not an object', () => {
    expect(parseInstanceKeyStatement(null)).toBeUndefined();
    expect(parseInstanceKeyStatement([asReceived])).toBeUndefined();
  });
});

describe('the identity rotation endorsement (D-5)', () => {
  it('is the RFC 8785 form of its six members', () => {
    expect(
      instanceIdentityRotationBytes({
        purpose: INSTANCE_IDENTITY_ROTATION_PURPOSE,
        instanceOrigin: 'https://ride.example',
        previousIdentityKey: '01'.repeat(32),
        identityKey: '02'.repeat(32),
        fingerprint: 'A'.repeat(52),
        issuedAt: 5,
      }),
    ).toEqual(
      utf8Encode(
        `{"fingerprint":"${'A'.repeat(52)}","identityKey":"${'02'.repeat(32)}","instanceOrigin":"https://ride.example","issuedAt":5,"previousIdentityKey":"${'01'.repeat(32)}","purpose":"oyl-instance-identity-rotation-v1"}`,
      ),
    );
  });
});

describe('what a wrapped private half is bound to (D-5)', () => {
  it('is the RFC 8785 form of purpose, role, key id and origin', () => {
    expect(
      instanceKeyWrapAad({
        role: 'encryption',
        keyId: '0123456789abcdef',
        instanceOrigin: 'https://ride.example',
      }),
    ).toEqual(
      utf8Encode(
        '{"instanceOrigin":"https://ride.example","keyId":"0123456789abcdef","purpose":"oyl-instance-key-wrap-v1","role":"encryption"}',
      ),
    );
  });
});

describe('the key id, the fingerprint and the card (D-5, D-6)', () => {
  it('takes the key id from the first 8 bytes of the hash', async () => {
    const key = Uint8Array.from({ length: 32 }, (_, index) => index);
    expect(await instanceKeyId(identityHash, key)).toBe('0001020304050607');
  });

  it('hashes the label, then the origin, then the raw key', async () => {
    const input = await instanceIdentityFingerprint(
      identityHash,
      'https://a.example',
      'ff'.repeat(32),
    );
    const label = utf8Encode('oyl-instance-identity-v1');
    expect(input.slice(0, label.length)).toEqual(label);
    expect(input.slice(label.length, label.length + 17)).toEqual(utf8Encode('https://a.example'));
    expect(input.slice(label.length + 17)).toEqual(new Uint8Array(32).fill(0xff));
  });

  it.each([
    ['', ''],
    ['f', 'MY'],
    ['fo', 'MZXQ'],
    ['foo', 'MZXW6'],
    ['foob', 'MZXW6YQ'],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI'],
  ])('writes RFC 4648 §10’s base32 vector %j unpadded', (input, expected) => {
    expect(base32Unpadded(utf8Encode(input))).toBe(expected);
  });

  it('writes the whole fingerprint on the card: 52 characters, never fewer', () => {
    const card = instanceCard('https://ride.example', new Uint8Array(32).fill(0xff));
    expect(card).toBe(`oyl-instance:https://ride.example#${'7'.repeat(51)}Q`);
    expect(card.split('#')[1]).toHaveLength(52);
    expect(() => instanceCard('https://ride.example', new Uint8Array(16))).toThrow(RangeError);
  });
});
