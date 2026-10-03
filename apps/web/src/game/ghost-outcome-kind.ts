// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The three ways a race against the rider's own best can end — #259's type,
 * on its own since #1042.
 *
 * ⚠️ **A leaf, and that is its whole reason to be a file.** `ghost-outcome.ts`
 * decides the answer and needs `scene.ts` and `simulation.ts` to do it; the
 * ride controller only CARRIES a decided answer to the result card, and naming
 * the type from there tripled the modules `ride/controller.ts` reaches (33 to
 * 99), which `ride-analysis/runner-safety.test.ts` walks five times and timed
 * out on under coverage on the CI runner.
 */

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
