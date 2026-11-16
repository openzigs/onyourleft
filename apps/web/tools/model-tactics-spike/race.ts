// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2616's spike: one seeded seven-bot field ridden headless, as #2561's
 * harness (`src/game/lap-race/pack-harness.test.ts`) rides it, with its
 * tactics from one of three sources:
 *
 * - `seeded`: today's tactics, untouched;
 * - `log`: a decision log replayed (`decision-log.ts`): the seed, the log and
 *   the rules it was recorded under (`adapter.ts` §`ModelRules`) are the
 *   whole race;
 * - `live`: a model asked every 4 s of race time. The race waits for each
 *   answer and books it as arriving its measured latency later in race time,
 *   so the log a live run writes is the log its replay reads.
 *
 * Through the game's own race step (`stepLapRaceRide`, one 20 Hz tick a
 * call), the draft on, the same 3-lap, 628 m circuits, rider and 150 s as
 * #2561's harness. The adapter runs before each tick (`adapter.ts`).
 *
 * Spike code: see `decision.ts`.
 */

import { kilograms, type BotTactic, type RouteProfile } from '@onyourleft/domain';
import { lapRaceDraftFactors } from '@onyourleft/physics';

import { LAP_RACE_MOST_BOTS } from '../../src/game/lap-race/choice';
import { BIKE_LENGTH_METRES, PACK_ABREAST_METRES } from '../../src/game/lap-race/pack-layout';
import {
  LAP_RACE_TICK_SECONDS,
  lapRaceBotConditions,
  lapRaceDrawing,
  startLapRaceRide,
  stepLapRaceRide,
  type LapRaceRide,
} from '../../src/game/lap-race/ride-race';
import { DEFAULT_RIDING_POSITION, rideConditionsFor } from '../../src/game/rider';
import { circuitRoute } from '../../src/game/route-fixtures-testing';

import { applyModelMoves, type ModelRules, type MoveOutcome } from './adapter';
import { parseModelDecision } from './decision';
import {
  MODEL_DECISION_EVERY_MS,
  movesInForce,
  nextRequestAtMs,
  outcomeFor,
  type LoggedDecision,
} from './decision-log';
import { modelInput, type ModelInput } from './model-input';

/** #2561's two circuits: 100 m radius, 628 m round, level and with a 12 m rise and fall. */
export const SPIKE_CIRCUITS = {
  flat: circuitRoute(100, () => 0),
  hilly: circuitRoute(100, (along) => 12 * Math.sin((along / (2 * Math.PI * 100)) * Math.PI * 2)),
} as const;

export type SpikeCircuit = keyof typeof SPIKE_CIRCUITS;

/** #2561's seeds, ridden time, and rider. */
export const SPIKE_SEEDS = [1, 2, 3] as const;
export const SPIKE_RIDDEN_SECONDS = 150;
const RIDER_SPEED = 8;
const RIDER_WATTS = 200;
const RIDER_KILOGRAMS = 75;

/** What one model call came to, as the live source reports it. */
export interface ModelCall {
  /** The model's answer, or `undefined` when the call failed. */
  readonly text: string | undefined;
  /** The latency booked in race time, ms. */
  readonly latencyMs: number;
  readonly failed?: string | undefined;
  readonly promptTokens?: number | undefined;
  readonly outputTokens?: number | undefined;
  readonly serverMs?: number | undefined;
  readonly wallMs?: number | undefined;
}

/** A live model: asked with the race as the model reads it. */
export type Decider = (input: ModelInput, requestedAtMs: number) => Promise<ModelCall>;

/** Where a field's tactics come from; a `log` or `live` source rides ADR 0073's rules unless it names others (#2720). */
export type TacticsSource =
  | { readonly kind: 'seeded' }
  | {
      readonly kind: 'log';
      readonly log: readonly LoggedDecision[];
      readonly rules?: ModelRules | undefined;
    }
  | { readonly kind: 'live'; readonly decide: Decider };

