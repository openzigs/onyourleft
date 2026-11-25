// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2973: the mapped streets off the route, drawn out to the fog
 * (`nearby-streets.ts`). Read back through the paths a ride takes: the frame
 * `sceneFrame` builds, the side roads' belt that uploads it, and the plans
 * `footprintPlans` keeps.
 */

import { describe, expect, it } from 'vitest';

import { metres, type RouteProfile } from '@onyourleft/domain';
import type { BuildingFeature, PathFeature, StreetFeature } from '@onyourleft/map-features';

import {
  clearOfSideRoads,
  mappedJunctions,
  onSideRoad,
  sideRoadClearance,
  UNCACHED_SIDE_ROAD_CLEARANCE,
  SIDE_ROAD_LIFT_METRES,
  SIDE_ROAD_WIDTHS,
  sideRoadsAt,
  type SideRoad,
} from './cross-streets';
import {
  buildingBeside,
  rectangleBeside,
  ringBeside,
  streetBeside,
} from './footprint-fixtures-testing';
import { footprintPlans } from './footprint-buildings';
import { landClassMask, NO_LAND_CLASS } from './land-class';
import { ROAD_CLEARANCE_METRES, terrainHeightAt } from './landform';
import {
  NEARBY_STREET_FRAME_TRIANGLES,
  NEARBY_STREET_HANDOVER_METRES,
  NEARBY_STREET_LIFT_METRES,
  NEARBY_STREET_REFRESH_METRES,
  NEARBY_STREET_TRIANGLES_PER_PIECE,
  NEARBY_STREET_VIEW_METRES,
  NEARBY_STREETS_PER_FRAME,
  nearbyStreetLift,
  nearbyStreets,
  nearbyStreetsAt,
  OVERPASS_ROAD_CLEAR_METRES,
  streetRibbon,
} from './nearby-streets';
import { mappedGradeCrossings } from './overpasses';
import { distanceToDrawnRoad, nearestOnDrawnRoad } from './road-grid';
import { northRoute, valleyRoute } from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import { sceneFrame, type SceneInput } from './scene';
import { STRUCTURE_FOOTPRINTS } from './settlements';
import { atStartLine } from './simulation';
import { corridorOrigin, drawnRoadPosition, type CorridorOrigin } from './terrain';
import { FOGGED_OUT_METRES, PavementBelt, SideRoadBelt } from './three-renderer';
import { inWater, waterways } from './waterways';
import type { WorldCorridor } from './world-data/corridor';

/** Three kilometres of rolling farmland due north. */
const ROLLING = northRoute(3_000, (along) => 30 + 12 * Math.sin(along / 240));
const ORIGIN = corridorOrigin(ROLLING);
const SEED = scatterSeed(ROLLING);

function street(
  pairs: readonly (readonly [number, number])[],
  kind: string,
  kindDetail: string,
  grade: StreetFeature['grade'] = 'ground',
  profile: RouteProfile = ROLLING,
  origin: CorridorOrigin = ORIGIN,
): StreetFeature {
  return { kind, kindDetail, grade, line: ringBeside(profile, origin, pairs) };
}

function corridorOf(
  streets: readonly StreetFeature[],
  buildings: readonly BuildingFeature[] = [],
  paths: readonly PathFeature[] = [],
  origin: CorridorOrigin = ORIGIN,
): WorldCorridor {
  return {
    routeId: 'nearby-streets-fixture',
    origin,
    covered: () => true,
    coveredBoxes: [{ minX: -2_000, maxX: 2_000, minZ: -500, maxZ: 3_500 }],
    landUse: [],
    buildings,
    paths,
    streets,
  };
}

/** A residential street parallel to the road, 60 m right of it, nearly the whole route. */
const PARALLEL = street(
  [
    [200, 60],
    [2_800, 60],
  ],
  'minor_road',
  'residential',
);

/** A residential street square across the road at 1 500 m, 200 m each side: it touches. */
const CROSSING = street(
  [
    [1_500, -200],
    [1_500, 200],
  ],
  'minor_road',
  'residential',
);

function frameAt(
  corridor: WorldCorridor,
  distance: number,
  extra: Partial<SceneInput> = {},
  profile: RouteProfile = ROLLING,
  origin: CorridorOrigin = ORIGIN,
): ReturnType<typeof sceneFrame> {
  const start = atStartLine(profile);
  return sceneFrame({
    profile,
    origin,
    state: { ...start, ride: { ...start.ride, distance: metres(distance) } },
    worldCorridor: corridor,
    ...extra,
  });
}

