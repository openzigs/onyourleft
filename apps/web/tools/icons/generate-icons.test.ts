// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The house kit's mark, and the PNG writer the realistic pipeline hands it
 * through (#405, #623).
 *
 * ⚠️ **Until #965 this file compared `public/icon-*.png` with the drawing.**
 * The app's icons are the owner's art now, cut by `tools/brand/derive_brand.py`
 * and held by `tools/brand/provenance.test.ts`; what this file still owns is
 * the mark the realistic rider's jersey wears, whose bytes the kit's committed
 * colour map depends on (`realistic:process --check`).
 */

import { describe, expect, it } from 'vitest';

import { decodePng, drawMark, encodePng } from './generate-icons';

describe('the kit’s two-chevron mark', () => {
  it('round-trips through this module’s own encoder and decoder', () => {
    const pixels = drawMark(64);
    expect([...decodePng(encodePng(64, pixels)).pixels]).toEqual([...pixels]);
  });

  it('is symmetric top to bottom, and points left', () => {
    const size = 64;
    const pixels = drawMark(size);
    const at = (x: number, y: number): number => pixels[(y * size + x) * 3] ?? -1;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        expect(at(x, y)).toBe(at(x, size - 1 - y));
      }
    }
    // The leftmost covered column is on the middle row: the chevrons' tips.
    const leftmost = (y: number): number => {
      for (let x = 0; x < size; x += 1) if (at(x, y) > 127) return x;
      return size;
    };
    expect(leftmost(size / 2)).toBeLessThan(leftmost(Math.round(size * 0.3)));
  });

  it('is white where the chevrons are and black where they are not', () => {
    const pixels = drawMark(32);
    expect(Math.max(...pixels)).toBe(255);
    expect(Math.min(...pixels)).toBe(0);
  });
});
