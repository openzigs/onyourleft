// SPDX-License-Identifier: Apache-2.0

/**
 * The engine-agnostic routing interface — [#70](https://github.com/openzigs/onyourleft/issues/70).
 *
 * ## Why this is in `packages/domain` and the engine is not
 *
 * [ADR 0010](../../../../docs/adr/0010-map-tiles-and-routing.md) D-4 chooses
 * **Valhalla, MIT, self-hosted, reached over HTTP as a separate process**, and
 * spends most of its length on *why the shape of that choice is the licence
 * question*: nothing is linked, so the engine's licence attaches to nothing
 * here. What it then says about this file is the part that decides where it
 * lives — *"the interface outlives the transport… the moment anyone wants an
 * offline or in-browser route, a permissive engine can be compiled in and a GPL
 * one cannot"*.
 *
 * So the interface is here, in the Apache-2.0 leaf where a permissive engine
 * could one day be compiled in, and the **HTTP adapter is in `apps/web`**,
 * where `fetch` is allowed to exist.
 *
 * ⚠️ **That split is what discharges #70's first criterion, and it is enforced
 * by a rule that already exists rather than by a new one.** The criterion asks
 * that *"no engine-specific type appears above the interface — a lint-enforced
 * import boundary proves it, not a code review"*. `eslint.config.js`'s
 * `boundaries/dependencies` block forbids any import from `packages/*` into
 * `apps/*`, in both the relative and the workspace spelling, so a Valhalla type
 * reaching this file is a lint error and not a review note. The second half is
 * `packages/domain`'s own closure (CLAUDE.md §4d): with `lib: ["ES2024"]` and
 * `types: []` this file could not name `fetch`, `Response` or `URL` even if
 * somebody wanted it to.
 *
 * ## What this interface does not have
 *
 * **Turn-by-turn instructions**, because #55 puts navigation out of scope.
 * **Popularity weighting**, because no open engine has it, ADR 0010 D-4 repeats
 * #70's *"do not promise it"*, and an interface method is a promise.
 * **An isochrone or a matrix**, because nothing asks for one yet and a method
 * with no caller is an untested method.
 */

import type { AltitudeMetres, GeographicPosition, Metres } from '../quantities';

/**
 * What a rider chose, in words rather than in an engine's numbers.
 *
 * ⚠️ #70: *"bicycle costing parameters are exposed as named product options,
 * not raw engine numbers, and the mapping is documented. `use_hills: 0.25` is
 * meaningless in a UI."* So this type carries no number an engine would
 * recognise, and the adapter that speaks to a particular engine owns the
 * translation — which is also what lets a second engine satisfy the same
 * interface without the screen learning a new vocabulary.
 */
export interface RidingPreferences {
  /** What the rider is on. Decides the default speed and what counts as rideable. */
  readonly bicycle: BicycleKind;
  /** How hard to work to avoid climbing. */
  readonly hills: HillPreference;
  /** What the rider will ride on. @see SurfaceTolerance */
  readonly surface: SurfaceTolerance;
}

export type BicycleKind = 'road' | 'hybrid' | 'city' | 'cross' | 'mountain';

/** `'seek'` deliberately exists: some riders are looking for the climb. */
export type HillPreference = 'avoid' | 'neutral' | 'seek';

/**
 * What the rider will ride on.
 *
 * ⚠️ **`'paved-only'` is the setting that can strand somebody**, and it is
 * named rather than expressed as a number so that the screen can say what it
 * does. ADR 0010 D-4's engine disallows bad surfaces *including at the
 * endpoints* at its strictest setting, so a rider whose own driveway is gravel
 * gets no route at all and no reason. The adapter raises
 * {@link RoutingErrorCode} `'unpaved-endpoint'` for exactly that, and #70
 * requires the client to refuse the setting or fall back visibly — *"a silent
 * no-route is the failure being prevented."*
 */
export type SurfaceTolerance = 'paved-only' | 'prefer-paved' | 'any';

/** What a leg was surfaced with, as the engine reported it. */
export type SurfaceKind = 'paved' | 'unpaved' | 'unknown';

