// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3251: the contemporary houses and the modern flats — the code-built modern
 * set, chosen by a footprint's setting and never from a file.
 *
 * Held through the plans a ride makes (`footprintPlans`), on synthetic streets
 * beside a stretch of each urban class, each rule beside its control. The
 * fixtures are arithmetic in local metres (`footprint-fixtures-testing.ts`):
 * nothing here is a real place.
 */

import { NO_BUILDING_FIELDS, type BuildingFeature } from '@onyourleft/map-features';
import { describe, expect, it } from 'vitest';

import {
  BUILDING_ARCHETYPES,
  BUILDING_CUES,
  MODERN_FLATS_CUE,
  MODERN_FLATS_FEATURES,
  modernFlatsFit,
  type BuildingArchetypeInput,
} from './building-archetypes';
import { FOUNDATION_METRES } from './buildings';
import { MAPPED_BUILDING_DRAW_CALLS } from './realistic-budget';
import {
  FOOTPRINT_MAX_TRIANGLES,
  FOOTPRINT_SURFACES,
  FOOTPRINT_VERTEX_FLOATS,
  footprintPlans,
  STYLE_OFFSET,
  STYLE_SASH,
  STYLE_SHUTTERS,
  type FootprintPlan,
  type FootprintPlanOptions,
} from './footprint-buildings';
import {
  buildingBeside,
  houseStreetFixture,
  landBeside,
  planFingerprint,
  rectangleBeside,
} from './footprint-fixtures-testing';
import {
  ARCHETYPE_CUES,
  ARCHETYPE_ERAS,
  ARCHETYPE_FEATURES,
  archetypeFeaturesOf,
  CONTEMPORARY_ARCHETYPES,
  CONTEMPORARY_BOARDED_SHARE,
  CONTEMPORARY_CUE,
  CONTEMPORARY_FEATURES,
  CONTEMPORARY_FLAT_SHARE,
  CONTEMPORARY_FROM_YEAR,
  contemporaryArchetypeOf,
  HOUSE_ARCHETYPES,
  isContemporary,
  type ContemporaryInput,
} from './house-archetypes';
import { landClassMask, type LandClassMask } from './land-class';
import { terrainHeightAt } from './landform';
import { nearestOnRoadSegments, roadSegmentsNear, type BesideTheRoad } from './road-grid';
import { northRoute } from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import { corridorOrigin } from './terrain';
import type { UrbanClass, UrbanClassMap } from './urban-class';
import type { WorldCorridor } from './world-data/corridor';

/** A stretch of route that is one class from end to end. */
const classed = (urban: UrbanClass): UrbanClassMap => ({ classAt: () => urban });

/** A footprint a contemporary house fits: 12 × 9 m, two storeys, a clean rectangle. */
const typical: ContemporaryInput = {
  area: 108,
  rectangularity: 1,
  shape: 'rectangle',
  storeys: 2,
  residential: true,
  terraced: false,
  pitched: true,
  roofMapped: false,
  share: 0.9,
};

