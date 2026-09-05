// SPDX-License-Identifier: Apache-2.0

/**
 * GPX and TCX read against the **committed** #29 corpus.
 *
 * The security assertions here are the ones #32 calls non-negotiable:
 *
 * > A test proves an XML file with an **external entity declaration** is
 * > rejected without resolving it, and a test proves a **deeply nested entity
 * > expansion** is rejected without exhausting memory. Both must be asserted,
 * > not configured-and-hoped.
 *
 * They read the hostile documents **off disk**, not from the generator's return
 * value, for the reason `decode-corpus.test.ts` gives: what is asserted has to
 * be the artefact that is committed and that CI checks out. A defence tested
 * against a string built in the test file is a defence against that string.
 *
 * Both were watched to fail — the mutations are listed in the pull request.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ActivityXmlError,
  decodeGpx,
  decodeTcx,
  encodeGpx,
  encodeTcx,
  GPX_TRACK_POINT_EXTENSION_V1,
  parseXml,
  trackPointsOf,
} from '../../src/xml';
import { CORPUS_DIRECTORY } from './corpus-files';
import { RIDE_START_UNIX_SECONDS } from './ride';

function fixture(name: string): string {
  return readFileSync(join(CORPUS_DIRECTORY, name), 'utf8');
}

function thrownBy(read: () => unknown): ActivityXmlError {
  try {
    read();
  } catch (cause) {
    if (cause instanceof ActivityXmlError) return cause;
    throw cause;
  }
  throw new Error('the document was accepted, and it was not supposed to be');
}

// ---------------------------------------------------------------------------
// The two attacks, against the committed hostile documents.
// ---------------------------------------------------------------------------

describe('an external entity declaration', () => {
  it.each([
    ['xxe-external-entity.gpx', decodeGpx],
    ['xxe-external-entity.tcx', decodeTcx],
  ] as const)('is refused in %s, without resolving it', (name, read) => {
    const text = fixture(name);
    // The fixture really does carry the payload, so the rejection below is not
    // a rejection of an empty file.
    expect(text).toContain('<!ENTITY xxe SYSTEM "file:///etc/passwd">');
    expect(text).toContain('&xxe;');

    const error = thrownBy(() => read(text));
    expect(error.code).toBe('doctype-forbidden');
    // Nothing about the entity, its target or the document's contents reaches
    // the message. ADR 0004 decision D, and an error message is where a path
    // that was successfully *not* read still gets logged.
    expect(error.message).not.toContain('/etc/passwd');
    expect(error.message).not.toContain('xxe');
  });

  it('is refused by the parser itself, not only by the two importers', () => {
    // The importers are two call sites; the defence is one. If it lived in the
    // importers, the third format to arrive would have to remember it.
    for (const name of ['xxe-external-entity.gpx', 'xxe-external-entity.tcx']) {
      expect(thrownBy(() => parseXml(fixture(name), {})).code).toBe('doctype-forbidden');
    }
  });

  it('would still be refused with its DOCTYPE removed, by the entity rule behind it', () => {
    // The second layer, exercised against the real payload. Strip the DTD and
    // `&xxe;` remains: a parser that resolved document-defined entities but
    // rejected DOCTYPEs would pass the test above and fail this one.
    const withoutDoctype = fixture('xxe-external-entity.gpx').replace(/<!DOCTYPE[\s\S]*?\]>\n/, '');
    expect(withoutDoctype).not.toContain('<!DOCTYPE');
    expect(withoutDoctype).toContain('&xxe;');
    expect(thrownBy(() => decodeGpx(withoutDoctype)).code).toBe('unknown-entity');
  });
});

describe('a nested entity expansion', () => {
  it('is refused without exhausting memory or time', () => {
    const text = fixture('billion-laughs.gpx');
    expect(text).toContain('<!ENTITY lol6 ');
    expect(text).toContain('&lol6;');
    // A million copies of "lol" is three megabytes; the file is under a
    // kilobyte. The time budget is what makes this an assertion about
    // exhaustion rather than about the error code alone.
    expect(text.length).toBeLessThan(1024);

    const started = performance.now();
    const error = thrownBy(() => decodeGpx(text));
    const elapsed = performance.now() - started;

    expect(error.code).toBe('doctype-forbidden');
    expect(elapsed).toBeLessThan(10);
  });
});

describe('a truncated document', () => {
  it('produces a structured error rather than a partial silent success', () => {
    const text = fixture('truncated-mid-trackpoint.gpx');
    expect(text).not.toContain('</gpx>');
    const error = thrownBy(() => decodeGpx(text));
    expect(error.code).toBe('unexpected-end');
    expect(error.characterOffset).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The nominal documents.
// ---------------------------------------------------------------------------

describe('nominal-ride.gpx', () => {
  const { activity, faults } = decodeGpx(fixture('nominal-ride.gpx'));

  it('imports cleanly', () => {
    expect(faults).toEqual([]);
    expect(activity.laps).toHaveLength(1);
    expect(trackPointsOf(activity)).toHaveLength(30);
  });

  it('recovers heart rate and cadence from the Garmin TrackPointExtension', () => {
    // The corpus fixture declares that namespace by URI, so this is the
    // criterion's "for at least the Garmin TrackPointExtension namespace"
    // asserted against a document that really uses it.
    expect(fixture('nominal-ride.gpx')).toContain(GPX_TRACK_POINT_EXTENSION_V1);
    const points = trackPointsOf(activity);
    expect(points.map((point) => point.heartRate)).toEqual(
      Array.from({ length: 30 }, (_, index) => 118 + ((index * 7) % 41)),
    );
    expect(points.map((point) => point.cadence)).toEqual(
      Array.from({ length: 30 }, (_, index) => 76 + ((index * 3) % 19)),
    );
  });

  it('recovers the metadata, the track and the elevation', () => {
    expect(activity.name).toBe('Synthetic fixture ride');
    expect(activity.sport).toBe('cycling');
    expect(activity.creator).toBe('On Your Left synthetic fixture generator');
    expect(activity.startTime).toBe(RIDE_START_UNIX_SECONDS);
    const first = trackPointsOf(activity)[0];
    expect(first?.timestamp).toBe(RIDE_START_UNIX_SECONDS);
    expect(first?.altitude).toBe(12);
    expect(first?.position?.latitude).toBeCloseTo(-0.018, 7);
    expect(first?.position?.longitude).toBeCloseTo(-0.018, 7);
  });

  it('round-trips through this package’s own writer', () => {
    const again = decodeGpx(encodeGpx(activity));
    expect(again.faults).toEqual([]);
    expect(again.activity).toEqual(activity);
  });

  it('crosses to TCX and back keeping every channel both formats hold', () => {
    const viaTcx = decodeTcx(encodeTcx(activity)).activity;
    expect(trackPointsOf(viaTcx).map((point) => point.heartRate)).toEqual(
      trackPointsOf(activity).map((point) => point.heartRate),
    );
    expect(trackPointsOf(viaTcx).map((point) => point.position)).toEqual(
      trackPointsOf(activity).map((point) => point.position),
    );
    expect(trackPointsOf(viaTcx).map((point) => point.timestamp)).toEqual(
      trackPointsOf(activity).map((point) => point.timestamp),
    );
  });
});

describe('point-nemo.gpx', () => {
  it('lands in the right hemisphere, and stays there through a round trip', () => {
    const { activity, faults } = decodeGpx(fixture('point-nemo.gpx'));
    expect(faults).toEqual([]);
    const points = trackPointsOf(activity);
    expect(points).toHaveLength(20);
    for (const point of points) {
      expect(point.position?.latitude).toBeLessThan(0);
      expect(point.position?.longitude).toBeLessThan(0);
    }
    const again = decodeGpx(encodeGpx(activity)).activity;
    expect(trackPointsOf(again).map((point) => point.position)).toEqual(
      points.map((point) => point.position),
    );
  });
});

describe('nominal-ride.tcx', () => {
  const { activity, faults } = decodeTcx(fixture('nominal-ride.tcx'));

  it('imports cleanly, with the lap and its totals', () => {
    expect(faults).toEqual([]);
    expect(activity.sport).toBe('Biking');
    expect(activity.startTime).toBe(RIDE_START_UNIX_SECONDS);
    expect(activity.laps).toHaveLength(1);
    expect(activity.laps[0]?.totalElapsedTime).toBe(29);
    expect(trackPointsOf(activity)).toHaveLength(30);
  });

  it('recovers power from the ActivityExtension TPX, and the rest from the elements', () => {
    const points = trackPointsOf(activity);
    expect(points.map((point) => point.power)).toEqual(
      Array.from({ length: 30 }, (_, index) => 165 + ((index * 11) % 97)),
    );
    expect(points.map((point) => point.heartRate)).toEqual(
      Array.from({ length: 30 }, (_, index) => 118 + ((index * 7) % 41)),
    );
    expect(points.map((point) => point.cadence)).toEqual(
      Array.from({ length: 30 }, (_, index) => 76 + ((index * 3) % 19)),
    );
    expect(points[0]?.altitude).toBe(12);
    expect(points[1]?.distance).toBe(10);
  });

  it('round-trips through this package’s own writer', () => {
    const again = decodeTcx(encodeTcx(activity));
    expect(again.faults).toEqual([]);
    expect(again.activity).toEqual(activity);
  });
});

describe('indoor-no-position.tcx', () => {
  it('has no position on any point, and every other channel on all of them', () => {
    const { activity, faults } = decodeTcx(fixture('indoor-no-position.tcx'));
    expect(faults).toEqual([]);
    const points = trackPointsOf(activity);
    expect(points).toHaveLength(30);
    for (const point of points) {
      expect(point.position).toBeUndefined();
      expect(point.altitude).toBeUndefined();
      expect(point.power).toBeDefined();
      expect(point.heartRate).toBeDefined();
      expect(point.cadence).toBeDefined();
    }
    // And the export of it puts no coordinate back.
    expect(encodeTcx(activity)).not.toContain('<Position>');
    expect(encodeGpx(activity)).not.toContain('lat=');
  });
});
