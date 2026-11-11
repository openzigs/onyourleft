// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2453's sighting on the owner's page: ONE house marker and ONE pick-up
 * point placed where the spec says, and the pixels a piece changed counted
 * as changed, so a red reading on the realistic page is about the piece and
 * not about where the page stood it.
 */

import { describe, expect, it } from 'vitest';

import { VILLAGE_HOLD_METRES, villageRoute } from '../../src/demo/synthetic-road';
import { REALISTIC_LADDER, type QualitySettings } from '../../src/game/quality';
import { corridorOrigin, type CorridorPoint } from '../../src/game/terrain';

import { rideFrame } from './frame';
import {
  changedPixels,
  oneMarkerAhead,
  onePickUpAhead,
  SIGHTED_MARKER_ACROSS_METRES,
} from './sighting';

const profile = villageRoute();
const frame = rideFrame({
  profile,
  origin: corridorOrigin(profile),
  distance: VILLAGE_HOLD_METRES,
  elapsed: 0,
  rung: REALISTIC_LADDER[0] as QualitySettings,
});
const centre = frame.corridor.centre;

/** Where `piece` stands: along the road, and signed metres across it (positive to the right). */
function stood(piece: { readonly x: number; readonly z: number }): {
  along: number;
  across: number;
} {
  let index = 0;
  centre.forEach((point, at) => {
    const best = centre[index] as CorridorPoint;
    if (
      Math.hypot(point.x - piece.x, point.z - piece.z) <
      Math.hypot(best.x - piece.x, best.z - piece.z)
    ) {
      index = at;
    }
  });
  const at = centre[index] as CorridorPoint;
  const next = centre[Math.min(centre.length - 1, index + 1)] as CorridorPoint;
  const back = centre[Math.max(0, index - 1)] as CorridorPoint;
  const length = Math.hypot(next.x - back.x, next.z - back.z);
  const [headingX, headingZ] = [(next.x - back.x) / length, (next.z - back.z) / length];
  return { along: at.along, across: -(piece.x - at.x) * headingZ + (piece.z - at.z) * headingX };
}

describe('the realistic page’s sighting — #2453', () => {
  it('stands one house marker the asked distance up the road, past the pavement on the right, facing the road', () => {
    expect(SIGHTED_MARKER_ACROSS_METRES).toBe(8);
    const placed = oneMarkerAhead(frame, VILLAGE_HOLD_METRES, 100);
    expect(placed.parcels).toEqual([]);
    expect(placed.obstacles).toEqual([]);
    expect(placed.markers).toHaveLength(1);
    const marker = placed.markers[0];
    if (marker === undefined) throw new Error('no marker');
    const where = stood(marker);
    expect(Math.abs(where.along - (VILLAGE_HOLD_METRES + 100))).toBeLessThanOrEqual(3);
    expect(where.across).toBeCloseTo(8, 1);
    // Its own +z, turned by its yaw, points back across the road towards the centre.
    expect(
      stood({ x: marker.x + Math.sin(marker.yaw), z: marker.z + Math.cos(marker.yaw) }).across,
    ).toBeCloseTo(7, 1);
  });

  it('stands one pick-up point across the road’s centre the asked distance up it, by the product’s own placement', () => {
    const placed = onePickUpAhead(frame, VILLAGE_HOLD_METRES, 100);
    expect(placed.hazards).toEqual([]);
    expect(placed.pickUps).toHaveLength(1);
    const where = stood(placed.pickUps[0] as { x: number; z: number });
    expect(Math.abs(where.along - (VILLAGE_HOLD_METRES + 100))).toBeLessThanOrEqual(3);
    expect(Math.abs(where.across)).toBeLessThan(0.1);
  });

  it('refuses a piece off the frame’s corridor, naming no position', () => {
    expect(() => oneMarkerAhead(frame, VILLAGE_HOLD_METRES, 5_000)).toThrow(
      /must stand on the frame’s corridor$/,
    );
    expect(() => onePickUpAhead(frame, VILLAGE_HOLD_METRES, 5_000)).toThrow(
      /must be on the corridor$/,
    );
  });

  it('counts the pixels that changed and the rows and columns they span, and none for the same frame', () => {
    const width = 4;
    const height = 3;
    const without = new Uint8Array(width * height * 4).fill(10);
    expect(changedPixels(without, without.slice(), width, height)).toEqual({
      changed: 0,
      rows: 0,
      columns: 0,
    });
    const withIt = without.slice();
    // Two pixels changed: row 0 column 1 (red), row 2 column 3 (blue). Alpha alone is no change.
    withIt[(0 * width + 1) * 4] = 200;
    withIt[(2 * width + 3) * 4 + 2] = 200;
    withIt[(1 * width + 0) * 4 + 3] = 0;
    expect(changedPixels(without, withIt, width, height)).toEqual({
      changed: 2,
      rows: 3,
      columns: 3,
    });
  });
});