describe('which footprint is a contemporary house — #3251', () => {
  it('is flat on a seeded share and low-pitched on the rest', () => {
    expect(contemporaryArchetypeOf({ ...typical, share: 0 })).toBe('contemporary-flat');
    expect(contemporaryArchetypeOf({ ...typical, share: CONTEMPORARY_FLAT_SHARE - 1e-9 })).toBe(
      'contemporary-flat',
    );
    expect(contemporaryArchetypeOf({ ...typical, share: CONTEMPORARY_FLAT_SHARE })).toBe(
      'contemporary-low',
    );
    expect(CONTEMPORARY_FLAT_SHARE).toBeGreaterThan(0);
    expect(CONTEMPORARY_FLAT_SHARE).toBeLessThan(1);
  });

  it('is flat where the plan’s own rule would draw no pitched roof, and low where a pitched one is mapped', () => {
    expect(contemporaryArchetypeOf({ ...typical, pitched: false, share: 0.99 })).toBe(
      'contemporary-flat',
    );
    // A mapped roof is the building's own: the seeded share does not flatten it.
    expect(contemporaryArchetypeOf({ ...typical, roofMapped: true, share: 0 })).toBe(
      'contemporary-low',
    );
    expect(
      contemporaryArchetypeOf({ ...typical, roofMapped: true, pitched: false, share: 0.99 }),
    ).toBe('contemporary-flat');
  });

  it('is none for a terrace, for what is no home, and for a T, U or Z', () => {
    expect(contemporaryArchetypeOf({ ...typical, terraced: true })).toBeUndefined();
    expect(contemporaryArchetypeOf({ ...typical, residential: false })).toBeUndefined();
    expect(contemporaryArchetypeOf({ ...typical, shape: 'other' })).toBeUndefined();
    expect(contemporaryArchetypeOf({ ...typical, rectangularity: 0.8 })).toBeUndefined();
    // An L is taken as it is: its rectangularity is an L's.
    expect(contemporaryArchetypeOf({ ...typical, shape: 'L', rectangularity: 0.7 })).toBeDefined();
  });

  it('takes each end of its area and storey bands, and nothing past them', () => {
    const [leastArea, mostArea] = CONTEMPORARY_CUE.area;
    const [leastStoreys, mostStoreys] = CONTEMPORARY_CUE.storeys;
    expect(contemporaryArchetypeOf({ ...typical, area: leastArea })).toBeDefined();
    expect(contemporaryArchetypeOf({ ...typical, area: mostArea })).toBeDefined();
    expect(contemporaryArchetypeOf({ ...typical, area: leastArea - 1 })).toBeUndefined();
    expect(contemporaryArchetypeOf({ ...typical, area: mostArea + 1 })).toBeUndefined();
    expect(contemporaryArchetypeOf({ ...typical, storeys: leastStoreys })).toBeDefined();
    expect(contemporaryArchetypeOf({ ...typical, storeys: mostStoreys })).toBeDefined();
    expect(contemporaryArchetypeOf({ ...typical, storeys: mostStoreys + 1 })).toBeUndefined();
    expect(contemporaryArchetypeOf({ ...typical, storeys: leastStoreys - 1 })).toBeUndefined();
  });

  it('is none for a house mapped as built before 1990, and one from then on', () => {
    expect(CONTEMPORARY_FROM_YEAR).toBe(1990);
    expect(contemporaryArchetypeOf(typical, 1925)).toBeUndefined();
    expect(contemporaryArchetypeOf(typical, CONTEMPORARY_FROM_YEAR - 1)).toBeUndefined();
    expect(contemporaryArchetypeOf(typical, CONTEMPORARY_FROM_YEAR)).toBeDefined();
    expect(contemporaryArchetypeOf(typical, null)).toBeDefined();
  });

  it('admits no shutters, porch, dormer or chimney, boards on three in ten, and always a picture window', () => {
    expect(CONTEMPORARY_BOARDED_SHARE).toBe(0.3);
    for (const archetype of CONTEMPORARY_ARCHETYPES) {
      expect(CONTEMPORARY_FEATURES[archetype], archetype).toMatchObject({
        hip: 0,
        chimney: 0,
        canopyPosts: 0,
        frontPorch: 0,
        shutters: 0,
        picture: 1,
        dormer: 0,
        siding: CONTEMPORARY_BOARDED_SHARE,
        brickFoundation: 0,
        roofVariant: 'none',
        dormers: 'none',
      });
      expect(archetypeFeaturesOf(archetype)).toBe(CONTEMPORARY_FEATURES[archetype]);
      expect(isContemporary(archetype)).toBe(true);
    }
    expect(CONTEMPORARY_FEATURES['contemporary-low']).toMatchObject({ pitches: [25], eaves: 0.15 });
    expect(isContemporary('ranch')).toBe(false);
    expect(isContemporary('unknown')).toBe(false);
    expect(archetypeFeaturesOf('unknown')).toBeUndefined();
    expect(archetypeFeaturesOf('ranch')).toBe(ARCHETYPE_FEATURES.ranch);
  });

  it('stands beside #1782’s and #1783’s tables, which name no contemporary archetype', () => {
    const six = ['bungalow', 'cape', 'colonial', 'farmhouse', 'foursquare', 'ranch'];
    expect([...HOUSE_ARCHETYPES].sort()).toEqual(six);
    expect(Object.keys(ARCHETYPE_CUES).sort()).toEqual(six);
    expect(Object.keys(ARCHETYPE_ERAS).sort()).toEqual(six);
    expect(Object.keys(ARCHETYPE_FEATURES).sort()).toEqual(six);
    const three = ['garden-apartment', 'main-street', 'strip-front'];
    expect([...BUILDING_ARCHETYPES].sort()).toEqual(three);
    expect(Object.keys(BUILDING_CUES).sort()).toEqual(three);
  });
});

