// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where a new route's map opens — #3184 — read from a real store.
 *
 * Against `@onyourleft/store/testing`'s harness rather than a double, because
 * the two things that matter are the store's: which of a route and a ride is
 * newer by the fields the store keeps, and that another athlete's rows on the
 * same device are never this rider's place (CLAUDE.md §6).
 */

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  seconds,
  unixSeconds,
  type DegreesLatitude,
  type DegreesLongitude,
  type GeographicPosition,
} from '@onyourleft/domain';
import { activityId, type AthleteId, type RouteRecord } from '@onyourleft/store';
import {
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  FIXTURE_EPOCH,
  routeFor,
  seedAthletes,
  seedRide,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RIDING_PLACE_RIDES, ridingPlace, type RidingPlaceStore } from './riding-place';

let harness: StoreHarness;

beforeEach(async () => {
  harness = createStoreHarness();
  await seedAthletes(harness);
});

afterEach(async () => {
  await harness.destroy();
  vi.unstubAllGlobals();
});

/** A ride that started at `startedAt` with a track from `latitude`, `longitude`, its first two samples absent. */
async function seedTrackedRide(
  owner: AthleteId,
  id: string,
  startedAt: number,
  latitude: number,
  longitude: number,
): Promise<void> {
  const ride = await seedRide(harness, owner, {
    id: activityId(id),
    startedAt: unixSeconds(startedAt),
    hasPosition: true,
  });
  const count = 6;
  await harness.write(async (store) =>
    store.putStreamSet({
      activityId: ride.id,
      athleteId: owner,
      startedAt: ride.startedAt,
      sampleInterval: seconds(1),
      sampleCount: count,
      channels: {
        latitude: Array.from({ length: count }, (_, index) =>
          index < 2 ? undefined : ((latitude + index * 0.0001) as DegreesLatitude),
        ),
        longitude: Array.from({ length: count }, (_, index) =>
          index < 2 ? undefined : ((longitude + index * 0.0001) as DegreesLongitude),
        ),
      },
    }),
  );
}

/** A saved route, saved at `createdAt`, that starts at `latitude`, `longitude`. */
async function seedRouteAt(
  owner: AthleteId,
  createdAt: number,
  latitude: number,
  longitude: number,
): Promise<RouteRecord> {
  const points = Array.from({ length: 30 }, (_, index) => ({
    position: geographicPosition(
      degreesLatitude(latitude + index * 0.0002),
      degreesLongitude(longitude),
    ),
    elevation: altitudeMetres(100),
  }));
  const route: RouteRecord = {
    ...routeFor(owner),
    profile: routeProfile(points),
    createdAt: unixSeconds(createdAt),
  };
  await harness.write(async (store) => store.putRoute(route));
  return route;
}

async function placeOf(owner: AthleteId): Promise<GeographicPosition | undefined> {
  return harness.read(async (store) => ridingPlace(store, owner));
}

const near = (latitude: number, longitude: number) =>
  expect.objectContaining({
    latitude: expect.closeTo(latitude, 3) as number,
    longitude: expect.closeTo(longitude, 3) as number,
  }) as GeographicPosition;

