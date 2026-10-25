// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Stand-ins for the demo stage's two browser seams — the renderer and the
 * frame clock — for `stage.test.ts` and `DemoPage.test.tsx` (#1647).
 */

import type { GameRenderer, GameView, SceneFrame } from '../game/port';
import type { QualitySettings } from '../game/quality';
import type { RealisticWorldOutcome } from '../game/realistic-assets';
import type { FrameScheduler } from './stage';

/** A frame clock that runs only when the test says, and counts what it was asked. */
export class SteppedFrames implements FrameScheduler {
  nowMs = 0;
  requested = 0;
  ran = 0;
  #pending = new Map<number, (nowMs: number) => void>();
  #next = 1;
  request(callback: (nowMs: number) => void): number {
    this.requested += 1;
    const handle = this.#next++;
    this.#pending.set(handle, callback);
    return handle;
  }
  cancel(handle: number): void {
    this.#pending.delete(handle);
  }
  get pending(): number {
    return this.#pending.size;
  }
  /** Run every pending callback once per step, `steps` steps of `stepMs` (60 Hz by default). */
  step(steps = 1, stepMs = 1000 / 60): void {
    for (let index = 0; index < steps; index += 1) {
      this.nowMs += stepMs;
      const due = [...this.#pending.values()];
      this.#pending.clear();
      for (const callback of due) {
        this.ran += 1;
        callback(this.nowMs);
      }
    }
  }
}

export interface FakeView extends GameView {
  readonly rendered: SceneFrame[];
  readonly qualities: QualitySettings[];
}

export function fakeRenderer(outcome: Promise<RealisticWorldOutcome>): {
  renderer: GameRenderer;
  views: FakeView[];
} {
  const views: FakeView[] = [];
  const renderer: GameRenderer = {
    create(_canvas, settings) {
      const rendered: SceneFrame[] = [];
      const qualities: QualitySettings[] = [settings];
      const view: FakeView = {
        rendered,
        qualities,
        render: (frame) => void rendered.push(frame),
        prepare: () => Promise.resolve(),
        setQuality: (next) => void qualities.push(next),
        setRiderKit: () => undefined,
        setSeason: () => undefined,
        resize: () => undefined,
        destroy: () => undefined,
        hasContext: true,
      };
      views.push(view);
      return view;
    },
    loadRealisticWorld: () => outcome,
  };
  return { renderer, views };
}

/** What a fake view says it is drawing: the world of the last rung it was handed. */
export function fakeDrawnWorld(view: GameView): QualitySettings['world'] {
  return (view as FakeView).qualities.at(-1)?.world ?? 'stylised';
}
