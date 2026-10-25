// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1636: a city centre at street level and above it — every route-facing
 * ground floor in a `city-centre` stretch a shop front, whatever the floors
 * above are, and a tower of nine storeys or more a curtain wall drawn by the
 * shader, a style bit (`STYLE_GLAZED`, 32) on the surface it already wears.
 * Read from the planned vertices, the buffer the GPU receives. What needs a
 * GPU — the city's frame within the page's 35 calls — is
 * `game.browser.spec.ts` §"#1636".
 */

import { afterEach, describe, expect, it } from 'vitest';

import { CURTAIN_WALL, curtainWallPartAt, facadePartAt } from './facade';
import {
  FACADE_SHOPFRONT,
  FOOTPRINT_VERTEX_FLOATS,
  footprintPlans,
  GLAZED_MIN_STOREYS,
  STYLE_BRICK_FOUNDATION,
  STYLE_COMMERCIAL,
  STYLE_EAVES,
  STYLE_GLAZED,
  STYLE_OFFSET,
  STYLE_SASH,
  STYLE_SHUTTERS,
  FACADE_OFFSET,
  STOREY_METRES,
  type FootprintPlan,
} from './footprint-buildings';
import { besideRoad } from './footprint-fixtures-testing';
import { landClassMask } from './land-class';
import { mappedBuildingsOf } from './mapped-buildings';
import { MAPPED_BUILDING_DRAW_CALLS, MAPPED_BUILDING_TRIANGLES } from './realistic-budget';
import { PHOTOGRAPHIC_STRUCTURE_SURFACES } from './realistic-assets';
import { drawnRoadFrame } from './terrain';
import { cityCentreFixture } from './testing/urban-fixtures';
import { MappedBuildingBelt } from './three-renderer';
import { NO_URBAN_CLASS, urbanClassMap, type UrbanClassMap } from './urban-class';

/** #1636's city centre: a city by height, and a 27 m and a 24 m tower in it. */
const { profile, origin, corridor } = cityCentreFixture();
const land = landClassMask(corridor);
const urban = urbanClassMap(corridor, land, profile);
const planOf = (map: UrbanClassMap | undefined): readonly FootprintPlan[] =>
  footprintPlans(corridor, land, profile, origin, undefined, map).plans;
const city = planOf(urban);
/** The same corridor, its every stretch a town: the class gate's control. */
const town = planOf({ classAt: () => 'town' });
/** The same corridor with no class at all: today's world. */
const unclassed = planOf(undefined);

/** A plan's first wall vertex's style flags. */
const flagsOf = (plan: FootprintPlan): number => plan.triangles.wall[STYLE_OFFSET + 1] as number;

/** The plan in `plans` nearest `(along, lateral)` beside the road. */
function nearest(plans: readonly FootprintPlan[], along: number, lateral: number): FootprintPlan {
  const [x, z] = besideRoad(profile, origin, along, lateral);
  const found = [...plans].sort(
    (a, b) =>
      Math.hypot(a.centroid.x - x, a.centroid.z - z) -
      Math.hypot(b.centroid.x - x, b.centroid.z - z),
  )[0];
  if (found === undefined) throw new Error('no plan');
  return found;
}

/** Which way the road is from a plan, across it: a north road runs straight along `z`. */
function towardRoad(plan: FootprintPlan): number {
  const [roadX] = besideRoad(profile, origin, 1_500, 0);
  return Math.sign(roadX - plan.centroid.x);
}

