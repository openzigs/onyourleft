// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3106: the ways out of an open-world junction, drawn wherever nothing else
 * draws them (`way-roads.ts`). On a straight road north with ways written
 * here, so each answer is known without the product's session;
 * `open-world/offered-ways.test.tsx` rides the same through the real game
 * screen and the real session.
 */

import { describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  routeProfile,
  type RouteProfile,
} from '@onyourleft/domain';
import { METRES_PER_DEGREE_LATITUDE } from '@onyourleft/map-features';

import { SIDE_ROAD_WIDTHS, type SideRoad } from './cross-streets';
import { NO_LAND_CLASS } from './land-class';
import { terrainHeightAt } from './landform';
import { routeGround, streetRibbon } from './nearby-streets';
import { distanceToDrawnRoad, nearestOnDrawnRoad } from './road-grid';
import { northRoute } from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import { corridorOrigin, drawnRoadFrame, ROAD_WIDTH_METRES } from './terrain';
import {
  WAY_ROAD_MOUTH_METRES,
  WAY_ROAD_REFRESH_METRES,
  WAY_ROAD_STATIONS_PER_FRAME,
  WAY_ROAD_STEP_METRES,
  wayRoads,
  type WayReached,
} from './way-roads';

/** Three kilometres of level road due north. */
const ROAD = northRoute(3_000, () => 30);
const ORIGIN = corridorOrigin(ROAD);
const SEED = scatterSeed(ROAD);
const ON = { profile: ROAD, origin: ORIGIN, seed: SEED, land: NO_LAND_CLASS };

/** The place `lateral` metres off the road at `along`, in local metres. */
function beside(along: number, lateral: number): readonly [number, number] {
  const frame = drawnRoadFrame(ROAD, ORIGIN, along);
  if (frame === undefined) throw new Error('no road there');
  return [frame.x + frame.normalX * lateral, frame.z + frame.normalZ * lateral];
}

/**
 * The view that takes a way: the road from 100 m short of the junction at
 * `junction`, then a street leaving it at `degrees` to its heading for
 * `length` metres. The junction is 100 m along it.
 */
function wayAt(junction: number, degrees: number, length = 400): RouteProfile {
  const radians = (degrees * Math.PI) / 180;
  const local: (readonly [number, number])[] = [];
  for (let back = 100; back > 0; back -= 10) local.push(beside(junction - back, 0));
  for (let out = 0; out <= length + 1e-9; out += 10) {
    local.push(beside(junction + out * Math.cos(radians), out * Math.sin(radians)));
  }
  const perDegreeLongitude =
    METRES_PER_DEGREE_LATITUDE * Math.cos((ORIGIN.latitude * Math.PI) / 180);
  return routeProfile(
    local.map(([x, z]) => ({
      // `terrain.ts` §`localGroundPosition`, inverted: `x` is metres WEST.
      position: geographicPosition(
        degreesLatitude(ORIGIN.latitude + z / METRES_PER_DEGREE_LATITUDE),
        degreesLongitude(ORIGIN.longitude - x / perDegreeLongitude),
      ),
      elevation: altitudeMetres(30),
    })),
    { loop: false },
  );
}

function reached(profile: RouteProfile, toMetres = 500): WayReached {
  return { way: { profile, fromMetres: 100 }, toMetres };
}

/** Whether `(x, z)` lies on one of `roads`: within a segment's half-width of its centreline. */
function on(roads: readonly SideRoad[], x: number, z: number): boolean {
  for (const road of roads) {
    for (let at = 0; at + 3 < road.segments.length; at += 4) {
      const ax = road.segments[at] as number;
      const az = road.segments[at + 1] as number;
      const dx = (road.segments[at + 2] as number) - ax;
      const dz = (road.segments[at + 3] as number) - az;
      const span = dx * dx + dz * dz;
      const t = span > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / span)) : 0;
      if (Math.hypot(x - ax - t * dx, z - az - t * dz) <= (road.halfWidths[at / 4] as number)) {
        return true;
      }
    }
  }
  return false;
}

/** How far along a way at `degrees` from the junction at `junction` a way road covers, as `[from, to]` metres out. */
function coveredOut(roads: readonly SideRoad[], junction: number, degrees: number): number[] {
  const radians = (degrees * Math.PI) / 180;
  const out: number[] = [];
  for (let metresOut = 0; metresOut <= 400; metresOut += 1) {
    const [x, z] = beside(junction + metresOut * Math.cos(radians), metresOut * Math.sin(radians));
    if (on(roads, x, z)) out.push(metresOut);
  }
  return out;
}

