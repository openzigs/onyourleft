// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2545, pack riding step 4: a headless harness over seeded seven-bot fields,
 * a flat circuit and a hilly one, through the game's own race step
 * (`stepLapRaceRide`, at its 20 Hz tick, the field drafting) and the drawing
 * `GameView` is handed (`lapRaceDrawing`). It holds what #2542 to #2544 built,
 * on whole races rather than set pieces:
 *
 * - **a pack forms**: by {@link PACK_BY_SECONDS} s most bots ride on a wheel,
 *   deep in a draft;
 * - **attacks leave the group and are caught or hold**: every attack or flyer
 *   gets clear of the wheel behind it, and then is caught or holds its gap;
 * - **faders drop off**: on the hills a bot that has spent its W′ ends up
 *   out of the draft of the racer ahead of it;
 * - **the drawn layout never overlaps**: no two racers inside each other's
 *   bike box, a bike length along and a place across, on any tick or on the
 *   frames drawn between ticks;
 * - **a run replays identically**.
 *
 * Each field is ridden once and read by every case that asks about it. No case
 * sets its own timeout (#1688); a whole field rides in well under a second.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BOT_TACTIC_WHEEL_FURTHEST_METRES,
  BOT_TACTIC_WHEEL_LOST_METRES,
  BOT_TACTIC_WHEEL_METRES,
  kilograms,
  type BotTactic,
  type RouteProfile,
} from '@onyourleft/domain';
import { lapRaceDraftFactors } from '@onyourleft/physics';

import { DEFAULT_RIDING_POSITION, rideConditionsFor } from '../rider';
import { circuitRoute } from '../route-fixtures-testing';
import { LAP_RACE_MOST_BOTS } from './choice';
import { BIKE_LENGTH_METRES, PACK_ABREAST_METRES } from './pack-layout';
import {
  LAP_RACE_RIDER_ID,
  LAP_RACE_TICK_SECONDS,
  lapRaceBotConditions,
  lapRaceDrawing,
  startLapRaceRide,
  stepLapRaceRide,
} from './ride-race';

/** A 100 m-radius circuit, 628 m round: level, and with a 12 m rise and fall each lap. */
const FLAT = circuitRoute(100, () => 0);
const HILLY = circuitRoute(
  100,
  (along) => 12 * Math.sin((along / (2 * Math.PI * 100)) * Math.PI * 2),
);

/** The fields' seeds: the race's own, which it draws from the platform. */
const SEEDS = [1, 2, 3] as const;
/** How long each field is ridden, seconds: most of a three-lap race. */
const RIDDEN_SECONDS = 150;
/** The rider's steady speed, metres a second, and power. */
const RIDER_SPEED = 8;
const RIDER_WATTS = 200;

/** By this many seconds a pack has formed. */
const PACK_BY_SECONDS = 30;
/**
 * What counts as a pack by {@link PACK_BY_SECONDS}, per circuit: the share of
 * the field at or under a draft multiplier `k`. On the flat, 4 of 7 **on a
 * wheel** (`k` ≤ 0.6, about 1 m back in a line); on the hills, whose climbs
 * string a line out, 5 of 7 **inside a draft** (`k` ≤ 0.8, about 10 m back).
 */
const PACK = {
  flat: { k: 0.6, share: 4 / 7 },
  hilly: { k: 0.8, share: 5 / 7 },
} as const;
/**
 * How far inside each other two racers may be drawn on a frame between two
 * ticks, metres: **0.005**. Each bot there is drawn back along its speed at
 * the end of the tick (`ride-race.ts` §`lapRaceDrawing`, #2546), so a bot
 * whose speed changed in the tick, most of all from rest, is drawn a little
 * off where it was: two bots a bike length apart are drawn up to 3 mm closer,
 * nearly all of it within 0.3 s of Go, and by under a millimetre after any
 * change of speed later in the ride.
 */
const DRAWN_BACK_SLACK_METRES = 0.005;
/**
 * The most a bot's drawn speed against its race speed may change in a tick,
 * metres a second: **2**, `pack-layout.ts`'s 40 m/s² ease at the race's 20 Hz
 * tick, and 0.25 m/s for the race speed's own change over it. Written here,
 * not imported, so a layout that eased less is red rather than a bound that
 * moved with it.
 */
