// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3132: a building mapped in parts is drawn by its parts — `part-outlines.ts`.
 * Footprints written here in metres: no OpenStreetMap data.
 */

import { NO_BUILDING_FIELDS, type BuildingFeature } from '@onyourleft/map-features';
import { describe, expect, it } from 'vitest';

import { withoutPartOutlines } from './part-outlines';

function square(
  x: number,
  z: number,
  side: number,
  kind: BuildingFeature['kind'] = 'building',
): BuildingFeature {
  return {
    ...NO_BUILDING_FIELDS,
    kind,
    rings: [Float32Array.of(x, z, x + side, z, x + side, z + side, x, z + side)],
    heightMetres: 12,
    minHeightMetres: null,
  };
}

describe('withoutPartOutlines — #3132', () => {
  it('leaves out the outline that holds a part, and keeps every part and every other building', () => {
    const outline = square(0, 0, 20);
    const part = square(0, 0, 10, 'building_part');
    const other = square(100, 0, 20);
    expect(withoutPartOutlines([outline, part, other])).toStrictEqual([part, other]);
  });

  it('keeps an outline whose part stands elsewhere, and hands back the same array with no part', () => {
    const outline = square(0, 0, 20);
    const away = square(50, 50, 10, 'building_part');
    expect(withoutPartOutlines([outline, away])).toStrictEqual([outline, away]);
    const none = [outline, square(30, 0, 10)];
    expect(withoutPartOutlines(none)).toBe(none);
  });

  it('keeps both once its work is spent: a building drawn twice, never one drawn not at all', () => {
    const both = [square(0, 0, 20), square(0, 0, 10, 'building_part')];
    expect(withoutPartOutlines(both, 0)).toStrictEqual(both);
  });
});
