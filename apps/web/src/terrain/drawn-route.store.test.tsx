// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * A route drawn with no instance and no routing engine is saved with real
 * climbs — #2013's second and fifth criteria, against the **real** local
 * store and a fixture terrain archive read through `PMTiles`.
 *
 * `routes/save-draft.store.test.tsx`'s reason: asserting what the planner
 * handed `putRoute` is asserting an object literal. So the planner is mounted
 * with the product's own reader over a synthetic archive, the route is drawn
 * and saved, and each claim is read back on a connection that never saw the
 * write: the distance, the climb, the grade the game would send, and the
 * dataset the route says its heights came from.
 */

import { gradeAt, metres, type GeographicPosition } from '@onyourleft/domain';
import { heightPixelMetres } from '@onyourleft/map-features';
import { slopeHeightTile } from '@onyourleft/map-features/testing';
import type { RouteRecord } from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  seedAthletes,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { OSM_ATTRIBUTION } from '../map/basemap';
import { stubMapPort } from '../map/testing';
import { FLAT_WITHOUT_ELEVATION_TEXT } from '../routes/save';
import type { RoutePort } from '../routes/store-port';
import { mount, settle, submitForm, typeInto, type Mounted } from '../testing/mount';
import { RouteBuilderView } from '../views/RouteBuilderView';
import { countingSource, type CountingSource } from '../world-data/archive-testing';
import { TERRAIN_DATASET_NAME, type RouteHeights } from './heights';
import { terrainHeights } from './route-heights';
import { terrainArchiveFrom } from './terrain-source';
import {
  buildTerrainArchive,
  fixtureDecode,
  FIXTURE_HEIGHT_TILE,
  placeInTile,
} from './terrain-testing';

const BASEMAP = { archiveUrl: 'https://tiles.example.org/b.pmtiles', attribution: OSM_ATTRIBUTION };

let harness: StoreHarness | undefined;
let mounted: Mounted | undefined;

afterEach(async () => {
  mounted?.unmount();
  mounted = undefined;
  await harness?.destroy();
  harness = undefined;
});

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

/** West to east along the fixture tile's middle row: uphill at 5 % all the way. */
const DRAWN: GeographicPosition[] = [
  placeInTile(FIXTURE_HEIGHT_TILE, 60, 256),
  placeInTile(FIXTURE_HEIGHT_TILE, 260, 256),
  placeInTile(FIXTURE_HEIGHT_TILE, 460, 256),
];
const PIXEL_METRES = heightPixelMetres(DRAWN[0]!.latitude);

async function slopeReader(): Promise<{ heights: RouteHeights; source: CountingSource }> {
  const source = countingSource(
    await buildTerrainArchive([
      { tile: FIXTURE_HEIGHT_TILE, bytes: slopeHeightTile(0.05 * PIXEL_METRES) },
    ]),
  );
  return {
    heights: terrainHeights({ archive: terrainArchiveFrom(source), decode: fixtureDecode }),
    source,
  };
}

/** Draw the line on the planner's map with no routing engine, and leave the planner open. */
async function drawn(open: StoreHarness, heights: RouteHeights): Promise<Mounted> {
  const engine = stubMapPort();
  const view = await mount(
    <main>
      <h1>Draw a route</h1>
      <RouteBuilderView
        heights={heights}
        storage={{ read: () => undefined, write: () => undefined, forget: () => undefined }}
        map={() => Promise.resolve(engine)}
        basemap={BASEMAP}
        routes={realPort(open)}
        now={() => 1_700_000_000}
      />
    </main>,
  );
  mounted = view;
  await settle();
  await settle();
  for (const point of DRAWN) {
    await act(async () => {
      engine.created[0]?.handlers?.tap(point);
      await Promise.resolve();
    });
    await settle();
  }
  // The read is a chain of promises over the archive; let it land.
  for (let turn = 0; turn < 10; turn += 1) await settle();
  return view;
}

async function save(view: Mounted): Promise<void> {
  const input = view.container.querySelector<HTMLInputElement>('input[name="name"]');
  const form = view.container.querySelector<HTMLFormElement>('form[aria-label="Save this route"]');
  if (input === null || form === null) throw new Error('the planner offers no save');
  await typeInto(input, 'Up the slope');
  await submitForm(form);
  for (let turn = 0; turn < 5; turn += 1) await settle();
}

async function openSeeded(): Promise<StoreHarness> {
  const opened = createStoreHarness();
  await seedAthletes(opened);
  harness = opened;
  return opened;
}

async function readBack(open: StoreHarness): Promise<RouteRecord> {
  await open.discard();
  const listed = await open.read((store) => store.listRoutes(ATHLETE_A));
  expect(listed).toHaveLength(1);
  return listed[0]!;
}

describe('a route drawn with no instance and no engine — #2013', () => {
  it('shows its climb from the terrain archive while it is being drawn', async () => {
    const open = await openSeeded();
    const { heights } = await slopeReader();
    const view = await drawn(open, heights);
    const text = view.container.textContent ?? '';
    expect(text).toContain(`from ${TERRAIN_DATASET_NAME} at`);
    expect(text).toContain('sampled every 15 m');
    expect(text).not.toContain('No elevation profile yet.');
    expect(text).not.toContain('climbing stays empty');
  });

  it('is saved with its distance, its climb and its grade, read back on a fresh connection', async () => {
    const open = await openSeeded();
    const { heights } = await slopeReader();
    await save(await drawn(open, heights));
    const route = await readBack(open);

    // The line that was drawn: 400 px of the tile, west to east.
    const length = 400 * PIXEL_METRES;
    expect(route.profile.totalDistance).toBeGreaterThan(length * 0.99);
    expect(route.profile.totalDistance).toBeLessThan(length * 1.01);
    // A steady 5 %: a twentieth of the length climbed, nothing descended.
    expect(route.profile.totalAscent / route.profile.totalDistance).toBeCloseTo(0.05, 3);
    expect(route.profile.totalDescent).toBe(0);
    // What the game reads to set the trainer's grade on this route.
    expect(gradeAt(route.profile, metres(route.profile.totalDistance / 2))).toBeCloseTo(5, 1);
    // And where the heights came from, kept with the route.
    expect(route.elevation?.dataset).toBe(TERRAIN_DATASET_NAME);
    expect(route.elevation?.interval).toBe(15);
    expect(route.elevation?.missing).toBe(0);
    expect(route.elevation?.resolution).toBeCloseTo(PIXEL_METRES, 1);
  });

  it('offline: says elevation could not be downloaded, and the route still saves, flat', async () => {
    const open = await openSeeded();
    const { heights, source } = await slopeReader();
    source.offline = true;
    const view = await drawn(open, heights);
    expect(view.container.textContent).toContain(
      "Elevation couldn't be downloaded right now. The route is saved flat; try again later.",
    );
    await save(view);
    expect(view.container.textContent).toContain('Saved “Up the slope” to your routes.');
    expect(view.container.textContent).toContain(FLAT_WITHOUT_ELEVATION_TEXT);

    const route = await readBack(open);
    expect(route.name).toBe('Up the slope');
    expect(route.profile.totalAscent).toBe(0);
    // It claims no dataset: nothing was read.
    expect(route.elevation).toBeUndefined();
    expect(route.profile.totalDistance).toBeGreaterThan(400 * PIXEL_METRES * 0.99);
  });
});
