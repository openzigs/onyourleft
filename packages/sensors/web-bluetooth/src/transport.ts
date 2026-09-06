// SPDX-License-Identifier: Apache-2.0

/**
 * The Web Bluetooth adapter: `SensorTransport`, over `navigator.bluetooth`.
 *
 * ## The flattening, which `../../src/transport.ts` says is this file's job
 *
 * Web Bluetooth is an object graph — device → server → service → characteristic
 * → `startNotifications()` — and `SensorTransport` is flat and keyed by
 * `DeviceId`, because CoreBluetooth and the Android GATT APIs are flat and #15
 * has to satisfy the same interface without rewriting the protocol layer. The
 * map from one to the other is `records`, below, and **this is the only file in
 * the program where a `BluetoothDevice` exists**.
 *
 * ## The three lifecycle facts everything here is arranged around
 *
 * 1. **A device object outlives its link.** `BluetoothDevice` stays valid and
 *    `gatt.connected` goes false. Every service and characteristic handle
 *    resolved on that link, however, is dead: Chrome rejects
 *    `startNotifications()` on a stale one with `InvalidStateError`. So the
 *    device object and its `DeviceSession` live in `records` for the life of
 *    the page, and everything resolved from a link lives in `link`, which is
 *    thrown away and rebuilt on every connect.
 * 2. **A disconnect can arrive in the middle of anything.** Trainers and power
 *    meters drop mid-ride routinely; the issue calls it *"the normal case, not
 *    the edge case"*. Every GATT call therefore goes through `queue.run` with
 *    the owning `DeviceId`, and `gattserverdisconnected` calls
 *    `queue.abandon`, so a pending operation is rejected rather than left
 *    unsettled. See `queue.ts` for why that has to release the slot too.
 * 3. **There is no silent reconnect, and there will not be one in 2026.**
 *    `getDevices()`, `watchAdvertisements()` and Persistent Device Permissions
 *    all exist behind `chrome://flags`, with `watchAdvertisements` absent on
 *    ChromeOS and Linux entirely and MDN marking `getDevices()` "Limited
 *    availability / Experimental". So `knownDevices()` returns nothing, this
 *    transport never enters `reconnecting`, and reconnection is the caller
 *    calling `connect` again — for which no gesture is needed, because only
 *    `requestDevice()` requires one. What the adapter owes on that reconnect is
 *    that the subscriptions the caller still holds start delivering again, and
 *    that it has not accumulated a second notification handler while doing it.
 *
 * ## What is not here
 *
 * **No profile.** Not one service UUID, not one byte of payload. #41 supplies
 * Heart Rate, #42 Cycling Speed and Cadence, #43 FTMS and Cycling Power, each
 * as a `GattProfile` (`profile.ts`) passed to `createWebBluetoothTransport`. An
 * adapter that also decoded would be an adapter whose protocol work was
 * reviewed as plumbing.
 */

import { unixSeconds, type Seconds, type UnixSeconds } from '@onyourleft/domain';

import type { MeasurementCapability, SensorCapability } from '../../src/capability';
import type { ConnectionState } from '../../src/connection';
import {
  deviceId as labelDeviceId,
  WEB_BLUETOOTH,
  type DeviceId,
  type DeviceIdentity,
  type SensorDevice,
} from '../../src/device';
import { SensorError } from '../../src/errors';
import { isMeasurementOf, type MeasurementFor } from '../../src/measurement';
import { MAX_RECOMMENDED_CONCURRENT_CONNECTIONS } from '../../src/plan';
import { createDeviceSession, type DeviceSession } from '../../src/session';
import type { Listener, Unsubscribe } from '../../src/subscription';
import type {
  DiscoveryRequest,
  SensorTransport,
  TransportAvailability,
  TransportTraits,
} from '../../src/transport';
import {
  decodeFitnessMachineFeature,
  decodeSupportedPowerRange,
  decodeSupportedResistanceLevelRange,
  FITNESS_MACHINE_CONTROL_POINT,
  FITNESS_MACHINE_FEATURE,
  FITNESS_MACHINE_SERVICE,
  FITNESS_MACHINE_STATUS,
  SUPPORTED_POWER_RANGE,
  SUPPORTED_RESISTANCE_LEVEL_RANGE,
  type FitnessMachineFeatures,
  type SupportedPowerRange,
  type SupportedResistanceLevelRange,
} from '../../protocol/src/fitness-machine';
import type { FitnessMachineChannel } from '../../protocol/src/fitness-machine-control';
import { readAvailability } from './availability';
import { connectionError, discoveryError, missingProfileError } from './errors';
import {
  createFitnessMachineChannel,
  type FitnessMachineCharacteristics,
} from './fitness-machine-channel';
import type {
  BluetoothDevicePort,
  BluetoothPort,
  BluetoothScanFilterPort,
  GattCharacteristicPort,
  GattServerPort,
  GattServicePort,
  GattUuid,
  RequestDevicePortOptions,
} from './gatt';
import { canonicalUuid, type GattProfile, type MeasurementSink } from './profile';
import { createGattQueue } from './queue';

export interface WebBluetoothTransportOptions {
  /**
   * The profiles this adapter can read, in preference order.
   *
   * When two profiles supply the same capability — FTMS and Cycling Power both
   * report power on a modern trainer — the **earlier** one wins for a device
   * that offers both, and the choice is fixed when the link is established
   * rather than per notification. That is the same rule `plan.ts` encodes and
   * the simulator implements, and it is what stops a trainer delivering two
   * power readings a second from two services.
   */
  readonly profiles: readonly GattProfile[];
  /**
   * `navigator.bluetooth`, or a stand-in.
   *
   * Defaults to `navigator.bluetooth` when there is a `navigator` with one, and
   * to `undefined` otherwise — which is what makes `availability()` answer
   * `unsupported` in Safari, in Firefox, over plain HTTP and in Node, instead
   * of throwing on the way to the answer.
   */
  readonly bluetooth?: BluetoothPort | undefined;
  /**
   * The receive instant stamped on every measurement.
   *
   * Injected so the hot-path test can run a simulated hour without waiting one.
   */
  readonly now?: (() => UnixSeconds) | undefined;
  /**
   * Whether a user activation is in progress.
   *
   * Checked **before** `requestDevice`, because Chrome reports a missing
   * gesture as `SecurityError` — the same name it uses for a Permissions Policy
   * refusal — and telling those apart afterwards would mean matching on an
   * unversioned exception message. Defaults to `navigator.userActivation`, and
   * to "yes" where that API does not exist, since blocking on a signal the
   * platform does not provide would make pairing impossible rather than safe.
   */
  readonly hasUserActivation?: (() => boolean) | undefined;
  /**
   * Called when a profile's `decode` throws.
   *
   * A notification is untrusted input from a device that may not be what it
   * claims (SECURITY.md), so a decoder that throws costs that one notification
   * and nothing else — the alternative is an exception escaping into the
   * browser's event dispatch, where nothing this program wrote can catch it.
   * The hook exists so a malformed stream is diagnosable rather than merely
   * silent; it is not on `SensorTransport`, because a transport that could not
   * offer one would then have to pretend.
   */
  readonly onProtocolError?: ((error: unknown) => void) | undefined;
  /**
   * How long one GATT operation may take before the adapter gives up on it.
   *
   * Defaults to `DEFAULT_GATT_OPERATION_TIMEOUT`. Web Bluetooth specifies no
   * timeout for anything, and `gattserverdisconnected` only fires for a link
   * that was *up* — so a device switched off during `gatt.connect()` produces no
   * event and no rejection, and without this the caller waits for ever. See
   * `queue.ts`.
   */
  readonly operationTimeout?: Seconds | undefined;
  /** Injected with `operationTimeout`, so a test can bound in milliseconds. */
  readonly schedule?: ((callback: () => void, after: Seconds) => () => void) | undefined;
}

