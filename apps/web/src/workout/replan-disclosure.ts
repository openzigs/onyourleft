// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Every sentence a rider reads before switching on re-plans during a ride**
 * — [#1245](https://github.com/openzigs/onyourleft/issues/1245), ADR 0048
 * D-10, D-11 and D-12.
 *
 * One module, so the owner can approve the wording by reading one file, and so
 * the switch on the Ride screen and `docs/privacy-policy.md` cannot say two
 * things (`replan-disclosure.test.ts` holds them together, word for word).
 *
 * ⚠️ **DRAFT wording, awaiting the owner's approval**, which the pull request
 * that ships it quotes. The switch is
 * [#1244](https://github.com/openzigs/onyourleft/issues/1244)'s, on the Ride
 * screen's workout panel, and shows these sentences beside the switch — a
 * disclosure, so never behind a disclosure widget.
 *
 * ## It describes what #1244 builds, and nothing it does not
 *
 * - **Only the instance's own model is asked** (`instance-local`). ADR 0048
 *   D-11 allows a hosted re-plan on the rider's own key, and the instance
 *   (#1243) can run one, but the device builds no request for it. So there is
 *   **no hosted form of this disclosure here**: one was drafted and removed
 *   with #1245's review, unapproved and never rendered. A hosted re-plan needs
 *   its own wording, approved, and the owner's answer on whether the hosted
 *   consent must name re-plans, before any switch can ask for one.
 * - **The goal's time-in-range target is withheld** (spike 0022's rule R1,
 *   the owner's conservative default), and the text says so.
 * - **A request leaves as a block begins, and at least 3 minutes after the
 *   last** (`@onyourleft/domain` §`REPLAN_MOVE_INTERVAL_SECONDS`).
 * - **The device sends no effort check-in**: the instance has a key for one
 *   (`BLOCK_SUMMARY_KEYS` §`effort`) and the device does not write it, so the
 *   text does not claim it. `replan-disclosure.test.ts` §`NOT_SENT` names it.
 * - **The record of each decision (P9) is kept with the ride**, in the
 *   export, and synced with the ride
 *   ([#1315](https://github.com/openzigs/onyourleft/issues/1315), ADR 0048
 *   D-10) — that sentence is for the owner's approval.
 * - **A long workout's request holds only the most recent summaries that
 *   fit** the instance's 8 KB input budget, and the text says so.
 *
 * Since #1244 merged this file in, each of those is held to #1244's own code
 * by a test, not only pinned as a sentence: `replan-disclosure.test.ts`
 * §"what the text says of this device, held to its code".
 *
 * ## The rulings the wording is bound by (#1233, 2026-10-09)
 *
 * - **Q8**: per-block summaries only, sealed; accepted and refused moves kept
 *   with the ride. Never a 1 Hz stream, a position or a date.
 * - **Q2 and Q7**: a model picks one move from a closed list, for blocks not
 *   yet ridden; the device checks it and computes every watt; it is applied at
 *   the next block boundary, with one *Keep the plan* control; off unless
 *   switched on for the ride.
 * - **Q5**: the instance's own model. (Q5 also allows a hosted model on the
 *   rider's own key; nothing here asks for one — see above.)
 * - **Q10**: the name is *re-plan during the ride*.
 * - **Q12**: none of D-12's banned words (`privacy/no-medical-wording.ts`
 *   scans this file with the rest), no heart-rate number called a limit, and
 *   no claim to prevent, treat or reduce the risk of anything.
 *
 * ## What each sentence is held to
 *
 * What a summary carries is `apps/instance` §`analysis/replan-input.ts`
 * (`BLOCK_SUMMARY_KEYS`, `REPLAN_INPUT_KEYS`); what the model may look up is
 * §`analysis/tools/replan-tools.ts` (`ride_so_far`, `goals`, `saved_workouts`,
 * and no earlier ride); how long a request is kept is §`analysis/jobs.ts`
 * (`DEFAULT_RETENTION_MS`, 7 days). A change to any of those is a change here
 * and in the policy.
 *
 * It names no vendor and no model (ADR 0031 D-4).
 */

/** The switch's label: the owner's name for the feature (Q10). */
export const REPLAN_SWITCH_LABEL = 'Re-plan during the ride';

/** The one ride-time control that reverts a change before its block (Q7), named in the text. */
export const REPLAN_KEEP_BUTTON = 'Keep the plan';

/**
 * The sentence the policy carries about the hold on its own, because riders
 * will ask (#1245): the hold needs no instance and sends nothing.
 */
export const HOLD_SENDS_NOTHING =
  'A heart-rate hold on its own sends nothing anywhere: it runs on this device.';

/** The disclosure, as the Ride screen shows it beside the switch. */
export interface ReplanDisclosure {
  readonly headline: string;
  /** What is sent and when, what never is, who answers, who decides, and what is kept. */
  readonly paragraphs: readonly string[];
  readonly notNeeded: string;
  /** True only while the switch is off: the screen says something else once it is on. */
  readonly offUntilOn: string;
}

/**
 * When a request leaves, and what one block's summary carries: `BLOCK_SUMMARY_KEYS`, less `effort`.
 *
 * Its last sentence is #1244's: a request is held to the instance's 8 KB
 * input budget by leaving out the oldest summaries (`replan-job.ts`
 * §`replanInputWithin`), so "each block you have ridden so far" is not the
 * whole truth of a long workout, and the text says so.
 */
const WHAT_IS_SENT =
  'While it is on, as each block of the workout begins, and never more often than every 3 ' +
  'minutes, this device sends your instance a summary of each block you have ridden so far: ' +
  'how long the block lasted, your mean and highest heart rate, how long your heart rate was ' +
  'inside the range you chose, your mean power as a share of your threshold power, your mean ' +
  'cadence, and how many times the target had to be eased. In a long workout with more blocks ' +
  'than fit in one request, only the most recent are sent.';

/** The plan's blocks, key by key (`replan-input.ts` §`BLOCK_FIGURES` and a hold's `range`). */
const THE_BLOCKS =
  'With it go the blocks of the workout as it stands and which one you are riding: the kind of ' +
  'each block, how long it lasts, how many times an interval repeats, its power targets as ' +
  'shares of your threshold power and, for a heart-rate hold, the range you chose in beats per ' +
  'minute.';

/** The typed goals, field by field (`@onyourleft/domain` §`WorkoutGoals`), and the one withheld. */
const THE_GOALS =
  'So do your workout goals: the kind of session, its length, the heart-rate range you chose ' +
  'and the heart rate you chose not to go above, both in beats per minute, the most power as a ' +
  'share of your threshold power, and whether you want to be asked how hard it feels. The time ' +
  'you want to spend in your range is not sent.';

const WHAT_IS_NEVER_SENT =
  'It never sends a second-by-second recording, where you are, the date, your name, the ' +
  "workout's name, the labels of its blocks or a number of watts. It is sealed on this device " +
  'so that only your instance can open it.';

/** Who answers, what the model may look up (`replan-tools.ts`), and that it goes no further. */
const WHO_IS_ASKED =
  'Your instance asks a model on its own machine or its own private network whether to suggest one change to the blocks ' +
  'you have not ridden yet. The model may look up what you wrote about your goals and the ' +
  'blocks of your saved workouts, if you synced them. It answers with one change from a fixed ' +
  'list, or none: never with words, and never with a number of watts. None of it is sent on to ' +
  "a hosted service: this app asks only for the model on your instance's own machine or its own private network, " +
  'whatever key you stored there.';

/**
 * Its last sentence is #1244's (its third review): there is a control that
 * switches re-plans off while a workout runs (`replan-text.ts`
 * §`REPLAN_OFF_BUTTON`), and a rider is told so before switching them on.
 * `ride/controller.test.ts` §"switching re-plans off while the workout runs"
 * counts the calls that leave after it: none.
 */
const WHO_DECIDES =
  `This device checks every suggestion against your workout goals and the workout you loaded, ` +
  'and works out every target itself. A change it accepts starts at the next block, never in ' +
  `the one you are riding, and you can press '${REPLAN_KEEP_BUTTON}' before then. You can ` +
  'switch re-plans off while the workout runs, and nothing more is sent for that workout.';

const WHAT_IS_KEPT =
  'Your instance keeps each request and its answer for 7 days. This device keeps each change it ' +
  'accepted or refused with the ride, and puts them in your account export. When you sync, ' +
  'they go with the ride to your instance, sealed, and to your other devices that sync with it.';

const NOT_NEEDED =
  'You do not need this. The workout and a heart-rate hold work without it, and without an ' +
  'instance.';

const OFF_UNTIL_ON =
  'This is off. It is off at the start of every ride, and stays off until you switch it on ' +
  'for that ride.';

/**
 * The disclosure beside the switch. There is one: the rider's instance asks
 * its own model, which is the only re-plan the device can ask for.
 */
export function replanDisclosure(): ReplanDisclosure {
  return {
    headline: 'This sends a summary of each block you ride to your instance, during the ride.',
    paragraphs: [
      WHAT_IS_SENT,
      `${THE_BLOCKS} ${THE_GOALS}`,
      WHAT_IS_NEVER_SENT,
      WHO_IS_ASKED,
      WHO_DECIDES,
      WHAT_IS_KEPT,
    ],
    notNeeded: NOT_NEEDED,
    offUntilOn: OFF_UNTIL_ON,
  };
}

/** Every sentence of the disclosure, in the order the screen shows them. */
export function replanDisclosureSentences(disclosure: ReplanDisclosure): readonly string[] {
  return [
    disclosure.headline,
    ...disclosure.paragraphs,
    disclosure.notNeeded,
    disclosure.offUntilOn,
  ];
}
