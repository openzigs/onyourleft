// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The screen a rider actually reaches — #85's game, wired to a route.
 *
 * ⚠️ **This file exists because everything else in `game/` was unreachable
 * without it.** The simulation, the corridor, the quality ladder, the scene and
 * the HUD were all built, tested and green — and `three` did not appear in the
 * shipped bundle at all, because nothing in `shell/routes.ts` imported any of
 * it. A tree-shaken renderer passes every test it has and ships nothing, which
 * is a quieter version of the same failure `apps/mobile` would have had if the
 * renderer had gone there (§4h).
 *
 * ## What this component owns, and what it refuses to own
 *
 * It owns the **loop**: a `requestAnimationFrame` that advances the simulation
 * to the current instant and then draws. It does **not** own the simulation's
 * clock — `GameSimulation.advanceTo` takes wall-clock time and derives its own
 * step count, so a frame that arrives late or not at all cannot change where the
 * rider ends up. That separation is #91's second criterion and `simulation.ts`
 * explains it at length; this file is the caller that must not undo it.
 *
 * It also refuses to construct its own store, transport or renderer. All three
 * arrive as props, for the reason `AppShell.tsx` gives about every other screen:
 * the accessibility suite renders this route on a machine with no WebGL, no
 * Bluetooth adapter and no IndexedDB worth the name, and a component that built
 * its own could not be rendered there at all.
 */

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import { HudPanel } from './hud/HudPanel';
import { NO_SCREEN_LOCK, type ScreenLock, type ScreenLockSource } from './hud/wake-lock';
import { INITIAL_QUALITY, nextQuality, qualitySettings, type QualityState } from './quality';
import { sceneFrame } from './scene';
import { GameSimulation, atStartLine, type GameState } from './simulation';
import { corridorOrigin } from './terrain';
import type { GameRenderer, GameView as RendererView } from './port';
import { NO_SENSORS, type GameSensors } from './sensors';
import {
  altitudeMetres,
  degreesCelsius,
  kilograms,
  type GhostTrack,
  type RouteProfile,
} from '@onyourleft/domain';
import { airDensityKilogramsPerCubicMetre, type RideConditions } from '@onyourleft/physics';

/** One route the rider could ride, as the picker needs it. */
export interface RidableRoute {
  readonly id: string;
  readonly name: string;
  readonly profile: RouteProfile;
  /**
   * How many previous attempts this rider has on it.
   *
   * ⚠️ A **count**, not the attempts themselves. #93's fourth criterion is that
   * a rider with no previous attempt sees the ghost option *absent or disabled
   * with an explanation*, and answering that needs only a number — loading every
   * attempt's stream to render a list would be a stream decode per route, which
   * is the read budget every other screen in this app is careful about.
   */
  readonly attempts: number;
}

/** What the game screen needs from the rest of the app. */
export interface GamePort {
  /** The rider's saved routes (#89, #73). */
  listRoutes(): Promise<readonly RidableRoute[]>;
  /**
   * The ghost for the rider's best previous attempt on a route, if any.
   *
   * ⚠️ Returns `undefined` rather than throwing when there is none. The
   * athlete-scoping that makes this the rider's **own** attempt is in
   * `ActivityStore.listRouteAttempts`, whose index cannot be queried without an
   * athlete — see `packages/domain/src/ghost/replay.ts` for why it is there and
   * not in the replay code.
   */
  loadGhost(routeId: string): Promise<GhostTrack | undefined>;
  /**
   * The rider's live sensor readings, sampled per frame.
   *
   * Returns `GameSensors` rather than a bag of numbers so the three-state
   * distinction survives the trip — `sensors.ts` explains why "nobody paired a
   * strap" and "the strap dropped" must not render alike.
   */
  readSensors(): GameSensors;
}

