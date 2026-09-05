// SPDX-License-Identifier: Apache-2.0

/**
 * A scripted Web Bluetooth stack, and the bench that drives it.
 *
 * ## Why this exists when #44's simulator already does
 *
 * `@onyourleft/sensors/simulator` is a second **`SensorTransport`**: it stands
 * where this adapter stands, not underneath it. Its own header says so, and
 * `packages/sensors/src/simulator/profiles.ts` is explicit that it models
 * *"field presence, not bytes"* because `../../README.md` bars GATT payload from
 * that directory. There is nothing under it for a Web Bluetooth adapter to sit
 * on — no `BluetoothDevice`, no GATT server, no characteristic, no `DataView`,
 * and above all no way to script the disconnect-in-the-middle-of-an-operation
 * case that is #40's second acceptance criterion.
 *
 * So the simulator is used where it fits — `conformance.test.ts` runs the same
 * `describeTransportConformance` suite against this adapter that
 * `packages/sensors/src/transport-conformance.test.ts` runs against the
 * simulator, which is exactly the cross-implementation diff #44's fifth
 * criterion asks for — and everything below the transport boundary is scripted
 * here. **That gap is worth reporting against #44**, and it is recorded in the
 * pull request rather than worked around silently.
 *
 * ## What it can do that a real device cannot
 *
 * - **Drop the link at a chosen instant**, including while a GATT operation is
 *   outstanding, which is the only way to test that nothing is left unsettled.
 * - **Hold an operation open forever.** A trainer that never answers is not
 *   reproducible on a desk and is entirely ordinary in a garage.
 * - **Count listeners.** The duplicate-handler leak in #40's third criterion is
 *   invisible from above — it shows as doubled readings after the third
 *   dropout — and countable from here.
 * - **Return the same characteristic object across reconnects**, which is the
 *   hostile case for that leak. A fake that returned a fresh object every time
 *   would pass whether or not the adapter removes its handlers.
 */

import type {
  BluetoothDevicePort,
  BluetoothPort,
  BluetoothScanFilterPort,
  GattCharacteristicPort,
  GattServerPort,
  GattServicePort,
  GattUuid,
  RequestDevicePortOptions,
} from '../gatt';
import { canonicalUuid } from '../profile';

/** A GATT call this fake can be asked to hold open. */
export type FakeGattOperation =
  | 'connect'
  | 'getPrimaryService'
  | 'getCharacteristic'
  | 'readValue'
  | 'startNotifications'
  | 'stopNotifications'
  | 'writeValueWithResponse'
  /**
   * ⚠️ **Modelled so that a client using it can be caught, and for no other
   * reason.** It succeeds here exactly as it would on a real stack — that is
   * the trap: an unacknowledged control point write compiles, resolves, and
   * turns nothing red, while `CCCD Improperly Configured` and `Procedure
   * Already In Progress` stop being observable at all. The assertion that this
   * operation never appears in {@link FakeBluetoothBench.operations} is what
   * makes `../fitness-machine-channel.ts`'s choice enforced rather than
   * commented.
   */
  | 'writeValueWithoutResponse';

/** One held call, and the two ways out of it. */
export interface HeldOperation {
  readonly deviceId: string;
  readonly operation: FakeGattOperation;
  /** What was asked for — a service or characteristic UUID, where there is one. */
  readonly subject: string | undefined;
  settle(): void;
  fail(error: unknown): void;
}

export interface FakeServiceSpec {
  readonly uuid: GattUuid | number;
  readonly characteristics: readonly (GattUuid | number)[];
  /**
   * What each characteristic answers a read with.
   *
   * Keyed by the characteristic's UUID in whatever form the spec above wrote
   * it. A characteristic with no entry rejects a read the way a device without
   * the Read property does, which is the case a client that assumes every
   * descriptor-shaped characteristic is readable has to survive.
   */
  readonly readValues?: Readonly<Record<string, Uint8Array>>;
}

export interface FakeDeviceSpec {
  readonly id: string;
  readonly name?: string;
  readonly services: readonly FakeServiceSpec[];
  /**
   * The device exposes no GATT server at all.
   *
   * `BluetoothDevice.gatt` is optional in the specification, and a device that
   * advertises but serves nothing is what a beacon is. The adapter must report
   * `not-connected` rather than dereference it.
   */
  readonly withoutGatt?: boolean;
  /**
   * `gatt.disconnect()` throws instead of dropping the link.
   *
   * Not hypothetical, and not the same as a link that is already gone: the
   * adapter's own `disconnect` has always wrapped this call, with a comment
   * saying it is "a throw in at least one shim". Two other call sites did not,
   * and the failure they produced was invisible until this option existed —
   * a raised suppression counter with no event coming to lower it, which
   * swallows the NEXT genuine disconnect rather than the one it was raised for.
   */
  readonly disconnectThrows?: boolean;
}

