// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The settings screen's read of the rider's calorie inputs and write of the
 * year of birth a heart-rate calorie estimate needs (#2432).
 *
 * Since the owner's ruling of 2026-11-20 the sex is the rider's one Female /
 * Male choice, written by `rider-body-port.ts` with the rider drawn; this port
 * writes only the year, so saving the year cannot undo a rider choice made
 * after this panel read the row.
 *
 * A port of its own for the reason `kit-colour-port.ts` gives: a screen offered
 * one of the athlete's narrow writes is not thereby entitled to another.
 *
 * ⚠️ **It READS, and the read is the store's**, for `masked-words-port.ts`'
 * reason: nothing else in the client holds the year, and the one other reader
 * — the ride's save, which freezes a calorie figure (#2433) — reads the row
 * afresh, so the screen does too rather than keeping a copy from start-up.
 *
 * ⚠️ **It is a `*-port.ts`, so `check:wiring` watches it** (§4j): `WIRE003`
 * fails if either method has no production caller.
 */

import type { AthleteId, AthleteRecord } from '@onyourleft/store';

export interface CalorieInputsStore {
  getAthlete(id: AthleteId): Promise<AthleteRecord | undefined>;
  /**
   * `undefined` clears the year.
   *
   * @returns the written row, or `undefined` when there is no such athlete.
   *
   * ⚠️ **`undefined` means nothing was written, and it does not throw** —
   * `UnitsStore.setAthleteUnits`' reason.
   */
  setAthleteBirthYear(
    id: AthleteId,
    birthYear: number | undefined,
  ): Promise<AthleteRecord | undefined>;
}

export interface CalorieInputsPort {
  readonly store: CalorieInputsStore;
  /** Whose inputs these are. Every read and write is scoped by it. */
  readonly athleteId: AthleteId;
}
