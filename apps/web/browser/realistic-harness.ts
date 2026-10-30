// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The owner's realistic page — [ADR 0026](../../../docs/adr/0026-realistic-game-world.md)
 * D-12: *"the realistic world is reachable only from a harness page under
 * `apps/web/browser/` … and from no control in the shipped app, until layers
 * 1–3 have landed."* This is that page.
 *
 * ## What it is, and what it is not
 *
 * It rides the **product's own renderer** — `three-renderer.ts`, the same
 * `threeGameRenderer` `main.tsx` hands `GameView` — along `src/demo/synthetic-road.ts`
 * at 9 m/s, with the cranks turning at the pacer's gear, and lets the product's
 * own two-ladder policy (`quality.ts` §`nextWorldQuality`) move the rung from
 * the frame times, as `GameView` does with `nextQuality`. So what the owner
 * sees on the tablet is what a rider who chose it in Settings sees (#475): the same
 * code, the same assets, the same step down to the stylised world when the
 * device runs hot — and the same "falls back and says so" when the world
 * cannot load (D-7), shown on the page.
 *
 * It is **not** a gate: nothing asserts on what it measures, because the
 * numbers that matter come from the tablet's GPU. `game.browser.spec.ts`
 * §"the realistic world" is the gate, on its own page. ⚠️ Since #616
 * `realistic.browser.spec.ts` loads THIS page — to hold its instruments to
 * account (the triangle counter against three's own, and the layer switch
 * against a control), never to hold the world to a number. It is **not** the
 * product: the product's build never sees this directory, and the tablet
 * reaches it only through a debug APK staged with
 * `tools/realistic/stage-into-apk.ts` — validation 0002 Part Z has the steps.
 *
 * ## What it publishes
 *
 * `window.__oylRealistic` — the configuration, the load's outcome and the
 * notice, which world is drawn and at which rung, and after `?seconds=` of
 * riding the frame-time percentiles, the draw calls and — since #616 — the
 * triangles submitted per frame; with `?soak=20`, one sample a minute for
 * twenty minutes. Since #616, `?layers=-vegetation` (or any of
 * `realistic/config.ts` §`LAYERS`) turns a layer off without moving the rung,
 * so a layer's share of the tablet's GPU clock is the difference between two
 * runs; `realistic/layers.ts` says what each layer is, in both worlds. Since
 * #619, `?levers=-foliage-order` or `-texture-bias` switches one of that
 * issue's kept levers off, so its saving is a before/after pair at one rung —
 * and since #622 `-air` puts the fog back as it was, for a by-eye pair only;
 * `realistic/config.ts` §`LEVERS` says which rung each one needs.
 * Each is also one console line, `OYL-REALISTIC {json}` and
 * `OYL-REALISTIC-SOAK {json}`, which `adb logcat` shows under the `chromium` tag — so the numbers come off the device with no
 * debugger attached, as #457's did.
 */

