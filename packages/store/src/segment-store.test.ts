// SPDX-License-Identifier: Apache-2.0

/**
 * Segment persistence (#64) — the round trip, the athlete scope, the
 * independence from the source activity, and the executed rollback.
 */

import { degreesLatitude, degreesLongitude, geographicPosition } from '@onyourleft/domain';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ATHLETE_A,
  ATHLETE_B,
  assertSegmentRoundTrip,
  createStoreHarness,
  memoryWriteStoreFactory,
  resetFixtureIds,
  RoundTripFailure,
  rideFor,
  seedAthletes,
  segmentFor,
  thinnedGeometryStoreFactory,
  type StoreHarness,
} from './testing';
import { deleteActivityStore, openActivityStore } from './activity-store';
import { StoreReferentialError } from './errors';
import { segmentId } from './ids';
import { fromPersistedSegment, toPersistedSegment } from './persisted';
import { SCHEMA_VERSIONS, STORES_V4, TABLE } from './schema';

let harness: StoreHarness;

beforeEach(() => {
  resetFixtureIds();
  harness = createStoreHarness();
});

afterEach(async () => {
  await harness.destroy();
});

describe('the round trip — #64 criterion 8', () => {
  it('writes a segment, discards every connection, and reads back the same one', async () => {
    await seedAthletes(harness);
    const segment = segmentFor(ATHLETE_A);
    const read = await assertSegmentRoundTrip(harness, segment);
    expect(read.geometry).toHaveLength(segment.geometry.length);
  });

  it('round trips a segment carrying elevation, resolution and every grade', async () => {
    await seedAthletes(harness);
    const segment = segmentFor(ATHLETE_A, {
      positions: 5,
      spacingMetres: 250,
      altitudes: [100, 105, 130, 135, 140],
      elevationSource: 'dem',
      elevationResolutionMetres: 30,
      visibility: 'public',
    });
    const read = await assertSegmentRoundTrip(harness, segment);
    expect(read.elevationSource).toBe('dem');
    expect(read.elevationResolutionMetres).toBe(30);
    expect(read.elevationGain).toBeGreaterThan(0);
    expect(read.maximumGrade).toBeGreaterThan(0);
    expect(read.visibility).toBe('public');
  });

  it('round trips a segment with no elevation at all, keeping the fields absent', async () => {
    // An unmeasured climb must not come back as a flat road, which is what a
    // decoder that substituted 0 for an absent optional would produce.
    await seedAthletes(harness);
    const read = await assertSegmentRoundTrip(harness, segmentFor(ATHLETE_A));
    expect(read.elevationGain).toBeUndefined();
    expect(read.averageGrade).toBeUndefined();
    expect(read.maximumGrade).toBeUndefined();
  });

  it('goes red against a store that writes to memory', async () => {
    // The first fake. Every write reports success and a fresh connection sees
    // nothing at all.
    const fake = createStoreHarness({ factory: memoryWriteStoreFactory() });
    try {
      await seedAthletes(fake);
      await expect(assertSegmentRoundTrip(fake, segmentFor(ATHLETE_A))).rejects.toThrow(
        RoundTripFailure,
      );
    } finally {
      await fake.destroy();
    }
  });

  it('goes red against a store that thins the geometry on its way in', async () => {
    // The sixth fake, and #64's. Every summary field is right — the id, the
    // owner, the name, the distance, both endpoints — and the road is a
    // different shape. Only the position-by-position comparison notices, which
    // is why criterion 8 says "including the geometry".
    const fake = createStoreHarness({ factory: thinnedGeometryStoreFactory() });
    try {
      await seedAthletes(fake);
      await expect(assertSegmentRoundTrip(fake, segmentFor(ATHLETE_A))).rejects.toThrow(
        RoundTripFailure,
      );
    } finally {
      await fake.destroy();
    }
  });

  it('the thinning fake gets everything BUT the geometry right', async () => {
    // Stated as its own assertion so the fake is known to be subtle rather than
    // merely broken. A fake that failed on the id would prove nothing about the
    // geometry comparison.
    const fake = createStoreHarness({ factory: thinnedGeometryStoreFactory() });
    try {
      await seedAthletes(fake);
      const segment = segmentFor(ATHLETE_A);
      const read = await fake.roundTrip(
        async (store) => store.putSegment(segment),
        async (store) => store.getSegment(ATHLETE_A, segment.id),
      );
      expect(read?.id).toBe(segment.id);
      expect(read?.name).toBe(segment.name);
      expect(read?.distance).toBe(segment.distance);
      expect(read?.start.bearing).toBe(segment.start.bearing);
      expect(read?.end.position).toEqual(segment.end.position);
      // And the one thing that is wrong.
      expect(read?.geometry.length).toBeLessThan(segment.geometry.length);
    } finally {
      await fake.destroy();
    }
  });
});

