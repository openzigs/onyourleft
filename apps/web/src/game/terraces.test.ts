// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1635: terraces and street walls. In a `town` or a `city-centre`, two
 * mapped footprints that share a wall are a terrace: the party wall has no
 * window, door or shutter, is not drawn at all where the two are the same
 * height and only above the lower roof where they are not, and a terraced
 * roof is flat behind a parapet under #1590's cornice. Each rule is asserted
 * on what `footprintPlans` — the call the press makes — hands back, and each
 * with its control.
 */

import { describe, expect, it } from 'vitest';

import type { BuildingFeature } from '@onyourleft/map-features';

import {
  FACADE_OFFSET,
  FACADE_PLAIN,
  FOOTPRINT_MAX_FAR_TRIANGLES,
  FOOTPRINT_MAX_TRIANGLES,
  FOOTPRINT_MAX_VERTICES,
  FOOTPRINT_ROLES,
  FOOTPRINT_VERTEX_FLOATS,
  footprintPlans,
  PARTY_WALL_SAME_HEIGHT_METRES,
  STYLE_COMMERCIAL,
  STYLE_OFFSET,
  STYLE_SASH,
  STYLE_SHUTTERS,
  TERRACE_CLASSES,
  type FootprintPlan,
  type FootprintRole,
} from './footprint-buildings';
import {
  besideRoad,
  buildingBeside,
  landBeside,
  rectangleBeside,
  terraceStreetFixture,
} from './footprint-fixtures-testing';
import { landClassMask } from './land-class';
import { northRoute } from './route-fixtures-testing';
import { corridorOrigin } from './terrain';
import { urbanClassMap, type UrbanClass, type UrbanClassMap } from './urban-class';
import type { WorldCorridor } from './world-data/corridor';

const profile = northRoute(3_000, () => 10);
const origin = corridorOrigin(profile);

/** Every stretch of the route `urban`. */
const everywhere = (urban: UrbanClass): UrbanClassMap => ({ classAt: () => urban });

/** A rectangle's corners, `(along, lateral)`, from `along` to `along + length` and `near` to `far`. */
function box(
  along: number,
  length: number,
  near: number,
  far: number,
): readonly (readonly [number, number])[] {
  return rectangleBeside(along + length / 2, (near + far) / 2, length, far - near);
}

/** `rings` (each `(along, lateral)` corners, and a height) planned on residential land. */
function plansOf(
  footprints: readonly (readonly [readonly (readonly [number, number])[], number])[],
  urban: UrbanClassMap | undefined,
): readonly FootprintPlan[] {
  const buildings: BuildingFeature[] = footprints.map(([ring, height]) =>
    buildingBeside(profile, origin, [ring], height),
  );
  const corridor: WorldCorridor = {
    routeId: 'terraces',
    origin,
    covered: () => true,
    coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
    landUse: [landBeside(profile, origin, 'landuse', 'residential', 10, 2_990, -100, 100)],
    buildings,
    paths: [],
    streets: [],
  };
  const { plans, verdicts } = footprintPlans(
    corridor,
    landClassMask(corridor),
    profile,
    origin,
    FOOTPRINT_MAX_VERTICES,
    urban,
  );
  expect(verdicts.kept).toBe(footprints.length);
  return plans;
}

/** The pair: two 8 × 10 m houses side by side along the road, 15 to 25 m out, `gap` metres apart. */
function pair(
  gap: number,
  heights: readonly [number, number] = [9, 9],
): readonly (readonly [readonly (readonly [number, number])[], number])[] {
  return [
    [box(1_000, 8, 15, 25), heights[0]],
    [box(1_008 + gap, 8, 15, 25), heights[1]],
  ];
}

/** One vertex of a role's triangles: where it is, and its facade's `top` and its style's flags. */
interface Vertex {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly top: number;
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
    });
  }
  return out;
}

/**
 * The triangles of `role` whose three corners lie on the road's normal at
 * `along`, between 15 and 25 m out: the party wall of {@link pair}.
 */
function onSharedEdge(
  plan: FootprintPlan,
  role: FootprintRole,
  along: number,
  within = 0.25,
): Vertex[][] {
  const [ax, az] = besideRoad(profile, origin, along, 15);
  const [bx, bz] = besideRoad(profile, origin, along, 25);
  const length = Math.hypot(bx - ax, bz - az);
  const on = (v: Vertex): boolean => {
    const offset = Math.abs(((v.x - ax) * (bz - az) - (v.z - az) * (bx - ax)) / length);
    const t = ((v.x - ax) * (bx - ax) + (v.z - az) * (bz - az)) / (length * length);
    return offset < within && t > -0.05 && t < 1.05;
  };
  const vertices = verticesOf(plan, role);
  const triangles: Vertex[][] = [];
  for (let i = 0; i + 2 < vertices.length; i += 3) {
    const three = vertices.slice(i, i + 3);
    if (three.every(on)) triangles.push(three);
  }
  return triangles;
}

/** Whether a plan was terraced: a gable-eligible house, flat under a cornice. */
const terraced = (plan: FootprintPlan): boolean => plan.roof === 'flat' && plan.shop.cornice;

