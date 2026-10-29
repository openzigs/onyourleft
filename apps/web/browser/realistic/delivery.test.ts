// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The owner's page's `?delivery=` round — #1815: every piece of #1814's worst
 * case is handed to the frame, every obstacle kind among them, on the road
 * ahead of the rider, and the page refuses a count the belt would not draw.
 */

import { describe, expect, it } from 'vitest';

import { VILLAGE_HOLD_METRES, villageRoute } from '../../src/demo/synthetic-road';
import { REALISTIC_LADDER, type QualitySettings } from '../../src/game/quality';
import { corridorOrigin } from '../../src/game/terrain';
import { DELIVERY_PIECE_CAPACITY } from '../../src/game/three-renderer';

import { configQuery, DELIVERY_PIECES_MOST, parseConfig } from './config';
import { DELIVERY_AHEAD_METRES, DELIVERY_SPACING_METRES, deliveryAhead } from './delivery';
import { rideFrame } from './frame';

const profile = villageRoute();
const frame = rideFrame({
  profile,
  origin: corridorOrigin(profile),
  distance: VILLAGE_HOLD_METRES,
  elapsed: 0,
  rung: REALISTIC_LADDER[0] as QualitySettings,
});

/** The centreline point nearest `x`, `z`, and its `along`. */
function alongOf(x: number, z: number): number {
  let best = frame.corridor.centre[0];
  for (const point of frame.corridor.centre) {
    if (
      best === undefined ||
      Math.hypot(point.x - x, point.z - z) < Math.hypot(best.x - x, best.z - z)
    ) {
      best = point;
    }
  }
  return best?.along ?? Number.NaN;
}

describe('the realistic page’s Delivery round — #1815', () => {
  it('hands the frame the count the URL asks for, of each piece, every obstacle kind among them', () => {
    const count = parseConfig('?route=village&delivery=20').delivery ?? 0;
    expect(count).toBe(20);
    const round = deliveryAhead(frame, VILLAGE_HOLD_METRES, count);
    expect(round.parcels).toHaveLength(20);
    expect(round.markers).toHaveLength(20);
    expect(round.obstacles).toHaveLength(20);
    expect(new Set(round.obstacles.map((obstacle) => obstacle.kind))).toEqual(
      new Set(['bin', 'trolley', 'cone']),
    );
  });

  it('stands each piece on the road ahead of the rider, the first 10 m on and each 2 m after', () => {
    const round = deliveryAhead(frame, VILLAGE_HOLD_METRES, 5);
    round.obstacles.forEach((obstacle, index) => {
      const along = alongOf(obstacle.x, obstacle.z);
      const wanted = VILLAGE_HOLD_METRES + DELIVERY_AHEAD_METRES + DELIVERY_SPACING_METRES * index;
      // Within one corridor point's spacing of where it was asked for.
      expect(Math.abs(along - wanted), `obstacle ${String(index)}`).toBeLessThan(3);
    });
    // Beside the road, not on the rider: every marker is off the centreline.
    for (const marker of round.markers) {
      const nearest = frame.corridor.centre.reduce((best, point) =>
        Math.hypot(point.x - marker.x, point.z - marker.z) <
        Math.hypot(best.x - marker.x, best.z - marker.z)
          ? point
          : best,
      );
      expect(Math.hypot(nearest.x - marker.x, nearest.z - marker.z)).toBeGreaterThan(4);
    }
  });

  it('hands no round to a frame whose URL asks for none, as an ordinary ride’s', () => {
    expect(parseConfig('?route=village').delivery).toBeUndefined();
  });

  it('refuses a count the belt would not draw, rather than measuring 32 under its name', () => {
    expect(DELIVERY_PIECES_MOST).toBe(DELIVERY_PIECE_CAPACITY);
    expect(parseConfig(`?delivery=${String(DELIVERY_PIECES_MOST)}`).delivery).toBe(32);
    for (const value of ['0', '33', '1.5', 'many', '']) {
      expect(() => parseConfig(`?delivery=${value}`), value).toThrow(
        /delivery is a whole number from 1 to 32/,
      );
    }
  });

  it('writes the round back as the same configuration', () => {
    const config = parseConfig('?route=village&at=820&delivery=20');
    expect(configQuery(config)).toBe('?at=820&route=village&delivery=20');
    expect(parseConfig(configQuery(config))).toEqual(config);
  });
});
