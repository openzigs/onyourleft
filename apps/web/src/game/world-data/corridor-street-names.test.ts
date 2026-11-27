// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3245, ADR 0100: a corridor's street keeps its name through the
 * store's pack — as `n`, only where the glyph atlas can paint it whole — and
 * a packed name is held to that rule again when it is read back, so a blob
 * edited on the device cannot put another string on the road. Every name here
 * is invented.
 */

import { describe, expect, it } from 'vitest';

import {
  corridorFeaturesOfPacked,
  packCorridorFeatures,
  packedCorridorFeatures,
  unpackCorridorFeatures,
  type CorridorFeatures,
  type CorridorStreet,
  type PackedCorridorFeatures,
} from './corridor';

const street = (name?: string): CorridorStreet => ({
  kind: 'minor_road',
  kindDetail: 'residential',
  grade: 'ground',
  line: Float32Array.of(0, 0, 100, 0),
  ...(name === undefined ? {} : { name }),
});

const features = (streets: readonly CorridorStreet[]): CorridorFeatures => ({
  landUse: [],
  buildings: [],
  paths: [],
  streets,
  places: [],
});

describe('a street’s name through the corridor’s pack — #3245', () => {
  it('keeps a paintable name through the store’s gzip and back, and packs no `n` for a street with none', async () => {
    const back = await unpackCorridorFeatures(
      await packCorridorFeatures(features([street('Testpack Road'), street()])),
    );
    expect(back.streets.map((each) => each.name)).toStrictEqual(['Testpack Road', undefined]);
    expect('name' in (back.streets[1] as object)).toBe(false);
    const packed = packedCorridorFeatures(features([street('Testpack Road'), street()]));
    expect(packed.streets.map((each) => each.n)).toStrictEqual(['Testpack Road', undefined]);
    expect('n' in (packed.streets[1] as object)).toBe(false);
  });

  it('keeps no name the atlas cannot paint whole, nor one past 48 characters', () => {
    const packed = packedCorridorFeatures(
      features([street('TestЖ Road'), street('Test‮ Road'), street('T'.repeat(49))]),
    );
    expect(packed.streets.some((each) => 'n' in each)).toBe(false);
  });

  it('holds a packed name to the rule again: an edited blob’s number, control character or long string is no name', () => {
    const packed = packedCorridorFeatures(features([street('Testpack Road')]));
    const edited = (n: unknown): PackedCorridorFeatures => ({
      ...packed,
      streets: [
        { ...(packed.streets[0] as PackedCorridorFeatures['streets'][number]), n } as never,
      ],
    });
    for (const n of [42, 'Test\u0007 Road', 'x'.repeat(49), '   ', null]) {
      expect(corridorFeaturesOfPacked(edited(n)).streets[0]?.name).toBeUndefined();
    }
    expect(corridorFeaturesOfPacked(edited(' Testpack Road ')).streets[0]?.name).toBe(
      'Testpack Road',
    );
  });
});