import { FramePacer } from '../src/game/frame-pacer';
import {
  DISPLAY_RATE,
  INITIAL_QUALITY,
  nextWorldQuality,
  worldRung,
  type WorldQualityState,
} from '../src/game/quality';
import { realisticWorldNotice, type RealisticWorldOutcome } from '../src/game/realistic-assets';
import { mappedTown } from '../src/game/footprint-buildings';
import {
  // #1637's city centre, whose street and terraced blocks `town=city-street` rides;
  // `town=city` is #1636's, from `testing/urban-fixtures.ts`.
  cityStreetscapeFixture,
  countrysideFixture,
  mixedTownFixture,
  richmondStreetFixture,
  terraceStreetFixture,
} from '../src/game/footprint-fixtures-testing';
import { HOLIDAY_DECORATIONS, VILLAGE_TREE } from '../src/game/decorations';
import { mappedBuildingsOf } from '../src/game/mapped-buildings';
import { cityCentreFixture } from '../src/game/testing/urban-fixtures';
import { villageDrawCallCeiling } from '../src/game/realistic-budget';
import type { SceneFrame } from '../src/game/port';
import { corridorOrigin } from '../src/game/terrain';
import { deviceToday } from '../src/game/season';
import { routeHemisphere, routeLatitudeMagnitude } from '../src/game/world';
import {
  drawnWorldOf,
  atmosphereOf,
  decorationBeltOf,
  decorationKindTriangles,
  decorationKindsOf,
  deliveryDrawnOf,
  facadeWreathOf,
  firDepthPrepassOf,
  foliageOrderedOf,
  groundBlendOf,
  loadRealisticWorld,
  loadSceneryModels,
  mappedBlobsShownOf,
  overhangShadowsOf,
  realisticSurfacesOf,
  realisticTextureReport,
  setRealisticTrees,
  threeGameRenderer,
  villageHouseStatsOf,
  villageModelsShownOf,
  weatheringOf,
  windowRevealsOf,
  type VillageHouseStats,
} from '../src/game/three-renderer';
import {
  configQuery,
  decorationsWithConfig,
  facadeWreathWithLevers,
  parseConfig,
  percentiles,
  rungWithLevers,
  seasonWithLevers,
  firPrepassWithLevers,
  surfacesWithLevers,
  treesWithLevers,
  windowRevealsWithLevers,
  overhangShadowsWithLevers,
  weatheringWithLevers,
  countrysideWithLevers,
  type Layer,
  type Lever,
  type Percentiles,
} from './realistic/config';
import { deliveryAhead } from './realistic/delivery';
import { drawCounter } from './realistic/draws';
import { rideFrame, RIDE_METRES_PER_SECOND } from './realistic/frame';
import { installLayerSwitch, type LayerCensus } from './realistic/layers';
import { describe, guarded, MAXIMUM_FRAME_GAP_MS, MeasurementClock } from './realistic/loop';
import { readoutLine, takeOverReporting } from './realistic/reporting';
import {
  placeLatitude,
  realisticRoute,
  routeDigest,
  villageRoute,
} from '../src/demo/synthetic-road';
import { plannedTown } from './realistic/town';
import { frameCensus, type FrameCensus } from './realistic/village';

/** #1627: one village-square tree's triangles, as the belt counts them. */
const VILLAGE_TREE_KIND = HOLIDAY_DECORATIONS['winter-lights']?.find(
  (kind) => kind.item === VILLAGE_TREE,
);
const VILLAGE_TREE_TRIANGLES =
  VILLAGE_TREE_KIND === undefined ? 0 : decorationKindTriangles(VILLAGE_TREE_KIND);
/** How long the scene runs before anything is sampled: shader compiles, first uploads. */
const WARM_UP_SECONDS = 3;
/** Where a long ride starts, wraps back to, and how much road it rides before it does. */
const START_METRES = 2_550;
const LOOP_FROM_METRES = 300;
const LOOP_METRES = 3_500;
/** #1581's `town=mixed`: from 100 m short of the town to its far end, and round again. */
const TOWN_FROM_METRES = 900;
const TOWN_METRES = 1_200;

/** One window's numbers. */
export interface RealisticSample {
  readonly world: string;
  readonly rung: string;
  /**
   * The rung's frame cap — #476: `'display'` for the display's own rate, which
   * is both realistic rungs and the stylised top; 30, 24 or 20 below that.
   */
  readonly frameCap: 'display' | number;
  /** The time between DRAWN frames — at a capped rung, at least the cap's interval. */
  readonly frameMs: Percentiles;
  /**
   * Draw calls per drawn frame over the window, a MEAN, rounded: the window
   * is the frames drawn after the warm-up, the ones the clock samples.
   *
   * ⚠️ **Until #1294 it also counted the warm-up's frames, the page's very
   * first render among them, and so read higher the fewer frames there were.**
   * Read frame by frame on 2026-10-12 in the pinned Chromium, held at
   * `at=2550`: the first render made 60 calls and every later frame 31, in
   * the warm-up and after it. The first published figure was therefore
   * `(60 + 31·n) / (n + 1)` for `n` later frames, 32 to 35 for one unchanged
   * frame depending on how busy the machine was, which is what #1289 saw
   * move. The counts are now reset when the warm-up ends, so a held frame's
   * mean is its own count and equals {@link lastFrame}'s `calls`. A soak's
   * later windows never held the first render. What the first render's other
   * 29 calls are was not looked for (#1293).
   */
  readonly drawCalls: number;
  /**
   * Triangles submitted per drawn frame over the window, counted at the WebGL
   * draw calls — #616. @see realistic/draws.ts
   */
  readonly trianglesPerFrame: number;
  /**
   * The window's LAST frame, counted two ways: at the draw calls, and by
   * three's own `renderer.info.render.triangles` for the same `render` — the
   * browser gate holds them within 1 % of each other (#616). `undefined` for
   * three's when no frame has been drawn through the switch yet.
   */
  readonly lastFrame: {
    readonly triangles: number;
    readonly rendererTriangles: number | undefined;
    /** Its draw calls, counted at the WebGL draw calls — #1294. @see drawCalls */
    readonly calls: number;
  };
  /** The layers switched off for this run — #616. Empty for an ordinary ride. */
  readonly layersOff: readonly Layer[];
  /** #619's levers switched off for this run. Empty for an ordinary ride. */
  readonly leversOff: readonly Lever[];
  readonly drawingBuffer: readonly [number, number];
  readonly devicePixelRatio: number;
  readonly stalls: number;
  readonly userAgent: string;
}

