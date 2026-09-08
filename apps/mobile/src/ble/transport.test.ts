// SPDX-License-Identifier: AGPL-3.0-or-later

import { beatsPerMinute, revolutionsPerMinute, unixSeconds, watts } from '@onyourleft/domain';
import {
  ANDROID_BLE,
  isSensorError,
  MAX_RECOMMENDED_CONCURRENT_CONNECTIONS,
  type MeasurementCapability,
  type SensorTransport,
} from '@onyourleft/sensors';
import {
  canonicalUuid,
  HEART_RATE_MEASUREMENT,
  HEART_RATE_SERVICE,
  heartRateProfile,
  type GattProfile,
} from '@onyourleft/sensors/protocol';
import { describe, expect, it } from 'vitest';

import { createCapacitorTransport } from './transport';
import { SCRIPTED_DEVICE, scriptedPort, type ScriptedStack } from './testing';

const AT = unixSeconds(1_757_000_000);

const POWER_SERVICE = canonicalUuid(0x1818);
const POWER_CHARACTERISTIC = canonicalUuid(0x2a63);
const POWER_FEATURE = canonicalUuid(0x2a65);

/**
 * A composite profile, the shape FTMS Indoor Bike Data has: one notification
 * carrying more than one capability. It is the case that distinguishes "only
 * what was asked for is delivered" from "everything in the frame is".
 */
const compositeProfile: GattProfile = {
  service: POWER_SERVICE,
  characteristic: POWER_CHARACTERISTIC,
  capabilities: ['power', 'cadence'],
  decode(_value, sink) {
    sink.power(watts(220));
    sink.cadence(revolutionsPerMinute(88));
  },
};

/** The same, with a Feature characteristic that narrows what this device does. */
const describingProfile: GattProfile = {
  ...compositeProfile,
  describe: {
    characteristic: POWER_FEATURE,
    declared(value) {
      return value.getUint8(0) === 1
        ? (['power', 'cadence'] as const)
        : (['power'] as const satisfies readonly MeasurementCapability[]);
    },
  },
};

const build = (
  stack: ScriptedStack = {},
  profiles: readonly GattProfile[] = [compositeProfile],
) => {
  const plugin = scriptedPort(stack);
  const transport: SensorTransport = createCapacitorTransport({ plugin, profiles, now: () => AT });
  return { plugin, transport };
};

const connected = async (stack: ScriptedStack = {}, profiles?: readonly GattProfile[]) => {
  const built = build(stack, profiles);
  const device = await built.transport.discover({ capabilities: [] });
  await built.transport.connect(device.identity.id);
  return { ...built, device };
};

describe('the traits are Android’s, not a browser’s', () => {
  it('needs no user gesture, reconnects silently and survives backgrounding', () => {
    const { transport } = build();
    expect(transport.traits.id).toBe(ANDROID_BLE);
    // All three are the OPPOSITE of the Web Bluetooth adapter's, which is the
    // whole reason a caller branches on traits rather than on a platform guess.
    expect(transport.traits.requiresUserGestureToDiscover).toBe(false);
    expect(transport.traits.canReconnectWithoutUserGesture).toBe(true);
    expect(transport.traits.canRestoreConnectionsInBackground).toBe(true);
  });

  it('budgets three connections, not the seven Android is reported to manage', () => {
    expect(build().transport.traits.maxConcurrentConnections).toBe(
      MAX_RECOMMENDED_CONCURRENT_CONNECTIONS,
    );
    expect(build().transport.traits.maxConcurrentConnections).toBe(3);
  });
});

