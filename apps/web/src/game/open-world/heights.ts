// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The open-world ride's height tiles** — #2899, ADR 0087 D-2, D-3 and D-7.
 *
 * An open-world ride has no route in advance, so it has no stored profile:
 * the road's heights are read while the ride is under way, from #2013's
 * terrain archive, at z12. This module holds the few tiles round the rider
 * and answers, at once and from what is held, *how high is the ground here?*
 * The rolling route asks that for each sample it takes
 * (`@onyourleft/domain` §`RollingHeights`).
 *
 * ## Which tiles, and when (ADR 0087 D-2.2, ADR 0090's rules)
 *
 * - **R-1, a function of the rider's block alone.** The tiles held are the
 *   z12 tiles that contain the 3 × 3 blocks round the rider's block
 *   (`world-data/area.ts` §`blockOf`): one to four, each 7.5 to 9 km across
 *   and 1 MiB decoded, so no more than 4 MiB is ever held.
 *   A tile out of that reach is let go.
 *   Two places in one block ask for the same tiles, and nothing is asked for
 *   while the rider stays in a block.
 * - **R-3, the same inside a privacy zone.** No zone is handed in or read.
 * - **R-6, map tiles off: nothing.** The switch is read before every request.
 * - **R-8, a crossing waits.** The tiles a block crossing brings into reach
 *   are asked for after a random delay of up to 30 s
 *   (`area.ts` §`crossingDelayMs`). The start's are asked for at once. The
 *   delay holds only the request: the ride goes on, on what is held.
 * - **Through #2013's one module** (D-2.3): the archive handed in is
 *   `terrain/terrain-source.ts`'s. Nothing here names a network primitive.
 *
 * ## A tile is untrusted (D-3)
 *
 * It is decoded by `terrain/decode.ts`, inside its bounds: at most 4 MiB,
 * lossless WebP only, exactly 512 × 512 read from the header before any
 * decoder sees it, 2 s to decode, heights from −200 m to 4,600 m. A tile
 * that fails any of them is held as one with no heights, so it is not asked
 * for again, and the road there is level (D-7). Never a throw.
 *
 * ⚠️ **No words here name a tile, a block or a coordinate** (ADR 0004 D,
 * ADR 0090 R-2): a failure is said through `describeTerrainFailure` and
 * `describeHeightTileRefusal`, which carry a reason and nothing else.
 */

import type { GeographicPosition } from '@onyourleft/domain';
import {
  describeHeightTileRefusal,
  heightTilePosition,
  isHeightTileRefusal,
  sampleHeightTile,
  type HeightTile,
  type HeightTileId,
} from '@onyourleft/map-features';

import { decodeHeightTile, type DecodeHeightTile } from '../../terrain/decode';
import {
  describeTerrainFailure,
  terrainFailureOf,
  type TerrainArchive,
} from '../../terrain/terrain-source';
import { blockOf, blocksAround, crossingDelayMs } from '../world-data/area';

/**
 * How long the start waits for its height tiles before the ride begins
 * without them: **10 s**. *#2899's choice.* The ride does not need them to
 * start: with none, the road is level and the grade sent is 0 % until they
 * arrive (ADR 0087 D-7), and then walks to the road's at 1 % a second.
 */
export const HEIGHTS_START_TIMEOUT_MS = 10_000;

/**
 * How many times a tile whose decode ran out of time is asked for again:
 * **2**, so three tries in all. *#2891's choice.* A decode that is merely late
 * (a ride started from the kept-block cache unpacks, reframes and plans in the
 * same moments as the first tile decodes) is not a hostile tile, and holding it
 * as one left the whole block's road level. A tile that is late every time is
 * held as one with no heights, so a slow device is not asked for ever.
 */
export const HEIGHTS_TIMED_OUT_RETRIES = 2;

export interface RoadHeightsOptions {
  /** `terrain/terrain-source.ts` §`terrainArchive` in the product; `undefined` when none is configured. */
  readonly archive: TerrainArchive | undefined;
  /** The map-tiles switch (ADR 0087 D-2.4), read before every request. */
  readonly mapTilesOn: () => boolean;
  /** The tile decoder: the platform's, inside D-3's bounds, unless a test hands in another. */
  readonly decode?: DecodeHeightTile | undefined;
  /** Runs `run` after `ms`; returns what cancels it. `setTimeout` in the product. */
  readonly schedule?: ((run: () => void, ms: number) => () => void) | undefined;
  /** The draw for R-8's delay. `Math.random` in the product. */
  readonly random?: (() => number) | undefined;
  /** Where failures are said, in words that name no tile and no place. */
  readonly log?: ((line: string) => void) | undefined;
  /** Told when a tile's heights arrive: the road asks again for what it lacked. */
  readonly onChange?: (() => void) | undefined;
  /** The start's bound: {@link HEIGHTS_START_TIMEOUT_MS} when absent. */
  readonly startTimeoutMs?: number | undefined;
}

export interface RoadHeights {
  /**
   * Ask for the start's tiles, at once. Resolves when each has arrived, been
   * refused or failed, or after the start's bound, whichever is first. Never
   * rejects.
   */
  start(position: GeographicPosition): Promise<void>;
  /** Where the rider is now: the tiles a new block brings into reach are asked for, after R-8's delay. */
  moveTo(position: GeographicPosition): void;
  /** The ground's height at a place, in metres, from the tiles held; `undefined` where none is known. */
  readonly heightAt: (position: GeographicPosition) => number | undefined;
  /** Counts the tiles whose heights have arrived: a change means {@link heightAt} may answer more. */
  readonly version: number;
  /** Nothing more is asked for, no timer is left, and the tiles held are let go. Safe to call twice. */
  stop(): void;
}

