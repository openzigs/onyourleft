// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ride's line, as the geometry a map is handed.
 *
 * ## One segmentation, not two
 *
 * The runs this converts come from `detail/privacy.ts`'s `sharedTrack`, and
 * they come from it **for the owner's own whole track too** — called with no
 * zones, it trims nothing and splits only where the stored stream has a gap.
 * That is deliberate rather than convenient: it means the plain path and the
 * privacy path cannot diverge, so a future change to how a gap is decided
 * cannot fix one and leave the other drawing a line across a tunnel.
 *
 * ## A gap is a separate line, and that is structural
 *
 * #63's fifth criterion — *"recording gaps render as visible discontinuities in
 * the trace, not as straight lines across a tunnel or a paused segment"* — and
 * ADR 0004 decision B item 2, which is the stronger of the two: a renderer that
 * joins across a privacy-zone passage draws a chord whose perpendicular
 * bisector runs through the zone's centre, which hands an observer the thing
 * the zone exists to hide.
 *
 * A `MultiLineString` with one line per run is what makes that impossible
 * rather than merely avoided. There is no line between two members of a
 * `MultiLineString`; a renderer cannot draw one, and no styling option turns
 * one on. A single `LineString` with the gap's points omitted would draw
 * exactly the chord the ADR forbids, and would look correct in review.
 *
 * ## ⚠️ GeoJSON is `[longitude, latitude]`
 *
 * The opposite order from every other place in this program, and from how
 * anybody says it out loud. `packages/domain`'s `GeographicPosition` exists
 * precisely because a positional pair is a swap waiting for a careless read —
 * its own doc note says so — and this module is where the swap has to happen
 * once, on purpose, at a boundary a reviewer can see. It happens on the line
 * marked below and nowhere else. A transposed ride is drawn on the wrong
 * continent and throws nothing: London's 51.5074 N, 0.1278 W transposed is a
 * valid position in Kenya.
 */

import type { TrackSegment } from '../detail/privacy';

/** One `[longitude, latitude]` pair, in GeoJSON order. */
export type MapPosition = readonly [number, number];

/**
 * The ride's geometry.
 *
 * A `MultiLineString` even when there is only one run, so the shape a consumer
 * handles does not change with the data — a renderer written against
 * "sometimes a LineString" is a renderer with a branch that is exercised by
 * half the rides and never by a fixture.
 */
export interface TrackGeometry {
  readonly type: 'MultiLineString';
  readonly coordinates: readonly (readonly MapPosition[])[];
}

/** The geometry wrapped as a Feature, which is what a map source takes. */
export interface TrackFeature {
  readonly type: 'Feature';
  readonly geometry: TrackGeometry;
  readonly properties: Readonly<Record<string, never>>;
}

/**
 * Segments → geometry, or `undefined` when there is nothing to draw.
 *
 * `undefined` rather than an empty `MultiLineString`, because the two mean
 * different things to the panel above: nothing to draw is the indoor ride and
 * the wholly-trimmed ride, and both should render **no map at all** rather than
 * an empty one centred on wherever a default put it. #63's first criterion is
 * that exact failure, and #50 already answers it for the no-GPS case.
 *
 * A run of one point becomes a two-position line at the same coordinate. It is
 * valid GeoJSON — a `LineString` needs two positions — and a round line cap
 * draws it as a dot, which is the same choice `detail/TraceChart.tsx` makes for
 * an isolated reading and for the same reason: dropping it would be this
 * function deciding a real fix is noise.
 */
export function trackGeometry(segments: readonly TrackSegment[]): TrackGeometry | undefined {
  const coordinates: MapPosition[][] = [];
  for (const segment of segments) {
    const line: MapPosition[] = segment.points.map((point) => [
      // The one transposition in the program, at the boundary that owns it.
      // Named fields in, positional pair out, longitude first.
      point.position.longitude,
      point.position.latitude,
    ]);
    if (line.length === 0) {
      continue;
    }
    if (line.length === 1) {
      // Duplicated rather than dropped. See the note above.
      line.push(line[0] as MapPosition);
    }
    coordinates.push(line);
  }
  return coordinates.length === 0 ? undefined : { type: 'MultiLineString', coordinates };
}

/** The geometry as a Feature. `undefined` propagates. */
export function trackFeature(geometry: TrackGeometry | undefined): TrackFeature | undefined {
  return geometry === undefined ? undefined : { type: 'Feature', geometry, properties: {} };
}

/** West, south, east, north — the box a map fits itself to. */
export interface TrackBounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

/**
 * The bounding box of everything drawn.
 *
 * Computed from the geometry the map is **given**, never from the stored track.
 * ADR 0004 decision C names a bounding box among the position-derived summaries
 * that must not be computed from the true track: a box around the untrimmed
 * ride is a box whose corner is near the front door, and it would leak the
 * thing the trimming removed while the drawn line looked correct.
 *
 * ⚠️ **Does not cross the antimeridian.** A ride spanning ±180° gets a box the
 * long way round the world. That is a real limit and not worth code today — no
 * bike ride crosses it — but a segment matcher or a route importer might, and
 * this is where it would be wrong.
 */
export function trackBounds(geometry: TrackGeometry | undefined): TrackBounds | undefined {
  if (geometry === undefined) {
    return undefined;
  }
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  let seen = false;
  for (const line of geometry.coordinates) {
    for (const [longitude, latitude] of line) {
      seen = true;
      west = Math.min(west, longitude);
      east = Math.max(east, longitude);
      south = Math.min(south, latitude);
      north = Math.max(north, latitude);
    }
  }
  return seen ? { west, south, east, north } : undefined;
}