describe('where a new route opens — #3184', () => {
  it('is nowhere with no route and no ride, so the planner keeps today’s view', async () => {
    expect(await placeOf(ATHLETE_A)).toBeUndefined();
  });

  it('is a saved route’s start when that is all there is', async () => {
    await seedRouteAt(ATHLETE_A, FIXTURE_EPOCH, 39.74, -104.99);
    expect(await placeOf(ATHLETE_A)).toEqual(near(39.74, -104.99));
  });

  it('is a ride’s first recorded position when that is all there is', async () => {
    await seedTrackedRide(ATHLETE_A, 'ride-a', FIXTURE_EPOCH, 45.52, -122.68);
    // The first two samples have no position; the third is the start.
    expect(await placeOf(ATHLETE_A)).toEqual(near(45.5202, -122.6798));
  });

  it('is the newer of the two: a ride after the last saved route', async () => {
    await seedRouteAt(ATHLETE_A, FIXTURE_EPOCH, 39.74, -104.99);
    await seedTrackedRide(ATHLETE_A, 'ride-a', FIXTURE_EPOCH + 3_600, 45.52, -122.68);
    expect(await placeOf(ATHLETE_A)).toEqual(near(45.5202, -122.6798));
  });

  it('is the newer of the two: a route saved after the last ride', async () => {
    await seedTrackedRide(ATHLETE_A, 'ride-a', FIXTURE_EPOCH, 45.52, -122.68);
    await seedRouteAt(ATHLETE_A, FIXTURE_EPOCH + 3_600, 39.74, -104.99);
    expect(await placeOf(ATHLETE_A)).toEqual(near(39.74, -104.99));
  });

  it('looks past indoor rides to the newest one with a position', async () => {
    await seedTrackedRide(ATHLETE_A, 'outdoor', FIXTURE_EPOCH, 45.52, -122.68);
    for (let index = 1; index < RIDING_PLACE_RIDES; index += 1) {
      await seedRide(harness, ATHLETE_A, {
        id: activityId(`indoor-${String(index)}`),
        startedAt: unixSeconds(FIXTURE_EPOCH + index * 86_400),
      });
    }
    expect(await placeOf(ATHLETE_A)).toEqual(near(45.5202, -122.6798));
  });

  it('never reads another athlete’s newer route or ride on the same device', async () => {
    await seedRouteAt(ATHLETE_A, FIXTURE_EPOCH, 39.74, -104.99);
    await seedTrackedRide(ATHLETE_B, 'ride-b', FIXTURE_EPOCH + 86_400, 51.5, -0.12);
    await seedRouteAt(ATHLETE_B, FIXTURE_EPOCH + 86_400, 48.85, 2.35);
    expect(await placeOf(ATHLETE_A)).toEqual(near(39.74, -104.99));
    expect(await placeOf(ATHLETE_B)).not.toEqual(near(39.74, -104.99));
  });

  it('falls back to the route when the newer ride’s track cannot be read', async () => {
    await seedRouteAt(ATHLETE_A, FIXTURE_EPOCH, 39.74, -104.99);
    await seedTrackedRide(ATHLETE_A, 'ride-a', FIXTURE_EPOCH + 3_600, 45.52, -122.68);
    const place = await harness.read(async (store) => {
      const trackless: RidingPlaceStore = {
        listRoutes: store.listRoutes.bind(store),
        listActivitySummaries: store.listActivitySummaries.bind(store),
        getStreamChannel: () => Promise.resolve(undefined),
      };
      return ridingPlace(trackless, ATHLETE_A);
    });
    expect(place).toEqual(near(39.74, -104.99));
  });
});

describe('the place stays on the device — #3184, ADR 0004 D', () => {
  it('is read with the network refused', async () => {
    const refuse = (name: string) => (): never => {
      throw new Error(`the riding place must not reach the network — it called ${name}`);
    };
    vi.stubGlobal('fetch', refuse('fetch'));
    vi.stubGlobal('XMLHttpRequest', refuse('XMLHttpRequest'));
    vi.stubGlobal('WebSocket', refuse('WebSocket'));
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: refuse('navigator.sendBeacon') });
    const log = vi.spyOn(console, 'log');
    const info = vi.spyOn(console, 'info');
    const warn = vi.spyOn(console, 'warn');
    await seedRouteAt(ATHLETE_A, FIXTURE_EPOCH, 39.74, -104.99);
    await seedTrackedRide(ATHLETE_A, 'ride-a', FIXTURE_EPOCH + 3_600, 45.52, -122.68);
    expect(await placeOf(ATHLETE_A)).toEqual(near(45.5202, -122.6798));
    expect([...log.mock.calls, ...info.mock.calls, ...warn.mock.calls]).toEqual([]);
  });
});
