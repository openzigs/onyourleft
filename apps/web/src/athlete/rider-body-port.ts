// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The settings screen's write of the rider's one Female / Male choice (#2839).
 *
 * The owner's ruling of 2026-11-20, "They should be a single choice": the
 * choice is both the rider the trainer game draws (`riderBody`) and the
 * heart-rate calorie estimate's sex (`calorieSex`, #2432), and
 * {@link AthleteRiderBodyStore.setAthleteRider} writes the two together in one
 * transaction. That supersedes the 2026-11-18 design, in which this port could
 * not reach `calorieSex` at all. The calorie panel's own port
 * (`calorie-inputs-port.ts`) now writes only the year of birth.
 *
 * ⚠️ **No read**, for `AthleteKitColourStore`'s reason: the current choice is
 * read from the athlete row `main.tsx` establishes at start-up (through
 * `riderChoiceOf`) and the shell owns it from there, so the settings screen,
 * the game and the calorie panel cannot disagree.
 *
 * ⚠️ **It is a `*-port.ts`, so `check:wiring` watches it** (§4j): `WIRE003`
 * fails if {@link AthleteRiderBodyStore.setAthleteRider} has no production
 * caller.
 */

import type { AthleteId, AthleteRecord, RiderBody } from '@onyourleft/store';

export interface AthleteRiderBodyStore {
  /**
   * Writes `rider` to both `riderBody` and `calorieSex`.
   *
   * @returns the written row, or `undefined` when there is no such athlete.
   *
   * ⚠️ **`undefined` means nothing was written, and it does not throw.** Every
   * caller must branch on it, for the reason `UnitsStore.setAthleteUnits`
   * gives.
   */
  setAthleteRider(id: AthleteId, rider: RiderBody): Promise<AthleteRecord | undefined>;
}

export interface AthleteRiderBodyPort {
  readonly store: AthleteRiderBodyStore;
  /** Whose rider this is. Every write is scoped by it. */
  readonly athleteId: AthleteId;
}
