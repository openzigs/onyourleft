// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Roads for a drawn route with no instance: Valhalla compiled to WebAssembly,
 * running in a worker on this device (#2734, ADR 0097).
 *
 * The one module under `src/` that may reach `valhalla-browser`
 * (`tools/valhalla/stays-out.test.ts` admits it and nothing else), and it
 * reaches it only through a dynamic `import()`, so the SDK, its worker and its
 * WebAssembly are fetched the first time a leg is routed and never by a rider
 * who does not draw a route.
 *
 * ## What the SDK can and cannot be asked
 *
 * `valhalla-browser` 0.2.1 takes **exactly two locations** a request, fixes
 * kilometres, English instructions and a 30 m correlation radius, and offers
 * no height, `trace_route` or isochrone. So:
 *
 * - a request of N waypoints is N − 1 requests in series, which is the
 *   planner's per-leg model already (`draft.ts` §`resolveDraft`);
 * - {@link RoutingProvider.heights} is not answered here: the tier choice
 *   (`tiers.ts`) asks the terrain archive instead;
 * - of a rider's preferences only the bicycle reaches the engine
 *   (`bicycle_type`). The SDK's request check refuses every bicycle option but
 *   `bicycle_type`, `cycling_speed` and `use_roads` ("Unsupported option"), so
 *   `use_hills` and `avoid_bad_surfaces` cannot be sent: the hills and surface
 *   choices are not applied, the planner says so under its surface choice
 *   (`tiers.ts` §`ridingChoicesNote`), and every leg's surface is
 *   `'unknown'`: never assumed paved (#70, #72).
 *
 * ## The settings spike 0035 measured
 *
 * The `individual-tiles` transport (the only one the HTTP cache reused), a
 * 128 MiB decoded-tile budget (the 32 MiB default livelocked on long routes),
 * the SDK's longest per-fetch deadline, and an `AbortSignal` that gives up on
 * a leg after {@link LEG_TIMEOUT_MS}.
 *
 * ## One leg at a time, and the engine let go when the planner closes
 *
 * Aborting one `route()`'s signal terminates the SDK's worker and rejects
 * every route queued behind it. The planner starts a `resolveDraft` per edit,
 * and they overlap when a rider clicks quickly, so the legs are queued here
 * instead: only one is ever in the SDK, its deadline is started when it runs
 * rather than when it was queued, and one leg's deadline cannot cancel
 * another. {@link BrowserRoutingProvider.release} calls the SDK's `cancel()`,
 * which ends the worker and frees its tile cache and WebAssembly heap; the
 * router stays usable, and the next leg starts a new worker.
 *
 * Each release also starts a new generation. A leg of an older one that has
 * not yet reached the SDK (still in the queue, or waiting for the engine to
 * load) settles without reaching it, so a closed planner's remaining legs do
 * not start a worker nobody is looking at. A cancel deferred until the engine
 * has loaded cannot reach a leg of the planner opened since: that leg is
 * queued behind the closed planner's, which waits on the same load, and the
 * cancel was attached to the load before either, so it runs first. The test
 * "released while the engine loads" holds both halves.
 *
 * ## A refusal is a straight line, not a broken leg
 *
 * When the engine cannot route a leg here and now (outside the graph, too
 * large for its memory, too slow, the graph not loadable, map tiles off) it
 * raises a {@link FreehandFallback}, and the planner draws that leg freehand
 * with the reason on it. Only a graph that holds both ends and finds no path
 * between them answers `'no-route'`, which the rider fixes by moving a point.
 *
 * ⚠️ **No message here names a coordinate or a place** (ADR 0004 D). Each is a
 * fixed sentence, and the SDK's own text, which can carry a tile URL, is never
 * shown.
 */

import {
  checkedLeg,
  RoutingError,
  type BicycleKind,
  type HeightProfile,
  type RawPosition,
  type RoutedLeg,
  type RouteRequest,
  type RoutingProvider,
} from '@onyourleft/domain';

import type { RoutingGraphConfig } from './browser-graph';
import { FreehandFallback } from './draft';

/** The SDK's largest decoded-tile budget, which spike 0035 needed for a 150 km route. */
export const TILE_BUDGET_BYTES = 128 * 1024 * 1024;

/** The SDK's longest per-fetch deadline, so a large tile on a slow link is slow rather than an error. */
export const FETCH_TIMEOUT_MS = 60_000;

/**
 * How long one leg may take, start-up included: **90 s**. The tablet's 150 km
 * cold route took 19.1 s (#2009, 2026-11-08); a leg a rider draws by hand is
 * shorter, and past this the rider is better served by a straight line now.
 */
export const LEG_TIMEOUT_MS = 90_000;

/** Said when a leg runs outside the graph the app routes on. */
export const OUTSIDE_GRAPH_TEXT =
  "This leg is outside the area the app's own road map covers, so it is drawn as a straight line.";

/** Said when the engine runs out of the memory it is given on this device. */
export const TOO_LARGE_TEXT =
  'This leg is too long to follow roads on this device, so it is drawn as a straight line. Add a waypoint part way along to split it.';

/** Said when a leg takes too long. */
export const TOO_SLOW_TEXT =
  'Following roads took too long on this leg, so it is drawn as a straight line.';

/** Said when the graph or the engine could not be loaded: offline, a host error, a changed file. */
export const NOT_LOADED_TEXT =
  "The app's road map couldn't be loaded right now, so this leg is drawn as a straight line.";

/** Said with map tiles off (ADR 0054 D-6.4: one switch for everything the tile host is asked). */
export const TILES_OFF_TEXT =
  'Map tiles are turned off in Settings, so the road map is not downloaded and this leg is drawn as a straight line.';

/** What a leg of a closed planner settles with. Nobody reads it: the planner that asked is gone. */
export const RELEASED_TEXT = 'The route planner was closed before this leg was routed.';

/** Said when the graph holds both ends and has no path between them. */
export const NO_PATH_TEXT =
  'No route by road was found for this leg. Move one of its waypoints onto a road you can ride.';

/** The `bicycle_type` each of this program's bicycles asks for. The SDK has four; a city bike rides as a hybrid. */
export const BICYCLE_TYPES: Readonly<
  Record<BicycleKind, 'road' | 'cross' | 'hybrid' | 'mountain'>
> = {
  road: 'road',
  hybrid: 'hybrid',
  city: 'hybrid',
  cross: 'cross',
  mountain: 'mountain',
};

/** The one request this module sends: a bicycle route between two points. */
export interface BrowserRouteRequest {
  readonly costing: 'bicycle';
  readonly costing_options: {
    readonly bicycle: { readonly bicycle_type: 'road' | 'cross' | 'hybrid' | 'mountain' };
  };
  readonly locations: readonly [
    { readonly lat: number; readonly lon: number },
    { readonly lat: number; readonly lon: number },
  ];
}

/** What this module reads of the SDK's answer: the native trip, in kilometres and polyline6. */
export interface BrowserRouteResult {
  readonly native: {
    readonly trip: {
      readonly summary: { readonly length: number };
      readonly legs: readonly { readonly shape: string }[];
    };
  };
}

/** The part of the SDK's `Router` this module uses. */
export interface BrowserRouter {
  route(
    request: BrowserRouteRequest,
    options: { readonly signal: AbortSignal },
  ): Promise<BrowserRouteResult>;
  /** Rejects what is outstanding, ends the worker and frees its memory. The router stays usable. */
  cancel(): void;
}

/** The in-browser engine, which holds a worker and its memory until it is let go. */
export interface BrowserRoutingProvider extends RoutingProvider {
  /** Ends the worker and frees its memory, if one was started. The next leg starts another. */
  release(): void;
}

/** Makes the router. The default loads the SDK; a test passes its own. */
export type CreateBrowserRouter = (graph: RoutingGraphConfig) => Promise<BrowserRouter>;

export interface BrowserProviderOptions {
  readonly graph: RoutingGraphConfig;
  /** The map-tiles switch, read at every request (ADR 0054 D-6.4). */
  readonly mapTilesOn: () => boolean;
  readonly createRouter?: CreateBrowserRouter;
  readonly legTimeoutMs?: number;
}

/**
 * The SDK's router, loaded on the first leg. Its worker and WebAssembly are
 * the package's own files, which the bundler emits beside the chunk and the
 * SDK finds relative to it: served from this origin, never a CDN.
 */
export const loadBrowserRouter: CreateBrowserRouter = async (graph) => {
  const { Router } = await import('valhalla-browser');
  return new Router({
    manifestUrl: graph.manifestUrl,
    transport: 'individual-tiles',
    memoryBudgetBytes: TILE_BUDGET_BYTES,
    timeoutMs: FETCH_TIMEOUT_MS,
  }) as BrowserRouter;
};

/**
 * The in-browser engine as a {@link RoutingProvider}. Nothing is loaded and
 * nothing is fetched until the first leg is routed.
 */
export function valhallaBrowserProvider(options: BrowserProviderOptions): BrowserRoutingProvider {
  const create = options.createRouter ?? loadBrowserRouter;
  const legTimeoutMs = options.legTimeoutMs ?? LEG_TIMEOUT_MS;
  let router: Promise<BrowserRouter> | undefined;
  // Bumped by every release (see the header); a leg carries the one it was asked in.
  let generation = 0;
  // Every leg of every request, one at a time (see the header).
  let queue: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };

  const stale = (asked: number): boolean => asked !== generation;

  const routeLeg = async (
    request: RouteRequest,
    leg: number,
    asked: number,
  ): Promise<RoutedLeg> => {
    if (stale(asked)) throw new RoutingError('unavailable', RELEASED_TEXT, leg);
    const from = request.waypoints[leg]?.position;
    const to = request.waypoints[leg + 1]?.position;
    if (from === undefined || to === undefined) {
      throw new RoutingError('invalid-request', 'a route needs at least two waypoints');
    }
    if (!options.mapTilesOn()) throw new FreehandFallback(TILES_OFF_TEXT);
    router ??= create(options.graph).catch((error: unknown) => {
      // A failed start is not remembered: the next leg tries again.
      router = undefined;
      throw error;
    });
    let result: BrowserRouteResult;
    try {
      const engine = await router;
      if (stale(asked)) throw new RoutingError('unavailable', RELEASED_TEXT, leg);
      result = await engine.route(
        {
          costing: 'bicycle',
          costing_options: {
            bicycle: { bicycle_type: BICYCLE_TYPES[request.preferences.bicycle] },
          },
          locations: [
            { lat: from.latitude, lon: from.longitude },
            { lat: to.latitude, lon: to.longitude },
          ],
        },
        { signal: AbortSignal.timeout(legTimeoutMs) },
      );
    } catch (error) {
      // Our own refusal of a closed planner's leg passes through; the SDK's is translated.
      throw error instanceof RoutingError ? error : refusal(error, leg);
    }
    return legFrom(result, leg);
  };

  return {
    route: async (request) => {
      if (request.waypoints.length < 2) {
        throw new RoutingError('invalid-request', 'a route needs at least two waypoints');
      }
      const asked = generation;
      const legs: RoutedLeg[] = [];
      // One worker routes one leg at a time, so in series, and in turn with any other request's.
      for (let leg = 0; leg + 1 < request.waypoints.length; leg += 1) {
        legs.push(await inTurn(() => routeLeg(request, leg, asked)));
      }
      return legs;
    },
    release: () => {
      generation += 1;
      void router?.then(
        (engine) => {
          engine.cancel();
        },
        () => undefined,
      );
    },
    heights: (): Promise<HeightProfile> =>
      Promise.reject(
        new RoutingError(
          'unavailable',
          'The in-app road map has no heights; the terrain archive answers instead.',
        ),
      ),
  };
}

/** The SDK's error code, read without importing the SDK (it is loaded lazily). */
function sdkCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/** What the planner is told when the SDK refuses a leg. Never the SDK's own message. */
export function refusal(error: unknown, leg: number): RoutingError {
  switch (sdkCode(error)) {
    case 'NO_ROUTE':
    case 'LOCATION_NOT_FOUND':
      return new RoutingError('no-route', NO_PATH_TEXT, leg);
    case 'OUTSIDE_COVERAGE':
      return new FreehandFallback(OUTSIDE_GRAPH_TEXT);
    case 'RESOURCE_LIMIT':
      return new FreehandFallback(TOO_LARGE_TEXT);
    // CANCELLED too: our own deadline aborts the route, and the SDK reports that as cancelled.
    case 'TIMEOUT':
    case 'QUEUE_TIMEOUT':
    case 'CANCELLED':
      return new FreehandFallback(TOO_SLOW_TEXT);
    default:
      // NETWORK, DATASET and the rest: the engine or the graph is not usable here now.
      return new FreehandFallback(NOT_LOADED_TEXT);
  }
}

/** One routed leg from the SDK's answer, checked the way every engine's numbers are. */
export function legFrom(result: BrowserRouteResult, leg: number): RoutedLeg {
  const trip = result.native.trip;
  const shape = trip.legs[0]?.shape;
  if (trip.legs.length !== 1 || shape === undefined) {
    throw new RoutingError('malformed-response', 'the road map answered with no leg', leg);
  }
  return checkedLeg(
    { shape: decodePolyline6(shape), distance: trip.summary.length * 1000, surface: undefined },
    // `checkedLeg` numbers its messages from the leg it is given.
    leg,
  );
}

/**
 * Valhalla's polyline6: Google's encoded polyline at six decimal places.
 *
 * Stops one point past `limit`, so an answer far too long to draw costs no
 * more than `checkedLeg` needs in order to refuse it.
 */
export function decodePolyline6(encoded: string, limit = 20_001): RawPosition[] {
  const points: RawPosition[] = [];
  let at = 0;
  let latitude = 0;
  let longitude = 0;
  const next = (): number => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (at >= encoded.length)
        throw new RoutingError('malformed-response', 'the road map answered with a broken line');
      byte = encoded.charCodeAt(at) - 63;
      at += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && shift < 35);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (at < encoded.length && points.length < limit) {
    latitude += next();
    longitude += next();
    points.push({ latitude: latitude / 1e6, longitude: longitude / 1e6 });
  }
  return points;
}
