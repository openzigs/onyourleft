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
 * ## What this page proves about tiles, and what it still does not
 *
 * ⚠️ This heading used to read *"what this page deliberately does not prove:
 * that tiles render"*, and that is no longer the whole story — a reviewer who
 * remembers it is reading the old file. With `?archive=` pointed at the
 * fixture archive `vite.browser.config.ts` emits, tiles **do** render here, and
 * {@link watchForPaint} reads them off the drawing buffer and times the first
 * one. Finding a defect is what motivated it: MapLibre could not load its
 * tile-parsing worker under a bundler at all, and no gate in this repository
 * could see that until something asked it to parse a tile.
 *
 * With no `?archive=` the default is still `/basemap.pmtiles`, which 404s
 * because #53 has published nothing — and the spec asserts that 404 rather than
 * tolerating it, so the day an archive exists the gate says so.
 *
 * What is still unproven is anything about a **hosted** archive: latency,
 * compression, CDN behaviour, a tile that is not 98 bytes of synthetic
 * geometry. `pmtiles-fixture.ts` sets out that limit in full.
 */

import {
  basemapStyle,
  BASEMAP_SOURCE_ID,
  OSM_ATTRIBUTION,
  type BasemapConfig,
  type BasemapStyle,
} from '../src/map/basemap';
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

/** One archive range request, as the browser's own clock recorded it. */
export interface ArchiveRequestTiming {
  /** How far into the page's life the request started, in milliseconds. */
  readonly startedMs: number;
  /** How long it took, request to last byte. */
  readonly durationMs: number;
  /** Bytes over the wire, `0` when the browser served it from cache. */
  readonly transferredBytes: number;
}

/**
 * What the page observed about the basemap reaching the screen.
 *
 * Published **after** {@link HarnessResult}, and separately, because none of it
 * is true when `create` returns: a tile has to be fetched, decoded and drawn
 * first. The spec waits on this object rather than on a duration.
 */
export interface MapLoadResult {
  /** A colour that can only have come from a tile reached the drawing buffer. */
  readonly painted: boolean;
  /**
   * From immediately before `renderer.create` to the frame that painted.
   *
   * The **client's** share of a cold load: a range request for the header and
   * root directory, a range request for the tile, the MVT decode, and the first
   * draw. `undefined` when nothing painted.
   */
  readonly firstPaintMs: number | undefined;
  /**
   * The same instant, measured from the start of navigation.
   *
   * Larger than {@link firstPaintMs} by whatever it cost to fetch and evaluate
   * the page and the map engine — which is part of a real cold load and is the
   * half a lazy `import()` of `maplibre.ts` is meant to keep off most visits.
   */
  readonly firstPaintSinceNavigationMs: number | undefined;
  /** Frames the probe ran on, so a run that never rendered is distinguishable. */
  readonly frames: number;
  /** The drawing buffer's size, so "all black" and "no canvas" are told apart. */
  readonly canvasSize: string;
  /** How long the page waited before giving up on a paint. */
  readonly deadlineMs: number;
  /** Colours only a tile can produce, read out of the real style. */
  readonly basemapColours: readonly string[];
  /** The style's background colour, which needs no tile at all. */
  readonly backgroundColour: string | undefined;
  /** What the probe points actually read, `#rrggbb`, most recent frame. */
  readonly samples: readonly string[];
  /** Range requests for the archive, from the Resource Timing buffer. */
  readonly archiveRequests: readonly ArchiveRequestTiming[];
}

declare global {
  interface Window {
    __oylHarness?: HarnessResult;
    __oylMapLoad?: MapLoadResult;
  }
}

