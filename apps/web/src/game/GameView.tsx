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
import type { CameraThrottle } from '../camera/session';
import type { SidePairingPort } from '../camera/side-pairing-port';
import {
  SIDE_CAMERA_LABEL,
  SIDE_CAMERA_ON_RIDE_TEXT,
  sideCameraLine,
  sideCameraLost,
  sideCameraLostEvent,
  sideCameraOnRide,
  sideCameraStoppable,
} from '../ride/side-camera';
import { useSideCamera, type SideCameraOnRideState } from '../ride/useSideCamera';
import { BROWSER_THERMAL, type ThermalPort } from './thermal-port';
import { everyInterval, forecastForFrame, watchThermalHeadroom } from './thermal';
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
import {
  INITIAL_QUALITY,
  INITIAL_REALISTIC_QUALITY,
  keepsShadowMap,
  nextWorldQuality,
  qualitySettings,
  readShadowMapChoice,
  rungFor,
  worldRung,
  type QualityLevel,
  type QualitySettings,
  type WorldQualityState,
} from './quality';
import {
  REALISTIC_WORLD_LEFT_NOTICE,
  realisticWorldChosenText,
  realisticWorldNotice,
} from './realistic-assets';
import { readRealisticWorldChoice } from './world-preference';
import { createGradientSession, type GradientSession, type GradientSessionState } from './gradient';
import {
  NO_GAME_TRAINER,
  trainerRoadNotice,
  trainerRoadPromise,
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
import { FramePacer } from './frame-pacer';
import { sceneFrame } from './scene';
import { GameSimulation, ghostClock, type GameState } from './simulation';
import { corridorOrigin } from './terrain';
import type { GameRenderer, GameView as RendererView } from './port';
import { NO_SENSORS, type GameSensors } from './sensors';
import { speedUnit, spokenDistanceUnit } from '../units/format';
import {
  announce,
  INITIAL_ANNOUNCER,
  remainingFrom,
  type AnnouncementEvent,
  type AnnouncerState,
} from './hud/announce';
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
   * The camera, so a phone that has run out of headroom stops encoding
   * photographs before it starts thinning the world (#382).
   *
   * ⚠️ **Narrowed to one method on purpose** — `camera/session.ts`
   * §`CameraThrottle`. The game may say "not now"; it may not turn a camera on,
   * off, or take a picture with one.
   *
   * `undefined` wherever there is no camera port, which is every browser
   * without one, every page opened from the disk, and the accessibility suite.
   */
  readonly camera?: CameraThrottle | undefined;
  /**
   * The platform's thermal forecast — #247. @see thermal-port.ts
   *
   * `BROWSER_THERMAL` when absent, which answers `undefined`: the honest answer
   * everywhere but the Android shell. ⚠️ An optional prop threaded through JSX,
   * so a `main.tsx` that stopped passing the Android port is GREEN in
   * `check:wiring` (§Limits); `GameView.test.tsx` §"#247" drives this half.
   */
  readonly thermal?: ThermalPort | undefined;
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
  /**
   * The tablet's side-camera pairing — #551. While a phone is paired its state
   * is one line on the HUD, its link going is said through the HUD's one
   * region, and *Stop side camera* is on the stage while it films.
   *
   * ⚠️ **Nothing here is a picture** (ADR 0033, the owner's ruling on #527):
   * what is read is `camera/side-pairing-port.ts` §`SideControlState`, which
   * is words about a phone. `ride/side-camera.ts` is the whole of what a ride
   * does with it.
   *
   * ⚠️ An optional prop threaded through JSX, so a shell that stops passing it
   * is green in `check:wiring` (§Limits); `game/side-camera-on-ride.test.tsx`
   * starts a ride through the real shell and reads the HUD, which pins it.
   */
  readonly sidePairing?: SidePairingPort | undefined;
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

/** A ride on the stylised ladder, at its top — every ride that did not choose realism. */
const STYLISED_START: WorldQualityState = { realistic: false, quality: INITIAL_QUALITY };

/**
 * The settings a ride draws with — #475. On the realistic ladder,
 * `quality.ts` §`worldRung`; on the stylised one, `rungFor` as before, which is
 * where the rider shadow map lives. ONE function for the view's first rung,
 * every rung change and the swap once the realistic world has loaded, so the
 * three cannot disagree about which world a ride is in.
 */
function rungOf(world: WorldQualityState, shadowMap: boolean): QualitySettings {
  return world.realistic ? worldRung(world) : rungFor(world.quality.level, shadowMap);
}

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
  /**
   * The rung the ride is drawing at. Only the LEVEL is state — #482.
   *
   * ⚠️ **It used to be the whole `QualityState`, and that re-rendered the HUD
   * on the frames a cap skips.** `nextQuality` returns a new object on every
   * sample, because its `pressure` counter moves on every sample, so each
   * sample was a render — and a sample is taken on the animation frame AFTER a
   * drawn frame, which under a 30 fps cap on a 60 Hz display is every skipped
   * frame. `if (paced.draw)` around the tick's `setState` therefore skipped
   * nothing at 30 fps and a third of what it should at 20; #481's review found
   * the gate untested, and the test written for it (`GameView.test.tsx`
   * §"re-renders the HUD only on the frames it draws") found this. The counter
   * lives in {@link qualityRef}, which nothing renders from.
   */
  const [qualityLevel, setQualityLevel] = useState<QualityLevel>(INITIAL_QUALITY.level);
  /**
   * Whether the ride is on `quality.ts`'s REALISTIC ladder — #475, ADR 0026
   * D-3. The other half of the rung, state for {@link qualityLevel}'s reason:
   * it changes at most twice a ride (chosen at the start; left for good on a
   * failed load or a hot device), and each change is a whole world.
   */
  const [realisticRung, setRealisticRung] = useState(false);
  /**
   * The ladders' full state, pressure included — {@link qualityLevel} says why
   * it is a ref. A {@link WorldQualityState} since #475, so the one policy that
   * moves a ride between the two worlds, `nextWorldQuality`, is the one this
   * loop feeds; for a ride that did not choose realism it IS `nextQuality`.
   */
  const qualityRef = useRef<WorldQualityState>(STYLISED_START);
  /**
   * Whether THIS ride asked for the realistic world — read from the device at
   * the start of the ride (`world-preference.ts`), off unless the rider chose
   * it in Settings. The renderer is asked to load it only when this is true,
   * which is what keeps the realistic set out of every other ride's download
   * (ADR 0026 D-7).
   */
  const realisticWantedRef = useRef(false);
  /**
   * What the rider is told about the world they are riding in, and the ride
   * time at which it was first shown — #475. `undefined` for a ride in the
   * world it asked for. ADR 0026 D-7: *"offline with the realistic world
   * chosen, the game falls back to the stylised world and says so"*; and the
   * same when a hot device steps a ride out of realism.
   */
  const [worldNotice, setWorldNotice] = useState<
    { readonly text: string; readonly from: number } | undefined
  >(undefined);
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
   * The trainer's two sentences, fed to the HUD's ONE region — #445. Until
   * #445 each was a `live` `StatusMessage` of its own, so the HUD carried three
   * regions while a notice stood and a power reading could be said in the same
   * second as either. Rank 1 in `announce.ts` (`trainer-lost`), because a
   * refused gradient write is how control lost ARRIVES in the game (see
   * {@link trainer}) and the road notice is the same fact known at the start.
   *
   * - `roadNoticeRef`: the notice this ride started with, said on its first
   *   frame and then cleared — it was "announced when it appears", and it
   *   appears with the ride.
   * - `gradientFaultRef`: the fault last seen, so one fault is said once.
   */
  const roadNoticeRef = useRef<string | undefined>(undefined);
  /**
   * The trainer port, for `teardown` — #447. A ref because `teardown` is a
   * stable callback that must read the port as it is when the ride ENDS.
   *
   * ⚠️ **This used to be `workoutHeldRef`, sampled once when the ride
   * started, and #448's review is why it is not.** A workout that ran out
   * while the rider was on this route was still "held" at teardown, so the
   * game only `end`ed and the audio context kept running with nothing to play
   * — the idle audio thread #447 set out to stop. What decides it now is the
   * port read at teardown: suspend unless a workout is there AND not finished.
   */
  const trainerPortRef = useRef(props.trainer);
  trainerPortRef.current = props.trainer;
  /**
   * Whether THIS DEVICE asked for the riders' shadow map — #426. Read at the
   * start of each ride, like every other choice here; off unless somebody set
   * it, and there is no control for it (`quality.ts`
   * §`RIDER_SHADOW_MAP_STORAGE_KEY` says why). @see rungFor
   */
  const shadowMapRef = useRef(false);
  const gradientFaultRef = useRef<string | undefined>(undefined);
  /**
   * The side camera — #551. The hook is what re-renders the HUD when the
   * phone's state changes, including while the ride is paused and the loop is
   * not running; the ref is what the loop reads, so `tick` does not re-run
   * when the port does. `sideLostRef` is what the loop last saw, so a lost
   * link is said once, when it goes — `side-camera.ts` §`sideCameraLostEvent`.
   */
  const sideCamera = useSideCamera(props.sidePairing);
  const sidePairingRef = useRef(props.sidePairing);
  sidePairingRef.current = props.sidePairing;
  const sideLostRef = useRef(false);
  /**
   * This ride's sounds — #400. Made inside the *Ride* press, so the audio
   * context is resumed from a gesture.
   *
   * ⚠️ **Released in `teardown` since #447, and this note used to say it was
   * deliberately NOT ended there** — because the game plays only the short
   * distance sound, which stops by itself, so an `end` there was unobservable
   * and deleting it left every test green. What #447 adds is observable: the
   * port is told it may `suspend`, and `sounds.a11y.test.tsx` counts that. A
   * ride that ENDS while a workout is still running — read from the port at
   * that moment, {@link trainerPortRef} — only `end`s, because its tone must
   * find the context awake.
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
   * ⚠️ **A ref rather than the `qualityLevel` state, for the same reason the
   * loop below does not depend on it.** That effect is deliberately not
   * re-run on a rung change, so the level it closes over is the one the
   * ride started at — reading `qualitySettings(qualityLevel).scatterItems`
   * inside `tick` would hand `sceneFrame` the target rung's budget for the
   * whole ride and every test of it would pass. The effect that tells the
   * renderer about the new rung is the one place the two are kept together.
   */
  const scatterItemsRef = useRef<number>(qualitySettings(INITIAL_QUALITY.level).scatterItems);
  /**
   * The rung's structure budget — #460 — held the way {@link scatterItemsRef}
   * is and for its reason.
   */
  const structureItemsRef = useRef<number>(qualitySettings(INITIAL_QUALITY.level).structureItems);
  /**
   * The rung's frame cap — #476 — held the way {@link scatterItemsRef} is, for
   * the same reason: the loop does not re-run on a rung change.
   */
  const frameCapRef = useRef<number>(qualitySettings(INITIAL_QUALITY.level).frameCap);
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
   * Whether a press on *Ride* is still on its way to a ride — #509.
   *
   * ⚠️ **The guard against a second press, and it is a ref rather than the
   * `asking` state below on purpose.** `start` awaits a full FTMS control
   * procedure for a `no-control` trainer — bounded at five seconds after the
   * write, and the write can take longer — and until #509 *Ride* stayed live
   * for all of it: a second press ran `start` again, `readTrainer` still said
   * `no-control`, a second Request Control was queued, and two `start`s then
   * raced — two gradient sessions, two simulations, two screen locks with one
   * of them leaked. State would re-render the button `aria-disabled`, which is
   * a promise to a screen reader and nothing to a click, and it could not
   * refuse a press that lands before that render. This refuses in `start`.
   */
  const startingRef = useRef(false);
  /**
   * Whether the trainer has been asked for control and has not yet answered —
   * #509. The picker says so and marks *Ride* unavailable while it is true.
   * The refusal itself is {@link startingRef}; this is what the rider sees.
   */
  const [asking, setAsking] = useState(false);
  /**
   * Whether this component has been unmounted — #509.
   *
   * `start` checks it after each of its awaits and returns rather than
   * carrying on into a component that is gone: `teardown` has already run by
   * then, so a session built or a lock acquired afterwards would be released
   * by nothing. Reset in the effect's body rather than only set in its
   * cleanup, because `main.tsx` mounts under `StrictMode`, which runs the
   * cleanup once on mount and mounts again.
   */
  const unmountedRef = useRef(false);
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
    // #447: the ride is over, so the audio may stop running — unless a workout
    // is still running on the Ride screen's session, whose tone `rejoin`
    // expects to find awake. Read NOW, not at the start of the ride: the
    // workout may have finished meanwhile. @see trainerPortRef
    const cues = cuesRef.current;
    if (cues !== undefined) {
      const live = trainerPortRef.current?.readTrainer();
      if (live?.kind === 'workout' && live.workoutFinished !== true) {
        cues.end();
      } else {
        cues.release();
      }
    }
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

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  /** The ride itself, once {@link start} has let the press through. */
  const begin = useCallback(
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
      // #509: the rider may have left while the ghost loaded. @see unmountedRef
      if (unmountedRef.current) {
        return;
      }
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
      // #551: a link already lost when the ride starts is on the HUD's line,
      // and is not news — only a link that goes DURING this ride is said.
      sideLostRef.current = sideCameraLost(
        sidePairingRef.current?.currentSideCamera()?.control.sideControlState(),
      );
      // #475: which world this ride asked for, read from the device like every
      // other choice here. A ride starts at the top of its ladder — the
      // realistic one only for a rider who chose it (ADR 0026 D-3) — and the
      // shadow map is not asked for on a realistic ride: its rung is a
      // STYLISED one, and a ride that stepped out of realism because it was hot
      // must land on the stylised top, not on something heavier.
      const realistic = readRealisticWorldChoice(deviceStorage());
      realisticWantedRef.current = realistic;
      qualityRef.current = realistic ? INITIAL_REALISTIC_QUALITY : STYLISED_START;
      setQualityLevel(INITIAL_QUALITY.level);
      setRealisticRung(realistic);
      setWorldNotice(undefined);
      shadowMapRef.current = !realistic && readShadowMapChoice(deviceStorage());
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
      //
      // ⚠️ #503: **the rider's press on Ride is what asks the trainer for
      // control**, and this is the only line in the game that does. Only for a
      // trainer that would take a gradient and has not granted control — a
      // workout's trainer, a machine without simulation mode and one with no
      // control point are never asked, because `readTrainer` decides those
      // first. Never on mount: entering the game screen asks nothing and
      // writes nothing. A refusal is not thrown; the re-read below is what
      // says whether it was granted, and `trainerRoadNotice` says so if not.
      let found = props.trainer?.readTrainer() ?? NO_GAME_TRAINER;
      if (found.kind === 'no-control' && props.trainer !== undefined) {
        // #509: said on the picker for as long as the machine takes to answer.
        setAsking(true);
        try {
          await props.trainer.askForControlOnRide();
        } catch {
          // The ride still starts; the re-read reports `no-control` and the
          // rider is told the hills are not reaching the trainer.
        } finally {
          setAsking(false);
        }
        // #509: the rider may have left while the trainer was being asked.
        // `teardown` has run; a session built now would be stopped by nothing
        // and a lock acquired now released by nothing. If control was granted
        // in that window it is simply kept, which is #372's rule: nothing
        // takes control back after a release, and nothing releases here.
        if (unmountedRef.current) {
          return;
        }
        found = props.trainer.readTrainer();
      }
      setTrainer(found);
      // #445: this ride's notice, for its first frame. @see roadNoticeRef
      const notice = trainerRoadNotice(found, 'riding');
      roadNoticeRef.current =
        notice === undefined ? undefined : `The road is not reaching your trainer: ${notice}`;
      gradientFaultRef.current = undefined;
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
      const lock = (await props.screenLock?.acquire()) ?? NO_SCREEN_LOCK;
      // #509: the same shape one await later. `teardown` has released the
      // placeholder already; this lock would keep the screen awake with
      // nothing on it.
      if (unmountedRef.current) {
        void lock.release();
        return;
      }
      lockRef.current = lock;
    },
    [port, props.screenLock, props.riderMass, props.trainer, soundsOut],
  );

  const start = useCallback(
    async (
      route: RidableRoute,
      ghost: boolean,
      pacer: BotPacerPlan | undefined,
      air: Wind | undefined,
      sitting: RidingPosition,
    ): Promise<void> => {
      // #509: one press is one ride. @see startingRef
      if (startingRef.current) {
        return;
      }
      startingRef.current = true;
      try {
        await begin(route, ghost, pacer, air, sitting);
      } finally {
        startingRef.current = false;
      }
    },
    [begin],
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
    // #476: which animation frames are drawn under the rung's cap, and what the
    // ladder is told about them. @see FramePacer
    const pacer = new FramePacer();
    // #247. Read on its own slow clock and held for the frame, because the
    // forecast is a bridge round trip that Android rate-limits. @see thermal.ts
    const headroom = watchThermalHeadroom(props.thermal ?? BROWSER_THERMAL, everyInterval);
    // The last reading held when the ladder moved. One reading moves it one
    // rung at most — `thermal.ts` §`forecastForFrame` says why, and why a
    // spent reading is neutral rather than absent.
    let spentReading = 0;

    /** Whether this run of the effect has been cleaned up. @see the renderer's `then` below */
    let cancelled = false;
    const canvas = canvasRef.current;
    const load = props.renderer;
    if (canvas !== null && viewRef.current === undefined && load !== undefined) {
      // Awaited without blocking the loop: the first frames draw nothing and the
      // simulation advances regardless, which is exactly the decoupling
      // `simulation.ts` is about. A rider whose GPU is slow to hand over a
      // context still gets a HUD and a ride.
      void load().then((renderer) => {
        // ⚠️ Not after this effect has been cleaned up — found by #475's
        // tests. A rider who ends the ride while `three` is still arriving has
        // had the stage unmounted, and a view built then would hold a GL
        // context on a detached canvas that nothing destroys — and the NEXT
        // ride would find `viewRef` set, build no view of its own, and draw
        // into that detached canvas: a black world. A pause cleans up too, and
        // the resume's own run of this effect builds the view instead.
        if (cancelled) {
          return;
        }
        if (viewRef.current === undefined) {
          const view = renderer.create(canvas, rungOf(qualityRef.current, shadowMapRef.current));
          viewRef.current = view;
          view.resize(canvas.clientWidth || 320, canvas.clientHeight || 180);
          // #475: the realistic world, for a ride that asked for it — AFTER
          // the view exists, so the rider rides the stylised world while ~33
          // MiB arrive rather than a black canvas, and the swap is one whole
          // world for another (ADR 0026 D-3) the moment it is all here.
          if (realisticWantedRef.current) {
            void renderer.loadRealisticWorld().then((outcome) => {
              // The ride this was for may have ended, or stepped out of
              // realism, while the files arrived.
              if (viewRef.current !== view || !qualityRef.current.realistic) {
                return;
              }
              if (outcome.loaded) {
                view.setQuality(rungOf(qualityRef.current, shadowMapRef.current));
                return;
              }
              // D-7: the stylised world's TOP, every kind at once, and said.
              qualityRef.current = STYLISED_START;
              setQualityLevel(INITIAL_QUALITY.level);
              setRealisticRung(false);
              const text = realisticWorldNotice(outcome);
              if (text !== undefined) {
                setWorldNotice({ text, from: simulationRef.current?.state.elapsed ?? 0 });
              }
            });
          }
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
      // ⚠️ **The frame cap decides whether this animation frame is DRAWN — #476
      // — and nothing else.** Everything the ride itself needs runs on every
      // animation frame as it always has: the simulation advances to now (its
      // step is fixed at 20 Hz and derived from its origin, so how often it is
      // asked cannot move the rider), the cranks turn, the ghost's outcome is
      // settled, the announcer listens and the gradient is sampled — so what is
      // written to a trainer, and when, does not depend on the rung. What a cap
      // skips is the picture: the HUD's re-render and the world's draw.
      const paced = pacer.frame(at, frameCapRef.current);
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
      if (paced.draw) {
        setState(simulation.state);
      }

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
      // #445: the trainer's sentences go through the SAME core, so the order in
      // `announce.ts` is the order a rider hears. @see roadNoticeRef
      const events: AnnouncementEvent[] = [];
      if (roadNoticeRef.current !== undefined) {
        events.push({ kind: 'trainer-lost', text: roadNoticeRef.current });
        roadNoticeRef.current = undefined;
      }
      const fault = gradientRef.current?.state().fault;
      if (fault !== gradientFaultRef.current) {
        gradientFaultRef.current = fault;
        if (fault !== undefined) events.push({ kind: 'trainer-lost', text: `Trainer: ${fault}` });
      }
      if (slope.event !== undefined) events.push(slope.event);
      // #551: the side camera's link going, once, when it goes.
      const side = sidePairingRef.current?.currentSideCamera()?.control.sideControlState();
      const sideLost = sideCameraLostEvent(sideLostRef.current, side);
      sideLostRef.current = sideCameraLost(side);
      if (sideLost !== undefined) events.push(sideLost);
      const heard = announce(announcerRef.current, {
        now: simulation.state.elapsed,
        readings,
        ...(remaining === undefined ? {} : { remaining }),
        events,
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

      // #323's interpolation, on the frames that are drawn: `drawnAt` blends the
      // last two simulation steps at THIS instant, so a frame drawn at 20 fps
      // is placed exactly where one drawn at 60 would have been at that moment.
      const drawn = paced.draw ? simulation.drawnAt(at) : undefined;
      if (drawn !== undefined)
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
            // #460, the same shape for the same reason. @see structureItemsRef
            structureItems: structureItemsRef.current,
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
      //
      // ⚠️ **Since #476 it is the pacer's sample, not the gap since the last
      // animation frame.** Under a cap that gap is either a skipped frame's
      // idle vsync — a "fast frame" that would climb a hot device back up — or
      // the cap itself, 50 ms at 20 fps, which the ladder would read as heat
      // for ever. `frame-pacer.ts` samples only the gap that follows a DRAWN
      // frame, which on the uncapped top rung is exactly what this was.
      // ⚠️ **Read and closed over BEFORE the updater, and that was the whole
      // of #245's second finding** — there has been no updater since #482,
      // which feeds the ladder synchronously through `qualityRef`.
      // `lastFrameAt` is a `let` in this effect's
      // scope, so an updater that subtracted it *inside* the closure would be
      // captured by reference — and React invokes an updater during the next
      // render, by which time the line below has already moved it to `at`. The
      // ladder was therefore fed `frameMs: 0` on every frame of every ride:
      // always "cool", never hot, so the reduction path #91 asks for could not
      // fire at all. `thermalHeadroom` was `undefined` in the shipped app
      // until #247 (`docs/validation/0002-android-shell-and-game.md` Part E),
      // so this was the only live input to the whole policy. Since #247 the
      // Android shell supplies the forecast too, and outside it this is still
      // the only live input.
      const frameMs = paced.frameMs;
      lastFrameAt = at;
      if (frameMs !== undefined) {
        const previous = qualityRef.current;
        const forecast = headroom.latest();
        const next = nextWorldQuality(previous, {
          frameMs,
          thermalHeadroom: forecastForFrame(forecast, spentReading),
        });
        if (
          next.quality.level !== previous.quality.level ||
          next.realistic !== previous.realistic
        ) {
          spentReading = forecast.reading;
        }
        qualityRef.current = next;
        // A render only when the RUNG changes — #482. @see qualityLevel
        if (next.quality.level !== previous.quality.level) {
          setQualityLevel(next.quality.level);
        }
        // #475: out of realism for the rest of the ride, and said.
        if (next.realistic !== previous.realistic) {
          setRealisticRung(next.realistic);
          setWorldNotice({ text: REALISTIC_WORLD_LEFT_NOTICE, from: simulation.state.elapsed });
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      headroom.stop();
    };
    // ⚠️ The quality level is read inside `tick` and is deliberately NOT a
    // dependency. Re-running this effect on every quality change would cancel
    // the frame, destroy the renderer and rebuild it mid-ride — and quality
    // changes exactly when the phone is least able to afford that. It is read
    // through `qualityRef`, which does not go stale (#482; it was `setQuality`'s
    // updater form until then), and the level is applied to the live renderer
    // by the effect below instead.
  }, [phase, chosen, port, props.renderer, props.now, props.thermal]);

  useEffect(() => {
    // #426, the latch: a step down takes the shadow map away for the rest of
    // the ride, and climbing back to level 0 does not return it. Only the next
    // ride's start re-reads the device's choice. `quality.ts` §`keepsShadowMap`
    // says why a rung that came back would flap.
    shadowMapRef.current = keepsShadowMap(shadowMapRef.current, qualityLevel);
    const settings = rungOf(
      { realistic: realisticRung, quality: { level: qualityLevel, pressure: 0 } },
      shadowMapRef.current,
    );
    // ⚠️ Both halves of the rung, from one place. The renderer stops submitting
    // the instances and `sceneFrame` stops placing them — #245, and
    // `ScatterBelt.setBudget` says why neither alone is the whole of it.
    scatterItemsRef.current = settings.scatterItems;
    structureItemsRef.current = settings.structureItems;
    // #476: the loop reads this on its next animation frame.
    frameCapRef.current = settings.frameCap;
    viewRef.current?.setQuality(settings);
    // #382. The rung's fifth figure, and the only one that leaves this file —
    // `quality.ts` §`QualitySettings.capture` argues why capture is the first
    // thing a warming phone gives up and why this does NOT stop the camera.
    props.camera?.throttle(settings.capture);
    // #390. The rung's presence figure, from the same place and for the
    // converse reason: the work that is not the world goes before any of it.
    // `quality.ts` §`QualitySettings.presence` says why giving it up is safe.
    props.camera?.throttlePresence(settings.presence);
  }, [qualityLevel, realisticRung, props.camera]);

  useEffect(() => {
    // #514 part 3. The ladder is the game's and no other screen runs one, so
    // what it withdrew is handed back when the game lets go of the camera —
    // on unmount, and to the OLD camera when the prop is replaced (the effect
    // above then throttles the new one from the rung the ride is on). Until
    // #514 a phone that stepped down in a game ride left presence `unknown`
    // for a workout on the Ride screen afterwards, with nothing saying so.
    // That was the safe direction — `unknown` never pauses — but it silently
    // undid #390 for the next ride.
    const camera = props.camera;
    return () => {
      camera?.throttle(true);
      camera?.throttlePresence(true);
    };
  }, [props.camera]);

  if (!onTheStage) {
    // One snapshot read for both notices, so they describe the same moment.
    const trainerNow = props.trainer?.readTrainer();
    return (
      <RoutePicker
        routes={routes}
        // ⚠️ Read **here** rather than reusing the ride's captured state: a
        // workout started or ended on the Ride screen changes what is true
        // before the next press. A snapshot read, so it costs a property access
        // per render and never opens a connection — and asks nothing (#503).
        trainerNotice={trainerRoadNotice(trainerNow ?? NO_GAME_TRAINER, 'before-ride')}
        // #509: whether the press has asked and the trainer has not answered.
        asking={asking}
        // #503: what the press on Ride will do to the trainer, said before it.
        trainerPromise={trainerRoadPromise(trainerNow ?? NO_GAME_TRAINER)}
        // #475: a snapshot read for the trainer notice's reason — a rider who
        // changes the choice in Settings and comes back sees it here at once.
        worldChosen={readRealisticWorldChoice(deviceStorage())}
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
  const roadNotice = trainerRoadNotice(trainer, 'riding');
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
        // #551: the side camera's one line and its Stop. A lost link is not
        // here but in `notices` below — it is the exception, and a steady
        // "filming" in the notice slot would take a phone's route panel for
        // the whole ride, which is #437's defect.
        sideCamera={sideCameraOnHud(sideCamera)}
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
                  // ⚠️ Not `live` since #445: the HUD's one region says it, on
                  // the ride's first frame, in the announcer's order
                  // (@see roadNoticeRef). It is still here for a rider who
                  // can see it.
                  <StatusMessage tone="warning" label="The road is not reaching your trainer">
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
          // #551: the side camera's link lost, in the notice slot the HUD
          // gives an exception. Not `live`: the HUD's one region says it.
          sideCameraLost(sideCamera.state) ? (
            <StatusMessage key="side-camera" tone="warning" label={SIDE_CAMERA_LABEL}>
              {SIDE_CAMERA_ON_RIDE_TEXT.lost}
            </StatusMessage>
          ) : undefined,
          gradient?.fault === undefined ? undefined : (
            // Not `live` since #445, for the road notice's reason above.
            <StatusMessage key="fault" tone="danger" label="Trainer">
              {gradient.fault}
            </StatusMessage>
          ),
          // #475, ADR 0026 D-7's "and says so". For STANDING_NOTICE_SECONDS of
          // ride from when it was first shown, on the ride's clock, and then
          // out of the way: it is a fact about the picture rather than a thing
          // to act on, and on a phone a notice costs the route panel's cell
          // (#437). Not `live`: the world is `aria-hidden` above, so what it
          // looks like is not a thing the HUD's one region speaks about.
          worldNotice === undefined ||
          (state?.elapsed ?? 0) - worldNotice.from >= STANDING_NOTICE_SECONDS ? undefined : (
            <StatusMessage key="world" tone="info" label="Standard world">
              {worldNotice.text}
            </StatusMessage>
          ),
        ]}
      />
    </section>
  );
}

/**
 * The side camera as the HUD's actions panel shows it — #551: the line, or
 * nothing while the link is lost (the notice slot has it then), and *Stop
 * side camera* while there is something to stop. `undefined` with no pairing.
 */
function sideCameraOnHud(
  sideCamera: SideCameraOnRideState,
): { readonly line: string | undefined; readonly onStop: (() => void) | undefined } | undefined {
  const line = sideCameraOnRide(sideCamera.state);
  if (line === undefined) {
    return undefined;
  }
  return {
    line: line === 'lost' ? undefined : sideCameraLine(line),
    onStop: sideCameraStoppable(sideCamera.state) ? sideCamera.stop : undefined,
  };
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
   * What pressing *Ride* will do to the trainer — #503. `undefined` unless the
   * route's hills will reach it. @see trainerRoadPromise
   */
  readonly trainerPromise: string | undefined;
  /**
   * Whether *Ride* has been pressed and the trainer has not yet answered the
   * request for control — #509. The picker says so in place of the promise,
   * and every *Ride* is marked unavailable. The refusal of a second press is
   * `GameView`'s own (§`startingRef`); this is only what the rider is told.
   */
  readonly asking: boolean;
  /**
   * The last release the trainer did not confirm — #372. `undefined` almost
   * always. @see GameTrainer.releaseFault
   */
  readonly releaseNotice: string | undefined;
  /** Where the rider's hands are — #365. @see RIDING_POSITIONS */
  readonly position: RidingPosition;
  readonly onPosition: (value: RidingPosition) => void;
  /** Whether this device chose the realistic world — #475. @see realisticWorldChosenText */
  readonly worldChosen: boolean;
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
      {props.asking ? (
        // #509: the press has asked, and the machine has up to the FTMS
        // procedure's timeout to answer. Said here, in the promise's place,
        // and `live` because it is a change the rider caused.
        <StatusMessage tone="info" label="Your trainer" live>
          Asking your trainer for control. The ride starts when it answers.
        </StatusMessage>
      ) : props.trainerPromise === undefined ? undefined : (
        // ⚠️ #503: **the sentence that makes the Ride press the rider's
        // decision** rather than the screen's. It is above the button, so a
        // rider reads that the trainer will follow the hills before the press
        // that asks it for control. Not `live`: nothing changed, it is simply
        // what this screen says.
        <StatusMessage tone="info" label="Your trainer">
          {props.trainerPromise}
        </StatusMessage>
      )}
      {props.trainerNotice === undefined ? undefined : (
        // ⚠️ **Before the ride rather than only during it**, because a rider
        // who can end a workout, or choose to ride without resistance, can only
        // do so before they start. It does not block the ride: a rider who
        // wants to ride a route with no resistance is allowed to, and #362's
        // criterion is that they are told, not that they are stopped. Since
        // #503 `no-control` is not one of these — the press asks.
        <StatusMessage tone="warning" label="The road will not reach your trainer">
          {props.trainerNotice}
        </StatusMessage>
      )}
      {props.worldChosen ? (
        // #475: the offline fallback stated BEFORE the ride, where a rider can
        // still act on it, and the way back to the choice.
        // @see realisticWorldChosenText
        <StatusMessage tone="info" label="Realistic world">
          {realisticWorldChosenText()}{' '}
          <a href={hrefFor(routeById('settings'))}>Change this in Settings</a>.
        </StatusMessage>
      ) : undefined}
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
              // #509: unavailable while the trainer is being asked, as well
              // as while a box refuses. The click is not guarded on `asking`
              // here — `GameView` §`startingRef` refuses it, so the refusal
              // holds for a press that lands before this re-renders.
              aria-disabled={refused || props.asking ? true : undefined}
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
