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

import { seconds, unixSeconds, type UnixSeconds, type Watts } from '@onyourleft/domain';
import {
  isSensorError,
  type ConnectionState,
  type DeviceId,
  type MeasurementCapability,
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
} from '@onyourleft/sensors/protocol';
import type { AthleteId, RecordingSessionId } from '@onyourleft/store';

import {
  createRecorder,
  type Recorder,
  type RecorderStorageState,
  type RecordingCheckpointStore,
} from '../recording/recorder';

import {
  metricStateFor,
  METRIC_STALE_AFTER_SECONDS,
  type LatestReading,
  type MetricState,
  type RideMetricId,
} from './metrics';
import type { OpenTrainer, TrainerConnection } from './trainer';

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
 * connection out of about three, rather than three.
 */
export type PairingRole = 'trainer' | 'heart-rate' | 'power-meter' | 'speed-cadence';

export const PAIRING_ROLE_CAPABILITIES: Readonly<
  Record<PairingRole, readonly MeasurementCapability[]>
> = {
  trainer: ['power', 'cadence', 'speed'],
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
  /** Target Setting bit 3. `false` hides the ERG control rather than disabling it. */
  readonly canSetPower: boolean;
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
  /** Why the last setpoint was refused, for a screen that says more than "failed". */
  readonly refusal: string | undefined;
}

/** A metric and what the screen may say about it. */
export interface RideMetric {
  readonly id: RideMetricId;
  readonly state: MetricState;
}

export type RidePhase = 'idle' | 'recording' | 'paused' | 'stopped';

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
  readonly storage: RecorderStorageState;
  /** The last pairing attempt's failure, in words a rider can act on. */
  readonly pairingError: string | undefined;
  /** How many more devices this transport will connect. */
  readonly connectionsRemaining: number;
}

export interface RideControllerOptions {
  readonly transport: SensorTransport;
  readonly store: RecordingCheckpointStore;
  readonly athleteId: AthleteId;
  /** Generated by the caller, so two tabs cannot collide. See `RecorderOptions`. */
  readonly newSessionId: () => RecordingSessionId;
  readonly now: () => UnixSeconds;
  /** Omitted, no trainer is controllable and the screen says so. */
  readonly openTrainer?: OpenTrainer | undefined;
  /** @see METRIC_STALE_AFTER_SECONDS */
  readonly staleAfterSeconds?: number;
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

  requestTrainerControl(): Promise<void>;
  setTargetPower(target: Watts): Promise<void>;
  /** End ERG. The deliberate way to stop the trainer holding a target. */
  clearTargetPower(): Promise<void>;

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
}

export function createRideController(options: RideControllerOptions): RideController {
  const { transport, store, athleteId, newSessionId, now, openTrainer } = options;
  const staleAfterSeconds = options.staleAfterSeconds ?? METRIC_STALE_AFTER_SECONDS;

  const listeners = new Set<() => void>();
  const sensors = new Map<DeviceId, SensorEntry>();
  const latest = new Map<MeasurementCapability, LatestReading>();

  let recorder: Recorder | undefined;
  let phase: RidePhase = 'idle';
  let stopArmed = false;
  let pairingError: string | undefined;
  let requested: Watts | undefined;
  let controlLost: ControlLossReason | undefined;
  let refusal: string | undefined;
  let clock: UnixSeconds = now();
  let snapshot: RideSnapshot | undefined;
  let disposed = false;

  const changed = (): void => {
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

  const control = (): TrainerControl | undefined => trainerEntry()?.trainer?.control;

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
      trainer: {
        paired: [...sensors.values()].some((entry) => entry.role === 'trainer'),
        controllable: connection !== undefined,
        canSetPower: connection?.canSetPower ?? false,
        powerRange: connection?.powerRange,
        hasControl: control()?.hasControl() ?? false,
        target: control()?.targetPower() ?? { kind: 'none' },
        requested,
        lost: controlLost,
        refusal,
      },
      storage: recorder?.storageState ?? 'ok',
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
      const connection = await openTrainer(id);
      if (connection !== undefined) {
        entry.trainer = connection;
        entry.release.push(
          connection.control.onControlLost((reason) => {
            controlLost = reason;
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
  };

  // --- The recorder ---------------------------------------------------------

  const recording = (): Recorder => {
    if (recorder === undefined) {
      throw new Error('no recording is in progress');
    }
    return recorder;
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
      // The trainer first. Ending the recording while the machine is still
      // holding an ERG target leaves a rider pedalling against a resistance
      // that nothing on screen is showing any more.
      await stopTrainer();
      await recording().stop(at);
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

    async clearTargetPower(): Promise<void> {
      const client = control();
      if (client === undefined) {
        return;
      }
      try {
        await client.stop();
      } catch (error) {
        refusal = describe(error);
      }
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
      for (const entry of sensors.values()) {
        detach(entry);
      }
      sensors.clear();
      listeners.clear();
    },
  };

  /**
   * Take the trainer out of ERG, best effort.
   *
   * Failures are swallowed on purpose: this runs while the ride is being
   * stopped, and a rejection here must not leave the recording unstopped. The
   * machine is left holding its last target, which is what a trainer does when
   * a client simply goes away — and the screen no longer claims otherwise,
   * because the phase is `stopped`.
   */
  async function stopTrainer(): Promise<void> {
    const client = control();
    if (client === undefined || !client.hasControl()) {
      return;
    }
    try {
      await client.stop();
    } catch (error) {
      refusal = describe(error);
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
