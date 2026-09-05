// SPDX-License-Identifier: Apache-2.0

/**
 * GPX 1.1 import and export.
 *
 * The committed corpus fixtures are asserted in
 * `tools/fixture-corpus/xml-corpus.test.ts`. This file is the unit-level half:
 * round trips, the extension recovery #32 names as the defining failure, and
 * the channels the format cannot carry.
 */

import { unixSeconds } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { ActivityXmlError } from './errors';
import {
  GPX_POWER_EXTENSION_V1,
  GPX_TRACK_POINT_EXTENSION_V1,
  GPX_TRACK_POINT_EXTENSION_V2,
} from './extensions';
import { decodeGpx, encodeGpx, GPX_NAMESPACE, withoutGpxLossyChannels } from './gpx';
import { indoorActivity, RIDE_START_UNIX_SECONDS, sampleActivity, samplePoint } from './testing';
import type { TrackActivity } from './track';
import { trackPointsOf } from './track';

function faultCode(text: string): string {
  try {
    decodeGpx(text);
  } catch (cause) {
    if (cause instanceof ActivityXmlError) return cause.code;
    throw cause;
  }
  throw new Error('the document imported, and it was not supposed to');
}

describe('the round trip', () => {
  it('preserves every channel GPX can represent', () => {
    const original = sampleActivity();
    const { activity, faults } = decodeGpx(encodeGpx(original));

    expect(faults).toEqual([]);
    // The lossy channels are listed in `GPX_LOSSY_CHANNELS` and stripped from
    // *both* sides, so this is an equality rather than a subset check: a
    // channel that silently stopped round-tripping would not be in that list
    // and this would go red.
    expect(activity).toEqual(withoutGpxLossyChannels(original));
  });

  it('survives a second round trip unchanged, so the loss is not cumulative', () => {
    const once = decodeGpx(encodeGpx(sampleActivity())).activity;
    const twice = decodeGpx(encodeGpx(once)).activity;
    expect(twice).toEqual(once);
  });

  it('keeps the absolute instant of every point', () => {
    // #32: "A test proves timezone handling: a ride exported and re-imported
    // keeps its absolute instant."
    const original = sampleActivity();
    const reread = decodeGpx(encodeGpx(original)).activity;
    expect(trackPointsOf(reread).map((point) => point.timestamp)).toEqual(
      trackPointsOf(original).map((point) => point.timestamp),
    );
    expect(encodeGpx(original)).toContain('<time>2024-06-15T09:00:00Z</time>');
  });

  it('keeps one lap per segment', () => {
    const original = sampleActivity();
    const reread = decodeGpx(encodeGpx(original)).activity;
    expect(reread.laps).toHaveLength(2);
    expect(reread.laps.map((lap) => lap.points.length)).toEqual([10, 8]);
  });

  it('keeps an indoor ride indoors', () => {
    const reread = decodeGpx(encodeGpx(indoorActivity())).activity;
    for (const point of trackPointsOf(reread)) {
      expect(point.position).toBeUndefined();
      expect(point.power).toBeDefined();
    }
    expect(encodeGpx(indoorActivity())).not.toContain('lat=');
  });

  it('loses exactly the channels GPX has nowhere to put, and no others', () => {
    const original = sampleActivity();
    const reread = decodeGpx(encodeGpx(original)).activity;
    // Named individually rather than by the helper, so the helper cannot be
    // the thing that makes this pass.
    expect(reread.laps[0]?.totalElapsedTime).toBeUndefined();
    expect(reread.laps[0]?.totalDistance).toBeUndefined();
    expect(reread.laps[0]?.points[0]?.distance).toBeUndefined();
    expect(original.laps[0]?.totalElapsedTime).toBeDefined();
    expect(original.laps[0]?.points[0]?.distance).toBeDefined();
  });
});

