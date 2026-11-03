// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2023: an untagged footprint is inferred a garage or a shed, with spike
 * 0033's thresholds (the owner's ruling of 2026-11-02), and drawn as #1791's.
 * The rule is held twice: as a table over the pure {@link footprintKindOf},
 * and where a rider sees it — the plans `footprintPlans` returns, and the
 * vertex floats the belt uploads — over #2023's street of untagged footprints
 * (`untaggedStreetFixture`).
 */

import { describe, expect, it } from 'vitest';

import { NO_BUILDING_FIELDS, type BuildingFeature } from '@onyourleft/map-features';

import type { BuildingFamily } from './building-types';
import {
  FACADE_GARAGE,
  FACADE_OFFSET,
  FOOTPRINT_MAX_FAR_TRIANGLES,
  FOOTPRINT_MAX_TRIANGLES,
  FOOTPRINT_SURFACES,
  FOOTPRINT_VERTEX_FLOATS,
  footprintKindOf,
  footprintPlans,
  INFERRED_GARAGE_HOME_METRES,
  type FootprintPlan,
  type FootprintPlanOptions,
  type InferenceRules,
  type UntaggedCues,
} from './footprint-buildings';
import {
  buildingBeside,
  landBeside,
  planFingerprint,
  rectangleBeside,
  ringBeside,
  untaggedStreetFixture,
} from './footprint-fixtures-testing';
import { landClassMask } from './land-class';
import { urbanClassMap } from './urban-class';
import type { WorldCorridor } from './world-data/corridor';

/** A footprint's cues, its setbacks given. `home` is the nearest house's setback, or none. */
function cues(
  area: number,
  setback: number,
  home: number | undefined,
  shape: { readonly aspect?: number; readonly rectangularity?: number } = {},
): UntaggedCues & { readonly asked: number[] } {
  const asked: number[] = [];
  return {
    area,
    aspect: shape.aspect ?? 1,
    rectangularity: shape.rectangularity ?? 1,
    setback: () => setback,
    homeSetback: (metres) => {
      asked.push(metres);
      return home;
    },
    asked,
  };
}

const ON: InferenceRules = { outbuildings: true };
const OFF: InferenceRules = { outbuildings: false };

describe('#2023: the pure rule, spike 0033’s thresholds', () => {
  // [what, mapped, cues, rules, family, inferred]
  const table: readonly (readonly [
    string,
    BuildingFamily | undefined,
    UntaggedCues | undefined,
    InferenceRules,
    BuildingFamily | undefined,
    boolean,
  ])[] = [
    ['a shed at the draw floor', undefined, cues(12, 30, undefined), ON, 'shed', true],
    ['a shed just under 20 m²', undefined, cues(19.9, 30, undefined), ON, 'shed', true],
    ['a shed with a house in front of it', undefined, cues(14, 30, 10), ON, 'shed', true],
    ['under the draw floor: nothing', undefined, cues(11.9, 30, undefined), ON, undefined, false],
    ['a garage at 20 m²', undefined, cues(20, 30, 10), ON, 'garage', true],
    ['a garage just under 75 m²', undefined, cues(74.9, 30, 10), ON, 'garage', true],
    ['75 m²: too big', undefined, cues(75, 30, 10), ON, undefined, false],
    ['aspect 1.75', undefined, cues(40, 30, 10, { aspect: 1.75 }), ON, 'garage', true],
    ['aspect 1.76: too long', undefined, cues(40, 30, 10, { aspect: 1.76 }), ON, undefined, false],
    [
      'rectangularity 0.9',
      undefined,
      cues(40, 30, 10, { rectangularity: 0.9 }),
      ON,
      'garage',
      true,
    ],
    [
      'rectangularity 0.89: too ragged',
      undefined,
      cues(40, 30, 10, { rectangularity: 0.89 }),
      ON,
      undefined,
      false,
    ],
    ['no house within 40 m', undefined, cues(40, 30, undefined), ON, undefined, false],
    ['level with the house', undefined, cues(40, 30, 30), ON, undefined, false],
    ['nearer the street than the house', undefined, cues(40, 10, 30), ON, undefined, false],
    ['a house-sized footprint: nothing', undefined, cues(120, 40, 10), ON, undefined, false],
    ['mapped a house, a shed’s size', 'house', cues(14, 30, 10), ON, 'house', false],
    ['mapped a house, a garage’s size', 'house', cues(40, 30, 10), ON, 'house', false],
    ['mapped a garage, too big for one', 'garage', cues(90, 30, 10), ON, 'garage', false],
    ['mapped a civic block, a shed’s size', 'civic', cues(14, 30, 10), ON, 'civic', false],
    ['mapped, its cues not read', 'barn', undefined, ON, 'barn', false],
    ['untagged, its cues not read', undefined, undefined, ON, undefined, false],
    ['a shed with the rule off', undefined, cues(14, 30, 10), OFF, undefined, false],
    ['a garage with the rule off', undefined, cues(40, 30, 10), OFF, undefined, false],
  ];

  it.each(table)('%s', (_, mapped, each, rules, family, inferred) => {
    expect(footprintKindOf(mapped, each, rules)).toStrictEqual({ family, inferred });
  });

  it('asks for a house within 40 m', () => {
    const each = cues(40, 30, 10);
    footprintKindOf(undefined, each, ON);
    expect(each.asked).toStrictEqual([INFERRED_GARAGE_HOME_METRES]);
    expect(INFERRED_GARAGE_HOME_METRES).toBe(40);
  });

  it('measures no street or neighbour for a footprint no rule could call', () => {
    let measured = 0;
    const count = (): number => {
      measured += 1;
      return 10;
    };
    for (const area of [14, 80, 120, 400, 2_000]) {
      footprintKindOf(
        undefined,
        { area, aspect: 1, rectangularity: 1, setback: count, homeSetback: count },
        ON,
      );
    }
    expect(measured).toBe(0);
    // Control: a garage's size is measured.
    footprintKindOf(
      undefined,
      { area: 40, aspect: 1, rectangularity: 1, setback: count, homeSetback: count },
      ON,
    );
    expect(measured).toBe(2);
  });
});

