// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The account export, tested against the real store rather than a double.
 *
 * The interesting assertions are the ones about what is *not* in the output —
 * a private key, a trimmed coordinate — and both of those are only meaningful
 * against real rows written through the real write path.
 */

import {
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  extractableDeviceKey,
  resetFixtureIds,
  rideFor,
  routeFor,
  seedAthletes,
  streamSetFor,
  workoutFor,
} from '@onyourleft/store/testing';
import type { PrivacyZoneRecord } from '@onyourleft/store';
import { privacyZoneId } from '@onyourleft/store';
import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  unixSeconds,
  watts,
} from '@onyourleft/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { coordinatesIn, insideZone } from '../privacy/boundaries';

import {
  ACCOUNT_EXPORT_VERSION,
  MANIFEST_FILE_NAME,
  accountManifest,
  exportEverything,
} from './export-everything';
import type { DownloadableFile } from './store-port';

const SAMPLE_COUNT = 120;

let harness: ReturnType<typeof createStoreHarness>;

beforeEach(() => {
  resetFixtureIds();
  harness = createStoreHarness();
});

afterEach(async () => {
  await harness.destroy();
});

function zoneFor(owner: typeof ATHLETE_A, latitude: number): PrivacyZoneRecord {
  return {
    id: privacyZoneId(`zone-${owner}`),
    athleteId: owner,
    centre: geographicPosition(degreesLatitude(latitude), degreesLongitude(-0.12)),
    radius: metres(500),
    label: 'home',
    createdAt: unixSeconds(1_700_000_000),
  };
}

/** Seeds a library and returns what was written, so a test can name any of it. */
async function seedLibrary(rides = 3) {
  await seedAthletes(harness);
  const { record: deviceKey, privateKeyHex } = await extractableDeviceKey(ATHLETE_A);
  const written: { ride: ReturnType<typeof rideFor>; streams: ReturnType<typeof streamSetFor> }[] =
    [];
  for (let index = 0; index < rides; index += 1) {
    const ride = rideFor(ATHLETE_A, {
      hasPosition: true,
      startedAt: unixSeconds(1_700_000_000 + index * 86_400),
    });
    const streams = streamSetFor(ride, { sampleCount: SAMPLE_COUNT });
    written.push({ ride, streams });
  }
  const route = routeFor(ATHLETE_A);
  const workout = workoutFor(ATHLETE_A);
  const firstLatitude = (written[0]?.streams.channels.latitude?.[SAMPLE_COUNT / 2] ??
    51.5) as number;
  const zone = zoneFor(ATHLETE_A, firstLatitude);

  await harness.write(async (store) => {
    for (const { ride, streams } of written) {
      await store.putActivity(ride);
      await store.putStreamSet(streams);
    }
    await store.putRoute(route);
    await store.putWorkout(workout);
    await store.putPrivacyZone(zone);
    await store.putDeviceKey(deviceKey);
    await store.setAthleteThresholds(ATHLETE_A, { thresholdPower: watts(250) });
    // A second athlete with their own ride, so "everything" can be checked to
    // mean "everything of this athlete's" rather than "everything on the disk".
    const theirs = rideFor(ATHLETE_B, { hasPosition: true });
    await store.putActivity(theirs);
    await store.putStreamSet(streamSetFor(theirs, { sampleCount: 20 }));
  });

  return { written, route, workout, zone, privateKeyHex };
}

/** Runs an export, collecting the files it hands over. */
async function runExport(
  options: Partial<Parameters<typeof exportEverything>[0]> = {},
): Promise<{ files: DownloadableFile[]; report: Awaited<ReturnType<typeof exportEverything>> }> {
  const files: DownloadableFile[] = [];
  const report = await harness.read(async (store) =>
    exportEverything({
      store,
      athleteId: ATHLETE_A,
      format: 'gpx',
      onFile: (file) => {
        files.push(file);
      },
      ...options,
    }),
  );
  return { files, report };
}

