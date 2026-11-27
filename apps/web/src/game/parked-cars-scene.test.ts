// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The parked cars a FRAME carries — #3278, read back off `sceneFrame`, the
 * path the renderer takes them by (`port.ts` §`SceneFrame.parkedCars`), on a
 * route ride, an open-world ride and a lap race.
 *
 * The fixture is a synthetic street, written as arithmetic: 3 km of level
 * road, and from 1 km —
 *
 * - **a row of wide houses on the right**, every 20 m, of which the plans give
 *   more than ten a garage and a driveway out to the road (#1588): most 22 m
 *   out, every fifth 14 m out, where a driveway just holds a car, and every
 *   fifth 11.5 m out, where a car parked the same way would stand on the
 *   carriageway;
 * - **three cross streets**, at 1 100 m, 1 300 m and 1 500 m, each through a
 *   gap in the row with a house hard against either side of it: a junction's
 *   stub either side of the road and the street running on from it;
 * - **a parallel street** 60 m out on the left, with a row of houses along it.
 *
 * No real place. The buildings are planned by `footprintPlans`, as a ride's
 * are, so every driveway here is one the product laid. ⚠️ The road's RIGHT is
 * `−x` here: the route runs north (`route-fixtures-testing.ts` §`northRoute`).
 */

import { describe, expect, it, vi } from 'vitest';

import { metres, type RouteProfile } from '@onyourleft/domain';
import type { BuildingFeature } from '@onyourleft/map-features';

import { RIDER_HALF_WIDTH_METRES } from './bicycle';
import { footprintPlans } from './footprint-buildings';
import {
  besideRoad,
  buildingBeside,
  landBeside,
  rectangleBeside,
  streetBeside,
} from './footprint-fixtures-testing';
import { landClassMask } from './land-class';
import { LANE_OFFSETS_METRES } from './lanes';
import { mappedBuildingsOf, type MappedBuildings } from './mapped-buildings';
import {
  PARKED_CAR_AHEAD_METRES,
  PARKED_CAR_BOX,
  PARKED_CAR_CELL_METRES,
  PARKED_CAR_FAR_METRES,
  PARKED_CAR_GAP_METRES,
  PARKED_CAR_GARAGE_GAP_METRES,
  PARKED_CAR_ROAD_CLEAR_METRES,
  PARKED_CAR_STREET_MARGIN_METRES,
  PARKED_CAR_WALL_METRES,
  PARKED_CARS_MAX,
  parkedCarCorners,
  parkedCarToSegment,
  type ParkedCar,
} from './parked-cars';
import type { SceneFrame } from './port';
import { LINE_LIMIT_METRES } from './racing-line';
import { distanceToDrawnRoad } from './road-grid';
import { northRoute } from './route-fixtures-testing';
import { roadBehindPavements, sceneFrame, type SceneInput } from './scene';
import { anchorScenery } from './scenery-anchor';
import { atStartLine } from './simulation';
import { CITY_PAVEMENT_WIDTH_METRES } from './streets';
import { corridorOrigin, ROAD_WIDTH_METRES, type CorridorOrigin } from './terrain';
import type { WorldCorridor } from './world-data/corridor';

/** How many times the scene has asked the planner where the cars are. */
const asked = vi.hoisted(() => ({ times: 0 }));
vi.mock('./parked-cars', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./parked-cars')>();
  return {
    ...actual,
    parkedCarsAt: (...args: Parameters<typeof actual.parkedCarsAt>) => {
      asked.times += 1;
      return actual.parkedCarsAt(...args);
    },
  };
});

/** How many houses stand along the road, one every 20 m from 1 km. */
const HOUSES = 30;

/** Where a cross street meets the road, metres along it. */
const CROSS_STREETS = [1_100, 1_300, 1_500] as const;

/** How far either side of a cross street's middle the house hard against it stands, metres. */
const BESIDE_CROSS_METRES = 9.75;

/** Where the street ends along the road, metres. */
const STREET_TO = 1_000 + HOUSES * 20;

/** How far out a house's middle is, by its place in the row; its front wall is 4 m nearer the road. */
function houseLateral(index: number): number {
  // 13 m out, a car fits its driveway with its nose on the verge's metre: 3.9 m from the road's middle.
  return index % 5 === 2 ? 14 : index % 5 === 4 ? 11.5 : index % 5 === 1 ? 13 : 22;
}