describe('the city centre’s shop fronts — #1636', () => {
  it('classes the fixture’s middle as a city centre, and its ends not', () => {
    expect(urban.classAt(1_500)).toBe('city-centre');
    expect(urban.classAt(500)).not.toBe('city-centre');
  });

  it('plans a residential house fronting the route with a shop front on its ground floor and sash windows above', () => {
    const house = nearest(city, 1_500, 17);
    expect(house.urban).toBe('city-centre');
    expect(flagsOf(house) & STYLE_COMMERCIAL).toBe(0);
    expect(house.shop.front).toBe(true);
    const front = house.triangles.shopfront;
    expect(front.length).toBeGreaterThan(0);
    // The shop front's face, on the ground storey.
    const tops = new Set<number>();
    for (let at = 0; at < front.length; at += FOOTPRINT_VERTEX_FLOATS) {
      tops.add(front[at + FACADE_OFFSET + 2] as number);
    }
    expect(tops).toContain(FACADE_SHOPFRONT);
    // The floors above keep the residential sash its use gives.
    expect(flagsOf(house) & STYLE_SASH).toBe(STYLE_SASH);
    // And the same footprint in a town: no shop front.
    const inTown = nearest(town, 1_500, 17);
    expect(inTown.urban).toBe('town');
    expect(inTown.shop.front).toBe(false);
    expect(inTown.triangles.shopfront.length).toBe(0);
  });

  it('gives most route-facing houses a shop front in the city, and none in a town or with no class', () => {
    const shops = (plans: readonly FootprintPlan[]): number =>
      plans.filter((plan) => plan.shop.front).length;
    expect(shops(city)).toBeGreaterThan(50);
    expect(shops(town)).toBe(0);
    expect(shops(unclassed)).toBe(0);
    // No porch, garage or canopy on a shop's front.
    for (const plan of city) {
      if (!plan.shop.front) continue;
      expect(plan.garage).toBe(false);
      expect(plan.porch).toBe(false);
    }
  });

  it('puts the shop front on the wall facing the route, never on its back', () => {
    let checked = 0;
    for (const plan of city) {
      const front = plan.triangles.shopfront;
      if (front.length === 0) continue;
      const tx = towardRoad(plan);
      for (let at = 0; at < front.length; at += FOOTPRINT_VERTEX_FLOATS) {
        if ((front[at + FACADE_OFFSET + 2] as number) !== FACADE_SHOPFRONT) continue;
        // Its normal points to the road, and its quad is on the road's side of the building.
        expect((front[at + 3] as number) * tx).toBeGreaterThan(0.5);
        expect(((front[at] as number) - plan.centroid.x) * tx).toBeGreaterThan(0);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe('the city centre’s towers — #1636', () => {
  it('glazes a 27 m tower (nine storeys) and not a 24 m one (eight), read from the planned vertices', () => {
    const tall = nearest(city, 1_430, -40);
    const short = nearest(city, 1_570, -40);
    expect(tall.storeys).toBe(GLAZED_MIN_STOREYS);
    expect(short.storeys).toBe(GLAZED_MIN_STOREYS - 1);
    const walls = (plan: FootprintPlan): number[] => {
      const flags: number[] = [];
      const floats = plan.triangles.wall;
      for (let at = 0; at < floats.length; at += FOOTPRINT_VERTEX_FLOATS) {
        flags.push(floats[at + STYLE_OFFSET + 1] as number);
      }
      return flags;
    };
    expect(walls(tall).length).toBeGreaterThan(0);
    for (const flags of walls(tall)) expect(flags & STYLE_GLAZED).toBe(STYLE_GLAZED);
    for (const flags of walls(short)) expect(flags & STYLE_GLAZED).toBe(0);
    // With no class read, the world is today's: no tower glazed.
    for (const flags of walls(nearest(unclassed, 1_430, -40))) expect(flags & STYLE_GLAZED).toBe(0);
  });

  it('lays a curtain wall: glass over a spandrel, a transom, and mullions at an even module', () => {
    const bay = 3.6;
    const modules = Math.round(bay / CURTAIN_WALL.module);
    const width = bay / modules;
    expect(curtainWallPartAt(width / 2, 2, bay)).toBe('glass');
    expect(curtainWallPartAt(width / 2, 0.4, bay)).toBe('panel');
    expect(curtainWallPartAt(width / 2, CURTAIN_WALL.spandrel, bay)).toBe('frame');
    expect(curtainWallPartAt(width, 2, bay)).toBe('frame');
    expect(curtainWallPartAt(0, 2, bay)).toBe('frame');
    // Through the facade: a glazed wall's every storey, none above its eaves.
    const style = { flags: STYLE_GLAZED + STYLE_SASH, width: bay, extra: -1 };
    expect(facadePartAt(0.5 / modules, 5.7, 9, -1, style)).toBe('glass');
    expect(facadePartAt(0.5 / modules, 5.1, 9, -1, style)).toBe('panel');
    expect(facadePartAt(0.5 / modules, 9.5, 9, -1, style)).toBe('wall');
    // The control: without the bit, the sash's wall there.
    expect(facadePartAt(0.5 / modules, 5.7, 9, -1, { ...style, flags: STYLE_SASH })).not.toBe(
      'glass',
    );
    // A share of the storey glass, most of it.
    let glass = 0;
    let all = 0;
    for (let x = 0.005; x < bay; x += 0.01) {
      for (let y = 0.005; y < STOREY_METRES; y += 0.01) {
        all += 1;
        if (curtainWallPartAt(x, y, bay) === 'glass') glass += 1;
      }
    }
    expect(glass / all).toBeGreaterThan(0.6);
  });
});

/* ---------------------------------------------------------------- the GPU's side */

const textures = new Map(
  PHOTOGRAPHIC_STRUCTURE_SURFACES.map((surface) => [
    surface,
    {
      colour: { image: { width: 512, height: 512 }, dispose: () => undefined } as never,
      normal: { image: { width: 512, height: 512 }, dispose: () => undefined } as never,
    },
  ]),
);
const belts: MappedBuildingBelt[] = [];
afterEach(() => {
  for (const belt of belts.splice(0)) belt.dispose();
});

function aBelt(plans: readonly FootprintPlan[]): MappedBuildingBelt {
  const belt = new MappedBuildingBelt(mappedBuildingsOf(plans), textures);
  belts.push(belt);
  return belt;
}

/** The fragment shader a mapped building's material hands three. */
function fragment(): string {
  const material = aBelt(city).materialOf('concrete');
  if (material === undefined) throw new Error('the belt has no concrete material');
  const shader = {
    uniforms: {},
    vertexShader:
      '#include <common>\n#include <begin_vertex>\n#include <color_vertex>\n#include <fog_pars_vertex>\n#include <fog_vertex>',
    fragmentShader:
      '#include <common>\n#include <clipping_planes_fragment>\n#include <map_fragment>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>\n#include <normal_fragment_begin>\n#include <normal_fragment_maps>\n#include <fog_pars_fragment>\n#include <fog_fragment>',
  };
  material.onBeforeCompile(shader as never, undefined as never);
  return shader.fragmentShader;
}

/** A `const float` the program declares, by name. */
function constantOf(source: string, name: string): number {
  const found = new RegExp(`const float ${name} = (-?[\\d.e-]+);`).exec(source);
  if (found?.[1] === undefined) throw new Error(`the program declares no ${name}`);
  return Number(found[1]);
}

describe('the city centre, in the shader — #1636', () => {
  it('decodes bit 32 without disturbing bits 1 to 16, over all 64 combinations, with the program’s own oylFlag', () => {
    const source = fragment();
    const found = /float oylFlag\(float flags, float bit\) \{([^}]*)\}/.exec(source);
    if (found?.[1] === undefined) throw new Error('the program has no oylFlag');
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- runs the shader's own function text
    const oylFlag = new Function('flags', 'bit', 'mod', 'floor', found[1]) as (
      flags: number,
      bit: number,
      mod: (x: number, y: number) => number,
      floor: (x: number) => number,
    ) => number;
    const mod = (x: number, y: number): number => x - y * Math.floor(x / y);
    const bits = [
      STYLE_SASH,
      STYLE_SHUTTERS,
      STYLE_EAVES,
      STYLE_BRICK_FOUNDATION,
      STYLE_COMMERCIAL,
      STYLE_GLAZED,
    ];
    expect(bits).toStrictEqual([1, 2, 4, 8, 16, 32]);
    expect(constantOf(source, 'oylGlazedFlag')).toBe(STYLE_GLAZED);
    for (let flags = 0; flags < 64; flags += 1) {
      for (const bit of bits) {
        // As a float, as the vertex buffer carries it.
        expect(
          oylFlag(Math.fround(flags), bit, mod, Math.floor),
          `${String(flags)} & ${String(bit)}`,
        ).toBe((flags & bit) !== 0 ? 1 : 0);
      }
    }
  });

  it('draws the curtain wall from the twin’s numbers, in place of the windows, flat', () => {
    const source = fragment();
    expect(constantOf(source, 'oylCurtainSpandrel')).toBe(CURTAIN_WALL.spandrel);
    expect(constantOf(source, 'oylCurtainMullion')).toBe(CURTAIN_WALL.mullion);
    expect(constantOf(source, 'oylCurtainModule')).toBe(CURTAIN_WALL.module);
    // Before the sash and the casement, which it replaces.
    const glazed = source.indexOf('if (oylFlag(oylFlags, oylGlazedFlag) > 0.5) {');
    expect(glazed).toBeGreaterThan(source.indexOf('// 2. The openings.'));
    expect(glazed).toBeLessThan(source.indexOf('} else if (oylSashOn > 0.5) {'));
    // No texture: no rooms behind the glass until #1662.
    expect(source).not.toContain('oylInterior');
  });

  it('adds no surface: a city centre’s plans wear the surfaces they wore, and the belt stays in six calls', () => {
    const surfacesOf = (plans: readonly FootprintPlan[]): Set<string> =>
      new Set(plans.flatMap((plan) => [plan.surfaces.wall, plan.surfaces.roof]));
    expect([...surfacesOf(city)].sort()).toStrictEqual([...surfacesOf(unclassed)].sort());
    const belt = aBelt(city);
    const road = drawnRoadFrame(profile, origin, 1_500);
    if (road === undefined) throw new Error('the fixture road has no direction there');
    const stats = belt.refill(road.x, road.z, MAPPED_BUILDING_TRIANGLES);
    expect(stats.buildings).toBeGreaterThan(10);
    expect(stats.drawCalls).toBeLessThanOrEqual(MAPPED_BUILDING_DRAW_CALLS);
    expect(MAPPED_BUILDING_DRAW_CALLS).toBe(6);
    // And with no class, the same buildings in the same calls.
    expect(NO_URBAN_CLASS.classAt(1_500)).toBe('unknown');
  });
});

describe('the shop front’s gates — #1636 review', () => {
  it('draws no canopy over a shop front: its trim is the town twin’s less the canopy, never more', () => {
    expect(city.length).toBe(town.length);
    let lessCanopy = 0;
    city.forEach((plan, at) => {
      const twin = town[at] as FootprintPlan;
      if (!plan.shop.front) return;
      const shopTrim = plan.triangles.trim.length;
      const townTrim = twin.triangles.trim.length;
      expect(shopTrim).toBeLessThanOrEqual(townTrim);
      if (shopTrim < townTrim) lessCanopy += 1;
    });
    expect(lessCanopy).toBeGreaterThan(0);
  });
});
