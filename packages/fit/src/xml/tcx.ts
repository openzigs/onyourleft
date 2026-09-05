// SPDX-License-Identifier: Apache-2.0

/**
 * TCX — Training Center XML v2 — read and written.
 *
 * The targeted schema version is
 * **`http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2`**, with the
 * power and speed channels from
 * **`http://www.garmin.com/xmlschemas/ActivityExtension/v2`**. Both are pinned
 * in `packages/fit/README.md` §7 as #32 requires.
 *
 * ## TCX is not GPX with different tag names
 *
 * It nests its coordinates in child elements rather than in attributes, it has
 * laps natively with their own totals, and its heart rate is a `<Value>` inside
 * a `<HeartRateBpm>` rather than a leaf. Each of those is a different parsing
 * path from the GPX one and fails differently, which is why the #29 corpus
 * carries both formats rather than treating one as representative.
 *
 * ## What TCX cannot hold
 *
 * **Temperature**, which has no element in TCX v2 or in the `ActivityExtension`
 * schema, and the **activity name**, which TCX has no field for — `<Notes>` is
 * free text for a rider's own note and putting a name there would make every
 * consumer that renders notes render the name instead. Both are in the README's
 * lossy table and both are asserted in `tcx.test.ts`.
 */

import type { GeographicPosition } from '@onyourleft/domain';
import {
  altitudeMetres,
  beatsPerMinute,
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
import { extensionChannelOf, TCX_ACTIVITY_EXTENSION_V2 } from './extensions';
import { formatIsoInstant, parseIsoInstant } from './iso-time';
import type { XmlStartElement } from './parse';
import { parseXml } from './parse';
import type { TrackActivity, TrackDecodeResult, TrackLap, TrackPoint } from './track';
import { finiteNumber, quantity } from './values';
import { decimal, degrees, integer, XmlWriter } from './write';

/** The TCX v2 namespace. The version this package targets. */
export const TCX_NAMESPACE = 'http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2';

/** The XML Schema instance namespace, for the `Creator` element's `xsi:type`. */
const XSI_NAMESPACE = 'http://www.w3.org/2001/XMLSchema-instance';

/** The `Creator` name this package writes when the activity names none. */
export const TCX_CREATOR = 'On Your Left';

interface PartialPoint {
  timestamp: TrackPoint['timestamp'];
  latitude: number | undefined;
  longitude: number | undefined;
  altitude: TrackPoint['altitude'];
  distance: TrackPoint['distance'];
  speed: TrackPoint['speed'];
  heartRate: TrackPoint['heartRate'];
  cadence: TrackPoint['cadence'];
  power: TrackPoint['power'];
}

interface PartialLap {
  startTime: TrackLap['startTime'];
  totalElapsedTime: TrackLap['totalElapsedTime'];
  totalDistance: TrackLap['totalDistance'];
  points: TrackPoint[];
}

function emptyPoint(): PartialPoint {
  return {
    timestamp: undefined,
    latitude: undefined,
    longitude: undefined,
    altitude: undefined,
    distance: undefined,
    speed: undefined,
    heartRate: undefined,
    cadence: undefined,
    power: undefined,
  };
}

/**
 * Pair a point's two coordinate elements, or drop both.
 *
 * A `<Position>` with a `<LatitudeDegrees>` and no `<LongitudeDegrees>` is half
 * a position, and half a position paired with a zero is a ride in the Gulf of
 * Guinea. The FIT decoder makes the same call for the same reason.
 */
function positionOf(
  point: PartialPoint,
  offset: number,
  faults: ActivityXmlError[],
): GeographicPosition | undefined {
  if (point.latitude === undefined && point.longitude === undefined) return undefined;
  if (point.latitude === undefined || point.longitude === undefined) {
    faults.push(
      new ActivityXmlError(
        'invalid-value',
        offset,
        'a Trackpoint carries one half of a Position: a LatitudeDegrees with no ' +
          'LongitudeDegrees beside it, or the reverse. A position needs both, so it is dropped ' +
          'rather than paired with a zero',
      ),
    );
    return undefined;
  }
  try {
    return geographicPosition(degreesLatitude(point.latitude), degreesLongitude(point.longitude));
  } catch (cause) {
    if (!(cause instanceof UnitError)) throw cause;
    faults.push(
      new ActivityXmlError(
        'invalid-value',
        offset,
        'a Trackpoint position is outside the range a latitude and longitude pair can take; the ' +
          'position is dropped',
      ),
    );
    return undefined;
  }
}

/**
 * Read a TCX v2 document.
 *
 * A file with more than one `<Activity>` has every activity's laps concatenated
 * and takes its identification from the first, which is what a rider who
 * exported a multi-activity file and expected to see their ride wants. The
 * alternative — returning the first activity and silently discarding the rest —
 * loses data with no signal at all.
 *
 * @throws {ActivityXmlError} for a document that is not well-formed, that
 * carries a DOCTYPE, that ends mid-element, or whose root is not
 * `<TrainingCenterDatabase>`.
 */
export function decodeTcx(text: string): TrackDecodeResult {
  const faults: ActivityXmlError[] = [];
  const laps: TrackLap[] = [];

  // A plain stack, popped in place. `path.slice(0, -1)` would allocate a new
  // array on every end tag — about six per track point, so ninety thousand
  // arrays for a four-hour ride. #127's shape at a smaller scale.
  const path: string[] = [];
  let characters = '';
  let point: PartialPoint | undefined;
  let pointOffset = 0;
  let lap: PartialLap | undefined;
  let sport: string | undefined;
  let creator: string | undefined;
  let startTime: TrackActivity['startTime'];
  let rootChecked = false;

  parseXml(text, {
    startElement(element: XmlStartElement) {
      if (!rootChecked) {
        rootChecked = true;
        if (element.local !== 'TrainingCenterDatabase') {
          throw new ActivityXmlError(
            'wrong-root-element',
            element.characterOffset,
            'the document’s root element is not <TrainingCenterDatabase>, so it is not a TCX file',
          );
        }
      }
      path.push(element.local);
      characters = '';

      if (element.local === 'Activity' && sport === undefined) {
        sport = element.attributes.find((attribute) => attribute.local === 'Sport')?.value;
      }
      if (element.local === 'Lap') {
        const started = element.attributes.find((attribute) => attribute.local === 'StartTime');
        lap = {
          startTime:
            started === undefined
              ? undefined
              : readInstant(started.value, 'Lap@StartTime', element.characterOffset, faults),
          totalElapsedTime: undefined,
          totalDistance: undefined,
          points: [],
        };
      }
      if (element.local === 'Trackpoint') {
        point = emptyPoint();
        pointOffset = element.characterOffset;
      }
    },

    text(value) {
      characters += value;
    },

    endElement(element) {
      const local = element.local;
      const value = characters;
      characters = '';
      path.pop();

      if (point) {
        if (readPointChild(point, local, value, path, pointOffset, faults)) return;
        if (local === 'Trackpoint') {
          lap?.points.push({
            timestamp: point.timestamp,
            position: positionOf(point, pointOffset, faults),
            altitude: point.altitude,
            distance: point.distance,
            speed: point.speed,
            heartRate: point.heartRate,
            cadence: point.cadence,
            power: point.power,
            // TCX v2 has no temperature element, in the schema or in the
            // ActivityExtension. See the module comment's lossy list.
            temperature: undefined,
          });
          point = undefined;
        }
        return;
      }

      if (lap) {
        if (local === 'TotalTimeSeconds') {
          lap.totalElapsedTime = quantity(value, seconds, 'Lap/TotalTimeSeconds', 0, faults);
          return;
        }
        if (local === 'DistanceMeters') {
          lap.totalDistance = quantity(value, metres, 'Lap/DistanceMeters', 0, faults);
          return;
        }
        if (local === 'Lap') {
          laps.push({
            startTime: lap.startTime ?? lap.points[0]?.timestamp,
            totalElapsedTime: lap.totalElapsedTime,
            totalDistance: lap.totalDistance,
            points: lap.points,
          });
          lap = undefined;
          return;
        }
      }

      if (local === 'Id' && startTime === undefined) {
        startTime = readInstant(value, 'Activity/Id', 0, faults);
        return;
      }
      if (local === 'Name' && path.includes('Creator') && creator === undefined) {
        creator = value.trim();
      }
    },
  });

  return {
    activity: {
      startTime: startTime ?? laps[0]?.points[0]?.timestamp,
      // TCX has no activity name. See the module comment.
      name: undefined,
      sport: sport === '' ? undefined : sport,
      creator: creator === '' ? undefined : creator,
      laps,
    },
    faults,
  };
}

/** True when the element was one of a Trackpoint's own children. */
function readPointChild(
  point: PartialPoint,
  local: string,
  value: string,
  path: readonly string[],
  offset: number,
  faults: ActivityXmlError[],
): boolean {
  if (path.includes('Extensions')) {
    const channel = extensionChannelOf(local);
    if (channel === 'power') {
      point.power = quantity(value, watts, 'Trackpoint extension Watts', offset, faults);
      return true;
    }
    if (channel === 'speed') {
      point.speed = quantity(value, metresPerSecond, 'Trackpoint extension Speed', offset, faults);
      return true;
    }
    return channel !== undefined;
  }

  switch (local) {
    case 'Time':
      point.timestamp = readInstant(value, 'Trackpoint/Time', offset, faults);
      return true;
    case 'LatitudeDegrees':
      point.latitude = finiteNumber(value, 'Trackpoint/LatitudeDegrees', offset, faults);
      return true;
    case 'LongitudeDegrees':
      point.longitude = finiteNumber(value, 'Trackpoint/LongitudeDegrees', offset, faults);
      return true;
    case 'AltitudeMeters':
      point.altitude = quantity(value, altitudeMetres, 'Trackpoint/AltitudeMeters', offset, faults);
      return true;
    case 'DistanceMeters':
      point.distance = quantity(value, metres, 'Trackpoint/DistanceMeters', offset, faults);
      return true;
    case 'Cadence':
      point.cadence = quantity(value, revolutionsPerMinute, 'Trackpoint/Cadence', offset, faults);
      return true;
    case 'Value':
      if (!path.includes('HeartRateBpm')) return false;
      point.heartRate = quantity(
        value,
        beatsPerMinute,
        'Trackpoint/HeartRateBpm/Value',
        offset,
        faults,
      );
      return true;
    default:
      return false;
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
        `${what} is not an ISO 8601 instant with a zone designator; the timestamp is dropped`,
      ),
    );
    return undefined;
  }
  return instant;
}