describe('availability distinguishes the four outcomes', () => {
  it('is available when the stack initialises and the adapter is on', async () => {
    const { transport } = build();
    await expect(transport.availability()).resolves.toEqual({ kind: 'available' });
  });

  it('reports not-permitted when initialize is refused for permission', async () => {
    const { transport } = build({
      initializeRejectsWith: new Error('Location permission was denied'),
    });
    await expect(transport.availability()).resolves.toEqual({ kind: 'not-permitted' });
  });

  it('reports UNSUPPORTED for a refusal it cannot place, not not-permitted', async () => {
    // The conservative direction on purpose: `unsupported` offers no retry,
    // where `not-permitted` sends the rider to a settings screen that may not
    // fix anything. Guessing toward the more useful screen is guessing toward
    // the more confident lie.
    const { transport } = build({ initializeRejectsWith: new Error('BLE stack unavailable') });
    await expect(transport.availability()).resolves.toEqual({ kind: 'unsupported' });
  });

  it('reports adapter-unavailable when Bluetooth is switched off', async () => {
    const { transport } = build({ enabled: false });
    await expect(transport.availability()).resolves.toEqual({ kind: 'adapter-unavailable' });
  });

  it('initialises BEFORE it asks whether the adapter is enabled', async () => {
    // Order matters: `initialize()` is what prompts on Android. Asking
    // `isEnabled()` first would report adapter-unavailable to a rider who had
    // simply not been asked yet.
    const { plugin, transport } = build();
    await transport.availability();
    expect(plugin.calls).toEqual(['initialize', 'isEnabled']);
  });
});

describe('discovery', () => {
  it('filters the chooser on the services the wanted capabilities imply', async () => {
    const { plugin, transport } = build({}, [heartRateProfile, compositeProfile]);
    await transport.discover({ capabilities: ['heart-rate'] });
    expect(plugin.lastRequest?.services).toEqual([HEART_RATE_SERVICE]);
  });

  it('offers EVERY known service as optional, not only the filtered ones', async () => {
    // A trainer chosen for power is unusable for control if FTMS was not in
    // `optionalServices`, and the failure arrives with no error at connect time.
    const { plugin, transport } = build({}, [heartRateProfile, compositeProfile]);
    await transport.discover({ capabilities: ['heart-rate'] });
    expect(plugin.lastRequest?.optionalServices).toEqual([HEART_RATE_SERVICE, POWER_SERVICE]);
  });

  it('reports a cancelled chooser as no-device-selected, never as a fault', async () => {
    const { transport } = build({ chooserRejectsWith: new Error('userCancelled') });
    await expect(transport.discover({ capabilities: [] })).rejects.toMatchObject({
      code: 'no-device-selected',
    });
  });

  it('stamps the Android transport on the identity it issues', async () => {
    const { transport } = build();
    const device = await transport.discover({ capabilities: [] });
    expect(device.identity.transport).toBe(ANDROID_BLE);
    expect(device.identity.id).toBe(SCRIPTED_DEVICE.deviceId);
    expect(device.name).toBe(SCRIPTED_DEVICE.name);
  });
});

describe('the Android disconnect-before-connect workaround', () => {
  it('disconnects before every connect', async () => {
    // The plugin documents that on some Android devices `connect()` fails for a
    // peripheral connected earlier in the process, and that the caller must
    // disconnect first. `packages/sensors/src/transport.ts` says this belongs
    // INSIDE the adapter -- an interface exposing it as a flag or a calling
    // order would make every other transport carry one vendor's firmware bug.
    const { plugin, device } = await connected();
    const order = plugin.calls.filter(
      (call) => call.startsWith('connect') || call.startsWith('disconnect'),
    );
    expect(order).toEqual([`disconnect:${device.identity.id}`, `connect:${device.identity.id}`]);
  });

  it('costs nothing on a first connect, because a disconnect of nothing is a no-op', async () => {
    const { transport, device } = await connected();
    expect(transport.connectionState(device.identity.id)).toBe('connected');
  });
});

