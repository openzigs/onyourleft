// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1792: a mapped footprint's `building:colour`, `roof:colour`,
 * `building:material` and `roof:material` paint and clad it, on surfaces,
 * claddings and paints the belt already has. Held where a rider sees it: the
 * plans `footprintPlans` returns, the `clad` and `flags` style floats in the
 * vertex floats the belt uploads, and the colour the belt paints a role
 * (`three-renderer.ts` §`mappedRolePaint`).
 */

import { readFileSync } from 'node:fs';

import type { BuildingFeature, BuildingFields } from '@onyourleft/map-features';
import { describe, expect, it } from 'vitest';

import {
  MAPPED_PALETTE,
  PAINT_LIMITS,
  roofPaintsOf,
  SHINGLE_PAINTS,
  WALL_PAINTS,
  type Rgb,
} from './building-paint';
import {
  CLAD_CLAPBOARD,
  CLAD_PHOTOGRAPH,
  CLAD_SHINGLE,
  FOOTPRINT_SURFACES,
  FOOTPRINT_VERTEX_FLOATS,
  footprintPlans,
  GLAZED_MIN_STOREYS,
  STOREY_METRES,
  STYLE_GLAZED,
  STYLE_OFFSET,
  type FootprintPlan,
  type FootprintPlanOptions,
} from './footprint-buildings';
import {
  buildingBeside,
  landBeside,
  mappedPaintStreetFixture,
  mixedTownFixture,
  planFingerprint,
  rectangleBeside,
} from './footprint-fixtures-testing';
import { landClassMask } from './land-class';
import { northRoute } from './route-fixtures-testing';
import { corridorOrigin } from './terrain';
import { mappedRolePaint } from './three-renderer';
import { urbanClassMap } from './urban-class';
import type { WorldCorridor } from './world-data/corridor';

const profile = northRoute(3_000, () => 10);
const origin = corridorOrigin(profile);

/** A house 12 m along the road by 8 m deep, 22 m out at `along`, tagged `tags`, planned alone. */
function planHouse(
  along: number,
  tags: Partial<BuildingFields>,
  options: FootprintPlanOptions = {},
  height = 3.5,
): FootprintPlan {
  const building: BuildingFeature = {
    ...buildingBeside(profile, origin, [rectangleBeside(along, 22, 12, 8)], height),
    roofShape: 'gabled',
    ...tags,
  };
  return planAll([building], options)[0] as FootprintPlan;
}

/** `buildings` on residential land beside the north road, planned with no urban class. */
function planAll(
  buildings: readonly BuildingFeature[],
  options: FootprintPlanOptions = {},
): readonly FootprintPlan[] {
  const corridor: WorldCorridor = {
    routeId: 'mapped-paint',
    origin,
    covered: () => true,
    coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
    landUse: [landBeside(profile, origin, 'landuse', 'residential', 900, 1_600, -80, 80)],
    buildings,
    paths: [],
    streets: [],
  };
  const { plans } = footprintPlans(
    corridor,
    landClassMask(corridor),
    profile,
    origin,
    undefined,
    undefined,
    options,
  );
  expect(plans).toHaveLength(buildings.length);
  return plans;
}

/** Every `clad` code a role's vertices carry, the integer part of the first style float. */
function cladCodes(plan: FootprintPlan, role: 'wall' | 'roof'): Set<number> {
  const floats = plan.triangles[role];
  const codes = new Set<number>();
  for (let at = 0; at < floats.length; at += FOOTPRINT_VERTEX_FLOATS) {
    codes.add(Math.floor((floats[at + STYLE_OFFSET] as number) + 0.0001));
  }
  return codes;
}

/** Whether any of the wall's vertices carries `flag` in its style's flags. */
function wallFlag(plan: FootprintPlan, flag: number): boolean {
  const floats = plan.triangles.wall;
  for (let at = 0; at < floats.length; at += FOOTPRINT_VERTEX_FLOATS) {
    if ((Math.round(floats[at + STYLE_OFFSET + 1] as number) & flag) !== 0) return true;
  }
  return false;
}

/** The first place along the road from 1 000 m whose untagged house `wanted` holds of. */
function placeWhere(wanted: (plan: FootprintPlan) => boolean): number {
  for (let along = 1_000; along < 1_500; along += 5) {
    if (wanted(planHouse(along, {}))) return along;
  }
  throw new Error('no place on the road plans such a house');
}

/** The entry of `paints` nearest `colour` over `ground`, in linear RGB, written out here. */
function nearestByHand(paints: readonly Rgb[], colour: Rgb, ground: number): number {
  const distances = paints.map((paint) =>
    paint.reduce((sum, channel, at) => sum + (channel * ground - (colour[at] as number)) ** 2, 0),
  );
  return distances.indexOf(Math.min(...distances));
}

