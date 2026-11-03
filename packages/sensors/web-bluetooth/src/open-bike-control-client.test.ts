// SPDX-License-Identifier: Apache-2.0

/**
 * The OpenBikeControl client over Web Bluetooth (#1824), against the scripted
 * stack: every step bounded, a drop seen, what was written read back from the
 * device, and malformed notifications dropped and counted.
 */

import { describe, expect, it } from 'vitest';

import {
  encodeAppInformation,
  OPEN_BIKE_CONTROL_APP_INFORMATION,
  OPEN_BIKE_CONTROL_BUTTON_STATE,
  OPEN_BIKE_CONTROL_HAPTIC,
  OPEN_BIKE_CONTROL_SERVICE,
  type OpenBikeControlEvent,
} from '../../protocol/src/open-bike-control';
import { SensorError } from '../../src/errors';

import { createOpenBikeControlClient, type ControllerConnection } from './open-bike-control-client';
import {
  createFakeBluetooth,
  type FakeDeviceSpec,
  type FakeGattOperation,
} from './testing/fake-bluetooth';

const BUTTONS = [0x18, 0x19, 0x1b];
const SERVICE = OPEN_BIKE_CONTROL_SERVICE;
const STATE = OPEN_BIKE_CONTROL_BUTTON_STATE;
const INFORMATION = OPEN_BIKE_CONTROL_APP_INFORMATION;

function controllerSpec(characteristics = [STATE, OPEN_BIKE_CONTROL_HAPTIC, INFORMATION]) {
  return {
    id: 'controller',
    name: 'Steering Controller 4E21',
    services: [{ uuid: SERVICE, characteristics }],
  } satisfies FakeDeviceSpec;
}

/** A clock the test fires by hand. */
function manualClock() {
  const pending = new Set<() => void>();
  return {
    schedule(callback: () => void): () => void {
      pending.add(callback);
      return () => pending.delete(callback);
    },
    fire(): void {
      for (const callback of [...pending]) {
        pending.delete(callback);
        callback();
      }
    },
    get pending() {
      return pending.size;
    },
  };
}

const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 200; turn += 1) await Promise.resolve();
};

function rig(spec: FakeDeviceSpec = controllerSpec()) {
  const fake = createFakeBluetooth({ devices: [spec] });
  const clock = manualClock();
  const client = createOpenBikeControlClient({
    bluetooth: fake.bluetooth,
    buttons: BUTTONS,
    schedule: (callback) => clock.schedule(callback),
  });
  return { ...fake, clock, client, device: () => fake.bench.device(spec.id) };
}

async function connected() {
  const parts = rig();
  const connection = await parts.client.requestAndConnect();
  const events: OpenBikeControlEvent[][] = [];
  connection.onEvents((batch) => events.push([...batch]));
  return { ...parts, connection, events };
}

describe('opening a controller', () => {
  it('asks the chooser for the OpenBikeControl service, and for no other', async () => {
    const { bench, connection } = await connected();
    expect(bench.requests).toEqual([
      {
        filters: [{ services: [SERVICE] }],
        optionalServices: [SERVICE],
        acceptAllDevices: undefined,
      },
    ]);
    expect(connection.connected).toBe(true);
    expect(connection.name).toBe('Steering Controller 4E21');
  });

  it('subscribes to button state and hands each notification to the parser', async () => {
    const { device, events } = await connected();
    expect(device().notifying(SERVICE, STATE)).toBe(true);
    device().notify(SERVICE, STATE, Uint8Array.from([0x01, 0x18, 0x01, 0x1b, 0x6c]));
    expect(events).toEqual([
      [
        { kind: 'steer', direction: 'left', pressed: true, superseded: true },
        { kind: 'steering-angle', degrees: -10 },
      ],
    ]);
  });

  it('writes the app information once, acknowledged, as the builder makes it', async () => {
    const { device, bench } = await connected();
    expect(
      device()
        .writes(SERVICE, INFORMATION)
        .map((bytes) => [...bytes]),
    ).toEqual([[...encodeAppInformation(BUTTONS)]]);
    expect(bench.operations.filter((operation) => operation.includes('writeValue'))).toEqual([
      `controller:writeValueWithResponse:${INFORMATION}`,
    ]);
  });

  it('connects to a controller with no app-information characteristic, and writes nothing', async () => {
    const parts = rig(controllerSpec([STATE]));
    const connection = await parts.client.requestAndConnect();
    expect(connection.connected).toBe(true);
    expect(parts.bench.operations.some((operation) => operation.includes('writeValue'))).toBe(
      false,
    );
  });
});

describe('only the app information is written', () => {
  it('writes to no characteristic but app information, through the whole connection', async () => {
    const { device, connection } = await connected();
    device().notify(SERVICE, STATE, Uint8Array.from([0x01, 0x19, 0x01]));
    connection.disconnect();
    const written = [STATE, OPEN_BIKE_CONTROL_HAPTIC, INFORMATION].filter(
      (characteristic) => device().writes(SERVICE, characteristic).length > 0,
    );
    expect(written).toEqual([INFORMATION]);
  });
});

