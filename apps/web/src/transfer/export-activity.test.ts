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
  degreesLatitude,
  degreesLatitudeToSemicircles,
  metres,
  SEMICIRCLE_ROUND_TRIP_TOLERANCE_DEGREES,
  unixSeconds,
  type DegreesLatitude,
} from '@onyourleft/domain';
import { decodeFitActivity, decodeGpx, decodeTcx, trackPointsOf } from '@onyourleft/fit';
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
  rideFor,
  seedAthletes,
  streamSetFor,
  type StoreHarness,
} from '@onyourleft/store/testing';
import FitParser from 'fit-file-parser';

import { ActivityExportError, exportActivity, fileStemOf } from './export-activity';
import type { ActivityFileFormat } from './file-format';

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

async function exportFrom(
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

    // `fit-file-parser` 5.0.2 (MIT), a devDependency that is never shipped —
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
