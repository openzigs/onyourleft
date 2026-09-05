// SPDX-License-Identifier: Apache-2.0

/**
 * TCX v2 import and export.
 *
 * The same battery as `gpx.test.ts`, against the same synthetic activity, so a
 * difference between the two files is a difference between the two formats.
 */

import { unixSeconds } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { ActivityXmlError } from './errors';
import { TCX_ACTIVITY_EXTENSION_V2 } from './extensions';
import { decodeGpx, encodeGpx } from './gpx';
import { decodeTcx, encodeTcx, TCX_NAMESPACE, withoutTcxLossyChannels } from './tcx';
import { indoorActivity, RIDE_START_UNIX_SECONDS, sampleActivity } from './testing';
import type { TrackActivity } from './track';
import { trackPointsOf } from './track';

function faultCode(text: string): string {
  try {
    decodeTcx(text);
  } catch (cause) {
    if (cause instanceof ActivityXmlError) return cause.code;
    throw cause;
  }
  throw new Error('the document imported, and it was not supposed to');
}

describe('the round trip', () => {
  it('preserves every channel TCX can represent', () => {
    const original = sampleActivity();
    const { activity, faults } = decodeTcx(encodeTcx(original));
    expect(faults).toEqual([]);
    expect(activity).toEqual(withoutTcxLossyChannels(original));
  });

  it('survives a second round trip unchanged, so the loss is not cumulative', () => {
    const once = decodeTcx(encodeTcx(sampleActivity())).activity;
    const twice = decodeTcx(encodeTcx(once)).activity;
    expect(twice).toEqual(once);
  });

  it('keeps the lap totals GPX has to drop', () => {
    // The reason both formats are implemented rather than one: a lap's totals
    // survive here and cannot survive a GPX export.
    const reread = decodeTcx(encodeTcx(sampleActivity())).activity;
    expect(reread.laps[0]?.totalElapsedTime).toBe(9);
    expect(reread.laps[0]?.totalDistance).toBe(63);
    expect(reread.laps).toHaveLength(2);
  });

  it('keeps per-point distance, which GPX has nowhere to put', () => {
    const reread = decodeTcx(encodeTcx(sampleActivity())).activity;
    expect(trackPointsOf(reread)[1]?.distance).toBe(10);
  });

  it('keeps the absolute instant of every point', () => {
    const original = sampleActivity();
    const reread = decodeTcx(encodeTcx(original)).activity;
    expect(trackPointsOf(reread).map((point) => point.timestamp)).toEqual(
      trackPointsOf(original).map((point) => point.timestamp),
    );
    expect(encodeTcx(original)).toContain('<Time>2024-06-15T09:00:00Z</Time>');
  });

  it('keeps an indoor ride indoors', () => {
    const written = encodeTcx(indoorActivity());
    expect(written).not.toContain('<Position>');
    for (const point of trackPointsOf(decodeTcx(written).activity)) {
      expect(point.position).toBeUndefined();
      expect(point.power).toBeDefined();
      expect(point.heartRate).toBeDefined();
    }
  });

  it('loses exactly temperature and the activity name, and no other channel', () => {
    const original = sampleActivity();
    const reread = decodeTcx(encodeTcx(original)).activity;
    expect(reread.name).toBeUndefined();
    expect(trackPointsOf(reread)[0]?.temperature).toBeUndefined();
    expect(original.name).toBeDefined();
    expect(trackPointsOf(original)[0]?.temperature).toBeDefined();
    // Everything else is there.
    expect(trackPointsOf(reread)[0]?.speed).toBe(trackPointsOf(original)[0]?.speed);
    expect(trackPointsOf(reread)[0]?.altitude).toBe(trackPointsOf(original)[0]?.altitude);
  });
});

describe('crossing between the two formats', () => {
  it('carries a ride from TCX to GPX and back with only each format’s own loss', () => {
    // #74 exports a route to a head unit through these writers rather than a
    // second XML writer in the client, so "one format in, the other out" has to
    // be two calls with nothing in between.
    const original = sampleActivity();
    const viaGpx = decodeGpx(encodeGpx(decodeTcx(encodeTcx(original)).activity)).activity;
    expect(viaGpx.laps).toHaveLength(2);
    expect(trackPointsOf(viaGpx)[0]?.power).toBe(trackPointsOf(original)[0]?.power);
    expect(trackPointsOf(viaGpx)[0]?.heartRate).toBe(trackPointsOf(original)[0]?.heartRate);
    expect(trackPointsOf(viaGpx)[0]?.position).toEqual(trackPointsOf(original)[0]?.position);
    expect(trackPointsOf(viaGpx)[0]?.timestamp).toBe(trackPointsOf(original)[0]?.timestamp);
  });
});

