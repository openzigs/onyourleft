// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1696: what `urban-class.ts`' sweep asks of the road, counted. Its own file
 * because it spies on `road-grid.ts`, which every other suite reads unspied.
 *
 * The slow path asked the road's cells for every one of 100 samples a road
 * point: 4.2 million searches on a 250 km route, 5.2 s at the press in
 * Chromium. Beside a road that never passes near itself, the sweep now asks
 * one disc a side of each road point and nothing else.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { landClassMask } from './land-class';
import * as roadGrid from './road-grid';
import { hairpinRoute, northRoute } from './route-fixtures-testing';
import { corridorOrigin } from './terrain';
import { urbanClassMap } from './urban-class';

vi.mock(import('./road-grid'), { spy: true });

/** A corridor with map data everywhere and nothing on it. */
function emptyCorridor(profile: ReturnType<typeof northRoute>) {
  return {
    routeId: 'sweep',
    origin: corridorOrigin(profile),
    covered: () => true,
    coveredBoxes: [{ minX: -2_000, maxX: 2_000, minZ: -2_000, maxZ: 12_000 }],
    landUse: [],
    buildings: [],
    paths: [],
    streets: [],
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('urbanClassMap — the sweep beside a road that never passes near itself (#1696)', () => {
  it('asks no sample of a 10 km straight road where its nearest road is', () => {
    const profile = northRoute(10_000, () => 0);
    const corridor = emptyCorridor(profile);
    const map = urbanClassMap(corridor, landClassMask(corridor), profile);
    expect(map.classAt(5_000)).toBe('rural');
    const road = roadGrid.drawnRoadPoints(profile, corridorOrigin(profile));
    const stride = Math.max(1, Math.round(5 / road.step));
    const swept = Math.ceil(road.points.length / 2 / stride);
    // Counts rather than `toHaveBeenCalled`: a failure would otherwise print every one of the calls.
    expect(vi.mocked(roadGrid.roadSegmentsNear).mock.calls.length).toBe(0);
    expect(vi.mocked(roadGrid.nearestOnWholeRoad).mock.calls.length).toBe(0);
    // One disc either side of each road point swept.
    expect(vi.mocked(roadGrid.otherRoadWithin).mock.calls.length).toBe(swept * 2);
  });

  it('still asks each sample where the route comes back within its own sweep', () => {
    const profile = hairpinRoute(100);
    const corridor = emptyCorridor(profile);
    urbanClassMap(corridor, landClassMask(corridor), profile);
    expect(vi.mocked(roadGrid.nearestOnWholeRoad).mock.calls.length).toBeGreaterThan(0);
  });
});
