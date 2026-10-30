// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1637: a city centre's street — its wider pavements, its denser street
 * furniture and its terraced blocks — read back through `streetsAt` and
 * `sceneFrame`, the functions a ride's frame is built by, over corridors
 * built from arithmetic (`footprint-fixtures-testing.ts` §`cityStreetscapeFixture`;
 * no OpenStreetMap data, and nothing here is a real place). A village, a
 * town and a ride with no urban class are the controls.
 */

import { describe, expect, it } from 'vitest';

import type { RouteProfile } from '@onyourleft/domain';

import type { Junction } from './cross-streets';
import { cityStreetscapeFixture, denseTownFixture, landBeside } from './footprint-fixtures-testing';
import {
  FACADE_OFFSET,
  FACADE_PLAIN,
  FOOTPRINT_MAX_VERTICES,
  FOOTPRINT_VERTEX_FLOATS,
  footprintPlans,
  mappedTown,
  PARTY_WALL_SAME_HEIGHT_METRES,
  STOREY_METRES,
  STYLE_COMMERCIAL,
  STYLE_OFFSET,
  STYLE_SASH,
  STYLE_SHUTTERS,
  TERRACE_DEPTH_METRES,
  TERRACE_GAP_METRES,
  TERRACE_STOREYS,
  type FootprintPlan,
} from './footprint-buildings';
import { landClassMask, type LandClassMask } from './land-class';
import { ROAD_CLEARANCE_METRES } from './landform';
import { MappedSelection, mappedBuildingsOf, selectMappedBuildings } from './mapped-buildings';
import { MAPPED_BUILDING_DRAW_CALLS, MAPPED_BUILDING_TRIANGLES } from './realistic-budget';
import { distanceToDrawnRoad, nearestOnDrawnRoad } from './road-grid';
import { hairpinRoute, northRoute } from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import type { SceneFrame } from './port';
import { sceneFrame, type SceneInput } from './scene';
import { lotSpacing, type MappedTown } from './settlements';
import { atStartLine } from './simulation';
import {
  BOLLARD_ENDS_METRES,
  CITY_BENCH_SPACING_METRES,
  CITY_LAMP_SPACING_METRES,
  CITY_PAVEMENT_TRIANGLES_PER_PIECE,
  CITY_PAVEMENT_WIDTH_METRES,
  CITY_STREET_METRES,
  DOOR_PATH_TRIANGLES_PER_VILLAGE,
  FURNITURE_DRAW_METRES,
  FURNITURE_KINDS,
  furnitureAlong,
  KERB_LATERAL_METRES,
  LAMP_SPACING_METRES,
  PAVEMENT_TRIANGLES_PER_VILLAGE,
  PAVEMENT_WIDTH_METRES,
  pavementAlong,
  streetsAt,
  type FurnitureItem,
  type PavementMesh,
  type VillageStreet,
} from './streets';
import { corridorOrigin, drawnRoadFrame } from './terrain';
import { FURNITURE_CAPACITY } from './three-renderer';
import type { WorldCorridor } from './world-data/corridor';
import { NO_URBAN_CLASS, urbanClassMap, type UrbanClass, type UrbanClassMap } from './urban-class';

/** Every stretch of every route `urban`, whatever the map says. */
function everywhere(urban: UrbanClass): UrbanClassMap {
  return { classAt: () => urban };
}

/** `urban` from `from` to `to` along the route, `unknown` elsewhere. */
function stretch(urban: UrbanClass, from: number, to: number): UrbanClassMap {
  return { classAt: (along) => (along >= from && along < to ? urban : 'unknown') };
}

/** Six kilometres of level, low farmland running due north, as `streets.test.ts` rides. */
const FARMLAND = northRoute(6_000, () => 40);

/** The top of a pavement: the vertices whose normal is straight up. */
function topOf(mesh: PavementMesh): { readonly x: number; readonly z: number }[] {
  const top = [];
  for (let at = 0; at < mesh.positions.length / 3; at += 1) {
    if ((mesh.normals[at * 3 + 1] as number) > 0.999) {
      top.push({ x: mesh.positions[at * 3] as number, z: mesh.positions[at * 3 + 2] as number });
    }
  }
  return top;
}

