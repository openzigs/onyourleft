// SPDX-License-Identifier: Apache-2.0

/**
 * The owner's claim's comparison code (#2782, ADR 0080 D-5). The hash here
 * is a stand-in that records what it was handed and answers fixed bytes, so
 * the input and the arithmetic are each held on their own; the real SHA-256
 * vector is `apps/instance/src/auth/owner-claim.test.ts`'s.
 */

import { describe, expect, it } from 'vitest';

import {
  normalisedClaimCode,
  OWNER_CLAIM_COMPARISON_LABEL,
  ownerClaimComparisonCode,
} from './owner-claim';

const KEY = 'ab'.repeat(32);

/** A hash that answers `answer` and keeps what it was asked to hash, as text. */
function standIn(answer: readonly number[]): {
  hashed: string[];
  sha256: (bytes: Uint8Array) => Promise<Uint8Array>;
} {
  const hashed: string[] = [];
  return {
    hashed,
    sha256: (bytes) => {
      hashed.push(String.fromCharCode(...bytes));
      return Promise.resolve(Uint8Array.from([...answer, ...new Array<number>(28).fill(0xff)]));
    },
  };
}

describe('the owner claim’s comparison code (#2782, ADR 0080 D-5)', () => {
  it('hashes its own label, the normalised code and the key, one per line', async () => {
    const hash = standIn([0, 0, 0, 1]);
    await ownerClaimComparisonCode(hash.sha256, 'ABCD-efgh jkmn-PQRS', KEY.toUpperCase());
    expect(hash.hashed).toEqual([`${OWNER_CLAIM_COMPARISON_LABEL}\nabcdefghjkmnpqrs\n${KEY}`]);
  });

  it('is the first four bytes, big-endian, modulo a million, as six digits with leading zeros', async () => {
    expect(await ownerClaimComparisonCode(standIn([0, 0, 0, 7]).sha256, 'c', KEY)).toBe('000007');
    // 0x01020304 = 16 909 060.
    expect(await ownerClaimComparisonCode(standIn([1, 2, 3, 4]).sha256, 'c', KEY)).toBe('909060');
    // The top bit set stays unsigned: 0xffffffff = 4 294 967 295.
    expect(await ownerClaimComparisonCode(standIn([255, 255, 255, 255]).sha256, 'c', KEY)).toBe(
      '967295',
    );
  });

  it('normalises a code as the instance reads one: lower case, no whitespace, no hyphens', () => {
    expect(normalisedClaimCode(' Abcd-EFGH\tjkmn - pqrs ')).toBe('abcdefghjkmnpqrs');
  });
});