export interface FakeDeviceHandle {
  readonly id: string;
  readonly native: BluetoothDevicePort;
  readonly connected: boolean;
  /**
   * Deliver one notification, exactly as the browser does: set the
   * characteristic's `value`, then dispatch to every registered listener.
   *
   * Reuses one `DataView` per characteristic by default, because the browser
   * reuses the underlying buffer too — a fake that allocated a fresh view per
   * notification would hide a decoder that retained one.
   */
  notify(service: GattUuid | number, characteristic: GattUuid | number, bytes: Uint8Array): void;
  /** The link drops with no warning, as a trainer does when the rider stands up. */
  drop(): void;
  /**
   * Dispatch `characteristicvaluechanged` with no payload behind it.
   *
   * The port types `value` as optional because the browser's own declarations
   * do. This is how that branch is reached, and the adapter must drop the
   * notification rather than hand a decoder `undefined`.
   */
  notifyWithoutValue(service: GattUuid | number, characteristic: GattUuid | number): void;
  /** How many `characteristicvaluechanged` listeners are attached right now. */
  listeners(service: GattUuid | number, characteristic: GattUuid | number): number;
  /** How many `gattserverdisconnected` listeners are attached right now. */
  readonly disconnectListeners: number;
  notifying(service: GattUuid | number, characteristic: GattUuid | number): boolean;
  /** Every payload written to a characteristic, in order, however it was written. */
  writes(service: GattUuid | number, characteristic: GattUuid | number): readonly Uint8Array[];
  /**
   * The services this origin has been granted **on this device**, canonicalised.
   *
   * `bench.requests` says what was asked for; this says what the browser now
   * holds, which is the union across every `requestDevice` that returned this
   * device. The two differ the moment a device is chosen twice, and the second
   * is the one a security assertion wants.
   */
  readonly allowedServices: readonly GattUuid[];
  /**
   * Stop the device serving a service it has, or start it again.
   *
   * A multi-mode trainer genuinely does this: it comes back from a dropout
   * advertising a different profile, and `getPrimaryService` then answers
   * `NotFoundError` for a service that resolved on the previous link. That is
   * the reconnect #131 has to define behaviour for, and `FakeDeviceSpec` is
   * fixed at construction, so the change has to be scriptable from here.
   *
   * Hidden is *absent*, not *forbidden*: the grant check comes first, so
   * hiding a service does not disguise itself as one the origin may not reach.
   */
  setServiceVisible(service: GattUuid | number, visible: boolean): void;
}

/**
 * One `requestDevice` call, flattened for inspection.
 *
 * `RequestDevicePortOptions` is a union — either `filters` or
 * `acceptAllDevices` — which is right for the call and awkward for an assertion.
 * Narrowing once here means a test reads `request.acceptAllDevices` rather than
 * narrowing the union again in every one.
 */
export interface RequestInspection {
  readonly filters: readonly BluetoothScanFilterPort[] | undefined;
  readonly optionalServices: readonly (GattUuid | number)[] | undefined;
  readonly acceptAllDevices: boolean | undefined;
}

export interface FakeBluetoothBench {
  /** Every GATT call, in the order the fake was asked to perform it. */
  readonly operations: readonly string[];
  /** Calls being held open right now, oldest first. */
  readonly held: readonly HeldOperation[];
  hold(operation: FakeGattOperation): void;
  /** Stop holding, and settle everything already held for that call. */
  release(operation: FakeGattOperation): void;
  device(id: string): FakeDeviceHandle;
  setAvailability(available: boolean): void;
  /** Make `getAvailability()` reject, as a partial implementation does. */
  setAvailabilityThrows(throws: boolean): void;
  /** What the chooser does next. */
  setChooser(chooser: FakeChooser): void;
  /** Everything `requestDevice` was called with, oldest first. */
  readonly requests: readonly RequestInspection[];
  /** Fire `availabilitychanged`, which is how a radio being switched off arrives. */
  emitAvailabilityChanged(): void;
}

/**
 * What the chooser does.
 *
 * `'first-match'` picks the first device that advertises one of the requested
 * services — the same rule `createSimulator` uses, so the two benches behave
 * alike where they overlap.
 */
