// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { SIMULATION_STEP_SECONDS } from '../simulation';
import { ROAD_WIDTH_METRES } from '../terrain';
import { TARGET_WINDOW_HALF_METRES } from './targets';
import { endRound, FRESH_WEEK, recordMiss, type Round, startRound } from './round';
import {
  ASSISTED_THROW_SCALE,
  CARRIAGEWAY_HALF_WIDTH_METRES,
  DELIVERY_TICK_SECONDS,
  type Landing,
  NO_PARCELS,
  PARCEL_FLIGHT_SECONDS,
  PARCEL_FLIGHT_TICKS,
  PARCEL_THROW_SPEED_METRES_PER_SECOND,
  stepThrows,
  TARGET_CATCH_RADIUS_METRES,
  THROW_COOLDOWN_SECONDS,
  THROW_COOLDOWN_TICKS,
  THROW_WINDOW_AFTER_METRES,
  THROW_WINDOW_BEFORE_METRES,
  type ThrowSide,
  type ThrowState,
  type ThrowTarget,
} from './throw';

/** Seconds from the throw until a parcel reaches a target `clear` metres off the carriageway. */
function secondsToReach(clear: number): number {
  return (CARRIAGEWAY_HALF_WIDTH_METRES + clear) / PARCEL_THROW_SPEED_METRES_PER_SECOND;
}

/** A doorstep 1.6 m off the carriageway: 5.1 m from the centre, reached 0.51 s after the throw. */
const NEAR_CLEAR = 1.6;

interface Rider {
  readonly along: number;
  readonly speed: number;
}

/**
 * Throw once from `rider`, then step `perCall` ticks a call until the parcel
 * has landed, and return every landing and the round as the last step left it.
 */
function throwAndFly(
  rider: Rider,
  side: ThrowSide,
  targets: readonly ThrowTarget[],
  round: Round,
  perCall = 1,
  widerWindows?: boolean,
): { landings: Landing[]; round: Round; state: ThrowState } {
  const landings: Landing[] = [];
  let state = NO_PARCELS;
  let throwTo: ThrowSide | undefined = side;
  for (let called = 0; called * perCall <= PARCEL_FLIGHT_TICKS; called += 1) {
    const step = stepThrows(state, {
      rider,
      targets,
      round,
      throwTo,
      ticks: perCall,
      ...(widerWindows === undefined ? {} : { widerWindows }),
    });
    if (throwTo !== undefined) expect(step.thrown).toBe(true);
    throwTo = undefined;
    state = step.state;
    round = step.round;
    landings.push(...step.landings);
  }
  return { landings, round, state };
}

