// SPDX-License-Identifier: AGPL-3.0-or-later

import { beatsPerMinute, revolutionsPerMinute, unixSeconds, watts } from '@onyourleft/domain';
import {
  ANDROID_BLE,
  isSensorError,
  MAX_RECOMMENDED_CONCURRENT_CONNECTIONS,
  SensorError,
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
import {
  NOT_INITIALIZED_MESSAGE,
  SCRIPTED_DEVICE,
  scriptedPort,
  type ScriptedPort,
  type ScriptedStack,
} from './testing';

const AT = unixSeconds(1_757_000_000);

/** A payload for the write guards below, whose bytes nothing reads. */
const EMPTY_VALUE = new DataView(new ArrayBuffer(1));

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
    // The plugin's own wording, from `DeviceScanner.kt`'s two cancel handlers,
    // rather than a paraphrase: this is the string the mapping actually meets.
    const { transport } = build({ chooserRejectsWith: new Error('requestDevice cancelled.') });
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

describe('the stack is brought up before the first call that needs it (#230)', () => {
  // ⚠️ The bug this file could not see. `initialize()` lived in `availability()`
  // alone and nothing in `apps/web` calls `availability()`, so on a real phone
  // every `discover()` reached `requestDevice()` with the plugin uninitialised
  // and no sensor could be paired at all. The suite stayed green because the
  // double allowed the out-of-order call; `testing.ts` now refuses it, which is
  // what turns the paragraphs below into assertions.

  it('initialises BEFORE it opens the chooser, on the path pressing Pair takes', async () => {
    const { plugin, transport } = build();
    await transport.discover({ capabilities: [] });
    expect(plugin.calls).toEqual(['initialize', 'requestDevice']);
  });

  it('does not initialise a second time when a second sensor is paired', async () => {
    // The idempotency criterion: once per transport. A second initialise would
    // re-ask the platform while a link is already up.
    const { plugin, transport } = build();
    await transport.discover({ capabilities: [] });
    await transport.discover({ capabilities: [] });
    expect(plugin.calls.filter((call) => call === 'initialize')).toHaveLength(1);
  });

  it('initialises once when two pairings race, because the PROMISE is what is kept', async () => {
    // A flag set after the await would let two concurrent callers both find it
    // false and both initialise. Memoising the promise is what makes this one.
    const { plugin, transport } = build();
    await Promise.all([
      transport.discover({ capabilities: [] }),
      transport.discover({ capabilities: [] }),
    ]);
    expect(plugin.calls.filter((call) => call === 'initialize')).toHaveLength(1);
  });

  it('initialises before it asks the plugin for remembered devices', async () => {
    const { plugin, transport } = build();
    await transport.discover({ capabilities: [] });
    await transport.knownDevices();
    expect(plugin.calls[0]).toBe('initialize');
    expect(plugin.calls.filter((call) => call === 'initialize')).toHaveLength(1);
  });

  it('asks the plugin nothing at all when there is nothing to ask it for', async () => {
    // `knownDevices` with an empty set brings no stack up: the call that needs
    // the plugin initialises, and one that does not, does not.
    const { plugin, transport } = build();
    await expect(transport.knownDevices()).resolves.toEqual([]);
    expect(plugin.calls).toEqual([]);
  });

  it('tries again after a failed initialisation, so a granted permission can be retried', async () => {
    // ⚠️ A memoised REJECTION would mean that granting the permission and
    // pressing Pair again did nothing until the app was restarted — which is
    // the "Try again that cannot work" #87 criterion 8 exists to prevent.
    const plugin = scriptedPort();
    let denials = 1;
    const denyingOnce = {
      ...plugin,
      initialize: async (): Promise<void> => {
        if (denials > 0) {
          denials -= 1;
          return Promise.reject(new Error('Location permission was denied'));
        }
        return plugin.initialize();
      },
    };
    const transport: SensorTransport = createCapacitorTransport({
      plugin: denyingOnce,
      profiles: [compositeProfile],
      now: () => AT,
    });

    await expect(transport.discover({ capabilities: [] })).rejects.toMatchObject({
      code: 'not-permitted',
    });
    await expect(transport.discover({ capabilities: [] })).resolves.toMatchObject({
      identity: { id: SCRIPTED_DEVICE.deviceId },
    });
  });

  it('reports a permission denial at PAIRING as not-permitted, not as a cancelled chooser', async () => {
    // The rider-facing half of the bug: an initialisation failure was rendered
    // as "no device was chosen", telling a rider they had declined a chooser
    // that never appeared.
    const { transport } = build({
      initializeRejectsWith: new Error('Location permission was denied'),
    });
    await expect(transport.discover({ capabilities: [] })).rejects.toMatchObject({
      code: 'not-permitted',
    });
  });

  it('reports an unplaceable initialisation failure as transport-unsupported', async () => {
    const { transport } = build({ initializeRejectsWith: new Error('BLE stack unavailable') });
    await expect(transport.discover({ capabilities: [] })).rejects.toMatchObject({
      code: 'transport-unsupported',
    });
  });

  it('reads one initialisation failure the same way on both paths', async () => {
    // #230 criterion 3: the permission mapping `availability()` has always done
    // must not be lost by the pairing path having its own copy of it. One
    // classifier, two renderings, asserted together.
    const denial = { initializeRejectsWith: new Error('Location permission was denied') };
    await expect(build(denial).transport.availability()).resolves.toEqual({
      kind: 'not-permitted',
    });
    await expect(build(denial).transport.discover({ capabilities: [] })).rejects.toMatchObject({
      code: 'not-permitted',
    });
  });

  it('keeps the plugin’s own words out of what a rider is shown', async () => {
    // SECURITY.md: a platform BLE message can name a device address or a
    // neighbour's advertised name, and `pairingError` in `apps/web` renders the
    // SensorError's message verbatim. The original stays on `cause`.
    const platform = new Error('Location permission was denied for 64:32:A8:11:22:33');
    const { transport } = build({ initializeRejectsWith: platform });
    await expect(transport.discover({ capabilities: [] })).rejects.toMatchObject({
      message: 'Bluetooth permission has not been granted',
      cause: platform,
    });
  });
});

describe('the scripted plugin enforces the ordering the real one has (#230)', () => {
  // The fixture change IS the fix here, not an incidental: with the double
  // permitting a chooser before initialisation, every assertion above could be
  // green against a product that cannot pair with anything.

  it('refuses requestDevice before initialize, exactly as the device did', async () => {
    const plugin = scriptedPort();
    await expect(plugin.requestDevice({ services: [], optionalServices: [] })).rejects.toThrowError(
      NOT_INITIALIZED_MESSAGE,
    );
  });

  it('leaves the stack down when initialize itself was refused', async () => {
    const plugin = scriptedPort({ initializeRejectsWith: new Error('denied') });
    await expect(plugin.initialize()).rejects.toThrowError('denied');
    await expect(plugin.isEnabled()).rejects.toThrowError(NOT_INITIALIZED_MESSAGE);
  });

  /**
   * Every call the plugin guards, and how to make it.
   *
   * A table rather than one case for `requestDevice`, because the plugin's
   * `assertBluetoothAdapter` guards all of them and a double that modelled the
   * precondition on only the method somebody remembered is the same shape of
   * permissiveness this issue is about — one layer down.
   */
  const guarded: readonly [string, (port: ScriptedPort) => Promise<unknown>][] = [
    ['isEnabled', (port) => port.isEnabled()],
    ['requestDevice', (port) => port.requestDevice({ services: [], optionalServices: [] })],
    ['getDevices', (port) => port.getDevices(['AA:BB'])],
    ['connect', (port) => port.connect('AA:BB', () => undefined)],
    ['disconnect', (port) => port.disconnect('AA:BB')],
    ['read', (port) => port.read('AA:BB', 'service', 'characteristic')],
    [
      'startNotifications',
      (port) => port.startNotifications('AA:BB', 'service', 'characteristic', () => undefined),
    ],
    ['stopNotifications', (port) => port.stopNotifications('AA:BB', 'service', 'characteristic')],
    ['write', (port) => port.write('AA:BB', 'service', 'characteristic', EMPTY_VALUE)],
    [
      'writeWithoutResponse',
      (port) => port.writeWithoutResponse('AA:BB', 'service', 'characteristic', EMPTY_VALUE),
    ],
  ];

  it.each(guarded)('refuses %s before initialize', async (_name, call) => {
    await expect(call(scriptedPort())).rejects.toThrowError(NOT_INITIALIZED_MESSAGE);
  });

  it('covers every method the port has, so a new one cannot arrive unguarded', () => {
    // Derived from the object rather than written down twice. A method added to
    // `CapacitorBlePort` without a row above fails HERE, rather than sitting
    // outside the constraint the way `requestDevice` did until #230.
    const port = scriptedPort();
    const testOnly = new Set(['notify', 'dropLink']);
    const methods = Object.entries(port)
      .filter(([name, value]) => typeof value === 'function' && !testOnly.has(name))
      .map(([name]) => name)
      .sort();
    expect(methods).toEqual(['initialize', ...guarded.map(([name]) => name)].sort());
  });

  it('records the refused call, because the real plugin received it', async () => {
    const plugin = scriptedPort();
    await expect(plugin.connect('AA:BB', () => undefined)).rejects.toThrowError(
      NOT_INITIALIZED_MESSAGE,
    );
    expect(plugin.calls).toEqual(['connect:AA:BB']);
  });
});

describe('a failure at the chooser is reported as itself (#230)', () => {
  it.each([
    ['requestDevice cancelled.', 'no-device-selected'],
    ['No device found.', 'no-device-selected'],
    ['Location permission was denied', 'not-permitted'],
    // ⚠️ The one the bug produced. Reported as a fault the rider can retry,
    // never as an accusation that they pressed cancel.
    [NOT_INITIALIZED_MESSAGE, 'adapter-unavailable'],
    ['Already scanning. Stopping now.', 'adapter-unavailable'],
  ])('%s becomes %s', async (message, code) => {
    const { transport } = build({ chooserRejectsWith: new Error(message) });
    await expect(transport.discover({ capabilities: [] })).rejects.toMatchObject({ code });
  });

  it('does not call an unrecognised chooser failure a cancellation', async () => {
    // Stated separately from the table because it is the regression itself: the
    // old catch answered `no-device-selected` for every one of these.
    const { transport } = build({ chooserRejectsWith: new Error('gatt failure 133') });
    await expect(transport.discover({ capabilities: [] })).rejects.not.toMatchObject({
      code: 'no-device-selected',
    });
  });

  it('keeps a SensorError the plugin layer already classified', async () => {
    const { transport } = build({
      chooserRejectsWith: new SensorError('not-permitted', 'already classified'),
    });
    await expect(transport.discover({ capabilities: [] })).rejects.toMatchObject({
      code: 'not-permitted',
      message: 'already classified',
    });
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
