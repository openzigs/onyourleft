// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #49's acceptance criteria, driven against the **#44 simulator** and the real
 * IndexedDB store.
 *
 * Nothing here is a fake of this project's own code. The transport is
 * `@onyourleft/sensors/simulator`, which is a second implementation of the same
 * `SensorTransport` the browser adapter satisfies; the trainer's control point
 * is the simulator's own state machine, bridged to octets; the store is
 * `@onyourleft/store/testing`'s harness, whose read cannot be served by the
 * handle that wrote. So a criterion that passes here passes through the path a
 * rider's data actually takes.
 *
 * ⚠️ **The bridge from the simulator's typed control point to octets is written
 * out with literal offsets** rather than by calling `encodeControlRequest`, for
 * the reason `fitness-machine-simulator.test.ts` gives: two implementations that
 * share an arithmetic mistake cancel it out invisibly. Since #503 it lives in
 * `simulated-trainer-testing.ts`, because the game's wiring test rides the same
 * trainer.
 */

import {
  gradePercent,
  revolutionsPerMinute,
  seconds,
  thresholdShare,
  unixSeconds,
  watts,
  type Watts,
  type WorkoutBlock,
} from '@onyourleft/domain';
import { deviceId } from '@onyourleft/sensors';
import {
  createTrainerControl,
  decodeSupportedPowerRange,
  FITNESS_MACHINE_CONTROL_POINT,
  FITNESS_MACHINE_SERVICE,
  type TrainerControl,
  type TrainerControlChoice,
} from '@onyourleft/sensors/protocol';
import {
  createSimulator,
  ftmsTrainer,
  hrsStrap,
  type FtmsOptions,
  type SimulatorBench,
} from '@onyourleft/sensors/simulator';
import {
  activityId,
  recordingSessionId,
  workoutId,
  type RecordingSessionId,
  type WorkoutRecord,
} from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  seedAthletes,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_AUTO_PAUSE_AFTER_SECONDS } from '../recording/channels';
import type { RecordingCheckpointStore } from '../recording/recorder';

import {
  canStartNewRide,
  createRideController,
  PAIRING_ROLE_CAPABILITIES,
  RIDE_NOTIFICATION_REFUSED,
  type RideController,
  type RideSavePort,
} from './controller';
import { gameTrainerFrom } from '../game/trainer-port';

import { METRIC_STALE_AFTER_SECONDS } from './metrics';
import { targetSentence } from './TrainerPanel';
import {
  int16,
  requestFromOctets,
  responseToOctets,
  statusToOctets,
  viewOf,
} from './simulated-trainer-testing';
import type { OpenTrainer, TrainerConnection } from './trainer';
import type { RiderPresence, RiderPresencePort } from './presence-port';
import type { RideKeepAlivePort } from './keep-alive-port';
import type {
  NotificationPermissionState,
  RideNotificationPermissionPort,
} from './notification-permission-port';
import { CameraController } from '../camera/session';
import { manualSchedule, scriptedCamera, stillRoom } from '../camera/testing';
import { PRESENCE_CHECK_MILLISECONDS } from '../camera/presence';

const TRAINER = deviceId('kickr');
const STRAP = deviceId('strap');

let harness: StoreHarness;
let sessionCounter = 0;

beforeEach(async () => {
  sessionCounter = 0;
  harness = createStoreHarness();
  await seedAthletes(harness);
});

afterEach(async () => {
  await harness.destroy();
});

function harnessStore(): RecordingCheckpointStore {
  return {
    putRecordingSession: async (record) =>
      harness.write(async (store) => store.putRecordingSession(record)),
    appendRecordingChunk: async (chunk) =>
      harness.write(async (store) => store.appendRecordingChunk(chunk)),
    listRecordingSessions: async (owner) =>
      harness.write(async (store) => store.listRecordingSessions(owner)),
    recoverRecording: async (owner, id) =>
      harness.write(async (store) => store.recoverRecording(owner, id)),
    deleteRecordingSession: async (owner, id) =>
      harness.write(async (store) => store.deleteRecordingSession(owner, id)),
  };
}

interface Bench {
  readonly controller: RideController;
  readonly bench: SimulatorBench;
  readonly trainerControl: () => TrainerControl | undefined;
  /** What the trainer itself is holding, read from the device. */
  readonly targetOnTheTrainer: () => Watts | undefined;
  /** Every control point write, as octets, in order — #372 asserts on these. */
  readonly written: number[][];
  readonly sessionIds: RecordingSessionId[];
}

interface BenchOptions {
  readonly devices?: 'trainer' | 'trainer+strap' | 'strap';
  readonly withTrainerControl?: boolean;
  /** Never answer a control point write, so a procedure stays outstanding. */
  readonly silentTrainer?: boolean;
  /** Give the controller somewhere to save a finished ride. See #14's fourth criterion. */
  readonly rideSave?: RideSavePort | undefined;
  /** #390: the camera's answer, handed to the controller as production does. */
  readonly presence?: RiderPresencePort | undefined;
  /** #524: the foreground service, as `main.tsx` hands it over on Android. */
  readonly keepAlive?: RideKeepAlivePort | undefined;
  /** #526: the notification permission, as `main.tsx` hands it over on Android. */
  readonly notificationPermission?: RideNotificationPermissionPort | undefined;
  /** Break one checkpoint-store operation, for the failure paths review found. */
  readonly checkpointStore?: Partial<RecordingCheckpointStore>;
  /**
   * What the machine turns out to offer, when it is not one this app drives
   * (#370).
   *
   * Set it and `openTrainer` answers that choice with **no** connection, which
   * is the vendor-only trainer: a real machine, a real control point, and
   * nothing this program will write to it.
   */
  readonly trainerOffers?: TrainerControlChoice;
  /**
   * How the simulated machine behaves — #372. `retainsTargetsThroughStop` is
   * the trainer that issue was measured on.
   */
  readonly machine?: Pick<FtmsOptions, 'retainsTargetsThroughStop' | 'minTargetPower'>;
  /**
   * Notify `0xFF` Control Permission Lost BEFORE the Stop's own answer — the
   * ordering PR #442's review reproduced, which nothing in BLE or FTMS rules
   * out and the simulator, which answers first, never produces. Also turns on
   * `reacquireControl`, as production has it, so a re-grab would be written.
   */
  readonly permissionLostBeforeStopAnswer?: boolean;
  /** Refuse every `0x08` write at the ATT layer, so a release cannot land. */
  readonly refuseStop?: boolean;
}

function benchWith(options: BenchOptions = {}): Bench {
  const which = options.devices ?? 'trainer';
  const { transport, bench } = createSimulator({
    devices: [
      ...(which === 'strap'
        ? []
        : [ftmsTrainer({ id: 'kickr', name: 'KICKR 1F2A', ...options.machine })]),
      ...(which === 'trainer+strap' || which === 'strap'
        ? [hrsStrap({ id: 'strap', name: 'HRM 04B1' })]
        : []),
    ],
  });

  let control: TrainerControl | undefined;
  const sessionIds: RecordingSessionId[] = [];
  const written: number[][] = [];

  const statusListeners: Array<(value: DataView) => void> = [];

  const openTrainer: OpenTrainer = (id) => {
    if (options.trainerOffers !== undefined) {
      return Promise.resolve({ choice: options.trainerOffers, connection: undefined });
    }
    const handle = bench.device(id);
    const controlPoint = handle.controlPoint;
    const ranges = handle.supportedRanges;
    if (controlPoint === undefined || ranges === undefined) {
      return Promise.resolve({ choice: { kind: 'none' as const }, connection: undefined });
    }
    // Read the way a client reads it: as octets, through the package's own
    // decoder. A range constructed in the test would be the hard-coded
    // assumption #43's criteria forbid.
    const powerRange = decodeSupportedPowerRange(
      viewOf([
        ...int16(ranges.minTargetPower),
        ...int16(ranges.maxTargetPower),
        ...int16(ranges.powerIncrement),
      ]),
    );
    const connection: TrainerConnection = {
      control: createTrainerControl(
        {
          enableControlPointIndications: () => {
            controlPoint.enableIndications();
            return Promise.resolve();
          },
          onControlPointIndication: (listener) =>
            controlPoint.onResponse((response) => listener(responseToOctets(response))),
          onStatus: (listener) => {
            statusListeners.push(listener);
            return controlPoint.onStatus((status) => listener(statusToOctets(status)));
          },
          writeControlPoint: (value) => {
            written.push([...value]);
            if (options.refuseStop === true && value[0] === STOP_OR_PAUSE) {
              return Promise.reject(new Error('write not permitted'));
            }
            const outcome = controlPoint.write(requestFromOctets(value));
            if (outcome.kind === 'att-error') {
              return Promise.reject(new Error(outcome.error));
            }
            if (options.permissionLostBeforeStopAnswer === true && value[0] === STOP_OR_PAUSE) {
              for (const listener of [...statusListeners]) {
                listener(viewOf([0xff]));
              }
            }
            if (options.silentTrainer !== true) {
              // The simulator delivers the indication on its next tick.
              bench.advance(seconds(1));
            }
            return Promise.resolve();
          },
        },
        { powerRange, reacquireControl: options.permissionLostBeforeStopAnswer === true },
      ),
      canSetPower: true,
      canSimulate: true,
      powerRange,
    };
    control = connection.control;
    return Promise.resolve({
      choice: {
        kind: 'fitness-machine' as const,
        service: FITNESS_MACHINE_SERVICE,
        controlPoint: FITNESS_MACHINE_CONTROL_POINT,
        vendorAlsoPresent: false,
      },
      connection,
    });
  };

  const controller = createRideController({
    transport,
    store: { ...harnessStore(), ...options.checkpointStore },
    athleteId: ATHLETE_A,
    newSessionId: () => {
      sessionCounter += 1;
      const id = recordingSessionId(`ride-${String(sessionCounter)}`);
      sessionIds.push(id);
      return id;
    },
    now: () => bench.now,
    ...(options.withTrainerControl === false ? {} : { openTrainer }),
    ...(options.rideSave === undefined ? {} : { rideSave: options.rideSave }),
    ...(options.presence === undefined ? {} : { presence: options.presence }),
    ...(options.keepAlive === undefined ? {} : { keepAlive: options.keepAlive }),
    ...(options.notificationPermission === undefined
      ? {}
      : { notificationPermission: options.notificationPermission }),
  });

  return {
    controller,
    bench,
    sessionIds,
    trainerControl: () => control,
    targetOnTheTrainer: () => bench.device(TRAINER).inspect().ftms?.targetPower,
    written,
  };
}

/**
 * Let the promise chain inside `createTrainerControl` run to its write.
 *
 * A procedure is `enqueue` → `enableControlPointIndications` → the write, and
 * every link is a microtask. Advancing the simulator's clock before the write
 * has happened delivers the indication to nobody, and the test then times out
 * waiting for an answer that was sent one tick too early.
 */
async function flushMicrotasks(times = 8): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

/** Advance the simulator and the controller together, one second at a time. */
async function ride(rig: Bench, forSeconds: number): Promise<void> {
  for (let index = 0; index < forSeconds; index += 1) {
    rig.bench.advance(seconds(1));
    await rig.controller.tick(rig.bench.now);
  }
}

const metric = (rig: Bench, id: 'power' | 'heartRate' | 'cadence' | 'speed') => {
  const found = rig.controller.getSnapshot().metrics.find((entry) => entry.id === id);
  if (found === undefined) {
    throw new Error(`no metric ${id}`);
  }
  return found.state;
};

// --- Pairing and live metrics ------------------------------------------------

describe('what the trainer role asks the chooser for', () => {
  it('names trainer-control rather than arriving at it through the measurements', async () => {
    // #156. The Web Bluetooth adapter grants this origin exactly the services
    // that supply what was requested (#132), and `openFitnessMachine` refuses a
    // control point outside that grant (#152). So before this list named
    // `trainer-control`, the Fitness Machine Service reached the grant only
    // because FTMS happens to supply power, cadence and speed — and narrowing
    // this list would have removed the ability to control the trainer with no
    // diagnosis beyond `capability-unsupported` on a device the athlete
    // deliberately paired as a trainer.
    expect(PAIRING_ROLE_CAPABILITIES.trainer).toContain('trainer-control');
    // And only the trainer role: pairing a strap must not hand this origin a
    // grant to a characteristic that applies physical resistance to a rider.
    expect(PAIRING_ROLE_CAPABILITIES['heart-rate']).not.toContain('trainer-control');
    expect(PAIRING_ROLE_CAPABILITIES['power-meter']).not.toContain('trainer-control');
    expect(PAIRING_ROLE_CAPABILITIES['speed-cadence']).not.toContain('trainer-control');

    // ⚠️ The *grant* is asserted on the declaration, deliberately. This suite
    // drives the #44 simulator, which matches a request against the device's own
    // capability set and holds no grant at all — so a ride here would stay
    // controllable whatever this list says, and a behavioural assertion could
    // not tell the accident from the fix. The grant is the browser adapter's,
    // and `web-bluetooth/src/capabilities.test.ts` is where it is exercised.
    //
    // What a ride here *does* prove is the other half: a request widened by a
    // capability still has to match the trainer the athlete is choosing.
    const rig = benchWith();
    await rig.controller.pair('trainer');
    await ride(rig, 2);

    expect(rig.controller.getSnapshot().sensors.map((sensor) => sensor.role)).toEqual(['trainer']);
    expect(metric(rig, 'power').kind).toBe('live');
    rig.controller.dispose();
  });
});

