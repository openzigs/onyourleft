// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The OpenBikeControl client in the Android shell (#1825), against the
 * scripted plugin port: every plugin call bounded, what was written read back
 * from the double, an acknowledged write, and malformed notifications counted.
 */

import { SensorError } from '@onyourleft/sensors';
import {
  encodeAppInformation,
  OPEN_BIKE_CONTROL_APP_INFORMATION,
  OPEN_BIKE_CONTROL_BUTTON_STATE,
  OPEN_BIKE_CONTROL_HAPTIC,
  OPEN_BIKE_CONTROL_SERVICE,
  type OpenBikeControlEvent,
} from '@onyourleft/sensors/protocol';
import { DEFAULT_GATT_OPERATION_TIMEOUT } from '@onyourleft/sensors/web-bluetooth';
import { describe, expect, it } from 'vitest';

import {
  CONTROLLER_CALL_DEADLINE,
  createCapacitorOpenBikeControlClient,
} from './open-bike-control-client';
import type { PluginService } from './plugin-port';
import { SCRIPTED_DEVICE, scriptedPort, type ScriptedStack } from './testing';

const BUTTONS = [0x18, 0x19, 0x1b];
const SERVICE = OPEN_BIKE_CONTROL_SERVICE;
const STATE = OPEN_BIKE_CONTROL_BUTTON_STATE;
const INFORMATION = OPEN_BIKE_CONTROL_APP_INFORMATION;
const ID = SCRIPTED_DEVICE.deviceId;

const CONTROLLER_SERVICES: readonly PluginService[] = [
  {
    uuid: SERVICE,
    characteristics: [{ uuid: STATE }, { uuid: OPEN_BIKE_CONTROL_HAPTIC }, { uuid: INFORMATION }],
  },
];

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

const view = (bytes: readonly number[]): DataView => new DataView(Uint8Array.from(bytes).buffer);

function rig(stack: ScriptedStack = {}) {
  const plugin = scriptedPort({ services: CONTROLLER_SERVICES, ...stack });
  const clock = manualClock();
  const client = createCapacitorOpenBikeControlClient({
    plugin,
    buttons: BUTTONS,
    schedule: (callback) => clock.schedule(callback),
  });
  return { plugin, clock, client };
}

async function connected(stack: ScriptedStack = {}) {
  const parts = rig(stack);
  const connection = await parts.client.requestAndConnect();
  const events: OpenBikeControlEvent[][] = [];
  connection.onEvents((batch) => events.push([...batch]));
  return { ...parts, connection, events };
}

describe('opening a controller in the shell', () => {
  it('brings the plugin up, chooses by the service, connects, subscribes and writes', async () => {
    const { plugin, connection } = await connected();
    expect(connection.connected).toBe(true);
    expect(plugin.lastRequest).toEqual({ services: [SERVICE], optionalServices: [SERVICE] });
    expect(plugin.calls).toEqual([
      'initialize',
      'requestDevice',
      `connect:${ID}`,
      `getServices:${ID}`,
      `requestConnectionPriority:${ID}:high`,
      `startNotifications:${SERVICE}|${STATE}`,
      `write:${SERVICE}|${INFORMATION}`,
    ]);
  });

  it('hands each notification to the parser', async () => {
    const { plugin, events } = await connected();
    plugin.notify(SERVICE, STATE, view([0x01, 0x19, 0x01]));
    expect(events).toEqual([
      [{ kind: 'steer', direction: 'right', pressed: true, superseded: false }],
    ]);
  });
});

describe('read back what was sent', () => {
  it('writes #1822 builder output to app information, acknowledged, and nothing else', async () => {
    const { plugin } = await connected();
    expect(
      plugin.writes.map((write) => ({
        characteristic: write.characteristic,
        bytes: [
          ...new Uint8Array(write.value.buffer, write.value.byteOffset, write.value.byteLength),
        ],
      })),
    ).toEqual([{ characteristic: INFORMATION, bytes: [...encodeAppInformation(BUTTONS)] }]);
    expect(plugin.calls.some((call) => call.startsWith('writeWithoutResponse'))).toBe(false);
  });

  it('writes nothing to a controller with no app-information characteristic', async () => {
    const { plugin } = await connected({
      services: [{ uuid: SERVICE, characteristics: [{ uuid: STATE }] }],
    });
    expect(plugin.writes).toEqual([]);
  });
});

