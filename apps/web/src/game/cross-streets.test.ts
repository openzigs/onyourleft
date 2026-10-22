// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cross streets — #1565. Read back through `sideRoadsAt` and `sceneFrame`,
 * the path a ride's frames take: where a junction is found and where none
 * is, the side roads' meshes at the fixture's own angles, what may not stand
 * on them, and what they cost.
 */

import { describe, expect, it } from 'vitest';

import { metres, type RouteProfile } from '@onyourleft/domain';
import type { StreetFeature } from '@onyourleft/map-features';

import {
  JUNCTION_TOLERANCE_METRES,
  mappedJunctions,
  onSideRoad,
  SIDE_ROAD_FADE_METRES,
  SIDE_ROAD_FRAME_TRIANGLES,
  SIDE_ROAD_LIFT_METRES,
  SIDE_ROAD_RAMP_METRES,
  SIDE_ROAD_METRES,
  SIDE_ROAD_SINK_METRES,
  SIDE_ROAD_TRIANGLES_PER_ARM,
  SIDE_ROAD_WIDTHS,
  SIDE_ROADS_PER_FRAME,
  sideRoadsAt,
  widthClassOf,
  type Junction,
  type SideRoad,
} from './cross-streets';
import { terrainHeightAt, VERGE_DROP_METRES } from './landform';
import { BILLBOARD_FOOTPRINT } from './logo-board';
import { distanceToDrawnRoad } from './road-grid';
import { northRoute } from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import { sceneFrame } from './scene';
import {
  PLOT_METRES,
  siteAt,
  siteSpacing,
  STRUCTURE_FOOTPRINTS,
  villagePlots,
  type Site,
} from './settlements';
import { atStartLine } from './simulation';
import { corridorOrigin, drawnRoadFrame, MARKING_COLOUR } from './terrain';
import type { WorldCorridor } from './world-data/corridor';

/** Six kilometres of level, low farmland running due north. */
const FARMLAND = northRoute(6_000, () => 40);
const ORIGIN = corridorOrigin(FARMLAND);
const SEED = scatterSeed(FARMLAND);

function roadAt(along: number, profile: RouteProfile = FARMLAND) {
  const frame = drawnRoadFrame(profile, corridorOrigin(profile), along);
  if (frame === undefined) throw new Error(`no road at ${String(along)}`);
  return { ...frame, forwardX: frame.normalZ, forwardZ: -frame.normalX };
}

/**
 * A straight street leaving the road at `along` on `side`, `angle` degrees
 * from the road's forward direction, from `from` metres out to `length`.
 */
function leaving(
  along: number,
  side: 1 | -1,
  angle: number,
  length: number,
  from = 0,
  kind = 'minor_road',
  kindDetail = 'residential',
): StreetFeature {
  const here = roadAt(along);
  const radians = (angle * Math.PI) / 180;
  const dx = here.forwardX * Math.cos(radians) + here.normalX * side * Math.sin(radians);
  const dz = here.forwardZ * Math.cos(radians) + here.normalZ * side * Math.sin(radians);
  return {
    kind,
    kindDetail,
    line: Float32Array.from([
      here.x + dx * from,
      here.z + dz * from,
      here.x + dx * length,
      here.z + dz * length,
    ]),
  };
}

/** A straight street right across the road at `along`, `half` metres each side, square to it. */
function across(along: number, half: number, kind = 'minor_road'): StreetFeature {
  const here = roadAt(along);
  return {
    kind,
    kindDetail: '',
    line: Float32Array.from([
      here.x - here.normalX * half,
      here.z - here.normalZ * half,
      here.x + here.normalX * half,
      here.z + here.normalZ * half,
    ]),
  };
}

/** A street beside the road from `from` to `to`, `offset` metres out on the right. */
function beside(from: number, to: number, offset: number): StreetFeature {
  const points: number[] = [];
  for (let along = from; along <= to; along += 10) {
    const here = roadAt(along);
    points.push(here.x + here.normalX * offset, here.z + here.normalZ * offset);
  }
  return { kind: 'minor_road', kindDetail: 'residential', line: Float32Array.from(points) };
}

