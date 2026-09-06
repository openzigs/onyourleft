// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fixtures for the transfer screen's tests that need no filesystem.
 *
 * Everything here works under both of this package's environments — the default
 * `node` one and the `jsdom` one the UI tests declare. The corpus files, which
 * need `node:fs` and therefore a `file:` module URL, are in `corpus.ts`; see the
 * note at the top of that file for why the two are separate.
 */

import { unixSeconds, type UnixSeconds } from '@onyourleft/domain';
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
