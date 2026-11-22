// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2972: the mapped footways drawn. Read back through the path a consumer
 * uses — `sceneFrame`'s `footways`, which the renderer's `FootwayBelt` draws —
 * and, for the belt, off the buffers it uploads.
 */

import { describe, expect, it } from 'vitest';

import { metres } from '@onyourleft/domain';
import type { PathFeature } from '@onyourleft/map-features';

import { linearColour } from './cross-streets';
import { FOOTWAYS_FIXTURE_CROSSING, footwaysFixture } from './footprint-fixtures-testing';
import {
  FOOTWAY_DRAW_METRES,
  FOOTWAY_FRAME_TRIANGLES,
  FOOTWAY_LIFT_METRES,
  FOOTWAY_SURFACE_COLOURS,
  FOOTWAY_SURFACE_WIDTHS,
  footwaysInView,
  footwayTriangles,
  NO_FOOTWAYS,
  ROAD_HALF_WIDTH_METRES,
  STEP_SHADE_COLOUR,
  surfaceKindOf,
  ZEBRA_LENGTH_METRES,
  ZEBRA_STRIPES,
  zebraAlongs,
  type FootwayPiece,
  type FootwaySurfaceKind,
} from './footway-surfaces';
import { landClassMask, NO_LAND_CLASS, type LandClassMask } from './land-class';
import { standingOnGround } from './landform';
import { onPavement, pavementBands } from './people';
import { distanceToDrawnRoad, nearestOnDrawnRoad } from './road-grid';
import { northRoute } from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import { sceneFrame } from './scene';
import { siteAt, siteSpacing, type Site } from './settlements';
import { atStartLine } from './simulation';
import { corridorOrigin, drawnRoadFrame } from './terrain';
import { FootwayBelt } from './three-renderer';
import type { WorldCorridor } from './world-data/corridor';

const TOWN = footwaysFixture();
const LAND = landClassMask(TOWN.corridor);

function frameAt(distance: number, extra: Record<string, unknown> = {}) {
  const start = atStartLine(TOWN.profile);
  return sceneFrame({
    profile: TOWN.profile,
    origin: TOWN.origin,
    state: { ...start, ride: { ...start.ride, distance: metres(distance) } },
    worldCorridor: TOWN.corridor,
    landClass: LAND,
    ...extra,
  });
}

function ofKind(pieces: readonly FootwayPiece[], kind: FootwaySurfaceKind): FootwayPiece[] {
  return pieces.filter((piece) => piece.kind === kind);
}

/** Every vertex of `pieces` as `{ x, y, z }`. */
function verticesOf(pieces: readonly FootwayPiece[]): { x: number; y: number; z: number }[] {
  const out: { x: number; y: number; z: number }[] = [];
  for (const piece of pieces) {
    for (let at = 0; at + 2 < piece.positions.length; at += 3) {
      out.push({
        x: piece.positions[at] as number,
        y: piece.positions[at + 1] as number,
        z: piece.positions[at + 2] as number,
      });
    }
  }
  return out;
}

/** Each triangle's middle in plan, and the `y` of its face normal (positive faces up). */
function trianglesOf(piece: FootwayPiece): { x: number; z: number; up: number }[] {
  const p = piece.positions;
  const out: { x: number; z: number; up: number }[] = [];
  for (let at = 0; at + 2 < piece.indices.length; at += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => (piece.indices[at + k] as number) * 3) as [
      number,
      number,
      number,
    ];
    const e1x = (p[b] as number) - (p[a] as number);
    const e1z = (p[b + 2] as number) - (p[a + 2] as number);
    const e2x = (p[c] as number) - (p[a] as number);
    const e2z = (p[c + 2] as number) - (p[a + 2] as number);
    out.push({
      x: ((p[a] as number) + (p[b] as number) + (p[c] as number)) / 3,
      z: ((p[a + 2] as number) + (p[b + 2] as number) + (p[c + 2] as number)) / 3,
      up: e1z * e2x - e1x * e2z,
    });
  }
  return out;
}

function hasColour(piece: FootwayPiece, packed: number): boolean {
  const [r, g, b] = linearColour(packed);
  for (let at = 0; at + 2 < piece.colours.length; at += 3) {
    if (
      Math.abs((piece.colours[at] as number) - r) < 1e-6 &&
      Math.abs((piece.colours[at + 1] as number) - g) < 1e-6 &&
      Math.abs((piece.colours[at + 2] as number) - b) < 1e-6
    )
      return true;
  }
  return false;
}