/**
 * What `realistic.html`'s first, classic script records before this module
 * runs — #478. @see realistic.html
 */
export interface EarlyRecord {
  /** `typeof window.Capacitor` before any script of ours ran: `'object'` when the shell's bridge was injected. */
  readonly capacitorAtStart: string;
  /** `typeof window.androidBridge`: the interface the bridge talks through, which the WebView provides. */
  readonly androidBridgeAtStart: string;
  /** Whether the page stood in for a missing bridge's `triggerEvent`. */
  readonly standIn: boolean;
  /** Every lifecycle event the shell sent to the stand-in. */
  readonly events: readonly { readonly event: string; readonly target: string }[];
  /** Errors caught before this module took over reporting. */
  readonly errors: string[];
  report: ((message: string) => void) | undefined;
}

/** What Part AH's #618 row records of the textures a load chose. @see realisticTextureReport */
interface TextureSummary {
  /** How many textures a material wears, once per image, by the format each was handed to the GPU as. */
  readonly formats: Readonly<Record<string, number>>;
  /** Their GPU bytes, every mip level. */
  readonly bytes: number;
  /** The sky's format, which #618 leaves at half-float. */
  readonly sky: string;
}

/** The loaded world's textures, summarised for the tablet's row. */
function textureSummary(): TextureSummary {
  const formats: Record<string, number> = {};
  let bytes = 0;
  let sky = '';
  for (const texture of realisticTextureReport()) {
    if (texture.role === 'sky') {
      sky = texture.format;
      continue;
    }
    formats[texture.format] = (formats[texture.format] ?? 0) + 1;
    bytes += texture.bytes;
  }
  return { formats, bytes, sky };
}

