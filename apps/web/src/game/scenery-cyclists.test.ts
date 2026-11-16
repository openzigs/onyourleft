// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2722's scenery cyclists, read back off what `scene.ts` hands the renderer:
 * where they meet the rider, how many a ride has, which side of the road they
 * are on and that they never pass through the rider — measured from where each
 * is DRAWN against the drawn road, not from the lane they were given — and
 * that a frame of a lap race, a room, a Delivery round, the pacer or a ghost
 * carries none. What the renderer then draws from a frame is
 * `game.browser.spec.ts` §"#2722"; that the trainer is written the same with
 * them on and off is `scenery-cyclists-trainer.test.tsx`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  buildGhostTrack,
  metres,
  metresPerSecond,
  seconds,
  type RouteProfile,
} from '@onyourleft/domain';

import { BICYCLE_LENGTH_METRES } from './bicycle';
import { forbiddenInTheTree, plantedOver, seamViolations } from './cannot-reach-trainer-testing';
import { PEOPLE_NEAR_MAX } from './people';
import { windingRoute } from './route-fixtures-testing';
import {
  drawnRiderDistance,
  placedCyclists,
  placedRiders,
  sceneFrame,
  type SceneInput,
} from './scene';
import {
  CLEAR_METRES,
  CYCLIST_CELL_METRES,
  CYCLIST_DRAW_METRES,
  CYCLISTS_PER_CELL,
  LANES,
  OWN_HALF_METRES,
  ROAD_EDGE_METRES,
  SCENERY_CYCLISTS_MAX,
  clearLateral,
  cyclistAlong,
  encounterOf,
  townAt,
  type Encounter,
  type SceneryCyclist,
} from './scenery-cyclists';
import { scatterSeed } from './scatter';
import { atStartLine, type GameState } from './simulation';
import { corridorOrigin, drawnRoadFrame, roadCorridor } from './terrain';
import { NO_URBAN_CLASS } from './urban-class';

const CYCLISTS_MODULE = 'apps/web/src/game/scenery-cyclists.ts';

const ROUTE = windingRoute(12_000);
const ORIGIN = corridorOrigin(ROUTE);

function stateAt(profile: RouteProfile, distance: number, speed = 8): GameState {
  const start = atStartLine(profile);
  return {
    ...start,
    ride: { speed: metresPerSecond(speed), distance: metres(distance) },
    ridden: seconds(distance / speed),
  };
}

/** A free ride's input at `distance`, on the top rung. */
function freeRide(profile: RouteProfile, distance: number, extra: Partial<SceneInput> = {}) {
  return {
    profile,
    origin: corridorOrigin(profile),
    state: stateAt(profile, distance),
    people: PEOPLE_NEAR_MAX,
    sceneryCyclists: true,
    ...extra,
  } satisfies SceneInput;
}

/** One frame's riders and cyclists, placed without the scenery. */
function placedAt(input: SceneInput): {
  readonly rider: { readonly x: number; readonly z: number; readonly along: number };
  readonly markers: ReturnType<typeof placedRiders>;
  readonly cyclists: readonly SceneryCyclist[];
} {
  const along = drawnRiderDistance(input);
  const corridor = roadCorridor(input.profile, input.origin, along);
  const markers = placedRiders(input, corridor);
  const own = markers[0]?.marker;
  if (own === undefined) throw new Error('no rider');
  return {
    rider: { x: own.x, z: own.z, along },
    markers,
    cyclists: placedCyclists(input, corridor, markers),
  };
}

/** Where `point` is across the drawn road at `along`, metres, positive on the rider's right. */
function acrossTheRoad(
  profile: RouteProfile,
  along: number,
  point: { readonly x: number; readonly z: number },
): number {
  const road = drawnRoadFrame(profile, corridorOrigin(profile), along);
  if (road === undefined) throw new Error('no road');
  return (point.x - road.x) * road.normalX + (point.z - road.z) * road.normalZ;
}

/** Every frame of a ride along `profile`, a metre apart, between `from` and `to`. */
function sweep(
  profile: RouteProfile,
  from: number,
  to: number,
  extra: Partial<SceneInput> = {},
): { along: number; placed: ReturnType<typeof placedAt> }[] {
  const frames: { along: number; placed: ReturnType<typeof placedAt> }[] = [];
  for (let along = from; along <= to; along += 1) {
    frames.push({ along, placed: placedAt(freeRide(profile, along, extra)) });
  }
  return frames;
}

