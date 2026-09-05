// SPDX-License-Identifier: Apache-2.0

/**
 * GPX 1.1 — read and written.
 *
 * The targeted schema version is **GPX 1.1**
 * (`http://www.topografix.com/GPX/1/1`), pinned in `packages/fit/README.md` §7
 * as #32 requires. GPX 1.0 documents are read as far as their shape allows —
 * `<trk>/<trkseg>/<trkpt>` is the same in both — but nothing is written at 1.0
 * and no 1.0-only element is implemented.
 *
 * ## What GPX cannot hold, stated once here and tabulated in the README
 *
 * GPX has no lap totals and no native distance element. A ride imported from
 * TCX and exported as GPX keeps its points, its segments and every channel that
 * has an extension; it loses each lap's `totalElapsedTime` and `totalDistance`,
 * because there is nowhere in the format to put them. That is the whole of the
 * lossy list and it is asserted in `gpx.test.ts` rather than only described.
 *
 * ## Reading is an event walk, not a tree
 *
 * See `parse.ts`. A 4-hour ride is 14 400 `<trkpt>` elements and a DOM of one
 * retains every node; this builds `TrackPoint` objects and drops the markup as
 * it goes.
 */

import type { GeographicPosition } from '@onyourleft/domain';
import {
  altitudeMetres,
  beatsPerMinute,
  degreesCelsius,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  metresPerSecond,
  revolutionsPerMinute,
  seconds,
  UnitError,
  watts,
} from '@onyourleft/domain';

import { ActivityXmlError } from './errors';
import {
  extensionChannelOf,
  GPX_POWER_EXTENSION_V1,
  GPX_TRACK_POINT_EXTENSION_V2,
} from './extensions';
import { formatIsoInstant, parseIsoInstant } from './iso-time';
import type { XmlName, XmlStartElement } from './parse';
import { parseXml } from './parse';
import type { TrackActivity, TrackDecodeResult, TrackLap, TrackPoint } from './track';
import { finiteNumber, quantity } from './values';
import { decimal, degrees, integer, XmlWriter } from './write';

/** The GPX 1.1 namespace. The version this package targets. */
export const GPX_NAMESPACE = 'http://www.topografix.com/GPX/1/1';

/** The GPX 1.0 namespace, read but never written. */
export const GPX_1_0_NAMESPACE = 'http://www.topografix.com/GPX/1/0';

/** The `creator` attribute this package writes. */
export const GPX_CREATOR = 'On Your Left';

/** A mutable track point, filled in as the elements of one `<trkpt>` arrive. */
interface PartialPoint {
  timestamp: TrackPoint['timestamp'];
  position: GeographicPosition | undefined;
  altitude: TrackPoint['altitude'];
  distance: TrackPoint['distance'];
  speed: TrackPoint['speed'];
  heartRate: TrackPoint['heartRate'];
  cadence: TrackPoint['cadence'];
  power: TrackPoint['power'];
  temperature: TrackPoint['temperature'];
}

function emptyPoint(): PartialPoint {
  return {
    timestamp: undefined,
    position: undefined,
    altitude: undefined,
    distance: undefined,
    speed: undefined,
    heartRate: undefined,
    cadence: undefined,
    power: undefined,
    temperature: undefined,
  };
}

/**
 * The position a `<trkpt>`'s attributes denote.
 *
 * `lat` and `lon` are labelled at the attribute read, where a reviewer can see
 * which is which — the same rule `packages/domain` states for the FIT decoder
 * and for the same reason: nothing downstream re-labels them, so a transposition
 * here is the one no type can catch.
 */
function positionOf(
  element: XmlStartElement,
  faults: ActivityXmlError[],
): GeographicPosition | undefined {
  const latitude = element.attributes.find((attribute) => attribute.local === 'lat')?.value;
  const longitude = element.attributes.find((attribute) => attribute.local === 'lon')?.value;
  if (latitude === undefined && longitude === undefined) return undefined;
  if (latitude === undefined || longitude === undefined) {
    faults.push(
      new ActivityXmlError(
        'invalid-value',
        element.characterOffset,
        'a trkpt carries one half of a position: a lat with no lon beside it, or the reverse. A ' +
          'position needs both, so it is dropped rather than paired with a zero',
      ),
    );
    return undefined;
  }
  const parsedLatitude = finiteNumber(latitude, 'trkpt@lat', element.characterOffset, faults);
  const parsedLongitude = finiteNumber(longitude, 'trkpt@lon', element.characterOffset, faults);
  if (parsedLatitude === undefined || parsedLongitude === undefined) return undefined;
  try {
    return geographicPosition(degreesLatitude(parsedLatitude), degreesLongitude(parsedLongitude));
  } catch (cause) {
    if (!(cause instanceof UnitError)) throw cause;
    faults.push(
      new ActivityXmlError(
        'invalid-value',
        element.characterOffset,
        'a trkpt position is outside the range a latitude and longitude pair can take; the ' +
          'position is dropped',
      ),
    );
    return undefined;
  }
}