/** How far out the nearest houses' garage doors are: their car would reach 2.4 m from the road's middle. */
const NEAR_WALL_METRES = 11.5 - 4;

/** Where such a car's middle would be: the garage's gap and half its length in from the door. */
const NEAR_CAR_METRES = NEAR_WALL_METRES - PARKED_CAR_GARAGE_GAP_METRES - PARKED_CAR_BOX.halfLength;

interface Street {
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
  readonly corridor: WorldCorridor;
  readonly land: ReturnType<typeof landClassMask>;
  readonly mapped: MappedBuildings;
}

/** The synthetic street, built from nothing each call: the same numbers, new objects. */
function street(openWorld = false): Street {
  const profile = northRoute(3_000, () => 10);
  // An open-world ride's road is a view, keyed on the ride and not on the route.
  if (openWorld) anchorScenery(profile, { seed: 3_278, origin: 0 });
  const origin = corridorOrigin(profile);
  const buildings: BuildingFeature[] = [];
  for (let index = 0; index < HOUSES; index += 1) {
    const along = 1_000 + index * 20;
    // The gap a cross street runs through, and the houses hard against it.
    if (CROSS_STREETS.some((cross) => Math.abs(along - cross) < 26)) continue;
    buildings.push(
      buildingBeside(profile, origin, [rectangleBeside(along, houseLateral(index), 13, 8)], 6),
    );
  }
  // A house hard against either side of each cross street, its end wall half
  // a metre off the street's edge: a garage at that end has its driveway
  // beside the junction's stub.
  for (const cross of CROSS_STREETS) {
    for (const side of [-1, 1]) {
      buildings.push(
        buildingBeside(
          profile,
          origin,
          [rectangleBeside(cross + side * BESIDE_CROSS_METRES, 22, 13, 8)],
          6,
        ),
      );
    }
  }
  // The row along the parallel street, on its far side.
  for (let along = 1_010; along < STREET_TO; along += 20) {
    if (CROSS_STREETS.some((cross) => Math.abs(along - cross) < 16)) continue;
    buildings.push(buildingBeside(profile, origin, [rectangleBeside(along, -75, 9, 9)], 6));
  }
  const corridor: WorldCorridor = {
    routeId: 'parked-cars-fixture',
    origin,
    covered: () => true,
    coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
    landUse: [
      landBeside(profile, origin, 'landuse', 'residential', 900, STREET_TO + 100, -200, 200),
    ],
    buildings,
    paths: [],
    streets: [
      ...CROSS_STREETS.map((cross) =>
        streetBeside(
          profile,
          origin,
          [
            [cross, -170],
            [cross, -60],
            [cross, 0],
            [cross, 170],
          ],
          'residential',
        ),
      ),
      streetBeside(
        profile,
        origin,
        [[950, -60], ...CROSS_STREETS.map((cross) => [cross, -60] as const), [STREET_TO + 50, -60]],
        'residential',
      ),
    ],
  };
  const land = landClassMask(corridor);
  const mapped = mappedBuildingsOf(footprintPlans(corridor, land, profile, origin).plans);
  return { profile, origin, corridor, land, mapped };
}

const ROUTE = street();
const OPEN_WORLD = street(true);

/** A frame of a ride along `on`, `distance` in, saying whatever `more` says. */
function frameAt(on: Street, distance: number, more: Partial<SceneInput> = {}): SceneFrame {
  const start = atStartLine(on.profile);
  return sceneFrame({
    profile: on.profile,
    origin: on.origin,
    state: { ...start, ride: { ...start.ride, distance: metres(distance) } },
    worldCorridor: on.corridor,
    landClass: on.land,
    mappedBuildings: on.mapped,
    parkedCars: true,
    ...more,
  });
}

/** A lap race's frame: the rider steered into the left lane, and a bot in each lane ahead. */
const RACE: Partial<SceneInput> = {
  steeredLateral: LANE_OFFSETS_METRES[0],
  raceBots: LANE_OFFSETS_METRES.map((lateralMetres, index) => ({
    distanceMetres: 1_020 + index * 6,
    speedMetresPerSecond: 9,
    lateralMetres,
  })),
};

