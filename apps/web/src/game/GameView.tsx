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

import { gapAgainst, type ChasedGap } from './hud/fields';
import { HudPanel } from './hud/HudPanel';
import { NO_SCREEN_LOCK, type ScreenLock, type ScreenLockSource } from './hud/wake-lock';
import { DEFAULT_PACER_INTENSITY, pacerChoice, type PacerChoice } from './pacer-choice';
import { INITIAL_QUALITY, nextQuality, qualitySettings, type QualityState } from './quality';
import { RIDE_CONDITIONS } from './rider';
import { sceneFrame } from './scene';
import { GameSimulation, type GameState } from './simulation';
import { corridorOrigin } from './terrain';
import type { GameRenderer, GameView as RendererView } from './port';
import { NO_SENSORS, type GameSensors } from './sensors';
import {
  MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM,
  MINIMUM_INTENSITY_WATTS_PER_KILOGRAM,
  ghostDistanceAt,
  pacerGap,
  seconds,
  type BotPacerPlan,
  type GhostTrack,
  type RouteProfile,
} from '@onyourleft/domain';

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

/**
 * The id the pacer refusal is announced under, and referred to from both the
 * control that caused it and every control it blocks (#255).
 *
 * ⚠️ **A module constant rather than `useId`, and that is a decision.** The
 * refusal is referenced from two *different* components — the intensity box
 * inside {@link PacerControls} and every ride button inside
 * {@link RoutePicker} — so a generated id would have to be threaded through
 * both, and a mismatch would be a **dangling `aria-describedby`**: the one
 * failure `a11y/audit.ts`'s `aria-reference-resolves` rule exists to catch, and
 * silent to everyone who is not using a screen reader. A constant cannot
 * collide because the picker is rendered at most once — this screen has exactly
 * one intensity control, and `PacerControls`'s own header says why it is above
 * the list rather than in it.
 */
const PACER_PROBLEM_ID = 'oyl-game-pacer-problem';

