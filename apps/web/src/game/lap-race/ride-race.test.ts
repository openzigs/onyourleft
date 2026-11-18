// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `ride-race.ts`' own refusals and no-op paths — #1906. What a race does
 * inside a ride, read back through the real `GameView`, is
 * `../lap-race-wiring.test.tsx`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_RIDING_POSITION, rideConditionsFor } from '../rider';
import { circuitRoute, northRoute } from '../route-fixtures-testing';
import {
  botArchetype,
  botFieldArchetypes,
  botFieldPaces,
  modelFieldPaces,
  botFieldPersonalities,
  botFieldSkills,
  BOT_LANE_DWELL_MS,
  botTierPlan,
  courseHillsAhead,
  distanceOnRoute,
  gradeAt,
  kilograms,
  racePosition,
} from '@onyourleft/domain';
import { botDemand, lapRaceDraftFactors } from '@onyourleft/physics';

import { botName, lapRaceStandings } from '../hud/lap-race-hud';

import { LAP_RACE_ASSIST_STORAGE_KEY } from './assist-preference';
import {
  askRaceItem,
  askRaceLane,
  countLapRaceDown,
  LAP_RACE_COUNTDOWN_MS,
  LAP_RACE_TICK_SECONDS,
  lapRaceCounting,
  lapRaceBotConditions,
  lapRaceDrawing,
  lapRaceHeard,
  lapRaceHud,
  startLapRaceRide,
  stepLapRaceRide,
  type LapRaceRide,
} from './ride-race';
import { LAP_RACE_MOST_BOTS, type LapRaceChoice } from './choice';
import { modelTacticsInputOf } from './model-race';
import { drawnShift } from './pack-layout';

const LOOP = circuitRoute(40);

/** The race the tablet step for #733 rides: three laps against seven bots, with items. */
const DEFAULT_LAP_RACE: LapRaceChoice = {
  laps: 3,
  bots: LAP_RACE_MOST_BOTS,
  tier: 'brisk',
  itemsOn: true,
};

function race(choice: LapRaceChoice = DEFAULT_LAP_RACE, profile = LOOP): LapRaceRide | undefined {
  return startLapRaceRide({
    choice,
    profile,
    conditions: lapRaceBotConditions(
      profile,
      rideConditionsFor(kilograms(70), DEFAULT_RIDING_POSITION),
    ),
    riderDistance: 0,
    lineOffset: 0,
    storage: undefined,
  });
}

function started(): LapRaceRide {
  const ride = race();
  if (ride === undefined) throw new Error('a loop starts a race');
  return ride;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a different race every time, and AI bots with bodies of their own (#2759, ADR 0076)', () => {
  /** A race with AI bots on the loop, from whatever seed the platform draws. */
  const modelRace = (): LapRaceRide => {
    const ride = startLapRaceRide({
      choice: DEFAULT_LAP_RACE,
      profile: LOOP,
      conditions: lapRaceBotConditions(
        LOOP,
        rideConditionsFor(kilograms(70), DEFAULT_RIDING_POSITION),
      ),
      riderDistance: 0,
      lineOffset: 0,
      storage: undefined,
      model: true,
    });
    if (ride === undefined) throw new Error('a loop starts a race');
    return ride;
  };

  it('draws a fresh seed at every start, so each race deals a different field', () => {
    let next = 41;
    const draw = vi
      .spyOn(globalThis.crypto, 'getRandomValues')
      .mockImplementation(<T extends ArrayBufferView>(array: T): T => {
        (array as unknown as Uint32Array)[0] = next;
        next += 1;
        return array;
      });
    const first = modelRace();
    const second = modelRace();
    // One draw a start, on the same route: never a seed kept per route.
    expect(draw).toHaveBeenCalledTimes(2);
    expect([first.seed, second.seed]).toEqual([41, 42]);
    expect(second.bots.map((bot) => bot.pace)).not.toEqual(first.bots.map((bot) => bot.pace));
    expect(first.bots.map((bot) => bot.pace)).toEqual(modelFieldPaces(41, LAP_RACE_MOST_BOTS));
  });

  it('shows each bot’s W/kg at its own mass in the standings, never at 75 kg', () => {
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(
      <T extends ArrayBufferView>(array: T): T => {
        (array as unknown as Uint32Array)[0] = 7;
        return array;
      },
    );
    let ride = modelRace();
    for (let tick = 1; tick <= 200; tick += 1) {
      ride = stepLapRaceRide(ride, { ticks: 1, along: tick * LAP_RACE_TICK_SECONDS * 8 });
    }
    const hud = lapRaceHud(ride, { wattsPerKilogram: 3, speed: 8 });
    for (const bot of ride.bots) {
      const mass = bot.pace.body?.massKilograms;
      expect(mass, bot.id).toBeDefined();
      expect(mass, bot.id).not.toBe(75);
      expect(hud.entrants[bot.id]?.wattsPerKilogram, bot.id).toBeCloseTo(
        (bot.power as number) / (mass as number),
        9,
      );
    }
  });
});