/** Every car any frame of the street carries, each once, riding it a cell at a time. */
function carsAlong(on: Street, more: Partial<SceneInput> = {}): readonly ParkedCar[] {
  const seen = new Map<string, ParkedCar>();
  for (let distance = 940; distance <= STREET_TO + 60; distance += PARKED_CAR_CELL_METRES) {
    for (const car of frameAt(on, distance, more).parkedCars?.cars ?? []) {
      seen.set(`${String(car.x)},${String(car.z)},${String(car.look)}`, car);
    }
  }
  return [...seen.values()];
}

/** The points round a car's box: its corners and each side's quarter points. */
function outline(car: ParkedCar): readonly (readonly [number, number])[] {
  const corners = parkedCarCorners(car);
  const points: (readonly [number, number])[] = [];
  for (let i = 0; i < 4; i += 1) {
    const [ax, az] = corners[i] as readonly [number, number];
    const [bx, bz] = corners[(i + 1) % 4] as readonly [number, number];
    for (let step = 0; step < 4; step += 1) {
      points.push([ax + ((bx - ax) * step) / 4, az + ((bz - az) * step) / 4]);
    }
  }
  return points;
}

/** How near the middle of the ridden road any part of a car's box comes, metres. */
function toRiddenRoad(on: Street, car: ParkedCar): number {
  return Math.min(
    ...outline(car).map(([x, z]) => distanceToDrawnRoad(on.profile, on.origin, x, z, 500)),
  );
}

/**
 * As far from the road's middle as a rider is ever drawn: the outer lanes'
 * middles and the racing line's whole reach, and half a rider's width.
 */
const RIDDEN_HALF_METRES =
  Math.max(LINE_LIMIT_METRES, ...LANE_OFFSETS_METRES.map(Math.abs)) + RIDER_HALF_WIDTH_METRES;

/** Whether every car's box is clear of everywhere a rider is drawn. */
function clearOfTheLanes(on: Street, cars: readonly ParkedCar[]): boolean {
  return cars.every((car) => toRiddenRoad(on, car) > RIDDEN_HALF_METRES);
}

/** The plans with a garage and a driveway: what a car may stand on. */
function garagesOf(on: Street): readonly MappedBuildings['plans'][number][] {
  return on.mapped.plans.filter((plan) => plan.garage && plan.driveway.length === 8);
}

/** Whether a plan is one of the houses nearest the road: its garage door {@link NEAR_WALL_METRES} out. */
function nearTheRoad(plan: MappedBuildings['plans'][number]): boolean {
  return Math.abs(Math.abs(plan.driveway[0] as number) - NEAR_WALL_METRES) < 0.5;
}

const RIDES = [
  { name: 'a route ride', on: ROUTE, more: {} },
  { name: 'an open-world ride', on: OPEN_WORLD, more: {} },
  { name: 'a lap race', on: ROUTE, more: RACE },
] as const;

