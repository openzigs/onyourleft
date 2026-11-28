// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Moving cars — #3283 (`moving-cars.ts`), on synthetic roads written as
 * arithmetic, never a real place: how many a kilometre each setting holds,
 * that the same ride gives the same traffic, and that a crossing car has
 * left its junction before the rider reaches it at any speed up to
 * §`CROSSING_RIDER_SPEED_MAX`. The frame's own cars, against the rider and the
 * cyclists, are `moving-cars-scene.test.ts`'.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { RouteProfile } from '@onyourleft/domain';
import type { PathFeature, StreetFeature } from '@onyourleft/map-features';

import { BICYCLE_LENGTH_METRES } from './bicycle';
import { forbiddenInTheTree, plantedOver, seamViolations } from './cannot-reach-trainer-testing';
import { mappedJunctions, type Junction } from './cross-streets';
import { ringBeside } from './footprint-fixtures-testing';
import {
  CROSSING_RIDER_SPEED_MAX,
  JUNCTION_CLEAR_METRES,
  MOVING_CAR_CELL_METRES,
  MOVING_CAR_CLEAR_METRES,
  MOVING_CAR_DRAW_METRES,
  ONCOMING_CARS_PER_KM,
  crossingCarKept,
  crossingCarOf,
  crossingCarsInReach,
  movingCarOutline,
  movingCarsClearOf,
  oncomingCarAlong,
  oncomingCarKept,
  oncomingCarOf,
  oncomingCarsInReach,
  trafficSettingAt,
  type CrossingCar,
  type OncomingCar,
  type TrafficSetting,
  type TrafficSettingAt,
} from './moving-cars';
import type { MovingCar } from './moving-car-frame';
import { PARKED_CAR_BOX } from './parked-cars';
import { distanceToDrawnRoad } from './road-grid';
import { northRoute } from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import { sceneryGrid } from './scenery-anchor';
import {
  CYCLIST_CELL_METRES,
  CYCLIST_DRAW_METRES,
  cyclistAlong,
  encounterOf,
  type Encounter,
} from './scenery-cyclists';
import { corridorOrigin, ROAD_WIDTH_METRES, type CorridorOrigin } from './terrain';

const MOVING_CARS_MODULE = 'apps/web/src/game/moving-cars.ts';

/** Nobody in a town: the cyclists' country rate. */
const NO_TOWN = (): boolean => false;

/** The rider on their straight's home, 1.75 m right of the centre. */
const HOME = (): number => 1.75;

/** A mapped way along the whole of a straight route, on its centreline. */
function along(
  profile: RouteProfile,
  origin: CorridorOrigin,
  from: number,
  to: number,
): Float32Array {
  const pairs: [number, number][] = [];
  // Short of the route's very end, where the drawn road has no direction.
  const end = Math.min(to, profile.totalDistance - 5);
  for (let at = from; at < end; at += 50) pairs.push([at, 0]);
  pairs.push([end, 0]);
  return ringBeside(profile, origin, pairs);
}

function street(kind: string, detail: string, line: Float32Array): StreetFeature {
  return { kind, kindDetail: detail, grade: 'ground', line };
}

/** How many oncoming cars a whole route keeps, a kilometre, at the setting it is read as. */
function carsPerKm(profile: RouteProfile, setting: TrafficSettingAt): number {
  const grid = sceneryGrid(profile, MOVING_CAR_CELL_METRES);
  const seed = scatterSeed(profile);
  let kept = 0;
  for (let cell = grid.first; cell <= grid.last; cell += 1) {
    if (oncomingCarKept(profile, seed, setting, NO_TOWN, HOME, cell) !== undefined) kept += 1;
  }
  return kept / (profile.totalDistance / 1_000);
}

/** A route of `length`, the ridden road mapped along it as `ways` say. */
function mappedRoad(
  length: number,
  ways: (
    profile: RouteProfile,
    origin: CorridorOrigin,
  ) => {
    streets: StreetFeature[];
    paths: PathFeature[];
  },
): { profile: RouteProfile; setting: TrafficSettingAt } {
  const profile = northRoute(length, () => 10);
  const origin = corridorOrigin(profile);
  return { profile, setting: trafficSettingAt(profile, origin, ways(profile, origin), NO_TOWN) };
}

