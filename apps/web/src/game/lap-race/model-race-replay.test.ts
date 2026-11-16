// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A race with AI bots replays from its seed, its log and the bot-code
 * version** — #2710, ADR 0071 D-4.1 and D-4.3.
 *
 * Each case rides a race live against a scripted model whose answers arrive
 * at scripted latencies, then rides it again from the seed and the logged
 * decisions alone, with nothing asked: the field must be the same to the bit,
 * tick for tick, and the rider's input the race kept must be the input it was
 * ridden with.
 *
 * ## The golden outcomes, keyed by version and append-only (D-4.3)
 *
 * `model-race-golden.json` holds, under each `LAP_RACE_BOT_CODE_VERSION`, a
 * digest of every committed race's whole field. A change that alters any bot's
 * output for one of them goes red here **unless the version is raised**, and
 * raising it means adding a new key beside the old. An edit of an old key in
 * place is caught by {@link SEALS}: the digest of each version's entry, which
 * only ever grows. A reviewer who sees a seal changed is looking at a rewrite
 * of history, which this file says is not allowed.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  BOT_TACTICS,
  kilograms,
  LAP_RACE_BOT_CODE_VERSION,
  type ModelTacticsInput,
} from '@onyourleft/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_RIDING_POSITION, rideConditionsFor } from '../rider';
import { circuitRoute } from '../route-fixtures-testing';
import { LAP_RACE_MOST_BOTS } from './choice';
import type { LapRaceModelAsk, ModelTacticsReply } from './model-race';
import {
  answerLapRaceRide,
  askLapRaceRide,
  LAP_RACE_TICK_SECONDS,
  lapRaceBotConditions,
  lapRaceRideFact,
  startLapRaceRide,
  stepLapRaceRide,
  type LapRaceRide,
} from './ride-race';

const CIRCUITS = {
  flat: circuitRoute(100, () => 0),
  hilly: circuitRoute(100, (along) => 12 * Math.sin((along / (2 * Math.PI * 100)) * Math.PI * 2)),
} as const;
type Circuit = keyof typeof CIRCUITS;
const RACES: readonly (readonly [Circuit, number])[] = [
  ['flat', 1],
  ['flat', 2],
  ['hilly', 1],
  ['hilly', 3],
];
/**
 * The races the golden outcomes hold: **flat ones only**. A climb reaches
 * `Math.atan`, `Math.sin` and `Math.cos` in the physics (`terms.ts`), which
 * IEEE 754 does not specify exactly and which V8 does not compute alike on
 * every machine: CI's x64 rode the hilly circuit to a different digest from an
 * arm64 Mac. On the flat the grade is 0, whose atan, sine and cosine every
 * engine gives exactly, so the outcome is the four operations' alone and the
 * same everywhere. The hilly races still replay to the bit above, on the
 * machine that rides them, which is what D-4.1 asks.
 */
const GOLDEN_RACES: readonly (readonly [Circuit, number])[] = [
  ['flat', 1],
  ['flat', 2],
  ['flat', 3],
];
const SECONDS = 90;
/**
 * One golden race long enough to reach the launch, so that ADR 0074's sprint
 * instinct is in the golden: the 90 s races above never reach a launch, and
 * version 3's digests of them equal version 2's. The flat circuit under seed 4
 * is the race found earliest apart from ADR 0073's strategy (148 s) and from
 * ADR 0074 without its hold (149 s), so 170 s turns either red at a small cost.
 */
const LAUNCH_RACE: readonly [Circuit, number] = ['flat', 4];
const LAUNCH_SECONDS = 170;
const RIDER_KILOGRAMS = 75;

/** Each version's golden entry's digest. Append-only: a new version adds a line, and none is edited. */
const SEALS: Readonly<Record<string, string>> = {
  '1': '265e3b2ac759823edbd007cc1b8d8a19a48b5bdcf2ffd9a5b69e1188a645418d',
  '2': 'b2aa7e152fc7194801420f8e75fcc878bb8fe070d45bdcf4a481f13796d3dc80',
  '3': '786f7d2ec42b745b9de1ac60e6dc6b9ce7b8843eb9109c5838f987b5574fc146',
};

afterEach(() => {
  vi.restoreAllMocks();
});