describe('the Delivery parcel throw — #1809, DL1 and DL2', () => {
  it('runs on the game simulation’s own tick, over the drawn road', () => {
    expect(DELIVERY_TICK_SECONDS).toBe(SIMULATION_STEP_SECONDS);
    expect(CARRIAGEWAY_HALF_WIDTH_METRES).toBe(ROAD_WIDTH_METRES / 2);
    expect(PARCEL_FLIGHT_TICKS).toBe(Math.round(PARCEL_FLIGHT_SECONDS / DELIVERY_TICK_SECONDS));
    expect(THROW_COOLDOWN_TICKS).toBe(Math.round(THROW_COOLDOWN_SECONDS / DELIVERY_TICK_SECONDS));
  });

  it('lands a parcel that reaches no target after its whole flight, carried forward by the rider’s speed', () => {
    const { landings, state } = throwAndFly({ along: 100, speed: 10 }, 'right', [], startRound(1));
    expect(landings).toHaveLength(1);
    const [landing] = landings;
    expect(landing?.kind).toBe('wasted');
    expect(landing?.side).toBe('right');
    expect(landing?.tick).toBe(PARCEL_FLIGHT_TICKS);
    // 24 ticks of 0.05 s is 1.2 s: 12 m forward at 10 m/s, 12 m sideways at 10 m/s.
    expect(landing?.along).toBeCloseTo(112, 9);
    expect(landing?.across).toBeCloseTo(12, 9);
    expect(state.inFlight).toEqual([]);
  });

  it('delivers to the target the parcel reaches, at the tick it reaches it', () => {
    const targets: ThrowTarget[] = [{ position: 0, along: 110, side: 'right', clear: NEAR_CLEAR }];
    const { landings, round } = throwAndFly(
      { along: 105, speed: 10 },
      'right',
      targets,
      startRound(1),
    );
    expect(landings).toHaveLength(1);
    expect(landings[0]).toMatchObject({ kind: 'delivery', position: 0, side: 'right' });
    // 0.51 s to reach 5.1 m sideways, so 5.1 m forward of the throw.
    expect(landings[0]?.along).toBeCloseTo(110.1, 9);
    expect(landings[0]?.across).toBeCloseTo(CARRIAGEWAY_HALF_WIDTH_METRES + NEAR_CLEAR, 9);
    expect(landings[0]?.tick).toBe(Math.ceil(secondsToReach(NEAR_CLEAR) / DELIVERY_TICK_SECONDS));
    // Read back through the round's own consumer: the house is delivered and scores.
    expect(round.houses).toEqual(['delivered']);
    expect(endRound(FRESH_WEEK, round)).toMatchObject({ delivered: 1, perfect: true });
  });

  it('delivers to a doorstep whose depth the parcel reaches exactly at the end of a tick', () => {
    // 1.5 m off the carriageway is 5 m from the centre: exactly ten ticks of 0.5 m sideways.
    const clear = 1.5;
    expect(secondsToReach(clear) / DELIVERY_TICK_SECONDS).toBeCloseTo(10, 12);
    const targets: ThrowTarget[] = [{ position: 0, along: 110, side: 'right', clear }];
    const { landings } = throwAndFly({ along: 105, speed: 10 }, 'right', targets, startRound(1));
    expect(landings).toMatchObject([{ kind: 'delivery', position: 0, tick: 10 }]);
    expect(landings[0]?.along).toBeCloseTo(110, 9);
  });

  it('makes a fast rider throw earlier: the same throw at twice the speed lands past the house', () => {
    const targets: ThrowTarget[] = [{ position: 0, along: 110, side: 'right', clear: NEAR_CLEAR }];
    const slow = throwAndFly({ along: 105, speed: 10 }, 'right', targets, startRound(1));
    const fast = throwAndFly({ along: 105, speed: 20 }, 'right', targets, startRound(1));

    expect(slow.landings.map((landing) => landing.kind)).toEqual(['delivery']);
    expect(slow.round.houses).toEqual(['delivered']);

    expect(fast.landings.map((landing) => landing.kind)).toEqual(['wasted']);
    expect(fast.landings[0]?.along).toBeGreaterThan(110 + TARGET_CATCH_RADIUS_METRES);
    expect(fast.round.houses).toEqual(['expecting']);
  });

  it('wastes a parcel that reaches the doorstep’s depth outside the catch radius', () => {
    // Crosses the doorstep's depth 1.6 m short of it, just outside the 1.5 m radius.
    const targets: ThrowTarget[] = [{ position: 0, along: 110, side: 'right', clear: NEAR_CLEAR }];
    const short = throwAndFly({ along: 103.3, speed: 10 }, 'right', targets, startRound(1));
    expect(short.landings.map((landing) => landing.kind)).toEqual(['wasted']);
    const near = throwAndFly({ along: 103.5, speed: 10 }, 'right', targets, startRound(1));
    expect(near.landings.map((landing) => landing.kind)).toEqual(['delivery']);
  });

  describe('honours the throw window both ways', () => {
    // A deep doorstep, reached 1.19 s after the throw, so a fast rider can reach it from far back.
    const deep = 8.4;
    const targets: ThrowTarget[] = [{ position: 0, along: 100, side: 'right', clear: deep }];
    const opens = 100 - THROW_WINDOW_BEFORE_METRES;
    const closes = 100 + THROW_WINDOW_AFTER_METRES;
    /** The speed that carries a throw from `along` exactly onto the doorstep. */
    const onTarget = (along: number): Rider => ({
      along,
      speed: (100 - along) / secondsToReach(deep),
    });

    it('wastes a throw just before the window opens, though it would reach the doorstep', () => {
      const { landings, round } = throwAndFly(
        onTarget(opens - 0.1),
        'right',
        targets,
        startRound(1),
      );
      expect(landings.map((landing) => landing.kind)).toEqual(['wasted']);
      expect(round.houses).toEqual(['expecting']);
    });

    it('delivers a throw just inside the window’s opening', () => {
      const { landings } = throwAndFly(onTarget(opens + 0.1), 'right', targets, startRound(1));
      expect(landings).toMatchObject([{ kind: 'delivery', position: 0 }]);
      expect(landings[0]?.along).toBeCloseTo(100, 9);
    });

    it('wastes a throw just after the window closes, though it lands inside the catch radius', () => {
      expect(THROW_WINDOW_AFTER_METRES + 0.1).toBeLessThan(TARGET_CATCH_RADIUS_METRES);
      const stopped: Rider = { along: closes + 0.1, speed: 0 };
      const { landings, round } = throwAndFly(stopped, 'right', targets, startRound(1));
      expect(landings.map((landing) => landing.kind)).toEqual(['wasted']);
      expect(round.houses).toEqual(['expecting']);
    });

    it('delivers a throw just before the window closes', () => {
      const stopped: Rider = { along: closes - 0.1, speed: 0 };
      const { landings } = throwAndFly(stopped, 'right', targets, startRound(1));
      expect(landings).toMatchObject([{ kind: 'delivery', position: 0 }]);
    });
  });

  describe('delivers once per house', () => {
    const targets: ThrowTarget[] = [{ position: 0, along: 100, side: 'right', clear: NEAR_CLEAR }];
    const stopped: Rider = { along: 100.5, speed: 0 };

    it('wastes a second parcel onto a house already delivered', () => {
      let state = NO_PARCELS;
      let round = startRound(1);
      const landings: Landing[] = [];
      for (let tick = 0; tick <= PARCEL_FLIGHT_TICKS * 2; tick += 1) {
        const throwTo = tick === 0 || tick === THROW_COOLDOWN_TICKS ? 'right' : undefined;
        const step = stepThrows(state, { rider: stopped, targets, round, throwTo });
        if (throwTo !== undefined) expect(step.thrown).toBe(true);
        state = step.state;
        round = step.round;
        landings.push(...step.landings);
      }
      expect(landings.map((landing) => landing.kind)).toEqual(['delivery', 'wasted']);
      expect(endRound(FRESH_WEEK, round)).toMatchObject({ delivered: 1, weekScore: 1 });
    });

    it('wastes a parcel onto a house already missed', () => {
      const missed = recordMiss(startRound(1), 0);
      const { landings, round } = throwAndFly(stopped, 'right', targets, missed);
      expect(landings.map((landing) => landing.kind)).toEqual(['wasted']);
      expect(round.houses).toEqual(['missed']);
    });
  });

  describe('honours the side', () => {
    const both: ThrowTarget[] = [
      { position: 0, along: 110, side: 'left', clear: NEAR_CLEAR },
      { position: 1, along: 110, side: 'right', clear: NEAR_CLEAR },
    ];
    const rider: Rider = { along: 105, speed: 10 };

    it('delivers a throw to the right to the house on the right, never the one on the left', () => {
      const { landings, round } = throwAndFly(rider, 'right', both, startRound(2));
      expect(landings).toMatchObject([{ kind: 'delivery', position: 1, side: 'right' }]);
      expect(round.houses).toEqual(['expecting', 'delivered']);
    });

    it('delivers a throw to the left to the house on the left, never the one on the right', () => {
      const { landings, round } = throwAndFly(rider, 'left', both, startRound(2));
      expect(landings).toMatchObject([{ kind: 'delivery', position: 0, side: 'left' }]);
      expect(round.houses).toEqual(['delivered', 'expecting']);
    });

    it('wastes a throw to the right where the only house is on the left', () => {
      const leftOnly = both.filter((target) => target.side === 'left');
      const { landings, round } = throwAndFly(rider, 'right', leftOnly, startRound(2));
      expect(landings.map((landing) => landing.kind)).toEqual(['wasted']);
      expect(round.houses).toEqual(['expecting', 'expecting']);
    });
  });

  it.each([
    ['nearer listed first', false],
    ['nearer listed last', true],
  ])('delivers to the nearer of two houses a parcel reaches in one tick (%s)', (_, reversed) => {
    // Both doorsteps are crossed in the same tick; the parcel stops at the first it reaches.
    const nearer: ThrowTarget = { position: 1, along: 110.1, side: 'right', clear: 1.6 };
    const deeper: ThrowTarget = { position: 0, along: 110.12, side: 'right', clear: 1.62 };
    const targets = reversed ? [deeper, nearer] : [nearer, deeper];
    const { landings, round } = throwAndFly(
      { along: 105, speed: 10 },
      'right',
      targets,
      startRound(2),
    );
    expect(landings).toMatchObject([{ kind: 'delivery', position: 1 }]);
    expect(round.houses).toEqual(['expecting', 'delivered']);
  });

  it('cannot be changed by the frame rate: one tick a call and four ticks a call land the same', () => {
    const targets: ThrowTarget[] = [
      { position: 0, along: 110, side: 'right', clear: NEAR_CLEAR },
      { position: 1, along: 130, side: 'left', clear: 4 },
    ];
    const ride = (perCall: number): Landing[] => {
      let state = NO_PARCELS;
      let round = startRound(2);
      const landings: Landing[] = [];
      for (let tick = 0; tick <= PARCEL_FLIGHT_TICKS * 3; tick += perCall) {
        // The rider holds 10 m/s from 105 m; it throws right at tick 0 and left at tick 12.
        const rider: Rider = { along: 105 + tick * DELIVERY_TICK_SECONDS * 10, speed: 10 };
        const throwTo: ThrowSide | undefined =
          tick === 0 ? 'right' : tick === 12 ? 'left' : undefined;
        const step = stepThrows(state, { rider, targets, round, throwTo, ticks: perCall });
        if (throwTo !== undefined) expect(step.thrown).toBe(true);
        state = step.state;
        round = step.round;
        landings.push(...step.landings);
      }
      return landings;
    };
    const oneByOne = ride(1);
    expect(oneByOne.map((landing) => landing.kind)).toEqual(['delivery', 'wasted']);
    expect(ride(4)).toEqual(oneByOne);
  });

  describe('the cool-down', () => {
    const rider: Rider = { along: 100, speed: 10 };

    it('refuses a throw inside it and puts no parcel in flight', () => {
      let state = stepThrows(NO_PARCELS, {
        rider,
        targets: [],
        round: startRound(1),
        throwTo: 'right',
      }).state;
      expect(state.inFlight).toHaveLength(1);
      const landings: Landing[] = [];
      for (let tick = 1; tick <= PARCEL_FLIGHT_TICKS * 2; tick += 1) {
        const throwTo = tick === THROW_COOLDOWN_TICKS - 1 ? 'left' : undefined;
        const step = stepThrows(state, { rider, targets: [], round: startRound(1), throwTo });
        if (throwTo !== undefined) {
          expect(step.thrown).toBe(false);
          expect(step.state.inFlight).toEqual(state.inFlight);
        }
        state = step.state;
        landings.push(...step.landings);
      }
      expect(landings).toHaveLength(1);
      expect(landings[0]?.side).toBe('right');
    });

    it('takes a throw once it has run', () => {
      let state = stepThrows(NO_PARCELS, {
        rider,
        targets: [],
        round: startRound(1),
        throwTo: 'right',
      }).state;
      state = stepThrows(state, {
        rider,
        targets: [],
        round: startRound(1),
        ticks: THROW_COOLDOWN_TICKS - 1,
      }).state;
      const step = stepThrows(state, { rider, targets: [], round: startRound(1), throwTo: 'left' });
      expect(step.thrown).toBe(true);
      expect(step.state.inFlight.map((parcel) => parcel.side)).toEqual(['right', 'left']);
    });
  });

  it('throws without advancing when a step runs no tick, and the parcel flies from where it was thrown', () => {
    const round = startRound(1);
    const thrown = stepThrows(NO_PARCELS, {
      rider: { along: 100, speed: 10 },
      targets: [],
      round,
      throwTo: 'right',
      ticks: 0,
    });
    expect(thrown.thrown).toBe(true);
    expect(thrown.state.tick).toBe(0);
    expect(thrown.landings).toEqual([]);
    // The rider has moved on by the next call; the parcel keeps the throw's distance and speed.
    const flown = stepThrows(thrown.state, {
      rider: { along: 150, speed: 0 },
      targets: [],
      round,
      ticks: PARCEL_FLIGHT_TICKS,
    });
    expect(flown.landings).toHaveLength(1);
    expect(flown.landings[0]?.along).toBeCloseTo(112, 9);
  });

  it.each([-1, 1.5, Number.NaN])('refuses a step of %s ticks', (ticks) => {
    expect(() =>
      stepThrows(NO_PARCELS, {
        rider: { along: 0, speed: 0 },
        targets: [],
        round: startRound(1),
        ticks,
      }),
    ).toThrow(RangeError);
  });

  it('leaves the state and round it was handed unchanged', () => {
    const targets: ThrowTarget[] = [{ position: 0, along: 110, side: 'right', clear: NEAR_CLEAR }];
    const round = startRound(1);
    const first = stepThrows(NO_PARCELS, {
      rider: { along: 105, speed: 10 },
      targets,
      round,
      throwTo: 'right',
    });
    const before = structuredClone(first.state);
    stepThrows(first.state, {
      rider: { along: 105, speed: 10 },
      targets,
      round,
      ticks: PARCEL_FLIGHT_TICKS,
    });
    expect(first.state).toEqual(before);
    expect(round.houses).toEqual(['expecting']);
    expect(NO_PARCELS).toEqual({ tick: 0, readyAt: 0, inFlight: [] });
  });
});

