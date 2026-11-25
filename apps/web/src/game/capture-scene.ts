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
 * read only in the capture tool's own build ({@link CAPTURE_MODE}). In any
 * other build — every release — the query is read by nothing, the scenes
 * are not in the bundle, and the product build fails if they are
 * (`tools/capture/capture-stays-out.ts`), so a link carrying it opens an
 * ordinary ride: the review of PR #3160.
 *
 * The scene names a script of power, cadence and heart rate
 * ({@link CAPTURE_SCENES}); the rider still chooses the route and presses
 * *Ride*. The capture tool imports a synthetic route first and steps the
 * page's clocks (`tools/capture/capture-clock.ts`); this module never reads a
 * clock of its own, so the same ride is the same frames.
 *
 * ## Why it is harmless even in the capture build
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
 * which is why the mode exists only in a build made to film it.
 */

import { buildGhostTrack, watts, type GhostTrack } from '@onyourleft/domain';

import type { PreferenceStorage } from './hud/announce-preference';
import type { LapRaceChoice } from './lap-race/choice';
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

/**
 * What every scene's {@link CaptureScene.id} starts with — #3153, the review
 * of PR #3160. `tools/capture/capture-stays-out.ts` finds the scene table in a
 * chunk by this, never by a scene's name: names such as `delivery` and
 * `lap-race` are words the product bundle carries anyway.
 *
 * @unwired the mark is written out in every scene's id rather than built from
 * this, so the bundler keeps it literal; the build's check mirrors it in
 * Node, and `capture-stays-out.test.ts` holds the two to each other.
 */
export const CAPTURE_SCENE_MARK = 'oyl-capture-scene:';

/**
 * A scripted press, on the ride's own clock — #3153. Each is taken once, in
 * order, at the first frame at or after its {@link second} where it can be:
 *
 * - `throw`: *Throw* toward the next house (`delivery/throw-input.ts`), at
 *   the instant a parcel thrown then would land on its step, as a rider aims,
 *   so a script written in seconds lands where the seed put the houses;
 * - `item`: *Use item* in a lap race (`lap-race/ride-race.ts` §`askRaceItem`),
 *   once the rider holds one from a pick-up (a quarter of the way round a lap
 *   is the first, `@onyourleft/domain` §`PICK_UP_FRACTIONS`).
 */
export type CaptureCue =
  | { readonly kind: 'throw'; readonly second: number }
  | { readonly kind: 'item'; readonly second: number };

/**
 * A built-in workout ridden in the game — #3153: its Ride screen address
 * (`workouts/built-in-ride.ts` §`builtInRideFromQuery`, the query of
 * `#/ride?workout=built-in:<id>&length=&intensity=`), from {@link fromSeconds}
 * in, at {@link thresholdWatts}. The capture's trainer is the script's: it
 * holds the target, so the power read is the target (`capture-workout.ts`).
 */
export interface CaptureWorkoutScene {
  readonly query: string;
  readonly fromSeconds: number;
  readonly thresholdWatts: number;
}

