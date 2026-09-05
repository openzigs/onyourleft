// SPDX-License-Identifier: Apache-2.0

/**
 * #31's acceptance criterion that this project cannot satisfy by itself.
 *
 * > An encoded file is **accepted by at least one independent third-party FIT
 * > reader**, with the tool named and evidence — screenshot or log — in the PR.
 * > Self-consistency between our own encoder and our own decoder proves only
 * > that they share assumptions.
 *
 * ## The reader, and why this one
 *
 * **`fit-file-parser` 5.0.2 (MIT)**, an exact pin in `packages/fit`'s
 * `devDependencies`. It is never shipped and never imported from `src/`.
 *
 * #31's revision block rules on this directly. The struck criterion was
 * *"validating with the SDK's own checker rather than our own"*, struck under
 * **ADR 0006 R1** — obtaining and running `FitCSVTool` makes the operator a
 * Licensee, which re-attaches Garmin's §2 to someone then contributing to an
 * Apache-2.0 package. The permitted replacement it names is *"an independent
 * non-Garmin decoder, as a test-time devDependency that is never shipped.
 * `fit-file-parser` (MIT) and `dtcooper/python-fitparse` (MIT) both qualify."*
 * The former is chosen because this is a JavaScript workspace and a Python
 * dependency would be a second toolchain in CI for one assertion.
 *
 * That is **consistent with ADR 0006 rejecting option (b)** rather than in
 * tension with it: (b) was rejected for putting SDK-derived material into a
 * *distributed* artefact, and a devDependency is neither distributed nor
 * linked. It is severable in one line.
 *
 * **No Garmin FIT SDK, `Profile.xlsx`, `fit-sdk-tools` artefact, `FitCSVTool`,
 * `Fitgen` or `ActivityRepairTool` was consulted, downloaded, installed or read
 * in the course of this work, and `@garmin/fitsdk` is in no dependency block of
 * this repository or its lockfile** (R1, R4).
 *
 * ## What is asserted, and why it is not "it did not throw"
 *
 * A reader that silently returns an empty activity has "accepted" a file in the
 * least useful sense there is, and it is exactly what a wrong `dataSize` or a
 * wrong CRC produces in a lenient reader. So the assertions are on the
 * **values** the third party recovered: the record count, and every channel of
 * the first and last record, compared against the same channels read back
 * through this project's decoder. The two readers were written from the same
 * public protocol documentation and from nothing else in common.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import FitParser from 'fit-file-parser';
import { describe, expect, it } from 'vitest';

import { decodeFitActivity } from '../../src/decode';
import { encodeFitActivity } from '../../src/encode';
import { CORPUS_DIRECTORY } from './corpus-files';

interface ThirdPartyRecord {
  readonly timestamp?: Date;
  readonly position_lat?: number;
  readonly position_long?: number;
  readonly altitude?: number;
  readonly distance?: number;
  readonly speed?: number;
  readonly heart_rate?: number;
  readonly cadence?: number;
  readonly power?: number;
  readonly temperature?: number;
}

interface ThirdPartyResult {
  readonly error: string | undefined;
  readonly records: readonly ThirdPartyRecord[];
  readonly sessions: readonly Record<string, unknown>[];
  readonly laps: readonly Record<string, unknown>[];
  readonly fileIds: readonly Record<string, unknown>[];
}

/**
 * Read bytes with `fit-file-parser`.
 *
 * `force: false` is deliberate: it makes the library stop on a malformed file
 * rather than salvaging what it can, which is the difference between "the
 * reader accepted this" and "the reader survived this". `mode: 'list'` gives
 * flat arrays rather than a nested activity/session/lap/record tree.
 */
function readWithThirdParty(bytes: Uint8Array): ThirdPartyResult {
  const parser = new FitParser({
    force: false,
    speedUnit: 'm/s',
    lengthUnit: 'm',
    temperatureUnit: 'celsius',
    mode: 'list',
  });
  let result: ThirdPartyResult | undefined;
  // The library's `parse` is synchronous and calls back before it returns; the
  // callback shape is its API, not an asynchronous one.
  parser.parse(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    (error, data) => {
      result = {
        error,
        records: data.records ?? [],
        sessions: data.sessions ?? [],
        laps: data.laps ?? [],
        fileIds: data.file_ids ?? [],
      };
    },
  );
  if (!result) throw new Error('fit-file-parser did not call its callback');
  return result;
}

function fixture(name: string): Uint8Array {
  return Uint8Array.from(readFileSync(join(CORPUS_DIRECTORY, name)));
}

/** Encode the activity a committed fixture decodes to. */
function reencoded(name: string): Uint8Array {
  const { activity } = decodeFitActivity(fixture(name));
  const { bytes, faults } = encodeFitActivity(activity);
  expect(faults).toEqual([]);
  return bytes;
}

/**
 * The fixtures put through the third party in both forms.
 *
 * `header-only.fit`, `zero-length.fit` and `truncated-mid-record.fit` are
 * excluded: the first two carry no activity and the third is deliberately
 * corrupt, so "does an independent reader agree about it" is not a question
 * about this encoder.
 */
const DIFFERENTIAL_FIXTURES = [
  'nominal-outdoor-ride.fit',
  'indoor-trainer-no-position.fit',
  'paused-laps.fit',
  'sensor-dropout-30s.fit',
  'antimeridian-crossing.fit',
  'point-nemo-southern-western.fit',
  'developer-fields.fit',
  'heart-rate-16-bit.fit',
] as const;