describe('connecting', () => {
  it('is idempotent for a device that is already connected', async () => {
    const { plugin, transport, device } = await connected();
    const before = plugin.calls.length;
    await transport.connect(device.identity.id);
    expect(plugin.calls.length).toBe(before);
  });

  it('returns to disconnected when the link cannot be established', async () => {
    const { transport } = build({ connectRejectsWith: new Error('gatt 133') });
    const device = await transport.discover({ capabilities: [] });
    await expect(transport.connect(device.identity.id)).rejects.toMatchObject({
      code: 'adapter-unavailable',
    });
    // Not left in `connecting`. A device stuck mid-transition can never be
    // retried, because `connect` would find it not-disconnected and return.
    expect(transport.connectionState(device.identity.id)).toBe('disconnected');
  });

  it('narrows the device’s capabilities to what its Feature characteristic declares', async () => {
    const noCadence = new DataView(new Uint8Array([0]).buffer);
    const { device } = await connected(
      { reads: { [`${POWER_SERVICE}|${POWER_FEATURE}`]: noCadence } },
      [describingProfile],
    );
    expect([...device.capabilities]).toEqual(['power']);
  });

  it('keeps the profile’s full list when the Feature read fails', async () => {
    // A device that serves Measurement and not Feature is out of spec and
    // common. Refusing it every capability would be worse than trusting the
    // profile -- the rule `GattProfile.describe` states.
    const { device } = await connected({}, [describingProfile]);
    expect([...device.capabilities].sort()).toEqual(['cadence', 'power']);
  });
});

