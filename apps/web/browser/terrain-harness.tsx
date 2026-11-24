// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A drawn route's heights, in a real engine — #2013.
 *
 * Node has no WebP decoder, so the Vitest suites read synthetic tiles through
 * a stand-in (`src/terrain/terrain-testing.ts` §`fixtureDecode`). This page is
 * the other half: the **product's** decoder (`src/terrain/decode.ts`
 * §`platformWebpPixels`, `createImageBitmap`), the **product's** reader and
 * its one `fetch` (`src/terrain/terrain-source.ts`), over the synthetic
 * archive `terrain-fixture.ts` emits at this origin.
 *
 * It publishes `window.__oylTerrain`:
 *
 * - `slope`: the slope tile decoded by the platform, and how far the worst
 *   pixel is from the height that was written;
 * - `malformed` and `oversize`: what the decoder made of each hostile tile;
 * - `line`: heights along a line across the hills tile, through the fetch;
 * - `hostileLine`: the same across the malformed and the oversize tile.
 *
 * And it mounts the **real** `AppShell` on the route planner, with a draft
 * through `terrainFixtureWaypoints` already in this origin's `localStorage`
 * and the reader as its heights, under the real stylesheet: the planner's
 * profile of a drawn route, for the owner's screenshots.
 *
 * ## What it does not prove
 *
 * Anything about the hosted archive: its latency, its CORS, or that a real
 * Mapterhorn tile decodes (one was decoded by hand during #2013's research,
 * with the system's decoder, not this one). And the planner here has no map
 * panel: `map.browser.spec.ts` is where a map is drawn.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { metres } from '@onyourleft/domain';
import {
  isHeightTileRefusal,
  type HeightTile,
  type HeightTileRefusal,
} from '@onyourleft/map-features';
import {
  oversizeHeightTile,
  SLOPE_BASE_METRES,
  slopeHeightTile,
  truncatedHeightTile,
} from '@onyourleft/map-features/testing';

import type { CapabilityProbe } from '../src/support/bluetooth-support';
import { AppShell } from '../src/shell/AppShell';
import { addWaypoint, emptyDraft } from '../src/routing/draft';
import { DRAFT_STORAGE_KEY, serialiseDraft } from '../src/routing/draft-storage';
import { resampleShape } from '../src/routing/elevation';
import { decodeHeightTile } from '../src/terrain/decode';
import { terrainHeights } from '../src/terrain/route-heights';
import { terrainArchive } from '../src/terrain/terrain-source';
import { FIXTURE_HEIGHT_TILE, placeInTile } from '../src/terrain/terrain-testing';

import {
  MALFORMED_HEIGHT_TILE,
  OVERSIZE_HEIGHT_TILE,
  SLOPE_RISE_PER_PIXEL,
  TERRAIN_ARCHIVE_FILE,
  terrainFixtureWaypoints,
} from './terrain-fixture';

import '../src/design/theme.css';
import '../src/design/tailwind.css';

/** What the platform made of a tile: a refusal, or how many of its pixels hold a height. */
export type DecodedSummary =
  | { readonly refused: HeightTileRefusal['reason'] }
  | { readonly valid: number; readonly noData: number };

export interface TerrainHarness {
  readonly ready: boolean;
  readonly errors: readonly string[];
  /** The slope tile through the platform's decoder: the worst pixel's error, in metres. */
  readonly slope: { readonly worstErrorMetres: number; readonly pixels: number } | undefined;
  readonly malformed: DecodedSummary | undefined;
  readonly oversize: DecodedSummary | undefined;
  /** Heights along the hills tile's middle row, through the product's fetch. */
  readonly line: readonly (number | undefined)[];
  /** Heights along a line over the malformed and the oversize tile. */
  readonly hostileLine: readonly (number | undefined)[];
}

declare global {
  interface Window {
    __oylTerrain?: TerrainHarness;
  }
}

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

function summary(decoded: HeightTile | HeightTileRefusal): DecodedSummary {
  if (isHeightTileRefusal(decoded)) return { refused: decoded.reason };
  let valid = 0;
  for (const height of decoded.heights) if (!Number.isNaN(height)) valid += 1;
  return { valid, noData: decoded.heights.length - valid };
}

async function run(): Promise<void> {
  const errors: string[] = [];
  const state: { -readonly [K in keyof TerrainHarness]: TerrainHarness[K] } = {
    ready: false,
    errors,
    slope: undefined,
    malformed: undefined,
    oversize: undefined,
    line: [],
    hostileLine: [],
  };
  window.__oylTerrain = state;

  const heights = terrainHeights({
    archive: terrainArchive({ archiveUrl: `${window.location.origin}/${TERRAIN_ARCHIVE_FILE}` }),
  });

  try {
    // The decode alone, through the platform, over a tile built in the page.
    const slope = await decodeHeightTile(slopeHeightTile(SLOPE_RISE_PER_PIXEL));
    if (isHeightTileRefusal(slope)) {
      errors.push(`the slope tile was refused: ${slope.reason}`);
    } else {
      let worst = 0;
      slope.heights.forEach((height, index) => {
        const written = SLOPE_BASE_METRES + (index % 512) * SLOPE_RISE_PER_PIXEL;
        worst = Math.max(worst, Math.abs(height - written));
      });
      state.slope = { worstErrorMetres: worst, pixels: slope.heights.length };
    }
    state.malformed = summary(await decodeHeightTile(truncatedHeightTile()));
    state.oversize = summary(await decodeHeightTile(oversizeHeightTile()));

    // A line through the product's reader and its one fetch.
    const interval = heights.interval;
    const across = resampleShape(
      [placeInTile(FIXTURE_HEIGHT_TILE, 40, 256), placeInTile(FIXTURE_HEIGHT_TILE, 470, 256)],
      interval,
    );
    const answer = await heights.heights({ shape: across, interval });
    state.line = answer.samples.map((sample) => sample.elevation);

    const hostile = resampleShape(
      [placeInTile(MALFORMED_HEIGHT_TILE, 200, 256), placeInTile(OVERSIZE_HEIGHT_TILE, 300, 256)],
      metres(150),
    );
    state.hostileLine = (
      await heights.heights({ shape: hostile, interval: metres(150) })
    ).samples.map((sample) => sample.elevation);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  // The planner, with a draft already drawn: straight freehand legs, as with no engine.
  const draft = terrainFixtureWaypoints().reduce(
    (drawn, place) => addWaypoint(drawn, place, 'freehand').draft,
    emptyDraft(),
  );
  window.localStorage.setItem(DRAFT_STORAGE_KEY, serialiseDraft(draft));
  window.location.hash = '#/routes/new';
  const host = document.getElementById('root');
  if (host === null) throw new Error('terrain.html has no #root');
  createRoot(host).render(
    <StrictMode>
      <AppShell capabilities={NO_BLUETOOTH} heights={heights} />
    </StrictMode>,
  );
  state.ready = true;
}

void run();
