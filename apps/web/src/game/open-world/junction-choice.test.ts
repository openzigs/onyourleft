// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * Junction choice (#2897, ADR 0088 D-1, D-5.3), read back through the rolling
 * route as the ride reads it: `gradeAt` and `positionAt` on the route's view at
 * ride distance minus its origin, never the choice's own state.
 *
 * ## The behavioural ride, and how far it reaches today
 *
 * ADR 0088 D-5.3 rides one power trace twice: once turning left by a press
 * before the lock, once with that junction's branch fixed to the left and no
 * press, through the same street graph, heights and rolling-route builder; the
 * grades must be byte-identical. A third ride presses after the lock and must
 * ride the default's grades. Here each ride is the physics tick
 * (`@onyourleft/physics` §`advance`) fed, every second, the grade the road
 * gives at the rider through the rolling route's view: the value the grade
 * path is asked for. The grade path for an open-world ride (`gradient.ts`
 * told of each new view, the deadband, the slew) is #2896 and #2899's; its
 * writes are a deterministic function of this sequence, so identical grades
 * in give identical writes out. #2896 runs the same three rides through it.
 */

import { describe, expect, it } from 'vitest';

import {
  distanceBetween,
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

import { startSteer, steerIntentOfKey, steerToward } from '../lanes';

import { createJunctionChoice, JUNCTION_PROMPT_METRES, TURN_PRESSES } from './junction-choice';
import {
  NO_TURN_CONTROLLER_HELD,
  NO_TURN_PADS_HELD,
  readTurnController,
  readTurnPads,
  turnOfKey,
} from './turn-input';
import { keyDown, pad, TURN_SOURCES } from './turn-input-testing';

/** An uneven grid, so the ways on from a junction differ in length and in heights. */
const COLUMNS = [0, 180, 410, 600, 870, 1_050, 1_330, 1_520, 1_790, 2_000, 2_260, 2_450];
const ROWS = [0, 230, 400, 650, 820, 1_090, 1_280, 1_510, 1_700, 1_960, 2_150];

/** A fresh ride east along row 3 from the grid's west edge. */
function newRide() {
  const { graph } = gridGraph(COLUMNS, ROWS, undefined, 3);
  const start = graph.edgesFrom('0,3').find((edge) => edge.id === 'h0,3');
  if (start === undefined) throw new Error('no start street');
  const route = new RollingRoute(graph, start);
  return { route, choice: createJunctionChoice(route) };
}

/**
 * The junction this file turns at: the fourth along row 3, 870 m from the
 * start and 270 m past the one before it, so its prompt is the whole 250 m.
 */
function theJunction(route: RollingRoute): RollingJunction {
  const junction = route.junctionsAfter(0)[3];
  if (junction === undefined) throw new Error('no junction');
  return junction;
}

/** The grade and the position the ride reads at ride distance `at`. */
function readAt(route: RollingRoute, at: number) {
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
function powerAt(second: number): number {
  return 190 + 60 * Math.sin(second / 13) + 25 * Math.sin(second / 3.7);
}

interface Ride {
  /** The grade read at the rider each second: what the grade path is asked for. */
  readonly grades: readonly number[];
  readonly distances: readonly number[];
}

/**
 * Rides {@link powerAt} for `duration` seconds, calling `each` with the rider's
 * distance before each second is ridden.
 */
function rideTrace(
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

describe('the prompt (ADR 0088 D-1.2, D-1.5)', () => {
  it(`appears ${JUNCTION_PROMPT_METRES} m before the junction, and says when the choice is final`, () => {
    const { route, choice } = newRide();
    const junction = theJunction(route);
    expect(choice.prompt(junction.distance - JUNCTION_PROMPT_METRES - 1)).toBeUndefined();
    const shown = choice.prompt(junction.distance - JUNCTION_PROMPT_METRES);
    expect(shown?.distance).toBe(junction.distance);
    expect(shown?.locked).toBe(false);
    expect(shown?.toLock).toBe(JUNCTION_PROMPT_METRES - 100);
    expect(shown?.chosen).toBe(junction.defaultWay);
    expect(shown?.ways.map((way) => way.edge.id)).toEqual(junction.ways.map((way) => way.edge.id));
    const final = choice.prompt(junction.distance - 100);
    expect(final?.locked).toBe(true);
    expect(final?.toLock).toBe(0);
  });

  it('takes no turn press before the prompt shows', () => {
    const { route, choice } = newRide();
    const junction = theJunction(route);
    choice.press('left', junction.distance - JUNCTION_PROMPT_METRES - 5);
    expect(theJunction(route).taken).toBe(junction.defaultWay);
  });
});

/**
 * A ride east along a 500 m street to one junction, whose ways on leave it at
 * `turns` (degrees, negative left), each 400 m long and of road class 1 unless
 * `roadClasses` says otherwise. The rider is 200 m short of it, inside the
 * prompt and before the lock.
 */
function starRide(turns: readonly number[], roadClasses: readonly number[] = []) {
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
  const choice = createJunctionChoice(route);
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

describe('a press chooses directly at three ways or fewer (ADR 0088 D-1.3, owner ruling 2026-11-20)', () => {
  it('at a crossroads, left, straight and right each take their own way, whatever was chosen before', () => {
    const { route, choice } = newRide();
    const junction = theJunction(route);
    const rider = junction.distance - 200;
    const ids = junction.ways.map((way) => way.edge.id);
    expect(ids).toHaveLength(3);
    expect(junction.defaultWay).toBe(ids[1]);
    const wanted = { left: ids[0], straight: ids[1], right: ids[2] } as const;
    for (const from of ids) {
      for (const press of ['left', 'straight', 'right'] as const) {
        route.choose(junction.distance, from, rider);
        choice.press(press, rider);
        expect(choice.prompt(rider)?.chosen, `${press} from ${from}`).toBe(wanted[press]);
        // Read back through the route the ride rides: the leg past the junction.
        expect(route.legs.find((leg) => leg.start === junction.distance)?.edge.id).toBe(
          wanted[press],
        );
      }
    }
  });

  it('a press repeated, or held, chooses nothing more', () => {
    const { route, choice } = newRide();
    const junction = theJunction(route);
    const rider = junction.distance - 200;
    for (let press = 0; press < 3; press += 1) choice.press('left', rider);
    expect(choice.prompt(rider)?.chosen).toBe(junction.ways[0]?.edge.id);
    for (let press = 0; press < 3; press += 1) choice.press('right', rider);
    expect(choice.prompt(rider)?.chosen).toBe(junction.ways[2]?.edge.id);
  });

  it('with three ways, straight is the way most nearly ahead by bearing, not the middle one', () => {
    // The reviewer's layout: the middle way by position (-30°) is not straight on (0°).
    const { junction, ids, pressFrom } = starRide([-90, -30, 0]);
    expect(junction.defaultWay).toBe(ids[2]);
    for (const from of ids) {
      expect(pressFrom(from, 'straight'), `straight from ${from}`).toBe(ids[2]);
      expect(pressFrom(from, 'left'), `left from ${from}`).toBe(ids[0]);
      expect(pressFrom(from, 'right'), `right from ${from}`).toBe(ids[2]);
    }
    // And where the leftmost way is the most nearly ahead.
    const fan = starRide([-15, 40, 95]);
    for (const from of fan.ids) {
      expect(fan.pressFrom(from, 'straight'), `straight from ${from}`).toBe(fan.ids[0]);
      expect(fan.pressFrom(from, 'left'), `left from ${from}`).toBe(fan.ids[0]);
      expect(fan.pressFrom(from, 'right'), `right from ${from}`).toBe(fan.ids[2]);
    }
  });

  it('with two ways, left and right take the ends, and straight the one more nearly ahead', () => {
    for (const [turns, ahead] of [
      [[-90, 0], 1],
      [[0, 90], 0],
      [[-20, 70], 0],
    ] as const) {
      const { ids, pressFrom } = starRide(turns);
      expect(ids).toHaveLength(2);
      for (const from of ids) {
        expect(pressFrom(from, 'left'), `${turns.join()}: left from ${from}`).toBe(ids[0]);
        expect(pressFrom(from, 'right'), `${turns.join()}: right from ${from}`).toBe(ids[1]);
        expect(pressFrom(from, 'straight'), `${turns.join()}: straight from ${from}`).toBe(
          ids[ahead],
        );
      }
    }
  });

  it('on a tie in bearing, straight takes the higher road class, then the right-hand way', () => {
    // -30° and +30° are equally far from ahead in whole degrees (D-1.4's tie).
    for (const [classes, ahead] of [
      [[1, 1], 1],
      [[2, 1], 0],
      [[1, 2], 1],
    ] as const) {
      const { junction, ids, pressFrom } = starRide([-30, 30], classes);
      expect(junction.defaultWay).toBe(ids[ahead]);
      for (const from of ids) {
        expect(pressFrom(from, 'straight'), `${classes.join()}: straight from ${from}`).toBe(
          ids[ahead],
        );
      }
    }
    // The same tie at three ways, where the middle way by position is the left of the two.
    const { ids, pressFrom } = starRide([-60, -30, 30]);
    for (const from of ids) {
      expect(pressFrom(from, 'straight'), `straight from ${from}`).toBe(ids[2]);
    }
  });
});

describe('with more than three ways on, left and right step round the junction (ADR 0088 D-1.3)', () => {
  it('one way per press, stopping at its ends; straight is the default', () => {
    const { route, choice, junction, rider, ids } = starRide([-100, -45, 0, 45, 100]);
    expect(ids).toHaveLength(5);
    expect(junction.defaultWay).toBe(ids[2]);
    const chosen = () => route.legs.find((leg) => leg.start === junction.distance)?.edge.id;
    expect(chosen()).toBe(ids[2]);
    for (const expected of [ids[1], ids[0], ids[0]]) {
      choice.press('left', rider);
      expect(chosen()).toBe(expected);
      expect(choice.prompt(rider)?.chosen).toBe(expected);
    }
    for (const expected of [ids[1], ids[2], ids[3], ids[4], ids[4]]) {
      choice.press('right', rider);
      expect(chosen()).toBe(expected);
    }
    choice.press('straight', rider);
    expect(chosen()).toBe(junction.defaultWay);
  });
});

describe('every input source presses alike (ADR 0088 D-3)', () => {
  it('every input source makes the same choice', () => {
    for (const press of TURN_PRESSES) {
      const chosen = new Set<string>();
      for (const [source, read] of Object.entries(TURN_SOURCES[press])) {
        const { route, choice } = newRide();
        const junction = theJunction(route);
        const rider = junction.distance - 200;
        if (press === 'straight') choice.press('left', rider);
        const presses = read();
        expect(presses, source).toEqual([press]);
        for (const each of presses) choice.press(each, rider);
        const after = readAt(route, rider + 300);
        chosen.add(
          `${choice.prompt(rider)?.chosen ?? 'none'} ${after.position.latitude} ${after.position.longitude}`,
        );
      }
      expect(chosen.size, press).toBe(1);
    }
  });
});

describe('a lane change with no choice pressed rides straight on (ADR 0088 D-2)', () => {
  it('steers lanes by key, pad and controller, and takes the default way at the junction', () => {
    const { route, choice } = newRide();
    const junction = theJunction(route);
    const straight = junction.ways.find((way) => way.edge.id === junction.defaultWay);
    if (straight === undefined) throw new Error('no default');
    expect(Math.round(straight.turnDegrees)).toBe(0);

    let lane = startSteer(0);
    let pads = NO_TURN_PADS_HELD;
    let controller = NO_TURN_CONTROLLER_HELD;
    for (let rider = junction.distance - 240; rider < junction.distance + 60; rider += 20) {
      route.advance(rider);
      // Every lane input there is, each sent to the turn inputs too.
      for (const key of ['d', 'A', 'a']) {
        const intent = steerIntentOfKey(keyDown(key));
        if (intent !== undefined) lane = steerToward(lane, intent);
        const turn = turnOfKey(keyDown(key));
        if (turn !== undefined) choice.press(turn, rider);
      }
      const read = readTurnPads(pads, [pad('standard', [14, 15], [-1, 0])]);
      pads = read.state;
      for (const each of read.presses) choice.press(each, rider);
      const fromController = readTurnController(controller, [
        { kind: 'steer', direction: 'left', pressed: true, superseded: false },
        { kind: 'steering-angle', degrees: -45 },
      ]);
      controller = fromController.state;
      for (const each of fromController.presses) choice.press(each, rider);
    }
    expect(lane.lane).not.toBe(startSteer(0).lane);
    // Past the junction the ride is on the straight way.
    const legs = route.legs;
    const after = legs.find((leg) => leg.start === junction.distance);
    expect(after?.edge.id).toBe(junction.defaultWay);
    const on = readAt(route, junction.distance + 50).position;
    const from = straight.edge.points[0]?.position;
    if (from === undefined) throw new Error('empty street');
    expect(distanceBetween(from, on)).toBeCloseTo(50, 3);
  });
});

describe('a press after the lock changes nothing (ADR 0088 D-1.5, ADR 0087 D-6.2)', () => {
  it('rides the default branch, read back through the rolling route’s grade', () => {
    const plain = newRide();
    const late = newRide();
    const junction = theJunction(late.route);
    for (const rider of [junction.distance - 100, junction.distance - 99, junction.distance - 10]) {
      plain.route.advance(rider);
      late.route.advance(rider);
      late.choice.press('left', rider);
      expect(late.choice.prompt(rider)?.chosen).toBe(junction.defaultWay);
    }
    for (let at = junction.distance - 200; at < junction.distance + 600; at += 10) {
      expect(readAt(late.route, at).grade, `grade at ${at} m`).toBe(readAt(plain.route, at).grade);
    }
  });

  it('a press just before the lock does change the branch, and its grade', () => {
    const plain = newRide();
    const early = newRide();
    const junction = theJunction(early.route);
    const rider = junction.distance - 101;
    early.route.advance(rider);
    plain.route.advance(rider);
    early.choice.press('left', rider);
    expect(early.choice.prompt(rider)?.chosen).toBe(junction.ways[0]?.edge.id);
    let differs = 0;
    for (let at = junction.distance; at < junction.distance + 600; at += 10) {
      if (readAt(early.route, at).grade !== readAt(plain.route, at).grade) differs += 1;
    }
    expect(differs).toBeGreaterThan(10);
  });
});

describe('turning round (ADR 0088 D-1.6, D-1.7)', () => {
  it('a U-turn press reverses direction with no jump in distance', () => {
    const { route, choice } = newRide();
    const rider = 300;
    route.advance(rider);
    const here = readAt(route, rider).position;
    const behind = readAt(route, 250).position;
    choice.press('u-turn', rider);
    expect(readAt(route, rider).position).toEqual(here);
    // The turn is on the sample at 300 m, so fifty metres on the rider is
    // back where they were at 250 m.
    expect(distanceBetween(readAt(route, rider + 50).position, behind)).toBeLessThan(1e-6);
    expect(route.legs.some((leg) => leg.kind === 'u-turn')).toBe(true);
  });

  it('a dead end turns the rider round by itself', () => {
    // A single street, 300 m long: its far end has no way on but the way back.
    const lone = gridGraph([0, 300], [0], undefined).graph;
    const street = lone.edgesFrom('0,0')[0];
    if (street === undefined) throw new Error('no street');
    const route = new RollingRoute(lone, street);
    const choice = createJunctionChoice(route);
    expect(route.legs[1]?.kind).toBe('turn-round');
    expect(choice.prompt(0)).toBeUndefined();
    const out = readAt(route, 300 - 40).position;
    const back = readAt(route, 300 + 40).position;
    expect(distanceBetween(out, back)).toBeLessThan(0.01);
  });
});

describe('the behavioural ride: the grade comes from the road ridden, never from the press (ADR 0088 D-5.3)', () => {
  const DURATION = 200;

  it('a left turn by a press before the lock and the same branch fixed with no press send identical grades', () => {
    let pressed = false;
    const byPress = rideTrace(DURATION, ({ route, choice }, rider) => {
      const shown = choice.prompt(rider);
      const junction = theJunction(route);
      if (!pressed && shown?.distance === junction.distance && !shown.locked) {
        const press = turnOfKey(keyDown('ArrowLeft'));
        if (press !== undefined) choice.press(press, rider);
        pressed = true;
      }
    });
    expect(pressed).toBe(true);
    const fixed = rideTrace(
      DURATION,
      () => undefined,
      ({ route }) => {
        const junction = theJunction(route);
        const left = junction.ways[0]?.edge.id as string;
        expect(route.choose(junction.distance, left, 0)).toBe('swapped');
      },
    );
    expect(byPress.distances[byPress.distances.length - 1]).toBeGreaterThan(
      theJunction(newRide().route).distance + 300,
    );
    expect(byPress.grades).toEqual(fixed.grades);
    expect(byPress.distances).toEqual(fixed.distances);

    // And the turn is real: the default ride's grades differ past the junction.
    const plain = rideTrace(DURATION, () => undefined);
    expect(plain.grades).not.toEqual(byPress.grades);
  });

  it('a press after the lock sends the default branch’s grades', () => {
    const plain = rideTrace(DURATION, () => undefined);
    let pressed = 0;
    const late = rideTrace(DURATION, ({ route, choice }, rider) => {
      const junction = theJunction(route);
      const toGo = junction.distance - rider;
      if (toGo <= 100 && toGo > 0) {
        choice.press('left', rider);
        pressed += 1;
      }
    });
    expect(pressed).toBeGreaterThan(0);
    expect(late.grades).toEqual(plain.grades);
  });
});
