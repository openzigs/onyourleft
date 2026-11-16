// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2710, ADR 0071 D-1.4, D-3, D-4 and D-7: a lap race with AI bots, ridden
 * headless through the shipped race step (`ride-race.ts` §`stepLapRaceRide`),
 * its asks and answers made the way `GameView` makes them
 * (§`askLapRaceRide`, §`answerLapRaceRide`). Every fallback is read back from
 * **what the race draws** (§`lapRaceDrawing`): a late answer, an invalid one,
 * a refusal and an instance that cannot be reached each leave the field drawn
 * exactly where the seeded race draws it, and a decision that applies moves it.
 * Since bot-code version 2 the moves are ridden under ADR 0073: the strategy
 * rules ADR 0071 D-3.6 had are lifted, and the body's limits hold.
 */

import {
  BOT_ARCHETYPES,
  BOT_TACTICS,
  BOT_TACTICS_WINDOW_MS,
  botTacticsMisjudgement,
  kilograms,
  MODEL_RACING_STYLES,
  MODEL_TACTICS_LATE_MS,
  modelRacingStyles,
  readModelTacticsInput,
  type ModelTacticsInput,
} from '@onyourleft/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_RIDING_POSITION, rideConditionsFor } from '../rider';
import { circuitRoute } from '../route-fixtures-testing';
import { LAP_RACE_MOST_BOTS } from './choice';
import { modelTacticsInputOf, type LapRaceModelAsk, type ModelTacticsReply } from './model-race';
import {
  answerLapRaceRide,
  askLapRaceRide,
  LAP_RACE_RIDER_ID,
  LAP_RACE_TICK_SECONDS,
  lapRaceBotConditions,
  lapRaceDrawing,
  lapRaceRideFact,
  startedLapRaceRide,
  startLapRaceRide,
  stepLapRaceRide,
  type LapRaceRide,
} from './ride-race';

const CIRCUIT = circuitRoute(
  100,
  (along) => 6 * Math.sin((along / (2 * Math.PI * 100)) * Math.PI * 2),
);
const SEED = 3;
const RIDER_KILOGRAMS = 75;

afterEach(() => {
  vi.restoreAllMocks();
});

/** A three-lap race of seven bots on the line, the seed `SEED`, AI bots or not. */
function startRace(model: boolean): LapRaceRide {
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(
    <T extends ArrayBufferView>(array: T): T => {
      (array as unknown as Uint32Array)[0] = SEED;
      return array;
    },
  );
  const ride = startLapRaceRide({
    choice: { laps: 3, bots: LAP_RACE_MOST_BOTS, tier: 'brisk', itemsOn: false },
    profile: CIRCUIT,
    conditions: lapRaceBotConditions(
      CIRCUIT,
      rideConditionsFor(kilograms(RIDER_KILOGRAMS), DEFAULT_RIDING_POSITION),
    ),
    riderDistance: 0,
    lineOffset: 0,
    storage: undefined,
    draft: true,
    riderMassKilograms: RIDER_KILOGRAMS,
    model,
  });
  vi.restoreAllMocks();
  if (ride === undefined) throw new Error('a circuit starts a race');
  return { ...ride, countdownLeftMs: 0 };
}

/** The rider's power and speed: a steady 150 W, with a hard minute from 40 s (so bots see a move). */
const riderWatts = (atMs: number): number => (atMs >= 40_000 && atMs < 100_000 ? 420 : 150);
const RIDER_SPEED = 9;

/**
 * How the instance answers an ask: the reply, and the race time it arrives at
 * after the ask, ms. `undefined`: the call never settles.
 */
type Instance = (
  input: ModelTacticsInput,
  askedAtMs: number,
) => { readonly reply: ModelTacticsReply; readonly afterMs: number } | undefined;