function corridorOf(
  streets: readonly StreetFeature[],
  covered: (x: number, z: number) => boolean = () => true,
): WorldCorridor {
  return {
    routeId: 'cross-streets-fixture',
    origin: ORIGIN,
    covered,
    coveredBoxes: [],
    landUse: [],
    buildings: [],
    paths: [],
    streets,
  };
}

/** Every village of the farmland. */
function villagesOf(profile: RouteProfile = FARMLAND): readonly Site[] {
  const { sites } = siteSpacing(profile);
  const found: Site[] = [];
  for (let index = 0; index < sites; index += 1) {
    const site = siteAt(profile, scatterSeed(profile), index);
    if (site?.kind === 'village') found.push(site);
  }
  return found;
}

/** An odometer reading at least `clear` metres from every village's ground. */
function awayFromVillages(clear: number, after = 200): number {
  const villages = villagesOf();
  for (let along = after; along < FARMLAND.totalDistance - 200; along += 10) {
    if (villages.every((site) => Math.abs(site.centre - along) > site.half + clear)) return along;
  }
  throw new Error('no open country on the fixture');
}

/**
 * A side road's tarmac vertices, `[x, y, z]`, read off its mesh: its top
 * surface, so a skirt's foot under an edge is left out (the highest vertex
 * at each place in plan).
 */
function tarmac(road: SideRoad): [number, number, number][] {
  const { positions, colours } = road.mesh;
  const top = new Map<string, [number, number, number]>();
  for (let at = 0; at < positions.length / 3; at += 1) {
    // Paint is near white; tarmac is dark.
    if ((colours[at * 3] as number) > 0.5) continue;
    const x = positions[at * 3] as number;
    const y = positions[at * 3 + 1] as number;
    const z = positions[at * 3 + 2] as number;
    const key = `${x.toFixed(3)} ${z.toFixed(3)}`;
    const known = top.get(key);
    if (known === undefined || known[1] < y) top.set(key, [x, y, z]);
  }
  return [...top.values()];
}

/**
 * The heading of each of a side road's arms READ OFF ITS MESH: the tarmac on
 * each side of the road, from the junction to the vertices farthest out — in
 * degrees from the road's forward direction, by side.
 */
function meshAngles(road: SideRoad): Map<1 | -1, number> {
  const here = roadAt(road.junction.along);
  const angles = new Map<1 | -1, number>();
  for (const side of [1, -1] as const) {
    const mine = tarmac(road).filter(
      ([x, , z]) => ((x - here.x) * here.normalX + (z - here.z) * here.normalZ) * side > 0,
    );
    if (mine.length === 0) continue;
    const far = Math.max(...mine.map(([x, , z]) => Math.hypot(x - here.x, z - here.z)));
    const end = mine.filter(([x, , z]) => Math.hypot(x - here.x, z - here.z) > far - 6);
    const cx = end.reduce((sum, [x]) => sum + x, 0) / end.length;
    const cz = end.reduce((sum, [, , z]) => sum + z, 0) / end.length;
    const length = Math.hypot(cx - here.x, cz - here.z);
    const cosine = ((cx - here.x) * here.forwardX + (cz - here.z) * here.forwardZ) / length;
    angles.set(side, (Math.acos(cosine) * 180) / Math.PI);
  }
  return angles;
}