/** How far out from the drawn road each vertex of a pavement's top stands. */
function outOf(profile: RouteProfile, mesh: PavementMesh): number[] {
  const origin = corridorOrigin(profile);
  return topOf(mesh).map(
    (vertex) => nearestOnDrawnRoad(profile, origin, vertex.x, vertex.z, 20)?.distance ?? Infinity,
  );
}

/** Where along the road a piece of furniture stands. */
function alongOf(profile: RouteProfile, item: FurnitureItem): number {
  return nearestOnDrawnRoad(profile, corridorOrigin(profile), item.x, item.z, 20)?.along ?? NaN;
}

/** The city centre, its mask, its class and its plans, as the press builds them. */
function pressed(urbanOf: (land: LandClassMask) => UrbanClassMap | undefined) {
  const fixture = cityStreetscapeFixture();
  const land = landClassMask(fixture.corridor);
  const urban = urbanOf(land);
  const { plans } = footprintPlans(
    fixture.corridor,
    land,
    fixture.profile,
    fixture.origin,
    FOOTPRINT_MAX_VERTICES,
    urban,
  );
  const town = mappedTown(fixture.corridor, plans, urban);
  return { ...fixture, land, urban, plans, town };
}

/** The city centre's own class, by #1633's map. */
const CITY = pressed((land) => {
  const { corridor, profile } = cityStreetscapeFixture();
  return urbanClassMap(corridor, land, profile);
});

/** A frame at `along` of a pressed corridor, as `GameView` hands `sceneFrame` one. */
function frameAt(
  press: ReturnType<typeof pressed>,
  along: number,
  extra: Partial<SceneInput> = {},
): SceneFrame {
  return sceneFrame({
    profile: press.profile,
    origin: press.origin,
    state: atStartLine(press.profile),
    riderDistance: along,
    worldCorridor: press.corridor,
    landClass: press.land,
    mappedBuildings: mappedBuildingsOf(press.plans),
    mappedTown: press.town,
    ...extra,
  });
}

describe('the fixture — #1637', () => {
  it('is a city centre from 1 000 m to 2 000 m, by #1633’s own map', () => {
    for (let along = 1_150; along < 1_900; along += 50) {
      expect(CITY.urban?.classAt(along)).toBe('city-centre');
    }
  });
});

