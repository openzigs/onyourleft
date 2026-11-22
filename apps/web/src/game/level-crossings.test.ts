// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Level crossings — #2660. Read back through `levelCrossings`, `sideRoadsAt`
 * and `sceneFrame`, the path a ride's frames take: where a mapped railway
 * crosses the route at grade there is track, ballast with two rails on it,
 * carried across the carriageway; where it crosses on a bridge or in a tunnel,
 * or where the corridor has no railway, the world is unchanged.
 */

import { describe, expect, it } from 'vitest';

import { metres, type RouteProfile } from '@onyourleft/domain';
import type { RailFeature, StreetFeature, StreetGrade } from '@onyourleft/map-features';

import {
  BALLAST,
  levelCrossings,
  mappedJunctions,
  onSideRoad,
  RAIL_HEAD_METRES,
  RAIL_MAX_METRES,
  RAIL_STEEL,
  SIDE_ROAD_TRIANGLES_PER_ARM,
  SIDE_ROAD_WIDTHS,
  sideRoadsAt,
  TARMAC,
  withLevelCrossings,
  type SideRoad,
} from './cross-streets';
import { BILLBOARD_FOOTPRINT } from './logo-board';
import { northRoute } from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import { sceneFrame } from './scene';
import { siteAt, siteSpacing, STRUCTURE_FOOTPRINTS } from './settlements';
import { atStartLine } from './simulation';
import { corridorOrigin, drawnRoadFrame, ROAD_WIDTH_METRES } from './terrain';
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

/** A straight line across the road at `along`, `half` metres each side, `angle` degrees from its forward direction. */
function lineAcross(along: number, half: number, angle = 90): Float32Array {
  const here = roadAt(along);
  const radians = (angle * Math.PI) / 180;
  const dx = here.forwardX * Math.cos(radians) + here.normalX * Math.sin(radians);
  const dz = here.forwardZ * Math.cos(radians) + here.normalZ * Math.sin(radians);
  return Float32Array.from([
    here.x - dx * half,
    here.z - dz * half,
    here.x + dx * half,
    here.z + dz * half,
  ]);
}

function railAcross(
  along: number,
  half = 120,
  grade: StreetGrade = 'ground',
  angle = 90,
): RailFeature {
  return { kindDetail: 'rail', grade, line: lineAcross(along, half, angle) };
}

function streetAcross(along: number, half = 120): StreetFeature {
  return { kind: 'minor_road', kindDetail: '', grade: 'ground', line: lineAcross(along, half) };
}

function corridorOf(
  rails: readonly RailFeature[] | undefined,
  streets: readonly StreetFeature[] = [],
): WorldCorridor {
  return {
    routeId: 'level-crossings-fixture',
    origin: ORIGIN,
    covered: () => true,
    coveredBoxes: [],
    landUse: [],
    buildings: [],
    paths: [],
    streets,
    ...(rails === undefined ? {} : { rails }),
  };
}

/** An odometer reading at least `clear` metres from every village's ground. */
function awayFromVillages(clear: number, after = 200): number {
  const { sites } = siteSpacing(FARMLAND);
  const villages = Array.from({ length: sites }, (_, index) =>
    siteAt(FARMLAND, SEED, index),
  ).filter((site) => site?.kind === 'village');
  for (let along = after; along < FARMLAND.totalDistance - 200; along += 10) {
    if (
      villages.every(
        (site) => site === undefined || Math.abs(site.centre - along) > site.half + clear,
      )
    ) {
      return along;
    }
  }
  throw new Error('no open country on the fixture');
}

/** Each vertex of a mesh as `[x, y, z]` with its colour's red channel. */
function vertices(
  road: SideRoad,
): { x: number; y: number; z: number; red: number; across: number }[] {
  const { positions, colours, across } = road.mesh;
  return Array.from({ length: positions.length / 3 }, (_, at) => ({
    x: positions[at * 3] as number,
    y: positions[at * 3 + 1] as number,
    z: positions[at * 3 + 2] as number,
    red: colours[at * 3] as number,
    across: across[at] as number,
  }));
}

/** The frame a ride at `distance` draws, with `worldCorridor`. */
function frameAt(distance: number, worldCorridor?: WorldCorridor) {
  const start = atStartLine(FARMLAND);
  return sceneFrame({
    profile: FARMLAND,
    origin: ORIGIN,
    state: { ...start, ride: { ...start.ride, distance: metres(distance) } },
    ...(worldCorridor === undefined ? {} : { worldCorridor }),
  });
}

