// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The moving cars a FRAME carries — #3283, read back off what the frame
 * places (`scene.ts` §`placedMovingCars`, which `sceneFrame` hands the
 * renderer as `SceneFrame.movingCars`) against the rider and the other
 * cyclists the same frame places, over a whole synthetic route.
 *
 * The fixture is arithmetic, never a real place: 4 km of a road that winds
 * 80 m either way every 300 m (`route-fixtures-testing.ts` §`windingRoute`),
 * mapped along its whole length as a main road, so its racing line crosses
 * the centre at every apex and it holds the most cars a road may; and a
 * minor cross street square over it every 300 m.
 */

import { describe, expect, it, vi } from 'vitest';

import { metres, metresPerSecond, seconds, type RouteProfile } from '@onyourleft/domain';
import type { StreetFeature } from '@onyourleft/map-features';

import { footprintPlans } from './footprint-buildings';
import { buildingBeside, rectangleBeside, ringBeside } from './footprint-fixtures-testing';
import { landClassMask } from './land-class';
import { mappedBuildingsOf } from './mapped-buildings';
import {
  MOVING_CAR_CLEAR_METRES,
  MOVING_CARS_MAX,
  movingCarOutline,
  outsideMovingCar,
  poseOfCar,
} from './moving-cars';
import type { MovingCar } from './moving-car-frame';
import { PARKED_CAR_BOX, type ParkedCar, type ParkedCarsInView } from './parked-cars';
import { PEOPLE_NEAR_MAX } from './people';
import { nearestOnDrawnRoad } from './road-grid';
import { windingRoute } from './route-fixtures-testing';
import {
  drawnRiderDistance,
  placedCyclists,
  placedMovingCars,
  placedRiders,
  sceneFrame,
  type SceneInput,
} from './scene';
import { anchorScenery } from './scenery-anchor';
import type { SceneryCyclist } from './scenery-cyclists';
import { atStartLine, type GameState } from './simulation';
import { corridorOrigin, roadCorridor, type CorridorOrigin } from './terrain';
import type { WorldCorridor } from './world-data/corridor';

/**
 * The parked cars the planner answers with when a test says so. Standing a
 * parked car in a crossing car's lane takes a kerb or a driveway beside a
 * crossing street, which no fixture here has, so the frame's own wiring
 * (`sceneFrame` keeping the moving cars off the parked cars it draws) is read
 * back with the planner's answer stood in.
 */
const planted = vi.hoisted(() => ({ cars: undefined as readonly unknown[] | undefined }));
vi.mock('./parked-cars', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./parked-cars')>();
  return {
    ...actual,
    parkedCarsAt: (...args: Parameters<typeof actual.parkedCarsAt>): ParkedCarsInView =>
      planted.cars === undefined
        ? actual.parkedCarsAt(...args)
        : { cars: planted.cars as readonly ParkedCar[] },
  };
});

/** How long the winding road is, metres. */
const LENGTH = 4_000;

interface Ride {
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
  readonly corridor: WorldCorridor;
  readonly land: ReturnType<typeof landClassMask>;
}

/** The synthetic road, built from nothing each call: the same numbers, new objects. */
function ride(openWorld = false): Ride {
  const profile = windingRoute(LENGTH);
  if (openWorld) anchorScenery(profile, { seed: 3_283, origin: 0 });
  const origin = corridorOrigin(profile);
  const end = profile.totalDistance - 5;
  const main: [number, number][] = [];
  for (let at = 0; at < end; at += 10) main.push([at, 0]);
  main.push([end, 0]);
  const streets: StreetFeature[] = [
    {
      kind: 'major_road',
      kindDetail: 'primary',
      grade: 'ground',
      line: ringBeside(profile, origin, main),
    },
  ];
  for (let at = 300; at < LENGTH - 200; at += 300) {
    streets.push({
      kind: 'minor_road',
      kindDetail: 'residential',
      grade: 'ground',
      line: ringBeside(profile, origin, [
        [at, -60],
        [at, 0],
        [at, 60],
      ]),
    });
  }
  const corridor: WorldCorridor = {
    routeId: 'moving-cars-fixture',
    origin,
    covered: () => true,
    coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: LENGTH + 500 }],
    landUse: [],
    buildings: [],
    paths: [],
    streets,
  };
  return { profile, origin, corridor, land: landClassMask(corridor) };
}

const ROAD = ride();

function stateAt(profile: RouteProfile, distance: number, speed = 8): GameState {
  const start = atStartLine(profile);
  return {
    ...start,
    ride: { speed: metresPerSecond(speed), distance: metres(distance) },
    ridden: seconds(distance / speed),
  };
}

