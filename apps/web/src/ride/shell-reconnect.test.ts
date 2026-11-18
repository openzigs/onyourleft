// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Android shell reconnecting to remembered sensors — #2669, through the
 * path the app takes and nothing narrower.
 *
 * ⚠️ **Everything here is the production code but the Capacitor plugin at the
 * bottom.** The controller is `createShellRideController`'s, the transport is
 * `@onyourleft/mobile`'s Capacitor transport, the trainer is opened by
 * `openCapacitorTrainer` over the mobile package's own FTMS reads and channel,
 * and the memory is `remembered-sensors.ts` over a storage both "sessions"
 * share — so an app restart is a second controller, transport and plugin over
 * the same device storage, and nothing in the first survives into it but what
 * that storage holds. The plugin is `@onyourleft/mobile/testing`'s scripted
 * port, which refuses every call before `initialize` as the real one does.
 *
 * The trainer-safety cases read `ScriptedPort.writes` — every byte written to
 * the trainer's control point — because the claim is about what reaches the
 * machine, and a test of the controller's own state would pass over a client
 * that wrote and then reported nothing.
 */

import { seconds, thresholdShare, unixSeconds, watts } from '@onyourleft/domain';
import {
  createCapacitorFitnessMachineChannel,
  createCapacitorTransport,
  readCapacitorFitnessMachine,
  readCapacitorResolvedUuids,
  recordingServiceKeepAlive,
  recordingServiceNotificationPermission,
  type RecordingServicePlugin,
} from '@onyourleft/mobile';
import { scriptedPort, type ScriptedPort, type ScriptedStack } from '@onyourleft/mobile/testing';
import {
  createIndoorBikeDataProfile,
  FITNESS_MACHINE_CONTROL_POINT,
  FITNESS_MACHINE_FEATURE,
  FITNESS_MACHINE_SERVICE,
  INDOOR_BIKE_DATA,
  SUPPORTED_POWER_RANGE,
} from '@onyourleft/sensors/protocol';
import { athleteId, recordingSessionId, workoutId } from '@onyourleft/store';
import { describe, expect, it } from 'vitest';

import type { RideController } from './controller';
import { CARRY_ON_NOTICE_SECONDS, RECONNECT_BACKOFF_SECONDS } from './controller';
import { CARRY_ON_RAMP_SECONDS } from '../workout/session';
import {
  createRememberedSensors,
  transportSeed,
  type RememberedSensorStorage,
} from './remembered-sensors';
import { createShellRideController } from './shell-ride-controller';
import { openCapacitorTrainer } from './trainer';

const KICKR = { deviceId: 'C4:7C:8D:6A:00:02', name: 'KICKR 1F2A' } as const;

/** 0 W to 2000 W in 5 W steps, as a trainer reports it. */
const POWER_RANGE = new DataView(Uint8Array.from([0, 0, 0xd0, 0x07, 5, 0]).buffer);
/** Power target and simulation supported (bits 3 and 13 of the second field). */
const FEATURES = new DataView(Uint8Array.from([0x82, 0, 0, 0, 0x08, 0x20, 0, 0]).buffer);
/** Indoor Bike Data: speed 10.00 km/h and 200 W (flags bit 6). */
const TWO_HUNDRED_WATTS = new DataView(
  Uint8Array.from([0x40, 0x00, 0xe8, 0x03, 0xc8, 0x00]).buffer,
);
/** Indoor Bike Data: speed 10.00 km/h, cadence 90 rpm and 150 W (flags bits 2 and 6). */
const PEDALLING = new DataView(
  Uint8Array.from([0x44, 0x00, 0xe8, 0x03, 0xb4, 0x00, 0x96, 0x00]).buffer,
);
/** Indoor Bike Data: the same fields with the cranks still — 0 rpm, 0 W. */
const CRANKS_STILL = new DataView(
  Uint8Array.from([0x44, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]).buffer,
);

/** The device's own storage, shared by every "session" of one test. */
function deviceStorage(): RememberedSensorStorage {
  const rows = new Map<string, string>();
  return {
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => void rows.set(key, value),
    removeItem: (key) => void rows.delete(key),
  };
}

