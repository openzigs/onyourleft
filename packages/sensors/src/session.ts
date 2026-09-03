// SPDX-License-Identifier: Apache-2.0

/**
 * The per-device lifecycle, implemented once instead of five times.
 *
 * ## Why this is code and not only an interface
 *
 * #39 is an interface issue, and this is the one piece of behaviour it has to
 * ship. Its acceptance criteria require that *"a test proves a transport cannot
 * report measurements while disconnected"*. A rule stated only in a doc comment
 * is not provable by any test in this package, and a rule re-implemented inside
 * each of #40–#44 is five chances to get it wrong and five places to review it.
 * So the rule lives here, every transport composes one session per connected
 * device, and the test asserts it through the same public surface a transport
 * uses.
 *
 * ## What a transport does with it
 *
 * ```ts
 * const session = createDeviceSession(device);          // 'disconnected'
 * session.onMeasurement((m) => recorder.accept(m));
 * session.transitionTo('connecting');                   // before the GATT call
 * session.transitionTo('connected');                    // once the link is up
 * session.report(powerMeasurement);                     // delivered
 * session.transitionTo('disconnected');                 // on the drop
 * session.report(powerMeasurement);                     // throws: not-connected
 * ```
 *
 * The session holds **no** transport state — no handle, no characteristic, no
 * timer. It is a state machine and a listener list, which is why it can live in
 * a package that is forbidden every platform API.
 */

import {
  canReportMeasurements,
  isConnectionTransitionAllowed,
  type ConnectionState,
} from './connection';
import { sameDevice, type SensorDevice } from './device';
import { SensorError } from './errors';
import type { SensorMeasurement } from './measurement';
import type { Listener, Unsubscribe } from './subscription';

/**
 * One device's connection lifecycle and measurement stream.
 *
 * Created by a transport, one per device it has been asked to work with. The
 * transport drives `transitionTo` and `report`; everything above the transport
 * boundary reads `state` and subscribes.
 */
export interface DeviceSession {
  /** The device this session is for. */
  readonly device: SensorDevice;

  /** Where the connection is now. */
  readonly state: ConnectionState;

  /**
   * Move to a new connection state.
   *
   * @throws {SensorError} with code `illegal-state-transition` if the lifecycle
   * in `connection.ts` does not permit the move. A move to the current state is
   * permitted and emits nothing.
   */
  transitionTo(next: ConnectionState): void;

  /**
   * Deliver a measurement to every subscriber.
   *
   * @throws {SensorError} with code `not-connected` unless the state is
   * `connected`; with `device-not-found` if the measurement names a different
   * device; with `capability-unsupported` if this device does not provide the
   * measurement's capability.
   */
  report(measurement: SensorMeasurement): void;

  /** Subscribe to every measurement this device reports. */
  onMeasurement(listener: Listener<SensorMeasurement>): Unsubscribe;

  /** Subscribe to connection-state changes. Not called for a no-op transition. */
  onStateChange(listener: Listener<ConnectionState>): Unsubscribe;
}

/**
 * A listener list that survives a listener unsubscribing itself mid-notify.
 *
 * The copy in `emit` is the whole reason this exists: a subscriber that
 * unsubscribes from inside its own callback — which a "stop recording once the
 * trainer reports zero power" rule does naturally — mutates the array being
 * iterated, and the next listener in the list is skipped. That is a dropped
 * sample nobody can reproduce.
 */
function listenerList<T>(): {
  add: (listener: Listener<T>) => Unsubscribe;
  emit: (value: T) => void;
} {
  const listeners: Listener<T>[] = [];
  return {
    add(listener) {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index !== -1) {
          listeners.splice(index, 1);
        }
      };
    },
    emit(value) {
      for (const listener of [...listeners]) {
        listener(value);
      }
    },
  };
}

/**
 * Start a session for a device, in `disconnected`.
 *
 * Every device starts disconnected, including one a native stack is about to
 * restore in the background: the restore is a `connecting` and then a
 * `connected`, so a consumer sees the same sequence whether the link was
 * restored or established, and only `TransportTraits` says which platform could
 * have done it silently.
 */
export function createDeviceSession(device: SensorDevice): DeviceSession {
  let state: ConnectionState = 'disconnected';
  const measurements = listenerList<SensorMeasurement>();
  const stateChanges = listenerList<ConnectionState>();

  return {
    device,

    get state() {
      return state;
    },

    transitionTo(next) {
      if (!isConnectionTransitionAllowed(state, next)) {
        throw new SensorError(
          'illegal-state-transition',
          `a device cannot move from ${state} to ${next}`,
          { deviceId: device.identity.id },
        );
      }
      if (next === state) {
        return;
      }
      state = next;
      stateChanges.emit(next);
    },

    report(measurement) {
      // State first, deliberately. This is the check #39's acceptance criteria
      // name, and putting it first means the error a caller sees while
      // disconnected is always `not-connected` and never something about the
      // measurement's shape.
      if (!canReportMeasurements(state)) {
        throw new SensorError(
          'not-connected',
          `a device in state ${state} cannot report measurements`,
          { deviceId: device.identity.id },
        );
      }
      // The identity, not the id. A session belongs to one device on one
      // transport, and a measurement carrying a matching id from a different
      // stack is the cross-scope match CLAUDE.md §5 warns about — it passes
      // every single-platform test there is.
      if (!sameDevice(measurement.device, device.identity)) {
        throw new SensorError(
          'device-not-found',
          'a measurement from another device cannot be reported through this session',
          { deviceId: measurement.device.id },
        );
      }
      if (!device.capabilities.has(measurement.capability)) {
        throw new SensorError(
          'capability-unsupported',
          `this device does not provide ${measurement.capability}`,
          { deviceId: device.identity.id },
        );
      }
      measurements.emit(measurement);
    },

    onMeasurement(listener) {
      return measurements.add(listener);
    },

    onStateChange(listener) {
      return stateChanges.add(listener);
    },
  };
}
