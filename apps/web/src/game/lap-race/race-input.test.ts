// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #1901 — a lap race's lane changes and item uses, as race inputs only.
 *
 * What a press does is read back where a consumer reads it: the lane and the
 * held item off the race state `@onyourleft/domain` §`stepRace` returns, and
 * the ride's distance and speed off `simulation.ts`' own state and the race's
 * `effortDistance` — never off the inputs the test pressed. The shape is
 * `delivery/steer.test.ts`' "a drawing only" ride (DL5).
 */

import {
  altitudeMetres,
  createItemRace,
  degreesCelsius,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  kilograms,
  LANE_COUNT,
  raceCourse,
  routeProfile,
  STARTING_LANE,
  stepRace,
  watts,
  type ItemRaceState,
  type LapRacer,
  type RoutePoint,
} from '@onyourleft/domain';
import { airDensityKilogramsPerCubicMetre } from '@onyourleft/physics';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { LANE_OFFSETS_METRES, STEER_KEYS, type SteerIntent, type SteerKeyEvent } from '../lanes';
import { THROW_KEYS } from '../delivery/throw-input';
import { GameSimulation, type SimulationSetup } from '../simulation';
import { asksForItem, ITEM_CODES, ITEM_KEYS } from './item-input';
import type { ItemInputPort } from './item-input-port';
import {
  askLane,
  askToUseItem,
  riderTick,
  startRiderInput,
  stepRiderInput,
  type RiderRaceInput,
} from './race-input';

/** A kilometre out and back, so its two ends meet and it is a loop (as `race-laps.test.ts`). */
function loop(): SimulationSetup {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 100; index += 1) {
    const out = index <= 50 ? index : 100 - index;
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (out * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(out * 0.4),
    });
  }
  return {
    profile: routeProfile(points, { loop: true }),
    conditions: {
      totalMass: kilograms(80),
      airDensityKilogramsPerCubicMetre: airDensityKilogramsPerCubicMetre(
        altitudeMetres(0),
        degreesCelsius(15),
      ),
    },
  };
}

/** A key event as `asksForItem` reads one: nothing held, nothing taken, nothing focused. */
function key(name: string, extra: Partial<SteerKeyEvent> = {}): SteerKeyEvent {
  return {
    key: name,
    code: '',
    target: document.body,
    repeat: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    defaultPrevented: false,
    ...extra,
  };
}

const RIDER = 'rider';
const BOT = 'bot';

const rider = (race: ItemRaceState): LapRacer =>
  race.racers.find((each) => each.racer.id === RIDER) as LapRacer;

describe('an item input asks to use the held item and nothing else', () => {
  it('gives the port one method, which takes nothing and returns nothing', () => {
    expectTypeOf<keyof ItemInputPort>().toEqualTypeOf<'useItem'>();
    expectTypeOf<Parameters<ItemInputPort['useItem']>>().toEqualTypeOf<[]>();
    expectTypeOf<ReturnType<ItemInputPort['useItem']>>().toEqualTypeOf<void>();
  });

  it('uses the item on W, in either case and by the physical key, and on nothing else', () => {
    expect(asksForItem(key('w'))).toBe(true);
    expect(asksForItem(key('W'))).toBe(true);
    // An AZERTY layout's key in W's place types Z.
    expect(asksForItem(key('z', { code: 'KeyW' }))).toBe(true);
    for (const name of ['a', 'd', 'Enter', ' ', 'ArrowUp', 'PageUp', 'q']) {
      expect(asksForItem(key(name, { code: 'KeyQ' })), name).toBe(false);
    }
  });

  it('binds no lane key, no throw key, and neither Enter nor Space', () => {
    const items = [...Object.keys(ITEM_KEYS), ...Object.keys(ITEM_CODES)];
    for (const each of [...Object.keys(STEER_KEYS), ...Object.keys(THROW_KEYS), 'Enter', ' ']) {
      expect(items, each).not.toContain(each);
    }
    expect(Object.keys(ITEM_CODES)).not.toContain('KeyA');
    expect(Object.keys(ITEM_CODES)).not.toContain('KeyD');
  });

  it('takes no key from a field, a shortcut, a handler that took it, or a held key’s repeat', () => {
    const field = document.createElement('input');
    document.body.append(field);
    try {
      expect(asksForItem(key('w', { target: field }))).toBe(false);
    } finally {
      field.remove();
    }
    expect(asksForItem(key('w', { ctrlKey: true }))).toBe(false);
    expect(asksForItem(key('w', { altKey: true }))).toBe(false);
    expect(asksForItem(key('w', { metaKey: true }))).toBe(false);
    expect(asksForItem(key('w', { defaultPrevented: true }))).toBe(false);
    expect(asksForItem(key('w', { repeat: true }))).toBe(false);
  });
});

