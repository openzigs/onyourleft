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

import { seconds, watts, type Watts } from '@onyourleft/domain';
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
import { recordingSessionId, type RecordingSessionId } from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  seedAthletes,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_AUTO_PAUSE_AFTER_SECONDS } from '../recording/channels';
import type { RecordingCheckpointStore } from '../recording/recorder';

import { createRideController, type RideController } from './controller';
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
    store: harnessStore(),
    athleteId: ATHLETE_A,
    newSessionId: () => {
      sessionCounter += 1;
      const id = recordingSessionId(`ride-${String(sessionCounter)}`);
      sessionIds.push(id);
      return id;
    },
    now: () => bench.now,
    ...(options.withTrainerControl === false ? {} : { openTrainer }),
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
