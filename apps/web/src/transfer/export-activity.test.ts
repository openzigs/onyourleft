// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #51's export criteria: a file this project can read back, a file somebody
 * else can read, and the rider's **own** track in it, unobfuscated.
 *
 * Every ride here is written to the real store and read back through the
 * round-trip harness before it is exported, so what is encoded is what came off
 * disk rather than the object the fixture built.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  beatsPerMinute,
  degreesLatitude,
  degreesLatitudeToSemicircles,
  metres,
  revolutionsPerMinute,
  seconds,
  SEMICIRCLE_ROUND_TRIP_TOLERANCE_DEGREES,
  unixSeconds,
  watts,
  type DegreesLatitude,
} from '@onyourleft/domain';
import {
  decodeFitActivity,
  decodeGpx,
  decodeTcx,
  FIELD,
  GLOBAL_MESSAGE,
  readFitContainer,
  trackPointsOf,
  type FitDateTime,
} from '@onyourleft/fit';
import {
  activityId,
  privacyZoneId,
  type ActivityId,
  type NewActivity,
  type PrivacyZoneRecord,
} from '@onyourleft/store';
import {
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  lapFor,
  rideFor,
  seedAthletes,
  streamSetFor,
  type StoreHarness,
} from '@onyourleft/store/testing';
import FitParser from 'fit-file-parser';

import { lapSlots } from '../recording/laps';

import {
  ActivityExportError,
  exportActivity,
  fileStemOf,
  LOSSY_CHANNELS,
  lossyChannelName,
  lossyChannelNames,
} from './export-activity';
import type { ActivityFileFormat } from './file-format';
import { readActivityFile } from './read-activity-file';

/** Small enough to assert sample by sample, long enough to have a shape. */
const SAMPLE_COUNT = 120;

/** The unreachable branch of a `?? ` above an assertion that it is defined. */
function zeroLatitude(): DegreesLatitude {
  return degreesLatitude(0);
}

let harness: StoreHarness | undefined;

afterEach(async () => {
  await harness?.destroy();
  harness = undefined;
});

/** A ride with all eight channels, written to disk and read back. */
async function seedOutdoorRide(
  owner = ATHLETE_A,
  overrides: Partial<NewActivity> = {},
): Promise<{ open: StoreHarness; ride: NewActivity }> {
  const open = createStoreHarness();
  harness = open;
  await seedAthletes(open);
  const ride = rideFor(owner, { hasPosition: true, ...overrides });
  await open.write(async (store) => {
    await store.putActivity(ride);
    await store.putStreamSet(streamSetFor(ride, { sampleCount: SAMPLE_COUNT }));
  });
  return { open, ride };
}

/**
 * The file alone, for the assertions that are about the file.
 *
 * `exportActivity` returns the file **and** what writing it cost (#162), and
 * most of this suite is about the bytes. Unwrapping here keeps those
 * assertions saying exactly what they said before the return type changed —
 * a widened helper would have quietly changed the meaning of thirty
 * assertions in a commit that was not about them. `exportWithFaults` below is
 * for the tests that are about the other half.
 */
async function exportFrom(
  open: StoreHarness,
  id: ActivityId,
  format: ActivityFileFormat,
  owner = ATHLETE_A,
): Promise<Awaited<ReturnType<typeof exportActivity>>['file']> {
  return (await exportWithFaults(open, id, format, owner)).file;
}

async function exportWithFaults(
  open: StoreHarness,
  id: ActivityId,
  format: ActivityFileFormat,
  owner = ATHLETE_A,
): ReturnType<typeof exportActivity> {
  return open.read(async (store) =>
    exportActivity({ store, athleteId: owner, activityId: id, format }),
  );
}

