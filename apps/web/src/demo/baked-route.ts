// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A preset route's baked map data, read into memory — #1652, ADR 0056 D-8.1.
 *
 * `demo:bake` (#1651) writes each route's file into the demo's own output,
 * `routes/<id>.<digest>.bin`, with `routes/routes.json` naming it and its
 * SHA-256. This reads the two **through a function the caller hands in**
 * (`main.tsx` reads them with three's `FileLoader`, as the realistic world's
 * files are read, same-origin under the page's `connect-src 'self'`), checks
 * the digest, decodes the file with `tools/demo/route-bundle.ts`
 * §`readRouteBundle` as it is, and builds the {@link WorldCorridor} a ride's
 * scene takes, exactly as `world-data/corridor-port.ts` builds a rider's from
 * its store: `corridor.ts` §`planCorridor` of the route's line, the file's
 * uncovered tiles marked, and §`worldCorridorOf`.
 *
 * ⚠️ **In memory only.** Nothing here, and nothing it imports, writes
 * anything anywhere: not `corridor-port.ts` (which keeps a rider's corridor in
 * IndexedDB and reads their privacy zones), not `@onyourleft/store`.
 * `no-recorded-data.test.ts` refuses both imports, and the demo build refuses
 * both modules (`tools/demo/forbidden-modules.ts`).
 *
 * ⚠️ **A broken file is an error, never a crash.** A missing manifest or
 * entry, a digest that does not match, a truncated gzip, a file of another
 * format or reader version, or a plan that does not match the file's: each
 * is {@link BakedRouteLoad} `failed`, and the demo rides its synthetic road
 * with {@link BAKED_ROUTE_UNAVAILABLE} on screen. The sentence names no
 * coordinate (ADR 0004 D), and no cause either: the visitor can do nothing
 * about which one it was.
 */

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  type RouteProfile,
} from '@onyourleft/domain';

import { corridorOrigin } from '../game/terrain';
import {
  CORRIDOR_READER_VERSION,
  corridorStateText,
  planCorridor,
  worldCorridorOf,
  type CorridorTile,
  type WorldCorridor,
} from '../game/world-data/corridor';
import { readRouteBundle, ROUTE_ID } from '../../tools/demo/route-bundle';

/** Where the baked routes are, relative to the page (`demo-routes.ts` §`ROUTES_DIRECTORY`). */
export const BAKED_ROUTES_PATH = './routes/';

/** The manifest's name in it (`demo-routes.ts` §`ROUTE_MANIFEST_FILE`). */
export const BAKED_ROUTE_MANIFEST = 'routes.json';

/** The ODbL notice file beside the bundles (`demo-routes.ts` §`ODBL_NOTICE_FILE`). */
export const BAKED_ROUTE_NOTICE_FILE = 'LICENCE-ODbL.txt';

/** A bundle's file name as `bake-route.ts` writes it: the id, sixteen hex digits of its digest. */
const BUNDLE_FILE = /^[a-z0-9][a-z0-9-]{0,62}\.[0-9a-f]{16}\.bin$/;

/** What the page says when a route's map data cannot be drawn: `corridor.ts`' own sentence. */
export const BAKED_ROUTE_UNAVAILABLE = corridorStateText({
  kind: 'unavailable',
  why: 'refused',
});

/** Reads one of the demo's own files, by its path relative to the page. */
export type ReadDemoFile = (path: string) => Promise<Uint8Array<ArrayBuffer>>;

/**
 * How many of each feature a route's corridor holds — what `__oylDemo`
 * reports. Not the place points: ADR 0055 D-5.4 admits one reader of them,
 * `urban-class.ts` (`places-never-shown.test.ts`).
 */
export interface CorridorCounts {
  readonly tiles: number;
  readonly buildings: number;
  readonly landUse: number;
  readonly paths: number;
  readonly streets: number;
}

/** A baked route, decoded: the road the riders ride and the map data drawn beside it. */
export interface BakedRoute {
  readonly id: string;
  readonly profile: RouteProfile;
  readonly corridor: WorldCorridor;
  /** The bundle's path relative to the page, which the ODbL notice offers (§4.6 a). */
  readonly bundlePath: string;
  readonly counts: CorridorCounts;
}

/** What a load came to. */
export type BakedRouteLoad =
  | { readonly kind: 'ready'; readonly route: BakedRoute }
  | { readonly kind: 'failed'; readonly notice: string };

/**
 * The SHA-256 of `bytes`, as lower-case hex. ⚠️ `crypto.subtle` is there only
 * in a secure context — `https:`, or a loopback address — so a page served
 * over plain `http:` from anywhere else cannot check the digest, and rides
 * the synthetic road with {@link BAKED_ROUTE_UNAVAILABLE} rather than draw
 * data it did not check.
 */
async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The manifest's entry for `id`: its file and digest, or `undefined` when it has none that reads. */
function entryOf(manifest: unknown, id: string): { file: string; sha256: string } | undefined {
  if (typeof manifest !== 'object' || manifest === null) return undefined;
  const routes = (manifest as { routes?: unknown }).routes;
  if (typeof routes !== 'object' || routes === null || !Object.hasOwn(routes, id)) return undefined;
  const entry = (routes as Record<string, unknown>)[id];
  if (typeof entry !== 'object' || entry === null) return undefined;
  const { file, sha256 } = entry as { file?: unknown; sha256?: unknown };
  if (typeof file !== 'string' || !BUNDLE_FILE.test(file) || !file.startsWith(`${id}.`)) {
    return undefined;
  }
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) return undefined;
  return { file, sha256 };
}

