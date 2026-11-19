// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The settings screen's write of which rider is drawn (#2839).
 *
 * A port of its own, beside `kit-colour-port.ts` and for its reason: a screen
 * offered one narrow write is not thereby entitled to another. ⚠️ And
 * deliberately NOT `calorie-inputs-port.ts`: the owner's ruling of 2026-11-18
 * is that choosing how you look does not touch a health input, so this port
 * cannot reach `calorieSex` at all — it has no member that reads or writes it.
 *
 * ⚠️ **No read**, for `AthleteKitColourStore`'s reason: the current value is
 * read from the athlete row `main.tsx` establishes at start-up and the shell
 * owns it from there, so the settings screen and the game cannot disagree.
 *
 * ⚠️ **It is a `*-port.ts`, so `check:wiring` watches it** (§4j): `WIRE003`
 * fails if {@link AthleteRiderBodyStore.setAthleteRiderBody} has no production
 * caller.
 */

import type { AthleteId, AthleteRecord, RiderBody } from '@onyourleft/store';

export interface AthleteRiderBodyStore {
  /**
   * @returns the written row, or `undefined` when there is no such athlete.
   *
   * ⚠️ **`undefined` means nothing was written, and it does not throw.** Every
   * caller must branch on it, for the reason `UnitsStore.setAthleteUnits`
   * gives.
   */
  setAthleteRiderBody(id: AthleteId, riderBody: RiderBody): Promise<AthleteRecord | undefined>;
}

export interface AthleteRiderBodyPort {
  readonly store: AthleteRiderBodyStore;
  /** Whose rider this is. Every write is scoped by it. */
  readonly athleteId: AthleteId;
}
