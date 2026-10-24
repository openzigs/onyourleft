// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A village's kerbed pavements — #1535. Read back through `streetsAt`, the
 * function `scene.ts` puts on every frame, and through `sceneFrame` itself:
 * where a pavement is, where none is, what it may never stand on, and what one
 * costs.
 */

import { describe, expect, it } from 'vitest';

import { elevationAt, metres, type RouteProfile } from '@onyourleft/domain';

import type { PavementSides } from './footways';
import { NO_LAND_CLASS, type LandClassMask } from './land-class';
import { terrainHeightAt } from './landform';
import { REALISTIC_STREET_TRIANGLES } from './realistic-budget';
import { distanceToDrawnRoad, nearestOnDrawnRoad, type NearestOnRoad } from './road-grid';
import { circuitRoute, hairpinRoute, northRoute, valleyRoute } from './route-fixtures-testing';
import { scatterSeed, type ScatterItem } from './scatter';
import { sceneFrame } from './scene';
import {
  clearOfSettlements,
  onSettlementGround,
  PLOT_METRES,
  settlementFootprintsAt,
  siteAt,
  siteSpacing,
  villagePlots,
  VILLAGE_METRES,
  type Plot,
  type Site,
} from './settlements';
import { atStartLine } from './simulation';
import {
  BENCH_SETBACK_METRES,
  BIN_BESIDE_METRES,
  BOLLARD_ENDS_METRES,
  BOLLARD_INSET_METRES,
  DROPPED_KERB_HEIGHT_METRES,
  DROPPED_KERB_METRES,
  DOOR_PATH_FALL,
  DOOR_PATH_LIFT_METRES,
  DOOR_PATH_TRIANGLES_PER_VILLAGE,
  DOOR_PATH_WIDTH_METRES,
  doorPathFor,
  FURNITURE_KINDS,
  furnitureAlong,
  KERB_HEIGHT_METRES,
  KERB_LATERAL_METRES,
  LAMP_SETBACK_METRES,
  LAMP_SPACING_METRES,
  PAVEMENT_END_INSET_METRES,
  PAVEMENT_TRIANGLES_PER_VILLAGE,
  PAVEMENT_WIDTH_METRES,
  pavementAlong,
  streetsAt,
  type DoorPath,
  type FurnitureItem,
  type FurnitureKind,
  type PavementMesh,
  type VillageStreet,
} from './streets';
import { corridorOrigin, drawnRoadFrame } from './terrain';
import { inWater, waterways } from './waterways';
import { VILLAGE_MOUTH_HALF_METRES } from './cross-streets';

/** Six kilometres of level, low farmland running due north: `x` is across, `z` along. */
const FARMLAND = northRoute(6_000, () => 40);

/**
 * Where the drawn road is at an odometer reading. `z` tracks the odometer on a
 * road running north but not to the millimetre (the fixture's degrees and the
 * corridor's projection differ by about 0.1 %), so a test compares positions
 * with positions rather than with distances.
 */
function roadAt(profile: RouteProfile, along: number) {
  const frame = drawnRoadFrame(profile, corridorOrigin(profile), along);
  if (frame === undefined) throw new Error(`no road at ${String(along)}`);
  return frame;
}

