// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Capacitor BLE transport (#87) — `@onyourleft/sensors`' `SensorTransport`
 * over `@capacitor-community/bluetooth-le`.
 *
 * ⚠️ **#87's seventh acceptance criterion is that #39's interface is satisfied
 * UNCHANGED**: *"a diff of the shared package shows adapter additions only, no
 * interface edits"*. Nothing under `packages/sensors` was touched to make this
 * compile, and `transport.test.ts` pins the claim at compile time — the exported
 * factory is annotated `SensorTransport`, so a widened parameter or a dropped
 * method is a type error here rather than a discovery on a device.
 *
 * That the interface fits is not luck. `packages/sensors/src/transport.ts` chose
 * a **flat, `deviceId`-keyed** shape specifically because it is the shape the
 * native stacks and this plugin have, and Web Bluetooth's object graph is the
 * one that had to be flattened. This file is where that decision is collected
 * on: it keeps no handle map at all, because the plugin already is one.
 *
 * ## What lives here and what deliberately does not
 *
 * No service UUID and no payload arithmetic. Both belong to
 * `@onyourleft/sensors/protocol`, which is platform-free precisely so that this
 * adapter and the browser one share the decoders rather than writing them
 * twice. This file supplies bytes and an instant; the profiles supply meaning.
 *
 * No GATT queue either, and that is a deliberate non-duplication rather than an
 * omission: the plugin wraps every call in an internal `queue()`, which is
 * #86's stated reason for choosing it. ⚠️ **That was read from the plugin's own
 * source rather than assumed**, as #87's revision block asks — but it has NOT
 * been exercised against a device from here (README §4), so #87's fifth
 * criterion, two overlapping writes both completing, is undischarged.
 */

import {
  ANDROID_BLE,
  createDeviceSession,
  deviceId as toDeviceId,
  isSensorError,
  MAX_RECOMMENDED_CONCURRENT_CONNECTIONS,
  SensorError,
  type DeviceId,
  type ConnectionState,
  type DeviceSession,
  type DiscoveryRequest,
  type Listener,
  type MeasurementCapability,
  type MeasurementFor,
  type SensorCapability,
  type SensorDevice,
  type SensorMeasurement,
  type SensorTransport,
  type TransportAvailability,
  type TransportTraits,
  type Unsubscribe,
} from '@onyourleft/sensors';

import type { GattProfile, MeasurementSink } from '@onyourleft/sensors/protocol';

import { unixSeconds, type UnixSeconds } from '@onyourleft/domain';

import type { CapacitorBlePort, PluginDevice } from './plugin-port';

/**
 * How the transport is built.
 *
 * `profiles` is passed in rather than imported, for the reason #40 gives: a
 * profile that lands inside an adapter arrives without the specification
 * reading that makes it correct, so the adapter knows how to *use* a profile
 * and never which ones exist.
 */
export interface CapacitorTransportOptions {
  readonly plugin: CapacitorBlePort;
  readonly profiles: readonly GattProfile[];
  /**
   * The clock, injected.
   *
   * The measurement instant is read **once per notification, by the transport**
   * — see `GattProfile.decode`. A decoder reading its own clock would put a
   * `Date` inside the one directory with no platform surface, and would make
   * this adapter's timing untestable.
   */
  readonly now: () => UnixSeconds;
}

/**
 * What Android can do that a browser cannot, declared rather than sniffed.
 *
 * All four differ from the Web Bluetooth adapter's, which is the whole reason
 * `TransportTraits` exists: a caller branches on these and never on which
 * platform it believes it is running on.
 */
