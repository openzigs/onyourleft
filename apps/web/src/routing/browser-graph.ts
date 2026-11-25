// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where the in-browser routing graph is (#2734, ADR 0097).
 *
 * The graph is one release directory that `apps/web/tools/valhalla` builds
 * and uploads, on the same host as the basemap (`map/basemap.ts`
 * §`PUBLISHED_BASEMAP_URL`). The SDK reads `manifest.json` and then fetches
 * the tiles a route needs, one file each (`valhalla-browser-provider.ts`).
 *
 * ## The URL is configuration, with a default, by the terrain archive's rules
 *
 * `terrain/config.ts` says why, and the same reasons hold here: `release.yml`
 * builds the APK with no environment of its own, and a self-hoster points a
 * build at their own graph. Unset or blank is {@link PUBLISHED_ROUTING_GRAPH_URL}
 * **only for a build whose basemap is the published one**; `none`, or anything
 * else that is not an `https:` URL, is a build with no in-browser routing, and
 * a leg is then drawn straight unless the rider's instance routes it. A build
 * with no basemap has no in-browser routing either: the map-tiles switch
 * governs everything the tile host is asked (ADR 0054 D-6.4).
 *
 * ⚠️ **The release is immutable and the constant names one.** A release
 * directory is never overwritten (`tools/valhalla/README.md` §1); a newer
 * graph is a new directory, and this constant moves. The directory it names
 * must never be deleted while a shipped build names it.
 *
 * ⚠️ **It is the same host as the basemap, which is already disclosed**, and
 * `privacy/no-network.test.ts` §"the default routing graph is on the
 * disclosed host" fails if this default ever names another one.
 */

import { PUBLISHED_BASEMAP_URL, readBasemapConfig, type BasemapEnvironment } from '../map/basemap';

/** The environment name this module reads. `ENV001` greps for the literal read below. */
export const ROUTING_GRAPH_URL_VARIABLE = 'VITE_ROUTING_GRAPH_MANIFEST_URL';

/**
 * The graph a build routes on when nothing else is configured: one state's
 * bicycle graph, Valhalla 3.8.3, built on 2026-11-24 for #2347 and measured
 * there (spike 0042). The state is not named in public text; the manifest's
 * `coverage` box is the only thing that says where it is.
 */
export const PUBLISHED_ROUTING_GRAPH_URL =
  'https://tiles.openzigs.com/routing/oyl-bicycle-8ccb914d362b/manifest.json';

/** Where the in-browser routing graph is. */
export interface RoutingGraphConfig {
  /** The release's `manifest.json`, as an ordinary `https:` URL. */
  readonly manifestUrl: string;
}

/** What {@link readRoutingGraphConfig} reads. A parameter, so a test needs no bundler. */
export interface RoutingGraphEnvironment extends BasemapEnvironment {
  readonly VITE_ROUTING_GRAPH_MANIFEST_URL?: string | undefined;
}

/**
 * The configured graph, or `undefined` when this build routes nothing in the
 * browser. `readTerrainConfig`'s rules, for its reasons (this file's header).
 */
export function readRoutingGraphConfig(
  environment: RoutingGraphEnvironment,
): RoutingGraphConfig | undefined {
  const basemap = readBasemapConfig(environment);
  if (basemap === undefined) return undefined;
  const configured = environment.VITE_ROUTING_GRAPH_MANIFEST_URL?.trim() ?? '';
  if (configured === '' && basemap.archiveUrl !== new URL(PUBLISHED_BASEMAP_URL).toString()) {
    // A self-hosted basemap and no graph URL: this project's host is not asked.
    return undefined;
  }
  const raw = configured === '' ? PUBLISHED_ROUTING_GRAPH_URL : configured;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'https:') return undefined;
  return { manifestUrl: parsed.toString() };
}

/** Read the real bundler environment. The one caller that does. */
export function browserRoutingGraphConfig(): RoutingGraphConfig | undefined {
  // Spelled out, as `browserTerrainConfig` spells its own: `ENV001` greps for this exact form.
  return readRoutingGraphConfig({
    VITE_BASEMAP_PMTILES_URL: import.meta.env.VITE_BASEMAP_PMTILES_URL as string | undefined,
    VITE_ROUTING_GRAPH_MANIFEST_URL: import.meta.env.VITE_ROUTING_GRAPH_MANIFEST_URL as
      string | undefined,
  });
}
