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
 * A listener list that survives a listener unsubscribing itself mid-notify, and
 * that allocates nothing while notifying.
 *
 * ## The problem it solves
 *
 * A subscriber that unsubscribes from inside its own callback — which a "stop
 * recording once the trainer reports zero power" rule does naturally — mutates
 * the list being iterated, and the next listener is skipped. That is a dropped
 * sample nobody can reproduce.
 *
 * ## Why it is a tombstone rather than a copy
 *
 * ⚠️ **`emit` runs on every notification from every sensor.** This function was
 * written for #39, where nothing called it in a loop; #40 is its first hot-path
 * consumer, and three connected sensors reporting at 1 Hz reach it about ten
 * thousand times an hour per stream. The obvious fix — iterate `[...listeners]`
 * — is an array allocated and thrown away on every one of them, and #40's fifth
 * acceptance criterion is that notification handling allocates nothing per
 * notification.
 *
 * So a removal *during* a notification blanks its slot instead of splicing it
 * out, and the blanks are compacted once the outermost notification finishes.
 * The loop is bounded before it starts, so a listener that subscribes from
 * inside its own callback is not called for the event it is handling — the same
 * rule the copy gave, arrived at without the copy.
 *
 * One deliberate behaviour change comes with it: a listener removed by *another*
 * listener mid-notification is no longer called for that notification. The copy
 * called it, having captured it before it was removed. Not calling it is the
 * `transport.ts` contract — nothing is delivered after unsubscribe — so this is
 * the version that agrees with the conformance suite.
 */
function listenerList<T>(): {
  add: (listener: Listener<T>) => Unsubscribe;
  emit: (value: T) => void;
} {
  const listeners: (Listener<T> | undefined)[] = [];
  /** Nesting depth: a listener may report, which notifies this list again. */
  let notifying = 0;
  let blanks = 0;

  const compact = (): void => {
    let write = 0;
    for (let read = 0; read < listeners.length; read += 1) {
      const listener = listeners[read];
      if (listener !== undefined) {
        listeners[write] = listener;
        write += 1;
      }
    }
    listeners.length = write;
    blanks = 0;
  };

  return {
    add(listener) {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index === -1) {
          return;
        }
        if (notifying > 0) {
          listeners[index] = undefined;
          blanks += 1;
          return;
        }
        listeners.splice(index, 1);
      };
    },
    emit(value) {
      notifying += 1;
      try {
        // Bounded before the loop rather than read each time round, so a
        // listener that subscribes from inside its own callback is not called
        // for the event it is handling.
        const upTo = listeners.length;
        for (let index = 0; index < upTo; index += 1) {
          listeners[index]?.(value);
        }
      } finally {
        notifying -= 1;
        // Only the outermost notification compacts: doing it from a nested one
        // would move the entries the outer loop is still walking.
        if (notifying === 0 && blanks > 0) {
          compact();
        }
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