describe('a lap race in a ride — #1906', () => {
  it('starts the tablet step’s race on a loop: three laps, the rider and seven bots on the line', () => {
    const ride = started();
    expect(ride.race.course.laps).toBe(3);
    expect(ride.race.racers.map((entry) => entry.racer.id)).toEqual([
      'bot-1',
      'bot-2',
      'bot-3',
      'bot-4',
      'bot-5',
      'bot-6',
      'bot-7',
      'rider',
    ]);
    expect(ride.race.racers.every((entry) => entry.racer.effortDistance === 0)).toBe(true);
    // #2455: a bot is named by its pacing style, not by the tier every bot shares.
    expect(ride.names['bot-3']).toBe(botName(ride.bots[2]?.pace.style ?? 'even', 3));
  });

  it('deals each bot its own pace from the race’s seed, and names it by its style (#2455)', () => {
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(
      <T extends ArrayBufferView>(array: T): T => {
        (array as unknown as Uint32Array)[0] = 7;
        return array;
      },
    );
    const ride = started();
    const dealt = botFieldPaces(7, LAP_RACE_MOST_BOTS);
    expect(ride.bots.map((bot) => bot.pace)).toEqual(dealt);
    // All five styles in a field of seven, and seven different abilities.
    expect(new Set(dealt.map((pace) => pace.style)).size).toBe(5);
    expect(new Set(dealt.map((pace) => pace.ability)).size).toBe(LAP_RACE_MOST_BOTS);
    expect(Object.values(ride.names)).toEqual(
      dealt.map((pace, index) => botName(pace.style, index + 1)),
    );
    expect(Object.values(ride.names).some((name) => name.startsWith('Steady'))).toBe(false);
  });

  it('names no two bots of a field alike, over 100 seeds, each by a style that is its archetype’s (#2459)', () => {
    for (let seed = 0; seed < 100; seed += 1) {
      vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(
        <T extends ArrayBufferView>(array: T): T => {
          (array as unknown as Uint32Array)[0] = seed;
          return array;
        },
      );
      const ride = started();
      const names = Object.values(ride.names);
      expect(names, String(seed)).toHaveLength(LAP_RACE_MOST_BOTS);
      expect(new Set(names).size, String(seed)).toBe(LAP_RACE_MOST_BOTS);
      // A bot the standings call a climber races as one: its name and its archetype agree.
      expect(ride.bots.map((bot) => botArchetype(bot.pace.style))).toEqual(
        botFieldArchetypes(seed, LAP_RACE_MOST_BOTS),
      );
      vi.restoreAllMocks();
    }
  });

  it('deals its bots a mixed field from the race’s seed (#1959), a skill each (#2463), on the chosen tier', () => {
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(
      <T extends ArrayBufferView>(array: T): T => {
        (array as unknown as Uint32Array)[0] = 7;
        return array;
      },
    );
    const ride = started();
    const personalities = ride.bots.map((bot) => bot.strategy.personality);
    expect(personalities).toEqual(botFieldPersonalities(7, LAP_RACE_MOST_BOTS));
    expect(new Set(personalities).size).toBe(3);
    // #2463, ADR 0067 D-7: a tactics skill each, dealt from the same seed, all three in the field.
    const skills = ride.bots.map((bot) => bot.strategy.skill);
    expect(skills).toEqual(botFieldSkills(7, LAP_RACE_MOST_BOTS));
    expect(new Set(skills).size).toBe(3);
    expect(ride.bots.map((bot) => bot.tier)).toEqual(
      Array.from({ length: LAP_RACE_MOST_BOTS }, () => 'brisk'),
    );
  });

  it('starts no race on a route that is not a loop', () => {
    expect(
      race(
        DEFAULT_LAP_RACE,
        northRoute(500, () => 0),
      ),
    ).toBeUndefined();
  });

  it('draws the seed from the platform’s cryptographic source, once', () => {
    const draws = vi.spyOn(globalThis.crypto, 'getRandomValues');
    const first = started();
    expect(draws).toHaveBeenCalledTimes(1);
    draws.mockImplementation(<T extends ArrayBufferView>(array: T): T => {
      (array as unknown as Uint32Array)[0] = 7;
      return array;
    });
    expect(started().seed).toBe(7);
    expect(Number.isSafeInteger(first.seed)).toBe(true);
  });

  it.each([0, LAP_RACE_MOST_BOTS + 1, 2.5, Number.NaN])(
    'refuses a field of %s bots, naming the constraint and not the value',
    (bots) => {
      expect(() => race({ ...DEFAULT_LAP_RACE, bots })).toThrow(
        new RangeError('a lap race has a whole number of bots, 1 to 7'),
      );
    },
  );

  it.each([-1, 1.5, Number.NaN])('refuses a step of %s ticks', (ticks) => {
    expect(() => stepLapRaceRide(started(), { ticks, along: 10 })).toThrow(
      new RangeError('a lap race step runs a whole number of ticks, 0 or more'),
    );
  });

  it('steps nothing on a frame that ran no simulation step', () => {
    const ride = started();
    expect(stepLapRaceRide(ride, { ticks: 0, along: 50 })).toBe(ride);
  });

  it('never steps the rider backwards: an odometer behind the last tick is the last tick’s', () => {
    const ride = stepLapRaceRide(started(), { ticks: 2, along: 4 });
    const after = stepLapRaceRide(ride, { ticks: 1, along: 1 });
    const rider = after.race.racers.find((entry) => entry.racer.id === 'rider');
    expect(rider?.racer.effortDistance).toBe(4);
    expect(after.along).toBe(4);
  });

  it.each([
    [true, null],
    [false, 'tailwind'],
  ] as const)(
    'with auto-use %s, a held item is used on the next tick, pressed or not',
    (autoUse, held) => {
      const storage = {
        getItem: (key: string) =>
          key === LAP_RACE_ASSIST_STORAGE_KEY
            ? JSON.stringify({ itemsOff: false, autoUse, noKnockBack: false, gentlerBots: false })
            : null,
        setItem: () => undefined,
      };
      const ride = startLapRaceRide({
        choice: DEFAULT_LAP_RACE,
        profile: LOOP,
        conditions: lapRaceBotConditions(
          LOOP,
          rideConditionsFor(kilograms(70), DEFAULT_RIDING_POSITION),
        ),
        riderDistance: 0,
        lineOffset: 0,
        storage,
      });
      if (ride === undefined) throw new Error('a loop starts a race');
      const holding: LapRaceRide = {
        ...ride,
        race: {
          ...ride.race,
          racers: ride.race.racers.map((entry) =>
            entry.racer.id === 'rider' ? { ...entry, held: 'tailwind' as const } : entry,
          ),
        },
      };
      const after = stepLapRaceRide(holding, { ticks: 1, along: 0.5 });
      expect(after.race.racers.find((entry) => entry.racer.id === 'rider')?.held).toBe(held);
    },
  );

  it('returns the race it was given for a press that changes nothing, and for a silence', () => {
    const ride = started();
    const left = askRaceLane(askRaceLane(ride, 'lane-left'), 'lane-left');
    expect(askRaceLane(left, 'lane-left')).toBe(left);
    const asked = askRaceItem(ride);
    expect(asked).not.toBe(ride);
    expect(askRaceItem(asked)).toBe(asked);
    expect(lapRaceHeard(ride, undefined, 0)).toBe(ride);
  });
});

