// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2023: an untagged footprint is inferred a garage or a shed, since #2024 a
 * barn or a pole building, and since #2026 commercial, with spike 0033's
 * thresholds (the owner's rulings of 2026-11-02), and drawn as #1791's.
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
  INFERRED_BARN_HOME_METRES,
  INFERRED_GARAGE_HOME_METRES,
  type FootprintPlan,
  type FootprintPlanOptions,
  type InferenceRules,
  type UntaggedCues,
} from './footprint-buildings';
import {
  buildingBeside,
  planFingerprint,
  rectangleBeside,
  ringBeside,
  untaggedStreetFixture,
} from './footprint-fixtures-testing';
import { landClassMask } from './land-class';
import { urbanClassMap, type UrbanClass } from './urban-class';
import type { WorldCorridor } from './world-data/corridor';

/** A footprint's cues, its setbacks given. `home` is the nearest house's setback, or none. */
function cues(
  area: number,
  setback: number,
  home: number | undefined,
  shape: {
    readonly aspect?: number;
    readonly rectangularity?: number;
    readonly urban?: UrbanClass;
    /** #2026: how far the nearest main street is; none within the search, by default. */
    readonly mainStreet?: number;
  } = {},
): UntaggedCues & { readonly asked: number[] } {
  const asked: number[] = [];
  return {
    area,
    aspect: shape.aspect ?? 1,
    rectangularity: shape.rectangularity ?? 1,
    urban: shape.urban ?? 'village',
    setback: () => setback,
    homeSetback: (metres) => {
      asked.push(metres);
      return home;
    },
    mainStreet: () => shape.mainStreet ?? 150,
    asked,
  };
}

const ON: InferenceRules = { outbuildings: true, barns: true, commercial: true };
const OFF: InferenceRules = { outbuildings: false, barns: false, commercial: false };
const OUTBUILDINGS_ONLY: InferenceRules = { outbuildings: true, barns: false, commercial: false };
const BARNS_ONLY: InferenceRules = { outbuildings: false, barns: true, commercial: false };
const COMMERCIAL_ONLY: InferenceRules = { outbuildings: false, barns: false, commercial: true };

/** A big footprint's cues on `urban`, `street` metres from the main street. */
const big = (area: number, street: number, urban: UrbanClass = 'village'): UntaggedCues =>
  cues(area, street, undefined, { urban, mainStreet: street });