/**
 * The three values TCX's `Sport` attribute admits.
 *
 * A free-text sport from a GPX `<type>` has to become one of these or the
 * document is not schema-valid, and `Other` is what an unrecognised sport
 * becomes. Mapping rather than passing through, because a TCX carrying
 * `Sport="cycling"` is a file that validates nowhere.
 */
function tcxSport(sport: string | undefined): string {
  const normalised = (sport ?? '').trim().toLowerCase();
  if (['biking', 'cycling', 'bike', 'ride', 'virtualride', 'ebikeride'].includes(normalised)) {
    return 'Biking';
  }
  if (['running', 'run'].includes(normalised)) return 'Running';
  return 'Other';
}

/** Write a TCX v2 document. */
export function encodeTcx(activity: TrackActivity): string {
  const writer = new XmlWriter().declaration();
  writer.open('TrainingCenterDatabase', [
    ['xmlns', TCX_NAMESPACE],
    ['xmlns:ns3', TCX_ACTIVITY_EXTENSION_V2],
    ['xmlns:xsi', XSI_NAMESPACE],
  ]);
  writer.open('Activities');
  writer.open('Activity', [['Sport', tcxSport(activity.sport)]]);

  const start = activity.startTime ?? activity.laps[0]?.points[0]?.timestamp;
  if (start !== undefined) writer.leaf('Id', formatIsoInstant(start));

  for (const lap of activity.laps) {
    const lapStart = lap.startTime ?? lap.points[0]?.timestamp;
    writer.open('Lap', lapStart === undefined ? [] : [['StartTime', formatIsoInstant(lapStart)]]);
    if (lap.totalElapsedTime !== undefined) {
      writer.leaf('TotalTimeSeconds', decimal(lap.totalElapsedTime, 1));
    }
    if (lap.totalDistance !== undefined) {
      writer.leaf('DistanceMeters', decimal(lap.totalDistance, 1));
    }
    writer.leaf('Intensity', 'Active');
    writer.leaf('TriggerMethod', 'Manual');
    writer.open('Track');
    for (const point of lap.points) writeTrackpoint(writer, point);
    writer.close('Track');
    writer.close('Lap');
  }

  writer.open('Creator', [['xsi:type', 'Device_t']]);
  writer.leaf('Name', activity.creator ?? TCX_CREATOR);
  writer.close('Creator');

  writer.close('Activity');
  writer.close('Activities');
  writer.close('TrainingCenterDatabase');
  return writer.finish();
}

