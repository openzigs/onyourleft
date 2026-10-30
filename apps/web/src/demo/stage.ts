// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The demo player's loop: the product's renderer, frame pacer and quality
 * ladder, drawing a {@link DemoPlayer} — #1647.
 *
 * `apps/web/browser/realistic-harness.ts` composes the same pieces and is the
 * reference; `GameView.tsx` is where each of them is explained.
 *
 * ## The realistic world from the start, and the fallback that says so
 *
 * The view is built at the realistic ladder's top (the owner's ruling on
 * #1643) and draws the stylised world while the realistic files arrive, as
 * `GameView` does. If they cannot load, the ride steps to the stylised
 * ladder's top and the page says so in the product's own sentence,
 * `realistic-assets.ts` §`realisticWorldNotice` (ADR 0026 D-7). A device too
 * hot for the realistic world steps down the product's ladder
 * (`quality.ts` §`nextWorldQuality`) and is told `REALISTIC_WORLD_LEFT_NOTICE`.
 *
 * ## Frames are requested only when somebody can see them
 *
 * WCAG 2.2 SC 2.2.2 asks that the moving demo can be paused and stopped; a
 * visitor's battery asks that a demo nobody can see draws nothing. So no frame
 * is requested while the page is hidden, while the canvas is scrolled out of
 * view, or while the player is not playing — except one, to draw a still
 * frame after something changed. Time spent not drawing is not ridden
 * (`DemoPlayer.holdClock`), so a visitor who scrolls back finds the riders
 * where they left them.
 *
 * ## The showcase — #1653
 *
 * Given a {@link ShowcaseRun}, every tick reads the timeline at the ride's
 * time (`showcase.ts` §`showcaseAt`) and applies what changed: the world
 * through the quality ladder's own rungs, the season through
 * `GameView.setSeason` from a fixed date (`season.ts` §`seasonOn`, never the
 * viewer's clock), the people and the countryside through the frame
 * (`player.ts` §`FrameFeatures`). What it publishes is read back from the
 * renderer — the world it draws, the season it holds — and from the frame
 * it was handed, never from the timeline. At the timeline's end the ride
 * starts again from 0, without a reload.
 *
 * A `stretch` cue switches which ride is drawn: the run's, or the village
 * stretch's (`showcase.ts` §`SHOWCASE_VILLAGE_ROAD`), where the season's
 * decorations stand. Both are ridden on the one clock, played, paused, stopped
 * and looped together, so a cut to either lands where it is now; the HUD is
 * the drawn ride's (`publish`'s `drawn`), and the decorations published are
 * the view's own (`drawnDecorations`).
 *
 * ## The clock is the scheduler's
 *
 * Each frame's time is the timestamp {@link FrameScheduler.request} hands its
 * callback: `requestAnimationFrame`'s in a browser, a stepped number in a test
 * and in the video render (#1655).
 *
 * ## Stepped — the video render, #1655
 *
 * Given `stepped`, every tick draws, and no tick's time reaches the quality
 * ladder: a tick is the render's step (`render-clock.ts`), not a measurement of
 * the device, and a ladder fed it would change the world at whatever frame
 * rate the render was asked for. So a render is drawn at the rung the stage
 * starts on, the realistic world's top unless it could not load.
 */

import type { GameRenderer, GameView, SceneFrame } from '../game/port';
import { FramePacer, type PacedFrame } from '../game/frame-pacer';
import {
  INITIAL_QUALITY,
  INITIAL_REALISTIC_QUALITY,
  nextWorldQuality,
  worldRung,
  type QualitySettings,
  type WorldQualityState,
} from '../game/quality';
import { REALISTIC_WORLD_LEFT_NOTICE, realisticWorldNotice } from '../game/realistic-assets';
import { NO_SEASON, parseCalendarDay, seasonOn, type Season } from '../game/season';
import { routeHemisphere, routeLatitudeMagnitude } from '../game/world';
import type { CorridorCounts } from './baked-route';
import type { DemoPlayer, DemoStatus, FrameFeatures } from './player';
import {
  NO_SEASON_DATE,
  showcaseAt,
  type ShowcaseFeature,
  type ShowcaseStretch,
  type ShowcaseTimeline,
} from './showcase';
import type { DemoPresetId } from './script';

/** Asks for one frame, as `requestAnimationFrame` does. */
export interface FrameScheduler {
  request(callback: (nowMs: number) => void): number;
  cancel(handle: number): void;
}

/**
 * What the demo publishes as `window.__oylDemo` — for the demo's browser gate
 * (#1648) and the video render (#1655) to read. Nothing in the demo reads it
 * back.
 */
export interface DemoSnapshot {
  readonly state: DemoStatus;
  readonly preset: DemoPresetId;
  /** The world the view is drawing now. */
  readonly world: QualitySettings['world'];
  readonly framesDrawn: number;
  /** The lead rider's odometer, metres. */
  readonly distance: number;
  /** What the page says about the world, if anything. */
  readonly notice: string | undefined;
  /**
   * #1652: the baked route the run was given and its corridor's feature
   * counts, or `undefined` on the synthetic road. The browser gate checks the
   * counts against the fixture bundle's.
   */
  readonly mapData: { readonly route: string; readonly counts: CorridorCounts } | undefined;
  /**
   * #1652: how many mapped buildings the last frame handed to the renderer
   * carried — read off that frame (`SceneFrame.mappedBuildings`), not off
   * the bundle, so a corridor that never reached the scene reads 0.
   */
  readonly mappedBuildings: number;
  /**
   * #1653: every showcase cue skipped this pass for a feature this run cannot
   * draw, by `showcase.ts` §`cueName`. Empty when nothing was, and on a run
   * with no showcase.
   */
  readonly skipped: readonly string[];
  /** #1653: the showcase, as it stands; `undefined` on a run with no showcase. */
  readonly showcase: ShowcaseSnapshot | undefined;
}

/** What the showcase publishes, every value read back from the renderer or the frame drawn. */
export interface ShowcaseSnapshot {
  /** Which pass of the timeline this is, from 1. */
  readonly pass: number;
  /** Ride seconds into this pass. */
  readonly seconds: number;
  /** How many of the timeline's cues have fired this pass, skipped ones included. */
  readonly fired: number;
  /** The caption on screen, if any. */
  readonly caption: string | undefined;
  /** The holiday the VIEW holds (`drawnSeason`), `none` for none. */
  readonly holiday: string;
  /** How many people the last frame drawn carried (`SceneFrame.people`). */
  readonly people: number;
  /** A digest of the last frame's scenery kinds, which #1542's countryside changes. */
  readonly scenery: number;
  /** Which ride the last frame drawn came from. */
  readonly stretch: ShowcaseStretch;
  /**
   * How many triangles of the holiday's decorations the VIEW drew in its last
   * frame (`drawnDecorations`): none with no holiday or no village in reach.
   */
  readonly decorations: number;
}

/** A showcase to run on the stage — #1653. */
export interface ShowcaseRun {
  readonly timeline: ShowcaseTimeline;
  /** The features this build has (`showcase-features.ts`). */
  readonly features: ReadonlySet<ShowcaseFeature>;
  /**
   * The village stretch's ride (`showcase.ts` §`showcaseRides`), drawn while
   * the timeline says `village`, and ridden alongside the run's throughout.
   */
  readonly village: DemoPlayer;
}

export interface DemoStageOptions {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: GameRenderer;
  /** Which world a view is drawing — `three-renderer.ts` §`drawnWorldOf` in the demo. */
  readonly drawnWorld: (view: GameView) => QualitySettings['world'];
  readonly player: DemoPlayer;
  readonly frames: FrameScheduler;
  /**
   * Called with every snapshot, after every drawn frame and every change, and
   * the ride being drawn — `player`, or a showcase's village stretch — for
   * the HUD to read.
   */
  readonly publish: (snapshot: DemoSnapshot, drawn: DemoPlayer) => void;
  /** #1653: the showcase to run, if any. */
  readonly showcase?: ShowcaseRun | undefined;
  /** The season a view holds — `three-renderer.ts` §`seasonOf` in the demo. */
  readonly drawnSeason?: ((view: GameView) => Season | undefined) | undefined;
  /**
   * How many decoration triangles a view drew last — `three-renderer.ts`
   * §`decorationBeltOf`'s, in the demo (#1653).
   */
  readonly drawnDecorations?: ((view: GameView) => number) | undefined;
  /** #1655: the video render's clock drives the stage — the header's §"Stepped". */
  readonly stepped?: boolean | undefined;
}

/** What a stepped stage makes of every tick: drawn, and no sample for the ladder. */
const STEPPED_FRAME: PacedFrame = { draw: true, frameMs: undefined };

/** FNV-1a over a frame's scenery kinds: changes when the countryside does. */
function sceneryDigest(frame: SceneFrame): number {
  let hash = 0x811c9dc5;
  for (const item of frame.scatter) {
    for (let at = 0; at < item.kind.length; at += 1) {
      hash = Math.imul(hash ^ item.kind.charCodeAt(at), 0x01000193) >>> 0;
    }
  }
  return hash;
}

export interface DemoStage {
  play(): void;
  pause(): void;
  stop(): void;
  /** Whether the page is visible (`visibilitychange`). */
  setPageVisible(visible: boolean): void;
  /** Whether the canvas is on screen (`IntersectionObserver`). */
  setInView(inView: boolean): void;
  resize(widthCssPixels: number, heightCssPixels: number): void;
  destroy(): void;
}

/** A gap longer than this is the page not being drawn, never a frame time. */
const LONGEST_FRAME_MS = 1_000;

/** Build the view and start drawing `player`. */
export function startDemoStage(options: DemoStageOptions): DemoStage {
  const { canvas, renderer, player, frames } = options;
  let quality: WorldQualityState = INITIAL_REALISTIC_QUALITY;
  const view = renderer.create(canvas, worldRung(quality));
  view.setRiderKit(player.preset.riders[0]?.kit);
  // The demo's world is the same on every visit: no holiday, no season.
  view.setSeason(NO_SEASON);
  view.resize(canvas.clientWidth || 320, canvas.clientHeight || 180);

  let destroyed = false;
  let pageVisible = true;
  let inView = true;
  let redrawOwed = true;
  let handle: number | undefined;
  let pacer = new FramePacer();
  let framesDrawn = 0;
  let mappedBuildings = 0;
  let notice: string | undefined;
  // #1653: the showcase's state, and what it last applied.
  const showcase = options.showcase;
  let pass = 1;
  let realisticLoaded = false;
  let realisticLeft = false;
  let appliedWorld: 'stylised' | 'realistic' | undefined;
  let appliedDate: string | undefined;
  let features: FrameFeatures | undefined;
  let lastFrame: SceneFrame | undefined;
  let lastStretch: ShowcaseStretch = 'route';
  let shown: ReturnType<typeof showcaseAt> | undefined;
  /** Every ride the stage rides: the run's, and a showcase's village stretch. */
  const rides: readonly DemoPlayer[] =
    showcase === undefined ? [player] : [player, showcase.village];
  // The village rides as the run does from the start: a caller plays the run
  // before the stage is built unless the visitor asked for reduced motion.
  if (showcase !== undefined && player.status === 'playing') showcase.village.play();
  /** The ride the timeline says is drawn now. */
  const drawn = (): DemoPlayer =>
    showcase !== undefined && shown?.stretch === 'village' ? showcase.village : player;
  const can = (feature: ShowcaseFeature): boolean =>
    showcase !== undefined &&
    showcase.features.has(feature) &&
    (feature !== 'realistic' || (realisticLoaded && !realisticLeft)) &&
    (feature !== 'countryside' || player.mapData !== undefined);

  /** Tell the view what the timeline says now, where it changed. */
  const applyShowcase = (): void => {
    if (showcase === undefined) return;
    const state = showcaseAt(showcase.timeline, player.rideMs / 1000, can);
    shown = state;
    if (state.world !== appliedWorld) {
      appliedWorld = state.world;
      const next: WorldQualityState =
        state.world === 'realistic'
          ? INITIAL_REALISTIC_QUALITY
          : { realistic: false, quality: INITIAL_QUALITY };
      if (next.realistic !== quality.realistic) {
        quality = next;
        view.setQuality(worldRung(quality));
        pacer = new FramePacer();
      }
    }
    if (state.date !== appliedDate) {
      appliedDate = state.date;
      const day = parseCalendarDay(state.date);
      view.setSeason(
        state.date === NO_SEASON_DATE || day === undefined
          ? NO_SEASON
          : seasonOn(
              day,
              routeHemisphere(player.profile),
              routeLatitudeMagnitude(player.profile),
              true,
            ),
      );
    }
    features = { people: state.people, countryside: state.countryside };
  };

  const publish = (): void => {
    const ride = drawn();
    options.publish(
      {
        state: player.status,
        preset: player.preset.id,
        world: options.drawnWorld(view),
        framesDrawn,
        distance: ride.state.ride.distance,
        notice,
        mapData: player.mapData,
        mappedBuildings,
        skipped: shown?.skipped ?? [],
        showcase:
          shown === undefined
            ? undefined
            : {
                pass,
                seconds: player.rideMs / 1000,
                fired: shown.fired,
                caption: shown.caption,
                holiday: options.drawnSeason?.(view)?.holiday ?? 'none',
                people:
                  lastFrame?.people === undefined
                    ? 0
                    : lastFrame.people.near.length + lastFrame.people.far.length,
                scenery: lastFrame === undefined ? 0 : sceneryDigest(lastFrame),
                stretch: lastStretch,
                decorations: options.drawnDecorations?.(view) ?? 0,
              },
      },
      ride,
    );
  };

  const seen = (): boolean => pageVisible && inView && !destroyed;

  const tick = (nowMs: number): void => {
    handle = undefined;
    if (!seen()) return;
    for (const ride of rides) ride.advance(nowMs);
    if (showcase !== undefined && player.rideMs >= showcase.timeline.seconds * 1000) {
      // The timeline's end: the ride from its start line, without a reload.
      for (const ride of rides) {
        ride.stop();
        ride.play();
        ride.advance(nowMs);
      }
      pass += 1;
    }
    applyShowcase();
    const paced =
      options.stepped === true ? STEPPED_FRAME : pacer.frame(nowMs, worldRung(quality).frameCap);
    if (paced.frameMs !== undefined && paced.frameMs <= LONGEST_FRAME_MS) {
      const next = nextWorldQuality(quality, { frameMs: paced.frameMs });
      if (next.realistic !== quality.realistic || next.quality.level !== quality.quality.level) {
        view.setQuality(worldRung(next));
        if (quality.realistic && !next.realistic) {
          notice = REALISTIC_WORLD_LEFT_NOTICE;
          realisticLeft = true;
        }
      }
      quality = next;
    }
    if (paced.draw || redrawOwed) {
      const ride = drawn();
      const frame = ride.frame(worldRung(quality), features);
      view.render(frame);
      lastFrame = frame;
      lastStretch = ride === player ? 'route' : 'village';
      mappedBuildings = frame.mappedBuildings?.buildings.plans.length ?? 0;
      framesDrawn += 1;
      redrawOwed = false;
      publish();
    }
    schedule();
  };

  function schedule(): void {
    if (handle !== undefined || !seen()) return;
    if (player.status !== 'playing' && !redrawOwed) return;
    handle = frames.request(tick);
  }

  /** Stop requesting frames, and ride none of the time until the next. */
  const idle = (): void => {
    if (handle !== undefined) frames.cancel(handle);
    handle = undefined;
    for (const ride of rides) ride.holdClock();
    // A pacer that saw the last frame before a gap would hand the ladder the
    // gap as one frame's time.
    pacer = new FramePacer();
  };

  const redraw = (): void => {
    redrawOwed = true;
    schedule();
  };

  void renderer.loadRealisticWorld().then((outcome) => {
    realisticLoaded = outcome.loaded;
    // #1653: a showcase in its stylised moment is told only that the world failed.
    if (!destroyed && showcase !== undefined && !quality.realistic) {
      if (!outcome.loaded) notice = realisticWorldNotice(outcome);
      redraw();
      publish();
      return;
    }
    // The page may have gone, or the ladder left realism, while the files arrived.
    if (destroyed || !quality.realistic) return;
    if (outcome.loaded) {
      view.setQuality(worldRung(quality));
    } else {
      quality = { realistic: false, quality: INITIAL_QUALITY };
      view.setQuality(worldRung(quality));
      notice = realisticWorldNotice(outcome);
    }
    redraw();
    publish();
  });

  applyShowcase();
  publish();
  schedule();

  return {
    play() {
      for (const ride of rides) ride.play();
      publish();
      schedule();
    },
    pause() {
      for (const ride of rides) ride.pause();
      idle();
      redraw();
      publish();
    },
    stop() {
      for (const ride of rides) ride.stop();
      idle();
      redraw();
      publish();
    },
    setPageVisible(visible) {
      pageVisible = visible;
      if (seen()) redraw();
      else idle();
    },
    setInView(visible) {
      inView = visible;
      if (seen()) redraw();
      else idle();
    },
    resize(width, height) {
      view.resize(width, height);
      redraw();
    },
    destroy() {
      idle();
      destroyed = true;
      view.destroy();
    },
  };
}
