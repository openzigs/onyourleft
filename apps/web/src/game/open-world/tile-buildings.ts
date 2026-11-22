// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **An open-world ride's mapped buildings, from its tile plans** — #2902.
 *
 * The realistic world's belt draws `FootprintPlan`s (`mapped-buildings.ts`,
 * `three-renderer.ts` §`MappedBuildingBelt`), at most `MAPPED_BUILDING_MAX`
 * of them inside `MAPPED_BUILDING_TRIANGLES` in at most
 * `MAPPED_BUILDING_DRAW_CALLS` draw calls. A route ride plans its footprints
 * once, at the press. An open-world ride plans them here, in the tile worker
 * (`tile-planner.ts`), from what its tiles' plans own (`tile-plan.ts`: each
 * footprint by exactly one tile, a copy two tiles both carry once):
 *
 * - **Which footprints**: every one a planned tile owns whose centroid is
 *   within {@link OPEN_WORLD_BUILDINGS_REACH_METRES} of the rider. The tiles
 *   planned are the rider's, the ones ahead and the ones on **every way on
 *   from the next junction** (`tiles-ahead.ts`), so a footprint on a street
 *   the rider has not chosen is planned as soon as its tile is.
 * - **Against what**: the view the rider is on, drawn in the ride's fixed
 *   frame (`terrain.ts` §`drawProfileIn`). A footprint's plan reads the road
 *   for its ground, its clearance and its front (`footprint-buildings.ts`
 *   §`footprintPlans`), and the ground an open-world ride draws is the view's
 *   until #2899 gives it real heights, so its buildings are planned against
 *   the view they are drawn beside. A new view is planned again, here, off the
 *   main thread; the plans drawn meanwhile stay where they are, because the
 *   frame does not move.
 * - **With no land class and no urban class**: the scene of an open-world
 *   ride has neither, so a plan's ground is the ground the scene draws.
 *
 * On the page's fallback (`reduced` detail) only the
 * {@link REDUCED_BUILDINGS_MOST} nearest are planned, within the belt's own
 * reach, so a plan on the main thread stays a short task.
 */

import type { RouteProfile } from '@onyourleft/domain';
import type { Box, BuildingFeature, CorridorFrame, StreetFeature } from '@onyourleft/map-features';

import { FOOTPRINT_MAX_VERTICES, footprintPlans, type FootprintPlan } from '../footprint-buildings';
import { NO_LAND_CLASS } from '../land-class';
import { MAPPED_BUILDING_REACH_METRES } from '../realistic-budget';
import type { WorldCorridor } from '../world-data/corridor';
import type { TileBlockFeatures, TilePlanDetail } from './tile-plan';

/**
 * How far from the rider footprints are planned: **600 m**. *#2902's choice*:
 * the belt draws nothing past `MAPPED_BUILDING_REACH_METRES` (400 m), and the
 * buildings are planned again every {@link OPEN_WORLD_BUILDINGS_REPLAN_METRES},
 * so what is planned always covers what can be drawn.
 */
export const OPEN_WORLD_BUILDINGS_REACH_METRES = 600;

/** How far the rider rides before the buildings round them are planned again: **150 m**. */
export const OPEN_WORLD_BUILDINGS_REPLAN_METRES = 150;

/** The most footprints the page's fallback plans at once: **120**, the nearest. */
export const REDUCED_BUILDINGS_MOST = 120;

/** What a tile owns, as the worker keeps it once the tile is planned. */
export interface OwnedFootprints {
  readonly block: string;
  readonly box: Box;
  /** Indices into the block's buildings. */
  readonly source: Uint32Array;
  /** `x, z` a footprint, as {@link source}. */
  readonly centroids: Float32Array;
}

/** What the buildings round the rider are planned against. */
export interface BuildingsRequest {
  /** The view the rider is on: what a plan's ground and clearance read. */
  readonly profile: RouteProfile;
  /** Where the rider is, in the ride's frame. */
  readonly x: number;
  readonly z: number;
}

/**
 * The plans of every footprint `owned` holds within reach of the rider, from
 * `blocks`, against `request.profile` in `frame`. See the file's header.
 */
export function planBuildingsNear(
  frame: CorridorFrame,
  blocks: ReadonlyMap<string, TileBlockFeatures>,
  owned: Iterable<OwnedFootprints>,
  request: BuildingsRequest,
  detail: TilePlanDetail,
): readonly FootprintPlan[] {
  const reach =
    detail === 'full' ? OPEN_WORLD_BUILDINGS_REACH_METRES : MAPPED_BUILDING_REACH_METRES;
  const near: { readonly building: BuildingFeature; readonly apart: number }[] = [];
  const boxes: Box[] = [];
  const used = new Set<string>();
  for (const tile of owned) {
    const block = blocks.get(tile.block);
    if (block === undefined) continue;
    boxes.push(tile.box);
    for (let at = 0; at < tile.source.length; at += 1) {
      const apart = Math.hypot(
        (tile.centroids[at * 2] as number) - request.x,
        (tile.centroids[at * 2 + 1] as number) - request.z,
      );
      if (!(apart <= reach)) continue;
      const building = block.buildings[tile.source[at] as number];
      if (building === undefined) continue;
      near.push({ building, apart });
      used.add(tile.block);
    }
  }
  if (detail === 'reduced') {
    near.sort((a, b) => a.apart - b.apart);
    near.length = Math.min(near.length, REDUCED_BUILDINGS_MOST);
  }
  if (near.length === 0) return [];
  const streets: StreetFeature[] = [];
  const landUse = [];
  for (const key of used) {
    const block = blocks.get(key) as TileBlockFeatures;
    for (const each of block.tiles) streets.push(...each.streets);
    landUse.push(...block.landUse);
  }
  const covered = (x: number, z: number): boolean =>
    boxes.some((box) => x >= box.minX && x < box.maxX && z >= box.minZ && z < box.maxZ);
  const corridor: WorldCorridor = {
    routeId: 'open-world',
    origin: { latitude: frame.latitude, longitude: frame.longitude, elevation: 0 },
    covered,
    coveredBoxes: boxes,
    landUse,
    buildings: near.map((each) => each.building),
    paths: [],
    streets,
  };
  return footprintPlans(
    corridor,
    NO_LAND_CLASS,
    request.profile,
    corridor.origin,
    FOOTPRINT_MAX_VERTICES,
  ).plans;
}

/** Every buffer `plans`' triangles are in, each once: what a worker transfers. */
export function footprintPlanBuffers(plans: readonly FootprintPlan[]): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  for (const plan of plans) {
    for (const array of Object.values(plan.triangles)) buffers.add(array.buffer as ArrayBuffer);
  }
  return [...buffers];
}