/**
 * A scripted plugin whose trainer answers every control point write with
 * Success, as a trainer that grants control does — so a test can take control
 * and set a target before the link drops, and read what comes after.
 */
function answeringTrainer(
  stack: ScriptedStack,
  /** Answer the Nth Request Control (`0x00`), and only that one, with Control Not Permitted. */
  refuseControlAt?: number,
): ScriptedPort {
  let controlRequests = 0;
  const port = scriptedPort({
    reads: {
      [`${FITNESS_MACHINE_SERVICE}|${SUPPORTED_POWER_RANGE}`]: POWER_RANGE,
      [`${FITNESS_MACHINE_SERVICE}|${FITNESS_MACHINE_FEATURE}`]: FEATURES,
    },
    ...stack,
  });
  const recorded = port.write.bind(port);
  return Object.assign(port, {
    write: async (
      id: string,
      service: string,
      characteristic: string,
      value: DataView,
    ): Promise<void> => {
      await recorded(id, service, characteristic, value);
      if (characteristic === FITNESS_MACHINE_CONTROL_POINT) {
        const opCode = value.getUint8(0);
        if (opCode === 0x00) {
          controlRequests += 1;
        }
        const refused = opCode === 0x00 && controlRequests === refuseControlAt;
        queueMicrotask(() => {
          port.notify(
            FITNESS_MACHINE_SERVICE,
            FITNESS_MACHINE_CONTROL_POINT,
            new DataView(Uint8Array.from([0x80, opCode, refused ? 0x05 : 0x01]).buffer),
          );
        });
      }
    },
  });
}

/** One opening of the app: the shell's controller, as `main.tsx` builds it. */
function openApp(
  device: RememberedSensorStorage,
  stack: ScriptedStack = {},
  /** Hold ONE device's connect until this settles; every other answers at once. */
  hold?: { readonly id: string; readonly until: Promise<void> },
  refuseControlAt?: number,
) {
  let clock = unixSeconds(1_757_000_000);
  const plugin = answeringTrainer(stack, refuseControlAt);
  if (hold !== undefined) {
    const connect = plugin.connect.bind(plugin);
    plugin.connect = async (id, disconnected) => {
      if (id === hold.id) {
        await hold.until;
      }
      return connect(id, disconnected);
    };
  }
  const remembered = createRememberedSensors(device);
  const transport = createCapacitorTransport({
    plugin,
    profiles: [createIndoorBikeDataProfile()],
    now: () => clock,
    remembered: transportSeed(remembered),
  });
  const service: RecordingServicePlugin = {
    start: async () => Promise.resolve(),
    stop: async () => Promise.resolve(),
    notificationPermission: async () => Promise.resolve({ state: 'granted' }),
    requestNotificationPermission: async () => Promise.resolve({ state: 'granted' }),
  };
  const controller = createShellRideController(
    {
      capacitorRecordingServicePlugin: () => service,
      recordingServiceKeepAlive,
      recordingServiceNotificationPermission,
    },
    {
      transport,
      store: {
        putRecordingSession: async (record) => Promise.resolve(record.id),
        appendRecordingChunk: async () => Promise.resolve(0),
        readRecordingSessions: async () => Promise.resolve({ sessions: [], unreadable: [] }),
        recoverRecording: async () => Promise.resolve(undefined),
        deleteRecordingSession: async () => Promise.resolve(false),
      },
      athleteId: athleteId('shell'),
      newSessionId: () => recordingSessionId('shell-ride'),
      now: () => clock,
      openTrainer: openCapacitorTrainer({
        readMachine: async (id) => readCapacitorFitnessMachine(plugin, id),
        openChannel: (id) => createCapacitorFitnessMachineChannel(plugin, id),
        resolvedUuids: async (id) => readCapacitorResolvedUuids(plugin, id),
      }),
      remembered,
    },
  );
  return {
    plugin,
    controller,
    remembered,
    /** Move the controller's clock on by `by` seconds and tick it. */
    advance: async (by: number): Promise<void> => {
      clock = unixSeconds(clock + by);
      await controller.tick(clock);
      await settle();
    },
  };
}