/** One tick of a field, as the comparison reads it. */
export interface FieldTick {
  readonly second: number;
  /** Race places, metres: effort distance and offset. */
  readonly at: ReadonlyMap<string, number>;
  readonly tactic: ReadonlyMap<string, BotTactic>;
  readonly wbal: ReadonlyMap<string, number>;
  /** Whether each bot is exhausted after the tick (#2720). Not in {@link fieldTrace}: it follows from W′. */
  readonly exhausted: ReadonlyMap<string, boolean>;
  readonly k: ReadonlyMap<string, number>;
  /** Each bot's power on the tick, watts. */
  readonly power: ReadonlyMap<string, number>;
  /** How far the two racers drawn furthest inside each other are inside, metres (#2561). */
  readonly inside: number;
}

/** A field ridden: its ticks, the log it was ridden with, and every window's outcome. */
export interface FieldRun {
  readonly ticks: readonly FieldTick[];
  readonly log: readonly LoggedDecision[];
  readonly outcomes: Readonly<Record<MoveOutcome, number>>;
  /** The last ride state, for what a case reads off the bots. */
  readonly last: LapRaceRide;
}

/**
 * Seconds from the last of `ticks` in which any bot was attacking or on a
 * flyer to `atMs`, or from the start with none (#2708): what the model reads
 * as `quietS`.
 */
export function quietSeconds(ticks: readonly FieldTick[], atMs: number): number {
  for (let at = ticks.length - 1; at >= 0; at -= 1) {
    const tick = ticks[at] as FieldTick;
    if ([...tick.tactic.values()].some((move) => move === 'attack' || move === 'flyer')) {
      return Math.max(0, atMs / 1_000 - tick.second);
    }
  }
  return atMs / 1_000;
}

/** Start the field `seed` deals on `profile`, with the platform's random source held to `seed`. */
function startField(profile: RouteProfile, seed: number): LapRaceRide {
  const source = globalThis.crypto;
  const draw = source.getRandomValues.bind(source);
  Object.defineProperty(source, 'getRandomValues', {
    configurable: true,
    value: <T extends ArrayBufferView>(array: T): T => {
      (array as unknown as Uint32Array)[0] = seed;
      return array;
    },
  });
  try {
    const ride = startLapRaceRide({
      choice: { laps: 3, bots: LAP_RACE_MOST_BOTS, tier: 'brisk', itemsOn: false },
      profile,
      conditions: lapRaceBotConditions(
        profile,
        rideConditionsFor(kilograms(RIDER_KILOGRAMS), DEFAULT_RIDING_POSITION),
      ),
      riderDistance: 50,
      lineOffset: 0,
      storage: undefined,
      draft: true,
      riderMassKilograms: RIDER_KILOGRAMS,
    });
    if (ride === undefined) throw new Error('a circuit starts a race');
    return ride;
  } finally {
    Object.defineProperty(source, 'getRandomValues', { configurable: true, value: draw });
  }
}