function writeTrackpoint(writer: XmlWriter, point: TrackPoint): void {
  writer.open('Trackpoint');
  if (point.timestamp !== undefined) writer.leaf('Time', formatIsoInstant(point.timestamp));
  if (point.position !== undefined) {
    writer.open('Position');
    writer.leaf('LatitudeDegrees', degrees(point.position.latitude));
    writer.leaf('LongitudeDegrees', degrees(point.position.longitude));
    writer.close('Position');
  }
  if (point.altitude !== undefined) writer.leaf('AltitudeMeters', decimal(point.altitude, 1));
  if (point.distance !== undefined) writer.leaf('DistanceMeters', decimal(point.distance, 1));
  if (point.heartRate !== undefined) {
    writer.open('HeartRateBpm');
    writer.leaf('Value', integer(point.heartRate));
    writer.close('HeartRateBpm');
  }
  if (point.cadence !== undefined) writer.leaf('Cadence', integer(point.cadence));
  if (point.power !== undefined || point.speed !== undefined) {
    writer.open('Extensions');
    writer.open('ns3:TPX');
    if (point.speed !== undefined) writer.leaf('ns3:Speed', decimal(point.speed, 3));
    if (point.power !== undefined) writer.leaf('ns3:Watts', integer(point.power));
    writer.close('ns3:TPX');
    writer.close('Extensions');
  }
  writer.close('Trackpoint');
}

