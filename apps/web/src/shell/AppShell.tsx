// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The frame every view renders inside: skip link, header, navigation, main,
 * footer — and the focus management that makes navigating between them usable
 * without a mouse.
 *
 * ## Focus on navigation, and why it is not automatic
 *
 * In a document, following a link loads a new page and the browser resets focus
 * to the top of it. In a single-page app nothing loads, so focus stays wherever
 * it was — on a navigation link that is now describing a page the athlete has
 * already left. A screen reader announces nothing, and the next Tab continues
 * from the header as though nothing happened. #48's fifth criterion is that a
 * test proves this does not happen.
 *
 * So on a route change focus moves to `<main>`, which carries `tabindex="-1"`
 * to be focusable without joining the tab order, and is labelled by the view's
 * `h1` so that landing on it announces the page you have arrived at.
 *
 * **Not on first render.** Moving focus during the initial mount takes it from
 * wherever the browser put it, which on a reload is often a control the athlete
 * had deliberately focused, and it makes the skip link unreachable by the very
 * first Tab press — the one press it exists for.
 *
 * ## The skip link cannot be an ordinary fragment link
 *
 * ⚠️ This shell routes on `location.hash` (`routes.ts`), so an `href="#main"`
 * that navigated normally would set the hash to `#main`, which matches no
 * route, and "skip to content" would land the athlete on the not-found page.
 * The link therefore prevents its own default and moves focus itself. It stays
 * an `<a>` rather than becoming a `<button>` so that it keeps the link role and
 * the affordance a screen-reader user expects at the top of a page.
 *
 * `AppShell.test.tsx` asserts both halves of that: focus lands on `main`, and
 * the route does **not** change.
 */

import { useEffect, useRef, type JSX, type MouseEvent } from 'react';

import { GameView } from '../game/GameView';
import { AboutView } from '../views/AboutView';
import { ActivitiesView } from '../views/ActivitiesView';
import { ActivityDetailView } from '../views/ActivityDetailView';
import { AnalysisView } from '../views/AnalysisView';
import { DevicesView } from '../views/DevicesView';
import { NotFoundView } from '../views/NotFoundView';
import { RideView } from '../views/RideView';
import { SegmentDetailView } from '../views/SegmentDetailView';
import type { RoutingProvider } from '@onyourleft/domain';

import { RouteBuilderView } from '../views/RouteBuilderView';
import { RoutesView } from '../views/RoutesView';
import { WorkoutsView } from '../views/WorkoutsView';
import { SegmentsView } from '../views/SegmentsView';
import { RideSession } from '../ride/RideSession';
import type { RideController } from '../ride/controller';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { TransferView } from '../transfer/TransferView';
import type { AnalysisPort } from '../analysis/store-port';
import type { DetailPort } from '../detail/store-port';
import type { BasemapConfig } from '../map/basemap';
import type { MapPort } from '../map/port';
import type { LibraryPort } from '../library/store-port';
import type { TransferPort } from '../transfer/store-port';
import type { EffortPort } from '../efforts/store-port';
import type { SegmentPort } from '../segments/store-port';
import type { RoutePort } from '../routes/store-port';
import type { WorkoutPort } from '../workouts/store-port';

import { hrefFor, ROUTES, type RouteMatch } from './routes';
import { useRoute } from './useRoute';

/** The id `main` carries, and the only place it is written. */
const MAIN_ID = 'oyl-main';

/** The id of the `h1`, which names the `main` landmark through `aria-labelledby`. */
const VIEW_TITLE_ID = 'oyl-view-title';