interface Ridden {
  readonly ride: LapRaceRide;
  /** What the race drew after each frame: every bot's drawn distance and lane, in order. */
  readonly drawn: readonly string[];
  readonly sent: ModelTacticsInput[];
  /** Every bot's move after each frame, in seat order. */
  readonly tactics: readonly (readonly string[])[];
}

/** Ride `seconds` of the race, a 100 ms frame of two ticks at a time, asking `instance` as `GameView` does. */
function ride(start: LapRaceRide, seconds: number, instance: Instance | undefined): Ridden {
  let race = start;
  let along = 0;
  const pending: { atMs: number; ask: LapRaceModelAsk; reply: ModelTacticsReply }[] = [];
  const drawn: string[] = [];
  const sent: ModelTacticsInput[] = [];
  const tactics: string[][] = [];
  const frames = Math.round(seconds / (2 * LAP_RACE_TICK_SECONDS));
  for (let frame = 0; frame < frames; frame += 1) {
    // Replies that settled before this frame are handed in first, at its race time.
    for (const due of pending.filter((each) => each.atMs <= race.race.atMs)) {
      race = answerLapRaceRide(race, due.ask, due.reply);
      pending.splice(pending.indexOf(due), 1);
    }
    const watts = riderWatts(race.race.atMs);
    along += RIDER_SPEED * 2 * LAP_RACE_TICK_SECONDS;
    race = stepLapRaceRide(race, { ticks: 2, along, riderWatts: watts });
    const asking = askLapRaceRide(race, watts);
    race = asking.ride;
    if (asking.send !== undefined && instance !== undefined) {
      sent.push(asking.send.input);
      const answer = instance(asking.send.input, asking.send.ask.askedAtMs);
      if (answer !== undefined) {
        pending.push({
          atMs: asking.send.ask.askedAtMs + answer.afterMs,
          ask: asking.send.ask,
          reply: answer.reply,
        });
      }
    }
    const drawing = lapRaceDrawing(race, along, 0, false);
    drawn.push(
      JSON.stringify(drawing.raceBots.map((bot) => [bot.distanceMetres, bot.lateralMetres])),
    );
    tactics.push(race.bots.map((bot) => bot.tactics.tactic));
  }
  return { ride: race, drawn, sent, tactics };
}

/** Every bot told to attack. */
const ALL_ATTACK = (input: ModelTacticsInput): ModelTacticsReply => ({
  kind: 'answer',
  body: { bots: input.bots.map((view) => ({ bot: view.bot, move: 'attack' })) },
});

const SECONDS = 150;

describe('a race with AI bots and no decision is the seeded race (D-1.4)', () => {
  it('draws the field where the seeded race draws it when no answer ever arrives', () => {
    const seeded = ride(startRace(false), SECONDS, undefined);
    const silent = ride(startRace(true), SECONDS, () => undefined);
    expect(silent.sent.length).toBeGreaterThan(10);
    expect(silent.drawn).toStrictEqual(seeded.drawn);
    // Every call given up, late, and the next asked.
    const log = silent.ride.model?.log ?? [];
    expect(log.length).toBe(silent.sent.length - 1);
    expect(log.every((entry) => entry.outcome === 'late' && entry.reason === 'no-answer')).toBe(
      true,
    );
    expect(log.every((entry) => entry.arrivedAtMs - entry.askedAtMs > MODEL_TACTICS_LATE_MS)).toBe(
      true,
    );
  });
});

