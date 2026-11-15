// SPDX-License-Identifier: Apache-2.0

/**
 * #2543, pack riding step 2: on #2542's wheel-holding and #2463's tactics, an
 * attacking bot leaves the group and is caught or holds its gap, a bot that
 * has spent its W′ slips to the back of the group and off it, and a chasing
 * bot bridges to the group ahead (ADR 0067 D-0, D-1, D-3).
 *
 * Seeded races through `stepBotRace` and the one `advance`, the field
 * drafting, every gap read back off the race's own effort distances. Each
 * outcome is shown beside the condition that decides it, with that condition
 * the only thing changed. No case sets its own timeout (#1688).
 */

import { describe, expect, it } from 'vitest';

import type {
  BotPace,
  BotTactic,
  BotTier,
  ItemRaceState,
  RouteProfile,
  RoutePoint,
  TacticMemory,
} from '@onyourleft/domain';
import {
  altitudeMetres,
  BOT_TACTIC_WBAL_FLOOR,
  BOT_TACTIC_WHEEL_FURTHEST_METRES,
  BOT_TACTIC_WHEEL_LOST_METRES,
  BOT_TACTIC_WHEEL_METRES,
  botRacePlan,
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
} from '@onyourleft/domain';

import { airDensityKilogramsPerCubicMetre } from './air';
import { lapRaceBot, stepBotRace, type LapRaceBot } from './lap-race-bot';

const AIR = airDensityKilogramsPerCubicMetre(altitudeMetres(0), degreesCelsius(15));
const SEED = 1;

/** An out-and-back loop: `flat` metres level, then `climb` metres up at `risePercent`, and back. */
function outAndBack(flat: number, climb: number, risePercent: number): RouteProfile {
  const out: number[] = [];
  for (let along = 0; along <= flat + climb; along += 20) out.push(along);
  const points: RoutePoint[] = [...out, ...out.slice(0, -1).reverse()].map((along) => ({
    position: geographicPosition(degreesLatitude(51.5 + along / 111_320), degreesLongitude(-0.12)),
    elevation: altitudeMetres((Math.max(0, along - flat) * risePercent) / 100),
  }));
  return routeProfile(points, { loop: true });
}

const FLAT = outAndBack(1_500, 0, 0);
/** 500 m level, then 500 m up at 5 %. */
const CLIMB = outAndBack(500, 500, 5);

/** A sprinter, which sits in rather than follow a move (#2459). */
const SPRINTER: BotPace = { style: 'sprinter', ability: 1 };
/** An attacker (#2459's `fast-start`). */
const ATTACKER: BotPace = { style: 'fast-start', ability: 1 };
/** A rouleur. */
const ROULEUR: BotPace = { style: 'even', ability: 1 };

/** Its tactic held from the line: sitting in, or the one a test sets it in. */
const holding = (tactic: BotTactic): TacticMemory => ({ tactic, sinceMs: 0, window: null });

interface Entrant {
  readonly id: string;
  readonly tier?: BotTier;
  readonly pace: BotPace;
  /** Its effort distance on the line, metres. */
  readonly at: number;
  /** Its W′ balance on the line, as a share of its W′: full when not given. Exhausted at 0. */
  readonly wbal?: number;
  /** Its tactic on the line: sitting in when not given. */
  readonly tactic?: BotTactic;
}

/** Each racer's effort distance, and each bot's tactic and W′ share, a second at a time. */
interface Sample {
  readonly second: number;
  readonly at: ReadonlyMap<string, number>;
  readonly tactic: ReadonlyMap<string, BotTactic>;
  readonly wbal: ReadonlyMap<string, number>;
}

/**
 * A field already rolling at `speed`, placed on the road and drafting, for
 * `duration` one-second ticks of a race of `laps` laps.
 */