describe('fit-file-parser 5.0.2 cannot tell a re-encode from the file it came from', () => {
  it.each(DIFFERENTIAL_FIXTURES)('%s', (name) => {
    const before = readWithThirdParty(fixture(name));
    const after = readWithThirdParty(reencoded(name));

    expect(after.error).toBeUndefined();
    expect(before.error).toBeUndefined();
    // Not "it parsed" — every value it recovered, from both files, compared.
    // A wrong data size, a wrong CRC or a wrong definition ordering all produce
    // a lenient reader returning less than it did from the original, and this
    // is what sees that.
    expect(after.records).toEqual(before.records);
    expect(after.laps).toEqual(before.laps);
    expect(after.sessions).toEqual(before.sessions);
    expect(after.records.length).toBeGreaterThan(0);
  });
});

describe('fit-file-parser 5.0.2 reading this encoder’s output', () => {
  it('reads an outdoor ride, channel for channel', () => {
    const bytes = reencoded('nominal-outdoor-ride.fit');
    const third = readWithThirdParty(bytes);
    const ours = decodeFitActivity(bytes).activity;

    expect(third.error).toBeUndefined();
    expect(third.records).toHaveLength(ours.records.length);
    expect(third.records).toHaveLength(120);
    expect(third.sessions).toHaveLength(1);
    expect(third.laps).toHaveLength(1);
    expect(third.fileIds).toHaveLength(1);

    for (const index of [0, 59, 119]) {
      const theirs = third.records[index];
      const mine = ours.records[index];
      expect(theirs).toBeDefined();
      expect(mine).toBeDefined();
      if (!theirs || !mine) continue;

      expect(theirs.heart_rate).toBe(mine.heartRate);
      expect(theirs.cadence).toBe(mine.cadence);
      expect(theirs.power).toBe(mine.power);
      expect(theirs.temperature).toBe(mine.temperature);
      expect(theirs.distance).toBeCloseTo(mine.distance ?? Number.NaN, 6);
      expect(theirs.speed).toBeCloseTo(mine.speed ?? Number.NaN, 6);
      expect(theirs.altitude).toBeCloseTo(mine.altitude ?? Number.NaN, 6);
      expect(theirs.position_lat).toBeCloseTo(mine.position?.latitude ?? Number.NaN, 6);
      expect(theirs.position_long).toBeCloseTo(mine.position?.longitude ?? Number.NaN, 6);
      expect(theirs.timestamp?.getTime()).toBe(
        (mine.timestamp?.kind === 'instant' ? mine.timestamp.instant : Number.NaN) * 1000,
      );
    }
  });

  it('reads an indoor ride as an indoor ride — no position, no zeroed coordinates', () => {
    // #31: "A test proves an activity with no GPS encodes to a valid file that a
    // third-party reader accepts as an indoor ride." The failure this guards
    // against is not rejection, it is acceptance with a position channel of
    // zeros, which puts the ride in the Gulf of Guinea.
    const third = readWithThirdParty(reencoded('indoor-trainer-no-position.fit'));

    expect(third.error).toBeUndefined();
    expect(third.records).toHaveLength(120);
    expect(third.sessions).toHaveLength(1);
    for (const record of third.records) {
      expect(record.position_lat).toBeUndefined();
      expect(record.position_long).toBeUndefined();
      expect(record.power).toBeGreaterThan(0);
    }
  });

  it('reads a sensor dropout as a dropout rather than as zeroes', () => {
    const third = readWithThirdParty(reencoded('sensor-dropout-30s.fit'));

    expect(third.error).toBeUndefined();
    const missing = third.records.filter((record) => record.heart_rate === undefined);
    expect(missing).toHaveLength(30);
    expect(third.records.filter((record) => record.heart_rate === 0)).toHaveLength(0);
    expect(third.records.filter((record) => record.power === 0)).toHaveLength(0);
  });

  it('reads a southern, western ride in the right hemisphere', () => {
    const third = readWithThirdParty(reencoded('point-nemo-southern-western.fit'));

    expect(third.error).toBeUndefined();
    expect(third.records.length).toBeGreaterThan(0);
    for (const record of third.records) {
      expect(record.position_lat).toBeLessThan(0);
      expect(record.position_long).toBeLessThan(0);
    }
  });

  /**
   * ⚠️ A limitation of the third party, found by running it and recorded rather
   * than worked around.
   *
   * `heart-rate-16-bit.fit` declares `record.heart_rate` as a `uint16` carrying
   * 260–310 bpm, which is legal — a definition message carries each field's size
   * and base type rather than inheriting them from the profile. `fit-file-parser`
   * applies its own profile's one-byte expectation and drops the field, **on the
   * committed fixture as well as on our re-encode**. So this is not a defect in
   * the encoder, and the differential test above is what proves that: the third
   * party reads both files identically.
   *
   * It is pinned here so that a future version of the library which *does* read
   * the field turns into a visible test failure rather than a silent change in
   * what this suite is asserting.
   */
  it('drops a 16-bit heart rate channel — from the original fixture too, not only ours', () => {
    const fromFixture = readWithThirdParty(fixture('heart-rate-16-bit.fit'));
    const fromOurs = readWithThirdParty(reencoded('heart-rate-16-bit.fit'));

    expect(fromFixture.records.every((record) => record.heart_rate === undefined)).toBe(true);
    expect(fromOurs.records.every((record) => record.heart_rate === undefined)).toBe(true);
    // Our own decoder does read it, which is what makes this a limitation of
    // the third party rather than a property of the file.
    const ours = decodeFitActivity(reencoded('heart-rate-16-bit.fit')).activity;
    expect(ours.records.every((record) => (record.heartRate ?? 0) >= 260)).toBe(true);
  });
});