describe('the Sport attribute', () => {
  it.each([
    ['cycling', 'Biking'],
    ['Biking', 'Biking'],
    ['VirtualRide', 'Biking'],
    ['running', 'Running'],
    ['kayaking', 'Other'],
    [undefined, 'Other'],
  ])('maps %s onto the schema value %s', (sport, expected) => {
    // Passing free text through would produce `Sport="cycling"`, which
    // validates against no TCX schema anywhere.
    expect(encodeTcx({ ...sampleActivity(), sport })).toContain(`<Activity Sport="${expected}">`);
  });
});

describe('a document that is not a TCX file', () => {
  it('is rejected by its root element', () => {
    expect(faultCode('<gpx version="1.1"/>')).toBe('wrong-root-element');
  });

  it('is rejected when truncated, rather than importing short and silently', () => {
    const full = encodeTcx(sampleActivity());
    expect(faultCode(full.slice(0, Math.floor(full.length * 0.6)))).toBe('unexpected-end');
  });

  it('is rejected when it carries a DOCTYPE, like every other document', () => {
    expect(faultCode(`<!DOCTYPE TrainingCenterDatabase><TrainingCenterDatabase/>`)).toBe(
      'doctype-forbidden',
    );
  });
});

describe('a value inside a readable document', () => {
  const document = (trackpoint: string): string =>
    [
      `<TrainingCenterDatabase xmlns="${TCX_NAMESPACE}">`,
      '  <Activities><Activity Sport="Biking">',
      '    <Id>2024-06-15T09:00:00Z</Id>',
      '    <Lap StartTime="2024-06-15T09:00:00Z"><Track>',
      '      <Trackpoint><Time>2024-06-15T09:00:00Z</Time></Trackpoint>',
      `      ${trackpoint}`,
      '    </Track></Lap>',
      '  </Activity></Activities>',
      '</TrainingCenterDatabase>',
    ].join('\n');

  it('drops a half Position rather than pairing the survivor with a zero', () => {
    const { activity, faults } = decodeTcx(
      document(
        '<Trackpoint><Position><LatitudeDegrees>0.3</LatitudeDegrees></Position></Trackpoint>',
      ),
    );
    expect(faults.map((fault) => fault.code)).toEqual(['invalid-value']);
    expect(trackPointsOf(activity)[1]?.position).toBeUndefined();
    expect(trackPointsOf(activity)).toHaveLength(2);
  });

  it('reads a heart rate out of its Value child, and not out of any other Value', () => {
    const { activity } = decodeTcx(
      document(
        '<Trackpoint><HeartRateBpm><Value>151</Value></HeartRateBpm>' +
          '<Cadence>91</Cadence></Trackpoint>',
      ),
    );
    expect(trackPointsOf(activity)[1]?.heartRate).toBe(151);
    expect(trackPointsOf(activity)[1]?.cadence).toBe(91);
  });

  it('reads Watts and Speed out of the ActivityExtension TPX', () => {
    const { activity } = decodeTcx(
      document(
        '<Trackpoint><Extensions>' +
          `<TPX xmlns="${TCX_ACTIVITY_EXTENSION_V2}"><Watts>312</Watts><Speed>11.5</Speed></TPX>` +
          '</Extensions></Trackpoint>',
      ),
    );
    expect(trackPointsOf(activity)[1]?.power).toBe(312);
    expect(trackPointsOf(activity)[1]?.speed).toBe(11.5);
  });

  it('tells a Lap DistanceMeters from a Trackpoint DistanceMeters', () => {
    // The same element name means two different things depending on where it
    // is, and a reader that does not track context puts the lap total on the
    // last point.
    const written = encodeTcx(sampleActivity());
    const { activity } = decodeTcx(written);
    expect(activity.laps[0]?.totalDistance).toBe(63);
    expect(activity.laps[0]?.points[0]?.distance).toBe(0);
    expect(activity.laps[0]?.points.at(-1)?.distance).toBe(65);
  });

  it('concatenates the laps of every Activity rather than discarding all but one', () => {
    const two = [
      `<TrainingCenterDatabase xmlns="${TCX_NAMESPACE}">`,
      '  <Activities>',
      '    <Activity Sport="Biking"><Id>2024-06-15T09:00:00Z</Id>',
      '      <Lap StartTime="2024-06-15T09:00:00Z"><Track>',
      '        <Trackpoint><Time>2024-06-15T09:00:00Z</Time></Trackpoint>',
      '      </Track></Lap></Activity>',
      '    <Activity Sport="Biking"><Id>2024-06-15T10:00:00Z</Id>',
      '      <Lap StartTime="2024-06-15T10:00:00Z"><Track>',
      '        <Trackpoint><Time>2024-06-15T10:00:00Z</Time></Trackpoint>',
      '      </Track></Lap></Activity>',
      '  </Activities>',
      '</TrainingCenterDatabase>',
    ].join('\n');
    const { activity } = decodeTcx(two);
    expect(activity.laps).toHaveLength(2);
    expect(activity.startTime).toBe(1_718_442_000);
  });
});

