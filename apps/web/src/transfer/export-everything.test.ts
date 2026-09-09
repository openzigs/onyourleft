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
  signedRecordFor,
  streamSetFor,
  workoutFor,
} from '@onyourleft/store/testing';
import type { PrivacyZoneRecord } from '@onyourleft/store';
import { privacyZoneId, webCryptoVerifier } from '@onyourleft/store';
import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  isVerified,
  metres,
  unixSeconds,
  verifyRecordSignature,
  watts,
} from '@onyourleft/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { coordinatesIn, insideZone } from '../privacy/boundaries';

import {
  ACCOUNT_EXPORT_VERSION,
  MANIFEST_FILE_NAME,
  SIGNED_RECORD_SUFFIX,
  accountManifest,
  exportEverything,
  signedRecordFileName,
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
  const {
    record: deviceKey,
    key: signingKey,
    privateKeyHex,
  } = await extractableDeviceKey(ATHLETE_A);
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

  return { written, route, workout, zone, privateKeyHex, signingKey };
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

    // The manifest lists BOTH rides, and says which one is not in the archive.
    // An archive whose index simply omitted the failure would leave nothing
    // saying that ride ever existed — and the rider who then erases the device
    // has lost it without ever being told which one.
    const listed = manifestOf(files)['activities'] as {
      written: boolean;
      reason?: string;
    }[];
    expect(listed).toHaveLength(2);
    expect(listed.filter((each) => each.written)).toHaveLength(1);
    const missing = listed.find((each) => !each.written);
    expect(missing?.reason).toBeTruthy();
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

  it('does not step the cursor past a ride a Stop skipped', async () => {
    // The bug this replaces lost rides permanently: `continueAfter` was the
    // last ride the run *looked at*, so resuming after a Stop began past
    // everything the Stop had skipped — while the screen invited exactly that
    // by offering Stop and then "run it again to continue".
    const { written } = await seedLibrary(3);
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
    // The first ride, not the third.
    expect(report.continueAfter).toBe(written[0]?.ride.startedAt);

    const rest = await runExport({ after: report.continueAfter });
    expect(rest.report.exported).toBe(2);
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

/**
 * #221's first half: the signed record leaves with the ride.
 *
 * The assertion that matters is the verification one, and its whole value is
 * where it reads from — **the exported bytes**, parsed as JSON, with the public
 * key taken out of the record itself. Nothing in it touches the store, so it is
 * the same thing a stranger holding the archive can do, and it would go red for
 * an export that wrote a plausible-looking object with the signature dropped or
 * a member renamed.
 */
describe('exporting the signed records (#221)', () => {
  /** A library where the first `signed` rides carry a record. */
  async function seedSignedLibrary(rides: number, signed: number) {
    // ⚠️ Signed with the key `seedLibrary` already **stored**, not with a fresh
    // one. `putActivityRecord` refuses a record signed by a key that is not
    // this athlete's — the guard that stops one identity's rides being filed
    // under another — and a second `extractableDeviceKey` call generates a
    // second identity, which that guard correctly rejects.
    const { written, privateKeyHex, signingKey } = await seedLibrary(rides);
    await harness.write(async (store) => {
      for (const { ride } of written.slice(0, signed)) {
        await store.putActivityRecord(await signedRecordFor(ride, signingKey));
      }
    });
    return { written, privateKeyHex };
  }

  it('writes one record file per ride that has one, beside its activity file', async () => {
    const { written } = await seedSignedLibrary(3, 2);
    const { files, report } = await runExport();

    // Three rides, two records, one manifest.
    expect(files).toHaveLength(6);
    expect(report.signedRecords).toBe(2);
    const names = files.map((each) => each.fileName);
    const rideFile = report.outcomes[0]?.fileName ?? '';
    expect(names).toContain(signedRecordFileName(rideFile));
    // The one with no record produced no file and claimed none.
    expect(report.outcomes[2]?.signedRecord).toBeUndefined();
    expect(written).toHaveLength(3);
  });

  it('verifies from the exported bytes alone, with the key inside the record', async () => {
    await seedSignedLibrary(1, 1);
    const { files } = await runExport();

    const file = files.find((each) => each.fileName.endsWith(SIGNED_RECORD_SUFFIX));
    expect(file).toBeDefined();
    // Everything below this line reads the archive and nothing else. No store,
    // no fixture object, no key handed in from the side — #221's second
    // criterion in as many words, and ADR 0019 D-4's `verifyRecordSignature`
    // rather than `verifyActivityRecord`, because the activity file beside it
    // is a re-encode and is not the bytes the record vouches for.
    const parsed: unknown = JSON.parse(new TextDecoder().decode(file?.bytes ?? new Uint8Array()));

    const outcome = await verifyRecordSignature(parsed, webCryptoVerifier);

    expect(outcome.status).toBe('verified');
    expect(isVerified(outcome) && outcome.record.publicKey).toBeTruthy();
  });

  it('writes a record a tampered copy of which does not verify', async () => {
    // The other half of the assertion above: a verification that cannot fail
    // proves nothing about the bytes it was handed. One flipped claim, and the
    // same code path answers `signature-mismatch`.
    await seedSignedLibrary(1, 1);
    const { files } = await runExport();
    const file = files.find((each) => each.fileName.endsWith(SIGNED_RECORD_SUFFIX));
    const record = JSON.parse(new TextDecoder().decode(file?.bytes ?? new Uint8Array())) as {
      claims: { distance: number };
    };
    record.claims.distance += 1;

    expect((await verifyRecordSignature(record, webCryptoVerifier)).status).toBe(
      'signature-mismatch',
    );
  });

  it('says in the manifest, per ride, whether a record went with it', async () => {
    await seedSignedLibrary(2, 1);
    const { files } = await runExport();
    const listed = manifestOf(files)['activities'] as {
      fileName: string;
      signedRecord: string | null;
    }[];

    expect(listed).toHaveLength(2);
    expect(listed[0]?.signedRecord).toBe(signedRecordFileName(listed[0]?.fileName ?? ''));
    // ⚠️ `null`, not absent. An omitted member is exactly as unreadable as no
    // member at all — "this ride never had a record" would be indistinguishable
    // from "the export dropped it", which is the confusion the member exists to
    // remove. `toBeNull` and not `toBeUndefined` is the whole assertion.
    expect(listed[1]?.signedRecord).toBeNull();
    // And the raw text, because `JSON.parse` cannot tell a written `null` from
    // an absent member either way round for a reader that used `in`.
    const text = new TextDecoder().decode(
      files.find((each) => each.fileName === MANIFEST_FILE_NAME)?.bytes ?? new Uint8Array(),
    );
    expect(text).toContain('"signedRecord": null');
  });

  it('exports a library with no records at all, cleanly and as no failure', async () => {
    await seedLibrary(2);
    const { files, report } = await runExport();

    // Not every ride has one: an imported ride never did. Two rides and a
    // manifest, nothing reported as failed.
    expect(report.exported).toBe(2);
    expect(report.failed).toBe(0);
    expect(report.signedRecords).toBe(0);
    expect(files).toHaveLength(3);
    expect(files.some((each) => each.fileName.endsWith(SIGNED_RECORD_SUFFIX))).toBe(false);
  });

  it('carries the record of a ride whose file could not be written', async () => {
    await seedAthletes(harness);
    const { record: deviceKey, key } = await extractableDeviceKey(ATHLETE_A);
    // A ride with no streams: `exportActivity` refuses it. Its record is still
    // the athlete's, is still destroyed by the erase, and can never be minted
    // again — so dropping it here would be the exact loss #221 is about.
    const bare = rideFor(ATHLETE_A, { startedAt: unixSeconds(1_700_000_000) });
    await harness.write(async (store) => {
      await store.putActivity(bare);
      await store.putDeviceKey(deviceKey);
      await store.putActivityRecord(await signedRecordFor(bare, key));
    });

    const { files, report } = await runExport();

    expect(report.failed).toBe(1);
    expect(report.signedRecords).toBe(1);
    const listed = manifestOf(files)['activities'] as {
      fileName: string;
      written: boolean;
      signedRecord: string | null;
    }[];
    expect(listed[0]?.written).toBe(false);
    expect(listed[0]?.signedRecord).toBe(signedRecordFileName(listed[0]?.fileName ?? ''));
    expect(files.filter((each) => each.fileName.endsWith(SIGNED_RECORD_SUFFIX))).toHaveLength(1);
  });

  it('writes no record for a ride the export was cancelled before reaching', async () => {
    await seedSignedLibrary(3, 3);
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

    // A cancelled ride is one no file was handed over for — the record is a
    // file, so the same rule binds it.
    expect(report.cancelled).toBe(2);
    expect(report.signedRecords).toBe(1);
    expect(files.filter((each) => each.fileName.endsWith(SIGNED_RECORD_SUFFIX))).toHaveLength(1);
  });

  it('gives two rides of the same name two record files, not one', async () => {
    await seedAthletes(harness);
    const { record: deviceKey, key } = await extractableDeviceKey(ATHLETE_A);
    const rides = [0, 1].map((index) =>
      rideFor(ATHLETE_A, {
        name: 'Morning ride',
        startedAt: unixSeconds(1_700_000_000 + index * 86_400),
      }),
    );
    await harness.write(async (store) => {
      await store.putDeviceKey(deviceKey);
      for (const ride of rides) {
        await store.putActivity(ride);
        await store.putStreamSet(streamSetFor(ride, { sampleCount: 20 }));
        await store.putActivityRecord(await signedRecordFor(ride, key));
      }
    });

    const { files } = await runExport();
    const names = files.filter((each) => each.fileName.endsWith(SIGNED_RECORD_SUFFIX));

    // The record names are derived from the DE-DUPLICATED activity file names,
    // so a collision there is the only way to get one here — and there is not
    // one. Two files with one name is an archive that silently holds one.
    expect(names).toHaveLength(2);
    expect(new Set(names.map((each) => each.fileName)).size).toBe(2);
  });

  it('puts no trace of another athlete’s identity in this athlete’s archive', async () => {
    // ⚠️ **What this does and does not pin, stated because the obvious reading
    // is wrong.** It is *not* a test of `getActivityRecord`'s scoping argument:
    // the loop only ever visits summaries `listActivitySummaries(athleteId)`
    // returned, and an activity id belongs to exactly one athlete, so swapping
    // the owner for the summary's own — or even dropping the owner from the
    // store's index query — is behaviourally equivalent here. Both mutations
    // were tried and both stayed green. The cross-athlete class is closed at
    // the store, which exposes no unscoped record lookup at all.
    //
    // What it does pin is the outcome that would matter if any of that changed
    // shape: **athlete B's public key appears in no byte of athlete A's
    // archive.** A public key is the identity, so this is the greppable form of
    // "whose records are in here" — and it is exactly the shape of the
    // private-key assertion above, which is the one that has already caught a
    // real leak once.
    const { written } = await seedSignedLibrary(1, 1);
    const { record: keyB, key } = await extractableDeviceKey(ATHLETE_B);
    const theirs = rideFor(ATHLETE_B);
    await harness.write(async (store) => {
      await store.putActivity(theirs);
      await store.putStreamSet(streamSetFor(theirs, { sampleCount: 20 }));
      await store.putDeviceKey(keyB);
      await store.putActivityRecord(await signedRecordFor(theirs, key));
    });

    const { files, report } = await runExport();

    expect(written).toHaveLength(1);
    expect(report.outcomes).toHaveLength(1);
    expect(report.signedRecords).toBe(1);
    expect(keyB.publicKey.length).toBe(64);
    for (const file of files) {
      expect(new TextDecoder().decode(file.bytes)).not.toContain(keyB.publicKey);
    }
  });
});

describe('signedRecordFileName', () => {
  it('replaces the activity file’s extension rather than appending to it', () => {
    expect(signedRecordFileName('Morning ride.gpx')).toBe('Morning ride.record.json');
    expect(signedRecordFileName('Morning ride (2).fit')).toBe('Morning ride (2).record.json');
    expect(signedRecordFileName('Ride.2026.03.14.tcx')).toBe('Ride.2026.03.14.record.json');
  });

  it('appends when there is no extension to replace', () => {
    // Not reachable from `exportEverything`, which always appends a format —
    // and it is here because a name that lost its leading dot is a filename a
    // rider cannot see, which is worse than an ugly one.
    expect(signedRecordFileName('ride')).toBe('ride.record.json');
    expect(signedRecordFileName('.hidden')).toBe('.hidden.record.json');
  });
});
