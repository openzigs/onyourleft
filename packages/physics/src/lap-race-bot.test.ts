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
  BOT_PERSONALITIES,
  createItemRace,
  degreesCelsius,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
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
}

function conditions(profile: RouteProfile): LapRaceBotConditions {
  return { profile, airDensityKilogramsPerCubicMetre: AIR };
}

interface Run {
  readonly races: readonly ItemRaceState[];
  readonly bots: readonly (readonly LapRaceBot[])[];
}

/** A solo race of bots, one tick a second, until every bot has finished or `limit` ticks. */
function race(
  profile: RouteProfile,
  field: readonly Entrant[],
  seed: number,
  itemsOn: boolean,
  limit = 2_000,
): Run {
  let state = createItemRace({
    course: raceCourse(profile.totalDistance, 3),
    seed,
    itemsOn,
    racerIds: field.map((bot) => bot.id),
    startMs: 0,
  });
  let bots: readonly LapRaceBot[] = field.map((bot) =>
    lapRaceBot(bot.id, bot.tier, bot.strategy ?? STRATEGY),
  );
  const races = [state];
  const all = [bots];
  for (let tick = 0; tick < limit; tick += 1) {
    if (state.racers.every((entry) => entry.racer.finishedAtMs !== null)) break;
    const next = stepBotRace(state, bots, {
      elapsed: seconds(1),
      conditions: conditions(profile),
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

  it('rides at the bot’s 75 kg, with its tier’s power', () => {
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
    // 3.6 W/kg at 75 kg on the flat.
    expect(step?.power).toBeCloseTo(270, 6);
    expect(bots[0]?.power).toBeCloseTo(270, 6);
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
      [id: string, tier: BotTier, strategy: BotStrategy]
    >();
    expectTypeOf(stepBotRace).parameters.toEqualTypeOf<
      [race: ItemRaceState, bots: readonly LapRaceBot[], step: BotRaceStep]
    >();
    expectTypeOf<keyof BotRaceStep>().toEqualTypeOf<'elapsed' | 'conditions' | 'seed' | 'rider'>();
    expectTypeOf<keyof LapRaceBot>().toEqualTypeOf<
      'id' | 'tier' | 'strategy' | 'memory' | 'ride' | 'power'
    >();
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
        'BOT_MEMORY_AT_START',
        'BotMemory',
        'BotStrategy',
        'BotTier',
        'ItemRaceState',
        'RaceTickInput',
        'Seconds',
        'Watts',
        'botTierPlan',
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