declare global {
  interface Window {
    __oylRealisticEarly?: EarlyRecord;
    __oylRealistic?: {
      readonly ready: boolean;
      /**
       * #618: milliseconds from the page opening to its first drawn realistic
       * frame — `performance.now()` then — for validation 0002 Part AH's #618
       * rows, whose ceiling is +500 ms. Absent until that frame.
       */
      readonly firstFrameMs?: number;
      /**
       * #618's review: the formats the load CHOSE, not only the ones the
       * WebView offers — `KTX2Loader`'s own rules can turn an offered format
       * off, as its Linux rule does. Every texture a material wears, by
       * format, and their GPU bytes; the sky is apart. Absent until the first
       * frame. @see realisticTextureReport
       */
      readonly textures?: TextureSummary;
      readonly errors: readonly string[];
      /** What the first script saw of Capacitor's bridge, and what the shell sent it. @see EarlyRecord */
      readonly bridge: Omit<EarlyRecord, 'errors' | 'report'> | undefined;
      readonly query: string;
      readonly outcome: RealisticWorldOutcome | undefined;
      readonly notice: string | undefined;
      readonly result: RealisticSample | undefined;
      readonly soak: readonly (RealisticSample & { readonly minute: number })[];
      /** What the layer switch found in the scene, by layer — #616. @see LayerCensus */
      readonly layers: LayerCensus | undefined;
      /**
       * #1559: `route.ts` §`routeDigest` of the road ridden, so a gate can see
       * the default URL ride the road every Part Z and Part AH row was taken
       * on, and `route=village` another. Absent until the road is built.
       */
      readonly routeDigest?: string;
      /**
       * #1559: what the frame drawn last before the result was published holds
       * of a village — its structures, streets and furniture, carried and in
       * the camera's view. Absent with the result. @see frameCensus
       */
      readonly census?: FrameCensus;
      /**
       * #1624: the decoration belt of the world drawn, read off its mesh when
       * the result was published — its triangles (nought where it is not
       * drawn) and how many times its geometry was built. Absent with the result.
       */
      readonly decorations?: {
        readonly triangles: number;
        readonly rebuilds: number;
        /** #1627: the village-square trees the belt draws. */
        readonly trees: number;
        /**
         * #1627: one tree's triangles, from the product's own count, so the
         * spec can hold the lights to their share beside the trees.
         */
        readonly treeTriangles: number;
      };
      /**
       * #1566: the village models drawn on the last frame before the result
       * was published — houses, triangles and the structure items they took.
       * Absent with the result, or before a realistic frame.
       */
      readonly villageHouses?: VillageHouseStats;
      /**
       * #1815: what the view's Delivery belt drew on the last frame before the
       * result was published, read back off its instances
       * (`three-renderer.ts` §`deliveryDrawnOf`). Absent unless `?delivery=`
       * asked for a round. @see realistic/delivery.ts
       */
      readonly delivery?: Readonly<Record<'parcels' | 'markers' | 'obstacles', number>>;
      /**
       * #1815: the village ceiling that same frame is held to,
       * `realistic-budget.ts` §`villageDrawCallCeiling` of the frame the page
       * drew — the Delivery one while it carries a round, the frozen 50
       * otherwise. Absent with the result.
       */
      readonly villageCeiling?: number;
    };
  }
}

const errors: string[] = [];
const early = window.__oylRealisticEarly;
let published: NonNullable<Window['__oylRealistic']> = {
  ready: false,
  errors,
  bridge:
    early === undefined
      ? undefined
      : {
          capacitorAtStart: early.capacitorAtStart,
          androidBridgeAtStart: early.androidBridgeAtStart,
          standIn: early.standIn,
          // The same array the stand-in appends to, so it is live.
          events: early.events,
        },
  query: location.search,
  outcome: undefined,
  notice: undefined,
  result: undefined,
  soak: [],
  layers: undefined,
};
window.__oylRealistic = published;
const publish = (patch: Partial<NonNullable<Window['__oylRealistic']>>): void => {
  published = { ...published, ...patch };
  window.__oylRealistic = published;
};

/** The controls: which world, which rung, the ladder, and a line of numbers. */
function panel(config: ReturnType<typeof parseConfig>): { box: HTMLElement; line: HTMLElement } {
  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;top:0;left:0;max-width:100%;background:rgba(0,0,0,.72);color:#fff;font:15px/1.4 system-ui,sans-serif;padding:8px 10px;z-index:1';
  const button = (label: string, next: Partial<ReturnType<typeof parseConfig>>): HTMLElement => {
    const element = document.createElement('button');
    element.textContent = label;
    element.style.cssText = 'min-height:44px;margin:0 8px 6px 0;font:inherit';
    element.addEventListener('click', () => {
      location.search = configQuery({ ...config, ...next });
    });
    return element;
  };
  const line = document.createElement('pre');
  line.style.cssText = 'margin:4px 0 0;white-space:pre-wrap;font:13px/1.3 ui-monospace,monospace';
  box.append(
    button(config.world === 'realistic' ? 'Show the stylised world' : 'Show the realistic world', {
      world: config.world === 'realistic' ? 'stylised' : 'realistic',
      rung: 0,
    }),
    button(config.ladder ? 'Hold this rung' : 'Let the ladder move', { ladder: !config.ladder }),
    button(config.rung === 0 ? 'Start one rung down' : 'Start at the top rung', {
      rung: config.rung === 0 ? 1 : 0,
    }),
    line,
  );
  return { box, line };
}

