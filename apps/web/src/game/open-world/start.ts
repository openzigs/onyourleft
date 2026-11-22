// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Where an open-world ride starts** — #2889, under ADR 0090 D-7 and the
 * owner's Q5 of 2026-11-19: *"Pin first, address later"*.
 *
 * Three sources, one shape. A pin on the map, a saved route's first point and
 * a past ride's first recorded point each become an {@link OpenWorldStart}
 * through {@link openWorldStart}, and nothing else makes one. The session
 * (#2896) takes it from `entry.ts` and snaps it to a street there, not here.
 *
 * ⚠️ **The start is location data, and it stays on the device.** Nothing here
 * logs it, stores it or sends it; the only thing that ever leaves is the coarse
 * block read ADR 0090 D-2 allows, which the session makes. A refusal names the
 * constraint and never the value (ADR 0004 D): {@link describeStartRefusal} is
 * the only place one becomes words, and no word of it is a number.
 */

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  type GeographicPosition,
} from '@onyourleft/domain';

/** Which of the three ways the rider chose the start. */
export type OpenWorldStartSource = 'pin' | 'route' | 'ride';

/** Where an open-world ride starts. The one shape every source produces. */
export interface OpenWorldStart {
  readonly position: GeographicPosition;
  readonly source: OpenWorldStartSource;
}

/** Why a place cannot start an open-world ride. */
export type OpenWorldStartRefusal =
  /** Outside the map's coverage: the basemap archive holds streets in the US only (ADR 0090 D-7.3). */
  | 'outside-coverage'
  /** There was no position to start from: a ride recorded indoors, or a route with no line. */
  | 'no-position';

export type OpenWorldStartOutcome =
  | { readonly kind: 'start'; readonly start: OpenWorldStart }
  | { readonly kind: 'refused'; readonly refusal: OpenWorldStartRefusal };

/** A box of longitude and latitude, west to east and south to north. */
interface CoverageBox {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

/**
 * Where the published basemap has streets, as boxes: the contiguous United
 * States, Alaska (both sides of the antimeridian, for the Aleutians) and
 * Hawaii — `map/basemap.ts` §`PUBLISHED_BASEMAP_URL`, the archive ADR 0062
 * clipped to the US extract's outline.
 *
 * ⚠️ **Boxes, not the outline**, so a pin just over the border in Canada or
 * Mexico is let through here. That costs nothing a pin inside the US would not:
 * the archive holds no tile there, the start's block reads come back empty,
 * and the session says the start has no street (#2896), which is the edge of
 * the map (#2908). What this check refuses is a start with no chance of a
 * street at all, before anything is requested for it.
 */
export const US_BASEMAP_COVERAGE: readonly CoverageBox[] = [
  { west: -125, south: 24, east: -66, north: 50 },
  { west: -180, south: 51, east: -129, north: 72 },
  { west: 172, south: 51, east: 180, north: 54 },
  { west: -161, south: 18.5, east: -154, north: 22.5 },
];

/** Whether `position` is inside {@link US_BASEMAP_COVERAGE}. */
export function insideCoverage(position: GeographicPosition): boolean {
  const { latitude, longitude } = position;
  return US_BASEMAP_COVERAGE.some(
    (box) =>
      longitude >= box.west &&
      longitude <= box.east &&
      latitude >= box.south &&
      latitude <= box.north,
  );
}

/**
 * The one way a start is made: from a position and the source it came from,
 * or a refusal. A position that is not a finite place is `no-position`.
 */
export function openWorldStart(
  position: GeographicPosition | undefined,
  source: OpenWorldStartSource,
): OpenWorldStartOutcome {
  if (
    position === undefined ||
    !Number.isFinite(position.latitude) ||
    !Number.isFinite(position.longitude)
  ) {
    return { kind: 'refused', refusal: 'no-position' };
  }
  if (!insideCoverage(position)) return { kind: 'refused', refusal: 'outside-coverage' };
  return {
    kind: 'start',
    start: {
      position: geographicPosition(
        degreesLatitude(position.latitude),
        degreesLongitude(position.longitude),
      ),
      source,
    },
  };
}

/**
 * A refusal in words. Names the constraint, never the value (ADR 0004 D):
 * `start.test.ts` holds every one to containing no digit at all.
 */
export function describeStartRefusal(
  refusal: OpenWorldStartRefusal,
  source: OpenWorldStartSource,
): string {
  if (refusal === 'outside-coverage') {
    return source === 'pin'
      ? 'That pin is outside the map: an open-world ride can start only in the United States, where the map has streets.'
      : source === 'route'
        ? 'That route starts outside the map: an open-world ride can start only in the United States, where the map has streets.'
        : 'That ride starts outside the map: an open-world ride can start only in the United States, where the map has streets.';
  }
  return source === 'ride'
    ? 'That ride has no recorded position to start from: it was ridden indoors or without GPS.'
    : source === 'route'
      ? 'That route has no line to start from.'
      : 'There is no pin on the map yet.';
}

/**
 * How far one press of a pin's nudge moves it, in degrees: about **55 m**
 * north or south, the route planner's nudge (`views/RouteBuilderView.tsx`
 * §`NUDGE_DEGREES`), so the two screens move a point alike.
 */
export const PIN_NUDGE_DEGREES = 0.0005;

/** The four ways a pin is nudged by key. */
export type PinNudge = 'north' | 'south' | 'east' | 'west';

/**
 * The pin moved one nudge. East and west are scaled by the latitude, so a
 * press moves the pin about the same distance on the ground either way.
 */
export function nudgePin(position: GeographicPosition, direction: PinNudge): GeographicPosition {
  const scale = Math.max(0.1, Math.cos((position.latitude * Math.PI) / 180));
  const north = direction === 'north' ? 1 : direction === 'south' ? -1 : 0;
  const east = direction === 'east' ? 1 : direction === 'west' ? -1 : 0;
  const latitude = Math.max(-85, Math.min(85, position.latitude + north * PIN_NUDGE_DEGREES));
  let longitude = position.longitude + (east * PIN_NUDGE_DEGREES) / scale;
  if (longitude > 180) longitude -= 360;
  if (longitude < -180) longitude += 360;
  return geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude));
}