/** A side road along a way at `degrees`, from `from` to `to` metres out: what a stub or a street draws. */
function drawnAlong(junction: number, degrees: number, from: number, to: number): SideRoad {
  const radians = (degrees * Math.PI) / 180;
  const line: number[] = [];
  for (let out = from; out <= to + 1e-9; out += 4) {
    line.push(...beside(junction + out * Math.cos(radians), out * Math.sin(radians)));
  }
  const ribbon = streetRibbon(
    Float32Array.from(line),
    SIDE_ROAD_WIDTHS.minor / 2,
    routeGround(ROAD, ORIGIN, SEED),
  );
  return {
    junction: { along: junction, source: 'street', arms: [] },
    mesh: ribbon.mesh,
    segments: ribbon.segments,
    halfWidths: ribbon.halfWidths,
  };
}

describe('a way out that nothing else draws — #3106', () => {
  it('is drawn from the road’s edge to its reach, as a minor street, on the drawn ground', () => {
    for (const degrees of [20, 90, 150]) {
      const roads = wayRoads([reached(wayAt(1_500, degrees))], ON, []);
      expect(roads).toHaveLength(1);
      const covered = coveredOut(roads, 1_500, degrees);
      // From where the way leaves the road's surface to the end of its view.
      const edge = ROAD_WIDTH_METRES / 2 / Math.abs(Math.sin((degrees * Math.PI) / 180));
      expect(covered[0]).toBeLessThanOrEqual(Math.ceil(edge));
      // The last station is the last whole step of the view, within a step of its end.
      expect(covered.at(-1)).toBeGreaterThanOrEqual(400 - WAY_ROAD_STEP_METRES);
      // Whole: every metre between.
      expect(covered).toHaveLength((covered.at(-1) as number) - (covered[0] as number) + 1);
      const [road] = roads as [SideRoad];
      for (const half of road.halfWidths) expect(half).toBe(SIDE_ROAD_WIDTHS.minor / 2);
      // Its mouth starts inside the road's edge, so no verge shows between them.
      const nearest = Math.min(
        ...Array.from({ length: road.segments.length / 4 }, (_, index) =>
          distanceToDrawnRoad(
            ROAD,
            ORIGIN,
            road.segments[index * 4] as number,
            road.segments[index * 4 + 1] as number,
            50,
          ),
        ),
      );
      expect(nearest).toBeLessThanOrEqual(ROAD_WIDTH_METRES / 2 - WAY_ROAD_MOUTH_METRES + 0.05);
      expect(nearest).toBeGreaterThan(ROAD_WIDTH_METRES / 2 - WAY_ROAD_MOUTH_METRES - 0.5);
      // Drawn: triangles, a quad a station, each vertex standing just above
      // the ground the frame draws there (`nearby-streets.ts` §`nearbyStreetLift`).
      expect(road.mesh.indices.length).toBeGreaterThan(6 * 90);
      for (let at = 0; at < road.mesh.positions.length; at += 3) {
        const x = road.mesh.positions[at] as number;
        const z = road.mesh.positions[at + 2] as number;
        const near = nearestOnDrawnRoad(ROAD, ORIGIN, x, z, 1_000);
        if (near === undefined) throw new Error('a vertex nowhere near the road');
        const ground = terrainHeightAt(ROAD, ORIGIN, SEED, near.along, near.lateral, NO_LAND_CLASS);
        const above = (road.mesh.positions[at + 1] as number) - ground;
        expect(above).toBeGreaterThan(0.03);
        expect(above).toBeLessThan(0.4);
      }
    }
  });

  it('draws only what a stub and a street leave undrawn, run a station into each', () => {
    // A stub out to 30 m and the street from 80 m: the 50 m between is the way road's.
    const stub = drawnAlong(1_500, 90, 0, 30);
    const street = drawnAlong(1_500, 90, 80, 400);
    const roads = wayRoads([reached(wayAt(1_500, 90))], ON, [stub, street]);
    expect(roads).toHaveLength(1);
    const covered = coveredOut(roads, 1_500, 90);
    // Past the stub's end and short of the street's start by no more than a
    // station and the ribbon's own half-width across its end.
    const slack = WAY_ROAD_STEP_METRES + SIDE_ROAD_WIDTHS.minor / 2;
    expect(covered[0]).toBeGreaterThanOrEqual(30 - slack);
    expect(covered[0]).toBeLessThanOrEqual(33);
    expect(covered.at(-1)).toBeGreaterThanOrEqual(77);
    expect(covered.at(-1)).toBeLessThanOrEqual(80 + slack);
    // With them, the way is whole from the road to its end.
    const all = coveredOut([stub, street, ...roads], 1_500, 90);
    expect(all).toHaveLength(401);
  });

  it('adds nothing to a way that is drawn already: not a triangle', () => {
    const drawn = [drawnAlong(1_500, 90, 0, 400)];
    const roads = wayRoads([reached(wayAt(1_500, 90))], ON, drawn);
    expect(roads).toHaveLength(0);
    expect(wayRoads([], ON, drawn)).toHaveLength(0);
  });

  it('reaches as far along the way as the view does, in whole refreshes', () => {
    const way = wayAt(1_500, 90);
    // The view reaches 130 m along the way's view: 30 m past its junction.
    const short = wayRoads([reached(way, 130)], ON, []);
    const covered = coveredOut(short, 1_500, 90);
    // To the next whole refresh: 160 m along the view, 60 m out.
    expect(Math.ceil(130 / WAY_ROAD_REFRESH_METRES) * WAY_ROAD_REFRESH_METRES).toBe(160);
    expect(covered.at(-1)).toBeGreaterThanOrEqual(60);
    expect(covered.at(-1)).toBeLessThanOrEqual(60 + SIDE_ROAD_WIDTHS.minor / 2);
  });
});

