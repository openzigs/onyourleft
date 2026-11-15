// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Nothing drawn across a mapped house's driveway — #2428's second half. The
 * owner's tablet ride of 2026-11-10 showed a roadside hedge row drawn
 * straight across the end of a grey driveway (#1588) running from the road
 * to a mapped house. The first half of #2428 cleared the scenery off mapped
 * side roads; a #1588 driveway is not one. Its trees, shrubs and rocks were
 * kept 1 m off it as points (`mapped-buildings.ts`
 * §`DRIVEWAY_MARGIN_METRES`), and no wall, hedge or fence was kept off it at
 * all.
 *
 * Read back through `sceneFrame`, against each driveway's own drawn
 * triangles (`FootprintPlan.triangles.driveway`), which is what the rider
 * sees: a row of wide houses on residential land 15 m back, each with a
 * garage and a driveway out across the verge, and farmland opposite.
 */

import { describe, expect, it } from 'vitest';

import { metres } from '@onyourleft/domain';
import type { BuildingFeature } from '@onyourleft/map-features';

import { SIDE_ROAD_STRUCTURE_MARGIN_METRES } from './cross-streets';
import { FOLIAGE_SWAY_METRES } from './foliage-light';
import { FOOTPRINT_VERTEX_FLOATS, footprintPlans, type FootprintPlan } from './footprint-buildings';
import { buildingBeside, landBeside, rectangleBeside } from './footprint-fixtures-testing';
import { landClassMask } from './land-class';
import {
  clearOfDriveways,
  clearOfMappedBuildings,
  DRIVEWAY_MARGIN_METRES,
  mappedBuildingsOf,
  onMappedGround,
  type MappedBuildings,
} from './mapped-buildings';
import { sceneryReach } from './near-field';
import { northRoute } from './route-fixtures-testing';
import { SCATTER_SCALE_HIGHEST, type ScatterItem } from './scatter';
import { sceneFrame, sideRoadNaturalMargin } from './scene';
import { SETTLEMENT_MARGIN_METRES, STRUCTURE_FOOTPRINTS } from './settlements';
import { atStartLine } from './simulation';
import { corridorOrigin } from './terrain';
import type { WorldCorridor } from './world-data/corridor';

const PROFILE = northRoute(3_000, () => 10);
const ORIGIN = corridorOrigin(PROFILE);
const START = atStartLine(PROFILE);

/** Ten wide two-storey houses 30 m out, every 40 m from 1 km: wide enough for a garage. */
const HOUSES: readonly BuildingFeature[] = Array.from({ length: 10 }, (_, index) =>
  buildingBeside(PROFILE, ORIGIN, [rectangleBeside(1_000 + index * 40, 30, 13, 8)], 6),
);

const land = (kind: string, near: number, far: number) =>
  landBeside(PROFILE, ORIGIN, 'landuse', kind, 500, 2_000, near, far);

const CORRIDOR: WorldCorridor = {
  routeId: 'driveway-clearance-fixture',
  origin: ORIGIN,
  covered: () => true,
  coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
  // The houses' land from 15 m back, so the verge in front of them is the
  // countryside's and is hedged; farmland across the road.
  landUse: [land('residential', 15, 300), land('farmland', -300, -4)],
  buildings: HOUSES,
  paths: [],
  streets: [],
};
const LAND = landClassMask(CORRIDOR);
const PLANS = footprintPlans(CORRIDOR, LAND, PROFILE, ORIGIN).plans;
const DRIVEWAYS = PLANS.filter((plan) => plan.driveway.length > 0);
const MAPPED = mappedBuildingsOf(PLANS);
/** THE CONTROL: the same plans, drawn the same, with no driveway's outline to clear. */
const UNCLEARED = mappedBuildingsOf(
  PLANS.map((plan) => ({ ...plan, driveway: new Float32Array(0) })),
);

function frameAt(distance: number, mapped: MappedBuildings) {
  return sceneFrame({
    profile: PROFILE,
    origin: ORIGIN,
    state: { ...START, ride: { ...START.ride, distance: metres(distance) } },
    worldCorridor: CORRIDOR,
    landClass: LAND,
    mappedBuildings: mapped,
  });
}

function toSegment(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const span = dx * dx + dz * dz;
  const t = span > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / span)) : 0;
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}