describe('pairing and the live numbers', () => {
  it('shows a channel as unpaired until something that supplies it is connected', async () => {
    const rig = benchWith();
    expect(metric(rig, 'power').kind).toBe('unpaired');

    await rig.controller.pair('trainer');
    await ride(rig, 2);

    expect(metric(rig, 'power').kind).toBe('live');
    // No strap, so heart rate is not "lost" — it was never there, and telling a
    // rider with no strap that their heart rate has dropped is a false alarm on
    // every ride.
    expect(metric(rig, 'heartRate').kind).toBe('unpaired');
    rig.controller.dispose();
  });

  it('pairs one device per call, because a chooser needs one gesture per device', async () => {
    const rig = benchWith({ devices: 'trainer+strap' });
    await rig.controller.pair('trainer');
    await rig.controller.pair('heart-rate');
    await ride(rig, 2);

    expect(rig.controller.getSnapshot().sensors.map((sensor) => sensor.name)).toEqual([
      'KICKR 1F2A',
      'HRM 04B1',
    ]);
    expect(metric(rig, 'heartRate').kind).toBe('live');
    rig.controller.dispose();
  });

  it('reports a refused pairing rather than throwing it at the caller', async () => {
    const { transport, bench } = createSimulator({ devices: [hrsStrap({ id: 'strap' })] });
    const controller = createRideController({
      transport,
      store: harnessStore(),
      athleteId: ATHLETE_A,
      newSessionId: () => recordingSessionId('unused'),
      now: () => bench.now,
    });

    // No device on this bench serves power, so the chooser finds nothing.
    await expect(controller.pair('power-meter')).resolves.toBeUndefined();

    expect(controller.getSnapshot().pairingError).not.toBeUndefined();
    expect(controller.getSnapshot().sensors).toEqual([]);
    controller.dispose();
  });
});

// --- Criterion 3: a silent sensor reads as unavailable, not as its last value

describe('criterion 3 — a disconnected sensor goes unavailable, and does not freeze', () => {
  it(`says so within ${String(METRIC_STALE_AFTER_SECONDS)} seconds of the last reading`, async () => {
    const rig = benchWith({ devices: 'trainer+strap' });
    await rig.controller.pair('trainer');
    await rig.controller.pair('heart-rate');
    await ride(rig, 3);

    const live = metric(rig, 'heartRate');
    expect(live.kind).toBe('live');
    const lastValue = live.kind === 'live' ? live.value : 0;
    expect(lastValue).toBeGreaterThan(0);

    // The strap goes. `disconnect` stops the notifications; the clock keeps
    // running, which is exactly the situation in which a frozen number looks
    // like a live one.
    await rig.controller.unpair(STRAP);
    await ride(rig, METRIC_STALE_AFTER_SECONDS + 1);

    const after = metric(rig, 'heartRate');
    // Unpaired here, because the rider forgot the device. The value is the
    // assertion either way: whatever the state is, it carries no number.
    expect(after.kind).not.toBe('live');
    expect(JSON.stringify(after)).not.toContain(String(lastValue));
    rig.controller.dispose();
  });

  it('goes stale on a link that drops without being forgotten', async () => {
    const rig = benchWith({ devices: 'trainer+strap' });
    await rig.controller.pair('trainer');
    await rig.controller.pair('heart-rate');
    await ride(rig, 3);
    expect(metric(rig, 'heartRate').kind).toBe('live');

    // Notifications stop while the connection state stays `connected` — the
    // dropout a real strap produces when it slips, and the one a state-based
    // check cannot see at all.
    rig.bench.device(STRAP).script({ kind: 'notification-dropout', duration: seconds(30) });
    await ride(rig, METRIC_STALE_AFTER_SECONDS + 1);

    const state = metric(rig, 'heartRate');
    expect(state.kind).toBe('stale');
    expect(state.kind === 'stale' ? state.silentForSeconds : 0).toBeGreaterThanOrEqual(
      METRIC_STALE_AFTER_SECONDS,
    );
    rig.controller.dispose();
  });

  it('is still live one second before the threshold, so the boundary is a real one', async () => {
    const rig = benchWith({ devices: 'trainer+strap' });
    await rig.controller.pair('trainer');
    await rig.controller.pair('heart-rate');
    await ride(rig, 3);

    rig.bench.device(STRAP).script({ kind: 'notification-dropout', duration: seconds(30) });
    await ride(rig, METRIC_STALE_AFTER_SECONDS);

    expect(metric(rig, 'heartRate').kind).toBe('live');
    rig.controller.dispose();
  });
});

// --- Criterion 4: recording survives a dropout, and the gap survives with it -

describe('criterion 4 — a dropout leaves a gap and does not end the ride', () => {
  it('keeps recording across a disconnect and a reconnect, with the gap intact', async () => {
    const rig = benchWith({ devices: 'trainer+strap' });
    await rig.controller.pair('trainer');
    await rig.controller.pair('heart-rate');
    await rig.controller.start();
    await ride(rig, 5);

    rig.bench.device(STRAP).script({ kind: 'notification-dropout', duration: seconds(5) });
    await ride(rig, 5);
    await ride(rig, 5);

    const snapshot = rig.controller.getSnapshot();
    expect(snapshot.phase).toBe('recording');
    // Power came from the trainer throughout, so the ride never stopped.
    expect(metric(rig, 'power').kind).toBe('live');
    expect(snapshot.sampleCount).toBeGreaterThan(10);

    rig.controller.dispose();
  });
});

// --- Auto-pause: the engine can leave a pause on its own ---------------------

describe('the screen agrees with the engine about pausing, in both directions', () => {
  /**
   * Long enough that the engine has auto-paused **while the signal is still
   * gone**, so the paused assertion is not racing the reading that ends it.
   */
  const STOPPED_FOR_SECONDS = DEFAULT_AUTO_PAUSE_AFTER_SECONDS + 5;

  /**
   * ⚠️ **The engine auto-resumes.**
   *
   * `RecordingSession.observe` ends an *automatic* pause the moment a moving
   * reading arrives (`packages/domain/src/recording/session.ts`), so a mirror
   * that only ever copies `paused` onto the screen sticks there for the rest of
   * the ride: the recording carries on and `movingTime` climbs while the screen
   * offers a Resume button the controller refuses — which leaves Pause
   * unreachable too, because it is the other arm of the same branch.
   *
   * Reaching it needs a gap longer than the auto-pause threshold in **speed and
   * cadence together**, which is why no fixture with a movement signal running
   * can see it. That is what these two cases exist to be.
   */
  it('pauses itself when the movement signal stops, and comes back when it returns', async () => {
    const rig = benchWith();
    await rig.controller.pair('trainer');
    await rig.controller.start();
    await ride(rig, 5);
    expect(rig.controller.getSnapshot().phase).toBe('recording');

    // The rider stops pedalling: nothing arrives on speed or cadence for longer
    // than `DEFAULT_AUTO_PAUSE_AFTER_SECONDS`.
    rig.bench.device(TRAINER).script({
      kind: 'notification-dropout',
      duration: seconds(STOPPED_FOR_SECONDS),
    });
    await ride(rig, DEFAULT_AUTO_PAUSE_AFTER_SECONDS + 2);

    expect(rig.controller.getSnapshot().phase).toBe('paused');
    const movingWhilePaused = rig.controller.getSnapshot().movingSeconds;

    // And back on the pedals: the readings resume when the dropout ends.
    await ride(rig, STOPPED_FOR_SECONDS);

    expect(rig.controller.getSnapshot().phase).toBe('recording');
    // Not a phase that merely reads better: the engine really is recording
    // again, and moving time is climbing with it.
    expect(rig.controller.getSnapshot().movingSeconds).toBeGreaterThan(movingWhilePaused);
    rig.controller.dispose();
  });

  it('says "recording" from the reading that woke the engine, not from the next tick', async () => {
    // The measurement is what wakes the engine, and a screen that waited for a
    // tick would offer Resume for up to a second after the ride resumed —
    // pressing it reaches `resume()` on a session that is already recording.
    const rig = benchWith();
    await rig.controller.pair('trainer');
    await rig.controller.start();
    await ride(rig, 3);

    rig.bench.device(TRAINER).script({
      kind: 'notification-dropout',
      duration: seconds(STOPPED_FOR_SECONDS),
    });
    await ride(rig, DEFAULT_AUTO_PAUSE_AFTER_SECONDS + 2);
    expect(rig.controller.getSnapshot().phase).toBe('paused');

    // Readings, with no tick behind them.
    rig.bench.advance(seconds(STOPPED_FOR_SECONDS));

    expect(rig.controller.getSnapshot().phase).toBe('recording');
    // So the control the screen offers is the one the controller will take.
    await rig.controller.pause();
    expect(rig.controller.getSnapshot().phase).toBe('paused');
    rig.controller.dispose();
  });
});

// --- Criterion 6: stop is confirmed -----------------------------------------

describe('criterion 6 — one click cannot end a ride', () => {
  it('leaves the recording running after a single press of Stop', async () => {
    const rig = benchWith();
    await rig.controller.pair('trainer');
    await rig.controller.start();
    await ride(rig, 5);

    rig.controller.armStop();

    expect(rig.controller.getSnapshot().phase).toBe('recording');
    expect(rig.controller.getSnapshot().stopArmed).toBe(true);
    // And the ride keeps accumulating while the confirmation is on screen.
    const before = rig.controller.getSnapshot().sampleCount;
    await ride(rig, 3);
    expect(rig.controller.getSnapshot().sampleCount).toBeGreaterThan(before);
    rig.controller.dispose();
  });

  it('refuses to stop when nothing armed it, however the confirm was reached', async () => {
    const rig = benchWith();
    await rig.controller.pair('trainer');
    await rig.controller.start();
    await ride(rig, 3);

    await rig.controller.confirmStop();

    expect(rig.controller.getSnapshot().phase).toBe('recording');
    rig.controller.dispose();
  });

  it('stops on the second press, and the ride is on disk afterwards', async () => {
    const rig = benchWith();
    await rig.controller.pair('trainer');
    await rig.controller.start();
    await ride(rig, 8);

    rig.controller.armStop();
    await rig.controller.confirmStop();

    expect(rig.controller.getSnapshot().phase).toBe('stopped');

    // Read back through a connection this controller never wrote on — the
    // harness discards every open handle first.
    const sessionId = rig.sessionIds[0];
    const recovered = await harness.read(async (store) =>
      store.recoverRecording(ATHLETE_A, sessionId as RecordingSessionId),
    );
    expect(recovered?.state).toBe('stopped');
    expect(recovered?.sampleCount).toBeGreaterThan(0);
    rig.controller.dispose();
  });

  it('cancels cleanly, so "keep riding" really does', async () => {
    const rig = benchWith();
    await rig.controller.pair('trainer');
    await rig.controller.start();
    rig.controller.armStop();
    rig.controller.cancelStop();
    await rig.controller.confirmStop();

    expect(rig.controller.getSnapshot().phase).toBe('recording');
    rig.controller.dispose();
  });
});

// --- Criteria 1 and 2: requested versus confirmed, and control loss ----------

describe('criterion 1 — a setpoint is requested until the trainer confirms it', () => {
  it('never reports a target as confirmed before the machine answers', async () => {
    const rig = benchWith({ silentTrainer: true });
    await rig.controller.pair('trainer');

    // Request control first, and answer that one — the setpoint is what stays
    // outstanding.
    const asking = rig.controller.requestTrainerControl();
    await flushMicrotasks();
    rig.bench.advance(seconds(1));
    await asking;
    expect(rig.controller.getSnapshot().trainer.hasControl).toBe(true);

    const setting = rig.controller.setTargetPower(watts(250));
    await flushMicrotasks();

    const pending = rig.controller.getSnapshot().trainer;
    expect(pending.requested).toBe(250);
    // Not confirmed, and that is the criterion. The simulated machine has in
    // fact accepted the value already — `targetOnTheTrainer()` reads 250 — and
    // the client still may not say so, because it has had no indication and
    // cannot tell an accepted write from one the machine ignored. Asserting
    // the device is *unset* here would be asserting the wrong thing: the
    // guarantee is about what the screen claims, not about what the trainer
    // did.
    expect(pending.target).toEqual({ kind: 'none' });

    // Now let the machine answer.
    rig.bench.advance(seconds(1));
    await setting;

    const confirmed = rig.controller.getSnapshot().trainer;
    expect(confirmed.requested).toBeUndefined();
    expect(confirmed.target).toEqual({ kind: 'confirmed', target: 250 });
    // And the trainer really is holding it, read from the device rather than
    // from the client that asked for it.
    expect(rig.targetOnTheTrainer()).toBe(250);
    rig.controller.dispose();
  });

  it('refuses a setpoint outside the range the trainer reported, and says why', async () => {
    const rig = benchWith();
    await rig.controller.pair('trainer');
    await rig.controller.requestTrainerControl();

    await rig.controller.setTargetPower(watts(9000));

    const trainer = rig.controller.getSnapshot().trainer;
    expect(trainer.target).toEqual({ kind: 'none' });
    expect(trainer.requested).toBeUndefined();
    // Named against the ceiling the *device* reported, not a constant in this
    // client: the simulator's trainer tops out at 2000 W, and a message quoting
    // any other number would mean the bound came from somewhere else.
    expect(trainer.refusal).toMatch(/9000 W is above the 2000 W/);
    rig.controller.dispose();
  });
});

