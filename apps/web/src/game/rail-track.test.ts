// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Railway track — #3253. Read back through `sceneFrame`, the path a ride's
 * frames take, and through `SideRoadBelt`, the mesh that draws them: a mapped
 * line is a ballast bed with shoulders, sleepers at their spacing and two
 * rails at gauge, standing on the heights the road's side roads stand on; a
 * level crossing is the road's surface with a crossbuck each way, and lights
 * and gates only where a tag says; a bridge is a deck carrying the same
 * track. Every corridor here is arithmetic beside a synthetic road: no place.
 */

import { describe, expect, it } from 'vitest';

import { elevationAt, metres, seconds } from '@onyourleft/domain';
import type { RailFeature, StreetFeature, StreetGrade } from '@onyourleft/map-features';

import {
  BALLAST,
  onSideRoad,
  RAIL_HALF_GAUGE_METRES,
  RAIL_MAX_METRES,
  RAIL_ON_ROAD_METRES,
  RAIL_STEEL,
  SIDE_ROAD_LIFT_METRES,
  type SideRoad,
} from './cross-streets';
import { ringBeside } from './footprint-fixtures-testing';
import { NO_LAND_CLASS } from './land-class';
import { terrainHeightAt } from './landform';
import {
  BALLAST_CROWN_METRES,
  BALLAST_DEPTH_METRES,
  BALLAST_SHOULDER,
  BALLAST_SHOULDER_METRES,
  CROSSBUCK_HEIGHT_METRES,
  CROSSBUCK_SETBACK_METRES,
  CROSSBUCK_VERGE_METRES,
  CROSSBUCK_WHITE,
  CROSSING_PANEL,
  DECK_CLEARANCE_METRES,
  DECK_GIRDER,
  DECK_GIRDER_METRES,
  GATE_RED,
  RAIL_HEAD_WIDTH_METRES,
  RAIL_HEIGHT_METRES,
  RAIL_TRACK_NEAR_METRES,
  RAIL_TRACK_REFRESH_METRES,
  RAIL_TRACK_VIEW_METRES,
  RAIL_WEB,
  railTrack,
  SIGNAL_BLACK,
  SIGNAL_RED,
  SLEEPER,
  SLEEPER_FAR,
  SLEEPER_LENGTH_METRES,
  SLEEPER_PROUD_METRES,
  SLEEPER_SPACING_METRES,
  SLEEPER_WIDTH_METRES,
  TRACK_WALL,
} from './rail-track';
import {
  RAIL_CROSSING_FURNITURE_TRIANGLES,
  RAIL_CROSSINGS_PER_FRAME,
  RAIL_TRACK_FAR_PIECE_TRIANGLES,
  RAIL_TRACK_NEAR_PIECE_TRIANGLES,
  RAIL_TRACK_NEAR_PIECES,
  RAIL_TRACK_PIECES_PER_FRAME,
  REALISTIC_RAIL_TRACK_TRIANGLES,
} from './realistic-budget';
import { PEOPLE_NEAR_MAX, PERSON_HALF_WIDTH_METRES } from './people';
import { nearestOnDrawnRoad } from './road-grid';
import { northRoute } from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import { sceneFrame } from './scene';
import { STRUCTURE_FOOTPRINTS } from './settlements';
import { atStartLine } from './simulation';
import { corridorOrigin, ROAD_WIDTH_METRES } from './terrain';
import { PavementBelt, SideRoadBelt } from './three-renderer';
import { inWater, waterways } from './waterways';
import type { RailCrossingTag, WorldCorridor } from './world-data/corridor';

/** Six kilometres of rolling farmland due north: heights that change under a track. */
const ROLLING = northRoute(6_000, (along) => 30 + 12 * Math.sin(along / 240));
const ORIGIN = corridorOrigin(ROLLING);
const SEED = scatterSeed(ROLLING);
const WAYS = waterways(ROLLING, SEED, NO_LAND_CLASS);

function rail(
  pairs: readonly (readonly [number, number])[],
  grade: StreetGrade = 'ground',
): RailFeature {
  return { kindDetail: 'rail', grade, line: ringBeside(ROLLING, ORIGIN, pairs) };
}

function corridorOf(
  rails: readonly RailFeature[] | undefined,
  railCrossings?: readonly RailCrossingTag[],
): WorldCorridor {
  return {
    routeId: 'rail-track-fixture',
    origin: ORIGIN,
    covered: () => true,
    coveredBoxes: [],
    landUse: [],
    buildings: [],
    paths: [],
    streets: [],
    ...(rails === undefined ? {} : { rails }),
    ...(railCrossings === undefined ? {} : { railCrossings }),
  };
}

function frameAt(distance: number, worldCorridor?: WorldCorridor) {
  const start = atStartLine(ROLLING);
  return sceneFrame({
    profile: ROLLING,
    origin: ORIGIN,
    state: { ...start, ride: { ...start.ride, distance: metres(distance) } },
    ...(worldCorridor === undefined ? {} : { worldCorridor }),
  });
}

/** The frame's railway: its side roads from `rail-track.ts`. */
function trackOf(frame: ReturnType<typeof frameAt>): readonly SideRoad[] {
  return frame.sideRoads.filter((road) => road.junction.source === 'rail');
}

type Colour = readonly [number, number, number];

interface Corner {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Where on the route it is beside, and how far off the centreline, signed. */
  readonly along: number;
  readonly lateral: number;
}

interface Quad {
  readonly colour: readonly [number, number, number];
  readonly corners: readonly Corner[];
}