/**
 * A point a rider put on the map.
 *
 * `freehand` legs never reach a provider at all — see {@link RouteRequest} —
 * so this type carries position and nothing else.
 */
export interface Waypoint {
  readonly position: GeographicPosition;
}

/** One leg to route: from one waypoint to the next. */
export interface RouteRequest {
  /** In order. Two or more; fewer is {@link RoutingErrorCode} `'invalid-request'`. */
  readonly waypoints: readonly Waypoint[];
  readonly preferences: RidingPreferences;
}

/**
 * The geometry an engine returned for one leg.
 *
 * ⚠️ **`surface` is `'unknown'` rather than `'paved'` when the engine did not
 * say**, and that is #70's and #72's shared rule stated at the type: *"a leg
 * with unknown surface is labelled unknown rather than assumed paved. Assuming
 * paved is how a road bike ends up on a gravel track."* There is no default
 * here to get wrong, because the field is not optional.
 */
export interface RoutedLeg {
  /**
   * The path the engine chose, start to end.
   *
   * Two points is a straight line, and a straight line between two pins is
   * exactly the regression #71's first criterion catches — so a caller that
   * cares asserts on the count rather than trusting it.
   */
  readonly shape: readonly GeographicPosition[];
  readonly distance: Metres;
  readonly surface: SurfaceKind;
}

/** One sampled height along a shape. */
export interface HeightSample {
  /** Distance from the start of the shape. */
  readonly along: Metres;
  /**
   * Absent where the elevation source has no data.
   *
   * ⚠️ **A void is `undefined`, never zero and never interpolated here.** ADR
   * 0010 D-5 records that the chosen DEM has holes — *"a small subset of tiles
   * covering specific countries are not yet released to the public"*, and ocean
   * cells have no tiles at all — and #72 requires the gap to be rendered *as* a
   * gap with ascent reported incomplete. Filling it at this boundary would
   * destroy the only evidence that it was ever a hole.
   */
  readonly elevation: AltitudeMetres | undefined;
}

export interface HeightRequest {
  readonly shape: readonly GeographicPosition[];
  /**
   * The distance between samples.
   *
   * ⚠️ **Required, not optional**, because #72's second criterion is that the
   * series is *"resampled to a uniform distance interval before ascent is
   * summed, and the interval is stated"* — summing an irregularly spaced series
   * inflates ascent by an arbitrary amount, which #72 calls the single largest
   * source of two products disagreeing about the same hill. A default here
   * would be an interval nobody stated.
   */
  readonly interval: Metres;
}

/**
 * What the elevation numbers came from.
 *
 * ⚠️ **Carried with the heights rather than assumed by the caller**, because
 * #72 requires the source and its resolution to be stored *with the route*:
 * two routes computed from different DEMs must never be compared, and without
 * this nobody can tell that they were. ADR 0010 D-5 makes it a licence
 * requirement as well as a data-integrity one — the Copernicus notice travels
 * with adapted data, so the name has to survive as far as the export.
 */
export interface ElevationDataset {
  /** As the operator would name it, e.g. `'Copernicus DEM GLO-30'`. */
  readonly name: string;
  /** The grid spacing of the source itself, not the sampling interval. */
  readonly resolution: Metres;
}

export interface HeightProfile {
  readonly source: ElevationDataset;
  readonly samples: readonly HeightSample[];
}

/**
 * An engine, behind the only two questions this program asks one.
 *
 * @throws {RoutingError} — every method, and nothing else. An adapter that lets
 * a `TypeError` or an engine's own error type escape has broken the interface,
 * because the caller's whole handling of failure switches on
 * {@link RoutingErrorCode}.
 */
export interface RoutingProvider {
  /**
   * One {@link RoutedLeg} per adjacent pair of waypoints, in order.
   *
   * ⚠️ **Legs out, not a route out**, and that is load-bearing rather than a
   * style choice: #71's second criterion is that moving one waypoint of a
   * five-waypoint route re-routes *only the two adjacent legs*, asserted by
   * counting calls. A method that answered with one merged polyline would make
   * that impossible to satisfy without re-routing everything.
   */
  route(request: RouteRequest): Promise<readonly RoutedLeg[]>;
  heights(request: HeightRequest): Promise<HeightProfile>;
}