/** Let the plugin's answers and the controller's awaits run out. */
async function settle(): Promise<void> {
  for (let index = 0; index < 40; index += 1) {
    await Promise.resolve();
  }
}

/** The writes that reached the trainer's control point, as opcodes. */
function controlPointOpcodes(plugin: ScriptedPort, from = 0): number[] {
  return plugin.writes
    .slice(from)
    .filter((write) => write.characteristic === FITNESS_MACHINE_CONTROL_POINT)
    .map((write) => write.value.getUint8(0));
}

/** Pair the trainer through the chooser, in the first session. */
async function pairTrainer(app: ReturnType<typeof openApp>): Promise<void> {
  await app.controller.pair('trainer');
  await settle();
  expect(app.controller.getSnapshot().sensors.map((s) => `${s.name}: ${s.state}`)).toEqual([
    `${KICKR.name}: connected`,
  ]);
}

function power(controller: RideController): unknown {
  return controller.getSnapshot().metrics.find((metric) => metric.id === 'power')?.state;
}

describe('#2669 — after the app is closed and opened again', () => {
  it('reconnects the remembered trainer with no chooser, and the ride receives its data', async () => {
    const device = deviceStorage();
    const first = openApp(device, { chooses: KICKR });
    await pairTrainer(first);
    first.controller.dispose();

    // A new app: a new plugin that would REFUSE a chooser, so a reconnect that
    // went through one fails here rather than passing.
    const second = openApp(device, { chooserRejectsWith: new Error('requestDevice cancelled.') });
    await settle();

    expect(second.plugin.calls).not.toContain('requestDevice');
    expect(second.controller.getSnapshot().sensors).toMatchObject([
      { name: KICKR.name, role: 'trainer', state: 'connected' },
    ]);
    second.plugin.notify(FITNESS_MACHINE_SERVICE, INDOOR_BIKE_DATA, TWO_HUNDRED_WATTS);
    expect(power(second.controller)).toMatchObject({ kind: 'live', value: 200 });
    second.controller.dispose();
  });

  it('asks the trainer for nothing as it comes back: no control, no target', async () => {
    const device = deviceStorage();
    const first = openApp(device, { chooses: KICKR });
    await pairTrainer(first);
    await first.controller.requestTrainerControl();
    await first.controller.setTargetPower(watts(250));
    await settle();
    // The control: this rig does reach the machine when the rider asks.
    expect(controlPointOpcodes(first.plugin)).toEqual([0x00, 0x05]);
    first.controller.dispose();

    const second = openApp(device);
    await settle();
    expect(second.controller.getSnapshot().sensors[0]?.state).toBe('connected');
    expect(second.controller.getSnapshot().trainer.hasControl).toBe(false);
    expect(controlPointOpcodes(second.plugin)).toEqual([]);
  });

  it('does not reconnect a sensor the rider forgot', async () => {
    const device = deviceStorage();
    const first = openApp(device, { chooses: KICKR });
    await pairTrainer(first);
    const [paired] = first.controller.getSnapshot().sensors;
    if (paired === undefined) throw new Error('nothing paired');
    await first.controller.unpair(paired.id);
    await settle();
    first.controller.dispose();

    const second = openApp(device);
    await settle();
    expect(second.controller.getSnapshot().sensors).toEqual([]);
  });

  it('lists a remembered sensor that is not there yet as reconnecting, and tries again on the backoff', async () => {
    const device = deviceStorage();
    const first = openApp(device, { chooses: KICKR });
    await pairTrainer(first);
    first.controller.dispose();

    // The trainer is still asleep: every connect is refused.
    const second = openApp(device, { connectRejectsWith: new Error('Connection timeout.') });
    await settle();
    expect(second.controller.getSnapshot().sensors).toMatchObject([
      { name: KICKR.name, state: 'reconnecting' },
    ]);
    const connects = (): number =>
      second.plugin.calls.filter((call) => call.startsWith('connect:')).length;
    expect(connects()).toBe(1);

    // The try as the app opened was the first; the next waits the second
    // step of the backoff — not before it is up, and once when it is.
    const [, nextWait = 0, waitAfter = 0] = RECONNECT_BACKOFF_SECONDS;
    await second.advance(nextWait - 1);
    expect(connects()).toBe(1);
    await second.advance(1);
    expect(connects()).toBe(2);
    // The wait after that is longer.
    await second.advance(nextWait);
    expect(connects()).toBe(2);
    await second.advance(waitAfter - nextWait);
    expect(connects()).toBe(3);
    second.controller.dispose();
  });

  it('connects each remembered sensor once when a tick lands while the first connect is still held', async () => {
    const device = deviceStorage();
    const first = openApp(device, { chooses: KICKR });
    await pairTrainer(first);
    first.controller.dispose();
    // A second trainer, so that a try made twice is seen in what it
    // subscribes to and in the trainer it opens, not only in its connect.
    const strap = 'C4:7C:8D:6A:01:01';
    createRememberedSensors(device).remember({
      id: strap as never,
      name: 'KICKR 2B3C',
      role: 'trainer',
    });

    // Both are listed at once; the trainer's connect is held, as a slow
    // link is, so the one-second tick lands while `restoreRemembered` is
    // still waiting on it and finds the strap due.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const second = openApp(device, {}, { id: KICKR.deviceId, until: held });
    await settle();
    await second.advance(1);
    release();
    await settle();
    await second.advance(0);

    const connects = (id: string): number =>
      second.plugin.calls.filter((call) => call === `connect:${id}`).length;
    expect(connects(strap)).toBe(1);
    expect(connects(KICKR.deviceId)).toBe(1);
    const count = (prefix: string): number =>
      second.plugin.calls.filter((call) => call.startsWith(prefix)).length;
    // One Indoor Bike Data subscription and one Feature read per trainer.
    expect(count('startNotifications:')).toBe(4);
    expect(count(`read:${FITNESS_MACHINE_SERVICE}|${FITNESS_MACHINE_FEATURE}`)).toBe(2);
    second.controller.dispose();
  });

  it('lists no more remembered sensors than the connection budget holds', async () => {
    const device = deviceStorage();
    const memory = createRememberedSensors(device);
    for (let n = 1; n <= 5; n += 1) {
      memory.remember({
        id: `C4:7C:8D:6A:01:0${String(n)}` as never,
        name: `Strap ${String(n)}`,
        role: 'heart-rate',
      });
    }
    const app = openApp(device);
    await settle();
    expect(app.controller.getSnapshot().sensors.map((sensor) => sensor.name)).toEqual([
      'Strap 1',
      'Strap 2',
      'Strap 3',
    ]);
    app.controller.dispose();
  });
});

