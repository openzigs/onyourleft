// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #1820 — steering between lanes in Delivery, as a drawn lateral offset only.
 *
 * What a press does is read back where a consumer reads it: the rider's place
 * across the road off the frame `scene.ts` §`sceneFrame` builds, a crash off
 * `obstacles.ts` §`stepObstacles`, and the ride's distance and speed off
 * `simulation.ts`' own state — never off the steer state the test pressed.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';

import { airDensityKilogramsPerCubicMetre } from '@onyourleft/physics';
import {
  altitudeMetres,
  degreesCelsius,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  kilograms,
  routeProfile,
  watts,
  type RoutePoint,
} from '@onyourleft/domain';

import { RIDER_HALF_WIDTH_METRES as BICYCLE_HALF_WIDTH } from '../bicycle';
import type { RiderMarker, SceneFrame } from '../port';
import {
  LINE_HOME_OFFSET_METRES,
  LINE_LIMIT_METRES,
  lineOffsetAt,
  racingLine,
} from '../racing-line';
import { sceneFrame } from '../scene';
import { GameSimulation, atStartLine, type GameState, type SimulationSetup } from '../simulation';
import { corridorOrigin } from '../terrain';
import {
  type Crash,
  OBSTACLE_KINDS,
  OBSTACLE_SPACING_METRES,
  type Obstacle,
  RIDER_AHEAD_METRES,
  RIDER_BEHIND_METRES,
  RIDER_HALF_WIDTH_METRES,
  STANDING_OBSTACLE_SHARE,
  obstacleAcross,
  placeObstacles,
  startObstacles,
  stepObstacles,
} from './obstacles';
import {
  LANE_CHANGE_SECONDS,
  LANE_OFFSETS_METRES,
  STEER_INTENTS,
  STEER_KEYS,
  type SteerIntent,
  type SteerState,
  startSteer,
  steeredLateralFor,
  steerIntentOfKey,
  steerToward,
  stepSteer,
} from './steer';
import type { SteerInputPort } from './steer-port';
import { THROW_KEYS } from './throw-input';
import { DELIVERY_TICK_SECONDS } from './throw';

/** A straight kilometre north, gently up. */
function straight(): SimulationSetup {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 100; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(index * 0.2),
    });
  }
  return {
    profile: routeProfile(points),
    conditions: {
      totalMass: kilograms(80),
      airDensityKilogramsPerCubicMetre: airDensityKilogramsPerCubicMetre(
        altitudeMetres(0),
        degreesCelsius(15),
      ),
    },
  };
}

/** Steps `state` over `seconds` in simulation ticks, as a ride steps it. */
function stepFor(state: SteerState, seconds: number): SteerState {
  let now = state;
  for (let tick = 0; tick < Math.round(seconds / DELIVERY_TICK_SECONDS); tick += 1) {
    now = stepSteer(now, DELIVERY_TICK_SECONDS);
  }
  return now;
}

/** A key event as `steerIntentOfKey` reads one: nothing held, nothing taken, nothing focused. */
function key(name: string, extra: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: name,
    target: document.body,
    repeat: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    defaultPrevented: false,
    ...extra,
  } as KeyboardEvent;
}

describe('the keys ask for a lane change and nothing else', () => {
  it('has two intents, and the port one method that takes one', () => {
    expect([...STEER_INTENTS]).toEqual(['lane-left', 'lane-right']);
    expectTypeOf<keyof SteerInputPort>().toEqualTypeOf<'steer'>();
    expectTypeOf<Parameters<SteerInputPort['steer']>>().toEqualTypeOf<[SteerIntent]>();
    expectTypeOf<ReturnType<SteerInputPort['steer']>>().toEqualTypeOf<void>();
  });

  it('maps A to a lane left and D to a lane right, in either case', () => {
    expect(['a', 'A', 'd', 'D'].map((name) => steerIntentOfKey(key(name)))).toEqual([
      'lane-left',
      'lane-left',
      'lane-right',
      'lane-right',
    ]);
  });

  it('binds no throw key, and neither Enter nor Space', () => {
    for (const name of [...Object.keys(THROW_KEYS), 'Enter', ' ']) {
      expect(Object.hasOwn(STEER_KEYS, name)).toBe(false);
      expect(steerIntentOfKey(key(name))).toBeUndefined();
    }
  });

  it('takes no key from a field, a shortcut, a handler that took it, or a held key’s repeat', () => {
    const field = document.createElement('input');
    document.body.append(field);
    expect(steerIntentOfKey(key('d', { target: field }))).toBeUndefined();
    field.remove();
    expect(steerIntentOfKey(key('d', { ctrlKey: true }))).toBeUndefined();
    expect(steerIntentOfKey(key('d', { altKey: true }))).toBeUndefined();
    expect(steerIntentOfKey(key('d', { metaKey: true }))).toBeUndefined();
    expect(steerIntentOfKey(key('d', { defaultPrevented: true }))).toBeUndefined();
    expect(steerIntentOfKey(key('d', { repeat: true }))).toBeUndefined();
  });
});