describe('the parked cars a frame carries — #3278', () => {
  it('lays the street’s driveways as a ride’s are: more than ten houses with a garage and a driveway', () => {
    for (const on of [ROUTE, OPEN_WORLD]) {
      expect(garagesOf(on).length).toBeGreaterThanOrEqual(10);
      // And among them one of the houses nearest the road, or the rule that
      // keeps its car off the carriageway is read off nothing.
      expect(garagesOf(on).some(nearTheRoad)).toBe(true);
    }
  });

  it.each(RIDES)('on $name, stands cars on some driveways and not on all', ({ on, more }) => {
    const onDriveways = carsAlong(on, more).filter((car) => car.spot === 'driveway');
    expect(onDriveways.length).toBeGreaterThan(0);
    expect(onDriveways.length).toBeLessThan(garagesOf(on).length);
    // Each on the right of the road, where the houses with driveways are.
    for (const car of onDriveways) expect(car.x).toBeLessThan(0);
  });

  it.each(RIDES)('on $name, no car’s box comes within the rider’s lanes', ({ on, more }) => {
    const cars = carsAlong(on, more);
    expect(cars.length).toBeGreaterThan(0);
    expect(clearOfTheLanes(on, cars)).toBe(true);
    for (const car of cars) {
      // Not the lanes alone: the whole carriageway, and the verge's metre.
      expect(toRiddenRoad(on, car)).toBeGreaterThanOrEqual(PARKED_CAR_ROAD_CLEAR_METRES - 0.01);
    }
    expect(PARKED_CAR_ROAD_CLEAR_METRES).toBeGreaterThan(ROAD_WIDTH_METRES / 2);
    expect(ROAD_WIDTH_METRES / 2).toBeGreaterThan(RIDDEN_HALF_METRES);
    // THE CONTROL: the same cars with one moved into each lane in turn, and
    // one stood with its tail across the kerb, are not clear.
    const first = cars[0] as ParkedCar;
    for (const lane of LANE_OFFSETS_METRES) {
      expect(clearOfTheLanes(on, [...cars, { ...first, x: lane }])).toBe(false);
    }
    const across = { ...first, x: ROAD_WIDTH_METRES / 2 + 1, heading: Math.PI / 2 };
    expect(clearOfTheLanes(on, [...cars, across])).toBe(false);
  });

  it('never parks the houses nearest the road, whose car would stand on the carriageway', () => {
    // Each near house's garage is 7.5 m out, so a car parked as the others
    // are — 0.6 m off the door — would have its middle 4.65 m from the road's
    // and its nose 2.4 m from it: inside the right-hand lane.
    expect(NEAR_CAR_METRES - PARKED_CAR_BOX.halfLength).toBeLessThan(RIDDEN_HALF_METRES);
    for (const { on, more } of RIDES) {
      const onDriveways = carsAlong(on, more).filter((car) => car.spot === 'driveway');
      expect(onDriveways.length).toBeGreaterThan(0);
      for (const car of onDriveways) expect(Math.abs(car.x)).toBeGreaterThan(NEAR_CAR_METRES + 1);
    }
    // And the houses 14 m out, whose driveway just holds one, do have one.
    const justHolds = [ROUTE, OPEN_WORLD].flatMap((on) =>
      carsAlong(on).filter((car) => car.spot === 'driveway' && Math.abs(car.x) < 10),
    );
    expect(justHolds.length).toBeGreaterThan(0);
  });

  it.each(RIDES)(
    'on $name, no car overlaps a house, another car, or a road the frame draws beside it',
    ({ on, more }) => {
      for (let distance = 940; distance <= STREET_TO + 60; distance += 4 * PARKED_CAR_CELL_METRES) {
        const frame = frameAt(on, distance, more);
        const cars = frame.parkedCars?.cars ?? [];
        for (const car of cars) {
          for (const plan of on.mapped.plans) {
            const ring = plan.footprint;
            const n = ring.length / 2;
            for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
              expect(
                parkedCarToSegment(
                  car,
                  ring[j * 2] as number,
                  ring[j * 2 + 1] as number,
                  ring[i * 2] as number,
                  ring[i * 2 + 1] as number,
                ),
              ).toBeGreaterThanOrEqual(PARKED_CAR_WALL_METRES - 1e-6);
            }
          }
          for (const other of cars) {
            if (other === car) continue;
            const corners = parkedCarCorners(other);
            for (let i = 0, j = 3; i < 4; j = i, i += 1) {
              const [jx, jz] = corners[j] as readonly [number, number];
              const [ix, iz] = corners[i] as readonly [number, number];
              expect(parkedCarToSegment(car, jx, jz, ix, iz)).toBeGreaterThanOrEqual(
                PARKED_CAR_GAP_METRES - 1e-6,
              );
            }
          }
          // Every side road the frame draws: a junction's stub, the cross
          // street, the parallel street — but the one a kerb car stands at
          // the kerb of, which it is parallel to and inside the edge of.
          const nose = [Math.sin(car.heading), Math.cos(car.heading)] as const;
          for (const road of frame.sideRoads) {
            for (let segment = 0; segment * 4 + 3 < road.segments.length; segment += 1) {
              const ax = road.segments[segment * 4] as number;
              const az = road.segments[segment * 4 + 1] as number;
              const bx = road.segments[segment * 4 + 2] as number;
              const bz = road.segments[segment * 4 + 3] as number;
              const half = road.halfWidths[segment] as number;
              const span = Math.hypot(bx - ax, bz - az);
              const along =
                span > 0 ? Math.abs(((bx - ax) * nose[0] + (bz - az) * nose[1]) / span) : 0;
              const off = parkedCarToSegment(car, ax, az, bx, bz);
              if (car.spot === 'kerb' && along > 0.99 && off < half) continue;
              expect(off, `${car.spot} at ${String(distance)}`).toBeGreaterThanOrEqual(
                half + PARKED_CAR_STREET_MARGIN_METRES - 1e-6,
              );
              // On an open-world ride each of these streets may be the next
              // one ridden: a car keeps a ridden road's clearance off its middle.
              if (on === OPEN_WORLD) {
                expect(off, `${car.spot} at ${String(distance)}`).toBeGreaterThanOrEqual(
                  PARKED_CAR_ROAD_CLEAR_METRES - 1e-6,
                );
              }
            }
          }
        }
      }
    },
  );

  it('stands cars at the parallel street’s kerb on a route ride, and none at any kerb on an open-world ride', () => {
    const kerb = carsAlong(ROUTE).filter((car) => car.spot === 'kerb');
    expect(kerb.length).toBeGreaterThan(0);
    const crossZs = CROSS_STREETS.map(
      (cross) => besideRoad(ROUTE.profile, ROUTE.origin, cross, 0)[1],
    );
    let onParallel = 0;
    for (const car of kerb) {
      // On the parallel street, 60 m out on the left (`+x`), inside its 5.5 m and along it…
      const parallel = Math.abs(car.x - 60) < 5.5 / 2 - PARKED_CAR_BOX.halfWidth;
      // …or on the cross street past its stub, inside its 5.5 m and along it.
      const crossing = crossZs.some(
        (crossZ) => Math.abs(car.z - crossZ) < 5.5 / 2 - PARKED_CAR_BOX.halfWidth,
      );
      expect(parallel || crossing).toBe(true);
      expect(Math.abs(parallel ? Math.cos(car.heading) : Math.sin(car.heading))).toBeCloseTo(1, 6);
      if (parallel) onParallel += 1;
    }
    expect(onParallel).toBeGreaterThan(0);
    expect(carsAlong(OPEN_WORLD).filter((car) => car.spot === 'kerb')).toEqual([]);
    // And an open-world ride keeps the rest: its driveways' cars are the route ride's.
    expect(carsAlong(OPEN_WORLD).some((car) => car.spot === 'driveway')).toBe(true);
  });
});