/** The odometer reading at which a road running north reaches `z`. */
function alongAt(profile: RouteProfile, z: number): number {
  let low = 0;
  let high: number = profile.totalDistance;
  for (let step = 0; step < 60; step += 1) {
    const middle = (low + high) / 2;
    if (roadAt(profile, middle).z < z) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

/** Which side of a road running north a vertex is on: +1 on the road's right (its normal). */
function sideOf(profile: RouteProfile, vertex: { readonly x: number }): 1 | -1 {
  return Math.sign(vertex.x) === Math.sign(roadAt(profile, 0).normalX) ? 1 : -1;
}

function streetsOf(
  profile: RouteProfile,
  from = 0,
  to: number = profile.totalDistance,
): readonly VillageStreet[] {
  return streetsAt(profile, corridorOrigin(profile), scatterSeed(profile), from, to);
}

/** Every site of a route that holds a settlement. */
function sitesOf(profile: RouteProfile): readonly Site[] {
  const { sites } = siteSpacing(profile);
  const found: Site[] = [];
  for (let index = 0; index < sites; index += 1) {
    const site = siteAt(profile, scatterSeed(profile), index);
    if (site !== undefined) found.push(site);
  }
  return found;
}

/** Where a street's village has its crossroads (#1565): the `z` of its centre, on a road running north. */
function crossroadsZ(profile: RouteProfile, street: VillageStreet): number {
  const site = siteAt(profile, scatterSeed(profile), street.wrappedSite) as Site;
  return roadAt(profile, site.centre).z;
}

/** Every vertex of a mesh, with its normal. */
function vertices(mesh: PavementMesh) {
  const all = [];
  for (let at = 0; at < mesh.positions.length / 3; at += 1) {
    all.push({
      x: mesh.positions[at * 3] as number,
      y: mesh.positions[at * 3 + 1] as number,
      z: mesh.positions[at * 3 + 2] as number,
      nx: mesh.normals[at * 3] as number,
      ny: mesh.normals[at * 3 + 1] as number,
      nz: mesh.normals[at * 3 + 2] as number,
    });
  }
  return all;
}

/** The top of the pavement: the vertices whose normal is straight up. */
function topOf(mesh: PavementMesh) {
  return vertices(mesh).filter((vertex) => vertex.ny > 0.999);
}

describe('where a pavement goes — #1535', () => {
  const villages = sitesOf(FARMLAND).filter((site) => site.kind === 'village');
  const farms = sitesOf(FARMLAND).filter((site) => site.kind === 'farm');
  const streets = streetsOf(FARMLAND);

  it('lays one street for every village, and none for a farmstead', () => {
    // Non-vacuity: the fixture has villages, and farmsteads to refuse.
    expect(villages.length).toBeGreaterThan(0);
    expect(farms.length).toBeGreaterThan(0);
    expect(streets.map((street) => street.wrappedSite).sort()).toEqual(
      villages.map((site) => site.wrappedSite).sort(),
    );
  });

  it('lays each side exactly along the plots built on that side, a metre inside them', () => {
    let sides = 0;
    for (const village of villages) {
      const street = streets.find((each) => each.wrappedSite === village.wrappedSite);
      expect(street, `site ${String(village.wrappedSite)}`).toBeDefined();
      const top = topOf((street as VillageStreet).pavement);
      for (const side of [1, -1] as const) {
        const plots = villagePlots(scatterSeed(FARMLAND), village)
          .filter((plot) => plot.side === side)
          .map((plot) => plot.along);
        const mine = top
          .filter((vertex) => sideOf(FARMLAND, vertex) === side)
          .map((vertex) => vertex.z);
        if (plots.length === 0) {
          expect(mine).toEqual([]);
          continue;
        }
        sides += 1;
        const from = Math.min(...plots) - PLOT_METRES / 2 + PAVEMENT_END_INSET_METRES;
        const to = Math.max(...plots) + PLOT_METRES / 2 - PAVEMENT_END_INSET_METRES;
        expect(Math.min(...mine)).toBeCloseTo(roadAt(FARMLAND, from).z, 3);
        expect(Math.max(...mine)).toBeCloseTo(roadAt(FARMLAND, to).z, 3);
      }
    }
    expect(sides).toBeGreaterThan(1);
  });

  it('puts no pavement anywhere outside a village', () => {
    // Every vertex of every street lies along its own village, and a stretch
    // with no village in it has no street at all.
    for (const street of streets) {
      const village = villages.find((site) => site.wrappedSite === street.wrappedSite) as Site;
      const first = roadAt(FARMLAND, village.centre - village.half - PLOT_METRES / 2).z;
      const last = roadAt(FARMLAND, village.centre + village.half + PLOT_METRES / 2).z;
      for (const vertex of vertices(street.pavement)) {
        expect(vertex.z).toBeGreaterThanOrEqual(first);
        expect(vertex.z).toBeLessThanOrEqual(last);
      }
    }
    const first = villages[0] as Site;
    const clear = first.centre - first.half - PLOT_METRES - 1;
    const previous = villages.filter((site) => site.centre < first.centre);
    expect(previous).toEqual([]);
    expect(clear).toBeGreaterThan(0);
    expect(streetsOf(FARMLAND, 0, clear)).toEqual([]);
    // The control: the same call reaching into the village finds its street.
    expect(streetsOf(FARMLAND, 0, first.centre).length).toBe(1);
  });

  it('carries the streets in view on the frame, and none away from a village', () => {
    const profile = FARMLAND;
    const origin = corridorOrigin(profile);
    const start = atStartLine(profile);
    const at = (distance: number) =>
      sceneFrame({
        profile,
        origin,
        state: { ...start, ride: { ...start.ride, distance: metres(distance) } },
      });
    const village = villages[0] as Site;
    expect(at(village.centre).streets.map((street) => street.wrappedSite)).toContain(
      village.wrappedSite,
    );
    // Open country: a ride whose whole corridor (60 m behind, 400 m ahead,
    // with room) touches no village — found from the sites, not the streets.
    const open = [...Array(120).keys()]
      .map((step) => step * 50)
      .find((distance) =>
        villages.every(
          (site) =>
            site.centre + site.half + PLOT_METRES < distance - 100 ||
            site.centre - site.half - PLOT_METRES > distance + 500,
        ),
      );
    expect(open).toBeDefined();
    expect(at(open as number).streets).toEqual([]);
  });
});

describe('what a pavement is — #1535', () => {
  const street = streetsOf(FARMLAND)[0] as VillageStreet;
  const origin = corridorOrigin(FARMLAND);

  it('stands on the road’s edge, a kerb high and two metres wide', () => {
    const road = elevationAt(FARMLAND, metres(0)) - origin.elevation;
    const top = topOf(street.pavement);
    expect(top.length).toBeGreaterThan(0);
    // A kerb high, except at the dropped kerb either side of the crossroads (#1565).
    const centre = crossroadsZ(FARMLAND, street);
    const dropped = VILLAGE_MOUTH_HALF_METRES + DROPPED_KERB_METRES + 0.01;
    for (const vertex of top) {
      expect(vertex.y).toBeCloseTo(
        road +
          (Math.abs(vertex.z - centre) <= dropped
            ? DROPPED_KERB_HEIGHT_METRES
            : KERB_HEIGHT_METRES),
        5,
      );
    }
    expect(
      top.some((vertex) => Math.abs(vertex.y - road - DROPPED_KERB_HEIGHT_METRES) < 1e-5),
    ).toBe(true);
    const across = top.map((vertex) => Math.abs(vertex.x));
    expect(Math.min(...across)).toBeCloseTo(KERB_LATERAL_METRES, 4);
    expect(Math.max(...across)).toBeCloseTo(KERB_LATERAL_METRES + PAVEMENT_WIDTH_METRES, 4);
    // The kerb's face looks at the road, from the road's height to the kerb's.
    const kerb = vertices(street.pavement).filter(
      (vertex) => Math.abs(vertex.ny) < 1e-6 && vertex.nx * Math.sign(vertex.x) < -0.999,
    );
    expect(kerb.length).toBeGreaterThan(0);
    for (const vertex of kerb) expect(Math.abs(vertex.x)).toBeCloseTo(KERB_LATERAL_METRES, 4);
    expect(Math.min(...kerb.map((vertex) => vertex.y))).toBeCloseTo(road, 5);
  });

  it('turns every triangle to face the way its normal says, so none is culled', () => {
    const { positions, normals, indices } = street.pavement;
    expect(indices.length).toBeGreaterThan(0);
    for (let at = 0; at < indices.length; at += 3) {
      const [a, b, c] = [indices[at], indices[at + 1], indices[at + 2]] as [number, number, number];
      const p = (i: number, k: number): number => positions[i * 3 + k] as number;
      const e = [p(b, 0) - p(a, 0), p(b, 1) - p(a, 1), p(b, 2) - p(a, 2)];
      const f = [p(c, 0) - p(a, 0), p(c, 1) - p(a, 1), p(c, 2) - p(a, 2)];
      const n = [
        (e[1] as number) * (f[2] as number) - (e[2] as number) * (f[1] as number),
        (e[2] as number) * (f[0] as number) - (e[0] as number) * (f[2] as number),
        (e[0] as number) * (f[1] as number) - (e[1] as number) * (f[0] as number),
      ];
      const dot =
        (n[0] as number) * (normals[a * 3] as number) +
        (n[1] as number) * (normals[a * 3 + 1] as number) +
        (n[2] as number) * (normals[a * 3 + 2] as number);
      expect(dot, `triangle ${String(at / 3)}`).toBeGreaterThan(0);
    }
  });

  it('closes both ends, each looking away along the road', () => {
    const ends = vertices(street.pavement).filter((vertex) => Math.abs(vertex.nz) > 0.999);
    // Four strips — a side each, broken at the crossroads since #1565 — two
    // ends each, four corners an end.
    expect(ends.length).toBe(32);
    const centre = crossroadsZ(FARMLAND, street);
    for (const side of [1, -1]) {
      for (const before of [true, false]) {
        const mine = ends.filter(
          (vertex) => sideOf(FARMLAND, vertex) === side && vertex.z < centre === before,
        );
        expect(mine).toHaveLength(8);
        const nearest = Math.min(...mine.map((vertex) => vertex.z));
        for (const vertex of mine) {
          // The end nearer the start looks back (−z); the far end looks on.
          expect(Math.sign(vertex.nz)).toBe(vertex.z === nearest ? -1 : 1);
        }
      }
    }
  });

  it('breaks at the village’s crossroads, with nothing over its mouth — #1565', () => {
    for (const each of streetsOf(FARMLAND)) {
      const centre = crossroadsZ(FARMLAND, each);
      for (const vertex of vertices(each.pavement)) {
        expect(Math.abs(vertex.z - centre)).toBeGreaterThan(VILLAGE_MOUTH_HALF_METRES - 0.01);
      }
      for (const item of each.furniture) {
        expect(Math.abs(item.z - centre)).toBeGreaterThan(VILLAGE_MOUTH_HALF_METRES);
      }
    }
  });

  it('costs one village no more than its stated triangles, and is the same objects every frame', () => {
    for (const each of streetsOf(FARMLAND)) {
      expect(each.pavement.indices.length / 3).toBeLessThanOrEqual(PAVEMENT_TRIANGLES_PER_VILLAGE);
    }
    // Non-vacuity: a village at its fullest is near the bound, not far under it.
    const heaviest = Math.max(
      ...streetsOf(FARMLAND).map((each) => each.pavement.indices.length / 3),
    );
    expect(heaviest).toBeGreaterThan(PAVEMENT_TRIANGLES_PER_VILLAGE * 0.7);
    expect(PAVEMENT_TRIANGLES_PER_VILLAGE).toBe(1_184);
    const again = streetsOf(FARMLAND);
    expect(again.length).toBeGreaterThan(0);
    again.forEach((each, index) => {
      expect(each).toBe(streetsOf(FARMLAND)[index]);
    });
  });
});

describe('what a pavement may never stand on — #1535', () => {
  it('never stands in the carriageway of ANY stretch of the road: a hairpin’s other leg', () => {
    // Legs 8 m apart, centre to centre: the inside pavement of one leg, 3.5 m
    // to 5.5 m out, would stand in the other leg's carriageway from 4.5 m.
    const profile = hairpinRoute(4);
    const origin = corridorOrigin(profile);
    const seed = scatterSeed(profile);
    const inside = pavementAlong(profile, origin, seed, 1, 20, 360);
    const outside = pavementAlong(profile, origin, seed, -1, 20, 360);
    // The control: the outside of the same leg is laid whole.
    expect(outside).toBeDefined();
    expect((outside as PavementMesh).indices.length / 3).toBeGreaterThan(1_000);
    expect(inside).toBeUndefined();
  });

  it('keeps every vertex off the carriageway on a bend, and follows it unbroken', () => {
    const profile = circuitRoute(300, () => 40);
    const origin = corridorOrigin(profile);
    const mesh = pavementAlong(profile, origin, scatterSeed(profile), 1, 200, 400);
    expect(mesh).toBeDefined();
    const all = vertices(mesh as PavementMesh);
    for (const vertex of all) {
      expect(distanceToDrawnRoad(profile, origin, vertex.x, vertex.z, 10)).toBeGreaterThanOrEqual(
        KERB_LATERAL_METRES - 0.02,
      );
    }
    // Unbroken: one strip, so two ends of four corners.
    expect(all.filter((vertex) => Math.abs(vertex.ny) < 1e-6 && isAlong(vertex)).length).toBe(8);
  });

  it('keeps the kerb off a nearby leg’s carriageway where some of the pavement is still laid', () => {
    // Wide enough hairpins that only part of the inside pavement is refused:
    // what is kept must be a true kerb's width from EVERY stretch of road, to
    // within the chord slack alone.
    for (const radius of [5, 6, 7, 8]) {
      const profile = hairpinRoute(radius);
      const origin = corridorOrigin(profile);
      const seed = scatterSeed(profile);
      const whole = pavementAlong(profile, origin, seed, -1, 300, 520) as PavementMesh;
      const inside = pavementAlong(profile, origin, seed, 1, 300, 520);
      expect(inside, `radius ${String(radius)}`).toBeDefined();
      // Some of it was refused, some kept.
      expect((inside as PavementMesh).indices.length).toBeLessThan(whole.indices.length);
      for (const vertex of vertices(inside as PavementMesh)) {
        expect(
          distanceToDrawnRoad(profile, origin, vertex.x, vertex.z, 10),
          `radius ${String(radius)}`,
        ).toBeGreaterThanOrEqual(KERB_LATERAL_METRES - 0.021);
      }
    }
  });

  it('never stands in water or on a bank, and is laid either side of it', () => {
    const profile = valleyRoute();
    const origin = corridorOrigin(profile);
    const seed = scatterSeed(profile);
    const ways = waterways(profile, seed);
    const middle = KERB_LATERAL_METRES + PAVEMENT_WIDTH_METRES / 2;
    const wet = (along: number): boolean => inWater(ways, profile, metres(along), middle);
    // Non-vacuity: the stretch crosses the stream, and has dry road both sides.
    expect(wet(1_000)).toBe(true);
    expect(wet(850)).toBe(false);
    expect(wet(1_150)).toBe(false);
    const mesh = pavementAlong(profile, origin, seed, 1, 850, 1_150) as PavementMesh;
    expect(mesh).toBeDefined();
    const top = topOf(mesh);
    expect(top.some((vertex) => vertex.z < 1_000)).toBe(true);
    expect(top.some((vertex) => vertex.z > 1_000)).toBe(true);
    for (const vertex of top) {
      const along = alongAt(profile, vertex.z);
      expect(wet(along), `at ${String(along)}`).toBe(false);
    }
  });
});

describe('a loop — #1535', () => {
  it('carries each village’s street once, however many laps the span covers', () => {
    const profile = circuitRoute(1_000, () => 40);
    const once = streetsOf(profile, 0, profile.totalDistance);
    expect(once.length).toBeGreaterThan(0);
    const thrice = streetsOf(profile, 0, 3 * profile.totalDistance);
    expect(thrice.length).toBe(once.length);
    expect(new Set(thrice).size).toBe(thrice.length);
    // A span that reaches one village on two laps — from just short of it, a
    // whole lap and a little on — carries it once.
    const village = once[0] as VillageStreet;
    const twice = streetsOf(profile, village.from - 1, village.from + profile.totalDistance + 1);
    expect(twice.filter((street) => street === village)).toHaveLength(1);
    // A span on the second lap finds the same objects the first lap did.
    const second = streetsOf(profile, profile.totalDistance, 2 * profile.totalDistance);
    expect(second).toEqual(once);
    for (const [index, street] of second.entries()) expect(street).toBe(once[index]);
  });

  it('finds a village first seen from before the start again on the first lap', () => {
    // 300 m round has three sites and the LAST is a village, so a span that
    // starts before the line meets it as site -1 first. Its extent must be
    // kept on the first lap's odometer, not the lap it happened to be met on.
    const profile = circuitRoute(300, () => 40);
    const { sites } = siteSpacing(profile);
    const last = siteAt(profile, scatterSeed(profile), sites - 1);
    expect(last?.kind).toBe('village');
    const before = streetsOf(profile, -400, 0);
    expect(before.length).toBeGreaterThan(0);
    const street = before[0] as VillageStreet;
    const along = (street.from + street.to) / 2;
    expect(along).toBeGreaterThan(0);
    const found = streetsOf(profile, along - 1, along + 1);
    expect(found).toContain(street);
  });
});

/** Whether a vertex's normal lies along the road rather than across it, on a bend. */
function isAlong(vertex: {
  readonly x: number;
  readonly z: number;
  readonly nx: number;
  readonly nz: number;
}): boolean {
  // On a circuit centred where `circuitRoute` puts it — 300 m to the road's
  // left at the start, which is +x — across is radial: the ends' normals are
  // the ones square to the radius.
  const cx = 300;
  const radial = Math.hypot(vertex.x - cx, vertex.z);
  const rx = (vertex.x - cx) / radial;
  const rz = vertex.z / radial;
  return Math.abs(vertex.nx * rx + vertex.nz * rz) < 0.2;
}

describe('the street furniture — #1536', () => {
  const origin = corridorOrigin(FARMLAND);
  const streets = streetsOf(FARMLAND);
  const all = streets.flatMap((street) => street.furniture);
  /** How far out from the kerb's face a piece stands, on a road running north. */
  const fromKerb = (item: FurnitureItem): number =>
    distanceToDrawnRoad(FARMLAND, origin, item.x, item.z, 10) - KERB_LATERAL_METRES;
  const ofKind = (items: readonly FurnitureItem[], kind: FurnitureKind): FurnitureItem[] =>
    items.filter((item) => item.kind === kind).sort((a, b) => a.z - b.z);
  const onSide = (items: readonly FurnitureItem[], side: 1 | -1): FurnitureItem[] =>
    items.filter((item) => sideOf(FARMLAND, item) === side);
  /**
   * Every unbroken run of every street on the farmland: its furniture. A side
   * is two runs since #1565, broken at the village's crossroads.
   */
  const sides = streets.flatMap((street) => {
    const centre = crossroadsZ(FARMLAND, street);
    return ([1, -1] as const)
      .flatMap((side) => {
        const mine = onSide(street.furniture, side);
        return [mine.filter((item) => item.z < centre), mine.filter((item) => item.z > centre)];
      })
      .filter((items) => items.length > 0);
  });

  it('stands every kind on a village’s pavement, at the pavement’s height, where its rule says', () => {
    for (const kind of FURNITURE_KINDS) expect(ofKind(all, kind).length, kind).toBeGreaterThan(0);
    const road = elevationAt(FARMLAND, metres(0)) - origin.elevation;
    const across: Readonly<Record<FurnitureKind, number>> = {
      'lamp-post': PAVEMENT_WIDTH_METRES - LAMP_SETBACK_METRES,
      bollard: BOLLARD_INSET_METRES,
      bench: PAVEMENT_WIDTH_METRES - BENCH_SETBACK_METRES,
      bin: PAVEMENT_WIDTH_METRES - BENCH_SETBACK_METRES,
    };
    for (const item of all) {
      // On the kerb's top, which drops beside the crossroads (#1565).
      expect(item.y).toBeGreaterThanOrEqual(road + DROPPED_KERB_HEIGHT_METRES - 1e-5);
      expect(item.y).toBeLessThanOrEqual(road + KERB_HEIGHT_METRES + 1e-5);
      expect(fromKerb(item), item.kind).toBeCloseTo(across[item.kind], 3);
    }
    // Away from a dropped kerb, a kerb high.
    const lamps = ofKind(all, 'lamp-post');
    for (const lamp of lamps) expect(lamp.y).toBeCloseTo(road + KERB_HEIGHT_METRES, 5);
  });

  it('puts nothing outside the village whose street it is', () => {
    expect(sides.length).toBeGreaterThan(1);
    for (const street of streets) {
      const top = topOf(street.pavement).map((vertex) => vertex.z);
      for (const item of street.furniture) {
        expect(item.z).toBeGreaterThanOrEqual(Math.min(...top));
        expect(item.z).toBeLessThanOrEqual(Math.max(...top));
      }
    }
  });

  it('spaces the lamp posts by rule, the first half a spacing in from the end', () => {
    for (const items of sides) {
      const lamps = ofKind(items, 'lamp-post');
      const bollards = ofKind(items, 'bollard');
      expect(lamps.length).toBeGreaterThan(1);
      for (let index = 1; index < lamps.length; index += 1) {
        expect(
          (lamps[index] as FurnitureItem).z - (lamps[index - 1] as FurnitureItem).z,
        ).toBeCloseTo(LAMP_SPACING_METRES, 1);
      }
      // The run starts 0.6 m short of the first bollard.
      const start = (bollards[0] as FurnitureItem).z - (BOLLARD_ENDS_METRES[0] as number);
      expect((lamps[0] as FurnitureItem).z - start).toBeCloseTo(LAMP_SPACING_METRES / 2, 1);
    }
  });

  it('stands a pair of bollards at each end of each run, and nowhere between', () => {
    for (const items of sides) {
      const bollards = ofKind(items, 'bollard').map((item) => item.z);
      expect(bollards).toHaveLength(4);
      const [first, second, third, fourth] = bollards as [number, number, number, number];
      const pair = (BOLLARD_ENDS_METRES[1] as number) - (BOLLARD_ENDS_METRES[0] as number);
      expect(second - first).toBeCloseTo(pair, 1);
      expect(fourth - third).toBeCloseTo(pair, 1);
      expect(third - second).toBeGreaterThan(LAMP_SPACING_METRES);
    }
  });

  it('sets one bench between the middle lamp posts, facing the road, and a bin beside it', () => {
    const roadX = roadAt(FARMLAND, 0).x;
    for (const items of sides) {
      const lamps = ofKind(items, 'lamp-post').map((item) => item.z);
      const [bench] = ofKind(items, 'bench');
      const [bin] = ofKind(items, 'bin');
      expect(ofKind(items, 'bench')).toHaveLength(1);
      expect(ofKind(items, 'bin')).toHaveLength(1);
      const pair = Math.max(0, Math.floor((lamps.length - 2) / 2));
      expect((bench as FurnitureItem).z).toBeCloseTo(
        ((lamps[pair] as number) + (lamps[pair + 1] as number)) / 2,
        1,
      );
      expect((bin as FurnitureItem).z - (bench as FurnitureItem).z).toBeCloseTo(
        BIN_BESIDE_METRES,
        1,
      );
      // Every piece's front (+z, turned by its yaw) points at the road.
      for (const item of items) {
        const towardsRoad = roadX - item.x;
        expect(Math.sin(item.rotation) * towardsRoad, item.kind).toBeGreaterThan(0);
        expect(Math.abs(Math.cos(item.rotation))).toBeLessThan(0.01);
      }
    }
  });

  it('furnishes a short run by its length: bollards, bench and bin only where they fit clear', () => {
    const kinds = (length: number) =>
      furnitureAlong(
        FARMLAND,
        corridorOrigin(FARMLAND),
        scatterSeed(FARMLAND),
        1,
        1_000,
        1_000 + length,
      )
        .map((item) => item.kind)
        .sort();
    // Under 2 x 0.6 m nothing; to 2 x 1.8 m the outer pair only.
    expect(kinds(1)).toEqual([]);
    expect(kinds(3)).toEqual(['bollard', 'bollard']);
    // Both pairs, but not yet room for a bench and bin clear of them.
    expect(kinds(8)).toEqual(['bollard', 'bollard', 'bollard', 'bollard']);
    // A bench and bin at the middle of a run with no lamp post.
    expect(kinds(9)).toEqual(['bench', 'bin', 'bollard', 'bollard', 'bollard', 'bollard']);
    const [lone] = ofKind(
      furnitureAlong(FARMLAND, corridorOrigin(FARMLAND), scatterSeed(FARMLAND), 1, 1_000, 1_020),
      'bench',
    );
    expect(alongAt(FARMLAND, (lone as FurnitureItem).z)).toBeCloseTo(1_010, 0);
    // One lamp post: the bench is never beside it.
    for (const length of [24, 25, 26, 34, 47]) {
      const items = furnitureAlong(
        FARMLAND,
        corridorOrigin(FARMLAND),
        scatterSeed(FARMLAND),
        1,
        1_000,
        1_000 + length,
      );
      const [lamp] = ofKind(items, 'lamp-post');
      const [bench] = ofKind(items, 'bench');
      expect(ofKind(items, 'lamp-post'), String(length)).toHaveLength(1);
      expect(
        Math.abs((bench as FurnitureItem).z - (lamp as FurnitureItem).z),
        String(length),
      ).toBeGreaterThan(2);
    }
  });

  it('furnishes no pavement the rules refused: a hairpin’s inside, and the stream’s banks', () => {
    const hairpin = hairpinRoute(4);
    const seed = scatterSeed(hairpin);
    const hairpinOrigin = corridorOrigin(hairpin);
    expect(furnitureAlong(hairpin, hairpinOrigin, seed, 1, 20, 360)).toEqual([]);
    // The control: the outside of the same leg is furnished.
    expect(
      ofKind(furnitureAlong(hairpin, hairpinOrigin, seed, -1, 20, 360), 'lamp-post').length,
    ).toBeGreaterThan(10);
    const valley = valleyRoute();
    const ways = waterways(valley, scatterSeed(valley));
    const pieces = furnitureAlong(
      valley,
      corridorOrigin(valley),
      scatterSeed(valley),
      1,
      850,
      1_150,
    );
    // Two runs, one either side of the stream: a pair of bollards at each of four ends.
    expect(ofKind(pieces, 'bollard')).toHaveLength(8);
    for (const item of pieces) {
      const along = alongAt(valley, item.z);
      expect(inWater(ways, valley, metres(along), KERB_LATERAL_METRES + 1), item.kind).toBe(false);
    }
  });
});

describe('a path to each front door — #1564', () => {
  const origin = corridorOrigin(FARMLAND);
  const seed = scatterSeed(FARMLAND);
  const villages = sitesOf(FARMLAND).filter((site) => site.kind === 'village');
  const streets = streetsOf(FARMLAND);

  /** Where a point is in its plot's frame: metres out on the plot's side, and along the road. */
  function inPlot(path: DoorPath, x: number, z: number) {
    const frame = roadAt(FARMLAND, path.along);
    const dx = x - frame.x;
    const dz = z - frame.z;
    return {
      out: (dx * frame.normalX + dz * frame.normalZ) * path.side,
      along: dx * frame.normalZ - dz * frame.normalX,
    };
  }

  /** The middle of a path's top at its pavement end (`first`) or at its door (`last`). */
  function endOf(path: DoorPath, which: 'first' | 'last') {
    const top = topOf(path.mesh);
    const out = top.map((vertex) => inPlot(path, vertex.x, vertex.z).out);
    const at = which === 'first' ? Math.min(...out) : Math.max(...out);
    const end = top.filter((_, index) => Math.abs((out[index] as number) - at) < 1e-3);
    const x = end.reduce((sum, vertex) => sum + vertex.x, 0) / end.length;
    const z = end.reduce((sum, vertex) => sum + vertex.z, 0) / end.length;
    return { ...inPlot(path, x, z), y: (end[0] as { readonly y: number }).y };
  }

  const allPaths = streets.flatMap((street) => street.doorPaths);

  it('leads into every built plot exactly once, and into no unbuilt one', () => {
    const key = (along: number, side: number): string => `${along.toFixed(3)} ${String(side)}`;
    const wanted = villages.flatMap((site) =>
      villagePlots(seed, site).map((plot) => key(plot.along, plot.side)),
    );
    const laid = allPaths.map((path) => key(path.along, path.side));
    // Non-vacuity: the farmland's villages have plenty of built plots.
    expect(wanted.length).toBeGreaterThan(30);
    expect(new Set(wanted).size).toBe(wanted.length);
    expect([...laid].sort()).toEqual([...wanted].sort());
  });

  it('runs from under the pavement’s back edge, on the plot’s own side, to its building’s door', () => {
    // Each kind's door nearest the middle of the face it turns to the road,
    // as `buildings.ts`' plans cut it: [along its front, out from its middle].
    const doors: Readonly<Record<string, readonly [number, number]>> = {
      'building 0': [0, 3.3],
      'building 1': [-0.8, 3],
      'shop-row 0': [1.8, 3.3],
      'shop-row 1': [-2.2, 3.3],
      'church 0': [0, 8.5],
      'church 1': [0, 7],
    };
    const seen = new Set<string>();
    for (const site of villages) {
      const street = streets.find((each) => each.wrappedSite === site.wrappedSite);
      for (const plot of villagePlots(seed, site)) {
        const path = street?.doorPaths.find(
          (each) => Math.abs(each.along - plot.along) < 1e-6 && each.side === plot.side,
        ) as DoorPath;
        const kind = `${plot.kind} ${String(plot.variant % 2)}`;
        const [front, out] = doors[kind] as readonly [number, number];
        seen.add(kind);
        for (const vertex of vertices(path.mesh)) expect(sideOf(FARMLAND, vertex)).toBe(plot.side);
        const start = endOf(path, 'first');
        const door = endOf(path, 'last');
        // From 0.3 m under the pavement's back edge…
        expect(start.out).toBeCloseTo(KERB_LATERAL_METRES + PAVEMENT_WIDTH_METRES - 0.3, 2);
        // …square to the road, to the door. A building faces the road, so its
        // own right runs against the road on the road's right-hand side.
        expect(door.out, kind).toBeCloseTo(plot.lateral - out, 2);
        expect(door.along, kind).toBeCloseTo(-plot.side * front, 2);
        expect(start.along, kind).toBeCloseTo(door.along, 2);
        const across = topOf(path.mesh).map((vertex) => inPlot(path, vertex.x, vertex.z).along);
        expect(Math.max(...across) - Math.min(...across)).toBeCloseTo(DOOR_PATH_WIDTH_METRES, 2);
      }
    }
    // Non-vacuity: a house of each variant, a row of shops and a church.
    expect(seen.has('building 0') && seen.has('building 1')).toBe(true);
    expect([...seen].some((kind) => kind.startsWith('shop-row'))).toBe(true);
    expect([...seen].some((kind) => kind.startsWith('church'))).toBe(true);
  });

  it('leaves the pavement’s top no faster than its fall, then lies on the ground, skirted into it', () => {
    let grounded = 0;
    for (const path of allPaths) {
      const frame = roadAt(FARMLAND, path.along);
      const pavementTop =
        elevationAt(FARMLAND, metres(path.along)) - origin.elevation + KERB_HEIGHT_METRES;
      const top = topOf(path.mesh)
        .map((vertex) => ({ ...vertex, out: inPlot(path, vertex.x, vertex.z).out }))
        .sort((a, b) => a.out - b.out);
      const first = top[0] as (typeof top)[number];
      // Just under the pavement's top where it starts: hidden by it, never over it.
      expect(first.y).toBeCloseTo(pavementTop - DOOR_PATH_LIFT_METRES, 3);
      for (const vertex of top) {
        const near = nearestOnDrawnRoad(FARMLAND, origin, vertex.x, vertex.z, 30) as NearestOnRoad;
        const ground = terrainHeightAt(
          FARMLAND,
          origin,
          seed,
          near.along,
          near.lateral,
          NO_LAND_CLASS,
        );
        // Read at the path's middle, so its edge may stand a millimetre off.
        expect(vertex.y).toBeGreaterThanOrEqual(ground + DOOR_PATH_LIFT_METRES - 1e-3);
        expect(vertex.y).toBeLessThan(pavementTop);
        expect(vertex.y).toBeGreaterThanOrEqual(
          first.y - DOOR_PATH_FALL * (vertex.out - first.out) - 1e-4,
        );
        if (Math.abs(vertex.y - (ground + DOOR_PATH_LIFT_METRES)) < 2e-3) grounded += 1;
      }
      // A skirt down each edge, looking out across the path, into the ground.
      const skirt = vertices(path.mesh).filter((vertex) => Math.abs(vertex.ny) < 1e-6);
      expect(skirt.length).toBeGreaterThan(0);
      expect(Math.min(...skirt.map((vertex) => vertex.y))).toBeLessThan(
        Math.min(...top.map((vertex) => vertex.y)) - DOOR_PATH_LIFT_METRES,
      );
      const middle = top.reduce((sum, vertex) => sum + inPlot(path, vertex.x, vertex.z).along, 0);
      for (const vertex of skirt) {
        const across = vertex.nx * frame.normalZ - vertex.nz * frame.normalX;
        expect(Math.abs(across)).toBeCloseTo(1, 3);
        // Out from the path, so it is not culled from where it is seen.
        const offset = inPlot(path, vertex.x, vertex.z).along - middle / top.length;
        expect(Math.sign(across)).toBe(Math.sign(offset));
      }
    }
    // Non-vacuity: most of each path lies on the ground rather than on its ramp.
    expect(grounded).toBeGreaterThan(allPaths.length * 6);
  });

  it('lies on the ground the ride’s land-class mask levels, not on the unmapped relief', () => {
    // A mask that maps no village (so none is dropped) yet holds the relief to
    // nothing everywhere: the ground is the road less the verge.
    const levelled: LandClassMask = {
      ...NO_LAND_CLASS,
      bytes: 1,
      levellingBytes: 1,
      builtUpDistances: (_points, count, into) => into.fill(0, 0, count),
    };
    const paths = streetsAt(
      FARMLAND,
      origin,
      seed,
      0,
      FARMLAND.totalDistance,
      undefined,
      levelled,
    ).flatMap((street) => street.doorPaths);
    expect(paths.length).toBe(allPaths.length);
    let moved = 0;
    let onLevelled = 0;
    for (const path of paths) {
      for (const vertex of topOf(path.mesh)) {
        const near = nearestOnDrawnRoad(FARMLAND, origin, vertex.x, vertex.z, 30) as NearestOnRoad;
        const flat = terrainHeightAt(FARMLAND, origin, seed, near.along, near.lateral, levelled);
        const relief = terrainHeightAt(
          FARMLAND,
          origin,
          seed,
          near.along,
          near.lateral,
          NO_LAND_CLASS,
        );
        expect(vertex.y).toBeGreaterThanOrEqual(flat + DOOR_PATH_LIFT_METRES - 1e-3);
        if (Math.abs(vertex.y - (flat + DOOR_PATH_LIFT_METRES)) < 2e-3) {
          onLevelled += 1;
          if (Math.abs(flat - relief) > 0.01) moved += 1;
        }
      }
    }
    // Non-vacuity: past the clear band the levelling moves the ground a path lies on.
    expect(onLevelled).toBeGreaterThan(paths.length * 6);
    expect(moved).toBeGreaterThan(0);
  });

  it('turns every triangle to face the way its normal says, so none is culled', () => {
    for (const path of allPaths) {
      const { positions, normals, indices } = path.mesh;
      const p = (vertex: number, axis: number): number => positions[vertex * 3 + axis] as number;
      for (let at = 0; at < indices.length; at += 3) {
        const a = indices[at] as number;
        const b = indices[at + 1] as number;
        const c = indices[at + 2] as number;
        const e = [0, 1, 2].map((axis) => p(b, axis) - p(a, axis)) as [number, number, number];
        const f = [0, 1, 2].map((axis) => p(c, axis) - p(a, axis)) as [number, number, number];
        const n = [e[1] * f[2] - e[2] * f[1], e[2] * f[0] - e[0] * f[2], e[0] * f[1] - e[1] * f[0]];
        const facing = n.reduce(
          (sum, value, axis) => sum + value * (normals[a * 3 + axis] as number),
          0,
        );
        expect(facing).toBeGreaterThan(0);
      }
    }
  });

  it('stands on the village’s cleared ground, so no tree, shrub or rock is placed on a path — #1534', () => {
    const footprints = settlementFootprintsAt(FARMLAND, origin, seed, 0, FARMLAND.totalDistance);
    const trees: ScatterItem[] = [];
    for (const path of allPaths) {
      for (const vertex of topOf(path.mesh)) {
        expect(footprints.some((piece) => onSettlementGround(vertex, piece))).toBe(true);
        for (const kind of ['tree-broadleaf', 'tree-conifer', 'shrub', 'rock'] as const) {
          trees.push({
            kind,
            x: vertex.x,
            y: vertex.y,
            z: vertex.z,
            rotation: 0,
            scale: 1,
            variant: 0,
          });
        }
      }
    }
    expect(trees.length).toBeGreaterThan(400);
    expect(clearOfSettlements(trees, footprints)).toEqual([]);
  });

  it('lays none where the side’s pavement is not laid: a mapped sidewalk on the right only — #1551', () => {
    const rightOnly: PavementSides = { sideAt: () => 'right' };
    const paths = streetsAt(FARMLAND, origin, seed, 0, FARMLAND.totalDistance, rightOnly).flatMap(
      (street) => street.doorPaths,
    );
    const right = villages
      .flatMap((site) => villagePlots(seed, site))
      .filter((plot) => plot.side === 1);
    expect(right.length).toBeGreaterThan(10);
    expect(paths.filter((path) => path.side === 1)).toHaveLength(right.length);
    expect(paths.filter((path) => path.side === -1)).toEqual([]);
  });

  it('lays none in front of a stretch of pavement that is not laid, and every one where it is', () => {
    // Mapped: the left-hand sidewalk only past each village's crossroads.
    const centres = villages.map((site) => site.centre);
    const halfway: PavementSides = {
      sideAt: (along) =>
        centres.some((centre) => along > centre && along < centre + VILLAGE_METRES)
          ? 'both'
          : 'right',
    };
    const left = streetsAt(FARMLAND, origin, seed, 0, FARMLAND.totalDistance, halfway)
      .flatMap((street) => street.doorPaths)
      .filter((path) => path.side === -1);
    const plots = villages.flatMap((site) =>
      villagePlots(seed, site)
        .filter((plot) => plot.side === -1)
        .map((plot) => ({ ...plot, past: plot.along > site.centre })),
    );
    const past = plots.filter((plot) => plot.past);
    // Non-vacuity: left-hand plots either side of a crossroads.
    expect(past.length).toBeGreaterThan(3);
    expect(plots.length - past.length).toBeGreaterThan(3);
    expect(left.map((path) => path.along).sort()).toEqual(past.map((plot) => plot.along).sort());
  });

  it('never runs onto ANY stretch of the carriageway: a hairpin’s other leg', () => {
    // Legs 12 m apart: the inside plot's path, 5.2 m to 11.7 m out, would end
    // in the other leg's carriageway, though its own pavement is laid.
    const profile = hairpinRoute(6);
    const plot: Plot = { along: 200, side: 1, kind: 'building', lateral: 15, variant: 0 };
    const path = (side: 1 | -1) =>
      doorPathFor(profile, corridorOrigin(profile), scatterSeed(profile), { ...plot, side });
    // The control: the outside of the same leg has its path.
    expect(path(-1)).toBeDefined();
    expect(path(1)).toBeUndefined();
  });

  it('never runs through water or over a bank', () => {
    const profile = valleyRoute();
    const valleySeed = scatterSeed(profile);
    const ways = waterways(profile, valleySeed);
    // Non-vacuity: the stream crosses the road at 1 000 m, and 850 m is dry.
    expect(inWater(ways, profile, metres(1_000), 8)).toBe(true);
    expect(inWater(ways, profile, metres(850), 8)).toBe(false);
    const plot = (along: number): Plot => ({
      along,
      side: 1,
      kind: 'building',
      lateral: 15,
      variant: 0,
    });
    const valleyOrigin = corridorOrigin(profile);
    expect(doorPathFor(profile, valleyOrigin, valleySeed, plot(850))).toBeDefined();
    expect(doorPathFor(profile, valleyOrigin, valleySeed, plot(1_000))).toBeUndefined();
  });

  it('costs one village no more than its stated triangles, and two fit the street budget', () => {
    const counts = streets.map((street) =>
      street.doorPaths.reduce((sum, path) => sum + path.mesh.indices.length / 3, 0),
    );
    for (const count of counts) expect(count).toBeLessThanOrEqual(DOOR_PATH_TRIANGLES_PER_VILLAGE);
    // Non-vacuity: a well-built village is a good share of the bound.
    expect(Math.max(...counts)).toBeGreaterThan(DOOR_PATH_TRIANGLES_PER_VILLAGE * 0.6);
    expect(DOOR_PATH_TRIANGLES_PER_VILLAGE).toBe(960);
    // `realistic-budget.ts` §`REALISTIC_STREET_TRIANGLES`: two villages'
    // pavements and paths, and the furniture belt's capacity.
    expect(REALISTIC_STREET_TRIANGLES).toBe(
      2 * (PAVEMENT_TRIANGLES_PER_VILLAGE + DOOR_PATH_TRIANGLES_PER_VILLAGE) + 64 * 324,
    );
  });

  it('leaves every pavement as it was: no pavement vertex past its back edge', () => {
    for (const street of streets) {
      for (const vertex of vertices(street.pavement)) {
        expect(distanceToDrawnRoad(FARMLAND, origin, vertex.x, vertex.z, 20)).toBeLessThanOrEqual(
          KERB_LATERAL_METRES + PAVEMENT_WIDTH_METRES + 1e-3,
        );
      }
    }
  });
});