describe('where a mapped junction is — #1565', () => {
  const t = awayFromVillages(150);
  const cross = awayFromVillages(150, t + 300);
  const corridor = corridorOf([
    // A T on the right, leaning forward at 60°.
    leaving(t, 1, 60, 120),
    // A crossroads: one street straight across.
    across(cross, 120),
  ]);
  const junctions = mappedJunctions(corridor, FARMLAND, ORIGIN, SEED);

  it('finds a T and a crossroads, at their distances, sides and angles', () => {
    expect(junctions).toHaveLength(2);
    const [tee, crossing] = junctions as [Junction, Junction];
    expect(tee.along).toBeCloseTo(t, -0.5);
    expect(tee.arms.map((arm) => arm.side)).toEqual([1]);
    expect(tee.arms[0]?.angleDegrees).toBeCloseTo(60, 0);
    expect(crossing.along).toBeCloseTo(cross, -0.5);
    expect(crossing.arms.map((arm) => arm.side)).toEqual([-1, 1]);
    for (const arm of crossing.arms) expect(arm.angleDegrees).toBeCloseTo(90, 0);
    expect(junctions.every((junction) => junction.source === 'mapped')).toBe(true);
  });

  it('is built once a corridor: the same array after', () => {
    expect(mappedJunctions(corridor, FARMLAND, ORIGIN, SEED)).toBe(junctions);
  });

  it('finds none for a street along the route, beside it, too short, or not meeting it', () => {
    const along = awayFromVillages(150, cross + 300);
    const none = mappedJunctions(
      corridorOf([
        // The route's own street, mapped: on the route the whole way.
        beside(along, along + 200, 1),
        // A street beside the route, 30 m off it.
        beside(along, along + 200, 30),
        // A shallow fork, 20° off the road.
        leaving(along + 300, 1, 20, 120),
        // A stub: 9 m past the tolerance.
        leaving(along + 500, -1, 90, JUNCTION_TOLERANCE_METRES + 6),
        // A street that ends short of the road, beyond the tolerance.
        leaving(along + 700, 1, 90, 120, JUNCTION_TOLERANCE_METRES + 2),
      ]),
      FARMLAND,
      ORIGIN,
      SEED,
    );
    expect(none).toEqual([]);
    // The control: the same street ending inside the tolerance is a T.
    const one = mappedJunctions(
      corridorOf([leaving(along + 700, 1, 90, 120, JUNCTION_TOLERANCE_METRES - 2)]),
      FARMLAND,
      ORIGIN,
      SEED,
    );
    expect(one).toHaveLength(1);
  });

  it('reads nothing where the land was not read', () => {
    expect(
      mappedJunctions(
        corridorOf([leaving(t, 1, 60, 120)], () => false),
        FARMLAND,
        ORIGIN,
        SEED,
      ),
    ).toEqual([]);
  });

  it('makes one arm of a street split at the junction’s node', () => {
    const at = awayFromVillages(150, cross + 1_500);
    const split = mappedJunctions(
      corridorOf([leaving(at, 1, 90, 120), leaving(at + 1, 1, 92, 120)]),
      FARMLAND,
      ORIGIN,
      SEED,
    );
    expect(split).toHaveLength(1);
    expect(split[0]?.arms).toHaveLength(1);
  });

  it('sizes each side road by its mapped width class', () => {
    expect(widthClassOf({ kind: 'highway', kindDetail: 'motorway' })).toBe('highway');
    expect(widthClassOf({ kind: 'major_road', kindDetail: 'primary' })).toBe('major');
    expect(widthClassOf({ kind: 'minor_road', kindDetail: 'residential' })).toBe('minor');
    expect(widthClassOf({ kind: 'minor_road', kindDetail: 'service' })).toBe('service');
    expect(widthClassOf({ kind: 'other', kindDetail: 'alley' })).toBe('service');
  });
});

