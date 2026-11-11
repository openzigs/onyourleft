// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Nothing drawn across a side road's mouth — #2428. The owner, riding the
 * realistic world on the tablet, saw shrubs across street crossings and
 * driveways. Every tree, shrub and rock was kept 1.5 m off a side road's
 * edge (`cross-streets.ts` §`SIDE_ROAD_SCENERY_MARGIN_METRES`), measured as
 * a point, where it is drawn reaching up to 5.1 m from where it stands: a
 * fir at the top of its scale (`near-field.ts` §`sceneryReach`). So its
 * branches lay across the side road.
 *
 * Read back through `sceneFrame` and each side road's own drawn triangles,
 * which is what the rider sees: a ride past a mapped side street and a
 * mapped driveway (`minor_road` with a `driveway` detail, as Protomaps
 * writes `service=driveway`), every frame, every item.
 */

import { describe, expect, it } from 'vitest';

import { metres } from '@onyourleft/domain';
import type { StreetFeature } from '@onyourleft/map-features';

import {
  SIDE_ROAD_SCENERY_MARGIN_METRES,
  SIDE_ROAD_STRUCTURE_MARGIN_METRES,
  type SideRoad,
} from './cross-streets';
import { FOLIAGE_SWAY_METRES } from './foliage-light';
import { sceneryReach } from './near-field';
import { northRoute } from './route-fixtures-testing';
import { SCATTER_SCALE_HIGHEST, type ScatterItem } from './scatter';
import { sceneFrame, sideRoadNaturalMargin } from './scene';
import { STRUCTURE_FOOTPRINTS } from './settlements';
import { atStartLine } from './simulation';
import { corridorOrigin, drawnRoadFrame } from './terrain';
import type { WorldCorridor } from './world-data/corridor';

/** Six kilometres of level, low farmland running due north. */
const FARMLAND = northRoute(6_000, () => 40);
const ORIGIN = corridorOrigin(FARMLAND);
const START = atStartLine(FARMLAND);

/** A straight street from the route's centreline at `along`, `angle` degrees from forward, on `side`. */
function leaving(
  along: number,
  side: 1 | -1,
  angle: number,
  length: number,
  kindDetail: string,
): StreetFeature {
  const here = drawnRoadFrame(FARMLAND, ORIGIN, along);
  if (here === undefined) throw new Error(`no road at ${String(along)}`);
  const forwardX = here.normalZ;
  const forwardZ = -here.normalX;
  const radians = (angle * Math.PI) / 180;
  const dx = forwardX * Math.cos(radians) + here.normalX * side * Math.sin(radians);
  const dz = forwardZ * Math.cos(radians) + here.normalZ * side * Math.sin(radians);
  return {
    kind: 'minor_road',
    kindDetail,
    grade: 'ground',
    line: Float32Array.from([here.x, here.z, here.x + dx * length, here.z + dz * length]),
  };
}

/** Every 300 m from 1.2 km: a side street at 60° on the right, and a driveway square on the left 40 m on. */
const PAIRS = Array.from({ length: 10 }, (_, index) => 1_200 + index * 300);
const STREETS: readonly StreetFeature[] = PAIRS.flatMap((along) => [
  leaving(along, 1, 60, 120, 'residential'),
  leaving(along + 40, -1, 90, 25, 'driveway'),
]);

function corridorOf(streets: readonly StreetFeature[]): WorldCorridor {
  return {
    routeId: 'side-road-mouths-fixture',
    origin: ORIGIN,
    covered: () => true,
    coveredBoxes: [],
    landUse: [],
    buildings: [],
    paths: [],
    streets,
  };
}

function frameAt(distance: number, streets: readonly StreetFeature[]) {
  return sceneFrame({
    profile: FARMLAND,
    origin: ORIGIN,
    state: { ...START, ride: { ...START.ride, distance: metres(distance) } },
    worldCorridor: corridorOf(streets),
  });
}

function toSegment(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const span = dx * dx + dz * dz;
  const t = span > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / span)) : 0;
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}