const EASED_PER_TICK = 2 + 0.25;
/** How far back between two ticks each frame `GameView` draws is, as a share of a tick. */
const BETWEEN_TICKS = [0.25, 0.5, 0.75] as const;
/** A move back in the group within this many seconds of its end was caught. */
const CAUGHT_WITHIN_SECONDS = 60;
/** A move that never falls under this share of the gap it ended with held it: **0.5**. */
const HELD_SHARE = 0.5;
/** A move this far clear of the racer behind it has left the group, metres: the draft's 5 m knee. */
const AWAY_METRES = 5;
/** A W′ this low, as a share, is spent: **0.7**, as low as a bot in these races reads in a group before it goes. */
const SPENT_SHARE = 0.7;

/** One tick of a field: where every racer is, its tactic, its W′ share and its `k`. */
interface Tick {
  readonly second: number;
  /** Race places, metres: effort distance and offset. */
  readonly at: ReadonlyMap<string, number>;
  readonly tactic: ReadonlyMap<string, BotTactic>;
  readonly wbal: ReadonlyMap<string, number>;
  readonly k: ReadonlyMap<string, number>;
  /**
   * How far the two racers drawn furthest inside each other are inside, on
   * this tick, metres: the lesser of how far under a bike length apart along
   * and how far under a place across. Nought or less is clear; two nose to
   * tail on one line are as inside each other as two side by side.
   */
  readonly inside: number;
  /** The same, on the frames drawn between this tick and the one before. */
  readonly insideBetween: number;
  /**
   * How much the bot whose drawn speed changed most against its race speed
   * changed, from the tick before to this one, metres a second (#2558's
   * review, finding A): nought on the first two ticks.
   */
  readonly jolt: number;
  /**
   * How many bots at race speed, over 4 m/s, were drawn under half it on the
   * tick before and over it on this one, or the other way about: the 10 Hz
   * judder of a bot giving way in full and closing up again.
   */
  readonly flips: number;
  /** Every racer as it is drawn, along and across, to the millimetre. */
  readonly drawn: string;
}

/** Every racer on one drawing, along the road and across it, the rider first. */
function placed(
  drawing: ReturnType<typeof lapRaceDrawing>,
): { readonly along: number; readonly lateral: number }[] {
  return [
    { along: drawing.riderDistance, lateral: drawing.steeredLateral },
    ...drawing.raceBots.map((bot) => ({ along: bot.distanceMetres, lateral: bot.lateralMetres })),
  ];
}

/**
 * How far the two racers furthest inside each other on one drawing are
 * inside, metres: the lesser of how far under a bike length apart along and
 * how far under a place across (#2561's review).
 */
function deepest(drawn: readonly { readonly along: number; readonly lateral: number }[]): number {
  let most = Number.NEGATIVE_INFINITY;
  for (const [at, one] of drawn.entries()) {
    for (const other of drawn.slice(at + 1)) {
      most = Math.max(
        most,
        Math.min(
          BIKE_LENGTH_METRES - Math.abs(one.along - other.along),
          PACK_ABREAST_METRES - Math.abs(one.lateral - other.lateral),
        ),
      );
    }
  }
  return most;
}

