// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The built-in Delivery levels, as the game rides them** — #2361, ADR 0065.
 *
 * Each file under `data/` becomes a ridable route whose id is in the `level:`
 * namespace (`@onyourleft/store` §`levelRouteId`), which no saved route's id
 * and no circuit's may carry (D-8.2). So a level is never a `RouteRecord`: it
 * is not saved, synced, exported or shared (D-8.3), and nothing of it is kept
 * in the world corridor store (D-2.4) — its buildings come from its own file,
 * through {@link levelCorridor}, so a level draws the same with or without a
 * network, an archive or an instance. The files are in the app bundle, each
 * its own chunk loaded only when the game asks for the levels (D-2.5), by the
 * loaders `game/shipped-levels.ts` makes: `import.meta.glob` is a load the
 * trainer walk refuses to pass over, so it is outside `delivery/`, and is
 * handed in here as the circuits are handed to the game.
 *
 * The listing is not the level (D-2.5, #2362): {@link levelLibrary} answers
 * the picker from `catalogue.ts` — each level's id, name, length and houses —
 * without calling a loader, and reads one file in full only when that level
 * is chosen. `levels.test.ts` holds the catalogue to the files. Tests use the
 * synthetic `fixtures/fixture-level.json`, so no test is a Produced Work of a
 * real level (D-7.5). Nothing here imports a trainer port, a gradient or the
 * simulation (`delivery-cannot-reach-trainer.test.ts` walks this directory,
 * D-11).
 */

import { routeProfile, type AltitudeMetres, type GeographicPosition } from '@onyourleft/domain';
import {
  corridorTileCover,
  NO_BUILDING_FIELDS,
  type BuildingFeature,
} from '@onyourleft/map-features';
import { isLevelRouteId, LEVEL_ROUTE_PREFIX, levelRouteId } from '@onyourleft/store';

import type { RidableRoute } from '../../StageChooser';
import { corridorOrigin } from '../../terrain';
import {
  CORRIDOR_HALF_WIDTH_METRES,
  CORRIDOR_MAX_TILES,
  worldCorridorOf,
  type WorldCorridor,
} from '../../world-data/corridor';
import type { LevelListing } from './catalogue';
import { LEVEL_ID_PATTERN, parseLevelFile, type LevelBuilding, type LevelFile } from './level-file';

/** One loader per file under `data/`, by its path. */
export type LevelLoaders = Readonly<Record<string, () => Promise<unknown>>>;

/**
 * The level a route id names, or `undefined` for any id that is not a
 * level's: a saved route's, a circuit's, or one whose second half is not a
 * level id at all.
 */
export function levelOfRouteId(routeId: string): string | undefined {
  if (!isLevelRouteId(routeId)) return undefined;
  const level = routeId.slice(LEVEL_ROUTE_PREFIX.length);
  return LEVEL_ID_PATTERN.test(level) ? level : undefined;
}

/** A checked file, as a ridable route keyed `level:<id>`, a loop or point to point, with no attempts. */
export function levelRoute(file: LevelFile): RidableRoute {
  return {
    id: levelRouteId(file.id),
    name: file.name,
    profile: routeProfile(
      file.points.map(([latitude, longitude, height]) => ({
        position: { latitude, longitude } as GeographicPosition,
        elevation: height as AltitudeMetres,
      })),
      { loop: file.shape === 'loop' },
    ),
    attempts: 0,
  };
}

/** A file's footprint as the realistic world reads one: every unset field `null`. */
export function levelBuildingFeature(building: LevelBuilding): BuildingFeature {
  return {
    kind: building.kind,
    heightMetres: building.heightMetres,
    minHeightMetres: building.minHeightMetres,
    ...NO_BUILDING_FIELDS,
    ...building.fields,
    rings: building.rings.map((ring) => Float32Array.from(ring)),
  } as BuildingFeature;
}

/**
 * The corridor a ride on a level is handed (D-2.2, D-2.4): the file's
 * footprints and **no other layer**, over the tiles a read of the line would
 * have covered, every one of them `covered`. So the rest of the town is drawn
 * as the realistic world draws a corridor that carries no records of those
 * kinds. Built from the file alone: no request, no store.
 */
export function levelCorridor(file: LevelFile): WorldCorridor {
  const route = levelRoute(file);
  const tiles = corridorTileCover(
    route.profile.positions,
    CORRIDOR_HALF_WIDTH_METRES,
    CORRIDOR_MAX_TILES,
  ).map((tile) => ({ x: tile.x, y: tile.y, state: 'covered' as const }));
  return worldCorridorOf(route.id, corridorOrigin(route.profile), tiles, {
    landUse: [],
    buildings: file.buildings.map(levelBuildingFeature),
    paths: [],
    streets: [],
    places: [],
  });
}

/** `./data/harbour.json` → `harbour`. */
function idOfPath(path: string): string {
  return path.replace(/^.*\//, '').replace(/\.json$/, '');
}

/** A level as the picker lists it, with the `level:` route id its link opens the setup on. */
export interface ListedLevel extends LevelListing {
  readonly routeId: string;
}

/** The built-in levels as the game asks for them: listed from the catalogue, loaded one at a time (D-2.5). */
export interface LevelLibrary {
  /** Every shipped level, in unlock order, from the catalogue alone: no file is read. */
  list(): readonly ListedLevel[];
  /**
   * One level, read in full: only its own file's loader is called. `undefined`
   * for an id the bundle does not ship, or a file that does not read as one.
   */
  load(id: string): Promise<LevelFile | undefined>;
}

/**
 * The library over `loaders` (one per file, by path) and `catalogue` (one
 * listing per level). A listing with no file is not offered, so a bundle
 * missing a file loses a rider that level and not the list.
 */
export function levelLibrary(
  loaders: LevelLoaders,
  catalogue: readonly LevelListing[],
): LevelLibrary {
  const byId = new Map(Object.entries(loaders).map(([path, load]) => [idOfPath(path), load]));
  const listed = catalogue
    .filter((listing) => byId.has(listing.id))
    .sort((a, b) => a.houses - b.houses || a.id.localeCompare(b.id))
    .map((listing) => ({ ...listing, routeId: levelRouteId(listing.id) }));
  return {
    list: () => listed,
    load: async (id) => {
      const load = byId.get(id);
      if (load === undefined) return undefined;
      try {
        return parseLevelFile(await load(), id);
      } catch {
        return undefined;
      }
    },
  };
}