/**
 * Read a GPX 1.1 document.
 *
 * @throws {ActivityXmlError} for a document that is not well-formed, that
 * carries a DOCTYPE, that ends mid-element, or whose root is not `<gpx>`.
 * Everything else — an unreadable coordinate, a timestamp that is not an
 * instant — is a collected fault and the rest of the ride survives.
 */
export function decodeGpx(text: string): TrackDecodeResult {
  const faults: ActivityXmlError[] = [];
  const laps: TrackLap[] = [];

  // A plain stack, popped in place. `path.slice(0, -1)` would allocate a new
  // array on every end tag — about six per track point, so ninety thousand
  // arrays for a four-hour ride. #127's shape at a smaller scale.
  const path: string[] = [];
  let characters = '';
  let point: PartialPoint | undefined;
  let pointOffset = 0;
  let segment: TrackPoint[] | undefined;
  let name: string | undefined;
  let sport: string | undefined;
  let creator: string | undefined;
  let startTime: TrackActivity['startTime'];
  let rootChecked = false;

  const inside = (element: string): boolean => path.includes(element);

  parseXml(text, {
    startElement(element) {
      if (!rootChecked) {
        rootChecked = true;
        if (element.local !== 'gpx') {
          throw new ActivityXmlError(
            'wrong-root-element',
            element.characterOffset,
            'the document’s root element is not <gpx>, so it is not a GPX file',
          );
        }
        creator = element.attributes.find((attribute) => attribute.local === 'creator')?.value;
      }
      path.push(element.local);
      characters = '';

      if (element.local === 'trkseg') segment = [];
      if (element.local === 'trkpt') {
        point = emptyPoint();
        pointOffset = element.characterOffset;
        point.position = positionOf(element, faults);
      }
    },

    text(value) {
      characters += value;
    },

    endElement(element: XmlName) {
      const local = element.local;
      const value = characters;
      characters = '';
      path.pop();

      if (point) {
        if (readPointChild(point, local, value, path, pointOffset, faults)) return;
        if (local === 'trkpt') {
          segment?.push({ ...point });
          point = undefined;
        }
        return;
      }

      if (local === 'trkseg') {
        // A lap per segment; the totals GPX cannot carry stay undefined.
        laps.push({
          startTime: segment?.[0]?.timestamp,
          totalElapsedTime: undefined,
          totalDistance: undefined,
          points: segment ?? [],
        });
        segment = undefined;
        return;
      }
      if (local === 'name' && inside('trk') && name === undefined) name = value.trim();
      if (local === 'type' && inside('trk') && sport === undefined) sport = value.trim();
      if (local === 'time' && inside('metadata') && startTime === undefined) {
        startTime = readInstant(value, 'metadata/time', 0, faults);
      }
    },
  });

  return {
    activity: {
      startTime: startTime ?? laps[0]?.points[0]?.timestamp,
      name: name === '' ? undefined : name,
      sport: sport === '' ? undefined : sport,
      creator: creator === '' ? undefined : creator,
      laps,
    },
    faults,
  };
}

/** True when the element was one of a track point's own children. */
function readPointChild(
  point: PartialPoint,
  local: string,
  value: string,
  path: readonly string[],
  offset: number,
  faults: ActivityXmlError[],
): boolean {
  if (local === 'ele') {
    point.altitude = quantity(value, altitudeMetres, 'trkpt/ele', offset, faults);
    return true;
  }
  if (local === 'time') {
    point.timestamp = readInstant(value, 'trkpt/time', offset, faults);
    return true;
  }

  // Everything else is only a channel when it is inside <extensions>. See
  // `extensions.ts` for why the match is on local name and why the scoping to
  // the extensions subtree is what keeps that from being reckless.
  if (!path.includes('extensions')) return false;
  const channel = extensionChannelOf(local);
  if (channel === undefined) return false;

  switch (channel) {
    case 'heartRate':
      point.heartRate = quantity(value, beatsPerMinute, 'trkpt extension hr', offset, faults);
      return true;
    case 'cadence':
      point.cadence = quantity(value, revolutionsPerMinute, 'trkpt extension cad', offset, faults);
      return true;
    case 'power':
      point.power = quantity(value, watts, 'trkpt extension power', offset, faults);
      return true;
    case 'speed':
      point.speed = quantity(value, metresPerSecond, 'trkpt extension speed', offset, faults);
      return true;
    case 'distance':
      point.distance = quantity(value, metres, 'trkpt extension distance', offset, faults);
      return true;
    case 'temperature':
      point.temperature = quantity(value, degreesCelsius, 'trkpt extension atemp', offset, faults);
      return true;
  }
}

function readInstant(
  value: string,
  what: string,
  offset: number,
  faults: ActivityXmlError[],
): TrackPoint['timestamp'] {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const instant = parseIsoInstant(trimmed);
  if (instant === undefined) {
    faults.push(
      new ActivityXmlError(
        'invalid-timestamp',
        offset,
        `${what} is not an ISO 8601 instant with a zone designator; the timestamp is dropped. ` +
          'A time with no zone would have to be guessed at, and the guess differs for every ' +
          'reader',
      ),
    );
    return undefined;
  }
  return instant;
}

