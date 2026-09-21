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

import { riderMassFor } from '../athlete/mass';
import { StatusMessage } from '../design/StatusMessage';
import { NO_ROUTES_YET } from '../routes/two-importers';
import { hrefFor, routeById, ROUTE_BUILDER_ROUTE } from '../shell/routes';
import { advanceCrank } from './bicycle';
import { settleGhostOutcome, type GhostOutcome } from './ghost-outcome';
import { gapAgainst, type ChasedGap, type TrainerLine } from './hud/fields';
import { HudPanel } from './hud/HudPanel';
import { NO_SCREEN_LOCK, type ScreenLock, type ScreenLockSource } from './hud/wake-lock';
import { DEFAULT_PACER_INTENSITY, pacerChoice, type PacerChoice } from './pacer-choice';
import {
  DEFAULT_WIND_FROM_BEARING,
  MAXIMUM_BEARING_DEGREES,
  windChoice,
  type WindChoice,
  type WindProblemField,
} from './wind-choice';
import { INITIAL_QUALITY, nextQuality, qualitySettings, type QualityState } from './quality';
import { createGradientSession, type GradientSession, type GradientSessionState } from './gradient';
import {
  NO_GAME_TRAINER,
  trainerRoadNotice,
  type GameTrainer,
  type GameTrainerPort,
} from './trainer-port';
import {
  DEFAULT_RIDING_POSITION,
  RIDING_POSITIONS,
  RIDING_POSITION_ORDER,
  rideConditionsFor,
  type RidingPosition,
} from './rider';
import { sceneFrame } from './scene';
import { GameSimulation, ghostClock, type GameState } from './simulation';
import { corridorOrigin } from './terrain';
import type { GameRenderer, GameView as RendererView } from './port';
import { NO_SENSORS, type GameSensors } from './sensors';
import { speedUnit, spokenDistanceUnit } from '../units/format';
import { announce, INITIAL_ANNOUNCER, remainingFrom, type AnnouncerState } from './hud/announce';
import { slopeEvent, slopesOf, type Slope, type SlopeAnnounced } from './hud/climb-ahead';
import type { CueOutput } from './audio-port';
import { RideCues } from './audio-cues';
import {
  DEFAULT_CUES,
  readCuePreference,
  writeCuePreference,
  type CuePreference,
} from './cue-preference';
import { SoundControls } from './SoundControls';
import { sharedCueOutput } from './web-audio';
import {
  DEFAULT_ANNOUNCEMENTS,
  deviceStorage,
  readAnnouncementPreference,
  type AnnouncementPreference,
} from './hud/announce-preference';
import { hudReadings } from './hud/fields';
import { useUnits } from '../units/context';
import {
  MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM,
  MINIMUM_INTENSITY_WATTS_PER_KILOGRAM,
  ghostDistanceAt,
  pacerGap,
  type BotPacerPlan,
  type GhostTrack,
  type Kilograms,
  type RouteProfile,
  type Wind,
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
  /**
   * What the rider weighs, from the athlete row (#325).
   *
   * ⚠️ **The athlete's own mass, not `RideConditions.totalMass`.** The bicycle
   * is added by `rider.ts` §`rideConditionsFor` and only there, because the two
   * are different quantities and `AthleteRecord.mass` is the first.
   *
   * `undefined` is an ordinary state — a rider who has never entered one, or a
   * browser with no athlete row — and it means the documented default is
   * ridden. The substitution is `athlete/mass.ts` §`riderMassFor` and happens
   * nowhere else, so this prop stays honestly optional all the way down rather
   * than arriving pre-defaulted by whichever caller thought of it first.
   *
   * ⚠️ **A prop rather than a `GamePort` read**, and not an accident: the shell
   * holds the live value so that a rider who changes their weight on the
   * settings screen and then opens the game is ridden at the new one without a
   * reload, and a per-frame or per-ride store read would be a second answer to
   * a question the shell already has. `AppShellProps.riderMass` is the other
   * half.
   */
  readonly riderMass?: Kilograms | undefined;
  /**
   * The trainer this ride may send the road to — #362.
   *
   * ⚠️ **Optional, and its absence is the ordinary browser case.** The
   * accessibility suite renders this route with no ports at all, and a rider on
   * a power meter has no trainer to drive; both arrive here as `undefined` and
   * both ride a road nothing is told about. What is *not* ordinary is a rider
   * whose trainer is paired, controllable and refusing gradients without being
   * told — `trainer-port.ts` §`trainerRoadNotice` is the sentence for each of
   * those, and {@link GameTrainerKind} is why there are four of them rather
   * than a boolean.
   */
  readonly trainer?: GameTrainerPort | undefined;
  /** Injected so a test can drive the loop without a real animation frame. */
  readonly now?: (() => number) | undefined;
  /**
   * Where the ride's non-speech sounds go — #400. The platform's own Web Audio
   * (`web-audio.ts` §`sharedCueOutput`) unless a test hands in a double; the
   * default IS the production wiring, so a shell that passes nothing still
   * sounds, and jsdom — which has no Web Audio — gets a silent no-op.
   */
  readonly sounds?: CueOutput | undefined;
  /**
   * Told when a ride takes the screen over, and when it hands it back — #423.
   *
   * While a ride runs the world is full-bleed and the page chrome — the app
   * header, the navigation, the route's `h1` and its summary, the footer — is
   * **absent**, not covered. This is how the shell finds out: `true` when a
   * ride starts, `false` when it ends *or when this component unmounts*, which
   * is what stops a rider who leaves with the browser's own Back button being
   * left on some other page with no header.
   *
   * ⚠️ **Absent rather than hidden, and that is CLAUDE.md §4e rather than
   * taste.** The accessibility suite loads no stylesheet, so a header hidden
   * with `display: none` is, to `tabbableElements`, eleven focusable links —
   * and to a keyboard user behind an opaque full-bleed stage it is eleven tab
   * stops with no visible focus. The shell does not render it at all.
   *
   * ⚠️ **An optional prop nobody supplies is the hole `check:wiring` states it
   * cannot see** (§4j, its third §Limits entry), so the other half is pinned by
   * a test rather than trusted: `shell/immersive.test.tsx` starts a ride through
   * the real shell and asserts the header goes and comes back.
   *
   * ## How a rider leaves a ride mid-way, which #423 asks to have recorded
   *
   * **By pressing *End ride*, and that is the only control on the screen that
   * leaves.** There is deliberately no navigation on the stage: a link a gloved
   * thumb can brush is a ride ended by accident, with the trainer released
   * under somebody who is still pedalling, and *End ride* is
   * `CONTROL_MINIMUM_PIXELS` square precisely so that it is pressed on purpose.
   * *Pause* is beside it for everything short of leaving. The platform's own
   * Back — the browser's button, Android's gesture — still works and is an
   * unmount, which {@link teardown} already treats exactly as *End ride*: the
   * trainer is released through the ride controller's one release (#372), the
   * screen lock is released and the GL context is destroyed.
   *
   * ⚠️ **None of this touches a recording or a workout.** `RideSession` is
   * mounted in `AppShell` *above* the router for exactly this reason, and the
   * shell goes on rendering it while the chrome is absent.
   */
  readonly onImmersive?: ((immersive: boolean) => void) | undefined;
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

/**
 * The same, for the wind refusal (#326) — a second id for the same reason the
 * first one is a module constant, and it must not be the same string.
 *
 * Two independent refusals can be live at once: a rider may slip a decimal in
 * the pacer box *and* leave the wind speed blank. One shared id would make
 * `aria-describedby` on the ride button point at whichever of the two happened
 * to render, so the rider would be told about one problem and blocked by two.
 */
const WIND_PROBLEM_ID = 'oyl-game-wind-problem';

/**
 * How long a standing trainer notice stays open before it gets out of the
 * way, in seconds of RIDE — #437.
 *
 * Long enough to read the longest of `trainer-port.ts` §`trainerRoadNotice`'s
 * four sentences twice at a handlebar's distance (about 30 words, so ~8 s at
 * an ordinary reading pace), short enough that the elevation strip and the
 * plan view are back before the first climb of any route worth riding. A
 * judgement, stated as one; the control reopens it at any time.
 */
export const STANDING_NOTICE_SECONDS = 15;

export function GameView(props: GameViewProps): JSX.Element {
  // ⚠️ Read here rather than inside `WindControls`, because `windChoice` is a
  // pure function and has to be called where its answer can be handed to both
  // the control that shows the refusal and the button the refusal blocks.
  const units = useUnits();
  const [routes, setRoutes] = useState<readonly RidableRoute[] | undefined>(undefined);
  const [chosen, setChosen] = useState<RidableRoute | undefined>(undefined);
  const [withGhost, setWithGhost] = useState(false);
  const [withPacer, setWithPacer] = useState(false);
  const [intensity, setIntensity] = useState(String(DEFAULT_PACER_INTENSITY));
  /**
   * Where the rider said their hands are — #365.
   *
   * ⚠️ **Per ride rather than on the athlete row**, like the pacer and the
   * wind beside it and unlike the weight. A rider changes position half a dozen
   * times in an hour and picks a different one for a hilly route than for a
   * flat one; a stored preference would be a setting they had to remember to
   * change. It is also the cheaper answer honestly: persisting it is a store
   * migration, and #365 asks for a rider-facing choice rather than for a saved
   * one.
   */
  const [position, setPosition] = useState<RidingPosition>(DEFAULT_RIDING_POSITION);
  const [withWind, setWithWind] = useState(false);
  const [windSpeed, setWindSpeed] = useState('');
  const [windFrom, setWindFrom] = useState(String(DEFAULT_WIND_FROM_BEARING));
  const [phase, setPhase] = useState<Phase>('choosing');
  const [state, setState] = useState<GameState | undefined>(undefined);
  const [quality, setQuality] = useState<QualityState>(INITIAL_QUALITY);
  /**
   * What the trainer could be told when this ride started — #362.
   *
   * ⚠️ **Read once, at the start of the ride, and held for its length**, which
   * is the rule `rideConditionsFor` and the wind already follow and is stated at
   * `GameTrainerPort.readTrainer`. Control lost mid-ride therefore arrives as a
   * *refused write* rather than as a silent change of state, which is the
   * honest shape: the rider is told the hills stopped reaching the trainer,
   * with the reason the machine gave.
   */
  const [trainer, setTrainer] = useState<GameTrainer>(NO_GAME_TRAINER);
  /**
   * What the rider has done with the standing notice — #437. `auto` until they
   * touch *Trainer notice*, after which it is theirs. Reset by `start`, so a
   * second ride shows its notice open again.
   */
  const [noticeChoice, setNoticeChoice] = useState<'auto' | 'open' | 'closed'>('auto');
  /**
   * What the HUD's one live region says — #397. Written only when the
   * announcer produces a sentence, which is on very few frames by design.
   */
  const [announcement, setAnnouncement] = useState('');
  /** The announcer's carry-over, threaded frame to frame. @see announce.ts */
  const announcerRef = useRef<AnnouncerState>(INITIAL_ANNOUNCER);
  /**
   * What the rider asked to hear — read from THIS DEVICE at the start of each
   * ride (#395 decided the device, not the athlete row), off by default.
   */
  const announcementsRef = useRef<AnnouncementPreference>(DEFAULT_ANNOUNCEMENTS);
  /**
   * The route's climbs and descents, found once per ride, and the approach
   * last announced — #399. Refs for `announcerRef`'s reason: the loop reads
   * them on every frame and must not re-run when they change.
   */
  const slopesRef = useRef<readonly Slope[]>([]);
  const slopeAnnouncedRef = useRef<SlopeAnnounced>(undefined);
  /**
   * This ride's sounds — #400. Made inside the *Ride* press, so the audio
   * context is resumed from a gesture. ⚠️ **Not ended in `teardown`, and that
   * was measured rather than forgotten**: the game plays only the short
   * distance sound, which stops by itself, and has no power target for the
   * continuous tone — so a stop there would be unobservable, and deleting it
   * left every test green. The tone, which CAN be left sounding, belongs to a
   * workout, and `WorkoutPanel` stops it.
   */
  const cuesRef = useRef<RideCues | undefined>(undefined);
  /** What the rider chose for sound, read at the start of each ride. */
  const [sound, setSound] = useState<CuePreference>(DEFAULT_CUES);
  const soundsOut = props.sounds;
  /** The rider's units, for the spoken distance, read inside the loop. */
  const unitsRef = useRef(units);
  unitsRef.current = units;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simulationRef = useRef<GameSimulation | undefined>(undefined);
  const viewRef = useRef<RendererView | undefined>(undefined);
  const ghostRef = useRef<GhostTrack | undefined>(undefined);
  /**
   * How much scenery the current rung allows — #245.
   *
   * ⚠️ **A ref rather than the `quality` state, for the same reason the loop
   * below does not depend on `quality`.** That effect is deliberately not
   * re-run on a rung change, so the `quality` it closes over is the one the
   * ride started at — reading `qualitySettings(quality.level).scatterItems`
   * inside `tick` would hand `sceneFrame` the target rung's budget for the
   * whole ride and every test of it would pass. The effect that tells the
   * renderer about the new rung is the one place the two are kept together.
   */
  const scatterItemsRef = useRef<number>(qualitySettings(INITIAL_QUALITY.level).scatterItems);
  /**
   * How the race against the ghost ended, once it has — #259.
   *
   * ⚠️ **A ref rather than state, and one frame of memory rather than none.**
   * `ghost-outcome.ts` says why the answer cannot be recomputed from the
   * current state after the fact; what matters here is that it is written in
   * the tick, immediately before the `setState` that causes the render which
   * reads it, so the HUD and the road are describing the same instant. As
   * state it would be a second render per frame for a value that changes once
   * in a ride.
   */
  const outcomeRef = useRef<GhostOutcome | undefined>(undefined);
  /**
   * How far the rider's cranks have turned, in radians — #349.
   *
   * ⚠️ **A ref, for the reason {@link outcomeRef} is one and then some**: this
   * changes on every frame of every pedalling ride, so as state it would be a
   * second render sixty times a second for a number no DOM node shows. It is
   * the one piece of *visual* state this component carries, and it is here
   * rather than in `GameSimulation` because cadence is not a simulation input —
   * the physics integrates power, and a crank angle changes nothing about where
   * the rider is.
   */
  const crankRef = useRef<number>(0);
  const lockRef = useRef<ScreenLock>(NO_SCREEN_LOCK);
  /**
   * The gradient control loop, while one is running — #362.
   *
   * ⚠️ **A ref rather than state, and the reason is the same as
   * {@link outcomeRef}'s and then some**: it is written in the tick, sixty times
   * a second, and nothing about the *object* changes. What a screen renders is
   * its `state()`, read during render, which is fresh because the tick's
   * `setState` is what scheduled that render.
   *
   * `undefined` whenever the trainer is not `ready`, which is every ride in a
   * browser with no trainer paired — and that absence is what makes "a machine
   * that does not offer simulation mode is not written to" a property of the
   * construction rather than of a guard somebody has to keep.
   */
  const gradientRef = useRef<GradientSession | undefined>(undefined);

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
    // ⚠️ **First**, and before anything else can throw. #362's second half is
    // that a ride which ends on a 9 % wall must not leave the flywheel loaded
    // against whoever gets on the trainer next — `gradient.ts` §`stop` records
    // what that release sends and — measured on hardware, #372 — what it does
    // not do, which is remove the resistance. `stop` is
    // idempotent because this callback runs from the "End ride" button *and*
    // from the effect's cleanup, and a rider who navigates away has ended the
    // ride just as surely as one who pressed the button — validation 0002 L7.
    gradientRef.current?.stop();
    gradientRef.current = undefined;
    void lockRef.current.release();
    lockRef.current = NO_SCREEN_LOCK;
    viewRef.current?.destroy();
    viewRef.current = undefined;
    simulationRef.current = undefined;
    // ⚠️ **`outcomeRef` is deliberately NOT cleared here, and `ghostRef` never
    // was.** Both belong to the *ride*, and `start` is where a ride begins —
    // this callback releases resources. Clearing it in both places made each
    // assignment individually invisible: deleting either left the whole suite
    // green, because the other covered for it, which is CLAUDE.md §5's "a test
    // that cannot fail is not a test" seen from the implementation's side.
    // There is exactly one way back to the picker (`onEnd`) and exactly one way
    // out of it (`start`), so one reset is the whole of it.
  }, []);

  useEffect(() => teardown, [teardown]);

  const start = useCallback(
    async (
      route: RidableRoute,
      ghost: boolean,
      pacer: BotPacerPlan | undefined,
      air: Wind | undefined,
      sitting: RidingPosition,
    ): Promise<void> => {
      const profile = route.profile;
      // ⚠️ #400: FIRST, before the first `await` — this line runs inside the
      // rider's press on *Ride*, and after an `await` it would not. A browser
      // refuses audio that starts outside a gesture, silently, so this is
      // where the audio context is made and resumed or it never sounds.
      const soundChoice = readCuePreference(deviceStorage());
      setSound(soundChoice);
      cuesRef.current?.end();
      cuesRef.current = new RideCues(soundsOut ?? sharedCueOutput(), soundChoice);
      cuesRef.current.begin();
      ghostRef.current = ghost && port !== undefined ? await port.loadGhost(route.id) : undefined;
      // ⚠️ **A new ride settles its own result, and this is the only line that
      // makes that true.** `ghost-outcome.ts` returns a settled answer
      // unchanged for ever — that latch is its whole defence against a rider
      // who keeps riding — so a verdict carried over from the last ride is
      // never revisited. A rider who beat their best on one route and then
      // started another would be congratulated on frame one, about an attempt
      // that is no longer loaded: the same false congratulation that module
      // exists to prevent, arriving from the other direction.
      outcomeRef.current = undefined;
      setNoticeChoice('auto');
      // #397: a new ride starts silent. The last ride's sentence is not this
      // one's, and a region carrying it at mount would announce it again.
      announcerRef.current = INITIAL_ANNOUNCER;
      setAnnouncement('');
      announcementsRef.current = readAnnouncementPreference(deviceStorage());
      slopesRef.current = slopesOf(profile);
      slopeAnnouncedRef.current = undefined;
      // ⚠️ **Read at the start of the ride and held for its length**, which is
      // what makes "changing your weight mid-session does not rewrite the ride
      // you are on" true by construction rather than by a rule somebody
      // follows. A rider who is climbing when the number changes does not have
      // the hill they are on get heavier under them, and `simulation.ts`'s
      // determinism — a step count derived from the origin — would be a
      // different claim if its conditions could move.
      const simulation = new GameSimulation({
        profile,
        // ⚠️ #365: the second half of "nobody ever chose the rider". The mass
        // arrived with #325 and `RideConditions.coefficients` stayed
        // `undefined`, so every ride fell back to `MARTIN_1998_COEFFICIENTS`
        // and every rider was simulated as a track racer in a wind tunnel —
        // about 2.3 mph optimistic at 150 W on the flat. `rider.ts` holds the
        // three positions and the arithmetic.
        conditions: rideConditionsFor(riderMassFor(props.riderMass).mass, sitting),
        ...(pacer === undefined ? {} : { pacer }),
        // ⚠️ #326: the line that makes `packages/physics`'s entire wind model
        // reachable from a ride. `RideConditions.headwindMetresPerSecond` was
        // plumbed through three packages, spread into the bot's course, and
        // supplied by nobody — so a signed air speed and a `V_a·│V_a│` drag
        // term written specifically so a tailwind could exceed the ground
        // speed had, between them, never seen a value other than zero.
        ...(air === undefined ? {} : { wind: air }),
      });
      simulationRef.current = simulation;
      // ⚠️ #362: the line that makes #90's whole gradient path reachable from a
      // ride. `createSimulationDriver` and `createSimulationWriter` were both
      // written, both unit-tested and both green, and nothing under `apps/`
      // named either — so a rider on a real trainer, on a real route, produced
      // 252 inbound notifications and not one write. The session is built only
      // for a `ready` trainer, so a machine that did not say it accepts
      // simulation parameters is not written to by construction rather than by
      // a guard inside the loop.
      const found = props.trainer?.readTrainer() ?? NO_GAME_TRAINER;
      setTrainer(found);
      gradientRef.current =
        found.control === undefined
          ? undefined
          : createGradientSession({ profile, control: found.control });
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
    [port, props.screenLock, props.riderMass, props.trainer, soundsOut],
  );

  // #423. Whether the ride has the screen — @see GameViewProps.onImmersive.
  //
  // ⚠️ The same predicate the render below branches on, written once: a shell
  // told "immersive" while this component was still drawing the route picker
  // would remove the chrome from a *form*, which is the one state of this
  // screen that needs it.
  const onTheStage = phase !== 'choosing' && chosen !== undefined && state !== undefined;
  const onImmersive = props.onImmersive;
  useEffect(() => {
    if (!onTheStage || onImmersive === undefined) {
      return;
    }
    onImmersive(true);
    return () => {
      // The cleanup runs when the ride ends AND when the component unmounts,
      // so neither path can leave the shell without its header.
      onImmersive(false);
    };
  }, [onTheStage, onImmersive]);

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

    // ⚠️ **#423 made this necessary rather than nice.** The canvas used to be
    // `aspect-ratio: 16 / 9` whatever the viewport did, so a rotation changed
    // its size and never its shape, and sizing the renderer once at creation
    // cost some sharpness. It now fills the stage, so turning a tablet from
    // portrait to landscape changes the shape from about 0.6 : 1 to 1.6 : 1 —
    // and a renderer still holding the old aspect draws every circle as an
    // ellipse for the rest of the ride.
    //
    // An observer rather than a read of `clientWidth` inside `tick`: the HUD
    // re-renders every frame, so the document is dirty every frame, and reading
    // a layout property there forces a synchronous layout sixty times a second
    // on the device least able to afford one. `typeof` because jsdom has no
    // `ResizeObserver` and the accessibility suite renders this screen there.
    //
    // ⚠️ **A known limit, stated rather than fixed — #436's review.** This
    // effect returns early unless the ride is `riding` and disconnects in its
    // cleanup, so a rider who PAUSES and then rotates gets no `resize`: the
    // last frame is shown stretched until they resume, when the new observer's
    // first callback corrects it. Hoisting the observer out of this effect is
    // not the repair it looks like. `resize` is three's `setSize`, which
    // resets the canvas's dimensions and so CLEARS the drawing buffer, and
    // nothing draws while paused — it would trade a stretched frame for a
    // blank one. The repair is a view that can redraw its last frame on
    // demand, which the port does not offer today. Validation 0002 Q3 asks the
    // person holding the tablet to look at it.
    const observer =
      canvas === null || typeof ResizeObserver !== 'function'
        ? undefined
        : new ResizeObserver(() => {
            // Skipped while the box is empty — a stage mid-teardown, or a
            // canvas not yet laid out — because a zero height is an aspect
            // ratio of infinity, which three turns into a NaN projection and a
            // black frame.
            if (canvas.clientWidth > 0 && canvas.clientHeight > 0) {
              viewRef.current?.resize(canvas.clientWidth, canvas.clientHeight);
            }
          });
    if (canvas !== null) {
      observer?.observe(canvas);
    }

    const tick = (): void => {
      const simulation = simulationRef.current;
      if (simulation === undefined) {
        return;
      }
      const at = clock();
      // ⚠️ **Read once**, and both halves used: the rider's power drives the
      // simulation and the cadence drives the cranks. Two calls would be two
      // samples of a live sensor on one frame, which is a HUD and a pair of
      // legs describing different instants.
      const sensors = port.readSensors();
      simulation.advanceTo(at, sensors.rider);
      // ⚠️ **Before the render and from the same `at`**, so the cranks the
      // frame draws are the cranks that belong to it. `bicycle.ts` holds the
      // rule: they turn exactly when the HUD shows a cadence number, at exactly
      // that number, and a rider with no cadence sensor gets still cranks
      // rather than an invented rate.
      const sinceLastFrame = at - lastFrameAt;
      crankRef.current = advanceCrank(crankRef.current, sensors.cadence, sinceLastFrame / 1000);
      // ⚠️ Before `setState`, so the render it schedules already has the answer.
      // This is the production consumer `scene.ts` §`ghostFinished` did not have
      // — #259, and the third time in `game/` that something built, exported and
      // unit-tested turned out to be reachable by nobody.
      outcomeRef.current = settleGhostOutcome(
        outcomeRef.current,
        ghostRef.current,
        simulation.state,
      );
      setState(simulation.state);

      // #397: the announcer, on the RIDE's clock (`elapsed`, which does not
      // run while the ride is paused — nor does this loop), from the same
      // readings the HUD renders. Pure: its carry-over lives in the ref.
      const readings = hudReadings({
        state: simulation.state,
        profile: chosen.profile,
        cadence: sensors.cadence,
        heartRate: sensors.heartRate,
        units: unitsRef.current,
      });
      // #399: "to go" is the HUD's own reading, parsed — see `remainingFrom`.
      const remaining = remainingFrom(readings, spokenDistanceUnit(unitsRef.current));
      // #399: a climb or a descent ahead, from the SAME wrapped position the
      // strip and the plan view use (`climb-ahead.ts` says why that matters).
      const slope = slopeEvent(slopeAnnouncedRef.current, {
        slopes: slopesRef.current,
        profile: chosen.profile,
        distance: simulation.state.ride.distance,
        lead: announcementsRef.current.enabled ? announcementsRef.current.climbLeadMetres : 'never',
        units: unitsRef.current,
      });
      slopeAnnouncedRef.current = slope.announced;
      const heard = announce(announcerRef.current, {
        now: simulation.state.elapsed,
        readings,
        ...(remaining === undefined ? {} : { remaining }),
        ...(slope.event === undefined ? {} : { events: [slope.event] }),
        preference: announcementsRef.current,
      });
      announcerRef.current = heard.state;
      if (heard.sentence !== undefined) {
        setAnnouncement(heard.sentence);
      }
      // #400: the distance sound plays on the frame its SENTENCE is said and
      // on no other, so it is never the only carrier of a mark passed.
      if (heard.kind === 'distance-tick') {
        cuesRef.current?.cue('distance');
      }

      const origin = corridorOrigin(chosen.profile);
      // ⚠️ **Where to DRAW them, which is not where the newest step left them**
      // — #323. The simulation ticks twenty times a second and this loop runs
      // sixty, so reading the state's own distances here drew each position
      // three times and then jumped: the world stepped rather than moved.
      // `drawnAt` blends the last two steps and advances nothing, so calling it
      // once per frame costs a subtraction and cannot move the ride.
      //
      // It is read after `advanceTo` so that the pair it blends is the freshest
      // two steps. ⚠️ **Swapping the two lines is not caught by any test here,
      // and that was measured rather than assumed**: the blend is clamped, so
      // reading it first is still monotonic and still smooth — it simply draws
      // a second whole step further behind, 100 ms instead of 50. That is a
      // latency regression a rider would feel and no assertion in this
      // repository would notice, so it is recorded here rather than claimed to
      // be guarded.
      // ⚠️ **After `advanceTo` and before the draw**, from the state the
      // simulation has just settled on — so the hill the trainer is told about
      // is the hill the rider is on rather than the one they were on last
      // frame. Offered, not awaited: `setSimulationParameters` can take four
      // seconds on a slow machine and must not hold up a frame, and the writer
      // coalesces onto the newest setpoint rather than queueing every one.
      //
      // ⚠️ `state.elapsed`, not `at`. The driver's rate limit and its
      // not-after-the-last-write guard are both *subtractions* of instants, and
      // `elapsed` is derived from the simulation's origin, so it is exactly
      // monotonic and in seconds — `GradientSession.sample` is where that
      // reasoning lives, because the conversion is there.
      gradientRef.current?.sample(simulation.state.elapsed, simulation.state.ride.distance);

      const drawn = simulation.drawnAt(at);
      viewRef.current?.render(
        sceneFrame({
          profile: chosen.profile,
          origin,
          state: simulation.state,
          riderDistance: drawn.riderDistance,
          // #237: the bot's odometer, from the state the simulation just
          // advanced. `SceneInput.botDistance` was declared and optional and
          // never supplied, which is why a built, tested and green pacer drew
          // nothing on a real 47.53 km route.
          ...(drawn.botDistance === undefined ? {} : { botDistance: drawn.botDistance }),
          ghost: ghostRef.current,
          // #245: the rung's scenery budget, so a throttling phone stops
          // *placing* the scenery it is about to stop drawing. @see
          // scatterItemsRef for why this is not read off `quality` here.
          scatterItems: scatterItemsRef.current,
          // #349: how far the cranks have turned. `port.ts`
          // §`RiderMarker.crankAngle` records that an optional field nobody
          // supplies is a hole this repository's gates cannot see, which is
          // exactly what `botDistance` was before #237 — so `GameView.test.tsx`
          // reads this back off the frame the renderer was handed.
          crankAngle: crankRef.current,
        }),
      );

      // The measurement `quality.ts` decides from. Taken here because this is
      // the only place that knows how long a frame took.
      // ⚠️ **Read and closed over BEFORE the updater, and that is the whole
      // of #245's second finding.** `lastFrameAt` is a `let` in this effect's
      // scope, so an updater that subtracted it *inside* the closure would be
      // captured by reference — and React invokes an updater during the next
      // render, by which time the line below has already moved it to `at`. The
      // ladder was therefore fed `frameMs: 0` on every frame of every ride:
      // always "cool", never hot, so the reduction path #91 asks for could not
      // fire at all. `thermalHeadroom` is `undefined` in the shipped app
      // (`docs/validation/0002-android-shell-and-game.md` Part E), so this was
      // the only live input to the whole policy.
      const frameMs = sinceLastFrame;
      lastFrameAt = at;
      setQuality((previous) => nextQuality(previous, { frameMs }));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
    // ⚠️ `quality` is read inside `tick` and is deliberately NOT a dependency.
    // Re-running this effect on every quality change would cancel the frame,
    // destroy the renderer and rebuild it mid-ride — and quality changes exactly
    // when the phone is least able to afford that. It is read through
    // `setQuality`'s updater form, which does not close over a stale value, and
    // the level is applied to the live renderer by the effect below instead.
  }, [phase, chosen, port, props.renderer, props.now]);

  useEffect(() => {
    const settings = qualitySettings(quality.level);
    // ⚠️ Both halves of the rung, from one place. The renderer stops submitting
    // the instances and `sceneFrame` stops placing them — #245, and
    // `ScatterBelt.setBudget` says why neither alone is the whole of it.
    scatterItemsRef.current = settings.scatterItems;
    viewRef.current?.setQuality(settings);
  }, [quality.level]);

  if (!onTheStage) {
    // One snapshot read for both notices, so they describe the same moment.
    const trainerNow = props.trainer?.readTrainer();
    return (
      <RoutePicker
        routes={routes}
        // ⚠️ Read **here** rather than reusing the ride's captured state, and
        // that is the whole point of showing it twice: `no-control` tells the
        // rider to take control *before they start*, which is only actionable
        // on the screen they have not left yet. A snapshot read, so it costs a
        // property access per render and never opens a connection.
        trainerNotice={trainerRoadNotice(trainerNow ?? NO_GAME_TRAINER)}
        releaseNotice={trainerNow?.releaseFault}
        withGhost={withGhost}
        onGhost={setWithGhost}
        withPacer={withPacer}
        onPacer={setWithPacer}
        intensity={intensity}
        onIntensity={setIntensity}
        choice={pacerChoice(withPacer, intensity)}
        withWind={withWind}
        onWind={setWithWind}
        windSpeed={windSpeed}
        onWindSpeed={setWindSpeed}
        windFrom={windFrom}
        onWindFrom={setWindFrom}
        air={windChoice(withWind, windSpeed, windFrom, units)}
        windUnit={speedUnit(units)}
        position={position}
        onPosition={setPosition}
        onStart={start}
      />
    );
  }

  const sensors = port?.readSensors() ?? NO_SENSORS;
  // ⚠️ Read during render rather than held in state — see {@link gradientRef}.
  // The tick's own `setState` is what schedules this render, so it is fresh.
  const gradient = gradientRef.current?.state();
  const roadNotice = trainerRoadNotice(trainer);
  // #437: open for the first STANDING_NOTICE_SECONDS of ride, then out of the
  // way unless the rider asks for it — on the RIDE's clock, so a paused ride
  // does not put away a notice nobody has had time to read.
  const noticeOpen =
    noticeChoice === 'open' ||
    (noticeChoice === 'auto' && (state?.elapsed ?? 0) < STANDING_NOTICE_SECONDS);
  return (
    // ⚠️ **`oyl-game--riding` is the stage — #423.** `theme.css` makes it fill
    // the viewport and lays the HUD over the world. It is a modifier rather
    // than the base class because `browser/ride.browser.spec.ts` takes it
    // *off* for its control: the same markup without it is the stacked page
    // #419 measured, with *Pause* below the fold, and a gate that could not see
    // that would be green over anything.
    <section className="oyl-game oyl-game--riding" aria-label="Trainer game">
      <canvas
        ref={canvasRef}
        className="oyl-game__world"
        // The world is decorative in the accessibility sense: everything it
        // conveys is also in the HUD over it, as text. Marking it so is more
        // honest than an alt text describing a scene that changes every frame.
        aria-hidden="true"
      />
      <HudPanel
        profile={chosen.profile}
        announcement={announcement}
        state={state}
        cadence={sensors.cadence}
        heartRate={sensors.heartRate}
        chases={chasedGaps(state, ghostRef.current, outcomeRef.current)}
        paused={phase === 'paused'}
        // #400: the mute and the volume, on the ride's own screen — SC 1.4.2.
        // Only for a rider who turned sounds on: there is nothing to mute
        // otherwise, and a control that does nothing is noise on a HUD.
        sound={
          sound.enabled ? (
            <SoundControls
              preference={sound}
              onChange={(next) => {
                setSound(next);
                writeCuePreference(deviceStorage(), next);
                cuesRef.current?.set(next);
                // Inside the press, so a context the platform suspended is
                // resumed here — `web-audio.ts` §"What happens when it is
                // suspended".
                cuesRef.current?.begin();
              }}
            />
          ) : undefined
        }
        // ⚠️ **The rider-visible evidence that #362 is fixed**, and the reason
        // it is on the screen rather than only in a test: `docs/validation/
        // 0002-android-shell-and-game.md` Part L asks somebody with a trainer in
        // front of them to check that the gradient tracks the road, and a step
        // whose expected result is invisible is the empty-cell problem that
        // issue is about. `asked` rather than "holding" — `gradient.ts`
        // §`GradientSessionState.asked` says why those are different claims.
        //
        // ⚠️ **It is a HUD prop rather than a `<p>` after this panel, and that
        // is #373.** In landscape it used to fall outside the viewport with
        // nothing to say it existed — so the one step Part L is built around
        // could not be performed in the orientation a handlebar-mounted phone
        // is most likely to be in. ⚠️ #373 moved it and did NOT thereby make
        // it visible: the panel it moved into ran off the bottom too (#419,
        // #422). `hud/fields.ts` §`TrainerLine` argues the placement and says
        // what did fix it; `browser/ride.browser.spec.ts` measures it.
        trainer={trainerReading(gradient)}
        onPause={() => {
          setPhase((current) => (current === 'paused' ? 'riding' : 'paused'));
        }}
        onEnd={() => {
          teardown();
          setPhase('choosing');
          setChosen(undefined);
        }}
        // #423: inside the HUD's own grid rather than after it, so a notice
        // gets a cell no panel can occupy. @see HudPanelProps.notices
        standingNotice={
          roadNotice === undefined
            ? undefined
            : {
                content: (
                  // #394: announced when it appears — it is absent until a
                  // ride starts on a trainer the road cannot reach, which is
                  // the case `live` exists for.
                  <StatusMessage tone="warning" label="The road is not reaching your trainer" live>
                    {roadNotice}
                  </StatusMessage>
                ),
                expanded: noticeOpen,
                onToggle: () => {
                  setNoticeChoice(noticeOpen ? 'closed' : 'open');
                },
              }
        }
        notices={[
          gradient?.fault === undefined ? undefined : (
            <StatusMessage key="fault" tone="danger" label="Trainer" live>
              {gradient.fault}
            </StatusMessage>
          ),
        ]}
      />
    </section>
  );
}

