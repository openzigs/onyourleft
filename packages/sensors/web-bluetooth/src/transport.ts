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
import { readAvailability } from './availability';
import { connectionError, discoveryError, missingProfileError } from './errors';
import type {
  BluetoothDevicePort,
  BluetoothPort,
  BluetoothScanFilterPort,
  GattCharacteristicPort,
  GattServerPort,
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
}

interface DeviceRecord {
  readonly native: BluetoothDevicePort;
  readonly device: SensorDevice;
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

export function createWebBluetoothTransport(
  options: WebBluetoothTransportOptions,
): SensorTransport {
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
        entry.profile.decode(value, live.sink);
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
   * Resolve every service and characteristic the device's declared capabilities
   * need, and choose one source per capability.
   *
   * A service the device does not offer is skipped rather than fatal: a request
   * for power and heart rate reaches a trainer with no Heart Rate Service, and
   * the honest outcome is a link that delivers power, not a failed connect.
   */
  const resolveLink = async (record: DeviceRecord, server: GattServerPort): Promise<Link> => {
    const characteristics = new Map<string, LiveCharacteristic>();
    const sources = new Map<MeasurementCapability, LiveCharacteristic>();

    for (const entry of entries) {
      const wanted = entry.profile.capabilities.filter(
        (capability) => record.device.capabilities.has(capability) && !sources.has(capability),
      );
      if (wanted.length === 0) {
        continue;
      }
      let characteristic: GattCharacteristicPort;
      try {
        const service = await server.getPrimaryService(entry.service);
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

    return { characteristics, sources };
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
   * ⚠️ **The declared capability set is fixed by the first discovery.** A second
   * `requestDevice` for the same device returns the record that exists, name and
   * capabilities and session and subscriptions intact — widening the set would
   * mean a new `SensorDevice`, and `createDeviceSession` captured the old one,
   * so it would mean a new session and the loss of every subscription the caller
   * holds. Web Bluetooth cannot reveal a device's services before a link exists
   * (see `requestOptionsFor`), so no version of this is fully truthful;
   * `subscribe` is where the truth is told either way.
   */
  const register = (
    native: BluetoothDevicePort,
    capabilities: ReadonlySet<SensorCapability>,
  ): DeviceRecord => {
    const id = labelDeviceId(native.id);
    const existing = records.get(id);
    if (existing !== undefined) {
      // The same `BluetoothDevice` object, not merely an equal one: the
      // specification keeps a device instance map per realm and `requestDevice`
      // returns the entry in it, so there is no stale wrapper to rebind.
      return existing;
    }

    const identity: DeviceIdentity = { transport: WEB_BLUETOOTH, id };
    const device: SensorDevice = {
      identity,
      ...(native.name === undefined ? {} : { name: native.name }),
      capabilities: new Set(capabilities),
    };
    const record: DeviceRecord = {
      native,
      device,
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
   * Turn a capability request into what the chooser is given.
   *
   * ⚠️ **The filters are an OR, and Web Bluetooth cannot tell the adapter which
   * one matched.** A device is returned because it advertised one of these
   * services, and its actual service list is unknowable until a link exists —
   * there is no `getDevices`-shaped answer that does not need a connection. So
   * the declared capability set is what the caller asked for, and `subscribe` is
   * the truthful check: it refuses a capability no service on the connected
   * device supplies.
   */
  const requestOptionsFor = (request: DiscoveryRequest): RequestDevicePortOptions => {
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
      // the athlete is shown and consents to.
      //
      // ⚠️ A device discovered this way registers with an EMPTY capability set
      // (`register` fixes it to what was requested) and therefore refuses every
      // `subscribe`. The chooser behaviour here is right; the registration below
      // is what needs to resolve capabilities from the device's own services.
      // That is #131, and until it lands this path yields a device that connects
      // and delivers nothing.
      return namePrefix === undefined
        ? { acceptAllDevices: true, optionalServices: everyService }
        : { filters: [{ namePrefix }], optionalServices: everyService };
    }

    const filters: BluetoothScanFilterPort[] = services.map((service) => ({
      services: [service],
      ...(namePrefix === undefined ? {} : { namePrefix }),
    }));
    return { filters, optionalServices: everyService };
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

  const transport: SensorTransport = {
    traits,

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
      const options = requestOptionsFor(request);
      let native: BluetoothDevicePort;
      try {
        native = await bluetooth.requestDevice(options);
      } catch (error) {
        throw discoveryError(error);
      }
      return register(native, new Set(request.capabilities)).device;
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
      if (!record.device.capabilities.has(capability)) {
        throw new SensorError(
          'capability-unsupported',
          `this device does not provide ${capability}`,
          { deviceId: id },
        );
      }
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