function ride(
  profile: RouteProfile,
  laps: number,
  field: readonly Entrant[],
  duration: number,
  speed: number,
): Sample[] {
  const course = raceCourse(profile.totalDistance, laps);
  const start = createItemRace({
    course,
    seed: SEED,
    itemsOn: false,
    racerIds: field.map((entrant) => entrant.id),
    startMs: 0,
  });
  const placed = (id: string): Entrant => field.find((entrant) => entrant.id === id) as Entrant;
  let race: ItemRaceState = {
    ...start,
    racers: start.racers.map((entry) => ({
      ...entry,
      racer: { ...entry.racer, effortDistance: placed(entry.racer.id).at },
    })),
  };
  let bots: readonly LapRaceBot[] = field.map((entrant) => {
    const tier = entrant.tier ?? 'brisk';
    const plan = botRacePlan(tier, course, SEED, entrant.pace);
    const share = entrant.wbal ?? 1;
    return {
      ...lapRaceBot(entrant.id, tier, { personality: 'opportunist', skill: 'canny' }, entrant.pace),
      plan,
      tactics: holding(entrant.tactic ?? 'sit-in'),
      energy: { wbalJoules: plan.capacity.wPrimeJoules * share, exhausted: share === 0 },
      ride: { distance: metres(entrant.at), speed: metresPerSecond(speed) },
    };
  });
  const samples: Sample[] = [];
  for (let second = 1; second <= duration; second += 1) {
    const next = stepBotRace(race, bots, {
      elapsed: seconds(1),
      conditions: { profile, airDensityKilogramsPerCubicMetre: AIR },
      seed: SEED,
      draft: true,
    });
    race = next.race;
    bots = next.bots;
    samples.push({
      second,
      at: new Map(race.racers.map((entry) => [entry.racer.id, entry.racer.effortDistance])),
      tactic: new Map(bots.map((bot) => [bot.id, bot.tactics.tactic])),
      wbal: new Map(
        bots.map((bot) => [
          bot.id,
          bot.energy.wbalJoules / (bot.plan as NonNullable<LapRaceBot['plan']>).wPrimeJoules,
        ]),
      ),
    });
  }
  return samples;
}

const of = (sample: Sample, id: string): number => sample.at.get(id) as number;

/** Metres `id` is ahead of the nearest of `others` (below 0 behind the last of them). */
function lead(sample: Sample, id: string, others: readonly string[]): number {
  return of(sample, id) - Math.max(...others.map((other) => of(sample, other)));
}

/** Metres `id` is behind the last of `others`. */
function dropped(sample: Sample, id: string, others: readonly string[]): number {
  return Math.min(...others.map((other) => of(sample, other))) - of(sample, id);
}

/** The most metres between any two of `ids` that are next to each other on the road. */
function widestGap(sample: Sample, ids: readonly string[]): number {
  const placed = ids.map((id) => of(sample, id)).sort((a, b) => b - a);
  return Math.max(0, ...placed.slice(1).map((at, index) => (placed[index] as number) - at));
}

describe('an attack leaves the group, and is caught or holds its gap by its pace and W′ (#2543)', () => {
  /** Three sprinters sitting in, in a line on the attacker's wheel, three laps from the line. */
  const GROUP = ['g1', 'g2', 'g3'] as const;
  const attack = (attacker: Partial<Entrant>): Sample[] =>
    ride(
      FLAT,
      3,
      [
        { id: 'atk', pace: ATTACKER, at: 3, tactic: 'attack', ...attacker },
        { id: 'g1', pace: SPRINTER, at: 2.35 },
        { id: 'g2', pace: SPRINTER, at: 1.7 },
        { id: 'g3', pace: SPRINTER, at: 1.05 },
      ],
      150,
      10,
    );

  it('of its own tier: leaves the group’s wheels, then is caught once its attack is over', () => {
    const samples = attack({});
    const attacked = samples.findIndex((sample) => sample.tactic.get('atk') !== 'attack');
    expect(attacked).toBeGreaterThan(10);
    // Away: past the distance at which the wheel behind it has lost it.
    const away = Math.max(...samples.map((sample) => lead(sample, 'atk', GROUP)));
    expect(away).toBeGreaterThan(2 * BOT_TACTIC_WHEEL_LOST_METRES);
    // Caught: one pace in the tier, and the group in its draft: back on a wheel
    // within a minute.
    const caught = samples.findIndex(
      (sample, at) =>
        at > attacked && lead(sample, 'atk', GROUP) <= BOT_TACTIC_WHEEL_FURTHEST_METRES,
    );
    expect(caught).toBeGreaterThan(attacked);
    expect((samples[caught] as Sample).second).toBeLessThan(60);
  });

  it('a tier up: leaves the group and holds its gap, out of the draft and still going', () => {
    const samples = attack({ tier: 'hard' });
    // The deciding condition: a pace the group's draft cannot make up.
    const group = botRacePlan('brisk', raceCourse(FLAT.totalDistance, 3), SEED, SPRINTER);
    const hard = botRacePlan('hard', raceCourse(FLAT.totalDistance, 3), SEED, ATTACKER);
    expect(hard.capacity.cpWatts).toBeGreaterThan(1.2 * group.capacity.cpWatts);
    const gaps = samples.map((sample) => lead(sample, 'atk', GROUP));
    expect(gaps[59]).toBeGreaterThan(BOT_TACTIC_WHEEL_METRES);
    for (let at = 1; at < gaps.length; at += 1) {
      expect(gaps[at] as number, String(at)).toBeGreaterThan(gaps[at - 1] as number);
    }
  });

  it('with its W′ under the floor: cannot attack, and never leaves the group', () => {
    const samples = attack({ wbal: BOT_TACTIC_WBAL_FLOOR - 0.05 });
    expect(samples.some((sample) => sample.tactic.get('atk') === 'attack')).toBe(false);
    for (const sample of samples) {
      expect(lead(sample, 'atk', GROUP), String(sample.second)).toBeLessThan(
        BOT_TACTIC_WHEEL_LOST_METRES,
      );
    }
  });
});

