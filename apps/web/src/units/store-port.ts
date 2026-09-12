// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The one write the settings screen may make (#238).
 *
 * A port of its own rather than a widening of `AnalysisPort`, for the reason
 * every other port in this client is separate: `UnitsStore` names one method,
 * so a screen that lets a rider choose kilometres or miles cannot reach a
 * ride, a stream, a segment or another athlete's anything. `ActivityStore`
 * satisfies it structurally, so `main.tsx` builds it as one object literal
 * over the same connection.
 *
 * ⚠️ **No read.** The current value is handed down from the athlete row
 * `main.tsx` already establishes at start-up (`local-athlete.ts`), because a
 * second read would be a second answer to "which units is this client in" and
 * the two could disagree for the length of a page load — which is the
 * half-converted screen this whole issue is about.
 */

import type { AthleteId, AthleteRecord, UnitSystem } from '@onyourleft/store';

export interface UnitsStore {
  /**
   * @returns the written row, or `undefined` when there is no such athlete.
   *
   * ⚠️ **`undefined` means nothing was written, and it does not throw.** Every
   * caller must branch on it: discarding the return turns "nothing happened"
   * into a success message and a screen that disagrees with the disk until the
   * next reload. The same is true of `setAthleteThresholds`, which is the other
   * narrow athlete write with this shape.
   */
  setAthleteUnits(id: AthleteId, units: UnitSystem): Promise<AthleteRecord | undefined>;
}

export interface UnitsPort {
  readonly store: UnitsStore;
  /** Whose preference this is. Every write is scoped by it. */
  readonly athleteId: AthleteId;
}