// --- The plans a ride makes ---------------------------------------------------

const street = houseStreetFixture();
const mask = landClassMask(street.corridor);

/** The house street's plans beside a stretch of `urban` from end to end. */
function plansBeside(
  urban: UrbanClass | undefined,
  options: FootprintPlanOptions = {},
): readonly FootprintPlan[] {
  return footprintPlans(
    street.corridor,
    mask,
    street.profile,
    street.origin,
    undefined,
    urban === undefined ? undefined : classed(urban),
    options,
  ).plans;
}

/** The style flags of a plan's wall vertices, each once. */
function wallFlags(plan: FootprintPlan): Set<number> {
  const floats = plan.triangles.wall;
  const flags = new Set<number>();
  for (let at = 0; at < floats.length; at += FOOTPRINT_VERTEX_FLOATS) {
    flags.add(floats[at + STYLE_OFFSET + 1] as number);
  }
  return flags;
}
const has = (plan: FootprintPlan, flag: number): boolean =>
  [...wallFlags(plan)].some((flags) => (flags & flag) !== 0);

/** Whether a wall of the plan carries a picture-window bay (`extra`, −1 for none). */
function hasPictureWindow(plan: FootprintPlan): boolean {
  const floats = plan.triangles.wall;
  for (let at = 0; at < floats.length; at += FOOTPRINT_VERTEX_FLOATS) {
    if ((floats[at + STYLE_OFFSET + 3] as number) >= 0) return true;
  }
  return false;
}

const contemporaryOf = (plans: readonly FootprintPlan[]): readonly FootprintPlan[] =>
  plans.filter((plan) => isContemporary(plan.archetype));

describe('a street of houses beside each class — #3251', () => {
  it('draws a rural road and one with no class exactly as before: no contemporary house', () => {
    for (const urban of ['rural', 'unknown', undefined] as const) {
      const plans = plansBeside(urban);
      expect(contemporaryOf(plans), String(urban)).toHaveLength(0);
      expect(planFingerprint(plans), String(urban)).toBe(
        planFingerprint(plansBeside(urban, { houseStyles: false })),
      );
    }
  });

  it('draws a town’s and a city centre’s detached houses contemporary, every one that was one of #1782’s', () => {
    for (const urban of ['town', 'city-centre'] as const) {
      const before = plansBeside(urban, { houseStyles: false });
      const plans = plansBeside(urban);
      expect(plans.length).toBe(before.length);
      let was = 0;
      plans.forEach((plan, index) => {
        const old = before[index] as FootprintPlan;
        if (old.archetype === 'unknown') return;
        was += 1;
        expect(isContemporary(plan.archetype), `${urban} ${old.archetype}`).toBe(true);
      });
      // A city centre has no house archetype (#1782), so only the town's count is asked.
      if (urban === 'town') expect(was).toBeGreaterThan(20);
      expect(contemporaryOf(plans).length).toBeGreaterThan(20);
    }
  });

  it('draws a village street as a mix: about half contemporary, and the rest as before', () => {
    // The owner's ruling on #3273: a village is about half traditional, half contemporary.
    const before = plansBeside('village', { houseStyles: false });
    const plans = plansBeside('village');
    const modern = contemporaryOf(plans).length;
    expect(modern).toBeGreaterThan(0.3 * plans.length);
    expect(modern).toBeLessThan(0.7 * plans.length);
    // Every house that is not contemporary is planned exactly as it was.
    let kept = 0;
    plans.forEach((plan, index) => {
      if (isContemporary(plan.archetype)) return;
      kept += 1;
      // But for its paint, which a town moves off a neighbour's, and its neighbours changed.
      expect(planFingerprint([plan], false)).toBe(
        planFingerprint([before[index] as FootprintPlan], false),
      );
    });
    expect(kept).toBeGreaterThan(0.3 * plans.length);
    // #1782's archetypes are still on the street, more than one of them.
    const traditional = new Set(
      plans
        .map((plan) => plan.archetype)
        .filter((each) => each !== 'unknown' && !isContemporary(each)),
    );
    expect(traditional.size).toBeGreaterThan(2);
    // Both roofs are on the street, and the same street on every read.
    const kinds = new Set(contemporaryOf(plans).map((plan) => plan.archetype));
    expect([...kinds].sort()).toEqual(['contemporary-flat', 'contemporary-low']);
    expect(planFingerprint(plansBeside('village'))).toBe(planFingerprint(plans));
  });

  it('plans the street as before with either lever off', () => {
    const off = plansBeside('town', { houseStyles: false });
    expect(contemporaryOf(off)).toHaveLength(0);
    expect(off.some((plan) => plan.archetype !== 'unknown')).toBe(true);
    // #1782's own lever: no archetype of any kind.
    const none = plansBeside('town', { houseArchetypes: false });
    expect(none.every((plan) => plan.archetype === 'unknown')).toBe(true);
  });
});

