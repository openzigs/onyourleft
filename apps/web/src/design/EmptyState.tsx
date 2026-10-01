// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A screen with nothing on it yet — #943, epic #935.
 *
 * A first-run rider sees these more than any other screen, and in a game they
 * are the "no save file yet" screen, so each one is the same four things in
 * the same order: a drawing, a heading, the sentences the screen already said,
 * and **one** thing to do.
 *
 * ## The rules this component is, so a view cannot get them wrong
 *
 * - **The drawing is decoration.** It comes from the illustration kit
 *   (`illustration/`), whose every part is an `aria-hidden` `<svg>` with no
 *   text in it, and its wrapper is `aria-hidden` too. It is medium-sized —
 *   about 48 px tall, the owner's ruling of 2026-10-01 on #935 — and that
 *   height is ONE custom property, `--oyl-empty-state-art-height` in
 *   `theme.css`, so the browser gate's control (`?illustration=tall`) can
 *   make it too tall and watch an action fall below the fold.
 * - **The words are the screen's own**, passed as children. Nothing here
 *   writes a sentence; `a11y/route-sentences.a11y.test.tsx` holds that none
 *   was lost on the way in (the owner's "nothing deleted").
 * - **One action**, as a `Button` or a `ButtonLink` from `Button.tsx` —
 *   primary, or `secondary` where the view already has its primary
 *   (#668's one-primary rule, `a11y/button-hierarchy.a11y.test.tsx`).
 *   `a11y/empty-states.a11y.test.tsx` requires exactly one `.oyl-button`
 *   inside every one, on every route that declares one.
 * - **Not a landmark.** A `<div>`, not a `<section>` with a name: a screen
 *   with an empty list and an empty chart would otherwise grow two unnamed
 *   regions, which the audit's `landmarks-are-distinguishable` reads.
 */

import type { JSX, ReactElement, ReactNode } from 'react';

import { expandWorkout, seconds, thresholdShare } from '@onyourleft/domain';

import { Hills, RiderSilhouette, RoadRibbon, SensorGlyph, Sky, WorkoutShape } from './illustration';

/** What an empty state draws. Each is one or more parts of the kit, layered. */
export const EMPTY_STATE_ART = ['rider', 'road', 'workout', 'trainer', 'power'] as const;

/** One of {@link EMPTY_STATE_ART}. */
export type EmptyStateArt = (typeof EMPTY_STATE_ART)[number];

/**
 * The shape the workout drawing is drawn from: a warm-up, three efforts and
 * an easy spin. ⚠️ **Not anybody's workout** — it is a picture of what a
 * workout looks like, on a screen that has none, so there is no data in it to
 * owe a sentence for (epic #935, principle 1).
 */
const PICTURE_OF_A_WORKOUT = expandWorkout({
  name: 'A workout',
  blocks: [
    { kind: 'ramp', seconds: seconds(300), from: thresholdShare(0.5), to: thresholdShare(0.75) },
    {
      kind: 'intervals',
      repeats: 3,
      hardSeconds: seconds(180),
      hardTarget: thresholdShare(1.05),
      easySeconds: seconds(120),
      easyTarget: thresholdShare(0.55),
    },
    { kind: 'steady', seconds: seconds(300), target: thresholdShare(0.5) },
  ],
});

/** The class each layer of a drawing fills its box with. */
const LAYER = 'oyl-empty-state__layer';

function drawing(art: EmptyStateArt, seed: number): JSX.Element {
  switch (art) {
    case 'rider':
      return <RiderSilhouette className={LAYER} />;
    case 'road':
      return (
        <>
          <Sky className={LAYER} clouds={false} />
          <Hills className={LAYER} seed={seed} />
          <RoadRibbon className={LAYER} />
        </>
      );
    case 'workout':
      return <WorkoutShape className={LAYER} workout={PICTURE_OF_A_WORKOUT} />;
    case 'trainer':
      return <SensorGlyph className={LAYER} kind="trainer" />;
    case 'power':
      return <SensorGlyph className={LAYER} kind="power" />;
  }
}

export interface EmptyStateProps {
  /** Which drawing — {@link EMPTY_STATE_ART}. */
  readonly art: EmptyStateArt;
  /** For a landscape: which hills, so two screens do not look stamped. */
  readonly seed?: number;
  /** What the heading says. */
  readonly heading: string;
  /** Its level, one below the heading of whatever holds it. */
  readonly level: 2 | 3 | 4;
  /** The id of the heading, where something else points at it. */
  readonly headingId?: string;
  /** The sentences the screen already said about being empty. */
  readonly children: ReactNode;
  /** The ONE thing to do: a `Button` or a `ButtonLink`. */
  readonly action: ReactElement;
  /**
   * Words that belong beside the action, in its own line — the game picker's
   * "— a course from a route planner, read on this device." — so a sentence
   * that ran on from its button is not split from it.
   */
  readonly note?: ReactNode;
}

/** The empty state. The rules are in this file's header. */
export function EmptyState({
  art,
  seed = 0,
  heading,
  level,
  headingId,
  children,
  action,
  note,
}: EmptyStateProps): JSX.Element {
  const Heading = `h${String(level)}` as 'h2' | 'h3' | 'h4';
  return (
    <div className="oyl-empty-state" data-oyl-empty-state={art}>
      <div className="oyl-empty-state__art" aria-hidden="true">
        {drawing(art, seed)}
      </div>
      <Heading className="oyl-empty-state__heading" id={headingId}>
        {heading}
      </Heading>
      {children}
      <p className="oyl-empty-state__action">
        {action}
        {note === undefined ? null : <> {note}</>}
      </p>
    </div>
  );
}
