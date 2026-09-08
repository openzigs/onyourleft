// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Export a saved route to a file a head unit can load — #74.
 *
 * > *"A route you cannot get onto the device on your handlebars is a picture."*
 *
 * This project has no device-partner integrations and will not have any, so
 * export is **by file**: the rider downloads it and copies it across, exactly
 * as with activity export (#51). That is a file operation between a rider and
 * their own hardware and it needs no network — which is also how #74's fifth
 * criterion is met, and it is met by construction rather than by a test double:
 * nothing in this path or below it can reach one. `packages/fit` names no
 * network global and `packages/domain`'s tsconfig makes `fetch` a compile
 * error.
 *
 * ⚠️ **The encoders are `packages/fit`'s, not this screen's.** #74 says the
 * codec work belongs beside the GPX and TCX import/export from #32 and that
 * *"a second, parallel XML writer in the client would be the wrong shape"*.
 * This module reads a route, hands it over, and turns two faults into
 * sentences. It writes no XML.
 */

import {
  encodeGpxRoute,
  encodeTcxRoute,
  courseSampleCount,
  type RouteExportResult,
} from '@onyourleft/fit';
import type { AthleteId, RouteId, RouteRecord } from '@onyourleft/store';

import { safeFileStem } from '../transfer/export-activity';
import type { DownloadableFile } from '../transfer/store-port';

import type { RoutePort } from './store-port';

/** The formats a route can leave in. See §"Why not FIT" below. */
export type RouteFileFormat = 'gpx' | 'tcx';

export const ROUTE_FILE_FORMATS: readonly RouteFileFormat[] = ['gpx', 'tcx'];

const MEDIA_TYPE: Readonly<Record<RouteFileFormat, string>> = {
  gpx: 'application/gpx+xml',
  tcx: 'application/vnd.garmin.tcx+xml',
};

/**
 * The point count above which a rider is warned.
 *
 * ⚠️ **A warning, never a truncation.** `packages/fit`'s `course.ts` records
 * why the exporter does not simplify; this is the other half of that decision —
 * the rider is told before they copy a file their device may refuse, and they
 * keep a complete file either way. The number is deliberately round and
 * deliberately conservative: head-unit course-point limits differ by vendor and
 * by firmware, none was verifiable from here, and a warning that fires slightly
 * early costs a sentence where one that fires late costs a ride.
 */
export const LONG_ROUTE_SAMPLES = 10_000;

/** A file, and everything the format could not carry. */
export interface ExportedRoute {
  readonly file: DownloadableFile;
  /** One sentence per fault, in the order the encoder reported them. */
  readonly lost: readonly string[];
}

export class RouteExportError extends Error {
  constructor(readonly code: 'no-such-route') {
    super('this athlete has no route with that id');
    this.name = 'RouteExportError';
  }
}

/**
 * Read a route back out of the store and write it as a file.
 *
 * The read is athlete-scoped by the store port's own signature, so another
 * athlete's route cannot be exported by knowing its id — CLAUDE.md §6's
 * cross-athlete class, closed at the only place this path reads.
 *
 * @throws {RouteExportError} when this athlete has no such route.
 */
export async function exportRoute(
  port: RoutePort,
  owner: AthleteId,
  id: RouteId,
  format: RouteFileFormat,
): Promise<ExportedRoute> {
  const record = await port.store.getRoute(owner, id);
  if (record === undefined) {
    throw new RouteExportError('no-such-route');
  }
  return exportedFrom(record, format);
}

/**
 * The pure half, so the wording can be tested without a store.
 *
 * Exported because the view renders `lost` and a test of that wording should
 * not have to stand up a database to reach it.
 */
export function exportedFrom(record: RouteRecord, format: RouteFileFormat): ExportedRoute {
  const route = { name: record.name, profile: record.profile };
  const encoded: RouteExportResult =
    format === 'gpx' ? encodeGpxRoute(route) : encodeTcxRoute(route);

  // Sentences, not fault objects. The point-count warning below is not a
  // `RouteExportFaultCode` and must not borrow one: the codec's fault union
  // describes what a FORMAT cannot carry, and a head unit's course-point cap is
  // a fact about hardware `packages/fit` has never met. Reusing a code there
  // would put a message about a device under a name about a field.
  const lost = encoded.faults.map((fault) => fault.message);
  const samples = courseSampleCount(route);
  if (samples > LONG_ROUTE_SAMPLES) {
    lost.push(longRouteMessage(samples));
  }

  return {
    file: {
      fileName: `${safeFileStem(record.name, `route-${record.id}`)}.${format}`,
      // `TextEncoder` rather than a byte-by-byte write: the document is UTF-8
      // and a route name can carry anything a rider typed, including a
      // surrogate pair that a naive charCode loop would tear in half — the
      // same hazard `escapeXmlText`'s `u` flag exists for.
      bytes: new TextEncoder().encode(encoded.text),
      mediaType: MEDIA_TYPE[format],
    },
    lost,
  };
}

/** The warning that belongs to this screen rather than to the codec. */
function longRouteMessage(samples: number): string {
  return (
    `This route has ${samples.toLocaleString('en-GB')} points. Some head units cap how many a ` +
    'course may contain, so yours may refuse it or shorten it. Re-import the route with a ' +
    'coarser spacing if it does — the file itself is complete.'
  );
}
