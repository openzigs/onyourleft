// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Android shell reconnecting to a remembered steering controller — #2672,
 * through the path `main.tsx` builds and nothing narrower.
 *
 * Everything is the production code but the Capacitor plugin at the bottom:
 * the steering controller is `createShellSteeringController`'s over
 * `@onyourleft/mobile`'s controller client, beside `createShellRideController`
 * over the Capacitor transport, ALL on one scripted plugin, and the memory is
 * `remembered-sensors.ts` over a storage both "sessions" share. An app restart
 * is a second everything over the same storage, so nothing of the first
 * survives into it but what that storage holds.
 */

import { unixSeconds } from '@onyourleft/domain';
import {
  createCapacitorOpenBikeControlClient,
  createCapacitorTransport,
  readCapacitorFitnessMachine,
  createCapacitorFitnessMachineChannel,
  readCapacitorResolvedUuids,
  recordingServiceKeepAlive,
  recordingServiceNotificationPermission,
  type RecordingServicePlugin,
} from '@onyourleft/mobile';
import { scriptedPort, type ScriptedStack } from '@onyourleft/mobile/testing';
import { deviceId } from '@onyourleft/sensors';
import {
  createIndoorBikeDataProfile,
  OPEN_BIKE_CONTROL_BUTTON_STATE,
  OPEN_BIKE_CONTROL_SERVICE,
  type OpenBikeControlEvent,
} from '@onyourleft/sensors/protocol';
import { athleteId, recordingSessionId } from '@onyourleft/store';
import { describe, expect, it, vi } from 'vitest';

import { RECONNECT_BACKOFF_SECONDS, type RideController } from './controller';
import {
  createRememberedSensors,
  transportSeed,
  type RememberedSensorStorage,
} from './remembered-sensors';
import { createShellRideController } from './shell-ride-controller';
import { createShellSteeringController } from './shell-steering-controller';
import { STEERING_CONTROLLER_BUTTONS } from './steering-controller';
import { openCapacitorTrainer } from './trainer';

const CONTROLLER = { deviceId: 'D1:0B:1C:00:4E:21', name: 'Ctrl 4E21' } as const;
const KICKR = { deviceId: 'C4:7C:8D:6A:00:02', name: 'KICKR 1F2A' } as const;

/** The device's own storage, shared by every "session" of one test. */
function deviceStorage(): RememberedSensorStorage {
  const rows = new Map<string, string>();
  return {
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => void rows.set(key, value),
    removeItem: (key) => void rows.delete(key),
  };
}

/** Let the plugin's answers and every await run out. */
async function settle(): Promise<void> {
  for (let index = 0; index < 200; index += 1) {
    await Promise.resolve();
  }
}

