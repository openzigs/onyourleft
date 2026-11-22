// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2975: a footprint the map's POIs make a shop, a café or a fuel station is
 * drawn as one. Held where a rider sees it: the plans `footprintPlans`
 * returns and the triangles the belt uploads, over `poiStreetFixture`'s
 * street, every footprint on residential land, so that only its POI can make
 * one a shop. With `-map-pois` every plan is as it is with no POI at all.
 */

import { describe, expect, it } from 'vitest';

import { FOUNDATION_METRES, PLINTH_TOP_METRES } from './buildings';
import {
  FOOTPRINT_MAX_FAR_TRIANGLES,
  FOOTPRINT_MAX_TRIANGLES,
  FOOTPRINT_ROLES,
  FOOTPRINT_VERTEX_FLOATS,
  FUEL_CANOPY,
  FUEL_FORECOURT,
  FUEL_ISLAND,
  footprintPlans,
  type FootprintPlan,
  type FootprintPlanOptions,
  type FootprintRole,
} from './footprint-buildings';
import {
  buildingBeside,
  planFingerprint,
  POI_ROW_LATERAL,
  poiStreetFixture,
  rectangleBeside,
} from './footprint-fixtures-testing';
import { landClassMask } from './land-class';
import { FAR_ROLES, mappedBuildingsOf, onMappedGround, roleTriangles } from './mapped-buildings';
import { ROAD_WIDTH_METRES } from './terrain';

const fixture = poiStreetFixture();

/** The fixture's plans, by row, both sides; and the verdicts. */
function plan(
  options: FootprintPlanOptions = {},
  corridor = fixture.corridor,
): { readonly byRow: Map<string, FootprintPlan[]>; readonly plans: readonly FootprintPlan[] } {
  const land = landClassMask(corridor);
  const { plans, verdicts } = footprintPlans(
    corridor,
    land,
    fixture.profile,
    fixture.origin,
    undefined,
    undefined,
    options,
  );
  // Every footprint kept, so plan `i` is footprint `i`.
  expect(verdicts.kept).toBe(corridor.buildings.length);
  const byRow = new Map<string, FootprintPlan[]>();
  plans.forEach((each, index) => {
    const row = fixture.rows[index] as string;
    byRow.set(row, [...(byRow.get(row) ?? []), each]);
  });
  return { byRow, plans };
}

const product = plan();
const rowOf = (row: string): FootprintPlan[] => product.byRow.get(row) ?? [];

/** Every vertex's height in a role's triangles. */
function heights(floats: Float32Array): number[] {
  const out: number[] = [];
  for (let at = 0; at < floats.length; at += FOOTPRINT_VERTEX_FLOATS) {
    out.push(floats[at + 1] as number);
  }
  return out;
}

/** How many triangles a role of a plan is. */
const trianglesIn = (plan: FootprintPlan, role: FootprintRole): number => roleTriangles(plan, role);

/** How many of a role's triangles face straight down. */
function facingDown(floats: Float32Array): number {
  let vertices = 0;
  for (let at = 0; at < floats.length; at += FOOTPRINT_VERTEX_FLOATS) {
    if ((floats[at + 4] as number) < -0.5) vertices += 1;
  }
  return vertices / 3;
}

/** A ring's area, square metres. */
function ringArea(ring: ArrayLike<number>): number {
  let twice = 0;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    twice +=
      (ring[j] as number) * (ring[i + 1] as number) - (ring[i] as number) * (ring[j + 1] as number);
  }
  return Math.abs(twice / 2);
}

/** Whether a point is inside a ring (even-odd). */
function insideRing(ring: ArrayLike<number>, x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i] as number;
    const zi = ring[i + 1] as number;
    const xj = ring[j] as number;
    const zj = ring[j + 1] as number;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** The roles a canopy is drawn in: its slab and columns, its kerbs and pumps, its band, its forecourt. */
const CANOPY_ROLES: ReadonlySet<FootprintRole> = new Set([
  'wall',
  'roof',
  'trim',
  'door',
  'driveway',
]);

/** The fixture's road and land with only these footprints, each an untyped one a fuel POI marks. */
function fuelCorridor(
  rings: readonly (readonly (readonly [number, number])[])[],
): typeof fixture.corridor {
  return {
    ...fixture.corridor,
    buildings: rings.map((ring) => ({
      ...buildingBeside(fixture.profile, fixture.origin, [ring], 6),
      buildingType: null,
      poi: 'fuel' as const,
    })),
  };
}

