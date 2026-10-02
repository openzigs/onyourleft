// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * What Home asks the store for, counted at the VIEW — #939.
 *
 * `home/home.test.ts` bounds `loadHome`. This counts every call the screen
 * makes through its port when it is opened through the real shell, empty and
 * full, so a hero, a card or a progress ring that reached for a read of its
 * own is a red test rather than a slower launch. The app opens here, so this
 * is the read every launch pays for (#428).
 *
 * The count is the one Home made before #939 redrew it, taken on `main` with
 * this file: one `listActivitySummaries` and one `getAthlete`, nothing else.
 * #1010's "next up" adds ONE `getRoute`, and only when a ride in the read was
 * ridden on a route — counted on the route port the same way, which a
 * `listRoutes` would show up on.
 */

import { metres, seconds, unixSeconds } from '@onyourleft/domain';
import { activityId, athleteId as toAthleteId, type RouteId } from '@onyourleft/store';
import { afterEach, describe, expect, it } from 'vitest';

import type { AnalysisPort } from '../analysis/store-port';
import { stubAnalysis } from '../analysis/testing';
import { stubActivity } from '../detail/testing';
import { idleSnapshot, stubRideController } from '../ride/testing';
import type { RoutePort } from '../routes/store-port';
import { routeStub, stubRouteId } from '../routes/testing';
import { AppShell } from '../shell/AppShell';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { mount, settle, type Mounted } from '../testing/mount';

const OWNER = toAthleteId('athlete-a');
const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };
const NOW = 1_790_000_000;

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
});

/** A port whose every store method, whatever it is called, is counted. */
function counted<P extends AnalysisPort | RoutePort>(
  port: P,
  calls = new Map<string, number>(),
): { port: P; calls: Map<string, number> } {
  const store = new Proxy(port.store, {
    get(target, name, receiver): unknown {
      const value: unknown = Reflect.get(target, name, receiver);
      if (typeof value !== 'function' || typeof name !== 'string') {
        return value;
      }
      return (...args: unknown[]): unknown => {
        calls.set(name, (calls.get(name) ?? 0) + 1);
        return (value as (...given: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return { port: { ...port, athleteId: port.athleteId, store }, calls };
}

async function openHome(rides: number, routeId?: RouteId): Promise<Map<string, number>> {
  const { port, calls } = counted(
    stubAnalysis(
      OWNER,
      Array.from({ length: rides }, (_unused, index) => ({
        activity: stubActivity({
          id: activityId(`r${String(index)}`),
          name: `Ride ${String(index)}`,
          startedAt: unixSeconds(NOW - (rides - index) * 86_400),
          startedAtTimeZone: 'UTC',
          movingTime: seconds(3000),
          distance: metres(30_000),
          ...(routeId === undefined ? {} : { routeId }),
        }),
      })),
    ),
  );
  const routes = counted(routeStub(OWNER), calls).port;
  globalThis.location.hash = '#/';
  mounted = await mount(
    <AppShell
      capabilities={NO_BLUETOOTH}
      analysis={port}
      rideController={stubRideController(idleSnapshot()).controller}
      routes={routes}
    />,
  );
  await settle();
  await settle();
  return calls;
}

describe('the store calls Home makes — #939', () => {
  it.each([
    ['empty', 0],
    ['full', 40],
  ] as const)(
    '%s: exactly one list read and one athlete read, and no other store call',
    async (_state, rides) => {
      const calls = await openHome(rides);
      expect(Object.fromEntries(calls)).toEqual({ listActivitySummaries: 1, getAthlete: 1 });
    },
  );
});

describe('the store calls next up makes — #1010', () => {
  it('a history ridden on a route: one getRoute more, and never a list of routes', async () => {
    const calls = await openHome(40, stubRouteId('hill'));
    expect(Object.fromEntries(calls)).toEqual({
      listActivitySummaries: 1,
      getAthlete: 1,
      getRoute: 1,
    });
  });
});