describe('#14 — riding a saved workout on this screen', () => {
  const THRESHOLD = watts(250);

  const savedWorkout = (blocks: readonly WorkoutBlock[], name = 'Test'): WorkoutRecord => ({
    id: workoutId('w1'),
    createdBy: ATHLETE_A,
    name,
    workout: { name, blocks },
    createdAt: unixSeconds(1),
    updatedAt: unixSeconds(1),
  });

  const twoIntervals = (): WorkoutRecord =>
    savedWorkout([
      { kind: 'steady', seconds: seconds(6), target: thresholdShare(0.6) },
      { kind: 'steady', seconds: seconds(6), target: thresholdShare(1.0) },
    ]);

  it('refuses to start until the trainer has granted control', async () => {
    // ⚠️ #14's revision block names this as the silent failure: a trainer that
    // has not granted control answers every setpoint 0x05 Control Not
    // Permitted, so a workout started here would run its clock and control
    // nothing. The refusal is a return value the screen can act on.
    const rig = benchWith();
    await rig.controller.pair('trainer');

    expect(rig.controller.startWorkout(twoIntervals(), THRESHOLD)).toBe(false);
    expect(rig.controller.getSnapshot().workout).toBeUndefined();
    rig.controller.dispose();
  });

  it('refuses to start with no controllable trainer at all', async () => {
    const rig = benchWith({ withTrainerControl: false });
    await rig.controller.pair('trainer');
    expect(rig.controller.startWorkout(twoIntervals(), THRESHOLD)).toBe(false);
    rig.controller.dispose();
  });

  it('withholds the simulation control while a workout is running', async () => {
    // ⚠️ **There is one control point on the machine, and a running workout
    // owns it.** `RideSession` is mounted above the router, so `workoutTick`
    // keeps writing ERG targets while the rider is on the game screen — and
    // the game's own release is an FTMS Stop, after which the machine ignores
    // setpoints until it is started again. Handing both out at once made the
    // workout's clock run against a machine that had stopped listening while
    // every target reported success: the silent failure `startWorkout` refuses
    // to *start* into, reached after the guard instead.
    const rig = benchWith();
    await rig.controller.pair('trainer');
    await rig.controller.requestTrainerControl();
    await rig.controller.start();

    // Available before, which is what makes the refusal below a refusal rather
    // than a trainer that was never controllable in this rig.
    expect(rig.controller.simulationControl()).toBeDefined();

    expect(rig.controller.startWorkout(twoIntervals(), THRESHOLD)).toBe(true);
    expect(rig.controller.simulationControl()).toBeUndefined();
    rig.controller.dispose();
  });

  it('hands the simulation control back when the workout ends', async () => {
    // The other half, and the one that would go green on a guard that simply
    // never returned a control again. `endWorkout` clears the session, so the
    // game may drive the road on the next ride.
    const rig = benchWith();
    await rig.controller.pair('trainer');
    await rig.controller.requestTrainerControl();
    await rig.controller.start();
    rig.controller.startWorkout(twoIntervals(), THRESHOLD);
    expect(rig.controller.simulationControl()).toBeUndefined();

    rig.controller.endWorkout();
    await flushMicrotasks();
    expect(rig.controller.simulationControl()).toBeDefined();
    rig.controller.dispose();
  });

  it('starts the workout clock at zero, not at the last tick', async () => {
    // ⚠️ The defect this test was written to find. `clock` only moves on a
    // tick, and a backgrounded tab stops ticking while the real clock does not
    // — so anchoring the workout on `clock` started it already seconds old,
    // and the rider was that far into their first interval before they began.
    // `startWorkout` reads `now()`.
    const rig = benchWith();
    await rig.controller.pair('trainer');
    await rig.controller.requestTrainerControl();
    await rig.controller.start();

    // ⚠️ Time passes with no tick, which is what a backgrounded tab is: the
    // interval stops firing and `clock` stops moving while the real clock does
    // not. Anchoring on `clock` here starts the workout five seconds old.
    rig.bench.advance(seconds(5));

    rig.controller.startWorkout(
      savedWorkout([{ kind: 'steady', seconds: seconds(600), target: thresholdShare(0.6) }]),
      THRESHOLD,
    );
    await ride(rig, 1);
    expect(rig.controller.getSnapshot().workout?.elapsedSeconds).toBe(1);
    rig.controller.dispose();
  });

  it('lets the trainer go when one workout replaces another', async () => {
    // ⚠️ Not tidiness. The outgoing session holds an ERG writer with a target
    // possibly still in flight; ending it releases the trainer and closes that
    // writer, so a stale target cannot land on top of the workout that
    // replaced it.
    const rig = benchWith();
    await rig.controller.pair('trainer');
    await rig.controller.requestTrainerControl();
    await rig.controller.start();
    rig.controller.startWorkout(twoIntervals(), THRESHOLD);
    await ride(rig, 2);
    await flushMicrotasks();
    expect(rig.targetOnTheTrainer()).toBe(150);

    rig.controller.startWorkout(
      savedWorkout(
        [{ kind: 'steady', seconds: seconds(600), target: thresholdShare(0.8) }],
        'Second',
      ),
      THRESHOLD,
    );
    await flushMicrotasks();

    // Released, and not yet written to: the replacement has not ticked.
    expect(rig.targetOnTheTrainer()).toBeUndefined();
    rig.controller.dispose();
  });

  it('eases the target when the rider’s cadence collapses under it', async () => {
    // ⚠️ #14's first criterion, through the wiring rather than through the
    // rule. `erg-safety.ts` decides and `session.test.ts` proves the decision;
    // what is proved here is that this screen actually feeds it the cadence
    // stream, which is a different claim and the one a missing line breaks.
    const rig = benchWith();
    await rig.controller.pair('trainer');
    await rig.controller.requestTrainerControl();
    await rig.controller.start();
    rig.controller.startWorkout(
      savedWorkout([{ kind: 'steady', seconds: seconds(600), target: thresholdShare(1.0) }]),
      THRESHOLD,
    );

    await ride(rig, 2);
    await flushMicrotasks();
    expect(rig.targetOnTheTrainer()).toBe(250);

    // The rider loses the fight: cadence falls away under the target.
    for (const rpm of [88, 80, 72, 64, 56, 50, 46]) {
      rig.bench.rider.set({ cadence: revolutionsPerMinute(rpm) });
      await ride(rig, 1);
      await flushMicrotasks();
    }

    const held = rig.targetOnTheTrainer();
    expect(held).toBeDefined();
    expect(held).toBeLessThan(250);
    rig.controller.dispose();
  });

  it('holds the first interval on the trainer itself', async () => {
    const rig = benchWith();
    await rig.controller.pair('trainer');
    await rig.controller.requestTrainerControl();
    await rig.controller.start();

    expect(rig.controller.startWorkout(twoIntervals(), THRESHOLD)).toBe(true);
    await ride(rig, 2);
    await flushMicrotasks();

    // Read off the simulator's own state, not off what the controller believes.
    expect(rig.targetOnTheTrainer()).toBe(150);
    expect(rig.controller.getSnapshot().workout?.status).toBe('running');
    rig.controller.dispose();
  });

  it('moves to the second interval as the workout clock passes the boundary', async () => {
    // ⚠️ Ridden until the workout's own clock says it has crossed, rather than
    // for a fixed number of `ride` steps. Every control-point write in this rig
    // advances the simulated clock a second of its own — that is the bridge
    // modelling an indication arriving on the next tick — so a workout writing
    // at 1 Hz runs the bench roughly twice as fast as the loop counter, and a
    // fixed count would sail past the end of the workout instead.
    const rig = benchWith();
    await rig.controller.pair('trainer');
    await rig.controller.requestTrainerControl();
    await rig.controller.start();
    rig.controller.startWorkout(
      savedWorkout([
        { kind: 'steady', seconds: seconds(30), target: thresholdShare(0.6) },
        { kind: 'steady', seconds: seconds(600), target: thresholdShare(1.0) },
      ]),
      THRESHOLD,
    );

    while ((rig.controller.getSnapshot().workout?.elapsedSeconds ?? 0) < 32) {
      await ride(rig, 1);
      await flushMicrotasks();
    }

    expect(rig.controller.getSnapshot().workout?.status).toBe('running');
    expect(rig.targetOnTheTrainer()).toBe(250);
    rig.controller.dispose();
  });

  it('runs the workout clock off the ride clock, not a second one', async () => {
    // ⚠️ The join this wiring exists to make, asserted as the claim rather than
    // as a number: over the same stretch the workout's elapsed time and the
    // ride's advance by the SAME amount. Two clocks drift, and an hour in they
    // disagree about which interval a sample belongs to. Written as a delta
    // because the rig's own clock jumps a second per control-point write, so
    // an absolute figure would be asserting the harness rather than the join.
    const rig = benchWith();
    await rig.controller.pair('trainer');
    await rig.controller.requestTrainerControl();
    await rig.controller.start();
    rig.controller.startWorkout(
      savedWorkout([{ kind: 'steady', seconds: seconds(600), target: thresholdShare(0.6) }]),
      THRESHOLD,
    );
    await ride(rig, 2);
    await flushMicrotasks();

    const rideBefore = rig.controller.getSnapshot().elapsedSeconds;
    const workoutBefore = rig.controller.getSnapshot().workout?.elapsedSeconds ?? -1;

    await ride(rig, 5);
    await flushMicrotasks();

    const rideAfter = rig.controller.getSnapshot().elapsedSeconds;
    const workoutAfter = rig.controller.getSnapshot().workout?.elapsedSeconds ?? -1;

    expect(rideAfter - rideBefore).toBeGreaterThan(0);
    expect(workoutAfter - workoutBefore).toBe(rideAfter - rideBefore);
    rig.controller.dispose();
  });

  it('pauses the workout when the ride pauses, and resumes it with the ride', async () => {
    // ⚠️ The other join. A rider who paused has stopped riding the workout
    // too, and a workout whose clock ran through the break would put them
    // further into an interval than they are. Driven through the explicit
    // pause rather than the automatic one because a paired trainer streams
    // speed at 1 Hz — so the engine never sees the stillness that would
    // auto-pause it, which is `channels.ts` working rather than a gap.
    const rig = benchWith();
    await rig.controller.pair('trainer');
    await rig.controller.requestTrainerControl();
    await rig.controller.start();
    rig.controller.startWorkout(
      savedWorkout([{ kind: 'steady', seconds: seconds(600), target: thresholdShare(0.6) }]),
      THRESHOLD,
    );

    await ride(rig, 3);
    await rig.controller.pause();
    // One tick to carry the pause into the workout, then the reading that the
    // twenty seconds after it are measured against.
    await ride(rig, 1);
    const whenPaused = rig.controller.getSnapshot().workout?.elapsedSeconds ?? -1;

    await ride(rig, 20);

    expect(rig.controller.getSnapshot().phase).toBe('paused');
    expect(rig.controller.getSnapshot().workout?.status).toBe('paused');
    // Held exactly where it was, rather than running through twenty seconds of
    // standing still.
    expect(rig.controller.getSnapshot().workout?.elapsedSeconds).toBe(whenPaused);

    await rig.controller.resume();
    await ride(rig, 2);
    expect(rig.controller.getSnapshot().workout?.status).toBe('running');
    expect(rig.controller.getSnapshot().workout?.elapsedSeconds).toBeGreaterThan(whenPaused);
    rig.controller.dispose();
  });

  it('pauses the workout and keeps it when control is lost', async () => {
    // #14: a disconnect PAUSES and PRESERVES. Not ended — control lost is a
    // thing a rider takes back, and ending here would make a momentary dropout
    // into a session they restart from the beginning.
    const rig = benchWith();
    await rig.controller.pair('trainer');
    await rig.controller.requestTrainerControl();
    await rig.controller.start();
    rig.controller.startWorkout(twoIntervals(), THRESHOLD);
    await ride(rig, 3);

    rig.bench.device(TRAINER).script({ kind: 'control-permission-lost' });
    rig.bench.advance(seconds(1));

    const workout = rig.controller.getSnapshot().workout;
    expect(workout).toBeDefined();
    expect(workout?.status).toBe('paused');
    expect(workout?.elapsedSeconds).toBeGreaterThan(0);
    rig.controller.dispose();
  });

  it('names the block being ridden in the words the library uses', async () => {
    const rig = benchWith();
    await rig.controller.pair('trainer');
    await rig.controller.requestTrainerControl();
    await rig.controller.start();
    rig.controller.startWorkout(twoIntervals(), THRESHOLD);
    await ride(rig, 2);

    expect(rig.controller.getSnapshot().workout?.nowRiding).toBe('6 s at 60%');
    rig.controller.dispose();
  });

  it('ends the workout before it releases the trainer on Stop', async () => {
    // ⚠️ The order. A workout still running would write a target back onto a
    // machine `stopTrainer` had just released.
    const rig = benchWith();
    await rig.controller.pair('trainer');
    await rig.controller.requestTrainerControl();
    await rig.controller.start();
    rig.controller.startWorkout(twoIntervals(), THRESHOLD);
    await ride(rig, 2);
    await flushMicrotasks();
    expect(rig.targetOnTheTrainer()).toBe(150);

    rig.controller.armStop();
    await rig.controller.confirmStop();
    await flushMicrotasks();

    expect(rig.controller.getSnapshot().workout).toBeUndefined();
    expect(rig.targetOnTheTrainer()).toBeUndefined();
    rig.controller.dispose();
  });

  it('ends on request and leaves the recording running', async () => {
    const rig = benchWith();
    await rig.controller.pair('trainer');
    await rig.controller.requestTrainerControl();
    await rig.controller.start();
    rig.controller.startWorkout(twoIntervals(), THRESHOLD);
    await ride(rig, 2);

    rig.controller.endWorkout();

    expect(rig.controller.getSnapshot().workout).toBeUndefined();
    expect(rig.controller.getSnapshot().phase).toBe('recording');
    rig.controller.dispose();
  });

  it('replaces a running workout rather than stacking two', async () => {
    const rig = benchWith();
    await rig.controller.pair('trainer');
    await rig.controller.requestTrainerControl();
    await rig.controller.start();
    rig.controller.startWorkout(twoIntervals(), THRESHOLD);
    await ride(rig, 2);

    rig.controller.startWorkout(
      savedWorkout(
        [{ kind: 'steady', seconds: seconds(600), target: thresholdShare(0.8) }],
        'Second',
      ),
      THRESHOLD,
    );

    const workout = rig.controller.getSnapshot().workout;
    expect(workout?.name).toBe('Second');
    // A fresh clock, not the first workout's: this is a different session.
    expect(workout?.elapsedSeconds).toBe(0);
    rig.controller.dispose();
  });
});

