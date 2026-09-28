// SPDX-License-Identifier: Apache-2.0

/**
 * **A ride's model write-up and the side camera's pose summary, written, read
 * back through a connection nothing wrote on, replaced, refused when they are
 * not what they claim, and erased** — #800, schema version 13.
 *
 * ⚠️ **The two pairs at the bottom are the point of this file.**
 * `testing/fakes.ts` §`firstWriteUpStoreFactory` answers a second write-up
 * with success and keeps the first, and §`poselessReportStoreFactory` keeps a
 * report's sentences and drops its pose summary to `null` — a real state. A
 * test that asked only whether something came back cannot tell either from
 * the real store.
 */

import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StoreDecodeError, StoreReferentialError, StoreValidationError } from './errors';
import {
  fromPersistedRideWriteUp,
  fromPersistedSideCameraReport,
  MAXIMUM_WRITE_UP_CHARACTERS,
  MAXIMUM_WRITE_UP_SECTIONS,
  MAXIMUM_WRITE_UP_TEMPLATE_FIELD,
  toPersistedRideWriteUp,
  toPersistedSideCameraReport,
} from './persisted';
import type { RideWriteUpRecord, SideCameraReportRecord } from './records';
import { SCHEMA_VERSIONS, TABLE } from './schema';
import {
  assertRideWriteUpRoundTrip,
  assertSideCameraReportRoundTrip,
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  firstWriteUpStoreFactory,
  poselessReportStoreFactory,
  resetFixtureIds,
  rideWriteUpFor,
  RoundTripFailure,
  seedAthletes,
  seedRide,
  sideCameraReportFor,
} from './testing';
import type { StoreHarness } from './testing';

let harness: StoreHarness;

beforeEach(async () => {
  resetFixtureIds();
  harness = createStoreHarness();
  await seedAthletes(harness);
});

afterEach(async () => {
  await harness.destroy();
});

/** Every write-up row on disk, read through a connection that is not the store's. */
async function writeUpRows(): Promise<unknown[]> {
  await harness.discard();
  const raw = new Dexie(harness.databaseName);
  SCHEMA_VERSIONS.forEach((stores, index) => {
    raw.version(index + 1).stores(stores);
  });
  try {
    return (await raw.table(TABLE.rideWriteUps).toArray()) as unknown[];
  } finally {
    raw.close();
  }
}

