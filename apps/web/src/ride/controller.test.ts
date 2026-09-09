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
 * share an arithmetic mistake cancel it out invisibly.
 */

import {
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
  type TrainerControl,
} from '@onyourleft/sensors/protocol';
import {
  createSimulator,
  ftmsTrainer,
  hrsStrap,
  FITNESS_MACHINE_STATUS_OP_CODE,
  FTMS_CONTROL_OP_CODE,
  FTMS_RESULT_CODE,
  type FitnessMachineStatus,
  type FtmsControlRequest,
  type FtmsControlResponse,
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
  createRideController,
  PAIRING_ROLE_CAPABILITIES,
  type RideController,
  type RideSavePort,
} from './controller';
import { METRIC_STALE_AFTER_SECONDS } from './metrics';
import type { OpenTrainer, TrainerConnection } from './trainer';

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

// --- The bridge: the simulator's typed control point, as octets --------------

const viewOf = (bytes: readonly number[]): DataView => {
  const array = Uint8Array.from(bytes);
  return new DataView(array.buffer, array.byteOffset, array.byteLength);
};

const int16 = (raw: number): [number, number] => {
  const unsigned = raw < 0 ? raw + 0x1_0000 : raw;
  return [unsigned & 0xff, (unsigned >>> 8) & 0xff];
};

const readInt16 = (bytes: Uint8Array, at: number): number => {
  const low = bytes[at] ?? 0;
  const high = bytes[at + 1] ?? 0;
  const unsigned = low | (high << 8);
  return unsigned > 0x7fff ? unsigned - 0x1_0000 : unsigned;
};

/** FTMS Tables 4.15 and 4.20, with literal offsets. */
function requestFromOctets(bytes: Uint8Array): FtmsControlRequest {
  switch (bytes[0]) {
    case 0x00:
      return { opCode: 'request-control' };
    case 0x01:
      return { opCode: 'reset' };
    case 0x05:
      return { opCode: 'set-target-power', target: watts(readInt16(bytes, 1)) };
    case 0x08:
      return { opCode: 'stop-or-pause', stop: bytes[1] === 0x01 };
    default:
      throw new Error(`the bridge does not encode op code ${String(bytes[0])}`);
  }
}

/** FTMS Table 4.23. */
const responseToOctets = (response: FtmsControlResponse): DataView =>
  viewOf([0x80, FTMS_CONTROL_OP_CODE[response.requestOpCode], FTMS_RESULT_CODE[response.result]]);

/** FTMS Table 4.26. */
function statusToOctets(status: FitnessMachineStatus): DataView {
  const op = FITNESS_MACHINE_STATUS_OP_CODE[status.kind];
  switch (status.kind) {
    case 'target-power-changed':
      return viewOf([op, ...int16(status.target)]);
    case 'target-resistance-changed':
      return viewOf([op, Math.round(status.level * 10)]);
    default:
      return viewOf([op]);
  }
}

interface Bench {
  readonly controller: RideController;
  readonly bench: SimulatorBench;
  readonly trainerControl: () => TrainerControl | undefined;
  /** What the trainer itself is holding, read from the device. */
  readonly targetOnTheTrainer: () => Watts | undefined;
  readonly sessionIds: RecordingSessionId[];
}

interface BenchOptions {
  readonly devices?: 'trainer' | 'trainer+strap' | 'strap';
  readonly withTrainerControl?: boolean;
  /** Never answer a control point write, so a procedure stays outstanding. */
  readonly silentTrainer?: boolean;
  /** Give the controller somewhere to save a finished ride. See #14's fourth criterion. */
  readonly rideSave?: RideSavePort | undefined;
  /** Break one checkpoint-store operation, for the failure paths review found. */
  readonly checkpointStore?: Partial<RecordingCheckpointStore>;
}

function benchWith(options: BenchOptions = {}): Bench {
  const which = options.devices ?? 'trainer';
  const { transport, bench } = createSimulator({
    devices: [
      ...(which === 'strap' ? [] : [ftmsTrainer({ id: 'kickr', name: 'KICKR 1F2A' })]),
      ...(which === 'trainer+strap' || which === 'strap'
        ? [hrsStrap({ id: 'strap', name: 'HRM 04B1' })]
        : []),
    ],
  });

  let control: TrainerControl | undefined;
  const sessionIds: RecordingSessionId[] = [];

  const openTrainer: OpenTrainer = (id) => {
    const handle = bench.device(id);
    const controlPoint = handle.controlPoint;
    const ranges = handle.supportedRanges;
    if (controlPoint === undefined || ranges === undefined) {
      return Promise.resolve(undefined);
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
          onStatus: (listener) =>
            controlPoint.onStatus((status) => listener(statusToOctets(status))),
          writeControlPoint: (value) => {
            const outcome = controlPoint.write(requestFromOctets(value));
            if (outcome.kind === 'att-error') {
              return Promise.reject(new Error(outcome.error));
            }
            if (options.silentTrainer !== true) {
              // The simulator delivers the indication on its next tick.
              bench.advance(seconds(1));
            }
            return Promise.resolve();
          },
        },
        { powerRange, reacquireControl: false },
      ),
      canSetPower: true,
      canSimulate: true,
      powerRange,
    };
    control = connection.control;
    return Promise.resolve(connection);
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
  });

  return {
    controller,
    bench,
    sessionIds,
    trainerControl: () => control,
    targetOnTheTrainer: () => bench.device(TRAINER).inspect().ftms?.targetPower,
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

describe('ending ERG by hand — the "End ERG" button', () => {
  it('takes the trainer out of ERG without ending the ride', async () => {
    const rig = benchWith();
    await rig.controller.pair('trainer');
    await rig.controller.start();
    await rig.controller.requestTrainerControl();
    await rig.controller.setTargetPower(watts(210));
    expect(rig.targetOnTheTrainer()).toBe(210);

    await rig.controller.clearTargetPower();

    // Read from the device, not from the client that asked: the machine is no
    // longer holding a target.
    expect(rig.targetOnTheTrainer()).toBeUndefined();
    expect(rig.controller.getSnapshot().trainer.target).toEqual({ kind: 'none' });
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
    const rig = benchWith();
    await rig.controller.pair('trainer');
    await rig.controller.start();
    await rig.controller.requestTrainerControl();
    await rig.controller.setTargetPower(watts(220));
    expect(rig.targetOnTheTrainer()).toBe(220);

    rig.controller.armStop();
    await rig.controller.confirmStop();

    // The machine is no longer holding a target. A ride that ended with the
    // trainer still applying 220 W leaves a rider pushing against something
    // nothing on screen is showing.
    expect(rig.targetOnTheTrainer()).toBeUndefined();
    expect(rig.controller.getSnapshot().phase).toBe('stopped');
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
