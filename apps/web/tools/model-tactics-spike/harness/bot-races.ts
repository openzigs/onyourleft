// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2838's scoring harness: **the six fixed AI-bot races, and one ridden.**
 *
 * Each race is the shipped one: `startLapRaceRide` with AI bots,
 * `stepLapRaceRide` a tick at a time, `askLapRaceRide` for the race state the
 * device would send and `answerLapRaceRide` for what comes back. The harness
 * stands where the instance does: it sends the instance's own request
 * (`production.ts`) to the model and reads the answer as the instance does,
 * with `@onyourleft/domain` §`readModelTacticsAnswer`, before the race reads
 * it again. No rule about which move a bot rides is here.
 *
 * ## The races ({@link BOT_RACES})
 *
 * Three circuits of 160 m radius, 1 005 m round, two laps, seven bots, the
 * draft on, about four minutes each: **flat**; **rolling**, a rise and fall
 * of 2 m twice a lap, under the grade the bots read as a climb; and a
 * **climb**, 30 m up in half a lap and down again, which they do. Each is
 * started **on the route's 0** and **mid-lap**, where the line is half a lap
 * round the route (#2800), each with its own seed. A field of seven holds
 * every racing style.
 *
 * ## Fixed seeds, here only
 *
 * A real race draws its seed from the platform's random source.
 * {@link startRace} holds that source to the race's seed for the one draw, as
 * `model-race-replay.test.ts` does, and every model call is seeded
 * (`model-call.ts` §`seeded`). Nothing under `src/` is changed for either.
 *
 * ## The race never waits, and neither does this
 *
 * The harness waits for each answer, then books it into the race at the race
 * time it would have arrived: its ask plus its measured latency. So a slow
 * model is late in the race exactly as it would be on the tablet, however
 * fast the harness steps.
 *
 * ## The rider
 *
 * A script, the same in every run: 200 W, 80 W either side on a 56 s
 * triangle wave (`model-race-replay.test.ts`'s), 75 kg, at the speed that
 * power holds on the grade under them.
 */

import {
  distanceOnRoute,
  gradeAt,
  gradePercent,
  kilograms,
  modelRacingStyleOf,
  modelTacticsSeats,
  readModelTacticsAnswer,
  type ModelTacticsInput,
  type RouteProfile,
} from '@onyourleft/domain';
import { steadyStateSpeedMetresPerSecond } from '@onyourleft/physics';

import { LAP_RACE_MOST_BOTS } from '../../../src/game/lap-race/choice';
import type { LapRaceModelAsk, ModelTacticsReply } from '../../../src/game/lap-race/model-race';
import {
  answerLapRaceRide,
  askLapRaceRide,
  LAP_RACE_TICK_SECONDS,
  lapRaceBotConditions,
  startLapRaceRide,
  stepLapRaceRide,
  type LapRaceRide,
} from '../../../src/game/lap-race/ride-race';
import { DEFAULT_RIDING_POSITION, rideConditionsFor } from '../../../src/game/rider';
import { circuitRoute } from '../../../src/game/route-fixtures-testing';

import type { BotRaceRun, BotRaceSample } from './bot-score';
import { seeded, type Ask, type ModelCall } from './model-call';
import type { TacticsPromptModule } from './production';

/** The circuits' radius, metres: a lap of 1 005 m. */
const RADIUS_METRES = 160;
const LAP_METRES = 2 * Math.PI * RADIUS_METRES;

/** The three circuits. */
export const BOT_CIRCUITS = {
  flat: circuitRoute(RADIUS_METRES, () => 0),
  // 2 m either side, twice a lap: 2.5 % at its steepest.
  rolling: circuitRoute(RADIUS_METRES, (along) => 2 * Math.sin((along / LAP_METRES) * Math.PI * 4)),
  // 15 m either side, once a lap: 30 m up at 6 % on average, and down again.
  climb: circuitRoute(RADIUS_METRES, (along) => -15 * Math.cos((along / LAP_METRES) * Math.PI * 2)),
} as const satisfies Readonly<Record<string, RouteProfile>>;

export type BotCircuit = keyof typeof BOT_CIRCUITS;

/** One fixed race. */
export interface BotRace {
  readonly name: string;
  readonly circuit: BotCircuit;
  /** Where on the route the line is, as a share of a lap: 0, or 0.5 for mid-lap. */
  readonly lineAtLapShare: 0 | 0.5;
  readonly seed: number;
}

/** The six races, each with its own seed. */
export const BOT_RACES: readonly BotRace[] = [
  { name: 'flat', circuit: 'flat', lineAtLapShare: 0, seed: 11 },
  { name: 'flat-mid-lap', circuit: 'flat', lineAtLapShare: 0.5, seed: 12 },
  { name: 'rolling', circuit: 'rolling', lineAtLapShare: 0, seed: 13 },
  { name: 'rolling-mid-lap', circuit: 'rolling', lineAtLapShare: 0.5, seed: 14 },
  { name: 'climb', circuit: 'climb', lineAtLapShare: 0, seed: 15 },
  { name: 'climb-mid-lap', circuit: 'climb', lineAtLapShare: 0.5, seed: 16 },
];

/** How many laps each race is. */
export const BOT_RACE_LAPS = 2;

/** The longest a race is ridden, seconds of race time: it ends sooner once every bot is over the line. */
export const BOT_RACE_MOST_SECONDS = 300;

const RIDER_KILOGRAMS = 75;

/** How far up the road a bot's grade is read, metres: the bots' own look-ahead. */
const GRADE_AHEAD_METRES = 50;

/** The rider's power at `atMs`: 200 W, 80 W either side on a 56 s triangle wave. */
export function scriptedRiderWatts(atMs: number): number {
  const phase = ((atMs + 14_000) % 56_000) / 56_000;
  return 200 + 80 * (phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase);
}

/** Start `race`, the platform's random source held to its seed for the race's one draw. */
function startRace(race: BotRace): LapRaceRide {
  const profile = BOT_CIRCUITS[race.circuit];
  const source = globalThis.crypto;
  const draw = source.getRandomValues.bind(source);
  Object.defineProperty(source, 'getRandomValues', {
    configurable: true,
    value: <T extends ArrayBufferView>(array: T): T => {
      (array as unknown as Uint32Array)[0] = race.seed;
      return array;
    },
  });
  try {
    const ride = startLapRaceRide({
      choice: { laps: BOT_RACE_LAPS, bots: LAP_RACE_MOST_BOTS, tier: 'brisk', itemsOn: false },
      profile,
      conditions: lapRaceBotConditions(
        profile,
        rideConditionsFor(kilograms(RIDER_KILOGRAMS), DEFAULT_RIDING_POSITION),
      ),
      riderDistance: race.lineAtLapShare * profile.totalDistance,
      lineOffset: 0,
      storage: undefined,
      draft: true,
      riderMassKilograms: RIDER_KILOGRAMS,
      model: true,
    });
    if (ride === undefined) throw new Error('a circuit starts a race');
    // Past the countdown: the harness scores the race, not the ten seconds before it.
    return { ...ride, countdownLeftMs: 0 };
  } finally {
    Object.defineProperty(source, 'getRandomValues', { configurable: true, value: draw });
  }
}

/** The race state at the end of a second, as the scores read it. */
function sampleOf(ride: LapRaceRide): BotRaceSample {
  const { profile } = ride.conditions;
  const line = ride.conditions.lineMetres ?? 0;
  const racing = new Map(
    ride.race.racers
      .filter((entry) => entry.racer.finishedAtMs === null)
      .map((entry) => [entry.racer.id, entry.racer.effortDistance]),
  );
  let leader: number | null = null;
  let furthest = Number.NEGATIVE_INFINITY;
  ride.bots.forEach((bot, seat) => {
    const at = racing.get(bot.id);
    if (at !== undefined && at > furthest) {
      furthest = at;
      leader = seat;
    }
  });
  return {
    tactics: ride.bots.map((bot) => (racing.has(bot.id) ? bot.tactics.tactic : null)),
    blown: ride.bots.map((bot) => bot.energy.exhausted),
    gradeAheadPct: ride.bots.map(
      (bot) =>
        Math.round(
          gradeAt(
            profile,
            distanceOnRoute(profile, bot.ride.distance + line + GRADE_AHEAD_METRES),
          ) * 10,
        ) / 10,
    ),
    leader,
  };
}

/**
 * What the device is handed for `call`, standing where the instance and the
 * tactics port do: the instance reads the model's text and answers its moves,
 * `tactics_invalid` for a text that is no decision, `tactics_failed` for none.
 */
function replyOf(call: ModelCall, input: ModelTacticsInput): ModelTacticsReply {
  if (call.text === undefined) return { kind: 'refused', code: 'tactics_failed' };
  const read = readModelTacticsAnswer(call.text, modelTacticsSeats(input));
  return read.ok
    ? { kind: 'answer', body: { bots: read.moves } }
    : { kind: 'refused', code: 'tactics_invalid' };
}

/** What a harness run needs to ride a race: the model, its name, and the instance's request. */
export interface BotRaceRider {
  readonly ask: Ask;
  readonly model: string;
  readonly prompt: Pick<TacticsPromptModule, 'tacticsRequest'>;
}

/**
 * Ride `race` with its bots' moves from the model, and return it as the
 * scores read it. Ends when every bot is over the line, or at `mostSeconds`
 * of race time.
 */
export async function rideBotRace(
  race: BotRace,
  rider: BotRaceRider,
  mostSeconds: number = BOT_RACE_MOST_SECONDS,
): Promise<BotRaceRun> {
  const profile = BOT_CIRCUITS[race.circuit];
  const conditions = rideConditionsFor(kilograms(RIDER_KILOGRAMS), DEFAULT_RIDING_POSITION);
  let ride = startRace(race);
  let along = ride.startAlong;
  let asked = 0;
  const pending: { atMs: number; ask: LapRaceModelAsk; reply: ModelTacticsReply }[] = [];
  const calls: ModelCall[] = [];
  const samples: BotRaceSample[] = [];
  const ticksASecond = Math.round(1 / LAP_RACE_TICK_SECONDS);
  const ticks = mostSeconds * ticksASecond;
  for (let tick = 1; tick <= ticks; tick += 1) {
    for (const due of pending.filter((each) => each.atMs <= ride.race.atMs)) {
      ride = answerLapRaceRide(ride, due.ask, due.reply);
      pending.splice(pending.indexOf(due), 1);
    }
    const watts = scriptedRiderWatts(ride.race.atMs);
    along +=
      steadyStateSpeedMetresPerSecond({
        powerWatts: watts,
        totalMass: conditions.totalMass,
        grade: gradePercent(gradeAt(profile, distanceOnRoute(profile, along))),
        airDensityKilogramsPerCubicMetre: conditions.airDensityKilogramsPerCubicMetre,
        ...(conditions.coefficients === undefined ? {} : { coefficients: conditions.coefficients }),
      }) * LAP_RACE_TICK_SECONDS;
    ride = stepLapRaceRide(ride, { ticks: 1, along, riderWatts: watts });
    const asking = askLapRaceRide(ride, watts);
    ride = asking.ride;
    if (asking.send !== undefined) {
      const { input, ask } = asking.send;
      asked += 1;
      const call = await rider.ask(
        seeded(rider.prompt.tacticsRequest(rider.model, input), race.seed * 1_000 + asked),
      );
      calls.push(call);
      pending.push({
        atMs: ask.askedAtMs + Math.round(call.latencyMs),
        ask,
        reply: replyOf(call, input),
      });
    }
    if (tick % ticksASecond === 0) {
      const sample = sampleOf(ride);
      samples.push(sample);
      if (sample.tactics.every((tactic) => tactic === null)) break;
    }
  }
  return {
    race: race.name,
    hasClimb: race.circuit === 'climb',
    styles: ride.bots.map((bot) => modelRacingStyleOf(bot.pace.style)),
    samples,
    log: ride.model?.log ?? [],
    calls,
  };
}