describe('criterion 2 — losing control is said out loud', () => {
  it('surfaces a withdrawn control permission and stops claiming a target', async () => {
    const rig = benchWith();
    await rig.controller.pair('trainer');
    await rig.controller.requestTrainerControl();
    await rig.controller.setTargetPower(watts(200));
    expect(rig.controller.getSnapshot().trainer.target).toEqual({
      kind: 'confirmed',
      target: 200,
    });

    // Another app takes control, which is Fitness Machine Status 0xFF.
    rig.bench.device(TRAINER).script({ kind: 'control-permission-lost' });
    rig.bench.advance(seconds(1));

    const trainer = rig.controller.getSnapshot().trainer;
    expect(trainer.lost).toBe('permission-lost');
    expect(trainer.hasControl).toBe(false);
    expect(trainer.target).toEqual({ kind: 'none' });
    rig.controller.dispose();
  });

  it('marks the target unknown rather than confirmed when the link drops', async () => {
    const rig = benchWith();
    await rig.controller.pair('trainer');
    await rig.controller.requestTrainerControl();
    await rig.controller.setTargetPower(watts(180));

    rig.bench.device(TRAINER).script({ kind: 'disconnect' });
    rig.bench.advance(seconds(1));

    const trainer = rig.controller.getSnapshot().trainer;
    expect(trainer.lost).toBe('link-lost');
    // Not `confirmed`. The machine is still holding 180 W and this app can no
    // longer change it; saying "holding" would tell the rider everything is
    // fine.
    expect(trainer.target).toEqual({ kind: 'unknown', attempted: 180 });
    rig.controller.dispose();
  });

  it('clears the loss only when the rider asks for control again', async () => {
    const rig = benchWith();
    await rig.controller.pair('trainer');
    await rig.controller.requestTrainerControl();
    rig.bench.device(TRAINER).script({ kind: 'control-permission-lost' });
    rig.bench.advance(seconds(1));
    expect(rig.controller.getSnapshot().trainer.lost).toBe('permission-lost');

    // A tick is not an answer. Time passing must not clear a notice the rider
    // has not acted on.
    await ride(rig, 5);
    expect(rig.controller.getSnapshot().trainer.lost).toBe('permission-lost');

    await rig.controller.requestTrainerControl();
    expect(rig.controller.getSnapshot().trainer.lost).toBeUndefined();
    expect(rig.controller.getSnapshot().trainer.hasControl).toBe(true);
    rig.controller.dispose();
  });

  it('reports no trainer control at all when the device offers none', async () => {
    const rig = benchWith({ withTrainerControl: false });
    await rig.controller.pair('trainer');

    const trainer = rig.controller.getSnapshot().trainer;
    expect(trainer.paired).toBe(true);
    expect(trainer.controllable).toBe(false);
    expect(trainer.canSetPower).toBe(false);
    rig.controller.dispose();
  });
});

// --- Pausing by hand, ending ERG by hand, and the controller's own clock -----

describe('pausing and resuming by hand', () => {
  it('pauses the engine, not only the screen, and checkpoints it as paused', async () => {
    const rig = benchWith();
    await rig.controller.pair('trainer');
    await rig.controller.start();
    await ride(rig, 5);

    await rig.controller.pause();

    expect(rig.controller.getSnapshot().phase).toBe('paused');
    // Read back on a connection this controller never wrote through — the
    // harness discards every open handle first. A pause the screen believes in
    // and the disk does not comes back from a crash as moving time.
    const sessionId = rig.sessionIds[0] as RecordingSessionId;
    const paused = await harness.read(async (store) =>
      store.recoverRecording(ATHLETE_A, sessionId),
    );
    expect(paused?.state).toBe('paused');
    rig.controller.dispose();
  });

  it('stops moving time while paused, and starts it again on resume', async () => {
    const rig = benchWith();
    await rig.controller.pair('trainer');
    await rig.controller.start();
    await ride(rig, 5);

    await rig.controller.pause();
    const movingAtPause = rig.controller.getSnapshot().movingSeconds;
    await ride(rig, 5);

    expect(rig.controller.getSnapshot().phase).toBe('paused');
    // A rider off the bike is not riding, and the ride clock says so.
    expect(rig.controller.getSnapshot().movingSeconds).toBe(movingAtPause);

    await rig.controller.resume();
    await ride(rig, 5);

    expect(rig.controller.getSnapshot().phase).toBe('recording');
    expect(rig.controller.getSnapshot().movingSeconds).toBeGreaterThan(movingAtPause);
    // The same recording, not a second one: `newSessionId` was called once.
    expect(rig.sessionIds).toHaveLength(1);
    rig.controller.dispose();
  });

  it('is not woken by a reading, because a manual pause is not an automatic one', async () => {
    // The engine's rule, and the screen has to keep it: a rider who paused at a
    // cafe and knocked the cranks has not restarted their ride.
    const rig = benchWith();
    await rig.controller.pair('trainer');
    await rig.controller.start();
    await ride(rig, 3);
    await rig.controller.pause();

    await ride(rig, 5);

    expect(rig.controller.getSnapshot().phase).toBe('paused');
    rig.controller.dispose();
  });

  it('ignores a pause or a resume that the phase does not allow', async () => {
    // `RecordingSession` throws on a transition it does not permit, and these
    // two are reachable from a button that was on screen a moment ago. An
    // unhandled rejection out of a click handler is the failure this prevents.
    const rig = benchWith();
    await rig.controller.pair('trainer');

    await rig.controller.pause();
    await rig.controller.resume();
    expect(rig.controller.getSnapshot().phase).toBe('idle');

    await rig.controller.start();
    await rig.controller.resume();
    expect(rig.controller.getSnapshot().phase).toBe('recording');

    await rig.controller.pause();
    await rig.controller.pause();
    expect(rig.controller.getSnapshot().phase).toBe('paused');
    rig.controller.dispose();
  });
});

/** The octets of a write, by op code: FTMS Table 4.15. */
const RESET = 0x01;
const STOP_OR_PAUSE = 0x08;

describe('ending ERG by hand — the "End ERG" button', () => {
  it('takes the trainer out of ERG without ending the ride', async () => {
    // ⚠️ #372: this used to read the target back from a simulator that
    // DROPPED it on a Stop, and so asserted a release the one real trainer
    // measured does not perform. What is asserted now is what was sent.
    const rig = benchWith({ machine: { retainsTargetsThroughStop: true } });
    await rig.controller.pair('trainer');
    await rig.controller.start();
    await rig.controller.requestTrainerControl();
    await rig.controller.setTargetPower(watts(210));
    expect(rig.targetOnTheTrainer()).toBe(210);
    const before = rig.written.length;

    await rig.controller.clearTargetPower();

    // What was sent: the one release, a Stop — and never a Reset (#442 was
    // re-scoped away from one; it cleared nothing and cost control).
    expect(rig.written.slice(before)).toStrictEqual([[STOP_OR_PAUSE, 0x01]]);
    // ⚠️ Read from the device: the measured machine is STILL holding it. The
    // owner accepted that on 2026-09-21; the test states it rather than hiding
    // it behind a double that clears.
    expect(rig.targetOnTheTrainer()).toBe(210);
    // …so the screen may not say there is no target (PR #444's review). Until
    // then this line asserted `{ kind: 'none' }` two lines below reading 210
    // off the device, and the panel told the rider the trainer was following
    // their effort.
    const after = rig.controller.getSnapshot().trainer;
    expect(after.target).toEqual({ kind: 'unknown', attempted: 210 });
    expect(targetSentence(after)).toBe(
      'The trainer may still be holding 210 W — this app can no longer tell.',
    );
    // And the ride carries on, which is the whole difference between this
    // control and Stop.
    expect(rig.controller.getSnapshot().phase).toBe('recording');
    rig.controller.dispose();
  });

  it('does nothing at all when there is no trainer to end ERG on', async () => {
    const rig = benchWith({ withTrainerControl: false });
    await rig.controller.pair('trainer');

    await rig.controller.clearTargetPower();

    expect(rig.controller.getSnapshot().trainer.refusal).toBeUndefined();
    rig.controller.dispose();
  });
});

describe("tickNow — the browser interval's entry point", () => {
  it("advances at the controller's own clock, so no second clock can disagree", async () => {
    // `useRideClock` calls this and nothing else, so a `tickNow` that did not
    // reach `tick` would leave the recorder frozen while the screen carried on
    // rendering — #46's loss bound stopping in silence.
    //
    // ⚠️ Asserted through **staleness**, not through elapsed time: a reading
    // moves the engine's timeline by itself, so an elapsed clock climbs whether
    // or not anything ticked and a test built on it passes against a `tickNow`
    // that does nothing. Nothing but a tick moves the controller's own clock.
    const rig = benchWith();
    await rig.controller.pair('trainer');
    await rig.controller.start();
    await ride(rig, 3);
    expect(metric(rig, 'power').kind).toBe('live');

    rig.bench.device(TRAINER).script({ kind: 'notification-dropout', duration: seconds(30) });
    rig.bench.advance(seconds(METRIC_STALE_AFTER_SECONDS + 2));
    await rig.controller.tickNow();

    expect(metric(rig, 'power').kind).toBe('stale');
    expect(rig.controller.getSnapshot().elapsedSeconds).toBeGreaterThanOrEqual(
      METRIC_STALE_AFTER_SECONDS,
    );
    rig.controller.dispose();
  });
});

// --- Stopping the ride stops the trainer ------------------------------------

describe('ending a ride takes the trainer out of ERG', () => {
  it('stops the machine before it stops the recording', async () => {
    // ⚠️ This used to assert that the machine "is no longer holding a target",
    // read back from a simulator that dropped targets on a Stop — which the one
    // real trainer measured does not (#372). What is asserted is the release
    // that was sent, and that the recording is stopped after it.
    const rig = benchWith({ machine: { retainsTargetsThroughStop: true } });
    await rig.controller.pair('trainer');
    await rig.controller.start();
    await rig.controller.requestTrainerControl();
    await rig.controller.setTargetPower(watts(220));
    expect(rig.targetOnTheTrainer()).toBe(220);

    rig.controller.armStop();
    await rig.controller.confirmStop();

    expect(rig.written.at(-1)).toStrictEqual([STOP_OR_PAUSE, 0x01]);
    expect(rig.controller.getSnapshot().phase).toBe('stopped');
    rig.controller.dispose();
  });
});