describe('#2669 — a link that drops mid-ride comes back by itself', () => {
  it('reconnects on the backoff, says so meanwhile, and the readings return', async () => {
    const app = openApp(deviceStorage(), { chooses: KICKR });
    await pairTrainer(app);
    await app.controller.start();

    app.plugin.dropLink();
    await settle();
    expect(app.controller.getSnapshot().sensors[0]?.state).toBe('reconnecting');

    await app.advance(RECONNECT_BACKOFF_SECONDS[0] ?? 0);
    expect(app.controller.getSnapshot().sensors[0]?.state).toBe('connected');
    app.plugin.notify(FITNESS_MACHINE_SERVICE, INDOOR_BIKE_DATA, TWO_HUNDRED_WATTS);
    expect(power(app.controller)).toMatchObject({ kind: 'live', value: 200 });
    app.controller.dispose();
  });

  it('writes nothing to the trainer as it comes back, though it held control and a target', async () => {
    const app = openApp(deviceStorage(), { chooses: KICKR });
    await pairTrainer(app);
    await app.controller.requestTrainerControl();
    await app.controller.setTargetPower(watts(250));
    await settle();
    expect(controlPointOpcodes(app.plugin)).toEqual([0x00, 0x05]);
    const before = app.plugin.writes.length;

    app.plugin.dropLink();
    await settle();
    await app.advance(RECONNECT_BACKOFF_SECONDS[0] ?? 0);
    expect(app.controller.getSnapshot().sensors[0]?.state).toBe('connected');
    // Several ticks on, with the ride's clock running: still nothing.
    for (let tick = 0; tick < 5; tick += 1) {
      await app.advance(1);
    }

    expect(controlPointOpcodes(app.plugin, before)).toEqual([]);
    expect(app.controller.getSnapshot().trainer.hasControl).toBe(false);

    // And control comes back only when the rider asks, on the new link.
    await app.controller.requestTrainerControl();
    await settle();
    expect(controlPointOpcodes(app.plugin, before)).toEqual([0x00]);
    expect(app.controller.getSnapshot().trainer.hasControl).toBe(true);
    app.controller.dispose();
  });

  it('runs one try at a time, and a try outlived by Forget and Pair leaves the new pairing alone', async () => {
    const app = openApp(deviceStorage(), { chooses: KICKR });
    await pairTrainer(app);
    // The next connect waits for the test, as a slow radio does.
    let release: () => void = () => undefined;
    let hold: Promise<void> | undefined = new Promise<void>((resolve) => {
      release = resolve;
    });
    let connects = 0;
    const connect = app.plugin.connect.bind(app.plugin);
    app.plugin.connect = async (id, disconnected) => {
      connects += 1;
      const waiting = hold;
      hold = undefined;
      if (waiting !== undefined) await waiting;
      return connect(id, disconnected);
    };
    app.plugin.dropLink();
    await settle();
    await app.advance(RECONNECT_BACKOFF_SECONDS[0] ?? 0);
    expect(connects).toBe(1);
    // Ticks while that try is in flight start no second one.
    await app.advance(60);
    expect(connects).toBe(1);
    const [sensor] = app.controller.getSnapshot().sensors;
    if (sensor === undefined) throw new Error('nothing listed');

    // Forget, and pair the same trainer again, while that try is in flight.
    await app.controller.unpair(sensor.id);
    await app.controller.pair('trainer');
    await settle();
    expect(app.controller.getSnapshot().sensors[0]?.state).toBe('connected');
    const disconnects = (): number =>
      app.plugin.calls.filter((call) => call.startsWith('disconnect:')).length;
    const before = disconnects();

    // The old try lands now. It must not cut the new pairing's link.
    release();
    await settle();
    expect(disconnects()).toBe(before);
    expect(app.controller.getSnapshot().sensors.map((one) => one.state)).toEqual(['connected']);
    app.controller.dispose();
  });

  it('stops trying, and forgets it, when the rider presses Forget while it is reconnecting', async () => {
    const device = deviceStorage();
    const app = openApp(device, { chooses: KICKR });
    await pairTrainer(app);
    app.plugin.dropLink();
    await settle();
    const [sensor] = app.controller.getSnapshot().sensors;
    if (sensor === undefined) throw new Error('nothing listed');

    await app.controller.unpair(sensor.id);
    await settle();
    const connects = app.plugin.calls.filter((call) => call.startsWith('connect:')).length;
    await app.advance(60);

    expect(app.controller.getSnapshot().sensors).toEqual([]);
    expect(app.plugin.calls.filter((call) => call.startsWith('connect:')).length).toBe(connects);
    expect(createRememberedSensors(device).list()).toEqual([]);
    app.controller.dispose();
  });
});

