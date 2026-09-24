// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The live ride screen, with no screen: pairing, live metrics, trainer control
 * and the recording lifecycle, as one observable object.
 *
 * ## Why the screen's logic is not in the component
 *
 * Three of #49's acceptance criteria are about time — a sensor going quiet, a
 * setpoint that has been written and not yet confirmed, a four-hour run at
 * 1 Hz — and one is about four hours of it. A React component is the wrong
 * place to assert any of those: the test would be a DOM query wrapped around an
 * `act()` wrapped around a fake timer, and the four-hour case would be
 * fourteen thousand renders. So the state machine lives here, is driven by
 * `tick(now)` with an injected clock, and `RideView.tsx` is a projection of
 * {@link RideSnapshot} onto markup. `endurance.test.ts` runs four hours of it
 * in about a second.
 *
 * ## The three rules this file exists to keep
 *
 * 1. **A setpoint is requested until the trainer confirms it.** `requested` and
 *    `control.targetPower()` are separate fields and the screen renders them
 *    differently. #43's client already refuses to call a target confirmed
 *    before the machine's indication arrives; what this file adds is that the
 *    *pending* state is visible rather than optimistic. An ERG target shown as
 *    250 W while the trainer is doing something else is worse than showing
 *    nothing.
 * 2. **Control that has been lost is said out loud.** `onControlLost` sets
 *    {@link TrainerSnapshot.lost}, and every path that could quietly clear it
 *    goes through `requestTrainerControl`, which is a thing the rider does.
 *    ⚠️ Since #372 every release — the end of a ride, of a workout, of manual
 *    ERG, of a game ride — goes through ONE function, {@link releaseTrainer},
 *    which sends an FTMS Stop. A release is not a loss and is not reported as
 *    one (no warning, and a workout ends rather than pausing), and nothing
 *    takes control back after one. ⚠️ PR #442 first made that release a Reset,
 *    which revoked control; a reviewer who remembers the screen returning to
 *    *Ask the trainer for control* after every ride is reading the old file.
 *    On the trainer measured, the Reset cleared nothing a Stop did not.
 * 3. **A silent channel reads as unavailable, never as its last number.** The
 *    controller keeps the last reading only to compute *how long ago* it was;
 *    `metrics.ts` is what decides what the screen may say, and it has no
 *    variant that carries a stale value.
 *
 * ## What is deliberately not here
 *
 * **No automatic reconnection.** Web Bluetooth has no silent reconnect that is
 * shippable in 2026 (CLAUDE.md §8) and `requestDevice` needs a gesture per
 * device. A dropped sensor becomes a visible state and a button; a controller
 * that retried in a loop would produce a screen that appears to be connecting
 * for ever.
 *
 * **No timers.** `tick(now)` is called by whatever owns the clock — a browser
 * interval in `useRideController`, a loop in a test. A controller that set its
 * own interval could not be run for four simulated hours, and could not be torn
 * down deterministically.
 */

import {
  expandWorkout,
  type WorkoutTimeline,
  seconds,
  unixSeconds,
  type PlayerStatus,
  type Seconds,
  type UnixSeconds,
  type Watts,
  type WorkoutBlock,
} from '@onyourleft/domain';
import {
  isSensorError,
  type ConnectionState,
  type DeviceId,
  type MeasurementCapability,
  type SensorCapability,
  type SensorDevice,
  type SensorMeasurement,
  type SensorTransport,
  type Unsubscribe,
} from '@onyourleft/sensors';
import type {
  ControlLossReason,
  SupportedPowerRange,
  TargetPower,
  TrainerControl,
  TrainerControlChoice,
  TrainerRelease,
} from '@onyourleft/sensors/protocol';
import type { ActivityId, AthleteId, RecordingSessionId, WorkoutRecord } from '@onyourleft/store';

import {
  createRecorder,
  type Recorder,
  type RecorderStorageState,
  type RecordingCheckpointStore,
  listRecoverableRecordings,
  recoverRecorder,
} from '../recording/recorder';
import { recoverableRides, type RecoverableRide } from '../recording/recovery';
import { rideToSave, saveFinishedRide, type RideSaveStore } from '../recording/finish';

import {
  metricStateFor,
  METRIC_STALE_AFTER_SECONDS,
  type LatestReading,
  type MetricState,
  type RideMetricId,
} from './metrics';
import type { RiderPresence, RiderPresencePort } from './presence-port';
import type { RideKeepAlivePort } from './keep-alive-port';
import { NO_TRAINER_CONTROL, type OpenTrainer, type TrainerConnection } from './trainer';
import { createWorkoutSession, RELEASE_INCOMPLETE, type WorkoutSession } from '../workout/session';
import { blockText } from '../workouts/library';

/** Which channel each metric on the screen reads from. */
const METRIC_CAPABILITY: Readonly<Record<RideMetricId, MeasurementCapability>> = {
  power: 'power',
  cadence: 'cadence',
  heartRate: 'heart-rate',
  speed: 'speed',
};

/** The order the metrics are shown in, largest first. Power leads a ride screen. */
export const RIDE_METRIC_IDS: readonly RideMetricId[] = ['power', 'cadence', 'heartRate', 'speed'];

/**
 * What the athlete is pairing, and what that means to the chooser.
 *
 * One entry per **gesture**, because `requestDevice()` needs one per device and
 * cannot be called programmatically. There is deliberately no "pair everything"
 * role: it cannot exist, and a button that looked like it could would fail on
 * the second device with no explanation.
 *
 * The trainer entry asks for power, cadence *and* speed in one request, which
 * is the revision block's instruction to *"prefer taking power and cadence from
 * the trainer's own FTMS stream over pairing separate sensors"* — one
 * connection out of about three, rather than three. Since #156 it also asks for
 * `trainer-control`, which is a capability a request may name in its own right
 * rather than something the three measurements happen to drag in behind them.
 */
export type PairingRole = 'trainer' | 'heart-rate' | 'power-meter' | 'speed-cadence';

export const PAIRING_ROLE_CAPABILITIES: Readonly<Record<PairingRole, readonly SensorCapability[]>> =
  {
    // ⚠️ `trainer-control` is **named**, not arrived at (#156). FTMS supplies
    // power, cadence and speed, so before it the Fitness Machine Service landed
    // in the origin's grant as a side effect of this list wanting the
    // measurements — and narrowing the list would have removed the ability to
    // control the trainer, surfacing as `capability-unsupported` on a device the
    // athlete deliberately paired as a trainer. It is the grant that makes
    // `openFitnessMachine` reachable at all (#152 refuses an ungranted control
    // point), so it is stated rather than inherited.
    trainer: ['power', 'cadence', 'speed', 'trainer-control'],
    'heart-rate': ['heart-rate'],
    'power-meter': ['power'],
    'speed-cadence': ['speed', 'cadence'],
  };

/** One paired device, as the screen lists it. */
export interface PairedSensor {
  readonly id: DeviceId;
  readonly name: string;
  readonly role: PairingRole;
  readonly capabilities: readonly MeasurementCapability[];
  readonly state: ConnectionState;
}