describe('a decision applies, and every miss falls back to the seeded choice (D-7)', () => {
  it('moves the field with a decision in force', () => {
    const seeded = ride(startRace(false), SECONDS, undefined);
    const model = ride(startRace(true), SECONDS, (input) => ({
      reply: ALL_ATTACK(input),
      afterMs: 2_500,
    }));
    const log = model.ride.model?.log ?? [];
    expect(log.length).toBeGreaterThan(20);
    expect(log.every((entry) => entry.outcome === 'decision')).toBe(true);
    expect(model.drawn).not.toStrictEqual(seeded.drawn);
  });

  it.each<[string, Instance]>([
    [
      'a late answer',
      (input) => ({ reply: ALL_ATTACK(input), afterMs: MODEL_TACTICS_LATE_MS + 300 }),
    ],
    [
      'an invalid answer: a power in it',
      (input) => ({
        reply: {
          kind: 'answer',
          body: { bots: input.bots.map((view) => ({ bot: view.bot, move: 'attack', watts: 900 })) },
        },
        afterMs: 2_000,
      }),
    ],
    [
      'an invalid answer: a seat outside the field',
      () => ({
        reply: { kind: 'answer', body: { bots: [{ bot: 9, move: 'attack' }] } },
        afterMs: 2_000,
      }),
    ],
    ['the instance offline', () => ({ reply: { kind: 'unreachable' }, afterMs: 50 })],
    ['a refusal', () => ({ reply: { kind: 'refused', code: 'tactics_busy' }, afterMs: 50 })],
    [
      'a model that gave no answer',
      () => ({ reply: { kind: 'refused', code: 'tactics_failed' }, afterMs: 3_000 }),
    ],
  ])('draws the seeded field on %s', (_, instance) => {
    const seeded = ride(startRace(false), SECONDS, undefined);
    const missed = ride(startRace(true), SECONDS, instance);
    expect(missed.sent.length).toBeGreaterThan(10);
    const log = missed.ride.model?.log ?? [];
    expect(log.some((entry) => entry.outcome === 'decision')).toBe(false);
    expect(missed.drawn).toStrictEqual(seeded.drawn);
  });

  it('logs each miss with its closed reason, never the answer', () => {
    const late = ride(startRace(true), 30, (input) => ({
      reply: ALL_ATTACK(input),
      afterMs: 5_400,
    }));
    expect(late.ride.model?.log[0]).toMatchObject({ outcome: 'late', reason: 'no-answer' });
    const invalid = ride(startRace(true), 30, () => ({
      reply: { kind: 'answer', body: { bots: [{ bot: 0, move: 'attack', watts: 900 }] } },
      afterMs: 1_000,
    }));
    expect(invalid.ride.model?.log[0]).toEqual({
      askedAtMs: expect.any(Number) as number,
      arrivedAtMs: expect.any(Number) as number,
      outcome: 'invalid',
      reason: 'unknown-key',
    });
    const offline = ride(startRace(true), 30, () => ({
      reply: { kind: 'unreachable' },
      afterMs: 0,
    }));
    expect(offline.ride.model?.log[0]).toMatchObject({ outcome: 'failed', reason: 'unreachable' });
    const odd = ride(startRace(true), 30, () => ({
      reply: { kind: 'refused', code: 'teapot' },
      afterMs: 0,
    }));
    expect(odd.ride.model?.log[0]).toMatchObject({ outcome: 'refused', reason: 'refused' });
    const failed = ride(startRace(true), 30, () => ({
      reply: { kind: 'refused', code: 'tactics_failed' },
      afterMs: 0,
    }));
    expect(failed.ride.model?.log[0]).toMatchObject({
      outcome: 'failed',
      reason: 'tactics_failed',
    });
    const empty = ride(startRace(true), 30, () => ({
      reply: { kind: 'refused', code: 'tactics_invalid' },
      afterMs: 0,
    }));
    expect(empty.ride.model?.log[0]).toMatchObject({
      outcome: 'invalid',
      reason: 'tactics_invalid',
    });
  });

  it('logs an answer at the race time it arrived, and applies it from the next window', () => {
    const model = ride(startRace(true), 20, (input) => ({
      reply: ALL_ATTACK(input),
      afterMs: 2_550,
    }));
    const first = model.ride.model?.log[0];
    expect(first?.askedAtMs).toBe(4_000);
    // Asked at 4.0 s, settled 2.55 s later, handed in on the first frame after: 6.6 s.
    expect(first?.arrivedAtMs).toBe(6_600);
    expect(first?.outcome).toBe('decision');
    // The next ask is at the next 4 s mark after it settled.
    expect(model.ride.model?.log[1]?.askedAtMs).toBe(8_000);
  });

  it('asks one call at a time, and never while one is out', () => {
    const asks: number[] = [];
    ride(startRace(true), 40, (input, askedAtMs) => {
      asks.push(askedAtMs);
      return { reply: ALL_ATTACK(input), afterMs: 3_900 };
    });
    for (const [at, ask] of asks.entries()) {
      if (at > 0) expect(ask - (asks[at - 1] as number)).toBeGreaterThanOrEqual(3_900);
    }
    expect(asks.length).toBeGreaterThan(4);
  });

  it('logs an answer late, and applies nothing, when it is handed in past the late limit before the call is given up', () => {
    let race = startRace(true);
    race = stepLapRaceRide(race, { ticks: 80, along: 36, riderWatts: 150 });
    const first = askLapRaceRide(race, 150);
    const send = first.send;
    expect(send).toBeDefined();
    // The race runs on past the late limit, and the answer is handed in
    // before anything asks again: late, by race time alone.
    race = stepLapRaceRide(first.ride, { ticks: 120, along: 90, riderWatts: 150 });
    race = answerLapRaceRide(
      race,
      send?.ask as LapRaceModelAsk,
      ALL_ATTACK(send?.input as ModelTacticsInput),
    );
    expect(race.model?.log).toEqual([
      { askedAtMs: 4_000, arrivedAtMs: 10_000, outcome: 'late', reason: 'no-answer' },
    ]);
    expect(race.model?.asked).toBeUndefined();
  });

  it('ignores an answer to a call it gave up, and to another race', () => {
    let race = startRace(true);
    let along = 0;
    const step = (ticks: number): void => {
      along += RIDER_SPEED * ticks * LAP_RACE_TICK_SECONDS;
      race = stepLapRaceRide(race, { ticks, along, riderWatts: 240 });
    };
    step(80);
    const first = askLapRaceRide(race, 240);
    race = first.ride;
    expect(first.send).toBeDefined();
    const ask = first.send?.ask as LapRaceModelAsk;
    step(120);
    race = askLapRaceRide(race, 240).ride;
    expect(race.model?.log).toHaveLength(1);
    const before = race;
    race = answerLapRaceRide(race, ask, ALL_ATTACK(first.send?.input as ModelTacticsInput));
    expect(race).toBe(before);
    // An answer for another race, even one asked at the same race time.
    const other = askLapRaceRide(race, 240);
    race = other.ride;
    const stranger = { ...(other.send?.ask as LapRaceModelAsk) };
    expect(answerLapRaceRide(race, stranger, { kind: 'unreachable' })).toBe(race);
  });

  it('asks nothing more once the instance refused the race’s start, and rides seeded', () => {
    const seeded = ride(startRace(false), 60, undefined);
    const busy = startedLapRaceRide(startRace(true), { kind: 'refused', code: 'tactics_busy' });
    expect(busy.model?.unavailable).toBe('tactics_busy');
    const ridden = ride(busy, 60, (input) => ({ reply: ALL_ATTACK(input), afterMs: 1_000 }));
    expect(ridden.sent).toEqual([]);
    expect(ridden.drawn).toStrictEqual(seeded.drawn);
    // A start that answered, or could not be had, changes nothing.
    const fine = startRace(true);
    expect(startedLapRaceRide(fine, { kind: 'answer', body: { warming: true } })).toBe(fine);
    expect(startedLapRaceRide(fine, { kind: 'unreachable' })).toBe(fine);
  });

  it('asks nothing of a seeded race', () => {
    const seeded = startRace(false);
    expect(askLapRaceRide(seeded, 240)).toEqual({ ride: seeded, send: undefined });
    expect(lapRaceRideFact(seeded)).toBeUndefined();
  });
});