describe('the lanes, and a smooth move between them', () => {
  it('lays three lanes inside the line’s edge, the right-hand one the line’s home', () => {
    expect(LANE_OFFSETS_METRES).toHaveLength(3);
    expect(LANE_OFFSETS_METRES[2]).toBe(LINE_HOME_OFFSET_METRES);
    expect(LANE_OFFSETS_METRES[0]).toBe(-LINE_HOME_OFFSET_METRES);
    for (const lane of LANE_OFFSETS_METRES) {
      expect(Math.abs(lane)).toBeLessThanOrEqual(LINE_LIMIT_METRES);
    }
  });

  it('starts in the lane nearest the line, from where the line is, so nothing jumps', () => {
    expect(startSteer(LINE_HOME_OFFSET_METRES)).toEqual({
      lane: 2,
      offset: LINE_HOME_OFFSET_METRES,
    });
    expect(startSteer(-2.9)).toEqual({ lane: 0, offset: -2.9 });
    expect(startSteer(0.4)).toEqual({ lane: 1, offset: 0.4 });
    expect(stepFor(startSteer(0.4), 1).offset).toBe(0);
  });

  it('moves one lane over in the proposed time, and no part of it in one tick', () => {
    let state = steerToward(startSteer(0), 'lane-right');
    expect(state.offset).toBe(0);
    const ticks = Math.round(LANE_CHANGE_SECONDS / DELIVERY_TICK_SECONDS);
    const most = (LINE_HOME_OFFSET_METRES / LANE_CHANGE_SECONDS) * DELIVERY_TICK_SECONDS;
    for (let tick = 1; tick <= ticks; tick += 1) {
      const before = state.offset;
      state = stepSteer(state, DELIVERY_TICK_SECONDS);
      expect(state.offset - before).toBeGreaterThan(0);
      expect(state.offset - before).toBeLessThanOrEqual(most + 1e-12);
      if (tick < ticks) expect(state.offset).toBeLessThan(LINE_HOME_OFFSET_METRES);
    }
    expect(state.offset).toBeCloseTo(LINE_HOME_OFFSET_METRES, 12);
    expect(stepSteer(state, DELIVERY_TICK_SECONDS).offset).toBeCloseTo(LINE_HOME_OFFSET_METRES, 12);
  });

  it('never goes beyond the line’s edge, however often it is pressed past the outermost lane', () => {
    for (const intent of STEER_INTENTS) {
      let state = startSteer(0);
      for (let press = 0; press < 20; press += 1) {
        state = steerToward(state, intent);
        for (let tick = 0; tick < 4; tick += 1) {
          state = stepSteer(state, DELIVERY_TICK_SECONDS);
          expect(Math.abs(state.offset)).toBeLessThanOrEqual(LINE_LIMIT_METRES);
        }
      }
      state = stepFor(state, 5);
      expect(state.lane).toBe(intent === 'lane-left' ? 0 : LANE_OFFSETS_METRES.length - 1);
      expect(state.offset).toBe(intent === 'lane-left' ? -1.75 : 1.75);
    }
  });

  it('turns back mid-move from where the rider is, never from a lane', () => {
    let state = stepFor(steerToward(startSteer(0), 'lane-right'), 0.2);
    const midway = state.offset;
    expect(midway).toBeGreaterThan(0.5);
    state = stepSteer(steerToward(state, 'lane-left'), DELIVERY_TICK_SECONDS);
    expect(state.offset).toBeLessThan(midway);
    expect(state.offset).toBeGreaterThan(midway - 0.5);
  });

  it('refuses a bad step or start by naming the constraint, never the value', () => {
    expect(() => stepSteer(startSteer(0), -0.05)).toThrow(
      'Delivery steering: a step is a finite number of seconds not below zero',
    );
    expect(() => stepSteer(startSteer(0), Number.NaN)).toThrow(/finite number of seconds/);
    expect(() => startSteer(Number.POSITIVE_INFINITY)).toThrow(
      'Delivery steering: the starting offset is a finite number of metres',
    );
  });
});