function startRace(circuit: Circuit, seed: number, model: boolean): LapRaceRide {
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(
    <T extends ArrayBufferView>(array: T): T => {
      (array as unknown as Uint32Array)[0] = seed;
      return array;
    },
  );
  const profile = CIRCUITS[circuit];
  const ride = startLapRaceRide({
    choice: { laps: 3, bots: LAP_RACE_MOST_BOTS, tier: 'brisk', itemsOn: false },
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

/** The scripted model: each bot a move by its seat and the ask, and a latency that varies, some late. */
function scripted(
  input: ModelTacticsInput,
  ask: number,
): { reply: ModelTacticsReply; afterMs: number } {
  return {
    reply: {
      kind: 'answer',
      body: {
        bots: input.bots
          .filter((view) => (view.bot + ask) % 3 !== 0)
          .map((view) => ({
            bot: view.bot,
            move: BOT_TACTICS[(view.bot * 5 + ask) % BOT_TACTICS.length] as string,
          })),
      },
    },
    afterMs: [1_900, 2_600, 3_300, 5_600][ask % 4] as number,
  };
}

const riderWatts = (atMs: number): number => 200 + 80 * Math.sin(atMs / 9_000);

/** Ride the race, 100 ms frames, its asks answered by `model` (none: a replay, which asks nothing). */
function ride(
  start: LapRaceRide,
  model: boolean,
  seconds = SECONDS,
): { ride: LapRaceRide; field: string[] } {
  let race = start;
  let along = 0;
  let asks = 0;
  const pending: { atMs: number; ask: LapRaceModelAsk; reply: ModelTacticsReply }[] = [];
  const field: string[] = [];
  for (let frame = 0; frame < seconds * 10; frame += 1) {
    for (const due of pending.filter((each) => each.atMs <= race.race.atMs)) {
      race = answerLapRaceRide(race, due.ask, due.reply);
      pending.splice(pending.indexOf(due), 1);
    }
    const watts = riderWatts(race.race.atMs);
    along += 8.5 * 2 * LAP_RACE_TICK_SECONDS;
    race = stepLapRaceRide(race, { ticks: 2, along, riderWatts: watts });
    if (model) {
      const asking = askLapRaceRide(race, watts);
      race = asking.ride;
      if (asking.send !== undefined) {
        const answer = scripted(asking.send.input, asks);
        asks += 1;
        pending.push({
          atMs: asking.send.ask.askedAtMs + answer.afterMs,
          ask: asking.send.ask,
          reply: answer.reply,
        });
      }
    }
    field.push(
      JSON.stringify(
        race.bots.map((bot) => [
          bot.ride.distance,
          bot.power,
          bot.energy.wbalJoules,
          bot.tactics.tactic,
        ]),
      ),
    );
  }
  return { ride: race, field };
}

/** The race once more from its seed and its log, asking nothing: what a stored race is. */
function replay(circuit: Circuit, seed: number, live: LapRaceRide): ReturnType<typeof ride> {
  const fresh = startRace(circuit, seed, true);
  const model = fresh.model;
  if (model === undefined || live.model === undefined) throw new Error('a model race');
  return ride(
    { ...fresh, model: { ...model, log: live.model.log, unavailable: 'refused' } },
    false,
  );
}

const digest = (text: string): string => createHash('sha256').update(text).digest('hex');

const golden = JSON.parse(
  readFileSync(new URL('./model-race-golden.json', import.meta.url), 'utf8'),
) as Record<string, Record<string, string>>;

describe('a race with AI bots replays from its seed, log and version (D-4.1)', () => {
  it.each(RACES)('replays the %s circuit under seed %i to the bit', (circuit, seed) => {
    const live = ride(startRace(circuit, seed, true), true);
    const log = live.ride.model?.log ?? [];
    // Non-vacuity: decisions applied, and some late.
    expect(log.filter((entry) => entry.outcome === 'decision').length).toBeGreaterThan(5);
    expect(log.some((entry) => entry.outcome === 'late')).toBe(true);
    const again = replay(circuit, seed, live.ride);
    expect(again.field).toStrictEqual(live.field);
    // The rider's input the race kept is the input both were ridden with.
    expect(lapRaceRideFact(again.ride)?.rider).toStrictEqual(lapRaceRideFact(live.ride)?.rider);
    // And the model moved the race: it is not the seeded one.
    const seeded = ride(startRace(circuit, seed, false), false);
    expect(seeded.field).not.toStrictEqual(live.field);
  });
});

describe('the golden outcomes, keyed by bot-code version (D-4.3)', () => {
  it('holds every committed race to its outcome under this version', () => {
    const entry = golden[String(LAP_RACE_BOT_CODE_VERSION)];
    expect(
      entry,
      'raise LAP_RACE_BOT_CODE_VERSION with a new golden key, never edit an old one',
    ).toBeDefined();
    for (const [circuit, seed] of GOLDEN_RACES) {
      const live = ride(startRace(circuit, seed, true), true);
      expect(digest(live.field.join('\n'))).toBe(entry?.[`${circuit}-${String(seed)}`]);
    }
  });

  it('holds a race that reaches the launch to its outcome under this version (ADR 0074)', () => {
    const [circuit, seed] = LAUNCH_RACE;
    const live = ride(startRace(circuit, seed, true), true, LAUNCH_SECONDS);
    expect(digest(live.field.join('\n'))).toBe(
      golden[String(LAP_RACE_BOT_CODE_VERSION)]?.[
        `${circuit}-${String(seed)}-${String(LAUNCH_SECONDS)}s`
      ],
    );
  });

  it('never rewrites an older version’s outcomes', () => {
    expect(Object.keys(SEALS)).toStrictEqual(Object.keys(golden));
    for (const [version, seal] of Object.entries(SEALS)) {
      expect(digest(JSON.stringify(golden[version])), `version ${version}`).toBe(seal);
    }
  });
});
