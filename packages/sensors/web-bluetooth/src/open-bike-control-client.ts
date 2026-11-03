// SPDX-License-Identifier: Apache-2.0

/**
 * An OpenBikeControl controller over Web Bluetooth (#1824): request it by its
 * service, connect, subscribe to its buttons, tell it once which buttons the
 * app uses, and hand every notification to #1822's parser.
 *
 * ## Beside the transport, not inside it
 *
 * `transport.ts` is a `SensorTransport`: devices are found by **capability**
 * and deliver **measurements**. A controller has neither. It measures nothing
 * and controls no trainer, so it gets its own small client rather than a
 * capability the abstraction would have to grow for one device. It does share
 * the transport's rules: the one platform object it touches is the
 * `BluetoothPort` it is handed, and every failure reaching a caller is a
 * `SensorError` whose message names no device.
 *
 * ## Every GATT operation is bounded
 *
 * Web Bluetooth specifies no timeout for anything, and `gattserverdisconnected`
 * fires only for a link that was up (`docs/agents/web-bluetooth.md`). So the
 * four steps after the chooser (**connect**, **discover** the service and its
 * characteristics, **subscribe**, **write** the app information) each run
 * against a deadline. A step that misses it fails with
 * `SensorError('not-connected')` naming the step, and the link is torn down
 * before the promise settles: no listener stays attached, and a `connect()`
 * that answers after its deadline is disconnected again at once. A client
 * that failed is disconnected, never half-open.
 *
 * The chooser itself is not bounded: it waits for a person.
 *
 * ## What it writes
 *
 * Exactly one characteristic, the app information, with an acknowledged write,
 * once per connection. Nothing to the haptic characteristic and nothing to any
 * other service: the request names this one service and no other, so the
 * browser grants nothing else. `open-bike-control-client.test.ts` holds the set
 * of characteristics written.
 *
 * ## Malformed notifications
 *
 * Dropped and counted, never thrown: the parser returns a typed refusal and
 * this client adds one to {@link ControllerConnection.malformed}. A
 * notification with no value counts the same.
 */

import type { Seconds } from '@onyourleft/domain';

import {
  encodeAppInformation,
  OPEN_BIKE_CONTROL_APP_INFORMATION,
  OPEN_BIKE_CONTROL_BUTTON_STATE,
  OPEN_BIKE_CONTROL_SERVICE,
  parseButtonState,
  type OpenBikeControlEvent,
} from '../../protocol/src/open-bike-control';
import { ForgetUnconfirmedError, SensorError } from '../../src/errors';
import type { Unsubscribe } from '../../src/subscription';

import { discoveryError } from './errors';
import type { BluetoothDevicePort, BluetoothPort, GattCharacteristicPort } from './gatt';
import { DEFAULT_GATT_OPERATION_TIMEOUT, defaultSchedule } from './queue';

/** The four bounded steps, named in a timeout's message. */
export type ControllerStep = 'connect' | 'discover' | 'subscribe' | 'write';

export interface OpenBikeControlClientOptions {
  readonly bluetooth: BluetoothPort;
  /** The button ids the app acts on, sent in the app information. */
  readonly buttons: readonly number[];
  /** Per step. Defaults to `DEFAULT_GATT_OPERATION_TIMEOUT`. */
  readonly timeout?: Seconds | undefined;
  /** As `GattQueueOptions.schedule`: injected so a test bounds in milliseconds. */
  readonly schedule?: ((callback: () => void, after: Seconds) => () => void) | undefined;
  /**
   * Whether the page is handling a user gesture, as `SensorTransportOptions`
   * asks it. Defaults to `navigator.userActivation.isActive`, and to `true`
   * where the browser reports none.
   */
  readonly userActivation?: (() => boolean) | undefined;
}