/** Ride the field `seed` deals on `profile` for {@link RIDDEN_SECONDS}. */
function ride(profile: RouteProfile, seed: number): Tick[] {
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(
    <T extends ArrayBufferView>(array: T): T => {
      (array as unknown as Uint32Array)[0] = seed;
      return array;
    },
  );
  let race = startLapRaceRide({
    choice: { laps: 3, bots: LAP_RACE_MOST_BOTS, tier: 'brisk', itemsOn: false },
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
  vi.restoreAllMocks();
  if (race === undefined) throw new Error('a circuit starts a race');
  let along = race.startAlong;
  const ticks: Tick[] = [];
  // Each bot's drawn place and speed on the tick before, and how much faster
  // than its race speed it was drawn going over it.
  let botsBefore: readonly { readonly along: number; readonly speed: number }[] | undefined;
  let fasterBefore: readonly number[] | undefined;
  const count = Math.round(RIDDEN_SECONDS / LAP_RACE_TICK_SECONDS);
  for (let tick = 1; tick <= count; tick += 1) {
    along += RIDER_SPEED * LAP_RACE_TICK_SECONDS;
    race = stepLapRaceRide(race, { ticks: 1, along, riderWatts: RIDER_WATTS });
    const drawing = lapRaceDrawing(race, along, 0, false);
    const drawn = placed(drawing);
    const bots = drawing.raceBots.map((bot) => ({
      along: bot.distanceMetres,
      speed: bot.speedMetresPerSecond,
    }));
    const drawnSpeeds = bots.map(
      (bot, at) => (bot.along - (botsBefore?.[at]?.along ?? Number.NaN)) / LAP_RACE_TICK_SECONDS,
    );
    const faster = drawnSpeeds.map((speed, at) => speed - (bots[at]?.speed ?? Number.NaN));
    let jolt = 0;
    let flips = 0;
    if (fasterBefore !== undefined) {
      for (const [at, bot] of bots.entries()) {
        const before = (fasterBefore[at] ?? Number.NaN) + (botsBefore?.[at]?.speed ?? Number.NaN);
        const now = drawnSpeeds[at] ?? Number.NaN;
        const change = Math.abs((faster[at] ?? Number.NaN) - (fasterBefore[at] ?? Number.NaN));
        // A NaN is a jolt that fails the bound, never one that passes it.
        jolt = Number.isNaN(change) ? Number.POSITIVE_INFINITY : Math.max(jolt, change);
        if (
          bot.speed > 4 &&
          ((before < 0.5 * bot.speed && now > bot.speed) ||
            (before > bot.speed && now < 0.5 * bot.speed))
        ) {
          flips += 1;
        }
      }
    }
    fasterBefore = botsBefore === undefined ? undefined : faster;
    botsBefore = bots;
    const stepped = race;
    // The frames between this tick and the one before, the rider blended as
    // `simulation.ts` §`drawnAt` blends them (#2561's review).
    const insideBetween = Math.max(
      ...BETWEEN_TICKS.map((back) =>
        deepest(
          placed(
            lapRaceDrawing(
              stepped,
              along - RIDER_SPEED * LAP_RACE_TICK_SECONDS * back,
              back * LAP_RACE_TICK_SECONDS,
              false,
            ),
          ),
        ),
      ),
    );
    const k = lapRaceDraftFactors(race.race);
    ticks.push({
      second: tick * LAP_RACE_TICK_SECONDS,
      at: new Map(
        race.race.racers.map((entry) => [
          entry.racer.id,
          entry.racer.effortDistance + entry.racer.raceOffset,
        ]),
      ),
      tactic: new Map(race.bots.map((bot) => [bot.id, bot.tactics.tactic])),
      wbal: new Map(
        race.bots.map((bot) => [
          bot.id,
          bot.plan === undefined ? 1 : bot.energy.wbalJoules / bot.plan.capacity.wPrimeJoules,
        ]),
      ),
      k: new Map(Object.entries(k)),
      inside: deepest(drawn),
      insideBetween,
      jolt,
      flips,
      drawn: drawn.map((each) => `${each.along.toFixed(3)},${each.lateral.toFixed(3)}`).join(' '),
    });
  }
  return ticks;
}

/** Every field, ridden once, the first time a case asks. */
const ridden = new Map<string, Tick[]>();
function field(name: 'flat' | 'hilly', seed: number): Tick[] {
  const key = `${name} ${String(seed)}`;
  let ticks = ridden.get(key);
  if (ticks === undefined) {
    ticks = ride(name === 'flat' ? FLAT : HILLY, seed);
    ridden.set(key, ticks);
  }
  return ticks;
}

/** Metres from `id` back to the racer behind it on a tick, or `null` when it is last. */
function gapBehind(tick: Tick, id: string): number | null {
  const own = tick.at.get(id) as number;
  const behind = [...tick.at.values()].filter((at) => at < own);
  return behind.length === 0 ? null : own - Math.max(...behind);
}

/** Metres from `id` up to the racer ahead of it on a tick, or `null` when it leads. */
function gapAhead(tick: Tick, id: string): number | null {
  const own = tick.at.get(id) as number;
  const ahead = [...tick.at.values()].filter((at) => at > own);
  return ahead.length === 0 ? null : Math.min(...ahead) - own;
}

/**
 * The moves that got away: runs of ticks in which a bot attacked or went on a
 * flyer and got {@link AWAY_METRES} clear of the racer behind it, during the
 * move or in the 10 s after it.
 */
function awayMoves(ticks: readonly Tick[]): { id: string; from: number; to: number }[] {
  return moves(ticks).filter((move) =>
    ticks
      .slice(move.from, Math.min(ticks.length, move.to + 10 / LAP_RACE_TICK_SECONDS))
      .some((tick) => (gapBehind(tick, move.id) ?? 0) > AWAY_METRES),
  );
}

/** Each bot's moves: runs of ticks in which it attacked or went on a flyer. */
function moves(ticks: readonly Tick[]): { id: string; from: number; to: number }[] {
  const found: { id: string; from: number; to: number }[] = [];
  const bots = [...(ticks[0]?.tactic.keys() ?? [])];
  for (const id of bots) {
    let from: number | undefined;
    ticks.forEach((tick, at) => {
      const moving = tick.tactic.get(id) === 'attack' || tick.tactic.get(id) === 'flyer';
      if (moving && from === undefined) from = at;
      if (!moving && from !== undefined) {
        found.push({ id, from, to: at });
        from = undefined;
      }
    });
    if (from !== undefined) found.push({ id, from, to: ticks.length });
  }
  return found;
}

afterEach(() => vi.restoreAllMocks());

describe.each(['flat', 'hilly'] as const)(
  'seeded seven-bot fields on the %s circuit (#2545)',
  (name) => {
    const { k: draftK, share } = PACK[name];

    it.each(SEEDS)(
      `forms a pack: by ${String(PACK_BY_SECONDS)} s, ${String(Math.round(share * LAP_RACE_MOST_BOTS))} of 7 bots or more in a draft (seed %i)`,
      (seed) => {
        const at = field(name, seed)[
          Math.round(PACK_BY_SECONDS / LAP_RACE_TICK_SECONDS) - 1
        ] as Tick;
        const drafting = [...at.k]
          .filter(([id]) => id !== LAP_RACE_RIDER_ID)
          .filter(([, k]) => k <= draftK).length;
        expect(drafting / LAP_RACE_MOST_BOTS).toBeGreaterThanOrEqual(share);
      },
    );

    it.each(SEEDS)(
      'catches or lets hold every move that gets clear of the group (seed %i)',
      (seed) => {
        const ticks = field(name, seed);
        for (const move of awayMoves(ticks)) {
          const label = `${move.id} from ${String(ticks[move.from]?.second)} s`;
          const ended = ticks[Math.min(move.to, ticks.length - 1)] as Tick;
          const clear = gapBehind(ended, move.id) ?? Number.POSITIVE_INFINITY;
          // Until the end, or until the same bot moves again.
          const next = moves(ticks).find((other) => other.id === move.id && other.from > move.from);
          const after = ticks.slice(move.to, next?.from ?? ticks.length);
          // Caught: back in the group, a wheel or less from a racer either
          // side of it, within CAUGHT_WITHIN_SECONDS of the move's end.
          const caught = after
            .slice(0, CAUGHT_WITHIN_SECONDS / LAP_RACE_TICK_SECONDS)
            .some((tick) => {
              const behind = gapBehind(tick, move.id);
              const ahead = gapAhead(tick, move.id);
              return (
                (behind !== null && behind <= BOT_TACTIC_WHEEL_FURTHEST_METRES) ||
                (ahead !== null && ahead <= BOT_TACTIC_WHEEL_FURTHEST_METRES)
              );
            });
          // Held: never under HELD_SHARE of the gap it had at the move's end.
          const held = after.every(
            (tick) => (gapBehind(tick, move.id) ?? Number.POSITIVE_INFINITY) >= HELD_SHARE * clear,
          );
          expect(caught || held, label).toBe(true);
        }
      },
    );

    it('sees moves leave the group on these fields', () => {
      const away = SEEDS.reduce((sum, seed) => sum + awayMoves(field(name, seed)).length, 0);
      expect(away).toBeGreaterThan(0);
    });

    it.each(SEEDS)(
      'never draws two racers inside each other, nose to tail or side by side, on any tick or between ticks (seed %i)',
      (seed) => {
        const ticks = field(name, seed);
        // Every tick read, and the frames between it and the one before.
        expect(ticks.every((tick) => Number.isFinite(tick.insideBetween))).toBe(true);
        expect(Math.max(...ticks.map((tick) => tick.inside))).toBeLessThanOrEqual(1e-9);
        expect(Math.max(...ticks.map((tick) => tick.insideBetween))).toBeLessThanOrEqual(
          DRAWN_BACK_SLACK_METRES,
        );
      },
    );

    it.each(SEEDS)(
      'draws every bot’s speed smoothly: never giving way and closing up on alternate ticks (seed %i, #2558’s review, finding A)',
      (seed) => {
        const ticks = field(name, seed);
        const jolts = ticks
          .filter((tick) => !(tick.jolt <= EASED_PER_TICK) || tick.flips > 0)
          .map(
            (tick) =>
              `${tick.second.toFixed(2)} s: ${String(tick.jolt)} m/s, ${String(tick.flips)} flips`,
          );
        expect(jolts).toEqual([]);
        // Not vacuous: read from the third tick on, at race speed, the field
        // did give way and close up at the ease (#2561's review): a jolt of
        // over 1.5 m/s, three quarters of it, which rounding never reaches.
        expect(ticks.slice(2).some((tick) => tick.jolt > 1.5)).toBe(true);
      },
    );

    it('replays a field identically', () => {
      const again = ride(name === 'flat' ? FLAT : HILLY, SEEDS[0]);
      // The race and the drawing alike: every place, tactic and W′, and every racer as drawn.
      const trace = (ticks: readonly Tick[]): string =>
        JSON.stringify(ticks.map((tick) => [...tick.at, ...tick.tactic, ...tick.wbal, tick.drawn]));
      expect(trace(again)).toBe(trace(field(name, SEEDS[0])));
    });
  },
);

describe('faders drop off on the hills (#2545)', () => {
  /**
   * The bots that faded: that spent their W′ (under {@link SPENT_SHARE}) in a
   * group, a wheel or less from another racer, and later had every racer of
   * that group, those behind them then included, more than the draft's reach
   * up the road. Slipped through the group to its back, then off it.
   */
  function faders(ticks: readonly Tick[]): string[] {
    const bots = [...(ticks[0]?.wbal.keys() ?? [])];
    return bots.filter((id) => {
      const spent = ticks.findIndex((tick) => {
        if ((tick.wbal.get(id) as number) >= SPENT_SHARE) return false;
        const own = tick.at.get(id) as number;
        return [...tick.at].some(
          ([other, at]) => other !== id && Math.abs(own - at) <= BOT_TACTIC_WHEEL_LOST_METRES,
        );
      });
      if (spent < 0) return false;
      const start = ticks[spent] as Tick;
      const own = start.at.get(id) as number;
      const group = [...start.at]
        .filter(([other, at]) => other !== id && Math.abs(own - at) <= BOT_TACTIC_WHEEL_LOST_METRES)
        .map(([other]) => other);
      return ticks.slice(spent).some((tick) => {
        const at = tick.at.get(id) as number;
        return group.every(
          (other) => (tick.at.get(other) as number) - at > BOT_TACTIC_WHEEL_METRES,
        );
      });
    });
  }

  it('sees a bot spend its W′ in the group, slip to its back and off it', () => {
    const faded = SEEDS.flatMap((seed) => faders(field('hilly', seed)));
    expect(faded.length).toBeGreaterThan(0);
  });
});