describe('what a side road is — #1565', () => {
  const t = awayFromVillages(150);
  const cross = awayFromVillages(150, t + 300);
  const corridor = corridorOf([leaving(t, 1, 60, 120), across(cross, 120, 'highway')]);
  const mapped = mappedJunctions(corridor, FARMLAND, ORIGIN, SEED);
  const roads = sideRoadsAt(FARMLAND, ORIGIN, SEED, t - 100, cross + 100, t, mapped);
  const mappedRoads = roads.filter((road) => road.junction.source === 'mapped');

  it('is drawn at the fixture’s angles, read back from its mesh', () => {
    expect(mappedRoads).toHaveLength(2);
    const [tee, crossing] = mappedRoads as [SideRoad, SideRoad];
    const teeAngles = meshAngles(tee);
    expect([...teeAngles.keys()]).toEqual([1]);
    expect(teeAngles.get(1)).toBeCloseTo(60, -0.5);
    const crossAngles = meshAngles(crossing);
    expect([...crossAngles.keys()].sort()).toEqual([-1, 1]);
    for (const angle of crossAngles.values()) expect(angle).toBeCloseTo(90, -0.5);
  });

  it('runs its stated length from the main road’s edge, at its width, and never on the carriageway', () => {
    const crossing = mappedRoads[1] as SideRoad;
    const here = roadAt(crossing.junction.along);
    const half = SIDE_ROAD_WIDTHS.highway / 2;
    for (const [x, , z] of tarmac(crossing)) {
      expect(distanceToDrawnRoad(FARMLAND, ORIGIN, x, z, 10)).toBeGreaterThan(3.5 - 0.05);
      // Square to the road: every vertex within its half-width of the junction's normal line.
      const along = (x - here.x) * here.forwardX + (z - here.z) * here.forwardZ;
      expect(Math.abs(along)).toBeLessThanOrEqual(half + 0.05);
    }
    const out = tarmac(crossing).map(([x, , z]) =>
      Math.abs((x - here.x) * here.normalX + (z - here.z) * here.normalZ),
    );
    expect(Math.max(...out)).toBeCloseTo(3.5 + SIDE_ROAD_METRES, 0);
    expect(Math.min(...out)).toBeCloseTo(3.5, 1);
  });

  it('meets the road at its height, stands on the ground, and goes under it at its end', () => {
    const crossing = mappedRoads[1] as SideRoad;
    const here = roadAt(crossing.junction.along);
    const road = 40 - ORIGIN.elevation;
    for (const [x, y, z] of tarmac(crossing)) {
      const lateral = (x - here.x) * here.normalX + (z - here.z) * here.normalZ;
      const along = (x - here.x) * here.forwardX + (z - here.z) * here.forwardZ;
      const ground = terrainHeightAt(
        FARMLAND,
        ORIGIN,
        SEED,
        crossing.junction.along + along,
        lateral,
      );
      const out = Math.abs(lateral) - 3.5;
      if (out < 0.01) expect(y).toBeCloseTo(road + SIDE_ROAD_LIFT_METRES, 2);
      else if (out > SIDE_ROAD_RAMP_METRES && out < SIDE_ROAD_METRES - SIDE_ROAD_FADE_METRES) {
        // On the ground, and never more than the verge's drop above it.
        expect(y - ground).toBeGreaterThanOrEqual(SIDE_ROAD_LIFT_METRES - 1e-3);
        expect(y - ground).toBeLessThanOrEqual(SIDE_ROAD_LIFT_METRES + VERGE_DROP_METRES);
      } else if (out > SIDE_ROAD_METRES - 0.5) {
        expect(y - ground).toBeCloseTo(-SIDE_ROAD_SINK_METRES, 2);
      }
    }
  });

  it('carries a give-way line of the road’s own paint at each mouth', () => {
    for (const road of mappedRoads) {
      const { positions, colours } = road.mesh;
      const white = ((MARKING_COLOUR >> 16) & 0xff) / 255;
      const here = roadAt(road.junction.along);
      const paint: number[] = [];
      for (let at = 0; at < positions.length / 3; at += 1) {
        if ((colours[at * 3] as number) < 0.5) continue;
        paint.push(
          Math.abs(
            ((positions[at * 3] as number) - here.x) * here.normalX +
              ((positions[at * 3 + 2] as number) - here.z) * here.normalZ,
          ),
        );
      }
      expect(white).toBeGreaterThan(0.9);
      expect(paint.length).toBeGreaterThan(0);
      // Just past the mouth: within four metres of the main road's edge, and the arm's half-width.
      const half = Math.max(
        ...road.junction.arms.map((arm) => SIDE_ROAD_WIDTHS[arm.widthClass] / 2),
      );
      for (const out of paint) expect(out).toBeLessThan(3.5 + 4 + half);
    }
  });

  it('costs each arm no more than its stated triangles, and a frame no more than its own', () => {
    // The heaviest: a highway, square and at the shallowest angle kept.
    const at = awayFromVillages(150, cross + 1_500);
    const heavy = mappedJunctions(
      corridorOf([across(at, 120, 'highway'), leaving(at + 400, 1, 31, 150, 0, 'highway')]),
      FARMLAND,
      ORIGIN,
      SEED,
    );
    const built = sideRoadsAt(FARMLAND, ORIGIN, SEED, at - 50, at + 450, at, heavy);
    const arms = built.flatMap((road) => road.junction.arms);
    expect(arms.length).toBeGreaterThanOrEqual(3);
    for (const road of built) {
      expect(road.mesh.indices.length / 3).toBeLessThanOrEqual(
        road.junction.arms.length * SIDE_ROAD_TRIANGLES_PER_ARM,
      );
    }
    // Non-vacuity: the heaviest arm is near the bound, not far under it.
    const square = built.find((road) => road.junction.arms.length === 2) as SideRoad;
    expect(square.mesh.indices.length / 3 / 2).toBeGreaterThan(SIDE_ROAD_TRIANGLES_PER_ARM * 0.8);
    expect(SIDE_ROAD_FRAME_TRIANGLES).toBe(2_880);
  });

  it('draws at most its arms a frame, nearest the rider first', () => {
    const from = awayFromVillages(200, 1_000);
    const streets: StreetFeature[] = [];
    for (let along = from; along < from + 600; along += 20) streets.push(across(along, 100));
    const many = mappedJunctions(corridorOf(streets), FARMLAND, ORIGIN, SEED);
    expect(many.length).toBeGreaterThan(SIDE_ROADS_PER_FRAME / 2);
    const drawn = sideRoadsAt(FARMLAND, ORIGIN, SEED, from - 60, from + 600, from + 300, many);
    const arms = drawn.reduce((sum, road) => sum + road.junction.arms.length, 0);
    expect(arms).toBeLessThanOrEqual(SIDE_ROADS_PER_FRAME);
    expect(arms).toBeGreaterThan(SIDE_ROADS_PER_FRAME - 2);
    const gaps = drawn.map((road) => Math.abs(road.junction.along - (from + 300)));
    const kept = Math.max(...gaps);
    for (const junction of many) {
      if (!drawn.some((road) => road.junction === junction)) {
        expect(Math.abs(junction.along - (from + 300))).toBeGreaterThanOrEqual(kept);
      }
    }
  });

  it('is the same objects every call', () => {
    const again = sideRoadsAt(FARMLAND, ORIGIN, SEED, t - 100, cross + 100, t, mapped);
    again.forEach((road, index) => expect(road).toBe(roads[index]));
  });
});