describe('the assist setting’s wider windows — #1813, DL10', () => {
  const wider = TARGET_CATCH_RADIUS_METRES * ASSISTED_THROW_SCALE;
  const closesWider = 100 + THROW_WINDOW_AFTER_METRES * ASSISTED_THROW_SCALE;

  it('keeps its windows inside the road each house reserves, and the closing edge inside the catch', () => {
    expect(ASSISTED_THROW_SCALE).toBeGreaterThan(1);
    expect(wider).toBe(4.5);
    expect(THROW_WINDOW_AFTER_METRES * ASSISTED_THROW_SCALE).toBe(3);
    expect(THROW_WINDOW_AFTER_METRES * ASSISTED_THROW_SCALE).toBeLessThan(wider);
    expect(THROW_WINDOW_AFTER_METRES * ASSISTED_THROW_SCALE).toBeLessThanOrEqual(
      TARGET_WINDOW_HALF_METRES,
    );
    expect(THROW_WINDOW_BEFORE_METRES).toBeLessThanOrEqual(TARGET_WINDOW_HALF_METRES);
  });

  it('catches a parcel up to three times as far from the doorstep, and no farther', () => {
    const targets: ThrowTarget[] = [{ position: 0, along: 110, side: 'right', clear: NEAR_CLEAR }];
    // The parcel crosses the doorstep's depth 5.1 m forward of the throw at 10 m/s.
    const shortBy = (gap: number): Rider => ({ along: 110 - 5.1 - gap, speed: 10 });
    const outside = throwAndFly(shortBy(wider + 0.1), 'right', targets, startRound(1), 1, true);
    expect(outside.landings.map((landing) => landing.kind)).toEqual(['wasted']);
    const inside = throwAndFly(shortBy(wider - 0.1), 'right', targets, startRound(1), 1, true);
    expect(inside.landings.map((landing) => landing.kind)).toEqual(['delivery']);
    expect(inside.round.houses).toEqual(['delivered']);
    // …and the same throw at the default is wasted: the assist is what delivered it.
    const usual = throwAndFly(shortBy(wider - 0.1), 'right', targets, startRound(1));
    expect(usual.landings.map((landing) => landing.kind)).toEqual(['wasted']);
  });

  it('closes the window three times as far past the house', () => {
    const targets: ThrowTarget[] = [{ position: 0, along: 100, side: 'right', clear: 8.4 }];
    const before = throwAndFly(
      { along: closesWider - 0.1, speed: 0 },
      'right',
      targets,
      startRound(1),
      1,
      true,
    );
    expect(before.landings).toMatchObject([{ kind: 'delivery', position: 0 }]);
    const after = throwAndFly(
      { along: closesWider + 0.1, speed: 0 },
      'right',
      targets,
      startRound(1),
      1,
      true,
    );
    expect(after.landings.map((landing) => landing.kind)).toEqual(['wasted']);
  });

  it('does not open the window any earlier, which would reach into the house before', () => {
    const deep = 8.4;
    const targets: ThrowTarget[] = [{ position: 0, along: 100, side: 'right', clear: deep }];
    const from = 100 - THROW_WINDOW_BEFORE_METRES - 0.1;
    const rider: Rider = { along: from, speed: (100 - from) / secondsToReach(deep) };
    const { landings } = throwAndFly(rider, 'right', targets, startRound(1), 1, true);
    expect(landings.map((landing) => landing.kind)).toEqual(['wasted']);
  });
});