describe('a race counts down on its line before Go — #2546', () => {
  it('starts counting ten seconds, and counts the frames it is given down to Go', () => {
    const ride = started();
    expect(LAP_RACE_COUNTDOWN_MS).toBe(10_000);
    expect(ride.countdownLeftMs).toBe(LAP_RACE_COUNTDOWN_MS);
    expect(lapRaceCounting(ride)).toBe(true);
    // A frame inside the countdown: held to the frame's end, and that much less left.
    const first = countLapRaceDown(ride, 1_000, 1_016);
    expect(first.heldToMs).toBe(1_016);
    expect(first.ride.countdownLeftMs).toBe(LAP_RACE_COUNTDOWN_MS - 16);
    expect(lapRaceCounting(first.ride)).toBe(true);
    // Nothing else of the race moves while it counts.
    expect(first.ride.race).toBe(ride.race);
    expect(first.ride.bots).toBe(ride.bots);
  });

  it('holds the frame Go falls in only to the instant of Go, and nothing after it', () => {
    const near = { ...started(), countdownLeftMs: 30 };
    // A 50 ms frame from 2 000: Go at 2 030, and the rider is held to it, not to 2 050.
    const go = countLapRaceDown(near, 2_000, 2_050);
    expect(go.heldToMs).toBe(2_030);
    expect(go.ride.countdownLeftMs).toBe(0);
    expect(lapRaceCounting(go.ride)).toBe(false);
    // Exactly at the frame's end is Go too, held to that end.
    expect(countLapRaceDown(near, 2_000, 2_030).heldToMs).toBe(2_030);
    // Counted out: the same race, and no hold.
    const after = countLapRaceDown(go.ride, 2_050, 2_100);
    expect(after.ride).toBe(go.ride);
    expect(after.heldToMs).toBeUndefined();
  });

  it('counts nothing for a frame that ran backwards', () => {
    const ride = started();
    const backwards = countLapRaceDown(ride, 5_000, 4_000);
    expect(backwards.ride.countdownLeftMs).toBe(LAP_RACE_COUNTDOWN_MS);
    expect(backwards.heldToMs).toBe(4_000);
  });

  it('never draws a bot behind the ride’s start, one tick off the line from rest and a whole step back', () => {
    const ride = stepLapRaceRide(started(), { ticks: 1, along: 0.01 });
    // Non-vacuity: the bots are moving, and drawn a step back along that speed is behind nought.
    for (const bot of ride.bots) expect(bot.ride.speed as number).toBeGreaterThan(0);
    const drawn = lapRaceDrawing(ride, 0, LAP_RACE_TICK_SECONDS, false);
    expect(drawn.raceBots).toHaveLength(ride.bots.length);
    for (const bot of drawn.raceBots) expect(bot.distanceMetres).toBeGreaterThanOrEqual(0);
  });
});