export interface AppShellProps {
  /**
   * The browser capabilities, probed once at start-up.
   *
   * Passed in rather than read from globals inside the tree, so that every
   * support state — including the ones no test machine can produce, like a
   * partial Linux implementation — is reachable from a test. `main.tsx` is the
   * one caller that reads the real browser.
   */
  readonly capabilities: CapabilityProbe;
  /**
   * The live ride screen's state machine (#49), built by `main.tsx` from the
   * transport and the store.
   *
   * Passed in rather than built here for the same reason `capabilities` is: the
   * shell is rendered by the accessibility suite on a machine with no Bluetooth
   * adapter and no IndexedDB worth the name, and a component that constructed
   * its own transport could not be. `undefined` renders the honest
   * cannot-pair-here screen, which is also what Safari and Firefox get.
   */
  readonly rideController?: RideController | undefined;
  /**
   * The trainer game's store reads and sensor sampling (#85).
   *
   * Passed in for exactly the reason the two above are, plus one more: the
   * renderer needs WebGL, which jsdom does not implement at all, so the
   * accessibility suite renders this route with `gameRenderer` absent and gets
   * the route picker. `game/port.ts` records that a view with no context is an
   * ordinary state rather than an error.
   */
  readonly game?: import('../game/GameView').GamePort | undefined;
  readonly gameRenderer?: (() => Promise<import('../game/port').GameRenderer>) | undefined;
  readonly screenLock?: import('../game/hud/wake-lock').ScreenLockSource | undefined;
  /**
   * The import and export screen's store, clock and file handling (#51).
   *
   * Passed in for the same reason as the two above, and with one extra: this
   * one performs a **download**, and a component that reached for
   * `URL.createObjectURL` itself could not be rendered by the accessibility
   * suite. `undefined` renders the honest explanation — which is also what a
   * page opened from the disk gets, because fingerprinting a file needs
   * `crypto.subtle` and that needs a secure context.
   */
  readonly transfer?: TransferPort | undefined;
  /**
   * The local activity library's store (#62).
   *
   * Passed in for the reason the three above are: `ActivitiesView` is rendered
   * by the accessibility suite, which has no IndexedDB worth the name, and a
   * view that opened a database itself could not be audited. `undefined`
   * renders the honest no-local-store screen rather than an empty list, which
   * would tell the rider they have no rides.
   */
  readonly library?: LibraryPort | undefined;
  /**
   * The activity detail view's store (#50).
   *
   * Passed in for the reason the others are. It is a **separate** port from
   * {@link AppShellProps.library} rather than a widening of it: the library's
   * two methods are all a list row may reach for, and a shared port would let a
   * later edit call `getStreamChannel` from a list — the read #62's budget and
   * #50's fourth criterion both forbid. `main.tsx` builds both from the one
   * database connection.
   */
  readonly detail?: DetailPort | undefined;
  /**
   * The analysis screen's store (#78).
   *
   * A fifth port over the same connection, and the only one that may read the
   * athlete record — the thresholds every zone boundary is derived from live
   * there, and #78's first criterion is that there is a *single* threshold
   * setting. It is also the only port that reads a channel across many rides,
   * which is why `analysis/load.ts` states a bound and `load.test.ts` counts
   * the decodes.
   */
  readonly analysis?: AnalysisPort | undefined;
  /**
   * How to get a map engine (#63), or `undefined` where there is none.
   *
   * A loader rather than a port: `maplibre-gl` is the largest dependency in
   * this client and is fetched only when a ride with GPS is opened. The
   * accessibility suite passes a resolved stub, or nothing at all.
   */
  readonly map?: (() => Promise<MapPort>) | undefined;
  /** Where the basemap archive is, or `undefined` until #53 publishes one. */
  readonly basemap?: BasemapConfig | undefined;
  /** Segments (#64), or `undefined` where this browser has no local store. */
  readonly segments?: SegmentPort | undefined;
  /** Saved routes (#73), or `undefined` where this browser has no local store. */
  readonly routes?: RoutePort | undefined;
  /**
   * The routing engine the drawing canvas asks for roads (#70, #71).
   *
   * ⚠️ `undefined` everywhere today, and not by oversight: ADR 0010 D-4 chose
   * Valhalla and #53 has not stood one up, so there is nothing to pass. The
   * builder screen places and moves waypoints without it and says why the roads
   * between them are missing — see `views/RouteBuilderView.tsx`.
   */
  readonly routing?: RoutingProvider | undefined;
  /** Saved workouts (#14), or `undefined` where this browser has no local store. */
  readonly workouts?: WorkoutPort | undefined;
  /**
   * The effort-history screen's reads (#67).
   *
   * Optional like every other port here: the accessibility suite renders every
   * route with none of them, and a view handed `undefined` says so in a
   * sentence rather than crashing the audit.
   */
  readonly efforts?: EffortPort | undefined;
}