/** A free ride's input at `distance`, on the top rung, saying whatever `more` says. */
function freeRide(on: Ride, distance: number, more: Partial<SceneInput> = {}): SceneInput {
  return {
    profile: on.profile,
    origin: on.origin,
    state: stateAt(on.profile, distance),
    worldCorridor: on.corridor,
    landClass: on.land,
    people: PEOPLE_NEAR_MAX,
    sceneryCyclists: true,
    movingCars: true,
    ...more,
  };
}

interface Placed {
  readonly rider: { readonly x: number; readonly z: number };
  readonly cyclists: readonly SceneryCyclist[];
  readonly cars: readonly MovingCar[];
}

/** One frame's rider, cyclists and cars, placed without the scenery. */
function placedAt(input: SceneInput): Placed {
  const corridor = roadCorridor(input.profile, input.origin, drawnRiderDistance(input));
  const riders = placedRiders(input, corridor);
  const own = riders[0]?.marker;
  if (own === undefined) throw new Error('no rider');
  return {
    rider: own,
    cyclists: placedCyclists(input, corridor, riders),
    cars: placedMovingCars(input, corridor, riders),
  };
}

/** Every frame of a ride along the road, `step` metres apart. */
function sweep(more: Partial<SceneInput> = {}, step = 2): readonly Placed[] {
  const frames: Placed[] = [];
  for (let at = 50; at < LENGTH - 50; at += step) frames.push(placedAt(freeRide(ROAD, at, more)));
  return frames;
}

/**
 * Everything wrong with the frames' cars, each car's box `widen` metres wider
 * than it is: a box that enters the rider's half of the road coming the other
 * way, or comes within the gap of the rider, a cyclist or another car.
 */
function violations(frames: readonly Placed[], widen: number): readonly string[] {
  const half = PARKED_CAR_BOX.halfWidth + widen / 2;
  const length = PARKED_CAR_BOX.halfLength;
  const found: string[] = [];
  frames.forEach((frame, index) => {
    frame.cars.forEach((car, at) => {
      const pose = poseOfCar(car);
      const outline = movingCarOutline(pose, length, half);
      const tell = (what: string): void => {
        found.push(`frame ${String(index)} car ${String(at)} (${car.kind}): ${what}`);
      };
      if (car.kind === 'oncoming') {
        for (const [x, z] of outline) {
          const near = nearestOnDrawnRoad(ROAD.profile, ROAD.origin, x, z, 20);
          if (near !== undefined && near.lateral > 1e-6) tell('in the rider’s half');
        }
      }
      const fromRider = outsideMovingCar(pose, frame.rider.x, frame.rider.z, length, half);
      if (fromRider < MOVING_CAR_CLEAR_METRES) tell(`${fromRider.toFixed(2)} m from the rider`);
      for (const cyclist of frame.cyclists) {
        const off = outsideMovingCar(pose, cyclist.x, cyclist.z, length, half);
        if (off < MOVING_CAR_CLEAR_METRES) tell(`${off.toFixed(2)} m from a cyclist`);
      }
      frame.cars.forEach((other, theirs) => {
        if (theirs <= at) return;
        const them = poseOfCar(other);
        const apart = Math.min(
          ...outline.map(([x, z]) => outsideMovingCar(them, x, z, length, half)),
          ...movingCarOutline(them, length, half).map(([x, z]) =>
            outsideMovingCar(pose, x, z, length, half),
          ),
        );
        if (apart < MOVING_CAR_CLEAR_METRES)
          tell(`${apart.toFixed(2)} m from car ${String(theirs)}`);
      });
    });
  });
  return found;
}

