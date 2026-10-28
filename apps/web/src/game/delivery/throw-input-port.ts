// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the HUD's throw control hands the ride — #1810.
 *
 * ⚠️ **A `*-port.ts` on purpose**: `check:wiring` then requires its one
 * method to have a production caller (§4j, `WIRE003`). `hud/ThrowControl.tsx`
 * calls it, for a press and for a key. What implements it is #1816's:
 * `GameView` takes the intent, resolves it to a side with `throw.ts`
 * §`throwSideFor` and steps the throw on the simulation tick. Until then no
 * production ride hands the HUD a port, so no rider sees the control.
 *
 * ⚠️ **One method, and it asks for a throw and nothing else.** No game event
 * may change what the trainer is sent (ADR 0059 D-2), so nothing a rider
 * presses to throw has a way to ask for anything more. The test holds the
 * interface to this one method.
 */

import type { ThrowIntent } from './throw-input';

export interface ThrowInputPort {
  /** The rider asked for a throw, by a press on the HUD or by a key. */
  throwParcel(intent: ThrowIntent): void;
}