/** A scene the capture tool can ask for by name. */
export interface CaptureScene {
  /** {@link CAPTURE_SCENE_MARK} and the scene's name, written out in full. */
  readonly id: string;
  /**
   * The script, in rising {@link CaptureKey.second}s from nought. Between two
   * keys each reading moves in a straight line; after the last it holds.
   */
  readonly keys: readonly CaptureKey[];
  /**
   * #3153: the built-in route the scene opens the game on — a level
   * (`level:<id>`) or a circuit (`circuit:<id>`), as `#/game?route=` names
   * it — with the name its *Ride* button reads. Absent, the capture tool's
   * own synthetic route (`tools/capture/capture-args.ts`).
   */
  readonly route?: { readonly id: string; readonly name: string } | undefined;
  /**
   * #3153: how far along the road the ride starts, metres — a simulated
   * ride's own start (`simulated-rider.ts` §`startMetres`), so a scene is
   * not a minute of riding to its first house. Absent, the start line.
   */
  readonly startMetres?: number | undefined;
  /**
   * #3153: the seed of the scene's Delivery round or lap race, which in every
   * other ride is drawn from `crypto.getRandomValues` at the press
   * (`delivery/targets.ts` §`drawRoundSeed`, `lap-race/ride-race.ts`
   * §`drawRaceSeed`). Only a capture can set one: this table is the only
   * place it comes from, and only the capture tool's build reads it.
   */
  readonly seed?: number | undefined;
  /** #3153: the scripted presses. @see CaptureCue */
  readonly cues?: readonly CaptureCue[] | undefined;
  /** #3153: the lap race the scene rides on its circuit, against seeded bots. */
  readonly lapRace?: LapRaceChoice | undefined;
  /** #3153: the built-in workout the scene rides. */
  readonly workout?: CaptureWorkoutScene | undefined;
  /** #3153: the pacer the scene rides with, at this many W/kg (`pacer-choice.ts`). */
  readonly pacer?: { readonly wattsPerKilogram: number } | undefined;
  /** #3153: whether the scene races the rider's own best — {@link captureGhostTrack}, never a recording. */
  readonly ghost?: boolean | undefined;
}

/**
 * The scenes, by the name the capture tool asks for. The numbers are a fit
 * amateur's, chosen rather than measured.
 *
 * - `route-hud`: a route ride with the full HUD (#3152), a steady build to a
 *   hard minute and an easing off, so every panel has something moving.
 * - `delivery` (#3153): the first built-in level (`delivery/levels/`), its
 *   round from a fixed seed, throwing at each house as it comes into reach.
 * - `lap-race` (#3153): a built-in circuit (`circuits/data/`) against five
 *   seeded bots, no instance, with an item used twice.
 * - `workout` (#3153): a tailored built-in workout, from just before its
 *   warm-up ends, so the first block change is in frame.
 * - `pacer` (#3153): beside the pacer, racing a bundled synthetic best.
 */
export const CAPTURE_SCENES: Readonly<Record<string, CaptureScene>> = {
  'route-hud': {
    id: 'oyl-capture-scene:route-hud',
    keys: [
      { second: 0, watts: 170, cadence: 82, heartRate: 118 },
      { second: 5, watts: 215, cadence: 88, heartRate: 131 },
      { second: 12, watts: 285, cadence: 94, heartRate: 149 },
      { second: 18, watts: 320, cadence: 97, heartRate: 158 },
      { second: 26, watts: 240, cadence: 90, heartRate: 155 },
      { second: 40, watts: 205, cadence: 86, heartRate: 141 },
    ],
  },
  delivery: {
    id: 'oyl-capture-scene:delivery',
    keys: [
      { second: 0, watts: 210, cadence: 86, heartRate: 124 },
      { second: 10, watts: 250, cadence: 90, heartRate: 138 },
      { second: 40, watts: 230, cadence: 88, heartRate: 142 },
    ],
    route: { id: 'level:morning-round', name: 'Morning Round' },
    startMetres: 680,
    // Chosen from the first two dozen for a round whose first two houses
    // come in the first 40 s and whose obstacles the straight line misses.
    seed: 9,
    cues: [0, 6, 12, 18, 24, 30, 36, 42].map((second) => ({ kind: 'throw' as const, second })),
  },
  'lap-race': {
    id: 'oyl-capture-scene:lap-race',
    keys: [
      { second: 0, watts: 240, cadence: 90, heartRate: 132 },
      { second: 8, watts: 310, cadence: 96, heartRate: 150 },
      { second: 20, watts: 280, cadence: 93, heartRate: 158 },
      { second: 40, watts: 260, cadence: 91, heartRate: 156 },
    ],
    route: { id: 'circuit:bellwether', name: 'Bellwether Loop' },
    seed: 3_153,
    lapRace: { laps: 2, bots: 5, tier: 'brisk', itemsOn: true },
    cues: [
      { kind: 'item', second: 8 },
      { kind: 'item', second: 16 },
    ],
  },
  workout: {
    id: 'oyl-capture-scene:workout',
    keys: [
      { second: 0, watts: 0, cadence: 88, heartRate: 128 },
      { second: 20, watts: 0, cadence: 92, heartRate: 146 },
    ],
    workout: {
      query: 'workout=built-in:sweet-spot-3x12&length=45&intensity=5',
      fromSeconds: 590,
      thresholdWatts: 250,
    },
  },
  pacer: {
    id: 'oyl-capture-scene:pacer',
    keys: [
      { second: 0, watts: 200, cadence: 86, heartRate: 128 },
      { second: 10, watts: 245, cadence: 91, heartRate: 140 },
      { second: 25, watts: 225, cadence: 89, heartRate: 146 },
    ],
    pacer: { wattsPerKilogram: 3.1 },
    ghost: true,
  },
};

