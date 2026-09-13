// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * How the race against your own previous best ended — #259.
 *
 * ## Why this exists at all
 *
 * `scene.ts` §`ghostFinished` was exported, unit-tested, green and **computed
 * by nobody**: after the ghost crossed the line the HUD went on quoting a gap
 * against a rider who had stopped, so nothing on the screen told *"it is 40 s
 * up the road"* apart from *"it finished 40 s ago and you are still riding"*.
 * This module is the thing that asks the question, and `GameView` is the thing
 * that asks this module.
 *
 * ## ⚠️ Why it is latched, and why the obvious stateless version is wrong
 *
 * The tempting implementation is to read the sign of the live gap whenever the
 * ghost has finished: negative means the attempt is behind the rider, so the
 * rider beat it. **That claim is false the moment the rider keeps riding.**
 *
 * A ghost that rode 1 200 m in 60 s finishes at 60 s. A rider who has covered
 * only 900 m by then has already lost — they cannot now reach 1 200 m in under
 * 60 s of riding, because 60 s of riding has been and gone. But they carry on,
 * and somewhere past 90 s they pass 1 200 m, at which point the live gap flips
 * sign and a stateless reading would congratulate them on beating an attempt
 * they were in fact half a minute slower than. That is exactly the shape
 * `hud/fields.ts` refuses for a dropped sensor: a claim the data does not
 * support, shown to a rider who would act on it.
 *
 * And the current state genuinely cannot answer it. Once the ghost has
 * finished, "did the rider reach {@link GhostTrack.totalDistance} before
 * {@link GhostTrack.totalTime}" is a question about the past, and distance is
 * monotonic so the present tells you nothing about when a threshold was
 * crossed. Clamping the rider's distance and inverting the ghost's track
 * (`ghostElapsedAt`) does not rescue it either — it gets the slow rider right
 * and then gets the fast one wrong, because the clamp throws away precisely the
 * margin the fast rider won by.
 *
 * So the outcome is decided **once**, at the first frame that can decide it,
 * and never revisited. {@link settleGhostOutcome} is a pure function of the
 * previous answer and the current state; the one frame of memory lives in
 * `GameView`, beside the ghost it is about.
 *
 * ## What it still cannot get right, and why that is the floor
 *
 * ⚠️ A ride stalled across **both** crossings — the loop stops while the rider
 * is short of the attempt's distance and resumes once they are past it and its
 * clock has run out — presents one frame in which both became true, and there
 * is no evidence left in the state to say which happened first. It is reported
 * as `beaten`. The window is bounded by `simulation.ts`
 * §`MAXIMUM_STEPS_PER_ADVANCE`, which is ten seconds of riding, and closing it
 * outright would mean the simulation recording the rider's odometer at the
 * attempt's finishing time — a second source of truth for a number that exists
 * to settle one field. It is written down here rather than left to be
 * rediscovered.
 *
 * ⚠️ **"Stalled" is not only a backgrounded phone, and this used to say it
 * was.** `GameView`'s loop effect returns early whenever the phase is not
 * `riding`, so the **Pause** button produces exactly the same catch-up burst:
 * no frames while it is held, and one `advanceTo` covering the lot when it is
 * released. A rider pausing for a drink is the ordinary way into this window,
 * not an unusual one, which makes the ten-second bound the thing that keeps it
 * small rather than its rarity.
 *
 * ## What it is not
 *
 * It is not a result, a record or a ranking. It compares this rider to one
 * recording of this rider, which is the line `packages/domain/src/ghost/
 * replay.ts` draws at length and ADR 0007 D-2 is why. Nothing here is stored
 * and nothing here takes an athlete id.
 */

import { ghostFinished } from './scene';
import type { GameState } from './simulation';
import type { GhostTrack } from '@onyourleft/domain';

/**
 * What became of the rider's previous best, once it has finished.
 *
 * Three values rather than two, and `level` is not padding: `pacer/gap.ts`
 * §`botIsAhead` already takes the position that exactly level is neither ahead
 * nor behind, and telling a rider who dead-heated with themselves that their
 * best finished *ahead of them* would be false. It is vanishingly rare and it
 * costs one branch.
 */
export type GhostOutcome = 'beaten' | 'level' | 'not-beaten';

/**
 * The outcome so far: `settled` once it is known, `undefined` while the attempt
 * is still riding or there is no attempt.
 *
 * ⚠️ **`settled` is returned unchanged whenever it is defined**, and that is
 * the whole of this function — see the header for what a recomputation would
 * claim. A caller that passes `undefined` every frame gets a result that flips
 * under a rider who keeps riding, which is the defect this signature exists to
 * make impossible to write by accident.
 */
export function settleGhostOutcome(
  settled: GhostOutcome | undefined,
  ghost: GhostTrack | undefined,
  state: GameState,
): GhostOutcome | undefined {
  if (settled !== undefined) {
    return settled;
  }
  if (ghost === undefined) {
    return undefined;
  }
  // One question asked of both sides: has each of them covered the distance the
  // attempt covered? The rider's odometer against the attempt's total is the
  // only comparison that is true at every instant, because both are odometers
  // on the same road from the same start.
  const reached: boolean = state.ride.distance >= ghost.totalDistance;
  if (!ghostFinished(ghost, state)) {
    // ⚠️ **Settled here, while the attempt is still riding, and that is the
    // exact moment of the win rather than an approximation of it.**
    //
    // This is deliberately WIDER than #259's first criterion, which asks only
    // about the case where *"the ghost has finished and the rider has not"*. A
    // rider who gets there first has won at the instant they get there, and the
    // criterion's case is the one that needed fixing rather than the whole of
    // the question. Narrowing it to match would mean waiting for the attempt's
    // clock to run out before congratulating somebody who is already past the
    // line — visibly late on a fast win, and up to ten seconds late after a
    // pause.
    //
    // The rider
    // has covered the attempt's whole distance and the attempt's clock has not
    // run out, so they got there first — by however much of it is left. Waiting
    // for the attempt to finish before saying so would decide the same question
    // one frame later at best, and after a backgrounded phone up to ten seconds
    // of riding later (`simulation.ts` §`MAXIMUM_STEPS_PER_ADVANCE`), which is
    // ten seconds of road credited to a rider who may not have earned it.
    return reached ? 'beaten' : undefined;
  }
  if (!reached) {
    // Exact in every case, stalls included: distance only ever increases, so a
    // rider short of the attempt's total *now* was short of it at the moment
    // the attempt finished too.
    return 'not-beaten';
  }
  // Both crossed within the same frame. At a real frame rate that is a dead
  // heat to the millimetre, and `pacer/gap.ts` §`botIsAhead` is why exactly
  // level gets its own answer rather than being rounded into one of the others.
  return state.ride.distance === ghost.totalDistance ? 'level' : 'beaten';
}