/** One opening of the app: the shell's ride and steering controllers, as `main.tsx` builds them. */
function openApp(
  device: RememberedSensorStorage,
  stack: ScriptedStack = {},
  /** Hold ONE device's connect until this settles; every other answers at once. */
  hold?: { readonly id: string; readonly until: Promise<void> },
) {
  const clock = unixSeconds(1_757_000_000);
  const plugin = scriptedPort({
    services: [
      {
        uuid: OPEN_BIKE_CONTROL_SERVICE,
        characteristics: [{ uuid: OPEN_BIKE_CONTROL_BUTTON_STATE }],
      },
    ],
    ...stack,
  });
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
  // How often the ride controller asked the transport what it can reach.
  let knownAsked = 0;
  const knownDevices = transport.knownDevices.bind(transport);
  transport.knownDevices = async () => {
    knownAsked += 1;
    return knownDevices();
  };
  const service: RecordingServicePlugin = {
    start: async () => Promise.resolve(),
    stop: async () => Promise.resolve(),
    notificationPermission: async () => Promise.resolve({ state: 'granted' }),
    requestNotificationPermission: async () => Promise.resolve({ state: 'granted' }),
  };
  const ride = createShellRideController(
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
  const waits: Array<{ readonly run: () => void; readonly after: number }> = [];
  const steering = createShellSteeringController(
    createCapacitorOpenBikeControlClient({
      plugin,
      buttons: STEERING_CONTROLLER_BUTTONS,
      // No deadline ever fires: the scripted plugin answers or a test drops it.
      schedule: () => () => undefined,
    }),
    {
      remembered,
      ride,
      budget: transport.traits.maxConcurrentConnections,
      schedule: (run, after) => {
        waits.push({ run, after });
        return () => undefined;
      },
    },
  );
  return {
    plugin,
    ride,
    steering,
    remembered,
    waits,
    get knownAsked() {
      return knownAsked;
    },
  };
}

/** Pair the controller through the chooser, in the first session. */
async function pairController(device: RememberedSensorStorage): Promise<void> {
  const first = openApp(device, { chooses: CONTROLLER });
  await settle();
  await first.steering.pair();
  expect(first.steering.state).toEqual({ kind: 'connected', name: CONTROLLER.name });
  first.ride.dispose();
}

describe('#2672 — the steering controller after the app is closed and opened again', () => {
  it('reconnects it with no chooser, and its presses reach the game', async () => {
    const device = deviceStorage();
    await pairController(device);

    // A plugin whose chooser refuses, so a reconnect through one fails here.
    const second = openApp(device, { chooserRejectsWith: new Error('requestDevice cancelled.') });
    const heard: OpenBikeControlEvent[] = [];
    second.steering.onControllerEvents((events) => heard.push(...events));
    await settle();

    expect(second.plugin.calls).not.toContain('requestDevice');
    expect(second.plugin.calls).toContain(`connect:${CONTROLLER.deviceId}`);
    // The name it was paired with, which Android's plugin would not give.
    expect(second.steering.state).toEqual({ kind: 'connected', name: CONTROLLER.name });
    second.plugin.notify(
      OPEN_BIKE_CONTROL_SERVICE,
      OPEN_BIKE_CONTROL_BUTTON_STATE,
      new DataView(Uint8Array.from([0x01, 0x19, 0x01]).buffer),
    );
    expect(heard).toEqual([
      { kind: 'steer', direction: 'right', pressed: true, superseded: false },
    ]);
    // Never asked of the transport, which does not pair a controller.
    expect(second.ride.getSnapshot().sensors).toEqual([]);
    expect(second.plugin.calls.filter((call) => call.startsWith('getDevices'))).toEqual([]);
    expect(second.knownAsked).toBe(0);
  });

  it('does not reconnect one the rider forgot', async () => {
    const device = deviceStorage();
    const first = openApp(device, { chooses: CONTROLLER });
    await settle();
    await first.steering.pair();
    first.steering.forget();
    first.ride.dispose();

    const second = openApp(device);
    await settle();
    expect(second.plugin.calls).toEqual([]);
    expect(second.steering.state).toEqual({ kind: 'none', dropped: false });
  });

  it('is tried after the remembered sensors, once their restore has ended', async () => {
    const device = deviceStorage();
    await pairController(device);
    const memory = createRememberedSensors(device);
    memory.remember({ id: deviceId(KICKR.deviceId), name: KICKR.name, role: 'trainer' });

    let release: () => void = () => undefined;
    const second = openApp(
      device,
      {},
      {
        id: KICKR.deviceId,
        until: new Promise<void>((resolve) => {
          release = resolve;
        }),
      },
    );
    await settle();
    // The trainer's connect is held (the double records it once let through),
    // and the controller waits for it.
    expect(second.plugin.calls).toContain(`getDevices:${KICKR.deviceId}`);
    expect(second.plugin.calls).not.toContain(`connect:${CONTROLLER.deviceId}`);
    expect(second.steering.state).toEqual({ kind: 'none', dropped: false });
    release();
    await settle();
    const calls = second.plugin.calls;
    expect(calls.indexOf(`connect:${CONTROLLER.deviceId}`)).toBeGreaterThan(
      calls.indexOf(`connect:${KICKR.deviceId}`),
    );
    expect(second.steering.state).toEqual({ kind: 'connected', name: CONTROLLER.name });
  });

  it('is not tried, and stays remembered, where the sensors take the whole budget', async () => {
    const device = deviceStorage();
    await pairController(device);
    const memory = createRememberedSensors(device);
    for (let n = 1; n <= 3; n += 1) {
      memory.remember({
        id: deviceId(`C4:7C:8D:6A:01:0${String(n)}`),
        name: `Strap ${String(n)}`,
        role: 'heart-rate',
      });
    }

    const second = openApp(device);
    await settle();
    expect(second.ride.getSnapshot().sensors).toHaveLength(3);
    expect(second.plugin.calls).not.toContain(`connect:${CONTROLLER.deviceId}`);
    expect(second.steering.state).toEqual({ kind: 'none', dropped: false });
    expect(
      createRememberedSensors(device)
        .list()
        .map((one) => one.role),
    ).toContain('controller');
  });

  it('comes back by itself when its link drops, on the first backoff', async () => {
    const device = deviceStorage();
    await pairController(device);
    const second = openApp(device);
    await settle();
    second.plugin.dropLink();
    await settle();
    expect(second.steering.state).toEqual({ kind: 'reconnecting', name: CONTROLLER.name });
    expect(second.waits.map((wait) => wait.after)).toEqual([RECONNECT_BACKOFF_SECONDS[0]]);
    const before = second.plugin.calls.length;
    second.waits[0]?.run();
    await settle();
    expect(second.plugin.calls.slice(before)).toContain(`connect:${CONTROLLER.deviceId}`);
    expect(second.plugin.calls.slice(before)).not.toContain('requestDevice');
    expect(second.steering.state).toEqual({ kind: 'connected', name: CONTROLLER.name });
  });
});

describe('#2672 — the shell’s backoff, on the device’s own clock', () => {
  it('waits the backoff in seconds of real time when given no schedule', async () => {
    vi.useFakeTimers();
    try {
      const memory = createRememberedSensors(deviceStorage());
      memory.remember({
        id: deviceId(CONTROLLER.deviceId),
        name: CONTROLLER.name,
        role: 'controller',
      });
      let tries = 0;
      const steering = createShellSteeringController(
        {
          requestAndConnect: async () => Promise.reject(new Error('no chooser in a test')),
          connectKnown: async (id, name) => {
            tries += 1;
            if (tries === 1) return Promise.reject(new Error('not there yet'));
            return Promise.resolve({
              id,
              name,
              onEvents: () => () => undefined,
              onDisconnect: () => () => undefined,
              disconnect: () => undefined,
            });
          },
        },
        {
          remembered: memory,
          ride: {
            getSnapshot: () =>
              ({ sensors: [] }) as unknown as ReturnType<RideController['getSnapshot']>,
            restored: Promise.resolve(),
          },
          budget: 3,
        },
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(tries).toBe(1);
      expect(steering.state).toEqual({ kind: 'reconnecting', name: CONTROLLER.name });
      const wait = (RECONNECT_BACKOFF_SECONDS[1] ?? 0) * 1000;
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(tries).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(tries).toBe(2);
      expect(steering.state).toEqual({ kind: 'connected', name: CONTROLLER.name });
    } finally {
      vi.useRealTimers();
    }
  });
});