/**
 * The view a match selects.
 *
 * One object parameter rather than a growing positional list: #50 made this the
 * sixth thing the shell has to hand down, and six positional arguments of which
 * four are `X | undefined` is a signature where a transposition typechecks.
 *
 * No `default` case, deliberately. The switch is exhaustive over `RouteId` and
 * TypeScript proves it: a route added to the table with no case here fails the
 * build with "function lacks ending return statement", which is how this
 * function stays in step with `routes.ts` without anyone remembering.
 */
function viewFor(match: RouteMatch, props: AppShellProps): JSX.Element {
  switch (match.route.id) {
    case 'ride':
      return (
        <RideView
          controller={props.rideController}
          workouts={props.workouts}
          analysis={props.analysis}
        />
      );
    case 'activities':
      return <ActivitiesView library={props.library} />;
    case 'activity-detail':
      return (
        <ActivityDetailView
          port={props.detail}
          activityId={match.parameter}
          map={props.map}
          basemap={props.basemap}
        />
      );
    case 'analysis':
      return <AnalysisView port={props.analysis} />;
    case 'segments':
      return <SegmentsView port={props.segments} />;
    case 'routes':
      return <RoutesView port={props.routes} save={props.transfer?.save} />;
    case 'route-builder':
      return <RouteBuilderView provider={props.routing} />;
    case 'workouts':
      return <WorkoutsView port={props.workouts} save={props.transfer?.save} />;
    case 'game':
      return (
        <GameView port={props.game} renderer={props.gameRenderer} screenLock={props.screenLock} />
      );
    case 'segment-detail':
      return <SegmentDetailView port={props.efforts} segment={match.parameter} />;
    case 'devices':
      return <DevicesView capabilities={props.capabilities} />;
    case 'transfer':
      return <TransferView port={props.transfer} />;
    case 'about':
      return <AboutView />;
    case 'not-found':
      return <NotFoundView />;
  }
}

export function AppShell(props: AppShellProps): JSX.Element {
  const match = useRoute();
  const route = match.route;
  const mainRef = useRef<HTMLElement>(null);
  const previousRouteId = useRef<string | null>(null);

  useEffect(() => {
    if (previousRouteId.current !== null && previousRouteId.current !== route.id) {
      mainRef.current?.focus();
    }
    previousRouteId.current = route.id;
  }, [route.id]);

  useEffect(() => {
    // The document title is the first thing a screen reader announces after a
    // page change and the only thing a tab strip shows, so it moves with the
    // route rather than staying on whatever index.html said.
    document.title = `${route.title} — On Your Left`;
  }, [route.title]);

  function skipToContent(event: MouseEvent<HTMLAnchorElement>): void {
    event.preventDefault();
    mainRef.current?.focus();
  }

  return (
    <div className="oyl-shell">
      {/*
        Outside `main`, and deliberately: a recording belongs to the app and not
        to whichever page is on screen. Mounted inside `viewFor` — as it was
        until #49's review — a route change unmounts the ride's clock and its
        unload guard, which stops the recorder checkpointing and lets the tab
        close without asking. It renders nothing. See `ride/RideSession.tsx`.
      */}
      {props.rideController === undefined ? null : (
        <RideSession controller={props.rideController} />
      )}

      <a className="oyl-skip-link" href={`#${MAIN_ID}`} onClick={skipToContent}>
        Skip to main content
      </a>

      <header className="oyl-header">
        <p className="oyl-wordmark">On Your Left</p>
        <nav aria-label="Primary">
          <ul className="oyl-nav-list">
            {ROUTES.map((entry) => (
              <li key={entry.id}>
                <a
                  className="oyl-nav-link"
                  href={hrefFor(entry)}
                  // The current page is marked for assistive technology as well
                  // as visually. `aria-current` is the half that survives the
                  // colour and the underline being unavailable — criterion 6.
                  aria-current={entry.id === route.id ? 'page' : undefined}
                >
                  {entry.navLabel}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main
        id={MAIN_ID}
        className="oyl-main"
        ref={mainRef}
        tabIndex={-1}
        aria-labelledby={VIEW_TITLE_ID}
      >
        <h1 id={VIEW_TITLE_ID}>{route.title}</h1>
        <p className="oyl-muted">{route.summary}</p>
        {viewFor(match, props)}
      </main>

      <footer className="oyl-footer">
        <p>
          On Your Left — free and open source. No account, no server: everything here stays on this
          device.
        </p>
      </footer>
    </div>
  );
}