/** The frame's nearby streets: its side roads that are no junction. */
function streetsOf(frame: ReturnType<typeof sceneFrame>): readonly SideRoad[] {
  return frame.sideRoads.filter((road) => road.junction.source === 'street');
}

/** Every drawn station of `roads`, `x, z` pairs: each segment's ends. */
function stations(roads: readonly SideRoad[]): [number, number][] {
  const out: [number, number][] = [];
  for (const road of roads) {
    for (let at = 0; at + 3 < road.segments.length; at += 4) {
      out.push([road.segments[at] as number, road.segments[at + 1] as number]);
      out.push([road.segments[at + 2] as number, road.segments[at + 3] as number]);
    }
  }
  return out;
}

function distanceToRoad(x: number, z: number, profile = ROLLING, origin = ORIGIN): number {
  return distanceToDrawnRoad(profile, origin, x, z, 2_000);
}

describe('a street that never touches the route is drawn — #2973', () => {
  const corridor = corridorOf([PARALLEL]);

  it('as side roads of its own, out to the fog and no further', () => {
    expect(NEARBY_STREET_VIEW_METRES).toBe(FOGGED_OUT_METRES);
    const frame = frameAt(corridor, 1_000);
    const drawn = streetsOf(frame);
    expect(drawn.length).toBeGreaterThan(0);
    const rider = drawnRoadPosition(ROLLING, ORIGIN, 1_000);
    const ahead = stations(drawn).map(([x, z]) => Math.hypot(x - rider.x, z - rider.z));
    // Out to the fog's depth…
    expect(Math.max(...ahead)).toBeGreaterThan(FOGGED_OUT_METRES - 20);
    // …and not past it by more than the refresh and a piece's length.
    expect(Math.max(...ahead)).toBeLessThanOrEqual(
      NEARBY_STREET_VIEW_METRES + NEARBY_STREET_REFRESH_METRES + 64 + 1,
    );
    // The control: the lever leaves only the route's own.
    expect(streetsOf(frameAt(corridor, 1_000, { nearbyStreetsOff: true }))).toEqual([]);
    // And no map data draws none.
    const start = atStartLine(ROLLING);
    expect(
      streetsOf(
        sceneFrame({
          profile: ROLLING,
          origin: ORIGIN,
          state: { ...start, ride: { ...start.ride, distance: metres(1_000) } },
        }),
      ),
    ).toEqual([]);
  });

  it('in the side roads’ ONE mesh, which uploads its triangles', () => {
    const frame = frameAt(corridorOf([PARALLEL, CROSSING]), 1_400);
    const drawn = streetsOf(frame);
    expect(drawn.length).toBeGreaterThan(0);
    const belt = new SideRoadBelt(new PavementBelt('stylised').mesh.material as never);
    const added: unknown[] = [];
    belt.addTo({ add: (object: unknown) => added.push(object) } as never);
    belt.update(frame.sideRoads);
    expect(added).toEqual([belt.mesh]);
    const triangles = (belt.mesh.geometry.index?.count ?? 0) / 3;
    expect(triangles).toBe(
      frame.sideRoads.reduce((sum, road) => sum + road.mesh.indices.length / 3, 0),
    );
    const own = drawn.reduce((sum, road) => sum + road.mesh.indices.length / 3, 0);
    expect(own).toBeGreaterThan(0);
    // The street's own positions are in what was uploaded.
    const uploaded = Array.from(belt.mesh.geometry.getAttribute('position').array);
    const first = Array.from((drawn[0] as SideRoad).mesh.positions.slice(0, 3));
    expect(
      uploaded.some(
        (_, at) =>
          at % 3 === 0 &&
          uploaded[at] === first[0] &&
          uploaded[at + 1] === first[1] &&
          uploaded[at + 2] === first[2],
      ),
    ).toBe(true);
    belt.dispose();
  });

  it('at its class’s width: a highway 9 m, a major road 7, a street 5.5, a driveway 3.5', () => {
    const classes = [
      ['highway', 'motorway', 9],
      ['major_road', 'secondary', 7],
      ['minor_road', 'residential', 5.5],
      ['minor_road', 'service', 3.5],
    ] as const;
    for (const [kind, detail, width] of classes) {
      const corridor = corridorOf([
        street(
          [
            [900, 80],
            [1_100, 80],
          ],
          kind,
          detail,
        ),
      ]);
      const drawn = streetsOf(frameAt(corridor, 1_000));
      expect(drawn.length, detail).toBeGreaterThan(0);
      for (const road of drawn) {
        const p = road.mesh.positions;
        // Each row is its two edges: left then right.
        for (let at = 0; at + 5 < p.length; at += 6) {
          const across = Math.hypot(
            (p[at + 3] as number) - (p[at] as number),
            (p[at + 5] as number) - (p[at + 2] as number),
          );
          expect(across).toBeCloseTo(width, 3);
        }
        expect(Array.from(road.halfWidths).every((half) => half === width / 2)).toBe(true);
      }
    }
  });

  it('stands on the drawn ground, lifted more the farther it is from the road', () => {
    expect(NEARBY_STREET_LIFT_METRES).toBeGreaterThan(SIDE_ROAD_LIFT_METRES);
    expect(nearbyStreetLift(400)).toBeGreaterThan(nearbyStreetLift(10));
    const corridor = corridorOf([
      street(
        [
          [600, -150],
          [1_400, 40],
        ],
        'minor_road',
        'residential',
      ),
    ]);
    const land = landClassMask(corridor);
    const drawn = streetsOf(frameAt(corridor, 1_000, { landClass: land }));
    expect(drawn.length).toBeGreaterThan(0);
    let checked = 0;
    for (const road of drawn) {
      const p = road.mesh.positions;
      for (let at = 0; at + 2 < p.length; at += 3) {
        const x = p[at] as number;
        const z = p[at + 2] as number;
        const near = nearestOnDrawnRoad(ROLLING, ORIGIN, x, z, 2_000);
        if (near === undefined) throw new Error('no road');
        const ground = terrainHeightAt(ROLLING, ORIGIN, SEED, near.along, near.lateral, land);
        expect((p[at + 1] as number) - ground).toBeCloseTo(nearbyStreetLift(near.distance), 1);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('breaks where it would run on water', () => {
    const valley = valleyRoute();
    const origin = corridorOrigin(valley);
    const seed = scatterSeed(valley);
    const ways = waterways(valley, seed, NO_LAND_CLASS);
    const stream = ways.crossings[0];
    if (stream === undefined) throw new Error('the valley fixture has no stream');
    const corridor = corridorOf(
      [
        street(
          [
            [stream.distance - 150, 30],
            [stream.distance + 150, 30],
          ],
          'minor_road',
          'residential',
          'ground',
          valley,
          origin,
        ),
      ],
      [],
      [],
      origin,
    );
    const wet = (x: number, z: number): boolean => {
      const near = nearestOnDrawnRoad(valley, origin, x, z, 100);
      return near !== undefined && inWater(ways, valley, near.along, near.lateral);
    };
    // The control: the street's own line does run through the water.
    const pieces = nearbyStreets(corridor, valley, origin).pieces;
    let lineWet = 0;
    for (const piece of pieces) {
      for (let at = 0; at + 1 < piece.line.length; at += 2) {
        if (wet(piece.line[at] as number, piece.line[at + 1] as number)) lineWet += 1;
      }
    }
    expect(lineWet).toBeGreaterThan(0);
    const drawn = streetsOf(frameAt(corridor, stream.distance, {}, valley, origin));
    expect(drawn.length).toBeGreaterThan(0);
    for (const [x, z] of stations(drawn)) expect(wet(x, z)).toBe(false);
  });

  it('keeps its edge off the main road’s verge — a highway beside it is not drawn', () => {
    // 8.3 m out: off the route (more than the junctions' 8 m), but a 9 m highway's
    // edge would lie on the verge.
    const beside = street(
      [
        [900, 8.3],
        [1_100, 8.3],
      ],
      'highway',
      'motorway',
    );
    expect(nearbyStreets(corridorOf([beside]), ROLLING, ORIGIN).pieces).toEqual([]);
    // The control: 2 m further out it is drawn, its edge off the verge.
    const further = street(
      [
        [900, 10.3],
        [1_100, 10.3],
      ],
      'highway',
      'motorway',
    );
    const pieces = nearbyStreets(corridorOf([further]), ROLLING, ORIGIN).pieces;
    expect(pieces.length).toBeGreaterThan(0);
    for (const piece of pieces) {
      for (let at = 0; at + 1 < piece.line.length; at += 2) {
        expect(
          distanceToRoad(piece.line[at] as number, piece.line[at + 1] as number),
        ).toBeGreaterThanOrEqual(ROAD_CLEARANCE_METRES + SIDE_ROAD_WIDTHS.highway / 2 - 1e-3);
      }
    }
  });

  it('keeps the scenery off it, as off a side road', () => {
    // 20 m out, where the scenery stands thickest.
    const corridor = corridorOf([
      street(
        [
          [200, 20],
          [2_800, 20],
        ],
        'minor_road',
        'residential',
      ),
    ]);
    let checked = 0;
    let wouldStand = 0;
    for (let along = 400; along < 2_600; along += 200) {
      const frame = frameAt(corridor, along);
      const drawn = streetsOf(frame);
      const off = frameAt(corridor, along, { nearbyStreetsOff: true });
      const footprint = (kind: string) =>
        (STRUCTURE_FOOTPRINTS as Record<string, { x: number; back: number; front: number }>)[
          kind
        ] ?? { x: 0, back: 0, front: 0 };
      for (const item of frame.scatter) {
        expect(onSideRoad(drawn, item, footprint(item.kind), 0), item.kind).toBe(false);
        checked += 1;
      }
      wouldStand += off.scatter.filter((item) =>
        onSideRoad(drawn, item, footprint(item.kind), 0),
      ).length;
      // #2439's cache keeps exactly what working each answer out afresh keeps, on the streets too.
      expect(clearOfSideRoads(off.scatter, frame.sideRoads, sideRoadClearance(onSideRoad))).toEqual(
        clearOfSideRoads(off.scatter, frame.sideRoads, UNCACHED_SIDE_ROAD_CLEARANCE),
      );
    }
    expect(checked).toBeGreaterThan(0);
    // The control: with the streets undrawn, the same frames stand things on them.
    expect(wouldStand).toBeGreaterThan(0);
  });

  it('keeps the people off it', () => {
    // Footways across the street, every 20 m, from the road's verge out past it.
    const paths: PathFeature[] = [];
    for (let along = 900; along < 1_100; along += 20) {
      paths.push({
        kind: 'path',
        kindDetail: 'footway',
        line: ringBeside(ROLLING, ORIGIN, [
          [along, 20],
          [along, 100],
        ]),
      });
    }
    const corridor = corridorOf([PARALLEL], [], paths);
    const land = landClassMask(corridor);
    const on = (people: readonly { x: number; z: number }[], roads: readonly SideRoad[]) =>
      people.filter((person) => onSideRoad(roads, { ...person, rotation: 0 }, POINT, 0)).length;
    let walking = 0;
    let wouldStand = 0;
    for (const along of [960, 980, 1_000, 1_020]) {
      const extra = { people: 400, landClass: land };
      const frame = frameAt(corridor, along, extra);
      const drawn = streetsOf(frame);
      expect(drawn.length).toBeGreaterThan(0);
      const all = [...(frame.people?.near ?? []), ...(frame.people?.far ?? [])];
      walking += all.length;
      expect(on(all, drawn)).toBe(0);
      const off = frameAt(corridor, along, { ...extra, nearbyStreetsOff: true });
      wouldStand += on([...(off.people?.near ?? []), ...(off.people?.far ?? [])], drawn);
    }
    expect(walking).toBeGreaterThan(0);
    expect(wouldStand).toBeGreaterThan(0);
  });
});

/** A point: what a person is measured as. */
const POINT = { x: 0, back: 0, front: 0 };

describe('a street that touches the route runs on from its stub — #2973', () => {
  it('drawn from the handover out, and its stub exactly as it was', () => {
    const alone = corridorOf([CROSSING]);
    const pieces = nearbyStreets(alone, ROLLING, ORIGIN).pieces;
    expect(pieces.length).toBeGreaterThan(0);
    let nearest = Number.POSITIVE_INFINITY;
    for (const piece of pieces) {
      for (let at = 0; at + 1 < piece.line.length; at += 2) {
        const off = distanceToRoad(piece.line[at] as number, piece.line[at + 1] as number);
        expect(off).toBeGreaterThanOrEqual(NEARBY_STREET_HANDOVER_METRES);
        nearest = Math.min(nearest, off);
      }
    }
    // No gap: it starts within a step of the handover, where the stub is still whole.
    expect(nearest).toBeLessThan(NEARBY_STREET_HANDOVER_METRES + 4);
    expect(NEARBY_STREET_HANDOVER_METRES).toBeCloseTo(23.5, 6);
    // The stub is the junctions' and is unchanged by the streets beside it.
    const junctions = mappedJunctions(alone, ROLLING, ORIGIN, SEED);
    const withParallel = corridorOf([CROSSING, PARALLEL]);
    const again = mappedJunctions(withParallel, ROLLING, ORIGIN, SEED);
    expect(again.map((junction) => junction.along)).toEqual(
      junctions.map((junction) => junction.along),
    );
    const stubs = (corridor: WorldCorridor) =>
      frameAt(corridor, 1_450).sideRoads.filter((road) => road.junction.source === 'mapped');
    const before = stubs(alone);
    const after = stubs(withParallel);
    expect(after.map((road) => Array.from(road.mesh.positions))).toEqual(
      before.map((road) => Array.from(road.mesh.positions)),
    );
    expect(
      sideRoadsAt(ROLLING, ORIGIN, SEED, 1_400, 1_800, 1_450, again).filter(
        (road) => road.junction.source === 'street',
      ),
    ).toEqual([]);
  });

  it('leaves a bridge’s street to the overpass, its ramp and its banks', () => {
    const at = 2_400;
    const bridge = street(
      [
        [at, -40],
        [at, 40],
      ],
      'major_road',
      'primary',
      'bridge',
    );
    const ways = [
      street(
        [
          [at, 40],
          [at, 420],
        ],
        'major_road',
        'primary',
      ),
      street(
        [
          [at, -40],
          [at, -420],
        ],
        'major_road',
        'primary',
      ),
    ];
    const crossing = mappedGradeCrossings(corridorOf([bridge, ...ways]), ROLLING, ORIGIN).find(
      (each) => each.grade === 'bridge',
    );
    expect(crossing).toBeDefined();
    const { x, z } = crossing as { x: number; z: number };
    const near = (corridor: WorldCorridor) =>
      nearbyStreets(corridor, ROLLING, ORIGIN).pieces.flatMap((piece) => {
        const out: number[] = [];
        for (let each = 0; each + 1 < piece.line.length; each += 2) {
          out.push(
            Math.hypot((piece.line[each] as number) - x, (piece.line[each + 1] as number) - z),
          );
        }
        return out;
      });
    const withBridge = near(corridorOf([bridge, ...ways]));
    expect(withBridge.length).toBeGreaterThan(0);
    expect(Math.min(...withBridge)).toBeGreaterThan(OVERPASS_ROAD_CLEAR_METRES);
    // The control: the same ways with no bridge between them are drawn right up to it.
    expect(Math.min(...near(corridorOf(ways)))).toBeLessThan(OVERPASS_ROAD_CLEAR_METRES);
  });
});

describe('the road wins: no building stands on a nearby street — #2973', () => {
  it('drops a footprint a street runs through, and keeps the house at the end of its drive', () => {
    const house = buildingBeside(ROLLING, ORIGIN, [rectangleBeside(700, -50, 10, 10)], 6);
    const crossed = buildingBeside(ROLLING, ORIGIN, [rectangleBeside(800, -50, 10, 10)], 6);
    const drive = street(
      [
        [700, -15],
        [700, -45],
      ],
      'minor_road',
      'service',
    );
    const through = street(
      [
        [800, -15],
        [800, -110],
      ],
      'minor_road',
      'residential',
    );
    const corridor = corridorOf([drive, through], [house, crossed]);
    const land = landClassMask(corridor);
    const { plans, verdicts } = footprintPlans(corridor, land, ROLLING, ORIGIN);
    expect(verdicts.kept).toBe(1);
    expect(verdicts['on-street']).toBe(1);
    expect(plans).toHaveLength(1);
    // The drive is drawn, and stops short of the wall.
    const pieces = nearbyStreets(corridor, ROLLING, ORIGIN).pieces.filter(
      (piece) => piece.widthClass === 'service',
    );
    expect(pieces.length).toBeGreaterThan(0);
    for (const piece of pieces) {
      for (let at = 0; at + 1 < piece.line.length; at += 2) {
        // Never inside the house's 10 m square, 45 m to 55 m left of the road.
        const off = distanceToRoad(piece.line[at] as number, piece.line[at + 1] as number);
        expect(off).toBeLessThan(45 - SIDE_ROAD_WIDTHS.service / 2);
      }
    }
    // The lever's control: off, no footprint is dropped for a street.
    const off = footprintPlans(corridor, land, ROLLING, ORIGIN, undefined, undefined, {
      nearbyStreets: false,
    });
    expect(off.verdicts.kept).toBe(2);
    expect(off.verdicts['on-street']).toBe(0);
  });

  it('on a grid of streets and footprints, every footprint kept is clear of every street drawn', () => {
    const { corridor } = gridTown();
    const land = landClassMask(corridor);
    const { plans, verdicts } = footprintPlans(corridor, land, ROLLING, ORIGIN);
    // Some footprints are dropped for a street — the control — and most are kept.
    expect(verdicts['on-street']).toBeGreaterThan(0);
    expect(verdicts.kept).toBeGreaterThan(verdicts['on-street']);
    let pairs = 0;
    for (let along = 300; along <= 1_300; along += 200) {
      const drawn = streetsOf(frameAt(corridor, along, { landClass: land }));
      expect(drawn.length).toBeGreaterThan(0);
      const boxes = drawn.map((road) => boxOf(road.segments));
      for (const plan of plans) {
        // A footprint's ring, its corners as a structure's box would be sampled.
        const ring = plan.footprint;
        for (let at = 0; at + 1 < ring.length; at += 2) {
          for (const [index, road] of drawn.entries()) {
            const box = boxes[index] as ReturnType<typeof boxOf>;
            // A road whose box is farther than its widest half cannot reach the corner.
            if (
              Math.max(
                box.minX - (ring[at] as number),
                (ring[at] as number) - box.maxX,
                box.minZ - (ring[at + 1] as number),
                (ring[at + 1] as number) - box.maxZ,
              ) > 5
            ) {
              continue;
            }
            const s = road.segments;
            for (let segment = 0; segment * 4 + 3 < s.length; segment += 1) {
              const half = road.halfWidths[segment] as number;
              expect(
                Math.sqrt(
                  squaredToSegment(
                    ring[at] as number,
                    ring[at + 1] as number,
                    s[segment * 4] as number,
                    s[segment * 4 + 1] as number,
                    s[segment * 4 + 2] as number,
                    s[segment * 4 + 3] as number,
                  ),
                ),
              ).toBeGreaterThanOrEqual(half);
              pairs += 1;
            }
          }
        }
      }
    }
    expect(pairs).toBeGreaterThan(100);
  });
});

describe('what a frame of nearby streets costs — #2973', () => {
  it('is bounded however many streets the town has', () => {
    const dense = (spacing: number): WorldCorridor => {
      const streets: StreetFeature[] = [];
      for (const side of [1, -1]) {
        for (let lateral = 12; lateral < 400; lateral += spacing) {
          streets.push(
            street(
              [
                [100, lateral * side],
                [2_900, lateral * side],
              ],
              'minor_road',
              'residential',
            ),
          );
        }
      }
      return corridorOf(streets);
    };
    for (const spacing of [20, 10]) {
      const drawn = streetsOf(frameAt(dense(spacing), 1_500));
      expect(drawn.length).toBe(NEARBY_STREETS_PER_FRAME);
      let triangles = 0;
      for (const road of drawn) {
        const own = road.mesh.indices.length / 3;
        expect(own).toBeLessThanOrEqual(NEARBY_STREET_TRIANGLES_PER_PIECE);
        triangles += own;
      }
      expect(triangles).toBeLessThanOrEqual(NEARBY_STREET_FRAME_TRIANGLES);
      expect(NEARBY_STREET_FRAME_TRIANGLES).toBe(8_192);
    }
  });

  it('chooses the same pieces until the rider moves on, so the belt is not rebuilt', () => {
    const corridor = corridorOf([PARALLEL]);
    const streets = nearbyStreets(corridor, ROLLING, ORIGIN);
    const first = nearbyStreetsAt(streets, ROLLING, ORIGIN, SEED, 1_000);
    expect(nearbyStreetsAt(streets, ROLLING, ORIGIN, SEED, 1_039)).toBe(first);
    const next = nearbyStreetsAt(streets, ROLLING, ORIGIN, SEED, 1_040);
    expect(next).not.toBe(first);
    // The same piece is the same side road, built once.
    expect(next.filter((road) => first.includes(road)).length).toBeGreaterThan(0);
    const belt = new SideRoadBelt(new PavementBelt('stylised').mesh.material as never);
    belt.update(frameAt(corridor, 1_000).sideRoads);
    const geometry = belt.mesh.geometry;
    belt.update(frameAt(corridor, 1_020).sideRoads);
    expect(belt.mesh.geometry).toBe(geometry);
    belt.dispose();
  });
});

describe('the ribbon, shared with the open world (#2903)', () => {
  const flat = { about: () => () => 1 };
  const line = Float32Array.from([0, 0, 0, 4, 0, 8]);

  it('is a row a station and a quad between rows, across from −half to half', () => {
    const ribbon = streetRibbon(line, 2, flat);
    expect(ribbon.mesh.positions.length / 3).toBe(6);
    expect(ribbon.mesh.indices.length / 3).toBe(4);
    expect(Array.from(ribbon.mesh.across)).toEqual([-2, 2, -2, 2, -2, 2]);
    expect(Array.from(ribbon.mesh.positions.filter((_, at) => at % 3 === 1))).toEqual([
      1, 1, 1, 1, 1, 1,
    ]);
    expect(Array.from(ribbon.segments)).toEqual([0, 0, 0, 4, 0, 4, 0, 8]);
    expect(Array.from(ribbon.halfWidths)).toEqual([2, 2]);
  });

  it('breaks where the ground has none', () => {
    const holed = { about: (_x: number, z: number) => (z === 4 ? undefined : () => 0) };
    const ribbon = streetRibbon(line, 2, holed);
    expect(ribbon.mesh.positions.length / 3).toBe(4);
    expect(ribbon.mesh.indices.length).toBe(0);
    expect(ribbon.segments.length).toBe(0);
  });
});

/** A segment list's box in plan. */
function boxOf(s: Float32Array): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let at = 0; at + 1 < s.length; at += 2) {
    minX = Math.min(minX, s[at] as number);
    maxX = Math.max(maxX, s[at] as number);
    minZ = Math.min(minZ, s[at + 1] as number);
    maxZ = Math.max(maxZ, s[at + 1] as number);
  }
  return { minX, maxX, minZ, maxZ };
}

/** The squared distance from a point to a segment. */
function squaredToSegment(
  x: number,
  z: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const span = dx * dx + dz * dz;
  const t = span > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / span)) : 0;
  return (x - (ax + dx * t)) ** 2 + (z - (az + dz * t)) ** 2;
}

