// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A model's write-up on a ride's own page** —
 * [#805](https://github.com/openzigs/onyourleft/issues/805), epic #795,
 * [ADR 0035](../../../../docs/adr/0035-model-written-ride-write-ups.md).
 *
 * Below the side camera's report, and a separate thing: `SideCameraSection`
 * is unchanged and never replaced (ADR 0035 D-3). This section is on EVERY
 * ride's page, because a ride with no camera can still be written up (the
 * owner's ruling 5 on #795), and it carries #804's ask control.
 *
 * ## The states, and the pairs that must not look alike
 *
 * | State | What is rendered |
 * |---|---|
 * | no model set up, nothing saved (the fallback) | one sentence and a link to the Camera page, and nothing else — no heading, no request |
 * | a model set up, nothing saved | the ask control, what will be sent, and {@link WRITE_UP_NOT_ASKED} |
 * | running | #804's live region, Cancel, and the ask controls `aria-disabled` |
 * | written | the framing (ADR 0035 D-9 A), then the text, then where it was asked, whether the pose summary went, and which sections were left out |
 * | withheld by the screen | the ask's own sentence, or — for a saved row — {@link WRITE_UP_WITHHELD_SAVED}. No model text |
 * | failed or cancelled | the ask's sentence, ABOVE any earlier write-up, which says it is the earlier one (the owner's ruling of 2026-09-29) |
 * | a row this build cannot read | {@link WRITE_UP_UNREADABLE} |
 *
 * Each pair a rider could confuse — nothing asked and written, withheld and
 * failed, written and an earlier one after a failure — renders different
 * words, and `RideWriteUpSection.test.tsx` holds them apart the way
 * `CreditsView.test.tsx` holds an empty page apart from a correct one.
 *
 * ## Text, and only text
 *
 * The write-up reaches the DOM as ONE React text child of a `<blockquote>`,
 * after `write-up.ts` §`shownWriteUp` has screened it again. React escapes it,
 * so `<b>`, markdown, a `javascript:` string and a URL are characters on the
 * screen and nothing else; there is no `dangerouslySetInnerHTML`, no link and
 * no element built from it (ADR 0029 D-8). `white-space: pre-wrap` keeps its
 * paragraphs, and `overflow-wrap: anywhere` keeps an unbreakable string from
 * scrolling a phone sideways (`theme.css` §`.oyl-write-up__text`).
 */

import { useState, type JSX } from 'react';

import type { ActivityId } from '@onyourleft/store';

import type {
  AskOutcome,
  RideAnalysisPort,
  RideWriteUpSource,
} from '../ride-analysis/ride-analysis-port';
import { RideWriteUpControl, WRITE_UP_HEADING } from '../ride-analysis/RideWriteUpControl';
import { hrefFor, routeById } from '../shell/routes';

import type { WriteUpOverview } from './load';
import {
  missingSectionsText,
  shownWriteUp,
  WRITE_UP_EARLIER,
  WRITE_UP_FRAMING_LEAD,
  WRITE_UP_FRAMING_REST,
  WRITE_UP_NOT_ASKED,
  WRITE_UP_POSE_TEXT,
  WRITE_UP_SET_UP_AFTER,
  WRITE_UP_SET_UP_BEFORE,
  WRITE_UP_SET_UP_LINK,
  WRITE_UP_SOURCE_TEXT,
  WRITE_UP_UNREADABLE,
  WRITE_UP_WITHHELD_SAVED,
} from './write-up';

const HEADING_ID = 'oyl-write-up-heading';

export interface RideWriteUpSectionProps {
  /** The post-ride ask (#804), or `undefined` for none — the fallback. */
  readonly port?: RideAnalysisPort | undefined;
  readonly activityId: ActivityId;
  /** What the page read with the ride. */
  readonly initial: WriteUpOverview;
  /** Read the saved write-up again, after an ask saved a new one. Never throws. */
  readonly reread: () => Promise<WriteUpOverview>;
}

/** The fallback's one sentence, with its link. */
function SetUp(): JSX.Element {
  return (
    <p className="oyl-muted">
      {WRITE_UP_SET_UP_BEFORE} <a href={hrefFor(routeById('camera'))}>{WRITE_UP_SET_UP_LINK}</a>{' '}
      {WRITE_UP_SET_UP_AFTER}
    </p>
  );
}

/** A saved write-up, screened again, or the sentence that stands in for it. */
function Saved({
  saved,
  earlier,
}: {
  readonly saved: WriteUpOverview;
  readonly earlier: boolean;
}): JSX.Element | null {
  if (saved.kind === 'none') {
    return null;
  }
  if (saved.kind === 'unreadable') {
    return <p className="oyl-write-up__state">{WRITE_UP_UNREADABLE}</p>;
  }
  const shown = shownWriteUp(saved.record);
  if (shown.kind === 'withheld') {
    return <p className="oyl-write-up__state">{WRITE_UP_WITHHELD_SAVED}</p>;
  }
  const missing = missingSectionsText(shown.missingSections);
  return (
    <div className="oyl-write-up">
      {earlier ? <p className="oyl-write-up__state">{WRITE_UP_EARLIER}</p> : undefined}
      <p>
        <strong>{WRITE_UP_FRAMING_LEAD}</strong> {WRITE_UP_FRAMING_REST}
      </p>
      <blockquote className="oyl-write-up__text">{shown.text}</blockquote>
      <p className="oyl-muted">
        {WRITE_UP_SOURCE_TEXT[shown.source]}{' '}
        {WRITE_UP_POSE_TEXT[shown.includedPose ? 'included' : 'left-out']}
      </p>
      {missing === undefined ? undefined : <p className="oyl-muted">{missing}</p>}
    </div>
  );
}

export function RideWriteUpSection({
  port,
  activityId,
  initial,
  reread,
}: RideWriteUpSectionProps): JSX.Element {
  // Read when the page opens: it asks only whether a port COULD be built, and
  // sends nothing.
  const [sources] = useState<readonly RideWriteUpSource[]>(() => port?.availableSources() ?? []);
  const [saved, setSaved] = useState<WriteUpOverview>(initial);
  const [last, setLast] = useState<AskOutcome | undefined>(undefined);

  const ended = (outcome: AskOutcome): void => {
    setLast(outcome);
    if (outcome.kind === 'written') {
      void reread().then(setSaved);
    }
  };

  if (sources.length === 0 && saved.kind === 'none') {
    // The fallback: today's page and one sentence. No heading, no request.
    return <SetUp />;
  }

  return (
    <section aria-labelledby={HEADING_ID} className="oyl-write-up-section">
      <h3 id={HEADING_ID}>{WRITE_UP_HEADING}</h3>
      {port === undefined || sources.length === 0 ? (
        <SetUp />
      ) : (
        <RideWriteUpControl port={port} activityId={activityId} sources={sources} onEnded={ended} />
      )}
      {saved.kind === 'none' && last === undefined ? (
        <p className="oyl-write-up__state">{WRITE_UP_NOT_ASKED}</p>
      ) : undefined}
      <Saved saved={saved} earlier={last?.kind === 'failed'} />
    </section>
  );
}