describe('a release is one Stop, and it is not a loss — #372', () => {
  // ⚠️ This block asserted a Reset until #442 was re-scoped, and a reviewer who
  // remembers `[[RESET]]` and `hasControl: false` here is reading the old file.
  // On the owner's trainer the Reset was acknowledged and cleared nothing a
  // Stop did not — and it revoked control, so every ride ended with the rider
  // asking for it again.
  const THRESHOLD = watts(250);
  const oneBlock = (): WorkoutRecord => ({
    id: workoutId('w1'),
    createdBy: ATHLETE_A,
    name: 'Long',
    workout: {
      name: 'Long',
      blocks: [{ kind: 'steady', seconds: seconds(600), target: thresholdShare(0.8) }],
    },
    createdAt: unixSeconds(1),
    updatedAt: unixSeconds(1),
  });

  async function riding(options: BenchOptions = {}): Promise<Bench> {
    const rig = benchWith({ machine: { retainsTargetsThroughStop: true }, ...options });
    await rig.controller.pair('trainer');
    await rig.controller.requestTrainerControl();
    await rig.controller.start();
    return rig;
  }

  it('ends a workout rather than pausing it, with no "Control lost", and keeps control', async () => {
    // ⚠️ A control-loss listener that ran on a release would PAUSE the workout
    // and raise the warning. Ending a workout is not losing control.
    const rig = await riding();
    rig.controller.startWorkout(oneBlock(), THRESHOLD);
    await ride(rig, 2);
    await flushMicrotasks();
    expect(rig.targetOnTheTrainer()).toBe(200);
    const before = rig.written.length;

    rig.controller.endWorkout();
    await flushMicrotasks(20);

    const snapshot = rig.controller.getSnapshot();
    expect(snapshot.workout).toBeUndefined();
    expect(snapshot.trainer.lost).toBeUndefined();
    expect(snapshot.trainer.hasControl).toBe(true);
    expect(snapshot.trainer.releaseFault).toBeUndefined();
    expect(rig.written.slice(before)).toStrictEqual([[STOP_OR_PAUSE, 0x01]]);
    // And the recording carries on: ending a workout is not ending a ride.
    expect(snapshot.phase).toBe('recording');
    rig.controller.dispose();
  });

  it('ends a workout with no "Control lost" and no re-grab when 0xFF beats the Stop’s answer', async () => {
    // PR #442's review: a `0xFF` notified before the answer used to read as an
    // involuntary loss — the warning, `linkLost` on a workout that was ending,
    // and a Request Control written straight after the release.
    const rig = await riding({ permissionLostBeforeStopAnswer: true });
    rig.controller.startWorkout(oneBlock(), THRESHOLD);
    await ride(rig, 2);
    await flushMicrotasks();
    const before = rig.written.length;

    rig.controller.endWorkout();
    await flushMicrotasks(20);
    await ride(rig, 3);
    await flushMicrotasks(20);

    const snapshot = rig.controller.getSnapshot();
    expect(snapshot.workout).toBeUndefined();
    expect(snapshot.trainer.lost).toBeUndefined();
    expect(snapshot.trainer.releaseFault).toBeUndefined();
    expect(rig.written.slice(before)).toStrictEqual([[STOP_OR_PAUSE, 0x01]]);
    rig.controller.dispose();
  });

  it('sends ONE Stop when a ride with a workout in it is stopped, and reports no fault', async () => {
    // The workout's release and the ride's are joined into one.
    const rig = await riding();
    rig.controller.startWorkout(oneBlock(), THRESHOLD);
    await ride(rig, 2);
    await flushMicrotasks();
    const before = rig.written.length;

    rig.controller.armStop();
    await rig.controller.confirmStop();
    await flushMicrotasks(20);

    expect(rig.written.slice(before)).toStrictEqual([[STOP_OR_PAUSE, 0x01]]);
    expect(rig.written.some((write) => write[0] === RESET)).toBe(false);
    expect(rig.controller.getSnapshot().trainer.releaseFault).toBeUndefined();
    expect(rig.controller.getSnapshot().trainer.refusal).toBeUndefined();
    rig.controller.dispose();
  });

  it('does not re-request control after a release, and needs none for the next game ride', async () => {
    // Rule 2 at the top of `controller.ts`: exactly one Request Control, the
    // rider's. And because a Stop keeps control, the next game ride is READY
    // — which is the whole of what the re-scope bought back.
    const rig = await riding();
    await rig.controller.clearTargetPower();
    await ride(rig, 5);
    await flushMicrotasks(20);

    expect(rig.controller.getSnapshot().trainer.hasControl).toBe(true);
    expect(rig.written.filter((write) => write[0] === 0x00)).toHaveLength(1);
    expect(
      gameTrainerFrom(
        rig.controller.getSnapshot().trainer,
        rig.controller.simulationControl(),
        false,
      ).kind,
    ).toBe('ready');
    rig.controller.dispose();
  });

  it('releases a game ride through the same Stop, and does not report it as a loss', async () => {
    const rig = await riding();
    const handle = rig.controller.simulationControl();
    await handle?.setSimulationParameters({ grade: gradePercent(6) });
    const before = rig.written.length;

    const outcome = await handle?.letGo();
    await flushMicrotasks(20);

    expect(outcome).toStrictEqual({ kind: 'stopped' });
    expect(rig.written.slice(before)).toStrictEqual([[STOP_OR_PAUSE, 0x01]]);
    expect(rig.controller.getSnapshot().trainer.lost).toBeUndefined();
    rig.controller.dispose();
  });

  it('keeps control when one workout replaces another, so the new one can drive the trainer', async () => {
    const rig = await riding();
    rig.controller.startWorkout(oneBlock(), THRESHOLD);
    await ride(rig, 2);
    await flushMicrotasks();

    rig.controller.startWorkout(
      {
        ...oneBlock(),
        name: 'Second',
        workout: {
          name: 'Second',
          blocks: [{ kind: 'steady', seconds: seconds(600), target: thresholdShare(0.6) }],
        },
      },
      THRESHOLD,
    );
    await ride(rig, 2);
    await flushMicrotasks();

    expect(rig.written.some((write) => write[0] === RESET)).toBe(false);
    expect(rig.controller.getSnapshot().trainer.hasControl).toBe(true);
    expect(rig.targetOnTheTrainer()).toBe(150);
    rig.controller.dispose();
  });

  it('tells the rider when the trainer refused the Stop, and clears that when control is taken', async () => {
    const rig = await riding({ refuseStop: true });
    await rig.controller.setTargetPower(watts(200));
    const before = rig.written.length;

    await rig.controller.clearTargetPower();
    await flushMicrotasks(20);

    // One attempt, and nothing sent after the refusal: no Reset, no flat road.
    expect(rig.written.slice(before)).toStrictEqual([[STOP_OR_PAUSE, 0x01]]);
    const fault = rig.controller.getSnapshot().trainer.releaseFault;
    expect(fault).toContain('may still be holding resistance');

    await rig.controller.requestTrainerControl();
    expect(rig.controller.getSnapshot().trainer.releaseFault).toBeUndefined();
    rig.controller.dispose();
  });
});

describe('a paused ride eases the workout to the trainer’s OWN floor — #441', () => {
  it('writes the minimum the trainer reported, as a 0x05, and no Stop', async () => {
    // ⚠️ Through the controller's own composition, because the floor is the
    // controller's to supply: it is read off the machine's Supported Power
    // Range at pairing. A floor of 30 W here, so a hard-coded 0 is a red test.
    const rig = benchWith({
      machine: { retainsTargetsThroughStop: true, minTargetPower: watts(30) },
    });
    await rig.controller.pair('trainer');
    await rig.controller.requestTrainerControl();
    await rig.controller.start();
    rig.controller.startWorkout(
      {
        id: workoutId('w1'),
        createdBy: ATHLETE_A,
        name: 'Long',
        workout: {
          name: 'Long',
          blocks: [{ kind: 'steady', seconds: seconds(600), target: thresholdShare(0.8) }],
        },
        createdAt: unixSeconds(1),
        updatedAt: unixSeconds(1),
      },
      watts(250),
    );
    await ride(rig, 2);
    await flushMicrotasks();
    expect(rig.targetOnTheTrainer()).toBe(200);
    const before = rig.written.length;

    await rig.controller.pause();
    await ride(rig, 2);
    await flushMicrotasks(20);

    expect(rig.written.slice(before)).toStrictEqual([[0x05, 30, 0]]);
    expect(rig.targetOnTheTrainer()).toBe(30);
    rig.controller.dispose();
  });
});

// --- The snapshot itself -----------------------------------------------------

describe('the snapshot', () => {
  it('is stable between changes, so a subscriber does not re-render for ever', async () => {
    const rig = benchWith();
    await rig.controller.pair('trainer');
    const first = rig.controller.getSnapshot();
    expect(rig.controller.getSnapshot()).toBe(first);

    await ride(rig, 1);
    expect(rig.controller.getSnapshot()).not.toBe(first);
    rig.controller.dispose();
  });

  it('notifies subscribers, and stops when they unsubscribe', async () => {
    const rig = benchWith();
    let changes = 0;
    const stop = rig.controller.subscribe(() => {
      changes += 1;
    });
    await rig.controller.pair('trainer');
    expect(changes).toBeGreaterThan(0);

    stop();
    const after = changes;
    await ride(rig, 2);
    expect(changes).toBe(after);
    rig.controller.dispose();
  });

  it('counts down the connections this transport will still take', async () => {
    const rig = benchWith({ devices: 'trainer+strap' });
    expect(rig.controller.getSnapshot().connectionsRemaining).toBe(3);
    await rig.controller.pair('trainer');
    expect(rig.controller.getSnapshot().connectionsRemaining).toBe(2);
    rig.controller.dispose();
  });
});

/**
 * ⚠️ **The ordering the save path keeps is the data-safety argument, not a
 * detail.** Until the activity is on disk the checkpoint is the only copy of
 * the ride — there is no server in this milestone — so a discard that ran first
 * would turn a failed save into a lost ride.
 */
function savePort(overrides: Partial<RideSavePort['store']> = {}): {
  port: RideSavePort;
  saved: string[];
} {
  const saved: string[] = [];
  return {
    saved,
    port: {
      newActivityId: () => activityId('saved-ride'),
      timeZone: 'Europe/London',
      store: {
        putActivity: (record) => {
          saved.push(record.id);
          return Promise.resolve(record.id);
        },
        putStreamSet: (set) => Promise.resolve(set.activityId),
        deleteActivity: () => Promise.resolve(true),
        ...overrides,
      },
    },
  };
}

/**
 * A second controller over the same store — what a reload actually is.
 *
 * ⚠️ Needed because `refreshRecoverable` excludes the session **this tab is
 * holding**, and a controller keeps its recorder after the ride stops. So a
 * leftover row is invisible to the controller that made it and appears on the
 * next open, which is exactly what the "it will be offered back next time"
 * wording promises. A test that used the first controller would be asserting
 * against a list that is empty for a reason unrelated to what it is testing.
 */
function reopened(
  overrides: Partial<RecordingCheckpointStore> = {},
  rideSave?: RideSavePort,
): RideController {
  return createRideController({
    transport: createSimulator({ devices: [] }).transport,
    store: { ...harnessStore(), ...overrides },
    athleteId: ATHLETE_A,
    newSessionId: () => recordingSessionId('after-reload'),
    now: () => unixSeconds(1_800_000_000),
    // ⚠️ **A reopened controller needs a save port for any assertion about
    // saving to mean anything**, and leaving it out made the duplicate test
    // pass for the wrong reason: `saveTheRide` returns early with no port, so
    // "no second copy was written" was true because nothing *could* write one.
    // Caught by a mutation that should have gone red and did not.
    ...(rideSave === undefined ? {} : { rideSave }),
  });
}

describe('a ride that saved but could not be tidied up is not offered back to be saved again', () => {
  it('reports the ride saved AND says a working copy was left behind', async () => {
    // ⚠️ **Found by review.** `discard()` answers `false` when the delete
    // fails, and ignoring that left a ride which HAD saved sitting on disk as a
    // `stopped` row — indistinguishable, from the header, from a ride whose
    // save failed.
    // ⚠️ **The fake REJECTS rather than answering `false`**, and the difference
    // caught this test out first. The store's `false` means *there was no such
    // row*, which is a recording that is genuinely gone — `Recorder.discard`
    // documents exactly that. Only a delete that throws is a delete that
    // failed. Modelling it the other way would have "proved" a bug in correct
    // code.
    const { port, saved } = savePort();
    const rig = benchWith({
      rideSave: port,
      checkpointStore: {
        deleteRecordingSession: () => Promise.reject(new Error('the device is unwell')),
      },
    });
    await rig.controller.pair('trainer');
    await rig.controller.start();
    await ride(rig, 3);
    rig.controller.armStop();
    await rig.controller.confirmStop();

    const snapshot = rig.controller.getSnapshot();
    // The ride IS saved — that is the sentence that matters to a rider.
    expect(saved).toEqual(['saved-ride']);
    expect(snapshot.saveState).toBe('saved');
    // And the part they would otherwise misread on the next visit.
    expect(snapshot.leftover).toBe(true);
    rig.controller.dispose();
  });

  it('offers the leftover discard only, never save', async () => {
    const { port, saved } = savePort();
    const rig = benchWith({
      rideSave: port,
      checkpointStore: {
        deleteRecordingSession: () => Promise.reject(new Error('the device is unwell')),
      },
    });
    await rig.controller.pair('trainer');
    await rig.controller.start();
    await ride(rig, 3);
    rig.controller.armStop();
    await rig.controller.confirmStop();
    rig.controller.dispose();

    const after = reopened({}, port);
    await after.refreshRecoverable();
    const [offered] = after.getSnapshot().recoverable;
    expect(offered?.kind).toBe('already-saved');
    expect(offered?.alreadySaved).toBe(true);
    expect(offered?.canContinue).toBe(false);

    // ⚠️ The whole point: pressing Save on it must not write a SECOND copy of
    // the same ride under a fresh activity id, which is what happened before
    // the link was stored.
    await after.saveRecovered(offered!.id);
    expect(saved).toEqual(['saved-ride']);
    after.dispose();
  });
});

describe('a recording too corrupt to rebuild can still be thrown away', () => {
  it('discards without decoding a single chunk', async () => {
    // ⚠️ **Found by review.** `recoverRecording` throws on a corrupt chunk, and
    // listing a recording reads only its header — so a corrupt one was listed,
    // could not be continued, saved OR discarded, and sat in the offer for ever
    // with no message. Discarding needs the two ids and nothing else.
    const deleted: string[] = [];
    const rig = benchWith({
      checkpointStore: {
        recoverRecording: () => Promise.reject(new Error('chunk 3 will not decode')),
        deleteRecordingSession: (_owner, id) => {
          deleted.push(id);
          return Promise.resolve(true);
        },
      },
    });
    await rig.controller.pair('trainer');
    await rig.controller.start();
    await ride(rig, 3);
    rig.controller.armStop();
    await rig.controller.confirmStop();
    rig.controller.dispose();

    const after = reopened({
      recoverRecording: () => Promise.reject(new Error('chunk 3 will not decode')),
      deleteRecordingSession: (_owner, id) => {
        deleted.push(id);
        return Promise.resolve(true);
      },
    });
    await after.refreshRecoverable();
    const [offered] = after.getSnapshot().recoverable;
    expect(offered).toBeDefined();
    expect(await after.discardRecovered(offered!.id)).toBe(true);
    expect(deleted).toEqual([offered!.id]);
    after.dispose();
  });

  it('answers rather than rejecting when it cannot be continued or saved', async () => {
    // ⚠️ **No save port**, so the row is left `stopped` and *unsaved* — the
    // case where a rider would reach for Save. With one, the row would be
    // `already-saved` and `saveRecovered` would answer 'saved' before it ever
    // tried to decode, which is a different behaviour tested above.
    const rig = benchWith({
      checkpointStore: {
        recoverRecording: () => Promise.reject(new Error('chunk 3 will not decode')),
      },
    });
    await rig.controller.pair('trainer');
    await rig.controller.start();
    await ride(rig, 3);
    rig.controller.armStop();
    await rig.controller.confirmStop();
    rig.controller.dispose();

    const after = reopened({
      recoverRecording: () => Promise.reject(new Error('chunk 3 will not decode')),
    });
    await after.refreshRecoverable();
    const [offered] = after.getSnapshot().recoverable;
    expect(offered).toBeDefined();
    // Neither call may reject: the screen fires all three as bare `void`, so a
    // rejection is an unhandled promise and a control that silently does
    // nothing.
    await expect(after.continueRecovered(offered!.id)).resolves.toBe(false);
    await expect(after.saveRecovered(offered!.id)).resolves.toBe('failed');
    after.dispose();
  });
});

