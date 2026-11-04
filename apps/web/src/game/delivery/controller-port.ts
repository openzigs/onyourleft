// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The game's controller port (#1826): what a paired steering controller
 * reports, as #1822's codec reads it — steer left and right, the handlebar
 * angle, and other buttons by id.
 *
 * ## The only way a controller reaches the game
 *
 * `ride/steering-controller.ts` holds the paired controller and implements
 * this port; the game is handed the port and never the client. The clients
 * (`@onyourleft/sensors/web-bluetooth`, `@onyourleft/mobile`) write the app
 * information to the controller, which makes them GATT writers in
 * `cannot-reach-trainer-testing.ts`' sense, so no module under
 * `game/delivery/` may import one (#1807, DL5). This port names a type and
 * nothing else, and its events have no member a trainer could take.
 */

import type { OpenBikeControlEvent } from '@onyourleft/sensors/protocol';

export interface ControllerPort {
  /**
   * Each notification's events, in order, while a controller is paired.
   *
   * @unwired #1827 maps these events to Delivery's lane and throw intents.
   * Until it lands, `views/DevicesView.controller.test.tsx` and
   * `ride/steering-controller.test.ts` are its readers.
   */
  onControllerEvents(listener: (events: readonly OpenBikeControlEvent[]) => void): () => void;
}