/** The fixture with every footprint's POI taken off. */
const withoutPois = {
  ...fixture.corridor,
  buildings: fixture.corridor.buildings.map((building) => {
    const rest = { ...building };
    delete rest.poi;
    return rest;
  }),
};

describe('a shop or a café the map marks — #2975', () => {
  it('an untyped footprint with a shop’s POI has a shop front; its twin with none, on the same land, has none', () => {
    for (const shop of rowOf('shop')) {
      expect(shop.shop.front).toBe(true);
      expect(shop.family).toBe('commercial');
      expect(shop.triangles.shopfront.length).toBeGreaterThan(0);
    }
    for (const twin of rowOf('no-poi')) {
      expect(twin.shop.front).toBe(false);
      expect(twin.triangles.shopfront.length).toBe(0);
    }
  });

  it('a café always has its awning; the same footprint as a shop does not always', () => {
    expect(rowOf('cafe')).toHaveLength(2);
    for (const cafe of rowOf('cafe')) {
      expect(cafe.shop.front).toBe(true);
      expect(cafe.shop.awning).toBe(true);
    }
    // Not vacuous: an awning is not every other shop front's (#1590's share is a half).
    const fronts = ['shop', 'kiosk', 'fuel-too-big']
      .flatMap(rowOf)
      .filter((each) => each.shop.front);
    expect(fronts.filter((each) => !each.shop.awning).length).toBeGreaterThan(0);
  });

  it('a block of flats with a café is a shop below; a mapped house and garage keep their looks', () => {
    for (const flats of rowOf('flats')) {
      expect(flats.shop.front).toBe(true);
      expect(flats.shop.awning).toBe(true);
    }
    const off = plan({}, withoutPois).byRow;
    for (const row of ['house', 'garage']) {
      for (const [side, each] of rowOf(row).entries()) {
        expect(each.shop.front, row).toBe(false);
        expect(planFingerprint([each]), row).toBe(
          planFingerprint([(off.get(row) ?? [])[side] as FootprintPlan]),
        );
      }
    }
  });
});

