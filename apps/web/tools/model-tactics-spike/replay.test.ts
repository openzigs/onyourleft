// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2616: the six decision logs gemma4:12b wrote on the owner's instance PC
 * (2026-11-16), replayed through #2561's fields.
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
 * where any later tuning of the tactics would turn it red.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseModelDecision } from './decision';
import { MODEL_DECISION_LATE_MS, type LoggedDecision } from './decision-log';
import { fieldTrace, rideField, SPIKE_SEEDS, type FieldRun, type SpikeCircuit } from './race';

interface Recorded {
  readonly model: string;
  readonly circuit: SpikeCircuit;
  readonly seed: number;
  readonly log: readonly LoggedDecision[];
}

const FIELDS = (['flat', 'hilly'] as const).flatMap((circuit) =>
  SPIKE_SEEDS.map((seed) => ({ circuit, seed })),
);

function recorded(circuit: SpikeCircuit, seed: number): Recorded {
  return JSON.parse(
    readFileSync(new URL(`./results/${circuit}-${String(seed)}.json`, import.meta.url), 'utf8'),
  ) as Recorded;
}

/** Each field replayed once, the first time a case asks. */
const replayed = new Map<string, Promise<FieldRun>>();
function replay(circuit: SpikeCircuit, seed: number): Promise<FieldRun> {
  const key = `${circuit} ${String(seed)}`;
  let run = replayed.get(key);
  if (run === undefined) {
    run = rideField(circuit, seed, { kind: 'log', log: recorded(circuit, seed).log });
    replayed.set(key, run);
  }
  return run;
}

describe('the recorded decision logs, replayed (#2616)', () => {
  it.each(FIELDS)(
    'holds the %o log to the schema, on time: gemma4:12b’s, every call a decision',
    ({ circuit, seed }) => {
      const file = recorded(circuit, seed);
      expect(file.model).toBe('gemma4:12b');
      expect(file.log.length).toBeGreaterThan(30);
      for (const entry of file.log) {
        expect(entry.outcome).toBe('decision');
        expect(entry.arrivedAtMs - entry.requestedAtMs).toBeLessThanOrEqual(MODEL_DECISION_LATE_MS);
        expect(parseModelDecision(JSON.stringify({ bots: entry.moves }), 7).ok).toBe(true);
      }
    },
  );

  it.each(FIELDS)(
    'rides the %o log with nobody drawn inside anybody, over their peak or under 0 W′',
    async ({ circuit, seed }) => {
      const run = await replay(circuit, seed);
      expect(run.outcomes.applied).toBeGreaterThan(500);
      expect(Math.max(...run.ticks.map((tick) => tick.inside))).toBeLessThanOrEqual(1e-9);
      for (const bot of run.last.bots) {
        const peak = bot.plan?.capacity.peakWatts as number;
        for (const tick of run.ticks) {
          expect(tick.power.get(bot.id), bot.id).toBeLessThanOrEqual(peak);
          expect(tick.wbal.get(bot.id), bot.id).toBeGreaterThanOrEqual(0);
        }
      }
    },
  );

  it.each(['flat', 'hilly'] as const)(
    'replays the %s log of seed 1 identically',
    async (circuit) => {
      const again = await rideField(circuit, 1, { kind: 'log', log: recorded(circuit, 1).log });
      expect(fieldTrace(again)).toBe(fieldTrace(await replay(circuit, 1)));
      expect(again.outcomes).toEqual((await replay(circuit, 1)).outcomes);
    },
  );
});