/** The route's road, from the file's points, as `bake-route.ts` §`routeLineOf` built it. */
function profileOf(points: readonly (readonly [number, number, number | null])[]): RouteProfile {
  return routeProfile(
    points.map(([latitude, longitude, elevation]) => ({
      position: geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude)),
      elevation: elevation === null ? undefined : altitudeMetres(elevation),
    })),
  );
}

async function load(id: string, read: ReadDemoFile): Promise<BakedRoute | undefined> {
  if (!ROUTE_ID.test(id)) return undefined;
  const manifestBytes = await read(`${BAKED_ROUTES_PATH}${BAKED_ROUTE_MANIFEST}`);
  const entry = entryOf(JSON.parse(new TextDecoder().decode(manifestBytes)) as unknown, id);
  if (entry === undefined) return undefined;
  const bundlePath = `${BAKED_ROUTES_PATH}${entry.file}`;
  const bytes = await read(bundlePath);
  if ((await sha256Hex(bytes)) !== entry.sha256) return undefined;
  const { bundle, features } = await readRouteBundle(bytes);
  // A file baked by another reader holds features this one may not read alike.
  if (bundle.readerVersion !== CORRIDOR_READER_VERSION) return undefined;
  const profile = profileOf(bundle.route.points);
  const plan = planCorridor(profile.positions, []);
  if (plan === undefined || plan.tiles.length !== bundle.tiles.planned) return undefined;
  const uncovered = new Map(bundle.tiles.uncovered.map((tile) => [tile.index, tile.state]));
  const tiles: CorridorTile[] = plan.tiles.map((tile, index) => ({
    ...tile,
    state: uncovered.get(index) ?? tile.state,
  }));
  const covered = tiles.filter((tile) => tile.state === 'covered').length;
  // As `corridor-port.ts`: a corridor with nothing read is no map data at all.
  if (covered === 0) return undefined;
  const corridor = worldCorridorOf(id, corridorOrigin(profile), tiles, features);
  return {
    id,
    profile,
    corridor,
    bundlePath,
    counts: {
      tiles: covered,
      buildings: features.buildings.length,
      landUse: features.landUse.length,
      paths: features.paths.length,
      streets: features.streets.length,
    },
  };
}

/**
 * Read route `id`'s baked map data through `read`. Never rejects: every
 * failure, a read's included, is `failed` with {@link BAKED_ROUTE_UNAVAILABLE}.
 */
export async function loadBakedRoute(id: string, read: ReadDemoFile): Promise<BakedRouteLoad> {
  try {
    const route = await load(id, read);
    return route === undefined
      ? { kind: 'failed', notice: BAKED_ROUTE_UNAVAILABLE }
      : { kind: 'ready', route };
  } catch {
    return { kind: 'failed', notice: BAKED_ROUTE_UNAVAILABLE };
  }
}