describe('what the model is shown (D-3.4)', () => {
  it('is a race state the instance’s own reader takes, whose only words are from closed lists', () => {
    const model = ride(startRace(true), SECONDS, (input) => ({
      reply: ALL_ATTACK(input),
      afterMs: 2_000,
    }));
    for (const input of model.sent) expect(readModelTacticsInput(input).ok).toBe(true);
    // No text a name or a place could ride in: every string is a move, a style or "rider".
    const words = new Set<string>();
    JSON.stringify(model.sent, (_, value: unknown) => {
      if (typeof value === 'string') words.add(value);
      return value;
    });
    const closed = new Set<string>([
      ...BOT_TACTICS,
      ...BOT_ARCHETYPES,
      ...MODEL_RACING_STYLES,
      'rider',
    ]);
    expect([...words].filter((word) => !closed.has(word))).toEqual([]);
  });

  it('shows a bot behind the rider the rider’s move, so it can mark the rider (#2715)', () => {
    const model = ride(startRace(true), SECONDS, (input) => ({
      reply: ALL_ATTACK(input),
      afterMs: 2_000,
    }));
    const behindRider = model.sent.flatMap((input, at) =>
      input.bots
        .filter((view) => view.ahead === 'rider')
        .map((view) => ({ at, move: view.aheadMove })),
    );
    // The rider pushes 420 W from 40 s to 100 s, which is over every brisk bot's CP.
    const pushing = behindRider.filter(({ at }) => {
      const askedAtMs = (at + 1) * 4_000;
      return askedAtMs > 40_000 && askedAtMs < 100_000;
    });
    expect(pushing.length).toBeGreaterThan(0);
    expect(behindRider.some(({ move }) => move === 'sit-in')).toBe(true);
    expect(behindRider.every(({ move }) => move === 'attack' || move === 'sit-in')).toBe(true);
  });
});