describe('scenery cyclists’ encounters — #2722', () => {
  it('meets the rider at its meeting point: oncoming toward them, slower caught, faster overtaking', () => {
    const encounter = (kind: Encounter['kind'], pace: number): Encounter => ({
      kind,
      meeting: 1_000,
      pace,
      lane: 2.3,
      key: 1,
    });
    // At the meeting point every kind is level with the rider.
    for (const kind of ['oncoming', 'slower', 'faster'] as const) {
      expect(cyclistAlong(encounter(kind, 0.7), 1_000)).toBe(1_000);
    }
    // Before it: the oncoming and the slower are AHEAD, the faster BEHIND; after it, the other way.
    expect(cyclistAlong(encounter('oncoming', 0.9), 900)).toBeGreaterThan(900);
    expect(cyclistAlong(encounter('oncoming', 0.9), 1_100)).toBeLessThan(1_100);
    expect(cyclistAlong(encounter('slower', 0.7), 900)).toBeGreaterThan(900);
    expect(cyclistAlong(encounter('slower', 0.7), 1_100)).toBeLessThan(1_100);
    expect(cyclistAlong(encounter('faster', 1.3), 900)).toBeLessThan(900);
    expect(cyclistAlong(encounter('faster', 1.3), 1_100)).toBeGreaterThan(1_100);
    // And an oncoming one rides the other way along the road.
    expect(cyclistAlong(encounter('oncoming', 0.9), 1_010)).toBeLessThan(
      cyclistAlong(encounter('oncoming', 0.9), 1_000),
    );
  });

  it('has a few a ride, more in a town than in open country, and the same ones every time', () => {
    const long = windingRoute(40_000, 0);
    const seed = scatterSeed(long);
    const cells = Math.round(long.totalDistance / CYCLIST_CELL_METRES);
    const count = (town: boolean): number => {
      let found = 0;
      for (let cell = 0; cell < cells; cell += 1) {
        if (encounterOf(long, seed, () => town, cell) !== undefined) found += 1;
      }
      return found;
    };
    const inTown = count(true);
    const inCountry = count(false);
    // Each near its stated share of the 160 cells, and a town well above the country.
    expect(inTown / cells).toBeGreaterThan(CYCLISTS_PER_CELL.town * 0.7);
    expect(inTown / cells).toBeLessThan(CYCLISTS_PER_CELL.town * 1.3);
    expect(inCountry / cells).toBeGreaterThan(CYCLISTS_PER_CELL.country * 0.5);
    expect(inCountry / cells).toBeLessThan(CYCLISTS_PER_CELL.country * 1.5);
    expect(inTown).toBeGreaterThan(2 * inCountry);
    // A few a ride: a 40 km ride in open country meets about a dozen.
    expect(inCountry).toBeGreaterThan(3);
    expect(inCountry).toBeLessThan(30);
    // Seeded from the ride: the same route, the same encounters.
    const again = (cell: number) => encounterOf(long, scatterSeed(long), () => false, cell);
    for (let cell = 0; cell < cells; cell += 1) {
      expect(again(cell)).toEqual(encounterOf(long, seed, () => false, cell));
    }
  });

  it('reads a procedural village as a town, and open country as none', () => {
    const seed = scatterSeed(ROUTE);
    const town = townAt(ROUTE, seed, NO_URBAN_CLASS);
    let inTown = 0;
    for (let along = 0; along < ROUTE.totalDistance; along += 10) if (town(along)) inTown += 1;
    // Some of the route is a village's and most of it is not.
    expect(inTown).toBeGreaterThan(0);
    expect(inTown).toBeLessThan(ROUTE.totalDistance / 10 / 2);
    // And a mapped town's class is a town wherever it says so.
    const mapped = townAt(ROUTE, seed, { classAt: () => 'town' });
    expect(mapped(5)).toBe(true);
  });
});