/**
 * A grid town beside {@link ROLLING}: residential streets parallel to the
 * road 50, 100 and 150 m out each side, cross streets every 200 m that touch
 * the route, and an 8 m house every 12 m from 20 m to 170 m out, on
 * residential land — a block's houses, and some the map draws over a street.
 */
function gridTown(): { readonly corridor: WorldCorridor } {
  const streets: StreetFeature[] = [];
  for (const side of [1, -1]) {
    for (const lateral of [50, 100, 150]) {
      streets.push(
        streetBeside(
          ROLLING,
          ORIGIN,
          [
            [200, lateral * side],
            [1_400, lateral * side],
          ],
          'residential',
        ),
      );
    }
  }
  for (let along = 300; along <= 1_300; along += 200) {
    streets.push(
      streetBeside(
        ROLLING,
        ORIGIN,
        [
          [along, -180],
          [along, 180],
        ],
        'residential',
      ),
    );
  }
  const buildings: BuildingFeature[] = [];
  for (const side of [1, -1]) {
    for (let along = 210; along < 1_400; along += 12) {
      for (let lateral = 20; lateral < 170; lateral += 12) {
        buildings.push(
          buildingBeside(ROLLING, ORIGIN, [rectangleBeside(along, lateral * side, 8, 8)], 6),
        );
      }
    }
  }
  return {
    corridor: {
      ...corridorOf(streets, buildings),
      landUse: [
        {
          layer: 'landuse',
          kind: 'residential',
          rings: [
            ringBeside(ROLLING, ORIGIN, [
              [150, -200],
              [1_450, -200],
              [1_450, 200],
              [150, 200],
            ]),
          ],
        },
      ],
    },
  };
}

