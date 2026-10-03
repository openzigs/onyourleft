// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ride cards — *Free ride*, *Ride a route* and *Workout* — as data and one
 * card component, so Home (#939, #1010) and the Ride screen's no-sensor state
 * (#1029) draw the same card from the same words and the same picture.
 *
 * Each card is a list item with a real heading, one line and ONE link; the
 * link's `::after` stretches over the card (`theme.css`
 * §`.oyl-ride-card__link`), so the whole card is the target and still holds a
 * single interactive element. Since #1010 the picture IS the card's
 * background — it fills the card's width and every pixel the words do not
 * take — and the words stand on a solid band of `surfaceRaised` below it, so
 * every text pair on the card is a declared one and none is laid over a
 * drawing. The link is secondary wherever the card is drawn: neither screen's
 * one primary is a card.
 */

import { expandWorkout, seconds, thresholdShare } from '@onyourleft/domain';
import type { JSX } from 'react';

import { Hills, RiderSilhouette, RoadRibbon, Sky, WorkoutShape } from '../design/illustration';
import { hrefFor, routeById } from '../shell/routes';

/**
 * A workout's outline for the Workout card's picture: a warm-up, three hard
 * efforts and a cool-down. A drawing, not a workout anybody rides — no number
 * from it is shown, and the card's words say what the screen behind it is.
 */
const CARD_WORKOUT = expandWorkout({
  name: 'Home card',
  blocks: [
    { kind: 'ramp', seconds: seconds(300), from: thresholdShare(0.5), to: thresholdShare(0.75) },
    {
      kind: 'intervals',
      repeats: 3,
      hardSeconds: seconds(180),
      hardTarget: thresholdShare(1.1),
      easySeconds: seconds(120),
      easyTarget: thresholdShare(0.55),
    },
    { kind: 'steady', seconds: seconds(240), target: thresholdShare(0.6) },
  ],
});

export interface RideChoice {
  readonly id: string;
  readonly title: string;
  readonly line: string;
  readonly action: string;
  readonly to: 'ride' | 'game' | 'workouts';
  readonly art: JSX.Element;
}

export const RIDE_CHOICES: readonly RideChoice[] = [
  {
    id: 'free',
    title: 'Free ride',
    line: 'Record a ride from your paired sensors.',
    action: 'Start a ride',
    to: 'ride',
    art: (
      <>
        <Sky className="oyl-home__layer" clouds={false} />
        <Hills className="oyl-home__layer" seed={3} />
        <RiderSilhouette className="oyl-home__layer oyl-ride-card__rider" />
      </>
    ),
  },
  {
    id: 'route',
    title: 'Ride a route',
    line: 'Ride a saved route in the trainer game.',
    action: 'Choose a route',
    to: 'game',
    art: (
      <>
        <Sky className="oyl-home__layer" />
        <Hills className="oyl-home__layer" seed={5} />
        <RoadRibbon className="oyl-home__layer" />
      </>
    ),
  },
  {
    id: 'workout',
    title: 'Workout',
    line: 'Follow a structured workout on a smart trainer.',
    action: 'Choose a workout',
    to: 'workouts',
    art: (
      <>
        <Sky className="oyl-home__layer" sun={false} />
        <WorkoutShape className="oyl-home__layer oyl-ride-card__workout" workout={CARD_WORKOUT} />
      </>
    ),
  },
];

/**
 * One ride card. `idPrefix` names its heading, which the link is described by,
 * so two screens' cards never share an id.
 */
export function RideChoiceCard({
  choice,
  idPrefix,
}: {
  readonly choice: RideChoice;
  readonly idPrefix: string;
}): JSX.Element {
  const headingId = `${idPrefix}-${choice.id}`;
  return (
    <li className="oyl-ride-card tw:relative tw:flex tw:flex-col tw:overflow-hidden tw:rounded-card tw:bg-surface-raised">
      <div className="oyl-ride-card__art" aria-hidden="true">
        {choice.art}
      </div>
      <div className="oyl-ride-card__body tw:flex tw:flex-col tw:gap-sm tw:bg-surface-raised">
        <h3 id={headingId} className="tw:m-0">
          {choice.title}
        </h3>
        <p className="oyl-muted tw:m-0">{choice.line}</p>
        <a
          className="oyl-button oyl-button--secondary oyl-ride-card__link tw:self-start"
          href={hrefFor(routeById(choice.to))}
          aria-describedby={headingId}
        >
          {choice.action}
        </a>
      </div>
    </li>
  );
}