/** A flat loop of about 940 m, as the owner's default race rode: three laps, seven Brisk bots, no items. */
const FLAT_LOOP = circuitRoute(150, () => 0);
const SPREAD_RACE: LapRaceChoice = {
  laps: 3,
  bots: LAP_RACE_MOST_BOTS,
  tier: 'brisk',
  itemsOn: false,
};
/** The rider's steady pace, metres per second: about the bots', so the field stays near them. */
const RIDER_SPEED = 8.5;

/** A race's samples: the leader's lap, and every bot's gap as the standings write it. */
type GapSamples = readonly { readonly lap: number; readonly gaps: readonly string[] }[];

/**
 * {@link rideGaps} for `seed`, ridden once by the first case that asks and
 * read by every other: a whole three-lap race of seven bots is the cost of
 * these cases, and the second reads seed 1 again (#1688's ruling: a slow case
 * is made cheaper, never given a longer timeout).
 */
const gapsBySeed = new Map<number, GapSamples>();
function sampledGaps(seed: number): GapSamples {
  let samples = gapsBySeed.get(seed);
  if (samples === undefined) {
    samples = rideGaps(seed);
    gapsBySeed.set(seed, samples);
  }
  return samples;
}

/** The race under `seed`, and every bot's gap as the standings write it, every two seconds. */
function rideGaps(seed: number): GapSamples {
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(
    <T extends ArrayBufferView>(array: T): T => {
      (array as unknown as Uint32Array)[0] = seed;
      return array;
    },
  );
  let ride = race(SPREAD_RACE, FLAT_LOOP);
  if (ride === undefined) throw new Error('a loop starts a race');
  const lapLength = ride.race.course.lapLengthMetres;
  const samples: { lap: number; gaps: string[] }[] = [];
  // Two seconds of 50 ms ticks: the owner's sampling of the live race.
  const everyTicks = 2 / LAP_RACE_TICK_SECONDS;
  for (let tick = 1; tick < 20_000; tick += 1) {
    ride = stepLapRaceRide(ride, { ticks: 1, along: tick * LAP_RACE_TICK_SECONDS * RIDER_SPEED });
    const bots = ride.race.racers.filter((entry) => entry.racer.id !== 'rider');
    if (bots.some((entry) => entry.racer.finishedAtMs !== null)) break;
    if (tick % everyTicks === 0) {
      const lines = lapRaceStandings(
        lapRaceHud(ride, { wattsPerKilogram: 3, speed: RIDER_SPEED }),
      ).lines;
      const leader = Math.max(...bots.map((entry) => entry.racer.effortDistance));
      samples.push({
        lap: Math.floor(leader / lapLength),
        gaps: lines.filter((line) => !line.you).map((line) => line.gap),
      });
    }
  }
  return samples;
}

