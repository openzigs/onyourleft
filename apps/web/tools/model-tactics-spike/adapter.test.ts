// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2616: the adapter carries a model's move out through the bots' own
 * tactics and can lift no bot over its capacity, whatever the model says.
 * Under ADR 0071's rules it keeps the sprint launch and the low-W′ overrides
 * local and falls back to the seeded tactics for anything it may not do;
 * under ADR 0073's (#2720), only an exhausted bot keeps its seeded choice,
 * and a `follow` or `chase` may name any racer.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { BOT_TACTIC_ATTACK_MS, BOT_TACTIC_WBAL_FLOOR, type BotTactic } from '@onyourleft/domain';
import type { LapRaceBot } from '@onyourleft/physics';

import type { LapRaceRide } from '../../src/game/lap-race/ride-race';

import { applyModelMoves, type ModelRules } from './adapter';
import { fieldNumbers } from './compare';
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

/** The adapter under ADR 0071 D-3.6's rules, which #2616's and #2708's logs were recorded under. */
const old = (...args: Parameters<typeof applyModelMoves>): ReturnType<typeof applyModelMoves> =>
  applyModelMoves(args[0], args[1], args[2], 'adr-0071');

describe('the model-tactics adapter, one window, under ADR 0071’s rules (#2616)', () => {
  it('opens on window 10 with every bot planned and racing', () => {
    expect(ride.race.atMs).toBe(10_000);
    expect(ride.bots.every((bot) => bot.plan !== undefined && bot.tactics.window === 9)).toBe(true);
  });

  it('with no decision in force, leaves every bot as it is', () => {
    const applied = old(ride.race, ride.bots, undefined);
    expect(applied.outcomes).toEqual(Array<string>(7).fill('no-decision'));
    applied.bots.forEach((bot, at) => expect(bot).toBe(ride.bots[at]));
  });

  it('hands a named bot its move for this window, as if its tactics had chosen it', () => {
    const applied = old(ride.race, ride.bots, one('attack'));
    expect(applied.bots[0]?.tactics).toEqual({ tactic: 'attack', sinceMs: 10_000, window: WINDOW });
    expect(applied.outcomes).toEqual(['applied', ...Array<string>(6).fill('not-named')]);
    applied.bots.slice(1).forEach((bot, at) => expect(bot).toBe(ride.bots[at + 1]));
  });

  it('keeps the time a bot took up its move when the model keeps it there', () => {
    const bots = withBot(0, (bot) => ({
      ...bot,
      tactics: { tactic: 'sit-in', sinceMs: 2_000, window: 9 },
    }));
    const applied = old(ride.race, bots, one('sit-in'));
    expect(applied.bots[0]?.tactics).toEqual({ tactic: 'sit-in', sinceMs: 2_000, window: WINDOW });
  });

  it('does nothing mid-window: a window already chosen is not chosen again', () => {
    const bots = ride.bots.map((bot) => ({ ...bot, tactics: { ...bot.tactics, window: WINDOW } }));
    const applied = old(ride.race, bots, one('attack'));
    expect(applied.outcomes).toEqual([]);
    applied.bots.forEach((bot, at) => expect(bot).toBe(bots[at]));
  });

  it('keeps the sprint launch local: inside its launch distance, even a kick is the seeded tactics’', () => {
    const id = ride.bots[0]?.id as string;
    const race = placed(id, raceMetres() - 100);
    for (const move of ['kick', 'attack', 'sit-in'] as const) {
      const applied = old(race, ride.bots, one(move));
      expect(applied.outcomes[0], move).toBe('launch');
      expect(applied.bots[0]).toBe(ride.bots[0]);
    }
  });

  it('refuses a kick outside the launch', () => {
    expect(old(ride.race, ride.bots, one('kick')).outcomes[0]).toBe('kick-closed');
  });

  it('keeps the low-W′ overrides local: nothing for an exhausted bot, and no attack or chase under the floor', () => {
    const exhausted = withBot(0, atShare(0, true));
    for (const move of ['sit-in', 'recover', 'attack'] as const) {
      expect(old(ride.race, exhausted, one(move)).outcomes[0], move).toBe('exhausted');
    }
    const low = withBot(0, atShare(BOT_TACTIC_WBAL_FLOOR - 0.01));
    expect(old(ride.race, low, one('attack')).outcomes[0]).toBe('wbal-floor');
    expect(old(ride.race, low, one('chase')).outcomes[0]).toBe('wbal-floor');
    expect(old(ride.race, low, one('recover')).outcomes[0]).toBe('applied');
    expect(old(ride.race, low, one('sit-in')).outcomes[0]).toBe('applied');
    const atFloor = withBot(0, atShare(BOT_TACTIC_WBAL_FLOOR));
    expect(old(ride.race, atFloor, one('attack')).outcomes[0]).toBe('applied');
  });

  it('opens a flyer only in the last two laps, with 0.6 of W′ or more', () => {
    const id = ride.bots[0]?.id as string;
    expect(old(ride.race, ride.bots, one('flyer')).outcomes[0]).toBe('flyer-closed');
    const late = placed(id, ride.race.course.lapLengthMetres * 1.5);
    expect(old(late, ride.bots, one('flyer')).outcomes[0]).toBe('applied');
    const tired = withBot(0, atShare(0.59));
    expect(old(late, tired, one('flyer')).outcomes[0]).toBe('flyer-closed');
  });

  it('ends an attack held for its 20 s, as the seeded tactics do', () => {
    const held = (since: number): LapRaceBot[] =>
      withBot(0, (bot) => ({ ...bot, tactics: { tactic: 'attack', sinceMs: since, window: 9 } }));
    expect(old(ride.race, held(10_000 - BOT_TACTIC_ATTACK_MS), one('attack')).outcomes[0]).toBe(
      'attack-over',
    );
    expect(
      old(ride.race, held(10_000 - BOT_TACTIC_ATTACK_MS + 50), one('attack')).outcomes[0],
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
      old(ride.race, ride.bots, [{ bot: seat, move, target }]).outcomes[seat];
    expect(ask(ahead)).toBe('applied');
    expect(ask(ahead, 'follow')).toBe('applied');
    expect(ask(undefined)).toBe('applied');
    expect(ask('rider')).toBe('target-not-ahead');
    expect(ask(seat)).toBe('target-not-ahead');
    // A bot put in the lead has nobody ahead to follow.
    const race = placed(ride.bots[0]?.id as string, 500);
    for (const target of ['rider', 1] as const) {
      expect(old(race, ride.bots, [{ bot: 0, move: 'follow', target }]).outcomes[0]).toBe(
        'target-not-ahead',
      );
    }
  });
});

/** Every racer still racing in `race`, the leader first: `stepBotRace`'s order. */
function orderOf(race: LapRaceRide['race']): string[] {
  return race.racers
    .map((entry) => entry.racer)
    .sort((a, b) => b.effortDistance - a.effortDistance || (a.id < b.id ? -1 : 1))
    .map((racer) => racer.id);
}

describe('the model-tactics adapter, one window, under ADR 0073’s rules (#2720)', () => {
  const ask = (
    bots: readonly LapRaceBot[],
    moves: readonly ModelMove[],
    race = ride.race,
    rules?: ModelRules,
  ): ReturnType<typeof applyModelMoves> => applyModelMoves(race, bots, moves, rules);

  it('is the default, and with no decision in force leaves every bot as it is', () => {
    const applied = applyModelMoves(ride.race, ride.bots, undefined);
    expect(applied.outcomes).toEqual(Array<string>(7).fill('no-decision'));
    applied.bots.forEach((bot, at) => expect(bot).toBe(ride.bots[at]));
    const low = withBot(0, atShare(BOT_TACTIC_WBAL_FLOOR - 0.01));
    expect(ask(low, one('attack')).outcomes[0]).toBe('applied');
    expect(ask(low, one('attack'), ride.race, 'adr-0073').outcomes[0]).toBe('applied');
  });

  it('lets a bot gamble: an attack or a chase under the W′ floor is ridden', () => {
    const low = withBot(0, atShare(0.05));
    for (const move of ['attack', 'chase'] as const) {
      const applied = ask(low, one(move));
      expect(applied.outcomes[0], move).toBe('applied');
      expect(applied.bots[0]?.tactics, move).toMatchObject({ tactic: move, window: WINDOW });
    }
  });

  it('keeps the body’s limit: an exhausted bot keeps its seeded choice, whatever it is told', () => {
    const exhausted = withBot(0, atShare(0, true));
    for (const move of ['attack', 'kick', 'flyer', 'sit-in'] as const) {
      const applied = ask(exhausted, one(move));
      expect(applied.outcomes[0], move).toBe('exhausted');
      expect(applied.bots[0], move).toBe(exhausted[0]);
    }
    // A low balance that has not run out is not exhausted.
    expect(ask(withBot(0, atShare(0.01)), one('attack')).outcomes[0]).toBe('applied');
  });

  it('opens a flyer on any lap and at any W′, and an attack for as long as the model holds it', () => {
    expect(ride.race.course.laps).toBe(3);
    expect(ask(withBot(0, atShare(0.2)), one('flyer')).outcomes[0]).toBe('applied');
    const held = withBot(0, (bot) => ({
      ...bot,
      tactics: { tactic: 'attack', sinceMs: 10_000 - 3 * BOT_TACTIC_ATTACK_MS, window: 9 },
    }));
    const applied = ask(held, one('attack'));
    expect(applied.outcomes[0]).toBe('applied');
    // Held, not restarted: the attack is still the one that began 60 s ago.
    expect(applied.bots[0]?.tactics.sinceMs).toBe(10_000 - 3 * BOT_TACTIC_ATTACK_MS);
  });

  it('leaves the launch to the model: a kick a lap out, and a sit-in or a kick inside the launch', () => {
    const kickedLong = ask(ride.bots, one('kick'));
    expect(kickedLong.outcomes[0]).toBe('applied');
    expect(kickedLong.bots[0]?.tactics.tactic).toBe('kick');
    const race = placed(ride.bots[0]?.id as string, raceMetres() - 100);
    for (const move of ['sit-in', 'kick'] as const) {
      const applied = ask(ride.bots, one(move), race);
      expect(applied.outcomes[0], move).toBe('applied');
      expect(applied.bots[0]?.tactics.tactic, move).toBe(move);
    }
  });

  it('carries a follow or a chase to any racer: on the wheel directly ahead, bridging up the road, or marking one behind', () => {
    const order = orderOf(ride.race);
    const seatOf = (id: string): number => ride.bots.findIndex((bot) => bot.id === id);
    // A bot with two bots ahead of it and a bot behind.
    const at = order.findIndex(
      (id, place) =>
        place > 1 &&
        [id, order[place - 1], order[place - 2], order[place + 1]].every(
          (each) => each !== undefined && seatOf(each) >= 0,
        ),
    );
    expect(at).toBeGreaterThan(1);
    const seat = seatOf(order[at] as string);
    const aim = (move: BotTactic, target: ModelMove['target']): [string, BotTactic] => {
      const applied = ask(ride.bots, [{ bot: seat, move, target }]);
      return [applied.outcomes[seat] as string, applied.bots[seat]?.tactics.tactic as BotTactic];
    };
    const ahead = seatOf(order[at - 1] as string);
    const further = seatOf(order[at - 2] as string);
    const behind = seatOf(order[at + 1] as string);
    for (const move of ['follow', 'chase'] as const) {
      expect(aim(move, ahead), move).toEqual(['applied', move]);
      expect(aim(move, undefined), move).toEqual(['applied', move]);
      // Itself: no one to aim at, so the move as named, on the wheel ahead.
      expect(aim(move, seat), move).toEqual(['applied', move]);
      expect(aim(move, further), move).toEqual(['bridging', 'chase']);
      expect(aim(move, behind), move).toEqual(['marking', 'sit-in']);
    }
    // A target on a move that takes none is ignored.
    expect(aim('attack', further)).toEqual(['applied', 'attack']);
  });

  it('marks the rider: waits for them behind, bridges to them ahead, and takes their wheel directly ahead', () => {
    // The last bot on the road, so that a rider far ahead has bots between.
    const last = orderOf(ride.race)
      .filter((each) => each !== 'rider')
      .at(-1) as string;
    const seat = ride.bots.findIndex((bot) => bot.id === last);
    const own = ride.race.racers.find((entry) => entry.racer.id === last)?.racer
      .effortDistance as number;
    const follow: ModelMove[] = [{ bot: seat, move: 'follow', target: 'rider' }];
    const outcome = (riderEffort: number): [string | undefined, BotTactic | undefined] => {
      const race = placed('rider', riderEffort);
      const applied = ask(ride.bots, follow, race);
      return [applied.outcomes[seat], applied.bots[seat]?.tactics.tactic];
    };
    // Directly ahead by a hair: no one between them.
    const nextUp = Math.min(
      ...ride.race.racers
        .map((entry) => entry.racer.effortDistance)
        .filter((effort) => effort > own),
      own + 10,
    );
    expect(outcome((own + nextUp) / 2)).toEqual(['applied', 'follow']);
    expect(outcome(own + 400)).toEqual(['bridging', 'chase']);
    expect(outcome(own - 50)).toEqual(['marking', 'sit-in']);
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
  let gambling: FieldRun;
  const all = (move: BotTactic): LoggedDecision[] =>
    steadyLog(Array.from({ length: 7 }, (_, bot) => ({ bot, move })));
  beforeAll(async () => {
    seeded = await rideField('hilly', 2, { kind: 'seeded' });
    hostile = await rideField('hilly', 2, { kind: 'log', log: all('attack'), rules: 'adr-0071' });
    // Under ADR 0073 the most a model could ask is a kick from the gun: the bots' peak.
    gambling = await rideField('hilly', 2, { kind: 'log', log: all('kick') });
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

  it('with every bot told to attack every window, under ADR 0071’s rules, lifts no bot over its peak, under 0 W′ or off its capacity', () => {
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

  it('with every bot told to kick every window, under ADR 0073’s rules, blows bots up and holds each blown one to CP (#2720)', () => {
    // Nothing refused but the exhausted: no launch, no closed kick.
    expect(gambling.outcomes['kick-closed'] + gambling.outcomes.launch).toBe(0);
    expect(gambling.outcomes.exhausted).toBeGreaterThan(0);
    expect(gambling.outcomes.applied).toBeGreaterThan(100);
    const blown = new Set<string>();
    gambling.last.bots.forEach((bot, seat) => {
      const capacity = bot.plan?.capacity;
      expect(capacity, bot.id).toEqual(seeded.last.bots[seat]?.plan?.capacity);
      gambling.ticks.forEach((tick, at) => {
        expect(tick.power.get(bot.id), bot.id).toBeLessThanOrEqual(capacity?.peakWatts as number);
        expect(tick.wbal.get(bot.id), bot.id).toBeGreaterThanOrEqual(0);
        if (gambling.ticks[at - 1]?.exhausted.get(bot.id) === true) {
          blown.add(bot.id);
          expect(tick.power.get(bot.id), bot.id).toBeLessThanOrEqual(
            (capacity?.cpWatts as number) + 1e-9,
          );
        }
      });
    });
    // Not vacuous: the gamble blew more than one bot.
    expect(blown.size).toBeGreaterThan(1);
  });

  it('with one bot told to kick from the gun, under ADR 0073’s rules, blows it, holds it to CP and fades it (#2720)', async () => {
    // Seat 1, a climber: its W′ runs out in the 150 s, where most bots' taper first.
    const run = await rideField('hilly', 2, {
      kind: 'log',
      log: steadyLog([{ bot: 1, move: 'kick' }]),
    });
    const id = run.last.bots[1]?.id as string;
    const numbers = fieldNumbers(run, 'rider');
    expect(run.ticks.some((tick) => tick.exhausted.get(id) === true)).toBe(true);
    expect(run.outcomes.exhausted).toBeGreaterThan(0);
    expect(numbers.blownOverCpTicks).toBe(0);
    // It blew in the lead, and went back through the field: three places by the end.
    expect(numbers.fadePlacesLost).toEqual([3]);
    // Ridden seeded, the same bot never blew.
    expect(seeded.ticks.some((tick) => tick.exhausted.get(id) === true)).toBe(false);
  });
});
