// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2544, pack riding step 3: the race's racers drawn by bike length along the
 * road and side by side across their lane, never inside one another, and
 * never popping sideways. The race, through `stepLapRaceRide` and
 * `lapRaceDrawing` as `GameView` hands them, read back through `sceneFrame`'s
 * own markers. No case sets its own timeout (#1688).
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

import { kilograms, metres, metresPerSecond, type RouteProfile } from '@onyourleft/domain';

import { DEFAULT_RIDING_POSITION, rideConditionsFor } from '../rider';
import { circuitRoute } from '../route-fixtures-testing';
import { drawnRiderDistance, placedRiders, sceneFrame, type SceneInput } from '../scene';
import { atStartLine } from '../simulation';
import { corridorOrigin, roadCorridor } from '../terrain';
import { LAP_RACE_MOST_BOTS } from './choice';
import {
  BIKE_LENGTH_METRES,
  gridPackLayout,
  NO_PACK_LAYOUT,
  PACK_ABREAST_METRES,
  PACK_CLOSE_UP_METRES_PER_SECOND,
  PACK_MOST_ABREAST,
  PACK_ROW_METRES,
  PACK_SIDEWAYS_METRES_PER_SECOND,
  stepPackLayout,
  type PackLayout,
  type PackRacer,
} from './pack-layout';
import {
  askRaceLane,
  LAP_RACE_RIDER_ID,
  LAP_RACE_TICK_SECONDS,
  lapRaceBotConditions,
  lapRaceDrawing,
  startLapRaceRide,
  stepLapRaceRide,
  type LapRaceRide,
} from './ride-race';

const RIDER = LAP_RACE_RIDER_ID;

/** A racer at `along` in the lane at `lateral`. */
const at = (id: string, along: number, lateral = 0): PackRacer => ({
  id,
  along,
  lateral,
  speed: 10,
});

/** The layout of `racers` settled: stepped until nothing moves. */
function settled(racers: readonly PackRacer[], from: PackLayout = NO_PACK_LAYOUT): PackLayout {
  let layout = stepPackLayout(racers, RIDER, from, 0);
  for (let tick = 0; tick < 200; tick += 1) {
    layout = stepPackLayout(racers, RIDER, layout, LAP_RACE_TICK_SECONDS);
  }
  return layout;
}

describe('rows a bike length apart, the rider’s the anchor (#2544)', () => {
  it('adds a bike length at every row, ahead of the rider’s row and behind it', () => {
    // A line on 0.65 m wheel gaps, one in each lane so no two share a row's lane.
    const racers = [
      at('a', 102.6, -1.75),
      at('b', 101.95, 0),
      at('c', 101.3, 1.75),
      at(RIDER, 100.65, 0),
      at('d', 100, -1.75),
      at('e', 99.35, 0),
      at('f', 98.7, 1.75),
    ];
    const layout = settled(racers);
    // Rows of three: a b c, the rider d e, then f.
    expect(layout.get('a')?.shift).toBeCloseTo(BIKE_LENGTH_METRES, 9);
    expect(layout.get('c')?.shift).toBeCloseTo(BIKE_LENGTH_METRES, 9);
    expect(layout.get('d')?.shift).toBeCloseTo(0, 9);
    expect(layout.get('e')?.shift).toBeCloseTo(0, 9);
    expect(layout.get('f')?.shift).toBeCloseTo(-BIKE_LENGTH_METRES, 9);
    expect(layout.has(RIDER)).toBe(false);
  });

  it('rides two or three abreast in a group and single file strung out', () => {
    const group = settled([at('a', 50), at('b', 49.35), at('c', 48.7), at(RIDER, 10)]);
    const laterals = ['a', 'b', 'c'].map((id) => group.get(id)?.lateral as number);
    expect(new Set(laterals).size).toBe(PACK_MOST_ABREAST);
    expect(Math.max(...laterals) - Math.min(...laterals)).toBeCloseTo(2 * PACK_ABREAST_METRES, 9);
    const pair = settled([at('a', 50), at('b', 49.35), at(RIDER, 10)]);
    expect(
      Math.abs((pair.get('a')?.lateral as number) - (pair.get('b')?.lateral as number)),
    ).toBeCloseTo(PACK_ABREAST_METRES, 9);
    // Strung out, 5 m apart: each its own row, in its lane, a bike length on.
    const file = settled([at('a', 60), at('b', 55), at('c', 50), at(RIDER, 10)]);
    for (const id of ['a', 'b', 'c']) expect(file.get(id)?.lateral, id).toBe(0);
    expect((file.get('a')?.shift as number) - (file.get('b')?.shift as number)).toBeCloseTo(
      BIKE_LENGTH_METRES,
      9,
    );
  });

  it('keeps every bot in its own lane, and leaves the rider where they steered', () => {
    const layout = settled([
      at(RIDER, 50, 0.2),
      at('a', 49.6, 0),
      at('b', 49.2, 0),
      at('c', 48.9, 1.75),
    ]);
    // The rider's place is theirs: the two bots in their lane are laid out a
    // full place either side of it, in the lane give or take the rider's own
    // 0.2 m off its centre.
    for (const id of ['a', 'b']) {
      const lateral = layout.get(id)?.lateral as number;
      expect(Math.abs(lateral), id).toBeLessThanOrEqual(1.75 / 2 + 0.2);
      expect(Math.abs(lateral - 0.2), id).toBeGreaterThanOrEqual(PACK_ABREAST_METRES - 1e-9);
    }
    expect(layout.get('c')?.lateral).toBe(1.75);
  });

  it('moves a bot no faster than the steering speed across and the close-up speed along, a tick at a time', () => {
    const before = settled([at('a', 50, -1.75), at(RIDER, 49.4, 0)]);
    // It steers a lane over and drops a row behind the rider.
    const after = stepPackLayout(
      [at('a', 47, 1.75), at(RIDER, 49.4, 0)],
      RIDER,
      before,
      LAP_RACE_TICK_SECONDS,
    );
    const was = before.get('a');
    const now = after.get('a');
    expect(Math.abs((now?.lateral as number) - (was?.lateral as number))).toBeCloseTo(
      PACK_SIDEWAYS_METRES_PER_SECOND * LAP_RACE_TICK_SECONDS,
      9,
    );
    expect(now?.sway).toBeCloseTo(PACK_SIDEWAYS_METRES_PER_SECOND, 9);
    expect(Math.abs((now?.shift as number) - (was?.shift as number))).toBeCloseTo(
      PACK_CLOSE_UP_METRES_PER_SECOND * LAP_RACE_TICK_SECONDS,
      9,
    );
    expect(() => stepPackLayout([], RIDER, before, Number.NaN)).toThrow(RangeError);
    expect(() => stepPackLayout([], RIDER, before, -1)).toThrow(RangeError);
  });
});

describe('the pack forms on the line (the owner’s ruling of 2026-11-13 on #2544)', () => {
  it('stands the field on a grid: rows a bike length apart, the rider’s the back row, every row ahead either side of the rider’s line', () => {
    // Seven bots and the rider, level on the line and in one lane, as a race
    // starts them.
    const ids = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'];
    const grid = gridPackLayout(
      [at(RIDER, 0), ...ids.map((id) => at(id, 0))].map((racer) => ({ ...racer, speed: 0 })),
      RIDER,
    );
    expect([...grid.keys()].sort()).toEqual(ids);
    const rows = new Map<number, number[]>();
    for (const place of grid.values()) {
      const row = Math.round(place.shift / BIKE_LENGTH_METRES);
      expect(place.shift).toBeCloseTo(row * BIKE_LENGTH_METRES, 9);
      expect(place.shiftBefore).toBe(place.shift);
      expect(place.sway).toBe(0);
      rows.set(row, [...(rows.get(row) ?? []), place.lateral]);
    }
    // Three rows: two full rows ahead, and the rider's, with the last bot beside them.
    expect([...rows.keys()].sort()).toEqual([0, 1, 2]);
    expect(rows.get(0)).toHaveLength(1);
    for (const row of [1, 2]) {
      const across = rows.get(row) ?? [];
      expect(across).toHaveLength(PACK_MOST_ABREAST);
      // Either side of the rider's line, which is left free, a place apart,
      // and two across the rider's line: the way through.
      expect(across.some((lateral) => lateral < 0)).toBe(true);
      expect(across.some((lateral) => lateral > 0)).toBe(true);
      for (const lateral of across) {
        expect(Math.abs(lateral)).toBeGreaterThanOrEqual(PACK_ABREAST_METRES - 1e-9);
      }
      const sorted = [...across].sort((a, b) => a - b);
      const gaps = sorted.slice(1).map((lateral, next) => lateral - (sorted[next] as number));
      expect(gaps.map((gap) => Math.round(gap / PACK_ABREAST_METRES)).sort()).toEqual([1, 2]);
    }
  });
});

describe('a seeded seven-bot race, read back through sceneFrame (#2544)', () => {
  /** The race's seed, fixed: it is drawn from the platform's source. */
  const SEED = 2_544;

  const LOOP = circuitRoute(120);
  /** The rider's steady speed, metres a second: about a brisk bot's, so the field rides around them. */
  const RIDER_SPEED = 9;

  function start(): LapRaceRide {
    const ride = startLapRaceRide({
      choice: { laps: 3, bots: LAP_RACE_MOST_BOTS, tier: 'brisk', itemsOn: true },
      profile: LOOP,
      conditions: lapRaceBotConditions(
        LOOP,
        rideConditionsFor(kilograms(75), DEFAULT_RIDING_POSITION),
      ),
      // Pressed 50 m into the ride, as a rider does.
      riderDistance: 50,
      lineOffset: 0,
      storage: undefined,
      draft: true,
      riderMassKilograms: 75,
    });
    if (ride === undefined) throw new Error('a loop starts a race');
    return ride;
  }

  /** How many frames the race is ridden for: 40 s at the race's 20 Hz tick. */
  const FRAMES = 800;
  /**
   * Every this many frames, a whole `sceneFrame` is built as well, and its
   * markers must be the ones placed.
   */
  const WHOLE_FRAME_EVERY = 20;

  /**
   * Every frame's drawn racers, rider first, and each bot's place across the road.
   *
   * The racers are read as `lapRaceDrawing` hands them to the scene, along
   * the road and across it, which is where the bike box is measured (#2558's
   * review, finding 2). Every twentieth frame they are also placed through
   * `placedRiders`, the step `sceneFrame` takes its markers from, and built
   * whole, and the two must agree to the bit, as `line-on-the-road.test.ts`
   * does (#588), so a frame that stopped drawing these markers is still red
   * here. 800 whole frames, twice, took 8.9 s a case under coverage on CI
   * (the nightly of 2026-11-12, #1688's ruling: a slow case is made cheaper,
   * never given a longer timeout).
   */
  interface Ridden {
    /**
     * On each frame, how far the two racers drawn furthest inside each other
     * are inside: the lesser of how far under a bike length apart along and
     * how far under a place across, metres; nought or less is clear. Read on
     * each tick, and on the frames drawn between it and the tick before.
     */
    readonly inside: number[];
    readonly insideBetween: number[];
    readonly sideways: number[];
    /** On each frame, the most racers within a row and a bike length of one another, on race places. */
    readonly packed: number[];
    /** How many frames were also built whole, and agreed. */
    readonly whole: number;
  }

  /**
   * How far the two racers drawn furthest inside each other on one drawing
   * are inside, metres: the lesser of how far under a bike length apart along
   * and how far under a place across. Two nose to tail on one line are as
   * inside each other as two side by side (#2558's review, finding 2).
   */
  function deepest(drawing: ReturnType<typeof lapRaceDrawing>): number {
    const drawn = [
      { along: drawing.riderDistance, across: drawing.steeredLateral },
      ...drawing.raceBots.map((bot) => ({ along: bot.distanceMetres, across: bot.lateralMetres })),
    ];
    let most = Number.NEGATIVE_INFINITY;
    for (const [at, one] of drawn.entries()) {
      for (const other of drawn.slice(at + 1)) {
        most = Math.max(
          most,
          Math.min(
            BIKE_LENGTH_METRES - Math.abs(one.along - other.along),
            PACK_ABREAST_METRES - Math.abs(one.across - other.across),
          ),
        );
      }
    }
    return most;
  }

  /** `rideSeeded`, with the platform's random source fixed at `SEED`. */
  function rideOnce(frames: number): Ridden {
    const spy = vi
      .spyOn(globalThis.crypto, 'getRandomValues')
      .mockImplementation(<T extends ArrayBufferView>(array: T): T => {
        (array as unknown as Uint32Array)[0] = SEED;
        return array;
      });
    try {
      return rideSeeded(frames);
    } finally {
      spy.mockRestore();
    }
  }

  function rideSeeded(frames: number): Ridden {
    let ride = start();
    let along = ride.startAlong;
    const inside: number[] = [];
    const insideBetween: number[] = [];
    const sideways: number[] = [];
    const packed: number[] = [];
    let lateralBefore: ReadonlyMap<string, number> | undefined;
    const origin = corridorOrigin(LOOP);
    let whole = 0;
    for (let frame = 0; frame < frames; frame += 1) {
      along += RIDER_SPEED * LAP_RACE_TICK_SECONDS;
      ride = stepLapRaceRide(ride, { ticks: 1, along, riderWatts: 230 });
      const drawing = lapRaceDrawing(ride, along, 0, false);
      inside.push(deepest(drawing));
      const drawn = ride;
      insideBetween.push(
        Math.max(
          ...[0.25, 0.5, 0.75].map((back) =>
            deepest(
              lapRaceDrawing(
                drawn,
                along - RIDER_SPEED * LAP_RACE_TICK_SECONDS * back,
                back * LAP_RACE_TICK_SECONDS,
                false,
              ),
            ),
          ),
        ),
      );
      const base = atStartLine(LOOP);
      const input: SceneInput = {
        profile: LOOP,
        origin,
        state: {
          ...base,
          ride: {
            ...base.ride,
            distance: metres(drawing.riderDistance),
            speed: metresPerSecond(RIDER_SPEED),
          },
        },
        steeredLateral: drawing.steeredLateral,
        steeredSway: 0,
        raceBots: drawing.raceBots,
      };
      if (frame % WHOLE_FRAME_EVERY === 0) {
        const markers = placedRiders(
          input,
          roadCorridor(LOOP, origin, drawnRiderDistance(input)),
        ).map((placed) => placed.marker);
        expect(sceneFrame(input).markers, `frame ${String(frame)}`).toEqual(markers);
        whole += 1;
      }
      const places = ride.race.racers
        .map((entry) => entry.racer.effortDistance + entry.racer.raceOffset)
        .sort((a, b) => b - a);
      packed.push(
        Math.max(
          ...places.map(
            (front) =>
              places.filter(
                (place) => place <= front && front - place <= PACK_ROW_METRES + BIKE_LENGTH_METRES,
              ).length,
          ),
        ),
      );
      const lateral = new Map([...ride.pack].map(([id, place]) => [id, place.lateral]));
      if (lateralBefore !== undefined) {
        for (const [id, value] of lateral) {
          sideways.push(Math.abs(value - (lateralBefore.get(id) ?? value)));
        }
      }
      lateralBefore = lateral;
    }
    return { inside, insideBetween, sideways, packed, whole };
  }

  /** The race ridden once, and read by both cases. */
  let race: Ridden;
  beforeAll(() => {
    race = rideOnce(FRAMES);
  });

  it('never draws two racers inside each other, nose to tail or side by side, on any frame', () => {
    const { inside, insideBetween, packed, whole } = race;
    expect(inside).toHaveLength(FRAMES);
    expect(insideBetween).toHaveLength(FRAMES);
    expect(whole).toBe(FRAMES / WHOLE_FRAME_EVERY);
    expect(Math.max(...inside)).toBeLessThanOrEqual(1e-9);
    // Between ticks each bot is drawn back along its speed at the end of the
    // tick, which for a bot whose speed changed in the tick, most of all from
    // rest off the line, is a few millimetres off what it went (#2546).
    expect(Math.max(...insideBetween)).toBeLessThanOrEqual(0.005);
    // And the field did ride as a pack around the rider: four racers or more
    // within one bike length and a row on some frame, which is what the
    // layout lays out.
    expect(Math.max(...packed)).toBeGreaterThanOrEqual(4);
  });

  it('moves no racer across the road faster than the steering speed, on any frame', () => {
    const { sideways } = race;
    expect(sideways.length).toBeGreaterThan(0);
    for (const step of sideways) {
      expect(step).toBeLessThanOrEqual(
        PACK_SIDEWAYS_METRES_PER_SECOND * LAP_RACE_TICK_SECONDS + 1e-9,
      );
    }
  });
});

describe('drawn turning and leaning into a move across the pack, as a steered rider is (#2456, #2544)', () => {
  const LOOP = circuitRoute(120);
  const RIDER_AT = 200;
  /** The marker of one bot 6 m up the road, in the middle lane, moving across at `sway`. */
  function bot(sway: number) {
    const base = atStartLine(LOOP);
    const frame = sceneFrame({
      profile: LOOP,
      origin: corridorOrigin(LOOP),
      state: {
        ...base,
        ride: { ...base.ride, distance: metres(RIDER_AT), speed: metresPerSecond(9) },
      },
      steeredLateral: -1.75,
      steeredSway: 0,
      raceBots: [
        {
          distanceMetres: RIDER_AT + 6,
          speedMetresPerSecond: 9,
          lateralMetres: 0,
          swayMetresPerSecond: sway,
          laidOut: true,
        },
      ],
    });
    return frame.markers.find((marker) => marker.kind === 'bot');
  }

  it('leans into the move, either way, and turns its heading with it', () => {
    const straight = bot(0);
    const right = bot(PACK_SIDEWAYS_METRES_PER_SECOND);
    const left = bot(-PACK_SIDEWAYS_METRES_PER_SECOND);
    expect(straight).toBeDefined();
    // Leaning: right of the straight bot's lean one way, left the other.
    expect((right?.lean as number) - (straight?.lean as number)).toBeGreaterThan(0.01);
    expect((left?.lean as number) - (straight?.lean as number)).toBeLessThan(-0.01);
    // Turning: its heading swung off the straight one's.
    const turned = (marker: typeof straight): number =>
      Math.atan2(marker?.headingX as number, marker?.headingZ as number);
    expect(Math.abs(turned(right) - turned(straight))).toBeGreaterThan(0.01);
    expect(Math.sign(turned(right) - turned(straight))).toBe(
      -Math.sign(turned(left) - turned(straight)),
    );
  });

  it('draws a laid-out row level with the rider where the layout put it, never moved aside onto one spot', () => {
    const base = atStartLine(LOOP);
    // The rider at the right of a row of three, two bots to their left, level.
    const frame = sceneFrame({
      profile: LOOP,
      origin: corridorOrigin(LOOP),
      state: {
        ...base,
        ride: { ...base.ride, distance: metres(RIDER_AT), speed: metresPerSecond(9) },
      },
      steeredLateral: 0,
      steeredSway: 0,
      raceBots: [-PACK_ABREAST_METRES, -2 * PACK_ABREAST_METRES].map((lateralMetres) => ({
        distanceMetres: RIDER_AT,
        speedMetresPerSecond: 9,
        lateralMetres,
        laidOut: true,
      })),
    });
    const [rider, ...bots] = frame.markers;
    const apart = (a: typeof rider, b: typeof rider): number =>
      Math.hypot((a?.x as number) - (b?.x as number), (a?.z as number) - (b?.z as number));
    expect(apart(bots[0], bots[1])).toBeGreaterThan(PACK_ABREAST_METRES - 0.01);
    expect(apart(rider, bots[0])).toBeGreaterThan(PACK_ABREAST_METRES - 0.01);
  });
});

describe('every pass goes round: the rider and the bots never drawn through one another (the owner’s ruling of 2026-11-13 on #2544)', () => {
  /**
   * The race's seed, fixed: it is drawn from the platform's source. Under it,
   * two bots cross each other's lanes level off the line, and so cannot make
   * way at once: what holds a bot clear of the rider is tested too.
   */
  const SEED = 99;
  const LOOP = circuitRoute(120);

  /** One drawn frame: where the rider is, and each bot, along the road and across it. */
  interface Frame {
    readonly rider: { readonly along: number; readonly across: number };
    readonly bots: readonly {
      readonly along: number;
      readonly across: number;
      readonly speed: number;
    }[];
  }

  /**
   * One tick: the frame drawn on it, and the frames `GameView` draws between
   * it and the tick before, a quarter, a half and three quarters of a tick
   * back, the rider blended there as `simulation.ts` §`drawnAt` blends them
   * (#2558's review, finding 5).
   */
  interface Placed extends Frame {
    readonly between: readonly Frame[];
  }

  /** How far back between two ticks each drawn frame is, as a share of a tick. */
  const BETWEEN_TICKS = [0.25, 0.5, 0.75] as const;

  /**
   * A seven-bot race from the grid, the rider riding off the line at
   * `speedAt(seconds)` m/s and, where `steerAt` is given, steering a lane over
   * at each of its seconds, left and right in turn. Drawn on every tick, and
   * between ticks, through `lapRaceDrawing` as `GameView` draws it.
   */
  function rideFromTheGrid(
    speedAt: (seconds: number) => number,
    ticks: number,
    seed = SEED,
    itemsOn = false,
    steerAt: readonly number[] = [],
    profile: RouteProfile = LOOP,
    riderWatts = 230,
  ): Placed[] {
    const spy = vi
      .spyOn(globalThis.crypto, 'getRandomValues')
      .mockImplementation(<T extends ArrayBufferView>(array: T): T => {
        (array as unknown as Uint32Array)[0] = seed;
        return array;
      });
    let ride: LapRaceRide | undefined;
    try {
      ride = startLapRaceRide({
        choice: { laps: 3, bots: LAP_RACE_MOST_BOTS, tier: 'brisk', itemsOn },
        profile,
        conditions: lapRaceBotConditions(
          profile,
          rideConditionsFor(kilograms(75), DEFAULT_RIDING_POSITION),
        ),
        riderDistance: 50,
        lineOffset: 0,
        storage: undefined,
        draft: true,
        riderMassKilograms: 75,
      });
    } finally {
      spy.mockRestore();
    }
    if (ride === undefined) throw new Error('a loop starts a race');
    const frame = (drawing: ReturnType<typeof lapRaceDrawing>): Frame => ({
      rider: { along: drawing.riderDistance, across: drawing.steeredLateral },
      bots: drawing.raceBots.map((bot) => ({
        along: bot.distanceMetres,
        across: bot.lateralMetres,
        speed: bot.speedMetresPerSecond,
      })),
    });
    const placed: Placed[] = [];
    let along = ride.startAlong;
    let steered = 0;
    for (let tick = 0; tick < ticks; tick += 1) {
      const seconds = (tick + 1) * LAP_RACE_TICK_SECONDS;
      const steer = steerAt[steered];
      if (steer !== undefined && seconds >= steer) {
        ride = askRaceLane(ride, steered % 2 === 0 ? 'lane-left' : 'lane-right');
        steered += 1;
      }
      const before = along;
      along += speedAt(seconds) * LAP_RACE_TICK_SECONDS;
      ride = stepLapRaceRide(ride, { ticks: 1, along, riderWatts });
      const drawn = ride;
      placed.push({
        ...frame(lapRaceDrawing(drawn, along, 0, false)),
        between: BETWEEN_TICKS.map((back) =>
          frame(
            lapRaceDrawing(
              drawn,
              along - (along - before) * back,
              back * LAP_RACE_TICK_SECONDS,
              false,
            ),
          ),
        ),
      });
    }
    return placed;
  }

  /**
   * Every bot's drawn place, tick to tick: forward, and never faster than its
   * own speed and {@link PACK_CLOSE_UP_METRES_PER_SECOND}, give or take its
   * own speed's change over the tick; and across no faster than the steering
   * speed. A bot is never pushed along ahead of the rider, nor jumped back
   * through them: it makes way across.
   */
  function expectNeverAJump(placed: readonly Placed[]): void {
    // Gathered, then asserted once: an `expect` a bot a tick is most of a
    // long ride's time (#1688: a slow case is made cheaper).
    const jumps: string[] = [];
    for (const [tick, { bots }] of placed.entries()) {
      const before = placed[tick - 1]?.bots;
      if (before === undefined) continue;
      for (const [bot, each] of bots.entries()) {
        const was = before[bot];
        const moved = (each.along - (was?.along ?? Number.NaN)) / LAP_RACE_TICK_SECONDS;
        const across = Math.abs(each.across - (was?.across ?? Number.NaN));
        if (
          !(moved >= 0) ||
          !(moved <= each.speed + PACK_CLOSE_UP_METRES_PER_SECOND + 0.25) ||
          !(across <= PACK_SIDEWAYS_METRES_PER_SECOND * LAP_RACE_TICK_SECONDS + 1e-9)
        ) {
          jumps.push(
            `bot ${String(bot)}, tick ${String(tick)}: ${String(moved)} m/s, ${String(across)} m across`,
          );
        }
      }
    }
    expect(jumps).toEqual([]);
  }

  /**
   * The most a bot's drawn speed against its race speed changes in a tick,
   * metres a second: **2**, `pack-layout.ts`'s 40 m/s² ease at the race's
   * 20 Hz tick. Written here, not imported, so a layout that eased less is
   * red rather than a bound that moved with it.
   */
  const EASED_PER_TICK = 2;

  /**
   * Every bot's drawn speed, tick to tick, smooth (#2558's review, finding A):
   * how much faster or slower than its race speed it is drawn changes by no
   * more than {@link EASED_PER_TICK} from one tick to the next, give or take
   * its race speed's own change; and, at race speed, it is never
   * drawn under half its race speed on one tick and over it on the next, or
   * the other way about: the 10 Hz judder of a bot held behind the rider,
   * drawn at 1.4 m/s and 16 m/s on alternate ticks.
   */
  function expectSmooth(placed: readonly Placed[]): void {
    const jolts: string[] = [];
    const drawnSpeed = (tick: number, bot: number): number =>
      ((placed[tick]?.bots[bot]?.along ?? Number.NaN) -
        (placed[tick - 1]?.bots[bot]?.along ?? Number.NaN)) /
      LAP_RACE_TICK_SECONDS;
    for (let tick = 2; tick < placed.length; tick += 1) {
      for (const [bot, each] of (placed[tick]?.bots ?? []).entries()) {
        const was = placed[tick - 1]?.bots[bot];
        const now = drawnSpeed(tick, bot);
        const before = drawnSpeed(tick - 1, bot);
        const change = Math.abs(now - each.speed - (before - (was?.speed ?? Number.NaN)));
        const flips =
          each.speed > 4 &&
          ((before < 0.5 * each.speed && now > each.speed) ||
            (before > each.speed && now < 0.5 * each.speed));
        if (!(change <= EASED_PER_TICK + 0.25) || flips) {
          jolts.push(
            `bot ${String(bot)}, tick ${String(tick)}: ${before.toFixed(2)} then ${now.toFixed(2)} m/s, race ${each.speed.toFixed(2)} m/s`,
          );
        }
      }
    }
    expect(jolts).toEqual([]);
  }

  /**
   * Whether two drawn racers are inside each other by more than `slack`
   * metres: under a bike length along and under a place across.
   */
  const inside = (
    one: { readonly along: number; readonly across: number },
    other: { readonly along: number; readonly across: number },
    slack = 0,
  ): boolean =>
    Math.abs(one.along - other.along) < BIKE_LENGTH_METRES - slack - 1e-9 &&
    Math.abs(one.across - other.across) < PACK_ABREAST_METRES - slack - 1e-9;

  /**
   * How far inside each other two racers may be drawn on a frame between two
   * ticks, metres: **0.005**. Each bot there is drawn back along its speed at
   * the end of the tick (`ride-race.ts` §`lapRaceDrawing`, #2546), so a bot
   * whose speed changed in the tick, most of all from rest, is drawn a little
   * off where it was: two bots a bike length apart are drawn up to 3 mm
   * closer, nearly all of it within 0.3 s of Go, and by under a millimetre
   * after any change of speed later in the ride.
   */
  const DRAWN_BACK_SLACK_METRES = 0.005;

  /**
   * No bot inside the rider, and, unless `riderOnly`, no two bots inside each
   * other, on any frame drawn.
   */
  function expectNeverInside(placed: readonly Placed[], riderOnly = false): void {
    expect(placed.every((tick) => tick.between.length === BETWEEN_TICKS.length)).toBe(true);
    const frames = placed.flatMap((tick) => [
      { frame: tick, slack: 0 },
      ...tick.between.map((frame) => ({ frame, slack: DRAWN_BACK_SLACK_METRES })),
    ]);
    const found: string[] = [];
    for (const [at, { frame, slack }] of frames.entries()) {
      for (const [bot, each] of frame.bots.entries()) {
        const where = `bot ${String(bot)}, frame ${String(at)}`;
        if (inside(frame.rider, each, slack)) found.push(`${where}, inside the rider`);
        if (riderOnly) continue;
        for (const other of frame.bots.slice(bot + 1)) {
          if (inside(each, other, slack)) found.push(`${where}, inside a bot`);
        }
      }
    }
    expect(found).toEqual([]);
  }

  it('rides the rider through slower bots in their lane round them, never inside one, on any frame', () => {
    // 30 s off the line at up to 11 m/s, faster than any brisk bot: the rider
    // comes up through the whole field, which stands on the grid in the
    // rider's lane and rides off it there.
    const placed = rideFromTheGrid((at) => Math.min(11, 2 * at), 600);
    expectNeverInside(placed);
    expectNeverAJump(placed);
    // Not vacuous: the rider passed every bot, and went by some of them level
    // with them, a bike length or less along, on the way.
    const last = placed.at(-1);
    for (const each of last?.bots ?? []) expect(each.along).toBeLessThan(last?.rider.along ?? 0);
    const level = placed.flatMap(({ rider, bots }) =>
      bots.filter((each) => Math.abs(each.along - rider.along) < BIKE_LENGTH_METRES),
    );
    expect(level.length).toBeGreaterThan(10);
  });

  it('has a bot that comes past the rider go up the side, never through them, nor through a bot, on any frame', () => {
    // A rider who goes clear of the field off the line, winding up at 2 m/s²
    // to 11 m/s, and from 10 s eases at 2 m/s² to 2 m/s, slower than any bot:
    // the field comes past.
    const placed = rideFromTheGrid(
      (at) => Math.max(2, Math.min(11, 2 * at, 11 - 2 * (at - 10))),
      900,
    );
    expectNeverInside(placed);
    expectNeverAJump(placed);
    // Not vacuous: bots were level with the rider, and came past, from a
    // bike length behind the rider to a bike length ahead, beside them.
    const level = placed.flatMap(({ rider, bots }) =>
      bots.filter((each) => Math.abs(each.along - rider.along) < BIKE_LENGTH_METRES),
    );
    expect(level.length).toBeGreaterThan(10);
    const gaps = (bot: number): number[] =>
      placed.map(({ rider, bots }) => (bots[bot]?.along ?? Number.NaN) - rider.along);
    const passed = (placed[0]?.bots ?? []).filter((_, bot) => {
      const gap = gaps(bot);
      const behind = gap.findIndex((each) => each < -BIKE_LENGTH_METRES);
      return behind >= 0 && gap.slice(behind).some((each) => each > BIKE_LENGTH_METRES);
    });
    expect(passed.length).toBeGreaterThanOrEqual(3);
  });

  it('has a bot the rider closes on in their lane ease aside before the rider reaches it, never held up against them', () => {
    // A field with no two bots crossing level off the line: every bot the
    // rider comes up on can make way in time.
    const placed = rideFromTheGrid((at) => Math.min(11, 2 * at), 600, 2_544);
    expectNeverInside(placed, true);
    // And on no tick held just clear in front of the rider or just behind,
    // as a bot is that could not get aside in time.
    const held = placed.flatMap(({ rider, bots }) =>
      bots.filter(
        (each) =>
          Math.abs(each.across - rider.across) < PACK_ABREAST_METRES - 1e-9 &&
          Math.abs(each.along - rider.along) < BIKE_LENGTH_METRES + 0.05,
      ),
    );
    expect(held).toEqual([]);
    // Not vacuous: the rider went by bots level with them.
    const level = placed.flatMap(({ rider, bots }) =>
      bots.filter((each) => Math.abs(each.along - rider.along) < BIKE_LENGTH_METRES),
    );
    expect(level.length).toBeGreaterThan(10);
  });

  it('sees a pass coming and makes way in time, so no bot is pushed into another to clear the rider', () => {
    // Items on, so hits shuffle the field, and the rider winding up at
    // 1.5 m/s² to 9 m/s through it.
    const placed = rideFromTheGrid((at) => Math.min(9, 1.5 * at), 600, 2_544, true);
    // No two bots drawn inside one another, nor one inside the rider, on any
    // frame: a bot held up behind one the race has ahead goes round it.
    expectNeverInside(placed);
    // Not vacuous: the rider went by bots level with them.
    const level = placed.flatMap(({ rider, bots }) =>
      bots.filter((each) => Math.abs(each.along - rider.along) < BIKE_LENGTH_METRES),
    );
    expect(level.length).toBeGreaterThan(10);
  });

  it('keeps every bot within its reach, forward and never a jump, while the rider steers through the field off the line (#2558’s review, finding 1)', () => {
    // The rider winds up at 2 m/s² to 9 m/s off the line and steers a lane
    // left and right through the grid: every 0.85 s through the first 6 s,
    // while the field is still getting going, and every 1.5 s after.
    const steerAt = [1, 1.85, 2.7, 3.55, 4.4, 5.25, 6.1, 7.6, 9.1, 10.6, 12.1, 13.6, 15.1, 16.6];
    const placed = rideFromTheGrid((at) => Math.min(9, 2 * at), 400, SEED, false, steerAt);
    expectNeverAJump(placed);
    expectNeverInside(placed);
    // Not vacuous: the rider did steer across the road, and came by bots
    // level with them in the first seconds after Go.
    const across = placed.map(({ rider }) => rider.across);
    expect(Math.max(...across) - Math.min(...across)).toBeGreaterThan(1.5);
    const early = placed
      .slice(0, 80)
      .flatMap(({ rider, bots }) =>
        bots.filter((each) => Math.abs(each.along - rider.along) < BIKE_LENGTH_METRES),
      );
    expect(early.length).toBeGreaterThan(10);
  });
  it('draws no two bots inside each other while a rider who does not steer winds up off the line (seed 12345, #2558’s review, finding K)', () => {
    // The rider winds up at 2 m/s² to 10 m/s and never steers. Before
    // finding H's fix, two bots were drawn 43.8 cm inside each other for 7
    // ticks, at 2.05 to 2.35 s.
    const placed = rideFromTheGrid((at) => Math.min(10, 2 * at), 200, 12_345);
    expectNeverInside(placed);
    expectNeverAJump(placed);
    expectSmooth(placed);
    // Not vacuous: the rider came by bots level with them off the line.
    const level = placed.flatMap(({ rider, bots }) =>
      bots.filter((each) => Math.abs(each.along - rider.along) < BIKE_LENGTH_METRES),
    );
    expect(level.length).toBeGreaterThan(10);
  });
  it('holds the known limit of a rider steering into the field as it gets going: two bots drawn inside each other only then, and briefly (#2558’s review, finding B)', () => {
    // The previous case's steering, on a seed where it does reach the limit:
    // the rider swerves back across the grid at about 2.2 s, as the bots
    // cross 3 m/s and leave their places, and a bot that must make way for
    // the rider has only a bot beside it to make way into. The rider comes
    // first and is never moved, and no bot may jump, so for a moment two
    // bots are drawn inside each other. This pins how long and where.
    const steerAt = [1, 1.85, 2.7, 3.55, 4.4, 5.25, 6.1, 7.6, 9.1, 10.6, 12.1, 13.6, 15.1, 16.6];
    const placed = rideFromTheGrid((at) => Math.min(9, 2 * at), 400, 2, false, steerAt);
    // Never inside the rider, on any frame, and never a jump.
    expectNeverInside(placed, true);
    expectNeverAJump(placed);
    expectSmooth(placed);
    // The ticks with two bots drawn inside each other, and how far: how far
    // under a bike length apart along, and how far under a place apart
    // across, each the most of any pair inside each other on the tick.
    const overlapping: {
      readonly seconds: number;
      readonly along: number;
      readonly across: number;
    }[] = [];
    for (const [tick, { bots }] of placed.entries()) {
      let along = 0;
      let across = 0;
      for (const [at, one] of bots.entries()) {
        for (const other of bots.slice(at + 1)) {
          if (inside(one, other)) {
            along = Math.max(along, BIKE_LENGTH_METRES - Math.abs(one.along - other.along));
            across = Math.max(across, PACK_ABREAST_METRES - Math.abs(one.across - other.across));
          }
        }
      }
      if (along > 0) {
        overlapping.push({ seconds: (tick + 1) * LAP_RACE_TICK_SECONDS, along, across });
      }
    }
    let run = 0;
    let longest = 0;
    for (const [at, { seconds }] of overlapping.entries()) {
      const before = overlapping[at - 1]?.seconds;
      run =
        before !== undefined && Math.abs(seconds - before - LAP_RACE_TICK_SECONDS) < 1e-9
          ? run + 1
          : 1;
      longest = Math.max(longest, run);
    }
    // This seed does reach it: if this goes red because there is none, the
    // limit is gone, and this case and the PR's notes should say so.
    expect(overlapping.length).toBeGreaterThan(0);
    // Only in the second after the swerve back across the grid, 2.0 to 3.0 s
    // after Go; 9 ticks (0.45 s) in all, 8 of them in one run, from 2.10 to
    // 2.55 s; at worst 1.30 m inside each other along, 0.22 m apart across.
    // Then on one line, for 7 ticks: a bot made way for the rider onto the
    // line of a bot a bike length ahead of it, and is drawn up to 1.20 m
    // inside it, the two 0.55 m apart nose to tail. Before #2558's review,
    // finding H, the bot that made way was pushed a step further across by
    // the rounding, and the two were drawn 0.32 m apart across, 1.43 m inside
    // each other along, for 17 ticks.
    for (const { seconds } of overlapping) {
      expect(seconds).toBeGreaterThanOrEqual(2);
      expect(seconds).toBeLessThanOrEqual(3);
    }
    expect(overlapping.length).toBeLessThanOrEqual(9);
    expect(longest).toBeLessThanOrEqual(8);
    expect(Math.max(...overlapping.map(({ along }) => along))).toBeLessThanOrEqual(1.3);
    // And across (#2558's review, finding J): on one line no longer and no
    // deeper than that, so a change that puts two bots on one line for more
    // of the limit, or further inside each other there, is red.
    const oneLine = overlapping.filter(({ across }) => across > PACK_ABREAST_METRES - 1e-9);
    expect(oneLine.length).toBeLessThanOrEqual(7);
    expect(Math.max(0, ...oneLine.map(({ along }) => along))).toBeLessThanOrEqual(1.21);
  });
  it.each([
    // At about 63 s a bot comes up on the rider's line with a bot beside it
    // and has to hold behind them: it was drawn at 1.4 m/s and 16 m/s on
    // alternate ticks for half a second.
    { seed: 8 },
    // At about 66 s two bots come up on the rider's line a bike length
    // apart, and the front one, easing back, has the other right behind it:
    // seen 0.45 s on, the two ease back together, and neither is drawn
    // inside the rider.
    { seed: 7 },
    // At about 63 s a bot at 14 m/s comes up on the rider's line. Offered
    // no place to hold a bike length clear of where the rider will be, it
    // eased back past it, and was drawn at 2 m/s for a tick.
    { seed: 21 },
  ])(
    'draws a bot held behind the rider at race speed smoothly, never giving way and closing up on alternate ticks (seed $seed, #2558’s review, finding A)',
    ({ seed }) => {
      // 120 s at a steady 8 m/s on the flat: the field reaches race speed, over
      // 14 m/s, and comes up on the rider from a lap down.
      const placed = rideFromTheGrid(() => 8, 2_400, seed);
      expectSmooth(placed);
      // And never braking hard at race speed (#2558's review, finding D):
      // drawn under a quarter of its race speed, at over 6 m/s.
      const braking = placed.flatMap(({ bots }, tick) =>
        bots.flatMap((each, bot) => {
          const drawn =
            (each.along - (placed[tick - 1]?.bots[bot]?.along ?? Number.NaN)) /
            LAP_RACE_TICK_SECONDS;
          return each.speed > 6 && drawn < 0.25 * each.speed
            ? [
                `bot ${String(bot)}, tick ${String(tick)}: ${drawn.toFixed(2)} m/s, race ${each.speed.toFixed(2)} m/s`,
              ]
            : [];
        }),
      );
      expect(braking).toEqual([]);
      expectNeverAJump(placed);
      expectNeverInside(placed);
      // Not vacuous: the bots reached race speed, and came up behind the
      // rider on their line at over 12 m/s, within three bike lengths.
      const held = placed.filter(({ rider, bots }) =>
        bots.some((each) => {
          const behind = rider.along - each.along;
          return (
            each.speed > 12 &&
            Math.abs(each.across - rider.across) < PACK_ABREAST_METRES &&
            behind >= BIKE_LENGTH_METRES - 1e-9 &&
            behind < 3 * BIKE_LENGTH_METRES
          );
        }),
      );
      expect(held.length).toBeGreaterThan(5);
    },
  );
  it.each([
    // The field comes past the rider down the hill, and round its own.
    { seed: 1, watts: 230 },
    // At 200 W, as #2561's harness rides it: a bot comes down on the rider
    // with a bot either side of them, and must give way to keep clear.
    { seed: 2, watts: 200 },
  ])(
    'has the bots coming down a hill faster than the rider go round them and round one another, on any frame (seed $seed, $watts W)',
    ({ seed, watts }) => {
      // A 12 m rise and fall each 628 m lap, the rider steady at 8 m/s: down
      // the hill the field comes past them, and catches its own.
      const hilly = circuitRoute(
        100,
        (at) => 12 * Math.sin((at / (2 * Math.PI * 100)) * Math.PI * 2),
      );
      const placed = rideFromTheGrid(() => 8, 3_000, seed, false, [], hilly, watts);
      expectNeverInside(placed);
      expectNeverAJump(placed);
      // Not vacuous: bots came by the rider level with them.
      const level = placed.flatMap(({ rider, bots }) =>
        bots.filter((each) => Math.abs(each.along - rider.along) < BIKE_LENGTH_METRES),
      );
      expect(level.length).toBeGreaterThan(10);
    },
  );
});

describe('a bot the rider steers into makes way at once, within its reach (#2558’s review, finding 1)', () => {
  it('steps aside and forward as far as it may in the tick, away from the rider', () => {
    // A bot a metre ahead of the rider and 0.6 m to their right, clear of
    // them; the rider then steers 0.3 m toward it.
    const before = new Map([['a', { shift: 0, shiftBefore: 0, lateral: 0.6, sway: 0 }]]);
    const after = stepPackLayout(
      [
        { id: RIDER, along: 100, lateral: 0.3, speed: 10 },
        { id: 'a', along: 101, lateral: 0.6, speed: 10 },
      ],
      RIDER,
      before,
      LAP_RACE_TICK_SECONDS,
    );
    const a = after.get('a');
    // As far away across as it may go in a tick, and as far on.
    expect(a?.lateral).toBeCloseTo(
      0.6 + PACK_SIDEWAYS_METRES_PER_SECOND * LAP_RACE_TICK_SECONDS,
      9,
    );
    expect(a?.shift).toBeCloseTo(PACK_CLOSE_UP_METRES_PER_SECOND * LAP_RACE_TICK_SECONDS, 9);
  });
});

describe('a bot exactly a place across from the rider is clear of them (#2558’s review, finding H)', () => {
  // The rider in the lane at −1.75 m. A bot laid out a place to their left is
  // at −2.3 m, which in floating point is 0.5499999999999998 from them, not
  // 0.55: a place across, and so clear, but by a hair under it.
  const LANE = -1.75;
  const BESIDE = LANE - PACK_ABREAST_METRES;

  it('is laid out where the rounding puts it, a hair under a place from the rider', () => {
    // The premise, so that this case cannot pass on a rounding that came out
    // exactly at 0.55.
    expect(Math.abs(BESIDE - LANE)).toBeLessThan(PACK_ABREAST_METRES);
  });

  it('leaves a bot level with the rider a place across where it is, never giving way', () => {
    let layout: PackLayout = new Map([
      ['a', { shift: 0, shiftBefore: 0, lateral: BESIDE, sway: 0 }],
    ]);
    for (let tick = 0; tick < 40; tick += 1) {
      const along = 100 + 10 * tick * LAP_RACE_TICK_SECONDS;
      layout = stepPackLayout(
        [
          { id: RIDER, along, lateral: LANE, speed: 10 },
          { id: 'a', along, lateral: LANE, speed: 10 },
        ],
        RIDER,
        layout,
        LAP_RACE_TICK_SECONDS,
      );
      expect(layout.get('a')).toEqual({ shift: 0, shiftBefore: 0, lateral: BESIDE, sway: 0 });
    }
  });

  it('has a faster bot a place across, drawn behind the rider, come up past them', () => {
    // The race has the bot a metre ahead of the rider and 2 m/s faster; it is
    // drawn 2.5 m behind them, a place to their left, where a bot held behind
    // the rider was left: seed 333 drew one there for 13 s while the race had
    // it up to 13.8 m ahead.
    let layout: PackLayout = new Map([
      ['a', { shift: -3.5, shiftBefore: -3.5, lateral: BESIDE, sway: 0 }],
    ]);
    let ahead = Number.NaN;
    for (let tick = 0; tick < 40; tick += 1) {
      const rider = 100 + 8 * tick * LAP_RACE_TICK_SECONDS;
      const bot = 101 + 10 * tick * LAP_RACE_TICK_SECONDS;
      layout = stepPackLayout(
        [
          { id: RIDER, along: rider, lateral: LANE, speed: 8 },
          { id: 'a', along: bot, lateral: LANE, speed: 10 },
        ],
        RIDER,
        layout,
        LAP_RACE_TICK_SECONDS,
      );
      const a = layout.get('a');
      ahead = bot + (a?.shift ?? Number.NaN) - rider;
      // Never drawn inside the rider on the way.
      const inside =
        Math.abs(ahead) < BIKE_LENGTH_METRES - 1e-9 &&
        Math.abs((a?.lateral ?? Number.NaN) - LANE) < PACK_ABREAST_METRES - 1e-9;
      expect(inside).toBe(false);
    }
    // Within two seconds it is drawn past the rider: level or ahead of them.
    expect(ahead).toBeGreaterThan(0);
  });
});