describe('the same route and seed give the same cars — #3278', () => {
  it('on the same street built twice, frame for frame', () => {
    const again = street();
    expect(again.mapped).not.toBe(ROUTE.mapped);
    for (const distance of [960, 1_090, 1_210, 1_400]) {
      const first = frameAt(ROUTE, distance).parkedCars;
      const second = frameAt(again, distance).parkedCars;
      expect(first?.cars.length ?? 0).toBeGreaterThan(0);
      expect(second?.cars).toEqual(first?.cars);
    }
  });

  it('whichever way the frames are asked for, and whatever else the ride is', () => {
    const forward = [960, 1_090, 1_210, 1_400].map((at) => frameAt(ROUTE, at).parkedCars?.cars);
    const backward = [1_400, 1_210, 1_090, 960].map((at) => frameAt(ROUTE, at).parkedCars?.cars);
    expect(backward.reverse()).toEqual(forward);
    // A lap race on the same road has the same street: its camera is in
    // another place across the road, so its list may be in another order.
    const street = (cars: readonly ParkedCar[]): readonly string[] =>
      cars
        .map(
          (car) => `${String(car.x)},${String(car.z)},${String(car.heading)},${String(car.look)}`,
        )
        .sort();
    expect(street(carsAlong(ROUTE, RACE))).toEqual(street(carsAlong(ROUTE)));
  });

  it('hands the view the same list until the camera enters another cell, and then another', () => {
    const first = frameAt(ROUTE, 1_090).parkedCars;
    expect(first?.cars.length ?? 0).toBeGreaterThan(0);
    // A metre on is the same cell or the next: over a cell's length, at most one change.
    const lists = new Set<unknown>();
    for (let step = 0; step < PARKED_CAR_CELL_METRES; step += 1) {
      lists.add(frameAt(ROUTE, 1_090 + step).parkedCars?.cars);
    }
    expect(lists.size).toBeLessThanOrEqual(2);
    // The very same frame again is the very same object: nothing for the belt to rebuild.
    const held = frameAt(ROUTE, 1_300).parkedCars;
    expect(frameAt(ROUTE, 1_300).parkedCars).toBe(held);
    // And the planner is not asked again for it: a held ride's frames cost a comparison.
    const before = asked.times;
    for (let frame = 0; frame < 30; frame += 1) frameAt(ROUTE, 1_300);
    expect(asked.times).toBe(before);
    // A lane change moves the camera and not the road ahead: not asked again either.
    frameAt(ROUTE, 1_300, RACE);
    expect(asked.times).toBe(before);
    // Ridden on a cell and more, it is asked — once a cell, not once a frame.
    for (let step = 1; step <= 4 * PARKED_CAR_CELL_METRES; step += 1) frameAt(ROUTE, 1_300 + step);
    expect(asked.times - before).toBeGreaterThanOrEqual(4);
    expect(asked.times - before).toBeLessThanOrEqual(5);
    // Far enough on, the nearest cars are others.
    expect(frameAt(ROUTE, 1_400).parkedCars?.cars).not.toEqual(first?.cars);
  });
});

