// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A house beside ground that falls away to the shore — #2761: on a coast the
 * owner saw houses standing on stilts above the ground, near the water.
 *
 * Every fixture is arithmetic beside a straight test road: no OpenStreetMap
 * data, no tile, and nothing here is a real place. The public places it was
 * measured at are in the PR, never the owner's route. The road climbs away
 * from a sea on its right, as a road along a bluff does, so the bank down to
 * the water is tall and the ground under a house there falls by metres.
 *
 * Each case reads a house's foot back through what a ride draws, and the
 * ground through the triangles the ride draws (`sceneFrame`'s terrain mesh,
 * by this file's own {@link drawnTop}, so the oracle is not `landform.ts`):
 *
 * - a mapped house, through `MappedBuildingBelt`'s own position buffer at
 *   both of its levels;
 * - a procedural lot, through `sceneFrame`'s scenery and `buildings.ts`
 *   §`buildingPlan`, the shape its belt instances at the item.
 *
 * The foot is every edge of a drawn triangle at the lowest height the house
 * is drawn at, sampled every quarter metre: where the ground under one of
 * those edges is lower than the edge, light shows under the house.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { metres, type RouteProfile } from '@onyourleft/domain';
import type { LandUseFeature } from '@onyourleft/map-features';

import { FOUNDATION_METRES, buildingPlan, isBuiltKind } from './buildings';
import { buildingBeside, landBeside, rectangleBeside } from './footprint-fixtures-testing';
import { footprintPlans, mappedTown, type FootprintPlan } from './footprint-buildings';
import { landClassMask, type LandClassMask } from './land-class';
import { mappedBuildingsOf } from './mapped-buildings';
import { MAPPED_BUILDING_NEAR_METRES, MAPPED_BUILDING_TRIANGLES } from './realistic-budget';
import { PHOTOGRAPHIC_STRUCTURE_SURFACES } from './realistic-assets';
import { hairpinRoute, northRoute } from './route-fixtures-testing';
import { sceneFrame } from './scene';
import { scatterSeed, type ScatterItem } from './scatter';
import { LOT_MAX_GROUND_RANGE_METRES, lotsAt } from './settlements';
import { atStartLine } from './simulation';
import { corridorOrigin, drawnRoadFrame } from './terrain';
import { MappedBuildingBelt } from './three-renderer';
import type { WorldCorridor } from './world-data/corridor';

/** Level for its first kilometre, then climbing 5 m a kilometre: the bank grows as it goes. */
const COAST: RouteProfile = northRoute(3_000, (along) => 10 + Math.max(0, along - 1_000) * 0.005);
const ORIGIN = corridorOrigin(COAST);

/** Houses on the road's right, from the road out to a sea `shore` metres out, 200 m to 2 800 m. */
function coastCorridor(shore: number, buildings: WorldCorridor['buildings'] = []): WorldCorridor {
  const landUse: LandUseFeature[] = [
    landBeside(COAST, ORIGIN, 'landuse', 'residential', 200, 2_800, 4, shore),
    landBeside(COAST, ORIGIN, 'water', 'ocean', 200, 2_800, shore, 240),
  ];
  return {
    routeId: 'shore-houses',
    origin: ORIGIN,
    covered: () => true,
    coveredBoxes: [{ minX: -3_000, maxX: 3_000, minZ: -1_000, maxZ: 9_000 }],
    landUse,
    buildings,
    paths: [],
    streets: [],
  };
}

/** The frame a rider at `odometer` sees, handed the ride's mask, corridor and town as `GameView` hands them. */
function frameAt(
  odometer: number,
  land: LandClassMask,
  corridor: WorldCorridor,
  plans: readonly FootprintPlan[],
  profile: RouteProfile = COAST,
) {
  const start = atStartLine(profile);
  return sceneFrame({
    profile,
    origin: corridorOrigin(profile),
    state: { ...start, ride: { ...start.ride, distance: metres(odometer) } },
    landClass: land,
    worldCorridor: corridor,
    mappedTown: mappedTown(corridor, plans),
  });
}

/**
 * The height of the highest triangle of `vertices` and `indices` over
 * `(x, z)`, or `NaN` where none is: what is drawn on top there. Written out
 * here rather than asked of `landform.ts`, so the oracle is not the code.
 */
function drawnTop(
  vertices: ArrayLike<number>,
  indices: ArrayLike<number>,
  x: number,
  z: number,
): number {
  let top = Number.NaN;
  for (let at = 0; at + 2 < indices.length; at += 3) {
    const a = (indices[at] as number) * 3;
    const b = (indices[at + 1] as number) * 3;
    const c = (indices[at + 2] as number) * 3;
    const [ax, az, bx, bz, cx, cz] = [
      vertices[a] as number,
      vertices[a + 2] as number,
      vertices[b] as number,
      vertices[b + 2] as number,
      vertices[c] as number,
      vertices[c + 2] as number,
    ];
    if (Math.max(ax, bx, cx) < x || Math.min(ax, bx, cx) > x) continue;
    if (Math.max(az, bz, cz) < z || Math.min(az, bz, cz) > z) continue;
    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(det) < 1e-9) continue;
    const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
    const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
    const w = 1 - u - v;
    if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
    const y =
      u * (vertices[a + 1] as number) +
      v * (vertices[b + 1] as number) +
      w * (vertices[c + 1] as number);
    top = Number.isNaN(top) ? y : Math.max(top, y);
  }
  return top;
}