describe('a finished ride becomes an activity, and only then lets the checkpoint go', () => {
  it('writes the activity and discards the checkpoint', async () => {
    const { port, saved } = savePort();
    const rig = benchWith({ rideSave: port });
    await rig.controller.pair('trainer');
    await rig.controller.start();
    await ride(rig, 3);
    rig.controller.armStop();
    await rig.controller.confirmStop();

    expect(saved).toEqual(['saved-ride']);
    expect(rig.controller.getSnapshot().saveState).toBe('saved');
    expect(rig.controller.getSnapshot().savedActivityId).toBe('saved-ride');
    // The checkpoint is gone, which is what makes a completed ride stop being
    // offered back as an interrupted one every time the client opens.
    const remaining = await harness.read(async (store) => store.listRecordingSessions(ATHLETE_A));
    expect(remaining).toEqual([]);
    rig.controller.dispose();
  });

  it('KEEPS the checkpoint when the save fails, and says why', async () => {
    const { port } = savePort({
      putStreamSet: () => Promise.reject(new Error('the device is full')),
    });
    const rig = benchWith({ rideSave: port });
    await rig.controller.pair('trainer');
    await rig.controller.start();
    await ride(rig, 3);
    rig.controller.armStop();
    await rig.controller.confirmStop();

    const snapshot = rig.controller.getSnapshot();
    expect(snapshot.saveState).toBe('failed');
    expect(snapshot.saveError).toBe('the device is full');
    // ⚠️ Still there. The rider is offered the ride back on next open, which is
    // the recovery path working rather than a duplicate to apologise for.
    const remaining = await harness.read(async (store) => store.listRecordingSessions(ATHLETE_A));
    expect(remaining.length).toBe(1);
    rig.controller.dispose();
  });

  it('records and checkpoints exactly as before when this build cannot save', async () => {
    // The accessibility suite's case, and every existing test's: no port, so
    // the controller reports `unavailable` rather than pretending.
    const rig = benchWith();
    await rig.controller.pair('trainer');
    await rig.controller.start();
    await ride(rig, 2);
    rig.controller.armStop();
    await rig.controller.confirmStop();
    expect(rig.controller.getSnapshot().saveState).toBe('unavailable');
    rig.controller.dispose();
  });
});

describe('a ride the tab died in the middle of is offered back — #212', () => {
  /**
   * Leave a checkpoint behind the way a closed tab does: record, then dispose
   * without stopping. `dispose` documents that it "does not stop or discard a
   * recording", which is exactly the state a killed tab leaves.
   */
  async function leaveAnInterruptedRide(): Promise<string> {
    const rig = benchWith();
    await rig.controller.pair('trainer');
    await rig.controller.start();
    await ride(rig, 4);
    rig.controller.dispose();
    return rig.sessionIds[0] ?? '';
  }

  it('offers it to a controller that opens afterwards', async () => {
    const id = await leaveAnInterruptedRide();
    const next = benchWith();
    await next.controller.refreshRecoverable();

    const offered = next.controller.getSnapshot().recoverable;
    expect(offered.map((entry) => entry.id)).toEqual([id]);
    expect(offered[0]?.kind).toBe('interrupted');
    expect(offered[0]?.canContinue).toBe(true);
    next.controller.dispose();
  });

  it('never offers the recording this tab is making right now', async () => {
    // ⚠️ The check that stops "Discard" deleting the ride in progress.
    const rig = benchWith();
    await rig.controller.pair('trainer');
    await rig.controller.start();
    await ride(rig, 4);
    await rig.controller.refreshRecoverable();
    expect(rig.controller.getSnapshot().recoverable).toEqual([]);
    rig.controller.dispose();
  });

  it('continues it, paused, so the dead time is not moving time', async () => {
    const id = await leaveAnInterruptedRide();
    const next = benchWith();
    await next.controller.refreshRecoverable();
    expect(await next.controller.continueRecovered(recordingSessionId(id))).toBe(true);

    const snapshot = next.controller.getSnapshot();
    expect(snapshot.phase).toBe('paused');
    // The samples that survived are there to carry on from, not a fresh ride.
    expect(snapshot.sampleCount).toBeGreaterThan(0);
    // And the offer is gone, because it is no longer something to recover.
    expect(snapshot.recoverable).toEqual([]);
    next.controller.dispose();
  });

  it('saves what survived, through the same path a finished ride uses', async () => {
    const id = await leaveAnInterruptedRide();
    const { port, saved } = savePort();
    const next = benchWith({ rideSave: port });
    await next.controller.refreshRecoverable();

    expect(await next.controller.saveRecovered(recordingSessionId(id))).toBe('saved');
    expect(saved).toEqual(['saved-ride']);
    // The checkpoint is gone once the activity is durable — the ordering
    // `finish.ts` argues for, reached by the recovery path too.
    expect(next.controller.getSnapshot().recoverable).toEqual([]);
    next.controller.dispose();
  });

  it('discards it when the rider does not want it', async () => {
    const id = await leaveAnInterruptedRide();
    const next = benchWith();
    await next.controller.refreshRecoverable();
    expect(await next.controller.discardRecovered(recordingSessionId(id))).toBe(true);
    expect(next.controller.getSnapshot().recoverable).toEqual([]);
    next.controller.dispose();
  });

  it('offers nothing while a ride is in progress, whatever is on disk', async () => {
    await leaveAnInterruptedRide();
    const rig = benchWith();
    await rig.controller.pair('trainer');
    await rig.controller.start();
    await rig.controller.refreshRecoverable();
    // ⚠️ A rider mid-ride must not be shown a control that would adopt a
    // different recording out from under the one they are riding.
    expect(rig.controller.getSnapshot().recoverable).toEqual([]);
    rig.controller.dispose();
  });
});

/**
 * #370 — a paired trainer this app will not drive is still a paired trainer.
 *
 * ⚠️ **The wiring these two cases exist for is a one-word difference inside the
 * controller.** `trainerEntry()` selects on `entry.trainer`, which is set only
 * when a control client was built — so reading `controlChoice` through it would
 * be `none` on every device the new message exists for, and the screen would go
 * on saying what it said before. `pairedTrainerEntry()` selects on the role.
 */
describe('what the paired trainer turned out to offer — #370', () => {
  const VENDOR_ONLY: TrainerControlChoice = {
    kind: 'vendor-not-implemented',
    controlPoint: 'a026e005-0a7d-4ab3-97fa-f1500f9feb8b',
  };

  it('reports a vendor-only machine as paired, not controllable, and not nothing', async () => {
    const rig = benchWith({ trainerOffers: VENDOR_ONLY });
    await rig.controller.pair('trainer');

    const trainer = rig.controller.getSnapshot().trainer;

    expect(trainer.paired).toBe(true);
    expect(trainer.controllable).toBe(false);
    expect(trainer.controlChoice).toEqual(VENDOR_ONLY);
    rig.controller.dispose();
  });

  it('carries the standard choice through for a machine it does drive', async () => {
    const rig = benchWith();
    await rig.controller.pair('trainer');

    const trainer = rig.controller.getSnapshot().trainer;

    expect(trainer.controllable).toBe(true);
    expect(trainer.controlChoice).toMatchObject({ kind: 'fitness-machine' });
    rig.controller.dispose();
  });

  it('says nothing is known before anything is paired', () => {
    const rig = benchWith();

    expect(rig.controller.getSnapshot().trainer.controlChoice).toEqual({ kind: 'none' });
    rig.controller.dispose();
  });
});

describe('#390 — a trainer holding a target at an empty bike', () => {
  it('keeps recording without a camera, because the trainer streams speed — the defect', async () => {
    const rig = benchWith();
    await rig.controller.pair('trainer');
    await rig.controller.start();
    await ride(rig, 40);
    expect(rig.controller.getSnapshot().phase).toBe('recording');
    rig.controller.dispose();
  });

  it('pauses through the recorder’s own auto-pause once the camera says nobody is there, and wakes when they return', async () => {
    let presence: RiderPresence = 'present';
    const asked: RiderPresence[] = [];
    const rig = benchWith({
      presence: {
        riderPresence: () => {
          asked.push(presence);
          return presence;
        },
      },
    });
    await rig.controller.pair('trainer');
    await rig.controller.start();
    await ride(rig, 5);
    expect(rig.controller.getSnapshot().phase).toBe('recording');

    presence = 'absent';
    await ride(rig, DEFAULT_AUTO_PAUSE_AFTER_SECONDS + 3);
    expect(rig.controller.getSnapshot().phase).toBe('paused');
    // Read by the recorder on the readings it was handed — the controller
    // itself does not branch on it. @see recording/one-pauser.test.ts
    expect(asked.length).toBeGreaterThan(0);

    presence = 'present';
    await ride(rig, 2);
    expect(rig.controller.getSnapshot().phase).toBe('recording');
    rig.controller.dispose();
  });

  it('never pauses on unknown', async () => {
    const rig = benchWith({ presence: { riderPresence: () => 'unknown' } });
    await rig.controller.pair('trainer');
    await rig.controller.start();
    await ride(rig, 40);
    expect(rig.controller.getSnapshot().phase).toBe('recording');
    rig.controller.dispose();
  });

  it('drives the whole path: the real camera controller, an empty room, a paused ride', async () => {
    // The camera side as `main.tsx` builds it — a `CameraController` IS the
    // port — over a scripted camera looking at a room in which nothing moves.
    const timers = manualSchedule();
    // The camera's clock is the bench's, once there is a bench.
    let benchSeconds = (): number => 0;
    const camera = new CameraController({
      port: scriptedCamera({ luminance: () => stillRoom() }).port,
      schedule: timers.schedule,
      clock: () => benchSeconds() * 1000,
      wait: async () => Promise.resolve(),
    });
    const rig = benchWith({ presence: camera });
    benchSeconds = () => rig.bench.now;
    camera.agree({ acknowledgedBystanders: true, allowLocal: true, allowHosted: false });
    await camera.turnOn();
    camera.watchPresence(true);

    await rig.controller.pair('trainer');
    await rig.controller.start();
    const checkEvery = PRESENCE_CHECK_MILLISECONDS / 1000;
    for (let second = 0; second < 60; second += 1) {
      await ride(rig, 1);
      if (second % checkEvery === 0) {
        timers.fire();
        await new Promise((resolve) => {
          setTimeout(resolve, 0);
        });
      }
    }
    expect(camera.riderPresence()).toBe('absent');
    expect(rig.controller.getSnapshot().phase).toBe('paused');

    // And the rider's own switch is what takes it away again.
    camera.watchPresence(false);
    await ride(rig, 2);
    expect(rig.controller.getSnapshot().phase).toBe('recording');
    rig.controller.dispose();
  });
});

describe('#516 — what the camera’s answer sends a trainer mid-workout', () => {
  // ⚠️ **Presence reaches the trainer, and #515 said it did not.** The chain is
  // `absent` → the recorder counts no reading as movement → the engine's own
  // auto-pause → `syncPhaseWithEngine` → `tick` pauses the workout →
  // `workout/session.ts` §`pause` eases to the machine's Supported Power Range
  // minimum. These pin exactly what that chain writes, on the #44 simulator,
  // as octets — and what the other two answers write, which is nothing.
  const FLOOR = watts(30);
  const OWN_TARGET = 200; // 0.8 × 250 W, the workout's own number
  const SET_TARGET_POWER = 0x05;
  const REQUEST_CONTROL = 0x00;

  const longWorkout = (): WorkoutRecord => ({
    id: workoutId('w1'),
    createdBy: ATHLETE_A,
    name: 'Long',
    workout: {
      name: 'Long',
      blocks: [{ kind: 'steady', seconds: seconds(900), target: thresholdShare(0.8) }],
    },
    createdAt: unixSeconds(1),
    updatedAt: unixSeconds(1),
  });

  /** A workout holding its own target, with the camera answering `answer()`. */
  async function holdingTarget(answer: (() => RiderPresence) | undefined): Promise<Bench> {
    const rig = benchWith({
      machine: { retainsTargetsThroughStop: true, minTargetPower: FLOOR },
      ...(answer === undefined ? {} : { presence: { riderPresence: answer } }),
    });
    await rig.controller.pair('trainer');
    await rig.controller.requestTrainerControl();
    await rig.controller.start();
    expect(rig.controller.startWorkout(longWorkout(), watts(250))).toBe(true);
    await ride(rig, 2);
    await flushMicrotasks();
    expect(rig.targetOnTheTrainer()).toBe(OWN_TARGET);
    return rig;
  }

  it('absent sends the ease to the machine’s own floor, once, and nothing else', async () => {
    let presence: RiderPresence = 'present';
    const rig = await holdingTarget(() => presence);
    const before = rig.written.length;

    presence = 'absent';
    await ride(rig, DEFAULT_AUTO_PAUSE_AFTER_SECONDS + 3);
    await flushMicrotasks(20);
    expect(rig.controller.getSnapshot().phase).toBe('paused');
    // Until the engine paused, the workout went on re-asserting its OWN target
    // as it does on any ride; what the pause added is one Set Target Power at
    // the floor the machine reported — no Stop, no Reset, no Request Control.
    const since = rig.written.slice(before);
    expect(since.at(-1)).toStrictEqual([SET_TARGET_POWER, 30, 0]);
    for (const write of since.slice(0, -1)) {
      expect(write).toStrictEqual([SET_TARGET_POWER, OWN_TARGET, 0]);
    }
    expect(rig.targetOnTheTrainer()).toBe(30);

    // And it stays one write while nobody is there.
    const eased = rig.written.length;
    await ride(rig, 20);
    await flushMicrotasks(20);
    expect(rig.written.slice(eased)).toStrictEqual([]);
    expect(rig.targetOnTheTrainer()).toBe(30);
    rig.controller.dispose();
  });

  it('unknown sends nothing: the workout holds its own target and never eases', async () => {
    const rig = await holdingTarget(() => 'unknown');
    const before = rig.written.length;
    await ride(rig, DEFAULT_AUTO_PAUSE_AFTER_SECONDS + 23);
    await flushMicrotasks(20);
    expect(rig.controller.getSnapshot().phase).toBe('recording');
    // The workout's own re-assertions, and nothing at the floor.
    expect(rig.written.slice(before).length).toBeGreaterThan(0);
    for (const write of rig.written.slice(before)) {
      expect(write).toStrictEqual([SET_TARGET_POWER, OWN_TARGET, 0]);
    }
    expect(rig.targetOnTheTrainer()).toBe(OWN_TARGET);
    rig.controller.dispose();
  });

  it('unknown and present write exactly what a ride with no camera writes', async () => {
    const script = async (answer: (() => RiderPresence) | undefined): Promise<number[][]> => {
      const rig = await holdingTarget(answer);
      await ride(rig, 40);
      await flushMicrotasks(20);
      rig.controller.dispose();
      return rig.written;
    };
    const none = await script(undefined);
    expect(await script(() => 'unknown')).toStrictEqual(none);
    expect(await script(() => 'present')).toStrictEqual(none);
  });

  it('no answer, in any order, raises resistance or takes control', async () => {
    // Every answer, flipped through twice, including the return from `absent`
    // — which resumes the WORKOUT's own target through the engine's own
    // movement rule, never a number above it.
    let presence: RiderPresence = 'present';
    const rig = await holdingTarget(() => presence);
    const controlRequests = rig.written.filter(([op]) => op === REQUEST_CONTROL).length;
    const before = rig.written.length;
    const order: readonly RiderPresence[] = [
      'absent',
      'unknown',
      'present',
      'absent',
      'present',
      'unknown',
      'absent',
    ];
    for (const answer of order) {
      presence = answer;
      await ride(rig, DEFAULT_AUTO_PAUSE_AFTER_SECONDS + 5);
      await flushMicrotasks(20);
    }
    const after = rig.written.slice(before);
    // The ease really happened, so this is not a ride in which nothing moved.
    expect(after).toContainEqual([SET_TARGET_POWER, 30, 0]);
    for (const write of after) {
      // Set Target Power and nothing else: no Request Control, no Start or
      // Resume, no Reset, no simulation parameters.
      expect(write[0]).toBe(SET_TARGET_POWER);
      const target = (write[1] ?? 0) | ((write[2] ?? 0) << 8);
      expect(target).toBeLessThanOrEqual(OWN_TARGET);
    }
    expect(rig.written.filter(([op]) => op === REQUEST_CONTROL)).toHaveLength(controlRequests);
    rig.controller.dispose();
  });
});