function textOf(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

/** Read bytes with the third-party decoder, promisified. */
async function readWithThirdParty(bytes: Uint8Array): Promise<{
  error: string | undefined;
  records: readonly { readonly power?: number; readonly heart_rate?: number }[];
  fileIds: readonly Record<string, unknown>[];
  sessions: readonly Record<string, unknown>[];
}> {
  const parser = new FitParser({ mode: 'list', speedUnit: 'm/s', lengthUnit: 'm' });
  return new Promise((resolve) => {
    parser.parse(new Uint8Array(bytes).buffer, (error, data) => {
      resolve({
        error,
        records: data.records ?? [],
        fileIds: data.file_ids ?? [],
        sessions: data.sessions ?? [],
      });
    });
  });
}

describe('exportActivity — a file this project can read back', () => {
  it.each<ActivityFileFormat>(['fit', 'gpx', 'tcx'])(
    'writes a %s file whose samples are the stored samples',
    async (format) => {
      const { open, ride } = await seedOutdoorRide();
      const stored = await open.read(async (store) => store.getStreamSet(ATHLETE_A, ride.id));
      expect(stored).toBeDefined();

      const file = await exportFrom(open, ride.id, format);

      expect(file.fileName.endsWith(`.${format}`)).toBe(true);
      expect(file.bytes.byteLength).toBeGreaterThan(0);

      const points =
        format === 'fit'
          ? decodeFitActivity(file.bytes).activity.records
          : trackPointsOf(
              (format === 'gpx' ? decodeGpx(textOf(file.bytes)) : decodeTcx(textOf(file.bytes)))
                .activity,
            );

      expect(points).toHaveLength(SAMPLE_COUNT);
      // Values, not "it did not throw": a reader that returns an empty activity
      // has accepted a file in the least useful sense there is.
      expect(points[0]?.power).toBe(stored?.channels.power?.[0]);
      expect(points[0]?.heartRate).toBe(stored?.channels.heartRate?.[0]);
      expect(points.at(-1)?.cadence).toBe(stored?.channels.cadence?.at(-1));
    },
  );

  it('is accepted by an independent third-party FIT reader, with the same values', async () => {
    const { open, ride } = await seedOutdoorRide();
    const stored = await open.read(async (store) => store.getStreamSet(ATHLETE_A, ride.id));

    const file = await exportFrom(open, ride.id, 'fit');
    const thirdParty = await readWithThirdParty(file.bytes);

    // `fit-file-parser` 6.1.2 (MIT), a devDependency that is never shipped —
    // #31's revision block names it, and ADR 0006 R1 rules out Garmin's own
    // checker. It was written from the same public protocol documentation as
    // this project's codec and from nothing else in common.
    expect(thirdParty.error).toBeUndefined();
    expect(thirdParty.records).toHaveLength(SAMPLE_COUNT);
    expect(thirdParty.records[0]?.power).toBe(stored?.channels.power?.[0]);
    expect(thirdParty.records[0]?.heart_rate).toBe(stored?.channels.heartRate?.[0]);
    expect(thirdParty.records.at(-1)?.power).toBe(stored?.channels.power?.at(-1));

    // The file has to say what it *is*, and say it in the shape a third party
    // reads. A FIT file with records and no `file_id` decodes here and is
    // rejected by readers that check the type before anything else — a
    // difference this suite could not see until the assertion below existed.
    expect(thirdParty.fileIds[0]).toMatchObject({ type: 'activity' });
    expect(thirdParty.sessions).toHaveLength(1);
  });
});

describe('exportActivity — an indoor ride, which is half this product', () => {
  it.each<ActivityFileFormat>(['fit', 'gpx', 'tcx'])(
    'writes a %s file for a ride with no position and no temperature',
    async (format) => {
      const open = createStoreHarness();
      harness = open;
      await seedAthletes(open);
      const ride = rideFor(ATHLETE_A, { name: 'Turbo session' });
      await open.write(async (store) => {
        await store.putActivity(ride);
        await store.putStreamSet(
          streamSetFor(ride, {
            sampleCount: 40,
            // A trainer, a strap and nothing else. Every other channel is
            // **absent** rather than empty, which is the branch a fixture with
            // all eight channels never takes — and the one that would throw if
            // this exporter assumed a channel it does not have.
            channels: ['power', 'heartRate', 'cadence', 'speed'],
          }),
        );
      });

      const file = await exportFrom(open, ride.id, format);
      const points =
        format === 'fit'
          ? decodeFitActivity(file.bytes).activity.records
          : trackPointsOf(
              (format === 'gpx' ? decodeGpx(textOf(file.bytes)) : decodeTcx(textOf(file.bytes)))
                .activity,
            );

      expect(points).toHaveLength(40);
      // Absent, not zero. A reader that substituted a coordinate would put an
      // indoor ride in the Gulf of Guinea.
      expect(points[0]?.position).toBeUndefined();
      expect(points[0]?.altitude).toBeUndefined();
      expect(points[0]?.power).toBeDefined();
    },
  );

  it('writes no sample for a slot where every channel is absent', async () => {
    const open = createStoreHarness();
    harness = open;
    await seedAthletes(open);
    const ride = rideFor(ATHLETE_A, { name: 'Dropout' });
    await open.write(async (store) => {
      await store.putActivity(ride);
      await store.putStreamSet(
        streamSetFor(ride, {
          sampleCount: 30,
          channels: ['power'],
          // Ten seconds where the only channel there is has nothing.
          gaps: [{ channel: 'power', from: 10, count: 10 }],
        }),
      );
    });

    const file = await exportFrom(open, ride.id, 'fit');
    const records = decodeFitActivity(file.bytes).activity.records;

    // Twenty samples, not thirty: a slot with no reading in any channel is a
    // gap in time, and writing an empty record would be inventing a reading of
    // nothing. The gap survives as a jump in the timestamps.
    expect(records).toHaveLength(20);
    const before = records[9]?.timestamp;
    const after = records[10]?.timestamp;
    expect(before?.kind).toBe('instant');
    expect(after?.kind).toBe('instant');
    expect(
      (after?.kind === 'instant' ? after.instant : 0) -
        (before?.kind === 'instant' ? before.instant : 0),
    ).toBe(11);
  });
});

/** Thirty slots, the first and last with nothing in any channel. */
async function seedEmptyEnds(): Promise<{ open: StoreHarness; ride: NewActivity }> {
  const open = createStoreHarness();
  harness = open;
  await seedAthletes(open);
  const ride = rideFor(ATHLETE_A, { name: 'Late sensor', elapsedTime: seconds(29) });
  await open.write(async (store) => {
    await store.putActivity(ride);
    await store.putStreamSet(
      streamSetFor(ride, {
        sampleCount: 30,
        channels: ['power'],
        gaps: [
          { channel: 'power', from: 0, count: 1 },
          { channel: 'power', from: 29, count: 1 },
        ],
      }),
    );
  });
  return { open, ride };
}

/**
 * #1323: an import starts a ride at its first timed sample and bounds its
 * elapsed time by the span of its samples, so a ride whose first or last slot
 * had no reading came back late and short. The file states both slots with a
 * bare time. Read back through `readActivityFile`, the import's own reader.
 */
describe('exportActivity — the ride’s first and last slots, where no reading is (#1323)', () => {
  it.each<ActivityFileFormat>(['fit', 'gpx', 'tcx'])(
    'comes back from %s starting when the ride did, on a grid as long as the stored one',
    async (format) => {
      const { open, ride } = await seedEmptyEnds();
      const file = await exportFrom(open, ride.id, format);
      const back = readActivityFile(file.fileName, file.bytes);

      expect(back.startedAt).toBe(ride.startedAt);
      expect(back.sampleCount).toBe(30);
      // GPX states no total, so its elapsed time is the span; FIT and TCX state
      // the ride's, which the span now admits.
      expect(back.elapsedTime).toBe(29);
      // The bare times carry no reading: the first and last slots come back
      // as empty as they were stored.
      expect(back.channels.power?.[0]).toBeUndefined();
      expect(back.channels.power?.[29]).toBeUndefined();
      expect(back.channels.power?.[1]).toBeDefined();
      expect(back.channels.power?.[28]).toBeDefined();
      expect(back.faults).toEqual([]);
    },
  );

  it('writes one bare record at each end and none between', async () => {
    const { open, ride } = await seedEmptyEnds();
    const records = decodeFitActivity((await exportFrom(open, ride.id, 'fit')).bytes).activity
      .records;

    // Twenty-eight readings and the two ends.
    expect(records).toHaveLength(30);
    const bareAt = records
      .map((record, index) => ({ record, index }))
      .filter(({ record }) => record.power === undefined)
      .map(({ record, index }) => [
        index,
        record.timestamp?.kind === 'instant' ? record.timestamp.instant - ride.startedAt : NaN,
      ]);
    expect(bareAt).toEqual([
      [0, 0],
      [29, 29],
    ]);
  });
});

describe('LOSSY_CHANNELS in plain words — #1452', () => {
  it('has a plain name for every entry of every format', () => {
    for (const format of ['fit', 'gpx', 'tcx'] as const) {
      for (const channel of LOSSY_CHANNELS[format]) {
        const name = lossyChannelName(channel);
        expect(name, `${format}: ${channel} has no plain name`).toBeDefined();
        // Not a code path in disguise: no dot, no camel case.
        expect(name).not.toMatch(/\.|[a-z][A-Z]/);
      }
    }
  });

  it('says each entry in the words the rider reads', () => {
    expect(lossyChannelNames('fit')).toEqual([]);
    expect(lossyChannelNames('tcx')).toEqual(['temperature', 'the ride’s name', 'moving time']);
    expect(lossyChannelNames('gpx')).toEqual([
      'the distance at each point',
      'each lap’s elapsed time',
      'each lap’s distance',
      'moving time',
    ]);
  });

  it('knows no name for a channel the table lacks, and reads no inherited key', () => {
    expect(lossyChannelName('point.altitude')).toBeUndefined();
    expect(lossyChannelName('toString')).toBeUndefined();
  });
});

describe('LOSSY_CHANNELS — the moving time (#1323)', () => {
  it('tells the rider GPX and TCX do not carry a moving time, and FIT does', () => {
    expect(LOSSY_CHANNELS.fit).not.toContain('activity.movingTime');
    expect(LOSSY_CHANNELS.tcx).toContain('activity.movingTime');
    expect(LOSSY_CHANNELS.gpx).toContain('activity.movingTime');
  });

  it.each<ActivityFileFormat>(['gpx', 'tcx'])(
    'is right about %s: a paused ride comes back with no pause',
    async (format) => {
      const { open, ride } = await seedEmptyEnds();
      await open.write(async (store) =>
        store.putActivity({ ...ride, id: activityId('paused'), movingTime: seconds(20) }),
      );
      await open.write(async (store) =>
        store.putStreamSet(
          streamSetFor(
            { ...ride, id: activityId('paused') },
            { sampleCount: 30, channels: ['power'] },
          ),
        ),
      );
      const file = await exportFrom(open, activityId('paused'), format);
      const back = readActivityFile(file.fileName, file.bytes);
      expect(back.movingTime).toBe(back.elapsedTime);
      expect(back.movingTime).not.toBe(20);
    },
  );
});

describe('exportActivity — the athlete’s own track, unobfuscated', () => {
  it('writes the stored coordinates even with a privacy zone over the whole ride', async () => {
    const { open, ride } = await seedOutdoorRide();
    const stored = await open.read(async (store) => store.getStreamSet(ATHLETE_A, ride.id));
    const latitudes = stored?.channels.latitude ?? [];
    const longitudes = stored?.channels.longitude ?? [];
    expect(latitudes[0]).toBeDefined();

    // A zone with a radius large enough to swallow the entire track, centred on
    // its first point. Anything that applied zones on this path would blank
    // every coordinate below.
    const zone: PrivacyZoneRecord = {
      id: privacyZoneId('home'),
      athleteId: ATHLETE_A,
      centre: { latitude: latitudes[0] ?? 0, longitude: longitudes[0] ?? 0 },
      radius: metres(50_000),
      label: 'home',
      createdAt: unixSeconds(1),
    } as PrivacyZoneRecord;
    await open.write(async (store) => store.putPrivacyZone(zone));

    const file = await exportFrom(open, ride.id, 'fit');
    const records = decodeFitActivity(file.bytes).activity.records;

    // #21: the rider's own data is not withheld from them. Coordinate for
    // coordinate, at the semicircle grid the store already keeps.
    for (const index of [0, 1, SAMPLE_COUNT - 2, SAMPLE_COUNT - 1]) {
      const expected = latitudes[index];
      const actual = records[index]?.position?.latitude;
      expect(actual).toBeDefined();
      expect(Math.abs((actual ?? 0) - (expected ?? 0))).toBeLessThanOrEqual(
        SEMICIRCLE_ROUND_TRIP_TOLERANCE_DEGREES,
      );
    }
    // And not merely "close to something": the exported track is a *moving*
    // track, not the zone centre repeated.
    const start = records[0]?.position?.latitude;
    const end = records.at(-1)?.position?.latitude;
    expect(start).toBeDefined();
    expect(end).toBeDefined();
    expect(degreesLatitudeToSemicircles(start ?? zeroLatitude())).not.toBe(
      degreesLatitudeToSemicircles(end ?? zeroLatitude()),
    );
  });

  it('writes the same coordinates into GPX', async () => {
    const { open, ride } = await seedOutdoorRide();
    const stored = await open.read(async (store) => store.getStreamSet(ATHLETE_A, ride.id));

    const file = await exportFrom(open, ride.id, 'gpx');
    const points = trackPointsOf(decodeGpx(textOf(file.bytes)).activity);

    expect(points[0]?.position?.latitude).toBeCloseTo(stored?.channels.latitude?.[0] ?? 0, 6);
    expect(points[0]?.position?.longitude).toBeCloseTo(stored?.channels.longitude?.[0] ?? 0, 6);
  });
});

describe('exportActivity — refusals', () => {
  it('refuses an activity this athlete does not own, rather than exporting it', async () => {
    const { open, ride } = await seedOutdoorRide();

    // The cross-athlete class in CLAUDE.md §6: knowing an id must not be enough.
    await expect(exportFrom(open, ride.id, 'fit', ATHLETE_B)).rejects.toBeInstanceOf(
      ActivityExportError,
    );
  });

  it('refuses an id that is not on this device', async () => {
    const { open } = await seedOutdoorRide();

    await expect(exportFrom(open, activityId('nowhere'), 'fit')).rejects.toMatchObject({
      code: 'no-such-activity',
    });
  });

  it('refuses a ride with no stored samples rather than writing an empty file', async () => {
    const open = createStoreHarness();
    harness = open;
    await seedAthletes(open);
    const ride = rideFor(ATHLETE_A);
    await open.write(async (store) => store.putActivity(ride));

    await expect(exportFrom(open, ride.id, 'fit')).rejects.toMatchObject({ code: 'no-streams' });
  });
});

describe('fileStemOf', () => {
  it('turns a ride name into a filename and not into a path', () => {
    const stem = fileStemOf({
      ...rideFor(ATHLETE_A),
      name: '../../etc/passwd',
      visibility: 'private',
    });

    expect(stem).not.toContain('/');
    expect(stem.startsWith('.')).toBe(false);
  });

  it('falls back to the id when a name has nothing usable left in it', () => {
    const ride = rideFor(ATHLETE_A);
    // A name of dots alone: every character is legal in a filename and the
    // whole of it is a path segment, so what survives the leading-dot strip is
    // nothing at all.
    const stem = fileStemOf({ ...ride, name: '...', visibility: 'private' });

    expect(stem).toBe(`activity-${ride.id}`);
  });

  it('replaces rather than drops an unsafe character, so two names stay two names', () => {
    const ride = rideFor(ATHLETE_A);

    // `a/b` and `a:b` are different rides and must not collapse onto one
    // filename, which is what stripping — rather than replacing — would do to
    // them.
    expect(fileStemOf({ ...ride, name: 'a/b', visibility: 'private' })).toBe('a-b');
    expect(fileStemOf({ ...ride, name: 'a*b?c', visibility: 'private' })).toBe('a-b-c');
  });
});

describe('exportActivity — what the file could not carry (#162)', () => {
  /**
   * A ride whose instants have no FIT representation.
   *
   * ⚠️ **Finding the reachable fault took a wrong turn worth recording.** The
   * obvious lossy case is an altitude FIT cannot hold — it is what
   * `packages/fit`'s own encoder suite uses — and it is **not reachable from
   * stored data at all**. `packages/store`'s stream codec for that channel is
   * literally named `uint16-fit-altitude` and packs through
   * `metresToFitAltitude` (ADR 0011), so an out-of-range altitude is refused
   * at `putStreamSet` with a `StoreValidationError` and never reaches an
   * export. The store stores altitude in FIT's own representation, which makes
   * `value-not-representable` structurally impossible for that channel.
   *
   * `startedAt` is not packed that way and is not range-checked, so this is the
   * fault a real ride can actually carry. It is not contrived: a device with a
   * dead clock records 1970, and so does an import of a file whose timestamps
   * are seconds since boot.
   */
  async function seedRideBeforeTheFitEpoch(): Promise<{
    open: StoreHarness;
    id: ActivityId;
  }> {
    const open = createStoreHarness();
    harness = open;
    // The FIT epoch is 1989-12-31, so no instant in this ride has one.
    const startedAt = unixSeconds(0);
    const ride = { ...rideFor(ATHLETE_A), startedAt };
    await open.write(async (store) => {
      await seedAthletes(open);
      await store.putActivity(ride);
      await store.putStreamSet(streamSetFor(ride, { sampleCount: 8, startedAt }));
    });
    return { open, id: ride.id };
  }

  it('says so when a value cannot be written, rather than saving in silence', async () => {
    const { open, id } = await seedRideBeforeTheFitEpoch();

    const { file, lost } = await exportWithFaults(open, id, 'fit');

    // The file is still produced — the encoder's contract is bytes AND faults,
    // and a rider who asked for a file gets one.
    expect(file.bytes.byteLength).toBeGreaterThan(0);
    // What changes is that the loss is reported at all. This is the assertion
    // that was impossible before the return type carried it.
    expect(lost).toEqual(['a timestamp this format cannot hold was left out']);
  });

  it('reports nothing for a clean export, so the signal is not always on', async () => {
    const { open, ride } = await seedOutdoorRide();

    const { lost } = await exportWithFaults(open, ride.id, 'fit');

    // The half that stops this becoming a caveat every rider learns to skip.
    expect(lost).toEqual([]);
  });

  it('reports one line per problem, not one per sample', async () => {
    const { open, id } = await seedRideBeforeTheFitEpoch();

    const { lost } = await exportWithFaults(open, id, 'fit');

    // Eight samples, every one of them unrepresentable, one line. A rider
    // handed eight identical lines learns to ignore the whole message.
    expect(lost).toHaveLength(1);
  });

  it('reports nothing for GPX and TCX, whose losses are the format not the ride', async () => {
    const { open, id } = await seedRideBeforeTheFitEpoch();

    // `LOSSY_CHANNELS` is what these formats always cost, and the screen shows
    // it before the export runs. Per-file faults are a FIT concept, so an
    // empty list here is correct rather than an oversight — and GPX and TCX
    // write an ISO-8601 timestamp, which 1970 fits into perfectly well.
    expect((await exportWithFaults(open, id, 'gpx')).lost).toEqual([]);
    expect((await exportWithFaults(open, id, 'tcx')).lost).toEqual([]);
  });
});

/**
 * #221's second half: the stored splits reach the file.
 *
 * The laps go in the erase and, until this, did not come out in the export — so
 * a rider who exported and then erased lost every split silently.
 * `exportActivity` read the streams and never `listLaps`, which made this a bug
 * in the single-ride export as much as in the account one, and ADR 0019 D-5
 * records that it needed no format decision to fix.
 *
 * The assertions read the **decoded file**, never the object handed to the
 * encoder, because a lap array built and never written is exactly the shape a
 * naive test cannot tell from one that was.
 */
describe('exportActivity — the ride’s own splits (#221)', () => {
  /** Three forty-second laps across a 120-sample ride, written to disk. */
  async function seedLapBearingRide(): Promise<{ open: StoreHarness; ride: NewActivity }> {
    // The three laps span the ride, to the second: a ride longer than its
    // laps has a split for the rest (#1312, the suite below).
    const { open, ride } = await seedOutdoorRide(ATHLETE_A, {
      elapsedTime: seconds(SAMPLE_COUNT),
      movingTime: seconds(114),
    });
    await open.write(async (store) => {
      for (const ordinal of [0, 1, 2]) {
        await store.putLap(
          lapFor(ride, ordinal, {
            startedAt: unixSeconds(ride.startedAt + ordinal * 40),
            elapsedTime: seconds(40),
            movingTime: seconds(38),
            distance: metres(1_000 * (ordinal + 1)),
          }),
        );
      }
    });
    return { open, ride };
  }

  it('writes every stored lap into a FIT file, with its own totals', async () => {
    const { open, ride } = await seedLapBearingRide();

    const file = await exportFrom(open, ride.id, 'fit');
    const { laps, sessions } = decodeFitActivity(file.bytes).activity;

    expect(laps).toHaveLength(3);
    expect(laps.map((lap) => lap.startTime)).toEqual([
      { kind: 'instant', instant: ride.startedAt },
      { kind: 'instant', instant: ride.startedAt + 40 },
      { kind: 'instant', instant: ride.startedAt + 80 },
    ]);
    expect(laps.map((lap) => lap.totalDistance)).toEqual([1_000, 2_000, 3_000]);
    expect(laps.map((lap) => lap.totalElapsedTime)).toEqual([40, 40, 40]);
    // The pauses, which are a different number from the wall clock and are the
    // one a rider's split time actually is.
    expect(laps.map((lap) => lap.totalTimerTime)).toEqual([38, 38, 38]);
    // The session has to agree with the laps beside it, or a strict reader
    // reads three laps and is told there is one.
    expect(sessions[0]?.numLaps).toBe(3);
  });

  it('writes every stored lap into a TCX file, which carries them natively', async () => {
    const { open, ride } = await seedLapBearingRide();

    const file = await exportFrom(open, ride.id, 'tcx');
    const { laps } = decodeTcx(textOf(file.bytes)).activity;

    expect(laps).toHaveLength(3);
    // #1312: each lap's part of the RIDE's distance, not the stored lap's own.
    // TCX has no total but the sum of its laps, and these three state 6 km of
    // a ride that states 120 km: a reader adding them up must get the ride.
    expect(laps.reduce((sum, lap) => sum + (lap.totalDistance ?? 0), 0)).toBeCloseTo(
      ride.distance,
      6,
    );
    expect(laps.map((lap) => lap.totalElapsedTime)).toEqual([40, 40, 40]);
    expect(laps.map((lap) => lap.startTime)).toEqual([
      ride.startedAt,
      ride.startedAt + 40,
      ride.startedAt + 80,
    ]);
  });

  it('splits a GPX track into one segment per lap, which is all GPX can say', async () => {
    const { open, ride } = await seedLapBearingRide();

    const file = await exportFrom(open, ride.id, 'gpx');
    const { laps } = decodeGpx(textOf(file.bytes)).activity;

    // GPX has no lap element — `GPX_LOSSY_CHANNELS` already declares that the
    // totals have nowhere to go — but the boundaries survive as `<trkseg>`s,
    // which is the difference between a rider keeping their splits and not.
    expect(laps).toHaveLength(3);
    expect(laps.map((lap) => lap.points.length)).toEqual([40, 40, 40]);
  });

  it.each<ActivityFileFormat>(['fit', 'gpx', 'tcx'])(
    'loses no sample to the lap split, in %s',
    async (format) => {
      const { open, ride } = await seedLapBearingRide();

      const file = await exportFrom(open, ride.id, format);
      const points =
        format === 'fit'
          ? decodeFitActivity(file.bytes).activity.records
          : trackPointsOf(
              (format === 'gpx' ? decodeGpx(textOf(file.bytes)) : decodeTcx(textOf(file.bytes)))
                .activity,
            );

      // The partition is a partition: every sample lands in exactly one lap.
      // A boundary comparison that dropped the sample on the edge would still
      // produce three laps and would lose three seconds of the rider's ride.
      expect(points).toHaveLength(SAMPLE_COUNT);
    },
  );

  it('carries a sample outside every lap window rather than dropping it', async () => {
    const { open, ride } = await seedOutdoorRide(ATHLETE_A, {
      elapsedTime: seconds(SAMPLE_COUNT),
    });
    // One lap covering the middle minute only. The samples before and after it
    // are still the rider's ride, and a file that omitted them would be lying.
    await open.write(async (store) => {
      await store.putLap(
        lapFor(ride, 0, {
          startedAt: unixSeconds(ride.startedAt + 30),
          elapsedTime: seconds(60),
        }),
      );
    });

    const file = await exportFrom(open, ride.id, 'tcx');
    const { laps } = decodeTcx(textOf(file.bytes)).activity;

    // #1312: in a split of their own on each side, where until then they were
    // dealt into the one lap and its totals stood in for the ride's.
    expect(laps.map((lap) => lap.points.length)).toEqual([30, 60, 30]);
    expect(laps.reduce((sum, lap) => sum + lap.points.length, 0)).toBe(SAMPLE_COUNT);
  });

  it('still writes one lap spanning the ride when nothing stored any', async () => {
    const { open, ride } = await seedOutdoorRide();

    const { laps, sessions } = decodeFitActivity(
      (await exportFrom(open, ride.id, 'fit')).bytes,
    ).activity;

    // ADR 0019 D-5: unchanged for a ride with no splits. Every reader expects a
    // FIT activity to have at least one lap, and "fixing" this into zero laps
    // would be a regression wearing a fix's clothes.
    expect(laps).toHaveLength(1);
    expect(laps[0]?.totalDistance).toBe(ride.distance);
    expect(sessions[0]?.numLaps).toBe(1);
  });

  it('does not read another athlete’s laps for a ride it is exporting', async () => {
    const { open, ride } = await seedLapBearingRide();

    // The scoped read, asserted at the export rather than at the store. The
    // store's `listLaps` takes an owner; a caller that passed the ride's own
    // `athleteId` instead of the requesting athlete's would pass every
    // single-athlete test in this file.
    await expect(exportFrom(open, ride.id, 'fit', ATHLETE_B)).rejects.toBeInstanceOf(
      ActivityExportError,
    );
  });
});

/**
 * #1316's third review, blocking: **a ride with no stored laps exports as it
 * did before #1312, to the byte, in every format.** Every ride recorded or
 * imported before this change is such a ride, and a synced ride's FIT file is
 * what its content hash is taken over.
 *
 * ⚠️ **The digests below were written by `main`'s exporter**
 * (`export-activity.ts` at `4486d2b7`, put in this branch's place for one run
 * of this case) — not by the code under test. A change to them is a change to
 * what an existing ride exports as.
 */
/**
 * #1321: what a lap row states beyond its times and distance, and which splits
 * are laps — through the real store, the real export and the real decoders, so
 * this says what each format now carries and what it still loses.
 *
 * | figure | FIT | TCX | GPX |
 * |---|---|---|---|
 * | average and highest power and heart rate, average cadence | **no**: #1471 | yes | no |
 * | climb | **no**: #1471 | **no**: no element | no |
 * | the part-lap mark | **no**: #1471 | yes, by `Manual` against `Location`, in this client's own file | no |
 * | which splits are laps | **no**: #1471 | yes, by intensity | no |
 * | the lap's own distance | yes | **no**: a lap states its share of the ride's | no |
 *
 * FIT's lap is as it was before #1321: the owner ruled on 2026-10-19 (#1458)
 * that the TCX half ships now and the FIT half waits on #1471, which has to
 * find lap field numbers ADR 0006 R2 admits.
 */
describe('exportActivity — a lap’s figures and its kind (#1321)', () => {
  /**
   * 120 s: 20 s before the first line, two whole laps of 30 s, a part lap of
   * 25 s when the rider stopped, and 15 s after it.
   */
  async function seedLappedRide(): Promise<{ open: StoreHarness; ride: NewActivity }> {
    const open = createStoreHarness();
    harness = open;
    await seedAthletes(open);
    const ride = rideFor(ATHLETE_A, {
      elapsedTime: seconds(SAMPLE_COUNT),
      movingTime: seconds(SAMPLE_COUNT),
      distance: metres(900),
    });
    const figures = (base: number) => ({
      averagePower: watts(200.4 + base),
      maxPower: watts(400 + base),
      averageHeartRate: beatsPerMinute(140.6 + base),
      maxHeartRate: beatsPerMinute(170 + base),
      averageCadence: revolutionsPerMinute(88.2 + base),
      ascent: metres(12.4 + base),
    });
    await open.write(async (store) => {
      await store.putActivity(ride);
      await store.putStreamSet(streamSetFor(ride, { sampleCount: SAMPLE_COUNT }));
      for (const [ordinal, from, length] of [
        [0, 20, 30],
        [1, 50, 30],
        [2, 80, 25],
      ] as const) {
        await store.putLap(
          lapFor(ride, ordinal, {
            startedAt: unixSeconds(ride.startedAt + from),
            elapsedTime: seconds(length),
            movingTime: seconds(length),
            distance: metres(2_000),
            ...figures(ordinal),
            ...(ordinal === 2 ? { partial: true as const } : {}),
          }),
        );
      }
    });
    return { open, ride };
  }

  it('writes FIT laps as before #1321: the lap’s own distance, and none of its figures or its kind', async () => {
    const { open, ride } = await seedLappedRide();

    const bytes = (await exportFrom(open, ride.id, 'fit')).bytes;
    const { activity, faults } = decodeFitActivity(bytes);

    expect(faults).toEqual([]);
    expect(activity.laps).toHaveLength(5);
    // The lap's own road, which TCX cannot state, still goes into FIT.
    [1, 2, 3].forEach((index) => {
      expect(activity.laps[index]?.totalDistance).toBe(2_000);
    });
    // Every lap message declares the six fields it always has, and nothing
    // else: no figure, no climb and no mark until #1471 sources their numbers.
    const lapFields = readFitContainer(bytes)
      .messages.filter((message) => message.globalMessageNumber === GLOBAL_MESSAGE.lap)
      .map((message) => message.fields.map((field) => field.number));
    expect(lapFields).toHaveLength(5);
    for (const fields of lapFields) {
      expect(fields).toEqual([
        FIELD.timestamp,
        FIELD.messageIndex,
        FIELD.lap.startTime,
        FIELD.lap.totalElapsedTime,
        FIELD.lap.totalTimerTime,
        FIELD.lap.totalDistance,
      ]);
    }
  });

  it('carries the averages and the kind in TCX, and not the climb or the lap’s own distance', async () => {
    const { open, ride } = await seedLappedRide();

    const { activity, faults } = decodeTcx(textOf((await exportFrom(open, ride.id, 'tcx')).bytes));

    expect(faults).toEqual([]);
    expect(activity.laps.map((lap) => [lap.intensity, lap.triggerMethod])).toEqual([
      ['Resting', 'Manual'],
      ['Active', 'Location'],
      ['Active', 'Location'],
      ['Active', 'Manual'],
      ['Resting', 'Manual'],
    ]);
    [0, 1, 2].forEach((base) => {
      expect(activity.laps[base + 1]).toMatchObject({
        averagePower: 200 + base,
        maxPower: 400 + base,
        averageHeartRate: 141 + base,
        maxHeartRate: 170 + base,
        averageCadence: 88 + base,
      });
    });
    // Still lost: TCX has no element for a climb, and its DistanceMeters is
    // the lap's share of the ride's 900 m, not the 2 km of road it stores.
    expect(activity.laps[1]?.totalDistance).toBeLessThan(900);
    expect(activity.laps[0]?.averagePower).toBeUndefined();
  });

  it('tells the rider, before they choose, which of a lap’s figures each format drops', () => {
    expect(LOSSY_CHANNELS.fit).toEqual(
      expect.arrayContaining([
        'lap.averageHeartRate',
        'lap.maxHeartRate',
        'lap.averageCadence',
        'lap.averagePower',
        'lap.maxPower',
        'lap.ascent',
        'lap.intensity',
        'lap.triggerMethod',
      ]),
    );
    expect(LOSSY_CHANNELS.fit).not.toContain('lap.distance');
    expect(LOSSY_CHANNELS.fit).not.toContain('activity.movingTime');
    expect(LOSSY_CHANNELS.tcx).toEqual(expect.arrayContaining(['lap.ascent', 'lap.distance']));
    expect(LOSSY_CHANNELS.tcx).not.toContain('lap.averagePower');
    expect(LOSSY_CHANNELS.gpx).toEqual(
      expect.arrayContaining(['lap.ascent', 'lap.totalDistance', 'lap.averagePower']),
    );
  });

  it('carries none of it in GPX, which has no lap', async () => {
    const { open, ride } = await seedLappedRide();

    const { activity } = decodeGpx(textOf((await exportFrom(open, ride.id, 'gpx')).bytes));

    expect(activity.laps).toHaveLength(5);
    for (const lap of activity.laps) {
      expect(lap.averagePower).toBeUndefined();
      expect(lap.intensity).toBeUndefined();
    }
  });
});

describe('exportActivity — a ride with no laps is written as it always was', () => {
  const MAIN_WROTE = {
    fit: 'd3320bcd3f438dac466cb07e586ed45087d7099e0f5de381212460dc1b1d9b6e',
    gpx: '034f2e84b0abac11f8e2497e4ca1644bed1618f9e33c0a62bf9156bf4ca49e16',
    tcx: 'c2244a4e84da6fbfdf7658f9c156fb6d0ebb9a3f64a46e294e0ca3336a9540d1',
  } as const;

  /** Totals that sit on half a tenth, where rounding first and `toFixed(1)` part company. */
  async function seedPlainRide(): Promise<{ open: StoreHarness; ride: NewActivity }> {
    const open = createStoreHarness();
    harness = open;
    await seedAthletes(open);
    const ride = rideFor(ATHLETE_A, {
      id: activityId('no-laps'),
      name: 'A ride with no laps',
      hasPosition: true,
      elapsedTime: seconds(1_234.35),
      movingTime: seconds(1_200),
      distance: metres(38_613.35),
    });
    await open.write(async (store) => {
      await store.putActivity(ride);
      await store.putStreamSet(streamSetFor(ride, { sampleCount: SAMPLE_COUNT }));
    });
    return { open, ride };
  }

  const digestOf = async (bytes: Uint8Array): Promise<string> =>
    [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>))]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');

  it.each<ActivityFileFormat>(['fit', 'gpx', 'tcx'])('the same bytes, in %s', async (format) => {
    const { open, ride } = await seedPlainRide();

    const file = await exportFrom(open, ride.id, format);

    expect(await digestOf(file.bytes)).toBe(MAIN_WROTE[format]);
  });

  it('states its TCX totals character for character as the codec writes the stored value', async () => {
    const { open, ride } = await seedPlainRide();

    const text = textOf((await exportFrom(open, ride.id, 'tcx')).bytes);

    // 1234.35 and 38613.35 are each a hair under the half as floats.
    expect(text.match(/<TotalTimeSeconds>[^<]*<\/TotalTimeSeconds>/g)).toEqual([
      '<TotalTimeSeconds>1234.3</TotalTimeSeconds>',
    ]);
    expect(
      text.match(
        /<Lap [^>]*>\s*<TotalTimeSeconds>[^<]*<\/TotalTimeSeconds>\s*<DistanceMeters>[^<]*<\/DistanceMeters>/g,
      )?.[0],
    ).toContain('<DistanceMeters>38613.3</DistanceMeters>');
  });

  it('ends its one FIT lap at the last sample, with the ride’s own totals', async () => {
    const { open, ride } = await seedPlainRide();

    const { laps, sessions } = decodeFitActivity(
      (await exportFrom(open, ride.id, 'fit')).bytes,
    ).activity;

    expect(laps).toHaveLength(1);
    expect(laps[0]?.timestamp).toEqual({
      kind: 'instant',
      instant: ride.startedAt + SAMPLE_COUNT - 1,
    });
    expect(laps[0]?.totalElapsedTime).toBe(sessions[0]?.totalElapsedTime);
    expect(laps[0]?.totalDistance).toBe(sessions[0]?.totalDistance);
  });
});