const defaultSchedule = (run: () => void, ms: number): (() => void) => {
  const timer = setTimeout(run, ms);
  return () => {
    clearTimeout(timer);
  };
};

const keyOf = (tile: HeightTileId): string => `${String(tile.x)}/${String(tile.y)}`;

/** The z12 tiles that contain the 3 × 3 blocks round `position`'s block, and the block's key. */
function tilesRound(
  position: GeographicPosition,
): { readonly block: string; readonly tiles: readonly HeightTileId[] } | undefined {
  const block = blockOf(position);
  if (block === undefined) return undefined;
  const tiles = new Map<string, HeightTileId>();
  for (const each of blocksAround(block)) {
    // A z14 block lies inside exactly one z12 tile (ADR 0087 D-2.2).
    const tile: HeightTileId = { z: 12, x: Math.floor(each.x / 4), y: Math.floor(each.y / 4) };
    tiles.set(keyOf(tile), tile);
  }
  return { block: `${String(block.x)}/${String(block.y)}`, tiles: [...tiles.values()] };
}

/** The height tiles round an open-world ride's rider. See the file's header. */
export function createRoadHeights(options: RoadHeightsOptions): RoadHeights {
  const { archive } = options;
  const schedule = options.schedule ?? defaultSchedule;
  const decode = options.decode ?? ((bytes: Uint8Array) => decodeHeightTile(bytes));
  /** A tile's heights; `null` for one with none (outside the archive, or refused). */
  const held = new Map<string, HeightTile | null>();
  /** The tiles being read, or waiting out R-8's delay, with what cancels the wait. */
  const asked = new Map<string, (() => void) | undefined>();
  let wanted = new Map<string, HeightTileId>();
  let block: string | undefined;
  /** How many times each tile's decode has run out of time. */
  const timedOut = new Map<string, number>();
  let version = 0;
  let stopped = false;
  const stopping = new AbortController();

  const read = async (tile: HeightTileId): Promise<void> => {
    const key = keyOf(tile);
    asked.set(key, undefined);
    try {
      if (archive === undefined || !options.mapTilesOn()) return;
      const bytes = await archive.tile(tile, stopping.signal);
      if (stopped || !wanted.has(key)) return;
      if (bytes === undefined) {
        // Outside the archive's extract: no heights, and not asked for again.
        held.set(key, null);
        return;
      }
      const decoded = await decode(bytes);
      if (stopped || !wanted.has(key)) return;
      if (isHeightTileRefusal(decoded)) {
        options.log?.(describeHeightTileRefusal(decoded));
        const late = (timedOut.get(key) ?? 0) + 1;
        timedOut.set(key, late);
        if (decoded.reason === 'timed-out' && late <= HEIGHTS_TIMED_OUT_RETRIES) {
          // Late, not hostile: not held, so the next `moveTo` asks again.
          block = undefined;
          return;
        }
        held.set(key, null);
        return;
      }
      held.set(key, decoded);
      version += 1;
      options.onChange?.();
    } catch (error) {
      // Not held. Forgetting the block makes the next `moveTo` ask again for
      // what is missing, after R-8's delay, so a moment offline is not the
      // whole ride without heights.
      if (!stopped) {
        options.log?.(describeTerrainFailure(terrainFailureOf(error)));
        block = undefined;
      }
    } finally {
      asked.delete(key);
    }
  };

  /** Make `position`'s tiles the ones wanted; ask for the new ones after `delay()`. */
  const want = (position: GeographicPosition, delay: () => number): Promise<void>[] => {
    const round = tilesRound(position);
    if (round === undefined || round.block === block) return [];
    block = round.block;
    wanted = new Map(round.tiles.map((tile) => [keyOf(tile), tile]));
    for (const key of [...held.keys()]) if (!wanted.has(key)) held.delete(key);
    for (const key of [...timedOut.keys()]) if (!wanted.has(key)) timedOut.delete(key);
    for (const [key, cancel] of [...asked]) {
      if (wanted.has(key)) continue;
      cancel?.();
      asked.delete(key);
    }
    const reads: Promise<void>[] = [];
    for (const [key, tile] of wanted) {
      if (held.has(key) || asked.has(key)) continue;
      const wait = delay();
      if (wait <= 0) {
        reads.push(read(tile));
        continue;
      }
      asked.set(
        key,
        schedule(() => {
          if (!stopped && wanted.has(key)) void read(tile);
        }, wait),
      );
    }
    return reads;
  };

  return {
    get version() {
      return version;
    },

    start: (position) => {
      if (stopped) return Promise.resolve();
      const reads = want(position, () => 0);
      if (reads.length === 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const cancel = schedule(resolve, options.startTimeoutMs ?? HEIGHTS_START_TIMEOUT_MS);
        void Promise.all(reads).then(() => {
          cancel();
          resolve();
        });
      });
    },

    moveTo: (position) => {
      if (stopped) return;
      // A draw of nought is no wait at all: that read starts now, and never rejects.
      void Promise.all(want(position, () => crossingDelayMs(options.random ?? Math.random)));
    },

    heightAt: (position) => {
      const at = heightTilePosition(position.longitude, position.latitude);
      if (at === undefined) return undefined;
      const tile = held.get(keyOf(at.tile));
      if (tile === undefined || tile === null) return undefined;
      return sampleHeightTile(tile, at.column, at.row);
    },

    stop: () => {
      if (stopped) return;
      stopped = true;
      stopping.abort();
      for (const cancel of asked.values()) cancel?.();
      asked.clear();
      held.clear();
      timedOut.clear();
      wanted.clear();
    },
  };
}
