// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A frame a caller may hold across another build — #469.
 *
 * Since #469 the ground's and the water's arrays are LENT: `landform.ts`
 * §`TerrainMesh.lease` and `waterways.ts` §`WaterSurface.lease`. The ride
 * loop builds a frame and draws it at once, which is all lending has to
 * survive. A test or a harness that builds two frames and then compares or
 * draws the first would read the second's ground and water in it — and a
 * comparison of a buffer with itself passes, which is the vacuous pass #468's
 * review predicted pooling would cause. So such a caller takes a copy here.
 *
 * A **`-testing.ts`**: nothing that ships holds a frame, and `check:wiring`
 * reads the suffix as test support rather than as a module the product fails
 * to import.
 */

import type { SceneFrame } from './port';

/** `frame`, with its lent buffers copied out and its leases dropped. */
export function retainedFrame(frame: SceneFrame): SceneFrame {
  const mesh = frame.terrain.mesh;
  const surface = frame.water.surface;
  return {
    ...frame,
    terrain: {
      ...frame.terrain,
      mesh: {
        ...mesh,
        vertices: mesh.vertices.slice(),
        normals: mesh.normals.slice(),
        colours: mesh.colours.slice(),
        fields: mesh.fields.slice(),
        // Owned now, so no build can write over it.
        lease: undefined,
      },
    },
    water: {
      ...frame.water,
      surface: {
        ...surface,
        vertices: surface.vertices.slice(),
        shore: surface.shore.slice(),
        indices: surface.indices.slice(),
        lease: undefined,
      },
    },
  };
}
