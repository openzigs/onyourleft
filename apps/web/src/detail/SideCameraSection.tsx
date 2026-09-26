// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The "Side camera" section of a ride's own page** —
 * [#388](https://github.com/openzigs/onyourleft/issues/388), the owner's
 * ruling of 2026-09-26: *"a Side camera section on that ride's own detail page,
 * shown only for a ride with a side-camera session. No new route."*
 *
 * ## What it renders, and only that
 *
 * The saved report's sentences, and only those `camera/side-report-wording.ts`
 * can produce ({@link isReportSentence}, {@link isReportSummary}). A stored row
 * outlives the wording it was written in, and a hand-edited row is a row; a
 * sentence the vocabulary file does not hold is **not shown**, and
 * {@link SIDE_REPORT_WITHHELD} says that something was not. So "every string
 * this report renders comes from the one vocabulary file" (ADR 0030 D-8) is a
 * property of the page, not only of the code that wrote the row.
 *
 * ## Four states, and the two that must not look alike
 *
 * - **No report** — the ordinary ride. Nothing is rendered at all.
 * - **Observations** — the summary, then a list, one sentence per item.
 * - **Nothing to show** — a report with no observation: {@link
 *   SIDE_REPORT_NOTHING_TO_SHOW}, then the summary saying why. ⚠️ **This and
 *   the one above must not look the same** — `CreditsView.test.tsx`'s lesson:
 *   an empty page and a correct page are indistinguishable unless something
 *   says which it is. `SideCameraSection.test.tsx` holds them apart.
 * - **Unreadable** — a row that would not decode, said in words.
 *
 * ## What it does not contain, on purpose
 *
 * No control of any kind — no button, no link, no input. A report is read; it
 * does not act (ADR 0030 R7), and nothing on this path reaches a trainer
 * (`camera/side-report-safety.test.ts`). No picture, no number, and no colour
 * that carries meaning: every state is words.
 */

import type { JSX } from 'react';

import { StatusMessage } from '../design/StatusMessage';
import {
  isReportSentence,
  isReportSummary,
  SIDE_REPORT_NOTHING_TO_SHOW,
  SIDE_REPORT_UNREADABLE_ROW,
  SIDE_REPORT_WITHHELD,
} from '../camera/side-report-wording';

import type { SideCameraOverview } from './load';

/** The section's heading, and the id its content is labelled by. */
export const SIDE_CAMERA_HEADING = 'Side camera';
const HEADING_ID = 'oyl-side-camera-heading';

export function SideCameraSection({
  sideCamera,
}: {
  readonly sideCamera: SideCameraOverview;
}): JSX.Element | null {
  if (sideCamera.kind === 'none') {
    return null;
  }
  if (sideCamera.kind === 'unreadable') {
    return (
      <div className="oyl-side-report" aria-labelledby={HEADING_ID} role="group">
        <h3 id={HEADING_ID}>{SIDE_CAMERA_HEADING}</h3>
        <StatusMessage tone="warning">{SIDE_REPORT_UNREADABLE_ROW}</StatusMessage>
      </div>
    );
  }
  const { report } = sideCamera;
  const summary = isReportSummary(report.summary) ? report.summary : undefined;
  const shown = report.observations.filter(isReportSentence);
  const withheld = summary === undefined || shown.length !== report.observations.length;
  return (
    <div className="oyl-side-report" aria-labelledby={HEADING_ID} role="group">
      <h3 id={HEADING_ID}>{SIDE_CAMERA_HEADING}</h3>
      {shown.length === 0 ? (
        <>
          <p className="oyl-side-report__empty">
            <strong>{SIDE_REPORT_NOTHING_TO_SHOW}</strong>
          </p>
          {summary === undefined ? undefined : <p className="oyl-muted">{summary}</p>}
        </>
      ) : (
        <>
          {summary === undefined ? undefined : <p>{summary}</p>}
          <ul className="oyl-side-report__observations">
            {shown.map((sentence) => (
              <li key={sentence}>{sentence}</li>
            ))}
          </ul>
        </>
      )}
      {withheld ? <p className="oyl-muted">{SIDE_REPORT_WITHHELD}</p> : undefined}
    </div>
  );
}