/** A rural footprint's cues, rectangular unless `rectangularity` says. */
const rural = (
  area: number,
  setback: number,
  home: number | undefined,
  rectangularity = 1,
): UntaggedCues & { readonly asked: number[] } =>
  cues(area, setback, home, { rectangularity, urban: 'rural' });

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
    [
      'a garage with only the barn rule on',
      undefined,
      cues(40, 30, 10),
      BARNS_ONLY,
      undefined,
      false,
    ],
    [
      'a shed with only the barn rule on',
      undefined,
      cues(14, 30, 10),
      BARNS_ONLY,
      undefined,
      false,
    ],
    // #2024: barns and pole buildings.
    ['a barn at 100 m²', undefined, rural(100, 40, 20), ON, 'barn', true],
    ['a barn at 250 m²', undefined, rural(250, 60, 20), ON, 'barn', true],
    [
      'a pole building just over 250 m²',
      undefined,
      rural(250.1, 60, 20),
      ON,
      'pole-building',
      true,
    ],
    ['a pole building of 2 000 m²', undefined, rural(2_000, 60, 20), ON, 'pole-building', true],
    ['a barn with no street within 150 m', undefined, rural(180, 150, 20), ON, 'barn', true],
    ['99.9 m²: too small for a barn', undefined, rural(99.9, 60, 20), ON, undefined, false],
    ['rectangularity 0.9 for a barn', undefined, rural(180, 60, 20, 0.9), ON, 'barn', true],
    ['rectangularity 0.89: too ragged', undefined, rural(180, 60, 20, 0.89), ON, undefined, false],
    ['39.9 m back: too near the street', undefined, rural(180, 39.9, 20), ON, undefined, false],
    ['no house within 80 m', undefined, rural(180, 60, undefined), ON, undefined, false],
    ['level with the house', undefined, rural(180, 60, 60), ON, undefined, false],
    [
      'behind a house that stands farther back',
      undefined,
      rural(180, 60, 70),
      ON,
      undefined,
      false,
    ],
    [
      'a barn’s footprint in a village',
      undefined,
      cues(180, 60, 20, { urban: 'village' }),
      ON,
      undefined,
      false,
    ],
    ['…in a town', undefined, cues(180, 60, 20, { urban: 'town' }), ON, undefined, false],
    [
      '…where the class is unknown',
      undefined,
      cues(180, 60, 20, { urban: 'unknown' }),
      ON,
      undefined,
      false,
    ],
    ['mapped a house, a barn’s size', 'house', rural(180, 60, 20), ON, 'house', false],
    ['mapped a barn, too big for a barn', 'barn', rural(2_000, 60, 20), ON, 'barn', false],
    [
      'a barn with the barn rule off',
      undefined,
      rural(180, 60, 20),
      OUTBUILDINGS_ONLY,
      undefined,
      false,
    ],
    ['a barn with only the barn rule on', undefined, rural(180, 60, 20), BARNS_ONLY, 'barn', true],
    // #2026: commercial.
    [
      'a shop at 1 000 m², 50 m from a main street',
      undefined,
      big(1_000, 50),
      ON,
      'commercial',
      true,
    ],
    ['a shop in a town', undefined, big(5_000, 10, 'town'), ON, 'commercial', true],
    ['999.9 m²: too small for a shop', undefined, big(999.9, 10), ON, undefined, false],
    ['50.1 m from a main street', undefined, big(1_200, 50.1), ON, undefined, false],
    ['no main street within 150 m', undefined, big(1_200, 150), ON, undefined, false],
    [
      'a shop’s footprint in a city centre',
      undefined,
      big(1_200, 10, 'city-centre'),
      ON,
      undefined,
      false,
    ],
    ['…on a rural stretch', undefined, big(1_200, 10, 'rural'), ON, undefined, false],
    ['…where the class is unknown', undefined, big(1_200, 10, 'unknown'), ON, undefined, false],
    ['mapped a house, a shop’s size', 'house', big(1_200, 10), ON, 'house', false],
    ['mapped industrial, a shop’s size', 'industrial', big(1_200, 10), ON, 'industrial', false],
    ['a shop with the shop rule off', undefined, big(1_200, 10), BARNS_ONLY, undefined, false],
    [
      'a shop with only the shop rule on',
      undefined,
      big(1_200, 10),
      COMMERCIAL_ONLY,
      'commercial',
      true,
    ],
    [
      'a garage with only the shop rule on',
      undefined,
      cues(40, 30, 10),
      COMMERCIAL_ONLY,
      undefined,
      false,
    ],
  ];

  it.each(table)('%s', (_, mapped, each, rules, family, inferred) => {
    expect(footprintKindOf(mapped, each, rules)).toStrictEqual({ family, inferred });
  });

  it('asks for a house within 40 m of a garage, and within 80 m of a barn', () => {
    const each = cues(40, 30, 10);
    footprintKindOf(undefined, each, ON);
    expect(each.asked).toStrictEqual([INFERRED_GARAGE_HOME_METRES]);
    expect(INFERRED_GARAGE_HOME_METRES).toBe(40);
    const barn = rural(180, 60, 20);
    footprintKindOf(undefined, barn, ON);
    expect(barn.asked).toStrictEqual([INFERRED_BARN_HOME_METRES]);
    expect(INFERRED_BARN_HOME_METRES).toBe(80);
  });

  it('measures no street or neighbour for a footprint no rule could call', () => {
    let measured = 0;
    const count = (): number => {
      measured += 1;
      return 10;
    };
    const ask = (area: number, urban: UrbanClass, rectangularity = 1): void => {
      footprintKindOf(
        undefined,
        {
          area,
          aspect: 1,
          rectangularity,
          urban,
          setback: count,
          homeSetback: count,
          mainStreet: count,
        },
        ON,
      );
    };
    for (const area of [14, 80, 120, 400, 999]) ask(area, 'village');
    // #2024: nor a rural footprint between a garage's size and a barn's, nor a ragged one.
    ask(80, 'rural');
    ask(180, 'rural', 0.8);
    // #2026: nor a big one in a city centre or where the class is unknown.
    ask(2_000, 'city-centre');
    ask(2_000, 'unknown');
    expect(measured).toBe(0);
    // Control: a garage's size is measured, and a big one's main street in a village.
    ask(40, 'village');
    expect(measured).toBe(2);
    ask(2_000, 'village');
    expect(measured).toBe(3);
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
    // #2024
    ['barn-in-village', undefined, false],
    ['barn', 'barn', true],
    ['pole-building', 'pole-building', true],
    ['barn-near-street', undefined, false],
    ['barn-alone', undefined, false],
    ['barn-in-front', undefined, false],
    ['barn-small', undefined, false],
    ['barn-ragged', undefined, false],
    ['mapped-barnlike-house', 'house', false],
    // #2026
    ['commercial', 'commercial', true],
    ['commercial-at-1000', 'commercial', true],
    ['commercial-small', undefined, false],
    ['commercial-mapped-house', 'house', false],
    ['commercial-far', undefined, false],
    ['commercial-off-main', undefined, false],
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
        rows[index] !== 'garage-by-a-shop' &&
        rows[index] !== 'barn-in-front',
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
    const types: Readonly<Record<string, 'garage' | 'shed' | 'commercial'>> = {
      garage: 'garage',
      'garage-oblong': 'garage',
      'garage-driveway': 'garage',
      shed: 'shed',
      'shed-alone': 'shed',
      // #2026
      commercial: 'commercial',
      'commercial-at-1000': 'commercial',
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
    expect(compared).toBe(14);
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

  it('draws an inferred barn as a mapped one is: planks, a steep gable, no house feature', () => {
    for (const barn of subjectsOf(plans, 'barn')) {
      expect(barn.urban).toBe('rural');
      expect(barn.surfaces.wall).toBe('planks');
      expect(barn.roof).toBe('gable');
      expect(barn.pitchDegrees).toBeGreaterThanOrEqual(40);
      expect(barn.porch).toBe(false);
      expect(barn.dormers).toBe(0);
      expect(barn.garage).toBe(false);
      expect(barn.triangles.chimney.length).toBe(0);
      expect(barn.archetype).toBe('unknown');
      expect(barn.model).toBeUndefined();
    }
    // Control: with the rule off it is a house.
    for (const untagged of subjectsOf(plannedStreet({ inferredBarns: false }), 'barn')) {
      expect(untagged.surfaces.wall).not.toBe('planks');
    }
  });

  it('draws a pole building as metal: corrugated, blind, a low gable at 320 m², a grey sheet roof', () => {
    for (const pole of subjectsOf(plans, 'pole-building')) {
      expect(pole.surfaces.wall).toBe('corrugated');
      expect(pole.surfaces.roof).toBe('slate');
      expect(pole.cladding.roof).toBe('photograph');
      // Over the gable rule's 300 m², and still pitched.
      expect(pole.roof).toBe('gable');
      expect(pole.roofVariant).toBe('plain');
      expect(pole.pitchDegrees).toBe(20);
      expect(windowFaces(pole)).toBe(0);
      expect(pole.porch).toBe(false);
      expect(pole.garage).toBe(false);
      expect(pole.triangles.chimney.length).toBe(0);
    }
  });

  it('wears a gambrel on a seeded share of inferred barns, the steep gable on the rest', () => {
    // A farm road: a farmhouse and a barn behind it every 100 m, both sides, on no land.
    const street = untaggedStreetFixture();
    const buildings: BuildingFeature[] = [];
    for (let along = 1_000; along <= 2_900; along += 100) {
      for (const side of [1, -1]) {
        for (const [lateral, length, depth] of [
          [22, 12, 9],
          [70, 12, 15],
        ] as const) {
          const [a, n] = [along + (along % 7), side * lateral];
          buildings.push(
            buildingBeside(street.profile, street.origin, [rectangleBeside(a, n, length, depth)]),
          );
        }
      }
    }
    const farm: WorldCorridor = { ...street.corridor, landUse: [], buildings };
    const barns = plannedStreet({}, farm).filter((_, index) => index % 2 === 1);
    expect(barns).toHaveLength(40);
    expect(barns.every((plan) => plan.urban === 'rural' && plan.family === 'barn')).toBe(true);
    const gambrels = barns.filter((plan) => plan.roofVariant === 'gambrel').length;
    // About half, and both: 10 to 30 of 40.
    expect(gambrels).toBeGreaterThanOrEqual(10);
    expect(gambrels).toBeLessThanOrEqual(30);
    expect(barns.filter((plan) => plan.roofVariant === 'plain').length).toBe(40 - gambrels);
  });

  it('reads a main street by its class and grade: a primary, a secondary or a tertiary one on the ground', () => {
    const street = untaggedStreetFixture();
    /** The fixture's main street as `kindDetail` on `grade`. */
    const asMain = (kindDetail: string, grade: 'ground' | 'bridge' = 'ground'): WorldCorridor => ({
      ...street.corridor,
      streets: street.corridor.streets.map((each) =>
        each.kind === 'major_road' ? { ...each, kindDetail, grade } : each,
      ),
    });
    for (const detail of ['primary', 'secondary', 'tertiary']) {
      for (const shop of subjectsOf(plannedStreet({}, asMain(detail)), 'commercial')) {
        expect(shop.family, detail).toBe('commercial');
      }
    }
    for (const [detail, grade] of [
      ['trunk', 'ground'],
      ['residential', 'ground'],
      ['unclassified', 'ground'],
      ['tertiary', 'bridge'],
    ] as const) {
      for (const shop of subjectsOf(plannedStreet({}, asMain(detail, grade)), 'commercial')) {
        expect(shop.family, `${detail} ${grade}`).toBeUndefined();
      }
    }
  });

  it('draws an inferred shop as a mapped one: a shop front, commercial windows, no house feature', () => {
    for (const shop of subjectsOf(plans, 'commercial')) {
      expect(shop.urban).toBe('village');
      expect(shop.shop.front).toBe(true);
      expect(shop.porch).toBe(false);
      expect(shop.garage).toBe(false);
      expect(shop.archetype).toBe('unknown');
      expect(shop.model).toBeUndefined();
    }
    // Control: with the rule off the same footprint has no shop front.
    for (const untagged of subjectsOf(plannedStreet({ inferredCommercial: false }), 'commercial')) {
      expect(untagged.shop.front).toBe(false);
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

  /**
   * Each plan of `off` that is not of `kept`'s families planned as with the
   * type unread, which is as before #2023 — paint aside, which `paintTown`
   * moves off a neighbour's.
   */
  const asBefore = (off: readonly FootprintPlan[], kept: readonly string[]): number => {
    const none = plannedStreet({ buildingTypes: false }, stripped());
    let compared = 0;
    off.forEach((plan, index) => {
      if (plan.family !== undefined && kept.includes(plan.family)) return;
      expect(plan.inferred).toBe(false);
      expect(planFingerprint([plan], false)).toBe(
        planFingerprint([none[index] as FootprintPlan], false),
      );
      compared += 1;
    });
    return compared;
  };

  it('plans every garage’s and shed’s footprint as before with `inferredOutbuildings: false`, and keeps the barns', () => {
    const off = plannedStreet({ inferredOutbuildings: false }, stripped());
    expect(off.some((plan) => plan.family === 'garage' || plan.family === 'shed')).toBe(false);
    expect(off.some((plan) => plan.family === 'barn')).toBe(true);
    expect(asBefore(off, ['barn', 'pole-building', 'commercial'])).toBeGreaterThan(80);
    // Not vacuous: on, the street plans otherwise.
    expect(planFingerprint(plannedStreet({}, stripped()))).not.toBe(planFingerprint(off));
  });

  it('plans every barn’s footprint as before with `inferredBarns: false`, and keeps the garages', () => {
    const off = plannedStreet({ inferredBarns: false }, stripped());
    expect(off.some((plan) => plan.family === 'barn' || plan.family === 'pole-building')).toBe(
      false,
    );
    expect(off.some((plan) => plan.family === 'garage')).toBe(true);
    expect(asBefore(off, ['garage', 'shed', 'commercial'])).toBeGreaterThan(70);
    // Not vacuous: on, the street plans otherwise.
    expect(planFingerprint(plannedStreet({}, stripped()))).not.toBe(planFingerprint(off));
  });

  it('plans every big footprint as before with `inferredCommercial: false`, and keeps the rest', () => {
    const off = plannedStreet({ inferredCommercial: false }, stripped());
    expect(off.some((plan) => plan.family === 'commercial')).toBe(false);
    expect(off.some((plan) => plan.family === 'garage')).toBe(true);
    expect(off.some((plan) => plan.family === 'barn')).toBe(true);
    expect(asBefore(off, ['garage', 'shed', 'barn', 'pole-building'])).toBeGreaterThan(70);
    // Not vacuous: on, the street plans otherwise.
    expect(planFingerprint(plannedStreet({}, stripped()))).not.toBe(planFingerprint(off));
  });

  it('plans every untagged footprint as before with every lever off', () => {
    const off = plannedStreet(
      { inferredOutbuildings: false, inferredBarns: false, inferredCommercial: false },
      stripped(),
    );
    expect(off.every((plan) => !plan.inferred && plan.family === undefined)).toBe(true);
    expect(planFingerprint(off)).toBe(
      planFingerprint(plannedStreet({ buildingTypes: false }, stripped())),
    );
  });

  it('infers nothing while the type is not read (`buildingTypes: false`)', () => {
    const plans = plannedStreet({ buildingTypes: false });
    expect(plans.some((plan) => plan.inferred)).toBe(false);
  });
});