/** Everything the screen may say about the trainer. */
export interface TrainerSnapshot {
  /** A trainer is paired. Says nothing about whether it can be controlled. */
  readonly paired: boolean;
  /** The trainer serves a control point and reported a power range. */
  readonly controllable: boolean;
  /**
   * Which control point the machine offers, from everything the link resolved
   * (#370).
   *
   * ⚠️ **Not the same question as {@link controllable}, and that is the whole
   * of what #370 added.** `controllable` is *"this app will drive it"*;
   * this is *"what is there"*. The pair that used to be impossible to tell
   * apart is `vendor-not-implemented` — a real trainer with a real control
   * point this program has decided not to write to — and `none`, which is a
   * heart rate strap. `TrainerPanel` says a different sentence for each.
   *
   * `none` when nothing is paired, and also when the transport could not say.
   * An empty answer is the absence of information rather than a claim.
   */
  readonly controlChoice: TrainerControlChoice;
  /** Target Setting bit 3. `false` hides the ERG control rather than disabling it. */
  readonly canSetPower: boolean;
  /**
   * Target Setting bit 13 — whether the machine accepts Set Indoor Bike
   * Simulation Parameters (#362).
   *
   * ⚠️ **Read by the trainer game and by nothing on this screen**, which is why
   * it sat on `TrainerConnection` unpublished until #362. `game/trainer-port.ts`
   * §`gameTrainerFrom` is the one consumer, and a machine reporting `false` here
   * is never written a gradient — #49's revision block: *"Offering a control the
   * trainer will refuse is worse than not offering it."*
   *
   * `false` also where no trainer is connected, exactly as {@link canSetPower}
   * is: `TrainerConnection.canSimulate` already defaults an **absent** Feature
   * characteristic to `true`, so this is `false` only when a machine said it
   * cannot or there is no machine.
   */
  readonly canSimulate: boolean;
  readonly powerRange: SupportedPowerRange | undefined;
  /** Whether the machine has granted control and has not taken it back. */
  readonly hasControl: boolean;
  /**
   * What #43's client believes the target to be — `none`, `confirmed` or
   * `unknown`. The screen renders `confirmed` and nothing else as a number the
   * trainer is holding.
   */
  readonly target: TargetPower;
  /** Written and not yet answered. Rendered as *requested*, never as active. */
  readonly requested: Watts | undefined;
  /** Set when control was lost, and cleared only by asking for it again. */
  readonly lost: ControlLossReason | undefined;
  /**
   * Set when the last release could not be confirmed — the trainer refused or
   * did not answer the Stop (#372). Words a rider can act on: the trainer may
   * still be holding resistance. ⚠️ Its absence is not a claim that the
   * trainer let go: an acknowledged Stop does not clear a target on the
   * trainer measured.
   *
   * ⚠️ A separate field from {@link refusal} because it is a different claim
   * about a different moment: a refusal is about a setpoint the rider asked
   * for, this is about a machine they may be about to step off. Cleared by the
   * next confirmed release and by taking control again.
   */
  readonly releaseFault: string | undefined;
  /** Why the last setpoint was refused, for a screen that says more than "failed". */
  readonly refusal: string | undefined;
}

/** A metric and what the screen may say about it. */
export interface RideMetric {
  readonly id: RideMetricId;
  readonly state: MetricState;
}

export type RidePhase = 'idle' | 'recording' | 'paused' | 'stopped';

/**
 * Whether a ride is under way — recording or paused, and in either case not yet
 * saved.
 *
 * A **paused** ride counts. It is unsaved in exactly the way a recording one
 * is, and a rider gets no second chance once the page has gone.
 *
 * Here rather than inlined at each caller because there are now three: the
 * unload guard (#49), the ride session, and since #407 the service worker's
 * update interlock — which must refuse to reload the page over a ride that is
 * merely paused as firmly as over one that is recording.
 */
export function rideInProgress(phase: RidePhase): boolean {
  return phase === 'recording' || phase === 'paused';
}

/**
 * A structured workout being ridden, as the screen reads it (#14).
 *
 * `undefined` on {@link RideSnapshot} when no workout is loaded, which is the
 * ordinary case: a ride is a ride.
 */
export interface RideWorkoutSnapshot {
  readonly name: string;
  readonly status: PlayerStatus;
  /** How far into the workout, excluding paused time. */
  readonly elapsedSeconds: number;
  readonly totalSeconds: number;
  /** What the trainer last confirmed it holds, after quantisation. */
  readonly holdingWatts: number | undefined;
  /** The block being ridden, in the words `library.ts` writes. */
  readonly nowRiding: string | undefined;
  /** Why the last workout write could not be made, if any. */
  readonly fault: string | undefined;
  /**
   * The plan itself, so a screen can look AHEAD in it — #398. The same
   * timeline the session plays; `segmentAt(timeline, elapsed + lead)` is the
   * whole lookahead, with {@link elapsedSeconds} as the one clock.
   */
  readonly timeline: WorkoutTimeline;
}

/** Everything the view renders, and nothing it has to derive. */
export interface RideSnapshot {
  readonly phase: RidePhase;
  /** Whether the rider has pressed Stop once. A second press is what stops. */
  readonly stopArmed: boolean;
  readonly elapsedSeconds: number;
  readonly movingSeconds: number;
  readonly sampleCount: number;
  readonly metrics: readonly RideMetric[];
  readonly sensors: readonly PairedSensor[];
  readonly trainer: TrainerSnapshot;
  /** The workout being ridden, or `undefined` — see {@link RideWorkoutSnapshot}. */
  readonly workout: RideWorkoutSnapshot | undefined;
  readonly storage: RecorderStorageState;
  /** Where the finished ride got to. See {@link RideSaveState}. */
  readonly saveState: RideSaveState;
  /** What the save failed with, for a screen that wants to say more than "failed". */
  readonly saveError: string | undefined;
  /** The activity a finished ride became, so a screen can link to it. */
  readonly savedActivityId: ActivityId | undefined;
  /**
   * The ride saved, and its checkpoint could **not** be removed afterwards.
   *
   * A rare pair — a successful multi-write save followed by a failed delete —
   * and its consequence is visible rather than silent: the leftover is offered
   * back on the next visit, and a rider who was not told would read it as a
   * ride that failed to save and press Save again. It is a separate flag from
   * `saveState` because the ride *is* saved; only the tidying is not done.
   */
  readonly leftover: boolean;
  /**
   * Rides this device is still holding — #212.
   *
   * Empty while riding, and never includes the recording in progress. See
   * `recording/recovery.ts` for why a `stopped` one is offered different
   * controls from an interrupted one.
   */
  readonly recoverable: readonly RecoverableRide[];
  /** The last pairing attempt's failure, in words a rider can act on. */
  readonly pairingError: string | undefined;
  /** How many more devices this transport will connect. */
  readonly connectionsRemaining: number;
}

