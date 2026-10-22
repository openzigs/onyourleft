// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1565's renderer half: `three-renderer.ts` §`SideRoadBelt` draws every
 * cross street in view as ONE mesh in the road's own material, with the
 * attributes that material reads, and reads its triangles back from the very
 * buffers it uploads.
 */

import { describe, expect, it } from 'vitest';

import type { StreetFeature } from '@onyourleft/map-features';

import {
  mappedJunctions,
  SIDE_ROAD_FRAME_TRIANGLES,
  sideRoadsAt,
  type SideRoad,
} from './cross-streets';
import { northRoute } from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import { siteAt, siteSpacing } from './settlements';
import { corridorOrigin, drawnRoadFrame } from './terrain';
import { PavementBelt, SideRoadBelt } from './three-renderer';
import type { WorldCorridor } from './world-data/corridor';

const FARMLAND = northRoute(6_000, () => 40);

/**
 * A material to hand the belt, without importing `three` here
 * (`three-seam.test.ts`): a stylised pavement belt's own, which is a
 * vertex-coloured basic material like the stylised road's.
 */
function aMaterial(): PavementBelt['mesh']['material'] {
  return new PavementBelt('stylised').mesh.material;
}
const ORIGIN = corridorOrigin(FARMLAND);
const SEED = scatterSeed(FARMLAND);

/** A street square across the road at `along`, 100 m each side. */
function across(along: number): StreetFeature {
  const here = drawnRoadFrame(FARMLAND, ORIGIN, along);
  if (here === undefined) throw new Error('no road');
  return {
    kind: 'minor_road',
    kindDetail: 'residential',
    grade: 'ground',
    line: Float32Array.from([
      here.x - here.normalX * 100,
      here.z - here.normalZ * 100,
      here.x + here.normalX * 100,
      here.z + here.normalZ * 100,
    ]),
  };
}

function roadsNear(along: number): readonly SideRoad[] {
  const corridor: WorldCorridor = {
    routeId: 'belt-fixture',
    origin: ORIGIN,
    covered: () => true,
    coveredBoxes: [],
    landUse: [],
    buildings: [],
    paths: [],
    streets: [across(along), across(along + 120)],
  };
  return sideRoadsAt(
    FARMLAND,
    ORIGIN,
    SEED,
    along - 60,
    along + 400,
    along,
    mappedJunctions(corridor, FARMLAND, ORIGIN, SEED),
  );
}

/** An odometer reading with no village within 400 m. */
function openCountry(): number {
  const { sites } = siteSpacing(FARMLAND);
  const centres = [...Array(sites).keys()]
    .map((index) => siteAt(FARMLAND, SEED, index))
    .filter((site) => site?.kind === 'village')
    .map((site) => site?.centre as number);
  for (let along = 200; along < 5_000; along += 50) {
    if (centres.every((centre) => Math.abs(centre - along) > 600)) return along;
  }
  throw new Error('no open country');
}

describe('the side roads are drawn — #1565', () => {
  const along = openCountry();
  const roads = roadsNear(along);

  it('in ONE mesh, in the material it is handed, from the frame’s own triangles', () => {
    expect(roads.length).toBe(2);
    const road = aMaterial();
    const belt = new SideRoadBelt(road as never);
    const added: unknown[] = [];
    belt.addTo({ add: (object: unknown) => added.push(object) } as never);
    expect(added).toEqual([belt.mesh]);
    belt.update(roads);
    expect(belt.mesh.visible).toBe(true);
    expect(belt.mesh.material).toBe(road);
    const geometry = belt.mesh.geometry;
    const triangles = (geometry.index?.count ?? 0) / 3;
    expect(triangles).toBe(roads.reduce((sum, each) => sum + each.mesh.indices.length / 3, 0));
    expect(triangles).toBeLessThanOrEqual(SIDE_ROAD_FRAME_TRIANGLES);
    // The positions uploaded are the frame's, in order.
    const uploaded = geometry.getAttribute('position').array;
    const first = (roads[0] as SideRoad).mesh.positions;
    expect(Array.from(uploaded.slice(0, first.length))).toEqual(Array.from(first));
    // What the road's material reads: colour, an up normal, #628's across, #1523's reach (none).
    expect(geometry.getAttribute('color').count).toBe(geometry.getAttribute('position').count);
    expect(geometry.getAttribute('normal').getY(0)).toBe(1);
    const acrossValues = Array.from(geometry.getAttribute('oylAcross').array);
    expect(Math.max(...acrossValues)).toBeGreaterThan(2);
    const reach = Array.from(geometry.getAttribute('oylPatchReach').array);
    expect(reach.every((value) => value === 0)).toBe(true);
  });

  it('wears whatever the road wears, and uploads nothing for the same set', () => {
    const belt = new SideRoadBelt(aMaterial() as never);
    belt.update(roads);
    const geometry = belt.mesh.geometry;
    const photographic = aMaterial();
    belt.setMaterial(photographic as never);
    belt.update(roads);
    expect(belt.mesh.geometry).toBe(geometry);
    // The control: a different set of junctions is a new upload.
    belt.update(roadsNear(along));
    expect(belt.mesh.geometry).not.toBe(geometry);
    expect(belt.mesh.material).toBe(photographic);
  });

  it('draws none away from a junction, and none when the gate turns it off', () => {
    const belt = new SideRoadBelt(aMaterial() as never);
    belt.update([]);
    expect(belt.mesh.visible).toBe(false);
    belt.update(roads);
    belt.switchOn(false);
    belt.update(roads);
    expect(belt.mesh.visible).toBe(false);
    expect(belt.mesh.geometry.index?.count ?? 0).toBe(0);
    belt.dispose();
  });
});