/** Every quad of `roads`: `rail-track.ts` gives each its own four vertices, in one colour. */
function quadsOf(roads: readonly SideRoad[]): Quad[] {
  const out: Quad[] = [];
  for (const { mesh } of roads) {
    expect(mesh.indices.length % 6).toBe(0);
    for (let at = 0; at < mesh.indices.length; at += 6) {
      const first = mesh.indices[at] as number;
      const corners = [0, 1, 2, 3].map((corner) => {
        const v = (first + corner) * 3;
        const x = mesh.positions[v] as number;
        const z = mesh.positions[v + 2] as number;
        const near = nearestOnDrawnRoad(ROLLING, ORIGIN, x, z, 1_000);
        if (near === undefined) throw new Error('a vertex off the fixture');
        return {
          x,
          y: mesh.positions[v + 1] as number,
          z,
          along: near.along,
          lateral: near.lateral,
        };
      });
      out.push({
        colour: [
          mesh.colours[first * 3] as number,
          mesh.colours[first * 3 + 1] as number,
          mesh.colours[first * 3 + 2] as number,
        ],
        corners,
      });
    }
  }
  return out;
}

function is(colour: Colour): (quad: Quad) => boolean {
  return (quad) =>
    quad.colour.every((channel, at) => channel === Math.fround(colour[at] as number));
}

function centre(quad: Quad): { along: number; lateral: number; y: number } {
  const mean = (pick: (corner: Corner) => number) =>
    quad.corners.reduce((sum, corner) => sum + pick(corner), 0) / quad.corners.length;
  return { along: mean((c) => c.along), lateral: mean((c) => c.lateral), y: mean((c) => c.y) };
}

function span(quad: Quad, pick: (corner: Corner) => number): number {
  const values = quad.corners.map(pick);
  return Math.max(...values) - Math.min(...values);
}

function triangles(roads: readonly SideRoad[]): number {
  return roads.reduce((sum, road) => sum + road.mesh.indices.length / 3, 0);
}

function groundAt(along: number, lateral: number): number {
  return terrainHeightAt(ROLLING, ORIGIN, SEED, along, lateral, NO_LAND_CLASS);
}

function roadAt(along: number): number {
  return elevationAt(ROLLING, metres(along)) - ORIGIN.elevation;
}

/** A stretch `length` long, `lateral` off the road, that no stream or lake breaks. */
function dryStretch(length: number, lateral: number, after = 600): number {
  for (let from = after; from + length < ROLLING.totalDistance - 600; from += 20) {
    let dry = true;
    for (let along = from - 200; dry && along <= from + length + 200; along += 4) {
      for (const offset of [-lateral, -3, 0, 3, lateral]) {
        if (inWater(WAYS, ROLLING, along, offset)) dry = false;
      }
    }
    if (dry) return from;
  }
  throw new Error('no dry stretch on the fixture');
}

/** How far the track runs off the road in most of these: past the ramp, well inside the drawn ground. */
const BESIDE = 40;

describe('a mapped line is drawn as track — #3253', () => {
  const from = dryStretch(600, BESIDE);
  const corridor = corridorOf([
    rail([
      [from, BESIDE],
      [from + 600, BESIDE],
    ]),
  ]);
  const frame = frameAt(from + 300, corridor);
  const track = trackOf(frame);
  const quads = quadsOf(track);

  it('along its whole length in view, though it never crosses the route — and none without a line', () => {
    expect(track.length).toBeGreaterThan(10);
    const alongs = quads.flatMap((quad) => quad.corners.map((corner) => corner.along));
    // To the metre or two a route distance differs from the drawn road's own.
    expect(Math.abs(Math.min(...alongs) - from)).toBeLessThan(3);
    expect(Math.abs(Math.max(...alongs) - (from + 600))).toBeLessThan(3);
    // The controls: a corridor with no railway, one kept before #2660, and no map data.
    expect(trackOf(frameAt(from + 300, corridorOf([])))).toEqual([]);
    expect(trackOf(frameAt(from + 300, corridorOf(undefined)))).toEqual([]);
    expect(trackOf(frameAt(from + 300))).toEqual([]);
  });

  it('a ballast bed: a crown its stated width, and a shoulder each side down to the ground', () => {
    const crown = quads.filter(is(BALLAST));
    expect(crown.length).toBeGreaterThan(100);
    for (const quad of crown) {
      expect(span(quad, (c) => c.lateral)).toBeCloseTo(BALLAST_CROWN_METRES, 3);
      expect(centre(quad).lateral).toBeCloseTo(BESIDE, 3);
    }
    const shoulders = quads.filter(is(BALLAST_SHOULDER));
    // One each side of every step of crown.
    expect(shoulders).toHaveLength(crown.length * 2);
    const half = BALLAST_CROWN_METRES / 2;
    for (const quad of shoulders) {
      const out = quad.corners.map((corner) => Math.abs(corner.lateral - BESIDE));
      expect(Math.min(...out)).toBeCloseTo(half, 3);
      expect(Math.max(...out)).toBeCloseTo(half + BALLAST_SHOULDER_METRES, 3);
    }
  });

  it('two steel rails at standard gauge, each a rusted web under a bright running surface', () => {
    const near = quads.filter(
      (quad) => is(RAIL_STEEL)(quad) && Math.abs(centre(quad).along - (from + 300)) < 60,
    );
    expect(near.length).toBeGreaterThan(20);
    const offsets = near.map((quad) => centre(quad).lateral - BESIDE);
    for (const offset of offsets) {
      expect(Math.abs(offset)).toBeCloseTo(RAIL_HALF_GAUGE_METRES, 3);
    }
    // Two rails, as many steps of each.
    expect(offsets.filter((offset) => offset > 0)).toHaveLength(offsets.length / 2);
    for (const quad of near) {
      // The running surface: level across the rail, its head's width.
      expect(span(quad, (c) => c.lateral)).toBeCloseTo(RAIL_HEAD_WIDTH_METRES, 3);
    }
    const webs = quads.filter(
      (quad) => is(RAIL_WEB)(quad) && Math.abs(centre(quad).along - (from + 300)) < 60,
    );
    // An outer and an inner face under every running surface.
    expect(webs).toHaveLength(near.length * 2);
    for (const quad of webs) {
      expect(span(quad, (c) => c.lateral)).toBeCloseTo(0, 4);
      // Upright: the rail's height, less what the ground's fall along the step adds.
      const feet = quad.corners.map((corner) => corner.y);
      expect(Math.max(...feet) - Math.min(...feet)).toBeGreaterThan(RAIL_HEIGHT_METRES - 0.001);
    }
  });

  it('sleepers at their spacing, unbroken where one piece meets the next', () => {
    const sleepers = quads.filter(is(SLEEPER));
    expect(sleepers.length).toBeGreaterThan(300);
    for (const quad of sleepers) {
      expect(span(quad, (c) => c.lateral)).toBeCloseTo(SLEEPER_LENGTH_METRES, 3);
      expect(span(quad, (c) => c.along)).toBeCloseTo(SLEEPER_WIDTH_METRES, 3);
      expect(centre(quad).lateral).toBeCloseTo(BESIDE, 3);
    }
    const alongs = sleepers.map((quad) => centre(quad).along).sort((a, b) => a - b);
    // Several pieces' worth, so the run crosses piece boundaries.
    expect((alongs.at(-1) as number) - (alongs[0] as number)).toBeGreaterThan(200);
    for (let at = 1; at < alongs.length; at += 1) {
      expect((alongs[at] as number) - (alongs[at - 1] as number)).toBeCloseTo(
        SLEEPER_SPACING_METRES,
        2,
      );
    }
  });

  it('with its sleepers near the rider and a strip in their place far off', () => {
    const rider = from + 300;
    const sleepers = quads.filter(is(SLEEPER));
    const strips = quads.filter(is(SLEEPER_FAR));
    expect(strips.length).toBeGreaterThan(0);
    for (const quad of sleepers) {
      expect(Math.abs(centre(quad).along - rider)).toBeLessThan(
        RAIL_TRACK_NEAR_METRES + RAIL_TRACK_REFRESH_METRES + 40,
      );
    }
    // No step carries both, and a strip is the sleepers' length across.
    for (const quad of strips) {
      expect(span(quad, (c) => c.lateral)).toBeCloseTo(SLEEPER_LENGTH_METRES, 3);
      expect(
        sleepers.some((sleeper) => Math.abs(centre(sleeper).along - centre(quad).along) < 1.5),
      ).toBe(false);
    }
    // Far off a rail is its one upright face, still at gauge.
    const far = quads.filter(
      (quad) => is(RAIL_STEEL)(quad) && Math.abs(centre(quad).along - rider) > 250,
    );
    expect(far.length).toBeGreaterThan(0);
    for (const quad of far) {
      expect(span(quad, (c) => c.lateral)).toBeCloseTo(0, 4);
      expect(Math.abs(centre(quad).lateral - BESIDE)).toBeCloseTo(RAIL_HALF_GAUGE_METRES, 3);
    }
  });
});

