// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Test support for the open-world junction choice (#2897) and its prompt
 * (#2898): the synthetic rides both ride, moved here from
 * `junction-choice.test.ts` so the prompt's tests ride the same ones rather
 * than a copy. Every graph is synthetic, laid out in metres from one arbitrary
 * origin (`@onyourleft/domain/rolling-testing`). Never shipped.
 */

import { expect } from 'vitest';

import {
  gradeAt,
  kilograms,
  positionAt,
  RollingRoute,
  seconds,
  watts,
  type RollingJunction,
} from '@onyourleft/domain';
import { graphOf, gridGraph, roughGround, streetThrough } from '@onyourleft/domain/rolling-testing';
import { advance, START_OF_RIDE, type RideConditions } from '@onyourleft/physics';

import { createJunctionChoice } from './junction-choice';

/** An uneven grid, so the ways on from a junction differ in length and in heights. */
const COLUMNS = [0, 180, 410, 600, 870, 1_050, 1_330, 1_520, 1_790, 2_000, 2_260, 2_450];
const ROWS = [0, 230, 400, 650, 820, 1_090, 1_280, 1_510, 1_700, 1_960, 2_150];

/** A fresh ride east along row 3 from the grid's west edge. */
export function newRide() {
  const { graph } = gridGraph(COLUMNS, ROWS, undefined, 3);
  const start = graph.edgesFrom('0,3').find((edge) => edge.id === 'h0,3');
  if (start === undefined) throw new Error('no start street');
  const route = new RollingRoute(graph, start);
  return { route, choice: createJunctionChoice(route, () => 0) };
}

/**
 * The junction this file turns at: the fourth along row 3, 870 m from the
 * start and 270 m past the one before it, so its prompt is the whole 250 m.
 */
export function theJunction(route: RollingRoute): RollingJunction {
  const junction = route.junctionsAfter(0)[3];
  if (junction === undefined) throw new Error('no junction');
  return junction;
}

/** The grade and the position the ride reads at ride distance `at`. */
export function readAt(route: RollingRoute, at: number) {
  const view = route.view();
  return {
    grade: gradeAt(view, at - route.origin) as number,
    position: positionAt(view, at - route.origin),
  };
}

const CONDITIONS: RideConditions = {
  totalMass: kilograms(85),
  airDensityKilogramsPerCubicMetre: 1.225,
};

/** The power trace every ride rides: deterministic, never flat. */
export function powerAt(second: number): number {
  return 190 + 60 * Math.sin(second / 13) + 25 * Math.sin(second / 3.7);
}

export interface Ride {
  /** The grade read at the rider each second: what the grade path is asked for. */
  readonly grades: readonly number[];
  readonly distances: readonly number[];
}

/**
 * Rides {@link powerAt} for `duration` seconds, calling `each` with the rider's
 * distance before each second is ridden.
 */
export function rideTrace(
  duration: number,
  each: (ride: ReturnType<typeof newRide>, rider: number) => void,
  setUp: (ride: ReturnType<typeof newRide>) => void = () => undefined,
): Ride {
  const ride = newRide();
  setUp(ride);
  let state = START_OF_RIDE;
  const grades: number[] = [];
  const distances: number[] = [];
  for (let second = 0; second < duration; second += 1) {
    const rider = state.distance as number;
    ride.route.advance(rider);
    each(ride, rider);
    const grade = gradeAt(ride.route.view(), rider - ride.route.origin);
    grades.push(grade);
    distances.push(rider);
    state = advance(
      state,
      { power: watts(powerAt(second)), grade, duration: seconds(1) },
      CONDITIONS,
    );
  }
  return { grades, distances };
}

/**
 * A ride east along a 500 m street to one junction, whose ways on leave it at
 * `turns` (degrees, negative left), each 400 m long and of road class 1 unless
 * `roadClasses` says otherwise. The rider is 200 m short of it, inside the
 * prompt and before the lock.
 */
export function starRide(turns: readonly number[], roadClasses: readonly number[] = []) {
  const approach = {
    id: 'in',
    from: 'start',
    to: 'junction',
    points: streetThrough(
      [
        [0, 0],
        [500, 0],
      ],
      roughGround,
    ),
    roadClass: 1,
  };
  const ways = turns.map((turn, index) => {
    const radians = (turn * Math.PI) / 180;
    return {
      id: `way${index}`,
      from: 'junction',
      to: `end${index}`,
      points: streetThrough(
        [
          [500, 0],
          [500 + 400 * Math.cos(radians), -400 * Math.sin(radians)],
        ],
        roughGround,
      ),
      roadClass: roadClasses[index] ?? 1,
    };
  });
  const route = new RollingRoute(graphOf([approach, ...ways]), approach);
  const choice = createJunctionChoice(route, () => 0);
  const junction = route.junctionsAfter(0)[0];
  if (junction === undefined || Math.abs(junction.distance - 500) > 10) {
    throw new Error('no junction at the end of the 500 m street');
  }
  const rider = junction.distance - 200;
  const ids = junction.ways.map((way) => way.edge.id);
  /** Sets the choice to `id` as an earlier press would have, then presses `press`. */
  const pressFrom = (id: string, press: 'left' | 'straight' | 'right') => {
    route.choose(junction.distance, id, rider);
    expect(choice.prompt(rider)?.chosen).toBe(id);
    choice.press(press, rider);
    return route.legs.find((leg) => leg.start === junction.distance)?.edge.id;
  };
  return { route, choice, junction, rider, ids, pressFrom };
}