describe('the rider’s inputs reach the race as inputs (ADR 0060 D-5.4)', () => {
  it('steers the lanes the race has: Delivery’s three, left to right', () => {
    expect(LANE_OFFSETS_METRES).toHaveLength(LANE_COUNT);
    const start = startRiderInput(1.75);
    expect(start.steer.lane).toBe(STARTING_LANE);
    // Drawn where the racing line had them, easing to the lane: nothing jumps.
    expect(start.steer.offset).toBe(1.75);
    expect(stepRiderInput(start, 10).steer.offset).toBe(LANE_OFFSETS_METRES[STARTING_LANE]);

    const left = askLane(askLane(start, 'lane-left'), 'lane-left');
    expect(riderTick(left, RIDER).lanes).toEqual({ [RIDER]: 0 });
    const right = askLane(askLane(askLane(left, 'lane-right'), 'lane-right'), 'lane-right');
    expect(riderTick(right, RIDER).lanes).toEqual({ [RIDER]: LANE_COUNT - 1 });
  });

  it('takes one use per press on the next tick, and then none until the next press', () => {
    const start = startRiderInput(0);
    expect(riderTick(start, RIDER).uses).toEqual([]);

    const asked = askToUseItem(askToUseItem(start));
    const first = riderTick(asked, RIDER);
    expect(first.uses).toEqual([RIDER]);
    expect(riderTick(first.next, RIDER).uses).toEqual([]);
    // The lane is kept across the tick that took the use.
    expect(first.next.steer).toBe(asked.steer);
  });

  it('uses the held item on the race’s next tick, read off the race', () => {
    const course = raceCourse(1_000, 3);
    const started = createItemRace({
      course,
      seed: 1,
      itemsOn: true,
      racerIds: [RIDER],
      startMs: 0,
    });
    const holding: ItemRaceState = {
      ...started,
      racers: started.racers.map((each) => ({ ...each, held: 'tailwind' })),
    };
    const input = riderTick(askToUseItem(startRiderInput(0)), RIDER);
    const after = stepRace(holding, {
      atMs: 1_000,
      effortDistances: { [RIDER]: 5 },
      lanes: input.lanes,
      uses: input.uses,
    });
    expect(rider(after).held).toBeNull();
    expect(rider(after).effects).toHaveLength(1);
    // And a tick with no press keeps the item.
    const unpressed = riderTick(startRiderInput(0), RIDER);
    const kept = stepRace(holding, {
      atMs: 1_000,
      effortDistances: { [RIDER]: 5 },
      lanes: unpressed.lanes,
      uses: unpressed.uses,
    });
    expect(rider(kept).held).toBe('tailwind');
  });

  it('refuses a bad start or step by naming the constraint, never the value', () => {
    expect(() => startRiderInput(Number.NaN)).toThrow(
      'Lane steering: the starting offset is a finite number of metres',
    );
    expect(() => stepRiderInput(startRiderInput(0), -0.05)).toThrow(
      'Lane steering: a step is a finite number of seconds not below zero',
    );
  });
});

