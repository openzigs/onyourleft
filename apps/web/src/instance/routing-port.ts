// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The route planner's roads, asked of this device's instance** (#2008): a
 * {@link RoutingProvider} whose engine is the Valhalla the rider's own
 * instance runs, and the one production implementation of it.
 *
 * A `*-port.ts` on purpose: `scripts/check-wiring.mjs` watches every method
 * of {@link RoutingPort} (WIRE003) and every export of this file (WIRE002),
 * and `main.tsx` is the only production code that names
 * {@link createRoutingPort}.
 *
 * ## What leaves, and what comes back
 *
 * Every call is SEALED, through `instance-transport.ts`, the one module this
 * client sends instance traffic through (ADR 0036 D-3 (a)), and both routes
 * are sealed-only on the instance, on every instance (`apps/instance`
 * §`routing/routes.ts`): whatever stands between the device and the instance
 * reads none of it.
 *
 * - **A leg**: `POST /v1/routing/route`, carrying the leg's two waypoints and
 *   the rider's named options (bicycle, hills, surface). Back: the leg's
 *   shape, length and surface, read again here through `@onyourleft/domain`
 *   §`checkedLeg`, so an instance that answered a `NaN` has answered nothing.
 * - **Heights**: `POST /v1/routing/heights`, carrying the line and the
 *   sampling interval. Back: the samples and the dataset they came from,
 *   through §`checkedHeights`.
 *
 * ⚠️ **Nothing inside a privacy zone leaves** (`privacy/boundaries.test.ts`,
 * a `departing` boundary): the rider's instance is still somebody's server
 * (ADR 0036 D-3 (d)). A leg with a waypoint inside one of this device's zones
 * — or a line for heights with any point inside one — is refused HERE, before
 * a session is read, with {@link ZONE_REFUSAL}. Refused, not trimmed: a leg
 * missing its end is a different leg. Each zone counts out to its radius
 * widened by the trim's whole jitter, so no point the trim of a shared ride
 * could hide is sent.
 *
 * ## Nothing for a rider with no instance
 *
 * {@link RoutingPort.offered} reads this device's storage and nothing else.
 * With no instance, or one this copy of the app cannot seal to, it is
 * `false`: `main.tsx` hands the planner no provider, the planner draws
 * straight lines as it always has, and nothing is sent (ADR 0036 D-3 (a)).
 * Whether the instance runs a routing engine at all is found out from the
 * first leg: one that does not answers `routing_off`, and the leg says so.
 *
 * ## A failure names the leg, never the place
 *
 * Every message here is a fixed sentence (ADR 0004 D): no waypoint, no
 * coordinate and nothing the instance said is put in one.
 */

import {
  distanceBetween,
  RoutingError,
  checkedHeights,
  checkedLeg,
  metres,
  type GeographicPosition,
  type HeightProfile,
  type HeightRequest,
  type RoutedLeg,
  type RouteRequest,
  type RoutingErrorCode,
  type RoutingProvider,
} from '@onyourleft/domain';
import type { PrivacyZoneRecord } from '@onyourleft/store';

import { TRIM_JITTER_FRACTION } from '../detail/privacy';
import { heldInstanceSession, heldSealedSession, type SealingDependencies } from './instance-port';
import { sealedRouteGate } from './instance-pin';
import { readInstanceAccount } from './sign-in';

/** What a leg or a profile inside a privacy zone is told. */
export const ZONE_REFUSAL =
  'This stretch starts, ends or runs inside one of your privacy zones, so it is not sent to your instance. Move the waypoint outside the zone to have it follow roads.';

/** The instance's codes, as this program's. Anything else is the instance misbehaving. */
const CODES: Readonly<Record<string, readonly [RoutingErrorCode, string]>> = {
  no_route: [
    'no-route',
    'Your instance’s routing engine found no road between these two waypoints. Moving one onto a road usually fixes it.',
  ],
  unpaved_endpoint: [
    'unpaved-endpoint',
    'A waypoint here is on a surface your paved-only setting refuses. Relax the surface setting, or move the waypoint.',
  ],
  rate_limited: [
    'rate-limited',
    'Your instance asked for a pause in routing requests. Try this leg again in a moment.',
  ],
  routing_off: [
    'unavailable',
    'Your instance has no routing engine set up, so this leg stays a straight line. Its operator can add one.',
  ],
  routing_failed: [
    'unavailable',
    'Your instance’s routing engine gave no usable answer. Try again in a moment.',
  ],
  validation_failed: ['invalid-request', 'Your instance could not read this routing request.'],
  payload_too_large: [
    'invalid-request',
    'This route is too long for your instance to measure in one request.',
  ],
};

const UNREACHABLE =
  'Your instance could not be reached for routing. Try again once you are connected.';

/** The planner's engine, from the rider's instance. */
export interface RoutingPort extends RoutingProvider {
  /** Whether to offer roads at all — from this device's storage, sending nothing. */
  offered(): boolean;
}

export interface RoutingPortDependencies extends SealingDependencies {
  /** This device's privacy zones. A point inside one is never sent. */
  readonly zones: () => Promise<readonly PrivacyZoneRecord[]>;
}

