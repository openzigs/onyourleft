// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2544, pack riding step 3: the race's racers drawn by bike length along the
 * road and side by side across their lane, never inside one another, and
 * never popping sideways. The race, through `stepLapRaceRide` and
 * `lapRaceDrawing` as `GameView` hands them, read back through `sceneFrame`'s
 * own markers. No case sets its own timeout (#1688).
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

import { kilograms, metres, metresPerSecond } from '@onyourleft/domain';

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
  /** The least centre-to-centre distance, metres, between two drawn racers: a pair of handlebars. */
  const LEAST_APART_METRES = 0.5;
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
   * The racers are placed through `placedRiders`, the step `sceneFrame` takes
   * its markers from, rather than through a whole frame each time: the
   * scenery, the ground and the side roads are nine tenths of a frame and no
   * marker reads them, and 800 whole frames, twice, took 8.9 s a case under
   * coverage on CI (the nightly of 2026-11-12, #1688's ruling: a slow case is
   * made cheaper, never given a longer timeout). Every twentieth frame is also
   * built whole and must agree to the bit, as `line-on-the-road.test.ts` does
   * (#588), so a frame that stopped drawing these markers is still red here.
   */
  interface Ridden {
    readonly apart: number[];
    readonly sideways: number[];
    /** On each frame, the most racers within a row and a bike length of one another, on race places. */
    readonly packed: number[];
    /** How many frames were also built whole, and agreed. */
    readonly whole: number;
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
    const apart: number[] = [];
    const sideways: number[] = [];
    const packed: number[] = [];
    let lateralBefore: ReadonlyMap<string, number> | undefined;
    const origin = corridorOrigin(LOOP);
    let whole = 0;
    for (let frame = 0; frame < frames; frame += 1) {
      along += RIDER_SPEED * LAP_RACE_TICK_SECONDS;
      ride = stepLapRaceRide(ride, { ticks: 1, along, riderWatts: 230 });
      const drawing = lapRaceDrawing(ride, along, 0, false);
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
      const markers = placedRiders(
        input,
        roadCorridor(LOOP, origin, drawnRiderDistance(input)),
      ).map((placed) => placed.marker);
      if (frame % WHOLE_FRAME_EVERY === 0) {
        expect(sceneFrame(input).markers, `frame ${String(frame)}`).toEqual(markers);
        whole += 1;
      }
      let least = Number.POSITIVE_INFINITY;
      for (let one = 0; one < markers.length; one += 1) {
        for (let other = one + 1; other < markers.length; other += 1) {
          const a = markers[one];
          const b = markers[other];
          if (a === undefined || b === undefined) continue;
          least = Math.min(least, Math.hypot(a.x - b.x, a.z - b.z));
        }
      }
      apart.push(least);
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
    return { apart, sideways, packed, whole };
  }

  /** The race ridden once, and read by both cases. */
  let race: Ridden;
  beforeAll(() => {
    race = rideOnce(FRAMES);
  });

  it(`never draws two racers within ${String(LEAST_APART_METRES)} m of each other, on any frame`, () => {
    const { apart, packed, whole } = race;
    expect(apart).toHaveLength(FRAMES);
    expect(whole).toBe(FRAMES / WHOLE_FRAME_EVERY);
    expect(Math.min(...apart)).toBeGreaterThan(LEAST_APART_METRES);
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

  /** One tick's drawing: where the rider is, and each bot, along the road and across it. */
  interface Placed {
    readonly rider: { readonly along: number; readonly across: number };
    readonly bots: readonly {
      readonly along: number;
      readonly across: number;
      readonly speed: number;
    }[];
  }

  /**
   * A seven-bot race from the grid, the rider riding off the line at
   * `speedAt(seconds)` m/s, drawn on every tick through `lapRaceDrawing` as
   * `GameView` draws it.
   */
  function rideFromTheGrid(
    speedAt: (seconds: number) => number,
    ticks: number,
    seed = SEED,
    itemsOn = false,
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
        profile: LOOP,
        conditions: lapRaceBotConditions(
          LOOP,
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
    const placed: Placed[] = [];
    let along = ride.startAlong;
    for (let tick = 0; tick < ticks; tick += 1) {
      along += speedAt((tick + 1) * LAP_RACE_TICK_SECONDS) * LAP_RACE_TICK_SECONDS;
      ride = stepLapRaceRide(ride, { ticks: 1, along, riderWatts: 230 });
      const drawing = lapRaceDrawing(ride, along, 0, false);
      placed.push({
        rider: { along: drawing.riderDistance, across: drawing.steeredLateral },
        bots: drawing.raceBots.map((bot) => ({
          along: bot.distanceMetres,
          across: bot.lateralMetres,
          speed: bot.speedMetresPerSecond,
        })),
      });
    }
    return placed;
  }

  /**
   * Every bot's drawn place, tick to tick: forward, and never faster than its
   * own speed and {@link PACK_CLOSE_UP_METRES_PER_SECOND}, give or take its
   * own speed's change over the tick. A bot is never pushed along ahead of the
   * rider, nor jumped back through them: it makes way across.
   */
  function expectNeverAJump(placed: readonly Placed[]): void {
    for (const [tick, { bots }] of placed.entries()) {
      const before = placed[tick - 1]?.bots;
      if (before === undefined) continue;
      for (const [bot, each] of bots.entries()) {
        const moved = (each.along - (before[bot]?.along ?? Number.NaN)) / LAP_RACE_TICK_SECONDS;
        const where = `bot ${String(bot)}, tick ${String(tick)}`;
        expect(moved, where).toBeGreaterThanOrEqual(0);
        expect(moved, where).toBeLessThanOrEqual(
          each.speed + PACK_CLOSE_UP_METRES_PER_SECOND + 0.25,
        );
      }
    }
  }

  /** Whether a bot is inside the rider: under a bike length along and under a place across. */
  const inside = (rider: Placed['rider'], bot: Placed['bots'][number]): boolean =>
    Math.abs(bot.along - rider.along) < BIKE_LENGTH_METRES - 1e-9 &&
    Math.abs(bot.across - rider.across) < PACK_ABREAST_METRES - 1e-9;

  it('rides the rider through slower bots in their lane round them, never inside one, on any frame', () => {
    // 30 s off the line at up to 11 m/s, faster than any brisk bot: the rider
    // comes up through the whole field, which stands on the grid in the
    // rider's lane and rides off it there.
    const placed = rideFromTheGrid((at) => Math.min(11, 2 * at), 600);
    for (const [tick, { rider, bots }] of placed.entries()) {
      for (const [bot, each] of bots.entries()) {
        expect(inside(rider, each), `bot ${String(bot)}, tick ${String(tick)}`).toBe(false);
      }
    }
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

  it('has a bot that comes past the rider go up the side, never through them', () => {
    // A rider who goes clear of the field off the line, winding up at 2 m/s²
    // to 11 m/s, and from 10 s eases at 2 m/s² to 2 m/s, slower than any bot:
    // the field comes past.
    const placed = rideFromTheGrid(
      (at) => Math.max(2, Math.min(11, 2 * at, 11 - 2 * (at - 10))),
      900,
    );
    for (const [tick, { rider, bots }] of placed.entries()) {
      for (const [bot, each] of bots.entries()) {
        if (Math.abs(each.along - rider.along) >= BIKE_LENGTH_METRES - 1e-9) continue;
        // Level with the rider: beside them, a place or more across.
        expect(
          Math.abs(each.across - rider.across),
          `bot ${String(bot)}, tick ${String(tick)}`,
        ).toBeGreaterThanOrEqual(PACK_ABREAST_METRES - 1e-9);
      }
    }
    expectNeverAJump(placed);
    // Not vacuous: bots were level with the rider, and came past, from a
    // bike length behind the rider to a bike length ahead.
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
    // No two bots drawn inside one another by more than a twentieth of a bike
    // length or of a place.
    for (const [tick, { bots }] of placed.entries()) {
      for (const [one, a] of bots.entries()) {
        for (const b of bots.slice(one + 1)) {
          const depth = Math.min(
            1 - Math.abs(a.along - b.along) / BIKE_LENGTH_METRES,
            1 - Math.abs(a.across - b.across) / PACK_ABREAST_METRES,
          );
          expect(depth, `tick ${String(tick)}`).toBeLessThan(0.05);
        }
      }
    }
    // Not vacuous: the rider went by bots level with them.
    const level = placed.flatMap(({ rider, bots }) =>
      bots.filter((each) => Math.abs(each.along - rider.along) < BIKE_LENGTH_METRES),
    );
    expect(level.length).toBeGreaterThan(10);
  });
});
