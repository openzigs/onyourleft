// SPDX-License-Identifier: Apache-2.0

/**
 * #1900: bots in a solo lap race, on the #92 bot pacer.
 *
 * `./simulate` is wrapped as `pacer.test.ts` wraps it. Every assertion runs
 * the real `advance`, and the spy lets one test replace a single call with a
 * sentinel. A bot on separate maths would ignore the sentinel.
 */

import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import type {
  BotPace,
  BotPacingStyle,
  BotStrategy,
  BotTier,
  GhostSamples,
  GhostTrack,
  ItemRaceState,
  RecordedSeries,
  RouteProfile,
  RoutePoint,
} from '@onyourleft/domain';
import {
  altitudeMetres,
  BOT_ABILITY_SPREAD,
  BOT_MASS_KILOGRAMS,
  BOT_PACING_STYLES,
  botFieldPaces,
  BOT_PERSONALITIES,
  BOT_TIER_WATTS_PER_KILOGRAM,
  botPlanStep,
  botRacePlan,
  botWPrimeJoules,
  createItemRace,
  degreesCelsius,
  degreesLatitude,
  degreesLongitude,
  distanceOnRoute,
  fullBotEnergy,
  geographicPosition,
  gradeAt,
  MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM,
  metres,
  PACING_FACTOR_CEILING,
  PACING_FACTOR_FLOOR,
  metresPerSecond,
  raceCourse,
  routeProfile,
  seconds,
  standings,
} from '@onyourleft/domain';

import { airDensityKilogramsPerCubicMetre } from './air';
import lapRaceBotSource from './lap-race-bot.ts?raw';
import {
  lapRaceBot,
  stepBotRace,
  type BotRaceStep,
  type LapRaceBot,
  type LapRaceBotConditions,
} from './lap-race-bot';
import { advance, type RideState } from './simulate';

vi.mock('./simulate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./simulate')>();
  return { ...actual, advance: vi.fn(actual.advance) };
});

const AIR = airDensityKilogramsPerCubicMetre(altitudeMetres(0), degreesCelsius(15));

/** 500 m out and back, so it closes as a loop; `climb` metres at the turn. */
function loop(climb: number): RouteProfile {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 50; index += 1) {
    const out = index <= 25 ? index : 50 - index;
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (out * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres((out * climb) / 25),
    });
  }
  return routeProfile(points, { loop: true });
}

const FLAT = loop(0);
const HILLY = loop(20);

/** The solo race's skill, and a personality: what a bot decides by when a test does not care. */
const STRATEGY: BotStrategy = { personality: 'opportunist', skill: 'canny' };

/** A racer in a test field: its tier, and its strategy when the test sets one. */
interface Entrant {
  readonly id: string;
  readonly tier: BotTier;
  readonly strategy?: BotStrategy;
  /** Its pace when the test sets one (#2455); the even pace at full ability otherwise. */
  readonly pace?: BotPace;
}

function conditions(profile: RouteProfile, integrationStepSeconds?: number): LapRaceBotConditions {
  return {
    profile,
    airDensityKilogramsPerCubicMetre: AIR,
    ...(integrationStepSeconds === undefined ? {} : { integrationStepSeconds }),
  };
}

interface Run {
  readonly races: readonly ItemRaceState[];
  readonly bots: readonly (readonly LapRaceBot[])[];
}

/**
 * A solo race of bots, one tick a second, until every bot has finished or `limit` ticks.
 * `integrationStepSeconds` is the physics' sub-step inside each tick, `advance`'s 10 ms
 * when not given.
 */
function race(
  profile: RouteProfile,
  field: readonly Entrant[],
  seed: number,
  itemsOn: boolean,
  limit = 2_000,
  integrationStepSeconds?: number,
): Run {
  let state = createItemRace({
    course: raceCourse(profile.totalDistance, 3),
    seed,
    itemsOn,
    racerIds: field.map((bot) => bot.id),
    startMs: 0,
  });
  let bots: readonly LapRaceBot[] = field.map((bot) =>
    lapRaceBot(bot.id, bot.tier, bot.strategy ?? STRATEGY, bot.pace),
  );
  const races = [state];
  const all = [bots];
  for (let tick = 0; tick < limit; tick += 1) {
    if (state.racers.every((entry) => entry.racer.finishedAtMs !== null)) break;
    const next = stepBotRace(state, bots, {
      elapsed: seconds(1),
      conditions: conditions(profile, integrationStepSeconds),
      seed,
    });
    state = next.race;
    bots = next.bots;
    // The spy keeps every call; a whole race of them is most of what a run costs.
    vi.mocked(advance).mockClear();
    races.push(state);
    all.push(bots);
  }
  return { races, bots: all };
}

