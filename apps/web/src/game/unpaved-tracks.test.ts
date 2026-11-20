// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Unpaved ways — #2695. Read back through `mappedTracks`, `sideRoadsAt` and
 * `sceneFrame`, the path a ride's frames take: a mapped track or bridleway
 * that leaves the route is drawn as gravel or earth, narrower than a street,
 * with no paint, joined at its junction as a side road is; a footway or a
 * cycleway is not, and a corridor with none draws none.
 */

import { describe, expect, it } from 'vitest';

import { metres, type RouteProfile } from '@onyourleft/domain';
import type { PathFeature, StreetFeature } from '@onyourleft/map-features';

import {
  EARTH,
  GRAVEL,
  mappedJunctions,
  mappedTracks,
  onSideRoad,
  SIDE_ROAD_TRIANGLES_PER_ARM,
  SIDE_ROAD_WIDTHS,
  sideRoadsAt,
  TARMAC,
  type SideRoad,
} from './cross-streets';
import { BILLBOARD_FOOTPRINT } from './logo-board';
import { northRoute } from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import { sceneFrame } from './scene';
import { siteAt, siteSpacing, STRUCTURE_FOOTPRINTS } from './settlements';
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
  return frame;
}

/** A straight line leaving the road at `along` on its right, square to it, `length` metres. */
function leavingLine(along: number, length: number): Float32Array {
  const here = roadAt(along);
  return Float32Array.from([
    here.x,
    here.z,
    here.x + here.normalX * length,
    here.z + here.normalZ * length,
  ]);
}

function path(along: number, kindDetail: string, length = 120): PathFeature {
  return { kind: 'path', kindDetail, line: leavingLine(along, length) };
}

function street(along: number): StreetFeature {
  return {
    kind: 'minor_road',
    kindDetail: 'residential',
    grade: 'ground',
    line: leavingLine(along, 120),
  };
}

function corridorOf(
  paths: readonly PathFeature[],
  streets: readonly StreetFeature[] = [],
): WorldCorridor {
  return {
    routeId: 'unpaved-tracks-fixture',
    origin: ORIGIN,
    covered: () => true,
    coveredBoxes: [],
    landUse: [],
    buildings: [],
    paths,
    streets,
  };
}

/** An odometer reading at least `clear` metres from every village's ground. */
function awayFromVillages(clear: number, after = 200): number {
  const { sites } = siteSpacing(FARMLAND);
  const villages = Array.from({ length: sites }, (_, index) => siteAt(FARMLAND, SEED, index));
  for (let along = after; along < FARMLAND.totalDistance - 200; along += 10) {
    if (
      villages.every(
        (site) =>
          site === undefined ||
          site.kind !== 'village' ||
          Math.abs(site.centre - along) > site.half + clear,
      )
    ) {
      return along;
    }
  }
  throw new Error('no open country on the fixture');
}

