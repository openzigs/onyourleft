// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What one side-camera session came to as NUMBERS — the shape
 * [#801](https://github.com/openzigs/onyourleft/issues/801) produces and the
 * ride-analysis input (#809) reads.
 *
 * Declared here, beside `side-report.ts`, because that is where #801 computes
 * it: from the same pass and the same statistics as the report's sentences,
 * so the two cannot disagree. Nothing produces one yet; until #801 lands the
 * ride-analysis input is built without a pose half.
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
  readonly source: SidePoseSource;
  /** How many plausible poses the comparison read, across both thirds. */
  readonly posesCompared: number;
  /** Late third minus early third, per kind that was compared. */
  readonly differences: Readonly<Partial<Record<SideObservationKind, number>>>;
}