/** #2023's street planned as the press plans a corridor, with its urban class. */
function plannedStreet(
  options: FootprintPlanOptions = {},
  corridor: WorldCorridor = untaggedStreetFixture().corridor,
): readonly FootprintPlan[] {
  const street = untaggedStreetFixture();
  const land = landClassMask(corridor);
  const { plans, verdicts } = footprintPlans(
    corridor,
    land,
    street.profile,
    street.origin,
    undefined,
    urbanClassMap(corridor, land, street.profile),
    options,
  );
  // Every footprint kept, so each plan is its footprint's.
  expect(verdicts.kept).toBe(corridor.buildings.length);
  expect(plans).toHaveLength(corridor.buildings.length);
  return plans;
}

/** The row's subjects, both sides. */
function subjectsOf(plans: readonly FootprintPlan[], row: string): FootprintPlan[] {
  const { rows, subjects } = untaggedStreetFixture();
  const out = plans.filter((_, index) => rows[index] === row && subjects[index] === true);
  expect(out).toHaveLength(2);
  return out;
}

/** The street with each of `rows`' subjects carrying `fields`. */
function withSubjects(rows: readonly string[], fields: Partial<BuildingFeature>): WorldCorridor {
  const street = untaggedStreetFixture();
  return {
    ...street.corridor,
    buildings: street.corridor.buildings.map((building, index) =>
      rows.includes(street.rows[index] as string) && street.subjects[index] === true
        ? { ...building, ...fields }
        : building,
    ),
  };
}

/** A wall face that carries windows: #1581's facade `top`, its storeys, above nought. */
function windowFaces(plan: FootprintPlan): number {
  const floats = plan.triangles.wall;
  let faces = 0;
  for (let at = 0; at < floats.length; at += FOOTPRINT_VERTEX_FLOATS) {
    if ((floats[at + FACADE_OFFSET + 2] as number) > 0) faces += 1;
  }
  return faces;
}

/** Garage-door vertices on the door role. */
function garageDoorVertices(plan: FootprintPlan): number {
  const floats = plan.triangles.door;
  let doors = 0;
  for (let at = 0; at < floats.length; at += FOOTPRINT_VERTEX_FLOATS) {
    if (floats[at + FACADE_OFFSET + 2] === FACADE_GARAGE) doors += 1;
  }
  return doors;
}

