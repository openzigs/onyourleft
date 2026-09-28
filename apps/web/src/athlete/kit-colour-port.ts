// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The settings screen's write of the rider's kit colour (#623).
 *
 * A port of its own rather than a widening of `athlete/store-port.ts`'
 * `AthleteMassStore`, for the reason that file gives about units and mass: a
 * mass is an input to the physics and a kit colour is how the rider is drawn,
 * and a screen offered one is not thereby entitled to the other.
 *
 * ⚠️ **No read**, for `AthleteMassStore`'s reason: the current value is read
 * from the athlete row `main.tsx` establishes at start-up and the shell owns
 * it from there, so the settings screen and the game cannot disagree about it.
 *
 * ⚠️ **It is a `*-port.ts`, so `check:wiring` watches it** (§4j): `WIRE003`
 * fails if {@link AthleteKitColourStore.setAthleteKitColour} has no production
 * caller.
 */

import type { AthleteId, AthleteRecord, KitColour } from '@onyourleft/store';

export interface AthleteKitColourStore {
  /**
   * @returns the written row, or `undefined` when there is no such athlete.
   *
   * ⚠️ **`undefined` means nothing was written, and it does not throw.** Every
   * caller must branch on it, for the reason `UnitsStore.setAthleteUnits`
   * gives.
   */
  setAthleteKitColour(id: AthleteId, kitColour: KitColour): Promise<AthleteRecord | undefined>;
}

export interface AthleteKitColourPort {
  readonly store: AthleteKitColourStore;
  /** Whose kit this is. Every write is scoped by it. */
  readonly athleteId: AthleteId;
}