describe('a city centre’s pavement — #1637', () => {
  it('is 3.5 m wide in a city centre, read off the streets a frame carries', () => {
    const streets = frameAt(CITY, 1_500).streets.filter((street) => street.wrappedSite < 0);
    // Non-vacuity: the frame carries the city's pieces, on both sides.
    expect(streets.length).toBeGreaterThanOrEqual(3);
    for (const street of streets) {
      const out = outOf(CITY.profile, street.pavement);
      expect(Math.min(...out)).toBeCloseTo(KERB_LATERAL_METRES, 2);
      expect(Math.max(...out)).toBeCloseTo(KERB_LATERAL_METRES + CITY_PAVEMENT_WIDTH_METRES, 2);
    }
    expect(CITY_PAVEMENT_WIDTH_METRES).toBe(3.5);
  });

  it('is 2 m wide along the same road as a village, and in every village', () => {
    const seed = scatterSeed(FARMLAND);
    const origin = corridorOrigin(FARMLAND);
    const city = pavementAlong(FARMLAND, origin, seed, 1, 1_000, 1_400, everywhere('city-centre'));
    const village = pavementAlong(FARMLAND, origin, seed, 1, 1_000, 1_400, everywhere('village'));
    expect(Math.max(...outOf(FARMLAND, city as PavementMesh))).toBeCloseTo(7, 2);
    expect(Math.max(...outOf(FARMLAND, village as PavementMesh))).toBeCloseTo(
      KERB_LATERAL_METRES + PAVEMENT_WIDTH_METRES,
      2,
    );
    const villages = streetsAt(FARMLAND, origin, seed, 0, FARMLAND.totalDistance);
    expect(villages.length).toBeGreaterThan(0);
    for (const street of villages) {
      expect(Math.max(...outOf(FARMLAND, street.pavement))).toBeCloseTo(5.5, 2);
    }
  });

  it('lays a city’s street on both sides only where the class is city-centre', () => {
    const origin = corridorOrigin(FARMLAND);
    const seed = scatterSeed(FARMLAND);
    const city = streetsAt(
      FARMLAND,
      origin,
      seed,
      0,
      FARMLAND.totalDistance,
      undefined,
      undefined,
      stretch('city-centre', 2_000, 2_600),
    ).filter((street) => street.wrappedSite < 0);
    expect(city.length).toBeGreaterThan(0);
    for (const street of city) {
      for (const vertex of topOf(street.pavement)) {
        const along = nearestOnDrawnRoad(FARMLAND, origin, vertex.x, vertex.z, 20)?.along ?? NaN;
        expect(along).toBeGreaterThanOrEqual(2_000 - 2);
        expect(along).toBeLessThanOrEqual(2_600 + 2);
      }
    }
    const sides = new Set(
      city.flatMap((street) => topOf(street.pavement).map((vertex) => Math.sign(vertex.x))),
    );
    expect(sides).toEqual(new Set([1, -1]));
  });

  it('leads each front path from under the back edge of the pavement laid before it, at either width', () => {
    const origin = corridorOrigin(FARMLAND);
    const seed = scatterSeed(FARMLAND);
    for (const [urban, width] of [
      ['village', PAVEMENT_WIDTH_METRES],
      ['city-centre', CITY_PAVEMENT_WIDTH_METRES],
    ] as const) {
      const villages = streetsAt(
        FARMLAND,
        origin,
        seed,
        0,
        FARMLAND.totalDistance,
        undefined,
        undefined,
        everywhere(urban),
      ).filter((street) => street.wrappedSite >= 0);
      const paths = villages.flatMap((street) => street.doorPaths);
      // Non-vacuity: the farmland's villages have plenty of front paths.
      expect(paths.length, urban).toBeGreaterThan(30);
      for (const street of villages) {
        // The strip's own outer edge…
        const edge = Math.max(...outOf(FARMLAND, street.pavement));
        expect(edge, urban).toBeCloseTo(KERB_LATERAL_METRES + width, 2);
        for (const path of street.doorPaths) {
          // …is where the path's pavement end is, 0.3 m under it.
          const start = Math.min(...outOf(FARMLAND, path.mesh));
          expect(start, urban).toBeCloseTo(edge - 0.3, 2);
        }
      }
    }
  });
});

