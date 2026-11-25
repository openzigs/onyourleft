// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Capture mode — #3152: the real app, ridden by a scripted rider, for the
 * demo video's frame-by-frame render (`tools/capture/`, epic #3151).
 *
 * ## Where it is switched on
 *
 * A query on the game's own route, beside the simulated rider's
 * (`simulated-rider.ts`), and nowhere a rider is shown it:
 *
 *     #/game?capture=route-hud
 *
 * The scene names a script of power, cadence and heart rate
 * ({@link CAPTURE_SCENES}); the rider still chooses the route and presses
 * *Ride*. The capture tool imports a synthetic route first and steps the
 * page's clocks (`tools/capture/capture-clock.ts`); this module never reads a
 * clock of its own, so the same ride is the same frames.
 *
 * ## Why it is as harmless as `?simulate=`
 *
 * A capture ride IS a simulated ride: `GameView.tsx` §`useSimulatedRide`
 * builds it with no trainer port, no room, no rooms and no Delivery round,
 * so nothing is written to a machine, recorded, saved or posted, by the
 * ports' absence. `capture-wiring.test.tsx` holds that, after
 * `simulated-rider-wiring.test.tsx`. What it adds is that the readings move
 * as a ride's do and that the HUD is the one a rider sees: no simulated mark
 * on the stage, and the recorder's figures (Moving, the ride so far,
 * Calories) worked out in memory by `capture-recording.ts` from the same
 * readings. A screenshot of a capture shows invented numbers; so does any
 * screenshot a developer edits, and the video it is for carries its own
 * captions (#3156).
 *
 * ⚠️ Nothing here is a reading from a device. These are a script's numbers,
 * which is why the mode is reachable only by typing its query.
 */

import { watts } from '@onyourleft/domain';

import type { GameSensors } from './sensors';
import type { SimulatedRider } from './simulated-rider';

/** One point of a scene's script: the readings at `second` of the ride. */
export interface CaptureKey {
  readonly second: number;
  readonly watts: number;
  /** Revolutions a minute. */
  readonly cadence: number;
  /** Beats a minute. */
  readonly heartRate: number;
}

/** A scene the capture tool can ask for by name. */
export interface CaptureScene {
  readonly id: string;
  /**
   * The script, in rising {@link CaptureKey.second}s from nought. Between two
   * keys each reading moves in a straight line; after the last it holds.
   */
  readonly keys: readonly CaptureKey[];
}

/**
 * The scenes. `route-hud`: a route ride with the full HUD (#3152), a steady
 * build to a hard minute and an easing off, so every panel has something
 * moving — the power, the cadence, the heart rate and the graph behind them.
 * The numbers are a fit amateur's, chosen rather than measured.
 */
export const CAPTURE_SCENES: Readonly<Record<string, CaptureScene>> = {
  'route-hud': {
    id: 'route-hud',
    keys: [
      { second: 0, watts: 170, cadence: 82, heartRate: 118 },
      { second: 5, watts: 215, cadence: 88, heartRate: 131 },
      { second: 12, watts: 285, cadence: 94, heartRate: 149 },
      { second: 18, watts: 320, cadence: 97, heartRate: 158 },
      { second: 26, watts: 240, cadence: 90, heartRate: 155 },
      { second: 40, watts: 205, cadence: 86, heartRate: 141 },
    ],
  },
};

/** The query of a `#/…?…` fragment, or `undefined` with none. */
function queryOf(hash: string): URLSearchParams | undefined {
  const query = /^[^?]*\?([^#]*)/.exec(hash)?.[1];
  return query === undefined ? undefined : new URLSearchParams(query);
}

/** The scene the game's fragment asks for, or `undefined`: any name not in {@link CAPTURE_SCENES} is none. */
export function captureSceneFromHash(hash: string): CaptureScene | undefined {
  const name = queryOf(hash)?.get('capture');
  if (name === null || name === undefined || !Object.hasOwn(CAPTURE_SCENES, name)) {
    return undefined;
  }
  return CAPTURE_SCENES[name];
}

/**
 * The simulated rider a capture rides as: from the start line, in real time
 * (the capture tool's clock is what makes it a video's), at the script's
 * first power until the ride starts.
 */
export function captureRider(scene: CaptureScene): SimulatedRider {
  return {
    watts: scene.keys[0]?.watts ?? 0,
    speedup: 1,
    startMetres: undefined,
    capture: scene,
  };
}

/** What the script says at `second` of the ride, each reading a whole number. */
export function captureReadingAt(
  scene: CaptureScene,
  second: number,
): { readonly watts: number; readonly cadence: number; readonly heartRate: number } {
  const keys = scene.keys;
  const first = keys[0];
  if (first === undefined) return { watts: 0, cadence: 0, heartRate: 0 };
  let before = first;
  let after = first;
  for (const key of keys) {
    if (key.second <= second) before = key;
    if (key.second >= second) {
      after = key;
      break;
    }
    after = key;
  }
  const span = after.second - before.second;
  const share = span > 0 ? Math.min(1, Math.max(0, (second - before.second) / span)) : 0;
  const between = (from: number, to: number): number => Math.round(from + (to - from) * share);
  return {
    watts: between(before.watts, after.watts),
    cadence: between(before.cadence, after.cadence),
    heartRate: between(before.heartRate, after.heartRate),
  };
}

/**
 * The capture rider's sensors: the script, read on the ride's clock from the
 * instant the ride started ({@link start}). Before that, the script's first
 * second — the picker's reading, and the first frame's.
 */
export class CaptureSensors {
  readonly #scene: CaptureScene;
  #startedAtMs: number | undefined;

  constructor(scene: CaptureScene) {
    this.#scene = scene;
  }

  /** The ride started at `nowMs`: second nought of the script. */
  start(nowMs: number): void {
    this.#startedAtMs = nowMs;
  }

  /** What every sensor reads at `nowMs`: paired and live, all three. */
  read(nowMs: number): GameSensors {
    const second =
      this.#startedAtMs === undefined ? 0 : Math.max(0, (nowMs - this.#startedAtMs) / 1000);
    const reading = captureReadingAt(this.#scene, second);
    return {
      rider: { power: watts(reading.watts), live: true, paired: true },
      cadence: { value: reading.cadence, live: true, paired: true },
      heartRate: { value: reading.heartRate, live: true, paired: true },
    };
  }
}

/**
 * What a capture ride tells the capture tool after each frame, as
 * `window.__oylCapture`: how many frames drew the world, and where the ride
 * was on the last. Read by `tools/capture/render-capture.ts` and nothing in
 * the app.
 */
export interface CaptureSnapshot {
  /** Frames on which the world was drawn, from the ride's first. */
  readonly drawn: number;
  /** The rider's odometer, in metres. */
  readonly distance: number;
  /** The ride's elapsed seconds, on its own clock. */
  readonly elapsed: number;
}

/** Where {@link publishCaptureFrame} writes: the window, unless a test hands in another. */
export interface CaptureTarget {
  __oylCapture?: CaptureSnapshot;
}

/** Publish a frame of a capture ride. */
export function publishCaptureFrame(
  snapshot: CaptureSnapshot,
  target: CaptureTarget = globalThis as CaptureTarget,
): void {
  target.__oylCapture = snapshot;
}
