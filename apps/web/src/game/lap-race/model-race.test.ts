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
 * rules ADR 0071 D-3.6 had are lifted, and the body's limits hold. Since
 * version 7 (#2836, ADR 0081) the model is asked about one bot at a time, from
 * a menu the device makes, and its `sit-in` leaves the bot to its seeded
 * tactics.
 */

import {
  BOT_ARCHETYPES,
  BOT_HARD_TACTICS,
  BOT_PERSONALITIES,
  BOT_SKILLS,
  BOT_TACTIC_MOVE_SHARE,
  BOT_TACTICS,
  BOT_TACTICS_WINDOW_MS,
  botFieldPaces,
  botTacticsMisjudgement,
  kilograms,
  MODEL_RACING_STYLES,
  MODEL_STRENGTH_WORDS,
  MODEL_TACTICS_ASK_EVERY_MS,
  MODEL_TACTICS_BUNCH_WORDS,
  MODEL_TACTICS_CUES,
  MODEL_TACTICS_LATE_MS,
  modelFieldPaces,
  modelFieldStrengths,
  modelRacingStyleOf,
  modelRacingStyles,
  modelTacticsAsk,
  readLapRaceModelRecord,
  readModelTacticsInput,
  type BotTactic,
  type ModelTacticsInput,
  type RouteProfile,
} from '@onyourleft/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { botName } from '../hud/lap-race-hud';
import { DEFAULT_RIDING_POSITION, rideConditionsFor } from '../rider';
import { circuitRoute } from '../route-fixtures-testing';
import { LAP_RACE_MOST_BOTS } from './choice';
import { modelTacticsRaceOf, type LapRaceModelAsk, type ModelTacticsReply } from './model-race';
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
function startRace(model: boolean, profile: RouteProfile = CIRCUIT, laps = 3): LapRaceRide {
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(
    <T extends ArrayBufferView>(array: T): T => {
      (array as unknown as Uint32Array)[0] = SEED;
      return array;
    },
  );
  const ride = startLapRaceRide({
    choice: { laps, bots: LAP_RACE_MOST_BOTS, tier: 'brisk', itemsOn: false },
    profile,
    conditions: lapRaceBotConditions(
      profile,
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

/**
 * The same race ridden on seeded tactics alone (#2759, ADR 0076 D-1): a race
 * with AI bots deals its own field (`modelFieldPaces`), so with no decision it
 * rides seeded tactics on that field, and this is what it must equal.
 */
function seededOnTheModelField(laps?: number): LapRaceRide {
  return { ...startRace(true, CIRCUIT, laps), model: undefined };
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
  /** The race time each of `sent` was asked at, ms. */
  readonly sentAt: number[];
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
  const sentAt: number[] = [];
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
      sentAt.push(asking.send.ask.askedAtMs);
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
  return { ride: race, drawn, sent, sentAt, tactics };
}

/** A pick of `move` for the bot an ask is about, as the instance answers it. */
const pick = (move: BotTactic, more: Record<string, unknown> = {}): ModelTacticsReply => ({
  kind: 'answer',
  body: { reason: 'my-terrain', move, ...more },
});

/** The bot asked about sent on the first move of its menu: never sitting in, which is always last. */
const GO = (input: ModelTacticsInput): ModelTacticsReply =>
  pick((input.you.menu[0] as { move: BotTactic }).move);

/** The model with no opinion: every bot asked about left to its seeded tactics. */
const SIT_IN: Instance = () => ({ reply: pick('sit-in', { reason: 'save-legs' }), afterMs: 1_000 });

const SECONDS = 150;

describe('a race with AI bots and no decision rides seeded tactics on the model’s field (D-1.4)', () => {
  it('deals its own field, and leaves a seeded race’s as it was (#2759, ADR 0076 D-1)', () => {
    const model = startRace(true);
    const seeded = startRace(false);
    expect(model.bots.map((bot) => bot.pace)).toEqual(modelFieldPaces(SEED, LAP_RACE_MOST_BOTS));
    expect(seeded.bots.map((bot) => bot.pace)).toEqual(botFieldPaces(SEED, LAP_RACE_MOST_BOTS));
    expect(seeded.bots.every((bot) => bot.pace.body === undefined)).toBe(true);
    expect(model.bots.every((bot) => bot.pace.body !== undefined)).toBe(true);
    // Each bot is named by its pace's style, as in a seeded race.
    expect(Object.values(model.names)).toEqual(
      model.bots.map((bot, index) => botName(bot.pace.style, index + 1)),
    );
  });

  it('draws the field where the seeded race draws it when no answer ever arrives', () => {
    const seeded = ride(seededOnTheModelField(), SECONDS, undefined);
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
    const seeded = ride(seededOnTheModelField(), SECONDS, undefined);
    const model = ride(startRace(true), SECONDS, (input) => ({
      reply: GO(input),
      afterMs: 2_500,
    }));
    const log = model.ride.model?.log ?? [];
    expect(log.length).toBeGreaterThan(20);
    expect(log.every((entry) => entry.outcome === 'decision')).toBe(true);
    expect(model.drawn).not.toStrictEqual(seeded.drawn);
  });

  it.each<[string, Instance]>([
    ['a late answer', (input) => ({ reply: GO(input), afterMs: MODEL_TACTICS_LATE_MS + 300 })],
    [
      'an invalid answer: a power in it',
      (input) => ({
        reply: pick((input.you.menu[0] as { move: BotTactic }).move, { watts: 900 }),
        afterMs: 2_000,
      }),
    ],
    [
      'an invalid answer: a move the device did not offer',
      (input) => ({
        reply: pick(
          BOT_HARD_TACTICS.find(
            (move) => !input.you.menu.some((entry) => entry.move === move),
          ) as BotTactic,
        ),
        afterMs: 2_000,
      }),
    ],
    [
      'an invalid answer: no reason word',
      (input) => ({
        reply: { kind: 'answer', body: { move: (input.you.menu[0] as { move: string }).move } },
        afterMs: 2_000,
      }),
    ],
    [
      'an invalid answer: the whole field’s, as it was before #2836',
      (input) => ({
        reply: { kind: 'answer', body: { bots: [{ bot: input.you.bot, move: 'attack' }] } },
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
    const seeded = ride(seededOnTheModelField(), SECONDS, undefined);
    const missed = ride(startRace(true), SECONDS, instance);
    expect(missed.sent.length).toBeGreaterThan(10);
    const log = missed.ride.model?.log ?? [];
    expect(log.some((entry) => entry.outcome === 'decision')).toBe(false);
    expect(missed.drawn).toStrictEqual(seeded.drawn);
  });

  it('applies an answer 6 to 8 s after its ask, and logs one past 8 s late (#2759, ADR 0076 D-11)', () => {
    expect(MODEL_TACTICS_LATE_MS).toBe(8_000);
    const seeded = ride(seededOnTheModelField(), 30, undefined);
    for (const afterMs of [6_000, 6_500, 7_000, 8_000]) {
      const slow = ride(startRace(true), 30, (input) => ({ reply: GO(input), afterMs }));
      const log = slow.ride.model?.log ?? [];
      expect(log.length, `${String(afterMs)} ms`).toBeGreaterThan(0);
      for (const entry of log) {
        expect(entry.outcome, `${String(afterMs)} ms`).toBe('decision');
        expect(entry.arrivedAtMs - entry.askedAtMs).toBe(afterMs);
      }
      // Applied: the field is moved off its seeded race.
      expect(slow.drawn).not.toStrictEqual(seeded.drawn);
    }
    for (const afterMs of [8_100, 9_000]) {
      const late = ride(startRace(true), 30, (input) => ({ reply: GO(input), afterMs }));
      const log = late.ride.model?.log ?? [];
      expect(log.length).toBeGreaterThan(0);
      expect(log.every((entry) => entry.outcome === 'late' && entry.reason === 'no-answer')).toBe(
        true,
      );
      expect(late.drawn).toStrictEqual(seeded.drawn);
    }
  });

  it('logs each miss with its closed reason, never the answer', () => {
    const late = ride(startRace(true), 30, (input) => ({
      reply: GO(input),
      afterMs: 8_400,
    }));
    expect(late.ride.model?.log[0]).toMatchObject({ outcome: 'late', reason: 'no-answer' });
    const invalid = ride(startRace(true), 30, (input) => ({
      reply: pick((input.you.menu[0] as { move: BotTactic }).move, { watts: 900 }),
      afterMs: 1_000,
    }));
    // The call, and what it was about, and nothing of the answer (#2836).
    expect(invalid.ride.model?.log[0]).toEqual({
      askedAtMs: expect.any(Number) as number,
      arrivedAtMs: expect.any(Number) as number,
      outcome: 'invalid',
      reason: 'unknown-key',
      bot: invalid.sent[0]?.you.bot,
      rank: invalid.sent[0]?.you.rank,
      cues: invalid.sent[0]?.you.cues,
      menu: invalid.sent[0]?.you.menu,
    });
    const offMenu = ride(startRace(true), 30, () => ({ reply: pick('kick'), afterMs: 1_000 }));
    expect(offMenu.ride.model?.log[0]).toMatchObject({ outcome: 'invalid', reason: 'off-menu' });
    const unreasoned = ride(startRace(true), 30, (input) => ({
      reply: pick((input.you.menu[0] as { move: BotTactic }).move, { reason: 'it felt right' }),
      afterMs: 1_000,
    }));
    expect(unreasoned.ride.model?.log[0]).toMatchObject({
      outcome: 'invalid',
      reason: 'bad-reason',
    });
    expect(JSON.stringify(unreasoned.ride.model?.log)).not.toContain('it felt right');
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
      reply: GO(input),
      afterMs: 2_550,
    }));
    const first = model.ride.model?.log[0];
    expect(first?.askedAtMs).toBe(4_000);
    // Asked at 4.0 s, settled 2.55 s later, handed in on the first frame after: 6.6 s.
    expect(first?.arrivedAtMs).toBe(6_600);
    expect(first?.outcome).toBe('decision');
    // #2836: the next ask goes out as soon as it settled: on the frame after, 6.7 s.
    expect(model.ride.model?.log[1]?.askedAtMs).toBe(6_700);
  });

  it('asks about one bot a second at most, round the field, when the answers are quick (#2836, ADR 0081 D-2.1)', () => {
    const quick = ride(startRace(true), 40, (input) => ({ reply: GO(input), afterMs: 300 }));
    expect(quick.sentAt[0]).toBe(4_000);
    for (const [at, askedAtMs] of quick.sentAt.entries()) {
      if (at > 0) {
        expect(askedAtMs - (quick.sentAt[at - 1] as number)).toBeGreaterThanOrEqual(
          MODEL_TACTICS_ASK_EVERY_MS,
        );
      }
    }
    // About one a second: 36 s of asking, and a second between asks with a 300 ms answer.
    expect(quick.sent.length).toBeGreaterThan(30);
    // Each ask is about one bot, a different one from the last while more than one has a choice.
    const seats = quick.sent.map((input) => input.you.bot);
    expect(new Set(seats).size).toBeGreaterThan(3);
    const repeats = seats.filter((seat, at) => at > 0 && seat === seats[at - 1]).length;
    expect(repeats).toBeLessThan(seats.length / 4);
    // One decision a bot: every logged decision names the bot its call was about.
    for (const entry of quick.ride.model?.log ?? []) {
      expect(entry.moves).toHaveLength(1);
      expect(entry.moves?.[0]?.bot).toBe(entry.bot);
    }
  });

  it('asks one call at a time, and never while one is out', () => {
    const asks: number[] = [];
    ride(startRace(true), 40, (input, askedAtMs) => {
      asks.push(askedAtMs);
      return { reply: GO(input), afterMs: 3_900 };
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
    race = stepLapRaceRide(first.ride, { ticks: 200, along: 126, riderWatts: 150 });
    race = answerLapRaceRide(
      race,
      send?.ask as LapRaceModelAsk,
      GO(send?.input as ModelTacticsInput),
    );
    expect(race.model?.log).toEqual([
      {
        askedAtMs: 4_000,
        arrivedAtMs: 14_000,
        outcome: 'late',
        reason: 'no-answer',
        bot: send?.ask.bot,
        rank: send?.ask.rank,
        cues: send?.ask.cues,
        menu: send?.ask.menu,
      },
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
    step(200);
    // Given up as late, and (#2836) the next bot asked about in the same breath.
    const second = askLapRaceRide(race, 240);
    race = second.ride;
    expect(race.model?.log).toHaveLength(1);
    expect(second.send).toBeDefined();
    const before = race;
    race = answerLapRaceRide(race, ask, GO(first.send?.input as ModelTacticsInput));
    expect(race).toBe(before);
    // An answer for another race, even one asked at the same race time about the same bot.
    const stranger = { ...(second.send?.ask as LapRaceModelAsk) };
    expect(answerLapRaceRide(race, stranger, { kind: 'unreachable' })).toBe(race);
    // The call that is out is still answered.
    expect(
      answerLapRaceRide(race, second.send?.ask as LapRaceModelAsk, { kind: 'unreachable' }).model
        ?.log,
    ).toHaveLength(2);
  });

  it('asks nothing more once the instance refused the race’s start, and rides seeded', () => {
    const seeded = ride(seededOnTheModelField(), 60, undefined);
    const busy = startedLapRaceRide(startRace(true), { kind: 'refused', code: 'tactics_busy' });
    expect(busy.model?.unavailable).toBe('tactics_busy');
    const ridden = ride(busy, 60, (input) => ({ reply: GO(input), afterMs: 1_000 }));
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
      reply: GO(input),
      afterMs: 2_000,
    }));
    expect(model.sent.length).toBeGreaterThan(20);
    for (const input of model.sent) expect(readModelTacticsInput(input).ok).toBe(true);
    // No text a name or a place could ride in: every string is a move, a style,
    // a strength, a cue, a word for the bunch or "rider".
    const words = new Set<string>();
    JSON.stringify(model.sent, (_, value: unknown) => {
      if (typeof value === 'string') words.add(value);
      return value;
    });
    const closed = new Set<string>([
      ...BOT_TACTICS,
      ...BOT_ARCHETYPES,
      ...MODEL_RACING_STYLES,
      ...MODEL_STRENGTH_WORDS,
      ...MODEL_TACTICS_CUES,
      ...MODEL_TACTICS_BUNCH_WORDS,
      'rider',
    ]);
    expect([...words].filter((word) => !closed.has(word))).toEqual([]);
  });

  it('is one bot’s ask: the shared race first, and the bot last with its cues and a menu of two to four moves (#2836, ADR 0081 D-2)', () => {
    const model = ride(startRace(true), SECONDS, (input) => ({ reply: GO(input), afterMs: 900 }));
    expect(model.sent.length).toBeGreaterThan(50);
    const styles = modelRacingStyles(SEED, LAP_RACE_MOST_BOTS);
    for (const [at, input] of model.sent.entries()) {
      expect(Object.keys(input)).toEqual(['laps', 'course', 'rider', 'field', 'story', 'you']);
      expect(input.you.menu.length).toBeGreaterThanOrEqual(2);
      expect(input.you.menu.length).toBeLessThanOrEqual(4);
      expect(input.you.menu.at(-1)).toEqual({ move: 'sit-in' });
      expect(input.you.style).toBe(styles[input.you.bot]);
      // The bot asked about is in the field every ask shows, at the same place.
      const own = input.field.find((each) => each.bot === input.you.bot);
      expect(own).toMatchObject({ rank: input.you.rank, move: input.you.move });
      expect(input.story.raceS).toBe(Math.floor((model.sentAt[at] as number) / 1_000));
    }
    // Different bots are offered different things: the menus are not one menu.
    expect(
      new Set(model.sent.map((input) => input.you.menu.map((each) => each.move).join())).size,
    ).toBeGreaterThan(3);
    // A bot that has made a move is told how long ago; one that has not, that it has made none.
    expect(model.sent.some((input) => input.you.sinceMoveS === null)).toBe(true);
    expect(model.sent.some((input) => (input.you.sinceMoveS ?? 0) > 0)).toBe(true);
    // The story moves on: four seconds in nobody is away, and a break goes clear later.
    expect(model.sent[0]?.story).toMatchObject({ raceS: 4, away: null });
    expect(model.sent.some((input) => input.story.moved)).toBe(true);
    const away = model.sent.flatMap((input) => (input.story.away === null ? [] : [input.story]));
    expect(away.length).toBeGreaterThan(0);
    // A break that stays away has been away longer the next time it is told.
    expect(away.some((story) => (story.away?.s ?? 0) > 0)).toBe(true);
    for (const story of away) expect(story.away?.gapM).toBeGreaterThanOrEqual(30);
  });

  it('offers a bot behind the rider the rider’s move to follow, so it can mark the rider (#2715)', () => {
    const model = ride(startRace(true), SECONDS, SIT_IN);
    const marking = model.sent.flatMap((input, at) =>
      input.you.menu.some((entry) => entry.move === 'follow' && entry.target === 'rider')
        ? [{ atMs: model.sentAt[at] as number, cues: input.you.cues }]
        : [],
    );
    // The rider pushes 420 W from 40 s to 100 s, which is over every brisk bot's CP:
    // only then is the rider a move to cover.
    expect(marking.length).toBeGreaterThan(0);
    for (const { atMs, cues } of marking) {
      expect(atMs).toBeGreaterThanOrEqual(40_000);
      expect(atMs).toBeLessThan(100_100);
      expect(cues).toContain('move-ahead');
    }
  });
});

describe('what the model is shown under ADR 0073 (D-5)', () => {
  /** The race 30 s in, with the model told nothing it could move a bot with. */
  function raceAt30(): LapRaceRide {
    return ride(startRace(true), 30, SIT_IN).ride;
  }

  it('deals each bot its racing style from the seed, which decides its legs, so they are not sent (D-5.1, ADR 0076 D-3, D-11)', () => {
    const race = raceAt30();
    const input = modelTacticsRaceOf(race.race, race.bots, race.conditions, race.seed, true, 2, 0)!;
    const dealt = modelRacingStyles(SEED, race.bots.length);
    expect(input.bots.map((view) => view.style)).toEqual(input.bots.map((view) => dealt[view.bot]));
    expect(new Set(input.bots.map((view) => view.style)).size).toBe(MODEL_RACING_STYLES.length);
    // #2759: a climber has a climber's legs, a sprinter a sprinter's, so the
    // style says the legs and they are not sent (ADR 0076 D-11).
    for (const view of input.bots) {
      const legs = race.bots[view.bot]?.plan?.archetype;
      if (view.style === 'climber' || view.style === 'sprinter' || view.style === 'rouleur') {
        expect(legs).toBe(view.style);
      } else expect(legs).toBe('attacker');
      expect(Object.keys(view)).not.toContain('legs');
    }
    // No gate: the model reads the lull, never a yes or no computed from it
    // (D-5.3); and no count of racers, which the prompt never reads (D-11).
    // The course ahead is once for the race (#2794).
    expect(Object.keys(input)).toEqual(['laps', 'quietS', 'rider', 'bots', 'course']);
  });

  it('says how each bot compares with the whole field, finished bots included, in plain words (ADR 0076 D-4)', () => {
    const race = raceAt30();
    const input = modelTacticsRaceOf(race.race, race.bots, race.conditions, race.seed, true, 2, 0)!;
    const words = modelFieldStrengths(race.bots.map((bot) => bot.plan!.capacity));
    for (const view of input.bots) {
      const { flat, climb, sprint, punch } = view;
      expect({ flat, climb, sprint, punch }, String(view.bot)).toEqual(words[view.bot]);
    }
    // Not all average: the field differs, and the model is told so.
    expect(input.bots.some((view) => view.climb === 'strong')).toBe(true);
    expect(input.bots.some((view) => view.flat === 'weak')).toBe(true);
    // Bots that have finished still count in the field the others are read against:
    // finish all but the two weakest on the flat.
    const byFlat = race.bots
      .map((bot, seat) => ({ seat, cp: bot.plan!.capacity.cpWatts }))
      .sort((a, b) => a.cp - b.cp);
    const kept = new Set([byFlat[0]!.seat, byFlat[1]!.seat]);
    const finished = {
      ...race.race,
      racers: race.race.racers.map((entry) => {
        const seat = race.bots.findIndex((bot) => bot.id === entry.racer.id);
        return seat === -1 || kept.has(seat)
          ? entry
          : { ...entry, racer: { ...entry.racer, finishedAtMs: 1 } };
      }),
    };
    const after = modelTacticsRaceOf(finished, race.bots, race.conditions, race.seed, true, 2, 0)!;
    expect(after.bots.map((view) => view.bot).sort()).toEqual([...kept].sort());
    for (const view of after.bots) {
      const { flat, climb, sprint, punch } = view;
      expect({ flat, climb, sprint, punch }, String(view.bot)).toEqual(words[view.bot]);
    }
    // Non-vacuity: read against those two alone, the words would differ.
    const alone = modelFieldStrengths([...kept].map((seat) => race.bots[seat]!.plan!.capacity));
    expect(alone).not.toEqual([...kept].map((seat) => words[seat]));
  });

  it('shows a bot the rider in a move against its own CP per kilogram, at its body’s mass (ADR 0076 D-2.5)', () => {
    const race = raceAt30();
    // The lightest bot, with the rider 2 m ahead of it and every other bot well behind.
    const seat = race.bots.reduce(
      (best, bot, at) =>
        (bot.pace.body?.massKilograms ?? 75) < (race.bots[best]?.pace.body?.massKilograms ?? 75)
          ? at
          : best,
      0,
    );
    const bot = race.bots[seat]!;
    const mass = bot.pace.body!.massKilograms;
    expect(mass).toBeLessThan(70);
    const own = race.race.racers.find((entry) => entry.racer.id === bot.id)!.racer.effortDistance;
    const placed = {
      ...race.race,
      racers: race.race.racers.map((entry, at) => ({
        ...entry,
        racer: {
          ...entry.racer,
          effortDistance:
            entry.racer.id === bot.id
              ? own
              : entry.racer.id === LAP_RACE_RIDER_ID
                ? own + 2
                : own - 100 - at,
        },
      })),
    };
    const needed = (bot.plan!.capacity.cpWatts * (1 + BOT_TACTIC_MOVE_SHARE)) / mass;
    const shown = (wattsPerKilogram: number) =>
      modelTacticsRaceOf(
        placed,
        race.bots,
        race.conditions,
        race.seed,
        true,
        wattsPerKilogram,
        0,
      )!.bots.find((view) => view.bot === seat)!;
    expect(shown(needed * 1.02)).toMatchObject({ ahead: 'rider', aheadMove: 'attack' });
    // Over the same CP at 75 kg, but not at the bot's own mass: not a move.
    expect(needed * 0.98 * 75).toBeGreaterThan(
      bot.plan!.capacity.cpWatts * (1 + BOT_TACTIC_MOVE_SHARE),
    );
    expect(shown(needed * 0.98)).toMatchObject({ ahead: 'rider', aheadMove: 'sit-in' });
  });

  it('shows the line as each bot misreads it, and whether it is blown (D-3.5, D-5.4)', () => {
    const race = raceAt30();
    const blownSeat = 2;
    const bots = race.bots.map((bot, seat) =>
      seat === blownSeat ? { ...bot, energy: { wbalJoules: 0, exhausted: true } } : bot,
    );
    const input = modelTacticsRaceOf(race.race, bots, race.conditions, race.seed, true, 2, 0)!;
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
    const input = modelTacticsRaceOf(race.race, race.bots, race.conditions, race.seed, true, 2, 0)!;
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
    // Whole metres (ADR 0076 D-11): the rider 0.6 m behind the fourth bot reads 1.
    expect(input.rider.gapAheadM).toBe(
      ahead === undefined ? null : Math.round(ahead.effortDistance - rider.effortDistance),
    );
    expect(input.rider.gapAheadM).toBe(1);
    expect(input.rider.gapBehindM).toBe(
      behind === undefined ? null : Math.round(rider.effortDistance - behind.effortDistance),
    );
    expect(typeof input.rider.drafting).toBe('boolean');
    // Non-vacuity: bots ahead and behind, and the rider on the fourth bot's wheel.
    expect(input.rider.ahead).not.toBeNull();
    expect(input.rider.gapBehindM).not.toBeNull();
    expect(input.rider.drafting).toBe(true);
  });

  it('rounds what it shows: gaps to whole metres, the grade to a whole percent, W′ to a tenth (#2759, ADR 0076 D-11)', () => {
    const race = raceAt30();
    const input = modelTacticsRaceOf(race.race, race.bots, race.conditions, race.seed, true, 2, 0)!;
    const distance = new Map(race.race.racers.map((entry) => [entry.racer.id, entry.racer]));
    const rider = distance.get(LAP_RACE_RIDER_ID)!.effortDistance;
    let fractional = false;
    for (const view of input.bots) {
      const bot = race.bots[view.bot]!;
      const own = distance.get(bot.id)!.effortDistance;
      if (!Number.isInteger(rider - own)) fractional = true;
      expect(view.riderGapM).toBe(Math.round(rider - own));
      for (const gap of [view.gapAheadM, view.gapBehindM]) {
        if (gap !== null) expect(Number.isInteger(gap)).toBe(true);
      }
      expect(Number.isInteger(view.gradeAheadPct)).toBe(true);
      const share = bot.energy.wbalJoules / bot.plan!.capacity.wPrimeJoules;
      expect(view.wbal).toBe(Math.round(Math.min(1, Math.max(0, share)) * 10) / 10);
    }
    // Non-vacuity: the race's own distances are not whole metres.
    expect(fractional).toBe(true);
    // Every ask made from the trimmed state passes the instance's own reader (D-3.4).
    const asks = input.bots.flatMap((view) => {
      const made = modelTacticsAsk(input, view.bot, {
        sinceMoveS: null,
        raceS: 30,
        away: null,
        moved: false,
        climbInM: null,
      });
      return made === undefined ? [] : [made];
    });
    expect(asks.length).toBeGreaterThan(0);
    for (const made of asks) expect(readModelTacticsInput(made)).toMatchObject({ ok: true });
  });
});

describe('the strategy is the model’s, through the shipped race (ADR 0073 D-3), from the device’s menu (ADR 0081)', () => {
  it('rides a flyer on the first lap when the model picks it off a breakaway rider’s menu, which ADR 0071’s rules refused', () => {
    const flyer: Instance = (input) => ({
      reply: input.you.menu.some((entry) => entry.move === 'flyer')
        ? pick('flyer')
        : pick('sit-in', { reason: 'save-legs' }),
      afterMs: 600,
    });
    const model = ride(startRace(true), 40, flyer);
    const breakaways = modelRacingStyles(SEED, LAP_RACE_MOST_BOTS).flatMap((style, seat) =>
      style === 'breakaway' ? [seat] : [],
    );
    expect(breakaways.length).toBeGreaterThan(0);
    // Three laps out: no seeded bot goes on a flyer here.
    const seeded = ride(seededOnTheModelField(), 40, undefined);
    expect(seeded.tactics.some((frame) => frame.includes('flyer'))).toBe(false);
    for (const seat of breakaways) {
      expect(model.tactics.some((frame) => frame[seat] === 'flyer')).toBe(true);
    }
    // And only a bot it was offered to: nobody else's menu had one.
    expect(
      model.tactics.some((frame) =>
        frame.some((tactic, seat) => tactic === 'flyer' && !breakaways.includes(seat)),
      ),
    ).toBe(false);
  });
});

describe('the model’s sit-in is no opinion, through the shipped race (#2836, ADR 0081 D-1)', () => {
  it('rides the seeded race to the bit, to the line, when the model only ever says sit in', () => {
    // One lap of the circuit, 628 m, and long enough for the whole field to finish it.
    const seeded = ride(seededOnTheModelField(1), 120, undefined);
    const done = ride(startRace(true, CIRCUIT, 1), 120, SIT_IN);
    const racers = done.ride.race.racers.filter((entry) => entry.racer.id !== 'rider');
    expect(racers.every((entry) => entry.racer.finishedAtMs !== null)).toBe(true);
    // Non-vacuity: the model was asked and answered, all race long, and every answer was a decision.
    const log = done.ride.model?.log ?? [];
    expect(log.length).toBeGreaterThan(40);
    expect(log.every((entry) => entry.outcome === 'decision' && entry.why === 'save-legs')).toBe(
      true,
    );
    expect(log.every((entry) => entry.moves?.[0]?.move === 'sit-in')).toBe(true);
    // And the field is drawn exactly where the seeded race draws it, and rides the same moves.
    expect(done.drawn).toStrictEqual(seeded.drawn);
    expect(done.tactics).toStrictEqual(seeded.tactics);
    // So every bot still made moves of its own, and every one sprinted for the line.
    done.ride.bots.forEach((_, seat) => {
      expect(
        done.tactics.some((frame) => frame[seat] === 'kick'),
        `bot ${String(seat)} kicks`,
      ).toBe(true);
    });
    expect(done.ride.model?.moves.rode.length).toBeGreaterThan(LAP_RACE_MOST_BOTS);
    expect(done.ride.model?.moves.rode.every((each) => each.by === 'seeded')).toBe(true);
  });

  it('lets a climber attack on the climb the model sat it in on (the owner’s race of 2026-11-18)', () => {
    // A 1 257 m circuit: flat 300 m, 400 m up at 6 %, 400 m down, flat to the line.
    const HILL = circuitRoute(200, (along) =>
      along < 300
        ? 100
        : along < 700
          ? 100 + (along - 300) * 0.06
          : along < 1_100
            ? 124 - (along - 700) * 0.06
            : 100,
    );
    const climbers = modelRacingStyles(SEED, LAP_RACE_MOST_BOTS).flatMap((style, seat) =>
      style === 'climber' ? [seat] : [],
    );
    expect(climbers.length).toBeGreaterThan(0);
    const done = ride(startRace(true, HILL), 120, SIT_IN);
    // The model was asked about a climber on the climb, and said sit in.
    const onTheClimb = (done.ride.model?.log ?? []).filter(
      (entry) =>
        climbers.includes(entry.bot ?? -1) &&
        entry.cues?.includes('on-your-terrain') === true &&
        entry.moves?.[0]?.move === 'sit-in',
    );
    expect(onTheClimb.length).toBeGreaterThan(0);
    // And the climber attacked all the same: its seeded tactics decided, and the record says so.
    for (const seat of climbers) {
      expect(done.ride.model?.moves.rode).toContainEqual(
        expect.objectContaining({ bot: seat, move: 'attack', by: 'seeded' }),
      );
    }
  });
});

describe('a sprint instinct behind the model’s moves, through the shipped race (ADR 0074)', () => {
  it('launches every bot’s kick inside its launch, though the model sends it on another move every time it is asked', () => {
    // Never the kick: the first move on the menu that is not one, or sitting in.
    const never: Instance = (input) => {
      const other = input.you.menu.find((entry) => entry.move !== 'kick');
      return { reply: pick((other as { move: BotTactic }).move), afterMs: 400 };
    };
    // Long enough for the whole field to finish three laps of the circuit.
    const done = ride(startRace(true), 400, never);
    const racers = done.ride.race.racers.filter((entry) => entry.racer.id !== 'rider');
    expect(racers.every((entry) => entry.racer.finishedAtMs !== null)).toBe(true);
    const rode = done.ride.model?.moves.rode ?? [];
    // Non-vacuity: the model moved the race, and never named a kick.
    expect(rode.some((each) => each.by === 'model')).toBe(true);
    expect(rode.some((each) => each.by === 'model' && each.move === 'kick')).toBe(false);
    // Every bot kicked, by its seeded tactics or, with a model move in force, its instinct.
    done.ride.bots.forEach((_, seat) => {
      expect(
        rode.some((each) => each.bot === seat && each.move === 'kick'),
        `bot ${String(seat)} kicks`,
      ).toBe(true);
    });
    expect(rode.some((each) => each.move === 'kick' && each.by === 'instinct')).toBe(true);
  });
});

describe('the body’s limits hold under any strategy (ADR 0073 D-2)', () => {
  it('never lets a blown bot over CP, nor any bot over its peak, every bot told to go all-out', () => {
    let race = startRace(true);
    let along = 0;
    let blownTicks = 0;
    let overCpTicks = 0;
    // #2759: twice the other cases' length. A body's W′ grows with its mass
    // and strength (ADR 0076 D-2), and the heaviest last more than 150 s at
    // their peak before they blow.
    for (let tick = 0; tick < Math.round((2 * SECONDS) / LAP_RACE_TICK_SECONDS); tick += 1) {
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
        // The hardest move on its menu, all-out, every time it is asked about.
        const menu = asking.send.input.you.menu.map((entry) => entry.move);
        const hardest = BOT_HARD_TACTICS.toReversed().find((move) => menu.includes(move));
        race = answerLapRaceRide(
          race,
          asking.send.ask,
          pick(hardest ?? (menu[0] as BotTactic), { effort: 'all-out' }),
        );
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
      reply: GO(input),
      afterMs: 2_000,
    }));
    const fact = lapRaceRideFact(model.ride);
    expect(fact?.seed).toBe(SEED);
    expect(fact?.version).toBe(7);
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

  it('keeps what explains the race: who each bot is, what each call was about, and who chose each move (#2836, ADR 0081 D-5)', () => {
    const model = ride(startRace(true), 90, (input) => ({ reply: GO(input), afterMs: 700 }));
    const fact = lapRaceRideFact(model.ride);
    // Each bot's racing style, personality and skill, by seat.
    expect(fact?.bots).toEqual(
      model.ride.bots.map((bot) => ({
        style: modelRacingStyleOf(bot.pace.style),
        personality: bot.strategy.personality,
        skill: bot.strategy.skill,
      })),
    );
    expect(fact?.bots?.map((bot) => bot.style)).toEqual(
      modelRacingStyles(SEED, LAP_RACE_MOST_BOTS),
    );
    for (const bot of fact?.bots ?? []) {
      expect(BOT_PERSONALITIES).toContain(bot.personality);
      expect(BOT_SKILLS).toContain(bot.skill);
    }
    // With every call: the bot, its place, the cues and the menu it was sent with, and the reason word.
    const log = fact?.log ?? [];
    expect(log.length).toBe(model.sent.length - (model.ride.model?.asked === undefined ? 0 : 1));
    for (const [at, entry] of log.entries()) {
      const sent = model.sent[at]?.you;
      expect(entry).toMatchObject({
        askedAtMs: model.sentAt[at],
        bot: sent?.bot,
        rank: sent?.rank,
        cues: sent?.cues,
        menu: sent?.menu,
        outcome: 'decision',
        why: 'my-terrain',
      });
    }
    // Every change of move, in race order, with who chose it; and it is what the bots rode.
    const rode = fact?.rode ?? [];
    expect(rode.some((each) => each.by === 'model')).toBe(true);
    expect(rode.some((each) => each.by === 'seeded')).toBe(true);
    expect(rode.map((each) => each.atMs)).toEqual(
      rode.map((each) => each.atMs).toSorted((a, b) => a - b),
    );
    const last = new Map<number, string>();
    for (const each of rode) last.set(each.bot, each.move);
    model.ride.bots.forEach((bot, seat) => {
      expect(last.get(seat) ?? 'sit-in', `bot ${String(seat)}`).toBe(bot.tactics.tactic);
    });
    // A move the model chose is one a decision for that bot named, in force when it was taken up:
    // as named, or a follow or chase ridden as the chase or the sitting in its target's place makes it.
    for (const each of rode.filter((move) => move.by === 'model')) {
      expect(
        log.some((entry) => {
          const named = entry.moves?.[0]?.move;
          return (
            entry.bot === each.bot &&
            entry.arrivedAtMs < each.atMs &&
            each.atMs - entry.arrivedAtMs <= 11_100 &&
            (named === each.move || named === 'follow' || named === 'chase')
          );
        }),
        JSON.stringify(each),
      ).toBe(true);
    }
    // The whole record is one the store reads back: nothing in it but numbers and closed words.
    expect(readLapRaceModelRecord(JSON.parse(JSON.stringify(fact)))).toEqual(fact);
    // A copy: what the race notes after is not in it.
    const noted = rode.length;
    ride(model.ride, 30, (input) => ({ reply: GO(input), afterMs: 700 }));
    expect(fact?.rode).toHaveLength(noted);
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

describe('the course ahead, once for the race from the leading bot (#2794)', () => {
  /** A 1 885 m circuit: flat, 400 m down at 6 %, flat, then 400 m up at 6 % to 100 m before the line. */
  const FINISH_UP = circuitRoute(300, (along) =>
    along < 600
      ? 100
      : along < 1_000
        ? 100 - (along - 600) * 0.06
        : along < 1_385
          ? 76
          : along < 1_785
            ? 76 + (along - 1_385) * 0.06
            : 100,
  );
  /** A 628 m circuit: flat 100 m, 250 m up at 6 %, 250 m down, flat to the line. */
  const SHORT_HILL = circuitRoute(100, (along) =>
    along < 100
      ? 100
      : along < 350
        ? 100 + (along - 100) * 0.06
        : along < 600
          ? 115 - (along - 350) * 0.06
          : 100,
  );
  const quiet = SIT_IN;

  /** The race state after `seconds`, and the bot at the head of the race with its effort distance. */
  function after(start: LapRaceRide, seconds: number) {
    const race = ride(start, seconds, quiet).ride;
    const input = modelTacticsRaceOf(
      race.race,
      race.bots,
      race.conditions,
      race.seed,
      race.draft,
      null,
      0,
    );
    const ids = new Set(race.bots.map((bot) => bot.id));
    const head = race.race.racers
      .map((entry) => entry.racer)
      .filter((racer) => ids.has(racer.id) && racer.finishedAtMs === null)
      .sort((a, b) => b.effortDistance - a.effortDistance)[0];
    const bot = race.bots.find((each) => each.id === head?.id);
    if (input === undefined || head === undefined || bot === undefined) throw new Error('racing');
    return { race, input, effort: head.effortDistance, along: bot.ride.distance as number };
  }

  const nearly = (got: number | undefined, want: number) => {
    expect(got).toBeDefined();
    // The profile's grade is smoothed over 50 m, so a pitch's ends move by a cell or two.
    expect(Math.abs((got as number) - want)).toBeLessThanOrEqual(30);
  };

  it('shows the next climb and descent, the lap and the climbing left, and a finish that rises', () => {
    const { race, input, effort, along } = after(startRace(true, FINISH_UP), 20);
    const course = input.course;
    nearly(course?.climb?.inM, 1_385 - along);
    nearly(course?.climb?.lengthM, 400);
    expect(course?.climb).toMatchObject({ avgPct: 6, maxPct: 6 });
    nearly(course?.descent?.inM, 600 - along);
    expect(course?.descent).toMatchObject({ avgPct: -6, maxPct: -6 });
    expect(course?.lapLeftM).toBe(
      Math.round((race.race.course.lapLengthMetres - effort) / 10) * 10,
    );
    nearly(course?.lapClimbM, 24);
    // The last 500 m to the line: 400 m of it at 6 %, 24 m up.
    expect(course?.finishPct).toBe(5);
  });

  it('looks no further than the line: the climb on the next lap is shown only when there is one', () => {
    const last = after(startRace(true, SHORT_HILL, 1), 70);
    // Over the top of the race's only climb, the line is the next thing.
    expect(last.along).toBeGreaterThan(400);
    expect(last.input.course?.climb).toBeNull();
    expect(last.input.course?.lapLeftM).toBe(
      Math.round((last.race.race.course.lapLengthMetres - last.effort) / 10) * 10,
    );
    expect(last.input.course?.lapClimbM).toBe(0);
    const more = after(startRace(true, SHORT_HILL, 3), 70);
    expect(more.along).toBeGreaterThan(400);
    nearly(more.input.course?.climb?.inM, more.race.race.course.lapLengthMetres + 100 - more.along);
  });

  it('is sent with every ask, which the instance’s own reader takes', () => {
    const model = ride(startRace(true, FINISH_UP), 30, quiet);
    expect(model.sent.length).toBeGreaterThan(0);
    for (const input of model.sent) {
      expect(input.course).toBeDefined();
      expect(readModelTacticsInput(input)).toMatchObject({ ok: true });
    }
  });

  it('tells each bot how far its own next climb is, and says when it is soon (#2836)', () => {
    const model = ride(startRace(true, FINISH_UP), 150, quiet);
    // Every ask: the leading bot's climb, the bot's own gap behind it further, to 10 m.
    let behind = false;
    for (const input of model.sent) {
      const climb = input.course?.climb ?? null;
      if (climb === null) {
        expect(input.you.climbInM).toBeNull();
        continue;
      }
      expect(input.you.climbInM).not.toBeNull();
      expect((input.you.climbInM as number) % 10).toBe(0);
      expect(input.you.climbInM as number).toBeGreaterThanOrEqual(climb.inM);
      if ((input.you.climbInM as number) > climb.inM) behind = true;
      const soon = (input.you.climbInM as number) <= 300 && input.you.gradeAheadPct < 3;
      expect(input.you.cues.includes('climb-soon')).toBe(soon);
    }
    expect(behind).toBe(true);
    expect(model.sent.some((input) => input.you.cues.includes('climb-soon'))).toBe(true);
  });
});