/** One profile, with its UUIDs canonicalised once at construction. */
interface ProfileEntry {
  readonly profile: GattProfile;
  readonly service: GattUuid;
  readonly characteristic: GattUuid;
}

/**
 * One characteristic, live on the current link.
 *
 * Everything the notification path touches hangs off this object and is built
 * once per characteristic per link: the handler, the sink the decoder is handed,
 * and the mutable `at` the handler stamps before the decoder runs. That is what
 * makes the hot path allocation-free — `hot-path.test.ts` asserts each of those
 * identities is stable across a simulated hour of notifications.
 */
interface LiveCharacteristic {
  readonly entry: ProfileEntry;
  readonly characteristic: GattCharacteristicPort;
  /**
   * Mutable only because it closes over the object it is stored on. Assigned
   * once, in `buildLive`, and never again — spreading a new object here instead
   * would leave every closure pointing at the copy that was thrown away, which
   * is a bug with no symptom until `accepts` compares identities.
   */
  handler: () => void;
  sink: MeasurementSink;
  /** Stamped by `handler` before `decode`, read by `sink`. */
  at: UnixSeconds;
  /** How many live subscriptions this characteristic feeds. */
  subscribers: number;
  notifying: boolean;
}

/** What was resolved from the current link, and nothing that outlives it. */
interface Link {
  readonly characteristics: Map<string, LiveCharacteristic>;
  /** Which profile supplies each capability, fixed when the link came up. */
  readonly sources: Map<MeasurementCapability, LiveCharacteristic>;
  /**
   * The FTMS control point and status characteristics, resolved on demand.
   *
   * A **promise** rather than the value, so two concurrent procedures resolve
   * the service once — `getPrimaryService` is a queued round trip, and a
   * second one racing the first is how a client ends up holding two
   * characteristic objects for the same attribute and installs two handlers.
   * Cleared when it rejects, so a device that was not yet ready is retried.
   *
   * Not resolved with the measurement characteristics in `resolveLink`,
   * deliberately: most devices serve no control point, and a failed
   * `getPrimaryService` there would have to be swallowed on every heart rate
   * strap in the world. `controllable` below is the cheap half that *is*
   * resolved there, and it costs a heart rate strap nothing because the
   * Fitness Machine Service is not in such a device's grant at all.
   */
  control: Promise<FitnessMachineCharacteristics> | undefined;
  /**
   * The Fitness Machine Control Point resolved on this link — so this device
   * genuinely provides `trainer-control`.
   *
   * Observed rather than assumed, for the reason the whole of #131 exists: a
   * device that reported `trainer-control` because a caller *asked* for it is
   * a pairing screen offering ERG on a heart rate strap. SECURITY.md and
   * CLAUDE.md §6 both treat trainer control as a safety problem, and the safe
   * direction is to claim it only where the characteristic answered.
   */
  readonly controllable: boolean;
}

interface DeviceRecord {
  readonly native: BluetoothDevicePort;
  readonly device: SensorDevice;
  /**
   * The set behind `device.capabilities`, which is a `ReadonlySet` to everyone
   * else and this record's own mutable object here.
   *
   * **The same object, never a copy.** `createDeviceSession` captured `device`
   * and `session.report` reads `device.capabilities` on every measurement, so
   * a resolved set assigned as a new `Set` would have to be a new `SensorDevice`
   * — and a new device means a new session and the loss of every subscription
   * the caller holds. `applyResolved` is the only writer.
   */
  readonly capabilities: Set<SensorCapability>;
  /**
   * The services this origin may reach on this device: what `requestDevice` was
   * given, unioned across every discovery that returned this device.
   *
   * ⚠️ **The grant bounds what `resolveLink` may even attempt** (#132). A
   * `getPrimaryService` for a service outside it rejects with `SecurityError`
   * whatever the device serves, so attempting one is a guaranteed failure and a
   * console entry per connect. Tracking it also keeps the adapter's model of the
   * grant explicit rather than inferred from a swallowed rejection — and if the
   * browser is *stricter* than this set, `resolveLink`'s `catch` still covers it.
   */
  readonly granted: Set<GattUuid>;
  readonly identity: DeviceIdentity;
  readonly session: DeviceSession;
  readonly onDisconnected: () => void;
  link: Link | undefined;
  /** In flight, so that two `connect` calls are one connection attempt. */
  connecting: Promise<void> | undefined;
  /**
   * How many live subscriptions each capability has. Survives a link drop, which
   * is what lets `restoreNotifications` re-arm them on the next one.
   *
   * A counter object per capability rather than a number, so that `subscribe`
   * hands its `Unsubscribe` the counter itself. A map lookup on the way out
   * would need a fallback for a key that is always present, which is a branch
   * with nothing behind it.
   */
  readonly demand: Map<MeasurementCapability, Demand>;
  /**
   * `gattserverdisconnected` events to ignore, because this adapter caused them
   * on purpose on its way to a new link.
   */
  suppressedDisconnects: number;
}

/** How many live subscriptions one capability has. See `DeviceRecord.demand`. */
interface Demand {
  count: number;
}

const EMPTY_KNOWN_DEVICES: readonly SensorDevice[] = [];

const NOOP = (): void => undefined;
const NOOP_SINK: MeasurementSink = {
  power: NOOP,
  cadence: NOOP,
  'heart-rate': NOOP,
  speed: NOOP,
};

