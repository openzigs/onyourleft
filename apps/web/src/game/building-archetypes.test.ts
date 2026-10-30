// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1783: a commercial or multi-family archetype per mapped footprint — the
 * brick main-street block, the strip front, the garden apartment — setting
 * its cladding, roof, ground floor and upper windows together. The classifier
 * is table-tested; the rest is held where a rider sees it: the plans
 * `footprintPlans` returns and the packed vertex floats the belt uploads,
 * their style flags and their roles' triangles, over #1581's mixed town (its
 * main-street blocks) and #1783's commercial street (all three). The lever is
 * held against frozen records of the plans before this change.
 */

import { describe, expect, it } from 'vitest';

import type { BuildingFeature } from '@onyourleft/map-features';

import {
  BUILDING_ARCHETYPES,
  BUILDING_CUES,
  buildingArchetypeOf,
  GARDEN_APARTMENT_FEATURES,
  MAIN_STREET_AWNING_SHARE,
  type BuildingArchetype,
  type BuildingArchetypeInput,
} from './building-archetypes';
import { facadePartAt } from './facade';
import {
  CLAD_CLAPBOARD,
  FACADE_GARAGE,
  FACADE_OFFSET,
  FACADE_SIGN,
  FOOTPRINT_MAX_FAR_TRIANGLES,
  FOOTPRINT_MAX_TRIANGLES,
  FOOTPRINT_VERTEX_FLOATS,
  footprintPlans,
  GLAZED_MIN_STOREYS,
  STYLE_COMMERCIAL,
  STYLE_FLAT_ROOF,
  STYLE_OFFSET,
  STYLE_SASH,
  type FootprintPlan,
  type FootprintPlanOptions,
  type FootprintRole,
} from './footprint-buildings';
import {
  buildingBeside,
  commercialStreetFixture,
  houseStreetFixture,
  landBeside,
  mixedTownFixture,
  planFingerprint,
  rectangleBeside,
} from './footprint-fixtures-testing';
import { landClassMask } from './land-class';
import { northRoute } from './route-fixtures-testing';
import { corridorOrigin } from './terrain';
import { urbanClassMap, type UrbanClass } from './urban-class';
import type { WorldCorridor } from './world-data/corridor';

/** A town's corridor on its own road. */
interface Town {
  readonly profile: ReturnType<typeof northRoute>;
  readonly origin: ReturnType<typeof corridorOrigin>;
  readonly corridor: WorldCorridor;
}

/** A town's plans, with its urban class as the press builds it — the realistic page's. */
function plan(town: Town, options: FootprintPlanOptions = {}): readonly FootprintPlan[] {
  const land = landClassMask(town.corridor);
  const urban = urbanClassMap(town.corridor, land, town.profile);
  return footprintPlans(town.corridor, land, town.profile, town.origin, undefined, urban, options)
    .plans;
}

const mixed = mixedTownFixture();
const houses = houseStreetFixture();
const commercial = commercialStreetFixture();
const everyPlan = [...plan(mixed), ...plan(commercial)];
const ofArchetype = (archetype: BuildingArchetype): readonly FootprintPlan[] =>
  everyPlan.filter((each) => each.buildingArchetype === archetype);

/** One vertex as the belt uploads it. */
interface Vertex {
  readonly top: number;
  readonly skip: number;
  readonly clad: number;
  readonly flags: number;
  readonly width: number;
  readonly extra: number;
}

function verticesOf(plan: FootprintPlan, role: FootprintRole): Vertex[] {
  const floats = plan.triangles[role];
  const out: Vertex[] = [];
  for (let at = 0; at < floats.length; at += FOOTPRINT_VERTEX_FLOATS) {
    out.push({
      top: floats[at + FACADE_OFFSET + 2] as number,
      skip: floats[at + FACADE_OFFSET + 3] as number,
      clad: floats[at + STYLE_OFFSET] as number,
      flags: floats[at + STYLE_OFFSET + 1] as number,
      width: floats[at + STYLE_OFFSET + 2] as number,
      extra: floats[at + STYLE_OFFSET + 3] as number,
    });
  }
  return out;
}

/**
 * Whether a plan's walls show a window above their ground floor: each wall
 * face's facade, as the shader's twin lays it out, sampled in every bay of
 * every storey above the ground.
 */
