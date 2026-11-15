// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The paired steering controller (#1826): pairing it, forgetting it, what the
 * Devices screen says about it, and the game's {@link ControllerPort} over it.
 *
 * ## Beside the ride controller, not inside it
 *
 * `controller.ts`' pairing is the transport's, by capability, and a
 * controller has none: it measures nothing and controls no trainer. So it is
 * paired through its own client ({@link SteeringControllerPort}) and held
 * here. Pairing it touches no other link: the trainer and the strap stay
 * connected and keep delivering, which `steering-controller.test.ts` holds on
 * one simulated radio with all three on it.
 *
 * ## One at a time
 *
 * Pairing again while one is connected lets the first go. A link that drops
 * is no longer listed; the screen says so once, and the rider pairs again.
 *
 * ## Remembered, in the Android shell — #2672
 *
 * Given a {@link SteeringReconnect} (only `shell-steering-controller.ts` gives
 * one), a controller that paired is remembered in the same memory as the
 * sensors (`remembered-sensors.ts`, role `controller`: its id, its name, and
 * nothing else), and *Forget* lets it go there too. It is then got back with
 * no chooser: {@link SteeringController.restoreRemembered} when the app opens,
 * and a link that drops is tried again on the sensors' backoff
 * (`controller.ts` §`RECONNECT_BACKOFF_SECONDS`), the row saying
 * *Reconnecting…* with its Forget button meanwhile. A try is made only while
 * the connection budget it shares with the sensors has a link free
 * ({@link SteeringReconnect.hasRoom}); one *Erase everything* took from the
 * memory is not tried again. One try at a time: the next is scheduled only
 * when the last has failed. Without a {@link SteeringReconnect} — the browser
 * — none of this happens and nothing changes.
 *
 * ## Nothing half-listed
 *
 * The state is `pairing` while the client works and becomes `connected` only
 * when it resolved. A failure is said in words (`failed`, with a reason) and
 * nothing is listed.
 */

import { OPEN_BIKE_CONTROL_BUTTON, type OpenBikeControlEvent } from '@onyourleft/sensors/protocol';

import { deviceId } from '@onyourleft/sensors';

import { CONTROLLER_THROW_BUTTONS } from '../game/delivery/controller-input';
import type { ControllerPort } from '../game/delivery/controller-port';

import { backoffSeconds } from './controller';
import type { RememberedSensor, RememberedSensors } from './remembered-sensors';
import type { SteeringControllerLink, SteeringControllerPort } from './steering-controller-port';

/**
 * The buttons the app tells a controller it acts on: steer left, steer right,
 * the handlebar angle, and the two Delivery throws with (#1827,
 * `game/delivery/controller-input.ts` §`CONTROLLER_THROW_BUTTONS`).
 */
export const STEERING_CONTROLLER_BUTTONS: readonly number[] = [
  OPEN_BIKE_CONTROL_BUTTON.steerLeft,
  OPEN_BIKE_CONTROL_BUTTON.steerRight,
  OPEN_BIKE_CONTROL_BUTTON.steeringAngle,
  ...Object.keys(CONTROLLER_THROW_BUTTONS).map(Number),
];

/** Why a pairing ended with nothing paired. */
export type SteeringPairingFailure = 'not-chosen' | 'not-a-controller' | 'no-answer' | 'refused';

export type SteeringControllerState =
  /** Nothing paired. `dropped` once a paired controller's link went. */
  | { readonly kind: 'none'; readonly dropped: boolean }
  | { readonly kind: 'pairing' }
  /** `name` is what the controller advertised, `undefined` where it advertised none. */
  | { readonly kind: 'connected'; readonly name: string | undefined }
  /** #2672: a remembered controller being got back with no chooser. */
  | { readonly kind: 'reconnecting'; readonly name: string | undefined }
  | { readonly kind: 'failed'; readonly reason: SteeringPairingFailure };

export interface SteeringController extends ControllerPort {
  readonly state: SteeringControllerState;
  /** Called after every change of {@link state}. Listeners must not throw. */
  subscribe(listener: () => void): () => void;
  /** Ask for a controller and connect it. Never rejects: a failure is the state. */
  pair(): Promise<void>;
  /** Let the paired controller go, and stop remembering it (#2672). */
  forget(): void;
  /**
   * Reconnect the controller this phone remembers, with no chooser — #2672,
   * as the app opens. Does nothing without a {@link SteeringReconnect}, with
   * none remembered, with one already listed, or with no link free in the
   * budget. Resolves once the first try has ended. Never rejects.
   */
  restoreRemembered(): Promise<void>;
}

/**
 * What the Android shell hands the steering controller so a paired one is
 * remembered and got back with no chooser — #2672. Built by
 * `shell-steering-controller.ts`, which requires every part.
 */
export interface SteeringReconnect {
  /** The memory the ride controller keeps its sensors in. */
  readonly remembered: RememberedSensors;
  /** The platform's connect with no chooser (`KnownSteeringControllerPort`). */
  connectKnown(id: string, name: string): Promise<SteeringControllerLink>;
  /** Whether the connection budget it shares with the sensors has a link free. */
  hasRoom(): boolean;
  /** Run `callback` once, `afterSeconds` from now. Returns a cancel. */
  schedule(callback: () => void, afterSeconds: number): () => void;
}

function failureOf(error: unknown): SteeringPairingFailure {
  const code: unknown =
    typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  switch (code) {
    case 'no-device-selected':
      return 'not-chosen';
    case 'capability-unsupported':
      return 'not-a-controller';
    case 'not-connected':
      return 'no-answer';
    default:
      return 'refused';
  }
}