/**
 * Write a GPX 1.1 document.
 *
 * One `<trkseg>` per lap, so a round trip keeps the segmentation. The
 * extensions written are Garmin's `TrackPointExtension` **v2** — the version
 * that carries `speed` alongside `hr`, `cad` and `atemp` — and Garmin's
 * `PowerExtension` for watts, which is where every reader that reads GPX power
 * at all looks for it.
 */
export function encodeGpx(activity: TrackActivity): string {
  const writer = new XmlWriter().declaration();
  writer.open('gpx', [
    ['version', '1.1'],
    ['creator', activity.creator ?? GPX_CREATOR],
    ['xmlns', GPX_NAMESPACE],
    ['xmlns:gpxtpx', GPX_TRACK_POINT_EXTENSION_V2],
    ['xmlns:gpxpx', GPX_POWER_EXTENSION_V1],
  ]);

  const start = activity.startTime ?? activity.laps[0]?.points[0]?.timestamp;
  if (start !== undefined) {
    writer.open('metadata');
    writer.leaf('time', formatIsoInstant(start));
    writer.close('metadata');
  }

  writer.open('trk');
  if (activity.name !== undefined) writer.leaf('name', activity.name);
  if (activity.sport !== undefined) writer.leaf('type', activity.sport);
  for (const lap of activity.laps) {
    writer.open('trkseg');
    for (const point of lap.points) writeTrackPoint(writer, point);
    writer.close('trkseg');
  }
  writer.close('trk');

  writer.close('gpx');
  return writer.finish();
}

function writeTrackPoint(writer: XmlWriter, point: TrackPoint): void {
  const attributes =
    point.position === undefined
      ? []
      : ([
          ['lat', degrees(point.position.latitude)],
          ['lon', degrees(point.position.longitude)],
        ] as const);

  writer.open('trkpt', attributes);
  if (point.altitude !== undefined) writer.leaf('ele', decimal(point.altitude, 1));
  if (point.timestamp !== undefined) writer.leaf('time', formatIsoInstant(point.timestamp));

  const trackPointExtension =
    point.heartRate !== undefined ||
    point.cadence !== undefined ||
    point.temperature !== undefined ||
    point.speed !== undefined;
  if (trackPointExtension || point.power !== undefined) {
    writer.open('extensions');
    if (trackPointExtension) {
      writer.open('gpxtpx:TrackPointExtension');
      if (point.temperature !== undefined) {
        writer.leaf('gpxtpx:atemp', decimal(point.temperature, 1));
      }
      if (point.heartRate !== undefined) writer.leaf('gpxtpx:hr', integer(point.heartRate));
      if (point.cadence !== undefined) writer.leaf('gpxtpx:cad', integer(point.cadence));
      if (point.speed !== undefined) writer.leaf('gpxtpx:speed', decimal(point.speed, 3));
      writer.close('gpxtpx:TrackPointExtension');
    }
    if (point.power !== undefined) {
      writer.leaf('gpxpx:PowerInWatts', integer(point.power));
    }
    writer.close('extensions');
  }
  writer.close('trkpt');
}

/**
 * The channels a GPX 1.1 document cannot carry, for the README table and for
 * the round-trip test to assert against rather than describe.
 *
 * `distance` has no element in GPX 1.1 or in any extension schema this package
 * writes, and `lap.totalElapsedTime` / `lap.totalDistance` have nowhere to go
 * because GPX has no lap. `seconds` and `metres` are named to make it obvious
 * which quantities are meant.
 */
export const GPX_LOSSY_CHANNELS = ['point.distance', 'lap.totalElapsedTime', 'lap.totalDistance'];

/**
 * A lap with the channels GPX cannot carry removed, for a round-trip comparison.
 *
 * ⚠️ **Not only a channel filter: it also applies the derivations the exporter
 * makes**, because a normaliser that describes a different export from the one
 * {@link encodeGpx} performs turns a round-trip test into a test of the
 * fixture. Two of them:
 *
 * - GPX has no element for a *lap's* start, so `<trkseg>` carries none and the
 *   importer takes the first point's timestamp. A lap's own `startTime` never
 *   survives; the first point's does.
 * - An activity with no `startTime` is exported with the first point's
 *   timestamp in `<metadata><time>`, so it comes back derived rather than
 *   absent.
 *
 * Both were invisible while the fixture set every `startTime` to exactly the
 * value the derivation produces.
 */
export function withoutGpxLossyChannels(activity: TrackActivity): TrackActivity {
  return {
    ...activity,
    startTime: activity.startTime ?? activity.laps[0]?.points[0]?.timestamp,
    laps: activity.laps.map((lap) => ({
      startTime: lap.points[0]?.timestamp,
      totalElapsedTime: undefined as ReturnType<typeof seconds> | undefined,
      totalDistance: undefined,
      points: lap.points.map((point) => ({ ...point, distance: undefined })),
    })),
  };
}