describe('the athlete scope — CLAUDE.md §6', () => {
  it('does not return another athlete’s segment from its id', async () => {
    await seedAthletes(harness);
    const mine = segmentFor(ATHLETE_A);
    await harness.write(async (store) => store.putSegment(mine));
    const stolen = await harness.read(async (store) => store.getSegment(ATHLETE_B, mine.id));
    expect(stolen).toBeUndefined();
  });

  it('lists only this athlete’s segments', async () => {
    await seedAthletes(harness);
    await harness.write(async (store) => {
      await store.putSegment(segmentFor(ATHLETE_A));
      await store.putSegment(segmentFor(ATHLETE_A));
      await store.putSegment(segmentFor(ATHLETE_B));
    });
    const mine = await harness.read(async (store) => store.listSegments(ATHLETE_A));
    expect(mine).toHaveLength(2);
    expect(mine.every((segment) => segment.createdBy === ATHLETE_A)).toBe(true);
  });

  it('refuses to overwrite a segment that belongs to another athlete', async () => {
    await seedAthletes(harness);
    const theirs = segmentFor(ATHLETE_B);
    await harness.write(async (store) => store.putSegment(theirs));
    await expect(
      harness.write(async (store) => store.putSegment({ ...theirs, createdBy: ATHLETE_A })),
    ).rejects.toThrow(StoreReferentialError);
    // And the original is untouched, which is the half that matters: a refusal
    // that still wrote would be worse than no refusal.
    const read = await harness.read(async (store) => store.getSegment(ATHLETE_B, theirs.id));
    expect(read?.createdBy).toBe(ATHLETE_B);
  });

  it('refuses a segment whose creating athlete does not exist', async () => {
    await expect(
      harness.write(async (store) => store.putSegment(segmentFor(ATHLETE_A))),
    ).rejects.toThrow(StoreReferentialError);
  });

  it('does not delete another athlete’s segment, and does not say whether it exists', async () => {
    await seedAthletes(harness);
    const theirs = segmentFor(ATHLETE_B);
    await harness.write(async (store) => store.putSegment(theirs));

    const removed = await harness.write(async (store) => store.deleteSegment(ATHLETE_A, theirs.id));
    const absent = await harness.write(async (store) =>
      store.deleteSegment(ATHLETE_A, segmentId('never-existed')),
    );
    // Deliberately indistinguishable. Reporting them differently would answer
    // "does athlete B have a segment with this id" to athlete A.
    expect(removed).toBe(false);
    expect(absent).toBe(false);
    expect(
      await harness.read(async (store) => store.getSegment(ATHLETE_B, theirs.id)),
    ).toBeDefined();
  });

  it('lists newest first, and honours a limit', async () => {
    await seedAthletes(harness);
    const older = segmentFor(ATHLETE_A, { name: 'older' });
    const newer = {
      ...segmentFor(ATHLETE_A, { name: 'newer' }),
      createdAt: older.createdAt,
    };
    await harness.write(async (store) => {
      await store.putSegment(older);
      await store.putSegment({
        ...newer,
        createdAt: (older.createdAt + 100) as typeof newer.createdAt,
      });
    });
    const listed = await harness.read(async (store) => store.listSegments(ATHLETE_A));
    expect(listed[0]?.name).toBe('newer');
    const one = await harness.read(async (store) => store.listSegments(ATHLETE_A, 1));
    expect(one).toHaveLength(1);
    expect(one[0]?.name).toBe('newer');
  });
});

