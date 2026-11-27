// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which engine routes a leg: the rider's instance, the in-browser engine, or
 * none and a straight line (#2734, ADR 0097 D-1).
 *
 * - **The instance, when this device is connected to one it can seal to and it
 *   answers.** It has the rider's own graph and the full costing (hills and
 *   surface), and its heights.
 * - **Else the in-browser engine**, when the build names a graph
 *   (`browser-graph.ts`). It is made on the first leg it is asked for, so with
 *   an instance that answers it is never made and its graph never fetched.
 * - **Else freehand.** With neither, {@link routingTiers} returns `undefined`
 *   and the planner draws straight lines, as it did before #2008.
 *
 * An instance that cannot be reached, or whose operator runs no routing
 * engine, answers `'unavailable'`, and only then does the leg go to the
 * browser. Any other answer from the instance (no route, a waypoint in a
 * privacy zone, a rate limit) is the answer: a leg the instance refused for a
 * privacy zone is not then sent anywhere else.
 *
 * ⚠️ **An instance's leg that does not reach its waypoints is drawn straight**
 * (#3179, `reach.ts`). The instance's Valhalla is sent no search cut-off, so a
 * waypoint its graph has no road near is snapped to one far away and the leg
 * comes back looking routed. Checked here, in the client, so an instance
 * running any version is held to it. The leg is not then sent to the browser
 * engine: its graph is no nearer to a road the instance's lacks, and a rider
 * with an instance does not load it for that.
 *
 * Heights follow the same order: the instance's own, else the terrain archive
 * read in the app (#2013), which the in-browser engine does not replace.
 *
 * ⚠️ **The in-browser engine is told the bicycle and nothing else** (its SDK
 * refuses `use_hills` and `avoid_bad_surfaces`; `valhalla-browser-provider.ts`
 * says how), so the tiers say how far the rider's surface and hills choices
 * reach ({@link TieredRouting.ridingChoices}) and the planner says it in words
 * ({@link ridingChoicesNote}) rather than show a choice as applied that is not.
 */

import {
  RoutingError,
  type HeightProfile,
  type HeightRequest,
  type Metres,
  type RoutedLeg,
  type RouteRequest,
  type RoutingProvider,
} from '@onyourleft/domain';

import type { RouteHeights } from '../terrain/heights';

import { FreehandFallback } from './draft';
import { reachesItsWaypoints } from './reach';

/** What the tiers are built from. Each is optional; a build may have none. */
export interface RoutingTiers {
  /** The instance's port, when this device can seal to one (`main.tsx` §`buildRoutingPort`). */
  readonly instance?: RoutingProvider | undefined;
  /** Makes the in-browser engine. Called at most once, on the first leg it is needed for. */
  readonly browser?: (() => ReleasableProvider) | undefined;
  /** The terrain archive's heights, for a route the instance does not answer. */
  readonly heights?: RouteHeights | undefined;
}

/**
 * The tiers as one provider, and the spacing its heights are asked at.
 *
 * `heightInterval` is the terrain archive's (15 m, matched to its pixels) when
 * there is no instance, so a route drawn with the in-browser engine is
 * measured as finely as a freehand one; `undefined` when the instance answers
 * heights, which are asked at the planner's own spacing.
 */
export interface TieredRouting extends RoutingProvider {
  readonly heightInterval: Metres | undefined;
  /**
   * How far the rider's surface and hills choices reach: `'applied'` when only
   * the instance routes, `'not-applied'` when only the in-browser engine does,
   * and `'not-on-fallback'` when the in-browser engine routes a leg the
   * instance cannot.
   */
  readonly ridingChoices: RidingChoicesReach;
  /** Lets the in-browser engine's worker and memory go, if it was made. The planner calls it as it closes. */
  release(): void;
}

/** See {@link TieredRouting.ridingChoices}. */
export type RidingChoicesReach = 'applied' | 'not-applied' | 'not-on-fallback';

/** A provider that may hold an engine to let go of (`valhalla-browser-provider.ts`). */
export type ReleasableProvider = RoutingProvider & { readonly release?: () => void };

/** The spacing a provider's heights are asked at, when it says; see {@link TieredRouting}. */
export function heightIntervalOf(provider: RoutingProvider): Metres | undefined {
  return 'heightInterval' in provider ? (provider as TieredRouting).heightInterval : undefined;
}

/** Said when the instance's line does not reach a waypoint (#3179). */
export const INSTANCE_NO_ROAD_NEAR_TEXT =
  "A waypoint of this leg is too far from any road on your instance's road map, so it is drawn as a straight line.";

/** The instance's legs, unless one does not reach its waypoints; see the header. */
function reachingLegs(request: RouteRequest, legs: readonly RoutedLeg[]): readonly RoutedLeg[] {
  legs.forEach((leg, index) => {
    const from = request.waypoints[index]?.position;
    const to = request.waypoints[index + 1]?.position;
    if (from === undefined || to === undefined || !reachesItsWaypoints(leg, from, to)) {
      throw new FreehandFallback(INSTANCE_NO_ROAD_NEAR_TEXT);
    }
  });
  return legs;
}

/** Said when no tier can give heights: the planner then saves the route flat. */
export const NO_HEIGHTS_TEXT = 'No elevation source is available for this route.';

/** Said under the surface choice when the in-browser engine routes every leg. */
export const CHOICES_NOT_APPLIED_TEXT =
  "The app's own road map routes these legs, and it can only be told which bicycle you ride: what you will ride on is not applied, and each leg's surface shows as unknown.";

/** Said under the surface choice when the in-browser engine routes a leg the instance cannot. */
export const CHOICES_NOT_ON_FALLBACK_TEXT =
  "A leg your instance cannot route is routed by the app's own road map instead, which does not apply what you will ride on.";

/** How far a provider applies the surface and hills choices; a provider that does not say applies them. */
export function ridingChoicesOf(provider: RoutingProvider): RidingChoicesReach {
  return 'ridingChoices' in provider ? (provider as TieredRouting).ridingChoices : 'applied';
}

/** The sentence the planner shows under the surface choice, or `undefined` when the choice applies. */
export function ridingChoicesNote(provider: RoutingProvider | undefined): string | undefined {
  if (provider === undefined) return undefined;
  switch (ridingChoicesOf(provider)) {
    case 'applied':
      return undefined;
    case 'not-applied':
      return CHOICES_NOT_APPLIED_TEXT;
    case 'not-on-fallback':
      return CHOICES_NOT_ON_FALLBACK_TEXT;
  }
}

/** Lets a provider's engine go when it says how ({@link TieredRouting.release}); any other, nothing. */
export function releaseRouting(provider: RoutingProvider | undefined): void {
  if (provider !== undefined && 'release' in provider) (provider as ReleasableProvider).release?.();
}

function unavailable(error: unknown): boolean {
  return error instanceof RoutingError && error.code === 'unavailable';
}

/** The tiers as one provider, or `undefined` when no engine routes at all. */
export function routingTiers(tiers: RoutingTiers): TieredRouting | undefined {
  const { instance, heights } = tiers;
  const makeBrowser = tiers.browser;
  if (instance === undefined && makeBrowser === undefined) return undefined;
  let browser: ReleasableProvider | undefined;

  const terrainHeights = (request: HeightRequest): Promise<HeightProfile> =>
    heights === undefined
      ? Promise.reject(new RoutingError('unavailable', NO_HEIGHTS_TEXT))
      : heights.heights(request);

  return {
    heightInterval: instance === undefined ? heights?.interval : undefined,
    ridingChoices:
      instance === undefined
        ? 'not-applied'
        : makeBrowser === undefined
          ? 'applied'
          : 'not-on-fallback',
    release: () => {
      browser?.release?.();
    },
    route: async (request) => {
      if (instance !== undefined) {
        let legs: readonly RoutedLeg[] | undefined;
        try {
          legs = await instance.route(request);
        } catch (error) {
          if (makeBrowser === undefined || !unavailable(error)) throw error;
        }
        if (legs !== undefined) return reachingLegs(request, legs);
      }
      // Only reached with a browser maker: with no instance it is there
      // (checked above), and an instance with none has rethrown its error.
      browser ??= makeBrowser!();
      return browser.route(request);
    },
    heights: async (request) => {
      if (instance !== undefined) {
        try {
          return await instance.heights(request);
        } catch (error) {
          if (heights === undefined || !unavailable(error)) throw error;
        }
      }
      return terrainHeights(request);
    },
  };
}
