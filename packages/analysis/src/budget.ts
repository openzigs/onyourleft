// SPDX-License-Identifier: Apache-2.0

/**
 * **How long a write-up may take** — what is left of `runner.ts` (#811) since
 * [#1103](https://github.com/openzigs/onyourleft/issues/1103) removed the
 * device's own run (ADR 0046 D-1). The instance's agent takes its time budget
 * from here (`apps/instance` §`analysis/agent.ts` §`AGENT_RUN_MILLISECONDS`,
 * ADR 0046 D-7: *"the runner's ten minutes"*).
 */

/**
 * The longest a whole run may take: ten minutes.
 *
 * Version 1's steps at their deadlines came to 13 minutes with no retry (eight
 * sections and a position at 60 s, a summary and a rewrite at 120 s), and 22
 * with every JSON step asked twice. A model that slow is not one a rider waits
 * for at the end of a ride, and one that does a section in 30 s — a slow model
 * on a laptop's processor — finishes the whole chain in about seven. So a run
 * is given up on at ten, and nothing partial is kept.
 */
export const RUN_BUDGET_MILLISECONDS = 10 * 60_000;
