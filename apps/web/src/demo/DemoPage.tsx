// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The demo page — #1647: a preset ridden in the product's world, with play,
 * pause and stop, and the source offer (#1645).
 *
 * ## WCAG 2.2 SC 2.2.2, Pause, Stop, Hide
 *
 * The demo moves for longer than five seconds, so it can be paused and
 * stopped, with real `<button>`s at least `CONTROL_MINIMUM_PIXELS` square as
 * the ride HUD's are (`DEMO_CONTROL_PIXELS`), in the HUD's own `oyl-hud__control` style. A visitor who
 * asked for reduced motion is shown a still frame and a Play button: the demo
 * does not move until they press it.
 *
 * ## Hidden means paused
 *
 * `visibilitychange` and an `IntersectionObserver` on the canvas tell the
 * stage when nobody can see it, and the stage then requests no frames
 * (`stage.ts`). Every browser seam arrives as a prop, so `DemoPage.test.tsx`
 * drives each one and `main.tsx` is the only place the real ones are named.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import type { GameRenderer, GameView } from '../game/port';
import type { QualitySettings } from '../game/quality';
import { createDemoPlayer, type DemoStatus } from './player';
import { parseDemoQuery } from './query';
import { DemoSourceOffer } from './SourceOffer';
import { startDemoStage, type DemoSnapshot, type DemoStage, type FrameScheduler } from './stage';

export interface DemoPageProps {
  /** `location.search`. */
  readonly search: string;
  readonly renderer: GameRenderer;
  readonly drawnWorld: (view: GameView) => QualitySettings['world'];
  readonly frames: FrameScheduler;
  /** Whether the visitor asked for reduced motion (`prefers-reduced-motion: reduce`). */
  readonly reducedMotion: boolean;
  /** Watch whether `element` is on screen; returns the way to stop watching. */
  readonly observeInView: (element: Element, onChange: (inView: boolean) => void) => () => void;
  /** Where each snapshot goes — `window.__oylDemo` in `main.tsx`. */
  readonly publish: (snapshot: DemoSnapshot) => void;
}

/**
 * The side of the demo's controls, CSS pixels: `HudPanel.tsx`
 * §`CONTROL_MINIMUM_PIXELS`, the ride HUD's. Written out because importing
 * `HudPanel.tsx` bundles the ride's room and instance modules, which
 * `tools/demo/forbidden-modules.ts` refuses; `DemoPage.test.tsx` holds the two
 * equal.
 */
export const DEMO_CONTROL_PIXELS = 72;

const CONTROL_SIZE = { minWidth: DEMO_CONTROL_PIXELS, minHeight: DEMO_CONTROL_PIXELS };

/** The page. */
export function DemoPage(props: DemoPageProps) {
  const query = useMemo(() => parseDemoQuery(props.search), [props.search]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<DemoStage | undefined>(undefined);
  const [status, setStatus] = useState<DemoStatus>(props.reducedMotion ? 'paused' : 'playing');
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const { renderer, drawnWorld, frames, reducedMotion, observeInView, publish } = props;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!query.ok || canvas === null) return undefined;
    const player = createDemoPlayer(query.preset);
    if (!reducedMotion) player.play();
    const stage = startDemoStage({
      canvas,
      renderer,
      drawnWorld,
      player,
      frames,
      publish: (snapshot) => {
        setStatus(snapshot.state);
        setNotice(snapshot.notice);
        publish(snapshot);
      },
    });
    stageRef.current = stage;
    const onVisibility = (): void => stage.setPageVisible(document.visibilityState !== 'hidden');
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    const stopObserving = observeInView(canvas, (inView) => stage.setInView(inView));
    const onResize = (): void => stage.resize(canvas.clientWidth, canvas.clientHeight);
    addEventListener('resize', onResize);
    return () => {
      removeEventListener('resize', onResize);
      stopObserving();
      document.removeEventListener('visibilitychange', onVisibility);
      stage.destroy();
      stageRef.current = undefined;
    };
  }, [query, renderer, drawnWorld, frames, reducedMotion, observeInView, publish]);

  const playing = status === 'playing';
  return (
    <main style={{ display: 'flex', flexDirection: 'column', height: '100dvh', margin: 0 }}>
      <h1>On Your Left</h1>
      {query.ok ? (
        <>
          <div style={{ flex: 1, minHeight: 0 }}>
            <canvas
              ref={canvasRef}
              role="img"
              aria-label={`A demo ride in the game: the ${query.preset.id} preset, ridden by scripted riders.`}
              style={{ display: 'block', width: '100%', height: '100%' }}
            />
          </div>
          {notice === undefined ? null : <p role="status">{notice}</p>}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="oyl-hud__control"
              style={CONTROL_SIZE}
              onClick={() => (playing ? stageRef.current?.pause() : stageRef.current?.play())}
            >
              {playing ? 'Pause' : 'Play'}
            </button>
            <button
              type="button"
              className="oyl-hud__control"
              style={CONTROL_SIZE}
              onClick={() => stageRef.current?.stop()}
            >
              Stop
            </button>
          </div>
        </>
      ) : (
        <p>{query.message}</p>
      )}
      <DemoSourceOffer />
    </main>
  );
}