/** How far `(x, z)` is from a driveway's drawn paving in plan, from its own triangles: 0 on it. */
function toPaving(plan: FootprintPlan, x: number, z: number): number {
  const floats = plan.triangles.driveway;
  const stride = FOOTPRINT_VERTEX_FLOATS;
  let nearest = Number.POSITIVE_INFINITY;
  for (let at = 0; at + 3 * stride <= floats.length; at += 3 * stride) {
    const ax = floats[at] as number;
    const az = floats[at + 2] as number;
    const bx = floats[at + stride] as number;
    const bz = floats[at + stride + 2] as number;
    const cx = floats[at + 2 * stride] as number;
    const cz = floats[at + 2 * stride + 2] as number;
    const d1 = (x - bx) * (az - bz) - (ax - bx) * (z - bz);
    const d2 = (x - cx) * (bz - cz) - (bx - cx) * (z - cz);
    const d3 = (x - ax) * (cz - az) - (cx - ax) * (z - az);
    if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return 0;
    nearest = Math.min(
      nearest,
      toSegment(x, z, ax, az, bx, bz),
      toSegment(x, z, bx, bz, cx, cz),
      toSegment(x, z, cx, cz, ax, az),
    );
  }
  return nearest;
}

/**
 * How far off the paving a tree, shrub or rock must stand: its drawn reach,
 * the larger world's at its scale, with the realistic foliage's sway — the
 * side roads' rule (`side-road-mouths.test.ts`), stated again here rather
 * than read from the code under test.
 */
function naturalClearance(item: ScatterItem): number {
  // The box is square in plan, so its corner is √2 times its half-width.
  const reach =
    Math.SQRT2 *
    Math.max(sceneryReach(item.kind, 'realistic').x, sceneryReach(item.kind, 'stylised').x);
  return reach * item.scale + (item.kind === 'rock' ? 0 : FOLIAGE_SWAY_METRES);
}

/** How far a structure's whole footprint is from a driveway's paving, sampled every quarter-metre. */
function structureToPaving(item: ScatterItem, plan: FootprintPlan): number {
  const footprint = STRUCTURE_FOOTPRINTS[item.kind as keyof typeof STRUCTURE_FOOTPRINTS];
  const cos = Math.cos(item.rotation);
  const sin = Math.sin(item.rotation);
  let nearest = Number.POSITIVE_INFINITY;
  const stepsX = Math.max(1, Math.ceil((2 * footprint.x) / 0.25));
  const stepsZ = Math.max(1, Math.ceil((footprint.front - footprint.back) / 0.25));
  for (let i = 0; i <= stepsX; i += 1) {
    for (let j = 0; j <= stepsZ; j += 1) {
      const lx = -footprint.x + (2 * footprint.x * i) / stepsX;
      const lz = footprint.back + ((footprint.front - footprint.back) * j) / stepsZ;
      nearest = Math.min(
        nearest,
        toPaving(plan, item.x + lx * cos + lz * sin, item.z - lx * sin + lz * cos),
      );
    }
  }
  return nearest;
}

/** Everything in a ride past the houses, a frame every 20 m, once an item. */
function rideItems(mapped: MappedBuildings): readonly ScatterItem[] {
  const seen = new Map<string, ScatterItem>();
  for (let distance = 950; distance <= 1_450; distance += 20) {
    for (const item of frameAt(distance, mapped).scatter) {
      seen.set(`${item.kind} ${String(item.x)} ${String(item.z)}`, item);
    }
  }
  return [...seen.values()];
}