describe('what the way roads cost — #3106', () => {
  it('hands on the same array until the ways, the reach in whole refreshes or the side roads change', () => {
    const way = wayAt(1_500, 20);
    const drawn = [drawnAlong(1_500, 20, 200, 400)];
    const first = wayRoads([reached(way, 210)], ON, drawn);
    expect(first.length).toBeGreaterThan(0);
    // A frame later, the view a few metres on: another array of the same side roads.
    expect(wayRoads([reached(way, 215)], ON, [...drawn])).toBe(first);
    expect(wayRoads([reached(way, 240)], ON, [...drawn])).toBe(first);
    // A refresh on: worked out again.
    const next = wayRoads([reached(way, 241)], ON, drawn);
    expect(next).not.toBe(first);
    // The side roads changed: worked out again, and the stretch drawn before
    // is the same ribbon where it is the same stretch.
    const more = wayRoads([reached(way, 241)], ON, [...drawn, drawnAlong(1_700, 90, 0, 60)]);
    expect(more).not.toBe(next);
    expect(more[0]).toBe(next[0]);
  });

  it('reads no more than a frame’s stations, the ways whose junctions are nearest first', () => {
    // Forty ways of 400 m, a junction every 20 m: 4 000 stations asked for.
    const ways = Array.from({ length: 40 }, (_, index) =>
      // The nearest junction has the most of its view left.
      reached(wayAt(600 + index * 20, 90), 500 - index * 5),
    );
    const roads = wayRoads(ways, ON, []);
    let segments = 0;
    for (const road of roads) segments += road.segments.length / 4;
    expect(segments).toBeLessThanOrEqual(WAY_ROAD_STATIONS_PER_FRAME);
    expect(segments).toBeGreaterThan(WAY_ROAD_STATIONS_PER_FRAME - 100);
    // The nearest ways are whole, and the farthest have none.
    expect(coveredOut(roads, 600, 90).at(-1)).toBeGreaterThanOrEqual(400 - WAY_ROAD_STEP_METRES);
    expect(coveredOut(roads, 600 + 39 * 20, 90)).toHaveLength(0);
  });
});

describe('the way roads in a frame — #3106', () => {
  const way = wayAt(1_500, 20);
  const input = (extra: object = {}): Parameters<typeof sceneFrame>[0] => {
    const start = atStartLine(ROAD);
    return {
      profile: ROAD,
      origin: ORIGIN,
      state: { ...start, ride: { ...start.ride, distance: metres(1_400) } },
      waysOut: [{ profile: way, fromMetres: 100 }],
      ...extra,
    };
  };

  it('are side roads of the frame, and the scenery is kept off them', () => {
    const frame = sceneFrame(input());
    const streets = frame.sideRoads.filter((road) => road.junction.source === 'street');
    expect(coveredOut(streets, 1_500, 20).length).toBeGreaterThan(250);
    const standing = frame.scatter.filter((item) => on(streets, item.x, item.z));
    expect(standing.map((item) => item.kind)).toStrictEqual([]);
    // Control: without the way, the same frame stands scenery where it runs.
    const without = sceneFrame(input({ waysOut: undefined }));
    expect(without.scatter.filter((item) => on(streets, item.x, item.z)).length).toBeGreaterThan(0);
  });

  it('are off with the nearby streets, whose control they would otherwise draw back in', () => {
    const frame = sceneFrame(input({ nearbyStreetsOff: true }));
    expect(frame.sideRoads.filter((road) => road.junction.source === 'street')).toHaveLength(0);
  });
});