describe('where a level crossing is — #2660', () => {
  const at = awayFromVillages(150, 1_000);

  it('finds one where a mapped railway crosses the route at grade: two arms of track, square to it', () => {
    const crossings = levelCrossings(corridorOf([railAcross(at)]), FARMLAND, ORIGIN, SEED);
    expect(crossings).toHaveLength(1);
    const [crossing] = crossings;
    expect(crossing?.source).toBe('rail');
    expect(crossing?.along).toBeCloseTo(at, -0.5);
    expect(crossing?.arms.map((arm) => arm.side)).toEqual([-1, 1]);
    for (const arm of crossing?.arms ?? []) {
      expect(arm.widthClass).toBe('rail');
      expect(arm.angleDegrees).toBeCloseTo(90, 0);
    }
  });

  it('finds none on a bridge or in a tunnel, nor with no railway — and never reads one as a street', () => {
    expect(
      levelCrossings(
        corridorOf([railAcross(at, 120, 'bridge'), railAcross(at + 200, 120, 'tunnel')]),
        FARMLAND,
        ORIGIN,
        SEED,
      ),
    ).toEqual([]);
    // A corridor kept before #2660 carries no `rails` at all.
    expect(levelCrossings(corridorOf(undefined), FARMLAND, ORIGIN, SEED)).toEqual([]);
    // A railway is not a street, and a street is not a railway.
    const both = corridorOf([railAcross(at)], [streetAcross(at + 300)]);
    expect(mappedJunctions(both, FARMLAND, ORIGIN, SEED).map((j) => j.source)).toEqual(['mapped']);
    expect(levelCrossings(both, FARMLAND, ORIGIN, SEED).map((j) => j.source)).toEqual(['rail']);
  });

  it('is built once a corridor, and merged with the junctions into one list that is the same array after', () => {
    const corridor = corridorOf([railAcross(at)], [streetAcross(at + 300)]);
    const crossings = levelCrossings(corridor, FARMLAND, ORIGIN, SEED);
    expect(levelCrossings(corridor, FARMLAND, ORIGIN, SEED)).toBe(crossings);
    const junctions = mappedJunctions(corridor, FARMLAND, ORIGIN, SEED);
    const both = withLevelCrossings(junctions, crossings);
    expect(both.map((j) => j.source)).toEqual(['mapped', 'rail']);
    expect(withLevelCrossings(junctions, crossings)).toBe(both);
    expect(withLevelCrossings(junctions, [])).toBe(junctions);
    expect(withLevelCrossings([], crossings)).toBe(crossings);
  });

  it('stops resampling at RAIL_MAX_METRES, so a hostile tile cannot exhaust memory', () => {
    const hostile: RailFeature = {
      kindDetail: 'rail',
      grade: 'ground',
      line: Float32Array.from([9e5, 9e5, 9e5 + RAIL_MAX_METRES * 2, 9e5]),
    };
    expect(levelCrossings(corridorOf([hostile, railAcross(at)]), FARMLAND, ORIGIN, SEED)).toEqual(
      [],
    );
    expect(
      levelCrossings(corridorOf([railAcross(at), hostile]), FARMLAND, ORIGIN, SEED),
    ).toHaveLength(1);
  });
});