/** Every item whose drawn reach or footprint lands on a driveway's paving, described. */
function across(items: readonly ScatterItem[]): string[] {
  const found: string[] = [];
  for (const item of items) {
    const structure = item.kind in STRUCTURE_FOOTPRINTS;
    for (const plan of DRIVEWAYS) {
      // A centimetre of slack for single precision.
      const off = structure ? structureToPaving(item, plan) : toPaving(plan, item.x, item.z);
      const clearance = structure ? SIDE_ROAD_STRUCTURE_MARGIN_METRES : naturalClearance(item);
      if (off < clearance - 0.01) {
        found.push(`${item.kind} ×${item.scale.toFixed(2)}: ${off.toFixed(2)} m off`);
      }
    }
  }
  return found;
}

const RIDE = rideItems(MAPPED);
const CONTROL = rideItems(UNCLEARED);

describe('nothing drawn across a mapped house’s driveway — #2428', () => {
  it('draws no hedge, fence, tree, shrub or rock reaching onto a driveway', () => {
    expect(DRIVEWAYS.length).toBeGreaterThan(5);
    expect(across(RIDE)).toEqual([]);
  });

  it('control: with no driveway to clear, the verge’s hedge row is drawn across them', () => {
    const crossing = across(CONTROL);
    expect(crossing.some((each) => each.startsWith('hedge'))).toBe(true);
  });

  it('takes out only the pieces across a driveway, and leaves the rest of the row standing', () => {
    const key = (item: ScatterItem) => `${item.kind} ${String(item.x)} ${String(item.z)}`;
    const kept = new Set(RIDE.map(key));
    let beside = 0;
    for (const item of CONTROL) {
      if (!(item.kind in STRUCTURE_FOOTPRINTS)) continue;
      const nearest = Math.min(...DRIVEWAYS.map((plan) => structureToPaving(item, plan)));
      if (nearest < SIDE_ROAD_STRUCTURE_MARGIN_METRES + 0.01) {
        expect(kept.has(key(item)), key(item)).toBe(false);
        continue;
      }
      // Clear of every driveway: it stands, whether the driveway is cleared or not.
      expect(kept.has(key(item)), key(item)).toBe(true);
      // A hedge piece is 8 m long: one within a piece of a driveway is the row's end.
      if (item.kind === 'hedge' && nearest < 8) beside += 1;
    }
    expect(beside).toBeGreaterThan(0);
  });

  it('keeps the trees off a driveway by their reach, not the old 1 m', () => {
    // A tall fir a metre and a half off the paving's side: by the old 1 m point margin it stood.
    const plan = DRIVEWAYS[0] as FootprintPlan;
    const ring = plan.driveway;
    const startX = ((ring[0] as number) + (ring[2] as number)) / 2;
    const startZ = ((ring[1] as number) + (ring[3] as number)) / 2;
    const endX = ((ring[4] as number) + (ring[6] as number)) / 2;
    const endZ = ((ring[5] as number) + (ring[7] as number)) / 2;
    const width = Math.hypot(
      (ring[2] as number) - (ring[0] as number),
      (ring[3] as number) - (ring[1] as number),
    );
    const acrossX = ((ring[2] as number) - (ring[0] as number)) / width;
    const acrossZ = ((ring[3] as number) - (ring[1] as number)) / width;
    const midX = (startX + endX) / 2 + acrossX * (width / 2 + 1.5);
    const midZ = (startZ + endZ) / 2 + acrossZ * (width / 2 + 1.5);
    const fir: ScatterItem = {
      kind: 'tree-conifer',
      x: midX,
      y: 0,
      z: midZ,
      rotation: 0,
      scale: SCATTER_SCALE_HIGHEST,
      variant: 0,
    };
    const off = toPaving(plan, fir.x, fir.z);
    expect(off).toBeGreaterThan(DRIVEWAY_MARGIN_METRES);
    expect(off).toBeLessThan(naturalClearance(fir));
    // What the scene hands in: the fir's reach. Its control: the old 1 m.
    expect(clearOfMappedBuildings([fir], MAPPED, sideRoadNaturalMargin)).toStrictEqual([]);
    expect(clearOfMappedBuildings([fir], MAPPED)).toStrictEqual([fir]);
  });

  it('finds a driveway by the widest reach, past the one cell the item stands in', () => {
    // A broadleaf at the top of its scale reaches past the settlement margin
    // each plan is listed by, so the cells round it are looked in too.
    const broadleaf: ScatterItem = {
      kind: 'tree-broadleaf',
      x: 0,
      y: 0,
      z: 0,
      rotation: 0,
      scale: SCATTER_SCALE_HIGHEST,
      variant: 0,
    };
    const widest = sideRoadNaturalMargin(broadleaf);
    expect(widest).toBeGreaterThan(SETTLEMENT_MARGIN_METRES);
    let missed = 0;
    let asked = 0;
    for (const plan of DRIVEWAYS) {
      const xs = Array.from(
        { length: plan.driveway.length / 2 },
        (_, k) => plan.driveway[k * 2] as number,
      );
      const zs = Array.from(
        { length: plan.driveway.length / 2 },
        (_, k) => plan.driveway[k * 2 + 1] as number,
      );
      for (let x = Math.min(...xs) - widest; x <= Math.max(...xs) + widest; x += 0.25) {
        for (let z = Math.min(...zs) - widest; z <= Math.max(...zs) + widest; z += 0.25) {
          if (toPaving(plan, x, z) > widest - 0.02) continue;
          asked += 1;
          if (!onMappedGround(MAPPED, x, z, widest)) missed += 1;
        }
      }
    }
    expect(asked).toBeGreaterThan(1_000);
    expect(missed).toBe(0);
  });
});

