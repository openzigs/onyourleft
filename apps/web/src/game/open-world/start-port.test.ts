// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The picker's reads are the rider's own — #2889, CLAUDE.md §6
 * (cross-athlete exposure). Against the **real** store, through the round-trip
 * harness, with three athletes: two cannot tell "scoped" from "everything the
 * requester can see" (`docs/agents/store-harness.md`).
 *
 * And a start handed by the port is read back through the session's entry
 * (`entry.ts` §`take`), never from the port's own state.
 */

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  seconds,
  altitudeMetres,
  type DegreesLatitude,
  type DegreesLongitude,
} from '@onyourleft/domain';
import { activityId, type AthleteId, type NewStreamSet, type RouteRecord } from '@onyourleft/store';
import {
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  seedAthletes,
  seedRide,
  routeFor,
  seedRoute,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createOpenWorldEntry, type OpenWorldEntry } from './entry';
import { startCoverage, type StartCoverage } from './start';
import { openWorldStartPort, type OpenWorldStartPort } from './start-port';

let harness: StoreHarness;

beforeEach(async () => {
  harness = createStoreHarness();
  await seedAthletes(harness);
});

afterEach(async () => {
  await harness.destroy();
});

/** A ride with a track that starts at `latitude`, `longitude`, its first two samples absent. */
async function seedTrackedRide(
  owner: AthleteId,
  id: string,
  name: string,
  latitude: number,
  longitude: number,
): Promise<void> {
  const ride = await seedRide(harness, owner, {
    id: activityId(id),
    name,
    hasPosition: true,
  });
  const count = 6;
  const set: NewStreamSet = {
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
  };
  await harness.write(async (store) => store.putStreamSet(set));
}

/** A saved route in Colorado: `routeFor`'s own line is in London, outside the map. */
async function seedColoradoRoute(owner: AthleteId, name: string): Promise<RouteRecord> {
  const points = Array.from({ length: 30 }, (_, index) => ({
    position: geographicPosition(
      degreesLatitude(39.7 + index * 0.0002),
      degreesLongitude(-105 + index * 0.0001),
    ),
    elevation: altitudeMetres(1600),
  }));
  const route: RouteRecord = { ...routeFor(owner, { name }), profile: routeProfile(points) };
  await harness.write(async (store) => store.putRoute(route));
  return route;
}

async function withPort<T>(
  owner: AthleteId,
  entry: OpenWorldEntry,
  work: (port: OpenWorldStartPort) => Promise<T>,
  coverage?: StartCoverage,
): Promise<T> {
  return harness.read(async (store) =>
    work(openWorldStartPort({ store, owner, entry, opened: () => undefined, coverage })),
  );
}

describe('the past-ride list is the rider’s own — #2889', () => {
  it('offers only the first athlete’s rides, of a fixture with both athletes’ rides', async () => {
    await seedTrackedRide(ATHLETE_A, 'ride-a', 'Mine', 39.74, -104.99);
    await seedTrackedRide(ATHLETE_B, 'ride-b', 'Theirs', 40.01, -105.27);
    await seedRide(harness, ATHLETE_A, { id: activityId('indoor-a'), name: 'Indoors' });

    const listed = await withPort(ATHLETE_A, createOpenWorldEntry(), (port) =>
      port.listRideStarts(),
    );
    expect(listed.map((ride) => ride.id)).toEqual(['ride-a']);
    const theirs = await withPort(ATHLETE_B, createOpenWorldEntry(), (port) =>
      port.listRideStarts(),
    );
    expect(theirs.map((ride) => ride.id)).toEqual(['ride-b']);
  });

  it('reads no start from another athlete’s ride id', async () => {
    await seedTrackedRide(ATHLETE_B, 'ride-b', 'Theirs', 40.01, -105.27);
    const outcome = await withPort(ATHLETE_A, createOpenWorldEntry(), (port) =>
      port.rideStart('ride-b'),
    );
    expect(outcome).toEqual({ kind: 'refused', refusal: 'no-position' });
  });

  it('offers only the first athlete’s saved routes', async () => {
    const mine = await seedColoradoRoute(ATHLETE_A, 'My loop');
    await seedColoradoRoute(ATHLETE_B, 'Their loop');
    const listed = await withPort(ATHLETE_A, createOpenWorldEntry(), (port) =>
      port.listRouteStarts(),
    );
    expect(listed.map((route) => route.name)).toEqual(['My loop']);
    expect(listed[0]?.id).toBe(mine.id);
  });
});