/** A 600 s block at 0.8 of 250 W: the workout's own target is 200 W. */
const LONG_WORKOUT = {
  id: workoutId('w1'),
  createdBy: athleteId('shell'),
  name: 'Long',
  workout: {
    name: 'Long',
    blocks: [{ kind: 'steady' as const, seconds: seconds(600), target: thresholdShare(0.8) }],
  },
  createdAt: unixSeconds(1),
  updatedAt: unixSeconds(1),
};

/** `0x05` Set Target Power writes since `from`, in watts (sint16 LE, 1 W). */
function targetsWritten(plugin: ScriptedPort, from = 0): number[] {
  return plugin.writes
    .slice(from)
    .filter(
      (write) =>
        write.characteristic === FITNESS_MACHINE_CONTROL_POINT && write.value.getUint8(0) === 0x05,
    )
    .map((write) => write.value.getInt16(1, true));
}

/**
 * Pair, take control, start the ride and the workout, ride a second of it (its
 * 200 W reaches the machine), then drop the link and let the first try bring
 * the trainer back. Returns the write count at the drop.
 */
async function workoutAcrossADrop(app: ReturnType<typeof openApp>): Promise<number> {
  await pairTrainer(app);
  await app.controller.requestTrainerControl();
  await settle();
  await app.controller.start();
  expect(app.controller.startWorkout(LONG_WORKOUT, watts(250))).toBe(true);
  app.plugin.notify(FITNESS_MACHINE_SERVICE, INDOOR_BIKE_DATA, PEDALLING);
  await app.advance(1);
  // The control: the workout's own target reached the machine before the drop.
  expect(targetsWritten(app.plugin)).toEqual([200]);
  const before = app.plugin.writes.length;

  app.plugin.dropLink();
  await settle();
  expect(app.controller.getSnapshot().workout).toMatchObject({
    status: 'paused',
    carryOn: 'reconnecting',
  });
  await app.advance(RECONNECT_BACKOFF_SECONDS[0] ?? 0);
  expect(app.controller.getSnapshot().sensors[0]?.state).toBe('connected');
  return before;
}

