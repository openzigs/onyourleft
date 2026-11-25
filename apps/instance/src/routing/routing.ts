// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Road routing for a signed-in rider's route planner** (#2008): what the two
 * routes in `routing/routes.ts` hand a request to — the body read, the rider's
 * allowance counted, the engine asked, and one log line written that says how
 * it went and nothing about where.
 *
 * ## What it keeps: nothing
 *
 * A request's waypoints and shape are held for the length of the request and
 * no longer — not in the database, a blob or a log line. The log line is the
 * `routing-call` event (`log.ts` §`EVENT_KEYS`): which question, how it ended,
 * how long it took and how many legs, and the redaction there refuses
 * anything else. An engine's error text is never read into a message, because
 * Valhalla's can quote a coordinate; the rider is answered with one of
 * `errors.ts`'s fixed sentences.
 *
 * ## How much a rider may ask
 *
 * Dragging one waypoint re-routes the two legs beside it, so a rider building
 * a route asks often: {@link ROUTE_LIMIT} routes and {@link HEIGHT_LIMIT}
 * height profiles a minute, an athlete. Over it is `rate_limited`, which the
 * app treats as "ask again" (`RoutingError.retryable`). Counted in memory
 * (`auth/rate-limit.ts`), keyed by the athlete's id — never an address — and
 * forgotten when the minute ends.
 */

import type {
  BicycleKind,
  HillPreference,
  RidingPreferences,
  SurfaceTolerance,
} from '@onyourleft/domain';

import { createRateLimiter, type RateLimit } from '../auth/rate-limit.ts';
import type { Caller } from '../auth/identity.ts';
import type { ErrorCode, FieldProblem } from '../errors.ts';
import { logEvent, type LogSink } from '../log.ts';
import {
  ELEVATION_DATASET,
  type EngineFailure,
  type EngineLeg,
  type LatLon,
  type RoutingEngine,
} from './valhalla.ts';

/** The most waypoints one route request carries. The planner asks a leg at a time. */
export const MAXIMUM_WAYPOINTS = 25;

/**
 * The most points one height request carries: 450 km at the app's 30 m
 * sampling, and well inside the instance's 1 MiB body limit as JSON.
 */
export const MAXIMUM_HEIGHT_POINTS = 15_000;

/** The sampling interval a height request may ask for, in metres. */
export const MINIMUM_HEIGHT_INTERVAL = 5;
export const MAXIMUM_HEIGHT_INTERVAL = 1_000;

/** Route requests an athlete may make in a minute. */
export const ROUTE_LIMIT: RateLimit = { limit: 120, windowMs: 60_000 };

/** Height requests an athlete may make in a minute. */
export const HEIGHT_LIMIT: RateLimit = { limit: 30, windowMs: 60_000 };

const BICYCLES: ReadonlySet<unknown> = new Set<BicycleKind>([
  'road',
  'hybrid',
  'city',
  'cross',
  'mountain',
]);
const HILLS: ReadonlySet<unknown> = new Set<HillPreference>(['avoid', 'neutral', 'seek']);
const SURFACES: ReadonlySet<unknown> = new Set<SurfaceTolerance>([
  'paved-only',
  'prefer-paved',
  'any',
]);

/** The fixed sentences a field problem carries: never a value. */
const POINTS_PROBLEM =
  'must be a list of { latitude, longitude } points in degrees, latitude within ±90 and longitude within ±180';

export interface RoutedAnswer {
  readonly legs: readonly {
    readonly shape: readonly LatLon[];
    readonly distanceMetres: number;
    readonly surface: EngineLeg['surface'];
  }[];
}

export interface HeightsAnswer {
  readonly source: { readonly name: string; readonly resolutionMetres: number };
  readonly samples: readonly (readonly [number, number | null])[];
}

export type RoutingOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ErrorCode; readonly fields?: readonly FieldProblem[] };

/** What `instance.ts` holds, and the routes call. */
export interface InstanceRouting {
  route(
    caller: Caller,
    body: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<RoutingOutcome<RoutedAnswer>>;
  heights(
    caller: Caller,
    body: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<RoutingOutcome<HeightsAnswer>>;
}

export interface RoutingOptions {
  /** The engine, or `undefined` when the operator set none: every request is `routing_off`. */
  readonly engine: RoutingEngine | undefined;
  readonly log: LogSink;
  /** Unix milliseconds. */
  readonly now: () => number;
  readonly routeLimit?: RateLimit;
  readonly heightLimit?: RateLimit;
}

/**
 * A request's points as {@link LatLon}s, or `undefined`. Each arrives as
 * `{ latitude, longitude }` — the shape the app's privacy walk recognises
 * (`apps/web/src/privacy/boundaries.ts` §`coordinatesIn`), which a bare pair
 * is not — and nothing else.
 */
function points(value: unknown, minimum: number, maximum: number): readonly LatLon[] | undefined {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) return undefined;
  const read: LatLon[] = [];
  for (const point of value as unknown[]) {
    if (typeof point !== 'object' || point === null) return undefined;
    const { latitude, longitude, ...rest } = point as Record<string, unknown>;
    if (
      Object.keys(rest).length > 0 ||
      typeof latitude !== 'number' ||
      typeof longitude !== 'number' ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180
    ) {
      return undefined;
    }
    read.push([latitude, longitude]);
  }
  return read;
}

function preferencesOf(value: unknown): RidingPreferences | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { bicycle, hills, surface } = value as Record<string, unknown>;
  if (!BICYCLES.has(bicycle) || !HILLS.has(hills) || !SURFACES.has(surface)) return undefined;
  return value as RidingPreferences;
}