describe('the track is a real one’s size — #3253', () => {
  it('standard gauge, sleepers every 0.6 m, and a bed, a sleeper and a rail of their real measure', () => {
    expect(RAIL_HALF_GAUGE_METRES * 2).toBeCloseTo(1.435, 6);
    expect(SLEEPER_SPACING_METRES).toBe(0.6);
    expect([SLEEPER_LENGTH_METRES, SLEEPER_WIDTH_METRES]).toEqual([2.6, 0.25]);
    expect([RAIL_HEIGHT_METRES, RAIL_HEAD_WIDTH_METRES]).toEqual([0.16, 0.07]);
    expect([BALLAST_CROWN_METRES, BALLAST_SHOULDER_METRES, BALLAST_DEPTH_METRES]).toEqual([
      3.4, 0.45, 0.3,
    ]);
  });
});

describe('the track stands on the heights the road uses — #3253', () => {
  const from = dryStretch(600, BESIDE);
  const corridor = corridorOf([
    rail([
      [from, BESIDE],
      [from + 600, BESIDE],
    ]),
  ]);
  const quads = quadsOf(trackOf(frameAt(from + 300, corridor)));

  it('the fixture’s ground rises and falls under it', () => {
    const heights = quads.filter(is(BALLAST)).flatMap((quad) => quad.corners.map((c) => c.y));
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(3);
  });

  it('its crown the bed’s depth over the drawn ground at every vertex, never over or under it', () => {
    for (const quad of quads.filter(is(BALLAST))) {
      for (const corner of quad.corners) {
        expect(corner.y).toBeCloseTo(
          groundAt(corner.along, corner.lateral) + BALLAST_DEPTH_METRES + SIDE_ROAD_LIFT_METRES,
          3,
        );
      }
    }
  });

  it('its shoulders’ feet in the drawn ground', () => {
    for (const quad of quads.filter(is(BALLAST_SHOULDER))) {
      const feet = quad.corners.filter(
        (corner) => Math.abs(corner.lateral - BESIDE) > BALLAST_CROWN_METRES / 2 + 0.1,
      );
      expect(feet).toHaveLength(2);
      for (const foot of feet) {
        const ground = groundAt(foot.along, foot.lateral);
        expect(foot.y).toBeLessThan(ground);
        expect(foot.y).toBeGreaterThan(ground - 0.1);
      }
    }
  });

  it('its sleepers bedded in the crown and its rails standing on them', () => {
    const crownAt = (along: number): number =>
      groundAt(along, BESIDE) + BALLAST_DEPTH_METRES + SIDE_ROAD_LIFT_METRES;
    for (const quad of quads.filter(is(SLEEPER))) {
      const here = centre(quad);
      // Within the fall of the ground across a crown: a sleeper lies on the crown's own plane.
      expect(here.y - crownAt(here.along)).toBeGreaterThan(SLEEPER_PROUD_METRES - 0.03);
      expect(here.y - crownAt(here.along)).toBeLessThan(SLEEPER_PROUD_METRES + 0.03);
    }
    for (const quad of quads.filter(is(RAIL_STEEL))) {
      const here = centre(quad);
      if (span(quad, (c) => c.lateral) < 0.01) continue;
      const head = SLEEPER_PROUD_METRES + RAIL_HEIGHT_METRES;
      expect(here.y - crownAt(here.along)).toBeGreaterThan(head - 0.08);
      expect(here.y - crownAt(here.along)).toBeLessThan(head + 0.08);
    }
  });
});

