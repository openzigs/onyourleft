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
 * ## Streets only
 *
 * It carries no land use, footprint, footway, place, river or railway: the
 * mapped buildings are the tile worker's (`tile-buildings.ts`, #2902), and the
 * rest is not this issue's. With no footprints in it, nothing the scene plans
 * from a corridor's buildings — the procedural lots' town — plans anything.
 *
 * ## The road wins, against the whole network
 *
 * The tile worker plans the buildings against the SAME corridor, built by this
 * function over the same held blocks (`tile-buildings.ts` §`planBuildingsNear`),
 * so `footprint-buildings.ts` rule 3b drops a footprint on any street the
 * scene draws, by its class's width (ADR 0054 D-5.4 applied to the network).
 */

import type { CorridorFrame, StreetFeature } from '@onyourleft/map-features';

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
  for (const block of blocks) {
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
    buildings: [],
    paths: [],
    streets,
    places: [],
    waterLines: [],
    rails: [],
  };
}