describe('how many cars each setting holds — #3283', () => {
  const LENGTH = 30_000;
  const lane = mappedRoad(LENGTH, (profile, origin) => ({
    streets: [street('minor_road', 'unclassified', along(profile, origin, 0, LENGTH))],
    paths: [],
  }));
  const main = mappedRoad(LENGTH, (profile, origin) => ({
    streets: [street('major_road', 'primary', along(profile, origin, 0, LENGTH))],
    paths: [],
  }));
  const cycleway = mappedRoad(LENGTH, (profile, origin) => ({
    // A road 6 m off it too: the nearer way is the one ridden.
    streets: [
      street(
        'major_road',
        'primary',
        ringBeside(profile, origin, [
          [0, 6],
          [profile.totalDistance - 5, 6],
        ]),
      ),
    ],
    paths: [{ kind: 'path', kindDetail: 'cycleway', line: along(profile, origin, 0, LENGTH) }],
  }));

  it('reads the ridden road’s setting off the mapped way it runs along', () => {
    expect(lane.setting(12_345)).toBe<TrafficSetting>('lane');
    expect(main.setting(12_345)).toBe<TrafficSetting>('major');
    expect(cycleway.setting(12_345)).toBe<TrafficSetting>('path');
    // And a town's road where the map has none, by the town it is in.
    const profile = northRoute(2_000, () => 10);
    const origin = corridorOrigin(profile);
    const inTown = trafficSettingAt(profile, origin, { streets: [], paths: [] }, () => true);
    expect(inTown(500)).toBe<TrafficSetting>('town');
  });

  it('holds at most the stated few a kilometre on a rural lane, more on a main road, and none on a cycleway', () => {
    const rural = carsPerKm(lane.profile, lane.setting);
    const major = carsPerKm(main.profile, main.setting);
    const cycled = carsPerKm(cycleway.profile, cycleway.setting);
    console.log(
      `#3283: oncoming cars a km — lane ${rural.toFixed(2)}, main road ${major.toFixed(2)}, cycleway ${cycled.toFixed(2)}`,
    );
    // The stated rate, with three standard deviations of a 30 km draw over it.
    const cells = LENGTH / MOVING_CAR_CELL_METRES;
    const chance = (ONCOMING_CARS_PER_KM.lane * MOVING_CAR_CELL_METRES) / 1_000;
    const most = (cells * chance + 3 * Math.sqrt(cells * chance)) / (LENGTH / 1_000);
    expect(rural).toBeLessThanOrEqual(most);
    expect(most).toBeLessThan(1);
    // Non-vacuity: a lane is not empty, and a main road holds several times as many.
    expect(rural).toBeGreaterThan(0);
    expect(major).toBeGreaterThan(3 * rural);
    expect(major).toBeLessThanOrEqual(ONCOMING_CARS_PER_KM.major);
    expect(cycled).toBe(0);
    expect(ONCOMING_CARS_PER_KM.path).toBe(0);
  });
});

describe('one rule for the oncoming half — #3283', () => {
  it('keeps every oncoming car clear of every oncoming cyclist and every other car while both are drawn', () => {
    const profile = northRoute(30_000, () => 10);
    const seed = scatterSeed(profile);
    const setting: TrafficSettingAt = () => 'major';
    // Every road a town's: the cyclists at their busiest.
    const town = (): boolean => true;
    const cars = sceneryGrid(profile, MOVING_CAR_CELL_METRES);
    const kept: OncomingCar[] = [];
    const raw: OncomingCar[] = [];
    for (let cell = cars.first; cell <= cars.last; cell += 1) {
      const car = oncomingCarOf(profile, seed, setting, cell);
      if (car !== undefined) raw.push(car);
      const keptCar = oncomingCarKept(profile, seed, setting, town, HOME, cell);
      if (keptCar !== undefined) kept.push(keptCar);
    }
    const cyclistGrid = sceneryGrid(profile, CYCLIST_CELL_METRES);
    const cyclists: Encounter[] = [];
    for (let cell = cyclistGrid.first; cell <= cyclistGrid.last; cell += 1) {
      const each = encounterOf(profile, seed, town, cell);
      if (each?.kind === 'oncoming') cyclists.push(each);
    }
    /** Where the gap along the road between a car and another road user falls short, while both are drawn. */
    const shortfalls = (
      car: OncomingCar,
      other: { along: (rider: number) => number; reach: number; half: number },
    ): number => {
      let short = 0;
      const window = MOVING_CAR_DRAW_METRES / (1 + car.pace);
      for (let rider = car.meeting - window; rider <= car.meeting + window; rider += 0.25) {
        const theirs = other.along(rider);
        if (Math.abs(theirs - rider) > other.reach) continue;
        const gap =
          Math.abs(oncomingCarAlong(car, rider) - theirs) - PARKED_CAR_BOX.halfLength - other.half;
        if (gap < MOVING_CAR_CLEAR_METRES - 1e-9) short += 1;
      }
      return short;
    };
    const asCyclist = (each: Encounter) => ({
      along: (rider: number) => cyclistAlong(each, rider),
      reach: CYCLIST_DRAW_METRES,
      half: BICYCLE_LENGTH_METRES / 2,
    });
    const asCar = (each: OncomingCar) => ({
      along: (rider: number) => oncomingCarAlong(each, rider),
      reach: MOVING_CAR_DRAW_METRES,
      half: PARKED_CAR_BOX.halfLength,
    });
    const near = (a: { meeting: number }, b: { meeting: number }): boolean =>
      Math.abs(a.meeting - b.meeting) < 2 * (MOVING_CAR_DRAW_METRES + CYCLIST_DRAW_METRES);
    let broken = 0;
    for (const car of kept) {
      for (const cyclist of cyclists)
        if (near(car, cyclist)) broken += shortfalls(car, asCyclist(cyclist));
      for (const other of kept)
        if (other !== car && near(car, other)) broken += shortfalls(car, asCar(other));
    }
    expect(broken).toBe(0);
    // Non-vacuity: there are cyclists coming the other way, and the cars the
    // rule dropped include some that would have run into one.
    expect(cyclists.length).toBeGreaterThan(10);
    expect(kept.length).toBeGreaterThan(50);
    let wouldHave = 0;
    for (const car of raw) {
      for (const cyclist of cyclists)
        if (near(car, cyclist)) wouldHave += shortfalls(car, asCyclist(cyclist));
    }
    expect(wouldHave).toBeGreaterThan(0);
  });
});

