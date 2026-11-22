// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3047: "some buildings missing sides" — every footprint building's walls,
 * read back from the triangles `footprintPlans` builds: each one faces out of
 * the building's material, whichever way its ring is wound, a courtyard's
 * into the courtyard, and every edge of a footprint is walled.
 *
 * The cause on the owner's ride was not the winding: it was a building two
 * tiles' buffers both carried, planned twice, whose copies each took the
 * other's coincident edges for a party wall (#1635) and drew no face there
 * (`world-data/tile-copies.ts`). The last describe holds that, through
 * `worldCorridorOf`, the path every ride's corridor takes.
 */

import { describe, expect, it } from 'vitest';

import { NO_BUILDING_FIELDS, type BuildingFeature, type Ring } from '@onyourleft/map-features';

import { FOOTPRINT_VERTEX_FLOATS, footprintPlans, type FootprintPlan } from './footprint-buildings';
import {
  buildingBeside,
  footprintFixture,
  polygonBeside,
  rectangleBeside,
} from './footprint-fixtures-testing';
import { landClassMask } from './land-class';
import type { WorldCorridor } from './world-data/corridor';
import { worldCorridorOf } from './world-data/corridor';

const fixture = footprintFixture();
const { profile, origin } = fixture;

/** The same footprint with every ring wound the other way. */
function reversed(building: BuildingFeature): BuildingFeature {
  return {
    ...building,
    rings: building.rings.map((ring) => {
      const n = ring.length / 2;
      const out = new Float32Array(ring.length);
      for (let i = 0; i < n; i++) {
        out[i * 2] = ring[(n - 1 - i) * 2] as number;
        out[i * 2 + 1] = ring[(n - 1 - i) * 2 + 1] as number;
      }
      return out;
    }),
  };
}

/** Twice the signed area of a ring, positive counter-clockwise in `(x, z)`. */
function twiceArea(ring: Ring): number {
  const n = ring.length / 2;
  let twice = 0;
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    twice +=
      (ring[j * 2] as number) * (ring[i * 2 + 1] as number) -
      (ring[i * 2] as number) * (ring[j * 2 + 1] as number);
  }
  return twice;
}

function insideRing(ring: Ring, x: number, z: number): boolean {
  const n = ring.length / 2;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const xi = ring[i * 2] as number;
    const zi = ring[i * 2 + 1] as number;
    const xj = ring[j * 2] as number;
    const zj = ring[j * 2 + 1] as number;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether `(x, z)` is in the building's material: inside its outer ring and no hole. */
function inMaterial(rings: readonly Ring[], x: number, z: number): boolean {
  return rings.every((ring, index) => insideRing(ring, x, z) === (index === 0));
}

/** The edge of `rings` within 5 cm of `(x, z)`, as `[ring, edge]`, or undefined. */
function edgeAt(rings: readonly Ring[], x: number, z: number): [number, number] | undefined {
  for (const [r, ring] of rings.entries()) {
    const n = ring.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = ring[i * 2] as number;
      const az = ring[i * 2 + 1] as number;
      const dx = (ring[j * 2] as number) - ax;
      const dz = (ring[j * 2 + 1] as number) - az;
      const span = dx * dx + dz * dz;
      const t = ((x - ax) * dx + (z - az) * dz) / span;
      if (t < 0 || t > 1) continue;
      if (Math.hypot(ax + dx * t - x, az + dz * t - z) <= 0.05) return [r, i];
    }
  }
  return undefined;
}

/** Every upright wall triangle of a plan: its centroid, normal and area. */
function uprightWalls(
  plan: FootprintPlan,
): { x: number; y: number; z: number; nx: number; nz: number; area: number }[] {
  const f = plan.triangles.wall;
  const s = FOOTPRINT_VERTEX_FLOATS;
  const out: { x: number; y: number; z: number; nx: number; nz: number; area: number }[] = [];
  for (let at = 0; at < f.length; at += 3 * s) {
    if (Math.abs(f[at + 4] as number) > 1e-3) continue;
    const p = (k: number, c: number): number => f[at + k * s + c] as number;
    const ux = p(1, 0) - p(0, 0);
    const uy = p(1, 1) - p(0, 1);
    const uz = p(1, 2) - p(0, 2);
    const vx = p(2, 0) - p(0, 0);
    const vy = p(2, 1) - p(0, 1);
    const vz = p(2, 2) - p(0, 2);
    out.push({
      x: (p(0, 0) + p(1, 0) + p(2, 0)) / 3,
      y: (p(0, 1) + p(1, 1) + p(2, 1)) / 3,
      z: (p(0, 2) + p(1, 2) + p(2, 2)) / 3,
      nx: p(0, 3),
      nz: p(0, 5),
      area: Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2,
    });
  }
  return out;
}