describe('a level crossing — #3253', () => {
  const at = dryStretch(80, 200, 1_500) + 40;
  // From 201.5 m off, so that no station of it falls on the carriageway's edge:
  // the surface must be cut there, not happen to end there.
  const line = rail([
    [at, -201.5],
    [at, 200],
  ]);
  const half = ROAD_WIDTH_METRES / 2;
  const framed = (tags?: readonly RailCrossingTag[]) =>
    quadsOf(trackOf(frameAt(at - 30, corridorOf([line], tags))));
  const here = ringBeside(ROLLING, ORIGIN, [[at, 0]]);
  const tag = (lights: boolean, gates: boolean, offset = 0): RailCrossingTag => {
    const point = ringBeside(ROLLING, ORIGIN, [[at + offset, 0]]);
    return { x: point[0] as number, z: point[1] as number, lights, gates };
  };
  const quads = framed();

  it('is the road’s surface between and beside the rails, level with the road, and no bed on it', () => {
    const panels = quads.filter(is(CROSSING_PANEL));
    expect(panels.length).toBeGreaterThan(0);
    // The whole carriageway is under a panel.
    for (let lateral = -half; lateral <= half; lateral += 0.5) {
      expect(
        panels.some((quad) => {
          const laterals = quad.corners.map((corner) => corner.lateral);
          return Math.min(...laterals) <= lateral && lateral <= Math.max(...laterals);
        }),
      ).toBe(true);
    }
    // Between the rails and beside them: the bed's whole width, along the road.
    for (const quad of panels) {
      expect(span(quad, (c) => c.along)).toBeCloseTo(BALLAST_CROWN_METRES, 2);
      for (const corner of quad.corners) {
        // The road's own surface, and no farther past its edge than a crossing's boards run.
        expect(Math.abs(corner.lateral)).toBeLessThan(half + 0.51);
        if (Math.abs(corner.lateral) > half) continue;
        expect(corner.y).toBeCloseTo(roadAt(corner.along) + SIDE_ROAD_LIFT_METRES, 3);
      }
    }
    // No ballast, sleeper or strip anywhere on the carriageway.
    for (const quad of quads.filter(
      (each) => is(BALLAST)(each) || is(SLEEPER)(each) || is(SLEEPER_FAR)(each),
    )) {
      expect(Math.min(...quad.corners.map((c) => Math.abs(c.lateral)))).toBeGreaterThan(half);
    }
    // …and it is ballast again past the crossing, with its sleepers.
    expect(quads.filter(is(BALLAST)).length).toBeGreaterThan(20);
    expect(quads.filter(is(SLEEPER)).length).toBeGreaterThan(100);
  });

  it('carries both rails across the carriageway, their heads just proud of the road', () => {
    const onRoad = quads.filter(
      (quad) =>
        is(RAIL_STEEL)(quad) &&
        quad.corners.every((corner) => Math.abs(corner.lateral) <= half + 0.51) &&
        span(quad, (c) => c.along) > 0.01,
    );
    // Each rail's running surface, from one edge of the carriageway to the other.
    for (const side of [-1, 1]) {
      const one = onRoad.filter((quad) => Math.sign(centre(quad).along - at) === side);
      const laterals = one.flatMap((quad) => quad.corners.map((corner) => corner.lateral));
      expect(Math.min(...laterals)).toBeLessThanOrEqual(-half);
      expect(Math.max(...laterals)).toBeGreaterThanOrEqual(half);
      for (const quad of one) {
        expect(Math.abs(centre(quad).along - at)).toBeCloseTo(RAIL_HALF_GAUGE_METRES, 2);
        for (const corner of quad.corners.filter((c) => Math.abs(c.lateral) <= half)) {
          expect(corner.y).toBeCloseTo(
            roadAt(corner.along) + SIDE_ROAD_LIFT_METRES + RAIL_ON_ROAD_METRES,
            3,
          );
        }
      }
    }
  });

  it('stands a crossbuck on the rider’s right each way, short of the track, on the ground', () => {
    const boards = quads.filter(is(CROSSBUCK_WHITE));
    // Two crossed boards a sign, a sign each way.
    expect(boards).toHaveLength(4);
    const signs = [boards.slice(0, 2), boards.slice(2)];
    const places = signs.map((pair) => centre(pair[0] as Quad));
    expect(places.map((place) => Math.sign(place.lateral)).sort()).toEqual([-1, 1]);
    for (const [index, pair] of signs.entries()) {
      const place = places[index] as (typeof places)[number];
      // The same post carries both boards, crossed.
      expect(centre(pair[1] as Quad).lateral).toBeCloseTo(place.lateral, 2);
      expect(Math.abs(place.lateral)).toBeCloseTo(half + CROSSBUCK_VERGE_METRES, 2);
      // On the right going up the road it is before the track; on the left, past it.
      expect((at - place.along) * Math.sign(place.lateral)).toBeCloseTo(
        CROSSBUCK_SETBACK_METRES,
        0,
      );
      const base = quads
        .filter((quad) => !is(CROSSBUCK_WHITE)(quad))
        .flatMap((quad) => quad.corners)
        .filter((corner) => Math.abs(corner.lateral - place.lateral) < 0.2)
        .filter((corner) => Math.abs(corner.along - place.along) < 0.3)
        .reduce((low, corner) => Math.min(low, corner.y), Infinity);
      // The post's foot is in the ground it stands on, and the boards cross at their height over it.
      const stood = place.y - CROSSBUCK_HEIGHT_METRES;
      expect(base).toBeLessThan(stood);
      expect(base).toBeGreaterThan(stood - 0.1);
      const ground = groundAt(place.along, place.lateral);
      const road = roadAt(place.along);
      expect(stood).toBeGreaterThanOrEqual(Math.min(ground, road) - 0.001);
      expect(stood).toBeLessThanOrEqual(Math.max(ground, road) + 0.001);
    }
  });

  it('and no lights and no gate where the map tags none', () => {
    expect(quads.filter(is(SIGNAL_RED))).toEqual([]);
    expect(quads.filter(is(SIGNAL_BLACK))).toEqual([]);
    expect(quads.filter(is(GATE_RED))).toEqual([]);
    // A tag for another crossing, 60 m up the road, is not this one's.
    const elsewhere = framed([tag(true, true, 60)]);
    expect(elsewhere.filter(is(SIGNAL_RED))).toEqual([]);
    expect(elsewhere.filter(is(GATE_RED))).toEqual([]);
    expect(elsewhere.filter(is(CROSSBUCK_WHITE))).toHaveLength(4);
  });

  it('lights where it is tagged with lights: a pair under each crossbuck, and still no gate', () => {
    expect(here).toHaveLength(2);
    const lit = framed([tag(true, false)]);
    // Two lamps a sign, each an octagon of two quads, on a backing board.
    expect(lit.filter(is(SIGNAL_RED))).toHaveLength(8);
    expect(lit.filter(is(SIGNAL_BLACK))).toHaveLength(4);
    expect(lit.filter(is(GATE_RED))).toEqual([]);
    const boards = lit.filter(is(CROSSBUCK_WHITE));
    expect(boards).toHaveLength(4);
    for (const lamp of lit.filter(is(SIGNAL_RED))) {
      const sign = boards
        .map(centre)
        .sort(
          (a, b) =>
            Math.abs(a.lateral - centre(lamp).lateral) - Math.abs(b.lateral - centre(lamp).lateral),
        )[0] as ReturnType<typeof centre>;
      expect(centre(lamp).y).toBeLessThan(sign.y - 0.3);
      expect(Math.abs(centre(lamp).lateral - sign.lateral)).toBeCloseTo(0.4, 2);
    }
  });

  it('a gate where it is tagged with gates, raised, and the lights a gated crossing has', () => {
    const gated = framed([tag(false, true)]);
    const bands = gated.filter(is(GATE_RED));
    // Three red bands of five, a gate each way.
    expect(bands).toHaveLength(6);
    expect(gated.filter(is(SIGNAL_RED))).toHaveLength(8);
    // Raised: the arm stands over the verge and leaves the carriageway clear.
    for (const band of bands) {
      for (const corner of band.corners) {
        expect(Math.abs(corner.lateral)).toBeGreaterThan(half);
      }
    }
    expect(Math.max(...bands.map((band) => span(band, (c) => c.y)))).toBeGreaterThan(0.7);
  });

  it('sets the sign back square to the track at a skew crossing too', () => {
    const skew = rail([
      [at - 150, -150],
      [at + 150, 150],
    ]);
    const boards = quadsOf(trackOf(frameAt(at - 30, corridorOf([skew])))).filter(
      is(CROSSBUCK_WHITE),
    );
    expect(boards).toHaveLength(4);
    for (const board of boards) {
      const place = centre(board);
      // The track is the line `along − at = lateral`: how far square to it a point is.
      expect(Math.abs(place.along - at - place.lateral) / Math.SQRT2).toBeCloseTo(
        CROSSBUCK_SETBACK_METRES,
        0,
      );
    }
  });
});