describe('#2023: the rule, read back through `footprintPlans`', () => {
  const plans = plannedStreet();

  // [row, family, inferred]
  const expected: readonly (readonly [string, BuildingFamily | undefined, boolean])[] = [
    ['garage', 'garage', true],
    ['garage-oblong', 'garage', true],
    ['shed', 'shed', true],
    ['shed-alone', 'shed', true],
    ['garage-driveway', 'garage', true],
    ['garage-three-car', 'garage', true],
    ['garage-pair', 'garage', true],
    ['garage-by-a-hall', undefined, false],
    ['garage-by-a-shop', undefined, false],
    ['garage-beside', undefined, false],
    ['garage-in-front', undefined, false],
    ['garage-alone', undefined, false],
    ['garage-long', undefined, false],
    ['garage-ragged', undefined, false],
    ['garage-big', undefined, false],
    ['mapped-house', 'house', false],
    ['mapped-small-house', 'house', false],
  ];

  it.each(expected)('plans the %s row’s footprint as %s', (row, family, inferred) => {
    for (const plan of subjectsOf(plans, row)) {
      expect(plan.family).toBe(family);
      expect(plan.inferred).toBe(inferred);
    }
  });

  it('infers nothing of a house-sized footprint: every house stays a house', () => {
    const { rows, subjects } = untaggedStreetFixture();
    const others = (row: string): FootprintPlan[] =>
      plans.filter((_, index) => rows[index] === row && subjects[index] === false);
    const houses = plans.filter(
      (_, index) =>
        subjects[index] === false &&
        rows[index] !== 'garage-pair' &&
        rows[index] !== 'garage-by-a-shop',
    );
    expect(houses.length).toBeGreaterThan(20);
    for (const house of houses) {
      expect(house.family).toBeUndefined();
      expect(house.inferred).toBe(false);
    }
    // The pair's other garage is one too, and the shop is its mapped self.
    expect(others('garage-pair').filter((plan) => plan.family === 'garage')).toHaveLength(2);
    expect(others('garage-by-a-shop').map((plan) => [plan.family, plan.inferred])).toStrictEqual([
      ['commercial', false],
      ['commercial', false],
    ]);
  });

  it('draws an inferred garage as a mapped one: a garage door, no window, porch or dormer, one storey', () => {
    for (const garage of subjectsOf(plans, 'garage')) {
      expect(garage.storeys).toBe(1);
      expect(windowFaces(garage)).toBe(0);
      expect(garageDoorVertices(garage)).toBeGreaterThan(0);
      expect(garage.porch).toBe(false);
      expect(garage.dormers).toBe(0);
      expect(garage.triangles.chimney.length).toBe(0);
      expect(garage.archetype).toBe('unknown');
    }
    // Control: the same footprint untagged with the rule off is drawn as a house, with windows.
    for (const untagged of subjectsOf(plannedStreet({ inferredOutbuildings: false }), 'garage')) {
      expect(windowFaces(untagged)).toBeGreaterThan(0);
      expect(garageDoorVertices(untagged)).toBe(0);
    }
  });

  it('plans each inferred footprint, float for float, as the same footprint mapped with its type', () => {
    const types: Readonly<Record<string, 'garage' | 'shed'>> = {
      garage: 'garage',
      'garage-oblong': 'garage',
      'garage-driveway': 'garage',
      shed: 'shed',
      'shed-alone': 'shed',
    };
    const inferredRows = Object.keys(types);
    const street = untaggedStreetFixture();
    const mapped = plannedStreet(
      {},
      {
        ...street.corridor,
        buildings: street.corridor.buildings.map((building, index) => {
          const type = types[street.rows[index] as string];
          return type !== undefined && street.subjects[index] === true
            ? { ...building, buildingType: type }
            : building;
        }),
      },
    );
    const { rows, subjects } = untaggedStreetFixture();
    let compared = 0;
    plans.forEach((plan, index) => {
      if (!inferredRows.includes(rows[index] as string) || subjects[index] !== true) return;
      const twin = mapped[index] as FootprintPlan;
      expect(twin.inferred).toBe(false);
      expect(twin.family).toBe(plan.family);
      expect(planFingerprint([plan])).toBe(planFingerprint([twin]));
      compared += 1;
    });
    expect(compared).toBe(10);
  });

  it('measures the setback to a ground street: a bridge behind the garage is none, a street through it is', () => {
    const street = untaggedStreetFixture();
    const behind = (grade: 'bridge' | 'ground'): WorldCorridor => ({
      ...street.corridor,
      // A street 5 m behind every garage row, in 10 m pieces, both sides.
      streets: [
        ...street.corridor.streets,
        ...[1, -1].map((side) => ({
          kind: 'minor_road',
          kindDetail: 'residential',
          grade,
          line: ringBeside(
            street.profile,
            street.origin,
            Array.from({ length: 81 }, (_, step) => [950 + step * 10, side * 48] as const),
          ),
        })),
      ],
    });
    for (const garage of subjectsOf(plannedStreet({}, behind('bridge')), 'garage')) {
      expect(garage.family).toBe('garage');
    }
    // Control: on the ground, the garage stands nearer it than the house does its street.
    for (const garage of subjectsOf(plannedStreet({}, behind('ground')), 'garage')) {
      expect(garage.family).toBeUndefined();
    }
    // And a street through the garage is a setback of none.
    const through: WorldCorridor = {
      ...street.corridor,
      streets: [
        ...street.corridor.streets,
        ...[1, -1].map((side) => ({
          kind: 'minor_road',
          kindDetail: 'residential',
          grade: 'ground' as const,
          line: ringBeside(street.profile, street.origin, [
            [990, side * 40],
            [1_010, side * 40],
          ]),
        })),
      ],
    };
    for (const garage of subjectsOf(plannedStreet({}, through), 'garage')) {
      expect(garage.family).toBeUndefined();
    }
  });

  it('lets a mapped roof shape and storey count beat the inferred garage’s', () => {
    const tagged = plannedStreet({}, withSubjects(['garage'], { roofShape: 'flat', levels: 2 }));
    for (const garage of subjectsOf(tagged, 'garage')) {
      // Still a garage — the tags are not a type — but with the mapped roof and storeys.
      expect(garage.family).toBe('garage');
      expect(garage.roof).toBe('flat');
      expect(garage.storeys).toBe(2);
    }
    // Control: inferred, it is a one-storey pitched garage.
    for (const garage of subjectsOf(plans, 'garage')) {
      expect(garage.roof).toBe('gable');
      expect(garage.storeys).toBe(1);
    }
  });

  it('holds every plan of the street inside the caps, on the belt’s surfaces', () => {
    for (const plan of plans) {
      expect(plan.triangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_TRIANGLES);
      expect(plan.farTriangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_FAR_TRIANGLES);
      expect(FOOTPRINT_SURFACES).toContain(plan.surfaces.wall);
      expect(FOOTPRINT_SURFACES).toContain(plan.surfaces.roof);
    }
  });
});