describe('measurements', () => {
  it('delivers only the capability that was subscribed to from a composite frame', async () => {
    const { plugin, transport, device } = await connected();
    const seen: string[] = [];
    await transport.subscribe(device.identity.id, 'power', (measurement) => {
      seen.push(`${measurement.capability}=${String(measurement.power)}`);
    });
    plugin.notify(POWER_SERVICE, POWER_CHARACTERISTIC, new DataView(new ArrayBuffer(4)));
    expect(seen).toEqual(['power=220']);
  });

  it('decodes a real Heart Rate frame through the shared profile, not a local copy', async () => {
    // The point of this case is the seam, not the arithmetic: the byte layout
    // is decoded by `@onyourleft/sensors/protocol`, exactly as the browser
    // adapter decodes it, which is what "the same parser, unchanged" means.
    const { plugin, transport, device } = await connected({}, [heartRateProfile]);
    const seen: number[] = [];
    await transport.subscribe(device.identity.id, 'heart-rate', (measurement) => {
      seen.push(measurement.heartRate);
    });
    // Flags 0x00 -> uint8 heart rate.
    plugin.notify(
      HEART_RATE_SERVICE,
      HEART_RATE_MEASUREMENT,
      new DataView(new Uint8Array([0x00, 72]).buffer),
    );
    expect(seen).toEqual([beatsPerMinute(72)]);
  });

  it('refuses to subscribe on a device that is not connected', async () => {
    const { transport } = build();
    const device = await transport.discover({ capabilities: [] });
    await expect(
      transport.subscribe(device.identity.id, 'power', () => undefined),
    ).rejects.toMatchObject({ code: 'not-connected' });
  });

  it('refuses a capability the device does not provide', async () => {
    const { transport, device } = await connected({}, [heartRateProfile]);
    await expect(
      transport.subscribe(device.identity.id, 'power', () => undefined),
    ).rejects.toMatchObject({ code: 'capability-unsupported' });
  });

  it('drops an unreadable notification and keeps the link', async () => {
    // Sensor data is untrusted input (SECURITY.md). A hostile payload makes one
    // notification unreadable; it does not break the connection.
    const { plugin, transport, device } = await connected({}, [heartRateProfile]);
    const seen: number[] = [];
    await transport.subscribe(device.identity.id, 'heart-rate', (m) => {
      seen.push(m.heartRate);
    });
    expect(() =>
      plugin.notify(HEART_RATE_SERVICE, HEART_RATE_MEASUREMENT, new DataView(new ArrayBuffer(0))),
    ).not.toThrow();
    plugin.notify(
      HEART_RATE_SERVICE,
      HEART_RATE_MEASUREMENT,
      new DataView(new Uint8Array([0x00, 61]).buffer),
    );
    expect(seen).toEqual([beatsPerMinute(61)]);
    expect(transport.connectionState(device.identity.id)).toBe('connected');
  });

  it('stops notifications when the last subscriber unsubscribes', async () => {
    const { plugin, transport, device } = await connected();
    const stop = await transport.subscribe(device.identity.id, 'power', () => undefined);
    stop();
    await Promise.resolve();
    expect(plugin.calls).toContain(`stopNotifications:${POWER_SERVICE}|${POWER_CHARACTERISTIC}`);
  });

  it('feeds EVERY subscriber on a shared characteristic from one frame', async () => {
    // The fan-out itself. With a count and a single registered callback the
    // second subscriber received nothing at all -- the callback closed over the
    // first sink and there was nowhere for another to go. Both subscriptions
    // are live here, so a "first one wins" implementation fails.
    const { plugin, transport, device } = await connected();
    const power: number[] = [];
    const cadence: number[] = [];
    await transport.subscribe(device.identity.id, 'power', (m) => {
      power.push(m.power);
    });
    await transport.subscribe(device.identity.id, 'cadence', (m) => {
      cadence.push(m.cadence);
    });
    plugin.notify(POWER_SERVICE, POWER_CHARACTERISTIC, new DataView(new ArrayBuffer(4)));
    expect(power).toEqual([watts(220)]);
    expect(cadence).toEqual([revolutionsPerMinute(88)]);
  });

  it('starts the shared characteristic’s notifications exactly once', async () => {
    const { plugin, transport, device } = await connected();
    await transport.subscribe(device.identity.id, 'power', () => undefined);
    await transport.subscribe(device.identity.id, 'cadence', () => undefined);
    expect(plugin.calls.filter((call) => call.startsWith('startNotifications'))).toHaveLength(1);
  });

  it('keeps a shared characteristic alive for a second subscriber', async () => {
    // One characteristic can serve more than one capability -- FTMS Indoor Bike
    // Data carries power, cadence and speed. Before the count existed, the
    // FIRST unsubscribe stopped the stream for the SECOND subscriber, so a
    // screen dropping its speed readout silently killed its own power readout.
    const { plugin, transport, device } = await connected();
    const cadence: number[] = [];
    const stopPower = await transport.subscribe(device.identity.id, 'power', () => undefined);
    await transport.subscribe(device.identity.id, 'cadence', (m) => {
      cadence.push(m.cadence);
    });
    stopPower();
    await Promise.resolve();
    expect(plugin.calls.filter((call) => call.startsWith('stopNotifications'))).toEqual([]);
    plugin.notify(POWER_SERVICE, POWER_CHARACTERISTIC, new DataView(new ArrayBuffer(4)));
    expect(cadence).toEqual([revolutionsPerMinute(88)]);
  });

  it('unsubscribing twice does not stop a characteristic a sibling is still reading', async () => {
    // A React effect cleanup running after a manual stop is the ordinary way to
    // get here. Removing a subscriber's own sink from the set is idempotent, so
    // this needs no flag to guard it — which is the reason the set replaced a
    // counter rather than being added beside one.
    const { plugin, transport, device } = await connected();
    const stopPower = await transport.subscribe(device.identity.id, 'power', () => undefined);
    await transport.subscribe(device.identity.id, 'cadence', () => undefined);
    stopPower();
    stopPower();
    await Promise.resolve();
    expect(plugin.calls.filter((call) => call.startsWith('stopNotifications'))).toEqual([]);
  });

  it('refuses a capability the device declared it cannot report', async () => {
    // #134's case: the profile CAN carry cadence, and this device's Feature
    // characteristic says it does not. Distinct from the profile not carrying
    // it at all, which is what the case above covers -- with only per-frame
    // flags to go on, "this trainer has no cadence" and "cadence dropped out"
    // are the same observation, which is why the declaration is read at all.
    const noCadence = new DataView(new Uint8Array([0]).buffer);
    const { transport, device } = await connected(
      { reads: { [`${POWER_SERVICE}|${POWER_FEATURE}`]: noCadence } },
      [describingProfile],
    );
    await expect(
      transport.subscribe(device.identity.id, 'cadence', () => undefined),
    ).rejects.toMatchObject({ code: 'capability-unsupported' });
  });

  it('unsubscribing twice stops notifications once', async () => {
    const { plugin, transport, device } = await connected();
    const stop = await transport.subscribe(device.identity.id, 'power', () => undefined);
    stop();
    stop();
    await Promise.resolve();
    const stops = plugin.calls.filter((call) => call.startsWith('stopNotifications'));
    expect(stops).toHaveLength(1);
  });

  it('drops a notification that arrives BETWEEN the link dropping and the stop landing', async () => {
    // The window the state guard in `buildSink` exists for, and the only case
    // that reaches it. `teardown` moves the state synchronously and then awaits
    // a GATT stop per characteristic; a notification already in flight arrives
    // inside that window with the plugin's listener still registered. Removing
    // the guard passed every other case in this file, because they all let the
    // stop land first -- which is exactly the shape of a rule that cannot fire.
    const { plugin, transport, device } = await connected();
    const seen: unknown[] = [];
    await transport.subscribe(device.identity.id, 'power', (m) => {
      seen.push(m);
    });
    plugin.dropLink();
    // No `await`: still the same tick, so the stop has not run.
    plugin.notify(POWER_SERVICE, POWER_CHARACTERISTIC, new DataView(new ArrayBuffer(4)));
    expect(seen).toEqual([]);
  });

  it('delivers nothing after the device drops out of range', async () => {
    const { plugin, transport, device } = await connected();
    const seen: unknown[] = [];
    await transport.subscribe(device.identity.id, 'power', (m) => {
      seen.push(m);
    });
    plugin.dropLink();
    await Promise.resolve();
    expect(transport.connectionState(device.identity.id)).toBe('disconnected');
    expect(seen).toEqual([]);
  });
});

