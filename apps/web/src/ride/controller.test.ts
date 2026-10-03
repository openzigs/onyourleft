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
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  gradePercent,
  metresPerSecond,
  routeProfile,
  revolutionsPerMinute,
  seconds,
  thresholdShare,
  unixSeconds,
  watts,
  type RouteProfile,
  type Watts,
  type WorkoutBlock,
} from '@onyourleft/domain';
import {
  type DeviceId,
  deviceId,
  ForgetUnconfirmedError,
  type ForgetHold,
  isSensorError,
  type SensorTransport,
} from '@onyourleft/sensors';
import { createCapacitorTransport } from '@onyourleft/mobile';
import { scriptedPort } from '@onyourleft/mobile/testing';
import {
  createIndoorBikeDataProfile,
  createTrainerControl,
  decodeSupportedPowerRange,
  FITNESS_MACHINE_CONTROL_POINT,
  FITNESS_MACHINE_FEATURE,
  FITNESS_MACHINE_SERVICE,
  FITNESS_MACHINE_STATUS,
  INDOOR_BIKE_DATA,
  SUPPORTED_POWER_RANGE,
  HEART_RATE_MEASUREMENT,
  HEART_RATE_SERVICE,
  heartRateProfile,
  type TrainerControl,
  type TrainerControlChoice,
} from '@onyourleft/sensors/protocol';
import { createWebBluetoothTransport } from '@onyourleft/sensors/web-bluetooth';
import { createFakeBluetooth } from '@onyourleft/sensors/web-bluetooth/testing';
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
import type { NewActivity, NewStreamSet } from '@onyourleft/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_AUTO_PAUSE_AFTER_SECONDS } from '../recording/channels';
import type { RecordingCheckpointStore } from '../recording/recorder';

import {
  canStartNewRide,
  CONTROL_WAITS_FOR_FORGET,
  TARGET_WAITS_FOR_FORGET,
  createRideController,
  PAIRING_ROLE_CAPABILITIES,
  pairedAgainBeforeForgetLanded,
  RIDE_NOTIFICATION_REFUSED,
  type RideController,
  type RideSavePort,
} from './controller';
import { gameTrainerFrom } from '../game/trainer-port';
import { createGradientSession } from '../game/gradient';
import { TargetHeldBack } from './held-back';

import { METRIC_STALE_AFTER_SECONDS } from './metrics';
import { targetSentence } from './TrainerPanel';
import {
  int16,
  requestFromOctets,
  responseToOctets,
  statusToOctets,
  viewOf,
} from './simulated-trainer-testing';
import { openWebBluetoothTrainer, type OpenTrainer, type TrainerConnection } from './trainer';
import type { RiderPresence, RiderPresencePort } from './presence-port';
import type { RideKeepAlivePort } from './keep-alive-port';
import { roomPortOver } from '../net/room-port';
import { flush, ManualClock, ScriptedRoom } from '../net/testing';
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
  /** The transport the controller was handed — read back to see what it holds (#659). */
  readonly transport: SensorTransport;
  readonly trainerControl: () => TrainerControl | undefined;
  /** What the trainer itself is holding, read from the device. */
  readonly targetOnTheTrainer: () => Watts | undefined;
  /** Every control point write, as octets, in order — #372 asserts on these. */
  readonly written: number[][];
  readonly sessionIds: RecordingSessionId[];
  /**
   * Deliver the Stop answers `holdStopAnswer` held back, in order (#695's
   * review). A no-op when nothing is held.
   */
  readonly deliverHeldStopAnswer: () => void;
  /**
   * Deliver the target answers `holdTargetAnswer` held back, in order (#758).
   * A no-op when nothing is held.
   */
  readonly deliverHeldTargetAnswers: () => void;
  /**
   * Let the first `openTrainer` held by {@link BenchOptions.holdOpenTrainer}
   * answer (#713). A no-op when nothing is held.
   */
  readonly answerOpenTrainer: () => void;
  /**
   * Notify `0xFF` Control Permission Lost to every control client built so
   * far, as a machine does when another app takes it (#718's second review).
   */
  readonly permissionLost: () => void;
  /**
   * Deliver the Request Control answers `holdControlAnswer` held back — #721.
   * A no-op when nothing is held.
   */
  readonly deliverHeldControlAnswer: () => void;
}