/** Each vertex's red channel, as the mesh holds it. */
function reds(road: SideRoad): number[] {
  return Array.from(
    { length: road.mesh.colours.length / 3 },
    (_, at) => road.mesh.colours[at * 3] as number,
  );
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

describe('where an unpaved way joins the route — #2695', () => {
  const at = awayFromVillages(150, 1_000);

  it('finds a track and a bridleway leaving the route, each its own width class', () => {
    const found = mappedTracks(
      corridorOf([path(at, 'track'), path(at + 300, 'bridleway')]),
      FARMLAND,
      ORIGIN,
      SEED,
    );
    expect(found.map((junction) => junction.source)).toEqual(['unpaved', 'unpaved']);
    expect(found.map((junction) => junction.arms.map((arm) => arm.widthClass))).toEqual([
      ['track'],
      ['bridleway'],
    ]);
    expect(found[0]?.along).toBeCloseTo(at, -0.5);
    expect(SIDE_ROAD_WIDTHS.track).toBeLessThan(SIDE_ROAD_WIDTHS.service);
    expect(SIDE_ROAD_WIDTHS.bridleway).toBeLessThan(SIDE_ROAD_WIDTHS.track);
  });

  it('finds none for a footway, a cycleway or a corridor with no paths, and never reads a track as a street', () => {
    expect(
      mappedTracks(
        corridorOf([path(at, 'footway'), path(at + 200, 'cycleway'), path(at + 400, '')]),
        FARMLAND,
        ORIGIN,
        SEED,
      ),
    ).toEqual([]);
    const both = corridorOf([path(at, 'track')], [street(at + 300)]);
    expect(mappedJunctions(both, FARMLAND, ORIGIN, SEED).map((j) => j.source)).toEqual(['mapped']);
    expect(mappedTracks(both, FARMLAND, ORIGIN, SEED).map((j) => j.source)).toEqual(['unpaved']);
    // Built once a corridor.
    expect(mappedTracks(both, FARMLAND, ORIGIN, SEED)).toBe(
      mappedTracks(both, FARMLAND, ORIGIN, SEED),
    );
  });
});

describe('what an unpaved way is drawn as — #2695', () => {
  const at = awayFromVillages(150, 2_000);
  const corridor = corridorOf([path(at, 'track'), path(at + 40, 'bridleway')]);
  const frame = frameAt(at - 30, corridor);
  const ways = frame.sideRoads.filter((road) => road.junction.source === 'unpaved');

  it('is in the frame that can see it, in the side roads’ one mesh; none with no track', () => {
    expect(ways).toHaveLength(2);
    expect(
      frameAt(at - 30, corridorOf([])).sideRoads.some((r) => r.junction.source === 'unpaved'),
    ).toBe(false);
  });

  it('is gravel for a track and earth for a bridleway: no tarmac, and no paint', () => {
    const [track, bridleway] = ways as [SideRoad, SideRoad];
    const paint = Math.fround(((MARKING_COLOUR >> 16) & 0xff) / 255);
    for (const [road, colour] of [
      [track, GRAVEL],
      [bridleway, EARTH],
    ] as const) {
      const red = reds(road);
      expect(red.length).toBeGreaterThan(0);
      expect(red.every((value) => value === Math.fround(colour[0]))).toBe(true);
      expect(red.some((value) => value === Math.fround(TARMAC[0]))).toBe(false);
      // No give-way line: nothing near the paint's brightness.
      expect(red.some((value) => value > 0.5 || value === paint)).toBe(false);
    }
  });

  it('is drawn at its narrower width, with #628’s ruts along it', () => {
    for (const road of ways) {
      const arm = road.junction.arms[0];
      const half = SIDE_ROAD_WIDTHS[arm?.widthClass ?? 'track'] / 2;
      const across = Array.from(road.mesh.across);
      expect(Math.max(...across.map(Math.abs))).toBeCloseTo(half, 3);
      expect(Array.from(road.halfWidths).every((value) => value === Math.fround(half))).toBe(true);
    }
  });

  it('costs each arm no more than a side road’s stated triangles', () => {
    const found = mappedTracks(corridorOf([path(at, 'track', 200)]), FARMLAND, ORIGIN, SEED);
    const built = sideRoadsAt(FARMLAND, ORIGIN, SEED, at - 60, at + 60, at, found);
    expect(built).toHaveLength(1);
    expect((built[0] as SideRoad).mesh.indices.length / 3).toBeLessThanOrEqual(
      SIDE_ROAD_TRIANGLES_PER_ARM,
    );
  });

  it('stands no tree, wall, hedge or billboard on the way', () => {
    const from = awayFromVillages(250, 3_000);
    const paths: PathFeature[] = [];
    for (let along = from; along < from + 400; along += 40) paths.push(path(along, 'track', 100));
    const withWays = frameAt(from + 100, corridorOf(paths));
    const drawn = withWays.sideRoads.filter((road) => road.junction.source === 'unpaved');
    expect(drawn.length).toBe(paths.length);
    const onIt = (shown: ReturnType<typeof frameAt>) =>
      shown.scatter.filter((item) =>
        onSideRoad(
          drawn,
          item,
          (STRUCTURE_FOOTPRINTS as Record<string, typeof BILLBOARD_FOOTPRINT>)[item.kind] ?? {
            x: 0,
            back: 0,
            front: 0,
          },
          0,
        ),
      );
    expect(onIt(frameAt(from + 100, corridorOf([]))).length).toBeGreaterThan(0);
    expect(onIt(withWays)).toEqual([]);
  });
});