function upperWindows(plan: FootprintPlan): boolean {
  return verticesOf(plan, 'wall').some((vertex) => {
    if (!(vertex.top > 1)) return false;
    const style = { flags: vertex.flags, width: vertex.width, extra: vertex.extra };
    for (let storey = 1; storey < vertex.top; storey += 1) {
      for (const v of [0.3, 0.5, 0.7]) {
        for (const u of [0.5, 1.5, 2.5]) {
          if (facadePartAt(u, storey + v, vertex.top, vertex.skip, style) !== 'wall') return true;
        }
      }
    }
    return false;
  });
}

/** A footprint that fits each archetype, as {@link buildingArchetypeOf} reads it. */
const TYPICAL: Readonly<Record<Exclude<BuildingArchetype, 'unknown'>, BuildingArchetypeInput>> = {
  'main-street': {
    area: 150,
    aspect: 1,
    rectangularity: 1,
    fourCorners: true,
    storeys: 3,
    use: 'commercial',
    urban: 'town',
    terraced: false,
  },
  'strip-front': {
    area: 600,
    aspect: 2.7,
    rectangularity: 1,
    fourCorners: true,
    storeys: 1,
    use: 'commercial',
    urban: 'village',
    terraced: false,
  },
  'garden-apartment': {
    area: 500,
    aspect: 2.6,
    rectangularity: 1,
    fourCorners: true,
    storeys: 3,
    use: 'residential',
    urban: 'unknown',
    terraced: false,
  },
};

describe('which archetype a footprint is — #1783', () => {
  it.each(BUILDING_ARCHETYPES)('classes a typical %s as one', (archetype) => {
    expect(buildingArchetypeOf(TYPICAL[archetype])).toBe(archetype);
  });

  it.each([
    ['an industrial footprint', { ...TYPICAL['strip-front'], use: 'industrial' as const }],
    ['a farm building', { ...TYPICAL['garden-apartment'], use: 'farmland' as const }],
    [
      `a tower of ${String(GLAZED_MIN_STOREYS)} storeys`,
      { ...TYPICAL['main-street'], storeys: GLAZED_MIN_STOREYS },
    ],
    ['a one-storey shop on a main street', { ...TYPICAL['main-street'], storeys: 1 }],
    ['a four-storey block on a main street', { ...TYPICAL['main-street'], storeys: 4 }],
    [
      'a main-street block on a rural stretch',
      { ...TYPICAL['main-street'], urban: 'rural' as const },
    ],
    ['a small one-storey store', { ...TYPICAL['strip-front'], area: 399 }],
    ['a strip front in a town', { ...TYPICAL['strip-front'], urban: 'town' as const }],
    ['a two-storey store', { ...TYPICAL['strip-front'], storeys: 2 }],
    ['a terraced store', { ...TYPICAL['strip-front'], terraced: true }],
    ['a squat apartment block', { ...TYPICAL['garden-apartment'], aspect: 1.9 }],
    ['an apartment block too small', { ...TYPICAL['garden-apartment'], area: 299 }],
    ['an apartment block too large', { ...TYPICAL['garden-apartment'], area: 1_201 }],
    ['a ragged apartment block', { ...TYPICAL['garden-apartment'], rectangularity: 0.8 }],
    ['an apartment block of six corners', { ...TYPICAL['garden-apartment'], fourCorners: false }],
    ['a terraced apartment block', { ...TYPICAL['garden-apartment'], terraced: true }],
    [
      'an apartment block in a city centre',
      { ...TYPICAL['garden-apartment'], urban: 'city-centre' as const },
    ],
    ['a one-storey apartment block', { ...TYPICAL['garden-apartment'], storeys: 1 }],
  ])('classes %s as `unknown`', (_, input) => {
    expect(buildingArchetypeOf(input)).toBe('unknown');
  });

  it('takes a terraced commercial block for a main-street one, whatever its class (#1635)', () => {
    for (const urban of ['unknown', 'rural', 'village', 'town', 'city-centre'] as UrbanClass[]) {
      expect(buildingArchetypeOf({ ...TYPICAL['main-street'], urban, terraced: true })).toBe(
        'main-street',
      );
    }
  });

  it('reads #1633’s missing suburb as an unclassed stretch or a village', () => {
    expect(BUILDING_CUES['strip-front'].urban).toStrictEqual(['village', 'unknown']);
  });

  it('plans the commercial street as each archetype it was drawn as, read back from the plan', () => {
    const plans = plan(commercial);
    const count = (archetype: BuildingArchetype): number =>
      plans.filter((each) => each.buildingArchetype === archetype).length;
    // 58 blocks, five stores, five apartments, and five offices no cue admits.
    expect(count('main-street')).toBe(58);
    expect(count('strip-front')).toBe(5);
    expect(count('garden-apartment')).toBe(5);
    expect(count('unknown')).toBe(5);
  });
});