describe('what a footway is drawn as — #2972', () => {
  const at = (kind: ReturnType<typeof LAND.classAt>): LandClassMask => ({
    ...NO_LAND_CLASS,
    classAt: () => kind,
  });

  it('draws steps and cycleways by their tags, sidewalks paved, and a path by the land it crosses', () => {
    expect(surfaceKindOf('steps', at('park'), 0, 0)).toBe('steps');
    expect(surfaceKindOf('cycleway', at('built-up'), 0, 0)).toBe('cycleway');
    expect(surfaceKindOf('sidewalk', at('park'), 0, 0)).toBe('footway');
    expect(surfaceKindOf('pedestrian', at('farmland'), 0, 0)).toBe('footway');
    expect(surfaceKindOf('footway', at('built-up'), 0, 0)).toBe('footway');
    expect(surfaceKindOf('footway', at('park'), 0, 0)).toBe('park-path');
    expect(surfaceKindOf('footway', at('wood'), 0, 0)).toBe('park-path');
    expect(surfaceKindOf('', at('farmland'), 0, 0)).toBe('park-path');
    expect(surfaceKindOf('path', at('park'), 0, 0)).toBe('park-path');
    expect(surfaceKindOf('path', at('built-up'), 0, 0)).toBe('footway');
  });
});

describe('the footways through sceneFrame — #2972', () => {
  it('draws the suburb’s sidewalks and cycleway, each in its own colour, round the camera', () => {
    const footways = frameAt(1_250).footways;
    const paved = ofKind(footways, 'footway');
    const cycleways = ofKind(footways, 'cycleway');
    expect(paved.length).toBeGreaterThan(4);
    expect(cycleways.length).toBeGreaterThan(1);
    expect(paved.every((piece) => hasColour(piece, FOOTWAY_SURFACE_COLOURS.footway))).toBe(true);
    expect(cycleways.every((piece) => hasColour(piece, FOOTWAY_SURFACE_COLOURS.cycleway))).toBe(
      true,
    );
    // Both sides of the road: some paved vertices right of it, some left.
    const laterals = verticesOf(paved).map(
      (v) => nearestOnDrawnRoad(TOWN.profile, TOWN.origin, v.x, v.z, 20)?.lateral ?? 0,
    );
    expect(laterals.some((lateral) => lateral > 4)).toBe(true);
    expect(laterals.some((lateral) => lateral < -4)).toBe(true);
    // Each as wide as its kind: a sidewalk 6 m out spans 5 to 7 m.
    expect(Math.max(...laterals.map(Math.abs))).toBeCloseTo(
      6 + FOOTWAY_SURFACE_WIDTHS.footway / 2,
      1,
    );
  });

  it('draws the park’s path, its footway as a park path and its steps in alternating treads', () => {
    const footways = frameAt(1_900).footways;
    const park = ofKind(footways, 'park-path');
    const steps = ofKind(footways, 'steps');
    expect(park.length).toBeGreaterThan(2);
    expect(steps.length).toBe(1);
    expect(park.every((piece) => hasColour(piece, FOOTWAY_SURFACE_COLOURS['park-path']))).toBe(
      true,
    );
    const flight = steps[0] as FootwayPiece;
    expect(hasColour(flight, FOOTWAY_SURFACE_COLOURS.steps)).toBe(true);
    expect(hasColour(flight, STEP_SHADE_COLOUR)).toBe(true);
    // Treads every half metre: many more triangles than a 2 m ribbon's two a segment.
    expect(flight.indices.length / 3).toBeGreaterThan(8);
  });

  it('lies on the ground the frame draws, faces up, and never over the carriageway', () => {
    for (const distance of [1_250, 1_900]) {
      const frame = frameAt(distance);
      const ribbons = frame.footways.filter((piece) => piece.kind !== 'crossing');
      const vertices = verticesOf(ribbons);
      expect(vertices.length).toBeGreaterThan(100);
      const stood = standingOnGround(vertices, frame.terrain.mesh);
      let compared = 0;
      for (const v of stood) {
        const drawn = vertices.find((w) => w.x === v.x && w.z === v.z);
        if (drawn === undefined) continue;
        compared += 1;
        // Its lift over the drawn ground, to a centimetre either way.
        expect(drawn.y - v.y).toBeGreaterThan(FOOTWAY_LIFT_METRES - 0.01);
        expect(drawn.y - v.y).toBeLessThan(FOOTWAY_LIFT_METRES + 0.01);
      }
      expect(compared).toBeGreaterThan(vertices.length / 2);
      for (const v of vertices) {
        expect(distanceToDrawnRoad(TOWN.profile, TOWN.origin, v.x, v.z, 10)).toBeGreaterThanOrEqual(
          ROAD_HALF_WIDTH_METRES - 1e-3,
        );
      }
      for (const piece of ribbons) {
        for (const triangle of trianglesOf(piece)) expect(triangle.up).toBeGreaterThan(0);
      }
    }
  });

  it('draws one zebra where the mapped crossing crosses the road, across the carriageway', () => {
    const footways = frameAt(1_250).footways;
    const zebras = ofKind(footways, 'crossing');
    expect(zebras).toHaveLength(1);
    const zebra = zebras[0] as FootwayPiece;
    expect(zebra.indices.length / 3).toBe(ZEBRA_STRIPES * 2);
    expect(hasColour(zebra, FOOTWAY_SURFACE_COLOURS.crossing)).toBe(true);
    for (const v of verticesOf([zebra])) {
      const near = nearestOnDrawnRoad(TOWN.profile, TOWN.origin, v.x, v.z, 10);
      expect(near).toBeDefined();
      expect(Math.abs(near?.lateral ?? 99)).toBeLessThanOrEqual(ROAD_HALF_WIDTH_METRES);
      expect(Math.abs((near?.along ?? 0) - FOOTWAYS_FIXTURE_CROSSING)).toBeLessThanOrEqual(
        ZEBRA_LENGTH_METRES / 2 + 0.01,
      );
    }
    for (const triangle of trianglesOf(zebra)) expect(triangle.up).toBeGreaterThan(0);
    // And the side street's crossing, which never meets the route, has none.
    expect(zebraAlongs(TOWN.corridor.paths, TOWN.profile, TOWN.origin)).toHaveLength(1);
  });

  it('draws nothing beyond its reach, and nothing at all with the lever off or no corridor', () => {
    // 2 900 m: the nearest footway is the park's, 750 m back.
    expect(frameAt(2_900).footways).toBe(NO_FOOTWAYS);
    expect(frameAt(1_250, { footwaysOff: true }).footways).toBe(NO_FOOTWAYS);
    expect(frameAt(1_250, { worldCorridor: undefined, landClass: undefined }).footways).toBe(
      NO_FOOTWAYS,
    );
    const frame = frameAt(1_250);
    for (const v of verticesOf(frame.footways)) {
      // A chunk is in reach by its box: a vertex at most a chunk's length past it.
      expect(Math.hypot(v.x - frame.camera.x, v.z - frame.camera.z)).toBeLessThan(
        FOOTWAY_DRAW_METRES + 70,
      );
    }
  });

  it('hands over the same pieces while the same are in reach, so the belt does not re-upload', () => {
    const first = frameAt(1_250).footways;
    const second = frameAt(1_250).footways;
    expect(second).toHaveLength(first.length);
    second.forEach((piece, index) => expect(piece).toBe(first[index]));
  });
});

