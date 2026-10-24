// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1564's renderer half: `three-renderer.ts` §`PavementBelt` merges every
 * front path in view into the pavements' ONE mesh, one geometry group a
 * path, and its control switch takes them out again — leaving the pavements.
 */

import { describe, expect, it } from 'vitest';

import { northRoute } from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import { streetsAt } from './streets';
import { corridorOrigin } from './terrain';
import { PavementBelt } from './three-renderer';

const FARMLAND = northRoute(6_000, () => 40);

describe('the front paths, drawn — #1564', () => {
  const streets = streetsAt(
    FARMLAND,
    corridorOrigin(FARMLAND),
    scatterSeed(FARMLAND),
    0,
    FARMLAND.totalDistance,
  );
  const pavementIndices = streets.reduce((sum, street) => sum + street.pavement.indices.length, 0);
  const pathIndices = streets.map((street) =>
    street.doorPaths.map((path) => path.mesh.indices.length),
  );
  const paths = pathIndices.flat();

  it('draws every path in the pavements’ one mesh, one group a path after the pavements', () => {
    // Non-vacuity: villages with paths.
    expect(paths.length).toBeGreaterThan(30);
    for (const world of ['stylised', 'realistic'] as const) {
      const belt = new PavementBelt(world);
      belt.update(streets);
      const { geometry } = belt.mesh;
      expect(belt.mesh.visible).toBe(true);
      expect(geometry.index?.count).toBe(pavementIndices + paths.reduce((a, b) => a + b, 0));
      expect(geometry.groups.map((group) => group.count)).toEqual(paths);
      expect(geometry.groups[0]?.start).toBe(pavementIndices);
      // One material, so one draw call whatever the groups.
      expect(Array.isArray(belt.mesh.material)).toBe(false);
      belt.dispose();
    }
  });

  it('takes the paths out, and only the paths, when they are switched off, and back again', () => {
    const belt = new PavementBelt('stylised');
    belt.update(streets);
    belt.switchPathsOn(false);
    belt.update(streets);
    expect(belt.mesh.geometry.groups).toEqual([]);
    expect(belt.mesh.geometry.index?.count).toBe(pavementIndices);
    expect(belt.mesh.visible).toBe(true);
    belt.switchPathsOn(true);
    belt.update(streets);
    expect(belt.mesh.geometry.groups).toHaveLength(paths.length);
    belt.dispose();
  });
});
