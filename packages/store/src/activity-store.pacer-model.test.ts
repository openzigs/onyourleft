// SPDX-License-Identifier: Apache-2.0

/**
 * **The AI pacer's decision log is kept with the ride** — #2712, ADR 0072
 * D-5. `RideFacts.pacerModel` through the real store on a fresh connection,
 * written by `putActivity` and read by `getActivity` and
 * `listActivitySummaries`, by its rider only.
 *
 * A log that does not read is dropped whole — never the ride — because a
 * decision missing from the middle would replay a different pacer.
 */

import Dexie from 'dexie';
import { MODEL_PACER_CODE_VERSION, type PacerDecisionRecord } from '@onyourleft/domain';
import { afterEach, describe, expect, it } from 'vitest';

import type { PacerModelFact } from './records';
import { SCHEMA_VERSIONS, TABLE } from './schema';
import {
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  rideFor,
  seedAthletes,
  type StoreHarness,
} from './testing';

let harness: StoreHarness | undefined;

afterEach(async () => {
  await harness?.destroy();
  harness = undefined;
});

async function opened(): Promise<StoreHarness> {
  const open = createStoreHarness();
  harness = open;
  await seedAthletes(open);
  return open;
}

async function behindTheStore<T>(
  databaseName: string,
  use: (raw: Dexie) => Promise<T>,
): Promise<T> {
  const raw = new Dexie(databaseName);
  SCHEMA_VERSIONS.forEach((stores, index) => {
    raw.version(index + 1).stores(stores);
  });
  try {
    return await use(raw);
  } finally {
    raw.close();
  }
}

const DECISIONS: readonly PacerDecisionRecord[] = [
  { askedAtS: 0, arrivedAtS: 2.5, outcome: 'applied', plan: 'climber', intent: 'lift' },
  { askedAtS: 5, arrivedAtS: 11, outcome: 'late' },
  { askedAtS: 11, arrivedAtS: null, outcome: 'failed' },
  { askedAtS: 16, arrivedAtS: 17, outcome: 'invalid' },
];

const LOG: PacerModelFact = { version: MODEL_PACER_CODE_VERSION, decisions: DECISIONS };

/** Logs that do not read: a bad version, a bad decision anywhere, decisions out of order. */
const BAD: readonly unknown[] = [
  { version: 0, decisions: DECISIONS },
  { version: '1', decisions: DECISIONS },
  { version: 1, decisions: [] },
  { version: 1, decisions: 'all of them' },
  { version: 1, decisions: [DECISIONS[0], { ...DECISIONS[1], say: 'Stay with me.' }] },
  { version: 1, decisions: [DECISIONS[0], { ...DECISIONS[0], plan: 'sprint' }] },
  { version: 1, decisions: [DECISIONS[1], DECISIONS[0]] },
  'a log',
];

describe('the AI pacer’s log kept with its ride — #2712', () => {
  it('is written by putActivity and read back on a fresh connection, by its rider only, on the page and the history', async () => {
    const open = await opened();
    const ride = rideFor(ATHLETE_A, { rideFacts: { pacerModel: LOG } });
    const read = await open.roundTrip(
      async (store) => store.putActivity(ride),
      async (store) => ({
        mine: await store.getActivity(ATHLETE_A, ride.id),
        theirs: await store.getActivity(ATHLETE_B, ride.id),
        listed: await store.listActivitySummaries(ATHLETE_A),
      }),
    );
    expect(read.mine?.rideFacts).toStrictEqual({ pacerModel: LOG });
    expect(read.theirs).toBeUndefined();
    expect(read.listed.find((each) => each.id === ride.id)?.rideFacts?.pacerModel).toStrictEqual(
      LOG,
    );
  });

  it('leaves a log that does not read out on the way IN, and keeps the ride', async () => {
    const open = await opened();
    for (const bad of BAD) {
      const ride = rideFor(ATHLETE_A, { rideFacts: { drafted: true, pacerModel: bad as never } });
      await open.write(async (store) => store.putActivity(ride));
      const read = await open.read((store) => store.getActivity(ATHLETE_A, ride.id));
      const said = JSON.stringify(bad);
      expect(read?.id, said).toBe(ride.id);
      expect(read?.rideFacts, said).toStrictEqual({ drafted: true });
    }
  });

  it('drops a planted log that does not read on the way OUT, never the ride', async () => {
    const open = await opened();
    for (const planted of BAD) {
      const ride = rideFor(ATHLETE_A, { rideFacts: { drafted: true, pacerModel: LOG } });
      await open.write(async (store) => store.putActivity(ride));
      await open.discard();
      await behindTheStore(open.databaseName, async (raw) => {
        const table = raw.table<Record<string, unknown>, string>(TABLE.activities);
        const row = await table.get(ride.id);
        await table.put({ ...row, rideFacts: { drafted: true, pacerModel: planted } });
      });
      const read = await open.read((store) => store.getActivity(ATHLETE_A, ride.id));
      const said = JSON.stringify(planted);
      expect(read?.id, said).toBe(ride.id);
      expect(read?.rideFacts, said).toStrictEqual({ drafted: true });
    }
  });
});
