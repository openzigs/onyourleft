// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Every sentence the side camera's post-ride report can say, in one
 * place** — [#388](https://github.com/openzigs/onyourleft/issues/388),
 * [ADR 0030](../../../../docs/adr/0030-what-the-app-may-say-about-a-body.md)
 * D-8's *"every user-visible string in the report module comes from one
 * vocabulary file, so that a new sentence is a diff in the one file a reviewer
 * reads with this table beside them"*.
 *
 * ## How to read a change to this file
 *
 * Hold ADR 0030 D-2's table beside it. Every sentence here is an
 * **observation** (D-1): past tense, about this ride, a difference between two
 * things this app observed with both sides named (R1, R2), no judgement of it
 * (R3), nothing about equipment (R4), no condition or injury in any tense
 * (R5), no clinical framing (R6), no prompt to act (R7), no score (R9), and no
 * literature range (R10). ⚠️ **And no number at all** — the owner's ruling on
 * #388: *"until #385's accuracy half gives a measured spread, the report shows
 * qualitative observations and no numbers"*. R8 (uncertainty in the same
 * sentence as a number) is met by there being no number, and every
 * observation says *possibly* in the same sentence, because the owner ruled
 * *"every observation is worded as 'possible'"*.
 *
 * ⚠️ **Sagittal only (D-4)**: the owner dropped "rocking hips" on
 * 2026-09-26 because it is side-to-side movement, which D-4 forbids as a word
 * as well as a number. `no-absolute-angles.test.ts` fails the build on the
 * frontal-plane vocabulary anywhere in the client, so a sentence reaching for
 * it here is a red build rather than a review note.
 *
 * ## Why the detail view renders only sentences this file can produce
 *
 * The report is SAVED as sentences (the owner's retention ruling), so a stored
 * row outlives the wording it was written in, and a hand-edited row is a row.
 * {@link isReportSentence} is the check the view applies before rendering
 * anything it read from the store: a sentence this file cannot produce is not
 * shown, and {@link SIDE_REPORT_WITHHELD} says so. That keeps "every rendered
 * string is from the vocabulary file" true of what the page shows, not only of
 * what the code writes.
 */

/** The five things the report may observe — the owner's list of 2026-09-26, sagittal only. */
export const SIDE_OBSERVATION_KINDS = ['torso', 'knee', 'elbow', 'head', 'saddle'] as const;

export type SideObservationKind = (typeof SIDE_OBSERVATION_KINDS)[number];

/**
 * Which way an observed change went. The meaning of each is the kind's own and
 * is fixed by {@link SIDE_OBSERVATION_SENTENCES}.
 */
export type SideChangeDirection = 'increased' | 'decreased';

/**
 * One sentence per kind and direction. "Late" is the last third of the session
 * and "early" the first third; {@link SIDE_REPORT_OBSERVED} is the sentence that
 * says so, and is rendered above every list of these.
 *
 * - `torso` increased: the angle of the line from hip to shoulder above the
 *   horizontal grew — the upper body was more upright.
 * - `knee` increased: the knee's angle at the bottom of the stroke grew — the
 *   leg was straighter there.
 * - `elbow` increased: the elbow's angle grew — the arm was straighter.
 * - `head` increased: the ear was further ahead of the shoulder.
 * - `saddle` increased: the hip was further ahead of the pedals' centre.
 */
export const SIDE_OBSERVATION_SENTENCES: Readonly<
  Record<SideObservationKind, Readonly<Record<SideChangeDirection, string>>>
> = {
  torso: {
    increased: 'Your upper body was possibly more upright late in the session than early in it.',
    decreased: 'Your upper body was possibly lower late in the session than early in it.',
  },
  knee: {
    increased:
      'Your knee was possibly straighter at the bottom of the pedal stroke late in the session than early in it.',
    decreased:
      'Your knee was possibly more bent at the bottom of the pedal stroke late in the session than early in it.',
  },
  elbow: {
    increased: 'Your elbow was possibly straighter late in the session than early in it.',
    decreased: 'Your elbow was possibly more bent late in the session than early in it.',
  },
  head: {
    increased:
      'Your head was possibly further forward of your shoulders late in the session than early in it.',
    decreased:
      'Your head was possibly further back over your shoulders late in the session than early in it.',
  },
  saddle: {
    increased:
      'You were possibly sitting further forward on the saddle late in the session than early in it.',
    decreased:
      'You were possibly sitting further back on the saddle late in the session than early in it.',
  },
};

/**
 * Rendered above a list of observations. It names both sides of every
 * comparison and the conditions (R2), and says how rough they are.
 */
export const SIDE_REPORT_OBSERVED =
  'Each of these compares the first third of this ride’s side-camera session with its last third, as the same camera saw them. They are rough estimates from one camera, which is why each one says possibly.';

/**
 * The session was compared, **all five kinds were compared**, and nothing
 * changed by as much as the report mentions. ⚠️ Not a verdict on the rider (R3): it says only that these rough
 * estimates did not differ by much.
 */
export const SIDE_REPORT_UNCHANGED =
  'Nothing changed by enough to mention between the first third of this ride’s side-camera session and its last third. This is not a judgement of your position — only that these rough, one-camera estimates did not differ by much.';

/**
 * The session was compared, nothing that COULD be compared changed by as much
 * as the report mentions, and at least one of the five kinds could not be
 * compared at all — too few pictures in one of the thirds showed the landmarks
 * it needs (#561's review). ⚠️ {@link SIDE_REPORT_UNCHANGED} would overstate
 * this case: read against ADR 0030 R2, a comparison names both sides **and the
 * conditions**, and "nothing changed" with no qualifier names a comparison of
 * everything. Checked against D-2 by hand: past tense (D-1), both sides named
 * (R1, R2), no judgement (R3), nothing about equipment (R4), no condition
 * (R5), no clinical framing (R6), no prompt (R7), no number (R8), no score
 * (R9), no range (R10), nothing across the rider (D-4).
 */
export const SIDE_REPORT_UNCHANGED_IN_PART =
  'Nothing that could be compared changed by enough to mention between the first third of this ride’s side-camera session and its last third. The camera saw too little of some parts of you to compare them at all, so this covers only the parts it could. This is not a judgement of your position — only that these rough, one-camera estimates did not differ by much.';

/** The session was too short for its thirds to be compared. */
export const SIDE_REPORT_TOO_SHORT =
  'This ride’s side-camera session was too short to compare its start with its end. A session needs about six minutes of filming with you in the picture.';

/**
 * The pictures came through and too few of them could be read. ⚠️ **Named and
 * actionable, and carrying no frame, crop, thumbnail or path** — ADR 0029 D-8,
 * and there is nothing in this module for one to come from.
 */
export const SIDE_REPORT_UNREADABLE =
  'The side camera’s pictures from this ride could not be read well enough to compare the start of the session with its end. Next time, check that your whole near side, from ear to toe, is in the picture, well lit, with nothing between you and the camera.';

/** The pose model could not be loaded on the tablet, so no picture was looked at. */
export const SIDE_REPORT_NO_MODEL =
  'The tablet could not load the side camera’s pose model during this ride, so nothing was compared.';

/** Shown on the ride's page when its saved report has no observation — the explicit empty state. */
export const SIDE_REPORT_NOTHING_TO_SHOW = 'Nothing to show from the side camera for this ride.';

/** Shown when the stored report holds a sentence this build cannot produce. */
export const SIDE_REPORT_WITHHELD =
  'Part of this ride’s side-camera report was written by a different version of the app and is not shown.';

/** Shown when the stored report could not be read at all. */
export const SIDE_REPORT_UNREADABLE_ROW =
  'This ride’s side-camera report is on this device and could not be read.';

/** The summaries a saved report may carry — one of these is always its first sentence. */
export const SIDE_REPORT_SUMMARIES: readonly string[] = [
  SIDE_REPORT_OBSERVED,
  SIDE_REPORT_UNCHANGED,
  SIDE_REPORT_UNCHANGED_IN_PART,
  SIDE_REPORT_TOO_SHORT,
  SIDE_REPORT_UNREADABLE,
  SIDE_REPORT_NO_MODEL,
];

/** Every observation sentence, in a fixed order. */
export const SIDE_OBSERVATION_VOCABULARY: readonly string[] = SIDE_OBSERVATION_KINDS.flatMap(
  (kind) => [
    SIDE_OBSERVATION_SENTENCES[kind].increased,
    SIDE_OBSERVATION_SENTENCES[kind].decreased,
  ],
);

/** Whether `sentence` is one this file can produce as a summary. */
export function isReportSummary(sentence: string): boolean {
  return SIDE_REPORT_SUMMARIES.includes(sentence);
}

/** Whether `sentence` is one this file can produce as an observation. */
export function isReportSentence(sentence: string): boolean {
  return SIDE_OBSERVATION_VOCABULARY.includes(sentence);
}
