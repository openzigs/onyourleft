// SPDX-License-Identifier: Apache-2.0

/**
 * The route half of the corpus — #89.
 *
 * A **route** is not a ride: it is a line somebody intends to follow, so it
 * carries no time, no heart rate and no power, and a planner writes it into
 * GPX's `<rte>` rather than its `<trk>`. That difference is the reason this
 * fixture exists rather than #89 reusing `nominal-ride.gpx`: the route element
 * is a separate path through the decoder, and the one thing #89 imports is
 * exactly the element the rest of the corpus never exercises.
 *
 * ## What the shape is chosen for
 *
 * A **closed loop**, because #89's fifth criterion is that riding past the end
 * wraps to the start, and a profile can only be asked to wrap if its two ends
 * are in the same place. A circle is the smallest shape with that property that
 * also turns continuously, so the resampled path has no vertex where a straight
 * -line interpolation is obviously wrong.
 *
 * **Irregularly spaced**, because real route points are: a planner emits a
 * point per road geometry vertex, not per fixed distance. #89's first design
 * note names this as the reason the profile resamples at all, so a fixture with
 * an even spacing would leave the resampling untested by the one file that is
 * supposed to test it.
 *
 * **A single smooth hill**, one climb and one descent per lap, ending at the
 * height it started — a loop whose elevation did not close would be a route
 * that gains height forever.
 *
 * ## Nothing here consults the clock or a random source
 *
 * Same rule as `ride.ts`, and for the same reason: `corpus.test.ts` asserts the
 * committed bytes are exactly what this produces. Every value is a closed-form
 * function of the point index.
 */

import type { GeographicPosition } from '@onyourleft/domain';
import { degreesLatitude, degreesLongitude, geographicPosition } from '@onyourleft/domain';

import { decimal, degrees, document, xmlText } from './xml-builder';
import type { XmlFixture } from './xml-fixtures';

const GPX_NAMESPACE = 'http://www.topografix.com/GPX/1/1';
const CREATOR = xmlText('On Your Left synthetic fixture generator');
const ROUTE_NAME = xmlText('Synthetic fixture loop');

/**
 * Where the loop sits: inside `NULL-ISLAND`, ADR 0004 decision G's open-water box.
 *
 * Off the exact origin so that neither coordinate is zero — a sign bug is
 * invisible against a zero, which is #25's lesson and the reason
 * `point-nemo.gpx` exists.
 */
const CENTRE_LATITUDE = 0.2;
const CENTRE_LONGITUDE = 0.35;

/** About 5 km round, which is the length #89 names as the beta world's own loop. */
const RADIUS_METRES = 800;

/** Enough points that the mean spacing is about 15 m, as a planner's export is. */
const POINT_COUNT = 340;

/** The hill: 30 m either side of the mean, so a lap climbs 60 m and loses 60 m. */
const MEAN_ELEVATION_METRES = 40;
const HILL_AMPLITUDE_METRES = 30;

/**
 * How much the angular spacing varies, as a fraction: ±0.02 of a turn's worth
 * over three cycles, which makes the step between points range over roughly
 * 0.62 to 1.38 of the mean.
 *
 * It stays monotonic — the derivative of the angle with respect to the index is
 * `1 + 6 * PI * 0.02 * cos(...)`, and `6 * PI * 0.02` is 0.377, so it never
 * reaches zero and the points never double back.
 */
const SPACING_VARIATION = 0.02;

const METRES_PER_DEGREE_LATITUDE = 111_194.9;

/** The angle, in turns, of point `index`. Monotonic; see {@link SPACING_VARIATION}. */
function turnsAt(index: number): number {
  const even = index / POINT_COUNT;
  return even + SPACING_VARIATION * Math.sin(3 * 2 * Math.PI * even);
}

function positionAt(index: number): GeographicPosition {
  const angle = 2 * Math.PI * turnsAt(index);
  const perDegreeLongitude =
    METRES_PER_DEGREE_LATITUDE * Math.cos((CENTRE_LATITUDE * Math.PI) / 180);
  return geographicPosition(
    degreesLatitude(
      CENTRE_LATITUDE + (RADIUS_METRES * Math.sin(angle)) / METRES_PER_DEGREE_LATITUDE,
    ),
    degreesLongitude(CENTRE_LONGITUDE + (RADIUS_METRES * Math.cos(angle)) / perDegreeLongitude),
  );
}

/**
 * The elevation of point `index`, in metres.
 *
 * A single sine over the lap, so the summit is a rounded top rather than a
 * vertex: a route whose hill came to a point would be measuring the profile's
 * median filter against a shape no road has.
 */
function elevationAt(index: number): number {
  return MEAN_ELEVATION_METRES + HILL_AMPLITUDE_METRES * Math.sin(2 * Math.PI * turnsAt(index));
}

/**
 * A GPX 1.1 route: one `<rte>`, no `<trk>`, no times anywhere.
 *
 * The closing point repeats the first exactly, which is what a planner writes
 * for a loop and what lets the profile's `loop` check be a real measurement
 * rather than a rounding tolerance.
 */
export function loopRouteGpx(): XmlFixture {
  const positions: GeographicPosition[] = [];
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<gpx version="1.1" creator="${CREATOR}" xmlns="${GPX_NAMESPACE}">`,
    '  <metadata>',
    `    <name>${ROUTE_NAME}</name>`,
    '  </metadata>',
    '  <rte>',
    `    <name>${ROUTE_NAME}</name>`,
    '    <type>cycling</type>',
  ];
  for (let index = 0; index <= POINT_COUNT; index += 1) {
    // The last point is the first, written from index 0 rather than from
    // POINT_COUNT, so the two are byte-identical and the loop truly closes.
    const at = index === POINT_COUNT ? 0 : index;
    const position = positionAt(at);
    positions.push(position);
    lines.push(
      `    <rtept lat="${degrees(position.latitude)}" lon="${degrees(position.longitude)}">`,
      `      <ele>${decimal(elevationAt(at), 1)}</ele>`,
      '    </rtept>',
    );
  }
  lines.push('  </rte>', '</gpx>');
  return { text: document(lines), positions };
}
