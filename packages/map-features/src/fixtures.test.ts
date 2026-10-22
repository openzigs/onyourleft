// SPDX-License-Identifier: Apache-2.0

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  HOSTILE_FIXTURES,
  LIMIT_NAMES,
  NAMED_FIXTURES,
  tileAtLimit,
  tileOverLimit,
} from './testing';

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/**
 * The named fixtures' digests. The encoder is deterministic, so the code in
 * `fixtures/` is the fixture; this pins what it writes, and a change that moves
 * a byte has to change a line here too.
 */
const DIGESTS: Readonly<Record<string, string>> = {
  residentialBlock: '58747e01388ac26047bb00017cc0bcf1a8ea60b96bc414ddb58ef8114a56437b',
  woodWithHole: 'b80b0fe8086400cdb5f1e0bdd4bfe0795d93c64ade61306378c2f9fa9f541f68',
  lake: 'be4cc2dd1a6e37408137c704f712d9d5e97a6f029f67eda7786037f07357c2e5',
  sidewalk: 'd3be4fa925a4fa736f16319e6edeece2124a8dd29ab4200da4d3ad829964c936',
  buildingPart: 'af4566be1ffb30a9abb4d78678fb87bd87b31537ddd2a3609636dbfad403db44',
  streets: '4b8ed896a3c434aca697973b30cb224b736aeaeb297e2318d8b198571301adcb',
};

describe('the synthetic fixtures', () => {
  it('are deterministic: two builds are byte-identical', () => {
    for (const build of Object.values(NAMED_FIXTURES)) expect(build()).toEqual(build());
    for (const limit of LIMIT_NAMES) {
      expect(sha256(tileAtLimit(limit))).toBe(sha256(tileAtLimit(limit)));
      expect(sha256(tileOverLimit(limit))).toBe(sha256(tileOverLimit(limit)));
    }
    for (const fixture of HOSTILE_FIXTURES)
      expect(sha256(fixture.bytes())).toBe(sha256(fixture.bytes()));
  });

  it('are pinned by digest', () => {
    const got = Object.fromEntries(
      Object.entries(NAMED_FIXTURES).map(([name, build]) => [name, sha256(build())]),
    );
    expect(got).toEqual(DIGESTS);
  });
});