/** Where a plan's walls start: their lowest vertex, the floor over the highest ground. */
function wallFoot(plan: FootprintPlan): number {
  const f = plan.triangles.wall;
  let foot = Number.POSITIVE_INFINITY;
  for (let at = 0; at < f.length; at += FOOTPRINT_VERTEX_FLOATS) {
    foot = Math.min(foot, f[at + 1] as number);
  }
  return foot;
}

/** Plans `buildings` in the fixture's corridor, alone. */
function plansOf(buildings: readonly BuildingFeature[], corridor?: WorldCorridor): FootprintPlan[] {
  const within = corridor ?? { ...fixture.corridor, buildings };
  return [...footprintPlans(within, landClassMask(within), profile, origin).plans];
}

/**
 * Per edge of `rings`, the share of its length times the wall's height that
 * the plan's upright walls on it cover — 1 where the edge is walled from the
 * floor to the eaves, 0 where it has no wall.
 */
function walledShares(plan: FootprintPlan, rings: readonly Ring[]): number[][] {
  const height = plan.eaves - wallFoot(plan);
  const covered = rings.map((ring) => new Array<number>(ring.length / 2).fill(0));
  for (const wall of uprightWalls(plan)) {
    // A gable's triangle stands above the eaves; it walls no more of the edge's storeys.
    if (wall.y > plan.eaves) continue;
    const at = edgeAt(rings, wall.x, wall.z);
    if (at === undefined) continue;
    const row = covered[at[0]] as number[];
    row[at[1]] = (row[at[1]] as number) + wall.area;
  }
  return covered.map((row, r) =>
    row.map((area, i) => {
      const ring = rings[r] as Ring;
      const n = ring.length / 2;
      const j = (i + 1) % n;
      const length = Math.hypot(
        (ring[j * 2] as number) - (ring[i * 2] as number),
        (ring[j * 2 + 1] as number) - (ring[i * 2 + 1] as number),
      );
      return area / (length * height);
    }),
  );
}

// A rectangle, an L, a courtyard with a hole, and one on the 8 % climb past 1 500 m.
const SHAPES: Readonly<Record<string, BuildingFeature>> = {
  rectangle: buildingBeside(profile, origin, [rectangleBeside(330, 40, 14, 10)], 6),
  ell: fixture.named.ell,
  courtyard: buildingBeside(profile, origin, [
    rectangleBeside(600, 120, 40, 40),
    rectangleBeside(600, 120, 12, 12),
  ]),
  slope: buildingBeside(profile, origin, [rectangleBeside(1_800, 30, 10, 8)], 6),
};

describe('every wall faces out of its building, whichever way its ring is wound', () => {
  it('control: the fixture has a ring each way, a hole, and ground that rises under one', () => {
    const windings = new Set<boolean>();
    for (const building of Object.values(SHAPES)) {
      for (const each of [building, reversed(building)]) {
        windings.add(twiceArea(each.rings[0] as Ring) > 0);
      }
    }
    expect(windings).toEqual(new Set([true, false]));
    expect(SHAPES.courtyard?.rings).toHaveLength(2);
    // 8 m of a footprint across the 8 % climb's fall line is level; 10 m along it rises
    // 0.8 m, which the plinth takes up: its foot to the walls' is that much more than on the level.
    const plinth = (plan: FootprintPlan): number => wallFoot(plan) - plan.base;
    const slope = plansOf([SHAPES.slope as BuildingFeature])[0] as FootprintPlan;
    const level = plansOf([SHAPES.rectangle as BuildingFeature])[0] as FootprintPlan;
    expect(plinth(slope) - plinth(level)).toBeGreaterThan(0.5);
  });

  for (const [name, building] of Object.entries(SHAPES)) {
    for (const wound of ['as given', 'reversed'] as const) {
      it(`${name}, ${wound}: each upright wall on an edge faces out of the material`, () => {
        const footprint = wound === 'reversed' ? reversed(building) : building;
        const [plan] = plansOf([footprint]);
        expect(plan, `${name} was planned`).toBeDefined();
        const rings = footprint.rings;
        let checked = 0;
        let holes = 0;
        for (const wall of uprightWalls(plan as FootprintPlan)) {
          const at = edgeAt(rings, wall.x, wall.z);
          if (at === undefined) continue;
          const ahead = inMaterial(rings, wall.x + wall.nx * 0.3, wall.z + wall.nz * 0.3);
          const behind = inMaterial(rings, wall.x - wall.nx * 0.3, wall.z - wall.nz * 0.3);
          // An L's gable over its inner corner stands half over the other wing: its normal is
          // the edge's, and the probe from its middle may land in that wing. Judge it by the edge.
          if (ahead === behind) continue;
          expect(ahead, `${name} ring ${String(at[0])} edge ${String(at[1])}`).toBe(false);
          expect(behind).toBe(true);
          checked += 1;
          if (at[0] > 0) holes += 1;
        }
        expect(checked).toBeGreaterThanOrEqual(8);
        if (name === 'courtyard') expect(holes).toBeGreaterThanOrEqual(8);
      });
    }
  }

  it('builds the same walls either way round', () => {
    for (const building of Object.values(SHAPES)) {
      const [a] = plansOf([building]);
      const [b] = plansOf([reversed(building)]);
      const shares = (plan: FootprintPlan | undefined): number =>
        walledShares(plan as FootprintPlan, building.rings)
          .flat()
          .reduce((sum, share) => sum + share, 0);
      expect(shares(b)).toBeCloseTo(shares(a), 3);
    }
  });
});