describe('connection state', () => {
  it('reports a state change to an observer', async () => {
    const { transport } = build();
    const device = await transport.discover({ capabilities: [] });
    const seen: string[] = [];
    transport.observeConnectionState(device.identity.id, (state) => {
      seen.push(state);
    });
    await transport.connect(device.identity.id);
    expect(seen).toEqual(['connecting', 'connected']);
  });
});

describe('nothing throws synchronously', () => {
  // `packages/sensors/src/transport.ts` states the rule and says why it is easy
  // to break: the obvious `connect(id)` throws `device-not-found` before it has
  // created a promise, so `transport.connect(id).catch(show)` never sees it and
  // the UI shows nothing while the device silently fails. A test that only
  // asserts "it threw" passes over both, so each of these asserts the CALL
  // itself does not throw and the promise rejects.
  const unknown = 'not-a-device-this-transport-issued';

  it.each([
    ['connect', (t: SensorTransport) => t.connect(unknown as never)],
    ['disconnect', (t: SensorTransport) => t.disconnect(unknown as never)],
    ['subscribe', (t: SensorTransport) => t.subscribe(unknown as never, 'power', () => undefined)],
  ])('%s rejects rather than throwing', async (_name, call) => {
    const { transport } = build();
    let promise: Promise<unknown> | undefined;
    expect(() => {
      promise = call(transport);
    }).not.toThrow();
    await expect(promise).rejects.toSatisfy(isSensorError);
  });

  it('connectionState is the one method that MAY throw, because it is synchronous', () => {
    // Deliberately different, and stated so nobody "fixes" it: the interface
    // makes it synchronous because a device list asks for every row on every
    // frame, and a promise per row would be a promise per row.
    const { transport } = build();
    expect(() => transport.connectionState(unknown as never)).toThrow();
  });
});

describe('known devices', () => {
  it('is empty before anything has been chosen', async () => {
    await expect(build().transport.knownDevices()).resolves.toEqual([]);
  });

  it('returns a device chosen earlier, so a reconnect costs no chooser', async () => {
    const { transport } = build();
    await transport.discover({ capabilities: [] });
    const known = await transport.knownDevices();
    expect(known.map((one) => one.identity.id)).toEqual([SCRIPTED_DEVICE.deviceId]);
  });
});
