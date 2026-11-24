// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The route planner's roads, asked of Valhalla on this machine** (#2008,
 * ADR 0010 D-4): the one module here that talks to the routing engine, and
 * the translation between the app's words and the engine's numbers.
 *
 * Valhalla (MIT) runs as its own process — the home deployment's `routing`
 * service — and is reached over HTTP, so nothing of it is linked and its
 * licence attaches to nothing here. Its API has **no authentication** and
 * answers anything about any place, so:
 *
 * - its address is local or refused (`config.ts` §`readRoutingSettings`), and
 *   every request checks again where the name resolved to and goes to that
 *   address, as the history index's model does (`history/address.ts`);
 * - only signed-in riders reach it, sealed and rate limited
 *   (`routing/routing.ts`), and never a coordinate reaches a log line.
 *
 * ## The translation — the table `apps/web/src/routing/preferences.ts` records
 *
 * | The app | Valhalla `costing_options.bicycle` |
 * |---|---|
 * | `bicycle` | `bicycle_type`: `road`, `hybrid`, `city`, `cross`, `mountain` — the same words |
 * | `hills` `avoid` / `neutral` / `seek` | `use_hills` 0 / 0.25 (the engine's default) / 1 |
 * | `surface` `any` / `prefer-paved` / `paved-only` | `avoid_bad_surfaces` 0 / 0.25 / 1 |
 *
 * At `avoid_bad_surfaces: 1` the engine refuses a bad surface at the end
 * points too, so with `paved-only` a waypoint it cannot place on a road is
 * answered `unpaved_endpoint` rather than `no_route` (#70: *"a silent no-route
 * is the failure being prevented"*).
 *
 * ## What a leg's surface is
 *
 * `/route` says nothing about surfaces, so each leg's shape is walked again
 * with `/trace_attributes` (`edge.surface`, `edge.length`). Valhalla's
 * `paved_smooth`, `paved` and `paved_rough` are paved; `compacted`, `dirt`,
 * `gravel`, `path` and `impassable` are not; an edge with none is unknown. A
 * leg is **`unpaved`** when at least {@link UNPAVED_SHARE} of its length is,
 * **`paved`** when at least {@link PAVED_SHARE} is, and **`unknown`**
 * otherwise — never assumed paved (#70, #72). A walk that fails leaves the leg
 * `unknown`; it does not fail the route.
 *
 * ## Heights
 *
 * `/height` with `range: true` and the caller's interval: `[metres along,
 * metres high]` pairs, `null` where the terrain tiles have no data — a void,
 * passed on as one (#72). The tiles are Tilezen's (`valhalla_build_elevation`
 * downloads them for the graph's area), named in {@link ELEVATION_DATASET} so
 * a route records what its heights came from.
 */

import type {
  BicycleKind,
  HillPreference,
  RidingPreferences,
  SurfaceKind,
  SurfaceTolerance,
} from '@onyourleft/domain';

import { localAddressesOnly, type Resolver } from '../history/address.ts';

/** How long one engine call may take before the rider is told to try again. */
export const ROUTING_TIMEOUT_MILLISECONDS = 15_000;

/** A leg at least this share unpaved is `unpaved`. */
export const UNPAVED_SHARE = 0.05;

/** A leg at least this share paved, and under {@link UNPAVED_SHARE} unpaved, is `paved`. */
export const PAVED_SHARE = 0.95;

/**
 * What the heights come from: Tilezen's terrain tiles, the 1-arc-second grid
 * `valhalla_build_elevation` downloads (about 30 m). In the United States
 * their source is the USGS 3D Elevation Program; elsewhere a mix, which
 * `docs/operating-an-instance.md` §"Road routing" names with its notices.
 */
export const ELEVATION_DATASET = {
  name: 'Tilezen terrain tiles',
  resolutionMetres: 30,
} as const;

/** A point as the instance passes it: degrees, latitude first. */
export type LatLon = readonly [latitude: number, longitude: number];

/** One routed leg, in the shape the route answers. */
export interface EngineLeg {
  readonly shape: readonly LatLon[];
  readonly distanceMetres: number;
  readonly surface: SurfaceKind;
}

/** Why the engine gave no route. The route maps each to its error code. */
export type EngineFailure =
  /** No road joins the points, or one is nowhere near a road. */
  | 'no-route'
  /** As `no-route`, with `paved-only` asked for: an end point is on a bad surface. */
  | 'unpaved-endpoint'
  /** The engine could not be reached, timed out, or failed itself. */
  | 'unreachable'
  /** It answered, but not with something this program will pass on. */
  | 'malformed';

export type EngineOutcome<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly why: EngineFailure };

/** The two questions the instance asks of a routing engine. */
export interface RoutingEngine {
  route(
    waypoints: readonly LatLon[],
    preferences: RidingPreferences,
    signal: AbortSignal,
  ): Promise<EngineOutcome<readonly EngineLeg[]>>;
  heights(
    shape: readonly LatLon[],
    intervalMetres: number,
    signal: AbortSignal,
  ): Promise<EngineOutcome<readonly (readonly [number, number | null])[]>>;
}

export interface ValhallaOptions {
  /** Valhalla's origin, from `OYL_INSTANCE_ROUTING_URL`. */
  readonly endpoint: URL;
  readonly resolve: Resolver;
  /** The platform's `fetch` unless a test hands its own. */
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMilliseconds?: number;
}

const BICYCLE_TYPE: Readonly<Record<BicycleKind, string>> = {
  road: 'road',
  hybrid: 'hybrid',
  city: 'city',
  cross: 'cross',
  mountain: 'mountain',
};

const USE_HILLS: Readonly<Record<HillPreference, number>> = { avoid: 0, neutral: 0.25, seek: 1 };

const AVOID_BAD_SURFACES: Readonly<Record<SurfaceTolerance, number>> = {
  any: 0,
  'prefer-paved': 0.25,
  'paved-only': 1,
};

/** The bicycle costing Valhalla is asked with, from the rider's named options. */
export function bicycleCosting(preferences: RidingPreferences): Record<string, unknown> {
  return {
    bicycle_type: BICYCLE_TYPE[preferences.bicycle],
    use_hills: USE_HILLS[preferences.hills],
    avoid_bad_surfaces: AVOID_BAD_SURFACES[preferences.surface],
  };
}

const PAVED: ReadonlySet<unknown> = new Set(['paved_smooth', 'paved', 'paved_rough']);
const UNPAVED: ReadonlySet<unknown> = new Set([
  'compacted',
  'dirt',
  'gravel',
  'path',
  'impassable',
]);

/** A leg's surface from its edges' surfaces and lengths. @see the file comment. */
export function legSurface(
  edges: readonly { readonly surface?: unknown; readonly length?: unknown }[],
): SurfaceKind {
  let paved = 0;
  let unpaved = 0;
  let total = 0;
  for (const edge of edges) {
    const length = typeof edge.length === 'number' && edge.length > 0 ? edge.length : 0;
    total += length;
    if (PAVED.has(edge.surface)) paved += length;
    else if (UNPAVED.has(edge.surface)) unpaved += length;
  }
  if (!(total > 0)) return 'unknown';
  if (unpaved / total >= UNPAVED_SHARE) return 'unpaved';
  if (paved / total >= PAVED_SHARE) return 'paved';
  return 'unknown';
}

/** Google's polyline encoding at 6 decimal places, as Valhalla writes a shape. */
export function decodePolyline6(text: string): LatLon[] | undefined {
  const points: LatLon[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  const next = (): number | undefined => {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (index >= text.length) return undefined;
      const byte = text.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) return undefined;
      result |= (byte & 0x1f) << shift;
      shift += 5;
      if (byte < 0x20) break;
      if (shift > 30) return undefined;
    }
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < text.length) {
    const dLat = next();
    const dLon = next();
    if (dLat === undefined || dLon === undefined) return undefined;
    latitude += dLat;
    longitude += dLon;
    points.push([latitude / 1e6, longitude / 1e6]);
  }
  return points;
}

/** Valhalla's error codes that mean "no route", read 2026-11-24 from its error code table. */
const NO_ROUTE_CODES: ReadonlySet<unknown> = new Set([
  // loki: no edges near a location, or none the costing allows.
  170, 171, 172,
  // thor: no path between the locations.
  442, 443,
  // A route longer than the bicycle limit.
  154,
]);

function isLatLon(value: unknown): value is LatLon {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    Math.abs(value[0]) <= 90 &&
    Math.abs(value[1]) <= 180
  );
}

/** A local Valhalla, called over HTTP. @see the file comment. */
export function createValhalla(options: ValhallaOptions): RoutingEngine {
  const request = options.fetch ?? globalThis.fetch.bind(globalThis);
  const timeout = options.timeoutMilliseconds ?? ROUTING_TIMEOUT_MILLISECONDS;

  /** POST `body` to one of Valhalla's actions; the parsed answer and its status, or why not. */
  async function call(
    action: 'route' | 'trace_attributes' | 'height',
    body: unknown,
    signal: AbortSignal,
  ): Promise<{ status: number; json: unknown } | { failed: EngineFailure }> {
    const checked = await localAddressesOnly(options.endpoint.hostname, options.resolve);
    if (!checked.ok) return { failed: 'unreachable' };
    const host = checked.address.includes(':') ? `[${checked.address}]` : checked.address;
    const port = options.endpoint.port === '' ? '' : `:${options.endpoint.port}`;
    let response: Response;
    try {
      response = await request(`${options.endpoint.protocol}//${host}${port}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
      });
    } catch {
      return { failed: 'unreachable' };
    }
    if (response.status >= 500) return { failed: 'unreachable' };
    try {
      return { status: response.status, json: await response.json() };
    } catch {
      return { failed: 'malformed' };
    }
  }

  async function surfaceOf(shape: string, signal: AbortSignal): Promise<SurfaceKind> {
    const answer = await call(
      'trace_attributes',
      {
        encoded_polyline: shape,
        shape_match: 'edge_walk',
        costing: 'bicycle',
        filters: { attributes: ['edge.surface', 'edge.length'], action: 'include' },
      },
      signal,
    );
    if ('failed' in answer || answer.status !== 200) return 'unknown';
    const edges = (answer.json as { edges?: unknown } | null)?.edges;
    return Array.isArray(edges) ? legSurface(edges as { surface?: unknown }[]) : 'unknown';
  }

  return {
    async route(waypoints, preferences, signal) {
      const answer = await call(
        'route',
        {
          locations: waypoints.map(([lat, lon]) => ({ lat, lon })),
          costing: 'bicycle',
          costing_options: { bicycle: bicycleCosting(preferences) },
          directions_type: 'none',
          units: 'kilometers',
        },
        signal,
      );
      if ('failed' in answer) return { ok: false, why: answer.failed };
      if (answer.status !== 200) {
        const code = (answer.json as { error_code?: unknown } | null)?.error_code;
        if (!NO_ROUTE_CODES.has(code)) return { ok: false, why: 'malformed' };
        const stranded = preferences.surface === 'paved-only' && code === 171;
        return { ok: false, why: stranded ? 'unpaved-endpoint' : 'no-route' };
      }
      const trip = (answer.json as { trip?: { legs?: unknown; units?: unknown } } | null)?.trip;
      if (
        trip?.units !== 'kilometers' ||
        !Array.isArray(trip.legs) ||
        trip.legs.length !== waypoints.length - 1
      ) {
        return { ok: false, why: 'malformed' };
      }
      const legs: EngineLeg[] = [];
      for (const leg of trip.legs as { shape?: unknown; summary?: { length?: unknown } }[]) {
        const length = leg.summary?.length;
        const shape = typeof leg.shape === 'string' ? decodePolyline6(leg.shape) : undefined;
        if (
          shape === undefined ||
          shape.length < 2 ||
          !shape.every(isLatLon) ||
          typeof length !== 'number' ||
          !Number.isFinite(length) ||
          length < 0
        ) {
          return { ok: false, why: 'malformed' };
        }
        legs.push({
          shape,
          distanceMetres: length * 1000,
          surface: await surfaceOf(leg.shape as string, signal),
        });
      }
      return { ok: true, value: legs };
    },

    async heights(shape, intervalMetres, signal) {
      const answer = await call(
        'height',
        {
          shape: shape.map(([lat, lon]) => ({ lat, lon })),
          range: true,
          resample_distance: intervalMetres,
          height_precision: 1,
        },
        signal,
      );
      if ('failed' in answer) return { ok: false, why: answer.failed };
      if (answer.status !== 200) return { ok: false, why: 'malformed' };
      const pairs = (answer.json as { range_height?: unknown } | null)?.range_height;
      if (!Array.isArray(pairs) || pairs.length === 0) return { ok: false, why: 'malformed' };
      const samples: (readonly [number, number | null])[] = [];
      for (const pair of pairs as unknown[]) {
        if (!Array.isArray(pair) || pair.length !== 2) return { ok: false, why: 'malformed' };
        const [along, height] = pair as [unknown, unknown];
        if (typeof along !== 'number' || !Number.isFinite(along) || along < 0) {
          return { ok: false, why: 'malformed' };
        }
        if (height !== null && (typeof height !== 'number' || !Number.isFinite(height))) {
          return { ok: false, why: 'malformed' };
        }
        samples.push([along, height]);
      }
      return { ok: true, value: samples };
    },
  };
}