/**
 * What a finished ride needs to become an activity — #14's fourth criterion,
 * and the "store it" in `CLAUDE.md` §1's description of the milestone.
 *
 * ⚠️ **Grouped rather than three loose options**, so that supplying a store
 * without a way to mint an id is not expressible. A controller half-configured
 * for saving would stop a ride, fail to save it, and have nothing to say.
 *
 * Optional as a whole because the accessibility suite renders this screen on a
 * machine with no IndexedDB worth the name — the same shape every other port
 * here has. A controller without it records and checkpoints exactly as before,
 * and `RideSaveState` is `unavailable` rather than pretending.
 */
export interface RideSavePort {
  readonly store: RideSaveStore;
  /** Generated by the caller, for `newSessionId`'s reason. */
  readonly newActivityId: () => ActivityId;
  /** The IANA zone the ride was ridden in. Stored, never inferred later. */
  readonly timeZone: string;
}

/** Where a finished ride got to. */
export type RideSaveState =
  /** Nothing has been stopped yet, or this build cannot save. */
  | 'unavailable'
  | 'saving'
  | 'saved'
  /** Stopped with no samples. Not a failure — see `finish.ts`. */
  | 'empty'
  | 'failed';

export interface RideControllerOptions {
  readonly transport: SensorTransport;
  readonly store: RecordingCheckpointStore;
  readonly athleteId: AthleteId;
  /** @see RideSavePort */
  readonly rideSave?: RideSavePort | undefined;
  /** Generated by the caller, so two tabs cannot collide. See `RecorderOptions`. */
  readonly newSessionId: () => RecordingSessionId;
  readonly now: () => UnixSeconds;
  /** Omitted, no trainer is controllable and the screen says so. */
  readonly openTrainer?: OpenTrainer | undefined;
  /** @see METRIC_STALE_AFTER_SECONDS */
  readonly staleAfterSeconds?: number;
  /**
   * Whether anybody is on the bike, from the camera — #390.
   *
   * ⚠️ **Advisory, and only to the recorder's own auto-pause.** It is handed to
   * every recorder this controller builds or recovers, where
   * `recording/channels.ts` §`presenceAwareMovement` folds it into the
   * movement predicate. This controller does not pause on it: {@link
   * RideController.pause} stays the rider's press, and the engine's automatic
   * pause stays the only other way a ride stops accumulating.
   *
   * Omitted — no camera on this platform — and every ride is exactly what it
   * was before #390.
   *
   * ⚠️ **It can ease a trainer, and #515 said it could not** (#516). The
   * engine's automatic pause is a pause like any other to {@link tick}: the
   * phase follows it, and a running workout is paused with it, which writes
   * the machine's own Supported Power Range minimum through the ERG writer —
   * `workout/session.ts` §`pause`, #441's ease. So `absent` reaches the
   * trainer as ONE Set Target Power at the floor. That direction is allowed
   * because it is the one a rider who has walked away needs and the one #441
   * already chose for every pause: less resistance, never a Stop, never a
   * Reset, never a request for control. Nothing here raises a target or takes
   * control on the camera's answer — `presence` can only withhold movement
   * (`channels.ts` §`presenceAwareMovement`), so it can cause a pause and
   * never a resume, and the resume that follows a rider's return is the
   * engine's own movement rule putting the WORKOUT's own target back.
   * `controller.test.ts` §"#516" pins what each answer writes, as octets.
   */
  readonly presence?: RiderPresencePort | undefined;
  /**
   * Keep the process alive while a ride is active — #524. The Android
   * foreground service; absent in a browser. @see keep-alive-port.ts
   *
   * ⚠️ An optional option, so a `main.tsx` that stopped passing it is green in
   * `check:wiring` (§Limits) and in every test here.
   */
  readonly keepAlive?: RideKeepAlivePort | undefined;
}

export interface RideController {
  /** Stable between changes, so `useSyncExternalStore` does not loop. */
  getSnapshot(): RideSnapshot;
  subscribe(listener: () => void): Unsubscribe;

  /**
   * Pair one device. **Must be called from a user gesture** — one per device.
   *
   * Never throws: a cancelled chooser is the ordinary outcome of pressing the
   * button and changing your mind, and it lands in
   * {@link RideSnapshot.pairingError} with everything else.
   */
  pair(role: PairingRole): Promise<void>;
  /** Drop a paired device. Recording continues; its channels go unpaired. */
  unpair(id: DeviceId): Promise<void>;