/**
 * The Vite mode of the capture tool's build (`vite build --mode capture`,
 * `package.json` §`capture`), and of no other: a release build is
 * `production`, so in one {@link captureSceneFromHash} is always `undefined`
 * and `?capture=` is a parameter nothing reads.
 */
export const CAPTURE_MODE = 'capture';

/** The query of a `#/…?…` fragment, or `undefined` with none. */
function queryOf(hash: string): URLSearchParams | undefined {
  const query = /^[^?]*\?([^#]*)/.exec(hash)?.[1];
  return query === undefined ? undefined : new URLSearchParams(query);
}

/**
 * The scene the game's fragment asks for, or `undefined`: any name not in
 * {@link CAPTURE_SCENES} is none, and so is every name outside a build made in
 * {@link CAPTURE_MODE}.
 */
export function captureSceneFromHash(hash: string): CaptureScene | undefined {
  // ⚠️ Inline, and read nowhere else: the bundler writes the build's mode in
  // here, so outside a capture build this is `return undefined` and the
  // scenes are dropped from the bundle (`tools/capture/capture-stays-out.ts`).
  if (import.meta.env.MODE !== CAPTURE_MODE) return undefined;
  const name = queryOf(hash)?.get('capture');
  if (name === null || name === undefined || !Object.hasOwn(CAPTURE_SCENES, name)) {
    return undefined;
  }
  return CAPTURE_SCENES[name];
}

/**
 * The simulated rider a capture rides as: from the scene's start, in real time
 * (the capture tool's clock is what makes it a video's), at the script's
 * first power until the ride starts.
 */
export function captureRider(scene: CaptureScene): SimulatedRider {
  return {
    watts: scene.keys[0]?.watts ?? 0,
    speedup: 1,
    startMetres: scene.startMetres,
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
  readonly #held: ((second: number) => number | undefined) | undefined;
  #startedAtMs: number | undefined;

  /**
   * @param held #3153: on a workout scene, what the capture's trainer holds
   * at a second of the ride (`capture-workout.ts`): the power read then, in
   * place of the script's, as an ERG trainer makes it. `undefined` at a
   * second with no target is the script's.
   */
  constructor(scene: CaptureScene, held?: (second: number) => number | undefined) {
    this.#scene = scene;
    this.#held = held;
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
    const held = this.#held?.(second);
    return {
      rider: { power: watts(Math.round(held ?? reading.watts)), live: true, paired: true },
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
  /**
   * #3153: what happened in the ride, at the frame it happened on
   * ({@link CaptureLog}): two captures of one scene are the same ride when
   * these are equal. Absent on a frame published before the log existed.
   */
  readonly events?: readonly CaptureEvent[] | undefined;
}

/**
 * One thing a capture ride did — #3153.
 *
 * - `round`: the Delivery round began, from `seed`, on these houses (each
 *   where it stands along the road, whole metres, in route order).
 * - `race`: the lap race began, from `seed`, with this field.
 * - `cue`: a scripted press ({@link CaptureCue}) was made; `taken` is whether
 *   the ride took it (a throw resolved to a side; an item use asked of a race).
 * - `score`: the round's score moved to this.
 * - `lap`: the rider crossed the course's line, ending this many laps.
 * - `block`: the workout moved to this block.
 */
export type CaptureHappening =
  | { readonly kind: 'round'; readonly seed: number; readonly houses: readonly number[] }
  | { readonly kind: 'race'; readonly seed: number; readonly field: readonly string[] }
  | {
      readonly kind: 'cue';
      readonly cue: CaptureCue['kind'];
      readonly second: number;
      readonly taken: boolean;
    }
  | { readonly kind: 'score'; readonly score: number }
  | { readonly kind: 'lap'; readonly lap: number }
  | { readonly kind: 'block'; readonly block: number };

/**
 * A {@link CaptureHappening} and the frame it happened on: how many frames had
 * drawn the world when it did, so `0` is before the first.
 */
export type CaptureEvent = CaptureHappening & { readonly frame: number };

/**
 * A capture ride's frames and {@link CaptureEvent}s — #3153: one per ride,
 * made at the press. The frames are counted here, so the frame an event is
 * stamped with is the one the capture tool counts.
 */
export class CaptureLog {
  readonly #events: CaptureEvent[] = [];
  #drawn = 0;

  /** Frames that have drawn the world, from the ride's first. */
  get drawn(): number {
    return this.#drawn;
  }

  /** A frame drew the world. */
  drew(): void {
    this.#drawn += 1;
  }

  /** Keep `happening`, at the frame the ride is on. */
  note(happening: CaptureHappening): void {
    this.#events.push({ ...happening, frame: this.#drawn });
  }

  /** A copy, so a published frame is not changed by the next. */
  events(): readonly CaptureEvent[] {
    return [...this.#events];
  }
}

/** The least time between two scripted presses, seconds: one press is one press, never a burst. */
export const CAPTURE_CUE_SPACING_SECONDS = 1;

/**
 * The scripted presses still to make, in order — #3153. {@link due} hands
 * back the next one once the ride is at its second, and at least
 * {@link CAPTURE_CUE_SPACING_SECONDS} after the last; the ride says when it
 * made it ({@link taken}), and a throw it could not make yet is asked again
 * on the next frame, until it can.
 */
export class CaptureCues {
  readonly #cues: readonly CaptureCue[];
  #next = 0;
  #lastAt = -Infinity;

  constructor(scene: CaptureScene) {
    this.#cues = scene.cues ?? [];
  }

  /** The next press, if the ride has reached its second. */
  due(second: number): CaptureCue | undefined {
    const cue = this.#cues[this.#next];
    return cue !== undefined &&
      second >= cue.second &&
      second >= this.#lastAt + CAPTURE_CUE_SPACING_SECONDS
      ? cue
      : undefined;
  }

  /** The press {@link due} handed back was made at `second` of the ride. */
  taken(second: number): void {
    this.#next += 1;
    this.#lastAt = second;
  }
}

/**
 * The storage a capture keeps Delivery's week, the levels finished and the
 * assist settings in — #3153: in memory, empty at the press, and gone with
 * the screen, so a capture reads none of this device's and writes none.
 */
export function captureStorage(): PreferenceStorage {
  const kept = new Map<string, string>();
  return {
    getItem: (key) => kept.get(key) ?? null,
    setItem: (key, value) => {
      kept.set(key, value);
    },
  };
}

/**
 * The rider's "own best" on a scene that races it — #3153: a bundled
 * synthetic ride, never a recorded one. A steady 8.6 m/s (31 km/h) for an
 * hour, so the HUD's gap reading moves with the script's power.
 */
export function captureGhostTrack(): GhostTrack {
  const elapsedSeconds: number[] = [];
  const distanceMetres: number[] = [];
  for (let second = 0; second <= 3_600; second += 1) {
    elapsedSeconds.push(second);
    distanceMetres.push(second * 8.6);
  }
  return buildGhostTrack({ elapsedSeconds, distanceMetres });
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
