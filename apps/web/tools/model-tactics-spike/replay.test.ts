// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2616: the decision logs gemma4:12b wrote on the owner's instance PC
 * (2026-11-16), replayed through #2561's fields: spike 0039's six, with its
 * first prompt, in `results/`, #2708's six, with the tuned prompt, in
 * `results/2708/`, both under ADR 0071's rules, and #2720's six, with its
 * prompt under ADR 0073's rules, in `results/2720/`. Each is replayed under
 * the rules its file names (`rules`), or ADR 0071's where it names none.
 *
 * - **A replay from the seed and the log is the same race every time.**
 * - **What the model said is held to what #2561 holds the seeded race to**
 *   on every tick: no two racers drawn inside each other, no bot over its
 *   peak or under 0 W′.
 * - Every logged decision is one the schema reads, and none was late.
 *
 * What these cannot say is whether a replay is the *live* run: that holds
 * only against the bot code a log was recorded with, so it is checked by
 * `run-live.mjs compare` and written down in the write-up, not held here,
 * where any later tuning of the tactics would turn it red. (For spike 0039's
 * logs, `compare` could check only the outcome counts; #2708's carry the
 * live trace's SHA-256, and `compare` checks the whole trace.)
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { MODEL_RULES_BEFORE_2720, type ModelRules } from './adapter';
import { parseModelDecision } from './decision';
import { MODEL_DECISION_LATE_MS, type LoggedDecision } from './decision-log';
import { fieldTrace, rideField, SPIKE_SEEDS, type FieldRun, type SpikeCircuit } from './race';

/** The three runs: spike 0039's first prompt, #2708's tuned one, and #2720's. */
const RUNS = ['', '2708/', '2720/'] as const;
type Run = (typeof RUNS)[number];

interface Recorded {
  readonly model: string;
  readonly circuit: SpikeCircuit;
  readonly seed: number;
  readonly rules?: ModelRules;
  readonly log: readonly LoggedDecision[];
}

const FIELDS = RUNS.flatMap((run) =>
  (['flat', 'hilly'] as const).flatMap((circuit) =>
    SPIKE_SEEDS.map((seed) => ({ run, circuit, seed })),
  ),
);

function recorded(run: Run, circuit: SpikeCircuit, seed: number): Recorded {
  return JSON.parse(
    readFileSync(
      new URL(`./results/${run}${circuit}-${String(seed)}.json`, import.meta.url),
      'utf8',
    ),
  ) as Recorded;
}

/** Each field replayed once, the first time a case asks. */
const replayed = new Map<string, Promise<FieldRun>>();
function replay(run: Run, circuit: SpikeCircuit, seed: number): Promise<FieldRun> {
  const key = `${run} ${circuit} ${String(seed)}`;
  let ridden = replayed.get(key);
  if (ridden === undefined) {
    const file = recorded(run, circuit, seed);
    ridden = rideField(circuit, seed, {
      kind: 'log',
      log: file.log,
      rules: file.rules ?? MODEL_RULES_BEFORE_2720,
    });
    replayed.set(key, ridden);
  }
  return ridden;
}

describe('the recorded decision logs, replayed (#2616)', () => {
  it.each(FIELDS)(
    'holds the %o log to the schema, on time: gemma4:12b’s, every call a decision',
    ({ run, circuit, seed }) => {
      const file = recorded(run, circuit, seed);
      expect(file.model).toBe('gemma4:12b');
      // #2720's logs say they were ridden under ADR 0073's rules; the older ones name none.
      expect(file.rules ?? MODEL_RULES_BEFORE_2720).toBe(run === '2720/' ? 'adr-0073' : 'adr-0071');
      // #2720's longer prompt took over 4 s on 37 of its 186 calls, and the
      // next ask waits for the next 4 s mark after an answer: fewer calls.
      expect(file.log.length).toBeGreaterThan(run === '2720/' ? 20 : 30);
      for (const entry of file.log) {
        expect(entry.outcome).toBe('decision');
        expect(entry.arrivedAtMs - entry.requestedAtMs).toBeLessThanOrEqual(MODEL_DECISION_LATE_MS);
        expect(parseModelDecision(JSON.stringify({ bots: entry.moves }), 7).ok).toBe(true);
      }
    },
  );

  it.each(FIELDS)(
    'rides the %o log with nobody drawn inside anybody, over their peak or under 0 W′',
    async ({ run, circuit, seed }) => {
      const ridden = await replay(run, circuit, seed);
      expect(ridden.outcomes.applied).toBeGreaterThan(500);
      expect(Math.max(...ridden.ticks.map((tick) => tick.inside))).toBeLessThanOrEqual(1e-9);
      for (const bot of ridden.last.bots) {
        const peak = bot.plan?.capacity.peakWatts as number;
        for (const tick of ridden.ticks) {
          expect(tick.power.get(bot.id), bot.id).toBeLessThanOrEqual(peak);
          expect(tick.wbal.get(bot.id), bot.id).toBeGreaterThanOrEqual(0);
        }
      }
    },
  );

  it.each(RUNS.flatMap((run) => (['flat', 'hilly'] as const).map((circuit) => ({ run, circuit }))))(
    'replays the %o log of seed 1 identically',
    async ({ run, circuit }) => {
      const file = recorded(run, circuit, 1);
      const again = await rideField(circuit, 1, {
        kind: 'log',
        log: file.log,
        rules: file.rules ?? MODEL_RULES_BEFORE_2720,
      });
      expect(fieldTrace(again)).toBe(fieldTrace(await replay(run, circuit, 1)));
      expect(again.outcomes).toEqual((await replay(run, circuit, 1)).outcomes);
    },
  );
});
