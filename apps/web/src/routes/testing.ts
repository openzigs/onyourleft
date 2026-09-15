// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * An in-memory {@link RouteStore} for the routes screen's tests.
 *
 * The same shape as `segments/testing.ts`: enough store to render the screen,
 * and one lever per failure the screen is supposed to handle.
 *
 * ⚠️ **This is not a substitute for the round-trip harness.** Persistence is
 * asserted in `packages/store/src/route-store.test.ts` against a real
 * IndexedDB, where a write that reports success and cannot be read back goes
 * red. What this stub is for is the *screen's* decisions — what it refuses,
 * what it says, and what it writes — which a real database would only make
 * slower to assert.
 */

import type { AthleteId, PrivacyZoneRecord, RouteId, RouteRecord } from '@onyourleft/store';

import type { RoutePort, RouteStore } from './store-port';

export interface RouteStub extends RoutePort {
  readonly store: RouteStore;
  /** Every route currently held, in insertion order. */
  rows(): readonly RouteRecord[];
  /** Make the next `listRoutes` throw, for the offline case. */
  failNextList(): void;
  /**
   * Replace a stored route without going through `putRoute`.
   *
   * This is how a second tab is modelled: the row moves under an editor that
   * is still holding the old `updatedAt`.
   */
  writeBehind(record: RouteRecord): void;
  setZones(zones: readonly PrivacyZoneRecord[]): void;
}

export function routeStub(owner: AthleteId, seed: readonly RouteRecord[] = []): RouteStub {
  const rows = new Map<string, RouteRecord>(seed.map((route) => [route.id, route]));
  let zones: readonly PrivacyZoneRecord[] = [];
  let failList = false;

  const store: RouteStore = {
    listRoutes: (requester, limit) => {
      if (failList) {
        failList = false;
        return Promise.reject(new Error('the local store is unavailable'));
      }
      // Scoped on the way out, like the real one: a stub that ignored the owner
      // would make a cross-athlete bug in the screen invisible here.
      const mine = [...rows.values()].filter((route) => route.createdBy === requester).reverse();
      return Promise.resolve(limit === undefined ? mine : mine.slice(0, limit));
    },
    getRoute: (requester, id) => {
      const found = rows.get(id);
      return Promise.resolve(found?.createdBy === requester ? found : undefined);
    },
    putRoute: (record) => {
      rows.set(record.id, record);
      return Promise.resolve(record.id);
    },
    deleteRoute: (requester, id) => {
      const found = rows.get(id);
      if (found?.createdBy !== requester) return Promise.resolve(false);
      rows.delete(id);
      return Promise.resolve(true);
    },
    listPrivacyZones: () => Promise.resolve([...zones]),
  };

  return {
    athleteId: owner,
    store,
    rows: () => [...rows.values()],
    failNextList: () => {
      failList = true;
    },
    writeBehind: (record) => {
      rows.set(record.id, record);
    },
    setZones: (next) => {
      zones = next;
    },
  };
}

/** A route id the stub will accept. */
export function stubRouteId(value: string): RouteId {
  return value as RouteId;
}

/**
 * Where the synthetic routes below are drawn, and the two conversions used to
 * place them.
 *
 * A metre of latitude is a fixed number of degrees anywhere; a metre of
 * longitude is not, so it is scaled by `cos φ`. Both are good enough at this
 * scale for a fixture whose whole purpose is that its two ends are a **known**
 * distance apart — the assertions read the gap out of the refusal, so a
 * hundredth of a metre of projection error changes nothing.
 */
const FIXTURE_CENTRE = { latitude: 51.5074, longitude: -0.1278 };
const METRES_PER_DEGREE_LATITUDE = 111_194.93;

function gpxDocument(points: readonly string[], name: string | undefined): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="a route planner" xmlns="http://www.topografix.com/GPX/1/1">',
    '  <rte>',
    ...(name === undefined ? [] : [`    <name>${name}</name>`]),
    ...points,
    '  </rte>',
    '</gpx>',
    '',
  ].join('\n');
}

/**
 * A GPX circuit that comes back to where it started — the file a rider ticks
 * the loop box for.
 *
 * ⚠️ **The last point is the first point**, so the closure gap is zero rather
 * than "under the threshold by a margin the fixture chose". A fixture that
 * closed to within 24 m would pass today and fail the day the domain's 25 m
 * closure threshold is tightened, which would read as this code breaking
 * rather than as the fixture having been built on the number.
 *
 * @param circumferenceMetres how long the lap is. Short by default: the game
 * screen's test has to ride a whole lap and start a second one, and every
 * metre of that is frames pumped by hand.
 */
export function loopGpx(
  options: { readonly circumferenceMetres?: number; readonly name?: string } = {},
): string {
  const circumference = options.circumferenceMetres ?? 300;
  const radius = circumference / (2 * Math.PI);
  const metresPerDegreeLongitude =
    METRES_PER_DEGREE_LATITUDE * Math.cos((FIXTURE_CENTRE.latitude * Math.PI) / 180);
  const steps = 60;
  const points: string[] = [];
  for (let index = 0; index <= steps; index += 1) {
    // The closing point is the opening one, exactly — see above.
    const at = index === steps ? 0 : index;
    const angle = (at / steps) * 2 * Math.PI;
    const latitude =
      FIXTURE_CENTRE.latitude + (radius * Math.sin(angle)) / METRES_PER_DEGREE_LATITUDE;
    const longitude =
      FIXTURE_CENTRE.longitude + (radius * Math.cos(angle)) / metresPerDegreeLongitude;
    // A gentle rise and fall around the lap, so the profile is a profile. Kept
    // small so a rider on a trainer gets round it at a speed a test can budget
    // frames for.
    const elevation = 30 + 4 * Math.sin(angle);
    points.push(
      `    <rtept lat="${latitude.toFixed(7)}" lon="${longitude.toFixed(7)}">` +
        `<ele>${elevation.toFixed(1)}</ele></rtept>`,
    );
  }
  return gpxDocument(points, options.name);
}

/**
 * A GPX line that runs away from its start and stays there — the file a rider
 * ticks the loop box for **by mistake**.
 *
 * @param gapMetres how far the finish ends up from the start, which is the
 * number the refusal has to name.
 */
export function openEndedGpx(gapMetres: number, name?: string): string {
  const points: string[] = [];
  const step = gapMetres / 20;
  for (let along = 0; along <= gapMetres + step / 2; along += step) {
    const latitude = FIXTURE_CENTRE.latitude + along / METRES_PER_DEGREE_LATITUDE;
    points.push(
      `    <rtept lat="${latitude.toFixed(7)}" lon="${FIXTURE_CENTRE.longitude.toFixed(7)}">` +
        '<ele>30.0</ele></rtept>',
    );
  }
  return gpxDocument(points, name);
}