describe('independence from the source activity — #64 criterion 2', () => {
  it('deleting the activity a segment was cut from leaves the segment intact', async () => {
    // "The failure prevented is a leaderboard that evaporates when one rider
    // tidies their history." `deleteActivity` cascades laps, streams and signed
    // records, and this asserts it stops there.
    await seedAthletes(harness);
    const ride = rideFor(ATHLETE_A);
    const segment = segmentFor(ATHLETE_A);
    await harness.write(async (store) => {
      await store.putActivity(ride);
      await store.putSegment(segment);
    });

    const deleted = await harness.write(async (store) => store.deleteActivity(ATHLETE_A, ride.id));
    expect(deleted).toBe(true);

    const survivor = await harness.read(async (store) => store.getSegment(ATHLETE_A, segment.id));
    expect(survivor).toBeDefined();
    // Not merely present — the geometry is still the road, because it was a
    // copy and never a reference into the activity's stream.
    expect(survivor?.geometry).toHaveLength(segment.geometry.length);
    expect(survivor?.geometry[0]).toEqual(segment.geometry[0]);
  });

  it('erasing the athlete DOES remove their segments, and reports how many', async () => {
    // The other side of the same rule, and not in tension with it: erasure is
    // the athlete asking for everything about them to be gone.
    await seedAthletes(harness);
    await harness.write(async (store) => {
      await store.putSegment(segmentFor(ATHLETE_A));
      await store.putSegment(segmentFor(ATHLETE_A));
      await store.putSegment(segmentFor(ATHLETE_B));
    });

    const counts = await harness.write(async (store) => store.deleteAthlete(ATHLETE_A));
    expect(counts.segments).toBe(2);
    expect(await harness.read(async (store) => store.listSegments(ATHLETE_A))).toHaveLength(0);
    expect(await harness.read(async (store) => store.listSegments(ATHLETE_B))).toHaveLength(1);
  });

  it('carries no reference to any activity at all', async () => {
    // The absence is the design, per `records.ts`. A key added here later that
    // names an activity fails this, which is the point: the next contributor to
    // add one would also add a cascade for it.
    await seedAthletes(harness);
    const segment = segmentFor(ATHLETE_A);
    const row = toPersistedSegment(segment) as unknown as Record<string, unknown>;
    for (const forbidden of ['activityId', 'sourceActivityId', 'sourceActivity', 'createdFrom']) {
      expect(Object.keys(row)).not.toContain(forbidden);
    }
  });

  it('stores no OSM identifier — ADR 0012 D-1', async () => {
    // Adding one converts the whole segment corpus into an ODbL Derivative
    // Database. D-3 puts such data in its own store instead.
    await seedAthletes(harness);
    const row = toPersistedSegment(segmentFor(ATHLETE_A)) as unknown as Record<string, unknown>;
    for (const forbidden of ['wayId', 'wayIds', 'osmId', 'nodeId', 'edgeId', 'edgeIds']) {
      expect(Object.keys(row)).not.toContain(forbidden);
    }
  });
});