describe('what the model is shown under ADR 0073 (D-5)', () => {
  /** The race 30 s in, with the model told nothing it could move a bot with. */
  function raceAt30(): LapRaceRide {
    return ride(startRace(true), 30, () => ({
      reply: { kind: 'answer', body: { bots: [] } },
      afterMs: 1_000,
    })).ride;
  }

  it('deals each bot its racing style from the seed, apart from its legs (D-5.1)', () => {
    const race = raceAt30();
    const input = modelTacticsInputOf(
      race.race,
      race.bots,
      race.conditions.profile,
      race.seed,
      true,
      2,
      0,
    )!;
    const dealt = modelRacingStyles(SEED, race.bots.length);
    expect(input.bots.map((view) => view.style)).toEqual(input.bots.map((view) => dealt[view.bot]));
    expect(new Set(input.bots.map((view) => view.style)).size).toBe(MODEL_RACING_STYLES.length);
    expect(input.bots.map((view) => view.legs)).toEqual(
      input.bots.map((view) => race.bots[view.bot]?.plan?.archetype),
    );
    // No gate: the model reads the lull, never a yes or no computed from it (D-5.3).
    expect(Object.keys(input)).toEqual(['laps', 'field', 'quietS', 'rider', 'bots']);
  });

  it('shows the line as each bot misreads it, and whether it is blown (D-3.5, D-5.4)', () => {
    const race = raceAt30();
    const blownSeat = 2;
    const bots = race.bots.map((bot, seat) =>
      seat === blownSeat ? { ...bot, energy: { wbalJoules: 0, exhausted: true } } : bot,
    );
    const input = modelTacticsInputOf(
      race.race,
      bots,
      race.conditions.profile,
      race.seed,
      true,
      2,
      0,
    )!;
    const { laps, lapLengthMetres } = race.race.course;
    let misreadSomewhere = false;
    for (const view of input.bots) {
      const bot = bots[view.bot]!;
      const own = race.race.racers.find((entry) => entry.racer.id === bot.id)!.racer;
      const misread = botTacticsMisjudgement(
        race.seed,
        view.bot,
        bot.strategy.skill,
        race.race.atMs,
      ).lineMetres;
      expect(view.toLineM).toBe(Math.round(laps * lapLengthMetres - own.effortDistance + misread));
      if (Math.abs(misread) >= 1) misreadSomewhere = true;
      expect(view.blown).toBe(view.bot === blownSeat);
    }
    expect(misreadSomewhere).toBe(true);
  });

  it('shows the rider’s own state: rank, who is ahead, the gaps and the draft (D-5.2)', () => {
    const at30 = raceAt30();
    // The rider put mid-field, just behind the fourth bot, so both gaps are read.
    const fourth = at30.race.racers
      .map((entry) => entry.racer)
      .filter((racer) => racer.id !== LAP_RACE_RIDER_ID)
      .sort((a, b) => b.effortDistance - a.effortDistance)[3]!;
    const race: LapRaceRide = {
      ...at30,
      race: {
        ...at30.race,
        racers: at30.race.racers.map((entry) =>
          entry.racer.id === LAP_RACE_RIDER_ID
            ? { ...entry, racer: { ...entry.racer, effortDistance: fourth.effortDistance - 0.6 } }
            : entry,
        ),
      },
    };
    const input = modelTacticsInputOf(
      race.race,
      race.bots,
      race.conditions.profile,
      race.seed,
      true,
      2,
      0,
    )!;
    const order = race.race.racers
      .map((entry) => entry.racer)
      .sort((a, b) => b.effortDistance - a.effortDistance || (a.id < b.id ? -1 : 1));
    const at = order.findIndex((racer) => racer.id === LAP_RACE_RIDER_ID);
    const rider = order[at]!;
    const ahead = order[at - 1];
    const behind = order[at + 1];
    expect(input.rider.rank).toBe(at + 1);
    expect(input.rider.ahead).toBe(
      ahead === undefined ? null : race.bots.findIndex((bot) => bot.id === ahead.id),
    );
    expect(input.rider.gapAheadM).toBe(
      ahead === undefined
        ? null
        : Math.round((ahead.effortDistance - rider.effortDistance) * 10) / 10,
    );
    expect(input.rider.gapBehindM).toBe(
      behind === undefined
        ? null
        : Math.round((rider.effortDistance - behind.effortDistance) * 10) / 10,
    );
    expect(typeof input.rider.drafting).toBe('boolean');
    // Non-vacuity: bots ahead and behind, and the rider on the fourth bot's wheel.
    expect(input.rider.ahead).not.toBeNull();
    expect(input.rider.gapBehindM).not.toBeNull();
    expect(input.rider.drafting).toBe(true);
  });
});

