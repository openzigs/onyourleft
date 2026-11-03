// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1791: a mapped building type decides what its footprint is drawn as. Held
 * where a rider sees it: the plans `footprintPlans` returns and the packed
 * vertex floats the belt uploads — their faces, their style flags and their
 * roles' triangles — over #1791's typed street (`typedStreetFixture`), every
 * footprint on residential land. An untyped town is held to a frozen record of
 * its plans before this change.
 */

import { describe, expect, it } from 'vitest';

import {
  BUILDING_TYPES,
  NO_BUILDING_FIELDS,
  type BuildingFeature,
  type BuildingFields,
  type BuildingType,
} from '@onyourleft/map-features';

import { buildingFamilyOf, resolvedFamily } from './building-types';
import {
  FACADE_DOOR,
  FACADE_GARAGE,
  FACADE_OFFSET,
  FACADE_PAINT,
  FOOTPRINT_MAX_FAR_TRIANGLES,
  FOOTPRINT_MAX_TRIANGLES,
  FOOTPRINT_ROLES,
  FOOTPRINT_VERTEX_FLOATS,
  baysOf,
  footprintPlans,
  STYLE_COMMERCIAL,
  STYLE_OFFSET,
  STYLE_SASH,
  STYLE_SHUTTERS,
  STYLE_TERRACED,
  type FootprintPlan,
  type FootprintPlanOptions,
  type FootprintRole,
} from './footprint-buildings';
import {
  buildingBeside,
  landBeside,
  mixedTownFixture,
  planFingerprint,
  polygonBeside,
  rectangleBeside,
  typedStreetFixture,
} from './footprint-fixtures-testing';
import { landClassMask } from './land-class';
import { northRoute } from './route-fixtures-testing';
import { cityCentreFixture } from './testing/urban-fixtures';
import { corridorOrigin } from './terrain';
import { urbanClassMap } from './urban-class';
import type { WorldCorridor } from './world-data/corridor';

/**
 * {@link mixedTownFixture}'s plans' {@link planFingerprint}, measured on
 * `main` at 8f241c3b — before #1791 — with its urban class (as the press and
 * the page plan it) and without one.
 */
const MIXED_BEFORE_1791 = { urban: '2b5b40a1', none: '3d0fb8ab' } as const;

/** One vertex's facade `top`, style `flags` and style `extra` — the floats the shader reads. */
interface Vertex {
  readonly top: number;
  readonly flags: number;
  readonly extra: number;
}

function verticesOf(plan: FootprintPlan, role: FootprintRole): Vertex[] {
  const floats = plan.triangles[role];
  const out: Vertex[] = [];
  for (let at = 0; at < floats.length; at += FOOTPRINT_VERTEX_FLOATS) {
    out.push({
      top: floats[at + FACADE_OFFSET + 2] as number,
      flags: floats[at + STYLE_OFFSET + 1] as number,
      extra: floats[at + STYLE_OFFSET + 3] as number,
    });
  }
  return out;
}

function everyVertex(plan: FootprintPlan): Vertex[] {
  return FOOTPRINT_ROLES.flatMap((role) => verticesOf(plan, role));
}

const has = (flags: number, flag: number): boolean => (Math.round(flags) & flag) !== 0;

/** A wall face that carries windows: #1581's facade `top`, its storeys, above nought. */
const windowFaces = (plan: FootprintPlan): number =>
  verticesOf(plan, 'wall').filter((vertex) => vertex.top > 0).length;

/** The faces the wreath is drawn on (#1626): a door's. */
const doorFaces = (plan: FootprintPlan): number =>
  everyVertex(plan).filter((vertex) => vertex.top === FACADE_DOOR).length;

/** #1791: every garage-door vertex carries the door's width in the style float before its leaf. */
function expectDoorWidth(plan: FootprintPlan, width: number): void {
  const floats = plan.triangles.door;
  let doors = 0;
  for (let at = 0; at < floats.length; at += FOOTPRINT_VERTEX_FLOATS) {
    if (floats[at + FACADE_OFFSET + 2] !== FACADE_GARAGE) continue;
    doors += 1;
    expect(floats[at + STYLE_OFFSET + 2]).toBeCloseTo(width, 1);
  }
  expect(doors).toBeGreaterThan(0);
}

const triangles = (plan: FootprintPlan, role: FootprintRole): number =>
  plan.triangles[role].length / (3 * FOOTPRINT_VERTEX_FLOATS);

