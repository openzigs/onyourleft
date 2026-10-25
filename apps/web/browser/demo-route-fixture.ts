// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The demo's baked route for tests — #1652, ADR 0056 D-9: `demo:bake`'s own
 * {@link bakeRoute} and {@link writeBakedRoute}, run over the synthetic
 * corridor archive (`corridor-fixture.ts`) along that fixture's route, so the
 * demo is tested on a bundle baked as the owner's are, and **never on
 * OpenStreetMap data**.
 *
 * `src/demo/baked-route.test.ts` and `DemoPage.test.tsx` read it back through
 * the demo's loader, and `shell-demo.browser.spec.ts` serves it beside the
 * built demo and checks what the page reports against
 * `corridor-fixture.ts` §`expectedCorridorCounts`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { corridorArchiveFrom } from '../src/world-data/corridor-source';
import { countingSource } from '../src/world-data/archive-testing';
import { bakeRoute, strippedGpx, writeBakedRoute } from '../tools/demo/bake-route';
import type { ManifestEntry } from '../tools/demo/bake-route';
import type { RoutePointTuple } from '../tools/demo/route-bundle';
import {
  buildCorridorFixtureArchive,
  corridorFixtureRoute,
  expectedCorridorCounts,
} from './corridor-fixture';

/** The fixture route's id: `?route=fixture`. */
export const FIXTURE_ROUTE_ID = 'fixture';

/** The fixture route's line as a preset GPX: latitude, longitude and elevation only. */
export function fixtureRouteGpx(): string {
  const profile = corridorFixtureRoute();
  const points: RoutePointTuple[] = profile.positions.map((position, index) => [
    Number(position.latitude),
    Number(position.longitude),
    profile.elevations[index] === undefined ? null : Number(profile.elevations[index]),
  ]);
  return strippedGpx(points);
}

/**
 * Bake the fixture route into `directory` as `demo:bake` writes a preset's:
 * the file, `routes.json` and `LICENCE-ODbL.txt`. Returns the manifest's entry.
 */
export async function bakeFixtureRouteInto(directory: string): Promise<ManifestEntry> {
  const baked = await bakeRoute({
    routeId: FIXTURE_ROUTE_ID,
    gpx: fixtureRouteGpx(),
    archive: corridorArchiveFrom(countingSource(await buildCorridorFixtureArchive())),
    archiveUrl: 'file:corridor-fixture.pmtiles',
  });
  writeBakedRoute(directory, baked);
  return baked.entry;
}

/**
 * What the demo reports of the fixture route's corridor (`baked-route.ts`
 * §`CorridorCounts`): `expectedCorridorCounts`, decoded in Node, less the
 * place points, which the demo does not count (ADR 0055 D-5.4).
 */
export function expectedRouteCounts(): Omit<ReturnType<typeof expectedCorridorCounts>, 'places'> {
  const { tiles, buildings, landUse, paths, streets } = expectedCorridorCounts();
  return { tiles, buildings, landUse, paths, streets };
}

/** Every file in a baked `routes/` directory, by its path relative to the demo's page. */
export function routeFilesIn(directory: string): Map<string, Uint8Array<ArrayBuffer>> {
  return new Map(
    readdirSync(directory).map((name) => [
      `./routes/${name}`,
      new Uint8Array(readFileSync(join(directory, name))),
    ]),
  );
}
