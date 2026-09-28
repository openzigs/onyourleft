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
 * With no `?archive=` the default is still `/basemap.pmtiles`, which 404s on
 * the harness server — and the spec asserts that 404 rather than tolerating it.
 * ⚠️ That assertion is about the **local harness** and is not a tripwire for
 * #53: publishing an archive to a bucket changes nothing about a path this
 * server does not serve. An earlier note of mine said it would go red the day
 * #53 landed; #53 landed, it did not, and the correction is #63's own.
 *
 * ⚠️ **A hosted archive is no longer unproven either, and this paragraph used
 * to say it was** — a reviewer who remembers *"what is still unproven is
 * anything about a hosted archive: latency, compression, CDN behaviour"* is
 * reading the old file. `hosted-archive.ts` and the last block of
 * `map.browser.spec.ts` point this same page at the archive #53 published, over
 * the real internet, and take #63's eighth measurement there. That block is
 * **opt-in** — `OYL_HOSTED_BASEMAP_URL`, unset in CI — and `hosted-archive.ts`
 * says why, and what is done about the skip. `pmtiles-fixture.ts` still sets out
 * what the loopback half does and does not prove, which is unchanged.
 */

import { documentTheme } from '../src/design/theme-selection';
import type { Theme } from '../src/design/tokens';
import {
  basemapStyle,
  BASEMAP_SOURCE_ID,
  MAP_COLOURS,
  OSM_ATTRIBUTION,
  type BasemapConfig,
  type BasemapStyle,
} from '../src/map/basemap';
import { mapLibrePort } from '../src/map/maplibre';
import type { MapViewOptions } from '../src/map/port';
import { createThemedMap } from '../src/map/themed-map';
import { trackBounds, trackFeature, type TrackGeometry } from '../src/map/track';
import { parseTrackParameter } from './hosted-archive';

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
  /**
   * Bytes over the wire — and ⚠️ **`0` means two different things.**
   *
   * On a same-origin archive it means what it used to say here on its own: the
   * browser served the range from its cache. On a **cross-origin** one it means
   * the browser refused to tell us, because `PerformanceResourceTiming` zeroes
   * the byte counts and every intermediate phase unless the server sends
   * `Timing-Allow-Origin` — which the archive #53 published does not. The two
   * are indistinguishable from this number alone, and a reader comparing a
   * hosted run with the loopback one would conclude the CDN served everything
   * from cache. {@link timingOpaque} is which.
   */
  readonly transferredBytes: number;
  /**
   * The browser would not report this request's phases.
   *
   * `responseStart` is zeroed for a cross-origin resource with no
   * `Timing-Allow-Origin`, and it is the discriminator above: with it set,
   * {@link durationMs} is still real end to end but every figure inside it is
   * a floor of zero, and {@link transferredBytes} says nothing at all.
   */
  readonly timingOpaque: boolean;
}

/**
 * What the page observed about the basemap reaching the screen.
 *
 * Published **after** {@link HarnessResult}, and separately, because none of it
 * is true when `create` returns: a tile has to be fetched, decoded and drawn
 * first. The spec waits on this object rather than on a duration.
 */
export interface MapLoadResult {
  /** The palette of the style on the map when this was published (#672). */
  readonly theme: Theme;
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
  /**
   * The ride's own line was on the drawing buffer, read at the frame's centre.
   *
   * The harness's track is one straight segment and `fitBounds` centres its
   * bounding box, so the middle of the frame is the middle of the line. What
   * the tiles-off case needs: "no tile" and "no map at all" both paint no tile
   * colour, and only the line tells them apart.
   *
   * ⚠️ **Only meaningful on a page that publishes at its deadline.** A page
   * whose tiles paint publishes on the first frame they do, which can be
   * before the line's GeoJSON has been parsed — so the tiles-on case does not
   * assert it, and the tiles-off case, which can never paint a tile, waits the
   * whole deadline. It found a real defect on its first run: `maplibre.ts`
   * §`setTrack` dropped a line handed over before the style had loaded.
   */
  readonly trackPainted: boolean;
  /** The distinct colours in that centre box on the last frame read, for a failure message. */
  readonly centreColours: readonly string[];
}