describe('writing', () => {
  it('declares the namespaces a consumer resolves the extensions through', () => {
    const written = encodeTcx(sampleActivity());
    expect(written).toContain(`xmlns="${TCX_NAMESPACE}"`);
    expect(written).toContain(`xmlns:ns3="${TCX_ACTIVITY_EXTENSION_V2}"`);
    expect(written).toContain('<ns3:Watts>165</ns3:Watts>');
  });

  it('names this project as the Creator when the activity names nobody', () => {
    expect(encodeTcx({ ...sampleActivity(), creator: undefined })).toContain(
      '<Name>On Your Left</Name>',
    );
  });
});

/**
 * Where the exporter decides something the input did not say.
 *
 * A normaliser used for a round-trip comparison has to describe **the export
 * the encoder actually performs**, not a tidier one. Three places it did not:
 * `Sport` is a required attribute with three admitted values, so an activity
 * with none is exported as `Other`; `<Id>` and `Lap@StartTime` are derived from
 * the first point when the activity or the lap has no start of its own.
 * `sampleActivity()` sets all three, so none of it was visible.
 */
describe('what TCX supplies when the activity does not', () => {
  function withoutSportOrStart(): TrackActivity {
    const activity = sampleActivity();
    return {
      ...activity,
      sport: undefined,
      startTime: undefined,
      laps: activity.laps.map((lap) => ({ ...lap, startTime: undefined })),
    };
  }

  it('round-trips against the normaliser, which says what the format does', () => {
    const original = withoutSportOrStart();
    const { activity, faults } = decodeTcx(encodeTcx(original));
    expect(faults).toEqual([]);
    expect(activity).toEqual(withoutTcxLossyChannels(original));
  });

  it('exports an activity with no sport as Sport="Other", and reads it back', () => {
    const written = encodeTcx(withoutSportOrStart());
    expect(written).toContain('<Activity Sport="Other">');
    expect(decodeTcx(written).activity.sport).toBe('Other');
  });

  it('derives the activity’s Id and each lap’s StartTime from the first point', () => {
    const { activity } = decodeTcx(encodeTcx(withoutSportOrStart()));
    expect(activity.startTime).toBe(RIDE_START_UNIX_SECONDS);
    expect(activity.laps.map((lap) => lap.startTime)).toEqual([
      RIDE_START_UNIX_SECONDS,
      RIDE_START_UNIX_SECONDS + 10,
    ]);
  });

  it('keeps a lap’s own StartTime when it has one, unlike GPX', () => {
    // The attribute exists in TCX, so the derivation is a fallback rather than
    // an overwrite. This is what stops the normaliser being copied across.
    const activity = sampleActivity();
    const displaced = {
      ...activity,
      laps: activity.laps.map((lap) => ({
        ...lap,
        startTime: unixSeconds((lap.points[0]?.timestamp ?? 0) - 60),
      })),
    };
    const reread = decodeTcx(encodeTcx(displaced)).activity;
    expect(reread.laps.map((lap) => lap.startTime)).toEqual([
      RIDE_START_UNIX_SECONDS - 60,
      RIDE_START_UNIX_SECONDS + 10 - 60,
    ]);
    expect(reread).toEqual(withoutTcxLossyChannels(displaced));
  });
});