describe('#1792: a mapped material, read back from the plan', () => {
  it('walls a house tagged brick, whose seeded draw is clapboard, in brick', () => {
    const along = placeWhere((plan) => plan.cladding.wall === 'clapboard');
    const untagged = planHouse(along, {});
    expect(cladCodes(untagged, 'wall').has(CLAD_CLAPBOARD)).toBe(true);
    const brick = planHouse(along, { wallMaterial: 'brick' });
    expect(brick.surfaces.wall).toBe('brick');
    expect(brick.cladding.wall).toBe('photograph');
    expect([...cladCodes(brick, 'wall')]).toStrictEqual([CLAD_PHOTOGRAPH]);
    // Off, the tag is ignored: the seeded clapboard.
    const off = planHouse(along, { wallMaterial: 'brick' }, { mappedPaint: false });
    expect(off.cladding.wall).toBe('clapboard');
    expect(planFingerprint([off])).toBe(planFingerprint([untagged]));
  });

  it('roofs a house tagged metal in corrugated sheet, never shingles', () => {
    const along = placeWhere((plan) => plan.cladding.roof === 'shingle');
    const metal = planHouse(along, { roofMaterial: 'metal' });
    expect(metal.surfaces.roof).toBe('corrugated');
    expect(metal.cladding.roof).toBe('photograph');
    expect(cladCodes(metal, 'roof').has(CLAD_SHINGLE)).toBe(false);
    // Control: the same house untagged is shingled.
    expect(cladCodes(planHouse(along, {}), 'roof').has(CLAD_SHINGLE)).toBe(true);
  });

  it('clads a house tagged wood, whose seeded draw is not clapboard, in clapboard', () => {
    const along = placeWhere((plan) => plan.cladding.wall === 'photograph');
    const wood = planHouse(along, { wallMaterial: 'wood' });
    expect(wood.cladding.wall).toBe('clapboard');
    expect(cladCodes(wood, 'wall').has(CLAD_CLAPBOARD)).toBe(true);
    expect(planHouse(along, {}).cladding.wall).toBe('photograph');
  });

  it('puts every other material on the surface the table names', () => {
    const clapboard = placeWhere((plan) => plan.cladding.wall === 'clapboard');
    for (const [material, surface] of [
      ['plaster', 'render'],
      ['concrete', 'concrete'],
      ['metal', 'corrugated'],
    ] as const) {
      const plan = planHouse(clapboard, { wallMaterial: material });
      expect(plan.surfaces.wall, material).toBe(surface);
      expect(plan.cladding.wall, material).toBe('photograph');
    }
    const shingled = placeWhere((plan) => plan.cladding.roof === 'shingle');
    for (const [material, surface] of [
      ['slate', 'slate'],
      ['roof_tiles', 'roof-tiles'],
    ] as const) {
      const plan = planHouse(shingled, { roofMaterial: material });
      expect(plan.surfaces.roof, material).toBe(surface);
      expect(plan.cladding.roof, material).toBe('photograph');
    }
    const plain = placeWhere((plan) => plan.roof !== 'flat' && plan.cladding.roof === 'photograph');
    const asphalt = planHouse(plain, { roofMaterial: 'asphalt' });
    expect(asphalt.cladding.roof).toBe('shingle');
    expect(cladCodes(asphalt, 'roof').has(CLAD_SHINGLE)).toBe(true);
  });

  it('reads no stone and no concrete roof: the plan is as untagged, at the places the seeded draw would clad', () => {
    const clapboard = placeWhere((plan) => plan.cladding.wall === 'clapboard');
    const stone = planHouse(clapboard, { wallMaterial: 'stone' });
    const untaggedWall = planHouse(clapboard, {});
    expect(untaggedWall.cladding.wall).toBe('clapboard');
    expect(planFingerprint([stone])).toBe(planFingerprint([untaggedWall]));
    expect(stone.surfaces).toStrictEqual(untaggedWall.surfaces);
    const shingled = placeWhere((plan) => plan.cladding.roof === 'shingle');
    const concrete = planHouse(shingled, { roofMaterial: 'concrete' });
    const untaggedRoof = planHouse(shingled, {});
    expect(untaggedRoof.cladding.roof).toBe('shingle');
    expect(planFingerprint([concrete])).toBe(planFingerprint([untaggedRoof]));
    expect(concrete.surfaces).toStrictEqual(untaggedRoof.surfaces);
    expect(concrete.cladding.roof).toBe('shingle');
  });

  it('reads no roof material on a flat roof: the plan is as untagged', () => {
    const along = 1_100;
    const flat = planHouse(along, { roofShape: 'flat' });
    expect(flat.roof).toBe('flat');
    const flatMetal = planHouse(along, { roofShape: 'flat', roofMaterial: 'metal' });
    expect(flatMetal.surfaces.roof).toBe(flat.surfaces.roof);
    expect(planFingerprint([flatMetal])).toBe(planFingerprint([flat]));
  });

  it('glazes a tower tagged glass with no urban class, which only a covered class glazes untagged', () => {
    const storeys = GLAZED_MIN_STOREYS + 1;
    const tower = (tags: Partial<BuildingFields>) =>
      planHouse(1_100, { roofShape: 'flat', ...tags }, {}, storeys * STOREY_METRES);
    expect(tower({}).storeys).toBe(storeys);
    expect(wallFlag(tower({}), STYLE_GLAZED)).toBe(false);
    expect(wallFlag(tower({ wallMaterial: 'glass' }), STYLE_GLAZED)).toBe(true);
    // A house tagged glass is too low for a curtain wall: unchanged.
    expect(planFingerprint([planHouse(1_100, { wallMaterial: 'glass' })])).toBe(
      planFingerprint([planHouse(1_100, {})]),
    );
  });

  it('wears only the belt’s own surfaces on the painted street', () => {
    const street = mappedPaintStreetFixture();
    const land = landClassMask(street.corridor);
    const { plans } = footprintPlans(
      street.corridor,
      land,
      street.profile,
      street.origin,
      undefined,
      urbanClassMap(street.corridor, land, street.profile),
    );
    for (const plan of plans) {
      expect(FOOTPRINT_SURFACES).toContain(plan.surfaces.wall);
      expect(FOOTPRINT_SURFACES).toContain(plan.surfaces.roof);
    }
    // Every material the table maps is worn somewhere on it.
    const worn = new Set(plans.flatMap((plan) => [plan.surfaces.wall, plan.surfaces.roof]));
    for (const surface of ['brick', 'render', 'concrete', 'corrugated', 'slate', 'roof-tiles']) {
      expect(worn.has(surface as (typeof FOOTPRINT_SURFACES)[number]), surface).toBe(true);
    }
  });
});