/** The channels a TCX v2 document cannot carry. See the module comment. */
export const TCX_LOSSY_CHANNELS = ['point.temperature', 'activity.name'];

/**
 * An activity with the channels TCX cannot carry removed, for a comparison.
 *
 * ⚠️ **Not only a channel filter: it also applies the derivations the exporter
 * makes**, because a normaliser that describes a different export from the one
 * {@link encodeTcx} performs turns a round-trip test into a test of the
 * fixture. Three of them:
 *
 * - `Sport` is a required attribute with three admitted values, so an activity
 *   with **no** sport is exported as `Sport="Other"` and comes back as
 *   `'Other'`, never as absent. Mapping only a sport that was already there is
 *   what this used to do, and it disagreed with the encoder one line above.
 * - `<Id>` is the activity's start, written from the first point when the
 *   activity has none of its own.
 * - `Lap@StartTime` likewise.
 */
export function withoutTcxLossyChannels(activity: TrackActivity): TrackActivity {
  return {
    ...activity,
    name: undefined,
    sport: tcxSport(activity.sport),
    startTime: activity.startTime ?? activity.laps[0]?.points[0]?.timestamp,
    laps: activity.laps.map((lap) => ({
      ...lap,
      startTime: lap.startTime ?? lap.points[0]?.timestamp,
      points: lap.points.map((point) => ({ ...point, temperature: undefined })),
    })),
  };
}