/**
 * `SensorTransport`, plus the one thing FTMS needs that a measurement transport
 * cannot express.
 *
 * `../../src/transport.ts` is deliberately read-only: it is satisfied unchanged
 * by Web Bluetooth, CoreBluetooth and the Android BLE APIs, and a write path on
 * it would be a command surface every transport had to implement before any of
 * them had a device to write to. Trainer control is a *protocol* rather than a
 * transport capability — `../../protocol` owns it — so what this adapter adds
 * is not a write method but the seam the protocol client plugs into.
 *
 * The return type is widened rather than the interface: every existing consumer
 * holds a `SensorTransport` and is unaffected, and a caller that wants control
 * has to name this type and therefore this decision.
 */
export interface WebBluetoothTransport extends SensorTransport {
  /**
   * Open the Fitness Machine Control Point on a **connected** trainer, and read
   * what the machine says about itself.
   *
   * The channel is for `createTrainerControl`; nothing above the transport
   * boundary should be encoding op codes itself. It survives a reconnection —
   * it re-resolves its characteristics and re-attaches its handlers — but
   * control does not: FTMS §4.16.2.1 ends control permission with the
   * connection, so the caller drives `linkLost()` and `linkRestored()` and
   * requests control again.
   *
   * @throws {SensorError} `device-not-found` for an id this transport did not
   * issue, `not-connected` when there is no link, and `capability-unsupported`
   * when the device serves no Fitness Machine Service.
   */
  openFitnessMachine(id: DeviceId): Promise<FitnessMachine>;
}

/**
 * A connected trainer's control point, and the three characteristics that say
 * what may be written to it.
 *
 * All three are read **from the device**. #49's revision block is explicit that
 * ERG is gated on Target Setting bit 3, gradient on bit 13, and that a setpoint
 * is quantised to the Supported Power Range's own minimum increment — *"offering
 * a control the trainer will refuse is worse than not offering it"*. A default
 * here would be the hard-coded assumption #43's acceptance criteria forbid.
 */
export interface FitnessMachine {
  readonly channel: FitnessMachineChannel;
  /**
   * `undefined` when the machine did not report one — which, per
   * `TrainerControlOptions.powerRange`, means no ERG client can be built for it
   * at all. That is the safe direction: an unbounded setpoint on a machine
   * whose limits are unknown is the one failure this whole path exists to
   * prevent.
   */
  readonly powerRange: SupportedPowerRange | undefined;
  readonly resistanceRange: SupportedResistanceLevelRange | undefined;
  readonly features: FitnessMachineFeatures | undefined;
}