describe('the driveway clearance at the edges of its index — #2428', () => {
  // One plan made by hand: a 4 m square house at (33.99, 16) and a hair-thin
  // driveway 22 m along +x from it, so its far end is the plan's whole reach
  // (24 m) straight along an axis. The index lists the plan in the cells its
  // reach and the 6 m settlement margin touch: up to x = 63.99, cell 1.
  const house = PLANS[0] as FootprintPlan;
  const plan: FootprintPlan = {
    ...house,
    centroid: { ...house.centroid, x: 33.99, z: 16 },
    footprint: Float32Array.of(31.99, 14, 35.99, 14, 35.99, 18, 31.99, 18),
    driveway: Float32Array.of(35.99, 15.999, 35.99, 16.001, 57.99, 16.001, 57.99, 15.999),
  };
  const indexed = mappedBuildingsOf([plan]);
  const hedge = (x: number, z: number): ScatterItem => ({
    kind: 'hedge',
    x,
    y: 0,
    z,
    // Its length along +x.
    rotation: Math.PI / 2,
    scale: 1,
    variant: 0,
  });

  it('finds a driveway in the next cell, by a reach past the settlement margin', () => {
    // 6.04 m past the driveway's end: x = 64.03, cell 2, where the plan is not listed.
    expect(onMappedGround(indexed, 64.03, 16, SETTLEMENT_MARGIN_METRES + 0.06)).toBe(true);
    // Control: past that reach it is clear.
    expect(onMappedGround(indexed, 64.1, 16, SETTLEMENT_MARGIN_METRES + 0.06)).toBe(false);
  });

  it('drops a hedge piece whose end lies across the driveway’s, its middle well past it', () => {
    // An 8 m piece from 3.5 m past the end: its back 0.5 m over the paving,
    // its middle 27.5 m from the house, past the plan's reach.
    const across = hedge(57.99 + 3.5, 16);
    expect(clearOfDriveways([across], indexed)).toStrictEqual([]);
    // Control: a piece wholly past the end and its margin stands.
    const past = hedge(57.99 + 4.6, 16);
    expect(clearOfDriveways([past], indexed)).toStrictEqual([past]);
  });

  it('drops a hedge piece beside a driveway within the structures’ 0.5 m, not one beyond it', () => {
    // Alongside the driveway, its near side 0.3 m off it.
    const near = hedge(47, 16.001 + 0.55 + 0.3);
    expect(clearOfDriveways([near], indexed)).toStrictEqual([]);
    const clear = hedge(47, 16.001 + 0.55 + 0.7);
    expect(clearOfDriveways([clear], indexed)).toStrictEqual([clear]);
  });
});