/**
 * #524 — the Android foreground service is asked for while a ride is active.
 *
 * `RecordingServicePlugin` was registered and never called, so no ride on
 * Android ever ran with the service that keeps it alive with the screen off.
 * These read what the controller asked of a port handed over as `main.tsx`
 * hands it, across every way a ride starts and ends.
 */
describe('#524 — the ride keeps the process alive while it is active', () => {
  /** A port that records every call, and can be told to refuse them. */
  function recordingPort(refuse = false): RideKeepAlivePort & { readonly calls: string[] } {
    const calls: string[] = [];
    const answer = (): Promise<void> =>
      refuse
        ? Promise.reject(new Error('SecurityException: BLUETOOTH_CONNECT'))
        : Promise.resolve();
    return {
      calls,
      keepRideAlive: () => {
        calls.push('keep');
        return answer();
      },
      letRideSleep: () => {
        calls.push('sleep');
        return answer();
      },
    };
  }

  it('asks for nothing before a ride starts', async () => {
    const port = recordingPort();
    const rig = benchWith({ keepAlive: port });
    await rig.controller.pair('trainer');
    await ride(rig, 3);
    expect(port.calls).toEqual([]);
    rig.controller.dispose();
  });

  it('keeps the process alive from start, through a pause, until the ride stops', async () => {
    const port = recordingPort();
    const rig = benchWith({ keepAlive: port });
    await rig.controller.pair('trainer');
    await rig.controller.start();
    expect(port.calls).toEqual(['keep']);

    await ride(rig, 3);
    await rig.controller.pause();
    await ride(rig, 3);
    await rig.controller.resume();
    await ride(rig, 3);
    // Once per transition, never per tick, and a pause is not a stop.
    expect(port.calls).toEqual(['keep']);

    rig.controller.armStop();
    await rig.controller.confirmStop();
    expect(port.calls).toEqual(['keep', 'sleep']);
    rig.controller.dispose();
    // Letting go twice would be harmless on the device; it is still not asked.
    expect(port.calls).toEqual(['keep', 'sleep']);
  });

  it('keeps the process alive until the stop has sent, flushed and saved', async () => {
    // #565's second review: the stop publishes `stopped` first, and the keep
    // alive used to read only the phase, so it let go before the trainer Stop
    // and the last checkpoint — the writes the service exists to protect.
    const port = recordingPort();
    const rig = benchWith({ keepAlive: port });
    await rig.controller.pair('trainer');
    await rig.controller.start();
    await ride(rig, 3);
    rig.controller.armStop();
    const stopping = rig.controller.confirmStop();
    expect(rig.controller.getSnapshot().stopping).toBe(true);
    expect(port.calls).toEqual(['keep']);
    await stopping;
    expect(port.calls).toEqual(['keep', 'sleep']);
  });

  it('keeps a recovered ride alive when it is continued', async () => {
    const first = benchWith();
    await first.controller.pair('trainer');
    await first.controller.start();
    await ride(first, 4);
    first.controller.dispose();
    const id = first.sessionIds[0] ?? '';

    const port = recordingPort();
    const next = benchWith({ keepAlive: port });
    await next.controller.refreshRecoverable();
    expect(await next.controller.continueRecovered(recordingSessionId(id))).toBe(true);
    expect(port.calls).toEqual(['keep']);
    next.controller.dispose();
  });

  it('lets the process sleep when the controller goes away mid-ride', async () => {
    const port = recordingPort();
    const rig = benchWith({ keepAlive: port });
    await rig.controller.pair('trainer');
    await rig.controller.start();
    rig.controller.dispose();
    expect(port.calls).toEqual(['keep', 'sleep']);
  });

  it('records the ride anyway when the platform refuses', async () => {
    // A refusal is a degraded ride, not a broken one: the phone may cut it
    // short in the background, but refusing to record would lose it for sure.
    const port = recordingPort(true);
    const rig = benchWith({ keepAlive: port });
    await rig.controller.pair('trainer');
    await rig.controller.start();
    await ride(rig, 5);
    expect(rig.controller.getSnapshot().phase).toBe('recording');
    expect(rig.controller.getSnapshot().movingSeconds).toBeGreaterThan(0);
    rig.controller.armStop();
    await rig.controller.confirmStop();
    expect(rig.controller.getSnapshot().phase).toBe('stopped');
    expect(port.calls).toEqual(['keep', 'sleep']);
    rig.controller.dispose();
  });
});

/**
 * #526 — on Android 13+ the rider is asked for `POST_NOTIFICATIONS` once, just
 * before the first ride's foreground service starts, and a refusal never stops
 * the ride.
 *
 * One log is shared by both ports so the ORDER is asserted: the keep-alive
 * comes FIRST and never waits for the question (#531's review — Android only
 * answers once the app is on screen again, so a keep-alive held behind the
 * dialog is missing exactly when the screen is off), a `granted` answer
 * re-starts it so the notification is posted, and nothing at all happens
 * before a ride starts.
 */
describe('#526 — the ride asks once whether it may show its notification', () => {
  interface Device {
    /** What Android reports now; an answer moves it, as Capacitor's does. */
    state: NotificationPermissionState;
    readonly log: string[];
  }

  function device(state: NotificationPermissionState): Device {
    return { state, log: [] };
  }

  function ports(
    on: Device,
    rider: 'allows' | 'refuses' = 'allows',
    refuseCheck = false,
  ): { keepAlive: RideKeepAlivePort; notificationPermission: RideNotificationPermissionPort } {
    return {
      keepAlive: {
        keepRideAlive: () => {
          on.log.push('keep');
          return Promise.resolve();
        },
        letRideSleep: () => {
          on.log.push('sleep');
          return Promise.resolve();
        },
      },
      notificationPermission: {
        notificationPermission: () => {
          on.log.push('check');
          return refuseCheck
            ? Promise.reject(new Error('plugin not implemented'))
            : Promise.resolve(on.state);
        },
        askForNotificationPermission: () => {
          on.log.push('ask');
          // A first refusal leaves Android reporting "prompt-with-rationale".
          on.state = rider === 'allows' ? 'granted' : 'prompt-with-rationale';
          return Promise.resolve(on.state);
        },
      },
    };
  }

  /** Let the fire-and-forget chain settle. */
  async function settled(): Promise<void> {
    for (let turn = 0; turn < 10; turn += 1) {
      await Promise.resolve();
    }
  }

  it('asks nothing on opening the app or pairing, only when a ride starts, and beside the service', async () => {
    const android = device('prompt');
    const rig = benchWith(ports(android));
    await rig.controller.pair('trainer');
    await ride(rig, 3);
    await settled();
    expect(android.log).toEqual([]);

    await rig.controller.start();
    await settled();
    expect(android.log).toEqual(['keep', 'check', 'ask', 'keep']);
    expect(rig.controller.getSnapshot().notificationNotice).toBeUndefined();

    // A pause and a resume are the same ride: nothing is asked again.
    await rig.controller.pause();
    await rig.controller.resume();
    await settled();
    expect(android.log).toEqual(['keep', 'check', 'ask', 'keep']);
    rig.controller.dispose();
  });

  it('asks nothing where the permission is granted at install (below API 33)', async () => {
    const android = device('granted');
    const rig = benchWith(ports(android));
    await rig.controller.start();
    await settled();
    expect(android.log).toEqual(['keep', 'check']);
    expect(rig.controller.getSnapshot().notificationNotice).toBeUndefined();
    rig.controller.dispose();
  });

  it('records the ride and starts the service when the rider refuses, and says so once', async () => {
    const android = device('prompt');
    const rig = benchWith(ports(android, 'refuses'));
    await rig.controller.pair('trainer');
    await rig.controller.start();
    await settled();
    expect(android.log).toEqual(['keep', 'check', 'ask']);
    expect(rig.controller.getSnapshot().notificationNotice).toBe(RIDE_NOTIFICATION_REFUSED);

    await ride(rig, 5);
    expect(rig.controller.getSnapshot().phase).toBe('recording');
    expect(rig.controller.getSnapshot().movingSeconds).toBeGreaterThan(0);

    rig.controller.armStop();
    await rig.controller.confirmStop();
    expect(rig.controller.getSnapshot().phase).toBe('stopped');
    expect(rig.controller.getSnapshot().notificationNotice).toBeUndefined();
    rig.controller.dispose();

    // The next ride, on the same phone: Android now says the rider has
    // refused, so nothing is asked and nothing is said.
    android.log.length = 0;
    const next = benchWith(ports(android, 'refuses'));
    await next.controller.start();
    await settled();
    expect(android.log).toEqual(['keep', 'check']);
    expect(next.controller.getSnapshot().notificationNotice).toBeUndefined();
    next.controller.dispose();
  });

  it('asks nothing after "don\u2019t ask again", and says nothing', async () => {
    const android = device('denied');
    const rig = benchWith(ports(android));
    await rig.controller.start();
    await settled();
    expect(android.log).toEqual(['keep', 'check']);
    expect(rig.controller.getSnapshot().notificationNotice).toBeUndefined();
    rig.controller.dispose();
  });

  it('still starts the service when the question itself fails', async () => {
    const android = device('prompt');
    const rig = benchWith(ports(android, 'allows', true));
    await rig.controller.start();
    await settled();
    expect(android.log).toEqual(['keep', 'check']);
    expect(rig.controller.getSnapshot().phase).toBe('recording');
    rig.controller.dispose();
  });

  it('does not re-start the service for a ride that stopped while the rider was answering', async () => {
    const android = device('prompt');
    let answer: ((state: NotificationPermissionState) => void) | undefined;
    const { keepAlive } = ports(android);
    const rig = benchWith({
      keepAlive,
      notificationPermission: {
        notificationPermission: () => Promise.resolve(android.state),
        askForNotificationPermission: () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      },
    });
    await rig.controller.start();
    await settled();
    // The recording is not held back by the question.
    await ride(rig, 3);
    expect(rig.controller.getSnapshot().sampleCount).toBeGreaterThan(0);
    rig.controller.armStop();
    await rig.controller.confirmStop();
    answer?.('granted');
    await settled();
    expect(android.log).toEqual(['keep', 'sleep']);
    rig.controller.dispose();
  });

  it('starts the service at once, even when the question is never answered', async () => {
    // Android delivers the answer only once the app is on screen again: a
    // dialog left up while the screen times out is a question with no answer.
    const android = device('prompt');
    const { keepAlive } = ports(android);
    const rig = benchWith({
      keepAlive,
      notificationPermission: {
        notificationPermission: () => Promise.resolve(android.state),
        askForNotificationPermission: () =>
          new Promise<NotificationPermissionState>(() => undefined),
      },
    });
    await rig.controller.start();
    await settled();
    expect(android.log).toEqual(['keep']);
    expect(rig.controller.getSnapshot().phase).toBe('recording');
    rig.controller.dispose();
  });

  it('says nothing on the stopped screen when the refusal arrives after the stop', async () => {
    const android = device('prompt');
    const answers: ((state: NotificationPermissionState) => void)[] = [];
    const { keepAlive } = ports(android);
    const rig = benchWith({
      keepAlive,
      notificationPermission: {
        notificationPermission: () => Promise.resolve(android.state),
        askForNotificationPermission: () =>
          new Promise((resolve) => {
            answers.push(resolve);
          }),
      },
    });
    await rig.controller.start();
    await settled();
    await ride(rig, 3);
    rig.controller.armStop();
    await rig.controller.confirmStop();
    answers[0]?.('prompt-with-rationale');
    await settled();
    expect(rig.controller.getSnapshot().phase).toBe('stopped');
    expect(rig.controller.getSnapshot().notificationNotice).toBeUndefined();
    rig.controller.dispose();
  });
});

