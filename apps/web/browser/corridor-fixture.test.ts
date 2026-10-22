// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1546's browser case, in Node, on the same synthetic archive's tiles: what
 * `corridor-harness.ts` publishes for `corridor.browser.spec.ts` §"#1546
 * nothing on a mapped wood". Here so that a fixture that stopped putting a
 * procedural building in the wood — which would leave the browser control
 * unable to fail — is a red unit test before it is a red browser run.
 */

import { describe, expect, it } from 'vitest';

import {
  decodeTile,
  type BuildingFeature,
  type LandUseFeature,
  type StreetFeature,
} from '@onyourleft/map-features';

import { footprintPlans } from '../src/game/footprint-buildings';
import { landClassMask } from '../src/game/land-class';
import { corridorOrigin } from '../src/game/terrain';
import { planCorridor, worldCorridorOf } from '../src/game/world-data/corridor';
import {
  classedItems,
  CORRIDOR_FIXTURE_VERDICTS,
  corridorFixtureRoute,
  corridorFixtureTiles,
  drawnJunctions,
  FIXTURE_JUNCTIONS,
} from './corridor-fixture';

function fixtureCorridor() {
  const profile = corridorFixtureRoute();
  const plan = planCorridor(profile.positions, []);
  if (plan === undefined) throw new Error('the fixture route plans no corridor');
  const landUse: LandUseFeature[] = [];
  const streets: StreetFeature[] = [];
  for (const tile of corridorFixtureTiles()) {
    const decoded = decodeTile(tile.bytes, { z: 15, x: tile.x, y: tile.y }, plan.frame);
    if ('reason' in decoded) throw new Error(`a fixture tile was refused: ${decoded.reason}`);
    landUse.push(...decoded.landUse);
    streets.push(...decoded.streets);
  }
  return worldCorridorOf('fixture', corridorOrigin(profile), plan.tiles, {
    landUse,
    buildings: [],
    paths: [],
    streets,
  });
}

describe('#1546 nothing on a mapped wood — the browser case’s fixture', () => {
  const corridor = fixtureCorridor();
  const mask = landClassMask(corridor);
  const blocked = new Set(['wood', 'water', 'park']);

  it('stands no structure on wood, water or park ground', () => {
    const items = classedItems(corridor, mask, mask);
    expect(items.length).toBeGreaterThan(0);
    expect(items.filter((item) => item.structure && blocked.has(item.landClass))).toStrictEqual([]);
  });

  it('control: with no mask, at least one procedural building stands inside the wood', () => {
    const items = classedItems(corridor, undefined, mask);
    expect(
      items.filter(
        (item) => item.structure && item.kind !== 'signpost' && item.landClass === 'wood',
      ).length,
    ).toBeGreaterThan(0);
  });
});

describe('#1540 the plans’ verdicts — the browser case’s fixture', () => {
  it('drops the wood’s footprint and plans the residential block’s, exactly as the page must', () => {
    const profile = corridorFixtureRoute();
    const plan = planCorridor(profile.positions, []);
    if (plan === undefined) throw new Error('the fixture route plans no corridor');
    const landUse: LandUseFeature[] = [];
    const buildings: BuildingFeature[] = [];
    for (const tile of corridorFixtureTiles()) {
      const decoded = decodeTile(tile.bytes, { z: 15, x: tile.x, y: tile.y }, plan.frame);
      if ('reason' in decoded) throw new Error(`a fixture tile was refused: ${decoded.reason}`);
      landUse.push(...decoded.landUse);
      buildings.push(...decoded.buildings);
    }
    const origin = corridorOrigin(profile);
    const corridor = worldCorridorOf('fixture', origin, plan.tiles, {
      landUse,
      buildings,
      paths: [],
      streets: [],
    });
    const { verdicts } = footprintPlans(corridor, landClassMask(corridor), profile, origin);
    expect(verdicts).toStrictEqual(CORRIDOR_FIXTURE_VERDICTS);
  });
});

describe('#1565 cross streets — the browser case’s fixture', () => {
  const corridor = fixtureCorridor();
  const mask = landClassMask(corridor);

  it('draws the T and the crossroads at the fixture’s angles, read back from the meshes', () => {
    const drawn = drawnJunctions(corridor, mask);
    expect(drawn).toHaveLength(FIXTURE_JUNCTIONS.length);
    FIXTURE_JUNCTIONS.forEach((fixture, index) => {
      const junction = drawn[index];
      expect(junction?.meshAngles.map((arm) => arm.side)).toStrictEqual(
        fixture.arms.map((arm) => arm.side),
      );
      fixture.arms.forEach((arm, at) => {
        expect(
          Math.abs((junction?.meshAngles[at]?.angleDegrees ?? 0) - arm.angleDegrees),
        ).toBeLessThan(3);
      });
    });
  });

  it('control: with the streets layer off, there are none', () => {
    expect(drawnJunctions({ ...corridor, streets: [] }, mask)).toStrictEqual([]);
  });
});