describe('#2669 — a workout carries on once its trainer is back and the rider pedals', () => {
  it('writes nothing before pedalling, then takes control, ramps up, and holds the block’s target', async () => {
    const app = openApp(deviceStorage(), { chooses: KICKR });
    const before = await workoutAcrossADrop(app);
    const elapsed = app.controller.getSnapshot().workout?.elapsedSeconds;

    // Back, and the rider not pedalling yet: ticks, and a reading with the
    // cranks still, reach the machine with nothing at all — control included.
    for (let tick = 0; tick < 5; tick += 1) {
      await app.advance(1);
    }
    app.plugin.notify(FITNESS_MACHINE_SERVICE, INDOOR_BIKE_DATA, CRANKS_STILL);
    await settle();
    expect(controlPointOpcodes(app.plugin, before)).toEqual([]);
    expect(app.controller.getSnapshot().workout).toMatchObject({
      status: 'paused',
      carryOn: 'pedal',
      elapsedSeconds: elapsed,
    });

    // The rider pedals: control is asked for, and the workout carries on from
    // the same place.
    app.plugin.notify(FITNESS_MACHINE_SERVICE, INDOOR_BIKE_DATA, PEDALLING);
    await settle();
    expect(controlPointOpcodes(app.plugin, before)).toEqual([0x00]);
    expect(app.controller.getSnapshot().workout).toMatchObject({
      status: 'running',
      carryOn: 'resumed',
      elapsedSeconds: elapsed,
    });

    // One write a tick: a ramp from the trainer's floor (0 W here), never a
    // step, reaching the block's 200 W only once the ramp has run its length.
    const byTick: number[][] = [];
    for (let tick = 0; tick <= CARRY_ON_RAMP_SECONDS + 2; tick += 1) {
      const from = app.plugin.writes.length;
      app.plugin.notify(FITNESS_MACHINE_SERVICE, INDOOR_BIKE_DATA, PEDALLING);
      await app.advance(1);
      byTick.push(targetsWritten(app.plugin, from));
    }
    const ramp = targetsWritten(app.plugin, before);
    expect(ramp[0]).toBe(0);
    for (let step = 1; step < ramp.length; step += 1) {
      expect(ramp[step]).toBeGreaterThan(ramp[step - 1] ?? Infinity);
    }
    expect(ramp.at(-1)).toBe(200);
    expect(ramp.filter((target) => target < 200)).toHaveLength(CARRY_ON_RAMP_SECONDS);
    expect(byTick.slice(-2).flat()).toEqual([]);
    expect(app.controller.getSnapshot().workout?.holdingWatts).toBe(200);
    expect(app.controller.getSnapshot().workout?.elapsedSeconds).toBeGreaterThan(elapsed ?? 0);
    expect(app.controller.getSnapshot().phase).toBe('recording');

    // The notice goes after a while; the workout does not.
    await app.advance(CARRY_ON_NOTICE_SECONDS);
    expect(app.controller.getSnapshot().workout?.carryOn).toBeUndefined();
    expect(app.controller.getSnapshot().workout?.name).toBe('Long');
    app.controller.dispose();
  });

  it('keeps the workout where it was while the trainer is away, and lets the rider end it, writing nothing', async () => {
    // Every connect after the drop is refused, so the trainer stays away.
    const app = openApp(deviceStorage(), { chooses: KICKR });
    await pairTrainer(app);
    await app.controller.requestTrainerControl();
    await settle();
    await app.controller.start();
    expect(app.controller.startWorkout(LONG_WORKOUT, watts(250))).toBe(true);
    await app.advance(1);
    const before = app.plugin.writes.length;
    app.plugin.connect = async () => Promise.reject(new Error('Connection timeout.'));

    app.plugin.dropLink();
    await settle();
    const elapsed = app.controller.getSnapshot().workout?.elapsedSeconds;
    for (let tick = 0; tick < 20; tick += 1) {
      await app.advance(1);
    }
    expect(app.controller.getSnapshot().workout).toMatchObject({
      status: 'paused',
      carryOn: 'reconnecting',
      elapsedSeconds: elapsed,
    });

    app.controller.endWorkout();
    await settle();
    expect(app.controller.getSnapshot().workout).toBeUndefined();
    expect(controlPointOpcodes(app.plugin, before)).toEqual([]);
    // Nothing was released, so nothing says a release did not land.
    expect(app.controller.getSnapshot().trainer.releaseFault).toBeUndefined();
    app.controller.dispose();
  });

  it('waits, writing no target, when the trainer refuses control back, and carries on once the rider takes it', async () => {
    // The second Request Control (the carry-on's) is refused; the third, the
    // rider's own press, is granted.
    const app = openApp(deviceStorage(), { chooses: KICKR }, undefined, 2);
    const before = await workoutAcrossADrop(app);

    app.plugin.notify(FITNESS_MACHINE_SERVICE, INDOOR_BIKE_DATA, PEDALLING);
    await settle();
    expect(app.controller.getSnapshot().workout?.carryOn).toBe('refused');
    // Pedalling on does not ask again.
    for (let tick = 0; tick < 3; tick += 1) {
      app.plugin.notify(FITNESS_MACHINE_SERVICE, INDOOR_BIKE_DATA, PEDALLING);
      await app.advance(1);
    }
    expect(controlPointOpcodes(app.plugin, before)).toEqual([0x00]);
    expect(app.controller.getSnapshot().workout?.status).toBe('paused');

    expect(targetsWritten(app.plugin, before)).toEqual([]);

    // The rider takes control by hand: still no target until they pedal…
    await app.controller.requestTrainerControl();
    await settle();
    expect(controlPointOpcodes(app.plugin, before)).toEqual([0x00, 0x00]);
    expect(app.controller.getSnapshot().workout?.carryOn).toBe('refused');
    // …and then the workout carries on, from the floor, asking nothing more.
    app.plugin.notify(FITNESS_MACHINE_SERVICE, INDOOR_BIKE_DATA, PEDALLING);
    await settle();
    await app.advance(1);
    expect(app.controller.getSnapshot().workout).toMatchObject({
      status: 'running',
      carryOn: 'resumed',
    });
    expect(controlPointOpcodes(app.plugin, before)).toEqual([0x00, 0x00, 0x05]);
    expect(targetsWritten(app.plugin, before)).toEqual([0]);
    app.controller.dispose();
  });

  it('does not carry on while the rider has paused the ride', async () => {
    const app = openApp(deviceStorage(), { chooses: KICKR });
    const before = await workoutAcrossADrop(app);
    await app.controller.pause();
    await settle();

    app.plugin.notify(FITNESS_MACHINE_SERVICE, INDOOR_BIKE_DATA, PEDALLING);
    await app.advance(1);

    expect(controlPointOpcodes(app.plugin, before)).toEqual([]);
    expect(app.controller.getSnapshot().workout?.carryOn).toBe('pedal');
    app.controller.dispose();
  });
});