describe('#2023: the lever', () => {
  /** The street with every footprint's type taken off. */
  const stripped = (): WorldCorridor => {
    const { corridor } = untaggedStreetFixture();
    return {
      ...corridor,
      buildings: corridor.buildings.map((building) => ({ ...building, ...NO_BUILDING_FIELDS })),
    };
  };

  it('plans every untagged footprint as before with `inferredOutbuildings: false`', () => {
    const off = plannedStreet({ inferredOutbuildings: false }, stripped());
    expect(off.every((plan) => !plan.inferred && plan.family === undefined)).toBe(true);
    // As the type unread plans it, which is as before #2023.
    expect(planFingerprint(off)).toBe(
      planFingerprint(plannedStreet({ buildingTypes: false }, stripped())),
    );
    // Not vacuous: on, the street plans otherwise.
    expect(planFingerprint(plannedStreet({}, stripped()))).not.toBe(planFingerprint(off));
  });

  it('infers nothing while the type is not read (`buildingTypes: false`)', () => {
    const plans = plannedStreet({ buildingTypes: false });
    expect(plans.some((plan) => plan.inferred)).toBe(false);
  });
});

describe('#2023: the neighbours the rule reads', () => {
  /** A footprint `along` the road, `lateral` out, mapped as `buildingType` (or untagged), a part if `part` is given. */
  type Placed = readonly [
    footprint: readonly (readonly [number, number])[],
    buildingType?: BuildingFeature['buildingType'],
    part?: { readonly minHeightMetres: number },
  ];

  /**
   * The fixture's road and land, widened to 250 m, with only `placed` standing on it, on the
   * road's `side` — the grid the rule searches is not symmetric about the road.
   */
  function plannedOwn(placed: readonly Placed[], side = 1): readonly FootprintPlan[] {
    const street = untaggedStreetFixture();
    const at = (
      ring: readonly (readonly [number, number])[],
    ): readonly (readonly [number, number])[] =>
      ring.map(([a, n]) => [1_100 + a, side * n] as const);
    return plannedStreet(
      {},
      {
        ...street.corridor,
        landUse: [
          landBeside(
            street.profile,
            street.origin,
            'landuse',
            'residential',
            950,
            2_020,
            -250,
            250,
          ),
        ],
        buildings: placed.map(([ring, buildingType, part]) => ({
          ...buildingBeside(street.profile, street.origin, [at(ring)], null, part),
          buildingType: buildingType ?? null,
        })),
      },
    );
  }

  const FRONT = rectangleBeside(0, 22, 12, 9);
  const GARAGE = rectangleBeside(0, 40, 6, 6);

  it('infers a garage behind a house that is mapped as one', () => {
    expect(plannedOwn([[GARAGE], [FRONT, 'house']])[0]?.family).toBe('garage');
    // Control: behind a footprint mapped as a shop, none.
    expect(plannedOwn([[GARAGE], [FRONT, 'retail']])[0]?.family).toBeUndefined();
  });

  it('measures the house nearest the footprint, not any within 40 m', () => {
    // The front house is nearer the garage and nearer the street than it; the back one is
    // farther from the garage, but farther from the street than the garage is.
    const back = rectangleBeside(0, 62, 12, 9);
    for (const side of [1, -1]) {
      for (const order of [
        [[GARAGE], [FRONT], [back]],
        [[GARAGE], [back], [FRONT]],
      ] as const) {
        expect(plannedOwn(order, side)[0]?.family).toBe('garage');
      }
    }
    // Control: without the front house the back one is the garage's house, and it is set back farther.
    expect(plannedOwn([[GARAGE], [back]])[0]?.family).toBeUndefined();
  });

  it('reads no street farther than 150 m: a footprint beyond it stands level with a house beyond it', () => {
    for (const side of [1, -1]) {
      expect(
        plannedOwn([[rectangleBeside(0, 183, 6, 6)], [rectangleBeside(0, 165, 12, 9)]], side)[0]
          ?.family,
      ).toBeUndefined();
      // Control: a house 140 m out, the garage 160 m: set back.
      expect(
        plannedOwn([[rectangleBeside(0, 163, 6, 6)], [rectangleBeside(0, 145, 12, 9)]], side)[0]
          ?.family,
      ).toBe('garage');
    }
  });

  it('infers nothing of a part: it stands inside its building', () => {
    // A 5 m square at ground level inside an untagged house, set back from its front like a garage.
    const house = rectangleBeside(0, 22, 14, 12);
    const inside = rectangleBeside(0, 24, 5, 5);
    const ground = plannedOwn([[house], [inside, undefined, { minHeightMetres: 0 }]]);
    expect(ground.map((plan) => plan.family)).toStrictEqual([undefined, undefined]);
    expect(ground.map((plan) => plan.inferred)).toStrictEqual([false, false]);
    expect(garageDoorVertices(ground[1] as FootprintPlan)).toBe(0);
    // A raised 4 m square is no shed, and keeps its windows as the lever off draws it.
    const tower = plannedOwn([
      [house],
      [rectangleBeside(0, 24, 4, 4), undefined, { minHeightMetres: 6 }],
    ]);
    expect(tower[1]?.family).toBeUndefined();
    expect(tower[1]?.inferred).toBe(false);
    expect(windowFaces(tower[1] as FootprintPlan)).toBeGreaterThan(0);
  });

  it('counts no part as the house a garage stands behind', () => {
    // A house-sized part in front of the garage, and no building: no garage.
    const plans = plannedOwn([[GARAGE], [FRONT, undefined, { minHeightMetres: 0 }]]);
    expect(plans[0]?.family).toBeUndefined();
    // Control: the same footprint as a building is the garage's house.
    expect(plannedOwn([[GARAGE], [FRONT]])[0]?.family).toBe('garage');
  });
});