describe('#1792: a mapped colour, painted the nearest paint its surface has', () => {
  it('paints a plastered wall, for every palette index, the nearest render paint over white', () => {
    const render = WALL_PAINTS.render ?? [];
    const entries = new Set<number>();
    MAPPED_PALETTE.forEach((colour, index) => {
      const plan = planHouse(1_100, { wallMaterial: 'plaster', wallColour: index });
      expect(plan.surfaces.wall).toBe('render');
      const expected = nearestByHand(render, colour, 0.89);
      expect(plan.paint.wall, `index ${index}`).toBe(expected);
      // What the belt paints the wall: that entry of the list, inside the limits.
      const painted = mappedRolePaint(plan, 'wall');
      expect(painted).toStrictEqual(render[expected]);
      for (const channel of painted) {
        expect(channel).toBeGreaterThan(0);
        expect(channel).toBeLessThanOrEqual(PAINT_LIMITS.multiplier);
      }
      entries.add(expected);
    });
    // Not vacuous: the palette reaches more than one paint.
    expect(entries.size).toBeGreaterThan(3);
  });

  it('paints a brick wall, a metal wall and a shingled roof by the same rule, each over its own ground', () => {
    for (const [index, colour] of MAPPED_PALETTE.entries()) {
      const brick = planHouse(1_100, { wallMaterial: 'brick', wallColour: index });
      expect(brick.paint.wall).toBe(nearestByHand(WALL_PAINTS.brick ?? [], colour, 1));
      const metal = planHouse(1_100, { wallMaterial: 'metal', wallColour: index });
      expect(metal.paint.wall).toBe(nearestByHand(WALL_PAINTS.corrugated ?? [], colour, 0.4));
      const shingled = planHouse(1_100, { roofMaterial: 'asphalt', roofColour: index });
      expect(shingled.paint.roof).toBe(nearestByHand(SHINGLE_PAINTS, colour, 1));
      const albedo = mappedRolePaint(shingled, 'roof');
      expect(albedo).toStrictEqual(SHINGLE_PAINTS[shingled.paint.roof]);
      for (const channel of albedo) {
        expect(channel).toBeGreaterThanOrEqual(PAINT_LIMITS.albedoLowest);
        expect(channel).toBeLessThanOrEqual(PAINT_LIMITS.albedoHighest);
      }
    }
  });

  it('paints a roof colour on the list its roof wears', () => {
    const along = placeWhere((plan) => plan.roof !== 'flat');
    for (const [index, colour] of MAPPED_PALETTE.entries()) {
      const plan = planHouse(along, { roofMaterial: 'slate', roofColour: index });
      expect(plan.paint.roof).toBe(nearestByHand(roofPaintsOf('slate', false) ?? [], colour, 1));
    }
  });

  it('keeps two tagged neighbours in the same colour alike, where untagged ones are painted apart', () => {
    const pair = (tags: Partial<BuildingFields>) =>
      planAll(
        [1_100, 1_115].map((along) => ({
          ...buildingBeside(profile, origin, [rectangleBeside(along, 22, 12, 8)], 3.5),
          roofShape: 'gabled',
          wallMaterial: 'plaster',
          ...tags,
        })),
      );
    const white = pair({ wallColour: 0, roofMaterial: 'slate', roofColour: 0 });
    expect(white[0]?.paint.wall).toBe(white[1]?.paint.wall);
    expect(white[0]?.paint.roof).toBe(white[1]?.paint.roof);
    // Control: the same two untagged in colour are walled apart by the neighbour rule.
    const seeded = pair({ roofMaterial: 'slate' });
    expect(seeded[0]?.paint.wall).not.toBe(seeded[1]?.paint.wall);
  });

  it('ignores every colour with `mappedPaint: false`', () => {
    const along = 1_100;
    const untagged = planHouse(along, {});
    const tagged = { wallColour: 14, roofColour: 15, wallMaterial: 'wood', roofMaterial: 'metal' };
    const off = planHouse(along, tagged as Partial<BuildingFields>, { mappedPaint: false });
    expect(planFingerprint([off])).toBe(planFingerprint([untagged]));
    expect(off.surfaces).toStrictEqual(untagged.surfaces);
    expect(off.cladding).toStrictEqual(untagged.cladding);
    // Not vacuous: on, the same footprint plans otherwise.
    const on = planHouse(along, tagged as Partial<BuildingFields>);
    expect(on.surfaces).not.toStrictEqual(untagged.surfaces);
  });
});