export interface GameViewProps {
  readonly port?: GamePort | undefined;
  /**
   * Loads the renderer, lazily.
   *
   * ⚠️ A loader rather than the renderer itself, following `map={loadMapPort}`
   * and for the same reason: `three` is about 600 kB, and a rider who never
   * opens this screen — every rider on the Phase 1 web milestone — must never
   * download it. `pnpm run build` shows the split, and this is the line that
   * causes it: importing `three-renderer.ts` at module scope here would fold it
   * into the entry chunk and no amount of comment would undo that.
   */
  readonly renderer?: (() => Promise<GameRenderer>) | undefined;
  readonly screenLock?: ScreenLockSource | undefined;
  /** Injected so a test can drive the loop without a real animation frame. */
  readonly now?: (() => number) | undefined;
}

type Phase = 'choosing' | 'riding' | 'paused';

export function GameView(props: GameViewProps): JSX.Element {
  const [routes, setRoutes] = useState<readonly RidableRoute[] | undefined>(undefined);
  const [chosen, setChosen] = useState<RidableRoute | undefined>(undefined);
  const [withGhost, setWithGhost] = useState(false);
  const [phase, setPhase] = useState<Phase>('choosing');
  const [state, setState] = useState<GameState | undefined>(undefined);
  const [quality, setQuality] = useState<QualityState>(INITIAL_QUALITY);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simulationRef = useRef<GameSimulation | undefined>(undefined);
  const viewRef = useRef<RendererView | undefined>(undefined);
  const ghostRef = useRef<GhostTrack | undefined>(undefined);
  const lockRef = useRef<ScreenLock>(NO_SCREEN_LOCK);

  const port = props.port;

  useEffect(() => {
    if (port === undefined) {
      setRoutes([]);
      return;
    }
    let cancelled = false;
    void port.listRoutes().then((found) => {
      if (!cancelled) {
        setRoutes(found);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [port]);

  /**
   * Releases the screen lock and the GL context.
   *
   * ⚠️ Called from the effect's cleanup as well as from "End ride", because a
   * rider who navigates away has ended the ride just as surely as one who
   * pressed the button — and #94's sixth criterion is about the lock being
   * released, not about which path released it. A leaked lock flattens the
   * battery with nothing on screen to explain it.
   */
  const teardown = useCallback(() => {
    void lockRef.current.release();
    lockRef.current = NO_SCREEN_LOCK;
    viewRef.current?.destroy();
    viewRef.current = undefined;
    simulationRef.current = undefined;
  }, []);

  useEffect(() => teardown, [teardown]);

  const start = useCallback(
    async (route: RidableRoute, ghost: boolean): Promise<void> => {
      const profile = route.profile;
      ghostRef.current = ghost && port !== undefined ? await port.loadGhost(route.id) : undefined;
      simulationRef.current = new GameSimulation({
        profile,
        conditions: RIDE_CONDITIONS,
      });
      setState(atStartLine(profile));
      setChosen(route);
      setPhase('riding');
      lockRef.current = (await props.screenLock?.acquire()) ?? NO_SCREEN_LOCK;
    },
    [port, props.screenLock],
  );

  // The loop. Deliberately the only place `requestAnimationFrame` appears.
  useEffect(() => {
    if (phase !== 'riding' || chosen === undefined || port === undefined) {
      return;
    }
    const clock = props.now ?? (() => performance.now());
    let frame = 0;
    let lastFrameAt = clock();

    const canvas = canvasRef.current;
    const load = props.renderer;
    if (canvas !== null && viewRef.current === undefined && load !== undefined) {
      // Awaited without blocking the loop: the first frames draw nothing and the
      // simulation advances regardless, which is exactly the decoupling
      // `simulation.ts` is about. A rider whose GPU is slow to hand over a
      // context still gets a HUD and a ride.
      void load().then((renderer) => {
        if (viewRef.current === undefined) {
          viewRef.current = renderer.create(canvas, qualitySettings(quality.level));
          viewRef.current.resize(canvas.clientWidth || 320, canvas.clientHeight || 180);
        }
      });
    }

    const tick = (): void => {
      const simulation = simulationRef.current;
      if (simulation === undefined) {
        return;
      }
      const at = clock();
      simulation.advanceTo(at, port.readSensors().rider);
      setState(simulation.state);

      const origin = corridorOrigin(chosen.profile);
      viewRef.current?.render(
        sceneFrame({
          profile: chosen.profile,
          origin,
          state: simulation.state,
          ghost: ghostRef.current,
        }),
      );

      // The measurement `quality.ts` decides from. Taken here because this is
      // the only place that knows how long a frame took.
      setQuality((previous) => nextQuality(previous, { frameMs: at - lastFrameAt }));
      lastFrameAt = at;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
    // ⚠️ `quality` is read inside `tick` and is deliberately NOT a dependency.
    // Re-running this effect on every quality change would cancel the frame,
    // destroy the renderer and rebuild it mid-ride — and quality changes exactly
    // when the phone is least able to afford that. It is read through
    // `setQuality`'s updater form, which does not close over a stale value, and
    // the level is applied to the live renderer by the effect below instead.
  }, [phase, chosen, port, props.renderer, props.now]);

  useEffect(() => {
    viewRef.current?.setQuality(qualitySettings(quality.level));
  }, [quality.level]);

  if (phase === 'choosing' || chosen === undefined || state === undefined) {
    return (
      <RoutePicker routes={routes} withGhost={withGhost} onGhost={setWithGhost} onStart={start} />
    );
  }

  const sensors = port?.readSensors() ?? NO_SENSORS;
  return (
    <section className="oyl-game" aria-label="Trainer game">
      <canvas
        ref={canvasRef}
        className="oyl-game__world"
        // The world is decorative in the accessibility sense: everything it
        // conveys is also in the HUD below it, as text. Marking it so is more
        // honest than an alt text describing a scene that changes every frame.
        aria-hidden="true"
      />
      <HudPanel
        profile={chosen.profile}
        state={state}
        cadence={sensors.cadence}
        heartRate={sensors.heartRate}
        paused={phase === 'paused'}
        onPause={() => {
          setPhase((current) => (current === 'paused' ? 'riding' : 'paused'));
        }}
        onEnd={() => {
          teardown();
          setPhase('choosing');
          setChosen(undefined);
        }}
      />
    </section>
  );
}

/** Choosing a route, and whether to race yourself on it. */
function RoutePicker(props: {
  readonly routes: readonly RidableRoute[] | undefined;
  readonly withGhost: boolean;
  readonly onGhost: (value: boolean) => void;
  readonly onStart: (route: RidableRoute, ghost: boolean) => Promise<void>;
}): JSX.Element {
  if (props.routes === undefined) {
    return <p>Loading your routes…</p>;
  }
  if (props.routes.length === 0) {
    return (
      <p>No saved routes yet. Import a GPX route on the Routes screen and it will appear here.</p>
    );
  }
  return (
    <div className="oyl-game__picker">
      <h2>Choose a route</h2>
      <ul>
        {props.routes.map((route) => (
          <li key={route.id}>
            <span>{route.name}</span>
            <label>
              <input
                type="checkbox"
                checked={props.withGhost}
                disabled={route.attempts === 0}
                onChange={(event) => {
                  props.onGhost(event.target.checked);
                }}
              />
              {/*
                #93's fourth criterion: a rider with no previous attempt gets the
                option DISABLED WITH AN EXPLANATION, rather than an empty ghost
                sitting on the start line pretending to be a rider.
              */}
              {route.attempts === 0
                ? 'Race your best — ride it once first'
                : 'Race your own best attempt'}
            </label>
            <button
              type="button"
              onClick={() => {
                void props.onStart(route, props.withGhost && route.attempts > 0);
              }}
            >
              Ride {route.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The rider's conditions.
 *
 * ⚠️ A placeholder, and it is one on purpose rather than by omission: mass and
 * air density belong to the athlete and to where they are, and neither has a
 * home in the store yet — `AthleteRecord.mass` exists (schema 6) but nothing
 * writes it, and there is no altitude at all. Wiring those is its own change.
 * Until then a 80 kg rider at sea level is stated here where it can be found,
 * rather than buried at the call site.
 */
const RIDE_CONDITIONS: RideConditions = {
  totalMass: kilograms(80),
  airDensityKilogramsPerCubicMetre: airDensityKilogramsPerCubicMetre(
    altitudeMetres(0),
    degreesCelsius(15),
  ),
};
