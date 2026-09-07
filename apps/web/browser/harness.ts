// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The page the browser gate drives.
 *
 * It imports the **real** adapter — `map/maplibre.ts`, the one file that names
 * MapLibre GL JS — and builds a map from the **real** style builder. Nothing
 * here is a stand-in: that is the whole point, because everything this page
 * exercises is precisely what `map/port.ts` records the jsdom suite cannot
 * reach. jsdom implements no WebGL, so `new Map(...)` cannot be constructed
 * there at all, and three things therefore go unchecked:
 *
 * 1. **That MapLibre initialises at all** against the style we hand it — that
 *    the style is well-formed enough for the library to accept, rather than
 *    merely well-formed enough for our own types.
 * 2. **That `addProtocol` takes effect in a real engine.** The jsdom suite
 *    proves our registry calls it once; only a browser proves the handler is
 *    then actually consulted when a `pmtiles://` URL is resolved.
 * 3. **Which hosts the engine really contacts.** This is #63's third criterion
 *    in its literal form — *"a test intercepts all network traffic during a map
 *    render"* — and it catches what `styleOrigins` cannot, because a request a
 *    dependency issues on its own initiative is in no style at all. It does
 *    **not** replace that static check: a URL declared in the style but never
 *    fetched is invisible here. `map.browser.spec.ts` records which mutation
 *    proved that.
 *
 * ## Why this constructs its own `BasemapConfig`
 *
 * `readBasemapConfig` refuses a non-`https:` URL, and the harness server is
 * plain HTTP on the loopback interface. That refusal is a **configuration**
 * rule — it exists so a mixed-content archive fails loudly at start-up rather
 * than as an empty map — and it is exercised thoroughly in `basemap.test.ts`.
 * What this page tests is the **adapter**, so it hands the adapter a config
 * directly rather than routing round a guard that has nothing to do with the
 * question. Said out loud because a reader who spots the missing call should
 * know it was a decision.
 *
 * ## What this page deliberately does not prove
 *
 * That tiles render. There is no published archive (#53), so the request for
 * one returns 404 and the map reports a source error. That is expected, it is
 * asserted, and it is the honest limit of what can be checked before #53 lands
 * — see `map.browser.spec.ts`.
 */

import { basemapStyle, OSM_ATTRIBUTION, type BasemapConfig } from '../src/map/basemap';
import { mapLibrePort } from '../src/map/maplibre';
import { trackBounds, trackFeature, type TrackGeometry } from '../src/map/track';

/** What the spec reads back off the page. Serialisable, so it survives `evaluate`. */
export interface HarnessResult {
  /** The map object was constructed without throwing. */
  readonly created: boolean;
  /** A `<canvas>` exists inside the container. */
  readonly canvas: boolean;
  /**
   * That canvas has a live WebGL context.
   *
   * The assertion that separates "MapLibre ran" from "MapLibre ran in a browser
   * that could actually give it a GPU". A headless Chromium without a working
   * SwiftShader fallback fails here rather than passing vacuously.
   */
  readonly webgl: boolean;
  /** `addProtocol` calls, read from the shipping registry rather than a counter of our own. */
  readonly registrations: number;
  /**
   * What constructing the map threw, if anything.
   *
   * Only a *construction* failure. The 404 for the archive surfaces as a map
   * `error` event, and it is asserted from the **network** side in the spec
   * instead — widening `MapView` to expose the map object so a test could
   * listen would be the test dictating the shape of shipping code.
   */
  readonly errors: readonly string[];
}

declare global {
  interface Window {
    __oylHarness?: HarnessResult;
  }
}

/** A short two-point line, so the map has geometry to fit itself to. */
const TRACK: TrackGeometry = {
  type: 'MultiLineString',
  coordinates: [
    [
      [-0.1278, 51.5074],
      [-0.1268, 51.5084],
    ],
  ],
};

/**
 * Whether to register the `pmtiles://` handler.
 *
 * `?protocol=off` skips it. That exists so the spec can prove the handler is
 * what produces the archive request, rather than inferring it: with the
 * protocol off, a `pmtiles://` URL is a scheme MapLibre does not know and no
 * request is made at all. Without this switch the "routes through the handler"
 * assertion is satisfied by a **plain** URL fetched as TileJSON, which is a
 * different code path reaching the same host — and a mutation dropping the
 * `pmtiles://` prefix passed the whole gate green.
 */
function registerProtocol(): boolean {
  return new URL(window.location.href).searchParams.get('protocol') !== 'off';
}

function archiveUrl(): string {
  const configured = new URL(window.location.href).searchParams.get('archive');
  // Same origin as the page by default, so the "zero third-party requests"
  // assertion has something to be true *about* rather than being true because
  // nothing was ever requested.
  return configured ?? new URL('/basemap.pmtiles', window.location.origin).toString();
}

function run(): void {
  const container = document.querySelector<HTMLDivElement>('#map');
  if (container === null) {
    throw new Error('the harness page is missing its #map container');
  }

  const config: BasemapConfig = { archiveUrl: archiveUrl(), attribution: OSM_ATTRIBUTION };
  const errors: string[] = [];
  let created = false;

  try {
    // Registered before the map is created, exactly as `MapPanel.tsx` does it.
    // ⚠️ Not optional and not a formality: `renderer.create` does **not**
    // self-register, so without this MapLibre meets a `pmtiles://` URL it has
    // no handler for, never requests the archive, and every network assertion
    // in the spec waits out its timeout. The first version of this harness
    // omitted it and that is exactly what happened — which is also why the
    // spec now drives the off case deliberately. See {@link registerProtocol}.
    if (registerProtocol()) {
      mapLibrePort.protocol.ensure();
    }
    const view = mapLibrePort.renderer.create(container, { style: basemapStyle(config) });
    created = true;
    view.setTrack(trackFeature(TRACK), trackBounds(TRACK));
  } catch (error: unknown) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  // Published immediately, with no timer. MapLibre creates its canvas and
  // acquires its GL context synchronously inside the constructor, so
  // everything below is already true by the time `create` returns — and a
  // fixed `setTimeout` would be a sleep that is too short on a loaded runner
  // and wasted everywhere else. What *is* asynchronous — the archive request
  // and its failure — the spec observes from the network, where it can wait on
  // the event itself rather than on a guess about how long it takes.
  const canvas = container.querySelector('canvas');
  // Re-requesting the same context type returns the context MapLibre already
  // holds, so this reads its state rather than competing for a second one.
  const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl') ?? null;
  window.__oylHarness = {
    created,
    canvas: canvas !== null,
    webgl: gl !== null,
    registrations: mapLibrePort.protocol.registrations,
    errors,
  };
}

run();