export function createWebBluetoothTransport(
  options: WebBluetoothTransportOptions,
): WebBluetoothTransport {
  const traits: TransportTraits = {
    id: WEB_BLUETOOTH,
    // `requestDevice()` throws outside a user activation and cannot ask for one.
    // A trainer plus two sensors is three separate clicks, by design.
    requiresUserGestureToDiscover: true,
    // See fact 3 at the top of this file.
    canReconnectWithoutUserGesture: false,
    // No background operation, and unavailable in a Web Worker.
    canRestoreConnectionsInBackground: false,
    maxConcurrentConnections: MAX_RECOMMENDED_CONCURRENT_CONNECTIONS,
  };

  const bluetooth = options.bluetooth ?? defaultBluetooth();
  const now = options.now ?? defaultClock;
  const hasUserActivation = options.hasUserActivation ?? defaultUserActivation;
  const onProtocolError = options.onProtocolError;

  const entries: readonly ProfileEntry[] = options.profiles.map((profile) => ({
    profile,
    service: canonicalUuid(profile.service),
    characteristic: canonicalUuid(profile.characteristic),
  }));
  /** Every service the adapter may ever ask for — see `RequestDevicePortOptions`. */
  const everyService: readonly GattUuid[] = [...new Set(entries.map((entry) => entry.service))];

  const records = new Map<DeviceId, DeviceRecord>();
  const queue = createGattQueue({
    ...(options.operationTimeout === undefined ? {} : { timeout: options.operationTimeout }),
    ...(options.schedule === undefined ? {} : { schedule: options.schedule }),
  });

  /**
   * Turn a synchronous throw into a rejection — `../../src/transport.ts`'s
   * contract clause, for the methods whose body has nothing to await.
   */
  const attempt = <T>(operation: () => T): Promise<T> => {
    try {
      return Promise.resolve(operation());
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  };

  const demandFor = (record: DeviceRecord, capability: MeasurementCapability): Demand => {
    const existing = record.demand.get(capability);
    if (existing !== undefined) {
      return existing;
    }
    const created: Demand = { count: 0 };
    record.demand.set(capability, created);
    return created;
  };

  const recordFor = (id: DeviceId): DeviceRecord => {
    const record = records.get(id);
    if (record === undefined) {
      throw new SensorError('device-not-found', 'this transport did not issue that device id', {
        deviceId: id,
      });
    }
    return record;
  };

  const holdingASlot = (): number =>
    [...records.values()].filter(
      (record) => record.session.state === 'connected' || record.session.state === 'connecting',
    ).length;

  // --- The notification hot path --------------------------------------------

  /**
   * Whether a decoded value may be reported.
   *
   * Three questions, each a property read or a lookup and none an allocation.
   *
   * 1. **Does this session think it is connected**, which is
   *    `createDeviceSession`'s rule that only `connected` may deliver. It is
   *    reachable while a reconnect is restoring a second subscription: the
   *    first characteristic is live while the second is still being armed.
   * 2. **Does the *platform* think so**, which is not the same question and is
   *    the one the issue calls the subtle correctness problem: *"a
   *    `BluetoothDevice` can report as present while its GATT server is
   *    disconnected"*. `gatt.disconnect()` is synchronous and
   *    `gattserverdisconnected` arrives in a later task, so between the two
   *    there is a window in which this session still says `connected` and the
   *    link is already gone — and a `characteristicvaluechanged` dispatched
   *    just before the drop lands inside it. Without this read the adapter
   *    attributes that sample to a live link. Found by making the fake stack
   *    model the window instead of closing it.
   * 3. **Is *this* characteristic the source for the capability**, which stops
   *    a modern trainer reporting power twice a second, once from FTMS and once
   *    from Cycling Power.
   *
   * ⚠️ There is deliberately **no** fourth check that the device declared the
   * capability, even though a profile reports every field in a frame and the
   * caller asked for some of them. `resolveLink` only ever puts a declared
   * capability into `sources`, so question 3 already answers it — and a mutation
   * that deleted the fourth check turned nothing red, which is what a check with
   * nothing behind it looks like.
   */
  const accepts = (
    record: DeviceRecord,
    live: LiveCharacteristic,
    capability: MeasurementCapability,
  ): boolean =>
    record.session.state === 'connected' &&
    record.native.gatt?.connected === true &&
    record.link?.sources.get(capability) === live;

  const buildLive = (
    record: DeviceRecord,
    entry: ProfileEntry,
    characteristic: GattCharacteristicPort,
  ): LiveCharacteristic => {
    const live: LiveCharacteristic = {
      entry,
      characteristic,
      handler: NOOP,
      sink: NOOP_SINK,
      at: now(),
      subscribers: 0,
      notifying: false,
    };

    live.sink = {
      power: (value) => {
        if (accepts(record, live, 'power')) {
          record.session.report({
            capability: 'power',
            power: value,
            device: record.identity,
            at: live.at,
          });
        }
      },
      cadence: (value) => {
        if (accepts(record, live, 'cadence')) {
          record.session.report({
            capability: 'cadence',
            cadence: value,
            device: record.identity,
            at: live.at,
          });
        }
      },
      'heart-rate': (value) => {
        if (accepts(record, live, 'heart-rate')) {
          record.session.report({
            capability: 'heart-rate',
            heartRate: value,
            device: record.identity,
            at: live.at,
          });
        }
      },
      speed: (value) => {
        if (accepts(record, live, 'speed')) {
          record.session.report({
            capability: 'speed',
            speed: value,
            device: record.identity,
            at: live.at,
          });
        }
      },
    };

    live.handler = () => {
      // The characteristic's own view, never a copy: copying would be an
      // allocation on every notification from every sensor, and `GattProfile`
      // documents that a decoder must not retain it.
      const value = characteristic.value;
      if (value === undefined) {
        return;
      }
      // Stamped once per notification, before the decoder runs, so a profile
      // cannot misdate a sample and two fields out of one frame share an
      // instant.
      live.at = now();
      try {
        // Handed to the decoder as well as stamped on the envelope. A cadence
        // or a speed is a difference against a `uint16` event counter that laps
        // every 32 or 64 seconds, and telling one lap from none needs the
        // wall-clock gap — see `GattProfile.decode`. Passing this transport's
        // own `now` rather than letting a decoder read a clock is what keeps
        // the protocol directory platform-free and this timing testable.
        entry.profile.decode(value, live.sink, live.at);
      } catch (error) {
        // A hostile or malformed payload costs this notification and nothing
        // more. Rethrowing would put an exception into the browser's event
        // dispatch, where nothing this program wrote can catch it.
        onProtocolError?.(error);
      }
    };

    return live;
  };

  // --- Links ----------------------------------------------------------------

  /**
   * Detach every notification handler a link installed.
   *
   * This is the half of teardown that matters. A characteristic object can
   * survive a disconnect — Chrome caches it per service — so adding a handler on
   * every connect without removing the previous one gives two handlers, then
   * three, and the athlete sees doubled power readings after the third dropout.
   * `reconnect.test.ts` counts them.
   */
  const detachAll = (link: Link): void => {
    for (const live of link.characteristics.values()) {
      live.characteristic.removeEventListener('characteristicvaluechanged', live.handler);
      live.notifying = false;
      live.subscribers = 0;
    }
  };

  const teardownLink = (record: DeviceRecord): void => {
    const link = record.link;
    if (link === undefined) {
      return;
    }
    record.link = undefined;
    detachAll(link);
  };

  /**
   * Resolve every capability the device's **own services** supply, within the
   * services this origin was granted, and choose one source per capability.
   *
   * ⚠️ **Driven by the grant, not by the request** (#131). The loop used to
   * skip any capability outside `record.device.capabilities` — which
   * `register` had fixed to whatever the caller asked for — so a device could
   * only ever report back what it was looked for with, and a chooser opened
   * wide produced a device that connected and refused every `subscribe` for
   * ever. What a device supplies is a property of the device; the request's job
   * ended at the chooser.
   *
   * A service the device does not offer is skipped rather than fatal: a request
   * for power and heart rate reaches a trainer with no Heart Rate Service, and
   * the honest outcome is a link that delivers power, not a failed connect. A
   * service outside the grant is skipped by the same rule and one step earlier,
   * because `getPrimaryService` for one cannot succeed.
   */
  const resolveLink = async (record: DeviceRecord, server: GattServerPort): Promise<Link> => {
    const characteristics = new Map<string, LiveCharacteristic>();
    const sources = new Map<MeasurementCapability, LiveCharacteristic>();
    // One `getPrimaryService` per service per link, however many profiles name
    // it. FTMS is named by its measurement profile and again by the control
    // point below, and two round trips for one service is one more than the
    // link needs.
    const resolved = new Map<GattUuid, Promise<GattServicePort>>();
    const serviceFor = (uuid: GattUuid): Promise<GattServicePort> => {
      const existing = resolved.get(uuid);
      if (existing !== undefined) {
        return existing;
      }
      const pending = server.getPrimaryService(uuid);
      resolved.set(uuid, pending);
      // A rejection is a legitimate answer here — the device does not serve it —
      // so it is cached like any other, and this keeps it from being an
      // unhandled rejection while a later profile is still awaiting its own.
      pending.catch(() => undefined);
      return pending;
    };

    for (const entry of entries) {
      if (!record.granted.has(entry.service)) {
        continue;
      }
      const wanted = entry.profile.capabilities.filter((capability) => !sources.has(capability));
      if (wanted.length === 0) {
        continue;
      }
      let characteristic: GattCharacteristicPort;
      try {
        const service = await serviceFor(entry.service);
        characteristic = await service.getCharacteristic(entry.characteristic);
      } catch {
        // Not on this device. Every capability this profile would have supplied
        // stays unassigned, and a later profile may supply it.
        continue;
      }
      const live = buildLive(record, entry, characteristic);
      characteristic.addEventListener('characteristicvaluechanged', live.handler);
      characteristics.set(`${entry.service}/${entry.characteristic}`, live);
      for (const capability of wanted) {
        sources.set(capability, live);
      }
    }

    let controllable = false;
    if (record.granted.has(FITNESS_MACHINE_SERVICE)) {
      // Only inside the grant, which is what answers `Link.control`'s objection
      // to resolving anything FTMS-shaped here: a heart rate strap paired for
      // heart rate was never granted this service, so this branch is not
      // reached and costs it nothing. Where it *is* reached the service handle
      // is usually already resolved above, so the cost is one
      // `getCharacteristic`.
      try {
        await (
          await serviceFor(FITNESS_MACHINE_SERVICE)
        ).getCharacteristic(FITNESS_MACHINE_CONTROL_POINT);
        controllable = true;
      } catch {
        // No control point, or none reachable. `trainer-control` is simply not
        // among this device's capabilities, which is the whole answer.
      }
    }

    return { characteristics, sources, control: undefined, controllable };
  };

  /**
   * Make the device report what the link just found, in place.
   *
   * ## The rule, which #131 asks for as a rule rather than an accident
   *
   * 1. **Before any connect**, a device's capability set is what the caller
   *    asked for — empty when the chooser was opened wide. Web Bluetooth cannot
   *    reveal a device's services before a link exists (see `requestOptionsFor`),
   *    so there is nothing better to say and a claim is marked as one by the
   *    fact that nothing has been observed yet.
   * 2. **Every successful connect replaces it with what was observed**, so the
   *    set widens past the request as readily as it narrows below it.
   * 3. **It is mutated, never reassigned.** See `DeviceRecord.capabilities`:
   *    the session and every subscription hang off the `SensorDevice` this set
   *    belongs to.
   * 4. **A reconnect that supplies less narrows it.** Multi-mode trainers do
   *    come back advertising a different profile, and continuing to claim a
   *    capability the device no longer serves would put a control on screen
   *    that the device will refuse — the failure #49's revision block calls
   *    worse than not offering it at all. A subscription to a capability that
   *    vanished stays held and delivers nothing; its entry in `record.demand`
   *    survives, so a later reconnect that brings the service back re-arms it
   *    without the caller doing anything.
   * 5. **A disconnect changes nothing.** The last observation stands until the
   *    next one, so a pairing list does not blank itself on every dropout.
   */
  const applyResolved = (record: DeviceRecord, link: Link): void => {
    record.capabilities.clear();
    for (const capability of link.sources.keys()) {
      record.capabilities.add(capability);
    }
    if (link.controllable) {
      record.capabilities.add('trainer-control');
    }
  };

  // --- The FTMS control point, which is a write and not a subscription ------

  /**
   * The control point and status characteristics on the link that is up now.
   *
   * ⚠️ **Resolved against `record.link`, never captured.** Every handle from a
   * dropped link is dead — Chrome rejects a write on a stale characteristic
   * with `InvalidStateError` — so a channel that held one would report a
   * setpoint refused rather than a link that went, and a rider would be told
   * their trainer rejected a target it never received.
   */
  const controlCharacteristicsFor = async (
    record: DeviceRecord,
  ): Promise<FitnessMachineCharacteristics> => {
    const id = record.identity.id;
    const link = record.link;
    if (record.session.state !== 'connected' || link === undefined) {
      throw new SensorError('not-connected', 'the control point needs a connection', {
        deviceId: id,
      });
    }
    // ⚠️ The grant, checked here as well as in `resolveLink`.
    //
    // `resolveLink` gates every measurement service on `record.granted`; this
    // path did not, so the only thing standing between `openFitnessMachine` and
    // a control point on a strap the athlete paired for heart rate was Chrome's
    // own `SecurityError` on `getPrimaryService`. That is a real refusal and it
    // is not ours: it is a control this program does not own, cannot test
    // against a simulator, and does not exist at all on the CoreBluetooth and
    // Android paths `packages/sensors` interfaces have to satisfy unchanged.
    //
    // FTMS sets physical resistance on a person who is pedalling, and CLAUDE.md
    // §6 calls trainer control a safety issue rather than only a security one.
    // A grant the athlete never gave should be refused by us, in a message that
    // says so, before any GATT call is made.
    if (!record.granted.has(FITNESS_MACHINE_SERVICE)) {
      throw new SensorError(
        'capability-unsupported',
        'this device was not discovered for trainer control, so its control point was never granted',
        { deviceId: id },
      );
    }
    if (link.control === undefined) {
      link.control = queue
        .run(id, async () => {
          const service = await server(record).getPrimaryService(FITNESS_MACHINE_SERVICE);
          const controlPoint = await service.getCharacteristic(FITNESS_MACHINE_CONTROL_POINT);
          let status: GattCharacteristicPort | undefined;
          try {
            status = await service.getCharacteristic(FITNESS_MACHINE_STATUS);
          } catch {
            // Optional in FTMS. A machine without it never announces a
            // withdrawn control permission, and the client finds out from the
            // next setpoint being refused — which is worse and is still
            // correct, so it is not a reason to refuse the whole channel.
            status = undefined;
          }
          return { service, controlPoint, status, link };
        })
        .catch((error: unknown) => {
          // A rejection must not be cached: a trainer whose service was not yet
          // discovered would then refuse control for the life of the link.
          link.control = undefined;
          throw error instanceof SensorError ? error : missingProfileError(error, id);
        });
    }
    return link.control;
  };

  /**
   * Read one of FTMS's three descriptor-shaped characteristics, or `undefined`.
   *
   * ⚠️ **A failed read is `undefined`, not a rejection.** Supported Resistance
   * Level Range is optional in FTMS; Fitness Machine Feature is mandatory and
   * is nonetheless absent or unreadable on real hardware. Refusing the whole
   * machine because one of the three could not be read would take ERG away
   * from a trainer that supports it — and the consumer of each already has to
   * handle "not reported": `TrainerControlOptions.features` documents that an
   * omitted feature set gates nothing, precisely so that a transport which
   * could not read it does not have every setpoint refused.
   *
   * A **malformed** payload is `undefined` too, and for the same reason a
   * notification decoder that throws costs one notification: SECURITY.md
   * treats what a device sends as untrusted input.
   */
  const readDescriptorLike = async <T>(
    record: DeviceRecord,
    service: GattServicePort,
    characteristic: GattUuid,
    decode: (value: DataView) => T,
  ): Promise<T | undefined> => {
    try {
      const value = await queue.run(record.identity.id, async () =>
        (await service.getCharacteristic(characteristic)).readValue(),
      );
      return decode(value);
    } catch (error) {
      onProtocolError?.(error);
      return undefined;
    }
  };

  const server = (record: DeviceRecord): GattServerPort => {
    const gatt = record.native.gatt;
    if (gatt === undefined) {
      throw new SensorError('not-connected', 'this device exposes no GATT server', {
        deviceId: record.identity.id,
      });
    }
    return gatt;
  };

  /** Turn notifications on for a characteristic, once, however many capabilities want it. */
  const startNotifying = async (record: DeviceRecord, live: LiveCharacteristic): Promise<void> => {
    if (live.notifying) {
      return;
    }
    try {
      await live.characteristic.startNotifications();
    } catch (error) {
      throw missingProfileError(error, record.identity.id);
    }
    live.notifying = true;
  };

  /**
   * Re-arm every subscription the caller still holds.
   *
   * #40's third acceptance criterion. The caller's `Unsubscribe` handles stayed
   * valid across the drop, so the caller has no way to know it must re-subscribe
   * and no reason to expect it — and a ride screen that silently stops updating
   * after a dropout is the failure this prevents.
   */
  const restoreNotifications = async (record: DeviceRecord, link: Link): Promise<void> => {
    for (const [capability, demand] of record.demand) {
      const live = link.sources.get(capability);
      if (demand.count <= 0 || live === undefined) {
        continue;
      }
      live.subscribers += demand.count;
      await startNotifying(record, live);
    }
  };

  // --- Disconnects ----------------------------------------------------------

  const dropLink = (record: DeviceRecord, reason: SensorError): void => {
    // Abandon first. An operation queued for this device must be rejected
    // rather than run against a link that no longer exists — and one already in
    // flight must be settled rather than left for a promise that may never
    // resolve. `queue.ts` records why that also releases the slot.
    queue.abandon(record.identity.id, reason);
    teardownLink(record);
    if (record.session.state !== 'disconnected' && record.session.state !== 'unavailable') {
      record.session.transitionTo('disconnected');
    }
  };

  const handleDisconnected = (record: DeviceRecord): void => {
    if (record.suppressedDisconnects > 0) {
      // This adapter dropped a stale link on purpose, on its way to a new one.
      record.suppressedDisconnects -= 1;
      return;
    }
    dropLink(
      record,
      new SensorError('not-connected', 'the link to this device dropped', {
        deviceId: record.identity.id,
      }),
    );
  };

  // --- Registration ---------------------------------------------------------

  /**
   * Give a chosen device a record, or hand back the one it already has.
   *
   * ⚠️ **A second discovery of the same device widens the grant and nothing
   * else.** `requestDevice` returns the record that exists — name, session and
   * subscriptions intact — because replacing the `SensorDevice` would replace
   * the session `createDeviceSession` captured and lose every subscription the
   * caller holds. The origin's allowed-services list, though, genuinely does
   * accumulate across calls in the browser, so `granted` unions rather than
   * ignoring the second call: a device first chosen for heart rate and later
   * chosen again for power can serve both on the next link.
   *
   * The capability set is left alone here. Before a link exists it is the
   * caller's claim; `applyResolved` turns it into an observation on the first
   * connect, and a second discovery is not one.
   */
  const register = (
    native: BluetoothDevicePort,
    capabilities: ReadonlySet<SensorCapability>,
    granted: ReadonlySet<GattUuid>,
  ): DeviceRecord => {
    const id = labelDeviceId(native.id);
    const existing = records.get(id);
    if (existing !== undefined) {
      // The same `BluetoothDevice` object, not merely an equal one: the
      // specification keeps a device instance map per realm and `requestDevice`
      // returns the entry in it, so there is no stale wrapper to rebind.
      for (const service of granted) {
        existing.granted.add(service);
      }
      return existing;
    }

    const identity: DeviceIdentity = { transport: WEB_BLUETOOTH, id };
    // Built once and held by the record, because it is what `session.report`
    // reads on every measurement and what `applyResolved` writes.
    const declared = new Set(capabilities);
    const device: SensorDevice = {
      identity,
      ...(native.name === undefined ? {} : { name: native.name }),
      capabilities: declared,
    };
    const record: DeviceRecord = {
      native,
      device,
      capabilities: declared,
      granted: new Set(granted),
      identity,
      session: createDeviceSession(device),
      onDisconnected: () => {
        handleDisconnected(record);
      },
      link: undefined,
      connecting: undefined,
      demand: new Map(),
      suppressedDisconnects: 0,
    };
    native.addEventListener('gattserverdisconnected', record.onDisconnected);
    records.set(id, record);
    return record;
  };

  /**
   * Turn a capability request into what the chooser is given, and what the
   * origin is thereby granted.
   *
   * ⚠️ **The filters are an OR, and Web Bluetooth cannot tell the adapter which
   * one matched.** A device is returned because it advertised one of these
   * services, and its actual service list is unknowable until a link exists —
   * there is no `getDevices`-shaped answer that does not need a connection. So
   * the set a device is *registered* with is what the caller asked for, and the
   * first connect replaces it with what the device turned out to serve; see
   * `applyResolved`.
   *
   * ## The grant is the request's, not the registry's (#132)
   *
   * `optionalServices` used to be every service any registered profile names,
   * on every request. Asking for heart rate therefore granted this origin the
   * **Fitness Machine Control Point** on the athlete's chosen device — a
   * characteristic that sets physical resistance on a machine someone is
   * pedalling, which CLAUDE.md §6 and SECURITY.md both class as a safety
   * problem rather than only a security one. Chrome does not surface
   * `optionalServices` in the chooser, so the athlete is never shown the wider
   * authorisation, which is exactly why it has to be minimal.
   *
   * So the grant is the services that supply what was asked for, and no more.
   * Two consequences worth stating rather than discovering:
   *
   * - **It bounds `resolveLink` too**, which is the seam with #131. A device
   *   still reports what its own services supply — but only within the services
   *   this origin may reach. Asking for power on a modern trainer grants FTMS,
   *   which supplies cadence and speed as well, so the resolved set genuinely
   *   exceeds the request. Asking for heart rate grants the Heart Rate Service
   *   and the trainer's control point stays out of reach.
   * - **The wide chooser still grants everything**, because there the athlete
   *   was shown every device this program can use and consented to that. The
   *   difference is that it is now a *request* for it rather than the default.
   */
  const requestOptionsFor = (
    request: DiscoveryRequest,
  ): { readonly options: RequestDevicePortOptions; readonly granted: ReadonlySet<GattUuid> } => {
    const services = [
      ...new Set(
        entries
          .filter((entry) =>
            request.capabilities.some((capability) =>
              entry.profile.capabilities.some((supplied) => supplied === capability),
            ),
          )
          .map((entry) => entry.service),
      ),
    ];

    if (request.capabilities.length > 0 && services.length === 0) {
      throw new SensorError(
        'capability-unsupported',
        'no registered profile supplies any requested capability',
      );
    }

    const namePrefix = request.namePrefix;
    if (services.length === 0) {
      // "Anything this program can use", with no capability named. No filter
      // expresses that, so the chooser is opened wide — which is exactly what
      // the athlete is shown and consents to, and the grant matches it.
      return {
        options:
          namePrefix === undefined
            ? { acceptAllDevices: true, optionalServices: everyService }
            : { filters: [{ namePrefix }], optionalServices: everyService },
        granted: new Set(everyService),
      };
    }

    const filters: BluetoothScanFilterPort[] = services.map((service) => ({
      services: [service],
      ...(namePrefix === undefined ? {} : { namePrefix }),
    }));
    // Declared as optional as well as filtered. A service named only in a
    // filter is granted by the specification, but the filters are an OR and a
    // device is returned for matching *one* of them — so the second supplying
    // service would otherwise be unreachable on a trainer that serves both,
    // which is the mistake that makes a trainer's second profile permanently
    // invisible.
    return { options: { filters, optionalServices: services }, granted: new Set(services) };
  };

  // --- Availability ---------------------------------------------------------

  const applyAvailability = (availability: TransportAvailability): void => {
    for (const record of records.values()) {
      if (availability.kind === 'available') {
        if (record.session.state === 'unavailable') {
          record.session.transitionTo('disconnected');
        }
        continue;
      }
      if (record.session.state === 'unavailable') {
        continue;
      }
      queue.abandon(
        record.identity.id,
        new SensorError('adapter-unavailable', 'the Bluetooth adapter became unusable', {
          deviceId: record.identity.id,
        }),
      );
      teardownLink(record);
      record.session.transitionTo('unavailable');
    }
  };

  if (bluetooth?.addEventListener !== undefined) {
    // Feature-detected rather than assumed: a partial implementation or a shim
    // may expose the object without the event, and a hard reference would turn
    // "this browser sends no availability events" into "the adapter throws at
    // construction".
    bluetooth.addEventListener('availabilitychanged', () => {
      // `readAvailability` is documented never to reject and `applyAvailability`
      // only makes transitions `connection.ts` permits from every state, so
      // there is no rejection path here to swallow.
      void readAvailability(bluetooth).then(applyAvailability);
    });
  }

  // --- Connecting -----------------------------------------------------------

  /**
   * Drop the radio link and suppress the `gattserverdisconnected` it is expected
   * to raise.
   *
   * The counter is raised **before** the platform call because the event can
   * arrive synchronously, and lowered again if the call throws — because then no
   * event is coming, and a counter left raised swallows the next *genuine*
   * disconnect instead. That failure surfaces one lifecycle event after the bug
   * that caused it: a device physically dropping would be absorbed as though it
   * were this adapter's own teardown, leaving the session reporting `connecting`
   * for ever.
   *
   * `disconnect()` is a no-op on a dropped link where it is specified and a
   * throw in at least one shim, which is why the identical call in `disconnect`
   * below has always been wrapped. These two sites were not.
   */
  const dropRadioLink = (record: DeviceRecord, server: GattServerPort): void => {
    record.suppressedDisconnects += 1;
    try {
      server.disconnect();
    } catch {
      record.suppressedDisconnects -= 1;
    }
  };

  const establish = async (record: DeviceRecord, server: GattServerPort): Promise<void> => {
    const id = record.identity.id;
    record.session.transitionTo('connecting');
    try {
      await queue.run(id, async () => {
        if (server.connected) {
          // The platform says linked and this adapter does not. Every handle
          // from that link is one this adapter never resolved, and
          // `gatt.connect()` on an already-connected device has behaved
          // differently across Chrome versions. Drop it and start clean — and do
          // not let the resulting event tear down the connect that caused it.
          dropRadioLink(record, server);
        }
        await server.connect();
        const link = await resolveLink(record, server);
        if (record.session.state !== 'connecting') {
          // The link dropped while it was being resolved. Nothing here belongs
          // to a live link, so it is discarded rather than committed — a
          // resolved link stored after the drop is a set of dead handles that
          // `subscribe` would happily use.
          detachAll(link);
          throw new SensorError('not-connected', 'the link dropped while it was being set up', {
            deviceId: id,
          });
        }
        // Committed before notifications are enabled, because `accepts` reads
        // `record.link` and a notification can arrive the instant
        // `startNotifications` resolves.
        record.link = link;
        // And in the same breath, for the same reason: `session.report` refuses
        // a measurement whose capability the device does not declare, so a
        // notification arriving between these two lines would be dropped as
        // undeclared. Applied only past the check above, so a link that dropped
        // while it was being resolved leaves the last good observation standing
        // rather than replacing it with what a half-built link found.
        applyResolved(record, link);
        await restoreNotifications(record, link);
      });
    } catch (error) {
      teardownLink(record);
      if (server.connected) {
        // ⚠️ A connect that failed **after** the link came up leaves the radio
        // link up: `getPrimaryService` rejecting is not a disconnect. Leaving it
        // costs one of three OS-wide connection slots for the life of the page,
        // for a device this adapter has no handles for — so the athlete's third
        // sensor refuses to pair and nothing says why. Dropping it here is what
        // makes `holdingASlot()` an honest count.
        dropRadioLink(record, server);
      }
      if (record.session.state === 'connecting') {
        record.session.transitionTo('disconnected');
      }
      throw error instanceof SensorError ? error : connectionError(error, id);
    }
    if (record.session.state !== 'connecting') {
      teardownLink(record);
      throw new SensorError('not-connected', 'the link dropped before it was established', {
        deviceId: id,
      });
    }
    record.session.transitionTo('connected');
  };

  // --- The interface --------------------------------------------------------

  const transport: WebBluetoothTransport = {
    traits,

    async openFitnessMachine(id: DeviceId): Promise<FitnessMachine> {
      const record = recordFor(id);
      // Resolved once here rather than lazily on the first write, so that "this
      // device serves no Fitness Machine Service" is answered while the athlete
      // is looking at a pairing screen — not silently, three intervals into a
      // workout, as a refused setpoint.
      const resolved = await controlCharacteristicsFor(record);
      const channel = createFitnessMachineChannel({
        characteristics: async () => controlCharacteristicsFor(record),
        run: async (operation) => queue.run(id, operation),
      });
      const service = resolved.service;
      return {
        channel,
        powerRange: await readDescriptorLike(
          record,
          service,
          SUPPORTED_POWER_RANGE,
          decodeSupportedPowerRange,
        ),
        resistanceRange: await readDescriptorLike(
          record,
          service,
          SUPPORTED_RESISTANCE_LEVEL_RANGE,
          decodeSupportedResistanceLevelRange,
        ),
        features: await readDescriptorLike(
          record,
          service,
          FITNESS_MACHINE_FEATURE,
          decodeFitnessMachineFeature,
        ),
      };
    },

    // `../../src/transport.ts` requires that no promise-returning method throws
    // synchronously — the obvious `connect(id)` looks the device up and throws
    // `device-not-found` before it has created a promise at all, and a caller
    // written the ordinary way never sees it. Two shapes below satisfy that, and
    // both are deliberate: a method whose body genuinely awaits is `async`,
    // which cannot throw synchronously; a method whose body is entirely
    // synchronous goes through `attempt`, which is the same wrapper
    // `src/simulator/simulator.ts` uses for the same clause.

    async availability(): Promise<TransportAvailability> {
      return readAvailability(bluetooth);
    },

    async discover(request: DiscoveryRequest): Promise<SensorDevice> {
      if (traits.requiresUserGestureToDiscover && !hasUserActivation()) {
        throw new SensorError(
          'user-gesture-required',
          'requestDevice must be called from a user gesture, and needs one per device',
        );
      }
      const availability = await readAvailability(bluetooth);
      if (availability.kind !== 'available' || bluetooth === undefined) {
        throw new SensorError(
          availability.kind === 'unsupported' ? 'transport-unsupported' : 'adapter-unavailable',
          `this transport is ${availability.kind}`,
        );
      }
      const { options, granted } = requestOptionsFor(request);
      let native: BluetoothDevicePort;
      try {
        native = await bluetooth.requestDevice(options);
      } catch (error) {
        throw discoveryError(error);
      }
      return register(native, new Set(request.capabilities), granted).device;
    },

    knownDevices(): Promise<readonly SensorDevice[]> {
      // Not "none yet". `getDevices()` is behind chrome://flags, MDN marks it
      // "Limited availability / Experimental", and Persistent Device Permissions
      // is not shippable in 2026 — so a device this page was not handed in this
      // session cannot be reached, and returning one would be returning a device
      // that cannot be connected.
      return Promise.resolve(EMPTY_KNOWN_DEVICES);
    },

    async connect(id: DeviceId): Promise<void> {
      const record = recordFor(id);
      if (record.session.state === 'connected') {
        return;
      }
      if (record.connecting !== undefined) {
        // Two `connect` calls are one attempt, so the second cannot drop the
        // half-built link the first is standing up.
        return record.connecting;
      }
      if (record.session.state === 'unavailable') {
        throw new SensorError('adapter-unavailable', 'this transport is adapter-unavailable', {
          deviceId: id,
        });
      }
      const server = record.native.gatt;
      if (server === undefined) {
        throw new SensorError('not-connected', 'this device exposes no GATT server', {
          deviceId: id,
        });
      }
      if (holdingASlot() >= traits.maxConcurrentConnections) {
        throw new SensorError(
          'connection-budget-exceeded',
          `this transport holds at most ${String(traits.maxConcurrentConnections)} connections`,
          { deviceId: id },
        );
      }

      const connecting = establish(record, server);
      record.connecting = connecting;
      try {
        await connecting;
      } finally {
        record.connecting = undefined;
      }
    },

    disconnect(id: DeviceId): Promise<void> {
      return attempt(() => {
        const record = recordFor(id);
        if (record.session.state === 'disconnected') {
          return;
        }
        dropLink(
          record,
          new SensorError('not-connected', 'the link to this device was dropped', { deviceId: id }),
        );
        try {
          record.native.gatt?.disconnect();
        } catch {
          // Already gone. `disconnect()` on a dropped link is a no-op where it
          // is specified and a throw in at least one shim; either way there is
          // nothing left to do, and a `disconnect` that rejects would leave a
          // caller believing it still holds a link.
        }
      });
    },

    connectionState(id: DeviceId): ConnectionState {
      return recordFor(id).session.state;
    },

    observeConnectionState(id: DeviceId, listener: Listener<ConnectionState>): Unsubscribe {
      return recordFor(id).session.onStateChange(listener);
    },

    async subscribe<Capability extends MeasurementCapability>(
      id: DeviceId,
      capability: Capability,
      listener: Listener<MeasurementFor<Capability>>,
    ): Promise<Unsubscribe> {
      const record = recordFor(id);
      if (record.session.state !== 'connected') {
        throw new SensorError('not-connected', 'enabling notifications needs a connection', {
          deviceId: id,
        });
      }
      // One check, not two. Until #131 this asked first whether the device
      // *declared* the capability and then whether a service supplied it, and
      // the two could disagree because the declaration came from the discovery
      // request. Now `applyResolved` derives the declaration from
      // `link.sources`, so on a connected device the two questions have the same
      // answer — and a second branch that cannot go red is not a check, it is
      // unreachable code that a mutation test would expose as such.
      const live = record.link?.sources.get(capability);
      if (live === undefined) {
        throw new SensorError(
          'capability-unsupported',
          `no service on this device supplies ${capability}`,
          { deviceId: id },
        );
      }

      await queue.run(id, () => startNotifying(record, live));

      live.subscribers += 1;
      const demand = demandFor(record, capability);
      demand.count += 1;
      const detach = record.session.onMeasurement((measurement) => {
        if (isMeasurementOf(measurement, capability)) {
          listener(measurement);
        }
      });

      let released = false;
      return () => {
        if (released) {
          return;
        }
        released = true;
        detach();
        demand.count = Math.max(0, demand.count - 1);
        // The *current* source, not the one captured above: a reconnect since
        // then has replaced every characteristic on this device, and decrementing
        // the old one would leave the new one notifying with nobody listening.
        const current = record.link?.sources.get(capability);
        if (current === undefined) {
          return;
        }
        current.subscribers = Math.max(0, current.subscribers - 1);
        if (current.subscribers > 0 || !current.notifying) {
          return;
        }
        current.notifying = false;
        // Synchronous by contract — `../../src/transport.ts` says a caller
        // unsubscribing during teardown has nothing useful to do with a promise
        // — so the GATT write is queued and its failure discarded. A
        // `stopNotifications` on a link that has already dropped is not news.
        void queue
          .run(id, async () => {
            await current.characteristic.stopNotifications();
          })
          .catch(() => undefined);
      };
    },
  };

  return transport;
}

function defaultClock(): UnixSeconds {
  return unixSeconds(Date.now() / 1000);
}

function defaultBluetooth(): BluetoothPort | undefined {
  // Read through `globalThis` rather than as a bare `navigator`, so that this
  // module loads in Node — where `navigator` exists and has no `bluetooth` — and
  // in a worker, where Web Bluetooth is unavailable by specification. Either way
  // the answer is `undefined`, and `availability()` turns that into
  // `unsupported` rather than a `TypeError` on first load.
  return (globalThis as { navigator?: { bluetooth?: BluetoothPort } }).navigator?.bluetooth;
}

function defaultUserActivation(): boolean {
  const activation = (globalThis as { navigator?: { userActivation?: { isActive?: boolean } } })
    .navigator?.userActivation;
  // No `userActivation` API means no signal, and refusing every pairing on a
  // browser that does not report activation would be worse than trusting the
  // caller: `requestDevice` still refuses, and `discoveryError` still maps it.
  return activation?.isActive ?? true;
}
