// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Every word about a workout carried across a trainer that dropped and came
 * back — #2669, the owner's ruling of 2026-11-16 ("Trainer reconnect workout
 * should carry on"). Only the Android shell gets a trainer back by itself,
 * so a browser never shows any of them (`ride/controller.ts`
 * §`RideWorkoutSnapshot.carryOn`).
 *
 * ⚠️ Trainer-control text: each sentence says what the trainer is being told,
 * or that it is being told nothing, and never more than is true. `resumed` is
 * the owner's own words.
 */

import type { WorkoutCarryOn } from '../ride/controller';

const SENTENCES: Readonly<Record<WorkoutCarryOn, string>> = {
  reconnecting:
    'Trainer disconnected. Reconnecting… The workout is paused where it was, and nothing is sent to the trainer.',
  pedal:
    'Trainer reconnected. Start pedalling and the workout carries on, easing back up to its target.',
  refused:
    'Trainer reconnected, but it would not give control back. Take control, then pedal, to carry on, or end the workout.',
  resumed: 'Trainer reconnected, workout resumed.',
};

/** The sentence for where the carry-on stands. */
export function carryOnSentence(carryOn: WorkoutCarryOn): string {
  return SENTENCES[carryOn];
}
