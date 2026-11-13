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
 * ## Nothing half-listed
 *
 * The state is `pairing` while the client works and becomes `connected` only
 * when it resolved. A failure is said in words (`failed`, with a reason) and
 * nothing is listed.
 */

import { OPEN_BIKE_CONTROL_BUTTON, type OpenBikeControlEvent } from '@onyourleft/sensors/protocol';

import { CONTROLLER_THROW_BUTTONS } from '../game/delivery/controller-input';
import type { ControllerPort } from '../game/delivery/controller-port';

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
  | { readonly kind: 'failed'; readonly reason: SteeringPairingFailure };

export interface SteeringController extends ControllerPort {
  readonly state: SteeringControllerState;
  /** Called after every change of {@link state}. Listeners must not throw. */
  subscribe(listener: () => void): () => void;
  /** Ask for a controller and connect it. Never rejects: a failure is the state. */
  pair(): Promise<void>;
  /** Let the paired controller go. */
  forget(): void;
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

export function createSteeringController(port: SteeringControllerPort): SteeringController {
  let state: SteeringControllerState = { kind: 'none', dropped: false };
  let link: SteeringControllerLink | undefined;
  let detach: Array<() => void> = [];
  /** Bumped by every pair and forget, so a pairing that was forgotten mid-way is told apart. */
  let generation = 0;
  const listeners = new Set<() => void>();
  const eventListeners = new Set<(events: readonly OpenBikeControlEvent[]) => void>();

  const set = (next: SteeringControllerState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  /** Stop listening to the current link and let it go. */
  const release = (): void => {
    for (const each of detach) each();
    detach = [];
    link?.disconnect();
    link = undefined;
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
          set({ kind: 'none', dropped: true });
        }),
      ];
      set({ kind: 'connected', name: opened.name });
    },
    forget() {
      generation += 1;
      release();
      set({ kind: 'none', dropped: false });
    },
  };
}