describe('every GATT operation is bounded', () => {
  const cases: ReadonlyArray<readonly [FakeGattOperation, string]> = [
    ['connect', 'connect'],
    ['getPrimaryService', 'discover'],
    ['getCharacteristic', 'discover'],
    ['startNotifications', 'subscribe'],
    ['writeValueWithResponse', 'write'],
  ];

  for (const [operation, step] of cases) {
    it(`fails a ${operation} that never answers by its timeout, and leaves nothing open`, async () => {
      const { bench, client, clock, device } = rig();
      bench.hold(operation);
      const opening = client.requestAndConnect();
      const outcome = opening.then(
        () => undefined,
        (error: unknown) => error,
      );
      await settle();
      expect(bench.held.map((held) => held.operation)).toContain(operation);
      clock.fire();
      const error = await outcome;
      expect(error).toBeInstanceOf(SensorError);
      expect((error as SensorError).code).toBe('not-connected');
      expect((error as SensorError).message).toContain(`${step} step in time`);
      expect(device().connected).toBe(false);
      expect(device().listeners(SERVICE, STATE)).toBe(0);
      expect(device().disconnectListeners).toBe(0);
    });
  }

  it('drops a link that a timed-out connect brings up later', async () => {
    const { bench, client, clock, device } = rig();
    bench.hold('connect');
    const outcome = client.requestAndConnect().catch((error: unknown) => error);
    await settle();
    clock.fire();
    await outcome;
    bench.release('connect');
    await settle();
    expect(device().connected).toBe(false);
  });

  it('leaves no deadline running once connected', async () => {
    const { clock } = await connected();
    expect(clock.pending).toBe(0);
  });
});

describe('a disconnect is seen', () => {
  it('reports the drop once, and delivers nothing after it', async () => {
    const { device, connection, events } = await connected();
    let drops = 0;
    connection.onDisconnect(() => {
      drops += 1;
    });
    device().drop();
    await settle();
    expect(drops).toBe(1);
    expect(connection.connected).toBe(false);
    expect(device().listeners(SERVICE, STATE)).toBe(0);
    device().notify(SERVICE, STATE, Uint8Array.from([0x01, 0x18, 0x01]));
    expect(events).toEqual([]);
  });

  it('fails a step at once when the link drops during it', async () => {
    const { bench, client, device } = rig();
    bench.hold('startNotifications');
    const outcome = client.requestAndConnect().catch((error: unknown) => error);
    await settle();
    device().drop();
    const error = await outcome;
    expect((error as SensorError).message).toContain('disconnected during the subscribe step');
  });

  it('disconnects on request, and reports it', async () => {
    const { device, connection } = await connected();
    const drops: string[] = [];
    connection.onDisconnect(() => drops.push('dropped'));
    connection.disconnect();
    connection.disconnect();
    expect(device().connected).toBe(false);
    expect(drops).toEqual(['dropped']);
  });
});

describe('malformed notifications', () => {
  it('are dropped and counted, never thrown, and a good one after them still arrives', async () => {
    const { device, connection, events } = await connected();
    expect(() => {
      device().notify(SERVICE, STATE, Uint8Array.from([]));
      device().notify(SERVICE, STATE, Uint8Array.from([0x03, 0x18, 0x01]));
      device().notify(SERVICE, STATE, Uint8Array.from([0x01, 0x18]));
      device().notifyWithoutValue(SERVICE, STATE);
    }).not.toThrow();
    expect(connection.malformed).toBe(4);
    expect(events).toEqual([]);
    device().notify(SERVICE, STATE, Uint8Array.from([0x01, 0x19, 0x00]));
    expect(events).toEqual([
      [{ kind: 'steer', direction: 'right', pressed: false, superseded: false }],
    ]);
  });
});

describe('failures a rider can act on', () => {
  it('says no device was selected when the chooser closes', async () => {
    const { bench, client } = rig();
    bench.setChooser({ kind: 'cancel' });
    await expect(client.requestAndConnect()).rejects.toMatchObject({ code: 'no-device-selected' });
  });

  it('says the device is not a controller when it lacks button state, and disconnects', async () => {
    const parts = rig(controllerSpec([INFORMATION]));
    await expect(parts.client.requestAndConnect()).rejects.toMatchObject({
      code: 'capability-unsupported',
    });
    expect(parts.device().connected).toBe(false);
  });
});

describe('forgetting', () => {
  it('drops the link and revokes the grant', async () => {
    const { device, connection } = await connected();
    const forgetting: ControllerConnection = connection;
    await forgetting.forget();
    expect(device().connected).toBe(false);
    expect(device().forgets).toBe(1);
  });
});
