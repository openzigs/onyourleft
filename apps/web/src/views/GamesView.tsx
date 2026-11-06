// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Games tab's page — #2292, the owner's ruling of 2026-11-06: Delivery
 * and the lap race were each a switch at the bottom of a game ride's setup,
 * and hard to find. One card per game, saying what it is and where the rider
 * stands in it, and a *Play* that leads to the game's course picker
 * (`views/GameCoursesView.tsx`) and from there to the setup with the game
 * switched on. The setup's switches stay, for a ride started from a route.
 *
 * ## What each card says about the rider
 *
 * - **Delivery**: the week this device has kept
 *   (`game/delivery/delivery-progress.ts`), counts only (DL11), read as the
 *   page opens, so a round ridden since is seen at once.
 * - **The lap race**: how many of the rider's routes are loops it can be
 *   raced on, from the course picker's own list (`game/courses.ts`). ⚠️ Not a
 *   best finish: ADR 0060 D-12.2 stores no position against bots, and the
 *   race keeps nothing once a ride ends (`lap-race/ride-race.ts`). The PR
 *   for #2292 puts the "your best" line to the owner.
 *
 * Both *Play*s are secondary: two games on one page are two equal choices,
 * and the one-primary rule (`a11y/button-hierarchy.ts`) holds a page to one
 * heaviest control.
 */

import { useEffect, useState, type JSX } from 'react';

import { ButtonLink } from '../design/Button';
import { VisuallyHidden } from '../design/VisuallyHidden';
import { choosableCourses, coursesFor } from '../game/courses';
import { readDeliveryProgress } from '../game/delivery/delivery-progress';
import { DAYS_IN_WEEK, type WeekProgress } from '../game/delivery/round';
import type { GamePort } from '../game/GameView';
import { deviceStorage } from '../game/hud/announce-preference';
import { coursesRouteFor, hrefFor } from '../shell/routes';

/** The rider-facing words of the Games page: the project's own, naming no other game. */
export const GAMES_TEXT = {
  delivery: 'Delivery',
  deliveryWhat:
    'Throw parcels to the doorsteps of the houses on a round as you ride through a town.',
  lapRace: 'Lap race',
  lapRaceWhat: 'Race laps of one of your loops against bots, picking up items round the lap.',
  play: 'Play',
  loading: 'Reading your routes…',
} as const;

/**
 * The Delivery week, as a reading: *"Day 2 of 7 · 14 parcels delivered this
 * week"*. A reading rather than a sentence, so the card's one line of
 * explanation is what it is (#1013, `a11y/section-lines.ts`).
 */
export function deliveryWeekProgressText(week: Pick<WeekProgress, 'day' | 'score'>): string {
  const delivered =
    week.score === 0
      ? 'nothing delivered yet'
      : `${String(week.score)} ${week.score === 1 ? 'parcel' : 'parcels'} delivered this week`;
  return `Day ${String(week.day)} of ${String(DAYS_IN_WEEK)} · ${delivered}`;
}

/** How many loops the rider can race on, as a reading: *"2 loops to race on"*. */
export function lapRaceLoopsText(loops: number): string {
  if (loops === 0) {
    return 'No loops to race on yet';
  }
  return `${String(loops)} ${loops === 1 ? 'loop' : 'loops'} to race on`;
}

export interface GamesViewProps {
  /** The rider's saved routes, for the lap race's loops. Absent, the rider has none. */
  readonly port: GamePort | undefined;
}

export function GamesView(props: GamesViewProps): JSX.Element {
  const { port } = props;
  const [week] = useState(() => readDeliveryProgress(deviceStorage()));
  const [loops, setLoops] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (port === undefined) {
      setLoops(0);
      return;
    }
    let cancelled = false;
    void port.listRoutes().then((routes) => {
      if (!cancelled) setLoops(choosableCourses(coursesFor('lap-race', routes)));
    });
    return () => {
      cancelled = true;
    };
  }, [port]);
  return (
    // #2067's screen of sections, in #2197's halves: two cards share a
    // tablet's row rather than filling two thirds of it.
    <div className="oyl-games oyl-sections oyl-sections--halves">
      <GameCard
        id="oyl-games-delivery"
        heading={GAMES_TEXT.delivery}
        what={GAMES_TEXT.deliveryWhat}
        standing={deliveryWeekProgressText(week)}
        href={hrefFor(coursesRouteFor('delivery'))}
      />
      <GameCard
        id="oyl-games-lap-race"
        heading={GAMES_TEXT.lapRace}
        what={GAMES_TEXT.lapRaceWhat}
        standing={loops === undefined ? GAMES_TEXT.loading : lapRaceLoopsText(loops)}
        href={hrefFor(coursesRouteFor('lap-race'))}
      />
    </div>
  );
}

function GameCard(props: {
  readonly id: string;
  readonly heading: string;
  readonly what: string;
  readonly standing: string;
  readonly href: string;
}): JSX.Element {
  return (
    <section className="oyl-panel oyl-games__card" aria-labelledby={props.id}>
      <h2 id={props.id}>{props.heading}</h2>
      <p>{props.what}</p>
      <p className="oyl-games__standing">{props.standing}</p>
      <p className="tw:mb-0">
        <ButtonLink variant="secondary" href={props.href}>
          {GAMES_TEXT.play}
          {/* The visible word first, so a speech-control user can say it (SC 2.5.3). */}
          <VisuallyHidden> {props.heading}</VisuallyHidden>
        </ButtonLink>
      </p>
    </section>
  );
}
