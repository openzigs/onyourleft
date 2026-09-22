// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { REALISTIC_LADDER, type QualitySettings } from '../../src/game/quality';
import { STRUCTURE_KINDS, type SceneryKind } from '../../src/game/scatter';
import { corridorOrigin } from '../../src/game/terrain';
import { rideFrame } from './frame';
import { realisticRoute } from './route';

const profile = realisticRoute();
const origin = corridorOrigin(profile);
const structures = new Set<SceneryKind>(STRUCTURE_KINDS);

/** How many scenery items and how many structures one frame of the ride carries. */
function carried(
  rung: Pick<QualitySettings, 'scatterItems' | 'structureItems'>,
  distance: number,
): { readonly scenery: number; readonly structures: number } {
  const frame = rideFrame({ profile, origin, distance, elapsed: 10, rung });
  const built = frame.scatter.filter((item) => structures.has(item.kind)).length;
  return { scenery: frame.scatter.length - built, structures: built };
}

describe('the realistic page’s frames carry the rung’s scenery budget, as GameView’s do — #478', () => {
  // Distances where the route passes woodland and the farmstead, so that the
  // top rung actually carries more than a reduced one allows.
  const along = [900, 2_550, 3_200];

  it('carries no more than a small rung allows, scenery and structures each', () => {
    for (const distance of along) {
      const frame = carried({ scatterItems: 5, structureItems: 2 }, distance);
      expect(frame.scenery, `${String(distance)} m`).toBeLessThanOrEqual(5);
      expect(frame.structures, `${String(distance)} m`).toBeLessThanOrEqual(2);
    }
  });

  it('carries less on the second realistic rung than on the first — the soak’s ladder', () => {
    const top = REALISTIC_LADDER[0] as QualitySettings;
    const reduced = REALISTIC_LADDER[1] as QualitySettings;
    let topTotal = 0;
    let reducedTotal = 0;
    for (const distance of along) {
      const atTop = carried(top, distance);
      const atReduced = carried(reduced, distance);
      expect(atReduced.scenery).toBeLessThanOrEqual(reduced.scatterItems);
      expect(atReduced.structures).toBeLessThanOrEqual(reduced.structureItems);
      topTotal += atTop.scenery + atTop.structures;
      reducedTotal += atReduced.scenery + atReduced.structures;
    }
    // The control: the route is dense enough that the top rung carries more, so
    // the bound above is the budget and not an empty valley.
    expect(topTotal).toBeGreaterThan(reducedTotal);
  });
});
