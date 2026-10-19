// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fixtures for the transfer screen's tests that need no filesystem.
 *
 * Everything here works under both of this package's environments — the default
 * `node` one and the `jsdom` one the UI tests declare. The corpus files, which
 * need `node:fs` and therefore a `file:` module URL, are in `corpus.ts`; see the
 * note at the top of that file for why the two are separate.
 */

import {
  beatsPerMinute,
  metres,
  metresPerSecond,
  seconds,
  unixSeconds,
  watts,
  type UnixSeconds,
} from '@onyourleft/domain';
import {
  encodeFitActivity,
  encodeGpx,
  encodeTcx,
  FILE_TYPE_ACTIVITY,
  SPORT_CYCLING,
  type FitDateTime,
  type FitRecord,
  type TrackPoint,
} from '@onyourleft/fit';
import { activityId, type ActivityId } from '@onyourleft/store';

import type { ImportSource } from './import-batch';

/** Arbitrary bytes under a filename, for the things a bulk export also contains. */
export function bytesSource(fileName: string, contents: string | Uint8Array): ImportSource {
  const bytes = typeof contents === 'string' ? new TextEncoder().encode(contents) : contents;
  return { fileName, bytes: async () => Promise.resolve(bytes) };
}

/**
 * A small, distinct, hand-written GPX 1.1 document — the volume a bulk import
 * needs.
 *
 * Hand-written rather than produced by `encodeGpx`, so the bulk arm is reading
 * a document this project did not write. Every ride starts on its own day and
 * sits at its own coordinates, so no two files share bytes and the
 * deduplication arm is testing deduplication rather than accidental collision.
 *
 * ADR 0004 decision G: the coordinates are inside the `NULL-ISLAND` synthetic
 * test region (-1 to +1 on both axes), which is open water in the Gulf of
 * Guinea. No fixture in this repository carries a real location.
 */
export function syntheticGpx(index: number): string {
  const day = String((index % 28) + 1).padStart(2, '0');
  const month = String((Math.floor(index / 28) % 12) + 1).padStart(2, '0');
  const latitude = (0.01 + index * 0.0001).toFixed(6);
  const points = [0, 1, 2, 3, 4]
    .map((offset) => {
      const time = `2019-${month}-${day}T07:00:0${String(offset)}Z`;
      const longitude = (0.02 + index * 0.0001 + offset * 0.0003).toFixed(6);
      return [
        `      <trkpt lat="${latitude}" lon="${longitude}">`,
        `        <ele>${String(10 + offset)}.0</ele>`,
        `        <time>${time}</time>`,
        '        <extensions><gpxtpx:TrackPointExtension>',
        `          <gpxtpx:hr>${String(120 + offset)}</gpxtpx:hr>`,
        '        </gpxtpx:TrackPointExtension></extensions>',
        '      </trkpt>',
      ].join('\n');
    })
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="a head unit that is not ours" ' +
      'xmlns="http://www.topografix.com/GPX/1/1" ' +
      'xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">',
    '  <trk>',
    `    <name>Ride ${String(index)}</name>`,
    '    <type>cycling</type>',
    '    <trkseg>',
    points,
    '    </trkseg>',
    '  </trk>',
    '</gpx>',
    '',
  ].join('\n');
}

/**
 * A GPX **course** as a route planner exports one — #232.
 *
 * A positioned line with elevation, a name, and **no `<time>` anywhere**. That
 * is the file the Files screen cannot import at all (there is no timeline to
 * place it on) and the Routes screen takes happily, which is the whole of the
 * confusion #232 is about.
 *
 * Hand-written rather than taken from the #29 corpus because that corpus holds
 * no such file: every fixture in it is an *activity*, which is what it is for.
 *
 * ADR 0004 decision G: the coordinates are inside the `NULL-ISLAND` synthetic
 * test region, which is open water in the Gulf of Guinea.
 *
 * @param index shifts the line so two calls produce different bytes, for the
 * deduplication arm.
 */
export function syntheticCourseGpx(index = 0): string {
  const points = Array.from({ length: 30 }, (_unused, offset) => {
    const longitude = (0.02 + index * 0.01 + offset * 0.0001).toFixed(6);
    return (
      `      <trkpt lat="0.010000" lon="${longitude}">` +
      `<ele>${String(10 + offset)}.0</ele></trkpt>`
    );
  }).join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="a route planner that is not ours" ' +
      'xmlns="http://www.topografix.com/GPX/1/1">',
    '  <trk>',
    `    <name>A course somebody downloaded ${String(index)}</name>`,
    '    <trkseg>',
    points,
    '    </trkseg>',
    '  </trk>',
    '</gpx>',
    '',
  ].join('\n');
}

/** A counter-backed id generator, so an assertion can name the ids it expects. */
export function sequentialActivityIds(prefix = 'imported'): () => ActivityId {
  let next = 0;
  return () => {
    next += 1;
    return activityId(`${prefix}-${String(next)}`);
  };
}

