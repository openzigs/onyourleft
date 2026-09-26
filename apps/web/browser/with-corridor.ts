// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A scene frame re-built around a different road corridor — #543.
 *
 * Two harnesses draw a corridor `sceneFrame` did not build: `bend-harness.ts`
 * and `loop-harness.ts` both draw the road as it was before #543 as their
 * control. The ground and the water are built FROM the corridor
 * (`landform.ts`'s innermost column is the road's edge), so a road swapped in
 * on its own lies on ground shaped for another road: on the first run of the
 * loop page the smoothed ground's verge stood over the unsmoothed road and
 * split 32 rows of it in two. This rebuilds all three from one corridor, the
 * way `scene.ts` §`sceneFrame` does.
 */

import type { RouteProfile } from '@onyourleft/domain';

import { terrainCorridor } from '../src/game/landform';
import type { SceneFrame } from '../src/game/port';
import { scatterSeed } from '../src/game/scatter';
import type { CorridorOrigin, RoadCorridor } from '../src/game/terrain';
import { bridgeParts, waterSurface, waterways } from '../src/game/waterways';

export function withCorridor(
  frame: SceneFrame,
  profile: RouteProfile,
  origin: CorridorOrigin,
  corridor: RoadCorridor,
): SceneFrame {
  const seed = scatterSeed(profile);
  const ways = waterways(profile, seed);
  return {
    ...frame,
    corridor,
    terrain: { ...frame.terrain, mesh: terrainCorridor(profile, origin, corridor, seed) },
    water: {
      ...frame.water,
      surface: waterSurface(profile, origin, corridor, ways),
      bridges: bridgeParts(profile, origin, corridor, ways),
    },
  };
}