describe('an archetype sets its features together — #1783, read back from the plan', () => {
  it('builds no strip front with a window above its ground floor, and gives each its sign band', () => {
    const strips = ofArchetype('strip-front');
    expect(strips.length).toBe(5);
    for (const each of strips) {
      expect(upperWindows(each)).toBe(false);
      const flags = verticesOf(each, 'wall')[0]?.flags ?? 0;
      expect(flags & STYLE_COMMERCIAL).toBe(STYLE_COMMERCIAL);
      expect(flags & STYLE_FLAT_ROOF).toBe(STYLE_FLAT_ROOF);
      expect(each.surfaces.wall).toBe('render');
      // A shop front along the whole front, under its sign band.
      expect(each.shop.front).toBe(true);
      expect(verticesOf(each, 'shopfront').some((vertex) => vertex.top === FACADE_SIGN)).toBe(true);
    }
    // Control: the main-street blocks of two and three storeys do show windows above.
    expect(ofArchetype('main-street').every(upperWindows)).toBe(true);
  });

  it('clads no main-street block in clapboard: brick, sash windows above, a flat roof', () => {
    const blocks = ofArchetype('main-street');
    expect(blocks.length).toBeGreaterThan(80);
    for (const each of blocks) {
      expect(each.cladding.wall).not.toBe('clapboard');
      expect(each.surfaces.wall).toBe('brick');
      expect(each.roof).toBe('flat');
      for (const vertex of verticesOf(each, 'wall')) {
        expect(Math.floor(vertex.clad)).not.toBe(CLAD_CLAPBOARD);
        expect(vertex.flags & STYLE_SASH).toBe(STYLE_SASH);
        expect(vertex.flags & STYLE_COMMERCIAL).toBe(STYLE_COMMERCIAL);
        expect(vertex.flags & STYLE_FLAT_ROOF).toBe(STYLE_FLAT_ROOF);
      }
    }
  });

  it('hangs an awning over about two in three main-street shop fronts', () => {
    const shops = ofArchetype('main-street').filter((each) => each.shop.front);
    const awnings = shops.filter((each) => each.shop.awning).length;
    expect(shops.length).toBeGreaterThan(80);
    expect(awnings / shops.length).toBeGreaterThan(MAIN_STREET_AWNING_SHARE - 0.1);
    expect(awnings / shops.length).toBeLessThan(MAIN_STREET_AWNING_SHARE + 0.1);
  });

  it('builds no garden apartment with a garage or a shop front, under a low pitched roof', () => {
    const apartments = ofArchetype('garden-apartment');
    expect(apartments.length).toBe(5);
    for (const each of apartments) {
      expect(each.garage).toBe(false);
      expect(each.triangles.driveway.length).toBe(0);
      expect(verticesOf(each, 'door').some((vertex) => vertex.top === FACADE_GARAGE)).toBe(false);
      expect(each.shop.front).toBe(false);
      expect(each.triangles.shopfront.length).toBe(0);
      expect(each.roof).not.toBe('flat');
      expect(GARDEN_APARTMENT_FEATURES.pitches).toContain(each.pitchDegrees);
      expect(['clapboard', 'photograph']).toContain(each.cladding.wall);
      if (each.cladding.wall !== 'clapboard') expect(each.surfaces.wall).toBe('brick');
      // No picture window: no wall bay the style names one.
      for (const vertex of verticesOf(each, 'wall')) expect(vertex.extra).toBeLessThan(0);
    }
    // Clapboard on some and brick on the others.
    expect(new Set(apartments.map((each) => each.cladding.wall)).size).toBe(2);
  });

  it('control: with the lever off, the garden apartments are flat behind parapets, as before', () => {
    const on = plan(commercial);
    const off = plan(commercial, { commercialArchetypes: false });
    expect(off.every((each) => each.buildingArchetype === 'unknown')).toBe(true);
    const apartments = off.filter(
      (_, index) => on[index]?.buildingArchetype === 'garden-apartment',
    );
    expect(apartments).toHaveLength(5);
    for (const each of apartments) expect(each.roof).toBe('flat');
  });
});