/** The typed street planned as the press plans a corridor, with its urban class. */
function plannedStreet(
  options: FootprintPlanOptions = {},
  corridor = typedStreetFixture().corridor,
): readonly FootprintPlan[] {
  const street = typedStreetFixture();
  const land = landClassMask(corridor);
  const urban = urbanClassMap(corridor, land, street.profile);
  const { plans, verdicts } = footprintPlans(
    corridor,
    land,
    street.profile,
    street.origin,
    undefined,
    urban,
    options,
  );
  // Every footprint kept, so each plan is its footprint's.
  expect(verdicts.kept).toBe(corridor.buildings.length);
  expect(plans).toHaveLength(corridor.buildings.length);
  return plans;
}

/** The street's plans of `row`, both sides. */
function rowOf(plans: readonly FootprintPlan[], row: string): FootprintPlan[] {
  const { rows } = typedStreetFixture();
  const found = plans.filter((_, index) => rows[index] === row);
  expect(found.length).toBeGreaterThan(0);
  return found;
}

/** The typed street with every type and landmark taken away. */
function untypedStreet(): WorldCorridor {
  const { corridor } = typedStreetFixture();
  return {
    ...corridor,
    buildings: corridor.buildings.map((building): BuildingFeature => ({
      ...building,
      ...NO_BUILDING_FIELDS,
    })),
  };
}

describe('#1791: a building type’s family', () => {
  it('reads a landmark as civic whatever its type, and no type as none', () => {
    expect(buildingFamilyOf('house', 'worship')).toBe('civic');
    expect(buildingFamilyOf(null, 'townhall')).toBe('civic');
    expect(buildingFamilyOf(null, null)).toBeUndefined();
    expect(buildingFamilyOf('church', null)).toBe('civic');
    expect(buildingFamilyOf('carport', null)).toBe('garage');
    expect(buildingFamilyOf('cowshed', null)).toBe('barn');
    expect(buildingFamilyOf('supermarket', null)).toBe('commercial');
    expect(buildingFamilyOf('warehouse', null)).toBe('industrial');
    expect(buildingFamilyOf('semidetached_house', null)).toBe('house');
  });

  it('makes a `residential` footprint an apartment block from two storeys and 300 m², else a house', () => {
    expect(resolvedFamily('residential', 2, 300)).toBe('apartments');
    expect(resolvedFamily('residential', 1, 900)).toBe('house');
    expect(resolvedFamily('residential', 3, 299)).toBe('house');
    expect(resolvedFamily('garage', 3, 900)).toBe('garage');
  });
});