describe('a city centre’s street furniture — #1637', () => {
  const origin = corridorOrigin(FARMLAND);
  const seed = scatterSeed(FARMLAND);
  const furnished = (urban: UrbanClass) =>
    furnitureAlong(FARMLAND, origin, seed, 1, 1_000, 1_400, everywhere(urban));
  const lamps = (items: readonly FurnitureItem[]): number[] =>
    items
      .filter((item) => item.kind === 'lamp-post')
      .map((item) => alongOf(FARMLAND, item))
      .sort((a, b) => a - b);

  it('stands more lamp posts on 400 m of city centre than on the same 400 m as a village, 16 m apart', () => {
    const city = lamps(furnished('city-centre'));
    const village = lamps(furnished('village'));
    expect(city.length).toBeGreaterThan(village.length);
    expect(city.length).toBe(Math.floor(400 / CITY_LAMP_SPACING_METRES));
    for (let at = 1; at < city.length; at += 1) {
      expect((city[at] as number) - (city[at - 1] as number)).toBeCloseTo(
        CITY_LAMP_SPACING_METRES,
        1,
      );
    }
    for (let at = 1; at < village.length; at += 1) {
      expect((village[at] as number) - (village[at - 1] as number)).toBeCloseTo(
        LAMP_SPACING_METRES,
        1,
      );
    }
    // At the back of the wider pavement.
    for (const item of furnished('city-centre')) {
      if (item.kind !== 'lamp-post') continue;
      const out = nearestOnDrawnRoad(FARMLAND, origin, item.x, item.z, 20)?.distance ?? NaN;
      expect(out).toBeCloseTo(KERB_LATERAL_METRES + CITY_PAVEMENT_WIDTH_METRES - 0.35, 2);
    }
  });

  it('sets about twice a village’s benches and bins a metre', () => {
    const benchesPerMetre = (streets: readonly VillageStreet[]): number => {
      let benches = 0;
      let metres = 0;
      for (const street of streets) {
        benches += street.furniture.filter((item) => item.kind === 'bench').length;
        metres += street.walks.reduce((sum, walk) => sum + (walk.length / 3 - 1) * 2, 0);
      }
      return benches / metres;
    };
    const villages = streetsAt(FARMLAND, origin, seed, 0, FARMLAND.totalDistance);
    const city = frameAt(CITY, 1_500).streets.filter((street) => street.wrappedSite < 0);
    const ratio = benchesPerMetre(city) / benchesPerMetre(villages);
    expect(ratio).toBeGreaterThan(1.5);
    expect(ratio).toBeLessThan(2.6);
    // Each bench has its bin.
    for (const street of city) {
      const count = (kind: string) => street.furniture.filter((item) => item.kind === kind).length;
      expect(count('bin')).toBe(count('bench'));
    }
    expect(CITY_BENCH_SPACING_METRES).toBe(3 * CITY_LAMP_SPACING_METRES);
  });

  it('stands bollards at a side road’s mouth and at the street’s ends, and none where one piece meets the next', () => {
    const junction: Junction = {
      along: 1_500,
      source: 'mapped',
      arms: [{ side: 1, angleDegrees: 90, widthClass: 'minor', line: new Float32Array(0) }],
    };
    const streets = streetsAt(
      FARMLAND,
      origin,
      seed,
      0,
      FARMLAND.totalDistance,
      undefined,
      undefined,
      stretch('city-centre', 1_000, 2_000),
      [junction],
    ).filter((street) => street.wrappedSite < 0);
    const bollards = streets
      .flatMap((street) => street.furniture)
      .filter((item) => item.kind === 'bollard')
      .map((item) => ({ along: alongOf(FARMLAND, item), side: Math.sign(item.x) }));
    // Every piece end inside the stretch is no break: no bollard near one.
    for (let end = 1_056; end < 2_000; end += CITY_STREET_METRES) {
      if (Math.abs(end - 1_500) < 10) continue;
      expect(bollards.filter((bollard) => Math.abs(bollard.along - end) < 3)).toEqual([]);
    }
    // The junction's side has two pairs at its mouth; the other side runs past it.
    const near = bollards.filter((bollard) => Math.abs(bollard.along - 1_500) < 10);
    expect(near.length).toBe(2 * BOLLARD_ENDS_METRES.length);
    expect(new Set(near.map((bollard) => bollard.side)).size).toBe(1);
    // And a pair at each end of the stretch, each side.
    expect(bollards.filter((bollard) => bollard.along < 1_010).length).toBe(4);
    expect(bollards.filter((bollard) => bollard.along > 1_990).length).toBe(4);
  });

  it('never passes the furniture belt’s capacity on #1540’s dense town as a city centre', () => {
    const town = denseTownFixture();
    const townSeed = scatterSeed(town.profile);
    // A side road every 60 m on alternate sides: more breaks, more bollards.
    const junctions: Junction[] = [];
    for (let along = 100; along < 1_400; along += 60) {
      junctions.push({
        along,
        source: 'mapped',
        arms: [
          {
            side: junctions.length % 2 === 0 ? 1 : -1,
            angleDegrees: 90,
            widthClass: 'minor',
            line: new Float32Array(0),
          },
        ],
      });
    }
    const streets = streetsAt(
      town.profile,
      town.origin,
      townSeed,
      0,
      town.profile.totalDistance,
      undefined,
      landClassMask(town.corridor),
      everywhere('city-centre'),
      junctions,
    );
    const items = streets.flatMap((street) => street.furniture);
    let most = 0;
    for (let along = 0; along <= town.profile.totalDistance; along += 4) {
      const camera = drawnRoadFrame(town.profile, town.origin, along);
      if (camera === undefined) continue;
      for (const kind of FURNITURE_KINDS) {
        const count = items.filter(
          (item) =>
            item.kind === kind &&
            Math.hypot(item.x - camera.x, item.z - camera.z) <= FURNITURE_DRAW_METRES,
        ).length;
        expect(count, `${kind} at ${String(along)} m`).toBeLessThanOrEqual(FURNITURE_CAPACITY);
        most = Math.max(most, count);
      }
    }
    // Non-vacuity: a city's lamp posts are a good share of the capacity.
    expect(most).toBeGreaterThan(FURNITURE_CAPACITY / 3);
  });
});

