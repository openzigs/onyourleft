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
 * Heights follow the same order: the instance's own, else the terrain archive
 * read in the app (#2013), which the in-browser engine does not replace.
 */

import {
  RoutingError,
  type HeightProfile,
  type HeightRequest,
  type Metres,
  type RoutingProvider,
} from '@onyourleft/domain';

import type { RouteHeights } from '../terrain/heights';

/** What the tiers are built from. Each is optional; a build may have none. */
export interface RoutingTiers {
  /** The instance's port, when this device can seal to one (`main.tsx` §`buildRoutingPort`). */
  readonly instance?: RoutingProvider | undefined;
  /** Makes the in-browser engine. Called at most once, on the first leg it is needed for. */
  readonly browser?: (() => RoutingProvider) | undefined;
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
}

/** The spacing a provider's heights are asked at, when it says; see {@link TieredRouting}. */
export function heightIntervalOf(provider: RoutingProvider): Metres | undefined {
  return 'heightInterval' in provider ? (provider as TieredRouting).heightInterval : undefined;
}

/** Said when no tier can give heights: the planner then saves the route flat. */
export const NO_HEIGHTS_TEXT = 'No elevation source is available for this route.';

/** Said if an instance that cannot route leaves no engine at all. */
const NO_ENGINE_TEXT = 'Your instance could not route this leg, and this app has no other way to.';

function unavailable(error: unknown): boolean {
  return error instanceof RoutingError && error.code === 'unavailable';
}

/** The tiers as one provider, or `undefined` when no engine routes at all. */
export function routingTiers(tiers: RoutingTiers): TieredRouting | undefined {
  const { instance, heights } = tiers;
  const makeBrowser = tiers.browser;
  if (instance === undefined && makeBrowser === undefined) return undefined;
  let browser: RoutingProvider | undefined;
  const inBrowser = (): RoutingProvider | undefined =>
    makeBrowser === undefined ? undefined : (browser ??= makeBrowser());

  const terrainHeights = (request: HeightRequest): Promise<HeightProfile> =>
    heights === undefined
      ? Promise.reject(new RoutingError('unavailable', NO_HEIGHTS_TEXT))
      : heights.heights(request);

  return {
    heightInterval: instance === undefined ? heights?.interval : undefined,
    route: async (request) => {
      if (instance !== undefined) {
        try {
          return await instance.route(request);
        } catch (error) {
          if (makeBrowser === undefined || !unavailable(error)) throw error;
        }
      }
      // With no instance the browser maker is there (checked above).
      const engine = inBrowser();
      if (engine === undefined) throw new RoutingError('unavailable', NO_ENGINE_TEXT);
      return engine.route(request);
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