describe('a lap-race bot is the #92 bot, on the one physics', () => {
  it('rides on whatever advance returns, so it cannot be on separate maths', () => {
    const sentinel: RideState = { speed: metresPerSecond(42), distance: metres(1234) };
    vi.mocked(advance).mockReturnValueOnce(sentinel);
    const start = createItemRace({
      course: raceCourse(FLAT.totalDistance, 3),
      seed: 1,
      itemsOn: false,
      racerIds: ['bot'],
      startMs: 0,
    });
    const { race: next, bots } = stepBotRace(start, [lapRaceBot('bot', 'hard', STRATEGY)], {
      elapsed: seconds(1),
      conditions: conditions(FLAT),
      seed: 1,
    });
    expect(bots[0]?.ride).toBe(sentinel);
    expect(next.racers[0]?.racer.effortDistance).toBe(1234);
  });

  it('rides at the bot’s 75 kg, with its race plan’s power at its tier, from a full W′ (#2458)', () => {
    vi.mocked(advance).mockClear();
    const start = createItemRace({
      course: raceCourse(FLAT.totalDistance, 3),
      seed: 1,
      itemsOn: false,
      racerIds: ['bot'],
      startMs: 0,
    });
    const { bots } = stepBotRace(start, [lapRaceBot('bot', 'hard', STRATEGY)], {
      elapsed: seconds(1),
      conditions: conditions(FLAT),
      seed: 1,
    });
    const [, step, rideConditions] = vi.mocked(advance).mock.calls[0] ?? [];
    expect(rideConditions?.totalMass).toBe(75);
    // 3.6 W/kg at 75 kg on the flat: its CP, so its full W′ is untouched (#2458).
    expect(step?.power).toBeCloseTo(270, 6);
    expect(bots[0]?.power).toBe(step?.power);
    expect(lapRaceBot('bot', 'hard', STRATEGY).energy).toEqual({
      wbalJoules: botWPrimeJoules('hard'),
      exhausted: false,
    });
    expect(bots[0]?.energy).toEqual({ wbalJoules: botWPrimeJoules('hard'), exhausted: false });
  });
});

describe('the travel it hands the bot decision', () => {
  it('is the bot’s speed times the tick, which its last call grows with', () => {
    const total = FLAT.totalDistance * 3;
    const start = createItemRace({
      course: raceCourse(FLAT.totalDistance, 3),
      seed: 1,
      itemsOn: true,
      racerIds: ['bot'],
      startMs: 0,
    });
    // The bot 60 m from the line, past the last pick-up point, with a tow and no one to pull it.
    const near: ItemRaceState = {
      ...start,
      racers: start.racers.map((entry) => ({
        ...entry,
        racer: { ...entry.racer, effortDistance: total - 60 },
        held: 'tow' as const,
        pickUpsPassed: 9,
      })),
    };
    const fast: LapRaceBot = {
      ...lapRaceBot('bot', 'fierce', STRATEGY),
      ride: { speed: metresPerSecond(20), distance: metres(total - 60) },
    };
    const held = (elapsed: number): string | null | undefined =>
      stepBotRace(near, [fast], {
        elapsed: seconds(elapsed),
        conditions: conditions(FLAT),
        seed: 1,
      }).race.racers[0]?.held;
    // 1 s ticks carry it 20 m: 5 m and two ticks short of the line is 45 m, so it holds on.
    expect(held(1)).toBe('tow');
    // 1.5 s ticks carry it 30 m: two of them reach the line, so it spends the tow now.
    expect(held(1.5)).toBeNull();
  });
});

