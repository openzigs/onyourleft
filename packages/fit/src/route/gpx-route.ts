// SPDX-License-Identifier: Apache-2.0

/**
 * Import a route from a GPX file — #89.
 *
 * The whole of it is: decode the document with the codec that already exists,
 * hand the points to `@onyourleft/domain`'s {@link routeProfile}, and turn the
 * two ways that can fail into one thing a rider can act on. #89 is explicit
 * that there is to be no second parser here — *"blocked by #32 (GPX parsing —
 * reuse it, do not write a second parser)"* — and the reason is more than
 * duplication: `src/xml/parse.ts` is where this program refuses a `<!DOCTYPE`,
 * and a route importer with its own reader would be a second front door with no
 * lock on it.
 *
 * ## Why it is in `packages/fit` and not in `packages/domain`
 *
 * `packages/domain` cannot depend on the codec — the codec depends on it — and
 * a profile is arithmetic that must not know what a file is. This module is the
 * one place the two meet, and it holds no logic of its own beyond the mapping
 * and the refusals below.
 */

import type { RouteProfile, RouteProfileOptions, RoutePoint } from '@onyourleft/domain';
import { RouteError, routeProfile } from '@onyourleft/domain';

import type { ActivityXmlError } from '../xml/errors';
import { decodeGpx } from '../xml/gpx';
import { trackPointsOf } from '../xml/track';

/** A route as a GPX document carried it, and the profile built from it. */
export interface DecodedRoute {
  /**
   * The `<name>` of the `<rte>` or `<trk>` the points came from.
   *
   * Absent rather than substituted: a planner that wrote no name has not named
   * the route, and inventing "Imported route" here would put a made-up string
   * where the rider's own naming belongs.
   */
  readonly name: string | undefined;
  readonly profile: RouteProfile;
  /**
   * Recoverable faults from the document — an unreadable coordinate, an
   * elevation that is not a number.
   *
   * Carried through rather than swallowed, for `TrackDecodeResult`'s reason: a
   * caller that ignores this gets the route, and a caller that reads it can tell
   * a rider which points did not survive. A route built from a document with
   * faults is still a route.
   */
  readonly faults: readonly ActivityXmlError[];
}

/**
 * Read a GPX route and build its profile.
 *
 * @throws {ActivityXmlError} for a document that is not well-formed, that
 * carries a DOCTYPE, that ends mid-element, or whose root is not `<gpx>`.
 * @throws {RouteError} for a well-formed document that does not describe a
 * route — see {@link RouteErrorCode}. #89's fourth criterion is that this is
 * *"an actionable message naming the problem, not a crash and not a silently
 * empty route"*, so every message below names what was looked for and where.
 */
export function decodeGpxRoute(text: string, options?: RouteProfileOptions): DecodedRoute {
  const { activity, faults } = decodeGpx(text);
  const decoded = trackPointsOf(activity);

  // A point with no coordinates is not a place, so it cannot be part of a line.
  // Dropped rather than refused: a single unreadable point in a thousand should
  // not cost the rider the route, and `faults` already carries the reason when
  // the document gave one.
  const points: RoutePoint[] = [];
  for (const point of decoded) {
    if (point.position === undefined) continue;
    points.push({ position: point.position, elevation: point.altitude });
  }

  if (points.length === 0) {
    throw new RouteError(
      'too-few-points',
      decoded.length === 0
        ? 'this GPX contains no route points: nothing was found inside a <rte> or a <trk>'
        : `this GPX has ${String(decoded.length)} route points and none of them carries a lat ` +
            'and lon pair, so there is no line to follow',
    );
  }

  return { name: activity.name, profile: routeProfile(points, options), faults };
}