describe('a rail bridge — #3253', () => {
  const at = dryStretch(80, 200, 2_600) + 40;
  const over = corridorOf([
    rail([
      [at, -200],
      [at, -60],
    ]),
    rail(
      [
        [at, -60],
        [at, 60],
      ],
      'bridge',
    ),
    rail([
      [at, 60],
      [at, 200],
    ]),
  ]);
  const quads = quadsOf(trackOf(frameAt(at - 30, over)));
  const half = ROAD_WIDTH_METRES / 2;

  it('is a deck over the route carrying the same track, clear of the road, and no level crossing', () => {
    const girders = quads.filter(is(DECK_GIRDER));
    expect(girders.length).toBeGreaterThan(0);
    for (const quad of girders) {
      expect(Math.max(...quad.corners.map((c) => Math.abs(c.lateral)))).toBeLessThanOrEqual(60.01);
      expect(span(quad, (c) => c.y)).toBeGreaterThan(DECK_GIRDER_METRES - 0.2);
    }
    // The same track on it: bed, sleepers and rails over the carriageway.
    const overRoad = (quad: Quad): boolean =>
      quad.corners.some((corner) => Math.abs(corner.lateral) < half);
    expect(quads.filter((quad) => is(BALLAST)(quad) && overRoad(quad)).length).toBeGreaterThan(0);
    expect(quads.filter((quad) => is(SLEEPER)(quad) && overRoad(quad)).length).toBeGreaterThan(5);
    expect(quads.filter((quad) => is(RAIL_STEEL)(quad) && overRoad(quad)).length).toBe(4);
    // Nothing of it within the clearance of the road under it.
    for (const corner of quads.flatMap((quad) => quad.corners)) {
      if (Math.abs(corner.lateral) > half + 2) continue;
      expect(corner.y - roadAt(corner.along)).toBeGreaterThan(
        DECK_CLEARANCE_METRES - DECK_GIRDER_METRES - 0.01,
      );
    }
    // No crossing: the road's surface is not carried over it and no sign stands.
    expect(quads.filter(is(CROSSING_PANEL))).toEqual([]);
    expect(quads.filter(is(CROSSBUCK_WHITE))).toEqual([]);
  });

  it('stands on piers wherever it is high over the ground, and none in the road', () => {
    // A pier is under the deck: the walls' concrete, inside the deck's span.
    const piers = quads.filter(
      (quad) =>
        is(TRACK_WALL)(quad) && Math.max(...quad.corners.map((c) => Math.abs(c.lateral))) < 59,
    );
    // Two crossed faces a pier, several piers each side of the road.
    expect(piers.length % 2).toBe(0);
    expect(piers.length).toBeGreaterThanOrEqual(8);
    const sides = new Set(piers.map((quad) => Math.sign(centre(quad).lateral)));
    expect([...sides].sort()).toEqual([-1, 1]);
    for (const quad of piers) {
      for (const corner of quad.corners) {
        expect(Math.abs(corner.lateral)).toBeGreaterThan(half + 1);
      }
      const ys = quad.corners.map((corner) => corner.y);
      const here = centre(quad);
      // From the ground it stands in…
      const ground = groundAt(here.along, here.lateral);
      expect(Math.min(...ys)).toBeLessThan(ground);
      expect(Math.min(...ys)).toBeGreaterThan(ground - 0.3);
      // …to the girder it carries: under the deck's crown by the girder's depth.
      const crown = quads
        .filter(is(BALLAST))
        .flatMap((each) => each.corners)
        .filter((corner) => Math.abs(corner.lateral - here.lateral) < 0.5)
        .reduce((low, corner) => Math.min(low, corner.y), Infinity);
      expect(Math.max(...ys)).toBeCloseTo(crown - DECK_GIRDER_METRES, 1);
    }
  });

  it('is met by the track joined to it, which climbs to it between walls from the ground', () => {
    const walls = quads.filter(
      (quad) =>
        is(TRACK_WALL)(quad) && Math.max(...quad.corners.map((c) => Math.abs(c.lateral))) >= 59,
    );
    expect(walls.length).toBeGreaterThan(0);
    for (const quad of walls) {
      expect(Math.min(...quad.corners.map((c) => Math.abs(c.lateral)))).toBeGreaterThan(55);
    }
    // Where the deck ends the track beside it is at its height: no step.
    const crownAt = (lateral: number, deck: boolean): number => {
      const found = quads
        .filter(is(BALLAST))
        .filter((quad) => {
          const laterals = quad.corners.map((corner) => Math.abs(corner.lateral));
          return deck ? Math.max(...laterals) <= 60.01 : Math.min(...laterals) >= 59.99;
        })
        .flatMap((quad) => quad.corners)
        .filter((corner) => Math.abs(corner.lateral - lateral) < 0.01)
        .map((corner) => corner.y);
      expect(found.length).toBeGreaterThan(0);
      return found.reduce((sum, y) => sum + y, 0) / found.length;
    };
    for (const lateral of [-60, 60]) {
      expect(Math.abs(crownAt(lateral, true) - crownAt(lateral, false))).toBeLessThan(0.2);
    }
    // And 186 m from the crossing it is back on the ground.
    for (const quad of quads.filter(is(BALLAST))) {
      for (const corner of quad.corners.filter((c) => Math.abs(c.lateral) > 190)) {
        expect(corner.y).toBeCloseTo(
          groundAt(corner.along, corner.lateral) + BALLAST_DEPTH_METRES + SIDE_ROAD_LIFT_METRES,
          3,
        );
      }
    }
  });

  it('is level from one end of its span to the other where it crosses nothing', () => {
    const from = dryStretch(200, BESIDE, 3_400);
    const deck = quadsOf(
      trackOf(
        frameAt(
          from + 100,
          corridorOf([
            rail(
              [
                [from, BESIDE],
                [from + 200, BESIDE],
              ],
              'bridge',
            ),
          ]),
        ),
      ),
    );
    const crown = deck.filter(is(BALLAST)).flatMap((quad) => quad.corners);
    expect(crown.length).toBeGreaterThan(100);
    const endAt = (along: number): number =>
      groundAt(along, BESIDE) + BALLAST_DEPTH_METRES + SIDE_ROAD_LIFT_METRES;
    let offGround = 0;
    for (const corner of crown) {
      const t = (corner.along - from) / 200;
      expect(corner.y).toBeCloseTo(endAt(from) + (endAt(from + 200) - endAt(from)) * t, 2);
      offGround = Math.max(offGround, Math.abs(corner.y - endAt(corner.along)));
    }
    // Non-vacuity: the ground between its ends is not on that line.
    expect(offGround).toBeGreaterThan(0.2);
    expect(deck.filter(is(DECK_GIRDER)).length).toBeGreaterThan(0);
    expect(deck.filter(is(SLEEPER)).length).toBeGreaterThan(100);
  });

  it('crosses water a line at grade stops at', () => {
    let wet: number | undefined;
    for (let along = 600; wet === undefined && along < ROLLING.totalDistance - 600; along += 4) {
      if (inWater(WAYS, ROLLING, along, BESIDE)) wet = along;
    }
    if (wet === undefined) throw new Error('no water on the fixture');
    const across = (grade: StreetGrade) =>
      quadsOf(
        trackOf(
          frameAt(
            wet,
            corridorOf([
              rail(
                [
                  [wet - 80, BESIDE],
                  [wet + 80, BESIDE],
                ],
                grade,
              ),
            ]),
          ),
        ),
      )
        .filter(is(BALLAST))
        .filter((quad) => inWater(WAYS, ROLLING, centre(quad).along, centre(quad).lateral));
    expect(across('ground')).toEqual([]);
    expect(across('bridge').length).toBeGreaterThan(0);
  });

  it('and a line in a tunnel is not drawn', () => {
    const tunnel = corridorOf([
      rail(
        [
          [at, -200],
          [at, 200],
        ],
        'tunnel',
      ),
    ]);
    expect(trackOf(frameAt(at - 30, tunnel))).toEqual([]);
  });
});

