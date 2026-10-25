// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The demo player's ride: a preset's scripted riders (#1646) through the
 * product's own `GameSimulation` and `sceneFrame` — #1647.
 *
 * ## The lead rider rides the product's simulation
 *
 * The first rider of a preset is the HUD's and the camera's. Its scripted
 * power is handed to `GameSimulation.advanceTo` as a real rider's latest
 * reading is, and where it is drawn is `GameSimulation.drawnAt`'s interpolated
 * `DrawnRide`, exactly as `GameView` draws a rider. The other riders are
 * `runner.ts`' own, advanced through the same physics tick, and drawn as other
 * riders on the road (`SceneInput.remoteRiders`): `GameSimulation` has one
 * pacer slot, and the epic (#1643) leaves it one.
 *
 * ## Two clocks, and the one that stops
 *
 * The caller's clock — `performance.now()` in a browser, a stepped number in a
 * test or in the video render (#1655) — arrives as `nowMs`. The **ride clock**
 * is the sum of the caller's intervals while the player is playing, and it is
 * the only clock the simulation and the runner are ever handed. So a pause
 * stops the ride clock, and the simulation, which derives its steps from the
 * clock it is given, owes no step for the time it was paused: it resumes from
 * the distance it stopped at (`player.test.ts`).
 *
 * Nothing here reads a clock: `eslint.config.js` refuses `performance` and
 * `Date` in `src/demo/**\/*.ts`, so a preset is the same ride on every run.
 */

import { seconds, type RouteProfile } from '@onyourleft/domain';

import { simulatedCrankAngle } from '../game/bicycle';
import type { SceneFrame } from '../game/port';
import type { QualitySettings } from '../game/quality';
import { sceneFrame } from '../game/scene';
import type { GameSensors } from '../game/sensors';
import { GameSimulation, type GameState } from '../game/simulation';
import { corridorOrigin, type CorridorOrigin } from '../game/terrain';
import { createDemoRide, DEMO_RIDE_CONDITIONS, demoRoad, type DemoRide } from './runner';
import type { DemoPreset } from './script';

/** What the player is doing. A fresh player is `paused` at the start line; `stopped` is back there. */
export type DemoStatus = 'playing' | 'paused' | 'stopped';

/** A preset being played. */
export interface DemoPlayer {
  readonly preset: DemoPreset;
  /** The road every rider rides and the renderer draws. */
  readonly profile: RouteProfile;
  readonly status: DemoStatus;
  /** The lead rider's simulation state, as the HUD reads a real rider's. */
  readonly state: GameState;
  /**
   * The lead rider's scripted cadence and heart rate now, as the HUD reads a
   * real rider's sensors — #1650. Always live and paired: a demo never shows
   * "Sensor lost".
   */
  readonly sensors: GameSensors;
  /** Milliseconds of ride: the caller's clock, while playing, and only then. */
  readonly rideMs: number;
  play(): void;
  pause(): void;
  /** Stops the ride and puts every rider back on its start line. */
  stop(): void;
  /**
   * Advance the ride to the caller's clock at `nowMs`. Advances nothing unless
   * playing; the first call after play only notes the time.
   */
  advance(nowMs: number): void;
  /**
   * Forget the caller's last time, so the next advance rides none of the gap:
   * a page that was hidden, or scrolled out of view, was not ridden.
   */
  holdClock(): void;
  /** The frame to draw now, with the scenery budget of `rung`. Advances nothing. */
  frame(rung: Pick<QualitySettings, 'scatterItems' | 'structureItems' | 'people'>): SceneFrame;
}

interface Ride {
  readonly simulation: GameSimulation;
  readonly riders: DemoRide;
}

/**
 * Play `preset`. A player starts paused on its start line, on a still frame,
 * until it is told to play — which is what a visitor who asked for reduced
 * motion sees.
 */
export function createDemoPlayer(preset: DemoPreset): DemoPlayer {
  const profile = demoRoad(preset.route);
  const origin: CorridorOrigin = corridorOrigin(profile);
  const lead = preset.riders[0];
  if (lead === undefined) throw new RangeError('a demo preset must have at least one rider');

  const startRide = (): Ride => {
    const simulation = new GameSimulation({
      profile,
      conditions: DEMO_RIDE_CONDITIONS,
      startMetres: lead.startMetres,
    });
    const riders = createDemoRide(preset, profile);
    // The simulation's origin is ride time zero.
    simulation.advanceTo(0, riders.current().lead.rider);
    return { simulation, riders };
  };

  let ride = startRide();
  let status: DemoStatus = 'paused';
  let rideMs = 0;
  /** The caller's clock at the last advance while playing; unset when not playing. */
  let lastNowMs: number | undefined;

  return {
    preset,
    profile,
    get status() {
      return status;
    },
    get state() {
      return ride.simulation.state;
    },
    get sensors() {
      return ride.riders.current().lead;
    },
    get rideMs() {
      return rideMs;
    },
    play() {
      // The caller's clock is noted afresh by the next advance: pause and
      // stop forget it, and a fresh player never had it.
      status = 'playing';
    },
    pause() {
      if (status !== 'playing') return;
      status = 'paused';
      lastNowMs = undefined;
    },
    stop() {
      status = 'stopped';
      lastNowMs = undefined;
      rideMs = 0;
      ride = startRide();
    },
    advance(nowMs) {
      if (status !== 'playing') return;
      if (lastNowMs !== undefined && nowMs > lastNowMs) rideMs += nowMs - lastNowMs;
      lastNowMs = nowMs;
      const sampled = ride.riders.sample(seconds(rideMs / 1000));
      ride.simulation.advanceTo(rideMs, sampled.lead.rider);
    },
    holdClock() {
      lastNowMs = undefined;
    },
    frame(rung) {
      const drawn = ride.simulation.drawnAt(rideMs);
      const others = ride.riders.current().riders.slice(1);
      return sceneFrame({
        profile,
        origin,
        state: ride.simulation.state,
        riderDistance: drawn.riderDistance,
        scatterItems: rung.scatterItems,
        structureItems: rung.structureItems,
        people: rung.people,
        crankAngle: simulatedCrankAngle(drawn.riderDistance),
        pedalling: status === 'playing',
        remoteRiders: others.map((rider, index) => ({
          riderId: index + 1,
          distanceMetres: rider.state.distance,
          speedMetresPerSecond: rider.state.speed,
        })),
      });
    },
  };
}