/** How far `(x, z)` is from a side road's drawn tarmac in plan, from its own triangles: 0 on it. */
function toTarmac(road: SideRoad, x: number, z: number): number {
  const { positions, indices } = road.mesh;
  let nearest = Number.POSITIVE_INFINITY;
  for (let at = 0; at + 2 < indices.length; at += 3) {
    const p: number[] = [];
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = indices[at + corner] as number;
      p.push(positions[vertex * 3] as number, positions[vertex * 3 + 2] as number);
    }
    const [ax, az, bx, bz, cx, cz] = p as [number, number, number, number, number, number];
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
 * The clearance this file states: how far off a side road's tarmac an item
 * must stand, or `undefined` for a structure. A tree, shrub or rock: its
 * drawn reach, the larger world's at its scale, with the realistic foliage's
 * sway.
 */
function naturalClearance(item: ScatterItem): number | undefined {
  if (item.kind in STRUCTURE_FOOTPRINTS) return undefined;
  // The box is square in plan, so its corner is √2 times its half-width.
  const reach =
    Math.SQRT2 *
    Math.max(sceneryReach(item.kind, 'realistic').x, sceneryReach(item.kind, 'stylised').x);
  const sway = item.kind === 'rock' ? 0 : FOLIAGE_SWAY_METRES;
  // Never less than the old margin: a small shrub still stands that far off.
  return Math.max(SIDE_ROAD_SCENERY_MARGIN_METRES, reach * item.scale + sway);
}

/** How far a structure's whole footprint is from a side road's tarmac, sampled every half-metre. */
function structureToTarmac(item: ScatterItem, road: SideRoad): number {
  const footprint = STRUCTURE_FOOTPRINTS[item.kind as keyof typeof STRUCTURE_FOOTPRINTS];
  const cos = Math.cos(item.rotation);
  const sin = Math.sin(item.rotation);
  let nearest = Number.POSITIVE_INFINITY;
  const stepsX = Math.max(1, Math.ceil((2 * footprint.x) / 0.5));
  const stepsZ = Math.max(1, Math.ceil((footprint.front - footprint.back) / 0.5));
  for (let i = 0; i <= stepsX; i += 1) {
    for (let j = 0; j <= stepsZ; j += 1) {
      const lx = -footprint.x + (2 * footprint.x * i) / stepsX;
      const lz = footprint.back + ((footprint.front - footprint.back) * j) / stepsZ;
      nearest = Math.min(
        nearest,
        toTarmac(road, item.x + lx * cos + lz * sin, item.z - lx * sin + lz * cos),
      );
    }
  }
  return nearest;
}

/** A ride past every pair, a frame every 20 m. */
const RIDE = Array.from({ length: 150 }, (_, index) => (PAIRS[0] as number) - 200 + index * 20).map(
  (distance) => ({ distance, frame: frameAt(distance, STREETS) }),
);

/**
 * The sweep below walks 150 frames and measures every item in each against
 * every mapped side road in it, so it is the file's one slow case, and under
 * coverage on a slow runner it passed Vitest's 5 s default, as
 * `docs/agents/ci.md` §4c expects of such a case: it timed out in nightly run
 * 43008116660 (2026-11-11, an Intel Xeon 8370C), 5 666 ms by Vitest's own
 * count, the file's three cases 7 561 ms. Locally it takes 1.2 s, and 2.2 s
 * under coverage. Set to about three times the slowest figure; the figures
 * from the three CI readings of #2471 are in that issue.
 */
const SWEEP = { timeout: 20_000 } as const;

describe('nothing drawn across a side road or a driveway at its mouth — #2428', () => {
  it('draws no tree, shrub, rock or hedge onto a side street or a driveway', SWEEP, () => {
    const across = new Set<string>();
    const kinds = new Set<string>();
    // An item and a road are measured once, however many frames hold both.
    const measured = new Set<string>();
    let driveways = 0;
    let streets = 0;
    for (const { frame } of RIDE) {
      const mapped = frame.sideRoads.filter((road) => road.junction.source === 'mapped');
      driveways += mapped.filter((road) =>
        road.junction.arms.some((arm) => arm.widthClass === 'service'),
      ).length;
      streets += mapped.filter((road) =>
        road.junction.arms.some((arm) => arm.widthClass === 'minor'),
      ).length;
      for (const item of frame.scatter) {
        const clearance = naturalClearance(item);
        for (const road of mapped) {
          const at = `${item.kind} at ${String(item.x)}, ${String(item.z)} by ${String(road.junction.along)}`;
          if (measured.has(at)) continue;
          measured.add(at);
          if (clearance === undefined) {
            if (structureToTarmac(item, road) < SIDE_ROAD_STRUCTURE_MARGIN_METRES - 0.01) {
              across.add(at);
            }
            continue;
          }
          const off = toTarmac(road, item.x, item.z);
          if (off < clearance + 0.5) kinds.add(item.kind);
          if (off < clearance - 0.01)
            across.add(`${at}: ${off.toFixed(2)} m off, ×${item.scale.toFixed(2)}`);
        }
      }
    }
    // The fixture: both kinds of side road in view, and scenery standing near them.
    expect(driveways).toBeGreaterThan(0);
    expect(streets).toBeGreaterThan(0);
    expect(kinds.size).toBeGreaterThan(1);
    expect([...across]).toEqual([]);
  });

  it('never stands a small shrub or a stone closer than the old 1.5 m', () => {
    const at = (kind: ScatterItem['kind'], scale: number): ScatterItem => ({
      kind,
      x: 0,
      y: 0,
      z: 0,
      rotation: 0,
      scale,
      variant: 0,
    });
    expect(sideRoadNaturalMargin(at('shrub', 0.7))).toBe(SIDE_ROAD_SCENERY_MARGIN_METRES);
    expect(sideRoadNaturalMargin(at('rock', 0.5))).toBe(SIDE_ROAD_SCENERY_MARGIN_METRES);
    // A tall fir reaches past it, by its corner and not its half-width.
    expect(sideRoadNaturalMargin(at('tree-conifer', 1.4))).toBeGreaterThan(
      sceneryReach('tree-conifer', 'realistic').x * 1.4 * 1.4,
    );
  });

  it('leaves the scenery away from the side roads as it was', () => {
    // The same frames with no streets mapped: everything further than the
    // widest clearance from the side roads stands in both.
    const widest =
      Math.SQRT2 * sceneryReach('tree-conifer', 'realistic').x * SCATTER_SCALE_HIGHEST +
      FOLIAGE_SWAY_METRES +
      1;
    let compared = 0;
    for (const { distance, frame } of RIDE.filter((_, index) => index % 3 === 0)) {
      const bare = frameAt(distance, []);
      const mapped = frame.sideRoads.filter((road) => road.junction.source === 'mapped');
      const key = (item: ScatterItem) => `${item.kind} ${String(item.x)} ${String(item.z)}`;
      const kept = new Set(frame.scatter.map(key));
      for (const item of bare.scatter) {
        if (mapped.some((road) => toTarmac(road, item.x, item.z) < widest)) continue;
        compared += 1;
        expect(kept.has(key(item)), key(item)).toBe(true);
      }
    }
    expect(compared).toBeGreaterThan(1_000);
  });
});