export type FakeChooser =
  | { readonly kind: 'first-match' }
  | { readonly kind: 'cancel' }
  | { readonly kind: 'fail'; readonly error: unknown };

export interface FakeBluetooth {
  readonly bluetooth: BluetoothPort;
  readonly bench: FakeBluetoothBench;
}

export interface FakeBluetoothOptions {
  readonly devices: readonly FakeDeviceSpec[];
  readonly available?: boolean;
  readonly chooser?: FakeChooser;
  /** Omit `addEventListener` and `removeEventListener`, as a shim may. */
  readonly withoutEvents?: boolean;
}

/**
 * A stand-in for a `DOMException`.
 *
 * Not a real `DOMException`, deliberately: `errors.ts` reads `.name` rather than
 * using `instanceof`, because `instanceof DOMException` is false across realms
 * and a `catch` that relies on it takes the "unknown error" branch for every
 * real failure. A plain object with a `name` is the sharpest possible test of
 * that decision — if the mapping ever goes back to `instanceof`, every one of
 * these stops matching.
 */
/**
 * A copy of what was written, because the caller owns the array it handed in.
 *
 * `BufferSource` rather than `Uint8Array` for the reason `../gatt.ts` gives:
 * that is the shape the browser declares, and a port that narrowed it would
 * stop describing the API it stands in for.
 */