describe('a procedural village’s crossroads — #1565', () => {
  const villages = villagesOf();

  it('stands one crossroads at the centre of every village, square to the road', () => {
    expect(villages.length).toBeGreaterThan(0);
    for (const village of villages) {
      const roads = sideRoadsAt(
        FARMLAND,
        ORIGIN,
        SEED,
        village.centre - 100,
        village.centre + 100,
        village.centre,
      ).filter((road) => road.junction.source === 'village');
      expect(roads).toHaveLength(1);
      const [road] = roads as [SideRoad];
      expect(road.junction.along).toBeCloseTo(village.centre, 5);
      const angles = meshAngles(road);
      expect([...angles.keys()].sort()).toEqual([-1, 1]);
      for (const angle of angles.values()) expect(angle).toBeCloseTo(90, -0.5);
    }
  });

  it('takes the village’s middle plot on both sides: nothing is built there, and the shops stand past it', () => {
    let shops = 0;
    for (const village of villages) {
      const plots = villagePlots(SEED, village);
      expect(plots.length).toBeGreaterThan(0);
      for (const plot of plots) {
        expect(Math.abs(plot.along - village.centre), plot.kind).toBeGreaterThan(PLOT_METRES - 1);
      }
      for (const plot of plots.filter((each) => each.kind === 'shop-row')) {
        shops += 1;
        expect(plot.along - village.centre).toBeCloseTo(PLOT_METRES, 5);
      }
    }
    expect(shops).toBeGreaterThan(0);
  });

  it('is in every frame that can see it, with no map data at all', () => {
    const village = villages[0] as Site;
    const start = atStartLine(FARMLAND);
    const frame = sceneFrame({
      profile: FARMLAND,
      origin: ORIGIN,
      state: { ...start, ride: { ...start.ride, distance: metres(village.centre - 50) } },
    });
    expect(frame.sideRoads.map((road) => road.junction.source)).toContain('village');
  });

  it('stands no house, wall, hedge, signpost, tree or billboard on its side roads', () => {
    const start = atStartLine(FARMLAND);
    let roads = 0;
    let items = 0;
    for (let distance = 0; distance < FARMLAND.totalDistance; distance += 100) {
      const frame = sceneFrame({
        profile: FARMLAND,
        origin: ORIGIN,
        state: { ...start, ride: { ...start.ride, distance: metres(distance) } },
      });
      roads += frame.sideRoads.length;
      items += frame.scatter.length;
      for (const item of frame.scatter) {
        const footprint = (STRUCTURE_FOOTPRINTS as Record<string, typeof BILLBOARD_FOOTPRINT>)[
          item.kind
        ] ?? { x: 0, back: 0, front: 0 };
        expect(onSideRoad(frame.sideRoads, item, footprint, 0), item.kind).toBe(false);
      }
      for (const board of frame.billboards) {
        expect(onSideRoad(frame.sideRoads, board, BILLBOARD_FOOTPRINT, 0)).toBe(false);
      }
    }
    expect(roads).toBeGreaterThan(0);
    expect(items).toBeGreaterThan(0);
  });
});