/** One controller, connected. */
export interface ControllerConnection {
  /** The name the device advertised, if any. For the rider's own screen only. */
  readonly name: string | undefined;
  /** Whether the link is up and events are being delivered. */
  readonly connected: boolean;
  /** Notifications dropped because the parser refused them, or that carried no value. */
  readonly malformed: number;
  /** Each notification's events, in order. Nothing after a disconnect. */
  onEvents(listener: (events: readonly OpenBikeControlEvent[]) => void): Unsubscribe;
  /** Called once when the link goes, whoever dropped it. */
  onDisconnect(listener: () => void): Unsubscribe;
  /** Drop the link. Idempotent. */
  disconnect(): void;
  /** Revoke this origin's grant for the device, where the browser can. Drops the link. */
  forget(): Promise<void>;
}

export interface OpenBikeControlClient {
  /**
   * Ask the browser's chooser for a controller, then connect to it. Call from
   * a user gesture.
   *
   * @throws {SensorError} `user-gesture-required` when called outside a user
   * gesture, `no-device-selected` when the chooser closes,
   * `not-permitted` when the browser refuses, `not-connected` when a step
   * fails or misses its deadline, `capability-unsupported` when the device
   * does not serve the button-state characteristic.
   */
  requestAndConnect(): Promise<ControllerConnection>;
}

export function createOpenBikeControlClient(
  options: OpenBikeControlClientOptions,
): OpenBikeControlClient {
  const timeout = options.timeout ?? DEFAULT_GATT_OPERATION_TIMEOUT;
  const schedule = options.schedule ?? defaultSchedule;
  const userActivation = options.userActivation ?? defaultUserActivation;
  // Copied into a fresh `ArrayBuffer`-backed array: `BufferSource` excludes a shared buffer.
  const appInformation = new Uint8Array(encodeAppInformation(options.buttons));

  return {
    async requestAndConnect() {
      // Chrome reports a missing gesture as `SecurityError`, which
      // `discoveryError` would call `not-permitted`: check first, as the
      // transport does (`errors.ts`).
      if (!userActivation()) {
        throw new SensorError(
          'user-gesture-required',
          'requestDevice must be called from a user gesture',
        );
      }
      let device: BluetoothDevicePort;
      try {
        device = await options.bluetooth.requestDevice({
          filters: [{ services: [OPEN_BIKE_CONTROL_SERVICE] }],
          optionalServices: [OPEN_BIKE_CONTROL_SERVICE],
        });
      } catch (error) {
        throw discoveryError(error);
      }
      return connectTo(device, appInformation, timeout, schedule);
    },
  };
}

function defaultUserActivation(): boolean {
  const activation = (globalThis as { navigator?: { userActivation?: { isActive?: boolean } } })
    .navigator?.userActivation;
  return activation?.isActive ?? true;
}

/** Whether a discovery failure means the device lacks the service, rather than the link failing. */
function isMissing(error: unknown): boolean {
  const name: unknown =
    typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined;
  return name === 'NotFoundError' || name === 'SecurityError';
}

