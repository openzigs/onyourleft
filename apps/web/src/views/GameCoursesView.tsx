// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A game's course picker — #2292: reached from its card on the Games page,
 * it lists the courses `game/courses.ts` §`coursesFor` offers, and a course
 * chosen here opens the trainer game's setup on that route with the game
 * switched on (`shell/routes.ts` §`hrefForGamePlay`). The rider still
 * presses Ride there, after reading what the setup says about the trainer.
 *
 * A course that cannot hold the game is drawn without a way to choose it,
 * with the reason in words beside it, never as a control that does nothing.
 *
 * ⚠️ **Delivery rides in the realistic world only** (the owner's ruling DL6:
 * its houses are the mapped houses a realistic town draws), so with the
 * stylised world chosen the setup offers no round. This page says so, with
 * the way to Settings, and offers no course: a course chosen here would open
 * a setup with no Delivery in it.
 */

import { useEffect, useId, useState, type JSX } from 'react';

import { ButtonLink } from '../design/Button';
import { EmptyState } from '../design/EmptyState';
import { StatusMessage } from '../design/StatusMessage';
import { VisuallyHidden } from '../design/VisuallyHidden';
import { coursesFor, type GameCourse } from '../game/courses';
import type { GamePort } from '../game/GameView';
import { deviceStorage } from '../game/hud/announce-preference';
import { routeFacts, type RidableRoute } from '../game/StageChooser';
import { readRealisticWorldChoice } from '../game/world-preference';
import { hrefFor, hrefForGamePlay, routeById, type GameMode } from '../shell/routes';
import { useUnits } from '../units/context';

/** The rider-facing words of the course pickers: the project's own, naming no other game. */
export const GAME_COURSES_TEXT = {
  heading: 'Courses',
  choose: 'Choose this course',
  loading: 'Reading your routes…',
  noRoutesHeading: 'No saved routes yet',
  noRoutes: 'You have no saved routes yet. Each game is ridden on one of your saved routes.',
  importRoute: 'Import a GPX file on the Routes screen',
  deliveryNeedsWorld:
    'A Delivery round rides in the realistic world, and this device has the standard one chosen.',
  changeWorld: 'Choose the realistic world in Settings',
} as const;

export interface GameCoursesViewProps {
  /** Which game's courses. */
  readonly mode: GameMode;
  /** The rider's saved routes. Absent, the rider has none. */
  readonly port: GamePort | undefined;
}

export function GameCoursesView(props: GameCoursesViewProps): JSX.Element {
  const { mode, port } = props;
  // Read as the page opens, as the setup reads it: a world changed in
  // Settings is seen on the next visit.
  const headingId = useId();
  const [worldChosen] = useState(() => readRealisticWorldChoice(deviceStorage()));
  const [routes, setRoutes] = useState<readonly RidableRoute[] | undefined>(undefined);
  useEffect(() => {
    if (port === undefined) {
      setRoutes([]);
      return;
    }
    let cancelled = false;
    void port.listRoutes().then((found) => {
      if (!cancelled) setRoutes(found);
    });
    return () => {
      cancelled = true;
    };
  }, [port]);
  if (mode === 'delivery' && !worldChosen) {
    return (
      <div className="oyl-game-courses">
        <StatusMessage tone="info" label="Delivery">
          {GAME_COURSES_TEXT.deliveryNeedsWorld}
        </StatusMessage>
        <p>
          <ButtonLink href={hrefFor(routeById('settings'))}>
            {GAME_COURSES_TEXT.changeWorld}
          </ButtonLink>
        </p>
      </div>
    );
  }
  if (routes === undefined) {
    return <p role="status">{GAME_COURSES_TEXT.loading}</p>;
  }
  if (routes.length === 0) {
    return (
      <div className="oyl-game-courses">
        <EmptyState
          art="road"
          seed={7}
          heading={GAME_COURSES_TEXT.noRoutesHeading}
          level={2}
          action={
            <ButtonLink href={hrefFor(routeById('routes'))}>
              {GAME_COURSES_TEXT.importRoute}
            </ButtonLink>
          }
        >
          <p>{GAME_COURSES_TEXT.noRoutes}</p>
        </EmptyState>
      </div>
    );
  }
  return (
    <div className="oyl-game-courses">
      <h2 id={headingId}>{GAME_COURSES_TEXT.heading}</h2>
      <ul className="oyl-game-courses__list oyl-sections" aria-labelledby={headingId}>
        {coursesFor(mode, routes).map((course) => (
          <CourseEntry key={course.route.id} course={course} mode={mode} />
        ))}
      </ul>
    </div>
  );
}

function CourseEntry(props: { readonly course: GameCourse; readonly mode: GameMode }): JSX.Element {
  const units = useUnits();
  const { route, unavailable } = props.course;
  return (
    <li
      className={`oyl-panel oyl-game-courses__course${unavailable === undefined ? '' : ' oyl-game-courses__course--unavailable'}`}
    >
      <h3 className="oyl-game-courses__name">{route.name}</h3>
      <p className="oyl-muted">{routeFacts(route.profile, units)}</p>
      {unavailable === undefined ? (
        <p className="tw:mb-0">
          <ButtonLink variant="secondary" href={hrefForGamePlay(props.mode, route.id)}>
            {GAME_COURSES_TEXT.choose}
            <VisuallyHidden>: {route.name}</VisuallyHidden>
          </ButtonLink>
        </p>
      ) : (
        <p className="oyl-game-courses__unavailable tw:mb-0">{unavailable}</p>
      )}
    </li>
  );
}