/** A level road due north, a corridor with `paths` and covered everywhere. */
const FARMLAND = northRoute(6_000, () => 40);
const ORIGIN = corridorOrigin(FARMLAND);
const SEED = scatterSeed(FARMLAND);

function corridorWith(paths: PathFeature[], landUse: WorldCorridor['landUse'] = []): WorldCorridor {
  return {
    routeId: 'footway-surfaces',
    origin: ORIGIN,
    covered: () => true,
    coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 6_500 }],
    landUse,
    buildings: [],
    paths,
    streets: [],
  };
}

/** A line `offset` metres along the drawn road's normal, from `from` to `to`, every `step`. */
function besideRoad(from: number, to: number, offset: number, step = 2): Float32Array {
  const points: number[] = [];
  for (let at = from; at <= to; at += step) {
    const road = drawnRoadFrame(FARMLAND, ORIGIN, at);
    if (road === undefined) continue;
    points.push(road.x + road.normalX * offset, road.z + road.normalZ * offset);
  }
  return Float32Array.from(points);
}

function cameraAt(along: number): NonNullable<ReturnType<typeof drawnRoadFrame>> {
  const road = drawnRoadFrame(FARMLAND, ORIGIN, along);
  if (road === undefined) throw new Error('no road');
  return road;
}