describe('its inputs are a tier, the pacing rule, the course and a seed (ADR 0007 D4)', () => {
  it('takes no activity, stream or ghost type anywhere in its public signatures', () => {
    expectTypeOf(lapRaceBot).parameters.toEqualTypeOf<
      [id: string, tier: BotTier, strategy: BotStrategy, pace?: BotPace]
    >();
    expectTypeOf(stepBotRace).parameters.toEqualTypeOf<
      [race: ItemRaceState, bots: readonly LapRaceBot[], step: BotRaceStep]
    >();
    expectTypeOf<keyof BotRaceStep>().toEqualTypeOf<'elapsed' | 'conditions' | 'seed' | 'rider'>();
    expectTypeOf<keyof LapRaceBot>().toEqualTypeOf<
      'id' | 'tier' | 'strategy' | 'pace' | 'memory' | 'energy' | 'ride' | 'power'
    >();
    // #2455: a pace is a style key and a number, with nowhere for a recorded ride.
    expectTypeOf<keyof BotPace>().toEqualTypeOf<'style' | 'ability'>();
    expectTypeOf<BotPace['ability']>().toEqualTypeOf<number>();
    expectTypeOf<keyof LapRaceBotConditions>().toEqualTypeOf<
      | 'profile'
      | 'airDensityKilogramsPerCubicMetre'
      | 'headwindMetresPerSecond'
      | 'coefficients'
      | 'integrationStepSeconds'
    >();
    // A recorded ride is not a bot, nor a step, nor a course.
    expectTypeOf<GhostTrack>().not.toMatchTypeOf<LapRaceBot>();
    expectTypeOf<GhostSamples>().not.toMatchTypeOf<BotRaceStep>();
    expectTypeOf<RecordedSeries<{ power: number }>>().not.toMatchTypeOf<LapRaceBotConditions>();
  });

  it('imports nothing from the domain’s ghost/ or recording/', () => {
    // Every specifier, as `packages/domain/src/lap-race/bots.test.ts` reads
    // them: `from '…'` (named, namespace, default and `export … from`), a bare
    // side-effect `import '…'`, and a dynamic `import('…')`.
    const specifiers = [...lapRaceBotSource.matchAll(/\b(?:from|import)\s*\(?\s*'([^']+)'/g)].map(
      (match) => match[1] ?? '',
    );
    // The whole of what it reaches: the domain barrel, and two modules of its own package.
    expect([...new Set(specifiers)].sort()).toEqual([
      './pacer',
      './simulate',
      '@onyourleft/domain',
    ]);
    for (const specifier of specifiers) expect(specifier).not.toMatch(/ghost|recording/);
    // The barrel reaches every domain export, so what is taken from it must be
    // a list of names: no namespace import, no re-export, and no dynamic import.
    expect(lapRaceBotSource).not.toMatch(/\bimport\s+(?:type\s+)?\*/);
    expect(lapRaceBotSource).not.toMatch(/^\s*export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s*from\b/m);
    expect(lapRaceBotSource).not.toMatch(/\bimport\s*\(/);

    const imported = [
      ...lapRaceBotSource.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'/g),
    ];
    // Every import is one of these braces: a default or side-effect import is not.
    expect(imported.length).toBe(specifiers.length);
    const fromDomain = imported
      .filter((match) => match[3] === '@onyourleft/domain')
      .flatMap((match) => (match[2] ?? '').split(','))
      .map((name) => name.replace(/^\s*type\s+/, '').trim())
      .filter((name) => name.length > 0)
      .sort();
    // Every name, held to a list: a ghost or recording export is none of these.
    expect(fromDomain).toEqual(
      [
        'BOT_EVEN_PACE',
        'BOT_MEMORY_AT_START',
        'BotEnergy',
        'BotMemory',
        'BotPace',
        'BotStrategy',
        'BotTier',
        'ItemRaceState',
        'RaceTickInput',
        'Seconds',
        'Watts',
        'botPlanStep',
        'botRacePlan',
        'botTierPlan',
        'botWPrimeJoules',
        'stepRace',
        'strategicBotDecision',
      ].sort(),
    );
  });
});

describe('tiers decide a race with no items', () => {
  it(
    'finishes three tiers in tier order on a flat 3-lap loop, every seed of 100',
    { timeout: 30_000 },
    () => {
      // With items off a seed reaches only the bots' lanes, which nothing but
      // a hit reads, so these are one race a hundred times: the AC's letter,
      // and a guard that no seed-dependent path moves a racer.
      for (let seed = 1; seed <= 100; seed += 1) {
        const run = race(
          FLAT,
          [
            { id: 'a', tier: 'brisk' },
            { id: 'b', tier: 'fierce' },
            { id: 'c', tier: 'hard' },
          ],
          seed,
          false,
        );
        const last = run.races[run.races.length - 1] as ItemRaceState;
        expect(last.racers.every((entry) => entry.racer.finishedAtMs !== null)).toBe(true);
        expect(standings(last.racers.map((entry) => entry.racer)), `seed ${String(seed)}`).toEqual([
          'b',
          'c',
          'a',
        ]);
      }
    },
  );
});

describe('no rubber-banding (ADR 0060 D-9)', () => {
  it('reads back the same power trace whether the bot leads the race or trails it', () => {
    const trace = (rivals: BotTier): { readonly power: number[]; readonly place: number } => {
      const run = race(
        HILLY,
        [
          { id: 'bot', tier: 'hard' },
          { id: 'r1', tier: rivals },
          { id: 'r2', tier: rivals },
        ],
        7,
        true,
        300,
      );
      const last = run.races[run.races.length - 1] as ItemRaceState;
      return {
        power: run.bots.map((bots) => bots.find((bot) => bot.id === 'bot')?.power ?? -1),
        place: standings(last.racers.map((entry) => entry.racer)).indexOf('bot'),
      };
    };
    const leading = trace('steady');
    const trailing = trace('fierce');
    expect(leading.place).toBe(0);
    expect(trailing.place).toBe(2);
    // Until the shorter race ended: the bot's own ride is the same length in both.
    const ticks = Math.min(leading.power.length, trailing.power.length);
    expect(ticks).toBeGreaterThan(100);
    // The road is hilly, so the trace is not one number repeated.
    expect(new Set(leading.power.slice(0, ticks)).size).toBeGreaterThan(10);
    expect(trailing.power.slice(0, ticks)).toEqual(leading.power.slice(0, ticks));
  });

  it('holds for every pace: a paced bot reads back one power trace leading or trailing (#2455)', () => {
    for (const style of BOT_PACING_STYLES) {
      const pace: BotPace = { style, ability: 1 - BOT_ABILITY_SPREAD / 2 };
      const trace = (rivals: BotTier): { readonly power: number[]; readonly place: number } => {
        const run = race(
          HILLY,
          [
            { id: 'bot', tier: 'hard', pace },
            // The rivals ride other paces too, so nothing about them is the bot's.
            { id: 'r1', tier: rivals, pace: { style: 'sprinter', ability: 1 } },
            { id: 'r2', tier: rivals, pace: { style: 'fast-start', ability: 0.95 } },
          ],
          7,
          true,
          300,
        );
        const last = run.races[run.races.length - 1] as ItemRaceState;
        return {
          power: run.bots.map((bots) => bots.find((bot) => bot.id === 'bot')?.power ?? -1),
          place: standings(last.racers.map((entry) => entry.racer)).indexOf('bot'),
        };
      };
      const leading = trace('steady');
      const trailing = trace('fierce');
      expect(leading.place, style).toBe(0);
      expect(trailing.place, style).toBe(2);
      const ticks = Math.min(leading.power.length, trailing.power.length);
      expect(ticks, style).toBeGreaterThan(100);
      expect(trailing.power.slice(0, ticks), style).toEqual(leading.power.slice(0, ticks));
    }
  });
});

describe('the same race gives the same decisions', () => {
  it('compares two runs byte for byte, and another seed decides differently', () => {
    const field: Entrant[] = [
      { id: 'a', tier: 'brisk', strategy: { personality: 'aggressive', skill: 'naive' } },
      { id: 'b', tier: 'hard', strategy: { personality: 'defensive', skill: 'canny' } },
      { id: 'c', tier: 'hard', strategy: { personality: 'opportunist', skill: 'crafty' } },
      { id: 'd', tier: 'fierce' },
    ];
    const one = race(HILLY, field, 11, true);
    const two = race(HILLY, field, 11, true);
    expect(JSON.stringify(two)).toBe(JSON.stringify(one));
    const lanes = (run: Run): string =>
      JSON.stringify(run.races.map((state) => state.racers.map((entry) => entry.lane)));
    expect(lanes(race(HILLY, field, 12, true))).not.toBe(lanes(one));
    // The bots did decide something: lanes moved and items were used.
    expect(new Set(lanes(one).match(/\d/g)).size).toBeGreaterThan(1);
  });

  it('takes the rider’s inputs beside the bots’, and leaves the rider’s effort to them', () => {
    const start = createItemRace({
      course: raceCourse(FLAT.totalDistance, 3),
      seed: 1,
      itemsOn: true,
      racerIds: ['bot', 'rider'],
      startMs: 0,
    });
    const step: BotRaceStep = {
      elapsed: seconds(1),
      conditions: conditions(FLAT),
      seed: 1,
      rider: { effortDistances: { rider: 9 }, lanes: { rider: 0 } },
    };
    const { race: next } = stepBotRace(start, [lapRaceBot('bot', 'steady', STRATEGY)], step);
    const rider = next.racers.find((entry) => entry.racer.id === 'rider');
    expect(rider?.racer.effortDistance).toBe(9);
    expect(rider?.lane).toBe(0);
    expect(next.atMs).toBe(1_000);
  });

  it('hands each bot its memory back, so a lane it moved into is kept for the dwell (#1959)', () => {
    const start = createItemRace({
      course: raceCourse(FLAT.totalDistance, 3),
      seed: 1,
      itemsOn: false,
      racerIds: ['bot', 'rider'],
      startMs: 0,
    });
    // The bot at 100 m, the rider 8 m behind it in its lane, as a gust would come up.
    let race: ItemRaceState = {
      ...start,
      racers: start.racers.map((entry) => ({
        ...entry,
        racer: { ...entry.racer, effortDistance: entry.racer.id === 'bot' ? 100 : 92 },
      })),
    };
    let bots: readonly LapRaceBot[] = [
      {
        ...lapRaceBot('bot', 'steady', { personality: 'defensive', skill: 'crafty' }),
        ride: { speed: metresPerSecond(8), distance: metres(100) },
      },
    ];
    const lanes: number[] = [];
    for (let second = 0; second < 3; second += 1) {
      const bot = race.racers.find(
        (entry) => entry.racer.id === 'bot',
      ) as ItemRaceState['racers'][number];
      // The rider follows the bot into whatever lane it rode last.
      const next = stepBotRace(race, bots, {
        elapsed: seconds(1),
        conditions: conditions(FLAT),
        seed: 1,
        rider: { effortDistances: { rider: 92 + 8 * (second + 1) }, lanes: { rider: bot.lane } },
      });
      race = next.race;
      bots = next.bots;
      lanes.push(race.racers.find((entry) => entry.racer.id === 'bot')?.lane ?? -1);
    }
    expect(bots[0]?.memory.laneSinceMs).toBe(2_000);
    // Out at once; held for the dwell with the rider behind it again; out again after it.
    expect(lanes[0]).not.toBe(1);
    expect(lanes[1]).toBe(lanes[0]);
    expect(lanes[2]).not.toBe(lanes[1]);
  });
});

describe('skill is its own axis, and never power (#1959, ADR 0060 D-9)', () => {
  it(
    'a crafty bot beats a naive one of the same tier more often than not, on the same power trace',
    { timeout: 60_000 },
    () => {
      let ahead = 0;
      let behind = 0;
      for (let seed = 1; seed <= 150; seed += 1) {
        // Which id is crafty alternates, so a tie broken by id favours neither.
        const crafty = seed % 2 === 0 ? 'a' : 'b';
        const naive = crafty === 'a' ? 'b' : 'a';
        const personality = BOT_PERSONALITIES[seed % 3] as BotStrategy['personality'];
        const run = race(
          HILLY,
          [
            { id: crafty, tier: 'hard', strategy: { personality, skill: 'crafty' } },
            { id: naive, tier: 'hard', strategy: { personality, skill: 'naive' } },
            {
              id: 'c',
              tier: 'hard',
              strategy: {
                personality: BOT_PERSONALITIES[(seed + 1) % 3] as BotStrategy['personality'],
                skill: 'canny',
              },
            },
          ],
          seed,
          true,
        );
        const last = run.races[run.races.length - 1] as ItemRaceState;
        const order = standings(last.racers.map((entry) => entry.racer));
        if (order.indexOf(crafty) < order.indexOf(naive)) ahead += 1;
        else behind += 1;
        // Strength is the tier alone: the two skills ride one power trace, tick for tick.
        const trace = (id: string): number[] =>
          run.bots.map((bots) => bots.find((bot) => bot.id === id)?.power ?? -1);
        expect(trace(crafty), `seed ${String(seed)}`).toEqual(trace(naive));
      }
      expect(ahead).toBeGreaterThan(behind);
    },
  );
});

/** One bot's ride through a run: the power of each tick, where it began, and its grade. */
interface BotTicks {
  readonly power: readonly number[];
  readonly from: readonly number[];
  readonly grade: readonly number[];
  /** How many ticks until the bot finished. */
  readonly finished: number;
}

function ticksOf(run: Run, id: string, profile: RouteProfile): BotTicks {
  const power: number[] = [];
  const from: number[] = [];
  const grade: number[] = [];
  let finished = -1;
  for (let tick = 1; tick < run.bots.length; tick += 1) {
    const before = run.bots[tick - 1]?.find((bot) => bot.id === id) as LapRaceBot;
    const after = run.bots[tick]?.find((bot) => bot.id === id) as LapRaceBot;
    power.push(after.power);
    from.push(before.ride.distance);
    grade.push(gradeAt(profile, distanceOnRoute(profile, before.ride.distance)));
    const racer = run.races[tick]?.racers.find((entry) => entry.racer.id === id);
    if (finished < 0 && racer?.racer.finishedAtMs !== null) finished = tick;
  }
  return { power, from, grade, finished };
}

const mean = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

const ALL_TIERS: readonly Entrant[] = [
  { id: 's', tier: 'steady' },
  { id: 'b', tier: 'brisk' },
  { id: 'h', tier: 'hard' },
  { id: 'f', tier: 'fierce' },
];

/** The W′ balance case's physics sub-step: a whole one-second tick, so `advance` runs once a tick. */
const BALANCE_INTEGRATION_STEP_SECONDS = 1;

describe('the race plan (#1960, ADR 0061 D-8)', () => {
  it('keeps every bot’s W′ balance in [0, W′] on every tick of a race at every tier and style on a flat and a hilly loop, its power inside the floor, the surge ceiling and 7 W/kg (ADR 0067 D-1.3)', () => {
    // What replaces ADR 0061 D-8.1's mean tolerance (ADR 0067 D-4): a bot's
    // capacity, not its average, is what is held.
    //
    // Forty races, not two hundred seeded ones (#1688's ruling: a slow case
    // is made cheaper, never given a longer timeout). The balance depends on a
    // bot's tier, its style and its ability, the road and the race; a seed
    // only picks among those, so the fields are dealt for what they cover:
    //
    // - twenty of the four tiers, ten a loop, on the five styles in rotation:
    //   each tier, style and loop ridden once at each end of the ability band
    //   (all 80), with items on in every other race;
    // - twenty of five steady bots on the hilly loop, dealt by the race's own
    //   `botFieldPaces`, so one of each style across the band. Steady has the
    //   smallest W′ and the hill spends it: these are the races in which an
    //   exhausted bot gets some W′ back and asks over CP again, the only ticks
    //   on which the exhausted cap is what holds its power. Of the 800
    //   bot-races the seeded version rode, four had one; `heldAtCp` below
    //   fails the case if a deal ever has none.
    //
    // And the physics integrates each one-second tick in one sub-step, not a
    // hundred. The balance and the power are the plan's, stepped once a tick
    // on the tick's own second; the sub-step moves only where the bot is,
    // and the invariants hold wherever it is. Over the seeded version's 200
    // races the same four bot-races hit the exhausted cap at either sub-step.
    //
    // Apple M-series, Node 26, this file: the 200 seeded races at 10 ms took
    // 19.9 s, and 21.6 s under --coverage (one run each, under the 180 s
    // timeout this case no longer has); these forty take 194 to 276 ms, and
    // 359 to 607 ms under --coverage (three runs each).
    const fields: { profile: RouteProfile; seed: number; field: readonly Entrant[] }[] = [];
    for (const profile of [FLAT, HILLY]) {
      for (let seed = 1; seed <= 2 * BOT_PACING_STYLES.length; seed += 1) {
        // Seed s and seed s + 5 deal a tier one style, and the odd five
        // between them flips the end of the ability band it rides at.
        const field = ALL_TIERS.map((entrant, index) => ({
          ...entrant,
          pace: {
            style: BOT_PACING_STYLES[(index + seed) % BOT_PACING_STYLES.length] as BotPacingStyle,
            ability: (index + seed) % 2 === 0 ? 1 : 1 - BOT_ABILITY_SPREAD,
          },
        }));
        fields.push({ profile, seed, field });
      }
    }
    for (let seed = 1; seed <= 20; seed += 1) {
      const field = botFieldPaces(seed, BOT_PACING_STYLES.length).map((pace, index): Entrant => ({
        id: `s${String(index)}`,
        tier: 'steady',
        pace,
      }));
      fields.push({ profile: HILLY, seed, field });
    }
    let exhausted = 0;
    // Ticks on which an exhausted bot had some W′ back and asked over CP.
    let heldAtCp = 0;
    for (const { profile, seed, field } of fields) {
      const run = race(
        profile,
        field,
        seed,
        seed % 2 === 0,
        undefined,
        BALANCE_INTEGRATION_STEP_SECONDS,
      );
      const label = `seed ${String(seed)} ${profile === FLAT ? 'flat' : 'hilly'}`;
      for (const { id, tier, pace } of field) {
        const wPrime = botWPrimeJoules(tier, pace);
        const tierWatts = BOT_TIER_WATTS_PER_KILOGRAM[tier] * BOT_MASS_KILOGRAMS;
        const plan = botRacePlan(tier, raceCourse(profile.totalDistance, 3), seed, pace);
        const ticks = ticksOf(run, id, profile);
        expect(ticks.finished, `${id} ${label}`).toBeGreaterThan(100);
        // Sampled every tick; asserted once on the extremes, so a race is not
        // a thousand expectations.
        let least = Number.POSITIVE_INFINITY;
        let most = Number.NEGATIVE_INFINITY;
        // The most a tick rode over what the balance before it could pay
        // for: a plan that rode past its balance would leave the balance
        // clamped in range and still be wrong, so the power is read too.
        let overdrawn = Number.NEGATIVE_INFINITY;
        for (let tick = 1; tick < run.bots.length; tick += 1) {
          const bot = run.bots[tick - 1]?.find((each) => each.id === id) as LapRaceBot;
          const before = bot.energy;
          const { energy, power } = run.bots[tick]?.find((each) => each.id === id) as LapRaceBot;
          // What the plan asks here, read with a full balance: over CP is
          // what an exhausted bot with some of W′ back must still be held from.
          if (before.exhausted && before.wbalJoules > 0) {
            const ask = botPlanStep(plan, fullBotEnergy(plan.capacity), {
              effortDistance: bot.ride.distance,
              grade: ticks.grade[tick - 1] ?? 0,
              elapsed: seconds(1),
            }).power;
            if (ask > plan.capacity.cpWatts) heldAtCp += 1;
          }
          least = Math.min(least, energy.wbalJoules);
          most = Math.max(most, energy.wbalJoules);
          if (energy.exhausted) exhausted += 1;
          const paid = before.exhausted
            ? plan.capacity.cpWatts
            : plan.capacity.cpWatts + before.wbalJoules;
          overdrawn = Math.max(overdrawn, power - paid);
        }
        expect(least, `${id} ${label}`).toBeGreaterThanOrEqual(0);
        expect(most, `${id} ${label}`).toBeLessThanOrEqual(wPrime);
        expect(overdrawn, `${id} ${label}`).toBeLessThanOrEqual(1e-9);
        const ridden = ticks.power.slice(0, ticks.finished);
        // ADR 0061 D-8.2, kept: the surge ceiling, never over 7 W/kg, and #92's −20 %.
        expect(Math.max(...ridden), `${id} ${label}`).toBeLessThanOrEqual(plan.surgeWatts + 1e-9);
        expect(Math.max(...ridden), `${id} ${label}`).toBeLessThanOrEqual(
          MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM * BOT_MASS_KILOGRAMS,
        );
        expect(Math.min(...ridden), `${id} ${label}`).toBeGreaterThanOrEqual(
          tierWatts * PACING_FACTOR_FLOOR - 1e-9,
        );
        // And it does leave #92's +10 % band upward, in the sprint at least.
        expect(Math.max(...ridden), `${id} ${label}`).toBeGreaterThan(
          tierWatts * PACING_FACTOR_CEILING,
        );
      }
    }
    // Non-vacuity: some bot somewhere ran its W′ down to nothing and had to ease,
    // and some exhausted bot asked over CP with W′ to spend and was held.
    expect(exhausted).toBeGreaterThan(0);
    expect(heldAtCp).toBeGreaterThan(0);
  });

  it(
    'finishes fierce, hard, brisk and steady in that order with items off, every seed of 100',
    { timeout: 60_000 },
    () => {
      for (let seed = 1; seed <= 100; seed += 1) {
        // A seed moves the sprint's opening here, on a hilly loop where it matters.
        const run = race(HILLY, ALL_TIERS, seed, false);
        const last = run.races[run.races.length - 1] as ItemRaceState;
        expect(last.racers.every((entry) => entry.racer.finishedAtMs !== null)).toBe(true);
        expect(standings(last.racers.map((entry) => entry.racer)), `seed ${String(seed)}`).toEqual([
          'f',
          'h',
          'b',
          's',
        ]);
      }
    },
  );

  it('surges on the climbs and eases on the descents of a seeded hilly loop', () => {
    const run = race(HILLY, [{ id: 'bot', tier: 'hard' }], 5, false);
    const ticks = ticksOf(run, 'bot', HILLY);
    const plan = botRacePlan('hard', raceCourse(HILLY.totalDistance, 3), 5);
    const climbs: number[] = [];
    const descents: number[] = [];
    ticks.power.forEach((power, tick) => {
      // Outside the sprint, which rides the same whatever the grade.
      if (plan.raceMetres - (ticks.from[tick] ?? 0) <= plan.sprintMetres) return;
      const grade = ticks.grade[tick] ?? 0;
      if (grade > 1) climbs.push(power);
      if (grade < -1) descents.push(power);
    });
    expect(climbs.length).toBeGreaterThan(20);
    expect(descents.length).toBeGreaterThan(10);
    expect(mean(climbs)).toBeGreaterThan(mean(descents));
    // A climb with a reserve behind it is a surge past #92's +10 % band.
    expect(Math.max(...climbs)).toBeGreaterThan(plan.tierWatts * PACING_FACTOR_CEILING);
    expect(Math.max(...descents)).toBeLessThanOrEqual(plan.tierWatts);
  });

  it('opens its sprint on its own effort distance, on the flat', () => {
    const run = race(FLAT, [{ id: 'bot', tier: 'brisk' }], 9, false);
    const ticks = ticksOf(run, 'bot', FLAT);
    const plan = botRacePlan('brisk', raceCourse(FLAT.totalDistance, 3), 9);
    const opens = ticks.from.findIndex((at) => plan.raceMetres - at <= plan.sprintMetres);
    expect(opens).toBeGreaterThan(0);
    // Banking at most until the tick before; above its tier from the tick it opens.
    expect(ticks.power[opens - 1]).toBeLessThanOrEqual(plan.tierWatts);
    expect(ticks.power[opens]).toBeCloseTo(plan.surgeWatts, 9);
  });

  it('rides the same power at one effort distance whatever items did to its race offset (D-3.3)', () => {
    // How ADR 0061 D-8.5's race-level property is held here. D-8.5 asks that
    // the same bot, course and seed read back an identical power as a function
    // of its own effort distance whatever the other racers' items do, and that
    // a plan reading its drawn distance turn that red. What other racers' items
    // change about a bot is its `raceOffset` and nothing else (ADR 0060 D-5.1,
    // D-4: a solo race's bots have no draft), so this fixture builds that
    // change directly: one race state, the bot at one effort distance, and the
    // offset an item would leave it with set to 0, +10 m and −10 m. Equal power
    // across the three is the property at one effort distance; the two
    // distances either side of the sprint's opening are where a drawn-distance
    // read must differ, and it does (M6 in the PR body). #1900's whole-race
    // lead-or-trail run holds the rank half; it stays green under a
    // drawn-distance read, because a whole race rarely sits an offset across
    // the sprint's opening, which is why this fixture puts one there.
    const seed = 2;
    const start = createItemRace({
      course: raceCourse(FLAT.totalDistance, 3),
      seed,
      itemsOn: false,
      racerIds: ['bot', 'rival'],
      startMs: 0,
    });
    const plan = botRacePlan('hard', start.course, seed);
    const opens = plan.raceMetres - plan.sprintMetres;
    const powerAt = (effortDistance: number, raceOffset: number): number => {
      const race: ItemRaceState = {
        ...start,
        racers: start.racers.map((entry) =>
          entry.racer.id === 'bot'
            ? { ...entry, racer: { ...entry.racer, effortDistance, raceOffset } }
            : entry,
        ),
      };
      const bot: LapRaceBot = {
        ...lapRaceBot('bot', 'hard', STRATEGY),
        energy: { wbalJoules: 1_000, exhausted: false },
        ride: { speed: metresPerSecond(10), distance: metres(effortDistance) },
      };
      return stepBotRace(race, [bot], { elapsed: seconds(1), conditions: conditions(FLAT), seed })
        .bots[0]?.power as number;
    };
    // 5 m short of the sprint: a bot drawn 10 m on would be inside it on the drawn distance.
    const before = powerAt(opens - 5, 0);
    expect(before).toBe(plan.tierWatts);
    expect(powerAt(opens - 5, 10)).toBe(before);
    expect(powerAt(opens - 5, -10)).toBe(before);
    // 5 m into it: a bot drawn 10 m back would be outside it on the drawn distance.
    const inside = powerAt(opens + 5, 0);
    expect(inside).toBeCloseTo(plan.surgeWatts, 9);
    expect(powerAt(opens + 5, -10)).toBe(inside);
    expect(powerAt(opens + 5, 10)).toBe(inside);
  });
});

/** Seven bots of one tier, each its pace from the field's deal on `seed`. */
function dealtField(tier: BotTier, seed: number): Entrant[] {
  return botFieldPaces(seed, 7).map((pace, index) => ({
    id: `bot-${String(index + 1)}`,
    tier,
    pace,
  }));
}

/** Each racer's drawn distance at a tick, by id. */
function positionsAt(run: Run, tick: number): ReadonlyMap<string, number> {
  const state = run.races[Math.min(tick, run.races.length - 1)] as ItemRaceState;
  return new Map(
    state.racers.map((entry) => [
      entry.racer.id,
      entry.racer.effortDistance + entry.racer.raceOffset,
    ]),
  );
}

describe('each bot its own pace (#2455)', () => {
  it(
    'holds every style’s W′ balance to its capacity at either end of the band, inside the bounds of D-8.2 (ADR 0067 D-1.3)',
    { timeout: 60_000 },
    () => {
      for (const profile of [FLAT, HILLY]) {
        for (const ability of [1, 1 - BOT_ABILITY_SPREAD]) {
          const field: Entrant[] = BOT_PACING_STYLES.map((style) => ({
            id: style,
            tier: 'brisk',
            pace: { style, ability },
          }));
          const run = race(profile, field, 4, true);
          for (const { id, tier, pace } of field) {
            const ticks = ticksOf(run, id, profile);
            const ridden = ticks.power.slice(0, ticks.finished);
            const tierWatts = BOT_TIER_WATTS_PER_KILOGRAM[tier] * BOT_MASS_KILOGRAMS;
            const plan = botRacePlan(tier, run.races[0]?.course ?? raceCourse(1, 1), 4, pace);
            const label = `${id} at ${String(ability)}, ${profile === FLAT ? 'flat' : 'hilly'}`;
            expect(ticks.finished, label).toBeGreaterThan(100);
            // ADR 0067 D-1.3: the balance stays in [0, W′], tick by tick.
            const balances = run.bots.map(
              (bots) => (bots.find((bot) => bot.id === id) as LapRaceBot).energy.wbalJoules,
            );
            expect(Math.min(...balances), label).toBeGreaterThanOrEqual(0);
            expect(Math.max(...balances), label).toBeLessThanOrEqual(plan.wPrimeJoules);
            // It did spend: the balance moved off full.
            expect(Math.min(...balances), label).toBeLessThan(plan.wPrimeJoules);
            // D-8.2: the tier's surge ceiling and its −20 % floor, whatever the pace.
            expect(Math.max(...ridden), label).toBeLessThanOrEqual(plan.surgeWatts + 1e-9);
            expect(Math.min(...ridden), label).toBeGreaterThanOrEqual(
              tierWatts * PACING_FACTOR_FLOOR - 1e-9,
            );
          }
        }
      }
    },
  );

  it(
    'keeps the tiers in order with every bot on a pace the field dealt it, every seed of 100',
    { timeout: 60_000 },
    () => {
      for (let seed = 1; seed <= 100; seed += 1) {
        const paces = botFieldPaces(seed, ALL_TIERS.length);
        const field = ALL_TIERS.map((entrant, index) => ({ ...entrant, pace: paces[index] }));
        const run = race(HILLY, field, seed, false);
        const last = run.races[run.races.length - 1] as ItemRaceState;
        expect(standings(last.racers.map((entry) => entry.racer)), `seed ${String(seed)}`).toEqual([
          'f',
          'h',
          'b',
          's',
        ]);
      }
    },
  );

  it('spreads a field of one tier into a race: apart at the line, and the order changes on the way', () => {
    const order = (at: ReadonlyMap<string, number>): string[] =>
      [...at.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    let crossed = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const run = race(HILLY, dealtField('brisk', seed), seed, false);
      const label = `seed ${String(seed)}`;
      // The tick the first bot crosses the line, and where the field is then.
      const line = run.races.findIndex((state) =>
        state.racers.some((entry) => entry.racer.finishedAtMs !== null),
      );
      expect(line, label).toBeGreaterThan(0);
      const atLine = positionsAt(run, line - 1);
      const spread = [...atLine.values()];
      // Seven different places on the road, and the first and the last tens of metres apart.
      expect(new Set(spread).size, label).toBe(7);
      expect(Math.max(...spread) - Math.min(...spread), label).toBeGreaterThan(20);
      // The field's order at the end of the first lap, against the line's.
      const lap = run.races.findIndex((state) =>
        state.racers.every((entry) => entry.racer.effortDistance >= HILLY.totalDistance),
      );
      expect(lap, label).toBeGreaterThan(0);
      if (order(positionsAt(run, lap)).join() !== order(atLine).join()) crossed += 1;
    }
    // The paces cross: in most of these races someone passes someone after the first lap.
    expect(crossed).toBeGreaterThanOrEqual(3);
  });

  it('rides a field as one stacked group without paces: what #2455 reported', () => {
    // The yardstick the spread is measured against: seven bots of one tier on
    // no pace finish together, to the millisecond.
    const field = dealtField('brisk', 1).map(({ id, tier }) => ({ id, tier }));
    const run = race(HILLY, field, 1, false);
    const last = run.races[run.races.length - 1] as ItemRaceState;
    expect(new Set(last.racers.map((entry) => entry.racer.finishedAtMs)).size).toBe(1);
  });
});
