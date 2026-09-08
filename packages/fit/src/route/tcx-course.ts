// SPDX-License-Identifier: Apache-2.0

/**
 * Export a route as a TCX v2 **Course** — #74.
 *
 * ## A Course is not an Activity, and the difference is a time
 *
 * `encodeTcx` writes `<Activities><Activity>`: something that happened, with an
 * `Id` that is an instant and laps with elapsed times. A route happened to
 * nobody. TCX's own answer is a different top-level collection —
 * `<Courses><Course>` — and this writes that.
 *
 * ⚠️ **`CourseLap` requires a `TotalTimeSeconds` and a route has none, so this
 * writes zero and says so in a fault.** The alternative is to estimate, and an
 * estimate would be a claim about how fast *this rider* covers *this route*.
 * `packages/physics` can produce such a number — and only from a rider mass and
 * a drag area this program does not hold, so the number would be a default
 * dressed as a measurement. Zero is not a good time; it is an honest absence,
 * and the fault is what turns it into something a rider is told rather than
 * something they discover on the device.
 *
 * ⚠️ **`Course/Name` is believed to be limited to 15 characters** and this does
 * **not** truncate — see `RouteExportFaultCode`. The limit was read from memory
 * rather than from the schema, which could not be fetched here, and a wrong
 * truncation silently renames a rider's route. A fault is correct under both
 * readings of the constraint.
 */

import type { RouteProfile } from '@onyourleft/domain';

import { TCX_NAMESPACE, XSI_NAMESPACE } from '../xml/tcx';
import { decimal, degrees, XmlWriter } from '../xml/write';

import {
  GRADIENT_FAULT,
  OSM_ATTRIBUTION,
  ROUTE_CREATOR,
  type ExportableRoute,
  type RouteExportFault,
  type RouteExportOptions,
  type RouteExportResult,
} from './course';

/**
 * The length at which a device is believed to truncate a course name.
 *
 * Named rather than inlined so the fault, the test and this comment cannot
 * drift apart, and so that correcting it against a real schema is a one-line
 * change with one place to look.
 */
export const TCX_COURSE_NAME_LIMIT = 15;

/** Write a route as a TCX v2 Course. */
export function encodeTcxRoute(
  route: ExportableRoute,
  options: RouteExportOptions = {},
): RouteExportResult {
  const attribution = options.attribution === undefined ? OSM_ATTRIBUTION : options.attribution;
  const faults: RouteExportFault[] = [GRADIENT_FAULT];
  const writer = new XmlWriter().declaration();

  writer.open('TrainingCenterDatabase', [
    ['xmlns', TCX_NAMESPACE],
    ['xmlns:xsi', XSI_NAMESPACE],
  ]);
  writer.open('Courses');
  writer.open('Course');

  if (route.name !== undefined) {
    writer.leaf('Name', route.name);
    if (route.name.length > TCX_COURSE_NAME_LIMIT) {
      faults.push({
        code: 'tcx-name-may-be-truncated',
        message:
          `The name is ${String(route.name.length)} characters. TCX courses are believed to be ` +
          `limited to ${String(TCX_COURSE_NAME_LIMIT)}, so your device may show a shortened ` +
          'name. The route itself is unaffected.',
      });
    }
  }

  writeCourseLap(writer, route.profile);
  faults.push({
    code: 'tcx-course-time-is-unknown',
    message:
      'The file records a course time of zero. A planned route has no time, and this app does not ' +
      'guess one — your device will show its own estimate.',
  });

  writer.open('Track');
  writeCoursePoints(writer, route.profile);
  writer.close('Track');

  // ⚠️ TCX has no metadata element, so #74's seventh criterion lands in
  // `Notes` — the only free-text field a Course has, and the only place the
  // format allows the attribution to go at all. Written AFTER `Track` because
  // `Course_t` orders `Notes` after it.
  if (attribution !== null) writer.leaf('Notes', attribution);

  writer.open('Creator', [['xsi:type', 'Device_t']]);
  writer.leaf('Name', options.creator ?? ROUTE_CREATOR);
  writer.close('Creator');

  writer.close('Course');
  writer.close('Courses');
  writer.close('TrainingCenterDatabase');
  return { text: writer.finish(), faults };
}

/**
 * The single lap a Course carries.
 *
 * `BeginPosition` and `EndPosition` are the grid's first and last samples, so
 * on a loop they are the same place — which is correct and is what a loop is.
 */
function writeCourseLap(writer: XmlWriter, profile: RouteProfile): void {
  const first = profile.positions[0];
  const last = profile.positions[profile.positions.length - 1];

  writer.open('Lap');
  writer.leaf('TotalTimeSeconds', decimal(0, 1));
  writer.leaf('DistanceMeters', decimal(profile.totalDistance, 1));
  if (first !== undefined) writePosition(writer, 'BeginPosition', first);
  if (last !== undefined) writePosition(writer, 'EndPosition', last);
  writer.leaf('Intensity', 'Active');
  writer.close('Lap');
}

function writePosition(
  writer: XmlWriter,
  element: string,
  position: { readonly latitude: number; readonly longitude: number },
): void {
  writer.open(element);
  writer.leaf('LatitudeDegrees', degrees(position.latitude));
  writer.leaf('LongitudeDegrees', degrees(position.longitude));
  writer.close(element);
}

/** One `<Trackpoint>` per grid sample, with no `<Time>` — see `gpx-course.ts`. */
function writeCoursePoints(writer: XmlWriter, profile: RouteProfile): void {
  for (const [index, position] of profile.positions.entries()) {
    writer.open('Trackpoint');
    writer.open('Position');
    writer.leaf('LatitudeDegrees', degrees(position.latitude));
    writer.leaf('LongitudeDegrees', degrees(position.longitude));
    writer.close('Position');
    const elevation = profile.elevations[index];
    if (elevation !== undefined) writer.leaf('AltitudeMeters', decimal(elevation, 1));
    writer.close('Trackpoint');
  }
}