  start(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  /** First press of Stop. Arms the confirmation; changes nothing else. */
  armStop(): void;
  cancelStop(): void;
  /** Second press. Stops the recording and checkpoints it. */
  confirmStop(): Promise<void>;

  /**
   * Ride a saved workout against the paired trainer (#14).
   *
   * ⚠️ **Requires control to have been granted already.** `requestControl` is
   * a thing the rider does, and a workout that took control on its own would
   * be the screen deciding to apply resistance to somebody — which the note at
   * the top of this file rules out for the manual setpoint and rules out here
   * for the same reason.
   *
   * @returns whether the workout started. `false` when there is no controllable
   * trainer or control has not been granted; the screen says which.
   */
  startWorkout(workout: WorkoutRecord, thresholdPower: Watts): boolean;

  /**
   * Re-read the rides this device is still holding — #212. Call it on mount
   * and after anything that could change the list.
   */
  refreshRecoverable(): Promise<void>;
  /** Adopt an interrupted recording, paused, ready to resume. `false` if it is gone. */
  continueRecovered(id: RecordingSessionId): Promise<boolean>;
  /** Save what survived of one, through the same path a finished ride uses. */
  saveRecovered(id: RecordingSessionId): Promise<RideSaveState>;
  /** Remove one from the device. `false` leaves it on screen rather than lying. */
  discardRecovered(id: RecordingSessionId): Promise<boolean>;
  /** End the workout and release the trainer. The recording is untouched. */
  endWorkout(): void;
  /**
   * Ask the trainer for control — always the rider's act, from one of two
   * presses: *Ask the trainer for control* on the Ride screen, and since #503
   * *Ride* in the trainer game (`game/trainer-port.ts` §`gameTrainerPortOver`,
   * which never asks over a running workout). One path to the control point;
   * a refusal lands on {@link TrainerSnapshot.refusal} for both.
   */
  requestTrainerControl(): Promise<void>;
  setTargetPower(target: Watts): Promise<void>;
  /**
   * End ERG — release the trainer (#372) through the one release, an FTMS
   * Stop. Control is kept. ⚠️ On the trainer measured the target stays applied
   * after it, which the owner has accepted; setting a new one works.
   */
  clearTargetPower(): Promise<void>;
  /**
   * The paired trainer, narrowed to the two commands the game may give it (#362).
   *
   * ⚠️ **Its `letGo` is this controller's, not the protocol client's** (#372).
   * It goes through the one release every other path uses, so a game ride that
   * ends is joined with any release already in flight, and an incomplete one is
   * reported on {@link TrainerSnapshot.releaseFault} like every other.
   *
   * ⚠️ **`undefined` says only "there is no controllable trainer".** It says
   * nothing about whether the machine offers simulation mode or has granted
   * control — those are {@link TrainerSnapshot.canSimulate} and
   * {@link TrainerSnapshot.hasControl}, and `game/trainer-port.ts`
   * §`gameTrainerFrom` is the one place all three are read together. Splitting
   * it that way is what lets every refusal branch be reached from a test with
   * no Bluetooth adapter.
   *
   * ⚠️ **Narrowed rather than returning `TrainerControl`**, for the reason
   * `workout/session.ts` narrows `WorkoutTrainer`: `requestControl()` is a
   * thing the rider does, and a method that is not on the returned type cannot
   * be called by a later edit.
   *
   * ⚠️ **`undefined` while a workout is in progress, however controllable the
   * trainer is.** There is exactly one control point on the machine and a
   * running workout already owns it: `RideSession` is mounted above the router
   * (`shell/AppShell.tsx`), so `workoutTick` keeps driving ERG targets while
   * the rider is on the game screen, and handing the game a control here made
   * two writers of one characteristic at about 1 Hz each. Worse than
   * interleaved setpoints, the game's own release was an FTMS **Stop** — after
   * which, per `packages/sensors/protocol`'s
   * `fitness-machine-control.ts`, the machine ignores setpoints until it is
   * started again — so ending a game ride silently stopped the workout's
   * trainer while the workout's clock ran on and every target reported
   * success. That is the same silent failure {@link RideController.startWorkout}
   * refuses to start into; this is the other end of it, and CLAUDE.md §6 puts
   * trainer control in the safety class.
   *
   * The rider is **told** rather than left with a flat-feeling road:
   * {@link RideSnapshot.workout} is what `game/trainer-port.ts`
   * §`gameTrainerFrom` reads to say which of its states this is.
   */
  simulationControl(): Pick<TrainerControl, 'setSimulationParameters' | 'letGo'> | undefined;

  /** Advance the clock: staleness, auto-pause and the checkpoint schedule. */
  tick(now: UnixSeconds): Promise<void>;
  /**
   * {@link RideController.tick} at the controller's own clock.
   *
   * What the browser's interval calls, so the view never has to be handed a
   * second clock that could disagree with the one the recorder is stamping
   * samples with.
   */
  tickNow(): Promise<void>;
  /** Unsubscribe from everything. Does not stop or discard a recording. */
  dispose(): void;
}

interface SensorEntry {
  readonly device: SensorDevice;
  readonly role: PairingRole;
  readonly release: Unsubscribe[];
  state: ConnectionState;
  trainer: TrainerConnection | undefined;
  /** What the machine offers, whether or not this app will drive it (#370). */
  controlChoice: TrainerControlChoice;
}

export function createRideController(options: RideControllerOptions): RideController {
  const { transport, store, athleteId, newSessionId, now, openTrainer } = options;
  const staleAfterSeconds = options.staleAfterSeconds ?? METRIC_STALE_AFTER_SECONDS;
  // #390. `undefined` with no camera, which leaves every recorder exactly as it
  // was: `recorder.ts` §`RecorderOptions.presence`. Read afresh on every
  // reading, because the answer moves during a ride.
  const port = options.presence;
  const presence = port === undefined ? undefined : (): RiderPresence => port.riderPresence();

  const listeners = new Set<() => void>();
  const sensors = new Map<DeviceId, SensorEntry>();
  const latest = new Map<MeasurementCapability, LatestReading>();

  let recorder: Recorder | undefined;
  let saveState: RideSaveState = 'unavailable';
  let saveError: string | undefined;
  let savedActivityId: ActivityId | undefined;
  /** Set when a ride saved but its checkpoint could not be removed. @see RideSnapshot.leftover */
  let leftover = false;
  let recoverable: readonly RecoverableRide[] = [];
  let phase: RidePhase = 'idle';
  let stopArmed = false;
  let pairingError: string | undefined;
  let requested: Watts | undefined;
  let controlLost: ControlLossReason | undefined;
  let workout: WorkoutInProgress | undefined;
  let refusal: string | undefined;
  let releaseFault: string | undefined;
  /** The release on the wire, if one is. @see releaseTrainer */
  let releasing: Promise<TrainerRelease> | undefined;
  let clock: UnixSeconds = now();
  let snapshot: RideSnapshot | undefined;
  let disposed = false;

  /** Whether {@link RideControllerOptions.keepAlive} was last asked to keep. */
  let keptAlive = false;

  /**
   * #524: ask the platform to keep the process alive exactly while a ride is
   * active, and let it go when it is not. Driven from the PHASE, here, rather
   * than from each of `start`, `continueRecovered`, `confirmStop` and `dispose`,
   * so no way into or out of a ride can forget it — every one of them already
   * ends in {@link changed}.
   *
   * ⚠️ Fire and forget, and a rejection is swallowed: a ride recorded without
   * the service is degraded, not broken. `keep-alive-port.ts` says why.
   */
  const syncKeepAlive = (): void => {
    const wanted = !disposed && rideInProgress(phase);
    if (wanted === keptAlive || options.keepAlive === undefined) {
      return;
    }
    keptAlive = wanted;
    const call = wanted ? options.keepAlive.keepRideAlive() : options.keepAlive.letRideSleep();
    call.catch(() => undefined);
  };

  const changed = (): void => {
    syncKeepAlive();
    // The cache is dropped rather than recomputed: nothing has asked for a
    // snapshot yet and building one per measurement would be four allocations
    // a second for four hours with nobody reading three of them.
    snapshot = undefined;
    for (const listener of [...listeners]) {
      listener();
    }
  };

  const trainerEntry = (): SensorEntry | undefined =>
    [...sensors.values()].find((entry) => entry.trainer !== undefined);

  /**
   * The sensor the athlete paired **as a trainer**, driveable or not.
   *
   * ⚠️ Not {@link trainerEntry}, and the difference is exactly #370. That one
   * selects on `entry.trainer`, which is only set when this app built a control
   * client — so a machine offering nothing but its manufacturer's control point
   * is invisible to it, and `TrainerSnapshot.controlChoice` read through it
   * would be `none` on every device the new message exists for.
   */
  const pairedTrainerEntry = (): SensorEntry | undefined =>
    [...sensors.values()].find((entry) => entry.role === 'trainer');

  const control = (): TrainerControl | undefined => trainerEntry()?.trainer?.control;

  /**
   * Let the trainer go — **the one release in the client** (#372).
   *
   * Every path that ends a ride, a workout, manual ERG or a game ride reaches
   * the trainer through this, and it sends `TrainerControl.letGo()`: an FTMS
   * Stop. Four callers and one decision, because what #372 found was one
   * decision copied into three places, each correct by its own tests — so the
   * next time hardware says the decision is wrong, it changes in one place.
   * ⚠️ PR #442 first made it a Reset; on the measured trainer that cleared
   * nothing a Stop did not and cost the rider their control.
   *
   * ⚠️ **Joined, not repeated.** Ending a ride ends its workout first and then
   * releases the trainer, and both reach here within the same microtask; one
   * release is one Stop on the wire, not two.
   *
   * ⚠️ **An intended release is told apart from a loss HERE, by the call, not
   * by a reason string.** `letGo()` does not raise `onControlLost`, so the
   * listener in `wire` — which shows "Control lost" and pauses a workout — is
   * never reached from a path that meant to let go. Nothing re-requests
   * control after this either: rule 2 at the top of the file.
   */
  const releaseTrainer = (client: TrainerControl): Promise<TrainerRelease> => {
    if (releasing !== undefined) {
      return releasing;
    }
    const attempt = client.letGo().then(
      (outcome) => {
        releaseFault = outcome.kind === 'stopped' ? undefined : RELEASE_INCOMPLETE;
        // A setpoint the rider asked for can no longer be answered.
        requested = undefined;
        return outcome;
      },
      (error: unknown) => {
        releaseFault = `${RELEASE_INCOMPLETE} (${describe(error)})`;
        throw error;
      },
    );
    releasing = attempt;
    void attempt
      .finally(() => {
        releasing = undefined;
        changed();
      })
      .catch(() => undefined);
    return attempt;
  };

  /** Whether any **connected** sensor supplies this channel. */
  const isPaired = (capability: MeasurementCapability): boolean =>
    [...sensors.values()].some(
      (entry) => entry.state === 'connected' && entry.device.capabilities.has(capability),
    );

  const describe = (error: unknown): string => {
    if (isSensorError(error)) {
      return error.message;
    }
    return error instanceof Error ? error.message : String(error);
  };

  const buildSnapshot = (): RideSnapshot => {
    const trainer = trainerEntry();
    const paired = pairedTrainerEntry();
    const connection = trainer?.trainer;
    const session = recorder?.session;
    return {
      phase,
      stopArmed,
      elapsedSeconds: session?.elapsedTime ?? 0,
      movingSeconds: session?.movingTime ?? 0,
      sampleCount: session?.sampleCount ?? 0,
      metrics: RIDE_METRIC_IDS.map((id) => ({
        id,
        state: metricStateFor(
          latest.get(METRIC_CAPABILITY[id]),
          isPaired(METRIC_CAPABILITY[id]),
          clock,
          staleAfterSeconds,
        ),
      })),
      sensors: [...sensors.values()].map((entry) => ({
        id: entry.device.identity.id,
        name: entry.device.name ?? 'Unnamed sensor',
        role: entry.role,
        capabilities: [...entry.device.capabilities].filter(
          (capability): capability is MeasurementCapability => capability !== 'trainer-control',
        ),
        state: entry.state,
      })),
      workout: workoutSnapshot(),
      trainer: {
        paired: paired !== undefined,
        controllable: connection !== undefined,
        controlChoice: paired?.controlChoice ?? NO_TRAINER_CONTROL,
        canSetPower: connection?.canSetPower ?? false,
        canSimulate: connection?.canSimulate ?? false,
        powerRange: connection?.powerRange,
        hasControl: control()?.hasControl() ?? false,
        target: control()?.targetPower() ?? { kind: 'none' },
        requested,
        lost: controlLost,
        refusal,
        releaseFault,
      },
      storage: recorder?.storageState ?? 'ok',
      saveState,
      saveError,
      savedActivityId,
      leftover,
      recoverable,
      pairingError,
      connectionsRemaining: Math.max(
        0,
        transport.traits.maxConcurrentConnections -
          [...sensors.values()].filter((entry) => entry.state === 'connected').length,
      ),
    };
  };

  /**
   * Copy the engine's own state onto the screen's phase — **in both
   * directions**.
   *
   * ⚠️ The engine pauses itself after ten seconds with no movement signal *and
   * ends that pause itself* on the first moving reading
   * (`RecordingSession.observe`). A mirror that only ever wrote `paused` — the
   * shape this had until #49's review — sticks there for the rest of the ride:
   * the recording carries on, moving time climbs, and the screen keeps offering
   * Resume, whose handler the controller refuses because the session is already
   * recording. Pause is unreachable for the same reason, being the other arm of
   * the same branch.
   *
   * A *manual* pause is safe from this: the engine never wakes one, so the
   * mirror reads `paused` back and the phase stays where the rider put it.
   *
   * Written out rather than as `state === 'paused' ? 'paused' : 'recording'` so
   * that no engine state the caller has not thought about can be mapped onto
   * `recording` by falling through.
   */
  const syncPhaseWithEngine = (): void => {
    if (recorder === undefined || (phase !== 'recording' && phase !== 'paused')) {
      return;
    }
    const engine = recorder.session.state;
    if (engine === 'paused' || engine === 'recording') {
      phase = engine;
    }
  };

  // --- Measurements ---------------------------------------------------------

  const onMeasurement = (measurement: SensorMeasurement): void => {
    latest.set(measurement.capability, {
      value: valueOf(measurement),
      at: measurement.at,
    });
    // Into the recorder as well as onto the screen, and through the same call:
    // a screen that showed a reading the recorder never saw would be the
    // "wrong layer" defect in its most visible form.
    recorder?.observe(measurement);
    // And into the workout, which needs cadence and nothing else: the ERG
    // spiral rule is a trend over cadence while a target is held. Fed from the
    // same call as the recorder for that call's reason — a workout that eased
    // a target off a reading the recorder never saw would be deciding from a
    // stream nothing else can audit.
    if (measurement.capability === 'cadence') {
      workout?.session.observeCadence({
        at: seconds(measurement.at),
        cadence: measurement.cadence,
      });
    }
    // The reading is what wakes an automatic pause, so the phase moves with it
    // rather than on the next tick: for that second the screen would otherwise
    // offer a Resume the controller refuses.
    syncPhaseWithEngine();
    changed();
  };

  // --- Pairing --------------------------------------------------------------

  const attach = async (device: SensorDevice, role: PairingRole): Promise<void> => {
    const id = device.identity.id;
    const entry: SensorEntry = {
      device,
      role,
      release: [],
      state: transport.connectionState(id),
      trainer: undefined,
      controlChoice: NO_TRAINER_CONTROL,
    };
    sensors.set(id, entry);
    try {
      await wire(entry);
    } catch (error) {
      // A connect or a subscribe that failed leaves nothing on screen. Half a
      // sensor — listed, named, and delivering nothing — is the state a rider
      // cannot tell from a working one.
      detach(entry);
      sensors.delete(id);
      throw error;
    }
    changed();
  };

  /** Everything that needs a link. Separated so `attach` can undo all of it. */
  const wire = async (entry: SensorEntry): Promise<void> => {
    const id = entry.device.identity.id;
    entry.release.push(
      transport.observeConnectionState(id, (state) => {
        const previous = entry.state;
        entry.state = state;
        // The link, not the subscription. #43's client ends control permission
        // with the connection (FTMS §4.16.2.1) and cannot know the link went
        // unless it is told, so a target it had confirmed would stay on screen
        // as confirmed for the rest of the ride.
        if (state !== 'connected' && previous === 'connected') {
          entry.trainer?.control.linkLost();
        }
        if (state === 'connected' && previous !== 'connected') {
          entry.trainer?.control.linkRestored();
        }
        changed();
      }),
    );

    await transport.connect(id);
    entry.state = transport.connectionState(id);

    for (const capability of entry.device.capabilities) {
      if (capability === 'trainer-control') {
        continue;
      }
      entry.release.push(await transport.subscribe(id, capability, onMeasurement));
    }

    if (entry.role === 'trainer' && openTrainer !== undefined) {
      const attachment = await openTrainer(id);
      // ⚠️ Recorded whether or not a connection came back. It is the half that
      // says *"this machine has a control point and this program will not use
      // it"*, which is the one state the screen could not describe before #370.
      entry.controlChoice = attachment.choice;
      const connection = attachment.connection;
      if (connection !== undefined) {
        entry.trainer = connection;
        entry.release.push(
          connection.control.onControlLost((reason) => {
            controlLost = reason;
            // ⚠️ The workout pauses and keeps everything, which is #14's
            // "a disconnect preserves rather than loses the session". It is
            // NOT ended: control lost is a thing a rider takes back, and a
            // workout that ended here would make a momentary dropout into a
            // session they have to restart from the beginning.
            // `now()` for `startWorkout`'s reason: a control-loss indication
            // arrives between ticks, so the cached clock is behind it.
            workout?.session.linkLost(rideSeconds(now()));
            // The requested setpoint is dropped rather than left pending: the
            // procedure it belonged to has been rejected, and a screen still
            // saying "requested 250 W" would be waiting for an answer that
            // cannot arrive.
            requested = undefined;
            changed();
          }),
        );
      }
    }
  };

  const detach = (entry: SensorEntry): void => {
    for (const release of entry.release.splice(0)) {
      release();
    }
    entry.trainer?.control.close();
    entry.trainer = undefined;
    entry.controlChoice = NO_TRAINER_CONTROL;
  };

  /**
   * Turn the finished recording into an activity, then let the checkpoint go.
   *
   * ⚠️ **The discard is last and is conditional, and that ordering is the whole
   * data-safety argument.** Until the activity is on disk the checkpoint is the
   * only copy of the ride — there is no server in this milestone — so a discard
   * that ran first would turn a failed save into a lost ride. A save that fails
   * leaves the checkpoint exactly where it was, which is the recovery path
   * working rather than a duplicate to apologise for.
   *
   * ⚠️ **Never throws.** `confirmStop` awaits it, and a rejection there would
   * leave the ride stopped on screen with nothing saying why.
   */
  const saveTheRide = async (
    current: Recorder | undefined,
    workoutName: string | undefined,
  ): Promise<void> => {
    const port = options.rideSave;
    if (port === undefined || current === undefined) {
      return;
    }
    saveState = 'saving';
    saveError = undefined;
    changed();

    const outcome = await saveFinishedRide(
      port.store,
      rideToSave({
        id: port.newActivityId(),
        athleteId: options.athleteId,
        series: current.session.series(),
        elapsedTime: current.session.elapsedTime,
        movingTime: current.session.movingTime,
        timeZone: port.timeZone,
        now: now(),
        ...(workoutName === undefined ? {} : { workoutName }),
      }),
    );

    saveState = outcome.status;
    saveError = outcome.status === 'failed' ? outcome.error.message : undefined;
    savedActivityId = outcome.status === 'saved' ? outcome.id : undefined;
    if (outcome.status === 'saved' || outcome.status === 'empty') {
      // ⚠️ **Stamp the link BEFORE the checkpoint goes, and read what the
      // discard answered.** Found by review: `discard()` returns `false` when
      // the delete fails, and ignoring it left a ride that HAD saved sitting on
      // disk as a `stopped` row — which `recovery.ts` reads as "the save
      // failed", offers "Save this ride", and thereby writes a second copy of
      // the same ride under a fresh activity id with nothing deduplicating it.
      // The link is what tells the two apart afterwards.
      if (outcome.status === 'saved') {
        await current.markSaved(outcome.id);
      }
      const gone = await current.discard();
      if (!gone) {
        // The ride IS saved — that is the sentence that matters to a rider, so
        // `saveState` does not become `failed`. What they also need to know is
        // that a leftover will be offered back, and that it is a copy rather
        // than a rescue.
        leftover = true;
      }
    }
    changed();
  };

  /**
   * Re-read what this device is still holding — #212.
   *
   * ⚠️ **A no-op while riding.** The offer is only meaningful on an idle
   * screen, and `recoverableRides` excludes the session in progress anyway;
   * doing both means neither alone is load-bearing.
   */
  const refreshRecoverable = async (): Promise<void> => {
    if (phase === 'recording' || phase === 'paused') {
      return;
    }
    try {
      const rows = await listRecoverableRecordings(store, athleteId);
      recoverable = recoverableRides(rows, { excluding: recorder?.sessionId });
    } catch {
      // A store that cannot be read is what "offline" looks like on this
      // device. Offering nothing is honest; throwing out of a refresh the
      // screen calls on mount is not.
      recoverable = [];
    }
    changed();
  };

  /**
   * Rebuild a recorder from disk, or `undefined` when there is nothing usable.
   *
   * ⚠️ **Catches, and that is the whole point.** `recoverRecording` decodes
   * every chunk and throws `StoreDecodeError` on a corrupt one — and a corrupt
   * recording is still *listed*, because listing reads only the header. Letting
   * the rejection out left such a row impossible to continue, save **or**
   * discard, with no message: a permanent entry in the offer that nothing could
   * clear. Found by review on the #212 work.
   */
  const recoverOne = async (id: RecordingSessionId): Promise<Recorder | undefined> => {
    try {
      const found = await recoverRecorder({ store, athleteId, sessionId: id, presence });
      return found?.recorder;
    } catch {
      return undefined;
    }
  };

  // --- The recorder ---------------------------------------------------------

  const recording = (): Recorder => {
    if (recorder === undefined) {
      throw new Error('no recording is in progress');
    }
    return recorder;
  };

  // --- The workout (#14) ----------------------------------------------------

  interface WorkoutInProgress {
    readonly record: WorkoutRecord;
    readonly session: WorkoutSession;
    /** Expanded once, and the same object the session plays. */
    readonly timeline: WorkoutTimeline;
  }

  /**
   * ⚠️ **The workout's clock is the ride's clock**, and that is the join this
   * file exists to make.
   *
   * `createWorkoutPlayer` anchors on whatever instant `start` is given and
   * measures everything from it, so handing it the ride's own `UnixSeconds`
   * makes the workout's elapsed time and the ride's advance from one source.
   * A second clock — a `setInterval` of the workout's own, say — would drift
   * against the one stamping samples, and an hour in the two would disagree
   * about which interval a sample belongs to.
   *
   * The brand is re-entered rather than cast: `Seconds` and `UnixSeconds` are
   * deliberately different types, and what is being said here is "treat this
   * instant as a monotonic reading", which is true and is worth writing down.
   */
  const rideSeconds = (at: UnixSeconds): Seconds => seconds(at);

  /**
   * What a segment points at when the record and the timeline disagree.
   *
   * Unreachable: `expandWorkout` numbers every segment from the block it came
   * from, so the index is always in range. It exists because reading it as
   * `undefined` and rendering nothing would hide a real inconsistency behind an
   * empty line, and a free ride is the block that claims the least.
   */
  const EMPTY_BLOCK: WorkoutBlock = { kind: 'free-ride', seconds: seconds(1) };

  /** What the screen reads about the workout, or `undefined` when none is loaded. */
  const workoutSnapshot = (): RideWorkoutSnapshot | undefined => {
    if (workout === undefined) {
      return undefined;
    }
    const state = workout.session.state();
    const segment = state.player.segment;
    return {
      name: workout.record.name,
      status: state.player.status,
      elapsedSeconds: state.player.elapsed,
      totalSeconds: workout.timeline.totalSeconds,
      timeline: workout.timeline,
      holdingWatts: state.holding,
      // The block a rider is in, phrased by the module that phrases them
      // everywhere else — a second wording here would be the ride screen and
      // the library disagreeing about the same block.
      nowRiding:
        segment === undefined
          ? undefined
          : blockText(workout.record.workout.blocks[segment.block] ?? EMPTY_BLOCK),
      fault: state.lastFault,
    };
  };

  const workoutTick = (at: UnixSeconds): void => {
    if (workout === undefined) {
      return;
    }
    workout.session.tick(rideSeconds(at));
  };

  /**
   * End the workout. Its session releases the trainer on the way out, through
   * {@link releaseTrainer} — unless another workout is taking the trainer over,
   * in which case it is `supersede`d: the replacement writes straight on, and a
   * release would mark a trainer the next workout is about to drive.
   */
  const endWorkoutSession = (handover: 'release' | 'replace' = 'release'): void => {
    if (workout === undefined) {
      return;
    }
    if (handover === 'replace') {
      workout.session.supersede();
    } else {
      workout.session.stop();
    }
    workout = undefined;
  };

  const controller: RideController = {
    getSnapshot(): RideSnapshot {
      snapshot ??= buildSnapshot();
      return snapshot;
    },

    subscribe(listener): Unsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async pair(role): Promise<void> {
      pairingError = undefined;
      changed();
      try {
        const device = await transport.discover({
          capabilities: [...PAIRING_ROLE_CAPABILITIES[role]],
        });
        if (sensors.has(device.identity.id)) {
          // The same device chosen twice. `register` in the adapter returns the
          // record that exists, so re-attaching would double every
          // subscription — and the rider would see doubled readings rather than
          // an error.
          pairingError = `${device.name ?? 'That sensor'} is already paired.`;
          changed();
          return;
        }
        await attach(device, role);
      } catch (error) {
        pairingError = describe(error);
        changed();
      }
    },

    async unpair(id): Promise<void> {
      const entry = sensors.get(id);
      if (entry === undefined) {
        return;
      }
      detach(entry);
      sensors.delete(id);
      changed();
      try {
        await transport.disconnect(id);
      } catch {
        // A device that is already gone is the ordinary case here. There is
        // nothing left to tell the rider and nothing left to do.
      }
      changed();
    },

    async start(): Promise<void> {
      if (phase !== 'idle') {
        return;
      }
      recorder = createRecorder({
        store,
        athleteId,
        sessionId: newSessionId(),
        sampleInterval: seconds(1),
        presence,
      });
      phase = 'recording';
      clock = now();
      await recorder.start(clock);
      changed();
    },

    async pause(): Promise<void> {
      if (phase !== 'recording') {
        return;
      }
      phase = 'paused';
      await recording().pause(now());
      changed();
    },

    async resume(): Promise<void> {
      if (phase !== 'paused') {
        return;
      }
      phase = 'recording';
      await recording().resume(now());
      changed();
    },

    armStop(): void {
      if (phase !== 'recording' && phase !== 'paused') {
        return;
      }
      stopArmed = true;
      changed();
    },

    cancelStop(): void {
      stopArmed = false;
      changed();
    },

    async confirmStop(): Promise<void> {
      if (!stopArmed || (phase !== 'recording' && phase !== 'paused')) {
        // ⚠️ The guard, not a nicety. Without the `stopArmed` check a single
        // activation of the confirm control — one that a stray Enter on a
        // re-rendered button could produce — ends the ride, and #49's sixth
        // criterion is that a single click cannot.
        return;
      }
      stopArmed = false;
      phase = 'stopped';
      const at = now();
      // The workout first, then the trainer, then the recording.
      //
      // The trainer before the recording IS observable and is asserted:
      // ending a recording while the machine still holds an ERG target leaves
      // a rider pedalling against a resistance nothing on screen is showing
      // any more.
      //
      // ⚠️ The workout before the trainer is **not** observable, and this note
      // is here rather than a contrived test. Both orders end with the machine
      // released — `endWorkoutSession` releases it too — and nothing ticks
      // during the `await`, so no workout write can land in between. It is
      // written this way because the invariant is "no session is running when
      // the trainer is released", and the reverse order holds only as long as
      // that await stays uninterrupted. Mutation-tested: swapping the two
      // leaves the suite green.
      // The name is captured BEFORE the session ends, because ending it clears
      // the workout and a ride named after the session it rode has to read that
      // name while it still exists.
      const ridden = workout?.record.name;
      endWorkoutSession();
      await stopTrainer();
      await recording().stop(at);
      changed();
      await saveTheRide(recorder, ridden);
    },

    /** Re-read the rides this device is still holding — #212. */
    refreshRecoverable,

    /**
     * Adopt an interrupted recording and carry on riding it.
     *
     * ⚠️ It comes back **paused**, with the dead time recorded as an automatic
     * pause — the rider was not pedalling while the tab was gone, so that is
     * not moving time. The screen's Resume control continues into the slots
     * after the gap, and the gap stays a gap.
     */
    async continueRecovered(id: RecordingSessionId): Promise<boolean> {
      if (phase !== 'idle') {
        return false;
      }
      const found = await recoverOne(id);
      if (found === undefined) {
        await refreshRecoverable();
        return false;
      }
      recorder = found;
      phase = 'paused';
      clock = now();
      saveState = 'unavailable';
      saveError = undefined;
      savedActivityId = undefined;
      recoverable = [];
      changed();
      return true;
    },

    /**
     * Save what survived, without continuing.
     *
     * ⚠️ Goes through **the same `saveTheRide`** a normally finished ride does,
     * which is the point: a recovered ride lands in the library with the same
     * shape, and there are not two ways to save that can drift. It carries no
     * workout name, because nothing on disk records which workout was ridden.
     */
    async saveRecovered(id: RecordingSessionId): Promise<RideSaveState> {
      if (phase !== 'idle') {
        return saveState;
      }
      // ⚠️ **Refuses a recording that is already an activity**, which is the
      // duplicate `savedAs` exists to prevent. `recoverableRides` marks such a
      // row and the screen offers it discard only, so reaching this is a stale
      // list rather than a control a rider can see — and a stale list is
      // exactly what a second tab produces.
      if (recoverable.find((ride) => ride.id === id)?.alreadySaved === true) {
        await refreshRecoverable();
        return 'saved';
      }
      const found = await recoverOne(id);
      if (found === undefined) {
        await refreshRecoverable();
        return 'failed';
      }
      await saveTheRide(found, undefined);
      await refreshRecoverable();
      return saveState;
    },

    /**
     * Throw one away.
     *
     * @returns whether it is gone. A `false` leaves the row on screen rather
     * than showing a rider a list the ride is still in — `Recorder.discard`
     * documents why that distinction is worth returning.
     */
    async discardRecovered(id: RecordingSessionId): Promise<boolean> {
      if (phase !== 'idle') {
        return false;
      }
      // ⚠️ **Deletes the row directly rather than rebuilding a recorder for
      // it.** Rebuilding decodes every chunk, so a recording corrupt enough to
      // fail that decode could not be thrown away — which is the one thing a
      // rider must always be able to do with it, and exactly the state they
      // would want to clear. Deleting needs the two ids and nothing else.
      const gone = await store.deleteRecordingSession(athleteId, id).catch(() => false);
      await refreshRecoverable();
      return gone;
    },

    startWorkout(record: WorkoutRecord, thresholdPower: Watts): boolean {
      const connection = trainerEntry()?.trainer;
      const client = connection?.control;
      // ⚠️ Both halves. A trainer that is paired but has not granted control
      // answers every setpoint `0x05 Control Not Permitted`, so starting here
      // would produce a workout that runs its clock and controls nothing —
      // which is the silent failure #14's revision block names.
      if (connection === undefined || client === undefined || !client.hasControl()) {
        return false;
      }
      endWorkoutSession('replace');
      const timeline = expandWorkout(record.workout);
      const session = createWorkoutSession({
        timeline,
        thresholdPower,
        // ⚠️ `letGo` is this controller's, so the end of the workout is the
        // same release as every other and is joined with the ride's own.
        control: {
          setTargetPower: (target) => client.setTargetPower(target),
          stop: () => client.stop(),
          letGo: () => releaseTrainer(client),
        },
        // #441: what an ease writes — the machine's own reported minimum.
        powerFloor: connection.powerRange.minimum,
        onChange: changed,
      });
      workout = { record, session, timeline };
      // ⚠️ `now()`, NOT the cached `clock`. `clock` only moves on a tick, and
      // pairing and requesting control both advance the real clock without one
      // — so anchoring there started every workout already seconds old, and the
      // rider was that far into their first interval before they began. Found
      // by the test that asserts the workout clock is the ride clock.
      session.start(rideSeconds(now()));
      changed();
      return true;
    },

    endWorkout(): void {
      endWorkoutSession();
      changed();
    },

    async requestTrainerControl(): Promise<void> {
      const client = control();
      if (client === undefined) {
        return;
      }
      refusal = undefined;
      changed();
      try {
        await client.requestControl();
        controlLost = undefined;
        // Control is the rider's again; a notice about the last release would
        // now be describing a machine this client is driving.
        releaseFault = undefined;
      } catch (error) {
        refusal = describe(error);
      }
      changed();
    },

    async setTargetPower(target): Promise<void> {
      const client = control();
      if (client === undefined) {
        return;
      }
      requested = target;
      refusal = undefined;
      changed();
      try {
        await client.setTargetPower(target);
      } catch (error) {
        refusal = describe(error);
      } finally {
        // Cleared whichever way it went. On success the client's own
        // `targetPower()` is now `confirmed` and is what the screen reads; on
        // failure there is nothing outstanding to wait for.
        requested = undefined;
        changed();
      }
    },

    simulationControl(): Pick<TrainerControl, 'setSimulationParameters' | 'letGo'> | undefined {
      // ⚠️ The workout owns the control point while it exists — see the
      // declaration for what two writers on one characteristic did. Checked
      // here rather than only in `gameTrainerFrom` because this is the method
      // that hands out the object: a caller that never asked the snapshot
      // still cannot get one.
      if (workout !== undefined) {
        return undefined;
      }
      const client = control();
      if (client === undefined) {
        return undefined;
      }
      return {
        setSimulationParameters: (parameters) => client.setSimulationParameters(parameters),
        letGo: () => releaseTrainer(client),
      };
    },

    async clearTargetPower(): Promise<void> {
      await stopTrainer();
      changed();
    },

    async tick(at): Promise<void> {
      clock = at;
      if (recorder !== undefined && (phase === 'recording' || phase === 'paused')) {
        await recorder.tick(at);
        // The engine may have paused itself — no movement signal for ten
        // seconds — and the screen has to agree with it rather than keep
        // saying "recording". @see syncPhaseWithEngine for why this is not a
        // one-way copy.
        syncPhaseWithEngine();
      }
      // ⚠️ After `syncPhaseWithEngine`, so the workout sees the phase the
      // recorder has just settled on rather than the one before it. A rider
      // who stopped pedalling long enough to auto-pause the recording has
      // stopped riding the workout too, and a workout whose clock ran through
      // that break would put them a minute further into an interval than they
      // are.
      if (phase === 'paused') {
        workout?.session.pause(rideSeconds(at));
      } else if (phase === 'recording') {
        if (workout?.session.state().player.status === 'paused') {
          workout.session.resume(rideSeconds(at));
        }
        workoutTick(at);
      }
      // Unconditionally: staleness is a function of the clock, so a channel
      // goes quiet on the tick whether or not anything is recording.
      changed();
    },

    async tickNow(): Promise<void> {
      await controller.tick(now());
    },

    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      // #524: the controller that asked for the service is gone.
      syncKeepAlive();
      for (const entry of sensors.values()) {
        detach(entry);
      }
      sensors.clear();
      listeners.clear();
    },
  };

