// SPDX-License-Identifier: Apache-2.0

/**
 * **The six files [#138](https://github.com/openzigs/onyourleft/issues/138)
 * asks a person to upload, built by command rather than by hand.**
 *
 * #138 wants this package's encoder output accepted by two real consumer
 * platforms — Strava, and Garmin Connect or TrainingPeaks — in all three
 * formats, including *"an indoor ride with no position … because a track with
 * no points is exactly the shape naive importers reject"*. That needs accounts
 * and a browser and cannot be done by an agent. What **can** be done ahead of
 * time is everything up to the upload, and that is what this is: two rides ×
 * three formats, produced deterministically, ready to drag into a web page.
 *
 * ## Where the rides come from, and why not a real one
 *
 * From the #29 synthetic corpus, and #138 is explicit about the reason:
 *
 * > Use a synthetic ride from the #29 corpus rather than a real one — ADR 0004
 * > decision G and the synthetic test regions exist so that test data carries
 * > no real location. Uploading a real ride to two platforms to test an encoder
 * > would defeat the privacy posture the rest of this repository is careful
 * > about.
 *
 * ⚠️ **That is not a preference and this file must not be made configurable to
 * take a rider's own ride.** An upload is irreversible: the file is on somebody
 * else's servers, in an account with a name on it, the moment the button is
 * pressed. `synthetic-region-guard.test.ts` already proves every corpus
 * coordinate is inside a synthetic test region; building these files from the
 * corpus is what extends that guarantee to the things a person actually uploads.
 *
 * ## Why it decodes and re-encodes rather than shipping the fixtures
 *
 * The corpus fixtures are **decoder** fixtures: byte streams built by
 * `tools/fixture-corpus/` from the published protocol layout, so that #30 has
 * something to read. Uploading one would test the fixture generator. #138 says
 * *"Encode a ride with this package"* — so each file here is decoded from the
 * corpus and then written by `encodeFitActivity`, `encodeGpx` or `encodeTcx`.
 * The bytes a platform sees are this package's own output, which is the only
 * thing the criterion is about.
 *
 * ## What is expected to fail, and why that is the point
 *
 * `indoor-no-position.gpx` is a GPX 1.1 document whose track has **no
 * trackpoints**, because GPX has no way to express a sample without a position.
 * It is generated anyway, and deliberately: it is precisely the shape #138 says
 * naive importers reject, and a rejection is a *finding* to record in
 * `packages/fit/README.md` §7's lossy-channel table, not a bug in this
 * generator. Producing five files and quietly skipping the sixth would be
 * answering the question by not asking it.
 */

import type { UnixSeconds } from '@onyourleft/domain';

import type { FitActivity, FitDateTime } from '../../src/decode';
import { decodeFitActivity } from '../../src/decode';
import { encodeFitActivity } from '../../src/encode';
import { encodeGpx, encodeTcx, type TrackActivity, type TrackPoint } from '../../src/xml';

/** The two corpus fixtures the six files are built from. */
export const SOURCE_FIXTURES = {
  outdoor: 'nominal-outdoor-ride.fit',
  indoor: 'indoor-trainer-no-position.fit',
} as const;

/** One file to upload, and what a person is meant to learn from it. */
export interface UploadFile {
  readonly name: string;
  readonly bytes: Uint8Array;
  /** What each platform is being asked about this one. One sentence. */
  readonly asks: string;
}

/**
 * A FIT `date_time` as an absolute instant, or nothing.
 *
 * ⚠️ **A `systemTime` becomes `undefined`, and must.** `FitDateTime` is a union
 * because a `date_time` at or below `FIT_SYSTEM_TIME_MAX` is seconds since the
 * device powered on rather than an instant, and neither GPX nor TCX can express
 * anything but an absolute one (`xml/track.ts`). Adding the FIT epoch to a
 * power-on counter would write a 1989 timestamp into a file somebody uploads —
 * which is exactly what `timestamp-epoch-boundary.fit` exists to catch, one
 * layer down.
 */
function instantOf(timestamp: FitDateTime | undefined): UnixSeconds | undefined {
  return timestamp?.kind === 'instant' ? timestamp.instant : undefined;
}

/**
 * A decoded FIT activity as GPX and TCX can carry it.
 *
 * ⚠️ **Lossy, and the losses are the ones `README.md` §7 already tabulates** —
 * developer fields, events, device info and the session summary have nowhere to
 * go in either XML format. This function is not the place to invent somewhere:
 * a generator that synthesised a `<Lap>` total the FIT file did not state would
 * be uploading a number nothing measured.
 */
export function trackActivityOf(activity: FitActivity, name: string): TrackActivity {
  const points: TrackPoint[] = activity.records.map((record) => ({
    timestamp: instantOf(record.timestamp),
    position: record.position,
    altitude: record.altitude,
    distance: record.distance,
    speed: record.speed,
    heartRate: record.heartRate,
    cadence: record.cadence,
    power: record.power,
    temperature: record.temperature,
  }));
  const firstLap = activity.laps[0];
  return {
    startTime: instantOf(activity.sessions[0]?.startTime ?? firstLap?.startTime),
    name,
    sport: 'cycling',
    creator: undefined,
    laps: [
      {
        startTime: instantOf(firstLap?.startTime),
        totalElapsedTime: firstLap?.totalElapsedTime,
        totalDistance: firstLap?.totalDistance,
        points,
      },
    ],
  };
}

/** The bytes of the two source fixtures, keyed by their corpus file name. */
export type FixtureBytes = (name: string) => Uint8Array;

const TEXT = new TextEncoder();

/**
 * Build all six files.
 *
 * Pure but for the callback that hands it the fixture bytes, so the whole thing
 * is exercised by `uploads.test.ts` against the committed corpus with nothing
 * written to disk.
 */
export function buildUploadFiles(read: FixtureBytes): readonly UploadFile[] {
  const files: UploadFile[] = [];

  for (const [kind, fixture] of Object.entries(SOURCE_FIXTURES)) {
    const decoded = decodeFitActivity(read(fixture));
    const indoor = kind === 'indoor';
    const track = trackActivityOf(
      decoded.activity,
      indoor ? 'On Your Left indoor validation ride' : 'On Your Left outdoor validation ride',
    );
    const stem = indoor ? 'indoor-no-position' : 'outdoor-ride';
    const where = indoor
      ? 'an indoor ride with no position at all'
      : 'an outdoor ride with position, power, cadence and heart rate';

    files.push({
      name: `${stem}.fit`,
      bytes: encodeFitActivity(decoded.activity).bytes,
      asks: `Does the platform accept FIT for ${where}, with distance, elapsed and moving time, and every channel present?`,
    });
    files.push({
      name: `${stem}.tcx`,
      bytes: TEXT.encode(encodeTcx(track)),
      asks: `Does the platform accept TCX for ${where}? TCX carries power only in an extension, so watch whether power survives.`,
    });
    files.push({
      name: `${stem}.gpx`,
      bytes: TEXT.encode(encodeGpx(track)),
      asks: indoor
        ? 'Does the platform accept a GPX track with NO trackpoints? A rejection here is a finding for README §7, not a bug.'
        : `Does the platform accept GPX for ${where}? Heart rate, cadence and power all ride in extensions.`,
    });
  }

  return files;
}