describe('which cars a frame carries: those about the road ahead of the rider — #3278', () => {
  it('reaches further ahead of the rider than behind, by the same on every frame', () => {
    // The driveways' cars alone, which are fewer than the cap: every one in reach is carried.
    const more = { nearbyStreetsOff: true };
    // A cell's middle is at most half its diagonal from the place asked about.
    const slack = (PARKED_CAR_CELL_METRES * Math.SQRT2) / 2;
    let furthestAhead = Number.NEGATIVE_INFINITY;
    let furthestBehind = Number.POSITIVE_INFINITY;
    for (let distance = 900; distance <= STREET_TO + 200; distance += 20) {
      const [, riderZ] = besideRoad(ROUTE.profile, ROUTE.origin, distance, 0);
      const cars = frameAt(ROUTE, distance, more).parkedCars?.cars ?? [];
      expect(cars.length).toBeLessThan(PARKED_CARS_MAX);
      for (const car of cars) {
        // The road runs north: a car's place along it is its `z`.
        furthestAhead = Math.max(furthestAhead, car.z - riderZ);
        furthestBehind = Math.min(furthestBehind, car.z - riderZ);
      }
    }
    // Ahead: the far limit and the 40 m the place asked about is ahead of the rider.
    expect(furthestAhead).toBeGreaterThan(PARKED_CAR_FAR_METRES + slack);
    expect(furthestAhead).toBeLessThanOrEqual(
      PARKED_CAR_FAR_METRES + PARKED_CAR_AHEAD_METRES + slack,
    );
    // Behind: that much less.
    expect(furthestBehind).toBeLessThan(
      -(PARKED_CAR_FAR_METRES - PARKED_CAR_AHEAD_METRES - slack - 20),
    );
    expect(furthestBehind).toBeGreaterThanOrEqual(
      -(PARKED_CAR_FAR_METRES - PARKED_CAR_AHEAD_METRES + slack),
    );
  });
});

describe('where a frame carries no parked car — #3278', () => {
  it('unless the ride says it may: a Delivery round, and the page’s lever, say nothing', () => {
    expect(frameAt(ROUTE, 1_090, { parkedCars: undefined }).parkedCars).toBeUndefined();
    expect(frameAt(ROUTE, 1_090, { parkedCars: false }).parkedCars).toBeUndefined();
    // THE CONTROL: the same frame, saying so.
    expect(frameAt(ROUTE, 1_090).parkedCars?.cars.length ?? 0).toBeGreaterThan(0);
  });

  it('on a ride with no corridor, and far from every house and street', () => {
    const start = atStartLine(ROUTE.profile);
    const bare = sceneFrame({
      profile: ROUTE.profile,
      origin: ROUTE.origin,
      state: { ...start, ride: { ...start.ride, distance: metres(1_090) } },
      parkedCars: true,
    });
    expect(bare.parkedCars).toBeUndefined();
    expect(frameAt(ROUTE, 2_800).parkedCars?.cars).toEqual([]);
  });

  it('with the nearby streets off, keeps the driveways’ cars and loses the kerbs’', () => {
    const cars = carsAlong(ROUTE, { nearbyStreetsOff: true });
    expect(cars.some((car) => car.spot === 'driveway')).toBe(true);
    expect(cars.filter((car) => car.spot === 'kerb')).toEqual([]);
  });
});

