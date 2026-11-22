// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2882's spike: reading a block and planning the town around the rider —
 * the same calls on the main thread and in `plan-worker.ts`, so the two modes
 * differ only in where they run. Throwaway (see `../rolling-profile.ts`).
 *
 * Every planner here is the product's own, called as `GameView`'s press calls
 * it (`GameView.tsx` §the press, `realistic/town.ts` §`plannedTown`): nothing
 * about a building's plan is changed for the spike.
 */

import type { RouteProfile } from '@onyourleft/domain';
import { decodeTile } from '@onyourleft/map-features';

import { FOOTPRINT_MAX_VERTICES, footprintPlans } from '../../../src/game/footprint-buildings';
import type { FootprintPlan } from '../../../src/game/footprint-buildings';
import { landClassMask, type LandClassMask } from '../../../src/game/land-class';
import type { CorridorOrigin } from '../../../src/game/terrain';
import { urbanClassMap, type UrbanClassMap } from '../../../src/game/urban-class';
import {
  worldCorridorOf,
  type CorridorArchive,
  type CorridorFeatures,
  type CorridorTile,
  type WorldCorridor,
} from '../../../src/game/world-data/corridor';
import { blockTiles } from '../block-grid';
import type { PlanTimings } from '../summary';

/** One block as read: its tiles' states and their features, in the ride's frame. */
export interface ReadBlock {
  readonly key: number;
  readonly tiles: readonly CorridorTile[];
  readonly features: CorridorFeatures;
  /** From asking for the block's first tile to its last one decoded. */
  readonly readMs: number;
  /** Of that, the time spent decoding, summed over its tiles. */
  readonly decodeMs: number;
  /** The tiles' decompressed bytes, which is what the archive hands back. */
  readonly bytes: number;
}

const EMPTY: CorridorFeatures = {
  landUse: [],
  buildings: [],
  paths: [],
  streets: [],
  places: [],
  waterLines: [],
};

/** Reads and decodes the `size × size` tiles of block `key`, four at a time as the product's read does. */
export async function readBlock(
  archive: CorridorArchive,
  key: number,
  size: number,
  origin: CorridorOrigin,
  signal: AbortSignal,
): Promise<ReadBlock> {
  const started = performance.now();
  const frame = { latitude: origin.latitude, longitude: origin.longitude };
  let decodeMs = 0;
  let bytes = 0;
  const parts = await Promise.all(
    blockTiles(key, size).map(async (tile): Promise<[CorridorTile, CorridorFeatures]> => {
      const raw = await archive.tile({ z: 15, x: tile.x, y: tile.y }, signal);
      if (raw === undefined) return [{ ...tile, state: 'outside-archive' }, EMPTY];
      bytes += raw.byteLength;
      const from = performance.now();
      const decoded = decodeTile(raw, { z: 15, x: tile.x, y: tile.y }, frame);
      decodeMs += performance.now() - from;
      if ('reason' in decoded) return [{ ...tile, state: 'refused' }, EMPTY];
      return [{ ...tile, state: 'covered' }, decoded];
    }),
  );
  return {
    key,
    tiles: parts.map(([tile]) => tile),
    features: merged(parts.map(([, features]) => features)),
    readMs: performance.now() - started,
    decodeMs,
    bytes,
  };
}

/** Several blocks' features as one. */
export function merged(all: readonly CorridorFeatures[]): CorridorFeatures {
  return {
    landUse: all.flatMap((each) => each.landUse),
    buildings: all.flatMap((each) => each.buildings),
    paths: all.flatMap((each) => each.paths),
    streets: all.flatMap((each) => each.streets),
    places: all.flatMap((each) => each.places),
    waterLines: all.flatMap((each) => each.waterLines ?? []),
  };
}

/** The corridor the planners are handed: the blocks near the rider, as one. */
export function blocksCorridor(
  blocks: readonly ReadBlock[],
  origin: CorridorOrigin,
): WorldCorridor {
  return worldCorridorOf(
    'open-world-spike',
    origin,
    blocks.flatMap((block) => block.tiles),
    merged(blocks.map((block) => block.features)),
  );
}

/** The ride's land-class mask and urban class over `corridor`, as the press makes them, timed. */
export function planGround(
  corridor: WorldCorridor,
  profile: RouteProfile,
): {
  readonly land: LandClassMask;
  readonly urban: UrbanClassMap;
  readonly landMs: number;
  readonly urbanMs: number;
} {
  let at = performance.now();
  const land = landClassMask(corridor);
  const landMs = performance.now() - at;
  at = performance.now();
  const urban = urbanClassMap(corridor, land, profile);
  return { land, urban, landMs, urbanMs: performance.now() - at };
}

/** The town's land, urban class and footprint plans, as the press makes them, timed. */
export function planTown(
  corridor: WorldCorridor,
  profile: RouteProfile,
  origin: CorridorOrigin,
  corridorMs: number,
): {
  readonly land: LandClassMask;
  readonly urban: UrbanClassMap;
  readonly plans: readonly FootprintPlan[];
  readonly timings: PlanTimings;
} {
  const { land, urban, landMs, urbanMs } = planGround(corridor, profile);
  const at = performance.now();
  const { plans } = footprintPlans(corridor, land, profile, origin, FOOTPRINT_MAX_VERTICES, urban);
  const plansMs = performance.now() - at;
  return { land, urban, plans, timings: { corridorMs, landMs, urbanMs, plansMs } };
}