describe('what may not stand on a mapped side road — #1565', () => {
  it('clears the trees, the walls and the hedges a frame would stand on it', () => {
    // A crossroads in open country, every 40 m along a kilometre of fields:
    // where the scenery stands, some of it would stand on them.
    const from = awayFromVillages(250, 1_000);
    const streets: StreetFeature[] = [];
    for (let along = from; along < from + 400; along += 40) streets.push(across(along, 100));
    const corridor = corridorOf(streets);
    const start = atStartLine(FARMLAND);
    const at = (worldCorridor?: WorldCorridor) =>
      sceneFrame({
        profile: FARMLAND,
        origin: ORIGIN,
        state: { ...start, ride: { ...start.ride, distance: metres(from + 100) } },
        ...(worldCorridor === undefined ? {} : { worldCorridor }),
      });
    const withRoads = at(corridor);
    expect(withRoads.sideRoads.filter((road) => road.junction.source === 'mapped').length).toBe(
      streets.length,
    );
    const onIt = (frame: ReturnType<typeof at>) =>
      frame.scatter.filter((item) =>
        onSideRoad(
          withRoads.sideRoads,
          item,
          (STRUCTURE_FOOTPRINTS as Record<string, typeof BILLBOARD_FOOTPRINT>)[item.kind] ?? {
            x: 0,
            back: 0,
            front: 0,
          },
          0,
        ),
      );
    // The control: with no streets, the same frame stands things there.
    expect(onIt(at()).length).toBeGreaterThan(0);
    expect(onIt(withRoads)).toEqual([]);
  });

  it('takes a billboard off a side road mapped through it', () => {
    const start = atStartLine(FARMLAND);
    const at = (distance: number, worldCorridor?: WorldCorridor) =>
      sceneFrame({
        profile: FARMLAND,
        origin: ORIGIN,
        state: { ...start, ride: { ...start.ride, distance: metres(distance) } },
        ...(worldCorridor === undefined ? {} : { worldCorridor }),
      });
    let board: { along: number; x: number; z: number } | undefined;
    for (
      let distance = 0;
      distance < FARMLAND.totalDistance && board === undefined;
      distance += 200
    ) {
      board = at(distance).billboards[0];
    }
    expect(board).toBeDefined();
    const { along } = board as { along: number };
    // The control: with no streets, the board stands.
    const without = at(along - 50).billboards;
    expect(without.some((each) => each.along === along)).toBe(true);
    const through = at(along - 50, corridorOf([across(along, 100)]));
    expect(through.sideRoads.some((road) => road.junction.source === 'mapped')).toBe(true);
    expect(through.billboards.some((each) => each.along === along)).toBe(false);
  });

  it('leaves the world unchanged where the corridor has no streets', () => {
    const start = atStartLine(FARMLAND);
    const village = villagesOf()[0] as Site;
    for (const distance of [500, village.centre, 3_000]) {
      const state = { ...start, ride: { ...start.ride, distance: metres(distance) } };
      const none = sceneFrame({ profile: FARMLAND, origin: ORIGIN, state });
      const empty = sceneFrame({
        profile: FARMLAND,
        origin: ORIGIN,
        state,
        worldCorridor: corridorOf([]),
      });
      expect(empty.sideRoads).toEqual(none.sideRoads);
      expect(empty.scatter).toEqual(none.scatter);
    }
  });
});