describe('the rider gives and takes a draft, with the switch on (#2461, ADR 0067 D-3)', () => {
  /** One bot and the rider, items off, the seed fixed, the switch as given. */
  function oneBot(draft: boolean | undefined): LapRaceRide {
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(
      <T extends ArrayBufferView>(array: T): T => {
        (array as unknown as Uint32Array)[0] = 7;
        return array;
      },
    );
    const ride = startLapRaceRide({
      choice: { laps: 3, bots: 1, tier: 'brisk', itemsOn: false },
      profile: LOOP,
      conditions: lapRaceBotConditions(
        LOOP,
        rideConditionsFor(kilograms(70), DEFAULT_RIDING_POSITION),
      ),
      riderDistance: 0,
      lineOffset: 0,
      storage: undefined,
      ...(draft === undefined ? {} : { draft }),
    });
    if (ride === undefined) throw new Error('a loop starts a race');
    return ride;
  }

  /** 30 s of ticks with the rider held 2 m behind the bot on effort distance, once it is that far up. */
  function onTheWheel(start: LapRaceRide): { ride: LapRaceRide; ks: number[]; field: number[] } {
    let ride = start;
    const ks: number[] = [];
    const field: number[] = [];
    for (let tick = 0; tick < 30 / LAP_RACE_TICK_SECONDS; tick += 1) {
      const bot = ride.bots[0];
      if (bot === undefined) throw new Error('a one-bot race has its bot');
      // The field's `k` as the race stands before the tick: what the tick drafts on.
      field.push(lapRaceDraftFactors(ride.race).rider ?? Number.NaN);
      ride = stepLapRaceRide(ride, { ticks: 1, along: bot.ride.distance - 2 });
      ks.push(ride.riderDraft);
    }
    return { ride, ks, field };
  }

  it('hands the rider the k the field’s one draft call gave it, every tick: in the draft 2 m behind a bot', () => {
    const start = oneBot(true);
    expect(start.draft).toBe(true);
    expect(start.riderDraft).toBe(1);
    const { ks, field } = onTheWheel(start);
    // With the switch on, the rider's `k` is the field's, tick for tick: the
    // one call `stepBotRace` made, never a walk of its own.
    expect(ks).toEqual(field);
    // Two metres behind the bot is ADR 0038's table between 1 m and 5 m.
    const settled = ks.slice(ks.length / 2);
    for (const k of settled) expect(k).toBeGreaterThan(0.66);
    for (const k of settled) expect(k).toBeLessThan(0.71);
  });

  it('hands the rider the last tick’s k of a frame that ran several steps, as the single ticks would: a low frame rate is the same race', () => {
    // A tablet at low fps runs several steps in one frame (the documented
    // contract): the rider arrives at the bot's wheel in the frame's last tick.
    const start = oneBot(true);
    const bot = start.bots[0];
    if (bot === undefined) throw new Error('a one-bot race has its bot');
    // Held back first so the frame's first ticks are out of the draft: 20 m
    // behind, closing to 2 m behind in the frame.
    const behind = stepLapRaceRide(start, { ticks: 1, along: bot.ride.distance - 20 });
    const target = (behind.bots[0]?.ride.distance ?? 0) - 2;
    const frame = stepLapRaceRide(behind, { ticks: 3, along: target });
    let single = behind;
    const ks: number[] = [];
    for (let tick = 1; tick <= 3; tick += 1) {
      single = stepLapRaceRide(single, {
        ticks: 1,
        along: behind.along + ((target - behind.along) * tick) / 3,
      });
      ks.push(single.riderDraft);
    }
    // Not vacuous: the first tick was alone and the last was sheltered.
    expect(ks[0]).toBe(1);
    expect(ks[2]).toBeLessThan(1);
    expect(frame.riderDraft).toBe(ks[2]);
  });

  it('drafts nobody with the switch off or absent: the rider at 1 and the bots as the race before #2461', () => {
    const off = onTheWheel(oneBot(false));
    const absent = onTheWheel(oneBot(undefined));
    const on = onTheWheel(oneBot(true));
    expect(oneBot(undefined).draft).toBe(false);
    expect(off.ks.every((k) => k === 1)).toBe(true);
    expect(off.ride.bots).toEqual(absent.ride.bots);
    expect(off.ride.race).toEqual(absent.ride.race);
    // Not vacuous: the same ticks with the switch on drafted the rider. The
    // bot in front gets ADR 0038's small lead effect, so it rides further.
    expect(on.ks.some((k) => k < 1)).toBe(true);
    expect(on.ride.bots[0]?.ride.distance).toBeGreaterThan(off.ride.bots[0]?.ride.distance ?? 0);
  });
});