describe('exportActivity — splits that add up to the whole ride (#1312)', () => {
  /**
   * A two-minute ride with two course laps in the middle of it: 30.4 s before
   * the first line, 29.3 s after the last. ⚠️ The laps' own distance is the
   * game's road and is far more than the ride's, which is the speed channel
   * summed — the case a "the rest goes in a lap of its own" rule cannot fix,
   * because the rest would be less than nothing.
   */
  async function seedCourseRide(
    channels?: Parameters<typeof streamSetFor>[1],
  ): Promise<{ open: StoreHarness; ride: NewActivity }> {
    const open = createStoreHarness();
    harness = open;
    await seedAthletes(open);
    const ride = rideFor(ATHLETE_A, {
      elapsedTime: seconds(SAMPLE_COUNT),
      movingTime: seconds(100),
      distance: metres(1_234.5),
    });
    await open.write(async (store) => {
      await store.putActivity(ride);
      await store.putStreamSet(streamSetFor(ride, { sampleCount: SAMPLE_COUNT, ...channels }));
      await store.putLap(
        lapFor(ride, 0, {
          startedAt: unixSeconds(ride.startedAt + 30.4),
          elapsedTime: seconds(40.3),
          movingTime: seconds(36),
          distance: metres(5_000),
        }),
      );
      await store.putLap(
        lapFor(ride, 1, {
          startedAt: unixSeconds(ride.startedAt + 70.7),
          elapsedTime: seconds(20),
          movingTime: seconds(20),
          distance: metres(5_000),
        }),
      );
    });
    return { open, ride };
  }

  const total = (parts: readonly (number | undefined)[]): number =>
    Math.round(parts.reduce<number>((sum, part) => sum + (part ?? 0), 0) * 1000) / 1000;

  it('states TCX laps that add up to the ride’s own elapsed time and distance', async () => {
    const { open, ride } = await seedCourseRide();

    const { laps } = decodeTcx(textOf((await exportFrom(open, ride.id, 'tcx')).bytes)).activity;

    // The time before the first line, the two laps, the time after the last.
    // (TCX writes an instant to the whole second.)
    expect(laps.map((lap) => lap.startTime)).toEqual([
      ride.startedAt,
      ride.startedAt + 30,
      ride.startedAt + 70,
      ride.startedAt + 90,
    ]);
    expect(laps.map((lap) => lap.totalElapsedTime)).toEqual([30.4, 40.3, 20, 29.3]);
    // TCX has no other total, so a reader adds these up: the ride's own, and
    // not the 10 km of road the two course laps state between them.
    expect(total(laps.map((lap) => lap.totalElapsedTime))).toBe(ride.elapsedTime);
    expect(total(laps.map((lap) => lap.totalDistance))).toBe(ride.distance);
    for (const lap of laps) {
      expect(lap.totalDistance).toBeGreaterThan(0);
    }
    // Shared out as the speed channel was ridden, not by the clock: the first
    // split is the ride's distance times the part of the summed speed in its
    // thirty slots.
    const speed =
      (await open.read(async (store) => store.getStreamSet(ATHLETE_A, ride.id)))?.channels.speed ??
      [];
    const summedSpeed = (samples: readonly (number | undefined)[]): number =>
      samples.reduce<number>((sum, sample) => sum + (sample ?? 0), 0);
    const share = summedSpeed(speed.slice(0, 30)) / summedSpeed(speed);
    expect(share).not.toBeCloseTo(30.4 / 120, 3);
    expect(laps[0]?.totalDistance).toBeCloseTo(ride.distance * share, 1);
  });

  it('deals each sample to the split whose slots it is in, as a lap’s averages count them', async () => {
    const { open, ride } = await seedCourseRide();

    const { laps } = decodeTcx(textOf((await exportFrom(open, ride.id, 'tcx')).bytes)).activity;

    // `recording/laps.ts` §`courseLap`: from the slot a lap began in (30.4 is
    // in slot 30) up to the slot it ended in (70.7 is in slot 70).
    expect(laps.map((lap) => lap.points.length)).toEqual([30, 40, 20, 30]);
    expect(laps[1]?.points[0]?.timestamp).toBe(ride.startedAt + 30);
  });

  it('keeps each course lap’s own totals in FIT, beside a session that states the ride’s', async () => {
    const { open, ride } = await seedCourseRide();

    const { laps, sessions, records } = decodeFitActivity(
      (await exportFrom(open, ride.id, 'fit')).bytes,
    ).activity;

    expect(laps).toHaveLength(4);
    expect(sessions[0]?.numLaps).toBe(4);
    expect(records).toHaveLength(SAMPLE_COUNT);
    // The stored laps as they were stored…
    expect([laps[1]?.totalDistance, laps[2]?.totalDistance]).toEqual([5_000, 5_000]);
    expect([laps[1]?.totalTimerTime, laps[2]?.totalTimerTime]).toEqual([36, 20]);
    // …and the splits either side: the ride's time outside the laps, and the
    // 44 s it moved outside them shared by how long each lasted.
    expect(laps.map((lap) => lap.totalElapsedTime)).toEqual([30.4, 40.3, 20, 29.3]);
    expect(total(laps.map((lap) => lap.totalElapsedTime))).toBe(sessions[0]?.totalElapsedTime);
    expect(laps[0]?.totalTimerTime).toBeCloseTo((44 * 30.4) / 59.7, 2);
    expect(laps[3]?.totalTimerTime).toBeCloseTo((44 * 29.3) / 59.7, 2);
    expect(total(laps.map((lap) => lap.totalTimerTime))).toBeCloseTo(ride.movingTime, 2);
    // The session is the ride's, whatever the laps add up to.
    expect(sessions[0]?.totalElapsedTime).toBe(ride.elapsedTime);
    expect(sessions[0]?.totalTimerTime).toBe(ride.movingTime);
    expect(sessions[0]?.totalDistance).toBe(ride.distance);
  });

  it('shares the ride’s distance by time when no speed was recorded', async () => {
    const { open, ride } = await seedCourseRide({ channels: ['power', 'heartRate'] });

    const { laps } = decodeTcx(textOf((await exportFrom(open, ride.id, 'tcx')).bytes)).activity;

    expect(total(laps.map((lap) => lap.totalDistance))).toBe(ride.distance);
    // 30.4 s of 120 s is 312.7 m of 1234.5 m, to the tenth the file is written to.
    expect(laps[0]?.totalDistance).toBe(312.7);
  });

  it('adds up to the ride to the tenth TCX is written to, when no lap’s own time or share is a whole tenth', async () => {
    const open = createStoreHarness();
    harness = open;
    await seedAthletes(open);
    const ride = rideFor(ATHLETE_A, { elapsedTime: seconds(100.2), distance: metres(1_000.2) });
    await open.write(async (store) => {
      await store.putActivity(ride);
      // No speed on record, so the distance is shared by time: thirds of each.
      await store.putStreamSet(
        streamSetFor(ride, { sampleCount: SAMPLE_COUNT, channels: ['power'] }),
      );
      for (const ordinal of [0, 1]) {
        await store.putLap(
          lapFor(ride, ordinal, {
            startedAt: unixSeconds(ride.startedAt + ordinal * 33.34),
            elapsedTime: seconds(33.34),
          }),
        );
      }
    });

    const { laps } = decodeTcx(textOf((await exportFrom(open, ride.id, 'tcx')).bytes)).activity;

    // Each rounded on its own would be 33.3, 33.3 and 33.5: a tenth of a
    // second short of the ride. Each is the difference of two running totals
    // instead, so the tenths add up.
    expect(laps.map((lap) => lap.totalElapsedTime)).toEqual([33.3, 33.4, 33.5]);
    expect(total(laps.map((lap) => lap.totalElapsedTime))).toBe(100.2);
    expect(total(laps.map((lap) => lap.totalDistance))).toBe(1_000.2);
  });

  it('still adds up to the ride when a lap row states more time than the ride has, or starts before the one before it ended', async () => {
    const open = createStoreHarness();
    harness = open;
    await seedAthletes(open);
    const ride = rideFor(ATHLETE_A, { elapsedTime: seconds(SAMPLE_COUNT) });
    await open.write(async (store) => {
      await store.putActivity(ride);
      await store.putStreamSet(streamSetFor(ride, { sampleCount: SAMPLE_COUNT }));
      // Ten minutes stated of a two-minute ride; then a row that begins and
      // ends inside the first; then one that ends where the ride does.
      await store.putLap(lapFor(ride, 0, { startedAt: ride.startedAt, elapsedTime: seconds(600) }));
      await store.putLap(
        lapFor(ride, 1, { startedAt: unixSeconds(ride.startedAt + 20), elapsedTime: seconds(40) }),
      );
      await store.putLap(
        lapFor(ride, 2, { startedAt: unixSeconds(ride.startedAt + 60), elapsedTime: seconds(60) }),
      );
    });

    const { laps } = decodeTcx(textOf((await exportFrom(open, ride.id, 'tcx')).bytes)).activity;

    // No sorting and no repair of the rows — and no lap of less than no time,
    // and a total that is the ride's.
    expect(laps.map((lap) => lap.totalElapsedTime)).toEqual([120, 0, 0]);
    expect(total(laps.map((lap) => lap.totalDistance))).toBe(ride.distance);
    expect(laps.reduce((sum, lap) => sum + lap.points.length, 0)).toBe(SAMPLE_COUNT);
  });

  it('gives the splits outside the laps no moving time when the laps already state more than the ride moved', async () => {
    const { open, ride } = await seedOutdoorRide(ATHLETE_A, {
      elapsedTime: seconds(SAMPLE_COUNT),
      movingTime: seconds(100),
    });
    await open.write(async (store) => {
      // A minute in the middle that states 590 s of moving time.
      await store.putLap(
        lapFor(ride, 0, {
          startedAt: unixSeconds(ride.startedAt + 30),
          elapsedTime: seconds(60),
        }),
      );
    });

    const { laps } = decodeFitActivity((await exportFrom(open, ride.id, 'fit')).bytes).activity;

    // The row is written as it is stored, and the file is still written: the
    // ride moved no less than nothing outside it.
    expect(laps.map((lap) => lap.totalTimerTime)).toEqual([0, 590, 0]);
  });

  /** A ride of `SAMPLE_COUNT` samples and the laps given, in the real store. */
  async function seedWithLaps(
    elapsed: number,
    laps: readonly (readonly [startOffset: number, elapsed: number])[],
  ): Promise<{ open: StoreHarness; ride: NewActivity }> {
    const open = createStoreHarness();
    harness = open;
    await seedAthletes(open);
    const ride = rideFor(ATHLETE_A, { hasPosition: true, elapsedTime: seconds(elapsed) });
    await open.write(async (store) => {
      await store.putActivity(ride);
      await store.putStreamSet(streamSetFor(ride, { sampleCount: SAMPLE_COUNT }));
      for (const [ordinal, [offset, lasted]] of laps.entries()) {
        await store.putLap(
          lapFor(ride, ordinal, {
            startedAt: unixSeconds(ride.startedAt + offset),
            elapsedTime: seconds(lasted),
            movingTime: seconds(lasted),
          }),
        );
      }
    });
    return { open, ride };
  }

  it('writes no split with no sample in it: the time after the last lap goes into that lap’s total', async () => {
    // Five seconds longer than its samples: the ride was stopped a moment
    // after the last reading, and after the lap.
    const { open, ride } = await seedWithLaps(SAMPLE_COUNT + 5, [[0, SAMPLE_COUNT]]);

    // Not a second `<Lap>` with an empty `<Track>`, which a strict reader may
    // refuse — and the one lap still adds up to the ride.
    const tcx = decodeTcx(textOf((await exportFrom(open, ride.id, 'tcx')).bytes)).activity;
    expect(tcx.laps.map((lap) => lap.points.length)).toEqual([SAMPLE_COUNT]);
    expect(tcx.laps.map((lap) => lap.totalElapsedTime)).toEqual([SAMPLE_COUNT + 5]);
    expect(textOf((await exportFrom(open, ride.id, 'tcx')).bytes)).not.toMatch(
      /<Track>\s*<\/Track>/,
    );

    const fit = decodeFitActivity((await exportFrom(open, ride.id, 'fit')).bytes).activity;
    expect(fit.laps.map((lap) => lap.totalElapsedTime)).toEqual([SAMPLE_COUNT]);
    expect(fit.sessions[0]?.numLaps).toBe(1);
    expect(fit.sessions[0]?.totalElapsedTime).toBe(SAMPLE_COUNT + 5);

    const gpx = decodeGpx(textOf((await exportFrom(open, ride.id, 'gpx')).bytes)).activity;
    expect(gpx.laps.map((lap) => lap.points.length)).toEqual([SAMPLE_COUNT]);
  });

  it('writes no split for half a second before the first lap or between two: the lap after it counts from the ride’s start', async () => {
    // The game ride began half a second into its recording, and its second
    // lap a quarter of a second after its first ended: no sample in either.
    const { open, ride } = await seedWithLaps(SAMPLE_COUNT, [
      [0.5, 59.5],
      [60.25, 59.75],
    ]);

    const tcx = decodeTcx(textOf((await exportFrom(open, ride.id, 'tcx')).bytes)).activity;
    expect(tcx.laps.map((lap) => lap.points.length)).toEqual([60, 60]);
    // The first counts from the ride's start; the gap is in the lap before it.
    expect(tcx.laps.map((lap) => lap.totalElapsedTime)).toEqual([60.3, 59.7]);
    expect(total(tcx.laps.map((lap) => lap.totalElapsedTime))).toBe(SAMPLE_COUNT);
    expect(total(tcx.laps.map((lap) => lap.totalDistance))).toBe(ride.distance);

    // FIT: the two laps as they are stored, and no lap a fraction of a second long.
    const fit = decodeFitActivity((await exportFrom(open, ride.id, 'fit')).bytes).activity;
    expect(fit.laps.map((lap) => lap.totalElapsedTime)).toEqual([59.5, 59.75]);
  });

  it('writes no lap of nought seconds for the sample in the slot a ride’s last lap ended in: it goes in that lap’s split', async () => {
    // `recording/laps.ts` §`lapSlots`: a lap owns the slots up to and not
    // including the one it ended in. This one ends in the ride's last slot,
    // where the ride ends too, so that slot's sample is the ride's and not
    // the lap's — and has no split of its own to go in. ⚠️ The third pass
    // wrote one, of nought seconds; the file's lap now holds one sample its
    // row's averages leave out, and no reader is shown 7.8 m in 0 s.
    const { open, ride } = await seedWithLaps(SAMPLE_COUNT - 1, [[0, SAMPLE_COUNT - 1]]);

    const tcx = decodeTcx(textOf((await exportFrom(open, ride.id, 'tcx')).bytes)).activity;
    expect(tcx.laps.map((lap) => lap.points.length)).toEqual([SAMPLE_COUNT]);
    expect(tcx.laps.map((lap) => lap.totalElapsedTime)).toEqual([SAMPLE_COUNT - 1]);

    const fit = decodeFitActivity((await exportFrom(open, ride.id, 'fit')).bytes).activity;
    expect(fit.laps.map((lap) => lap.totalElapsedTime)).toEqual([SAMPLE_COUNT - 1]);
    expect(fit.records).toHaveLength(SAMPLE_COUNT);
  });

  it('folds a stretch after the last lap that is shorter than a sample into that lap, sample and all', async () => {
    // The recording was stopped 0.4 s after *End ride*: the stretch holds the
    // last slot's sample and lasts less than the sample does.
    const { open, ride } = await seedWithLaps(SAMPLE_COUNT - 0.6, [[0, SAMPLE_COUNT - 1]]);

    const tcx = decodeTcx(textOf((await exportFrom(open, ride.id, 'tcx')).bytes)).activity;
    expect(tcx.laps.map((lap) => lap.points.length)).toEqual([SAMPLE_COUNT]);
    // Its time is in the lap's total, so the file still adds up to the ride.
    expect(tcx.laps.map((lap) => lap.totalElapsedTime)).toEqual([SAMPLE_COUNT - 0.6]);

    const fit = decodeFitActivity((await exportFrom(open, ride.id, 'fit')).bytes).activity;
    expect(fit.laps).toHaveLength(1);
    expect(fit.records).toHaveLength(SAMPLE_COUNT);
  });

  /**
   * #1312's first and second review notes. Two stretches too short to write
   * are folded into the lap before them, each holding samples: a quarter of a
   * second between the laps (slot 59) and 0.6 s after the last (slots 118 and
   * 119, since the last lap ends at 118.9, inside slot 118).
   */
  describe('a stretch folded into the lap before it', () => {
    const seedFolded = async () =>
      seedWithLaps(SAMPLE_COUNT - 0.5, [
        [0, 59.5],
        [60.25, 58.65],
      ]);
    const slotsFrom = (start: number, first: number, end: number): readonly number[] =>
      Array.from({ length: end - first }, (_, index) => start + first + index);
    const instantOf = (record: { readonly timestamp: FitDateTime | undefined }) =>
      record.timestamp?.kind === 'instant' ? record.timestamp.instant : undefined;

    it('puts its samples AFTER the lap’s own, in the order they were recorded, in every format', async () => {
      const { open, ride } = await seedFolded();
      const lapOne = slotsFrom(ride.startedAt, 0, 60);
      const lapTwo = slotsFrom(ride.startedAt, 60, SAMPLE_COUNT);

      const tcx = decodeTcx(textOf((await exportFrom(open, ride.id, 'tcx')).bytes)).activity;
      expect(tcx.laps.map((lap) => lap.points.map((point) => point.timestamp))).toEqual([
        lapOne,
        lapTwo,
      ]);
      const gpx = decodeGpx(textOf((await exportFrom(open, ride.id, 'gpx')).bytes)).activity;
      expect(gpx.laps.map((lap) => lap.points.map((point) => point.timestamp))).toEqual([
        lapOne,
        lapTwo,
      ]);
      // FIT's records are the splits' points end to end: the stored order.
      const fit = decodeFitActivity((await exportFrom(open, ride.id, 'fit')).bytes).activity;
      expect(fit.records.map(instantOf)).toEqual([...lapOne, ...lapTwo]);
    });

    it('holds the samples its row counted, then those of the folded stretch and no others: here one and two', async () => {
      const { open, ride } = await seedFolded();
      const rows = await open.read(async (store) => store.listLaps(ATHLETE_A, ride.id));
      const grid = {
        startedAt: ride.startedAt,
        sampleInterval: seconds(1),
        sampleCount: SAMPLE_COUNT,
      };

      const tcx = decodeTcx(textOf((await exportFrom(open, ride.id, 'tcx')).bytes)).activity;

      // `recording/laps.ts` §`lapSlots`, over each stored row: what its
      // averages were worked out from.
      const counted = rows.map((row) => {
        const slots = lapSlots(
          grid,
          { at: row.startedAt, movingTime: row.movingTime },
          { at: unixSeconds(row.startedAt + row.elapsedTime), movingTime: row.movingTime },
        );
        return slotsFrom(ride.startedAt, slots.first, slots.end);
      });
      expect(counted.map((slots) => slots.length)).toEqual([59, 58]);
      tcx.laps.forEach((lap, index) => {
        const own = counted[index] ?? [];
        const held = lap.points.map((point) => point.timestamp);
        // The row's samples, every one of them and first…
        expect(held.slice(0, own.length)).toEqual(own);
        // …then only the slots of the stretch folded in, which lasts less
        // than one sample and so reaches into two slots at the most.
        const extra = held.slice(own.length);
        expect(extra.length).toBeLessThanOrEqual(2);
        for (const instant of extra) {
          expect(instant).toBeGreaterThanOrEqual((own.at(-1) ?? 0) + 1);
        }
      });
      expect(tcx.laps.map((lap) => lap.points.length - (counted.shift()?.length ?? 0))).toEqual([
        1, 2,
      ]);
    });
  });

  it.each<ActivityFileFormat>(['fit', 'gpx', 'tcx'])(
    'exports a ride whose last lap ends AFTER the ride does, in %s',
    async (format) => {
      // #1316's fourth review. A lap's mark is the session's clock; the ride
      // ends at the wall clock's `stop`, which can be behind it. The stretch
      // "after the last lap" then lasts less than nothing, and until it was
      // left out the export threw — and the push to an instance is this
      // export.
      const { open, ride } = await seedWithLaps(SAMPLE_COUNT - 0.7, [[0, SAMPLE_COUNT]]);

      const file = await exportFrom(open, ride.id, format);

      const laps =
        format === 'fit'
          ? decodeFitActivity(file.bytes).activity.laps.map((lap) => lap.totalElapsedTime)
          : (format === 'gpx'
              ? decodeGpx(textOf(file.bytes))
              : decodeTcx(textOf(file.bytes))
            ).activity.laps.map((lap) => lap.totalElapsedTime);
      // One lap. FIT states the stored lap's own time; TCX the ride's, which
      // is what its laps must add up to; GPX states none.
      expect(laps).toEqual([
        format === 'fit' ? SAMPLE_COUNT : format === 'tcx' ? SAMPLE_COUNT - 0.7 : undefined,
      ]);
    },
  );

  it('writes a stored lap with no sample in it to FIT, and leaves it out of TCX and GPX with its time in the lap before', async () => {
    // A whole lap ridden while the recording was paused: a real lap, and no
    // reading in it (here 0.4 s inside one slot stands in for it).
    const { open, ride } = await seedWithLaps(SAMPLE_COUNT, [
      [0, 60],
      [60, 0.4],
      [60.4, 59.6],
    ]);

    const fit = decodeFitActivity((await exportFrom(open, ride.id, 'fit')).bytes).activity;
    expect(fit.laps.map((lap) => lap.totalElapsedTime)).toEqual([60, 0.4, 59.6]);

    const text = textOf((await exportFrom(open, ride.id, 'tcx')).bytes);
    expect(text).not.toMatch(/<Track>\s*<\/Track>/);
    const tcx = decodeTcx(text).activity;
    expect(tcx.laps.map((lap) => lap.points.length)).toEqual([60, 60]);
    expect(tcx.laps.map((lap) => lap.totalElapsedTime)).toEqual([60.4, 59.6]);
    expect(total(tcx.laps.map((lap) => lap.totalDistance))).toBe(ride.distance);

    const gpx = decodeGpx(textOf((await exportFrom(open, ride.id, 'gpx')).bytes)).activity;
    expect(gpx.laps.map((lap) => lap.points.length)).toEqual([60, 60]);
  });
});