describe('a drawing only: steering never moves the simulated ride (DL5)', () => {
  /** Watts each second of a two-minute ride: a wave, so the speed changes. */
  const POWER = Array.from({ length: 120 }, (_, second) => 150 + 100 * Math.sin(second / 7));

  function ride(presses: boolean): { trace: [number, number][]; state: GameState } {
    const simulation = new GameSimulation(straight());
    let steer = startSteer(LINE_HOME_OFFSET_METRES);
    const trace: [number, number][] = [];
    const startMs = 1_000_000;
    for (let frame = 0; frame <= 120 * 20; frame += 1) {
      const nowMs = startMs + frame * 50;
      const power = POWER[Math.min(POWER.length - 1, Math.floor(frame / 20))] as number;
      if (presses && frame % 30 === 0) {
        steer = steerToward(steer, frame % 60 === 0 ? 'lane-left' : 'lane-right');
      }
      steer = stepSteer(steer, DELIVERY_TICK_SECONDS);
      simulation.advanceTo(nowMs, { power: watts(power), live: true });
      trace.push([simulation.state.ride.distance, simulation.state.ride.speed]);
    }
    return { trace, state: simulation.state };
  }

  it('rides the same power trace to the same distance and speed on every tick, pressed or not', () => {
    const still = ride(false);
    const steered = ride(true);
    expect(steered.trace[steered.trace.length - 1]?.[0]).toBeGreaterThan(500);
    expect(steered.trace).toEqual(still.trace);
  });

  it('keeps no lateral offset, lane or steer in the simulation’s state', () => {
    const names: string[] = [];
    const walk = (value: unknown): void => {
      if (value === null || typeof value !== 'object') return;
      for (const [name, inner] of Object.entries(value)) {
        names.push(name);
        walk(inner);
      }
    };
    walk(ride(true).state);
    expect(names.length).toBeGreaterThan(5);
    expect(names.filter((name) => /lateral|lane|steer|offset|across/i.test(name))).toEqual([]);
  });
});

