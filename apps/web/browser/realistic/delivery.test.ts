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

  it('stands each piece on the road ahead of the rider, the first 10 m on and each 2 m after, parcels and markers to its right and obstacles to its left', () => {
    const round = deliveryAhead(frame, VILLAGE_HOLD_METRES, 5);
    // The numbers are written here, not read from delivery.ts, so changing them there fails this.
    expect(DELIVERY_AHEAD_METRES).toBe(10);
    expect(DELIVERY_SPACING_METRES).toBe(2);
    const centre = frame.corridor.centre;
    /** Where `piece` stands: along the road, and signed metres across it (positive to the right). */
    const stood = (piece: { readonly x: number; readonly z: number }) => {
      let index = 0;
      centre.forEach((point, at) => {
        const best = centre[index];
        if (
          best === undefined ||
          Math.hypot(point.x - piece.x, point.z - piece.z) <
            Math.hypot(best.x - piece.x, best.z - piece.z)
        ) {
          index = at;
        }
      });
      const at = centre[index];
      const from = centre[Math.max(0, index - 1)];
      const to = centre[Math.min(centre.length - 1, index + 1)];
      if (at === undefined || from === undefined || to === undefined) throw new Error('no road');
      const length = Math.hypot(to.x - from.x, to.z - from.z);
      const headingX = (to.x - from.x) / length;
      const headingZ = (to.z - from.z) / length;
      return {
        along: at.along,
        across: -headingZ * (piece.x - at.x) + headingX * (piece.z - at.z),
      };
    };
    round.obstacles.forEach((obstacle, index) => {
      const wanted = VILLAGE_HOLD_METRES + 10 + 2 * index;
      // Within one corridor point's spacing of where it was asked for.
      expect(Math.abs(stood(obstacle).along - wanted), `obstacle ${String(index)}`).toBeLessThan(3);
    });
    for (const marker of round.markers) expect(stood(marker).across).toBeCloseTo(6, 0);
    for (const parcel of round.parcels) {
      expect(stood(parcel).across).toBeCloseTo(3, 0);
      expect(parcel.y - (frame.corridor.centre[0]?.y ?? 0)).toBeGreaterThan(0.5);
    }
    for (const obstacle of round.obstacles) expect(stood(obstacle).across).toBeCloseTo(-1.5, 0);
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