describe('the caps — #1783', () => {
  it.each([
    ['main-street', rectangleBeside(0, 0, 60, 30), 9.5, 'town'],
    ['strip-front', rectangleBeside(0, 0, 120, 60), 3.8, 'village'],
    ['garden-apartment', rectangleBeside(0, 0, 48.9, 24.45), 9.5, 'village'],
  ] as const)(
    'holds the largest %s its row admits to 640 near and 200 far',
    (archetype, corners, height, urban) => {
      const profile = northRoute(3_000, () => 10);
      const origin = corridorOrigin(profile);
      const buildings: BuildingFeature[] = Array.from({ length: 6 }, (_, index) =>
        buildingBeside(
          profile,
          origin,
          [corners.map(([a, n]) => [1_000 + index * 150 + a, 60 + n] as const)],
          height,
        ),
      );
      const corridor: WorldCorridor = {
        routeId: `largest-${archetype}`,
        origin,
        covered: () => true,
        coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
        landUse: [
          landBeside(
            profile,
            origin,
            'landuse',
            archetype === 'garden-apartment' ? 'residential' : 'retail',
            900,
            2_000,
            -150,
            150,
          ),
        ],
        buildings,
        paths: [],
        streets: [],
      };
      const fixed: { classAt: () => UrbanClass } = { classAt: () => urban };
      const { plans } = footprintPlans(
        corridor,
        landClassMask(corridor),
        profile,
        origin,
        undefined,
        fixed,
      );
      for (const each of plans) {
        expect(each.buildingArchetype).toBe(archetype);
        expect(each.triangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_TRIANGLES);
        expect(each.farTriangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_FAR_TRIANGLES);
      }
    },
  );
});

/**
 * The plans before #1783, fingerprinted by `footprint-fixtures-testing.ts`
 * §`planFingerprint`, each town with its urban class: #1784's head
 * (`feature/issue-1784-porches-eaves` at `558f05aa`) as it planned them — the
 * commercial street by that head's own `footprint-buildings.ts` — and
 * `origin/main`'s at `ac20712c` with every later lever off as well.
 *
 * A frozen record of the planner before #1783, not a snapshot to refresh. If
 * #1785, #1786 or #1784 changes before it merges, #1784's head's are
 * re-derived from it, and the PR says so. `porches.commercial` was re-derived when the
 * fixture's strip fronts went from 3.3 m to the untagged 3 m (the lever off plans them as
 * before; only the input changed).
 */
const BEFORE = {
  main: { mixed: '18e7375f', houses: '15da7210' },
  porches: { mixed: 'eea32fc0', houses: '8b985bcc', commercial: '10ef9ae2' },
} as const;

describe('the fallback and the lever — #1783', () => {
  it('plans every footprint as before #1783 with `-commercial-archetypes`', () => {
    const off = { commercialArchetypes: false } as const;
    const offMixed = plan(mixed, off);
    expect(offMixed.every((each) => each.buildingArchetype === 'unknown')).toBe(true);
    expect(planFingerprint(offMixed)).toBe(BEFORE.porches.mixed);
    expect(planFingerprint(plan(houses, off))).toBe(BEFORE.porches.houses);
    expect(planFingerprint(plan(commercial, off))).toBe(BEFORE.porches.commercial);
    const none = {
      ...off,
      archetypePorches: false,
      dormerVariants: false,
      roofVariants: false,
    } as const;
    expect(planFingerprint(plan(mixed, none))).toBe(BEFORE.main.mixed);
    expect(planFingerprint(plan(houses, none))).toBe(BEFORE.main.houses);
  });

  it('plans every footprint no archetype fits exactly as with the lever off', () => {
    let unknown = 0;
    for (const town of [mixed, houses, commercial]) {
      const on = plan(town);
      const off = plan(town, { commercialArchetypes: false });
      expect(on).toHaveLength(off.length);
      on.forEach((each, index) => {
        if (each.buildingArchetype !== 'unknown') return;
        unknown += 1;
        // Its paint is not compared: #1581's `paintTown` moves a paint off a neighbour's, and a
        // main-street block beside it now wears brick.
        expect(planFingerprint([each], false)).toBe(
          planFingerprint([off[index] as FootprintPlan], false),
        );
      });
    }
    expect(unknown).toBeGreaterThan(200);
  });

  it('control: with the lever on, the towns are not as before', () => {
    expect(planFingerprint(plan(mixed))).not.toBe(BEFORE.porches.mixed);
    expect(planFingerprint(plan(commercial))).not.toBe(BEFORE.porches.commercial);
  });
});