/** One request for a glyph range, as Resource Timing recorded it (#578). */
export interface GlyphRequest {
  /** The absolute URL the engine resolved the style's `glyphs` template to. */
  readonly url: string;
  /** The HTTP status, `0` where the browser withheld it. */
  readonly status: number;
}

/**
 * What the page observed about the map's labels (#578).
 *
 * Published separately from {@link MapLoadResult} and later, because a label
 * needs a tile *and* a glyph range, fetched and parsed after the tile is.
 */
export interface LabelLoadResult {
  /** At least {@link LABEL_INK_PIXELS} pixels of the labels' ink reached the drawing buffer. */
  readonly painted: boolean;
  /** How many pixels of it were found on the last frame read. */
  readonly inkPixels: number;
  /** Frames the whole buffer was read on. */
  readonly frames: number;
  /** The ink looked for, `#rrggbb`, out of the real style. */
  readonly ink: string;
  /** Every glyph-range request the page made, in order. */
  readonly glyphRequests: readonly GlyphRequest[];
  /** What the style's `glyphs` was when it was handed to the engine. */
  readonly glyphs: string | undefined;
}

/**
 * What the drawing buffer shows NOW, and what the map's current style paints
 * with (#672). A function rather than a published object, because the case
 * that reads it flips the page's palette after {@link MapLoadResult} has been
 * published and polls until the map follows.
 */
export interface MapProbe {
  /** `data-theme` on the root element: the page's palette. */
  readonly pageTheme: Theme;
  /** The palette of the style the map was last handed. */
  readonly styleTheme: Theme;
  readonly backgroundColour: string | undefined;
  readonly basemapColours: readonly string[];
  readonly trackColour: string;
  /** The probe points, `#rrggbb`. Empty when there was no canvas to read. */
  readonly samples: readonly string[];
  /** The distinct colours in the box at the frame's centre, where the line is. */
  readonly centreColours: readonly string[];
  /** `addProtocol` calls so far, read from the shipping registry. */
  readonly registrations: number;
}