/**
 * How far the foot of what `corners` draws — a triangle soup, three numbers a
 * corner — stands above the ground drawn under it at the worst point: every
 * triangle edge at the soup's lowest height, every quarter metre. Negative
 * where the foot is in the ground the whole way round.
 */
function worstGapUnder(
  corners: readonly (readonly [number, number, number])[],
  ground: { readonly vertices: ArrayLike<number>; readonly indices: ArrayLike<number> },
): number {
  const foot = Math.min(...corners.map(([, y]) => y));
  let worst = Number.NEGATIVE_INFINITY;
  let sampled = 0;
  for (let at = 0; at + 2 < corners.length; at += 3) {
    for (let edge = 0; edge < 3; edge += 1) {
      const [ax, ay, az] = corners[at + edge] as readonly [number, number, number];
      const [bx, by, bz] = corners[at + ((edge + 1) % 3)] as readonly [number, number, number];
      if (ay - foot > 1e-4 || by - foot > 1e-4) continue;
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.25));
      for (let step = 0; step <= steps; step += 1) {
        const x = ax + ((bx - ax) * step) / steps;
        const z = az + ((bz - az) * step) / steps;
        const under = drawnTop(ground.vertices, ground.indices, x, z);
        if (Number.isNaN(under)) continue;
        worst = Math.max(worst, foot - under);
        sampled += 1;
      }
    }
  }
  if (sampled === 0) throw new Error('no point of the foot stands over the drawn ground');
  return worst;
}

/** The road's centre at `along`, in local metres: where a rider is. */
function roadAt(along: number): { readonly x: number; readonly z: number } {
  const frame = drawnRoadFrame(COAST, ORIGIN, along);
  if (frame === undefined) throw new Error('the fixture road has no direction there');
  return { x: frame.x, z: frame.z };
}

/** A texture three would have loaded: the fields a material and a release read. */
function aTexture(): never {
  return { image: { width: 512, height: 512 }, dispose: () => undefined } as never;
}

const textures = new Map(
  PHOTOGRAPHIC_STRUCTURE_SURFACES.map((surface) => [
    surface,
    { colour: aTexture(), normal: aTexture() },
  ]),
);

const belts: MappedBuildingBelt[] = [];

afterEach(() => {
  for (const belt of belts.splice(0)) belt.dispose();
});