function manifestOf(files: readonly DownloadableFile[]): Record<string, unknown> {
  const file = files.find((each) => each.fileName === MANIFEST_FILE_NAME);
  expect(file).toBeDefined();
  return JSON.parse(new TextDecoder().decode(file?.bytes ?? new Uint8Array())) as Record<
    string,
    unknown
  >;
}

describe('exporting everything', () => {
  it('produces one file per ride plus a manifest', async () => {
    await seedLibrary(3);
    const { files, report } = await runExport();

    expect(report.exported).toBe(3);
    expect(report.failed).toBe(0);
    expect(files).toHaveLength(4);
    expect(files.at(-1)?.fileName).toBe(MANIFEST_FILE_NAME);
  });

  it('exports this athlete and nobody else', async () => {
    await seedLibrary(3);
    const { report } = await runExport();

    // ATHLETE_B has a ride too. Three, not four: the export is a scoped read
    // like every other, and this is the assertion that says so.
    expect(report.outcomes).toHaveLength(3);
  });

  it('carries the account data an activity file cannot', async () => {
    const { route, workout, zone } = await seedLibrary(1);
    const { files } = await runExport();
    const manifest = manifestOf(files);

    expect(manifest['onYourLeftAccountExport']).toBe(ACCOUNT_EXPORT_VERSION);
    expect((manifest['athlete'] as Record<string, unknown>)['thresholdPower']).toBe(250);
    expect(manifest['privacyZones']).toHaveLength(1);
    expect((manifest['privacyZones'] as { id: string }[])[0]?.id).toBe(zone.id);
    expect((manifest['routes'] as { id: string }[])[0]?.id).toBe(route.id);
    expect((manifest['workouts'] as { id: string }[])[0]?.id).toBe(workout.id);
    expect(manifest['activities']).toHaveLength(1);
  });

  it('never writes the private key, in any file', async () => {
    // #61's second criterion, applied to a path that did not exist when it was
    // written. The fixture key is extractable precisely so its bytes are known
    // and can be searched for; the production key has none to find, which is
    // why this assertion needs the fixture to mean anything.
    const { privateKeyHex } = await seedLibrary(2);
    const { files } = await runExport();

    expect(privateKeyHex.length).toBeGreaterThan(32);
    for (const file of files) {
      expect(new TextDecoder().decode(file.bytes)).not.toContain(privateKeyHex);
    }
  });

  it('carries the public key, which is the identity a verifier needs', async () => {
    await seedLibrary(1);
    const manifest = manifestOf((await runExport()).files);
    const key = manifest['deviceKey'] as Record<string, unknown> | undefined;

    expect(typeof key?.['publicKey']).toBe('string');
    expect(key?.['privateKey']).toBeUndefined();
  });

  it("does not trim the athlete's own coordinates", async () => {
    // The `retained` direction, asserted on the exported bytes. A sweep that
    // trimmed everywhere would pass every other test in this file.
    const { zone } = await seedLibrary(1);
    const { files } = await runExport();

    const ride = files.find((each) => each.fileName !== MANIFEST_FILE_NAME);
    expect(ride).toBeDefined();
    const text = new TextDecoder().decode(ride?.bytes ?? new Uint8Array());
    const positions = [...text.matchAll(/lat="([-\d.]+)"\s+lon="([-\d.]+)"/g)].map((match) => ({
      latitude: Number(match[1]),
      longitude: Number(match[2]),
    }));

    expect(positions.length).toBeGreaterThan(0);
    expect(insideZone(coordinatesIn(positions), zone, 'irrelevant').length).toBeGreaterThan(0);
  });

  it('reports a ride it could not write and carries on', async () => {
    await seedAthletes(harness);
    const good = rideFor(ATHLETE_A, {
      hasPosition: true,
      startedAt: unixSeconds(1_700_000_000),
    });
    // A ride with no streams at all: `exportActivity` refuses it, because a
    // zero-sample file is one every reader accepts and no rider wants.
    const bare = rideFor(ATHLETE_A, { startedAt: unixSeconds(1_700_100_000) });
    await harness.write(async (store) => {
      await store.putActivity(good);
      await store.putStreamSet(streamSetFor(good, { sampleCount: 20 }));
      await store.putActivity(bare);
    });

    const { files, report } = await runExport();

    expect(report.exported).toBe(1);
    expect(report.failed).toBe(1);
    // An archive missing one ride is worth having; an export that aborted on
    // the first bad ride would not be.
    expect(files).toHaveLength(2);
    const failed = report.outcomes.find((each) => each.kind === 'failed');
    expect(failed?.reason).toBeTruthy();
    // And the manifest lists only what was actually produced.
    expect(manifestOf(files)['activities']).toHaveLength(1);
  });

  it('stops between rides when cancelled and keeps what it handed over', async () => {
    await seedLibrary(3);
    const controller = new AbortController();
    const files: DownloadableFile[] = [];
    const report = await harness.read(async (store) =>
      exportEverything({
        store,
        athleteId: ATHLETE_A,
        format: 'gpx',
        signal: controller.signal,
        onFile: (file) => {
          files.push(file);
          controller.abort();
        },
      }),
    );

    expect(report.exported).toBe(1);
    expect(report.cancelled).toBe(2);
    // One ride and the manifest: cancelling stops the loop, it does not unwrite
    // a file the caller already has.
    expect(files).toHaveLength(2);
    expect(manifestOf(files)['activities']).toHaveLength(1);
  });

  it('reports where to continue when the library is longer than the limit', async () => {
    const { written } = await seedLibrary(3);
    const { report } = await runExport({ limit: 2 });

    expect(report.exported).toBe(2);
    expect(report.continueAfter).toBe(written[1]?.ride.startedAt);

    const rest = await runExport({ limit: 2, after: report.continueAfter });
    expect(rest.report.exported).toBe(1);
    expect(rest.report.continueAfter).toBeUndefined();
  });

  it('says nothing about a library that ended exactly on the limit', async () => {
    await seedLibrary(2);
    const { report } = await runExport({ limit: 2 });

    // The off-by-one worth having a case for: reading `limit + 1` rows is what
    // makes "there are more" a fact rather than "we returned as many as we
    // were allowed", which is true of a library of exactly `limit`.
    expect(report.exported).toBe(2);
    expect(report.continueAfter).toBeUndefined();
  });
});