describe('a lane press reaches the drawing — read off the frame scene.ts builds', () => {
  const { profile } = straight();
  const origin = corridorOrigin(profile);
  const AT = 400;
  const state: GameState = {
    ...atStartLine(profile),
    ride: { ...atStartLine(profile).ride, distance: AT as GameState['ride']['distance'] },
  };

  function frame(steeredLateral?: number): SceneFrame {
    return sceneFrame({ profile, origin, state, steeredLateral });
  }

  function rider(of: SceneFrame): RiderMarker {
    const found = of.markers.find((marker) => marker.kind === 'rider');
    if (found === undefined) throw new Error('no rider in the frame');
    return found;
  }

  /** How far the rider is drawn across the road, from the frame's own corridor: positive to their right. */
  function drawnAcross(of: SceneFrame): number {
    const marker = rider(of);
    const centre = of.corridor.centre;
    for (let index = 0; index < centre.length - 1; index += 1) {
      const from = centre[index];
      const to = centre[index + 1];
      if (from === undefined || to === undefined || to.along < AT) continue;
      const t = (AT - from.along) / (to.along - from.along);
      const x = from.x + (to.x - from.x) * t;
      const z = from.z + (to.z - from.z) * t;
      return (marker.x - x) * -marker.headingZ + (marker.z - z) * marker.headingX;
    }
    throw new Error('outside the corridor');
  }

  it('moves the drawn rider a lane to the left after a lane-left press, and back after a lane-right', () => {
    const line = lineOffsetAt(racingLine(profile), AT);
    let steer = startSteer(line);
    const before = drawnAcross(frame(steeredLateralFor(steer, { inRoom: false })));
    expect(before).toBeCloseTo(LINE_HOME_OFFSET_METRES, 2);
    // No press: the frame draws the rider where the line does.
    expect(before).toBeCloseTo(drawnAcross(frame()), 9);

    steer = stepFor(steerToward(steer, 'lane-left'), LANE_CHANGE_SECONDS);
    const after = drawnAcross(frame(steeredLateralFor(steer, { inRoom: false })));
    expect(after).toBeCloseTo(0, 6);

    steer = stepFor(steerToward(steer, 'lane-right'), LANE_CHANGE_SECONDS);
    expect(drawnAcross(frame(steeredLateralFor(steer, { inRoom: false })))).toBeCloseTo(
      LINE_HOME_OFFSET_METRES,
      6,
    );
  });

  it('ignores steering on a room ride: the rider is drawn on the line (DL9)', () => {
    const steer = stepFor(steerToward(startSteer(LINE_HOME_OFFSET_METRES), 'lane-left'), 1);
    expect(steeredLateralFor(steer, { inRoom: true })).toBeUndefined();
    const inRoom = rider(frame(steeredLateralFor(steer, { inRoom: true })));
    expect(inRoom).toEqual(rider(frame()));
    expect(steeredLateralFor(undefined, { inRoom: false })).toBeUndefined();
  });
});

/** Ride `obstacles` at `speed` on the tick, steering as `pressAt` says, and report the crashes. */
function rideSteering(
  obstacles: readonly Obstacle[],
  speed: number,
  steer: SteerState,
  pressAt?: { readonly along: number; readonly intent: SteerIntent },
): Crash[] {
  let along = 0;
  let lane = steer;
  let pressed = false;
  let state = startObstacles(obstacles);
  const crashes: Crash[] = [];
  const last = Math.max(...obstacles.map((obstacle) => obstacle.along));
  while (along < last + 5) {
    along += speed * DELIVERY_TICK_SECONDS;
    if (pressAt !== undefined && !pressed && along >= pressAt.along) {
      lane = steerToward(lane, pressAt.intent);
      pressed = true;
    }
    lane = stepSteer(lane, DELIVERY_TICK_SECONDS);
    const step = stepObstacles(state, {
      rider: { along, lateral: lane.offset, speed },
      obstacles,
    });
    state = step.state;
    crashes.push(...step.crashes);
  }
  return crashes;
}

describe('a lane change reaches the obstacles', () => {
  const BIN_IN_THE_RIGHT_LANE: Obstacle = { kind: 'bin', along: 300, stands: 1.75 };

  it('stands where it is placed at every moment', () => {
    for (const seconds of [0, 1, 10, 100]) {
      expect(obstacleAcross(BIN_IN_THE_RIGHT_LANE, seconds)).toBe(1.75);
    }
  });

  it('crashes a rider who stays in its lane', () => {
    expect(rideSteering([BIN_IN_THE_RIGHT_LANE], 8, startSteer(1.75))).toHaveLength(1);
  });

  it('lets a rider who changes lane pass it, and crashes nobody in another lane', () => {
    for (const intent of STEER_INTENTS) {
      expect(
        rideSteering([BIN_IN_THE_RIGHT_LANE], 8, startSteer(1.75), { along: 250, intent }),
      ).toEqual(intent === 'lane-left' ? [] : [{ scoreDelta: -1 }]);
    }
    expect(rideSteering([BIN_IN_THE_RIGHT_LANE], 8, startSteer(0))).toEqual([]);
  });

  it('has lanes far enough apart that a rider in one clears an obstacle in the next', () => {
    const widest = Math.max(...Object.values(OBSTACLE_KINDS).map((shape) => shape.halfWidth));
    expect(RIDER_HALF_WIDTH_METRES).toBe(BICYCLE_HALF_WIDTH);
    for (let lane = 1; lane < LANE_OFFSETS_METRES.length; lane += 1) {
      const gap = (LANE_OFFSETS_METRES[lane] as number) - (LANE_OFFSETS_METRES[lane - 1] as number);
      expect(gap).toBeGreaterThan(widest + RIDER_HALF_WIDTH_METRES);
    }
  });
});