describe('a fuel station the map marks — #2975', () => {
  it('its untyped footprint is an open canopy: a slab, columns, pump islands and a forecourt, and no wall, window or shop front', () => {
    for (const canopy of [...rowOf('canopy'), ...rowOf('canopy-no-height')]) {
      for (const role of FOOTPRINT_ROLES) {
        if (CANOPY_ROLES.has(role)) expect(canopy.triangles[role].length, role).toBeGreaterThan(0);
        else expect(canopy.triangles[role].length, role).toBe(0);
      }
      expect(canopy.shop.front).toBe(false);
      expect(canopy.frontStep).toBeUndefined();
      expect(canopy.model).toBeUndefined();
      expect(canopy.triangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_TRIANGLES);
      expect(canopy.triangleCount).toBe(
        FOOTPRINT_ROLES.reduce((sum, role) => sum + trianglesIn(canopy, role), 0),
      );
    }
    // The 24 m canopy, a rectangle: three islands. Its fascia's four faces, a column's four
    // at each island and the underside; the deck; a kerb's five faces and two pump heads' five
    // at each island; the band's four faces and two pump bodies' five at each island.
    for (const canopy of rowOf('canopy')) {
      expect(trianglesIn(canopy, 'wall')).toBe(4 * 2 + 3 * 8 + 2);
      expect(trianglesIn(canopy, 'roof')).toBe(2);
      expect(trianglesIn(canopy, 'trim')).toBe(3 * 10 + 3 * 2 * 10);
      expect(trianglesIn(canopy, 'door')).toBe(4 * 2 + 3 * 2 * 10);
    }
  });

  it('it has a far level — the slab on its columns — so it does not appear from nothing as the rider nears', () => {
    for (const canopy of [...rowOf('canopy'), ...rowOf('canopy-no-height')]) {
      expect(canopy.farTriangleCount).toBe(
        FAR_ROLES.reduce((sum, role) => sum + trianglesIn(canopy, role), 0),
      );
      expect(canopy.farTriangleCount).toBeGreaterThan(0);
      expect(canopy.farTriangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_FAR_TRIANGLES);
      // The far level's walls hold the fascia's top, the underside and the columns' feet.
      const ys = heights(canopy.triangles.wall);
      const ground = canopy.base + FOUNDATION_METRES;
      expect(Math.max(...ys)).toBeCloseTo(canopy.eaves, 5);
      expect(Math.min(...ys)).toBeCloseTo(ground - FUEL_ISLAND.sunk, 4);
      // The underside faces down, in the far level's walls.
      expect(facingDown(canopy.triangles.wall)).toBeGreaterThan(0);
      expect(facingDown(canopy.triangles.trim)).toBe(0);
    }
  });

  it('its slab’s top is its mapped height, or with none the forecourt’s, and a column at each island reaches the ground', () => {
    for (const [row, rise] of [
      ['canopy', 6.4],
      ['canopy-no-height', FUEL_CANOPY.clearance + FUEL_CANOPY.thickness],
    ] as const) {
      for (const canopy of rowOf(row)) {
        // A level road: the ground under it is flat, at the base and its foundation.
        const ground = canopy.base + FOUNDATION_METRES;
        const floor = ground + PLINTH_TOP_METRES;
        const ys = heights(canopy.triangles.wall);
        const top = Math.max(...ys);
        expect(top).toBeCloseTo(canopy.eaves, 5);
        expect(top - (row === 'canopy' ? ground : floor), row).toBeCloseTo(rise, 4);
        // The underside, the slab's thickness under its top.
        expect(ys.some((y) => Math.abs(y - (top - FUEL_CANOPY.thickness)) < 1e-4)).toBe(true);
        // The columns: from under the ground to the underside, and nothing else below it.
        expect(Math.min(...ys)).toBeCloseTo(ground - FUEL_ISLAND.sunk, 4);
        const below = ys.filter((y) => y < top - FUEL_CANOPY.thickness - 1e-4);
        // Three columns, each four upright faces of two triangles, three of whose six corners are at the foot.
        expect(below.length).toBe(3 * 4 * 3);
      }
    }
  });

  it('a pump stands either side of each column, on a kerb, under the slab: a body in the band’s colour and a white head', () => {
    for (const canopy of [...rowOf('canopy'), ...rowOf('canopy-no-height')]) {
      const ground = canopy.base + FOUNDATION_METRES;
      const kerb = ground + FUEL_FORECOURT.lift + FUEL_ISLAND.kerb;
      const underside = canopy.eaves - FUEL_CANOPY.thickness;
      // The bodies, in `door`: everything of it that is not the band up on the fascia.
      const bodies = heights(canopy.triangles.door).filter((y) => y < underside);
      expect(Math.min(...bodies)).toBeCloseTo(kerb, 4);
      expect(Math.max(...bodies)).toBeCloseTo(kerb + FUEL_ISLAND.pump.body, 4);
      // The kerbs and the heads, in `trim`: from under the ground to a dispenser's height.
      const white = heights(canopy.triangles.trim);
      expect(Math.min(...white)).toBeCloseTo(ground - FUEL_ISLAND.sunk, 4);
      expect(Math.max(...white)).toBeCloseTo(kerb + FUEL_ISLAND.pump.head, 4);
      // A head clears the slab by more than a metre.
      expect(underside - Math.max(...white)).toBeGreaterThan(1);
      // The band, on the fascia: inside its top and bottom.
      const band = heights(canopy.triangles.door).filter((y) => y >= underside);
      expect(Math.min(...band)).toBeCloseTo(underside + FUEL_CANOPY.band.inset, 4);
      expect(Math.max(...band)).toBeCloseTo(canopy.eaves - FUEL_CANOPY.band.inset, 4);
    }
  });

  it('it is white with a band of one of a forecourt’s colours, whatever stands beside it', () => {
    // Two canopies 20 m apart: the second is painted after the first, within a neighbour's
    // reach of it, which moves any other plan off the first's paints.
    const pair = plan(
      {},
      fuelCorridor([rectangleBeside(1_180, 26, 24, 14), rectangleBeside(1_180, 46, 24, 14)]),
    ).plans;
    expect(pair).toHaveLength(2);
    for (const canopy of [...pair, ...rowOf('canopy'), ...rowOf('canopy-no-height')]) {
      expect(canopy.paint.wall).toBe(FUEL_CANOPY.paint.wall);
      expect(canopy.paint.trim).toBe(FUEL_CANOPY.paint.trim);
      expect(FUEL_CANOPY.paint.bands).toContain(canopy.paint.door);
    }
  });

  it('its forecourt is paved from behind the canopy out to the carriageway’s edge, and never onto it', () => {
    const [right, left] = rowOf('canopy') as [FootprintPlan, FootprintPlan];
    // The road's middle is midway between the two sides' canopies; `out` is across it.
    const middle = {
      x: (right.centroid.x + left.centroid.x) / 2,
      z: (right.centroid.z + left.centroid.z) / 2,
    };
    const apart = Math.hypot(
      right.centroid.x - left.centroid.x,
      right.centroid.z - left.centroid.z,
    );
    expect(apart).toBeCloseTo(2 * POI_ROW_LATERAL, 3);
    for (const [canopy, side] of [
      [right, 1],
      [left, -1],
    ] as const) {
      const out = {
        x: (side * (right.centroid.x - left.centroid.x)) / apart,
        z: (side * (right.centroid.z - left.centroid.z)) / apart,
      };
      const floats = canopy.triangles.driveway;
      const laterals: number[] = [];
      for (let at = 0; at < floats.length; at += FOOTPRINT_VERTEX_FLOATS) {
        laterals.push(
          ((floats[at] as number) - middle.x) * out.x +
            ((floats[at + 2] as number) - middle.z) * out.z,
        );
      }
      // From `short` of the carriageway's edge to the margin behind the canopy.
      expect(Math.min(...laterals)).toBeCloseTo(ROAD_WIDTH_METRES / 2 + FUEL_FORECOURT.short, 1);
      expect(Math.min(...laterals)).toBeGreaterThanOrEqual(ROAD_WIDTH_METRES / 2);
      expect(Math.max(...laterals)).toBeCloseTo(POI_ROW_LATERAL + 7 + FUEL_FORECOURT.margin, 3);
      // Laid on the ground, the lift over it: under the canopy the flat ground it stands on,
      // and toward the road the verge's own fall, each corner on the ground beneath it.
      const ground = canopy.base + FOUNDATION_METRES;
      const ys = heights(floats);
      ys.forEach((y, index) => {
        if ((laterals[index] as number) >= POI_ROW_LATERAL - 7) {
          expect(y).toBeCloseTo(ground + FUEL_FORECOURT.lift, 4);
        }
        expect(Math.abs(y - ground)).toBeLessThan(0.5);
      });
      expect(trianglesIn(canopy, 'driveway')).toBeLessThanOrEqual(FUEL_FORECOURT.most);
      // Its outline is the plan's driveway: the canopy's 24 m and the margin either end.
      expect(canopy.driveway).toHaveLength(8);
      // Within two square metres of 972: the drawn outline is the mapped one in 32-bit floats.
      const paved =
        (24 + 2 * FUEL_FORECOURT.margin) *
        (POI_ROW_LATERAL + 7 + FUEL_FORECOURT.margin - Math.min(...laterals));
      expect(Math.abs(ringArea(canopy.driveway) - paved)).toBeLessThan(2);
    }
  });

  it('no tree or lot stands on the forecourt between the canopy and the road', () => {
    const buildings = mappedBuildingsOf(product.plans);
    for (const canopy of rowOf('canopy')) {
      const ring = canopy.driveway;
      const cx =
        ((ring[0] as number) + (ring[2] as number) + (ring[4] as number) + (ring[6] as number)) / 4;
      const cz =
        ((ring[1] as number) + (ring[3] as number) + (ring[5] as number) + (ring[7] as number)) / 4;
      // Just inside each corner of the forecourt, the two by the road among them.
      for (let at = 0; at < ring.length; at += 2) {
        const x = (ring[at] as number) * 0.95 + cx * 0.05;
        const z = (ring[at + 1] as number) * 0.95 + cz * 0.05;
        expect(onMappedGround(buildings, x, z)).toBe(true);
      }
    }
  });

  it('a forecourt further from the road than its reach is the margin round the canopy and no more', () => {
    // Its near edge 54 m out: 47 m of ground between its margin and the carriageway.
    const [far] = plan({}, fuelCorridor([rectangleBeside(1_180, 60, 24, 12)])).plans as [
      FootprintPlan,
    ];
    const margin = (24 + 2 * FUEL_FORECOURT.margin) * (12 + 2 * FUEL_FORECOURT.margin);
    // Within a square metre: the drawn outline is the mapped one in 32-bit floats.
    expect(Math.abs(ringArea(far.driveway) - margin)).toBeLessThan(1);
  });

  it('a many-sided canopy stays inside a plan’s triangles and its far level’s: its forecourt is laid in what the rest leaves, and its underside is the near level’s', () => {
    // 48 sides, 32 m by 26 m, and too far from the road for its forecourt to reach it: its
    // paving is 154 triangles in 4 m pieces (measured: the plan is 670 with them), where the
    // rest leaves 124, so it is laid in 6 m pieces.
    const ring = Array.from({ length: 48 }, (_, index) => {
      const angle = (2 * Math.PI * index) / 48;
      const out = index % 2 === 0 ? 1 : 0.87;
      return [1_180 + 16 * out * Math.cos(angle), 50 + 13 * out * Math.sin(angle)] as const;
    });
    const [star] = plan({}, fuelCorridor([ring])).plans as [FootprintPlan];
    const sides = star.footprint.length / 2;
    // Not vacuous: every side kept, so the rest is all a canopy can be.
    expect(sides).toBe(48);
    expect(trianglesIn(star, 'door')).toBe(2 * sides + 4 * 2 * 10);
    expect(star.triangleCount - trianglesIn(star, 'driveway')).toBe(516);
    expect(star.triangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_TRIANGLES);
    expect(trianglesIn(star, 'driveway')).toBe(70);
    expect(star.farTriangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_FAR_TRIANGLES);
    // The underside is still drawn, in the trim.
    expect(facingDown(star.triangles.wall)).toBe(0);
    expect(facingDown(star.triangles.trim)).toBe(sides - 2);
  });

  it('the fixture’s kiosk stands behind its canopy, as a station’s shop does', () => {
    rowOf('canopy').forEach((canopy, side) => {
      const kiosk = rowOf('kiosk')[side] as FootprintPlan;
      expect(
        Math.hypot(kiosk.centroid.x - canopy.centroid.x, kiosk.centroid.z - canopy.centroid.z),
      ).toBeCloseTo(16, 2);
    });
  });

  it('a mapped height is held between the bounds over the floor: never a slab in the sky or in the ground', () => {
    for (const [height, rise] of [
      [1_000, FUEL_CANOPY.top.most],
      [1, FUEL_CANOPY.top.least],
    ] as const) {
      const corridor = {
        ...fixture.corridor,
        buildings: fixture.corridor.buildings.map((building, index) =>
          fixture.rows[index] === 'canopy' ? { ...building, heightMetres: height } : building,
        ),
      };
      const canopies = plan({}, corridor).byRow.get('canopy') ?? [];
      expect(canopies.length).toBeGreaterThan(0);
      for (const canopy of canopies) {
        const floor = canopy.base + FOUNDATION_METRES + PLINTH_TOP_METRES;
        expect(Math.max(...heights(canopy.triangles.wall)) - floor, String(height)).toBeCloseTo(
          rise,
          4,
        );
      }
    }
  });

  it('no tree or rock stands under it: its outline is cleared as a building’s is', () => {
    const buildings = mappedBuildingsOf(product.plans);
    for (const canopy of rowOf('canopy')) {
      // Under the middle of the slab, where nothing stands but the posts at its corners.
      expect(onMappedGround(buildings, canopy.centroid.x, canopy.centroid.z)).toBe(true);
    }
  });

  it('its `retail` kiosk, and an untyped footprint too big for a canopy, are shops with walls', () => {
    for (const row of ['kiosk', 'fuel-too-big']) {
      for (const each of rowOf(row)) {
        expect(each.triangles.wall.length, row).toBeGreaterThan(0);
        expect(each.farTriangleCount, row).toBeGreaterThan(0);
        expect(each.shop.front, row).toBe(true);
      }
    }
  });

  it('a long canopy has at most its islands’ `most`, one column at each', () => {
    // 48 m: one island every 8 m would be six.
    const [long] = plan({}, fuelCorridor([rectangleBeside(1_180, 26, 48, 12)])).plans as [
      FootprintPlan,
    ];
    const ys = heights(long.triangles.wall);
    const underside = long.eaves - FUEL_CANOPY.thickness;
    // Each column four upright faces of two triangles, three of whose six corners are at the foot.
    expect(ys.filter((y) => y < underside - 1e-4)).toHaveLength(FUEL_ISLAND.most * 4 * 3);
  });

  it('an untyped landmark a fuel POI marks keeps its building: no canopy', () => {
    const corridor = fuelCorridor([rectangleBeside(1_180, 26, 24, 14)]);
    const [canopy] = plan({}, corridor).plans as [FootprintPlan];
    const [townhall] = plan(
      {},
      {
        ...corridor,
        buildings: corridor.buildings.map((each) => ({ ...each, landmark: 'townhall' as const })),
      },
    ).plans as [FootprintPlan];
    // The control: the same footprint with no landmark is a canopy, on columns with no plinth.
    expect(canopy.triangles.plinth.length).toBe(0);
    expect(trianglesIn(canopy, 'driveway')).toBeGreaterThan(0);
    // The townhall stands on its plinth, and lays no forecourt.
    expect(townhall.triangles.plinth.length).toBeGreaterThan(0);
    expect(townhall.triangles.driveway.length).toBe(0);
  });

  it('on a narrow canopy a pump never stands in its column: it keeps its clearance off it', () => {
    // 4 m across: `fromColumn` would put a pump's inner end inside the column.
    const pair = plan(
      {},
      fuelCorridor([rectangleBeside(1_180, 26, 24, 4), rectangleBeside(1_180, -26, 24, 4)]),
    ).plans as [FootprintPlan, FootprintPlan];
    const [right, left] = pair;
    const apart = Math.hypot(
      right.centroid.x - left.centroid.x,
      right.centroid.z - left.centroid.z,
    );
    const across = {
      x: (right.centroid.x - left.centroid.x) / apart,
      z: (right.centroid.z - left.centroid.z) / apart,
    };
    for (const canopy of pair) {
      const underside = canopy.eaves - FUEL_CANOPY.thickness;
      const floats = canopy.triangles.door;
      const offsets: number[] = [];
      for (let at = 0; at < floats.length; at += FOOTPRINT_VERTEX_FLOATS) {
        // A pump body's corner, not the band up on the fascia.
        if ((floats[at + 1] as number) >= underside) continue;
        offsets.push(
          Math.abs(
            ((floats[at] as number) - canopy.centroid.x) * across.x +
              ((floats[at + 2] as number) - canopy.centroid.z) * across.z,
          ),
        );
      }
      expect(offsets.length).toBeGreaterThan(0);
      // The columns stand on the canopy's middle line: a pump's nearest face is clear of one.
      expect(Math.min(...offsets)).toBeGreaterThanOrEqual(
        FUEL_CANOPY.post / 2 + FUEL_ISLAND.pump.clear - 1e-3,
      );
      // And still under the slab.
      expect(Math.max(...offsets)).toBeLessThan(2);
    }
  });

  it('a house planned after a canopy puts no front porch on its forecourt', () => {
    const { profile, origin } = fixture;
    // Three houses between a canopy and the road, on the forecourt it lays out to the road.
    const houses = [1_170, 1_180, 1_190].map((along) => ({
      ...buildingBeside(profile, origin, [rectangleBeside(along, 22, 9, 8)], 6),
      buildingType: 'house' as const,
    }));
    const canopyOf = (poi: 'fuel' | undefined) => ({
      ...buildingBeside(profile, origin, [rectangleBeside(1_180, 40, 24, 10)], 6),
      buildingType: null,
      ...(poi === undefined ? {} : { poi }),
    });
    const porchesWith = (poi: 'fuel' | undefined): readonly FootprintPlan[] =>
      plan({}, { ...fixture.corridor, buildings: [canopyOf(poi), ...houses] }).plans;
    // The control: with no fuel POI, there is no forecourt, and two of the houses have porches.
    const control = porchesWith(undefined).slice(1);
    expect(control.filter((house) => house.porch)).toHaveLength(2);
    const [canopy, ...after] = porchesWith('fuel') as [FootprintPlan, ...FootprintPlan[]];
    expect(canopy.driveway).toHaveLength(8);
    for (const house of after) {
      const floats = house.triangles.porch;
      for (let at = 0; at < floats.length; at += FOOTPRINT_VERTEX_FLOATS) {
        expect(insideRing(canopy.driveway, floats[at] as number, floats[at + 2] as number)).toBe(
          false,
        );
      }
    }
  });
});