describe('two oncoming cars — #3283', () => {
  it('never come within the gap of each other while both are drawn, where two raw draws would', () => {
    // Two cars of nearby cells meet in reach of the rider about once in
    // 200 km of main road: the cars' paces differ by at most 0.5 of the
    // rider's, so one catches another only a long way off.
    const profile = northRoute(200_000, () => 10);
    const seed = scatterSeed(profile);
    const setting: TrafficSettingAt = () => 'major';
    const grid = sceneryGrid(profile, MOVING_CAR_CELL_METRES);
    const meets = (a: OncomingCar, b: OncomingCar): boolean => {
      const window = MOVING_CAR_DRAW_METRES / (1 + a.pace);
      for (let rider = a.meeting - window; rider <= a.meeting + window; rider += 0.25) {
        const ours = oncomingCarAlong(a, rider);
        const theirs = oncomingCarAlong(b, rider);
        if (Math.abs(theirs - rider) > MOVING_CAR_DRAW_METRES) continue;
        if (Math.abs(ours - theirs) - 2 * PARKED_CAR_BOX.halfLength < MOVING_CAR_CLEAR_METRES) {
          return true;
        }
      }
      return false;
    };
    const pairs = (cars: readonly OncomingCar[]): number => {
      let count = 0;
      cars.forEach((car, at) => {
        for (const other of cars.slice(at + 1, at + 6)) if (meets(car, other)) count += 1;
      });
      return count;
    };
    const raw: OncomingCar[] = [];
    const kept: OncomingCar[] = [];
    for (let cell = grid.first; cell <= grid.last; cell += 1) {
      const car = oncomingCarOf(profile, seed, setting, cell);
      if (car !== undefined) raw.push(car);
      const keptCar = oncomingCarKept(profile, seed, setting, NO_TOWN, HOME, cell);
      if (keptCar !== undefined) kept.push(keptCar);
    }
    expect(pairs(kept)).toBe(0);
    // Non-vacuity: the raw draws do meet, and the rule is what parts them.
    expect(pairs(raw)).toBeGreaterThan(0);
  });
});

describe('the same ride gives the same traffic — #3283', () => {
  /** Every oncoming car in reach at each of `riders`, as plain numbers. */
  const traffic = (riders: readonly number[]): readonly string[] => {
    // Built from nothing each call: the same numbers, new objects.
    const profile = northRoute(8_000, () => 10);
    const origin = corridorOrigin(profile);
    const setting: TrafficSettingAt = () => 'major';
    const seed = scatterSeed(profile);
    return riders.map((rider) =>
      JSON.stringify(
        oncomingCarsInReach(profile, origin, seed, setting, NO_TOWN, HOME, rider).map((each) => [
          each.along,
          each.travelled,
          each.car.key,
        ]),
      ),
    );
  };

  it('places the same cars for the same rider, whatever came before', () => {
    const riders = Array.from({ length: 400 }, (_, at) => 200 + at * 17.5);
    const forward = traffic(riders);
    // Asked again, backwards, and in a shuffled order: a replay at any frame rate.
    const backward = [...traffic([...riders].reverse())].reverse();
    const order = riders.map((_, at) => (at * 7919) % riders.length);
    const shuffled = traffic(order.map((at) => riders[at] as number));
    const unshuffled = riders.map((_, at) => shuffled[order.indexOf(at)] as string);
    expect(backward).toEqual(forward);
    expect(unshuffled).toEqual(forward);
    // Non-vacuity: there is traffic to compare.
    expect(forward.filter((each) => each !== '[]').length).toBeGreaterThan(50);
  });
});

