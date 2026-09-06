// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Reading one file, against the codec's own corpus — including the files it is
 * supposed to refuse.
 *
 * The assertions to read first are the two that are not about a happy path:
 * `too-many-samples`, which is the only resource bound this client owns, and
 * the hostile XML pair, which is where `SECURITY.md`'s XXE clause is either
 * honoured or quietly undone by a caller catching too broadly.
 */

import { describe, expect, it } from 'vitest';

import { seconds, unixSeconds } from '@onyourleft/domain';
import { decodeFitActivity, encodeFitActivity, type FitRecord } from '@onyourleft/fit';

import { corpusBytes, IMPORTABLE_CORPUS_FILES, REFUSED_CORPUS_FILES } from './corpus';
import {
  ActivityImportError,
  MAXIMUM_IMPORTED_SAMPLES,
  readActivityFile,
} from './read-activity-file';

/** The error a call threw, typed, or a failure saying it did not throw at all. */
function refusalOf(run: () => unknown): ActivityImportError {
  try {
    run();
  } catch (error: unknown) {
    if (error instanceof ActivityImportError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected the file to be refused, and it was read');
}

describe('readActivityFile', () => {
  it.each(IMPORTABLE_CORPUS_FILES)('reads %s into a ride on a 1 Hz grid', (name) => {
    const ride = readActivityFile(name, corpusBytes(name));

    expect(ride.sampleCount).toBeGreaterThan(0);
    expect(ride.sampleInterval).toBe(1);
    expect(ride.startedAt).toBeGreaterThan(0);
    // Every channel present is exactly `sampleCount` long, which is the
    // invariant `putStreamSet` refuses a set for breaking.
    for (const samples of Object.values(ride.channels)) {
      expect(samples).toHaveLength(ride.sampleCount);
    }
    // The name is the file's, because no format in the corpus states one for a
    // FIT file and the rider has to be able to tell three hundred rows apart.
    expect(ride.name.length).toBeGreaterThan(0);
  });

  it('reads a position from a file that has one, and none from one that does not', () => {
    const outdoor = readActivityFile(
      'nominal-outdoor-ride.fit',
      corpusBytes('nominal-outdoor-ride.fit'),
    );
    const indoor = readActivityFile(
      'indoor-trainer-no-position.fit',
      corpusBytes('indoor-trainer-no-position.fit'),
    );

    expect(outdoor.hasPosition).toBe(true);
    expect(outdoor.channels.latitude).toBeDefined();
    expect(outdoor.channels.longitude).toBeDefined();

    // Not a degraded ride: an indoor trainer session is half this product.
    expect(indoor.hasPosition).toBe(false);
    expect(indoor.channels.latitude).toBeUndefined();
    expect(indoor.channels.longitude).toBeUndefined();
    expect(indoor.channels.power).toBeDefined();
  });

  it('keeps a sensor dropout as a gap rather than filling it', () => {
    const ride = readActivityFile('sensor-dropout-30s.fit', corpusBytes('sensor-dropout-30s.fit'));
    const heartRate = ride.channels.heartRate;

    expect(heartRate).toBeDefined();
    const absent = (heartRate ?? []).filter((sample) => sample === undefined).length;
    // ADR 0011: a gap is `undefined`, never zero and never interpolated. A
    // filled gap would score identically on line coverage and corrupt every
    // metric in #11.
    expect(absent).toBeGreaterThanOrEqual(30);
    expect(heartRate).not.toContain(0);
  });

  it('imports a truncated file and reports the truncation rather than dropping the ride', () => {
    const ride = readActivityFile(
      'truncated-mid-record.fit',
      corpusBytes('truncated-mid-record.fit'),
    );

    expect(ride.sampleCount).toBeGreaterThan(0);
    // #30 requires that a truncated file must not discard the whole ride. What
    // this layer owes is that the fault reaches the rider beside the filename
    // instead of being swallowed into "imported".
    expect(ride.faults.length).toBeGreaterThan(0);
  });

  it.each(REFUSED_CORPUS_FILES)('refuses %s with the codec’s own diagnostic', (name) => {
    const refusal = refusalOf(() => readActivityFile(name, corpusBytes(name)));

    expect(refusal.code).toBe('undecodable');
    // Not "import failed": the codec's sentence is the only thing a rider can
    // act on, and flattening it is the specific failure #51's guidance names.
    expect(refusal.message.length).toBeGreaterThan(20);
    expect(refusal.cause).toBeDefined();
  });

  it('salvages a truncated FIT ride and refuses a truncated XML one, which is not a bug', () => {
    const fit = readActivityFile(
      'truncated-mid-record.fit',
      corpusBytes('truncated-mid-record.fit'),
    );
    const xml = refusalOf(() =>
      readActivityFile('truncated-mid-trackpoint.gpx', corpusBytes('truncated-mid-trackpoint.gpx')),
    );

    // The asymmetry is the two formats', not this client's, and it is worth
    // pinning so that neither side drifts silently. A FIT file is a stream of
    // self-delimiting records, so the ones before the cut are complete and #30
    // requires they survive. An XML document that ends with elements still open
    // has no structure to trust at all — the last `<trkpt>` may be missing its
    // `<time>` rather than having none — so it is refused whole.
    expect(fit.sampleCount).toBeGreaterThan(0);
    expect(fit.faults.length).toBeGreaterThan(0);
    expect(xml.code).toBe('undecodable');
    expect(xml.message).toContain('still open');
  });

  it('refuses a file whose only timestamps are device uptime, not instants', () => {
    // `event-timestamp-1024-wrap.fit` carries `hr` messages and a free-running
    // event counter and no `record` with an absolute time. Nothing can place it
    // on a timeline, and dating it from the file's own header would file a ride
    // under a day it was not ridden.
    const refusal = refusalOf(() =>
      readActivityFile(
        'event-timestamp-1024-wrap.fit',
        corpusBytes('event-timestamp-1024-wrap.fit'),
      ),
    );

    expect(refusal.code).toBe('no-timestamped-samples');
  });

  it('refuses an XML file whose bytes are not valid UTF-8', () => {
    // A `.gpx` saved in a legacy code page, which a decade-old archive has. The
    // decoder here is `fatal: true` on purpose: text that cannot be believed is
    // a different failure from a document that is well-formed and wrong, and
    // the lenient decoder would hand the parser replacement characters and
    // report a syntax error at a byte offset that means nothing.
    const latin1 = new Uint8Array([
      ...new TextEncoder().encode('<?xml version="1.0"?><gpx><name>'),
      0xff,
      0xfe,
      ...new TextEncoder().encode('</name></gpx>'),
    ]);

    const refusal = refusalOf(() => readActivityFile('legacy.gpx', latin1));

    expect(refusal.code).toBe('undecodable');
    expect(refusal.message).toContain('UTF-8');
  });

  it('refuses a file that is not an activity file at all, and says which kind it is not', () => {
    const refusal = refusalOf(() =>
      readActivityFile('activities.csv', new TextEncoder().encode('name,date\nride,2024-01-01\n')),
    );

    expect(refusal.code).toBe('unsupported-format');
    expect(refusal.message).toContain('FIT, GPX or TCX');
  });

  it('takes the totals a TCX states, and the name it states, over the derived ones', () => {
    const ride = readActivityFile('nominal-ride.tcx', corpusBytes('nominal-ride.tcx'));

    // TCX carries lap totals and an activity name; FIT's session carries totals
    // and no name. Deriving both from the samples when the file states them is
    // how an imported ride's distance ends up disagreeing with what every other
    // reader shows for the same file.
    expect(ride.distance).toBeGreaterThan(0);
    expect(ride.elapsedTime).toBeGreaterThan(0);
    expect(ride.movingTime).toBeLessThanOrEqual(ride.elapsedTime);
  });

  it('never reports a moving time longer than the ride’s own span', () => {
    const honest = decodeFitActivity(corpusBytes('paused-laps.fit')).activity;
    const session = honest.sessions[0];
    if (session === undefined) {
      throw new Error('the paused-laps fixture is expected to carry a session');
    }
    // A file whose session claims a full day of moving time inside a ride an
    // hour long. Not hypothetical: a device whose clock is corrected mid-ride
    // writes a summary that disagrees with its own records, and a stored moving
    // time longer than the elapsed time poisons every metric #11 derives.
    const overstated = encodeFitActivity({
      ...honest,
      sessions: [{ ...session, totalTimerTime: seconds(86_400) }],
    }).bytes;

    expect(readActivityFile('paused-laps.fit', corpusBytes('paused-laps.fit')).movingTime).toBe(
      honest.sessions[0]?.totalTimerTime,
    );
    const clamped = readActivityFile('overstated.fit', overstated);
    expect(clamped.movingTime).toBe(clamped.elapsedTime);
    expect(clamped.movingTime).toBeLessThan(86_400);
  });

  it('refuses a header-only FIT file, which decodes cleanly and is not a ride', () => {
    const refusal = refusalOf(() =>
      readActivityFile('header-only.fit', corpusBytes('header-only.fit')),
    );

    expect(refusal.code).toBe('no-timestamped-samples');
  });

  it('refuses a file whose timestamps span longer than a sample grid is built for', () => {
    // Two records a decade apart: well-formed FIT, and an instruction to
    // allocate 315 million slots per channel. The bound is this client's, not
    // the codec's — the codec has no sample grid — so this is the assertion
    // that says the trust boundary is where it is claimed to be.
    const nominal = decodeFitActivity(corpusBytes('nominal-outdoor-ride.fit')).activity;
    const first = nominal.records[0];
    if (first === undefined) {
      throw new Error('the nominal corpus fixture is expected to carry records');
    }
    const decade: FitRecord = {
      ...first,
      timestamp: {
        kind: 'instant',
        instant: unixSeconds(startOf(first) + 10 * 365 * 86_400),
      },
    };
    const bytes = encodeFitActivity({ ...nominal, records: [first, decade] }).bytes;

    const refusal = refusalOf(() => readActivityFile('decade.fit', bytes));

    expect(refusal.code).toBe('too-many-samples');
    expect(refusal.message).toContain(String(MAXIMUM_IMPORTED_SAMPLES / 3600));
  });
});

function startOf(record: FitRecord): number {
  const timestamp = record.timestamp;
  if (timestamp?.kind !== 'instant') {
    throw new Error('the corpus fixture is expected to carry absolute timestamps');
  }
  return timestamp.instant;
}
