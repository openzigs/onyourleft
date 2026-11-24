// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Which map tiles an open-world ride plans next** — #2901.
 *
 * `tile-planner.ts` plans the tiles it is asked for in the order it is asked,
 * one at a time, so this order is the ride's priority. {@link tilesToPlan}
 * reads the rolling route the rider is on and lists, first to last:
 *
 * 1. the rider's own tile;
 * 2. the tiles the route crosses from the rider to its next junction;
 * 3. **the tiles every way on from that junction crosses**, out to
 *    {@link PLAN_BRANCH_METRES} along each — the way the rider has not chosen
 *    as much as the default, so that a turn finds the new street planned. They
 *    are asked for as soon as the junction is the next one, which is no later
 *    than its prompt (`junction-choice.ts` §`JUNCTION_PROMPT_METRES`, 250 m),
 *    and so well before its lock (`JUNCTION_LOCK_METRES`, 100 m);
 * 4. the tiles the route crosses past the junction, out to
 *    {@link PLAN_AHEAD_METRES} from the rider.
 *
 * Every tile once. A position's tile is read by the archive's own z15 grid
 * (`@onyourleft/map-features` §`columnAtLongitude`, `rowAtLatitude`), and
 * nothing of the position is kept: the list is of tiles, which is all the
 * planner is told (ADR 0090 R-1).
 */

import {
  distanceBetween,
  positionAt,
  type GeographicPosition,
  type RollingRoute,
} from '@onyourleft/domain';
import {
  columnAtLongitude,
  rowAtLatitude,
  TILES_AT_Z15,
  type TileId,
} from '@onyourleft/map-features';

/**
 * How far ahead of the rider the route's tiles are planned: **700 m**, the
 * spike's recommended lead (`docs/spikes/0041-rolling-route-and-a-turning-ride.md`,
 * recommendation 2): the fog's 400 m and 300 m more.
 */
export const PLAN_AHEAD_METRES = 700;

/**
 * How far along each way on from the next junction its tiles are planned:
 * **400 m**, the fog (`three-renderer.ts` §`FOGGED_OUT_METRES`), all a rider
 * turning there can see.
 */
export const PLAN_BRANCH_METRES = 400;

/** How far apart the points a line's tiles are read at are: **25 m**, far under a tile's side. */
const SAMPLE_METRES = 25;

/** The z15 tile `position` is in; `undefined` off the grid. */
function tileAt(position: GeographicPosition): TileId | undefined {
  const x = Math.floor(columnAtLongitude(position.longitude));
  const y = Math.floor(rowAtLatitude(position.latitude));
  if (!(x >= 0 && x < TILES_AT_Z15 && y >= 0 && y < TILES_AT_Z15)) return undefined;
  return { z: 15, x, y };
}

/** A list of tiles, each once, in the order first added. */
class TileList {
  readonly tiles: TileId[] = [];
  readonly #seen = new Set<number>();

  add(position: GeographicPosition): void {
    const tile = tileAt(position);
    if (tile === undefined) return;
    const key = tile.y * TILES_AT_Z15 + tile.x;
    if (this.#seen.has(key)) return;
    this.#seen.add(key);
    this.tiles.push(tile);
  }
}

/** The tiles along `points` from their start, out to `reach` metres, read every {@link SAMPLE_METRES}. */
function addAlong(list: TileList, points: readonly GeographicPosition[], reach: number): void {
  let travelled = 0;
  const first = points[0];
  if (first === undefined) return;
  list.add(first);
  for (let index = 1; index < points.length && travelled < reach; index += 1) {
    const from = points[index - 1] as GeographicPosition;
    const to = points[index] as GeographicPosition;
    const length = distanceBetween(from, to) as number;
    const steps = Math.max(1, Math.ceil(length / SAMPLE_METRES));
    for (let step = 1; step <= steps; step += 1) {
      const share = step / steps;
      if (travelled + share * length > reach) break;
      list.add({
        latitude: from.latitude + (to.latitude - from.latitude) * share,
        longitude: from.longitude + (to.longitude - from.longitude) * share,
      } as GeographicPosition);
    }
    travelled += length;
  }
}

/** The tiles of the view from ride distance `from` to `to`, read every {@link SAMPLE_METRES}. */
function addView(list: TileList, route: RollingRoute, from: number, to: number): void {
  const view = route.view();
  const lowest = 0;
  const highest = route.end - route.origin;
  for (let at = from; at <= to; at += SAMPLE_METRES) {
    const along = at - route.origin;
    if (along < lowest || along > highest) continue;
    list.add(positionAt(view, along));
  }
}

/**
 * The tiles to plan for a rider at ride distance `rider` on `route`, first
 * first. See the file's header. A rider that is not a finite number is none.
 */
export function tilesToPlan(route: RollingRoute, rider: number): readonly TileId[] {
  if (!Number.isFinite(rider)) return [];
  const list = new TileList();
  const ahead = rider + PLAN_AHEAD_METRES;
  const junction = route.nextJunctionAfter(rider);
  if (junction === undefined || junction.distance > ahead) {
    addView(list, route, rider, ahead);
    return list.tiles;
  }
  addView(list, route, rider, junction.distance);
  for (const way of junction.ways) {
    addAlong(
      list,
      way.edge.points.map((point) => point.position),
      PLAN_BRANCH_METRES,
    );
  }
  addView(list, route, junction.distance, ahead);
  return list.tiles;
}