describe('the field spreads into a race: the bots ride apart (#2455)', () => {
  // One seed a case, so no case rides more than one race: the three in one
  // case took 5.0 s under coverage on CI once the pack stack stepped each tick
  // (the nightly of 2026-11-13 on #2561's branch).
  it.each([1, 2, 3])(
    'reads at least four different gaps among the seven bots over a lap, on a seeded race (seed %i)',
    (seed) => {
      const samples = sampledGaps(seed);
      const lastLap = samples.filter((sample) => sample.lap === 2);
      expect(lastLap.length).toBeGreaterThan(30);
      // Every gap the standings showed over the last lap, bot by bot.
      const most = Math.max(...lastLap.map((sample) => new Set(sample.gaps).size));
      expect(most).toBeGreaterThanOrEqual(4);
      // And never one stacked group once the first lap is ridden.
      const stacked = samples.filter(
        (sample) => sample.lap >= 1 && new Set(sample.gaps).size === 1,
      );
      expect(stacked).toEqual([]);
    },
  );

  it('changes the gaps as it goes: the spread between the first and the last bot grows and shrinks', () => {
    const seconds = (gap: string): number => {
      const sign = gap.startsWith('−') ? -1 : 1;
      return sign * Number.parseInt(gap.replace(/^[+−]/u, ''), 10);
    };
    const spreads = sampledGaps(1).map((sample) => {
      const values = sample.gaps.map(seconds).filter(Number.isFinite);
      return Math.max(...values) - Math.min(...values);
    });
    // Not one spread held from start to finish: it moves, which is a race.
    expect(new Set(spreads).size).toBeGreaterThanOrEqual(4);
  });
});

describe('a bot is drawn every frame, where its own speed puts it (#2455’s check)', () => {
  it('moves each bot forward continuously between race ticks, frame by frame', () => {
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(
      <T extends ArrayBufferView>(array: T): T => {
        (array as unknown as Uint32Array)[0] = 2_455;
        return array;
      },
    );
    // Items off: a hit moves a bot back on purpose (`items.ts`), which is not what is asked here.
    let ride = race({ ...DEFAULT_LAP_RACE, itemsOn: false }) as LapRaceRide;
    const frame = 1 / 60;
    let pending = 0;
    let along = 0;
    let before: readonly number[] | undefined;
    let speedsBefore: readonly number[] | undefined;
    for (let at = 0; at < 30; at += frame) {
      pending += frame;
      let ticks = 0;
      while (pending >= LAP_RACE_TICK_SECONDS) {
        pending -= LAP_RACE_TICK_SECONDS;
        ticks += 1;
      }
      along += ticks * LAP_RACE_TICK_SECONDS * RIDER_SPEED;
      ride = stepLapRaceRide(ride, { ticks, along });
      // As `GameView` hands it: how far the drawn frame sits behind the newest step.
      const drawn = lapRaceDrawing(ride, along, LAP_RACE_TICK_SECONDS - pending, false);
      const distances = drawn.raceBots.map((bot) => bot.distanceMetres);
      const speeds = drawn.raceBots.map((bot) => bot.speedMetresPerSecond);
      expect(distances).toHaveLength(LAP_RACE_MOST_BOTS);
      if (before !== undefined) {
        distances.forEach((distance, index) => {
          const label = `bot ${String(index + 1)} at ${at.toFixed(3)} s`;
          const moved = distance - (before?.[index] ?? distance);
          const speed = speeds[index] ?? 0;
          // Never back by more than its speed changed over a tick: a bot is
          // drawn back from its newest place along its newest speed, so one
          // gathering speed sits up to that far behind the frame before, for a
          // frame. Millimetres to a couple of centimetres, and never a jump.
          const gathered = Math.abs(speed - (speedsBefore?.[index] ?? speed));
          expect(moved, label).toBeGreaterThanOrEqual(-gathered * LAP_RACE_TICK_SECONDS - 1e-6);
          expect(moved, label).toBeLessThan(speed * frame * 2 + 0.05);
        });
      }
      before = distances;
      speedsBefore = speeds;
    }
  });
});

