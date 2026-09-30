// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What one side-camera session came to as NUMBERS — the shape
 * [#801](https://github.com/openzigs/onyourleft/issues/801) produces, the
 * keeper saves with the ride (`side-report-keeper.ts`, as
 * `packages/store` §`SideSessionSummaryRecord`) and the ride-analysis input
 * (#809) reads.
 *
 * Declared here, beside `side-report.ts`, because that is where it is
 * computed: `side-report.ts` §`sideSessionFrom`, from the same pass and the
 * same statistics as the report's sentences, so the two cannot disagree.
 *
 * ⚠️ **Only from plausible poses** (#761, ADR 0035 D-6). A pose from the
 * rider's computer that fails `pose-plausibility.ts` is counted as `noRider`
 * and never reaches the statistics, so a session of pictures of nobody comes
 * to no summary at all.
 *
 * ⚠️ **Its shape is the stored record's**, field for field: the counts are
 * the session's `posed`, `noRider` and `unreadable` pictures (ADR 0035 D-6's
 * *"the counts behind them"*). It carried a `posesCompared` until #801, which
 * nothing could keep, so a summary read back from the store could not have
 * been handed to the input it was declared for.
 *
 * ## What it deliberately cannot carry
 *
 * - **No absolute angle** (ADR 0030 D-3). Each figure is a DIFFERENCE, late
 *   third minus early third, in the kind's own unit — degrees for `torso`,
 *   `knee` and `elbow`, a share of a body segment for `head` and `saddle`,
 *   exactly as `side-report.ts` §`OBSERVATION_THRESHOLDS` states them.
 * - **No time in the ride** (ADR 0033 D-3, and #796's first answer): there is
 *   no offset, no timestamp and no per-section figure. Position is analysed
 *   over the whole session only.
 * - **No picture and nothing made from one** beyond these differences
 *   (ADR 0029).
 *
 * A kind that was not compared — too few usable poses in a third — is ABSENT
 * from {@link SideSessionSummary.differences}, never zero: a zero tells a model
 * "nothing changed" about something nobody compared.
 */

import type { SideObservationKind } from './side-report-wording';

/** Where the session's poses were estimated: on the tablet, or on the rider's own computer. */
export type SidePoseSource = 'tablet' | 'computer';

/** The pose sources, in a fixed order, so a copy can refuse anything else. */
export const SIDE_POSE_SOURCES: readonly SidePoseSource[] = ['tablet', 'computer'];

/** One session's pose summary. Whole-session only. @see the file comment. */
export interface SideSessionSummary {
  /** Where the poses were estimated. Recorded, and never said in the report (#761's decision, ADR 0033 §Amendments 2026-09-28). */
  readonly source: SidePoseSource;
  /** Late third minus early third, per kind that was compared. */
  readonly differences: Readonly<Partial<Record<SideObservationKind, number>>>;
  /** Pictures in which a plausible rider was posed. */
  readonly posed: number;
  /** Pictures with nobody in them — including every pose #761's check turned away. */
  readonly noRider: number;
  /** Pictures the model could not read. */
  readonly unreadable: number;
}
