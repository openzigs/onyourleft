// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1550: a procedural lot's rules ask nothing of the heap — `settlements.ts`
 * §`lotStands` and the mapped footprints' index, which run for every lot in
 * view, every frame, inside `structuresAt` (#240 NFR-3, #469).
 *
 * ⚠️ **A file of its own, on purpose.** What allocates here is a number boxed
 * at a call V8 did not inline, and whether it inlines depends on how many
 * shapes of mask and town a call site has seen. A ride sees one of each;
 * `settlements-lots.test.ts` hands the same functions half a dozen, and
 * measured there this reads ~140 bytes a query that no ride pays. Vitest gives
 * each file its own module instances, so here the call sites see what a ride's do.
 */

import { getHeapStatistics, GCProfiler } from 'node:v8';

import { describe, expect, it } from 'vitest';

import { footprintPlans, mappedTown } from './footprint-buildings';
import { buildingBeside, landBeside, rectangleBeside } from './footprint-fixtures-testing';
import { landClassMask } from './land-class';
import { northRoute } from './route-fixtures-testing';
import {
  LOT_FLOATS,
  SETBACK_METRES,
  STRUCTURE_FOOTPRINTS,
  lotStands,
  placeLot,
} from './settlements';
import { corridorOrigin, drawnRoadFrame } from './terrain';
import type { WorldCorridor } from './world-data/corridor';

describe('#1550 the per-lot queries are allocation-free — #240 NFR-3', () => {
  it('asks lotStands 10^5 times with no heap growth and no collection', () => {
    // A residential town beside 400 m of level road, with two footprints in
    // it, so the sweep takes every branch: off the land, on a footprint, and clear.
    const profile = northRoute(2_000, () => 10);
    const origin = corridorOrigin(profile);
    const corridor: WorldCorridor = {
      routeId: 'lots-heap',
      origin,
      covered: () => true,
      coveredBoxes: [{ minX: -3_000, maxX: 3_000, minZ: -3_000, maxZ: 3_000 }],
      landUse: [landBeside(profile, origin, 'landuse', 'residential', 500, 900, -60, 60)],
      buildings: [
        buildingBeside(profile, origin, [rectangleBeside(600, 20, 14, 10)], 6),
        buildingBeside(profile, origin, [rectangleBeside(660, -22, 12, 12)], 9.5),
      ],
      paths: [],
      streets: [],
    };
    const land = landClassMask(corridor);
    const town = mappedTown(corridor, footprintPlans(corridor, land, profile, origin).plans);
    const frame = drawnRoadFrame(profile, origin, 500);
    if (frame === undefined) throw new Error('no road');
    let sink = 0;
    let misses = 0;
    const lot = new Float64Array(LOT_FLOATS);
    const sweep = (count: number): void => {
      for (let i = 0; i < count; i += 1) {
        const along = (i * 3.7) % 400;
        const side = i % 2 === 0 ? 1 : -1;
        const x = frame.x + frame.normalX * SETBACK_METRES * side + frame.normalZ * along;
        const z = frame.z + frame.normalZ * SETBACK_METRES * side - frame.normalX * along;
        placeLot(lot, x, z, STRUCTURE_FOOTPRINTS.building, i * 0.1);
        if (lotStands(land, town, lot)) sink += 1;
        else misses += 1;
      }
    };
    sweep(300_000);
    const attempts: string[] = [];
    let measured = false;
    for (let attempt = 0; attempt < 8 && !measured; attempt += 1) {
      const profiler = new GCProfiler();
      profiler.start();
      const before = getHeapStatistics().used_heap_size;
      sweep(100_000);
      const after = getHeapStatistics().used_heap_size;
      const { statistics } = profiler.stop();
      if (statistics.length > 0) {
        attempts.push('collected');
        continue;
      }
      measured = true;
      // Ten bytes a query would be a megabyte; the window's own bookkeeping is far below this.
      expect(after - before).toBeLessThan(64 * 1024);
    }
    expect(measured, attempts.join(', ')).toBe(true);
    // Non-vacuity: some lots stand and some do not.
    expect(sink).toBeGreaterThan(0);
    expect(misses).toBeGreaterThan(0);
  });
});
