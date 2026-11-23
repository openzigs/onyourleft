// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **An open-world ride's streets, as the scene reads a corridor's** — #2903.
 *
 * Until now an open-world ride handed the scene no corridor
 * (`GameView.tsx` skips the corridor read for one), so nothing of the map was
 * drawn but the ridden line: no street at a junction, so a turn read as the
 * screen flipping (the owner, 2026-11-22). The scene already draws every
 * mapped street off the route as road out to the fog, in the road's own
 * material and its one draw call (`nearby-streets.ts`, #2973, written to be
 * shared with this issue), and a stub at each junction
 * (`cross-streets.ts`). Both read `WorldCorridor.streets` and
 * `WorldCorridor.covered`. So {@link openWorldStreetCorridor} is that corridor
 * for an open world: every street of every block the area reader holds,
 * decoded in the session's frame, which is the frame the whole ride is drawn
 * in (`terrain.ts` §`drawProfileIn`), and the blocks' tiles as covered land.
 *
 * ## Streets, and the footprints only for the driveways
 *
 * It carries no land use, footway, place, river or railway: the rest is not
 * this issue's. It does carry every held block's footprints, for one reader:
 * `nearby-streets.ts`, where a service road stops short of a mapped house
 * (its `FootprintGrid`). Without them the scene drew a driveway through every
 * house the worker had kept beside it (the review of #3080). The scene plans
 * no building from them: the mapped buildings are the tile worker's
 * (`tile-buildings.ts`, #2902), and `scene.ts` reads a corridor's footprints
 * nowhere else. The worker clears its service roads against the footprints it
 * plans, a subset of these, so every driveway the scene draws is one the
 * worker kept its buildings off.
 *
 * ## The road wins, against the whole network
 *
 * The tile worker plans the buildings against the SAME corridor, built by this
 * function over the same held blocks (`tile-buildings.ts` §`planBuildingsNear`),
 * so `footprint-buildings.ts` rule 3b drops a footprint on any street the
 * scene draws, by its class's width (ADR 0054 D-5.4 applied to the network).
 */

import type { BuildingFeature, CorridorFrame, StreetFeature } from '@onyourleft/map-features';

import { coveredLookup, type CorridorTile, type WorldCorridor } from '../world-data/corridor';
import { tileBox } from '@onyourleft/map-features';
import type { TileBlockFeatures } from './tile-plan';

/** The corridor of `blocks`' streets in `frame`. See the file's header. */
export function openWorldStreetCorridor(
  frame: CorridorFrame,
  blocks: Iterable<TileBlockFeatures>,
): WorldCorridor {
  const origin = { latitude: frame.latitude, longitude: frame.longitude, elevation: 0 };
  const tiles: CorridorTile[] = [];
  const streets: StreetFeature[] = [];
  const buildings: BuildingFeature[] = [];
  for (const block of blocks) {
    for (const building of block.buildings) buildings.push(building);
    for (const each of block.tiles) {
      tiles.push({ x: each.tile.x, y: each.tile.y, state: 'covered' });
      for (const street of each.streets) {
        streets.push({
          kind: street.kind,
          kindDetail: street.kindDetail,
          grade: street.grade,
          line: street.line,
        });
      }
    }
  }
  return {
    routeId: 'open-world',
    origin,
    covered: coveredLookup(origin, tiles),
    coveredBoxes: tiles.map((tile) => tileBox(frame, { z: 15, x: tile.x, y: tile.y })),
    landUse: [],
    buildings,
    paths: [],
    streets,
    places: [],
    waterLines: [],
    rails: [],
  };
}