describe('a house hard against a cross street, its driveway beside the junction’s stub — #3278', () => {
  /**
   * The plans whose driveway's middle line is within 5.4 m of a cross
   * street's: a car on it has its side inside a ridden road's clearance of
   * the stub's middle, and outside the stub's edge.
   */
  function besideAStub(on: Street): readonly MappedBuildings['plans'][number][] {
    const crossZs = CROSS_STREETS.map((cross) => besideRoad(on.profile, on.origin, cross, 0)[1]);
    return garagesOf(on).filter((plan) => {
      const z = ((plan.driveway[1] as number) + (plan.driveway[3] as number)) / 2;
      return crossZs.some((crossZ) => Math.abs(z - crossZ) < 5.4);
    });
  }
  /** Whether a car stands on `plan`'s driveway. */
  function parkedOn(cars: readonly ParkedCar[], plan: MappedBuildings['plans'][number]): boolean {
    const z = ((plan.driveway[1] as number) + (plan.driveway[3] as number)) / 2;
    return cars.some((car) => car.spot === 'driveway' && Math.abs(car.z - z) < 0.5);
  }

  it('may have a car on a route ride, and has none on an open-world ride, where the stub may be ridden', () => {
    // Not vacuous: the fixture has such driveways, on both rides.
    expect(besideAStub(ROUTE).length).toBeGreaterThan(0);
    expect(besideAStub(OPEN_WORLD).length).toBeGreaterThan(0);
    const openWorld = carsAlong(OPEN_WORLD);
    for (const plan of besideAStub(OPEN_WORLD)) expect(parkedOn(openWorld, plan)).toBe(false);
    // THE CONTROL: the same houses on the route ride, whose stub is scenery,
    // do have a car — its side at least the stub's edge and a hand off it.
    const route = carsAlong(ROUTE);
    expect(besideAStub(ROUTE).some((plan) => parkedOn(route, plan))).toBe(true);
  });
});

describe('the road as a parked car is kept off it — #3278', () => {
  const { profile, origin } = ROUTE;
  const [x, z] = besideRoad(profile, origin, 1_200, 9);
  const [leftX, leftZ] = besideRoad(profile, origin, 1_200, -9);
  const city = { classAt: () => 'city-centre' as const };
  const town = { classAt: () => 'town' as const };
  const sides = (side: 'left' | 'right' | 'both' | 'none' | 'unknown') => () => ({
    sideAt: () => side,
  });

  it('is the drawn road’s own distance with no urban class, and never reads the pavements’ sides', () => {
    const road = roadBehindPavements(profile, origin, undefined, () => {
      throw new Error('the sides were read with no urban class');
    });
    expect(road(x, z, 50)).toBeCloseTo(9, 6);
    expect(road(x, z, 50)).toBe(distanceToDrawnRoad(profile, origin, x, z, 50));
  });

  it('is a city centre’s pavement nearer on a side that has one, so a car stands behind it', () => {
    const behind = CITY_PAVEMENT_WIDTH_METRES + 0.2 - 1;
    const both = roadBehindPavements(profile, origin, city, sides('unknown'));
    expect(both(x, z, 50)).toBeCloseTo(9 - behind, 6);
    expect(both(leftX, leftZ, 50)).toBeCloseTo(9 - behind, 6);
    // The carriageway and its pavement, and a hand: where a car's box may begin.
    expect(PARKED_CAR_ROAD_CLEAR_METRES + behind).toBeCloseTo(
      ROAD_WIDTH_METRES / 2 + CITY_PAVEMENT_WIDTH_METRES + 0.2,
      9,
    );
    // A sidewalk mapped on the right only: the left has no pavement to stand behind.
    const right = roadBehindPavements(profile, origin, city, sides('right'));
    expect(right(x, z, 50)).toBeCloseTo(9 - behind, 6);
    expect(right(leftX, leftZ, 50)).toBeCloseTo(9, 6);
    // Outside a city centre there is none.
    const out = roadBehindPavements(profile, origin, town, sides('both'));
    expect(out(x, z, 50)).toBeCloseTo(9, 6);
  });
});