describe('what a level crossing is drawn as — #2660', () => {
  const at = awayFromVillages(150, 2_000);
  const corridor = corridorOf([railAcross(at)]);
  const frame = frameAt(at - 40, corridor);
  const crossing = frame.sideRoads.find((road) => road.junction.source === 'rail') as SideRoad;

  it('is in the frame that can see it, in the side roads’ one mesh', () => {
    expect(crossing).toBeDefined();
    // The control: the same frame with no railway draws none.
    expect(
      frameAt(at - 40, corridorOf([])).sideRoads.some((r) => r.junction.source === 'rail'),
    ).toBe(false);
  });

  it('is ballast with two steel rails standing on it, no tarmac and no paint, and no wear across it', () => {
    const all = vertices(crossing);
    const ballast = all.filter((v) => v.red === Math.fround(BALLAST[0]));
    const steel = all.filter((v) => v.red === Math.fround(RAIL_STEEL[0]));
    expect(ballast.length).toBeGreaterThan(0);
    expect(steel.length).toBeGreaterThan(0);
    expect(ballast.length + steel.length).toBe(all.length);
    expect(all.some((v) => v.red === Math.fround(TARMAC[0]))).toBe(false);
    // #628's wheel tracks and dust read `across`: a track has neither.
    expect(all.every((v) => v.across === 0)).toBe(true);
    // Each rail stands its head's height above the ballast beside it, off the carriageway.
    const here = roadAt(at);
    const lateral = (v: { x: number; z: number }) =>
      (v.x - here.x) * here.normalX + (v.z - here.z) * here.normalZ;
    // Each rail is its upright face: a foot and a head at each place, the head the higher.
    const heads = new Map<string, (typeof steel)[number]>();
    for (const v of steel.filter((v) => Math.abs(lateral(v)) > ROAD_WIDTH_METRES / 2 + 8)) {
      const key = `${v.x.toFixed(3)} ${v.z.toFixed(3)}`;
      const known = heads.get(key);
      if (known === undefined || known.y < v.y) heads.set(key, v);
    }
    expect(heads.size).toBeGreaterThan(8);
    for (const rail of heads.values()) {
      const below = ballast
        .filter((b) => Math.hypot(b.x - rail.x, b.z - rail.z) < SIDE_ROAD_WIDTHS.rail)
        .reduce((low, b) => Math.min(low, b.y), Infinity);
      expect(rail.y).toBeGreaterThan(below + RAIL_HEAD_METRES * 0.5);
    }
  });

  it('carries its rails across the carriageway, from the centreline to each side, over the road', () => {
    const here = roadAt(at);
    const steel = vertices(crossing).filter((v) => v.red === Math.fround(RAIL_STEEL[0]));
    const lateral = (v: { x: number; z: number }) =>
      (v.x - here.x) * here.normalX + (v.z - here.z) * here.normalZ;
    const onRoad = steel.filter((v) => Math.abs(lateral(v)) < 0.5);
    // Two rails' two edges, from each arm.
    expect(onRoad).toHaveLength(8);
    // And drawn: every one of them is a corner of a triangle.
    const drawn = new Set(crossing.mesh.indices);
    const all = vertices(crossing);
    const drawnOnRoad = [...drawn].filter((at) => {
      const v = all[at] as (typeof all)[number];
      return v.red === Math.fround(RAIL_STEEL[0]) && Math.abs(lateral(v)) < 0.5;
    });
    expect(drawnOnRoad).toHaveLength(8);
    // The ballast never covers the carriageway.
    const ballast = vertices(crossing).filter((v) => v.red === Math.fround(BALLAST[0]));
    expect(Math.min(...ballast.map((v) => Math.abs(lateral(v))))).toBeGreaterThan(
      ROAD_WIDTH_METRES / 2 - 0.5,
    );
  });

  it('costs each arm no more than a side road’s stated triangles, at the shallowest angle kept too', () => {
    const shallow = levelCrossings(
      corridorOf([railAcross(at, 200), railAcross(at + 400, 200, 'ground', 31)]),
      FARMLAND,
      ORIGIN,
      SEED,
    );
    const built = sideRoadsAt(FARMLAND, ORIGIN, SEED, at - 60, at + 460, at, shallow);
    expect(built).toHaveLength(2);
    for (const road of built) {
      expect(road.mesh.indices.length / 3).toBeLessThanOrEqual(
        road.junction.arms.length * SIDE_ROAD_TRIANGLES_PER_ARM,
      );
    }
    // Non-vacuity: the square crossing is near the bound, not far under it.
    const square = built[0] as SideRoad;
    expect(square.mesh.indices.length / 3 / square.junction.arms.length).toBeGreaterThan(
      SIDE_ROAD_TRIANGLES_PER_ARM * 0.75,
    );
  });

  it('stands no tree, wall, hedge or billboard on the track', () => {
    // A crossing every 40 m along 400 m of fields: some scenery would stand on them.
    const from = awayFromVillages(250, 3_000);
    const rails: RailFeature[] = [];
    for (let along = from; along < from + 400; along += 40) rails.push(railAcross(along, 100));
    const withTrack = frameAt(from + 100, corridorOf(rails));
    const tracks = withTrack.sideRoads.filter((road) => road.junction.source === 'rail');
    expect(tracks.length).toBe(rails.length);
    const onIt = (frame: ReturnType<typeof frameAt>) =>
      frame.scatter.filter((item) =>
        onSideRoad(
          tracks,
          item,
          (STRUCTURE_FOOTPRINTS as Record<string, typeof BILLBOARD_FOOTPRINT>)[item.kind] ?? {
            x: 0,
            back: 0,
            front: 0,
          },
          0,
        ),
      );
    // The control: with no railway, the same frame stands things there.
    expect(onIt(frameAt(from + 100, corridorOf([]))).length).toBeGreaterThan(0);
    expect(onIt(withTrack)).toEqual([]);
  });
});
