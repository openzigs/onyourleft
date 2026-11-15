// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The settings screen's read and write of the rider's calorie inputs — the sex
 * and the year of birth a heart-rate calorie estimate needs (#2432).
 *
 * A port of its own for the reason `kit-colour-port.ts` gives: a screen offered
 * one of the athlete's narrow writes is not thereby entitled to another.
 *
 * ⚠️ **It READS, and the read is the store's**, for `masked-words-port.ts`'
 * reason: nothing else in the client holds these, and the one other reader —
 * the ride's save, which freezes a calorie figure (#2433) — reads the row
 * afresh, so the screen does too rather than keeping a copy from start-up.
 *
 * ⚠️ **It is a `*-port.ts`, so `check:wiring` watches it** (§4j): `WIRE003`
 * fails if either method has no production caller.
 */

import type { AthleteId, AthleteRecord, CalorieSex } from '@onyourleft/store';

export interface CalorieInputsStore {
  getAthlete(id: AthleteId): Promise<AthleteRecord | undefined>;
  /**
   * `undefined` clears a field.
   *
   * @returns the written row, or `undefined` when there is no such athlete.
   *
   * ⚠️ **`undefined` means nothing was written, and it does not throw** —
   * `UnitsStore.setAthleteUnits`' reason.
   */
  setAthleteCalorieInputs(
    id: AthleteId,
    inputs: {
      readonly calorieSex: CalorieSex | undefined;
      readonly birthYear: number | undefined;
    },
  ): Promise<AthleteRecord | undefined>;
}

export interface CalorieInputsPort {
  readonly store: CalorieInputsStore;
  /** Whose inputs these are. Every read and write is scoped by it. */
  readonly athleteId: AthleteId;
}
