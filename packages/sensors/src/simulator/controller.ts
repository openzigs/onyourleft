// SPDX-License-Identifier: Apache-2.0

/**
 * A simulated **steering and button controller** (#1823): an OpenBikeControl
 * device that plays a script of presses, releases and angles on the
 * simulator's clock, so that the transports (#1824, #1825), pairing (#1826)
 * and Delivery (#1827) can be tested with no hardware.
 *
 * ## What this half is, and what the bridge is
 *
 * This directory bars bytes and UUIDs (`../../README.md`): the device here is
 * a model, and what it notifies is a list of typed changes. The bytes on the
 * wire are written by `protocol/src/simulator-bridge.ts` with literal offsets,
 * never through the client's codec, so a mistake in one is a red test against
 * the other rather than a value they agree on. The same goes for the app
 * information: the bridge reads the octets a client wrote and hands this model
 * what they said.
 *
 * ## A controller is neither a sensor nor a trainer
 *
 * It declares no capability (`devices.ts` §`SERVICE_CAPABILITIES`): it
 * measures nothing and controls nothing. Nothing it does reaches a trainer's
 * control point, on the bench or anywhere else.
 *
 * ## It misbehaves on purpose
 *
 * A step can be a malformed notification, by shape, or the link dropping.
 * A notification that falls due while the link is down is lost, as a real
 * device's is: nobody is subscribed to it.
 */

import type { Seconds } from '@onyourleft/domain';

import type { Listener, Unsubscribe } from '../subscription';
import { listenerList } from './listeners';

/** One button's change, or the angle's, within a notification. */
export type ControllerChange =
  /** A button id, as the protocol numbers them (`0x18` steer left, `0x19` steer right, …). */
  | { readonly kind: 'press'; readonly button: number }
  | { readonly kind: 'release'; readonly button: number }
  /**
   * The calibrated handlebar angle: negative left, positive right. A real
   * device clamps to ±63° and sends half-degree steps; the bridge does both, so
   * a script may ask for 90° to see the clamp.
   */
  | { readonly kind: 'angle'; readonly degrees: number }
  /** The device has lost its angle (recalibrating, or the sensor is gone). */
  | { readonly kind: 'angle-unavailable' };

/** The malformed notifications a script can send, by what is wrong with them. */
export type MalformedShape =
  'empty' | 'no-buttons' | 'unknown-message-type' | 'odd-length' | 'oversized';

/** What the controller sends in one notification. */
export type ControllerNotification =
  | { readonly kind: 'changes'; readonly changes: readonly ControllerChange[] }
  | { readonly kind: 'malformed'; readonly shape: MalformedShape };

/**
 * One step of a script. `at` is whole seconds of the simulator's clock since
 * the simulator was created; steps sharing an `at` play in the order written,
 * each as its own notification.
 */
export type ControllerStep = { readonly at: Seconds } & (
  | ControllerNotification
  /** The link drops. Steps after it fall on a dead link and are lost. */
  | { readonly kind: 'disconnect' }
);

/** What a client told the device in the app-information message, as the bridge read it. */
export interface AppInformation {
  readonly appId: string;
  readonly appVersion: string;
  readonly buttons: readonly number[];
}

export interface ControllerOptions {
  readonly script?: readonly ControllerStep[];
}

/** The device's side of the controller, as the bench and the bridge see it. */
export interface SimulatedController {
  /** Every notification this device actually sent, in order, as it is sent. */
  onNotification(listener: Listener<ControllerNotification>): Unsubscribe;
  /** Every notification sent so far. */
  sent(): readonly ControllerNotification[];
  /**
   * Record an app-information write. Called by the bridge, which reads the
   * octets; the specification says a new message replaces the last.
   */
  receiveAppInformation(information: AppInformation): void;
  /** The app information in force: emptied on every disconnect, as the specification says. */
  appInformation(): AppInformation | undefined;
  /** Every app-information write, in order, across links. */
  appInformationWrites(): readonly AppInformation[];
}

/** The simulator's handle on a controller: what plays the script, and what a link loss clears. */
export interface ControllerMachine {
  readonly controller: SimulatedController;
  /**
   * The steps due at `elapsed` seconds, in script order. The simulator plays
   * them; a `disconnect` is its to carry out, because the session is.
   */
  due(elapsed: number): readonly ControllerStep[];
  notify(notification: ControllerNotification): void;
  onLinkLost(): void;
}

export function createControllerMachine(options: ControllerOptions = {}): ControllerMachine {
  const script = [...(options.script ?? [])];
  for (const step of script) {
    if (!Number.isInteger(step.at) || step.at < 1) {
      throw new RangeError(
        `a controller step falls on a whole second after the start, 1 or later; received ${String(step.at)}`,
      );
    }
  }
  const notifications = listenerList<ControllerNotification>();
  const sent: ControllerNotification[] = [];
  const writes: AppInformation[] = [];
  let current: AppInformation | undefined;

  return {
    controller: {
      onNotification: (listener) => notifications.add(listener),
      sent: () => [...sent],
      receiveAppInformation(information) {
        writes.push(information);
        current = information;
      },
      appInformation: () => current,
      appInformationWrites: () => [...writes],
    },
    due: (elapsed) => script.filter((step) => step.at === elapsed),
    notify(notification) {
      sent.push(notification);
      notifications.emit(notification);
    },
    onLinkLost() {
      current = undefined;
    },
  };
}