const ANDROID_TRAITS: TransportTraits = {
  id: ANDROID_BLE,
  // No `requestDevice()` user-activation rule on Android. A shell may offer
  // "scan when the ride screen opens", which the browser may not.
  requiresUserGestureToDiscover: false,
  // `getDevices(ids)` returns previously-seen peripherals, so a reconnect after
  // an app restart costs no chooser. This is the difference that makes
  // `reconnecting` a state this transport can actually reach.
  canReconnectWithoutUserGesture: true,
  // With the connectedDevice foreground service holding the process up.
  // ⚠️ True *because* `RecordingService` exists; it would be a lie without it.
  canRestoreConnectionsInBackground: true,
  // Three, not the seven Android is reported to manage. The budget is OS-wide
  // and shared with whatever else the rider has paired — earbuds and a watch
  // have already spent part of it, and nothing inside this app can see that.
  maxConcurrentConnections: MAX_RECOMMENDED_CONCURRENT_CONNECTIONS,
};

/** Per-device bookkeeping. The plugin owns the link; this owns what it means. */
interface Link {
  readonly session: DeviceSession;
  /** The plugin's own opaque id, which is not necessarily our `DeviceId`. */
  readonly pluginId: string;
  /**
   * Started notifications, keyed `service|characteristic`.
   *
   * ⚠️ **A SET of sinks, not one teardown and not a count.** One characteristic
   * can serve more than one capability — FTMS Indoor Bike Data carries power,
   * cadence and speed — so two subscriptions legitimately share one started
   * notification, and both defects that follow from getting this wrong were
   * found by mutation rather than by review.
   *
   * With a single teardown, the FIRST unsubscribe stopped the stream for the
   * SECOND subscriber: a screen dropping its speed readout silently killed its
   * own power readout. With a count and a single registered callback, the
   * second subscriber received **nothing at all**, because the callback closed
   * over the first sink and there was nowhere for a second one to go. The set
   * fixes both, and makes an unsubscribe idempotent for free.
   */
  readonly notifying: Map<
    string,
    { readonly stop: () => Promise<void>; readonly sinks: Set<MeasurementSink> }
  >;
}

/**
 * Everything below rejects; nothing throws synchronously.
 *
 * `packages/sensors/src/transport.ts` states the rule and says why it is easy
 * to break: the obvious `connect(id)` looks the device up and throws
 * `device-not-found` before it has created a promise, so a caller written the
 * ordinary way never sees it and the UI shows nothing while the device silently
 * fails to connect. Every method here is `async`, which makes a throw a
 * rejection by construction rather than by discipline.
 */
