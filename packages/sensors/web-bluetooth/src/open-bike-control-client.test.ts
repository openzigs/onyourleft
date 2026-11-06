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
import { ForgetUnconfirmedError, SensorError } from '../../src/errors';
import type { BluetoothPort } from './gatt';

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

function rig(
  spec: FakeDeviceSpec = controllerSpec(),
  extra: { userActivation?: () => boolean } = {},
) {
  const fake = createFakeBluetooth({ devices: [spec] });
  const clock = manualClock();
  const client = createOpenBikeControlClient({
    bluetooth: fake.bluetooth,
    buttons: BUTTONS,
    schedule: (callback) => clock.schedule(callback),
    ...extra,
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

const domError = (name: string): Error => Object.assign(new Error(name), { name });

describe('forgetting is bounded and honest', () => {
  it('rejects with ForgetUnconfirmedError when the browser never answers, and still drops the link', async () => {
    const parts = rig({ ...controllerSpec(), forgetNeverSettles: true });
    const connection = await parts.client.requestAndConnect();
    const outcome = connection.forget().catch((error: unknown) => error);
    await settle();
    parts.clock.fire();
    const error = await outcome;
    expect(error).toBeInstanceOf(ForgetUnconfirmedError);
    expect(error).toMatchObject({ code: 'forget-timed-out', holding: 'permission' });
    expect((error as ForgetUnconfirmedError).stillRunning).toBeInstanceOf(Promise);
    expect(parts.device().connected).toBe(false);
    expect(parts.clock.pending).toBe(0);
  });

  it('rejects with forget-refused when the browser refuses', async () => {
    const parts = rig({ ...controllerSpec(), forgetRejects: true });
    const connection = await parts.client.requestAndConnect();
    await expect(connection.forget()).rejects.toMatchObject({ code: 'forget-refused' });
    expect(parts.clock.pending).toBe(0);
  });

  it('resolves, having dropped the link, in a browser with no forget()', async () => {
    const parts = rig({ ...controllerSpec(), withoutForget: true });
    const connection = await parts.client.requestAndConnect();
    await connection.forget();
    expect(parts.device().connected).toBe(false);
  });

  it('still forgets when a disconnect listener throws', async () => {
    const { connection, device } = await connected();
    connection.onDisconnect(() => {
      throw new Error('listener fault');
    });
    await connection.forget();
    expect(device().forgets).toBe(1);
  });
});

describe('a refused step is reported for what it was', () => {
  const steps: ReadonlyArray<readonly [FakeGattOperation, string]> = [
    ['connect', 'connect'],
    ['startNotifications', 'subscribe'],
    ['writeValueWithResponse', 'write'],
  ];
  for (const [operation, step] of steps) {
    it(`calls a NetworkError in the ${step} step not-connected, with the cause kept`, async () => {
      const { bench, client, device } = rig();
      bench.hold(operation);
      const outcome = client.requestAndConnect().catch((error: unknown) => error);
      await settle();
      const cause = domError('NetworkError');
      bench.held.find((held) => held.operation === operation)?.fail(cause);
      const error = await outcome;
      expect(error).toMatchObject({ code: 'not-connected' });
      expect((error as SensorError).message).toContain(`refused the ${step} step`);
      expect((error as SensorError).cause).toBe(cause);
      expect(device().connected).toBe(false);
    });
  }

  it.each(['NotFoundError', 'SecurityError'])(
    'calls a %s while discovering the service not a controller',
    async (name) => {
      const { bench, client } = rig();
      bench.hold('getPrimaryService');
      const outcome = client.requestAndConnect().catch((error: unknown) => error);
      await settle();
      bench.held.find((held) => held.operation === 'getPrimaryService')?.fail(domError(name));
      expect(await outcome).toMatchObject({ code: 'capability-unsupported' });
    },
  );

  it('calls a NetworkError while discovering not-connected', async () => {
    const { bench, client } = rig();
    bench.hold('getPrimaryService');
    const outcome = client.requestAndConnect().catch((error: unknown) => error);
    await settle();
    bench.held
      .find((held) => held.operation === 'getPrimaryService')
      ?.fail(domError('NetworkError'));
    expect(await outcome).toMatchObject({ code: 'not-connected' });
  });

  it('does not take a failed optional app-information lookup for an absent one', async () => {
    const { bench, client, device } = rig();
    bench.hold('getCharacteristic');
    const outcome = client.requestAndConnect().catch((error: unknown) => error);
    await settle();
    const held = (): ReturnType<typeof bench.held.find> =>
      bench.held.find((entry) => entry.subject === INFORMATION);
    // Let the required button-state lookup through, then fail the optional one.
    bench.held.find((entry) => entry.subject === STATE)?.settle();
    await settle();
    held()?.fail(domError('NetworkError'));
    expect(await outcome).toMatchObject({ code: 'not-connected' });
    expect(device().connected).toBe(false);
  });

  it('reports a device with no GATT server as not-connected', async () => {
    const bluetooth = {
      getAvailability: () => Promise.resolve(true),
      requestDevice: () =>
        Promise.resolve({ id: 'x', addEventListener() {}, removeEventListener() {} }),
    } as unknown as BluetoothPort;
    const client = createOpenBikeControlClient({ bluetooth, buttons: BUTTONS });
    await expect(client.requestAndConnect()).rejects.toMatchObject({
      code: 'not-connected',
      message: expect.stringContaining('no GATT server') as string,
    });
  });
});

describe('the options and the platform', () => {
  it('bounds each step by the timeout it is given', async () => {
    const fake = createFakeBluetooth({ devices: [controllerSpec()] });
    const afters: number[] = [];
    const client = createOpenBikeControlClient({
      bluetooth: fake.bluetooth,
      buttons: BUTTONS,
      timeout: 7 as never,
      schedule: (_callback, after) => {
        afters.push(after);
        return () => undefined;
      },
    });
    await client.requestAndConnect();
    expect(afters.length).toBeGreaterThan(0);
    expect(afters.every((after) => after === 7)).toBe(true);
  });

  it('asks for a user gesture before the chooser opens', async () => {
    const { bench, client } = rig(controllerSpec(), { userActivation: () => false });
    await expect(client.requestAndConnect()).rejects.toMatchObject({
      code: 'user-gesture-required',
    });
    expect(bench.requests).toEqual([]);
  });

  it('survives a gatt.disconnect() that throws', async () => {
    const { connection } = await (async () => {
      const parts = rig({ ...controllerSpec(), disconnectThrows: true });
      return { ...parts, connection: await parts.client.requestAndConnect() };
    })();
    expect(() => connection.disconnect()).not.toThrow();
    expect(connection.connected).toBe(false);
  });

  it('keeps delivering to the next listener when one throws', async () => {
    const { device, connection } = await connected();
    const seen: number[] = [];
    connection.onEvents(() => {
      throw new Error('listener fault');
    });
    connection.onEvents((batch) => seen.push(batch.length));
    expect(() =>
      device().notify(SERVICE, STATE, Uint8Array.from([0x01, 0x19, 0x01])),
    ).not.toThrow();
    expect(seen).toEqual([1]);
  });
});
