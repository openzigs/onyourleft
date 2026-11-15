// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2514's roadside bands: either side of the road, mirror images, from the
 * frame's edge in to the carriageway, and below the horizon — so a red
 * reading in `ride-delivery.browser.spec.ts` is about a panel and not about a
 * band drawn in the wrong place.
 */

import { describe, expect, it } from 'vitest';

import { roadsideBands } from './roadside-bands';

const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 800, height: 1280 },
] as const;

describe('the roadside bands a Delivery round’s houses stand in — #2514', () => {
  for (const viewport of VIEWPORTS) {
    const name = `${String(viewport.width)}×${String(viewport.height)}`;
    it(`are mirror images either side of the road, from the frame’s edge in, at ${name}`, () => {
      const { left, right } = roadsideBands(viewport);
      expect(left.left).toBe(0);
      expect(right.right).toBe(viewport.width);
      expect(left.right).toBeLessThan(viewport.width / 2);
      expect(right.left).toBeGreaterThan(viewport.width / 2);
      expect(left.right).toBeCloseTo(viewport.width - right.left, 6);
      expect(left.top).toBeCloseTo(right.top, 6);
      expect(left.bottom).toBeCloseTo(right.bottom, 6);
      // Below the top of the frame and above its foot: the road's middle band.
      expect(left.top).toBeGreaterThan(viewport.height / 4);
      expect(left.bottom).toBeLessThan(viewport.height * 0.75);
    });
  }
});
