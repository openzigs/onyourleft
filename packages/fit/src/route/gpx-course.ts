// SPDX-License-Identifier: Apache-2.0

/**
 * Export a route as GPX 1.1 — #74.
 *
 * ## `<trk>`, not `<rte>`, and that is the decision in this file
 *
 * GPX has two elements that could carry a planned route and they mean different
 * things. `<rte>` is *"an ordered list of waypoints leading to a destination"*
 * — turn cues, which a device is entitled to route between however it likes.
 * `<trk>` is an ordered list of points that were, or are to be, followed.
 *
 * **This writes a `<trk>`**, for a reason that is about failure rather than
 * purity. A route in this program is a ~10 m grid: several hundred to several
 * thousand points. Handed those as `<rtept>`, a head unit that treats route
 * points as turn cues can re-route between them against its own map — and a
 * device that re-routes gives the rider a *different ride* while showing them
 * the name of the one they loaded. A `<trk>` is the least interpretable thing
 * the format offers, which is what you want when you cannot test the device.
 *
 * ⚠️ **Whether a given head unit prefers `<rte>` is unverified**, and that is
 * exactly what #74's first acceptance criterion exists to settle. It could not
 * be settled here — no device, and the vendors' documentation was not reachable
 * from this environment. If a real Edge or ELEMNT turns out to want `<rte>`,
 * this is the paragraph to come back to, and the change is small.
 *
 * ⚠️ It also means the round trip in `gpx-course.test.ts` goes through the
 * `<trk>` branch of `decodeGpx`, which is the branch a `<trk>`-carrying
 * document takes anyway — #89 made `<trk>` win outright over `<rte>` when a
 * document has both.
 */

import type { RouteProfile } from '@onyourleft/domain';

import { GPX_CREATOR, GPX_NAMESPACE } from '../xml/gpx';
import { decimal, degrees, XmlWriter } from '../xml/write';

import {
  GRADIENT_FAULT,
  ODBL_LICENCE_URL,
  OSM_ATTRIBUTION,
  ROUTE_CREATOR,
  type ExportableRoute,
  type RouteExportOptions,
  type RouteExportResult,
} from './course';

/**
 * Write a route as a GPX 1.1 document.
 *
 * Every string reaches the document through `XmlWriter`, which escapes — so a
 * route called `Coffee & Cake <hills>` produces a valid file rather than a
 * broken one. #74's third criterion asks for a *real serialiser rather than
 * string concatenation*, and the way that is met is by not having a second
 * writer at all: this is the same `XmlWriter` `encodeGpx` uses, whose header
 * records that it has **no "this string is known safe" path**.
 */
export function encodeGpxRoute(
  route: ExportableRoute,
  options: RouteExportOptions = {},
): RouteExportResult {
  const attribution = options.attribution === undefined ? OSM_ATTRIBUTION : options.attribution;
  const writer = new XmlWriter().declaration();

  writer.open('gpx', [
    ['version', '1.1'],
    ['creator', options.creator ?? ROUTE_CREATOR],
    ['xmlns', GPX_NAMESPACE],
  ]);

  // GPX's own metadata block is where #74's seventh criterion lands: the
  // format has a place for this and so it goes there rather than into a
  // comment a parser discards.
  writer.open('metadata');
  if (route.name !== undefined) writer.leaf('name', route.name);
  if (attribution !== null) {
    writer.open('copyright', [['author', attribution]]);
    writer.leaf('license', ODBL_LICENCE_URL);
    writer.close('copyright');
  }
  writer.close('metadata');

  writer.open('trk');
  if (route.name !== undefined) writer.leaf('name', route.name);
  // `<type>` is GPX's free-text activity type. "Cycling" rather than a route
  // classification, because GPX has no field for the freehand-versus-road
  // distinction #74 asks about — see `README.md` §8.
  writer.leaf('type', 'Cycling');
  writer.open('trkseg');
  writeCoursePoints(writer, route.profile);
  writer.close('trkseg');
  writer.close('trk');

  writer.close('gpx');
  return { text: writer.finish(), faults: [GRADIENT_FAULT] };
}

/**
 * One `<trkpt>` per grid sample, with no `<time>`.
 *
 * ⚠️ **A route has no timestamps and none are invented.** A planned route is
 * not something that happened, and a fabricated `<time>` would make the file
 * indistinguishable from a recorded ride — which is how a route ends up in
 * somebody's activity history as a ride they did not do. `decodeGpx` reads a
 * `<trkpt>` with no `<time>` without complaint, which is what makes the round
 * trip in the test possible.
 */
function writeCoursePoints(writer: XmlWriter, profile: RouteProfile): void {
  for (const [index, position] of profile.positions.entries()) {
    writer.open('trkpt', [
      ['lat', degrees(position.latitude)],
      ['lon', degrees(position.longitude)],
    ]);
    const elevation = profile.elevations[index];
    if (elevation !== undefined) writer.leaf('ele', decimal(elevation, 1));
    writer.close('trkpt');
  }
}

/** Re-exported so a caller comparing writers does not have to import two modules. */
export { GPX_CREATOR };
