// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pairing a steering controller, on whichever platform this is (#1826).
 *
 * The browser's client (`@onyourleft/sensors/web-bluetooth`
 * §`createOpenBikeControlClient`, #1824) and the Android shell's
 * (`@onyourleft/mobile` §`createCapacitorOpenBikeControlClient`, #1825) both
 * satisfy it unchanged; `main.tsx` §`buildPlatform` picks one beside the
 * transport, as it picks the transport. Every step of either is bounded, so a
 * pairing that never answers fails rather than hangs.
 */

import type { OpenBikeControlEvent } from '@onyourleft/sensors/protocol';

/** One controller, connected. */
export interface SteeringControllerLink {
  /** The name it advertised, for the rider's own screen. */
  readonly name: string | undefined;
  onEvents(listener: (events: readonly OpenBikeControlEvent[]) => void): () => void;
  /** Called once when the link goes, whoever dropped it. */
  onDisconnect(listener: () => void): () => void;
  disconnect(): void;
}

export interface SteeringControllerPort {
  /**
   * Show the platform's chooser for a controller, and connect to the one
   * chosen. In a browser this needs the rider's press.
   *
   * @throws {SensorError} — see the clients for the codes.
   */
  requestAndConnect(): Promise<SteeringControllerLink>;
}