describe('a zebra only where a crossing crosses the road — #2972', () => {
  it('draws none for a crossing mapped along the kerb, and one for each crossing of the road, two ways of one merged', () => {
    const along: PathFeature = {
      kind: 'path',
      kindDetail: 'crossing',
      line: besideRoad(500, 540, 3),
    };
    expect(zebraAlongs([along], FARMLAND, ORIGIN)).toEqual([]);
    const across = (at: number, from: number, to: number): PathFeature => {
      const road = cameraAt(at);
      return {
        kind: 'path',
        kindDetail: 'crossing',
        line: Float32Array.from([
          road.x + road.normalX * from,
          road.z + road.normalZ * from,
          road.x + road.normalX * to,
          road.z + road.normalZ * to,
        ]),
      };
    };
    const zebras = zebraAlongs(
      [across(800, -6, 6), across(802, 6, -6), across(1_400, 6, -6)],
      FARMLAND,
      ORIGIN,
    );
    expect(zebras).toHaveLength(2);
    expect(zebras[0]).toBeCloseTo(800, 0);
    expect(zebras[1]).toBeCloseTo(1_400, 0);
    // A "crossing" longer than any carriageway is not read, a hostile tile's bound.
    expect(zebraAlongs([across(800, -60, 60)], FARMLAND, ORIGIN)).toEqual([]);
    expect(zebraAlongs([across(800, -40, 40)], FARMLAND, ORIGIN)).toHaveLength(1);
    // A footway that is not a crossing makes no zebra, whatever it crosses.
    expect(
      zebraAlongs([{ ...across(800, -6, 6), kindDetail: 'footway' }], FARMLAND, ORIGIN),
    ).toEqual([]);
  });
});

describe('kept off what is already there — #2972', () => {
  it('keeps a ribbon’s edge off the carriageway: a sidewalk mapped too near the road is not drawn', () => {
    // 4 m out: its middle is off the road, but a 2 m ribbon's inner edge would be 0.5 m onto it.
    const near = corridorWith([
      { kind: 'path', kindDetail: 'sidewalk', line: besideRoad(500, 700, 4) },
    ]);
    const camera = cameraAt(600);
    expect(
      footwaysInView(near, FARMLAND, ORIGIN, SEED, NO_LAND_CLASS, camera.x, camera.z, []),
    ).toEqual([]);
    // The control: 5 m out, it is drawn.
    const clear = corridorWith([
      { kind: 'path', kindDetail: 'sidewalk', line: besideRoad(500, 700, 5) },
    ]);
    expect(
      footwayTriangles(
        footwaysInView(clear, FARMLAND, ORIGIN, SEED, NO_LAND_CLASS, camera.x, camera.z, []),
      ),
    ).toBeGreaterThan(150);
  });

  it('draws no footway over mapped water', () => {
    const path = { kind: 'path', kindDetail: 'footway', line: besideRoad(500, 700, 20) };
    const water = landClassMask(
      corridorWith(
        [path],
        [
          {
            layer: 'water',
            kind: 'water',
            rings: [
              Float32Array.from([
                ...[550, 650].flatMap((along) => {
                  const road = cameraAt(along);
                  return [road.x + road.normalX * 10, road.z + road.normalZ * 10];
                }),
                ...[650, 550].flatMap((along) => {
                  const road = cameraAt(along);
                  return [road.x + road.normalX * 30, road.z + road.normalZ * 30];
                }),
              ]),
            ],
          },
        ],
      ),
    );
    const camera = cameraAt(600);
    const dry = footwayTriangles(
      footwaysInView(
        corridorWith([path]),
        FARMLAND,
        ORIGIN,
        SEED,
        NO_LAND_CLASS,
        camera.x,
        camera.z,
        [],
      ),
    );
    const wet = footwaysInView(
      corridorWith([path]),
      FARMLAND,
      ORIGIN,
      SEED,
      water,
      camera.x,
      camera.z,
      [],
    );
    expect(dry).toBeGreaterThan(150);
    // The 100 m over the water are gone; the 100 m either side of it are not.
    expect(footwayTriangles(wet)).toBeLessThan(dry * 0.6);
    expect(footwayTriangles(wet)).toBeGreaterThan(dry * 0.35);
    for (const v of verticesOf(wet)) {
      const near = nearestOnDrawnRoad(FARMLAND, ORIGIN, v.x, v.z, 40);
      const inside = near !== undefined && near.along > 552 && near.along < 648;
      expect(inside).toBe(false);
    }
  });

  it('holds the frame to its triangles, nearest first', () => {
    // Forty parallel footways 2.5 m apart, from 8 m to 108 m out on the right, 600 m long.
    const paths = Array.from({ length: 40 }, (_, index) => ({
      kind: 'path',
      kindDetail: 'footway',
      line: besideRoad(300, 900, 8 + index * 2.5),
    }));
    const camera = cameraAt(600);
    const pieces = footwaysInView(
      corridorWith(paths),
      FARMLAND,
      ORIGIN,
      SEED,
      NO_LAND_CLASS,
      camera.x,
      camera.z,
      [],
    );
    const triangles = footwayTriangles(pieces);
    expect(triangles).toBeLessThanOrEqual(FOOTWAY_FRAME_TRIANGLES);
    expect(triangles).toBeGreaterThan(FOOTWAY_FRAME_TRIANGLES * 0.8);
    // What was left out is the farthest: the nearest line is drawn, and nothing
    // drawn is as far from the camera as the reach the cap cut short.
    const laterals = verticesOf(pieces).map(
      (v) => nearestOnDrawnRoad(FARMLAND, ORIGIN, v.x, v.z, 200)?.lateral ?? 0,
    );
    expect(Math.min(...laterals)).toBeLessThan(10);
    const farthest = Math.max(
      ...verticesOf(pieces).map((v) => Math.hypot(v.x - camera.x, v.z - camera.z)),
    );
    expect(farthest).toBeLessThan(FOOTWAY_DRAW_METRES - 40);
  });
});