describe('a lap race is drawn between its ticks, across and along, as it moves — #2665', () => {
  /** A seeded race, stepped a tick at a time at the rider's pace, until `until` says so or 120 s. */
  function rideUntil(
    seed: number,
    choice: LapRaceChoice,
    until: (ride: LapRaceRide) => boolean,
  ): LapRaceRide {
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(
      <T extends ArrayBufferView>(array: T): T => {
        (array as unknown as Uint32Array)[0] = seed;
        return array;
      },
    );
    let ride = race(choice) as LapRaceRide;
    vi.restoreAllMocks();
    let along = 0;
    for (let tick = 0; tick < 2_400; tick += 1) {
      along += 8 * LAP_RACE_TICK_SECONDS;
      ride = stepLapRaceRide(ride, { ticks: 1, along, riderWatts: 200 });
      if (until(ride)) return ride;
    }
    throw new Error('the race never came to what was asked of it');
  }

  it('draws a bot an item is moving back along its effort speed and its race offset’s rate, not its effort speed alone', () => {
    // A tick on which some bot's offset is moving fast: an item running on it.
    const ride = rideUntil(7, DEFAULT_LAP_RACE, (each) =>
      [...each.offsetRates.values()].some((rate) => Math.abs(rate) > 0.5),
    );
    const [id, rate] = [...ride.offsetRates].find(([, each]) => Math.abs(each) > 0.5) as [
      string,
      number,
    ];
    const at = ride.race.racers.findIndex((entry) => entry.racer.id === id);
    const entry = ride.race.racers[at];
    const bot = ride.bots.find((each) => each.id === id);
    const place = ride.pack.get(id);
    if (entry === undefined || bot === undefined || place === undefined) throw new Error('a bot');
    // The rate is the offset's own over the tick: an item moves it at most 2 m/s, the drift 0.25.
    expect(Math.abs(rate)).toBeLessThanOrEqual(2 + 0.25 + 1e-9);
    const behind = LAP_RACE_TICK_SECONDS / 2;
    // The drawing lists the bots in the race's own order, the rider left out.
    const drawnAt = ride.race.racers
      .filter((each) => ride.bots.some((one) => one.id === each.racer.id))
      .findIndex((each) => each.racer.id === id);
    const drawn = lapRaceDrawing(ride, ride.along, behind, false).raceBots[drawnAt];
    expect(drawn?.distanceMetres).toBeCloseTo(
      ride.startAlong +
        racePosition(entry.racer) +
        drawnShift(place, behind, LAP_RACE_TICK_SECONDS) -
        ((bot.ride.speed as number) + rate) * behind,
      9,
    );
  });

  it('draws the rider and each bot across between the tick before’s place and the newest’s', () => {
    // A tick on which a bot is moving across.
    const ride = rideUntil(3, { ...DEFAULT_LAP_RACE, itemsOn: false }, (each) =>
      [...each.pack.values()].some((place) => Math.abs(place.sway) > 0.5),
    );
    // The drawing lists the bots in the race's own order, the rider left out.
    const order = ride.race.racers
      .map((entry) => entry.racer.id)
      .filter((id) => ride.bots.some((bot) => bot.id === id));
    const at = order.findIndex((id) => Math.abs(ride.pack.get(id)?.sway ?? 0) > 0.5);
    const place = ride.pack.get(order[at] as string);
    if (place === undefined) throw new Error('a bot moving across');
    const across = (behind: number): number =>
      lapRaceDrawing(ride, ride.along, behind, false).raceBots[at]?.lateralMetres ?? Number.NaN;
    expect(across(0)).toBe(place.lateral);
    expect(across(LAP_RACE_TICK_SECONDS)).toBe(place.lateralBefore);
    expect(across(LAP_RACE_TICK_SECONDS / 2)).toBeCloseTo(
      (place.lateral + place.lateralBefore) / 2,
      12,
    );
    // Its sway between the two ticks' too, which turns and leans it on every frame.
    const sway = (behind: number): number =>
      lapRaceDrawing(ride, ride.along, behind, false).raceBots[at]?.swayMetresPerSecond ??
      Number.NaN;
    expect(sway(0)).toBe(place.sway);
    expect(sway(LAP_RACE_TICK_SECONDS)).toBe(place.swayBefore);
    // And the rider, steered across, between where they were and where they are.
    let steered = askRaceLane(ride, 'lane-right');
    steered = stepLapRaceRide(steered, { ticks: 1, along: steered.along + 0.4 });
    expect(steered.steeredBefore).not.toBe(steered.input.steer.offset);
    const rider = (behind: number): number =>
      lapRaceDrawing(steered, steered.along, behind, false).steeredLateral;
    expect(rider(0)).toBe(steered.input.steer.offset);
    expect(rider(LAP_RACE_TICK_SECONDS)).toBe(steered.steeredBefore);
  });

  it('rolls the field off its grid in the lanes it stands in, holding each for a dwell from Go', () => {
    const ride = started();
    for (const bot of ride.bots) expect(bot.memory.laneSinceMs, bot.id).toBe(0);
    // Read back through the race: no bot changes lane within the dwell after Go.
    const lanes = ride.race.racers.map((entry) => entry.lane);
    let stepped = ride;
    let along = 0;
    for (let tick = 1; tick * LAP_RACE_TICK_SECONDS * 1_000 < BOT_LANE_DWELL_MS; tick += 1) {
      along += 8 * LAP_RACE_TICK_SECONDS;
      stepped = stepLapRaceRide(stepped, { ticks: 1, along });
      expect(stepped.race.racers.map((entry) => entry.lane)).toEqual(lanes);
    }
  });
});

