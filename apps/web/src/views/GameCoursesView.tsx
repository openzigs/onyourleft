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
 * The lap race's list also holds the app's built-in circuits (#2293, ADR
 * 0064), from `GamePort.listCircuits`, with the OpenStreetMap credit and the
 * way to their licence beside them (D-5.1), as the setup's chooser shows
 * them. So a rider with no routes of their own still has courses to race.
 *
 * Delivery's list starts with the app's built-in levels (#2362, ADR 0065
 * D-8.1), from `GamePort.listDeliveryLevels`, **above every saved route**,
 * under a heading of their own and with the OpenStreetMap credit beside
 * them (D-6.5). The listing reads no level's file (D-2.5): a level's name,
 * length and houses are the catalogue's. So a rider with no routes and no
 * instance still has a round to ride.
 *
 * ⚠️ **Delivery rides in the realistic world only** (the owner's ruling DL6:
 * its houses are the mapped houses a realistic town draws), so with the
 * stylised world chosen the setup offers no round on a rider's own route.
 * This page says so, with the way to Settings, and offers no saved route: one
 * chosen here would open a setup with no Delivery in it. The built-in levels
 * are still listed above it (the owner's ruling of 2026-11-08 on PR #2378):
 * a level rides in the realistic world for that ride only, and Settings is
 * not changed.
 */

import { metres, type RouteProfile } from '@onyourleft/domain';
import { useEffect, useId, useRef, useState, type JSX } from 'react';

import { ButtonLink } from '../design/Button';
import { EmptyState } from '../design/EmptyState';
import { StatusMessage } from '../design/StatusMessage';
import { VisuallyHidden } from '../design/VisuallyHidden';
import { choosableCourses, coursesFor, type GameCourse } from '../game/courses';
import type { GamePort } from '../game/GameView';
import { readDeliveryProgress } from '../game/delivery/delivery-progress';
import type { ListedLevel } from '../game/delivery/levels/levels';
import { deviceStorage } from '../game/hud/announce-preference';
import {
  BUILT_IN_CIRCUITS_TEXT,
  routeFacts,
  type DeliveryCourse,
  type RidableRoute,
} from '../game/StageChooser';
import { readRealisticWorldChoice } from '../game/world-preference';
import { OSM_ATTRIBUTION } from '../map/basemap';
import { hrefFor, hrefForGamePlay, routeById, type GameMode } from '../shell/routes';
import { useUnits } from '../units/context';
import { formatDistance, measurementText } from '../units/format';

/** The rider-facing words of the course pickers: the project's own, naming no other game. */
export const GAME_COURSES_TEXT = {
  heading: 'Courses',
  choose: 'Choose this course',
  loading: 'Reading your routes…',
  noRoutesHeading: 'No saved routes yet',
  noRoutes: 'You have no saved routes yet. Each game is ridden on one of your saved routes.',
  // #2362, round 2, for the owner's approval: under the built-in rounds, where
  // the sentence above is no longer true.
  noRoutesBesideLevels: 'You have no saved routes yet. A route you save is listed here too.',
  importRoute: 'Import a GPX file on the Routes screen',
  deliveryNeedsWorld:
    'A Delivery round rides in the realistic world, and this device has the standard one chosen.',
  changeWorld: 'Choose the realistic world in Settings',
  back: 'Back to Games',
  noLoops: 'None of your routes is a loop yet. A lap race needs a route that ends where it starts.',
  openRoutes: 'Open Routes',
  // #2362: the built-in levels' heading and their one line each, for the owner's approval.
  levelsHeading: 'Built-in rounds',
  levelHouses: (houses: number): string =>
    `${String(houses)} ${houses === 1 ? 'house' : 'houses'} on the round`,
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
  // #2293: the built-in circuits, the lap race's only, read with the routes
  // as the setup reads them, so the list does not fill a moment later. A
  // circuit that cannot be read costs the circuits and never the routes.
  const [circuits, setCircuits] = useState<readonly RidableRoute[]>([]);
  // #2362: the built-in levels, Delivery's only, listed with the routes and
  // reading no level's file. A list that cannot be read costs the levels.
  const [levels, setLevels] = useState<readonly ListedLevel[]>([]);
  useEffect(() => {
    // A picker handed another game keeps this state while the routes are
    // read again, so the lap race's circuits go at once and are never counted
    // under Delivery. AppShell's `ViewBoundary key={route.id}` remounts the
    // view today; this does not lean on it.
    setCircuits([]);
    setLevels([]);
    if (port === undefined) {
      setRoutes([]);
      return;
    }
    let cancelled = false;
    const builtIn =
      mode === 'lap-race'
        ? (port.listCircuits?.() ?? Promise.resolve([])).catch((): readonly RidableRoute[] => [])
        : Promise.resolve([]);
    const levelsListed =
      mode === 'delivery'
        ? (port.listDeliveryLevels?.() ?? Promise.resolve([])).catch(
            (): readonly ListedLevel[] => [],
          )
        : Promise.resolve([]);
    void Promise.all([port.listRoutes(), builtIn, levelsListed]).then(
      ([found, circuitsFound, levelsFound]) => {
        if (!cancelled) {
          setCircuits(circuitsFound);
          setLevels(levelsFound);
          setRoutes(found);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [port, mode]);
  // #2294's counts, through `courses.ts` §`coursesFor`: each saved route's
  // houses for today's round, counted on this device one route at a time
  // through the setup's own corridor port, and abandoned when the page goes.
  // Only where a round is offered (the realistic world, DL6). The count is
  // loaded with `import()`, so the Games chunk carries no planner.
  const [week] = useState(() => readDeliveryProgress(deviceStorage()));
  const [counts, setCounts] = useState<ReadonlyMap<string, DeliveryCourse> | undefined>(undefined);
  const known = useRef(new WeakMap<RouteProfile, number>());
  const countsWanted = mode === 'delivery' && worldChosen && routes !== undefined;
  useEffect(() => {
    setCounts(undefined);
    const load = port?.loadWorldCorridor?.bind(port);
    if (!countsWanted || load === undefined || routes === undefined) return;
    const controller = new AbortController();
    setCounts(new Map());
    void import('../game/delivery/courses').then(async ({ countCourses }) =>
      countCourses(
        routes,
        load,
        controller.signal,
        (routeId, count) => {
          setCounts((before) => new Map(before).set(routeId, count));
        },
        known.current,
      ),
    );
    return () => {
      controller.abort();
    };
  }, [port, routes, countsWanted]);
  // #2362: the built-in levels, first, above every saved route (ADR 0065 D-8.1).
  const builtInLevels =
    mode === 'delivery' && levels.length > 0 ? <LevelsSection levels={levels} /> : null;
  if (mode === 'delivery' && !worldChosen) {
    // The owner's ruling of 2026-11-08 on PR #2378: the levels are listed in
    // the standard world too, each ridden in the realistic world for that
    // ride only. The rider's own routes keep the notice and the way to
    // Settings, as before.
    return (
      <div className="oyl-game-courses">
        <BackToGames />
        {builtInLevels}
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
    return (
      <div className="oyl-game-courses">
        <BackToGames />
        <p role="status">{GAME_COURSES_TEXT.loading}</p>
      </div>
    );
  }
  const noRoutes = (
    <EmptyState
      art="road"
      seed={7}
      heading={GAME_COURSES_TEXT.noRoutesHeading}
      level={2}
      action={
        <ButtonLink href={hrefFor(routeById('routes'))}>{GAME_COURSES_TEXT.importRoute}</ButtonLink>
      }
    >
      <p>{GAME_COURSES_TEXT.noRoutesBesideLevels}</p>
    </EmptyState>
  );
  if (routes.length === 0 && circuits.length === 0) {
    if (builtInLevels !== null) {
      return (
        <div className="oyl-game-courses">
          <BackToGames />
          {builtInLevels}
          {noRoutes}
        </div>
      );
    }
    return (
      <div className="oyl-game-courses">
        <BackToGames />
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
  const courses = coursesFor(
    mode,
    routes,
    counts === undefined ? undefined : { courses: counts, week },
    circuits,
  );
  const listsCircuits = courses.some((course) => circuits.includes(course.route));
  return (
    <div className="oyl-game-courses">
      <BackToGames />
      {mode === 'lap-race' && choosableCourses(courses) === 0 ? (
        // The owner's ruling of 2026-11-06: said once, above the greyed
        // cards, with the way to a loop, so the page is not a dead end.
        <p className="oyl-game-courses__none">
          {GAME_COURSES_TEXT.noLoops}{' '}
          <a href={hrefFor(routeById('routes'))}>{GAME_COURSES_TEXT.openRoutes}</a>
        </p>
      ) : null}
      {builtInLevels}
      <h2 id={headingId}>{GAME_COURSES_TEXT.heading}</h2>
      <ul className="oyl-game-courses__list oyl-sections" aria-labelledby={headingId}>
        {courses.map((course) => (
          <CourseEntry key={course.route.id} course={course} mode={mode} />
        ))}
      </ul>
      {listsCircuits ? (
        // ADR 0064 D-5.1: the credit beside the built-in circuits, and the way
        // to the notice they are offered under, in the chooser's own words.
        <p className="oyl-game-courses__credit" data-credit="circuits">
          {OSM_ATTRIBUTION} ·{' '}
          <a href={hrefFor(routeById('credits'))}>{BUILT_IN_CIRCUITS_TEXT.licence}</a>
        </p>
      ) : null}
    </div>
  );
}

/**
 * The built-in levels — #2362, ADR 0065 D-8.1: each with its name, its
 * length and its houses, and the way to its round; the OpenStreetMap credit
 * and the way to the licence beside them (D-6.5). In unlock order, as the
 * port lists them.
 */
function LevelsSection(props: { readonly levels: readonly ListedLevel[] }): JSX.Element {
  const units = useUnits();
  const headingId = useId();
  return (
    <section className="oyl-game-courses__levels" aria-labelledby={headingId}>
      <h2 id={headingId}>{GAME_COURSES_TEXT.levelsHeading}</h2>
      <ul className="oyl-game-courses__list oyl-sections" aria-labelledby={headingId}>
        {props.levels.map((level) => (
          <li key={level.id} className="oyl-panel oyl-game-courses__course" data-level={level.id}>
            <h3 className="oyl-game-courses__name">{level.name}</h3>
            <p className="oyl-muted">
              {measurementText(formatDistance(metres(level.lengthMetres), units))} ·{' '}
              {GAME_COURSES_TEXT.levelHouses(level.houses)}
            </p>
            <p className="tw:mb-0">
              <ButtonLink variant="secondary" href={hrefForGamePlay('delivery', level.routeId)}>
                {GAME_COURSES_TEXT.choose}
                <VisuallyHidden>: {level.name}</VisuallyHidden>
              </ButtonLink>
            </p>
          </li>
        ))}
      </ul>
      <p className="oyl-game-courses__credit" data-credit="levels">
        {OSM_ATTRIBUTION} ·{' '}
        <a href={hrefFor(routeById('credits'))}>{BUILT_IN_CIRCUITS_TEXT.licence}</a>
      </p>
    </section>
  );
}

/**
 * The way back to the Games page — the owner's ruling of 2026-11-06: in
 * every state of the picker and at every width, a phone's included, where
 * the navigation is a bar at the bottom. A 44 px target (`theme.css`
 * §`.oyl-game-courses__back`), as every control a rider taps here is.
 */
function BackToGames(): JSX.Element {
  return (
    <p className="tw:mt-0">
      <a className="oyl-game-courses__back" href={hrefFor(routeById('games'))}>
        {GAME_COURSES_TEXT.back}
      </a>
    </p>
  );
}

function CourseEntry(props: { readonly course: GameCourse; readonly mode: GameMode }): JSX.Element {
  const units = useUnits();
  const { route, unavailable, line } = props.course;
  return (
    <li className="oyl-panel oyl-game-courses__course">
      <h3 className="oyl-game-courses__name">{route.name}</h3>
      <p className="oyl-muted">{routeFacts(route.profile, units)}</p>
      {line === undefined ? null : <p className="oyl-game-courses__holds">{line}</p>}
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
