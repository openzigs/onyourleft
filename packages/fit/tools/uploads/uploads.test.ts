// SPDX-License-Identifier: Apache-2.0

/**
 * What #138's six upload files must be true of before anybody uploads one.
 *
 * ⚠️ **This cannot check that a platform accepts them** — that is the whole of
 * what #138 needs a browser and two accounts for, and no test here shortens it.
 * What it checks is everything that would waste that session: a file that is
 * not this package's output, a ride that is not synthetic, a set that is
 * missing the case the exercise exists for.
 *
 * The privacy assertion is the one that matters most and is the one a reviewer
 * should read first. An upload is irreversible — the file is on somebody else's
 * servers, in an account with a name on it, the moment the button is pressed —
 * and ADR 0004 decision G is why the corpus is synthetic in the first place.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { seconds } from '@onyourleft/domain';

import { decodeFitActivity } from '../../src/decode';
import { decodeGpx, decodeTcx, trackPointsOf } from '../../src/xml';
import { isInsideSyntheticTestRegion } from '../../src/synthetic-test-regions';
import { CORPUS_DIRECTORY } from '../fixture-corpus/corpus-files';
import { buildUploadFiles, SOURCE_FIXTURES, trackActivityOf } from './uploads';

const read = (name: string): Uint8Array =>
  Uint8Array.from(readFileSync(join(CORPUS_DIRECTORY, name)));

const files = buildUploadFiles(read);
const named = (name: string): Uint8Array => {
  const found = files.find((file) => file.name === name);
  if (found === undefined) {
    throw new Error(`no upload file named ${name}`);
  }
  return found.bytes;
};

const TEXT = new TextDecoder();

describe('the set', () => {
  it('is the six files #138 asks for, and no fewer', () => {
    // Both rides in all three formats. Named exactly, because the one that
    // would quietly go missing is the indoor GPX — it is the awkward one, and
    // it is the one the exercise exists for.
    expect(files.map((file) => file.name).sort()).toEqual([
      'indoor-no-position.fit',
      'indoor-no-position.gpx',
      'indoor-no-position.tcx',
      'outdoor-ride.fit',
      'outdoor-ride.gpx',
      'outdoor-ride.tcx',
    ]);
  });

  it('says what each file is asking the platform', () => {
    // A file with no question attached is a file somebody uploads and then
    // cannot say anything about.
    for (const file of files) {
      expect(file.asks.length).toBeGreaterThan(20);
    }
  });

  it('is deterministic, so a second run uploads the same bytes', () => {
    const again = buildUploadFiles(read);
    for (const [index, file] of files.entries()) {
      expect(again[index]?.name).toBe(file.name);
      expect([...(again[index]?.bytes ?? [])]).toEqual([...file.bytes]);
    }
  });
});

describe('nothing here carries a real location', () => {
  it('puts every coordinate inside a synthetic test region, in all three formats', () => {
    // ADR 0004 decision G, enforced at the last point before a file leaves this
    // machine for somebody else's servers. `synthetic-region-guard.test.ts`
    // makes the same claim about the corpus; this one makes it about the
    // artefacts, which is a different set of bytes and the ones that travel.
    const checked = { fit: 0, gpx: 0, tcx: 0 };

    for (const point of trackPointsOf(decodeGpx(TEXT.decode(named('outdoor-ride.gpx'))).activity)) {
      if (point.position === undefined) continue;
      expect(isInsideSyntheticTestRegion(point.position)).toBe(true);
      checked.gpx += 1;
    }
    for (const point of trackPointsOf(decodeTcx(TEXT.decode(named('outdoor-ride.tcx'))).activity)) {
      if (point.position === undefined) continue;
      expect(isInsideSyntheticTestRegion(point.position)).toBe(true);
      checked.tcx += 1;
    }
    for (const record of decodeFitActivity(named('outdoor-ride.fit')).activity.records) {
      if (record.position === undefined) continue;
      expect(isInsideSyntheticTestRegion(record.position)).toBe(true);
      checked.fit += 1;
    }

    // ⚠️ **Per format, not a single total, and that is what makes it fail
    // closed.** A single counter came back green under the mutation that skips
    // both XML walks, because the FIT walk alone kept it above zero — so the
    // guard would have proved that *something* was checked while two of the
    // three files that travel went unlooked-at.
    expect(checked).toEqual({
      fit: expect.any(Number) as number,
      gpx: expect.any(Number) as number,
      tcx: expect.any(Number) as number,
    });
    expect(checked.fit).toBeGreaterThan(0);
    expect(checked.gpx).toBeGreaterThan(0);
    expect(checked.tcx).toBeGreaterThan(0);
    // All three walked the same ride, so they must have found the same number
    // of positions. A format that silently dropped points would show up here.
    expect(checked.gpx).toBe(checked.fit);
    expect(checked.tcx).toBe(checked.fit);
  });

  it('has no coordinate at all in the indoor files', () => {
    for (const record of decodeFitActivity(named('indoor-no-position.fit')).activity.records) {
      expect(record.position).toBeUndefined();
    }
    for (const name of ['indoor-no-position.gpx', 'indoor-no-position.tcx']) {
      const decode = name.endsWith('.gpx') ? decodeGpx : decodeTcx;
      for (const point of trackPointsOf(decode(TEXT.decode(named(name))).activity)) {
        expect(point.position).toBeUndefined();
      }
    }
  });
});

describe('the outdoor ride', () => {
  it('is this package’s own encoder output, not a corpus fixture copied across', () => {
    // #138 says "encode a ride with this package". A fixture forwarded verbatim
    // would test `tools/fixture-corpus`, which is a different program.
    expect([...named('outdoor-ride.fit')]).not.toEqual([...read(SOURCE_FIXTURES.outdoor)]);
    // And it still decodes, so what is being uploaded is a file this project
    // can read back.
    expect(decodeFitActivity(named('outdoor-ride.fit')).faults).toEqual([]);
  });

  it('carries the channels a platform is being asked about', () => {
    const points = trackPointsOf(decodeGpx(TEXT.decode(named('outdoor-ride.gpx'))).activity);
    expect(points.some((point) => point.position !== undefined)).toBe(true);
    expect(points.some((point) => point.power !== undefined)).toBe(true);
    expect(points.some((point) => point.heartRate !== undefined)).toBe(true);
    expect(points.some((point) => point.cadence !== undefined)).toBe(true);
  });
});

describe('a date_time that is not an instant', () => {
  it('becomes no timestamp at all, rather than a 1989 one', () => {
    // ⚠️ **Found by mutation, and neither source fixture reaches it.** Turning
    // a `systemTime` into an instant leaves all eight assertions above green,
    // because `nominal-outdoor-ride.fit` and `indoor-trainer-no-position.fit`
    // both carry absolute timestamps throughout. `timestamp-epoch-boundary.fit`
    // is the fixture that carries the other kind and it is not one of the two,
    // so the branch is exercised here directly instead.
    //
    // A FIT `date_time` at or below `FIT_SYSTEM_TIME_MAX` is seconds since the
    // device powered on. Adding the FIT epoch to it writes a 1989 date into a
    // file somebody uploads to a platform under their own name.
    const track = trackActivityOf(
      {
        header: { protocolVersion: 0, profileVersion: 0, dataSize: 0, headerSize: 12 },
        fileId: undefined,
        deviceInfos: [],
        events: [],
        records: [
          {
            timestamp: { kind: 'systemTime', sinceDeviceStart: seconds(42) },
            position: undefined,
            altitude: undefined,
            distance: undefined,
            speed: undefined,
            heartRate: undefined,
            cadence: undefined,
            power: undefined,
            temperature: undefined,
            developerFields: [],
          },
        ],
        laps: [],
        sessions: [],
        summary: undefined,
      } as unknown as Parameters<typeof trackActivityOf>[0],
      'a ride whose device did not know the time',
    );

    expect(trackPointsOf(track)[0]?.timestamp).toBeUndefined();
  });
});

describe('the indoor ride', () => {
  it('has no position anywhere, which is the case that gets rejected', () => {
    for (const record of decodeFitActivity(named('indoor-no-position.fit')).activity.records) {
      expect(record.position).toBeUndefined();
    }
    for (const point of trackPointsOf(
      decodeTcx(TEXT.decode(named('indoor-no-position.tcx'))).activity,
    )) {
      expect(point.position).toBeUndefined();
    }
  });

  it('writes a GPX trackpoint with no lat or lon, which GPX 1.1 does not permit', () => {
    // ⚠️ **Pinned here as a fact about the file, deliberately, because it is the
    // question the indoor upload exists to answer.** `gpx.ts` writes a
    // `<trkpt>` with no attributes when there is no position — asserted by
    // `gpx.test.ts` §"keeps an indoor ride indoors" — and GPX 1.1's `wptType`
    // declares `lat` and `lon` `use="required"`. So this document is
    // schema-invalid on purpose: the alternatives are writing 0,0, which
    // `xml/track.ts` warns puts the ride in the Gulf of Guinea, or dropping
    // every sample, which yields an empty track.
    //
    // Our own decoder reads it back happily, which is exactly the
    // encoder-and-decoder-wrong-together blind spot CLAUDE.md §5 names — and
    // the reason a *third-party* importer is the only thing that settles it.
    // `docs/validation/0001-trainer-and-sensors.md` §5 says what to do with
    // whichever answer comes back.
    const gpx = TEXT.decode(named('indoor-no-position.gpx'));
    expect(gpx).toContain('<trkpt>');
    expect(gpx).not.toContain('lat=');
    // And it is not empty either — every sample is still there, with its
    // channels, which is what makes the rejection question a real one rather
    // than a question about an empty file.
    expect(trackPointsOf(decodeGpx(gpx).activity).length).toBeGreaterThan(50);
  });
});