describe('what the track costs — #3253', () => {
  /** More railway than a frame may draw: sixteen lines beside 2.6 km of road, and a tagged crossing every 100 m. */
  const rails: RailFeature[] = [];
  const tags: RailCrossingTag[] = [];
  for (let line = 0; line < 8; line += 1) {
    for (const side of [-1, 1]) {
      rails.push(
        rail([
          [200, side * (30 + line * 10)],
          [2_800, side * (30 + line * 10)],
        ]),
      );
    }
  }
  for (let along = 1_000; along <= 2_000; along += 100) {
    rails.push(
      rail([
        [along, -120],
        [along, 120],
      ]),
    );
    const point = ringBeside(ROLLING, ORIGIN, [[along, 0]]);
    tags.push({ x: point[0] as number, z: point[1] as number, lights: true, gates: true });
  }
  const corridor = corridorOf(rails, tags);
  const frame = frameAt(1_500, corridor);
  const track = trackOf(frame);
  const signs = track.filter((road) => quadsOf([road]).some(is(CROSSBUCK_WHITE)));
  const pieces = track.filter((road) => !signs.includes(road));
  const near = pieces.filter((road) => quadsOf([road]).some(is(SLEEPER)));
  const far = pieces.filter((road) => !near.includes(road));

  it('is bounded a frame: the stated pieces, the nearest of them with sleepers, the nearest crossings’ signs', () => {
    expect(REALISTIC_RAIL_TRACK_TRIANGLES).toBe(6_736);
    expect(pieces).toHaveLength(RAIL_TRACK_PIECES_PER_FRAME);
    expect(near).toHaveLength(RAIL_TRACK_NEAR_PIECES);
    expect(signs).toHaveLength(RAIL_CROSSINGS_PER_FRAME);
    for (const road of near) {
      expect(triangles([road])).toBeLessThanOrEqual(RAIL_TRACK_NEAR_PIECE_TRIANGLES);
    }
    for (const road of far) {
      expect(triangles([road])).toBeLessThanOrEqual(RAIL_TRACK_FAR_PIECE_TRIANGLES);
    }
    for (const road of signs) {
      expect(triangles([road])).toBeLessThanOrEqual(RAIL_CROSSING_FURNITURE_TRIANGLES);
    }
    expect(triangles(track)).toBeLessThanOrEqual(REALISTIC_RAIL_TRACK_TRIANGLES);
    // Non-vacuity: the heaviest of each is a whole piece's worth — the bound less the two
    // cuts a level crossing may add — and the frame is near its ceiling.
    expect(Math.max(...near.map((road) => triangles([road])))).toBeGreaterThanOrEqual(314);
    expect(Math.max(...far.map((road) => triangles([road])))).toBeGreaterThanOrEqual(120);
    expect(Math.max(...signs.map((road) => triangles([road])))).toBe(64);
    expect(triangles(track)).toBeGreaterThan(REALISTIC_RAIL_TRACK_TRIANGLES * 0.75);
    console.log(
      `#3253 a frame of more railway than fits: ${String(triangles(track))} triangles in ` +
        `${String(near.length)} near pieces, ${String(far.length)} far and ${String(signs.length)} crossings' signs`,
    );
  });

  it('is drawn nearest first, and never past the fog', () => {
    const rider = quadsOf(pieces).flatMap((quad) => quad.corners);
    for (const corner of rider) {
      expect(Math.hypot(corner.along - 1_480, corner.lateral)).toBeLessThan(
        RAIL_TRACK_VIEW_METRES + RAIL_TRACK_REFRESH_METRES + 40 + 1,
      );
    }
    // With more than fits, what is kept is what is nearest: nothing drawn is far while something near is not.
    expect(
      Math.max(...rider.map((corner) => Math.hypot(corner.along - 1_480, corner.lateral))),
    ).toBeLessThan(200);
  });

  it('reaches the fog and no farther, however long the line', () => {
    const long = quadsOf(
      trackOf(
        frameAt(
          3_000,
          corridorOf([
            rail([
              [1_000, BESIDE],
              [5_000, BESIDE],
            ]),
          ]),
        ),
      ),
    ).flatMap((quad) => quad.corners.map((corner) => Math.abs(corner.along - 3_000)));
    expect(Math.max(...long)).toBeGreaterThan(RAIL_TRACK_VIEW_METRES - 40);
    expect(Math.max(...long)).toBeLessThanOrEqual(
      RAIL_TRACK_VIEW_METRES + RAIL_TRACK_REFRESH_METRES + 40 + 3,
    );
  });

  it('is in the side roads’ ONE mesh, which uploads its triangles: no draw call of its own', () => {
    const belt = new SideRoadBelt(new PavementBelt('stylised').mesh.material as never);
    const added: unknown[] = [];
    belt.addTo({ add: (object: unknown) => added.push(object) } as never);
    belt.update(frame.sideRoads);
    expect(added).toEqual([belt.mesh]);
    expect((belt.mesh.geometry.index?.count ?? 0) / 3).toBe(triangles(frame.sideRoads));
    expect(triangles(track)).toBeGreaterThan(0);
    const uploaded = belt.mesh.geometry.getAttribute('position').array;
    const own = (track[0] as SideRoad).mesh.positions;
    const offset = frame.sideRoads
      .slice(0, frame.sideRoads.indexOf(track[0] as SideRoad))
      .reduce((sum, road) => sum + road.mesh.positions.length, 0);
    expect(Array.from(uploaded.slice(offset, offset + own.length))).toEqual(Array.from(own));
  });

  it('is the same objects until the rider has moved on, so the mesh is not rebuilt between', () => {
    const again = trackOf(frameAt(1_510, corridor));
    expect(again).toHaveLength(track.length);
    for (const [index, road] of again.entries()) expect(road).toBe(track[index]);
    expect(railTrack(corridor, ROLLING, ORIGIN)).toBe(railTrack(corridor, ROLLING, ORIGIN));
    const moved = trackOf(frameAt(1_500 + RAIL_TRACK_REFRESH_METRES * 3, corridor));
    expect(moved.some((road) => !track.includes(road))).toBe(true);
    // And a piece still in view then is the piece it was: built once, kept.
    expect(moved.some((road) => pieces.includes(road))).toBe(true);
  });

  it('stops reading at RAIL_MAX_METRES, so a hostile tile cannot exhaust memory', () => {
    const hostile: RailFeature = {
      kindDetail: 'rail',
      grade: 'ground',
      line: Float32Array.from([9e5, 9e5, 9e5 + RAIL_MAX_METRES * 2, 9e5]),
    };
    const line = rail([
      [1_000, BESIDE],
      [1_400, BESIDE],
    ]);
    expect(railTrack(corridorOf([hostile, line]), ROLLING, ORIGIN).pieces).toEqual([]);
    expect(railTrack(corridorOf([line, hostile]), ROLLING, ORIGIN).pieces.length).toBeGreaterThan(
      0,
    );
  });
});

