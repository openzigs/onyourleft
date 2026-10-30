// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1782: a US house archetype per mapped residential footprint, setting its
 * features together. Held where a rider sees it: the plans `footprintPlans`
 * returns and the packed vertex floats the belt uploads — their style flags
 * and their roles' triangles — over #1581's mixed town (four of the six) and
 * #1782's street of houses (all six). The fallback and the lever are held
 * against fingerprints of `origin/main`'s own plans of the same towns.
 */

import { describe, expect, it } from 'vitest';

import type { BuildingFeature } from '@onyourleft/map-features';

import {
  FACADE_DOOR,
  FACADE_GARAGE,
  FACADE_OFFSET,
  FOOTPRINT_GABLE_MIN_RECTANGULARITY,
  FOOTPRINT_MAX_FAR_TRIANGLES,
  FOOTPRINT_MAX_TRIANGLES,
  FOOTPRINT_ROLES,
  FOOTPRINT_VERTEX_FLOATS,
  footprintPlans,
  PORCH,
  ROOF_PITCHES_DEGREES,
  STYLE_BRICK_FOUNDATION,
  STYLE_OFFSET,
  STYLE_SHUTTERS,
  type FootprintPlan,
  type FootprintPlanOptions,
  type FootprintRole,
} from './footprint-buildings';
import {
  buildingBeside,
  houseStreetFixture,
  landBeside,
  mixedTownFixture,
  polygonBeside,
  rectangleBeside,
} from './footprint-fixtures-testing';
import {
  ARCHETYPE_CUES,
  ARCHETYPE_DROPS,
  ARCHETYPE_FEATURES,
  ARCHETYPE_MIN_RECTANGULARITY,
  droppedFeatures,
  footprintShapeOf,
  HOUSE_ARCHETYPES,
  houseArchetypeOf,
  SEEDED_FEATURES,
  type ArchetypeInput,
  type HouseArchetype,
} from './house-archetypes';
import { landClassMask } from './land-class';
import { northRoute } from './route-fixtures-testing';
import { corridorOrigin } from './terrain';
import { urbanClassMap, type UrbanClassMap } from './urban-class';
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

/** One vertex of a plan, as the belt uploads it. */
interface Vertex {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly top: number;
  readonly extra: number;
  readonly flags: number;
}

function verticesOf(plan: FootprintPlan, role: FootprintRole): Vertex[] {
  const floats = plan.triangles[role];
  const out: Vertex[] = [];
  for (let at = 0; at < floats.length; at += FOOTPRINT_VERTEX_FLOATS) {
    out.push({
      x: floats[at] as number,
      y: floats[at + 1] as number,
      z: floats[at + 2] as number,
      top: floats[at + FACADE_OFFSET + 2] as number,
      flags: floats[at + STYLE_OFFSET + 1] as number,
      extra: floats[at + STYLE_OFFSET + 3] as number,
    });
  }
  return out;
}

/** A garage door on its front: its face in the door role. */
const hasGarage = (plan: FootprintPlan): boolean =>
  verticesOf(plan, 'door').some((vertex) => vertex.top === FACADE_GARAGE) ||
  plan.triangles.driveway.length > 0;

/**
 * A porch on posts: #1589's front porch, whose deck stands on posts, or a door
 * canopy's posts — trim standing on the floor within a canopy's width of the door.
 */
function hasPostedPorch(plan: FootprintPlan): boolean {
  if (plan.triangles.porch.length > 0) return true;
  const door = verticesOf(plan, 'door').filter((vertex) => vertex.top === FACADE_DOOR);
  if (door.length === 0) return false;
  const floor = Math.min(...door.map((vertex) => vertex.y));
  const mx = door.reduce((sum, vertex) => sum + vertex.x, 0) / door.length;
  const mz = door.reduce((sum, vertex) => sum + vertex.z, 0) / door.length;
  return verticesOf(plan, 'trim').some(
    (vertex) =>
      vertex.y <= floor + 1e-3 &&
      Math.hypot(vertex.x - mx, vertex.z - mz) <= Math.hypot(PORCH.width / 2, PORCH.depth),
  );
}