describe('the manifest names its fields rather than spreading the row', () => {
  it('omits a field the record grew that nobody added here', () => {
    // The behaviour the file header argues for, asserted: an export that spread
    // the athlete row would carry whatever it grows next.
    const file = accountManifest({
      athleteId: ATHLETE_A,
      athlete: {
        displayName: 'A',
        createdAt: 1,
        // A field this manifest does not know about.
        ...({ secretDiary: 'nobody meant to publish this' } as unknown as Record<string, never>),
      },
      deviceKey: undefined,
      privacyZones: [],
      segments: [],
      routes: [],
      workouts: [],
      activities: [],
      exportedAt: 1,
    });

    expect(new TextDecoder().decode(file.bytes)).not.toContain('secretDiary');
  });

  it('is valid JSON ending in a newline', () => {
    const file = accountManifest({
      athleteId: ATHLETE_A,
      athlete: undefined,
      deviceKey: undefined,
      privacyZones: [],
      segments: [],
      routes: [],
      workouts: [],
      activities: [],
      exportedAt: 1,
    });
    const text = new TextDecoder().decode(file.bytes);

    expect(text.endsWith('\n')).toBe(true);
    expect(() => JSON.parse(text) as unknown).not.toThrow();
    expect(file.mediaType).toBe('application/json');
  });
});