describe('the bots ride the road from the line — #2800', () => {
  // The issue's circuit: 628 m round, flat for 100 m, 250 m up at 6 %, then
  // down to the line.
  const ROUND = 2 * Math.PI * 100;
  const HILL = circuitRoute(100, (along) =>
    along < 100 ? 0 : along < 350 ? 0.06 * (along - 100) : 15 * (1 - (along - 350) / (ROUND - 350)),
  );

  function raceFrom(riderDistance: number): LapRaceRide {
    const ride = startLapRaceRide({
      choice: { ...DEFAULT_LAP_RACE, itemsOn: false },
      profile: HILL,
      conditions: lapRaceBotConditions(
        HILL,
        rideConditionsFor(kilograms(70), DEFAULT_RIDING_POSITION),
      ),
      riderDistance,
      lineOffset: 0,
      storage: undefined,
    });
    if (ride === undefined) throw new Error('a circuit starts a race');
    return { ...ride, countdownLeftMs: 0 };
  }

  /** The grade on the road where the race draws `id`: at the line plus its effort distance. */
  function gradeWhereDrawn(ride: LapRaceRide, id: string, ahead = 0): number {
    const racer = ride.race.racers.find((entry) => entry.racer.id === id)?.racer;
    if (racer === undefined) throw new Error('a racer in the race');
    return gradeAt(HILL, distanceOnRoute(HILL, ride.startAlong + racer.effortDistance + ahead));
  }

  it.each([
    ['300 m round the lap', 300],
    ['300 m round its third lap', 300 + 2 * ROUND],
  ])(
    'has each bot feel, and the model read ahead of it, the grade where it is drawn, from %s',
    (_, line) => {
      let ride = raceFrom(line);
      let along = line;
      let climbed = 0;
      // About 20 s, as the issue's evidence: 100 ms frames, two ticks a frame.
      for (let frame = 0; frame < 200; frame += 1) {
        along += 8 * 2 * LAP_RACE_TICK_SECONDS;
        ride = stepLapRaceRide(ride, { ticks: 2, along });
        for (const bot of ride.bots) {
          // What the bot's tick reads the grade through: its ride and the race's course.
          const felt = botDemand(bot.ride, { ...ride.conditions, plan: botTierPlan(bot.tier) });
          const drawn = gradeWhereDrawn(ride, bot.id);
          expect(felt.grade, `${bot.id} at frame ${String(frame)}`).toBeCloseTo(drawn, 6);
          if (drawn > 2) climbed += 1;
        }
      }
      // Non-vacuity: the field is on the climb where it is drawn, and the
      // route's own start is flat for the bots' first 100 m.
      expect(climbed).toBeGreaterThan(ride.bots.length * 50);
      // And the model is shown the grade 50 m up the road the bots ride.
      const input = modelTacticsInputOf(
        ride.race,
        ride.bots,
        ride.conditions,
        ride.seed,
        false,
        3,
        0,
      );
      if (input === undefined) throw new Error('bots still racing');
      for (const view of input.bots) {
        const bot = ride.bots[view.bot];
        if (bot === undefined) throw new Error('a seat in the field');
        // Shown to a whole per cent (#2759, ADR 0076 D-11): within half of one of the exact grade.
        const exact = gradeWhereDrawn(ride, bot.id, 50);
        expect(Math.abs(view.gradeAheadPct - exact), bot.id).toBeLessThanOrEqual(0.5 + 1e-9);
      }
      // And the course ahead (#2794) is read on that road too: from where the
      // bot at the head of the race is drawn, so its next hill is the one the
      // bot is about to feel.
      const head = input.bots.reduce((best, view) => (view.rank < best.rank ? view : best));
      const leader = ride.bots[head.bot];
      if (leader === undefined) throw new Error('a seat in the field');
      const effort = ride.race.racers.find((entry) => entry.racer.id === leader.id)?.racer
        .effortDistance as number;
      const { laps, lapLengthMetres } = ride.race.course;
      expect({ climb: input.course?.climb, descent: input.course?.descent }).toEqual(
        courseHillsAhead(HILL, ride.startAlong + effort, laps * lapLengthMetres - effort),
      );
      // Non-vacuity: the leader is over the top and descending where it is
      // drawn, so the course says the descent is under it now — read from the
      // route's start it would be on the climb at 100 m to 350 m instead.
      const felt = botDemand(leader.ride, {
        ...ride.conditions,
        plan: botTierPlan(leader.tier),
      }).grade;
      expect(felt).toBeLessThan(-3);
      expect(input.course?.descent?.inM).toBe(0);
    },
  );
});