describe('#2761 a house beside ground falling to the shore stands on it', () => {
  // A mapped house 10 m along the road by 8 m across, 16 m to 24 m out, on the
  // bank down to a sea 30 m out: the ground under it falls about a metre and a
  // half from its road side to its sea side.
  const house = buildingBeside(COAST, ORIGIN, [rectangleBeside(1_500, 20, 10, 8)]);
  const corridor = coastCorridor(30, [house]);
  const land = landClassMask(corridor);
  const { plans } = footprintPlans(corridor, land, COAST, ORIGIN);

  /** What the belt draws of the one house for a rider at `odometer`, and the ground drawn then. */
  function drawnFrom(odometer: number) {
    const belt = new MappedBuildingBelt(mappedBuildingsOf(plans), textures);
    belts.push(belt);
    const rider = roadAt(odometer);
    const stats = belt.refill(rider.x, rider.z, MAPPED_BUILDING_TRIANGLES);
    const position = belt.mesh.geometry.getAttribute('position');
    const corners: [number, number, number][] = [];
    for (let at = 0; at < belt.mesh.geometry.drawRange.count; at += 1) {
      corners.push([position.getX(at), position.getY(at), position.getZ(at)]);
    }
    const plan = plans[0] as FootprintPlan;
    return {
      stats,
      corners,
      distance: Math.hypot(plan.centroid.x - rider.x, plan.centroid.z - rider.z),
      ground: frameAt(odometer, land, corridor, plans).terrain.mesh,
    };
  }

  it('keeps the mapped house, on ground that falls under it', () => {
    // The control: the case below is about a house that is drawn, on a slope.
    expect(plans).toHaveLength(1);
    const drawn = drawnFrom(1_480);
    expect(drawn.stats.buildings).toBe(1);
    const foot = Math.min(...drawn.corners.map(([, y]) => y));
    const tops = drawn.corners.map(([x, , z]) =>
      drawnTop(drawn.ground.vertices, drawn.ground.indices, x, z),
    );
    const under = tops.filter((top) => !Number.isNaN(top));
    expect(Math.max(...under) - Math.min(...under)).toBeGreaterThan(1);
    expect(foot).toBeLessThan(Math.min(...under));
  });

  it('stands the mapped house in the ground at its near level', () => {
    const drawn = drawnFrom(1_480);
    expect(drawn.distance).toBeLessThan(MAPPED_BUILDING_NEAR_METRES);
    expect(drawn.stats.near).toBe(1);
    expect(worstGapUnder(drawn.corners, drawn.ground)).toBeLessThanOrEqual(1e-3);
  });

  it('stands the mapped house in the ground at its far level too, its foundation drawn to the ground', () => {
    // Until #2761 the far level was the walls and roof alone, and the walls
    // start at the floor, over the ground's highest point under the house:
    // the downhill side stood a metre and more above the bank, on nothing.
    const drawn = drawnFrom(1_320);
    expect(drawn.distance).toBeGreaterThan(MAPPED_BUILDING_NEAR_METRES);
    expect(drawn.stats.far).toBe(1);
    expect(worstGapUnder(drawn.corners, drawn.ground)).toBeLessThanOrEqual(1e-3);
  });
});

/** Every house a frame carries drawn as its kind, as its belt draws it: its plan's corners, placed. */
function housesIn(frame: ReturnType<typeof sceneFrame>) {
  const houses = frame.scatter.flatMap((item) => {
    if (!isBuiltKind(item.kind) || item.house !== undefined) return [];
    const plan = buildingPlan(item.kind, item.variant);
    const sin = Math.sin(item.rotation);
    const cos = Math.cos(item.rotation);
    const corners = Object.values(plan.triangles).flatMap((floats) => {
      const placed: [number, number, number][] = [];
      for (let at = 0; at + 2 < floats.length; at += 3) {
        const x = floats[at] as number;
        const y = floats[at + 1] as number;
        const z = floats[at + 2] as number;
        placed.push([item.x + x * cos + z * sin, item.y + y, item.z - x * sin + z * cos]);
      }
      return placed;
    });
    return [{ item, corners }];
  });
  return { houses, ground: frame.terrain.mesh };
}

