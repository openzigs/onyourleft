// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The rider's own threshold power, as the HUD's zone indicator reads it —
 * #2077, from PR #2225's review.
 *
 * `main.tsx` §`buildGamePort` hands this to `GameView` as
 * `GamePort.ownThresholdPower`. It is a module of its own, rather than a line
 * inside that function, for the reason `trainer-port.ts` §`gameTrainerPortOver`
 * is: `ownThresholdPower` is an OPTIONAL member of a port declared in
 * `GameView.tsx` rather than in a `*-port.ts`, so `WIRE003` does not look at
 * it, and every #2077 test hands `GameView` a port of its own. With the read
 * written inline, deleting it left every gate green and the zone indicator
 * unwired in the shipped app (docs/agents/wiring-gate.md §Limits, the third
 * entry). Here, `own-threshold.test.ts` reads it through a real store, and
 * `main.tsx` not importing it is a red `check:wiring`.
 *
 * ⚠️ **The local athlete's row, and only theirs** — the athlete is not a
 * parameter, so no caller can hand it another rider's id.
 */

import type { Watts } from '@onyourleft/domain';
import type { ActivityStore } from '@onyourleft/store';

import { LOCAL_ATHLETE } from '../local-athlete';

/** `GamePort.ownThresholdPower` over a store: `undefined` when none is set. */
export function ownThresholdPowerFrom(
  store: Pick<ActivityStore, 'getAthlete'>,
): () => Promise<Watts | undefined> {
  return async () => (await store.getAthlete(LOCAL_ATHLETE))?.thresholdPower;
}