/** Every role's triangles, as bytes, for an exact comparison. */
function bytesOf(plan: FootprintPlan): number[][] {
  return FOOTPRINT_ROLES.map((role) => Array.from(plan.triangles[role]));
}

describe('a terrace — the read path (#1635)', () => {
  it('draws no party wall between two 9 m houses that abut along a 10 m edge in a town', () => {
    const [a, b] = plansOf(pair(0), everywhere('town')) as [FootprintPlan, FootprintPlan];
    expect(terraced(a) && terraced(b)).toBe(true);
    for (const plan of [a, b]) {
      expect(onSharedEdge(plan, 'wall', 1_008)).toHaveLength(0);
      expect(onSharedEdge(plan, 'parapet', 1_008)).toHaveLength(0);
      // The far edges are walls as ever, with their windows.
      const far = plan === a ? 1_000 : 1_016;
      const walls = onSharedEdge(plan, 'wall', far);
      expect(walls.length).toBeGreaterThan(0);
      expect(walls.flat().every((v) => v.top > 0)).toBe(true);
    }
  });

  it('draws the taller one’s party wall only above the lower roof, plain', () => {
    const [tall, low] = plansOf(pair(0, [12, 9]), everywhere('town')) as [
      FootprintPlan,
      FootprintPlan,
    ];
    expect(tall.eaves - low.eaves).toBeGreaterThan(PARTY_WALL_SAME_HEIGHT_METRES);
    const shared = onSharedEdge(tall, 'wall', 1_008).flat();
    expect(shared.length).toBeGreaterThan(0);
    expect(Math.min(...shared.map((v) => v.y))).toBeCloseTo(low.eaves, 3);
    expect(Math.max(...shared.map((v) => v.y))).toBeCloseTo(tall.eaves, 3);
    for (const v of shared) {
      expect(v.top).toBe(FACADE_PLAIN);
      expect(v.flags & (STYLE_SASH | STYLE_SHUTTERS | STYLE_COMMERCIAL)).toBe(0);
    }
    // The lower one's is behind the taller's wall: not drawn.
    expect(onSharedEdge(low, 'wall', 1_008)).toHaveLength(0);
  });

  it('plans the same pair in a village exactly as with no urban class: the class gate', () => {
    const village = plansOf(pair(0), everywhere('village'));
    const none = plansOf(pair(0), undefined);
    expect(village.map(bytesOf)).toStrictEqual(none.map(bytesOf));
    expect(village.some(terraced)).toBe(false);
    // And its shared edge is two walls with windows, one each.
    for (const plan of village) {
      const walls = onSharedEdge(plan, 'wall', 1_008).flat();
      expect(walls.length).toBeGreaterThan(0);
      expect(walls.every((v) => v.top > 0)).toBe(true);
    }
  });

  it('terraces a city centre as a town, and no rural stretch', () => {
    expect(plansOf(pair(0), everywhere('city-centre')).every(terraced)).toBe(true);
    expect(plansOf(pair(0), everywhere('rural')).some(terraced)).toBe(false);
    expect(plansOf(pair(0), everywhere('unknown')).some(terraced)).toBe(false);
  });

  it('never puts the door on a party wall, even where it is the edge nearest the road', () => {
    // One house behind another: the back one's edge nearest the road is the party wall.
    const [, back] = plansOf(
      [
        [box(1_000, 10, 15, 23), 9],
        [box(1_000, 10, 23, 31), 9],
      ],
      everywhere('town'),
    ) as [FootprintPlan, FootprintPlan];
    const doors = verticesOf(back, 'door');
    expect(doors.length).toBeGreaterThan(0);
    const [nx, nz] = besideRoad(profile, origin, 1_005, 23);
    const [fx, fz] = besideRoad(profile, origin, 1_005, 22);
    // No door vertex on the line 23 m out: every one is off it by more than the door's proud.
    const ux = nx - fx;
    const uz = nz - fz;
    for (const v of doors) {
      expect(Math.abs((v.x - nx) * ux + (v.z - nz) * uz)).toBeGreaterThan(0.5);
    }
  });
});

describe('the thresholds — #1635', () => {
  it('is not a terrace 0.6 m apart, and is at 0.4 m', () => {
    expect(plansOf(pair(0.6), everywhere('town')).some(terraced)).toBe(false);
    expect(plansOf(pair(0.4), everywhere('town')).every(terraced)).toBe(true);
  });

  it('is not a terrace where the walls overlap by 1.5 m, and is at 2.5 m', () => {
    const offsetBy = (overlap: number): ReturnType<typeof pair> => [
      [box(1_000, 8, 15, 25), 9],
      [box(1_008, 8, 25 - overlap, 35 - overlap), 9],
    ];
    expect(plansOf(offsetBy(1.5), everywhere('town')).some(terraced)).toBe(false);
    expect(plansOf(offsetBy(2.5), everywhere('town')).every(terraced)).toBe(true);
  });

  it('is not a terrace where the walls are 8° apart, and is at 3°', () => {
    // The second house's near wall turned about its middle, 18 m out: 6 m deep, so even at 8°
    // its ends stay within the offset of the first's wall, and only the angle can refuse it.
    const turned = (degrees: number): ReturnType<typeof pair> => {
      const half = 3 * Math.tan((degrees * Math.PI) / 180);
      return [
        [box(1_000, 8, 15, 21), 9],
        [
          [
            [1_008 - half, 15],
            [1_016, 15],
            [1_016, 21],
            [1_008 + half, 21],
          ],
          9,
        ],
      ];
    };
    expect(plansOf(turned(8), everywhere('town')).some(terraced)).toBe(false);
    expect(plansOf(turned(3), everywhere('town')).every(terraced)).toBe(true);
  });
});