describe('#1791: a church is never a house', () => {
  const plans = plannedStreet();

  it('plans a church of a Cape’s shape on residential land with no house feature, shop front or wreath', () => {
    for (const church of rowOf(plans, 'church')) {
      for (const role of [
        'porch',
        'porch-roof',
        'porch-trim',
        'dormer',
        'dormer-roof',
        'driveway',
        'shopfront',
        'chimney',
      ] as const) {
        expect(triangles(church, role), role).toBe(0);
      }
      expect(church.garage).toBe(false);
      expect(church.porch).toBe(false);
      expect(church.dormers).toBe(0);
      expect(church.shop.front).toBe(false);
      expect(church.archetype).toBe('unknown');
      expect(church.model).toBeUndefined();
      expect(church.frontStep).toBeUndefined();
      // No garage door, no picture window, no shutters, no shop's style.
      const vertices = everyVertex(church);
      expect(vertices.some((vertex) => vertex.top === FACADE_GARAGE)).toBe(false);
      expect(verticesOf(church, 'wall').every((vertex) => vertex.extra === -1)).toBe(true);
      expect(vertices.some((vertex) => has(vertex.flags, STYLE_SHUTTERS))).toBe(false);
      expect(vertices.some((vertex) => has(vertex.flags, STYLE_COMMERCIAL))).toBe(false);
      expect(vertices.some((vertex) => has(vertex.flags, STYLE_SASH))).toBe(false);
      // The wreath is drawn on a door's face; the church's one door is plain, painted.
      expect(doorFaces(church)).toBe(0);
      expect(verticesOf(church, 'door')).toHaveLength(6);
      expect(verticesOf(church, 'door').every((vertex) => vertex.top === FACADE_PAINT)).toBe(true);
      // Brick or render, and on a footprint the gable rule pitches, a low hip.
      expect(['brick', 'render']).toContain(church.surfaces.wall);
      expect(church.roof).toBe('hip');
      expect(church.pitchDegrees).toBe(25);
    }
  });

  it('gives no civic block a shop front in a city centre, where every other building has one', () => {
    const city = cityCentreFixture();
    /** The mapped footprints' plans in the city centre: the kept come first, #1637's own blocks after. */
    const plan = (corridor: WorldCorridor): readonly FootprintPlan[] => {
      const land = landClassMask(corridor);
      const { plans, verdicts } = footprintPlans(
        corridor,
        land,
        city.profile,
        city.origin,
        undefined,
        urbanClassMap(corridor, land, city.profile),
      );
      return plans.slice(0, verdicts.kept).filter((each) => each.urban === 'city-centre');
    };
    const churches: WorldCorridor = {
      ...city.corridor,
      buildings: city.corridor.buildings.map((building): BuildingFeature => ({
        ...building,
        buildingType: 'church',
      })),
    };
    // Untyped, the city centre's route-facing ground floors are shop fronts (#1636).
    expect(plan(city.corridor).some((each) => each.shop.front)).toBe(true);
    const typed = plan(churches);
    expect(typed.length).toBeGreaterThan(0);
    expect(typed.some((each) => each.shop.front)).toBe(false);
  });

  it('is no vacuous claim: the same shape untyped is a Cape, dormered and with a wreathed door', () => {
    for (const cape of rowOf(plans, 'untyped')) {
      expect(cape.archetype).toBe('cape');
      expect(cape.dormers).toBeGreaterThan(0);
      expect(doorFaces(cape)).toBeGreaterThan(0);
    }
    const off = plannedStreet({ buildingTypes: false });
    // The lock-ups, untyped, are drawn as a house model; the low apartment block has a garage.
    expect(rowOf(off, 'garages-long').every((plan) => plan.model !== undefined)).toBe(true);
    expect(rowOf(off, 'apartments-low').some((plan) => plan.garage)).toBe(true);
    // A large house untyped is a garden apartment.
    expect(rowOf(off, 'house-large').every((plan) => plan.buildingArchetype !== 'unknown')).toBe(
      true,
    );
    // And the church itself, its type ignored.
    for (const church of rowOf(off, 'church')) {
      expect(church.archetype).toBe('cape');
      expect(doorFaces(church)).toBeGreaterThan(0);
    }
  });

  it('plans a school as the same plain civic block', () => {
    for (const school of rowOf(plans, 'school')) {
      expect(school.shop.front).toBe(false);
      expect(school.garage).toBe(false);
      expect(school.porch).toBe(false);
      expect(school.buildingArchetype).toBe('unknown');
      expect(doorFaces(school)).toBe(0);
      expect(verticesOf(school, 'door').every((vertex) => vertex.top === FACADE_PAINT)).toBe(true);
      expect(everyVertex(school).some((vertex) => has(vertex.flags, STYLE_SHUTTERS))).toBe(false);
      expect(['brick', 'render']).toContain(school.surfaces.wall);
    }
  });
});