describe('what a contemporary house is built as — #3251', () => {
  const town = contemporaryOf(plansBeside('town'));
  const flat = town.filter((plan) => plan.archetype === 'contemporary-flat');
  const low = town.filter((plan) => plan.archetype === 'contemporary-low');

  it('has both kinds on the street', () => {
    expect(flat.length).toBeGreaterThan(5);
    expect(low.length).toBeGreaterThan(5);
  });

  it('roofs the flat one flat, and the low one in a 25° gable of plain grey', () => {
    for (const plan of flat) {
      expect(plan.roof).toBe('flat');
      expect(plan.pitchDegrees).toBe(0);
      expect(plan.surfaces.roof).toBe('flat-roof');
    }
    for (const plan of low) {
      expect(plan.roof).toBe('gable');
      expect(plan.roofVariant).toBe('plain');
      expect(plan.pitchDegrees).toBe(25);
      expect(plan.surfaces.roof).toBe('slate');
      expect(plan.cladding.roof).toBe('photograph');
    }
  });

  it('walls every one on the render surface, plain or boarded, never in brick or a surface of its own', () => {
    for (const plan of town) expect(plan.surfaces.wall).toBe('render');
    const boarded = town.filter((plan) => plan.cladding.wall === 'clapboard').length;
    expect(boarded).toBeGreaterThan(0);
    expect(boarded).toBeLessThan(town.length / 2);
    // Control: the same street planned as before has brick houses on it.
    const before = plansBeside('town', { houseStyles: false });
    expect(before.some((plan) => plan.surfaces.wall === 'brick')).toBe(true);
  });

  it('opens no more surfaces on the street than it had: the six a frame may draw are not passed', () => {
    const surfacesOf = (plans: readonly FootprintPlan[]): Set<string> =>
      new Set(plans.flatMap((plan) => [plan.surfaces.wall, plan.surfaces.roof]));
    const now = surfacesOf(plansBeside('town'));
    expect(now.size).toBeLessThanOrEqual(MAPPED_BUILDING_DRAW_CALLS);
    // The contemporary houses' own: render, the flat roof and the low roof's grey.
    expect([...surfacesOf(town)].sort()).toEqual(['flat-roof', 'render', 'slate']);
  });

  it('gives none sash windows, shutters, a porch, dormers or a steeple', () => {
    for (const plan of town) {
      expect(has(plan, STYLE_SASH), plan.archetype).toBe(false);
      expect(has(plan, STYLE_SHUTTERS), plan.archetype).toBe(false);
      expect(plan.porch).toBe(false);
      expect(plan.dormers).toBe(0);
      expect(plan.steeple).toBe(false);
    }
    // Control: the same street planned as before has sash windows on every house.
    const before = plansBeside('town', { houseStyles: false });
    expect(
      before.filter((plan) => plan.archetype !== 'unknown').every((plan) => has(plan, STYLE_SASH)),
    ).toBe(true);
  });

  it('gives most a garage, and a picture window to houses of two storeys too', () => {
    const garaged = town.filter((plan) => plan.garage).length;
    expect(garaged).toBeGreaterThan(town.length / 3);
    const twoStoreyed = town.filter((plan) => plan.storeys === 2 && hasPictureWindow(plan));
    expect(twoStoreyed.length).toBeGreaterThan(0);
    // Control: before, a picture window is a single-storey house's alone.
    const before = plansBeside('town', { houseStyles: false });
    expect(before.some((plan) => plan.storeys === 2 && hasPictureWindow(plan))).toBe(false);
    expect(before.some((plan) => plan.storeys === 1 && hasPictureWindow(plan))).toBe(true);
  });

  it('adds no surface and stays inside one building’s triangles', () => {
    for (const plan of town) {
      expect(FOOTPRINT_SURFACES).toContain(plan.surfaces.wall);
      expect(FOOTPRINT_SURFACES).toContain(plan.surfaces.roof);
      expect(plan.triangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_TRIANGLES);
    }
  });
});

