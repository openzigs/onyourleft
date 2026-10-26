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
 * ## The clock is the scheduler's
 *
 * Each frame's time is the timestamp {@link FrameScheduler.request} hands its
 * callback: `requestAnimationFrame`'s in a browser, a stepped number in a test
 * and in the video render (#1655).
 */

import type { GameRenderer, GameView } from '../game/port';
import { FramePacer } from '../game/frame-pacer';
import {
  INITIAL_QUALITY,
  INITIAL_REALISTIC_QUALITY,
  nextWorldQuality,
  worldRung,
  type QualitySettings,
  type WorldQualityState,
} from '../game/quality';
import { REALISTIC_WORLD_LEFT_NOTICE, realisticWorldNotice } from '../game/realistic-assets';
import { NO_SEASON } from '../game/season';
import type { CorridorCounts } from './baked-route';
import type { DemoPlayer, DemoStatus } from './player';
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
}

export interface DemoStageOptions {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: GameRenderer;
  /** Which world a view is drawing — `three-renderer.ts` §`drawnWorldOf` in the demo. */
  readonly drawnWorld: (view: GameView) => QualitySettings['world'];
  readonly player: DemoPlayer;
  readonly frames: FrameScheduler;
  /** Called with every snapshot, after every drawn frame and every change. */
  readonly publish: (snapshot: DemoSnapshot) => void;
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

  const publish = (): void => {
    options.publish({
      state: player.status,
      preset: player.preset.id,
      world: options.drawnWorld(view),
      framesDrawn,
      distance: player.state.ride.distance,
      notice,
      mapData: player.mapData,
      mappedBuildings,
    });
  };

  const seen = (): boolean => pageVisible && inView && !destroyed;

  const tick = (nowMs: number): void => {
    handle = undefined;
    if (!seen()) return;
    player.advance(nowMs);
    const paced = pacer.frame(nowMs, worldRung(quality).frameCap);
    if (paced.frameMs !== undefined && paced.frameMs <= LONGEST_FRAME_MS) {
      const next = nextWorldQuality(quality, { frameMs: paced.frameMs });
      if (next.realistic !== quality.realistic || next.quality.level !== quality.quality.level) {
        view.setQuality(worldRung(next));
        if (quality.realistic && !next.realistic) notice = REALISTIC_WORLD_LEFT_NOTICE;
      }
      quality = next;
    }
    if (paced.draw || redrawOwed) {
      const frame = player.frame(worldRung(quality));
      view.render(frame);
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
    player.holdClock();
    // A pacer that saw the last frame before a gap would hand the ladder the
    // gap as one frame's time.
    pacer = new FramePacer();
  };

  const redraw = (): void => {
    redrawOwed = true;
    schedule();
  };

  void renderer.loadRealisticWorld().then((outcome) => {
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

  publish();
  schedule();

  return {
    play() {
      player.play();
      publish();
      schedule();
    },
    pause() {
      player.pause();
      idle();
      redraw();
      publish();
    },
    stop() {
      player.stop();
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