/**
 * {@link mixedTownFixture}'s plans' fingerprint, paint included, planned with its urban class,
 * measured on `main` at b15b8ce3 — before #1792.
 */
const MIXED_TOWN_BEFORE_1792 = '2b5b40a1';

describe('#1792: an untagged town plans as before', () => {
  it('plans the mixed town, which carries no colour or material, as before #1792', () => {
    const town = mixedTownFixture();
    for (const building of town.corridor.buildings) {
      expect(building.wallColour ?? null).toBeNull();
      expect(building.roofColour ?? null).toBeNull();
      expect(building.wallMaterial ?? null).toBeNull();
      expect(building.roofMaterial ?? null).toBeNull();
    }
    const land = landClassMask(town.corridor);
    const urban = urbanClassMap(town.corridor, land, town.profile);
    const plan = (options: FootprintPlanOptions) =>
      footprintPlans(town.corridor, land, town.profile, town.origin, undefined, urban, options)
        .plans;
    const on = plan({});
    const off = plan({ mappedPaint: false });
    expect(planFingerprint(on)).toBe(MIXED_TOWN_BEFORE_1792);
    expect(planFingerprint(off)).toBe(MIXED_TOWN_BEFORE_1792);
    expect(on.map((each) => [each.surfaces, each.cladding])).toStrictEqual(
      off.map((each) => [each.surfaces, each.cladding]),
    );
  });
});

describe('#1792: the palette is the basemap profile’s', () => {
  it('holds MAPPED_PALETTE to `BuildingPalette.java`’s entries, in order', () => {
    const java = readFileSync(
      new URL(
        '../../tools/basemap/profile/src/main/java/dev/openzigs/onyourleft/basemap/BuildingPalette.java',
        import.meta.url,
      ),
      'utf8',
    );
    const entries = [...java.matchAll(/new Entry\("[a-z_]+", 0x([0-9A-Fa-f]{6})\)/g)].map((match) =>
      Number.parseInt(match[1] as string, 16),
    );
    expect(entries).toHaveLength(MAPPED_PALETTE.length);
    const linear = (channel: number): number => {
      const c = channel / 255;
      return c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    entries.forEach((hex, index) => {
      const want = [linear((hex >> 16) & 0xff), linear((hex >> 8) & 0xff), linear(hex & 0xff)];
      const have = MAPPED_PALETTE[index] as Rgb;
      for (const at of [0, 1, 2]) expect(have[at]).toBeCloseTo(want[at] as number, 12);
    });
  });
});
