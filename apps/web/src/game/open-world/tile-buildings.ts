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
 * - **Each once** (#3132): a footprint two tiles each carry, whole in one and
 *   clipped at the other's buffer, can be owned by both, its centroid in
 *   each; so the footprints within reach are held once
 *   (`world-data/tile-copies.ts`), and a building mapped in parts is drawn by
 *   its parts and not by its outline too (`world-data/part-outlines.ts`).
 *   Drawn twice, the two copies' walls were one plane, and flickered.
 * - **Against what**: the view the rider is on, drawn in the ride's fixed
 *   frame (`terrain.ts` §`drawProfileIn`). A footprint's plan reads the road
 *   for its ground, its clearance and its front (`footprint-buildings.ts`
 *   §`footprintPlans`), and the ground an open-world ride draws is the view's
 *   until #2899 gives it real heights, so its buildings are planned against
 *   the view they are drawn beside. A new view is planned again, here, off the
 *   main thread; the plans drawn meanwhile stay where they are, because the
 *   frame does not move, and look as they did, because every choice a plan
 *   makes is seeded from the frame (`scatter.ts` §`frameSeed`), never from the
 *   view, whose own seed changes with it. Only its base and eaves follow the
 *   view: they stand on the ground the scene draws, which is the view's.
 * - **With no land class and no urban class**: the scene of an open-world
 *   ride has neither, so a plan's ground is the ground the scene draws.
 *
 * On the page's fallback (`reduced` detail) only the
 * {@link REDUCED_BUILDINGS_MOST} nearest are planned, within the belt's own
 * reach, so a plan on the main thread stays a short task.
 */

import type { RouteProfile } from '@onyourleft/domain';
import type { Box, BuildingFeature, CorridorFrame, LandUseFeature } from '@onyourleft/map-features';

import { FOOTPRINT_MAX_VERTICES, footprintPlans, type FootprintPlan } from '../footprint-buildings';
import { NO_LAND_CLASS } from '../land-class';
import { MAPPED_BUILDING_REACH_METRES } from '../realistic-budget';
import { frameSeed } from '../scatter';
import { anchorScenery, sceneryAnchor } from '../scenery-anchor';
import { StreetLevels } from '../street-levels';
import type { WorldCorridor } from '../world-data/corridor';
import { withoutPartOutlines } from '../world-data/part-outlines';
import { withoutTileCopies } from '../world-data/tile-copies';
import { openWorldStreetCorridor } from './street-corridor';
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
  /**
   * #3094: what the road keyed {@link profile}'s scenery and ground on
   * (`scenery-anchor.ts`): the ride's seed and the view's ride distance. A
   * worker is handed a copy of the profile, which nobody keyed, and keys it
   * with these, so a plan stands on the ground the scene draws.
   */
  readonly scenery?: { readonly seed: number; readonly origin: number } | undefined;
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
  /**
   * #3094: the held streets the ground is levelled beside, kept by the caller
   * across requests; absent, found from `blocks` for this one.
   */
  levels?: StreetLevels,
): readonly FootprintPlan[] {
  const reach =
    detail === 'full' ? OPEN_WORLD_BUILDINGS_REACH_METRES : MAPPED_BUILDING_REACH_METRES;
  const near: { readonly building: BuildingFeature; readonly apart: number }[] = [];
  const used = new Set<string>();
  for (const tile of owned) {
    const block = blocks.get(tile.block);
    if (block === undefined) continue;
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
  if (near.length === 0) return [];
  // #3132: each building drawn once. A footprint near a tile's edge is in both
  // tiles' features, whole in one and clipped in the other, and each tile owns
  // the copy whose centroid is its own, so both were planned: the same walls,
  // twice, on one plane. And a building mapped in parts is drawn by its parts,
  // not by its outline as well (`world-data/part-outlines.ts`).
  const apart = new Map(near.map((each) => [each.building, each.apart]));
  const once = withoutTileCopies(withoutPartOutlines(near.map((each) => each.building))).map(
    // A kept copy may carry the other's point of interest: a new object, at the same place.
    (building) => ({ building, apart: apart.get(building) ?? centroidApart(building, request) }),
  );
  if (detail === 'reduced') {
    once.sort((a, b) => a.apart - b.apart);
    once.length = Math.min(once.length, REDUCED_BUILDINGS_MOST);
  }
  const landUse: LandUseFeature[] = [];
  for (const key of used) landUse.push(...(blocks.get(key) as TileBlockFeatures).landUse);
  // #2903: every held block's streets and tiles, as the scene's corridor holds
  // them (`street-corridor.ts`), so rule 3b keeps each footprint off every
  // street the scene draws, by its class's width.
  const corridor: WorldCorridor = {
    ...openWorldStreetCorridor(frame, blocks.values()),
    landUse,
    buildings: once.map((each) => each.building),
  };
  // #3094: a copy of the view the road keyed is keyed here as the road keyed
  // it, its ground levelled beside the same held streets, so the plans stand
  // on the ground the scene draws. The view itself, on the page, is the
  // road's own and keyed already.
  const { scenery } = request;
  if (scenery !== undefined && sceneryAnchor(request.profile) === undefined) {
    const streets = corridor.streets;
    anchorScenery(request.profile, {
      seed: scenery.seed,
      origin: scenery.origin,
      levels: levels ?? new StreetLevels(() => streets),
      frame: corridor.origin,
    });
  }
  return footprintPlans(
    corridor,
    NO_LAND_CLASS,
    request.profile,
    corridor.origin,
    FOOTPRINT_MAX_VERTICES,
    undefined,
    { seed: frameSeed(frame) },
  ).plans;
}

/** How far `building`'s outer ring's vertices' mean stands from the rider. */
function centroidApart(
  building: BuildingFeature,
  at: { readonly x: number; readonly z: number },
): number {
  const ring = building.rings[0];
  if (ring === undefined || ring.length < 2) return Number.POSITIVE_INFINITY;
  let x = 0;
  let z = 0;
  const n = Math.floor(ring.length / 2);
  for (let i = 0; i < n; i += 1) {
    x += ring[i * 2] as number;
    z += ring[i * 2 + 1] as number;
  }
  return Math.hypot(x / n - at.x, z / n - at.z);
}

/** Every buffer `plans`' triangles are in, each once: what a worker transfers. */
export function footprintPlanBuffers(plans: readonly FootprintPlan[]): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  for (const plan of plans) {
    for (const array of Object.values(plan.triangles)) buffers.add(array.buffer as ArrayBuffer);
  }
  return [...buffers];
}