describe('the strategy is the model’s, through the shipped race (ADR 0073 D-3)', () => {
  it('rides a flyer and a kick on the first lap, which ADR 0071’s rules refused', () => {
    const model = ride(startRace(true), 30, (input) => ({
      reply: {
        kind: 'answer',
        body: {
          bots: [
            { bot: 0, move: 'flyer' },
            { bot: 1, move: 'kick' },
          ].filter((move) => input.bots.some((view) => view.bot === move.bot)),
        },
      },
      afterMs: 1_000,
    }));
    // Three laps out: no seeded bot rides either here.
    const seeded = ride(startRace(false), 30, undefined);
    expect(seeded.tactics.some((frame) => frame[0] === 'flyer' || frame[1] === 'kick')).toBe(false);
    expect(model.tactics.some((frame) => frame[0] === 'flyer')).toBe(true);
    expect(model.tactics.some((frame) => frame[1] === 'kick')).toBe(true);
  });
});

describe('the body’s limits hold under any strategy (ADR 0073 D-2)', () => {
  it('never lets a blown bot over CP, nor any bot over its peak, every bot told to go all-out', () => {
    let race = startRace(true);
    let along = 0;
    let blownTicks = 0;
    let overCpTicks = 0;
    for (let tick = 0; tick < Math.round(SECONDS / LAP_RACE_TICK_SECONDS); tick += 1) {
      const blown = race.bots.map((bot) => bot.energy.exhausted);
      along += RIDER_SPEED * LAP_RACE_TICK_SECONDS;
      race = stepLapRaceRide(race, { ticks: 1, along, riderWatts: 150 });
      race.bots.forEach((bot, seat) => {
        const capacity = bot.plan?.capacity;
        if (capacity === undefined) return;
        expect(bot.power).toBeLessThanOrEqual(capacity.peakWatts + 1e-9);
        if (blown[seat] === true) {
          blownTicks += 1;
          expect(bot.power).toBeLessThanOrEqual(capacity.cpWatts + 1e-9);
        } else if (bot.power > capacity.cpWatts * 1.3) overCpTicks += 1;
      });
      const asking = askLapRaceRide(race, 150);
      race = asking.ride;
      if (asking.send !== undefined) {
        race = answerLapRaceRide(race, asking.send.ask, {
          kind: 'answer',
          body: {
            bots: asking.send.input.bots.map((view) => ({
              bot: view.bot,
              move: view.bot % 2 === 0 ? 'attack' : 'kick',
              effort: 'all-out',
            })),
          },
        });
      }
    }
    // Non-vacuity: bots went all-out, far over CP, and blew.
    expect(overCpTicks).toBeGreaterThan(100);
    expect(blownTicks).toBeGreaterThan(100);
  });
});