describe('keeping a ride’s write-up', () => {
  it('survives a round trip through the read the detail screen uses, every field', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    const writeUp = rideWriteUpFor(ATHLETE_A, ride.id);
    const read = await assertRideWriteUpRoundTrip(harness, writeUp);
    expect(read).toStrictEqual(writeUp);
  });

  it('is not there for a ride nobody asked a model about', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    await expect(
      harness.read(async (store) => store.getRideWriteUp(ATHLETE_A, ride.id)),
    ).resolves.toBeUndefined();
  });

  it('replaces the write-up a ride already had — one row, holding the second', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    await harness.write(async (store) =>
      store.putRideWriteUp(rideWriteUpFor(ATHLETE_A, ride.id, 1)),
    );
    const second = rideWriteUpFor(ATHLETE_A, ride.id, 2);
    await assertRideWriteUpRoundTrip(harness, second);
    // Counted on disk, on a connection nothing wrote on: "replace" is one row,
    // not a second row the read happens to prefer.
    const rows = await writeUpRows();
    expect(rows).toStrictEqual([toPersistedRideWriteUp(second)]);
  });

  it('writes the record’s fields and nothing else — no model, address, key or reply', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    const carrying = {
      ...rideWriteUpFor(ATHLETE_A, ride.id),
      model: 'some-model',
      address: 'http://192.168.1.20:8080',
      key: 'sk-secret',
      reply: '{"choices":[]}',
    } as RideWriteUpRecord;
    await harness.write(async (store) => store.putRideWriteUp(carrying));
    const rows = (await writeUpRows()) as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0] ?? {}).sort()).toStrictEqual([
      'activityId',
      'athleteId',
      'includedPose',
      'missingSections',
      'source',
      'templateId',
      'templateVersion',
      'text',
      'writtenAt',
    ]);
  });

  it('goes with its ride when the ride is deleted, and only with its own', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    const other = await seedRide(harness, ATHLETE_A);
    await harness.write(async (store) => {
      await store.putRideWriteUp(rideWriteUpFor(ATHLETE_A, ride.id));
      await store.putRideWriteUp(rideWriteUpFor(ATHLETE_A, other.id));
    });
    await harness.write(async (store) => store.deleteActivity(ATHLETE_A, ride.id));
    await expect(
      harness.read(async (store) => store.getRideWriteUp(ATHLETE_A, ride.id)),
    ).resolves.toBeUndefined();
    await expect(
      harness.read(async (store) => store.getRideWriteUp(ATHLETE_A, other.id)),
    ).resolves.toBeDefined();
  });

  it('goes with the athlete when the device is erased — neither record is left — and is counted', async () => {
    const mine = await seedRide(harness, ATHLETE_A);
    const theirs = await seedRide(harness, ATHLETE_B);
    await harness.write(async (store) => {
      await store.putSideCameraReport(sideCameraReportFor(ATHLETE_A, mine.id));
      await store.putRideWriteUp(rideWriteUpFor(ATHLETE_A, mine.id));
      await store.putSideCameraReport(sideCameraReportFor(ATHLETE_B, theirs.id));
      await store.putRideWriteUp(rideWriteUpFor(ATHLETE_B, theirs.id));
    });
    const counts = await harness.write(async (store) => store.deleteAthlete(ATHLETE_A));
    expect(counts.rideWriteUps).toBe(1);
    expect(counts.sideCameraReports).toBe(1);
    await harness.read(async (store) => {
      await expect(store.getRideWriteUp(ATHLETE_A, mine.id)).resolves.toBeUndefined();
      await expect(store.getSideCameraReport(ATHLETE_A, mine.id)).resolves.toBeUndefined();
      await expect(store.getRideWriteUp(ATHLETE_B, theirs.id)).resolves.toBeDefined();
      await expect(store.getSideCameraReport(ATHLETE_B, theirs.id)).resolves.toBeDefined();
    });
  });

  it('refuses a write-up on a ride that does not exist', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    await harness.write(async (store) => store.deleteActivity(ATHLETE_A, ride.id));
    await expect(
      harness.write(async (store) => store.putRideWriteUp(rideWriteUpFor(ATHLETE_A, ride.id))),
    ).rejects.toThrow(StoreReferentialError);
  });

  it('refuses a write-up filed under one athlete against another athlete’s ride', async () => {
    const theirs = await seedRide(harness, ATHLETE_B);
    await expect(
      harness.write(async (store) => store.putRideWriteUp(rideWriteUpFor(ATHLETE_A, theirs.id))),
    ).rejects.toThrow(StoreReferentialError);
    await expect(writeUpRows()).resolves.toStrictEqual([]);
  });
});

