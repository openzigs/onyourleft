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

import { AboutView } from '../views/AboutView';
import { ActivitiesView } from '../views/ActivitiesView';
import { DevicesView } from '../views/DevicesView';
import { NotFoundView } from '../views/NotFoundView';
import { RideView } from '../views/RideView';
import type { RideController } from '../ride/controller';
import type { CapabilityProbe } from '../support/bluetooth-support';

import { hrefFor, ROUTES, type RouteDefinition } from './routes';
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
}

function viewFor(
  route: RouteDefinition,
  capabilities: CapabilityProbe,
  rideController: RideController | undefined,
): JSX.Element {
  switch (route.id) {
    case 'ride':
      return <RideView controller={rideController} />;
    case 'activities':
      return <ActivitiesView />;
    case 'devices':
      return <DevicesView capabilities={capabilities} />;
    case 'about':
      return <AboutView />;
    case 'not-found':
      return <NotFoundView />;
  }
}

export function AppShell({ capabilities, rideController }: AppShellProps): JSX.Element {
  const route = useRoute();
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
        {viewFor(route, capabilities, rideController)}
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