describe('a shop’s apron beside the map’s POIs — #2848 and #2975', () => {
  const { profile, origin } = fixture;
  /** An untyped footprint `along` the road, near enough it for an apron, with this POI. */
  const nearTheRoad = (along: number, poi: 'shop' | 'cafe' | 'fuel' | undefined, lateral = 12) => ({
    ...buildingBeside(profile, origin, [rectangleBeside(along, lateral, 10, 8)], 6),
    buildingType: null,
    ...(poi === undefined ? {} : { poi }),
  });

  it('a shop or a café the map marks has an apron, exactly as a mapped shop does; its twin with none has none', () => {
    const [shop, cafe, twin] = plan(
      {},
      {
        ...fixture.corridor,
        buildings: [
          nearTheRoad(1_100, 'shop'),
          nearTheRoad(1_200, 'cafe'),
          nearTheRoad(1_300, undefined),
        ],
      },
    ).plans as [FootprintPlan, FootprintPlan, FootprintPlan];
    for (const each of [shop, cafe]) {
      expect(each.apron.length).toBeGreaterThan(0);
      expect(trianglesIn(each, 'apron')).toBeGreaterThan(0);
    }
    expect(twin.apron).toHaveLength(0);
    // The same footprint mapped a shop has the same apron: the POI takes #2848's rule as it is.
    const [mapped] = plan(
      {},
      {
        ...fixture.corridor,
        buildings: [{ ...nearTheRoad(1_100, undefined), buildingType: 'retail' as const }],
      },
    ).plans as [FootprintPlan];
    expect(Array.from(shop.apron)).toStrictEqual(Array.from(mapped.apron));
  });

  it('a fuel station’s canopy has no apron, and no shop’s apron is laid on its forecourt', () => {
    for (const canopy of [...rowOf('canopy'), ...rowOf('canopy-no-height')]) {
      expect(canopy.apron).toHaveLength(0);
      expect(trianglesIn(canopy, 'apron')).toBe(0);
    }
    // A canopy near enough the road for an apron, were it a shop.
    const [near] = plan({}, { ...fixture.corridor, buildings: [nearTheRoad(1_180, 'fuel')] })
      .plans as [FootprintPlan];
    expect(near.driveway).toHaveLength(8);
    expect(near.apron).toHaveLength(0);
    // Three shops between a canopy and the road, on the forecourt it lays out to the road.
    const shops = [1_165, 1_180, 1_195].map((along) => nearTheRoad(along, 'shop'));
    const canopyOf = (poi: 'fuel' | undefined) => nearTheRoad(1_180, poi, 30);
    const planned = (poi: 'fuel' | undefined): readonly FootprintPlan[] =>
      plan({}, { ...fixture.corridor, buildings: [canopyOf(poi), ...shops] }).plans;
    // The control: with no fuel POI there is no forecourt, and the shops have their aprons.
    const control = planned(undefined).slice(1);
    expect(control.filter((shop) => shop.apron.length > 0).length).toBeGreaterThan(0);
    const [canopy, ...after] = planned('fuel') as [FootprintPlan, ...FootprintPlan[]];
    expect(canopy.driveway).toHaveLength(8);
    expect(canopy.apron).toHaveLength(0);
    for (const shop of after) {
      for (let at = 0; at < shop.apron.length; at += 2) {
        expect(
          insideRing(canopy.driveway, shop.apron[at] as number, shop.apron[at + 1] as number),
        ).toBe(false);
      }
    }
  });
});

describe('`-map-pois` — #2975', () => {
  it('plans every footprint as it is planned with no POI at all, byte for byte', () => {
    const off = plan({ mappedPois: false }).plans;
    const none = plan({}, withoutPois).plans;
    expect(planFingerprint(off)).toBe(planFingerprint(none));
    for (const [index, each] of off.entries()) {
      expect(each.shop).toStrictEqual(none[index]?.shop);
    }
    // Not vacuous: with the lever on, the plans differ.
    expect(planFingerprint(product.plans)).not.toBe(planFingerprint(none));
  });
});