describe('what a write-up has to be', () => {
  const base = rideWriteUpFor(ATHLETE_A, 'activity-x' as never);

  const refused: readonly (readonly [string, RideWriteUpRecord])[] = [
    ['no text', { ...base, text: '  \n ' }],
    ['text over the length bound', { ...base, text: 'x'.repeat(MAXIMUM_WRITE_UP_CHARACTERS + 1) }],
    ['a NUL in the text', { ...base, text: 'How it went.\u0000' }],
    ['a tab in the text', { ...base, text: 'How\tit went.' }],
    ['a carriage return in the text', { ...base, text: 'How it went.\r\nThen.' }],
    ['an escape sequence in the text', { ...base, text: 'How \u001b[31mit\u001b[0m went.' }],
    ['a C1 control in the text', { ...base, text: 'How it went.\u0085' }],
    ['DEL in the text', { ...base, text: 'How it went.\u007f' }],
    ['a template id with markup in it', { ...base, templateId: '<b>ride</b>' }],
    ['an empty template version', { ...base, templateVersion: '' }],
    [
      'a template id over its bound',
      { ...base, templateId: 'a'.repeat(MAXIMUM_WRITE_UP_TEMPLATE_FIELD + 1) },
    ],
    ['a source nobody offers', { ...base, source: 'vendor' as never }],
    ['includedPose that is not a boolean', { ...base, includedPose: 'yes' as never }],
    ['missing sections that are not a list', { ...base, missingSections: 3 as never }],
    ['a negative missing section', { ...base, missingSections: [-1] }],
    ['a fractional missing section', { ...base, missingSections: [1.5] }],
    [
      'a missing section past the template',
      { ...base, missingSections: [MAXIMUM_WRITE_UP_SECTIONS] },
    ],
    ['missing sections out of order', { ...base, missingSections: [3, 1] }],
    ['a missing section twice', { ...base, missingSections: [2, 2] }],
    [
      'more missing sections than a template has',
      {
        ...base,
        missingSections: Array.from({ length: MAXIMUM_WRITE_UP_SECTIONS + 1 }, (_, index) => index),
      },
    ],
  ];

  it.each(refused)('refuses %s on the way in', async (_what, writeUp) => {
    const ride = await seedRide(harness, ATHLETE_A);
    await expect(
      harness.write(async (store) => store.putRideWriteUp({ ...writeUp, activityId: ride.id })),
    ).rejects.toThrow(StoreValidationError);
  });

  it.each(refused)('refuses a hand-edited row with %s on the way out', (_what, writeUp) => {
    // A hand-edited row is a row: the same rule as the way in.
    const row = { ...toPersistedRideWriteUp(base), ...writeUp } as never;
    expect(() => fromPersistedRideWriteUp(row)).toThrow(StoreDecodeError);
  });

  it('keeps text exactly at the bound, and newlines, and every section of a template', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    const longest = {
      ...base,
      activityId: ride.id,
      text: `${'x'.repeat(MAXIMUM_WRITE_UP_CHARACTERS - 2)}\n\n`,
      missingSections: Array.from({ length: MAXIMUM_WRITE_UP_SECTIONS }, (_, index) => index),
    };
    await expect(assertRideWriteUpRoundTrip(harness, longest)).resolves.toStrictEqual(longest);
  });

  it('keeps markup and a URL as the literal characters — refusing them is the screen’s job, not the store’s', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    const literal = {
      ...base,
      activityId: ride.id,
      text: '**bold** <script>x</script> javascript:alert(1) https://example.org',
    };
    const read = await assertRideWriteUpRoundTrip(harness, literal);
    expect(read.text).toBe(literal.text);
  });

  it('refuses a stored writtenAt that is not a time', () => {
    const row = { ...toPersistedRideWriteUp(base), writtenAt: Number.NaN };
    expect(() => fromPersistedRideWriteUp(row)).toThrow(StoreDecodeError);
  });

  it('never puts the text in the message', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    const secret = `Your knee dropped\u0000${'z'.repeat(20)}`;
    await expect(
      harness.write(async (store) =>
        store.putRideWriteUp({ ...base, activityId: ride.id, text: secret }),
      ),
    ).rejects.toThrow(/^(?!.*Your knee).*$/s);
  });
});