describe('a bot that has spent its W′ slips to the back of the group, then off it (#2543)', () => {
  /** Four rouleurs in a line at the foot of the climb, the second one `wbal` of its W′. */
  const OTHERS = ['r1', 'r2', 'r3'] as const;
  const climb = (wbal: number): Sample[] =>
    ride(
      CLIMB,
      6,
      [
        { id: 'r1', pace: ROULEUR, at: 483 },
        { id: 'fader', pace: ROULEUR, at: 482.35, wbal },
        { id: 'r2', pace: ROULEUR, at: 481.7 },
        { id: 'r3', pace: ROULEUR, at: 481.05 },
      ],
      70,
      9,
    );

  it('spent: the riders behind come round it, it is last within 30 s, and 30 m off the group within 60', () => {
    const samples = climb(0);
    const last = samples.findIndex((sample) => dropped(sample, 'fader', OTHERS) > 0);
    expect(last).toBeGreaterThan(0);
    expect((samples[last] as Sample).second).toBeLessThanOrEqual(30);
    // And it stays at the back: never past any of them again.
    for (const sample of samples.slice(last)) {
      expect(dropped(sample, 'fader', OTHERS), String(sample.second)).toBeGreaterThan(0);
    }
    const off = samples.findIndex(
      (sample) => dropped(sample, 'fader', OTHERS) > BOT_TACTIC_WHEEL_METRES,
    );
    expect(off).toBeGreaterThan(last);
    expect((samples[off] as Sample).second).toBeLessThanOrEqual(60);
    // The others ride on as a group.
    const end = samples[samples.length - 1] as Sample;
    expect(widestGap(end, OTHERS)).toBeLessThan(BOT_TACTIC_WHEEL_LOST_METRES);
  });

  it('with its W′: the same bot climbs in the group, never more than 3 m off a wheel', () => {
    for (const sample of climb(1)) {
      expect(widestGap(sample, ['fader', ...OTHERS]), String(sample.second)).toBeLessThan(3);
    }
  });
});

describe('a chasing bot bridges to the group ahead (#2543)', () => {
  /** Three rouleurs in a line 100 m up the road, and a fourth chasing them, three laps out. */
  const GROUP = ['r1', 'r2', 'r3'] as const;
  const chase = (wbal: number): Sample[] =>
    ride(
      FLAT,
      3,
      [
        { id: 'r1', pace: ROULEUR, at: 103 },
        { id: 'r2', pace: ROULEUR, at: 102.35 },
        { id: 'r3', pace: ROULEUR, at: 101.7 },
        { id: 'chaser', pace: ROULEUR, at: 1, tactic: 'chase', wbal },
      ],
      260,
      10,
    );

  it('with its W′: closes the 100 m and sits on the last wheel', () => {
    const samples = chase(1);
    const bridged = samples.findIndex(
      (sample) => dropped(sample, 'chaser', GROUP) <= BOT_TACTIC_WHEEL_FURTHEST_METRES,
    );
    expect(bridged).toBeGreaterThan(0);
    // It spent W′ getting there, and holds the wheel from then on.
    expect((samples[bridged] as Sample).wbal.get('chaser') as number).toBeLessThan(0.9);
    for (const sample of samples.slice(bridged + 10)) {
      expect(dropped(sample, 'chaser', GROUP), String(sample.second)).toBeLessThan(
        BOT_TACTIC_WHEEL_LOST_METRES,
      );
    }
  });

  it('with its W′ under the floor: cannot chase, and is no nearer at the end', () => {
    const samples = chase(BOT_TACTIC_WBAL_FLOOR - 0.05);
    // Shut out of the chase under the floor; it recovers to the floor and no
    // further, every joule over it spent at once, so it never gets going.
    for (const sample of samples) {
      if (sample.tactic.get('chaser') === 'chase') {
        expect(sample.wbal.get('chaser') as number, String(sample.second)).toBeGreaterThanOrEqual(
          BOT_TACTIC_WBAL_FLOOR - 0.01,
        );
      }
      expect(dropped(sample, 'chaser', GROUP), String(sample.second)).toBeGreaterThan(95);
    }
  });
});