/** `#rrggbb` to a triple. Returns `undefined` for anything else in the style. */
function parseHex(colour: unknown): readonly [number, number, number] | undefined {
  if (typeof colour !== 'string') {
    return undefined;
  }
  const match = /^#([0-9a-f]{6})$/i.exec(colour.trim());
  if (match?.[1] === undefined) {
    return undefined;
  }
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/**
 * The colours only a tile can put on screen, read out of the style we ship.
 *
 * Derived rather than written down. A hard-coded `#eeece7` here would be a
 * second copy of `basemapStyle`'s cartography, and the failure mode of a second
 * copy is the worst one available to this gate: change the style's earth colour
 * and the probe looks for a colour nothing paints, `painted` goes false, and
 * the gate reports "no tile reached the screen" about a map that is working
 * perfectly.
 *
 * The **background** layer is excluded on purpose and reported separately: it
 * has no `source`, so it paints before any network request and its presence
 * says nothing about tiles. That distinction is the whole of the control case.
 */
function paletteOf(style: BasemapStyle): {
  basemap: readonly (readonly [number, number, number])[];
  background: string | undefined;
  basemapNames: readonly string[];
} {
  const basemap: (readonly [number, number, number])[] = [];
  const basemapNames: string[] = [];
  let background: string | undefined;
  for (const layer of style.layers) {
    const paint = layer.paint ?? {};
    if (layer.source === BASEMAP_SOURCE_ID) {
      for (const key of ['fill-color', 'line-color']) {
        const parsed = parseHex(paint[key]);
        if (parsed !== undefined) {
          basemap.push(parsed);
          basemapNames.push(String(paint[key]));
        }
      }
    } else if (typeof paint['background-color'] === 'string') {
      background = paint['background-color'];
    }
  }
  return { basemap, background, basemapNames };
}

/** `#rrggbb`, so a sample reads the same way the style writes a colour. */
function hex(channels: readonly [number, number, number]): string {
  return `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * How far a sampled channel may sit from a declared one and still count.
 *
 * Small, because these are opaque flat fills and the canvas is 8-bit sRGB —
 * there is no blending to allow for at the probe points. It is not zero because
 * a rasteriser is entitled to round, and a gate that fails on a rounding
 * difference is a gate that gets deleted.
 */
const COLOUR_TOLERANCE = 4;

function matches(
  sample: readonly [number, number, number],
  target: readonly [number, number, number],
): boolean {
  return sample.every(
    (channel, index) => Math.abs(channel - (target[index] ?? 0)) <= COLOUR_TOLERANCE,
  );
}

/** Where along each strip the probe reads. Clear of the centre, where the track is. */
const PROBE_COLUMNS = [0.05, 0.25, 0.5, 0.75, 0.95] as const;
/** Two rows rather than one, so a strip that lands on the track is not the only evidence. */
const PROBE_ROWS = [0.05, 0.75] as const;

/** How long the page waits for a tile before publishing "nothing painted". */
function paintDeadlineMs(): number {
  const configured = new URL(window.location.href).searchParams.get('paintDeadline');
  const parsed = configured === null ? Number.NaN : Number(configured);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5000;
}

/** Archive range requests, from the browser's own Resource Timing buffer. */
function archiveTimings(archive: string): ArchiveRequestTiming[] {
  const wanted = archive.split('/').pop() ?? archive;
  return performance
    .getEntriesByType('resource')
    .filter((entry) => entry.name.includes(wanted))
    .map((entry) => {
      const resource = entry as PerformanceResourceTiming;
      return {
        startedMs: resource.startTime,
        durationMs: resource.duration,
        transferredBytes: resource.transferSize,
      };
    });
}

/**
 * Force `preserveDrawingBuffer` on, for this page only.
 *
 * ⚠️ **The first version of this harness did not do this, and it did not
 * work** — recorded here because the mechanism that failed is a plausible one
 * that a reader would otherwise try again. Without the flag a WebGL drawing
 * buffer is readable only between the engine drawing it and the compositor
 * taking it, which is a window inside one animation frame. `game-harness.ts`
 * hits that window by owning the render loop; nothing here can, because
 * `MapView` deliberately does not expose the map object. The attempt was to
 * borrow MapLibre's own frame by wrapping `window.requestAnimationFrame`
 * before the map existed, so the probe ran immediately after its callback.
 * Every sample came back `#000000`: MapLibre v6 reaches its renderer through
 * `browser.frameAsync`, which resolves a **promise** from the frame callback,
 * so the draw happens in a microtask *after* anything chained onto that
 * callback synchronously. The probe was reading a buffer that had already been
 * presented and cleared.
 *
 * `maplibre.ts` must not set this: it is a real per-frame cost, paid by every
 * rider so that a test can read a pixel, and a shipping option that exists for
 * a harness is the shape CLAUDE.md calls the test dictating shipping code. So
 * the harness forces it into the context attributes instead, by intercepting
 * the one call MapLibre makes to get a context.
 *
 * ⚠️ **It is in the measured number.** Keeping the buffer costs frame time. It
 * costs it identically on the fixture page and the control page, so the two
 * remain comparable, and it makes the cold-load figure a slight over-estimate
 * rather than an under-estimate — which is the right direction for a number
 * whose job is to be a floor.
 */
function preserveTheDrawingBuffer(): void {
  // Unbound on purpose, and re-bound with `.call` below — the same prototype
  // patch, and the same disable with the same reason, as
  // `game-harness.ts`'s `countingGpuResources`: the original has to be held
  // separately from any instance, because every canvas in the page shares it
  // and the one we care about does not exist yet.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const original = HTMLCanvasElement.prototype.getContext;
  // One cast at the boundary, and only one. `getContext` is overloaded five
  // ways; re-declaring those overloads faithfully here would be far more
  // surface than the one-line behaviour being wrapped, and every one of them
  // would have to be kept in step with the DOM lib.
  const patched = function (this: HTMLCanvasElement, type: string, attributes?: unknown): unknown {
    const call = original as (
      this: HTMLCanvasElement,
      type: string,
      attributes?: unknown,
    ) => unknown;
    if (type === 'webgl' || type === 'webgl2') {
      return call.call(this, type, {
        ...(attributes as Record<string, unknown> | undefined),
        preserveDrawingBuffer: true,
      });
    }
    return call.call(this, type, attributes);
  };
  HTMLCanvasElement.prototype.getContext = patched as typeof HTMLCanvasElement.prototype.getContext;
}

/**
 * Watch the drawing buffer until a tile paints, and time it.
 *
 * With the buffer preserved (see above) the probe no longer has to be inside
 * the engine's frame: it runs on its own animation-frame loop and reads the
 * most recently rendered picture, whenever that was rendered.
 *
 * ⚠️ **Which sets the resolution of the number.** The paint is detected on the
 * first of *this* loop's frames at which tile colour is already present, so the
 * figure is late by up to one frame — about 16 ms at 60 Hz, and more on a
 * loaded runner. That is stated rather than hidden: it is comfortably below the
 * hundreds of milliseconds ADR 0010 D-1 warns a hosted archive can cost, which
 * is what the measurement is for, and it is far too coarse to support any
 * claim finer than that.
 *
 * ## What it costs the number it measures
 *
 * Two `readPixels` of a one-pixel-tall strip per frame — a few kilobytes, and a
 * pipeline flush each. That is real and it is **in** the reported figure. It is
 * also identical on both pages, so the fixture and the control are comparable
 * even though neither is a clean-room frame time.
 */
function watchForPaint(container: HTMLDivElement, style: BasemapStyle, archive: string): void {
  const palette = paletteOf(style);
  const deadline = paintDeadlineMs();
  const createdAt = performance.now();
  let frames = 0;
  let samples: string[] = [];
  let canvasSize = '0x0';
  let done = false;

  const publish = (painted: boolean, at: number | undefined): void => {
    if (done) {
      return;
    }
    done = true;
    window.__oylMapLoad = {
      painted,
      firstPaintMs: at === undefined ? undefined : at - createdAt,
      firstPaintSinceNavigationMs: at,
      frames,
      canvasSize,
      deadlineMs: deadline,
      basemapColours: palette.basemapNames,
      backgroundColour: palette.background,
      samples,
      archiveRequests: archiveTimings(archive),
    };
  };

  /** Read the probe points. Returns whether a tile colour was among them. */
  const probe = (): boolean => {
    const canvas = container.querySelector('canvas');
    const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl') ?? null;
    if (canvas === null || gl === null || canvas.width === 0 || canvas.height === 0) {
      return false;
    }
    frames += 1;
    canvasSize = `${String(canvas.width)}x${String(canvas.height)}`;
    // MapLibre binds its own framebuffers during a render and does not
    // guarantee what is bound when one ends. Reading the default one is the
    // only thing that answers "what would the rider see"; MapLibre re-binds
    // whatever it needs at the start of its next frame, so leaving this bound
    // costs nothing.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const read: string[] = [];
    // `readPixels` has its origin at the bottom left, where CSS has it at the
    // top left. Nothing here depends on which row is which — two rows exist so
    // that one of them landing on the ride trace cannot be the whole evidence.
    for (const row of PROBE_ROWS) {
      const y = Math.min(canvas.height - 1, Math.max(0, Math.round(canvas.height * row)));
      const strip = new Uint8Array(canvas.width * 4);
      gl.readPixels(0, y, canvas.width, 1, gl.RGBA, gl.UNSIGNED_BYTE, strip);
      for (const column of PROBE_COLUMNS) {
        const x = Math.min(canvas.width - 1, Math.max(0, Math.round(canvas.width * column)));
        read.push(hex([strip[x * 4] ?? 0, strip[x * 4 + 1] ?? 0, strip[x * 4 + 2] ?? 0]));
      }
    }
    samples = read;
    return read.some((sample) => {
      const channels = parseHex(sample);
      return channels !== undefined && palette.basemap.some((target) => matches(channels, target));
    });
  };

  const tick = (): void => {
    if (done) {
      return;
    }
    if (probe()) {
      publish(true, performance.now());
      return;
    }
    window.requestAnimationFrame(tick);
  };
  window.requestAnimationFrame(tick);

  window.setTimeout(() => {
    // One last read before giving up, so the control case reports what was
    // actually on screen rather than whatever the loop happened to see last.
    probe();
    publish(false, undefined);
  }, deadline);
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

  const archive = archiveUrl();
  const config: BasemapConfig = { archiveUrl: archive, attribution: OSM_ATTRIBUTION };
  const style = basemapStyle(config);
  const errors: string[] = [];
  let created = false;

  // Both before the map exists, and that ordering is load-bearing for the
  // first of them: MapLibre asks for its context inside the constructor, and a
  // context's attributes cannot be changed afterwards.
  preserveTheDrawingBuffer();
  watchForPaint(container, style, archive);

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
    const view = mapLibrePort.renderer.create(container, { style });
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