interface BenchOptions {
  /** `two-trainers` adds a second FTMS machine, `NEO 2T`, after the KICKR (#718). */
  readonly devices?: 'trainer' | 'trainer+strap' | 'strap' | 'two-trainers';
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
  /**
   * Hold back the machine's answer to a Stop (`0x80 0x08 …`) until the test
   * calls {@link Bench.deliverHeldStopAnswer} — #695's review. The simulator
   * otherwise answers inside the write itself, so a release settles within
   * microtasks and no tick can land while the Stop is on the wire. On a real
   * trainer that answer takes time, and whatever is queued or ticked in that
   * window is exactly what a dispose has to keep off the control point.
   *
   * ⚠️ It holds back a **Pause** answer (`0x80 0x08 …` to a `0x08 0x02`) as
   * well: Stop and Pause share opcode `0x08`, and the match is on the opcode
   * alone (#704).
   */
  readonly holdStopAnswer?: boolean;
  /**
   * Hold back the machine's answer to a Set Target Power (`0x80 0x05 …`) until
   * the test calls {@link Bench.deliverHeldTargetAnswers} — #758. The window
   * in which a *Set* is in flight and a second one is queued behind it, which
   * the simulator, answering inside the write, never leaves open.
   */
  readonly holdTargetAnswer?: boolean;
  /** Refuse every `0x05` below this many watts at the ATT layer — a refused ease (#567). */
  readonly refuseTargetsBelow?: number;
  /**
   * Hold the FIRST `openTrainer`'s answer back until the test calls
   * {@link Bench.answerOpenTrainer} — #713. The control client is built at
   * once, as a real one is, and only the answer waits: that is the window in
   * which the Devices screen lists the trainer while its pairing is still
   * wiring.
   */
  readonly holdOpenTrainer?: boolean;
  /**
   * Build the control client with `reacquireControl` on, as `ride/trainer.ts`
   * does in production — #718's second review. Off by default here so the
   * older cases' write lists stay what they assert.
   */
  readonly reacquireControl?: boolean;
  /**
   * Hold back the machine's answer to a Request Control (`0x80 0x00 …`) until
   * the test calls {@link Bench.deliverHeldControlAnswer} — #721. The window in
   * which a grant is on the wire when a forget begins.
   */
  readonly holdControlAnswer?: boolean;
  /** Refuse the FIRST `0x00` Request Control at the ATT layer — #721. */
  readonly refuseRequestControlOnce?: boolean;
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
      ...(which === 'two-trainers' ? [ftmsTrainer({ id: 'neo', name: 'NEO 2T' })] : []),
    ],
  });

  let control: TrainerControl | undefined;
  const sessionIds: RecordingSessionId[] = [];
  const written: number[][] = [];

  const statusListeners: Array<(value: DataView) => void> = [];
  const heldStopAnswers: Array<() => void> = [];
  const heldTargetAnswers: Array<() => void> = [];
  const heldControlAnswers: Array<() => void> = [];
  let requestControlRefused = false;

  let heldOpenTrainer: (() => void) | undefined;
  let openTrainerHeld = options.holdOpenTrainer === true;
  const openTrainer: OpenTrainer = (id, opened) => {
    const answer = openTrainerNow(id, opened);
    if (!openTrainerHeld) {
      return answer;
    }
    openTrainerHeld = false;
    return new Promise((resolve, reject) => {
      heldOpenTrainer = () => {
        answer.then(resolve, reject);
      };
    });
  };

  const openTrainerNow: OpenTrainer = (id, opened = {}) => {
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
            controlPoint.onResponse((response) => {
              const octets = responseToOctets(response);
              if (options.holdStopAnswer === true && octets.getUint8(1) === STOP_OR_PAUSE) {
                heldStopAnswers.push(() => {
                  listener(octets);
                });
                return;
              }
              if (options.holdTargetAnswer === true && octets.getUint8(1) === 0x05) {
                heldTargetAnswers.push(() => {
                  listener(octets);
                });
                return;
              }
              if (options.holdControlAnswer === true && octets.getUint8(1) === 0x00) {
                heldControlAnswers.push(() => {
                  listener(octets);
                });
                return;
              }
              listener(octets);
            }),
          onStatus: (listener) => {
            statusListeners.push(listener);
            return controlPoint.onStatus((status) => listener(statusToOctets(status)));
          },
          writeControlPoint: (value) => {
            written.push([...value]);
            if (options.refuseStop === true && value[0] === STOP_OR_PAUSE) {
              return Promise.reject(new Error('write not permitted'));
            }
            if (
              options.refuseRequestControlOnce === true &&
              value[0] === 0x00 &&
              !requestControlRefused
            ) {
              requestControlRefused = true;
              return Promise.reject(new Error('control not permitted'));
            }
            if (
              options.refuseTargetsBelow !== undefined &&
              value[0] === 0x05 &&
              (value[1] ?? 0) + ((value[2] ?? 0) << 8) < options.refuseTargetsBelow
            ) {
              return Promise.reject(new Error('ease not permitted'));
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
        {
          powerRange,
          // #721: the controller's answer is honoured, as `ride/trainer.ts`
          // honours it in production.
          reacquireControl:
            (options.permissionLostBeforeStopAnswer === true ||
              options.reacquireControl === true) &&
            (opened.mayReacquireControl ?? (() => true)),
        },
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
    transport,
    controller,
    bench,
    sessionIds,
    trainerControl: () => control,
    targetOnTheTrainer: () => bench.device(TRAINER).inspect().ftms?.targetPower,
    written,
    deliverHeldStopAnswer: () => {
      for (const deliver of heldStopAnswers.splice(0)) {
        deliver();
      }
    },
    deliverHeldTargetAnswers: () => {
      for (const deliver of heldTargetAnswers.splice(0)) {
        deliver();
      }
    },
    answerOpenTrainer: () => {
      const answer = heldOpenTrainer;
      heldOpenTrainer = undefined;
      answer?.();
    },
    permissionLost: () => {
      for (const listener of [...statusListeners]) {
        listener(viewOf([0xff]));
      }
    },
    deliverHeldControlAnswer: () => {
      for (const deliver of heldControlAnswers.splice(0)) {
        deliver();
      }
    },
  };
}

/** A kilometre rising at a steady 4 %, for a gradient session to ride. */
function risingRoad(): RouteProfile {
  return routeProfile(
    Array.from({ length: 101 }, (_, index) => ({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(index * 0.4),
    })),
  );
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

  it('forgets the device on the transport, so the chooser brings it back (#659)', async () => {
    const rig = benchWith({ devices: 'trainer+strap' });
    await rig.controller.pair('trainer');
    await rig.controller.pair('heart-rate');
    await ride(rig, 3);

    await rig.controller.unpair(STRAP);

    // Read back through the transport, which is what a consumer asks: the id
    // is not issued any more, where a bare disconnect left it held.
    let refused: unknown;
    try {
      rig.transport.connectionState(STRAP);
    } catch (error) {
      refused = error;
    }
    expect(isSensorError(refused, 'device-not-found')).toBe(true);

    // And the way back is the ordinary one, with no "already paired".
    await rig.controller.pair('heart-rate');
    await ride(rig, 3);
    expect(rig.controller.getSnapshot().pairingError).toBeUndefined();
    expect(rig.controller.getSnapshot().sensors.map((sensor) => sensor.id)).toContain(STRAP);
    expect(metric(rig, 'heartRate').kind).toBe('live');
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

  it('says why the target is eased on the snapshot, on every tick of the rescue — #585', async () => {
    // ⚠️ The Ride screen reads `workout.rescue` and nothing else; the player's
    // intent is `hold` on every tick after the first eased write, so a snapshot
    // built from the intent would say it once and then forget it.
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
    expect(rig.controller.getSnapshot().workout?.rescue).toBeUndefined();

    // The rider stops pedalling: the floor, and the stall's own sentence.
    for (const rpm of [80, 60, 40, 20, 8, 5, 4]) {
      rig.bench.rider.set({ cadence: revolutionsPerMinute(rpm) });
      await ride(rig, 1);
      await flushMicrotasks();
    }
    const stalled = rig.controller.getSnapshot().workout?.rescue;
    expect(stalled).toMatchObject({ kind: 'floor' });
    expect(stalled?.reason).toContain('Pedalling has stopped');
    // …still there a few ticks later, with nothing new written.
    await ride(rig, 2);
    await flushMicrotasks();
    expect(rig.controller.getSnapshot().workout?.rescue).toMatchObject({ kind: 'floor' });

    // Back on the pedals and steady for well over a trend window: cleared.
    for (let second = 0; second < 25; second += 1) {
      rig.bench.rider.set({ cadence: revolutionsPerMinute(88) });
      await ride(rig, 1);
      await flushMicrotasks();
    }
    expect(rig.targetOnTheTrainer()).toBe(250);
    expect(rig.controller.getSnapshot().workout?.rescue).toBeUndefined();
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
// FTMS Set Indoor Bike Simulation Parameters.
const SET_SIMULATION = 0x11;

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

describe('forgetting the trainer lets it go first — #659’s review', () => {
  // ⚠️ `detach` unsubscribes `onControlLost` and then closes the client, and
  // `close()` writes nothing. Forget used to detach first, so a workout kept
  // its clock running against a machine still holding its last ERG target,
  // with no Stop on the wire — and on Web Bluetooth the forget then revoked
  // the grant the app would need to reach the machine again.
  const THRESHOLD = watts(250);
  const twoIntervals = (): WorkoutRecord => ({
    id: workoutId('w-forget'),
    createdBy: ATHLETE_A,
    name: 'Two',
    workout: {
      name: 'Two',
      blocks: [
        { kind: 'steady', seconds: seconds(60), target: thresholdShare(0.8) },
        { kind: 'steady', seconds: seconds(60), target: thresholdShare(0.9) },
      ],
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

  it('ends a running workout and sends the one Stop before the trainer is forgotten', async () => {
    const rig = await riding();
    rig.controller.startWorkout(twoIntervals(), THRESHOLD);
    await ride(rig, 5);
    await flushMicrotasks();
    expect(rig.controller.getSnapshot().workout?.status).toBe('running');
    const before = rig.written.length;

    await rig.controller.unpair(TRAINER);
    await ride(rig, 5);
    await flushMicrotasks(20);

    const snapshot = rig.controller.getSnapshot();
    expect(rig.written.slice(before)).toStrictEqual([[STOP_OR_PAUSE, 0x01]]);
    expect(snapshot.workout).toBeUndefined();
    expect(snapshot.trainer.paired).toBe(false);
    expect(snapshot.trainer.lost).toBeUndefined();
    expect(snapshot.trainer.releaseFault).toBeUndefined();
    expect(snapshot.pairingError).toBeUndefined();
    // The ride is the rider's, and carries on.
    expect(snapshot.phase).toBe('recording');
    rig.controller.dispose();
  });

  it('releases a hand-set ERG target with a Stop before the trainer is forgotten', async () => {
    const rig = await riding();
    await rig.controller.setTargetPower(watts(210));
    expect(rig.targetOnTheTrainer()).toBe(210);
    const before = rig.written.length;

    await rig.controller.unpair(TRAINER);
    await ride(rig, 3);
    await flushMicrotasks(20);

    expect(rig.written.slice(before)).toStrictEqual([[STOP_OR_PAUSE, 0x01]]);
    expect(rig.controller.getSnapshot().trainer.paired).toBe(false);
    expect(rig.controller.getSnapshot().pairingError).toBeUndefined();
    rig.controller.dispose();
  });

  it('releases a game ride’s gradient, and refuses the game’s next write', async () => {
    const rig = await riding();
    const handle = rig.controller.simulationControl();
    await handle?.setSimulationParameters({ grade: gradePercent(6) });
    const before = rig.written.length;

    const forgetting = rig.controller.unpair(TRAINER);
    // A gradient offered while the release is on the wire must not follow the
    // Stop onto the machine.
    const late = handle?.setSimulationParameters({ grade: gradePercent(8) });
    await forgetting;
    await expect(late).rejects.toThrow('the trainer is being forgotten');
    // #728: the app held it back, and says so by class and by kind.
    await expect(late).rejects.toBeInstanceOf(TargetHeldBack);
    await expect(late).rejects.toHaveProperty('hold', 'letting-go-to-forget');
    await flushMicrotasks(20);

    expect(rig.written.slice(before)).toStrictEqual([[STOP_OR_PAUSE, 0x01]]);
    expect(rig.controller.getSnapshot().trainer.paired).toBe(false);
    rig.controller.dispose();
  });

  it('tells a game ride the app asked the trainer to let go, not that it refused the gradient (#728)', async () => {
    const rig = await riding();
    const handle = rig.controller.simulationControl();
    if (handle === undefined) {
      throw new Error('no simulation control');
    }
    await handle.setSimulationParameters({ grade: gradePercent(6) });
    const before = rig.written.length;
    // The game's own loop, over the real handle, sampling while the release
    // that precedes the forget is on the wire.
    const session = createGradientSession({ profile: risingRoad(), control: handle });

    const forgetting = rig.controller.unpair(TRAINER);
    session.sample(seconds(0), 500);
    await forgetting;
    await session.settled();

    expect(session.state().fault).toBe(
      'That gradient was held back: this app asked the trainer to let go so it can be forgotten.',
    );
    // Nothing but the release reached the machine.
    expect(rig.written.slice(before)).toStrictEqual([[STOP_OR_PAUSE, 0x01]]);
    rig.controller.dispose();
  });

  it('says nothing a refused Stop would make false, to a game ride sampling while the trainer is forgotten (#729)', async () => {
    // #729's review: the fault outlives the hold. It is set while the Stop is
    // on the wire and stays until the next sample, and here the Stop is refused
    // — the machine may still be holding resistance, and the forget is
    // abandoned. "The trainer is being let go" would be false by then.
    const rig = await riding({ refuseStop: true });
    const handle = rig.controller.simulationControl();
    if (handle === undefined) {
      throw new Error('no simulation control');
    }
    await handle.setSimulationParameters({ grade: gradePercent(6) });
    const before = rig.written.length;
    const session = createGradientSession({ profile: risingRoad(), control: handle });

    const forgetting = rig.controller.unpair(TRAINER);
    session.sample(seconds(0), 500);
    await forgetting;
    await session.settled();
    await flushMicrotasks(20);

    // The Stop was refused and the trainer kept: the state the sentence must survive.
    expect(rig.controller.getSnapshot().trainer.paired).toBe(true);
    const fault = session.state().fault;
    expect(fault).toBe(
      'That gradient was held back: this app asked the trainer to let go so it can be forgotten.',
    );
    expect(fault).not.toMatch(/has let|is being let go|let the trainer go|released/);
    // Only the refused release reached the machine: no gradient followed it.
    expect(rig.written.slice(before)).toStrictEqual([[STOP_OR_PAUSE, 0x01]]);

    // #732: and the hold lifts with the abandoned forget. The trainer is still
    // this app's, so the next sample reaches it and the fault clears.
    session.sample(seconds(1), 600);
    await session.settled();
    await flushMicrotasks(20);
    expect(session.state().fault).toBeUndefined();
    const after = rig.written.slice(before + 1);
    expect(after).toHaveLength(1);
    expect(after[0]?.[0]).toBe(SET_SIMULATION);
    rig.controller.dispose();
  });

  it('refuses a game handle whose trainer has been forgotten with a typed hold, and says so (#732)', async () => {
    // Unreachable today — `GameView` stops its gradient session before Forget
    // can be pressed — but a handle outlives its pairing, and the closed
    // client's own error was told as "The trainer refused that gradient. The
    // next one will be sent again.": both halves false.
    const rig = await riding();
    const handle = rig.controller.simulationControl();
    if (handle === undefined) {
      throw new Error('no simulation control');
    }
    await handle.setSimulationParameters({ grade: gradePercent(6) });
    await rig.controller.unpair(TRAINER);
    await flushMicrotasks(20);
    expect(rig.controller.getSnapshot().trainer.paired).toBe(false);
    const before = rig.written.length;

    const late = handle.setSimulationParameters({ grade: gradePercent(8) });
    await expect(late).rejects.toBeInstanceOf(TargetHeldBack);
    await expect(late).rejects.toHaveProperty('hold', 'disconnected');

    const session = createGradientSession({ profile: risingRoad(), control: handle });
    session.sample(seconds(0), 500);
    await session.settled();
    expect(session.state().fault).toBe(
      'The hills are no longer being sent: this trainer is not connected to this app any more.',
    );
    expect(rig.written.slice(before)).toStrictEqual([]);
    rig.controller.dispose();
  });

  it('keeps the trainer, and says why, when its Stop does not land', async () => {
    const rig = await riding({ refuseStop: true });
    await rig.controller.setTargetPower(watts(210));

    await rig.controller.unpair(TRAINER);
    await flushMicrotasks(20);

    const snapshot = rig.controller.getSnapshot();
    expect(snapshot.trainer.paired).toBe(true);
    expect(snapshot.sensors.map((sensor) => sensor.id)).toContain(TRAINER);
    expect(snapshot.pairingError).toBe(
      'KICKR 1F2A was not forgotten: it did not confirm that it let go, so it may still be holding resistance. Try Forget again.',
    );
    rig.controller.dispose();
  });

  it('writes nothing when this app never held the trainer', async () => {
    const rig = benchWith();
    await rig.controller.pair('trainer');
    const before = rig.written.length;

    await rig.controller.unpair(TRAINER);

    expect(rig.written.slice(before)).toStrictEqual([]);
    expect(rig.controller.getSnapshot().trainer.paired).toBe(false);
    // #695: and no "may still be holding resistance" about a machine this app
    // never drove — a release attempted without control is refused as one.
    expect(rig.controller.getSnapshot().trainer.releaseFault).toBeUndefined();
    rig.controller.dispose();
  });
});

describe('disposing the controller lets a held trainer go first — #695', () => {
  // ⚠️ `dispose` used to `detach` every sensor and nothing else, and `detach`
  // unsubscribes `onControlLost` and then closes the client, which writes
  // nothing. So a controller disposed with ERG, a workout or a gradient on the
  // machine sent no Stop at all — the one release (#372) was bypassed. Nothing
  // in production calls `dispose()` yet; this is what it must do before
  // something does (a `pagehide`, say).
  const THRESHOLD = watts(250);
  const long = (): WorkoutRecord => ({
    id: workoutId('w-dispose'),
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

  const stops = (writes: readonly number[][]): number =>
    writes.filter((bytes) => bytes[0] === STOP_OR_PAUSE).length;

  /** The client is closed once `detach` has run: any procedure is refused as not connected. */
  async function closed(rig: Bench): Promise<boolean> {
    const client = rig.trainerControl();
    if (client === undefined) {
      return false;
    }
    try {
      await client.requestControl();
      return false;
    } catch (error) {
      return isSensorError(error, 'not-connected');
    }
  }

  it('sends exactly one Stop for a hand-set ERG target, then closes the client', async () => {
    const rig = await riding();
    await rig.controller.setTargetPower(watts(210));
    expect(rig.targetOnTheTrainer()).toBe(210);
    const before = rig.written.length;

    rig.controller.dispose();
    await flushMicrotasks(20);

    // Exactly the one release, and no Request Control after it (rule 2).
    expect(rig.written.slice(before)).toStrictEqual([[STOP_OR_PAUSE, 0x01]]);
    expect(rig.written.at(-1)).toStrictEqual([STOP_OR_PAUSE, 0x01]);
    expect(await closed(rig)).toBe(true);
    // Idempotent: a second dispose sends nothing.
    rig.controller.dispose();
    await flushMicrotasks(20);
    expect(stops(rig.written.slice(before))).toBe(1);
  });

  it('ends a running workout with the one Stop, and writes no ERG target after it', async () => {
    // The Stop's answer is held back (#695's review), so the five ticks below
    // land while it is still on the wire — which is when a workout left
    // running would queue its next target behind it.
    const rig = await riding({ holdStopAnswer: true });
    rig.controller.startWorkout(long(), THRESHOLD);
    await ride(rig, 3);
    await flushMicrotasks();
    expect(rig.targetOnTheTrainer()).toBe(200);
    const before = rig.written.length;

    rig.controller.dispose();
    await flushMicrotasks(20);
    await ride(rig, 5);
    await flushMicrotasks(20);
    rig.deliverHeldStopAnswer();
    await flushMicrotasks(20);

    expect(rig.written.slice(before)).toStrictEqual([[STOP_OR_PAUSE, 0x01]]);
    const snapshot = rig.controller.getSnapshot();
    expect(snapshot.workout).toBeUndefined();
    // A release is not a loss: no "Control lost".
    expect(snapshot.trainer.lost).toBeUndefined();
  });

  it('is not a loss and re-grabs nothing when 0xFF beats the Stop’s answer', async () => {
    // PR #442's ordering, with `reacquireControl` on as production has it. The
    // control-loss listener is still subscribed while the Stop is on the wire —
    // `detach` waits for it — so a release that did not mark itself as one
    // would read the 0xFF as a loss and write a Request Control after it.
    // The answer itself is held too (#695's review), so the ticks below land
    // between the 0xFF and the answer — the window a re-grab would use.
    const rig = await riding({ permissionLostBeforeStopAnswer: true, holdStopAnswer: true });
    rig.controller.startWorkout(long(), THRESHOLD);
    await ride(rig, 2);
    await flushMicrotasks();
    const before = rig.written.length;

    rig.controller.dispose();
    await flushMicrotasks(20);
    await ride(rig, 3);
    await flushMicrotasks(20);
    rig.deliverHeldStopAnswer();
    await flushMicrotasks(20);

    expect(rig.written.slice(before)).toStrictEqual([[STOP_OR_PAUSE, 0x01]]);
    expect(rig.controller.getSnapshot().trainer.lost).toBeUndefined();
    expect(rig.controller.getSnapshot().workout).toBeUndefined();
  });

  it('ends a hand-set target’s stall rescue, so no 0x05 follows the Stop', async () => {
    // ⚠️ The Stop's answer is HELD (#695's review). Without it the simulator
    // answers inside the write, the release settles within microtasks, and
    // `detach`'s own `endManualErg` has ended the rescue before the first
    // tick below — so this test stayed green with `releaseTrainer`'s
    // `endManualErg` deleted. Held, the rescue is ticked while the Stop is
    // really outstanding, and a 0x05 it queued would run BEFORE the settled
    // release reached `close()`: `[[0x08, 0x01], [0x05, 25, 0]]`.
    const rig = benchWith({
      machine: { retainsTargetsThroughStop: true, minTargetPower: watts(25) },
      holdStopAnswer: true,
    });
    await rig.controller.pair('trainer');
    await rig.controller.requestTrainerControl();
    rig.bench.rider.set({ cadence: revolutionsPerMinute(85) });
    await rig.controller.setTargetPower(watts(150));
    await ride(rig, 3);
    await flushMicrotasks();
    // Collapse into a rescue, then dispose in the middle of it.
    for (const rpm of [68, 66, 62, 57, 52]) {
      rig.bench.rider.set({ cadence: revolutionsPerMinute(rpm) });
      await ride(rig, 1);
      await flushMicrotasks(20);
    }
    expect(rig.controller.getSnapshot().trainer.ergRescue).toBeDefined();
    const before = rig.written.length;

    // ⚠️ The readings the rescue is about to judge have ARRIVED before the
    // dispose, and are judged on the ticks after it. Since #695's review the
    // subscriptions end at once, so readings arriving after the dispose would
    // reach no rescue at all and could not tell whether `releaseTrainer` ended
    // it: the collapse has to be in the history already.
    for (const rpm of [47, 40, 30, 20, 10, 5]) {
      rig.bench.rider.set({ cadence: revolutionsPerMinute(rpm) });
      rig.bench.advance(seconds(1));
    }
    rig.controller.dispose();
    for (let tick = 0; tick < 10; tick += 1) {
      await ride(rig, 1);
      await flushMicrotasks(20);
    }
    rig.deliverHeldStopAnswer();
    await flushMicrotasks(20);

    expect(rig.written.slice(before)).toStrictEqual([[STOP_OR_PAUSE, 0x01]]);
  });

  it('lets no command reach the machine while its Stop is on the wire', async () => {
    // #695's review. A procedure queued behind the Stop runs BEFORE the
    // settled release reaches `detach` and `close()`, so detaching late keeps
    // nothing off the wire. Emptying the sensor map is what does: with it
    // gone, `setTargetPower` wrote `[[0x08, 0x01], [0x05, 250, 0]]` here.
    const rig = await riding({ holdStopAnswer: true });
    await rig.controller.setTargetPower(watts(210));
    const before = rig.written.length;

    rig.controller.dispose();
    await flushMicrotasks(20);
    const target = rig.controller.setTargetPower(THRESHOLD);
    // Rule 2: nothing asks for control after a release.
    const regrab = rig.controller.requestTrainerControl();
    const started = rig.controller.startWorkout(long(), THRESHOLD);
    await flushMicrotasks(20);
    await ride(rig, 3);
    rig.deliverHeldStopAnswer();
    await Promise.all([target, regrab]);
    await flushMicrotasks(20);

    expect(started).toBe(false);
    expect(rig.written.slice(before)).toStrictEqual([[STOP_OR_PAUSE, 0x01]]);
    expect(await closed(rig)).toBe(true);
  });

  it('stops listening to the readings at once, before the Stop is answered', async () => {
    // #695's review: the subscriptions used to outlive `dispose` until the
    // release settled — up to a procedure timeout per queued write — and each
    // reading still fed the recorder, moved the phase and announced a change
    // on a controller nobody owns any more.
    const rig = benchWith({ machine: { retainsTargetsThroughStop: true }, holdStopAnswer: true });
    const live = new Set<string>();
    const subscribe = rig.transport.subscribe.bind(rig.transport);
    vi.spyOn(rig.transport, 'subscribe').mockImplementation(async (id, capability, listener) => {
      const unsubscribe = await subscribe(id, capability, listener);
      const key = `${id}:${capability}`;
      live.add(key);
      return () => {
        live.delete(key);
        unsubscribe();
      };
    });
    await rig.controller.pair('trainer');
    await rig.controller.requestTrainerControl();
    await rig.controller.start();
    await rig.controller.setTargetPower(watts(210));
    expect(live.size).toBeGreaterThan(0);

    rig.controller.dispose();
    await flushMicrotasks(20);

    // The Stop is written and its answer is still held, so the release has
    // not settled and nothing has been detached — and yet nothing is
    // listening to a reading.
    expect(stops(rig.written)).toBe(1);
    expect([...live]).toStrictEqual([]);

    rig.deliverHeldStopAnswer();
    await flushMicrotasks(20);
    expect(await closed(rig)).toBe(true);
  });

  it('detaches every sensor even when one of them throws on the way out', async () => {
    // #695's review: the detach used to run in one `.then` with no catch, so
    // one throwing unsubscribe left every entry after it attached — here the
    // trainer, whose client then never closes — and surfaced as an unhandled
    // rejection, which Vitest fails the run on.
    const rig = benchWith({
      devices: 'trainer+strap',
      machine: { retainsTargetsThroughStop: true },
    });
    const observe = rig.transport.observeConnectionState.bind(rig.transport);
    vi.spyOn(rig.transport, 'observeConnectionState').mockImplementation((id, listener) => {
      const unobserve = observe(id, listener);
      if (id !== STRAP) {
        return unobserve;
      }
      return () => {
        unobserve();
        throw new Error('the transport would not let go');
      };
    });
    // The strap first, so it is detached before the trainer.
    await rig.controller.pair('heart-rate');
    await rig.controller.pair('trainer');
    await rig.controller.requestTrainerControl();
    await rig.controller.setTargetPower(watts(200));
    const before = rig.written.length;

    expect(() => {
      rig.controller.dispose();
    }).not.toThrow();
    await flushMicrotasks(20);

    expect(rig.written.slice(before)).toStrictEqual([[STOP_OR_PAUSE, 0x01]]);
    expect(await closed(rig)).toBe(true);
  });

  /**
   * A bench whose trainer and strap are both paired, with every measurement
   * and connection-state subscription tracked, and the FIRST measurement
   * unsubscribe of `thrower` throwing (#704).
   */
  async function throwingUnsubscribe(thrower: typeof TRAINER): Promise<{
    readonly rig: Bench;
    readonly live: Set<string>;
  }> {
    const rig = benchWith({
      devices: 'trainer+strap',
      machine: { retainsTargetsThroughStop: true },
    });
    const live = new Set<string>();
    let thrown = false;
    const subscribe = rig.transport.subscribe.bind(rig.transport);
    vi.spyOn(rig.transport, 'subscribe').mockImplementation(async (id, capability, listener) => {
      const unsubscribe = await subscribe(id, capability, listener);
      const key = `${id}:${capability}`;
      live.add(key);
      return () => {
        live.delete(key);
        unsubscribe();
        if (id === thrower && !thrown) {
          thrown = true;
          throw new Error('the transport would not let go');
        }
      };
    });
    const observe = rig.transport.observeConnectionState.bind(rig.transport);
    vi.spyOn(rig.transport, 'observeConnectionState').mockImplementation((id, listener) => {
      const unobserve = observe(id, listener);
      const key = `${id}:connection`;
      live.add(key);
      return () => {
        live.delete(key);
        unobserve();
      };
    });
    // The strap first, so it is the first entry `dispose` walks.
    await rig.controller.pair('heart-rate');
    await rig.controller.pair('trainer');
    await rig.controller.requestTrainerControl();
    await rig.controller.setTargetPower(watts(200));
    expect([...live].some((key) => key.startsWith(`${STRAP}:`))).toBe(true);
    expect([...live].filter((key) => key.startsWith(`${TRAINER}:`)).length).toBeGreaterThan(2);
    return { rig, live };
  }

  it('detaches and closes every sensor when the FIRST sensor’s measurement unsubscribe throws — #704', async () => {
    // #704: the loop that drops the readings at once had no catch, so this
    // throw left `dispose` before the detach chain was attached — the Stop
    // was on the wire, and no sensor was ever detached or closed.
    const { rig, live } = await throwingUnsubscribe(STRAP);
    const before = rig.written.length;

    // Swallowed, like a throw in the detach chain: nobody is left to tell.
    expect(() => {
      rig.controller.dispose();
    }).not.toThrow();
    await flushMicrotasks(20);

    expect(rig.written.slice(before)).toStrictEqual([[STOP_OR_PAUSE, 0x01]]);
    expect([...live]).toStrictEqual([]);
    expect(await closed(rig)).toBe(true);
  });

  it('drops every one of a sensor’s subscriptions when its first unsubscribe throws — #704', async () => {
    // A catch per SENSOR is not enough on its own: `splice(0)` had already
    // taken the rest of that sensor's unsubscribes out of the entry, so a
    // throw on the first left the others listening for ever — and the
    // detach, finding the list empty, could not reach them either.
    const { rig, live } = await throwingUnsubscribe(TRAINER);
    const before = rig.written.length;

    expect(() => {
      rig.controller.dispose();
    }).not.toThrow();
    await flushMicrotasks(20);

    expect(rig.written.slice(before)).toStrictEqual([[STOP_OR_PAUSE, 0x01]]);
    expect([...live]).toStrictEqual([]);
    expect(await closed(rig)).toBe(true);
  });

  it('closes the trainer’s client even when the trainer’s own connection observer throws — #704', async () => {
    // The test above throws on the STRAP, whose entry has no client. On the
    // trainer, `detach` threw before it reached `close()`, so the one client
    // that matters was never closed.
    const rig = benchWith({ machine: { retainsTargetsThroughStop: true } });
    const observe = rig.transport.observeConnectionState.bind(rig.transport);
    vi.spyOn(rig.transport, 'observeConnectionState').mockImplementation((id, listener) => {
      const unobserve = observe(id, listener);
      return () => {
        unobserve();
        throw new Error('the transport would not let go');
      };
    });
    await rig.controller.pair('trainer');
    await rig.controller.requestTrainerControl();
    await rig.controller.setTargetPower(watts(200));
    const before = rig.written.length;

    rig.controller.dispose();
    await flushMicrotasks(20);

    expect(rig.written.slice(before)).toStrictEqual([[STOP_OR_PAUSE, 0x01]]);
    expect(await closed(rig)).toBe(true);
  });

  it('releases a game ride’s gradient through the same Stop, and refuses its next write', async () => {
    const rig = await riding();
    const handle = rig.controller.simulationControl();
    await handle?.setSimulationParameters({ grade: gradePercent(6) });
    const before = rig.written.length;

    rig.controller.dispose();
    const late = handle?.setSimulationParameters({ grade: gradePercent(8) });
    // During the release as well as after it, and with the dispose's own
    // reason: nothing is being forgotten here (#695's review).
    await expect(late).rejects.toThrow('the ride controller was disposed and writes nothing again');
    // #728: the app held it back, and says so by class and by kind.
    await expect(late).rejects.toBeInstanceOf(TargetHeldBack);
    await expect(late).rejects.toHaveProperty('hold', 'let-go');
    await flushMicrotasks(20);
    // And once the release has settled, refused by the controller rather than
    // left to whatever the closed client happens to say.
    await expect(handle?.setSimulationParameters({ grade: gradePercent(9) })).rejects.toThrow(
      'the ride controller was disposed and writes nothing again',
    );
    // The game's own release, arriving as its view unmounts, sends nothing
    // more: the client is closed by then.
    await handle?.letGo().catch(() => undefined);
    await flushMicrotasks(20);

    expect(rig.written.slice(before)).toStrictEqual([[STOP_OR_PAUSE, 0x01]]);
  });

  it('tells a game ride the app has stopped driving the trainer, not that it refused the gradient (#728)', async () => {
    const rig = await riding();
    const handle = rig.controller.simulationControl();
    if (handle === undefined) {
      throw new Error('no simulation control');
    }
    await handle.setSimulationParameters({ grade: gradePercent(6) });
    const before = rig.written.length;
    const session = createGradientSession({ profile: risingRoad(), control: handle });

    rig.controller.dispose();
    session.sample(seconds(0), 500);
    await session.settled();
    await flushMicrotasks(20);

    expect(session.state().fault).toBe(
      'The hills are no longer being sent: this app has stopped driving the trainer.',
    );
    expect(rig.written.slice(before)).toStrictEqual([[STOP_OR_PAUSE, 0x01]]);
  });

  it('does not tell a game ride the trainer was let go when the dispose’s Stop is refused (#729)', async () => {
    // #729's review, probed: `riding({ refuseStop: true })` → `dispose()` →
    // one sample. The machine did not confirm the Stop and may still be
    // holding resistance, so the rider must not read that it was let go.
    const rig = await riding({ refuseStop: true });
    const handle = rig.controller.simulationControl();
    if (handle === undefined) {
      throw new Error('no simulation control');
    }
    await handle.setSimulationParameters({ grade: gradePercent(6) });
    const before = rig.written.length;
    const session = createGradientSession({ profile: risingRoad(), control: handle });

    rig.controller.dispose();
    await flushMicrotasks(20);
    // After the refusal has settled, not only while the Stop is in flight.
    session.sample(seconds(0), 500);
    await session.settled();
    await flushMicrotasks(20);

    const fault = session.state().fault;
    expect(fault).toBe(
      'The hills are no longer being sent: this app has stopped driving the trainer.',
    );
    expect(fault).not.toMatch(/has let|let the trainer go|released/);
    // The refused Stop and nothing else: no gradient reached the machine.
    expect(rig.written.slice(before)).toStrictEqual([[STOP_OR_PAUSE, 0x01]]);
  });

  it('joins a release already on the wire — Stop pressed, then disposed — and sends one Stop', async () => {
    const rig = await riding();
    rig.controller.startWorkout(long(), THRESHOLD);
    await ride(rig, 2);
    await flushMicrotasks();
    const before = rig.written.length;

    rig.controller.armStop();
    const stopping = rig.controller.confirmStop();
    rig.controller.dispose();
    await stopping;
    await flushMicrotasks(20);

    expect(rig.written.slice(before)).toStrictEqual([[STOP_OR_PAUSE, 0x01]]);
    expect(await closed(rig)).toBe(true);
  });

  it('does not throw when the Stop is refused, and still detaches', async () => {
    const rig = await riding({ refuseStop: true });
    await rig.controller.setTargetPower(watts(200));
    const before = rig.written.length;

    expect(() => {
      rig.controller.dispose();
    }).not.toThrow();
    await flushMicrotasks(20);

    expect(rig.written.slice(before)).toStrictEqual([[STOP_OR_PAUSE, 0x01]]);
    expect(await closed(rig)).toBe(true);
  });

  it('swallows a release that rejects outright, and still detaches', async () => {
    // A `letGo` that REJECTS rather than reporting `incomplete` — a
    // `control-not-held` from the machine, or a programming error. Vitest
    // fails the run on an unhandled rejection, so a missing catch is red here.
    const rig = await riding();
    await rig.controller.setTargetPower(watts(200));
    const client = rig.trainerControl();
    expect(client).toBeDefined();
    const letGo = vi
      .spyOn(client as TrainerControl, 'letGo')
      .mockRejectedValue(new Error('the machine said no'));

    expect(() => {
      rig.controller.dispose();
    }).not.toThrow();
    await flushMicrotasks(20);

    expect(letGo).toHaveBeenCalledTimes(1);
    expect(await closed(rig)).toBe(true);
  });

  it('writes nothing when this app does not hold the trainer', async () => {
    const rig = benchWith();
    await rig.controller.pair('trainer');
    const before = rig.written.length;

    rig.controller.dispose();
    await flushMicrotasks(20);

    expect(rig.written.slice(before)).toStrictEqual([]);
    expect(await closed(rig)).toBe(true);
  });
});

describe('a pairing that fails part-way — #659’s review', () => {
  it('lets the transport forget the device, so it holds no record of it', async () => {
    const { transport } = createSimulator({
      devices: [hrsStrap({ id: 'strap', name: 'HRM 04B1' })],
    });
    let refuseConnect = true;
    const flaky: SensorTransport = {
      ...transport,
      connect: (id) =>
        refuseConnect
          ? Promise.reject(new Error('the link would not come up'))
          : transport.connect(id),
    };
    const controller = createRideController({
      transport: flaky,
      store: harnessStore(),
      athleteId: ATHLETE_A,
      newSessionId: () => recordingSessionId('attach-failed'),
      now: () => unixSeconds(1),
    });

    await controller.pair('heart-rate');

    expect(controller.getSnapshot().pairingError).toBe('the link would not come up');
    let refused: unknown;
    try {
      transport.connectionState(STRAP);
    } catch (error) {
      refused = error;
    }
    expect(isSensorError(refused, 'device-not-found')).toBe(true);
    // And the chooser brings it back.
    refuseConnect = false;
    await controller.pair('heart-rate');
    expect(controller.getSnapshot().sensors.map((sensor) => sensor.id)).toEqual([STRAP]);
    controller.dispose();
  });
});

describe('a browser that refuses to forget — #659’s review', () => {
  it('says the browser still lists the device, rather than only "Not paired"', async () => {
    const fake = createFakeBluetooth({
      devices: [
        {
          id: 'strap',
          name: 'HRM 04B1',
          services: [{ uuid: HEART_RATE_SERVICE, characteristics: [HEART_RATE_MEASUREMENT] }],
          forgetRejects: true,
        },
      ],
    });
    const transport = createWebBluetoothTransport({
      profiles: [heartRateProfile],
      bluetooth: fake.bluetooth,
      hasUserActivation: () => true,
    });
    const controller = createRideController({
      transport,
      store: harnessStore(),
      athleteId: ATHLETE_A,
      newSessionId: () => recordingSessionId('forget-refused'),
      now: () => unixSeconds(1),
    });
    await controller.pair('heart-rate');
    expect(controller.getSnapshot().sensors).toHaveLength(1);

    await controller.unpair(STRAP);

    expect(fake.bench.device('strap').forgets).toBe(1);
    expect(controller.getSnapshot().sensors).toHaveLength(0);
    expect(controller.getSnapshot().pairingError).toBe(
      "HRM 04B1 is forgotten here, but your browser still lists it. To remove it there too, remove it in this site's settings.",
    );
    controller.dispose();
  });
});

describe('an unsubscribe that throws does not leave half a sensor listed — #706', () => {
  // `detach` runs every step when an unsubscribe throws and then rethrows the
  // first failure (#704). Its two callers other than `dispose` let that
  // rethrow skip their own clean-up: the sensor stayed listed with its client
  // closed, the transport kept its record, and `unpair` rejected into a
  // `void` call on the Devices screen.

  /** Every connection-state observer's unsubscribe throws, after it has let go. */
  function throwingObserver(transport: SensorTransport): SensorTransport {
    const observe = transport.observeConnectionState.bind(transport);
    vi.spyOn(transport, 'observeConnectionState').mockImplementation((id, listener) => {
      const unobserve = observe(id, listener);
      return () => {
        unobserve();
        throw new Error('the transport would not let go');
      };
    });
    return transport;
  }

  function forgottenBy(transport: SensorTransport, id: typeof STRAP): boolean {
    try {
      transport.connectionState(id);
    } catch (error) {
      return isSensorError(error, 'device-not-found');
    }
    return false;
  }

  it('a failed pairing still removes and forgets the sensor, and reports the PAIRING error', async () => {
    const { transport } = createSimulator({
      devices: [hrsStrap({ id: 'strap', name: 'HRM 04B1' })],
    });
    throwingObserver(transport);
    let refuseConnect = true;
    const flaky: SensorTransport = {
      ...transport,
      connect: (id) =>
        refuseConnect
          ? Promise.reject(new Error('the link would not come up'))
          : transport.connect(id),
    };
    const controller = createRideController({
      transport: flaky,
      store: harnessStore(),
      athleteId: ATHLETE_A,
      newSessionId: () => recordingSessionId('attach-unsubscribe-threw'),
      now: () => unixSeconds(1),
    });

    await expect(controller.pair('heart-rate')).resolves.toBeUndefined();

    // What went wrong is the link, and that is what the rider is told — not
    // the unsubscribe that failed while the attempt was being undone.
    expect(controller.getSnapshot().pairingError).toBe('the link would not come up');
    expect(controller.getSnapshot().sensors).toEqual([]);
    expect(forgottenBy(transport, STRAP)).toBe(true);
    // And the chooser brings it back, with no "already paired".
    refuseConnect = false;
    await controller.pair('heart-rate');
    expect(controller.getSnapshot().pairingError).toBeUndefined();
    expect(controller.getSnapshot().sensors.map((sensor) => sensor.id)).toEqual([STRAP]);
    controller.dispose();
  });

  it('Forget still removes and forgets the sensor, resolves, and says so in a sentence', async () => {
    const rig = benchWith({ devices: 'trainer+strap' });
    throwingObserver(rig.transport);
    await rig.controller.pair('trainer');
    await rig.controller.pair('heart-rate');
    await ride(rig, 3);

    await expect(rig.controller.unpair(STRAP)).resolves.toBeUndefined();

    const snapshot = rig.controller.getSnapshot();
    expect(snapshot.sensors.map((sensor) => sensor.id)).toEqual([TRAINER]);
    expect(forgottenBy(rig.transport, STRAP)).toBe(true);
    expect(snapshot.pairingError).toBe(
      'HRM 04B1 is forgotten, but this app could not stop listening to it cleanly. If its readings still appear, reload the page, or close the app and open it again.',
    );
    // And the chooser brings it back.
    await rig.controller.pair('heart-rate');
    expect(rig.controller.getSnapshot().sensors.map((sensor) => sensor.id)).toContain(STRAP);
    rig.controller.dispose();
  });

  it('says the device is forgotten only once the transport has let go — #706 review', async () => {
    const rig = benchWith({ devices: 'trainer+strap' });
    throwingObserver(rig.transport);
    await rig.controller.pair('trainer');
    await rig.controller.pair('heart-rate');
    const forget = rig.transport.forget.bind(rig.transport);
    let letGo: () => void = () => undefined;
    vi.spyOn(rig.transport, 'forget').mockImplementation(
      (id) =>
        new Promise<void>((resolve, reject) => {
          letGo = () => {
            forget(id).then(resolve, reject);
          };
        }),
    );

    const unpairing = rig.controller.unpair(STRAP);
    await flushMicrotasks(20);

    // The row is gone (#659's order) — and nothing yet claims it is forgotten.
    expect(rig.controller.getSnapshot().sensors.map((sensor) => sensor.id)).toEqual([TRAINER]);
    expect(rig.controller.getSnapshot().pairingError).toBeUndefined();

    letGo();
    await expect(unpairing).resolves.toBeUndefined();
    expect(rig.controller.getSnapshot().pairingError).toBe(
      'HRM 04B1 is forgotten, but this app could not stop listening to it cleanly. If its readings still appear, reload the page, or close the app and open it again.',
    );
    rig.controller.dispose();
  });

  it('Forget on a held trainer still sends the Stop BEFORE it detaches — #659', async () => {
    const rig = benchWith({ machine: { retainsTargetsThroughStop: true } });
    throwingObserver(rig.transport);
    await rig.controller.pair('trainer');
    await rig.controller.requestTrainerControl();
    await rig.controller.setTargetPower(watts(210));
    const before = rig.written.length;

    await expect(rig.controller.unpair(TRAINER)).resolves.toBeUndefined();
    await flushMicrotasks(20);

    const snapshot = rig.controller.getSnapshot();
    expect(rig.written.slice(before)).toStrictEqual([[STOP_OR_PAUSE, 0x01]]);
    expect(snapshot.trainer.paired).toBe(false);
    expect(snapshot.sensors).toEqual([]);
    expect(forgottenBy(rig.transport, TRAINER)).toBe(true);
    expect(snapshot.pairingError).toBe(
      'KICKR 1F2A is forgotten, but this app could not stop listening to it cleanly. If its readings still appear, reload the page, or close the app and open it again.',
    );
    rig.controller.dispose();
  });

  it('says both things when the browser also refuses to forget it', async () => {
    const fake = createFakeBluetooth({
      devices: [
        {
          id: 'strap',
          name: 'HRM 04B1',
          services: [{ uuid: HEART_RATE_SERVICE, characteristics: [HEART_RATE_MEASUREMENT] }],
          forgetRejects: true,
        },
      ],
    });
    const transport = throwingObserver(
      createWebBluetoothTransport({
        profiles: [heartRateProfile],
        bluetooth: fake.bluetooth,
        hasUserActivation: () => true,
      }),
    );
    const controller = createRideController({
      transport,
      store: harnessStore(),
      athleteId: ATHLETE_A,
      newSessionId: () => recordingSessionId('forget-refused-and-threw'),
      now: () => unixSeconds(1),
    });
    await controller.pair('heart-rate');

    await expect(controller.unpair(STRAP)).resolves.toBeUndefined();

    expect(fake.bench.device('strap').forgets).toBe(1);
    expect(controller.getSnapshot().sensors).toHaveLength(0);
    expect(controller.getSnapshot().pairingError).toBe(
      "HRM 04B1 is forgotten, but this app could not stop listening to it cleanly. If its readings still appear, reload the page, or close the app and open it again. HRM 04B1 is forgotten here, but your browser still lists it. To remove it there too, remove it in this site's settings.",
    );
    controller.dispose();
  });
});

describe('a Forget still waiting on the transport — #712', () => {
  // `unpair` takes the row away before `transport.forget` has finished
  // (#659's order), so a Pair in that window used to pass the already-paired
  // check, attach, and then be revoked under the rider when the forget
  // landed. And the Pair buttons stay live meanwhile, so a Pair that failed in
  // that window had its error replaced by the Forget's late sentence.

  const STILL_BEING_FORGOTTEN = 'HRM 04B1 is still being forgotten. Pair it again in a moment.';
  const STILL_LISTED =
    "HRM 04B1 is forgotten here, but your browser still lists it. To remove it there too, remove it in this site's settings.";
  const STILL_LISTENING =
    'HRM 04B1 is forgotten, but this app could not stop listening to it cleanly. If its readings still appear, reload the page, or close the app and open it again.';

  /**
   * Run every `transport.forget` AT ONCE and hold back only its answer — the
   * order both real transports have (#714's review): Web Bluetooth deletes
   * its record and then awaits `native.forget()`, and the Capacitor transport
   * deletes its link and then awaits the teardown. So the record is gone
   * while the forget is still pending, and a chooser answering in that window
   * makes a NEW one. Holding the whole call instead — what this helper did
   * first — deleted the record only after the test let go, an order neither
   * transport has, and it hid the record a refused Pair left behind.
   *
   * `letGoFirst` answers the oldest held forget; `letGo` answers every held
   * one and stops holding, so a forget asked after it answers at once.
   * `rejects` answers each as a browser that refused to give up its grant.
   */
  function holdForget(
    transport: SensorTransport,
    rejects = false,
  ): {
    readonly letGo: () => void;
    readonly letGoFirst: () => void;
    readonly asked: () => number;
  } {
    const forget = transport.forget.bind(transport);
    const held: Array<() => void> = [];
    let holding = true;
    let asked = 0;
    vi.spyOn(transport, 'forget').mockImplementation((id) => {
      asked += 1;
      const done = forget(id);
      if (!holding) {
        return done;
      }
      return new Promise<void>((resolve, reject) => {
        held.push(() => {
          if (rejects) {
            done.then(() => {
              reject(new Error('the browser kept its grant'));
            }, reject);
          } else {
            done.then(resolve, reject);
          }
        });
      });
    });
    return {
      letGo: () => {
        holding = false;
        for (const letGo of held.splice(0)) {
          letGo();
        }
      },
      letGoFirst: () => {
        held.shift()?.();
      },
      asked: () => asked,
    };
  }

  /** Hold the next chooser open until the returned function is called. */
  function holdChooser(transport: SensorTransport): () => void {
    const discover = transport.discover.bind(transport);
    let answer: () => void = () => undefined;
    vi.spyOn(transport, 'discover').mockImplementationOnce(
      (request) =>
        new Promise((resolve, reject) => {
          answer = () => {
            discover(request).then(resolve, reject);
          };
        }),
    );
    return () => {
      answer();
    };
  }

  /** The next chooser is closed without a choice. */
  function chooserClosed(transport: SensorTransport): void {
    vi.spyOn(transport, 'discover').mockImplementationOnce(() =>
      Promise.reject(new Error('No sensor was chosen.')),
    );
  }

  function throwingObserver(transport: SensorTransport): void {
    const observe = transport.observeConnectionState.bind(transport);
    vi.spyOn(transport, 'observeConnectionState').mockImplementation((id, listener) => {
      const unobserve = observe(id, listener);
      return () => {
        unobserve();
        throw new Error('the transport would not let go');
      };
    });
  }

  function forgottenBy(transport: SensorTransport, id: typeof STRAP): boolean {
    try {
      transport.connectionState(id);
    } catch (error) {
      return isSensorError(error, 'device-not-found');
    }
    return false;
  }

  const listed = (rig: Bench): DeviceId[] =>
    rig.controller.getSnapshot().sensors.map((sensor) => sensor.id);

  it('refuses to pair the device again, and the pending forget revokes no newer pairing', async () => {
    const rig = benchWith({ devices: 'trainer+strap' });
    await rig.controller.pair('trainer');
    await rig.controller.pair('heart-rate');
    const { letGo, asked } = holdForget(rig.transport);

    const unpairing = rig.controller.unpair(STRAP);
    await flushMicrotasks(20);
    expect(asked()).toBe(1);
    const refused = rig.controller.pair('heart-rate');
    await flushMicrotasks(20);

    // Said at once, while the forget is still pending.
    expect(rig.controller.getSnapshot().pairingError).toBe(STILL_BEING_FORGOTTEN);
    expect(listed(rig)).toEqual([TRAINER]);
    // And the refused Pair's own forget waits for that one: two forgets of
    // one device are never on the platform's stack at once, and the later
    // one is the last word on the record.
    expect(asked()).toBe(1);

    letGo();
    await expect(unpairing).resolves.toBeUndefined();
    await expect(refused).resolves.toBeUndefined();

    // A clean forget writes nothing, so the refusal is still what is shown —
    // and nothing is listed that the transport has just let go of.
    expect(rig.controller.getSnapshot().pairingError).toBe(STILL_BEING_FORGOTTEN);
    expect(listed(rig)).toEqual([TRAINER]);
    // The record the refused chooser made is forgotten too (#714's review):
    // the pending forget had already dropped the old one, so without a second
    // forget the new one stays in the transport with nothing on screen.
    expect(asked()).toBe(2);
    expect(forgottenBy(rig.transport, STRAP)).toBe(true);

    // And once the forget is done, the chooser brings it back — connected,
    // and still known to the transport.
    await rig.controller.pair('heart-rate');
    const snapshot = rig.controller.getSnapshot();
    expect(snapshot.pairingError).toBeUndefined();
    expect(snapshot.sensors.find((sensor) => sensor.id === STRAP)?.state).toBe('connected');
    expect(forgottenBy(rig.transport, STRAP)).toBe(false);
    expect(asked()).toBe(2);
    rig.controller.dispose();
  });

  it('leaves no record behind for the device it refused — #714 review', async () => {
    // The reviewer's case, on the Web Bluetooth adapter itself: its `forget`
    // deletes the record and THEN awaits the browser, so the refused chooser
    // registers a new record the pending forget never sees.
    const fake = createFakeBluetooth({
      devices: [
        {
          id: 'strap',
          name: 'HRM 04B1',
          services: [{ uuid: HEART_RATE_SERVICE, characteristics: [HEART_RATE_MEASUREMENT] }],
        },
      ],
    });
    const transport = createWebBluetoothTransport({
      profiles: [heartRateProfile],
      bluetooth: fake.bluetooth,
      hasUserActivation: () => true,
    });
    const controller = createRideController({
      transport,
      store: harnessStore(),
      athleteId: ATHLETE_A,
      newSessionId: () => recordingSessionId('refused-leaves-no-record'),
      now: () => unixSeconds(1),
    });
    await controller.pair('heart-rate');
    const { letGo } = holdForget(transport);

    const unpairing = controller.unpair(STRAP);
    await flushMicrotasks(20);
    // The adapter has dropped its record already — the window this is about.
    expect(forgottenBy(transport, STRAP)).toBe(true);
    const refused = controller.pair('heart-rate');
    await flushMicrotasks(20);
    expect(controller.getSnapshot().pairingError).toBe(STILL_BEING_FORGOTTEN);

    letGo();
    await unpairing;
    await refused;

    expect(controller.getSnapshot().sensors).toEqual([]);
    expect(forgottenBy(transport, STRAP)).toBe(true);
    expect(fake.bench.device('strap').forgets).toBe(2);
    controller.dispose();
  });

  it('refuses a device the chooser returned after a forget begun while it was open had finished', async () => {
    const rig = benchWith({ devices: 'trainer+strap' });
    await rig.controller.pair('trainer');
    await rig.controller.pair('heart-rate');
    const { letGo } = holdForget(rig.transport);

    // The chooser is open BEFORE the Forget is pressed, and answers only after
    // the forget has finished — so nothing is being forgotten when it answers.
    const answer = holdChooser(rig.transport);
    const pairing = rig.controller.pair('heart-rate');
    await flushMicrotasks(20);
    const unpairing = rig.controller.unpair(STRAP);
    await flushMicrotasks(20);
    letGo();
    await unpairing;
    answer();
    await pairing;

    // The chooser may have granted the device before the forget withdrew it;
    // nothing here can tell which came first, so it is refused — and what the
    // chooser made is forgotten, not left in the transport (#714's review).
    expect(rig.controller.getSnapshot().pairingError).toBe(STILL_BEING_FORGOTTEN);
    expect(listed(rig)).toEqual([TRAINER]);
    expect(forgottenBy(rig.transport, STRAP)).toBe(true);

    await rig.controller.pair('heart-rate');
    expect(listed(rig)).toContain(STRAP);
    expect(forgottenBy(rig.transport, STRAP)).toBe(false);
    rig.controller.dispose();
  });

  it('refuses the device while a failed pairing is still forgetting it', async () => {
    const { transport } = createSimulator({
      devices: [hrsStrap({ id: 'strap', name: 'HRM 04B1' })],
    });
    const { letGo, asked } = holdForget(transport);
    let refuseConnect = true;
    const flaky: SensorTransport = {
      ...transport,
      connect: (id) =>
        refuseConnect
          ? Promise.reject(new Error('the link would not come up.'))
          : transport.connect(id),
    };
    const controller = createRideController({
      transport: flaky,
      store: harnessStore(),
      athleteId: ATHLETE_A,
      newSessionId: () => recordingSessionId('attach-failed-forget-pending'),
      now: () => unixSeconds(1),
    });

    const failing = controller.pair('heart-rate');
    await flushMicrotasks(20);
    expect(asked()).toBe(1);
    refuseConnect = false;
    const refused = controller.pair('heart-rate');
    await flushMicrotasks(20);
    expect(controller.getSnapshot().pairingError).toBe(STILL_BEING_FORGOTTEN);

    letGo();
    await failing;
    await refused;
    const snapshot = controller.getSnapshot();
    expect(snapshot.sensors).toEqual([]);
    // Both, the newer first: the refusal was said while the failure waited.
    expect(snapshot.pairingError).toBe(`${STILL_BEING_FORGOTTEN} the link would not come up.`);
    // And the refused chooser's record is forgotten after the clean-up's.
    expect(asked()).toBe(2);
    expect(forgottenBy(transport, STRAP)).toBe(true);

    await controller.pair('heart-rate');
    expect(controller.getSnapshot().sensors.map((sensor) => sensor.id)).toEqual([STRAP]);
    expect(forgottenBy(transport, STRAP)).toBe(false);
    controller.dispose();
  });

  it('keeps a Pair error that landed while the forget waited, when the browser refuses the forget', async () => {
    const rig = benchWith({ devices: 'trainer+strap' });
    await rig.controller.pair('trainer');
    await rig.controller.pair('heart-rate');
    const { letGo } = holdForget(rig.transport, true);
    const unpairing = rig.controller.unpair(STRAP);
    await flushMicrotasks(20);

    chooserClosed(rig.transport);
    await rig.controller.pair('heart-rate');
    expect(rig.controller.getSnapshot().pairingError).toBe('No sensor was chosen.');

    letGo();
    await expect(unpairing).resolves.toBeUndefined();

    expect(rig.controller.getSnapshot().pairingError).toBe(`No sensor was chosen. ${STILL_LISTED}`);
    rig.controller.dispose();
  });

  it('keeps a Pair error that landed while the forget waited, when an unsubscribe threw', async () => {
    const rig = benchWith({ devices: 'trainer+strap' });
    throwingObserver(rig.transport);
    await rig.controller.pair('trainer');
    await rig.controller.pair('heart-rate');
    const { letGo } = holdForget(rig.transport);
    const unpairing = rig.controller.unpair(STRAP);
    await flushMicrotasks(20);

    chooserClosed(rig.transport);
    await rig.controller.pair('heart-rate');

    letGo();
    await expect(unpairing).resolves.toBeUndefined();

    expect(rig.controller.getSnapshot().pairingError).toBe(
      `No sensor was chosen. ${STILL_LISTENING}`,
    );
    rig.controller.dispose();
  });

  it('a forget that finishes cleanly does not clear a newer Pair error', async () => {
    const rig = benchWith({ devices: 'trainer+strap' });
    await rig.controller.pair('trainer');
    await rig.controller.pair('heart-rate');
    const { letGo } = holdForget(rig.transport);
    const unpairing = rig.controller.unpair(STRAP);
    await flushMicrotasks(20);

    chooserClosed(rig.transport);
    await rig.controller.pair('heart-rate');
    letGo();
    await unpairing;

    expect(rig.controller.getSnapshot().pairingError).toBe('No sensor was chosen.');
    rig.controller.dispose();
  });

  it('a held trainer is Stopped before it is detached, and cannot be re-paired until it is forgotten', async () => {
    const rig = benchWith({ machine: { retainsTargetsThroughStop: true } });
    await rig.controller.pair('trainer');
    await rig.controller.requestTrainerControl();
    await rig.controller.setTargetPower(watts(210));
    const before = rig.written.length;
    const { letGo, asked } = holdForget(rig.transport);

    const unpairing = rig.controller.unpair(TRAINER);
    await flushMicrotasks(40);
    // The Stop is on the wire before the transport was asked to forget.
    expect(rig.written.slice(before)).toStrictEqual([[STOP_OR_PAUSE, 0x01]]);
    expect(asked()).toBe(1);

    const refused = rig.controller.pair('trainer');
    await flushMicrotasks(20);
    expect(rig.controller.getSnapshot().pairingError).toBe(
      'KICKR 1F2A is still being forgotten. Pair it again in a moment.',
    );
    expect(rig.controller.getSnapshot().trainer.paired).toBe(false);

    letGo();
    await unpairing;
    await refused;
    expect(rig.controller.getSnapshot().trainer.paired).toBe(false);
    expect(forgottenBy(rig.transport, TRAINER)).toBe(true);
    // One Stop, and nothing written by the refusal's own forget.
    expect(rig.written.slice(before)).toStrictEqual([[STOP_OR_PAUSE, 0x01]]);
    rig.controller.dispose();
  });

  it('keeps a Pair error that landed while a refused Stop was on the wire', async () => {
    const rig = benchWith({ machine: { retainsTargetsThroughStop: true }, refuseStop: true });
    await rig.controller.pair('trainer');
    await rig.controller.requestTrainerControl();
    await rig.controller.setTargetPower(watts(210));

    let settled = false;
    const unpairing = rig.controller.unpair(TRAINER).then(() => {
      settled = true;
    });
    chooserClosed(rig.transport);
    await rig.controller.pair('heart-rate');
    // The Pair's error landed while the release was still in flight — the
    // case this test is about, not one it only happens to pass over.
    expect(settled).toBe(false);
    await unpairing;

    expect(rig.controller.getSnapshot().pairingError).toBe(
      'No sensor was chosen. KICKR 1F2A was not forgotten: it did not confirm that it let go, so it may still be holding resistance. Try Forget again.',
    );
    rig.controller.dispose();
  });

  it("refuses the device while a refused Pair's own forget is in progress — #714 review", async () => {
    const rig = benchWith({ devices: 'trainer+strap' });
    await rig.controller.pair('trainer');
    await rig.controller.pair('heart-rate');
    const { letGo, letGoFirst, asked } = holdForget(rig.transport);
    const unpairing = rig.controller.unpair(STRAP);
    await flushMicrotasks(20);
    const refused = rig.controller.pair('heart-rate');
    await flushMicrotasks(20);

    // `unpair`'s forget answers, and the refused Pair's forget is asked and
    // held: that forget is the only one in progress now.
    letGoFirst();
    await unpairing;
    await flushMicrotasks(20);
    expect(asked()).toBe(2);
    const again = rig.controller.pair('heart-rate');
    await flushMicrotasks(20);
    expect(rig.controller.getSnapshot().pairingError).toBe(STILL_BEING_FORGOTTEN);
    expect(listed(rig)).toEqual([TRAINER]);

    letGo();
    await refused;
    await again;
    expect(listed(rig)).toEqual([TRAINER]);
    expect(forgottenBy(rig.transport, STRAP)).toBe(true);
    rig.controller.dispose();
  });

  it('a connect that fails after Forget is not a second forget, nor a pairing error — #713', async () => {
    // Forget pressed while the pairing is still connecting, and then the
    // connect fails. Until #713 `attach`'s clean-up forgot the device a
    // SECOND time — the overlap #714's review measured here — and reported a
    // pairing error for a device the rider had just forgotten. Now the
    // pairing sees that it has been abandoned and ends quietly, so there is
    // one forget: `unpair`'s, which still refuses a Pair until it is done.
    const { transport } = createSimulator({
      devices: [hrsStrap({ id: 'strap', name: 'HRM 04B1' })],
    });
    const { letGo, asked } = holdForget(transport);
    let failConnect: (error: Error) => void = () => undefined;
    let holdConnect = true;
    const slow: SensorTransport = {
      ...transport,
      connect: (id) =>
        holdConnect
          ? new Promise<void>((_resolve, reject) => {
              failConnect = reject;
            })
          : transport.connect(id),
    };
    const controller = createRideController({
      transport: slow,
      store: harnessStore(),
      athleteId: ATHLETE_A,
      newSessionId: () => recordingSessionId('connect-fails-after-forget'),
      now: () => unixSeconds(1),
    });

    const failing = controller.pair('heart-rate');
    await flushMicrotasks(20);
    const unpairing = controller.unpair(STRAP);
    await flushMicrotasks(20);
    expect(asked()).toBe(1);
    holdConnect = false;
    failConnect(new Error('the link would not come up.'));
    await failing;
    expect(asked()).toBe(1);
    expect(controller.getSnapshot().pairingError).toBeUndefined();

    // `unpair`'s forget is still pending, and it is still refused.
    const refused = controller.pair('heart-rate');
    await flushMicrotasks(20);
    expect(controller.getSnapshot().pairingError).toBe(STILL_BEING_FORGOTTEN);
    expect(controller.getSnapshot().sensors).toEqual([]);

    letGo();
    await unpairing;
    await refused;
    expect(controller.getSnapshot().sensors).toEqual([]);
    expect(forgottenBy(transport, STRAP)).toBe(true);

    // Done: the chooser brings it back.
    await controller.pair('heart-rate');
    expect(controller.getSnapshot().sensors.map((sensor) => sensor.id)).toEqual([STRAP]);
    controller.dispose();
  });

  it('clears the old error as soon as Forget is pressed, not when the Stop answers — #714 review', async () => {
    // Control held and nothing else: a hand-set target would end with the
    // release and announce that itself, which would hide this.
    const rig = benchWith({ machine: { retainsTargetsThroughStop: true }, holdStopAnswer: true });
    await rig.controller.pair('trainer');
    await rig.controller.requestTrainerControl();
    chooserClosed(rig.transport);
    await rig.controller.pair('heart-rate');
    expect(rig.controller.getSnapshot().pairingError).toBe('No sensor was chosen.');

    const said: Array<string | undefined> = [];
    const unsubscribe = rig.controller.subscribe(() => {
      said.push(rig.controller.getSnapshot().pairingError);
    });
    const unpairing = rig.controller.unpair(TRAINER);
    // Said on the press itself, not left to whatever announces next — on a
    // real trainer that can be the Stop's answer, seconds away.
    expect(rig.controller.getSnapshot().pairingError).toBeUndefined();
    expect(said).toStrictEqual([undefined]);
    await flushMicrotasks(20);
    // The Stop is on the wire and its answer is held: the release has not
    // settled, and the old error is gone from the screen.
    expect(rig.written.filter((write) => write[0] === STOP_OR_PAUSE)).toHaveLength(1);
    expect(rig.controller.getSnapshot().pairingError).toBeUndefined();
    unsubscribe();

    rig.deliverHeldStopAnswer();
    await unpairing;
    expect(rig.controller.getSnapshot().trainer.paired).toBe(false);
    expect(rig.controller.getSnapshot().pairingError).toBeUndefined();
    rig.controller.dispose();
  });
});

describe('Forget pressed while a pairing is still wiring — #713', () => {
  // `attach` lists the device before `wire` has finished, so the Devices
  // screen offers Forget while the pairing is still connecting, subscribing
  // and opening the trainer's control point. Each case holds one of those
  // three open, presses Forget, and then lets it finish — and reads back what
  // the rider sees and what the transport was left holding.

  interface Watched {
    /** Subscriptions the transport handed out and nothing has let go of. */
    readonly live: () => number;
    /** Calls to `transport.forget`. */
    readonly forgets: () => number;
    /** Calls to `transport.subscribe`. */
    readonly subscribes: () => number;
    /** Let the held call answer. */
    readonly answer: () => void;
  }

  /**
   * Count what the controller asks of `transport`, and hold back the answer to
   * the FIRST `connect` or `subscribe` — run at once, answered later, which is
   * the order a real stack has: the GATT work is under way when Forget lands.
   */
  function watch(transport: SensorTransport, hold: 'connect' | 'subscribe'): Watched {
    let live = 0;
    let forgets = 0;
    let subscribes = 0;
    let holding = true;
    let held: () => void = () => undefined;
    const later = <T>(done: Promise<T>): Promise<T> => {
      if (!holding) {
        return done;
      }
      holding = false;
      return new Promise<T>((resolve, reject) => {
        held = () => {
          done.then(resolve, reject);
        };
      });
    };
    const connect = transport.connect.bind(transport);
    const subscribe = transport.subscribe.bind(transport);
    const forget = transport.forget.bind(transport);
    vi.spyOn(transport, 'connect').mockImplementation((id) =>
      hold === 'connect' ? later(connect(id)) : connect(id),
    );
    vi.spyOn(transport, 'subscribe').mockImplementation((id, capability, listener) => {
      subscribes += 1;
      const done = subscribe(id, capability, listener).then((unsubscribe) => {
        live += 1;
        let released = false;
        return () => {
          if (!released) {
            released = true;
            live -= 1;
          }
          unsubscribe();
        };
      });
      return hold === 'subscribe' ? later(done) : done;
    });
    vi.spyOn(transport, 'forget').mockImplementation((id) => {
      forgets += 1;
      return forget(id);
    });
    return {
      live: () => live,
      forgets: () => forgets,
      subscribes: () => subscribes,
      answer: () => {
        held();
      },
    };
  }

  function forgottenBy(transport: SensorTransport, id: DeviceId): boolean {
    try {
      transport.connectionState(id);
    } catch (error) {
      return isSensorError(error, 'device-not-found');
    }
    return false;
  }

  const listed = (rig: Bench): DeviceId[] =>
    rig.controller.getSnapshot().sensors.map((sensor) => sensor.id);

  it('connect: the pairing ends quietly, with one forget and no error', async () => {
    const rig = benchWith({ devices: 'strap' });
    const watched = watch(rig.transport, 'connect');
    const pairing = rig.controller.pair('heart-rate');
    await flushMicrotasks(20);
    // The window is real: the row, and so its Forget, is on screen.
    expect(listed(rig)).toEqual([STRAP]);

    await rig.controller.unpair(STRAP);
    expect(listed(rig)).toEqual([]);
    watched.answer();
    await pairing;

    const snapshot = rig.controller.getSnapshot();
    expect(snapshot.sensors).toEqual([]);
    // Not a pairing error for a device the rider has just forgotten.
    expect(snapshot.pairingError).toBeUndefined();
    // Forgotten once, by the Forget: nothing the cancelled pairing does
    // afterwards asks the transport again.
    expect(watched.forgets()).toBe(1);
    expect(watched.live()).toBe(0);
    expect(forgottenBy(rig.transport, STRAP)).toBe(true);

    // And the chooser brings it back.
    await rig.controller.pair('heart-rate');
    expect(rig.controller.getSnapshot().sensors.map((sensor) => sensor.state)).toEqual([
      'connected',
    ]);
    expect(watched.live()).toBe(1);
    rig.controller.dispose();
  });

  it('connect: a late answer touches nothing of the pairing that replaced it', async () => {
    const rig = benchWith({ devices: 'strap' });
    const watched = watch(rig.transport, 'connect');
    const first = rig.controller.pair('heart-rate');
    await flushMicrotasks(20);
    await rig.controller.unpair(STRAP);
    // Paired again while the first pairing's connect is still out.
    await rig.controller.pair('heart-rate');
    expect(listed(rig)).toEqual([STRAP]);
    expect(watched.live()).toBe(1);

    watched.answer();
    await first;
    // Past the next announcement, so a row the late answer took away would
    // show — the snapshot is cached until something changes.
    await ride(rig, 2);

    const snapshot = rig.controller.getSnapshot();
    expect(snapshot.sensors.map((sensor) => sensor.state)).toEqual(['connected']);
    expect(metric(rig, 'heartRate').kind).toBe('live');
    expect(snapshot.pairingError).toBeUndefined();
    // One subscription — the new pairing's. The old one ASKED for nothing:
    // enabling notifications is a GATT write, on the new pairing's link.
    expect(watched.live()).toBe(1);
    expect(watched.subscribes()).toBe(1);
    expect(watched.forgets()).toBe(1);
    expect(forgottenBy(rig.transport, STRAP)).toBe(false);
    rig.controller.dispose();
  });

  it('subscribe: the subscription that lands after the Forget is let go', async () => {
    const rig = benchWith({ devices: 'strap' });
    const watched = watch(rig.transport, 'subscribe');
    const pairing = rig.controller.pair('heart-rate');
    await flushMicrotasks(20);
    expect(listed(rig)).toEqual([STRAP]);

    await rig.controller.unpair(STRAP);
    watched.answer();
    await pairing;

    expect(watched.live()).toBe(0);
    expect(rig.controller.getSnapshot().sensors).toEqual([]);
    expect(rig.controller.getSnapshot().pairingError).toBeUndefined();
    expect(watched.forgets()).toBe(1);
    rig.controller.dispose();
  });

  it('subscribe: the NEXT subscribe does not send the pairing down its failure path', async () => {
    // A trainer has three measurements, so a second subscribe follows the
    // held one — against a device the transport has already forgotten.
    const rig = benchWith({ withTrainerControl: false });
    const watched = watch(rig.transport, 'subscribe');
    const pairing = rig.controller.pair('trainer');
    await flushMicrotasks(20);
    expect(listed(rig)).toEqual([TRAINER]);

    await rig.controller.unpair(TRAINER);
    watched.answer();
    await pairing;

    const snapshot = rig.controller.getSnapshot();
    expect(snapshot.pairingError).toBeUndefined();
    expect(snapshot.sensors).toEqual([]);
    expect(watched.forgets()).toBe(1);
    expect(watched.live()).toBe(0);
    rig.controller.dispose();
  });

  it('openTrainer: the control client that arrives after the Forget is closed, and writes nothing', async () => {
    const rig = benchWith({ holdOpenTrainer: true, machine: { retainsTargetsThroughStop: true } });
    const pairing = rig.controller.pair('trainer');
    await flushMicrotasks(20);
    expect(listed(rig)).toEqual([TRAINER]);
    const client = rig.trainerControl();
    if (client === undefined) {
      throw new Error('openTrainer was not asked');
    }
    const close = vi.spyOn(client, 'close');
    let listening = 0;
    const onControlLost = client.onControlLost.bind(client);
    vi.spyOn(client, 'onControlLost').mockImplementation((listener) => {
      listening += 1;
      const unsubscribe = onControlLost(listener);
      return () => {
        listening -= 1;
        unsubscribe();
      };
    });

    await rig.controller.unpair(TRAINER);
    rig.answerOpenTrainer();
    await pairing;

    expect(close).toHaveBeenCalled();
    expect(listening).toBe(0);
    const snapshot = rig.controller.getSnapshot();
    expect(snapshot.trainer.paired).toBe(false);
    expect(snapshot.trainer.controllable).toBe(false);
    expect(snapshot.pairingError).toBeUndefined();
    // It never held control, so nothing — not even a Stop — went on the wire.
    expect(rig.written).toEqual([]);
    expect(rig.targetOnTheTrainer()).toBeUndefined();
    rig.controller.dispose();
  });

  it('dispose: the control client that arrives after it is closed, and writes nothing — #718', async () => {
    // The other way a pairing is abandoned, and a different path from Forget:
    // `dispose` clears the list and lets go without a forget. A late client
    // must find no entry to hang on and be closed, not left listening.
    const rig = benchWith({ holdOpenTrainer: true, machine: { retainsTargetsThroughStop: true } });
    const pairing = rig.controller.pair('trainer');
    await flushMicrotasks(20);
    expect(listed(rig)).toEqual([TRAINER]);
    const client = rig.trainerControl();
    if (client === undefined) {
      throw new Error('openTrainer was not asked');
    }
    const close = vi.spyOn(client, 'close');
    let listening = 0;
    const onControlLost = client.onControlLost.bind(client);
    vi.spyOn(client, 'onControlLost').mockImplementation((listener) => {
      listening += 1;
      const unsubscribe = onControlLost(listener);
      return () => {
        listening -= 1;
        unsubscribe();
      };
    });

    rig.controller.dispose();
    rig.answerOpenTrainer();
    await pairing;
    await flushMicrotasks(20);

    expect(close).toHaveBeenCalled();
    expect(listening).toBe(0);
    expect(rig.controller.getSnapshot().pairingError).toBeUndefined();
    expect(rig.written).toEqual([]);
    expect(rig.targetOnTheTrainer()).toBeUndefined();
  });
});

describe('a forget the browser never answers — #716', () => {
  // On the real Web Bluetooth adapter, whose `BluetoothDevice.forget()` here
  // never settles. The adapter's bound is fired by hand, so it is a decision
  // the test makes rather than thirty seconds it waits.
  function neverForgets() {
    const fake = createFakeBluetooth({
      devices: [
        {
          id: 'strap',
          name: 'HRM 04B1',
          services: [{ uuid: HEART_RATE_SERVICE, characteristics: [HEART_RATE_MEASUREMENT] }],
          forgetNeverSettles: true,
        },
      ],
    });
    const deadlines: Array<() => void> = [];
    const transport = createWebBluetoothTransport({
      profiles: [heartRateProfile],
      bluetooth: fake.bluetooth,
      hasUserActivation: () => true,
      schedule: (callback) => {
        deadlines.push(callback);
        return () => {
          const index = deadlines.indexOf(callback);
          if (index !== -1) {
            deadlines.splice(index, 1);
          }
        };
      },
    });
    const controller = createRideController({
      transport,
      store: harnessStore(),
      athleteId: ATHLETE_A,
      newSessionId: () => recordingSessionId('forget-never-settles'),
      now: () => unixSeconds(1),
    });
    return {
      fake,
      controller,
      /** Pass every bound that is running now — the GATT queue's and the forget's. */
      passTheBound: () => {
        for (const fire of deadlines.splice(0)) {
          fire();
        }
      },
    };
  }

  const UNCONFIRMED =
    "HRM 04B1 is forgotten here. Your browser did not confirm it, so it may still list it. If it does, remove it in this site's settings.";

  it('is forgotten here at the bound, says the browser may still list it, and pairs again', async () => {
    const { fake, controller, passTheBound } = neverForgets();
    await controller.pair('heart-rate');
    let settled = false;
    const unpairing = controller.unpair(STRAP).then(() => {
      settled = true;
    });
    await flushMicrotasks(20);
    expect(controller.getSnapshot().sensors).toEqual([]);
    expect(settled).toBe(false);

    // Refused while the forget is pending, as #712 has it.
    const refused = controller.pair('heart-rate');
    await flushMicrotasks(20);
    expect(controller.getSnapshot().pairingError).toBe(
      'HRM 04B1 is still being forgotten. Pair it again in a moment.',
    );

    passTheBound();
    await unpairing;
    expect(controller.getSnapshot().pairingError).toBe(
      `HRM 04B1 is still being forgotten. Pair it again in a moment. ${UNCONFIRMED}`,
    );
    // The refused Pair's own forget of what its chooser made is bounded too.
    await flushMicrotasks(20);
    passTheBound();
    await refused;

    // The device is free again, and the chooser brings it back — connected,
    // with a reading on the screen.
    await controller.pair('heart-rate');
    const snapshot = controller.getSnapshot();
    expect(snapshot.pairingError).toBeUndefined();
    expect(snapshot.sensors.map((sensor) => [sensor.id, sensor.state])).toEqual([
      [STRAP, 'connected'],
    ]);
    fake.bench
      .device('strap')
      .notify(HEART_RATE_SERVICE, HEART_RATE_MEASUREMENT, new Uint8Array([0, 132]));
    expect(
      controller.getSnapshot().metrics.find((entry) => entry.id === 'heartRate')?.state.kind,
    ).toBe('live');
    controller.dispose();
  });

  it("does not keep a refused Pair's promise pending for the session", async () => {
    const { controller, passTheBound } = neverForgets();
    await controller.pair('heart-rate');
    const unpairing = controller.unpair(STRAP);
    await flushMicrotasks(20);

    // Refused, and its own forget of what the chooser made waits for the
    // first — and would wait for ever behind a forget that never settles.
    let refusedSettled = false;
    const refused = controller.pair('heart-rate').then(() => {
      refusedSettled = true;
    });
    await flushMicrotasks(20);
    passTheBound();
    await unpairing;
    await flushMicrotasks(20);
    expect(refusedSettled).toBe(false);
    // Its own forget is bounded too.
    passTheBound();
    await refused;
    expect(refusedSettled).toBe(true);

    await controller.pair('heart-rate');
    expect(controller.getSnapshot().sensors.map((sensor) => sensor.id)).toEqual([STRAP]);
    controller.dispose();
  });
});

describe('a forget the browser answers AFTER the device was paired again — #717', () => {
  // The real Web Bluetooth adapter over the scripted stack, whose `forget()`
  // here waits for the test before it withdraws the grant — a browser that
  // answers after #716's bound, by which time the rider has paired the device
  // again. Every deadline is fired by hand.
  function answersLate(kind: 'strap' | 'trainer') {
    let answer: () => void = () => undefined;
    const forgetWaitsFor = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const fake = createFakeBluetooth({
      devices: [
        kind === 'strap'
          ? {
              id: 'strap',
              name: 'HRM 04B1',
              services: [{ uuid: HEART_RATE_SERVICE, characteristics: [HEART_RATE_MEASUREMENT] }],
              forgetWaitsFor,
            }
          : {
              id: 'kickr',
              name: 'KICKR 1F2A',
              services: [
                {
                  uuid: FITNESS_MACHINE_SERVICE,
                  characteristics: [
                    INDOOR_BIKE_DATA,
                    FITNESS_MACHINE_CONTROL_POINT,
                    FITNESS_MACHINE_STATUS,
                    SUPPORTED_POWER_RANGE,
                    FITNESS_MACHINE_FEATURE,
                  ],
                  readValues: {
                    // 0 W to 2000 W in 5 W steps.
                    [SUPPORTED_POWER_RANGE]: Uint8Array.from([0, 0, 0xd0, 0x07, 5, 0]),
                    // Power target and simulation, second field bits 3 and 13.
                    [FITNESS_MACHINE_FEATURE]: Uint8Array.from([0x82, 0, 0, 0, 0x08, 0x20, 0, 0]),
                  },
                },
              ],
              forgetWaitsFor,
            },
      ],
    });
    const deadlines: Array<() => void> = [];
    const transport = createWebBluetoothTransport({
      profiles: [heartRateProfile, createIndoorBikeDataProfile()],
      bluetooth: fake.bluetooth,
      hasUserActivation: () => true,
      schedule: (callback) => {
        deadlines.push(callback);
        return () => {
          const index = deadlines.indexOf(callback);
          if (index !== -1) {
            deadlines.splice(index, 1);
          }
        };
      },
    });
    const controller = createRideController({
      transport,
      store: harnessStore(),
      athleteId: ATHLETE_A,
      newSessionId: () => recordingSessionId('forget-answers-late'),
      now: () => unixSeconds(1),
      openTrainer: openWebBluetoothTrainer(transport, { scheduleTimeout: () => () => undefined }),
    });
    return {
      fake,
      controller,
      answer: () => {
        answer();
      },
      passTheBound: () => {
        for (const fire of deadlines.splice(0)) {
          fire();
        }
      },
    };
  }

  const row = (controller: RideController) =>
    controller.getSnapshot().sensors.map((sensor) => [sensor.id, sensor.state]);

  it('drops the new pairing when it lands, and the rider is told how to mend it', async () => {
    const { fake, controller, answer, passTheBound } = answersLate('strap');
    await controller.pair('heart-rate');
    const unpairing = controller.unpair(STRAP);
    await flushMicrotasks(20);
    passTheBound();
    await unpairing;

    // #716: paired again at the bound, connected, and reading.
    await controller.pair('heart-rate');
    expect(row(controller)).toEqual([[STRAP, 'connected']]);
    fake.bench
      .device('strap')
      .notify(HEART_RATE_SERVICE, HEART_RATE_MEASUREMENT, new Uint8Array([0, 132]));
    expect(
      controller.getSnapshot().metrics.find((entry) => entry.id === 'heartRate')?.state.kind,
    ).toBe('live');

    // The browser answers the OLD forget now. It withdraws the grant the new
    // pairing is using and drops its link: this is what #717 suspected.
    answer();
    await flushMicrotasks(20);
    expect(fake.bench.device('strap').connected).toBe(false);
    expect(fake.bench.device('strap').allowedServices).toEqual([]);
    expect(row(controller)).toEqual([[STRAP, 'disconnected']]);
    // …and the rider is told, in the words #717 chose.
    expect(controller.getSnapshot().pairingError).toContain(
      pairedAgainBeforeForgetLanded('HRM 04B1'),
    );

    // What the sentence says to do mends it.
    await controller.unpair(STRAP);
    await controller.pair('heart-rate');
    expect(row(controller)).toEqual([[STRAP, 'connected']]);
    controller.dispose();
  });

  it('says nothing when the device was not paired again', async () => {
    const { controller, answer, passTheBound } = answersLate('strap');
    await controller.pair('heart-rate');
    const unpairing = controller.unpair(STRAP);
    await flushMicrotasks(20);
    passTheBound();
    await unpairing;
    const before = controller.getSnapshot().pairingError;
    // #722's review: a negative assertion after a bounded flush passes just as
    // well if the late call's step in the controller never ran. That step
    // emits a snapshot either way, so seeing one is what makes "nothing was
    // said" a finding rather than an early look.
    let seen = 0;
    const unsubscribe = controller.subscribe(() => {
      seen += 1;
    });

    answer();
    await flushMicrotasks(20);
    unsubscribe();
    expect(seen).toBeGreaterThan(0);
    expect(controller.getSnapshot().pairingError).toBe(before);
    controller.dispose();
  });

  // #722's review, R3: names are not unique, so the name match is narrowed to
  // a device listed AFTER the forget began. Each case lists a device the
  // sentence must NOT be about, and lands the late call.
  function lateOnTheSimulator(devices: Array<{ id: string; name: string }>) {
    const { transport } = createSimulator({ devices: devices.map((device) => hrsStrap(device)) });
    const controller = createRideController({
      transport,
      store: harnessStore(),
      athleteId: ATHLETE_A,
      newSessionId: () => recordingSessionId('names'),
      now: () => unixSeconds(1),
    });
    const choose = (id: string) => {
      const discover = transport.discover.bind(transport);
      vi.spyOn(transport, 'discover').mockImplementationOnce(async (request) => {
        const chosen = (await transport.knownDevices()).find(
          (device) => device.identity.id === deviceId(id),
        );
        return chosen ?? discover(request);
      });
      return controller.pair('heart-rate');
    };
    const forget = transport.forget.bind(transport);
    let land: () => void = () => undefined;
    const stillRunning = new Promise<void>((resolve) => {
      land = resolve;
    });
    const nextForgetRunsLate = () =>
      vi.spyOn(transport, 'forget').mockImplementationOnce(async (id) => {
        await forget(id);
        throw new ForgetUnconfirmedError('forget-timed-out', 'late', {
          deviceId: id,
          holding: 'permission',
          stillRunning,
        });
      });
    return { controller, choose, nextForgetRunsLate, land: () => land() };
  }

  it('says nothing when a differently named device is paired in the window', async () => {
    const { controller, choose, nextForgetRunsLate, land } = lateOnTheSimulator([
      { id: 'strap', name: 'HRM 04B1' },
      { id: 'tickr', name: 'TICKR 9C3E' },
    ]);
    await choose('strap');
    nextForgetRunsLate();
    await controller.unpair(STRAP);
    await choose('tickr');
    expect(controller.getSnapshot().sensors.map((sensor) => sensor.id)).toEqual([
      deviceId('tickr'),
    ]);
    const before = controller.getSnapshot().pairingError;

    land();
    await flushMicrotasks(20);
    expect(controller.getSnapshot().pairingError).toBe(before);
    controller.dispose();
  });

  it('says nothing about a device of the same name that was already listed when the forget began', async () => {
    // Two straps that both advertise "HRM": forgetting one cannot make the
    // other one "paired again" — it never left the list.
    const { controller, choose, nextForgetRunsLate, land } = lateOnTheSimulator([
      { id: 'strap', name: 'HRM' },
      { id: 'strap-2', name: 'HRM' },
    ]);
    await choose('strap');
    await choose('strap-2');
    nextForgetRunsLate();
    await controller.unpair(STRAP);
    expect(controller.getSnapshot().sensors.map((sensor) => sensor.id)).toEqual([
      deviceId('strap-2'),
    ]);
    const before = controller.getSnapshot().pairingError;

    land();
    await flushMicrotasks(20);
    expect(controller.getSnapshot().pairingError).toBe(before);
    controller.dispose();
  });

  it('tells the rider by name when the device came back under a new id, as Web Bluetooth may give it', async () => {
    // The scripted browser hands a device chosen again its old id, so this
    // one is the simulator: the same strap, chosen again as `strap-2`.
    const { transport } = createSimulator({
      devices: [
        hrsStrap({ id: 'strap', name: 'HRM 04B1' }),
        hrsStrap({ id: 'strap-2', name: 'HRM 04B1' }),
      ],
    });
    const controller = createRideController({
      transport,
      store: harnessStore(),
      athleteId: ATHLETE_A,
      newSessionId: () => recordingSessionId('new-id'),
      now: () => unixSeconds(1),
    });
    await controller.pair('heart-rate');
    const forget = transport.forget.bind(transport);
    let land: () => void = () => undefined;
    const stillRunning = new Promise<void>((resolve) => {
      land = resolve;
    });
    vi.spyOn(transport, 'forget').mockImplementationOnce(async (id) => {
      await forget(id);
      throw new ForgetUnconfirmedError('forget-timed-out', 'late', {
        deviceId: id,
        holding: 'permission',
        stillRunning,
      });
    });
    await controller.unpair(STRAP);
    vi.spyOn(transport, 'discover').mockImplementationOnce(async () => {
      const again = (await transport.knownDevices()).find(
        (device) => device.identity.id === deviceId('strap-2'),
      );
      if (again === undefined) {
        throw new Error('no strap-2');
      }
      return again;
    });
    await controller.pair('heart-rate');
    expect(controller.getSnapshot().sensors.map((sensor) => sensor.id)).toEqual([
      deviceId('strap-2'),
    ]);

    land();
    await flushMicrotasks(20);
    expect(controller.getSnapshot().pairingError).toContain(
      pairedAgainBeforeForgetLanded('HRM 04B1'),
    );
    controller.dispose();
  });

  it('a trainer paired again in the window holds nothing of this app’s when its link drops — #721 makes the trainer half moot', async () => {
    const { fake, controller, answer, passTheBound } = answersLate('trainer');
    const controlPoint = () =>
      fake.bench.device('kickr').writes(FITNESS_MACHINE_SERVICE, FITNESS_MACHINE_CONTROL_POINT);
    await controller.pair('trainer');
    expect(controller.getSnapshot().trainer.paired).toBe(true);

    // While the forget is in progress, and while it runs late.
    const unpairing = controller.unpair(TRAINER);
    await flushMicrotasks(20);
    passTheBound();
    await unpairing;
    await controller.pair('trainer');
    expect(controller.getSnapshot().trainer.paired).toBe(true);
    void controller.requestTrainerControl();
    await flushMicrotasks(20);
    expect(controller.getSnapshot().trainer.refusal).toBe(CONTROL_WAITS_FOR_FORGET);
    expect(controlPoint()).toEqual([]);

    // It lands: the link goes, with nothing ever written to the machine.
    answer();
    await flushMicrotasks(20);
    expect(fake.bench.device('kickr').connected).toBe(false);
    expect(controlPoint()).toEqual([]);
    expect(controller.getSnapshot().pairingError).toContain(
      pairedAgainBeforeForgetLanded('KICKR 1F2A'),
    );
    controller.dispose();
  });
});

describe('a forget Bluetooth does not confirm, inside the Android shell — #718', () => {
  // The real Capacitor transport over the scripted plugin, as `main.tsx`
  // builds it inside the shell. Its forget stops the notifications and drops
  // the link; the plugin holds no grant, so nothing about a browser or a
  // site's settings is true here — what is unknown is the LINK.
  function shell(disconnect: 'hangs' | 'refuses') {
    const base = scriptedPort({ chooses: { deviceId: 'AA:BB:CC:DD:EE:01', name: 'HRM 04B1' } });
    let letGoWith: 'normally' | 'held' = 'normally';
    const plugin: typeof base = {
      ...base,
      disconnect: (id) => {
        if (letGoWith === 'normally') {
          return base.disconnect(id);
        }
        return disconnect === 'hangs'
          ? new Promise<void>(() => undefined)
          : Promise.reject(new Error('disconnect failed'));
      },
    };
    const deadlines: Array<() => void> = [];
    const transport = createCapacitorTransport({
      plugin,
      profiles: [heartRateProfile],
      now: () => unixSeconds(1),
      schedule: (callback) => {
        deadlines.push(callback);
        return () => {
          const index = deadlines.indexOf(callback);
          if (index !== -1) {
            deadlines.splice(index, 1);
          }
        };
      },
    });
    const controller = createRideController({
      transport,
      store: harnessStore(),
      athleteId: ATHLETE_A,
      newSessionId: () => recordingSessionId('shell-forget'),
      now: () => unixSeconds(1),
    });
    return {
      controller,
      id: deviceId('AA:BB:CC:DD:EE:01'),
      hold: () => {
        letGoWith = 'held';
      },
      release: () => {
        letGoWith = 'normally';
      },
      passTheBound: () => {
        for (const fire of deadlines.splice(0)) {
          fire();
        }
      },
    };
  }

  const MAY_STILL_BE_CONNECTED =
    'HRM 04B1 is forgotten here, but Bluetooth did not confirm it let go, so it may still be connected. If it still appears connected, turn Bluetooth off and on.';

  it('says the device may still be connected when the plugin runs out of time — and nothing about a browser', async () => {
    const { controller, id, hold, release, passTheBound } = shell('hangs');
    await controller.pair('heart-rate');
    expect(controller.getSnapshot().sensors.map((sensor) => sensor.id)).toEqual([id]);
    hold();
    let settled = false;
    const unpairing = controller.unpair(id).then(() => {
      settled = true;
    });
    await flushMicrotasks(40);
    expect(settled).toBe(false);
    passTheBound();
    await unpairing;

    const said = controller.getSnapshot().pairingError;
    expect(said).toBe(MAY_STILL_BE_CONNECTED);
    expect(said).not.toMatch(/browser|settings/u);
    // And it pairs again, which is #716 — with a plugin that answers again,
    // because the transport's own connect disconnects first.
    release();
    await controller.pair('heart-rate');
    expect(controller.getSnapshot().sensors.map((sensor) => sensor.id)).toEqual([id]);
    controller.dispose();
  });

  it('says the same when the plugin refuses the disconnect', async () => {
    const { controller, id, hold } = shell('refuses');
    await controller.pair('heart-rate');
    hold();
    await controller.unpair(id);

    const said = controller.getSnapshot().pairingError;
    expect(said).toBe(MAY_STILL_BE_CONNECTED);
    expect(said).not.toMatch(/browser|settings/u);
    controller.dispose();
  });
});

describe('no trainer control while a timed-out forget is still running — #718', () => {
  // #716 lets a device be paired again at the transport's bound while the
  // stack's own forget is still running, and when that call lands it drops
  // the link of whatever pairing is current then. A trainer put under control
  // in that window would lose its link holding a target. So pairing goes on,
  // and control waits for the call to land.

  interface LateForget {
    /** Let the stack's call land. */
    readonly land: () => void;
  }

  /**
   * Make the next `transport.forget` do its work here and then reject as a
   * transport whose bound passed does: a {@link ForgetUnconfirmedError}
   * carrying a call the test lands by hand.
   */
  function timesOutOnce(transport: SensorTransport, holding: ForgetHold): LateForget {
    const forget = transport.forget.bind(transport);
    let land: () => void = () => undefined;
    const stillRunning = new Promise<void>((resolve) => {
      land = resolve;
    });
    vi.spyOn(transport, 'forget').mockImplementationOnce(async (id) => {
      await forget(id);
      throw new ForgetUnconfirmedError('forget-timed-out', 'late', {
        deviceId: id,
        holding,
        stillRunning,
      });
    });
    return {
      land: () => {
        land();
      },
    };
  }

  const REQUEST_CONTROL = 0x00;
  const asked = (rig: Bench): number =>
    rig.written.filter((octets) => octets[0] === REQUEST_CONTROL).length;

  /**
   * The NEO, a second FTMS machine, paired as a power meter — so forgetting
   * it holds every trainer's control back (#718's finding B).
   */
  async function neoPairedAsAPowerMeter(rig: Bench): Promise<DeviceId> {
    const discover = rig.transport.discover.bind(rig.transport);
    vi.spyOn(rig.transport, 'discover').mockImplementationOnce((request) =>
      discover({ ...request, namePrefix: 'NEO' }),
    );
    await rig.controller.pair('power-meter');
    const neo = deviceId('neo');
    expect(rig.controller.getSnapshot().sensors.map((sensor) => sensor.id)).toContain(neo);
    return neo;
  }

  for (const holding of ['permission', 'link'] as const) {
    it(`pairs the trainer again, and asks it for nothing until the call lands (${holding})`, async () => {
      const rig = benchWith({ machine: { retainsTargetsThroughStop: true } });
      await rig.controller.pair('trainer');
      const late = timesOutOnce(rig.transport, holding);
      await rig.controller.unpair(TRAINER);

      // #716: pairing again works.
      await rig.controller.pair('trainer');
      expect(rig.controller.getSnapshot().trainer.paired).toBe(true);

      // Control does not.
      await rig.controller.requestTrainerControl();
      expect(rig.controller.getSnapshot().trainer.refusal).toBe(CONTROL_WAITS_FOR_FORGET);
      expect(asked(rig)).toBe(0);
      expect(rig.trainerControl()?.hasControl()).toBe(false);
      // And so no setpoint takes, whatever the screen asks: the client itself
      // refuses a target it was never granted control for.
      await rig.controller.setTargetPower(watts(200));
      await flushMicrotasks(20);
      expect(rig.targetOnTheTrainer()).toBeUndefined();
      expect(rig.written).toEqual([]);
      await rig.controller.requestTrainerControl();
      expect(rig.controller.getSnapshot().trainer.refusal).toBe(CONTROL_WAITS_FOR_FORGET);

      // The call lands: the sentence goes by itself, and control can be had.
      late.land();
      await flushMicrotasks(20);
      expect(rig.controller.getSnapshot().trainer.refusal).toBeUndefined();
      await rig.controller.requestTrainerControl();
      expect(asked(rig)).toBe(1);
      expect(rig.trainerControl()?.hasControl()).toBe(true);
      rig.controller.dispose();
    });
  }

  it('holds control back after a refused Pair’s own forget runs out of time too', async () => {
    const rig = benchWith({ machine: { retainsTargetsThroughStop: true } });
    await rig.controller.pair('trainer');
    // Forget's own forget is held pending, so a Pair meanwhile is refused and
    // forgets what its chooser made — and THAT forget runs out of time.
    const forget = rig.transport.forget.bind(rig.transport);
    let finishFirst: () => void = () => undefined;
    let land: () => void = () => undefined;
    const stillRunning = new Promise<void>((resolve) => {
      land = resolve;
    });
    vi.spyOn(rig.transport, 'forget')
      .mockImplementationOnce(
        (id) =>
          new Promise<void>((resolve, reject) => {
            finishFirst = () => {
              forget(id).then(resolve, reject);
            };
          }),
      )
      .mockImplementationOnce(async (id) => {
        await forget(id);
        throw new ForgetUnconfirmedError('forget-timed-out', 'late', {
          deviceId: id,
          holding: 'permission',
          stillRunning,
        });
      });
    const unpairing = rig.controller.unpair(TRAINER);
    await flushMicrotasks(20);
    const refused = rig.controller.pair('trainer');
    await flushMicrotasks(20);
    finishFirst();
    await unpairing;
    await refused;

    await rig.controller.pair('trainer');
    await rig.controller.requestTrainerControl();
    expect(rig.controller.getSnapshot().trainer.refusal).toBe(CONTROL_WAITS_FOR_FORGET);
    expect(asked(rig)).toBe(0);

    land();
    await flushMicrotasks(20);
    await rig.controller.requestTrainerControl();
    expect(asked(rig)).toBe(1);
    rig.controller.dispose();
  });

  it('holds control back after a failed pairing’s clean-up forget runs out of time', async () => {
    const rig = benchWith({ machine: { retainsTargetsThroughStop: true } });
    const connect = rig.transport.connect.bind(rig.transport);
    vi.spyOn(rig.transport, 'connect')
      .mockImplementationOnce(async (id) => {
        await connect(id);
        throw new Error('the link dropped while it was coming up');
      })
      .mockImplementation(connect);
    const late = timesOutOnce(rig.transport, 'link');
    await rig.controller.pair('trainer');
    expect(rig.controller.getSnapshot().trainer.paired).toBe(false);

    await rig.controller.pair('trainer');
    await rig.controller.requestTrainerControl();
    expect(rig.controller.getSnapshot().trainer.refusal).toBe(CONTROL_WAITS_FOR_FORGET);
    expect(asked(rig)).toBe(0);

    late.land();
    await flushMicrotasks(20);
    await rig.controller.requestTrainerControl();
    expect(asked(rig)).toBe(1);
    rig.controller.dispose();
  });

  it('does not hold a trainer back for a heart-rate strap’s late forget', async () => {
    const rig = benchWith({ devices: 'trainer+strap' });
    await rig.controller.pair('trainer');
    await rig.controller.pair('heart-rate');
    timesOutOnce(rig.transport, 'permission');
    await rig.controller.unpair(STRAP);

    await rig.controller.requestTrainerControl();
    expect(rig.controller.getSnapshot().trainer.refusal).toBeUndefined();
    expect(asked(rig)).toBe(1);
    rig.controller.dispose();
  });

  // #718's second review, finding B: the role half of the check is not
  // enough on its own. A trainer paired as a power meter is exactly the device
  // the late call will disconnect once it is paired again as the trainer.
  it('holds control back after a late forget of a trainer that was paired as a power meter', async () => {
    const rig = benchWith({ machine: { retainsTargetsThroughStop: true } });
    await rig.controller.pair('power-meter');
    expect(rig.controller.getSnapshot().sensors.map((sensor) => sensor.role)).toEqual([
      'power-meter',
    ]);
    const late = timesOutOnce(rig.transport, 'permission');
    await rig.controller.unpair(TRAINER);

    await rig.controller.pair('trainer');
    expect(rig.controller.getSnapshot().trainer.paired).toBe(true);
    await rig.controller.requestTrainerControl();
    expect(rig.controller.getSnapshot().trainer.refusal).toBe(CONTROL_WAITS_FOR_FORGET);
    expect(asked(rig)).toBe(0);

    late.land();
    await flushMicrotasks(20);
    await rig.controller.requestTrainerControl();
    expect(asked(rig)).toBe(1);
    rig.controller.dispose();
  });

  // Finding C: a call that never lands. Nothing unblocks control on a timer,
  // and the sentence stays true however long it lasts.
  it('keeps holding control back while the call never lands, and never promises a minute', async () => {
    const rig = benchWith({ machine: { retainsTargetsThroughStop: true } });
    await rig.controller.pair('trainer');
    timesOutOnce(rig.transport, 'link'); // never landed
    await rig.controller.unpair(TRAINER);
    await rig.controller.pair('trainer');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await ride(rig, 120);
      await rig.controller.requestTrainerControl();
      expect(rig.controller.getSnapshot().trainer.refusal).toBe(CONTROL_WAITS_FOR_FORGET);
    }
    expect(asked(rig)).toBe(0);
    expect(rig.trainerControl()?.hasControl()).toBe(false);
    expect(CONTROL_WAITS_FOR_FORGET).not.toMatch(/minute/u);
    expect(CONTROL_WAITS_FOR_FORGET).toMatch(
      /reload the page, or close the app and open it again/u,
    );
    // Finding D: the wait is global, so it cannot name THIS trainer.
    expect(CONTROL_WAITS_FOR_FORGET).not.toMatch(/this trainer/u);
    rig.controller.dispose();
  });

  // Finding A: the client asks for control by itself on a 0xFF, whether or
  // not it ever held it, so a trainer re-paired in the window can come to hold
  // control without the rider's Request Control. What must not follow is a
  // setpoint — and a release must still go out.
  describe('control the client took back by itself — #718’s second review', () => {
    const TARGET_POWER = 0x05;
    const SIMULATION = 0x11;
    const STOP = 0x08;
    const opcodes = (rig: Bench): number[] => rig.written.map((octets) => octets[0] ?? -1);

    /**
     * ⚠️ Rewritten by #721. This used to re-pair the KICKR inside a late
     * forget's window and let its client take control back by itself there —
     * which #721 closes: that Request Control is no longer sent (see
     * "asks for nothing on a 0xFF …" below). The client that can still hold
     * control the rider never asked for is one that took it back BEFORE a
     * trainer's forget began, so that is what this builds: the KICKR takes
     * control back by itself with nothing being forgotten, and then a second
     * trainer's forget runs out of time.
     */
    async function reacquiredInTheWindow() {
      const rig = benchWith({
        devices: 'two-trainers',
        machine: { retainsTargetsThroughStop: true },
        reacquireControl: true,
      });
      await rig.controller.pair('trainer');
      rig.written.length = 0;

      // Another app takes the machine and lets it go: the client asks again.
      rig.permissionLost();
      await flushMicrotasks(20);
      expect(opcodes(rig)).toEqual([REQUEST_CONTROL]);
      expect(rig.trainerControl()?.hasControl()).toBe(true);

      const neo = await neoPairedAsAPowerMeter(rig);
      const late = timesOutOnce(rig.transport, 'permission');
      await rig.controller.unpair(neo);
      rig.written.length = 0;
      return { rig, late };
    }

    it('asks for nothing on a 0xFF while a trainer’s forget runs late — #721', async () => {
      // The KICKR is forgotten late and paired again: the case #718's second
      // review found. Its client's own Request Control is held back now, with
      // the rider's.
      const rig = benchWith({
        machine: { retainsTargetsThroughStop: true },
        reacquireControl: true,
      });
      await rig.controller.pair('trainer');
      const late = timesOutOnce(rig.transport, 'permission');
      await rig.controller.unpair(TRAINER);
      await rig.controller.pair('trainer');
      rig.written.length = 0;

      rig.permissionLost();
      await flushMicrotasks(20);
      expect(opcodes(rig)).toEqual([]);
      expect(rig.trainerControl()?.hasControl()).toBe(false);

      // Held back, not deferred: landing asks for nothing either.
      late.land();
      await flushMicrotasks(20);
      expect(opcodes(rig)).toEqual([]);
      rig.controller.dispose();
    });

    it('sends no ERG target to it', async () => {
      const { rig } = await reacquiredInTheWindow();
      await rig.controller.setTargetPower(watts(250));
      await flushMicrotasks(20);
      expect(opcodes(rig)).not.toContain(TARGET_POWER);
      expect(rig.targetOnTheTrainer()).toBeUndefined();
      expect(rig.controller.getSnapshot().trainer.refusal).toBe(TARGET_WAITS_FOR_FORGET);
      rig.controller.dispose();
    });

    it('starts no workout on it', async () => {
      const { rig } = await reacquiredInTheWindow();
      const workout: WorkoutRecord = {
        id: workoutId('w718'),
        createdBy: ATHLETE_A,
        name: 'Late forget',
        workout: {
          name: 'Late forget',
          blocks: [{ kind: 'steady', seconds: seconds(6), target: thresholdShare(0.8) }],
        },
        createdAt: unixSeconds(1),
        updatedAt: unixSeconds(1),
      };
      expect(rig.controller.startWorkout(workout, watts(250))).toBe(false);
      expect(rig.controller.getSnapshot().workout).toBeUndefined();
      await ride(rig, 3);
      expect(opcodes(rig)).not.toContain(TARGET_POWER);
      expect(rig.controller.getSnapshot().trainer.refusal).toBe(TARGET_WAITS_FOR_FORGET);
      rig.controller.dispose();
    });

    it('sends no gradient to it, but lets it go when asked', async () => {
      const { rig } = await reacquiredInTheWindow();
      const road = rig.controller.simulationControl();
      if (road === undefined) {
        throw new Error('no simulation control');
      }
      await expect(road.setSimulationParameters({ grade: gradePercent(6) })).rejects.toBeInstanceOf(
        TargetHeldBack,
      );
      await flushMicrotasks(20);
      expect(opcodes(rig)).not.toContain(SIMULATION);

      // #724: what the game's own loop, over the real handle, tells the rider —
      // the hold, by its class, and not "the trainer refused that gradient".
      const session = createGradientSession({ profile: risingRoad(), control: road });
      session.sample(seconds(0), 500);
      await flushMicrotasks(20);
      expect(session.state().fault).toBe(
        'The hills are not being sent yet: Bluetooth is still finishing forgetting a trainer. The next gradient will be sent again.',
      );
      expect(opcodes(rig)).not.toContain(SIMULATION);

      // ⚠️ The gate never holds back a release: a refused Stop is resistance
      // left on.
      await road.letGo();
      expect(opcodes(rig)).toEqual([STOP]);
      rig.controller.dispose();
    });

    it('drives it once the call lands and the rider asks', async () => {
      const { rig, late } = await reacquiredInTheWindow();
      await rig.controller.setTargetPower(watts(250));
      expect(rig.controller.getSnapshot().trainer.refusal).toBe(TARGET_WAITS_FOR_FORGET);
      late.land();
      await flushMicrotasks(20);
      // The reason is gone, so the sentence goes with it.
      expect(rig.controller.getSnapshot().trainer.refusal).toBeUndefined();
      await rig.controller.requestTrainerControl();
      await rig.controller.setTargetPower(watts(250));
      await flushMicrotasks(20);
      expect(opcodes(rig)).toEqual([REQUEST_CONTROL, TARGET_POWER]);
      expect(rig.controller.getSnapshot().trainer.refusal).toBeUndefined();
      rig.controller.dispose();
    });

    it('lets a trainer the rider asked for BEFORE the late forget keep writing, and releases it', async () => {
      // A different device: the one being forgotten was let go and detached
      // before its forget began, and one device cannot be paired twice.
      const rig = benchWith({
        devices: 'two-trainers',
        machine: { retainsTargetsThroughStop: true },
        reacquireControl: true,
      });
      await rig.controller.pair('trainer');
      await rig.controller.requestTrainerControl();
      // A second FTMS machine, paired as a power meter and forgotten late —
      // which holds every trainer's Request Control back.
      const discover = rig.transport.discover.bind(rig.transport);
      vi.spyOn(rig.transport, 'discover').mockImplementationOnce((request) =>
        discover({ ...request, namePrefix: 'NEO' }),
      );
      await rig.controller.pair('power-meter');
      const neo = deviceId('neo');
      expect(rig.controller.getSnapshot().sensors.map((sensor) => sensor.id)).toContain(neo);
      timesOutOnce(rig.transport, 'permission');
      await rig.controller.unpair(neo);
      await rig.controller.requestTrainerControl();
      expect(rig.controller.getSnapshot().trainer.refusal).toBe(CONTROL_WAITS_FOR_FORGET);
      rig.written.length = 0;

      await rig.controller.setTargetPower(watts(200));
      await flushMicrotasks(20);
      expect(opcodes(rig)).toEqual([TARGET_POWER]);
      await rig.controller.clearTargetPower();
      expect(opcodes(rig)).toEqual([TARGET_POWER, STOP]);
      rig.controller.dispose();
    });
  });

  // #721: the hold starts when a trainer's forget does, not at #716's bound;
  // one rule gates every setpoint an unasked client writes, per write; and a
  // release is never held back.
  describe('control held back for the whole of a trainer’s forget — #721', () => {
    const TARGET_POWER = 0x05;
    const STOP = 0x08;
    const opcodes = (rig: Bench): number[] => rig.written.map((octets) => octets[0] ?? -1);
    const stops = (rig: Bench): number => opcodes(rig).filter((op) => op === STOP).length;

    interface HeldForget {
      /** The stack answers in time. */
      readonly finish: () => void;
      /** The transport's bound passes; the call goes on running until `land`. */
      readonly timeOut: () => LateForget;
    }

    /** The next `transport.forget` waits for the test to say how it ends. */
    function forgetHeld(transport: SensorTransport): HeldForget {
      const forget = transport.forget.bind(transport);
      let end: (how: 'finish' | 'time-out') => void = () => undefined;
      let land: () => void = () => undefined;
      const stillRunning = new Promise<void>((resolve) => {
        land = resolve;
      });
      vi.spyOn(transport, 'forget').mockImplementationOnce(
        (id) =>
          new Promise<void>((resolve, reject) => {
            end = (how) => {
              forget(id).then(() => {
                if (how === 'finish') {
                  resolve();
                } else {
                  reject(
                    new ForgetUnconfirmedError('forget-timed-out', 'late', {
                      deviceId: id,
                      holding: 'permission',
                      stillRunning,
                    }),
                  );
                }
              }, reject);
            };
          }),
      );
      return {
        finish: () => {
          end('finish');
        },
        timeOut: () => {
          end('time-out');
          return {
            land: () => {
              land();
            },
          };
        },
      };
    }

    function twoTrainers(extra: BenchOptions = {}): Bench {
      return benchWith({
        devices: 'two-trainers',
        machine: { retainsTargetsThroughStop: true },
        reacquireControl: true,
        ...extra,
      });
    }

    /** Six seconds at 60 %, then ten minutes at 80 % — a second target, and a RAISE. */
    const twoIntervals: WorkoutRecord = {
      id: workoutId('w721'),
      createdBy: ATHLETE_A,
      name: 'Two intervals',
      workout: {
        name: 'Two intervals',
        blocks: [
          { kind: 'steady', seconds: seconds(6), target: thresholdShare(0.6) },
          { kind: 'steady', seconds: seconds(600), target: thresholdShare(0.8) },
        ],
      },
      createdAt: unixSeconds(1),
      updatedAt: unixSeconds(1),
    };

    it('asks for nothing while the forget is IN PROGRESS, not only once it is late', async () => {
      const rig = twoTrainers();
      await rig.controller.pair('trainer');
      const neo = await neoPairedAsAPowerMeter(rig);
      const held = forgetHeld(rig.transport);
      const unpairing = rig.controller.unpair(neo);
      await flushMicrotasks(20);
      rig.written.length = 0;

      // The rider's Request Control…
      await rig.controller.requestTrainerControl();
      expect(rig.controller.getSnapshot().trainer.refusal).toBe(CONTROL_WAITS_FOR_FORGET);
      // …and the client's own, on a 0xFF.
      rig.permissionLost();
      await flushMicrotasks(20);
      expect(opcodes(rig)).toEqual([]);
      expect(rig.trainerControl()?.hasControl()).toBe(false);

      // The forget finishes in time: the hold and its sentence end together.
      held.finish();
      await unpairing;
      await flushMicrotasks(20);
      expect(rig.controller.getSnapshot().trainer.refusal).toBeUndefined();
      await rig.controller.requestTrainerControl();
      expect(opcodes(rig)).toEqual([REQUEST_CONTROL]);
      expect(rig.trainerControl()?.hasControl()).toBe(true);
      rig.controller.dispose();
    });

    // #722's review, R1: "no gap between in progress and late" is an ORDER —
    // the late set is filled inside the forget's `catch`, before the
    // `finally` empties the in-progress set and emits a snapshot. A listener
    // of THAT snapshot is the one place a gap of a single microtask shows.
    it('holds control back through a listener of the forget’s own snapshot when it runs out of time', async () => {
      const rig = twoTrainers();
      await rig.controller.pair('trainer');
      const neo = await neoPairedAsAPowerMeter(rig);
      const held = forgetHeld(rig.transport);
      const unpairing = rig.controller.unpair(neo);
      await flushMicrotasks(20);
      rig.written.length = 0;

      // Every snapshot from here asks for control at once, synchronously —
      // the fastest a screen could react. Not re-entered by its own snapshot.
      let inside = false;
      let asked = 0;
      const unsubscribe = rig.controller.subscribe(() => {
        if (inside) {
          return;
        }
        inside = true;
        asked += 1;
        void rig.controller.requestTrainerControl();
        inside = false;
      });
      held.timeOut();
      await unpairing;
      await flushMicrotasks(20);
      unsubscribe();

      // The forget's end was seen (the snapshot that empties the in-progress
      // set), and not one Request Control went out.
      expect(asked).toBeGreaterThan(0);
      expect(opcodes(rig)).toEqual([]);
      expect(rig.trainerControl()?.hasControl()).toBe(false);
      expect(rig.controller.getSnapshot().trainer.refusal).toBe(CONTROL_WAITS_FOR_FORGET);
      rig.controller.dispose();
    });

    it('a grant that lands after the forget began is not the rider’s: nothing is driven until the late call lands, and every Stop goes', async () => {
      const rig = twoTrainers({ holdControlAnswer: true });
      await rig.controller.pair('trainer');
      const neo = await neoPairedAsAPowerMeter(rig);

      // The rider asks; the machine's answer is still on the wire…
      const asking = rig.controller.requestTrainerControl();
      await flushMicrotasks(20);
      // …when the NEO's forget begins, and then the grant lands.
      const held = forgetHeld(rig.transport);
      const unpairing = rig.controller.unpair(neo);
      await flushMicrotasks(20);
      rig.deliverHeldControlAnswer();
      await asking;
      expect(rig.trainerControl()?.hasControl()).toBe(true);
      rig.written.length = 0;

      // IN PROGRESS: no target, no workout, no gradient — and a Stop goes.
      await rig.controller.setTargetPower(watts(250));
      await flushMicrotasks(20);
      expect(rig.controller.getSnapshot().trainer.refusal).toBe(TARGET_WAITS_FOR_FORGET);
      expect(rig.controller.startWorkout(twoIntervals, watts(250))).toBe(false);
      const road = rig.controller.simulationControl();
      if (road === undefined) {
        throw new Error('no simulation control');
      }
      await expect(road.setSimulationParameters({ grade: gradePercent(6) })).rejects.toBeInstanceOf(
        TargetHeldBack,
      );
      await road.letGo();
      expect(opcodes(rig)).toEqual([STOP]);

      // LATE: the bound passes and the call runs on. Still nothing, and a
      // Stop still goes.
      const late = held.timeOut();
      await unpairing;
      await flushMicrotasks(20);
      await rig.controller.setTargetPower(watts(250));
      await expect(road.setSimulationParameters({ grade: gradePercent(6) })).rejects.toBeInstanceOf(
        TargetHeldBack,
      );
      await rig.controller.clearTargetPower();
      await flushMicrotasks(20);
      expect(opcodes(rig)).toEqual([STOP, STOP]);
      expect(rig.targetOnTheTrainer()).toBeUndefined();

      // LANDED: the hold is over, and the trainer can be driven.
      late.land();
      await flushMicrotasks(20);
      expect(rig.controller.getSnapshot().trainer.refusal).toBeUndefined();
      await rig.controller.setTargetPower(watts(250));
      await flushMicrotasks(20);
      expect(opcodes(rig)).toEqual([STOP, STOP, TARGET_POWER]);
      rig.controller.dispose();
    });

    it('a refused Request Control is not asked for: control the client takes back later is held back too', async () => {
      const rig = twoTrainers({ refuseRequestControlOnce: true });
      await rig.controller.pair('trainer');
      await rig.controller.requestTrainerControl();
      expect(rig.controller.getSnapshot().trainer.refusal).toBeDefined();
      expect(rig.trainerControl()?.hasControl()).toBe(false);

      // With nothing being forgotten, the client takes control back by itself.
      rig.permissionLost();
      await flushMicrotasks(20);
      expect(rig.trainerControl()?.hasControl()).toBe(true);

      const neo = await neoPairedAsAPowerMeter(rig);
      timesOutOnce(rig.transport, 'permission');
      await rig.controller.unpair(neo);
      rig.written.length = 0;

      await rig.controller.setTargetPower(watts(250));
      await flushMicrotasks(20);
      expect(opcodes(rig)).toEqual([]);
      expect(rig.controller.getSnapshot().trainer.refusal).toBe(TARGET_WAITS_FOR_FORGET);
      rig.controller.dispose();
    });

    it('a trainer the rider asked for keeps its workout’s targets coming while a trainer is forgotten late', async () => {
      const rig = twoTrainers();
      await rig.controller.pair('trainer');
      await rig.controller.requestTrainerControl();
      await rig.controller.start();
      expect(rig.controller.startWorkout(twoIntervals, watts(250))).toBe(true);
      await ride(rig, 2);
      await flushMicrotasks(20);
      expect(rig.targetOnTheTrainer()).toBe(150);

      const neo = await neoPairedAsAPowerMeter(rig);
      timesOutOnce(rig.transport, 'permission');
      await rig.controller.unpair(neo);
      expect(rig.controller.getSnapshot().trainer.refusal).toBeUndefined();

      // The second interval's target, written by a workout tick.
      await ride(rig, 8);
      await flushMicrotasks(20);
      expect(rig.targetOnTheTrainer()).toBe(200);
      expect(rig.controller.getSnapshot().workout?.fault).toBeUndefined();
      rig.controller.dispose();
    });

    it('a workout on a trainer the rider did NOT ask for writes no new target per tick, but still eases and still stops', async () => {
      const rig = twoTrainers({
        machine: { retainsTargetsThroughStop: true, minTargetPower: watts(30) },
      });
      await rig.controller.pair('trainer');
      rig.permissionLost();
      await flushMicrotasks(20);
      expect(rig.trainerControl()?.hasControl()).toBe(true);
      await rig.controller.start();
      // Nothing is being forgotten yet, so the workout starts.
      expect(rig.controller.startWorkout(twoIntervals, watts(250))).toBe(true);
      await ride(rig, 2);
      await flushMicrotasks(20);
      expect(rig.targetOnTheTrainer()).toBe(150);

      const neo = await neoPairedAsAPowerMeter(rig);
      timesOutOnce(rig.transport, 'permission');
      await rig.controller.unpair(neo);
      rig.written.length = 0;

      // The second interval's target is held back, and the workout says why.
      await ride(rig, 8);
      await flushMicrotasks(20);
      expect(opcodes(rig)).not.toContain(TARGET_POWER);
      expect(rig.targetOnTheTrainer()).toBe(150);
      expect(rig.controller.getSnapshot().workout?.fault).toBe(TARGET_WAITS_FOR_FORGET);

      // An ease is the machine's own floor, and goes.
      await rig.controller.pause();
      await ride(rig, 2);
      await flushMicrotasks(20);
      expect(rig.written).toContainEqual([TARGET_POWER, 30, 0]);
      expect(rig.targetOnTheTrainer()).toBe(30);

      // Resumed, the interval's target is a raise and waits; paused again,
      // the floor goes again — although the machine already holds it, so it
      // is the floor itself and not "lower than now" that lets it through.
      await rig.controller.resume();
      await ride(rig, 2);
      await flushMicrotasks(20);
      expect(rig.targetOnTheTrainer()).toBe(30);
      await rig.controller.pause();
      await ride(rig, 2);
      await flushMicrotasks(20);
      expect(rig.written.filter((octets) => octets[0] === TARGET_POWER)).toEqual([
        [TARGET_POWER, 30, 0],
        [TARGET_POWER, 30, 0],
      ]);

      // And ending it sends the Stop.
      rig.controller.endWorkout();
      await flushMicrotasks(20);
      expect(stops(rig)).toBe(1);
      rig.controller.dispose();
    });

    it('a hand-set target on a trainer the rider did NOT ask for is eased for a stalling rider, and not put back', async () => {
      const rig = twoTrainers({
        machine: { retainsTargetsThroughStop: true, minTargetPower: watts(25) },
      });
      await rig.controller.pair('trainer');
      rig.permissionLost();
      await flushMicrotasks(20);
      rig.bench.rider.set({ cadence: revolutionsPerMinute(85) });
      await rig.controller.setTargetPower(watts(150));
      await ride(rig, 3);
      await flushMicrotasks(20);
      expect(rig.targetOnTheTrainer()).toBe(150);

      const neo = await neoPairedAsAPowerMeter(rig);
      timesOutOnce(rig.transport, 'permission');
      await rig.controller.unpair(neo);

      const pedalAt = async (cadences: readonly number[]): Promise<void> => {
        for (const rpm of cadences) {
          rig.bench.rider.set({ cadence: revolutionsPerMinute(rpm) });
          await ride(rig, 1);
          await flushMicrotasks(20);
        }
      };
      // The rider collapses: the rescue LOWERS the target, and that goes.
      await pedalAt([68, 66, 62, 57, 52, 47, 43, 40, 37]);
      expect(rig.targetOnTheTrainer()).toBe(100);
      // They recover: putting 150 W back is a raise, and waits.
      await pedalAt(Array.from({ length: 20 }, () => 85));
      expect(rig.targetOnTheTrainer()).toBe(100);
      expect(rig.controller.getSnapshot().trainer.refusal).toBe(TARGET_WAITS_FOR_FORGET);

      // And End ERG still sends the Stop.
      rig.written.length = 0;
      await rig.controller.clearTargetPower();
      expect(opcodes(rig)).toEqual([STOP]);
      rig.controller.dispose();
    });
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
    // The workout's own target was acknowledged before this and is not
    // written again (#542); what the pause added is one Set Target Power at
    // the floor the machine reported — no Stop, no Reset, no Request Control.
    expect(rig.written.slice(before)).toStrictEqual([[SET_TARGET_POWER, 30, 0]]);
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
    // Nothing at all: the workout's own target was acknowledged before this
    // and is not re-asserted every second since #542, and nothing eased it.
    expect(rig.written.slice(before)).toStrictEqual([]);
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

  it('records the ride anyway when the platform throws instead of rejecting', async () => {
    // The port's methods return a promise, and `.catch` on that promise is no
    // guard against a call that throws before it returns one. That throw used
    // to escape `changed()` — out of `start()` before any listener heard of
    // the ride, and out of `confirmStop()` before the ride was saved.
    const calls: string[] = [];
    const throwing: RideKeepAlivePort = {
      keepRideAlive: () => {
        calls.push('keep');
        throw new Error('RecordingService is not implemented on this platform');
      },
      letRideSleep: () => {
        calls.push('sleep');
        throw new Error('RecordingService is not implemented on this platform');
      },
    };
    const rig = benchWith({ keepAlive: throwing, rideSave: storeSavePort() });
    await rig.controller.pair('trainer');
    await rig.controller.start();
    await ride(rig, 5);
    expect(rig.controller.getSnapshot().phase).toBe('recording');
    rig.controller.armStop();
    await rig.controller.confirmStop();
    expect(rig.controller.getSnapshot().phase).toBe('stopped');
    expect(rig.controller.getSnapshot().saveState).toBe('saved');
    expect(calls).toEqual(['keep', 'sleep']);
    rig.controller.dispose();
  });

  it('asks again for a second ride started after the first was saved — #548', async () => {
    const port = recordingPort();
    const rig = benchWith({ keepAlive: port, rideSave: storeSavePort() });
    await rig.controller.pair('trainer');
    await rig.controller.start();
    await ride(rig, 3);
    rig.controller.armStop();
    await rig.controller.confirmStop();
    expect(await rig.controller.startNewRide()).toBe(true);
    // Idle between the two rides: nothing to keep alive yet.
    expect(port.calls).toEqual(['keep', 'sleep']);

    await rig.controller.start();
    expect(port.calls).toEqual(['keep', 'sleep', 'keep']);
    await ride(rig, 3);
    rig.controller.armStop();
    await rig.controller.confirmStop();
    expect(port.calls).toEqual(['keep', 'sleep', 'keep', 'sleep']);
    rig.controller.dispose();
    expect(port.calls).toEqual(['keep', 'sleep', 'keep', 'sleep']);
  });
});

describe('#782 — a joined room keeps the process alive, and the screen off does not end its socket', () => {
  function recordingPort(): RideKeepAlivePort & { readonly calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      keepRideAlive: () => {
        calls.push('keep');
        return Promise.resolve();
      },
      letRideSleep: () => {
        calls.push('sleep');
        return Promise.resolve();
      },
    };
  }

  it('holds the service while a room is joined through the room port, and lets it go on leaving', async () => {
    const port = recordingPort();
    const rig = benchWith({ keepAlive: port });
    const clock = new ManualClock();
    const room = new ScriptedRoom();
    const rooms = roomPortOver(() => room.link(), {
      timers: clock,
      now: clock.now,
      keepAlive: () => rig.controller.keepAliveForRoom(),
    });
    const connection = rooms.join({
      roomId: 'room-1',
      declaredMassKilograms: 70,
      sample: () => ({ powerWatts: 200 }),
    });
    expect(port.calls).toEqual(['keep']);
    await flush();
    room.accept();
    room.welcome(0);
    // The socket, with the screen off, is still reporting: nothing let it sleep.
    await clock.advance(60_000);
    expect(room.socket.sent.filter((m) => m.type === 'report')).toHaveLength(120);
    expect(port.calls).toEqual(['keep']);
    connection.leave();
    expect(port.calls).toEqual(['keep', 'sleep']);
    rig.controller.dispose();
  });

  it('counts a room and a recording as one service: leaving the room mid-ride does not stop it', async () => {
    const port = recordingPort();
    const rig = benchWith({ keepAlive: port });
    await rig.controller.pair('trainer');
    const release = rig.controller.keepAliveForRoom();
    await rig.controller.start();
    expect(port.calls).toEqual(['keep']);
    release();
    release();
    expect(port.calls).toEqual(['keep']);
    rig.controller.armStop();
    await rig.controller.confirmStop();
    expect(port.calls).toEqual(['keep', 'sleep']);
    rig.controller.dispose();
  });

  it('keeps a room’s service after the recording stops, until the room is left', async () => {
    const port = recordingPort();
    const rig = benchWith({ keepAlive: port });
    await rig.controller.pair('trainer');
    await rig.controller.start();
    const release = rig.controller.keepAliveForRoom();
    rig.controller.armStop();
    await rig.controller.confirmStop();
    expect(port.calls).toEqual(['keep']);
    release();
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

// --- #647: a refused keep-alive is on the ride's state -----------------------

/**
 * #647 — `quietly` used to swallow a refused keep-alive with no trace: the
 * ride recorded (#524's "degraded, not broken"), and nothing told the rider it
 * might stop with the screen off. These drive the controller with a port that
 * refuses — the way `RecordingServicePlugin.java` refuses on Android 14+ with
 * no Bluetooth permission — and read `keepAliveFailed` off the snapshot a
 * screen reads.
 */
describe('#647 — a refused keep-alive is on the ride’s state, and clears', () => {
  /** A port whose answers are scripted call by call: `true` refuses. */
  function scripted(refusals: readonly boolean[]): RideKeepAlivePort & {
    readonly calls: string[];
  } {
    const calls: string[] = [];
    let asked = 0;
    return {
      calls,
      keepRideAlive: () => {
        calls.push('keep');
        const refuse = refusals[asked] ?? false;
        asked += 1;
        return refuse
          ? Promise.reject(new Error('The Bluetooth permission is not granted'))
          : Promise.resolve();
      },
      letRideSleep: () => {
        calls.push('sleep');
        return Promise.resolve();
      },
    };
  }

  async function settled(): Promise<void> {
    for (let turn = 0; turn < 10; turn += 1) {
      await Promise.resolve();
    }
  }

  it('is false while the platform keeps the ride alive', async () => {
    const rig = benchWith({ keepAlive: scripted([false]) });
    expect(rig.controller.getSnapshot().keepAliveFailed).toBe(false);
    await rig.controller.start();
    await settled();
    expect(rig.controller.getSnapshot().keepAliveFailed).toBe(false);
    rig.controller.dispose();
  });

  it('is true once the platform refuses, and the ride records anyway', async () => {
    const rig = benchWith({ keepAlive: scripted([true]) });
    await rig.controller.start();
    await settled();
    expect(rig.controller.getSnapshot().keepAliveFailed).toBe(true);
    await rig.controller.pause();
    await rig.controller.resume();
    await ride(rig, 3);
    // A pause is not a transition, and nothing is asked per tick.
    expect(rig.controller.getSnapshot().keepAliveFailed).toBe(true);
    expect(rig.controller.getSnapshot().phase).toBe('recording');
    expect(rig.controller.getSnapshot().sampleCount).toBeGreaterThan(0);
    rig.controller.dispose();
  });

  it('is true when the port throws before it returns a promise', async () => {
    const rig = benchWith({
      keepAlive: {
        keepRideAlive: () => {
          throw new Error('RecordingService is not implemented on this platform');
        },
        letRideSleep: () => Promise.resolve(),
      },
    });
    await rig.controller.start();
    expect(rig.controller.getSnapshot().keepAliveFailed).toBe(true);
    expect(rig.controller.getSnapshot().phase).toBe('recording');
    rig.controller.dispose();
  });

  it('tells a listener when it changes, so a screen re-renders', async () => {
    const rig = benchWith({ keepAlive: scripted([true]) });
    const seen: boolean[] = [];
    rig.controller.subscribe(() => {
      seen.push(rig.controller.getSnapshot().keepAliveFailed);
    });
    await rig.controller.start();
    await settled();
    expect(seen.at(-1)).toBe(true);
    rig.controller.dispose();
  });

  it('asks again when a sensor pairs during the ride, and clears when that succeeds', async () => {
    // A rider who presses Start before pairing anything has not been asked for
    // the Bluetooth permission yet; pairing is when they are.
    const port = scripted([true, false]);
    const rig = benchWith({ keepAlive: port });
    await rig.controller.start();
    await settled();
    expect(rig.controller.getSnapshot().keepAliveFailed).toBe(true);

    await rig.controller.pair('trainer');
    await settled();
    expect(port.calls).toEqual(['keep', 'keep']);
    expect(rig.controller.getSnapshot().keepAliveFailed).toBe(false);
    rig.controller.dispose();
  });

  it('does not ask again for a pairing Forget abandoned — #718', async () => {
    // Nothing paired, so nothing was granted that could change the answer.
    const port = scripted([true, false]);
    const rig = benchWith({ keepAlive: port, holdOpenTrainer: true });
    await rig.controller.start();
    await settled();
    const pairing = rig.controller.pair('trainer');
    await flushMicrotasks(20);
    await rig.controller.unpair(TRAINER);
    rig.answerOpenTrainer();
    await pairing;
    await settled();
    expect(port.calls).toEqual(['keep']);
    expect(rig.controller.getSnapshot().keepAliveFailed).toBe(true);
    rig.controller.dispose();
  });

  it('stays true when the second ask is refused too', async () => {
    const port = scripted([true, true]);
    const rig = benchWith({ keepAlive: port });
    await rig.controller.start();
    await rig.controller.pair('trainer');
    await settled();
    expect(port.calls).toEqual(['keep', 'keep']);
    expect(rig.controller.getSnapshot().keepAliveFailed).toBe(true);
    rig.controller.dispose();
  });

  it('asks nothing extra when a sensor pairs and nothing was refused, or outside a ride', async () => {
    const port = scripted([]);
    const rig = benchWith({ devices: 'trainer+strap', keepAlive: port });
    await rig.controller.pair('trainer');
    expect(port.calls).toEqual([]);
    await rig.controller.start();
    await rig.controller.pair('heart-rate');
    await settled();
    expect(port.calls).toEqual(['keep']);
    rig.controller.dispose();
  });

  it('clears when a granted notification re-starts the service — #526', async () => {
    const port = scripted([true, false]);
    const rig = benchWith({
      keepAlive: port,
      notificationPermission: {
        notificationPermission: () => Promise.resolve('prompt'),
        askForNotificationPermission: () => Promise.resolve('granted'),
      },
    });
    await rig.controller.start();
    await settled();
    expect(port.calls).toEqual(['keep', 'keep']);
    expect(rig.controller.getSnapshot().keepAliveFailed).toBe(false);
    rig.controller.dispose();
  });

  it('is false again once the ride stops, and a late refusal does not reach the next ride', async () => {
    // Every ask hangs until the test answers it, so the first ride's refusal
    // can be delivered while the SECOND ride is in progress.
    const refusals: ((reason: Error) => void)[] = [];
    const rig = benchWith({
      keepAlive: {
        keepRideAlive: () =>
          new Promise<void>((_resolve, reject) => {
            refusals.push(reject);
          }),
        letRideSleep: () => Promise.resolve(),
      },
      rideSave: storeSavePort(),
    });
    await rig.controller.start();
    await ride(rig, 3);
    rig.controller.armStop();
    await rig.controller.confirmStop();
    expect(rig.controller.getSnapshot().phase).toBe('stopped');
    expect(rig.controller.getSnapshot().keepAliveFailed).toBe(false);

    expect(await rig.controller.startNewRide()).toBe(true);
    await rig.controller.start();
    expect(refusals).toHaveLength(2);
    // The FIRST ride's ask is refused now, with the second ride recording.
    refusals[0]?.(new Error('Android did not allow the recording service to start'));
    await settled();
    expect(rig.controller.getSnapshot().phase).toBe('recording');
    expect(rig.controller.getSnapshot().keepAliveFailed).toBe(false);
    // …and this ride's own refusal still raises it.
    refusals[1]?.(new Error('Android did not allow the recording service to start'));
    await settled();
    expect(rig.controller.getSnapshot().keepAliveFailed).toBe(true);
    rig.controller.dispose();
  });

  it('is published when the re-ask after a granted notification throws — #693’s review', async () => {
    // The first ask succeeds; the re-start after `granted` throws before it
    // returns a promise. That throw is NOT inside `changed()`, so the flag has
    // to be published — a snapshot built before it would never show it.
    let asked = 0;
    const rig = benchWith({
      keepAlive: {
        keepRideAlive: () => {
          asked += 1;
          if (asked === 1) {
            return Promise.resolve();
          }
          throw new Error('RecordingService could not be started again');
        },
        letRideSleep: () => Promise.resolve(),
      },
      notificationPermission: {
        notificationPermission: () => Promise.resolve('prompt'),
        askForNotificationPermission: () => Promise.resolve('granted'),
      },
    });
    const seen: boolean[] = [];
    rig.controller.subscribe(() => {
      seen.push(rig.controller.getSnapshot().keepAliveFailed);
    });
    await rig.controller.start();
    // A snapshot taken now is cached; only `changed()` drops it.
    expect(rig.controller.getSnapshot().keepAliveFailed).toBe(false);
    await settled();
    expect(asked).toBe(2);
    expect(rig.controller.getSnapshot().keepAliveFailed).toBe(true);
    expect(seen.at(-1)).toBe(true);
    rig.controller.dispose();
  });

  it('clears when the refused ride stops', async () => {
    const rig = benchWith({ keepAlive: scripted([true]), rideSave: storeSavePort() });
    await rig.controller.start();
    await settled();
    expect(rig.controller.getSnapshot().keepAliveFailed).toBe(true);
    await ride(rig, 3);
    rig.controller.armStop();
    await rig.controller.confirmStop();
    expect(rig.controller.getSnapshot().keepAliveFailed).toBe(false);
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

describe('a running workout owns the ERG target — #542’s review', () => {
  // ⚠️ Until #542 the workout player re-sent its target every second, which
  // silently put the workout's target back after the rider set one by hand on
  // the ERG form. #542 removed that refresh, and the hand-set target then stayed
  // on the machine for the rest of the block while the workout reported its
  // own target acknowledged — the screen and the trainer disagreeing about the
  // resistance a person is pedalling against. Measured on the review of PR
  // #574: 150 W on the machine, 200 W on the screen.
  const THRESHOLD = watts(250);
  const oneBlock = (): WorkoutRecord => ({
    id: workoutId('w1'),
    createdBy: ATHLETE_A,
    name: 'Long',
    workout: {
      name: 'Long',
      blocks: [{ kind: 'steady', seconds: seconds(120), target: thresholdShare(0.8) }],
    },
    createdAt: unixSeconds(1),
    updatedAt: unixSeconds(1),
  });

  async function inAWorkout(): Promise<Bench> {
    const rig = benchWith({ machine: { retainsTargetsThroughStop: true } });
    await rig.controller.pair('trainer');
    await rig.controller.requestTrainerControl();
    await rig.controller.start();
    expect(rig.controller.startWorkout(oneBlock(), THRESHOLD)).toBe(true);
    await ride(rig, 2);
    await flushMicrotasks();
    expect(rig.targetOnTheTrainer()).toBe(200);
    return rig;
  }

  it('refuses a target set by hand, writes nothing, and says why', async () => {
    const rig = await inAWorkout();
    const before = rig.written.length;

    await rig.controller.setTargetPower(watts(150));
    await flushMicrotasks();
    await ride(rig, 8);
    await flushMicrotasks();

    expect(rig.written.slice(before)).toStrictEqual([]);
    expect(rig.targetOnTheTrainer()).toBe(200);
    const snapshot = rig.controller.getSnapshot();
    expect(snapshot.workout).toBeDefined();
    expect(snapshot.trainer.requested).toBeUndefined();
    expect(snapshot.trainer.refusal).toMatch(/^End the workout to set a target by hand\.$/);
    rig.controller.dispose();
  });

  it('accepts a target set by hand again once the workout has ended', async () => {
    // The control: a guard that refused every hand-set target would pass the
    // test above.
    const rig = await inAWorkout();
    rig.controller.endWorkout();
    await flushMicrotasks(20);

    await rig.controller.setTargetPower(watts(150));

    expect(rig.targetOnTheTrainer()).toBe(150);
    expect(rig.controller.getSnapshot().trainer.refusal).toBeUndefined();
    rig.controller.dispose();
  });

  it('ends the workout when the rider ends ERG, with one Stop', async () => {
    // A Stop sent underneath the workout would leave its player believing its
    // target was still on the machine, and since #542 it does not write an
    // acknowledged target again.
    const rig = await inAWorkout();
    const before = rig.written.length;

    await rig.controller.clearTargetPower();
    await flushMicrotasks(20);

    const snapshot = rig.controller.getSnapshot();
    expect(snapshot.workout).toBeUndefined();
    expect(rig.written.slice(before)).toStrictEqual([[STOP_OR_PAUSE, 0x01]]);
    expect(snapshot.trainer.lost).toBeUndefined();
    expect(snapshot.trainer.hasControl).toBe(true);
    expect(snapshot.phase).toBe('recording');
    rig.controller.dispose();
  });
});

describe('#567 — a hand-set ERG target gets the workout’s stall rescue', () => {
  /**
   * `manual-erg.test.ts` proves the rescue; this proves the RIDE SCREEN feeds
   * it — the cadence the trainer reports, the clock the controller ticks, the
   * floor the machine reported — and that nothing else is left writing over
   * it. A line missing from `onMeasurement` or `tick` is green there and red
   * here.
   */
  const FLOOR = 25;

  async function manualRig() {
    const rig = benchWith({
      machine: { retainsTargetsThroughStop: true, minTargetPower: watts(FLOOR) },
    });
    await rig.controller.pair('trainer');
    await rig.controller.requestTrainerControl();
    rig.bench.rider.set({ cadence: revolutionsPerMinute(85) });
    await rig.controller.setTargetPower(watts(150));
    await ride(rig, 3);
    await flushMicrotasks();
    return rig;
  }

  async function pedalAt(rig: Bench, cadences: readonly number[]): Promise<void> {
    for (const rpm of cadences) {
      rig.bench.rider.set({ cadence: revolutionsPerMinute(rpm) });
      await ride(rig, 1);
      await flushMicrotasks(20);
    }
  }

  const PART_S = [68, 66, 62, 57, 52, 47, 43, 40, 37];
  const writesOf = (rig: Bench, opCode: number) =>
    rig.written.filter((bytes) => bytes[0] === opCode);

  it('eases a collapsing rider, with a 0x05 and no Stop, and says why on the snapshot', async () => {
    const rig = await manualRig();
    expect(rig.targetOnTheTrainer()).toBe(150);

    await pedalAt(rig, PART_S);

    expect(rig.targetOnTheTrainer()).toBe(100);
    expect(writesOf(rig, STOP_OR_PAUSE)).toStrictEqual([]);
    const trainer = rig.controller.getSnapshot().trainer;
    expect(trainer.ergRescue).toMatchObject({ target: 150, holding: 'relief' });
    // What the machine confirmed is the eased number — the screen does not
    // claim the rider's 150 W is on it.
    expect(targetSentence(trainer)).toBe('Holding 100 W.');
    rig.controller.dispose();
  });

  it('eases a stopped rider to the floor the machine reported, recording or not', async () => {
    const rig = await manualRig();
    await pedalAt(rig, [80, 60, 40, 20, 8, 5, 4]);
    expect(rig.targetOnTheTrainer()).toBe(FLOOR);
    expect(rig.controller.getSnapshot().trainer.ergRescue).toMatchObject({ holding: 'floor' });
    rig.controller.dispose();
  });

  it('puts the rider’s target back once cadence has held steady', async () => {
    const rig = await manualRig();
    await pedalAt(rig, PART_S);
    expect(rig.targetOnTheTrainer()).toBe(100);
    await pedalAt(
      rig,
      Array.from({ length: 20 }, () => 85),
    );
    expect(rig.targetOnTheTrainer()).toBe(150);
    expect(rig.controller.getSnapshot().trainer.ergRescue).toBeUndefined();
    rig.controller.dispose();
  });

  it('stops rescuing after End ERG — the release is the last write', async () => {
    const rig = await manualRig();
    await rig.controller.clearTargetPower();
    await flushMicrotasks(20);
    const before = rig.written.length;
    await pedalAt(rig, PART_S);
    expect(rig.written.slice(before)).toStrictEqual([]);
    expect(rig.controller.getSnapshot().trainer.ergRescue).toBeUndefined();
    rig.controller.dispose();
  });

  it('stops rescuing once the game sends a gradient — no 0x05 under a game ride', async () => {
    const rig = await manualRig();
    const game = rig.controller.simulationControl();
    expect(game).toBeDefined();
    await game?.setSimulationParameters({
      windSpeed: metresPerSecond(0),
      grade: gradePercent(2),
      rollingResistanceCoefficient: 0.004,
      windResistanceCoefficient: 0.51,
    });
    await flushMicrotasks(20);
    const before = rig.written.length;
    await pedalAt(rig, PART_S);
    expect(rig.written.slice(before).filter((bytes) => bytes[0] === 0x05)).toStrictEqual([]);
    rig.controller.dispose();
  });

  it('ends with control: taking control back does not revive the old target’s rescue', async () => {
    // Control lost ends a hand-set target; the rider sets one again once
    // control is back. A rescue that survived would write against a target
    // the rider has not set on this grant.
    const rig = await manualRig();
    rig.bench.device(TRAINER).script({ kind: 'control-permission-lost' });
    rig.bench.advance(seconds(1));
    await flushMicrotasks(20);
    await rig.controller.requestTrainerControl();
    await flushMicrotasks(20);
    const before = rig.written.length;
    await pedalAt(rig, PART_S);
    expect(rig.written.slice(before).filter((bytes) => bytes[0] === 0x05)).toStrictEqual([]);
    expect(rig.controller.getSnapshot().trainer.ergRescue).toBeUndefined();
    rig.controller.dispose();
  });

  it('tells the rider when the machine refuses an ease', async () => {
    const rig = benchWith({
      machine: { retainsTargetsThroughStop: true, minTargetPower: watts(FLOOR) },
      refuseTargetsBelow: 150,
    });
    await rig.controller.pair('trainer');
    await rig.controller.requestTrainerControl();
    rig.bench.rider.set({ cadence: revolutionsPerMinute(85) });
    await rig.controller.setTargetPower(watts(150));
    await ride(rig, 3);
    expect(rig.controller.getSnapshot().trainer.refusal).toBeUndefined();

    await pedalAt(rig, PART_S);
    expect(rig.targetOnTheTrainer()).toBe(150);
    expect(rig.controller.getSnapshot().trainer.refusal).toContain('refused');
    rig.controller.dispose();
  });

  it('defers a target set during a rescue, says so, and writes it once the rider is steady — PR #582 third review', async () => {
    const rig = await manualRig();
    await pedalAt(rig, PART_S);
    expect(rig.targetOnTheTrainer()).toBe(100);
    const before = writesOf(rig, 0x05).length;
    await rig.controller.setTargetPower(watts(180));
    await flushMicrotasks(20);
    // Not written: the rescue is the only writer while it lasts, and the
    // screen is not left saying "asked for 180 W — waiting".
    expect(writesOf(rig, 0x05)).toHaveLength(before);
    const trainer = rig.controller.getSnapshot().trainer;
    expect(trainer.requested).toBeUndefined();
    expect(trainer.refusal).toBeUndefined();
    expect(trainer.ergRescue).toMatchObject({ target: 150, pending: 180 });
    await pedalAt(
      rig,
      Array.from({ length: 20 }, () => 85),
    );
    expect(rig.targetOnTheTrainer()).toBe(180);
    expect(rig.controller.getSnapshot().trainer.ergRescue).toBeUndefined();
    rig.controller.dispose();
  });

  it('answers each Set the rescue holds on the snapshot, and writes nothing — #655', async () => {
    const rig = await manualRig();
    await pedalAt(rig, PART_S);
    expect(rig.targetOnTheTrainer()).toBe(100);
    expect(rig.controller.getSnapshot().trainer.ergHeld).toBeUndefined();
    const before = rig.written.length;

    await rig.controller.setTargetPower(watts(180));
    await flushMicrotasks(20);
    const first = rig.controller.getSnapshot().trainer.ergHeld;
    expect(first).toEqual({ target: 180, press: expect.any(Number) as number });

    // The same number again is a second press, and a second answer.
    await rig.controller.setTargetPower(watts(180));
    await flushMicrotasks(20);
    const second = rig.controller.getSnapshot().trainer.ergHeld;
    expect(second?.target).toBe(180);
    expect(second?.press).not.toBe(first?.press);

    // ⚠️ The answer is words, never a write: nothing at all went to the
    // trainer for either press, and the machine still holds the ease.
    expect(rig.written.slice(before)).toStrictEqual([]);
    expect(rig.targetOnTheTrainer()).toBe(100);

    // The rescue hands back and writes 180 W, so "held" is no longer true.
    await pedalAt(
      rig,
      Array.from({ length: 20 }, () => 85),
    );
    expect(rig.targetOnTheTrainer()).toBe(180);
    expect(rig.controller.getSnapshot().trainer.ergHeld).toBeUndefined();
    rig.controller.dispose();
  });

  /** A bench whose Set Target Power answers wait for the test (#758). */
  async function heldAnswerRig(): Promise<Bench> {
    const rig = benchWith({
      machine: { retainsTargetsThroughStop: true, minTargetPower: watts(FLOOR) },
      holdTargetAnswer: true,
    });
    await rig.controller.pair('trainer');
    await rig.controller.requestTrainerControl();
    await setAnswered(rig, 150);
    return rig;
  }

  /** Set `target` at a steady cadence, answering it at once. */
  async function setAnswered(rig: Bench, target: number): Promise<void> {
    rig.bench.rider.set({ cadence: revolutionsPerMinute(85) });
    const set = rig.controller.setTargetPower(watts(target));
    await flushMicrotasks(20);
    rig.deliverHeldTargetAnswers();
    await set;
    await ride(rig, 3);
    await flushMicrotasks();
  }

  /**
   * One *Set* on the wire with its answer held, a second (180 W) queued behind
   * it, and the stall beginning while both wait — #740 N4's path.
   */
  async function queuedBehindInFlight(rig: Bench): Promise<void> {
    const inFlight = rig.controller.setTargetPower(watts(160));
    await flushMicrotasks(20);
    const queued = rig.controller.setTargetPower(watts(180));
    await flushMicrotasks(20);
    await pedalAt(rig, PART_S);
    rig.deliverHeldTargetAnswers();
    await flushMicrotasks(20);
    await pedalAt(rig, [37, 37]);
    rig.deliverHeldTargetAnswers();
    await Promise.all([inFlight, queued]);
    await flushMicrotasks(20);
  }

  it('does not answer a Set that was queued behind one in flight when the rescue began — #740 N4, #758', async () => {
    // ⚠️ `answersHeld(outcome)` in the controller is the whole of N4's fix
    // there: a *Set* already waiting when the rescue began is deferred too,
    // but the rescue's own notice names it as pending, so answering it again
    // said that clause twice. Reverting it to `outcome.kind === 'deferred'`
    // left every other test green (#758).
    const rig = await heldAnswerRig();
    await queuedBehindInFlight(rig);

    const trainer = rig.controller.getSnapshot().trainer;
    // The rescue holds the queued target as pending, so the notice names it —
    expect(trainer.ergRescue).toMatchObject({ pending: 180 });
    // — and the Set is not answered with a second "held" line.
    expect(trainer.ergHeld).toBeUndefined();
    rig.controller.dispose();
  });

  it('forgets a held answer when the hand-set target ends — #655 nit, #758', async () => {
    // `held` outlived the writer it described. Nothing showed it while no
    // writer existed, but the next rescue whose pending target happened to
    // be the same number brought the old answer, and its old press, back.
    const rig = await heldAnswerRig();
    await pedalAt(rig, PART_S);
    // The ease's own answer.
    rig.deliverHeldTargetAnswers();
    await flushMicrotasks(20);
    await rig.controller.setTargetPower(watts(180));
    await flushMicrotasks(20);
    expect(rig.controller.getSnapshot().trainer.ergHeld?.target).toBe(180);

    await rig.controller.clearTargetPower();
    await flushMicrotasks(20);
    await setAnswered(rig, 150);
    await queuedBehindInFlight(rig);

    const trainer = rig.controller.getSnapshot().trainer;
    expect(trainer.ergRescue).toMatchObject({ pending: 180 });
    expect(trainer.ergHeld).toBeUndefined();
    rig.controller.dispose();
  });

  it('answers a Set outside a rescue with no held answer — #655', async () => {
    const rig = await manualRig();
    await rig.controller.setTargetPower(watts(170));
    await flushMicrotasks(20);
    expect(rig.targetOnTheTrainer()).toBe(170);
    expect(rig.controller.getSnapshot().trainer.ergHeld).toBeUndefined();
    rig.controller.dispose();
  });

  it('forgets a rescue when the trainer is unpaired', async () => {
    const rig = await manualRig();
    await pedalAt(rig, PART_S);
    expect(rig.controller.getSnapshot().trainer.ergRescue).toBeDefined();
    await rig.controller.unpair(TRAINER);
    expect(rig.controller.getSnapshot().trainer.ergRescue).toBeUndefined();
    rig.controller.dispose();
  });

  it('stops rescuing once a workout takes the control point', async () => {
    const rig = await manualRig();
    await rig.controller.start();
    expect(
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
      ),
    ).toBe(true);
    await ride(rig, 2);
    await flushMicrotasks(20);
    expect(rig.targetOnTheTrainer()).toBe(200);
    // A collapse now is the WORKOUT's to rescue: two thirds of its 200 W, not
    // two thirds of the old hand-set 150 W, which a rescue left running would
    // write over it.
    await pedalAt(rig, PART_S);
    expect(rig.targetOnTheTrainer()).toBe(133);
    expect(rig.controller.getSnapshot().trainer.ergRescue).toBeUndefined();
    rig.controller.dispose();
  });
});

describe('#1042 — the saved ride the result card states, and the game’s outcome it carries', () => {
  it('states the activity the save WROTE, and nothing for a save that failed', async () => {
    const written: NewActivity[] = [];
    const { port } = savePort({
      putActivity: (record) => {
        written.push(record);
        return Promise.resolve(record.id);
      },
    });
    const rig = benchWith({ rideSave: port });
    await rig.controller.pair('trainer');
    await rig.controller.start();
    await ride(rig, 3);
    rig.controller.armStop();
    await rig.controller.confirmStop();

    const saved = rig.controller.getSnapshot().savedRide;
    const record = written[0]!;
    expect(saved).toEqual({
      activityId: 'saved-ride',
      elapsedTime: record.elapsedTime,
      distance: record.distance,
      averagePower: record.averagePower,
      // The bench's trainer reports no heart rate, so there is none to state.
      averageHeartRate: undefined,
      gameOutcome: undefined,
    });
    rig.controller.dispose();

    const { port: refusing } = savePort({
      putStreamSet: () => Promise.reject(new Error('the device is full')),
    });
    const failing = benchWith({ rideSave: refusing });
    await failing.controller.pair('trainer');
    await failing.controller.start();
    await ride(failing, 3);
    failing.controller.armStop();
    await failing.controller.confirmStop();
    expect(failing.controller.getSnapshot().saveState).toBe('failed');
    expect(failing.controller.getSnapshot().savedRide).toBeUndefined();
    failing.controller.dispose();
  });

  it('states the mean of the heart rate the ride actually recorded', async () => {
    const streams: NewStreamSet[] = [];
    const { port } = savePort({
      putStreamSet: (set) => {
        streams.push(set);
        return Promise.resolve(set.activityId);
      },
    });
    const rig = benchWith({ rideSave: port, devices: 'trainer+strap' });
    await rig.controller.pair('trainer');
    await rig.controller.pair('heart-rate');
    await rig.controller.start();
    await ride(rig, 4);
    rig.controller.armStop();
    await rig.controller.confirmStop();

    // Computed here by hand from the samples the save wrote, holes left out.
    const readings = (streams[0]?.channels.heartRate ?? []).filter(
      (sample): sample is NonNullable<typeof sample> => sample !== undefined,
    );
    expect(readings.length).toBeGreaterThan(0);
    const mean = Math.round(readings.reduce((sum, each) => sum + each, 0) / readings.length);
    expect(rig.controller.getSnapshot().savedRide?.averageHeartRate).toBe(mean);
    rig.controller.dispose();
  });

  it('drops a game outcome handed over while nothing is recording', async () => {
    const rig = benchWith({ rideSave: storeSavePort() });
    await rig.controller.pair('trainer');
    // A game ride with no recording under it is saved nowhere: a recording
    // started afterwards rode no game, and must not claim one.
    rig.controller.noteGameRideEnded('beaten');
    await recordAndStop(rig, 2);
    expect(rig.controller.getSnapshot().savedRide?.gameOutcome).toBeUndefined();
    rig.controller.dispose();
  });

  it('keeps the last game ride’s latched outcome for the recording it was ridden in', async () => {
    const rig = benchWith({ rideSave: storeSavePort() });
    await rig.controller.pair('trainer');
    // Before a recording: there is nothing to attach it to, so it is dropped.
    rig.controller.noteGameRideEnded('beaten');
    await rig.controller.start();
    await ride(rig, 2);
    rig.controller.noteGameRideEnded('not-beaten');
    await rig.controller.pause();
    // Paused is still a recording in progress; the LAST game ride's answer wins.
    rig.controller.noteGameRideEnded('level');
    await rig.controller.resume();
    await ride(rig, 1);
    rig.controller.armStop();
    await rig.controller.confirmStop();
    expect(rig.controller.getSnapshot().savedRide?.gameOutcome).toBe('level');

    // Stopped: a game ride ended now belongs to no recording.
    rig.controller.noteGameRideEnded('beaten');
    expect(rig.controller.getSnapshot().savedRide?.gameOutcome).toBe('level');

    // A new ride starts with no game ridden in it.
    expect(await rig.controller.startNewRide()).toBe(true);
    expect(rig.controller.getSnapshot().savedRide).toBeUndefined();
    await recordAndStop(rig, 2);
    expect(rig.controller.getSnapshot().savedRide?.activityId).toBe('ride-2');
    expect(rig.controller.getSnapshot().savedRide?.gameOutcome).toBeUndefined();
    rig.controller.dispose();
  });
});