function insideAZone(
  positions: readonly GeographicPosition[],
  zones: readonly PrivacyZoneRecord[],
): boolean {
  return zones.some((zone) => {
    const reach = zone.radius * (1 + TRIM_JITTER_FRACTION);
    return positions.some((position) => distanceBetween(position, zone.centre) <= reach);
  });
}

/**
 * Points as the instance reads them: `{ latitude, longitude }`, the shape
 * `privacy/boundaries.ts` §`coordinatesIn` recognises — a bare pair it cannot.
 */
function points(
  positions: readonly GeographicPosition[],
): { latitude: number; longitude: number }[] {
  return positions.map(({ latitude, longitude }) => ({ latitude, longitude }));
}

/** The instance's refusal as this program's error: a fixed sentence, never what it said. */
function refusal(status: number, body: unknown): RoutingError {
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  const known = typeof code === 'string' ? CODES[code] : undefined;
  if (known !== undefined) return new RoutingError(known[0], known[1]);
  return status >= 500
    ? new RoutingError('unavailable', UNREACHABLE)
    : new RoutingError(
        'malformed-response',
        'Your instance answered routing with something this app cannot read.',
      );
}

function isPair(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  );
}

/** One leg of the instance's answer, through the domain's checks. */
function legFrom(raw: unknown, index: number): RoutedLeg {
  const leg = raw as { shape?: unknown; distanceMetres?: unknown; surface?: unknown } | null;
  const shape = leg?.shape;
  if (!Array.isArray(shape) || !shape.every(isPair) || typeof leg?.distanceMetres !== 'number') {
    throw new RoutingError(
      'malformed-response',
      `Leg ${String(index + 1)} came back from your instance in a shape this app cannot read.`,
      index,
    );
  }
  return checkedLeg(
    {
      shape: shape.map(([latitude, longitude]) => ({ latitude, longitude })),
      distance: leg.distanceMetres,
      surface: typeof leg.surface === 'string' ? leg.surface : undefined,
    },
    index,
  );
}

/** The production {@link RoutingPort}: `main.tsx` builds it, and nothing else in the client. */
export function createRoutingPort(dependencies: RoutingPortDependencies): RoutingPort {
  const session = heldSealedSession(dependencies);

  async function ask(path: string, body: Readonly<Record<string, unknown>>) {
    let held;
    try {
      held = await session();
    } catch {
      throw new RoutingError('unavailable', UNREACHABLE);
    }
    if (held.kind === 'closed') throw new RoutingError('unavailable', UNREACHABLE);
    try {
      return await held.sealed.call('POST', path, { token: held.token, body });
    } catch {
      throw new RoutingError('unavailable', UNREACHABLE);
    }
  }

  return {
    offered: () => {
      const account = readInstanceAccount(dependencies.storage);
      if (account === undefined || heldInstanceSession(dependencies.storage) === undefined) {
        return false;
      }
      return sealedRouteGate(account, dependencies.loadedFrom).kind === 'open';
    },

    async route(request: RouteRequest): Promise<readonly RoutedLeg[]> {
      if (request.waypoints.length < 2) {
        throw new RoutingError('invalid-request', 'A route needs at least two waypoints.');
      }
      const positions = request.waypoints.map((waypoint) => waypoint.position);
      if (insideAZone(positions, await dependencies.zones())) {
        throw new RoutingError('no-route', ZONE_REFUSAL);
      }
      const answer = await ask('/v1/routing/route', {
        waypoints: points(positions),
        preferences: {
          bicycle: request.preferences.bicycle,
          hills: request.preferences.hills,
          surface: request.preferences.surface,
        },
      });
      if (answer.status !== 200) throw refusal(answer.status, answer.body);
      const legs = (answer.body as { legs?: unknown } | null)?.legs;
      if (!Array.isArray(legs) || legs.length !== positions.length - 1) {
        throw new RoutingError(
          'malformed-response',
          'Your instance answered with a different number of legs than were asked for.',
        );
      }
      return legs.map((leg, index) => legFrom(leg, index));
    },

    async heights(request: HeightRequest): Promise<HeightProfile> {
      if (insideAZone(request.shape, await dependencies.zones())) {
        throw new RoutingError('no-route', ZONE_REFUSAL);
      }
      const answer = await ask('/v1/routing/heights', {
        shape: points(request.shape),
        interval: request.interval,
      });
      if (answer.status !== 200) throw refusal(answer.status, answer.body);
      const { source, samples } = (answer.body ?? {}) as { source?: unknown; samples?: unknown };
      const named = source as { name?: unknown; resolutionMetres?: unknown } | undefined;
      if (
        typeof named?.name !== 'string' ||
        typeof named.resolutionMetres !== 'number' ||
        !(named.resolutionMetres > 0) ||
        !Array.isArray(samples) ||
        !samples.every(
          (sample) =>
            Array.isArray(sample) &&
            sample.length === 2 &&
            typeof sample[0] === 'number' &&
            (sample[1] === null || typeof sample[1] === 'number'),
        )
      ) {
        throw new RoutingError(
          'malformed-response',
          'Your instance answered heights in a shape this app cannot read.',
        );
      }
      return checkedHeights(
        { name: named.name, resolution: metres(named.resolutionMetres) },
        (samples as [number, number | null][]).map(([along, elevation]) => ({ along, elevation })),
      );
    },
  };
}
