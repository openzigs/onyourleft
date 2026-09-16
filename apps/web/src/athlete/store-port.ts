// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The one write the settings screen makes about the rider themselves (#325).
 *
 * A port of its own rather than a widening of `UnitsPort`, for the reason every
 * other port in this client is separate — `units/store-port.ts` states it — and
 * for one more that is specific to this pair: a unit preference is a *display*
 * choice that changes nothing computed, and a mass is an input to the physics.
 * The two happen to be edited on the same screen and they are not the same kind
 * of thing, so a screen that offered one is not thereby entitled to the other.
 *
 * ⚠️ **No read.** The current value is handed down from the athlete row
 * `main.tsx` already establishes at start-up (`local-athlete.ts`), and the
 * shell owns it from there, for `UnitsStore`'s reason: a second read would be a
 * second answer to "what does this rider weigh", and the two could disagree for
 * the length of a page load — which on this field means the settings screen and
 * the game disagreeing about the ride in progress.
 *
 * ⚠️ **It is a `*-port.ts`, so `check:wiring` watches it** (§4j). `WIRE003`
 * fails if {@link AthleteMassStore.setAthleteMass} has no production caller,
 * which is exactly the defect #325 is: a store method with nothing but tests
 * behind it. Note the limit recorded in `check-wiring.mjs` §Limits — an
 * optional prop nobody supplies is invisible to it, so the gate covers "the
 * screen calls the port" and `AppShell.test.tsx` covers "the shell supplies
 * one".
 */

import type { Kilograms } from '@onyourleft/domain';
import type { AthleteId, AthleteRecord } from '@onyourleft/store';

export interface AthleteMassStore {
  /**
   * @param mass `undefined` clears it, returning the rider to the documented
   * default — `athlete/mass.ts` §`DEFAULT_RIDER_MASS_KILOGRAMS`. It is the only
   * way somebody who typed a weight by mistake can undo it, so it is a write
   * rather than a refusal.
   *
   * @returns the written row, or `undefined` when there is no such athlete.
   *
   * ⚠️ **`undefined` means nothing was written, and it does not throw.** Every
   * caller must branch on it, for the reason `UnitsStore.setAthleteUnits`
   * gives: discarding the return turns "nothing happened" into a success
   * message and a screen that disagrees with the disk until the next reload.
   */
  setAthleteMass(id: AthleteId, mass: Kilograms | undefined): Promise<AthleteRecord | undefined>;
}

export interface AthleteMassPort {
  readonly store: AthleteMassStore;
  /** Whose mass this is. Every write is scoped by it. */
  readonly athleteId: AthleteId;
}