describe('moving cars on an ordinary ride — #3283', () => {
  const RACING = sweep();
  const CENTRE = sweep({ centreline: true });

  it('never puts a car in the rider’s lane, or within the gap of the rider, a cyclist or another car', () => {
    const cars = RACING.reduce((sum, frame) => sum + frame.cars.length, 0);
    const oncoming = new Set(
      RACING.flatMap((frame) =>
        frame.cars.filter((car) => car.kind === 'oncoming').map((car) => car.look),
      ),
    );
    const crossing = new Set(
      RACING.flatMap((frame) =>
        frame.cars.filter((car) => car.kind === 'crossing').map((car) => car.look),
      ),
    );
    console.log(
      `#3283: ${String(cars)} cars over ${String(RACING.length)} frames — ` +
        `${String(oncoming.size)} oncoming, ${String(crossing.size)} crossing`,
    );
    expect(violations(RACING, 0).slice(0, 5)).toEqual([]);
    expect(violations(CENTRE, 0).slice(0, 5)).toEqual([]);
    // Non-vacuity: a main road's traffic, both kinds, and never past the cap.
    expect(oncoming.size).toBeGreaterThan(8);
    expect(crossing.size).toBeGreaterThan(0);
    expect(Math.max(...RACING.map((frame) => frame.cars.length))).toBeLessThanOrEqual(
      MOVING_CARS_MAX,
    );
  });

  it('goes red with a car a metre wider — the control', () => {
    // Ridden on the centreline, the rider passes every oncoming car a hand
    // over the gap away: a metre more of car is half a metre less of gap.
    expect(violations(CENTRE, 1).length).toBeGreaterThan(0);
  });

  it('hands the renderer what `placedMovingCars` places, the same on every replay', () => {
    for (const at of [612, 1_234, 2_890]) {
      const first = sceneFrame(freeRide(ride(), at));
      const again = sceneFrame(freeRide(ride(), at));
      expect(first.movingCars).toEqual(
        placedAt(freeRide(ROAD, at)).cars.length === 0
          ? undefined
          : placedAt(freeRide(ROAD, at)).cars,
      );
      expect(again.movingCars).toEqual(first.movingCars);
    }
    // Non-vacuity: a frame of the three carries a car.
    expect(
      [612, 1_234, 2_890].some(
        (at) => (sceneFrame(freeRide(ROAD, at)).movingCars?.length ?? 0) > 0,
      ),
    ).toBe(true);
  });

  it('is off in a lap race, beside the pacer, on an open-world ride, with no map, below the people’s rung, and unasked', () => {
    // The whole road, a frame every 20 m: a ride that carries cars, and each
    // thing that must take every one of them away.
    const places = Array.from({ length: 190 }, (_, index) => 100 + index * 20);
    const carsOn = (on: Ride, more: (at: number) => Partial<SceneInput>): number =>
      places.reduce((sum, at) => sum + placedAt(freeRide(on, at, more(at))).cars.length, 0);
    expect(carsOn(ROAD, () => ({}))).toBeGreaterThan(20);
    const off: readonly [string, (at: number) => Partial<SceneInput>, Ride?][] = [
      ['unasked', () => ({ movingCars: false })],
      [
        'a lap race',
        (at) => ({
          steeredLateral: 1.75,
          raceBots: [{ distanceMetres: at + 20, speedMetresPerSecond: 8, lateralMetres: 0 }],
        }),
      ],
      ['the pacer', (at) => ({ botDistance: metres(at + 10) })],
      ['below the people’s rung', () => ({ people: 0 })],
      ['with no map', () => ({ worldCorridor: undefined })],
      ['an open-world ride', () => ({}), ride(true)],
    ];
    for (const [name, more, on] of off) expect(carsOn(on ?? ROAD, more), name).toBe(0);
  });
});

describe('moving cars kept off the parked cars a frame draws — #3283', () => {
  /** The ride with one building far off the road, so the frame asks the planner for parked cars. */
  function withBuilding(): Ride & { readonly mapped: ReturnType<typeof mappedBuildingsOf> } {
    const on = ride();
    const corridor: WorldCorridor = {
      ...on.corridor,
      buildings: [buildingBeside(on.profile, on.origin, [rectangleBeside(2_000, 300, 13, 8)], 6)],
    };
    const land = landClassMask(corridor);
    const mapped = mappedBuildingsOf(footprintPlans(corridor, land, on.profile, on.origin).plans);
    return { ...on, corridor, land, mapped };
  }

  it('drops the crossing car a parked car stands in the way of, from the frame the renderer is handed', () => {
    const at = Array.from({ length: 190 }, (_, index) => 100 + index * 5).find((each) =>
      placedAt(freeRide(ROAD, each)).cars.some((car) => car.kind === 'crossing'),
    );
    if (at === undefined) throw new Error('no frame with a crossing car');
    const asked = (): readonly MovingCar[] => {
      const on = withBuilding();
      return (
        sceneFrame(freeRide(on, at, { parkedCars: true, mappedBuildings: on.mapped })).movingCars ??
        []
      );
    };
    try {
      planted.cars = undefined;
      const free = asked();
      const crossing = free.find((car) => car.kind === 'crossing');
      if (crossing === undefined) throw new Error('the frame lost its crossing car');
      // A parked car in the crossing car's place, nose the same way.
      planted.cars = [
        {
          x: crossing.x,
          y: 0,
          z: crossing.z,
          heading: crossing.heading,
          pitch: 0,
          spot: 'kerb',
          level: 'far',
          look: 1,
        } satisfies ParkedCar,
      ];
      const kept = asked();
      expect(kept).not.toContainEqual(crossing);
      // Only what the parked car is within the gap of goes: the rest stand as they did.
      for (const car of free) {
        const apart = outsideMovingCar(
          poseOfCar(car),
          crossing.x,
          crossing.z,
          PARKED_CAR_BOX.halfLength,
          PARKED_CAR_BOX.halfWidth,
        );
        if (apart >= MOVING_CAR_CLEAR_METRES) expect(kept).toContainEqual(car);
      }
      expect(kept.length).toBeLessThan(free.length);
    } finally {
      planted.cars = undefined;
    }
  });
});