describe('every plugin call is bounded', () => {
  const cases: ReadonlyArray<readonly [string, ScriptedStack, string]> = [
    ['initialize', { initializeNeverAnswers: true }, 'initialize'],
    ['requestDevice', { neverAnswers: new Set(['requestDevice']) }, 'choose'],
    ['connect', { neverAnswers: new Set(['connect']) }, 'connect'],
    ['getServices', { neverAnswers: new Set(['getServices']) }, 'discover'],
    ['startNotifications', { neverAnswers: new Set(['startNotifications']) }, 'subscribe'],
    ['write', { neverAnswers: new Set(['write']) }, 'write'],
  ];

  for (const [call, stack, step] of cases) {
    it(`fails a ${call} that never answers by its deadline, and leaves the client disconnected`, async () => {
      const { plugin, client, clock } = rig(stack);
      const outcome = client.requestAndConnect().then(
        () => undefined,
        (error: unknown) => error,
      );
      await settle();
      expect(clock.pending).toBeGreaterThan(0);
      clock.fire();
      const error = await outcome;
      expect(error).toBeInstanceOf(SensorError);
      expect((error as SensorError).code).toBe('not-connected');
      expect((error as SensorError).message).toContain(`${step} step in time`);
      // Once the plugin holds a link, the client lets it go.
      if (plugin.calls.includes(`connect:${ID}`)) {
        expect(plugin.calls).toContain(`disconnect:${ID}`);
      }
      if (plugin.calls.includes(`startNotifications:${SERVICE}|${STATE}`)) {
        // A notification the plugin still delivers is ignored, not thrown.
        expect(() => {
          plugin.notify(SERVICE, STATE, view([0x01, 0x18, 0x01]));
        }).not.toThrow();
      }
    });
  }

  it('goes on when the connection priority is refused or never answered', async () => {
    const refused = await connected({ connectionPriorityRejectsWith: new Error('declined') });
    expect(refused.connection.connected).toBe(true);
    const silent = rig({ neverAnswers: new Set(['requestConnectionPriority']) });
    const opening = silent.client.requestAndConnect();
    await settle();
    silent.clock.fire();
    const connection = await opening;
    expect(connection.connected).toBe(true);
  });

  it('disconnects a link that a timed-out connect brings up later', async () => {
    let answer: () => void = () => undefined;
    const late = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const { plugin, client, clock } = rig({ connectWaitsFor: late });
    const outcome = client.requestAndConnect().catch((error: unknown) => error);
    await settle();
    clock.fire();
    await outcome;
    expect(plugin.calls.filter((call) => call === `disconnect:${ID}`)).toHaveLength(1);
    answer();
    await settle();
    expect(plugin.calls.filter((call) => call === `disconnect:${ID}`)).toHaveLength(2);
  });

  it('leaves no deadline running once connected, and waits as long as the browser does', async () => {
    const { clock } = await connected();
    expect(clock.pending).toBe(0);
    expect(CONTROLLER_CALL_DEADLINE).toBe(DEFAULT_GATT_OPERATION_TIMEOUT);
  });
});

describe('a disconnect', () => {
  it('is reported once, and nothing is delivered after it', async () => {
    const { plugin, connection, events } = await connected();
    let drops = 0;
    connection.onDisconnect(() => {
      drops += 1;
    });
    plugin.dropLink();
    plugin.dropLink();
    expect(drops).toBe(1);
    expect(plugin.calls.filter((call) => call === `disconnect:${ID}`)).toHaveLength(1);
    expect(connection.connected).toBe(false);
    plugin.notify(SERVICE, STATE, view([0x01, 0x18, 0x01]));
    expect(events).toEqual([]);
  });

  it('fails the step in flight at once', async () => {
    const { plugin, client } = rig({ neverAnswers: new Set(['startNotifications']) });
    const outcome = client.requestAndConnect().catch((error: unknown) => error);
    await settle();
    plugin.dropLink();
    expect(((await outcome) as SensorError).message).toContain(
      'disconnected during the subscribe step',
    );
  });
});

describe('malformed notifications', () => {
  it('are dropped and counted, never thrown', async () => {
    const { plugin, connection, events } = await connected();
    expect(() => {
      plugin.notify(SERVICE, STATE, view([]));
      plugin.notify(SERVICE, STATE, view([0x01, 0x18]));
    }).not.toThrow();
    expect(connection.malformed).toBe(2);
    expect(events).toEqual([]);
  });
});

describe('failures a rider can act on', () => {
  it('says no device was selected when the chooser is cancelled', async () => {
    const { client } = rig({ chooserRejectsWith: new Error('User cancelled') });
    await expect(client.requestAndConnect()).rejects.toMatchObject({ code: 'no-device-selected' });
  });

  it('says the device is not a controller when it serves no button state, and disconnects', async () => {
    const { plugin, client } = rig({ services: [] });
    await expect(client.requestAndConnect()).rejects.toMatchObject({
      code: 'capability-unsupported',
    });
    expect(plugin.calls).toContain(`disconnect:${ID}`);
  });
});
