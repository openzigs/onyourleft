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

import { distanceBetween, JUNCTION_LOCK_METRES, RollingRoute } from '@onyourleft/domain';
import { gridGraph } from '@onyourleft/domain/rolling-testing';

import { startSteer, steerIntentOfKey, steerToward } from '../lanes';

import {
  createJunctionChoice,
  JUNCTION_PROMPT_METRES,
  pressesOfWays,
  TURN_NOTICE_SECONDS,
  TURN_PRESSES,
  WAY_PRESSES,
} from './junction-choice';
import {
  NO_TURN_CONTROLLER_HELD,
  NO_TURN_PADS_HELD,
  readTurnController,
  readTurnPads,
  turnOfKey,
} from './turn-input';
import { keyDown, pad, TURN_SOURCES } from './turn-input-testing';
import { newRide, readAt, rideTrace, starRide, theJunction } from './junction-ride-testing';

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
    }
    // And where the leftmost way is the most nearly ahead.
    const fan = starRide([-15, 40, 95]);
    expect(fan.junction.defaultWay).toBe(fan.ids[0]);
    for (const from of fan.ids) {
      expect(fan.pressFrom(from, 'straight'), `straight from ${from}`).toBe(fan.ids[0]);
      expect(fan.pressFrom(from, 'right'), `right from ${from}`).toBe(fan.ids[2]);
    }
  });

  it('with three ways, when straight is an end, that end’s press steps inward, so every way has a press', () => {
    // The owner's examples of 2026-11-20: -90°/-30°/0° gives left -90°, straight 0°,
    // right -30°; -15°/40°/95° gives left 40°, straight -15°, right 95°.
    for (const [turns, wanted] of [
      [[-90, -30, 0], { left: 0, straight: 2, right: 1 }],
      [[-15, 40, 95], { left: 1, straight: 0, right: 2 }],
    ] as const) {
      const { ids, pressFrom } = starRide(turns);
      for (const from of ids) {
        for (const press of ['left', 'straight', 'right'] as const) {
          expect(pressFrom(from, press), `${turns.join()}: ${press} from ${from}`).toBe(
            ids[wanted[press]],
          );
        }
      }
    }
  });

  it('with two ways, left and right take the ends, and straight the one more nearly ahead', () => {
    for (const [turns, ahead] of [
      [[-90, 0], 1],
      [[0, 90], 0],
      [[-20, 70], 0],
    ] as const) {
      const { ids, pressFrom } = starRide(turns);
      // Each of the two ways already has a press, so left and right keep their ends
      // even when straight is one of them.
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

describe('which presses take each way, for the prompt to label (#2898)', () => {
  it('is what each press then does, from every way chosen, at every shape of junction', () => {
    for (const turns of [
      [-90, 0, 90],
      [-90, -30, 0],
      [-15, 40, 95],
      [-90, 0],
      [0, 90],
      [-30, 30],
      [-100, -45, 0, 45, 100],
    ]) {
      const { route, choice, junction, rider, ids, pressFrom } = starRide(turns);
      for (const from of ids) {
        route.choose(junction.distance, from, rider);
        const shown = choice.prompt(rider);
        if (shown === undefined) throw new Error('no prompt');
        const presses = pressesOfWays(shown);
        expect([...presses.keys()]).toEqual(ids);
        // Each press is on exactly one way…
        expect([...presses.values()].flat().sort()).toEqual([...WAY_PRESSES].sort());
        // …and with three ways or fewer every way has one (the inward-step ruling).
        if (ids.length <= 3) {
          for (const id of ids) expect(presses.get(id), `${turns.join()}: ${id}`).not.toEqual([]);
        }
        // And it is the way the press takes, read back through the route.
        for (const [id, each] of presses) {
          for (const press of each) {
            expect(pressFrom(from, press), `${turns.join()}: ${press} from ${from}`).toBe(id);
          }
        }
      }
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
      for (const [source, read] of Object.entries(TURN_SOURCES[press])) {
        const { route, choice } = newRide();
        const junction = theJunction(route);
        const rider = junction.distance - 200;
        const ids = junction.ways.map((way) => way.edge.id);
        expect(ids, source).toHaveLength(3);
        // Straight from a choice that is not already straight, so the press shows.
        if (press === 'straight') choice.press('left', rider);
        const behind = readAt(route, rider - 50).position;
        const presses = read();
        expect(presses, source).toEqual([press]);
        for (const each of presses) choice.press(each, rider);
        if (press === 'u-turn') {
          // Turned round where the rider is (on the nearest sample, so within a
          // metre): fifty metres on is fifty metres back, not a hundred apart.
          expect(distanceBetween(readAt(route, rider + 50).position, behind), source).toBeLessThan(
            1,
          );
          continue;
        }
        // The crossroads' ways sit left, ahead and right, so each press has its own way.
        const wanted = { left: ids[0], straight: ids[1], right: ids[2] }[press];
        expect(choice.prompt(rider)?.chosen, `${press} by ${source}`).toBe(wanted);
        // Read back through the route the ride rides: the leg past the junction.
        expect(
          route.legs.find((leg) => leg.start === junction.distance)?.edge.id,
          `${press} by ${source}`,
        ).toBe(wanted);
      }
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
    // #3129: nearer than 75 m the prompt, and so a press, is for the junction
    // after this one, which is then within 250 m and not yet final.
    for (const rider of [junction.distance - 100, junction.distance - 99, junction.distance - 75]) {
      plain.route.advance(rider);
      late.route.advance(rider);
      expect(late.choice.prompt(rider)?.distance).toBe(junction.distance);
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
    const choice = createJunctionChoice(route, () => 0);
    expect(route.legs[1]?.kind).toBe('turn-round');
    expect(choice.prompt(0)).toBeUndefined();
    const out = readAt(route, 300 - 40).position;
    const back = readAt(route, 300 + 40).position;
    expect(distanceBetween(out, back)).toBeLessThan(0.01);
  });
});

describe('what a turn says, and a second U-turn press — #3058', () => {
  it('stands Turning round for its time after a U-turn, and a second press inside it turns nothing', () => {
    let now = 10;
    const { route } = newRide();
    const choice = createJunctionChoice(route, () => now);
    route.advance(300);
    expect(choice.notice(300)).toBeUndefined();
    choice.press('u-turn', 300);
    expect(choice.notice(300)).toEqual({ kind: 'turning-round', since: 10 });
    // A double tap: the second press is harmless.
    now = 10 + TURN_NOTICE_SECONDS - 0.1;
    choice.press('u-turn', 301);
    expect(route.uTurns).toBe(1);
    // Its time over, the notice goes and a press turns the rider round again.
    now = 10 + TURN_NOTICE_SECONDS;
    expect(choice.notice(302)).toBeUndefined();
    choice.press('u-turn', 302);
    expect(route.uTurns).toBe(2);
    expect(choice.notice(302)).toEqual({ kind: 'turning-round', since: now });
  });

  it('stands No junction yet for a way pressed with no junction near, and chooses nothing', () => {
    const { route } = newRide();
    const choice = createJunctionChoice(route, () => 5);
    const junction = theJunction(route);
    const rider = junction.distance - JUNCTION_PROMPT_METRES - 5;
    const legs = route.legs;
    for (const press of WAY_PRESSES) {
      choice.press(press, rider);
      expect(choice.notice(rider), press).toEqual({ kind: 'no-junction', since: 5 });
    }
    expect(route.legs).toEqual(legs);
    // Within reach of a junction, a press chooses and begins no notice.
    const near = createJunctionChoice(route, () => 5);
    near.press('left', junction.distance - 200);
    expect(near.notice(junction.distance - 200)).toBeUndefined();
  });

  it('stands Dead end once the rider passes where a dead end turns them round, and not before', () => {
    let now = 0;
    const lone = gridGraph([0, 300], [0], undefined).graph;
    const street = lone.edgesFrom('0,0')[0];
    if (street === undefined) throw new Error('no street');
    const route = new RollingRoute(lone, street);
    const choice = createJunctionChoice(route, () => now);
    expect(choice.notice(0)).toBeUndefined();
    now = 25;
    expect(choice.notice(299)).toBeUndefined();
    now = 26;
    expect(choice.notice(301)).toEqual({ kind: 'dead-end', since: 26 });
    // Passed once: reading on past it begins nothing new, and it goes in its time.
    now = 26 + TURN_NOTICE_SECONDS;
    expect(choice.notice(320)).toBeUndefined();
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
      // #3129: only while the prompt is for this junction. Nearer, it is for
      // the next one, not yet final, where a press does choose.
      if (toGo <= 100 && toGo > 0 && choice.prompt(rider)?.distance === junction.distance) {
        choice.press('left', rider);
        pressed += 1;
      }
    });
    expect(pressed).toBeGreaterThan(0);
    expect(late.grades).toEqual(plain.grades);
  });
});

describe('a town of blocks under 100 m: the first junction not yet final is offered — #3129, ADR 0088 D-1.2 as amended', () => {
  /** Blocks of 60 to 90 m along row 1, after a first block of 300 m. */
  const DENSE = [0, 300, 360, 430, 510, 600, 900, 1_200];

  function denseRide() {
    const { graph } = gridGraph(DENSE, [0, 230, 460], undefined, 1);
    const start = graph.edgesFrom('0,1').find((edge) => edge.id === 'h0,1');
    if (start === undefined) throw new Error('no start street');
    const route = new RollingRoute(graph, start);
    const choice = createJunctionChoice(route, () => 0);
    const junctions = route.junctionsAfter(0).map((junction) => junction.distance);
    return { route, choice, junctions };
  }

  it('offers every junction before its choice is final, and says which junction ahead it is', () => {
    const { route, choice, junctions } = denseRide();
    const dense = junctions.slice(0, 5);
    expect(dense.length).toBe(5);
    const offered = new Set<number>();
    let last = Number.NEGATIVE_INFINITY;
    for (let rider = 0; rider < (dense[4] as number); rider += 1) {
      route.advance(rider);
      const shown = choice.prompt(rider);
      if (shown === undefined) continue;
      // Never steps back to a junction it has left.
      expect(shown.distance).toBeGreaterThanOrEqual(last);
      last = shown.distance;
      // Which junction ahead it is: one more than the junctions between.
      const between = junctions.filter((at) => at > rider && at < shown.distance).length;
      expect(shown.ordinal, `at ${rider} m`).toBe(between + 1);
      if (!shown.locked) {
        offered.add(shown.distance);
        expect(shown.ways.length).toBe(3);
        expect(shown.tooClose).toBe(false);
      }
    }
    expect([...offered]).toEqual(dense);
  });

  it('shows the next junction while its choice is not final, and the one after once it is', () => {
    const { route, choice, junctions } = denseRide();
    const [first, second] = junctions as [number, number];
    route.advance(first - 101);
    expect(choice.prompt(first - 101)?.distance).toBe(first);
    expect(choice.prompt(first - 101)?.ordinal).toBe(1);
    route.advance(first - 100);
    const after = choice.prompt(first - 100);
    expect(after?.distance).toBe(second);
    expect(after?.ordinal).toBe(2);
    expect(after?.locked).toBe(false);
  });

  it('a press while the 2nd junction is shown chooses there, and changes nothing at the 1st or before it', () => {
    const plain = denseRide();
    const pressed = denseRide();
    const [first, second] = pressed.junctions as [number, number];
    const rider = first - 50;
    plain.route.advance(rider);
    pressed.route.advance(rider);
    expect(pressed.choice.prompt(rider)?.distance).toBe(second);
    pressed.choice.press('left', rider);
    const at = (route: RollingRoute) => route.junctionsAfter(rider);
    expect(at(pressed.route)[0]?.taken).toBe(at(plain.route)[0]?.taken);
    expect(at(pressed.route)[1]?.taken).toBe(at(pressed.route)[1]?.ways[0]?.edge.id);
    expect(at(pressed.route)[1]?.taken).not.toBe(at(plain.route)[1]?.taken);
    // Read back through the grade: nothing moved that reads no further than
    // the 2nd junction (ADR 0087 D-6.1: the grade at `s` reads to `s + 80 m`).
    for (let on = rider - 100; on <= second - JUNCTION_LOCK_METRES; on += 10) {
      expect(readAt(pressed.route, on).grade, `grade at ${on} m`).toBe(
        readAt(plain.route, on).grade,
      );
    }
  });

  it('stays on the junction last shown once its choice is final too, with none not final within reach', () => {
    const { route, choice, junctions } = denseRide();
    const fifth = junctions[4] as number;
    const sixth = junctions[5] as number;
    expect(sixth - fifth).toBeGreaterThan(JUNCTION_PROMPT_METRES - JUNCTION_LOCK_METRES);
    // Inside the 5th's lock, with the 4th still ahead and the 6th out of reach.
    const rider = fifth - 95;
    expect((junctions[3] as number) > rider).toBe(true);
    for (let at = 0; at < rider; at += 5) {
      route.advance(at);
      choice.prompt(at);
    }
    route.advance(rider);
    const shown = choice.prompt(rider);

    expect(shown?.distance).toBe(fifth);
    expect(shown?.ordinal).toBe(2);
    expect(shown?.locked).toBe(true);
    expect(shown?.tooClose).toBe(false);
  });
});

describe('too close to the last junction to choose — #3129, the owner’s Q4 ruling', () => {
  it('is said of a junction whose choice was final on the first frame it was prompted', () => {
    const { route, choice } = newRide();
    const junction = theJunction(route);
    route.advance(junction.distance - 150);
    choice.press('right', junction.distance - 150);
    const rider = junction.distance + 60;
    route.advance(rider);
    choice.press('u-turn', rider);
    const shown = choice.prompt(rider);
    expect(shown?.locked).toBe(true);
    expect(shown?.tooClose).toBe(true);
    // And still, frame after frame, until it is passed.
    expect(choice.prompt(rider + 30)?.tooClose).toBe(true);
  });

  it('is not said of a junction that was offered before its choice became final', () => {
    const { route, choice } = newRide();
    const junction = theJunction(route);
    for (let rider = junction.distance - 250; rider < junction.distance - 75; rider += 5) {
      route.advance(rider);
      const shown = choice.prompt(rider);
      expect(shown?.distance).toBe(junction.distance);
      expect(shown?.tooClose, `at ${rider} m`).toBe(false);
    }
    expect(choice.prompt(junction.distance - 80)?.locked).toBe(true);
  });
});

describe('a U-turn just past a junction rides back onto the street came along — #3129, ADR 0088 as amended', () => {
  it('within the lock, the junction ridden back to takes the way back by default, and no press changes it', () => {
    const { route, choice } = newRide();
    const junction = theJunction(route);
    const cameAlong = route.legs.find((leg) => leg.end === junction.distance)?.edge.id;
    route.advance(junction.distance - 150);
    choice.press('right', junction.distance - 150);
    const rider = junction.distance + 60;
    route.advance(rider);
    choice.press('u-turn', rider);
    const shown = choice.prompt(rider);
    expect(shown?.chosen).toBe(cameAlong);
    expect(shown?.defaultWay).toBe(cameAlong);
    choice.press('left', rider + 5);
    choice.press('straight', rider + 5);
    expect(choice.prompt(rider + 5)?.chosen).toBe(cameAlong);
    // Read back through the road ridden: past the junction, where the rider was before it.
    const back = shown?.distance as number;
    for (const on of [20, 80]) {
      expect(
        distanceBetween(
          readAt(route, back + on).position,
          readAt(route, junction.distance - on).position,
        ),
      ).toBeLessThan(0.5);
    }
  });
});