describe('a cyclist across the road — #2722', () => {
  it('rides its lane where nobody is level with it', () => {
    expect(clearLateral(2.3, [], BICYCLE_LENGTH_METRES)).toBe(2.3);
    expect(clearLateral(-2.1, [{ gap: 30, lateral: -2.1 }], BICYCLE_LENGTH_METRES)).toBe(-2.1);
  });

  it('moves clear of a rider level with it, easing in as it comes level', () => {
    const level = clearLateral(2.3, [{ gap: 0, lateral: 2 }], BICYCLE_LENGTH_METRES);
    expect(Math.abs(level - 2)).toBeGreaterThanOrEqual(CLEAR_METRES - 1e-9);
    expect(level).toBeGreaterThan(0);
    expect(level).toBeLessThanOrEqual(ROAD_EDGE_METRES);
    // Half level, half the room.
    const half = clearLateral(
      2.3,
      [{ gap: BICYCLE_LENGTH_METRES + 1, lateral: 2 }],
      BICYCLE_LENGTH_METRES,
    );
    expect(Math.abs(half - 2)).toBeCloseTo(CLEAR_METRES / 2, 9);
  });

  it('never crosses into the other half, even with the rider at its own edge', () => {
    for (let rider = -2.9; rider <= 2.9; rider += 0.05) {
      const oncoming = clearLateral(-2.3, [{ gap: 0, lateral: rider }], BICYCLE_LENGTH_METRES);
      const along = clearLateral(2.3, [{ gap: 0, lateral: rider }], BICYCLE_LENGTH_METRES);
      expect(oncoming).toBeLessThanOrEqual(-OWN_HALF_METRES);
      expect(along).toBeGreaterThanOrEqual(OWN_HALF_METRES);
      expect(Math.abs(oncoming - rider)).toBeGreaterThanOrEqual(CLEAR_METRES - 1e-9);
      expect(Math.abs(along - rider)).toBeGreaterThanOrEqual(CLEAR_METRES - 1e-9);
    }
    // Hemmed in by the rider in its lane and another cyclist inside it, it
    // keeps to its own half — the edge, furthest from whoever is nearest —
    // rather than crossing the centre to the only clear place.
    const hemmed = clearLateral(
      2.3,
      [
        { gap: 0, lateral: 2.3 },
        { gap: 0, lateral: 1.1 },
      ],
      BICYCLE_LENGTH_METRES,
    );
    expect(hemmed).toBe(ROAD_EDGE_METRES);
  });
});

