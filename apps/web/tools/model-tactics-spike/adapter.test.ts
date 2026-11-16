// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2616: the adapter carries a model's move out through the bots' own
 * tactics, keeps the sprint launch and the low-W′ overrides local, falls back
 * to the seeded tactics for anything it may not do, and can lift no bot over
 * its capacity, whatever the model says.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { BOT_TACTIC_ATTACK_MS, BOT_TACTIC_WBAL_FLOOR, type BotTactic } from '@onyourleft/domain';
import type { LapRaceBot } from '@onyourleft/physics';

import type { LapRaceRide } from '../../src/game/lap-race/ride-race';

import { applyModelMoves } from './adapter';
import type { ModelMove } from './decision';
import { MODEL_DECISION_EVERY_MS, type LoggedDecision } from './decision-log';
import { fieldTrace, rideField, SPIKE_RIDDEN_SECONDS, type FieldRun } from './race';

/** The flat field of seed 1, 10 s in: every bot has its plan, and window 10 opens on the next tick. */
let ride: LapRaceRide;
beforeAll(async () => {
  ride = (await rideField('flat', 1, { kind: 'seeded' }, 10)).last;
});

const WINDOW = 10;

/** The race with `id` moved to `effort` metres of effort distance. */
function placed(id: string, effort: number): LapRaceRide['race'] {
  return {
    ...ride.race,
    racers: ride.race.racers.map((entry) =>
      entry.racer.id === id
        ? { ...entry, racer: { ...entry.racer, effortDistance: effort } }
        : entry,
    ),
  };
}

/** The bots with the one at `seat` changed. */
function withBot(seat: number, change: (bot: LapRaceBot) => LapRaceBot): LapRaceBot[] {
  return ride.bots.map((bot, at) => (at === seat ? change(bot) : bot));
}

/** A bot at a W′ share of `share`. */
const atShare =
  (share: number, exhausted = false) =>
  (bot: LapRaceBot): LapRaceBot => ({
    ...bot,
    energy: { wbalJoules: share * (bot.plan?.capacity.wPrimeJoules ?? 0), exhausted },
  });

const one = (move: BotTactic, extra: Partial<ModelMove> = {}): ModelMove[] => [
  { bot: 0, move, ...extra },
];

/** Metres of a whole race. */
const raceMetres = (): number => ride.race.course.laps * ride.race.course.lapLengthMetres;