/** How far the two racers drawn furthest inside each other are inside, metres. */
function deepest(ride: LapRaceRide, along: number): number {
  const drawing = lapRaceDrawing(ride, along, 0, false);
  const drawn = [
    { along: drawing.riderDistance, lateral: drawing.steeredLateral },
    ...drawing.raceBots.map((bot) => ({ along: bot.distanceMetres, lateral: bot.lateralMetres })),
  ];
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

/** Every outcome, counted 0: what a run starts from, and what a log written before #2720 lacks keys of. */
export const NO_OUTCOMES: Readonly<Record<MoveOutcome, number>> = {
  applied: 0,
  bridging: 0,
  marking: 0,
  'no-decision': 0,
  'not-named': 0,
  launch: 0,
  exhausted: 0,
  'wbal-floor': 0,
  'kick-closed': 0,
  'flyer-closed': 0,
  'attack-over': 0,
  'target-not-ahead': 0,
};

/** Ride the field `seed` deals on `circuit` for `seconds`, its tactics from `source`. */
export async function rideField(
  circuit: SpikeCircuit,
  seed: number,
  source: TacticsSource,
  seconds: number = SPIKE_RIDDEN_SECONDS,
): Promise<FieldRun> {
  const profile = SPIKE_CIRCUITS[circuit];
  let ride = startField(profile, seed);
  let along = ride.startAlong;
  const log: LoggedDecision[] = source.kind === 'log' ? [...source.log] : [];
  const outcomes = { ...NO_OUTCOMES };
  const rules = source.kind === 'log' ? source.rules : undefined;
  let askAtMs = MODEL_DECISION_EVERY_MS;
  const ticks: FieldTick[] = [];
  const count = Math.round(seconds / LAP_RACE_TICK_SECONDS);
  for (let tick = 1; tick <= count; tick += 1) {
    const atMs = ride.race.atMs;
    if (source.kind === 'live' && atMs >= askAtMs) {
      const call = await source.decide(
        modelInput(
          ride.race,
          ride.bots,
          profile,
          ride.seed,
          ride.draft,
          RIDER_WATTS / RIDER_KILOGRAMS,
          quietSeconds(ticks, atMs),
        ),
        atMs,
      );
      const arrivedAtMs = atMs + Math.round(call.latencyMs);
      const parsed =
        call.text === undefined ? undefined : parseModelDecision(call.text, ride.bots.length);
      log.push({
        requestedAtMs: atMs,
        arrivedAtMs,
        outcome: parsed === undefined ? 'failed' : outcomeFor(parsed.ok, call.latencyMs),
        ...(parsed?.ok === true ? { moves: parsed.moves } : {}),
        ...(parsed?.ok === false ? { reason: parsed.reason } : {}),
        ...(call.failed === undefined ? {} : { reason: call.failed }),
        promptTokens: call.promptTokens,
        outputTokens: call.outputTokens,
        serverMs: call.serverMs,
        wallMs: call.wallMs,
      });
      askAtMs = nextRequestAtMs(arrivedAtMs);
    }
    if (source.kind !== 'seeded') {
      const applied = applyModelMoves(ride.race, ride.bots, movesInForce(log, atMs), rules);
      for (const outcome of applied.outcomes) outcomes[outcome] += 1;
      ride = { ...ride, bots: applied.bots };
    }
    along += RIDER_SPEED * LAP_RACE_TICK_SECONDS;
    ride = stepLapRaceRide(ride, { ticks: 1, along, riderWatts: RIDER_WATTS });
    const k = lapRaceDraftFactors(ride.race);
    ticks.push({
      second: tick * LAP_RACE_TICK_SECONDS,
      at: new Map(
        ride.race.racers.map((entry) => [
          entry.racer.id,
          entry.racer.effortDistance + entry.racer.raceOffset,
        ]),
      ),
      tactic: new Map(ride.bots.map((bot) => [bot.id, bot.tactics.tactic])),
      wbal: new Map(
        ride.bots.map((bot) => [
          bot.id,
          bot.plan === undefined ? 1 : bot.energy.wbalJoules / bot.plan.capacity.wPrimeJoules,
        ]),
      ),
      exhausted: new Map(ride.bots.map((bot) => [bot.id, bot.energy.exhausted])),
      k: new Map(Object.entries(k)),
      power: new Map(ride.bots.map((bot) => [bot.id, bot.power])),
      inside: deepest(ride, along),
    });
  }
  return { ticks, log, outcomes, last: ride };
}

/** A field's whole trace, every place, tactic, W′ and power: what a replay must match to the bit. */
export function fieldTrace(run: FieldRun): string {
  return JSON.stringify(
    run.ticks.map((tick) => [...tick.at, ...tick.tactic, ...tick.wbal, ...tick.power]),
  );
}