describe('recovering power and cadence from <extensions>', () => {
  /**
   * #32's first acceptance criterion, and the reason it is first:
   *
   * > A test proves GPX import **recovers power and cadence from
   * > `<extensions>`** for at least the Garmin `TrackPointExtension` namespace.
   * > Losing power on import is the defining failure of a naive GPX importer
   * > and would not be noticed until a user complained.
   */
  const garminV1 = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<gpx version="1.1" creator="Garmin Connect" xmlns="${GPX_NAMESPACE}"`,
    `     xmlns:gpxtpx="${GPX_TRACK_POINT_EXTENSION_V1}"`,
    `     xmlns:gpxpx="${GPX_POWER_EXTENSION_V1}">`,
    '  <trk><trkseg>',
    '    <trkpt lat="-0.0180000" lon="-0.0180000">',
    '      <ele>12.0</ele>',
    '      <time>2024-06-15T09:00:00Z</time>',
    '      <extensions>',
    '        <gpxtpx:TrackPointExtension>',
    '          <gpxtpx:hr>142</gpxtpx:hr>',
    '          <gpxtpx:cad>88</gpxtpx:cad>',
    '          <gpxtpx:atemp>19.5</gpxtpx:atemp>',
    '        </gpxtpx:TrackPointExtension>',
    '        <gpxpx:PowerInWatts>241</gpxpx:PowerInWatts>',
    '      </extensions>',
    '    </trkpt>',
    '  </trkseg></trk>',
    '</gpx>',
  ].join('\n');

  it('reads hr, cad, atemp and power out of the Garmin v1 namespaces', () => {
    const { activity, faults } = decodeGpx(garminV1);
    expect(faults).toEqual([]);
    const [point] = trackPointsOf(activity);
    expect(point?.heartRate).toBe(142);
    expect(point?.cadence).toBe(88);
    expect(point?.power).toBe(241);
    expect(point?.temperature).toBe(19.5);
  });

  it('is not passing because the elements happen to be named hr and cad anywhere', () => {
    // The same document with the <extensions> wrapper removed. The channels are
    // scoped to an extensions subtree deliberately; an importer that matched on
    // local name anywhere would read a <name> element as a channel.
    const withoutWrapper = garminV1
      .replace('      <extensions>\n', '')
      .replace('      </extensions>\n', '');
    const [point] = trackPointsOf(decodeGpx(withoutWrapper).activity);
    expect(point?.heartRate).toBeUndefined();
    expect(point?.power).toBeUndefined();
    // The point itself is still read, so this is not passing because the
    // document stopped parsing.
    expect(point?.position).toBeDefined();
  });

  it('reads the v2 namespace and the long spellings other writers use', () => {
    const other = [
      `<gpx version="1.1" xmlns="${GPX_NAMESPACE}" xmlns:x="${GPX_TRACK_POINT_EXTENSION_V2}">`,
      '  <trk><trkseg><trkpt lat="0.1" lon="0.2"><extensions>',
      '    <x:TrackPointExtension>',
      '      <x:heartrate>150</x:heartrate>',
      '      <x:cadence>90</x:cadence>',
      '      <x:speed>9.25</x:speed>',
      '    </x:TrackPointExtension>',
      '    <power>300</power>',
      '    <distance>1234.5</distance>',
      '  </extensions></trkpt></trkseg></trk>',
      '</gpx>',
    ].join('\n');
    const [point] = trackPointsOf(decodeGpx(other).activity);
    expect(point?.heartRate).toBe(150);
    expect(point?.cadence).toBe(90);
    expect(point?.speed).toBe(9.25);
    expect(point?.power).toBe(300);
    expect(point?.distance).toBe(1234.5);
  });

  it('writes power where a reader that reads GPX power at all looks for it', () => {
    const written = encodeGpx({
      startTime: undefined,
      name: undefined,
      sport: undefined,
      creator: undefined,
      laps: [
        {
          startTime: undefined,
          totalElapsedTime: undefined,
          totalDistance: undefined,
          points: [samplePoint(0)],
        },
      ],
    });
    expect(written).toContain(`xmlns:gpxpx="${GPX_POWER_EXTENSION_V1}"`);
    expect(written).toContain(`xmlns:gpxtpx="${GPX_TRACK_POINT_EXTENSION_V2}"`);
    expect(written).toContain('<gpxpx:PowerInWatts>165</gpxpx:PowerInWatts>');
    expect(written).toContain('<gpxtpx:hr>118</gpxtpx:hr>');
    expect(written).toContain('<gpxtpx:cad>76</gpxtpx:cad>');
  });
});

describe('a document that is not a GPX file', () => {
  it('is rejected by its root element rather than parsed for whatever it has', () => {
    expect(faultCode('<TrainingCenterDatabase/>')).toBe('wrong-root-element');
    expect(faultCode('<html><body/></html>')).toBe('wrong-root-element');
  });

  it('is rejected when truncated, rather than importing short and silently', () => {
    // #32: "A test proves a truncated XML file produces a structured error, not
    // a partial silent success."
    const full = encodeGpx(sampleActivity());
    expect(faultCode(full.slice(0, Math.floor(full.length * 0.6)))).toBe('unexpected-end');
  });
});

describe('a value inside a readable document', () => {
  const withBadPoint = (child: string): string =>
    [
      `<gpx version="1.1" xmlns="${GPX_NAMESPACE}">`,
      '  <trk><trkseg>',
      '    <trkpt lat="0.1" lon="0.2"><time>2024-06-15T09:00:00Z</time></trkpt>',
      `    ${child}`,
      '  </trkseg></trk>',
      '</gpx>',
    ].join('\n');

  it('is dropped with a fault, and the rest of the ride survives', () => {
    const { activity, faults } = decodeGpx(
      withBadPoint('<trkpt lat="not-a-number" lon="0.2"><ele>12.0</ele></trkpt>'),
    );
    expect(faults.map((fault) => fault.code)).toEqual(['invalid-value']);
    expect(trackPointsOf(activity)).toHaveLength(2);
    expect(trackPointsOf(activity)[0]?.position).toBeDefined();
    expect(trackPointsOf(activity)[1]?.position).toBeUndefined();
    expect(trackPointsOf(activity)[1]?.altitude).toBe(12);
  });

  it('drops a half position rather than pairing the survivor with a zero', () => {
    const { activity, faults } = decodeGpx(withBadPoint('<trkpt lat="0.3"/>'));
    expect(faults.map((fault) => fault.code)).toEqual(['invalid-value']);
    expect(trackPointsOf(activity)[1]?.position).toBeUndefined();
  });

  it('drops a timestamp with no zone rather than guessing one', () => {
    const { activity, faults } = decodeGpx(
      withBadPoint('<trkpt lat="0.3" lon="0.4"><time>2024-06-15T09:00:01</time></trkpt>'),
    );
    expect(faults.map((fault) => fault.code)).toEqual(['invalid-timestamp']);
    expect(trackPointsOf(activity)[1]?.timestamp).toBeUndefined();
    expect(trackPointsOf(activity)[1]?.position).toBeDefined();
  });

  it('drops a value @onyourleft/domain rejects, and keeps the rest of the point', () => {
    // -5 bpm is a number, so `finiteNumber` accepts it; `beatsPerMinute`
    // rejects a negative rate. The two rejections are different code paths and
    // both have to end as a collected fault rather than as a throw out of the
    // importer.
    const { activity, faults } = decodeGpx(
      withBadPoint(
        '<trkpt lat="0.3" lon="0.4"><extensions><gpxtpx:hr xmlns:gpxtpx="urn:x">-5</gpxtpx:hr>' +
          '<cad>90</cad></extensions></trkpt>',
      ),
    );
    expect(faults.map((fault) => fault.code)).toEqual(['invalid-value']);
    expect(trackPointsOf(activity)[1]?.heartRate).toBeUndefined();
    expect(trackPointsOf(activity)[1]?.cadence).toBe(90);
    expect(trackPointsOf(activity)[1]?.position).toBeDefined();
  });

  it('never puts the offending value in the fault message', () => {
    const { faults } = decodeGpx(withBadPoint('<trkpt lat="51.5074" lon="-0.1278x"/>'));
    expect(faults).toHaveLength(1);
    expect(faults[0]?.message).not.toContain('51.5074');
    expect(faults[0]?.message).not.toContain('0.1278');
  });
});

describe('writing', () => {
  it('escapes a name that would otherwise change the document’s shape', () => {
    const written = encodeGpx({
      ...sampleActivity(),
      name: 'Ride & <b>hills</b>',
      laps: [],
    });
    expect(written).toContain('<name>Ride &amp; &lt;b&gt;hills&lt;/b&gt;</name>');
    expect(decodeGpx(written).activity.name).toBe('Ride & <b>hills</b>');
  });

  it('writes a coordinate at a fixed width with no signed zero', () => {
    const written = encodeGpx({
      startTime: undefined,
      name: undefined,
      sport: undefined,
      creator: undefined,
      laps: [
        {
          startTime: undefined,
          totalElapsedTime: undefined,
          totalDistance: undefined,
          points: [{ ...samplePoint(0), position: { latitude: -1e-9, longitude: 0.1 } as never }],
        },
      ],
    });
    expect(written).toContain('lat="0.0000000"');
    expect(written).not.toContain('lat="-0.0000000"');
    expect(written).toContain('lon="0.1000000"');
  });

  it('names this project as the creator when the activity names nobody', () => {
    const written = encodeGpx({
      startTime: unixSeconds(1_718_442_000),
      name: undefined,
      sport: undefined,
      creator: undefined,
      laps: [],
    });
    expect(written).toContain('creator="On Your Left"');
    expect(written).toContain(`xmlns="${GPX_NAMESPACE}"`);
    expect(written).toContain('version="1.1"');
  });
});

/**
 * The start times the fixture cannot disagree with the exporter about.
 *
 * `sampleActivity()` sets the activity's start and each lap's start to exactly
 * the value the exporter would derive if they were absent, so it agrees with a
 * normaliser that derives nothing — and every round trip stayed green while
 * `withoutGpxLossyChannels` said a lap's own `startTime` survives, which in GPX
 * it never does.
 */
describe('start times GPX derives rather than carries', () => {
  /** The same ride, with the two starts moved off the values GPX would derive. */
  function displacedStarts(): TrackActivity {
    const activity = sampleActivity();
    return {
      ...activity,
      startTime: undefined,
      laps: activity.laps.map((lap) => ({
        // A minute before the lap's first point. GPX has no element for it, so
        // this is the value that cannot come back.
        startTime: unixSeconds((lap.points[0]?.timestamp ?? 0) - 60),
        totalElapsedTime: lap.totalElapsedTime,
        totalDistance: lap.totalDistance,
        points: lap.points,
      })),
    };
  }

  it('round-trips against the normaliser, which says what the format does', () => {
    const original = displacedStarts();
    const { activity, faults } = decodeGpx(encodeGpx(original));
    expect(faults).toEqual([]);
    expect(activity).toEqual(withoutGpxLossyChannels(original));
  });

  it('gives each lap its first point’s timestamp, not the one it was handed', () => {
    const { activity } = decodeGpx(encodeGpx(displacedStarts()));
    expect(activity.laps.map((lap) => lap.startTime)).toEqual([
      RIDE_START_UNIX_SECONDS,
      RIDE_START_UNIX_SECONDS + 10,
    ]);
  });

  it('writes the first point’s timestamp when the activity has no start of its own', () => {
    const { activity } = decodeGpx(encodeGpx(displacedStarts()));
    expect(activity.startTime).toBe(RIDE_START_UNIX_SECONDS);
  });
});