async function connectTo(
  device: BluetoothDevicePort,
  appInformation: Uint8Array<ArrayBuffer>,
  timeout: Seconds,
  schedule: (callback: () => void, after: Seconds) => () => void,
): Promise<ControllerConnection> {
  const gatt = device.gatt;
  if (gatt === undefined) {
    throw new SensorError('not-connected', 'the controller offers no GATT server');
  }

  let up = false;
  let torn = false;
  let malformed = 0;
  let buttonState: GattCharacteristicPort | undefined = undefined;
  const eventListeners: Array<(events: readonly OpenBikeControlEvent[]) => void> = [];
  const disconnectListeners: Array<() => void> = [];

  const onValue = (): void => {
    // Narrowing for TypeScript only: the listener is attached after `buttonState` is assigned.
    if (buttonState === undefined) return;
    const value = buttonState.value;
    if (value === undefined) {
      malformed += 1;
      return;
    }
    const result = parseButtonState(value);
    if (!result.ok) {
      malformed += 1;
      return;
    }
    for (const listener of [...eventListeners]) {
      try {
        listener(result.events);
      } catch {
        // A listener's fault is its own: it must not reach the browser's event dispatch
        // or keep the next listener from its events.
      }
    }
  };

  /** Remove every listener and drop the link. Safe to call more than once. */
  const tearDown = (): void => {
    const wasUp = up;
    up = false;
    torn = true;
    buttonState?.removeEventListener('characteristicvaluechanged', onValue);
    device.removeEventListener('gattserverdisconnected', onDropped);
    try {
      gatt.disconnect();
    } catch {
      // A shim that throws here has no link to drop.
    }
    if (wasUp) {
      for (const listener of [...disconnectListeners]) {
        try {
          listener();
        } catch {
          // A listener's fault is its own: the teardown, and a forget after it, go on.
        }
      }
    }
  };

  /** Fails the step in flight, if any, when the link drops under it. */
  let dropStep: (() => void) | undefined;

  function onDropped(): void {
    tearDown();
    dropStep?.();
  }

  /** Run one step against its deadline; on a miss, a drop or a failure, tear down and reject. */
  const step = async <T>(name: ControllerStep, operation: () => Promise<T>): Promise<T> => {
    let cancel: () => void = () => undefined;
    const bounds = new Promise<never>((_resolve, reject) => {
      cancel = schedule(() => {
        reject(
          new SensorError(
            'not-connected',
            `the controller did not answer the ${name} step in time`,
          ),
        );
      }, timeout);
      dropStep = () => {
        reject(
          new SensorError('not-connected', `the controller disconnected during the ${name} step`),
        );
      };
    });
    try {
      return await Promise.race([operation(), bounds]);
    } catch (error) {
      tearDown();
      if (error instanceof SensorError) throw error;
      throw new SensorError(
        name === 'discover' && isMissing(error) ? 'capability-unsupported' : 'not-connected',
        `the controller refused the ${name} step`,
        { cause: error },
      );
    } finally {
      cancel();
      dropStep = undefined;
    }
  };

  device.addEventListener('gattserverdisconnected', onDropped);
  await step('connect', async () => {
    await gatt.connect();
    // A connect that answers after its deadline must not leave a link up.
    if (torn) gatt.disconnect();
  });
  const { notifying, appInformationCharacteristic } = await step('discover', async () => {
    const service = await gatt.getPrimaryService(OPEN_BIKE_CONTROL_SERVICE);
    const found = await service.getCharacteristic(OPEN_BIKE_CONTROL_BUTTON_STATE);
    // Optional in the specification: a controller may not take app information.
    const information = await service
      .getCharacteristic(OPEN_BIKE_CONTROL_APP_INFORMATION)
      .catch((error: unknown) => {
        if (isMissing(error)) return undefined;
        throw error;
      });
    return { notifying: found, appInformationCharacteristic: information };
  });
  buttonState = notifying;
  buttonState.addEventListener('characteristicvaluechanged', onValue);
  await step('subscribe', () => notifying.startNotifications());
  up = true;
  if (appInformationCharacteristic !== undefined) {
    await step('write', () => appInformationCharacteristic.writeValueWithResponse(appInformation));
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
    async forget() {
      tearDown();
      const revoke = device.forget;
      if (typeof revoke !== 'function') return;
      // Bounded like every other call: a browser may never answer (#716). As the
      // transport does, a missed deadline is reported, not swallowed: the
      // browser's call is still running, and when it lands it can drop a
      // re-paired link (`ForgetUnconfirmedError.stillRunning`).
      let revoking: Promise<void>;
      try {
        revoking = revoke.call(device);
      } catch (error) {
        revoking = Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
      await new Promise<void>((resolve, reject) => {
        const cancel = schedule(() => {
          reject(
            new ForgetUnconfirmedError(
              'forget-timed-out',
              'the browser did not confirm the forget in time',
              {
                deviceId: device.id,
                holding: 'permission',
                stillRunning: revoking.then(
                  () => undefined,
                  () => undefined,
                ),
              },
            ),
          );
        }, timeout);
        revoking.then(
          () => {
            cancel();
            resolve();
          },
          (error: unknown) => {
            cancel();
            reject(
              new ForgetUnconfirmedError('forget-refused', 'the browser refused the forget', {
                deviceId: device.id,
                holding: 'permission',
                cause: error,
              }),
            );
          },
        );
      });
    },
  };
}