describe('the scenery keeps off the track — #3253', () => {
  it('stands no tree, wall, hedge or billboard on a line beside the road', () => {
    const from = dryStretch(400, 30, 4_200);
    const corridor = corridorOf([
      rail([
        [from, 14],
        [from + 400, 30],
      ]),
      rail([
        [from, -14],
        [from + 400, -30],
      ]),
    ]);
    const withTrack = frameAt(from + 100, corridor);
    const track = trackOf(withTrack);
    expect(track.length).toBeGreaterThan(0);
    const onIt = (frame: ReturnType<typeof frameAt>) =>
      frame.scatter.filter((item) =>
        onSideRoad(
          track,
          item,
          (STRUCTURE_FOOTPRINTS as Record<string, { x: number; back: number; front: number }>)[
            item.kind
          ] ?? { x: 0, back: 0, front: 0 },
          0,
        ),
      );
    // The control: with no railway, the same frame stands things there.
    expect(onIt(frameAt(from + 100, corridorOf([]))).length).toBeGreaterThan(0);
    expect(onIt(withTrack)).toEqual([]);
  });
});

/** How far `(x, z)` is inside the edge of the nearest of `roads`: positive on one. */
function intoRoads(roads: readonly SideRoad[], x: number, z: number): number {
  let deepest = Number.NEGATIVE_INFINITY;
  for (const road of roads) {
    const s = road.segments;
    for (let segment = 0; segment * 4 + 3 < s.length; segment += 1) {
      const ax = s[segment * 4] as number;
      const az = s[segment * 4 + 1] as number;
      const dx = (s[segment * 4 + 2] as number) - ax;
      const dz = (s[segment * 4 + 3] as number) - az;
      const span = dx * dx + dz * dz;
      const t = span > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / span)) : 0;
      const off = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
      deepest = Math.max(deepest, (road.halfWidths[segment] as number) - off);
    }
  }
  return deepest;
}