/**
 * The gradient session as the HUD's trainer row, or nothing at all.
 *
 * ⚠️ **A fault suppresses it rather than colouring it.** A fault is a thing to
 * act on and gets a `StatusMessage` of its own above; a stale "simulating
 * −3.4%" beside it would be describing a write that did not happen. Absent
 * rather than a nought, on `fields.ts` §`NO_READING`'s precedent.
 */
function trainerReading(gradient: GradientSessionState | undefined): TrainerLine | undefined {
  if (gradient === undefined || gradient.fault !== undefined || gradient.asked === undefined) {
    return undefined;
  }
  return { gradePercent: gradient.asked, writes: gradient.writes };
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
 * The ghost's distance is read at **this point in the race**, through the same
 * {@link ghostClock} `scene.ts` places its marker with — a ghost is raced rather
 * than replayed beside you, so "where is it now" is a question about the clock,
 * and #254 is what happens when the HUD and the road answer it differently.
 * That clock is the ride's *ridden* seconds and never its wall clock;
 * `simulation.ts` §`ghostClock` states the rule and why.
 *
 * ⚠️ **And once the race against it is settled, the gap stops being the thing
 * to show** — #259. `outcome` arrives already decided, from `ghost-outcome.ts`,
 * which is where the reason it cannot be re-derived here is written down.
 */
function chasedGaps(
  state: GameState,
  ghost: GhostTrack | undefined,
  outcome: GhostOutcome | undefined,
): readonly ChasedGap[] {
  const found: ChasedGap[] = [];
  const bot = state.bot;
  if (bot !== undefined) {
    found.push({ to: 'bot', gap: pacerGap(gapAgainst(state, bot.state.distance)) });
  }
  if (ghost !== undefined) {
    const at = ghostDistanceAt(ghost, ghostClock(state));
    found.push({
      to: 'ghost',
      gap: pacerGap(gapAgainst(state, at)),
      // Present only once the race against the attempt is settled, which is
      // what turns the field from a gap into a result — `hud/fields.ts`
      // §`ChasedGap.outcome`.
      ...(outcome === undefined ? {} : { outcome }),
    });
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
  readonly withWind: boolean;
  readonly onWind: (value: boolean) => void;
  readonly windSpeed: string;
  readonly onWindSpeed: (value: string) => void;
  readonly windFrom: string;
  readonly onWindFrom: (value: string) => void;
  readonly air: WindChoice;
  /** The label the speed box is in, from `units/format.ts`. @see WindControls */
  readonly windUnit: string;
  /**
   * What the rider is told about the road not reaching their trainer, if
   * anything — #362. `undefined` for a ready trainer and for no trainer at all.
   */
  readonly trainerNotice: string | undefined;
  /**
   * The last release the trainer did not confirm — #372. `undefined` almost
   * always. @see GameTrainer.releaseFault
   */
  readonly releaseNotice: string | undefined;
  /** Where the rider's hands are — #365. @see RIDING_POSITIONS */
  readonly position: RidingPosition;
  readonly onPosition: (value: RidingPosition) => void;
  readonly onStart: (
    route: RidableRoute,
    ghost: boolean,
    pacer: BotPacerPlan | undefined,
    air: Wind | undefined,
    position: RidingPosition,
  ) => Promise<void>;
}): JSX.Element {
  if (props.routes === undefined) {
    return <p>Loading your routes…</p>;
  }
  if (props.routes.length === 0) {
    // ⚠️ #232's second criterion: an empty picker says **how a route gets
    // here**, not only that there are none. The sentence it used to carry named
    // one of the two ways and named neither screen as a link — and it did not
    // mention the thing a rider who has already tried has most likely done,
    // which is to import the course on the Files screen and get a ride. The
    // wording is a constant in `routes/two-importers.ts` so this screen, the
    // Files screen and the Routes screen cannot drift apart.
    return (
      <div className="oyl-game__picker">
        <h2>Choose a route</h2>
        <p>{NO_ROUTES_YET}</p>
        <ul>
          <li>
            <a href={hrefFor(routeById('routes'))}>Import a GPX file on the Routes screen</a> — a
            course from a route planner, read on this device.
          </li>
          <li>
            <a href={hrefFor(ROUTE_BUILDER_ROUTE)}>Draw one on this device</a> — place waypoints and
            have the roads between them worked out.
          </li>
        </ul>
      </div>
    );
  }
  // ⚠️ The ride control is BLOCKED rather than silently dropping the pacer.
  // Starting a ride that quietly has no bot in it, because the number in the box
  // could not make one, is the same defect #237 is about arriving from the other
  // side — and this time the rider would have asked for it.
  // ⚠️ **Either refusal blocks the ride**, and the button describes whichever
  // ones are live. A wind the numbers could not make would otherwise start a
  // ride in still air after the rider had asked for a gale — #237's defect
  // arriving from the side the rider can see, which is what the pacer control
  // already refuses for its own box.
  const pacerRefused = props.choice.problem !== undefined;
  const windRefused = props.air.problem !== undefined;
  const refused = pacerRefused || windRefused;
  const describedBy =
    [pacerRefused ? PACER_PROBLEM_ID : undefined, windRefused ? WIND_PROBLEM_ID : undefined]
      .filter((id) => id !== undefined)
      .join(' ') || undefined;
  return (
    <div className="oyl-game__picker">
      <h2>Choose a route</h2>
      {props.releaseNotice === undefined ? undefined : (
        // #372: first, because it is about the machine under the rider now
        // rather than the road they are about to choose.
        <StatusMessage tone="danger" label="Not released" live>
          {props.releaseNotice}
        </StatusMessage>
      )}
      {props.trainerNotice === undefined ? undefined : (
        // ⚠️ **Before the ride rather than only during it**, because one of the
        // four sentences is *"take control on the Ride screen before you
        // start"* — advice a rider cannot act on once they are riding. It does
        // not block the ride: a rider who wants to ride a route with no
        // resistance is allowed to, and #362's criterion is that they are told,
        // not that they are stopped.
        <StatusMessage tone="warning" label="The road will not reach your trainer">
          {props.trainerNotice}
        </StatusMessage>
      )}
      <PacerControls
        withPacer={props.withPacer}
        onPacer={props.onPacer}
        intensity={props.intensity}
        onIntensity={props.onIntensity}
        problem={props.choice.problem}
      />
      <PositionControl position={props.position} onPosition={props.onPosition} />
      <WindControls
        withWind={props.withWind}
        onWind={props.onWind}
        speed={props.windSpeed}
        onSpeed={props.onWindSpeed}
        fromBearing={props.windFrom}
        onFromBearing={props.onWindFrom}
        speedUnit={props.windUnit}
        problem={props.air.problem}
        field={props.air.field}
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
              aria-describedby={describedBy}
              onClick={() => {
                if (refused) {
                  return;
                }
                void props.onStart(
                  route,
                  props.withGhost && route.attempts > 0,
                  props.choice.plan,
                  props.air.wind,
                  props.position,
                );
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

/**
 * Where the rider's hands are — #365.
 *
 * ⚠️ **A `<select>` rather than three numbers**, and the labels name hands
 * rather than square metres: a drag area is a wind-tunnel measurement nobody
 * knows about themselves, and #365's first criterion is that the choice be
 * rider-facing. `rider.ts` §`ridingPositionDragArea` is where each one becomes
 * a `c_d · A`, and it says why they are the game's own numbers rather than
 * `packages/physics`'.
 *
 * ⚠️ **No refusal branch, unlike the pacer and the wind beside it**, because
 * there is nothing to refuse: every option is one of three this file rendered,
 * so a value that is not one of them cannot come off the control. That is what
 * `pacer-choice.ts` and `wind-choice.ts` exist for and why this has no
 * counterpart.
 */
function PositionControl(props: {
  readonly position: RidingPosition;
  readonly onPosition: (value: RidingPosition) => void;
}): JSX.Element {
  return (
    <div className="oyl-game__position">
      <label>
        How you are riding
        <select
          value={props.position}
          onChange={(event) => {
            // The cast is safe because every option below is a `RidingPosition`
            // this component itself rendered; `select.value` is simply typed as
            // `string` by the DOM.
            props.onPosition(event.target.value as RidingPosition);
          }}
        >
          {RIDING_POSITION_ORDER.map((id) => (
            <option key={id} value={id}>
              {RIDING_POSITIONS[id].label}
            </option>
          ))}
        </select>
      </label>
      <p className="oyl-muted">
        This sets how much air you are pushing, which is most of what decides your speed on the
        flat. Your weight is set on the Settings screen and is most of it on a climb.
      </p>
    </div>
  );
}

/**
 * Whether there is a wind, how strong, and where from — #326.
 *
 * Once above the list, beside {@link PacerControls} and for its reason: a wind
 * belongs to the ride rather than to a route, and three identically-labelled
 * controls per route would be a worse page for anybody using a screen reader
 * than one set that plainly governs the whole list.
 *
 * ⚠️ **The speed's unit label arrives as a prop and is not written here.**
 * #238's fifth criterion and `units/no-inline-units.ts`: this client has
 * exactly one place a number becomes a unit, and a `km/h` typed into a label
 * on this screen is the defect that rule was written after finding in the HUD.
 *
 * ⚠️ **The direction is a bearing in degrees rather than a compass point.**
 * A "north-west" picker would need a name-to-bearing table that nothing else
 * in this program has, and the game screen is not where a new vocabulary
 * should be introduced; a number box maps one-for-one onto `DegreesBearing`
 * and onto what a forecast quotes.
 */
function WindControls(props: {
  readonly withWind: boolean;
  readonly onWind: (value: boolean) => void;
  readonly speed: string;
  readonly onSpeed: (value: string) => void;
  readonly fromBearing: string;
  readonly onFromBearing: (value: string) => void;
  readonly speedUnit: string;
  readonly problem: string | undefined;
  /** Which box {@link problem} is about. @see markedFor */
  readonly field: WindProblemField | undefined;
}): JSX.Element {
  /**
   * The validity attributes for one box: set on the box the refusal is
   * **about**, and on no other.
   *
   * ⚠️ Marking both boxes was the first version of this, and it is wrong in a
   * way only a screen reader hears: a rider who left the speed blank was told
   * their perfectly good direction was invalid too, and following its
   * `aria-describedby` took them to a sentence about the speed. #255's pattern
   * is one refusal and one box, so it carries no answer for a second box; this
   * is that answer.
   */
  const markedFor = (
    field: WindProblemField,
  ): {
    readonly 'aria-invalid': true | undefined;
    readonly 'aria-describedby': string | undefined;
  } =>
    props.field === field
      ? { 'aria-invalid': true, 'aria-describedby': WIND_PROBLEM_ID }
      : { 'aria-invalid': undefined, 'aria-describedby': undefined };
  return (
    <div className="oyl-game__wind">
      <label>
        <input
          type="checkbox"
          checked={props.withWind}
          onChange={(event) => {
            props.onWind(event.target.checked);
          }}
        />
        Ride in a wind
      </label>
      <label>
        {`Wind speed, ${props.speedUnit}`}
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step={0.1}
          value={props.speed}
          {...markedFor('speed')}
          onChange={(event) => {
            props.onSpeed(event.target.value);
          }}
        />
      </label>
      <label>
        Wind direction, degrees it blows from
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={MAXIMUM_BEARING_DEGREES}
          step={1}
          value={props.fromBearing}
          {...markedFor('fromBearing')}
          onChange={(event) => {
            props.onFromBearing(event.target.value);
          }}
        />
      </label>
      {/*
        Rendered only when there is a problem, which is what keeps every
        `aria-describedby` naming {@link WIND_PROBLEM_ID} — here and on each
        ride button — from dangling: the attribute and the element it names
        appear and disappear together, under one condition.
      */}
      {props.problem === undefined ? null : (
        <p className="oyl-game__problem" id={WIND_PROBLEM_ID} role="alert">
          {props.problem}
        </p>
      )}
    </div>
  );
}