// --- One footprint at a time --------------------------------------------------

const road = northRoute(3_000, (along) => (along <= 1_000 ? 10 : 10 + (along - 1_000) * 0.08));
const roadOrigin = corridorOrigin(road);

/** A corridor of `buildings` on `kind` land beside the sloping road. */
function corridorOf(buildings: readonly BuildingFeature[], kind = 'residential'): WorldCorridor {
  return {
    routeId: 'contemporary',
    origin: roadOrigin,
    covered: () => true,
    coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
    landUse: [landBeside(road, roadOrigin, 'landuse', kind, 900, 2_000, -80, 80)],
    buildings: [...buildings],
    paths: [],
    streets: [],
  };
}

/** A 12 × 9 m house, its long side to the road, 15 m out at `along`, with `fields` mapped. */
function houseAt(along: number, fields: Partial<BuildingFeature> = {}): BuildingFeature {
  return {
    ...buildingBeside(road, roadOrigin, [rectangleBeside(along, 19.5, 12, 9)], 6),
    ...NO_BUILDING_FIELDS,
    ...fields,
  };
}

function planOne(
  building: BuildingFeature,
  urban: UrbanClass,
  kind = 'residential',
  options: FootprintPlanOptions = {},
): FootprintPlan {
  const corridor = corridorOf([building], kind);
  const { plans } = footprintPlans(
    corridor,
    landClassMask(corridor),
    road,
    roadOrigin,
    undefined,
    classed(urban),
    options,
  );
  const [plan] = plans;
  if (plan === undefined) throw new Error('not planned');
  return plan;
}

describe('the footprints that keep what they were — #3251', () => {
  it('is no vacuous claim: the house is contemporary beside a town', () => {
    expect(isContemporary(planOne(houseAt(1_100), 'town').archetype)).toBe(true);
  });

  it('keeps a house on farmland as it was, beside a town', () => {
    const on = planOne(houseAt(1_100, { buildingType: 'house' }), 'town', 'farmland');
    const off = planOne(houseAt(1_100, { buildingType: 'house' }), 'town', 'farmland', {
      houseStyles: false,
    });
    expect(isContemporary(on.archetype)).toBe(false);
    expect(planFingerprint([on])).toBe(planFingerprint([off]));
    // Control: the same mapped house on residential land is contemporary.
    expect(
      isContemporary(planOne(houseAt(1_100, { buildingType: 'house' }), 'town').archetype),
    ).toBe(true);
  });

  it('keeps a house mapped as built in 1925 one of #1782’s, and makes one of 2005 contemporary', () => {
    expect(isContemporary(planOne(houseAt(1_100, { startYear: 1925 }), 'town').archetype)).toBe(
      false,
    );
    expect(isContemporary(planOne(houseAt(1_100, { startYear: 2005 }), 'town').archetype)).toBe(
      true,
    );
    // With #1793's lever off the year is not read, as there.
    expect(
      isContemporary(
        planOne(houseAt(1_100, { startYear: 1925 }), 'town', 'residential', {
          mappedStartYear: false,
        }).archetype,
      ),
    ).toBe(true);
  });

  it('keeps a mapped bungalow, a mapped garage and a mapped church what their type says', () => {
    for (const buildingType of ['bungalow', 'garage', 'church'] as const) {
      const plan = planOne(houseAt(1_100, { buildingType }), 'town');
      expect(isContemporary(plan.archetype), buildingType).toBe(false);
    }
  });

  it('makes no contemporary house of a building part, which has no front and stands on another', () => {
    const part = {
      ...buildingBeside(road, roadOrigin, [rectangleBeside(1_100, 19.5, 12, 9)], 6, {
        minHeightMetres: 3,
      }),
      ...NO_BUILDING_FIELDS,
    };
    expect(isContemporary(planOne(part, 'town').archetype)).toBe(false);
    // Control: the same ring as a building is one.
    expect(isContemporary(planOne(houseAt(1_100), 'town').archetype)).toBe(true);
  });

  it('keeps a mapped pitched roof pitched, under a contemporary house’s low grey roof', () => {
    const gabled = planOne(houseAt(1_100, { roofShape: 'gabled' }), 'town');
    expect(gabled.archetype).toBe('contemporary-low');
    expect(gabled.roof).toBe('gable');
    const flat = planOne(houseAt(1_100, { roofShape: 'flat' }), 'town');
    expect(flat.archetype).toBe('contemporary-flat');
    expect(flat.roof).toBe('flat');
  });
});