describe('the side camera’s pose summary, kept with the report', () => {
  it('survives a round trip, and a kind that was not compared comes back absent, not zero', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    const report = sideCameraReportFor(ATHLETE_A, ride.id);
    const read = await assertSideCameraReportRoundTrip(harness, report);
    expect(read.pose).toStrictEqual(report.pose);
    expect(Object.keys(read.pose?.differences ?? {})).not.toContain('elbow');
  });

  it('keeps "no summary kept" as null', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    const report = { ...sideCameraReportFor(ATHLETE_A, ride.id), pose: null };
    const read = await assertSideCameraReportRoundTrip(harness, report);
    expect(read.pose).toBeNull();
  });

  it('keeps an empty set of differences — posed, and nothing compared', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    const plain = sideCameraReportFor(ATHLETE_A, ride.id);
    const report: SideCameraReportRecord = {
      ...plain,
      pose: { differences: {}, posed: 0, noRider: 0, unreadable: 0, source: 'computer' },
    };
    await expect(assertSideCameraReportRoundTrip(harness, report)).resolves.toStrictEqual(report);
  });

  const plain = sideCameraReportFor(ATHLETE_A, 'activity-x' as never);
  const pose = plain.pose!;
  const refused: readonly (readonly [string, unknown])[] = [
    ['a pose that is not a summary', 'lots'],
    ['a pose that is a list', []],
    ['differences that are not a record', { ...pose, differences: null }],
    ['an infinite difference', { ...pose, differences: { torso: Number.POSITIVE_INFINITY } }],
    ['a NaN difference', { ...pose, differences: { knee: Number.NaN } }],
    ['a difference that is a string', { ...pose, differences: { knee: '3' } }],
    ['a frontal-plane kind', { ...pose, differences: { hipDrop: 1 } }],
    ['a negative count', { ...pose, posed: -1 }],
    ['a fractional count', { ...pose, noRider: 0.5 }],
    ['a count that is not a number', { ...pose, unreadable: '2' }],
    ['a source nobody offers', { ...pose, source: 'cloud' }],
  ];

  it.each(refused)('refuses %s on the way in', async (_what, bad) => {
    const ride = await seedRide(harness, ATHLETE_A);
    await expect(
      harness.write(async (store) =>
        store.putSideCameraReport({ ...plain, activityId: ride.id, pose: bad as never }),
      ),
    ).rejects.toThrow(StoreValidationError);
  });

  it.each(refused)('refuses a hand-edited row with %s on the way out', (_what, bad) => {
    const row = { ...toPersistedSideCameraReport(plain), pose: bad as never };
    expect(() => fromPersistedSideCameraReport(row)).toThrow(StoreDecodeError);
  });

  it('refuses a version-13 row with no pose field — nothing this package writes has none', () => {
    const row: Partial<ReturnType<typeof toPersistedSideCameraReport>> =
      toPersistedSideCameraReport(plain);
    delete row.pose;
    expect(() => fromPersistedSideCameraReport(row as never)).toThrow(StoreDecodeError);
  });

  it('never puts the number in the message', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    await expect(
      harness.write(async (store) =>
        store.putSideCameraReport({
          ...plain,
          activityId: ride.id,
          pose: { ...pose, posed: -123_456 },
        }),
      ),
    ).rejects.toThrow(/^(?!.*123).*$/s);
  });
});

describe('the harness can tell a write-up that was not replaced (#28)', () => {
  it('is green against the real store', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    await harness.write(async (store) =>
      store.putRideWriteUp(rideWriteUpFor(ATHLETE_A, ride.id, 1)),
    );
    await expect(
      assertRideWriteUpRoundTrip(harness, rideWriteUpFor(ATHLETE_A, ride.id, 2)),
    ).resolves.toBeDefined();
  });

  it('is red against a store that acknowledges the second write-up and keeps the first', async () => {
    const broken = createStoreHarness({ factory: firstWriteUpStoreFactory() });
    try {
      await seedAthletes(broken);
      const ride = await seedRide(broken, ATHLETE_A);
      await broken.write(async (store) =>
        store.putRideWriteUp(rideWriteUpFor(ATHLETE_A, ride.id, 1)),
      );
      await expect(
        assertRideWriteUpRoundTrip(broken, rideWriteUpFor(ATHLETE_A, ride.id, 2)),
      ).rejects.toThrow(RoundTripFailure);
    } finally {
      await broken.destroy();
    }
  });
});

describe('the harness can tell a report that lost its pose summary (#28)', () => {
  it('is green against the real store', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    await expect(
      assertSideCameraReportRoundTrip(harness, sideCameraReportFor(ATHLETE_A, ride.id)),
    ).resolves.toBeDefined();
  });

  it('is red against a store that writes the summary as null', async () => {
    const broken = createStoreHarness({ factory: poselessReportStoreFactory() });
    try {
      await seedAthletes(broken);
      const ride = await seedRide(broken, ATHLETE_A);
      await expect(
        assertSideCameraReportRoundTrip(broken, sideCameraReportFor(ATHLETE_A, ride.id)),
      ).rejects.toThrow(RoundTripFailure);
    } finally {
      await broken.destroy();
    }
  });
});