describe('what a city centre’s street costs — #1637', () => {
  it('lays no piece heavier than its stated triangles, and a frame’s inside two villages’ streets', () => {
    for (let along = 1_000; along <= 2_000; along += 25) {
      const streets = frameAt(CITY, along).streets;
      let triangles = 0;
      for (const street of streets) {
        const own = street.pavement.indices.length / 3;
        if (street.wrappedSite < 0)
          expect(own).toBeLessThanOrEqual(CITY_PAVEMENT_TRIANGLES_PER_PIECE);
        triangles += own;
        for (const path of street.doorPaths) triangles += path.mesh.indices.length / 3;
      }
      expect(triangles).toBeLessThanOrEqual(
        2 * (PAVEMENT_TRIANGLES_PER_VILLAGE + DOOR_PATH_TRIANGLES_PER_VILLAGE),
      );
    }
    expect(CITY_PAVEMENT_TRIANGLES_PER_PIECE).toBe(584);
  });

  it('builds each piece once: the same objects every frame', () => {
    const first = frameAt(CITY, 1_500).streets;
    const again = frameAt(CITY, 1_500).streets;
    expect(again).toEqual(first);
    first.forEach((street, at) => expect(again[at]).toBe(street));
  });
});

/** One vertex of a plan's walls: where it is, its facade's `top` and its style's flags. */
interface Vertex {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly top: number;
  readonly flags: number;
}