describe('each source reads back through the session’s entry — #2889', () => {
  it('a past ride: its first recorded position, as the start the session takes', async () => {
    await seedTrackedRide(ATHLETE_A, 'ride-a', 'Mine', 39.74, -104.99);
    const entry = createOpenWorldEntry();
    await withPort(ATHLETE_A, entry, async (port) => {
      const outcome = await port.rideStart('ride-a');
      if (outcome.kind !== 'start') throw new Error(`refused: ${outcome.refusal}`);
      port.begin(outcome.start);
    });
    const taken = entry.take();
    expect(taken?.source).toBe('ride');
    expect(taken?.position.latitude).toBeCloseTo(39.7402, 4);
    expect(taken?.position.longitude).toBeCloseTo(-104.9898, 4);
    expect(entry.take(), 'a start is taken once').toBeUndefined();
  });

  it('a saved route: its first point', async () => {
    const route = await seedColoradoRoute(ATHLETE_A, 'Out of Golden');
    const entry = createOpenWorldEntry();
    await withPort(ATHLETE_A, entry, async (port) => {
      const [listed] = await port.listRouteStarts();
      if (listed?.start.kind !== 'start') throw new Error('the route offered no start');
      port.begin(listed.start.start);
    });
    expect(entry.take()).toEqual({ position: route.profile.positions[0], source: 'route' });
  });

  it('says why a route outside the map cannot start one', async () => {
    // `routeFor`'s default is London.
    await seedRoute(harness, ATHLETE_A);
    const [listed] = await withPort(ATHLETE_A, createOpenWorldEntry(), (port) =>
      port.listRouteStarts(),
    );
    expect(listed?.start).toEqual({ kind: 'refused', refusal: 'outside-coverage' });
  });

  it('starts a route and a ride outside the US on a self-hoster’s own archive — #2985', async () => {
    // `routeFor`'s default is London, and so is this ride.
    await seedRoute(harness, ATHLETE_A);
    await seedTrackedRide(ATHLETE_A, 'ride-london', 'Thames path', 51.5, -0.12);
    const coverage = startCoverage({
      archiveUrl: 'https://tiles.example.org/europe.pmtiles',
      attribution: 'OpenStreetMap',
    });
    const [route] = await withPort(
      ATHLETE_A,
      createOpenWorldEntry(),
      (port) => port.listRouteStarts(),
      coverage,
    );
    expect(route?.start.kind).toBe('start');
    const entry = createOpenWorldEntry();
    await withPort(
      ATHLETE_A,
      entry,
      async (port) => {
        const outcome = await port.rideStart('ride-london');
        if (outcome.kind !== 'start') throw new Error(`refused: ${outcome.refusal}`);
        port.begin(outcome.start);
      },
      coverage,
    );
    expect(entry.take()?.position.latitude).toBeCloseTo(51.5002, 4);
  });

  it('opens the ride after handing the start over, and not before', () => {
    const entry = createOpenWorldEntry();
    const seen: (string | undefined)[] = [];
    const port = openWorldStartPort({
      store: {
        listRoutes: () => Promise.resolve([]),
        listActivitySummaries: () => Promise.resolve([]),
        getStreamChannel: () => Promise.resolve(undefined),
      },
      owner: ATHLETE_A,
      entry,
      opened: () => {
        seen.push(entry.take()?.source);
      },
    });
    port.begin({
      position: geographicPosition(degreesLatitude(39.7), degreesLongitude(-105)),
      source: 'pin',
    });
    expect(seen).toEqual(['pin']);
  });
});