async function run(): Promise<void> {
  const config = parseConfig(location.search);
  // #478's draw calls and #616's triangles, counted at the WebGL entry points.
  const counter = drawCounter(WebGL2RenderingContext.prototype);
  // #616: installed before the view exists, so it sees every belt join the scene.
  const layerSwitch = installLayerSwitch(config.layersOff);
  await loadSceneryModels();
  let outcome: RealisticWorldOutcome | undefined;
  if (config.world === 'realistic') {
    // #1283: the generated broadleaves, or the scans with that lever off —
    // chosen before the load, because it decides which files are fetched.
    setRealisticTrees(treesWithLevers(config.leversOff));
    outcome = await loadRealisticWorld();
  }
  const notice = outcome === undefined ? undefined : realisticWorldNotice(outcome);
  publish({ outcome, notice });

  // #702: turned towards the sun or away from it only when the URL asks. #1581:
  // or the mixed town's straight road, with its corridor, land and buildings
  // built once, as `GameView` builds a ride's at the press.
  // #1585: or the Richmond street, its narrow lots drawn as house models.
  // #1623: each at `place`, for the route's own season.
  const latitude = placeLatitude(config.place);
  const mixed =
    config.town === 'mixed'
      ? mixedTownFixture(latitude)
      : config.town === 'richmond'
        ? richmondStreetFixture(latitude)
        : config.town === 'countryside'
          ? countrysideFixture(latitude)
          : config.town === 'terrace'
            ? terraceStreetFixture(latitude)
            : config.town === 'city'
              ? cityCentreFixture(latitude)
              : config.town === 'city-street'
                ? cityStreetscapeFixture(latitude)
                : undefined;
  // #1559: or the level road through two villages, for validation 0002 AE2.
  const profile =
    mixed?.profile ??
    (config.route === 'village'
      ? villageRoute(config.facing, config.place)
      : realisticRoute(config.facing, config.place));
  const origin = mixed?.origin ?? corridorOrigin(profile);
  publish({ routeDigest: routeDigest(profile) });
  const town = ((): Parameters<typeof rideFrame>[0]['town'] => {
    if (mixed === undefined) return undefined;
    // #1634's urban class and #1660's split roofs, as the press builds them, unless a lever is off.
    const { land, plans, urban } = plannedTown(mixed, config.leversOff);
    return {
      corridor: mixed.corridor,
      land,
      buildings: mappedBuildingsOf(plans),
      lots: mappedTown(mixed.corridor, plans, urban),
    };
  })();
  const loopFrom = town === undefined ? LOOP_FROM_METRES : TOWN_FROM_METRES;
  const loopLength = town === undefined ? LOOP_METRES : TOWN_METRES;
  const startAt = town === undefined ? START_METRES : TOWN_FROM_METRES;
  document.body.style.cssText = 'margin:0;background:#000;overflow:hidden';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100vw;height:100vh';
  document.body.append(canvas);
  const controls = config.panel ? panel(config) : undefined;
  if (controls !== undefined) document.body.append(controls.box);

  let state: WorldQualityState = {
    realistic: config.world === 'realistic',
    quality: { ...INITIAL_QUALITY, level: config.rung },
  };
  // #619: the rung the view draws with, a lever that works through the rung
  // taken back out; the label, cap and scenery the page reports are the rung's.
  const drawnRung = (at: WorldQualityState) => rungWithLevers(worldRung(at), config.leversOff);
  const view = threeGameRenderer.create(canvas, drawnRung(state));
  // #1622: the URL's `date`, or this device's day, told once as a ride's start
  // tells it — in either world; `-decorations` drops the holiday.
  view.setSeason(
    seasonWithLevers(
      config,
      { hemisphere: routeHemisphere(profile), absLatitude: routeLatitudeMagnitude(profile) },
      deviceToday,
    ),
  );
  // #619 lever 1's control. The view builds its realistic belts when a rung
  // first asks for them, so it is applied again after every rung change.
  const foliageOrdered = !config.leversOff.includes('foliage-order');
  foliageOrderedOf(view, foliageOrdered);
  // #1523's before/after pair for the firs' depth pre-pass, on one build. The
  // fir meshes are the realistic belts', so it too is applied again after a
  // rung change.
  const firPrepass = firPrepassWithLevers(config.leversOff);
  firDepthPrepassOf(view, firPrepass);
  // #1523's cost pairs: the ground without #627's blend, the road without
  // #628's wear — the code out of the program, not a uniform at zero. A
  // setting of the view's, so it survives a rung change; and set BEFORE the
  // crag below, because a ground rebuilt with its blend starts at every share.
  realisticSurfacesOf(view, surfacesWithLevers(config.leversOff));
  // #1659's cost pair: the mapped windows without their reveals, the term out
  // of the facade's program. A setting of the module's, read at every compile.
  windowRevealsOf(view, windowRevealsWithLevers(config.leversOff));
  // #1658's cost pair: the mapped walls without the sun's shadow under their
  // eaves, the term out of the facade's program, as the reveals' is.
  overhangShadowsOf(view, overhangShadowsWithLevers(config.leversOff));
  // #1661's cost pair: the mapped facades without their weathering, the term
  // out of both of the facade's programs, as the shadows' is.
  weatheringOf(view, weatheringWithLevers(config.leversOff));
  // #1274's by-eye pair: a steep bank in ambientCG's rock face, or — the crag
  // off — in the scree's photograph, as it was. The ground's material is built
  // with the realistic belts, so this too is applied again after a rung change.
  const crag = config.leversOff.includes('crag') ? 0 : 1;
  groundBlendOf(view, 1, 1, 1, crag);
  // #622's by-eye pair: the air as the product breathes it, or as it was
  // before #622. A setting of the view's, so it survives a rung change.
  const airOn = !config.leversOff.includes('air');
  atmosphereOf(view, { table: airOn ? 'directional' : 'flattened', valley: airOn });
  // #1657's cost and by-eye pair: the mapped buildings grounded, or as they
  // were before it. A setting of the view's, so it survives a rung change.
  mappedBlobsShownOf(view, !config.leversOff.includes('mapped-blobs'));
  // #1566's by-eye and cost pair: the villages' houses as #1585's models, or
  // as their procedural buildings. A setting of the view's, as the blobs' is.
  villageModelsShownOf(view, !config.leversOff.includes('village-models'));
  // #1624: the product's decorations, or with `decorations=probe` the probe.
  decorationKindsOf(view, decorationsWithConfig(config));
  // #1626's cost pair: the mapped doors' winter wreath, or never. A setting
  // of the module's, applied to the season told above.
  facadeWreathOf(view, facadeWreathWithLevers(config.leversOff));
  const resize = (): void => view.resize(canvas.clientWidth, canvas.clientHeight);
  resize();
  addEventListener('resize', resize);
  const gl = canvas.getContext('webgl2');

  const clock = new MeasurementClock(WARM_UP_SECONDS);
  let measured = false;
  let windowFrom = 0;
  let minute = 0;
  let callsInWindow = 0;
  let trianglesInWindow = 0;
  let framesInWindow = 0;
  let lastFrameTriangles = 0;
  let lastFrameCalls = 0;
  let lastFrameRendererTriangles: number | undefined;
  let shownAt = 0;
  /** The frame handed to `view.render` last — #1559's census reads it. */
  let drawn: SceneFrame | undefined;
  const soak: (RealisticSample & { minute: number })[] = [];

  const sample = (frames: readonly number[], stalls: number): RealisticSample => ({
    world: drawnWorldOf(view),
    rung: worldRung(state).label,
    frameCap: worldRung(state).frameCap === DISPLAY_RATE ? 'display' : worldRung(state).frameCap,
    frameMs: percentiles(frames),
    drawCalls: framesInWindow === 0 ? 0 : Math.round(callsInWindow / framesInWindow),
    trianglesPerFrame: framesInWindow === 0 ? 0 : Math.round(trianglesInWindow / framesInWindow),
    lastFrame: {
      triangles: lastFrameTriangles,
      rendererTriangles: lastFrameRendererTriangles,
      calls: lastFrameCalls,
    },
    layersOff: config.layersOff,
    leversOff: config.leversOff,
    drawingBuffer: [gl?.drawingBufferWidth ?? 0, gl?.drawingBufferHeight ?? 0],
    devicePixelRatio,
    stalls,
    userAgent: navigator.userAgent,
  });

  // #476: the rung's frame cap, applied as `GameView` applies it, and the
  // ladder fed what `GameView` feeds it. @see FramePacer
  const pacer = new FramePacer();
  let warmedUp = false;
  const step = (now: number): void => {
    const paced = pacer.frame(now, worldRung(state).frameCap);
    // The product's own two-ladder policy, fed the product's own signal: the
    // gap after a DRAWN frame, never a skipped one's. Not during the warm-up,
    // and not across a stall, as this page always did.
    if (
      config.ladder &&
      warmedUp &&
      paced.frameMs !== undefined &&
      paced.frameMs <= MAXIMUM_FRAME_GAP_MS
    ) {
      const next = nextWorldQuality(state, { frameMs: paced.frameMs });
      if (next.realistic !== state.realistic || next.quality.level !== state.quality.level) {
        view.setQuality(drawnRung(next));
        foliageOrderedOf(view, foliageOrdered);
        firDepthPrepassOf(view, firPrepass);
        groundBlendOf(view, 1, 1, 1, crag);
      }
      state = next;
    }
    if (!paced.draw) return;
    // Only drawn frames reach the clock, so what it publishes is the time
    // between frames a rider SEES — at a capped rung, at least the cap.
    const { elapsedSeconds: elapsed } = clock.frame(now);
    const warmBefore = warmedUp;
    warmedUp = elapsed > WARM_UP_SECONDS;
    // #1294: the counts start where the clock's samples do. The warm-up's
    // frames are not the window's, and the page's very first render makes
    // about twice a frame's calls. @see RealisticSample.drawCalls
    if (warmedUp && !warmBefore) {
      callsInWindow = 0;
      trianglesInWindow = 0;
      framesInWindow = 0;
    }
    const distance =
      config.at ??
      loopFrom + ((startAt - loopFrom + elapsed * RIDE_METRES_PER_SECOND) % loopLength);
    // The rung the ladder is on decides how much scenery the frame carries, as
    // it does in `GameView` — #478. @see rideFrame
    drawn = rideFrame({
      profile,
      origin,
      distance,
      elapsed: config.at === undefined ? elapsed : 0,
      rung: worldRung(state),
      // #1534's pair: the villages' ground left wooded.
      settlementsWooded: config.leversOff.includes('settlement-clearing'),
      // #1541's pair: the people off.
      peopleOff: config.leversOff.includes('people'),
      // #1542's three, each off on its own.
      countrysideOff: countrysideWithLevers(config.leversOff),
      ...(town === undefined ? {} : { town }),
    });
    // #1815: a Delivery round's worst case on the road ahead, or no round at all.
    if (config.delivery !== undefined) {
      drawn = { ...drawn, delivery: deliveryAhead(drawn, distance, config.delivery) };
    }
    view.render(drawn);
    lastFrameCalls = counter.takeCalls();
    callsInWindow += lastFrameCalls;
    lastFrameTriangles = counter.takeTriangles();
    trianglesInWindow += lastFrameTriangles;
    // three resets its own count at the start of every `render`, so after the
    // view's one `render` it holds exactly this frame's.
    lastFrameRendererTriangles = layerSwitch.renderer()?.info.render.triangles;
    framesInWindow += 1;
    if (!published.ready) {
      const textures = textureSummary();
      publish({ ready: true, firstFrameMs: performance.now(), textures });
      console.log(`OYL-REALISTIC-FIRST-FRAME ${performance.now().toFixed(0)}`);
      console.log(`OYL-REALISTIC-TEXTURES ${JSON.stringify(textures)}`);
    }
    if (!measured && clock.windowFull(config.seconds)) {
      measured = true;
      windowFrom = elapsed;
      const taken = clock.take();
      const result = sample(taken.samples, taken.stalls);
      callsInWindow = 0;
      trianglesInWindow = 0;
      framesInWindow = 0;
      const layers = layerSwitch.census();
      const census =
        drawn === undefined
          ? undefined
          : frameCensus(drawn, canvas.clientWidth / Math.max(1, canvas.clientHeight));
      const belt = decorationBeltOf(view);
      const decorations =
        belt === undefined
          ? undefined
          : {
              triangles: belt.triangles,
              rebuilds: belt.rebuilds,
              trees: belt.itemsDrawn(VILLAGE_TREE),
              treeTriangles: VILLAGE_TREE_TRIANGLES,
            };
      const villageHouses = villageHouseStatsOf(view);
      const delivery =
        config.delivery === undefined
          ? undefined
          : {
              parcels: deliveryDrawnOf(view, 'parcels').length,
              markers: deliveryDrawnOf(view, 'markers').length,
              obstacles: deliveryDrawnOf(view, 'obstacles').length,
            };
      publish({
        result,
        layers,
        census,
        decorations,
        ...(villageHouses === undefined ? {} : { villageHouses }),
        ...(delivery === undefined ? {} : { delivery }),
        ...(drawn === undefined ? {} : { villageCeiling: villageDrawCallCeiling(drawn) }),
      });
      // #1559: for `adb logcat`, as the result is — AE2's row says what was in frame.
      if (census !== undefined) console.log(`OYL-REALISTIC-CENSUS ${JSON.stringify(census)}`);
      console.log(`OYL-REALISTIC ${JSON.stringify(result)}`);
      // #616: a share read with something the switch could not place still on
      // is a share of an unknown thing, so a run that switched a layer off says so.
      if (config.layersOff.length > 0 && layers.unplaced.length > 0) {
        fail(
          `realistic: the layer switch could not place ${layers.unplaced.join(', ')}; ` +
            'a layer it leaves on is not a layer switched off',
        );
      }
    } else if (
      measured &&
      config.soakMinutes > 0 &&
      minute < config.soakMinutes &&
      elapsed >= windowFrom + (minute + 1) * 60
    ) {
      minute += 1;
      const taken = clock.take();
      const each = { ...sample(taken.samples, taken.stalls), minute };
      callsInWindow = 0;
      trianglesInWindow = 0;
      framesInWindow = 0;
      soak.push(each);
      publish({ soak: [...soak] });
      console.log(`OYL-REALISTIC-SOAK ${JSON.stringify(each)}`);
    } else if (measured && config.soakMinutes === 0) {
      clock.take();
    }
    if (controls !== undefined && now - shownAt > 1_000) {
      shownAt = now;
      // The clock's own rolling window, never the measurement window: that one
      // is emptied every frame once measured, which is the `NaN` the tablet
      // showed. @see readoutLine
      controls.line.textContent = readoutLine({
        world: drawnWorldOf(view),
        rung: worldRung(state).label,
        frameCap:
          worldRung(state).frameCap === DISPLAY_RATE ? 'display' : worldRung(state).frameCap,
        phase: measured ? 'measured' : elapsed < WARM_UP_SECONDS ? 'warming up' : 'sampling',
        clock,
        buffer: [gl?.drawingBufferWidth ?? 0, gl?.drawingBufferHeight ?? 0],
        notice,
      });
    }
  };
  const safeStep = guarded(step, fail);
  const tick = (now: number): void => {
    if (safeStep(now)) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Puts an error where the procedure reads it, and on the screen. Never throws. */
function fail(message: string): void {
  errors.push(message);
  publish({ errors: [...errors] });
  console.log(`OYL-REALISTIC-ERROR ${message}`);
  const shown = document.createElement('p');
  shown.textContent = errors.join('\n');
  shown.style.cssText =
    'position:fixed;bottom:0;left:0;margin:0;z-index:2;color:#fff;background:#700;padding:12px;font:16px system-ui';
  document.body.append(shown);
}

// #478. `realistic.html`'s first script has been catching errors since before
// this module existed; from here on it hands them to `fail`, and what it caught
// meanwhile is reported now. Without that script — a page built from an old
// `realistic.html` — this module listens for itself, as it always did.
// @see takeOverReporting
takeOverReporting(early, fail, (type, listener) => addEventListener(type, listener), describe);
// One line for `adb logcat`, whatever else happens: whether the shell's bridge
// reached this page. It does (#480) — the tablet's `triggerEvent` error is the
// app's launch, not this page. @see apps/mobile/src/android/lifecycle-events.test.ts
console.log(
  `OYL-REALISTIC-LOAD ${JSON.stringify({ bridge: published.bridge ?? 'no early script' })}`,
);

run().catch((error: unknown) => {
  fail(describe(error));
});