export function createCapacitorTransport(options: CapacitorTransportOptions): SensorTransport {
  const { plugin, profiles, now } = options;
  const links = new Map<DeviceId, Link>();
  /** Plugin ids seen this session, so `knownDevices` has something to ask for. */
  const seen = new Set<string>();

  const linkFor = (id: DeviceId): Link => {
    const link = links.get(id);
    if (link === undefined) {
      throw new SensorError('device-not-found', 'this transport did not issue that device id', {
        deviceId: id,
      });
    }
    return link;
  };

  const profileFor = (capability: MeasurementCapability, device: SensorDevice): GattProfile => {
    for (const profile of profiles) {
      if (profile.capabilities.includes(capability) && device.capabilities.has(capability)) {
        return profile;
      }
    }
    throw new SensorError('capability-unsupported', `this device does not report ${capability}`, {
      deviceId: device.identity.id,
    });
  };

  /**
   * Turn a plugin device into ours, with the capabilities its services imply.
   *
   * ⚠️ Narrowed on the link by each profile's `describe` characteristic, in
   * `connect`. The profile's list is what the *service* can carry; the Feature
   * read is what *this* device says it can, and #134 is the issue that
   * established the difference — with only per-frame flags to go on, "this
   * trainer has no cadence" and "cadence dropped out" are the same observation.
   */
  const adopt = (found: PluginDevice, wanted: readonly SensorCapability[]): SensorDevice => {
    const id = toDeviceId(found.deviceId);
    const capabilities = new Set<SensorCapability>();
    for (const profile of profiles) {
      for (const capability of profile.capabilities) {
        if (wanted.length === 0 || wanted.includes(capability)) {
          capabilities.add(capability);
        }
      }
      for (const control of profile.controls ?? []) {
        if (wanted.length === 0 || wanted.includes(control)) {
          capabilities.add(control);
        }
      }
    }
    return {
      identity: { transport: ANDROID_BLE, id },
      ...(found.name === undefined ? {} : { name: found.name }),
      capabilities,
      undeclared: new Set<SensorCapability>(),
    };
  };

  const servicesFor = (capabilities: readonly SensorCapability[]): string[] => {
    const services = new Set<string>();
    for (const profile of profiles) {
      const carries =
        capabilities.length === 0 ||
        capabilities.some(
          (wanted) =>
            (profile.capabilities as readonly SensorCapability[]).includes(wanted) ||
            (profile.controls ?? []).includes(wanted as never),
        );
      if (carries) {
        services.add(profile.service);
      }
    }
    return [...services];
  };

  return {
    traits: ANDROID_TRAITS,

    async availability(): Promise<TransportAvailability> {
      try {
        // ⚠️ This is the call that prompts on Android, so a denial surfaces
        // here and nowhere else. Asking `isEnabled()` first would report
        // `adapter-unavailable` for a rider who had simply not been asked yet,
        // which is the wrong screen and the wrong advice.
        await plugin.initialize();
      } catch (error) {
        return { kind: deniedByPermission(error) ? 'not-permitted' : 'unsupported' };
      }
      try {
        return (await plugin.isEnabled()) ? { kind: 'available' } : { kind: 'adapter-unavailable' };
      } catch {
        return { kind: 'adapter-unavailable' };
      }
    },

    async discover(request: DiscoveryRequest): Promise<SensorDevice> {
      const services = servicesFor(request.capabilities);
      let found: PluginDevice;
      try {
        found = await plugin.requestDevice({
          services,
          // Every service this program knows, not only the ones filtered on: a
          // trainer chosen for power is unusable for control if FTMS was not in
          // this list, and the failure comes with no error at connect time.
          optionalServices: servicesFor([]),
          ...(request.namePrefix === undefined ? {} : { namePrefix: request.namePrefix }),
        });
      } catch (error) {
        // Cancelling the chooser is the ordinary outcome of pressing cancel and
        // must not be rendered as a fault.
        throw isSensorError(error)
          ? error
          : new SensorError('no-device-selected', 'no device was chosen', { cause: error });
      }
      const device = adopt(found, request.capabilities);
      seen.add(found.deviceId);
      links.set(device.identity.id, {
        session: createDeviceSession(device),
        pluginId: found.deviceId,
        notifying: new Map(),
      });
      return device;
    },

    async knownDevices(): Promise<readonly SensorDevice[]> {
      if (seen.size === 0) {
        return [];
      }
      const found = await plugin.getDevices([...seen]);
      return found.map((one) => adopt(one, []));
    },

    async connect(id: DeviceId): Promise<void> {
      const link = linkFor(id);
      if (link.session.state === 'connected') {
        return;
      }
      if (links.size > ANDROID_TRAITS.maxConcurrentConnections) {
        throw new SensorError(
          'connection-budget-exceeded',
          `this transport holds at most ${String(ANDROID_TRAITS.maxConcurrentConnections)} devices`,
          { deviceId: id },
        );
      }

      link.session.transitionTo('connecting');

      // ⚠️ The Android disconnect-before-connect workaround, and it is HERE on
      // purpose. `packages/sensors/src/transport.ts` says an interface that
      // exposed it — as a flag, a documented calling order or a
      // `forceDisconnect` option — would have failed, because every other
      // transport would then carry a parameter describing one vendor's firmware
      // bug. The plugin documents that `connect()` fails on some Android
      // devices for a peripheral that was connected before; a disconnect for a
      // device that is not connected is a no-op, so this costs nothing on the
      // first connect and is not conditional on a guess about the firmware.
      try {
        await plugin.disconnect(link.pluginId);
      } catch {
        // Expected for a device that was never connected. Swallowed rather than
        // logged: it is the ordinary path, not an anomaly.
      }

      try {
        await plugin.connect(link.pluginId, () => {
          void teardown(link, 'disconnected');
        });
      } catch (error) {
        link.session.transitionTo('disconnected');
        throw isSensorError(error)
          ? error
          : new SensorError('adapter-unavailable', 'the link could not be established', {
              deviceId: id,
              cause: error,
            });
      }

      await narrowCapabilities(link);
      link.session.transitionTo('connected');
    },

    async disconnect(id: DeviceId): Promise<void> {
      const link = linkFor(id);
      if (link.session.state === 'disconnected') {
        return;
      }
      await teardown(link, 'disconnected');
      await plugin.disconnect(link.pluginId);
    },

    connectionState(id: DeviceId) {
      return linkFor(id).session.state;
    },

    observeConnectionState(id: DeviceId, listener: Listener<ConnectionState>): Unsubscribe {
      return linkFor(id).session.onStateChange(listener);
    },

    async subscribe<Capability extends MeasurementCapability>(
      id: DeviceId,
      capability: Capability,
      listener: Listener<MeasurementFor<Capability>>,
    ): Promise<Unsubscribe> {
      const link = linkFor(id);
      if (link.session.state !== 'connected') {
        throw new SensorError('not-connected', 'a device must be connected to report', {
          deviceId: id,
        });
      }
      const profile = profileFor(capability, link.session.device);

      // One sink per characteristic per link, built once and reused. #40's
      // fifth criterion is that notification handling allocates nothing per
      // notification, and the sink is where that is won or lost.
      // ⚠️ The one cast in this file. `buildSink` gates on
      // `measurement.capability === capability` before it calls, so what
      // arrives IS a `MeasurementFor<Capability>`; TypeScript cannot narrow a
      // generic against a runtime comparison, and the alternative is four
      // duplicate `subscribe` bodies.
      const sink = buildSink(link, capability, (measurement) => {
        listener(measurement as MeasurementFor<Capability>);
      });
      const key = `${profile.service}|${profile.characteristic}`;

      let started = link.notifying.get(key);
      if (started === undefined) {
        const sinks = new Set<MeasurementSink>();
        await plugin.startNotifications(
          link.pluginId,
          profile.service,
          profile.characteristic,
          (value) => {
            // The instant is read ONCE per notification, before any decoding,
            // so every measurement fanned out of one composite frame carries
            // the same `at` — which `MeasurementEnvelope` requires.
            const at = now();
            for (const one of sinks) {
              try {
                profile.decode(value, one, at);
              } catch {
                // A hostile or malformed payload is expected. The notification
                // is unreadable; the link is not broken. SECURITY.md treats
                // sensor data as untrusted input and this is the whole of the
                // response — and it is per sink, so one subscriber's decoder
                // throwing does not rob the others of the same frame.
              }
            }
          },
        );
        started = {
          stop: async () => {
            await plugin.stopNotifications(link.pluginId, profile.service, profile.characteristic);
          },
          sinks,
        };
        link.notifying.set(key, started);
      }
      started.sinks.add(sink);
      const entry = started;

      return () => {
        // Synchronous, because a caller unsubscribing during teardown has
        // nothing useful to do with a promise. The GATT stop is fired and not
        // awaited for the same reason.
        //
        // Removing this subscriber's own sink is idempotent, so a caller that
        // unsubscribes twice — a React effect cleanup running after a manual
        // stop is the ordinary way — needs no guard here and cannot take a
        // sibling's subscription down with it.
        entry.sinks.delete(sink);
        if (entry.sinks.size > 0 || link.notifying.get(key) !== entry) {
          return;
        }
        link.notifying.delete(key);
        void entry.stop().catch(() => undefined);
      };
    },
  };

  /**
   * Ask each profile's `describe` characteristic what THIS device can report.
   *
   * ⚠️ A failed read keeps the profile's full list rather than emptying it. A
   * device that serves Measurement and not Feature is out of spec and common,
   * and refusing it every capability would be worse than trusting the profile —
   * the rule `GattProfile.describe` states, applied here.
   */
  async function narrowCapabilities(link: Link): Promise<void> {
    const device = link.session.device;
    for (const profile of profiles) {
      const describe = profile.describe;
      if (describe === undefined) {
        continue;
      }
      if (!profile.capabilities.some((one) => device.capabilities.has(one))) {
        continue;
      }
      let declared: readonly MeasurementCapability[];
      try {
        declared = describe.declared(
          await plugin.read(link.pluginId, profile.service, describe.characteristic),
        );
      } catch {
        continue;
      }
      for (const capability of profile.capabilities) {
        if (!declared.includes(capability)) {
          (device.capabilities as Set<SensorCapability>).delete(capability);
        }
      }
    }
  }

  /**
   * ⚠️ The state moves FIRST, before the GATT notification stops are awaited.
   *
   * A device that has dropped out of range is disconnected now, not once a
   * stack has finished acknowledging some unsubscribes it can no longer
   * deliver. Doing it the other way round leaves a window -- one microtask per
   * started characteristic -- in which `connectionState` says `connected` for a
   * link that is gone and `buildSink`'s gate still lets a queued notification
   * through. Found by the "delivers nothing after the device drops out of
   * range" case, which failed on exactly that window.
   */
  async function teardown(link: Link, next: 'disconnected'): Promise<void> {
    link.session.transitionTo(next);
    const started = [...link.notifying.values()];
    link.notifying.clear();
    for (const entry of started) {
      await entry.stop().catch(() => undefined);
    }
  }

  function buildSink(
    link: Link,
    capability: MeasurementCapability,
    listener: (measurement: SensorMeasurement) => void,
  ): MeasurementSink {
    // A frame can carry more than the capability that was subscribed to --
    // Indoor Bike Data carries power, cadence and speed at once. Only what was
    // asked for is delivered; the rest is dropped rather than raised, because a
    // device sending a field nobody asked for is not an error.
    const deliver = (measurement: SensorMeasurement): void => {
      if (measurement.capability !== capability || link.session.state !== 'connected') {
        return;
      }
      listener(measurement);
    };

    // Four constructors rather than one generic one. The envelope names its
    // value after the capability -- `power`, `cadence`, `heartRate`, `speed` --
    // so this is where the mapping lives, and writing it out is what lets every
    // measurement below be built with no cast at all.
    const device = link.session.device.identity;
    return {
      power: (value) => {
        deliver({ capability: 'power', device, at: now(), power: value });
      },
      cadence: (value) => {
        deliver({ capability: 'cadence', device, at: now(), cadence: value });
      },
      'heart-rate': (value) => {
        deliver({ capability: 'heart-rate', device, at: now(), heartRate: value });
      },
      speed: (value) => {
        deliver({ capability: 'speed', device, at: now(), speed: value });
      },
    };
  }
}

/**
 * Whether the plugin refused because permission was denied.
 *
 * ⚠️ Read from the message, because the plugin's Android bridge rejects with a
 * plain `Error` and no code. That is a weak test and it is written as one: an
 * unrecognised failure falls through to `unsupported`, which is the outcome
 * that offers no retry, rather than to `not-permitted`, which offers a settings
 * screen for a problem a settings screen may not fix. Guessing in the direction
 * of the more useful screen would be guessing in the direction of the more
 * confident lie.
 */
function deniedByPermission(error: unknown): boolean {
  if (isSensorError(error)) {
    return error.code === 'not-permitted';
  }
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return message.includes('permission') || message.includes('denied');
}

/** The clock the shell uses. Separate so a test never has to stub a global. */
export function systemClock(): UnixSeconds {
  return unixSeconds(Math.floor(Date.now() / 1000));
}
