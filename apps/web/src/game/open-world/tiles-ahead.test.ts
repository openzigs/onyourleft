// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2901: the tiles on every way on from the next junction are asked for
 * before the rider reaches the junction's lock. A synthetic crossroads is laid
 * 40 m short of a z15 tile corner, so its east arm runs into a tile that only
 * that arm reaches: the route's default goes straight on, north, into another.
 * The ride is the road's own `follow`, its `ahead` hook handing the route to
 * the real tile planner, and what the planner asked its worker is read back.
 */

import { JUNCTION_LOCK_METRES, RollingRoute, type RollingEdge } from '@onyourleft/domain';
import { graphOf, streetThrough } from '@onyourleft/domain/rolling-testing';
import {
  columnAtLongitude,
  rowAtLatitude,
  TILES_AT_Z15,
  type TileId,
} from '@onyourleft/map-features';
import { describe, expect, it } from 'vitest';

import { OpenWorldRoad } from './road';
import type { TileBlockFeatures } from './tile-plan';
import {
  createTilePlanner,
  tilePlanWorkerCore,
  type TilePlanRequest,
  type TilePlanWorkerLike,
} from './tile-planner';
import { PLAN_AHEAD_METRES, tilesToPlan } from './tiles-ahead';

// `rolling-testing.ts`' synthetic origin and its metres a degree.
const ORIGIN = { latitude: 40, longitude: -105 };
const PER_DEGREE_LATITUDE = 111_194.9;
const PER_DEGREE_LONGITUDE = PER_DEGREE_LATITUDE * Math.cos((40 * Math.PI) / 180);

const longitudeAtColumn = (column: number): number => (column / TILES_AT_Z15) * 360 - 180;
const latitudeAtRow = (row: number): number =>
  (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / TILES_AT_Z15))) * 180) / Math.PI;

/** The tile corner east and south of the origin, in the synthetic metres. */
const CORNER_COLUMN = Math.ceil(columnAtLongitude(ORIGIN.longitude));
const CORNER_ROW = Math.ceil(rowAtLatitude(ORIGIN.latitude));
const CORNER_EAST = (longitudeAtColumn(CORNER_COLUMN) - ORIGIN.longitude) * PER_DEGREE_LONGITUDE;
const CORNER_NORTH = (latitudeAtRow(CORNER_ROW) - ORIGIN.latitude) * PER_DEGREE_LATITUDE;

/** The junction: 40 m west and 40 m south of the corner. */
const JE = CORNER_EAST - 40;
const JN = CORNER_NORTH - 40;
const APPROACH_METRES = 1_500;

const flat = (): number => 0;

function edge(id: string, from: string, to: string, stops: [number, number][]): RollingEdge {
  return { id, from, to, points: streetThrough(stops, flat), roadClass: 1 };
}

function crossroads(): RollingRoute {
  const start = edge('s', 'start', 'j', [
    [JE, JN - APPROACH_METRES],
    [JE, JN],
  ]);
  const graph = graphOf([
    start,
    edge('n', 'j', 'north', [
      [JE, JN],
      [JE, JN + 800],
    ]),
    edge('e', 'j', 'east', [
      [JE, JN],
      [JE + 800, JN],
    ]),
    edge('w', 'j', 'west', [
      [JE, JN],
      [JE - 800, JN],
    ]),
  ]);
  return new RollingRoute(graph, start);
}

const tile = (x: number, y: number): TileId => ({ z: 15, x, y });
/** The approach's tile, south-west of the corner. */
const APPROACH = tile(CORNER_COLUMN - 1, CORNER_ROW);
/** North of the corner: where the default way, straight on, goes. */
const STRAIGHT_ON = tile(CORNER_COLUMN - 1, CORNER_ROW - 1);
/** East of the corner: only the east arm reaches it. */
const EAST_ARM = tile(CORNER_COLUMN, CORNER_ROW);

const keyOf = (each: TileId): string => `${String(each.x)}/${String(each.y)}`;

describe('the tiles to plan — #2901', () => {
  it('control: the crossroads is where the test says, its default straight on', () => {
    const route = crossroads();
    const junction = route.nextJunctionAfter(0);
    expect(junction?.distance).toBeCloseTo(APPROACH_METRES, 0);
    expect(junction?.defaultWay).toBe('n');
    expect(junction?.ways.map((way) => way.edge.id).sort()).toStrictEqual(['e', 'n', 'w']);
  });

  it('lists the rider’s tile first, and every way on from the next junction before the lock', () => {
    const route = crossroads();
    const rider = APPROACH_METRES - JUNCTION_LOCK_METRES - 1;
    route.advance(rider);
    const tiles = tilesToPlan(route, rider).map(keyOf);
    expect(tiles[0]).toBe(keyOf(APPROACH));
    expect(tiles).toContain(keyOf(STRAIGHT_ON));
    expect(tiles).toContain(keyOf(EAST_ARM));
    expect(new Set(tiles).size).toBe(tiles.length);
  });

  it('control: a junction past the lead adds none of its ways', () => {
    const route = crossroads();
    expect(APPROACH_METRES).toBeGreaterThan(PLAN_AHEAD_METRES);
    const tiles = tilesToPlan(route, 0).map(keyOf);
    // Only the approach's own tiles: none the ways on reach.
    expect(tiles).toContain(keyOf(APPROACH));
    expect(tiles).not.toContain(keyOf(EAST_ARM));
    expect(tiles).not.toContain(keyOf(STRAIGHT_ON));
    expect(tilesToPlan(route, Number.NaN)).toStrictEqual([]);
  });
});

describe('a ride asks for every branch’s tiles before the lock — #2901', () => {
  it('has the planner ask its worker for the east arm’s tile short of the lock', async () => {
    const route = crossroads();
    const core = tilePlanWorkerCore();
    const asked: { tile: string; at: number }[] = [];
    let rider = 0;
    const worker: TilePlanWorkerLike = {
      postMessage: (message: TilePlanRequest) => {
        if (message.kind === 'plan') asked.push({ tile: keyOf(message.tile), at: rider });
        queueMicrotask(() => {
          const answer = core.handle(message);
          if (answer !== undefined) worker.onmessage?.({ data: answer.reply });
        });
      },
      terminate: () => undefined,
      onmessage: null,
      onerror: null,
    };
    const planner = createTilePlanner({ frame: ORIGIN, make: () => worker });
    const features: TileBlockFeatures = {
      buildings: [],
      landUse: [],
      tiles: [APPROACH, STRAIGHT_ON, EAST_ARM].map((each) => ({ tile: each, streets: [] })),
    };
    planner.hold(new Map([['b', features]]));
    const road = new OpenWorldRoad(route, {
      ahead: (each, at) => {
        planner.want(tilesToPlan(each, at));
      },
    });
    const lock = APPROACH_METRES - JUNCTION_LOCK_METRES;
    for (rider = 0; rider < lock; rider += 10) {
      road.follow(rider);
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    }
    const east = asked.find((each) => each.tile === keyOf(EAST_ARM));
    expect(east).toBeDefined();
    expect(east?.at).toBeLessThan(lock);
    // Asked once the junction came within the lead, not before.
    expect(east?.at).toBeGreaterThanOrEqual(APPROACH_METRES - PLAN_AHEAD_METRES);
    expect(planner.plan(EAST_ARM)).toBeDefined();
    planner.stop();
  });
});
