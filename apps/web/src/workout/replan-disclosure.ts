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
 * that ships it quotes. **Nothing renders it yet**: the switch is
 * [#1244](https://github.com/openzigs/onyourleft/issues/1244)'s, which is
 * blocked on this wording and shows these sentences beside the switch — a
 * disclosure, so never behind a disclosure widget.
 *
 * ## The rulings the wording is bound by (#1233, 2026-10-09)
 *
 * - **Q8**: per-block summaries only, sealed; accepted and refused moves kept
 *   with the ride. Never a 1 Hz stream, a position or a date.
 * - **Q2 and Q7**: a model picks one move from a closed list, for blocks not
 *   yet ridden; the device checks it and computes every watt; it is applied at
 *   the next block boundary, with one *Keep the plan* control; off unless
 *   switched on for the ride.
 * - **Q5**: the instance's own model, or a hosted model **only on the rider's
 *   own key**, under their recorded consent naming the endpoint, masked. The
 *   operator's key is never used.
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
 * It names no vendor and no model (ADR 0031 D-4): a hosted service is named by
 * the address the rider agreed to.
 */

import { MASKING_LIMIT } from '../camera/hosted-model';

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

/** Which model the rider's instance would ask: its own, or a hosted service on the rider's key. */
export type ReplanDisclosureSource =
  | { readonly source: 'instance-local' }
  /** `endpoint` is the origin the rider's hosted consent names, for example `https://api.example.com`. */
  | { readonly source: 'instance-hosted'; readonly endpoint: string };

/** The disclosure, as the Ride screen shows it beside the switch. */
export interface ReplanDisclosure {
  readonly headline: string;
  /** What is sent and when, what never is, who answers, who decides, and what is kept. */
  readonly paragraphs: readonly string[];
  readonly notNeeded: string;
  /** True only while the switch is off: the screen says something else once it is on. */
  readonly offUntilOn: string;
}

/** What is sent, and when. The list is `BLOCK_SUMMARY_KEYS`, in a rider's words. */
const WHAT_IS_SENT =
  'While it is on, this device sends your instance a summary of each block you have ridden, at ' +
  'the end of a block, or every few minutes in a long one: how long the block lasted, your mean ' +
  'and highest heart rate, how long your heart rate was inside the range you chose, your mean ' +
  'power as a share of your threshold power, your mean cadence, how many times the target had ' +
  'to be eased, and your effort check-in if you gave one. With it go the blocks of the workout ' +
  'as it stands and your workout goals.';

const WHAT_IS_NEVER_SENT =
  'It never sends a second-by-second recording, where you are, the date, your name or the ' +
  "workout's name. It is sealed on this device so that only your instance can open it.";

const WHO_DECIDES =
  `This device checks every suggestion against your workout goals and the workout you loaded, ` +
  'and works out every target itself. A change it accepts starts at the next block, never in ' +
  `the one you are riding, and you can press '${REPLAN_KEEP_BUTTON}' before then.`;

const WHAT_IS_KEPT =
  'Your instance keeps each request and its answer for 7 days. This device keeps each change it ' +
  'accepted or refused with the ride, and they go to your instance with the ride if you sync it.';

/** What the model may look up, the same on either source (`replan-tools.ts`). */
const LOOKED_UP =
  'what you wrote about your goals and the blocks of your saved workouts, if you synced them';

const ANSWERS_WITH =
  'It answers with one change from a fixed list, or none: never with words, and never with a ' +
  'number of watts.';

/**
 * The disclosure for the model the rider's instance would ask. The hosted one
 * says everything the other does, and then who else is sent it.
 */
export function replanDisclosure(source: ReplanDisclosureSource): ReplanDisclosure {
  const notNeeded =
    'You do not need this. The workout and a heart-rate hold work without it, and without an ' +
    'instance.';
  const offUntilOn =
    'This is off. It is off at the start of every ride, and stays off until you switch it on ' +
    'for that ride.';
  if (source.source === 'instance-local') {
    return {
      headline: 'This sends a summary of each block you ride to your instance, during the ride.',
      paragraphs: [
        WHAT_IS_SENT,
        WHAT_IS_NEVER_SENT,
        'Your instance asks a model on its own machine whether to suggest one change to the ' +
          `blocks you have not ridden yet. The model may look up ${LOOKED_UP}. ${ANSWERS_WITH}`,
        WHO_DECIDES,
        WHAT_IS_KEPT,
      ],
      notNeeded,
      offUntilOn,
    };
  }
  const { endpoint } = source;
  return {
    headline:
      'This sends a summary of each block you ride to your instance, during the ride, and from ' +
      `there to ${endpoint}.`,
    paragraphs: [
      WHAT_IS_SENT,
      WHAT_IS_NEVER_SENT,
      `Your instance asks the service at ${endpoint}, on your own key, whether to suggest one ` +
        'change to the blocks you have not ridden yet. It sends that service the summaries, the ' +
        `blocks and your workout goals, and the model may look up ${LOOKED_UP}, and be sent ` +
        `them. ${ANSWERS_WITH}`,
      'That is a company or a computer that is not yours and not ours, and we cannot see what ' +
        'they do with it or how long they keep it. We cannot delete it for you afterwards. It ' +
        "sees your instance's internet address, not this device's. It is sent there only " +
        'because you stored your own key for that service on your instance and agreed to it by ' +
        'its address.',
      'The numbers carry no name, no place and no date. But what you wrote yourself can say ' +
        'anything. Before anything is sent, your instance masks it as it does for a ride ' +
        `analysis. ${MASKING_LIMIT}`,
      WHO_DECIDES,
      WHAT_IS_KEPT,
    ],
    notNeeded,
    offUntilOn,
  };
}

/** Every sentence of one disclosure, in the order the screen shows them. */
export function replanDisclosureSentences(disclosure: ReplanDisclosure): readonly string[] {
  return [
    disclosure.headline,
    ...disclosure.paragraphs,
    disclosure.notNeeded,
    disclosure.offUntilOn,
  ];
}