/** A straight road with cross streets square over it every 200 m, from 400 m. */
function crossroads(length = 5_000): {
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
  readonly junctions: readonly Junction[];
} {
  const profile = northRoute(length, () => 10);
  const origin = corridorOrigin(profile);
  const streets: StreetFeature[] = [];
  for (let at = 400; at <= length - 400; at += 200) {
    streets.push(
      street(
        'minor_road',
        'residential',
        ringBeside(profile, origin, [
          [at, -150],
          [at, 0],
          [at, 150],
        ]),
      ),
    );
  }
  const junctions = mappedJunctions(
    {
      routeId: 'moving-cars-crossroads',
      origin,
      covered: () => true,
      coveredBoxes: [],
      landUse: [],
      buildings: [],
      paths: [],
      streets,
    },
    profile,
    origin,
    scatterSeed(profile),
  );
  return { profile, origin, junctions };
}

describe('a crossing car — #3283', () => {
  const { profile, origin, junctions } = crossroads();
  const seed = scatterSeed(profile);
  const road = { profile, origin };
  const setting: TrafficSettingAt = () => 'major';

  /** How near the ridden road's middle any part of a box comes, metres. */
  const toRoad = (pose: Parameters<typeof movingCarOutline>[0]): number =>
    Math.min(
      ...movingCarOutline(pose).map(([x, z]) => distanceToDrawnRoad(profile, origin, x, z, 50)),
    );

  it('is clear of its junction before the rider reaches it, at any speed up to the stated maximum', () => {
    expect(junctions.length).toBeGreaterThan(15);
    const violations: string[] = [];
    let onTheRoad = 0;
    const crossed = new Set<number>();
    // At steady speeds and at one that swings between a crawl and the most,
    // ticking at 30 Hz: the rider's places a ride of each would draw.
    const speeds: readonly ((t: number) => number)[] = [
      () => 2,
      () => 9,
      () => CROSSING_RIDER_SPEED_MAX,
      (t) => (CROSSING_RIDER_SPEED_MAX / 2) * (1 + Math.sin(t / 3)),
    ];
    for (const speed of speeds) {
      let rider = 200;
      for (let t = 0; rider < 4_700; t += 1 / 30) {
        rider += Math.min(CROSSING_RIDER_SPEED_MAX, speed(t)) / 30;
        for (const each of crossingCarsInReach(road, seed, setting, NO_TOWN, junctions, rider)) {
          const short = each.junction - rider;
          const off = toRoad(each);
          if (off < ROAD_WIDTH_METRES / 2) {
            onTheRoad += 1;
            crossed.add(each.junction);
          }
          if (
            short <= JUNCTION_CLEAR_METRES &&
            short >= -10 &&
            off < ROAD_WIDTH_METRES / 2 + MOVING_CAR_CLEAR_METRES - 1e-6
          ) {
            violations.push(
              `${String(each.junction)} m: ${off.toFixed(2)} m off the road, rider ${short.toFixed(1)} m short`,
            );
          }
        }
      }
    }
    expect(violations.slice(0, 5)).toEqual([]);
    // Non-vacuity: cars did cross the road ahead of the rider, at several junctions.
    expect(onTheRoad).toBeGreaterThan(100);
    expect(crossed.size).toBeGreaterThanOrEqual(3);
  });

  it('is drawn within reach of the rider, appearing far up its street and gone as the rider passes', () => {
    const seen = new Map<number, number[]>();
    for (let rider = 200; rider < 4_700; rider += 1) {
      for (const each of crossingCarsInReach(road, seed, setting, NO_TOWN, junctions, rider)) {
        expect(each.distance).toBeLessThanOrEqual(MOVING_CAR_DRAW_METRES);
        const at = seen.get(each.junction) ?? [];
        at.push(each.junction - rider);
        seen.set(each.junction, at);
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
    for (const shorts of seen.values()) {
      // First seen a long way up the road, last seen with the rider at the junction or past it.
      expect(Math.max(...shorts)).toBeGreaterThan(100);
      expect(Math.min(...shorts)).toBeLessThan(5);
    }
  });
});

describe('a crossing car and the cyclists — #3283', () => {
  it('is never at its junction while a cyclist of any kind is, where a raw draw would be', () => {
    const { profile, origin, junctions } = crossroads(40_000);
    const seed = scatterSeed(profile);
    const road = { profile, origin };
    const setting: TrafficSettingAt = () => 'major';
    // Every road a town's: the cyclists at their busiest.
    const town = (): boolean => true;
    const grid = sceneryGrid(profile, CYCLIST_CELL_METRES);
    const cyclists: Encounter[] = [];
    for (let cell = grid.first; cell <= grid.last; cell += 1) {
      const each = encounterOf(profile, seed, town, cell);
      if (each !== undefined) cyclists.push(each);
    }
    /** How many of the rider's places, while `car`'s box is on the carriageway, a cyclist is at its junction. */
    const meetings = (car: CrossingCar): number => {
      let count = 0;
      const riderAt = (s: number): number =>
        car.along - JUNCTION_CLEAR_METRES + (s - car.clear) / car.pace;
      for (let rider = riderAt(car.enter); rider <= riderAt(car.clear); rider += 0.25) {
        for (const cyclist of cyclists) {
          const at = cyclistAlong(cyclist, rider);
          if (Math.abs(at - rider) > CYCLIST_DRAW_METRES) continue;
          const reach = MOVING_CAR_CLEAR_METRES + BICYCLE_LENGTH_METRES / 2;
          if (at > car.along + car.before - reach && at < car.along + car.after + reach) count += 1;
        }
      }
      return count;
    };
    let kept = 0;
    let broken = 0;
    let wouldHave = 0;
    junctions.forEach((junction, index) => {
      const raw = crossingCarOf(junction, seed, setting, road);
      if (raw !== undefined) wouldHave += meetings(raw);
      const car = crossingCarKept(road, seed, setting, town, junctions, index);
      if (car === undefined) return;
      kept += 1;
      broken += meetings(car);
    });
    expect(broken).toBe(0);
    // Non-vacuity: cars do cross, and some raw draws would have met a cyclist there.
    expect(kept).toBeGreaterThan(20);
    expect(wouldHave).toBeGreaterThan(0);
  });
});

describe('a moving car beside a parked one — #3283', () => {
  const car = (x: number, kind: MovingCar['kind'] = 'crossing'): MovingCar => ({
    kind,
    x,
    y: 0,
    z: 0,
    heading: 0,
    pitch: 0,
    look: 1,
    travelled: 0,
    speed: 0,
    curvature: 0,
  });
  // A parked car side by side with it, nose the same way: their sides `x − 2` apart.
  const parked = [{ x: 0, z: 0, heading: 0 }];

  it('drops one whose box comes within the gap of a parked car’s, and keeps the rest as they were', () => {
    const near = car(2 + MOVING_CAR_CLEAR_METRES - 0.05);
    const clear = car(2 + MOVING_CAR_CLEAR_METRES + 0.05);
    expect(movingCarsClearOf([near, clear], parked)).toEqual([clear]);
    // Where none is near, the very list it was handed: a frame allocates nothing.
    const kept = [clear];
    expect(movingCarsClearOf(kept, parked)).toBe(kept);
    expect(movingCarsClearOf(kept, [])).toBe(kept);
  });
});

describe('moving cars are scenery only — #3283', () => {
  it('has no static import chain to a trainer module', () => {
    expect(seamViolations([MOVING_CARS_MODULE], forbiddenInTheTree())).toEqual([]);
    // The control: a planted import of the gradient writer is caught.
    const planted = plantedOver({
      [MOVING_CARS_MODULE]:
        "import { createGradientSession } from './gradient';\nvoid createGradientSession;\n",
    });
    expect(seamViolations([MOVING_CARS_MODULE], forbiddenInTheTree(), planted)).not.toEqual([]);
  });

  it('is read by the frame and the drawing alone: no draft, race, announcer or trainer code imports it', () => {
    const src = fileURLToPath(new URL('..', import.meta.url));
    const importers: string[] = [];
    const walk = (directory: string, prefix: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = `${directory}/${entry.name}`;
        if (entry.isDirectory()) walk(path, `${prefix}${entry.name}/`);
        else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          if (/from '[./]*moving-cars'/.test(readFileSync(path, 'utf8'))) {
            importers.push(`${prefix}${entry.name}`);
          }
        }
      }
    };
    walk(src, '');
    // `port.ts` names only the frame's type, from `moving-car-frame.ts`, which imports nothing.
    expect(importers.sort()).toEqual(['game/scene.ts', 'game/three-renderer.ts']);
  });
});