describe('the model-tactics adapter, one window (#2616)', () => {
  it('opens on window 10 with every bot planned and racing', () => {
    expect(ride.race.atMs).toBe(10_000);
    expect(ride.bots.every((bot) => bot.plan !== undefined && bot.tactics.window === 9)).toBe(true);
  });

  it('with no decision in force, leaves every bot as it is', () => {
    const applied = applyModelMoves(ride.race, ride.bots, undefined);
    expect(applied.outcomes).toEqual(Array<string>(7).fill('no-decision'));
    applied.bots.forEach((bot, at) => expect(bot).toBe(ride.bots[at]));
  });

  it('hands a named bot its move for this window, as if its tactics had chosen it', () => {
    const applied = applyModelMoves(ride.race, ride.bots, one('attack'));
    expect(applied.bots[0]?.tactics).toEqual({ tactic: 'attack', sinceMs: 10_000, window: WINDOW });
    expect(applied.outcomes).toEqual(['applied', ...Array<string>(6).fill('not-named')]);
    applied.bots.slice(1).forEach((bot, at) => expect(bot).toBe(ride.bots[at + 1]));
  });

  it('keeps the time a bot took up its move when the model keeps it there', () => {
    const bots = withBot(0, (bot) => ({
      ...bot,
      tactics: { tactic: 'sit-in', sinceMs: 2_000, window: 9 },
    }));
    const applied = applyModelMoves(ride.race, bots, one('sit-in'));
    expect(applied.bots[0]?.tactics).toEqual({ tactic: 'sit-in', sinceMs: 2_000, window: WINDOW });
  });

  it('does nothing mid-window: a window already chosen is not chosen again', () => {
    const bots = ride.bots.map((bot) => ({ ...bot, tactics: { ...bot.tactics, window: WINDOW } }));
    const applied = applyModelMoves(ride.race, bots, one('attack'));
    expect(applied.outcomes).toEqual([]);
    applied.bots.forEach((bot, at) => expect(bot).toBe(bots[at]));
  });

  it('keeps the sprint launch local: inside its launch distance, even a kick is the seeded tactics’', () => {
    const id = ride.bots[0]?.id as string;
    const race = placed(id, raceMetres() - 100);
    for (const move of ['kick', 'attack', 'sit-in'] as const) {
      const applied = applyModelMoves(race, ride.bots, one(move));
      expect(applied.outcomes[0], move).toBe('launch');
      expect(applied.bots[0]).toBe(ride.bots[0]);
    }
  });

  it('refuses a kick outside the launch', () => {
    expect(applyModelMoves(ride.race, ride.bots, one('kick')).outcomes[0]).toBe('kick-closed');
  });

  it('keeps the low-W′ overrides local: nothing for an exhausted bot, and no attack or chase under the floor', () => {
    const exhausted = withBot(0, atShare(0, true));
    for (const move of ['sit-in', 'recover', 'attack'] as const) {
      expect(applyModelMoves(ride.race, exhausted, one(move)).outcomes[0], move).toBe('exhausted');
    }
    const low = withBot(0, atShare(BOT_TACTIC_WBAL_FLOOR - 0.01));
    expect(applyModelMoves(ride.race, low, one('attack')).outcomes[0]).toBe('wbal-floor');
    expect(applyModelMoves(ride.race, low, one('chase')).outcomes[0]).toBe('wbal-floor');
    expect(applyModelMoves(ride.race, low, one('recover')).outcomes[0]).toBe('applied');
    expect(applyModelMoves(ride.race, low, one('sit-in')).outcomes[0]).toBe('applied');
    const atFloor = withBot(0, atShare(BOT_TACTIC_WBAL_FLOOR));
    expect(applyModelMoves(ride.race, atFloor, one('attack')).outcomes[0]).toBe('applied');
  });

  it('opens a flyer only in the last two laps, with 0.6 of W′ or more', () => {
    const id = ride.bots[0]?.id as string;
    expect(applyModelMoves(ride.race, ride.bots, one('flyer')).outcomes[0]).toBe('flyer-closed');
    const late = placed(id, ride.race.course.lapLengthMetres * 1.5);
    expect(applyModelMoves(late, ride.bots, one('flyer')).outcomes[0]).toBe('applied');
    const tired = withBot(0, atShare(0.59));
    expect(applyModelMoves(late, tired, one('flyer')).outcomes[0]).toBe('flyer-closed');
  });

  it('ends an attack held for its 20 s, as the seeded tactics do', () => {
    const held = (since: number): LapRaceBot[] =>
      withBot(0, (bot) => ({ ...bot, tactics: { tactic: 'attack', sinceMs: since, window: 9 } }));
    expect(
      applyModelMoves(ride.race, held(10_000 - BOT_TACTIC_ATTACK_MS), one('attack')).outcomes[0],
    ).toBe('attack-over');
    expect(
      applyModelMoves(ride.race, held(10_000 - BOT_TACTIC_ATTACK_MS + 50), one('attack'))
        .outcomes[0],
    ).toBe('applied');
  });

  it('carries a follow or a chase only to the racer directly ahead', () => {
    const order = ride.race.racers
      .map((entry) => entry.racer)
      .sort((a, b) => b.effortDistance - a.effortDistance || (a.id < b.id ? -1 : 1))
      .map((racer) => racer.id);
    const seatOf = (id: string): number => ride.bots.findIndex((bot) => bot.id === id);
    // A bot with a bot directly ahead of it.
    const at = order.findIndex(
      (id, place) => place > 0 && seatOf(id) >= 0 && seatOf(order[place - 1] as string) >= 0,
    );
    const seat = seatOf(order[at] as string);
    const ahead = seatOf(order[at - 1] as string);
    const ask = (target: ModelMove['target'], move: BotTactic = 'chase'): string | undefined =>
      applyModelMoves(ride.race, ride.bots, [{ bot: seat, move, target }]).outcomes[seat];
    expect(ask(ahead)).toBe('applied');
    expect(ask(ahead, 'follow')).toBe('applied');
    expect(ask(undefined)).toBe('applied');
    expect(ask('rider')).toBe('target-not-ahead');
    expect(ask(seat)).toBe('target-not-ahead');
    // A bot put in the lead has nobody ahead to follow.
    const race = placed(ride.bots[0]?.id as string, 500);
    for (const target of ['rider', 1] as const) {
      expect(
        applyModelMoves(race, ride.bots, [{ bot: 0, move: 'follow', target }]).outcomes[0],
      ).toBe('target-not-ahead');
    }
  });
});