describe('#1791: each type row, read back from the plan', () => {
  const plans = plannedStreet();

  const rows: readonly (readonly [row: string, check: (plan: FootprintPlan) => void])[] = [
    [
      'house',
      (plan) => {
        expect(plan.archetype).toBe('colonial');
        expect(verticesOf(plan, 'wall').some((vertex) => has(vertex.flags, STYLE_SASH))).toBe(true);
      },
    ],
    ['bungalow', (plan) => expect(plan.archetype).toBe('bungalow')],
    // A Cape's shape, typed a bungalow: the bungalow alone is admitted, and it does not fit.
    ['bungalow-capelike', (plan) => expect(plan.archetype).toBe('unknown')],
    [
      'terrace',
      (plan) => {
        // #1635's rule though the street is no town: the party walls' flag, and flat.
        expect(plan.urban).not.toBe('town');
        expect(plan.urban).not.toBe('city-centre');
        expect(verticesOf(plan, 'wall').some((vertex) => has(vertex.flags, STYLE_TERRACED))).toBe(
          true,
        );
        expect(plan.roof).toBe('flat');
        expect(plan.archetype).toBe('unknown');
      },
    ],
    [
      'apartments',
      (plan) => {
        expect(plan.buildingArchetype).toBe('garden-apartment');
        expect(plan.garage).toBe(false);
      },
    ],
    // One storey, which no garden apartment is, and no house either: still no garage.
    [
      'apartments-low',
      (plan) => {
        expect(plan.buildingArchetype).toBe('unknown');
        expect(plan.archetype).toBe('unknown');
        expect(plan.garage).toBe(false);
      },
    ],
    [
      'garage-set-back',
      (plan) => {
        // Too far back for a driveway: its garage door alone.
        expect(plan.driveway).toHaveLength(0);
        expect(plan.garage).toBe(true);
        expect(verticesOf(plan, 'door').some((vertex) => vertex.top === FACADE_GARAGE)).toBe(true);
        expectDoorWidth(plan, 6 / baysOf(6));
        expect(windowFaces(plan)).toBe(0);
      },
    ],
    [
      'garages-long',
      (plan) => {
        // A house model fits its shape untyped; a row of lock-ups is drawn as no house.
        expect(plan.model).toBeUndefined();
        expect(windowFaces(plan)).toBe(0);
      },
    ],
    [
      'garage',
      (plan) => {
        expect(plan.storeys).toBe(1);
        expect(windowFaces(plan)).toBe(0);
        expect(plan.garage).toBe(true);
        // Near the road, its driveway out to it.
        expect(plan.driveway.length).toBeGreaterThan(0);
        expect(verticesOf(plan, 'door').every((vertex) => vertex.top === FACADE_GARAGE)).toBe(true);
        expect(verticesOf(plan, 'door').length).toBeGreaterThan(0);
        // The door is one bay of its 6 m front, not a bay of a count rounded up to odd.
        expectDoorWidth(plan, 6 / baysOf(6));
        expect(triangles(plan, 'chimney')).toBe(0);
        expect(plan.porch).toBe(false);
        // On a footprint the gable rule pitches, a low gable.
        expect(plan.roof).toBe('gable');
        expect(plan.pitchDegrees).toBe(25);
        expect(plan.model).toBeUndefined();
      },
    ],
    // `residential`, two storeys over 300 m²: an apartment block, a garden apartment.
    ['residential-block', (plan) => expect(plan.buildingArchetype).toBe('garden-apartment')],
    [
      'house-large',
      (plan) => {
        // A garden apartment's shape untyped; a house says it is none.
        expect(plan.buildingArchetype).toBe('unknown');
      },
    ],
    [
      'shed',
      (plan) => {
        expect(plan.storeys).toBe(1);
        expect(windowFaces(plan)).toBe(0);
        expect(doorFaces(plan)).toBe(0);
        expect(verticesOf(plan, 'door').every((vertex) => vertex.top === FACADE_PAINT)).toBe(true);
        expect(verticesOf(plan, 'door').length).toBeGreaterThan(0);
        expect(plan.garage).toBe(false);
        expect(triangles(plan, 'chimney')).toBe(0);
      },
    ],
    [
      'barn',
      (plan) => {
        expect(plan.surfaces.wall).toBe('planks');
        expect(plan.roofVariant).toBe('gambrel');
        expect(plan.cladding.wall).toBe('photograph');
        expect(plan.garage).toBe(false);
        expect(plan.porch).toBe(false);
        expect(plan.dormers).toBe(0);
        expect(plan.frontStep).toBeUndefined();
        for (const role of ['chimney', 'driveway', 'dormer', 'porch'] as const) {
          expect(triangles(plan, role), role).toBe(0);
        }
        const vertices = everyVertex(plan);
        expect(vertices.some((vertex) => has(vertex.flags, STYLE_SASH))).toBe(false);
        expect(vertices.some((vertex) => has(vertex.flags, STYLE_SHUTTERS))).toBe(false);
      },
    ],
    [
      'retail',
      (plan) => {
        expect(plan.shop.front).toBe(true);
        expect(triangles(plan, 'shopfront')).toBeGreaterThan(0);
        expect(verticesOf(plan, 'wall').some((vertex) => has(vertex.flags, STYLE_COMMERCIAL))).toBe(
          true,
        );
      },
    ],
    [
      'warehouse',
      (plan) => {
        expect(plan.surfaces.wall).toBe('corrugated');
        expect(plan.roof).toBe('flat');
        expect(plan.garage).toBe(false);
      },
    ],
  ];

  for (const [row, check] of rows) {
    it(`plans the ${row} row as its type says`, () => {
      for (const plan of rowOf(plans, row)) check(plan);
    });
  }

  it('holds every row inside the caps: at most 640 triangles near and 200 far', () => {
    for (const plan of plans) {
      expect(plan.triangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_TRIANGLES);
      expect(plan.farTriangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_FAR_TRIANGLES);
    }
  });

  it('holds every type of the whitelist inside the caps on a small, a large and a many-sided footprint', () => {
    const profile = northRoute(5_000, () => 10);
    const origin = corridorOrigin(profile);
    const shapes = [
      rectangleBeside(0, 0, 6, 5),
      rectangleBeside(0, 0, 16, 16),
      polygonBeside(0, 0, 12, 40),
    ] as const;
    const buildings: BuildingFeature[] = [];
    const types: readonly (BuildingType | 'landmark')[] = [...BUILDING_TYPES, 'landmark'];
    types.forEach((type, index) => {
      shapes.forEach((shape, which) => {
        const along = 500 + (index * shapes.length + which) * 30;
        buildings.push({
          ...buildingBeside(
            profile,
            origin,
            [shape.map(([a, n]) => [along + a, 24 + n] as const)],
            which === 2 ? 9.5 : null,
          ),
          buildingType: type === 'landmark' ? null : type,
          landmark: type === 'landmark' ? 'townhall' : null,
        });
      });
    });
    const corridor: WorldCorridor = {
      routeId: 'every-type',
      origin,
      covered: () => true,
      coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 6_000 }],
      landUse: [landBeside(profile, origin, 'landuse', 'residential', 450, 3_500, -70, 70)],
      buildings,
      paths: [],
      streets: [],
    };
    const land = landClassMask(corridor);
    const { plans: every, verdicts } = footprintPlans(
      corridor,
      land,
      profile,
      origin,
      undefined,
      urbanClassMap(corridor, land, profile),
    );
    expect(verdicts.kept).toBe(buildings.length);
    for (const plan of every) {
      expect(plan.triangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_TRIANGLES);
      expect(plan.farTriangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_FAR_TRIANGLES);
    }
  });
});