function copyOf(value: BufferSource): Uint8Array {
  return value instanceof ArrayBuffer
    ? new Uint8Array(value.slice(0))
    : new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export function domError(name: string, message = name): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

interface CharacteristicState {
  readonly uuid: GattUuid;
  readonly listeners: Set<() => void>;
  readonly port: GattCharacteristicPort;
  /** Copied on write, because the caller owns the array it handed in. */
  readonly writes: Uint8Array[];
  value: DataView | undefined;
  buffer: ArrayBuffer | undefined;
  notifying: boolean;
}

interface DeviceState {
  readonly spec: FakeDeviceSpec;
  readonly id: string;
  readonly services: Map<GattUuid, Map<GattUuid, CharacteristicState>>;
  readonly disconnectListeners: Set<() => void>;
  readonly native: BluetoothDevicePort;
  /**
   * The origin's **allowed services** for this device, as `requestDevice`
   * builds them: the union of every filter's `services` and every call's
   * `optionalServices`, accumulated across calls that returned this device.
   *
   * ⚠️ **Modelled rather than ignored, because a fake that grants everything
   * cannot fail the assertion that matters.** Chrome rejects
   * `getPrimaryService` for a service outside this set with `SecurityError`,
   * whatever the device actually serves — that is the entire mechanism behind
   * #132, and until this was here a test could narrow `optionalServices` to
   * nothing at all and every service would still resolve. That is CLAUDE.md
   * §5's *wrong harness*: the assertion passes because the double is
   * permissive, not because the code is right.
   */
  readonly allowed: Set<GattUuid>;
  /** Services the device has but is not serving right now. See `setServiceVisible`. */
  readonly hidden: Set<GattUuid>;
  connected: boolean;
}

function inspect(options: RequestDevicePortOptions | undefined): RequestInspection {
  return {
    filters: options !== undefined && 'filters' in options ? options.filters : undefined,
    optionalServices: options?.optionalServices,
    acceptAllDevices:
      options !== undefined && 'acceptAllDevices' in options ? options.acceptAllDevices : undefined,
  };
}

export function createFakeBluetooth(options: FakeBluetoothOptions): FakeBluetooth {
  const operations: string[] = [];
  const held: HeldOperation[] = [];
  const holding = new Set<FakeGattOperation>();
  const requests: RequestInspection[] = [];
  const availabilityListeners = new Set<() => void>();
  let available = options.available ?? true;
  let availabilityThrows = false;
  let chooser: FakeChooser = options.chooser ?? { kind: 'first-match' };

  const devices = new Map<string, DeviceState>();

  /**
   * Run a GATT call, or hold it open.
   *
   * Every call the adapter can make goes through here, which is what makes
   * "hold `startNotifications` and drop the link" a one-line test rather than a
   * bespoke double.
   */
  const perform = (
    deviceId: string,
    operation: FakeGattOperation,
    subject: string | undefined,
    run: () => void,
  ): Promise<void> => {
    operations.push(`${deviceId}:${operation}${subject === undefined ? '' : `:${subject}`}`);
    if (!holding.has(operation)) {
      return Promise.resolve().then(run);
    }
    return new Promise<void>((resolve, reject) => {
      const entry: HeldOperation = {
        deviceId,
        operation,
        subject,
        settle() {
          remove();
          try {
            resolve(run());
          } catch (error) {
            // `run` throws for a service the device does not have, and a held
            // operation must fail the same way an unheld one does — otherwise
            // releasing a hold turns a rejection into a promise nobody settles.
            reject(asError(error));
          }
        },
        fail(error) {
          remove();
          reject(asError(error));
        },
      };
      const remove = (): void => {
        const index = held.indexOf(entry);
        if (index !== -1) {
          held.splice(index, 1);
        }
      };
      held.push(entry);
    });
  };

  const buildDevice = (spec: FakeDeviceSpec): DeviceState => {
    const services = new Map<GattUuid, Map<GattUuid, CharacteristicState>>();
    const state: DeviceState = {
      spec,
      id: spec.id,
      services,
      disconnectListeners: new Set(),
      allowed: new Set(),
      hidden: new Set(),
      connected: false,
      native: undefined as unknown as BluetoothDevicePort,
    };

    for (const service of spec.services) {
      const serviceUuid = canonicalUuid(service.uuid);
      const characteristics = new Map<GattUuid, CharacteristicState>();
      const readable = new Map<GattUuid, Uint8Array>();
      for (const [key, bytes] of Object.entries(service.readValues ?? {})) {
        readable.set(canonicalUuid(key), bytes);
      }
      for (const raw of service.characteristics) {
        const uuid = canonicalUuid(raw);
        const characteristic: CharacteristicState = {
          uuid,
          listeners: new Set(),
          writes: [],
          value: undefined,
          buffer: undefined,
          notifying: false,
          port: undefined as unknown as GattCharacteristicPort,
        };
        // The same port object for the life of the fake, across every
        // reconnect. That is the hostile case for a handler leak: a fake that
        // handed back a fresh object each time would pass whether or not the
        // adapter removes its listeners.
        Object.defineProperty(characteristic, 'port', {
          value: {
            uuid,
            get value() {
              return characteristic.value;
            },
            startNotifications() {
              return perform(spec.id, 'startNotifications', uuid, () => {
                requireLink(state);
                characteristic.notifying = true;
              });
            },
            readValue() {
              return perform(spec.id, 'readValue', uuid, () => {
                requireLink(state);
              }).then(() => {
                const bytes = readable.get(uuid);
                if (bytes === undefined) {
                  throw domError('NotSupportedError', 'this characteristic is not readable');
                }
                return new DataView(
                  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
                );
              });
            },
            stopNotifications() {
              return perform(spec.id, 'stopNotifications', uuid, () => {
                requireLink(state);
                characteristic.notifying = false;
              });
            },
            writeValueWithResponse(value: BufferSource) {
              return perform(spec.id, 'writeValueWithResponse', uuid, () => {
                requireLink(state);
                characteristic.writes.push(copyOf(value));
              });
            },
            writeValueWithoutResponse(value: BufferSource) {
              // Deliberately as permissive as the acknowledged write. See
              // `FakeGattOperation`: a stack that refused here would catch the
              // wrong client for the wrong reason, and would prove nothing
              // about a real one.
              return perform(spec.id, 'writeValueWithoutResponse', uuid, () => {
                requireLink(state);
                characteristic.writes.push(copyOf(value));
              });
            },
            addEventListener(_type: 'characteristicvaluechanged', listener: () => void) {
              characteristic.listeners.add(listener);
            },
            removeEventListener(_type: 'characteristicvaluechanged', listener: () => void) {
              characteristic.listeners.delete(listener);
            },
          } satisfies GattCharacteristicPort,
        });
        characteristics.set(uuid, characteristic);
      }
      services.set(serviceUuid, characteristics);
    }

    const server: GattServerPort = {
      get connected() {
        return state.connected;
      },
      connect() {
        return perform(spec.id, 'connect', undefined, () => {
          state.connected = true;
        });
      },
      disconnect() {
        // Synchronous, and the event arrives in a later task — exactly as the
        // specification requires, and the reason the adapter drives the session
        // from its own call site as well as from the event.
        //
        // Logged even though it is not a queued operation, because *whether* the
        // adapter dropped a link is the assertion in more than one test and the
        // operation log is where the order of everything else is read.
        operations.push(`${spec.id}:disconnect`);
        if (spec.disconnectThrows === true) {
          throw domError('NetworkError', 'disconnect failed');
        }
        if (!state.connected) {
          return;
        }
        state.connected = false;
        queueDisconnect(state);
      },
      getPrimaryService(uuid) {
        const wanted = canonicalUuid(uuid);
        return perform(spec.id, 'getPrimaryService', wanted, () => {
          requireLink(state);
          if (!state.allowed.has(wanted)) {
            // Before the "is it there" check, because that is the order the
            // browser answers in: an origin that was not granted a service
            // cannot learn whether the device serves it. Reversing the two
            // would leak the device's service list to a request that has no
            // right to it — and would let a test tell "not granted" from "not
            // present", which a real caller cannot.
            throw domError('SecurityError', 'this origin may not access that service');
          }
          if (!services.has(wanted) || state.hidden.has(wanted)) {
            throw domError('NotFoundError', 'no such service');
          }
        }).then(() => makeService(state, wanted));
      },
    };

    Object.defineProperty(state, 'native', {
      value: {
        id: spec.id,
        name: spec.name,
        gatt: spec.withoutGatt === true ? undefined : server,
        addEventListener(_type: 'gattserverdisconnected', listener: () => void) {
          state.disconnectListeners.add(listener);
        },
        removeEventListener(_type: 'gattserverdisconnected', listener: () => void) {
          state.disconnectListeners.delete(listener);
        },
      } satisfies BluetoothDevicePort,
    });

    return state;
  };

  const makeService = (state: DeviceState, serviceUuid: GattUuid): GattServicePort => ({
    uuid: serviceUuid,
    getCharacteristic(uuid) {
      const wanted = canonicalUuid(uuid);
      return perform(state.id, 'getCharacteristic', wanted, () => {
        requireLink(state);
        if (state.services.get(serviceUuid)?.get(wanted) === undefined) {
          throw domError('NotFoundError', 'no such characteristic');
        }
      }).then(() => {
        const characteristic = state.services.get(serviceUuid)?.get(wanted);
        if (characteristic === undefined) {
          throw domError('NotFoundError', 'no such characteristic');
        }
        return characteristic.port;
      });
    },
  });

  const requireLink = (state: DeviceState): void => {
    if (!state.connected) {
      // What Chrome raises for a handle from a link that has gone.
      throw domError('NetworkError', 'GATT server is disconnected');
    }
  };

  /**
   * Every characteristic stops notifying when the link goes — but **not until
   * the disconnect event runs**.
   *
   * ⚠️ This ordering is the whole point, and getting it wrong makes the fake
   * hide a bug rather than catch one. `gatt.disconnect()` is synchronous and
   * `gattserverdisconnected` arrives in a later task, so there is a window in
   * which the link is gone and a `characteristicvaluechanged` dispatched just
   * before it still lands. Clearing `notifying` in `drop()` would close that
   * window in the fake and nowhere else, and an adapter that delivered
   * measurements from a dead link would pass.
   */
  const invalidate = (state: DeviceState): void => {
    for (const characteristics of state.services.values()) {
      for (const characteristic of characteristics.values()) {
        characteristic.notifying = false;
      }
    }
  };

  const queueDisconnect = (state: DeviceState): void => {
    const listeners = [...state.disconnectListeners];
    queueMicrotask(() => {
      invalidate(state);
      for (const listener of listeners) {
        listener();
      }
    });
  };

  for (const spec of options.devices) {
    devices.set(spec.id, buildDevice(spec));
  }

  const deviceState = (id: string): DeviceState => {
    const state = devices.get(id);
    if (state === undefined) {
      throw new Error(`the fake stack has no device ${id}`);
    }
    return state;
  };

  const characteristicState = (
    state: DeviceState,
    service: GattUuid | number,
    characteristic: GattUuid | number,
  ): CharacteristicState => {
    const found = state.services.get(canonicalUuid(service))?.get(canonicalUuid(characteristic));
    if (found === undefined) {
      throw new Error(`the fake device ${state.id} has no such characteristic`);
    }
    return found;
  };

  const base: BluetoothPort = {
    getAvailability() {
      if (availabilityThrows) {
        return Promise.reject(domError('NotSupportedError', 'partially implemented'));
      }
      return Promise.resolve(available);
    },
    requestDevice(requestOptions?: RequestDevicePortOptions) {
      const inspection = inspect(requestOptions);
      requests.push(inspection);
      if (requestOptions === undefined) {
        // What the browser does for a call with neither `filters` nor
        // `acceptAllDevices` — the failure the port's union now makes
        // unwritable.
        return Promise.reject(new TypeError('requestDevice needs filters or acceptAllDevices'));
      }
      if (chooser.kind === 'cancel') {
        return Promise.reject(domError('NotFoundError', 'User cancelled the chooser.'));
      }
      if (chooser.kind === 'fail') {
        return Promise.reject(asError(chooser.error));
      }
      // The real chooser's semantics: AND within a filter, OR across them, and
      // `acceptAllDevices` when there are none. A fake that only unioned the
      // service lists would pass a request whose name prefix excludes every
      // device, which is the mistake it exists to catch.
      const filters = inspection.filters ?? [];
      const matches = (state: DeviceState): boolean => {
        if (filters.length === 0) {
          return inspection.acceptAllDevices === true;
        }
        return filters.some(
          (filter) =>
            (filter.services ?? []).every((uuid) => state.services.has(canonicalUuid(uuid))) &&
            (filter.namePrefix === undefined ||
              (state.spec.name ?? '').startsWith(filter.namePrefix)),
        );
      };
      const match = [...devices.values()].find(matches);
      if (match === undefined) {
        return Promise.reject(domError('NotFoundError', 'no device matched'));
      }
      // The grant is per origin **and** per device, and it accumulates: a second
      // `requestDevice` that returns the same device adds to what the first
      // allowed rather than replacing it. Only the chosen device is granted
      // anything, which is what makes "the strap was never granted the control
      // point" an assertion a test can make.
      for (const uuid of [
        ...filters.flatMap((filter) => filter.services ?? []),
        ...(inspection.optionalServices ?? []),
      ]) {
        match.allowed.add(canonicalUuid(uuid));
      }
      return Promise.resolve(match.native);
    },
  };

  const bluetooth: BluetoothPort =
    options.withoutEvents === true
      ? base
      : {
          ...base,
          addEventListener(_type: 'availabilitychanged', listener: () => void) {
            availabilityListeners.add(listener);
          },
          removeEventListener(_type: 'availabilitychanged', listener: () => void) {
            availabilityListeners.delete(listener);
          },
        };

  const bench: FakeBluetoothBench = {
    operations,
    held,
    requests,

    hold(operation) {
      holding.add(operation);
    },

    release(operation) {
      holding.delete(operation);
      for (const entry of [...held]) {
        if (entry.operation === operation) {
          entry.settle();
        }
      }
    },

    setAvailability(next) {
      available = next;
    },

    setAvailabilityThrows(next) {
      availabilityThrows = next;
    },

    setChooser(next) {
      chooser = next;
    },

    emitAvailabilityChanged() {
      for (const listener of [...availabilityListeners]) {
        listener();
      }
    },

    device(id) {
      const state = deviceState(id);
      return {
        id,
        native: state.native,
        get connected() {
          return state.connected;
        },
        get disconnectListeners() {
          return state.disconnectListeners.size;
        },
        get allowedServices() {
          return [...state.allowed];
        },
        setServiceVisible(service, visible) {
          const uuid = canonicalUuid(service);
          if (visible) {
            state.hidden.delete(uuid);
            return;
          }
          state.hidden.add(uuid);
        },
        notify(service, characteristic, bytes) {
          const found = characteristicState(state, service, characteristic);
          if (!found.notifying) {
            return;
          }
          // One buffer per characteristic, reused. The browser reuses the
          // underlying buffer too, which is why `GattProfile` documents that a
          // decoder must not retain the view it is handed.
          if (found.buffer === undefined || found.buffer.byteLength !== bytes.byteLength) {
            found.buffer = new ArrayBuffer(bytes.byteLength);
            found.value = new DataView(found.buffer);
          }
          new Uint8Array(found.buffer).set(bytes);
          for (const listener of [...found.listeners]) {
            listener();
          }
        },
        notifyWithoutValue(service, characteristic) {
          const found = characteristicState(state, service, characteristic);
          if (!found.notifying) {
            return;
          }
          found.value = undefined;
          for (const listener of [...found.listeners]) {
            listener();
          }
        },
        drop() {
          if (!state.connected) {
            return;
          }
          state.connected = false;
          queueDisconnect(state);
        },
        listeners(service, characteristic) {
          return characteristicState(state, service, characteristic).listeners.size;
        },
        notifying(service, characteristic) {
          return characteristicState(state, service, characteristic).notifying;
        },
        writes(service, characteristic) {
          return characteristicState(state, service, characteristic).writes;
        },
      };
    },
  };

  return { bluetooth, bench };
}