declare global {
  interface Window {
    __oylMapProbe?: () => MapProbe;
    __oylHarness?: HarnessResult;
    __oylMapLoad?: MapLoadResult;
    __oylLabels?: LabelLoadResult;
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
  background: string | undefined;
  basemapNames: readonly string[];
} {
  const basemapNames: string[] = [];
  let background: string | undefined;
  for (const layer of style.layers) {
    const paint = layer.paint ?? {};
    if (layer.source === BASEMAP_SOURCE_ID) {
      for (const key of ['fill-color', 'line-color']) {
        if (parseHex(paint[key]) !== undefined) {
          basemapNames.push(String(paint[key]));
        }
      }
    } else if (typeof paint['background-color'] === 'string') {
      background = paint['background-color'];
    }
  }
  return { background, basemapNames };
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
        // Zero only ever happens for a resource whose timing the browser is
        // withholding: a same-origin response always reports a real
        // `responseStart`. @see ArchiveRequestTiming.timingOpaque
        timingOpaque: resource.responseStart === 0,
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

/** The style the map was last handed, and the palette it was built for (#672). */
interface CurrentStyle {
  readonly theme: Theme;
  readonly options: MapViewOptions;
}

/** What one read of the drawing buffer found. */
interface BufferRead {
  readonly samples: string[];
  readonly centreColours: string[];
  readonly canvasSize: string;
}

/**
 * Read the probe points and the box at the frame's centre off the drawing
 * buffer, or `undefined` when there is no canvas with a context to read.
 */
function readBuffer(container: HTMLDivElement): BufferRead | undefined {
  const canvas = container.querySelector('canvas');
  const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl') ?? null;
  if (canvas === null || gl === null || canvas.width === 0 || canvas.height === 0) {
    return undefined;
  }
  // MapLibre binds its own framebuffers during a render and does not
  // guarantee what is bound when one ends. Reading the default one is the
  // only thing that answers "what would the rider see"; MapLibre re-binds
  // whatever it needs at the start of its next frame, so leaving this bound
  // costs nothing.
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const samples: string[] = [];
  // `readPixels` has its origin at the bottom left, where CSS has it at the
  // top left. Nothing here depends on which row is which — two rows exist so
  // that one of them landing on the ride trace cannot be the whole evidence.
  for (const row of PROBE_ROWS) {
    const y = Math.min(canvas.height - 1, Math.max(0, Math.round(canvas.height * row)));
    const strip = new Uint8Array(canvas.width * 4);
    gl.readPixels(0, y, canvas.width, 1, gl.RGBA, gl.UNSIGNED_BYTE, strip);
    for (const column of PROBE_COLUMNS) {
      const x = Math.min(canvas.width - 1, Math.max(0, Math.round(canvas.width * column)));
      samples.push(hex([strip[x * 4] ?? 0, strip[x * 4 + 1] ?? 0, strip[x * 4 + 2] ?? 0]));
    }
  }
  // The line, in a small box at the centre — see `MapLoadResult.trackPainted`.
  const box = 9;
  const left = Math.max(0, Math.round(canvas.width / 2) - (box >> 1));
  const bottom = Math.max(0, Math.round(canvas.height / 2) - (box >> 1));
  const centre = new Uint8Array(box * box * 4);
  gl.readPixels(left, bottom, box, box, gl.RGBA, gl.UNSIGNED_BYTE, centre);
  const seen = new Set<string>();
  for (let offset = 0; offset < centre.length; offset += 4) {
    seen.add(hex([centre[offset] ?? 0, centre[offset + 1] ?? 0, centre[offset + 2] ?? 0]));
  }
  return {
    samples,
    centreColours: [...seen],
    canvasSize: `${String(canvas.width)}x${String(canvas.height)}`,
  };
}

/** Whether any of `colours` is within {@link COLOUR_TOLERANCE} of `target`. */
function anyMatches(colours: readonly string[], target: string): boolean {
  const wanted = parseHex(target);
  return (
    wanted !== undefined &&
    colours.some((colour) => {
      const channels = parseHex(colour);
      return channels !== undefined && matches(channels, wanted);
    })
  );
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
function watchForPaint(
  container: HTMLDivElement,
  current: () => CurrentStyle,
  archive: string,
): void {
  const deadline = paintDeadlineMs();
  const createdAt = performance.now();
  let frames = 0;
  let samples: string[] = [];
  let canvasSize = '0x0';
  let trackPainted = false;
  let centreColours: string[] = [];
  let done = false;

  const publish = (painted: boolean, at: number | undefined): void => {
    if (done) {
      return;
    }
    done = true;
    const { theme, options } = current();
    const palette = paletteOf(options.style);
    window.__oylMapLoad = {
      theme,
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
      trackPainted,
      centreColours,
    };
  };

  /** Read the probe points. Returns whether a tile colour was among them. */
  const probe = (): boolean => {
    const read = readBuffer(container);
    if (read === undefined) {
      return false;
    }
    frames += 1;
    canvasSize = read.canvasSize;
    samples = read.samples;
    centreColours = read.centreColours;
    const { options } = current();
    if (anyMatches(read.centreColours, options.trackColour)) {
      trackPainted = true;
    }
    return paletteOf(options.style).basemapNames.some((colour) => anyMatches(read.samples, colour));
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

/**
 * How many pixels of ink count as "a label painted".
 *
 * A label at 12 px or more puts well over a hundred pixels of solid ink on the
 * buffer; a stray antialiased pixel of some other colour that happens to land
 * inside the tolerance is one or two. The threshold sits between the two by an
 * order of magnitude each way, and the spec's controls are what say it does.
 */
const LABEL_INK_PIXELS = 40;

/**
 * How far a pixel may sit from the ink and still count as ink.
 *
 * Wider than {@link COLOUR_TOLERANCE}, because text is where a rasteriser
 * blends: a glyph's stem at 12 px is barely two pixels wide and its core is
 * the only part that reaches the declared colour. Still far from every other
 * colour the style paints — the nearest, the ride's line, is over a hundred
 * away on the red channel.
 */
const INK_TOLERANCE = 24;

/** Glyph-range requests, from the browser's own Resource Timing buffer. */
function glyphRequests(): GlyphRequest[] {
  return performance
    .getEntriesByType('resource')
    .filter((entry) => /\/\d+-\d+\.pbf$/.test(new URL(entry.name).pathname))
    .map((entry) => ({
      url: entry.name,
      status: (entry as PerformanceResourceTiming).responseStatus,
    }));
}

/**
 * Watch the whole drawing buffer for the labels' ink (#578).
 *
 * A whole-buffer read per frame is expensive, and it is only ever done until
 * the ink is found or the deadline passes — the same deadline
 * {@link watchForPaint} uses, so a control that can never paint a label waits
 * exactly as long as one that can never paint a tile.
 */
function watchForLabels(container: HTMLDivElement, current: () => CurrentStyle): void {
  const deadline = paintDeadlineMs();
  const inkOf = (): string => MAP_COLOURS[current().theme].labelInk;
  let frames = 0;
  let inkPixels = 0;
  let done = false;

  const publish = (): void => {
    if (done) {
      return;
    }
    done = true;
    window.__oylLabels = {
      painted: inkPixels >= LABEL_INK_PIXELS,
      inkPixels,
      frames,
      ink: inkOf(),
      glyphRequests: glyphRequests(),
      glyphs: current().options.style.glyphs,
    };
  };

  const probe = (): void => {
    const canvas = container.querySelector('canvas');
    const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl') ?? null;
    const ink = parseHex(inkOf());
    if (canvas === null || gl === null || canvas.width === 0 || ink === undefined) {
      return;
    }
    frames += 1;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let count = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (
        Math.abs((pixels[offset] ?? 0) - ink[0]) <= INK_TOLERANCE &&
        Math.abs((pixels[offset + 1] ?? 0) - ink[1]) <= INK_TOLERANCE &&
        Math.abs((pixels[offset + 2] ?? 0) - ink[2]) <= INK_TOLERANCE
      ) {
        count += 1;
      }
    }
    inkPixels = count;
  };

  const tick = (): void => {
    if (done) {
      return;
    }
    probe();
    if (inkPixels >= LABEL_INK_PIXELS) {
      publish();
      return;
    }
    window.requestAnimationFrame(tick);
  };
  window.requestAnimationFrame(tick);
  window.setTimeout(() => {
    probe();
    publish();
  }, deadline);
}

/**
 * The style's `glyphs`, as `?glyphs=` may replace it (#578).
 *
 * `off` removes it, and anything else replaces it — the two controls the spec
 * needs to say the positive case's glyphs came from the app's own files:
 * with none, MapLibre asks for no range at all; with a path that is not there,
 * it asks, is refused, and warns. The product never takes this path.
 */
function withGlyphsParameter(style: BasemapStyle): BasemapStyle {
  const configured = new URL(window.location.href).searchParams.get('glyphs');
  if (configured === null) {
    return style;
  }
  const rest: { -readonly [K in keyof BasemapStyle]: BasemapStyle[K] } = { ...style };
  delete rest.glyphs;
  return configured === 'off' ? rest : { ...rest, glyphs: configured };
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
 * The ride to lay over the basemap, which `?track=` may replace.
 *
 * ⚠️ **It exists because a basemap covers somewhere in particular.** {@link
 * TRACK} is in London, and the archive #53 published is a continental-US
 * extract — pointed at that archive, this page would ask for tiles it does not
 * hold, paint nothing, and report "no basemap reached the screen" about an
 * archive that is working perfectly. The hosted spec derives a track from the
 * archive's own declared bounds and passes it here, so neither this file nor
 * that one names a place.
 *
 * A malformed parameter **throws**, by {@link parseTrackParameter}'s own
 * decision, and this function does not catch it: falling back to London would
 * turn a typo in a query string into a failed measurement whose cause is
 * invisible.
 */
function trackFor(): TrackGeometry {
  const configured = new URL(window.location.href).searchParams.get('track');
  return configured === null ? TRACK : parseTrackParameter(configured);
}

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

/**
 * Whether to draw map tiles — `?tiles=off` is the rider's Settings switch
 * turned off (`map/tiles-preference.ts`, the owner's decision of 2026-09-25),
 * handed to the **real** `basemapStyle` the way `MapPanel.tsx` hands it.
 */
function tilesDrawn(): boolean {
  return new URL(window.location.href).searchParams.get('tiles') !== 'off';
}

/**
 * The palette to build the style in regardless of the page's — `?style=light`
 * or `?style=dark` — or `undefined` to follow the page the way `MapPanel.tsx`
 * does (#672). It exists for the control: a LIGHT style under a dark page must
 * fail the read the dark style passes, or that read proves nothing.
 */
function forcedStyleTheme(): Theme | undefined {
  const configured = new URL(window.location.href).searchParams.get('style');
  return configured === 'light' || configured === 'dark' ? configured : undefined;
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
  const tiles = tilesDrawn();
  const forced = forcedStyleTheme();
  let latest: CurrentStyle | undefined;
  // What `MapPanel.tsx` hands `createThemedMap`, plus the harness's own
  // `?glyphs=` and `?style=` switches. Every style the map is handed passes
  // through `optionsFor`, so `latest` is always what is on the map; `styleFor`
  // builds one and records nothing, so a read can never change what `latest` says.
  const styleFor = (pageTheme: Theme): CurrentStyle => {
    const theme = forced ?? pageTheme;
    return {
      theme,
      options: {
        style: withGlyphsParameter(basemapStyle(config, { tiles, theme })),
        trackColour: MAP_COLOURS[theme].track,
      },
    };
  };
  const optionsFor = (pageTheme: Theme): MapViewOptions => {
    latest = styleFor(pageTheme);
    return latest.options;
  };
  const current = (): CurrentStyle => latest ?? styleFor(documentTheme(document));
  optionsFor(documentTheme(document));
  const errors: string[] = [];
  let created = false;

  // Both before the map exists, and that ordering is load-bearing for the
  // first of them: MapLibre asks for its context inside the constructor, and a
  // context's attributes cannot be changed afterwards.
  preserveTheDrawingBuffer();
  watchForPaint(container, current, archive);
  watchForLabels(container, current);
  window.__oylMapProbe = (): MapProbe => {
    const { theme, options } = current();
    const palette = paletteOf(options.style);
    const read = readBuffer(container);
    return {
      pageTheme: documentTheme(document),
      styleTheme: theme,
      backgroundColour: palette.background,
      basemapColours: palette.basemapNames,
      trackColour: options.trackColour,
      samples: read?.samples ?? [],
      centreColours: read?.centreColours ?? [],
      registrations: mapLibrePort.protocol.registrations,
    };
  };

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
    // Through the same function `MapPanel.tsx` uses, so the palette the map
    // is drawn in, and the watch that repaints it, are the product's (#672).
    const view = createThemedMap(mapLibrePort.renderer, container, document, optionsFor);
    created = true;
    const track = trackFor();
    view.setTrack(trackFeature(track), trackBounds(track));
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