describe('a contemporary house on sloping ground — #3251', () => {
  /** The drawn ground under `(x, z)`, by the stretch of road it is nearest. */
  function groundUnder(land: LandClassMask, x: number, z: number): number {
    const segments: number[] = [];
    const near = roadSegmentsNear(road, roadOrigin, x, z, 600, segments);
    const beside: BesideTheRoad = { along: 0, lateral: 0, distance: 0 };
    if (!nearestOnRoadSegments(near, segments, x, z, beside)) throw new Error('no road near');
    return terrainHeightAt(road, roadOrigin, scatterSeed(road), beside.along, beside.lateral, land);
  }

  it('stands every one’s plinth at or under the ground at each vertex, never floating and never deep', () => {
    // A street that climbs at 8 %: a house every 20 m, both sides.
    const buildings = Array.from({ length: 20 }, (_, lot) =>
      [1, -1].map((side) =>
        buildingBeside(
          road,
          roadOrigin,
          [rectangleBeside(1_050 + lot * 20, side * 19.5, 12, 9)],
          lot % 2 === 0 ? 3 : 6,
        ),
      ),
    ).flat();
    const corridor = corridorOf(buildings);
    const land = landClassMask(corridor);
    const { plans } = footprintPlans(corridor, land, road, roadOrigin, undefined, classed('town'));
    const modern = contemporaryOf(plans);
    expect(modern.length).toBeGreaterThan(30);
    let checked = 0;
    let rise = 0;
    for (const plan of modern) {
      const floats = plan.triangles.plinth;
      const grounds: number[] = [];
      for (let at = 0; at < floats.length; at += FOOTPRINT_VERTEX_FLOATS) {
        const y = floats[at + 1] as number;
        if (Math.abs(y - plan.base) > 1e-4) continue;
        const ground = groundUnder(land, floats[at] as number, floats[at + 2] as number);
        grounds.push(ground);
        expect(plan.base).toBeLessThanOrEqual(ground + 1e-4);
        expect(ground - plan.base).toBeLessThanOrEqual(FOUNDATION_METRES + 2.5 + 1e-4);
        checked += 1;
      }
      if (grounds.length > 0) rise = Math.max(rise, Math.max(...grounds) - Math.min(...grounds));
    }
    expect(checked).toBeGreaterThan(100);
    // Control: the ground really falls away under them.
    expect(rise).toBeGreaterThan(0.3);
  });
});

// --- The modern flats ---------------------------------------------------------

/** A footprint the modern flats fit: 30 × 14 m, three storeys, in a town. */
const block: BuildingArchetypeInput = {
  area: 420,
  aspect: 30 / 14,
  rectangularity: 1,
  fourCorners: true,
  storeys: 3,
  use: 'residential',
  urban: 'town',
  terraced: false,
};