describe('#2761 a procedural lot beside ground falling to the shore', () => {
  /** Every lot house the frame at `odometer` carries, as its belt draws it: its plan's corners, placed. */
  function lotHouses(shore: number, odometer: number) {
    const corridor = coastCorridor(shore);
    return housesIn(frameAt(odometer, landClassMask(corridor), corridor, []));
  }

  it('stands no lot house above the ground drawn under it, where the bank falls under the lots', () => {
    // A sea 18 m to 34 m out: the lots, 15 m out and 9 m deep, reach down the
    // bank. Until #2761 a lot stood at the ground under its middle, and its
    // sea side stood up to 1.4 m above the bank.
    let standing = 0;
    for (const shore of [18, 22, 26, 30, 34]) {
      const { houses, ground } = lotHouses(shore, 1_450);
      standing += houses.length;
      for (const { item, corners } of houses) {
        expect(
          worstGapUnder(corners, ground),
          `shore ${shore}, lot at ${item.x}, ${item.z}`,
        ).toBeLessThanOrEqual(1e-3);
      }
    }
    // Not vacuous: where the bank under them is gentle enough, lots stand on it.
    expect(standing).toBeGreaterThan(0);
  });

  it('plans no lot where the ground falls more than its foundation under it', () => {
    // Read from the lots themselves, before any frame stands them: the same
    // stretch of road with the sea 40 m out has its lots on level ground, and
    // with it 22 m out the bank falls 1–2 m under each, so none is planned.
    // A frame would drop them as well (the hairpin case below), but only
    // after the trees were cleared for them.
    const lotsWith = (shore: number) => {
      const corridor = coastCorridor(shore);
      const found: ScatterItem[] = [];
      lotsAt(
        COAST,
        ORIGIN,
        scatterSeed(COAST),
        1_300,
        1_600,
        landClassMask(corridor),
        mappedTown(corridor, []),
        found,
      );
      return found;
    };
    expect(lotsWith(40).length).toBeGreaterThan(5);
    expect(lotsWith(22)).toEqual([]);
    expect(LOT_MAX_GROUND_RANGE_METRES).toBe(FOUNDATION_METRES);
  });

  it('still builds the lots where the ground under them is level', () => {
    // The control: the rule drops a lot on falling ground, not every lot. The
    // road is level for its first kilometre, and a sea 40 m out leaves the
    // lots on level ground.
    const level = lotHouses(40, 500);
    expect(level.houses.length).toBeGreaterThan(5);
    for (const { corners } of level.houses) {
      expect(worstGapUnder(corners, level.ground)).toBeLessThanOrEqual(1e-3);
    }
  });
});

describe('#2761 a house where another leg of the road is drawn under it', () => {
  // A town all round a hairpin: lots stand 15 m from each leg, and on the
  // inside of the bend the ground drawn under part of one can be the other
  // leg's, which `terrainHeightAt` beside its own leg does not see. Measured
  // before #2761: lots 1.7 m above it at a 25 m hairpin, 7.4 m at a 40 m one.
  const hairpinHouses = (radius: number, odometer: number) => {
    const profile = hairpinRoute(radius);
    const corridor: WorldCorridor = {
      routeId: 'shore-houses-hairpin',
      origin: corridorOrigin(profile),
      covered: () => true,
      coveredBoxes: [{ minX: -5_000, maxX: 5_000, minZ: -5_000, maxZ: 5_000 }],
      landUse: [
        {
          layer: 'landuse',
          kind: 'residential',
          rings: [Float32Array.of(-5_000, -5_000, 5_000, -5_000, 5_000, 5_000, -5_000, 5_000)],
        },
      ],
      buildings: [],
      paths: [],
      streets: [],
    };
    return housesIn(frameAt(odometer, landClassMask(corridor), corridor, [], profile));
  };
  // Each frame is read before the next is built: a frame's ground is lent storage
  // (`landform.ts` §`terrainCorridor`), which the next build writes over.
  const SWEEP = [25, 40].flatMap((radius) => [200, 300].map((odometer) => ({ radius, odometer })));

  it('stands no lot house above the ground drawn under it at a hairpin', () => {
    let standing = 0;
    for (const { radius, odometer } of SWEEP) {
      const { houses, ground } = hairpinHouses(radius, odometer);
      standing += houses.length;
      for (const { item, corners } of houses) {
        expect(
          worstGapUnder(corners, ground),
          `${String(radius)} m hairpin at ${String(odometer)}, lot at ${String(item.x)}, ${String(item.z)}`,
        ).toBeLessThanOrEqual(1e-3);
      }
    }
    expect(standing).toBeGreaterThan(50);
  });

  it('lowers a house by no more than its foundation, and drops one that would need more', () => {
    // A lot lowered by metres would stand buried to its eaves on its uphill
    // side: past its foundation's depth again it is not drawn at all.
    let lowered = 0;
    for (const { radius, odometer } of SWEEP) {
      const { houses, ground } = hairpinHouses(radius, odometer);
      for (const { item } of houses) {
        const under = drawnTop(ground.vertices, ground.indices, item.x, item.z);
        expect(under - item.y).toBeLessThanOrEqual(FOUNDATION_METRES + 1e-3);
        if (under - item.y > 1e-3) lowered += 1;
      }
    }
    // Not vacuous: some are lowered, by less than that.
    expect(lowered).toBeGreaterThan(0);
  });
});