/** A canopy over the door: trim above a door's height, within a canopy's reach of the door. */
function hasCanopy(plan: FootprintPlan): boolean {
  const door = verticesOf(plan, 'door').filter((vertex) => vertex.top === FACADE_DOOR);
  if (door.length === 0) return false;
  const floor = Math.min(...door.map((vertex) => vertex.y));
  const mx = door.reduce((sum, vertex) => sum + vertex.x, 0) / door.length;
  const mz = door.reduce((sum, vertex) => sum + vertex.z, 0) / door.length;
  return verticesOf(plan, 'trim').some(
    (vertex) =>
      vertex.y > floor + 2.3 &&
      Math.hypot(vertex.x - mx, vertex.z - mz) <= Math.hypot(PORCH.width / 2, PORCH.depth),
  );
}
/** A front porch round the door (#1589): the porch role has triangles. */
const hasFrontPorch = (plan: FootprintPlan): boolean => plan.triangles.porch.length > 0;
const hasChimney = (plan: FootprintPlan): boolean => plan.triangles.chimney.length > 0;
/** A brick foundation band: a wall vertex carrying the foundation flag. */
const hasBrickFoundation = (plan: FootprintPlan): boolean =>
  verticesOf(plan, 'wall').some((vertex) => (vertex.flags & STYLE_BRICK_FOUNDATION) !== 0);

const hasDormer = (plan: FootprintPlan): boolean => plan.triangles.dormer.length > 0;
/** A gable end: a wall vertex above the eaves, under the gable's ridge. */
const hasGable = (plan: FootprintPlan): boolean =>
  verticesOf(plan, 'wall').some((vertex) => vertex.y > plan.eaves + 1e-3);
/** How many storeys high its walls are, as their windows are laid out: the facade's `top`. */
const wallStoreys = (plan: FootprintPlan): number =>
  Math.max(...verticesOf(plan, 'wall').map((vertex) => vertex.top));
const hasShutters = (plan: FootprintPlan): boolean =>
  verticesOf(plan, 'wall').some((vertex) => (vertex.flags & STYLE_SHUTTERS) !== 0);
/** A picture window: a wall bay the style names. */
const hasPicture = (plan: FootprintPlan): boolean =>
  verticesOf(plan, 'wall').some((vertex) => vertex.top > 0 && vertex.extra >= 0);

/**
 * An FNV-1a over every plan's roof, pitch, storeys, dormers, garage, porch and
 * (`withPaint`) paint and every float of every role's triangles, in order: two
 * plans of a town hash alike only if the belt would upload the same bytes for them.
 */