describe('what is kept with the ride (D-4.4)', () => {
  it('keeps the seed, the version, the log and the rider’s input at every tick', () => {
    const model = ride(startRace(true), 30, (input) => ({
      reply: ALL_ATTACK(input),
      afterMs: 2_000,
    }));
    const fact = lapRaceRideFact(model.ride);
    expect(fact?.seed).toBe(SEED);
    expect(fact?.version).toBe(2);
    expect(fact?.log).toEqual(model.ride.model?.log);
    const ticks = Math.round(30 / LAP_RACE_TICK_SECONDS);
    expect(fact?.rider.effortDistances).toHaveLength(ticks);
    expect(fact?.rider.lanes).toHaveLength(ticks);
    expect(fact?.rider.wattsPerKilogram[0]).toBe(150 / RIDER_KILOGRAMS);
    expect(fact?.rider.effortDistances.at(-1)).toBeCloseTo(RIDER_SPEED * 30, 6);
    // A copy: what the race appends after is not in it.
    const length = fact?.rider.effortDistances.length;
    stepLapRaceRide(model.ride, { ticks: 1, along: 400, riderWatts: 240 });
    expect(fact?.rider.effortDistances.length).toBe(length);
    expect(model.ride.race.racers.some((entry) => entry.racer.id === LAP_RACE_RIDER_ID)).toBe(true);
  });

  it('stops keeping the rider’s input once every bot is over the line', () => {
    let race = startRace(true);
    race = stepLapRaceRide(race, { ticks: 4, along: 2, riderWatts: 150 });
    expect(race.model?.rider.effortDistances).toHaveLength(4);
    const over: LapRaceRide = {
      ...race,
      race: {
        ...race.race,
        racers: race.race.racers.map((entry) =>
          entry.racer.id === LAP_RACE_RIDER_ID
            ? entry
            : { ...entry, racer: { ...entry.racer, finishedAtMs: 100 } },
        ),
      },
    };
    const after = stepLapRaceRide(over, { ticks: 4, along: 4, riderWatts: 150 });
    expect(after.model?.rider.effortDistances).toHaveLength(4);
  });

  it('keeps the ticks the rider used an item on', () => {
    let race = startRace(true);
    race = { ...race, input: { ...race.input, useAsked: true } };
    race = stepLapRaceRide(race, { ticks: 3, along: 1.2, riderWatts: 240 });
    expect(race.model?.rider.uses).toEqual([0]);
    expect(Math.floor(race.race.atMs / BOT_TACTICS_WINDOW_MS)).toBe(0);
  });
});