describe('the modern flats — #3251', () => {
  it('fit a residential block of three or four storeys and 200 m² or more, in a town or a city centre', () => {
    expect(MODERN_FLATS_CUE).toMatchObject({ storeys: [3, 4], area: 200 });
    expect(modernFlatsFit(block)).toBe(true);
    expect(modernFlatsFit({ ...block, storeys: 4, urban: 'city-centre' })).toBe(true);
    expect(modernFlatsFit({ ...block, area: 200 })).toBe(true);
    for (const not of [
      { storeys: 2 },
      { storeys: 5 },
      { area: 199 },
      { use: 'commercial' as const },
      { terraced: true },
      { urban: 'village' as const },
      { urban: 'rural' as const },
      { urban: 'unknown' as const },
    ]) {
      expect(modernFlatsFit({ ...block, ...not }), JSON.stringify(not)).toBe(false);
    }
  });

  it('admit no garage, shutters, porch, dormer or clapboard', () => {
    expect(MODERN_FLATS_FEATURES).toMatchObject({
      garage: 0,
      shutters: 0,
      frontPorch: 0,
      dormer: 0,
      siding: 0,
      chimney: 0,
      picture: 0,
    });
  });

  /** A 30 × 14 m block of `storeys` storeys, its long side to the road. */
  const blockAt = (storeys: number, fields: Partial<BuildingFeature> = {}): BuildingFeature => ({
    ...buildingBeside(road, roadOrigin, [rectangleBeside(1_100, 22, 30, 14)], storeys * 3),
    ...NO_BUILDING_FIELDS,
    ...fields,
  });

  it('plan a three- and a four-storey block in a town flat-roofed, plain-windowed and with no garage', () => {
    for (const storeys of [3, 4]) {
      const plan = planOne(blockAt(storeys), 'town');
      expect(plan.storeys).toBe(storeys);
      expect(plan.buildingArchetype).toBe('modern-flats');
      expect(plan.archetype).toBe('unknown');
      expect(plan.roof).toBe('flat');
      expect(plan.surfaces.wall).toBe('render');
      expect(plan.surfaces.roof).toBe('flat-roof');
      expect(plan.cladding.wall).toBe('photograph');
      expect(plan.garage).toBe(false);
      expect(plan.porch).toBe(false);
      expect(has(plan, STYLE_SASH)).toBe(false);
      expect(has(plan, STYLE_SHUTTERS)).toBe(false);
      expect(plan.triangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_TRIANGLES);
    }
  });

  it('leave the same block as before in a village, beside a rural stretch, and with the lever off', () => {
    const three = blockAt(3);
    const town = planOne(three, 'town');
    const off = planOne(three, 'town', 'residential', { houseStyles: false });
    expect(off.buildingArchetype).not.toBe('modern-flats');
    expect(planFingerprint([off])).not.toBe(planFingerprint([town]));
    // Before, such a block has sash windows.
    expect(has(off, STYLE_SASH)).toBe(true);
    for (const [urban, kind] of [
      ['village', 'residential'],
      ['rural', 'residential'],
    ] as const) {
      const on = planOne(three, urban, kind);
      expect(on.buildingArchetype, urban).not.toBe('modern-flats');
      expect(planFingerprint([on]), urban).toBe(
        planFingerprint([planOne(three, urban, kind, { houseStyles: false })]),
      );
    }
    // A block mapped as apartments is the flats too, in a town and not in a village.
    const typed = blockAt(3, { buildingType: 'apartments' });
    expect(planOne(typed, 'town').buildingArchetype).toBe('modern-flats');
    expect(planOne(typed, 'village').buildingArchetype).not.toBe('modern-flats');
  });

  it('are the flats, and no contemporary house, where a three-storey block fits both bands', () => {
    // 250 m² of three storeys: inside the contemporary house's 40 to 300 m² and one to three
    // storeys, and inside the flats' 200 m² and three to four. The flats are chosen first.
    const both = {
      ...buildingBeside(road, roadOrigin, [rectangleBeside(1_100, 22, 25, 10)], 9),
      ...NO_BUILDING_FIELDS,
    };
    const plan = planOne(both, 'town');
    expect(plan.storeys).toBe(3);
    expect(plan.buildingArchetype).toBe('modern-flats');
    expect(plan.archetype).toBe('unknown');
    expect(plan.garage).toBe(false);
    // Control: the same block of two storeys is under the flats' band, and is a house.
    const two = {
      ...buildingBeside(road, roadOrigin, [rectangleBeside(1_100, 22, 25, 10)], 6),
      ...NO_BUILDING_FIELDS,
    };
    expect(planOne(two, 'town').buildingArchetype).not.toBe('modern-flats');
  });

  it('leave a two-storey block a garden apartment, and a mapped pitched roof pitched', () => {
    expect(planOne(blockAt(2), 'town').buildingArchetype).toBe('garden-apartment');
    const hipped = planOne(blockAt(3, { roofShape: 'hipped' }), 'town');
    expect(hipped.buildingArchetype).toBe('modern-flats');
    expect(hipped.roof).not.toBe('flat');
  });
});