function fingerprint(plans: readonly FootprintPlan[], withPaint = true): string {
  let hash = 0x81_1c_9d_c5;
  const mix = (word: number): void => {
    hash ^= word;
    hash = Math.imul(hash, 0x01_00_01_93) >>> 0;
  };
  const scalar = new Float32Array(1);
  const scalarBits = new Uint32Array(scalar.buffer);
  const value = (n: number): void => {
    scalar[0] = n;
    mix(scalarBits[0] as number);
  };
  for (const each of plans) {
    value(['flat', 'gable', 'hip'].indexOf(each.roof));
    value(each.pitchDegrees);
    value(each.storeys);
    value(each.dormers);
    value(each.garage ? 1 : 0);
    value(each.porch ? 1 : 0);
    if (withPaint) {
      value(each.paint.wall);
      value(each.paint.roof);
      value(each.paint.trim);
      value(each.paint.door);
    }
    for (const role of FOOTPRINT_ROLES) {
      const floats = each.triangles[role];
      const bits = new Uint32Array(floats.buffer, floats.byteOffset, floats.length);
      mix(bits.length);
      for (const word of bits) mix(word);
    }
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * `origin/main`'s plans at `7f7d66ab`, before #1782, fingerprinted by
 * {@link fingerprint} with `main`'s own `footprint-buildings.ts` in place:
 * the mixed town with its urban class (the realistic page's), the mixed town
 * with none, and the street of houses (the same with a class or without).
 *
 * A frozen record of the pre-#1782 planner, not a snapshot to refresh. If a later
 * change moves these, it has changed what the lever-off plan is: update them only
 * with a stated, reviewed reason in the PR. To re-derive, check out `7f7d66ab`'s
 * `footprint-buildings.ts` and run {@link fingerprint} over the same three towns.
 */
const MAIN_FINGERPRINTS = {
  mixed: 'f23e2062',
  mixedUnclassed: 'a78617c6',
  houses: '62e07ad1',
} as const;

const mixed = mixedTownFixture();
const houses = houseStreetFixture();
const mixedPlans = plan(mixed);
const housePlans = plan(houses);
const everyPlan = [...mixedPlans, ...housePlans];
const ofArchetype = (archetype: HouseArchetype): readonly FootprintPlan[] =>
  everyPlan.filter((each) => each.archetype === archetype);

/** A footprint that fits each archetype, as {@link houseArchetypeOf} reads it. */
const TYPICAL: Readonly<Record<Exclude<HouseArchetype, 'unknown'>, ArchetypeInput>> = {
  ranch: {
    area: 150,
    aspect: 2,
    rectangularity: 1,
    shape: 'rectangle',
    storeys: 1,
    residential: true,
    urban: 'village',
    terraced: false,
    deep: false,
    pitched: true,
  },
  cape: {
    area: 90,
    aspect: 1.3,
    rectangularity: 1,
    shape: 'rectangle',
    storeys: 1,
    residential: true,
    urban: 'town',
    terraced: false,
    deep: false,
    pitched: true,
  },
  bungalow: {
    area: 100,
    aspect: 1.7,
    rectangularity: 1,
    shape: 'rectangle',
    storeys: 1,
    residential: true,
    urban: 'unknown',
    terraced: false,
    deep: true,
    pitched: true,
  },
  colonial: {
    area: 120,
    aspect: 1.5,
    rectangularity: 1,
    shape: 'rectangle',
    storeys: 2,
    residential: true,
    urban: 'village',
    terraced: false,
    deep: false,
    pitched: true,
  },
  foursquare: {
    area: 90,
    aspect: 1.1,
    rectangularity: 1,
    shape: 'rectangle',
    storeys: 2,
    residential: true,
    urban: 'town',
    terraced: false,
    deep: true,
    pitched: true,
  },
  farmhouse: {
    area: 120,
    aspect: 1.5,
    rectangularity: 1,
    shape: 'L',
    storeys: 2,
    residential: true,
    urban: 'rural',
    terraced: false,
    deep: true,
    pitched: true,
  },
};

describe('which archetype a footprint is — #1782', () => {
  it.each(HOUSE_ARCHETYPES)('classes a typical %s as one', (archetype) => {
    expect(houseArchetypeOf(TYPICAL[archetype])).toBe(archetype);
  });

  it.each([
    ['a 30-vertex irregular footprint', { ...TYPICAL.cape, shape: 'other' as const }],
    ['a terraced footprint', { ...TYPICAL.colonial, terraced: true }],
    ['a commercial footprint', { ...TYPICAL.ranch, residential: false }],
    ['a flat-roofed footprint', { ...TYPICAL.foursquare, pitched: false }],
    ['a footprint in a city centre', { ...TYPICAL.colonial, urban: 'city-centre' as const }],
    ['a rectangle too ragged to be a clean one', { ...TYPICAL.cape, rectangularity: 0.8 }],
    ['a Cape drawn as an L', { ...TYPICAL.cape, shape: 'L' as const }],
    ['a farmhouse in a town', { ...TYPICAL.farmhouse, urban: 'town' as const }],
    ['a ranch end-on to the road', { ...TYPICAL.ranch, deep: true, area: 200 }],
  ])('classes %s as `unknown`', (_, input) => {
    expect(houseArchetypeOf(input)).toBe('unknown');
  });

  it.each(HOUSE_ARCHETYPES)('classes a %s just outside its area band as `unknown`', (archetype) => {
    const [least, most] = ARCHETYPE_CUES[archetype].area;
    const typical = TYPICAL[archetype];
    // Inside both ends, and out past each.
    expect(houseArchetypeOf({ ...typical, area: least })).toBe(archetype);
    expect(houseArchetypeOf({ ...typical, area: most })).toBe(archetype);
    expect(houseArchetypeOf({ ...typical, area: least - 1 })).not.toBe(archetype);
    expect(houseArchetypeOf({ ...typical, area: most + 1 })).not.toBe(archetype);
    expect(houseArchetypeOf({ ...typical, area: most + 1 })).toBe('unknown');
  });

  it('reads a clean rectangle and a clean L, and nothing else, as a shape', () => {
    expect(footprintShapeOf(4, 1)).toBe('rectangle');
    expect(footprintShapeOf(4, undefined)).toBe('rectangle');
    expect(footprintShapeOf(6, 2)).toBe('L');
    expect(footprintShapeOf(6, undefined)).toBe('other');
    expect(footprintShapeOf(8, 2)).toBe('other');
    expect(footprintShapeOf(8, 3)).toBe('other');
    expect(footprintShapeOf(30, undefined)).toBe('other');
  });

  it('plans each house of the street as the archetype it was drawn as, read back from the plan', () => {
    // The street's order, both sides of each lot, then the farmhouses.
    const street: readonly HouseArchetype[] = [
      'ranch',
      'cape',
      'bungalow',
      'colonial',
      'foursquare',
      'ranch',
    ];
    const lots = housePlans.length - 8;
    for (const [index, each] of housePlans.entries()) {
      const expected = index < lots ? street[index % street.length] : 'farmhouse';
      expect(each.archetype).toBe(expected);
    }
  });

  it('plans a 30-vertex footprint and a shop as `unknown`, read back from the plan', () => {
    const profile = northRoute(3_000, () => 10);
    const origin = corridorOrigin(profile);
    const buildings: BuildingFeature[] = [
      buildingBeside(profile, origin, [polygonBeside(1_000, 24, 6, 30)], 3.5),
      buildingBeside(profile, origin, [rectangleBeside(1_100, 24, 10.5, 8)], 3.5),
      buildingBeside(profile, origin, [rectangleBeside(1_300, 24, 10.5, 8)], 3.5),
    ];
    const corridor: WorldCorridor = {
      routeId: 'odd-houses',
      origin,
      covered: () => true,
      coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
      landUse: [
        landBeside(profile, origin, 'landuse', 'residential', 900, 1_200, -60, 60),
        landBeside(profile, origin, 'landuse', 'retail', 1_200, 1_400, -60, 60),
      ],
      buildings,
      paths: [],
      streets: [],
    };
    const { plans } = footprintPlans(corridor, landClassMask(corridor), profile, origin);
    expect(plans.map((each) => each.archetype)).toStrictEqual(['unknown', 'cape', 'unknown']);
  });
});

describe('an archetype sets its features together — #1782, read back from the plan', () => {
  it('has every archetype among the mixed town and the street, each more than once', () => {
    for (const archetype of HOUSE_ARCHETYPES) {
      expect(ofArchetype(archetype).length).toBeGreaterThan(3);
    }
    // The mixed town alone has four of them, among its unknowns.
    const inTown = new Set(mixedPlans.map((each) => each.archetype));
    expect([...inTown].sort()).toStrictEqual(
      ['bungalow', 'cape', 'colonial', 'foursquare', 'unknown'].sort(),
    );
  });

  it('builds no Cape with a garage or a posted porch, and gives every one shutters', () => {
    for (const each of ofArchetype('cape')) {
      expect(hasGarage(each)).toBe(false);
      expect(hasPostedPorch(each)).toBe(false);
      expect(hasShutters(each)).toBe(true);
      expect(each.roof).toBe('gable');
    }
    // Its steep roof carries its dormers.
    expect(ofArchetype('cape').some(hasDormer)).toBe(true);
  });

  it('builds no ranch with a dormer or a second storey, and gives most a garage', () => {
    for (const each of ofArchetype('ranch')) {
      expect(hasDormer(each)).toBe(false);
      expect(each.storeys).toBe(1);
      expect(wallStoreys(each)).toBeLessThan(2);
      expect(each.pitchDegrees).toBe(25);
    }
    expect(ofArchetype('ranch').filter(hasGarage).length).toBeGreaterThan(
      ofArchetype('ranch').length / 2,
    );
    expect(ofArchetype('ranch').some(hasPicture)).toBe(true);
  });

  it('builds every Colonial hipless, at 30 to 35 degrees, with a chimney, a canopy and shutters, and no porch', () => {
    const colonials = ofArchetype('colonial');
    expect(colonials.length).toBeGreaterThan(3);
    for (const each of colonials) {
      expect(each.roof).toBe('gable');
      expect(each.pitchDegrees).toBeGreaterThanOrEqual(30);
      expect(each.pitchDegrees).toBeLessThanOrEqual(35);
      expect(hasChimney(each)).toBe(true);
      expect(hasCanopy(each)).toBe(true);
      expect(hasFrontPorch(each)).toBe(false);
      expect(hasPostedPorch(each)).toBe(false);
      expect(hasShutters(each)).toBe(true);
      expect(hasDormer(each)).toBe(false);
    }
  });

  it('stands every Foursquare on a front porch on posts', () => {
    const foursquares = ofArchetype('foursquare');
    expect(foursquares.length).toBeGreaterThan(3);
    for (const each of foursquares) expect(hasPostedPorch(each)).toBe(true);
    // A front porch replaces the canopy where it fits, so each has one or the other.
    for (const each of foursquares) expect(hasFrontPorch(each) || hasCanopy(each)).toBe(true);
    expect(foursquares.some(hasFrontPorch)).toBe(true);
  });

  it('builds no Foursquare with a gable roof', () => {
    for (const each of ofArchetype('foursquare')) {
      expect(hasGable(each)).toBe(false);
      expect(verticesOf(each, 'roof').length).toBeGreaterThan(0);
      expect(hasGarage(each)).toBe(false);
    }
  });

  it('builds no bungalow with shutters, and stands most on a porch', () => {
    for (const each of ofArchetype('bungalow')) {
      expect(hasShutters(each)).toBe(false);
      expect(hasGable(each)).toBe(true);
    }
    expect(ofArchetype('bungalow').filter(hasPostedPorch).length).toBeGreaterThan(
      ofArchetype('bungalow').length / 2,
    );
  });

  it('builds no farmhouse with a garage, and clads every one in siding on brick', () => {
    for (const each of ofArchetype('farmhouse')) {
      expect(hasGarage(each)).toBe(false);
      expect(each.cladding.wall).toBe('clapboard');
      expect(hasBrickFoundation(each)).toBe(true);
      expect(each.pitchDegrees).toBeGreaterThanOrEqual(40);
    }
    // Its porch on posts: a front porch where it fits, else the canopy on posts.
    for (const each of ofArchetype('farmhouse')) expect(hasPostedPorch(each)).toBe(true);
    expect(ofArchetype('farmhouse').some(hasFrontPorch)).toBe(true);
  });

  it('admits only pitches the roofs are built at', () => {
    for (const features of Object.values(ARCHETYPE_FEATURES)) {
      if (features.pitches === 'seeded') continue;
      for (const pitch of features.pitches) expect(ROOF_PITCHES_DEGREES).toContain(pitch);
    }
  });
});

describe('the fallback and the lever — #1782', () => {
  it('plans every `unknown` footprint exactly as with the archetypes off', () => {
    for (const town of [mixed, houses]) {
      const on = plan(town);
      const off = plan(town, { houseArchetypes: false });
      expect(on.length).toBe(off.length);
      let unknown = 0;
      on.forEach((each, index) => {
        if (each.archetype !== 'unknown') return;
        unknown += 1;
        expect(fingerprint([each])).toBe(fingerprint([off[index] as FootprintPlan]));
      });
      if (town === mixed) expect(unknown).toBeGreaterThan(100);
    }
  });

  it('plans every footprint as `origin/main` did with the lever off', () => {
    const offPlans = plan(mixed, { houseArchetypes: false });
    expect(offPlans.every((each) => each.archetype === 'unknown')).toBe(true);
    expect(fingerprint(offPlans)).toBe(MAIN_FINGERPRINTS.mixed);
    expect(fingerprint(plan(houses, { houseArchetypes: false }))).toBe(MAIN_FINGERPRINTS.houses);
    const land = landClassMask(mixed.corridor);
    expect(
      fingerprint(
        footprintPlans(mixed.corridor, land, mixed.profile, mixed.origin, undefined, undefined, {
          houseArchetypes: false,
        }).plans,
      ),
    ).toBe(MAIN_FINGERPRINTS.mixedUnclassed);
  });

  it('control: with the lever on, the towns are not `origin/main`’s', () => {
    expect(fingerprint(mixedPlans)).not.toBe(MAIN_FINGERPRINTS.mixed);
    expect(fingerprint(housePlans)).not.toBe(MAIN_FINGERPRINTS.houses);
  });
});

describe('the archetype bar for a clean rectangle — #1782', () => {
  it('is the bar a footprint needs for a gable roof', () => {
    expect(ARCHETYPE_MIN_RECTANGULARITY).toBe(FOOTPRINT_GABLE_MIN_RECTANGULARITY);
  });
});

describe('determinism — #1782', () => {
  it('gives every footprint the same archetype and plan, planned twice and in a shuffled order', () => {
    for (const town of [mixed, houses]) {
      const once = plan(town);
      expect(fingerprint(plan(town))).toBe(fingerprint(once));
      // A fixed shuffle: every third, then the rest reversed.
      const buildings = town.corridor.buildings;
      const shuffled = [
        ...buildings.filter((_, index) => index % 3 === 0),
        ...buildings.filter((_, index) => index % 3 !== 0).reverse(),
      ];
      const again = plan({ ...town, corridor: { ...town.corridor, buildings: shuffled } });
      expect(again.length).toBe(once.length);
      for (const each of once) {
        const twin = again.find(
          (other) => other.centroid.x === each.centroid.x && other.centroid.z === each.centroid.z,
        );
        expect(twin?.archetype).toBe(each.archetype);
        // Its paint is not compared: #1581's `paintTown` moves a paint off the
        // neighbour planned before it, so which of two moves is the order's.
        expect(fingerprint([twin as FootprintPlan], false)).toBe(fingerprint([each], false));
      }
    }
  });
});

describe('the caps — #1782', () => {
  /** The largest footprint each archetype's cue admits, `[along, deep]` metres, and its height. */
  const LARGEST: readonly (readonly [
    HouseArchetype,
    readonly (readonly [number, number])[],
    number,
  ])[] = [
    ['ranch', rectangleBeside(0, 0, 21.2, 11.75), 3.5],
    [
      'ranch',
      [
        [-13, -6.4],
        [13, -6.4],
        [13, 0],
        [0, 0],
        [0, 6.4],
        [-13, 6.4],
      ],
      3.5,
    ],
    ['cape', rectangleBeside(0, 0, 13, 9.2), 3.5],
    ['bungalow', rectangleBeside(0, 0, 9, 15.5), 3.5],
    ['colonial', rectangleBeside(0, 0, 15.2, 10.5), 6.5],
    ['foursquare', rectangleBeside(0, 0, 10.7, 10.25), 6.5],
    ['farmhouse', rectangleBeside(0, 0, 12, 18.3), 6.5],
  ];

  it('holds the largest plan of every archetype to 640 near and 200 far triangles', () => {
    const profile = northRoute(3_000, () => 10);
    const origin = corridorOrigin(profile);
    const buildings = LARGEST.map(([, corners, height], index) =>
      buildingBeside(
        profile,
        origin,
        [corners.map(([a, n]) => [1_000 + index * 40 + a, 24 + n] as const)],
        height,
      ),
    );
    const corridor: WorldCorridor = {
      routeId: 'largest-houses',
      origin,
      covered: () => true,
      coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
      landUse: [],
      buildings,
      paths: [],
      streets: [],
    };
    // Rural, so that the farmhouse is one; no other archetype's cue reads the class.
    const rural: UrbanClassMap = { classAt: () => 'rural' };
    const { plans } = footprintPlans(
      corridor,
      landClassMask(corridor),
      profile,
      origin,
      undefined,
      rural,
    );
    expect(plans.map((each) => each.archetype)).toStrictEqual(
      LARGEST.map(([archetype]) => archetype),
    );
    for (const each of plans) {
      expect(each.triangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_TRIANGLES);
      expect(each.farTriangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_FAR_TRIANGLES);
    }
  });

  it('gives up its dormers first, then its porch', () => {
    expect(ARCHETYPE_DROPS).toStrictEqual(['dormers', 'porch']);
    const cape = ARCHETYPE_FEATURES.cape;
    expect(droppedFeatures(cape, 0)).toStrictEqual(cape);
    const once = droppedFeatures(cape, 1);
    // Since #1786 its called-for dormers go with them.
    expect(once).toStrictEqual({ ...cape, dormer: 0, dormers: 'none' });
    const twice = droppedFeatures(cape, 2);
    expect(twice).toStrictEqual({
      ...cape,
      dormer: 0,
      dormers: 'none',
      canopy: 0,
      frontPorch: 0,
    });
    expect(droppedFeatures(SEEDED_FEATURES, 0)).toStrictEqual(SEEDED_FEATURES);
  });
});