describe('a footway drawn once, where a village pavement already lies — #2972, #1620', () => {
  const { sites } = siteSpacing(FARMLAND);
  const village = [...Array(sites).keys()]
    .map((index) => siteAt(FARMLAND, SEED, index))
    .find((site): site is Site => site?.kind === 'village') as Site;
  // A sidewalk mapped 4.6 m out on the right through the village and 150 m past
  // it either side: inside the 3.5 to 5.5 m its pavement is laid on there.
  const corridor = corridorWith([
    {
      kind: 'path',
      kindDetail: 'sidewalk',
      line: besideRoad(village.centre - 250, village.centre + 250, 4.6),
    },
  ]);

  function villageFrame(distance: number) {
    const start = atStartLine(FARMLAND);
    return sceneFrame({
      profile: FARMLAND,
      origin: ORIGIN,
      state: { ...start, ride: { ...start.ride, distance: metres(distance) } },
      worldCorridor: corridor,
    });
  }

  it('draws no triangle of it on the pavement, and draws it past the village', () => {
    const frame = villageFrame(village.centre);
    expect(frame.streets.length).toBeGreaterThan(0);
    const bands = frame.streets.map(pavementBands);
    const triangles = frame.footways.flatMap(trianglesOf);
    expect(triangles.length).toBeGreaterThan(20);
    const onIt = triangles.filter((t) => onPavement(bands, t.x, t.z));
    expect(onIt).toEqual([]);
    // The control: the same line with no streets to cut it lies on the pavement.
    const uncut = footwaysInView(
      corridor,
      FARMLAND,
      ORIGIN,
      SEED,
      NO_LAND_CLASS,
      frame.camera.x,
      frame.camera.z,
      [],
    ).flatMap(trianglesOf);
    expect(uncut.filter((t) => onPavement(bands, t.x, t.z)).length).toBeGreaterThan(20);
  });
});

describe('the belt — #2972', () => {
  const pieces = frameAt(1_250).footways;

  it('draws every piece in ONE mesh, off the buffers it uploads, with the pieces’ own colours', () => {
    const belt = new FootwayBelt();
    belt.update(pieces);
    const geometry = belt.mesh.geometry;
    expect(belt.mesh.visible).toBe(true);
    expect((geometry.index?.count ?? 0) / 3).toBe(footwayTriangles(pieces));
    expect(geometry.getAttribute('position').count).toBe(
      pieces.reduce((sum, piece) => sum + piece.positions.length / 3, 0),
    );
    const colours = geometry.getAttribute('color').array as Float32Array;
    expect(Array.from(colours.subarray(0, pieces[0]?.colours.length))).toEqual(
      Array.from(pieces[0]?.colours ?? []),
    );
    expect(geometry.getAttribute('normal').getY(0)).toBe(1);
    belt.dispose();
  });

  it('uploads nothing when the set is the same, and draws nothing when there is none', () => {
    const belt = new FootwayBelt();
    belt.update(pieces);
    const uploaded = belt.mesh.geometry;
    belt.update([...pieces]);
    expect(belt.mesh.geometry).toBe(uploaded);
    belt.update(NO_FOOTWAYS);
    expect(belt.mesh.visible).toBe(false);
    belt.update(pieces);
    belt.setShown(false);
    expect(belt.mesh.visible).toBe(false);
    belt.dispose();
  });
});
