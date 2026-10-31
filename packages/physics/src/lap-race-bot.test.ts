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
  field: readonly { readonly id: string; readonly tier: BotTier }[],
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
  let bots: readonly LapRaceBot[] = field.map((bot) => lapRaceBot(bot.id, bot.tier));
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
    const { race: next, bots } = stepBotRace(start, [lapRaceBot('bot', 'hard')], {
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
    const { bots } = stepBotRace(start, [lapRaceBot('bot', 'hard')], {
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

describe('the puddle look-ahead it hands the bot decision', () => {
  it('is the bot’s speed times the tick, so a fast bot steers round a puddle beyond the fixed 15 m', () => {
    const start = createItemRace({
      course: raceCourse(FLAT.totalDistance, 3),
      seed: 1,
      itemsOn: true,
      racerIds: ['bot', 'x'],
      startMs: 0,
    });
    // The bot at 100 m doing 20 m/s, a puddle of x's 25 m ahead in the bot's lane.
    const ahead: ItemRaceState = {
      ...start,
      racers: start.racers.map((entry) => ({
        ...entry,
        racer: { ...entry.racer, effortDistance: entry.racer.id === 'bot' ? 100 : 400 },
      })),
      hazards: [{ position: 125, lane: 1, ownerId: 'x', untilMs: 1e9, hitIds: [] }],
    };
    const fast: LapRaceBot = {
      ...lapRaceBot('bot', 'fierce'),
      ride: { speed: metresPerSecond(20), distance: metres(100) },
    };
    const lane = (elapsed: number): number | undefined =>
      stepBotRace(ahead, [fast], {
        elapsed: seconds(elapsed),
        conditions: conditions(FLAT),
        seed: 1,
      }).race.racers.find((entry) => entry.racer.id === 'bot')?.lane;
    // A 1 s tick carries it 20 m, short of the puddle's 25 m, but past the fixed 15 m.
    expect(lane(1)).toBe(1);
    // A 1.5 s tick would carry it 30 m, through the puddle: it moves lane first.
    expect(lane(1.5)).not.toBe(1);
  });
});

describe('its inputs are a tier, the pacing rule, the course and a seed (ADR 0007 D4)', () => {
  it('takes no activity, stream or ghost type anywhere in its public signatures', () => {
    expectTypeOf(lapRaceBot).parameters.toEqualTypeOf<[id: string, tier: BotTier]>();
    expectTypeOf(stepBotRace).parameters.toEqualTypeOf<
      [race: ItemRaceState, bots: readonly LapRaceBot[], step: BotRaceStep]
    >();
    expectTypeOf<keyof BotRaceStep>().toEqualTypeOf<'elapsed' | 'conditions' | 'seed' | 'rider'>();
    expectTypeOf<keyof LapRaceBot>().toEqualTypeOf<'id' | 'tier' | 'ride' | 'power'>();
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
        'BotTier',
        'ItemRaceState',
        'RaceTickInput',
        'Seconds',
        'Watts',
        'botDecision',
        'botTierPlan',
        'stepRace',
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
    const field = [
      { id: 'a', tier: 'brisk' as const },
      { id: 'b', tier: 'hard' as const },
      { id: 'c', tier: 'hard' as const },
      { id: 'd', tier: 'fierce' as const },
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
    const { race: next } = stepBotRace(start, [lapRaceBot('bot', 'steady')], step);
    const rider = next.racers.find((entry) => entry.racer.id === 'rider');
    expect(rider?.racer.effortDistance).toBe(9);
    expect(rider?.lane).toBe(0);
    expect(next.atMs).toBe(1_000);
  });
});