/** A fixed clock, so `createdAt` is not the reason two runs differ. */
export const IMPORT_CLOCK: UnixSeconds = unixSeconds(1_760_000_000);

/** One lap as a fixture file states it. @see lappedFile */
export interface FixtureLap {
  /** Seconds after the ride's first sample. */
  readonly start: number;
  readonly elapsed: number | undefined;
  readonly moving?: number | undefined;
  readonly distance?: number | undefined;
}

/** @see lappedFile */
export interface LappedFileOptions {
  readonly format: 'fit' | 'tcx' | 'gpx';
  /** How many 1 Hz samples, from {@link LAPPED_FILE_START}. */
  readonly samples: number;
  readonly laps: readonly FixtureLap[];
  /**
   * What the file says wrote it: a FIT `file_id` manufacturer, a TCX
   * `<Creator>` name. `undefined` names nothing, as a FIT file from this
   * client's export does; a TCX `<Creator>` cannot be absent from what
   * `encodeTcx` writes, so `undefined` there writes this client's own name.
   */
  readonly writer: number | string | undefined;
  /** The session's moving time, FIT only. The samples' span when absent. */
  readonly moving?: number | undefined;
  /** The ride's distance. Speed is 5 m/s throughout, so `5 × (samples − 1)` when absent. */
  readonly distance?: number | undefined;
}

/** Where {@link lappedFile}'s ride starts. */
export const LAPPED_FILE_START: UnixSeconds = unixSeconds(1_718_442_000);

/**
 * A FIT, TCX or GPX file with laps (one `<trkseg>` each in GPX), from a device that names itself or does not —
 * #1320. Sample `i` has power `i` watts, heart rate `100 + i % 50` and speed
 * 5 m/s, so a lap's averages can be worked out by hand from its slots.
 */
export function lappedFile(options: LappedFileOptions): Uint8Array {
  const span = options.samples - 1;
  const points: TrackPoint[] = Array.from({ length: options.samples }, (_unused, index) => ({
    timestamp: unixSeconds(LAPPED_FILE_START + index),
    position: undefined,
    altitude: undefined,
    distance: undefined,
    speed: metresPerSecond(5),
    heartRate: beatsPerMinute(100 + (index % 50)),
    cadence: undefined,
    power: watts(index),
    temperature: undefined,
  }));
  const distance = options.distance ?? 5 * span;
  if (options.format !== 'fit') {
    const encode = options.format === 'tcx' ? encodeTcx : encodeGpx;
    return new TextEncoder().encode(
      encode({
        startTime: LAPPED_FILE_START,
        name: 'Lapped',
        sport: 'Biking',
        creator: typeof options.writer === 'string' ? options.writer : undefined,
        laps: options.laps.map((lap, ordinal) => {
          const next = options.laps[ordinal + 1]?.start ?? options.samples;
          return {
            startTime: unixSeconds(LAPPED_FILE_START + lap.start),
            totalElapsedTime: lap.elapsed === undefined ? undefined : seconds(lap.elapsed),
            totalDistance: lap.distance === undefined ? undefined : metres(lap.distance),
            points: points.slice(lap.start, next),
          };
        }),
      }),
    );
  }
  const instant = (at: number): FitDateTime => ({ kind: 'instant', instant: unixSeconds(at) });
  return encodeFitActivity({
    fileId: {
      type: FILE_TYPE_ACTIVITY,
      manufacturer: typeof options.writer === 'number' ? options.writer : undefined,
      product: undefined,
      serialNumber: undefined,
      timeCreated: instant(LAPPED_FILE_START),
    },
    records: points.map((point): FitRecord => ({
      ...point,
      timestamp: point.timestamp === undefined ? undefined : instant(point.timestamp),
      developerFields: [],
    })),
    laps: options.laps.map((lap, ordinal) => ({
      timestamp: instant(LAPPED_FILE_START + lap.start + (lap.elapsed ?? 0)),
      messageIndex: ordinal,
      startTime: instant(LAPPED_FILE_START + lap.start),
      totalElapsedTime: lap.elapsed === undefined ? undefined : seconds(lap.elapsed),
      totalTimerTime: seconds(lap.moving ?? lap.elapsed ?? 0),
      totalDistance: lap.distance === undefined ? undefined : metres(lap.distance),
    })),
    sessions: [
      {
        timestamp: instant(LAPPED_FILE_START + span),
        messageIndex: 0,
        startTime: instant(LAPPED_FILE_START),
        sport: SPORT_CYCLING,
        totalElapsedTime: seconds(span),
        totalTimerTime: seconds(options.moving ?? span),
        totalDistance: metres(distance),
        numLaps: options.laps.length,
      },
    ],
  }).bytes;
}