// --- #548: a stopped ride is not a dead end -----------------------------------

/**
 * A save port over the REAL store, through the round-trip harness — so what
 * this block asserts is what a fresh read of IndexedDB returns, not what the
 * controller believed it wrote (CLAUDE.md §5). Each ride gets its own id, as
 * `main.tsx`'s does.
 */
function storeSavePort(): RideSavePort {
  let minted = 0;
  return {
    newActivityId: () => {
      minted += 1;
      return activityId(`ride-${String(minted)}`);
    },
    timeZone: 'Europe/London',
    store: {
      putActivity: async (record) => harness.write(async (store) => store.putActivity(record)),
      putStreamSet: async (set) => harness.write(async (store) => store.putStreamSet(set)),
      deleteActivity: async (owner, id) =>
        harness.write(async (store) => store.deleteActivity(owner, id)),
    },
  };
}

async function recordAndStop(rig: Bench, forSeconds: number): Promise<void> {
  await rig.controller.start();
  await ride(rig, forSeconds);
  rig.controller.armStop();
  await rig.controller.confirmStop();
}

describe('#548 — canStartNewRide, the one rule the screen and the controller share', () => {
  it('allows a stopped ride whose last checkpoint landed, once the save is settled safely', () => {
    const allowed = (['saved', 'empty', 'unavailable'] as const).map((saveState) =>
      canStartNewRide({ phase: 'stopped', stopping: false, storage: 'ok', saveState }),
    );
    expect(allowed).toEqual([true, true, true]);
  });

  it('refuses while the ride exists only in this tab, or is still being explained', () => {
    expect(
      canStartNewRide({ phase: 'stopped', stopping: false, storage: 'ok', saveState: 'saving' }),
    ).toBe(false);
    expect(
      canStartNewRide({ phase: 'stopped', stopping: false, storage: 'ok', saveState: 'failed' }),
    ).toBe(false);
    expect(
      canStartNewRide({ phase: 'stopped', stopping: false, storage: 'failed', saveState: 'saved' }),
    ).toBe(false);
    expect(
      canStartNewRide({
        phase: 'stopped',
        stopping: false,
        storage: 'quota-exceeded',
        saveState: 'saved',
      }),
    ).toBe(false);
  });

  it('refuses while the stop is still settling, whatever the save state says', () => {
    // #565's review: the phase is `stopped` before the release, the flush and
    // the save have run, and `saveState` can still read the previous ride's.
    const whileStopping = (['saved', 'empty', 'unavailable'] as const).map((saveState) =>
      canStartNewRide({ phase: 'stopped', stopping: true, storage: 'ok', saveState }),
    );
    expect(whileStopping).toEqual([false, false, false]);
  });

  it('refuses in every phase but stopped', () => {
    const phases = (['idle', 'recording', 'paused'] as const).map((phase) =>
      canStartNewRide({ phase, stopping: false, storage: 'ok', saveState: 'saved' }),
    );
    expect(phases).toEqual([false, false, false]);
  });
});

describe('#548 — after a ride is stopped and saved, another can be started', () => {
  it('records a second, separate activity, read back from the store', async () => {
    const rig = benchWith({ rideSave: storeSavePort() });
    await rig.controller.pair('trainer');

    await recordAndStop(rig, 3);
    expect(rig.controller.getSnapshot().saveState).toBe('saved');

    expect(await rig.controller.startNewRide()).toBe(true);
    const ready = rig.controller.getSnapshot();
    expect(ready.phase).toBe('idle');
    // A fresh clock: nothing of the first ride is on the screen any more.
    expect(ready.elapsedSeconds).toBe(0);
    expect(ready.sampleCount).toBe(0);
    expect(ready.saveState).toBe('unavailable');
    expect(ready.savedActivityId).toBeUndefined();
    // The bike is still the bike.
    expect(ready.sensors.map((sensor) => [sensor.id, sensor.state])).toEqual([
      [TRAINER, 'connected'],
    ]);

    await recordAndStop(rig, 5);
    const second = rig.controller.getSnapshot();
    expect(second.saveState).toBe('saved');
    expect(second.savedActivityId).toBe('ride-2');
    // A new recording session, not the first one reopened.
    expect(rig.sessionIds).toEqual(['ride-1', 'ride-2']);

    const read = await harness.read(async (store) =>
      store.listActivitySummaries(ATHLETE_A, { orderBy: 'startedAt', direction: 'ascending' }),
    );
    expect(read.map((summary) => summary.id)).toEqual(['ride-1', 'ride-2']);
    // Two rides, each its own length — the second did not carry the first's clock.
    expect(read.map((summary) => summary.elapsedTime)).toEqual([3, 5]);
    // And neither left a checkpoint behind.
    const remaining = await harness.read(async (store) => store.listRecordingSessions(ATHLETE_A));
    expect(remaining).toEqual([]);
    rig.controller.dispose();
  });

  it('is offered where this build cannot save, and offers the ride that stayed on the device', async () => {
    const noSave = benchWith();
    await noSave.controller.pair('trainer');
    await recordAndStop(noSave, 2);
    expect(noSave.controller.getSnapshot().saveState).toBe('unavailable');
    expect(await noSave.controller.startNewRide()).toBe(true);
    // The ride that could not be added to the activities is still on the
    // device, and is offered back now rather than after a relaunch.
    expect(noSave.controller.getSnapshot().recoverable.map((offer) => offer.id)).toEqual([
      'ride-1',
    ]);
    noSave.controller.dispose();
  });

  it('is refused while the save is still running', async () => {
    let finish: (() => void) | undefined;
    const port = storeSavePort();
    const slow: RideSavePort = {
      ...port,
      store: {
        ...port.store,
        putActivity: async (record) => {
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
          return port.store.putActivity(record);
        },
      },
    };
    const rig = benchWith({ rideSave: slow });
    await rig.controller.pair('trainer');
    await rig.controller.start();
    await ride(rig, 3);
    rig.controller.armStop();
    const stopping = rig.controller.confirmStop();
    // IndexedDB answers on a macrotask, so the stop's own writes need real
    // turns of the event loop before the save is reached.
    for (let tries = 0; tries < 100 && finish === undefined; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(rig.controller.getSnapshot().saveState).toBe('saving');

    expect(await rig.controller.startNewRide()).toBe(false);
    expect(rig.controller.getSnapshot().phase).toBe('stopped');

    finish?.();
    await stopping;
    // The ride the refusal protected is the one that landed.
    const read = await harness.read(async (store) => store.listActivitySummaries(ATHLETE_A));
    expect(read.map((summary) => summary.id)).toEqual(['ride-1']);
    rig.controller.dispose();
  });

  it('is refused while the stop itself is still finishing, before any save has begun', async () => {
    // ⚠️ The window review of this change found: `confirmStop` sets `stopped`
    // first and then releases the trainer and flushes, and all that time
    // `saveState` still says the PREVIOUS ride's `unavailable`. A press here
    // used to pass the rule and drop the recorder the stop was writing from.
    const rig = benchWith({ rideSave: storeSavePort() });
    await rig.controller.pair('trainer');
    await rig.controller.start();
    await ride(rig, 3);
    rig.controller.armStop();
    const stopping = rig.controller.confirmStop();
    expect(rig.controller.getSnapshot().phase).toBe('stopped');
    expect(rig.controller.getSnapshot().saveState).toBe('unavailable');
    // …which is why the snapshot says so, and the screen can read it.
    expect(rig.controller.getSnapshot().stopping).toBe(true);

    expect(await rig.controller.startNewRide()).toBe(false);
    await stopping;
    expect(rig.controller.getSnapshot().saveState).toBe('saved');
    expect(rig.controller.getSnapshot().stopping).toBe(false);
    const read = await harness.read(async (store) => store.listActivitySummaries(ATHLETE_A));
    expect(read.map((summary) => summary.id)).toEqual(['ride-1']);
    // And once it has settled, the press is honoured.
    expect(await rig.controller.startNewRide()).toBe(true);
    rig.controller.dispose();
  });

  it('is refused when the save failed, and the checkpoint stays for the recovery offer', async () => {
    const port = storeSavePort();
    const rig = benchWith({
      rideSave: {
        ...port,
        store: {
          ...port.store,
          putStreamSet: () => Promise.reject(new Error('the device is full')),
        },
      },
    });
    await rig.controller.pair('trainer');
    await recordAndStop(rig, 3);
    expect(rig.controller.getSnapshot().saveState).toBe('failed');

    expect(await rig.controller.startNewRide()).toBe(false);
    expect(rig.controller.getSnapshot().phase).toBe('stopped');
    expect(rig.controller.getSnapshot().saveError).toBe('the device is full');
    rig.controller.dispose();
  });

  it('is refused when the last checkpoint did not land', async () => {
    // Healthy while riding; every checkpoint write refused from the Stop on,
    // so the final flush is the one that does not land.
    let broken = false;
    const store = harnessStore();
    const unwell = (): Promise<never> => Promise.reject(new Error('the device is unwell'));
    const rig = benchWith({
      rideSave: storeSavePort(),
      checkpointStore: {
        appendRecordingChunk: async (chunk) =>
          broken ? unwell() : store.appendRecordingChunk(chunk),
        putRecordingSession: async (record) =>
          broken ? unwell() : store.putRecordingSession(record),
      },
    });
    await rig.controller.pair('trainer');
    await rig.controller.start();
    await ride(rig, 3);
    broken = true;
    rig.controller.armStop();
    await rig.controller.confirmStop();
    const stopped = rig.controller.getSnapshot();
    expect(stopped.storage).not.toBe('ok');

    expect(await rig.controller.startNewRide()).toBe(false);
    expect(rig.controller.getSnapshot().phase).toBe('stopped');
    rig.controller.dispose();
  });

  it('does not offer a leftover mid-ride when Start is pressed before the re-read settles', async () => {
    // #565's review, item 4: `startNewRide` renders the idle screen and THEN
    // re-reads what the device holds. A rider quick enough to press Start in
    // that gap must not find the offer appearing on a ride in progress.
    let hold: ((value: void) => void) | undefined;
    let held = false;
    const store = harnessStore();
    const rig = benchWith({
      checkpointStore: {
        listRecordingSessions: async (owner) => {
          if (held) {
            await new Promise<void>((resolve) => {
              hold = resolve;
            });
          }
          return store.listRecordingSessions(owner);
        },
      },
    });
    await rig.controller.pair('trainer');
    await recordAndStop(rig, 2);
    expect(rig.controller.getSnapshot().saveState).toBe('unavailable');

    held = true;
    const starting = rig.controller.startNewRide();
    await Promise.resolve();
    await rig.controller.start();
    expect(rig.controller.getSnapshot().phase).toBe('recording');
    hold?.();
    expect(await starting).toBe(true);

    expect(rig.controller.getSnapshot().phase).toBe('recording');
    expect(rig.controller.getSnapshot().recoverable).toEqual([]);
    rig.controller.dispose();
  });

  it('does nothing before a ride has stopped', async () => {
    const rig = benchWith({ rideSave: storeSavePort() });
    expect(await rig.controller.startNewRide()).toBe(false);
    await rig.controller.start();
    await ride(rig, 2);
    expect(await rig.controller.startNewRide()).toBe(false);
    expect(rig.controller.getSnapshot().phase).toBe('recording');
    expect(rig.sessionIds).toEqual(['ride-1']);
    rig.controller.dispose();
  });
});

describe('#548 — what the Trainer panel says about a manual ERG target once a ride ends', () => {
  /**
   * The decision #548 asked for: **ending a ride releases a manual ERG target**
   * through the one release (#372), exactly as a workout's end does, and the
   * screen then says the trainer MAY still be holding it — never "Holding".
   * On the trainer #372 was measured on the target survives an acknowledged
   * Stop, so `confirmed` after it would be a claim nothing supports.
   */
  it('releases it with one Stop and stops claiming the trainer is holding it', async () => {
    const rig = benchWith({
      rideSave: storeSavePort(),
      machine: { retainsTargetsThroughStop: true },
    });
    await rig.controller.pair('trainer');
    await rig.controller.requestTrainerControl();
    await rig.controller.start();
    await rig.controller.setTargetPower(watts(150));
    expect(targetSentence(rig.controller.getSnapshot().trainer)).toBe('Holding 150 W.');

    await ride(rig, 3);
    const before = rig.written.length;
    rig.controller.armStop();
    await rig.controller.confirmStop();

    expect(rig.written.slice(before)).toEqual([[STOP_OR_PAUSE, 0x01]]);
    const stopped = rig.controller.getSnapshot().trainer;
    expect(stopped.target).toEqual({ kind: 'unknown', attempted: 150 });
    expect(targetSentence(stopped)).not.toContain('Holding');
    // The machine really did keep it — which is why the sentence hedges.
    expect(rig.targetOnTheTrainer()).toBe(150);

    // A new ride keeps control and writes nothing: starting a ride is not a
    // reason to touch resistance.
    const afterStop = rig.written.length;
    expect(await rig.controller.startNewRide()).toBe(true);
    const ready = rig.controller.getSnapshot().trainer;
    expect(ready.hasControl).toBe(true);
    expect(targetSentence(ready)).not.toContain('Holding');
    expect(rig.written.length).toBe(afterStop);
    rig.controller.dispose();
  });
});
