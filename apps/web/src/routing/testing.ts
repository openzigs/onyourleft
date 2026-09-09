// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A scripted {@link RoutingProvider}, and the reason there is no real one yet.
 *
 * ## What this stands in for
 *
 * [ADR 0010](../../../../docs/adr/0010-map-tiles-and-routing.md) D-4 chose
 * **Valhalla, MIT, self-hosted, over HTTP**, and D-5 chose **Copernicus DEM
 * GLO-30** behind the same process. Neither is running. Standing one up is
 * #53's infrastructure work, and #70's own criteria — *"the same test suite
 * passes against two different engines"* and *"repointed from a bootstrap
 * endpoint to a self-hosted instance"* — cannot be met without one.
 *
 * ⚠️ **So no HTTP adapter is shipped here, deliberately.** Writing one against
 * an API nobody in the loop can call would be the shape CLAUDE.md §4a warns
 * about — *"a documented command nobody has run is the most expensive kind of
 * wrong"* — and it would be worse than absent, because a reviewer would read
 * request-shaping code as evidence the engine had been talked to. What is real
 * is the **interface**, the **validation** every engine's numbers must pass
 * (`@onyourleft/domain`'s `routing/validate.ts`), and everything above them.
 *
 * ## What a scripted provider proves that a real one could not
 *
 * The same argument `@onyourleft/sensors/web-bluetooth/testing` makes: #71's
 * assertions are about **how many times** an engine was asked and **which
 * legs** were asked about, and a real engine answering correctly tells you
 * nothing about either. {@link scriptedProvider} counts its calls, and a test
 * reads the count.
 */

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  RoutingError,
  type AltitudeMetres,
  type ElevationDataset,
  type GeographicPosition,
  type HeightProfile,
  type HeightRequest,
  type RoutedLeg,
  type RouteRequest,
  type RoutingProvider,
  type SurfaceKind,
} from '@onyourleft/domain';

/** ADR 0010 D-5's dataset, named here so a test reads the name a route would store. */
export const GLO30: ElevationDataset = {
  name: 'Copernicus DEM GLO-30',
  resolution: metres(30),
};

export interface ScriptedProvider extends RoutingProvider {
  /** Every `route` call, in order, as the waypoint pairs it was asked about. */
  readonly routeCalls: RouteRequest[];
  readonly heightCalls: HeightRequest[];
  /** Fail the next `route` call with this, then stop. */
  failNextRoute(error: RoutingError): void;
  /** Fail every `route` call from now on. */
  failEveryRoute(error: RoutingError): void;
}

export interface ScriptOptions {
  /**
   * How many intermediate points a snapped leg comes back with: **8** by default.
   *
   * More than two on purpose. #71's first criterion asserts a snapped leg has
   * *substantially more vertices than the waypoint count* — a straight line
   * between pins being the regression — so a double that returned two points
   * would make that assertion pass vacuously against a broken engine and fail
   * against a working one.
   */
  readonly vertices?: number;
  readonly surface?: SurfaceKind;
  /** Metres per leg. Fixed, so a distance assertion is arithmetic rather than geodesy. */
  readonly legDistance?: number;
  /** Heights returned per sample, cycled. `null` is a DEM void. */
  readonly heights?: readonly (number | null)[];
}

export function scriptedProvider(options: ScriptOptions = {}): ScriptedProvider {
  const vertices = options.vertices ?? 8;
  const surface = options.surface ?? 'paved';
  const legDistance = options.legDistance ?? 1_000;
  const heights = options.heights ?? [100];
  const routeCalls: RouteRequest[] = [];
  const heightCalls: HeightRequest[] = [];
  let once: RoutingError | undefined;
  let always: RoutingError | undefined;

  return {
    routeCalls,
    heightCalls,
    failNextRoute(error) {
      once = error;
    },
    failEveryRoute(error) {
      always = error;
    },
    route: (request) => {
      routeCalls.push(request);
      if (always !== undefined) return Promise.reject(always);
      if (once !== undefined) {
        const raised = once;
        once = undefined;
        return Promise.reject(raised);
      }
      if (request.waypoints.length < 2) {
        return Promise.reject(
          new RoutingError('invalid-request', 'a route needs at least two waypoints'),
        );
      }
      const legs: RoutedLeg[] = [];
      for (let index = 0; index + 1 < request.waypoints.length; index += 1) {
        legs.push({
          shape: between(
            request.waypoints[index]!.position,
            request.waypoints[index + 1]!.position,
            vertices,
          ),
          distance: metres(legDistance),
          surface,
        });
      }
      return Promise.resolve(legs);
    },
    heights: (request) => {
      heightCalls.push(request);
      const count = Math.max(1, Math.ceil(spanOf(request.shape) / request.interval) + 1);
      return Promise.resolve({
        source: GLO30,
        samples: Array.from({ length: count }, (_, index) => ({
          along: metres(index * request.interval),
          elevation: heightOf(heights[index % heights.length] ?? null),
        })),
      } satisfies HeightProfile);
    },
  };
}

/** A shape with `vertices` points, interpolated so it is not a straight two-point line. */
function between(
  from: GeographicPosition,
  to: GeographicPosition,
  vertices: number,
): readonly GeographicPosition[] {
  const steps = Math.max(2, vertices);
  return Array.from({ length: steps }, (_, index) => {
    const fraction = index / (steps - 1);
    return geographicPosition(
      degreesLatitude(from.latitude + (to.latitude - from.latitude) * fraction),
      degreesLongitude(from.longitude + (to.longitude - from.longitude) * fraction),
    );
  });
}

function heightOf(value: number | null): AltitudeMetres | undefined {
  return value === null ? undefined : altitudeMetres(value);
}

/** A crude planar span, in metres. Good enough to decide how many samples to invent. */
function spanOf(shape: readonly GeographicPosition[]): number {
  const first = shape[0];
  const last = shape.at(-1);
  if (first === undefined || last === undefined) return 0;
  const degrees = Math.hypot(last.latitude - first.latitude, last.longitude - first.longitude);
  return degrees * 111_320;
}