const FAILURE_CODE: Readonly<Record<EngineFailure, ErrorCode>> = {
  'no-route': 'no_route',
  'unpaved-endpoint': 'unpaved_endpoint',
  unreachable: 'routing_failed',
  malformed: 'routing_failed',
};

/** The routing the instance offers its riders. @see the file comment. */
export function createRouting(options: RoutingOptions): InstanceRouting {
  const routes = createRateLimiter(options.routeLimit ?? ROUTE_LIMIT, options.now);
  const heights = createRateLimiter(options.heightLimit ?? HEIGHT_LIMIT, options.now);

  /** The one line a call writes: closed words, a count and a time. */
  function logged(ask: 'route' | 'heights', began: number, state: string, legs?: number): void {
    logEvent(options.log, 'routing-call', {
      ask,
      state,
      ms: Math.max(0, Math.round(options.now() - began)),
      ...(legs === undefined ? {} : { legs }),
    });
  }

  return {
    async route(caller, body, signal) {
      const waypoints = points(body.waypoints, 2, MAXIMUM_WAYPOINTS);
      const preferences = preferencesOf(body.preferences);
      if (waypoints === undefined || preferences === undefined) {
        return {
          ok: false,
          code: 'validation_failed',
          fields: [
            ...(waypoints === undefined
              ? [
                  {
                    field: 'waypoints',
                    problem: `${POINTS_PROBLEM}, from 2 to ${String(MAXIMUM_WAYPOINTS)} of them`,
                  },
                ]
              : []),
            ...(preferences === undefined
              ? [
                  {
                    field: 'preferences',
                    problem: 'must name a bicycle, a hill preference and a surface tolerance',
                  },
                ]
              : []),
          ],
        };
      }
      if (options.engine === undefined) return { ok: false, code: 'routing_off' };
      if (!routes.allow(caller.athleteId)) return { ok: false, code: 'rate_limited' };
      const began = options.now();
      const answer = await options.engine.route(waypoints, preferences, signal);
      if (!answer.ok) {
        logged('route', began, answer.why);
        return { ok: false, code: FAILURE_CODE[answer.why] };
      }
      logged('route', began, 'routed', answer.value.length);
      return { ok: true, value: { legs: answer.value } };
    },

    async heights(caller, body, signal) {
      const shape = points(body.shape, 2, MAXIMUM_HEIGHT_POINTS);
      const interval = body.interval;
      const intervalOk =
        typeof interval === 'number' &&
        Number.isFinite(interval) &&
        interval >= MINIMUM_HEIGHT_INTERVAL &&
        interval <= MAXIMUM_HEIGHT_INTERVAL;
      if (shape === undefined || !intervalOk) {
        return {
          ok: false,
          code: 'validation_failed',
          fields: [
            ...(shape === undefined
              ? [
                  {
                    field: 'shape',
                    problem: `${POINTS_PROBLEM}, from 2 to ${String(MAXIMUM_HEIGHT_POINTS)} of them`,
                  },
                ]
              : []),
            ...(intervalOk
              ? []
              : [
                  {
                    field: 'interval',
                    problem: `must be a number of metres from ${String(MINIMUM_HEIGHT_INTERVAL)} to ${String(MAXIMUM_HEIGHT_INTERVAL)}`,
                  },
                ]),
          ],
        };
      }
      if (options.engine === undefined) return { ok: false, code: 'routing_off' };
      if (!heights.allow(caller.athleteId)) return { ok: false, code: 'rate_limited' };
      const began = options.now();
      const answer = await options.engine.heights(shape, interval, signal);
      if (!answer.ok) {
        logged('heights', began, answer.why);
        return { ok: false, code: FAILURE_CODE[answer.why] };
      }
      logged('heights', began, 'measured');
      return {
        ok: true,
        value: {
          source: {
            name: ELEVATION_DATASET.name,
            resolutionMetres: ELEVATION_DATASET.resolutionMetres,
          },
          samples: answer.value,
        },
      };
    },
  };
}