describe('every edge of a footprint is walled — #3047', () => {
  it('walls every edge of every shape, holes too, from the floor to the eaves', () => {
    for (const [name, building] of Object.entries(SHAPES)) {
      const [plan] = plansOf([building]);
      for (const [r, row] of walledShares(plan as FootprintPlan, building.rings).entries()) {
        for (const [i, share] of row.entries()) {
          expect(share, `${name} ring ${String(r)} edge ${String(i)}`).toBeGreaterThan(0.95);
        }
      }
    }
  });
});

describe('a building two tiles both carry is drawn once, with all its walls — #3047', () => {
  // A terraced row's footprint (#1791: a party-wall candidate on any land), and the copies
  // two tiles' buffers carry of it: one whole, each vertex on the other tile's grid (up to a
  // quarter of a metre off), and one clipped at the other tile's buffer line.
  const terrace = { ...NO_BUILDING_FIELDS, buildingType: 'terrace' as const };
  const whole: BuildingFeature = {
    ...buildingBeside(profile, origin, [rectangleBeside(330, 40, 14, 10)], 6),
    ...terrace,
  };
  const outer = whole.rings[0] as Ring;
  const shifted: BuildingFeature = {
    ...whole,
    rings: [outer.map((value, index) => value + (index % 2 === 0 ? 0.2 : -0.15))],
  };
  const clipped: BuildingFeature = {
    ...buildingBeside(
      profile,
      origin,
      [
        [
          [323, 35],
          [330, 35],
          [330, 45],
          [323, 45],
        ],
      ],
      6,
    ),
    ...terrace,
  };
  /** The corridor as a read hands it over: the tiles' buildings joined, through `worldCorridorOf`. */
  const read = (buildings: readonly BuildingFeature[]): WorldCorridor => ({
    ...worldCorridorOf(fixture.corridor.routeId, origin, [], {
      landUse: fixture.corridor.landUse,
      buildings,
      paths: [],
      streets: [],
      places: [],
    }),
    covered: fixture.corridor.covered,
    coveredBoxes: fixture.corridor.coveredBoxes,
  });

  it('control: the copies, handed to the planner as they are, lose walls', () => {
    const copies = [whole, shifted, clipped];
    const plans = plansOf(copies, { ...fixture.corridor, buildings: copies });
    expect(plans).toHaveLength(3);
    const least = Math.min(...plans.flatMap((plan) => walledShares(plan, whole.rings).flat()));
    expect(least).toBeLessThan(0.5);
  });

  it('plans one building, and walls every edge of it', () => {
    const plans = plansOf([], read([whole, shifted, clipped]));
    expect(plans).toHaveLength(1);
    const plan = plans[0] as FootprintPlan;
    for (const share of walledShares(plan, [plan.footprint]).flat()) {
      expect(share).toBeGreaterThan(0.95);
    }
  });

  it('keeps a whole copy whichever tile was read first', () => {
    const plans = plansOf([], read([clipped, shifted, whole]));
    expect(plans).toHaveLength(1);
    // The clipped copy is 7 m of the 14: the one kept is a whole one.
    expect(Math.abs(twiceArea((plans[0] as FootprintPlan).footprint)) / 2).toBeGreaterThan(130);
    const plan = plans[0] as FootprintPlan;
    for (const share of walledShares(plan, [plan.footprint]).flat()) {
      expect(share).toBeGreaterThan(0.95);
    }
  });

  it('control: two houses of a row that share a wall are both planned', () => {
    const next: BuildingFeature = {
      ...buildingBeside(profile, origin, [rectangleBeside(344, 40, 14, 10)], 6),
      ...terrace,
    };
    expect(plansOf([], read([whole, next]))).toHaveLength(2);
  });

  it('control: a courtyard shape and a polygon well apart are both planned', () => {
    const round = buildingBeside(profile, origin, [polygonBeside(450, 40, 6, 12)]);
    expect(plansOf([], read([whole, round]))).toHaveLength(2);
  });
});
