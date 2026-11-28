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

import { describe, expect, it, vi } from 'vitest';

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
  ABUTMENT,
  ABUTMENT_SEAT_METRES,
  ABUTMENT_WING_BACK_METRES,
  BALLAST_OVERGROWN,
  EMBANKMENT_GRASS,
  EMBANKMENT_RUN,
  DECK_FLANGE,
  DECK_GIRDER,
  DECK_GIRDER_METRES,
  DECK_KERB_METRES,
  DECK_PIER_BATTER,
  DECK_PIER_CAP_METRES,
  DECK_PIER_METRES,
  DECK_PIERS_FROM_CROSSING_METRES,
  DECK_RAILING,
  DECK_RAILING_METRES,
  DECK_SPAN_HALF_METRES,
  PIER_CAP,
  PIER_FOOT,
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
  PIER_CONCRETE,
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
  kindDetail: RailFeature['kindDetail'] = 'rail',
): RailFeature {
  return { kindDetail, grade, line: ringBeside(ROLLING, ORIGIN, pairs) };
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
  /** Its last corner's colour: the first's, but on a face shaded from one edge to the other. */
  readonly shade: readonly [number, number, number];
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
        shade: [
          mesh.colours[first * 3 + 9] as number,
          mesh.colours[first * 3 + 10] as number,
          mesh.colours[first * 3 + 11] as number,
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

  it('to the line’s own end, so two lines that meet between stations leave no gap', () => {
    // 301.5 m and then 198.5 m: neither a whole number of steps.
    const joined = quadsOf(
      trackOf(
        frameAt(
          from + 300,
          corridorOf([
            rail([
              [from, BESIDE],
              [from + 301.5, BESIDE],
            ]),
            rail([
              [from + 301.5, BESIDE],
              [from + 500, BESIDE],
            ]),
          ]),
        ),
      ),
    ).filter(is(BALLAST));
    const spans = joined
      .map((quad) => quad.corners.map((corner) => corner.along))
      .map((alongs) => [Math.min(...alongs), Math.max(...alongs)] as const)
      .sort((a, b) => a[0] - b[0]);
    for (let index = 1; index < spans.length; index += 1) {
      const gap =
        (spans[index] as readonly [number, number])[0] -
        (spans[index - 1] as readonly [number, number])[1];
      expect(gap).toBeLessThan(0.05);
    }
    expect(Math.abs((spans.at(-1) as readonly [number, number])[1] - (from + 500))).toBeLessThan(3);
    // And the sleepers keep their spacing through the short last step.
    const sleepers = quadsOf(
      trackOf(
        frameAt(
          from + 300,
          corridorOf([
            rail([
              [from, BESIDE],
              [from + 301.5, BESIDE],
            ]),
          ]),
        ),
      ),
    )
      .filter(is(SLEEPER))
      .map((quad) => centre(quad).along)
      .sort((a, b) => a - b);
    for (let index = 1; index < sleepers.length; index += 1) {
      expect((sleepers[index] as number) - (sleepers[index - 1] as number)).toBeCloseTo(
        SLEEPER_SPACING_METRES,
        2,
      );
    }
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
  const roads = trackOf(frameAt(at - 30, over));
  const quads = quadsOf(roads);
  const half = ROAD_WIDTH_METRES / 2;
  /** A face of the deck's side: upright, along the track, so thin along the road here. */
  const upright = (quad: Quad): boolean => span(quad, (c) => c.along) < 0.2;
  const webs = quads.filter(is(DECK_GIRDER));
  /** How tall an upright face is where it stands: the most two of its corners over one spot differ. */
  const tall = (quad: Quad): number =>
    Math.max(
      ...quad.corners.flatMap((a) =>
        quad.corners
          .filter((b) => Math.hypot(a.x - b.x, a.z - b.z) < 0.3)
          .map((b) => Math.abs(a.y - b.y)),
      ),
    );
  /** The girder's foot at `lateral`: along the lower edge of the web that passes it. */
  const girderFootAt = (lateral: number): number => {
    for (const quad of webs) {
      const low = [...quad.corners].sort((a, b) => a.y - b.y).slice(0, 2) as [Corner, Corner];
      const [from, to] = low[0].lateral <= low[1].lateral ? low : [low[1], low[0]];
      if (lateral < from.lateral - 0.01 || lateral > to.lateral + 0.01) continue;
      const t = (lateral - from.lateral) / (to.lateral - from.lateral);
      return from.y + (to.y - from.y) * Math.min(1, Math.max(0, t));
    }
    throw new Error(`no girder at ${String(lateral)}`);
  };

  it('is an open span over the route carrying the same track, clear of the road, and no level crossing', () => {
    // The same track on it: bed, sleepers and rails over the carriageway.
    const overRoad = (quad: Quad): boolean =>
      quad.corners.some((corner) => Math.abs(corner.lateral) < half);
    expect(
      quads.filter((quad) => is(BALLAST)(quad) && !upright(quad) && overRoad(quad)).length,
    ).toBeGreaterThan(0);
    expect(quads.filter((quad) => is(SLEEPER)(quad) && overRoad(quad)).length).toBeGreaterThan(5);
    expect(quads.filter((quad) => is(RAIL_STEEL)(quad) && overRoad(quad)).length).toBeGreaterThan(
      0,
    );
    // Nothing of it within the clearance of the road under it: 5.25 m.
    const clear = DECK_CLEARANCE_METRES - DECK_KERB_METRES - DECK_GIRDER_METRES;
    expect(clear).toBeCloseTo(5.25, 6);
    for (const corner of quads.flatMap((quad) => quad.corners)) {
      if (Math.abs(corner.lateral) > half + 2) continue;
      expect(corner.y - roadAt(corner.along)).toBeGreaterThan(clear - 0.01);
    }
    // And not far over it either: the clearance is the road's, held to the road at the crossing.
    expect(girderFootAt(0) - roadAt(at)).toBeLessThan(clear + 0.5);
    // No crossing: the road's surface is not carried over it and no sign stands.
    expect(quads.filter(is(CROSSING_PANEL))).toEqual([]);
    expect(quads.filter(is(CROSSBUCK_WHITE))).toEqual([]);
  });

  it('is a plate girder with depth: a web each side, a flange under it and stiffeners along it', () => {
    expect(webs.length).toBeGreaterThan(20);
    for (const quad of webs) {
      expect(upright(quad)).toBe(true);
      // The girder's depth, and only beside the road: the open span.
      expect(tall(quad)).toBeCloseTo(DECK_GIRDER_METRES, 3);
      expect(Math.max(...quad.corners.map((c) => Math.abs(c.lateral)))).toBeLessThanOrEqual(
        DECK_SPAN_HALF_METRES + 0.01,
      );
    }
    // Level from abutment to abutment: its foot 30 m each side averages its foot over the road.
    expect((girderFootAt(-30) + girderFootAt(30)) / 2).toBeCloseTo(girderFootAt(0), 1);
    // Both sides of the deck.
    expect(new Set(webs.map((quad) => Math.sign(centre(quad).along - at))).size).toBe(2);
    const dark = quads.filter(is(DECK_FLANGE));
    const flanges = dark.filter((quad) => tall(quad) < 0.3);
    const stiffeners = dark.filter((quad) => tall(quad) >= 0.3);
    // A flange and a stiffener for every step of web.
    expect(flanges).toHaveLength(webs.length);
    expect(stiffeners).toHaveLength(webs.length);
    for (const quad of flanges) {
      // Along the girder's foot.
      const low = [...quad.corners].sort((a, b) => a.y - b.y)[0] as Corner;
      expect(low.y).toBeCloseTo(girderFootAt(low.lateral), 2);
      expect(span(quad, (c) => c.lateral)).toBeGreaterThan(3);
    }
    for (const quad of stiffeners) {
      // Narrow, and from the girder's foot up past the deck: the railing's post too.
      expect(span(quad, (c) => c.lateral)).toBeLessThan(0.2);
      expect(tall(quad)).toBeCloseTo(
        DECK_GIRDER_METRES + DECK_KERB_METRES + DECK_RAILING_METRES,
        1,
      );
    }
  });

  it('shows its ballast’s edge over the girder, and a railing over that', () => {
    const kerbs = quads.filter((quad) => is(BALLAST)(quad) && upright(quad));
    expect(kerbs).toHaveLength(webs.length);
    for (const quad of kerbs) {
      expect(tall(quad)).toBeCloseTo(DECK_KERB_METRES, 3);
      // It sits on the girder: its foot is the web's top.
      const foot = [...quad.corners].sort((a, b) => a.y - b.y)[0] as Corner;
      expect(foot.y - girderFootAt(foot.lateral)).toBeCloseTo(DECK_GIRDER_METRES, 2);
    }
    const rails = quads.filter(is(DECK_RAILING));
    expect(rails).toHaveLength(webs.length);
    for (const quad of rails) {
      expect(upright(quad)).toBe(true);
      const top = [...quad.corners].sort((a, b) => b.y - a.y)[0] as Corner;
      const over = top.y - girderFootAt(top.lateral) - DECK_GIRDER_METRES - DECK_KERB_METRES;
      expect(over).toBeGreaterThan(DECK_RAILING_METRES - 0.1);
      expect(over).toBeLessThan(DECK_RAILING_METRES + 0.1);
    }
  });

  it('stands on two capped, battered piers each side of the road, and none in it', () => {
    const shafts = quads.filter(is(PIER_FOOT));
    const caps = quads.filter(is(PIER_CAP));
    // Two crossed faces a shaft and a cap, four piers.
    expect(shafts).toHaveLength(8);
    expect(caps).toHaveLength(8);
    const places = [...new Set(shafts.map((quad) => Math.round(centre(quad).lateral)))];
    expect(places.sort((a, b) => a - b)).toEqual([
      -DECK_PIERS_FROM_CROSSING_METRES[1],
      -DECK_PIERS_FROM_CROSSING_METRES[0],
      DECK_PIERS_FROM_CROSSING_METRES[0],
      DECK_PIERS_FROM_CROSSING_METRES[1],
    ]);
    /** A face's width at its lower edge and at its upper. */
    const widths = (quad: Quad): { low: number; high: number; foot: number; top: number } => {
      const sorted = [...quad.corners].sort((a, b) => a.y - b.y);
      const wide = (a: Corner, b: Corner) => Math.hypot(a.x - b.x, a.z - b.z);
      return {
        low: wide(sorted[0] as Corner, sorted[1] as Corner),
        high: wide(sorted[2] as Corner, sorted[3] as Corner),
        foot: (sorted[0] as Corner).y,
        top: (sorted[3] as Corner).y,
      };
    };
    for (const quad of shafts) {
      const here = centre(quad);
      const face = widths(quad);
      // Battered: wider at its foot than under its cap.
      expect(face.low / face.high).toBeCloseTo(DECK_PIER_BATTER, 2);
      expect(DECK_PIER_METRES).toContain(Number(face.high.toFixed(2)));
      // And stained there: its foot's colour is not its top's.
      expect(quad.shade).not.toEqual(quad.colour);
      // In the ground it stands on, and clear of the carriageway.
      const ground = groundAt(here.along, here.lateral);
      expect(face.foot).toBeLessThan(ground);
      expect(face.foot).toBeGreaterThan(ground - 0.3);
      for (const corner of quad.corners) {
        expect(Math.abs(corner.lateral)).toBeGreaterThan(half + 2);
      }
      // Under a cap that carries the girder.
      const cap = caps
        .filter((each) => Math.abs(centre(each).lateral - here.lateral) < 1)
        .map(widths);
      expect(cap).toHaveLength(2);
      for (const each of cap) {
        expect(each.foot).toBeCloseTo(face.top, 3);
        expect(each.top - each.foot).toBeCloseTo(DECK_PIER_CAP_METRES[2], 3);
        // The girder's underside exactly: it neither stops short of it nor pokes through.
        expect(each.top).toBeCloseTo(girderFootAt(here.lateral), 3);
      }
      // Wider than the shaft under it, both ways.
      expect(cap.map((each) => Number(each.high.toFixed(2))).sort()).toEqual([
        DECK_PIER_CAP_METRES[1],
        DECK_PIER_CAP_METRES[0],
      ]);
      // Wider than the deck, so both girders bear on it.
      expect(DECK_PIER_CAP_METRES[0]).toBeGreaterThan(BALLAST_CROWN_METRES + 0.2);
      expect(DECK_PIER_CAP_METRES[0]).toBeGreaterThan(DECK_PIER_METRES[0]);
      expect(DECK_PIER_CAP_METRES[1]).toBeGreaterThan(DECK_PIER_METRES[1]);
    }
  });

  it('ends at a short abutment under the girder’s bearing, with a wing wall each side turned back', () => {
    const concrete = quads.filter(is(ABUTMENT));
    // A face and two wings at each end of the span.
    expect(concrete).toHaveLength(6);
    const faceHeight = ABUTMENT_SEAT_METRES - DECK_KERB_METRES;
    for (const quad of concrete) {
      // At the span's end, and stained toward its foot.
      const here = centre(quad);
      expect(Math.abs(Math.abs(here.lateral) - DECK_SPAN_HALF_METRES)).toBeLessThan(
        ABUTMENT_WING_BACK_METRES,
      );
      expect(quad.shade).not.toEqual(quad.colour);
      // Short: from under the ballast to its seat, never a wall down to the ground.
      const ys = quad.corners.map((corner) => corner.y);
      expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(faceHeight, 2);
      // The deck stands the clearance over the road, not over the ground at its ends (#3270), so how
      // far its seat is over the ground here is what the ground gives: over it, never down to it.
      expect(Math.min(...ys) - groundAt(here.along, here.lateral)).toBeGreaterThan(0.5);
      // Its foot is the seat: just under the girder that bears on it.
      const side = Math.sign(here.lateral);
      expect(girderFootAt(side * (DECK_SPAN_HALF_METRES - 0.5)) - Math.min(...ys)).toBeGreaterThan(
        0.5,
      );
      expect(girderFootAt(side * (DECK_SPAN_HALF_METRES - 0.5)) - Math.min(...ys)).toBeLessThan(
        1.2,
      );
    }
    const wings = concrete.filter((quad) => span(quad, (c) => c.lateral) > 1);
    expect(wings).toHaveLength(4);
    for (const quad of wings) {
      // Turned back into the bank, away from the road, and falling with it.
      expect(span(quad, (c) => c.lateral)).toBeCloseTo(ABUTMENT_WING_BACK_METRES + 0.05, 1);
      expect(Math.max(...quad.corners.map((c) => Math.abs(c.lateral)))).toBeCloseTo(
        DECK_SPAN_HALF_METRES + ABUTMENT_WING_BACK_METRES,
        1,
      );
      expect(span(quad, (c) => c.along)).toBeGreaterThan(3);
    }
  });

  it('is carried past its span on a grass embankment whose sides fall at 1 in 2, and no wall', () => {
    expect(EMBANKMENT_RUN).toBe(2);
    // No concrete wall anywhere: #3270's two blank walls are gone.
    expect(quads.filter(is(PIER_CONCRETE))).toEqual([]);
    const banks = quads.filter(is(EMBANKMENT_GRASS));
    const sides = banks.filter(
      (quad) =>
        Math.min(...quad.corners.map((c) => Math.abs(c.lateral))) > DECK_SPAN_HALF_METRES + 3,
    );
    expect(sides.length).toBeGreaterThan(40);
    let tallest = 0;
    for (const quad of sides) {
      // Two corners on the bed's edge and two at the bank's foot.
      const edge = quad.corners.filter(
        (c) => Math.abs(Math.abs(c.along - at) - BALLAST_CROWN_METRES / 2) < 0.01,
      );
      const feet = quad.corners.filter((c) => !edge.includes(c));
      expect(edge).toHaveLength(2);
      expect(feet).toHaveLength(2);
      for (const foot of feet) {
        const top = edge.sort(
          (p, q) => Math.abs(p.lateral - foot.lateral) - Math.abs(q.lateral - foot.lateral),
        )[0] as Corner;
        const fall = top.y - foot.y;
        const run = Math.abs(foot.along - at) - BALLAST_CROWN_METRES / 2;
        tallest = Math.max(tallest, fall);
        // In the ground at its foot…
        const under = groundAt(foot.along, foot.lateral);
        expect(foot.y).toBeLessThan(under);
        expect(foot.y).toBeGreaterThan(under - 0.1);
        // …and 1 in 2, to what the ground's own fall across the bank's width adds.
        if (fall < 1) continue;
        expect(run / fall).toBeGreaterThan(1.6);
        expect(run / fall).toBeLessThan(2.4);
      }
    }
    // The scenery is kept off the whole bank, not the bed alone.
    expect(Math.max(...roads.flatMap((road) => Array.from(road.halfWidths)))).toBeGreaterThan(10);
    // Non-vacuity: the bank beside the abutment is most of the deck's height.
    expect(tallest).toBeGreaterThan(DECK_CLEARANCE_METRES - 1.5);
    // Under the span the bank comes forward from the abutment's seat to the ground, as grass.
    const fronts = banks.filter(
      (quad) =>
        Math.max(...quad.corners.map((c) => Math.abs(c.lateral))) < DECK_SPAN_HALF_METRES + 0.01,
    );
    expect(fronts.length).toBeGreaterThanOrEqual(2);
    for (const quad of fronts.filter((each) => span(each, (c) => c.along) > 10)) {
      const laterals = quad.corners.map((c) => Math.abs(c.lateral));
      const ys = quad.corners.map((c) => c.y);
      const fall = Math.max(...ys) - Math.min(...ys);
      expect((Math.max(...laterals) - Math.min(...laterals)) / fall).toBeGreaterThan(1.6);
      expect((Math.max(...laterals) - Math.min(...laterals)) / fall).toBeLessThan(2.4);
      // It stops short of the carriageway.
      expect(Math.min(...laterals)).toBeGreaterThan(half + 2);
    }
    // Where the mapped bridge ends the track beside it is at its height: no step.
    const crownAt = (lateral: number, deck: boolean): number => {
      const found = quads
        .filter((quad) => is(BALLAST)(quad) && !upright(quad))
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
    // And far from the crossing it is back on the ground.
    for (const quad of quads.filter(is(BALLAST))) {
      for (const corner of quad.corners.filter((c) => Math.abs(c.lateral) > 197)) {
        expect(corner.y).toBeCloseTo(
          groundAt(corner.along, corner.lateral) + BALLAST_DEPTH_METRES + SIDE_ROAD_LIFT_METRES,
          3,
        );
      }
    }
  });

  it('far off is its girder, its railing and its piers’ shafts, inside a piece’s bound either way', () => {
    const far = trackOf(frameAt(at - 300, over));
    const seen = quadsOf(far);
    expect(seen.filter(is(DECK_GIRDER)).length).toBe(webs.length);
    expect(seen.filter(is(DECK_RAILING)).length).toBe(webs.length);
    expect(seen.filter(is(PIER_FOOT))).toHaveLength(8);
    // Each abutment is one face, and the bank's front under it.
    expect(seen.filter(is(ABUTMENT))).toHaveLength(2);
    // With no cap its shaft runs up to the girder: as high as the cap's top is, near.
    const topOf = (each: readonly Quad[], lateral: number): number =>
      each
        .filter((quad) => Math.abs(centre(quad).lateral - lateral) < 1)
        .flatMap((quad) => quad.corners)
        .reduce((high, corner) => Math.max(high, corner.y), -Infinity);
    for (const lateral of [-24, -8, 8, 24]) {
      expect(topOf(seen.filter(is(PIER_FOOT)), lateral)).toBeCloseTo(
        topOf(quads.filter(is(PIER_CAP)), lateral),
        3,
      );
    }
    expect(seen.filter(is(DECK_FLANGE))).toEqual([]);
    expect(seen.filter(is(PIER_CAP))).toEqual([]);
    expect(seen.filter(is(SLEEPER))).toEqual([]);
    const spans = (each: readonly SideRoad[]) =>
      each.filter((road) => quadsOf([road]).some(is(DECK_GIRDER))).map((road) => triangles([road]));
    const nearSpans = spans(roads);
    const farSpans = spans(far);
    expect(nearSpans.length).toBeGreaterThan(0);
    expect(Math.max(...nearSpans)).toBeLessThanOrEqual(RAIL_TRACK_NEAR_PIECE_TRIANGLES);
    expect(Math.max(...farSpans)).toBeLessThanOrEqual(RAIL_TRACK_FAR_PIECE_TRIANGLES);
    // Non-vacuity: a span is the heaviest piece there is, and these are near their bounds.
    expect(Math.max(...nearSpans)).toBeGreaterThan(350);
    expect(Math.max(...farSpans)).toBeGreaterThan(120);
  });

  it('keeps its piers out of the road where it crosses it at a shallow angle', () => {
    // 17° from the road: 8 m along the track from the crossing is 2.3 m off the centreline.
    const skew = quadsOf(
      trackOf(
        frameAt(
          at - 30,
          corridorOf([
            rail(
              [
                [at - 100, -30],
                [at + 100, 30],
              ],
              'bridge',
            ),
          ]),
        ),
      ),
    ).filter(is(PIER_FOOT));
    // The two at 24 m stand; the two at 8 m would be in the carriageway and do not.
    expect(skew).toHaveLength(4);
    for (const quad of skew) {
      expect(Math.abs(centre(quad).lateral)).toBeGreaterThan(half + 2);
    }
  });

  it('stands a deck that crosses no route on a pier every 24 m where it is high over the ground', () => {
    // 400 m across the fixture's lowest ground, whose road dips most at 1 131 m.
    const piers = quadsOf(
      trackOf(
        frameAt(
          1_131,
          corridorOf([
            rail(
              [
                [931, BESIDE],
                [1_331, BESIDE],
              ],
              'bridge',
            ),
          ]),
        ),
      ),
    ).filter(is(PIER_FOOT));
    const alongs = [...new Set(piers.map((quad) => Math.round(centre(quad).along)))].sort(
      (a, b) => a - b,
    );
    expect(alongs.length).toBeGreaterThan(3);
    for (let index = 1; index < alongs.length; index += 1) {
      const gap = (alongs[index] as number) - (alongs[index - 1] as number);
      expect(Math.abs(gap / 24 - Math.round(gap / 24))).toBeLessThan(0.05);
      expect(gap).toBeGreaterThan(20);
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
    const crown = deck
      .filter((quad) => is(BALLAST)(quad) && span(quad, (c) => c.lateral) > 1)
      .flatMap((quad) => quad.corners);
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

/** A bridge `length` long over the road at `site`, square to it, with a line at grade each side. */
function bridgeOver(site: number, length: number): WorldCorridor {
  const end = length / 2;
  return corridorOf([
    rail([
      [site, -200],
      [site, -end],
    ]),
    rail(
      [
        [site, -end],
        [site, end],
      ],
      'bridge',
    ),
    rail([
      [site, end],
      [site, 200],
    ]),
  ]);
}

/**
 * The girder's underside over the carriageway, nine points along each web: how far
 * over the ROAD's height at that spot, the way a rider under it sees.
 */
function clearancesUnder(quads: readonly Quad[]): number[] {
  const half = ROAD_WIDTH_METRES / 2;
  const out: number[] = [];
  for (const quad of quads.filter(is(DECK_GIRDER))) {
    const low = [...quad.corners].sort((a, b) => a.y - b.y).slice(0, 2) as [Corner, Corner];
    const [from, to] = low;
    // Along its lower edge, whichever way it lies: a web that runs nearly along the road is
    // over it for its whole length and is sampled as one square across it is.
    for (let step = 0; step <= 8; step += 1) {
      const t = step / 8;
      const lateral = from.lateral + (to.lateral - from.lateral) * t;
      if (Math.abs(lateral) > half) continue;
      out.push(from.y + (to.y - from.y) * t - roadAt(from.along + (to.along - from.along) * t));
    }
  }
  return out;
}

describe('a rail bridge clears the road it crosses, wherever the ground is — #3253', () => {
  const clear = DECK_CLEARANCE_METRES - DECK_KERB_METRES - DECK_GIRDER_METRES;
  const sites = Array.from({ length: 47 }, (_, index) => 700 + index * 100);

  /** How far a deck square to the road needs lifting over its own level to clear it, at `site`. */
  const neededAt = (site: number, length: number): number =>
    roadAt(site) +
    DECK_CLEARANCE_METRES -
    (groundAt(site, -length / 2) + groundAt(site, length / 2)) / 2 -
    BALLAST_DEPTH_METRES -
    SIDE_ROAD_LIFT_METRES;

  it.each(sites)('holds the clearance over the road at %i m, for each length of bridge', (site) => {
    for (const length of [120, 64, 40]) {
      const found = clearancesUnder(quadsOf(trackOf(frameAt(site - 30, bridgeOver(site, length)))));
      expect(found.length).toBeGreaterThan(3);
      // Never less than the clearance over the road under it…
      expect(Math.min(...found)).toBeGreaterThan(clear - 0.1);
      // …and never sunk to it where the road is in a cutting under the deck's own level.
      if (neededAt(site, length) < -0.5) expect(Math.min(...found)).toBeGreaterThan(clear + 0.2);
      // …and, where the road is not in a cutting under the ground at its ends, no more: the lift
      // is the road's height and the clearance, from the deck's own level.
      if (neededAt(site, length) > 0.3) {
        // The deck slopes with the ground at its ends across the road's width, and the road's own
        // grade adds to it under the girder's two sides.
        const slope = Math.abs(groundAt(site, length / 2) - groundAt(site, -length / 2)) / length;
        const grade = Math.abs(roadAt(site + 2) - roadAt(site - 2)) / 4;
        expect(Math.max(...found)).toBeLessThan(
          clear + 0.2 + (slope + grade) * (ROAD_WIDTH_METRES + BALLAST_CROWN_METRES),
        );
      }
    }
  });

  it('is tested on sites where the lift has to be found, and on sites where the ground is higher', () => {
    // Non-vacuity: the fixture has ground at a span's ends well under the road's clearance
    // (the lift is most of the girder's height there) and ground over it (a road in a cutting).
    expect(sites.filter((site) => neededAt(site, 120) > 0.3).length).toBeGreaterThan(30);
    expect(sites.filter((site) => neededAt(site, 120) < -0.3).length).toBeGreaterThan(0);
    expect(Math.max(...sites.map((site) => neededAt(site, 120)))).toBeGreaterThan(
      DECK_CLEARANCE_METRES - 3,
    );
  });
});

/**
 * How many points of `quads` stand in the road's space: over the carriageway
 * and between the road's surface and the girder's underside, each quad sampled
 * on a grid across its face.
 */
function inTheRoad(quads: readonly Quad[]): number {
  const half = ROAD_WIDTH_METRES / 2;
  const clear = DECK_CLEARANCE_METRES - DECK_KERB_METRES - DECK_GIRDER_METRES;
  let inside = 0;
  for (const quad of quads) {
    const [a, b, c, d] = quad.corners as [Corner, Corner, Corner, Corner];
    for (let i = 0; i <= 6; i += 1) {
      for (let j = 0; j <= 6; j += 1) {
        const u = i / 6;
        const v = j / 6;
        const at = (pick: (corner: Corner) => number): number =>
          (pick(a) * (1 - u) + pick(b) * u) * (1 - v) + (pick(d) * (1 - u) + pick(c) * u) * v;
        const lateral = at((corner) => corner.lateral);
        const over = at((corner) => corner.y) - roadAt(at((corner) => corner.along));
        if (Math.abs(lateral) < half && over > 0.1 && over < clear - 0.1) inside += 1;
      }
    }
  }
  return inside;
}

describe('a rail bridge’s bank and abutments are kept out of the road — #3253', () => {
  const site = dryStretch(80, 200, 2_600) + 40;
  const solids = (quads: readonly Quad[]): Quad[] =>
    quads.filter((quad) =>
      [EMBANKMENT_GRASS, ABUTMENT, PIER_FOOT, PIER_CAP, PIER_CONCRETE].some((c) => is(c)(quad)),
    );
  const frame = (corridor: WorldCorridor) => quadsOf(trackOf(frameAt(site - 30, corridor)));
  const clearUnder = DECK_CLEARANCE_METRES - DECK_KERB_METRES - DECK_GIRDER_METRES;

  it('on a bridge that crosses at a shallow angle', () => {
    const quads = frame(
      corridorOf([
        rail(
          [
            [site - 100, -30],
            [site + 100, 30],
          ],
          'bridge',
        ),
        rail([
          [site + 100, 30],
          [site + 300, 130],
        ]),
        rail([
          [site - 300, -130],
          [site - 100, -30],
        ]),
      ]),
    );
    // Non-vacuity: it has a bank, and it is on this fixture's long approaches.
    expect(quads.filter(is(EMBANKMENT_GRASS)).length).toBeGreaterThan(20);
    expect(inTheRoad(solids(quads))).toBe(0);
    // And its girder is over the road all the way the road runs under it.
    expect(clearancesUnder(quads).length).toBeGreaterThan(8);
    expect(Math.min(...clearancesUnder(quads))).toBeGreaterThan(
      DECK_CLEARANCE_METRES - DECK_KERB_METRES - DECK_GIRDER_METRES - 0.1,
    );
  });

  it('on a bridge that crosses at 7 degrees, which runs over the road beyond the open span', () => {
    const quads = frame(
      corridorOf([
        rail(
          [
            [site - 250, -30],
            [site + 250, 30],
          ],
          'bridge',
        ),
        rail([
          [site + 250, 30],
          [site + 450, 54],
        ]),
        rail([
          [site - 450, -54],
          [site - 250, -30],
        ]),
      ]),
    );
    // Non-vacuity: the girder is over the road farther along the line than the open span reaches.
    const along = quads
      .filter(is(DECK_GIRDER))
      .filter((quad) => Math.abs(centre(quad).lateral) < ROAD_WIDTH_METRES / 2)
      .map((quad) => Math.abs(quad.corners.reduce((sum, c) => sum + c.along, 0) / 4 - site));
    expect(Math.max(...along)).toBeGreaterThan(DECK_SPAN_HALF_METRES);
    expect(inTheRoad(solids(quads))).toBe(0);
    expect(clearancesUnder(quads).length).toBeGreaterThan(8);
    expect(Math.min(...clearancesUnder(quads))).toBeGreaterThan(
      DECK_CLEARANCE_METRES - DECK_KERB_METRES - DECK_GIRDER_METRES - 0.1,
    );
  });

  it.each([
    [5, 200],
    [4, 200],
  ])(
    'on a %i degree bridge %i m long, the hold keeps the girder over the road past the open span',
    (degrees, length) => {
      // Only the hold's share of the lift does this: the lift by distance alone lets a bridge
      // that crosses at under about 6 degrees sag to 0.6 to 1.3 m under its clearance here.
      const slope = Math.tan((degrees * Math.PI) / 180);
      const end = length / 2;
      const quads = frame(
        corridorOf([
          rail(
            [
              [site - end, -end * slope],
              [site + end, end * slope],
            ],
            'bridge',
          ),
          rail([
            [site + end, end * slope],
            [site + end + 200, (end + 200) * slope],
          ]),
          rail([
            [site - end - 200, -(end + 200) * slope],
            [site - end, -end * slope],
          ]),
        ]),
      );
      const found = clearancesUnder(quads);
      expect(found.length).toBeGreaterThan(8);
      expect(Math.min(...found)).toBeGreaterThan(
        DECK_CLEARANCE_METRES - DECK_KERB_METRES - DECK_GIRDER_METRES - 0.1,
      );
    },
  );

  // One case a site, not one case of six sites: a 900 m bridge costs about 0.4 s a site, and six
  // in a case took 2.2 to 3.1 s on the faster runner, which the coverage run's 2x would carry past
  // Vitest's 5 s (docs/agents/ci.md section 4c).
  it.each(
    (
      [
        [7, 500],
        [5, 900],
        [3, 900],
        [2, 900],
        [1, 900],
      ] as const
    ).flatMap(([degrees, length]) =>
      [1_200, 1_900, 2_600, 3_300, 4_000, 4_700].map((at) => [degrees, length, at] as const),
    ),
  )(
    'on a %i degree bridge %i m long, at %i m: clear of the road’s highest point under it',
    (degrees, length, at) => {
      // The lift is found from the road at every station over the carriageway, not at the
      // crossing alone: found there alone, the girder was 1.7 to 4.6 m over the road at 2 to 7
      // degrees on this fixture, and under it at 1 degree.
      const slope = Math.tan((degrees * Math.PI) / 180);
      const end = length / 2;
      const quads = quadsOf(
        trackOf(
          frameAt(
            at - 30,
            corridorOf([
              rail(
                [
                  [at - end, -end * slope],
                  [at + end, end * slope],
                ],
                'bridge',
              ),
            ]),
          ),
        ),
      );
      const found = clearancesUnder(quads);
      expect(found.length).toBeGreaterThan(8);
      expect([at, Math.min(...found) > clearUnder - 0.1]).toEqual([at, true]);
      expect(inTheRoad(solids(quads))).toBe(0);
    },
  );

  it('where the line runs beside the road before it crosses on a skew bridge', () => {
    const quads = frame(
      corridorOf([
        rail([
          [site - 400, 12],
          [site - 80, 12],
        ]),
        rail(
          [
            [site - 80, 12],
            [site + 80, -52],
          ],
          'bridge',
        ),
        rail([
          [site + 80, -52],
          [site + 300, -140],
        ]),
      ]),
    );
    expect(quads.filter(is(EMBANKMENT_GRASS)).length).toBeGreaterThan(20);
    expect(inTheRoad(solids(quads))).toBe(0);
  });

  it.each([
    ['square to the road and ending in it', [-3, 3], 0, 6],
    ['square to the road and ending at its edge', [-4, 4], 0, 6],
    ['at an angle, its ends half a metre off the road’s edge', [-4, 4], 16, 6],
    ['square to the road, its ends a metre off the road’s edge', [-4.5, 4.5], 0, 6],
    // Both faces would stand in the road, so neither is drawn: the span ends at the bank's own wall.
    ['at 20 degrees, its ends clear of the road but its abutments’ faces not', [-5.4, 5.4], 15, 0],
  ] as const)(
    'on a bridge mapped to end by the road, %s: no concrete on it',
    (_, ends, lean, count) => {
      const quads = frame(
        corridorOf([
          rail([
            [site - lean * 10, -200],
            [site - lean, ends[0]],
          ]),
          rail(
            [
              [site - lean, ends[0]],
              [site + lean, ends[1]],
            ],
            'bridge',
          ),
          rail([
            [site + lean, ends[1]],
            [site + lean * 10, 200],
          ]),
        ]),
      );
      // Non-vacuity: the bridge is there, over the road.
      expect(quads.filter(is(DECK_GIRDER)).length).toBeGreaterThan(0);
      expect(clearancesUnder(quads).length).toBeGreaterThan(0);
      expect(inTheRoad(quads.filter(is(ABUTMENT)))).toBe(0);
      // An abutment is drawn at each end, moved to where the bank starts: a face and two wings an
      // end, never two abutments at one end. (Not merely "at most": none at all would pass that.)
      const concrete = quads.filter(is(ABUTMENT));
      expect(concrete).toHaveLength(count);
      if (count > 0) {
        expect(concrete.some((quad) => centre(quad).lateral < 0)).toBe(true);
        expect(concrete.some((quad) => centre(quad).lateral > 0)).toBe(true);
      }
      for (const tone of [EMBANKMENT_GRASS, PIER_FOOT, PIER_CAP, PIER_CONCRETE]) {
        expect([tone, inTheRoad(quads.filter(is(tone)))]).toEqual([tone, 0]);
      }
    },
  );

  it.each([6, 10, 20, 40])(
    'on a bridge mapped as two lines that meet %i m off the road: no abutment where they meet',
    (meet) => {
      const quads = frame(
        corridorOf([
          rail([
            [site, -200],
            [site, -60],
          ]),
          rail(
            [
              [site, -60],
              [site, meet],
            ],
            'bridge',
          ),
          rail(
            [
              [site, meet],
              [site, 60],
            ],
            'bridge',
          ),
          rail([
            [site, 60],
            [site, 200],
          ]),
        ]),
      );
      // One at each end of the open span, as a bridge mapped as one line has, and none between.
      const concrete = quads.filter(is(ABUTMENT));
      expect(concrete).toHaveLength(6);
      for (const quad of concrete) {
        expect(Math.abs(centre(quad).lateral)).toBeGreaterThan(DECK_SPAN_HALF_METRES - 3);
      }
      expect(inTheRoad(solids(quads))).toBe(0);
    },
  );

  it.each([
    ['x', 0.8, 0],
    ['z', 0, 0.8],
  ] as const)(
    'joins two deck lines whose ends are 0.8 m apart across a 2 m cell boundary in %s',
    (_, gapX, gapZ) => {
      // In local metres, about a point on a cell's corner 10 m beside the road at the site.
      const beside = ringBeside(ROLLING, ORIGIN, [[site, 10]]);
      const x = Math.round((beside[0] as number) / 2) * 2;
      const z = Math.round((beside[1] as number) / 2) * 2;
      const first = Float32Array.from([x - 70, z - 0.4, x - 0.4, z - 0.4]);
      const second = Float32Array.from([x - 0.4 + gapX, z - 0.4 + gapZ, x + 50, z - 0.4 + gapZ]);
      // Non-vacuity: the two ends are in different cells along that axis, and the same on the other.
      const cell = (value: number) => Math.floor(value / 2);
      expect(cell(first[2] as number) !== cell(second[0] as number)).toBe(gapX > 0);
      expect(cell(first[3] as number) !== cell(second[1] as number)).toBe(gapZ > 0);
      const pieces = railTrack(
        corridorOf([
          { kindDetail: 'rail', grade: 'bridge', line: first },
          { kindDetail: 'rail', grade: 'bridge', line: second },
        ]),
        ROLLING,
        ORIGIN,
      ).pieces;
      const joins = pieces.map((piece) => piece.deckJoins);
      expect(joins.some((each) => each?.end === true)).toBe(true);
      expect(joins.some((each) => each?.start === true)).toBe(true);
    },
  );

  it('closes the bank’s end in grass where no abutment can stand clear of the road', () => {
    // 30 degrees from the road, 24 m long: its wings would reach the carriageway.
    const lean = 12 * Math.cos(Math.PI / 6);
    const out = 12 * Math.sin(Math.PI / 6);
    const quads = frame(
      corridorOf([
        rail([
          [site - lean * 12, -out * 12],
          [site - lean, -out],
        ]),
        rail(
          [
            [site - lean, -out],
            [site + lean, out],
          ],
          'bridge',
        ),
        rail([
          [site + lean, out],
          [site + lean * 12, out * 12],
        ]),
      ]),
    );
    expect(quads.filter(is(ABUTMENT))).toEqual([]);
    // The closing face: grass square across the track, from one foot of the bank to the other.
    const alongTrack = (c: Corner): number =>
      (c.along - site) * Math.cos(Math.PI / 6) + c.lateral * Math.sin(Math.PI / 6);
    const acrossTrack = (c: Corner): number =>
      (c.along - site) * Math.sin(Math.PI / 6) - c.lateral * Math.cos(Math.PI / 6);
    const ends = quads.filter(
      (quad) =>
        is(EMBANKMENT_GRASS)(quad) &&
        span(quad, alongTrack) < 0.3 &&
        span(quad, acrossTrack) > BALLAST_CROWN_METRES + 4,
    );
    expect(ends.length).toBeGreaterThanOrEqual(2);
    expect(inTheRoad(solids(quads))).toBe(0);
  });

  it.each([12, 24, 48])(
    'on a %i m bridge, shorter than the open span: an abutment each end',
    (length) => {
      const quads = frame(bridgeOver(site, length));
      const concrete = quads.filter(is(ABUTMENT));
      // A face and two wings at each end of the mapped span.
      expect(concrete).toHaveLength(6);
      const faces = concrete.filter((quad) => span(quad, (c) => c.lateral) < 1);
      expect(faces).toHaveLength(2);
      for (const face of faces) {
        expect(Math.abs(centre(face).lateral)).toBeCloseTo(length / 2, 0);
      }
      expect(inTheRoad(solids(quads))).toBe(0);
      // It clears the road, and its girder is the open span.
      expect(clearancesUnder(quads).length).toBeGreaterThan(8);
      expect(Math.min(...clearancesUnder(quads))).toBeGreaterThan(
        DECK_CLEARANCE_METRES - DECK_KERB_METRES - DECK_GIRDER_METRES - 0.1,
      );
      // Its banks are grass, as the long bridge's are.
      expect(quads.filter(is(EMBANKMENT_GRASS)).length).toBeGreaterThan(10);
    },
  );
});

describe('a disused line — #3253', () => {
  const at = dryStretch(80, 200, 1_500) + 40;
  const across = (offset: number, kindDetail: RailFeature['kindDetail']) =>
    rail(
      [
        [at + offset, -201.5],
        [at + offset, 200],
      ],
      'ground',
      kindDetail,
    );
  const framed = (rails: readonly RailFeature[]) =>
    quadsOf(trackOf(frameAt(at - 30, corridorOf(rails))));

  it('keeps its track, rusted and grown over', () => {
    const quads = framed([across(0, 'disused')]);
    expect(quads.filter(is(BALLAST_OVERGROWN)).length).toBeGreaterThan(20);
    expect(quads.filter(is(BALLAST))).toEqual([]);
    // No bright running surface: its rails are rust all over.
    expect(quads.filter(is(RAIL_STEEL))).toEqual([]);
    expect(quads.filter(is(RAIL_WEB)).length).toBeGreaterThan(100);
    expect(quads.filter(is(SLEEPER)).length).toBeGreaterThan(100);
    // The control: a line in use is neither.
    const live = framed([across(0, 'rail')]);
    expect(live.filter(is(BALLAST_OVERGROWN))).toEqual([]);
    expect(live.filter(is(RAIL_STEEL)).length).toBeGreaterThan(0);
  });

  it('stands no sign where it crosses the road, though its rails are still in it', () => {
    const quads = framed([across(0, 'disused')]);
    expect(quads.filter(is(CROSSBUCK_WHITE))).toEqual([]);
    expect(quads.filter(is(CROSSING_PANEL)).length).toBeGreaterThan(0);
    // A line in use beside it, through the same crossing, is still signed.
    const beside = framed([across(0, 'disused'), across(5, 'rail')]);
    expect(beside.filter(is(CROSSBUCK_WHITE)).length).toBeGreaterThanOrEqual(4);
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
    expect(REALISTIC_RAIL_TRACK_TRIANGLES).toBe(6_728);
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
    expect(triangles(track)).toBeGreaterThan(REALISTIC_RAIL_TRACK_TRIANGLES * 0.7);
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

  it('stops a line at a coordinate that is no number, and draws nothing past it', () => {
    const good = ringBeside(ROLLING, ORIGIN, [
      [1_000, BESIDE],
      [1_101.5, BESIDE],
      [1_400, BESIDE],
    ]);
    const bad = Float32Array.from([good[0], good[1], good[2], good[3], NaN, NaN, good[4], good[5]]);
    const pieces = railTrack(
      corridorOf([{ kindDetail: 'rail', grade: 'ground', line: bad }]),
      ROLLING,
      ORIGIN,
    ).pieces;
    expect(pieces.length).toBeGreaterThan(0);
    const zs = pieces.flatMap((piece) => Array.from(piece.line).filter((_, at) => at % 2 === 1));
    for (const value of pieces.flatMap((piece) => Array.from(piece.line))) {
      expect(Number.isFinite(value)).toBe(true);
    }
    // The last whole step before the bad coordinate, and not the line's far end.
    expect(Math.max(...zs) - Math.min(...zs)).toBeLessThanOrEqual(101.5);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(96);
  });

  it.each([0, 0.25, 0.5, 1, 1.9])(
    'finds a deck joined to another 1.5 m off along it, with the join %f m into a 2 m cell',
    (into) => {
      // The gap is along the road, in z on this north-running fixture. Each case moves both
      // decks in z so the first ends `into` m into its cell: the second starts in the same cell
      // for 0 and 0.25, and in the next for the rest.
      const first = rail(
        [
          [1_000, 40],
          [1_100, 40],
        ],
        'bridge',
      );
      const second = rail(
        [
          [1_101.5, 40],
          [1_200, 40],
        ],
        'bridge',
      );
      const endZ = first.line[first.line.length - 1] as number;
      const shift = into - (endZ - Math.floor(endZ / 2) * 2);
      const moved = (feature: RailFeature, more = 0): RailFeature => ({
        ...feature,
        line: feature.line.map((value, at) => (at % 2 === 1 ? value + shift + more : value)),
      });
      const cell = (value: number) => Math.floor(value / 2);
      const a = moved(first);
      const b = moved(second);
      const aEnd = a.line[a.line.length - 1] as number;
      // Non-vacuity: the join is where the title says, and in one cell or across an edge as stated.
      expect(aEnd - cell(aEnd) * 2).toBeCloseTo(into, 3);
      expect(cell(b.line[1] as number) === cell(aEnd)).toBe(into + 1.5 < 2);
      expect(cell(b.line[0] as number)).toBe(cell(a.line[a.line.length - 2] as number));
      const joins = (one: RailFeature, other: RailFeature) =>
        railTrack(corridorOf([one, other]), ROLLING, ORIGIN).pieces.map((piece) => piece.deckJoins);
      const found = joins(a, b);
      expect(found.some((join) => join?.end === true)).toBe(true);
      expect(found.some((join) => join?.start === true)).toBe(true);
      // A gap of 3 m along the line, past JOINED_METRES, is no join.
      expect(
        joins(a, moved(second, 1.5)).some((join) => join?.start === true || join?.end === true),
      ).toBe(false);
    },
  );

  it('asks each deck end about its own neighbourhood, not about every deck mapped', () => {
    // 1 500 short decks 3 m apart: a scan of all of them for each is millions of
    // distances, and the grid is a few a deck.
    const lines = Array.from({ length: 1_500 }, (_, at) =>
      rail(
        [
          [1_000 + at * 3, 40],
          [1_000 + at * 3 + 2, 40],
        ],
        'bridge',
      ),
    );
    const spy = vi.spyOn(Math, 'hypot');
    try {
      railTrack(corridorOf(lines), ROLLING, ORIGIN);
      expect(spy.mock.calls.length).toBeLessThan(lines.length * 100);
    } finally {
      spy.mockRestore();
    }
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
      // 75 frames: with the track dropped from the people's side roads, 5 people land on it.
      for (let second = 0; second < 600; second += 8) {
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
