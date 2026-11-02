// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * A route drawn on the planner's map is a saved route like any other — #2006's
 * second criterion, against the **real** local store.
 *
 * `save.store.test.ts`'s reason, for a drawn route: asserting what the planner
 * handed `putRoute` is asserting an object literal. So the planner is mounted
 * over a port whose every call goes to IndexedDB through
 * `@onyourleft/store/testing`, and each claim is read back on a connection
 * that never saw the write:
 *
 * - it is in the list the Routes screen reads, and that screen shows it;
 * - it is in the list the game reads to ride one (`main.tsx` §`listRoutes`,
 *   `store.listRoutes` over the same athlete), with the line the rider drew;
 * - its downloads (#74) carry that line.
 */

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  type GeographicPosition,
} from '@onyourleft/domain';
import { decodeGpxRoute } from '@onyourleft/fit';
import type { RouteRecord } from '@onyourleft/store';
import {
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  seedAthletes,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { OSM_ATTRIBUTION } from '../map/basemap';
import { stubMapPort } from '../map/testing';
import { mount, settle, submitForm, typeInto, type Mounted } from '../testing/mount';
import { RouteBuilderView } from '../views/RouteBuilderView';
import { RoutesView } from '../views/RoutesView';
import { exportedFrom } from './export';
import type { RoutePort } from './store-port';

const BASEMAP = { archiveUrl: 'https://tiles.example.org/b.pmtiles', attribution: OSM_ATTRIBUTION };

let harness: StoreHarness | undefined;
let mounted: Mounted | undefined;

afterEach(async () => {
  mounted?.unmount();
  mounted = undefined;
  await harness?.destroy();
  harness = undefined;
});

function at(latitude: number, longitude: number): GeographicPosition {
  return geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude));
}

/** The screens' port, every call of it a write to the real store. */
function realPort(open: StoreHarness): RoutePort {
  return {
    athleteId: ATHLETE_A,
    store: {
      listRoutes: (owner, limit) => open.write((store) => store.listRoutes(owner, limit)),
      getRoute: (owner, id) => open.write((store) => store.getRoute(owner, id)),
      putRoute: (record) => open.write((store) => store.putRoute(record)),
      deleteRoute: (owner, id) => open.write((store) => store.deleteRoute(owner, id)),
      listPrivacyZones: (owner) => open.write((store) => store.listPrivacyZones(owner)),
    },
  };
}

const DRAWN = [at(40, -105), at(40.02, -105), at(40.02, -104.98)];

/** Draw three waypoints on the planner's map, name the route, and save it. */
async function drawnAndSaved(open: StoreHarness): Promise<void> {
  const engine = stubMapPort();
  mounted = await mount(
    <main>
      <h1>Draw a route</h1>
      <RouteBuilderView
        storage={{ read: () => undefined, write: () => undefined, forget: () => undefined }}
        map={() => Promise.resolve(engine)}
        basemap={BASEMAP}
        routes={realPort(open)}
        now={() => 1_700_000_000}
      />
    </main>,
  );
  await settle();
  await settle();
  for (const point of DRAWN) {
    await act(async () => {
      engine.created[0]?.handlers?.tap(point);
      await Promise.resolve();
    });
    await settle();
  }
  const input = mounted.container.querySelector<HTMLInputElement>('input[name="name"]');
  const form = mounted.container.querySelector<HTMLFormElement>(
    'form[aria-label="Save this route"]',
  );
  if (input === null || form === null) throw new Error('the planner offers no save');
  await typeInto(input, 'Drawn on the map');
  await submitForm(form);
  // The write is a real IndexedDB transaction; let it land.
  for (let turn = 0; turn < 5; turn += 1) await settle();
  mounted.unmount();
  mounted = undefined;
}

async function openSeeded(): Promise<StoreHarness> {
  const opened = createStoreHarness();
  await seedAthletes(opened);
  harness = opened;
  return opened;
}

async function readBack(open: StoreHarness): Promise<RouteRecord> {
  const listed = await open.read((store) => store.listRoutes(ATHLETE_A));
  expect(listed).toHaveLength(1);
  return listed[0]!;
}

describe('a drawn route, saved — #2006', () => {
  it('reads back on a fresh connection with the line that was drawn, private', async () => {
    const open = await openSeeded();
    await drawnAndSaved(open);
    const route = await readBack(open);
    expect(route.name).toBe('Drawn on the map');
    expect(route.visibility).toBe('private');
    expect(route.profile.positions[0]).toEqual(DRAWN[0]);
    expect(route.profile.positions.at(-1)).toEqual(DRAWN[2]);
    // Two straight legs of about 2.2 km and 1.7 km.
    expect(route.profile.totalDistance).toBeGreaterThan(3_900);
    expect(route.profile.totalDistance).toBeLessThan(4_000);
  });

  it('is the rider’s alone: another athlete’s list does not have it', async () => {
    const open = await openSeeded();
    await drawnAndSaved(open);
    expect(await open.read((store) => store.listRoutes(ATHLETE_B))).toEqual([]);
  });

  it('appears in Routes beside an imported one would', async () => {
    const open = await openSeeded();
    await drawnAndSaved(open);
    await open.discard();
    mounted = await mount(
      <main>
        <h1>Routes</h1>
        <RoutesView port={realPort(open)} />
      </main>,
    );
    for (let turn = 0; turn < 5; turn += 1) await settle();
    const names = [...mounted.container.querySelectorAll('a[data-oyl-select]')].map(
      (link) => link.textContent,
    );
    expect(names).toEqual(['Drawn on the map']);
  });

  it('downloads as GPX and TCX, and the GPX reads back as the drawn line', async () => {
    const open = await openSeeded();
    await drawnAndSaved(open);
    const route = await readBack(open);
    for (const format of ['gpx', 'tcx'] as const) {
      const { file } = exportedFrom(route, format);
      expect(new TextDecoder().decode(file.bytes)).toContain('Drawn on the map');
    }
    // Through the importer a rider would load it back with.
    const gpx = new TextDecoder().decode(exportedFrom(route, 'gpx').file.bytes);
    const decoded = decodeGpxRoute(gpx);
    expect(decoded.profile.positions[0]?.latitude).toBeCloseTo(40, 5);
    expect(decoded.profile.positions[0]?.longitude).toBeCloseTo(-105, 5);
    expect(decoded.profile.totalDistance).toBeCloseTo(route.profile.totalDistance, -1);
  });
});
