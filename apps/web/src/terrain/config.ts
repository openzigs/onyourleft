// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where the terrain archive is, and what must be credited for it — #2013.
 *
 * The archive is the project's own extract of **Mapterhorn** terrain tiles:
 * the contiguous United States, zoom 0 to 12, 19.25 GB, on the same storage
 * and host as the basemap (`map/basemap.ts` §`PUBLISHED_BASEMAP_URL`).
 * `tools/terrain/README.md` records how it is extracted, uploaded and checked.
 * A drawn route's heights are read from it in the app, at zoom 12, with no
 * instance and no routing engine (`terrain/route-heights.ts`).
 *
 * ## The URL is configuration, with a default
 *
 * As the basemap's is, and for its reasons: `release.yml` builds the APK with
 * no environment of its own, and a self-hoster points a build at their own
 * archive. Unset or blank is {@link PUBLISHED_TERRAIN_URL}; `none`, or anything
 * else that is not an `https:` URL, is a build that reads no heights, and a
 * drawn route then saves flat, as it did before #2013.
 *
 * ⚠️ **The published object must never be deleted or renamed while a shipped
 * build names it** — the basemap's rule, for the basemap's reason. A newer
 * extract is published beside it under a new dated name and the constant moves.
 *
 * ⚠️ **A build with no basemap reads no heights either.** The map-tiles switch
 * governs this read (ADR 0054 D-6.4, ADR 0087 D-10 Q4), and Settings shows
 * that switch only where there is a basemap; with none it says the build
 * *"never asks a tile server for anything"*. So `none` for the basemap is
 * `none` for the terrain, whatever this variable says.
 *
 * ⚠️ **It is the same host as the basemap, which is already disclosed**
 * (`docs/privacy-policy.md`, `apps/mobile/src/android/data-safety.ts`), and
 * `privacy/no-network.test.ts` §"the default terrain archive is on the
 * disclosed host" fails if this default ever names another one.
 */

import { readBasemapConfig, type BasemapEnvironment } from '../map/basemap';

/** The environment name this module reads. Documentation, as `BASEMAP_URL_VARIABLE` is: `ENV001` greps for the literal read below. */
export const TERRAIN_URL_VARIABLE = 'VITE_TERRAIN_PMTILES_URL';

/**
 * The archive a build reads heights from when nothing else is configured.
 *
 * Named for upstream's own date: Mapterhorn 0.0.13's `planet.pmtiles`, last
 * modified 2026-09-11, cut to the box −125°..−66° by 24°..50° at every zoom it
 * has (0 to 12).
 */
export const PUBLISHED_TERRAIN_URL =
  'https://tiles.openzigs.com/terrain-us-mapterhorn-20260911.pmtiles';

/** Where the terrain archive is. */
export interface TerrainConfig {
  /** The PMTiles archive, as an ordinary `https:` URL. */
  readonly archiveUrl: string;
}

/** What {@link readTerrainConfig} reads. A parameter, so a test needs no bundler. */
export interface TerrainEnvironment extends BasemapEnvironment {
  readonly VITE_TERRAIN_PMTILES_URL?: string | undefined;
}

/**
 * The configured terrain archive, or `undefined` when there is none.
 *
 * `readBasemapConfig`'s rules: unset or blank is the published archive; a
 * value that is set and is not an `https:` URL is no archive at all, never the
 * default, because somebody who set it meant a particular host. And no
 * archive at all for a build with no basemap (this file's header).
 */
export function readTerrainConfig(environment: TerrainEnvironment): TerrainConfig | undefined {
  if (readBasemapConfig(environment) === undefined) return undefined;
  const configured = environment.VITE_TERRAIN_PMTILES_URL?.trim() ?? '';
  const raw = configured === '' ? PUBLISHED_TERRAIN_URL : configured;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'https:') return undefined;
  return { archiveUrl: parsed.toString() };
}

/** Read the real bundler environment. The one caller that does. */
export function browserTerrainConfig(): TerrainConfig | undefined {
  // Spelled out, as `browserBasemapConfig` spells its own: `ENV001` greps for
  // this exact form.
  return readTerrainConfig({
    VITE_BASEMAP_PMTILES_URL: import.meta.env.VITE_BASEMAP_PMTILES_URL as string | undefined,
    VITE_TERRAIN_PMTILES_URL: import.meta.env.VITE_TERRAIN_PMTILES_URL as string | undefined,
  });
}

/** The archive's own attribution string, word for word (its PMTiles metadata, read 2026-11-23). */
export const MAPTERHORN_ATTRIBUTION = '© Mapterhorn';

/** Where Mapterhorn lists every source its tiles are built from. */
export const MAPTERHORN_ATTRIBUTION_URL = 'https://mapterhorn.com/attribution';

/**
 * The notice Copernicus asks for where its GLO-30 model has been adapted,
 * word for word from ADR 0010 D-5's quotation of the Copernicus Data Space
 * Ecosystem (read 2026-09-03). The archive's tiles are resampled from it
 * wherever nothing finer exists.
 */
export const COPERNICUS_DEM_NOTICE =
  'produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved';

/** The attribution statement the Open Government Licence – Canada asks for, word for word. */
export const CANADA_OGL_NOTICE =
  'Contains information licensed under the Open Government Licence – Canada.';

/** The Open Government Licence – Canada. */
export const CANADA_OGL_URL = 'https://open.canada.ca/en/open-government-licence-canada';