describe('every lane layout is passable', () => {
  const ROUND = { from: 0, to: 5000 };
  const SEEDS = Array.from({ length: 200 }, (_, index) => (index * 2_654_435_761) >>> 0);

  /** The lanes a rider in which would touch a standing obstacle at `obstacle`'s distance. */
  function blockedLanes(placed: readonly Obstacle[], obstacle: Obstacle): Set<number> {
    const blocked = new Set<number>();
    for (const other of placed) {
      if (other.stands === undefined) continue;
      const shape = OBSTACLE_KINDS[other.kind];
      const near =
        obstacle.along + RIDER_AHEAD_METRES > other.along - shape.halfLength &&
        other.along + shape.halfLength > obstacle.along - RIDER_BEHIND_METRES;
      if (!near) continue;
      LANE_OFFSETS_METRES.forEach((lane, index) => {
        if (Math.abs(lane - other.stands) < shape.halfWidth + RIDER_HALF_WIDTH_METRES) {
          blocked.add(index);
        }
      });
    }
    return blocked;
  }

  it('leaves at least one lane clear at every obstacle’s distance, on every seed', () => {
    let standing = 0;
    const lanes = new Set<number>();
    for (const seed of SEEDS) {
      const placed = placeObstacles(ROUND, seed, 'normal', true);
      expect(placed).toHaveLength(Math.floor(ROUND.to / OBSTACLE_SPACING_METRES));
      for (const obstacle of placed) {
        expect(blockedLanes(placed, obstacle).size).toBeLessThan(LANE_OFFSETS_METRES.length);
        if (obstacle.stands !== undefined) {
          standing += 1;
          lanes.add(LANE_OFFSETS_METRES.indexOf(obstacle.stands));
        }
      }
    }
    // Some stand, in every lane, and about the share proposed.
    expect(lanes).toEqual(new Set([0, 1, 2]));
    const share = standing / (SEEDS.length * Math.floor(ROUND.to / OBSTACLE_SPACING_METRES));
    expect(Math.abs(share - STANDING_OBSTACLE_SHARE)).toBeLessThan(0.05);
  });

  it('gives a rider at the fastest speed time to cross two lanes between two standing obstacles', () => {
    for (const seed of SEEDS) {
      const standing = placeObstacles(ROUND, seed, 'normal', true).filter(
        (obstacle) => obstacle.stands !== undefined,
      );
      for (let index = 1; index < standing.length; index += 1) {
        const gap = (standing[index] as Obstacle).along - (standing[index - 1] as Obstacle).along;
        expect(gap / 12).toBeGreaterThan(2 * LANE_CHANGE_SECONDS);
      }
    }
  });

  it('places no standing obstacle on a round the rider cannot steer, and the same ones as before', () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const unsteered = placeObstacles(ROUND, seed);
      expect(unsteered.every((obstacle) => obstacle.stands === undefined)).toBe(true);
      expect(placeObstacles(ROUND, seed, 'normal', false)).toEqual(unsteered);
      // Steering changes which stand, never where or what each is.
      const steered = placeObstacles(ROUND, seed, 'normal', true);
      expect(steered.map(({ along, kind }) => ({ along, kind }))).toEqual(
        unsteered.map(({ along, kind }) => ({ along, kind })),
      );
    }
  });

  it('still thins standing obstacles with the assist: fewer keeps the same slots, none places none', () => {
    const steered = placeObstacles(ROUND, 7, 'normal', true);
    expect(placeObstacles(ROUND, 7, 'fewer', true)).toEqual(
      steered.filter((_, slot) => slot % 2 === 0),
    );
    expect(placeObstacles(ROUND, 7, 'none', true)).toEqual([]);
  });
});
