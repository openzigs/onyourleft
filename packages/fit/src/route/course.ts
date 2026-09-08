// SPDX-License-Identifier: Apache-2.0

/**
 * What both route exporters share — #74.
 *
 * ## What is actually exported, and what that costs
 *
 * ⚠️ **A route's exported geometry is its PROFILE GRID, not the points the file
 * it was imported from carried.** `RouteRecord` stores a `RouteProfile` and
 * nothing else (`packages/store/src/records.ts`), so by the time a route can be
 * exported the original sampling is gone. The grid is ~10 m spacing
 * (`PROFILE_RESOLUTION_METRES`), stretched so its last sample lands exactly on
 * the end, and it carries the **despiked** elevations rather than the raw ones.
 *
 * That is a real difference and it goes both ways. A 200-point planner file
 * comes back as a 500-point line that follows the same ground more evenly; a
 * file with one bad elevation reading comes back without it. What it is not is
 * a copy of the input, and a rider comparing the two byte for byte will find
 * they differ.
 *
 * ## The point count is not capped, and that is a decision
 *
 * #74 asks whether the exporter simplifies for head-unit point limits *"or does
 * not"*. **It does not.** Devices differ (Garmin's Edge line has historically
 * capped course points in the low tens of thousands, Wahoo's differently, and
 * both have changed across firmware), so a cap here would be a guess at one
 * device's limit applied to every device — and the failure it produces, a route
 * silently missing its last third, is worse than the one it prevents. A rider
 * whose device refuses a long route can re-import it with a coarser
 * `resolutionMetres`, which is the knob that actually controls this and is
 * already on `RouteProfileOptions`.
 *
 * {@link courseSampleCount} is what a caller uses to warn before it happens.
 *
 * ## Attribution
 *
 * ⚠️ **The OSM notice is on by default and that OVER-attributes on purpose.**
 * ODbL §4.3 requires attribution for a work produced from the database, and
 * this program cannot tell: a `RouteProfile` records no provenance, #71's
 * drawing canvas and #70's routing engine do not exist yet, and a route
 * imported from a planner's GPX was very likely snapped to OSM roads by that
 * planner. Attributing a route that owes OSM nothing credits a project that did
 * not contribute; omitting it on one that does breaches a share-alike licence.
 * The second is the worse failure, so the default is to attribute.
 *
 * It is a **parameter rather than a constant** because that reasoning stops
 * holding the moment a route can say where it came from. The fix is a
 * provenance field on `RouteRecord`, and #70 is the issue that should add it —
 * see ADR 0012, which establishes that a *recorded trace* carries no OSM
 * Contents and is why this question is about routes and not about rides.
 */

import type { RouteProfile } from '@onyourleft/domain';

/** A route, as an exporter needs it. The shape `decodeGpxRoute` returns, minus its faults. */
export interface ExportableRoute {
  /**
   * Absent rather than substituted, for `DecodedRoute.name`'s reason: a route
   * nobody named has no name, and "Untitled route" in a file is a made-up
   * string in the one field a rider will read on their device.
   */
  readonly name: string | undefined;
  readonly profile: RouteProfile;
}

/** How an exporter is told what to claim about where the route came from. */
export interface RouteExportOptions {
  /**
   * The attribution notice, or `null` for none.
   *
   * Defaults to {@link OSM_ATTRIBUTION}. Pass `null` only for a route whose
   * provenance is known not to involve OSM — which nothing in this program can
   * currently establish, so today that is a test's parameter and not a
   * screen's.
   */
  readonly attribution?: string | null | undefined;
  /** Overrides the `creator` written into the file. */
  readonly creator?: string | undefined;
}

/** ODbL §4.3's notice, in the wording OSM itself asks for. */
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

/** The licence the notice points at, for the formats with somewhere to put it. */
export const ODBL_LICENCE_URL = 'https://opendatacommons.org/licenses/odbl/1-0/';

/** What this program writes as the producing application. */
export const ROUTE_CREATOR = 'On Your Left';

/**
 * Something an export could not carry, or could carry only at a risk.
 *
 * The same shape and the same purpose as the activity exporter's faults: a
 * loss the rider can act on is told to them, and a loss they cannot act on is
 * not dressed up as one. An export **never fails** for a fault — the file is
 * still the route.
 */
export type RouteExportFaultCode =
  /**
   * TCX's `Course/Name` is a restricted token that devices are believed to
   * truncate at 15 characters.
   *
   * ⚠️ **Reported rather than applied.** Truncating here would be acting on a
   * schema constraint read from memory rather than from the XSD, which could
   * not be fetched from the environment this was written in — and a wrong
   * truncation silently renames the rider's route. Reporting is correct under
   * both readings: if the limit is real the rider is warned, and if it is not
   * they have lost nothing.
   */
  | 'tcx-name-may-be-truncated'
  /**
   * A course lap in TCX must carry a time and a route has none.
   *
   * Written as zero rather than estimated. An estimate would be a claim about
   * how fast this rider covers this route, and nothing in a `RouteProfile`
   * supports one — `packages/physics` could produce a number, but only from a
   * mass and a drag area this program does not hold.
   */
  | 'tcx-course-time-is-unknown'
  /**
   * Neither format has an element for gradient, so the profile's `grades` are
   * not written.
   *
   * Harmless and worth saying: the elevations *are* written, so a device
   * recomputes its own gradient from them and gets a slightly different answer
   * from ours — ours is a 100 m least-squares slope over despiked heights
   * (`packages/domain/src/route/profile.ts`), theirs is whatever they do.
   */
  | 'gradient-is-not-a-field';

export interface RouteExportFault {
  readonly code: RouteExportFaultCode;
  /** Plain enough to show a rider. Names no coordinate — ADR 0004 decision D. */
  readonly message: string;
}

/** An exported document and everything it could not carry. */
export interface RouteExportResult {
  readonly text: string;
  readonly faults: readonly RouteExportFault[];
}

/**
 * How many points a document for this route will contain.
 *
 * Exported so a screen can warn before a rider copies a file their device will
 * refuse, rather than after. It is `positions.length` and not a computation —
 * it exists to be a named thing a caller can compare against a limit it chooses.
 */
export function courseSampleCount(route: ExportableRoute): number {
  return route.profile.positions.length;
}

/** The gradient fault, which both formats always carry. */
export const GRADIENT_FAULT: RouteExportFault = {
  code: 'gradient-is-not-a-field',
  message:
    'Gradient is not written: neither GPX nor TCX has a field for it. Elevation is written, so ' +
    'your device works out its own gradient and may show slightly different numbers from this app.',
};
