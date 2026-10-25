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
import { circuitRoute, hairpinRoute, northRoute, stadiumRoute } from './route-fixtures-testing';
import { corridorOrigin } from './terrain';
import { URBAN_SAMPLE_METRES, urbanClassMap } from './urban-class';
import { CORRIDOR_HALF_WIDTH_METRES } from './world-data/corridor';

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

/**
 * The samples the sweep counted, as the mask was asked for them, in order: `x,z` to the millimetre.
 */
function countedSamples(profile: ReturnType<typeof northRoute>): string[] {
  const corridor = emptyCorridor(profile);
  const mask = landClassMask(corridor);
  const asked: string[] = [];
  urbanClassMap(
    corridor,
    {
      ...mask,
      classAt: (x, z) => {
        asked.push(`${x.toFixed(3)},${z.toFixed(3)}`);
        return mask.classAt(x, z);
      },
    },
    profile,
  );
  return asked;
}

/**
 * The samples the sweep counted before #1696: each asks the road's cells for the nearest pass and is
 * left out where that is a different stretch of road than the one it was taken from.
 */
function countedByTheCells(profile: ReturnType<typeof northRoute>): string[] {
  const origin = corridorOrigin(profile);
  const road = roadGrid.drawnRoadPoints(profile, origin);
  const points = road.points;
  const count = points.length / 2;
  const stride = Math.max(1, Math.round(URBAN_SAMPLE_METRES / road.step));
  const tolerance = stride * road.step;
  const reach = Math.floor(CORRIDOR_HALF_WIDTH_METRES / URBAN_SAMPLE_METRES);
  const total = (count - 1) * road.step;
  const beside = { along: 0, lateral: 0, distance: 0 };
  const segments: number[] = [];
  const out: string[] = [];
  for (let point = 0; point < count; point += stride) {
    const along = Math.min(total, point * road.step);
    const from = point + 1 < count ? point : point - 1;
    const dx = (points[from * 2 + 2] as number) - (points[from * 2] as number);
    const dz = (points[from * 2 + 3] as number) - (points[from * 2 + 1] as number);
    const length = Math.hypot(dx, dz);
    for (let step = -reach; step <= reach; step += 1) {
      const lateral = step * URBAN_SAMPLE_METRES;
      const x = (points[point * 2] as number) + (-dz / length) * lateral;
      const z = (points[point * 2 + 1] as number) + (dx / length) * lateral;
      if (step !== 0) {
        const near = roadGrid.roadSegmentsNear(
          profile,
          origin,
          x,
          z,
          Math.abs(lateral) + 1,
          segments,
        );
        if (
          roadGrid.nearestOnRoadSegments(near, segments, x, z, beside) &&
          Math.abs(beside.along - along) > tolerance
        ) {
          continue;
        }
      }
      out.push(`${x.toFixed(3)},${z.toFixed(3)}`);
    }
  }
  return out;
}

describe('urbanClassMap — which samples it counts is what the cells said (#1696)', () => {
  // A loop's closing segment ends on its first point, so the far disc's edge touches it exactly: a
  // tie only the millimetre of slack on the clearing disc sends to the per-sample search.
  it.each([
    ['a circuit of radius 400 m', circuitRoute(400)],
    ['a stadium of radius 60 m', stadiumRoute(60)],
    ['a hairpin of radius 6 m', hairpinRoute(6)],
  ])('counts the samples of %s that the cells counted', (_, profile) => {
    const now = countedSamples(profile);
    const before = countedByTheCells(profile);
    expect(now.length).toBe(before.length);
    let differ = 0;
    for (const [index, sample] of before.entries()) if (now[index] !== sample) differ += 1;
    expect(differ).toBe(0);
  });
});