/** Every vertex of a plan's `wall` triangles, in order — #1719. */
function wallVertices(plan: FootprintPlan): Vertex[] {
  const floats = plan.triangles.wall;
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

describe('a city centre’s lots — #1637', () => {
  const terraces = (plans: readonly FootprintPlan[]) =>
    plans.filter((plan) => plan.urban === 'city-centre' && TERRACE_STOREYS.includes(plan.storeys));

  it('are terraced blocks: 3 or 4 storeys, a flat roof under a cornice, a shop front, no porch, drive or garage', () => {
    const frame = frameAt(CITY, 1_500);
    const inView = frame.mappedBuildings;
    expect(inView).toBeDefined();
    const selection = new MappedSelection();
    selectMappedBuildings(
      inView!.buildings,
      inView!.x,
      inView!.z,
      MAPPED_BUILDING_TRIANGLES,
      selection,
      MAPPED_BUILDING_DRAW_CALLS,
    );
    const drawn = Array.from(selection.plans.subarray(0, selection.count)).map(
      (index) => inView!.buildings.plans[index] as FootprintPlan,
    );
    const blocks = terraces(drawn);
    // Non-vacuity: the drawn set beside the rider is mostly the street's blocks.
    expect(blocks.length).toBeGreaterThan(10);
    const storeys = new Set<number>();
    for (const plan of blocks) {
      expect(TERRACE_STOREYS).toContain(plan.storeys);
      storeys.add(plan.storeys);
      expect(plan.eaves - plan.base).toBeGreaterThanOrEqual(plan.storeys * STOREY_METRES);
      expect(plan.roof).toBe('flat');
      expect(plan.shop.front).toBe(true);
      expect(plan.shop.cornice).toBe(true);
      expect(plan.porch).toBe(false);
      expect(plan.garage).toBe(false);
      expect(plan.driveway.length).toBe(0);
      expect(plan.model).toBeUndefined();
    }
    expect([...storeys].sort()).toEqual([3, 4]);
  });

  it('stands no house lot in the city centre: the structure list holds none beside its road', () => {
    const frame = frameAt(CITY, 1_500);
    const houses = frame.scatter.filter(
      (item) => (item.kind === 'building' || item.kind === 'shop-row') && item.paint !== undefined,
    );
    expect(houses).toEqual([]);
  });

  it('builds no house lot where the class is city-centre, even where no block stands', () => {
    // The town without its blocks: only the class keeps the houses off.
    const { corridor, plans, urban } = CITY;
    const mapped = plans.filter((plan) => plan.storeys >= 5);
    const lots = (town: MappedTown) =>
      frameAt({ ...CITY, plans: mapped, town }, 1_500).scatter.filter(
        (item) => item.paint !== undefined,
      );
    // Non-vacuity: with no class, the frontage is lotted.
    expect(lots(mappedTown(corridor, mapped)).length).toBeGreaterThan(5);
    expect(lots(mappedTown(corridor, mapped, urban))).toEqual([]);
  });

  it('is a shop below whatever the land: on land the map calls houses, too', () => {
    const fixture = cityStreetscapeFixture(undefined, 'residential');
    const land = landClassMask(fixture.corridor);
    const { plans } = footprintPlans(
      fixture.corridor,
      land,
      fixture.profile,
      fixture.origin,
      FOOTPRINT_MAX_VERTICES,
      stretch('city-centre', 1_000, 2_000),
    );
    const blocks = terraces(plans);
    expect(blocks.length).toBeGreaterThan(30);
    for (const plan of blocks) {
      expect(plan.roof).toBe('flat');
      expect(plan.shop.front).toBe(true);
      expect(plan.porch).toBe(false);
      expect(plan.garage).toBe(false);
    }
  });

  it('are packed edge to edge along each side, from behind the pavement, with no side yard', () => {
    const blocks = terraces(CITY.plans);
    const { span } = lotSpacing(CITY.profile);
    for (const side of [1, -1]) {
      const mine = blocks
        .filter(
          (plan) =>
            Math.sign(plan.centroid.x) ===
            Math.sign(side * drawnRoadFrame(CITY.profile, CITY.origin, 1_500)!.normalX),
        )
        .sort((a, b) => a.centroid.z - b.centroid.z);
      expect(mine.length).toBeGreaterThan(30);
      let touching = 0;
      for (let at = 1; at < mine.length; at += 1) {
        const gap =
          (mine[at] as FootprintPlan).centroid.z - (mine[at - 1] as FootprintPlan).centroid.z;
        if (Math.abs(gap - span) < 0.05) touching += 1;
      }
      // Every neighbour one plot on, but where a park breaks the street.
      expect(touching).toBeGreaterThanOrEqual(mine.length - 3);
      for (const plan of mine) {
        const out: number[] = [];
        for (let at = 0; at + 1 < plan.footprint.length; at += 2) {
          out.push(
            distanceToDrawnRoad(
              CITY.profile,
              CITY.origin,
              plan.footprint[at] as number,
              plan.footprint[at + 1] as number,
              60,
            ),
          );
        }
        const front = KERB_LATERAL_METRES + CITY_PAVEMENT_WIDTH_METRES + TERRACE_GAP_METRES;
        expect(Math.min(...out)).toBeCloseTo(front, 1);
        expect(Math.max(...out)).toBeCloseTo(front + TERRACE_DEPTH_METRES, 1);
        // Its long front is a whole plot, so the next block's wall is its own.
        const zs = Array.from(plan.footprint).filter((_, index) => index % 2 === 1);
        expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(span, 1);
      }
    }
  });

  it('shares each side wall with the next block: no window on it, and only the strip above a lower neighbour — #1719', () => {
    // #1635's party walls, on #1637's blocks: read off the plans the press
    // hands back. The road runs due north, so a shared side is the plane
    // `z` = the boundary between two plots, from the block's front to its back.
    const blocks = terraces(CITY.plans);
    const { span } = lotSpacing(CITY.profile);
    const normalX = drawnRoadFrame(CITY.profile, CITY.origin, 1_500)!.normalX;
    /** The wall triangles of `plan` whose three corners lie on the plane `z` = `at`, within its own reach across. */
    const onFace = (plan: FootprintPlan, at: number): Vertex[][] => {
      const xs = Array.from(plan.footprint).filter((_, index) => index % 2 === 0);
      const [low, high] = [Math.min(...xs) - 0.1, Math.max(...xs) + 0.1];
      const vertices = wallVertices(plan);
      const triangles: Vertex[][] = [];
      for (let i = 0; i + 2 < vertices.length; i += 3) {
        const three = vertices.slice(i, i + 3);
        if (three.every((v) => Math.abs(v.z - at) < 0.25 && v.x > low && v.x < high)) {
          triangles.push(three);
        }
      }
      return triangles;
    };
    let level = 0;
    let stepped = 0;
    let ends = 0;
    for (const side of [1, -1]) {
      const mine = blocks
        .filter((plan) => Math.sign(plan.centroid.x) === Math.sign(side * normalX))
        .sort((a, b) => a.centroid.z - b.centroid.z);
      for (let at = 1; at < mine.length; at += 1) {
        const a = mine[at - 1] as FootprintPlan;
        const b = mine[at] as FootprintPlan;
        const boundary = (a.centroid.z + b.centroid.z) / 2;
        if (Math.abs(b.centroid.z - a.centroid.z - span) > 0.05) {
          // The control: a side no block stands against is a wall, windows and all.
          const end = onFace(a, a.centroid.z + span / 2).flat();
          expect(end.length).toBeGreaterThan(0);
          expect(end.some((v) => v.top > 0)).toBe(true);
          ends += 1;
          continue;
        }
        if (Math.abs(a.eaves - b.eaves) <= PARTY_WALL_SAME_HEIGHT_METRES) {
          // The same height: neither draws the shared face at all.
          expect(onFace(a, boundary)).toHaveLength(0);
          expect(onFace(b, boundary)).toHaveLength(0);
          level += 1;
          continue;
        }
        const [tall, low] = a.eaves > b.eaves ? [a, b] : [b, a];
        const shared = onFace(tall, boundary).flat();
        expect(shared.length).toBeGreaterThan(0);
        expect(Math.min(...shared.map((v) => v.y))).toBeCloseTo(low.eaves, 3);
        expect(Math.max(...shared.map((v) => v.y))).toBeCloseTo(tall.eaves, 3);
        for (const v of shared) {
          expect(v.top).toBe(FACADE_PLAIN);
          expect(v.flags & (STYLE_SASH | STYLE_SHUTTERS | STYLE_COMMERCIAL)).toBe(0);
        }
        // The lower one's is behind the taller's wall: not drawn.
        expect(onFace(low, boundary)).toHaveLength(0);
        stepped += 1;
      }
    }
    // Non-vacuity: both kinds of neighbour, and the ends the control reads.
    expect(level).toBeGreaterThan(5);
    expect(stepped).toBeGreaterThan(5);
    expect(ends).toBeGreaterThan(0);
  });

  it('keeps every wall of every block off the pavement, on a bend too', () => {
    // The chord between a plot's two ends sags toward the road on a curve's outside.
    let kept = 0;
    let least = Number.POSITIVE_INFINITY;
    for (const radius of [30, 60]) {
      const profile = hairpinRoute(radius);
      const origin = corridorOrigin(profile);
      const corridor: WorldCorridor = {
        routeId: 'bend',
        origin,
        covered: () => true,
        coveredBoxes: [{ minX: -2_000, maxX: 2_000, minZ: -2_000, maxZ: 2_000 }],
        // In 10 m pieces: a quad from end to end would cut every curve.
        landUse: Array.from({ length: Math.ceil(profile.totalDistance / 10) }, (_, piece) =>
          landBeside(
            profile,
            origin,
            'landuse',
            'commercial',
            piece * 10,
            Math.min(piece * 10 + 11, profile.totalDistance),
            -40,
            40,
          ),
        ),
        buildings: [],
        paths: [],
        streets: [],
      };
      const land = landClassMask(corridor);
      const { plans } = footprintPlans(
        corridor,
        land,
        profile,
        origin,
        FOOTPRINT_MAX_VERTICES,
        everywhere('city-centre'),
      );
      const blocks = terraces(plans);
      kept += blocks.length;
      for (const plan of blocks) {
        const ring = plan.footprint;
        for (let at = 0; at + 1 < ring.length; at += 2) {
          const next = (at + 2) % ring.length;
          const ax = ring[at] as number;
          const az = ring[at + 1] as number;
          const dx = (ring[next] as number) - ax;
          const dz = (ring[next + 1] as number) - az;
          for (let step = 0; step <= 40; step += 1) {
            const t = step / 40;
            least = Math.min(
              least,
              distanceToDrawnRoad(profile, origin, ax + dx * t, az + dz * t, 60),
            );
          }
        }
      }
    }
    // Non-vacuity: the straighter stretches still carry blocks.
    expect(kept).toBeGreaterThan(5);
    expect(least).toBeGreaterThanOrEqual(KERB_LATERAL_METRES + CITY_PAVEMENT_WIDTH_METRES - 0.01);
  });

  it('stands none on the park, and none within the road’s clearance', () => {
    const blocks = terraces(CITY.plans);
    for (const plan of blocks) {
      for (let at = 0; at + 1 < plan.footprint.length; at += 2) {
        const x = plan.footprint[at] as number;
        const z = plan.footprint[at + 1] as number;
        expect(CITY.land.classAt(x, z)).toBe('built-up');
        expect(distanceToDrawnRoad(CITY.profile, CITY.origin, x, z, 60)).toBeGreaterThanOrEqual(
          ROAD_CLEARANCE_METRES,
        );
      }
    }
    // The park's stretch, on its side, has no block.
    const park = blocks.filter(
      (plan) =>
        plan.centroid.z > 1_395 &&
        plan.centroid.z < 1_445 &&
        Math.sign(plan.centroid.x) ===
          Math.sign(drawnRoadFrame(CITY.profile, CITY.origin, 1_420)!.normalX),
    );
    expect(park).toEqual([]);
  });

  it('builds today’s houses on the same land as a town', () => {
    const town = pressed(() => everywhere('town'));
    expect(terraces(town.plans)).toEqual([]);
    expect(town.plans.filter((plan) => plan.storeys < 5)).toEqual([]);
    const frame = frameAt(town, 1_500);
    const houses = frame.scatter.filter(
      (item) => item.kind === 'building' && item.paint !== undefined,
    );
    // Non-vacuity: a town's lots stand on its built-up frontage.
    expect(houses.length).toBeGreaterThan(5);
    // And exactly the lots of a ride with no class.
    const none = pressed(() => undefined);
    const noneFrame = frameAt(none, 1_500);
    expect(frame.scatter.filter((item) => item.paint !== undefined)).toEqual(
      noneFrame.scatter.filter((item) => item.paint !== undefined),
    );
  });
});

describe('no data, no change — #1637, ADR 0054 D-4', () => {
  it('plans no block and lays no city street with no class, or with every stretch unknown', () => {
    for (const urban of [undefined, NO_URBAN_CLASS]) {
      const press = pressed(() => urban);
      expect(press.plans.filter((plan) => plan.storeys < 5)).toEqual([]);
      expect(frameAt(press, 1_500).streets.filter((street) => street.wrappedSite < 0)).toEqual([]);
    }
  });

  it('leaves every village street as it was', () => {
    const origin = corridorOrigin(FARMLAND);
    const seed = scatterSeed(FARMLAND);
    const before = streetsAt(FARMLAND, origin, seed, 0, FARMLAND.totalDistance);
    const after = streetsAt(
      FARMLAND,
      origin,
      seed,
      0,
      FARMLAND.totalDistance,
      undefined,
      undefined,
      NO_URBAN_CLASS,
    );
    expect(after).toEqual(before);
  });

  it('reads the town’s class off the mapped town the frame carries, and none without one', () => {
    const plain: MappedTown = mappedTown(CITY.corridor, CITY.plans);
    expect(plain.urban).toBeUndefined();
    expect(CITY.town.urban).toBe(CITY.urban);
  });
});