describe('#1791: untyped changes nothing, and the lever puts the type out', () => {
  it('plans the mixed town, which carries no type, to the plans before #1791', () => {
    const town = mixedTownFixture();
    expect(town.corridor.buildings.every((building) => building.buildingType === null)).toBe(true);
    const land = landClassMask(town.corridor);
    const urban = urbanClassMap(town.corridor, land, town.profile);
    expect(
      planFingerprint(
        footprintPlans(town.corridor, land, town.profile, town.origin, undefined, urban).plans,
      ),
    ).toBe(MIXED_BEFORE_1791.urban);
    expect(
      planFingerprint(footprintPlans(town.corridor, land, town.profile, town.origin).plans),
    ).toBe(MIXED_BEFORE_1791.none);
  });

  it('plans the fully typed street with `buildingTypes: false` as the same street untyped', () => {
    const off = plannedStreet({ buildingTypes: false });
    // #2023: untyped, the shed's footprint is inferred a shed; that rule is #2023's lever's.
    const untyped = plannedStreet({ inferredOutbuildings: false }, untypedStreet());
    expect(planFingerprint(off)).toBe(planFingerprint(untyped));
    // Not vacuous: with the types, the street plans otherwise.
    expect(planFingerprint(plannedStreet())).not.toBe(planFingerprint(untyped));
  });
});

/**
 * The typed street with #1790's tags (and a mapped height) added to the rows
 * named — each footprint of a row carries them, both sides.
 */
function taggedStreet(
  tags: Readonly<Record<string, Partial<BuildingFields> & { readonly heightMetres?: number }>>,
): WorldCorridor {
  const { corridor, rows } = typedStreetFixture();
  return {
    ...corridor,
    buildings: corridor.buildings.map((building, index): BuildingFeature => ({
      ...building,
      ...tags[rows[index] ?? ''],
    })),
  };
}

/**
 * Where #1790 and #1791 meet: a mapped `roof:shape` and `building:levels` are
 * the building's own, and win over what its type would choose by default — the
 * type's roof, a barn's gambrel, a civic block's hip, a garage's or a shed's
 * one storey. Everything else the type sets is kept: a barn's planks and its
 * steep pitch, a garage's blind walls and its garage door.
 */