  /**
   * Let the trainer go, best effort, through {@link releaseTrainer} (#372) — an
   * FTMS Stop. ⚠️ On the trainer #372 was measured on, the ERG target stays
   * applied after it; the owner has accepted that.
   *
   * Failures are swallowed on purpose: this runs while the ride is being
   * stopped, and a rejection here must not leave the recording unstopped.
   * {@link TrainerSnapshot.releaseFault} says what the rider needs to know —
   * that the machine may still be holding resistance.
   *
   * ⚠️ Joins a release already on the wire — the workout's, when a ride with a
   * workout in it stops — rather than sending a second one. That works because
   * `hasControl()` is still `true` while that Stop is queued, so this reaches
   * {@link releaseTrainer}, which returns the one in flight.
   */
  async function stopTrainer(): Promise<void> {
    const client = control();
    if (client === undefined || !client.hasControl()) {
      return;
    }
    try {
      await releaseTrainer(client);
    } catch {
      // Recorded on `releaseFault` by `releaseTrainer`.
    }
  }

  return controller;
}

/** The number a measurement carries, whichever capability it is. */
function valueOf(measurement: SensorMeasurement): number {
  switch (measurement.capability) {
    case 'power':
      return measurement.power;
    case 'cadence':
      return measurement.cadence;
    case 'heart-rate':
      return measurement.heartRate;
    case 'speed':
      return measurement.speed;
  }
}

/** The clock a browser supplies. Not used by this module; `main.tsx` passes it in. */
export function browserClock(): UnixSeconds {
  return unixSeconds(Date.now() / 1000);
}
