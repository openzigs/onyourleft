// SPDX-License-Identifier: Apache-2.0

/**
 * The shape GPX and TCX share.
 *
 * ## One shape for both formats, and not `FitActivity`
 *
 * GPX and TCX carry the same ride. They disagree about where each channel lives
 * — GPX puts coordinates in attributes and everything interesting in
 * `<extensions>`, TCX puts coordinates in child elements and has laps natively
 * — but a track point is a track point. One shape means importing a GPX and
 * exporting it as TCX is two function calls with nothing in between, which is
 * what [#74](https://github.com/openzigs/onyourleft/issues/74) needs and what
 * makes "import, export, re-import" a test rather than a project.
 *
 * It is **not** `FitActivity`, for the same reason `FitActivity` is not
 * `ActivityRecord`: the mapping the sharing would remove does not exist to be
 * removed. A GPX file has no `file_id`, no `device_info`, no developer fields,
 * no `date_time` union — its times are always absolute instants, because XML
 * has no way to write "seconds since the device powered on" and no file does.
 * Reusing `FitActivity` would mean every GPX importer field being `undefined`
 * by construction, which is a shape that lies about what the format can hold.
 *
 * What **is** shared is the same thing `packages/fit` shares with everything
 * else: the units. Every measured value below is a `@onyourleft/domain`
 * quantity, the same branded type the FIT decoder produces, so GPX → store and
 * FIT → store are the same field rename.
 *
 * ## A gap is `undefined`
 *
 * Every field is optional and a missing one is `undefined`, never zero. Same
 * rule as ADR 0011 and the FIT decoder, and it matters more here: an indoor
 * TCX has no `<Position>` child at all, and a reader that substitutes zero puts
 * the ride in the Gulf of Guinea.
 */

import type {
  AltitudeMetres,
  BeatsPerMinute,
  DegreesCelsius,
  GeographicPosition,
  Metres,
  MetresPerSecond,
  RevolutionsPerMinute,
  Seconds,
  UnixSeconds,
  Watts,
} from '@onyourleft/domain';

import type { ActivityXmlError } from './errors';

/** One sample of a ride, as GPX or TCX can carry it. */
export interface TrackPoint {
  /** Always an absolute instant. Neither format can express anything else. */
  readonly timestamp: UnixSeconds | undefined;
  /** Absent when the file declares no position, which is the indoor case. */
  readonly position: GeographicPosition | undefined;
  readonly altitude: AltitudeMetres | undefined;
  readonly distance: Metres | undefined;
  readonly speed: MetresPerSecond | undefined;
  readonly heartRate: BeatsPerMinute | undefined;
  readonly cadence: RevolutionsPerMinute | undefined;
  readonly power: Watts | undefined;
  readonly temperature: DegreesCelsius | undefined;
}

/**
 * One lap.
 *
 * TCX has laps natively. GPX has none, and its `<trkseg>` is the nearest thing:
 * a segment is a run of points with no gap in it, which is what a lap boundary
 * usually is in practice. So a GPX import produces one lap per `<trkseg>` and a
 * GPX export writes one `<trkseg>` per lap — the count survives, the totals do
 * not, and `README.md` §7 says so in the lossy-channel table rather than here.
 */
export interface TrackLap {
  readonly startTime: UnixSeconds | undefined;
  readonly totalElapsedTime: Seconds | undefined;
  readonly totalDistance: Metres | undefined;
  readonly points: readonly TrackPoint[];
}

/** A whole activity, as GPX or TCX can carry it. */
export interface TrackActivity {
  readonly startTime: UnixSeconds | undefined;
  readonly name: string | undefined;
  /**
   * The sport, spelled the way the source file spelled it.
   *
   * Not normalised to an enumeration, deliberately. GPX's `<type>` is free text
   * and TCX's `Sport` attribute admits three values, and a reader that mapped
   * both onto one enumeration would have to choose what an unrecognised sport
   * becomes — and every available answer ("cycling", `undefined`, an error) is
   * wrong for somebody. The importer that cares (#37) can decide.
   */
  readonly sport: string | undefined;
  readonly creator: string | undefined;
  readonly laps: readonly TrackLap[];
}

/** What an import produced, and everything that was wrong with the document. */
export interface TrackDecodeResult {
  readonly activity: TrackActivity;
  /**
   * Recoverable faults, each naming a character offset. Empty for a clean file.
   *
   * Never merged into the activity, for the reason `FitDecodeResult` gives: a
   * caller that ignores this array gets the ride, and a caller that reads it can
   * tell a rider which samples did not survive.
   */
  readonly faults: readonly ActivityXmlError[];
}

/** Every point of an activity, in order, across its laps. */
export function trackPointsOf(activity: TrackActivity): readonly TrackPoint[] {
  return activity.laps.flatMap((lap) => lap.points);
}