describe('#1790 with #1791: a mapped roof:shape or building:levels wins over the type’s default', () => {
  it('draws a typed barn’s mapped gable or hip, not the type’s gambrel, and keeps its planks and pitch', () => {
    for (const [shape, roof] of [
      ['gabled', 'gable'],
      ['hipped', 'hip'],
    ] as const) {
      const plans = plannedStreet({}, taggedStreet({ barn: { roofShape: shape } }));
      for (const barn of rowOf(plans, 'barn')) {
        expect(barn.roofVariant, shape).toBe('plain');
        expect(barn.roof, shape).toBe(roof);
        expect(barn.surfaces.wall).toBe('planks');
        expect([40, 45]).toContain(barn.pitchDegrees);
      }
    }
    // A mapped flat roof too, over the planks.
    for (const barn of rowOf(
      plannedStreet({}, taggedStreet({ barn: { roofShape: 'flat' } })),
      'barn',
    )) {
      expect(barn.roof).toBe('flat');
      expect(barn.surfaces.wall).toBe('planks');
    }
  });

  it('keeps the barn’s gambrel when #1790’s lever is off, and drops its planks when #1791’s is', () => {
    const tagged = taggedStreet({ barn: { roofShape: 'gabled' } });
    for (const barn of rowOf(plannedStreet({ mappedRoofShape: false }, tagged), 'barn')) {
      expect(barn.roofVariant).toBe('gambrel');
    }
    for (const barn of rowOf(plannedStreet({ buildingTypes: false }, tagged), 'barn')) {
      expect(barn.roofVariant).toBe('plain');
      expect(barn.roof).toBe('gable');
      expect(barn.surfaces.wall).not.toBe('planks');
    }
  });

  it('draws a church’s mapped gable, not a civic block’s low hip', () => {
    const plans = plannedStreet({}, taggedStreet({ church: { roofShape: 'gabled' } }));
    for (const church of rowOf(plans, 'church')) {
      expect(church.roof).toBe('gable');
      // Still a civic block: its plain door, no wreath, no house feature.
      expect(doorFaces(church)).toBe(0);
      expect(church.archetype).toBe('unknown');
    }
  });

  it('draws a garage’s mapped hip, not the outbuilding’s gable', () => {
    const plans = plannedStreet({}, taggedStreet({ garage: { roofShape: 'hipped' } }));
    for (const garage of rowOf(plans, 'garage')) expect(garage.roof).toBe('hip');
  });

  it('gives a typed garage and shed their mapped levels, not the type’s one storey, and keeps them blind', () => {
    const plans = plannedStreet({}, taggedStreet({ garage: { levels: 2 }, shed: { levels: 2 } }));
    for (const row of ['garage', 'shed']) {
      for (const plan of rowOf(plans, row)) {
        expect(plan.storeys, row).toBe(2);
        expect(windowFaces(plan), row).toBe(0);
      }
    }
    for (const garage of rowOf(plans, 'garage')) {
      expect(verticesOf(garage, 'door').some((vertex) => vertex.top === FACADE_GARAGE)).toBe(true);
    }
    // With #1790's lever off, the type's one storey again.
    for (const row of ['garage', 'shed']) {
      const off = plannedStreet(
        { mappedRoofShape: false },
        taggedStreet({ garage: { levels: 2 }, shed: { levels: 2 } }),
      );
      for (const plan of rowOf(off, row)) expect(plan.storeys, row).toBe(1);
    }
  });

  it('resolves a `residential` footprint from its mapped levels, not its height: two levels are apartments', () => {
    // 3.5 m is one storey by its height, which no apartment block is; two mapped levels make it one.
    const low = { heightMetres: 3.5 };
    for (const block of rowOf(
      plannedStreet({}, taggedStreet({ 'residential-block': { ...low, levels: 2 } })),
      'residential-block',
    )) {
      expect(block.storeys).toBe(2);
      expect(block.buildingArchetype).toBe('garden-apartment');
    }
    // Control: the same height with no levels is a house.
    for (const block of rowOf(
      plannedStreet({}, taggedStreet({ 'residential-block': low })),
      'residential-block',
    )) {
      expect(block.storeys).toBe(1);
      expect(block.buildingArchetype).toBe('unknown');
    }
  });
});
