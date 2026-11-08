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
 * #2361 ships no level: `data/` holds only the notice, and nothing in the app
 * calls {@link loadBuiltInLevels} yet. #2362 commits the first two files and
 * lists them in the Delivery picker. Tests use the synthetic
 * `fixtures/fixture-level.json`, so no test is a Produced Work of a real level
 * (D-7.5). Nothing here imports a trainer port, a gradient or the simulation
 * (`delivery-cannot-reach-trainer.test.ts` walks this directory, D-11).
 *
 * @unwired #2361 ships the loader and no level; the build tool and the tests
 * read it, and #2362 hands it the shipped files and lists them in the picker.
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
import { parseLevelFile, type LevelBuilding, type LevelFile } from './level-file';

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
  return /^[a-z][a-z0-9-]{1,31}$/.test(level) ? level : undefined;
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

/**
 * Every level, in unlock order: fewest houses first, as D-4.3 has each later
 * level hold strictly more. A file that does not read as a level is left out
 * and the rest are offered: a damaged bundle loses a rider that level and not
 * the others.
 */
export async function loadBuiltInLevels(loaders: LevelLoaders): Promise<readonly LevelFile[]> {
  const read = await Promise.all(
    Object.entries(loaders).map(async ([path, load]): Promise<LevelFile | undefined> => {
      try {
        return parseLevelFile(await load(), idOfPath(path));
      } catch {
        return undefined;
      }
    }),
  );
  return read
    .filter((file) => file !== undefined)
    .sort((a, b) => a.round.houses - b.round.houses || a.id.localeCompare(b.id));
}
