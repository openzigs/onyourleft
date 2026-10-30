// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The demo's entry — `demo/index.html` loads it, and `vite.demo.config.ts`
 * builds it into `demo/dist/`. Nothing in the rider app imports it
 * (`tools/demo/demo-stays-out.ts`), and it may import nothing that reaches a
 * trainer, Bluetooth, the network or storage (`tools/demo/forbidden-modules.ts`).
 *
 * This is the one place the demo names the browser's own seams — the frame
 * clock, the reduced-motion preference, the intersection observer — and hands
 * them to {@link DemoPage}, which is tested with each of them replaced.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '../design/theme.css';
import './demo.css';
import type { GameView } from '../game/port';
import {
  decorationBeltOf,
  drawnWorldOf,
  loadGameWordmark,
  loadSceneryModels,
  readFileBytes,
  seasonOf,
  threeGameRenderer,
} from '../game/three-renderer';
import { DemoPage } from './DemoPage';
import type { DemoSnapshot, FrameScheduler } from './stage';

declare global {
  interface Window {
    /**
     * What the demo is doing, for the demo's browser gate (#1648) and the
     * video render (#1655) to read. Written after every drawn frame and
     * every change; nothing in the demo reads it back.
     *
     * @test-facing read by the demo's browser gate and the video render
     */
    __oylDemo?: DemoSnapshot;
  }
}

/** The browser's frame clock: `requestAnimationFrame`'s timestamp is `performance.now()`'s. */
const FRAMES: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

function observeInView(element: Element, onChange: (inView: boolean) => void): () => void {
  const observer = new IntersectionObserver((entries) => {
    const last = entries[entries.length - 1];
    if (last !== undefined) onChange(last.isIntersecting);
  });
  observer.observe(element);
  return () => observer.disconnect();
}

/** How many decoration triangles the view drew last: its belt's, read off the scene. */
function drawnDecorations(view: GameView): number {
  return decorationBeltOf(view)?.triangles ?? 0;
}

function publish(snapshot: DemoSnapshot): void {
  window.__oylDemo = snapshot;
}

async function start(): Promise<void> {
  const root = document.getElementById('root');
  if (root === null) {
    throw new Error('demo/index.html has no #root to mount the demo in');
  }
  // The scenery's shapes and the wordmark before the first view, as the app's
  // `main.tsx` §`loadGameRenderer` awaits them.
  await Promise.all([loadSceneryModels(), loadGameWordmark()]);
  createRoot(root).render(
    <StrictMode>
      <DemoPage
        search={location.search}
        renderer={threeGameRenderer}
        drawnWorld={drawnWorldOf}
        frames={FRAMES}
        reducedMotion={matchMedia('(prefers-reduced-motion: reduce)').matches}
        observeInView={observeInView}
        publish={publish}
        // #1652: a baked route's files, same-origin, into memory.
        readFile={readFileBytes}
        // #1653: the season the view holds, which the showcase reads back.
        drawnSeason={seasonOf}
        // #1653: the decorations the view drew, which the showcase reads back.
        drawnDecorations={drawnDecorations}
      />
    </StrictMode>,
  );
}

void start();