describe('a race input only: steering and items never move the simulated ride (ADR 0060 D-2.1, D-3.4)', () => {
  /** Watts each second of a three-minute ride: a wave, so the speed changes. */
  const POWER = Array.from({ length: 180 }, (_, second) => 180 + 100 * Math.sin(second / 7));
  const FRAME_MS = 50;
  const SWEEP: readonly SteerIntent[] = ['lane-left', 'lane-right', 'lane-right', 'lane-left'];

  interface Ridden {
    /** Every tick: the rider's and the bot's effort distance off the race, and the rider's speed. */
    readonly trace: [number, number, number][];
    /** Every tick, off the race: the rider's lane and held item, and the rider's and the bot's race offset. */
    readonly race: [number, string | null, number, number][];
    /** How many ticks the rider held an item before and none after. */
    readonly itemsGone: number;
  }

  function ride(presses: boolean): Ridden {
    const setup = loop();
    const simulation = new GameSimulation(setup);
    const length = setup.profile.totalDistance as number;
    const startMs = 1_000_000;
    let race = createItemRace({
      course: raceCourse(length, 3),
      seed: 1901,
      itemsOn: true,
      racerIds: [RIDER, BOT],
      startMs,
    });
    let input: RiderRaceInput = startRiderInput(1.75);
    const trace: [number, number, number][] = [];
    const states: [number, string | null, number, number][] = [];
    let itemsGone = 0;
    for (let frame = 0; frame <= 180 * 20; frame += 1) {
      const nowMs = startMs + frame * FRAME_MS;
      const power = POWER[Math.min(POWER.length - 1, Math.floor(frame / 20))] as number;
      if (presses && frame % 30 === 0) {
        // Left, right, right, left: from the middle lane to each side and back.
        input = askLane(input, SWEEP[(frame / 30) % SWEEP.length] as SteerIntent);
      }
      if (presses && frame % 40 === 0) input = askToUseItem(input);
      input = stepRiderInput(input, FRAME_MS / 1_000);
      simulation.advanceTo(nowMs, { power: watts(power), live: true });
      const tick = riderTick(input, RIDER);
      input = tick.next;
      const before = rider(race).held;
      race = stepRace(race, {
        atMs: nowMs,
        effortDistances: {
          [RIDER]: simulation.state.ride.distance,
          // A bot 8 m up the road, so the rider has someone to tow to or hit.
          [BOT]: (simulation.state.ride.distance as number) + 8,
        },
        lanes: tick.lanes,
        uses: tick.uses,
      });
      const now = rider(race);
      if (before !== null && now.held === null) itemsGone += 1;
      const bot = race.racers.find((each) => each.racer.id === BOT) as LapRacer;
      trace.push([now.racer.effortDistance, bot.racer.effortDistance, simulation.state.ride.speed]);
      states.push([now.lane, now.held, now.racer.raceOffset, bot.racer.raceOffset]);
    }
    return { trace, race: states, itemsGone };
  }

  it('rides the same power trace to the same effort distance and speed on every tick, pressed or not', () => {
    const still = ride(false);
    const pressed = ride(true);
    expect(pressed.trace[pressed.trace.length - 1]?.[0]).toBeGreaterThan(1_000);
    expect(pressed.trace).toEqual(still.trace);
  });

  it('while the presses reached the race: lanes changed, items were used, and the offsets moved', () => {
    const still = ride(false);
    const pressed = ride(true);
    // Unpressed, the rider stays in the starting lane and keeps the first item drawn.
    expect(new Set(still.race.map(([lane]) => lane))).toEqual(new Set([STARTING_LANE]));
    expect(still.itemsGone).toBe(0);
    // Pressed, every lane was ridden, and an item was used more than once.
    expect(new Set(pressed.race.map(([lane]) => lane))).toEqual(new Set([0, 1, 2]));
    expect(pressed.itemsGone).toBeGreaterThan(1);
    const offsets = (ridden: Ridden): number[][] => ridden.race.map(([, , own, bot]) => [own, bot]);
    expect(offsets(pressed)).not.toEqual(offsets(still));
  });
});
