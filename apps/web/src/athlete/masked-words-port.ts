// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The settings screen's read and write of the rider's own list of words that
 * are always masked before anything is sent to a hosted model (#839).
 *
 * A port of its own for the reason `kit-colour-port.ts` gives: a screen
 * offered one of the athlete's narrow writes is not thereby entitled to
 * another.
 *
 * ⚠️ **Unlike the kit colour it READS, and the read is the store's.** Nothing
 * else in the client holds the list: the hosted transport reads it afresh for
 * every request (`ride-analysis/hosted-mask.ts` §`readMaskingGuard`), so the
 * screen reads it the same way rather than from a copy the shell kept since
 * start-up that a save could leave behind.
 *
 * ⚠️ **It is a `*-port.ts`, so `check:wiring` watches it** (§4j): `WIRE003`
 * fails if either method has no production caller.
 */

import type { AthleteId, AthleteRecord } from '@onyourleft/store';

export interface MaskedWordsStore {
  getAthlete(id: AthleteId): Promise<AthleteRecord | undefined>;
  /**
   * @returns the written row, or `undefined` when there is no such athlete.
   *
   * ⚠️ **`undefined` means nothing was written, and it does not throw** —
   * `UnitsStore.setAthleteUnits`' reason.
   */
  setAthleteMaskedWords(
    id: AthleteId,
    words: readonly string[],
  ): Promise<AthleteRecord | undefined>;
}

export interface MaskedWordsPort {
  readonly store: MaskedWordsStore;
  /** Whose list this is. Every read and write is scoped by it. */
  readonly athleteId: AthleteId;
}