export function GameView(props: GameViewProps): JSX.Element {
  const [routes, setRoutes] = useState<readonly RidableRoute[] | undefined>(undefined);
  const [chosen, setChosen] = useState<RidableRoute | undefined>(undefined);
  const [withGhost, setWithGhost] = useState(false);
  const [withPacer, setWithPacer] = useState(false);
  const [intensity, setIntensity] = useState(String(DEFAULT_PACER_INTENSITY));
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
    async (route: RidableRoute, ghost: boolean, pacer: BotPacerPlan | undefined): Promise<void> => {
      const profile = route.profile;
      ghostRef.current = ghost && port !== undefined ? await port.loadGhost(route.id) : undefined;
      const simulation = new GameSimulation({
        profile,
        conditions: RIDE_CONDITIONS,
        ...(pacer === undefined ? {} : { pacer }),
      });
      simulationRef.current = simulation;
      // ⚠️ The simulation's own state rather than `atStartLine(profile)`, which
      // is what this used to be. The two agreed about the rider and could not
      // agree about the bot — `atStartLine` takes a profile and knows nothing
      // about a pacer — so the first frame of every paced ride would have drawn
      // no bot and shown a dash where the gap goes. Reading the one object that
      // has the answer is cheaper than teaching a second one to guess it.
      setState(simulation.state);
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
      const bot = simulation.state.bot;
      viewRef.current?.render(
        sceneFrame({
          profile: chosen.profile,
          origin,
          state: simulation.state,
          // #237: the bot's odometer, straight off the state the simulation just
          // advanced. `SceneInput.botDistance` was declared and optional and
          // never supplied, which is why a built, tested and green pacer drew
          // nothing on a real 47.53 km route.
          ...(bot === undefined ? {} : { botDistance: bot.state.distance }),
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
      <RoutePicker
        routes={routes}
        withGhost={withGhost}
        onGhost={setWithGhost}
        withPacer={withPacer}
        onPacer={setWithPacer}
        intensity={intensity}
        onIntensity={setIntensity}
        choice={pacerChoice(withPacer, intensity)}
        onStart={start}
      />
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
        chases={chasedGaps(state, ghostRef.current)}
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

/**
 * The gap to everyone the rider is racing — the bot, the ghost, or both.
 *
 * ⚠️ **Both, when the rider asked for both, and #253's second half is that this
 * used to return only the bot's.** The two choices are independent on the route
 * picker, so the path is reachable and a rider taking it was shown the pacer's
 * number under the pacer's label and nothing at all about the attempt they had
 * chosen to race.
 *
 * ⚠️ **Built from the ride state and nothing else**, through `pacer/gap.ts`'s
 * two unwrapped odometers — which is #237's fourth criterion, and the reason a
 * bot a full lap ahead reads as a lap ahead rather than as level with you.
 * `gapAgainst` assembles the input from the same `GameState` the markers are
 * placed from, so the number in the HUD and the shape on the road cannot
 * disagree; `scene.ts` §`nearestPoint` is the other half of that promise and
 * says why the wrap belongs there and not here.
 *
 * The ghost's distance is read **at this elapsed time**, by the same call
 * `scene.ts` places its marker with — a ghost is raced rather than replayed
 * beside you, so "where is it now" is a question about the clock.
 */
function chasedGaps(state: GameState, ghost: GhostTrack | undefined): readonly ChasedGap[] {
  const found: ChasedGap[] = [];
  const bot = state.bot;
  if (bot !== undefined) {
    found.push({ to: 'bot', gap: pacerGap(gapAgainst(state, bot.state.distance)) });
  }
  if (ghost !== undefined) {
    const at = ghostDistanceAt(ghost, seconds(Math.max(0, state.elapsed)));
    found.push({ to: 'ghost', gap: pacerGap(gapAgainst(state, at)) });
  }
  return found;
}

/** Choosing a route, whether to race yourself on it, and whether to be paced. */
function RoutePicker(props: {
  readonly routes: readonly RidableRoute[] | undefined;
  readonly withGhost: boolean;
  readonly onGhost: (value: boolean) => void;
  readonly withPacer: boolean;
  readonly onPacer: (value: boolean) => void;
  readonly intensity: string;
  readonly onIntensity: (value: string) => void;
  readonly choice: PacerChoice;
  readonly onStart: (
    route: RidableRoute,
    ghost: boolean,
    pacer: BotPacerPlan | undefined,
  ) => Promise<void>;
}): JSX.Element {
  if (props.routes === undefined) {
    return <p>Loading your routes…</p>;
  }
  if (props.routes.length === 0) {
    return (
      <p>No saved routes yet. Import a GPX route on the Routes screen and it will appear here.</p>
    );
  }
  // ⚠️ The ride control is BLOCKED rather than silently dropping the pacer.
  // Starting a ride that quietly has no bot in it, because the number in the box
  // could not make one, is the same defect #237 is about arriving from the other
  // side — and this time the rider would have asked for it.
  const refused = props.choice.problem !== undefined;
  return (
    <div className="oyl-game__picker">
      <h2>Choose a route</h2>
      <PacerControls
        withPacer={props.withPacer}
        onPacer={props.onPacer}
        intensity={props.intensity}
        onIntensity={props.onIntensity}
        problem={props.choice.problem}
      />
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
            {/*
              ⚠️ **`aria-disabled`, deliberately, and not the `disabled`
              attribute** — #255's second defect. The attribute removes every
              ride button on the screen from the tab order, so a rider who slips
              a decimal point tabs from the intensity box straight past all of
              them to whatever follows, with no indication that the controls
              they were heading for exist at all. `aria-disabled` keeps the
              button reachable and announced as unavailable, and
              {@link PACER_PROBLEM_ID} tells it *why* — so the control that is
              blocked says it is blocked, rather than only the field that
              blocked it.

              The refusal itself is unchanged: `onStart` is not called. A
              guard in the handler is what enforces that now, because
              `aria-disabled` is a promise to a screen reader and nothing
              whatever to a click.
            */}
            <button
              type="button"
              aria-disabled={refused ? true : undefined}
              aria-describedby={refused ? PACER_PROBLEM_ID : undefined}
              onClick={() => {
                if (refused) {
                  return;
                }
                void props.onStart(route, props.withGhost && route.attempts > 0, props.choice.plan);
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
 * Whether to be paced, and how hard.
 *
 * Once above the list rather than once per route, unlike the ghost control: a
 * ghost belongs to a particular route — it is *your* previous attempt on *that*
 * road — and a pacer belongs to the ride. Rendering the intensity box per route
 * would put several identically-labelled number inputs on one screen, which is
 * a worse answer for anybody reading the page with a screen reader than one
 * control that plainly governs the whole list.
 */
function PacerControls(props: {
  readonly withPacer: boolean;
  readonly onPacer: (value: boolean) => void;
  readonly intensity: string;
  readonly onIntensity: (value: string) => void;
  readonly problem: string | undefined;
}): JSX.Element {
  return (
    <div className="oyl-game__pacer">
      <label>
        <input
          type="checkbox"
          checked={props.withPacer}
          onChange={(event) => {
            props.onPacer(event.target.checked);
          }}
        />
        Ride against a pacer
      </label>
      <label>
        Pacer intensity, watts per kilogram
        <input
          type="number"
          // `inputMode` rather than only `type`, because this is read and typed
          // on a phone clamped to a handlebar: a decimal keypad is the
          // difference between 2.5 and 25 at the moment a rider is setting up.
          inputMode="decimal"
          min={MINIMUM_INTENSITY_WATTS_PER_KILOGRAM}
          max={MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM}
          step={0.1}
          value={props.intensity}
          // ⚠️ **The two attributes that make the refusal part of the control
          // rather than text near it — #255.** A `role="alert"` is announced
          // once, when it appears. A rider who tabs *back* to this box
          // afterwards heard "Pacer intensity, watts per kilogram, 70" and
          // nothing about why nothing worked; `aria-describedby` is what makes
          // the reason travel with the field, every time it is reached, and
          // `aria-invalid` is what says the value in it is the problem.
          aria-invalid={props.problem === undefined ? undefined : true}
          aria-describedby={props.problem === undefined ? undefined : PACER_PROBLEM_ID}
          onChange={(event) => {
            props.onIntensity(event.target.value);
          }}
        />
      </label>
      {/*
        ⚠️ `min`/`max` above are a hint to the browser and nothing more — they
        are trivially bypassed by typing, and they do not exist at all for the
        rider who pastes. The refusal that counts is `pacerChoice`'s, which is
        `botPacerPlan`'s own bounds, and it is what blocks the ride control.

        Rendered only when there is a problem, which is also what keeps the two
        `aria-describedby` references above and in `RoutePicker` from dangling:
        the attribute and the element it names appear and disappear together,
        under the same condition.
      */}
      {props.problem === undefined ? null : (
        <p className="oyl-game__problem" id={PACER_PROBLEM_ID} role="alert">
          {props.problem}
        </p>
      )}
    </div>
  );
}