/** A log of `moves` asked every 4 s and answered 100 ms later, the whole race. */
function steadyLog(moves: readonly ModelMove[]): LoggedDecision[] {
  return Array.from(
    { length: Math.floor((SPIKE_RIDDEN_SECONDS * 1_000) / MODEL_DECISION_EVERY_MS) },
    (_, at) => ({
      requestedAtMs: (at + 1) * MODEL_DECISION_EVERY_MS,
      arrivedAtMs: (at + 1) * MODEL_DECISION_EVERY_MS + 100,
      outcome: 'decision' as const,
      moves,
    }),
  );
}

describe('the model-tactics adapter, whole races (#2616)', () => {
  let seeded: FieldRun;
  let hostile: FieldRun;
  beforeAll(async () => {
    seeded = await rideField('hilly', 2, { kind: 'seeded' });
    hostile = await rideField('hilly', 2, {
      kind: 'log',
      log: steadyLog(Array.from({ length: 7 }, (_, bot) => ({ bot, move: 'attack' as const }))),
    });
  });

  it('with an empty log, rides today’s seeded race to the bit', async () => {
    const empty = await rideField('hilly', 2, { kind: 'log', log: [] });
    expect(fieldTrace(empty)).toBe(fieldTrace(seeded));
    expect(empty.outcomes.applied).toBe(0);
    expect(empty.outcomes['no-decision']).toBeGreaterThan(1_000);
  });

  it('rides a logged move: the bot attacks from the window after the answer, over its CP', async () => {
    const log: LoggedDecision[] = [
      { requestedAtMs: 40_000, arrivedAtMs: 42_300, outcome: 'decision', moves: one('attack') },
    ];
    const run = await rideField('hilly', 2, { kind: 'log', log }, 50);
    const id = run.last.bots[0]?.id as string;
    const cp = run.last.bots[0]?.plan?.capacity.cpWatts as number;
    // Ticks are numbered by their end: the tick ending at 43.05 s started at 43 s.
    const tick = (second: number): FieldRun['ticks'][number] =>
      run.ticks[Math.round(second / 0.05) - 1] as FieldRun['ticks'][number];
    expect(tick(43.0).tactic.get(id)).not.toBe('attack');
    expect(tick(43.05).tactic.get(id)).toBe('attack');
    expect(tick(45).tactic.get(id)).toBe('attack');
    expect(tick(45).power.get(id)).toBeGreaterThan(cp);
    expect(run.outcomes.applied).toBeGreaterThan(0);
  });

  it('with every bot told to attack every window, lifts no bot over its peak, under 0 W′ or off its capacity', () => {
    expect(hostile.outcomes.applied).toBeGreaterThan(100);
    // The overrides did their work: the floor and the 20 s ended attacks.
    expect(hostile.outcomes['wbal-floor'] + hostile.outcomes['attack-over']).toBeGreaterThan(0);
    const share = (run: FieldRun, tactic: BotTactic): number =>
      run.ticks.filter((tick) => [...tick.tactic.values()].includes(tactic)).length;
    expect(share(hostile, 'attack')).toBeGreaterThan(share(seeded, 'attack'));
    hostile.last.bots.forEach((bot, seat) => {
      const capacity = bot.plan?.capacity;
      // Fixed for the race: the capacity the seeded race built for the same bot.
      expect(capacity, bot.id).toEqual(seeded.last.bots[seat]?.plan?.capacity);
      for (const tick of hostile.ticks) {
        expect(tick.power.get(bot.id), bot.id).toBeLessThanOrEqual(capacity?.peakWatts as number);
        expect(tick.wbal.get(bot.id), bot.id).toBeGreaterThanOrEqual(0);
      }
    });
    // And it spent: some bot read its W′ low.
    expect(Math.min(...hostile.ticks.flatMap((tick) => [...tick.wbal.values()]))).toBeLessThan(
      Math.min(...seeded.ticks.flatMap((tick) => [...tick.wbal.values()])),
    );
  });
});
