// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * An OpenBikeControl controller in the Android shell (#1825), through the
 * Capacitor BLE plugin: the same client as the browser's
 * (`packages/sensors/web-bluetooth/src/open-bike-control-client.ts`, #1824),
 * over {@link CapacitorBlePort} rather than Web Bluetooth.
 *
 * ## Every plugin call is bounded
 *
 * Nothing specifies a timeout for a plugin call, and #322 measured one that
 * was received and never answered. So each call runs against a deadline:
 * `initialize`, the chooser, `connect`, `getServices` (discover),
 * `requestConnectionPriority`, `startNotifications` (subscribe) and the
 * app-information `write`. A step that misses its deadline, fails, or loses
 * its link fails the whole open with `SensorError('not-connected')` naming the
 * step, and the link is dropped first, with every later notification ignored.
 * A `connect` that answers after its deadline is disconnected again. A client
 * that failed is disconnected, never half-open.
 *
 * The chooser has a deadline of its own, {@link CHOOSER_DEADLINE}: a person is
 * looking at it, and thirty seconds is too short for finding a controller and
 * waking it.
 *
 * ## The connection priority
 *
 * The plugin at 8.3.0 can ask for one (`plugin-port.ts`
 * §`requestConnectionPriority`), so this client asks for `high` once the link
 * is up: a press should not wait on a slow connection interval. It is a hint,
 * so a refusal or a missed deadline is ignored and the open goes on.
 *
 * ## What it writes
 *
 * Exactly one acknowledged `write`, of #1822's app information, once per
 * connection, and only if the controller serves the characteristic (the
 * specification makes it optional). Nothing else: not the haptic
 * characteristic and nothing on any other service. No new Android permission:
 * `BLUETOOTH_SCAN` and `BLUETOOTH_CONNECT` are already in the manifest.
 *
 * Malformed notifications are dropped and counted, never thrown.
 */

import { SensorError, type Unsubscribe } from '@onyourleft/sensors';
import {
  encodeAppInformation,
  OPEN_BIKE_CONTROL_APP_INFORMATION,
  OPEN_BIKE_CONTROL_BUTTON_STATE,
  OPEN_BIKE_CONTROL_SERVICE,
  parseButtonState,
  type OpenBikeControlEvent,
} from '@onyourleft/sensors/protocol';
import { seconds, type Seconds } from '@onyourleft/domain';

import type { CapacitorBlePort, PluginDevice } from './plugin-port';
import type { Schedule } from './transport';

/** The bounded steps, named in a timeout's message. */
export type CapacitorControllerStep =
  'initialize' | 'choose' | 'connect' | 'discover' | 'subscribe' | 'write';

/**
 * How long one plugin call may take: the Web Bluetooth client's bound
 * (`DEFAULT_GATT_OPERATION_TIMEOUT`, thirty seconds), restated rather than
 * imported, as `transport.ts` §`FORGET_DEADLINE` does, because the shell must
 * not depend on the browser adapter.
 */
export const CONTROLLER_CALL_DEADLINE: Seconds = seconds(30);

/** How long the chooser may stay open: a person is looking at it. */
export const CHOOSER_DEADLINE: Seconds = seconds(120);

export interface CapacitorOpenBikeControlOptions {
  readonly plugin: CapacitorBlePort;
  /** The button ids the app acts on, sent in the app information. */
  readonly buttons: readonly number[];
  /** Per call. Defaults to {@link CONTROLLER_CALL_DEADLINE}. */
  readonly timeout?: Seconds | undefined;
  /** Defaults to {@link CHOOSER_DEADLINE}. */
  readonly chooserTimeout?: Seconds | undefined;
  /** Defaults to `setTimeout`. */
  readonly schedule?: Schedule | undefined;
}

/** One controller, connected. The same shape as the browser client's. */
export interface CapacitorControllerConnection {
  readonly name: string | undefined;
  readonly connected: boolean;
  /** Notifications dropped because the parser refused them. */
  readonly malformed: number;
  onEvents(listener: (events: readonly OpenBikeControlEvent[]) => void): Unsubscribe;
  /** Called once when the link goes, whoever dropped it. */
  onDisconnect(listener: () => void): Unsubscribe;
  /** Drop the link. Idempotent. */
  disconnect(): void;
}

export interface CapacitorOpenBikeControlClient {
  /**
   * Bring the plugin up, show the chooser for a controller, and connect.
   *
   * @throws {SensorError} `no-device-selected` when the chooser closes,
   * `not-connected` when a call fails or misses its deadline,
   * `capability-unsupported` when the device serves no button state.
   */
  requestAndConnect(): Promise<CapacitorControllerConnection>;
}

function defaultSchedule(callback: () => void, after: Seconds): () => void {
  const handle = setTimeout(callback, after * 1000);
  return () => {
    clearTimeout(handle);
  };
}

export function createCapacitorOpenBikeControlClient(
  options: CapacitorOpenBikeControlOptions,
): CapacitorOpenBikeControlClient {
  const { plugin } = options;
  const timeout = options.timeout ?? CONTROLLER_CALL_DEADLINE;
  const chooserTimeout = options.chooserTimeout ?? CHOOSER_DEADLINE;
  const schedule = options.schedule ?? defaultSchedule;
  const information = encodeAppInformation(options.buttons);

  /** Race a call against its deadline. Rejects with the step's typed error on a miss. */
  const bounded = <T>(
    step: CapacitorControllerStep,
    call: () => Promise<T>,
    within: Seconds = timeout,
  ): Promise<T> => {
    let cancel: () => void = () => undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      cancel = schedule(() => {
        reject(
          new SensorError(
            'not-connected',
            `the controller did not answer the ${step} step in time`,
          ),
        );
      }, within);
    });
    return Promise.race([call(), deadline]).finally(cancel);
  };

  return {
    async requestAndConnect() {
      await bounded('initialize', () => plugin.initialize());
      let device: PluginDevice;
      try {
        device = await bounded(
          'choose',
          () =>
            plugin.requestDevice({
              services: [OPEN_BIKE_CONTROL_SERVICE],
              optionalServices: [OPEN_BIKE_CONTROL_SERVICE],
            }),
          chooserTimeout,
        );
      } catch (error) {
        if (error instanceof SensorError) throw error;
        throw new SensorError('no-device-selected', 'the chooser closed without a controller', {
          cause: error,
        });
      }
      return open(device);
    },
  };

  async function open(device: PluginDevice): Promise<CapacitorControllerConnection> {
    const id = device.deviceId;
    let up = false;
    let torn = false;
    let malformed = 0;
    const eventListeners: Array<(events: readonly OpenBikeControlEvent[]) => void> = [];
    const disconnectListeners: Array<() => void> = [];
    let dropStep: (() => void) | undefined;

    const tearDown = (): void => {
      const wasUp = up;
      up = false;
      if (torn) return;
      torn = true;
      // Bounded and not awaited: a disconnect that never answers must not
      // hold anything up, and the link is ours to forget either way.
      void bounded('connect', () => plugin.disconnect(id)).catch(() => undefined);
      if (wasUp) {
        for (const listener of [...disconnectListeners]) listener();
      }
    };

    const onValue = (value: DataView): void => {
      // The plugin owns this callback until the link goes; after a teardown
      // it is ignored rather than removed.
      if (!up) return;
      const result = parseButtonState(value);
      if (!result.ok) {
        malformed += 1;
        return;
      }
      for (const listener of [...eventListeners]) listener(result.events);
    };

    const step = async <T>(name: CapacitorControllerStep, call: () => Promise<T>): Promise<T> => {
      const dropped = new Promise<never>((_resolve, reject) => {
        dropStep = () => {
          reject(
            new SensorError('not-connected', `the controller disconnected during the ${name} step`),
          );
        };
      });
      try {
        return await Promise.race([bounded(name, call), dropped]);
      } catch (error) {
        tearDown();
        if (error instanceof SensorError) throw error;
        throw new SensorError('not-connected', `the controller refused the ${name} step`, {
          cause: error,
        });
      } finally {
        dropStep = undefined;
      }
    };

    await step('connect', async () => {
      await plugin.connect(id, () => {
        tearDown();
        dropStep?.();
      });
      // A connect that answers after its deadline must not leave a link up.
      if (torn) await plugin.disconnect(id);
    });
    const services = await step('discover', () => plugin.getServices(id));
    const service = services.find((candidate) => candidate.uuid === OPEN_BIKE_CONTROL_SERVICE);
    const has = (characteristic: string): boolean =>
      service?.characteristics.some((candidate) => candidate.uuid === characteristic) === true;
    if (!has(OPEN_BIKE_CONTROL_BUTTON_STATE)) {
      tearDown();
      throw new SensorError('capability-unsupported', 'this device is not a steering controller');
    }
    // A hint: refused or unanswered, the open goes on.
    await bounded('connect', () => plugin.requestConnectionPriority(id, 'high')).catch(
      () => undefined,
    );
    up = true;
    await step('subscribe', () =>
      plugin.startNotifications(
        id,
        OPEN_BIKE_CONTROL_SERVICE,
        OPEN_BIKE_CONTROL_BUTTON_STATE,
        onValue,
      ),
    );
    if (has(OPEN_BIKE_CONTROL_APP_INFORMATION)) {
      await step('write', () =>
        plugin.write(
          id,
          OPEN_BIKE_CONTROL_SERVICE,
          OPEN_BIKE_CONTROL_APP_INFORMATION,
          new DataView(information.buffer, information.byteOffset, information.byteLength),
        ),
      );
    }

    return {
      name: device.name,
      get connected() {
        return up;
      },
      get malformed() {
        return malformed;
      },
      onEvents(listener) {
        eventListeners.push(listener);
        return () => {
          const at = eventListeners.indexOf(listener);
          if (at !== -1) eventListeners.splice(at, 1);
        };
      },
      onDisconnect(listener) {
        disconnectListeners.push(listener);
        return () => {
          const at = disconnectListeners.indexOf(listener);
          if (at !== -1) disconnectListeners.splice(at, 1);
        };
      },
      disconnect: tearDown,
    };
  }
}