describe('a corridor far wider than the view — #3106', () => {
  /** How far each drawn station of `corridor`'s pieces is from the road. */
  const lateralsOf = (corridor: WorldCorridor): number[] =>
    nearbyStreets(corridor, ROLLING, ORIGIN).pieces.flatMap((piece) => {
      const out: number[] = [];
      for (let at = 0; at + 1 < piece.line.length; at += 2) {
        out.push(
          distanceToDrawnRoad(
            ROLLING,
            ORIGIN,
            piece.line[at] as number,
            piece.line[at + 1] as number,
            3_000,
          ),
        );
      }
      return out;
    });

  it('spends its bound near the road alone: far streets read first leave the near ones drawn', () => {
    // 410 km of street two kilometres and more off the road, in 100 m
    // segments: an open-world ride's far blocks, read before the rider's own.
    const far: StreetFeature[] = Array.from({ length: 205 }, (_, index) =>
      street(
        Array.from(
          { length: 21 },
          (_, vertex) => [500 + vertex * 100, 2_000 + index * 20] as const,
        ),
        'minor_road',
        'residential',
      ),
    );
    const corridor = corridorOf([...far, PARALLEL, CROSSING]);
    const found = nearbyStreets(corridor, ROLLING, ORIGIN);
    // The parallel street whole, and the crossing street past its stubs.
    const alone = nearbyStreets(corridorOf([PARALLEL, CROSSING]), ROLLING, ORIGIN);
    expect(alone.pieces.length).toBeGreaterThan(40);
    expect(found.pieces).toHaveLength(alone.pieces.length);
    // And through a frame: the streets are in the side roads the frame draws.
    expect(streetsOf(frameAt(corridor, 1_400)).length).toBeGreaterThan(5);
    // None of the far streets is a piece: nothing of them can be in view.
    expect(Math.max(...lateralsOf(corridor))).toBeLessThan(300);
  });

  it('makes no station out of sight of the road, and runs no piece across the gap', () => {
    // Out from the road, a kilometre and a half off, along, and back to it.
    const loop = street(
      [
        [500, 30],
        [500, 900],
        [500, 1_500],
        [900, 1_500],
        [900, 900],
        [900, 30],
      ],
      'minor_road',
      'residential',
    );
    const found = nearbyStreets(corridorOf([loop]), ROLLING, ORIGIN);
    for (const piece of found.pieces) {
      for (let at = 0; at + 3 < piece.line.length; at += 2) {
        // Consecutive stations of one piece are a step apart, never the gap's 1.6 km.
        expect(
          Math.hypot(
            (piece.line[at + 2] as number) - (piece.line[at] as number),
            (piece.line[at + 3] as number) - (piece.line[at + 1] as number),
          ),
        ).toBeLessThanOrEqual(4.01);
      }
    }
    const laterals = lateralsOf(corridorOf([loop]));
    // Both legs are drawn where they are in sight, and nothing past 900 m is made.
    expect(Math.min(...laterals)).toBeLessThan(40);
    expect(Math.max(...laterals)).toBeLessThanOrEqual(900.5);
    // The leg coming back stands where it would have with every station made:
    // each a whole number of steps along the street from its start.
    const vertex = (index: number): readonly [number, number] => [
      loop.line[index * 2] as number,
      loop.line[index * 2 + 1] as number,
    ];
    let toLastLeg = 0;
    for (let index = 0; index < 4; index += 1) {
      const [ax, az] = vertex(index);
      const [bx, bz] = vertex(index + 1);
      toLastLeg += Math.hypot(bx - ax, bz - az);
    }
    const [fromX, fromZ] = vertex(4);
    const [endX, endZ] = vertex(5);
    const back = found.pieces.flatMap((piece) => {
      const out: number[] = [];
      for (let at = 0; at + 1 < piece.line.length; at += 2) {
        const x = piece.line[at] as number;
        const z = piece.line[at + 1] as number;
        const fromVertex = Math.hypot(x - fromX, z - fromZ);
        const fromEnd = Math.hypot(x - endX, z - endZ);
        // On the last leg, clear of the vertex it comes back in at and of the street's end.
        const onLeg =
          Math.abs(fromVertex + fromEnd - Math.hypot(endX - fromX, endZ - fromZ)) < 0.01;
        if (onLeg && fromVertex > 1 && fromEnd > 1) out.push(toLastLeg + fromVertex);
      }
      return out;
    });
    expect(back.length).toBeGreaterThan(50);
    for (const arc of back) {
      const off = arc % 4;
      expect(Math.min(off, 4 - off)).toBeLessThan(0.05);
    }
  });

  it('draws a fork from the road’s verge, and a street at a junction’s angle from past its stub', () => {
    /** A street leaving the road at 1 500 m at `degrees`, 300 m long. */
    const leaving = (degrees: number): StreetFeature => {
      const radians = (degrees * Math.PI) / 180;
      return street(
        [
          [1_500, 0],
          [1_500 + 300 * Math.cos(radians), 300 * Math.sin(radians)],
        ],
        'minor_road',
        'residential',
      );
    };
    // A fork has no stub (`cross-streets.ts`): it is drawn from clear of the
    // verge. Until #3106 it was drawn from the hand-over, 69 m along it.
    const fork = Math.min(...lateralsOf(corridorOf([leaving(20)])));
    expect(fork).toBeGreaterThanOrEqual(ROAD_CLEARANCE_METRES + SIDE_ROAD_WIDTHS.minor / 2);
    expect(fork).toBeLessThan(ROAD_CLEARANCE_METRES + SIDE_ROAD_WIDTHS.minor / 2 + 4);
    expect(mappedJunctions(corridorOf([leaving(20)]), ROLLING, ORIGIN, SEED)).toHaveLength(0);
    // Control: at 45° there is a stub, and the street is drawn from past it.
    const crossing = Math.min(...lateralsOf(corridorOf([leaving(45)])));
    expect(crossing).toBeGreaterThanOrEqual(NEARBY_STREET_HANDOVER_METRES);
    expect(mappedJunctions(corridorOf([leaving(45)]), ROLLING, ORIGIN, SEED)).toHaveLength(1);
  });
});
