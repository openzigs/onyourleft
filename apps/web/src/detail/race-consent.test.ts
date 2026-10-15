// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ADR 0021 D-5.2 (#793): an attempt whose rider's privacy-zone trim touches
 * the raced route is not offered — a zone at the start, in the middle and at
 * the finish, and the control, a zone off the route, which is offered.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  type GeographicPosition,
} from '@onyourleft/domain';

import { TRIM_JITTER_FRACTION } from './privacy';
import { decodeGpxRoute } from '@onyourleft/fit';
import { webCryptoSha256 } from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  routeFor,
  seedAthletes,
  seedRide,
} from '@onyourleft/store/testing';

import {
  offeredAsGhost,
  raceRouteDigest,
  raceRouteOf,
  raceRouteOffer,
  raceRouteText,
  trimTouchesRoute,
  widestTrimRadius,
  type RaceZone,
} from './race-consent';

/** Metres per degree of latitude, near enough for a fixture. */
const METRES_PER_DEGREE = 111_195;

const at = (latitude: number, longitude: number): GeographicPosition =>
  geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude));

/**
 * A 10 km route due north from 51.5° N, sampled every 500 m — sparse on
 * purpose, so a zone can sit between two samples.
 */
const ROUTE: readonly GeographicPosition[] = Array.from({ length: 21 }, (_unused, index) =>
  at(51.5 + (index * 500) / METRES_PER_DEGREE, -0.12),
);

/** A zone of `radius` metres, `east` metres east of the route at `north` metres along it. */
function zone(north: number, east: number, radius = 200): RaceZone {
  const latitude = 51.5 + north / METRES_PER_DEGREE;
  const longitude = -0.12 + east / (METRES_PER_DEGREE * Math.cos((latitude * Math.PI) / 180));
  return { centre: at(latitude, longitude), radius: metres(radius) };
}

describe('a ghost whose rider’s trim touches the raced route is not offered — ADR 0021 D-5.2', () => {
  it('refuses a zone at the start', () => {
    expect(offeredAsGhost(ROUTE, [zone(0, 0)])).toBe(false);
  });

  it('refuses a zone in the middle', () => {
    expect(offeredAsGhost(ROUTE, [zone(5000, 50)])).toBe(false);
  });

  it('refuses a zone at the finish', () => {
    expect(offeredAsGhost(ROUTE, [zone(10_000, -30)])).toBe(false);
  });

  it('offers the ride when every zone is off the route — the control', () => {
    expect(offeredAsGhost(ROUTE, [zone(5000, 2000), zone(-3000, 0)])).toBe(true);
  });

  it('offers the ride to a rider with no zones', () => {
    expect(offeredAsGhost(ROUTE, [])).toBe(true);
  });

  it('refuses when ANY zone touches, not only the first', () => {
    expect(offeredAsGhost(ROUTE, [zone(5000, 2000), zone(7000, 0)])).toBe(false);
  });

  it('sees a zone the road runs through BETWEEN two samples', () => {
    // 250 m along: exactly between the samples at 0 and 500 m, each 250 m from
    // the centre — outside a 200 m zone's widest trim (225 m). Tested against
    // the samples alone this would be offered; the road passes through it.
    const between = zone(250, 0);
    expect(ROUTE.some((point) => trimTouchesRoute([point], [between]))).toBe(false);
    expect(offeredAsGhost(ROUTE, [between])).toBe(false);
  });

  it('refuses at the widest a trim can reach, not at the nominal radius', () => {
    // 210 m to the side: outside the 200 m radius, inside its 225 m widest trim.
    expect(widestTrimRadius(zone(0, 0))).toBeCloseTo(200 * (1 + TRIM_JITTER_FRACTION), 9);
    expect(offeredAsGhost(ROUTE, [zone(5000, 210)])).toBe(false);
    // And 240 m to the side is outside that too.
    expect(offeredAsGhost(ROUTE, [zone(5000, 240)])).toBe(true);
  });

  it('tests a one-point route at its point, and a route with none touches nothing', () => {
    expect(trimTouchesRoute([ROUTE[0]!], [zone(0, 100)])).toBe(true);
    expect(trimTouchesRoute([ROUTE[0]!], [zone(0, 400)])).toBe(false);
    expect(trimTouchesRoute([], [zone(0, 0)])).toBe(false);
  });
});

describe('the route a ride is offered on (#331)', () => {
  const route = routeFor(ATHLETE_A);
  const centreOfStart = route.profile.positions[0]!;
  const offer = (mayBeRaced: boolean, zones: readonly RaceZone[] = []) =>
    raceRouteOffer({ mayBeRaced, route, zones, sha256: webCryptoSha256 });

  it('names a route by text two riders who imported the same file write alike, with no name in it', async () => {
    const file = readFileSync(
      new URL('../../../../packages/fit/fixtures/corpus/planned-loop-route.gpx', import.meta.url),
      'utf8',
    );
    // Each rider imports the file on their own device: two decodes, one text.
    const mine = decodeGpxRoute(file, { loop: true });
    const theirs = decodeGpxRoute(file, { loop: true });
    const text = raceRouteText(mine.profile);
    expect(raceRouteText(theirs.profile)).toBe(text);
    expect(text).not.toContain('<name>');
    expect(await raceRouteDigest(theirs.profile, webCryptoSha256)).toBe(
      await raceRouteDigest(mine.profile, webCryptoSha256),
    );
    expect(await raceRouteDigest(mine.profile, webCryptoSha256)).toMatch(/^[0-9a-f]{64}$/u);
    // A different road is a different name.
    expect(await raceRouteDigest(route.profile, webCryptoSha256)).not.toBe(
      await raceRouteDigest(mine.profile, webCryptoSha256),
    );
  });

  it('offers a consented ride on its route, and nothing without the consent', async () => {
    expect(await offer(true)).toBe(await raceRouteDigest(route.profile, webCryptoSha256));
    expect(await offer(false)).toBeNull();
  });

  it('offers nothing when a zone touches the route, and does when the zone is off it', async () => {
    expect(await offer(true, [{ centre: centreOfStart, radius: metres(100) }])).toBeNull();
    const far = at(centreOfStart.latitude + 0.1, centreOfStart.longitude);
    expect(await offer(true, [{ centre: far, radius: metres(100) }])).not.toBeNull();
  });

  it('reads the ride, its route and the rider’s zones from the store', async () => {
    const harness = createStoreHarness();
    try {
      await seedAthletes(harness);
      await harness.write((store) => store.putRoute(route));
      const onRoute = (await seedRide(harness, ATHLETE_A, { routeId: route.id })).id;
      const free = (await seedRide(harness, ATHLETE_A)).id;
      await harness.write(async (store) => {
        await store.setActivityMayBeRaced(ATHLETE_A, onRoute, true);
        await store.setActivityMayBeRaced(ATHLETE_A, free, true);
      });
      const offerOf = (id: typeof onRoute) =>
        harness.read((store) => raceRouteOf(store, ATHLETE_A, webCryptoSha256)(id));

      expect(await offerOf(onRoute)).toBe(await raceRouteDigest(route.profile, webCryptoSha256));
      expect(await offerOf(free)).toBeNull();

      await harness.write((store) =>
        store.putPrivacyZone({
          id: 'zone-home' as never,
          athleteId: ATHLETE_A,
          centre: centreOfStart,
          radius: metres(100),
          label: 'Home',
          createdAt: 0 as never,
        }),
      );
      expect(await offerOf(onRoute)).toBeNull();
    } finally {
      await harness.destroy();
    }
  });
});
