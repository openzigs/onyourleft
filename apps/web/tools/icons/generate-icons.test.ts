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

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { RIDER_MARK_PIXELS } from '../realistic/sources';
import { decodePng, drawMark, encodePng } from './generate-icons';

/**
 * The mark's raw pixels, as SHA-256, taken from `main`'s drawing before #965
 * (`git show origin/main:apps/web/tools/icons/generate-icons.ts`).
 *
 * ⚠️ **This is the only thing in CI that pins the drawing.** The realistic
 * kit's committed colour map is made from `drawMark(RIDER_MARK_PIXELS)`, and
 * the one check that would notice a change there, `realistic:process --check`,
 * needs Blender and never runs in CI. Until #965 the icon comparison caught a
 * changed stroke; since the icons are the owner's art, this does (#969's
 * review: `STROKE_HALF_WIDTH` 0.055 → 0.07 was green everywhere else). A
 * deliberate change to the mark is a change to the kit: re-run
 * `realistic:process` and re-take these in the same commit.
 */
const MARK_DIGESTS: Readonly<Record<number, string>> = {
  [RIDER_MARK_PIXELS]: '99f444825016aeadde84052bc11a3d5a0c74514ce628b484cf27cf01665f86b5',
  16: '76bde774aeea8aed63af1cfecae296254c43a27e5f4a1407e016ad31d92c4e78',
};

describe('the kit’s two-chevron mark', () => {
  it.each(Object.entries(MARK_DIGESTS))(
    'draws exactly the pixels it drew before #965 at %s px',
    (size, digest) => {
      const pixels = drawMark(Number(size));
      expect(createHash('sha256').update(pixels).digest('hex')).toBe(digest);
    },
  );

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
