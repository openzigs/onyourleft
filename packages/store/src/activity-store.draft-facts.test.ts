// SPDX-License-Identifier: Apache-2.0

/**
 * **A ride's draft is kept with the ride** — #2451, ADR 0066 D-5.3.
 * `RideFacts.drafted` and `RideFacts.draftSpans` through the real store on a
 * fresh connection, written by `putActivity` and read by `getActivity` (the
 * ride's page) and `listActivitySummaries` (the history).
 *
 * A list of spans that does not read is dropped whole — never the ride —
 * because a span missing from the middle would leave an effort ridden in it
 * unmarked.
 */

import Dexie from 'dexie';
import { unixSeconds } from '@onyourleft/domain';
import { afterEach, describe, expect, it } from 'vitest';

import type { DraftSpan } from './records';
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

const SPANS: readonly DraftSpan[] = [
  { from: unixSeconds(1_800_000_010), to: unixSeconds(1_800_000_040) },
  { from: unixSeconds(1_800_000_100), to: unixSeconds(1_800_000_100) },
];

/** Spans that do not read: not a list entry, a missing or non-finite instant, an end before its start. */
const BAD: readonly unknown[] = [
  null,
  'a span',
  { from: 1_800_000_010 },
  { from: 1_800_000_010, to: '1_800_000_040' },
  { from: Number.NaN, to: 1_800_000_040 },
  { from: 1_800_000_040, to: 1_800_000_010 },
];

describe('the draft kept with its ride — #2451', () => {
  it('is written by putActivity and read back on a fresh connection, by its rider only, on the page and the history', async () => {
    const open = await opened();
    const ride = rideFor(ATHLETE_A, { rideFacts: { drafted: true, draftSpans: SPANS } });
    const read = await open.roundTrip(
      async (store) => store.putActivity(ride),
      async (store) => ({
        mine: await store.getActivity(ATHLETE_A, ride.id),
        theirs: await store.getActivity(ATHLETE_B, ride.id),
        listed: await store.listActivitySummaries(ATHLETE_A),
      }),
    );
    expect(read.mine?.rideFacts).toStrictEqual({ drafted: true, draftSpans: SPANS });
    expect(read.theirs).toBeUndefined();
    expect(read.listed.find((each) => each.id === ride.id)?.rideFacts?.drafted).toBe(true);
  });

  it('leaves a list with a span that does not read out on the way IN, and keeps the ride', async () => {
    const open = await opened();
    for (const bad of BAD) {
      const ride = rideFor(ATHLETE_A, {
        rideFacts: { drafted: true, draftSpans: [SPANS[0], bad] as never },
      });
      await open.write(async (store) => store.putActivity(ride));
      const read = await open.read((store) => store.getActivity(ATHLETE_A, ride.id));
      const said = JSON.stringify(bad);
      expect(read?.id, said).toBe(ride.id);
      expect(read?.rideFacts, said).toStrictEqual({ drafted: true });
    }
  });

  it('drops a planted list that does not read on the way OUT, never the ride', async () => {
    const open = await opened();
    for (const planted of [...BAD.map((bad) => [SPANS[0], bad]), 'two', 5, { 0: SPANS[0] }]) {
      const ride = rideFor(ATHLETE_A, { rideFacts: { drafted: true, draftSpans: SPANS } });
      await open.write(async (store) => store.putActivity(ride));
      await open.discard();
      await behindTheStore(open.databaseName, async (raw) => {
        const table = raw.table<Record<string, unknown>, string>(TABLE.activities);
        const row = await table.get(ride.id);
        await table.put({ ...row, rideFacts: { drafted: true, draftSpans: planted } });
      });
      const read = await open.read((store) => store.getActivity(ATHLETE_A, ride.id));
      const said = JSON.stringify(planted);
      expect(read?.id, said).toBe(ride.id);
      expect(read?.rideFacts, said).toStrictEqual({ drafted: true });
    }
  });

  it('keeps only a span’s own two instants', async () => {
    const open = await opened();
    const ride = rideFor(ATHLETE_A, {
      rideFacts: { draftSpans: [{ ...SPANS[0], planted: 'x' } as never] },
    });
    await open.write(async (store) => store.putActivity(ride));
    const read = await open.read((store) => store.getActivity(ATHLETE_A, ride.id));
    expect(read?.rideFacts?.draftSpans).toStrictEqual([SPANS[0]]);
  });
});