/** The name a remembered entry keeps, as the state carries it. */
const nameOf = (sensor: RememberedSensor): string | undefined =>
  sensor.name === '' ? undefined : sensor.name;

export function createSteeringController(
  port: SteeringControllerPort,
  reconnect?: SteeringReconnect,
): SteeringController {
  let state: SteeringControllerState = { kind: 'none', dropped: false };
  let link: SteeringControllerLink | undefined;
  let detach: Array<() => void> = [];
  /**
   * Bumped by every pair, forget, drop and restore, so a pairing or a
   * reconnect try that was overtaken mid-way is told apart.
   */
  let generation = 0;
  /** #2672: cancels the reconnect try that is waiting, if one is. */
  let cancelRetry: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const eventListeners = new Set<(events: readonly OpenBikeControlEvent[]) => void>();

  const set = (next: SteeringControllerState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  /** Stop listening to the current link and let it go, and stop any reconnect. */
  const release = (): void => {
    cancelRetry?.();
    cancelRetry = undefined;
    for (const each of detach) each();
    detach = [];
    link?.disconnect();
    link = undefined;
  };

  /** #2672: the controller this phone remembers, the last one paired. */
  const rememberedController = (): RememberedSensor | undefined =>
    reconnect?.remembered.list().findLast((sensor) => sensor.role === 'controller');

  /** #2672: let every remembered controller go (there is one at most). */
  const dropRemembered = (): void => {
    if (reconnect === undefined) return;
    for (const sensor of reconnect.remembered.list()) {
      if (sensor.role === 'controller') reconnect.remembered.drop(sensor.id);
    }
  };

  /** #2672: try `sensor` again after the backoff for try number `attempt`. */
  const later = (
    using: SteeringReconnect,
    sensor: RememberedSensor,
    attempt: number,
    mine: number,
  ): void => {
    cancelRetry = using.schedule(() => {
      cancelRetry = undefined;
      void tryKnown(using, sensor, attempt, mine);
    }, backoffSeconds(attempt));
  };

  /** Listen to a link that opened, and list it. */
  const attach = (opened: SteeringControllerLink): void => {
    link = opened;
    detach = [
      opened.onEvents((events) => {
        for (const listener of [...eventListeners]) listener(events);
      }),
      opened.onDisconnect(() => {
        if (link !== opened) return;
        for (const each of detach) each();
        detach = [];
        link = undefined;
        generation += 1;
        // #2672: one this phone still remembers is got back with no chooser.
        const sensor = rememberedController();
        if (reconnect !== undefined && sensor !== undefined && sensor.id === opened.id) {
          set({ kind: 'reconnecting', name: opened.name });
          later(reconnect, sensor, 0, generation);
          return;
        }
        set({ kind: 'none', dropped: true });
      }),
    ];
    set({ kind: 'connected', name: opened.name });
  };

  /** #2672: one try at a remembered controller, with no chooser. Never rejects. */
  const tryKnown = async (
    using: SteeringReconnect,
    sensor: RememberedSensor,
    attempt: number,
    mine: number,
  ): Promise<void> => {
    if (generation !== mine) return;
    if (rememberedController()?.id !== sensor.id) {
      // *Erase everything* took it from the memory: not tried again.
      set({ kind: 'none', dropped: false });
      return;
    }
    if (!using.hasRoom()) {
      later(using, sensor, attempt + 1, mine);
      return;
    }
    let opened: SteeringControllerLink;
    try {
      opened = await using.connectKnown(sensor.id, sensor.name);
    } catch {
      if (generation === mine) later(using, sensor, attempt + 1, mine);
      return;
    }
    if (generation !== mine) {
      // Forgotten or paired over while the try was running: let it go.
      opened.disconnect();
      return;
    }
    attach(opened);
  };

  return {
    get state() {
      return state;
    },
    get paired() {
      return state.kind === 'connected';
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onControllerEvents(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    async pair() {
      if (state.kind === 'pairing') return;
      release();
      generation += 1;
      const mine = generation;
      set({ kind: 'pairing' });
      let opened: SteeringControllerLink;
      try {
        opened = await port.requestAndConnect();
      } catch (error) {
        if (generation === mine) set({ kind: 'failed', reason: failureOf(error) });
        return;
      }
      if (generation !== mine) {
        // Forgotten while the client worked: do not list it, and let it go.
        opened.disconnect();
        return;
      }
      // #2672: remembered once it has PAIRED, in place of any controller
      // remembered before, because one is paired at a time.
      if (reconnect !== undefined && opened.id !== undefined) {
        dropRemembered();
        reconnect.remembered.remember({
          id: deviceId(opened.id),
          name: opened.name ?? '',
          role: 'controller',
        });
      }
      attach(opened);
    },
    forget() {
      generation += 1;
      release();
      dropRemembered();
      set({ kind: 'none', dropped: false });
    },
    async restoreRemembered() {
      if (reconnect === undefined || state.kind !== 'none' || link !== undefined) return;
      const sensor = rememberedController();
      // Beyond the budget it stays remembered and is not listed, as a sensor does.
      if (sensor === undefined || !reconnect.hasRoom()) return;
      generation += 1;
      set({ kind: 'reconnecting', name: nameOf(sensor) });
      await tryKnown(reconnect, sensor, 0, generation);
    },
  };
}