describe('scenery cyclists in a ride’s frames — #2722', () => {
  const frames = sweep(ROUTE, 0, ROUTE.totalDistance);
  const seen = frames.flatMap(({ placed }) =>
    placed.cyclists.map((cyclist) => ({ cyclist, rider: placed.rider })),
  );

  it('puts every kind on the road over a ride, never more than the most a frame draws', () => {
    expect(new Set(seen.map(({ cyclist }) => cyclist.kind))).toEqual(
      new Set(['oncoming', 'slower', 'faster']),
    );
    for (const { placed } of frames) {
      expect(placed.cyclists.length).toBeLessThanOrEqual(SCENERY_CYCLISTS_MAX);
      for (const cyclist of placed.cyclists) {
        expect(Math.abs(cyclist.along - placed.rider.along)).toBeLessThanOrEqual(
          CYCLIST_DRAW_METRES,
        );
      }
    }
  });

  it('draws each one on its own side of the road, read off where it is drawn', () => {
    for (const { cyclist } of seen) {
      const across = acrossTheRoad(ROUTE, cyclist.along, cyclist);
      if (cyclist.kind === 'oncoming') expect(across).toBeLessThan(0);
      else expect(across).toBeGreaterThan(0);
      // On the carriageway, a handlebar inside its edge.
      expect(Math.abs(across)).toBeLessThanOrEqual(ROAD_EDGE_METRES + 0.05);
      // And facing the way it rides: an oncoming one against the road.
      const ahead = drawnRoadFrame(ROUTE, ORIGIN, cyclist.along + 1);
      const here = drawnRoadFrame(ROUTE, ORIGIN, cyclist.along);
      if (ahead === undefined || here === undefined) throw new Error('no road');
      const forward = cyclist.headingX * (ahead.x - here.x) + cyclist.headingZ * (ahead.z - here.z);
      if (cyclist.kind === 'oncoming') expect(forward).toBeLessThan(0);
      else expect(forward).toBeGreaterThan(0);
    }
  });

  it('never draws one through the rider, or through another, read off where each is drawn', () => {
    let level = 0;
    let moved = 0;
    for (const { placed } of frames) {
      const everyone = [
        { ...placed.rider, along: placed.rider.along },
        ...placed.cyclists.map((cyclist) => ({ x: cyclist.x, z: cyclist.z, along: cyclist.along })),
      ];
      for (const cyclist of placed.cyclists) {
        for (const other of everyone) {
          if (other.x === cyclist.x && other.z === cyclist.z) continue;
          if (Math.abs(other.along - cyclist.along) >= BICYCLE_LENGTH_METRES) continue;
          // Level, within a bicycle's length: a handlebar and the air between
          // apart ACROSS the road, where they would otherwise be drawn through each other.
          expect(
            Math.abs(
              acrossTheRoad(ROUTE, cyclist.along, cyclist) -
                acrossTheRoad(ROUTE, other.along, other),
            ),
          ).toBeGreaterThan(CLEAR_METRES - 0.1);
          if (other.along === placed.rider.along) {
            level += 1;
            const rider = acrossTheRoad(ROUTE, placed.rider.along, placed.rider);
            const [near, far] = LANES[cyclist.kind];
            const lane = (cyclist.kind === 'oncoming' ? -1 : 1) * ((near + far) / 2);
            if (Math.abs(rider - lane) < CLEAR_METRES) moved += 1;
          }
        }
      }
    }
    // Not vacuous: the ride came level with cyclists, and some of them had to move.
    expect(level).toBeGreaterThan(5);
    expect(moved).toBeGreaterThan(0);
  });

  it('never moves the rider: their marker is the same with the cyclists on and off', () => {
    for (const along of seen.slice(0, 200).map(({ rider }) => rider.along)) {
      const on = placedAt(freeRide(ROUTE, along));
      const off = placedAt(freeRide(ROUTE, along, { sceneryCyclists: false }));
      expect(on.cyclists.length).toBeGreaterThan(0);
      expect(off.cyclists).toEqual([]);
      expect(on.markers).toStrictEqual(off.markers);
    }
  });

  it('hands the renderer what `placedCyclists` places, and nothing on a frame without them', () => {
    const first = seen[0];
    if (first === undefined) throw new Error('no cyclist on the route');
    const frame = sceneFrame(freeRide(ROUTE, first.rider.along));
    expect(frame.cyclists).toEqual(placedAt(freeRide(ROUTE, first.rider.along)).cyclists);
    expect(frame.cyclists?.length).toBeGreaterThan(0);
    expect(frame.markers.length).toBe(1);
    const off = sceneFrame(freeRide(ROUTE, first.rider.along, { sceneryCyclists: false }));
    expect(off).not.toHaveProperty('cyclists');
  });

  it('puts none on the road in a race, a room, a round, beside the pacer or a ghost, or below the people’s rung', () => {
    const where = seen.slice(0, 50).map(({ rider }) => rider.along);
    const modes: readonly (readonly [string, Partial<SceneInput>])[] = [
      ['a lap race', { raceBots: [] }],
      ['a room', { remoteRiders: [] }],
      ['a Delivery round', { steeredLateral: 0 }],
      ['the pacer', { botDistance: 10 }],
      ['a ghost', { ghost: buildGhostTrack({ elapsedSeconds: [0, 10], distanceMetres: [0, 50] }) }],
      ['a rung with no people', { people: 0 }],
      ['a ride that did not ask', { sceneryCyclists: undefined }],
    ];
    for (const [, mode] of modes) {
      for (const along of where) {
        expect(placedAt(freeRide(ROUTE, along, mode)).cyclists).toEqual([]);
      }
    }
    // The control: the same places on a free ride carry them.
    expect(where.every((along) => placedAt(freeRide(ROUTE, along)).cyclists.length > 0)).toBe(true);
  });
});

describe('scenery cyclists are scenery only — #2722', () => {
  it('has no static import chain to a trainer module', () => {
    expect(seamViolations([CYCLISTS_MODULE], forbiddenInTheTree())).toEqual([]);
    // The control: a planted import of the gradient writer is caught.
    const planted = plantedOver({
      [CYCLISTS_MODULE]:
        "import { createGradientSession } from './gradient';\nvoid createGradientSession;\n",
    });
    expect(seamViolations([CYCLISTS_MODULE], forbiddenInTheTree(), planted)).not.toEqual([]);
  });

  it('is read by the frame and the drawing alone: no draft, race, announcer or trainer code imports it', () => {
    const game = fileURLToPath(new URL('.', import.meta.url));
    const src = fileURLToPath(new URL('..', import.meta.url));
    const importers: string[] = [];
    const walk = (directory: string, prefix: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = `${directory}/${entry.name}`;
        if (entry.isDirectory()) walk(path, `${prefix}${entry.name}/`);
        else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          if (/from '[./]*scenery-cyclists'/.test(readFileSync(path, 'utf8'))) {
            importers.push(`${prefix}${entry.name}`);
          }
        }
      }
    };
    walk(src, '');
    expect(game.startsWith(src)).toBe(true);
    expect(importers.sort()).toEqual(['game/port.ts', 'game/scene.ts', 'game/three-renderer.ts']);
  });
});