describe('the roof — #1635', () => {
  it('puts a terraced house that would be pitched under a flat roof and a cornice; a detached one keeps its pitch', () => {
    const [a, b, detached] = plansOf(
      [...pair(0), [box(1_030, 8, 15, 25), 9]],
      everywhere('town'),
    ) as [FootprintPlan, FootprintPlan, FootprintPlan];
    for (const plan of [a, b]) {
      expect(plan.roof).toBe('flat');
      expect(plan.shop.cornice).toBe(true);
      expect(plan.triangles.parapet.length).toBeGreaterThan(0);
      expect(plan.model).toBeUndefined();
    }
    expect(detached.roof).not.toBe('flat');
    // The same house detached in a village is pitched too: the rule it would have kept.
    expect(plansOf(pair(0), everywhere('village')).every((plan) => plan.roof !== 'flat')).toBe(
      true,
    );
  });

  it('draws a terraced house as its extrusion, never as a detached house model', () => {
    // #1585's Richmond lot: 7 m along the road by 19 m deep, two storeys, which a model fits.
    const lots = (): ReturnType<typeof pair> => [
      [box(1_000, 7, 12, 31), 6],
      [box(1_007, 7, 12, 31), 6],
    ];
    expect(plansOf(lots(), everywhere('village')).some((plan) => plan.model !== undefined)).toBe(
      true,
    );
    const town = plansOf(lots(), everywhere('town'));
    expect(town.every(terraced)).toBe(true);
    expect(town.every((plan) => plan.model === undefined)).toBe(true);
  });

  it('runs the cornice along the street wall but not over the party wall', () => {
    const [a] = plansOf(pair(0), everywhere('town')) as [FootprintPlan];
    expect(onSharedEdge(a, 'trim', 1_008, 0.6)).toHaveLength(0);
    expect(onSharedEdge(a, 'trim', 1_000, 0.6).length).toBeGreaterThan(0);
  });
});

describe('the terraced street the owner’s pair is taken on — #1635', () => {
  it('is classed a town by the press’s own urban class, and planned as terraces', () => {
    const street = terraceStreetFixture();
    const land = landClassMask(street.corridor);
    const urban = urbanClassMap(street.corridor, land, street.profile);
    const { plans } = footprintPlans(
      street.corridor,
      land,
      street.profile,
      street.origin,
      FOOTPRINT_MAX_VERTICES,
      urban,
    );
    expect(plans.length).toBe(street.corridor.buildings.length);
    expect(plans.every((plan) => TERRACE_CLASSES.has(plan.urban))).toBe(true);
    // Every house is in a row of eight, so every one shares a wall.
    expect(plans.every(terraced)).toBe(true);
    // And with the lever's control, no urban class, the houses keep today's pitched roofs.
    const today = footprintPlans(street.corridor, land, street.profile, street.origin);
    expect(today.plans.filter((plan) => plan.roof !== 'flat').length).toBeGreaterThan(10);
  });
});

describe('triangles fall, never rise — #1635', () => {
  const row = (): ReturnType<typeof pair> =>
    Array.from({ length: 6 }, (_, index) => [box(1_000 + 8 * index, 8, 15, 25), 9] as const);
  const total = (plans: readonly FootprintPlan[]): number =>
    plans.reduce((sum, plan) => sum + plan.triangleCount, 0);

  it('plans a row of 6 terraced houses to fewer triangles than the same 6 detached', () => {
    const town = plansOf(row(), everywhere('town'));
    const village = plansOf(row(), everywhere('village'));
    expect(town.every(terraced)).toBe(true);
    expect(total(town)).toBeLessThan(total(village));
    for (const plan of [...town, ...village]) {
      expect(plan.triangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_TRIANGLES);
      expect(plan.farTriangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_FAR_TRIANGLES);
    }
  });

  it('draws no party wall inside the row: each house’s walls only on the street, the back and the ends', () => {
    const town = plansOf(row(), everywhere('town'));
    for (let index = 1; index < 6; index += 1) {
      const along = 1_000 + 8 * index;
      expect(onSharedEdge(town[index - 1] as FootprintPlan, 'wall', along)).toHaveLength(0);
      expect(onSharedEdge(town[index] as FootprintPlan, 'wall', along)).toHaveLength(0);
    }
  });
});
