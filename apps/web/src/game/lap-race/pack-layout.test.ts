// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2544, pack riding step 3: the race's racers drawn by bike length along the
 * road and side by side across their lane, never inside one another, and
 * never popping sideways. The race, through `stepLapRaceRide` and
 * `lapRaceDrawing` as `GameView` hands them, read back through `sceneFrame`'s
 * own markers. No case sets its own timeout (#1688).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { kilograms, metres, metresPerSecond } from '@onyourleft/domain';

import { DEFAULT_RIDING_POSITION, rideConditionsFor } from '../rider';
import { circuitRoute } from '../route-fixtures-testing';
import { sceneFrame, type SceneInput } from '../scene';
import { atStartLine } from '../simulation';
import { corridorOrigin } from '../terrain';
import { LAP_RACE_MOST_BOTS } from './choice';
import {
  BIKE_LENGTH_METRES,
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

describe('a seeded seven-bot race, read back through sceneFrame (#2544)', () => {
  /** The race's seed, fixed: it is drawn from the platform's source. */
  const SEED = 2_544;
  beforeEach(() => {
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(
      <T extends ArrayBufferView>(array: T): T => {
        (array as unknown as Uint32Array)[0] = SEED;
        return array;
      },
    );
  });
  afterEach(() => vi.restoreAllMocks());

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

  /** Every frame's drawn racers, rider first, and each bot's place across the road. */
  function ridden(frames: number): {
    readonly apart: number[];
    readonly sideways: number[];
    /** On each frame, the most racers within a row and a bike length of one another, on race places. */
    readonly packed: number[];
  } {
    let ride = start();
    let along = ride.startAlong;
    const apart: number[] = [];
    const sideways: number[] = [];
    const packed: number[] = [];
    let lateralBefore: ReadonlyMap<string, number> | undefined;
    for (let frame = 0; frame < frames; frame += 1) {
      along += RIDER_SPEED * LAP_RACE_TICK_SECONDS;
      ride = stepLapRaceRide(ride, { ticks: 1, along, riderWatts: 230 });
      const drawing = lapRaceDrawing(ride, along, 0, false);
      const base = atStartLine(LOOP);
      const input: SceneInput = {
        profile: LOOP,
        origin: corridorOrigin(LOOP),
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
      const markers = sceneFrame(input).markers;
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
    return { apart, sideways, packed };
  }

  it(`never draws two racers within ${String(LEAST_APART_METRES)} m of each other, on any frame`, () => {
    const { apart, packed } = ridden(800);
    expect(Math.min(...apart)).toBeGreaterThan(LEAST_APART_METRES);
    // And the field did ride as a pack around the rider: four racers or more
    // within one bike length and a row on some frame, which is what the
    // layout lays out.
    expect(Math.max(...packed)).toBeGreaterThanOrEqual(4);
  });

  it('moves no racer across the road faster than the steering speed, on any frame', () => {
    const { sideways } = ridden(600);
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