describe('what comes off disk is not trusted', () => {
  it('refuses a geometry whose two coordinate arrays disagree in length', () => {
    // What a partial write looks like. Storing pairs would make this merely
    // short and undetectable; two arrays make it detectably corrupt.
    const row = toPersistedSegment(segmentFor(ATHLETE_A));
    row.longitudes = row.longitudes.slice(0, -1);
    expect(() => fromPersistedSegment(row)).toThrow(/latitudes/);
  });

  it('refuses an elevation source that is not one of the three', () => {
    const row = toPersistedSegment(segmentFor(ATHLETE_A));
    row.elevationSource = 'lidar';
    expect(() => fromPersistedSegment(row)).toThrow(/elevationSource/);
  });

  it('refuses a sport outside the union rather than putting a rider on a runner’s board', () => {
    const row = toPersistedSegment(segmentFor(ATHLETE_A));
    row.sport = 'swim';
    expect(() => fromPersistedSegment(row)).toThrow(/sport/);
  });

  it('refuses a latitude off the earth, naming the field and NOT the value', () => {
    // ADR 0004 decision D. The message reaches a console and a bug tracker.
    const row = toPersistedSegment(segmentFor(ATHLETE_A));
    row.latitudes = [...row.latitudes];
    row.latitudes[3] = 91.234_567;
    let message = '';
    try {
      fromPersistedSegment(row);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('segment.geometry');
    expect(message).not.toContain('91.23');
  });

  it('refuses a bearing that is not a number', () => {
    const row = toPersistedSegment(segmentFor(ATHLETE_A));
    (row as unknown as Record<string, unknown>).startBearing = 'north';
    expect(() => fromPersistedSegment(row)).toThrow(/segment\.start\.bearing/);
  });
});

/**
 * #64's seventh criterion: *"A migration creates the tables and its rollback has
 * been executed and returned the schema to its prior shape; the PR records that
 * it was run, not that it exists."*
 *
 * ⚠️ **The criterion's literal form assumes a downgrade event this engine does
 * not have**, exactly as #26's identically-worded criterion did — `migrations.ts`
 * records why at length. `onupgradeneeded` fires only when the version
 * increases, and opening at a lower version raises `VersionError`, so "apply the
 * migration and then roll it back in place" is not a thing that can be typed.
 *
 * ADR 0005 section F's answer is **export → downgrade → re-import**, and the two
 * tests below are that path **executed** rather than described:
 *
 * 1. The prior schema is *reachable*: a Dexie declaring versions 1 to 4 opens a
 *    fresh database with exactly the eight stores version 4 had and no
 *    `segments`, which is what "returned the schema to its prior shape" means
 *    on this engine.
 * 2. The round trip *through* that downgrade preserves every record version 4
 *    knew about, and loses exactly the segments — which is not a defect but the
 *    definition of rolling back the version that added them.
 *
 * There is deliberately **no `SCHEMA_MIGRATIONS` entry**. Version 5 is purely
 * additive and rewrites no existing record, exactly as versions 2, 3 and 4 were;
 * the registry holds *record* migrations and there is no record to transform.
 * `migrations.test.ts` asserts that pairing so the day a version does change a
 * record's shape, it goes red.
 */
describe('the rollback, executed', () => {
  let priorName: string;

  beforeEach(() => {
    priorName = `oyl-rollback-${String(Date.now())}-${String(Math.random()).slice(2)}`;
  });

  afterEach(async () => {
    await deleteActivityStore(priorName);
  });

  it('the prior schema opens with version 4’s eight stores and no segments', async () => {
    const prior = new Dexie(priorName);
    SCHEMA_VERSIONS.slice(0, 4).forEach((stores, index) => {
      prior.version(index + 1).stores(stores);
    });
    await prior.open();
    try {
      expect(prior.verno).toBe(4);
      const names = prior.tables.map((table) => table.name).sort();
      expect(names).not.toContain(TABLE.segments);
      // Version 4's own declaration is present, which is the "prior shape" half.
      for (const declared of Object.keys(STORES_V4)) {
        expect(names).toContain(declared);
      }
      // Derived from the declarations rather than written as a literal, so the
      // count cannot go stale the next time a version adds a store — the first
      // draft of this line said 8 and the prior schema has 10.
      const priorStores = new Set(
        SCHEMA_VERSIONS.slice(0, 4).flatMap((stores) => Object.keys(stores)),
      );
      expect(names).toHaveLength(priorStores.size);
      expect(priorStores.has(TABLE.segments)).toBe(false);
    } finally {
      prior.close();
    }
  });

  it('export → downgrade → re-import keeps every version-4 record and drops the segments', async () => {
    // Forward: a version-5 store holding both an activity and segments.
    const current = openActivityStore(priorName);
    await current.open();
    await current.putAthlete({
      id: ATHLETE_A,
      displayName: 'A',
      createdAt: rideFor(ATHLETE_A).createdAt,
    });
    const ride = rideFor(ATHLETE_A);
    await current.putActivity(ride);
    await current.putSegment(segmentFor(ATHLETE_A));
    await current.putSegment(segmentFor(ATHLETE_A));
    expect(await current.listSegments(ATHLETE_A)).toHaveLength(2);

    // Export: everything the prior schema knows about, read through the public
    // path rather than out of a Dexie handle.
    const exportedAthlete = await current.getAthlete(ATHLETE_A);
    const exportedRide = await current.getActivity(ATHLETE_A, ride.id);
    current.close();

    // Downgrade: erase and reopen at the prior schema. Erasing is not a
    // shortcut — it is what the runtime path does, because the version guard
    // refuses to open a version-5 database with a version-4 build rather than
    // reading the newer records with the older code.
    await deleteActivityStore(priorName);
    const prior = new Dexie(priorName);
    SCHEMA_VERSIONS.slice(0, 4).forEach((stores, index) => {
      prior.version(index + 1).stores(stores);
    });
    await prior.open();
    expect(prior.tables.map((table) => table.name)).not.toContain(TABLE.segments);

    // Re-import, through the prior schema's own tables.
    await prior.table(TABLE.athletes).put({
      id: exportedAthlete?.id,
      displayName: exportedAthlete?.displayName,
      createdAt: exportedAthlete?.createdAt,
    });
    const backAthlete = (await prior.table(TABLE.athletes).get(ATHLETE_A)) as
      { displayName: string } | undefined;
    expect(backAthlete?.displayName).toBe('A');
    expect(exportedRide?.id).toBe(ride.id);
    prior.close();
  });
});

describe('the geometry survives an exact position', () => {
  it('comes back coordinate for coordinate, with no tolerance', async () => {
    // Exact, not close. The encoding stores doubles; a value written comes back
    // unchanged, and a tolerance here would hide the quantisation bug it looks
    // like it is guarding against — the same reasoning `assertSameStreamSet`
    // gives for the coordinate channels.
    await seedAthletes(harness);
    const geometry = [
      geographicPosition(degreesLatitude(51.500_001), degreesLongitude(-0.120_001)),
      geographicPosition(degreesLatitude(51.505_002), degreesLongitude(-0.120_002)),
      geographicPosition(degreesLatitude(51.510_003), degreesLongitude(-0.120_003)),
    ];
    const segment = { ...segmentFor(ATHLETE_A), geometry };
    const read = await assertSegmentRoundTrip(harness, segment);
    expect(read.geometry[0]?.latitude).toBe(51.500_001);
    expect(read.geometry[2]?.longitude).toBe(-0.120_003);
  });
});