describe('the people keep off the track with a street in view — #1619, #3253', () => {
  function setup() {
    const from = dryStretch(400, 90, 4_200);
    const sidewalk = ringBeside(
      ROLLING,
      ORIGIN,
      Array.from({ length: 101 }, (_, step): [number, number] => [from - 100 + step * 4, 6]),
    );
    const street: StreetFeature = {
      kind: 'minor_road',
      kindDetail: 'residential',
      grade: 'ground',
      line: ringBeside(ROLLING, ORIGIN, [
        [from - 150, 90],
        [from + 250, 90],
      ]),
    };
    const crossing = rail([
      [from + 98, -60],
      [from + 102, 60],
    ]);
    const corridor = (streets: readonly StreetFeature[]): WorldCorridor => ({
      ...corridorOf([crossing]),
      paths: [{ kind: 'path', kindDetail: 'sidewalk', line: sidewalk }],
      streets,
    });
    const onTrack = (streets: readonly StreetFeature[]): { seen: number; on: number } => {
      const start = atStartLine(ROLLING);
      let seen = 0;
      let on = 0;
      let track: readonly SideRoad[] = [];
      for (let second = 0; second < 600; second += 4) {
        const frame = sceneFrame({
          profile: ROLLING,
          origin: ORIGIN,
          state: {
            ...start,
            ride: { ...start.ride, distance: metres(from + 100) },
            elapsed: seconds(second),
            ridden: seconds(second),
          },
          people: PEOPLE_NEAR_MAX,
          worldCorridor: corridor(streets),
        });
        track = trackOf(frame);
        for (const person of frame.people?.near ?? []) {
          seen += 1;
          if (intoRoads(track, person.x, person.z) > -PERSON_HALF_WIDTH_METRES) on += 1;
        }
      }
      expect(track.length).toBeGreaterThan(0);
      return { seen, on };
    };
    return { onTrack, street };
  }

  // Two cases over the same frames, as #1688 did: together they passed the
  // 5 s timeout under coverage.
  it('puts nobody on a line crossing a mapped sidewalk at grade', () => {
    const result = setup().onTrack([]);
    expect(result.seen).toBeGreaterThan(0);
    expect(result.on).toBe(0);
  });

  it('and nobody on it with a street in view either, the track being in the people’s side roads', () => {
    const { onTrack, street } = setup();
    const result = onTrack([street]);
    expect(result.seen).toBeGreaterThan(0);
    expect(result.on).toBe(0);
  });
});
